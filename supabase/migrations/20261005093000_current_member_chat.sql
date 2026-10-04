-- Chat history is for people still in the room. A member who left keeps their
-- row, but recent_chat no longer returns that history to them.

create or replace function private.recent_chat(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  uid uuid := auth.uid();
  hide_chat boolean;
  viewer text;
begin
  if uid is null or not private.is_room_member(p_room_id) then
    return '[]'::jsonb;
  end if;
  select room.hide_spectator_chat, member.role
    into hide_chat, viewer
  from public.rooms as room
  join public.room_members as member
    on member.room_id = room.id
   and member.user_id = uid
   and member.banned = false
   and member.connected = true
  where room.id = p_room_id;
  if viewer is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(picked.payload order by picked.created_at)
    from (
      select
        jsonb_build_object(
          'id', message.id,
          'channel', message.channel,
          'body', message.body,
          'user_id', message.user_id,
          'name', profile.display_name,
          'created_at', message.created_at
        ) as payload,
        message.created_at
      from public.chat_messages as message
      join public.profiles as profile on profile.user_id = message.user_id
      where message.room_id = p_room_id
        and (
          message.channel = 'party'
          or viewer in ('host', 'spectator')
          or (viewer = 'player' and hide_chat = false)
        )
      order by message.created_at desc
      limit 50
    ) as picked
  ), '[]'::jsonb);
end;
$fn$;
