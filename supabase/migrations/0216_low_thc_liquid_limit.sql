-- ===========================================================================
-- 0216_low_thc_liquid_limit.sql
--
-- SLICE 16 -- the low-THC beverage transaction limit.
--
-- Owner request, verbatim:
--   "There are liquid infused edibles that follow a separate limit, low thc
--    beverages... The rules as I understand them are, one can is one unit, and
--    a 4 pack of cans is 4 units. So a 4 pack would qualify, the budtender
--    would scan each can in the pack. A single product that has 16 mg in total,
--    even if it says the dose is 4, 4 mg servings does not qualify. Every
--    product has a lot number for traceability... Please make sure you add the
--    limit settings and whatever else the system already has built so it lives
--    with the other limits and has all the same features the other limits have."
--
-- THE LAW
-- -------
-- WAC 314-55-095(1)(d)(i), verbatim:
--   (E) Seventy-two ounces of cannabis-infused product in liquid form for oral
--       ingestion or applied topically to the skin, UNLESS the product is
--       packaged in individual units containing no more than four milligrams
--       of active delta-9 THC per unit; and
--   (F) Two hundred mg of active delta-9 THC within a cannabis-infused product
--       in liquid form if the product is packaged in individual units
--       containing no more than four milligrams of active delta-9 THC per unit.
--
-- Mirrored at RCW 69.50.360(3)(c)+(d), as amended by 2024 c 9 s 1 (SHB 1249).
--
-- WAC 314-55-095(2)(d) gives the medical (DOH database) figures. Note that it
-- ends "...and up to 200 mg of active delta-9 THC..." -- the SAME 200 mg. Every
-- other bucket triples for a medical patient; THIS ONE DOES NOT. The defaults
-- below therefore deliberately match. Do not "fix" med to 600.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1) sales_limit_settings: two new owner-tunable maxima, in MILLIGRAMS OF
--    ACTIVE DELTA-9 THC. Every other limit column on this table is in GRAMS,
--    so the column names carry the unit explicitly (`_thc_mg`) to make a
--    mistaken unit conversion hard to write by accident.
--
-- 2) menu_items + inventory_lots: the per-product classification that decides
--    whether a liquid is carved out of the 72 oz bucket and into the 200 mg
--    bucket.
--
-- WHY AN EXPLICIT FLAG AND NOT A COMPUTATION
-- ------------------------------------------
-- Migration 0138 already gives us mg_per_serving, servings_per_pack and
-- package_thc_mg. It is tempting to derive the flag as
-- `mg_per_serving <= 4`. That is WRONG and the owner called it out directly:
-- a single 16 mg bottle labelled "4 servings x 4 mg" would compute 4 and
-- wrongly qualify. The statute keys on how the product is PACKAGED IN
-- INDIVIDUAL UNITS, not how the label divides a container into servings.
--
-- So the trigger is an explicit boolean set at intake from the label/invoice,
-- plus the per-UNIT mg figure. A liquid with no classification is treated as a
-- NORMAL liquid (the 72 oz bucket), which is the fail-safe direction: an
-- unclassified product can only ever be OVER-restricted, never under.
--
-- TRACEABILITY: inventory_lots.lot_code (migration 0023) already carries the
-- lot number the owner referenced, so a flagged unit is traceable back to the
-- invoice it was intaken from without any new column.
--
-- Money: n/a.  Rates: n/a.
-- Apply manually (owner). Idempotent: add column if not exists; safe to re-run.
-- ===========================================================================

-- -- 1) Owner-tunable maxima -------------------------------------------------
-- numeric(10,3) matches the existing limit columns on this table.
-- NOT NULL + default 200 so a row that predates this migration reads as the
-- statutory figure rather than NULL.
alter table public.sales_limit_settings
  add column if not exists rec_low_thc_liquid_thc_mg numeric(10,3) not null default 200; -- WAC 314-55-095(1)(d)(i)(F)

alter table public.sales_limit_settings
  add column if not exists med_low_thc_liquid_thc_mg numeric(10,3) not null default 200; -- WAC 314-55-095(2)(d) -- NOT tripled

comment on column public.sales_limit_settings.rec_low_thc_liquid_thc_mg is
  'Recreational single-transaction maximum for low-THC liquids, in MILLIGRAMS of active delta-9 THC (not grams, not ounces). Statutory max 200 (WAC 314-55-095(1)(d)(i)(F)). The owner may tighten below 200; the app clamps anything above it.';

