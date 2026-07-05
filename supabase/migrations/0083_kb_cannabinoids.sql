-- =============================================================================
-- 0083_kb_cannabinoids.sql
-- Knowledge-Base cannabinoid compounds (GAP 1 + GAP 2 from docs/KB_CONNECTIVITY_AUDIT.md)
--
-- Adds the missing cannabinoid concept to the KB, mirroring the kb_terpenes
-- pattern from 0019, PLUS the link columns kb_products.cannabinoids[] and
-- kb_strains.cannabinoids[] so validated compound tags flow into product/strain
-- grounding.
--
-- STANDING RULES:
--   * Idempotent (create ... if not exists / add column if not exists /
--     drop policy if exists). Safe to re-run.
--   * Applied MANUALLY by the owner.
--   * KB is internal copy-grounding data: staff read/write, no public read
--     (same RLS shape as every other kb_* table -> public.is_staff()).
--   * Stored content is FACTUAL chemistry only (psychoactive vs non-psychoactive,
--     acidic precursor -> decarboxylation). NO medical/therapeutic claims; the
--     application compliance gate strips those before anything surfaces.
-- =============================================================================

-- ---------- kb_cannabinoids --------------------------------------------------
create table if not exists public.kb_cannabinoids (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,                  -- 'thc' | 'thca' | 'cbd' | ...
  name            text not null,                         -- 'THC'
  full_name       text,                                  -- 'Delta-9-tetrahydrocannabinol'
  -- Factual classification (chemistry, NOT a medical claim):
  --   'psychoactive' | 'non-psychoactive' | 'mildly-psychoactive'
  intoxication    text,
  is_acidic       boolean not null default false,        -- true for THCA/CBDA (acidic precursor forms)
  decarbs_to      text,                                  -- slug this acid decarboxylates to (e.g. 'thc'); null for neutrals
  character_notes text[] not null default '{}',          -- neutral descriptors ('major cannabinoid', 'propyl analog of CBD')
  description     text,                                  -- full factual explanation (compliance-gated on surface)
  also_found_in   text,                                  -- botanical / abundance context (factual)
  sources         text[] not null default '{}',          -- citations backing the description
  confidence      numeric,                                -- 0..1 curator confidence
  active          boolean not null default true,
  created_by      uuid references public.staff_profiles(id) on delete set null,
  updated_by      uuid references public.staff_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_kb_cannabinoids_slug   on public.kb_cannabinoids(slug);
create index if not exists idx_kb_cannabinoids_active  on public.kb_cannabinoids(active) where active;

comment on table  public.kb_cannabinoids                 is 'KB cannabinoid compounds. Factual chemistry only (no medical claims). Staff-only.';
comment on column public.kb_cannabinoids.intoxication    is 'Factual classification: psychoactive | non-psychoactive | mildly-psychoactive.';
comment on column public.kb_cannabinoids.is_acidic       is 'true for acidic precursor forms (THCA, CBDA).';
comment on column public.kb_cannabinoids.decarbs_to      is 'Slug of the neutral compound this acid decarboxylates to (heat/time); null for neutral forms.';
comment on column public.kb_cannabinoids.description     is 'Full factual explanation. Surfaced only after the application compliance gate.';
comment on column public.kb_cannabinoids.sources         is 'Reputable-source citations backing the description (see docs/CANNABINOID_SEED_SOURCES.md).';

-- ---------- updated_at trigger ----------------------------------------------
drop trigger if exists trg_kb_cannabinoids_updated on public.kb_cannabinoids;
create trigger trg_kb_cannabinoids_updated before update on public.kb_cannabinoids
  for each row execute function public.set_updated_at();

-- ---------- Row-Level Security ----------------------------------------------
alter table public.kb_cannabinoids enable row level security;

drop policy if exists kb_cannabinoids_staff_all on public.kb_cannabinoids;
create policy kb_cannabinoids_staff_all on public.kb_cannabinoids
  for all using (public.is_staff()) with check (public.is_staff());

-- =============================================================================
-- GAP 2 link columns: let validated compound tags flow into products/strains.
-- Stored as slug arrays that reference kb_cannabinoids.slug (loose ref, like
-- kb_products.terpenes[]).
-- =============================================================================
alter table public.kb_products add column if not exists cannabinoids text[] not null default '{}';
alter table public.kb_strains  add column if not exists cannabinoids text[] not null default '{}';

comment on column public.kb_products.cannabinoids is 'Cannabinoid slugs present/notable for this product (references kb_cannabinoids.slug). Gap-fill only.';
comment on column public.kb_strains.cannabinoids  is 'Cannabinoid slugs notable for this strain (references kb_cannabinoids.slug). Gap-fill only.';
