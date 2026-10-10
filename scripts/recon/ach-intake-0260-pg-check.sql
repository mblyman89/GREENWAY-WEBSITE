-- scripts/recon/ach-intake-0260-pg-check.sql  (R39 S5 - migration 0260)
--
-- Scenario check for 0260_ach_document_intake.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   PGPASSWORD=postgres psql -h localhost -U postgres -d r39 \
--     -v ON_ERROR_STOP=1 -f scripts/recon/ach-intake-0260-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid call
-- that MUST be accepted. "ACH 0260 CHECK PASSED" then ROLLBACK = all clear.
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
  ven    uuid;
  doc1   uuid;
  doc2   uuid;
  doc3   uuid;
  docv   uuid;
  docr   uuid;
  doci   uuid;
  auth1  uuid;
  auth2  uuid;
  n      int;
  s      text;
  enc    text := 'encv1:aaaa:bbbb';
  acct   jsonb;
  two    jsonb;
  bad3   jsonb;
begin
  insert into auth.users (id, email) values (u_m, 'm0260@x.test');
  insert into public.staff_profiles (id, email, role, active) values (u_m, 'm0260@x.test', 'owner', true)
    on conflict (id) do update set role = 'owner', active = true;
  insert into public.employees (full_name) values ('Intake Probe') returning id into emp;
  insert into public.employees (full_name) values ('Intake Probe Two') returning id into emp2;
  insert into public.vendors (display_name, slug) values ('Intake Probe Vendor', 'intake-probe-0260') returning id into ven;

  insert into public.ach_authorization_documents (payee_type, employee_id, kind, storage_path, sha256, byte_size, mime_type, uploaded_by)
    values ('employee', emp, 'signed_form', 'ach-docs/employee/p/1.pdf', repeat('1', 64), 100, 'application/pdf', u_m) returning id into doc1;
  insert into public.ach_authorization_documents (payee_type, employee_id, kind, storage_path, sha256, byte_size, mime_type, uploaded_by)
    values ('employee', emp, 'signed_form', 'ach-docs/employee/p/2.pdf', repeat('2', 64), 100, 'application/pdf', u_m) returning id into doc2;
  insert into public.ach_authorization_documents (payee_type, employee_id, kind, storage_path, sha256, byte_size, mime_type, uploaded_by)
    values ('employee', emp2, 'signed_form', 'ach-docs/employee/p/3.pdf', repeat('3', 64), 100, 'application/pdf', u_m) returning id into doc3;
  insert into public.ach_authorization_documents (payee_type, vendor_id, kind, storage_path, sha256, byte_size, mime_type, uploaded_by)
    values ('vendor', ven, 'signed_form', 'ach-docs/vendor/p/4.pdf', repeat('4', 64), 100, 'application/pdf', u_m) returning id into docv;
  insert into public.ach_authorization_documents (payee_type, employee_id, kind, storage_path, sha256, byte_size, mime_type, uploaded_by)
    values ('employee', emp2, 'voided_check', 'ach-docs/employee/p/5.pdf', repeat('5', 64), 100, 'application/pdf', u_m) returning id into docr;
  insert into public.ach_authorization_documents (payee_type, employee_id, kind, storage_path, sha256, byte_size, mime_type, uploaded_by)
    values ('employee', emp2, 'voided_check', 'ach-docs/employee/p/6.pdf', repeat('6', 64), 100, 'application/pdf', u_m) returning id into doci;

  acct := jsonb_build_object('priority', 1, 'rule_kind', 'remainder', 'bank_name', 'B', 'routing_enc', enc, 'account_enc', enc,
                             'account_type', 'checking', 'account_last4', '5678', 'routing_last4', '0021', 'account_key_hmac', repeat('a', 64));
  two := jsonb_build_array(
    jsonb_build_object('priority', 1, 'rule_kind', 'fixed', 'fixed_cents', 20000, 'bank_name', 'A', 'routing_enc', enc, 'account_enc', enc,
                       'account_type', 'checking', 'account_last4', '5678', 'routing_last4', '0021', 'account_key_hmac', repeat('a', 64)),
    jsonb_build_object('priority', 2, 'rule_kind', 'remainder', 'bank_name', 'B', 'routing_enc', enc, 'account_enc', enc,
                       'account_type', 'savings', 'account_last4', '0000', 'routing_last4', '0015', 'account_key_hmac', repeat('b', 64)));
  -- Third account breaks a 0258 CHECK (plaintext routing): the WHOLE accept must vanish.
  bad3 := two || jsonb_build_array(
    jsonb_build_object('priority', 3, 'rule_kind', 'fixed', 'fixed_cents', 100, 'routing_enc', '021000021', 'account_enc', enc,
                       'account_type', 'checking', 'account_last4', '1111', 'routing_last4', '0021', 'account_key_hmac', repeat('c', 64)));

  -- argument checks ------------------------------------------------------
  perform pg_temp.must_fail(format($q$select public.ach_intake_accept_employee(%L, %L, current_date, 'P', 'looked_fine', false, %L)$q$, doc1, u_m, jsonb_build_array(acct)), 'ACH_INTAKE_BASIS');
  perform pg_temp.must_fail(format($q$select public.ach_intake_accept_employee(%L, null, current_date, 'P', 'matches_form', false, %L)$q$, doc1, jsonb_build_array(acct)), 'ACH_INTAKE_ACTOR');
  perform pg_temp.must_fail(format($q$select public.ach_intake_accept_employee(%L, %L, current_date + 1, 'P', 'matches_form', false, %L)$q$, doc1, u_m, jsonb_build_array(acct)), 'ACH_INTAKE_SIGNED_ON');
  perform pg_temp.must_fail(format($q$select public.ach_intake_accept_employee(%L, %L, current_date, 'P', 'matches_form', false, '[]')$q$, doc1, u_m), 'ACH_INTAKE_ACCOUNTS');
  perform pg_temp.must_fail(format($q$select public.ach_intake_accept_employee(%L, %L, current_date, 'P', 'matches_form', false, %L)$q$, doc1, u_m,
    jsonb_build_array(acct, acct || '{"priority": 2}', acct || '{"priority": 3}', acct || '{"priority": 4}')), 'ACH_INTAKE_ACCOUNTS');
  perform pg_temp.must_fail(format($q$select public.ach_intake_accept_employee(%L, %L, current_date, 'P', 'matches_form', false, %L)$q$, doc1, u_m,
    jsonb_build_array(acct || '{"priority": 2}')), 'ACH_INTAKE_ACCOUNTS');
  perform pg_temp.must_fail(format($q$select public.ach_intake_accept_employee(%L, %L, current_date, 'P', 'matches_form', false, %L)$q$, docv, u_m, jsonb_build_array(acct)), 'ACH_INTAKE_PAYEE');
  perform pg_temp.must_fail(format($q$select public.ach_intake_accept_employee(%L, %L, current_date, 'P', 'matches_form', false, %L)$q$, docr, u_m, jsonb_build_array(acct)), 'ACH_INTAKE_KIND');
  perform pg_temp.must_fail(format($q$select public.ach_intake_accept_employee(%L, %L, current_date, 'P', 'matches_form', false, %L)$q$, gen_random_uuid(), u_m, jsonb_build_array(acct)), 'ACH_INTAKE_NOT_FOUND');

  -- all or nothing -------------------------------------------------------
  perform pg_temp.must_fail(format($q$select public.ach_intake_accept_employee(%L, %L, current_date, 'P', 'matches_form', false, %L)$q$, doc1, u_m, bad3), 'routing_enc');
  select count(*) into n from public.ach_authorizations where employee_id = emp;
  assert n = 0, format('a failed accept must leave NO authorization, found %s', n);
  select count(*) into n from public.ach_authorization_events where employee_id = emp;
  assert n = 0, format('a failed accept must leave NO events, found %s', n);
  select intake_status into s from public.ach_authorization_documents where id = doc1;
  assert s = 'received', format('a failed accept must leave the document received, found %s', s);

  -- happy path -----------------------------------------------------------
  auth1 := public.ach_intake_accept_employee(doc1, u_m, current_date - 3, ' Intake Probe ', 'matches_form', false, two);
  select count(*) into n from public.ach_authorizations
   where id = auth1 and state = 'signed' and signature_method = 'wet_ink_upload' and signed_on = current_date - 3
     and payee_name = 'Intake Probe' and created_by = u_m;
  assert n = 1, 'accept must create a signed wet-ink authorization';
  select count(*) into n from public.ach_authorization_accounts
   where authorization_id = auth1 and verification_status = 'unverified' and archived_at is null;
  assert n = 2, format('accept must create 2 unverified accounts, found %s', n);
  select count(*) into n from public.ach_authorization_documents
   where id = doc1 and intake_status = 'accepted' and authorization_id = auth1;
  assert n = 1, 'document must be accepted and linked';
  select count(*) into n from public.ach_authorization_events
   where authorization_id = auth1 and event_kind in ('document_rekeyed', 'document_accepted');
  assert n = 2, format('accept must log rekeyed + accepted, found %s', n);
  select count(*) into n from public.ach_authorization_events
   where authorization_id = auth1 and event_kind = 'document_accepted' and detail->'account_last4' = '["5678","0000"]'::jsonb;
  assert n = 1, 'accepted event records last-4 only';
  select count(*) into n from public.ach_authorization_events
   where authorization_id = auth1 and detail::text like '%encv1%';
  assert n = 0, 'events must never contain ciphertext';

  -- the same document cannot be accepted twice
  perform pg_temp.must_fail(format($q$select public.ach_intake_accept_employee(%L, %L, current_date, 'P', 'matches_form', true, %L)$q$, doc1, u_m, two), 'ACH_INTAKE_STATE');

  -- one open authorization: refused without replace, archived with replace
  perform pg_temp.must_fail(format($q$select public.ach_intake_accept_employee(%L, %L, current_date, 'P', 'two_blind_entries', false, %L)$q$, doc2, u_m, jsonb_build_array(acct)), 'ACH_INTAKE_OPEN_EXISTS');
  auth2 := public.ach_intake_accept_employee(doc2, u_m, current_date, 'Intake Probe', 'two_blind_entries', true, jsonb_build_array(acct));
  select count(*) into n from public.ach_authorizations where id = auth1 and state = 'archived' and ended_on = current_date and ended_reason like 'Superseded%';
  assert n = 1, 'replaced authorization must be archived with a reason';
  select count(*) into n from public.ach_authorization_accounts where authorization_id = auth1 and archived_at is null;
  assert n = 0, 'replaced authorization accounts must be archived';
  select count(*) into n from public.ach_authorization_events where authorization_id = auth1 and event_kind = 'authorization_superseded';
  assert n = 1, 'supersede must be logged';
  select count(*) into n from public.ach_authorizations where employee_id = emp and state not in ('revoked', 'archived');
  assert n = 1, 'still exactly one open authorization';

  -- finish: vendor accept, reject -----------------------------------------
  perform pg_temp.must_fail(format($q$select public.ach_intake_finish(%L, %L, 'maybe', 'x', '{}')$q$, docv, u_m), 'ACH_INTAKE_OUTCOME');
  perform pg_temp.must_fail(format($q$select public.ach_intake_finish(%L, null, 'rejected', 'blurry scan, ask again', '{}')$q$, docr, ''), 'ACH_INTAKE_ACTOR');
  perform pg_temp.must_fail(format($q$select public.ach_intake_finish(%L, %L, 'rejected', 'short', '{}')$q$, docr, u_m), 'ACH_INTAKE_REASON');
  perform pg_temp.must_fail(format($q$select public.ach_intake_finish(%L, %L, 'accepted', '', '{"basis":"two_blind_entries"}')$q$, doc3, u_m), 'ACH_INTAKE_PAYEE');
  perform pg_temp.must_fail(format($q$select public.ach_intake_finish(%L, %L, 'accepted', '', '{}')$q$, docv, u_m), 'ACH_INTAKE_BASIS');
  perform public.ach_intake_finish(docv, u_m, 'accepted', 'Saved to the vault on hold.', '{"basis":"matches_form","account_last4":"5678"}');
  select count(*) into n from public.ach_authorization_documents where id = docv and intake_status = 'accepted' and authorization_id is null;
  assert n = 1, 'vendor document accepted (no authorization row: vendors use the vault)';
  select count(*) into n from public.ach_authorization_events where vendor_id = ven and event_kind in ('document_rekeyed', 'document_accepted');
  assert n = 2, 'vendor accept logged';
  perform pg_temp.must_fail(format($q$select public.ach_intake_finish(%L, %L, 'rejected', 'changed my mind later', '{}')$q$, docv, u_m), 'ACH_INTAKE_STATE');

  perform public.ach_intake_finish(docr, u_m, 'rejected', 'Wrong person on the check.', '{}');
  select count(*) into n from public.ach_authorization_documents where id = docr and intake_status = 'rejected' and intake_note = 'Wrong person on the check.';
  assert n = 1, 'rejected with its reason';
  select count(*) into n from public.ach_authorization_events where employee_id = emp2 and event_kind = 'document_rejected';
  assert n = 1, 'reject logged';

  -- an archived document cannot be decided
  update public.ach_authorization_documents set archived_at = now() where id = doci;
  perform pg_temp.must_fail(format($q$select public.ach_intake_finish(%L, %L, 'rejected', 'archived already, no', '{}')$q$, doci, u_m), 'ACH_INTAKE_STATE');

  -- an archived signed form cannot create an authorization either
  insert into public.ach_authorization_documents (payee_type, employee_id, kind, storage_path, sha256, byte_size, mime_type, uploaded_by, archived_at)
    values ('employee', emp2, 'signed_form', 'ach-docs/employee/p/7.pdf', repeat('7', 64), 100, 'application/pdf', u_m, now()) returning id into doci;
  perform pg_temp.must_fail(format($q$select public.ach_intake_accept_employee(%L, %L, current_date, 'P', 'matches_form', false, %L)$q$, doci, u_m, jsonb_build_array(acct)), 'ACH_INTAKE_STATE');

  -- only service_role may call them ----------------------------------------
  select count(*) into n from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name in ('ach_intake_accept_employee', 'ach_intake_finish')
     and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type = 'EXECUTE';
  assert n = 0, format('anon/authenticated must not execute intake functions, found %s grants', n);
  select count(*) into n from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name in ('ach_intake_accept_employee', 'ach_intake_finish')
     and grantee = 'service_role' and privilege_type = 'EXECUTE';
  assert n = 2, format('service_role must execute both intake functions, found %s', n);
  select count(*) into n from pg_proc where proname in ('ach_intake_accept_employee', 'ach_intake_finish') and prosecdef;
  assert n = 0, 'intake functions must NOT be security definer';

  raise notice 'ACH 0260 CHECK PASSED';
end $$;

rollback;
