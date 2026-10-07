-- scripts/recon/ccrs-outbox-pg-check.sql  (CCRS Bible v2 S-12b - migration 0248)
--
-- Scenario check for 0248_ccrs_outbox.sql on a real Postgres with all
-- migrations through 0247 applied. ONE transaction, rolled back: leaves
-- nothing behind. Starts from a clean slate (rollback), applies 0248 twice
-- (idempotency), proves every guard by attempting the forbidden thing and
-- requiring the exact error, then proves the rollback refuses once records
-- exist and drops cleanly when they do not.
-- A run printing CCRS OUTBOX CHECK PASSED then ROLLBACK is the all-clear.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ccrs-outbox-pg-check.sql
begin;

-- clean start (the 0248 objects are empty here, so the rollback runs)
-- (a dev database may hold smoke-test product ids; clear them inside this
-- rolled-back transaction so the real rollback can run)
do $$ begin
  if to_regclass('public.ccrs_product_ids') is not null then
    execute 'alter table public.ccrs_product_ids disable trigger user';
    execute 'delete from public.ccrs_product_ids';
    execute 'alter table public.ccrs_product_ids enable trigger user';
  end if;
end $$;
\i supabase/rollbacks/0248_ccrs_outbox.rollback.sql
do $$ begin assert to_regclass('public.ccrs_file_contents') is null, 'clean start'; end $$;
\i supabase/migrations/0248_ccrs_outbox.sql
\i supabase/migrations/0248_ccrs_outbox.sql

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

-- Build one file payload exactly as the app does (header, column row, data, CRLF).
create or replace function pg_temp.file(p_type text, p_name text, p_stamp text, p_cols text, p_rows text[], p_issues jsonb default '[]'::jsonb)
returns jsonb language plpgsql as $$
declare c text; n int := coalesce(array_length(p_rows, 1), 0);
begin
  c := 'SubmittedBy,Greenway' || E'\r\n' || 'SubmittedDate,10/07/2026' || E'\r\n' || 'NumberRecords,' || n || E'\r\n' || p_cols || E'\r\n';
  if n > 0 then c := c || array_to_string(p_rows, E'\r\n') || E'\r\n'; end if;
  return jsonb_build_object('file_type', p_type, 'purpose', 'weekly', 'chunk_no', 1, 'chunk_of', 1,
    'file_name', p_name, 'stamp_at', p_stamp, 'content', c,
    'sha256', encode(sha256(convert_to(c, 'UTF8')), 'hex'), 'number_records', n,
    'distinct_ids', n, 'control_totals', jsonb_build_object('numberRecords', n), 'issues', p_issues);
end $$;

-- ledger: one filed lot, so a row can link to its entity
insert into public.ccrs_filed_entities (env, file_type, external_id, filed_name, state, source)
values ('prod', 'Inventory', 'WA1.LOT', 'Filed Name', 'seed', 'seed:test')
on conflict do nothing;

-- ---- emit: one transaction, rows parsed from the bytes ---------------------
create temp table r1 as
select public.ccrs_emit_files('prod', jsonb_build_array(
  pg_temp.file('Inventory', 'Inventory_413541_20261007120000.csv', '2026-10-07T19:00:00Z',
    'LicenseNumber,Strain,Area,Product,InitialQuantity,QuantityOnHand,TotalCost,IsMedical,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation',
    array['413541,Blue Dream,Sales Floor,Filed Name,5,3,30.00,FALSE,WA1.LOT,G,10/01/2026,G,10/07/2026,Update',
          '413541,OG,Sales Floor,Ours,2,2,9.99,FALSE,GWL-20261007-000001,G,10/07/2026,,,Insert'],
    '[{"severity":"warning","code":"E40_PRODUCT_NAME_FROM_LEDGER","message":"m"}]'::jsonb),
  pg_temp.file('Inventory', 'Inventory_413541_20261007120001.csv', '2026-10-07T19:00:01Z',
    'LicenseNumber,Strain,Area,Product,InitialQuantity,QuantityOnHand,TotalCost,IsMedical,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation',
    array['413541,OG,Sales Floor,Ours,1,1,1.00,FALSE,GWL-20261007-000002,G,10/07/2026,,,Insert'])
), '[{"severity":"error","code":"E3_EXTERNAL_ID_UNASSIGNED","message":"general"}]'::jsonb) as j;

