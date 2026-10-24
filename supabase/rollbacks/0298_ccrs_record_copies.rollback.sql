-- Rollback for 0298_ccrs_record_copies.sql (R74 S40).
--
-- Removes the CCRS Records page's storage and RPCs. Ledger rows a merge wrote
-- stay (they are the State's record); the S-15 command line still merges.
-- The bucket is left in place if it holds files (Storage refuses to drop it).
drop function if exists public.ccrs_apply_record_copy(uuid, integer, integer, jsonb, uuid, text);
drop function if exists public.ccrs_records_sent_page(integer, integer);
drop function if exists public.ccrs_records_ledger_page(integer, integer);
drop table if exists public.ccrs_record_copy_stage;
drop table if exists public.ccrs_record_copies;
delete from storage.buckets b where b.id = 'ccrs-records' and not exists (select 1 from storage.objects o where o.bucket_id = 'ccrs-records');
notify pgrst, 'reload schema';
