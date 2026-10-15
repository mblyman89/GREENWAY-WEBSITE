#!/usr/bin/env python3
"""scripts/r41/mutate-0274-sql.py - test the 0274 scenario check (R41 S6 bank steps).

Each mutant weakens ONE rule in 0274. For each one:
  1. roll 0274 back (puts the 0273 guard back and drops the two functions;
     no table is dropped, so it is always safe on the test database);
  2. apply the mutated migration text (from a temp file; the repo file is
     never written);
  3. run scripts/recon/ach-file-bank-steps-0274-pg-check.sql;
  4. expect it to FAIL (or the mutated migration not to apply).
The real 0274 is re-applied first (control) and last (control) and the check
must print "ACH 0274 CHECK PASSED" both times. The 0273 check must also still
pass at the end (0274 replaced its guard).

    PGURL='postgres://postgres:postgres@localhost:5432/r41s2' python3 scripts/r41/mutate-0274-sql.py
"""
import os
import subprocess
import sys

PGURL = os.environ.get("PGURL") or sys.exit("set PGURL to a database with every migration applied")
MIG = "supabase/migrations/0274_ach_file_bank_steps.sql"
RB = "supabase/rollbacks/0274_ach_file_bank_steps.rollback.sql"
CHECK = "scripts/recon/ach-file-bank-steps-0274-pg-check.sql"
CHECK_0273 = "scripts/recon/ach-files-0273-pg-check.sql"
TMP = "/tmp/mut0274.sql"


def psql_file(path):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", path], capture_output=True, text=True)


def control(label):
    r = psql_file(RB)
    ap = psql_file(MIG)
    ck = psql_file(CHECK)
    c3 = psql_file(CHECK_0273)
    ok = (
        r.returncode == 0 and ap.returncode == 0 and ck.returncode == 0 and c3.returncode == 0
        and "ACH 0274 CHECK PASSED" in (ck.stdout + ck.stderr)
        and "ACH 0273 CHECK PASSED" in (c3.stdout + c3.stderr)
    )
    print(f"control ({label})", "pass" if ok else f"FAILED rb={r.returncode} apply={ap.returncode} check={ck.returncode} c3={c3.returncode} {(ck.stderr or c3.stderr or ap.stderr or r.stderr)[-300:]}", flush=True)
    return ok


M = [
    # --- the functions ---
    ("upload-from-any-status", "  if f.status <> 'released' then\n    raise exception 'ACH_FILE_TRANSITION: ACH file % is %, not released", "  if false then\n    raise exception 'ACH_FILE_TRANSITION: ACH file % is %, not released"),
    ("approve-from-any-status", "  if f.status <> 'uploaded' then\n    raise exception 'ACH_FILE_TRANSITION: ACH file % is %, not uploaded", "  if false then\n    raise exception 'ACH_FILE_TRANSITION: ACH file % is %, not uploaded"),
    ("upload-no-stamp", "     set status = 'uploaded', uploaded_by = p_actor, uploaded_at = now()", "     set status = 'uploaded', uploaded_by = (select released_by from public.ach_files where id = p_file_id), uploaded_at = now()"),
    ("approve-wrong-kind", "     set status = 'bank_approved', approved_at_bank_by = p_actor, approved_at_bank_at = now()\n   where id = p_file_id;\n  return f.kind;", "     set status = 'bank_approved', approved_at_bank_by = p_actor, approved_at_bank_at = now()\n   where id = p_file_id;\n  return 'payroll';"),
    ("not-found-silent", "  select * into f from public.ach_files where id = p_file_id for update;\n  if not found then\n    raise exception 'ACH_FILE_NOT_FOUND: ACH file %.', p_file_id using errcode = 'check_violation';\n  end if;\n  if f.status <> 'released'", "  select * into f from public.ach_files where id = p_file_id for update;\n  if not found then\n    return null;\n  end if;\n  if f.status <> 'released'"),
    # --- the guard: owner ---
    ("admin-may-upload", "    if not public.ach_actor_is_owner(new.uploaded_by) then", "    if false then"),
    ("admin-may-approve", "    if not public.ach_actor_is_owner(new.approved_at_bank_by) then", "    if false then"),
    ("admin-may-void", "    if not public.ach_actor_is_owner(new.voided_by) then", "    if false then"),
    ("admin-may-release", "    if not public.ach_actor_is_owner(new.released_by) then", "    if false then"),
    # --- the guard: set once, with its step ---
    ("uploaded-by-may-change", "  if (old.uploaded_by is not null and new.uploaded_by is distinct from old.uploaded_by)\n     or", "  if false\n     or"),
    ("uploaded-at-may-change", "     or (old.uploaded_at is not null and new.uploaded_at is distinct from old.uploaded_at)\n", "\n"),
    ("approved-by-may-change", "     or (old.approved_at_bank_by is not null and new.approved_at_bank_by is distinct from old.approved_at_bank_by)\n", "\n"),
    ("upload-stamp-without-step", "    if not (old.status = 'released' and new.status = 'uploaded') then\n      raise exception 'ACH_BANK_STEP: the upload is recorded", "    if false then\n      raise exception 'ACH_BANK_STEP: the upload is recorded"),
    ("approve-stamp-without-step", "    if not (old.status = 'uploaded' and new.status = 'bank_approved') then\n      raise exception 'ACH_BANK_STEP: the bank approval", "    if false then\n      raise exception 'ACH_BANK_STEP: the bank approval"),
    ("approve-without-upload", "    if new.uploaded_by is null then\n      raise exception 'ACH_BANK_STEP: ACH file % has no upload recorded", "    if false then\n      raise exception 'ACH_BANK_STEP: ACH file % has no upload recorded"),
    ("insert-pre-stamped", "    if new.uploaded_by is not null or new.uploaded_at is not null\n       or new.approved_at_bank_by is not null or new.approved_at_bank_at is not null then", "    if false then"),
    # --- 0273 rules the replaced guard must keep ---
    ("delete-allowed", "  if tg_op = 'DELETE' then\n    raise exception 'ACH_FILE_KEEP", "  if false then\n    raise exception 'ACH_FILE_KEEP"),
    ("voided-may-change", "  if old.status = 'voided' then\n    raise exception 'ACH_FILE_FINAL", "  if false then\n    raise exception 'ACH_FILE_FINAL"),
    ("totals-may-change", " or new.total_cents <> old.total_cents\n", "\n"),
    ("backwards-ok", "      raise exception 'ACH_FILE_TRANSITION: % -> % is not allowed.', old.status, new.status;", "      null;"),
    # --- grants ---
    ("browser-may-upload", "revoke all on function public.ach_file_mark_uploaded(uuid, uuid) from public, anon, authenticated;", "grant execute on function public.ach_file_mark_uploaded(uuid, uuid) to authenticated;"),
    ("browser-may-approve", "revoke all on function public.ach_file_mark_bank_approved(uuid, uuid) from public, anon, authenticated;", "grant execute on function public.ach_file_mark_bank_approved(uuid, uuid) to authenticated;"),
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
    # A grant mutant must not leak into the next one: the rollback drops the functions.

assert open(MIG).read() == src
ctl = control("after")
print(f"total {len(M)} killed {len(M) - len(surv)} survivors {surv}")
sys.exit(1 if surv or not ctl else 0)
