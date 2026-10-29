-- Rollback for 0319_intake_counted_short.sql (Fix Phase 3.1 · G-16 · F-04-1).
--
-- WARNING. A line counted short holds the COUNTED quantity in received_qty and
-- the manifest quantity in shipped_qty. Dropping shipped_qty loses the manifest
-- quantity for good. Before running this, for every row returned by
--   select id, manifest_id, product_name, received_qty, shipped_qty, status
--   from public.inventory_lots where shipped_qty is not null;
-- decide with the owner:
--   * still staged (quarantine / pending) -> press Recount on the line and enter
--     the manifest quantity (clears the short count), or refuse the line;
--   * already finalized (active / sold_out) -> the counted quantity IS what came
--     in and what CCRS and the vendor bill were told; keep a copy of the query
--     result with the delivery's paperwork before dropping the columns.
-- After this rollback the receiving page hides Count short again (it reads the
-- columns as missing) and Finalize works as before 0319.
begin;
alter table public.inventory_lots drop constraint if exists inventory_lots_short_reason_code_chk;
alter table public.inventory_lots drop constraint if exists inventory_lots_shipped_qty_chk;
alter table public.inventory_lots drop column if exists counted_at;
alter table public.inventory_lots drop column if exists counted_by;
alter table public.inventory_lots drop column if exists short_reason;
alter table public.inventory_lots drop column if exists short_reason_code;
alter table public.inventory_lots drop column if exists shipped_qty;
commit;
notify pgrst, 'reload schema';
