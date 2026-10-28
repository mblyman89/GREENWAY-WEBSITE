-- 0307_destruction_previous_lot_status.sql  (Fix Phase 1.3 · G-28 · F-05a-19, F-15-9, F-15-11)
--
-- WHY. Cancelling a destruction used to set the lot Active whatever it was
-- before, any manager could do it, and no reason was kept. A destruction now
-- remembers the lot's status before scheduling, and a cancel keeps the
-- owner's reason and who/when:
--   previous_lot_status  'active' | 'quarantine' (null: the event never moved the lot)
--   lot_status_touched   false for a customer-return unit (the lot is never touched)
--   cancel_reason, cancelled_by, cancelled_at
--
-- SAFE / IDEMPOTENT: add column if not exists only. Nothing is written.
-- Apply MANUALLY in the SQL editor. Before it is applied the app still works:
-- scheduling saves without the remembered status, and a later cancel then
-- leaves the lot as it is (never guesses Active); the reason is kept in the
-- Security Log.

begin;

alter table public.destruction_events
  add column if not exists previous_lot_status text,
  add column if not exists lot_status_touched  boolean,
  add column if not exists cancel_reason       text,
  add column if not exists cancelled_by        uuid references public.staff_profiles(id) on delete set null,
  add column if not exists cancelled_at        timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'destruction_events_previous_lot_status_chk'
  ) then
    alter table public.destruction_events
      add constraint destruction_events_previous_lot_status_chk
      check (previous_lot_status is null or previous_lot_status in ('active', 'quarantine'));
  end if;
end $$;

comment on column public.destruction_events.previous_lot_status is
  'Lot status before scheduling (active | quarantine). Cancel / partial completion restores Active only if it was Active. Recalled lots are never scheduled (D65). Phase 1.3 (G-28).';

commit;
