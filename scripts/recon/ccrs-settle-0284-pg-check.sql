-- scripts/recon/ccrs-settle-0284-pg-check.sql  (Round 6 / R6-1 - migration 0284)
--
-- Scenario check for 0284_ccrs_settle_uncertain.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: nothing remains. It replays
-- the owner's 2026-10-20 PREprod upload in miniature through the REAL
-- lifecycle (emit -> mark_uploaded -> record_outcome):
--   * Inventory Inserts answered "Duplicate External Identifier" -> uncertain,
--     file reconciling (0249);
--   * a LATER accepted Sale naming one of them proves it (prove_by_reference);
--     a rejected Sale row and an EARLIER upload prove nothing;
--   * the PREprod settle button settles the remaining duplicates (QoH 0 ->
--     closed), leaves a non-duplicate uncertainty alone, never touches prod;
--   * a reconciling file closes only once every uncertain row is settled.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ccrs-settle-0284-pg-check.sql
--
-- "CCRS 0284 CHECK PASSED" then ROLLBACK = all clear.
begin;

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

-- clean start (drop, so grants come from the migration), then apply twice
\i supabase/rollbacks/0284_ccrs_settle_uncertain.rollback.sql
do $$ begin assert to_regprocedure('public.ccrs_prove_by_reference(text)') is null, 'clean start'; end $$;
\i supabase/migrations/0284_ccrs_settle_uncertain.sql
\i supabase/migrations/0284_ccrs_settle_uncertain.sql

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

create or replace function pg_temp.line(p_cols text, p_kv jsonb) returns text language sql as $$
  select string_agg(coalesce(p_kv->>c, ''), ',' order by n)
    from unnest(string_to_array(p_cols, ',')) with ordinality as u(c, n)
$$;

create or replace function pg_temp.file(p_type text, p_name text, p_stamp text, p_rows jsonb)
returns jsonb language plpgsql as $$
declare
  cols text := case p_type
    when 'Product' then 'LicenseNumber,InventoryCategory,InventoryType,Name,Description,UnitWeightGrams,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation'
    when 'Inventory' then 'LicenseNumber,Strain,Area,Product,InitialQuantity,QuantityOnHand,TotalCost,IsMedical,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation'
    when 'Sale' then 'LicenseNumber,SoldToLicenseNumber,InventoryExternalIdentifier,PlantExternalIdentifier,SaleType,SaleDate,Quantity,UnitPrice,Discount,RetailSalesTax,CannabisExciseTax,SaleExternalIdentifier,SaleDetailExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation'
  end;
  n int := jsonb_array_length(p_rows);
  c text;
