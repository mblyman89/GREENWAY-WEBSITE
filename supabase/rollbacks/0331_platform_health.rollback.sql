-- Rollback for 0331_platform_health.sql (G-71a).
-- Removes the daily database check and its run log. The app then reports
-- "The daily database check is not installed" on Platform health and in the
-- daily email, which is the honest state. Nothing else depends on these.
begin;
drop function if exists public.platform_db_contract_check(text[], text[]);
drop table if exists public.platform_health_runs;
commit;
notify pgrst, 'reload schema';
