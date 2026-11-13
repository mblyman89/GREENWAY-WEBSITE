-- Rollback for 0364_budalerts_menus.sql (D242).
-- Run MANUALLY only if needed.
--
-- Put the code back to the pre-D242 version first. Drops the four Budalerts
-- tables (links, pulls, listings, fetch state). Photos already saved to the
-- media library stay there as drafts.
drop table if exists public.budalerts_menu_items;
drop table if exists public.budalerts_brand_snapshots;
drop table if exists public.budalerts_brand_links;
drop table if exists public.budalerts_fetch_state;

notify pgrst, 'reload schema';