begin
  c := 'SubmittedBy,Greenway' || E'\r\n' || 'SubmittedDate,10/20/2026' || E'\r\n' || 'NumberRecords,' || n || E'\r\n' || cols || E'\r\n';
  c := c || (select string_agg(pg_temp.line(cols, jsonb_build_object('LicenseNumber', '413541', 'CreatedBy', 'G', 'CreatedDate', '10/20/2026') || r), E'\r\n' order by k)
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
create or replace function pg_temp.ent(p_env text, p_type text, p_id text) returns public.ccrs_filed_entities language sql as $$
  select * from public.ccrs_filed_entities where env = p_env and file_type = p_type and external_id = p_id $$;

-- ---- 0. shape: service role only, not security definer, search_path pinned
do $$
declare p text;
begin
  foreach p in array array['public.ccrs_close_settled_files(text,text)', 'public.ccrs_prove_by_reference(text)',
                           'public.ccrs_preprod_settle_duplicates(text)'] loop
    assert has_function_privilege('service_role', p, 'execute'), p || ': service_role may execute';
    assert not has_function_privilege('anon', p, 'execute'), p || ': anon may not';
    assert not has_function_privilege('authenticated', p, 'execute'), p || ': authenticated may not';
    assert not (select prosecdef from pg_proc where oid = to_regprocedure(p)), p || ': not security definer';
    assert (select proconfig::text from pg_proc where oid = to_regprocedure(p)) like '%search_path=public, pg_temp%', p || ': search_path pinned';
  end loop;
end $$;

-- ---- 1. refusals
select pg_temp.expect_error($q$select public.ccrs_prove_by_reference('test')$q$, 'CCRS_SETTLE_BAD_ENV');
select pg_temp.expect_error($q$select public.ccrs_prove_by_reference(null)$q$, 'CCRS_SETTLE_BAD_ENV');
select pg_temp.expect_error($q$select public.ccrs_preprod_settle_duplicates('   ')$q$, 'CCRS_SETTLE_BY');
select pg_temp.expect_error($q$select public.ccrs_preprod_settle_duplicates(null)$q$, 'CCRS_SETTLE_BY');
-- nothing to do is not an error
do $$ declare j jsonb; begin
  j := public.ccrs_prove_by_reference('preprod');
  assert j = '{"env":"preprod","proved":[],"files_closed":0}'::jsonb, 'empty prove: ' || j::text;
  j := public.ccrs_preprod_settle_duplicates('Michael');
  assert j = '{"env":"preprod","settled":[],"files_closed":0}'::jsonb, 'empty settle: ' || j::text;
end $$;

-- ---- 2. PREprod: the 2026-10-20 shape in miniature -------------------------
select public.ccrs_preprod_ledger_start('Michael');
-- two PREprod Products share the name "Twin": a lot of that name resolves to NO product
insert into public.ccrs_filed_entities (env, file_type, external_id, filed_name, state, source) values
  ('preprod', 'Product', 'PX-1', 'Twin', 'filed', 'check'),
  ('preprod', 'Product', 'PX-2', 'Twin', 'filed', 'check');
select public.ccrs_emit_files('preprod', jsonb_build_array(
  pg_temp.file('Product', 'P1_Product.csv', '2026-10-20T16:58:30Z',
    '[{"InventoryCategory":"EndProduct","InventoryType":"Usable Marijuana","Name":"Pastime Blue Flame Pre-roll 1g","UnitWeightGrams":"1","ExternalIdentifier":"P20261020A-GWP-000087","Operation":"Insert"},
      {"InventoryCategory":"EndProduct","InventoryType":"Usable Marijuana","Name":"Held Earlier","UnitWeightGrams":"1","ExternalIdentifier":"P20261020A-GWP-000088","Operation":"Insert"}]'),
  pg_temp.file('Inventory', 'P2_Inventory.csv', '2026-10-20T16:58:31Z',
    -- row1 L-SOLD: refused, later sold (proved by the Sale)
    -- row2 L-DUP : refused, the Sale row naming it was REJECTED (no proof) -> settle button
    -- row3 L-ZERO: refused, QoH 0 -> settle button closes it
    -- row4 L-OTHER: uncertain for another reason -> never settled by the button
    -- row5 L-OK  : accepted
    '[{"Strain":"Blue Flame","Area":"Sales Floor","Product":"Pastime Blue Flame Pre-roll 1g","InitialQuantity":"15","QuantityOnHand":"14","TotalCost":"56.25","IsMedical":"FALSE","ExternalIdentifier":"L-SOLD","Operation":"Insert"},
      {"Strain":"Blue Flame","Area":"Sales Floor","Product":"Pastime Blue Flame Pre-roll 1g","InitialQuantity":"10","QuantityOnHand":"10","TotalCost":"40.00","IsMedical":"FALSE","ExternalIdentifier":"L-DUP","Operation":"Insert"},
      {"Strain":"Blue Flame","Area":"Sales Floor","Product":"Pastime Blue Flame Pre-roll 1g","InitialQuantity":"5","QuantityOnHand":"0","TotalCost":"20.00","IsMedical":"FALSE","ExternalIdentifier":"L-ZERO","Operation":"Insert"},
      {"Strain":"Blue Flame","Area":"Sales Floor","Product":"Pastime Blue Flame Pre-roll 1g","InitialQuantity":"5","QuantityOnHand":"5","TotalCost":"20.00","IsMedical":"FALSE","ExternalIdentifier":"L-OTHER","Operation":"Insert"},
      {"Strain":"Blue Flame","Area":"Sales Floor","Product":"Pastime Blue Flame Pre-roll 1g","InitialQuantity":"5","QuantityOnHand":"5","TotalCost":"20.00","IsMedical":"FALSE","ExternalIdentifier":"L-OK","Operation":"Insert"},
      {"Strain":"Blue Flame","Area":"Sales Floor","Product":"Twin","InitialQuantity":"1","QuantityOnHand":"0","TotalCost":"4.00","IsMedical":"FALSE","ExternalIdentifier":"L-SOLD0","Operation":"Insert"},
      {"Strain":"Blue Flame","Area":"Sales Floor","Product":"Twin","InitialQuantity":"3","QuantityOnHand":"3","TotalCost":"9.00","IsMedical":"FALSE","ExternalIdentifier":"L-TWIN","Operation":"Insert"}]'),
  pg_temp.file('Sale', 'P3_Sale.csv', '2026-10-20T16:58:33Z',
    '[{"InventoryExternalIdentifier":"L-SOLD","SaleType":"RecreationalRetail","SaleDate":"10/20/2026","Quantity":"1","UnitPrice":"10.00","Discount":"0","RetailSalesTax":"0.95","CannabisExciseTax":"3.70","SaleExternalIdentifier":"S1","SaleDetailExternalIdentifier":"S1-a","Operation":"Insert"},
      {"InventoryExternalIdentifier":"L-DUP","SaleType":"RecreationalRetail","SaleDate":"10/20/2026","Quantity":"1","UnitPrice":"10.00","Discount":"0","RetailSalesTax":"0.95","CannabisExciseTax":"3.70","SaleExternalIdentifier":"S1","SaleDetailExternalIdentifier":"S1-b","Operation":"Insert"},
      {"InventoryExternalIdentifier":"L-SOLD0","SaleType":"RecreationalRetail","SaleDate":"10/20/2026","Quantity":"1","UnitPrice":"10.00","Discount":"0","RetailSalesTax":"0.95","CannabisExciseTax":"3.70","SaleExternalIdentifier":"S1","SaleDetailExternalIdentifier":"S1-c","Operation":"Insert"}]')
));

-- the owner uploads all files back to back, then reads the e-mails
select public.ccrs_mark_uploaded(pg_temp.fid('P1_Product.csv'), now() - interval '50 seconds', null, 'check: strains and areas are not modelled here');
select public.ccrs_mark_uploaded(pg_temp.fid('P2_Inventory.csv'), now() - interval '40 seconds', null, 'check: strains and areas are not modelled here');
select public.ccrs_mark_uploaded(pg_temp.fid('P3_Sale.csv'), now() - interval '30 seconds', null, 'check: uploaded before the Inventory answer came back');

-- Sale answered first: row 2 refused (not uncertain), row 1 accepted
select public.ccrs_record_outcome(pg_temp.fid('P3_Sale.csv'), 'error-rows', now(),
  '[{"row_no":2,"message":"Invalid InventoryExternalIdentifier","uncertain":false}]', array['Invalid InventoryExternalIdentifier']);
select public.ccrs_record_outcome(pg_temp.fid('P1_Product.csv'), 'error-rows', now(),
  '[{"row_no":2,"message":"Duplicate External Identifier","uncertain":true}]', array['Duplicate External Identifier']);
select public.ccrs_record_outcome(pg_temp.fid('P2_Inventory.csv'), 'error-rows', now(),
  '[{"row_no":1,"message":"Duplicate External Identifier","uncertain":true},
    {"row_no":2,"message":"Duplicate External Identifier","uncertain":true},
    {"row_no":3,"message":"Duplicate External Identifier","uncertain":true},
    {"row_no":4,"message":"ExternalIdentifier not found","uncertain":true},
    {"row_no":6,"message":"Duplicate External Identifier","uncertain":true},
    {"row_no":7,"message":"Duplicate External Identifier","uncertain":true}]', array['Duplicate External Identifier']);

do $$ begin
  assert pg_temp.fstate('P2_Inventory.csv') = 'reconciling', 'inventory reconciling: ' || pg_temp.fstate('P2_Inventory.csv');
  assert (pg_temp.ent('preprod', 'Inventory', 'L-SOLD')).state = 'uncertain', 'L-SOLD uncertain before proof';
  assert (pg_temp.ent('preprod', 'Inventory', 'L-OK')).state = 'filed', 'L-OK filed';
end $$;

-- ---- 3. an EARLIER upload proves nothing ------------------------------------
do $$ declare j jsonb; begin
  execute 'alter table public.ccrs_files disable trigger user';
  update public.ccrs_files set uploaded_at = now() - interval '45 seconds' where file_name = 'P3_Sale.csv';
  execute 'alter table public.ccrs_files enable trigger user';
  j := public.ccrs_prove_by_reference('preprod');
  assert j->'proved' = '[]'::jsonb, 'an earlier-uploaded Sale proved: ' || j::text;
  -- prod sees nothing of preprod
  j := public.ccrs_prove_by_reference('prod');
  assert j->'proved' = '[]'::jsonb, 'prod proved preprod lots: ' || j::text;
  execute 'alter table public.ccrs_files disable trigger user';
  update public.ccrs_files set uploaded_at = now() - interval '30 seconds' where file_name = 'P3_Sale.csv';
  execute 'alter table public.ccrs_files enable trigger user';
end $$;

-- ---- 3b. decoys that must prove / settle nothing ---------------------------
--   * a later accepted row of a NON-event file carrying the key (only Sale and
--     InventoryAdjustment rows are refused without held inventory)
--   * a later accepted PRODUCTION Sale naming the PREprod lot L-DUP
--   * a PREprod lot uncertain from an Update row whose message reads Duplicate
do $$ declare fx uuid; fp uuid; fu uuid; rid uuid; begin
  execute 'alter table public.ccrs_files disable trigger user';
  insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path, state, uploaded_at)
  values ('preprod', 'Product', 'weekly', 'D1_Product.csv', repeat('d', 64), 1, 'none', 'closed', now()) returning id into fx;
  insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path, state, uploaded_at)
  values ('prod', 'Sale', 'weekly', 'D2_Sale.csv', repeat('e', 64), 1, 'none', 'closed', now()) returning id into fp;
  insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path, state, uploaded_at)
  values ('preprod', 'Inventory', 'weekly', 'D3_Inventory.csv', repeat('f', 64), 1, 'none', 'reconciling', now() - interval '35 seconds') returning id into fu;
  execute 'alter table public.ccrs_files enable trigger user';
  insert into public.ccrs_file_rows (file_id, row_no, external_id, operation, payload, state) values
    (fx, 1, 'L-DUP', 'Insert', '{"InventoryExternalIdentifier":"L-DUP"}', 'confirmed'),
    (fp, 1, 'S9-a', 'Insert', '{"InventoryExternalIdentifier":"L-DUP"}', 'confirmed');
  insert into public.ccrs_file_rows (file_id, row_no, external_id, operation, payload, state)
  values (fu, 1, 'L-UPD', 'Update', '{"QuantityOnHand":"2"}', 'uncertain') returning id into rid;
  insert into public.ccrs_file_issues (file_id, row_id, severity, code, message)
  values (fu, rid, 'error', 'CCRS_ROW_CONTRADICTS_LEDGER', 'row 1 (L-UPD): Duplicate External Identifier');
  insert into public.ccrs_filed_entities (env, file_type, external_id, state, source, last_operation, last_file_id, last_payload)
  values ('preprod', 'Inventory', 'L-UPD', 'uncertain', 'check', 'Update', fu, '{"QuantityOnHand":"2"}');
