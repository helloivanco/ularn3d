-- Rejoining, expiry and completed expeditions have explicit, replayable states.
alter table public.rooms add column if not exists finished boolean not null default false;
grant select(finished) on public.rooms to authenticated;
alter table public.room_actions drop constraint room_actions_kind_check;
alter table public.room_actions add constraint room_actions_kind_check check(kind in ('key','join','leave','resume','remove'));

create or replace function private.retire_room_members(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $fn$
declare departed public.room_members; playing boolean;
begin
  select status='playing' into playing from public.rooms where id=p_room_id;
  for departed in select * from public.room_members where room_id=p_room_id and role='player' and not banned and not connected and left_at < now()-interval '120 seconds' loop
    if playing then perform private.append_room_event(p_room_id,departed.user_id,'remove','expired'); end if;
    delete from public.room_members where room_id=p_room_id and user_id=departed.user_id;
  end loop;
end;
$fn$;
revoke all on function private.retire_room_members(uuid) from public,anon,authenticated;

create or replace function private.finish_room(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
begin
  update public.rooms set finished=true where id=p_room_id and host_user_id=auth.uid() and private.is_room_member(id);
  if not found then return jsonb_build_object('ok',false,'error','not_host'); end if;
  return jsonb_build_object('ok',true);
end;
$fn$;
create or replace function public.finish_room(p_room_id uuid)
returns jsonb language sql security invoker set search_path = '' as $fn$ select private.finish_room(p_room_id); $fn$;
revoke all on function private.finish_room(uuid),public.finish_room(uuid) from public,anon;
grant execute on function private.finish_room(uuid),public.finish_room(uuid) to authenticated,service_role;

create or replace function private.join_room_checked(p_code text,p_password text default null,p_role text default 'player',p_character_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare joined jsonb; rid uuid; m public.room_members; picked text; previous public.room_members;
begin
  if auth.uid() is null then return jsonb_build_object('ok',false,'error','unauthenticated'); end if;
  perform 1 from public.rooms where join_code=upper(btrim(p_code)) for update;
  select m.* into previous from public.room_members m join public.rooms r on r.id=m.room_id where r.join_code=upper(btrim(p_code)) and m.user_id=auth.uid();
  perform private.expire_rejoin(p_code);
  joined := private.join_room(p_code,p_password,p_role,p_character_name);
  if joined->>'ok' <> 'true' then return joined; end if;
  rid := (joined->>'room_id')::uuid;
  picked := coalesce(nullif(current_setting('ularn.character',true),''),'Adventurer');
  if previous.user_id is not null and previous.last_seen < now()-interval '120 seconds' then
    joined:=jsonb_set(joined,'{resumed}','false'::jsonb);
    update public.room_members set character_name=(select display_name from public.profiles where user_id=auth.uid()) where room_id=rid and user_id=auth.uid();
  end if;
  if joined->>'resumed'='false' then
    update public.room_members set character_class=picked where room_id=rid and user_id=auth.uid();
    select * into m from public.room_members where room_id=rid and user_id=auth.uid();
    if m.role <> 'spectator' and exists(select 1 from public.rooms where id=rid and status='playing') then
      perform private.append_room_event(rid,auth.uid(),'join',null);
    end if;
  elsif previous.connected=false and previous.role <> 'spectator' and exists(select 1 from public.rooms where id=rid and status='playing') then
    perform private.append_room_event(rid,auth.uid(),'resume',null);
  end if;
  return joined;
end;
$fn$;

create or replace function private.join_room_as(p_code text,p_password text,p_role text,p_character_class text)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare rid uuid;
begin
  if auth.uid() is null then return jsonb_build_object('ok',false,'error','unauthenticated'); end if;
  if p_character_class is null or p_character_class not in ('Adventurer','Ogre','Wizard','Klingon','Elf','Rogue','Dwarf','Rambo') then
    return jsonb_build_object('ok',false,'error','bad_character');
  end if;
  select id into rid from public.rooms where join_code=upper(btrim(p_code)) for update;
  if rid is not null then
    update public.room_members set connected=false,left_at=last_seen where room_id=rid and connected and last_seen < now()-interval '15 seconds';
    perform private.retire_room_members(rid);
    if p_role='player' and exists(select 1 from public.rooms where id=rid and finished) then return jsonb_build_object('ok',false,'error','run_over'); end if;
  end if;
  perform set_config('ularn.character',p_character_class,true);
  return private.join_room_checked(p_code,p_password,p_role,null);
end;
$fn$;

create or replace function private.resume_room(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare m public.room_members; r public.rooms;
begin
  select * into r from public.rooms where id=p_room_id for update;
  select * into m from public.room_members where room_id=p_room_id and user_id=auth.uid();
  if r.id is null or r.status='closed' then return jsonb_build_object('ok',false,'error','room_not_found'); end if;
  if m.user_id is null or m.banned or exists(select 1 from public.profiles where user_id=auth.uid() and banned) then return jsonb_build_object('ok',false,'error','not_member'); end if;
  if m.last_seen < now()-interval '120 seconds' or (not m.connected and m.left_at < now()-interval '120 seconds') then return jsonb_build_object('ok',false,'error','expired'); end if;
  if not m.connected and m.role <> 'spectator' and r.status='playing' then perform private.append_room_event(p_room_id,auth.uid(),'resume',null); end if;
  update public.room_members set connected=true,left_at=null,last_seen=now() where room_id=p_room_id and user_id=auth.uid();
  return jsonb_build_object('ok',true,'room_id',p_room_id,'join_code',r.join_code,'role',m.role,'slot',m.slot);
end;
$fn$;

create or replace function private.sync_room(p_room_id uuid,p_after bigint default 0)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare r public.rooms; m public.room_members; stale public.room_members; roster jsonb; actions jsonb;
begin
  select * into r from public.rooms where id=p_room_id for update;
  select * into m from public.room_members where room_id=p_room_id and user_id=auth.uid();
  if r.id is null or r.status='closed' then return jsonb_build_object('ok',false,'error','room_not_found'); end if;
  if m.user_id is null or m.banned or exists(select 1 from public.profiles where user_id=auth.uid() and banned) then return jsonb_build_object('ok',false,'error','not_member'); end if;
  if not m.connected then
    if m.left_at < now()-interval '120 seconds' then return jsonb_build_object('ok',false,'error','expired'); end if;
    if m.role <> 'spectator' and r.status='playing' then perform private.append_room_event(p_room_id,auth.uid(),'resume',null); end if;
    update public.room_members set connected=true,left_at=null where room_id=p_room_id and user_id=auth.uid();
  end if;
  update public.room_members set last_seen=now() where room_id=p_room_id and user_id=auth.uid();
  update public.rooms set last_heartbeat=now() where id=p_room_id;
  for stale in update public.room_members set connected=false,left_at=last_seen
    where room_id=p_room_id and user_id <> auth.uid() and connected and last_seen < now()-interval '15 seconds'
    returning * loop
    if stale.role <> 'spectator' and r.status='playing' then
      perform private.append_room_event(p_room_id,stale.user_id,'leave',null);
    end if;
  end loop;
  if m.role='player' then perform private.claim_host(p_room_id); end if;
  perform private.retire_room_members(p_room_id);
  select * into r from public.rooms where id=p_room_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId',seated.user_id,'name',coalesce(seated.character_name,p.display_name),
    'role',seated.role,'slot',seated.slot,'character',seated.character_class,
    'ready',seated.ready,'connected',seated.connected,'banned',seated.banned,
    'lastSeen',extract(epoch from seated.last_seen)*1000,'joinedAt',extract(epoch from seated.joined_at)*1000
  ) order by seated.slot nulls last,seated.joined_at),'[]'::jsonb) into roster
    from public.room_members seated join public.profiles p on p.user_id=seated.user_id where seated.room_id=p_room_id;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.seq),'[]'::jsonb) into actions from (
    select * from public.room_actions where room_id=p_room_id and seq>greatest(p_after,0) order by seq limit 256
  ) a;
  return jsonb_build_object('ok',true,'room',jsonb_build_object(
    'id',r.id,'join_code',r.join_code,'status',r.status,'seed',r.seed,'version',r.version,
    'host_user_id',r.host_user_id,'hide_spectator_chat',r.hide_spectator_chat,'max_players',r.max_players,
    'finished',r.finished,'depth',r.depth,'run_id',r.run_id,'game_config',r.game_config,'action_seq',r.action_seq
  ),'members',roster,'actions',actions,'chat',private.recent_chat(p_room_id));
