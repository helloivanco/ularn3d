-- Server-ordered, authenticated room actions. Browsers never trust peer broadcasts.
alter table public.rooms add column if not exists action_seq bigint not null default 0;
alter table public.rooms add column if not exists run_id uuid references public.runs(id);
alter table public.rooms add column if not exists game_config jsonb;
alter table public.room_members add column if not exists character_class text not null default 'Adventurer';
grant select (action_seq, run_id, game_config) on public.rooms to authenticated;

create table if not exists public.room_actions (
  room_id uuid not null references public.rooms(id) on delete cascade,
  seq bigint not null,
  user_id uuid not null references public.profiles(user_id),
  actor integer not null check (actor between 0 and 3),
  kind text not null check (kind in ('key', 'join', 'leave', 'resume')),
  input text,
  name text not null,
  character_class text not null,
  request_id uuid,
  created_at timestamptz not null default now(),
  primary key (room_id, seq),
  unique (room_id, user_id, request_id)
);
alter table public.room_actions enable row level security;
revoke all on public.room_actions from public, anon, authenticated;
grant select on public.room_actions to authenticated;
grant all on public.room_actions to service_role;

create or replace function private.is_room_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.room_members m join public.rooms r on r.id=m.room_id join public.profiles p on p.user_id=m.user_id
    where m.room_id=p_room_id and m.user_id=(select auth.uid())
      and not m.banned and not p.banned and m.connected and r.status <> 'closed'
  );
$fn$;
drop policy if exists room_actions_read_member on public.room_actions;
create policy room_actions_read_member on public.room_actions for select to authenticated
using (private.is_room_member(room_id));

