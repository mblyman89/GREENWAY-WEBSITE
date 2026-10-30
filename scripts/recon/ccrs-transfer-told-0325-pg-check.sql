-- scripts/recon/ccrs-transfer-told-0325-pg-check.sql  (CCRS slice C1 / D-3 - migration 0325)
--
-- Scenario check for 0325_ccrs_transfer_last_told.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: nothing remains.
--   * shape: service role only, not security definer, stable, search_path pinned;
--   * env guard;
--   * told = payload of the NEWEST uploaded InventoryTransfer row CCRS accepted;
--     a rejected row never counts (the earlier accepted one stays the truth);
--     an unanswered or uncertain newest row makes told null (unknown);
--     emitted / abandoned files never count; other env / other file type
--     (Inventory rows with the SAME id) never count;
--   * in_flight only for THIS env's emitted / uploaded InventoryTransfer files;
--   * a seed entity with no row -> [id, 'seed', null, false]; unknown id omitted;
--   * rollback drops exactly the function (0285 / 0286 stay).
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ccrs-transfer-told-0325-pg-check.sql
--
-- "CCRS 0325 CHECK PASSED" then ROLLBACK = all clear.
begin;

do $$ begin
  execute 'alter table public.ccrs_files disable trigger user';
  execute 'alter table public.ccrs_file_contents disable trigger user';
  delete from public.ccrs_file_issues;
  delete from public.ccrs_file_rows;
  delete from public.ccrs_file_contents;
  delete from public.ccrs_filed_entities;
  delete from public.ccrs_files;
end $$;
-- triggers stay disabled for this transaction: fixtures set file states directly.

\i supabase/rollbacks/0325_ccrs_transfer_last_told.rollback.sql
do $$ begin
  assert to_regprocedure('public.ccrs_transfer_last_told(text,text[])') is null, 'clean start';
end $$;
\i supabase/migrations/0325_ccrs_transfer_last_told.sql

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

-- ---- 1. shape + refusals -----------------------------------------------------------
do $$
declare p text := 'public.ccrs_transfer_last_told(text,text[])';
begin
  assert has_function_privilege('service_role', p, 'execute'), 'service_role may execute';
  assert not has_function_privilege('anon', p, 'execute'), 'anon may not';
  assert not has_function_privilege('authenticated', p, 'execute'), 'authenticated may not';
  assert not (select prosecdef from pg_proc where oid = to_regprocedure(p)), 'not security definer';
  assert (select provolatile from pg_proc where oid = to_regprocedure(p)) = 's', 'stable';
  assert (select proconfig::text from pg_proc where oid = to_regprocedure(p)) like '%search_path=public, pg_temp%', 'search_path pinned';
end $$;
select pg_temp.expect_error($q$select public.ccrs_transfer_last_told('test', array['L'])$q$, 'CCRS_TRANSFER_TOLD_BAD_ENV');
select pg_temp.expect_error($q$select public.ccrs_transfer_last_told(null, array['L'])$q$, 'CCRS_TRANSFER_TOLD_BAD_ENV');

-- ---- 2. fixtures ----------------------------------------------------------------------
create or replace function pg_temp.f(p_name text, p_env text, p_type text, p_state text, p_hour int) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path, state, stamp_at, uploaded_at)
  values (p_env, p_type, 'weekly', p_name, encode(sha256(convert_to(p_name, 'UTF8')), 'hex'), 1, 'db:x', p_state,
          timestamptz '2026-11-01 00:00Z' + make_interval(hours => coalesce(p_hour, 0)),
          case when p_state in ('draft', 'emitted') or p_hour is null then null else timestamptz '2026-11-01 00:05Z' + make_interval(hours => p_hour) end)
  returning id into v;
  return v;
end $$;
create or replace function pg_temp.r(p_file uuid, p_id text, p_qty text, p_state text) returns void language sql as $$
  insert into public.ccrs_file_rows (file_id, row_no, external_id, operation, payload, state)
  values (p_file, coalesce((select max(row_no) from public.ccrs_file_rows where file_id = p_file), 0) + 1, p_id, 'Insert',
          jsonb_build_object('ExternalIdentifier', p_id, 'Quantity', p_qty), p_state) $$;

insert into public.ccrs_filed_entities (env, file_type, external_id, state, source) values
  ('prod', 'InventoryTransfer', 'A',    'filed',     'check'),
  ('prod', 'InventoryTransfer', 'B',    'filed',     'check'),
  ('prod', 'InventoryTransfer', 'C',    'filed',     'check'),
  ('prod', 'InventoryTransfer', 'D',    'uncertain', 'check'),
  ('prod', 'InventoryTransfer', 'SEED', 'seed',      'check'),
  ('prod', 'Inventory',         'INV',  'filed',     'check');

