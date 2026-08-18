#!/usr/bin/env python3
"""
MUTATION CAMPAIGN - D15: the out-of-order guard on migration 0189.

WHY THIS SCRIPT EXISTS
----------------------
Standing rule 15: every test must be PROVEN CAPABLE OF FAILING. Standing rule 16:
prove the gate is wired. A test that asserts a guard exists is worthless if the
test would also pass with the guard removed.

Migrations in this repo are applied MANUALLY by the owner (AGENTS.md, standing
rule 6), pasted one file at a time in numeric order. Migration 0189 shipped with
no precondition block, so pasted early it would have emitted a raw PostgreSQL
error instead of a sentence naming the file to run first. That was defect D15.

This script mutates the guard six ways and requires the vitest suite to catch
every single one.

A NOTE ON HOW THIS SCRIPT ITSELF FAILED ONCE
--------------------------------------------
The first version of this campaign passed `--reporter=basic` to vitest. That
reporter does not exist in vitest 4; the process died at STARTUP with exit code
1, before collecting a single test. Every mutant therefore looked "killed" and
the campaign reported a perfect score while measuring nothing at all.

That is the same class of error as the earlier `grep -c "^PASS"` incident, where
an uppercase pattern matched a harness that prints lowercase. A green result from
a broken instrument is worse than a red one, because it ends the investigation.

So this script now PROVES ITS OWN INSTRUMENT before it trusts any result:
  * a BASELINE run on unmodified source must PASS (exit 0). If the harness is
    broken, the baseline fails and the campaign aborts instead of scoring.
  * every mutant run must show evidence of ACTUALLY COLLECTING TESTS. A non-zero
    exit with no test-count line is a crashed harness, not a killed mutant, and
    is reported as INCONCLUSIVE - which fails the campaign.
  * every mutation is verified to have really changed the file (a NO-OP mutation
    silently turns an assertion into a tautology).
  * the source is restored and compared byte-for-byte at the end.

USAGE
    python3 scripts/compliance/mutate-migration-preflight.py
    echo $?      # 0 = every mutant killed and the instrument was trustworthy
"""

import io
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MIGRATION = os.path.join(REPO, "supabase", "migrations", "0189_bank_matching.sql")
TEST_FILE = "tests/compliance/bank-match-core.test.ts"
BACKUP = "/tmp/mutate-preflight-0189.bak"

# Vitest prints a line like "Tests  95 passed (95)". Its PRESENCE is how we know
# the harness collected and ran tests rather than dying on startup.
TEST_COUNT_RE = re.compile(r"Tests\s+.*?(\d+)", re.S)


def run_suite():
    """Run the suite. Returns (exit_code, collected_tests_bool, tail_of_output)."""
    proc = subprocess.run(
        ["npx", "vitest", "run", TEST_FILE],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=600,
    )
    out = proc.stdout + proc.stderr
    collected = bool(TEST_COUNT_RE.search(out))
    return proc.returncode, collected, out[-1500:]


# ---------------------------------------------------------------------------
# The mutants. Each takes the original SQL text and returns a damaged version.
# Each represents a REAL way this protection could be lost in a future edit.
# ---------------------------------------------------------------------------
MUTANTS = [
    (
        "P1",
        "delete the entire precondition block",
        lambda s: re.sub(
            r"do \$precheck\$.*?\$precheck\$;",
            "-- (block removed)",
            s,
            flags=re.S,
        ),
    ),
    (
        "P2",
        "keep the block but stop naming the 0185 file",
        lambda s: s.replace("0185_books_owner_only.sql", "the earlier one"),
    ),
    (
        "P3",
        "keep the block but stop naming the Plaid file",
        lambda s: s.replace("0157_plaid_foundation.sql", "the Plaid migration"),
    ),
    (
        "P4",
        "drop the transaction_id uniqueness probe",
        lambda s: s.replace("i.indisunique", "true"),
    ),
    (
        "P5",
        "rename the error code so nothing greps for it",
        lambda s: s.replace("MIGRATION_OUT_OF_ORDER", "SOMETHING_WENT_WRONG"),
    ),
    (
        "P6",
        "move the guard AFTER the first create (a partial build with a message)",
        # Relocate the block to the very end of the file. It still "exists", it
        # still says MIGRATION_OUT_OF_ORDER, and it is completely useless.
        lambda s: (
            re.sub(r"do \$precheck\$.*?\$precheck\$;", "-- (moved)", s, flags=re.S)
            + "\n"
            + (re.search(r"do \$precheck\$.*?\$precheck\$;", s, flags=re.S).group(0)
               if re.search(r"do \$precheck\$.*?\$precheck\$;", s, flags=re.S)
               else "")
        ),
    ),
]


def main():
    original = io.open(MIGRATION, encoding="utf-8").read()
    shutil.copyfile(MIGRATION, BACKUP)

    print("=" * 74)
    print("MUTATION CAMPAIGN - migration 0189 out-of-order guard (D15)")
    print("=" * 74)

    # ---- STEP 0: prove the instrument works BEFORE trusting any score. ----
    print("\nBASELINE (proving the harness actually runs tests)...")
    code, collected, tail = run_suite()
    if code != 0 or not collected:
        print("  ABORT: the suite does not pass on unmodified source, or the")
        print("         harness never collected any tests. Nothing measured.")
        print("         exit=%s collected_tests=%s" % (code, collected))
        print(tail)
        shutil.copyfile(BACKUP, MIGRATION)
        return 1
    print("  baseline PASSES and tests were collected - instrument is trustworthy")

    killed = survived = noop = inconclusive = 0

    for mid, desc, fn in MUTANTS:
        mutated = fn(original)

        # A mutation that changes nothing proves nothing.
        if mutated == original:
            print("\n  NO-OP        %s  %s" % (mid, desc))
            print("               the mutation changed no bytes - this campaign")
            print("               would be scoring a test it never challenged")
            noop += 1
            continue

        io.open(MIGRATION, "w", encoding="utf-8").write(mutated)
        code, collected, tail = run_suite()
        io.open(MIGRATION, "w", encoding="utf-8").write(original)

        if not collected:
            # Non-zero exit with no tests collected == crashed harness, NOT a
            # killed mutant. This is the trap the first version of this script
            # fell into.
            print("\n  INCONCLUSIVE %s  %s" % (mid, desc))
            print("               harness produced no test count - crash, not a kill")
            print(tail)
            inconclusive += 1
        elif code != 0:
            print("\n  KILLED       %s  %s" % (mid, desc))
            killed += 1
        else:
            print("\n  SURVIVED (!) %s  %s" % (mid, desc))
            print("               the suite passed with this protection broken.")
            print("               THIS IS A REAL HOLE. Fix the test, not the score.")
            survived += 1

    shutil.copyfile(BACKUP, MIGRATION)
    restored = io.open(MIGRATION, encoding="utf-8").read()
    identical = restored == original

    print("\n" + "=" * 74)
    print("RESULT: %d killed / %d survived / %d no-op / %d inconclusive"
          % (killed, survived, noop, inconclusive))
    print("source restored byte-identical: %s" % identical)
    print("=" * 74)

    ok = (survived == 0 and noop == 0 and inconclusive == 0
          and identical and killed == len(MUTANTS))
    print("CAMPAIGN PASSED" if ok else "CAMPAIGN FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
