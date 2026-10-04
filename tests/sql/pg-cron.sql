do $cron$
declare
  jobs integer;
begin
  select count(*) into jobs from cron.job where jobname = 'ularn-online-cleanup';
  if jobs <> 1 then
    raise exception 'expected one cleanup job, found %', jobs;
  end if;
end
$cron$;

select 'pg cron ok';
