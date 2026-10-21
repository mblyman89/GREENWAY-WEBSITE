-- scripts/recon/ccrs-transfer-0285-pg-check.sql  (Round 6 / R6-2 - migration 0285)
--
-- Scenario check for 0285_ccrs_inventory_transfer.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: nothing remains.
--   * the vendor-id columns + their checks (source list, shape <= 100, not '');
--   * the fill-only backfill copies lot_code for REAL deliveries only, stamps
--     the source from the manifest's parser, leaves Cultivera migration lots
--     (kind / POS-IMPORT- number / notes marker), lots with no manifest and
--     values already set alone, and writes ONE audit row;
--   * ccrs_transfer_slice: env guard, service role only, ledger state per id,
--     in-flight only for THIS env's emitted / uploaded InventoryTransfer files;
--   * re-apply is a no-op; rollback drops exactly what 0285 added.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ccrs-transfer-0285-pg-check.sql
--
-- "CCRS 0285 CHECK PASSED" then ROLLBACK = all clear.
begin;

do $$ begin
  execute 'alter table public.ccrs_files disable trigger user';
  execute 'alter table public.ccrs_file_contents disable trigger user';
  delete from public.ccrs_file_issues;
  delete from public.ccrs_file_rows;
  delete from public.ccrs_file_contents;
  delete from public.ccrs_filed_entities;
  delete from public.ccrs_files;
  execute 'alter table public.ccrs_files enable trigger user';
  execute 'alter table public.ccrs_file_contents enable trigger user';
end $$;

-- clean start (drop, so grants come from the migration)
\i supabase/rollbacks/0285_ccrs_inventory_transfer.rollback.sql
do $$ begin
  assert to_regprocedure('public.ccrs_transfer_slice(text,text[])') is null, 'clean start: function';
  assert not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inventory_lots'
                      and column_name like 'vendor_inventory_external_id%'), 'clean start: columns';
end $$;

-- ---- fixtures: deliveries of every kind, BEFORE the migration ---------------
delete from public.audit_logs where action = 'migration_0285.vendor_inventory_external_id_backfill';
insert into public.inbound_manifests (id, manifest_number, source_format, raw_payload, status) values
  ('00000000-0000-0000-0000-00000000a001', 'WCIA-1',          'wcia',         '{"from_license_number":"417068"}', 'accepted'),
  ('00000000-0000-0000-0000-00000000a002', 'CSV-1',           'ccrs-csv',     null,                                'accepted'),
  ('00000000-0000-0000-0000-00000000a003', 'PDF-1',           'pdf-manifest', null,                                'accepted'),
  ('00000000-0000-0000-0000-00000000a004', 'GEN-1',           'generic',      null,                                'accepted'),
  ('00000000-0000-0000-0000-00000000a005', 'CULT-1',          'generic',      '{"kind":"cultivera-reconstructed"}', 'accepted'),
  ('00000000-0000-0000-0000-00000000a006', 'pos-import-2026', 'generic',      null,                                'accepted'),
  ('00000000-0000-0000-0000-00000000a007', 'MIG-1',           'generic',      '{"kind":"pos-import-migration"}',   'accepted');
insert into public.inventory_lots (id, lot_code, manifest_id, notes) values
  ('00000000-0000-0000-0000-0000000b0001', '  WA417068.IN1  ', '00000000-0000-0000-0000-00000000a001', null),
  ('00000000-0000-0000-0000-0000000b0002', 'CSV-INV-9',       '00000000-0000-0000-0000-00000000a002', null),
  ('00000000-0000-0000-0000-0000000b0003', 'BATCH-77',        '00000000-0000-0000-0000-00000000a003', null),
  ('00000000-0000-0000-0000-0000000b0004', 'GEN-5',           '00000000-0000-0000-0000-00000000a004', null),
  ('00000000-0000-0000-0000-0000000b0005', 'CULT-LOT',        '00000000-0000-0000-0000-00000000a005', null),
  ('00000000-0000-0000-0000-0000000b0006', 'POS-LOT',         '00000000-0000-0000-0000-00000000a006', null),
  ('00000000-0000-0000-0000-0000000b0007', 'MIG-LOT',         '00000000-0000-0000-0000-00000000a007', null),
  ('00000000-0000-0000-0000-0000000b0008', 'MARK-LOT',        '00000000-0000-0000-0000-00000000a001', 'x Cultivera migration (one-time POS import). y'),
  ('00000000-0000-0000-0000-0000000b0009', 'NO-MANIFEST',     null,                                   null),
  ('00000000-0000-0000-0000-0000000b0010', '   ',             '00000000-0000-0000-0000-00000000a001', null),
  ('00000000-0000-0000-0000-0000000b0011', repeat('L', 140),  '00000000-0000-0000-0000-00000000a001', null);

