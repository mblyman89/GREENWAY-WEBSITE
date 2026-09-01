-- ===========================================================================
-- 0214_inventory_lot_received_date.sql
--
-- SLICE 2 (owner-mandated). THE RECEIVED DATE BECOMES A FACT.
--
-- Owner request, verbatim:
--   "For lots that don't have a receive date, I want them flagged for me to
--    add one, if that's not already something I can do. Please go above and
--    beyond for me as this is a compliance issue and we can't be breaking
--    the rules."
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- inventory_lots never had a received date column. The Cultivera importer read
-- the Received date out of the POS export, used it to derive created_at, wrote
-- it into the human-readable `notes` line, and then threw the fact away.
--
-- That mattered because CCRS Inventory.CreatedDate is generated from
-- inventory_lots.created_at (src/lib/compliance/ccrs-batch.ts:388). For the
-- lots whose POS export had a BLANK Received date, created_at is the instant we
-- ran the import — so those rows would tell the WA LCB the lot was created on
-- migration day. That is a date nobody can evidence sitting in a state
-- traceability filing.
--
-- THE PRECEDENT WE ARE FOLLOWING (0191_inventory_audit.sql:105-118)
-- -----------------------------------------------------------------
-- last_counted_at is NULLABLE ON PURPOSE, because "a lot that has never been
-- counted must READ as never counted until somebody counts it." Same doctrine
-- here: a lot whose receipt date is unknown must READ as unknown until a human
-- supplies it. We do NOT default received_on to created_at, to now(), or to
-- anything else. NULL is the flag, and the flag is the point.
--
-- IDEMPOTENT (Rule 6): every statement is add-column-if-not-exists / guarded
-- DO block / create-index-if-not-exists. Safe to re-run. The owner applies
-- this MANUALLY in the Supabase SQL editor.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------
alter table public.inventory_lots
  add column if not exists received_on         date,
  add column if not exists received_on_source  text,
  add column if not exists received_on_set_by  uuid references public.staff_profiles(id) on delete set null,
  add column if not exists received_on_set_at  timestamptz;

comment on column public.inventory_lots.received_on is
  'The calendar day this lot was physically received (Pacific). NULL means UNKNOWN and must never be backfilled to a date on which no receipt is evidenced — it is the flag that puts the lot on the owner''s worklist. Distinct from created_at, which is the immutable row-birth timestamp FIFO costing is ordered by. Basis: same doctrine as 0191.last_counted_at; WAC 314-55-087 recordkeeping.';

comment on column public.inventory_lots.received_on_source is
  'Where received_on came from: pos_import (read from the Cultivera export) | manifest (inbound transfer) | owner_entered (typed from the paper record). Provenance is itself evidence — it distinguishes a machine-read date from a human-asserted one (standing rule 3).';

comment on column public.inventory_lots.received_on_set_by is
  'Staff member who last set received_on. NULL for machine-derived values.';

comment on column public.inventory_lots.received_on_set_at is
  'When received_on was last set.';

-- ---------------------------------------------------------------------------
-- 2. Guard the provenance vocabulary
--    (pattern copied from 0059_intake_lot_disposition.sql:49-58)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_lots_received_on_source_chk'
  ) then
    alter table public.inventory_lots
      add constraint inventory_lots_received_on_source_chk
      check (
        received_on_source is null
        or received_on_source in ('pos_import', 'manifest', 'owner_entered')
      );
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 3. Refuse impossible dates AT THE DATABASE, not just in the form
--
--    The app validates through src/lib/inventory/received-date-core.ts, but a
--    constraint is the only thing that also binds a hand-run SQL statement, a
--    future importer, or a bulk fix typed at 11pm. Two rules:
--      * not before 2014-07-08 — WA legal retail cannabis sales began that day
--        (verified: University of Washington ADAI, citing WA LCB,
--        https://adai.washington.edu/WAdata/marijuana.htm). This is a typo
--        guard, not a business rule.
--      * not in the future — you cannot have received tomorrow's delivery.
--        Compared against the PACIFIC calendar day (standing rule 8): a plain
--        current_date is UTC on this host and would wrongly reject a genuine
--        same-day receipt entered after ~4pm Pacific.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_lots_received_on_sane_chk'
  ) then
    alter table public.inventory_lots
      add constraint inventory_lots_received_on_sane_chk
      check (
        received_on is null
        or (
          received_on >= date '2014-07-08'
          and received_on <= ((now() at time zone 'America/Los_Angeles')::date + 1)
        )
      );
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 4. Evidence-based backfill — recover ONLY what the importer actually recorded
--
--    import-lot-core.ts `lotNote()` (line 293) wrote one of exactly two things
--    into inventory_lots.notes at import time:
--
--        "Received 2026-06-17."                     <- the export HAD a date
--        "Received date missing in POS export."     <- it did NOT
--
--    The first is a contemporaneous record of a value read out of the owner's
--    own POS export. Recovering it is restoring a fact we already had, not
--    inventing one. The second recovers NOTHING and the lot stays flagged.
--
--    This is deliberately the ONLY automatic path. We never derive received_on
--    from created_at, because for the undated lots created_at IS the import
--    instant — deriving from it would manufacture exactly the fiction this
--    migration exists to prevent.
--
--    The TypeScript twin is extractReceivedOnFromNote() in
--    src/lib/inventory/received-date-core.ts, and its self-tests pin both to
--    the same behaviour.
--
--    Guarded by `received_on is null` so re-running never overwrites a value
--    the owner has since corrected by hand.
-- ---------------------------------------------------------------------------
update public.inventory_lots
   set received_on        = (substring(notes from 'Received (\d{4}-\d{2}-\d{2})\.'))::date,
       received_on_source = 'pos_import',
       received_on_set_at = now()
 where received_on is null
   and notes ~ 'Received \d{4}-\d{2}-\d{2}\.'
   and (substring(notes from 'Received (\d{4}-\d{2}-\d{2})\.'))::date >= date '2014-07-08'
   and (substring(notes from 'Received (\d{4}-\d{2}-\d{2})\.'))::date
       <= ((now() at time zone 'America/Los_Angeles')::date + 1);

-- ---------------------------------------------------------------------------
-- 5. Index the hot path: "what still needs a received date?"
--    NULLS FIRST mirrors 0191's inventory_lots_last_counted_idx — the unknown
--    rows are the ones the worklist asks for on every page load.
-- ---------------------------------------------------------------------------
create index if not exists inventory_lots_received_on_idx
  on public.inventory_lots (received_on nulls first);

-- ---------------------------------------------------------------------------
-- 6. What the owner should see after applying this
--
--    Counts (run these to confirm; they are reads, nothing is changed):
--
--      -- how many lots still need a received date
--      select count(*) from public.inventory_lots
--       where received_on is null and status <> 'destroyed';
--
--      -- how many were recovered from the importer's own note
--      select count(*) from public.inventory_lots
--       where received_on_source = 'pos_import';
--
--    Expectation from the forensic audit of the Cultivera export: ~3,977 lots
--    recover their date from the note, and ~202 remain NULL — those are the
--    rows whose POS export genuinely had a blank Received date. Those 202 are
--    what the new worklist flags for the owner at
--    /admin/inventory?needsReceivedDate=1.
-- ---------------------------------------------------------------------------
