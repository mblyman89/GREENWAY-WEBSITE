-- =============================================================================
-- ROLLBACK for 0254_menu_item_effects_aroma.sql (R35 #6)
-- =============================================================================
-- This file is NOT a migration. It lives outside supabase/migrations on
-- purpose, so the migration runner never applies it.
--
-- 0254 added two nullable columns to menu_items (effects, aroma_notes) and
-- one shape check each. This drops them. It FORGETS every counted effects /
-- aroma list stored on menu cards; the product page then falls back to the
-- knowledge base exactly as it did before 0254. They are restored by
-- re-applying 0254 and pressing "Fill effects and aroma on live cards"
-- (Products) or re-staging.
--
-- The app does not need reverting first: every menu_items writer retries once
-- without the two columns on 42703 / PGRST204 (menu-sensory-core).
-- =============================================================================

alter table public.menu_items drop constraint if exists menu_items_effects_shape_chk;
alter table public.menu_items drop constraint if exists menu_items_aroma_notes_shape_chk;

alter table public.menu_items
  drop column if exists effects,
  drop column if exists aroma_notes;

notify pgrst, 'reload schema';
