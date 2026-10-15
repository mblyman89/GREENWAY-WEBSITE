#!/usr/bin/env python3
"""scripts/r41/mutate-0278-sql.py - test the 0278 scenario check (R41 S11, OFAC
sanctions screening of payees).

Each mutant weakens ONE rule in 0278. For each one:
  1. roll 0278 back (the rollback refuses if any screening row exists or a
     request targets a review; the pg-check always rolls its own rows back,
     so the test database has none);
  2. apply the mutated migration text (from a temp file; the repo file is
     never written);
  3. run scripts/recon/ofac-screening-0278-pg-check.sql;
  4. expect it to FAIL (or the mutated migration not to apply).
The real 0278 is re-applied first (control) and last (control) and the check
must print "ACH 0278 CHECK PASSED" both times. The 0277 check must also still
pass (0278 replaced the request target list that 0277 extended).

Supabase default privileges: on existing Supabase projects, tables created in
the public schema are granted SELECT, INSERT, UPDATE and DELETE for anon,
authenticated and service_role by default ("Securing your API",
https://supabase.com/docs/guides/api/securing-your-api). A plain local
Postgres has no such default ACL, so removing a revoke would change nothing
locally and the mutant would survive for the wrong reason. The run therefore
sets the same default privileges first (ALTER DEFAULT PRIVILEGES for role
postgres in schema public) and always removes them at the end (finally).

    PGURL='postgres://postgres:postgres@localhost:5432/greenway' python3 scripts/r41/mutate-0278-sql.py
"""
import os
import subprocess
import sys

PGURL = os.environ.get("PGURL") or sys.exit("set PGURL to a database with every migration applied")
MIG = "supabase/migrations/0278_ofac_screening.sql"
RB = "supabase/rollbacks/0278_ofac_screening.rollback.sql"
CHECK = "scripts/recon/ofac-screening-0278-pg-check.sql"
CHECK_0277 = "scripts/recon/ach-timberland-comms-0277-pg-check.sql"
TMP = "/tmp/mut0278.sql"


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
    c3 = psql_file(CHECK_0277)
    ok = (
        r.returncode == 0 and ap.returncode == 0 and ck.returncode == 0 and c3.returncode == 0
        and "ACH 0278 CHECK PASSED" in (ck.stdout + ck.stderr)
        and "ACH 0277 CHECK PASSED" in (c3.stdout + c3.stderr)
    )
    print(f"control ({label})", "pass" if ok else f"FAILED rb={r.returncode} apply={ap.returncode} check={ck.returncode} c3={c3.returncode} {(ck.stderr or c3.stderr or ap.stderr or r.stderr)[-300:]}", flush=True)
    return ok


M = [
    # --- append-only and run guards ---
    ("runs-results-update-allowed", "  if tg_op <> 'INSERT' then\n    raise exception 'OFAC_APPEND_ONLY: screening records are never changed or deleted.';\n  end if;\n  if tg_table_name", "  if false then\n    raise exception 'OFAC_APPEND_ONLY: screening records are never changed or deleted.';\n  end if;\n  if tg_table_name"),
    ("result-for-failed-run", "    if run_status is distinct from 'ok' then", "    if false then"),
    ("reviews-truncate-allowed", "create trigger trg_ofac_reviews_no_truncate before truncate on public.ofac_match_reviews\n  for each statement execute function public.ofac_screening_no_truncate();", "select 1;"),
    ("reviews-update-allowed", "  if tg_op <> 'INSERT' then\n    raise exception 'OFAC_APPEND_ONLY: screening records are never changed or deleted.';\n  end if;\n  if not public.ach_write_by_owner", "  if false then\n    raise exception 'OFAC_APPEND_ONLY: screening records are never changed or deleted.';\n  end if;\n  if not public.ach_write_by_owner"),
    # --- reviews ---
    ("review-owner-skipped", "  if not public.ach_write_by_owner(new.created_by) then", "  if false then"),
    ("review-of-clear-result", "  if not found or target.result <> 'possible_match' then", "  if not found then"),
    ("review-other-payee", "  if target.payee_type <> new.payee_type or target.payee_id <> new.payee_id then", "  if false then"),
    ("review-short-note", "  if length(regexp_replace(btrim(new.note), '\\s+', ' ', 'g')) not between 20 and 2000 or new.note ~ '[0-9]{7,}' then", "  if new.note ~ '[0-9]{7,}' then"),
    ("review-digits-in-note", " or new.note ~ '[0-9]{7,}' then", " then"),
    ("review-twice", "  constraint ofac_reviews_once unique (result_id)\n", "  constraint ofac_reviews_once check (true)\n"),
    # --- run and result shapes ---
    ("clear-with-matches", "  constraint osres_clear_shape check ((result = 'clear') = (jsonb_array_length(matches) = 0)),", "  constraint osres_clear_shape check (true),"),
    ("failed-without-error", "  constraint osr_failed_has_error check ((status = 'failed') = (error is not null)),", "  constraint osr_failed_has_error check (true),"),
    ("manual-without-actor", "  constraint osr_manual_has_actor check (trigger <> 'manual' or created_by is not null),", "  constraint osr_manual_has_actor check (true),"),
    ("ok-without-lists", "  constraint osr_ok_has_lists check (status <> 'ok' or (list_sha256 is not null and payees_sha256 is not null))", "  constraint osr_ok_has_lists check (true)"),
    ("record-run-non-array", "  if jsonb_typeof(p_results) is distinct from 'array' then", "  if false then"),
    # --- privileges, RLS, request target ---
    ("service-role-may-update", "revoke update, delete, truncate on table public.ofac_screening_runs, public.ofac_screening_results, public.ofac_match_reviews from service_role;\n", ""),
    ("browser-may-insert", "grant select on table public.ofac_screening_runs, public.ofac_screening_results, public.ofac_match_reviews to authenticated;", "grant select, insert on table public.ofac_screening_runs, public.ofac_screening_results, public.ofac_match_reviews to authenticated;"),
    ("anon-may-read", "revoke all on table public.ofac_screening_runs, public.ofac_screening_results, public.ofac_match_reviews from anon;\n", ""),
    ("browser-may-record-run", "revoke all on function public.ofac_record_run(jsonb, jsonb) from public, anon, authenticated;\n", ""),
    ("record-run-security-definer", "returns uuid\nlanguage plpgsql\n", "returns uuid\nlanguage plpgsql\nsecurity definer\n"),
    ("reviews-rls-off", "alter table public.ofac_match_reviews enable row level security;\n", ""),
    ("request-target-missing", "'company', 'vendor_payment', 'ach_file', 'timberland_comms', 'ofac_review'));", "'company', 'vendor_payment', 'ach_file', 'timberland_comms'));"),
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
