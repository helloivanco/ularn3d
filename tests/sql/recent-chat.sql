-- Joining a room can read the latest 50 messages and no more.

do $history$
declare
  host_id uuid := '12121212-1212-4212-8212-121212121212';
  other_id uuid := '13131313-1313-4313-8313-131313131313';
  result jsonb;
  code text;
  rid uuid;
  i integer;
begin
  insert into auth.users (id) values (host_id), (other_id);
  perform set_config('request.jwt.claim.sub', host_id::text, true);
  result := public.set_display_name('Ada');
  if result ->> 'ok' is distinct from 'true' then
    raise exception 'history name: %', result;
  end if;
  result := public.create_room(null, false, 2, 20, null);
  if result ->> 'ok' is distinct from 'true' then
    raise exception 'history room: %', result;
  end if;
  code := result ->> 'join_code';
  rid := (result ->> 'room_id')::uuid;

  for i in 0..54 loop
    insert into public.chat_messages (room_id, user_id, channel, body, created_at)
    values (rid, host_id, 'party', 'm' || lpad(i::text, 3, '0'), now() + make_interval(secs => i));
  end loop;

  result := public.recent_chat(rid);
  if jsonb_array_length(result) <> 50 then
    raise exception 'expected 50 messages, got %', result;
  end if;
  if result->0->>'body' is distinct from 'm005' or result->49->>'body' is distinct from 'm054' then
    raise exception 'history window: % .. %', result->0->>'body', result->49->>'body';
  end if;
  if result->49->>'name' is distinct from 'Ada' then
    raise exception 'history name missing: %', result->49;
  end if;

  perform set_config('request.jwt.claim.sub', other_id::text, true);
  result := public.set_display_name('Bea');
  result := public.recent_chat(rid);
  if result <> '[]'::jsonb then
    raise exception 'stranger read chat: %', result;
  end if;

  result := public.join_room(code, null, 'player', null);
  if result ->> 'ok' is distinct from 'true' then
    raise exception 'history join: %', result;
  end if;
  result := public.recent_chat(rid);
  if jsonb_array_length(result) <> 50 then
    raise exception 'member history: %', jsonb_array_length(result);
  end if;

  result := public.leave_room(rid);
  if result ->> 'ok' is distinct from 'true' then
    raise exception 'history leave: %', result;
  end if;
  result := public.recent_chat(rid);
  if result <> '[]'::jsonb then
    raise exception 'left member still read chat: %', result;
  end if;
end
$history$;

select 'recent chat ok';
