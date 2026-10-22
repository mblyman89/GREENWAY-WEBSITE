-- =============================================================================
-- Migration 0292 - USAGE-6: stop two whole-table reads on every orders poll
-- =============================================================================
-- Why (Supabase warned on 2026-10-21 that project gidjmpjexowzorfdfbss is
-- depleting its Disk IO Budget):
--
--   The Orders dashboard polls /api/admin/orders/count every 15 s per open
--   tab (120 s while hidden). That calls orders_board_snapshot() (0233), which
--   ends with
--       (select max(updated_at) from public.orders)
--       (select max(updated_at) from public.leafly_orders)
--   Neither column has an index (0007 indexes orders on status, placed_at,
--   customer_phone, public_token; 0225 indexes leafly_orders on status and
--   the local order), so Postgres reads EVERY row of both tables to find one
--   timestamp: about 5,760 full reads of each table per day per open tab.
--   orders grows with every register sale (sync-store materializes each one),
--   so the cost keeps rising. Checked on a local Postgres 15 with every
--   migration applied: EXPLAIN shows "Seq Scan on orders" and "Seq Scan on
--   leafly_orders" under the aggregate; with these indexes it is a
--   "Limit -> Index Only Scan Backward" (one page or two).
--
-- What: two plain b-tree indexes, nothing else. No table, column, row,
-- function or grant changes; the app code is unchanged. The function keeps
-- working before this file is run (just slower).
--
-- Size and locking: CREATE INDEX blocks writes to that table while it builds.
-- On Greenway's tables that is seconds. Run it outside opening hours if you
-- like. (CREATE INDEX CONCURRENTLY cannot run inside the SQL editor's
-- transaction, so it is not used.)
--
-- APPLIED BY HAND (AGENTS rule 6). Safe to re-run (if not exists).
-- Rollback: supabase/rollbacks/0292_orders_updated_at_indexes.rollback.sql
-- =============================================================================

do $precheck$
begin
  if to_regclass('public.orders') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0292 indexes public.orders, created by 0007_slice7_orders.sql. Run the earlier migrations first.';
  end if;
  if to_regclass('public.leafly_orders') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0292 indexes public.leafly_orders, created by 0225_leafly_order_webhooks.sql. Run the earlier migrations first.';
  end if;
  if to_regclass('public.ach_control_records') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: run 0291_ach_control_records.sql before 0292.';
  end if;
end
$precheck$;

create index if not exists orders_updated_at_idx
  on public.orders (updated_at desc);

create index if not exists leafly_orders_updated_at_idx
  on public.leafly_orders (updated_at desc);

comment on index public.orders_updated_at_idx is
  'USAGE-6: makes max(updated_at) in orders_board_snapshot() an index lookup instead of a whole-table read on every 15 s Orders poll.';
comment on index public.leafly_orders_updated_at_idx is
  'USAGE-6: makes max(updated_at) in orders_board_snapshot() an index lookup instead of a whole-table read on every 15 s Orders poll.';

analyze public.orders;
analyze public.leafly_orders;
