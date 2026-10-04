-- Additive. Revoke client execute on Supabase's event-trigger function, and
-- record score attempts in private.score_submits. Do not edit the four
-- migrations already applied on the hosted project.
--
-- public.rls_auto_enable() already exists on the hosted database
-- (no arguments). This file does not recreate it.

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Returns how many of this player's submits fell inside the last hour,
-- before this call. A count under 5 is stored. The sixth call returns 5
-- and writes nothing. Run status is not this table.
create or replace function private.note_score_submit(p_user_id uuid, p_ip text)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  recent integer;
begin
  if p_user_id is null then
    return 5;
  end if;
  select count(*)::integer into recent
  from private.score_submits
  where user_id = p_user_id
    and submitted_at > now() - interval '1 hour';
  if recent < 5 then
    insert into private.score_submits (user_id, ip)
    values (p_user_id, coalesce(p_ip, ''));
  end if;
  return recent;
end;
$fn$;

create or replace function public.note_score_submit(p_user_id uuid, p_ip text)
returns integer
language sql
volatile
security definer
set search_path = ''
as $fn$
  select private.note_score_submit(p_user_id, p_ip);
$fn$;

revoke all on function private.note_score_submit(uuid, text) from public, anon, authenticated;
revoke all on function public.note_score_submit(uuid, text) from public, anon, authenticated;
grant execute on function private.note_score_submit(uuid, text) to service_role;
grant execute on function public.note_score_submit(uuid, text) to service_role;
