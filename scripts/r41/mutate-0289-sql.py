#!/usr/bin/env python3
"""scripts/r41/mutate-0289-sql.py - test the 0289 scenario check (R41 S16, the
bank watch tables ach_bank_watch_rules and ach_bank_watch_reviews).

Each mutant weakens ONE rule in 0289. For each one:
  1. roll 0289 back (the rollback refuses if a rule or review row exists; the
     pg-check always rolls its own rows back, so the test database has none);
  2. apply the mutated migration text (from a temp file; the repo file is
     never written);
  3. run scripts/recon/ach-bank-watch-0289-pg-check.sql;
  4. expect it to FAIL (or the mutated migration not to apply).
The real 0289 is re-applied first (control) and last (control); the 0289 AND
the 0288 checks must print their PASSED line both times.

Two more probes, outside the mutant list:
  - "rolled back": with 0289 rolled back (no tables), the 0289 check must FAIL;
  - "rollback refuses": with a rule row present (inside a transaction that
    is rolled back), the rollback must raise ROLLBACK REFUSED.

    PGURL='postgres://postgres:postgres@localhost:5432/greenway' python3 scripts/r41/mutate-0289-sql.py
"""
import os
import subprocess
import sys

PGURL = os.environ.get("PGURL") or sys.exit("set PGURL to a database with every migration applied")
MIG = "supabase/migrations/0289_ach_bank_watch.sql"
RB = "supabase/rollbacks/0289_ach_bank_watch.rollback.sql"
CHECK = "scripts/recon/ach-bank-watch-0289-pg-check.sql"
CHECK_0288 = "scripts/recon/ach-annual-reviews-0288-pg-check.sql"
TMP = "/tmp/mut0289.sql"
TMP_RB = "/tmp/mut0289-rb.sql"


def psql_cmd(sql):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)


def psql_file(path):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", path], capture_output=True, text=True)


def control(label):
    r = psql_file(RB)
    ap = psql_file(MIG)
    ck = psql_file(CHECK)
    c88 = psql_file(CHECK_0288)
    ok = (
        r.returncode == 0 and ap.returncode == 0 and ck.returncode == 0 and c88.returncode == 0
        and "ACH 0289 CHECK PASSED" in (ck.stdout + ck.stderr)
        and "ACH 0288 CHECK PASSED" in (c88.stdout + c88.stderr)
    )
    print(f"control ({label})", "pass" if ok else f"FAILED rb={r.returncode} apply={ap.returncode} check={ck.returncode} c88={c88.returncode} {(ck.stderr or c88.stderr or ap.stderr or r.stderr)[-300:]}", flush=True)
    return ok


