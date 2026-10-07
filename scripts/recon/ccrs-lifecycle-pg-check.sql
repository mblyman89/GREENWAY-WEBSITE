-- scripts/recon/ccrs-lifecycle-pg-check.sql  (CCRS Bible v2 S-12c - migration 0249)
--
-- Scenario check for 0249_ccrs_upload_lifecycle.sql on a real Postgres with
-- every migration through 0249 applied. ONE transaction, rolled back: leaves
-- nothing behind. Applies 0249 twice (idempotency), walks real file
-- lifecycles end to end (emit -> upload -> CCRS answer -> ledger), proves
-- every guard by attempting the forbidden thing and requiring the exact
-- error, and proves the rollback drops the functions but keeps the record.
-- A run printing CCRS LIFECYCLE CHECK PASSED then ROLLBACK is the all-clear.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ccrs-lifecycle-pg-check.sql
begin;

-- clean slate for the ccrs record inside this rolled-back transaction
do $$ begin
  execute 'alter table public.ccrs_files disable trigger user';
  execute 'alter table public.ccrs_file_contents disable trigger user';
  execute 'alter table public.ccrs_product_ids disable trigger user';
  delete from public.ccrs_file_issues;
  delete from public.ccrs_file_rows;
  delete from public.ccrs_file_contents;
  delete from public.ccrs_filed_entities;
  delete from public.ccrs_files;
  delete from public.ccrs_product_ids;
  execute 'alter table public.ccrs_files enable trigger user';
  execute 'alter table public.ccrs_file_contents enable trigger user';
  execute 'alter table public.ccrs_product_ids enable trigger user';
end $$;

-- clean start: drop the 0249 functions (create-or-replace would otherwise
-- keep the grants of the database this runs on), then apply twice
\i supabase/rollbacks/0249_ccrs_upload_lifecycle.rollback.sql
do $$ begin assert to_regprocedure('public.ccrs_record_outcome(uuid,text,timestamptz,jsonb,text[])') is null, 'clean start'; end $$;
\i supabase/migrations/0249_ccrs_upload_lifecycle.sql
\i supabase/migrations/0249_ccrs_upload_lifecycle.sql

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

-- one data line, values by column name, blanks elsewhere
create or replace function pg_temp.line(p_cols text, p_kv jsonb) returns text language sql as $$
  select string_agg(coalesce(p_kv->>c, ''), ',' order by n)
    from unnest(string_to_array(p_cols, ',')) with ordinality as u(c, n)
$$;

create or replace function pg_temp.file(p_type text, p_name text, p_stamp text, p_rows jsonb)
returns jsonb language plpgsql as $$
declare
  cols text := case p_type
    when 'Strain' then 'LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate'
    when 'Area' then 'LicenseNumber,Area,IsQuarantine,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation'
    when 'Product' then 'LicenseNumber,InventoryCategory,InventoryType,Name,Description,UnitWeightGrams,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation'
    when 'Inventory' then 'LicenseNumber,Strain,Area,Product,InitialQuantity,QuantityOnHand,TotalCost,IsMedical,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation'
    when 'Sale' then 'LicenseNumber,SoldToLicenseNumber,InventoryExternalIdentifier,PlantExternalIdentifier,SaleType,SaleDate,Quantity,UnitPrice,Discount,RetailSalesTax,CannabisExciseTax,SaleExternalIdentifier,SaleDetailExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation'
  end;
  n int := jsonb_array_length(p_rows);
  c text;
begin
  c := 'SubmittedBy,Greenway' || E'\r\n' || 'SubmittedDate,10/07/2026' || E'\r\n' || 'NumberRecords,' || n || E'\r\n' || cols || E'\r\n';
  c := c || (select string_agg(pg_temp.line(cols, jsonb_build_object('LicenseNumber', '413541', 'CreatedBy', 'G', 'CreatedDate', '10/07/2026') || r), E'\r\n' order by k)
               from jsonb_array_elements(p_rows) with ordinality as x(r, k)) || E'\r\n';
  return jsonb_build_object('file_type', p_type, 'purpose', 'weekly', 'chunk_no', 1, 'chunk_of', 1,
    'file_name', p_name, 'stamp_at', p_stamp, 'content', c,
    'sha256', encode(sha256(convert_to(c, 'UTF8')), 'hex'), 'number_records', n,
    'distinct_ids', n, 'control_totals', jsonb_build_object('numberRecords', n), 'issues', '[]'::jsonb);
end $$;

create or replace function pg_temp.fid(p_name text) returns uuid language sql as $$
  select id from public.ccrs_files where file_name = p_name $$;
create or replace function pg_temp.fstate(p_name text) returns text language sql as $$
  select state from public.ccrs_files where file_name = p_name $$;
create or replace function pg_temp.rstate(p_name text, p_row int) returns text language sql as $$
  select r.state from public.ccrs_file_rows r join public.ccrs_files f on f.id = r.file_id
   where f.file_name = p_name and r.row_no = p_row $$;
create or replace function pg_temp.estate(p_type text, p_id text) returns text language sql as $$
  select state from public.ccrs_filed_entities where env = 'prod' and file_type = p_type and external_id = p_id $$;

-- ---- the prod ledger as the seed left it ----------------------------------
insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path, state, notes)
values ('prod', 'Inventory', 'seed', 'seed:test', repeat('b', 64), 4, 'none', 'closed', 'test seed');
insert into public.ccrs_filed_entities (env, file_type, external_id, filed_name, product_external_id, state, source) values
  ('prod', 'Strain', 'Blue Dream', 'Blue Dream', null, 'seed', 'seed:test'),
  ('prod', 'Area', 'AREA-1', 'Sales Floor', null, 'seed', 'seed:test'),
  ('prod', 'Product', 'GWP-000001', 'Old Product', null, 'seed', 'seed:test'),
  ('prod', 'Inventory', 'WA1.LOT', 'WA1.LOT', 'GWP-000001', 'seed', 'seed:test');

