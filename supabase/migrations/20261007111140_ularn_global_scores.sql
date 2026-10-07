-- Public append-only results. Client identifiers are idempotency keys, not identities.
create table public.ularn_scores (
  edition text not null check (edition in ('3d', 'classic')),
  game_id text not null check (game_id ~ '^[A-Za-z0-9_+-]{1,100}$'),
  ularn boolean not null,
  winner boolean not null,
  player_name text not null check (char_length(player_name) between 1 and 60),
  character text not null check (character in ('Adventurer', 'Wizard', 'Rogue', 'Elf', 'Dwarf', 'Ogre', 'Klingon', 'Rambo')),
  difficulty integer not null check (difficulty between 0 and 1000),
  score bigint not null check (score between 0 and 9007199254740991),
  time_used integer not null check (time_used between 0 and 1000000),
  moves integer not null check (moves >= 0),
  fate text not null check (char_length(fate) <= 200),
  level_name text not null check (char_length(level_name) between 1 and 30),
  details jsonb not null check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 262144),
  created_at timestamptz not null default now(),
  primary key (edition, game_id)
);

comment on table public.ularn_scores is 'Ularn expedition results; public anonymous append-only submissions, with server timestamps and separate 3D/classic boards. No IP addresses or browser identifiers.';

alter table public.ularn_scores enable row level security;

revoke all on public.ularn_scores from public, anon, authenticated;
grant select on public.ularn_scores to anon, authenticated;
grant insert (edition, game_id, ularn, winner, player_name, character, difficulty, score, time_used, moves, fate, level_name, details)
  on public.ularn_scores to anon, authenticated;
grant all on public.ularn_scores to service_role;

create policy ularn_scores_public_read on public.ularn_scores
  for select to anon, authenticated using (true);
create policy ularn_scores_public_submit on public.ularn_scores
  for insert to anon, authenticated with check (true);

create index ularn_scores_winners_rank on public.ularn_scores
  (edition, ularn, difficulty desc, time_used asc, score desc, game_id asc) where winner;
create index ularn_scores_visitors_rank on public.ularn_scores
  (edition, ularn, difficulty desc, score desc, time_used desc, game_id asc) where not winner;
