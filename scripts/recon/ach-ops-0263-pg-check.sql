-- scripts/recon/ach-ops-0263-pg-check.sql  (R39 S7 - migration 0263)
--
-- Scenario check for 0263_ach_operations.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   PGPASSWORD=postgres psql -h localhost -U postgres -d r39 \
--     -v ON_ERROR_STOP=1 -f scripts/recon/ach-ops-0263-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid call
-- that MUST be accepted. "ACH 0263 CHECK PASSED" then ROLLBACK = all clear.
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

-- A live account on an authorization (helper; returns its id).
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
  u_m    uuid := gen_random_uuid();
  u_s    uuid := gen_random_uuid();
  td     date := (now() at time zone 'America/Los_Angeles')::date;
  emp    uuid;
  emp2   uuid;
  ven    uuid;
  ven2   uuid;
  auth1  uuid;
  auth2  uuid;
  vauth  uuid;
  a1     uuid;
  a2     uuid;
  a3     uuid;
  b1     uuid;
  v1     uuid;
  v2     uuid;
  v3     uuid;
  w1     uuid;
  w2     uuid;
  n1     uuid;
  n2     uuid;
  res    jsonb;
  t      text;
  d      date;
  n      int;
  r      record;
  log_   text := $q$select public.ach_notice_log(%L, %L, %L, %L, %L, %L, %s, %L, %L, %L, %L, %L, %L)$q$;
  trace  text := '091000010000001';
