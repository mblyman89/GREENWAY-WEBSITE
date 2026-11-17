-- scripts/recon/ccrs-delivery-loads-0368-pg-check.sql  (D250 slice 3 - migration 0368)
--
-- Scenario check for 0368_ccrs_delivery_loads.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ccrs-delivery-loads-0368-pg-check.sql
--
-- "CCRS 0368 CHECK PASSED" then ROLLBACK = all clear.
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
  j jsonb;
  lid uuid;
  fid uuid;
  us bigint;
  prov jsonb := '[{"role":"Inventory","fileName":"inv17.csv","sha256":"1111111111111111111111111111111111111111111111111111111111111111","rows":2,"storagePath":"x/a"},
                  {"role":"Inventory","fileName":"sales17.csv","sha256":"2222222222222222222222222222222222222222222222222222222222222222","rows":3,"storagePath":"x/b"},
                  {"role":"Product","fileName":"sheets.xlsx","sha256":"3333333333333333333333333333333333333333333333333333333333333333","rows":1,"storagePath":null}]';
begin
  -- 0. shape and grants
  select count(*) into n from pg_class where relname in ('ccrs_delivery_loads', 'ccrs_delivery_stage') and relkind = 'r' and relrowsecurity;
  assert n = 2, 'both tables with RLS on';
  select count(*) into n from pg_policies where tablename in ('ccrs_delivery_loads', 'ccrs_delivery_stage');
  assert n = 0, 'no policies: service role only';
  assert not has_table_privilege('authenticated', 'public.ccrs_delivery_loads', 'select'), 'authenticated cannot read the loads';
  assert not has_table_privilege('anon', 'public.ccrs_delivery_stage', 'insert'), 'anon cannot stage';
  assert has_table_privilege('service_role', 'public.ccrs_delivery_stage', 'insert'), 'service_role stages';
  assert not has_function_privilege('authenticated', 'public.ccrs_apply_delivery(uuid, integer, integer, jsonb, uuid, text)', 'execute'), 'authenticated cannot apply';
  assert has_function_privilege('service_role', 'public.ccrs_apply_delivery(uuid, integer, integer, jsonb, uuid, text)', 'execute'), 'service_role applies';

  -- 1. the stage refuses a bad source and an add that carries a guard
  insert into public.ccrs_delivery_loads (as_of, status) values ('2026-11-17', 'ready') returning id into lid;
  perform pg_temp.must_fail(format($q$insert into public.ccrs_delivery_stage (load_id, op, file_type, external_id, state, source, payload) values (%L, 'add', 'Inventory', 'X', 'seed', 'file:x', '{}')$q$, lid), 'check');
  perform pg_temp.must_fail(format($q$insert into public.ccrs_delivery_stage (load_id, op, file_type, external_id, state, source, payload, expect_state, expect_us) values (%L, 'add', 'Inventory', 'X', 'seed', 'seed:2026-11-17-delivery', '{}', 'seed', 1)$q$, lid), 'check');

  -- 2. no seed yet -> refused
  perform pg_temp.must_fail(format('select public.ccrs_apply_delivery(%L, 0, 0, %L::jsonb, null, null)', lid, prov), 'CCRS_RESEED_NOT_SEEDED');

  -- 3. a seeded ledger: one untouched seed lot, one migration link row, one lot our file wrote
  insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path, state)
  values ('prod', 'Inventory', 'seed', 'd250:seed', repeat('e', 64), 1, 'none', 'closed');
  insert into public.ccrs_files (env, file_type, purpose, file_name) values ('prod', 'Inventory', 'weekly', 'd250:ours') returning id into fid;
  insert into public.ccrs_filed_entities (env, file_type, external_id, state, source, seed_payload)
  values ('prod', 'Inventory', 'D250-SEED', 'seed', 'seed:2026-09-18-delivery', '{"Quantity on Hand":"5"}'),
         ('prod', 'Inventory', 'D250-LINK', 'unknown', 'link:unfiled-migration-lot', null);
  -- now() is fixed inside this transaction: date the rows back so a later change is visible
  execute 'alter table public.ccrs_filed_entities disable trigger trg_ccrs_filed_entities_updated';
  update public.ccrs_filed_entities set updated_at = now() - interval '1 day' where env = 'prod' and external_id like 'D250-%';
  execute 'alter table public.ccrs_filed_entities enable trigger trg_ccrs_filed_entities_updated';
  insert into public.ccrs_filed_entities (env, file_type, external_id, state, source, last_file_id, last_operation)
  values ('prod', 'Inventory', 'D250-OURS', 'filed', 'file:d250', fid, 'Insert');
  select count(*) into n from public.ccrs_filed_entities where env = 'prod' and external_id like 'D250-%' and updated_at < now();
  assert n >= 2, 'precondition: the seeded rows are dated back (got ' || n || ')';

  -- 4. a plan: add a delivered lot, add a sale-proven lot, refresh the seed lot, settle the link row
  insert into public.ccrs_delivery_stage (load_id, op, file_type, external_id, product_external_id, state, source, payload) values
    (lid, 'add', 'Inventory', 'D250-NEW', 'P1', 'seed', 'seed:2026-11-17-delivery', '{"Quantity on Hand":"4"}'),
    (lid, 'add', 'Inventory', 'D250-SOLD', null, 'seed', 'proof:2026-11-17-delivery-sale', '{"Proof":"sale"}'),
    (lid, 'add', 'Product', 'P1', null, 'seed', 'seed:2026-11-17-delivery', '{"Name":"Solo"}');
  update public.ccrs_delivery_stage set filed_name = 'Solo' where load_id = lid and external_id = 'P1';
  insert into public.ccrs_delivery_stage (load_id, op, file_type, external_id, state, source, payload, expect_state, expect_us)
  select lid, case when e.external_id = 'D250-LINK' then 'settleLink' else 'refresh' end, 'Inventory', e.external_id, 'seed',
         case when e.external_id = 'D250-LINK' then 'proof:2026-11-17-delivery-sale' else 'seed:2026-11-17-delivery' end,
         '{"Quantity on Hand":"2"}', e.state, (extract(epoch from e.updated_at) * 1000000)::bigint
    from public.ccrs_filed_entities e where e.env = 'prod' and e.external_id in ('D250-SEED', 'D250-LINK');

  -- 5. refusals
  perform pg_temp.must_fail(format('select public.ccrs_apply_delivery(%L, 3, 2, %L::jsonb, null, null)', lid, '[]'), 'CCRS_DELIVERY_PROVENANCE');
  perform pg_temp.must_fail(format('select public.ccrs_apply_delivery(%L, 3, 2, %L::jsonb, null, null)', lid,
    '[{"role":"Sale","sha256":"1111111111111111111111111111111111111111111111111111111111111111"}]'), 'CCRS_DELIVERY_PROVENANCE');
  perform pg_temp.must_fail(format('select public.ccrs_apply_delivery(%L, 3, 2, %L::jsonb, null, null)', lid,
    '[{"role":"Inventory","sha256":"1111111111111111111111111111111111111111111111111111111111111111"},{"role":"Product","sha256":"1111111111111111111111111111111111111111111111111111111111111111"}]'), 'CCRS_DELIVERY_PROVENANCE');
  perform pg_temp.must_fail(format('select public.ccrs_apply_delivery(%L, 4, 2, %L::jsonb, null, null)', lid, prov), 'CCRS_RESEED_STAGE');
  perform pg_temp.must_fail(format('select public.ccrs_apply_delivery(%L, 3, 2, %L::jsonb, null, null)', gen_random_uuid(), prov), 'CCRS_DELIVERY_NOT_FOUND');

  -- 5b. a source dated another day is refused
  update public.ccrs_delivery_stage set source = 'seed:2026-11-18-delivery' where load_id = lid and external_id = 'D250-NEW';
  perform pg_temp.must_fail(format('select public.ccrs_apply_delivery(%L, 3, 2, %L::jsonb, null, null)', lid, prov), 'CCRS_DELIVERY_SOURCE');
  update public.ccrs_delivery_stage set source = 'seed:2026-11-17-delivery' where load_id = lid and external_id = 'D250-NEW';

  -- 5c. STALE: the seed lot moved after the plan -> nothing written
  update public.ccrs_filed_entities set seed_payload = '{"Quantity on Hand":"6"}' where env = 'prod' and external_id = 'D250-SEED';
  perform pg_temp.must_fail(format('select public.ccrs_apply_delivery(%L, 3, 2, %L::jsonb, null, null)', lid, prov), 'CCRS_RESEED_STALE');
  select count(*) into n from public.ccrs_filed_entities where env = 'prod' and external_id in ('D250-NEW', 'D250-SOLD');
  assert n = 0, 'STALE wrote nothing';
  select (extract(epoch from updated_at) * 1000000)::bigint into us from public.ccrs_filed_entities where env = 'prod' and external_id = 'D250-SEED';
  update public.ccrs_delivery_stage set expect_us = us where load_id = lid and external_id = 'D250-SEED';

  -- 5d. a row our own file wrote can never be changed, even with a matching guard
  insert into public.ccrs_delivery_stage (load_id, op, file_type, external_id, state, source, payload, expect_state, expect_us)
  select lid, 'refresh', 'Inventory', 'D250-OURS', 'seed', 'seed:2026-11-17-delivery', '{}', e.state, (extract(epoch from e.updated_at) * 1000000)::bigint
    from public.ccrs_filed_entities e where e.env = 'prod' and e.external_id = 'D250-OURS';
  perform pg_temp.must_fail(format('select public.ccrs_apply_delivery(%L, 3, 3, %L::jsonb, null, null)', lid, prov), 'CCRS_RESEED_STALE');
  delete from public.ccrs_delivery_stage where load_id = lid and external_id = 'D250-OURS';

  -- 6. the apply
  j := public.ccrs_apply_delivery(lid, 3, 2, prov, null, 'owner@example.com');
  assert (j->>'added')::int = 3 and (j->>'updated')::int = 2 and (j->>'provenance')::int = 3, 'three added, two updated, three files: ' || j::text;
  select count(*) into n from public.ccrs_filed_entities where env = 'prod' and external_id in ('D250-NEW', 'D250-SEED') and source = 'seed:2026-11-17-delivery';
  assert n = 2, 'delivered rows carry the delivery source';
  select count(*) into n from public.ccrs_filed_entities where env = 'prod' and external_id in ('D250-SOLD', 'D250-LINK') and source = 'proof:2026-11-17-delivery-sale' and state = 'seed';
  assert n = 2, 'sale-proven rows carry the proof source and are present';
  select count(*) into n from public.ccrs_filed_entities where env = 'prod' and external_id = 'D250-OURS' and state = 'filed' and source = 'file:d250';
  assert n = 1, 'our row untouched';
  select count(*) into n from public.ccrs_filed_entities where env = 'prod' and file_type = 'Product' and external_id = 'P1' and filed_name = 'Solo';
  assert n = 1, 'product added with its name';
  select count(*) into n from public.ccrs_files where purpose = 'seed' and state = 'closed' and file_name like 'seed:2026-11-17-delivery:%';
  assert n = 3, 'three provenance files';
  select count(*) into n from public.ccrs_files where purpose = 'seed' and file_name like 'seed:2026-11-17-delivery:3333%' and storage_path = 'local:sheets.xlsx';
  assert n = 1, 'a file loaded from disk (CLI, no storage path) is recorded as local:<name>';
  select count(*) into n from public.ccrs_delivery_stage where load_id = lid;
  assert n = 0, 'stage cleared';
  select count(*) into n from public.ccrs_delivery_loads where id = lid and status = 'applied' and applied_by_email = 'owner@example.com';
  assert n = 1, 'load marked applied';

  -- 7. applied once only
  perform pg_temp.must_fail(format('select public.ccrs_apply_delivery(%L, 0, 0, %L::jsonb, null, null)', lid, prov), 'CCRS_DELIVERY_NOT_READY');

  -- 8. an early date is refused
  insert into public.ccrs_delivery_loads (as_of, status) values ('2026-09-18', 'ready') returning id into lid;
  perform pg_temp.must_fail(format('select public.ccrs_apply_delivery(%L, 0, 0, %L::jsonb, null, null)', lid, prov), 'CCRS_DELIVERY_TOO_OLD');

  raise notice 'CCRS 0368 CHECK PASSED';
end $$;

rollback;
