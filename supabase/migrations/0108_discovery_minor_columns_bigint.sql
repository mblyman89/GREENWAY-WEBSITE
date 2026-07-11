-- ===========================================================================
-- 0108_discovery_minor_columns_bigint.sql
--
-- Task H (S8): fix the monthly-zip upload failure the owner hit on the real
-- April 2026 delivery:
--
--   "discovery_benchmarks insert failed: value 8932289184 is out of range
--    for type integer"
--
-- ROOT CAUSE (verified against the real May 2026 rollup, no guessing):
-- discovery_benchmarks (0079) declares its percentile money columns as
-- `integer` (int4 max = 2,147,483,647). The transformer reuses `avg_minor`
-- to store STATEWIDE REVENUE TOTALS (metrics retail_revenue /
-- wholesale_revenue, money in MINOR UNITS per standing rules). A real month
-- of Washington statewide retail is ~$90M+ = ~9,000,000,000 cents, which
-- overflows int4. Real-data check of the May 2026 extract found 4 rows over
-- the int4 ceiling:
--   retail/overall/all               12,531,365,735
--   retail/type/(unattributed)        8,572,258,333
--   wholesale/overall/all             8,716,406,494
--   wholesale/type/(unattributed)     6,676,246,603
-- April's failing value 8,932,289,184 is the same class of row.
--
-- FIX: widen every *_minor money column written by the transformer to
-- bigint across the three rollup tables. Unit-price percentiles could not
-- overflow in the real files checked, but a single anomalous CCRS price row
-- would crash the whole save the same way — bigint everywhere removes the
-- failure mode outright (no cutting corners). bigint per standing rules is
-- already the norm for money totals (see 0079 wholesale_out_minor, 0106
-- retail_revenue_minor / revenue_minor / wholesale_spend_minor in 0107).
--
-- Idempotent: ALTER COLUMN ... TYPE bigint on an already-bigint column is a
-- harmless no-op rewrite; these tables are small (thousands of rows).
-- No code change is needed for reads/writes: JS numbers and PostgREST JSON
-- handle these magnitudes exactly (all values far below 2^53).
--
-- APPLY MANUALLY (owner applies migrations by hand, per standing rules),
-- then RE-UPLOAD the monthly zip — the failed April attempt saved nothing
-- (its dataset row was marked status='error'; deleting it from the CCRS page
-- also removes any partially-inserted benchmark batches via FK cascade).
-- ===========================================================================

-- discovery_benchmarks (0079): percentile/money columns. avg_minor carries
-- revenue totals for the *_revenue metrics — the column that overflowed.
alter table public.discovery_benchmarks
  alter column min_minor    type bigint,
  alter column p25_minor    type bigint,
  alter column median_minor type bigint,
  alter column p75_minor    type bigint,
  alter column max_minor    type bigint,
  alter column avg_minor    type bigint;

-- discovery_competitor_stats (0106): retail unit-price distribution.
alter table public.discovery_competitor_stats
  alter column price_min_minor    type bigint,
  alter column price_p25_minor    type bigint,
  alter column price_median_minor type bigint,
  alter column price_p75_minor    type bigint,
  alter column price_max_minor    type bigint,
  alter column price_avg_minor    type bigint;

-- discovery_market_signals (0106): mover price bands.
alter table public.discovery_market_signals
  alter column median_unit_price_minor type bigint,
  alter column p25_unit_price_minor    type bigint;
