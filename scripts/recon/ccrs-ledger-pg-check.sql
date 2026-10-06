-- scripts/recon/ccrs-ledger-pg-check.sql  (CCRS Bible v2 S-12a - migration 0247)
--
-- Scenario check for 0247_ccrs_ledger.sql on a real Postgres with all
-- migrations applied. ONE transaction, rolled back: leaves nothing behind.
-- Re-applies 0247 (idempotency), then proves every guard by attempting the
-- forbidden thing and requiring the exact error, then applies the rollback
-- (refusal first, then a clean drop) and re-applies 0247.
-- A run printing CCRS LEDGER CHECK PASSED then ROLLBACK is the all-clear.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ccrs-ledger-pg-check.sql
begin;

-- Start from NOTHING so the DDL under test is what actually runs (a
-- `create table if not exists` over an existing table would test nothing —
-- proven by mutate_0247_sql.py, where 12 constraint mutants survived until
-- this drop was added). The tables are empty here, so the rollback runs.
\i supabase/rollbacks/0247_ccrs_ledger.rollback.sql
do $$ begin assert to_regclass('public.ccrs_files') is null, 'clean start'; end $$;
\i supabase/migrations/0247_ccrs_ledger.sql
\i supabase/migrations/0247_ccrs_ledger.sql

create or replace function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(needle in sqlerrm) = 0 then
      raise exception 'expected error containing "%" from [%], got: %', needle, sql, sqlerrm;
    end if;
    return;
  end;
  raise exception 'expected error containing "%" but [%] succeeded', needle, sql;
end $$;

-- ---- entities: exact identity, env separation -----------------------------
insert into public.ccrs_filed_entities (env, file_type, external_id, filed_name, state, source) values
  ('prod',    'Strain', 'Dutch Treat', 'Dutch Treat', 'seed', 'seed:test'),
  ('prod',    'Strain', 'Dutch treat', 'Dutch treat', 'seed', 'seed:test'),   -- case is identity
  ('preprod', 'Strain', 'Dutch Treat', 'Dutch Treat', 'filed', 'us'),          -- env separates
  ('prod',    'Inventory', 'WAR413541.IN132IB0', 'Buddies Live Resin', 'seed', 'seed:test'),
  ('prod',    'Inventory', 'WAR413541.IN132IB0 ', 'trailing space is a different id', 'seed', 'seed:test');
select pg_temp.expect_error($q$insert into public.ccrs_filed_entities (env,file_type,external_id,state,source) values ('prod','Strain','Dutch Treat','filed','x')$q$, 'ccrs_filed_entities_env_type_id_key');  -- a different state is still the same record
select pg_temp.expect_error($q$insert into public.ccrs_filed_entities (env,file_type,external_id,state,source) values ('test','Strain','X','seed','x')$q$, 'ccrs_filed_entities_env_check');
select pg_temp.expect_error($q$insert into public.ccrs_filed_entities (env,file_type,external_id,state,source) values ('prod','Strain','X','pending','x')$q$, 'ccrs_filed_entities_state_check');
select pg_temp.expect_error($q$insert into public.ccrs_filed_entities (env,file_type,external_id,state,source) values ('prod','Strain','','seed','x')$q$, 'ccrs_filed_entities_external_id_check');
select pg_temp.expect_error($q$insert into public.ccrs_filed_entities (env,file_type,external_id,state,source) values ('prod','SaleDetail','X','seed','x')$q$, 'ccrs_filed_entities_file_type_check');

-- ---- files: birth, uniqueness, transitions, immutability, no delete ---------
insert into public.ccrs_files (id, env, file_type, purpose, file_name) values
  ('00000000-0000-4000-8000-000000002471', 'prod', 'Inventory', 'weekly', 'Inventory_413541_20261007120000.csv');
-- a seed pseudo-file is born closed (Part 03 §D.4)
insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path, state) values
  ('prod', 'Inventory', 'seed', 'seed:Inventory.csv', repeat('c', 64), 62744, 'seed/Inventory.csv', 'closed');
select pg_temp.expect_error($q$insert into public.ccrs_files (env,file_type,purpose,file_name,state,sha256,number_records,storage_path) values ('prod','Inventory','weekly','X.csv','emitted',repeat('d',64),1,'p')$q$, 'CCRS_FILE_BAD_BIRTH');
select pg_temp.expect_error($q$insert into public.ccrs_files (env,file_type,purpose,file_name) values ('prod','Inventory','weekly','Inventory_413541_20261007120000.csv')$q$, 'ccrs_files_file_name_key');
select pg_temp.expect_error($q$insert into public.ccrs_files (env,file_type,purpose,file_name,chunk_no,chunk_of) values ('prod','Inventory','weekly','C.csv',3,2)$q$, 'ccrs_files_chunk_in_range');
select pg_temp.expect_error($q$insert into public.ccrs_files (env,file_type,purpose,file_name) values ('prod','Inventory','adhoc','D.csv')$q$, 'ccrs_files_purpose_check');

