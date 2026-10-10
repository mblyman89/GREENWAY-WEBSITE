-- scripts/recon/ach-esign-0261-pg-check.sql  (R39 S6 - migration 0261)
--
-- Scenario check for 0261_ach_esign.sql on Postgres 15 with every migration
-- applied. ONE transaction, rolled back: no rows remain.
--
--   PGPASSWORD=postgres psql -h localhost -U postgres -d r39 \
--     -v ON_ERROR_STOP=1 -f scripts/recon/ach-esign-0261-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid call
-- that MUST be accepted. "ACH 0261 CHECK PASSED" then ROLLBACK = all clear.
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

do $$
declare
  u_m    uuid := gen_random_uuid();
  emp    uuid;
  emp2   uuid;
  s1     uuid;
  s2     uuid;
  s3     uuid;
  auth1  uuid;
  auth2  uuid;
  n      int;
  r      record;
  enc    text := 'encv1:aaaa:bbbb';
  hx     text := repeat('d', 64);
  acct   jsonb;
  two    jsonb;
  rec1   jsonb := jsonb_build_object('storage_path', 'ach-docs/employee/e/r1.pdf', 'sha256', repeat('1', 64), 'byte_size', 1000);
  cert1  jsonb := jsonb_build_object('storage_path', 'ach-docs/employee/e/c1.pdf', 'sha256', repeat('2', 64), 'byte_size', 900);
  rec2   jsonb := jsonb_build_object('storage_path', 'ach-docs/employee/e/r2.pdf', 'sha256', repeat('3', 64), 'byte_size', 1000);
  cert2  jsonb := jsonb_build_object('storage_path', 'ach-docs/employee/e/c2.pdf', 'sha256', repeat('4', 64), 'byte_size', 900);
  call   text;
