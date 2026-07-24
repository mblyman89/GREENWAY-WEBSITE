-- ============================================================================
-- 0136_handbook_acknowledgments.sql  (SLICE 36)
--
-- Digital handbook acknowledgments: every staff member must READ the employee
-- handbook and record an acknowledgment (a checked box, per person and per
-- handbook VERSION) BEFORE they get access to the back office or the register
-- (owner directive). One row per (staff user, version). The gate lives in
-- src/lib/staffing/handbook-ack-core.ts + handbook-ack-store.ts:
--   * back office: the admin layout redirects unacknowledged staff to
--     /admin/handbook until they acknowledge the CURRENT version;
--   * register: /api/pos/unlock refuses the PIN unlock until the employee's
--     linked staff account (or their manager, for PIN-only employees) has
--     recorded the acknowledgment.
-- Owners are exempt (they WROTE the policies and can never be locked out of
-- their own store — same principle as user-guards-core.ts).
--
-- APPLY MANUALLY in the Supabase SQL editor (standing owner rule).
-- ============================================================================

create table if not exists public.handbook_acknowledgments (
  id               uuid primary key default gen_random_uuid(),
  -- The staff account that read + acknowledged (auth user id).
  staff_id         uuid not null references public.staff_profiles(id) on delete cascade,
  -- Handbook version acknowledged (HANDBOOK_VERSION at the time, e.g. '2.0').
  version          text not null,
  -- Full name typed/confirmed at acknowledgment time (evidence quality).
  acknowledged_name text,
  acknowledged_at  timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  -- One acknowledgment per person per version (re-acks of the same version
  -- are no-ops, not duplicates).
  unique (staff_id, version)
);

create index if not exists handbook_acknowledgments_staff_idx
  on public.handbook_acknowledgments (staff_id, version);

comment on table public.handbook_acknowledgments is
  'Per-staff, per-version employee-handbook acknowledgments. Staff without a row for the CURRENT version are blocked from the back office and the register (SLICE 36). Retained like all employee records (WAC 314-55-087(1)(e), 5 years).';

-- RLS (GW-019 discipline: every table gets RLS + explicit policies).
alter table public.handbook_acknowledgments enable row level security;

-- Staff can read acknowledgments (the roster shows who has/hasn't signed).
drop policy if exists handbook_acknowledgments_staff_read on public.handbook_acknowledgments;
create policy handbook_acknowledgments_staff_read on public.handbook_acknowledgments
  for select using (public.is_staff());

-- Staff may insert ONLY their own acknowledgment — you cannot check the box
-- for someone else. (Updates/deletes are not granted to anyone but the
-- service role: an acknowledgment, once recorded, is evidence.)
drop policy if exists handbook_acknowledgments_self_insert on public.handbook_acknowledgments;
create policy handbook_acknowledgments_self_insert on public.handbook_acknowledgments
  for insert with check (public.is_staff() and staff_id = auth.uid());