\i supabase/migrations/0285_ccrs_inventory_transfer.sql

create or replace function pg_temp.vid(p uuid) returns text language sql as $$
  select coalesce(vendor_inventory_external_id, '<null>') || '|' || coalesce(vendor_inventory_external_id_source, '<null>')
    from public.inventory_lots where id = p $$;

-- ---- 1. backfill ---------------------------------------------------------------
do $$ begin
  assert pg_temp.vid('00000000-0000-0000-0000-0000000b0001') = 'WA417068.IN1|wcia_json', 'wcia trimmed: ' || pg_temp.vid('00000000-0000-0000-0000-0000000b0001');
  assert pg_temp.vid('00000000-0000-0000-0000-0000000b0002') = 'CSV-INV-9|ccrs_csv', 'ccrs csv';
  assert pg_temp.vid('00000000-0000-0000-0000-0000000b0003') = 'BATCH-77|pdf_guess', 'pdf is a guess';
  assert pg_temp.vid('00000000-0000-0000-0000-0000000b0004') = 'GEN-5|unknown', 'generic unknown';
  assert pg_temp.vid('00000000-0000-0000-0000-0000000b0005') = '<null>|<null>', 'cultivera kind skipped';
  assert pg_temp.vid('00000000-0000-0000-0000-0000000b0006') = '<null>|<null>', 'POS-IMPORT number skipped (any case)';
  assert pg_temp.vid('00000000-0000-0000-0000-0000000b0007') = '<null>|<null>', 'pos-import-migration kind skipped';
  assert pg_temp.vid('00000000-0000-0000-0000-0000000b0008') = '<null>|<null>', 'notes marker skipped';
  assert pg_temp.vid('00000000-0000-0000-0000-0000000b0009') = '<null>|<null>', 'no manifest skipped';
  assert pg_temp.vid('00000000-0000-0000-0000-0000000b0010') = '<null>|<null>', 'blank lot code skipped';
  assert length((select vendor_inventory_external_id from public.inventory_lots where id = '00000000-0000-0000-0000-0000000b0011')) = 100, 'cut to 100';
  assert (select count(*) from public.audit_logs where action = 'migration_0285.vendor_inventory_external_id_backfill') = 1, 'one audit row';
  assert (select after_json->>'lots' from public.audit_logs where action = 'migration_0285.vendor_inventory_external_id_backfill') = '5', 'audit counts 5 lots';
  assert (select after_json->'by_source'->>'pdf_guess' from public.audit_logs where action = 'migration_0285.vendor_inventory_external_id_backfill') = '1', 'audit by source';
end $$;

-- ---- 2. fill-only: re-apply never overwrites, writes no second audit row -----
update public.inventory_lots set vendor_inventory_external_id = 'OWNER-1', vendor_inventory_external_id_source = 'owner_entered'
 where id = '00000000-0000-0000-0000-0000000b0003';
\i supabase/migrations/0285_ccrs_inventory_transfer.sql
do $$ begin
  assert pg_temp.vid('00000000-0000-0000-0000-0000000b0003') = 'OWNER-1|owner_entered', 'owner value kept';
  assert (select count(*) from public.audit_logs where action = 'migration_0285.vendor_inventory_external_id_backfill') = 1, 'no second audit row';
end $$;

