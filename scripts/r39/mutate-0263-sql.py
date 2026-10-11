#!/usr/bin/env python3
"""scripts/r39/mutate-0263-sql.py - test the 0263 pg scenario check (R39 S7 ACH operations).

Each mutant weakens ONE guard in 0263. For each: roll 0263 back (safe: the
check always rolls back, so no used rows exist), apply the mutated file, run
scripts/recon/ach-ops-0263-pg-check.sql and expect it to FAIL. The real 0263
is re-applied at the end and the control re-run.

    python3 scripts/r39/mutate-0263-sql.py   (DB r39; uses sudo -u postgres)
"""
import subprocess, sys

DB = "r39"
MIG = "supabase/migrations/0263_ach_operations.sql"
RB = "supabase/rollbacks/0263_ach_operations.rollback.sql"
TEST = "scripts/recon/ach-ops-0263-pg-check.sql"
TMP = "/tmp/mut0263.sql"

def psql_file(path):
    return subprocess.run(["sudo", "-u", "postgres", "psql", "-d", DB, "-q", "-v", "ON_ERROR_STOP=1", "-f", path],
                          capture_output=True, text=True)

M = [
    # columns / constraints
    ("payee-shape-off", "  or (payee_type = 'employee' and employee_id is not null and vendor_id is null)\n", "  or (payee_type = 'employee')\n"),
    ("corrected-on-return", "  (corrected_data_enc is null or notice_kind = 'noc')\n", "  (true)\n"),
    ("last4-long", "corrected_last4 ~ '^[0-9]{1,4}$'", "corrected_last4 ~ '^[0-9]+$'"),
    ("hold-applied-any", "hold_applied is null or hold_applied in ('vault', 'authorization', 'already_on_hold', 'none')", "true"),
    ("note-short", "  resolution_note is null or length(trim(resolution_note)) >= 10\n", "  true\n"),
    ("two-open-checks", "  on public.ach_verifications (account_id) where status in ('planned', 'sent');", "  on public.ach_verifications (account_id, id) where status in ('planned', 'sent');"),
    ("sent-no-dates", "  status not in ('sent') or method = 'voided_check_callback'\n", "  true or method = 'voided_check_callback'\n"),
    ("ver-note-short", "  status not in ('failed', 'cancelled') or length(trim(coalesce(note, ''))) >= 5\n", "  true\n"),
    # notice guard
    ("notice-delete", "  if tg_op = 'DELETE' then\n    raise exception 'ACH_NOTICE_KEEP", "  if false then\n    raise exception 'ACH_NOTICE_KEEP"),
    ("notice-final-off", "  if old.resolved_at is not null then\n    raise exception 'ACH_NOTICE_FINAL", "  if false then\n    raise exception 'ACH_NOTICE_FINAL"),
    ("notice-amount-mutable", "or new.amount_cents is distinct from old.amount_cents", "or false"),
    ("notice-hold-mutable", "or new.hold_applied is distinct from old.hold_applied", "or false"),
    ("notice-employee-mutable", "     or new.employee_id is distinct from old.employee_id", "     or false"),
    # verification guard
    ("ver-delete", "  if tg_op = 'DELETE' then\n    raise exception 'ACH_VERIFICATION_KEEP", "  if false then\n    raise exception 'ACH_VERIFICATION_KEEP"),
    ("ver-method-mutable", "  if new.account_id is distinct from old.account_id or new.method is distinct from old.method\n     or new.micro_amount_cents", "  if new.account_id is distinct from old.account_id\n     or new.micro_amount_cents"),
    ("ver-amount-mutable", "     or new.micro_amount_cents is distinct from old.micro_amount_cents or new.created_by", "     or new.created_by"),
    ("ver-final-off", "  if old.status in ('passed', 'failed', 'cancelled') then\n    raise exception 'ACH_VERIFICATION_FINAL: verification % is % and cannot change.'", "  if false then\n    raise exception 'ACH_VERIFICATION_FINAL: verification % is % and cannot change.'"),
    ("ver-planned-pass", "                               else array['sent', 'cancelled'] end", "                               else array['sent', 'cancelled', 'passed'] end"),
    ("ver-dates-mutable", "  elsif old.status = 'sent' and (new.effective_date", "  elsif false and (new.effective_date"),
    ("ver-amount-any", "     and new.payee_confirmed_cents is distinct from new.micro_amount_cents then", "     and false then"),
    ("ver-early-ok", "     and (new.eligible_on is null or new.eligible_on > (now() at time zone 'America/Los_Angeles')::date) then", "     and (new.eligible_on is null) then"),
    # notice_log
    ("log-actor-optional", "    raise exception 'ACH_NOTICE_ACTOR: who logged", "    raise notice 'ACH_NOTICE_ACTOR: who logged"),
    ("log-code-any", "  if p_code is null or p_code !~ '^[RC][0-9]{2}$' then", "  if p_code is null then"),
    ("log-future-ok", "  if p_received_on is null or p_received_on > today or p_received_on < today - 400 then", "  if p_received_on is null or p_received_on < today - 400 then"),
    ("log-old-ok", "  if p_received_on is null or p_received_on > today or p_received_on < today - 400 then", "  if p_received_on is null or p_received_on > today then"),
    ("log-settle-after-ok", "  if p_settlement_date is not null and p_settlement_date > p_received_on then", "  if false then"),
    ("log-noc-no-applyby", "  if kind = 'noc' and (p_corrected_enc is null or p_apply_by is null or p_apply_by < p_received_on) then", "  if kind = 'noc' and (p_corrected_enc is null) then"),
    ("log-return-corrected", "  if kind = 'return' and (p_corrected_enc is not null or p_apply_by is not null) then", "  if false then"),
    ("log-reason-short", "  if coalesce(length(trim(p_hold_reason)), 0) < 10 then\n    raise exception 'ACH_NOTICE_REASON", "  if coalesce(length(trim(p_hold_reason)), 0) < 1 then\n    raise exception 'ACH_NOTICE_REASON"),
    ("log-emp-missing-ok", "    perform 1 from public.employees where id = p_payee_id;\n    if not found then", "    perform 1 from public.employees where id = p_payee_id;\n    if false then"),
    ("log-no-emp-hold", "      elsif a.state in ('signed', 'verifying', 'active') then", "      elsif false then"),
    ("log-no-hold-author", "               hold_entered_by = p_actor, hold_entered_at = now(), updated_by = p_actor", "               hold_entered_by = null, hold_entered_at = now(), updated_by = p_actor"),
    ("log-no-vault-hold", "      elsif vb.status = 'active' then", "      elsif false then"),
    ("log-vault-same-reason", "                                  else left(trim(p_hold_reason), 470) || to_char(now() at time zone 'America/Los_Angeles', ' (YYYY-MM-DD HH24:MI:SS)') end,", "                                  else left(trim(p_hold_reason), 500) end,"),
    ("log-ver-any-payee", "    if p_payee_type <> 'employee' or a.id is null or acct.authorization_id is distinct from a.id then", "    if a.id is null then"),
    ("log-ver-any-status", "    if v.status <> 'sent' then\n      raise exception 'ACH_NOTICE_VERIFICATION", "    if false then\n      raise exception 'ACH_NOTICE_VERIFICATION"),
    ("log-ver-not-failed", "       set status = 'failed', result_code = p_code,", "       set status = 'cancelled', result_code = p_code,"),
    ("log-acct-not-failed", "       set verification_status = 'failed', verification_method = null, verified_at = null, verified_by = null", "       set verification_status = 'unverified', verification_method = null, verified_at = null, verified_by = null"),
    ("log-kind-wrong-event", "case when kind = 'noc' then 'noc_logged' else 'return_logged' end", "'return_logged'"),
    ("log-event-cipher", "                             'corrected_last4', p_corrected_last4));", "                             'corrected_last4', p_corrected_last4, 'corrected', p_corrected_enc));"),
    # resolve
    ("res-note-short", "    raise exception 'ACH_NOTICE_REASON: say what was done", "    raise notice 'ACH_NOTICE_REASON: say what was done"),
    ("res-twice", "  if n.resolved_at is not null then\n    raise exception 'ACH_NOTICE_FINAL: notice % is already resolved.'", "  if false then\n    raise exception 'ACH_NOTICE_FINAL: notice % is already resolved.'"),
    ("res-raw-row", "  if n.payee_type is null then", "  if false then"),
    ("res-no-event", "'notice_resolved', p_actor,", "'notice_noted', p_actor,"),
    # release
    ("rel-vendor", "  if a.payee_type <> 'employee' then\n    raise exception 'ACH_RELEASE_PAYEE", "  if false then\n    raise exception 'ACH_RELEASE_PAYEE"),
    ("rel-any-state", "  if a.state <> 'on_hold' then\n    raise exception 'ACH_RELEASE_STATE", "  if false then\n    raise exception 'ACH_RELEASE_STATE"),
    ("rel-any-method", "  if p_method is null or p_method not in ('phone', 'in_person') then", "  if p_method is null then"),
    ("rel-note-short", "    raise exception 'ACH_RELEASE_CALLBACK: write a callback note", "    raise notice 'ACH_RELEASE_CALLBACK: write a callback note"),
    ("rel-unknown-dual", "  is_solo := a.hold_entered_by is null or a.hold_entered_by = p_actor;", "  is_solo := a.hold_entered_by = p_actor;"),
    ("rel-solo-short", "  if is_solo and coalesce(length(trim(p_reason)), 0) < 20 then", "  if is_solo and coalesce(length(trim(p_reason)), 0) < 10 then"),
    ("rel-always-active", "  next_state := case when live > 0 and unverified = 0 then 'active' else 'verifying' end;", "  next_state := 'active';"),
    ("rel-solo-event", "case when is_solo then 'hold_released_solo' else 'hold_released' end", "'hold_released'"),
    # verification functions
    ("start-any-method", "  if p_method is null or p_method not in ('prenote', 'micro_entry', 'voided_check_callback') then", "  if p_method is null then"),
    ("start-reverify", "  if acct.verification_status = 'verified' then", "  if false then"),
    ("start-active-ok", "  if a.state not in ('signed', 'verifying') then\n    raise exception 'ACH_VERIFICATION_STATE: the authorization is %; only", "  if a.state not in ('signed', 'verifying', 'active', 'on_hold') then\n    raise exception 'ACH_VERIFICATION_STATE: the authorization is %; only"),
    ("start-no-pending", "  update public.ach_authorization_accounts set verification_status = 'pending' where id = acct.id;", ""),
    ("start-no-verifying", "    update public.ach_authorizations set state = 'verifying', updated_by = p_actor where id = a.id;", "    null;"),
    ("sent-dates-any", "     or p_settlement < p_effective or p_eligible <= p_settlement then", "     then"),
    ("sent-null-ok", "  if p_effective is null or p_settlement is null or p_eligible is null\n", "  if false\n"),
    ("sent-callback-ok", "    if v.status <> 'planned' or v.method = 'voided_check_callback' then", "    if v.status <> 'planned' then"),
    ("sent-micro-eligible", "       eligible_on = case when v.method = 'prenote' then p_eligible else p_settlement + 1 end", "       eligible_on = p_eligible"),
    ("sent-count-ok", "  if n <> cardinality(p_ids) then", "  if false then"),
    ("fin-final-ok", "  if v.status in ('passed', 'failed', 'cancelled') then\n    raise exception 'ACH_VERIFICATION_FINAL: verification % is already %.'", "  if false then\n    raise exception 'ACH_VERIFICATION_FINAL: verification % is already %.'"),
    ("fin-hold-ok", "    if a.state not in ('signed', 'verifying') then\n      raise exception 'ACH_VERIFICATION_STATE: the authorization is %; release", "    if false then\n      raise exception 'ACH_VERIFICATION_STATE: the authorization is %; release"),
    ("fin-callback-no-note", "    if v.method = 'voided_check_callback' and coalesce(length(trim(p_note)), 0) < 10 then", "    if false then"),
    ("fin-active-early", "    if left_unverified = 0 then", "    if left_unverified <= 1 then"),
    ("fin-no-review", "             annual_review_due_on = coalesce(a.annual_review_due_on, (today + interval '1 year')::date)", "             annual_review_due_on = a.annual_review_due_on"),
    ("fin-cancel-failed", "       set verification_status = case when p_outcome = 'failed' then 'failed' else 'unverified' end", "       set verification_status = 'failed'"),
    ("fin-no-verifier", "verified_at = now(), verified_by = p_actor", "verified_at = now(), verified_by = null"),
    # legal hold / review
    ("lh-reason-short", "    raise exception 'ACH_LEGAL_HOLD: give the reason", "    raise notice 'ACH_LEGAL_HOLD: give the reason"),
    ("lh-repeat-ok", "  if a.legal_hold = p_on then", "  if false then"),
    ("lh-off-keeps-reason", "legal_hold_reason = case when p_on then left(trim(p_reason), 500) else null end", "legal_hold_reason = left(trim(p_reason), 500)"),
    ("lh-no-prev", "'previous_reason', a.legal_hold_reason", "'previous_reason', null"),
    ("rv-any-state", "  if not found or a.state <> 'active' then\n    raise exception 'ACH_REVIEW: only", "  if not found then\n    raise exception 'ACH_REVIEW: only"),
    ("rv-note-short", "    raise exception 'ACH_REVIEW: say what was checked", "    raise notice 'ACH_REVIEW: say what was checked"),
    ("rv-no-prev", "'previous_due', a.annual_review_due_on", "'previous_due', nxt"),
    # privileges
    ("grant-authenticated", "grant execute on function public.ach_notice_log(uuid, text, uuid, text, date, date, bigint, text, text, text, date, text, uuid) to service_role;", "grant execute on function public.ach_notice_log(uuid, text, uuid, text, date, date, bigint, text, text, text, date, text, uuid) to service_role, authenticated;"),
    ("no-service-grant", "grant execute on function public.ach_auth_review_done(uuid, uuid, text) to service_role;", ""),
    ("definer", "  p_reason  text\n) returns text\nlanguage plpgsql\n", "  p_reason  text\n) returns text\nlanguage plpgsql\nsecurity definer\n"),
    ("no-search-path", "  p_micro_cents integer\n) returns uuid\nlanguage plpgsql\nset search_path = public, pg_temp\n", "  p_micro_cents integer\n) returns uuid\nlanguage plpgsql\n"),
]

src = open(MIG).read()
if psql_file(RB).returncode or psql_file(MIG).returncode:
    sys.exit("reset failed")
if psql_file(TEST).returncode:
    sys.exit("CONTROL FAILED")
print("CONTROL pass", flush=True)
names = [m[0] for m in M]
assert len(names) == len(set(names)), "duplicate mutant names"
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
