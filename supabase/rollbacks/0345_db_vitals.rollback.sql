-- supabase/rollbacks/0345_db_vitals.rollback.sql  (D193 · DB HEALTH slice B)
--
-- Undo 0345_db_vitals.sql: drops the two functions. No table was created and no row was
-- changed by 0345, so nothing else needs undoing. Readings already stored in
-- platform_health_runs (kind 'db_vitals' / 'db_heal') stay: that log is append-only.
-- After this, the 10-minute check reports "Vital signs are not installed yet (run migration
-- 0345)" and the Partner offers no "Clear stuck connections" fix. Safe to re-run.

drop function if exists public.platform_db_heal_stuck(int[], int, int);
drop function if exists public.platform_db_vitals();
