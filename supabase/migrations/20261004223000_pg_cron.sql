-- Enable pg_cron and keep the cleanup job. Also return the last 50 chat lines on join.

create extension if not exists pg_cron;

do $cron$
declare
  existing bigint;
begin
  select job.jobid into existing
  from cron.job as job
  where job.jobname = 'ularn-online-cleanup';
  if existing is not null then
    perform cron.unschedule(existing);
  end if;
  perform cron.schedule(
    'ularn-online-cleanup',
    '*/5 * * * *',
    'select public.cleanup_online()'
  );
end
$cron$;

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
    on member.room_id = room.id and member.user_id = uid and member.banned = false
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

create or replace function public.recent_chat(p_room_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $fn$
  select private.recent_chat(p_room_id);
$fn$;

revoke all on function public.recent_chat(uuid) from public, anon;
revoke all on function private.recent_chat(uuid) from public, anon;
grant execute on function public.recent_chat(uuid) to authenticated, service_role;
grant execute on function private.recent_chat(uuid) to authenticated, service_role;
