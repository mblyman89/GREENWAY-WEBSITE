-- =============================================================================
-- 0020 — kb_strains: richer (optional) columns for a deeper seed
-- =============================================================================
-- The first KB seed proved the grounding approach works. To seed a much larger,
-- accurate strain set (no guessing — verified facts only), we add a few optional
-- columns that capture the extra dimensions the owner asked for. ALL nullable,
-- ALL sensory/botanical/market-factual — there is still no place for medical or
-- effect claims, by design (WA I-502).
--
--   • dominant_cannabinoid — 'thc' | 'cbd' | 'balanced' | 'cbg' | 'cbn' | 'cbc'.
--       Lets the AI describe high-CBD/CBG cultivars correctly (ACDC, Harlequin,
--       Charlotte's Web, …) instead of assuming everything is high-THC.
--   • potency_note         — factual market descriptor, e.g. 'typically very high
--       THC', 'low-THC / high-CBD'. NOT an effect claim.
--   • bud_structure        — 'dense', 'fluffy', 'spear-shaped', 'frosty', 'chunky'.
--   • origin               — only when well-documented ('Afghani landrace',
--       'Northern California', 'Netherlands'). Null when unknown.
--   • sources              — provenance: which references corroborated the row,
--       so the owner can audit every fact. (text[]).
--   • confidence           — 0..1 corroboration confidence for the row.
--
-- Idempotent: add column if not exists. Safe to run more than once.
-- =============================================================================

alter table public.kb_strains add column if not exists dominant_cannabinoid text;
alter table public.kb_strains add column if not exists potency_note         text;
alter table public.kb_strains add column if not exists bud_structure        text;
alter table public.kb_strains add column if not exists origin               text;
alter table public.kb_strains add column if not exists sources              text[] not null default '{}';
alter table public.kb_strains add column if not exists confidence           numeric;

create index if not exists idx_kb_strains_cannabinoid
  on public.kb_strains(dominant_cannabinoid) where dominant_cannabinoid is not null;
