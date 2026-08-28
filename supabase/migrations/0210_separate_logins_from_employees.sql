-- ══════════════════════════════════════════════════════════════════════════
-- 0210  A LOGIN IS NOT A JOB
--
-- books-87. Michael, verbatim:
--
--     "right now the system is using the users who have access to the back
--      office app, which is not how I would like the system to behave. I want
--      to be able to allow certain people to view or have access in some way
--      with the back office, people who aren't necessarily employees. I would
--      rather users be people who have access to the system, and be separate
--      from employees. I want to create the employee in payroll/ W-4 setup,
--      then I will give them access to the back office if they need access
--      to it."
--
-- ──────────────────────────────────────────────────────────────────────────
-- WHERE THE BEHAVIOUR ACTUALLY CAME FROM
-- ──────────────────────────────────────────────────────────────────────────
-- Not from the payroll code. The payroll screen reads `public.employees` and
-- always has. The contamination was poured in ONCE, three years of migrations
-- ago, by 0037_staffing_timeclock.sql:125-132:
--
--     insert into public.employees (full_name, staff_id, job_role)
--     select coalesce(sp.full_name, sp.email), sp.id, ...
--     from public.staff_profiles sp
--     where sp.active = true
--       and not exists (select 1 from public.employees e where e.staff_id = sp.id);
--
-- Its own comment explains the intent: "Seed the workforce roster from existing
-- back-office staff (idempotent) so the time clock has people on day one."
--
-- That was a reasonable day-one convenience for a TIME CLOCK. It became wrong
-- the moment those same rows started answering the question "who do we pay?".
-- A bookkeeper, an outside accountant, a consultant with a read-only login —
-- each of them silently became a person on the payroll roster with a missing
-- W-4 badged in red.
--
-- Everything else in the schema already agrees with Michael. `employees.staff_id`
-- is NULLABLE and 0037 itself comments it "NULL for floor-only staff". The
-- application's own create path (staffing/actions.ts) never sets staff_id. No
-- trigger syncs the two tables. The ONE-TIME SEED IS THE ONLY COUPLING, which
-- is why this is a data repair plus a stop, and not a redesign.
--
-- ──────────────────────────────────────────────────────────────────────────
-- WHY THIS DEACTIVATES AND DOES NOT DELETE
-- ──────────────────────────────────────────────────────────────────────────
-- Deleting is the obvious move and it is wrong. `employees.id` is referenced by
-- audit history, and 0037 cascades shifts/time_punches on delete. A row that
-- was seeded by mistake may still have been the actor on a real audit entry.
-- Destroying evidence to tidy a roster is a bad trade, and it is irreversible.
--
-- So a quarantined row is marked `employment_status = 'terminated'`,
-- `active = false`, and stamped with a reason that names this migration. It
-- vanishes from every roster that filters (which, after books-87, includes the
-- payroll setup screen) and it can be explained and undone by a human who reads
-- the note.
--
-- ──────────────────────────────────────────────────────────────────────────
-- THE DISCRIMINATOR, AND WHY IT FAILS SAFE
-- ──────────────────────────────────────────────────────────────────────────
-- The hard part is telling "an accountant who was seeded by 0037" apart from
-- "a real employee who also happens to have a back-office login". Michael has
-- both, and the second kind MUST NOT be touched — he is one of them himself.
--
-- A row is quarantined ONLY when ALL of the following are true:
--
--   1. staff_id is not null           -- it came from a login
--   2. no W-4 record                  -- nobody set up their withholding
--   3. no I-9 record                  -- nobody verified them to work
--   4. no pay record                  -- nobody set a wage for them
--   5. no time punches                -- they have never clocked in
--   6. no shifts                      -- they have never been scheduled
--   7. no hire_date                   -- nobody recorded them as hired
--
-- Any ONE of those being present means a human treated this person as a worker,
-- and the row is LEFT ALONE. The test is deliberately lopsided: the cost of
-- wrongly keeping a row is a name on a list Michael can deactivate in two
-- clicks; the cost of wrongly quarantining one is a real employee vanishing
-- from payroll. Standing rule 14 — when in doubt, refuse — resolves to "keep".
--
-- Michael's own row survives on several of these independently.
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- §0  ORDERING GUARD
--
-- This migration edits data in tables 0037 and 0117 create. If it is ever run
-- against a database where they do not exist, it must say so in words rather
-- than fail with a bare "relation does not exist" 200 lines into a reset.
-- ──────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.employees') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0210 separates logins from employees, and public.employees does not exist yet. Run 0037_staffing_timeclock.sql first, then this file. Nothing was changed.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employees'
      and column_name = 'employment_status'
  ) then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0210 needs employees.employment_status, added by 0117_employee_command_center.sql. Run that first, then this file. Nothing was changed.';
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- §1  STOP THE BLEEDING
--
-- 0037's seed is guarded by `not exists (... where e.staff_id = sp.id)`, so on
-- a FRESH database — a factory reset, a new environment, a developer's local —
-- it would run again and re-contaminate the roster. Quarantining today's rows
-- without closing that door would fix the symptom and keep the cause.
--
-- The seed is neutralised by recording that it has been superseded. 0037 is NOT
-- edited: a migration that has already run on the production database is
-- history, and rewriting history is how two environments quietly diverge.
-- Instead this marker table is checked by the companion test, which asserts
-- that no migration AFTER this one reintroduces a login-to-employee insert.
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.employee_provisioning_policy (
  id            boolean primary key default true check (id),
  -- Whether creating a back-office login may also create an employee row.
  -- FALSE from books-87 onward, at the owner's explicit instruction.
  logins_create_employees boolean not null default false,
  policy_note   text not null,
  decided_on    date not null default current_date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.employee_provisioning_policy is
  'One row. Records the owner''s decision (books-87) that a back-office login and a job are separate things: creating a user must never create an employee. 0037 seeded employees from staff_profiles for the time clock; that behaviour is retired here and must not return.';

insert into public.employee_provisioning_policy (id, logins_create_employees, policy_note)
values (
  true,
  false,
  'books-87. Michael: "I would rather users be people who have access to the system, and be separate from employees. I want to create the employee in payroll/ W-4 setup, then I will give them access to the back office if they need access to it." Employees are created in payroll setup or staffing. Logins are granted separately in Users. Neither creates the other.'
)
on conflict (id) do update
  set logins_create_employees = false,
      policy_note = excluded.policy_note,
      updated_at = now();

-- §1b  ROW LEVEL SECURITY ON THE MARKER TABLE
--
-- Not a formality. Every table in `public` is reachable through PostgREST by
-- anybody holding the public anon key, so a table created without RLS is a
-- table published to the internet. The suite enforces this (rls-coverage), and
-- it caught this exact omission on the first run of this migration.
--
-- The contents are not secret, but they are not the public's business either,
-- and there is a sharper reason to lock the WRITE side: this row is the record
-- of an owner's decision. If it could be flipped through the API, the stop it
-- represents would be advisory. Read is granted to managers, matching
-- `employees_mgr_read` in 0130. No insert/update/delete policy exists at all,
-- so the only way to change the decision is a migration written by a human --
-- which is the correct amount of friction for reversing a standing instruction.
alter table public.employee_provisioning_policy enable row level security;

drop policy if exists employee_provisioning_policy_mgr_read on public.employee_provisioning_policy;
create policy employee_provisioning_policy_mgr_read on public.employee_provisioning_policy
  for select using (public.is_manager());

-- ──────────────────────────────────────────────────────────────────────────
-- §2  QUARANTINE THE SEEDED ROWS
--
-- Written as a single UPDATE with the seven-part discriminator spelled out, so
-- that the rule is readable in the file rather than assembled in an
-- application. Every NOT EXISTS is guarded by to_regclass so this migration
-- also runs correctly on a database where 0195 has not yet been applied.
-- ──────────────────────────────────────────────────────────────────────────
do $$
declare
  v_has_payroll boolean := to_regclass('public.employee_w4') is not null;
  v_quarantined integer := 0;
begin
  if v_has_payroll then
    update public.employees e
       set active             = false,
           employment_status  = 'terminated',
           clock_pin          = null,
           termination_reason = coalesce(
             nullif(e.termination_reason, ''),
             'Not an employee. This row was created automatically by migration 0037 from a back-office login, not by anyone hiring a person. It had no W-4, no I-9, no pay record, no hours and no hire date. Retired by 0210 so it stops appearing on the payroll roster. The login itself is untouched and still works.'
           )
     where e.staff_id is not null
       and e.active = true
       and e.hire_date is null
       and not exists (select 1 from public.employee_w4  w where w.employee_id = e.id)
       and not exists (select 1 from public.employee_i9  i where i.employee_id = e.id)
       and not exists (select 1 from public.employee_pay p where p.employee_id = e.id)
       and not exists (select 1 from public.time_punches t where t.employee_id = e.id)
       and not exists (select 1 from public.shifts       s where s.employee_id = e.id);
  else
    -- 0195 not applied: the payroll tables do not exist, so the payroll half of
    -- the discriminator cannot be evaluated. The remaining checks still hold.
    update public.employees e
       set active             = false,
           employment_status  = 'terminated',
           clock_pin          = null,
           termination_reason = coalesce(
             nullif(e.termination_reason, ''),
             'Not an employee. Created automatically by migration 0037 from a back-office login. No hours, no shifts, no hire date. Retired by 0210.'
           )
     where e.staff_id is not null
       and e.active = true
       and e.hire_date is null
       and not exists (select 1 from public.time_punches t where t.employee_id = e.id)
       and not exists (select 1 from public.shifts       s where s.employee_id = e.id);
  end if;

  get diagnostics v_quarantined = row_count;
  raise notice '0210: % login-derived row(s) retired from the employee roster. Logins were not touched.', v_quarantined;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- §3  WHAT A "PERSON ON PAYROLL" MEANS FROM NOW ON
--
-- A convenience view, so the rule lives in ONE place instead of being retyped
-- as a filter in every screen that asks the question. The payroll setup roster
-- reads this definition rather than inventing its own.
--
-- Deliberately NOT security definer and NOT a replacement for RLS: it is a
-- definition, not a permission.
-- ──────────────────────────────────────────────────────────────────────────
create or replace view public.employees_on_payroll as
  select e.*
    from public.employees e
   where e.active = true
     and coalesce(e.employment_status, 'active') <> 'terminated';

comment on view public.employees_on_payroll is
  'People this business actually employs: active, not terminated. Having a back-office login neither adds nor removes anyone. books-87.';

commit;
