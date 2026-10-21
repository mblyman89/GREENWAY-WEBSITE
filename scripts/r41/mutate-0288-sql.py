#!/usr/bin/env python3
"""scripts/r41/mutate-0288-sql.py - test the 0288 scenario check (R41 S14, the
yearly ACH fraud-procedure review table ach_annual_reviews).

Each mutant weakens ONE rule in 0288. For each one:
  1. roll 0288 back (the rollback refuses if a review row exists; the
     pg-check always rolls its own rows back, so the test database has none);
  2. apply the mutated migration text (from a temp file; the repo file is
     never written);
  3. run scripts/recon/ach-annual-reviews-0288-pg-check.sql;
  4. expect it to FAIL (or the mutated migration not to apply).
The real 0288 is re-applied first (control) and last (control); the 0288 AND
the 0287 checks must print their PASSED line both times.

Two more probes, outside the mutant list:
  - "rolled back": with 0288 rolled back (no table), the 0288 check must FAIL;
  - "rollback refuses": with a review row present (inside a transaction that
    is rolled back), the rollback must raise ROLLBACK REFUSED.

    PGURL='postgres://postgres:postgres@localhost:5432/greenway' python3 scripts/r41/mutate-0288-sql.py
"""
import os
import subprocess
import sys

PGURL = os.environ.get("PGURL") or sys.exit("set PGURL to a database with every migration applied")
MIG = "supabase/migrations/0288_ach_annual_reviews.sql"
RB = "supabase/rollbacks/0288_ach_annual_reviews.rollback.sql"
CHECK = "scripts/recon/ach-annual-reviews-0288-pg-check.sql"
CHECK_0287 = "scripts/recon/ach-timberland-comms-0287-pg-check.sql"
TMP = "/tmp/mut0288.sql"
TMP_RB = "/tmp/mut0288-rb.sql"


def psql_cmd(sql):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)


def psql_file(path):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", path], capture_output=True, text=True)


def control(label):
    r = psql_file(RB)
    ap = psql_file(MIG)
    ck = psql_file(CHECK)
    c87 = psql_file(CHECK_0287)
    ok = (
        r.returncode == 0 and ap.returncode == 0 and ck.returncode == 0 and c87.returncode == 0
        and "ACH 0288 CHECK PASSED" in (ck.stdout + ck.stderr)
        and "ACH 0287 CHECK PASSED" in (c87.stdout + c87.stderr)
    )
    print(f"control ({label})", "pass" if ok else f"FAILED rb={r.returncode} apply={ap.returncode} check={ck.returncode} c87={c87.returncode} {(ck.stderr or c87.stderr or ap.stderr or r.stderr)[-300:]}", flush=True)
    return ok


