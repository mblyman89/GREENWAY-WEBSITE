#!/usr/bin/env python3
"""
mutate-slice-books-06.py — PROVE THE OWNER-GATE TESTS CAN ACTUALLY FAIL.

WHY THIS SCRIPT EXISTS (standing rule 15)
-----------------------------------------
A passing test suite proves nothing on its own. It might be asserting things
that are true no matter what -- or, as happened in slice 5, it might not be
running at all while the harness reports success.

So this script deliberately BREAKS the owner gate, one defect at a time, and
demands that the suite go red for each one. A mutant that survives is a hole in
the tests, and the script says so loudly.

SELF-PROVING INSTRUMENT (the slice-5 lesson, defect D16)
--------------------------------------------------------
In slice 5 a mutation campaign reported "4/4 killed" while measuring NOTHING:
the runner was passed a reporter flag that does not exist, so vitest died at
startup with exit 1 and the script scored every non-zero exit as a kill.

This script refuses to make that mistake:
  1. BASELINE GATE   - the unmutated suite must PASS first. If the suite is
                       already red, nothing below is interpretable.
  2. COLLECTION PROOF- every run must show evidence that tests were actually
                       collected and executed ("Tests <n> passed/failed").
                       A non-zero exit WITHOUT that evidence is INCONCLUSIVE,
                       not a kill.
  3. NO-OP DETECTION - if the mutation did not change the file, that is a
                       broken mutant, not a survivor.
  4. EXACT RESTORE   - every file is restored byte-for-byte and verified.

Usage:  python3 scripts/compliance/mutate-slice-books-06.py
Exit 0 only if every mutant was killed with real evidence.
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

CORE = REPO / "src/lib/auth/owner-gate-core.ts"
ROLES = REPO / "src/lib/auth/roles.ts"
MIGRATION = REPO / "supabase/migrations/0190_owner_only_financial_tables.sql"
NAV = REPO / "src/components/admin/admin-nav-data.ts"

TEST_CMD = [
    "npx", "vitest", "run",
    "tests/compliance/owner-gate-core.test.ts",
    "tests/compliance/books-view-core.test.ts",
]

# (id, file, old, new, what real-world defect this simulates)
MUTANTS = [
    (
        "M1-admin-regains-finances",
        ROLES,
        '"finances.view": ["owner"],',
        '"finances.view": ["owner", "admin"],',
        "Someone 'helpfully' re-adds admin to the money pages.",
    ),
    (
        "M2-nav-reverts-to-settings",
        NAV,
        '{ label: "ATM", href: "/admin/atm", permission: "finances.view"',
        '{ label: "ATM", href: "/admin/atm", permission: "settings.manage"',
        "The nav drifts back to the old permission while the page stays owner-only.",
    ),
    (
        "M3-table-dropped-from-migration",
        MIGRATION,
        "    'plaid_transactions',\n",
        "",
        "A money table quietly falls out of the re-gate allow-list.",
    ),
    (
        "M4-regate-to-admin-not-owner",
        MIGRATION,
        "replace(coalesce(r.qual,      ''), 'is_staff()', 'is_owner()')",
        "replace(coalesce(r.qual,      ''), 'is_staff()', 'is_admin()')",
        "The migration locks to is_admin() instead of is_owner() -- still lets admin in.",
    ),
    (
        "M5-preflight-guard-removed",
        MIGRATION,
        "MIGRATION_OUT_OF_ORDER: 0190 requires the is_owner() helper",
        "OUT_OF_ORDER: 0190 requires the is_owner() helper",
        "The out-of-order error code is renamed, so nothing detects it.",
    ),
    (
        "M6-guard-stops-naming-the-file",
        MIGRATION,
        "Run 0157_plaid_foundation.sql first",
        "Run the earlier migration first",
        "The guard stops telling the owner WHICH file to run.",
    ),
    (
        # NOTE: this mutant targets the EXECUTABLE detail string, not the
        # explanatory comment above it. The first version of this mutant
        # changed only the comment (replace(..., 1) hit the comment first),
        # SURVIVED, and exposed a test that a comment could satisfy. Both the
        # mutant and the test were hardened. Keep the leading quote.
        "M7-audit-loses-second-check",
        MIGRATION,
        "'exists but has no is_owner() policy",
        "'policy missing",
        "The audit stops reporting tables that have no owner policy at all.",
    ),
    (
        "M7b-audit-second-branch-deleted",
        MIGRATION,
        "  union all\n  -- (b) any listed table that EXISTS but has no is_owner() policy at all.",
        "  union all select 'x'::text, 'x'::text, 'x'::text where false;\n  -- disabled",
        "The whole second branch of the audit UNION is disabled.",
    ),
    (
        "M8-authority-paraphrased",
        CORE,
        "Grant access to taxpayer information systems only on a valid need-to-know basis",
        "Grant access only on a need-to-know basis roughly speaking",
        "A verbatim IRS quote gets paraphrased, breaking DB/app agreement.",
    ),
    (
        "M9-token-downgraded",
        CORE,
        'exposure: "credential"',
        'exposure: "activity"',
        "The Plaid access token stops being classed as a credential.",
    ),
    (
        "M10-vault-swept-in",
        CORE,
        'route: "/admin/settings/banking",\n    permission: "settings.manage",',
        'route: "/admin/settings/banking",\n    permission: "finances.view",',
        "The payee vault is swept into the owner gate, taking away admin's job.",
    ),
]


# Some defects cannot be caught by reading the migration as TEXT -- deleting a
# whole branch of the audit's UNION leaves every keyword on the page. Those are
# only catchable by RUNNING the SQL against a real database and watching what
# the audit actually reports. Set OWNER_GATE_PG=1 to include that stage.
PG_DB = os.environ.get("OWNER_GATE_PG_DB", "greenway_test")
USE_PG = os.environ.get("OWNER_GATE_PG") == "1"


def run_pg_stage():
    """Apply the (possibly mutated) migration + run the adversarial SQL suite.

    Returns (ok, detail). ok=False means the live database noticed the defect.
    """
    mig = REPO / "supabase/migrations/0190_owner_only_financial_tables.sql"
    sql = REPO / "scripts/compliance/e2e-owner-gate.sql"
    for src, dst in ((mig, "/tmp/_mut0190.sql"), (sql, "/tmp/_mutog.sql")):
        shutil.copy2(src, dst)
        os.chmod(dst, 0o644)

    # Re-apply the migration so the mutated definition is what gets tested.
    #
    # THE EXIT CODE OF THIS APPLY MATTERS AND WAS ONCE IGNORED.
    #
    # Mutant M7b (deleting a branch of the audit's UNION) produced SQL that
    # would not parse. The apply failed, the PREVIOUS, CORRECT function stayed
    # installed in the database, the adversarial suite passed against it, and
    # the campaign scored the mutant as "survived" -- when in truth the mutated
    # code had never been tested at all. That is the exact false-measurement
    # class as the slice-5 reporter bug.
    #
    # A migration that REFUSES TO APPLY is a legitimate kill: the defect is
    # caught, loudly, at the moment the owner would have run it.
    ap = subprocess.run(
        ["sudo", "-u", "postgres", "psql", "-d", PG_DB, "-v", "ON_ERROR_STOP=1",
         "-f", "/tmp/_mut0190.sql"],
        cwd=REPO, capture_output=True, text=True, timeout=300,
    )
    ap_out = (ap.stdout or "") + (ap.stderr or "")
    if ap.returncode != 0 or re.search(r"^psql.*ERROR", ap_out, re.M):
        first = next((l for l in ap_out.splitlines() if "ERROR" in l), "apply failed")
        return False, "migration REFUSED TO APPLY -> %s" % first.strip()[:110]
    p = subprocess.run(
        ["sudo", "-u", "postgres", "psql", "-d", PG_DB, "-f", "/tmp/_mutog.sql"],
        cwd=REPO, capture_output=True, text=True, timeout=300,
    )
    out = (p.stdout or "") + (p.stderr or "")
    passes = len(re.findall(r"^ pass ", out, re.M))
    fails = len(re.findall(r"^ FAIL", out, re.M))
    errors = len(re.findall(r"^psql.*ERROR", out, re.M))
    if passes == 0:
        return None, "no assertions ran (inconclusive)"
    if fails or errors:
        return False, "%d FAIL / %d ERROR (of %d assertions)" % (fails, errors, passes + fails)
    return True, "%d assertions all passed" % passes


def run_suite():
    """Run the suite. Returns (exit_code, combined_output)."""
    p = subprocess.run(
        TEST_CMD, cwd=REPO, capture_output=True, text=True, timeout=600,
    )
    return p.returncode, (p.stdout or "") + (p.stderr or "")


COLLECTED = re.compile(r"Tests\s+.*?(\d+)")


def has_evidence(out):
    """Did the runner actually collect and execute tests?"""
    return bool(COLLECTED.search(out)) or "Test Files" in out


def main():
    print("=" * 74)
    print("SLICE books-06 — MUTATION CAMPAIGN ON THE OWNER GATE")
    print("=" * 74)

    # ---------------- BASELINE GATE ----------------
    print("\n[baseline] running the suite UNMUTATED — it must PASS...")
    code, out = run_suite()
    if not has_evidence(out):
        print("BASELINE INCONCLUSIVE: the runner produced no test counts.")
        print(out[-2000:])
        return 1
    if code != 0:
        print("BASELINE FAILED: the suite is already red. Fix that first;")
        print("nothing below would be interpretable.")
        print(out[-2000:])
        return 1
    m = COLLECTED.search(out)
    print("[baseline] PASS — %s" % (m.group(0).strip() if m else "tests ran"))

    if USE_PG:
        print("[baseline] running the LIVE DATABASE stage unmutated...")
        ok, detail = run_pg_stage()
        if ok is not True:
            print("BASELINE PG STAGE NOT GREEN (%s). Fix that first." % detail)
            return 1
        print("[baseline] live pg PASS — %s" % detail)

    killed, survived, noop, inconclusive = [], [], [], []

    for mid, path, old, new, why in MUTANTS:
        print("\n" + "-" * 74)
        print("MUTANT %s  (%s)" % (mid, path.name))
        print("  simulates: %s" % why)

        original = path.read_text(encoding="utf-8")
        if original.count(old) < 1:
            print("  RESULT: BROKEN MUTANT — anchor not found. Cannot test.")
            noop.append(mid)
            continue

        backup = Path(tempfile.mkdtemp()) / path.name
        shutil.copy2(path, backup)

        try:
            mutated = original.replace(old, new, 1)
            if mutated == original:
                print("  RESULT: NO-OP — the file did not change.")
                noop.append(mid)
                continue
            path.write_text(mutated, encoding="utf-8")

            code, out = run_suite()

            # If the static suite did not catch it, ask the live database.
            pg_ok, pg_detail = (None, "skipped")
            if code == 0 and USE_PG and path.name.endswith(".sql"):
                pg_ok, pg_detail = run_pg_stage()
                print("  [live pg] %s" % pg_detail)
                if pg_ok is False:
                    print("  RESULT: KILLED by the LIVE DATABASE stage")
                    killed.append(mid)
                    continue

            if not has_evidence(out):
                print("  RESULT: INCONCLUSIVE — no test counts in the output.")
                print("          (exit=%d) This is NOT a kill." % code)
                inconclusive.append(mid)
            elif code != 0:
                fails = re.search(r"Tests\s+.*?(\d+)\s+failed", out)
                print("  RESULT: KILLED — suite went red%s"
                      % (" (%s failed)" % fails.group(1) if fails else ""))
                killed.append(mid)
            else:
                print("  RESULT: *** SURVIVED *** — the tests did not notice.")
                print("          THIS IS A HOLE IN THE TEST SUITE.")
                survived.append(mid)
        finally:
            shutil.copy2(backup, path)
            # If the PG stage ran, re-apply the RESTORED migration so a mutated
            # (or half-applied) definition can never leak into the next mutant's
            # measurement or be left behind in the database.
            if USE_PG and path.name.endswith(".sql"):
                shutil.copy2(path, "/tmp/_mut0190.sql")
                os.chmod("/tmp/_mut0190.sql", 0o644)
                subprocess.run(
                    ["sudo", "-u", "postgres", "psql", "-d", PG_DB,
                     "-v", "ON_ERROR_STOP=1", "-f", "/tmp/_mut0190.sql"],
                    cwd=REPO, capture_output=True, text=True, timeout=300,
                )
            restored = path.read_text(encoding="utf-8")
            if restored != original:
                print("  !! RESTORE FAILED for %s" % path)
                return 2

    print("\n" + "=" * 74)
    print("RESULT: %d killed / %d survived / %d no-op / %d inconclusive  (of %d)"
          % (len(killed), len(survived), len(noop), len(inconclusive), len(MUTANTS)))
    print("=" * 74)
    for label, group in (("SURVIVED", survived), ("NO-OP", noop),
                         ("INCONCLUSIVE", inconclusive)):
        if group:
            print("%s: %s" % (label, ", ".join(group)))

    ok = not survived and not noop and not inconclusive
    print("\n%s" % ("ALL MUTANTS KILLED WITH REAL EVIDENCE."
                    if ok else "CAMPAIGN NOT CLEAN — see above."))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
