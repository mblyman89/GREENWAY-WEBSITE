-- scripts/recon/ccrs-held-sync-0297-pg-check.sql  (R74 S39 - migration 0297)
--
-- Scenario check for 0297_ccrs_held_sync.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ccrs-held-sync-0297-pg-check.sql
--
-- "R74 0297 CHECK PASSED" then ROLLBACK = all clear.
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
  h int;
  r int;
begin
  -- 0. shape
  select count(*) into n from pg_class where relname = 'ccrs_held_sync' and relkind = 'r' and relrowsecurity;
  assert n = 1, 'ccrs_held_sync with RLS on';
  select count(*) into n from pg_policies where tablename = 'ccrs_held_sync';
  assert n = 1, 'one staff read policy';

  -- 1. week A holds a lot and a sale line
  select held, resolved into h, r from public.ccrs_record_held('prod', '2026-10-18',
    '[{"t":"Inventory","id":"L1","label":"Lot 1","code":"E52_CULTIVERA_LOT_NOT_ON_RECORD","reason":"x"},
      {"t":"Sale","id":"S1","label":"S1","code":"E56_EVENT_ROW_LOT_HELD","reason":"y"},
      {"t":"Sale","id":"S1","label":"dup","code":"E56_EVENT_ROW_LOT_HELD","reason":"y"}]'::jsonb);
  assert h = 2 and r = 0, 'two held (duplicate collapsed), none resolved';

  -- 2. same week again: still held, first_held_at kept, nothing resolved
  select held, resolved into h, r from public.ccrs_record_held('prod', '2026-10-18',
    '[{"t":"Inventory","id":"L1","code":"E52_CULTIVERA_LOT_NOT_ON_RECORD"},{"t":"Sale","id":"S1","code":"E56_EVENT_ROW_LOT_HELD"}]'::jsonb);
  assert r = 0, 'nothing resolved on re-emit';
  select count(*) into n from public.ccrs_held_sync where env = 'prod';
  assert n = 2, 'upsert, no duplicates';

  -- 3. week B emits with nothing held: the lot (master) resolves, week A's sale stays owed
  select held, resolved into h, r from public.ccrs_record_held('prod', '2026-10-25', '[]'::jsonb);
  assert h = 0 and r = 1, 'master record resolves across weeks';
  select count(*) into n from public.ccrs_held_sync where record_type = 'Sale' and resolved_at is null;
  assert n = 1, 'sale row still owed until its week is rebuilt';

  -- 4. PREprod never touches prod rows
  perform public.ccrs_record_held('preprod', '2026-10-18', '[]'::jsonb);
  select count(*) into n from public.ccrs_held_sync where env = 'prod' and resolved_at is null;
  assert n = 1, 'env isolated';

  -- 5. week A rebuilt clean: the sale resolves
  select held, resolved into h, r from public.ccrs_record_held('prod', '2026-10-18', '[]'::jsonb);
  assert r = 1, 'sale resolves when its week is re-emitted';

  -- 6. held again later re-opens the row
  perform public.ccrs_record_held('prod', '2026-10-18', '[{"t":"Sale","id":"S1","code":"E56_EVENT_ROW_LOT_HELD"}]'::jsonb);
  select count(*) into n from public.ccrs_held_sync where record_id = 'S1' and resolved_at is null;
  assert n = 1, 're-held row re-opens';
end $$;

-- 7. refusals
select pg_temp.must_fail($q$select public.ccrs_record_held('test', '2026-10-18', '[]'::jsonb)$q$, 'CCRS_HELD_BAD_ENV');
select pg_temp.must_fail($q$select public.ccrs_record_held('prod', null, '[]'::jsonb)$q$, 'CCRS_HELD_NO_WEEK');
select pg_temp.must_fail($q$select public.ccrs_record_held('prod', '2026-10-18', '{}'::jsonb)$q$, 'CCRS_HELD_NOT_ARRAY');
select pg_temp.must_fail($q$select public.ccrs_record_held('prod', '2026-10-18', '[{"t":"Bogus","id":"x","code":"c"}]'::jsonb)$q$, 'ccrs_held_sync_record_type_check');
select pg_temp.must_fail($q$select public.ccrs_record_held('prod', '2026-10-18', '[{"t":"Sale","id":"","code":"c"}]'::jsonb)$q$, 'ccrs_held_sync_record_id_check');
select pg_temp.must_fail($q$select public.ccrs_record_held('prod', '2026-10-18', '[{"t":"Sale","id":"x"}]'::jsonb)$q$, '23502');

select 'R74 0297 CHECK PASSED';
rollback;
