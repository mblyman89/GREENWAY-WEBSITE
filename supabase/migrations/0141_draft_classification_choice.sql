-- =============================================================================
-- INTAKE INTELLIGENCE / SLICE 64 - manual classification at draft approval
--
-- Two nullable text columns on catalog_product_drafts that record the HUMAN
-- classification decision made on the Product Onboarding approval card:
--
--   chosen_website_category : OUR website category value (category-taxonomy.ts,
--                             e.g. 'cartridge', 'edible-solid') picked by the
--                             approver when the house resolver has no mapping.
--   chosen_house_type       : OUR product-type label (inventory-type-catalog.ts,
--                             e.g. 'Live Resin Cartridge', 'Gummies') picked by
--                             the approver when the SLICE 63 labeler is below
--                             90% confidence.
--
-- Owner rule (roadmap B3): >=90% confidence auto-assigns; below that a human
-- picks from OUR taxonomy before the price can be approved - no more silent
-- refusals, no guessing. The raw LCB/CCRS values already on the row (category,
-- inventory_type) are NEVER touched: CCRS stays under the hood, the human's
-- choice lives in its own columns with a clear name.
--
-- The server validates every write against the closed vocabularies before it
-- lands here (draft-approval-gate-core.ts), so no CHECK constraint is needed -
-- and the taxonomies are code-owned lists that would otherwise require a
-- migration every time a label is added.
--
-- Depends on 0026 (catalog_product_drafts). Apply manually (owner).
-- Idempotent: safe to re-run.
-- =============================================================================

alter table public.catalog_product_drafts
  add column if not exists chosen_website_category text,
  add column if not exists chosen_house_type text;

comment on column public.catalog_product_drafts.chosen_website_category is
  '0141: OUR website category (category-taxonomy value) picked by the human at approval when the resolver has no mapping. Raw CCRS category stays untouched in the category column.';
comment on column public.catalog_product_drafts.chosen_house_type is
  '0141: OUR product-type label (inventory-type-catalog label) picked by the human at approval when the type labeler is below 90% confidence. Raw LCB inventory_type stays untouched.';
