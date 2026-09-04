-- =============================================================================
-- 0219_classification_provenance_doctrine.sql
--
-- SLICE 18E -- write the classification PROVENANCE DOCTRINE into the schema.
--
-- Owner decision, verbatim:
--   "Yes please ratify option B."
--   "I want the enterprise grade industry standard practice for this one. If
--    the professional expert way is to add a migration then let's do it."
--
-- THIS MIGRATION CHANGES NO DATA AND NO STRUCTURE.
-- It only rewrites four column COMMENTS. That is deliberate, and it is the
-- industry-standard place for this information: a column comment is the one
-- piece of documentation that travels WITH the database. It shows up in psql
-- (\d+), in Supabase's table editor, in every BI tool, and in whatever schema
-- browser the next engineer opens at 2am. Documentation that lives only in a
-- markdown file is documentation the person holding the incident does not
-- have. (The prose doctrine also ships, in docs/classification-provenance.md;
-- the two are complements, not alternatives.)
--
-- -----------------------------------------------------------------------------
-- WHAT WAS MISLEADING
-- -----------------------------------------------------------------------------
-- 0216 and 0217 added four compliance-limit flags to BOTH `menu_items` and
-- `inventory_lots`:
--
--   low_thc_liquid  / unit_thc_mg       -- WAC 314-55-095(1)(d)(i)(E)+(F)
--   otherwise_taken / units_per_package -- WAC 314-55-095(1)(d)(i)(D)
--
-- The lot-side columns were commented, in full:
--
--   'SLICE 16. See menu_items.low_thc_liquid. Traceable to the source invoice
--    via lot_code.'
--
-- "See menu_items.low_thc_liquid" reads as "these two columns mean the same
-- thing". They do not, and the difference is the whole point:
--
--   * `menu_items.*`     is ENFORCEMENT. The register reads these four columns
--                        and nothing else when it decides whether a cart is
--                        over a statutory limit
--                        (src/lib/pos/live-menu.ts:94-100).
--
--   * `inventory_lots.*` is PROVENANCE. It records what the receiving paperwork
--                        for THIS physical lot said, so a later reader can ask
--                        "where did this classification come from, and does the
--                        invoice still agree with the menu?" NOTHING reads it
--                        to decide a limit.
--
-- A reader who trusted the old comment could reasonably conclude that writing
-- the lot column changes what the register does. It does not. Such a write
-- looks successful and silently changes nothing at the point of sale -- the
-- most dangerous class of bug in a compliance system, because it is invisible
-- and it is confidently wrong.
--
-- -----------------------------------------------------------------------------
-- WHY THE COLUMNS STAY (the alternative was considered and rejected)
-- -----------------------------------------------------------------------------
-- Dropping the lot-side columns was evaluated in docs/slice-18e-recon.md
-- (FINDING 7) and rejected on evidence, not preference. They are written by the
-- receiving path (src/lib/inventory/intake-store.ts:562-565), read by the dock
-- summary (intake-store.ts:1470), CHECK-constrained by 0216/0217, and they are
-- the only per-lot record of what the source invoice claimed. A product can be
-- re-classified on the menu; the lot's paperwork is a historical fact and stays
-- put. Deleting the audit trail to tidy up a comment would be the wrong trade.
--
-- The rule is therefore not "these columns are useless" but:
--
--        ENFORCEMENT READS MENU. PROVENANCE READS LOT. NEVER THE REVERSE.
--
-- A fails-closed test enforces this in CI so the doctrine cannot rot:
-- tests/compliance/classification-provenance.test.ts asserts that no
-- enforcement module gains a lot-side read of these four columns.
--
-- Statutory anchors (unchanged by this migration):
--   WAC 314-55-095(1)(d)(i)(D)  ten units "otherwise taken into the body"
--   WAC 314-55-095(1)(d)(i)(E)  72 oz of marijuana-infused liquid
--   WAC 314-55-095(1)(d)(i)(F)  200 mg low-THC liquid carve-out
--   RCW 69.50.101               "unit" / "package" definitions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- inventory_lots -- the four provenance mirrors (0216 + 0217).
-- -----------------------------------------------------------------------------

