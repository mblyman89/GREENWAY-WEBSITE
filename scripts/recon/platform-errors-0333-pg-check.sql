-- scripts/recon/platform-errors-0333-pg-check.sql  (slice G-71d - migration 0333)
--
-- Scenario check for 0333_platform_error_events.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: nothing remains.
--   * 0333 applies twice (idempotent);
--   * service_role may SELECT and INSERT, never UPDATE / DELETE / TRUNCATE
--     (0330's default privileges are taken back); anon and authenticated can
--     do nothing; RLS is on;
--   * the constraints refuse an unknown kind, an unknown source and an
--     over-long message;
--   * the app's spike query (count one kind over 10 minutes) and its alert
--     claim (compliance_reminder_log, UNIQUE dedupe_key, 23505 on the second)
--     both work as service_role.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/platform-errors-0333-pg-check.sql
--
-- "PLATFORM ERRORS 0333 CHECK PASSED" then ROLLBACK = all clear.
begin;

\i supabase/migrations/0333_platform_error_events.sql
\i supabase/migrations/0333_platform_error_events.sql

do $$ begin
  assert has_table_privilege('service_role', 'public.platform_error_events', 'SELECT'), 'service_role reads errors';
  assert has_table_privilege('service_role', 'public.platform_error_events', 'INSERT'), 'service_role records errors';
  assert not has_table_privilege('service_role', 'public.platform_error_events', 'UPDATE'), 'errors are never changed';
  assert not has_table_privilege('service_role', 'public.platform_error_events', 'DELETE'), 'errors are never deleted';
  assert not has_table_privilege('service_role', 'public.platform_error_events', 'TRUNCATE'), 'errors are never truncated';
  assert not has_table_privilege('anon', 'public.platform_error_events', 'SELECT'), 'anon cannot read';
  assert not has_table_privilege('anon', 'public.platform_error_events', 'INSERT'), 'anon cannot write';
  assert not has_table_privilege('authenticated', 'public.platform_error_events', 'SELECT'), 'authenticated cannot read';
  assert not has_table_privilege('authenticated', 'public.platform_error_events', 'INSERT'), 'authenticated cannot write';
  assert (select relrowsecurity from pg_class where oid = 'public.platform_error_events'::regclass), 'RLS on';
end $$;

create or replace function pg_temp.try_as(r text, sql text) returns text language plpgsql as $$
begin
  execute format('set local role %I', r);
  begin
    execute sql;
  exception when others then
    reset role;
    return sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  return 'ran';
end $$;

do $$ begin
  -- What the app writes (platform-error-store.ts), as the server.
  assert pg_temp.try_as('service_role', $q$
    insert into public.platform_error_events (kind, source, code, route, method, message, digest, fingerprint)
    values ('db_permission', 'db', '42501', 'rpc record_customer_return', 'POST',
            'permission denied for function record_customer_return', null,
            'db_permission|42501|rpc record_customer_return')$q$) = 'ran', 'server records a refusal';
  assert pg_temp.try_as('service_role', $q$
    insert into public.platform_error_events (kind, source, route, message, fingerprint)
    values ('server_error', 'request', '/admin/pos', 'boom', 'server_error|-|/admin/pos')$q$) = 'ran', 'server records a crash';

  assert pg_temp.try_as('service_role', 'update public.platform_error_events set message = ''x''') like '42501%', 'server cannot rewrite history';
  assert pg_temp.try_as('service_role', 'delete from public.platform_error_events') like '42501%', 'server cannot delete history';
  assert pg_temp.try_as('anon', 'select 1 from public.platform_error_events') like '42501%', 'browser cannot read';
  assert pg_temp.try_as('authenticated', $q$insert into public.platform_error_events (kind, source, route, fingerprint) values ('server_error','request','/','x')$q$) like '42501%', 'browser cannot write';

  assert pg_temp.try_as('service_role', $q$insert into public.platform_error_events (kind, source, route, fingerprint) values ('bogus','request','/','x')$q$) like '23514%', 'kind constrained';
  assert pg_temp.try_as('service_role', $q$insert into public.platform_error_events (kind, source, route, fingerprint) values ('server_error','browser','/','x')$q$) like '23514%', 'source constrained';
  assert pg_temp.try_as('service_role', format($q$insert into public.platform_error_events (kind, source, route, message, fingerprint) values ('server_error','request','/', %L, 'x')$q$, repeat('a', 301))) like '23514%', 'message capped at 300';
end $$;

-- The spike count and the alert claim, as the server.
set local role service_role;
do $$
declare n int;
begin
  select count(*) into n from public.platform_error_events
   where kind = 'db_permission' and occurred_at >= now() - interval '10 minutes';
  assert n = 1, 'spike query counts the refusal: ' || n;
  insert into public.compliance_reminder_log (dedupe_key, stage, week_key, channel, subject, recipients)
    values ('platform-errors:db_permission:2026-11-01T09', 'platform_errors', null, 'email', 'x', 'owner@example.com');
  begin
    insert into public.compliance_reminder_log (dedupe_key, stage, week_key, channel, subject, recipients)
      values ('platform-errors:db_permission:2026-11-01T09', 'platform_errors', null, 'email', 'x', 'owner@example.com');
    assert false, 'second claim the same hour must be refused';
  exception when unique_violation then
    null; -- 23505: already alerted this hour
  end;
end $$;
reset role;

\echo 'PLATFORM ERRORS 0333 CHECK PASSED'
rollback;