-- ---- emission 1: Group 1 -> 2 -> 3 ----------------------------------------
select public.ccrs_emit_files('prod', jsonb_build_array(
  pg_temp.file('Strain', 'F1_Strain.csv', '2026-10-07T19:00:01Z', '[{"Strain":"Zkittlez","StrainType":"Hybrid"}]'),
  pg_temp.file('Product', 'F2_Product.csv', '2026-10-07T19:00:02Z',
    '[{"InventoryCategory":"EndProduct","InventoryType":"Usable Marijuana","Name":"New Product","UnitWeightGrams":"1","ExternalIdentifier":"GWP-000002","Operation":"Insert"},
      {"InventoryCategory":"EndProduct","InventoryType":"Usable Marijuana","Name":"Old Product","UnitWeightGrams":"1","ExternalIdentifier":"GWP-000001","UpdatedBy":"G","UpdatedDate":"10/07/2026","Operation":"Update"}]'),
  pg_temp.file('Inventory', 'F3_Inventory.csv', '2026-10-07T19:00:03Z',
    '[{"Strain":"zkittlez","Area":"Sales Floor","Product":"New Product","InitialQuantity":"5","QuantityOnHand":"5","TotalCost":"10.00","IsMedical":"FALSE","ExternalIdentifier":"GWL-1","Operation":"Insert"},
      {"Strain":"Zkittlez","Area":"Sales Floor","Product":"New Product","InitialQuantity":"2","QuantityOnHand":"0","TotalCost":"4.00","IsMedical":"FALSE","ExternalIdentifier":"GWL-2","Operation":"Insert"},
      {"Strain":"Blue Dream","Area":"Sales Floor","Product":"Old Product","InitialQuantity":"9","QuantityOnHand":"3","TotalCost":"30.00","IsMedical":"FALSE","ExternalIdentifier":"WA1.LOT","UpdatedBy":"G","UpdatedDate":"10/07/2026","Operation":"Update"}]'),
  pg_temp.file('Sale', 'F4_Sale.csv', '2026-10-07T19:00:04Z',
    '[{"InventoryExternalIdentifier":"GWL-1","SaleType":"RecreationalRetail","SaleDate":"10/07/2026","Quantity":"1","UnitPrice":"10.00","Discount":"0","RetailSalesTax":"0.95","CannabisExciseTax":"3.70","SaleExternalIdentifier":"S1","SaleDetailExternalIdentifier":"S1-a","Operation":"Insert"},
      {"InventoryExternalIdentifier":"WA1.LOT","SaleType":"RecreationalRetail","SaleDate":"10/07/2026","Quantity":"1","UnitPrice":"10.00","Discount":"0","RetailSalesTax":"0.95","CannabisExciseTax":"3.70","SaleExternalIdentifier":"S1","SaleDetailExternalIdentifier":"S1-b","Operation":"Insert"},
      {"InventoryExternalIdentifier":"GWL-NOPE","SaleType":"RecreationalRetail","SaleDate":"10/07/2026","Quantity":"1","UnitPrice":"10.00","Discount":"0","RetailSalesTax":"0.95","CannabisExciseTax":"3.70","SaleExternalIdentifier":"S1","SaleDetailExternalIdentifier":"S1-c","Operation":"Insert"}]')
));
do $$ begin
  assert (select count(*) from public.ccrs_files where state = 'emitted') = 4, 'four emitted';
  assert public.ccrs_upload_group('Strain') = 1 and public.ccrs_upload_group('Inventory') = 2 and public.ccrs_upload_group('Sale') = 3
     and public.ccrs_upload_group('InventoryAdjustment') = 3 and public.ccrs_upload_group('Area') = 1 and public.ccrs_upload_group('Product') = 1
     and public.ccrs_upload_group('InventoryTransfer') = 3 and public.ccrs_upload_group('Nope') is null, 'upload groups';
end $$;

-- ---- mark_uploaded guards --------------------------------------------------
select pg_temp.expect_error($q$select public.ccrs_mark_uploaded(gen_random_uuid(), now())$q$, 'CCRS_FILE_NOT_FOUND');
select pg_temp.expect_error($q$select public.ccrs_mark_uploaded(pg_temp.fid('F1_Strain.csv'), now() + interval '1 hour')$q$, 'CCRS_UPLOAD_TIME');
select pg_temp.expect_error($q$select public.ccrs_mark_uploaded(pg_temp.fid('F1_Strain.csv'), now() - interval '1 hour')$q$, 'CCRS_UPLOAD_TIME');
select pg_temp.expect_error($q$select public.ccrs_mark_uploaded(pg_temp.fid('F1_Strain.csv'), null)$q$, 'CCRS_UPLOAD_TIME');
-- pacing: F2 waits on F1 (emitted, never uploaded)
select pg_temp.expect_error($q$select public.ccrs_mark_uploaded(pg_temp.fid('F2_Product.csv'), now())$q$, 'F1_Strain.csv (emitted)');
-- a too-short override is no override
select pg_temp.expect_error($q$select public.ccrs_mark_uploaded(pg_temp.fid('F2_Product.csv'), now(), null, 'short')$q$, 'CCRS_UPLOAD_NOT_READY');
-- bytes that no longer hash (only reachable past the 0248 immutability trigger)
do $$ begin
  execute 'alter table public.ccrs_file_contents disable trigger user';
  update public.ccrs_file_contents set content = replace(content, 'Zkittlez', 'Zkittlex') where file_id = pg_temp.fid('F1_Strain.csv');
  execute 'alter table public.ccrs_file_contents enable trigger user';
