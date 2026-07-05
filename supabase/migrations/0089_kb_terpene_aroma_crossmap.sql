-- =============================================================================
-- 0089_kb_terpene_aroma_crossmap.sql
-- Knowledge-Base TERPENE -> AROMA cross-map enrichment (KB hardening v2, Slice 5).
--
-- WHY: kb_terpenes (migration 0019) already maps each terpene to aroma_notes,
-- flavor_notes, and a botanical `also_found_in` bridge. The retrieval brain,
-- however, only fired terpene grounding for terpenes the STRAIN listed, emitted
-- bare words, and had no way to go the OTHER direction (an aroma word on a
-- product -> the terpene that typically drives it). This slice enriches the
-- cross-map so sensory copy can tie a product's aroma back to a terpene and its
-- familiar botanical source ("its citrus lift echoes the limonene you'd find in
-- lemon rind").
--
-- This migration adds ONE nullable column, `aroma_families text[]`, a small set
-- of normalized aroma-family tags per terpene (e.g. limonene -> {citrus},
-- pinene -> {pine, herbal}). The reverse index (aroma word -> terpene) and the
-- widened grounding are pure code (retrieval.ts); this column just lets the
-- curated families live in the DB alongside the notes.
--
-- COMPLIANCE (WA I-502): aroma/flavor/botanical descriptors ONLY. No effects, no
-- medical/therapeutic content -- terpenes here are a SENSORY translation layer,
-- never an "entourage effect" or health claim. (Unchanged from 0019's intent.)
--
-- STANDING RULES:
--   * Idempotent (add column if not exists; backfill only-when-null). Safe to
--     re-run. NON-DESTRUCTIVE: never clobbers curated aroma_notes/flavor_notes.
--   * Applied MANUALLY by the owner.
--   * RLS/trigger already exist on kb_terpenes from 0019; unchanged here.
-- =============================================================================

-- ---------- aroma_families (normalized aroma-family tags) --------------------
alter table public.kb_terpenes
  add column if not exists aroma_families text[] not null default '{}';

comment on column public.kb_terpenes.aroma_families is
  'Normalized aroma-family tags for the reverse cross-map (aroma word -> terpene), e.g. {citrus} for limonene. Sensory only; no effects/medical content.';

-- No backfill of VALUES here: the curated families are upserted by the seed
-- action (SEED_TERPENES.aroma_families) on `slug`, gap-fill style, so this
-- migration stays a pure, non-destructive schema add.