do $$
declare j jsonb := (select j from r1); fid uuid;
begin
  assert jsonb_array_length(j->'files') = 2, 'two results';
  assert (j->'files'->0->>'status') = 'emitted' and (j->'files'->1->>'status') = 'emitted', 'both emitted';
  fid := (j->'files'->0->>'id')::uuid;
  assert (select state from public.ccrs_files where id = fid) = 'emitted', 'state emitted';
  assert (select number_records from public.ccrs_files where id = fid) = 2, 'number_records from bytes';
  assert (select storage_path from public.ccrs_files where id = fid) = 'db:ccrs_file_contents/' || fid, 'storage path';
  assert (select stamp_at from public.ccrs_files where id = fid) = '2026-10-07T19:00:00Z'::timestamptz, 'stamp stored';
  assert (select emitted_at is not null from public.ccrs_files where id = fid), 'emitted_at set';
  assert (select count(*) from public.ccrs_file_rows where file_id = fid) = 2, 'two rows';
  assert (select operation from public.ccrs_file_rows where file_id = fid and row_no = 1) = 'Update', 'op from bytes';
  assert (select external_id from public.ccrs_file_rows where file_id = fid and row_no = 2) = 'GWL-20261007-000001', 'id from bytes';
  assert (select payload->>'TotalCost' from public.ccrs_file_rows where file_id = fid and row_no = 1) = '30.00', 'payload by header name';
  assert (select entity_id is not null from public.ccrs_file_rows where file_id = fid and row_no = 1), 'filed row linked to its entity';
  assert (select entity_id is null from public.ccrs_file_rows where file_id = fid and row_no = 2), 'new row has no entity yet';
  assert (select state from public.ccrs_file_rows where file_id = fid and row_no = 1) = 'emitted', 'row state emitted';
  assert (select count(*) from public.ccrs_file_issues where file_id = fid and code = 'E40_PRODUCT_NAME_FROM_LEDGER') = 1, 'file issue';
  assert (select count(*) from public.ccrs_file_issues where file_id is null and code = 'E3_EXTERNAL_ID_UNASSIGNED') = 1, 'general issue';
  assert (select octet_length(content) = byte_length from public.ccrs_file_contents where file_id = fid), 'byte length';
  assert (select encode(sha256(convert_to(c.content, 'UTF8')), 'hex') = f.sha256
            from public.ccrs_file_contents c join public.ccrs_files f on f.id = c.file_id where f.id = fid), 'stored bytes re-hash';
end $$;

-- ---- same data never twice (Brian A29) -------------------------------------
create temp table r2 as
select public.ccrs_emit_files('prod', jsonb_build_array(
  pg_temp.file('Inventory', 'Inventory_413541_20261007130000.csv', '2026-10-07T20:00:00Z',
    'LicenseNumber,Strain,Area,Product,InitialQuantity,QuantityOnHand,TotalCost,IsMedical,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation',
    array['413541,OG,Sales Floor,Ours,1,1,1.00,FALSE,GWL-20261007-000002,G,10/07/2026,,,Insert'])
), '[{"severity":"error","code":"X","message":"must not be recorded"}]'::jsonb) as j;
do $$
declare j jsonb := (select j from r2);
begin
  assert (j->'files'->0->>'status') = 'duplicate', 'identical bytes refused';
  assert (j->'files'->0->>'file_name') = 'Inventory_413541_20261007120001.csv', 'existing name returned';
  assert not exists (select 1 from public.ccrs_files where file_name = 'Inventory_413541_20261007130000.csv'), 'nothing written';
  assert not exists (select 1 from public.ccrs_file_issues where code = 'X'), 'no general issue on a pure duplicate';
end $$;
-- a different env may hold the same bytes (Brian A21)
do $$
declare j jsonb;
begin
  j := public.ccrs_emit_files('preprod', jsonb_build_array(
    pg_temp.file('Inventory', 'Inventory_413541_20261007120001_pp.csv', '2026-10-07T19:00:01Z',
      'LicenseNumber,Strain,Area,Product,InitialQuantity,QuantityOnHand,TotalCost,IsMedical,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation',
      array['413541,OG,Sales Floor,Ours,1,1,1.00,FALSE,GWL-20261007-000002,G,10/07/2026,,,Insert'])));
  assert (j->'files'->0->>'status') = 'emitted', 'other env emits';
end $$;

-- ---- stamps strictly increase per env (Part 05 §B) -------------------------
select pg_temp.expect_error($q$select public.ccrs_emit_files('prod', jsonb_build_array(pg_temp.file('Strain','Strain_413541_20261007120001.csv','2026-10-07T19:00:01Z','LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate',array['413541,Zkittlez,Hybrid,G,10/07/2026'])))$q$, 'CCRS_STAMP_NOT_AFTER_LAST');
select pg_temp.expect_error($q$select public.ccrs_emit_files('prod', jsonb_build_array(pg_temp.file('Strain','S.csv','2026-10-07T18:00:00Z','LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate',array['413541,Zkittlez,Hybrid,G,10/07/2026'])))$q$, 'CCRS_STAMP_NOT_AFTER_LAST');
select pg_temp.expect_error($q$select public.ccrs_emit_files('prod', jsonb_build_array(pg_temp.file('Strain','S.csv','2026-10-07T21:00:00Z','LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate',array['413541,Zkittlez,Hybrid,G,10/07/2026']) - 'stamp_at'))$q$, 'CCRS_EMIT_NO_STAMP');

