-- scripts/recon/service-role-grants-0330-pg-check.sql  (slice R-RET - migration 0330)
--
-- Scenario check for 0330_service_role_grants.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: nothing remains.
--   * reproduces the owner's error: with Supabase's post-2026-10-30 defaults,
--     0308 leaves service_role unable to call record_customer_return
--     ("permission denied for function record_customer_return");
--   * 0330 fixes it, twice (idempotent), and a REAL customer return then saves
--     as service_role (adjustment + stock + customer_returns row);
--   * the other server-called functions (0309 vendor returns, 0323 Other
--     Inventory) and the grant-less tables (0311/0312/0317/0318/0327) are reached;
--   * anon / authenticated gain NOTHING (0308's revoke still stands);
--   * append-only ledgers keep their update/delete revokes (audit_logs, ACH, OFAC);
--   * a table and a function created AFTER 0330 are reachable by service_role
--     (default privileges), and still not by anon.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/service-role-grants-0330-pg-check.sql
--
-- "GRANTS 0330 CHECK PASSED" then ROLLBACK = all clear.
begin;

-- 0. Supabase after 2026-10-30: nothing is granted automatically.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;
revoke all on table public.checklist_runs, public.recall_events, public.supply_runs from service_role;

-- 1. The state 0308 leaves when it is applied under those defaults: its own
--    `revoke execute ... from public, anon, authenticated` and no grant, so
--    nobody but the owner role may call it. (0308 is not \i'd here because it
--    carries its own begin/commit, which would end this check's transaction.)
revoke execute on function public.record_customer_return(uuid, numeric, text, uuid, boolean, jsonb, jsonb)
  from public, anon, authenticated, service_role;
do $$ begin
  assert not has_function_privilege('service_role',
    'public.record_customer_return(uuid, numeric, text, uuid, boolean, jsonb, jsonb)', 'EXECUTE'),
    'precondition: 0308 alone leaves service_role without EXECUTE';
end $$;

create or replace function pg_temp.call_as_service_role() returns text language plpgsql as $$
begin
  set local role service_role;
  begin
    perform public.record_customer_return(gen_random_uuid(), 1, 'x', null, false, null, null);
  exception when others then
    reset role;
    return sqlerrm;
  end;
  reset role;
  return 'ran';
end $$;
do $$ begin
  assert pg_temp.call_as_service_role() = 'permission denied for function record_customer_return',
    'precondition: the owner''s exact error is reproduced';
end $$;

-- 2. Apply 0330 twice.
\i supabase/migrations/0330_service_role_grants.sql
\i supabase/migrations/0330_service_role_grants.sql

do $$
declare sig text;
begin
  foreach sig in array array[
    'public.record_customer_return(uuid, numeric, text, uuid, boolean, jsonb, jsonb)',
    'public.consume_lot_hold(uuid, numeric, uuid)',
    'public.release_lot_hold(uuid, numeric, uuid)',
    'public.reserve_vendor_return(uuid, numeric, uuid, jsonb)',
    'public.depart_vendor_return(uuid, text, timestamptz, text, uuid)',
    'public.release_vendor_return(uuid, text, uuid)',
    'public.apply_noncannabis_delta(uuid, integer, text, text, uuid, boolean, uuid, uuid)',
    'public.record_noncannabis_invoice(jsonb, jsonb, uuid)',
    'public.record_noncannabis_return(uuid, integer, boolean, text, uuid, jsonb)',
    'public.inventory_audit_counter_check(uuid, boolean)'
  ] loop
    assert has_function_privilege('service_role', sig, 'EXECUTE'), format('service_role can call %s', sig);
    assert not has_function_privilege('anon', sig, 'EXECUTE'), format('anon still cannot call %s', sig);
    assert not has_function_privilege('authenticated', sig, 'EXECUTE'), format('authenticated still cannot call %s', sig);
  end loop;
end $$;

-- every non-trigger function and every non-ledger table is now reachable
do $$ begin
  assert not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind in ('f', 'p') and p.prorettype <> 'trigger'::regtype
       and not has_function_privilege('service_role', p.oid, 'EXECUTE')), 'no public function is out of reach';
  assert not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
       and not has_table_privilege('service_role', c.oid, 'SELECT')), 'no public table/view is unreadable';
  assert has_table_privilege('service_role', 'public.checklist_runs', 'INSERT,UPDATE,DELETE'), 'checklists writable';
  assert has_table_privilege('service_role', 'public.recall_events', 'INSERT,UPDATE'), 'recalls writable';
  assert has_table_privilege('service_role', 'public.supply_runs', 'INSERT'), 'supply runs writable';
  assert has_sequence_privilege('service_role', 'public.recall_events_event_number_seq', 'USAGE'), 'recall number sequence usable';
  assert not has_table_privilege('anon', 'public.checklist_runs', 'SELECT'), 'anon gained nothing on checklists';
  assert not has_table_privilege('authenticated', 'public.recall_events', 'INSERT'), 'authenticated gained nothing on recalls';
