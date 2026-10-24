-- Rollback for 0296_lookup_item_cost.sql (R74 S37). Drops the per-product
-- cost; the console falls back to the estimate. Safe to re-run.
alter table public.lookup_job_items drop constraint if exists lookup_job_items_cost_cents_check;
alter table public.lookup_job_items drop column if exists cost_cents;
notify pgrst, 'reload schema';