-- ---- byte checks: every one rolls back the whole emission ------------------
-- hash
select pg_temp.expect_error($q$select public.ccrs_emit_files('prod', jsonb_build_array(jsonb_set(pg_temp.file('Strain','S1.csv','2026-10-07T21:00:00Z','LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate',array['413541,Zkittlez,Hybrid,G,10/07/2026']), '{sha256}', to_jsonb(repeat('a',64)))))$q$, 'CCRS_HASH_MISMATCH');
-- NumberRecords header vs data lines (header lies)
select pg_temp.expect_error($q$select public.ccrs_emit_files('prod', jsonb_build_array((select jsonb_set(jsonb_set(x, '{content}', to_jsonb(replace(x->>'content', 'NumberRecords,1', 'NumberRecords,2'))), '{sha256}', to_jsonb(encode(sha256(convert_to(replace(x->>'content', 'NumberRecords,1', 'NumberRecords,2'), 'UTF8')), 'hex'))) from (select pg_temp.file('Strain','S2.csv','2026-10-07T21:00:00Z','LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate',array['413541,Zkittlez,Hybrid,G,10/07/2026']) x) q)))$q$, 'CCRS_RECORD_COUNT_MISMATCH');
-- stated number_records vs data lines
select pg_temp.expect_error($q$select public.ccrs_emit_files('prod', jsonb_build_array(jsonb_set(pg_temp.file('Strain','S3.csv','2026-10-07T21:00:00Z','LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate',array['413541,Zkittlez,Hybrid,G,10/07/2026']), '{number_records}', '5')))$q$, 'CCRS_RECORD_COUNT_MISMATCH');
-- a comma inside a cell shifts the row (CCRS splits on every comma)
select pg_temp.expect_error($q$select public.ccrs_emit_files('prod', jsonb_build_array(pg_temp.file('Strain','S4.csv','2026-10-07T21:00:00Z','LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate',array['413541,Zkittlez, Lemon,Hybrid,G,10/07/2026'])))$q$, 'CCRS_ROW_WIDTH');
select pg_temp.expect_error($q$select public.ccrs_emit_files('prod', jsonb_build_array(pg_temp.file('Strain','S4b.csv','2026-10-07T21:00:00Z','LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate',array['413541,Zkittlez,Hybrid,G'])))$q$, 'CCRS_ROW_WIDTH');
-- no CRLF terminator
select pg_temp.expect_error($q$select public.ccrs_emit_files('prod', jsonb_build_array((select jsonb_set(jsonb_set(x, '{content}', to_jsonb(left(x->>'content', -2))), '{sha256}', to_jsonb(encode(sha256(convert_to(left(x->>'content', -2), 'UTF8')), 'hex'))) from (select pg_temp.file('Strain','S5.csv','2026-10-07T21:00:00Z','LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate',array['413541,Zkittlez,Hybrid,G,10/07/2026']) x) q)))$q$, 'CCRS_NOT_CRLF_TERMINATED');
-- bad env, no files
select pg_temp.expect_error($q$select public.ccrs_emit_files('test', jsonb_build_array(pg_temp.file('Strain','S6.csv','2026-10-07T21:00:00Z','LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate',array['413541,Z,Hybrid,G,10/07/2026'])))$q$, 'CCRS_EMIT_BAD_ENV');
select pg_temp.expect_error($q$select public.ccrs_emit_files('prod', '[]'::jsonb)$q$, 'CCRS_EMIT_NO_FILES');
-- atomicity: a bad SECOND file leaves no trace of the good FIRST file
select pg_temp.expect_error($q$select public.ccrs_emit_files('prod', jsonb_build_array(
  pg_temp.file('Strain','GOOD.csv','2026-10-07T21:00:00Z','LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate',array['413541,Good,Hybrid,G,10/07/2026']),
  jsonb_set(pg_temp.file('Strain','BAD.csv','2026-10-07T21:00:01Z','LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate',array['413541,Bad,Hybrid,G,10/07/2026']), '{sha256}', to_jsonb(repeat('b',64)))))$q$, 'CCRS_HASH_MISMATCH');
do $$ begin assert not exists (select 1 from public.ccrs_files where file_name = 'GOOD.csv'), 'atomic: nothing of the good file'; end $$;

