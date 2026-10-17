-- ===========================================================================
-- 0281_merch_print_files_bucket.sql
--
-- R71 S3 - Merch Studio "Proof & Export".
--
-- A PRIVATE Storage bucket for finished print files (300-DPI transparent
-- PNGs) of Greenway Merchandising LLC (dba Greenway Glass & Goods).
--
--   * Private: nothing is publicly listable or readable.
--   * Uploads: the browser PUTs to a ONE-TIME signed upload URL that the
--     server issues only to staff with `content.edit` (service role signs).
--   * Printful: gets a short-lived SIGNED download URL per file, only when
--     staff ask for mockups (S3) or an order is created (S4). Printful
--     fetches the file once and keeps its own copy.
--   * Staff (is_staff) may read objects (e.g. re-download a print file);
--     only admins may delete; nobody else can do anything.
--   * File size cap 50 MB (a 12x16" 300-DPI PNG is typically 2-25 MB).
--     Only PNG is allowed.
--
-- Idempotent: safe to run more than once.
-- ROLLBACK: supabase/rollbacks/0281_merch_print_files_bucket.rollback.sql
-- ===========================================================================

insert into storage.buckets (id, name, public)
values ('merch-files', 'merch-files', false)
on conflict (id) do nothing;

do $m$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit'
  ) then
    execute 'update storage.buckets set file_size_limit = 52428800 where id = ''merch-files''';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) then
    execute 'update storage.buckets set allowed_mime_types = array[''image/png''] where id = ''merch-files''';
  end if;
end
$m$;

drop policy if exists merch_files_staff_read on storage.objects;
create policy merch_files_staff_read on storage.objects
  for select using (bucket_id = 'merch-files' and public.is_staff());

drop policy if exists merch_files_admin_delete on storage.objects;
create policy merch_files_admin_delete on storage.objects
  for delete using (bucket_id = 'merch-files' and public.is_admin());
