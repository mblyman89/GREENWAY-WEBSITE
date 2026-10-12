-- ===========================================================================
-- 0266_media_blur_placeholder.sql
--
-- R45-S2 (owner-requested R45-R48 "top off the website editor"). BLURRED
-- PREVIEWS WHILE BANNER PHOTOS LOAD.
--
-- WHY: the Next.js 16 next/image docs say a remote image needs its own
-- blurDataURL ("If the image is dynamic or remote, you must provide
-- blurDataURL yourself") and that it should be tiny ("10px or less"). Our
-- banner photos live in Supabase Storage (remote), so the server makes a
-- 10px preview ONCE when the photo is uploaded and stores it here.
--
-- WHAT THIS ADDS - one nullable text column, nothing else:
--   media_assets.blur_data_url   data:image/webp;base64,... (about 100-400
--                                characters), with a CHECK that it is a small
--                                raster data URL and nothing else.
-- Existing photos keep NULL and simply load without a preview (as today).
--
-- The website works BEFORE this is applied: the upload retries the save
-- without the column, and the banner lookup ignores the error.
--
-- FACTORY RESET: no new table. media_assets is KEEP in
-- src/lib/accounting/factory-reset-core.ts ("Your uploaded photographs and
-- artwork."); the preview is kept with its photo.
-- IDEMPOTENT (add column if not exists + guarded constraint). APPLY MANUALLY
-- in the Supabase SQL editor.
-- ROLLBACK: supabase/rollbacks/0266_media_blur_placeholder.rollback.sql
-- ===========================================================================

alter table public.media_assets
  add column if not exists blur_data_url text;

do $chk$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'media_assets_blur_data_url_small_raster'
       and conrelid = 'public.media_assets'::regclass
  ) then
    alter table public.media_assets
      add constraint media_assets_blur_data_url_small_raster
      check (
        blur_data_url is null
        or (
          length(blur_data_url) <= 1500
          and blur_data_url ~ '^data:image/(webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$'
        )
      );
  end if;
end
$chk$;

notify pgrst, 'reload schema';