-- ---- 3. checks -------------------------------------------------------------------
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
select pg_temp.expect_error($q$update public.inventory_lots set vendor_inventory_external_id_source = 'guess' where id = '00000000-0000-0000-0000-0000000b0001'$q$, 'inventory_lots_vendor_inv_ext_id_source_check');
select pg_temp.expect_error($q$update public.inventory_lots set vendor_inventory_external_id = '' where id = '00000000-0000-0000-0000-0000000b0001'$q$, 'inventory_lots_vendor_inv_ext_id_shape_check');
select pg_temp.expect_error($q$update public.inventory_lots set vendor_inventory_external_id = repeat('x', 101) where id = '00000000-0000-0000-0000-0000000b0001'$q$, 'inventory_lots_vendor_inv_ext_id_shape_check');
do $$ begin
  update public.inventory_lots set vendor_inventory_external_id = repeat('x', 100) where id = '00000000-0000-0000-0000-0000000b0001';
  update public.inventory_lots set vendor_inventory_external_id = null, vendor_inventory_external_id_source = null where id = '00000000-0000-0000-0000-0000000b0001';
end $$;

-- ---- 4. slice shape + refusals -------------------------------------------------
do $$
declare p text := 'public.ccrs_transfer_slice(text,text[])';
begin
  assert has_function_privilege('service_role', p, 'execute'), 'service_role may execute';
  assert not has_function_privilege('anon', p, 'execute'), 'anon may not';
  assert not has_function_privilege('authenticated', p, 'execute'), 'authenticated may not';
  assert not (select prosecdef from pg_proc where oid = to_regprocedure(p)), 'not security definer';
  assert (select provolatile from pg_proc where oid = to_regprocedure(p)) = 's', 'stable';
  assert (select proconfig::text from pg_proc where oid = to_regprocedure(p)) like '%search_path=public, pg_temp%', 'search_path pinned';
end $$;
select pg_temp.expect_error($q$select public.ccrs_transfer_slice('test', array['TR-1'])$q$, 'CCRS_TRANSFER_SLICE_BAD_ENV');
select pg_temp.expect_error($q$select public.ccrs_transfer_slice(null, array['TR-1'])$q$, 'CCRS_TRANSFER_SLICE_BAD_ENV');

-- ---- 5. slice answers -------------------------------------------------------------
insert into public.ccrs_filed_entities (env, file_type, external_id, state, source) values
  ('prod',    'InventoryTransfer', 'TR-HELD',  'filed',     'check'),
  ('prod',    'InventoryTransfer', 'TR-UNC',   'uncertain', 'check'),
  ('preprod', 'InventoryTransfer', 'TR-PRE',   'filed',     'check'),
  ('prod',    'Inventory',         'TR-INV',   'filed',     'check');
-- an emitted prod InventoryTransfer file naming TR-FLY; a preprod one naming TR-PFLY
create or replace function pg_temp.tfile(p_name text, p_ids text[]) returns jsonb language plpgsql as $$
declare
  cols text := 'FromLicenseNumber,ToLicenseNumber,FromInventoryExternalIdentifier,ToInventoryExternalIdentifier,Quantity,TransferDate,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation';
  n int := cardinality(p_ids);
  c text;
begin
  c := 'SubmittedBy,Greenway' || E'\r\n' || 'SubmittedDate,11/08/2026' || E'\r\n' || 'NumberRecords,' || n || E'\r\n' || cols || E'\r\n'
    || (select string_agg('417068,413541,V-' || i || ',' || substr(i, 4) || ',1,11/03/2026,' || i || ',G,11/03/2026,,,Insert', E'\r\n' order by k)
          from unnest(p_ids) with ordinality as u(i, k)) || E'\r\n';
  return jsonb_build_object('file_type', 'InventoryTransfer', 'purpose', 'weekly', 'chunk_no', 1, 'chunk_of', 1,
    'file_name', p_name, 'stamp_at', '2026-11-08T16:00:00Z', 'content', c,
    'sha256', encode(sha256(convert_to(c, 'UTF8')), 'hex'), 'number_records', n,
    'distinct_ids', n, 'control_totals', jsonb_build_object('numberRecords', n), 'issues', '[]'::jsonb);
