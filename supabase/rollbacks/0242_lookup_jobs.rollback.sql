-- ROLLBACK for 0242_lookup_jobs.sql (bible S13).
-- Bible S13.7 says the rollback is the feature flag, and the per-row lookup
-- stays. The normal rollback is
-- MANIFEST_BATCH_LOOKUP=off in Vercel. Run this only to remove the tables.
-- Every batch lookup record is forgotten. Facts the batches attached stay
-- where they landed (they were written by the normal save path).

drop table if exists public.lookup_job_items;
drop table if exists public.lookup_jobs;