-- ---- in-flight assertion reported (Part 05 §A) ------------------------------
do $$
declare j jsonb; fid uuid;
begin
  j := public.ccrs_emit_files('prod', jsonb_build_array(
    pg_temp.file('Inventory', 'Inventory_413541_20261007140000.csv', '2026-10-07T21:00:00Z',
      'LicenseNumber,Strain,Area,Product,InitialQuantity,QuantityOnHand,TotalCost,IsMedical,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation',
      array['413541,Blue Dream,Sales Floor,Filed Name,5,2,30.00,FALSE,WA1.LOT,G,10/01/2026,G,10/08/2026,Update'])));
  fid := (j->'files'->0->>'id')::uuid;
  assert (j->'files'->0->>'in_flight')::int = 1, 'one in-flight repeat counted';
  assert exists (select 1 from public.ccrs_file_issues where file_id = fid and code = 'W_IN_FLIGHT'), 'W_IN_FLIGHT recorded';
end $$;

-- ---- stored bytes are a record ----------------------------------------------
select pg_temp.expect_error($q$update public.ccrs_file_contents set content = content || 'x'$q$, 'CCRS_CONTENT_IMMUTABLE');
select pg_temp.expect_error($q$delete from public.ccrs_file_contents$q$, 'CCRS_CONTENT_IS_RECORD');
-- a draft's bytes may go (nothing left the building)
insert into public.ccrs_files (id, env, file_type, purpose, file_name) values ('00000000-0000-4000-8000-000000002481', 'prod', 'Strain', 'weekly', 'DRAFT.csv');
select pg_temp.expect_error($q$insert into public.ccrs_file_contents (file_id, content, byte_length) values ('00000000-0000-4000-8000-000000002481', 'abc', 4)$q$, 'ccrs_file_contents_length_matches');
insert into public.ccrs_file_contents (file_id, content, byte_length) values ('00000000-0000-4000-8000-000000002481', 'abc', 3);
delete from public.ccrs_file_contents where file_id = '00000000-0000-4000-8000-000000002481';
delete from public.ccrs_files where id = '00000000-0000-4000-8000-000000002481';
-- still immutable via the 0247 guard: an emitted file's storage_path cannot move
select pg_temp.expect_error($q$update public.ccrs_files set storage_path = 'elsewhere' where state = 'emitted'$q$, 'CCRS_FILE_IMMUTABLE');

-- ---- GWP- assignment (D-01a) ------------------------------------------------
do $$
declare a text; b text; c text;
begin
  select external_id into a from public.ccrs_assign_product_ids('prod', array['key-A']) where product_key = 'key-A';
  select external_id into b from public.ccrs_assign_product_ids('prod', array[' key-A ', 'key-B']) where product_key = 'key-A';
  assert a = b, 'idempotent: same key keeps its id';
  assert a ~ '^GWP-[0-9]{6}$', 'production format';
  assert (select count(*) from public.ccrs_product_ids where env = 'prod') = 2, 'blank/duplicate keys ignored';
  select external_id into c from public.ccrs_assign_product_ids('preprod', array['key-A'], 'test', 'P20261007A');
  assert c ~ '^P20261007A-GWP-[0-9]{6}$', 'PREprod run prefix';
  assert (select newly_assigned from public.ccrs_assign_product_ids('prod', array['key-A'])) = false, 'not newly assigned twice';
end $$;
select pg_temp.expect_error($q$select * from public.ccrs_assign_product_ids('preprod', array['x'])$q$, 'CCRS_ASSIGN_RUN_PREFIX');
select pg_temp.expect_error($q$select * from public.ccrs_assign_product_ids('prod', array['x'], null, 'P20261007A')$q$, 'CCRS_ASSIGN_RUN_PREFIX');
select pg_temp.expect_error($q$update public.ccrs_product_ids set external_id = 'GWP-999999'$q$, 'CCRS_PRODUCT_ID_IS_RECORD');
select pg_temp.expect_error($q$delete from public.ccrs_product_ids$q$, 'CCRS_PRODUCT_ID_IS_RECORD');
select pg_temp.expect_error($q$insert into public.ccrs_product_ids (env, product_key, external_id) values ('prod','z','GWP-12')$q$, 'ccrs_product_ids_external_id_check');
select pg_temp.expect_error($q$insert into public.ccrs_product_ids (env, product_key, external_id) select 'prod', 'other', external_id from public.ccrs_product_ids where env='prod' limit 1$q$, 'ccrs_product_ids_env_ext');

