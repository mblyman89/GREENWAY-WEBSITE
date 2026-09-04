-- =============================================================================
-- 0218_receiving_classification.sql
--
-- SLICE 18-0 -- compliance classification for goods that arrive by RECEIVING.
--
-- Owner request, verbatim:
--   "You were looking specifically at products entering the system from the one
--    time Cultivera import. All products entering the system after that one
--    point in time will come through receiving. Please make sure the full
--    intake receiving pipeline has been addressed and properly set up."
--   "I like your recommendation about the targeted gate, let's build it that
--    way please. Let's fix the receiving intake pipeline first, then address
--    the management of said items."
--
-- WHAT WAS BROKEN
-- ---------------
-- SLICE 16 (0216) and SLICE 17 (0217) added four per-product compliance flags:
--
--   low_thc_liquid  / unit_thc_mg       -- WAC 314-55-095(1)(d)(i)(E)+(F)
--   otherwise_taken / units_per_package -- WAC 314-55-095(1)(d)(i)(D)
--
-- Both slices wired classification into FACT REVIEW, the screen that reviews
-- the one-time Cultivera import. Fact review is scoped to an import_id --
-- fact-review-store.ts keys every read and write on it and upserts on
-- (import_id, source_item_id). A lot received on a vendor manifest carries a
-- MANIFEST id and no import id, so it could never appear on that screen. Not
-- as a bug: by construction.
--
-- After the Cultivera cutover, every product enters through receiving. So the
-- only classification step in the building was permanently unreachable for
-- every future product, and 0216/0217's inventory_lots columns were dead on
-- arrival for every received lot.
--
-- WHY THAT IS DANGEROUS AND NOT MERELY UNTIDY
-- -------------------------------------------
-- 0217 spells this out in capitals and it bears repeating here, because it is
-- the reason this slice exists at all:
--
--   An unflagged suppository is categorised `topical`. `topical` maps to the
--   liquid_edible bucket. That bucket is 2016 g. A box of suppositories is
--   nothing against 2016 g, so the product is effectively UNLIMITED and the
--   ten-unit maximum never engages.
--
-- Silence does not fail closed here. Silence disables a statutory limit. The
-- low-THC flag is the opposite -- an unanswered beverage stays in the TIGHTER
-- 2016 g bucket -- which is exactly why the application gates one and merely
-- prompts for the other. See receiving-classification-core.ts.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- The four flag columns already exist where the VALUES live:
--   inventory_lots  (0216 lines 100-103, 0217 lines 167-170)
--   menu_items      (0216 lines 95-98,  0217 lines 162-165)
--   order_lines     (0217 lines 280-287)
-- Nothing new is needed there; SLICE 18-0 simply starts WRITING the lot ones,
-- which nothing on the receiving path ever did.
--
-- What is missing is the place the human's ANSWER is captured on its way to
-- the shelf: catalog_product_drafts, the Product Onboarding queue. This
-- follows the 0141 / 0146 precedent exactly -- the human's choice lives in its
-- own clearly-named columns, and the raw LCB/CCRS values on the row
-- (category, inventory_type) are NEVER touched.
--
-- PROVENANCE IS RECORDED, NOT ASSUMED
-- -----------------------------------
-- The gate is TARGETED: it only demands an answer when the answer could change
-- a limit (a liquid_edible shelf, or a suppository the detector spotted).
-- Everywhere else the machine applies the safe default of "no" WITHOUT asking
-- anybody. Those two situations must not look identical in the database.
--
-- chosen_classification_provenance records which one happened, using the same
-- vocabulary as fact_provenance (0138): 'human' when a person answered,
-- 'machine_default' when nobody was asked, 'unanswered' when no default is
-- safe to invent. Without it, the "has anyone actually looked at this product?"
-- worklist planned for 18A would be unbuildable -- a machine's silent `false`
-- and a receiver's considered `false` would be the same byte.
--
-- No CHECK constraints: every write is validated server-side against a closed
-- vocabulary in receiving-classification-core.ts before it reaches the
-- database, which is the same pattern 0141 and 0146 use and for the same
-- reason (the vocabularies are code-owned and would otherwise need a migration
-- per label).
--
-- Depends on 0026 (catalog_product_drafts), 0216, 0217.
-- Apply manually (owner). Idempotent: safe to re-run.
-- =============================================================================

alter table public.catalog_product_drafts
  add column if not exists chosen_otherwise_taken   boolean;
alter table public.catalog_product_drafts
  add column if not exists chosen_units_per_package numeric(10,3);
alter table public.catalog_product_drafts
  add column if not exists chosen_low_thc_liquid    boolean;
alter table public.catalog_product_drafts
  add column if not exists chosen_unit_thc_mg       numeric(10,3);
alter table public.catalog_product_drafts
  add column if not exists chosen_classification_provenance jsonb;

comment on column public.catalog_product_drafts.chosen_otherwise_taken is
  '0218 / SLICE 18-0: WAC 314-55-095(1)(d)(i)(D). True when this product is administered by a route that is not inhalation, not oral ingestion and not external application to the skin -- in practice a suppository. Set at Product Onboarding, which is the only classification step a RECEIVED lot can reach (fact review is import_id-scoped). Null means the draft predates the gate; it does NOT mean no.';

comment on column public.catalog_product_drafts.chosen_units_per_package is
  '0218 / SLICE 18-0: individual consumable items inside ONE sellable package (RCW 69.50.101) -- a box of six suppositories is 6. Required whenever chosen_otherwise_taken is true, because the limit is counted in whole items and a missing multiplier would silently count that box as ONE unit, under-counting a statutory maximum sixfold.';

comment on column public.catalog_product_drafts.chosen_low_thc_liquid is
  '0218 / SLICE 18-0: WAC 314-55-095(1)(d)(i)(E)+(F), the 200 mg active delta-9 THC carve-out. PROMPTED but never required: an unanswered beverage stays in the tighter 2016 g liquid bucket, so silence here can only ever under-sell. Contrast chosen_otherwise_taken, where silence over-sells, which is why that one is gated.';

comment on column public.catalog_product_drafts.chosen_unit_thc_mg is
  '0218 / SLICE 18-0: milligrams of active delta-9 THC in ONE SEALED CONTAINER -- not one serving. A 16 mg bottle labelled "4 servings x 4 mg" is 16 and does NOT qualify. Must be > 0 and <= 4 for the carve-out to apply.';

comment on column public.catalog_product_drafts.chosen_classification_provenance is
  '0218 / SLICE 18-0: how each classification value came to exist -- {"otherwiseTaken":"human"|"machine_default","lowThcLiquid":"human"|"unanswered"}. Same vocabulary as fact_provenance (0138). The gate is targeted, so on most products the machine defaults otherwise_taken to false WITHOUT asking; this column is what keeps that apart from a human who considered the question and answered no. The unclassified worklist depends on the distinction.';