begin
  insert into auth.users (id, email) values (u_m, 'm0263@x.test'), (u_s, 's0263@x.test');
  insert into public.staff_profiles (id, email, role, active) values (u_m, 'm0263@x.test', 'owner', true), (u_s, 's0263@x.test', 'admin', true)
    on conflict (id) do update set role = excluded.role, active = true;
  insert into public.employees (full_name) values ('Probe Employee One') returning id into emp;
  insert into public.employees (full_name) values ('Probe Employee Two') returning id into emp2;
  insert into public.vendors (display_name, slug) values ('Probe Vendor 263', 'probe-vendor-0263') returning id into ven;
  insert into public.vendors (display_name, slug) values ('Probe Vendor 263b', 'probe-vendor-0263b') returning id into ven2;

  insert into public.ach_authorizations (payee_type, employee_id, payee_name, state, signature_method, signed_on, created_by, updated_by)
    values ('employee', emp, 'Probe Employee One', 'signed', 'esign', td, u_m, u_m) returning id into auth1;
  insert into public.ach_authorizations (payee_type, employee_id, payee_name, state, signature_method, signed_on, created_by, updated_by)
    values ('employee', emp2, 'Probe Employee Two', 'signed', 'esign', td, u_m, u_m) returning id into auth2;
  insert into public.ach_authorizations (payee_type, vendor_id, payee_name, state, signature_method, signed_on, created_by, updated_by)
    values ('vendor', ven, 'Probe Vendor 263', 'signed', 'esign', td, u_m, u_m) returning id into vauth;
  a1 := pg_temp.acct(auth1, 1, '1111', u_m);
  a2 := pg_temp.acct(auth1, 2, '2222', u_m);
  b1 := pg_temp.acct(auth2, 1, '3333', u_m);

  -- vendor vault banking: lands on hold (0259), released dual -> active
  insert into public.vendor_bank_details (vendor_id, bank_routing, bank_account_number, created_by, updated_by)
    values (ven, '021000021', '123456789', u_m, u_m);
  update public.vendor_bank_details set status = 'active', released_by = u_s, released_at = clock_timestamp(), release_mode = 'dual',
         release_callback_method = 'phone', release_callback_note = 'Called vendor at number on file', updated_by = u_s
   where vendor_id = ven;
  select status into t from public.vendor_bank_details where vendor_id = ven;
  assert t = 'active', format('fixture: vault must be active, is %s', t);

  -- ===== verification_start ==================================================
  perform pg_temp.must_fail(format($q$select public.ach_verification_start(%L, null, 'prenote', null)$q$, a1), 'ACH_VERIFICATION_ACTOR');
  perform pg_temp.must_fail(format($q$select public.ach_verification_start(%L, %L, 'penny', null)$q$, a1, u_m), 'ACH_VERIFICATION_METHOD');
  perform pg_temp.must_fail(format($q$select public.ach_verification_start(%L, %L, 'prenote', null)$q$, gen_random_uuid(), u_m), 'ACH_VERIFICATION_ACCOUNT');
  perform pg_temp.must_fail(format($q$select public.ach_verification_start(%L, %L, 'micro_entry', 0)$q$, a2, u_m), 'ach_verifications_micro_amount_cents_check');
  perform pg_temp.must_fail(format($q$select public.ach_verification_start(%L, %L, 'micro_entry', 100)$q$, a2, u_m), 'ach_verifications_micro_amount_cents_check');
  perform pg_temp.must_fail(format($q$select public.ach_verification_start(%L, %L, 'micro_entry', null)$q$, a2, u_m), 'ach_ver_micro_amount');
  v1 := public.ach_verification_start(a1, u_m, 'prenote', null);
  select verification_status into t from public.ach_authorization_accounts where id = a1;
  assert t = 'pending', format('started account is pending, is %s', t);
  select state into t from public.ach_authorizations where id = auth1;
  assert t = 'verifying', format('signed -> verifying on first check, is %s', t);
  perform pg_temp.must_fail(format($q$select public.ach_verification_start(%L, %L, 'prenote', null)$q$, a1, u_m), 'ach_ver_one_open_per_account');
  v2 := public.ach_verification_start(a2, u_m, 'micro_entry', 37);
  select micro_amount_cents into n from public.ach_verifications where id = v2;
  assert n = 37, 'micro amount stored';
  select count(*) into n from public.ach_authorization_events where authorization_id = auth1 and event_kind = 'verification_started';
  assert n = 2, format('two verification_started events, found %s', n);

  -- ===== mark_sent ===========================================================
  t := $q$select public.ach_verification_mark_sent(%s, %L, %L, %L, %L, 'prenote.ach')$q$;
  perform pg_temp.must_fail(format(t, format('array[%L]::uuid[]', v1), null, td - 3, td - 2, td + 1), 'ACH_VERIFICATION_ACTOR');
  perform pg_temp.must_fail(format(t, 'array[]::uuid[]', u_m, td - 3, td - 2, td + 1), 'ACH_VERIFICATION_EMPTY');
  perform pg_temp.must_fail(format(t, format('array[%L]::uuid[]', v1), u_m, td - 2, td - 3, td + 1), 'ACH_VERIFICATION_DATES');
  perform pg_temp.must_fail(format(t, format('array[%L]::uuid[]', v1), u_m, td - 3, td - 2, td - 2), 'ACH_VERIFICATION_DATES');
  perform pg_temp.must_fail(format(t, format('array[%L]::uuid[]', v1), u_m, null, td - 2, td + 1), 'ACH_VERIFICATION_DATES');
  perform pg_temp.must_fail(format(t, format('array[%L, %L]::uuid[]', v1, gen_random_uuid()), u_m, td - 3, td - 2, td + 1), 'ACH_VERIFICATION_NOT_FOUND');
  -- prenote sent with a live day in the FUTURE
  n := public.ach_verification_mark_sent(array[v1], u_m, td - 1, td, td + 3, 'prenote.ach');
  assert n = 1, 'one marked sent';
  select * into r from public.ach_verifications where id = v1;
  assert r.status = 'sent' and r.eligible_on = td + 3 and r.settlement_date = td, 'prenote sent with its dates';
  perform pg_temp.must_fail(format(t, format('array[%L]::uuid[]', v1), u_m, td - 3, td - 2, td + 1), 'ACH_VERIFICATION_STATE');

  -- ===== verification guard ==================================================
  perform pg_temp.must_fail(format($q$delete from public.ach_verifications where id = %L$q$, v1), 'ACH_VERIFICATION_KEEP');
  perform pg_temp.must_fail(format($q$update public.ach_verifications set method = 'micro_entry', micro_amount_cents = 5 where id = %L$q$, v1), 'ACH_VERIFICATION_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.ach_verifications set micro_amount_cents = 38 where id = %L$q$, v2), 'ACH_VERIFICATION_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.ach_verifications set eligible_on = %L where id = %L$q$, td, v1), 'ACH_VERIFICATION_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.ach_verifications set status = 'passed' where id = %L$q$, v2), 'ACH_VERIFICATION_TRANSITION');
  perform pg_temp.must_fail(format($q$update public.ach_verifications set status = 'sent' where id = %L$q$, v2), 'ach_ver_sent_shape');
  -- the early prenote cannot pass
  perform pg_temp.must_fail(format($q$select public.ach_verification_finish(%L, %L, 'passed', null, null)$q$, v1, u_m), 'ACH_VERIFICATION_EARLY');
  perform pg_temp.must_fail(format($q$select public.ach_verification_finish(%L, %L, 'won', null, null)$q$, v1, u_m), 'ACH_VERIFICATION_OUTCOME');
  perform pg_temp.must_fail(format($q$select public.ach_verification_finish(%L, null, 'passed', null, null)$q$, v1, u_m), 'ACH_VERIFICATION_ACTOR');
  perform pg_temp.must_fail(format($q$select public.ach_verification_finish(%L, %L, 'cancelled', null, 'x')$q$, v1, u_m), 'ach_ver_note_shape');
  t := public.ach_verification_finish(v1, u_m, 'cancelled', null, 'Wrong effective date, resending');
  assert t = 'verifying', format('cancel keeps verifying, got %s', t);
  select verification_status into t from public.ach_authorization_accounts where id = a1;
  assert t = 'unverified', format('cancelled check -> account unverified, is %s', t);
  perform pg_temp.must_fail(format($q$update public.ach_verifications set note = 'changed later' where id = %L$q$, v1), 'ACH_VERIFICATION_FINAL');
  perform pg_temp.must_fail(format($q$select public.ach_verification_finish(%L, %L, 'passed', null, null)$q$, v1, u_m), 'ACH_VERIFICATION_FINAL');

  -- resend the prenote; this time it settled long enough ago
  v3 := public.ach_verification_start(a1, u_m, 'prenote', null);
  perform public.ach_verification_mark_sent(array[v3, v2], u_m, td - 6, td - 5, td, 'verify-2.ach');
  select eligible_on into d from public.ach_verifications where id = v2;
  assert d = td - 4, format('micro entry eligible the day after settlement, got %s', d);
  select count(*) into n from public.ach_authorization_events where authorization_id = auth1 and event_kind = 'verification_sent'
     and (detail ->> 'eligible_on')::date = td - 4;
  assert n = 1, 'micro event records its own eligible day';
  t := public.ach_verification_finish(v3, u_m, 'passed', null, null);
  assert t = 'verifying', format('one of two verified -> still verifying, got %s', t);
  select * into r from public.ach_authorization_accounts where id = a1;
  assert r.verification_status = 'verified' and r.verification_method = 'prenote' and r.verified_by = u_m, 'prenote verified the account';
  -- test credit: wrong cents refused, exact cents accepted
  perform pg_temp.must_fail(format($q$select public.ach_verification_finish(%L, %L, 'passed', 36, null)$q$, v2, u_m), 'ACH_VERIFICATION_AMOUNT');
  perform pg_temp.must_fail(format($q$select public.ach_verification_finish(%L, %L, 'passed', null, null)$q$, v2, u_m), 'ACH_VERIFICATION_AMOUNT');
  t := public.ach_verification_finish(v2, u_m, 'passed', 37, null);
  assert t = 'active', format('every account verified -> active, got %s', t);
  select * into r from public.ach_authorizations where id = auth1;
  assert r.state = 'active' and r.annual_review_due_on = (td + interval '1 year')::date, format('active with review date, got %s %s', r.state, r.annual_review_due_on);
  -- active authorization: no new checks (a hold must come first)
  a3 := pg_temp.acct(auth1, 3, '4444', u_m);
  perform pg_temp.must_fail(format($q$select public.ach_verification_start(%L, %L, 'voided_check_callback', null)$q$, a3, u_m), 'ACH_VERIFICATION_STATE');
  perform pg_temp.must_fail(format($q$select public.ach_verification_start(%L, %L, 'prenote', null)$q$, a1, u_m), 'already verified');

  -- ===== review done =========================================================
  perform pg_temp.must_fail(format($q$select public.ach_auth_review_done(%L, %L, 'short')$q$, auth1, u_m), 'ACH_REVIEW');
  perform pg_temp.must_fail(format($q$select public.ach_auth_review_done(%L, null, 'Checked both accounts')$q$, auth1), 'ACH_REVIEW');
  perform pg_temp.must_fail(format($q$select public.ach_auth_review_done(%L, %L, 'Checked both accounts')$q$, auth2, u_m), 'ACH_REVIEW');
  update public.ach_authorizations set annual_review_due_on = td - 3 where id = auth1;
  d := public.ach_auth_review_done(auth1, u_m, 'Checked both accounts and callback numbers');
  assert d = (td + interval '1 year')::date, 'next review a year out';
  select count(*) into n from public.ach_authorization_events where authorization_id = auth1 and event_kind = 'annual_review_done'
     and (detail ->> 'previous_due')::date = td - 3;
  assert n = 1, 'review event keeps the previous due date';

  -- ===== notice log: refusals ================================================
  perform pg_temp.must_fail(format(log_, null, 'employee', emp, 'R01', td, td - 2, 1000, trace, null, null, null, 'Return R01 from Timberland', null), 'ACH_NOTICE_ACTOR');
  perform pg_temp.must_fail(format(log_, u_m, 'store', emp, 'R01', td, td - 2, 1000, trace, null, null, null, 'Return R01 from Timberland', null), 'ACH_NOTICE_PAYEE');
  perform pg_temp.must_fail(format(log_, u_m, 'employee', gen_random_uuid(), 'R01', td, td - 2, 1000, trace, null, null, null, 'Return R01 from Timberland', null), 'ACH_NOTICE_PAYEE');
  perform pg_temp.must_fail(format(log_, u_m, 'vendor', gen_random_uuid(), 'R01', td, td - 2, 1000, trace, null, null, null, 'Return R01 from Timberland', null), 'ACH_NOTICE_PAYEE');
  perform pg_temp.must_fail(format(log_, u_m, 'employee', emp, 'X01', td, td - 2, 1000, trace, null, null, null, 'Return R01 from Timberland', null), 'ACH_NOTICE_CODE');
  perform pg_temp.must_fail(format(log_, u_m, 'employee', emp, 'R1', td, td - 2, 1000, trace, null, null, null, 'Return R01 from Timberland', null), 'ACH_NOTICE_CODE');
  perform pg_temp.must_fail(format(log_, u_m, 'employee', emp, 'R01', td + 1, null, 1000, trace, null, null, null, 'Return R01 from Timberland', null), 'ACH_NOTICE_DATE');
  perform pg_temp.must_fail(format(log_, u_m, 'employee', emp, 'R01', td - 401, null, 1000, trace, null, null, null, 'Return R01 from Timberland', null), 'ACH_NOTICE_DATE');
  perform pg_temp.must_fail(format(log_, u_m, 'employee', emp, 'R01', td - 1, td, 1000, trace, null, null, null, 'Return R01 from Timberland', null), 'ACH_NOTICE_DATE');
  perform pg_temp.must_fail(format(log_, u_m, 'employee', emp, 'C01', td, td - 2, 0, trace, null, null, td + 6, 'NOC C01 from Timberland', null), 'ACH_NOTICE_NOC');
  perform pg_temp.must_fail(format(log_, u_m, 'employee', emp, 'C01', td, td - 2, 0, trace, 'encv1:c:x', '6789', null, 'NOC C01 from Timberland', null), 'ACH_NOTICE_NOC');
  perform pg_temp.must_fail(format(log_, u_m, 'employee', emp, 'C01', td, td - 2, 0, trace, 'encv1:c:x', '6789', td - 1, 'NOC C01 from Timberland', null), 'ACH_NOTICE_NOC');
  perform pg_temp.must_fail(format(log_, u_m, 'employee', emp, 'R01', td, td - 2, 1000, trace, 'encv1:c:x', null, null, 'Return R01 from Timberland', null), 'ACH_NOTICE_NOC');
  perform pg_temp.must_fail(format(log_, u_m, 'employee', emp, 'R01', td, td - 2, 1000, trace, null, null, td + 6, 'Return R01 from Timberland', null), 'ACH_NOTICE_NOC');
  perform pg_temp.must_fail(format(log_, u_m, 'employee', emp, 'R01', td, td - 2, 1000, trace, null, null, null, 'R01 short', null), 'ACH_NOTICE_REASON');
  perform pg_temp.must_fail(format(log_, u_m, 'employee', emp, 'R01', td, td - 2, 1000, '12345', null, null, null, 'Return R01 from Timberland', null), 'ach_return_notices_trace_number_check');
  perform pg_temp.must_fail(format(log_, u_m, 'employee', emp, 'C01', td, td - 2, 0, trace, 'plain-6789', '6789', td + 6, 'NOC C01 from Timberland', null), 'ach_return_notices_corrected_data_enc_check');
  perform pg_temp.must_fail(format(log_, u_m, 'employee', emp, 'C01', td, td - 2, 0, trace, 'encv1:c:x', '56789', td + 6, 'NOC C01 from Timberland', null), 'ach_notice_corrected_shape');
  select count(*) into n from public.ach_return_notices where employee_id = emp;
  assert n = 0, 'refused notices wrote nothing';
  select state into t from public.ach_authorizations where id = auth1;
  assert t = 'active', 'refused notices held nothing';

  -- ===== notice log: employee return holds the authorization =================
  res := public.ach_notice_log(u_m, 'employee', emp, 'R01', td, td - 2, 1000, trace, null, null, null, 'Return R01 insufficient funds', null);
  assert res ->> 'hold' = 'authorization', format('employee return holds the authorization, got %s', res);
  assert (res ->> 'authorization_id')::uuid = auth1, 'notice names the authorization';
  n1 := (res ->> 'notice_id')::uuid;
  select * into r from public.ach_authorizations where id = auth1;
  assert r.state = 'on_hold' and r.hold_entered_by = u_m and r.hold_reason = 'Return R01 insufficient funds', format('held by u_m, got %s', r.state);
  select * into r from public.ach_return_notices where id = n1;
  assert r.notice_kind = 'return' and r.payee_type = 'employee' and r.employee_id = emp and r.vendor_id is null
     and r.hold_applied = 'authorization' and r.created_by = u_m and r.authorization_id = auth1, 'notice row is complete';
  select count(*) into n from public.ach_authorization_events where authorization_id = auth1 and event_kind = 'return_logged';
  assert n = 1, 'return_logged event';
  -- a change notice while on hold: already_on_hold, kind noc
  res := public.ach_notice_log(u_s, 'employee', emp, 'C01', td, td - 2, 0, trace, 'encv1:c:x', '6789', td + 6, 'NOC C01 new account number', null);
  assert res ->> 'hold' = 'already_on_hold', format('second notice sees the hold, got %s', res);
  n2 := (res ->> 'notice_id')::uuid;
  select hold_entered_by into r from public.ach_authorizations where id = auth1;
  assert r.hold_entered_by = u_m, 'the first holder stays recorded';
  select count(*) into n from public.ach_authorization_events where authorization_id = auth1 and event_kind = 'noc_logged' and detail ->> 'corrected_last4' = '6789';
  assert n = 1, 'noc_logged event keeps only the last 4';
  select count(*) into n from public.ach_authorization_events where authorization_id = auth1 and detail::text like '%encv1%';
  assert n = 0, 'events never copy the encrypted correction';

  -- ===== notice guard + resolve ==============================================
  perform pg_temp.must_fail(format($q$delete from public.ach_return_notices where id = %L$q$, n1), 'ACH_NOTICE_KEEP');
  perform pg_temp.must_fail(format($q$update public.ach_return_notices set amount_cents = 1 where id = %L$q$, n1), 'ACH_NOTICE_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.ach_return_notices set hold_applied = 'none' where id = %L$q$, n1), 'ACH_NOTICE_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.ach_return_notices set employee_id = %L where id = %L$q$, emp2, n1), 'ACH_NOTICE_IMMUTABLE');
  perform pg_temp.must_fail(format($q$select public.ach_notice_resolve(%L, %L, 'done')$q$, n1, u_m), 'ACH_NOTICE_REASON');
  perform pg_temp.must_fail(format($q$select public.ach_notice_resolve(%L, null, 'Employee gave new account')$q$, n1), 'ACH_NOTICE_ACTOR');
  perform pg_temp.must_fail(format($q$select public.ach_notice_resolve(%L, %L, 'Employee gave new account')$q$, gen_random_uuid(), u_m), 'ACH_NOTICE_NOT_FOUND');
  perform pg_temp.must_fail(format($q$update public.ach_return_notices set resolved_at = now(), resolved_by = %L, resolution_note = 'ok' where id = %L$q$, u_m, n1), 'ach_notice_note_shape');
  perform public.ach_notice_resolve(n1, u_s, 'Employee confirmed account; bank error');
  select * into r from public.ach_return_notices where id = n1;
  assert r.resolved_by = u_s and r.resolution_note = 'Employee confirmed account; bank error', 'resolved';
  perform pg_temp.must_fail(format($q$select public.ach_notice_resolve(%L, %L, 'Second resolution text')$q$, n1, u_m), 'ACH_NOTICE_FINAL');
  perform pg_temp.must_fail(format($q$update public.ach_return_notices set resolution_note = 'Rewritten afterwards' where id = %L$q$, n1), 'ACH_NOTICE_FINAL');
  select count(*) into n from public.ach_authorization_events where event_kind = 'notice_resolved' and (detail ->> 'notice_id')::uuid = n1;
  assert n = 1, 'notice_resolved event';
  -- a raw (pre-0263 shape) row cannot be resolved by the function
  insert into public.ach_return_notices (notice_kind, code, received_on, created_by) values ('return', 'R02', td, u_m) returning id into n2;
  perform pg_temp.must_fail(format($q$select public.ach_notice_resolve(%L, %L, 'Resolving a raw row')$q$, n2, u_m), 'ACH_NOTICE_PAYEE');
  perform pg_temp.must_fail(format($q$insert into public.ach_return_notices (notice_kind, code, received_on, payee_type, employee_id, vendor_id) values ('return', 'R02', %L, 'employee', %L, %L)$q$, td, emp, ven), 'ach_notice_payee_shape');
  perform pg_temp.must_fail(format($q$insert into public.ach_return_notices (notice_kind, code, received_on, payee_type) values ('return', 'R02', %L, 'vendor')$q$, td), 'ach_notice_payee_shape');
  perform pg_temp.must_fail(format($q$insert into public.ach_return_notices (notice_kind, code, received_on, hold_applied) values ('return', 'R02', %L, 'maybe')$q$, td), 'ach_notice_hold_applied_shape');
  perform pg_temp.must_fail(format($q$insert into public.ach_return_notices (notice_kind, code, received_on, corrected_data_enc) values ('return', 'R02', %L, 'encv1:c:x')$q$, td), 'ach_notice_corrected_shape');

  -- ===== release employee hold ===============================================
  t := $q$select public.ach_auth_release_hold(%L, %L, %L, %L, %L)$q$;
  perform pg_temp.must_fail(format(t, vauth, u_s, 'phone', 'Called vendor back', null), 'ACH_RELEASE_PAYEE');
  perform pg_temp.must_fail(format(t, auth2, u_s, 'phone', 'Called employee back', null), 'ACH_RELEASE_STATE');
  perform pg_temp.must_fail(format(t, gen_random_uuid(), u_s, 'phone', 'Called employee back', null), 'ACH_RELEASE_NOT_FOUND');
  perform pg_temp.must_fail(format(t, auth1, null, 'phone', 'Called employee back', null), 'ACH_RELEASE_ACTOR');
  perform pg_temp.must_fail(format(t, auth1, u_s, 'email', 'Called employee back', null), 'ACH_RELEASE_CALLBACK');
  perform pg_temp.must_fail(format(t, auth1, u_s, 'phone', 'ok', null), 'ACH_RELEASE_CALLBACK');
  perform pg_temp.must_fail(format(t, auth1, u_m, 'phone', 'Called employee back', 'too short reason'), 'ACH_RELEASE_SOLO');
  -- a3 (unverified, added while active) is still live -> release goes to verifying
  t := public.ach_auth_release_hold(auth1, u_s, 'phone', 'Called employee at number on file', null);
  assert t = 'dual', format('different person = dual, got %s', t);
  select * into r from public.ach_authorizations where id = auth1;
  assert r.state = 'verifying' and r.hold_reason is null, format('unverified account -> verifying, got %s', r.state);
  -- verify a3 by callback, then the authorization is active again
  w1 := public.ach_verification_start(a3, u_m, 'voided_check_callback', null);
  perform pg_temp.must_fail(format($q$select public.ach_verification_mark_sent(array[%L]::uuid[], %L, %L, %L, %L, 'x')$q$, w1, u_m, td - 3, td - 2, td), 'ACH_VERIFICATION_STATE');
  perform pg_temp.must_fail(format($q$select public.ach_verification_finish(%L, %L, 'passed', null, 'ok')$q$, w1, u_m), 'ACH_VERIFICATION_NOTE');
  t := public.ach_verification_finish(w1, u_m, 'passed', null, 'Employee read voided check digits by phone');
  assert t = 'active', format('callback verified the last account -> active, got %s', t);
  -- solo release: the same person holds and releases
  perform public.ach_notice_log(u_m, 'employee', emp, 'R03', td, td - 1, 1000, trace, null, null, null, 'Return R03 no account found', null);
  t := public.ach_auth_release_hold(auth1, u_m, 'in_person', 'Employee came in with new check', 'Only owner on shift; bank confirmed error.');
  assert t = 'solo', format('same person = solo, got %s', t);
  select state into t from public.ach_authorizations where id = auth1;
  assert t = 'active', format('all verified -> active, got %s', t);
  select count(*) into n from public.ach_authorization_events where authorization_id = auth1 and event_kind = 'hold_released_solo';
  assert n = 1, 'solo release event';
  -- unknown holder (older hold without hold_entered_by) is solo too
  update public.ach_authorizations set state = 'on_hold', hold_reason = 'Old manual hold', hold_entered_by = null where id = auth1;
  perform pg_temp.must_fail(format($q$select public.ach_auth_release_hold(%L, %L, 'phone', 'Called employee back', 'short')$q$, auth1, u_s), 'ACH_RELEASE_SOLO');
  t := public.ach_auth_release_hold(auth1, u_s, 'phone', 'Called employee back', 'Hold had no recorded author; owner checked.');
  assert t = 'solo', 'unknown holder = solo';

  -- ===== a notice answers a prenote: the check fails =========================
  w2 := public.ach_verification_start(b1, u_m, 'prenote', null);
  perform pg_temp.must_fail(format(log_, u_m, 'employee', emp2, 'R03', td, null, 0, trace, null, null, null, 'Prenote returned R03', w2), 'not waiting for an answer');
  perform public.ach_verification_mark_sent(array[w2], u_m, td - 2, td - 1, td + 2, 'prenote-3.ach');
  perform pg_temp.must_fail(format(log_, u_m, 'employee', emp, 'R03', td, null, 0, trace, null, null, null, 'Prenote returned R03', w2), 'different payee');
  perform pg_temp.must_fail(format(log_, u_m, 'vendor', ven, 'R03', td, null, 0, trace, null, null, null, 'Prenote returned R03', w2), 'different payee');
  perform pg_temp.must_fail(format(log_, u_m, 'employee', emp2, 'R03', td, null, 0, trace, null, null, null, 'Prenote returned R03', gen_random_uuid()), 'ACH_NOTICE_VERIFICATION');
  res := public.ach_notice_log(u_m, 'employee', emp2, 'R03', td, null, 0, trace, null, null, null, 'Prenote returned R03', w2);
  assert res ->> 'hold' = 'authorization', 'verifying authorization goes on hold';
  select * into r from public.ach_verifications where id = w2;
  assert r.status = 'failed' and r.result_code = 'R03', format('prenote failed by the notice, got %s', r.status);
  select verification_status into t from public.ach_authorization_accounts where id = b1;
  assert t = 'failed', 'account failed';
  select account_id into r from public.ach_return_notices where id = (res ->> 'notice_id')::uuid;
  assert r.account_id = b1, 'notice names the account';
  perform pg_temp.must_fail(format($q$select public.ach_verification_finish(%L, %L, 'passed', null, null)$q$, w2, u_m), 'ACH_VERIFICATION_FINAL');
  -- held authorization: no new check until released
  perform pg_temp.must_fail(format($q$select public.ach_verification_start(%L, %L, 'prenote', null)$q$, b1, u_m), 'ACH_VERIFICATION_STATE');

  -- ===== vendor notices hold the vault =======================================
  res := public.ach_notice_log(u_m, 'vendor', ven, 'R02', td, td - 3, 50000, trace, null, null, null, 'Vendor return R02 account closed', null);
  assert res ->> 'hold' = 'vault', format('vendor return holds the vault, got %s', res);
  assert (res ->> 'authorization_id')::uuid = vauth, 'vendor notice names the vendor authorization';
  select * into r from public.vendor_bank_details where vendor_id = ven;
  assert r.status = 'on_hold' and r.hold_reason = 'Vendor return R02 account closed', format('vault on hold, got %s', r.status);
  select state into t from public.ach_authorizations where id = vauth;
  assert t = 'signed', 'vendor authorization state is not touched (the vault pays vendors)';
  res := public.ach_notice_log(u_m, 'vendor', ven, 'C01', td, td - 3, 0, trace, 'encv1:c:x', '0042', td + 6, 'Vendor NOC C01 new account', null);
  assert res ->> 'hold' = 'already_on_hold', 'second vendor notice sees the hold';
  -- release the vault (dual), then the SAME reason again still holds it (0259 needs a new reason)
  update public.vendor_bank_details set status = 'active', released_by = u_s, released_at = clock_timestamp(), release_mode = 'dual',
         release_callback_method = 'phone', release_callback_note = 'Called vendor AP at number on file', updated_by = u_s
   where vendor_id = ven;
  res := public.ach_notice_log(u_m, 'vendor', ven, 'R02', td, td - 3, 50000, trace, null, null, null, 'Vendor return R02 account closed', null);
  assert res ->> 'hold' = 'vault', 'repeat reason still holds';
  select * into r from public.vendor_bank_details where vendor_id = ven;
  assert r.status = 'on_hold' and r.hold_reason like 'Vendor return R02 account closed (%', format('repeat reason gets a time, got %s', r.hold_reason);
  -- vendor with no vault banking: nothing to hold, notice still kept
  res := public.ach_notice_log(u_m, 'vendor', ven2, 'R01', td, null, 100, null, null, null, null, 'Vendor return with no vault row', null);
  assert res ->> 'hold' = 'none' and res ->> 'authorization_id' is null, format('no vault -> none, got %s', res);
  select vendor_id, employee_id into r from public.ach_return_notices where id = (res ->> 'notice_id')::uuid;
  assert r.vendor_id = ven2 and r.employee_id is null, 'vendor notice row';

  -- ===== legal hold ==========================================================
  t := $q$select public.ach_auth_set_legal_hold(%L, %L, %s, %L)$q$;
  perform pg_temp.must_fail(format(t, auth1, u_m, 'true', 'short'), 'ACH_LEGAL_HOLD');
  perform pg_temp.must_fail(format(t, auth1, null, 'true', 'Wage claim 2026-17'), 'ACH_LEGAL_HOLD');
  perform pg_temp.must_fail(format(t, auth1, u_m, 'null', 'Wage claim 2026-17'), 'ACH_LEGAL_HOLD');
  perform pg_temp.must_fail(format(t, gen_random_uuid(), u_m, 'true', 'Wage claim 2026-17'), 'not found');
  perform pg_temp.must_fail(format(t, auth1, u_m, 'false', 'Wage claim 2026-17'), 'already off');
  perform public.ach_auth_set_legal_hold(auth1, u_m, true, 'Wage claim 2026-17 (attorney)');
  select legal_hold, legal_hold_reason into r from public.ach_authorizations where id = auth1;
  assert r.legal_hold and r.legal_hold_reason = 'Wage claim 2026-17 (attorney)', 'legal hold on';
  perform pg_temp.must_fail(format(t, auth1, u_m, 'true', 'Wage claim 2026-17'), 'already on');
  perform public.ach_auth_set_legal_hold(auth1, u_s, false, 'Claim closed per attorney letter');
  select legal_hold, legal_hold_reason into r from public.ach_authorizations where id = auth1;
  assert not r.legal_hold and r.legal_hold_reason is null, 'legal hold off';
  select count(*) into n from public.ach_authorization_events where authorization_id = auth1 and event_kind in ('legal_hold_on', 'legal_hold_off');
  assert n = 2, 'legal hold events';
  select count(*) into n from public.ach_authorization_events where authorization_id = auth1 and event_kind = 'legal_hold_off'
     and detail ->> 'previous_reason' = 'Wage claim 2026-17 (attorney)';
  assert n = 1, 'off event keeps the old reason';

  -- every event kind fits 0258's pattern (the insert would have failed otherwise); none deletable
  perform pg_temp.must_fail(format($q$delete from public.ach_authorization_events where authorization_id = %L$q$, auth1), 'ACH_EVENTS');

  -- ===== privileges ==========================================================
  select count(*) into n from information_schema.routine_privileges
   where routine_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type = 'EXECUTE'
     and routine_name in ('ach_notice_log', 'ach_notice_resolve', 'ach_auth_release_hold', 'ach_verification_start',
                          'ach_verification_mark_sent', 'ach_verification_finish', 'ach_auth_set_legal_hold', 'ach_auth_review_done');
  assert n = 0, format('anon/authenticated must not execute 0263 functions, found %s', n);
  select count(*) into n from information_schema.routine_privileges
   where routine_schema = 'public' and grantee = 'service_role' and privilege_type = 'EXECUTE'
     and routine_name in ('ach_notice_log', 'ach_notice_resolve', 'ach_auth_release_hold', 'ach_verification_start',
                          'ach_verification_mark_sent', 'ach_verification_finish', 'ach_auth_set_legal_hold', 'ach_auth_review_done');
  assert n = 8, format('service_role executes all eight, found %s', n);
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosecdef
     and p.proname in ('ach_notice_log', 'ach_notice_resolve', 'ach_auth_release_hold', 'ach_verification_start', 'ach_verification_mark_sent',
                       'ach_verification_finish', 'ach_auth_set_legal_hold', 'ach_auth_review_done', 'ach_notice_guard', 'ach_verification_guard');
  assert n = 0, '0263 functions must NOT be security definer';
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and 'search_path=public, pg_temp' = any (p.proconfig)
     and p.proname in ('ach_notice_log', 'ach_notice_resolve', 'ach_auth_release_hold', 'ach_verification_start',
                       'ach_verification_mark_sent', 'ach_verification_finish', 'ach_auth_set_legal_hold', 'ach_auth_review_done');
  assert n = 8, format('all eight pin search_path, found %s', n);
  select count(*) into n from pg_class where relname in ('ach_return_notices', 'ach_verifications', 'ach_authorizations') and relrowsecurity;
  assert n = 3, 'RLS stays on';

  raise notice 'ACH 0263 CHECK PASSED';
end $$;

rollback;
