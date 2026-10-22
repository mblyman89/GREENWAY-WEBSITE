-- Rollback for 0292_orders_updated_at_indexes.sql (USAGE-6).
--
-- Drops the two indexes. No data is touched; the Orders poll goes back to
-- reading both tables in full every 15 s. Safe to re-run.
drop index if exists public.orders_updated_at_idx;
drop index if exists public.leafly_orders_updated_at_idx;
