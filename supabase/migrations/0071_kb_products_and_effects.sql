-- =============================================================================
-- 0071 — KB per-SKU product knowledge (`kb_products`) + experiential `effects`
-- =============================================================================
-- Request D: the owner wants the Knowledge Base to be the "backbone / brain" —
-- storing validated PRODUCT knowledge per SKU, brand-specific, so that when an
-- existing vendor sends an existing product on a new invoice, the data fills in
-- EXACTLY from the KB (no re-enrichment). New-to-us products still go through
-- enrichment first, and only VALIDATED facts are promoted back into the KB.
--
-- Design decisions (verified against the request, do not guess):
--   • Per-SKU, brand-specific rows keyed on brand + normalized product name +
--     variant/size — NOT on lot/batch codes (lots churn; the product identity
--     does not). The natural key is (brand_slug, product_slug, variant_label).
--   • Drafts-only: rows land as status='draft' / active=false and must be
--     validated by a human before they are treated as authoritative.
--   • effects text[]: EXPERIENTIAL descriptors ONLY (sleepy, relaxed, uplifted,
--     calm, focused, euphoric, energetic, hungry). Medical claims (cure, treat,
--     heal, "cures insomnia", …) are forbidden and are filtered in app code
--     (src/lib/ai/compliance.ts) before anything is written here.
--   • Provenance (source, confidence, sources[]) so every promoted fact is
--     auditable back to where it came from.
--   • Loose FK links to the curated strain/brand/category rows AND to the
--     operational vendors/brands tables — all nullable.
--
-- This migration also adds an optional `effects text[]` column to `kb_strains`
-- and `kb_product_categories` so experiential effects can live at the strain
-- and category level too (all still non-medical, per WA I-502).
--
-- Idempotent: create table if not exists; add columns/indexes if not exists;
-- drop policy/trigger if exists before create. Applied MANUALLY by the owner in
-- the Supabase SQL editor. Safe to run more than once.
-- =============================================================================

-- ---------- kb_products ------------------------------------------------------
create table if not exists public.kb_products (
  id                  uuid primary key default gen_random_uuid(),
  -- Natural identity of a product we carry (brand + product + variant/size).
  -- Lowercase, trimmed slugs; variant_label distinguishes sizes/pack counts.
  brand_slug          text not null,                       -- 'avitas'
  product_slug        text not null,                       -- 'blue-dream'
  variant_label       text not null default '',            -- '1g', '3.5g', '10pk', '' = base
  display_name        text not null,                       -- 'Avitas — Blue Dream 1g Cartridge'
  -- Optional stable POS product key when we can associate one (menu_items.source_item_id).
  pos_product_key     text,
  -- Category / family.
  product_category_id uuid references public.kb_product_categories(id) on delete set null,
  category            text,                                -- denormalized display ('vape', 'flower')
  -- Sensory / botanical (SENSORY ONLY — no medical claims).
  aroma_notes         text[] not null default '{}',
  flavor_notes        text[] not null default '{}',
  terpenes            text[] not null default '{}',
  -- Experiential effects (EXPERIENTIAL ONLY — filtered for medical claims in app).
  effects             text[] not null default '{}',
  -- Marketing copy (validated, non-medical).
  description         text,
  short_description   text,
  summary             text,
  -- Curated image gallery: media_assets ids (first / primary_media_id = primary).
  image_media_ids     uuid[] not null default '{}',
  primary_media_id    uuid references public.media_assets(id) on delete set null,
  -- Loose links to curated KB rows + operational vendor/brand tables (all nullable).
  kb_strain_id        uuid references public.kb_strains(id) on delete set null,
  kb_brand_id         uuid references public.kb_brands(id) on delete set null,
  brand_id            uuid references public.brands(id) on delete set null,
  vendor_id           uuid references public.vendors(id) on delete set null,
  -- Provenance so every promoted fact is auditable.
  source              text default 'enrichment',           -- enrichment | suggestion | manual | seed | crawl:<url>
  confidence          numeric,                             -- 0..1 (nullable)
  sources             text[] not null default '{}',        -- corroborating references
  -- Drafts-only lifecycle. draft = staged/needs-review; published = authoritative.
  status              text not null default 'draft',       -- draft | published | archived
  active              boolean not null default false,       -- becomes true once validated/published
  created_by          uuid references public.staff_profiles(id) on delete set null,
  updated_by          uuid references public.staff_profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Natural key: one row per brand + product + variant.
create unique index if not exists uq_kb_products_identity
  on public.kb_products(brand_slug, product_slug, variant_label);

create index if not exists idx_kb_products_brand    on public.kb_products(brand_slug);
create index if not exists idx_kb_products_product  on public.kb_products(product_slug);
create index if not exists idx_kb_products_poskey   on public.kb_products(pos_product_key) where pos_product_key is not null;
create index if not exists idx_kb_products_status   on public.kb_products(status);
create index if not exists idx_kb_products_active   on public.kb_products(active) where active;
create index if not exists idx_kb_products_category on public.kb_products(product_category_id);
create index if not exists idx_kb_products_strain   on public.kb_products(kb_strain_id);
create index if not exists idx_kb_products_kbbrand  on public.kb_products(kb_brand_id);

-- ---------- effects columns on existing KB tables ---------------------------
-- Experiential effects at the strain + category level (non-medical). Nullable,
-- default empty array. Adding a column is idempotent via IF NOT EXISTS.
alter table public.kb_strains            add column if not exists effects text[] not null default '{}';
alter table public.kb_product_categories add column if not exists effects text[] not null default '{}';

-- ---------- updated_at trigger (reuse shared fn if present) -----------------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    if not exists (
      select 1 from pg_trigger where tgname = 'trg_kb_products_updated_at'
    ) then
      create trigger trg_kb_products_updated_at
        before update on public.kb_products
        for each row execute function public.set_updated_at();
    end if;
  end if;
end $$;

-- ---------- Row-Level Security ----------------------------------------------
-- Internal copy-grounding data. Staff read/write; no public read (the public
-- site only ever sees FINISHED, accepted enrichment copy).
alter table public.kb_products enable row level security;

drop policy if exists kb_products_staff_all on public.kb_products;
create policy kb_products_staff_all on public.kb_products
  for all using (public.is_staff()) with check (public.is_staff());
