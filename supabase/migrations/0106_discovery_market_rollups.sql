-- ===========================================================================
-- 0106_discovery_market_rollups.sql
--
-- Task H (S3): storage for the monthly CCRS statewide-extract TRANSFORMER
-- rollups. The transformer runs IN THE BROWSER on the dragged-in monthly zip
-- (~1 GB raw, ~10.8M sale-detail rows) and posts only small aggregates:
--
--   * statewide benchmarks  -> existing public.discovery_benchmarks
--                              (new metric strings, e.g. retail_unit_price /
--                              wholesale_price_per_gram / retail_revenue;
--                              metric column is already text — no change)
--   * competitor stats      -> NEW public.discovery_competitor_stats
--   * market signals        -> NEW public.discovery_market_signals
--   * honest line totals    -> NEW columns on public.discovery_datasets
--
-- Idempotent (safe to re-run). RLS: staff read/write, same as 0079/0080.
-- Money in MINOR UNITS (cents) everywhere.
--
-- APPLY MANUALLY (owner applies migrations by hand, per standing rules).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- discovery_datasets: transformer bookkeeping (attribution honesty)
-- ---------------------------------------------------------------------------
alter table public.discovery_datasets
  add column if not exists retail_lines            bigint,
  add column if not exists wholesale_lines         bigint,
  add column if not exists attributed_retail_lines bigint,
  add column if not exists ingest_kind             text not null default 'csv';
-- ingest_kind: 'csv' (legacy per-file upload) | 'monthly_zip' (transformer)

-- ---------------------------------------------------------------------------
-- discovery_competitor_stats — per tracked license, per dataset (month)
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_competitor_stats (
  id                 bigint generated always as identity primary key,
  dataset_id         uuid not null references public.discovery_datasets(id) on delete cascade,
  license_number     text not null,           -- joins discovery_competitors.license_number
  licensee_id        text,                    -- CCRS surrogate LicenseeId (per-extract)
  name               text,
  dba                text,
  city               text,
  retail_units       numeric not null default 0,
  retail_revenue_minor bigint not null default 0,
  retail_line_count  integer not null default 0,
  -- retail unit-price distribution (minor units; null when no samples)
  price_sample_size  integer not null default 0,
  price_min_minor    integer,
  price_p25_minor    integer,
  price_median_minor integer,
  price_p75_minor    integer,
  price_max_minor    integer,
  price_avg_minor    integer,
  by_type            jsonb not null default '[]'::jsonb,  -- [{inventoryType, units, revenueMinor}]
  top_products       jsonb not null default '[]'::jsonb,  -- [{productName, inventoryType, units, revenueMinor, medianUnitPriceMinor}]
  created_at         timestamptz not null default now(),
  unique (dataset_id, license_number)
);
create index if not exists idx_disc_comp_stats_dataset on public.discovery_competitor_stats (dataset_id);
create index if not exists idx_disc_comp_stats_license on public.discovery_competitor_stats (license_number);

-- ---------------------------------------------------------------------------
-- discovery_market_signals — what's moving (statewide + at competitors)
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_market_signals (
  id                     bigint generated always as identity primary key,
  dataset_id             uuid not null references public.discovery_datasets(id) on delete cascade,
  kind                   text not null,       -- 'statewide_mover' | 'competitor_mover'
  license_number         text,                -- set for competitor_mover
  inventory_type         text,
  product_name           text,
  brand                  text,
  strain_name            text,
  units                  numeric not null default 0,
  revenue_minor          bigint not null default 0,
  median_unit_price_minor integer,
  p25_unit_price_minor   integer,             -- the "undercut" reference band
  created_at             timestamptz not null default now()
);
create index if not exists idx_disc_signals_dataset on public.discovery_market_signals (dataset_id);
create index if not exists idx_disc_signals_kind    on public.discovery_market_signals (dataset_id, kind);

-- ---------------------------------------------------------------------------
-- RLS — staff read + write (matches 0079/0080)
-- ---------------------------------------------------------------------------
alter table public.discovery_competitor_stats enable row level security;
alter table public.discovery_market_signals   enable row level security;

drop policy if exists discovery_competitor_stats_read on public.discovery_competitor_stats;
create policy discovery_competitor_stats_read on public.discovery_competitor_stats
  for select using (public.is_staff());
drop policy if exists discovery_competitor_stats_write on public.discovery_competitor_stats;
create policy discovery_competitor_stats_write on public.discovery_competitor_stats
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists discovery_market_signals_read on public.discovery_market_signals;
create policy discovery_market_signals_read on public.discovery_market_signals
  for select using (public.is_staff());
drop policy if exists discovery_market_signals_write on public.discovery_market_signals;
create policy discovery_market_signals_write on public.discovery_market_signals
  for all using (public.is_staff()) with check (public.is_staff());
