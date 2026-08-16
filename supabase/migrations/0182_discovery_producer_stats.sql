-- ===========================================================================
-- 0182_discovery_producer_stats.sql
--
-- Slice 7: "what are producer/processors selling the most of?"
--
-- The back office could already answer "which supplier billed the most dollars
-- wholesale" (discovery_supplier_stats, migration 0109) and "which vendor made
-- this one product" (discovery_market_signals.vendor_license, migration 0110).
-- It could NOT pivot on a producer/processor and show that vendor's actual
-- product and category mix — which is what a purchase-order recommendation
-- needs. This migration adds that, as TWO DELIBERATELY SEPARATE signals.
--
-- ---------------------------------------------------------------------------
-- SIGNAL A — SELL-IN (what the vendor SHIPPED)
--   New jsonb columns on discovery_supplier_stats.
--   Source: wholesale SalesDetail lines whose SaleHeader carried a packable
--   seller LicenseeId. The seller id is packed on EVERY wholesale header, so
--   coverage is high. Lines whose lot did not resolve to a Product row are NOT
--   folded into a category — they are counted in unattributed_lines so the mix
--   always states its own denominator.
--
-- SIGNAL B — SELL-THROUGH (what consumers actually BOUGHT)
--   New table discovery_producer_stats.
--   Source: retail SalesDetail lines whose lot resolved to a manifest ORIGIN
--   vendor (Inventory.ExternalIdentifier -> TransportedItems).
--
--   *** COVERAGE CAVEAT — BINDING ON EVERY CONSUMER ***
--   The manifest origin join matched approximately 2% of inventory rows in the
--   real May-2026 delivery. discovery_producer_stats is therefore a SAMPLE of
--   the market, NOT a census. The sample size for a given dataset is
--   discovery_datasets.vendor_attributed_retail_lines (added below).
--   NEVER sum discovery_producer_stats.revenue_minor with
--   discovery_supplier_stats.revenue_minor: they measure different events
--   (retail purchase vs wholesale transfer) at different coverage levels.
--
-- Why both: sell-in says a SKU shipped; sell-through says it SOLD. A purchase
-- order built on shipping volume alone buys whatever a vendor pushed hardest.
--
-- Money in MINOR UNITS (cents); all money columns BIGINT (the S8 lesson: a
-- real month's statewide totals overflow int4).
--
-- NULL vs 0 vs [] — deliberate, and consistent with migrations 0180/0181:
--   NULL          = never measured (row predates Slice 7, or the month's zip
--                   has not been re-uploaded). NOT a claim of zero.
--   0 / '[]'      = measured, and the answer was none.
--
-- Idempotent (safe to re-run). RLS: staff read/write, same as 0106/0109/0181.
-- APPLY MANUALLY (owner applies migrations by hand, per standing rules), then
-- RE-UPLOAD monthly zips: the transformer crunches raw rows in the browser and
-- only ships a rollup, so these columns CANNOT be backfilled from stored data.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Signal A: sell-in mix on the existing supplier table.
-- ---------------------------------------------------------------------------
alter table public.discovery_supplier_stats
  add column if not exists by_type jsonb;
alter table public.discovery_supplier_stats
  add column if not exists top_products jsonb;
alter table public.discovery_supplier_stats
  add column if not exists unattributed_lines bigint;

comment on column public.discovery_supplier_stats.by_type is
  'Slice 7: wholesale mix by inventory type — [{inventoryType, units, revenueMinor, lineCount, medianUnitPriceMinor}]. NULL = never measured (pre-Slice-7 row), NOT "shipped nothing".';
comment on column public.discovery_supplier_stats.top_products is
  'Slice 7: this supplier''s top products by wholesale revenue — [{productName, inventoryType, brand, units, revenueMinor, lineCount, medianUnitPriceMinor}]. NULL = never measured.';
comment on column public.discovery_supplier_stats.unattributed_lines is
  'Slice 7: wholesale lines from this supplier whose lot never resolved to a Product row, so they are absent from by_type/top_products. The honest denominator for the mix.';

-- ---------------------------------------------------------------------------
-- Signal B: sell-through per producer/processor.
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_producer_stats (
  id                 bigint generated always as identity primary key,
  dataset_id         uuid not null references public.discovery_datasets(id) on delete cascade,
  -- Manifest origin LICENSE NUMBER (manifests carry license numbers, not
  -- LicenseeIds). Stable across months, so this is the join key for trends.
  license_number     text not null,
  name               text,
  dba                text,
  units              numeric not null default 0,
  revenue_minor      bigint  not null default 0,
  line_count         bigint  not null default 0,
  -- RETAIL unit-price distribution: what CONSUMERS paid for this vendor's
  -- product (minor units; null = no samples). Distinct from the WHOLESALE
  -- price distribution on discovery_supplier_stats — the gap between the two
  -- is the retail markup, which is exactly what a PO decision turns on.
  price_sample_size  bigint not null default 0,
  price_min_minor    bigint,
  price_p25_minor    bigint,
  price_median_minor bigint,
  price_p75_minor    bigint,
  price_max_minor    bigint,
  price_avg_minor    bigint,
  -- Retail reach: how many stores were observed selling this vendor's product,
  -- and how many of those are tracked roster competitors.
  distinct_retailers integer not null default 0,
  tracked_retailers  integer not null default 0,
  -- Retail lines of this vendor's product sold from a DOH-compliant lot
  -- (Inventory.IsMedical = True, chapter 246-70 WAC). Only a definite True is
  -- counted; "unknown" is never counted as "not DOH".
  doh_line_count     bigint not null default 0,
  -- Same shapes as the columns added to discovery_supplier_stats above, but
  -- measured at RETAIL. '[]' = measured, nothing attributed.
  by_type            jsonb not null default '[]'::jsonb,
  top_products       jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  unique (dataset_id, license_number)
);

create index if not exists idx_disc_producer_stats_dataset
  on public.discovery_producer_stats (dataset_id);
create index if not exists idx_disc_producer_stats_license
  on public.discovery_producer_stats (license_number);

comment on table public.discovery_producer_stats is
  'Slice 7: producer/processors measured by RETAIL sell-through via the manifest origin join. A SAMPLE (~2% of inventory rows joined in the real May-2026 delivery), NOT a census — sample size is discovery_datasets.vendor_attributed_retail_lines. Never sum with discovery_supplier_stats.';

alter table public.discovery_producer_stats enable row level security;

drop policy if exists discovery_producer_stats_read on public.discovery_producer_stats;
create policy discovery_producer_stats_read on public.discovery_producer_stats
  for select using (public.is_staff());
drop policy if exists discovery_producer_stats_write on public.discovery_producer_stats;
create policy discovery_producer_stats_write on public.discovery_producer_stats
  for all using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- The sell-through sample size, so the caveat above is always quantifiable.
-- ---------------------------------------------------------------------------
alter table public.discovery_datasets
  add column if not exists vendor_attributed_retail_lines bigint;

comment on column public.discovery_datasets.vendor_attributed_retail_lines is
  'Slice 7: retail lines whose lot resolved to a manifest origin vendor. The SAMPLE SIZE behind discovery_producer_stats. NULL = never measured (dataset ingested before Slice 7).';

-- ===========================================================================
-- VERIFICATION (run after applying, then after re-uploading one monthly zip)
--
-- 1) Columns and table exist:
--      select column_name, data_type
--        from information_schema.columns
--       where table_name = 'discovery_producer_stats'
--       order by ordinal_position;
--
-- 2) The sell-through sample size vs the full retail line count. The ratio is
--    the coverage of discovery_producer_stats — expect it to be SMALL:
--      select label,
--             retail_lines,
--             vendor_attributed_retail_lines,
--             round(100.0 * vendor_attributed_retail_lines
--                   / nullif(retail_lines, 0), 2) as pct_covered
--        from public.discovery_datasets
--       where ingest_kind = 'monthly_zip'
--       order by period_end desc nulls last;
--
-- 3) Top producer/processors by what consumers actually bought:
--      select coalesce(dba, name, 'License ' || license_number) as vendor,
--             units, revenue_minor, line_count,
--             distinct_retailers, tracked_retailers, doh_line_count
--        from public.discovery_producer_stats
--       where dataset_id = '<dataset uuid>'
--       order by revenue_minor desc
--       limit 25;
--
-- 4) One vendor's category mix (the PO question, answered directly):
--      select p.dba,
--             t->>'inventoryType'            as category,
--             (t->>'revenueMinor')::bigint   as revenue_minor,
--             (t->>'medianUnitPriceMinor')::bigint as median_retail_price_minor
--        from public.discovery_producer_stats p
--        cross join lateral jsonb_array_elements(p.by_type) t
--       where p.dataset_id = '<dataset uuid>'
--         and p.license_number = '<license number>'
--       order by revenue_minor desc;
--
-- 5) Sell-in mix present on suppliers (NULL here means that month's zip has
--    not been re-uploaded since Slice 7 — expected until you re-upload):
--      select count(*) filter (where by_type is null)     as never_measured,
--             count(*) filter (where by_type is not null) as measured
--        from public.discovery_supplier_stats
--       where dataset_id = '<dataset uuid>';
-- ===========================================================================