end $$;
select pg_temp.expect_error($q$select public.ccrs_mark_uploaded(pg_temp.fid('F1_Strain.csv'), now())$q$, 'CCRS_UPLOAD_BYTES_CHANGED');
do $$ begin
  execute 'alter table public.ccrs_file_contents disable trigger user';
  update public.ccrs_file_contents set content = replace(content, 'Zkittlex', 'Zkittlez') where file_id = pg_temp.fid('F1_Strain.csv');
  execute 'alter table public.ccrs_file_contents enable trigger user';
end $$;

-- ---- F1 Strain: upload, every outcome guard, then success -------------------
do $$
declare j jsonb;
begin
  j := public.ccrs_mark_uploaded(pg_temp.fid('F1_Strain.csv'), now(), null, null);
  assert j->>'state' = 'uploaded' and (j->>'overridden')::boolean = false, 'F1 uploaded, no override';
  assert pg_temp.fstate('F1_Strain.csv') = 'uploaded', 'F1 state';
  assert (select uploaded_at = now() from public.ccrs_files where file_name = 'F1_Strain.csv'), 'uploaded_at stored';
  assert pg_temp.rstate('F1_Strain.csv', 1) = 'submitted', 'F1 row submitted';
  assert (select notes is null from public.ccrs_files where file_name = 'F1_Strain.csv'), 'no override note';
end $$;
select pg_temp.expect_error($q$select public.ccrs_mark_uploaded(pg_temp.fid('F1_Strain.csv'), now())$q$, 'CCRS_UPLOAD_NOT_EMITTED');
select pg_temp.expect_error($q$select public.ccrs_record_outcome(pg_temp.fid('F2_Product.csv'), 'success', now())$q$, 'CCRS_OUTCOME_NOT_UPLOADED');
select pg_temp.expect_error($q$select public.ccrs_record_outcome(pg_temp.fid('F1_Strain.csv'), 'bogus', now())$q$, 'CCRS_OUTCOME_BAD');
select pg_temp.expect_error($q$select public.ccrs_record_outcome(pg_temp.fid('F1_Strain.csv'), null, now())$q$, 'CCRS_OUTCOME_BAD');
select pg_temp.expect_error($q$select public.ccrs_record_outcome(pg_temp.fid('F1_Strain.csv'), 'success', now() - interval '6 minutes')$q$, 'CCRS_OUTCOME_TIME');
select pg_temp.expect_error($q$select public.ccrs_record_outcome(pg_temp.fid('F1_Strain.csv'), 'success', now() + interval '6 minutes')$q$, 'CCRS_OUTCOME_TIME');
select pg_temp.expect_error($q$select public.ccrs_record_outcome(pg_temp.fid('F1_Strain.csv'), 'no-email', now())$q$, 'CCRS_OUTCOME_SLA_NOT_REACHED');
select pg_temp.expect_error($q$select public.ccrs_record_outcome(pg_temp.fid('F1_Strain.csv'), 'error-fatal', now())$q$, 'CCRS_OUTCOME_NO_MESSAGES');
select pg_temp.expect_error($q$select public.ccrs_record_outcome(pg_temp.fid('F1_Strain.csv'), 'error-unmatched', now(), '[]', '{}')$q$, 'CCRS_OUTCOME_NO_MESSAGES');
select pg_temp.expect_error($q$select public.ccrs_record_outcome(pg_temp.fid('F1_Strain.csv'), 'success', now(), '[{"row_no":1,"message":"m","uncertain":false}]')$q$, 'CCRS_OUTCOME_BAD_REJECTED');
select pg_temp.expect_error($q$select public.ccrs_record_outcome(pg_temp.fid('F1_Strain.csv'), 'error-rows', now(), '[]', '{m}')$q$, 'CCRS_OUTCOME_BAD_REJECTED');
select pg_temp.expect_error($q$select public.ccrs_record_outcome(pg_temp.fid('F1_Strain.csv'), 'error-rows', now(), '{"row_no":1}', '{m}')$q$, 'CCRS_OUTCOME_BAD_REJECTED');
select pg_temp.expect_error($q$select public.ccrs_record_outcome(pg_temp.fid('F1_Strain.csv'), 'error-rows', now(), '[{"row_no":9,"message":"m","uncertain":false}]', '{m}')$q$, 'CCRS_OUTCOME_BAD_REJECTED');
select pg_temp.expect_error($q$select public.ccrs_record_outcome(pg_temp.fid('F1_Strain.csv'), 'error-rows', now(), '[{"row_no":"1","message":"m","uncertain":false}]', '{m}')$q$, 'CCRS_OUTCOME_BAD_REJECTED');
select pg_temp.expect_error($q$select public.ccrs_record_outcome(pg_temp.fid('F1_Strain.csv'), 'error-rows', now(), '[{"row_no":1,"message":"","uncertain":false}]', '{m}')$q$, 'CCRS_OUTCOME_BAD_REJECTED');
select pg_temp.expect_error($q$select public.ccrs_record_outcome(pg_temp.fid('F1_Strain.csv'), 'error-rows', now(), '[{"row_no":1,"message":"m"}]', '{m}')$q$, 'CCRS_OUTCOME_BAD_REJECTED');
select pg_temp.expect_error($q$select public.ccrs_record_outcome(pg_temp.fid('F1_Strain.csv'), 'error-rows', now(), '[{"row_no":1,"message":"m","uncertain":false},{"row_no":1,"message":"m","uncertain":false}]', '{m}')$q$, 'CCRS_OUTCOME_BAD_REJECTED');
do $$
declare j jsonb;
begin
  j := public.ccrs_record_outcome(pg_temp.fid('F1_Strain.csv'), 'success', now());
  assert j->>'state' = 'closed', 'Strain closes on success: ' || j::text;
  assert (j->'rows'->>'total')::int = 1 and (j->'rows'->>'landed')::int = 1, 'rows summary';
  assert pg_temp.fstate('F1_Strain.csv') = 'closed', 'F1 closed';
  assert (select success_email_at = now() from public.ccrs_files where file_name = 'F1_Strain.csv'), 'success_email_at';
  assert pg_temp.rstate('F1_Strain.csv', 1) = 'confirmed', 'closable row confirmed';
  assert pg_temp.estate('Strain', 'Zkittlez') = 'filed', 'new strain filed';
  assert (select filed_name = 'Zkittlez' and last_operation = 'Insert' and source = 'file:F1_Strain.csv' and first_filed_at = now()
            from public.ccrs_filed_entities where env = 'prod' and external_id = 'Zkittlez'), 'strain entity fields';
  assert (select entity_id is not null from public.ccrs_file_rows r join public.ccrs_files f on f.id = r.file_id where f.file_name = 'F1_Strain.csv'), 'row linked';