create or replace function private.append_room_event(p_room_id uuid, p_user_id uuid, p_kind text, p_input text, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare m public.room_members; n bigint; result jsonb;
begin
  select * into m from public.room_members where room_id=p_room_id and user_id=p_user_id;
  if m.slot is null then return null; end if;
  update public.rooms set action_seq=action_seq+1 where id=p_room_id returning action_seq into n;
  insert into public.room_actions(room_id,seq,user_id,actor,kind,input,name,character_class,request_id)
    values(p_room_id,n,p_user_id,m.slot,p_kind,p_input,coalesce(m.character_name,'Adventurer'),m.character_class,p_request_id)
    returning to_jsonb(room_actions) into result;
  return result;
end;
$fn$;
revoke all on function private.append_room_event(uuid,uuid,text,text,uuid) from public,anon,authenticated;

create or replace function private.configure_room_character(p_room_id uuid,p_character_class text)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
begin
  if p_character_class not in ('Adventurer','Ogre','Wizard','Klingon','Elf','Rogue','Dwarf','Rambo') then
    return jsonb_build_object('ok',false,'error','bad_character');
  end if;
  perform 1 from public.rooms where id=p_room_id for update;
  update public.room_members m set character_class=p_character_class,ready=false
    from public.rooms r where r.id=m.room_id and r.id=p_room_id and r.status='lobby'
      and m.user_id=auth.uid() and m.connected and not m.banned and m.role in ('host','player');
  if not found then return jsonb_build_object('ok',false,'error','not_member'); end if;
  return jsonb_build_object('ok',true);
end;
$fn$;
create or replace function public.configure_room_character(p_room_id uuid,p_character_class text)
returns jsonb language sql security invoker set search_path = '' as $fn$
select private.configure_room_character(p_room_id,p_character_class); $fn$;

create or replace function private.join_room_checked(p_code text,p_password text default null,p_role text default 'player',p_character_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare joined jsonb; rid uuid; m public.room_members; picked text;
begin
  if auth.uid() is null then return jsonb_build_object('ok',false,'error','unauthenticated'); end if;
  perform 1 from public.rooms where join_code=upper(btrim(p_code)) for update;
  perform private.expire_rejoin(p_code);
  joined := private.join_room(p_code,p_password,p_role,p_character_name);
  if joined->>'ok' <> 'true' then return joined; end if;
  rid := (joined->>'room_id')::uuid;
  picked := coalesce(nullif(current_setting('ularn.character',true),''),'Adventurer');
  if joined->>'resumed'='false' then
    update public.room_members set character_class=picked where room_id=rid and user_id=auth.uid();
    select * into m from public.room_members where room_id=rid and user_id=auth.uid();
    if m.role <> 'spectator' and exists(select 1 from public.rooms where id=rid and status='playing') then
      perform private.append_room_event(rid,auth.uid(),'join',null);
    end if;
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
    delete from public.room_members where room_id=rid and role='player' and not banned
      and not connected and left_at < now()-interval '120 seconds';
  end if;
  perform set_config('ularn.character',p_character_class,true);
  return private.join_room_checked(p_code,p_password,p_role,null);
end;
$fn$;
create or replace function public.join_room_as(p_code text,p_password text,p_role text,p_character_class text)
returns jsonb language sql security invoker set search_path = '' as $fn$
select private.join_room_as(p_code,p_password,p_role,p_character_class); $fn$;

create or replace function private.resume_room(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare m public.room_members; r public.rooms;
begin
  select * into r from public.rooms where id=p_room_id for update;
  select * into m from public.room_members where room_id=p_room_id and user_id=auth.uid();
  if r.id is null or r.status='closed' then return jsonb_build_object('ok',false,'error','room_not_found'); end if;
  if m.user_id is null or m.banned or exists(select 1 from public.profiles where user_id=auth.uid() and banned) then return jsonb_build_object('ok',false,'error','not_member'); end if;
  if not m.connected and m.left_at < now()-interval '120 seconds' then return jsonb_build_object('ok',false,'error','expired'); end if;
  if not m.connected and m.role <> 'spectator' and r.status='playing' then perform private.append_room_event(p_room_id,auth.uid(),'resume',null); end if;
  update public.room_members set connected=true,left_at=null,last_seen=now() where room_id=p_room_id and user_id=auth.uid();
  return jsonb_build_object('ok',true,'room_id',p_room_id,'join_code',r.join_code,'role',m.role,'slot',m.slot);
end;
$fn$;
create or replace function public.resume_room(p_room_id uuid)
returns jsonb language sql security invoker set search_path = '' as $fn$
select private.resume_room(p_room_id); $fn$;

create or replace function private.send_room_action(p_room_id uuid,p_request_id uuid,p_input text)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare r public.rooms; m public.room_members; previous jsonb;
begin
  select * into r from public.rooms where id=p_room_id for update;
  select * into m from public.room_members where room_id=p_room_id and user_id=auth.uid();
  if r.id is null or r.status <> 'playing' then return jsonb_build_object('ok',false,'error','not_playing'); end if;
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
create or replace function public.send_room_action(p_room_id uuid,p_request_id uuid,p_input text)
returns jsonb language sql security invoker set search_path = '' as $fn$
select private.send_room_action(p_room_id,p_request_id,p_input); $fn$;

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
    'run_id',r.run_id,'game_config',r.game_config,'action_seq',r.action_seq
  ),'members',roster,'actions',actions,'chat',private.recent_chat(p_room_id));
end;
$fn$;
create or replace function public.sync_room(p_room_id uuid,p_after bigint default 0)
returns jsonb language sql security invoker set search_path = '' as $fn$
select private.sync_room(p_room_id,p_after); $fn$;

create or replace function private.set_ready(p_room_id uuid,p_ready boolean)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
begin
  perform 1 from public.rooms where id=p_room_id for update;
  update public.room_members m set ready=coalesce(p_ready,false),last_seen=now()
    from public.rooms r where m.room_id=p_room_id and r.id=m.room_id and r.status='lobby'
      and m.user_id=auth.uid() and not m.banned and m.connected and m.role in ('host','player');
  if not found then return jsonb_build_object('ok',false,'error','not_player'); end if;
  return jsonb_build_object('ok',true,'ready',coalesce(p_ready,false));
end;
$fn$;

create or replace function private.start_run(p_mode text,p_room_id uuid,p_engine_version text)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare uid uuid:=auth.uid(); chosen text:=lower(coalesce(p_mode,'')); engine text:=btrim(coalesce(p_engine_version,''));
  r public.rooms; party integer:=1; players jsonb; drawn bigint; run uuid; client text:=private.client_ip();
begin
  if uid is null then return jsonb_build_object('ok',false,'error','unauthenticated'); end if;
  if not exists(select 1 from public.profiles where user_id=uid and not banned) then return jsonb_build_object('ok',false,'error','name_required'); end if;
  if chosen not in ('solo','coop') then return jsonb_build_object('ok',false,'error','bad_mode'); end if;
  if char_length(engine) not between 1 and 32 then return jsonb_build_object('ok',false,'error','bad_version'); end if;
  if chosen='coop' then
    select * into r from public.rooms where id=p_room_id for update;
    if r.id is null or r.status='closed' then return jsonb_build_object('ok',false,'error','room_not_found'); end if;
    if r.host_user_id <> uid or not exists(select 1 from public.room_members where room_id=p_room_id and user_id=uid and role='host' and connected and not banned) then
      return jsonb_build_object('ok',false,'error','not_host');
    end if;
    if r.status='playing' and r.run_id is not null then return jsonb_build_object('ok',true,'run_id',r.run_id,'seed',r.seed,'already_started',true); end if;
    select count(*) into party from public.room_members where room_id=p_room_id and role in ('host','player') and connected and not banned;
    if party < 2 then return jsonb_build_object('ok',false,'error','need_players'); end if;
    if exists(select 1 from public.room_members where room_id=p_room_id and role in ('host','player') and connected and not banned and not ready) then
      return jsonb_build_object('ok',false,'error','not_ready');
    end if;
    select jsonb_agg(jsonb_build_object('userId',user_id,'slot',slot,'name',character_name,'character',character_class) order by slot) into players
      from public.room_members where room_id=p_room_id and role in ('host','player') and connected and not banned;
  elsif p_room_id is not null then return jsonb_build_object('ok',false,'error','bad_mode'); end if;
  if (select count(*) from private.run_starts where user_id=uid and started_at>now()-interval '1 hour') >= 20
    or (client <> '' and (select count(*) from private.run_starts where ip=client and started_at>now()-interval '1 hour') >= 40) then
    return jsonb_build_object('ok',false,'error','rate_limited');
  end if;
  drawn:=private.random_seed();
  insert into private.run_starts(user_id,ip) values(uid,client);
  insert into public.runs(user_id,mode,party_size,room_id,seed,engine_version)
    values(uid,chosen,party,case when chosen='coop' then p_room_id end,drawn,engine) returning id into run;
  if chosen='coop' then
    update public.rooms set seed=drawn,run_id=run,version=engine,status='playing',last_heartbeat=now(),
      game_config=jsonb_build_object('version',2,'difficulty',0,'players',players) where id=p_room_id;
  end if;
  return jsonb_build_object('ok',true,'run_id',run,'seed',drawn,'mode',chosen);
end;
$fn$;
create or replace function private.start_room(p_room_id uuid,p_engine_version text,p_difficulty integer)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare result jsonb;
begin
  if p_difficulty is null or p_difficulty not between 0 and 128 then return jsonb_build_object('ok',false,'error','bad_difficulty'); end if;
  result:=private.start_run('coop',p_room_id,p_engine_version);
  if result->>'ok'='true' and coalesce((result->>'already_started')::boolean,false)=false then
    update public.rooms set game_config=jsonb_set(game_config,'{difficulty}',to_jsonb(p_difficulty)) where id=p_room_id;
  end if;
  return result;
end;
$fn$;
create or replace function public.start_room(p_room_id uuid,p_engine_version text,p_difficulty integer default 0)
returns jsonb language sql security invoker set search_path = '' as $fn$
select private.start_room(p_room_id,p_engine_version,p_difficulty); $fn$;


create or replace function public.join_room(p_code text,p_password text default null,p_role text default 'player',p_character_name text default null)
returns jsonb language sql security invoker set search_path = '' as $fn$
select private.join_room_checked(p_code,p_password,p_role,p_character_name); $fn$;

create or replace function private.exit_room(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare m public.room_members; r public.rooms; heir uuid;
begin
  select * into r from public.rooms where id=p_room_id for update;
  select * into m from public.room_members where room_id=p_room_id and user_id=auth.uid() and not banned;
  if m.user_id is null then return jsonb_build_object('ok',false,'error','not_member'); end if;
  if m.connected and m.role <> 'spectator' and r.status='playing' then
    perform private.append_room_event(p_room_id,auth.uid(),'leave',null);
  end if;
  if m.role='host' then
    select user_id into heir from public.room_members where room_id=p_room_id and role='player' and connected and not banned order by joined_at limit 1;
    if heir is not null then perform private.transfer_host(p_room_id,heir);
    else update public.rooms set status='closed' where id=p_room_id; end if;
  end if;
  perform private.leave_room(p_room_id);
  return jsonb_build_object('ok',true);
end;
$fn$;
create or replace function public.leave_room(p_room_id uuid)
returns jsonb language sql security invoker set search_path = '' as $fn$
select private.exit_room(p_room_id); $fn$;

create or replace function private.kick_member(p_room_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare r public.rooms; m public.room_members;
begin
  select * into r from public.rooms where id=p_room_id for update;
  if not private.is_room_member(p_room_id) or r.host_user_id <> auth.uid() then return jsonb_build_object('ok',false,'error','not_host'); end if;
  if p_user_id is null or p_user_id=auth.uid() then return jsonb_build_object('ok',false,'error','bad_target'); end if;
  select * into m from public.room_members where room_id=p_room_id and user_id=p_user_id and not banned;
  if m.user_id is null then return jsonb_build_object('ok',false,'error','not_member'); end if;
  if m.role <> 'spectator' and r.status='playing' then perform private.append_room_event(p_room_id,p_user_id,'leave',null); end if;
  update public.room_members set banned=true,connected=false,left_at=now() where room_id=p_room_id and user_id=p_user_id;
  return jsonb_build_object('ok',true);
end;
$fn$;

-- All new public endpoints delegate to private, authenticated guards.
do $grants$
declare name text; signature regprocedure;
begin
  foreach name in array array['configure_room_character','join_room_as','resume_room','send_room_action','sync_room','start_room','exit_room','join_room_checked'] loop
    for signature in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='private' and p.proname=name loop
      execute format('revoke all on function %s from public,anon',signature);
      execute format('grant execute on function %s to authenticated,service_role',signature);
    end loop;
  end loop;
  foreach name in array array['configure_room_character','join_room_as','resume_room','send_room_action','sync_room','start_room'] loop
    for signature in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=name loop
      execute format('revoke all on function %s from public,anon',signature);
      execute format('grant execute on function %s to authenticated,service_role',signature);
    end loop;
  end loop;
end;
$grants$;

-- No peer can broadcast game state, impersonate an actor, or forge chat.
-- Postgres Changes checks row permissions on every notification.
drop policy if exists room_players_send_action on realtime.messages;
drop policy if exists room_members_send_other on realtime.messages;
drop policy if exists room_members_send_presence on realtime.messages;
create policy room_members_send_presence on realtime.messages for insert to authenticated
with check (extension='presence' and exists(select 1 from public.room_members m where m.user_id=auth.uid()
  and not m.banned and m.connected and realtime.topic()='room:'||m.room_id::text));
do $publication$
declare tab text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach tab in array array['room_actions','room_members','chat_messages'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=tab) then
        execute format('alter publication supabase_realtime add table public.%I',tab);
      end if;
    end loop;
  end if;
end;
$publication$;
notify pgrst, 'reload schema';

create index if not exists room_actions_user_id_idx on public.room_actions(user_id);
create index if not exists room_actions_rate_idx on public.room_actions(room_id,user_id,created_at);
create index if not exists room_actions_created_idx on public.room_actions(created_at);

create or replace function private.create_room_as(p_password text,p_is_public boolean,p_max_players integer,p_turn_timer_s integer,p_display_name text,p_character_class text)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare result jsonb;
begin
  if p_character_class is null or p_character_class not in ('Adventurer','Ogre','Wizard','Klingon','Elf','Rogue','Dwarf','Rambo') then
    return jsonb_build_object('ok',false,'error','bad_character');
  end if;
  result:=private.create_room(p_password,p_is_public,p_max_players,p_turn_timer_s,p_display_name);
  if result->>'ok'='true' then
    update public.room_members set character_class=p_character_class where room_id=(result->>'room_id')::uuid and user_id=auth.uid();
  end if;
  return result;
end;
$fn$;
create or replace function public.create_room_as(p_password text,p_is_public boolean,p_max_players integer,p_turn_timer_s integer,p_display_name text,p_character_class text)
returns jsonb language sql security invoker set search_path = '' as $fn$
select private.create_room_as(p_password,p_is_public,p_max_players,p_turn_timer_s,p_display_name,p_character_class); $fn$;
revoke all on function private.create_room_as(text,boolean,integer,integer,text,text),public.create_room_as(text,boolean,integer,integer,text,text) from public,anon;
grant execute on function private.create_room_as(text,boolean,integer,integer,text,text),public.create_room_as(text,boolean,integer,integer,text,text) to authenticated,service_role;

-- Leaving a room also ends direct access to its chat history.
drop policy if exists chat_select_member on public.chat_messages;
create policy chat_select_member on public.chat_messages for select to authenticated using (
  private.is_room_member(room_id) and exists(select 1 from public.room_members m join public.rooms r on r.id=m.room_id
    where m.room_id=chat_messages.room_id and m.user_id=(select auth.uid()) and not m.banned and m.connected
      and (chat_messages.channel='party' or m.role in ('host','spectator') or not r.hide_spectator_chat))
);

create or replace function private.cleanup_online()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  closed_rooms integer;
  dropped_snaps integer;
  dropped_chat integer;
  expired_runs integer;
begin
  update public.rooms
  set status = 'closed'
  where status <> 'closed'
    and last_heartbeat < now() - interval '5 minutes';
  get diagnostics closed_rooms = row_count;
  delete from public.room_snapshots
  where created_at < now() - interval '24 hours';
  get diagnostics dropped_snaps = row_count;
  delete from public.chat_messages
  where created_at < now() - interval '7 days';
  get diagnostics dropped_chat = row_count;
  update public.runs
  set status = 'rejected', reject_reason = 'expired'
  where status = 'started'
    and started_at < now() - interval '7 days';
  get diagnostics expired_runs = row_count;
  delete from public.room_actions a using public.rooms r where r.id=a.room_id and r.status='closed' and a.created_at < now()-interval '7 days';
  delete from private.password_attempts
  where attempted_at < now() - interval '1 day';
  delete from private.chat_events
  where sent_at < now() - interval '1 day';
  delete from private.run_starts
  where started_at < now() - interval '2 days';
  return jsonb_build_object(
    'closed_rooms', closed_rooms,
    'dropped_snapshots', dropped_snaps,
    'dropped_chat', dropped_chat,
    'expired_runs', expired_runs
  );
end;
$fn$;

