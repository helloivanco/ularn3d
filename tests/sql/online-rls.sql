-- Fails the session on any unmet check. Applied by tests/online-rls.unit.mjs.
create temp table scenario (
  host_id uuid,
  ally_id uuid,
  watcher_id uuid,
  room_id uuid,
  join_code text,
  run_seed bigint
);

do $test$
declare
  host_id uuid := '11111111-1111-4111-8111-111111111111';
  ally_id uuid := '22222222-2222-4222-8222-222222222222';
  watcher_id uuid := '33333333-3333-4333-8333-333333333333';
  extra_id uuid := '44444444-4444-4444-8444-444444444444';
  result jsonb;
  code text;
  room_id uuid;
  seed bigint;
  i integer;
  fan uuid;
begin
  insert into auth.users (id) values (host_id), (ally_id), (watcher_id), (extra_id);
  perform set_config('request.jwt.claim.sub', host_id::text, true);

  result := public.set_display_name('A');
  if result ->> 'error' is distinct from 'bad_name' then
    raise exception 'short name: %', result;
  end if;
  result := public.set_display_name('ShitHead');
  if result ->> 'error' is distinct from 'filtered' then
    raise exception 'filtered name: %', result;
  end if;
  result := public.set_display_name('Ada');
  if result ->> 'ok' is distinct from 'true' then
    raise exception 'name Ada: %', result;
  end if;

  result := public.create_room('secret', true, 2, 20, null);
  if result ->> 'ok' is distinct from 'true' then
    raise exception 'create room: %', result;
  end if;
  room_id := (result ->> 'room_id')::uuid;
  code := result ->> 'join_code';
  if code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$' then
    raise exception 'bad join code %', code;
  end if;

  perform set_config('request.jwt.claim.sub', ally_id::text, true);
  perform public.set_display_name('Bea');
  for i in 1..5 loop
    result := public.join_room(code, 'nope', 'player', null);
    if result ->> 'error' is distinct from 'bad_password' then
      raise exception 'wrong password %: %', i, result;
    end if;
  end loop;
  result := public.join_room(code, 'secret', 'player', null);
  if result ->> 'error' is distinct from 'rate_limited' then
    raise exception 'password lock: %', result;
  end if;

  delete from private.password_attempts where user_id = ally_id;
  result := public.join_room(code, 'secret', 'player', null);
  if result ->> 'ok' is distinct from 'true' or result ->> 'role' is distinct from 'player' then
    raise exception 'ally join: %', result;
  end if;

  perform set_config('request.jwt.claim.sub', extra_id::text, true);
  perform public.set_display_name('Cid');
  result := public.join_room(code, 'secret', 'player', null);
  if result ->> 'error' is distinct from 'room_full' then
    raise exception 'third player: %', result;
  end if;
  result := public.join_room(code, 'secret', 'spectator', null);
  if result ->> 'ok' is distinct from 'true' or result ->> 'role' is distinct from 'spectator' then
    raise exception 'spectator under the player cap: %', result;
  end if;

  perform set_config('request.jwt.claim.sub', host_id::text, true);
  result := public.kick_member(room_id, extra_id);
  if result ->> 'ok' is distinct from 'true' then
    raise exception 'kick: %', result;
  end if;
  perform set_config('request.jwt.claim.sub', extra_id::text, true);
  result := public.join_room(code, 'secret', 'spectator', null);
  if result ->> 'error' is distinct from 'banned' then
    raise exception 'kicked rejoin: %', result;
  end if;

  for i in 1..21 loop
    fan := ('50000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    insert into auth.users (id) values (fan);
    perform set_config('request.jwt.claim.sub', fan::text, true);
    perform public.set_display_name('Fan' || i);
    result := public.join_room(code, 'secret', 'spectator', null);
    if i <= 20 and result ->> 'ok' is distinct from 'true' then
      raise exception 'spectator %: %', i, result;
    end if;
    if i = 21 and result ->> 'error' is distinct from 'spectator_full' then
      raise exception 'spectator cap: %', result;
    end if;
  end loop;

  perform set_config('request.jwt.claim.sub', host_id::text, true);
  for i in 1..5 loop
    result := public.post_chat(room_id, 'party', 'Ready ' || i);
    if result ->> 'ok' is distinct from 'true' then
      raise exception 'chat %: %', i, result;
    end if;
  end loop;
  result := public.post_chat(room_id, 'party', 'too fast');
  if result ->> 'error' is distinct from 'rate_limited' then
    raise exception 'chat burst: %', result;
  end if;
  result := public.post_chat(room_id, 'party', 'this is shit');
  if result ->> 'error' is distinct from 'filtered' then
    raise exception 'chat filter: %', result;
  end if;

  result := public.browse_rooms();
  if result::text ilike '%password_hash%' or result::text ilike '%secret%' then
    raise exception 'browse leaked a secret: %', result;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(result) as row
    where row ->> 'join_code' = code and (row ->> 'locked')::boolean
  ) then
    raise exception 'browse missed the locked room: %', result;
  end if;

  result := public.start_run('coop', room_id, '1.3.33');
  if result ->> 'ok' is distinct from 'true' then
    raise exception 'start run: %', result;
  end if;
  seed := (result ->> 'seed')::bigint;
  result := public.start_run('coop', room_id, '1.3.33');
  if (result ->> 'seed')::bigint is distinct from seed then
    raise exception 'room seed changed: % then %', seed, result;
  end if;
  perform set_config('request.jwt.claim.sub', ally_id::text, true);
  result := public.start_run('coop', room_id, '1.3.33');
  if result ->> 'error' is distinct from 'not_host' then
    raise exception 'non-host start: %', result;
  end if;

  perform set_config('request.jwt.claim.sub', host_id::text, true);
  result := public.transfer_host(room_id, ally_id);
  if result ->> 'ok' is distinct from 'true' then
    raise exception 'transfer: %', result;
  end if;
  result := public.touch_room(room_id, 3);
  if result ->> 'error' is distinct from 'not_host' then
    raise exception 'old host heartbeat: %', result;
  end if;
  perform set_config('request.jwt.claim.sub', ally_id::text, true);
  result := public.touch_room(room_id, 3);
  if result ->> 'ok' is distinct from 'true' then
    raise exception 'new host heartbeat: %', result;
  end if;

  insert into scenario (host_id, ally_id, watcher_id, room_id, join_code, run_seed)
  values (host_id, ally_id, watcher_id, room_id, code, seed);