-- ---- lot linking (Part 03 §D.5) ---------------------------------------------
-- refuses on an empty production ledger (nothing to compare against)
savepoint no_ledger;
delete from public.ccrs_file_rows r using public.ccrs_filed_entities e where r.entity_id = e.id and e.env = 'prod' and e.file_type = 'Inventory';
alter table public.ccrs_filed_entities disable trigger user;
delete from public.ccrs_filed_entities where env = 'prod' and file_type = 'Inventory';
alter table public.ccrs_filed_entities enable trigger user;
select pg_temp.expect_error($q$select * from public.ccrs_link_unfiled_migration_lots(false)$q$, 'CCRS_LINK_NO_LEDGER');
rollback to savepoint no_ledger;
insert into public.ccrs_filed_entities (env, file_type, external_id, state, source) values
  ('prod', 'Inventory', 'WA2.CLOSED', 'closed', 'seed:test')
on conflict do nothing;
insert into public.inventory_lots (lot_code, ccrs_inventory_external_id, notes, received_qty, on_hand_qty, status) values
  ('WA1.LOT',    'WA1.LOT',    'Cultivera migration (one-time POS import).', 5, 3, 'active'),
  ('WA2.CLOSED', 'WA2.CLOSED', 'x Cultivera migration (one-time POS import). y', 1, 1, 'active'),
  ('BO-NOTFILED','BO-NOTFILED','Cultivera migration (one-time POS import).', 1, 1, 'active'),
  ('BO-DESTROY', 'BO-DESTROY', 'Cultivera migration (one-time POS import).', 1, 0, 'destroyed'),
  ('NEWLOT',     'GWL-20261007-000009', 'received at intake', 1, 1, 'active');
do $$
declare r record;
begin
  select * into r from public.ccrs_link_unfiled_migration_lots(false);
  assert r.migration_lots = 3 and r.linked_live = 1 and r.linked_closed = 1 and r.unknown_new = 1 and r.unknown_before = 0, format('dry run counts %s', r);
  assert not exists (select 1 from public.ccrs_filed_entities where external_id = 'BO-NOTFILED'), 'dry run wrote nothing';
  select * into r from public.ccrs_link_unfiled_migration_lots(true);
  assert r.unknown_new = 1, 'apply reports the measured-before count';
  assert (select state from public.ccrs_filed_entities where env='prod' and file_type='Inventory' and external_id='BO-NOTFILED') = 'unknown', 'unfiled migration lot -> unknown';
  assert not exists (select 1 from public.ccrs_filed_entities where external_id in ('BO-DESTROY', 'GWL-20261007-000009')), 'destroyed and non-migration lots untouched';
  select * into r from public.ccrs_link_unfiled_migration_lots(true);
  assert r.unknown_new = 0 and r.unknown_before = 1, 'idempotent';
end $$;

-- ---- seed finalize (Part 03 D.4/D.5) ----------------------------------------
-- The real seeded ledger is present (137,008 entities from the 2026-09-18
-- delivery). Remove its provenance rows (test-only bypass) to simulate
-- "entities loaded, not yet finalized", then finalize.
savepoint fin;
alter table public.ccrs_files disable trigger user;
delete from public.ccrs_files where purpose = 'seed';
alter table public.ccrs_files enable trigger user;
-- and the link entities from the section above, so finalize must create them itself
delete from public.ccrs_filed_entities where source = 'link:unfiled-migration-lot';
create temp table exp_ok as select '{"entities":{"Inventory":62744,"Product":64563,"Strain":9692,"Area":9},"inventoryClosed":17998}'::jsonb as e;
create temp table prov_ok as select '[{"file_type":"Inventory","file_name":"Inventory.csv","sha256":"1573a169850e0000000000000000000000000000000000000000000000000000","rows":62744},
  {"file_type":"Product","file_name":"Product_report.csv","sha256":"b95352927fc30000000000000000000000000000000000000000000000000000","rows":64566},
  {"file_type":"Strain","file_name":"Strains.csv","sha256":"160183fcde3a0000000000000000000000000000000000000000000000000000","rows":9736},
  {"file_type":"Area","file_name":"Area.csv","sha256":"47365bd524da0000000000000000000000000000000000000000000000000000","rows":9}]'::jsonb as p;
