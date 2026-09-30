-- ===========================================================================
-- 0241_inventory_lot_pos_potency.sql
--
-- R15a (owner-requested). CULTIVERA POTENCY REACHES THE INVENTORY TABLE.
--
-- Owner request, verbatim:
--   "I have noticed in the inventory table for the cultivera products
--    uploaded, that the receive date and the thc/ cbd/ cbn/ cbc cannabinoid
--    columns are blank even though the data exists in the cultivera
--    spreadsheets. the menu shows the thc and cbd numbers on their cards."
--
-- WHY NEW COLUMNS, NOT A lab_results ROW
-- --------------------------------------
-- The inventory table's THC column read lab_results.total_thc_pct, and the
-- COA column shows a check mark whenever a lot has ANY lab_results row
-- (src/app/admin/inventory/page.tsx). Writing the POS export's numbers as a
-- lab_results row would therefore claim a Certificate of Analysis is on file
-- when none is. The POS figures are a different fact with a different source,
-- so they get their own columns and the app shows COA numbers first, POS
-- numbers second (src/lib/pos/lot-potency-core.ts lotThcValue).
--
-- CBN / CBC: the Cultivera INVENTORIES export has NO columns for them
-- (verified on the real header row). Name-verified minor cannabinoids already
-- have a home: inventory_lots.minor_cannabinoids_json (migration 0138).
--
-- IDEMPOTENT: add-column-if-not-exists / guarded constraint. Safe to re-run.
-- Owner applies MANUALLY in the Supabase SQL editor. The app degrades
-- gracefully before it is applied (the import retries without these columns,
-- the table falls back to the COA numbers only).
-- ===========================================================================

alter table public.inventory_lots
  add column if not exists pos_thc              numeric,
  add column if not exists pos_thca             numeric,
  add column if not exists pos_cbd              numeric,
  add column if not exists pos_cbda             numeric,
  add column if not exists pos_potency_unit     text,
  add column if not exists pos_potency_set_at   timestamptz;

comment on column public.inventory_lots.pos_thc is
  'THC as stated by the Cultivera POS export (Total column, Thc sibling when Total is corrupt; mg-dosed types prefer a name-verified package total). NOT a COA: lab_results remains the certificate of record and outranks this in every display.';
comment on column public.inventory_lots.pos_cbd is
  'CBD as stated by the Cultivera POS export (Cbd column, Cbda sibling). NOT a COA.';
comment on column public.inventory_lots.pos_potency_unit is
  'Unit for pos_* values: % for percent-dosed LCB types, mg for Solid/Liquid Edible, Tincture, Topical Ointment.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_lots_pos_potency_unit_chk') then
    alter table public.inventory_lots
      add constraint inventory_lots_pos_potency_unit_chk
      check (pos_potency_unit is null or pos_potency_unit in ('%', 'mg'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_lots_pos_potency_sane_chk') then
    alter table public.inventory_lots
      add constraint inventory_lots_pos_potency_sane_chk
      check (
        (pos_thc  is null or pos_thc  >= 0) and
        (pos_thca is null or pos_thca >= 0) and
        (pos_cbd  is null or pos_cbd  >= 0) and
        (pos_cbda is null or pos_cbda >= 0)
      );
  end if;
end$$;

-- Ask PostgREST to pick up the new columns immediately.
notify pgrst, 'reload schema';
