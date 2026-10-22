-- scripts/recon/orders-updated-at-0292-pg-check.sql  (USAGE-6 - migration 0292)
--
-- Check for 0292_orders_updated_at_indexes.sql on Postgres 15 with every
-- migration applied. Read-only plus EXPLAIN, one transaction, rolled back.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/orders-updated-at-0292-pg-check.sql
--
-- "USAGE 0292 CHECK PASSED" then ROLLBACK = all clear.
begin;

do $$
declare
  plan text;  -- json plan (one row; text format returns one row per line)
  def  text;
begin
  -- 1. both indexes exist, on the right table and column, descending
  select indexdef into def from pg_indexes where schemaname = 'public' and indexname = 'orders_updated_at_idx';
  assert def is not null, 'orders_updated_at_idx exists';
  assert def like '%ON public.orders USING btree (updated_at DESC)%', 'orders_updated_at_idx is btree (updated_at desc) on orders: ' || def;
  select indexdef into def from pg_indexes where schemaname = 'public' and indexname = 'leafly_orders_updated_at_idx';
  assert def is not null, 'leafly_orders_updated_at_idx exists';
  assert def like '%ON public.leafly_orders USING btree (updated_at DESC)%', 'leafly_orders_updated_at_idx is btree (updated_at desc) on leafly_orders: ' || def;

  -- 2. the poll's two max() reads use them (seq scans priced out so an empty
  --    local table cannot hide a missing index)
  set local enable_seqscan = off;
  execute 'explain (format json) select max(updated_at) from public.orders' into plan;
  assert position('"orders_updated_at_idx"' in plan) > 0, 'max(updated_at) on orders uses the index: ' || plan;
  execute 'explain (format json) select max(updated_at) from public.leafly_orders' into plan;
  assert position('"leafly_orders_updated_at_idx"' in plan) > 0, 'max(updated_at) on leafly_orders uses the index: ' || plan;

  -- 3. the snapshot function still answers with the same keys
  assert (select public.orders_board_snapshot(5, null) ?& array['counts', 'arrivals', 'orders_updated_at', 'leafly_updated_at']),
    'orders_board_snapshot keeps its four keys';

  raise notice 'USAGE 0292 CHECK PASSED';
end $$;

rollback;
