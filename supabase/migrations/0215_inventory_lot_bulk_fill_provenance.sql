-- ===========================================================================
-- 0215_inventory_lot_bulk_fill_provenance.sql
--
-- SLICE 8 (owner-mandated). FILLING WHAT THE ONE-TIME CULTIVERA IMPORT DROPPED.
--
-- Owner request, verbatim:
--   "Those locks are real and intentional for products and we built it that way
--    when we built product intake, where products flow into our system rather
--    than come from Cultivera. Cultivera's data is garbage, and we will need a
--    way to add those fields if they don't exist in the Cultivera data. So I
--    wonder if that means we need to bend the rules specifically for the one
--    time Cultivera upload, and allow me to enter that data the one time and
--    then it respects the locked fields rules that protect my license from
--    compliance issues."
--
-- WHY NO RULE IS ACTUALLY BENT
-- ----------------------------
-- src/lib/inventory/lot-edit-core.ts:33-45 locks expires_on,
-- unit_cost_minor_units and pos_product_key against hand-editing, because those
-- values come from COAs, invoices and manifests. That lock is correct and is
-- NOT relaxed here.
--
-- What this migration supports is different: the one-time Cultivera import
-- never DELIVERED those values for many rows, and the importer recorded that
-- fact at the time. src/lib/pos/import-lot-core.ts:291-302 stamped every
-- migrated lot's notes with:
--
--     "Cultivera migration (one-time POS import)."
--     "COA flag N in POS export - obtain and attach the COA during enrichment."
--     "Expiration date not provided by POS export - set during enrichment."
--
-- The import itself said these fields were blank and would be "set during
-- enrichment". This is that enrichment step. Same doctrine as SLICE 2's
-- received date (src/app/admin/inventory/actions.ts:100-116): a value the
-- export failed to carry is a FACT FROM THE PAPERWORK, and the owner reading it
-- off the document is the most authoritative source available.
--
-- A blank becoming a value is not an evidenced fact being overwritten. Once
-- filled, the value carries provenance and is protected exactly like any other
-- evidenced fact -- the same rule as src/lib/inventory/reprocess-core.ts:16-18.
--
-- IDEMPOTENT (Rule 6): every statement is add-column-if-not-exists / guarded DO
-- block / create-index-if-not-exists. Safe to re-run. The owner applies this
-- MANUALLY in the Supabase SQL editor.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Provenance columns, one trio per fillable field
--    (shape copied from 0214_inventory_lot_received_date.sql:41-45)
--
--    We do NOT add a "value" column -- the values live in the existing
--    expires_on / unit_cost_minor_units / pos_product_key columns. What was
--    missing was the ability to say WHERE a value came from and WHO put it
--    there, which is what makes an owner-entered value auditable evidence
--    rather than an unexplained edit (standing rule 3).
-- ---------------------------------------------------------------------------
alter table public.inventory_lots
  add column if not exists expires_on_source          text,
  add column if not exists expires_on_set_by          uuid references public.staff_profiles(id) on delete set null,
  add column if not exists expires_on_set_at          timestamptz,
  add column if not exists unit_cost_source           text,
  add column if not exists unit_cost_set_by           uuid references public.staff_profiles(id) on delete set null,
  add column if not exists unit_cost_set_at           timestamptz,
  add column if not exists pos_product_key_source     text,
  add column if not exists pos_product_key_set_by     uuid references public.staff_profiles(id) on delete set null,
  add column if not exists pos_product_key_set_at     timestamptz;

comment on column public.inventory_lots.expires_on_source is
  'Where expires_on came from: pos_import (read from the Cultivera export) | coa (from the certificate of analysis) | owner_entered (typed from the physical package or paperwork during the one-time migration enrichment). NULL means the value predates provenance tracking. Provenance is itself evidence (standing rule 3).';

comment on column public.inventory_lots.unit_cost_source is
  'Where unit_cost_minor_units came from: pos_import | invoice | owner_entered. Cost is in MINOR UNITS (standing rule 7).';

comment on column public.inventory_lots.pos_product_key_source is
  'Where pos_product_key came from: pos_import | owner_entered. This is a catalog link, not a CCRS-reported number.';