end $$;
select public.ccrs_emit_files('prod', jsonb_build_array(pg_temp.tfile('T1_InventoryTransfer.csv', array['TR-FLY'])));
select public.ccrs_emit_files('preprod', jsonb_build_array(pg_temp.tfile('T2_InventoryTransfer.csv', array['TR-PFLY'])));
-- a NON-transfer file in flight under the same id must not count (file_type filter)
do $$
declare
  cols text := 'LicenseNumber,Strain,Area,Product,InitialQuantity,QuantityOnHand,TotalCost,IsMedical,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation';
  c text;
begin
  c := 'SubmittedBy,Greenway' || E'\r\n' || 'SubmittedDate,11/08/2026' || E'\r\n' || 'NumberRecords,1' || E'\r\n' || cols || E'\r\n'
    || '413541,Blue Flame,Sales Floor,P,1,1,1.00,FALSE,TR-OTHER,G,11/03/2026,,,Insert' || E'\r\n';
  perform public.ccrs_emit_files('prod', jsonb_build_array(jsonb_build_object('file_type', 'Inventory', 'purpose', 'weekly', 'chunk_no', 1, 'chunk_of', 1,
    'file_name', 'T3_Inventory.csv', 'stamp_at', '2026-11-08T16:00:01Z', 'content', c,
    'sha256', encode(sha256(convert_to(c, 'UTF8')), 'hex'), 'number_records', 1,
    'distinct_ids', 1, 'control_totals', jsonb_build_object('numberRecords', 1), 'issues', '[]'::jsonb)));
  assert (select count(*) from public.ccrs_file_rows where external_id = 'TR-OTHER') = 1, 'decoy inventory row emitted';
end $$;
do $$ declare j jsonb; begin
  assert (select count(*) from public.ccrs_file_rows r join public.ccrs_files f on f.id = r.file_id
           where f.file_name = 'T1_InventoryTransfer.csv' and r.external_id = 'TR-FLY') = 1, 'emit keys transfer rows by ExternalIdentifier';
  j := public.ccrs_transfer_slice('prod', array['TR-HELD', 'TR-UNC', 'TR-NEW', 'TR-FLY', 'TR-PRE', 'TR-INV', 'TR-PFLY', 'TR-OTHER', '', null, 'TR-HELD']);
  assert j = '{"env":"prod","entries":[["TR-FLY",null,true],["TR-HELD","filed",false],["TR-UNC","uncertain",false]]}'::jsonb, 'prod slice: ' || j::text;
  j := public.ccrs_transfer_slice('preprod', array['TR-HELD', 'TR-PRE', 'TR-PFLY', 'TR-FLY']);
  assert j = '{"env":"preprod","entries":[["TR-PFLY",null,true],["TR-PRE","filed",false]]}'::jsonb, 'preprod slice: ' || j::text;
  j := public.ccrs_transfer_slice('prod', null);
  assert j = '{"env":"prod","entries":[]}'::jsonb, 'null ids: ' || j::text;
  -- once the file is answered (not emitted / uploaded) it is no longer in flight
  update public.ccrs_files set state = 'abandoned' where file_name = 'T1_InventoryTransfer.csv';
  j := public.ccrs_transfer_slice('prod', array['TR-FLY']);
  assert j = '{"env":"prod","entries":[]}'::jsonb, 'answered file not in flight: ' || j::text;
end $$;

-- ---- 6. rollback drops exactly what 0285 added ----------------------------------
\i supabase/rollbacks/0285_ccrs_inventory_transfer.rollback.sql
do $$ begin
  assert to_regprocedure('public.ccrs_transfer_slice(text,text[])') is null, 'rollback drops the function';
  assert not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inventory_lots'
                      and column_name like 'vendor_inventory_external_id%'), 'rollback drops the columns';
  assert to_regprocedure('public.ccrs_prove_by_reference(text)') is not null, 'rollback keeps 0284';
  assert (select lot_code from public.inventory_lots where id = '00000000-0000-0000-0000-0000000b0002') = 'CSV-INV-9', 'lot_code untouched';
  raise notice 'CCRS 0285 CHECK PASSED';
end $$;

rollback;
