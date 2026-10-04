-- Online rooms, profiles, chat, and server-issued runs.
-- Additive only. Privileged logic stays in schema private, which is not
-- part of the Data API (see supabase/config.toml). password_hash is never
-- granted. Apply on the hosted project only after review.

create schema if not exists extensions;
do $ext$
begin
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    create extension pgcrypto schema extensions;
  end if;
end
$ext$;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$roles$;

create schema if not exists private;
comment on schema private is 'Not exposed through the Data API. Do not add private to api.schemas.';
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  banned boolean not null default false,
  created_at timestamptz not null default now(),
  constraint profiles_name_length check (char_length(display_name) between 3 and 16)
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  join_code text not null,
  host_user_id uuid not null references public.profiles (user_id),
  password_hash text,
  is_public boolean not null default true,
  max_players integer not null default 4,
  turn_timer_s integer,
  status text not null default 'lobby',
  seed bigint,
  version text,
  depth integer not null default 0,
  hide_spectator_chat boolean not null default false,
  created_at timestamptz not null default now(),
  last_heartbeat timestamptz not null default now(),
  constraint rooms_join_code_shape check (join_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
  constraint rooms_max_players_range check (max_players between 2 and 4),
  constraint rooms_timer_range check (turn_timer_s is null or turn_timer_s between 10 and 60),
  constraint rooms_status_known check (status in ('lobby', 'playing', 'closed')),
  constraint rooms_depth_nonnegative check (depth >= 0)
);

create unique index if not exists rooms_join_code_key on public.rooms (join_code);
create index if not exists rooms_host_user_id_idx on public.rooms (host_user_id);
create index if not exists rooms_public_browse_idx on public.rooms (status, created_at desc) where is_public;

create table if not exists public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  role text not null,
  slot integer,
  character_name text,
  ready boolean not null default false,
  connected boolean not null default true,
  banned boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  left_at timestamptz,
  primary key (room_id, user_id),
  constraint room_members_role_known check (role in ('host', 'player', 'spectator')),
  constraint room_members_slot_range check (slot is null or slot between 0 and 3)
);

create unique index if not exists room_members_one_host_idx
  on public.room_members (room_id) where role = 'host';
create unique index if not exists room_members_slot_idx
  on public.room_members (room_id, slot) where slot is not null and banned = false;
create index if not exists room_members_user_id_idx on public.room_members (user_id);

create table if not exists public.room_snapshots (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  turn integer not null,
  checksum text not null,
  state_compressed text not null,
  created_at timestamptz not null default now(),
  constraint room_snapshots_turn_nonnegative check (turn >= 0),
  constraint room_snapshots_size check (char_length(state_compressed) <= 500000)
);

create index if not exists room_snapshots_room_created_idx
  on public.room_snapshots (room_id, created_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id),
  channel text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint chat_messages_channel_known check (channel in ('party', 'spectators')),
  constraint chat_messages_body_length check (char_length(body) between 1 and 280)
);

create index if not exists chat_messages_room_created_idx
  on public.chat_messages (room_id, created_at desc);
create index if not exists chat_messages_user_id_idx on public.chat_messages (user_id);

-- Runs are created here because start_run and the 7-day expiry live with the
-- other security definer RPCs. Scores stay out until the verifier lands.
create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id),
  mode text not null,
  party_size integer not null default 1,
  room_id uuid references public.rooms (id),
  seed bigint not null,
  engine_version text not null,
  started_at timestamptz not null default now(),
  status text not null default 'started',
  input_hash text,
  reject_reason text,
  constraint runs_mode_known check (mode in ('solo', 'coop')),
  constraint runs_party_size_range check (party_size between 1 and 4),
  constraint runs_status_known check (status in ('started', 'submitted', 'verified', 'rejected'))
);

create index if not exists runs_user_id_idx on public.runs (user_id);
create index if not exists runs_room_id_idx on public.runs (room_id);
create index if not exists runs_started_idx on public.runs (started_at) where status = 'started';

