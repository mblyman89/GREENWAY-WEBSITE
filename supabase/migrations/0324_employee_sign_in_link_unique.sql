-- 0324_employee_sign_in_link_unique.sql  (Fix Phase 5 · G-53 · owner D70)
--
-- WHY. The owner, verbatim (Q-08-1, D70): "yes, built right, professionally
-- and of enterprise grade standards." The employee file can now be linked to
-- an existing back-office sign-in by an owner or admin (employees.staff_id).
-- One sign-in belongs to one employee: the register resolves "which employee
-- is this sign-in" and treats two matches as ambiguous
-- (src/app/admin/registers/actions.ts employeeIdForStaff), and offboarding
-- deactivates the linked sign-in. The app already refuses a second link; this
-- index makes the database refuse it too, so two people pressing Link at the
-- same moment cannot both win.
--
-- WHAT. One partial unique index on employees(staff_id) where staff_id is not
-- null. No columns, no data changes, no new tables (factory reset 0240 is not
-- affected). books-87 is untouched: nothing here creates an employee or reads
-- staff_profiles.
--
-- SAFE. If two employee files already point at the same sign-in, the file
-- stops with a message listing them instead of failing half-way; unlink the
-- extra on the employee file (the Users page flags it) and run it again.
-- Re-runnable (create unique index if not exists).
-- Rollback: supabase/rollbacks/0324_employee_sign_in_link_unique.rollback.sql.

do $$
declare
  v_dupes text;
begin
  if to_regclass('public.employees') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0324 needs public.employees';
  end if;
  select string_agg(staff_id::text || ' (' || n || ' files)', ', ')
    into v_dupes
    from (
      select staff_id, count(*) as n
        from public.employees
       where staff_id is not null
       group by staff_id
      having count(*) > 1
    ) d;
  if v_dupes is not null then
    raise exception 'DUPLICATE_SIGN_IN_LINKS: these sign-ins are linked to more than one employee file: %. Unlink the extra on the employee file, then run 0324 again.', v_dupes;
  end if;
end $$;

create unique index if not exists employees_staff_id_unique
  on public.employees (staff_id)
  where staff_id is not null;

notify pgrst, 'reload schema';
