-- Rollback for 0360_merch_designs.sql (D232 M-4).
-- Run MANUALLY only if needed.
--
-- Drops the server copies of Merch Studio designs and the sample approvals.
-- Designs still in a browser stay there (the Studio keeps its local copy).
-- Artwork and sample photos already uploaded stay in the private merch-files
-- bucket; the bucket goes back to PNG only.
drop table if exists public.merch_designs;

do $m$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) then
    execute 'update storage.buckets set allowed_mime_types = array[''image/png''] where id = ''merch-files''';
  end if;
end
$m$;

notify pgrst, 'reload schema';
