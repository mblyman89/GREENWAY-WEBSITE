#!/usr/bin/env python3
"""R27 - SQL mutation harness for migration 0251 + its rollback.

Each mutant writes a mutated copy of 0251 (or its rollback) to /tmp, points a
copy of scripts/recon/wa-total-thc-repair-pg-check.sql at it, and runs it
against the local real Postgres (PGURL). A mutant is KILLED when the check
fails. Sources in the repo are never edited.

Usage: PGURL=... python3 scripts/r27/mutate_0251_sql.py [--preflight] [filter...]
"""
import os, subprocess, sys

MIG = "supabase/migrations/0251_wa_total_thc_cbd_repair.sql"
RB = "supabase/rollbacks/0251_wa_total_thc_cbd_repair.rollback.sql"
CHECK = "scripts/recon/wa-total-thc-repair-pg-check.sql"
MIG_REF = "../../" + MIG
RB_REF = "../../" + RB

MUTANTS = [
    ("total_cannabinoids_not_total_thc", MIG, "then (r.potency_json ->> 'total-thc')::numeric end as rep_thc", "then (r.potency_json ->> 'total-cannabinoids')::numeric end as rep_thc"),
    ("string_values_accepted", MIG, "case when jsonb_typeof(r.potency_json -> 'total-thc') = 'number'", "case when jsonb_typeof(r.potency_json -> 'total-thc') in ('number','string')"),
    ("negative_accepted", MIG, "and (r.potency_json ->> 'total-thc')::numeric >= 0", "and true"),
    ("cbd_from_thc", MIG, "then (r.potency_json ->> 'total-cbd')::numeric end as rep_cbd", "then (r.potency_json ->> 'total-thc')::numeric end as rep_cbd"),
    ("missing_report_nulls_value", MIG, "coalesce(rep_thc, before_thc) as new_thc", "rep_thc as new_thc"),
    ("missing_cbd_report_nulls_value", MIG, "coalesce(rep_cbd, before_cbd) as new_cbd", "rep_cbd as new_cbd"),
    ("cbd_only_change_ignored", MIG, "     or (rep_cbd is not null and rep_cbd is distinct from before_cbd)\n", "\n"),
    ("rewrite_unchanged_rows", MIG, "  where (rep_thc is not null and rep_thc is distinct from before_thc)\n     or (rep_cbd", "  where true\n     or (rep_cbd"),
    ("draft_edited_overwritten", MIG, "  where d.total_thc_pct is not distinct from f.before_thc\n", "  where true\n"),
    ("draft_wrong_join", MIG, "join labfix f on f.lab_id = d.lab_result_id", "join labfix f on f.lab_id = d.lot_id"),
    ("kb_curated_overwritten", MIG, "case when k.total_thc_pct is not distinct from f.before_thc then f.new_thc else k.total_thc_pct end as new_thc", "f.new_thc as new_thc"),
    ("kb_any_source", MIG, "join labfix f on k.potency_source = 'lab_results:' || f.lab_id", "join labfix f on true"),
    ("no_lab_audit", MIG, "  'migration_0251.lab_total_repair',\n  'lab_result',", "  'migration_0251.lab_total_repairX',\n  'lab_result',"),
    ("no_draft_audit", MIG, "  'migration_0251.draft_total_repair',\n  'catalog_product_draft',", "  'migration_0251.draft_total_repairX',\n  'catalog_product_draft',"),
    ("rb_draft_undoes_human_edit", RB, "   and d.total_thc_pct is not distinct from (a.after_json ->> 'total_thc_pct')::numeric;", ";"),
    ("rb_keeps_audit_rows", RB, "delete from public.audit_logs", "select 1 from public.audit_logs"),
    ("rb_lab_not_restored", RB, "   and a.action = 'migration_0251.lab_total_repair'\n   and a.entity_type = 'lab_result'\n   and a.entity_id = r.id::text;", "   and false;"),
    ("rb_lab_cbd_not_restored", RB, "       total_cbd_pct = case when r.total_cbd_pct is not distinct from (a.after_json ->> 'total_cbd_pct')::numeric\n                            then (a.before_json ->> 'total_cbd_pct')::numeric else r.total_cbd_pct end", "       total_cbd_pct = r.total_cbd_pct"),
    ("rb_kb_not_restored", RB, "   and a.action = 'migration_0251.kb_total_repair'", "   and a.action = 'nothing'"),
]


def run_check(mig_path, rb_path):
    s = open(CHECK).read()
    s = s.replace("\\ir " + MIG_REF, "\\i " + mig_path).replace("\\ir " + RB_REF, "\\i " + rb_path)
    tmp = "/tmp/r27_check_mut.sql"
    open(tmp, "w").write(s)
    r = subprocess.run(["psql", os.environ["PGURL"], "-v", "ON_ERROR_STOP=1", "-q", "-f", tmp],
                       capture_output=True, text=True)
    ok = r.returncode == 0 and "WA TOTAL THC REPAIR CHECK PASSED" in (r.stdout + r.stderr)
    return ok, (r.stderr.strip().splitlines() or [""])[-1]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    ok, msg = run_check(os.path.abspath(MIG), os.path.abspath(RB))
    if not ok:
        print("PREFLIGHT FAILED (unmutated check must pass):", msg); sys.exit(2)
    print("preflight ok")
    if "--preflight" in sys.argv:
        return
    survived = []
    for m in MUTANTS:
        name, path, old, new = m[:4]
        want = m[4] if len(m) > 4 else 1
        if args and not any(a in name for a in args):
            continue
        src = open(path).read()
        if src.count(old) != want:
            print(f"BAD MUTANT {name}: old text found {src.count(old)}x"); sys.exit(3)
        out = f"/tmp/r27_mut_{os.path.basename(path)}"
        open(out, "w").write(src.replace(old, new))
        mig = out if path == MIG else os.path.abspath(MIG)
        rb = out if path == RB else os.path.abspath(RB)
        passed, msg = run_check(mig, rb)
        print(("SURVIVED " if passed else "killed   ") + name + ("" if passed else "  <- " + msg[:110]))
        if passed:
            survived.append(name)
    print(f"{len(survived)} survived")
    sys.exit(1 if survived else 0)


if __name__ == "__main__":
    main()
