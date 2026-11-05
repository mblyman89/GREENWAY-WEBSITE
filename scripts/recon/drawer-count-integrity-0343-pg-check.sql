-- scripts/recon/drawer-count-integrity-0343-pg-check.sql  (D180 S3 - migration 0343)
--
-- Scenario check for 0343_drawer_count_integrity.sql on Postgres 15 with every migration applied.
-- ONE transaction, rolled back: nothing remains.
--   * 0343 applies twice (idempotent);
--   * the backfill: a drawer reconciled on the second counter's figure (the old D126 overwrite)
--     gets reconciled_count_minor = the reconciled figure and closing_count_minor = the closer's
--     own 'close' row again; over/short is untouched;
--   * the trigger: a closed drawer's closing_count_minor can never change; a saved second count
--     can never change; open -> closed still writes the count; reconciled_count_minor and the
--     flags can be written; unknown flags and negative counts are refused.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/drawer-count-integrity-0343-pg-check.sql
--
-- "DRAWER COUNT INTEGRITY 0343 CHECK PASSED" then ROLLBACK = all clear.
begin;

-- A drawer reconciled the OLD way, before 0343 existed: the closer counted 10000, the second
-- counter 9500, reconcile overwrote closing_count_minor with 9500. This check runs after every
-- migration is applied, so the 0343 trigger is switched off for the setup only; re-applying
-- 0343 below drops and recreates it (enabled).
do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'drawer_sessions_counts_immutable') then
    execute 'alter table public.drawer_sessions disable trigger drawer_sessions_counts_immutable';
  end if;
end
$$;

do $$
declare
  v_reg uuid;
  v_closer uuid;
  v_second uuid;
  v_s uuid;
begin
  insert into public.registers (name, kind, active, notes) values ('__0343__', 'sales', false, '0343 check')
    returning id into v_reg;
  insert into public.employees (full_name) values ('__0343 closer__') returning id into v_closer;
  insert into public.employees (full_name) values ('__0343 second__') returning id into v_second;
  insert into public.drawer_sessions (register_id, business_day, status, opening_count_minor, opened_at, notes)
    values (v_reg, current_date, 'open', 16750, now() - interval '9 hours', '__0343_legacy__')
    returning id into v_s;
  update public.drawer_sessions
     set status = 'closed', closed_by = v_closer, closing_count_minor = 10000, closed_at = now() - interval '1 hour'
   where id = v_s;
  insert into public.drawer_counts (session_id, count_type, counted_by, hundreds, total_minor, counted_at)
    values (v_s, 'close', v_closer, 1, 10000, now() - interval '1 hour');
  update public.drawer_sessions
     set second_counted_by = v_second, second_count_minor = 9500, second_counted_at = now() - interval '30 minutes'
   where id = v_s;
  update public.drawer_sessions
     set status = 'reconciled', closing_count_minor = 9500, expected_close_minor = 9600,
         over_short_minor = -100, reconciled_at = now()
   where id = v_s;
end
$$;

\i supabase/migrations/0343_drawer_count_integrity.sql
\i supabase/migrations/0343_drawer_count_integrity.sql

do $$
declare
  r record;
  v_reg uuid;
  v_closer uuid;
  v_second uuid;
  v_s uuid;
  blocked boolean;
begin
  assert (select tgenabled from pg_trigger where tgname = 'drawer_sessions_counts_immutable') = 'O', 're-apply leaves the trigger ON';
  -- backfill
  select * into r from public.drawer_sessions where notes = '__0343_legacy__';
  assert r.reconciled_count_minor = 9500, format('backfill: reconciled on 9500, got %s', r.reconciled_count_minor);
  assert r.closing_count_minor = 10000, format('backfill: closer''s own 10000 restored, got %s', r.closing_count_minor);
  assert r.over_short_minor = -100, 'backfill: over/short untouched';
  assert r.second_count_flags = '{}'::text[], 'flags default empty';

  -- the restored closer count is now write-once
  blocked := false;
  begin
    update public.drawer_sessions set closing_count_minor = 9500 where id = r.id;
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'a reconciled drawer''s closer count cannot be overwritten';

  -- a correction changes reconciled_count_minor only
  update public.drawer_sessions set reconciled_count_minor = 9600, over_short_minor = 0 where id = r.id;
  select * into r from public.drawer_sessions where id = r.id;
  assert r.reconciled_count_minor = 9600 and r.closing_count_minor = 10000, 'correction lands on reconciled_count_minor';

  -- a saved second count is write-once
  blocked := false;
  begin
    update public.drawer_sessions set second_count_minor = 9999 where id = r.id;
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'a saved second count cannot be changed';

  -- the live path still works: open -> closed writes the count, then second count + flags
  select register_id, closed_by, second_counted_by into v_reg, v_closer, v_second from public.drawer_sessions where id = r.id;
  insert into public.drawer_sessions (register_id, business_day, status, opening_count_minor, opened_at, notes)
    values (v_reg, current_date, 'open', 16750, now(), '__0343_live__') returning id into v_s;
  update public.drawer_sessions set closing_count_minor = 1 where id = v_s;           -- open: free to change
  update public.drawer_sessions set status = 'closed', closed_by = v_closer, closing_count_minor = 20000, closed_at = now()
   where id = v_s and status = 'open';
  update public.drawer_sessions
     set second_counted_by = v_second, second_count_minor = 20000, second_counted_at = now(),
         second_count_opened_at = now() - interval '40 seconds',
         second_count_flags = array['fast', 'identical_and_fast'], second_count_entered_by_login = v_second
   where id = v_s and second_count_minor is null;
  update public.drawer_sessions
     set status = 'reconciled', reconciled_count_minor = 20000, expected_close_minor = 20000, over_short_minor = 0
   where id = v_s and status = 'closed';
  select * into r from public.drawer_sessions where id = v_s;
  assert r.closing_count_minor = 20000 and r.reconciled_count_minor = 20000 and r.status = 'reconciled', 'live path';
  assert r.second_count_flags = array['fast', 'identical_and_fast'], 'flags saved';

  blocked := false;
  begin
    update public.drawer_sessions set closing_count_minor = 19000 where id = v_s;
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'closed drawer: closer count immutable';

  blocked := false;
  begin
    update public.drawer_sessions set second_count_flags = array['bogus'] where id = v_s;
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'unknown flag refused';

  blocked := false;
  begin
    update public.drawer_sessions set reconciled_count_minor = -1 where id = v_s;
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'negative reconciled count refused';

  -- the factory reset still deletes (the trigger is BEFORE UPDATE only)
  delete from public.drawer_sessions where id = v_s;
  assert not exists (select 1 from public.drawer_sessions where id = v_s), 'delete still works';

  assert not has_function_privilege('anon', 'public.drawer_sessions_counts_immutable()', 'EXECUTE'), 'anon: no fn';
end
$$;

\echo 'DRAWER COUNT INTEGRITY 0343 CHECK PASSED'
rollback;
