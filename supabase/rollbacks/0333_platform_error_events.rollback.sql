-- Rollback for 0333_platform_error_events.sql (G-71d).
-- Removes the error log. The app keeps working: errors are no longer recorded
-- or alerted, Platform health says "Error alerting is not installed yet", and
-- the daily email warns the same. Nothing else depends on this table.
begin;
drop table if exists public.platform_error_events;
commit;
notify pgrst, 'reload schema';
