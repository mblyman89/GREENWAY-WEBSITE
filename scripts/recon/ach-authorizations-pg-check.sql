-- scripts/recon/ach-authorizations-pg-check.sql  (R39 S2 - migration 0258)
--
-- Scenario check for 0258_ach_authorizations.sql against a real Postgres 15
-- with every migration applied (scripts/compliance/verify-migrations-execute.ts
-- run against the CI bootstrap). ONE transaction, rolled back: no rows remain.
--
--   PGPASSWORD=postgres psql -h localhost -U postgres -d r39 \
--     -v ON_ERROR_STOP=1 -f scripts/recon/ach-authorizations-pg-check.sql
--
-- Every refusal is a probe that MUST raise, with the expected message or
-- SQLSTATE, and sits beside a VALID row that MUST be accepted - a guard that
-- rejected everything would fail the accept half. "ACH 0258 CHECK PASSED"
-- followed by ROLLBACK is the all-clear.
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
  u_admin uuid := gen_random_uuid();
  u_mgr   uuid := gen_random_uuid();
  u_staff uuid := gen_random_uuid();
  emp     uuid;
  emp2    uuid;
  ven     uuid;
  auth_e  uuid;
  auth_v  uuid;
  acct1   uuid;
  acct2   uuid;
  doc     uuid;
  n       int;
  enc     text := 'encv1:aaaa:bbbb';
  h1      text := repeat('a', 64);
  h2      text := repeat('b', 64);
  h3      text := repeat('c', 64);
  h4      text := repeat('d', 64);
