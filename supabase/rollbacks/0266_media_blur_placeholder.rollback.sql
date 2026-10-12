-- Rollback for 0266_media_blur_placeholder.sql (R45-S2).
-- Safe: only the tiny loading previews are forgotten. Every photo keeps
-- working; banners just load without the blurred preview, as before R45.
alter table public.media_assets drop constraint if exists media_assets_blur_data_url_small_raster;
alter table public.media_assets drop column if exists blur_data_url;
notify pgrst, 'reload schema';