end;
$fn$;

create or replace function private.send_room_action(p_room_id uuid,p_request_id uuid,p_input text)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare r public.rooms; m public.room_members; previous jsonb;
begin
  select * into r from public.rooms where id=p_room_id for update;
  select * into m from public.room_members where room_id=p_room_id and user_id=auth.uid();
  if r.id is null or r.status <> 'playing' then return jsonb_build_object('ok',false,'error','not_playing'); end if;
  if r.finished then return jsonb_build_object('ok',false,'error','run_over'); end if;
  if m.user_id is null or m.banned or exists(select 1 from public.profiles where user_id=auth.uid() and banned) or not m.connected then return jsonb_build_object('ok',false,'error','not_member'); end if;
  if m.role not in ('host','player') then return jsonb_build_object('ok',false,'error','spectator'); end if;
  if p_request_id is null or p_input is null or char_length(p_input) not between 1 and 32 then
    return jsonb_build_object('ok',false,'error','bad_input');
  end if;
  select to_jsonb(a) into previous from public.room_actions a
    where room_id=p_room_id and user_id=auth.uid() and request_id=p_request_id;
  if previous is not null then return jsonb_build_object('ok',true,'action',previous); end if;
  if (select count(*) from public.room_actions where room_id=p_room_id and user_id=auth.uid() and created_at > now()-interval '1 second') >= 12 then
    return jsonb_build_object('ok',false,'error','rate_limited');
  end if;
  update public.room_members set last_seen=now() where room_id=p_room_id and user_id=auth.uid();
  return jsonb_build_object('ok',true,'action',private.append_room_event(p_room_id,auth.uid(),'key',p_input,p_request_id));
