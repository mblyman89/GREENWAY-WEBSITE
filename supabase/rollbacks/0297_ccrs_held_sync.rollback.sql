-- Rollback for 0297_ccrs_held_sync.sql (R74 S39).
--
-- Removes the "still owed to CCRS" list. Batches keep leaving held records
-- out (that is code, not this table); the hub then shows only the current
-- week's held-back list. Safe to re-run.
drop function if exists public.ccrs_record_held(text, date, jsonb);
drop table if exists public.ccrs_held_sync;
notify pgrst, 'reload schema';
