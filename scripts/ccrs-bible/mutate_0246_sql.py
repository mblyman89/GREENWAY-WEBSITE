#!/usr/bin/env python3
"""Test the test: each mutant of migration 0246 / its rollback must make
scripts/recon/ccrs-lot-id-passthrough-pg-check.sql FAIL. Needs PGURL.
Usage: PGURL=postgres://... python3 scripts/ccrs-bible/mutate_0246_sql.py"""
import os, subprocess, sys, shutil
MIG = "supabase/migrations/0246_ccrs_lot_external_id_passthrough.sql"
RB = "supabase/rollbacks/0246_ccrs_lot_external_id_passthrough.rollback.sql"
CHECK = "scripts/recon/ccrs-lot-id-passthrough-pg-check.sql"
MUTANTS = [
    ("Q1", MIG, "where l.notes like '%Cultivera migration (one-time POS import).%'\n     and ", "where "),
    ("Q2", MIG, "     and trim(l.lot_code) like '%.%'\n", ""),
    ("Q3", MIG, "set ccrs_inventory_external_id = trim(l.lot_code)", "set ccrs_inventory_external_id = l.lot_code"),
    ("Q4", MIG, "     and l.ccrs_inventory_external_id = left(\n           trim(both '-' from regexp_replace(trim(l.lot_code), '[^A-Za-z0-9]+', '-', 'g')),\n           100\n         )\n", "\n"),
    # Q5 (drop an "is distinct from trim(lot_code)" guard) was an EQUIVALENT
    # mutant: a dotted lot_code never equals its dot-free sanitized form. The
    # guard was removed from 0246 rather than kept as dead logic.
    ("Q5", MIG, "trim(l.lot_code) like '%.%'", "trim(l.lot_code) like '%'"),
    ("Q6", MIG, "'migration:0246',", "'migration:0246x',"),
    ("Q7", MIG, "jsonb_build_object('ccrs_inventory_external_id', r.before_id)", "jsonb_build_object('ccrs_inventory_external_id', r.after_id)"),
    ("Q8", RB, "   and l.ccrs_inventory_external_id = a.after_json ->> 'ccrs_inventory_external_id';", ";"),
    ("Q9", RB, "delete from public.audit_logs", "select 1 from public.audit_logs"),
]
url = os.environ.get("PGURL")
if not url:
    print("PGURL not set: SKIPPED (no database)"); sys.exit(2)
def run():
    r = subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-f", CHECK], capture_output=True, text=True)
    return r.returncode == 0 and "CHECK PASSED" in (r.stdout + r.stderr)
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
