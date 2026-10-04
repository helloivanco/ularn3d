-- Public leaderboard. Clients can read verified, unflagged rows and nothing else.
-- Writes happen in the submit-score Edge Function with the service role.

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.runs (id),
  user_id uuid not null references public.profiles (user_id),
  display_name text not null,
  mode text not null,
  party_size integer not null default 1,
  score integer not null,
  depth_reached integer not null default 0,
  turns integer not null default 0,
  won boolean not null default false,
  killed_by text not null default '',
  engine_version text not null,
  verified boolean not null default false,
  flagged boolean not null default false,
  created_at timestamptz not null default now(),
  constraint scores_mode_known check (mode in ('solo', 'coop')),
  constraint scores_party_size_range check (party_size between 1 and 4)
);

create index if not exists scores_board_idx
  on public.scores (mode, created_at desc, score desc)
  where verified and not flagged;
create index if not exists scores_user_id_idx on public.scores (user_id);

create table if not exists private.score_submits (
  user_id uuid not null,
  ip text not null default '',
  submitted_at timestamptz not null default now()
);
create index if not exists score_submits_user_idx
  on private.score_submits (user_id, submitted_at desc);
create index if not exists score_submits_ip_idx
  on private.score_submits (ip, submitted_at desc);

alter table public.scores enable row level security;
alter table private.score_submits enable row level security;

revoke all on public.scores from public, anon, authenticated;
grant select on public.scores to anon, authenticated;
grant all on public.scores to service_role;
revoke all on private.score_submits from public, anon, authenticated;

drop policy if exists scores_select_verified on public.scores;
create policy scores_select_verified
  on public.scores
  for select
  to anon, authenticated
  using (verified and not flagged);

create or replace view private.moderation_scores
with (security_invoker = true) as
select
  id, run_id, user_id, display_name, mode, party_size, score,
  depth_reached, turns, won, killed_by, engine_version,
  verified, flagged, created_at
from public.scores;

revoke all on private.moderation_scores from public, anon, authenticated;
grant select on private.moderation_scores to service_role;

create or replace function private.flag_score(p_id uuid, p_flagged boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.scores
  set flagged = coalesce(p_flagged, true)
  where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'missing');
  end if;
  return jsonb_build_object('ok', true);
end;
$fn$;

create or replace function private.ban_profile(p_user_id uuid, p_banned boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.profiles
  set banned = coalesce(p_banned, true)
  where user_id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'missing');
  end if;
  return jsonb_build_object('ok', true);
end;
$fn$;

revoke all on function private.flag_score(uuid, boolean) from public, anon, authenticated;
revoke all on function private.ban_profile(uuid, boolean) from public, anon, authenticated;
grant execute on function private.flag_score(uuid, boolean) to service_role;
grant execute on function private.ban_profile(uuid, boolean) to service_role;
