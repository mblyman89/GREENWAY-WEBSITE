-- scripts/recon/vendor-esign-0262-pg-check.sql  (R39 S7 - migration 0262)
--
-- Scenario check for 0262_vendor_ach_esign.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   PGPASSWORD=postgres psql -h localhost -U postgres -d r39 \
--     -v ON_ERROR_STOP=1 -f scripts/recon/vendor-esign-0262-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid call
-- that MUST be accepted. "VENDOR 0262 CHECK PASSED" then ROLLBACK = all clear.
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

-- A consented invite ready to sign (helper; returns its id).
create or replace function pg_temp.ready_invite(v uuid, by_ uuid, tok text, proof_sha text) returns uuid
language plpgsql as $$
declare i uuid;
begin
  insert into public.vendor_esign_invites (vendor_id, token_hash, invited_by, expires_at, email_enc, email_masked, recipient_name)
    values (v, tok, by_, now() + interval '14 days', 'encv1:e:e', 'ap***@v.test', 'Pat Vendor') returning id into i;
  update public.vendor_esign_invites set state = 'code_sent', otp_digest = repeat('d', 64), otp_sent_at = now(), otp_sends = 1 where id = i;
  update public.vendor_esign_invites set state = 'consented', code_verified_at = now(), consented_at = now(), browser_digest = repeat('b', 64),
         disclosure_version = 'GW-VESIGN-1', disclosure_sha256 = repeat('c', 64),
         proof_storage_path = format('ach-docs/vendor/%s/proof-%s.pdf', v, left(proof_sha, 8)), proof_sha256 = proof_sha, proof_byte_size = 5000,
         proof_mime = 'application/pdf', proof_kind = 'voided_check', proof_filename = 'voided.pdf'
   where id = i;
  return i;
end $$;

do $$
declare
  u_m    uuid := gen_random_uuid();
  u_s    uuid := gen_random_uuid();
  ven    uuid;
  ven2   uuid;
  i1     uuid;
  i2     uuid;
  i3     uuid;
  i4     uuid;
  auth1  uuid;
  auth2  uuid;
  n      int;
  r      record;
  enc    text := 'encv1:aaaa:bbbb';
  form   jsonb := jsonb_build_object('legal_name', 'Probe Farms LLC', 'request_type', 'new', 'ar_contact', 'Pat Vendor, AR');
  bank   jsonb := jsonb_build_object('bank_name', 'Kitsap Test Bank', 'routing_enc', 'encv1:r1:x', 'account_enc', 'encv1:a1:x', 'account_type', 'checking',
                                     'account_last4', '4321', 'routing_last4', '0021', 'account_key_hmac', repeat('a', 64));
  bank2  jsonb;
  rec1   jsonb;
  cert1  jsonb;
  rec2   jsonb;
  cert2  jsonb;
  acc1   jsonb;
  call   text;
  pre    text;