end $$;
select pg_temp.expect_error($q$select public.ccrs_record_outcome(pg_temp.fid('F1_Strain.csv'), 'success', now())$q$, 'CCRS_OUTCOME_NOT_UPLOADED');

-- ---- F3 waits on F2 AND on the Product it names ------------------------------
select pg_temp.expect_error($q$select public.ccrs_mark_uploaded(pg_temp.fid('F3_Inventory.csv'), now())$q$, 'Product "New Product"');
select pg_temp.expect_error($q$select public.ccrs_mark_uploaded(pg_temp.fid('F3_Inventory.csv'), now())$q$, 'F2_Product.csv (emitted)');

-- ---- F2 Product: one row rejected, the other landed ------------------------
do $$
declare j jsonb;
begin
  perform public.ccrs_mark_uploaded(pg_temp.fid('F2_Product.csv'), now());
  j := public.ccrs_record_outcome(pg_temp.fid('F2_Product.csv'), 'error-rows', now(),
         '[{"row_no":2,"message":"UnitWeightGrams is required","uncertain":false}]', array['UnitWeightGrams is required']);
  assert j->>'state' = 'errored', 'Product file stays errored (not closable): ' || j::text;
  assert (j->'rows'->>'rejected')::int = 1 and (j->'rows'->>'landed')::int = 1, 'partition';
  assert pg_temp.rstate('F2_Product.csv', 1) = 'submitted', 'Product row landed but not yet confirmed';
  assert pg_temp.rstate('F2_Product.csv', 2) = 'rejected', 'row 2 rejected';
  assert pg_temp.estate('Product', 'GWP-000002') = 'filed', 'new product filed';
  assert (select filed_name from public.ccrs_filed_entities where env = 'prod' and external_id = 'GWP-000002') = 'New Product', 'Product filed_name = Name';
  assert pg_temp.estate('Product', 'GWP-000001') = 'seed', 'rejected Update leaves the entity alone';
  assert (select last_operation is null from public.ccrs_filed_entities where env = 'prod' and external_id = 'GWP-000001'), 'rejected Update not applied';
  assert (select error_messages = array['UnitWeightGrams is required'] and error_email_at = now() from public.ccrs_files where file_name = 'F2_Product.csv'), 'messages stored';
  assert (select count(*) from public.ccrs_file_issues i where i.file_id = pg_temp.fid('F2_Product.csv') and i.code = 'CCRS_ROW_REJECTED'
            and i.message like 'row 2 (GWP-000001): UnitWeightGrams%' and i.row_id is not null) = 1, 'row issue';
end $$;

-- ---- F3 Inventory: dependencies now held (strain matched case-insensitively) --
do $$
declare j jsonb;
begin
  j := public.ccrs_mark_uploaded(pg_temp.fid('F3_Inventory.csv'), now());
  assert (j->>'overridden')::boolean = false, 'F3 not blocked once F2 answered and its product is held';
  j := public.ccrs_record_outcome(pg_temp.fid('F3_Inventory.csv'), 'success', now());
  assert j->>'state' = 'succeeded', 'Inventory waits for proof: ' || j::text;
  assert (j->>'earlier_files_closed')::int = 0, 'nothing earlier of this type';
  assert pg_temp.estate('Inventory', 'GWL-1') = 'filed', 'GWL-1 filed';
  assert (select product_external_id from public.ccrs_filed_entities where env = 'prod' and external_id = 'GWL-1') = 'GWP-000002', 'lot -> its one product';
  assert pg_temp.estate('Inventory', 'GWL-2') = 'closed', 'QoH 0 Insert -> closed';
  assert pg_temp.estate('Inventory', 'WA1.LOT') = 'seed', 'Update keeps seed state';
  assert (select last_operation = 'Update' and last_payload->>'QuantityOnHand' = '3' from public.ccrs_filed_entities where env = 'prod' and external_id = 'WA1.LOT'), 'Update recorded';
  assert not exists (select 1 from public.ccrs_file_issues where file_id = pg_temp.fid('F3_Inventory.csv') and code = 'W_LOT_PRODUCT_UNRESOLVED'), 'every lot resolved';
end $$;

-- ---- F4 Sale: an unheld lot blocks; a logged override proceeds -------------
select pg_temp.expect_error($q$select public.ccrs_mark_uploaded(pg_temp.fid('F4_Sale.csv'), now())$q$, 'lot GWL-NOPE');
select pg_temp.expect_error($q$select public.ccrs_mark_uploaded(pg_temp.fid('F4_Sale.csv'), now(), null, '         x')$q$, 'CCRS_UPLOAD_NOT_READY');
do $$
declare j jsonb;
begin
  j := public.ccrs_mark_uploaded(pg_temp.fid('F4_Sale.csv'), now(), null, 'PREprod test: expect row 3 to fail');
  assert (j->>'overridden')::boolean and jsonb_array_length(j->'waiting_on') = 1, 'override reported';
  assert (select notes like 'UPLOAD ORDER OVERRIDE: PREprod test: expect row 3 to fail [was waiting on: CCRS does not hold 1 thing(s) this file names: lot GWL-NOPE]'
            from public.ccrs_files where file_name = 'F4_Sale.csv'), 'override logged verbatim';
  j := public.ccrs_record_outcome(pg_temp.fid('F4_Sale.csv'), 'error-rows', now(),
         '[{"row_no":3,"message":"InventoryExternalIdentifier not found","uncertain":false}]', array['InventoryExternalIdentifier not found']);
  assert j->>'state' = 'closed', 'Sale closes after a row-level error: ' || j::text;
  assert pg_temp.rstate('F4_Sale.csv', 1) = 'confirmed' and pg_temp.rstate('F4_Sale.csv', 2) = 'confirmed', 'landed sale rows confirmed';
  assert pg_temp.rstate('F4_Sale.csv', 3) = 'rejected', 'row 3 rejected';
  assert pg_temp.estate('Sale', 'S1-a') = 'filed' and pg_temp.estate('Sale', 'S1-c') is null, 'sale detail ids tracked; rejected not';
