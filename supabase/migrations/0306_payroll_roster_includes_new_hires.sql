-- 0306_payroll_roster_includes_new_hires.sql  (Phase 0.3 · G-52 · F-08-1)
--
-- WHY. New hires now start as a CANDIDATE with active = false (Staffing "Add a
-- person" and Payroll Setup "Add a person" both), so nobody can clock in or
-- unlock the register until an owner or admin Activates them (RCW 69.50.357:
-- 21+, training). Their payroll paperwork (W-4, I-9) is done DURING
-- onboarding, so the payroll roster must still show candidate / onboarding
-- people. This redefines the 0210 §3 view to: active, OR being hired - and
-- never terminated. listEmployeeSetup() writes the same rule out in longhand
-- (PAYROLL_PEOPLE_OR) and a test pins the two together.
--
-- SAFE / IDEMPOTENT: create or replace view only. Nothing is written.
-- Apply MANUALLY in the SQL editor. The app does not read this view, so
-- deploying before running this file is harmless.

begin;

create or replace view public.employees_on_payroll as
  select e.*
    from public.employees e
   where (e.active = true or e.employment_status in ('candidate', 'onboarding'))
     and coalesce(e.employment_status, 'active') <> 'terminated';

comment on view public.employees_on_payroll is
  'People this business employs or is hiring: active, or candidate/onboarding; never terminated. Having a back-office login neither adds nor removes anyone. books-87; Phase 0.3 (G-52).';

commit;
