-- =============================================================================
-- Migration 0024 — POS Slice 6: richer COA potency + lot product attributes
-- =============================================================================
-- The WCIA transfer JSON (Cultivera) carries far more than 0023 modeled: a full
-- potency array (thc/thca/cbd/cbda/total-cannabinoids), a direct COA PDF URL,
-- and COA release/expire dates — plus per-lot product attributes (weight,
-- category, strain, sample/medical flags). This migration adds those columns so
-- intake can persist everything and the UI can show real potency + the COA link.
--
-- Reuses public.set_updated_at(). Idempotent. Apply manually in Supabase SQL editor.
-- =============================================================================

-- ── lab_results: richer COA fields ──────────────────────────────────────────
alter table public.lab_results add column if not exists thca_pct                numeric;
alter table public.lab_results add column if not exists cbda_pct                numeric;
alter table public.lab_results add column if not exists total_cannabinoids_pct  numeric;
-- Normalized potency map { "thc": 0.9, "thca": 25.3, ... } for display/reporting.
alter table public.lab_results add column if not exists potency_json            jsonb;
-- Direct COA PDF URL (the thing the owner was clicking one-by-one in email).
alter table public.lab_results add column if not exists coa_url                 text;
alter table public.lab_results add column if not exists coa_release_date        date;
alter table public.lab_results add column if not exists coa_expire_date         date;

create index if not exists lab_results_coa_expire_idx on public.lab_results (coa_expire_date);

-- ── inventory_lots: product attributes from the transfer ─────────────────────
alter table public.inventory_lots add column if not exists strain_name      text;
alter table public.inventory_lots add column if not exists category         text;   -- EndProduct | IntermediateProduct
alter table public.inventory_lots add column if not exists inventory_type   text;   -- Usable Marijuana | Concentrate for Inhalation | ...
alter table public.inventory_lots add column if not exists unit_weight      numeric;
alter table public.inventory_lots add column if not exists unit_weight_uom  text;   -- g | mg | oz
alter table public.inventory_lots add column if not exists is_sample        boolean not null default false;
alter table public.inventory_lots add column if not exists is_medical       boolean not null default false;

create index if not exists inventory_lots_category_idx on public.inventory_lots (category);
create index if not exists inventory_lots_sample_idx   on public.inventory_lots (is_sample);
