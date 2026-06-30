-- =============================================================================
-- Migration 0023 — POS Slice 3: Inventory lots + COA/lab results + manifests
-- =============================================================================
-- The COMPLIANCE BACKBONE. Models the traceability lineage every WA retailer
-- needs but most lack: vendor → inbound manifest → lot → COA (lab results),
-- plus auditable inventory adjustments. Designed so a future WA CCRS export
-- (Manifest.CSV with the COA LabtestexternalIdentifier) is a REPORT over these
-- tables — never a re-entry.
--
-- Source of incoming data: vendors send product + COA/QA as JSON; Slice 4 will
-- parse that JSON into DRAFT lots + lab_results for employee validation. This
-- slice provides the destination schema + admin views.
--
-- Reuses: public.set_updated_at(), public.is_staff(), public.staff_profiles,
-- public.vendors, public.brands.
--
-- Idempotent. Apply manually in the Supabase SQL editor. Staff-only RLS.
-- =============================================================================

-- ── inbound_manifests ───────────────────────────────────────────────────────
-- A transfer/manifest of product arriving from a vendor (mirrors CCRS Manifest).
create table if not exists public.inbound_manifests (
  id                  uuid primary key default gen_random_uuid(),
  -- Manifest / transfer identifier as issued by the originating system.
  manifest_number     text,
  vendor_id           uuid references public.vendors(id) on delete set null,
  -- Free-text vendor label as received (when not yet matched to a vendor row).
  vendor_label        text,
  transfer_date       date,
  -- Raw payload captured at intake (the vendor JSON) for full provenance.
  raw_payload         jsonb,
  -- intake state: pending review → accepted; or rejected.
  status              text not null default 'pending',  -- pending | accepted | rejected
  notes               text,
  created_by          uuid references public.staff_profiles(id) on delete set null,
  updated_by          uuid references public.staff_profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists inbound_manifests_vendor_idx on public.inbound_manifests (vendor_id);
create index if not exists inbound_manifests_number_idx on public.inbound_manifests (manifest_number);

drop trigger if exists inbound_manifests_set_updated_at on public.inbound_manifests;
create trigger inbound_manifests_set_updated_at
  before update on public.inbound_manifests
  for each row execute function public.set_updated_at();

-- ── lab_results (COA) ───────────────────────────────────────────────────────
-- Certificate of Analysis data for a product/lot. The labtest_external_identifier
-- is the exact value WA CCRS Manifest.CSV requires (carried from the COA).
create table if not exists public.lab_results (
  id                            uuid primary key default gen_random_uuid(),
  -- The CCRS Manifest.CSV "LabtestexternalIdentifier" — keep verbatim from COA.
  labtest_external_identifier   text,
  lab_name                      text,
  tested_on                     date,
  -- Potency (percent where applicable). Numeric so we can compute/report.
  thc_pct                       numeric,
  cbd_pct                       numeric,
  total_thc_pct                 numeric,
  total_cbd_pct                 numeric,
  -- Terpene + full analyte detail as provided (flexible).
  terpenes_json                 jsonb,
  analytes_json                 jsonb,
  passed                        boolean,
  -- Provenance: where this COA came from (vendor JSON, manual entry, etc.).
  source                        text not null default 'vendor-json',
  raw_payload                   jsonb,
  created_by                    uuid references public.staff_profiles(id) on delete set null,
  updated_by                    uuid references public.staff_profiles(id) on delete set null,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index if not exists lab_results_extid_idx on public.lab_results (labtest_external_identifier);

drop trigger if exists lab_results_set_updated_at on public.lab_results;
create trigger lab_results_set_updated_at
  before update on public.lab_results
  for each row execute function public.set_updated_at();

-- ── inventory_lots ──────────────────────────────────────────────────────────
-- A received lot/batch of a product. Ties product ↔ vendor ↔ brand ↔ COA ↔
-- manifest, with expiry + status for FEFO + recall handling.
create table if not exists public.inventory_lots (
  id                  uuid primary key default gen_random_uuid(),
  -- Human/regulatory lot code (from vendor/COA). Unique-ish but not enforced
  -- unique since vendors can collide; we dedupe in app logic on (vendor, code).
  lot_code            text,
  vendor_id           uuid references public.vendors(id) on delete set null,
  brand_id            uuid references public.brands(id) on delete set null,
  manifest_id         uuid references public.inbound_manifests(id) on delete set null,
  lab_result_id       uuid references public.lab_results(id) on delete set null,
  -- Link to the catalog product by the POS source key (matches menu_items.source_item_id).
  -- Text (not FK) so deleted/re-imported menu rows don't orphan lot history.
  pos_product_key     text,
  product_name        text,
  -- Quantities. received_qty is what came in; on_hand_qty is current (maintained
  -- by adjustments + the sell flow in a later slice).
  received_qty        numeric not null default 0,
  on_hand_qty         numeric not null default 0,
  unit                text not null default 'each',     -- each | g | mg | oz
  -- Cost per unit in MINOR UNITS (cents) — the seed of margin/KPI math.
  unit_cost_minor_units integer,
  expires_on          date,
  -- lifecycle: active | quarantine | recalled | sold_out | destroyed
  status              text not null default 'active',
  notes               text,
  created_by          uuid references public.staff_profiles(id) on delete set null,
  updated_by          uuid references public.staff_profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists inventory_lots_vendor_idx   on public.inventory_lots (vendor_id);
create index if not exists inventory_lots_brand_idx    on public.inventory_lots (brand_id);
create index if not exists inventory_lots_manifest_idx on public.inventory_lots (manifest_id);
create index if not exists inventory_lots_poskey_idx   on public.inventory_lots (pos_product_key);
create index if not exists inventory_lots_status_idx   on public.inventory_lots (status);
create index if not exists inventory_lots_expires_idx  on public.inventory_lots (expires_on);

drop trigger if exists inventory_lots_set_updated_at on public.inventory_lots;
create trigger inventory_lots_set_updated_at
  before update on public.inventory_lots
  for each row execute function public.set_updated_at();

-- ── inventory_adjustments ───────────────────────────────────────────────────
-- Every change to on-hand that isn't a sale: receiving, shrink, damage, sample,
-- compliance destruction, cycle-count correction. Auditable + CCRS-reportable.
create table if not exists public.inventory_adjustments (
  id                  uuid primary key default gen_random_uuid(),
  lot_id              uuid not null references public.inventory_lots(id) on delete cascade,
  -- Signed quantity delta (positive = added, negative = removed).
  qty_delta           numeric not null,
  -- reason: receive | shrink | damage | sample | destruction | count | recall | other
  reason              text not null,
  note                text,
  actor_id            uuid references public.staff_profiles(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists inventory_adjustments_lot_idx    on public.inventory_adjustments (lot_id);
create index if not exists inventory_adjustments_reason_idx on public.inventory_adjustments (reason);
create index if not exists inventory_adjustments_created_idx on public.inventory_adjustments (created_at);

-- =============================================================================
-- Row-Level Security — STAFF ONLY (internal inventory/compliance data).
-- =============================================================================
alter table public.inbound_manifests      enable row level security;
alter table public.lab_results            enable row level security;
alter table public.inventory_lots         enable row level security;
alter table public.inventory_adjustments  enable row level security;

drop policy if exists inbound_manifests_staff_all on public.inbound_manifests;
create policy inbound_manifests_staff_all on public.inbound_manifests
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists lab_results_staff_all on public.lab_results;
create policy lab_results_staff_all on public.lab_results
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists inventory_lots_staff_all on public.inventory_lots;
create policy inventory_lots_staff_all on public.inventory_lots
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists inventory_adjustments_staff_all on public.inventory_adjustments;
create policy inventory_adjustments_staff_all on public.inventory_adjustments
  for all using (public.is_staff()) with check (public.is_staff());
