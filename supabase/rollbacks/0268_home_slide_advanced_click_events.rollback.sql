-- Rollback for 0268_home_slide_advanced_click_events.sql (R47).
-- Safe for the live website: home slides fall back to their classic look
-- (the advanced options are forgotten), the click endpoint stores nothing,
-- and Reports > Website says "apply migration 0268" again. Recorded clicks
-- are deleted.
drop table if exists public.website_click_events;
alter table public.home_carousel_slides
  drop constraint if exists home_carousel_slides_advanced_obj_chk,
  drop constraint if exists home_carousel_slides_draft_advanced_obj_chk;
alter table public.home_carousel_slides
  drop column if exists draft_advanced,
  drop column if exists advanced;
notify pgrst, 'reload schema';
