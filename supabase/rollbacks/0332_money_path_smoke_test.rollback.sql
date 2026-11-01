-- Rollback for 0332_money_path_smoke_test.sql (G-71c).
-- Removes the daily money-path test function. The daily platform-health run
-- then reports "The money-path test is not installed" on Platform health and
-- in the daily email, which is the honest state. Nothing else depends on it,
-- and it never left any data behind, so there is nothing else to undo.
begin;
drop function if exists public.platform_money_smoke_test();
commit;
notify pgrst, 'reload schema';
