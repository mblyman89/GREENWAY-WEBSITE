-- Rollback for 0338_cultivera_history_days.sql (CVB-8, owner request 2026-11-02).
-- Removes the upsert function, so no more history days can be stored. The table
-- is KEPT by default (it holds retained Cultivera history). To remove it too,
-- uncomment the last statement.
begin;
drop function if exists public.cvb_upsert_history_days(text, jsonb);
-- drop table if exists public.cultivera_history_days;
commit;
notify pgrst, 'reload schema';