-- draft cannot jump; emitting needs bytes
select pg_temp.expect_error($q$update public.ccrs_files set state='uploaded' where id='00000000-0000-4000-8000-000000002471'$q$, 'CCRS_FILE_BAD_TRANSITION');
select pg_temp.expect_error($q$update public.ccrs_files set state='emitted' where id='00000000-0000-4000-8000-000000002471'$q$, 'ccrs_files_bytes_fixed_after_draft');
select pg_temp.expect_error($q$update public.ccrs_files set sha256='ABC' where id='00000000-0000-4000-8000-000000002471'$q$, 'ccrs_files_sha256_check');
-- in draft, facts may still change
update public.ccrs_files set number_records = 2 where id = '00000000-0000-4000-8000-000000002471';
update public.ccrs_files set state='emitted', sha256=repeat('a',64), number_records=3, storage_path='ccrs/prod/a.csv'
 where id='00000000-0000-4000-8000-000000002471';
-- same bytes twice in one env refused; another env allowed (Brian A21/A29)
select pg_temp.expect_error($q$insert into public.ccrs_files (env,file_type,purpose,file_name,sha256) values ('prod','Inventory','weekly','E.csv',repeat('a',64))$q$, 'ccrs_files_env_sha256_key');
insert into public.ccrs_files (env, file_type, purpose, file_name, sha256) values ('preprod', 'Inventory', 'probe', 'F.csv', repeat('a', 64));
-- immutability after draft
select pg_temp.expect_error($q$update public.ccrs_files set number_records=4 where id='00000000-0000-4000-8000-000000002471'$q$, 'CCRS_FILE_IMMUTABLE');
select pg_temp.expect_error($q$update public.ccrs_files set sha256=repeat('b',64) where id='00000000-0000-4000-8000-000000002471'$q$, 'CCRS_FILE_IMMUTABLE');
select pg_temp.expect_error($q$update public.ccrs_files set file_name='G.csv' where id='00000000-0000-4000-8000-000000002471'$q$, 'CCRS_FILE_IMMUTABLE');
select pg_temp.expect_error($q$update public.ccrs_files set env='preprod' where id='00000000-0000-4000-8000-000000002471'$q$, 'CCRS_FILE_IMMUTABLE');
select pg_temp.expect_error($q$update public.ccrs_files set file_type='Product' where id='00000000-0000-4000-8000-000000002471'$q$, 'CCRS_FILE_IMMUTABLE');
select pg_temp.expect_error($q$update public.ccrs_files set storage_path='x' where id='00000000-0000-4000-8000-000000002471'$q$, 'CCRS_FILE_IMMUTABLE');
-- non-immutable bookkeeping still allowed
update public.ccrs_files set notes = 'operator note' where id = '00000000-0000-4000-8000-000000002471';
-- a file that left draft is a record: no delete
select pg_temp.expect_error($q$delete from public.ccrs_files where id='00000000-0000-4000-8000-000000002471'$q$, 'CCRS_FILE_IS_RECORD');
-- walk the happy path
update public.ccrs_files set state='uploaded'  where id='00000000-0000-4000-8000-000000002471';
update public.ccrs_files set state='errored'   where id='00000000-0000-4000-8000-000000002471';
update public.ccrs_files set state='reconciling' where id='00000000-0000-4000-8000-000000002471';
update public.ccrs_files set state='closed'    where id='00000000-0000-4000-8000-000000002471';
select pg_temp.expect_error($q$update public.ccrs_files set state='reconciling' where id='00000000-0000-4000-8000-000000002471'$q$, 'CCRS_FILE_BAD_TRANSITION');
-- a draft can be deleted (nothing left the building)
insert into public.ccrs_files (id, env, file_type, purpose, file_name) values
  ('00000000-0000-4000-8000-000000002472', 'prod', 'Strain', 'weekly', 'Strain_413541_20261007120001.csv');

-- ---- rows + issues ---------------------------------------------------------
insert into public.ccrs_file_rows (file_id, row_no, external_id, operation, payload, state) values
  ('00000000-0000-4000-8000-000000002472', 1, 'Dutch Treat', null, '{"Strain":"Dutch Treat"}', 'planned');
select pg_temp.expect_error($q$insert into public.ccrs_file_rows (file_id,row_no,external_id,operation,payload,state) values ('00000000-0000-4000-8000-000000002472',1,'X',null,'{}','planned')$q$, 'ccrs_file_rows_file_row_key');
select pg_temp.expect_error($q$insert into public.ccrs_file_rows (file_id,row_no,external_id,operation,payload,state) values ('00000000-0000-4000-8000-000000002472',2,'X',null,'{}','withheld')$q$, 'ccrs_file_rows_withheld_has_code');
select pg_temp.expect_error($q$insert into public.ccrs_file_rows (file_id,row_no,external_id,operation,payload,state,withheld_code) values ('00000000-0000-4000-8000-000000002472',2,'X',null,'{}','planned','E7')$q$, 'ccrs_file_rows_withheld_has_code');
select pg_temp.expect_error($q$insert into public.ccrs_file_rows (file_id,row_no,external_id,operation,payload,state) values ('00000000-0000-4000-8000-000000002472',2,'X','Upsert','{}','planned')$q$, 'ccrs_file_rows_operation_check');
insert into public.ccrs_file_rows (file_id, row_no, external_id, operation, payload, state, withheld_code) values
  ('00000000-0000-4000-8000-000000002472', 2, 'X', null, '{}', 'withheld', 'E42_FIELD_HAS_COMMA');
