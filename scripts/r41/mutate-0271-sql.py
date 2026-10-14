#!/usr/bin/env python3
"""scripts/r41/mutate-0271-sql.py - test the 0271 scenario checks (R41 S0 owner authority).

Each mutant weakens ONE guard in 0271. For each one:
  1. roll 0271 back (safe: every check rolls itself back, so no used rows exist);
  2. apply the mutated file;
  3. run the 0271 check (and the 0259 / 0262 / 0263 checks, which now encode
     owner releases);
  4. expect at least one of them to FAIL.
The real 0271 is re-applied at the end and every control re-run.

    PGURL='postgres://postgres@/greenway?host=/tmp/pgsock&port=5433' python3 scripts/r41/mutate-0271-sql.py
"""
import os, subprocess, sys

PGURL = os.environ.get("PGURL") or sys.exit("set PGURL to a database with every migration applied")
MIG = "supabase/migrations/0271_ach_owner_authority.sql"
RB = "supabase/rollbacks/0271_ach_owner_authority.rollback.sql"
TESTS = [
    "scripts/recon/ach-owner-authority-0271-pg-check.sql",
    "scripts/recon/vendor-vault-0259-pg-check.sql",
    "scripts/recon/vendor-esign-0262-pg-check.sql",
    "scripts/recon/ach-ops-0263-pg-check.sql",
    "scripts/recon/ach-authorizations-pg-check.sql",
]
TMP = "/tmp/mut0271.sql"

def psql_file(path):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", path], capture_output=True, text=True)

def any_check_fails():
    return any(psql_file(t).returncode for t in TESTS)