end;
$fn$;

create or replace function private.kick_member(p_room_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare r public.rooms; m public.room_members;
begin
  select * into r from public.rooms where id=p_room_id for update;
  if not private.is_room_member(p_room_id) or r.host_user_id <> auth.uid() then return jsonb_build_object('ok',false,'error','not_host'); end if;
  if p_user_id is null or p_user_id=auth.uid() then return jsonb_build_object('ok',false,'error','bad_target'); end if;
  select * into m from public.room_members where room_id=p_room_id and user_id=p_user_id and not banned;
  if m.user_id is null then return jsonb_build_object('ok',false,'error','not_member'); end if;
  if m.role <> 'spectator' and r.status='playing' then perform private.append_room_event(p_room_id,p_user_id,'remove','kicked'); end if;
  update public.room_members set banned=true,connected=false,left_at=now() where room_id=p_room_id and user_id=p_user_id;
  return jsonb_build_object('ok',true);
end;
$fn$;

notify pgrst, 'reload schema';

-- A disconnected host cannot keep writing obsolete snapshots.
drop policy if exists room_snapshots_insert_host on public.room_snapshots;
create policy room_snapshots_insert_host on public.room_snapshots for insert to authenticated with check (
  private.is_room_member(room_id) and exists(select 1 from public.rooms r where r.id=room_snapshots.room_id and r.host_user_id=(select auth.uid()) and r.status='playing')
);