end $$;

-- ---- emission 2 --------------------------------------------------------------
select public.ccrs_emit_files('prod', jsonb_build_array(
  pg_temp.file('Inventory', 'F5_Inventory.csv', '2026-10-07T20:00:01Z',
    '[{"Strain":"Zkittlez","Area":"Sales Floor","Product":"New Product","InitialQuantity":"5","QuantityOnHand":"4","TotalCost":"10.00","IsMedical":"FALSE","ExternalIdentifier":"GWL-1","UpdatedBy":"G","UpdatedDate":"10/07/2026","Operation":"Update"},
      {"Strain":"Zkittlez","Area":"Sales Floor","Product":"New Product","InitialQuantity":"2","QuantityOnHand":"0","TotalCost":"4.00","IsMedical":"FALSE","ExternalIdentifier":"GWL-2","UpdatedBy":"G","UpdatedDate":"10/07/2026","Operation":"Update"}]'),
  pg_temp.file('Inventory', 'F6_Inventory.csv', '2026-10-07T20:00:02Z',
    '[{"Strain":"Blue Dream","Area":"Sales Floor","Product":"Old Product","InitialQuantity":"9","QuantityOnHand":"2","TotalCost":"30.00","IsMedical":"FALSE","ExternalIdentifier":"WA1.LOT","UpdatedBy":"G","UpdatedDate":"10/07/2026","Operation":"Update"},
      {"Strain":"Zkittlez","Area":"Sales Floor","Product":"New Product","InitialQuantity":"2","QuantityOnHand":"2","TotalCost":"4.00","IsMedical":"FALSE","ExternalIdentifier":"GWL-2","UpdatedBy":"G","UpdatedDate":"10/07/2026","Operation":"Update"},
      {"Strain":"Zkittlez","Area":"Sales Floor","Product":"Nowhere Product","InitialQuantity":"1","QuantityOnHand":"1","TotalCost":"1.00","IsMedical":"FALSE","ExternalIdentifier":"GWL-3","Operation":"Insert"}]'),
  pg_temp.file('Strain', 'F7_Strain.csv', '2026-10-07T20:00:03Z', '[{"Strain":"Gelato","StrainType":"Hybrid"}]'),
  pg_temp.file('Area', 'F8_Area.csv', '2026-10-07T20:00:04Z', '[{"Area":"Back Room","IsQuarantine":"FALSE","ExternalIdentifier":"AREA-2","Operation":"Insert"}]'),
  pg_temp.file('Strain', 'F9_Strain.csv', '2026-10-07T20:00:05Z', '[{"Strain":"Runtz","StrainType":"Hybrid"}]'),
  pg_temp.file('Product', 'F10_Product.csv', '2026-10-07T20:00:06Z',
    '[{"InventoryCategory":"EndProduct","InventoryType":"Usable Marijuana","Name":"Third","UnitWeightGrams":"1","ExternalIdentifier":"GWP-000003","Operation":"Insert"},
      {"InventoryCategory":"EndProduct","InventoryType":"Usable Marijuana","Name":"Old Product","UnitWeightGrams":"1","ExternalIdentifier":"GWP-000001","UpdatedBy":"G","UpdatedDate":"10/07/2026","Operation":"Update"},
      {"InventoryCategory":"EndProduct","InventoryType":"Usable Marijuana","Name":"New Product Renamed","UnitWeightGrams":"1","ExternalIdentifier":"GWP-000002","UpdatedBy":"G","UpdatedDate":"10/07/2026","Operation":"Update"}]'),
  pg_temp.file('Strain', 'F11_Strain.csv', '2026-10-07T20:00:07Z', '[{"Strain":"Duped","StrainType":"Hybrid"}]'),
  pg_temp.file('Area', 'F12_Area.csv', '2026-10-07T20:00:08Z', '[{"Area":"Never","IsQuarantine":"FALSE","ExternalIdentifier":"AREA-9","Operation":"Insert"}]')
));

-- F5: a later successful Update proves GWL-1 and GWL-2 exist; F3 still has WA1.LOT open
do $$
declare j jsonb;
begin
  perform public.ccrs_mark_uploaded(pg_temp.fid('F5_Inventory.csv'), now());
  j := public.ccrs_record_outcome(pg_temp.fid('F5_Inventory.csv'), 'success', now());
  assert (j->>'earlier_files_closed')::int = 0, 'F3 not closed while WA1.LOT row is unproven: ' || j::text;
  assert pg_temp.rstate('F3_Inventory.csv', 1) = 'confirmed' and pg_temp.rstate('F3_Inventory.csv', 2) = 'confirmed', 'proved rows confirmed';
  assert pg_temp.rstate('F3_Inventory.csv', 3) = 'submitted', 'unproved row untouched';
  assert pg_temp.estate('Inventory', 'GWL-1') = 'confirmed', 'filed -> confirmed by proof';
  assert pg_temp.estate('Inventory', 'GWL-2') = 'closed', 'closed lot stays closed at QoH 0';
  assert pg_temp.fstate('F3_Inventory.csv') = 'succeeded', 'F3 still open';
  assert pg_temp.fstate('F2_Product.csv') = 'errored', 'other types untouched';