create table if not exists private.password_attempts (
  user_id uuid not null,
  room_id uuid not null,
  attempted_at timestamptz not null default now()
);
create index if not exists password_attempts_lookup_idx
  on private.password_attempts (user_id, room_id, attempted_at desc);

create table if not exists private.chat_events (
  user_id uuid not null,
  sent_at timestamptz not null default now()
);
create index if not exists chat_events_user_idx
  on private.chat_events (user_id, sent_at desc);

create table if not exists private.run_starts (
  user_id uuid not null,
  ip text not null default '',
  started_at timestamptz not null default now()
);
create index if not exists run_starts_user_idx on private.run_starts (user_id, started_at desc);
create index if not exists run_starts_ip_idx on private.run_starts (ip, started_at desc);

alter table private.password_attempts enable row level security;
alter table private.chat_events enable row level security;
alter table private.run_starts enable row level security;
revoke all on private.password_attempts, private.chat_events, private.run_starts from public, anon, authenticated;

create or replace function private.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.room_members as member
    where member.room_id = p_room_id
      and member.user_id = (select auth.uid())
      and member.banned = false
  );
$fn$;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_snapshots enable row level security;
alter table public.chat_messages enable row level security;
alter table public.runs enable row level security;

revoke all on public.profiles, public.rooms, public.room_members, public.room_snapshots, public.chat_messages, public.runs from public, anon, authenticated;

grant select on public.profiles to authenticated;
grant select (
  id, join_code, host_user_id, is_public, max_players, turn_timer_s, status,
  seed, version, depth, hide_spectator_chat, created_at, last_heartbeat
) on public.rooms to authenticated;
grant select on public.room_members to authenticated;
grant select on public.room_snapshots to authenticated;
grant insert (
  room_id, turn, checksum, state_compressed
) on public.room_snapshots to authenticated;
grant select on public.chat_messages to authenticated;
grant select on public.runs to authenticated;

grant all on public.profiles, public.rooms, public.room_members, public.room_snapshots, public.chat_messages, public.runs to service_role;

drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated
  on public.profiles
  for select
  to authenticated
  using (true);

drop policy if exists rooms_select_member on public.rooms;
create policy rooms_select_member
  on public.rooms
  for select
  to authenticated
  using (private.is_room_member(id));

drop policy if exists room_members_select_member on public.room_members;
create policy room_members_select_member
  on public.room_members
  for select
  to authenticated
  using (private.is_room_member(room_id));

drop policy if exists room_snapshots_select_member on public.room_snapshots;
create policy room_snapshots_select_member
  on public.room_snapshots
  for select
  to authenticated
  using (private.is_room_member(room_id));

drop policy if exists room_snapshots_insert_host on public.room_snapshots;
create policy room_snapshots_insert_host
  on public.room_snapshots
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.room_members as member
      where member.room_id = room_snapshots.room_id
        and member.user_id = (select auth.uid())
        and member.role = 'host'
        and member.banned = false
    )
  );

drop policy if exists chat_select_member on public.chat_messages;
create policy chat_select_member
  on public.chat_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.room_members as member
      join public.rooms as room on room.id = member.room_id
      where member.room_id = chat_messages.room_id
        and member.user_id = (select auth.uid())
        and member.banned = false
        and (
          chat_messages.channel = 'party'
          or member.role in ('host', 'spectator')
          or (member.role = 'player' and room.hide_spectator_chat = false)
        )
    )
  );

