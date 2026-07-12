-- =============================================================================
-- 0117_employee_command_center.sql  (Task S-b)
--
-- EMPLOYEE COMMAND CENTER: onboarding, documents, training, offboarding.
--
-- Owner: "track what needs to be tracked for employee on boarding... did
-- employee read and sign the related employee docs. Do we have their w4 and
-- i9 on file. All of it... I think we need to do background checks before
-- hiring [after a conditional offer per RCW 49.94]... termination related
-- things, everything a major corporation would do employee wise."
--
-- Regulatory ground truth (docs/EMPLOYEE_COMPLIANCE.md, verified):
--   * WAC 314-55-087(1)(e): keep ALL employee records (training, payroll,
--     DATE OF HIRE) on premises for 5 YEARS -> hire_date lives on the roster
--     row; terminated employees are never deleted (status = 'terminated').
--   * RCW 69.50.357: employees must be 21+ and trained (rules + under-21 ID).
--   * WAC 314-55-083: employer-issued photo ID badge on premises.
--   * RCW 49.94.010 (WA Fair Chance Act): background check only AFTER a
--     conditional offer -> the wizard orders the hiring phase accordingly.
--   * I-9 Section 1 by day 1, Section 2 within 3 business days; W-4 before
--     first payroll; DSHS new-hire report within 20 days.
--
-- Idempotent: safe to run repeatedly in the Supabase SQL editor.
-- APPLY MANUALLY in the Supabase SQL editor (standing rule).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- employees: lifecycle columns on the existing roster (0037)
-- ---------------------------------------------------------------------------

-- WAC 314-55-087(1)(e): date of hire is a required 5-year record.
alter table public.employees
  add column if not exists hire_date date;

-- Lifecycle: candidate -> onboarding -> active -> terminated. Existing rows
-- default to 'active' so today's roster keeps working unchanged.
alter table public.employees
  add column if not exists employment_status text not null default 'active'
    check (employment_status in ('candidate', 'onboarding', 'active', 'terminated'));

-- Offboarding record (kept 5 years with the rest of the file).
alter table public.employees
  add column if not exists termination_date date;
alter table public.employees
  add column if not exists termination_reason text;

-- WAC 314-55-083 badge tracking (badge number/label as issued).
alter table public.employees
  add column if not exists badge_number text;

-- RCW 69.50.357: 21+ verified from ID at onboarding (the flag, not the DOB —
-- we deliberately do NOT store date of birth in the roster).
alter table public.employees
  add column if not exists age_21_verified boolean not null default false;

create index if not exists employees_status_idx
  on public.employees (employment_status);

-- ---------------------------------------------------------------------------
-- employee_onboarding_tasks: the wizard checklist, one row per task per hire.
-- Task definitions (keys, order, helper text, phase) live in the app's pure
-- core so every hire gets the same professional checklist; rows here record
-- completion. Seeded by the app when onboarding starts.
-- ---------------------------------------------------------------------------
create table if not exists public.employee_onboarding_tasks (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  task_key      text not null,
  done          boolean not null default false,
  done_at       timestamptz,
  -- Who checked it off (back-office user), for the audit trail.
  done_by       text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (employee_id, task_key)
);

create index if not exists employee_onboarding_tasks_emp_idx
  on public.employee_onboarding_tasks (employee_id);

-- ---------------------------------------------------------------------------
-- employee_documents: "do we have their W-4 and I-9 on file?" — one row per
-- document kind per employee. The store keeps PAPER (or scanned) documents in
-- its own files; this table tracks status + dates so nothing slips.
--   status: missing -> on_file (received) -> signed (read-and-signed docs)
-- ---------------------------------------------------------------------------
create table if not exists public.employee_documents (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  doc_key       text not null,
  status        text not null default 'missing'
                  check (status in ('missing', 'on_file', 'signed')),
  -- When the document was received / signed (date-level is enough).
  received_on   date,
  -- Credentials that lapse (e.g. DOH medical cannabis consultant certificate).
  expires_on    date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (employee_id, doc_key)
);

create index if not exists employee_documents_emp_idx
  on public.employee_documents (employee_id);

-- ---------------------------------------------------------------------------
-- employee_training_log: RCW 69.50.357 training record (5-year retention per
-- WAC 314-55-087(1)(e)). Topic + date + trainer per entry.
-- ---------------------------------------------------------------------------
create table if not exists public.employee_training_log (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  topic         text not null,
  trained_on    date not null,
  trainer       text,
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists employee_training_log_emp_idx
  on public.employee_training_log (employee_id, trained_on desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuse public.set_updated_at from earlier migrations).
-- ---------------------------------------------------------------------------
drop trigger if exists employee_onboarding_tasks_set_updated_at on public.employee_onboarding_tasks;
create trigger employee_onboarding_tasks_set_updated_at
  before update on public.employee_onboarding_tasks
  for each row execute function public.set_updated_at();

drop trigger if exists employee_documents_set_updated_at on public.employee_documents;
create trigger employee_documents_set_updated_at
  before update on public.employee_documents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security: staff only (same posture as the 0037 staffing tables).
-- Workforce data is internal; no public access at all.
-- ---------------------------------------------------------------------------
alter table public.employee_onboarding_tasks enable row level security;
alter table public.employee_documents        enable row level security;
alter table public.employee_training_log     enable row level security;

drop policy if exists employee_onboarding_tasks_staff_read on public.employee_onboarding_tasks;
create policy employee_onboarding_tasks_staff_read on public.employee_onboarding_tasks
  for select using (public.is_staff());
drop policy if exists employee_onboarding_tasks_staff_write on public.employee_onboarding_tasks;
create policy employee_onboarding_tasks_staff_write on public.employee_onboarding_tasks
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists employee_documents_staff_read on public.employee_documents;
create policy employee_documents_staff_read on public.employee_documents
  for select using (public.is_staff());
drop policy if exists employee_documents_staff_write on public.employee_documents;
create policy employee_documents_staff_write on public.employee_documents
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists employee_training_log_staff_read on public.employee_training_log;
create policy employee_training_log_staff_read on public.employee_training_log
  for select using (public.is_staff());
drop policy if exists employee_training_log_staff_write on public.employee_training_log;
create policy employee_training_log_staff_write on public.employee_training_log
  for all using (public.is_staff()) with check (public.is_staff());
