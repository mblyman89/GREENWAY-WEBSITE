-- Rollback for 0267_content_schedule_releases.sql (R46).
-- Safe for the live website: nothing public reads these tables. Upcoming
-- scheduled changes and releases are forgotten (nothing will go live or come
-- down on its own any more); everything already published stays exactly as
-- it is. The editors show "apply migration 0267" again and the cron skips.
drop table if exists public.content_schedule;
drop table if exists public.content_releases;
notify pgrst, 'reload schema';
