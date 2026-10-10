#!/usr/bin/env python3
"""scripts/r39/mutate-0262-sql.py - test the 0262 pg scenario check (R39 S7 vendor e-sign).

Each mutant weakens ONE guard in 0262. For each: drop 0262 objects (the
rollback, which is safe because the check always rolls back so no signed
invite exists), apply the mutated file, run
scripts/recon/vendor-esign-0262-pg-check.sql and expect it to FAIL. The real
0262 is re-applied at the end and the control re-run.

    sudo -u postgres python3 scripts/r39/mutate-0262-sql.py   (DB r39)
"""
import subprocess, sys

DB = "r39"
MIG = "supabase/migrations/0262_vendor_ach_esign.sql"
RB = "supabase/rollbacks/0262_vendor_ach_esign.rollback.sql"
TEST = "scripts/recon/vendor-esign-0262-pg-check.sql"
TMP = "/tmp/mut0262.sql"

def psql_file(path):
    return subprocess.run(["sudo", "-u", "postgres", "psql", "-d", DB, "-q", "-v", "ON_ERROR_STOP=1", "-f", path],
                          capture_output=True, text=True)

M = [
    ("state-any", "check (state in ('sent', 'code_sent', 'consented', 'signed', 'countersigned', 'rejected', 'cancelled'))", "check (state is not null)"),
    ("token-format", "check (token_hash ~ '^[0-9a-f]{64}$')", "check (token_hash <> '')"),
    ("token-not-unique", "token_hash               text not null unique check", "token_hash               text not null check"),
    ("email-plaintext", "check (email_enc like 'encv1:%')", "check (email_enc <> '')"),
    ("sends-unbounded", "check (otp_sends between 0 and 5)", "check (otp_sends >= 0)"),
    ("attempts-unbounded", "check (otp_attempts between 0 and 5)", "check (otp_attempts >= 0)"),
    ("proof-path-any", "proof_storage_path like 'ach-docs/vendor/%'", "proof_storage_path <> ''"),
    ("proof-size-any", "proof_byte_size <= 26214400", "proof_byte_size > 0"),
    ("routing-plain", "check (bank_routing_enc is null or bank_routing_enc like 'encv1:%')", "check (true)"),
    ("account-plain", "check (bank_account_enc is null or bank_account_enc like 'encv1:%')", "check (true)"),
    ("last4-full", "account_last4 ~ '^[0-9]{1,4}$'", "account_last4 ~ '^[0-9]+$'"),
    ("expiry-long", "expires_at <= invited_at + interval '30 days'", "expires_at <= invited_at + interval '365 days'"),
    ("code-sent-shape-off", "state in ('sent', 'cancelled') or (otp_digest", "true or (otp_digest"),
    ("consented-no-browser", "and consented_at is not null and browser_digest is not null", "and consented_at is not null"),
    ("consented-no-disclosure", "        and disclosure_version is not null and disclosure_sha256 is not null)", "        )"),
    ("proof-shape-off", "    (proof_storage_path is null) = (proof_sha256 is null)\n", "    true\n"),
    ("signed-shape-off", "    state not in ('signed', 'countersigned', 'rejected')\n    or (signed_at", "    true\n    or (signed_at"),
    ("countersigned-shape-off", "(state = 'countersigned') = (countersigned_at is not null and countersigned_by is not null and countersign_document_id is not null)", "true"),
    ("reject-reason-short", "coalesce(length(trim(reject_reason)), 0) >= 10", "true"),
    ("cancel-reason-short", "coalesce(length(trim(cancel_reason)), 0) >= 5", "true"),
    ("two-open", "  where state in ('sent', 'code_sent', 'consented', 'signed');", "  where state in ('sent');"),
    ("delete-signed", "    if old.state in ('signed', 'countersigned', 'rejected') then\n      raise exception 'VENDOR_ESIGN_KEEP", "    if false then\n      raise exception 'VENDOR_ESIGN_KEEP"),
    ("final-editable", "  if old.state in ('countersigned', 'rejected', 'cancelled') then", "  if old.state in ('none') then"),
    ("token-mutable", "     or new.token_hash is distinct from old.token_hash\n", "\n"),
    ("email-mutable", "     or new.email_enc is distinct from old.email_enc\n", "\n"),
    ("expiry-mutable", "     or new.expires_at is distinct from old.expires_at\n", "\n"),
    ("inviter-mutable", "     or new.invited_by is distinct from old.invited_by\n", "\n"),
    ("opened-mutable", "  if old.first_opened_at is not null and new.first_opened_at", "  if false and new.first_opened_at"),
    ("counters-down", "  if new.otp_attempts < old.otp_attempts or new.otp_sends < old.otp_sends then", "  if false then"),
    ("signed-thaw", "  if old.state = 'signed'\n     and (to_jsonb(new)", "  if false\n     and (to_jsonb(new)"),
    ("sent-to-consented", "      when 'sent'      then array['code_sent', 'cancelled']", "      when 'sent'      then array['code_sent', 'cancelled', 'consented']"),
    ("code-to-signed", "      when 'code_sent' then array['consented', 'cancelled']", "      when 'code_sent' then array['consented', 'cancelled', 'signed']"),
    ("signed-cancel", "      when 'signed'    then array['countersigned', 'rejected']", "      when 'signed'    then array['countersigned', 'rejected', 'cancelled']"),
    ("fn-future-time", "  if p_signed_at is null or p_signed_at > now() + interval '1 minute' then", "  if p_signed_at is null then"),
    ("fn-state-any", "  if s.state <> 'consented' then\n    raise exception 'VENDOR_ESIGN_STATE: invite % is %, not ready", "  if s.state = 'cancelled' then\n    raise exception 'VENDOR_ESIGN_STATE: invite % is %, not ready"),
    ("fn-no-expiry", "  if now() > s.expires_at then", "  if false then"),
    ("fn-no-stale", "  if s.code_verified_at < now() - interval '24 hours' then", "  if false then"),
    ("fn-no-proof", "  if s.proof_storage_path is null then", "  if false then"),
    ("fn-name-one-word", " or position(' ' in trim(p_signer_name)) = 0 then", " then"),
    ("fn-title-any", "  if coalesce(length(trim(p_signer_title)), 0) < 2 or", "  if false and"),
    ("fn-request-cancel", "     or coalesce(p_form->>'request_type', '') not in ('new', 'change') then", "     then"),
    ("fn-bank-plain", "     or coalesce(p_bank->>'account_enc', '') not like 'encv1:%'\n", "\n"),
    ("fn-hmac-any", "     or coalesce(p_bank->>'account_key_hmac', '') !~ '^[0-9a-f]{64}$'\n", "\n"),
    ("fn-record-any-folder", "     or left(coalesce(p_record->>'storage_path', ''), length(prefix)) <> prefix\n", "\n"),
    ("fn-proof-any-folder", "     or left(s.proof_storage_path, length(prefix)) <> prefix\n", "\n"),
    ("fn-same-file", "     or (p_record->>'sha256') = (p_certificate->>'sha256') then", "     then"),
    ("fn-rejected-proof-ok", "  if found and exists (select 1 from public.ach_authorization_documents where id = proof_id and intake_status = 'rejected') then", "  if false then"),
    ("fn-no-supersede", "    update public.ach_authorizations\n       set state = 'archived',", "    update public.ach_authorizations\n       set state = old_auth.state,"),
    ("fn-no-supersede-event", "values (old_auth.id, 'vendor', s.vendor_id, 'authorization_superseded', null,", "values (old_auth.id, 'vendor', s.vendor_id, 'authorization_noted', null,"),
    ("fn-wet-ink", "'signed', 'esign', signed_d, null, null)", "'signed', 'wet_ink_upload', signed_d, null, null)"),
    ("fn-auth-active", "('vendor', s.vendor_id, left(legal, 200), 'signed', 'esign'", "('vendor', s.vendor_id, left(legal, 200), 'active', 'esign'"),
    ("fn-docs-unlinked", "     set intake_status = 'accepted', authorization_id = new_id,\n         intake_note = format('Vendor e-signed", "     set intake_status = 'accepted',\n         intake_note = format('Vendor e-signed"),
    ("fn-cert-kind", "('vendor', s.vendor_id, 'esign_certificate', p_certificate->>'storage_path'", "('vendor', s.vendor_id, 'other', p_certificate->>'storage_path'"),
    ("fn-vault-active-update", "           bank_account_type = p_bank->>'account_type', hold_reason = hold, updated_by = s.invited_by,\n           status = 'on_hold'", "           bank_account_type = p_bank->>'account_type', hold_reason = hold, updated_by = s.invited_by,\n           status = vb.status"),
    ("fn-vault-author-null", "hold_reason = hold, updated_by = s.invited_by,", "hold_reason = hold, updated_by = null,"),
    ("fn-flags-kept", "     set ach_needs_bank_info = false, ach_opted_out = false, ach_opted_out_at = null", "     set ach_opted_out_at = ach_opted_out_at"),
    ("fn-no-ip", "         signer_ip = left(p_ip, 45),", "         signer_ip = null,"),
    ("fn-no-cipher-snapshot", "         bank_routing_enc = p_bank->>'routing_enc', bank_account_enc = p_bank->>'account_enc',\n", "         bank_routing_enc = p_bank->>'routing_enc', bank_account_enc = p_bank->>'routing_enc',\n"),
    ("fn-no-event", "    (new_id, 'vendor', s.vendor_id, 'vendor_esign_signed', null,", "    (new_id, 'vendor', s.vendor_id, 'vendor_esign_noted', null,"),
    ("fn-event-hash", "'record_sha256', p_record->>'sha256',", "'record_sha256', null,"),
    ("cs-actor-optional", "  if p_actor is null then\n    raise exception 'VENDOR_ESIGN_ACTOR: the Greenway signer must be recorded.' using errcode = 'check_violation';\n  end if;\n  select * into s from public.vendor_esign_invites where id = p_invite_id for update;\n  if not found then\n    raise exception 'VENDOR_ESIGN_NOT_FOUND: invite %.', p_invite_id using errcode = 'check_violation';\n  end if;\n  if s.state <> 'signed' then\n    raise exception 'VENDOR_ESIGN_STATE: invite % is %, not waiting", "  if false then\n    raise exception 'VENDOR_ESIGN_ACTOR: the Greenway signer must be recorded.' using errcode = 'check_violation';\n  end if;\n  select * into s from public.vendor_esign_invites where id = p_invite_id for update;\n  if not found then\n    raise exception 'VENDOR_ESIGN_NOT_FOUND: invite %.', p_invite_id using errcode = 'check_violation';\n  end if;\n  if s.state <> 'signed' then\n    raise exception 'VENDOR_ESIGN_STATE: invite % is %, not waiting"),
    ("cs-state-any", "  if s.state <> 'signed' then\n    raise exception 'VENDOR_ESIGN_STATE: invite % is %, not waiting", "  if false then\n    raise exception 'VENDOR_ESIGN_STATE: invite % is %, not waiting"),
    ("cs-hold-ok", "  if not found or vb.status <> 'active' or vb.released_at", "  if not found or vb.released_at"),
    ("cs-old-release-ok", " or vb.released_at <= s.signed_at\n", "\n"),
    ("cs-changed-routing-ok", "     or vb.bank_routing is distinct from s.bank_routing_enc\n", "\n"),
    ("cs-changed-account-ok", "     or vb.bank_account_number is distinct from s.bank_account_enc\n", "\n"),
    ("cs-doc-any-folder", "  if p_document is null or left(coalesce(p_document->>'storage_path', ''), length(prefix)) <> prefix then", "  if p_document is null then"),
    ("cs-auth-any", "  if not found or a.state not in ('signed', 'verifying') then", "  if not found then"),
    ("cs-no-review", "annual_review_due_on = (today + interval '1 year')::date,", "annual_review_due_on = null,"),
    ("cs-auth-stays", "     set state = 'active', annual_review_due_on", "     set state = a.state, annual_review_due_on"),
    ("cs-no-event", "values (a.id, 'vendor', s.vendor_id, 'vendor_esign_countersigned', p_actor,", "values (a.id, 'vendor', s.vendor_id, 'vendor_esign_noted', p_actor,"),
    ("rj-reason-short", "  if coalesce(length(trim(p_reason)), 0) < 10 then", "  if coalesce(length(trim(p_reason)), 0) < 1 then"),
    ("rj-state-any", "  if s.state <> 'signed' then\n    raise exception 'VENDOR_ESIGN_STATE: invite % is %, only", "  if false then\n    raise exception 'VENDOR_ESIGN_STATE: invite % is %, only"),
    ("rj-auth-kept", "       set state = 'revoked', ended_on", "       set state = a.state, ended_on"),
    ("rj-vault-live", "   where vendor_id = s.vendor_id and status = 'active';", "   where false;"),
    ("rj-no-event", "values (s.authorization_id, 'vendor', s.vendor_id, 'vendor_esign_rejected', p_actor,", "values (s.authorization_id, 'vendor', s.vendor_id, 'vendor_esign_noted', p_actor,"),
    ("rls-off", "alter table public.vendor_esign_invites enable row level security;", "alter table public.vendor_esign_invites disable row level security;"),
    ("anon-grant", "revoke all on table public.vendor_esign_invites from anon;", "grant select on table public.vendor_esign_invites to anon;"),
    ("auth-delete", "revoke delete on table public.vendor_esign_invites from authenticated;", "grant delete on table public.vendor_esign_invites to authenticated;"),
    ("fn-authenticated", "grant execute on function public.vendor_esign_complete(uuid, timestamptz, text, text, text, text, jsonb, jsonb, jsonb, jsonb) to service_role;", "grant execute on function public.vendor_esign_complete(uuid, timestamptz, text, text, text, text, jsonb, jsonb, jsonb, jsonb) to service_role, authenticated;"),
    ("cs-authenticated", "grant execute on function public.vendor_esign_countersign(uuid, uuid, text, jsonb) to service_role;", "grant execute on function public.vendor_esign_countersign(uuid, uuid, text, jsonb) to service_role, authenticated;"),
    ("rj-anon", "grant execute on function public.vendor_esign_reject(uuid, uuid, text) to service_role;", "grant execute on function public.vendor_esign_reject(uuid, uuid, text) to service_role, anon;"),
    ("fn-definer", "  p_certificate  jsonb\n) returns uuid\nlanguage plpgsql\n", "  p_certificate  jsonb\n) returns uuid\nlanguage plpgsql\nsecurity definer\n"),
    ("cs-definer", "  p_document  jsonb\n) returns void\nlanguage plpgsql\n", "  p_document  jsonb\n) returns void\nlanguage plpgsql\nsecurity definer\n"),
]

src = open(MIG).read()
if psql_file(RB).returncode or psql_file(MIG).returncode:
    sys.exit("reset failed")
if psql_file(TEST).returncode:
    sys.exit("CONTROL FAILED")
print("CONTROL pass", flush=True)
killed, surv = 0, []
for name, old, new in M:
    if src.count(old) != 1:
        print(f"ANCHOR {src.count(old)} {name}", flush=True); surv.append(name); continue
    open(TMP, "w").write(src.replace(old, new, 1))
    psql_file(RB)
    if psql_file(TMP).returncode:
        print(f"APPLY FAIL {name}", flush=True); surv.append(name); continue
    if psql_file(TEST).returncode:
        killed += 1; print(f"killed   {name}", flush=True)
    else:
        surv.append(name); print(f"SURVIVED {name}", flush=True)
psql_file(RB)
assert psql_file(MIG).returncode == 0
assert psql_file(TEST).returncode == 0, "control after restore failed"
print(f"control restored; killed {killed}/{len(M)} survivors {surv}")
