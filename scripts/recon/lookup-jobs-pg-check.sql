-- scripts/recon/lookup-jobs-pg-check.sql  (S13 - migration 0242)
--
-- Scenario check for 0242_lookup_jobs.sql against a real Postgres.
-- Runs in ONE transaction that is rolled back, so it leaves no rows behind.
-- Applies the migration TWICE (idempotency), then proves the constraints.
-- A run that prints LOOKUP JOBS CHECK PASSED then ROLLBACK is the all-clear.
--
--   sudo -u postgres psql -d greenway -v ON_ERROR_STOP=1 \
--     -f scripts/recon/lookup-jobs-pg-check.sql
begin;

\i supabase/migrations/0242_lookup_jobs.sql
\i supabase/migrations/0242_lookup_jobs.sql

do $$
declare
  m uuid := gen_random_uuid();
  j1 uuid;
  j2 uuid;
  d uuid := gen_random_uuid();
  n int;
begin
  -- one active job per manifest
  insert into public.lookup_jobs (manifest_id, total) values (m, 2) returning id into j1;
  begin
    insert into public.lookup_jobs (manifest_id, total) values (m, 2);
    raise exception 'second active job was accepted';
  exception when unique_violation then null;
  end;
  -- a finished job frees the slot
  update public.lookup_jobs set status = 'done' where id = j1;
  insert into public.lookup_jobs (manifest_id, total) values (m, 1) returning id into j2;
  assert j2 is not null, 'new job after done must be accepted';

  -- status check
  begin
    update public.lookup_jobs set status = 'paused' where id = j2;
    raise exception 'bad job status accepted';
  exception when check_violation then null;
  end;

  -- one item per draft per job
  insert into public.lookup_job_items (job_id, draft_id, position) values (j2, d, 0);
  begin
    insert into public.lookup_job_items (job_id, draft_id, position) values (j2, d, 1);
    raise exception 'duplicate draft in a job accepted';
  exception when unique_violation then null;
  end;
  -- same draft in another job is fine
  insert into public.lookup_job_items (job_id, draft_id) values (j1, d);

  begin
    update public.lookup_job_items set status = 'weird' where job_id = j2;
    raise exception 'bad item status accepted';
  exception when check_violation then null;
  end;
  begin
    update public.lookup_job_items set ai_calls = -1 where job_id = j2;
    raise exception 'negative ai_calls accepted';
  exception when check_violation then null;
  end;

  -- cascade
  delete from public.lookup_jobs where id = j2;
  select count(*) into n from public.lookup_job_items where job_id = j2;
  assert n = 0, 'items must cascade with the job';

  -- RLS on
  select count(*) into n from pg_class
   where relname in ('lookup_jobs', 'lookup_job_items') and relrowsecurity;
  assert n = 2, 'RLS must be on for both tables';
  select count(*) into n from pg_policies
   where tablename in ('lookup_jobs', 'lookup_job_items');
  assert n = 0, 'no policies expected';

  raise notice 'LOOKUP JOBS CHECK PASSED';
end $$;

\i supabase/rollbacks/0242_lookup_jobs.rollback.sql
select count(*) as tables_left from pg_class where relname in ('lookup_jobs', 'lookup_job_items');

rollback;