do $$
declare f1 uuid; f2 uuid; f3 uuid; f4 uuid; f5 uuid; f6 uuid; f7 uuid; f8 uuid;
begin
  f1 := pg_temp.f('T1_InventoryTransfer.csv', 'prod', 'InventoryTransfer', 'closed', 1);       -- old, accepted
  f2 := pg_temp.f('T2_InventoryTransfer.csv', 'prod', 'InventoryTransfer', 'errored', 2);      -- A rejected, B accepted
  f3 := pg_temp.f('T3_InventoryTransfer.csv', 'prod', 'InventoryTransfer', 'uploaded', 3);     -- C waiting
  f4 := pg_temp.f('T4_InventoryTransfer.csv', 'prod', 'InventoryTransfer', 'reconciling', 4);  -- D uncertain row
  f5 := pg_temp.f('T5_InventoryTransfer.csv', 'prod', 'InventoryTransfer', 'emitted', 5);      -- E in flight, never uploaded
  f6 := pg_temp.f('T6_InventoryTransfer.csv', 'prod', 'InventoryTransfer', 'abandoned', 10);   -- abandoned: never counts
  f7 := pg_temp.f('T7_InventoryTransfer.csv', 'preprod', 'InventoryTransfer', 'succeeded', 7); -- other env
  f8 := pg_temp.f('T8_Inventory.csv', 'prod', 'Inventory', 'succeeded', 8);                    -- other type, same id A
  perform pg_temp.r(f1, 'A', '5', 'submitted');
  perform pg_temp.r(f1, 'B', '9', 'confirmed');
  perform pg_temp.r(f1, 'C', '7', 'submitted');
  perform pg_temp.r(f2, 'A', '4', 'rejected');
  perform pg_temp.r(f2, 'B', '8', 'submitted');
  perform pg_temp.r(f3, 'C', '6', 'submitted');
  perform pg_temp.r(f4, 'D', '1', 'uncertain');
  perform pg_temp.r(f5, 'E', '0', 'emitted');
  perform pg_temp.r(f6, 'B', '99', 'submitted');
  perform pg_temp.r(f7, 'A', '77', 'confirmed');
  perform pg_temp.r(f8, 'A', '55', 'confirmed');
end $$;

-- ---- 3. answers --------------------------------------------------------------------------
create or replace function pg_temp.e(j jsonb, p_id text) returns jsonb language sql as $$
  select x from jsonb_array_elements(j->'entries') x where x->>0 = p_id $$;
do $$ declare j jsonb; begin
  j := public.ccrs_transfer_last_told('prod', array['A', 'B', 'C', 'D', 'E', 'SEED', 'NOPE', 'INV', '', null, 'A']);
  assert j->>'env' = 'prod', 'env echoed';
  assert jsonb_array_length(j->'entries') = 6, 'six entries (NOPE, INV, blank, null omitted; A once): ' || j::text;
  assert pg_temp.e(j, 'A') = '["A","filed",{"ExternalIdentifier":"A","Quantity":"5"},false]'::jsonb, 'A: rejected newer row ignored, Inventory row ignored: ' || pg_temp.e(j, 'A')::text;
  assert pg_temp.e(j, 'B')->2->>'Quantity' = '8', 'B: newest accepted row (abandoned file ignored): ' || pg_temp.e(j, 'B')::text;
  assert pg_temp.e(j, 'C') = '["C","filed",null,true]'::jsonb, 'C: newest row unanswered -> unknown + in flight: ' || pg_temp.e(j, 'C')::text;
  assert pg_temp.e(j, 'D') = '["D","uncertain",null,false]'::jsonb, 'D: uncertain row -> unknown: ' || pg_temp.e(j, 'D')::text;
  assert pg_temp.e(j, 'E') = '["E",null,null,true]'::jsonb, 'E: emitted only -> in flight, never told: ' || pg_temp.e(j, 'E')::text;
  assert pg_temp.e(j, 'SEED') = '["SEED","seed",null,false]'::jsonb, 'SEED: no row -> null told: ' || pg_temp.e(j, 'SEED')::text;
  assert (select string_agg(x->>0, ',' order by ord) from jsonb_array_elements(j->'entries') with ordinality as t(x, ord)) = 'A,B,C,D,E,SEED', 'ordered by id';

  j := public.ccrs_transfer_last_told('preprod', array['A', 'C']);
  assert j = '{"env":"preprod","entries":[["A",null,{"ExternalIdentifier":"A","Quantity":"77"},false]]}'::jsonb, 'preprod is separate: ' || j::text;
  j := public.ccrs_transfer_last_told('prod', null);
  assert j = '{"env":"prod","entries":[]}'::jsonb, 'null ids: ' || j::text;

  update public.ccrs_files set state = 'succeeded' where file_name = 'T3_InventoryTransfer.csv';
  j := public.ccrs_transfer_last_told('prod', array['C']);
  assert j = '{"env":"prod","entries":[["C","filed",{"ExternalIdentifier":"C","Quantity":"6"},false]]}'::jsonb, 'C answered: ' || j::text;
  update public.ccrs_file_rows set state = 'withheld', withheld_code = 'X' where external_id = 'C' and file_id = (select id from public.ccrs_files where file_name = 'T3_InventoryTransfer.csv');
  j := public.ccrs_transfer_last_told('prod', array['C']);
  assert pg_temp.e(j, 'C')->2->>'Quantity' = '7', 'C: withheld row ignored: ' || j::text;
end $$;

-- ---- 4. re-apply is a no-op; rollback drops exactly the function ----------------------
\i supabase/migrations/0325_ccrs_transfer_last_told.sql
\i supabase/rollbacks/0325_ccrs_transfer_last_told.rollback.sql
do $$ begin
  assert to_regprocedure('public.ccrs_transfer_last_told(text,text[])') is null, 'rollback drops the function';
  assert to_regprocedure('public.ccrs_transfer_slice(text,text[])') is not null, 'rollback keeps 0285';
  assert to_regprocedure('public.ccrs_inventory_last_told(text,text[])') is not null, 'rollback keeps 0286';
  assert (select count(*) from public.ccrs_file_rows) = 11, 'no data touched';
  raise notice 'CCRS 0325 CHECK PASSED';
end $$;

rollback;
