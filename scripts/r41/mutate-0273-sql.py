#!/usr/bin/env python3
"""scripts/r41/mutate-0273-sql.py - test the 0273 scenario check (R41 S3 ach_files).

Each mutant weakens ONE rule in 0273. For each one:
  1. roll 0273 back (safe on the test database: the check rolls itself back,
     so ach_files is empty and the rollback's refusal does not fire);
  2. apply the mutated migration text (from a temp file; the repo file is
     never written);
  3. run scripts/recon/ach-files-0273-pg-check.sql;
  4. expect it to FAIL (or the mutated migration not to apply).
The real 0273 is re-applied first (control) and last (control) and the check
must print "ACH 0273 CHECK PASSED" both times.

    PGURL='postgres://postgres:postgres@localhost:5432/r41s2' python3 scripts/r41/mutate-0273-sql.py
"""
import os
import subprocess
import sys

PGURL = os.environ.get("PGURL") or sys.exit("set PGURL to a database with every migration applied")
MIG = "supabase/migrations/0273_ach_files.sql"
RB = "supabase/rollbacks/0273_ach_files.rollback.sql"
CHECK = "scripts/recon/ach-files-0273-pg-check.sql"
TMP = "/tmp/mut0273.sql"


def psql_file(path):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", path], capture_output=True, text=True)


def control(label):
    r = psql_file(RB)
    ap = psql_file(MIG)
    ck = psql_file(CHECK)
    ok = r.returncode == 0 and ap.returncode == 0 and ck.returncode == 0 and "ACH 0273 CHECK PASSED" in (ck.stdout + ck.stderr)
    print(f"control ({label})", "pass" if ok else f"FAILED rb={r.returncode} apply={ap.returncode} check={ck.returncode} {(ck.stderr or ap.stderr or r.stderr)[-300:]}", flush=True)
    return ok


