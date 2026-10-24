-- scripts/recon/ccrs-record-copies-0298-pg-check.sql  (R74 S40 - migration 0298)
--
-- Scenario check for 0298_ccrs_record_copies.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ccrs-record-copies-0298-pg-check.sql
--
-- "R74 0298 CHECK PASSED" then ROLLBACK = all clear.
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

create temp table t_ids (k text primary key, v uuid);

do $$
declare
  n int;
  j jsonb;
  cid uuid;
  prov jsonb := '[{"source":"Inventory","fileName":"I.csv","sha256":"1111111111111111111111111111111111111111111111111111111111111111","rows":2,"storagePath":"x/I.csv"},
                  {"source":"Product","fileName":"P.csv","sha256":"2222222222222222222222222222222222222222222222222222222222222222","rows":1,"storagePath":"x/P.csv"},
                  {"source":"Strain","fileName":"S.csv","sha256":"3333333333333333333333333333333333333333333333333333333333333333","rows":1,"storagePath":"x/S.csv"},
                  {"source":"Area","fileName":"A.csv","sha256":"4444444444444444444444444444444444444444444444444444444444444444","rows":1,"storagePath":"x/A.csv"}]';
begin
  -- 0. shape
  select count(*) into n from pg_class where relname in ('ccrs_record_copies', 'ccrs_record_copy_stage') and relkind = 'r' and relrowsecurity;
  assert n = 2, 'both tables with RLS on';
  select count(*) into n from storage.buckets where id = 'ccrs-records' and not public;
  assert n = 1, 'private ccrs-records bucket';
  assert not has_function_privilege('anon', 'public.ccrs_apply_record_copy(uuid, integer, integer, jsonb, uuid, text)', 'execute'), 'anon cannot apply';
  assert not has_function_privilege('authenticated', 'public.ccrs_records_ledger_page(integer, integer)', 'execute'), 'authenticated cannot read the ledger page';

  -- 1. a seeded ledger with one untouched seed lot
  insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path, state)
  values ('prod', 'Inventory', 'seed', 's40:seed', repeat('e', 64), 1, 'none', 'closed');
  insert into public.ccrs_filed_entities (env, file_type, external_id, state, source, seed_payload)
  values ('prod', 'Inventory', 'S40-LOT-A', 'seed', 'seed:2026-09-18-delivery', '{"Quantity on Hand":"5"}');

  select public.ccrs_records_ledger_page(0, 100000) into j;
  assert exists (select 1 from jsonb_array_elements(j) x where x->>'id' = 'S40-LOT-A' and x->>'updatedAt' ~ '^\d+$'), 'ledger page holds the lot with integer updatedAt';
  assert jsonb_array_length(public.ccrs_records_ledger_page(1000000, 10)) = 0, 'past the end is empty';

  -- 2. a ready copy: add one, refresh one
  insert into public.ccrs_record_copies (as_of, status) values ('2026-10-20', 'ready') returning id into cid;
  insert into t_ids values ('c', cid);
  insert into public.ccrs_record_copy_stage (copy_id, op, file_type, external_id, state, payload, expect_state, expect_us)
  select cid, 'refresh', 'Inventory', 'S40-LOT-A', 'closed', '{"Quantity on Hand":"0"}', e.state, (extract(epoch from e.updated_at) * 1000000)::bigint
    from public.ccrs_filed_entities e where e.env = 'prod' and e.file_type = 'Inventory' and e.external_id = 'S40-LOT-A';
  insert into public.ccrs_record_copy_stage (copy_id, op, file_type, external_id, state, payload)
  values (cid, 'add', 'Inventory', 'S40-LOT-B', 'seed', '{"Quantity on Hand":"3"}');

  -- 3. refusals
  perform pg_temp.must_fail(format('select public.ccrs_apply_record_copy(%L, 1, 1, %L::jsonb, null, null)', cid, '[]'), 'CCRS_COPY_PROVENANCE');
  perform pg_temp.must_fail(format('select public.ccrs_apply_record_copy(%L, 2, 1, %L::jsonb, null, null)', cid, prov), 'CCRS_RESEED_STAGE');
  perform pg_temp.must_fail(format('select public.ccrs_apply_record_copy(%L, 1, 1, %L::jsonb, null, null)', gen_random_uuid(), prov), 'CCRS_COPY_NOT_FOUND');

  -- 4. the apply
  j := public.ccrs_apply_record_copy(cid, 1, 1, prov, null, 'owner@example.com');
  assert (j->>'added')::int = 1 and (j->>'updated')::int = 1, 'one added, one updated: ' || j::text;
  select count(*) into n from public.ccrs_filed_entities where env = 'prod' and external_id in ('S40-LOT-A', 'S40-LOT-B') and source = 'seed:2026-10-20-delivery';
  assert n = 2, 'both carry the new source';
  select count(*) into n from public.ccrs_filed_entities where env = 'prod' and external_id = 'S40-LOT-A' and state = 'closed';
  assert n = 1, 'the refresh closed the lot';
  select count(*) into n from public.ccrs_files where purpose = 'seed' and file_name like 'seed:2026-10-20-delivery:%';
  assert n = 4, 'four provenance files';
  select count(*) into n from public.ccrs_record_copy_stage where copy_id = cid;
  assert n = 0, 'stage cleared';
  select count(*) into n from public.ccrs_record_copies where id = cid and status = 'applied' and applied_by_email = 'owner@example.com';
  assert n = 1, 'copy marked applied';

  -- 5. applied twice is refused
  perform pg_temp.must_fail(format('select public.ccrs_apply_record_copy(%L, 0, 0, %L::jsonb, null, null)', cid, prov), 'CCRS_COPY_NOT_READY');

  -- 6. a stale guard writes nothing
  insert into public.ccrs_record_copies (as_of, status) values ('2026-10-21', 'ready') returning id into cid;
  insert into public.ccrs_record_copy_stage (copy_id, op, file_type, external_id, state, payload, expect_state, expect_us)
  values (cid, 'refresh', 'Inventory', 'S40-LOT-A', 'seed', '{}', 'seed', 1);
  perform pg_temp.must_fail(format('select public.ccrs_apply_record_copy(%L, 0, 1, %L::jsonb, null, null)', cid,
    replace(replace(prov::text, '1111', 'aaaa'), '2222', 'bbbb')), 'CCRS_RESEED_STALE');
  select count(*) into n from public.ccrs_record_copies where id = cid and status = 'ready';
  assert n = 1, 'a refused apply leaves the copy ready';

  -- 7. bad status refused by the table
  perform pg_temp.must_fail('insert into public.ccrs_record_copies (as_of, status) values (''2026-10-22'', ''weird'')', '23514');
end $$;

select 'R74 0298 CHECK PASSED';
rollback;
