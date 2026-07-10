-- =============================================================================
-- 0105 — Record WHICH sample product/lot is assigned to an employee
-- =============================================================================
-- Owner's request (verbatim): "I see i can pick an employee for sample
-- distribution, but I don't see a way to assign an actual sample product to an
-- employee. ... please re read the CCRS around samples for retailers
-- specifically and then add the function to assign samples to employees."
--
-- COMPLIANCE FINDING (WAC 314-55-096, as amended by WSR 25-08-032, eff.
-- 4/26/25): a retailer that transfers a trade sample to a current paid employee
-- must RECORD, in the traceability system (CCRS), the amount of each sample and
-- the employee receiving it — and each sample carries a product identity (a
-- product name/strain and a traceability lot/unique-identifier reference). The
-- existing ledger (`trade_sample_events`) captured the employee, the amount, the
-- product TYPE (useable/concentrate/infused), sizes, and — from migration 0095 —
-- an optional `import_id` linking to the uploaded sample JSON batch, plus an
-- (unused-for-samples) `lot_id`. It did NOT capture the actual sample PRODUCT
-- IDENTITY assigned to the employee. This migration adds the two identity
-- columns the CCRS record requires.
--
-- WHY NEW COLUMNS (verified, not guessed):
--   • Imported sample lots live inside `sample_json_imports.raw` (jsonb). They
--     are NOT `inventory_lots` rows, so the existing `lot_id` FK cannot point at
--     an imported sample lot. `import_id` links to the BATCH, not the individual
--     lot within it. Neither carries the human-readable product name/strain or
--     the per-lot traceability reference for a single assigned sample.
--   • So we add two plain text columns that snapshot the product identity onto
--     the event itself (denormalised on purpose — the assignment record must
--     survive even if the import row is later edited/removed):
--       - source_product_name : the sample product name / strain.
--       - source_lot_ref      : the traceability lot / unique-identifier ref.
--     `import_id` (0095) is REUSED to link the event back to the batch it came
--     from; `lot_id` (0054) is left untouched.
--
-- SCOPE: additive only. Nullable columns (incoming events and pre-existing rows
-- have no source product); the application requires them for OUTGOING trade
-- samples going forward. Nothing is dropped or rewritten.
--
-- Money: n/a.  Idempotent. Apply MANUALLY in the Supabase SQL editor AFTER 0104.
-- =============================================================================

-- ── 1. Add the product-identity columns ─────────────────────────────────────
alter table public.trade_sample_events
  add column if not exists source_product_name text,
  add column if not exists source_lot_ref      text;

-- ── 2. Comments (self-documenting for the next reader) ───────────────────────
comment on column public.trade_sample_events.source_product_name is
  'CCRS: product name / strain of the sample assigned to the employee (WAC 314-55-096). Snapshot on the event; required for OUTGOING trade samples. NULL for incoming rows and legacy rows recorded before migration 0105.';

comment on column public.trade_sample_events.source_lot_ref is
  'CCRS: traceability lot / unique-identifier reference of the assigned sample (WAC 314-55-096). Snapshot on the event; sourced from the sample JSON import when available, else entered manually. NULL for incoming rows and legacy rows.';

-- ── 3. Helper index (find every event for an assigned lot ref) ───────────────
create index if not exists trade_sample_events_source_lot_idx
  on public.trade_sample_events (source_lot_ref);
