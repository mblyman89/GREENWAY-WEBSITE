-- ===========================================================================
-- verify-slice2-migration.sql  (SLICE 2 verification harness)
--
-- Proves migration 0214_inventory_lot_received_date.sql against a REAL
-- PostgreSQL server instead of assuming it is valid. Checks:
--
--   1. It applies cleanly to a table shaped like inventory_lots.
--   2. It is IDEMPOTENT (Rule 6) — applying it twice changes nothing and
--      does not error.
--   3. The provenance CHECK rejects an unknown source value.
--   4. The sanity CHECK rejects a pre-2014-07-08 date and a future date,
--      and accepts today (Pacific) — proving `now()` is legal in the CHECK.
--   5. The evidence-based backfill recovers ONLY dates the importer actually
--      recorded, and leaves "Received date missing in POS export." lots NULL.
--   6. The partial-order index exists.
--
-- Run: su postgres -c "psql -h /tmp -p 5433 -U postgres -f <this file>"
-- ===========================================================================
\set ON_ERROR_STOP on
\pset pager off

-- The migration is written against public.inventory_lots (correctly), so the
-- harness builds the fixture IN public inside a throwaway database.
drop table if exists public.inventory_lots cascade;
drop table if exists public.staff_profiles cascade;
set search_path = public;

-- Minimal stand-ins for the referenced tables.
create table public.staff_profiles (id uuid primary key default gen_random_uuid());

-- inventory_lots as it exists BEFORE 0214 (columns the migration touches).
create table public.inventory_lots (
  id          uuid primary key default gen_random_uuid(),
  lot_code    text,
  status      text not null default 'active',
  on_hand_qty numeric not null default 0,
  notes       text,
  created_at  timestamptz not null default now()
);

-- Seed rows that mirror the REAL Cultivera import notes (import-lot-core.ts
-- lotNote(), line 293 — the only two shapes it ever writes).
insert into public.inventory_lots (lot_code, status, on_hand_qty, notes) values
  ('L-DATED-1',  'active', 5,
   'Cultivera migration (one-time POS import). Received 2026-06-17. COA flag N in POS export - obtain and attach the COA during enrichment. Expiration date not provided by POS export - set during enrichment.'),
  ('L-DATED-2',  'active', 0,
   'Cultivera migration (one-time POS import). Received 2025-01-02. Merged 3 POS rows sharing this barcode.'),
  ('L-MISSING-1','active', 9,
   'Cultivera migration (one-time POS import). Received date missing in POS export. COA flag N in POS export - obtain and attach the COA during enrichment.'),
  ('L-MISSING-2','quarantine', 4,
   'Cultivera migration (one-time POS import). Received date missing in POS export.'),
  ('L-DESTROYED','destroyed', 0,
   'Cultivera migration (one-time POS import). Received date missing in POS export.'),
  ('L-NONOTE',   'active', 1, null),
  ('L-BADYEAR',  'active', 1,
   'Cultivera migration (one-time POS import). Received 1999-01-01.');

\echo '=== applying 0214 (pass 1) ==='
\i supabase/migrations/0214_inventory_lot_received_date.sql

\echo '=== applying 0214 (pass 2 - IDEMPOTENCY, Rule 6) ==='
\i supabase/migrations/0214_inventory_lot_received_date.sql

-- ---------------------------------------------------------------------------
do $$
declare
  n int;
  v text;
  failed int := 0;
  passed int := 0;
