-- =============================================================================
-- 0037_staffing_timeclock.sql  (Run 6 / Slice 25)
--
-- WORKFORCE + TIME CLOCK foundation (Feature M, part 1).
--
-- Owner (Q4): "I also want my employees to clock in and clock out that matches
-- the drawer assignment." Slice 26 ties registers/drawers to these shifts; this
-- slice builds the people + shift + punch foundation a professional solution has.
--
-- Design:
--   * employees            -- the workforce roster. An employee may NOT have an
--                             admin auth login (e.g. a budtender who only clocks
--                             in), so this is its OWN table with an OPTIONAL link
--                             to staff_profiles for those who also administer.
--                             A short numeric PIN lets floor staff clock in at a
--                             shared station without an email/password login.
--   * shifts               -- a scheduled or open work shift for one employee,
--                             with a role (sales / manager) that Slice 26 uses to
--                             decide drawer vs. manager-till assignment.
--   * time_punches         -- clock in/out + breaks, linked to a shift. The
--                             open punch (clock_out_at IS NULL) is the live one.
--
-- All timestamps are timestamptz (UTC); the app renders them in Pacific via the
-- existing reports/timezone helpers.
--
-- Idempotent: safe to run repeatedly in the Supabase SQL editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- employees: workforce roster
-- ---------------------------------------------------------------------------
create table if not exists public.employees (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  -- Optional link to a back-office login (managers/admins). NULL for floor-only
  -- staff who just clock in at a shared station.
  staff_id      uuid references public.staff_profiles(id) on delete set null,
  -- Short clock-in PIN (hashed in app layer ideally; stored as text here so the
  -- shared-station flow can verify). 4-6 digits typical.
  clock_pin     text,
  -- sales | manager | lead | other -- determines default drawer assignment.
  job_role      text not null default 'sales'
                  check (job_role in ('sales', 'manager', 'lead', 'other')),
  active        boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists employees_clock_pin_idx
  on public.employees (clock_pin) where clock_pin is not null;
create index if not exists employees_active_idx on public.employees (active);
create index if not exists employees_staff_idx on public.employees (staff_id);

-- ---------------------------------------------------------------------------
-- shifts: a work shift for one employee
-- ---------------------------------------------------------------------------
create table if not exists public.shifts (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  -- Pacific calendar day this shift belongs to (YYYY-MM-DD), for grouping.
  business_day  date not null,
  -- sales | manager -- mirrors the two register kinds in Slice 26.
  shift_role    text not null default 'sales'
                  check (shift_role in ('sales', 'manager', 'lead', 'other')),
  -- scheduled | open | closed
  status        text not null default 'open'
                  check (status in ('scheduled', 'open', 'closed')),
  scheduled_start timestamptz,
  scheduled_end   timestamptz,
  started_at      timestamptz,
  ended_at        timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists shifts_employee_idx on public.shifts (employee_id);
create index if not exists shifts_business_day_idx on public.shifts (business_day);
create index if not exists shifts_status_idx on public.shifts (status);

-- ---------------------------------------------------------------------------
-- time_punches: clock in/out + breaks for a shift
-- ---------------------------------------------------------------------------
create table if not exists public.time_punches (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  shift_id      uuid references public.shifts(id) on delete set null,
  -- work | break  -- a break punch pauses paid time.
  punch_kind    text not null default 'work'
                  check (punch_kind in ('work', 'break')),
  clock_in_at   timestamptz not null default now(),
  clock_out_at  timestamptz,
  -- Convenience worked-minutes, filled on clock-out by the app.
  minutes       integer,
  source        text not null default 'web',  -- web | station | manager_edit
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists time_punches_employee_idx on public.time_punches (employee_id);
create index if not exists time_punches_shift_idx on public.time_punches (shift_id);
-- Only ONE open work punch per employee at a time (enforced in app; index helps).
create index if not exists time_punches_open_idx
  on public.time_punches (employee_id) where clock_out_at is null;

-- updated_at triggers.
drop trigger if exists employees_set_updated_at on public.employees;
create trigger employees_set_updated_at before update on public.employees
  for each row execute function public.set_updated_at();

drop trigger if exists shifts_set_updated_at on public.shifts;
create trigger shifts_set_updated_at before update on public.shifts
  for each row execute function public.set_updated_at();

drop trigger if exists time_punches_set_updated_at on public.time_punches;
create trigger time_punches_set_updated_at before update on public.time_punches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed the workforce roster from existing back-office staff (idempotent) so the
-- time clock has people on day one. Floor-only staff can be added in the UI.
-- ---------------------------------------------------------------------------
insert into public.employees (full_name, staff_id, job_role)
select
  coalesce(sp.full_name, sp.email) as full_name,
  sp.id as staff_id,
  case when sp.role in ('owner', 'admin', 'manager') then 'manager' else 'sales' end as job_role
from public.staff_profiles sp
where sp.active = true
  and not exists (select 1 from public.employees e where e.staff_id = sp.id);

-- ---------------------------------------------------------------------------
-- Row-Level Security:
--   * staff may read the roster + shifts + punches;
--   * staff may write (the app gates management vs. clock actions by permission);
--   * no public access at all (workforce data is internal).
-- ---------------------------------------------------------------------------
alter table public.employees    enable row level security;
alter table public.shifts       enable row level security;
alter table public.time_punches enable row level security;

drop policy if exists employees_staff_read on public.employees;
create policy employees_staff_read on public.employees
  for select using (public.is_staff());
drop policy if exists employees_staff_write on public.employees;
create policy employees_staff_write on public.employees
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists shifts_staff_read on public.shifts;
create policy shifts_staff_read on public.shifts
  for select using (public.is_staff());
drop policy if exists shifts_staff_write on public.shifts;
create policy shifts_staff_write on public.shifts
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists time_punches_staff_read on public.time_punches;
create policy time_punches_staff_read on public.time_punches
  for select using (public.is_staff());
drop policy if exists time_punches_staff_write on public.time_punches;
create policy time_punches_staff_write on public.time_punches
  for all using (public.is_staff()) with check (public.is_staff());
