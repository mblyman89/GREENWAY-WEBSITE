-- scripts/recon/ach-prenote-wait-0275-pg-check.sql  (R41 S7 - migration 0275)
--
-- Scenario check for 0275_ach_prenote_timberland_wait.sql on Postgres 15 with
-- every migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ach-prenote-wait-0275-pg-check.sql
--
-- Timberland agreement section 6: no live entries "until at least 6 banking
-- days following the settlement date of the prenotification Entry". The
-- database floors that at settlement + 8 calendar days. Each refusal MUST raise
-- with the expected text and sits beside a valid write that MUST be accepted.
-- "ACH 0275 CHECK PASSED" then ROLLBACK = all clear.
begin;

create or replace function pg_temp.must_fail(sql text, expect text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(expect in sqlerrm) = 0 and sqlstate <> expect then
      raise exception 'probe raised the WRONG error. expected %, got [%] %  -- %', expect, sqlstate, sqlerrm, sql;
    end if;
    return;
  end;
  raise exception 'probe was ACCEPTED but must be refused (expected %): %', expect, sql;
end $$;

create or replace function pg_temp.acct(auth uuid, prio int, last4 text, by_ uuid) returns uuid
language plpgsql as $$
declare i uuid;
begin
  insert into public.ach_authorization_accounts
    (authorization_id, priority, rule_kind, fixed_cents, routing_enc, account_enc, account_type, account_last4, routing_last4, account_key_hmac, created_by)
  values (auth, prio, case when prio = 1 then 'remainder' else 'fixed' end, case when prio = 1 then null else 1000 end,
          'encv1:r:x', format('encv1:a%s:x', last4), 'checking', last4, '0021', repeat(last4, 16), by_)
  returning id into i;
  return i;
end $$;

do $$
declare
  u_m   uuid := gen_random_uuid();
  td    date := (now() at time zone 'America/Los_Angeles')::date;
  emp   uuid;
  auth1 uuid;
  a1    uuid;
  a2    uuid;
  a3    uuid;
  p1    uuid;
  p3    uuid;
  m2    uuid;
  r     record;
  n     int;
  t     text := $q$select public.ach_verification_mark_sent(%s, %L, %L, %L, %L, 'probe-0275.ach')$q$;
begin
  insert into auth.users (id, email) values (u_m, 'm0275@x.test');
  insert into public.staff_profiles (id, email, role, active) values (u_m, 'm0275@x.test', 'owner', true)
    on conflict (id) do update set role = excluded.role, active = true;
  insert into public.employees (full_name) values ('Probe Employee 275') returning id into emp;
  insert into public.ach_authorizations (payee_type, employee_id, payee_name, state, signature_method, signed_on, created_by, updated_by)
    values ('employee', emp, 'Probe Employee 275', 'signed', 'esign', td, u_m, u_m) returning id into auth1;
  a1 := pg_temp.acct(auth1, 1, '5151', u_m);
  a2 := pg_temp.acct(auth1, 2, '5252', u_m);
  a3 := pg_temp.acct(auth1, 3, '5353', u_m);

  -- 0. shape: one trigger, server-only function, search_path pinned
  select count(*) into n from pg_trigger where tgname = 'trg_ach_verification_timberland_wait' and not tgisinternal;
  assert n = 1, format('exactly one 0275 trigger (re-running the migration must not add a second), found %s', n);
  select count(*) into n from pg_trigger g join pg_class c on c.oid = g.tgrelid
   where g.tgname = 'trg_ach_verification_timberland_wait' and c.relname = 'ach_verifications';
  assert n = 1, 'the trigger sits on ach_verifications';
  assert not has_function_privilege('authenticated', 'public.ach_verification_timberland_wait()', 'EXECUTE'), 'not callable by signed-in users';
  assert not has_function_privilege('anon', 'public.ach_verification_timberland_wait()', 'EXECUTE'), 'not callable by anon';
  select count(*) into n from pg_proc where proname = 'ach_verification_timberland_wait' and 'search_path=public, pg_temp' = any (proconfig);
  assert n = 1, 'search_path pinned';

  p1 := public.ach_verification_start(a1, u_m, 'prenote', null);
  m2 := public.ach_verification_start(a2, u_m, 'micro_entry', 41);
  p3 := public.ach_verification_start(a3, u_m, 'prenote', null);

  -- 1. Nacha's three days (5 calendar days) is refused
  perform pg_temp.must_fail(format(t, format('array[%L]::uuid[]', p1), u_m, td - 1, td, td + 5), 'ACH_VERIFICATION_TIMBERLAND_WAIT');
  -- 2. a long-weekend three-day wait (7 calendar days) is refused: one day short of the floor
  perform pg_temp.must_fail(format(t, format('array[%L]::uuid[]', p1), u_m, td - 1, td, td + 7), 'ACH_VERIFICATION_TIMBERLAND_WAIT');
  -- 3. the refusal is a check_violation (23514), so the app maps it, never a generic error
  perform pg_temp.must_fail(format(t, format('array[%L]::uuid[]', p1), u_m, td - 1, td, td + 7), '23514');
  select status into r from public.ach_verifications where id = p1;
  assert r.status <> 'sent', 'a refused prenote stays unsent';

  -- 4. exactly the floor (settlement + 8) is accepted
  n := public.ach_verification_mark_sent(array[p1], u_m, td - 1, td, td + 8, 'probe-0275.ach');
  assert n = 1, 'one prenote marked sent at the floor';
  select * into r from public.ach_verifications where id = p1;
  assert r.status = 'sent' and r.eligible_on = td + 8 and r.settlement_date = td, 'dates stored as sent';

  -- 5. micro entries are not prenotes: section 6 does not apply to them
  n := public.ach_verification_mark_sent(array[m2], u_m, td - 1, td, td + 1, 'probe-0275-micro.ach');
  assert n = 1, 'a micro entry with a short wait is still accepted';

  -- 6. a second prenote with a six-calendar-day wait is refused and left unsent
  perform pg_temp.must_fail(format(t, format('array[%L]::uuid[]', p3), u_m, td - 2, td - 1, td + 6), 'ACH_VERIFICATION_TIMBERLAND_WAIT');
  select status into r from public.ach_verifications where id = p3;
  assert r.status <> 'sent', 'still unsent after refusal';
  -- 7. a later-than-floor day (holidays push it later) is accepted
  n := public.ach_verification_mark_sent(array[p3], u_m, td - 2, td - 1, td + 12, 'probe-0275-b.ach');
  assert n = 1, 'a later day is accepted';

  raise notice 'ACH 0275 CHECK PASSED';
end $$;

rollback;