end $$;

-- ---- 4. the later accepted Sale proves L-SOLD and L-SOLD0 only ---------------
do $$ declare j jsonb; e public.ccrs_filed_entities; begin
  j := public.ccrs_prove_by_reference('preprod');
  assert j = '{"env":"preprod","proved":["L-SOLD","L-SOLD0"],"files_closed":0}'::jsonb, 'prove: ' || j::text;
  e := pg_temp.ent('preprod', 'Inventory', 'L-SOLD0');
  assert e.state = 'closed', 'a proved lot whose last payload says QoH 0 is closed: ' || e.state;
  assert e.product_external_id is null, 'an ambiguous product name resolves to no product on proof';
  e := pg_temp.ent('preprod', 'Inventory', 'L-SOLD');
  assert e.state = 'filed' and e.source = 'proof:reference', 'L-SOLD filed by proof: ' || e.state || '/' || e.source;
  assert e.product_external_id = 'P20261020A-GWP-000087', 'L-SOLD product resolved: ' || coalesce(e.product_external_id, 'null');
  assert (pg_temp.ent('preprod', 'Inventory', 'L-DUP')).state = 'uncertain', 'a REJECTED Sale row proved L-DUP';
  assert (select count(*) from public.ccrs_file_issues where code = 'I_PROVED_BY_REFERENCE' and severity = 'info'
           and file_id = pg_temp.fid('P2_Inventory.csv') and message like 'L-SOLD:%') = 1, 'one proof issue';
  -- idempotent
  j := public.ccrs_prove_by_reference('preprod');
  assert j->'proved' = '[]'::jsonb, 'second prove not empty: ' || j::text;
  assert (select count(*) from public.ccrs_file_issues where code = 'I_PROVED_BY_REFERENCE') = 2, 'no duplicate issue';
