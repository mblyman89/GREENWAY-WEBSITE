#!/usr/bin/env python3
"""scripts/r41/mutate-0277-sql.py - test the 0277 scenario check (R41 S10, the
Timberland communications log).

Each mutant weakens ONE rule in 0277. For each one:
  1. roll 0277 back (the rollback refuses if the log has rows or a request
     targets it; the pg-check always rolls its own rows back, so the test
     database has none);
  2. apply the mutated migration text (from a temp file; the repo file is
     never written);
  3. run scripts/recon/ach-timberland-comms-0277-pg-check.sql;
  4. expect it to FAIL (or the mutated migration not to apply).
The real 0277 is re-applied first (control) and last (control) and the check
must print "ACH 0277 CHECK PASSED" both times. The 0273 check must also still
pass (0277 replaced the request target list that 0273 extended).

Supabase default privileges: on existing Supabase projects, tables created in
the public schema are granted SELECT, INSERT, UPDATE and DELETE for anon,
authenticated and service_role by default ("Securing your API",
https://supabase.com/docs/guides/api/securing-your-api). A plain local
Postgres has no such default ACL, so removing a revoke would change nothing
locally and the mutant would survive for the wrong reason. The run therefore
sets the same default privileges first (ALTER DEFAULT PRIVILEGES for role
postgres in schema public) and always removes them at the end (finally).

    PGURL='postgres://postgres:postgres@localhost:5432/greenway' python3 scripts/r41/mutate-0277-sql.py
"""
import os
import subprocess
import sys

PGURL = os.environ.get("PGURL") or sys.exit("set PGURL to a database with every migration applied")
MIG = "supabase/migrations/0277_ach_timberland_comms.sql"
RB = "supabase/rollbacks/0277_ach_timberland_comms.rollback.sql"
CHECK = "scripts/recon/ach-timberland-comms-0277-pg-check.sql"
CHECK_0273 = "scripts/recon/ach-files-0273-pg-check.sql"
TMP = "/tmp/mut0277.sql"


DEFAULTS_ON = ("alter default privileges for role postgres in schema public "
               "grant select, insert, update, delete on tables to anon, authenticated, service_role;")
DEFAULTS_OFF = ("alter default privileges for role postgres in schema public "
                "revoke select, insert, update, delete on tables from anon, authenticated, service_role;")


def psql_cmd(sql):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)


def psql_file(path):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", path], capture_output=True, text=True)


def control(label):
    r = psql_file(RB)
    ap = psql_file(MIG)
    ck = psql_file(CHECK)
    c3 = psql_file(CHECK_0273)
    ok = (
        r.returncode == 0 and ap.returncode == 0 and ck.returncode == 0 and c3.returncode == 0
        and "ACH 0277 CHECK PASSED" in (ck.stdout + ck.stderr)
        and "ACH 0273 CHECK PASSED" in (c3.stdout + c3.stderr)
    )
    print(f"control ({label})", "pass" if ok else f"FAILED rb={r.returncode} apply={ap.returncode} check={ck.returncode} c3={c3.returncode} {(ck.stderr or c3.stderr or ap.stderr or r.stderr)[-300:]}", flush=True)
    return ok


M = [
    # --- the guard ---
    ("guard-update-allowed", "  if tg_op <> 'INSERT' then\n    raise exception 'ACH_COMMS_APPEND_ONLY", "  if false then\n    raise exception 'ACH_COMMS_APPEND_ONLY"),
    ("guard-owner-skipped", "  if not public.ach_write_by_owner(new.created_by) then", "  if false then"),
    ("guard-future-date-allowed", "  if new.received_on > today then", "  if new.received_on > today + 1 then"),
    ("guard-old-date-allowed", "  if new.received_on < today - 400 then", "  if new.received_on < today - 4000 then"),
    ("guard-future-time-allowed", "  if new.occurred_at is not null and new.occurred_at > now() + interval '5 minutes' then", "  if false then"),
    ("guard-close-anything", "    if target.entry_type not in ('amendment_notice', 'fee_notice', 'reserve_demand', 'auth_copy_request',", "    if target.entry_type not in ('amendment_notice', 'fee_notice', 'reserve_demand', 'auth_copy_request', 'access_ready', 'other', 'done',"),
    ("guard-done-before-arrival", "    if new.received_on < target.received_on then", "    if false then"),
    # --- table constraints ---
    ("closes-twice", "create unique index if not exists atc_closes_once on public.ach_timberland_comms (closes_id) where closes_id is not null;", "create index if not exists atc_closes_once on public.ach_timberland_comms (closes_id) where closes_id is not null;"),
    ("digits-allowed", " and summary !~ '[0-9]{7,}'", ""),
    ("time-not-needed", "  constraint atc_time_needed check (entry_type not in ('compromise_reported', 'reversal_needed') or occurred_at is not null),", "  constraint atc_time_needed check (true),"),
    ("amount-not-needed", "  constraint atc_amount_needed check (entry_type not in ('reserve_demand', 'over_limit_request') or amount_cents is not null),", "  constraint atc_amount_needed check (true),"),
    ("second-date-not-needed", "  constraint atc_second_date_needed check (entry_type not in ('reversal_needed', 'over_limit_request', 'termination_notice') or effective_on is not null),", "  constraint atc_second_date_needed check (true),"),
    # --- grants and request target ---
    ("service-role-may-update", "revoke update, delete, truncate on table public.ach_timberland_comms from service_role;\n", ""),
    ("browser-may-insert", "grant select on table public.ach_timberland_comms to authenticated;", "grant select, insert on table public.ach_timberland_comms to authenticated;"),
    ("request-target-missing", "'company', 'vendor_payment', 'ach_file', 'timberland_comms'));", "'company', 'vendor_payment', 'ach_file'));"),
]

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

    assert open(MIG).read() == src
    ctl = control("after")
    print(f"total {len(M)} killed {len(M) - len(surv)} survivors {surv}")
    return 1 if surv or not ctl else 0


src = open(MIG).read()
d = psql_cmd(DEFAULTS_ON)
if d.returncode:
    sys.exit(f"could not set the Supabase default privileges: {d.stderr}")
print("supabase default privileges simulated (select, insert, update, delete to anon, authenticated, service_role)", flush=True)
try:
    code = main(src)
finally:
    off = psql_cmd(DEFAULTS_OFF)
    print("supabase default privileges removed" if off.returncode == 0 else f"WARNING could not remove default privileges: {off.stderr}", flush=True)
sys.exit(code)