drop policy if exists runs_select_own on public.runs;
create policy runs_select_own
  on public.runs
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create or replace function private.fold_text(input text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select regexp_replace(
translate(lower(coalesce(input, '')), '013457@$', 'oieastas'),
    '[^a-z]',
    '',
    'g'
  );
$fn$;

create or replace function private.contains_blocked(input text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  folded text := private.fold_text(input);
  word text;
  blocked constant text[] := array[
    'fuck', 'shit', 'cunt', 'bitch', 'asshole', 'nigger', 'nigga', 'faggot',
    'retard', 'slut', 'whore', 'rape', 'porn', 'nazi'
  ];
begin
  foreach word in array blocked loop
    if position(word in folded) > 0 then
      return true;
    end if;
  end loop;
  return false;
end;
$fn$;

create or replace function private.name_error(input text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  trimmed text := btrim(coalesce(input, ''));
begin
  if trimmed !~ '^[A-Za-z0-9][A-Za-z0-9 ''-]{1,14}[A-Za-z0-9]$' then
    return 'bad_name';
  end if;
  if private.contains_blocked(trimmed) then
    return 'filtered';
  end if;
  return '';
end;
$fn$;

create or replace function private.random_code(len integer)
returns text
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  drawn bytea := extensions.gen_random_bytes(len);
  out text := '';
  i integer;
begin
  for i in 0..len - 1 loop
    out := out || substr(alphabet, 1 + (get_byte(drawn, i) % length(alphabet)), 1);
  end loop;
  return out;
end;
$fn$;

create or replace function private.random_seed()
returns bigint
language sql
volatile
set search_path = ''
as $fn$
  select (
get_byte(drawn.b, 0)::bigint * 16777216
    + get_byte(drawn.b, 1)::bigint * 65536
    + get_byte(drawn.b, 2)::bigint * 256
    + get_byte(drawn.b, 3)::bigint
  )
  from (select extensions.gen_random_bytes(4) as b) as drawn;
$fn$;

create or replace function private.client_ip()
returns text
language sql
stable
set search_path = ''
as $fn$
  select split_part(
coalesce(
      nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for',
      ''
    ),
    ',',
    1
  );
$fn$;

create or replace function private.set_display_name(p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := auth.uid();
  trimmed text := btrim(coalesce(p_display_name, ''));
  problem text;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  problem := private.name_error(trimmed);
  if problem <> '' then
    return jsonb_build_object('ok', false, 'error', problem);
  end if;
  if exists (select 1 from public.profiles where user_id = uid and banned) then
    return jsonb_build_object('ok', false, 'error', 'banned');
  end if;
  insert into public.profiles (user_id, display_name)
  values (uid, trimmed)
  on conflict (user_id) do update set display_name = excluded.display_name;
  return jsonb_build_object('ok', true, 'display_name', trimmed);
end;
$fn$;

create or replace function private.create_room(
  p_password text,
  p_is_public boolean,
  p_max_players integer,
  p_turn_timer_s integer,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := auth.uid();
  named jsonb;
  players integer := coalesce(p_max_players, 4);
  timer integer := p_turn_timer_s;
  code text;
  room_id uuid;
  tries integer := 0;
  hash text;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  if p_display_name is not null then
    named := private.set_display_name(p_display_name);
    if named ->> 'ok' <> 'true' then
      return named;
    end if;
  end if;
  if not exists (select 1 from public.profiles where user_id = uid and banned = false) then
    return jsonb_build_object('ok', false, 'error', 'name_required');
  end if;
  if players < 2 or players > 4 then
    return jsonb_build_object('ok', false, 'error', 'bad_max_players');
  end if;
  if timer is null then
    timer := 20;
  elsif timer = 0 then
    timer := null;
  elsif timer < 10 or timer > 60 then
    return jsonb_build_object('ok', false, 'error', 'bad_timer');
  end if;
  if p_password is null or btrim(p_password) = '' then
    hash := null;
  else
    hash := extensions.crypt(p_password, extensions.gen_salt('bf', 8));
  end if;
  loop
    tries := tries + 1;
    if tries > 8 then
      return jsonb_build_object('ok', false, 'error', 'code_exhausted');
    end if;
    code := private.random_code(6);
    exit when not exists (select 1 from public.rooms where join_code = code);
  end loop;
  insert into public.rooms (
    join_code, host_user_id, password_hash, is_public, max_players, turn_timer_s
  ) values (
    code, uid, hash, coalesce(p_is_public, true), players, timer
  ) returning id into room_id;
  insert into public.room_members (room_id, user_id, role, slot, character_name)
  select room_id, uid, 'host', 0, display_name
  from public.profiles
  where user_id = uid;
  return jsonb_build_object('ok', true, 'room_id', room_id, 'join_code', code);
end;
$fn$;

create or replace function private.join_room(
  p_code text,
  p_password text,
  p_role text,
  p_character_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := auth.uid();
  room public.rooms;
  member public.room_members;
  wanted text := lower(coalesce(p_role, 'player'));
  players integer;
  watchers integer;
  slot integer;
  cname text;
  problem text;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  if not exists (select 1 from public.profiles where user_id = uid and banned = false) then
    return jsonb_build_object('ok', false, 'error', 'name_required');
  end if;
  if wanted not in ('player', 'spectator') then
    return jsonb_build_object('ok', false, 'error', 'bad_role');
  end if;
  select * into room
  from public.rooms
  where join_code = upper(btrim(coalesce(p_code, '')));
  if room.id is null or room.status = 'closed' then
    return jsonb_build_object('ok', false, 'error', 'room_not_found');
  end if;
  select * into member
  from public.room_members
  where room_id = room.id and user_id = uid;
  if member.user_id is not null and member.banned then
    return jsonb_build_object('ok', false, 'error', 'banned');
  end if;
  if room.password_hash is not null then
    if (
      select count(*)
      from private.password_attempts
      where user_id = uid
        and room_id = room.id
        and attempted_at > now() - interval '10 minutes'
    ) >= 5 then
      return jsonb_build_object('ok', false, 'error', 'rate_limited');
    end if;
    if room.password_hash is distinct from extensions.crypt(coalesce(p_password, ''), room.password_hash) then
      insert into private.password_attempts (user_id, room_id) values (uid, room.id);
      return jsonb_build_object('ok', false, 'error', 'bad_password');
    end if;
  end if;
  if member.user_id is not null then
    update public.room_members
    set connected = true, left_at = null, last_seen = now()
    where room_id = room.id and user_id = uid;
    return jsonb_build_object(
      'ok', true,
      'room_id', room.id,
      'role', member.role,
      'slot', member.slot,
      'resumed', true
    );
  end if;
  if wanted = 'player' then
    select count(*) into players
    from public.room_members as seated
    where seated.room_id = room.id and seated.banned = false and seated.role in ('host', 'player');
    if players >= room.max_players then
      return jsonb_build_object('ok', false, 'error', 'room_full');
    end if;
    select series into slot
    from generate_series(0, 3) as series
    where not exists (
      select 1 from public.room_members existing
      where existing.room_id = room.id
        and existing.slot = series
        and existing.banned = false
    )
    order by series
    limit 1;
    if slot is null then
      return jsonb_build_object('ok', false, 'error', 'room_full');
    end if;
  else
    select count(*) into watchers
    from public.room_members as seated
    where seated.room_id = room.id and seated.banned = false and seated.role = 'spectator';
    if watchers >= 20 then
      return jsonb_build_object('ok', false, 'error', 'spectator_full');
    end if;
    slot := null;
  end if;
  cname := btrim(coalesce(p_character_name, ''));
  if cname = '' then
    select display_name into cname from public.profiles where user_id = uid;
  else
    problem := private.name_error(cname);
    if problem <> '' then
      return jsonb_build_object('ok', false, 'error', problem);
    end if;
  end if;
  insert into public.room_members (room_id, user_id, role, slot, character_name)
  values (room.id, uid, wanted, slot, cname);
  return jsonb_build_object(
    'ok', true, 'room_id', room.id, 'role', wanted, 'slot', slot, 'resumed', false
  );
end;
$fn$;

create or replace function private.leave_room(p_room_id uuid)
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
  set connected = false, left_at = now(), last_seen = now()
  where room_id = p_room_id and user_id = uid and banned = false;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_member');
  end if;
  return jsonb_build_object('ok', true);
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
    where room_id = p_room_id and user_id = p_user_id and role = 'player' and banned = false
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

create or replace function private.kick_member(p_room_id uuid, p_user_id uuid)
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
    select 1 from public.room_members
    where room_id = p_room_id and user_id = uid and role = 'host' and banned = false
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_host');
  end if;
  if p_user_id is null or p_user_id = uid then
    return jsonb_build_object('ok', false, 'error', 'bad_target');
  end if;
  update public.room_members
  set banned = true, connected = false, left_at = now()
  where room_id = p_room_id and user_id = p_user_id and banned = false;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_member');
  end if;
  return jsonb_build_object('ok', true);
end;
$fn$;

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

create or replace function private.start_run(
  p_mode text,
  p_room_id uuid,
  p_engine_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := auth.uid();
  chosen text := lower(coalesce(p_mode, ''));
  engine text := btrim(coalesce(p_engine_version, ''));
  client text := private.client_ip();
  drawn bigint;
  run_id uuid;
  party integer := 1;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  if exists (select 1 from public.profiles where user_id = uid and banned) then
    return jsonb_build_object('ok', false, 'error', 'banned');
  end if;
  if not exists (select 1 from public.profiles where user_id = uid) then
    return jsonb_build_object('ok', false, 'error', 'name_required');
  end if;
  if chosen not in ('solo', 'coop') then
    return jsonb_build_object('ok', false, 'error', 'bad_mode');
  end if;
  if char_length(engine) < 1 or char_length(engine) > 32 then
    return jsonb_build_object('ok', false, 'error', 'bad_version');
  end if;
  if (
    select count(*) from private.run_starts
    where user_id = uid and started_at > now() - interval '1 hour'
  ) >= 20 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if client <> '' and (
    select count(*) from private.run_starts as started
    where started.ip = client and started.started_at > now() - interval '1 hour'
  ) >= 40 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if chosen = 'coop' then
    if p_room_id is null or not exists (
      select 1 from public.room_members
      where room_id = p_room_id and user_id = uid and role = 'host' and banned = false
    ) then
      return jsonb_build_object('ok', false, 'error', 'not_host');
    end if;
    if exists (select 1 from public.rooms where id = p_room_id and status = 'closed') then
      return jsonb_build_object('ok', false, 'error', 'room_not_found');
    end if;
    select count(*) into party
    from public.room_members as seated
    where seated.room_id = p_room_id and seated.banned = false and seated.role in ('host', 'player');
  elsif p_room_id is not null then
    return jsonb_build_object('ok', false, 'error', 'bad_mode');
  end if;
  drawn := private.random_seed();
  insert into private.run_starts (user_id, ip) values (uid, client);
  insert into public.runs (user_id, mode, party_size, room_id, seed, engine_version)
  values (uid, chosen, party, case when chosen = 'coop' then p_room_id else null end, drawn, engine)
  returning id into run_id;
  if chosen = 'coop' then
    update public.rooms
    set seed = coalesce(rooms.seed, drawn),
        version = engine,
        status = 'playing',
        last_heartbeat = now()
    where id = p_room_id;
    select rooms.seed into drawn from public.rooms where id = p_room_id;
    update public.runs set seed = drawn where id = run_id;
  end if;
  return jsonb_build_object('ok', true, 'run_id', run_id, 'seed', drawn, 'mode', chosen);
end;
$fn$;

create or replace function private.touch_room(p_room_id uuid, p_depth integer)
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
    select 1 from public.room_members
    where room_id = p_room_id and user_id = uid and role = 'host' and banned = false
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_host');
  end if;
  update public.room_members set last_seen = now(), connected = true
  where room_id = p_room_id and user_id = uid;
  update public.rooms
  set last_heartbeat = now(),
      depth = case when p_depth is null then depth else greatest(p_depth, 0) end
  where id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$fn$;

create or replace function private.browse_rooms()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(jsonb_agg(listed.row_json), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'room_id', room.id,
      'join_code', room.join_code,
      'status', room.status,
      'max_players', room.max_players,
      'turn_timer_s', room.turn_timer_s,
      'depth', room.depth,
      'locked', room.password_hash is not null,
      'players', (
        select count(*) from public.room_members as member
        where member.room_id = room.id and member.banned = false and member.role in ('host', 'player')
      ),
      'spectators', (
        select count(*) from public.room_members as member
        where member.room_id = room.id and member.banned = false and member.role = 'spectator'
      )
    ) as row_json
    from public.rooms as room
    where room.is_public and room.status in ('lobby', 'playing')
    order by room.created_at desc
    limit 50
  ) as listed;
$fn$;

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

create or replace function public.set_display_name(p_display_name text)
returns jsonb language sql volatile security invoker set search_path = ''
as $fn$ select private.set_display_name(p_display_name); $fn$;

create or replace function public.create_room(
  p_password text default null,
  p_is_public boolean default true,
  p_max_players integer default 4,
  p_turn_timer_s integer default 20,
  p_display_name text default null
)
returns jsonb language sql volatile security invoker set search_path = ''
as $fn$ select private.create_room(p_password, p_is_public, p_max_players, p_turn_timer_s, p_display_name); $fn$;

create or replace function public.join_room(
  p_code text,
  p_password text default null,
  p_role text default 'player',
  p_character_name text default null
)
returns jsonb language sql volatile security invoker set search_path = ''
as $fn$ select private.join_room(p_code, p_password, p_role, p_character_name); $fn$;

create or replace function public.leave_room(p_room_id uuid)
returns jsonb language sql volatile security invoker set search_path = ''
as $fn$ select private.leave_room(p_room_id); $fn$;

create or replace function public.transfer_host(p_room_id uuid, p_user_id uuid)
returns jsonb language sql volatile security invoker set search_path = ''
as $fn$ select private.transfer_host(p_room_id, p_user_id); $fn$;

create or replace function public.kick_member(p_room_id uuid, p_user_id uuid)
returns jsonb language sql volatile security invoker set search_path = ''
as $fn$ select private.kick_member(p_room_id, p_user_id); $fn$;

create or replace function public.post_chat(p_room_id uuid, p_channel text, p_body text)
returns jsonb language sql volatile security invoker set search_path = ''
as $fn$ select private.post_chat(p_room_id, p_channel, p_body); $fn$;

create or replace function public.start_run(
  p_mode text,
  p_room_id uuid default null,
  p_engine_version text default '1.3.33'
)
returns jsonb language sql volatile security invoker set search_path = ''
as $fn$ select private.start_run(p_mode, p_room_id, p_engine_version); $fn$;

create or replace function public.touch_room(p_room_id uuid, p_depth integer default null)
returns jsonb language sql volatile security invoker set search_path = ''
as $fn$ select private.touch_room(p_room_id, p_depth); $fn$;

create or replace function public.browse_rooms()
returns jsonb language sql stable security invoker set search_path = ''
as $fn$ select private.browse_rooms(); $fn$;

create or replace function public.cleanup_online()
returns jsonb language sql volatile security invoker set search_path = ''
as $fn$ select private.cleanup_online(); $fn$;

revoke all on all functions in schema private from public;
revoke all on function private.fold_text(text) from anon, authenticated;
revoke all on function private.contains_blocked(text) from anon, authenticated;
revoke all on function private.name_error(text) from anon, authenticated;
revoke all on function private.random_code(integer) from anon, authenticated;
revoke all on function private.random_seed() from anon, authenticated;
revoke all on function private.client_ip() from anon, authenticated;
revoke all on function private.cleanup_online() from anon, authenticated;
grant execute on function private.is_room_member(uuid) to authenticated, service_role;
grant execute on function private.set_display_name(text) to authenticated, service_role;
grant execute on function private.create_room(text, boolean, integer, integer, text) to authenticated, service_role;
grant execute on function private.join_room(text, text, text, text) to authenticated, service_role;
grant execute on function private.leave_room(uuid) to authenticated, service_role;
grant execute on function private.transfer_host(uuid, uuid) to authenticated, service_role;
grant execute on function private.kick_member(uuid, uuid) to authenticated, service_role;
grant execute on function private.post_chat(uuid, text, text) to authenticated, service_role;
grant execute on function private.start_run(text, uuid, text) to authenticated, service_role;
grant execute on function private.touch_room(uuid, integer) to authenticated, service_role;
grant execute on function private.browse_rooms() to authenticated, service_role;
grant execute on function private.cleanup_online() to service_role;

do $revoke$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.set_display_name(text)'::regprocedure,
    'public.create_room(text, boolean, integer, integer, text)'::regprocedure,
    'public.join_room(text, text, text, text)'::regprocedure,
    'public.leave_room(uuid)'::regprocedure,
    'public.transfer_host(uuid, uuid)'::regprocedure,
    'public.kick_member(uuid, uuid)'::regprocedure,
    'public.post_chat(uuid, text, text)'::regprocedure,
    'public.start_run(text, uuid, text)'::regprocedure,
    'public.touch_room(uuid, integer)'::regprocedure,
    'public.browse_rooms()'::regprocedure,
    'public.cleanup_online()'::regprocedure
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    if fn::text like '%cleanup_online%' then
      execute format('revoke all on function %s from authenticated', fn);
      execute format('grant execute on function %s to service_role', fn);
    else
      execute format('grant execute on function %s to authenticated, service_role', fn);
    end if;
  end loop;
end
$revoke$;

do $realtime$
begin
  if to_regclass('realtime.messages') is null or to_regprocedure('realtime.topic()') is null then
    raise notice 'realtime.messages is absent; channel policies were skipped';
    return;
  end if;
  execute 'grant usage on schema realtime to authenticated';
  execute 'grant select, insert on realtime.messages to authenticated';
  execute 'drop policy if exists room_members_read_realtime on realtime.messages';
  execute 'drop policy if exists room_players_send_action on realtime.messages';
  execute 'drop policy if exists room_members_send_other on realtime.messages';
  execute $sql$
    create policy room_members_read_realtime
    on realtime.messages
    for select
    to authenticated
    using (
      realtime.messages.extension in ('broadcast', 'presence')
      and exists (
        select 1
        from public.room_members as member
        where member.user_id = (select auth.uid())
          and member.banned = false
          and (select realtime.topic()) = 'room:' || member.room_id::text
      )
    )
  $sql$;
  execute $sql$
    create policy room_players_send_action
    on realtime.messages
    for insert
    to authenticated
    with check (
      realtime.messages.extension = 'broadcast'
      and coalesce(realtime.messages.event, '') = 'action'
      and exists (
        select 1
        from public.room_members as member
        where member.user_id = (select auth.uid())
          and member.banned = false
          and member.role in ('host', 'player')
          and (select realtime.topic()) = 'room:' || member.room_id::text
      )
    )
  $sql$;
  execute $sql$
    create policy room_members_send_other
    on realtime.messages
    for insert
    to authenticated
    with check (
      realtime.messages.extension in ('broadcast', 'presence')
      and coalesce(realtime.messages.event, '') <> 'action'
      and exists (
        select 1
        from public.room_members as member
        where member.user_id = (select auth.uid())
          and member.banned = false
          and (select realtime.topic()) = 'room:' || member.room_id::text
      )
    )
  $sql$;
end
$realtime$;

do $cron$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not installed; cleanup_online remains callable';
    return;
  end if;
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron could not be created: %', sqlerrm;
    return;
  end;
  if exists (
    select 1 from cron.job where jobname = 'ularn-online-cleanup'
  ) then
    perform cron.unschedule('ularn-online-cleanup');
  end if;
  perform cron.schedule(
    'ularn-online-cleanup',
    '*/5 * * * *',
    'select public.cleanup_online()'
  );
end
$cron$;
