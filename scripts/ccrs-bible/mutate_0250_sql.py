#!/usr/bin/env python3
"""Test the test: each mutant of migration 0250 / its rollback must make
scripts/recon/obligation-waivers-pg-check.sql FAIL. Needs PGURL (a database
with all migrations through 0249 applied; the check rolls 0250 back first).
Usage: PGURL=postgres://... python3 scripts/ccrs-bible/mutate_0250_sql.py"""
import os, subprocess, sys, shutil
MIG = "supabase/migrations/0250_obligation_waivers.sql"
RB = "supabase/rollbacks/0250_obligation_waivers.rollback.sql"
CHECK = "scripts/recon/obligation-waivers-pg-check.sql"
# EQUIVALENT mutants, deliberately not run (no database state can tell them apart):
#  * dropping the to_char round-trip in obligation_waivers_is_sunday: the
#    regex already fixes the shape YYYY-MM-DD, and for that shape Postgres's
#    ::date either raises (caught -> false) or round-trips exactly. Kept as
#    defence in depth in case the regex is ever loosened.
#  * the outer CASE's "else false": unreachable, obligation_waivers_obligation_chk
#    already rejects any other obligation.
#  * the guard's "new.obligation is distinct from old.obligation" line: the
#    weekly and monthly key shapes are disjoint, so changing obligation alone
#    always fails obligation_waivers_period_chk anyway (and changing both is
#    caught by the period_key line). Kept so the guard says WHY.
MUTANTS = [
    # obligation list
    ("W1", MIG, "check (obligation in ('ccrs_weekly', 'liq1295'))", "check (obligation in ('ccrs_weekly', 'liq1295', 'dor_excise'))"),
    # period keys
    ("W2", MIG, "          period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'", "          period_key ~ '^[0-9]{4}-[0-9]{2}$'"),
    ("W3", MIG, "  return to_char(v, 'YYYY-MM-DD') = d and extract(isodow from v) = 7;", "  return to_char(v, 'YYYY-MM-DD') = d;"),
    ("W5", MIG, "    return false;\n  end;", "    return true;\n  end;"),
    ("W7", MIG, "            when period_key ~ '^W-[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'", "            when period_key ~ '[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'"),
    # reason
    ("W8", MIG, "check (char_length(btrim(reason)) between 10 and 500)", "check (char_length(reason) between 10 and 500)"),
    ("W9", MIG, "check (char_length(btrim(reason)) between 10 and 500)", "check (char_length(btrim(reason)) between 10 and 501)"),
    ("W10", MIG, "check (char_length(btrim(reason)) between 10 and 500)", "check (char_length(btrim(reason)) between 11 and 500)"),
    # revoke pair
    ("W11", MIG, "check (revoked_at is not null or (revoked_by is null and revoked_by_email is null))", "check (true)"),
    # one live
    ("W12", MIG, "create unique index if not exists obligation_waivers_one_live", "create index if not exists obligation_waivers_one_live"),
    ("W13", MIG, "  on public.obligation_waivers (obligation, period_key)\n  where revoked_at is null;", "  on public.obligation_waivers (obligation, period_key);"),
    # guard
    ("W14", MIG, "  if tg_op = 'DELETE' then\n    raise exception 'WAIVER_PERMANENT", "  if false then\n    raise exception 'WAIVER_PERMANENT"),
    ("W15", MIG, "  if old.revoked_at is not null then\n    raise exception 'WAIVER_ALREADY_UNDONE", "  if false then\n    raise exception 'WAIVER_ALREADY_UNDONE"),
    ("W16", MIG, "  if new.revoked_at is null then\n    raise exception 'WAIVER_ONLY_UNDO", "  if false then\n    raise exception 'WAIVER_ONLY_UNDO"),
    ("W17", MIG, "     or new.reason is distinct from old.reason\n", ""),
    ("W18", MIG, "     or new.period_key is distinct from old.period_key\n", ""),
    ("W19", MIG, "     or new.waived_at is distinct from old.waived_at\n", ""),
    ("W20", MIG, "     or new.waived_by_email is distinct from old.waived_by_email then", "     then"),
    ("W22", MIG, "  before update or delete on public.obligation_waivers", "  before update on public.obligation_waivers"),
    # set-null cascade branch
    ("W23", MIG, "     and new.reason = old.reason\n     and new.waived_at", "     and new.waived_at"),
    ("W24", MIG, "     and (new.waived_by is distinct from old.waived_by or new.revoked_by is distinct from old.revoked_by) then\n    return new;", "     and false then\n    return new;"),
    ("W25", MIG, "     and new.revoked_by_email is not distinct from old.revoked_by_email\n", ""),
    # RLS / grants
    ("W26", MIG, "alter table public.obligation_waivers enable row level security;\n", ""),
    ("W27", MIG, "  for all using (public.is_admin()) with check (public.is_admin());", "  for all using (public.is_staff()) with check (public.is_staff());"),
    ("W28", MIG, "  for select using (public.is_staff());", "  for select using (true);"),
    ("W29", MIG, "grant select, insert, update on public.obligation_waivers to service_role;", "grant select on public.obligation_waivers to service_role;"),
    # rollback
    ("W30", RB, "      raise exception 'ROLLBACK_REFUSED", "      raise notice 'ROLLBACK_REFUSED"),
    ("W31", RB, "drop function if exists public.obligation_waivers_guard();", "select 1;"),
    ("W32", RB, "drop function if exists public.obligation_waivers_is_sunday(text);", "select 1;"),
    ("W33", RB, "  if to_regclass('public.obligation_waivers') is not null then\n    if exists", "  if true then\n    if exists"),
]
url = os.environ.get("PGURL")
if not url:
    print("PGURL not set: SKIPPED (no database)"); sys.exit(2)
def run():
    r = subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-f", CHECK], capture_output=True, text=True)
    return r.returncode == 0 and "OBLIGATION WAIVERS CHECK PASSED" in (r.stdout + r.stderr)
assert run(), "baseline check must pass before mutating"
killed = survived = 0
for mid, f, old, new in MUTANTS:
    src = open(f).read()
    if src.count(old) != 1:
        print(f"{mid} STALE (anchor count {src.count(old)})"); survived += 1; continue
    shutil.copy(f, f + ".bak")
    try:
        open(f, "w").write(src.replace(old, new))
        ok = run()
    finally:
        shutil.move(f + ".bak", f)
    print(f"{mid} {'SURVIVED' if ok else 'killed'}")
    killed += (not ok); survived += ok
assert run(), "baseline must pass after restore"
print(f"killed={killed} survived={survived}")
sys.exit(1 if survived else 0)
