-- Rollback for 0294_inventory_lot_menu_variant.sql (R74 S30).
--
-- Drops the lot -> menu size link. No stock, cost or CCRS value is touched.
-- The app tolerates the missing column: lot prices fall back to the card
-- (one-size cards only), as before 0294. Safe to re-run.
drop index if exists public.inventory_lots_menu_source_variant_id_idx;
alter table public.inventory_lots drop constraint if exists inventory_lots_menu_source_variant_source_check;
alter table public.inventory_lots drop column if exists menu_source_variant_source;
alter table public.inventory_lots drop column if exists menu_source_variant_id;
notify pgrst, 'reload schema';
