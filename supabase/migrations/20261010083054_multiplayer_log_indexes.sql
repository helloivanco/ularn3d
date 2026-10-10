-- Index new foreign keys and evaluate identity once per realtime policy check.
create index if not exists rooms_run_id_idx on public.rooms(run_id);
drop policy if exists room_members_send_presence on realtime.messages;
create policy room_members_send_presence on realtime.messages for insert to authenticated
with check(extension='presence' and exists(select 1 from public.room_members m
  where m.user_id=(select auth.uid()) and m.connected and not m.banned and (select realtime.topic())='room:'||m.room_id::text));

-- The old start_run endpoint remains protocol one during the frontend rollout.
-- Protocol two uses start_room and ignores all peer broadcasts.
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
      game_config=jsonb_build_object('version',1,'difficulty',0,'players',players) where id=p_room_id;
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
    update public.rooms set game_config=jsonb_set(jsonb_set(game_config,'{version}','2'::jsonb),'{difficulty}',to_jsonb(p_difficulty)) where id=p_room_id;
  end if;
  return result;
end;
$fn$;


drop policy if exists room_legacy_send on realtime.messages;
create policy room_legacy_send on realtime.messages for insert to authenticated with check (
  extension in ('broadcast','presence') and exists(select 1 from public.room_members m join public.rooms r on r.id=m.room_id
    where m.user_id=(select auth.uid()) and m.connected and not m.banned
      and coalesce((r.game_config->>'version')::integer,1)=1
      and (select realtime.topic())='room:'||m.room_id::text)
);
notify pgrst, 'reload schema';
