#!/usr/bin/env python3
"""R28 - SQL mutation harness for migration 0252 + its rollback.

Each mutant writes a mutated copy of 0252 (or its rollback) to /tmp, points a
copy of scripts/recon/lab-coa-extract-pg-check.sql at it, and runs it against
the local real Postgres (PGURL). A mutant is KILLED when the check fails.
Sources in the repo are never edited.

Usage: PGURL=... python3 scripts/r28/mutate_0252_sql.py [--preflight] [filter...]
"""
import os, subprocess, sys

MIG = "supabase/migrations/0252_lab_coa_extract.sql"
RB = "supabase/rollbacks/0252_lab_coa_extract.rollback.sql"
CHECK = "scripts/recon/lab-coa-extract-pg-check.sql"
MIG_REF = "../../" + MIG
RB_REF = "../../" + RB

MUTANTS = [
    ("pdf_link_accepted", MIG, "     and btrim(it.value ->> 'lab_result_link') !~* '[.]pdf([?#]|$)'\n", "\n"),
    ("http_link_accepted", MIG, "     and btrim(it.value ->> 'lab_result_link') ~* '^https://'\n", "\n"),
    ("ambiguous_filled", MIG, "  having count(distinct link) = 1\n", "\n"),
    ("overwrite_existing", MIG, "   and r.wcia_json_url is null;", ";"),
    ("any_delivery", MIG, "    join public.inbound_manifests m on m.id = l.manifest_id\n", "    join public.inbound_manifests m on true\n"),
    ("no_lab_id_match", MIG, "     and (it.value -> 'lab_result_data' ->> 'lab_result_id') = r.labtest_external_identifier\n", "\n"),
    ("no_trim", MIG, "         btrim(it.value ->> 'lab_result_link') as link", "         (it.value ->> 'lab_result_link') as link"),
    ("trim_after_test", MIG, "     and btrim(it.value ->> 'lab_result_link') ~* '^https://'", "     and (it.value ->> 'lab_result_link') ~* '^https://'"),
    ("status_any", MIG, "check (coa_extract_status is null or coa_extract_status in ('ok', 'partial', 'failed'));", "check (true);"),
    ("status_no_failed", MIG, "coa_extract_status in ('ok', 'partial', 'failed')", "coa_extract_status in ('ok', 'partial')"),
    ("extract_any_json", MIG, "check (coa_extract_json is null or jsonb_typeof(coa_extract_json) = 'object');", "check (true);"),
    ("pair_unchecked", MIG, "check ((coa_extract_json is null) = (coa_extract_status is null));", "check (true);"),
    ("pair_one_way", MIG, "check ((coa_extract_json is null) = (coa_extract_status is null));", "check (coa_extract_json is null or coa_extract_status is not null);"),
    ("url_any", MIG, "check (wcia_json_url is null or wcia_json_url ~* '^https://');", "check (true);"),
    ("url_case_sensitive", MIG, "wcia_json_url ~* '^https://');", "wcia_json_url ~ '^https://');"),
    ("extract_text_type", MIG, "add column if not exists coa_extract_json jsonb,", "add column if not exists coa_extract_json text,"),
    ("extracted_at_no_tz", MIG, "add column if not exists coa_extracted_at timestamptz;", "add column if not exists coa_extracted_at timestamp;"),
    ("no_drop_before_add", MIG, "alter table public.lab_results drop constraint if exists lab_results_coa_extract_status_check;\n", "\n"),
    ("rb_keeps_status_col", RB, "  drop column if exists coa_extract_status,\n", ""),
    # Not listed: dropping a constraint line from the rollback is an
    # EQUIVALENT mutant - dropping the column drops its check constraint too.
    ("rb_keeps_extract_col", RB, "  drop column if exists coa_extract_json,\n", ""),
    ("rb_keeps_url_col", RB, "  drop column if exists wcia_json_url;", "  drop column if exists coa_extracted_at;"),
]


def run_check(mig_path, rb_path):
    s = open(CHECK).read()
    s = s.replace("\\ir " + MIG_REF, "\\i " + mig_path).replace("\\ir " + RB_REF, "\\i " + rb_path)
    tmp = "/tmp/r28_check_mut.sql"
    open(tmp, "w").write(s)
    r = subprocess.run(["psql", os.environ["PGURL"], "-v", "ON_ERROR_STOP=1", "-q", "-f", tmp],
                       capture_output=True, text=True)
    ok = r.returncode == 0 and "LAB COA EXTRACT CHECK PASSED" in (r.stdout + r.stderr)
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
        out = f"/tmp/r28_mut_{os.path.basename(path)}"
        open(out, "w").write(src.replace(old, new))
        mig = out if path == MIG else os.path.abspath(MIG)
        rb = out if path == RB else os.path.abspath(RB)
        passed, msg = run_check(mig, rb)
        print(("SURVIVED " if passed else "killed   ") + name + ("" if passed else "  <- " + msg[:110]))
        if passed:
            survived.append(name)
    print(f"{len(survived)} survived of {len(MUTANTS)}")
    sys.exit(1 if survived else 0)


if __name__ == "__main__":
    main()