begin
  -- fixtures --------------------------------------------------------------
  insert into auth.users (id, email) values (u_admin, 'a@x.test'), (u_mgr, 'm@x.test'), (u_staff, 's@x.test');
  insert into public.staff_profiles (id, email, role, active) values
    (u_admin, 'a@x.test', 'admin', true) on conflict (id) do update set role = 'admin', active = true;
  insert into public.staff_profiles (id, email, role, active) values
    (u_mgr, 'm@x.test', 'manager', true) on conflict (id) do update set role = 'manager', active = true;
  insert into public.staff_profiles (id, email, role, active) values
    (u_staff, 's@x.test', 'staff', true) on conflict (id) do update set role = 'staff', active = true;
  insert into public.employees (full_name) values ('Probe Employee') returning id into emp;
  insert into public.employees (full_name) values ('Probe Employee Two') returning id into emp2;
  insert into public.vendors (display_name, slug) values ('Probe Vendor', 'probe-vendor-r39') returning id into ven;

  -- 1. authorizations: payee shape --------------------------------------
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_authorizations (payee_type, employee_id, vendor_id) values ('employee', %L, %L)$q$, emp, ven),
    'ach_auth_payee_matches_type');
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_authorizations (payee_type, vendor_id) values ('employee', %L)$q$, ven),
    'ach_auth_payee_matches_type');
  insert into public.ach_authorizations (payee_type, employee_id, payee_name) values ('employee', emp, 'Probe Employee')
    returning id into auth_e;
  insert into public.ach_authorizations (payee_type, vendor_id, payee_name) values ('vendor', ven, 'Probe Vendor')
    returning id into auth_v;

  -- one open authorization per payee
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_authorizations (payee_type, employee_id) values ('employee', %L)$q$, emp), '23505');

  -- signed needs date and method
  perform pg_temp.must_fail(format($q$update public.ach_authorizations set state = 'signed' where id = %L$q$, auth_e),
    'ach_auth_signed_has_date');
  perform pg_temp.must_fail(format(
    $q$update public.ach_authorizations set state = 'signed', signed_on = '2026-10-01' where id = %L$q$, auth_e),
    'ach_auth_signed_has_method');
  -- illegal transition draft -> active
  perform pg_temp.must_fail(format(
    $q$update public.ach_authorizations set state = 'active', signed_on = '2026-10-01', signature_method = 'esign' where id = %L$q$, auth_e),
    'ACH_AUTH_TRANSITION');
  update public.ach_authorizations set state = 'signed', signed_on = '2026-10-01', signature_method = 'esign' where id = auth_e;
  -- on_hold needs a reason
  perform pg_temp.must_fail(format($q$update public.ach_authorizations set state = 'on_hold' where id = %L$q$, auth_e),
    'ach_auth_hold_has_reason');
  update public.ach_authorizations set state = 'on_hold', hold_reason = 'bank change pending callback' where id = auth_e;
  update public.ach_authorizations set state = 'active' where id = auth_e;
  -- legal hold needs a reason
  perform pg_temp.must_fail(format($q$update public.ach_authorizations set legal_hold = true where id = %L$q$, auth_e),
    'ach_auth_legal_hold_reason');

  -- 2. accounts ----------------------------------------------------------
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_authorization_accounts (authorization_id, priority, rule_kind, routing_enc, account_enc,
       account_type, account_last4, routing_last4, account_key_hmac)
       values (%L, 1, 'remainder', '125000105', %L, 'checking', '6789', '0105', %L)$q$, auth_e, enc, h1),
    'routing_enc');
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_authorization_accounts (authorization_id, priority, rule_kind, routing_enc, account_enc,
       account_type, account_last4, routing_last4, account_key_hmac)
       values (%L, 1, 'fixed', %L, %L, 'checking', '6789', '0105', %L)$q$, auth_e, enc, enc, h1),
    'ach_acct_rule_shape');
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_authorization_accounts (authorization_id, priority, rule_kind, basis_points, routing_enc, account_enc,
       account_type, account_last4, routing_last4, account_key_hmac)
       values (%L, 1, 'percent', 10000, %L, %L, 'checking', '6789', '0105', %L)$q$, auth_e, enc, enc, h1),
    'ach_acct_rule_shape');
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_authorization_accounts (authorization_id, priority, rule_kind, routing_enc, account_enc,
       account_type, account_last4, routing_last4, account_key_hmac)
       values (%L, 1, 'remainder', %L, %L, 'checking', '6789', '0105', 'NOTHEX')$q$, auth_e, enc, enc),
    'account_key_hmac');
  insert into public.ach_authorization_accounts (authorization_id, priority, rule_kind, routing_enc, account_enc,
     account_type, account_last4, routing_last4, account_key_hmac)
     values (auth_e, 3, 'remainder', enc, enc, 'checking', '6789', '0105', h1) returning id into acct1;
  -- a second remainder is refused
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_authorization_accounts (authorization_id, priority, rule_kind, routing_enc, account_enc,
       account_type, account_last4, routing_last4, account_key_hmac)
       values (%L, 2, 'remainder', %L, %L, 'savings', '1111', '0105', %L)$q$, auth_e, enc, enc, h2),
    '23505');
  -- same account twice is refused
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_authorization_accounts (authorization_id, priority, rule_kind, fixed_cents, routing_enc, account_enc,
       account_type, account_last4, routing_last4, account_key_hmac)
       values (%L, 1, 'fixed', 5000, %L, %L, 'checking', '6789', '0105', %L)$q$, auth_e, enc, enc, h1),
    '23505');
  insert into public.ach_authorization_accounts (authorization_id, priority, rule_kind, fixed_cents, routing_enc, account_enc,
     account_type, account_last4, routing_last4, account_key_hmac)
     values (auth_e, 1, 'fixed', 5000, enc, enc, 'savings', '1111', '0105', h2) returning id into acct2;
  insert into public.ach_authorization_accounts (authorization_id, priority, rule_kind, basis_points, routing_enc, account_enc,
     account_type, account_last4, routing_last4, account_key_hmac)
     values (auth_e, 2, 'percent', 1000, enc, enc, 'savings', '2222', '0105', h3);
  -- a fourth live account is refused by the count trigger (BEFORE triggers run
  -- ahead of CHECK and unique constraints, so it fires first here):
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_authorization_accounts (authorization_id, priority, rule_kind, fixed_cents, routing_enc, account_enc,
       account_type, account_last4, routing_last4, account_key_hmac)
       values (%L, 3, 'fixed', 100, %L, %L, 'savings', '3333', '0105', %L)$q$, auth_e, enc, enc, h4),
    'ACH_ACCOUNT_LIMIT');
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_authorization_accounts (authorization_id, priority, rule_kind, fixed_cents, routing_enc, account_enc,
       account_type, account_last4, routing_last4, account_key_hmac)
       values (%L, 4, 'fixed', 100, %L, %L, 'savings', '3333', '0105', %L)$q$, auth_v, enc, enc, h4),
    'priority');  -- on auth_v (no accounts) so the CHECK, not the BEFORE count trigger, is what fires
  -- bank details immutable; deletes refused; status may change
  perform pg_temp.must_fail(format(
    $q$update public.ach_authorization_accounts set account_enc = 'encv1:zz:zz' where id = %L$q$, acct2), 'ACH_ACCOUNT_IMMUTABLE');
  perform pg_temp.must_fail(format($q$delete from public.ach_authorization_accounts where id = %L$q$, acct2),
    'ACH_ACCOUNT_IMMUTABLE');
  perform pg_temp.must_fail(format(
    $q$update public.ach_authorization_accounts set verification_status = 'verified' where id = %L$q$, acct2),
    'ach_acct_verified_shape');
  update public.ach_authorization_accounts set verification_status = 'verified', verification_method = 'prenote',
    verified_at = now(), verified_by = u_admin where id = acct2;
  -- archive frees the slot; the archived row is then frozen
  update public.ach_authorization_accounts set archived_at = now() where id = acct2;
  perform pg_temp.must_fail(format(
    $q$update public.ach_authorization_accounts set bank_name = 'x' where id = %L$q$, acct2), 'ACH_ACCOUNT_IMMUTABLE');
  insert into public.ach_authorization_accounts (authorization_id, priority, rule_kind, fixed_cents, routing_enc, account_enc,
     account_type, account_last4, routing_last4, account_key_hmac)
     values (auth_e, 1, 'fixed', 7500, enc, enc, 'savings', '4444', '0105', h4);

  -- 3. verifications -----------------------------------------------------
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_verifications (account_id, method, micro_amount_cents) values (%L, 'micro_entry', 100)$q$, acct1),
    'micro_amount_cents');
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_verifications (account_id, method) values (%L, 'micro_entry')$q$, acct1),
    'ach_ver_micro_amount');
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_verifications (account_id, method, micro_amount_cents) values (%L, 'prenote', 5)$q$, acct1),
    'ach_ver_micro_amount');
  insert into public.ach_verifications (account_id, method, micro_amount_cents) values (acct1, 'micro_entry', 99);
  insert into public.ach_verifications (account_id, method) values (acct1, 'prenote');

  -- 4. return notices ---------------------------------------------------
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_return_notices (authorization_id, notice_kind, code, received_on) values (%L, 'return', 'C01', '2026-10-05')$q$, auth_e),
    'ach_notice_code_matches_kind');
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_return_notices (authorization_id, notice_kind, code, received_on, trace_number) values (%L, 'return', 'R03', '2026-10-05', '123')$q$, auth_e),
    'trace_number');
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_return_notices (authorization_id, notice_kind, code, received_on, resolved_at) values (%L, 'noc', 'C01', '2026-10-05', now())$q$, auth_e),
    'ach_notice_resolved_shape');
  insert into public.ach_return_notices (authorization_id, notice_kind, code, received_on, trace_number)
    values (auth_e, 'return', 'R03', '2026-10-05', '123456789012345');
  insert into public.ach_return_notices (authorization_id, notice_kind, code, received_on, corrected_data_enc)
    values (auth_e, 'noc', 'C01', '2026-10-05', enc);

  -- 5. events append-only -----------------------------------------------
  insert into public.ach_authorization_events (authorization_id, payee_type, employee_id, event_kind, actor_id)
    values (auth_e, 'employee', emp, 'state_changed', u_admin);
  perform pg_temp.must_fail(format($q$update public.ach_authorization_events set event_kind = 'tampered' where authorization_id = %L$q$, auth_e),
    'ACH_EVENTS_APPEND_ONLY');
  perform pg_temp.must_fail(format($q$delete from public.ach_authorization_events where authorization_id = %L$q$, auth_e),
    'ACH_EVENTS_APPEND_ONLY');
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_authorization_events (payee_type, employee_id, event_kind) values ('employee', %L, 'Bad Kind!')$q$, emp),
    'event_kind');

  -- 6. documents ---------------------------------------------------------
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_authorization_documents (payee_type, employee_id, kind, storage_path, sha256, byte_size, mime_type)
       values ('employee', %L, 'signed_form', 'media/x.pdf', %L, 10, 'application/pdf')$q$, emp, h1),
    'storage_path');
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_authorization_documents (payee_type, employee_id, kind, storage_path, sha256, byte_size, mime_type)
       values ('employee', %L, 'signed_form', 'ach-docs/x.exe', %L, 10, 'application/x-msdownload')$q$, emp, h1),
    'mime_type');
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_authorization_documents (payee_type, employee_id, kind, storage_path, sha256, byte_size, mime_type)
       values ('employee', %L, 'signed_form', 'ach-docs/x.pdf', %L, 26214401, 'application/pdf')$q$, emp, h1),
    'byte_size');
  insert into public.ach_authorization_documents (authorization_id, payee_type, employee_id, kind, storage_path, sha256, byte_size, mime_type)
    values (auth_e, 'employee', emp, 'signed_form', 'ach-docs/e/1.pdf', h1, 1024, 'application/pdf') returning id into doc;
  -- same file twice for the same payee is refused
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_authorization_documents (payee_type, employee_id, kind, storage_path, sha256, byte_size, mime_type)
       values ('employee', %L, 'signed_form', 'ach-docs/e/2.pdf', %L, 1024, 'application/pdf')$q$, emp, h1),
    '23505');
  perform pg_temp.must_fail(format($q$update public.ach_authorization_documents set sha256 = %L where id = %L$q$, h2, doc),
    'ACH_DOC_IMMUTABLE');
  perform pg_temp.must_fail(format($q$delete from public.ach_authorization_documents where id = %L$q$, doc), 'ACH_RETENTION');
  update public.ach_authorization_documents set intake_status = 'accepted' where id = doc;

  -- 7. payee contacts -----------------------------------------------------
  perform pg_temp.must_fail(format(
    $q$insert into public.payee_contacts (payee_type, employee_id, contact_kind, value, on_file_since, source)
       values ('employee', %L, 'phone', '3604436988', '2026-01-01', 'existing_record')$q$, emp), 'payee_contact_phone_shape');
  perform pg_temp.must_fail(format(
    $q$insert into public.payee_contacts (payee_type, employee_id, contact_kind, value, on_file_since, source)
       values ('employee', %L, 'email', 'not-an-email', '2026-01-01', 'existing_record')$q$, emp), 'payee_contact_email_shape');
  perform pg_temp.must_fail(format(
    $q$insert into public.payee_contacts (payee_type, employee_id, contact_kind, value, on_file_since, source)
       values ('employee', %L, 'phone', '360-443-6988', current_date + 2, 'existing_record')$q$, emp), 'payee_contact_not_future');
  insert into public.payee_contacts (payee_type, employee_id, contact_kind, value, on_file_since, source)
    values ('employee', emp, 'phone', '360-443-6988', '2026-01-01', 'existing_record');
  perform pg_temp.must_fail(format(
    $q$update public.payee_contacts set on_file_since = '2020-01-01' where employee_id = %L$q$, emp), 'PAYEE_CONTACT_IMMUTABLE');
  perform pg_temp.must_fail(format(
    $q$update public.payee_contacts set value = '360-000-0000' where employee_id = %L$q$, emp), 'PAYEE_CONTACT_IMMUTABLE');
  perform pg_temp.must_fail(format($q$delete from public.payee_contacts where employee_id = %L$q$, emp), 'PAYEE_CONTACT_IMMUTABLE');
  update public.payee_contacts set retired_at = now() where employee_id = emp;
  insert into public.payee_contacts (payee_type, employee_id, contact_kind, value, on_file_since, source)
    values ('employee', emp, 'phone', '360-443-6988', current_date, 'in_person');

  -- 8. vendor flags --------------------------------------------------------
  perform pg_temp.must_fail(format($q$update public.vendors set ach_opted_out = true where id = %L$q$, ven), 'vendors_ach_opt_out_shape');
  perform pg_temp.must_fail(format(
    $q$update public.vendors set ach_opted_out = true, ach_opted_out_reason = 'pays by check', ach_opted_out_at = now(), ach_needs_bank_info = true where id = %L$q$, ven),
    'vendors_ach_flags_exclusive');
  update public.vendors set ach_needs_bank_info = true where id = ven;
  update public.vendors set ach_needs_bank_info = false, ach_opted_out = true, ach_opted_out_reason = 'pays by check',
    ach_opted_out_at = now(), ach_opted_out_by = u_admin where id = ven;

  -- 9. vendor_bank_details now admits archived ----------------------------
  insert into public.vendor_bank_details (vendor_id, status) values (ven, 'archived');
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'deleted' where vendor_id = %L$q$, ven),
    'vendor_bank_details_status_check');

  -- 10. retention: delete refused while in effect; restrict blocks payee delete
  perform pg_temp.must_fail(format($q$delete from public.ach_authorizations where id = %L$q$, auth_e), 'ACH_RETENTION');
  perform pg_temp.must_fail(format($q$delete from public.employees where id = %L$q$, emp), '23503');
  assert public.ach_retention_may_dispose('2020-01-01', '2020-06-01', false, '2026-06-01') = false, 'exactly 6y after end: keep';
  assert public.ach_retention_may_dispose('2020-01-01', '2020-06-01', false, '2026-06-02') = true,  'day after 6y: may dispose';
  assert public.ach_retention_may_dispose('2020-01-01', '2020-06-01', true,  '2040-01-01') = false, 'legal hold: keep';
  assert public.ach_retention_may_dispose('2020-01-01', null,         false, '2040-01-01') = false, 'not ended: keep';
  -- signed 6y can drive: ended BEFORE signing is refused by the check, so use
  -- the boundary where both dates coincide
  assert public.ach_retention_may_dispose('2020-06-01', '2020-06-01', false, '2026-06-01') = false, 'coinciding: keep on the day';
  -- Feb 29: Postgres interval clamps to Feb 28, same as addYears() in the core
  assert (date '2024-02-29' + interval '6 years')::date = date '2030-02-28', 'Feb 29 clamps to Feb 28';

  -- terminal states (revoking needs the date it ended: retention runs from it)
  perform pg_temp.must_fail(format(
    $q$update public.ach_authorizations set state = 'revoked', ended_reason = 'employee left' where id = %L$q$, auth_e),
    'ach_auth_ended_has_date');
  update public.ach_authorizations set state = 'revoked', ended_on = '2026-10-09', ended_reason = 'employee left' where id = auth_e;
  perform pg_temp.must_fail(format($q$update public.ach_authorizations set state = 'active' where id = %L$q$, auth_e), 'ACH_AUTH_TRANSITION');
  update public.ach_authorizations set state = 'archived' where id = auth_e;
  perform pg_temp.must_fail(format($q$update public.ach_authorizations set ended_on = '2026-10-10' where id = %L$q$, auth_e), 'ACH_AUTH_ARCHIVED');
  update public.ach_authorizations set legal_hold = true, legal_hold_reason = 'probe' where id = auth_e;
  -- a new open authorization is allowed once the old one ended
  insert into public.ach_authorizations (payee_type, employee_id) values ('employee', emp);
  -- ended before signed is refused
  perform pg_temp.must_fail(format(
    $q$insert into public.ach_authorizations (payee_type, employee_id, state, signed_on, signature_method, ended_on) values ('employee', %L, 'revoked', '2026-10-02', 'esign', '2026-10-01')$q$, emp2),
    'ach_auth_end_after_sign');

  -- 11. RLS as each role --------------------------------------------------
  select count(*) into n from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in
    ('ach_authorizations','ach_authorization_accounts','ach_authorization_documents','ach_authorization_events',
     'ach_verifications','ach_return_notices','payee_contacts') and c.relrowsecurity;
  assert n = 7, format('all 7 tables must have RLS on, found %s', n);
  select count(*) into n from information_schema.role_table_grants where grantee = 'anon' and table_name in
    ('ach_authorizations','ach_authorization_accounts','ach_authorization_documents','ach_authorization_events',
     'ach_verifications','ach_return_notices','payee_contacts');
  assert n = 0, format('anon must hold no grants, holds %s', n);
  select count(*) into n from information_schema.role_table_grants where grantee = 'authenticated'
     and privilege_type = 'DELETE' and table_name in
    ('ach_authorizations','ach_authorization_accounts','ach_authorization_documents','ach_authorization_events',
     'ach_verifications','ach_return_notices','payee_contacts');
  assert n = 0, format('authenticated must not hold DELETE (retention disposal is server-only), holds %s', n);
  select count(*) into n from information_schema.role_table_grants where grantee = 'authenticated'
     and privilege_type in ('SELECT','INSERT','UPDATE') and table_name in
    ('ach_authorizations','ach_authorization_accounts','ach_authorization_documents','ach_authorization_events',
     'ach_verifications','ach_return_notices','payee_contacts');
  assert n = 21, format('authenticated must hold exactly select/insert/update on the 7 tables (21), holds %s', n);
  select count(*) into n from information_schema.role_table_grants where grantee = 'service_role'
     and privilege_type in ('SELECT','INSERT','UPDATE','DELETE') and table_name in
    ('ach_authorizations','ach_authorization_accounts','ach_authorization_documents','ach_authorization_events',
     'ach_verifications','ach_return_notices','payee_contacts');
  assert n = 28, format('service_role must hold all four verbs on the 7 tables (28), holds %s', n);
  select count(*) into n from storage.buckets where id = 'ach-docs' and public = false;
  assert n = 1, 'ach-docs bucket must exist and be private';

  raise notice 'ACH 0258 SCENARIO CHECKS PASSED (owner context)';
