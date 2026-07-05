-- =============================================================================
-- 0086_kb_effects.sql
-- Knowledge-Base EFFECTS vocabulary (KB hardening v2, Slice 1).
--
-- WHY: Migration 0071 added free-text `effects text[]` arrays to kb_products,
-- kb_strains and kb_product_categories, and the retrieval brain surfaces them
-- verbatim ("Curated experiential character: relaxed, sleepy, uplifted"). But
-- those bare tags have NO canonical definition, NO per-term compliance vetting,
-- and NO house voice. This table gives each experiential effect a single
-- authoritative record: a factual, non-medical definition PLUS a house-voiced
-- "budtender blurb" so the AI can speak about the experience accurately and in
-- Greenway's tone. The existing effects[] arrays reference kb_effects.slug
-- (loose ref, exactly like kb_products.terpenes[] -> kb_terpenes.slug).
--
-- COMPLIANCE (WA I-502): every slug is a member of the code's authoritative
-- ALLOWED_EFFECTS allow-list (src/lib/ai/compliance.ts). Stored prose is the
-- SUBJECTIVE EXPERIENCE only ("how it tends to feel"), never a medical /
-- therapeutic claim ("treats / helps / relieves / cures"). All prose is routed
-- through the existing checkCompliance + checkEffects gate before it can
-- surface in retrieval.
--
-- STANDING RULES:
--   * Idempotent (create ... if not exists / add column if not exists /
--     drop policy if exists / backfill only-when-null). Safe to re-run.
--   * Applied MANUALLY by the owner.
--   * KB is internal copy-grounding data: staff read/write, no public read
--     (same RLS shape as every other kb_* table -> public.is_staff()).
--   * Drafts/provenance parity mirrors kb_brands (0082) / kb_strains (0085):
--     curated rows default status='published' + source='manual'; machine
--     writers must set status='draft' explicitly.
-- =============================================================================

-- ---------- kb_effects -------------------------------------------------------
create table if not exists public.kb_effects (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,                  -- 'relaxed' | 'uplifted' | 'couch-lock' | ...
  name            text not null,                         -- display label 'Relaxed'
  -- Loose experiential family for grouping in the UI (NOT a medical category):
  --   'calming' | 'uplifting' | 'energizing' | 'character'
  category        text,
  -- Factual, non-medical definition of the SUBJECTIVE experience.
  definition      text,
  -- House-voiced budtender blurb (fun-but-professional, still non-medical).
  house_note      text,
  -- Neutral synonyms / adjacent slang that map to this effect (for matching).
  aliases         text[] not null default '{}',
  sources         text[] not null default '{}',          -- citations backing the definition
  confidence      numeric,                                -- 0..1 curator confidence
  -- Drafts/provenance parity (mirrors kb_brands 0082):
  source          text,                                   -- 'manual' (curated) | 'enrichment' | ...
  status          text not null default 'published',      -- draft | published | archived
  active          boolean not null default true,
  created_by      uuid references public.staff_profiles(id) on delete set null,
  updated_by      uuid references public.staff_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Guard the status value set (idempotent: drop-then-add).
alter table public.kb_effects
  drop constraint if exists kb_effects_status_check;
alter table public.kb_effects
  add constraint kb_effects_status_check
  check (status in ('draft', 'published', 'archived'));

create index if not exists idx_kb_effects_slug   on public.kb_effects(slug);
create index if not exists idx_kb_effects_active  on public.kb_effects(active) where active;
create index if not exists idx_kb_effects_status  on public.kb_effects(status);

comment on table  public.kb_effects            is 'KB experiential-effect vocabulary. SUBJECTIVE experience only (no medical claims). Slugs are members of ALLOWED_EFFECTS. Staff-only.';
comment on column public.kb_effects.category   is 'Loose experiential family for grouping ONLY (calming | uplifting | energizing | character). Not a medical category.';
comment on column public.kb_effects.definition is 'Factual, non-medical definition of the subjective experience. Surfaced only after the application compliance gate.';
comment on column public.kb_effects.house_note is 'House-voiced budtender blurb (fun-but-professional, non-medical). Compliance-gated on surface.';
comment on column public.kb_effects.aliases    is 'Neutral synonyms / adjacent terms that map to this effect (for matching free-text effects[] tags).';
comment on column public.kb_effects.source     is 'Provenance: manual (curated) | enrichment | etc. Backfilled to manual for curated rows.';
comment on column public.kb_effects.status     is 'Lifecycle: draft (machine) | published (curated/promoted) | archived.';

-- ---------- backfill (gap-fill only; never clobber curated data) -------------
-- Any pre-existing rows are hand-curated: mark provenance 'manual'. Only fills
-- rows where source is still null, so re-running is a no-op.
update public.kb_effects
   set source = 'manual'
 where source is null;

-- ---------- updated_at trigger ----------------------------------------------
drop trigger if exists trg_kb_effects_updated on public.kb_effects;
create trigger trg_kb_effects_updated before update on public.kb_effects
  for each row execute function public.set_updated_at();

-- ---------- Row-Level Security ----------------------------------------------
alter table public.kb_effects enable row level security;

drop policy if exists kb_effects_staff_all on public.kb_effects;
create policy kb_effects_staff_all on public.kb_effects
  for all using (public.is_staff()) with check (public.is_staff());