-- refusals first (nothing is written by a refused call)
select pg_temp.expect_error($q$select public.ccrs_seed_finalize('seed:bogus', (select e from exp_ok), (select p from prov_ok))$q$, 'CCRS_SEED_BAD_SOURCE');
select pg_temp.expect_error($q$select public.ccrs_seed_finalize('seed:2026-09-18-delivery', (select e from exp_ok), (select p - 3 from prov_ok))$q$, 'CCRS_SEED_PROVENANCE');
select pg_temp.expect_error($q$select public.ccrs_seed_finalize('seed:2026-09-18-delivery', (select e from exp_ok), (select jsonb_set(p, '{3,file_type}', '"Inventory"') from prov_ok))$q$, 'CCRS_SEED_PROVENANCE');
select pg_temp.expect_error($q$select public.ccrs_seed_finalize('seed:2026-09-18-delivery', (select e from exp_ok), (select jsonb_set(p, '{0,sha256}', '"XYZ"') from prov_ok))$q$, 'CCRS_SEED_PROVENANCE');
select pg_temp.expect_error($q$select public.ccrs_seed_finalize('seed:2026-09-18-delivery', (select jsonb_set(e, '{entities,Product}', '64564') from exp_ok), (select p from prov_ok))$q$, 'CCRS_SEED_COUNTS');
select pg_temp.expect_error($q$select public.ccrs_seed_finalize('seed:2026-09-18-delivery', (select jsonb_set(e, '{inventoryClosed}', '17997') from exp_ok), (select p from prov_ok))$q$, 'CCRS_SEED_COUNTS');
select pg_temp.expect_error($q$select public.ccrs_seed_finalize('seed:2026-09-17-delivery', (select e from exp_ok), (select p from prov_ok))$q$, 'CCRS_SEED_COUNTS');
do $$ begin assert not exists (select 1 from public.ccrs_files where purpose = 'seed'), 'refused finalize wrote nothing';
  assert not exists (select 1 from public.ccrs_filed_entities where source = 'link:unfiled-migration-lot'), 'refused finalize linked nothing'; end $$;
do $$
declare j jsonb;
begin
  j := public.ccrs_seed_finalize('seed:2026-09-18-delivery', (select e from exp_ok), (select p from prov_ok));
  assert j->>'status' = 'finalized', format('first finalize %s', j);
  assert (select count(*) from public.ccrs_files where purpose = 'seed' and state = 'closed' and env = 'prod') = 4, 'four provenance pseudo-files';
  assert (select number_records from public.ccrs_files where purpose = 'seed' and file_type = 'Product') = 64566, 'provenance keeps SOURCE row count';
  assert (j->'link'->>'migration_lots')::int = 3, format('link ran in the same transaction %s', j);
  assert (select state from public.ccrs_filed_entities where env='prod' and file_type='Inventory' and external_id='BO-NOTFILED') = 'unknown', 'finalize APPLIED the link (unknown entity written)';
  assert (j->'link'->>'unknown_new')::int = 1, 'link counts reported';
  j := public.ccrs_seed_finalize('seed:2026-09-18-delivery', (select e from exp_ok), (select p from prov_ok));
  assert j->>'status' = 'already-finalized', 'second finalize is a no-op';
  assert (select count(*) from public.ccrs_files where purpose = 'seed') = 4, 'no duplicate provenance';
end $$;
-- after finalize, states may legitimately move (routing); the closed-count check is first-finalize only
update public.ccrs_filed_entities set state = 'filed' where id = (select id from public.ccrs_filed_entities where env='prod' and file_type='Inventory' and state='closed' and source='seed:2026-09-18-delivery' limit 1);
do $$ begin assert public.ccrs_seed_finalize('seed:2026-09-18-delivery', (select e from exp_ok), (select p from prov_ok))->>'status' = 'already-finalized', 're-finalize after routing moved a state'; end $$;
rollback to savepoint fin;