insert into public.ccrs_file_issues (file_id, severity, code, message) values
  ('00000000-0000-4000-8000-000000002472', 'error', 'E42_FIELD_HAS_COMMA', 'm');
select pg_temp.expect_error($q$insert into public.ccrs_file_issues (file_id,severity,code,message) values (null,'fatal','X','m')$q$, 'ccrs_file_issues_severity_check');
delete from public.ccrs_files where id = '00000000-0000-4000-8000-000000002472';

do $$
begin
  assert (select count(*) from public.ccrs_file_rows where file_id = '00000000-0000-4000-8000-000000002472') = 0, 'draft delete cascades rows';
  assert (select count(*) from public.ccrs_file_issues where file_id = '00000000-0000-4000-8000-000000002472') = 0, 'draft delete cascades issues';
  assert (select state from public.ccrs_files where id = '00000000-0000-4000-8000-000000002471') = 'closed', 'happy path reached closed';
  assert (select count(*) from public.ccrs_filed_entities where env = 'prod' and file_type = 'Strain') = 2, 'case variants are two entities';
  -- RLS on, both policies on each table
  assert (select count(*) from pg_class where relname in ('ccrs_files','ccrs_filed_entities','ccrs_file_rows','ccrs_file_issues') and relrowsecurity) = 4, 'RLS enabled on all four';
  assert (select count(*) from pg_policies where tablename in ('ccrs_files','ccrs_filed_entities','ccrs_file_rows','ccrs_file_issues')) = 8, 'two policies per table';
  assert (select count(*) from pg_policies where tablename like 'ccrs_file%' and cmd = 'SELECT' and qual like '%is_staff()%') = 4, 'staff read on all four';
  assert (select count(*) from pg_policies where tablename like 'ccrs_file%' and cmd = 'ALL' and qual like '%is_admin()%' and with_check like '%is_admin()%') = 4, 'admin write on all four';
  -- updated_at trigger fires (now() is constant in a transaction, so plant an old value)
  update public.ccrs_files set updated_at = '2000-01-01', notes = 'touch' where id = '00000000-0000-4000-8000-000000002471';
  assert (select updated_at > '2001-01-01' from public.ccrs_files where id = '00000000-0000-4000-8000-000000002471'), 'ccrs_files updated_at maintained';
  update public.ccrs_filed_entities set updated_at = '2000-01-01' where external_id = 'Dutch Treat' and env = 'prod';
  assert (select updated_at > '2001-01-01' from public.ccrs_filed_entities where external_id = 'Dutch Treat' and env = 'prod'), 'entities updated_at maintained';
end $$;

-- ---- rollback refuses while a non-seed file has left draft ----------------
-- The refusal raises, which aborts the transaction, so every later statement
-- in the rollback file errors too and psql's :ERROR is true after the last
-- one. If the refusal were missing, the drops would succeed and :ERROR false.
savepoint before_rb;
\set ON_ERROR_STOP 0
\i supabase/rollbacks/0247_ccrs_ledger.rollback.sql
\set ON_ERROR_STOP 1
\if :ERROR
\echo rollback refused as required
\else
select 'ROLLBACK DID NOT REFUSE'::int;
\endif
rollback to savepoint before_rb;
do $$ begin
  assert to_regclass('public.ccrs_files') is not null, 'refused rollback must leave the tables';
end $$;
-- clear the non-seed records, then the rollback runs clean (seed rows do not block)
alter table public.ccrs_files disable trigger trg_ccrs_files_guard;
delete from public.ccrs_files where purpose <> 'seed';
alter table public.ccrs_files enable trigger trg_ccrs_files_guard;
\i supabase/rollbacks/0247_ccrs_ledger.rollback.sql
do $$ begin
  assert to_regclass('public.ccrs_files') is null and to_regclass('public.ccrs_filed_entities') is null
     and to_regclass('public.ccrs_file_rows') is null and to_regclass('public.ccrs_file_issues') is null, 'rollback drops all four';
  assert to_regprocedure('public.ccrs_files_guard()') is null, 'rollback drops the guard';
end $$;
\i supabase/migrations/0247_ccrs_ledger.sql
do $$ begin
  assert to_regclass('public.ccrs_files') is not null, 're-apply after rollback works';
  raise notice 'CCRS LEDGER CHECK PASSED';
end $$;

rollback;
