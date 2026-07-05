-- =============================================================================
-- 0082_kb_enrichment_provenance.sql
--
-- WHY: The KB enrichment engine (src/lib/kb/enrich-from-discovery.ts) writes
-- BRAND drafts into kb_brands from state CCRS discovery data. kb_products
-- already carries a full provenance + drafts-only lifecycle (0071:
-- source / confidence / sources / status), but kb_brands (0019) predates that
-- pattern and has none of it. This migration brings kb_brands up to parity so
-- every machine-suggested brand fact is auditable and review-gated, exactly
-- like kb_products.
--
-- LIFECYCLE (mirrors kb_products):
--   • status: draft | published | archived
--   • Machine writers (enrichment, discovery import) ONLY ever insert
--     status='draft'. A human promotes to 'published' in the KB review UI.
--   • Existing kb_brands rows are hand-curated, so the backfill marks them
--     'published' (never demote curated data — standing rule).
--
-- PROVENANCE:
--   • source     — who/what wrote the row ('manual' for pre-existing curated
--                  rows; 'ccrs:<dataset_id>' for discovery enrichment; etc.)
--   • confidence — 0..1 match confidence (nullable; curated rows stay null)
--   • sources    — corroborating references (free-form strings)
--
-- Idempotent: add column if not exists / create index if not exists, and the
-- backfill only touches rows where the column is still null. Safe to run more
-- than once. Apply manually in the Supabase SQL editor.
-- =============================================================================

-- ---------- provenance columns ----------------------------------------------
alter table public.kb_brands
  add column if not exists source     text,
  add column if not exists confidence numeric,
  add column if not exists sources    text[] not null default '{}';

-- ---------- drafts-only lifecycle --------------------------------------------
-- Default 'published' at the COLUMN level so the backfill below and any legacy
-- writers keep curated rows authoritative; machine writers must set 'draft'
-- explicitly (the enrichment engine always does).
alter table public.kb_brands
  add column if not exists status text not null default 'published';

-- Guard the value set (idempotent: drop-then-add).
alter table public.kb_brands
  drop constraint if exists kb_brands_status_check;
alter table public.kb_brands
  add constraint kb_brands_status_check
  check (status in ('draft', 'published', 'archived'));

-- ---------- backfill (gap-fill only; never clobber curated data) -------------
-- Pre-existing rows were hand-curated: mark their provenance as 'manual'.
-- Only fills rows where source is still null, so re-running is a no-op.
update public.kb_brands
   set source = 'manual'
 where source is null;

-- status needs no backfill: the column default ('published') applied to all
-- existing rows when the column was added.

-- ---------- indexes -----------------------------------------------------------
create index if not exists idx_kb_brands_status   on public.kb_brands (status);
create index if not exists idx_kb_products_status on public.kb_products (status);

-- ---------- documentation ------------------------------------------------------
comment on column public.kb_brands.source is
  'Provenance: manual | seed | enrichment | ccrs:<dataset_id> | crawl:<url>. Machine writers must be identifiable.';
comment on column public.kb_brands.confidence is
  'Match confidence 0..1 for machine-suggested rows (e.g. 0.9 license-matched, 0.6 name-only). Null for curated rows.';
comment on column public.kb_brands.sources is
  'Corroborating references for the facts on this row (dataset ids, URLs, document names).';
comment on column public.kb_brands.status is
  'Drafts-only lifecycle: draft = machine-suggested, needs human review; published = authoritative; archived = retired. Machine writers ONLY insert draft.';
