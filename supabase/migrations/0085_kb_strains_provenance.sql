-- =============================================================================
-- 0085_kb_strains_provenance.sql
--
-- WHY (GAP 6 of docs/KB_CONNECTIVITY_AUDIT.md): kb_products (0071) and
-- kb_brands (0082) both carry a drafts-only lifecycle + machine provenance
-- (status / source / confidence / sources) so every machine-suggested fact is
-- auditable and review-gated. kb_strains (0019/0020) predates that pattern: it
-- has `active` + `sources[]` + `confidence` but NO `status` column and no
-- `source` provenance. The KB write-back service (src/lib/ai/kb/writeback.ts)
-- union-merges AI/enrichment sensory notes onto an EXISTING curated strain row
-- in place, with no provenance tag on that machine touch. This migration brings
-- kb_strains up to the SAME parity as kb_brands (exactly mirroring 0082) so the
-- strain layer is consistent and auditable.
--
-- LIFECYCLE (mirrors kb_products / kb_brands):
--   • status: draft | published | archived
--   • Machine writers (enrichment write-back) that ever CREATE a strain row
--     must insert status='draft'; a human promotes to 'published'.
--   • Existing kb_strains rows are hand-curated (the seeded starter set), so
--     the column default is 'published' — curated data is NEVER demoted
--     (standing rule: never clobber curated data).
--
-- PROVENANCE:
--   • source     — who/what wrote the row ('manual' for pre-existing curated
--                  rows; 'seed' for the seeded starter set; 'enrichment' for a
--                  machine write-back touch). kb_strains already has
--                  `sources[]` (0020) and `confidence` (0020); this adds the
--                  scalar `source` identifier to match kb_products/kb_brands.
--
-- Idempotent: add column if not exists / create index if not exists, and the
-- backfill only touches rows where the column is still null / left at default.
-- Safe to run more than once. Apply manually in the Supabase SQL editor.
-- =============================================================================

-- ---------- provenance scalar (sources[] + confidence already exist in 0020) --
alter table public.kb_strains
  add column if not exists source text;

-- ---------- drafts-only lifecycle --------------------------------------------
-- Default 'published' at the COLUMN level so the backfill below and any legacy
-- writers keep curated rows authoritative; machine writers must set 'draft'
-- explicitly.
alter table public.kb_strains
  add column if not exists status text not null default 'published';

-- Guard the value set (idempotent: drop-then-add).
alter table public.kb_strains
  drop constraint if exists kb_strains_status_check;
alter table public.kb_strains
  add constraint kb_strains_status_check
  check (status in ('draft', 'published', 'archived'));

-- ---------- backfill (gap-fill only; never clobber curated data) -------------
-- Pre-existing rows were hand-curated / seeded: mark their provenance 'manual'.
-- Only fills rows where source is still null, so re-running is a no-op.
update public.kb_strains
   set source = 'manual'
 where source is null;

-- status needs no backfill: the column default ('published') applied to all
-- existing rows when the column was added.

-- ---------- indexes -----------------------------------------------------------
create index if not exists idx_kb_strains_status on public.kb_strains (status);

-- ---------- documentation ------------------------------------------------------
comment on column public.kb_strains.source is
  'Provenance: manual | seed | enrichment. Machine writers must be identifiable. Pre-existing curated rows are backfilled to ''manual''.';
comment on column public.kb_strains.status is
  'Drafts-only lifecycle: draft = machine-suggested, needs human review; published = authoritative; archived = retired. Machine writers ONLY insert draft; curated rows default published.';
