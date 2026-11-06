-- scripts/recon/db-vitals-0345-pg-check.sql  (D193 · DB HEALTH slice B · migration 0345)
--
-- Scenario check for 0345_db_vitals.sql on Postgres 15 with every migration applied.
-- ONE transaction, rolled back: nothing remains.
--   * 0345 applies twice (idempotent);
--   * platform_db_vitals() answers with every key the app reads, sane numbers, and no stuck
--     sessions on a quiet test server;
--   * platform_db_heal_stuck() on a quiet server ends / cancels nothing, clamps the minutes to
--     their floors (2 and 5) and ignores a pid list of sessions that are not stuck (this session
--     included: it can never signal itself);
--   * privileges: service_role may run both; anon / authenticated / public may run neither.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/db-vitals-0345-pg-check.sql
--
-- "DB VITALS 0345 CHECK PASSED" then ROLLBACK = all clear.
begin;

\i supabase/migrations/0345_db_vitals.sql
\i supabase/migrations/0345_db_vitals.sql

do $$
declare
  v jsonb;
  h jsonb;
  k text;
begin
  v := public.platform_db_vitals();
  foreach k in array array['started_at', 'checked_at', 'max_connections', 'connections', 'active', 'idle',
                           'idle_in_tx', 'app_connections', 'oldest_idle_in_tx_secs', 'longest_active_secs',
                           'waiting_on_lock', 'cache_hit_ratio', 'blocks_read', 'deadlocks', 'temp_bytes',
                           'db_bytes', 'stuck'] loop
    assert v ? k, format('vitals has %s', k);
  end loop;
  assert (v->>'max_connections')::int > 0, 'max_connections read';
  assert (v->>'db_bytes')::bigint > 0, 'size read';
  assert (v->>'started_at')::timestamptz <= now(), 'start time is in the past';
  assert jsonb_typeof(v->'stuck') = 'array', 'stuck is a list';
  assert jsonb_array_length(v->'stuck') = 0, 'quiet server: nothing stuck';

  h := public.platform_db_heal_stuck(null, 0, 0);
  assert jsonb_array_length(h->'ended') = 0 and jsonb_array_length(h->'cancelled') = 0, 'quiet server: nothing signalled';
  assert (h->>'idle_tx_minutes')::int = 2, 'idle minutes floor is 2';
  assert (h->>'active_minutes')::int = 5, 'active minutes floor is 5';
  assert (h->>'failed')::int = 0, 'nothing failed';

  h := public.platform_db_heal_stuck(array[pg_backend_pid()], 2, 5);
  assert jsonb_array_length(h->'ended') = 0 and jsonb_array_length(h->'cancelled') = 0, 'never signals itself or a session that is not stuck';

  h := public.platform_db_heal_stuck(null, null, null);
  assert (h->>'idle_tx_minutes')::int = 5 and (h->>'active_minutes')::int = 10, 'defaults 5 and 10';

  assert has_function_privilege('service_role', 'public.platform_db_vitals()', 'EXECUTE'), 'service_role reads vitals';
  assert has_function_privilege('service_role', 'public.platform_db_heal_stuck(int[], int, int)', 'EXECUTE'), 'service_role heals';
  assert not has_function_privilege('anon', 'public.platform_db_vitals()', 'EXECUTE'), 'anon cannot read vitals';
  assert not has_function_privilege('authenticated', 'public.platform_db_vitals()', 'EXECUTE'), 'authenticated cannot read vitals';
  assert not has_function_privilege('anon', 'public.platform_db_heal_stuck(int[], int, int)', 'EXECUTE'), 'anon cannot heal';
  assert not has_function_privilege('authenticated', 'public.platform_db_heal_stuck(int[], int, int)', 'EXECUTE'), 'authenticated cannot heal';
  assert (select prosecdef from pg_proc where oid = 'public.platform_db_heal_stuck(int[], int, int)'::regprocedure), 'heal is security definer';
  assert (select proconfig::text like '%search_path=pg_catalog, public%' from pg_proc where oid = 'public.platform_db_vitals()'::regprocedure), 'search_path pinned';
end
$$;

\echo 'DB VITALS 0345 CHECK PASSED'
rollback;