end $$;

-- F6: proves WA1.LOT -> F3 closes; re-opens GWL-2; an unresolvable product is reported
do $$
declare j jsonb;
begin
  perform public.ccrs_mark_uploaded(pg_temp.fid('F6_Inventory.csv'), now(), null, 'test: lot names a product nobody holds');
  j := public.ccrs_record_outcome(pg_temp.fid('F6_Inventory.csv'), 'success', now());
  assert (j->>'earlier_files_closed')::int = 1, 'F3 closes: ' || j::text;
  assert pg_temp.fstate('F3_Inventory.csv') = 'closed', 'F3 closed';
  assert pg_temp.fstate('F5_Inventory.csv') = 'succeeded', 'F5 rows unproven yet';
  assert pg_temp.estate('Inventory', 'GWL-2') = 'confirmed', 'closed lot updated above 0 re-opens (filed), and this successful Update proves it (confirmed)';
  assert pg_temp.rstate('F5_Inventory.csv', 2) = 'confirmed' and pg_temp.rstate('F5_Inventory.csv', 1) = 'submitted', 'F6 proves F5 row 2 only';
  assert pg_temp.estate('Inventory', 'WA1.LOT') = 'seed', 'seed stays seed (only filed is promoted)';
  assert pg_temp.estate('Inventory', 'GWL-3') = 'filed', 'GWL-3 filed';
  assert (select product_external_id is null from public.ccrs_filed_entities where env = 'prod' and external_id = 'GWL-3'), 'no product resolved';
  assert (select count(*) from public.ccrs_file_issues where file_id = pg_temp.fid('F6_Inventory.csv') and code = 'W_LOT_PRODUCT_UNRESOLVED'
            and message like '1 lot(s)%') = 1, 'unresolved product reported';
end $$;

-- F7: file-fatal -> every row rejected, file closes, nothing filed
do $$
declare j jsonb;
begin
  perform public.ccrs_mark_uploaded(pg_temp.fid('F7_Strain.csv'), now());
  j := public.ccrs_record_outcome(pg_temp.fid('F7_Strain.csv'), 'error-fatal', now(), '[]', array['CheckSum Failed']);
  assert j->>'state' = 'closed' and (j->'rows'->>'rejected')::int = 1, 'fatal: ' || j::text;
  assert pg_temp.estate('Strain', 'Gelato') is null, 'nothing filed on fatal';
  assert (select error_messages = array['CheckSum Failed'] from public.ccrs_files where file_name = 'F7_Strain.csv'), 'fatal message stored';
end $$;

-- F8: unmatched echo -> LAW 4, all uncertain, reconciling
do $$
declare j jsonb;
begin
  perform public.ccrs_mark_uploaded(pg_temp.fid('F8_Area.csv'), now());
  j := public.ccrs_record_outcome(pg_temp.fid('F8_Area.csv'), 'error-unmatched', now(), '[]', array['Something new']);
  assert j->>'state' = 'reconciling' and (j->'rows'->>'uncertain')::int = 1, 'unmatched: ' || j::text;
  assert pg_temp.estate('Area', 'AREA-2') = 'uncertain', 'entity uncertain';
  assert (select error_email_at is not null from public.ccrs_files where file_name = 'F8_Area.csv'), 'error email time';
end $$;

-- F9: no email in 60 minutes (upload back-dated; emitted_at moved as test setup)
update public.ccrs_files set emitted_at = now() - interval '3 hours' where file_name = 'F9_Strain.csv';
do $$
declare j jsonb;
begin
  perform public.ccrs_mark_uploaded(pg_temp.fid('F9_Strain.csv'), now() - interval '61 minutes');
  begin
    perform public.ccrs_record_outcome(pg_temp.fid('F9_Strain.csv'), 'no-email', now() - interval '2 minutes');
    raise exception 'SLA must refuse at 59 minutes';
  exception when others then
    assert position('CCRS_OUTCOME_SLA_NOT_REACHED' in sqlerrm) > 0, 'SLA error: ' || sqlerrm;
  end;
  j := public.ccrs_record_outcome(pg_temp.fid('F9_Strain.csv'), 'no-email', now());
  assert j->>'state' = 'reconciling', 'no-email -> reconciling: ' || j::text;
  assert pg_temp.estate('Strain', 'Runtz') = 'uncertain', 'strain uncertain';
  assert (select error_email_at is null and success_email_at is null from public.ccrs_files where file_name = 'F9_Strain.csv'), 'no email times';
end $$;

-- F10: rejections that contradict the ledger -> entity uncertain, file reconciling
do $$
declare j jsonb;
begin
  perform public.ccrs_mark_uploaded(pg_temp.fid('F10_Product.csv'), now());
  j := public.ccrs_record_outcome(pg_temp.fid('F10_Product.csv'), 'error-rows', now(),
         '[{"row_no":1,"message":"Duplicate External Identifier","uncertain":true},
           {"row_no":2,"message":"ExternalIdentifier not found","uncertain":true}]',
         array['Duplicate External Identifier', 'ExternalIdentifier not found']);
  assert j->>'state' = 'reconciling' and (j->'rows'->>'uncertain')::int = 2, 'contradiction: ' || j::text;
  assert pg_temp.estate('Product', 'GWP-000003') = 'uncertain', 'new id uncertain';
  assert pg_temp.estate('Product', 'GWP-000001') = 'uncertain', 'seed entity uncertain on conflict';
  assert (select filed_name from public.ccrs_filed_entities where env = 'prod' and external_id = 'GWP-000002') = 'New Product Renamed', 'landed Update renames Product';
  assert pg_temp.rstate('F10_Product.csv', 3) = 'submitted', 'row 3 landed';
  assert pg_temp.estate('Product', 'GWP-000002') = 'confirmed', 'a landed Update proves the product (filed -> confirmed)';
  assert (select count(*) from public.ccrs_file_issues where file_id = pg_temp.fid('F10_Product.csv') and code = 'CCRS_ROW_CONTRADICTS_LEDGER') = 2, 'issues';
  -- F10's successful Update of GWP-000002 proves F2's Insert row
  assert pg_temp.rstate('F2_Product.csv', 1) = 'confirmed', 'F2 row 1 proved';
  assert pg_temp.fstate('F2_Product.csv') = 'closed', 'F2 closes (confirmed + rejected)';
  assert (j->>'earlier_files_closed')::int = 1, 'one earlier closed';