end $$;

-- append-only ledgers: never widened
do $$
declare t text;
begin
  foreach t in array array['audit_logs', 'ach_timberland_comms', 'ofac_screening_runs', 'ach_control_records', 'ach_annual_reviews'] loop
    assert not has_table_privilege('service_role', format('public.%I', t), 'UPDATE'), format('%s: update still revoked', t);
    assert not has_table_privilege('service_role', format('public.%I', t), 'DELETE'), format('%s: delete still revoked', t);
  end loop;
  foreach t in array array['ach_files', 'ach_change_requests', 'ach_notice_mail', 'ach_bank_watch_rules'] loop
    assert not has_table_privilege('service_role', format('public.%I', t), 'DELETE'), format('%s: delete still revoked', t);
  end loop;
end $$;

-- 3. A REAL return, as the server (service_role), saves atomically.
insert into public.inventory_lots (id, lot_code, product_name, received_qty, on_hand_qty, unit, unit_cost_minor_units)
values ('03300000-0000-4000-8000-000000000001', 'L0330', 'Check flower 0330', 10, 4, 'each', 500);

set local role service_role;
select public.record_customer_return(
  '03300000-0000-4000-8000-000000000001', 1, 'customer return 0330 check', null, false, null,
  jsonb_build_object('product_name', 'Check flower 0330', 'disposition', 'restock', 'reason', 'other',
                     'refund_minor_units', 1500, 'sale_date', '2026-10-31')) as saved \gset
reset role;

do $$ begin
  assert (select on_hand_qty from public.inventory_lots where id = '03300000-0000-4000-8000-000000000001') = 5,
    'restocked unit is back on hand';
  assert (select count(*) from public.customer_returns where lot_id = '03300000-0000-4000-8000-000000000001'
            and refund_minor_units = 1500 and disposition = 'restock' and adjustment_id is not null) = 1,
    'return row saved with its adjustment';
  assert (select count(*) from public.inventory_adjustments where lot_id = '03300000-0000-4000-8000-000000000001'
            and reason = 'return' and qty_delta = 1) = 1, 'adjustment saved';
end $$;

-- 4. Objects created AFTER 0330 are reachable by service_role, not by anon.
create table public.zz_0330_probe (id int primary key);
create function public.zz_0330_probe_fn() returns int language sql as $f$ select 1 $f$;
revoke execute on function public.zz_0330_probe_fn() from public, anon, authenticated;
do $$ begin
  assert has_table_privilege('service_role', 'public.zz_0330_probe', 'SELECT,INSERT,UPDATE,DELETE'),
    'new table: service_role by default';
  assert not has_table_privilege('anon', 'public.zz_0330_probe', 'SELECT'), 'new table: anon stays explicit';
  assert has_function_privilege('service_role', 'public.zz_0330_probe_fn()', 'EXECUTE'),
    'new function: service_role keeps EXECUTE even after revoking from public/anon/authenticated';
end $$;

-- 5. The rollback takes back only the defaults, never the object grants.
\i supabase/rollbacks/0330_service_role_grants.rollback.sql
create table public.zz_0330_probe_after_rollback (id int primary key);
do $$ begin
  assert has_function_privilege('service_role',
    'public.record_customer_return(uuid, numeric, text, uuid, boolean, jsonb, jsonb)', 'EXECUTE'),
    'rollback keeps the return grant';
  assert not has_table_privilege('service_role', 'public.zz_0330_probe_after_rollback', 'SELECT'),
    'rollback restores the post-2026-10-30 default';
end $$;

\echo 'GRANTS 0330 CHECK PASSED'
rollback;
