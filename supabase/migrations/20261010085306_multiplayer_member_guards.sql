-- Only current, connected members may chat or manage the room.
create or replace function private.post_chat(p_room_id uuid, p_channel text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := auth.uid();
  member public.room_members;
  which text := lower(coalesce(p_channel, ''));
  text_body text := btrim(coalesce(p_body, ''));
  recent integer;
  message_id uuid;
begin
  if not private.is_room_member(p_room_id) then return jsonb_build_object('ok',false,'error','not_member'); end if;
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  if which not in ('party', 'spectators') then
    return jsonb_build_object('ok', false, 'error', 'bad_channel');
  end if;
  if char_length(text_body) < 1 or char_length(text_body) > 280 then
    return jsonb_build_object('ok', false, 'error', 'bad_body');
  end if;
  if private.contains_blocked(text_body) then
    return jsonb_build_object('ok', false, 'error', 'filtered');
  end if;
  select * into member
  from public.room_members
  where room_id = p_room_id and user_id = uid and banned = false and connected = true;
  if member.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_member');
  end if;
  if which = 'party' and member.role = 'spectator' then
    return jsonb_build_object('ok', false, 'error', 'bad_channel');
  end if;
  if which = 'spectators' and member.role = 'player' then
    return jsonb_build_object('ok', false, 'error', 'bad_channel');
  end if;
  select count(*) into recent
  from private.chat_events
  where user_id = uid and sent_at > now() - interval '5 seconds';
  if recent >= 5 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  insert into private.chat_events (user_id) values (uid);
  insert into public.chat_messages (room_id, user_id, channel, body)
  values (p_room_id, uid, which, text_body)
  returning id into message_id;
  return jsonb_build_object('ok', true, 'id', message_id);
end;
$fn$;

create or replace function private.transfer_host(p_room_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := auth.uid();
begin
  if not private.is_room_member(p_room_id) then return jsonb_build_object('ok',false,'error','not_host'); end if;
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  if p_user_id is null or p_user_id = uid then
    return jsonb_build_object('ok', false, 'error', 'bad_target');
  end if;
  if not exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = uid and role = 'host' and banned = false
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_host');
  end if;
  if not exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = p_user_id and role = 'player' and banned = false and connected = true and not exists(select 1 from public.profiles p where p.user_id=p_user_id and p.banned)
  ) then
    return jsonb_build_object('ok', false, 'error', 'bad_target');
  end if;
  update public.room_members set role = 'player'
  where room_id = p_room_id and user_id = uid;
  update public.room_members set role = 'host'
  where room_id = p_room_id and user_id = p_user_id;
  update public.rooms set host_user_id = p_user_id where id = p_room_id;
  return jsonb_build_object('ok', true, 'host_user_id', p_user_id);
end;
$fn$;

notify pgrst, 'reload schema';
