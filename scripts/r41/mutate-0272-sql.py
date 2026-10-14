#!/usr/bin/env python3
"""scripts/r41/mutate-0272-sql.py - test the 0272 scenario check (R41 S2 stamp).

Each mutant weakens ONE rule in 0272. For each one:
  1. roll 0272 back (safe: the check rolls itself back, so no stamp rows remain);
  2. apply the mutated migration text (from a temp file; the repo file is never written);
  3. run scripts/recon/ach-timberland-confirm-0272-pg-check.sql;
  4. expect it to FAIL.
The real 0272 is re-applied at the end and the check re-run as the control.

    PGURL='postgres://postgres:postgres@localhost:5432/r41s2' python3 scripts/r41/mutate-0272-sql.py
"""
import os
import subprocess
import sys

PGURL = os.environ.get("PGURL") or sys.exit("set PGURL to a database with every migration applied")
MIG = "supabase/migrations/0272_ach_company_timberland_confirmed.sql"
RB = "supabase/rollbacks/0272_ach_company_timberland_confirmed.rollback.sql"
CHECK = "scripts/recon/ach-timberland-confirm-0272-pg-check.sql"
TMP = "/tmp/mut0272.sql"


def psql_file(path):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", path], capture_output=True, text=True)


M = [
    ("routing-not-matched", "  if new.destination_routing is distinct from old.destination_routing\n     or ", "  if false\n     or "),
    ("origin-not-matched", "     or new.immediate_origin is distinct from old.immediate_origin\n", ""),
    ("name-not-matched", "     or new.company_name is distinct from old.company_name\n", ""),
    ("id-not-matched", "     or new.company_id is distinct from old.company_id\n", ""),
    ("odfi-not-matched", "     or new.originating_dfi is distinct from old.originating_dfi then", "     or false then"),
    ("stamp-kept-on-change", "    new.timberland_confirmed_at := null;\n    new.timberland_confirmed_by := null;\n    new.timberland_confirm_note := null;\n", ""),
    ("cleared-at-not-recorded", "      new.timberland_confirm_cleared_at := now();\n", ""),
    ("cleared-at-always", "    if old.timberland_confirmed_at is not null or new.timberland_confirmed_at is not null then\n      new.timberland_confirm_cleared_at := now();\n    end if;",
     "    new.timberland_confirm_cleared_at := now();"),
    ("self-check-off", "    if new.timberland_confirmed_by is null or new.timberland_confirmed_by is distinct from new.updated_by then", "    if false then"),
    ("self-null-ok", "    if new.timberland_confirmed_by is null or new.timberland_confirmed_by is distinct from new.updated_by then",
     "    if new.timberland_confirmed_by is distinct from new.updated_by and new.timberland_confirmed_by is not null then"),
    ("future-ok", "    if new.timberland_confirmed_at > now() + interval '5 minutes' then", "    if false then"),
    ("note-short-ok", "length(btrim(timberland_confirm_note)) between 10 and 500", "length(btrim(timberland_confirm_note)) between 1 and 500"),
    ("note-without-stamp-ok", "  (timberland_confirmed_at is null and timberland_confirm_note is null)\n  or", "  (timberland_confirmed_at is null)\n  or"),
    ("trigger-on-insert-only", "create trigger trg_ach_company_settings_timberland_stamp\n  before update on public.ach_company_settings",
     "create trigger trg_ach_company_settings_timberland_stamp\n  before insert on public.ach_company_settings"),
    ("trigger-renamed-before-guard", "create trigger trg_ach_company_settings_timberland_stamp\n",
     "create trigger trg_ach_company_settings_aa_stamp\n"),
    ("column-dropped", "  add column if not exists timberland_confirm_cleared_at timestamptz;", "  add column if not exists timberland_confirm_clearedx timestamptz;"),
]

src = open(MIG).read()
surv = []
for name, a, b in M:
    if src.count(a) != 1:
        print(f"ANCHOR count={src.count(a)} {name}", flush=True)
        surv.append(name)
        continue
    # the renamed-trigger mutant leaves an extra trigger the rollback does not know: drop it first
    subprocess.run(["psql", PGURL, "-X", "-q", "-c", "drop trigger if exists trg_ach_company_settings_aa_stamp on public.ach_company_settings"], capture_output=True)
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

# restore the real migration and run the control
subprocess.run(["psql", PGURL, "-X", "-q", "-c", "drop trigger if exists trg_ach_company_settings_aa_stamp on public.ach_company_settings"], capture_output=True)
psql_file(RB)
ap = psql_file(MIG)
ck = psql_file(CHECK)
ctl = ap.returncode == 0 and ck.returncode == 0 and "ACH 0272 CHECK PASSED" in (ck.stdout + ck.stderr)
print("control", "pass" if ctl else f"FAILED apply={ap.returncode} check={ck.returncode} {ck.stderr[-300:]}")
print(f"total {len(M)} killed {len(M) - len(surv)} survivors {surv}")
sys.exit(1 if surv or not ctl else 0)
