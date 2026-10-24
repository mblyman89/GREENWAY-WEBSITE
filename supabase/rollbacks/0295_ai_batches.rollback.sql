-- Rollback for 0295_ai_batches.sql (R74 S34).
--
-- The normal rollback is the switch: unset AI_LOOKUP_ENGINE (back to live
-- lookups). Run this only to remove the Batch API record. Products still
-- waiting on a batch are put back in the queue first. Facts already attached
-- stay where they landed. Safe to re-run.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'lookup_job_items' and column_name = 'batch_id') then
    update public.lookup_job_items set status = 'queued', updated_at = now()
      where batch_id is not null and status = 'running';
  end if;
end $$;
drop index if exists public.lookup_job_items_batch_idx;
alter table public.lookup_job_items drop constraint if exists lookup_job_items_batch_id_fkey;
alter table public.lookup_job_items drop column if exists batch_id;
drop table if exists public.ai_batches;
notify pgrst, 'reload schema';
