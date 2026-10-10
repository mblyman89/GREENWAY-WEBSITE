#!/usr/bin/env python3
"""scripts/r39/mutate-0261-sql.py - test the 0261 pg scenario check (R39 S6).

Each mutant weakens ONE guard in 0261. For each: drop 0261 objects (the
rollback, which is safe because the check always rolls back so no signed
session exists), apply the mutated file, run
scripts/recon/ach-esign-0261-pg-check.sql and expect it to FAIL. The real
0261 is re-applied at the end and the control re-run.

    sudo -u postgres python3 scripts/r39/mutate-0261-sql.py   (DB r39)
"""
import subprocess, sys

DB = "r39"
MIG = "supabase/migrations/0261_ach_esign.sql"
RB = "supabase/rollbacks/0261_ach_esign.rollback.sql"
TEST = "scripts/recon/ach-esign-0261-pg-check.sql"
TMP = "/tmp/mut0261.sql"

def psql_file(path):
    return subprocess.run(["sudo", "-u", "postgres", "psql", "-d", DB, "-q", "-v", "ON_ERROR_STOP=1", "-f", path],
                          capture_output=True, text=True)

M = [
    ("id-detail-full-number", "and id_detail !~ '[0-9]{5,}'", ""),
    ("id-type-any", "check (id_type in ('wa_dl_id', 'passport', 'other_gov_photo_id'))", "check (id_type is not null)"),
    ("code-sent-shape-off", "state in ('started', 'cancelled') or (email_enc is not null", "true or (email_enc is not null"),
    ("consented-shape-off", "state not in ('consented', 'signed')\n    or (code_verified_at", "true\n    or (code_verified_at"),
    ("cancel-reason-short", "coalesce(length(trim(cancel_reason)), 0) >= 5", "coalesce(length(trim(cancel_reason)), 0) >= 0"),
    ("sends-unbounded", "check (otp_sends between 0 and 3)", "check (otp_sends >= 0)"),
    ("attempts-unbounded", "check (otp_attempts between 0 and 5)", "check (otp_attempts >= 0)"),
    ("two-live-sessions", "  where state in ('started', 'code_sent', 'consented');", "  where state in ('started');"),
    ("delete-signed", "    if old.state = 'signed' then\n      raise exception 'ACH_ESIGN_KEEP", "    if false then\n      raise exception 'ACH_ESIGN_KEEP"),
    ("final-editable", "  if old.state in ('signed', 'cancelled') then", "  if old.state in ('none') then"),
    ("id-mutable", "     or new.id_detail is distinct from old.id_detail\n", "\n"),
    ("name-mutable", "     or new.legal_name is distinct from old.legal_name then", "     or false then"),
    ("counters-down", "  if new.otp_attempts < old.otp_attempts or new.otp_sends < old.otp_sends then", "  if false then"),
    ("email-swap", "  if old.code_verified_at is not null and (new.email_enc", "  if false and (new.email_enc"),
    ("skip-to-signed", "      when 'code_sent' then array['consented', 'cancelled']", "      when 'code_sent' then array['consented', 'cancelled', 'signed']"),
    ("back-to-code", "      when 'consented' then array['signed', 'cancelled']", "      when 'consented' then array['signed', 'cancelled', 'code_sent']"),
    ("start-to-consented", "      when 'started'   then array['code_sent', 'cancelled']", "      when 'started'   then array['code_sent', 'cancelled', 'consented']"),
    ("fn-actor-optional", "  if p_actor is null then\n    raise exception 'ACH_ESIGN_ACTOR", "  if false then\n    raise exception 'ACH_ESIGN_ACTOR"),
    ("fn-future-time", "  if p_signed_at is null or p_signed_at > now() + interval '1 minute' then", "  if p_signed_at is null then"),
    ("fn-zero-accounts", "  if n < 1 or n > 3 then", "  if n > 3 then"),
    ("fn-four-accounts", "  if n < 1 or n > 3 then", "  if n < 1 then"),
    ("fn-same-file", "     or (p_record->>'sha256') = (p_certificate->>'sha256') then", "     or false then"),
    ("fn-vendor-path", "     or coalesce(p_record->>'storage_path', '') not like 'ach-docs/employee/%'\n", "\n"),
    ("fn-state-any", "  if s.state <> 'consented' then", "  if s.state = 'cancelled' then"),
    ("fn-no-expiry", "  if s.started_at < now() - interval '30 minutes' then", "  if false then"),
    ("fn-name-any", "     <> lower(regexp_replace(trim(s.legal_name), '\\s+', ' ', 'g')) then", "     <> lower(regexp_replace(trim(s.legal_name), '\\s+', ' ', 'g')) and false then"),
    ("fn-utc-date", "  signed_d := (p_signed_at at time zone 'America/Los_Angeles')::date;", "  signed_d := (p_signed_at at time zone 'Asia/Tokyo')::date;"),
    ("fn-silent-replace", "    if not coalesce(p_replace_open, false) then", "    if false then"),
    ("fn-old-accounts-live", "    update public.ach_authorization_accounts\n       set archived_at = now()\n     where authorization_id = old_auth.id and archived_at is null;", "    null;"),
    ("fn-no-supersede-event", "    values (old_auth.id, 'employee', s.employee_id, 'authorization_superseded', p_actor,", "    values (old_auth.id, 'employee', s.employee_id, 'authorization_noted', p_actor,"),
    ("fn-wet-ink", "'signed', 'esign', signed_d, p_actor, p_actor)", "'signed', 'wet_ink_upload', signed_d, p_actor, p_actor)"),
    ("fn-priority-unchecked", "    if (a->>'priority')::int is distinct from i then", "    if false then"),
    ("fn-docs-unlinked", "     set intake_status = 'accepted', authorization_id = new_id,\n         intake_note = format('E-signed", "     set intake_status = 'accepted',\n         intake_note = format('E-signed"),
    ("fn-cert-kind", "    ('employee', s.employee_id, 'esign_certificate', p_certificate->>'storage_path'", "    ('employee', s.employee_id, 'other', p_certificate->>'storage_path'"),
    ("fn-no-ip", "         signer_ip = left(p_ip, 45),", "         signer_ip = null,"),
    ("fn-no-event", "    (new_id, 'employee', s.employee_id, 'esign_signed', p_actor,", "    (new_id, 'employee', s.employee_id, 'esign_noted', p_actor,"),
    ("fn-no-hash-in-event", "'record_sha256', p_record->>'sha256',", "'record_sha256', null,"),
    ("rls-off", "alter table public.ach_esign_sessions enable row level security;", "alter table public.ach_esign_sessions disable row level security;"),
    ("anon-grant", "revoke all on table public.ach_esign_sessions from anon;", "grant select on table public.ach_esign_sessions to anon;"),
    ("auth-delete", "revoke delete on table public.ach_esign_sessions from authenticated;", "grant delete on table public.ach_esign_sessions to authenticated;"),
    ("fn-authenticated", "grant execute on function public.ach_esign_complete(uuid, uuid, timestamptz, text, text, text, boolean, jsonb, jsonb, jsonb) to service_role;",
     "grant execute on function public.ach_esign_complete(uuid, uuid, timestamptz, text, text, text, boolean, jsonb, jsonb, jsonb) to service_role, authenticated;"),
    ("fn-definer", "  p_certificate  jsonb\n) returns uuid\nlanguage plpgsql\n", "  p_certificate  jsonb\n) returns uuid\nlanguage plpgsql\nsecurity definer\n"),
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
