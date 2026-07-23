-- ---------------------------------------------------------------------------
-- 0131_pacific_sale_date_default.sql  (GW-009 fix — run manually in the SQL editor)
--
-- THE PROBLEM: medical_exempt_sales.sale_date (the WAC 314-55-090(2)(a)
-- excise-exempt ledger date) defaulted to `current_date` — the DATABASE
-- SERVER's calendar day, which on Supabase is UTC. The store operates on
-- America/Los_Angeles time: between 4/5 PM Pacific and midnight Pacific,
-- UTC is already "tomorrow", so an evening exempt sale on the last day of
-- the month would land in NEXT month's medical ledger, LIQ-1295 excise
-- return, and CCRS RecreationalMedical period.
--
-- THE FIX (two layers, same PR):
--   1. Application code now writes the Pacific day EXPLICITLY on every
--      insert (src/lib/medical/store.ts uses pacificToday()), so the
--      default is no longer relied upon at all.
--   2. This migration re-points the column DEFAULT at the Pacific calendar
--      day anyway, so any future insert path that forgets the column still
--      gets the correct store-local date. `America/Los_Angeles` is
--      DST-aware inside Postgres — no manual offset math.
--
-- No backfill: the owner has not cut over, and historical rows are off by
-- at most one day only for evening sales at period boundaries (audit
-- documented this as acceptable; see FINDINGS GW-009).
--
-- Idempotent: ALTER ... SET DEFAULT simply overwrites the previous default.
-- Safe to re-run.
-- ---------------------------------------------------------------------------

alter table public.medical_exempt_sales
  alter column sale_date
  set default ((now() at time zone 'America/Los_Angeles')::date);

-- ---------------------------------------------------------------------------
-- Review query (read-only) — run once after applying. EXPECT one row showing
-- the new default containing 'America/Los_Angeles'.
-- ---------------------------------------------------------------------------
-- select column_name, column_default
--   from information_schema.columns
--  where table_schema = 'public'
--    and table_name   = 'medical_exempt_sales'
--    and column_name  = 'sale_date';
