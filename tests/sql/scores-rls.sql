-- Clients cannot write scores or runs. The public board is verified rows only.

do $scores$
declare
  uid uuid := '77777777-7777-4777-8777-777777777777';
  rid uuid;
  visible integer;
  hidden integer;
begin
  insert into auth.users (id) values (uid);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform public.set_display_name('Ada');
  perform set_config('request.jwt.claim.sub', uid::text, true);
  insert into public.runs (user_id, mode, party_size, seed, engine_version)
  values (uid, 'solo', 1, 2, '1.3.34')
  returning id into rid;

  insert into public.scores (
    run_id, user_id, display_name, mode, score, engine_version, verified, flagged
  ) values
    (rid, uid, 'Ada', 'solo', 10, '1.3.34', false, false);

  set local role authenticated;
  begin
    insert into public.scores (
      run_id, user_id, display_name, mode, score, engine_version, verified
    ) values (rid, uid, 'Ada', 'solo', 99, '1.3.34', true);
    raise exception 'client inserted a score';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    insert into public.runs (user_id, mode, seed, engine_version)
    values (uid, 'solo', 1, '1.3.34');
    raise exception 'client inserted a run';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    perform private.flag_score(rid, true);
    raise exception 'client flagged a score';
  exception
    when insufficient_privilege then
      null;
  end;

  select count(*) into hidden from public.scores;
  if hidden <> 0 then
    raise exception 'unverified score was visible: %', hidden;
  end if;
  reset role;

  update public.scores as board set verified = true where board.run_id = rid;
  set local role anon;
  select count(*) into visible from public.scores;
  if visible <> 1 then
    raise exception 'verified score hidden: %', visible;
  end if;
  reset role;
  update public.scores as board set flagged = true where board.run_id = rid;
  set local role authenticated;
  select count(*) into visible from public.scores;
  if visible <> 0 then
    raise exception 'flagged score visible: %', visible;
  end if;
  reset role;
end
$scores$;

select 'scores rls ok';