end $$;

-- ---- 5. production uncertainty: the PREprod button never touches it ----------
insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path, state, notes)
values ('prod', 'Inventory', 'seed', 'seed:test', repeat('b', 64), 0, 'none', 'closed', 'test seed');
select public.ccrs_emit_files('prod', jsonb_build_array(
  pg_temp.file('Inventory', 'X1_Inventory.csv', '2026-10-20T17:00:00Z',
    '[{"Strain":"Blue Flame","Area":"Sales Floor","Product":"Old","InitialQuantity":"5","QuantityOnHand":"5","TotalCost":"20.00","IsMedical":"FALSE","ExternalIdentifier":"L-PROD","Operation":"Insert"}]')));
select public.ccrs_mark_uploaded(pg_temp.fid('X1_Inventory.csv'), now() - interval '20 seconds', null, 'check: refs are not modelled here');
select public.ccrs_record_outcome(pg_temp.fid('X1_Inventory.csv'), 'error-rows', now(),
  '[{"row_no":1,"message":"Duplicate External Identifier","uncertain":true}]', array['Duplicate External Identifier']);

-- ---- 6. PREprod settle button ------------------------------------------------
do $$ declare j jsonb; e public.ccrs_filed_entities; begin
  j := public.ccrs_preprod_settle_duplicates('Michael Lyman');
  assert j = '{"env":"preprod","settled":[["Inventory","L-DUP"],["Inventory","L-TWIN"],["Inventory","L-ZERO"],["Product","P20261020A-GWP-000088"]],"files_closed":1}'::jsonb, 'settle: ' || j::text;
  assert (pg_temp.ent('preprod', 'Product', 'P20261020A-GWP-000088')).filed_name = 'Held Earlier', 'settled Product takes its Name';
  assert (pg_temp.ent('preprod', 'Product', 'P20261020A-GWP-000088')).state = 'filed', 'settled Product filed';
  assert pg_temp.fstate('P1_Product.csv') = 'closed', 'the Product file closes once its only uncertain row is settled';
  assert (pg_temp.ent('preprod', 'Inventory', 'L-TWIN')).product_external_id is null, 'an ambiguous product name resolves to no product on settle';
  assert (pg_temp.ent('preprod', 'Inventory', 'L-UPD')).state = 'uncertain', 'an Update row was settled as a duplicate Insert';
  e := pg_temp.ent('preprod', 'Inventory', 'L-DUP');
  assert e.state = 'filed' and e.source like 'preprod-settle:% PT by Michael Lyman', 'L-DUP settled: ' || e.state || '/' || e.source;
  assert e.product_external_id = 'P20261020A-GWP-000087', 'L-DUP product resolved';
  assert (pg_temp.ent('preprod', 'Inventory', 'L-ZERO')).state = 'closed', 'QoH 0 settles as closed';
  assert (pg_temp.ent('preprod', 'Inventory', 'L-OTHER')).state = 'uncertain', 'a non-duplicate uncertainty was settled';
  assert (pg_temp.ent('prod', 'Inventory', 'L-PROD')).state = 'uncertain', 'the PREprod button touched production';
  assert (select count(*) from public.ccrs_file_issues where code = 'I_PREPROD_SETTLED') = 4, 'four settle issues';
  -- L-OTHER still uncertain -> the file stays reconciling
  assert pg_temp.fstate('P2_Inventory.csv') = 'reconciling', 'closed with an uncertain row left';
  -- idempotent
  j := public.ccrs_preprod_settle_duplicates('Michael Lyman');
  assert j->'settled' = '[]'::jsonb, 'second settle not empty: ' || j::text;
