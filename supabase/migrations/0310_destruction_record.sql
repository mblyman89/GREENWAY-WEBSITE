-- 0310_destruction_record.sql  (Fix Phase 1.6a · G-43 · F-15-4, F-15-5, F-15-12, F-15-21)
--
-- WHY. The destruction record let the witness be blank, had no camera field
-- and accepted "Other method" without the LCB's prior approval (F-15-4,
-- F-15-21). The owner (D64): "anyone may witness the destruction. It has to
-- be done on camera as well." WAC 314-55-097 requires the record of
-- destruction be kept five years; WAC 314-55-083(3)(a) camera coverage.
--
-- WHAT. Columns on destruction_events for the hardened record:
--   witness_employee_id        the witness, chosen from public.employees
--                              (never the person completing; checked in the app)
--   witness_name               the witness's name at completion
--   camera_name                the camera that recorded the destruction
--   camera_start_at / _end_at  when, so the footage can be found
--   other_method_approval_ref  the LCB's prior written approval for
--   other_method_approval_date "Other method" (WAC 314-55-097)
--
-- The quantity check at scheduling (F-15-12) and Pacific times (F-15-5) are
-- app rules and need no schema.
--
-- SAFE / IDEMPOTENT: add column if not exists only; no data is changed.
-- Apply MANUALLY in the SQL editor after 0309. Before it is applied the app
-- still requires the witness and camera, and keeps them in witnessed_by.

alter table public.destruction_events
  add column if not exists witness_employee_id uuid references public.employees (id) on delete set null,
  add column if not exists witness_name text,
  add column if not exists camera_name text,
  add column if not exists camera_start_at timestamptz,
  add column if not exists camera_end_at timestamptz,
  add column if not exists other_method_approval_ref text,
  add column if not exists other_method_approval_date date;

comment on column public.destruction_events.witness_employee_id is
  'Fix Phase 1.6a (G-43; D64): the second person who watched the destruction, from the staff roster; never the person completing.';
comment on column public.destruction_events.camera_name is
  'Fix Phase 1.6a (G-43; D64; WAC 314-55-083(3)(a)): the camera that recorded the destruction. With camera_start_at and camera_end_at.';
comment on column public.destruction_events.other_method_approval_ref is
  'Fix Phase 1.6a (G-43 req 3; WAC 314-55-097): the LCB''s prior written approval for a method other than grind and mix.';
