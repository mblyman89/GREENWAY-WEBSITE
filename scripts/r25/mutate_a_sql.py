#!/usr/bin/env python3
"""R25 A - SQL mutation harness for migration 0244 + its rollback.

Each mutant writes a mutated copy of 0244 (or its rollback) to /tmp, points a
copy of scripts/recon/intake-lot-facts-pg-check.sql at it, and runs it against
the local real Postgres (PGURL). A mutant is KILLED when the check fails.
Sources in the repo are never edited.

Usage: PGURL=... python3 scripts/r25/mutate_a_sql.py [--preflight] [filter...]
"""
import os, subprocess, sys

MIG = "supabase/migrations/0244_intake_lot_received_date_strain_type_backfill.sql"
RB = "supabase/rollbacks/0244_intake_lot_received_date_strain_type_backfill.rollback.sql"
CHECK = "scripts/recon/intake-lot-facts-pg-check.sql"

MUTANTS = [
    ("no_pos_import_number_exclusion", MIG, "and coalesce(m.manifest_number, '') not like 'POS-IMPORT-%'", "and true"),
    ("no_pos_import_kind_exclusion", MIG, "and coalesce(m.raw_payload ->> 'kind', '') <> 'pos-import-migration'", "and true"),
    ("no_disposition_filter", MIG, "and l.disposition = 'accepted'", "and true"),
    ("no_rejected_status_filter", MIG, "and l.status <> 'rejected'", "and true"),
    ("accepted_at_only_no_least", MIG, "least(\n      m.accepted_at,", "coalesce(\n      m.accepted_at,"),
    ("utc_day_not_pacific", MIG, "(accepted_instant at time zone 'America/Los_Angeles')::date", "(accepted_instant at time zone 'UTC')::date"),
    # Double guard (CTE filter + UPDATE filter): one alone is an equivalent
    # mutant by design, so the mutant removes BOTH (count=2).
    ("overwrite_existing_received_on", MIG, "l.received_on is null\n", "true\n", 2),
    ("wrong_received_source", MIG, "received_on_source = 'manifest',\n         received_on_set_by", "received_on_source = 'owner_entered',\n         received_on_set_by"),
    ("no_received_audit", MIG, "  'migration_0244.received_on_backfill',\n  'inventory_lot',\n  st.id::text,", "  'migration_0244.received_on_backfillX',\n  'inventory_lot',\n  st.id::text,"),
    ("unapproved_drafts_count", MIG, "where d.status = 'approved'", "where d.status is not null"),
    ("oldest_pick_wins", MIG, "order by d.lot_id, d.updated_at desc", "order by d.lot_id, d.updated_at asc"),
    ("junk_pick_allowed", MIG, "and lower(btrim(d.chosen_strain_type)) in ('indica', 'sativa', 'hybrid', 'indica-hybrid', 'sativa-hybrid', 'cbd')", "and true"),
    ("ignore_human_edit", MIG, "and a.action = 'inventory_lot.details_edited'", "and a.action = 'nothing'"),
    ("rewrite_already_reviewer", MIG, "or coalesce(l.fact_provenance ->> 'strain_type', '') <> 'reviewer'\n    )", "or true\n    )"),
    ("wrong_provenance_word", MIG, "|| jsonb_build_object('strain_type', 'reviewer')\n    from targets", "|| jsonb_build_object('strain_type', 'human')\n    from targets"),
    ("rb_received_ignores_human_change", RB, "   and l.received_on_source = 'manifest'\n", "\n"),
    ("rb_strain_ignores_human_change", RB, "   and l.strain_type = a.after_json ->> 'strain_type'\n", "\n"),
    ("rb_keeps_audit_rows", RB, "delete from public.audit_logs", "select 1 from public.audit_logs"),
    ("rb_provenance_not_removed", RB, "then coalesce(l.fact_provenance, '{}'::jsonb) - 'strain_type'", "then coalesce(l.fact_provenance, '{}'::jsonb)"),
]


def run_check(mig_path, rb_path):
    s = open(CHECK).read()
    s = s.replace("\\i " + MIG, "\\i " + mig_path).replace("\\i " + RB, "\\i " + rb_path)
    tmp = "/tmp/r25_check_mut.sql"
    open(tmp, "w").write(s)
    r = subprocess.run(["psql", os.environ["PGURL"], "-v", "ON_ERROR_STOP=1", "-q", "-f", tmp],
                       capture_output=True, text=True)
    ok = r.returncode == 0 and "INTAKE LOT FACTS CHECK PASSED" in (r.stdout + r.stderr)
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
        out = f"/tmp/r25_mut_{os.path.basename(path)}"
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