end
$test$;

do $rls$
declare
  room_id uuid;
  host_id uuid;
  ally_id uuid;
  seen integer;
begin
  select scenario.room_id, scenario.host_id, scenario.ally_id
  into room_id, host_id, ally_id
  from scenario;

  perform set_config('request.jwt.claim.sub', ally_id::text, true);
  set local role authenticated;
  select count(*) into seen from public.rooms;
  if seen <> 1 then
    raise exception 'host should see 1 room, saw %', seen;
  end if;
  select count(*) into seen from public.room_members;
  if seen < 2 then
    raise exception 'host should see members, saw %', seen;
  end if;
  begin
    execute 'select password_hash from public.rooms';
    raise exception 'password hash was readable';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    execute 'select * from private.password_attempts';
    raise exception 'rate-limit table was readable';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    execute format(
      'insert into public.runs (user_id, mode, party_size, seed, engine_version) values (%L, ''solo'', 1, 1, ''1.3.33'')',
      ally_id
    );
    raise exception 'client inserted a run';
  exception
    when insufficient_privilege then
      null;
  end;
  execute format(
    'insert into public.room_snapshots (room_id, turn, checksum, state_compressed) values (%L, 1, ''abc'', ''xyz'')',
    room_id
  );

  reset role;
  perform set_config('request.jwt.claim.sub', host_id::text, true);
  set local role authenticated;
  begin
    execute format(
      'insert into public.room_snapshots (room_id, turn, checksum, state_compressed) values (%L, 2, ''abc'', ''xyz'')',
      room_id
    );
    raise exception 'player inserted a snapshot';
  exception
    when insufficient_privilege then
      null;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
  insert into auth.users (id) values ('99999999-9999-4999-8999-999999999999');
  set local role authenticated;
  select count(*) into seen from public.rooms;
  if seen <> 0 then
    raise exception 'stranger saw % rooms', seen;
  end if;
  select count(*) into seen from public.chat_messages;
  if seen <> 0 then
    raise exception 'stranger saw % chat rows', seen;
  end if;
