-- Rollback for 0280_website_web_vitals.sql (R59-S4).
-- Safe for the live website: the /api/vitals endpoint stores nothing and
-- Reports > Website > Page speed says "apply update 0280" again. Recorded
-- speed measurements are deleted.
drop table if exists public.website_web_vitals;
notify pgrst, 'reload schema';