-- ---- ledger slice (one call per batch) --------------------------------------
do $$
declare j jsonb; n int; e jsonb;
begin
  -- the real seeded ledger: one live lot, one closed lot, one id CCRS never had
  j := public.ccrs_ledger_slice('prod',
         array[(select external_id from public.ccrs_filed_entities where env='prod' and file_type='Inventory' and state='seed' and source='seed:2026-09-18-delivery' order by external_id limit 1),
               (select external_id from public.ccrs_filed_entities where env='prod' and file_type='Inventory' and state='closed' and source='seed:2026-09-18-delivery' order by external_id limit 1),
               'GWL-20261007-000001'],
         array['Sales Floor']);
  assert (j->>'loaded')::boolean, 'seed provenance present -> loaded';
  assert (select count(*) from jsonb_array_elements(j->'entries') x where x->>0 = 'Inventory') = 2, format('exactly the 2 filed lots asked for, not GWL- (%s)', (select count(*) from jsonb_array_elements(j->'entries') x where x->>0 = 'Inventory'));
  assert (select count(*) from jsonb_array_elements(j->'entries') x where x->>0 = 'Strain') = (select count(*) from public.ccrs_filed_entities where env='prod' and file_type='Strain'), 'every strain';
  assert (select count(*) from jsonb_array_elements(j->'entries') x where x->>0 = 'Area') = (select count(*) from public.ccrs_filed_entities where env='prod' and file_type='Area'), 'every area';
  -- each lot's filed product is included
  for e in select x from jsonb_array_elements(j->'entries') x where x->>0 = 'Inventory' loop
    assert exists (select 1 from jsonb_array_elements(j->'entries') y where y->>0 = 'Product' and y->>1 = e->>4), format('product of lot %s included', e->>1);
  end loop;
  -- a product found by NAME only
  select count(*) into n from jsonb_array_elements(public.ccrs_ledger_slice('prod', '{}', array[(select filed_name from public.ccrs_filed_entities where env='prod' and file_type='Product' and state='seed' order by external_id limit 1)])->'entries') x where x->>0 = 'Product';
  assert n >= 1, 'product by name';
  select count(*) into n from jsonb_array_elements(public.ccrs_ledger_slice('prod', '{}', '{}')->'entries') x where x->>0 in ('Product', 'Inventory');
  assert n = (select count(*) from public.ccrs_filed_entities e join public.ccrs_product_ids c on c.env = e.env and c.external_id = e.external_id where e.env='prod' and e.file_type='Product'), 'nothing else unless asked (assigned GWP- ids only)';
  -- product ids and last stamp
  j := public.ccrs_ledger_slice('prod', '{}', '{}');
  assert jsonb_array_length(j->'product_ids') = (select count(*) from public.ccrs_product_ids where env='prod'), 'every prod assignment';
  assert (j->>'last_stamp')::timestamptz = (select max(stamp_at) from public.ccrs_files where env='prod'), 'last stamp';
  -- envs are separate
  j := public.ccrs_ledger_slice('preprod', '{}', '{}');
  assert not (j->>'loaded')::boolean, 'preprod not loaded';
  assert jsonb_array_length(j->'entries') = 0, 'no prod entries leak into preprod';
  assert (select bool_and(x->>1 like 'P________%') from jsonb_array_elements(j->'product_ids') x) is not false, 'preprod ids only';
end $$;
select pg_temp.expect_error($q$select public.ccrs_ledger_slice('test', '{}', '{}')$q$, 'CCRS_SLICE_BAD_ENV');
-- envs never mix, assigned GWP- products are included, last stamp is per env
savepoint sl_env;
do $$
declare j jsonb; lot text; gwp text;
begin
  lot := (select external_id from public.ccrs_filed_entities where env='prod' and file_type='Inventory' and state='seed' and source='seed:2026-09-18-delivery' order by external_id limit 1);
  -- the same lot id also exists in PREprod (allowed: unique is per env)
  insert into public.ccrs_filed_entities (env, file_type, external_id, state, source) values ('preprod', 'Inventory', lot, 'filed', 'test:sl_env');
  j := public.ccrs_ledger_slice('prod', array[lot], '{}');
  assert (select count(*) from jsonb_array_elements(j->'entries') x where x->>0 = 'Inventory') = 1, 'prod slice: the prod lot only, never the preprod twin';
  assert (select x->>3 from jsonb_array_elements(j->'entries') x where x->>0 = 'Inventory') = 'seed', 'prod twin is the seed row';
  j := public.ccrs_ledger_slice('preprod', array[lot], '{}');
  assert (select count(*) from jsonb_array_elements(j->'entries') x where x->>0 = 'Inventory') = 1, 'preprod slice: the preprod twin only';
  assert (select x->>3 from jsonb_array_elements(j->'entries') x where x->>0 = 'Inventory') = 'filed', 'preprod twin is the filed row';
  assert (j->>'last_stamp')::timestamptz = (select max(stamp_at) from public.ccrs_files where env='preprod'), 'preprod last stamp is preprod''s own';
  assert (j->>'last_stamp')::timestamptz < (select max(stamp_at) from public.ccrs_files where env='prod'), 'fixture: prod stamps are later, so a mixed max would show';
  -- a Product held under an assigned GWP- id is in the slice even when no lot or name asks for it
  gwp := (select external_id from public.ccrs_product_ids where env='prod' order by external_id limit 1);
  assert gwp is not null, 'fixture: a prod GWP- assignment exists';
  insert into public.ccrs_filed_entities (env, file_type, external_id, filed_name, state, source) values ('prod', 'Product', gwp, 'Assigned Product Name Only', 'filed', 'test:sl_env');
  j := public.ccrs_ledger_slice('prod', '{}', '{}');
  assert exists (select 1 from jsonb_array_elements(j->'entries') x where x->>0 = 'Product' and x->>1 = gwp), 'assigned GWP- product included';
