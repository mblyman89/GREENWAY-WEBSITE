-- scripts/recon/ccrs-auto-upload-0369-pg-check.sql  (D253 - migration 0369)
--
-- Scenario check for 0369_ccrs_auto_upload.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ccrs-auto-upload-0369-pg-check.sql
--
-- "CCRS 0369 CHECK PASSED" then ROLLBACK = all clear.
begin;

create or replace function pg_temp.must_fail(sql text, expect text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(expect in sqlerrm) = 0 and sqlstate <> expect then
      raise exception 'probe raised the WRONG error. expected %, got [%] %  -- %', expect, sqlstate, sqlerrm, sql;
    end if;
    return;
  end;
  raise exception 'probe was ACCEPTED but must be refused (expected %): %', expect, sql;
end $$;

do $$
declare
  n int;
  rid uuid;
  rid2 uuid;
  rid3 uuid;
  f1 uuid := gen_random_uuid();
  f2 uuid := gen_random_uuid();
  owner uuid := gen_random_uuid();
  rf1 uuid;
  rf2 uuid;
begin
  -- 0. shape and grants
  select count(*) into n from pg_class where relname in ('ccrs_uploader_devices', 'ccrs_upload_runs', 'ccrs_upload_run_files') and relkind = 'r' and relrowsecurity;
  assert n = 3, 'all three tables with RLS on';
  select count(*) into n from pg_policies where tablename in ('ccrs_uploader_devices', 'ccrs_upload_runs', 'ccrs_upload_run_files');
  assert n = 0, 'no policies: service role only';
  assert not has_table_privilege('authenticated', 'public.ccrs_uploader_devices', 'select'), 'authenticated cannot read the device keys';
  assert not has_table_privilege('anon', 'public.ccrs_upload_runs', 'insert'), 'anon cannot start a run';
  assert not has_table_privilege('authenticated', 'public.ccrs_upload_run_files', 'update'), 'authenticated cannot move a file';
  assert has_table_privilege('service_role', 'public.ccrs_upload_run_files', 'update'), 'service_role runs it';

  -- 1. a device stores only a sha256 hex, once
  perform pg_temp.must_fail($q$insert into public.ccrs_uploader_devices (label, token_hash) values ('x', 'plain-key')$q$, 'check');
  insert into public.ccrs_uploader_devices (label, token_hash) values ('Office Chrome', repeat('a', 64));
  perform pg_temp.must_fail(format($q$insert into public.ccrs_uploader_devices (label, token_hash) values ('y', %L)$q$, repeat('a', 64)), 'duplicate key');

  -- 2. two ledger files to run
  -- (born draft, as every file is; the run tables only need real ids)
  insert into public.ccrs_files (id, env, file_type, purpose, file_name)
  values (f1, 'preprod', 'Strain', 'weekly', 'd253:Strain_413541_20991117220513.csv'),
         (f2, 'preprod', 'Inventory', 'weekly', 'd253:Inventory_413541_20991117220516.csv');

  -- 3. a run: bad username / env refused; one active run at a time
  perform pg_temp.must_fail(format($q$insert into public.ccrs_upload_runs (env, ccrs_username, started_by) values ('preprod', 'not an email', %L)$q$, owner), 'check');
  perform pg_temp.must_fail(format($q$insert into public.ccrs_upload_runs (env, ccrs_username, started_by) values ('test', 'a@b.c', %L)$q$, owner), 'check');
  insert into public.ccrs_upload_runs (env, ccrs_username, started_by) values ('preprod', 'michael@greenwaymarijuana.com', owner) returning id into rid;
  perform pg_temp.must_fail(format($q$insert into public.ccrs_upload_runs (env, ccrs_username, started_by) values ('prod', 'michael@greenwaymarijuana.com', %L)$q$, owner), 'ccrs_upload_runs_one_active');
  perform pg_temp.must_fail(format($q$update public.ccrs_upload_runs set state = 'done' where id = %L$q$, rid), 'check');

  -- 4. run files: one file in the browser's hands at a time
  insert into public.ccrs_upload_run_files (run_id, file_id, seq, grp, file_name, file_type) values (rid, f1, 1, 1, 'Strain_413541_20991117220513.csv', 'Strain') returning id into rf1;
  insert into public.ccrs_upload_run_files (run_id, file_id, seq, grp, file_name, file_type) values (rid, f2, 2, 2, 'Inventory_413541_20991117220516.csv', 'Inventory') returning id into rf2;
  perform pg_temp.must_fail(format($q$insert into public.ccrs_upload_run_files (run_id, file_id, seq, grp, file_name, file_type) values (%L, %L, 3, 1, 'x.csv', 'Strain')$q$, rid, f1), 'duplicate key');
  perform pg_temp.must_fail(format($q$insert into public.ccrs_upload_run_files (run_id, file_id, seq, grp, file_name, file_type) values (%L, gen_random_uuid(), 3, 1, 'x.csv', 'Strain')$q$, rid), 'foreign key');
  perform pg_temp.must_fail(format($q$update public.ccrs_upload_run_files set step = 'claimed' where id = %L$q$, rf1), 'check');
  update public.ccrs_upload_run_files set step = 'claimed', claimed_at = now() where id = rf1;
  perform pg_temp.must_fail(format($q$update public.ccrs_upload_run_files set step = 'claimed', claimed_at = now() where id = %L$q$, rf2), 'ccrs_upload_run_files_one_claimed');
  perform pg_temp.must_fail(format($q$update public.ccrs_upload_run_files set step = 'posted' where id = %L$q$, rf1), 'check');
  update public.ccrs_upload_run_files set step = 'posted', posted_at = now() where id = rf1;
  update public.ccrs_upload_run_files set step = 'claimed', claimed_at = now() where id = rf2;
  update public.ccrs_upload_run_files set step = 'unknown' where id = rf2;

  -- 5. a run ends with a time; then a new run may start, but a file still
  --    waiting in another run may not be put in it twice
  update public.ccrs_upload_runs set state = 'stopped', ended_at = now(), ended_reason = 'check' where id = rid;
  insert into public.ccrs_upload_runs (env, ccrs_username, started_by) values ('preprod', 'michael@greenwaymarijuana.com', owner) returning id into rid2;
  insert into public.ccrs_upload_runs (env, ccrs_username, started_by, state, ended_at) values ('preprod', 'michael@greenwaymarijuana.com', owner, 'stopped', now()) returning id into rid3;
  insert into public.ccrs_upload_run_files (run_id, file_id, seq, grp, file_name, file_type) values (rid2, f2, 1, 2, 'Inventory_413541_20991117220516.csv', 'Inventory');
  perform pg_temp.must_fail(format($q$insert into public.ccrs_upload_run_files (run_id, file_id, seq, grp, file_name, file_type) values (%L, %L, 1, 2, 'x.csv', 'Inventory')$q$, rid3, f2), 'ccrs_upload_run_files_one_waiting');
  update public.ccrs_upload_runs set state = 'done', ended_at = now() where id = rid2;

  -- 6. the ledger file cannot be deleted under a run (history kept)
  perform pg_temp.must_fail(format($q$delete from public.ccrs_upload_runs where id = %L$q$, rid), 'foreign key');

  raise notice 'CCRS 0369 CHECK PASSED';
end $$;

rollback;
