-- scripts/recon/platform-health-0331-pg-check.sql  (slice G-71a - migration 0331)
--
-- Scenario check for 0331_platform_health.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: nothing remains.
--   * 0331 applies twice (idempotent);
--   * service_role can call platform_db_contract_check and write/read the run
--     log; anon / authenticated can do neither; service_role cannot UPDATE or
--     DELETE a run (append-only);
--   * on a healthy database the check is all clear for a real contract slice;
--   * it reproduces the R-RET incident: revoke record_customer_return from
--     service_role and the check reports it unreachable AND in the sweep;
--   * a name that does not exist is reported missing, never an error;
--   * a junk name is ignored (only identifiers are checked);
--   * removing 0330's default privileges flips default_privileges_ok to false.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/platform-health-0331-pg-check.sql
--
-- "PLATFORM HEALTH 0331 CHECK PASSED" then ROLLBACK = all clear.
begin;

\i supabase/migrations/0331_platform_health.sql
\i supabase/migrations/0331_platform_health.sql

-- 1. Grants: server only, append-only.
do $$ begin
  assert has_function_privilege('service_role', 'public.platform_db_contract_check(text[], text[])', 'EXECUTE'), 'service_role may run the check';
  assert not has_function_privilege('anon', 'public.platform_db_contract_check(text[], text[])', 'EXECUTE'), 'anon may not';
  assert not has_function_privilege('authenticated', 'public.platform_db_contract_check(text[], text[])', 'EXECUTE'), 'authenticated may not';
  assert has_table_privilege('service_role', 'public.platform_health_runs', 'SELECT'), 'service_role reads runs';
  assert has_table_privilege('service_role', 'public.platform_health_runs', 'INSERT'), 'service_role adds runs';
  assert not has_table_privilege('service_role', 'public.platform_health_runs', 'UPDATE'), 'runs are never changed';
  assert not has_table_privilege('service_role', 'public.platform_health_runs', 'DELETE'), 'runs are never deleted';
  assert not has_table_privilege('anon', 'public.platform_health_runs', 'SELECT'), 'anon cannot read runs';
  assert not has_table_privilege('authenticated', 'public.platform_health_runs', 'SELECT'), 'authenticated cannot read runs';
end $$;

-- 2. As service_role: a healthy answer and a stored run.
create or replace function pg_temp.check_as_service_role(t text[], f text[]) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role service_role;
  r := public.platform_db_contract_check(t, f);
  reset role;
  return r;
end $$;

do $$
declare r jsonb;
begin
  r := pg_temp.check_as_service_role(
    array['orders', 'order_lines', 'inventory_lots', 'customer_returns', 'platform_health_runs', 'nope_not_a_table', 'Bad Name;drop'],
    array['record_customer_return', 'apply_lot_delta', 'platform_db_contract_check', 'nope_not_a_function']);
  assert r->'unreachable_tables' = '[]'::jsonb, 'healthy: no unreachable tables: ' || r::text;
  assert r->'unreachable_functions' = '[]'::jsonb, 'healthy: no unreachable functions: ' || r::text;
  assert r->'missing_tables' = '["nope_not_a_table"]'::jsonb, 'missing table reported: ' || r::text;
  assert r->'missing_functions' = '["nope_not_a_function"]'::jsonb, 'missing function reported: ' || r::text;
  assert (r->>'checked_tables')::int = 6, 'the junk name is not checked: ' || r::text;
  assert (r->>'checked_functions')::int = 4, 'four functions checked';
  assert r->'public_unreachable' = '[]'::jsonb, 'after 0330 nothing in public is out of reach: ' || r::text;
  assert (r->>'default_privileges_ok')::boolean, '0330 default privileges detected';
end $$;

set local role service_role;
insert into public.platform_health_runs (kind, status, summary, report, source)
  values ('db_contract', 'ok', 'All clear', '{}'::jsonb, 'cron');
do $$ begin
  assert (select count(*) from public.platform_health_runs where kind = 'db_contract') >= 1, 'service_role stored a run';
end $$;
reset role;

create or replace function pg_temp.try_as(r text, sql text) returns text language plpgsql as $$
begin
  execute format('set local role %I', r);
  begin
    execute sql;
  exception when others then
    reset role;
    return sqlerrm;
  end;
  reset role;
  return 'ran';
end $$;
do $$ begin
  assert pg_temp.try_as('service_role', 'update public.platform_health_runs set status = ''fail''') like 'permission denied%', 'server cannot rewrite history';
  assert pg_temp.try_as('service_role', 'delete from public.platform_health_runs') like 'permission denied%', 'server cannot delete history';
  assert pg_temp.try_as('anon', 'select public.platform_db_contract_check(array[''orders''], null)') like 'permission denied%', 'browser cannot run the check';
  assert pg_temp.try_as('service_role', 'insert into public.platform_health_runs (kind, status, summary, source) values (''db_contract'', ''bogus'', ''x'', ''cron'')') like '%check constraint%', 'status is constrained';
end $$;

-- 3. The R-RET incident, seen by the monitor.
revoke execute on function public.record_customer_return(uuid, numeric, text, uuid, boolean, jsonb, jsonb) from service_role;
do $$
declare r jsonb;
begin
  r := pg_temp.check_as_service_role(array['orders'], array['record_customer_return']);
  assert r->'unreachable_functions' = '["record_customer_return"]'::jsonb, 'incident: function reported unreachable: ' || r::text;
  assert exists (select 1 from jsonb_array_elements_text(r->'public_unreachable') x where x like 'function record_customer_return(%'),
    'incident: the sweep names it with its arguments: ' || r::text;
end $$;
\i supabase/migrations/0330_service_role_grants.sql
do $$ begin
  assert pg_temp.check_as_service_role(array['orders'], array['record_customer_return'])->'unreachable_functions' = '[]'::jsonb,
    're-running 0330 clears it, as the alert says';
end $$;

-- 4. A locked table outside the contract is still found.
revoke select on table public.supply_runs from service_role;
do $$ begin
  assert pg_temp.check_as_service_role(array['orders'], array[]::text[])->'public_unreachable' ? 'table supply_runs', 'sweep finds a locked table';
end $$;

-- 5. Default privileges removed -> flagged.
alter default privileges for role postgres in schema public revoke all on tables from service_role;
alter default privileges for role postgres in schema public revoke all on functions from service_role;
do $$ begin
  assert not (pg_temp.check_as_service_role(array['orders'], null)->>'default_privileges_ok')::boolean, 'missing default grants are flagged';
end $$;

-- 6. Null inputs are safe.
do $$ begin
  assert (pg_temp.check_as_service_role(null, null)->>'checked_tables')::int = 0, 'null contract checks nothing, no error';
end $$;

\echo 'PLATFORM HEALTH 0331 CHECK PASSED'
rollback;