M = [
    # --- rules table checks ---
    ("rule-short-ok", "match_text  text not null check (length(trim(match_text)) between 3 and 60 and match_text !~ '[0-9]{7,}'),", "match_text  text not null check (length(trim(match_text)) between 1 and 60 and match_text !~ '[0-9]{7,}'),"),
    ("rule-digits-ok", "match_text  text not null check (length(trim(match_text)) between 3 and 60 and match_text !~ '[0-9]{7,}'),", "match_text  text not null check (length(trim(match_text)) between 3 and 60),"),
    ("rule-zero-limit-ok", "max_cents   bigint check (max_cents is null or max_cents > 0),", "max_cents   bigint check (max_cents is null or max_cents >= 0),"),
    ("rule-note-short-ok", "note        text not null check (length(trim(note)) between 10 and 300 and note !~ '[0-9]{7,}'),", "note        text not null check (length(trim(note)) between 1 and 300 and note !~ '[0-9]{7,}'),"),
    ("rule-note-digits-ok", "note        text not null check (length(trim(note)) between 10 and 300 and note !~ '[0-9]{7,}'),", "note        text not null check (length(trim(note)) between 10 and 300),"),
    # --- reviews table checks ---
    ("review-id-any", "transaction_id  text not null check (transaction_id ~ '^[A-Za-z0-9_-]{6,128}$'),", "transaction_id  text not null check (length(transaction_id) > 0),"),
    ("review-verdict-any", "verdict         text not null check (verdict in ('known', 'reported_to_bank', 'returned_payment', 'fee', 'not_ours')),", "verdict         text not null,"),
    ("review-note-short-ok", "note            text not null check (length(trim(note)) between 10 and 500 and note !~ '[0-9]{7,}'),", "note            text not null check (length(trim(note)) between 1 and 500 and note !~ '[0-9]{7,}'),"),
    ("review-note-digits-ok", "note            text not null check (length(trim(note)) between 10 and 500 and note !~ '[0-9]{7,}'),", "note            text not null check (length(trim(note)) between 10 and 500),"),
    # --- rules guard ---
    ("rules-delete-allowed", "  if tg_op = 'DELETE' then\n    raise exception 'ACH_WATCH_RETIRE: a known-payee rule is never deleted.", "  if false then\n    raise exception 'ACH_WATCH_RETIRE: a known-payee rule is never deleted."),
    ("rules-owner-skipped", "    if not public.ach_write_by_owner(new.created_by) then\n      raise exception 'ACH_OWNER_ONLY: only the owner adds", "    if false then\n      raise exception 'ACH_OWNER_ONLY: only the owner adds"),
    ("rules-owner-stamp-only", "    if not public.ach_write_by_owner(new.created_by) then\n      raise exception 'ACH_OWNER_ONLY: only the owner adds", "    if not public.ach_actor_is_owner(new.created_by) then\n      raise exception 'ACH_OWNER_ONLY: only the owner adds"),
    ("rules-start-retired-ok", "    if new.retired_at is not null or new.retired_by is not null then", "    if false then"),
    ("rules-re-retire-ok", "  if old.retired_at is not null then", "  if false then"),
    ("rules-edit-ok", "  if new.retired_at is null or new.retired_by is null then", "  if false then"),
    ("rules-edit-while-retiring-ok", "  if new.id <> old.id or new.match_text <> old.match_text\n     or new.max_cents is distinct from old.max_cents", "  if new.id <> old.id or new.match_text <> old.match_text\n     or false"),
    ("rules-retire-by-admin-ok", "  if not public.ach_write_by_owner(new.retired_by) then", "  if false then"),
    ("rules-retire-backdate-ok", "  if new.retired_at > now() + interval '5 minutes' or new.retired_at < now() - interval '1 day' then", "  if new.retired_at > now() + interval '5 minutes' then"),
    # --- reviews guard ---
    ("reviews-update-allowed", "  if tg_op <> 'INSERT' then\n    raise exception 'ACH_WATCH_APPEND_ONLY", "  if tg_op = 'DELETE' then\n    raise exception 'ACH_WATCH_APPEND_ONLY"),
    ("reviews-delete-allowed", "  if tg_op <> 'INSERT' then\n    raise exception 'ACH_WATCH_APPEND_ONLY", "  if tg_op = 'UPDATE' then\n    raise exception 'ACH_WATCH_APPEND_ONLY"),
    ("reviews-anyone", "  if not (\n    public.ach_write_by_owner(new.created_by)", "  if false and not (\n    public.ach_write_by_owner(new.created_by)"),
    ("reviews-manager-ok", "where id = new.created_by and active = true and role = 'admin')", "where id = new.created_by and active = true and role in ('admin', 'manager'))"),
    ("reviews-inactive-ok", "where id = new.created_by and active = true and role = 'admin')", "where id = new.created_by and role = 'admin')"),
    ("reviews-jwt-ignored", "      and (auth.uid() is null or auth.uid() = new.created_by)", "      and true"),
    ("guard-security-definer", "returns trigger\nlanguage plpgsql\nset search_path = public, pg_temp\nas $$\nbegin\n  if tg_op <> 'INSERT'", "returns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = public, pg_temp\nas $$\nbegin\n  if tg_op <> 'INSERT'"),
    ("rules-truncate-allowed", "create trigger trg_ach_bank_watch_rules_no_truncate\n  before truncate on public.ach_bank_watch_rules\n  for each statement execute function public.ach_bank_watch_no_truncate();", "-- no truncate trigger"),
    ("reviews-truncate-allowed", "create trigger trg_ach_bank_watch_reviews_no_truncate\n  before truncate on public.ach_bank_watch_reviews\n  for each statement execute function public.ach_bank_watch_no_truncate();", "-- no truncate trigger"),
    # --- grants and RLS ---
    ("rules-service-delete", "revoke delete, truncate on table public.ach_bank_watch_rules from service_role;", "grant delete on table public.ach_bank_watch_rules to service_role;"),
    ("reviews-service-update", "revoke update, delete, truncate on table public.ach_bank_watch_reviews from service_role;", "grant update on table public.ach_bank_watch_reviews to service_role;"),
    ("rules-authenticated-insert", "grant select on table public.ach_bank_watch_rules to authenticated;", "grant select, insert on table public.ach_bank_watch_rules to authenticated;"),
    ("reviews-authenticated-insert", "grant select on table public.ach_bank_watch_reviews to authenticated;", "grant select, insert on table public.ach_bank_watch_reviews to authenticated;"),
    ("rules-anon-read", "revoke all on table public.ach_bank_watch_rules from anon;", "grant select on table public.ach_bank_watch_rules to anon;"),
    ("reviews-anon-read", "revoke all on table public.ach_bank_watch_reviews from anon;", "grant select on table public.ach_bank_watch_reviews to anon;"),
    ("rules-rls-open", "create policy ach_bank_watch_rules_admin_read on public.ach_bank_watch_rules\n  for select using (public.is_admin());", "create policy ach_bank_watch_rules_admin_read on public.ach_bank_watch_rules\n  for select using (true);"),
    ("reviews-rls-open", "create policy ach_bank_watch_reviews_admin_read on public.ach_bank_watch_reviews\n  for select using (public.is_admin());", "create policy ach_bank_watch_reviews_admin_read on public.ach_bank_watch_reviews\n  for select using (true);"),
]


def probe_rolled_back():
    r = psql_file(RB)
    ck = psql_file(CHECK)
    ok = r.returncode == 0 and ck.returncode != 0
    print(f"{'killed  ' if ok else 'SURVIVED'} rolled-back  (the 0289 check {'fails' if ck.returncode else 'PASSED'} with no table)", flush=True)
    ap = psql_file(MIG)
    return ok and ap.returncode == 0


def probe_rollback_refuses():
    rb = open(RB).read()
    sql = (
        "begin;\n"
        "insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000289', 'rb0289@x.test');\n"
        "insert into public.staff_profiles (id, email, role, active) values ('00000000-0000-4000-8000-000000000289', 'rb0289@x.test', 'owner', true)"
        " on conflict (id) do update set role = excluded.role, active = excluded.active;\n"
        "select set_config('request.jwt.claim.sub', '', true);\n"
        "insert into public.ach_bank_watch_rules (match_text, note, created_by) values"
        " ('Waste Co', 'Garbage pickup, monthly', '00000000-0000-4000-8000-000000000289');\n"
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
