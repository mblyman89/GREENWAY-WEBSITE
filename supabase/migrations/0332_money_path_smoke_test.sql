-- 0332_money_path_smoke_test.sql  (slice G-71c · owner message 12 · platform early warning, item 3)
--
-- WHY. The owner, verbatim (message 12):
--   "Let's build 1-4 first. I see real value in all of them."
-- Item 3 was a daily test run of a sale, a return and the till that undoes
-- everything. G-71a asks the catalog "may the server use these objects?".
-- This asks the stronger question: "can the server actually DO a sale, a
-- return and a till today?" It catches what a grant check cannot: a new check
-- constraint, a changed function signature, a trigger that now refuses, a
-- column the code writes that no longer exists, a timeout.
--
-- WHAT. One function, platform_money_smoke_test() -> jsonb. In ONE inner
-- block it does, as the caller (service_role, security invoker, so the real
-- server permissions are tested), the same writes the app does:
--    1 register        insert registers (inactive, named __smoke__)
--    2 drawer_open     insert drawer_sessions (open) + drawer_counts (open)
--    3 lot             insert inventory_lots (5 units, active)
--    4 sale_order      insert orders (register sale, walk-in; number assigned by trigger)
--    5 sale_lines      insert order_lines
--    6 sale_event      insert order_events (placed)
--    7 sale_complete   update orders ready -> completed (compare-and-set)
--    8 decrement       apply_lot_delta(lot, -1) = 4
--    9 ledger          gl_submit_journal(... 'pos_sale', draft) balanced 2 lines
--   10 return          record_customer_return(lot, 1, ...) -> lot back to 5
--   11 cash_drop       insert drawer_drops
--   12 drawer_close    update drawer_sessions open -> closed + drawer_counts (close)
--   13 verify          the numbers add up (lot 5, order completed, return row, journal draft)
-- then raises GREENWAY_SMOKE_ROLLBACK, which rolls the whole inner block back.
-- NOTHING REMAINS: no row, no journal number (the journal stays a draft, so
-- gl_next_journal_no never runs), no order name (assign_order_name is not
-- called; the order number is random text, not a sequence). Database webhooks
-- (pg_net queue rows) and Realtime (logical replication) never see a
-- rolled-back write.
--
-- It reports every step it passed and, on failure, the step, SQLSTATE and
-- message, so the app can say "returns broke: permission denied on
-- customer_returns, run ..." the morning it happens.
--
-- Deliberate (standing rule 15): volatile, security invoker, pinned
-- search_path, statement/lock timeouts, execute for service_role only.
-- Safe to re-run (create or replace; idempotent grants).
-- Rollback: supabase/rollbacks/0332_money_path_smoke_test.rollback.sql.
-- PG check: scripts/recon/money-smoke-0332-pg-check.sql.

do $precheck$
begin
  if to_regclass('public.platform_health_runs') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0332 depends on platform_health_runs from 0331_platform_health.sql';
  end if;
  if to_regprocedure('public.record_customer_return(uuid,numeric,text,uuid,boolean,jsonb,jsonb)') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0332 depends on record_customer_return (0330)';
  end if;
  if to_regprocedure('public.apply_lot_delta(uuid,numeric,boolean,uuid,boolean)') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0332 depends on apply_lot_delta (0129)';
  end if;
  if to_regprocedure('public.gl_submit_journal(text,date,text,text,text,jsonb,text,bigint,boolean,text,uuid,boolean)') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0332 depends on gl_submit_journal';
  end if;
end
$precheck$;

create or replace function public.platform_money_smoke_test()
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
set statement_timeout = '20s'
set lock_timeout = '5s'
as $fn$
declare
  v_marker   constant text := 'GREENWAY_SMOKE_ROLLBACK';
  v_day      date := (now() at time zone 'America/Los_Angeles')::date;
  v_tag      text := '__smoke__ ' || gen_random_uuid()::text;
  v_step     text := 'start';
  v_passed   text[] := array[]::text[];
  v_failed   jsonb := null;
  v_started  timestamptz := clock_timestamp();
  v_register uuid;
  v_session  uuid;
  v_lot      uuid;
  v_order    uuid;
  v_order_no text;
  v_line     uuid;
  v_qty      numeric;
  v_status   text;
  v_journal  jsonb;
  v_return   jsonb;
  v_n        integer;