M = [
    # helpers
    ("owner-is-admin", "     where id = p_actor and active = true and role = 'owner'", "     where id = p_actor and active = true and role in ('owner', 'admin')"),
    ("owner-inactive-ok", "     where id = p_actor and active = true and role = 'owner'", "     where id = p_actor and role = 'owner'"),
    ("jwt-ignored", "  select public.ach_actor_is_owner(p_stamped)\n     and (auth.uid() is null or public.ach_actor_is_owner(auth.uid()));", "  select public.ach_actor_is_owner(p_stamped);"),
    ("helper-grant-anon", "revoke all on function public.ach_actor_is_owner(uuid) from public, anon;", "grant execute on function public.ach_actor_is_owner(uuid) to anon;"),
    # vendor vault
    ("mode-any", "  check (release_mode is null or release_mode in ('dual', 'solo', 'owner'));", "  check (true);"),
    ("vault-verify-anyone", "     and not public.ach_write_by_owner(new.updated_by) then\n    raise exception 'ACH_OWNER_ONLY: only the owner marks vendor banking verified.", "     and false then\n    raise exception 'ACH_OWNER_ONLY: only the owner marks vendor banking verified."),
    ("vault-release-anyone", "    if not public.ach_write_by_owner(new.released_by) then", "    if false then"),
    ("vault-release-no-callback", "    if new.release_callback_method is null or coalesce(length(trim(new.release_callback_note)), 0) < 10 then", "    if false then"),
    ("vault-release-short-note", "    if new.release_callback_method is null or coalesce(length(trim(new.release_callback_note)), 0) < 10 then", "    if new.release_callback_method is null or coalesce(length(trim(new.release_callback_note)), 0) < 1 then"),
    ("vault-release-any-mode", "    if new.release_mode is distinct from 'owner' then", "    if false then"),
    ("vault-release-stale-stamp", "       or (old.released_at is not null and new.released_at <= old.released_at) then", "       then"),
    ("vault-archive-anyone", "    if not public.ach_write_by_owner(new.archived_by) then", "    if false then"),
    ("vault-delete-ok", "  if tg_op = 'DELETE' then\n    raise exception 'VAULT_ARCHIVE_ONLY", "  if false then\n    raise exception 'VAULT_ARCHIVE_ONLY"),
    ("vault-change-not-held", "    new.status := 'on_hold';\n    new.change_entered_by", "    new.change_entered_by"),
    ("vault-archived-reopen", "  if old.status = 'archived' and new.status <> 'on_hold' then", "  if false then"),
    # employees
    ("emp-no-stamp-ok", "  if new.bank_changed_at is null\n     or (tg_op = 'UPDATE' and new.bank_changed_at is not distinct from old.bank_changed_at) then", "  if false then"),
    ("emp-stale-stamp-ok", "     or (tg_op = 'UPDATE' and new.bank_changed_at is not distinct from old.bank_changed_at) then", "     then"),
    ("emp-anyone", "  if not public.ach_write_by_owner(new.bank_changed_by) then", "  if false then"),
    ("emp-type-free", "    and new.bank_account_type is not distinct from old.bank_account_type then\n    return new;", "    then\n    return new;"),
    ("emp-insert-free", "    if new.bank_routing is null and new.bank_account_number is null and new.bank_account_type is null then\n      return new;\n    end if;", "    return new;"),
    # company settings
    ("co-anyone", "  if not public.ach_write_by_owner(new.updated_by) then\n    raise exception 'ACH_OWNER_ONLY: only the owner changes the company", "  if false then\n    raise exception 'ACH_OWNER_ONLY: only the owner changes the company"),
    ("co-trigger-off", "create trigger trg_ach_company_settings_owner_guard\n  before update on public.ach_company_settings", "create trigger trg_ach_company_settings_owner_guard\n  before delete on public.ach_company_settings"),
    # authorizations / accounts
    ("auth-active-anyone", "     and not public.ach_write_by_owner(coalesce(new.updated_by, case when tg_op = 'INSERT' then new.created_by end)) then", "     and false then"),
    ("acct-verified-anyone", "     and not public.ach_write_by_owner(new.verified_by) then", "     and false then"),
    # employee hold release
    ("rel-anyone", "  if not public.ach_write_by_owner(p_actor) then\n    raise exception 'ACH_OWNER_ONLY: only the owner releases an employee", "  if false then\n    raise exception 'ACH_OWNER_ONLY: only the owner releases an employee"),
    ("rel-old-event", "'hold_released_owner', p_actor,", "'hold_released', p_actor,"),
    ("rel-returns-dual", "  return 'owner';\nend $$;", "  return 'dual';\nend $$;"),
    # D-5
    ("d5-storage-manager", "  for insert with check (bucket_id = 'ach-docs' and public.is_admin());", "  for insert with check (bucket_id = 'ach-docs' and public.is_manager());"),
    ("d5-docs-manager", "  for insert with check (\n    public.is_admin()\n    and intake_status = 'received'", "  for insert with check (\n    public.is_manager()\n    and intake_status = 'received'"),
    ("d5-events-manager", "  for insert with check (public.is_admin());", "  for insert with check (public.is_manager());"),
    # requests
    ("req-delete-ok", "  if tg_op = 'DELETE' then\n    raise exception 'ACH_REQUEST_KEEP", "  if false then\n    raise exception 'ACH_REQUEST_KEEP"),
    ("req-start-approved", "    if new.status <> 'pending' then\n      raise exception 'ACH_REQUEST_TRANSITION", "    if false then\n      raise exception 'ACH_REQUEST_TRANSITION"),
    ("req-payload-mutable", "or new.payload_enc is distinct from old.payload_enc", "or false"),
    ("req-summary-mutable", "     or new.summary is distinct from old.summary or new.reason is distinct from old.reason", "     or new.reason is distinct from old.reason"),
    ("req-reopen", "    if old.status <> 'pending' then\n      raise exception 'ACH_REQUEST_FINAL: request % is % and cannot change.'", "    if false then\n      raise exception 'ACH_REQUEST_FINAL: request % is % and cannot change.'"),
    ("req-withdraw-anyone", "      if new.decided_by is distinct from old.requested_by then", "      if false then"),
    ("req-raw-approve-anyone", "    elsif not public.ach_write_by_owner(new.decided_by) then\n      raise exception 'ACH_OWNER_ONLY: only the owner approves, rejects or supersedes request %.'", "    elsif false then\n      raise exception 'ACH_OWNER_ONLY: only the owner approves, rejects or supersedes request %.'"),
    ("req-result-rewrite", "  if (old.applied_at is not null or old.apply_error is not null)\n", "  if false\n"),
    ("req-events-mutable", "  before update or delete on public.ach_change_request_events", "  before delete on public.ach_change_request_events"),
    ("decide-actor-optional", "    raise exception 'ACH_REQUEST_ACTOR: who decided", "    raise notice 'ACH_REQUEST_ACTOR: who decided"),
    ("decide-any-decision", "  if p_decision is null or p_decision not in ('approved', 'rejected', 'withdrawn', 'superseded') then", "  if p_decision is null then"),
    ("decide-final-ok", "  if r.status <> 'pending' then\n    raise exception 'ACH_REQUEST_FINAL: request % is already %.'", "  if false then\n    raise exception 'ACH_REQUEST_FINAL: request % is already %.'"),
    ("decide-withdraw-anyone", "    if p_actor is distinct from r.requested_by then", "    if false then"),
    ("decide-admin-approves", "  elsif not public.ach_write_by_owner(p_actor) then\n    raise exception 'ACH_OWNER_ONLY: only the owner approves, rejects or supersedes a request.'", "  elsif false then\n    raise exception 'ACH_OWNER_ONLY: only the owner approves, rejects or supersedes a request.'"),
    ("decide-stale-off", "  if p_decision = 'approved' and r.base_version is not null and r.base_version is distinct from p_current_version then", "  if false then"),
    ("decide-stale-null-ok", "r.base_version is distinct from p_current_version then", "r.base_version <> p_current_version then"),
    ("decide-no-event", "  values (r.id, p_decision, p_actor,", "  values (r.id, 'decided', p_actor,"),
    ("result-anyone", "  if not public.ach_write_by_owner(p_actor) then\n    raise exception 'ACH_OWNER_ONLY: only the owner records", "  if false then\n    raise exception 'ACH_OWNER_ONLY: only the owner records"),
    ("result-both", "  if (p_ref is null) = (p_error is null) then", "  if false then"),
    ("result-not-approved", "  if r.status <> 'approved' or r.decided_by is distinct from p_actor then", "  if false then"),
    ("result-other-owner", "  if r.status <> 'approved' or r.decided_by is distinct from p_actor then", "  if r.status <> 'approved' then"),
    # reviews
    ("rev-delete-ok", "  if tg_op = 'DELETE' then\n    raise exception 'ACH_REVIEW_KEEP", "  if false then\n    raise exception 'ACH_REVIEW_KEEP"),
    ("rev-start-checked", "    if new.checked_off_at is not null then\n      raise exception 'ACH_REVIEW_FINAL: a new", "    if false then\n      raise exception 'ACH_REVIEW_FINAL: a new"),
    ("rev-outcome-mutable", "     or new.summary is distinct from old.summary or new.outcome is distinct from old.outcome\n     or new.done_by", "     or new.summary is distinct from old.summary\n     or new.done_by"),
    ("rev-recheck", "  if old.checked_off_at is not null then\n    raise exception 'ACH_REVIEW_FINAL: review item % is already", "  if false then\n    raise exception 'ACH_REVIEW_FINAL: review item % is already"),
    ("rev-admin-checks", "  if new.checked_off_at is not null and not public.ach_write_by_owner(new.checked_off_by) then", "  if false then"),
    # privileges
    ("rls-off", "alter table public.ach_change_requests       enable row level security;", ""),
    ("grant-authenticated", "revoke all on table public.ach_change_requests, public.ach_change_request_events, public.ach_owner_reviews from anon, authenticated;", "grant select on table public.ach_change_requests, public.ach_change_request_events, public.ach_owner_reviews to authenticated;"),
    ("service-delete", "revoke delete on table public.ach_change_requests, public.ach_change_request_events, public.ach_owner_reviews from service_role;", "grant delete on table public.ach_change_requests, public.ach_change_request_events, public.ach_owner_reviews to service_role;"),
    ("decide-authenticated", "revoke all on function public.ach_request_decide(uuid, uuid, text, text, text) from public, anon, authenticated;", "grant execute on function public.ach_request_decide(uuid, uuid, text, text, text) to authenticated;"),
]

src = open(MIG).read()
if psql_file(RB).returncode or psql_file(MIG).returncode:
    sys.exit("reset failed")
if any_check_fails():
    sys.exit("CONTROL FAILED")
print("CONTROL pass", flush=True)
names = [m[0] for m in M]
assert len(names) == len(set(names)), "duplicate mutant names"
killed, surv = 0, []
for name, old, new in M:
    if src.count(old) != 1:
        print(f"ANCHOR {src.count(old)} {name}", flush=True); surv.append(name); continue
    open(TMP, "w").write(src.replace(old, new, 1))
    r = psql_file(RB)
    if r.returncode:
        print(f"ROLLBACK FAIL {name}: {r.stderr.strip()[:200]}", flush=True); surv.append(name); break
    if psql_file(TMP).returncode:
        print(f"APPLY FAIL {name}", flush=True); surv.append(name); continue
    if any_check_fails():
        killed += 1; print(f"killed   {name}", flush=True)
    else:
        surv.append(name); print(f"SURVIVED {name}", flush=True)
psql_file(RB)
assert psql_file(MIG).returncode == 0
assert not any_check_fails(), "control after restore failed"
print(f"control restored; killed {killed}/{len(M)} survivors {surv}")
