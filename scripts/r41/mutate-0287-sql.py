#!/usr/bin/env python3
"""scripts/r41/mutate-0287-sql.py - test the 0287 scenario check (R41 S13, the
three new Timberland log types: noc_wrong, ofac_notice, bank_report_received).

Each mutant weakens ONE rule in 0287. For each one:
  1. roll 0287 back (the rollback refuses if a new-type row exists; the
     pg-check always rolls its own rows back, so the test database has none);
  2. apply the mutated migration text (from a temp file; the repo file is
     never written);
  3. run scripts/recon/ach-timberland-comms-0287-pg-check.sql;
  4. expect it to FAIL (or the mutated migration not to apply).
The real 0287 is re-applied first (control) and last (control); the 0287 AND
the 0277 checks must print their PASSED line both times.

Two more probes, outside the mutant list:
  - "rolled back": with 0287 rolled back (the 0277 state), the 0287 check must
    FAIL (it is not a check that passes on anything);
  - "rollback refuses": with a noc_wrong row present (inside a transaction
    that is rolled back), the rollback must raise ROLLBACK REFUSED.

    PGURL='postgres://postgres:postgres@localhost:5432/greenway' python3 scripts/r41/mutate-0287-sql.py
"""
import os
import subprocess
import sys

PGURL = os.environ.get("PGURL") or sys.exit("set PGURL to a database with every migration applied")
MIG = "supabase/migrations/0287_ach_timberland_comms_notices.sql"
RB = "supabase/rollbacks/0287_ach_timberland_comms_notices.rollback.sql"
CHECK = "scripts/recon/ach-timberland-comms-0287-pg-check.sql"
CHECK_0277 = "scripts/recon/ach-timberland-comms-0277-pg-check.sql"
TMP = "/tmp/mut0287.sql"
TMP_RB = "/tmp/mut0287-rb.sql"


def psql_cmd(sql):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)


def psql_file(path):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", path], capture_output=True, text=True)


def control(label):
    r = psql_file(RB)
    ap = psql_file(MIG)
    ck = psql_file(CHECK)
    c7 = psql_file(CHECK_0277)
    ok = (
        r.returncode == 0 and ap.returncode == 0 and ck.returncode == 0 and c7.returncode == 0
        and "ACH 0287 CHECK PASSED" in (ck.stdout + ck.stderr)
        and "ACH 0277 CHECK PASSED" in (c7.stdout + c7.stderr)
    )
    print(f"control ({label})", "pass" if ok else f"FAILED rb={r.returncode} apply={ap.returncode} check={ck.returncode} c7={c7.returncode} {(ck.stderr or c7.stderr or ap.stderr or r.stderr)[-300:]}", flush=True)
    return ok


