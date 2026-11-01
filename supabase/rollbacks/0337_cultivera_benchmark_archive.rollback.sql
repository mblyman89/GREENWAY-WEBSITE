-- Rollback for 0337_cultivera_benchmark_archive.sql (CVB-3, owner request 2026-11-01).
-- Removes the two functions, so nothing more can be archived or stored. The
-- tables and the private bucket are KEPT by default: they hold the retained
-- Cultivera history and the owner's payback ledger. To remove them too,
-- uncomment the last statements (the bucket must be emptied in the Supabase
-- dashboard first; the archived files would be lost).
begin;
drop function if exists public.cvb_upsert_benchmark_days(text, jsonb);
drop function if exists public.cvb_register_archive_run(text, timestamptz, text, uuid, jsonb);
-- drop table if exists public.cultivera_payback_entries;
-- drop table if exists public.cultivera_benchmark_days;
-- drop table if exists public.cultivera_archive_files;
-- drop table if exists public.cultivera_archive_runs;
-- delete from storage.buckets where id = 'cultivera-archive';
commit;
notify pgrst, 'reload schema';
