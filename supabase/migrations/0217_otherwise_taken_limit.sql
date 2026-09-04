-- ===========================================================================
-- 0217_otherwise_taken_limit.sql
--
-- SLICE 17 -- the "otherwise taken into the body" TEN UNIT transaction limit.
--
-- Owner request, verbatim:
--   "I think for the purpose of being all inclusive, enterprise grade software
--    system, we should include the suppositories limits to the system to be
--    thorough. I didn't fully understand what taken into the body meant, but
--    suppository now makes perfect sense... please make sure you give it the
--    care and detail and love it needs so it is perfectly accurate and
--    respects the CCRS exactly. The limits should be blocked for the customer
--    facing website and register. It should be added to the back office with
--    the other limits and settings and such."
--
-- THE LAW
-- -------
-- WAC 314-55-095(1)(d)(i)(D), verbatim:
--   "Ten units of a cannabis-infused product otherwise taken into the body;"
--
-- WAC 314-55-010(40) defines the category, verbatim:
--   "'Product(s) otherwise taken into the body' means a cannabis-infused
--    product for human consumption or ingestion intended for uses other than
--    inhalation, oral ingestion, or external application to the skin."
--
-- In practice that is the suppository shelf: not smoked, not swallowed, not
-- rubbed on the skin. This is why the flag is a PER-PRODUCT ROUTE OF
-- ADMINISTRATION and not a category slug -- see the design note below.
--
-- RCW 69.50.101 supplies the counting unit, verbatim:
--   "'Unit' means an individual consumable item within a package of one or
--    more consumable items"
--   "'Package' means a container that has a single unit or group of units."
-- So a box of six suppositories is ONE package of SIX units. That is exactly
-- what units_per_package below records, and why the limit is counted in whole
-- items rather than in grams or milligrams.
--
-- MEDICAL DOES NOT TRIPLE -- AND FOR A DIFFERENT REASON THAN SLICE 16
-- -------------------------------------------------------------------
-- WAC 314-55-095(2)(d) enumerates the medical (DOH database) maxima. It lists
-- FIVE categories: usable cannabis, solid edibles, concentrates, liquids, and
-- the low-THC liquid figure. "Otherwise taken into the body" IS ABSENT FROM
-- THAT LIST ENTIRELY. RCW 69.50.360(3) likewise runs (a)-(e) with no such
-- category, and RCW 69.50.4013(3)(a) defines possession by reference to
-- 360(3), so it is silent too.
--
-- SLICE 16's bucket does not triple because the rule names the SAME 200 mg
-- figure for medical. THIS bucket does not triple because the rule NEVER
-- RAISES IT AT ALL. Tripling by analogy would authorise a sale that no rule
-- permits -- an unrecoverable error. Declining to triple can only ever
-- under-sell, which is recoverable and explainable. Both defaults are 10.
-- Do not "fix" med to 30.
--
-- WAC 314-55-095(1)(d)(ii) is what binds us as the licensee, verbatim:
--   the licensee is "prohibited from conducting a transaction that facilitates
--    an individual in obtaining more than the personal possession amount"
--
-- NOT TO BE CONFUSED WITH: WAC 314-55-095(1)(b), the 100 mg single-PACKAGE
-- ceiling. That is a PROCESSOR PACKAGING rule, not a transaction limit. It is
-- recorded here only so that nobody later conflates the two.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1) sales_limit_settings: two owner-tunable maxima, in WHOLE UNITS (items).
--    Every other limit column on this table is numeric grams or mg; these are
--    counts, so the names carry `_units` explicitly to make a mistaken unit
--    conversion hard to write by accident.
--
-- 2) menu_items + inventory_lots: the per-product route-of-administration flag
--    plus the units-per-package multiplier.
--
-- *** THE FAIL-SAFE IS INVERTED RELATIVE TO SLICE 16 -- READ THIS ***
-- ------------------------------------------------------------------
-- In SLICE 16 an unclassified liquid fell back to the 72 oz bucket, which is
-- TIGHTER than the 200 mg carve-out. Falling back was the SAFE direction.
--
-- HERE IT IS THE OPPOSITE. An unflagged suppository is classified `topical`,
-- which maps to the liquid_edible bucket at 2016 g -- a figure so large that a
-- box of suppositories is effectively UNLIMITED. So falling back is the
-- PERMISSIVE direction: a missed flag means the ten-unit limit silently does
-- not apply and we can over-sell.
--
-- A blind copy of the SLICE 16 pattern would therefore have shipped a feature
-- that looks complete and does nothing. The countermeasures are:
--   * the partial review index below, which surfaces unclassified suspects; and
--   * suspectsOtherwiseTaken() in the engine, which raises a NON-BLOCKING
--     warning when a product NAME looks like a suppository but carries no flag.
-- We warn rather than block because a false positive on a name match must
-- never stop a lawful sale.
--
-- WHY A FLAG AND NOT A NEW CATEGORY SLUG
-- --------------------------------------
-- GreenwayCategory is referenced by 16 files -- promotions, daily deals,
-- auto-discount, navigation, the receipt/COGS map, the transform fan-out and
-- the menu browser. Adding a member would change MERCHANDISING, not just
-- compliance. It is also legally wrong: 010(40) defines the class by ROUTE OF
-- ADMINISTRATION, which is a per-product property. One "topical" shelf holds
-- both balms (external application to the skin -> 72 oz) and suppositories
-- (otherwise taken into the body -> 10 units). No single slug can express that
-- split; a per-product boolean can.
--
-- categoryToBucket('topical') is therefore DELIBERATELY UNCHANGED.
--
-- TRACEABILITY: inventory_lots.lot_code (migration 0023) already carries the
-- lot number, so a flagged unit is traceable back to its source invoice with
-- no new column.
--
-- Money: n/a.  Rates: n/a.
-- Apply manually (owner). Idempotent: add column if not exists; safe to re-run.
-- ===========================================================================

