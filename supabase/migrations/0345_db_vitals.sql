-- 0345_db_vitals.sql  (D193 · DB HEALTH round slice B · database vital signs + self-heal)
--
-- WHY. The owner, verbatim (2026-11-06):
--   "Every few hours the database will become "unhealthy" and I can't use the
--    back office. I get an email alert about the platform health. It's
--    unexplainable and frequent. ... Please look for ways you can add to the ai
--    partnership so that it can help me self heal these issues now. I want a
--    healthy db always."
--
-- What we measured (D192): the database itself stopped twice in a day
-- (crash recovery at 21:09 and 02:28 UTC) after bursts of thousands of
-- identical public-page reads on a 1 GB Micro instance. Slice A (D192)
-- removed the burst. This migration gives the app EYES on the database so the
-- Partner can see trouble coming, explain it in plain English, and clear the
-- one kind of trouble that is safe to clear by itself.
--
-- WHAT.
--   1. platform_db_vitals() -> jsonb. READ-ONLY. When the database last
--      started (a change = it restarted), connections by state against
--      max_connections, the oldest "idle in transaction" session, the longest
--      running query, sessions waiting on a lock, cache hit ratio, size,
--      deadlocks, and the list of STUCK app sessions (see 2). Query text is
--      cut to 80 characters (PostgREST sends parameters separately, so no
--      customer data is in it).
--   2. platform_db_heal_stuck(p_pids int[], p_idle_tx_minutes int,
--      p_active_minutes int) -> jsonb. The ONLY write: it signals sessions,
--      it changes no row in any table.
--        - an APP session (authenticator / anon / authenticated / service_role)
--          "idle in transaction" for >= p_idle_tx_minutes (floor 2) is ended
--          (pg_terminate_backend): its unfinished transaction is rolled back,
--          which is exactly what Postgres would do if the app had crashed;
--        - an APP query running for >= p_active_minutes (floor 5) is
--          cancelled (pg_cancel_backend): the connection stays. Nothing in
--          the app may run that long (Vercel functions stop at 5 minutes),
--          so such a query has lost its caller and only holds locks / memory.
--      NEVER touched: the owner's own SQL editor sessions (role postgres),
--      Supabase's own roles, background workers, replication, this session.
--      p_pids (optional) narrows it to the sessions a person approved; a pid
--      that is no longer stuck is skipped, so a stale approval does nothing.
--   3. SECURITY DEFINER with a pinned search_path, because only the owner
--      role may read other roles' sessions (pg_read_all_stats) and signal
--      them (pg_signal_backend). EXECUTE is granted to service_role only.
--      Nothing to anon, authenticated or public (standing rule 15).
--
-- No table. The readings are stored in platform_health_runs (0331) with
-- kind = 'db_vitals', so factory reset, schema tables and RLS are unchanged.
--
-- Safe to re-run (create or replace; idempotent grants).
-- Rollback: supabase/rollbacks/0345_db_vitals.rollback.sql.


create or replace function public.platform_db_vitals()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_app_roles constant text[] := array['authenticator', 'anon', 'authenticated', 'service_role'];
  v_out jsonb;
