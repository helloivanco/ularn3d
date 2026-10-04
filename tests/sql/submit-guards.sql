-- Client roles cannot run rls_auto_enable or record a score attempt.
-- The attempt table is what the five-per-hour limit counts.

do $guards$
declare
  exposed integer;
  recent integer;
  stored integer;
  player uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  other uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
begin
  select count(*) into exposed
  from pg_proc as proc
  join pg_namespace as namespace on namespace.oid = proc.pronamespace
  cross join lateral aclexplode(proc.proacl) as acl
  left join pg_roles as grantee on grantee.oid = acl.grantee
  where namespace.nspname = 'public'
    and proc.proname = 'rls_auto_enable'
    and acl.privilege_type = 'EXECUTE'
    and (acl.grantee = 0 or grantee.rolname in ('anon', 'authenticated'));
  if exposed <> 0 then
    raise exception 'rls_auto_enable is still executable by a client role';
  end if;

  if has_function_privilege('anon', 'public.note_score_submit(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.note_score_submit(uuid,text)', 'execute')
     or has_function_privilege('public', 'public.note_score_submit(uuid,text)', 'execute') then
    raise exception 'a client role can record a score submit';
  end if;
  if not has_function_privilege('service_role', 'public.note_score_submit(uuid,text)', 'execute') then
    raise exception 'service role cannot record a score submit';
  end if;

  insert into private.score_submits (user_id, ip, submitted_at)
  values (other, 'old', now() - interval '2 hours');

  set local role service_role;
  select public.note_score_submit(other, 'new') into recent;
  if recent <> 0 then
    raise exception 'an old attempt counted toward the hour: %', recent;
  end if;

  for stored in 0..4 loop
    select public.note_score_submit(player, '203.0.113.5') into recent;
    if recent <> stored then
      raise exception 'expected attempt % before insert, got %', stored, recent;
    end if;
  end loop;
  select public.note_score_submit(player, '203.0.113.5') into recent;
  if recent <> 5 then
    raise exception 'sixth attempt was not limited: %', recent;
  end if;
  reset role;

  select count(*) into stored
  from private.score_submits
  where user_id = player and submitted_at > now() - interval '1 hour';
  if stored <> 5 then
    raise exception 'rate-limit table stored % attempts', stored;
  end if;
end
$guards$;

select 'submit guards ok';
