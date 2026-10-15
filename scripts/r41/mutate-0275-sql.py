#!/usr/bin/env python3
"""scripts/r41/mutate-0275-sql.py - test the 0275 scenario check (R41 S7, Timberland's prenote wait).

Each mutant weakens ONE rule in 0275. For each one:
  1. roll 0275 back (drops the trigger and its function; no table, no data);
  2. apply the mutated migration text (from a temp file; the repo file is
     never written);
  3. run scripts/recon/ach-prenote-wait-0275-pg-check.sql;
  4. expect it to FAIL (or the mutated migration not to apply).
The real 0275 is re-applied first (control) and last (control) and the check
must print "ACH 0275 CHECK PASSED" both times. The 0263 check must also still
pass at the end (its dates were moved to Timberland's wait).

    PGURL='postgres://postgres:postgres@localhost:5432/r41s2' python3 scripts/r41/mutate-0275-sql.py
"""
import os
import subprocess
import sys

PGURL = os.environ.get("PGURL") or sys.exit("set PGURL to a database with every migration applied")
MIG = "supabase/migrations/0275_ach_prenote_timberland_wait.sql"
RB = "supabase/rollbacks/0275_ach_prenote_timberland_wait.rollback.sql"
CHECK = "scripts/recon/ach-prenote-wait-0275-pg-check.sql"
CHECK_0263 = "scripts/recon/ach-ops-0263-pg-check.sql"
TMP = "/tmp/mut0275.sql"


def psql_file(path):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", path], capture_output=True, text=True)


def control(label):
    r = psql_file(RB)
    ap = psql_file(MIG)
    ck = psql_file(CHECK)
    c3 = psql_file(CHECK_0263)
    ok = (
        r.returncode == 0 and ap.returncode == 0 and ck.returncode == 0 and c3.returncode == 0
        and "ACH 0275 CHECK PASSED" in (ck.stdout + ck.stderr)
        and "ACH 0263 CHECK PASSED" in (c3.stdout + c3.stderr)
    )
    print(f"control ({label})", "pass" if ok else f"FAILED rb={r.returncode} apply={ap.returncode} check={ck.returncode} c3={c3.returncode} {(ck.stderr or c3.stderr or ap.stderr or r.stderr)[-300:]}", flush=True)
    return ok


M = [
    # --- the floor itself ---
    ("nacha-three-days", "new.eligible_on < new.settlement_date + 8", "new.eligible_on < new.settlement_date + 5"),
    ("floor-off-by-one", "new.eligible_on < new.settlement_date + 8", "new.eligible_on < new.settlement_date + 7"),
    ("floor-too-strict", "new.eligible_on < new.settlement_date + 8", "new.eligible_on < new.settlement_date + 9"),
    ("floor-from-effective", "new.eligible_on < new.settlement_date + 8", "new.eligible_on < new.effective_date + 8"),
    ("null-dates-pass", "    if new.settlement_date is null or new.eligible_on is null\n       or new.eligible_on", "    if new.eligible_on"),
    # --- who it applies to ---
    ("micro-entries-too", "  if new.method = 'prenote' and new.status = 'sent'", "  if new.status = 'sent'"),
    ("never-fires", "  if new.method = 'prenote' and new.status = 'sent' and old.status is distinct from 'sent' then", "  if false then"),
    # --- the error the app maps ---
    ("wrong-errcode", "        using errcode = 'check_violation';", "        using errcode = 'raise_exception';"),
    ("wrong-code-word", "raise exception 'ACH_VERIFICATION_TIMBERLAND_WAIT:", "raise exception 'ACH_VERIFICATION_WAIT:"),
    # --- shape ---
    ("browser-may-call", "revoke all on function public.ach_verification_timberland_wait() from public, anon, authenticated;", "grant execute on function public.ach_verification_timberland_wait() to authenticated;"),
    ("search-path-open", "set search_path = public, pg_temp\n", ""),
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

assert open(MIG).read() == src
ctl = control("after")
print(f"total {len(M)} killed {len(M) - len(surv)} survivors {surv}")
sys.exit(1 if surv or not ctl else 0)