end $$;

-- F11: benign error (Duplicate Strain) -> landed, closed
do $$
declare j jsonb;
begin
  perform public.ccrs_mark_uploaded(pg_temp.fid('F11_Strain.csv'), now());
  j := public.ccrs_record_outcome(pg_temp.fid('F11_Strain.csv'), 'error-benign', now(), '[]', array['Duplicate Strain']);
  assert j->>'state' = 'closed', 'benign closes: ' || j::text;
  assert pg_temp.estate('Strain', 'Duped') = 'filed', 'benign row landed';
end $$;

-- F12: abandon
select pg_temp.expect_error($q$select public.ccrs_abandon_file(pg_temp.fid('F12_Area.csv'), 'too short')$q$, 'CCRS_ABANDON_REASON');
select pg_temp.expect_error($q$select public.ccrs_abandon_file(pg_temp.fid('F11_Strain.csv'), 'a long enough reason')$q$, 'CCRS_ABANDON_NOT_EMITTED');
select pg_temp.expect_error($q$select public.ccrs_abandon_file(gen_random_uuid(), 'a long enough reason')$q$, 'CCRS_FILE_NOT_FOUND');
do $$
declare j jsonb;
begin
  j := public.ccrs_abandon_file(pg_temp.fid('F12_Area.csv'), '  test file, never uploaded  ');
  assert j->>'state' = 'abandoned', 'abandoned';
  assert (select notes = 'ABANDONED: test file, never uploaded' from public.ccrs_files where file_name = 'F12_Area.csv'), 'reason logged';
  assert pg_temp.rstate('F12_Area.csv', 1) = 'emitted', 'rows untouched';
  assert pg_temp.estate('Area', 'AREA-9') is null, 'nothing filed';
  assert exists (select 1 from public.ccrs_file_contents where file_id = pg_temp.fid('F12_Area.csv')), 'bytes kept';
end $$;
select pg_temp.expect_error($q$select public.ccrs_abandon_file(pg_temp.fid('F12_Area.csv'), 'a long enough reason')$q$, 'CCRS_ABANDON_NOT_EMITTED');
select pg_temp.expect_error($q$select public.ccrs_mark_uploaded(pg_temp.fid('F12_Area.csv'), now())$q$, 'CCRS_UPLOAD_NOT_EMITTED');

-- ---- emission 3: proof rules at the edges ------------------------------------
-- two held Products share a name: a lot naming it resolves to no Product
insert into public.ccrs_filed_entities (env, file_type, external_id, filed_name, state, source) values
  ('prod', 'Product', 'GWP-000010', 'Twin', 'seed', 'seed:test'),
  ('prod', 'Product', 'GWP-000011', 'Twin', 'seed', 'seed:test');
select public.ccrs_emit_files('prod', jsonb_build_array(
  pg_temp.file('Inventory', 'F13_Inventory.csv', '2026-10-07T21:00:01Z',
    '[{"Strain":"Zkittlez","Area":"Sales Floor","Product":"New Product Renamed","InitialQuantity":"5","QuantityOnHand":"4","TotalCost":"10.00","IsMedical":"FALSE","ExternalIdentifier":"GWL-1","Operation":"Insert"},
      {"Strain":"Zkittlez","Area":"Sales Floor","Product":"New Product Renamed","InitialQuantity":"2","QuantityOnHand":"1","TotalCost":"4.00","IsMedical":"FALSE","ExternalIdentifier":"GWL-2","UpdatedBy":"G","UpdatedDate":"10/07/2026","Operation":"Update"},
      {"Strain":"Zkittlez","Area":"Sales Floor","Product":"Twin","InitialQuantity":"1","QuantityOnHand":"1","TotalCost":"1.00","IsMedical":"FALSE","ExternalIdentifier":"GWL-4","Operation":"Insert"}]'),
  pg_temp.file('Inventory', 'F14_Inventory.csv', '2026-10-07T21:00:02Z',
    '[{"Strain":"Zkittlez","Area":"Sales Floor","Product":"New Product Renamed","InitialQuantity":"2","QuantityOnHand":"2","TotalCost":"4.00","IsMedical":"FALSE","ExternalIdentifier":"GWL-2","UpdatedBy":"G","UpdatedDate":"10/07/2026","Operation":"Update"}]')
));
do $$
declare j jsonb; v_src text := (select source from public.ccrs_filed_entities where env = 'prod' and external_id = 'GWL-1');
begin
  -- the LATER file goes first (logged override): an earlier file's Update must
  -- never confirm rows of a later-stamped file
  perform public.ccrs_mark_uploaded(pg_temp.fid('F14_Inventory.csv'), now(), null, 'test: later file uploaded first');
  perform public.ccrs_record_outcome(pg_temp.fid('F14_Inventory.csv'), 'success', now());
  perform public.ccrs_mark_uploaded(pg_temp.fid('F13_Inventory.csv'), now(), null, 'test: F14 is answered already');
  j := public.ccrs_record_outcome(pg_temp.fid('F13_Inventory.csv'), 'success', now());
  assert pg_temp.rstate('F14_Inventory.csv', 1) = 'submitted' and pg_temp.fstate('F14_Inventory.csv') = 'succeeded', 'later-stamped file untouched';
  -- a landed INSERT proves nothing about an earlier row (CCRS refuses a duplicate Insert)
  assert pg_temp.rstate('F5_Inventory.csv', 1) = 'submitted', 'Insert is no proof';
  -- an Insert never overwrites an entity the ledger holds (only a deleted one)
  assert pg_temp.estate('Inventory', 'GWL-1') = 'confirmed', 'held entity keeps its state';
  assert (select source from public.ccrs_filed_entities where env = 'prod' and external_id = 'GWL-1') = v_src, 'held entity keeps its source';
  assert (select product_external_id is null from public.ccrs_filed_entities where env = 'prod' and external_id = 'GWL-4'), 'ambiguous product name resolves to none';
  assert (select count(*) from public.ccrs_file_issues where file_id = pg_temp.fid('F13_Inventory.csv') and code = 'W_LOT_PRODUCT_UNRESOLVED') = 1, 'reported';
