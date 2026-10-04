-- Additive. The hosted replay engine is the same gzip parts as engine-part-*.js.
-- submit-score reads them with the service role. A cold start does not download
-- them from GitHub. verify_jwt on submit-score stays on.

create table if not exists private.replay_engine_part (
  idx integer primary key,
  part text not null check (char_length(part) <= 20000)
);

comment on table private.replay_engine_part is
  'Gzip base64 of the replay engine, in order. Not exposed to anon or authenticated.';

revoke all on table private.replay_engine_part from public, anon, authenticated;

create or replace function public.replay_engine_bundle()
returns text
language sql
stable
security definer
set search_path = private
as $$
  select coalesce(string_agg(part, '' order by idx), '')
  from private.replay_engine_part;
$$;

revoke all on function public.replay_engine_bundle() from public, anon, authenticated;
grant execute on function public.replay_engine_bundle() to service_role;

comment on function public.replay_engine_bundle() is
  'Service role only. Bundled replay engine for submit-score. verify_jwt stays on.';