comment on column public.inventory_lots.low_thc_liquid is
  'SLICE 16, doctrine clarified in SLICE 18E (0219). PROVENANCE MIRROR -- NOT ENFORCEMENT. What the receiving paperwork for THIS lot said about the low-THC carve-out (WAC 314-55-095(1)(d)(i)(F)), traceable to the source invoice via lot_code. The register NEVER reads this column: it enforces from menu_items.low_thc_liquid only (src/lib/pos/live-menu.ts). Writing here alone changes NOTHING at the point of sale. To change what the register does, write menu_items via applyClassificationToMenu(); this column is mirrored afterwards as a best-effort record. NULL means the paperwork never said, which is not the same as FALSE (explicitly not low-THC).';

comment on column public.inventory_lots.unit_thc_mg is
  'SLICE 16, doctrine clarified in SLICE 18E (0219). PROVENANCE MIRROR -- NOT ENFORCEMENT. Active delta-9 THC in ONE INDIVIDUAL SELLABLE UNIT (one can), in mg, as stated on THIS lot''s paperwork. Not per serving, not per package. The register enforces from menu_items.unit_thc_mg only. See inventory_lots.low_thc_liquid for the full doctrine.';

comment on column public.inventory_lots.otherwise_taken is
  'SLICE 17, doctrine clarified in SLICE 18E (0219). PROVENANCE MIRROR -- NOT ENFORCEMENT. What the receiving paperwork for THIS lot said about whether the product is "otherwise taken into the body" (WAC 314-55-095(1)(d)(i)(D) -- the ten-unit bucket: suppositories, transdermal patches and the like). The register NEVER reads this column: it enforces from menu_items.otherwise_taken only. Writing here alone changes NOTHING at the point of sale. NULL means unanswered; FALSE is a real, human-supplied answer meaning "no, it is not". The receiving dock distinguishes the two, so never coalesce NULL to FALSE on write.';

comment on column public.inventory_lots.units_per_package is
  'SLICE 17, doctrine clarified in SLICE 18E (0219). PROVENANCE MIRROR -- NOT ENFORCEMENT. Count of individual consumable items in one sellable package per RCW 69.50.101 ("unit" / "package") as stated on THIS lot''s paperwork -- a box of six suppositories is 6. NOT the same as servings_per_pack, which divides ONE container by dose; units are physically separate items. The register enforces from menu_items.units_per_package only. See inventory_lots.otherwise_taken for the full doctrine.';

-- -----------------------------------------------------------------------------
-- menu_items -- state the enforcement role positively on the authoritative side
-- too, so the doctrine is legible from EITHER end of the mirror. The statutory
-- meaning of each column is unchanged from 0216/0217; only the role sentence
-- is added.
-- -----------------------------------------------------------------------------

comment on column public.menu_items.low_thc_liquid is
  'SLICE 16, role stated in SLICE 18E (0219). ENFORCEMENT SOURCE OF TRUTH -- this column, not the inventory_lots mirror, is what the register reads. TRUE when this liquid is packaged in individual units of no more than 4 mg active delta-9 THC, so it counts against the 200 mg bucket instead of the 72 oz bucket (WAC 314-55-095(1)(d)(i)(E) "unless"). NULL = not yet classified; the engine treats NULL as a normal liquid. Set at intake from the label/invoice -- never derived from servings x mg-per-serving, which is wrong for multi-serving single containers.';

comment on column public.menu_items.unit_thc_mg is
  'SLICE 16, role stated in SLICE 18E (0219). ENFORCEMENT SOURCE OF TRUTH. Active delta-9 THC in ONE INDIVIDUAL SELLABLE UNIT (one can), in mg. Not per serving, not per package.';

comment on column public.menu_items.otherwise_taken is
  'SLICE 17, role stated in SLICE 18E (0219). ENFORCEMENT SOURCE OF TRUTH -- this column, not the inventory_lots mirror, is what the register reads. TRUE when the product is "otherwise taken into the body" (WAC 314-55-095(1)(d)(i)(D)), so it counts against the ten-unit bucket. NULL = not yet classified. Set by a human at receiving or on the classification worklist.';

comment on column public.menu_items.units_per_package is
  'SLICE 17, role stated in SLICE 18E (0219). ENFORCEMENT SOURCE OF TRUTH. Count of individual consumable items in one sellable package, per RCW 69.50.101 ("unit" / "package"). A box of six suppositories is 6. NULL means the package is a single unit. NOT the same as servings_per_pack -- servings divide one container by dose; units are physically separate items.';
