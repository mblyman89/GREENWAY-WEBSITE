-- ===========================================================================
-- 0181_discovery_doh.sql
-- Product Discovery: capture DOH-COMPLIANT PRODUCT activity (who sells it,
-- how much, and at what price) so the medical-endorsement question can be
-- answered with evidence instead of opinion.
--
-- OWNER REQUEST (verbatim, standing rule 1):
--   "I do want to, if possible, see which doh products are being sold and by
--    who, I want to know if it's worth having a medical endorsement by looking
--    at my competitors and seeing the doh volume and prices and such. If that's
--    not in the scope of the data, please update the process to include that
--    data."
--
-- IT IS IN SCOPE. Verified against the owner's real December 2025 delivery
-- (656.1 MB, 17 tables): the Inventory table carries IsMedical at column [9]
-- with the literal values "True" / "False". The transformer previously read
-- Inventory but DISCARDED that column; it is now captured.
--
-- THE TWO MEDICAL SIGNALS ARE NOT THE SAME THING
-- ----------------------------------------------
--   * SaleHeader.SaleType = 'RecreationalMedical'  -> a SALES fact:
--       the sale was made to a registered patient. Stored as medical_lines
--       and the medical_* benchmark metrics (migration 0180).
--   * Inventory.IsMedical = True                   -> a PRODUCT fact:
--       the lot is DOH-compliant under chapter 246-70 WAC. Stored here.
--
-- They OVERLAP FREELY and neither is a subset of the other: a DOH-compliant
-- product sold to a recreational customer is not a medical sale, and an
-- ordinary product sold to a patient is one. Never subtract one from the
-- other. Both are subsets of retail_lines.
--
-- WHY THIS ANSWERS THE ENDORSEMENT QUESTION
-- -----------------------------------------
-- Under WAC 246-70-040, DOH compliance comes in three classes, and the
-- privileges differ:
--   * General Use  (<=10 mg THC/serving)  - sellable at ANY licensed store.
--   * High CBD                            - sellable at ANY licensed store.
--   * High THC     (>10, <=50 mg/serving; capsules, tablets, tinctures,
--                   transdermal patches, suppositories only)
--                                         - sellable ONLY at retail outlets
--                                           WITH a medical endorsement, and
--                                           only to registered patients.
-- So the endorsement's exclusive economic value is concentrated in High THC
-- product plus the tax-exempt patient trade. Seeing statewide DOH volume,
-- DOH price distributions, and WHICH competitors are capturing that volume
-- is what turns "should I get endorsed?" into an arithmetic question.
--
-- WHAT THIS MIGRATION ADDS
-- ------------------------
--   1. discovery_datasets.doh_lines           - retail lines that sold a DOH lot
--   2. discovery_datasets.doh_unknown_lines   - retail lines with NO readable
--                                               DOH answer (honest denominator)
--   3. discovery_datasets.doh_inventory_rows  - lots flagged IsMedical = True
--   4. public.discovery_doh_sellers           - one row per licensee that sold
--                                               DOH product ("and by who")
--
-- NO CHANGE IS NEEDED FOR THE DOH BENCHMARKS THEMSELVES
-- -----------------------------------------------------
-- The DOH price/units/revenue benchmarks land in public.discovery_benchmarks
-- as four new metric strings (doh_unit_price, doh_price_per_gram, doh_units,
-- doh_revenue). Verified in 0079/0106: `metric` is a free-form `text` column
-- with NO check constraint and NO enum, and the unique key is
-- (dataset_id, scope, scope_key, metric) - so the new metrics get their own
-- rows and cannot collide with retail/wholesale/medical. Nothing to alter.
--
-- Likewise discovery_market_signals.kind is free-form `text`, so the new
-- 'doh_mover' signal kind needs no change either.
--
-- WHY THE NEW COUNTERS ARE NULLABLE
-- ---------------------------------
-- Every dataset ingested BEFORE DOH capture has no honest DOH figure. NULL
-- means "this delivery was never measured for DOH", which is the truth. It
-- does NOT mean zero. Defaulting to 0 would state, as fact, that those months
-- had no DOH product sold - a guess, and a wrong one. (Standing rule 2.)
--
-- Money in MINOR UNITS (cents); all money columns BIGINT (the S8 lesson: a
-- real month's statewide totals overflow int4).
--
-- Idempotent (safe to re-run). RLS: staff read/write, same as 0106/0109.
-- APPLY MANUALLY (owner applies migrations by hand, per standing rule 6),
-- then RE-UPLOAD monthly zips to backfill DOH figures - the transformer
-- computes rollups in the browser and never persists raw rows, so historical
-- months CANNOT be backfilled without re-uploading them.
--
-- Depends on: 0106 (discovery_datasets line-total columns), 0180.
-- Next migration after this is 0182.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1-3. Dataset-level DOH counters
-- ---------------------------------------------------------------------------
alter table public.discovery_datasets
  add column if not exists doh_lines           bigint,
  add column if not exists doh_unknown_lines   bigint,
  add column if not exists doh_inventory_rows  bigint;

comment on column public.discovery_datasets.doh_lines is
  'Retail sale lines whose Inventory lot carried IsMedical = True (DOH-compliant product, chapter 246-70 WAC). A SUBSET of retail_lines. INDEPENDENT of medical_lines: a DOH product can be sold recreationally and an ordinary product can be sold to a patient - never subtract one from the other. NULL = this dataset predates DOH capture and was never measured (NOT zero).';

comment on column public.discovery_datasets.doh_unknown_lines is
  'Retail sale lines whose lot carried NO readable DOH answer (the lot did not resolve, or IsMedical was blank). Recorded so the DOH share has an honest denominator instead of silently treating "unknown" as "not DOH". NULL = never measured.';

comment on column public.discovery_datasets.doh_inventory_rows is
  'Inventory rows read with IsMedical = True. A LOT-level count (how much DOH product exists), distinct from doh_lines (how much of it sold). NULL = never measured.';

-- ---------------------------------------------------------------------------
-- 4. discovery_doh_sellers - WHO sold DOH-compliant product, and at what price
-- ---------------------------------------------------------------------------
-- One row per (dataset, selling licensee). Derived from RETAIL SalesDetail
-- lines whose Inventory lot was IsMedical = True, attributed to the seller on
-- the SaleHeader. Retail only: the question is about counter sales, not
-- inter-licensee transfers. Identity comes from the monthly licensee table
-- (shipped whole every month); unresolvable identity fields stay NULL and are
-- never guessed.
create table if not exists public.discovery_doh_sellers (
  id                 bigint generated always as identity primary key,
  dataset_id         uuid not null references public.discovery_datasets(id) on delete cascade,
  licensee_id        text not null,          -- CCRS surrogate LicenseeId (per-extract)
  license_number     text,                   -- stable public id (join across months)
  name               text,
  dba                text,
  -- tracked: on the owner's competitor roster. is_self: the owner's own store.
  -- The roster deliberately EXCLUDES self, so these are mutually exclusive and
  -- BOTH are needed to render an honest "us vs them" comparison.
  tracked            boolean not null default false,
  is_self            boolean not null default false,
  units              numeric not null default 0,
  revenue_minor      bigint  not null default 0,
  line_count         bigint  not null default 0,
  -- per-line DOH unit-price distribution (minor units; null = no samples)
  price_sample_size  bigint  not null default 0,
  price_min_minor    bigint,
  price_p25_minor    bigint,
  price_median_minor bigint,
  price_p75_minor    bigint,
  price_max_minor    bigint,
  price_avg_minor    bigint,
  created_at         timestamptz not null default now(),
  unique (dataset_id, licensee_id)
);
create index if not exists idx_disc_doh_sellers_dataset on public.discovery_doh_sellers (dataset_id);
create index if not exists idx_disc_doh_sellers_license on public.discovery_doh_sellers (license_number);

alter table public.discovery_doh_sellers enable row level security;

drop policy if exists disc_doh_sellers_staff_all on public.discovery_doh_sellers;
create policy disc_doh_sellers_staff_all on public.discovery_doh_sellers
  for all using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Verification (run manually after applying, then after a re-upload):
--
--   -- 1. Columns exist and old months stayed NULL (never measured, not zero):
--   select label, retail_lines, medical_lines, doh_lines, doh_unknown_lines
--     from public.discovery_datasets
--    where ingest_kind = 'monthly_zip'
--    order by period_end desc;
--
--   -- 2. DOH lines must never exceed retail lines:
--   select count(*) as impossible_rows
--     from public.discovery_datasets
--    where doh_lines is not null
--      and retail_lines is not null
--      and doh_lines > retail_lines;   -- expect 0
--
--   -- 3. Who is selling DOH product, biggest first:
--   select s.license_number, coalesce(s.dba, s.name) as store,
--          s.is_self, s.tracked, s.line_count, s.units,
--          s.revenue_minor / 100.0 as revenue_dollars,
--          s.price_median_minor / 100.0 as median_price_dollars
--     from public.discovery_doh_sellers s
--     join public.discovery_datasets d on d.id = s.dataset_id
--    where d.ingest_kind = 'monthly_zip'
--    order by d.period_end desc, s.revenue_minor desc
--    limit 50;
--
--   -- 4. The four new benchmark metrics landed:
--   select metric, count(*)
--     from public.discovery_benchmarks
--    where metric like 'doh\_%'
--    group by metric order by metric;
-- ---------------------------------------------------------------------------
