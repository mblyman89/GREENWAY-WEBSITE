-- =============================================================================
-- 0087_kb_product_formats.sql
-- Knowledge-Base PRODUCT-FORMAT / CONSUMPTION-METHOD vocabulary
-- (KB hardening v2, Slice 2).
--
-- WHY: The KB already knows broad CATEGORY vocabulary (kb_category_terms:
-- "words you may use for a vape") and a deep product-type tree
-- (kb_product_categories). Neither carries the WA-market FACTS a budtender-grade
-- brain needs about the physical FORM a product takes: what it is, how it's
-- consumed, and its typical measured potency band. This table is that missing
-- layer -- a controlled vocabulary of concrete product forms (loose flower,
-- pre-roll, vape cartridge, shatter/wax, gummies, tincture, topical, ...), each
-- with a factual definition, a factual consumption description, a WA-VERIFIED
-- potency note, and a house-voiced budtender blurb. Effects (0086) = HOW IT
-- FEELS; formats (this table) = WHAT IT IS and HOW YOU USE IT.
--
-- Every fact is sourced from Washington authorities -- see
-- docs/KB_PRODUCT_FORMATS_SEED_SOURCES.md (WSLCB "Types of Products",
-- WAC 314-55-095 edible cap, RCW possession limits).
--
-- COMPLIANCE (WA I-502): records are FACTUAL/DESCRIPTIVE only -- form, use, and
-- measured potency band. NO medical/therapeutic claim, NO dosing directive
-- ("take X"). Factual onset statements ("comes on more slowly than inhalation")
-- describe how ingestion differs, not a health benefit. All prose is routed
-- through the existing checkCompliance gate before it can surface in retrieval.
--
-- STANDING RULES:
--   * Idempotent (create ... if not exists / add column if not exists /
--     drop policy if exists / backfill only-when-null). Safe to re-run.
--   * Applied MANUALLY by the owner.
--   * KB is internal copy-grounding data: staff read/write, no public read
--     (same RLS shape as every other kb_* table -> public.is_staff()).
--   * Drafts/provenance parity mirrors kb_effects (0086) / kb_brands (0082):
--     curated rows default status='published' + source='manual'; machine
--     writers must set status='draft' explicitly.
-- =============================================================================

-- ---------- kb_product_formats ----------------------------------------------
create table if not exists public.kb_product_formats (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,                  -- 'flower' | 'vape-cartridge' | 'edible' | ...
  name            text not null,                         -- display label 'Loose Flower'
  -- Loose delivery family for grouping in the UI (NOT a medical category):
  --   'inhaled' | 'ingested' | 'topical'
  category        text,
  -- Factual, non-medical definition of the physical form.
  definition      text,
  -- Factual description of HOW the form is used (smoked / eaten / applied /
  -- sublingual). Not a dosing directive.
  consumption     text,
  -- WA-verified typical potency band (e.g. 'concentrates commonly 60-90% THC').
  -- A market fact, never a dosing instruction.
  potency_note    text,
  -- House-voiced budtender blurb (fun-but-professional, still non-medical).
  house_note      text,
  -- Neutral synonyms / adjacent slang that map to this format (for matching).
  aliases         text[] not null default '{}',
  sources         text[] not null default '{}',          -- citations backing the facts
  confidence      numeric,                                -- 0..1 curator confidence
  -- Drafts/provenance parity (mirrors kb_effects 0086):
  source          text,                                   -- 'manual' (curated) | 'enrichment' | ...
  status          text not null default 'published',      -- draft | published | archived
  active          boolean not null default true,
  created_by      uuid references public.staff_profiles(id) on delete set null,
  updated_by      uuid references public.staff_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Guard the status value set (idempotent: drop-then-add).
alter table public.kb_product_formats
  drop constraint if exists kb_product_formats_status_check;
alter table public.kb_product_formats
  add constraint kb_product_formats_status_check
  check (status in ('draft', 'published', 'archived'));

create index if not exists idx_kb_product_formats_slug     on public.kb_product_formats(slug);
create index if not exists idx_kb_product_formats_active    on public.kb_product_formats(active) where active;
create index if not exists idx_kb_product_formats_status    on public.kb_product_formats(status);
create index if not exists idx_kb_product_formats_category  on public.kb_product_formats(category);

comment on table  public.kb_product_formats             is 'KB product-format / consumption-method vocabulary. FACTUAL form + use + measured potency band (no medical claims, no dosing directives). Staff-only.';
comment on column public.kb_product_formats.category    is 'Loose delivery family for grouping ONLY (inhaled | ingested | topical). Not a medical category.';
comment on column public.kb_product_formats.definition  is 'Factual, non-medical definition of the physical form. Surfaced only after the application compliance gate.';
comment on column public.kb_product_formats.consumption is 'Factual description of how the form is used (smoked/eaten/applied/sublingual). NOT a dosing directive.';
comment on column public.kb_product_formats.potency_note is 'WA-verified typical potency band (market fact, e.g. concentrates 60-90% THC). NEVER a dosing instruction.';
comment on column public.kb_product_formats.house_note  is 'House-voiced budtender blurb (fun-but-professional, non-medical). Compliance-gated on surface.';
comment on column public.kb_product_formats.aliases     is 'Neutral synonyms / adjacent terms that map to this format (for matching product category/type text).';
comment on column public.kb_product_formats.source      is 'Provenance: manual (curated) | enrichment | etc. Backfilled to manual for curated rows.';
comment on column public.kb_product_formats.status      is 'Lifecycle: draft (machine) | published (curated/promoted) | archived.';

-- ---------- backfill (gap-fill only; never clobber curated data) -------------
-- Any pre-existing rows are hand-curated: mark provenance 'manual'. Only fills
-- rows where source is still null, so re-running is a no-op.
update public.kb_product_formats
   set source = 'manual'
 where source is null;

-- ---------- updated_at trigger ----------------------------------------------
drop trigger if exists trg_kb_product_formats_updated on public.kb_product_formats;
create trigger trg_kb_product_formats_updated before update on public.kb_product_formats
  for each row execute function public.set_updated_at();

-- ---------- Row-Level Security ----------------------------------------------
alter table public.kb_product_formats enable row level security;

drop policy if exists kb_product_formats_staff_all on public.kb_product_formats;
create policy kb_product_formats_staff_all on public.kb_product_formats
  for all using (public.is_staff()) with check (public.is_staff());