-- -- 1) Owner-tunable maxima -------------------------------------------------
-- Whole items, not grams. numeric(10,3) is kept for type-consistency with the
-- sibling limit columns on this table, but the CHECK below pins the values to
-- whole numbers -- you cannot sell two thirds of a suppository, and the engine
-- floors the clamp for the same reason.
alter table public.sales_limit_settings
  add column if not exists rec_otherwise_taken_units numeric(10,3) not null default 10; -- WAC 314-55-095(1)(d)(i)(D)

alter table public.sales_limit_settings
  add column if not exists med_otherwise_taken_units numeric(10,3) not null default 10; -- NOT tripled: absent from WAC 314-55-095(2)(d)

comment on column public.sales_limit_settings.rec_otherwise_taken_units is
  'Recreational single-transaction maximum for products otherwise taken into the body (suppositories), counted in WHOLE UNITS -- not grams, not ounces, not milligrams. Statutory max 10 (WAC 314-55-095(1)(d)(i)(D)). The owner may tighten below 10; the app clamps anything above it.';

comment on column public.sales_limit_settings.med_otherwise_taken_units is
  'Medical (DOH database) maximum for products otherwise taken into the body, in WHOLE UNITS. Statutory max is ALSO 10. WAC 314-55-095(2)(d) does not list this category at all, so there is no authority to raise it for a patient -- unlike usable/solid/concentrate/liquid, this bucket does NOT triple. Do not change to 30.';

do $$
begin
  -- Whole items only, and never negative. A fractional cap would be
  -- unenforceable at the register.
  if not exists (
    select 1 from pg_constraint where conname = 'sales_limit_settings_otherwise_taken_whole'
  ) then
    alter table public.sales_limit_settings
      add constraint sales_limit_settings_otherwise_taken_whole
      check (
        rec_otherwise_taken_units >= 0
        and med_otherwise_taken_units >= 0
        and rec_otherwise_taken_units = floor(rec_otherwise_taken_units)
        and med_otherwise_taken_units = floor(med_otherwise_taken_units)
      );
  end if;
end $$;