end $$;

-- RLS probes need a non-superuser role: authenticated + jwt claims. Supabase
-- grants `authenticated` all privileges on public tables by default (RLS is
-- what narrows them); the CI bootstrap does not, so mirror it here. Other
-- storage.objects policies read e.g. media_assets, which is why the narrow
-- grant list first tried here failed with "permission denied for media_assets".
-- The seven 0258 tables are EXCLUDED: their grants come from the migration
-- itself and are what is under test.
grant usage on schema public, storage to authenticated;
do $g$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
            and tablename not in ('ach_authorizations','ach_authorization_accounts','ach_authorization_documents',
                                  'ach_authorization_events','ach_verifications','ach_return_notices','payee_contacts')
  loop
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $g$;
grant select, insert on storage.objects, storage.buckets to authenticated;

do $$
declare
  u_admin uuid; u_mgr uuid; u_staff uuid; emp uuid; n int;
begin
  select id into u_admin from public.staff_profiles where email = 'a@x.test';
  select id into u_mgr   from public.staff_profiles where email = 'm@x.test';
  select id into u_staff from public.staff_profiles where email = 's@x.test';
  select id into emp from public.employees where full_name = 'Probe Employee';

  -- staff: sees nothing, can insert nothing
  perform set_config('request.jwt.claim.sub', u_staff::text, true);
  set local role authenticated;
  select count(*) into n from public.ach_authorizations;
  assert n = 0, 'staff must see no authorizations';
  begin
    insert into public.ach_authorization_documents (payee_type, employee_id, kind, storage_path, sha256, byte_size, mime_type, uploaded_by)
      values ('employee', emp, 'signed_form', 'ach-docs/s/1.pdf', repeat('e', 64), 10, 'application/pdf', u_staff);
    raise exception 'staff document insert was ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('ach-docs', 's/1.pdf');
    raise exception 'staff storage upload was ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- manager: may DROP a document (received, unlinked, own uid), never read it
  perform set_config('request.jwt.claim.sub', u_mgr::text, true);
  set local role authenticated;
  insert into public.ach_authorization_documents (payee_type, employee_id, kind, storage_path, sha256, byte_size, mime_type, uploaded_by)
    values ('employee', emp, 'signed_form', 'ach-docs/m/1.pdf', repeat('f', 64), 10, 'application/pdf', u_mgr);
  insert into public.ach_authorization_events (payee_type, employee_id, event_kind, actor_id)
    values ('employee', emp, 'document_dropped', u_mgr);
  insert into storage.objects (bucket_id, name) values ('ach-docs', 'm/1.pdf');
  select count(*) into n from public.ach_authorization_documents;
  assert n = 0, 'manager must not read documents back';
  select count(*) into n from storage.objects where bucket_id = 'ach-docs';
  assert n = 0, 'manager must not read stored files back';
  select count(*) into n from public.ach_authorizations;
  assert n = 0, 'manager must not see authorizations';
  begin
    insert into public.ach_authorization_documents (payee_type, employee_id, kind, storage_path, sha256, byte_size, mime_type, uploaded_by, intake_status)
      values ('employee', emp, 'signed_form', 'ach-docs/m/2.pdf', repeat('9', 64), 10, 'application/pdf', u_mgr, 'accepted');
    raise exception 'manager inserting an ACCEPTED document was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.ach_authorization_documents (payee_type, employee_id, kind, storage_path, sha256, byte_size, mime_type, uploaded_by)
      values ('employee', emp, 'signed_form', 'ach-docs/m/3.pdf', repeat('8', 64), 10, 'application/pdf', u_admin);
    raise exception 'manager uploading as someone else was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.ach_authorization_events (payee_type, employee_id, event_kind, actor_id)
      values ('employee', emp, 'state_changed', u_mgr);
    raise exception 'manager writing a non-drop event was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.payee_contacts (payee_type, employee_id, contact_kind, value, on_file_since, source)
      values ('employee', emp, 'phone', '360-111-2222', '2026-01-01', 'in_person');
    raise exception 'manager adding a payee contact was allowed';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- admin: reads everything, including what the manager dropped
  perform set_config('request.jwt.claim.sub', u_admin::text, true);
  set local role authenticated;
  select count(*) into n from public.ach_authorization_documents where storage_path = 'ach-docs/m/1.pdf';
  assert n = 1, 'admin must read the dropped document';
  select count(*) into n from storage.objects where bucket_id = 'ach-docs';
  assert n = 1, 'admin must read the dropped file';
  select count(*) into n from public.ach_authorizations;
  assert n >= 3, format('admin must see authorizations, saw %s', n);
  reset role;

  raise notice 'ACH 0258 RLS CHECKS PASSED (staff / manager / admin)';
  raise notice 'ACH 0258 CHECK PASSED';
end $$;

rollback;
