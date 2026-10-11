-- Rollback for 0265_media_bucket_video_large_uploads.sql (R44).
-- Returns the media bucket to "no bucket-specific limit" (the project global
-- file size limit applies). Already-uploaded videos keep working.
do $m$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage'
       and table_name = 'buckets'
       and column_name = 'file_size_limit'
  ) then
    execute 'update storage.buckets set file_size_limit = null where id = ''media''';
  end if;
end
$m$;
