-- scripts/recon/cultivera-history-0338-pg-check.sql  (CVB-8 - migration 0338)
--
-- Scenario check for 0338_cultivera_history_days.sql on Postgres 15 with every migration applied.
-- ONE transaction, rolled back: nothing remains.
--   * 0338 applies twice (idempotent);
--   * grants: service_role select / insert / update, never delete; nothing for anon / authenticated;
--     RLS on; the function is service_role only;
--   * days are stored in cents; an older run never overwrites a newer day;
--   * an unknown run, a non-list and a bad check status are refused.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/cultivera-history-0338-pg-check.sql
--
-- "CULTIVERA HISTORY 0338 CHECK PASSED" then ROLLBACK = all clear.
begin;

\i supabase/migrations/0338_cultivera_history_days.sql
\i supabase/migrations/0338_cultivera_history_days.sql

do $$
begin
  assert has_table_privilege('service_role', 'public.cultivera_history_days', 'SELECT'), 'service_role reads';
  assert has_table_privilege('service_role', 'public.cultivera_history_days', 'INSERT'), 'service_role inserts';
  assert has_table_privilege('service_role', 'public.cultivera_history_days', 'UPDATE'), 'days may be refreshed';
  assert not has_table_privilege('service_role', 'public.cultivera_history_days', 'DELETE'), 'days never deleted';
  assert not has_table_privilege('anon', 'public.cultivera_history_days', 'SELECT'), 'anon cannot read';
  assert not has_table_privilege('authenticated', 'public.cultivera_history_days', 'SELECT'), 'authenticated cannot read';
  assert (select relrowsecurity from pg_class where oid = 'public.cultivera_history_days'::regclass), 'RLS on';
  assert has_function_privilege('service_role', 'public.cvb_upsert_history_days(text, jsonb)', 'EXECUTE'), 'fn: service_role';
  assert not has_function_privilege('anon', 'public.cvb_upsert_history_days(text, jsonb)', 'EXECUTE'), 'fn: not anon';
  assert not has_function_privilege('authenticated', 'public.cvb_upsert_history_days(text, jsonb)', 'EXECUTE'), 'fn: not authenticated';
end $$;

create or replace function pg_temp.hist(run text, rows jsonb) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role service_role;
  r := public.cvb_upsert_history_days(run, rows);
  reset role;
  return r;
end $$;

do $$
declare
  r jsonb;
  day1 jsonb := '{"day": "2025-10-31", "revenue_minor": 888634, "returned_minor": 0, "orders": 212, "units": 410.5,
                  "daily_check_minor": 888634, "diff_minor": 0, "check_status": "match"}';
begin
  insert into public.cultivera_archive_runs (run_id, captured_at, manifest_sha256, file_count, total_bytes, total_rows)
  values ('20261101T200000Z-0338abcd', '2026-11-01T20:00:00Z', repeat('4', 64), 0, 0, 0),
         ('20261001T200000Z-0338abcd', '2026-10-01T20:00:00Z', repeat('5', 64), 0, 0, 0);

  r := pg_temp.hist('20261101T200000Z-0338abcd', jsonb_build_array(day1));
  assert (r->>'written')::int = 1, 'day stored: ' || r::text;
  assert (select revenue_minor from public.cultivera_history_days where day = '2025-10-31') = 888634, 'cents kept';
  assert (select units from public.cultivera_history_days where day = '2025-10-31') = 410.5, 'fractional units kept';

  r := pg_temp.hist('20261001T200000Z-0338abcd', jsonb_build_array(day1 || '{"revenue_minor": 1}'));
  assert (r->>'written')::int = 0 and (r->>'kept_newer')::int = 1, 'older run kept out: ' || r::text;
  assert (select revenue_minor from public.cultivera_history_days where day = '2025-10-31') = 888634, 'newer kept';

  r := pg_temp.hist('20261101T200000Z-0338abcd', jsonb_build_array(day1 || '{"revenue_minor": 888700, "diff_minor": 66, "check_status": "mismatch"}'));
  assert (r->>'written')::int = 1, 'same capture may refresh';
  assert (select check_status from public.cultivera_history_days where day = '2025-10-31') = 'mismatch', 'status refreshed';

  begin
    perform pg_temp.hist('20260101T000000Z-deadbeef', '[]'::jsonb);
    assert false, 'unknown run must fail';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform pg_temp.hist('20261101T200000Z-0338abcd', '{}'::jsonb);
    assert false, 'a non-list must fail';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform pg_temp.hist('20261101T200000Z-0338abcd', jsonb_build_array(day1 || '{"day": "2025-11-01", "check_status": "fine"}'));
    assert false, 'a bad check status must fail';
  exception when check_violation then null;
  end;
end $$;

\echo 'CULTIVERA HISTORY 0338 CHECK PASSED'
rollback;