begin
  -- helper-ish inline assertions -------------------------------------------

  -- 1. columns exist
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='inventory_lots'
     and column_name in ('received_on','received_on_source','received_on_set_by','received_on_set_at');
  if n = 4 then passed:=passed+1; raise notice 'PASS  all 4 columns added';
  else failed:=failed+1; raise warning 'FAIL  expected 4 columns, got %', n; end if;

  -- 2. received_on is NULLABLE (the flag depends on it)
  select is_nullable into v from information_schema.columns
   where table_schema='public' and table_name='inventory_lots' and column_name='received_on';
  if v = 'YES' then passed:=passed+1; raise notice 'PASS  received_on is nullable (NULL = unknown)';
  else failed:=failed+1; raise warning 'FAIL  received_on nullable = %', v; end if;

  -- 3. received_on has NO default (must never auto-fill)
  select coalesce(column_default,'(none)') into v from information_schema.columns
   where table_schema='public' and table_name='inventory_lots' and column_name='received_on';
  if v = '(none)' then passed:=passed+1; raise notice 'PASS  received_on has no default - never auto-filled';
  else failed:=failed+1; raise warning 'FAIL  received_on default = %', v; end if;

  -- 4. backfill recovered the dated lots
  select received_on::text into v from public.inventory_lots where lot_code='L-DATED-1';
  if v = '2026-06-17' then passed:=passed+1; raise notice 'PASS  L-DATED-1 recovered 2026-06-17 from the note';
  else failed:=failed+1; raise warning 'FAIL  L-DATED-1 received_on = %', v; end if;

  select received_on::text into v from public.inventory_lots where lot_code='L-DATED-2';
  if v = '2025-01-02' then passed:=passed+1; raise notice 'PASS  L-DATED-2 recovered date mid-note';
  else failed:=failed+1; raise warning 'FAIL  L-DATED-2 received_on = %', v; end if;

  -- 5. provenance stamped for machine-recovered values
  select received_on_source into v from public.inventory_lots where lot_code='L-DATED-1';
  if v = 'pos_import' then passed:=passed+1; raise notice 'PASS  provenance stamped pos_import';
  else failed:=failed+1; raise warning 'FAIL  provenance = %', v; end if;

  -- 6. THE CRITICAL ONE: "missing" lots stay NULL, never invented
  select count(*) into n from public.inventory_lots
   where lot_code in ('L-MISSING-1','L-MISSING-2','L-DESTROYED','L-NONOTE')
     and received_on is null;
  if n = 4 then passed:=passed+1; raise notice 'PASS  undated lots remain NULL - no date invented';
  else failed:=failed+1; raise warning 'FAIL  expected 4 NULL, got %', n; end if;

  -- 7. pre-floor date in a note is NOT backfilled
  select received_on::text into v from public.inventory_lots where lot_code='L-BADYEAR';
  if v is null then passed:=passed+1; raise notice 'PASS  pre-2014 note date refused by backfill';
  else failed:=failed+1; raise warning 'FAIL  L-BADYEAR received_on = %', v; end if;

  -- 8. no row was given a date equal to its import timestamp
  select count(*) into n from public.inventory_lots
   where received_on is not null and received_on = created_at::date
     and lot_code like 'L-MISSING%';
  if n = 0 then passed:=passed+1; raise notice 'PASS  no undated lot was backfilled from created_at';
  else failed:=failed+1; raise warning 'FAIL  % lots derived from created_at', n; end if;

  -- 9. index exists
  select count(*) into n from pg_indexes
   where schemaname='public' and indexname='inventory_lots_received_on_idx';
  if n = 1 then passed:=passed+1; raise notice 'PASS  received_on index created';
  else failed:=failed+1; raise warning 'FAIL  index missing'; end if;

  -- 10. constraints exist (and were not duplicated by the second pass)
  select count(*) into n from pg_constraint
   where conname = 'inventory_lots_received_on_source_chk';
  if n = 1 then passed:=passed+1; raise notice 'PASS  provenance constraint present exactly once';
  else failed:=failed+1; raise warning 'FAIL  provenance constraint count = %', n; end if;

  select count(*) into n from pg_constraint
   where conname = 'inventory_lots_received_on_sane_chk';
  if n = 1 then passed:=passed+1; raise notice 'PASS  sanity constraint present exactly once (now() IS legal in CHECK)';
  else failed:=failed+1; raise warning 'FAIL  sanity constraint count = %', n; end if;

  -- 11. bad provenance rejected
  begin
    update public.inventory_lots set received_on_source='guessed' where lot_code='L-NONOTE';
    failed:=failed+1; raise warning 'FAIL  bogus provenance was ACCEPTED';
  exception when check_violation then
    passed:=passed+1; raise notice 'PASS  bogus provenance rejected by DB';
  end;

  -- 12. pre-floor date rejected at the DB
  begin
    update public.inventory_lots set received_on = date '2014-07-07' where lot_code='L-NONOTE';
    failed:=failed+1; raise warning 'FAIL  pre-floor date was ACCEPTED';
  exception when check_violation then
    passed:=passed+1; raise notice 'PASS  pre-2014-07-08 date rejected by DB';
  end;

  -- 13. the floor day itself is accepted
  begin
    update public.inventory_lots set received_on = date '2014-07-08' where lot_code='L-NONOTE';
    passed:=passed+1; raise notice 'PASS  floor day 2014-07-08 accepted';
  exception when check_violation then
    failed:=failed+1; raise warning 'FAIL  floor day was rejected';
  end;

  -- 14. far-future date rejected
  begin
    update public.inventory_lots set received_on = (now() at time zone 'America/Los_Angeles')::date + 30
     where lot_code='L-NONOTE';
    failed:=failed+1; raise warning 'FAIL  future date was ACCEPTED';
  exception when check_violation then
    passed:=passed+1; raise notice 'PASS  future date rejected by DB';
  end;

  -- 15. today (Pacific) is accepted - proves the clock is the business clock
  begin
    update public.inventory_lots
       set received_on = (now() at time zone 'America/Los_Angeles')::date
     where lot_code='L-NONOTE';
    passed:=passed+1; raise notice 'PASS  today (Pacific) accepted';
  exception when check_violation then
    failed:=failed+1; raise warning 'FAIL  today was rejected';
  end;

  -- 16. an owner-entered correction sticks with full attribution
  update public.inventory_lots
     set received_on='2026-03-04', received_on_source='owner_entered', received_on_set_at=now()
   where lot_code='L-MISSING-1';
  select received_on::text || '/' || received_on_source into v
    from public.inventory_lots where lot_code='L-MISSING-1';
  if v = '2026-03-04/owner_entered' then passed:=passed+1;
    raise notice 'PASS  owner correction stored with provenance';
  else failed:=failed+1; raise warning 'FAIL  owner correction = %', v; end if;

  -- 17. A NAIVE backfill (no floor guard) must be STOPPED BY THE DATABASE.
  --     This is the whole reason the CHECK exists: the app-layer validator
  --     cannot bind a statement someone types by hand at 11pm.
  begin
    update public.inventory_lots
       set received_on        = (substring(notes from 'Received (\d{4}-\d{2}-\d{2})\.'))::date,
           received_on_source = 'pos_import'
     where received_on is null
       and notes ~ 'Received \d{4}-\d{2}-\d{2}\.';
    failed:=failed+1; raise warning 'FAIL  unguarded backfill wrote a pre-1999 date';
  exception when check_violation then
    passed:=passed+1;
    raise notice 'PASS  DB stops an unguarded hand-run backfill (defense in depth)';
  end;

  -- 18. Re-running the MIGRATION'S OWN backfill (with its floor + future
  --     guards, exactly as written in 0214) is safe AND does not overwrite a
  --     date the owner has already corrected by hand.
  update public.inventory_lots
     set received_on        = (substring(notes from 'Received (\d{4}-\d{2}-\d{2})\.'))::date,
         received_on_source = 'pos_import',
         received_on_set_at = now()
   where received_on is null
     and notes ~ 'Received \d{4}-\d{2}-\d{2}\.'
     and (substring(notes from 'Received (\d{4}-\d{2}-\d{2})\.'))::date >= date '2014-07-08'
     and (substring(notes from 'Received (\d{4}-\d{2}-\d{2})\.'))::date
         <= ((now() at time zone 'America/Los_Angeles')::date + 1);
  select received_on_source into v from public.inventory_lots where lot_code='L-MISSING-1';
  if v = 'owner_entered' then passed:=passed+1;
    raise notice 'PASS  re-run does not clobber the owner''s hand-entered date';
  else failed:=failed+1; raise warning 'FAIL  owner value overwritten -> %', v; end if;

  -- 19. and the pre-floor note lot is STILL null after that safe re-run
  select received_on::text into v from public.inventory_lots where lot_code='L-BADYEAR';
  if v is null then passed:=passed+1;
    raise notice 'PASS  guarded re-run still refuses the 1999 note date';
  else failed:=failed+1; raise warning 'FAIL  L-BADYEAR = %', v; end if;

  raise notice '---------------------------------------------';
  raise notice 'SLICE 2 MIGRATION: % passed, % failed', passed, failed;
  if failed > 0 then
    raise exception 'SLICE 2 migration verification FAILED (% failures)', failed;
  end if;
end$$;

\echo ''
\echo '=== final state of the seeded lots ==='
select lot_code, status, received_on, received_on_source
  from public.inventory_lots order by lot_code;

drop table public.inventory_lots cascade;
drop table public.staff_profiles cascade;