begin
  insert into auth.users (id, email) values (u_m, 'm0261@x.test');
  insert into public.staff_profiles (id, email, role, active) values (u_m, 'm0261@x.test', 'owner', true)
    on conflict (id) do update set role = 'owner', active = true;
  insert into public.employees (full_name) values ('Esign Probe') returning id into emp;
  insert into public.employees (full_name) values ('Esign Probe Two') returning id into emp2;

  acct := jsonb_build_array(jsonb_build_object('priority', 1, 'rule_kind', 'remainder', 'bank_name', 'B', 'routing_enc', enc, 'account_enc', enc,
                             'account_type', 'checking', 'account_last4', '5678', 'routing_last4', '0021', 'account_key_hmac', repeat('a', 64)));
  two := jsonb_build_array(
    jsonb_build_object('priority', 1, 'rule_kind', 'fixed', 'fixed_cents', 20000, 'bank_name', 'A', 'routing_enc', enc, 'account_enc', enc,
                       'account_type', 'checking', 'account_last4', '5678', 'routing_last4', '0021', 'account_key_hmac', repeat('a', 64)),
    jsonb_build_object('priority', 2, 'rule_kind', 'remainder', 'bank_name', 'B', 'routing_enc', enc, 'account_enc', enc,
                       'account_type', 'savings', 'account_last4', '0000', 'routing_last4', '0015', 'account_key_hmac', repeat('b', 64)));

  -- table CHECKs ------------------------------------------------------------
  perform pg_temp.must_fail(format($q$insert into public.ach_esign_sessions (employee_id, started_by, id_type, id_detail, legal_name) values (%L, %L, 'wa_dl_id', 'WDL123456789', 'Esign Probe')$q$, emp, u_m), 'ach_esign_sessions_id_detail_check');
  perform pg_temp.must_fail(format($q$insert into public.ach_esign_sessions (employee_id, started_by, id_type, id_detail, legal_name) values (%L, %L, 'library', '1234', 'Esign Probe')$q$, emp, u_m), 'ach_esign_sessions_id_type_check');
  perform pg_temp.must_fail(format($q$insert into public.ach_esign_sessions (employee_id, started_by, id_type, id_detail, legal_name, state) values (%L, %L, 'passport', '1234', 'Esign Probe', 'code_sent')$q$, emp, u_m), 'esign_code_sent_shape');
  perform pg_temp.must_fail(format($q$insert into public.ach_esign_sessions (employee_id, started_by, id_type, id_detail, legal_name, state, cancelled_at, cancel_reason) values (%L, %L, 'passport', '1234', 'Esign Probe', 'cancelled', now(), 'no')$q$, emp, u_m), 'esign_cancelled_shape');

  insert into public.ach_esign_sessions (employee_id, started_by, id_type, id_detail, legal_name)
    values (emp, u_m, 'wa_dl_id', '1234 exp 2029-05-01', 'Esign Probe') returning id into s1;
  -- one live session per employee
  perform pg_temp.must_fail(format($q$insert into public.ach_esign_sessions (employee_id, started_by, id_type, id_detail, legal_name) values (%L, %L, 'passport', '1234', 'Esign Probe')$q$, emp, u_m), 'ach_esign_one_live_per_employee');

  -- guard: skipping, immutables, counters ----------------------------------
  perform pg_temp.must_fail(format($q$update public.ach_esign_sessions set state = 'consented' where id = %L$q$, s1), 'ACH_ESIGN_TRANSITION');
  perform pg_temp.must_fail(format($q$update public.ach_esign_sessions set id_detail = '9999' where id = %L$q$, s1), 'ACH_ESIGN_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.ach_esign_sessions set legal_name = 'Someone Else' where id = %L$q$, s1), 'ACH_ESIGN_IMMUTABLE');
  update public.ach_esign_sessions set state = 'code_sent', email_enc = enc, email_masked = 'es***@x.test', otp_digest = hx, otp_sent_at = now(), otp_sends = 1 where id = s1;
  update public.ach_esign_sessions set otp_attempts = 2 where id = s1;
  -- still one live session while a code is out
  perform pg_temp.must_fail(format($q$insert into public.ach_esign_sessions (employee_id, started_by, id_type, id_detail, legal_name) values (%L, %L, 'passport', '1234', 'Esign Probe')$q$, emp, u_m), 'ach_esign_one_live_per_employee');
  perform pg_temp.must_fail(format($q$update public.ach_esign_sessions set otp_attempts = 0 where id = %L$q$, s1), 'ACH_ESIGN_COUNTERS');
  perform pg_temp.must_fail(format($q$update public.ach_esign_sessions set otp_sends = 4 where id = %L$q$, s1), 'ach_esign_sessions_otp_sends_check');
  perform pg_temp.must_fail(format($q$update public.ach_esign_sessions set otp_attempts = 6 where id = %L$q$, s1), 'ach_esign_sessions_otp_attempts_check');
  perform pg_temp.must_fail(format($q$update public.ach_esign_sessions set state = 'signed' where id = %L$q$, s1), 'ACH_ESIGN_TRANSITION');
  -- consented without the disclosure evidence is refused by the shape CHECK
  perform pg_temp.must_fail(format($q$update public.ach_esign_sessions set state = 'consented', code_verified_at = now(), consented_at = now() where id = %L$q$, s1), 'esign_consented_shape');
  update public.ach_esign_sessions set state = 'consented', code_verified_at = now(), consented_at = now(),
         disclosure_version = 'GW-ESIGN-1', disclosure_sha256 = hx where id = s1;
  -- and while consented, waiting for the signature
  perform pg_temp.must_fail(format($q$insert into public.ach_esign_sessions (employee_id, started_by, id_type, id_detail, legal_name) values (%L, %L, 'passport', '1234', 'Esign Probe')$q$, emp, u_m), 'ach_esign_one_live_per_employee');
  perform pg_temp.must_fail(format($q$update public.ach_esign_sessions set email_enc = 'encv1:other:x' where id = %L$q$, s1), 'ACH_ESIGN_IMMUTABLE');
  -- going back to code_sent is not a move
  perform pg_temp.must_fail(format($q$update public.ach_esign_sessions set state = 'code_sent' where id = %L$q$, s1), 'ACH_ESIGN_TRANSITION');

  -- function argument refusals (nothing written) ---------------------------
  call := $q$select public.ach_esign_complete(%L, %L, %s, '203.0.113.5', 'UA', %L, false, %L, %L, %L)$q$;
  perform pg_temp.must_fail(format(call, s1, null, 'now()', 'Esign Probe', acct, rec1, cert1), 'ACH_ESIGN_ACTOR');
  perform pg_temp.must_fail(format(call, s1, u_m, $t$now() + interval '1 day'$t$, 'Esign Probe', acct, rec1, cert1), 'ACH_ESIGN_TIME');
  perform pg_temp.must_fail(format(call, s1, u_m, 'now()', 'Esign Probe', '[]', rec1, cert1), 'ACH_INTAKE_ACCOUNTS');
  perform pg_temp.must_fail(format(call, s1, u_m, 'now()', 'Esign Probe', two || two, rec1, cert1), 'ACH_INTAKE_ACCOUNTS');
  -- four accounts with valid priorities 1..4: refused by the count rule itself
  perform pg_temp.must_fail(format(call, s1, u_m, 'now()', 'Esign Probe',
    jsonb_build_array(jsonb_set(two->0, '{priority}', '1'), jsonb_set(jsonb_set(two->0, '{priority}', '2'), '{account_key_hmac}', to_jsonb(repeat('c', 64))),
                      jsonb_set(jsonb_set(two->0, '{priority}', '3'), '{account_key_hmac}', to_jsonb(repeat('e', 64))), jsonb_set(two->1, '{priority}', '4')),
    rec1, cert1), 'an authorization has 1 to 3 accounts');
  perform pg_temp.must_fail(format(call, s1, u_m, 'now()', 'Esign Probe', acct, rec1, rec1), 'ACH_ESIGN_FILES');
  perform pg_temp.must_fail(format(call, s1, u_m, 'now()', 'Esign Probe', acct, jsonb_build_object('storage_path', 'ach-docs/vendor/x/r.pdf', 'sha256', repeat('9', 64), 'byte_size', 1), cert1), 'ACH_ESIGN_FILES');
  perform pg_temp.must_fail(format(call, gen_random_uuid(), u_m, 'now()', 'Esign Probe', acct, rec1, cert1), 'ACH_ESIGN_NOT_FOUND');
  perform pg_temp.must_fail(format(call, s1, u_m, 'now()', 'Someone Else', acct, rec1, cert1), 'ACH_ESIGN_NAME');
  -- bad priority: whole call vanishes, including the two document rows
  perform pg_temp.must_fail(format(call, s1, u_m, 'now()', 'Esign Probe', jsonb_build_array(jsonb_set(acct->0, '{priority}', '2')), rec1, cert1), 'ACH_INTAKE_ACCOUNTS');
  select count(*) into n from public.ach_authorization_documents where employee_id = emp;
  assert n = 0, format('a failed signing must leave no documents, found %s', n);
  select count(*) into n from public.ach_authorizations where employee_id = emp;
  assert n = 0, 'a failed signing must leave no authorization';
  -- 0258 CHECK on an account (plaintext routing) also rolls the whole call back
  perform pg_temp.must_fail(format(call, s1, u_m, 'now()', 'Esign Probe', jsonb_build_array(jsonb_set(acct->0, '{routing_enc}', '"021000021"')), rec1, cert1), 'routing_enc');
  select count(*) into n from public.ach_authorization_documents where employee_id = emp;
  assert n = 0, 'CHECK failure must leave no documents';

  -- happy path: typed name ignores case and spacing ------------------------
  select public.ach_esign_complete(s1, u_m, now(), '203.0.113.5', 'UA', '  esign   PROBE ', false, two, rec1, cert1) into auth1;
  select * into r from public.ach_authorizations where id = auth1;
  assert r.state = 'signed' and r.signature_method = 'esign' and r.signed_on = (now() at time zone 'America/Los_Angeles')::date and r.payee_name = 'Esign Probe',
    format('authorization shape wrong: %s %s %s', r.state, r.signature_method, r.signed_on);
  select count(*) into n from public.ach_authorization_accounts where authorization_id = auth1 and archived_at is null;
  assert n = 2, format('two accounts expected, got %s', n);
  select count(*) into n from public.ach_authorization_documents
   where employee_id = emp and authorization_id = auth1 and intake_status = 'accepted';
  assert n = 2, format('record + certificate accepted and linked, got %s', n);
  select count(*) into n from public.ach_authorization_documents where employee_id = emp and kind = 'esign_certificate' and storage_path = cert1->>'storage_path';
  assert n = 1, 'certificate stored with kind esign_certificate';
  select * into r from public.ach_esign_sessions where id = s1;
  assert r.state = 'signed' and r.authorization_id = auth1 and r.signer_ip = '203.0.113.5' and r.typed_signature = 'esign   PROBE'
     and r.record_document_id is not null and r.certificate_document_id is not null, 'session closed with evidence';
  select count(*) into n from public.ach_authorization_events where authorization_id = auth1 and event_kind = 'esign_signed'
     and detail->>'record_sha256' = repeat('1', 64) and detail->'account_last4' = '["5678","0000"]'::jsonb;
  assert n = 1, 'esign_signed event with record hash and last-4 only';

  -- signed is final; signed is kept ----------------------------------------
  perform pg_temp.must_fail(format($q$update public.ach_esign_sessions set signer_ip = '1.1.1.1' where id = %L$q$, s1), 'ACH_ESIGN_FINAL');
  perform pg_temp.must_fail(format($q$delete from public.ach_esign_sessions where id = %L$q$, s1), 'ACH_ESIGN_KEEP');
  perform pg_temp.must_fail(format(call, s1, u_m, 'now()', 'Esign Probe', acct, rec2, cert2), 'ACH_ESIGN_STATE');

  -- second signing: open authorization refused unless replace ------------
  insert into public.ach_esign_sessions (employee_id, started_by, id_type, id_detail, legal_name, state, email_enc, email_masked, otp_digest, otp_sent_at, otp_sends,
                                         code_verified_at, consented_at, disclosure_version, disclosure_sha256)
    values (emp, u_m, 'passport', '4321', 'Esign Probe', 'started', null, null, null, null, 0, null, null, null, null) returning id into s2;
  update public.ach_esign_sessions set state = 'code_sent', email_enc = enc, email_masked = 'm', otp_digest = hx, otp_sent_at = now(), otp_sends = 1 where id = s2;
  update public.ach_esign_sessions set state = 'consented', code_verified_at = now(), consented_at = now(), disclosure_version = 'GW-ESIGN-1', disclosure_sha256 = hx where id = s2;
  perform pg_temp.must_fail(format(call, s2, u_m, 'now()', 'Esign Probe', acct, rec2, cert2), 'ACH_INTAKE_OPEN_EXISTS');
  select count(*) into n from public.ach_authorization_documents where employee_id = emp;
  assert n = 2, 'refused replace leaves only the first two documents';
  select public.ach_esign_complete(s2, u_m, now(), null, '', 'Esign Probe', true, acct, rec2, cert2) into auth2;
  select state into r from public.ach_authorizations where id = auth1;
  assert r.state = 'archived', 'old authorization archived on replace';
  select count(*) into n from public.ach_authorization_accounts where authorization_id = auth1 and archived_at is null;
  assert n = 0, 'old accounts archived on replace';
  select count(*) into n from public.ach_authorization_events where authorization_id = auth1 and event_kind = 'authorization_superseded' and detail->>'esign_session_id' = s2::text;
  assert n = 1, 'superseded event names the session';

  -- expired session ---------------------------------------------------------
  insert into public.ach_esign_sessions (employee_id, started_by, started_at, id_type, id_detail, legal_name)
    values (emp2, u_m, now() - interval '31 minutes', 'passport', '1111', 'Esign Probe Two') returning id into s3;
  update public.ach_esign_sessions set state = 'code_sent', email_enc = enc, email_masked = 'm', otp_digest = hx, otp_sent_at = now(), otp_sends = 1 where id = s3;
  update public.ach_esign_sessions set state = 'consented', code_verified_at = now(), consented_at = now(), disclosure_version = 'GW-ESIGN-1', disclosure_sha256 = hx where id = s3;
  perform pg_temp.must_fail(format(call, s3, u_m, 'now()', 'Esign Probe Two', acct, jsonb_build_object('storage_path', 'ach-docs/employee/e/r3.pdf', 'sha256', repeat('5', 64), 'byte_size', 1), jsonb_build_object('storage_path', 'ach-docs/employee/e/c3.pdf', 'sha256', repeat('6', 64), 'byte_size', 1)), 'ACH_ESIGN_EXPIRED');
  -- cancel needs a reason; a cancelled session is final and may be removed
  perform pg_temp.must_fail(format($q$update public.ach_esign_sessions set state = 'cancelled', cancelled_at = now(), cancel_reason = 'x' where id = %L$q$, s3), 'esign_cancelled_shape');
  update public.ach_esign_sessions set state = 'cancelled', cancelled_at = now(), cancel_reason = 'Expired before signing.' where id = s3;
  perform pg_temp.must_fail(format($q$update public.ach_esign_sessions set cancel_reason = 'changed' where id = %L$q$, s3), 'ACH_ESIGN_FINAL');
  -- after cancelling, a new session for the same employee is allowed
  insert into public.ach_esign_sessions (employee_id, started_by, id_type, id_detail, legal_name) values (emp2, u_m, 'passport', '1111', 'Esign Probe Two');

  -- RLS + grants ------------------------------------------------------------
  select count(*) into n from pg_class where relname = 'ach_esign_sessions' and relrowsecurity;
  assert n = 1, 'RLS must be on';
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'ach_esign_sessions' and grantee = 'anon';
  assert n = 0, format('anon must have no grants, found %s', n);
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'ach_esign_sessions' and grantee = 'authenticated' and privilege_type = 'DELETE';
  assert n = 0, 'authenticated must not delete';
  select count(*) into n from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'ach_esign_complete'
     and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type = 'EXECUTE';
  assert n = 0, format('anon/authenticated must not execute ach_esign_complete, found %s', n);
  select count(*) into n from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'ach_esign_complete' and grantee = 'service_role' and privilege_type = 'EXECUTE';
  assert n = 1, 'service_role must execute ach_esign_complete';
  select count(*) into n from pg_proc where proname in ('ach_esign_complete', 'ach_esign_guard') and prosecdef;
  assert n = 0, 'e-sign functions must NOT be security definer';

  raise notice 'ACH 0261 CHECK PASSED';
end $$;

rollback;
