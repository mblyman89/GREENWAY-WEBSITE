#!/usr/bin/env python3
"""scripts/r41/mutate-0291-sql.py - test the 0291 scenario check (R41 S18, the
control-record table ach_control_records).

Each mutant weakens ONE rule in 0291. For each one:
  1. roll 0291 back (the rollback refuses if a control row exists; the
     pg-check always rolls its own rows back, so the test database has none);
  2. apply the mutated migration text (from a temp file; the repo file is
     never written);
  3. run scripts/recon/ach-control-records-0291-pg-check.sql;
  4. expect it to FAIL (or the mutated migration not to apply).
The real 0291 is re-applied first (control) and last (control); the 0291 AND
the 0290 checks must print their PASSED line both times.

Two more probes, outside the mutant list:
  - "rolled back": with 0291 rolled back (no table), the 0291 check must FAIL;
  - "rollback refuses": with a control row present (inside a transaction that
    is rolled back), the rollback must raise ROLLBACK REFUSED.

    PGURL='postgres://postgres:postgres@localhost:5432/greenway' python3 scripts/r41/mutate-0291-sql.py
"""
import os
import subprocess
import sys

PGURL = os.environ.get("PGURL") or sys.exit("set PGURL to a database with every migration applied")
MIG = "supabase/migrations/0291_ach_control_records.sql"
RB = "supabase/rollbacks/0291_ach_control_records.rollback.sql"
CHECK = "scripts/recon/ach-control-records-0291-pg-check.sql"
CHECK_PREV = "scripts/recon/ach-notice-mail-0290-pg-check.sql"
TMP = "/tmp/mut0291.sql"
TMP_RB = "/tmp/mut0291-rb.sql"


def psql_cmd(sql):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)


def psql_file(path):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", path], capture_output=True, text=True)


def control(label):
    r = psql_file(RB)
    ap = psql_file(MIG)
    ck = psql_file(CHECK)
    cprev = psql_file(CHECK_PREV)
    ok = (
        r.returncode == 0 and ap.returncode == 0 and ck.returncode == 0 and cprev.returncode == 0
        and "ACH 0291 CHECK PASSED" in (ck.stdout + ck.stderr)
        and "ACH 0290 CHECK PASSED" in (cprev.stdout + cprev.stderr)
    )
    print(f"control ({label})", "pass" if ok else f"FAILED rb={r.returncode} apply={ap.returncode} check={ck.returncode} cprev={cprev.returncode} {(ck.stderr or cprev.stderr or ap.stderr or r.stderr)[-300:]}", flush=True)
    return ok


