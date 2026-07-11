-- ===========================================================================
-- 0109_discovery_supplier_stats.sql
--
-- Task H (S10, owner-approved suggestion #2): STATEWIDE wholesale supplier
-- benchmarks per monthly transformer drop — negotiation leverage. One row per
-- (dataset, supplier licensee): observed wholesale line volume, revenue,
-- unit-price distribution, and buyer reach (distinct buyers statewide +
-- how many are tracked roster competitors).
--
-- Sources (verified semantics, never guessed):
--   * lines/revenue/prices: wholesale SalesDetail lines whose SaleHeader
--     carried a packable seller LicenseeId;
--   * buyer reach: DISTINCT buyer licensees on wholesale SaleHeaders;
--   * identity: the monthly licensee table (shipped whole every month) —
--     missing identity stays null.
--
-- Money in MINOR UNITS (cents); all money columns BIGINT (the S8 lesson:
-- a real month's statewide totals overflow int4).
--
-- Idempotent (safe to re-run). RLS: staff read/write, same as 0106.
-- APPLY MANUALLY (owner applies migrations by hand, per standing rules),
-- then RE-UPLOAD monthly zips to backfill supplier benchmarks.
-- ===========================================================================

create table if not exists public.discovery_supplier_stats (
  id                bigint generated always as identity primary key,
  dataset_id        uuid not null references public.discovery_datasets(id) on delete cascade,
  licensee_id       text not null,          -- CCRS surrogate LicenseeId (per-extract)
  license_number    text,                   -- stable public id (join across months)
  name              text,
  dba               text,
  line_count        bigint not null default 0,
  revenue_minor     bigint not null default 0,
  -- per-line wholesale unit-price distribution (minor units; null = no samples)
  price_sample_size bigint not null default 0,
  price_min_minor    bigint,
  price_p25_minor    bigint,
  price_median_minor bigint,
  price_p75_minor    bigint,
  price_max_minor    bigint,
  price_avg_minor    bigint,
  distinct_buyers   integer not null default 0,
  tracked_buyers    integer not null default 0,
  created_at        timestamptz not null default now(),
  unique (dataset_id, licensee_id)
);
create index if not exists idx_disc_supplier_stats_dataset on public.discovery_supplier_stats (dataset_id);
create index if not exists idx_disc_supplier_stats_license on public.discovery_supplier_stats (license_number);

alter table public.discovery_supplier_stats enable row level security;

drop policy if exists discovery_supplier_stats_read on public.discovery_supplier_stats;
create policy discovery_supplier_stats_read on public.discovery_supplier_stats
  for select using (public.is_staff());
drop policy if exists discovery_supplier_stats_write on public.discovery_supplier_stats;
create policy discovery_supplier_stats_write on public.discovery_supplier_stats
  for all using (public.is_staff()) with check (public.is_staff());