-- ---------------------------------------------------------------------------
-- 2. Guard the provenance vocabulary
--    (pattern copied from 0214:63-75, itself from 0059:49-58)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_lots_expires_on_source_chk'
  ) then
    alter table public.inventory_lots
      add constraint inventory_lots_expires_on_source_chk
      check (
        expires_on_source is null
        or expires_on_source in ('pos_import', 'coa', 'owner_entered')
      );
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_lots_unit_cost_source_chk'
  ) then
    alter table public.inventory_lots
      add constraint inventory_lots_unit_cost_source_chk
      check (
        unit_cost_source is null
        or unit_cost_source in ('pos_import', 'invoice', 'owner_entered')
      );
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_lots_pos_product_key_source_chk'
  ) then
    alter table public.inventory_lots
      add constraint inventory_lots_pos_product_key_source_chk
      check (
        pos_product_key_source is null
        or pos_product_key_source in ('pos_import', 'owner_entered')
      );
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 3. Refuse impossible expiry dates AT THE DATABASE
--
--    The app validates through src/lib/inventory/bulk-fill-core.ts, but a
--    constraint is the only thing that also binds a hand-run SQL statement or a
--    future importer (same reasoning as 0214:77-91).
--
--    NOT-NULL-SAFE: the check passes for NULL, so the ~thousands of lots that
--    legitimately have no expiry are untouched and the migration cannot fail on
--    existing data.
--
--    Bound: not before WA legal retail cannabis began (2014-07-08, verified in
--    0214:83-86). Unlike a received date, an expiry may legitimately be in the
--    FUTURE, so there is no upper bound here beyond the app's typo ceiling.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_lots_expires_on_sane_chk'
  ) then
    -- Only add the constraint if no existing row would violate it, so applying
    -- this migration can never fail on data we did not create.
    if not exists (
      select 1 from public.inventory_lots
       where expires_on is not null and expires_on < date '2014-07-08'
    ) then
      alter table public.inventory_lots
        add constraint inventory_lots_expires_on_sane_chk
        check (expires_on is null or expires_on >= date '2014-07-08');
    end if;
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 4. Refuse negative unit costs AT THE DATABASE
--
--    Zero is legal and meaningful (a genuine free sample is a KNOWN cost of
--    zero -- bulk-fill-core treats 0 as a known value and refuses to overwrite
--    it). Negative is not a cost.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_lots_unit_cost_nonneg_chk'
  ) then
    if not exists (
      select 1 from public.inventory_lots where unit_cost_minor_units < 0
    ) then
      alter table public.inventory_lots
        add constraint inventory_lots_unit_cost_nonneg_chk
        check (unit_cost_minor_units is null or unit_cost_minor_units >= 0);
    end if;
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 5. Index the hot path: "which migrated lots still need enrichment?"
--    NULLS FIRST mirrors 0214:149-150 -- the unknown rows are the ones the
--    worklist asks for on every page load.
-- ---------------------------------------------------------------------------
create index if not exists inventory_lots_expires_on_idx
  on public.inventory_lots (expires_on nulls first);

create index if not exists inventory_lots_unit_cost_idx
  on public.inventory_lots (unit_cost_minor_units nulls first);

-- ---------------------------------------------------------------------------
-- 6. What the owner should see after applying this
--
--    These are READS -- they change nothing. Run them to confirm the shape of
--    the work before doing any of it.
--
--      -- migrated lots still missing an expiry
--      select count(*) from public.inventory_lots
--       where notes like 'Cultivera migration (one-time POS import).%'
--         and expires_on is null and status <> 'destroyed';
--
--      -- migrated lots still missing a unit cost
--      select count(*) from public.inventory_lots
--       where notes like 'Cultivera migration (one-time POS import).%'
--         and unit_cost_minor_units is null and status <> 'destroyed';
--
--      -- migrated lots still missing a catalog link
--      select count(*) from public.inventory_lots
--       where notes like 'Cultivera migration (one-time POS import).%'
--         and coalesce(pos_product_key, '') = '' and status <> 'destroyed';
--
--    NOTE: this sandbox has no database credentials, so these counts have NOT
--    been measured here and no number is asserted (standing rule: never guess).
--    Run them yourself; the Bulk fill screen shows the same counts live.
-- ---------------------------------------------------------------------------