M = [
    # --- table checks ---
    ("year-floor-dropped", "review_year       integer not null check (review_year between 2026 and 2200),", "review_year       integer not null check (review_year between 1900 and 2200),"),
    ("outcome-any", "outcome           text not null check (outcome in ('no_changes', 'changes_made', 'changes_needed')),", "outcome           text not null check (outcome is not null),"),
    ("summary-short-ok", "check (length(trim(summary)) between 20 and 2000 and summary !~ '[0-9]{7,}')", "check (length(trim(summary)) between 1 and 2000 and summary !~ '[0-9]{7,}')"),
    ("summary-digits-ok", "check (length(trim(summary)) between 20 and 2000 and summary !~ '[0-9]{7,}')", "check (length(trim(summary)) between 20 and 2000)"),
    ("sha-any", "check (procedure_sha256 ~ '^[0-9a-f]{64}$')", "check (procedure_sha256 is not null)"),
    ("many-originals", "create unique index if not exists aar_one_per_year on public.ach_annual_reviews (review_year) where corrects_id is null;", "create index if not exists aar_one_per_year on public.ach_annual_reviews (review_year) where corrects_id is null;"),
    # --- the guard ---
    ("guard-update-allowed", "  if tg_op <> 'INSERT' then\n    raise exception 'ACH_YEARLY_APPEND_ONLY", "  if tg_op = 'DELETE' then\n    raise exception 'ACH_YEARLY_APPEND_ONLY"),
    ("guard-delete-allowed", "  if tg_op <> 'INSERT' then\n    raise exception 'ACH_YEARLY_APPEND_ONLY", "  if tg_op = 'UPDATE' then\n    raise exception 'ACH_YEARLY_APPEND_ONLY"),
    ("guard-owner-skipped", "  if not public.ach_write_by_owner(new.created_by) then", "  if false then"),
    ("guard-owner-stamp-only", "  if not public.ach_write_by_owner(new.created_by) then", "  if not public.ach_actor_is_owner(new.created_by) then"),
    ("guard-backdate-ok", "  if new.reviewed_on > today or new.reviewed_on < today - 1 then", "  if new.reviewed_on > today then"),
    ("guard-future-ok", "  if new.reviewed_on > today or new.reviewed_on < today - 1 then", "  if new.reviewed_on < today - 1 then"),
    ("guard-future-year-ok", "  if new.review_year > extract(year from new.reviewed_on)::int\n     or", "  if false\n     or"),
    ("guard-correct-missing-ok", "    if not found then\n      raise exception 'ACH_YEARLY_CORRECTS: the review to correct was not found.';", "    if false then\n      raise exception 'ACH_YEARLY_CORRECTS: the review to correct was not found.';"),
    ("guard-correct-chain-ok", "    if target.corrects_id is not null then", "    if false then"),
    ("guard-correct-other-year-ok", "    if target.review_year <> new.review_year then", "    if false then"),
    ("guard-security-definer", "returns trigger\nlanguage plpgsql\nset search_path = public, pg_temp\nas $$\ndeclare", "returns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = public, pg_temp\nas $$\ndeclare"),
    ("truncate-allowed", "create trigger trg_ach_annual_reviews_no_truncate\n  before truncate on public.ach_annual_reviews\n  for each statement execute function public.ach_annual_reviews_no_truncate();", "-- no truncate trigger"),
    # --- grants and RLS ---
    ("service-update", "revoke update, delete, truncate on table public.ach_annual_reviews from service_role;", "grant update on table public.ach_annual_reviews to service_role;"),
    ("authenticated-insert", "grant select on table public.ach_annual_reviews to authenticated;", "grant select, insert on table public.ach_annual_reviews to authenticated;"),
    ("anon-read", "revoke all on table public.ach_annual_reviews from anon;", "grant select on table public.ach_annual_reviews to anon;"),
    ("rls-open", "  for select using (public.is_admin());", "  for select using (true);"),
]


def probe_rolled_back():
    r = psql_file(RB)
    ck = psql_file(CHECK)
    ok = r.returncode == 0 and ck.returncode != 0
    print(f"{'killed  ' if ok else 'SURVIVED'} rolled-back  (the 0288 check {'fails' if ck.returncode else 'PASSED'} with no table)", flush=True)
    ap = psql_file(MIG)
    return ok and ap.returncode == 0


def probe_rollback_refuses():
    rb = open(RB).read()
    sql = (
        "begin;\n"
        "insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000288', 'rb0288@x.test');\n"
        "insert into public.staff_profiles (id, email, role, active) values ('00000000-0000-4000-8000-000000000288', 'rb0288@x.test', 'owner', true)"
        " on conflict (id) do update set role = excluded.role, active = excluded.active;\n"
        "select set_config('request.jwt.claim.sub', '', true);\n"
        "insert into public.ach_annual_reviews (review_year, reviewed_on, outcome, summary, procedure_sha256, created_by) values"
        " (extract(year from (now() at time zone 'America/Los_Angeles'))::int, (now() at time zone 'America/Los_Angeles')::date, 'no_changes',"
        " 'Read the whole procedure; nothing changed.', repeat('ab', 32), '00000000-0000-4000-8000-000000000288');\n"
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
