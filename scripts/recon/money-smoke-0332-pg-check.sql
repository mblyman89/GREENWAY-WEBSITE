-- scripts/recon/money-smoke-0332-pg-check.sql  (slice G-71c - migration 0332)
--
-- Scenario check for 0332_money_path_smoke_test.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: nothing remains.
--   * 0332 applies twice (idempotent);
--   * only service_role may run it (anon / authenticated / public may not);
--   * as service_role on a healthy database all 13 steps pass;
--   * NOTHING remains afterwards: no register, lot, order, line, event,
--     return, adjustment, journal, drop or count, and no journal number used;
--   * it reproduces the R-RET incident: take record_customer_return away from
--     service_role and the test fails AT THE RETURN STEP with 42501, and still
--     leaves nothing behind;
--   * a broken table write (INSERT on drawer_drops revoked) fails at cash_drop;
--   * it is security invoker, has a pinned search_path and time limits.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/money-smoke-0332-pg-check.sql
--
-- "MONEY SMOKE 0332 CHECK PASSED" then ROLLBACK = all clear.
begin;

\i supabase/migrations/0332_money_path_smoke_test.sql
\i supabase/migrations/0332_money_path_smoke_test.sql

-- 1. Grants and shape (standing rule 15).
do $$
declare p pg_proc%rowtype;
begin
  assert has_function_privilege('service_role', 'public.platform_money_smoke_test()', 'EXECUTE'), 'service_role may run the smoke test';
  assert not has_function_privilege('anon', 'public.platform_money_smoke_test()', 'EXECUTE'), 'anon may not';
  assert not has_function_privilege('authenticated', 'public.platform_money_smoke_test()', 'EXECUTE'), 'authenticated may not';
  select * into p from pg_proc where oid = 'public.platform_money_smoke_test()'::regprocedure;
  assert not p.prosecdef, 'security invoker: it must test the server''s real permissions';
  assert p.provolatile = 'v', 'volatile';
  assert array_to_string(p.proconfig, ',') like '%search_path=pg_catalog, public%', 'pinned search_path: ' || array_to_string(p.proconfig, ',');
  assert array_to_string(p.proconfig, ',') like '%statement_timeout=20s%', 'statement timeout';
  assert array_to_string(p.proconfig, ',') like '%lock_timeout=5s%', 'lock timeout';
end $$;

-- Counts of everything the test touches, before.
create temp table smoke_before as
select
  (select count(*) from public.registers)            as registers,
  (select count(*) from public.drawer_sessions)      as sessions,
  (select count(*) from public.drawer_counts)        as counts,
  (select count(*) from public.drawer_drops)         as drops,
  (select count(*) from public.inventory_lots)       as lots,
  (select count(*) from public.inventory_adjustments) as adjustments,
  (select count(*) from public.orders)               as orders,
  (select count(*) from public.order_lines)          as lines,
  (select count(*) from public.order_events)         as events,
  (select count(*) from public.customer_returns)     as returns,
  (select count(*) from public.gl_journals)          as journals,
  (select count(*) from public.gl_journal_lines)     as journal_lines,
  (select coalesce(sum(next_no), 0) from public.gl_journal_sequences) as journal_seq;
grant select on smoke_before to service_role;

create or replace function pg_temp.smoke_as_service_role() returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role service_role;
  r := public.platform_money_smoke_test();
  reset role;
  return r;
end $$;

create or replace function pg_temp.assert_nothing_left(label text) returns void language plpgsql as $$
declare b smoke_before%rowtype;
begin
  select * into b from smoke_before;
  assert (select count(*) from public.registers) = b.registers, label || ': no register left';
  assert (select count(*) from public.drawer_sessions) = b.sessions, label || ': no drawer session left';
  assert (select count(*) from public.drawer_counts) = b.counts, label || ': no drawer count left';
  assert (select count(*) from public.drawer_drops) = b.drops, label || ': no drop left';
  assert (select count(*) from public.inventory_lots) = b.lots, label || ': no lot left';
  assert (select count(*) from public.inventory_adjustments) = b.adjustments, label || ': no adjustment left';
  assert (select count(*) from public.orders) = b.orders, label || ': no order left';
  assert (select count(*) from public.order_lines) = b.lines, label || ': no order line left';
  assert (select count(*) from public.order_events) = b.events, label || ': no order event left';
  assert (select count(*) from public.customer_returns) = b.returns, label || ': no return left';
  assert (select count(*) from public.gl_journals) = b.journals, label || ': no journal left';
  assert (select count(*) from public.gl_journal_lines) = b.journal_lines, label || ': no journal line left';
  assert (select coalesce(sum(next_no), 0) from public.gl_journal_sequences) = b.journal_seq, label || ': no journal number used';
  assert not exists (select 1 from public.orders where staff_note like '__smoke__%'), label || ': no smoke order';
end $$;

-- 2. Healthy: every step passes, nothing remains.
do $$
declare r jsonb;
begin
  r := pg_temp.smoke_as_service_role();
  assert (r->>'ok')::boolean, 'healthy database: smoke test passes: ' || r::text;
  assert jsonb_array_length(r->'passed') = 13, 'all 13 steps: ' || r::text;
  assert r->'passed' = '["register","drawer_open","lot","sale_order","sale_lines","sale_event","sale_complete","decrement","ledger","return","cash_drop","drawer_close","verify"]'::jsonb, 'steps in order: ' || r::text;
  assert r->'failed' = 'null'::jsonb, 'no failure: ' || r::text;
  assert (r->>'rolled_back')::boolean, 'reports the rollback';
  perform pg_temp.assert_nothing_left('healthy');
end $$;

-- 3. R-RET reproduced: the server loses record_customer_return.
revoke execute on function public.record_customer_return(uuid, numeric, text, uuid, boolean, jsonb, jsonb) from service_role;
do $$
declare r jsonb;
begin
  r := pg_temp.smoke_as_service_role();
  assert not (r->>'ok')::boolean, 'R-RET: the smoke test fails: ' || r::text;
  assert r->'failed'->>'step' = 'return', 'R-RET: fails at the return step: ' || r::text;
  assert r->'failed'->>'sqlstate' = '42501', 'R-RET: permission denied: ' || r::text;
  assert r->'passed' ? 'ledger' and not (r->'passed' ? 'return'), 'R-RET: earlier steps passed, return did not: ' || r::text;
  perform pg_temp.assert_nothing_left('R-RET');
end $$;
grant execute on function public.record_customer_return(uuid, numeric, text, uuid, boolean, jsonb, jsonb) to service_role;

-- 4. A table write breaks: the server loses INSERT on drawer_drops.
revoke insert on table public.drawer_drops from service_role;
do $$
declare r jsonb;
begin
  r := pg_temp.smoke_as_service_role();
  assert not (r->>'ok')::boolean, 'drops: fails: ' || r::text;
  assert r->'failed'->>'step' = 'cash_drop', 'drops: fails at cash_drop: ' || r::text;
  assert r->'failed'->>'sqlstate' = '42501', 'drops: permission denied: ' || r::text;
  perform pg_temp.assert_nothing_left('drops');
end $$;
grant insert on table public.drawer_drops to service_role;

-- 5. Healthy again after the grants are back.
do $$
declare r jsonb;
begin
  r := pg_temp.smoke_as_service_role();
  assert (r->>'ok')::boolean, 'healthy again: ' || r::text;
  perform pg_temp.assert_nothing_left('healthy again');
end $$;

\echo MONEY SMOKE 0332 CHECK PASSED
rollback;