begin
  with
  act as (
    select a.pid,
           a.usename::text as usename,
           coalesce(a.state, '') as state,
           a.wait_event_type,
           extract(epoch from (now() - a.state_change))::int as state_secs,
           extract(epoch from (now() - a.query_start))::int as query_secs,
           left(regexp_replace(coalesce(a.query, ''), '\s+', ' ', 'g'), 80) as q
      from pg_stat_activity a
     where a.backend_type = 'client backend'
       and a.datname = current_database()
       and a.pid <> pg_backend_pid()
  ),
  stuck as (
    select pid, usename, state, case when state = 'active' then query_secs else state_secs end as secs, q
      from act
     where usename = any (v_app_roles)
       and ((state like 'idle in transaction%' and state_secs >= 300)
         or (state = 'active' and query_secs >= 600))
     order by 4 desc
     limit 20
  ),
  db as (
    select d.blks_hit, d.blks_read, d.deadlocks, d.xact_commit, d.xact_rollback, d.temp_bytes, d.stats_reset
      from pg_stat_database d
     where d.datname = current_database()
  )
  select jsonb_build_object(
    'started_at',            pg_postmaster_start_time(),
    'checked_at',            now(),
    'max_connections',       current_setting('max_connections')::int,
    'connections',           (select count(*) from act),
    'active',                (select count(*) from act where state = 'active'),
    'idle',                  (select count(*) from act where state = 'idle'),
    'idle_in_tx',            (select count(*) from act where state like 'idle in transaction%'),
    'app_connections',       (select count(*) from act where usename = any (v_app_roles)),
    'oldest_idle_in_tx_secs',(select coalesce(max(state_secs), 0) from act where state like 'idle in transaction%'),
    'longest_active_secs',   (select coalesce(max(query_secs), 0) from act where state = 'active'),
    'waiting_on_lock',       (select count(*) from act where wait_event_type = 'Lock'),
    'cache_hit_ratio',       (select case when (blks_hit + blks_read) > 0
                                           then round(blks_hit::numeric / (blks_hit + blks_read), 4)
                                           else null end from db),
    'blocks_read',           (select blks_read from db),
    'deadlocks',             (select deadlocks from db),
    'temp_bytes',            (select temp_bytes from db),
    'db_bytes',              pg_database_size(current_database()),
    'stuck',                 coalesce((select jsonb_agg(jsonb_build_object(
                                 'pid', pid, 'role', usename, 'state', state, 'secs', secs, 'query', q))
                               from stuck), '[]'::jsonb)
  ) into v_out;
  return v_out;
end
$fn$;

comment on function public.platform_db_vitals() is
  'D193 database vital signs (read-only): last start, connections, stuck app sessions, cache, size. service_role only.';


create or replace function public.platform_db_heal_stuck(
  p_pids             int[] default null,
  p_idle_tx_minutes  int   default 5,
  p_active_minutes   int   default 10
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_app_roles constant text[] := array['authenticator', 'anon', 'authenticated', 'service_role'];
  v_idle_secs   int := greatest(coalesce(p_idle_tx_minutes, 5), 2) * 60;
  v_active_secs int := greatest(coalesce(p_active_minutes, 10), 5) * 60;
  v_ended     jsonb := '[]'::jsonb;
  v_cancelled jsonb := '[]'::jsonb;
  v_failed    int := 0;
  r record;
begin
  for r in
    select a.pid,
           a.usename::text as usename,
           a.state,
           extract(epoch from (now() - a.state_change))::int as state_secs,
           extract(epoch from (now() - a.query_start))::int as query_secs,
           left(regexp_replace(coalesce(a.query, ''), '\s+', ' ', 'g'), 80) as q
      from pg_stat_activity a
     where a.backend_type = 'client backend'
       and a.datname = current_database()
       and a.pid <> pg_backend_pid()
       and a.usename = any (v_app_roles)
       and (p_pids is null or a.pid = any (p_pids))
       and ((a.state like 'idle in transaction%' and now() - a.state_change >= make_interval(secs => v_idle_secs))
         or (a.state = 'active' and now() - a.query_start >= make_interval(secs => v_active_secs)))
  loop
    if r.state like 'idle in transaction%' then
      if pg_terminate_backend(r.pid) then
        v_ended := v_ended || jsonb_build_object('pid', r.pid, 'role', r.usename, 'secs', r.state_secs, 'query', r.q);
      else
        v_failed := v_failed + 1;
      end if;
    else
      if pg_cancel_backend(r.pid) then
        v_cancelled := v_cancelled || jsonb_build_object('pid', r.pid, 'role', r.usename, 'secs', r.query_secs, 'query', r.q);
      else
        v_failed := v_failed + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'ended',            v_ended,
    'cancelled',        v_cancelled,
    'failed',           v_failed,
    'idle_tx_minutes',  v_idle_secs / 60,
    'active_minutes',   v_active_secs / 60,
    'at',               now()
  );
end
$fn$;

comment on function public.platform_db_heal_stuck(int[], int, int) is
  'D193 self-heal: ends app sessions idle in a transaction too long and cancels runaway app queries. Changes no table rows. service_role only.';

-- Deliberate, not default (standing rule 15).
revoke all on function public.platform_db_vitals() from public, anon, authenticated;
revoke all on function public.platform_db_heal_stuck(int[], int, int) from public, anon, authenticated;
grant execute on function public.platform_db_vitals() to service_role;
grant execute on function public.platform_db_heal_stuck(int[], int, int) to service_role;
