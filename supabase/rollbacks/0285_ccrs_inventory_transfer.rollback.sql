-- Rollback for 0285_ccrs_inventory_transfer.sql. Drops the slice function, the
-- two checks and the two columns. The vendor ids written by the backfill are
-- still in lot_code (the backfill only copied them); owner-entered ids are lost.
drop function if exists public.ccrs_transfer_slice(text, text[]);
alter table public.inventory_lots drop constraint if exists inventory_lots_vendor_inv_ext_id_source_check;
alter table public.inventory_lots drop constraint if exists inventory_lots_vendor_inv_ext_id_shape_check;
alter table public.inventory_lots drop column if exists vendor_inventory_external_id_source;
alter table public.inventory_lots drop column if exists vendor_inventory_external_id;