comment on column public.sales_limit_settings.med_low_thc_liquid_thc_mg is
  'Medical (DOH database) maximum for low-THC liquids, in MILLIGRAMS of active delta-9 THC. Statutory max is ALSO 200 -- WAC 314-55-095(2)(d) says "and up to 200 mg". Unlike every other bucket this one does NOT triple for medical patients.';

-- -- 2) Per-product classification -------------------------------------------
-- low_thc_liquid : explicit intake classification. NULL = not yet classified,
--                  which the engine treats as a normal liquid (fail-safe).
--                  Deliberately NULLABLE with no default: we must be able to
--                  tell "nobody has looked at this yet" apart from "someone
--                  looked and said no". The back-office review list keys on it.
-- unit_thc_mg    : active delta-9 THC in ONE INDIVIDUAL SELLABLE UNIT (one can,
--                  one bottle) -- NOT per serving, NOT per package. For a
--                  4-pack of 4 mg cans this is 4, and the pack counts as four
--                  units. This is a DIFFERENT FACT from 0138's mg_per_serving
--                  and package_thc_mg, which is exactly why it gets its own
--                  column instead of being inferred from either.
alter table public.menu_items
  add column if not exists low_thc_liquid boolean;
alter table public.menu_items
  add column if not exists unit_thc_mg    numeric(10,3);

alter table public.inventory_lots
  add column if not exists low_thc_liquid boolean;
alter table public.inventory_lots
  add column if not exists unit_thc_mg    numeric(10,3);

comment on column public.menu_items.low_thc_liquid is
  'SLICE 16. TRUE when this liquid is packaged in individual units of no more than 4 mg active delta-9 THC, so it counts against the 200 mg bucket instead of the 72 oz bucket (WAC 314-55-095(1)(d)(i)(E) "unless"). NULL = not yet classified; the engine treats NULL as a normal liquid. Set at intake from the label/invoice -- never derived from servings x mg-per-serving, which is wrong for multi-serving single containers.';

comment on column public.menu_items.unit_thc_mg is
  'SLICE 16. Active delta-9 THC in ONE INDIVIDUAL SELLABLE UNIT (one can), in mg. Not per serving, not per package.';

comment on column public.inventory_lots.low_thc_liquid is
  'SLICE 16. See menu_items.low_thc_liquid. Traceable to the source invoice via lot_code.';

comment on column public.inventory_lots.unit_thc_mg is
  'SLICE 16. Active delta-9 THC in ONE INDIVIDUAL SELLABLE UNIT (one can), in mg.';

-- Guard rails: a classified low-THC unit cannot exceed the statutory 4 mg
-- per-unit ceiling, and mg is never negative. Written as NOT VALID-free simple
-- CHECKs because the columns are brand new and therefore empty.
-- Wrapped so re-running the file does not error on an existing constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'menu_items_unit_thc_mg_nonneg'
  ) then
    alter table public.menu_items
      add constraint menu_items_unit_thc_mg_nonneg
      check (unit_thc_mg is null or unit_thc_mg >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'inventory_lots_unit_thc_mg_nonneg'
  ) then
    alter table public.inventory_lots
      add constraint inventory_lots_unit_thc_mg_nonneg
      check (unit_thc_mg is null or unit_thc_mg >= 0);
  end if;

  -- A row flagged TRUE must carry a per-unit figure at or under 4 mg,
  -- otherwise the flag is meaningless and the engine would silently ignore it.
  if not exists (
    select 1 from pg_constraint where conname = 'menu_items_low_thc_unit_ceiling'
  ) then
    alter table public.menu_items
      add constraint menu_items_low_thc_unit_ceiling
      check (low_thc_liquid is not true or (unit_thc_mg is not null and unit_thc_mg > 0 and unit_thc_mg <= 4));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'inventory_lots_low_thc_unit_ceiling'
  ) then
    alter table public.inventory_lots
      add constraint inventory_lots_low_thc_unit_ceiling
      check (low_thc_liquid is not true or (unit_thc_mg is not null and unit_thc_mg > 0 and unit_thc_mg <= 4));
  end if;
end $$;

-- Back-office review list: "liquids awaiting low-THC classification".
-- Partial index keeps it tiny -- it only covers the unclassified rows.
create index if not exists menu_items_low_thc_unclassified_idx
  on public.menu_items (menu_version_id)
  where low_thc_liquid is null;

create index if not exists inventory_lots_low_thc_flagged_idx
  on public.inventory_lots (low_thc_liquid)
  where low_thc_liquid is true;

-- -- 3) sales_limit_events ---------------------------------------------------
-- No change required. `buckets` is jsonb and already stores whatever bucket
-- array the engine produces, so the new low_thc_liquid bucket (with its mg
-- unit and labels) lands in the audit log with no schema change.
