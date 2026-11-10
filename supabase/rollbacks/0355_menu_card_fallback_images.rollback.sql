-- Rollback for 0355_menu_card_fallback_images.sql (D224).
-- Run MANUALLY only if needed.
--
-- Drops the per-category fallback choices. The pictures themselves stay in the
-- media library (only the "use this for the category" choice is lost). Cards
-- go back to the older fallback ladder (brand / vendor / POS category /
-- inventory type / global) or the mockup.
drop table if exists public.menu_card_fallback_images;

notify pgrst, 'reload schema';