begin
  insert into auth.users (id, email) values (u_m, 'm0262@x.test'), (u_s, 's0262@x.test');
  insert into public.staff_profiles (id, email, role, active) values (u_m, 'm0262@x.test', 'owner', true), (u_s, 's0262@x.test', 'admin', true)
    on conflict (id) do update set role = excluded.role, active = true;
  insert into public.vendors (display_name, slug) values ('Probe Farms', 'probe-farms-0262') returning id into ven;
  insert into public.vendors (display_name, slug) values ('Probe Two', 'probe-two-0262') returning id into ven2;
  update public.vendors set ach_needs_bank_info = true where id = ven;
  pre := format('ach-docs/vendor/%s/', ven);
  rec1  := jsonb_build_object('storage_path', pre || 'r1.pdf', 'sha256', repeat('1', 64), 'byte_size', 1000);
  cert1 := jsonb_build_object('storage_path', pre || 'c1.pdf', 'sha256', repeat('2', 64), 'byte_size', 900);
  rec2  := jsonb_build_object('storage_path', pre || 'r2.pdf', 'sha256', repeat('3', 64), 'byte_size', 1000);
  cert2 := jsonb_build_object('storage_path', pre || 'c2.pdf', 'sha256', repeat('4', 64), 'byte_size', 900);
  acc1  := jsonb_build_object('storage_path', pre || 'a1.pdf', 'sha256', repeat('7', 64), 'byte_size', 800);

  -- table CHECKs ------------------------------------------------------------
  call := $q$insert into public.vendor_esign_invites (vendor_id, token_hash, invited_by, expires_at, email_enc, email_masked, recipient_name%s) values (%L, %s, %L, %s, %s, 'ap***@v.test', 'Pat Vendor'%s)$q$;
  perform pg_temp.must_fail(format(call, '', ven, quote_literal('ABC'), u_m, $t$now() + interval '1 day'$t$, quote_literal(enc), ''), 'vendor_esign_invites_token_hash_check');
  perform pg_temp.must_fail(format(call, '', ven, quote_literal(repeat('e', 64)), u_m, $t$now() + interval '1 day'$t$, quote_literal('plain@x.test'), ''), 'vendor_esign_invites_email_enc_check');
  perform pg_temp.must_fail(format(call, '', ven, quote_literal(repeat('e', 64)), u_m, $t$now() + interval '31 days'$t$, quote_literal(enc), ''), 'vesign_expiry_window');
  perform pg_temp.must_fail(format(call, '', ven, quote_literal(repeat('e', 64)), u_m, $t$now() - interval '1 second'$t$, quote_literal(enc), ''), 'vesign_expiry_window');
  perform pg_temp.must_fail(format(call, ', state', ven, quote_literal(repeat('e', 64)), u_m, $t$now() + interval '1 day'$t$, quote_literal(enc), ', ''code_sent'''), 'vesign_code_sent_shape');
  perform pg_temp.must_fail(format(call, ', state, cancelled_at, cancel_reason', ven, quote_literal(repeat('e', 64)), u_m, $t$now() + interval '1 day'$t$, quote_literal(enc), ', ''cancelled'', now(), ''no'''), 'vesign_cancelled_shape');
  perform pg_temp.must_fail(format(call, ', otp_sends', ven, quote_literal(repeat('e', 64)), u_m, $t$now() + interval '1 day'$t$, quote_literal(enc), ', 6'), 'vendor_esign_invites_otp_sends_check');

  insert into public.vendor_esign_invites (vendor_id, token_hash, invited_by, expires_at, email_enc, email_masked, recipient_name)
    values (ven, repeat('e', 64), u_m, now() + interval '14 days', enc, 'ap***@v.test', 'Pat Vendor') returning id into i1;
  -- one open invite per vendor; the token is unique everywhere
  perform pg_temp.must_fail(format(call, '', ven, quote_literal(repeat('f', 64)), u_m, $t$now() + interval '1 day'$t$, quote_literal(enc), ''), 'vendor_esign_one_open_per_vendor');
  perform pg_temp.must_fail(format(call, '', ven2, quote_literal(repeat('e', 64)), u_m, $t$now() + interval '1 day'$t$, quote_literal(enc), ''), 'vendor_esign_invites_token_hash_key');

  -- guard: skipping, immutables, counters ----------------------------------
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set state = 'consented' where id = %L$q$, i1), 'VENDOR_ESIGN_TRANSITION');
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set token_hash = %L where id = %L$q$, repeat('9', 64), i1), 'VENDOR_ESIGN_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set email_enc = 'encv1:other:x' where id = %L$q$, i1), 'VENDOR_ESIGN_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set expires_at = expires_at + interval '1 day' where id = %L$q$, i1), 'VENDOR_ESIGN_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set recipient_name = 'Someone Else' where id = %L$q$, i1), 'VENDOR_ESIGN_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set invited_by = %L where id = %L$q$, u_s, i1), 'VENDOR_ESIGN_IMMUTABLE');
  update public.vendor_esign_invites set first_opened_at = now() where id = i1;
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set first_opened_at = now() + interval '1 hour' where id = %L$q$, i1), 'VENDOR_ESIGN_IMMUTABLE');
  update public.vendor_esign_invites set state = 'code_sent', otp_digest = repeat('d', 64), otp_sent_at = now(), otp_sends = 1 where id = i1;
  update public.vendor_esign_invites set otp_attempts = 2 where id = i1;
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set otp_attempts = 0 where id = %L$q$, i1), 'VENDOR_ESIGN_COUNTERS');
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set otp_sends = 0 where id = %L$q$, i1), 'VENDOR_ESIGN_COUNTERS');
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set otp_attempts = 6 where id = %L$q$, i1), 'vendor_esign_invites_otp_attempts_check');
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set state = 'signed' where id = %L$q$, i1), 'VENDOR_ESIGN_TRANSITION');
  -- consented without the browser binding or disclosure evidence is refused
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set state = 'consented', code_verified_at = now(), consented_at = now(), disclosure_version = 'v', disclosure_sha256 = %L where id = %L$q$, repeat('c', 64), i1), 'vesign_consented_shape');
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set state = 'consented', code_verified_at = now(), consented_at = now(), browser_digest = %L where id = %L$q$, repeat('b', 64), i1), 'vesign_consented_shape');
  update public.vendor_esign_invites set state = 'consented', code_verified_at = now(), consented_at = now(), browser_digest = repeat('b', 64),
         disclosure_version = 'GW-VESIGN-1', disclosure_sha256 = repeat('c', 64) where id = i1;
  -- proof shape: all or nothing; proof must be in a vendor folder
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set proof_storage_path = %L where id = %L$q$, pre || 'p.pdf', i1), 'vesign_proof_shape');
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set proof_storage_path = 'ach-docs/employee/x/p.pdf', proof_sha256 = %L, proof_byte_size = 1, proof_mime = 'application/pdf', proof_kind = 'voided_check' where id = %L$q$, repeat('5', 64), i1), 'vendor_esign_invites_proof_storage_path_check');
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set proof_storage_path = %L, proof_sha256 = %L, proof_byte_size = 1, proof_mime = 'application/pdf', proof_kind = 'signed_form' where id = %L$q$, pre || 'p.pdf', repeat('5', 64), i1), 'vendor_esign_invites_proof_kind_check');

  -- function refusals (nothing written) ------------------------------------
  call := $q$select public.vendor_esign_complete(%L, %s, '203.0.113.9', 'UA', %L, %L, %L, %L, %L, %L)$q$;
  perform pg_temp.must_fail(format(call, i1, 'now()', 'Pat Vendor', 'Owner', form, bank, rec1, cert1), 'VENDOR_ESIGN_PROOF');
  update public.vendor_esign_invites set proof_storage_path = pre || 'proof1.pdf', proof_sha256 = repeat('5', 64), proof_byte_size = 5000,
         proof_mime = 'image/jpeg', proof_kind = 'voided_check', proof_filename = 'check.jpg' where id = i1;
  perform pg_temp.must_fail(format(call, i1, $t$now() + interval '1 day'$t$, 'Pat Vendor', 'Owner', form, bank, rec1, cert1), 'VENDOR_ESIGN_TIME');
  perform pg_temp.must_fail(format(call, gen_random_uuid(), 'now()', 'Pat Vendor', 'Owner', form, bank, rec1, cert1), 'VENDOR_ESIGN_NOT_FOUND');
  perform pg_temp.must_fail(format(call, i1, 'now()', 'Pat', 'Owner', form, bank, rec1, cert1), 'VENDOR_ESIGN_NAME');
  perform pg_temp.must_fail(format(call, i1, 'now()', 'Pat Vendor', ' ', form, bank, rec1, cert1), 'VENDOR_ESIGN_TITLE');
  perform pg_temp.must_fail(format(call, i1, 'now()', 'Pat Vendor', 'Owner', form - 'legal_name', bank, rec1, cert1), 'VENDOR_ESIGN_FORM');
  perform pg_temp.must_fail(format(call, i1, 'now()', 'Pat Vendor', 'Owner', jsonb_set(form, '{request_type}', '"cancel"'), bank, rec1, cert1), 'VENDOR_ESIGN_FORM');
  perform pg_temp.must_fail(format(call, i1, 'now()', 'Pat Vendor', 'Owner', form, jsonb_set(bank, '{routing_enc}', '"021000021"'), rec1, cert1), 'VENDOR_ESIGN_BANK');
  perform pg_temp.must_fail(format(call, i1, 'now()', 'Pat Vendor', 'Owner', form, jsonb_set(bank, '{account_enc}', '"12345678"'), rec1, cert1), 'VENDOR_ESIGN_BANK');
  perform pg_temp.must_fail(format(call, i1, 'now()', 'Pat Vendor', 'Owner', form, jsonb_set(bank, '{account_type}', '"brokerage"'), rec1, cert1), 'VENDOR_ESIGN_BANK');
  perform pg_temp.must_fail(format(call, i1, 'now()', 'Pat Vendor', 'Owner', form, jsonb_set(bank, '{account_key_hmac}', '"xyz"'), rec1, cert1), 'VENDOR_ESIGN_BANK');
  perform pg_temp.must_fail(format(call, i1, 'now()', 'Pat Vendor', 'Owner', form, jsonb_set(bank, '{bank_name}', '""'), rec1, cert1), 'VENDOR_ESIGN_BANK');
  perform pg_temp.must_fail(format(call, i1, 'now()', 'Pat Vendor', 'Owner', form, jsonb_set(bank, '{account_last4}', '"12345"'), rec1, cert1), 'VENDOR_ESIGN_BANK');
  perform pg_temp.must_fail(format(call, i1, 'now()', 'Pat Vendor', 'Owner', form, bank, rec1, rec1), 'VENDOR_ESIGN_FILES');
  -- another vendor's folder is refused (a link for vendor A cannot file into vendor B)
  perform pg_temp.must_fail(format(call, i1, 'now()', 'Pat Vendor', 'Owner', form, bank,
    jsonb_build_object('storage_path', format('ach-docs/vendor/%s/r.pdf', ven2), 'sha256', repeat('9', 64), 'byte_size', 1), cert1), 'VENDOR_ESIGN_FILES');
  perform pg_temp.must_fail(format(call, i1, 'now()', 'Pat Vendor', 'Owner', form, bank, rec1,
    jsonb_build_object('storage_path', format('ach-docs/employee/%s/c.pdf', ven), 'sha256', repeat('9', 64), 'byte_size', 1)), 'VENDOR_ESIGN_FILES');
  -- a 0258 CHECK failure mid-way (byte_size 0) rolls the whole call back
  perform pg_temp.must_fail(format(call, i1, 'now()', 'Pat Vendor', 'Owner', form, bank, rec1, jsonb_set(cert1, '{byte_size}', '0')), 'byte_size');
  select count(*) into n from public.ach_authorization_documents where vendor_id = ven;
  assert n = 0, format('a failed signing must leave no documents, found %s', n);
  select count(*) into n from public.vendor_bank_details where vendor_id = ven;
  assert n = 0, 'a failed signing must leave no vault row';
  -- countersign / reject before signing are refused
  perform pg_temp.must_fail(format($q$select public.vendor_esign_countersign(%L, %L, 'ok', %L)$q$, i1, u_s, acc1), 'VENDOR_ESIGN_STATE');
  perform pg_temp.must_fail(format($q$select public.vendor_esign_reject(%L, %L, 'Callback failed: number disconnected')$q$, i1, u_s), 'VENDOR_ESIGN_STATE');

  -- happy path --------------------------------------------------------------
  select public.vendor_esign_complete(i1, now(), '203.0.113.9', 'UA', '  Pat Vendor ', 'Owner', form, bank, rec1, cert1) into auth1;
  select * into r from public.ach_authorizations where id = auth1;
  assert r.state = 'signed' and r.signature_method = 'esign' and r.payee_type = 'vendor' and r.vendor_id = ven
     and r.signed_on = (now() at time zone 'America/Los_Angeles')::date and r.payee_name = 'Probe Farms LLC' and r.created_by is null,
    format('authorization shape wrong: %s %s %s %s', r.state, r.signature_method, r.signed_on, r.payee_name);
  select count(*) into n from public.ach_authorization_documents where vendor_id = ven and authorization_id = auth1 and intake_status = 'accepted';
  assert n = 3, format('record + certificate + proof accepted and linked, got %s', n);
  select count(*) into n from public.ach_authorization_documents where vendor_id = ven and kind = 'esign_certificate' and storage_path = cert1->>'storage_path';
  assert n = 1, 'certificate stored with kind esign_certificate';
  select count(*) into n from public.ach_authorization_documents where vendor_id = ven and kind = 'voided_check' and mime_type = 'image/jpeg' and sha256 = repeat('5', 64);
  assert n = 1, 'proof filed with its own kind, mime and hash';
  select * into r from public.vendor_bank_details where vendor_id = ven;
  assert r.status = 'on_hold' and r.change_entered_by = u_m and r.bank_routing = 'encv1:r1:x' and r.bank_account_number = 'encv1:a1:x'
     and r.bank_account_type = 'checking' and r.bank_name = 'Kitsap Test Bank' and r.hold_reason like 'Vendor e-signed%' and r.vendor_name = 'Probe Farms LLC',
    format('vault must be on hold, authored by the inviter: %s %s', r.status, r.change_entered_by);
  select * into r from public.vendors where id = ven;
  assert not r.ach_needs_bank_info and not r.ach_opted_out, 'signing clears the needs-info flag';
  select * into r from public.vendor_esign_invites where id = i1;
  assert r.state = 'signed' and r.authorization_id = auth1 and r.signer_ip = '203.0.113.9' and r.signer_name = 'Pat Vendor' and r.signer_title = 'Owner'
     and r.account_last4 = '4321' and r.bank_routing_enc = 'encv1:r1:x' and r.form->>'legal_name' = 'Probe Farms LLC'
     and r.record_document_id is not null and r.certificate_document_id is not null and r.proof_document_id is not null, 'invite closed with evidence';
  select count(*) into n from public.ach_authorization_events where authorization_id = auth1 and event_kind = 'vendor_esign_signed'
     and detail->>'record_sha256' = repeat('1', 64) and detail->>'account_last4' = '4321' and actor_id is null;
  assert n = 1, 'vendor_esign_signed event with record hash and last-4 only';
  select count(*) into n from public.ach_authorization_events where vendor_id = ven and detail::text like '%encv1%';
  assert n = 0, 'no ciphertext in events';

  -- signed is frozen and kept; one open invite still holds ------------------
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set signer_ip = '1.1.1.1' where id = %L$q$, i1), 'VENDOR_ESIGN_SIGNED');
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set form = '{}' where id = %L$q$, i1), 'VENDOR_ESIGN_SIGNED');
  perform pg_temp.must_fail(format($q$delete from public.vendor_esign_invites where id = %L$q$, i1), 'VENDOR_ESIGN_KEEP');
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set state = 'cancelled', cancelled_at = now(), cancel_reason = 'changed mind' where id = %L$q$, i1), 'VENDOR_ESIGN_TRANSITION');
  perform pg_temp.must_fail(format(call, i1, 'now()', 'Pat Vendor', 'Owner', form, bank, rec2, cert2), 'VENDOR_ESIGN_STATE');
  perform pg_temp.must_fail(format($q$insert into public.vendor_esign_invites (vendor_id, token_hash, invited_by, expires_at, email_enc, email_masked, recipient_name) values (%L, %L, %L, now() + interval '1 day', %L, 'ap***@v.test', 'Pat Vendor')$q$, ven, repeat('6', 64), u_m, enc), 'vendor_esign_one_open_per_vendor');

  -- countersign: refused until the vault is released after signing ---------
  perform pg_temp.must_fail(format($q$select public.vendor_esign_countersign(%L, %L, 'ok', %L)$q$, i1, u_s, acc1), 'VENDOR_ESIGN_NOT_RELEASED');
  perform pg_temp.must_fail(format($q$select public.vendor_esign_countersign(%L, null, 'ok', %L)$q$, i1, acc1), 'VENDOR_ESIGN_ACTOR');
  -- releasing the vault: the sender releasing alone is SOLO (0259)
  perform pg_temp.must_fail(format($q$update public.vendor_bank_details set status = 'active', released_by = %L, released_at = now() + interval '1 second', release_mode = 'dual', release_callback_method = 'phone', release_callback_note = 'Called 360-555-0101 from 2024 invoice' where vendor_id = %L$q$, u_m, ven), 'SOLO');
  -- a released vault whose banking was changed after signing does not count
  update public.vendor_bank_details set bank_account_number = 'encv1:a2:x', updated_by = u_s where vendor_id = ven;
  update public.vendor_bank_details set status = 'active', released_by = u_m, released_at = now() + interval '1 second', release_mode = 'dual',
         release_callback_method = 'phone', release_callback_note = 'Called 360-555-0101 from 2024 invoice' where vendor_id = ven;
  perform pg_temp.must_fail(format($q$select public.vendor_esign_countersign(%L, %L, 'ok', %L)$q$, i1, u_s, acc1), 'VENDOR_ESIGN_NOT_RELEASED');
  -- put the signed banking back (on hold again, authored by the inviter), then a dual release
  update public.vendor_bank_details set bank_account_number = 'encv1:a1:x', updated_by = u_m where vendor_id = ven;
  select * into r from public.vendor_bank_details where vendor_id = ven;
  assert r.status = 'on_hold', 'changing banking puts it back on hold';
  update public.vendor_bank_details set status = 'active', released_by = u_s, released_at = now() + interval '2 seconds', release_mode = 'dual',
         release_callback_method = 'phone', release_callback_note = 'Called 360-555-0101 from 2024 invoice' where vendor_id = ven;
  -- acceptance file must be in this vendor's folder
  perform pg_temp.must_fail(format($q$select public.vendor_esign_countersign(%L, %L, 'ok', %L)$q$, i1, u_s,
    jsonb_build_object('storage_path', format('ach-docs/vendor/%s/a.pdf', ven2), 'sha256', repeat('8', 64), 'byte_size', 1)), 'VENDOR_ESIGN_FILES');
  perform public.vendor_esign_countersign(i1, u_s, 'Callback ok, dual approval', acc1);
  select * into r from public.ach_authorizations where id = auth1;
  assert r.state = 'active' and r.annual_review_due_on = ((now() at time zone 'America/Los_Angeles')::date + interval '1 year')::date and r.updated_by = u_s,
    format('authorization active with annual review: %s %s', r.state, r.annual_review_due_on);
  select * into r from public.vendor_esign_invites where id = i1;
  assert r.state = 'countersigned' and r.countersigned_by = u_s and r.countersign_document_id is not null, 'invite countersigned';
  select count(*) into n from public.ach_authorization_documents where id = r.countersign_document_id and authorization_id = auth1 and uploaded_by = u_s;
  assert n = 1, 'acceptance document linked';
  select count(*) into n from public.ach_authorization_events where authorization_id = auth1 and event_kind = 'vendor_esign_countersigned'
     and actor_id = u_s and detail->>'vault_release_mode' = 'dual';
  assert n = 1, 'countersigned event records the vault release mode';
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set countersign_note = 'x' where id = %L$q$, i1), 'VENDOR_ESIGN_FINAL');
  perform pg_temp.must_fail(format($q$select public.vendor_esign_countersign(%L, %L, 'again', %L)$q$, i1, u_s, acc1), 'VENDOR_ESIGN_STATE');

  -- change of banking: new invite supersedes the active authorization -------
  i2 := pg_temp.ready_invite(ven, u_m, repeat('7', 64), repeat('6', 64));
  bank2 := jsonb_set(jsonb_set(jsonb_set(bank, '{account_enc}', '"encv1:a3:x"'), '{account_last4}', '"8888"'), '{account_key_hmac}', to_jsonb(repeat('b', 64)));
  select public.vendor_esign_complete(i2, now(), '', '', 'Pat Vendor', 'Owner', jsonb_set(form, '{request_type}', '"change"'), bank2, rec2, cert2) into auth2;
  select state into r from public.ach_authorizations where id = auth1;
  assert r.state = 'archived', 'old authorization archived on a new signing';
  select count(*) into n from public.ach_authorization_events where authorization_id = auth1 and event_kind = 'authorization_superseded' and detail->>'vendor_esign_invite_id' = i2::text;
  assert n = 1, 'superseded event names the invite';
  select * into r from public.vendor_bank_details where vendor_id = ven;
  assert r.status = 'on_hold' and r.bank_account_number = 'encv1:a3:x' and r.released_by is null, 'changed banking back on hold, release cleared';
  -- reject: authorization revoked, vault stays on hold
  perform pg_temp.must_fail(format($q$select public.vendor_esign_reject(%L, %L, 'short')$q$, i2, u_s), 'VENDOR_ESIGN_REASON');
  perform pg_temp.must_fail(format($q$select public.vendor_esign_reject(%L, null, 'Callback failed: number disconnected')$q$, i2), 'VENDOR_ESIGN_ACTOR');
  perform public.vendor_esign_reject(i2, u_s, 'Callback failed: AR contact did not recognise the change');
  select state, ended_on into r from public.ach_authorizations where id = auth2;
  assert r.state = 'revoked' and r.ended_on is not null, 'rejected form revokes the authorization';
  select status into r from public.vendor_bank_details where vendor_id = ven;
  assert r.status = 'on_hold', 'vault stays on hold after reject';
  select count(*) into n from public.ach_authorization_events where authorization_id = auth2 and event_kind = 'vendor_esign_rejected' and actor_id = u_s;
  assert n = 1, 'rejected event';
  perform pg_temp.must_fail(format($q$delete from public.vendor_esign_invites where id = %L$q$, i2), 'VENDOR_ESIGN_KEEP');

  -- reject after a release puts the vault back on hold ----------------------
  i3 := pg_temp.ready_invite(ven, u_m, repeat('8', 64), repeat('9', 64));
  perform public.vendor_esign_complete(i3, now(), '', '', 'Pat Vendor', 'Owner', form,
    jsonb_set(jsonb_set(bank, '{account_enc}', '"encv1:a4:x"'), '{account_key_hmac}', to_jsonb(repeat('c', 64))),
    jsonb_build_object('storage_path', pre || 'r3.pdf', 'sha256', repeat('a', 64), 'byte_size', 10),
    jsonb_build_object('storage_path', pre || 'c3.pdf', 'sha256', repeat('b', 64), 'byte_size', 10));
  update public.vendor_bank_details set status = 'active', released_by = u_s, released_at = now() + interval '3 seconds', release_mode = 'dual',
         release_callback_method = 'phone', release_callback_note = 'Called 360-555-0101 from 2024 invoice' where vendor_id = ven;
  perform public.vendor_esign_reject(i3, u_s, 'Owner review: bank letter name does not match vendor');
  select status into r from public.vendor_bank_details where vendor_id = ven;
  assert r.status = 'on_hold', 'reject after release re-holds the vault';

  -- the same proof file as an earlier document is reused, not duplicated ---
  i4 := pg_temp.ready_invite(ven, u_m, repeat('a', 64), repeat('5', 64));
  perform public.vendor_esign_complete(i4, now(), '', '', 'Pat Vendor', 'Owner', form, bank,
    jsonb_build_object('storage_path', pre || 'r4.pdf', 'sha256', repeat('c', 64), 'byte_size', 10),
    jsonb_build_object('storage_path', pre || 'c4.pdf', 'sha256', repeat('e', 64), 'byte_size', 10));
  select count(*) into n from public.ach_authorization_documents where vendor_id = ven and sha256 = repeat('5', 64);
  assert n = 1, 'reused proof stays one document';
  select proof_document_id into r from public.vendor_esign_invites where id = i4;
  assert r.proof_document_id = (select id from public.ach_authorization_documents where vendor_id = ven and sha256 = repeat('5', 64)), 'invite points at the reused proof';

  -- a rejected proof file cannot be reused ----------------------------------
  insert into public.ach_authorization_documents (payee_type, vendor_id, kind, storage_path, sha256, byte_size, mime_type, intake_status, intake_note)
    values ('vendor', ven2, 'voided_check', format('ach-docs/vendor/%s/bad.pdf', ven2), repeat('f', 64), 10, 'application/pdf', 'rejected', 'Altered check image');
  i4 := pg_temp.ready_invite(ven2, u_m, repeat('b', 64), repeat('f', 64));
  perform pg_temp.must_fail(format(call, i4, 'now()', 'Pat Vendor', 'Owner', form, bank,
    jsonb_build_object('storage_path', format('ach-docs/vendor/%s/r.pdf', ven2), 'sha256', repeat('1', 64), 'byte_size', 1),
    jsonb_build_object('storage_path', format('ach-docs/vendor/%s/c.pdf', ven2), 'sha256', repeat('2', 64), 'byte_size', 1)), 'was rejected before');

  -- expired link, stale code ------------------------------------------------
  update public.vendor_esign_invites set state = 'cancelled', cancelled_at = now(), cancel_reason = 'test cleanup' where id = i4;
  insert into public.vendor_esign_invites (vendor_id, token_hash, invited_by, invited_at, expires_at, email_enc, email_masked, recipient_name)
    values (ven2, repeat('c', 64), u_m, now() - interval '10 days', now() - interval '1 day', enc, 'ap***@v.test', 'Pat Vendor') returning id into i4;
  update public.vendor_esign_invites set state = 'code_sent', otp_digest = repeat('d', 64), otp_sent_at = now(), otp_sends = 1 where id = i4;
  update public.vendor_esign_invites set state = 'consented', code_verified_at = now(), consented_at = now(), browser_digest = repeat('b', 64),
         disclosure_version = 'GW-VESIGN-1', disclosure_sha256 = repeat('c', 64),
         proof_storage_path = format('ach-docs/vendor/%s/p.pdf', ven2), proof_sha256 = repeat('4', 64), proof_byte_size = 1, proof_mime = 'application/pdf', proof_kind = 'bank_letter'
   where id = i4;
  perform pg_temp.must_fail(format(call, i4, 'now()', 'Pat Vendor', 'Owner', form, bank,
    jsonb_build_object('storage_path', format('ach-docs/vendor/%s/r.pdf', ven2), 'sha256', repeat('1', 64), 'byte_size', 1),
    jsonb_build_object('storage_path', format('ach-docs/vendor/%s/c.pdf', ven2), 'sha256', repeat('2', 64), 'byte_size', 1)), 'VENDOR_ESIGN_EXPIRED');
  update public.vendor_esign_invites set state = 'cancelled', cancelled_at = now(), cancel_reason = 'expired link' where id = i4;
  i4 := pg_temp.ready_invite(ven2, u_m, repeat('d', 64), repeat('3', 64));
  update public.vendor_esign_invites set state = 'code_sent', otp_digest = repeat('d', 64), otp_sent_at = now(), otp_sends = 2 where id = i4;
  update public.vendor_esign_invites set state = 'consented', code_verified_at = now() - interval '25 hours' where id = i4;
  perform pg_temp.must_fail(format(call, i4, 'now()', 'Pat Vendor', 'Owner', form, bank,
    jsonb_build_object('storage_path', format('ach-docs/vendor/%s/r.pdf', ven2), 'sha256', repeat('1', 64), 'byte_size', 1),
    jsonb_build_object('storage_path', format('ach-docs/vendor/%s/c.pdf', ven2), 'sha256', repeat('2', 64), 'byte_size', 1)), 'VENDOR_ESIGN_STALE');
  -- cancel needs a reason; cancelled is final
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set state = 'cancelled', cancelled_at = now(), cancel_reason = 'x' where id = %L$q$, i4), 'vesign_cancelled_shape');
  update public.vendor_esign_invites set state = 'cancelled', cancelled_at = now(), cancelled_by = u_m, cancel_reason = 'Vendor prefers paper check.' where id = i4;
  perform pg_temp.must_fail(format($q$update public.vendor_esign_invites set cancel_reason = 'changed' where id = %L$q$, i4), 'VENDOR_ESIGN_FINAL');

  -- RLS + grants ------------------------------------------------------------
  select count(*) into n from pg_class where relname = 'vendor_esign_invites' and relrowsecurity;
  assert n = 1, 'RLS must be on';
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'vendor_esign_invites' and grantee = 'anon';
  assert n = 0, format('anon must have no grants, found %s', n);
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'vendor_esign_invites' and grantee = 'authenticated' and privilege_type = 'DELETE';
  assert n = 0, 'authenticated must not delete';
  select count(*) into n from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name in ('vendor_esign_complete', 'vendor_esign_countersign', 'vendor_esign_reject')
     and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type = 'EXECUTE';
  assert n = 0, format('anon/authenticated must not execute the vendor e-sign functions, found %s', n);
  select count(*) into n from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name in ('vendor_esign_complete', 'vendor_esign_countersign', 'vendor_esign_reject')
     and grantee = 'service_role' and privilege_type = 'EXECUTE';
  assert n = 3, format('service_role must execute all three, found %s', n);
  select count(*) into n from pg_proc where proname in ('vendor_esign_complete', 'vendor_esign_countersign', 'vendor_esign_reject', 'vendor_esign_guard') and prosecdef;
  assert n = 0, 'vendor e-sign functions must NOT be security definer';

  raise notice 'VENDOR 0262 CHECK PASSED';
end $$;

rollback;