end
$rls$;

do $channel$
declare
  room_id uuid;
  host_id uuid;
  ally_id uuid;
  watcher uuid := '50000000-0000-4000-8000-000000000001';
  seen integer;
begin
  select scenario.room_id, scenario.host_id, scenario.ally_id
  into room_id, host_id, ally_id
  from scenario;
  insert into realtime.messages (topic, extension, event, payload)
  values ('room:' || room_id::text, 'broadcast', 'state', '{"turn":1}'::jsonb);

  perform set_config('request.jwt.claim.sub', ally_id::text, true);
  perform set_config('realtime.topic', 'room:' || room_id::text, true);
  set local role authenticated;
  execute format(
    'insert into realtime.messages (topic, extension, event, payload) values (%L, ''broadcast'', ''action'', ''{}''::jsonb)',
    'room:' || room_id::text
  );

  reset role;
  perform set_config('request.jwt.claim.sub', watcher::text, true);
  perform set_config('realtime.topic', 'room:' || room_id::text, true);
  set local role authenticated;
  begin
    execute format(
      'insert into realtime.messages (topic, extension, event, payload) values (%L, ''broadcast'', ''action'', ''{}''::jsonb)',
      'room:' || room_id::text
    );
    raise exception 'spectator sent an action';
  exception
    when insufficient_privilege then
      null;
  end;
  execute format(
    'insert into realtime.messages (topic, extension, event, payload) values (%L, ''presence'', ''sync'', ''{}''::jsonb)',
    'room:' || room_id::text
  );

  reset role;
  perform set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
  perform set_config('realtime.topic', 'room:' || room_id::text, true);
  set local role authenticated;
  select count(*) into seen from realtime.messages;
  if seen <> 0 then
    raise exception 'stranger read % realtime rows', seen;
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', host_id::text, true);
  perform set_config('realtime.topic', 'room:' || room_id::text, true);
  set local role authenticated;
  select count(*) into seen from realtime.messages;
  if seen < 1 then
    raise exception 'host could not read the room channel';
  end if;
end
$channel$;

do $cleanup$
declare
  rid uuid;
  hid uuid;
  result jsonb;
  room_status text;
begin
  select scenario.room_id, scenario.host_id into rid, hid from scenario;
  update public.rooms as room set last_heartbeat = now() - interval '6 minutes' where room.id = rid;
  update public.room_snapshots as snap set created_at = now() - interval '25 hours' where snap.room_id = rid;
  update public.chat_messages as message set created_at = now() - interval '8 days' where message.room_id = rid;
  update public.runs as run set started_at = now() - interval '8 days' where run.user_id = hid;
  result := public.cleanup_online();
  if (result ->> 'closed_rooms')::int < 1
     or (result ->> 'dropped_snapshots')::int < 1
     or (result ->> 'dropped_chat')::int < 1
     or (result ->> 'expired_runs')::int < 1 then
    raise exception 'cleanup: %', result;
  end if;
  select room.status into room_status from public.rooms as room where room.id = rid;
  if room_status is distinct from 'closed' then
    raise exception 'room status %', room_status;
  end if;
end
$cleanup$;

do $grant$
declare
  result jsonb;
begin
  insert into auth.users (id) values ('88888888-8888-4888-8888-888888888888');
  perform set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888888', true);
  set local role authenticated;
  result := public.set_display_name('Eve');
  if result ->> 'ok' is distinct from 'true' then
    raise exception 'authenticated rpc: %', result;
  end if;
  begin
    perform public.cleanup_online();
    raise exception 'authenticated called cleanup';
  exception
    when insufficient_privilege then
      null;
  end;
end
$grant$;

select 'online rls ok';
