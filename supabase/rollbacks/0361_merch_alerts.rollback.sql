-- Rollback for 0361_merch_alerts.sql (D232 M-7).
-- Run MANUALLY only if needed.
--
-- Drops the merch alerts inbox. The shop keeps emailing alerts
-- (MERCH_ORDER_ALERT_EMAIL) and logging them in Vercel; its POST to
-- /api/merch-alerts then gets a 503 and is ignored.
drop table if exists public.merch_alerts;

notify pgrst, 'reload schema';
