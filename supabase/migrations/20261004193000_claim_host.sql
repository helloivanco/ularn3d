-- Host migration and spectator-chat visibility. Additive.

create or replace function private.claim_host(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := auth.uid();
  host_seen timestamptz;
  heir uuid;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  select member.last_seen into host_seen
  from public.room_members as member
  where member.room_id = p_room_id and member.role = 'host' and member.banned = false;
  if host_seen is null then
    return jsonb_build_object('ok', false, 'error', 'room_not_found');
  end if;
  if host_seen > now() - interval '15 seconds' then
    return jsonb_build_object('ok', false, 'error', 'host_present');
  end if;
  select member.user_id into heir
  from public.room_members as member
  where member.room_id = p_room_id
    and member.banned = false
    and member.role = 'player'
    and member.connected = true
  order by member.joined_at asc
  limit 1;
  if heir is null or heir is distinct from uid then
    return jsonb_build_object('ok', false, 'error', 'not_heir');
  end if;
  update public.room_members set role = 'player'
  where room_id = p_room_id and role = 'host';
  update public.room_members set role = 'host', last_seen = now(), connected = true
  where room_id = p_room_id and user_id = heir;
  update public.rooms set host_user_id = heir, last_heartbeat = now()
  where id = p_room_id;
  return jsonb_build_object('ok', true, 'host_user_id', heir);
end;
$fn$;

create or replace function private.set_hide_spectator_chat(p_room_id uuid, p_hide boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  if not exists (
    select 1 from public.room_members as member
    where member.room_id = p_room_id and member.user_id = uid and member.role = 'host' and member.banned = false
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_host');
  end if;
  update public.rooms set hide_spectator_chat = coalesce(p_hide, false) where id = p_room_id;
  return jsonb_build_object('ok', true, 'hide_spectator_chat', coalesce(p_hide, false));
end;
$fn$;

create or replace function public.claim_host(p_room_id uuid)
returns jsonb language sql volatile security invoker set search_path = ''
as $fn$ select private.claim_host(p_room_id); $fn$;

create or replace function public.set_hide_spectator_chat(p_room_id uuid, p_hide boolean)
returns jsonb language sql volatile security invoker set search_path = ''
as $fn$ select private.set_hide_spectator_chat(p_room_id, p_hide); $fn$;

revoke all on function public.claim_host(uuid) from public, anon;
revoke all on function public.set_hide_spectator_chat(uuid, boolean) from public, anon;
grant execute on function public.claim_host(uuid) to authenticated, service_role;
grant execute on function public.set_hide_spectator_chat(uuid, boolean) to authenticated, service_role;
grant execute on function private.claim_host(uuid) to authenticated, service_role;
grant execute on function private.set_hide_spectator_chat(uuid, boolean) to authenticated, service_role;
revoke all on function private.claim_host(uuid) from public;
revoke all on function private.set_hide_spectator_chat(uuid, boolean) from public;

-- A dropped player keeps the same character for 120 seconds. After that the
-- seat is removed and the next join is a fresh character at the town entrance.
create or replace function private.expire_rejoin(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := auth.uid();
  rid uuid;
begin
  if uid is null then
    return;
  end if;
  select id into rid
  from public.rooms
  where join_code = upper(btrim(coalesce(p_code, '')));
  if rid is null then
    return;
  end if;
  delete from public.room_members
  where room_id = rid
    and user_id = uid
    and role <> 'host'
    and banned = false
    and left_at is not null
    and left_at < now() - interval '120 seconds';
end;
$fn$;

create or replace function public.join_room(
  p_code text,
  p_password text default null,
  p_role text default 'player',
  p_character_name text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
begin
  perform private.expire_rejoin(p_code);
  return private.join_room(p_code, p_password, p_role, p_character_name);
end;
$fn$;

create or replace function private.set_ready(p_room_id uuid, p_ready boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  update public.room_members
  set ready = coalesce(p_ready, false), last_seen = now(), connected = true
  where room_id = p_room_id and user_id = uid and banned = false;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_member');
  end if;
  return jsonb_build_object('ok', true, 'ready', coalesce(p_ready, false));
end;
$fn$;

create or replace function public.set_ready(p_room_id uuid, p_ready boolean)
returns jsonb language sql volatile security invoker set search_path = ''
as $fn$ select private.set_ready(p_room_id, p_ready); $fn$;

revoke all on function public.join_room(text, text, text, text) from public, anon;
revoke all on function public.set_ready(uuid, boolean) from public, anon;
revoke all on function private.expire_rejoin(text) from public, anon;
revoke all on function private.set_ready(uuid, boolean) from public, anon;
grant execute on function public.join_room(text, text, text, text) to authenticated, service_role;
grant execute on function public.set_ready(uuid, boolean) to authenticated, service_role;
grant execute on function private.expire_rejoin(text) to authenticated, service_role;
grant execute on function private.set_ready(uuid, boolean) to authenticated, service_role;
