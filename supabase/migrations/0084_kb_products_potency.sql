-- =============================================================================
-- 0084_kb_products_potency.sql
-- Potency inflow into the KB (GAP 5 from docs/KB_CONNECTIVITY_AUDIT.md — the
-- biggest connectivity gap: measured potency lives on lab_results but never
-- reached kb_products).
--
-- Adds gap-fillable potency columns on kb_products so that, on publish, the KB
-- writeback can copy measured potency from the linked lab_results row into the
-- product's KB record (drafts-only, never clobbering curated data).
--
-- GROUNDED IN THE REAL lab_results SHAPE (verified, not guessed):
--   * lab_results.potency_json  jsonb  — normalized map, e.g.
--       { "thc": 0.9, "thca": 25.3, "cbd": 0.1, "total-cannabinoids": 27.4 }
--     (0024_pos_coa_potency.sql + src/lib/inventory/intake-parser.ts).
--   * lab_results.total_thc_pct / total_cbd_pct  numeric  (0023_pos_inventory_lots.sql).
-- We mirror those into kb_products with a numeric headline pair + the raw map +
-- provenance so the source and confidence of the potency are always auditable.
--
-- STANDING RULES:
--   * Idempotent (add column if not exists). Safe to re-run.
--   * Applied MANUALLY by the owner.
--   * Same RLS as kb_products (already staff-only from 0071); no policy change.
-- =============================================================================

alter table public.kb_products add column if not exists potency_json        jsonb;
alter table public.kb_products add column if not exists total_thc_pct        numeric;
alter table public.kb_products add column if not exists total_cbd_pct        numeric;
-- Provenance so we always know where a potency value came from and how much to
-- trust it. potency_source example: 'lab_results:<uuid>'.
alter table public.kb_products add column if not exists potency_source       text;
alter table public.kb_products add column if not exists potency_confidence   numeric;

create index if not exists idx_kb_products_potency_source on public.kb_products(potency_source);

comment on column public.kb_products.potency_json      is 'Normalized potency map copied from lab_results.potency_json (gap-fill only).';
comment on column public.kb_products.total_thc_pct     is 'Headline total THC % copied from lab_results (gap-fill only, never clobbers curated).';
comment on column public.kb_products.total_cbd_pct     is 'Headline total CBD % copied from lab_results (gap-fill only, never clobbers curated).';
comment on column public.kb_products.potency_source    is 'Provenance of the potency, e.g. lab_results:<uuid>.';
comment on column public.kb_products.potency_confidence is 'Curator/derivation confidence 0..1 for the potency values.';
