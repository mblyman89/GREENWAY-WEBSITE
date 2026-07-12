-- 0116_loyalty_at_sale.sql  (Task S-a)
--
-- Loyalty AT THE POINT OF SALE. Until now loyalty codes were issued in the
-- back office but nothing consumed them on an order, and tier standing
-- discounts were never applied to a sale. This migration adds the order-side
-- columns that record a loyalty application.
--
-- Policy (docs/LOYALTY_COMPLIANCE.md):
--   * ONE loyalty application per order: either the member's TIER pricing or
--     a redemption CODE — never both (owner: "no discount stacking; better
--     discount wins for the customer"). The register UI computes both and
--     recommends the better one.
--   * Loyalty value is embedded in the line unit prices (tax-inclusive), so
--     the existing money completion gate keeps verifying totals unchanged.
--   * Every unit price stays clamped to the statutory 1-cent cannabis floor
--     (RCW 69.50.357) AND the acquisition-cost floor (WAC 314-55-155(5)(g);
--     CCRS Upload User Guide).
--
-- APPLY MANUALLY in the Supabase SQL editor (standing rule).

-- ── orders: the loyalty application on this order ───────────────────────────
alter table public.orders
  add column if not exists loyalty_kind text
    check (loyalty_kind in ('code', 'tier'));

alter table public.orders
  add column if not exists loyalty_redemption_id uuid
    references public.loyalty_redemptions(id) on delete set null;

-- Snapshot of the code text (display/audit; survives redemption row deletion).
alter table public.orders
  add column if not exists loyalty_code text;

-- Total tax-inclusive value taken off this order by the loyalty application.
alter table public.orders
  add column if not exists loyalty_discount_minor_units integer not null default 0;

-- Snapshot of the tier name when loyalty_kind = 'tier' (display/audit).
alter table public.orders
  add column if not exists loyalty_tier_label text;

create index if not exists orders_loyalty_redemption_idx
  on public.orders (loyalty_redemption_id);

-- ── order_lines: per-UNIT loyalty reduction snapshot ────────────────────────
-- Removing a loyalty application restores each unit price by exactly this
-- amount — no recompute against a menu that may have changed since placement.
alter table public.order_lines
  add column if not exists loyalty_discount_minor_units integer not null default 0;