end $$;
rollback to savepoint sl_env;
-- not loaded until finalize recorded provenance
savepoint sl;
alter table public.ccrs_files disable trigger user;
delete from public.ccrs_files where purpose = 'seed';
alter table public.ccrs_files enable trigger user;
do $$ begin assert not (public.ccrs_ledger_slice('prod', '{}', '{}')->>'loaded')::boolean, 'no provenance -> not loaded'; end $$;
rollback to savepoint sl;

-- ---- grants: service role only ----------------------------------------------
do $$
begin
  assert not has_function_privilege('authenticated', 'public.ccrs_emit_files(text, jsonb, jsonb)', 'execute'), 'authenticated cannot emit';
  assert not has_function_privilege('anon', 'public.ccrs_assign_product_ids(text, text[], text, text)', 'execute'), 'anon cannot assign';
  assert not has_function_privilege('authenticated', 'public.ccrs_link_unfiled_migration_lots(boolean)', 'execute'), 'authenticated cannot link';
  assert has_function_privilege('service_role', 'public.ccrs_emit_files(text, jsonb, jsonb)', 'execute'), 'service role emits';
  assert not has_function_privilege('authenticated', 'public.ccrs_seed_finalize(text, jsonb, jsonb)', 'execute'), 'authenticated cannot finalize';
  assert has_function_privilege('service_role', 'public.ccrs_seed_finalize(text, jsonb, jsonb)', 'execute'), 'service role finalizes';
  assert not has_function_privilege('authenticated', 'public.ccrs_ledger_slice(text, text[], text[])', 'execute'), 'authenticated cannot read the slice';
  assert has_function_privilege('service_role', 'public.ccrs_ledger_slice(text, text[], text[])', 'execute'), 'service role reads the slice';
  assert (select relrowsecurity from pg_class where oid = 'public.ccrs_file_contents'::regclass), 'RLS on contents';
  assert (select relrowsecurity from pg_class where oid = 'public.ccrs_product_ids'::regclass), 'RLS on product ids';
end $$;

-- ---- rollback: refuses while records exist, drops cleanly when not -------
-- The REAL rollback file is loaded into a psql variable and executed, so
-- the test exercises the shipped refusal, not a copy of it.
\set rb `cat supabase/rollbacks/0248_ccrs_outbox.rollback.sql`
-- 1) product ids exist -> refused
select pg_temp.expect_error(:'rb', 'ROLLBACK_REFUSED: ccrs_product_ids');
-- 2) remove product ids (test-only trigger bypass) -> still refused: emitted files
savepoint rb1;
alter table public.ccrs_product_ids disable trigger user;
delete from public.ccrs_product_ids;
alter table public.ccrs_product_ids enable trigger user;
select pg_temp.expect_error(:'rb', 'ROLLBACK_REFUSED: ccrs_files holds emitted');
-- 3) no emitted outbox files either, but a link entity moved past unknown -> refused
alter table public.ccrs_files disable trigger user;
update public.ccrs_files set stamp_at = null where stamp_at is not null;
alter table public.ccrs_files enable trigger user;
alter table public.ccrs_filed_entities disable trigger user;
update public.ccrs_filed_entities set state = 'filed' where source = 'link:unfiled-migration-lot';
select pg_temp.expect_error(:'rb', 'ROLLBACK_REFUSED: a linked lot entity');
-- 4) nothing recorded -> the real rollback runs and removes every 0248 object
update public.ccrs_filed_entities set state = 'unknown' where source = 'link:unfiled-migration-lot';
alter table public.ccrs_filed_entities enable trigger user;
select :'rb' as rb_sql \gset
:rb
do $$
begin
  assert to_regclass('public.ccrs_file_contents') is null, 'contents dropped';
  assert to_regclass('public.ccrs_product_ids') is null, 'product ids dropped';
  assert to_regclass('public.ccrs_gwp_seq') is null, 'sequence dropped';
  assert to_regprocedure('public.ccrs_emit_files(text, jsonb, jsonb)') is null, 'emit dropped';
  assert to_regprocedure('public.ccrs_seed_finalize(text, jsonb, jsonb)') is null, 'finalize dropped';
  assert to_regprocedure('public.ccrs_ledger_slice(text, text[], text[])') is null, 'slice dropped';
  assert not exists (select 1 from information_schema.columns where table_name = 'ccrs_files' and column_name in ('stamp_at', 'control_totals')), 'columns dropped';
  assert not exists (select 1 from public.ccrs_filed_entities where source = 'link:unfiled-migration-lot'), 'unknown link entities removed';
end $$;
-- 5) and 0248 re-applies on top of the rolled-back state
\i supabase/migrations/0248_ccrs_outbox.sql
rollback to savepoint rb1;

\echo CCRS OUTBOX CHECK PASSED
rollback;