end $$;

-- ---- routing reads what landed ------------------------------------------------
do $$
declare s jsonb := public.ccrs_ledger_slice('prod', array['GWL-1', 'GWL-2', 'GWL-3'], array['New Product Renamed']);
begin
  assert (s->>'loaded')::boolean, 'prod loaded';
  assert s->'entries' @> '[["Inventory","GWL-1",null,"confirmed","GWP-000002"]]'::jsonb, 'GWL-1 routes as held: ' || (s->'entries')::text;
  assert s->'entries' @> '[["Inventory","GWL-2",null,"confirmed","GWP-000002"]]'::jsonb, 'GWL-2';
  assert s->'entries' @> '[["Product","GWP-000002","New Product Renamed","confirmed",null]]'::jsonb, 'product name followed the Update';
  assert s->'entries' @> '[["Strain","Zkittlez","Zkittlez","filed",null]]'::jsonb, 'strain';
  assert s->'entries' @> '[["Area","AREA-2",null,"uncertain",null]]'::jsonb, 'uncertain area routed as uncertain';
end $$;

-- ---- PREprod start -------------------------------------------------------------
do $$
declare j jsonb; k jsonb;
begin
  assert not (public.ccrs_ledger_slice('preprod', '{}', '{}')->>'loaded')::boolean, 'preprod not loaded yet';
  begin
    perform public.ccrs_preprod_ledger_start('   ');
    raise exception 'blank by must refuse';
  exception when others then
    assert position('CCRS_PREPROD_START_BY' in sqlerrm) > 0, sqlerrm;
  end;
  j := public.ccrs_preprod_ledger_start('Michael Lyman');
  assert j->>'status' = 'started', 'started';
  k := public.ccrs_preprod_ledger_start('Michael Lyman');
  assert k->>'status' = 'already' and k->>'id' = j->>'id', 'idempotent';
  assert (public.ccrs_ledger_slice('preprod', '{}', '{}')->>'loaded')::boolean, 'preprod loaded';
  assert jsonb_array_length(public.ccrs_ledger_slice('preprod', '{}', '{}')->'entries') = 0, 'preprod starts empty';
  assert (select count(*) from public.ccrs_files where env = 'preprod') = 1, 'only the marker';
  assert (select notes like 'PREprod ledger started EMPTY at % Pacific by Michael Lyman.%' and number_records = 0 and state = 'closed'
            from public.ccrs_files where env = 'preprod'), 'marker fields';
  assert (select stamp_at is null from public.ccrs_files where env = 'preprod'), 'marker takes no stamp';
end $$;

-- ---- grants and function hygiene ------------------------------------------------
do $$
declare r record;
begin
  for r in select p.oid, p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('ccrs_upload_group', 'ccrs_mark_uploaded', 'ccrs_promote_rows',
                                                           'ccrs_record_outcome', 'ccrs_abandon_file', 'ccrs_preprod_ledger_start') loop
    assert not r.prosecdef, r.proname || ' must not be security definer';
    assert r.proconfig @> array['search_path=public, pg_temp'], r.proname || ' pins search_path';
    assert not has_function_privilege('anon', r.oid, 'execute'), r.proname || ' anon';
    assert not has_function_privilege('authenticated', r.oid, 'execute'), r.proname || ' authenticated';
    assert has_function_privilege('service_role', r.oid, 'execute'), r.proname || ' service_role (record_outcome runs promote_rows with the caller''s rights)';
  end loop;
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
            and p.proname in ('ccrs_upload_group', 'ccrs_mark_uploaded', 'ccrs_promote_rows', 'ccrs_record_outcome', 'ccrs_abandon_file', 'ccrs_preprod_ledger_start')) = 6, 'six functions';
end $$;

-- ---- rollback drops the functions and keeps the record --------------------------
create temp table before_rb as select (select count(*) from public.ccrs_files) f, (select count(*) from public.ccrs_filed_entities) e,
                                      (select count(*) from public.ccrs_file_rows) r, (select count(*) from public.ccrs_file_issues) i;
\i supabase/rollbacks/0249_ccrs_upload_lifecycle.rollback.sql
do $$ begin
  assert to_regprocedure('public.ccrs_record_outcome(uuid,text,timestamptz,jsonb,text[])') is null, 'dropped';
  assert to_regprocedure('public.ccrs_mark_uploaded(uuid,timestamptz,uuid,text)') is null, 'dropped';
  assert (select f from before_rb) = (select count(*) from public.ccrs_files)
     and (select e from before_rb) = (select count(*) from public.ccrs_filed_entities)
     and (select r from before_rb) = (select count(*) from public.ccrs_file_rows)
     and (select i from before_rb) = (select count(*) from public.ccrs_file_issues), 'record kept';
end $$;
\i supabase/rollbacks/0249_ccrs_upload_lifecycle.rollback.sql
\i supabase/migrations/0249_ccrs_upload_lifecycle.sql
do $$ begin
  assert to_regprocedure('public.ccrs_record_outcome(uuid,text,timestamptz,jsonb,text[])') is not null, 're-applied';
  raise notice 'CCRS LIFECYCLE CHECK PASSED';
end $$;
rollback;
