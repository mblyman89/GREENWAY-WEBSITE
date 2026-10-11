-- ===========================================================================
-- Greenway Back Office - Migration 0265: media bucket ready for big uploads
-- and MP4/WebM video banners (R44).
--
-- What it does: sets the `media` bucket per-file size limit to 200 MB
-- (209715200 bytes), the largest file the app accepts (videos, images and
-- PDFs are capped lower by the app itself, see
-- src/lib/media/upload-policy-core.ts).
--
-- What it deliberately does NOT do: restrict allowed_mime_types. Several other
-- admin tools also save into this bucket, and a type allow-list here could break
-- them. The app checks the type of every file before and after upload.
--
-- IMPORTANT (one click, Supabase dashboard): the bucket limit can never exceed
-- the project GLOBAL file size limit (Supabase docs: Storage -> File limits).
-- Free plan max is 50 MB, Pro can raise it up to 500 GB. Go to
-- Storage -> Settings -> "Global file size limit" and set it to at least
-- 200 MB, or uploads bigger than the global limit are refused.
--
-- Idempotent: safe to run more than once. Guarded so it also runs on a bare
-- storage.buckets table that has no file_size_limit column (CI bootstrap).
-- ROLLBACK: supabase/rollbacks/0265_media_bucket_video_large_uploads.rollback.sql
-- ===========================================================================

do $m$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage'
       and table_name = 'buckets'
       and column_name = 'file_size_limit'
  ) then
    execute 'update storage.buckets set file_size_limit = 209715200 where id = ''media''';
  end if;
end
$m$;
