-- =============================================================================
-- PR-P4 — Global "never discount" list (products always excluded from EVERY deal)
-- =============================================================================
-- Table: promotion_never_discount
--
-- A master exclusion list of individual products that must NEVER receive ANY
-- promotion — not a storewide sale, not a daily deal, not a brand sale, not a
-- smart-selector target, nothing. Think: a loss-leader you refuse to cut
-- further, a vendor-price-protected SKU, a compliance-sensitive item, or a
-- product you always sell at full margin.
--
-- Michael approved this ("include a global never-discount list"). It is the
-- owner-level safety net that sits ABOVE every promotion: the discount engine
-- treats these product keys as an exclusion on EVERY rule, and "exclusions win"
-- (src/lib/promotions/discount-engine-core.ts :: ruleMatchesLine). So a product
-- on this list keeps its regular price at the register and on the storefront,
-- no matter what promotion is running.
--
-- Design notes:
--  * pos_product_key is the SAME identifier the engine matches on
--    (EngineCartLine.productKey / EngineRule.excludeProductKeys), so enforcement
--    is a direct key match — no fuzzy name logic.
--  * product_name is a DISPLAY snapshot for the admin list only (so the list
--    reads nicely even if the menu changes); matching is always by key.
--  * reason is an optional note ("vendor price protection", "loss leader", …).
--  * pos_product_key is UNIQUE so the list is a set and adds are idempotent.
--
-- Reuses: public.set_updated_at(), public.is_staff(), public.staff_profiles.
-- Idempotent: create if not exists + drop policy/trigger/index if exists.
-- Code ships WORKING PRE-MIGRATION: the store helper (promotions-store.ts)
-- treats a missing table as "empty never-discount list", so the engine behaves
-- exactly as before this feature until the table exists. Nothing breaks if this
-- migration has not been run yet.
-- =============================================================================

create table if not exists public.promotion_never_discount (
  id              uuid primary key default gen_random_uuid(),

  -- The POS product key the engine matches on. This is the enforcement key.
  pos_product_key text not null,

  -- Display snapshot of the product name at the time it was added (admin list
  -- readability only; enforcement is always by pos_product_key).
  product_name    text,

  -- Optional reason this product is protected from all discounts.
  reason          text,

  -- Provenance.
  created_by      uuid references public.staff_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One row per product key (the list is a set; adding an existing key is a
-- no-op / upsert from the app's point of view).
create unique index if not exists idx_promotion_never_discount_key
  on public.promotion_never_discount (pos_product_key);

-- updated_at trigger
drop trigger if exists trg_promotion_never_discount_updated on public.promotion_never_discount;
create trigger trg_promotion_never_discount_updated before update on public.promotion_never_discount
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.promotion_never_discount enable row level security;

-- Staff only: full read/write. This is a back-office pricing-policy tool; the
-- public never reads this table directly (its effect is baked into the prices
-- the engine returns).
drop policy if exists promotion_never_discount_staff_all on public.promotion_never_discount;
create policy promotion_never_discount_staff_all on public.promotion_never_discount
  for all using (public.is_staff()) with check (public.is_staff());
