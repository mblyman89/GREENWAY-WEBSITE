-- =============================================================================
-- 0076 — Non-cannabis product catalog + inventory (glass, accessories, paper).
-- =============================================================================
-- The owner asked to professionally track non-cannabis merchandise (bongs,
-- pipes, lighters, papers, downstems, trays, batteries, …) instead of ad-hoc
-- POS "hot buttons" (bong-$25, pipe-$10, lighter-$2). These items are NOT
-- reported to CCRS (they are not cannabis) but they ARE real sellable inventory
-- and should live in the Knowledge Base alongside everything else so the KB
-- stays connected.
--
-- Naming convention (owner-defined; see docs/PRODUCT_NAMING_CONVENTION.md):
--   {Brand (if any)} {Type} {Size/Joint size} {Gender} {Color}
-- SKU is generated smartly per type (PIPE-0001, BONG-0002-12IN-BLUE-M, …) and
-- is printable on the equipment-page label printer as a Code128 barcode.
--
-- STANDING RULES honored:
--   * money in MINOR UNITS (cents) — price_minor_units / cost_minor_units.
--   * idempotent — create-if-not-exists; safe to run repeatedly.
--   * applied MANUALLY by the owner in the Supabase SQL editor.
--   * AI output = drafts — the intake flow stages a draft the staff confirm.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- noncannabis_products: one sellable non-cannabis SKU.
-- ---------------------------------------------------------------------------
create table if not exists public.noncannabis_products (
  id                 uuid primary key default gen_random_uuid(),
  -- Smart, human-readable SKU (unique). Printed as a Code128 label.
  sku                text not null unique,
  -- Full display name built from the convention.
  name               text not null,
  brand              text,
  -- Controlled type vocabulary value (pipe|bong|lighter|downstem|…). Free text
  -- allowed for forward-compat, but the UI supplies the controlled list.
  type               text not null,
  -- Size / joint size token, normalized (e.g. '12in', '14mm', '18mm').
  size               text,
  -- Glass joint gender when applicable.
  gender             text check (gender in ('male', 'female') or gender is null),
  color              text,
  -- Inventory + money (minor units / cents).
  price_minor_units  integer not null default 0,
  cost_minor_units   integer not null default 0,
  qty_on_hand        integer not null default 0,
  -- Lifecycle. 'draft' = staged from intake, not yet confirmed/sellable.
  status             text not null default 'draft'
                       check (status in ('draft', 'active', 'archived')),
  notes              text,
  created_by         uuid references public.staff_profiles(id) on delete set null,
  updated_by         uuid references public.staff_profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_noncannabis_products_type   on public.noncannabis_products(type);
create index if not exists idx_noncannabis_products_status on public.noncannabis_products(status);
create index if not exists idx_noncannabis_products_brand  on public.noncannabis_products(brand);

-- ---------------------------------------------------------------------------
-- noncannabis_sku_sequences: per-type running counter so SKUs increment
-- predictably (PIPE-0001, PIPE-0002, …). The application still verifies the
-- generated SKU is free before inserting (collision-safe), but this gives a
-- stable starting point per type.
-- ---------------------------------------------------------------------------
create table if not exists public.noncannabis_sku_sequences (
  type        text primary key,
  last_seq    integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- keep updated_at fresh on write (reuse the shared trigger fn if present)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    if not exists (select 1 from pg_trigger where tgname = 'trg_noncannabis_products_updated_at') then
      create trigger trg_noncannabis_products_updated_at
        before update on public.noncannabis_products
        for each row execute function public.set_updated_at();
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'trg_noncannabis_sku_sequences_updated_at') then
      create trigger trg_noncannabis_sku_sequences_updated_at
        before update on public.noncannabis_sku_sequences
        for each row execute function public.set_updated_at();
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- KB linkage: expose non-cannabis products to the Knowledge Base so everything
-- stays connected. We add a nullable pointer on the KB product-category table so
-- a non-cannabis product can be tagged to a KB "accessories" family, and a view
-- the KB can read. (No destructive changes; additive only.)
-- ---------------------------------------------------------------------------
alter table if exists public.noncannabis_products
  add column if not exists kb_category_slug text;

create index if not exists idx_noncannabis_products_kb
  on public.noncannabis_products(kb_category_slug);

-- A read view the KB uses to list active non-cannabis products connected to it.
create or replace view public.kb_noncannabis_catalog as
  select
    p.id,
    p.sku,
    p.name,
    p.brand,
    p.type,
    p.size,
    p.gender,
    p.color,
    p.price_minor_units,
    p.qty_on_hand,
    p.status,
    p.kb_category_slug,
    p.updated_at
  from public.noncannabis_products p
  where p.status = 'active';
