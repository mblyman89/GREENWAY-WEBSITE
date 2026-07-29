-- =============================================================================
-- INTAKE INTELLIGENCE / SLICE 93 - strain type at draft approval
--
-- One nullable text column on catalog_product_drafts that records the HUMAN
-- strain-type decision made on the Product Onboarding approval card:
--
--   chosen_strain_type : OUR canonical strain-type value (strain-taxonomy.ts,
--                        e.g. 'indica', 'sativa-hybrid') picked by the
--                        approver. Optional - strain type is never a gate.
--
-- Owner rule (roadmap round 6): the product NAME often carries the strain
-- type ("Blue Dream (S)", "GG4 - IH", "Grape Ape Indica") - a pure parser
-- (strain-type-intel-core.ts) reads it, >=90% confidence auto-assigns, and
-- the approver can always override or set it. The human's choice lives in
-- its own column with a clear name; the raw manifest values are NEVER touched.
--
-- The server validates every write against the canonical strain-taxonomy
-- vocabulary before it lands here (validateStrainTypeChoice), so no CHECK
-- constraint is needed.
--
-- Depends on 0026 (catalog_product_drafts). Apply manually (owner).
-- Idempotent: safe to re-run.
-- =============================================================================

alter table public.catalog_product_drafts
  add column if not exists chosen_strain_type text;

comment on column public.catalog_product_drafts.chosen_strain_type is
  '0146: OUR canonical strain type (strain-taxonomy value) picked by the human at approval. Outranks the KB/intake/name-parse verdicts at menu injection. Null = no human pick was made.';