M = [
    # --- table checks ---
    ("kind-any", "kind         text not null check (kind in ('policy_adoption', 'access_review', 'key_check')),", "kind         text not null,"),
    ("period-any", "period_key   text not null check (period_key ~ '^20[0-9]{2}(-Q[1-4])?$'),", "period_key   text not null,"),
    ("sha-any", "text_sha256  text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),", "text_sha256  text not null,"),
    ("summary-short-ok", "check (length(trim(summary)) between 10 and 2000 and summary !~ '[0-9]{7,}'),", "check (length(trim(summary)) between 1 and 2000 and summary !~ '[0-9]{7,}'),"),
    ("summary-digits-ok", "check (length(trim(summary)) between 10 and 2000 and summary !~ '[0-9]{7,}'),", "check (length(trim(summary)) between 10 and 2000),"),
    ("item-any", "item         text check (item is null or item ~ '^[a-z_]{3,40}$'),", "item         text,"),
    ("review-year-key-ok", "(kind = 'access_review' and period_key ~ '-Q[1-4]$' and item is null", "(kind = 'access_review' and item is null"),
    ("review-item-ok", "(kind = 'access_review' and period_key ~ '-Q[1-4]$' and item is null and item_set_on is null)", "(kind = 'access_review' and period_key ~ '-Q[1-4]$')"),
    ("adopt-quarter-key-ok", "or (kind = 'policy_adoption' and period_key ~ '^[0-9]{4}$' and item is null", "or (kind = 'policy_adoption' and item is null"),
    ("adopt-item-ok", "or (kind = 'policy_adoption' and period_key ~ '^[0-9]{4}$' and item is null and item_set_on is null)", "or (kind = 'policy_adoption' and period_key ~ '^[0-9]{4}$')"),
    ("key-no-item-ok", "or (kind = 'key_check' and period_key ~ '^[0-9]{4}$' and item is not null", "or (kind = 'key_check' and period_key ~ '^[0-9]{4}$'"),
    ("key-future-set-ok", "(item_set_on <= recorded_on and item_set_on >= date '2000-01-01')", "(item_set_on >= date '2000-01-01')"),
    # --- guard ---
    ("update-allowed", "  if tg_op <> 'INSERT' then\n    raise exception 'ACH_CONTROL_APPEND_ONLY", "  if tg_op = 'DELETE' then\n    raise exception 'ACH_CONTROL_APPEND_ONLY"),
    ("delete-allowed", "  if tg_op <> 'INSERT' then\n    raise exception 'ACH_CONTROL_APPEND_ONLY", "  if tg_op = 'UPDATE' then\n    raise exception 'ACH_CONTROL_APPEND_ONLY"),
    ("anyone-records", "  if not public.ach_write_by_owner(new.created_by) then", "  if false then"),
    ("backdate-ok", "  if new.recorded_on > today or new.recorded_on < today - 1 then", "  if new.recorded_on > today then"),
    ("future-date-ok", "  if new.recorded_on > today or new.recorded_on < today - 1 then", "  if new.recorded_on < today - 1 then"),
    ("old-quarter-ok", "not between q - 1 and q then", "not between q - 9 and q then"),
    ("future-quarter-ok", "not between q - 1 and q then", "not between q - 1 and q + 9 then"),
    ("any-year-ok", "and new.period_key::int <> y then", "and false then"),
    ("guard-security-definer", "returns trigger\nlanguage plpgsql\nset search_path = public, pg_temp\nas $$\ndeclare", "returns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = public, pg_temp\nas $$\ndeclare"),
    ("truncate-allowed", "create trigger trg_ach_control_records_no_truncate\n  before truncate on public.ach_control_records\n  for each statement execute function public.ach_control_records_no_truncate();", "-- no truncate trigger"),
    # --- grants and RLS ---
    ("service-update", "revoke update, delete, truncate on table public.ach_control_records from service_role;", "revoke delete, truncate on table public.ach_control_records from service_role;\ngrant update on table public.ach_control_records to service_role;"),
    ("service-delete", "revoke update, delete, truncate on table public.ach_control_records from service_role;", "revoke update, truncate on table public.ach_control_records from service_role;\ngrant delete on table public.ach_control_records to service_role;"),
    ("authenticated-insert", "grant select on table public.ach_control_records to authenticated;", "grant select, insert on table public.ach_control_records to authenticated;"),
    ("anon-read", "revoke all on table public.ach_control_records from anon;", "grant select on table public.ach_control_records to anon;"),
    ("rls-open", "create policy ach_control_records_admin_read on public.ach_control_records\n  for select using (public.is_admin());", "create policy ach_control_records_admin_read on public.ach_control_records\n  for select using (true);"),
]


def probe_rolled_back():
    r = psql_file(RB)
    ck = psql_file(CHECK)
    ok = r.returncode == 0 and ck.returncode != 0
    print(f"{'killed  ' if ok else 'SURVIVED'} rolled-back  (the 0291 check {'fails' if ck.returncode else 'PASSED'} with no table)", flush=True)
    ap = psql_file(MIG)
    return ok and ap.returncode == 0


def probe_rollback_refuses():
    rb = open(RB).read()
    sql = (
        "begin;\n"
        "insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000291', 'rb0291@x.test');\n"
        "insert into public.staff_profiles (id, email, role, active) values ('00000000-0000-4000-8000-000000000291', 'rb0291@x.test', 'owner', true) on conflict (id) do update set role = 'owner', active = true;\n"
        "alter table public.ach_control_records disable trigger trg_ach_control_records_guard;\n"
        "insert into public.ach_control_records (kind, period_key, recorded_on, text_sha256, summary, created_by)"
        " select 'policy_adoption', to_char(current_date, 'YYYY'), current_date, repeat('ab', 32), 'Rollback refusal probe row.', id"
        " from public.staff_profiles where id = '00000000-0000-4000-8000-000000000291';\n"
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
