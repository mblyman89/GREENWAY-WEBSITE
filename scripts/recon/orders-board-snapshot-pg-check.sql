-- scripts/recon/orders-board-snapshot-pg-check.sql  (USAGE-3)
--
-- Scenario check for orders_board_snapshot() against a real Postgres that has
-- every migration applied (scripts/compliance/verify-migrations-execute.ts).
-- Runs in ONE transaction that is rolled back, so it leaves no rows behind.
-- Every `assert` raises on failure; a silent run followed by ROLLBACK is the
-- all-clear.
--
--   PATH=/usr/lib/postgresql/15/bin:$PATH psql \
--     'postgres://postgres@/greenway?host=/tmp/pgsock&port=5433' \
--     -v ON_ERROR_STOP=1 -f scripts/recon/orders-board-snapshot-pg-check.sql
begin;

-- Seed: 5 orders across statuses and origins, 1 Leafly order.
insert into public.orders (id, order_number, status, origin, placed_at, display_name, customer_first_name, subtotal_minor_units, estimated_tax_minor_units, savings_minor_units, total_minor_units, item_count)
values
  ('00000000-0000-0000-0000-000000000001', 'GW-1', 'new',       'greenway', now() - interval '5 minutes', 'Comet', 'A', 100, 0, 0, 100, 1),
  ('00000000-0000-0000-0000-000000000002', 'GW-2', 'new',       'leafly',   now() - interval '4 minutes', null,    'B', 100, 0, 0, 100, 1),
  ('00000000-0000-0000-0000-000000000003', 'GW-3', 'ready',     'greenway', now() - interval '3 minutes', 'Nova',  'C', 100, 0, 0, 100, 1),
  ('00000000-0000-0000-0000-000000000004', 'GW-4', 'completed', 'register', now() - interval '2 minutes', null,    'D', 100, 0, 0, 100, 1),
  ('00000000-0000-0000-0000-000000000005', 'GW-5', 'cancelled', 'greenway', now() - interval '1 minute',  'Zed',   'E', 100, 0, 0, 100, 1);

do $$
declare
  snap jsonb;
  snap_ex jsonb;
  snap_two jsonb;
  expected_orders_updated timestamptz;
begin
  snap := public.orders_board_snapshot();

  -- 1. Every enum label present, counts agree with a direct group-by.
  assert (select count(*) from jsonb_object_keys(snap->'counts')) = 7, 'seven status keys';
  assert (snap->'counts'->>'new')::int = (select count(*) from public.orders where status = 'new'), 'new count';
  assert (snap->'counts'->>'ready')::int = (select count(*) from public.orders where status = 'ready'), 'ready count';
  assert (snap->'counts'->>'completed')::int = (select count(*) from public.orders where status = 'completed'), 'completed count';
  assert (snap->'counts'->>'cancelled')::int = (select count(*) from public.orders where status = 'cancelled'), 'cancelled count';
  assert (snap->'counts'->>'acknowledged')::int = (select count(*) from public.orders where status = 'acknowledged'), 'acknowledged count';
  assert (snap->'counts'->>'preparing')::int = (select count(*) from public.orders where status = 'preparing'), 'preparing count';
  assert (snap->'counts'->>'no_show')::int = (select count(*) from public.orders where status = 'no_show'), 'no_show count';

  -- 2. Arrivals: newest first, same columns the legacy query selected.
  assert jsonb_array_length(snap->'arrivals') = least(20, (select count(*) from public.orders)), 'arrivals length';
  assert snap->'arrivals'->0->>'order_number' = (select order_number from public.orders order by placed_at desc limit 1), 'newest arrival first';
  assert snap->'arrivals'->0 ? 'id' and snap->'arrivals'->0 ? 'placed_at' and snap->'arrivals'->0 ? 'display_name', 'arrival keys';
  assert snap->'arrivals'->0->>'display_name' = 'Zed', 'display_name carried through';
  assert (snap->'arrivals'->1->>'display_name') is null, 'null display_name stays null';

  -- 3. Latest change stamps.
  select max(updated_at) into expected_orders_updated from public.orders;
  assert (snap->>'orders_updated_at')::timestamptz = expected_orders_updated, 'orders_updated_at is max(updated_at)';
  assert (snap->'leafly_updated_at') = 'null'::jsonb, 'no leafly rows -> null';

  -- 4. Limit honoured and clamped.
  snap_two := public.orders_board_snapshot(2);
  assert jsonb_array_length(snap_two->'arrivals') = 2, 'limit 2';
  assert jsonb_array_length(public.orders_board_snapshot(0)->'arrivals') = 0, 'limit 0 -> none';
  assert jsonb_array_length(public.orders_board_snapshot(500)->'arrivals') = least(100, (select count(*) from public.orders)), 'limit clamps at 100';

  -- 5. Origin exclusion matches the board page's L-38 rule (counts only).
  snap_ex := public.orders_board_snapshot(20, array['leafly']);
  assert (snap_ex->'counts'->>'new')::int = (select count(*) from public.orders where status = 'new' and origin <> 'leafly'), 'excluded leafly from new';
  assert (snap_ex->'counts'->>'completed')::int = (select count(*) from public.orders where status = 'completed'), 'register order still counted';
  assert jsonb_array_length(snap_ex->'arrivals') = jsonb_array_length(snap->'arrivals'), 'exclusion does not touch arrivals';
  assert public.orders_board_snapshot(20, array[]::text[])->'counts' = snap->'counts', 'empty exclusion list = no exclusion';

  -- 6. Empty-table shape: still every key, zero counts, empty array.
  delete from public.orders;
  snap := public.orders_board_snapshot();
  assert (snap->'counts'->>'new')::int = 0 and (select count(*) from jsonb_object_keys(snap->'counts')) = 7, 'empty table keeps all seven zero keys';
  assert snap->'arrivals' = '[]'::jsonb, 'empty table -> [] arrivals';
  assert snap->'orders_updated_at' = 'null'::jsonb, 'empty table -> null orders_updated_at';

  raise notice 'orders_board_snapshot: all scenario assertions passed';
end
$$;

rollback;
