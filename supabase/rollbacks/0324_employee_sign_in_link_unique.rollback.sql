-- supabase/rollbacks/0324_employee_sign_in_link_unique.rollback.sql  (Fix Phase 5)
-- Drops the one-sign-in-one-employee index. Links stay as they are; the app
-- still refuses a second link, but two simultaneous clicks are no longer
-- stopped by the database. Only if needed.
drop index if exists public.employees_staff_id_unique;
notify pgrst, 'reload schema';