end $$;

-- ---- 7. once the last uncertainty is settled (as a copy would), the file closes
do $$ declare n int; begin
  update public.ccrs_filed_entities set state = 'filed', source = 'copy:check'
   where env = 'preprod' and file_type = 'Inventory' and external_id = 'L-OTHER';
  n := public.ccrs_close_settled_files('preprod', 'check close');
  assert n = 1, 'files closed: ' || n;
  assert pg_temp.fstate('D3_Inventory.csv') = 'reconciling', 'D3 still has L-UPD uncertain';
  assert pg_temp.fstate('P2_Inventory.csv') = 'closed', 'inventory file closed';
  assert (select reconciled_at is not null and notes like '%check close%' from public.ccrs_files where file_name = 'P2_Inventory.csv'), 'reconciled_at + note';
  assert pg_temp.fstate('X1_Inventory.csv') = 'reconciling', 'prod file untouched';
end $$;

-- ---- 8. rollback drops exactly the three functions ---------------------------
\i supabase/rollbacks/0284_ccrs_settle_uncertain.rollback.sql
do $$ begin
  assert to_regprocedure('public.ccrs_prove_by_reference(text)') is null
     and to_regprocedure('public.ccrs_preprod_settle_duplicates(text)') is null
     and to_regprocedure('public.ccrs_close_settled_files(text,text)') is null, 'rollback drops the functions';
  assert to_regprocedure('public.ccrs_record_outcome(uuid,text,timestamptz,jsonb,text[])') is not null, 'rollback keeps 0249';
  raise notice 'CCRS 0284 CHECK PASSED';
end $$;

rollback;