-- -- 2) Per-product classification -------------------------------------------
-- otherwise_taken   : explicit intake classification. NULL = not yet reviewed,
--                     which the engine treats as a normal product. Deliberately
--                     NULLABLE with no default so we can tell "nobody has
--                     looked at this yet" apart from "someone looked and said
--                     no" -- the back-office review list keys on exactly that
--                     difference, and given the inverted fail-safe above it is
--                     the difference that keeps us lawful.
-- units_per_package : how many individual consumable items are in one sellable
--                     package, per RCW 69.50.101. A box of six suppositories is
--                     6. NULL/absent means the package IS the unit, i.e. 1.
--                     This is a DIFFERENT FACT from 0138's servings_per_pack:
--                     servings divide a single container by dose, units are
--                     physically separate items. Conflating them is the exact
--                     mistake the owner flagged in SLICE 16.
alter table public.menu_items
  add column if not exists otherwise_taken   boolean;
alter table public.menu_items
  add column if not exists units_per_package numeric(10,3);

alter table public.inventory_lots
  add column if not exists otherwise_taken   boolean;
alter table public.inventory_lots
  add column if not exists units_per_package numeric(10,3);

comment on column public.menu_items.otherwise_taken is
  'SLICE 17. TRUE when this product is "otherwise taken into the body" per WAC 314-55-010(40) -- consumed by a route other than inhalation, oral ingestion, or external application to the skin. In practice: suppositories. TRUE moves the line out of the 72 oz liquid bucket and into the 10 UNIT bucket (WAC 314-55-095(1)(d)(i)(D)). NULL = not yet reviewed; the engine treats NULL as a normal product, which for a suppository is the PERMISSIVE direction -- hence the review index and the name-based warning. Set at intake from the label/invoice.';

comment on column public.menu_items.units_per_package is
  'SLICE 17. Count of individual consumable items in one sellable package, per RCW 69.50.101 ("unit" / "package"). A box of six suppositories is 6. NULL means the package is a single unit. NOT the same as servings_per_pack -- servings divide one container by dose; units are physically separate items.';

comment on column public.inventory_lots.otherwise_taken is
  'SLICE 17. See menu_items.otherwise_taken. Traceable to the source invoice via lot_code.';

comment on column public.inventory_lots.units_per_package is
  'SLICE 17. Count of individual consumable items in one sellable package. See menu_items.units_per_package.';

-- Guard rails. Note there is deliberately NO per-unit potency ceiling here:
-- unlike the low-THC carve-out, WAC 314-55-095(1)(d)(i)(D) sets no mg figure
-- for this category. It counts items, full stop. Inventing a potency condition
-- would be adding a rule the statute does not contain.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'menu_items_units_per_package_valid'
  ) then
    alter table public.menu_items
      add constraint menu_items_units_per_package_valid
      check (units_per_package is null
             or (units_per_package >= 1 and units_per_package = floor(units_per_package)));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'inventory_lots_units_per_package_valid'
  ) then
    alter table public.inventory_lots
      add constraint inventory_lots_units_per_package_valid
      check (units_per_package is null
             or (units_per_package >= 1 and units_per_package = floor(units_per_package)));
  end if;

  -- A row flagged TRUE must declare how many units are in the package,
  -- otherwise we would silently count a box of six as one unit and under-count
  -- the limit by 6x. This is the constraint that makes the flag trustworthy.
  if not exists (
    select 1 from pg_constraint where conname = 'menu_items_otherwise_taken_needs_units'
  ) then
    alter table public.menu_items
      add constraint menu_items_otherwise_taken_needs_units
      check (otherwise_taken is not true or units_per_package is not null);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'inventory_lots_otherwise_taken_needs_units'
  ) then
    alter table public.inventory_lots
      add constraint inventory_lots_otherwise_taken_needs_units
      check (otherwise_taken is not true or units_per_package is not null);
  end if;
end $$;

-- Back-office review list: "products awaiting otherwise-taken classification".
-- Because the fail-safe is inverted, this index is a COMPLIANCE CONTROL, not a
-- convenience. It is restricted to the shelves where a suppository can actually
-- hide (topical/edible), so the reviewer sees a short, actionable list instead
-- of the entire catalogue.
create index if not exists menu_items_otherwise_taken_unreviewed_idx
  on public.menu_items (menu_version_id)
  where otherwise_taken is null;

