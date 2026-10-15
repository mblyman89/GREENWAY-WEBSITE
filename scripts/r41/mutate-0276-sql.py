#!/usr/bin/env python3
"""scripts/r41/mutate-0276-sql.py - test the 0276 scenario check (R41 S9 funding confirmation).

Each mutant weakens ONE rule in 0276. For each one:
  1. roll 0276 back (puts the 0274 guard back and drops the funding function;
     no table is dropped, so it is always safe on the test database);
  2. apply the mutated migration text (from a temp file; the repo file is
     never written);
  3. run scripts/recon/ach-file-funding-0276-pg-check.sql;
  4. expect it to FAIL (or the mutated migration not to apply).
The real 0276 is re-applied first (control) and last (control) and the check
must print "ACH 0276 CHECK PASSED" both times. The 0273 and 0274 checks must
also still pass (0276 replaced their guard).

Where the function and the guard raise the same words, the mutant is chosen so
the check can still tell them apart (a null actor or amount slips past the
guard's comparison; the function's "already confirmed" wording is pinned).

    PGURL='postgres://postgres:postgres@localhost:5432/greenway' python3 scripts/r41/mutate-0276-sql.py
"""
import os
import subprocess
import sys

PGURL = os.environ.get("PGURL") or sys.exit("set PGURL to a database with every migration applied")
MIG = "supabase/migrations/0276_ach_file_funding_confirm.sql"
RB = "supabase/rollbacks/0276_ach_file_funding_confirm.rollback.sql"
CHECK = "scripts/recon/ach-file-funding-0276-pg-check.sql"
CHECK_0273 = "scripts/recon/ach-files-0273-pg-check.sql"
CHECK_0274 = "scripts/recon/ach-file-bank-steps-0274-pg-check.sql"
TMP = "/tmp/mut0276.sql"


def psql_file(path):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", path], capture_output=True, text=True)


def control(label):
    r = psql_file(RB)
    ap = psql_file(MIG)
    ck = psql_file(CHECK)
    c3 = psql_file(CHECK_0273)
    c4 = psql_file(CHECK_0274)
    ok = (
        r.returncode == 0 and ap.returncode == 0 and ck.returncode == 0 and c3.returncode == 0 and c4.returncode == 0
        and "ACH 0276 CHECK PASSED" in (ck.stdout + ck.stderr)
        and "ACH 0273 CHECK PASSED" in (c3.stdout + c3.stderr)
        and "ACH 0274 CHECK PASSED" in (c4.stdout + c4.stderr)
    )
    print(f"control ({label})", "pass" if ok else f"FAILED rb={r.returncode} apply={ap.returncode} check={ck.returncode} c3={c3.returncode} c4={c4.returncode} {(ck.stderr or c3.stderr or c4.stderr or ap.stderr or r.stderr)[-300:]}", flush=True)
    return ok


M = [
    # --- the function ---
    ("fn-bank-approved-allowed", "  if f.status not in ('released', 'uploaded') then", "  if f.status not in ('released', 'uploaded', 'bank_approved') then"),
    ("fn-owner-skipped", "  if not public.ach_actor_is_owner(p_actor) then", "  if false then"),
    ("fn-already-confirmed-skipped", "  if f.funding_confirmed_at is not null then", "  if false then"),
    ("fn-null-amount-allowed", "  if p_amount_cents is null or p_amount_cents < f.total_cents then", "  if p_amount_cents < f.total_cents then"),
    # --- the guard ---
    ("guard-insert-may-carry-funding", "    if new.funding_confirmed_by is not null or new.funding_confirmed_at is not null\n       or new.funding_confirmed_amount_cents is not null then", "    if false then"),
    ("guard-amount-may-change", "\n     or (old.funding_confirmed_amount_cents is not null and new.funding_confirmed_amount_cents is distinct from old.funding_confirmed_amount_cents) then", " then"),
    ("guard-with-status-change", "    if not (old.status in ('released', 'uploaded') and new.status = old.status) then", "    if not (old.status in ('released', 'uploaded')) then"),
    ("guard-owner-skipped", "    if not public.ach_actor_is_owner(new.funding_confirmed_by) then", "    if false then"),
    ("guard-short-allowed", "    if new.funding_confirmed_amount_cents < old.total_cents then", "    if false then"),
    # --- 0273 rule the replaced guard must keep ---
    ("guard-delete-allowed", "  if tg_op = 'DELETE' then\n    raise exception 'ACH_FILE_KEEP", "  if false then\n    raise exception 'ACH_FILE_KEEP"),
    # --- grants ---
    ("grant-to-authenticated", "grant execute on function public.ach_file_confirm_funding(uuid, uuid, bigint) to service_role;", "grant execute on function public.ach_file_confirm_funding(uuid, uuid, bigint) to service_role, authenticated;"),
    ("revoke-dropped", "revoke all on function public.ach_file_confirm_funding(uuid, uuid, bigint) from public, anon, authenticated;\n", ""),
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
    # A grant mutant must not leak into the next one: the rollback drops the function.

assert open(MIG).read() == src
ctl = control("after")
print(f"total {len(M)} killed {len(M) - len(surv)} survivors {surv}")
sys.exit(1 if surv or not ctl else 0)