begin
  begin
    v_step := 'register';
    insert into public.registers (name, kind, active, notes)
    values (v_tag, 'sales', false, 'G-71c money-path smoke test; always rolled back')
    returning id into v_register;
    v_passed := v_passed || v_step;

    v_step := 'drawer_open';
    insert into public.drawer_sessions (register_id, business_day, status, opening_count_minor, opened_at)
    values (v_register, v_day, 'open', 10000, now())
    returning id into v_session;
    insert into public.drawer_counts (session_id, count_type, twenties, total_minor)
    values (v_session, 'open', 5, 10000);
    v_passed := v_passed || v_step;

    v_step := 'lot';
    insert into public.inventory_lots (product_name, on_hand_qty, held_qty, status)
    values (v_tag, 5, 0, 'active')
    returning id into v_lot;
    v_passed := v_passed || v_step;

    v_step := 'sale_order';
    insert into public.orders (
      status, origin, customer_first_name, subtotal_minor_units, estimated_tax_minor_units,
      savings_minor_units, total_minor_units, item_count, staff_note, pos_client_uuid
    ) values (
      'ready', 'register', 'Walk-in', 1000, 0, 0, 1000, 1, v_tag, gen_random_uuid()
    )
    returning id, order_number into v_order, v_order_no;
    if coalesce(v_order_no, '') = '' then
      raise exception 'SMOKE_NO_ORDER_NUMBER: the order number trigger did not assign a number';
    end if;
    v_passed := v_passed || v_step;

    v_step := 'sale_lines';
    insert into public.order_lines (order_id, product_id, product_name, category, quantity, price_minor_units, regular_price_minor_units)
    values (v_order, null, v_tag, 'flower', 1, 1000, 1000)
    returning id into v_line;
    v_passed := v_passed || v_step;

    v_step := 'sale_event';
    insert into public.order_events (order_id, event_type, to_status, actor_label, note)
    values (v_order, 'placed', 'ready', 'Smoke test', v_tag);
    v_passed := v_passed || v_step;

    v_step := 'sale_complete';
    update public.orders set status = 'completed'
     where id = v_order and status = 'ready';
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception 'SMOKE_COMPLETE_FAILED: the ready -> completed update changed % rows', v_n;
    end if;
    v_passed := v_passed || v_step;

    v_step := 'decrement';
    v_qty := public.apply_lot_delta(v_lot, -1, false, null, true);
    if v_qty is distinct from 4 then
      raise exception 'SMOKE_DECREMENT_WRONG: expected 4 on hand after selling 1 of 5, got %', v_qty;
    end if;
    v_passed := v_passed || v_step;

    v_step := 'ledger';
    v_journal := public.gl_submit_journal(
      'greenway', v_day, 'pos_sale', 'smoke:' || v_order::text || '#revenue', 'Smoke test sale (rolled back)',
      jsonb_build_array(
        jsonb_build_object('account_code', '10110', 'amount_cents', 1000, 'cost_class', 'none', 'description', 'smoke till'),
        jsonb_build_object('account_code', '50010', 'amount_cents', -1000, 'cost_class', 'none', 'description', 'smoke revenue')
      ),
      null, null, false, null, null, false
    );
    if v_journal->>'status' is distinct from 'draft' then
      raise exception 'SMOKE_LEDGER_WRONG: expected a draft journal, got %', v_journal::text;
    end if;
    v_passed := v_passed || v_step;

    v_step := 'return';
    v_return := public.record_customer_return(
      v_lot, 1, 'G-71c smoke test', null, false, null,
      jsonb_build_object(
        'order_id', v_order, 'order_line_id', v_line, 'product_name', v_tag,
        'sale_date', v_day, 'unit_price_minor', 1000, 'discount_minor', 0,
        'sales_tax_minor', 0, 'excise_minor', 0, 'original_quantity', 1,
        'disposition', 'restock', 'reason', 'other', 'refund_minor_units', 1000
      )
    );
    if v_return->>'return_id' is null then
      raise exception 'SMOKE_RETURN_WRONG: no return id in %', v_return::text;
    end if;
    v_passed := v_passed || v_step;

    v_step := 'cash_drop';
    insert into public.drawer_drops (session_id, amount_minor, drop_window, notes)
    values (v_session, 1000, 'other', v_tag);
    v_passed := v_passed || v_step;

    v_step := 'drawer_close';
    update public.drawer_sessions
       set status = 'closed', closing_count_minor = 9000, closed_at = now()
     where id = v_session and status = 'open';
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception 'SMOKE_CLOSE_FAILED: the open -> closed update changed % rows', v_n;
    end if;
    insert into public.drawer_counts (session_id, count_type, twenties, fifties, total_minor)
    values (v_session, 'close', 2, 1, 9000);
    v_passed := v_passed || v_step;

    v_step := 'verify';
    select on_hand_qty into v_qty from public.inventory_lots where id = v_lot;
    if v_qty is distinct from 5 then
      raise exception 'SMOKE_VERIFY_LOT: expected 5 on hand after the return, got %', v_qty;
    end if;
    select status::text into v_status from public.orders where id = v_order;
    if v_status is distinct from 'completed' then
      raise exception 'SMOKE_VERIFY_ORDER: expected completed, got %', v_status;
    end if;
    select count(*) into v_n from public.customer_returns where order_id = v_order;
    if v_n <> 1 then
      raise exception 'SMOKE_VERIFY_RETURN: expected 1 return row, got %', v_n;
    end if;
    v_passed := v_passed || v_step;

    -- Undo everything above. Caught right below.
    raise exception using errcode = 'P0001', message = v_marker;
  exception when others then
    if sqlerrm <> v_marker then
      v_failed := jsonb_build_object('step', v_step, 'sqlstate', sqlstate, 'message', left(sqlerrm, 500));
    end if;
  end;

  return jsonb_build_object(
    'ok', v_failed is null,
    'passed', to_jsonb(v_passed),
    'failed', v_failed,
    'steps_total', 13,
    'rolled_back', true,
    'ms', (extract(epoch from clock_timestamp() - v_started) * 1000)::integer
  );
end
$fn$;

comment on function public.platform_money_smoke_test() is
  'G-71c (owner message 12): daily money-path test. As the caller (service_role) does a till open, a register sale, the inventory decrement, a draft ledger entry, a customer return, a cash drop and a till close, then rolls ALL of it back. Returns which steps passed and, on failure, the step, SQLSTATE and message. Called by /api/cron/platform-health.';

revoke all on function public.platform_money_smoke_test() from public, anon, authenticated;
grant execute on function public.platform_money_smoke_test() to service_role;

notify pgrst, 'reload schema';