M = [
    # --- the plan's: duplicate check removed ---
    ("no-duplicate-entries-index", "create unique index if not exists ach_files_no_duplicate_entries\n  on public.ach_files (entry_set_hmac, effective_date) where status <> 'voided';",
     "create index if not exists ach_files_no_duplicate_entries\n  on public.ach_files (entry_set_hmac, effective_date) where status <> 'voided';"),
    ("duplicate-index-counts-voided", "on public.ach_files (entry_set_hmac, effective_date) where status <> 'voided';", "on public.ach_files (entry_set_hmac, effective_date);"),
    ("no-sha-index", "create unique index if not exists ach_files_sha_live\n  on public.ach_files (sha256)", "create index if not exists ach_files_sha_live\n  on public.ach_files (sha256)"),
    ("no-one-live-per-source", "create unique index if not exists ach_files_one_live_per_source", "create index if not exists ach_files_one_live_per_source"),
    ("no-day-modifier-key", "alter table public.ach_files add constraint ach_files_day_modifier_key unique (file_date, file_id_modifier);", ""),
    ("modifier-lowercase-ok", "check (file_id_modifier ~ '^[A-Z0-9]$')", "check (file_id_modifier ~ '^[A-Za-z0-9]$')"),
    ("plain-body-ok", "check (body_enc like 'encv1:%')", "check (body_enc <> '')"),
    ("prenote-counts", "constraint ach_files_kind_limit check (counts_toward_limit = (kind <> 'prenote')),", ""),
    ("void-reason-short-ok", "(voided_reason is null or length(trim(voided_reason)) between 10 and 500)", "(voided_reason is null or length(trim(voided_reason)) between 1 and 500)"),
    # --- the guard ---
    ("delete-allowed", "  if tg_op = 'DELETE' then\n    raise exception 'ACH_FILE_KEEP", "  if false then\n    raise exception 'ACH_FILE_KEEP"),
    ("admin-may-release", "    if not public.ach_actor_is_owner(new.released_by) then", "    if false then"),
    ("admin-may-void", "    if not public.ach_actor_is_owner(new.voided_by) then", "    if false then"),
    ("voided-may-change", "  if old.status = 'voided' then\n    raise exception 'ACH_FILE_FINAL", "  if false then\n    raise exception 'ACH_FILE_FINAL"),
    ("body-may-change", " or new.body_enc <> old.body_enc\n", "\n"),
    ("letter-may-change", "     or new.file_date <> old.file_date or new.file_id_modifier <> old.file_id_modifier\n", "     or new.file_date <> old.file_date\n"),
    ("totals-may-change", " or new.total_cents <> old.total_cents\n", "\n"),
    ("backwards-ok", "      raise exception 'ACH_FILE_TRANSITION: % -> % is not allowed.', old.status, new.status;", "      null;"),
    ("insert-any-status", "      raise exception 'ACH_FILE_TRANSITION: a new ACH file starts as released, not %.', new.status;", "      null;"),
    ("guard-on-insert-only", "  before insert or update or delete on public.ach_files", "  before insert on public.ach_files"),
    # --- release payroll ---
    ("payroll-any-status", "  if r.status <> 'draft' then\n    raise exception 'ACH_FILE_ALREADY_RELEASED", "  if false then\n    raise exception 'ACH_FILE_ALREADY_RELEASED"),
    ("payroll-no-stamp", "     set status = 'file_generated',\n         nacha_filename = p_filename,", "     set nacha_filename = p_filename,"),
    ("payroll-approver-not-actor", "         approved_by = p_actor,", "         approved_by = r.approved_by,"),
    ("payroll-override-kept", "guardrail_override_by = case when coalesce(p_override, false) then p_actor else null end,", "guardrail_override_by = case when coalesce(p_override, false) then p_actor else r.guardrail_override_by end,"),
    # --- void ---
    ("void-run-stays", "    update public.payroll_runs\n       set status = 'draft', updated_by = p_actor\n     where id::text = f.source_id and status = 'file_generated';", "    null;"),
    ("void-touches-every-run", "     where id::text = f.source_id and status = 'file_generated';", "     where status = 'file_generated';"),
    ("void-wrong-kind", "  return f.kind;", "  return 'payroll';"),
    # --- 0271 target, grants ---
    ("target-not-admitted", "                         'company', 'vendor_payment', 'ach_file'));", "                         'company', 'vendor_payment'));"),
    ("server-may-delete", "revoke delete on table public.ach_files from service_role;", ""),
    ("browser-may-write", "grant select on table public.ach_files to authenticated;", "grant select, insert, update on table public.ach_files to authenticated;"),
    ("rls-off", "alter table public.ach_files enable row level security;", ""),
]

src = open(MIG).read()
if not control("before"):
    sys.exit(2)
surv = []
for name, a, b in M:
    if src.count(a) != 1:
        print(f"ANCHOR count={src.count(a)} {name}", flush=True)
        surv.append(name)
        continue
    r = psql_file(RB)
    if r.returncode:
        sys.exit(f"rollback failed before {name}: {r.stderr}")
    # A mutant that leaves grants behind (browser-may-write) must not leak into the next one.
    subprocess.run(["psql", PGURL, "-X", "-q", "-c", "drop table if exists public.ach_files cascade"], capture_output=True)
    open(TMP, "w").write(src.replace(a, b, 1))
    ap = psql_file(TMP)
    if ap.returncode:
        print(f"killed   {name}  (mutated migration did not apply: {ap.stderr.strip().splitlines()[-1][:120]})", flush=True)
        continue
    ck = psql_file(CHECK)
    k = ck.returncode != 0
    why = (ck.stderr.strip().splitlines() or ["-"])[-1][:140]
    print(f"{'killed  ' if k else 'SURVIVED'} {name}  ({why if k else 'check passed'})", flush=True)
    if not k:
        surv.append(name)

assert open(MIG).read() == src
ctl = control("after")
print(f"total {len(M)} killed {len(M) - len(surv)} survivors {surv}")
sys.exit(1 if surv or not ctl else 0)