M = [
    # --- the entry type list ---
    ("noc-wrong-not-a-type", "    'noc_wrong', 'ofac_notice', 'bank_report_received'));", "    'ofac_notice', 'bank_report_received'));"),
    ("ofac-notice-not-a-type", "    'noc_wrong', 'ofac_notice', 'bank_report_received'));", "    'noc_wrong', 'bank_report_received'));"),
    ("bank-report-not-a-type", "    'noc_wrong', 'ofac_notice', 'bank_report_received'));", "    'noc_wrong', 'ofac_notice'));"),
    ("any-type-allowed", "alter table public.ach_timberland_comms add constraint ach_timberland_comms_entry_type_check\n  check (entry_type in (", "alter table public.ach_timberland_comms add constraint ach_timberland_comms_entry_type_check\n  check (entry_type is not null or entry_type in ("),
    ("old-type-dropped", "    'statement_received', 'other', 'done',\n", "    'statement_received', 'done',\n"),
    # --- the guard's close list ---
    ("noc-wrong-cannot-close", "                                 'noc_wrong', 'ofac_notice', 'bank_report_received') then", "                                 'ofac_notice', 'bank_report_received') then"),
    ("ofac-cannot-close", "                                 'noc_wrong', 'ofac_notice', 'bank_report_received') then", "                                 'noc_wrong', 'bank_report_received') then"),
    ("report-cannot-close", "                                 'noc_wrong', 'ofac_notice', 'bank_report_received') then", "                                 'noc_wrong', 'ofac_notice') then"),
    ("fact-can-close", "                                 'noc_wrong', 'ofac_notice', 'bank_report_received') then", "                                 'noc_wrong', 'ofac_notice', 'bank_report_received', 'other') then"),
    ("old-clock-dropped", "                                 'over_limit_request', 'prefunding_notice', 'compromise_reported',\n                                 'reversal_needed', 'statement_received', 'termination_notice',\n                                 'noc_wrong'", "                                 'over_limit_request', 'prefunding_notice', 'compromise_reported',\n                                 'reversal_needed', 'statement_received',\n                                 'noc_wrong'"),
    # --- the rest of the re-created guard ---
    ("guard-update-allowed", "  if tg_op <> 'INSERT' then\n    raise exception 'ACH_COMMS_APPEND_ONLY", "  if false then\n    raise exception 'ACH_COMMS_APPEND_ONLY"),
    ("guard-owner-skipped", "  if not public.ach_write_by_owner(new.created_by) then", "  if false then"),
    ("guard-done-before-arrival", "    if new.received_on < target.received_on then", "    if false then"),
    ("guard-security-definer", "language plpgsql\nset search_path = public, pg_temp\nas $$", "language plpgsql\nsecurity definer\nset search_path = public, pg_temp\nas $$"),
]


def probe_rolled_back():
    r = psql_file(RB)
    ck = psql_file(CHECK)
    ok = r.returncode == 0 and ck.returncode != 0
    print(f"{'killed  ' if ok else 'SURVIVED'} rolled-back  (the 0287 check {'fails' if ck.returncode else 'PASSED'} on the 0277 state)", flush=True)
    ap = psql_file(MIG)
    return ok and ap.returncode == 0


def probe_rollback_refuses():
    rb = open(RB).read()
    sql = (
        "begin;\n"
        "insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000287', 'rb0287@x.test');\n"
        "insert into public.staff_profiles (id, email, role, active) values ('00000000-0000-4000-8000-000000000287', 'rb0287@x.test', 'owner', true)"
        " on conflict (id) do update set role = excluded.role, active = excluded.active;\n"
        "select set_config('request.jwt.claim.sub', '', true);\n"
        "insert into public.ach_timberland_comms (entry_type, received_on, summary, created_by) values"
        " ('noc_wrong', (now() at time zone 'America/Los_Angeles')::date, 'NOC looks wrong', '00000000-0000-4000-8000-000000000287');\n"
        + rb + "\nrollback;\n"
    )
    open(TMP_RB, "w").write(sql)
    r = psql_file(TMP_RB)
    psql_cmd("rollback;")
    ok = r.returncode != 0 and "ROLLBACK REFUSED" in r.stderr
    print(f"{'killed  ' if ok else 'SURVIVED'} rollback-refuses  ({'raised ROLLBACK REFUSED' if ok else (r.stderr or 'accepted')[-140:]})", flush=True)
    return ok


def main(src):
    if not control("before"):
        return 2
    surv = []
    for name, a, b in M:
        if src.count(a) != 1:
            print(f"ANCHOR count={src.count(a)} {name}", flush=True)
            surv.append(name)
            continue
        r = psql_file(RB)
        if r.returncode:
            print(f"rollback failed before {name}: {r.stderr}", flush=True)
            return 3
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

    if not control("mid"):
        return 2
    if not probe_rolled_back():
        surv.append("rolled-back")
    if not probe_rollback_refuses():
        surv.append("rollback-refuses")

    assert open(MIG).read() == src
    ctl = control("after")
    print(f"total {len(M)} killed {len(M) - len([s for s in surv if s in dict((n, 1) for n, _, _ in M)])} survivors {surv}")
    return 1 if surv or not ctl else 0


sys.exit(main(open(MIG).read()))
