-- =============================================================================
-- 0111 — Non-cannabis inventory operations: barcodes, reorder points, and an
--        append-only adjustment ledger.
-- =============================================================================
-- Task M (owner request): transform the non-cannabis inventory page into the
-- professional standard for managing mixed barcoded / non-barcoded merchandise
-- (glass, lighters, papers, grinders, …). Three additions:
--
--   1. DUAL-IDENTIFIER STRATEGY — some items (lighters, papers) arrive with a
--      manufacturer UPC/EAN barcode; glass usually does not. We store the
--      manufacturer barcode when present (scan it straight at the register)
--      and print an in-house Code128 SKU label ONLY when the item has none.
--      The application validates UPC-A / EAN-13 / EAN-8 check digits before
--      saving so mistyped barcodes never enter the catalog.
--
--   2. REORDER POINTS — per-product minimum (reorder_point) and a suggested
--      order quantity (reorder_qty) so the page can surface a "reorder now"
--      list instead of staff discovering empty pegs.
--
--   3. ADJUSTMENT LEDGER — every quantity change after intake is recorded as
--      an append-only noncannabis_adjustments row (who / when / why / how
--      many), and qty_on_hand is updated in the same operation. This is the
--      plain-retail equivalent of the cannabis adjustment trail — WITHOUT the
--      CCRS hoops (non-cannabis is NOT reported to CCRS).
--
-- STANDING RULES honored:
--   * money stays in MINOR UNITS (cents) — no money columns added here.
--   * idempotent — create/alter-if-not-exists; safe to run repeatedly.
--   * applied MANUALLY by the owner in the Supabase SQL editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Product columns: manufacturer barcode, reorder point/qty, shelf location.
-- ---------------------------------------------------------------------------
alter table if exists public.noncannabis_products
  add column if not exists barcode text,
  add column if not exists reorder_point integer not null default 0,
  add column if not exists reorder_qty integer not null default 0,
  add column if not exists location text;

-- One product per manufacturer barcode (nullable => only enforced when set).
create unique index if not exists idx_noncannabis_products_barcode
  on public.noncannabis_products(barcode)
  where barcode is not null;

-- ---------------------------------------------------------------------------
-- noncannabis_adjustments: append-only quantity-change ledger.
--   qty_delta is SIGNED (+ receive / - remove). reason is free text but the
--   application supplies a controlled vocabulary (received, sold_correction,
--   damaged, theft, count, promo, return, other).
-- ---------------------------------------------------------------------------
create table if not exists public.noncannabis_adjustments (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.noncannabis_products(id) on delete cascade,
  qty_delta   integer not null,
  reason      text not null,
  note        text,
  actor_id    uuid references public.staff_profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_noncannabis_adjustments_product
  on public.noncannabis_adjustments(product_id, created_at desc);
create index if not exists idx_noncannabis_adjustments_created
  on public.noncannabis_adjustments(created_at desc);