create index if not exists menu_items_otherwise_taken_flagged_idx
  on public.menu_items (menu_version_id)
  where otherwise_taken is true;

create index if not exists inventory_lots_otherwise_taken_flagged_idx
  on public.inventory_lots (otherwise_taken)
  where otherwise_taken is true;

-- -- 3) order_lines: THE SALE-TIME SNAPSHOT ----------------------------------
--
-- *** THIS SECTION ALSO REPAIRS A DEFECT SHIPPED IN SLICE 16. ***
--
-- src/lib/orders/orders-store.ts writes `low_thc_liquid` and `unit_thc_mg`
-- onto order_lines, and src/lib/orders/order-pricing.ts reads them back at the
-- completion gate. But migration 0216 only added those columns to menu_items
-- and inventory_lots -- NEVER to order_lines. Verified by grepping every
-- `alter table public.order_lines` in supabase/migrations: 0031 (ccrs id),
-- 0096 (category), 0116 (loyalty), 0122 (unit_grams). No low-THC columns.
--
-- The write did not fail loudly, because buildLineRows() sits behind a
-- missing-column ladder that catches error 42703 and retries without the
-- newest fields. So orders placed fine and the snapshot was SILENTLY DROPPED
-- on every single order.
--
-- The consequence is the exact scenario the SLICE 16 code comment warned
-- about, in order-pricing.ts:
--   "WITHOUT THIS the gate would re-evaluate a legal low-THC order as a normal
--    liquid and wrongly block the customer at pickup."
-- A customer could lawfully order 200 mg of low-THC beverage online, and then
-- be refused at pickup because the snapshot that justified the sale was never
-- stored. Adding the columns makes the already-shipped read/write path work as
-- it was written to.
--
-- SLICE 17's own snapshot columns are added alongside, for the same reason and
-- with sharper stakes: because THIS slice's fail-safe is inverted, a dropped
-- otherwise_taken snapshot means the pickup gate re-evaluates a suppository as
-- a 72 oz liquid and does NOT block -- it under-restricts rather than over-
-- restricts. The snapshot is what keeps the sale and the gate agreeing.
--
-- order_lines is an immutable historical record: these are the values AS OF
-- the sale. They are deliberately NOT foreign keys to menu_items, matching the
-- snapshot posture of category (0096) and unit_grams (0122) -- reclassifying a
-- product tomorrow must never retroactively alter yesterday's receipt.
alter table public.order_lines
  add column if not exists low_thc_liquid    boolean;
alter table public.order_lines
  add column if not exists unit_thc_mg       numeric(10,3);
alter table public.order_lines
  add column if not exists otherwise_taken   boolean;
alter table public.order_lines
  add column if not exists units_per_package numeric(10,3);

comment on column public.order_lines.low_thc_liquid is
  'SLICE 16 snapshot, column added in 0217 (0216 omitted it -- the write path existed but silently degraded). TRUE when the line qualified for the 200 mg low-THC bucket AT SALE TIME. Null = legacy or not classified. Never recomputed: the pickup completion gate re-reads this rather than re-deriving it, so a lawful order cannot be blocked later.';

comment on column public.order_lines.unit_thc_mg is
  'SLICE 16 snapshot, column added in 0217. mg active delta-9 THC in one sellable unit as of the sale.';

comment on column public.order_lines.otherwise_taken is
  'SLICE 17 snapshot. TRUE when this line was classified "otherwise taken into the body" (WAC 314-55-010(40)) AT SALE TIME, so it counted against the ten-unit limit of WAC 314-55-095(1)(d)(i)(D). Null = legacy or not classified. Never recomputed.';

comment on column public.order_lines.units_per_package is
  'SLICE 17 snapshot. Individual consumable items per package as of the sale (RCW 69.50.101). A box of six suppositories is 6.';

-- -- 4) sales_limit_events ---------------------------------------------------
-- No change required. `buckets` is jsonb and already stores whatever bucket
-- array the engine produces, so the new otherwise_taken bucket (with its unit
-- denomination and labels) lands in the audit log with no schema change.
