-- 0059_intake_lot_disposition.sql — CCRS-compliant partial acceptance / reject-at-dock.
--
-- RESEARCH-GROUNDED (docs/ccrs-rejection-and-returns.md):
--   The owner rejects inbound product by having the driver take it back at the
--   dock. Refused product NEVER enters our reported Inventory.csv, so we file
--   NOTHING with CCRS and NEVER auto-destroy it. The manifest belongs to the
--   ORIGIN (vendor); the vendor corrects their own CCRS record via the manifest
--   `Update`/`Delete` operations (Feb 26 2026 CIB140 Manifest Guide). This
--   migration therefore adds a LOCAL per-lot disposition + reason so an employee
--   can accept part of a manifest and reject the rest, and so the manifest can
--   carry a derived `partially_accepted` state + badge.
--
-- What this replaces: the old whole-manifest reject set every quarantine lot to
--   status `destroyed`. That was wrong for a normal vendor rejection. Refused
--   lots now become status `rejected` (never received, never destroyed).
--
-- Idempotent (safe to re-run). Run manually in the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- Per-lot disposition on inventory_lots
-- ---------------------------------------------------------------------------
-- disposition: NULL/'pending' (awaiting decision) | 'accepted' | 'rejected_at_dock'
-- When 'rejected_at_dock', the lot's lifecycle status is set to 'rejected' by
-- app logic and it is never activated into sellable inventory.
alter table public.inventory_lots
  add column if not exists disposition text;

alter table public.inventory_lots
  add column if not exists reject_reason text;

alter table public.inventory_lots
  add column if not exists reject_reason_code text;

alter table public.inventory_lots
  add column if not exists dispositioned_by uuid references public.staff_profiles(id) on delete set null;

alter table public.inventory_lots
  add column if not exists dispositioned_at timestamptz;

-- Backfill: any lot already active/sold_out is implicitly an accepted lot; any
-- lot previously destroyed by the old reject path we leave as-is (do not rewrite
-- history), but mark its disposition so the UI is consistent.
update public.inventory_lots
  set disposition = 'accepted'
  where disposition is null
    and status in ('active', 'sold_out', 'recalled');

-- A soft guard: only allow the known disposition values (NULL allowed = pending).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_lots_disposition_chk'
  ) then
    alter table public.inventory_lots
      add constraint inventory_lots_disposition_chk
      check (disposition is null or disposition in ('pending', 'accepted', 'rejected_at_dock'));
  end if;
end$$;

create index if not exists inventory_lots_disposition_idx
  on public.inventory_lots (disposition);

-- ---------------------------------------------------------------------------
-- Manifest-level rollups (denormalized for fast list rendering + the badge).
-- Kept in sync by app logic on accept/reject. `status` may now also be
-- 'partially_accepted' (no CHECK constraint exists on that column, so no schema
-- change is needed there — this is documentation of the new allowed value).
-- ---------------------------------------------------------------------------
alter table public.inbound_manifests
  add column if not exists accepted_lot_count integer not null default 0;

alter table public.inbound_manifests
  add column if not exists rejected_lot_count integer not null default 0;

-- Allowed inbound_manifests.status values (for reference, not enforced):
--   pending | in_transit | received | accepted | rejected | partially_accepted
