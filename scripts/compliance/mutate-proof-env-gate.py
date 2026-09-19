#!/usr/bin/env python3
"""
TEST THE TEST: do tests/compliance/proof-env-gate.test.ts actually CATCH a
regression, or do they merely pass?

WHY THIS EXISTS
---------------
Slice A added a guard so that a NEW proof script cannot reintroduce the
`psql -c` defect that made prove-0229-executes.sh report "0 passed, 43
failed" about a migration that was perfectly fine.

A guard nobody has watched catch anything is decoration. This file breaks the
auditor on purpose, one change at a time, and asserts the test suite goes RED
each time. A mutation that SURVIVES is a hole in the tests -- it means the
auditor could be broken in that exact way and every test would still be green.

HOW IT WORKS
------------
For each mutation:
  1. back up the target file (bytes, not a re-render)
  2. apply exactly one textual change, asserting the anchor is UNIQUE so the
     mutation cannot silently land somewhere unintended
  3. run the test suite
  4. restore the file from the backup, ALWAYS, including on Ctrl-C
  5. record CAUGHT (suite failed = good) or SURVIVED (suite passed = a hole)

Usage:  python3 scripts/compliance/mutate-proof-env-gate.py
Exit:   0 if every mutation was caught, 1 otherwise.
"""

import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AUDITOR = os.path.join(ROOT, "scripts", "compliance", "audit-proof-env-gate.ts")
SUITE = "tests/compliance/proof-env-gate.test.ts"

# (name, why this mutation represents a REAL mistake someone could make,
#  old, new)
MUTATIONS = [
    (
        "accept_bare_psql",
        "the auditor stops flagging psql calls with no -d -- i.e. it stops "
        "detecting the exact bug this whole slice exists to prevent",
        "    return !namesDb;",
        "    return false;",
    ),
    (
        "d_flag_not_required",
        "a bare `-c` is treated as naming a database, so `psql -q -c \"...\"` "
        "passes -- the original defect, waved through",
        '      /\\s-d\\b/.test(line) ||',
        '      /\\s-[a-z]\\b/.test(line) ||',
    ),
    (
        "only_flag_first_offender",
        "only the first bad line is reported. The real scripts had TWO (drop "
        "and create); fixing one and missing the other leaves the bug alive",
        "  for (const line of barePsqlLines(source)) {",
        "  for (const line of barePsqlLines(source).slice(0, 0)) {",
    ),
    (
        "ignore_comment_stripping",
        "comments are no longer stripped, so every script's own explanation "
        "of the bug gets flagged. Nuisance alarms get muted, and a muted "
        "alarm protects nothing",
        '      if (trimmed.startsWith("#")) return false;',
        '      if (trimmed.startsWith("@@@")) return false;',
    ),
    (
        "gate_presence_never_checked",
        "the refusal gate is assumed present. A new script copied from an old "
        "one before the fix would sail through",
        "  if (!hasProbe) {",
        "  if (false) {",
    ),
    (
        "accept_exit_1",
        'exit 1 ("a real failure", i.e. blame the migration) is accepted as a '
        'refusal. That is the bug re-entering through the exit code',
        '    if (!/\\bexit 2\\b/.test(code)) {',
        '    if (!/\\bexit\\b/.test(code)) {',
    ),
    (
        "accept_silent_gate",
        "a gate that exits 2 without explaining itself is accepted. psql also "
        "exits 2 on a failed connection, so silence is ambiguous",
        "    if (!saysEnvironment || !saysNothingProven) {",
        "    if (false) {",
    ),
    (
        "half_a_message_is_enough",
        'saying "ENVIRONMENT" without saying nothing was proven is accepted. '
        "The reader learns there is a problem but not that the verdict is void",
        "    if (!saysEnvironment || !saysNothingProven) {",
        "    if (!saysEnvironment && !saysNothingProven) {",
    ),
    (
        "final_exit_detector_counts_the_gate",
        "the final-exit detector counts the gate's own indented `exit 2`, so "
        "every script looks fine and the known 0223-0227 defect vanishes from "
        "view. This is a bug I actually wrote and caught mid-slice",
        "    .some((l) => /^exit\\s+\\S/.test(l) && !l.trim().startsWith(\"#\"));",
        "    .some((l) => /exit\\s+\\S/.test(l) && !l.trim().startsWith(\"#\"));",
    ),
    (
        "sql_detection_disabled",
        "psql calls are no longer recognised as carrying SQL, so nothing is "
        "ever examined and the audit is vacuously clean",
        "    if (!carriesSql) return false;",
        "    return false;",
    ),
]


def run_suite():
    """Run the suite. Returns True if it PASSED."""
    proc = subprocess.run(
        ["npx", "vitest", "run", SUITE],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=600,
    )
    return proc.returncode == 0


def main():
    if not os.path.exists(AUDITOR):
        print(f"FATAL: {AUDITOR} not found. Nothing has been tested.")
        return 2

    with open(AUDITOR, "r", encoding="utf-8") as fh:
        original = fh.read()

    # Baseline. If the suite is already red, every mutation would "pass" for
    # the wrong reason and this whole run would be meaningless.
    print("=" * 74)
    print("  MUTATION TESTING: scripts/compliance/audit-proof-env-gate.ts")
    print("  A guard nobody has watched catch anything is decoration.")
    print("=" * 74)
    print()
    print("--- BASELINE: the suite must be GREEN before we break anything ---")
    if not run_suite():
        print("  FATAL: the suite is already failing. Fix that first.")
        print("  Nothing has been proven or disproven about the tests.")
        return 2
    print("  ok   baseline green\n")

    backup = tempfile.NamedTemporaryFile(
        prefix="audit-proof-env-gate-", suffix=".ts.bak", delete=False
    ).name
    shutil.copy2(AUDITOR, backup)

    caught, survived = [], []
    try:
        for name, why, old, new in MUTATIONS:
            count = original.count(old)
            if count != 1:
                print(f"  *** FAIL {name}: anchor found {count} times, expected 1 ***")
                print(f"      anchor: {old!r}")
                survived.append(name)
                continue

            mutated = original.replace(old, new)
            assert mutated != original, f"{name}: mutation changed nothing"

            with open(AUDITOR, "w", encoding="utf-8") as fh:
                fh.write(mutated)

            passed = run_suite()

            if passed:
                print(f"  *** SURVIVED {name} ***")
                print(f"      {why}")
                print("      The tests did not notice. That is a HOLE.")
                survived.append(name)
            else:
                print(f"  ok   caught  {name}")
                print(f"           ({why})")
                caught.append(name)
    finally:
        # Restore unconditionally -- including on exception or Ctrl-C. Leaving
        # a mutated auditor on disk would be far worse than any hole it finds.
        shutil.copy2(backup, AUDITOR)
        os.unlink(backup)
        with open(AUDITOR, "r", encoding="utf-8") as fh:
            assert fh.read() == original, "RESTORE FAILED - file is mutated!"
        print("\n  (auditor restored, byte-for-byte)")

    print()
    print("=" * 74)
    print(f"  MUTATIONS: {len(caught)} caught, {len(survived)} survived")
    if survived:
        print("  RESULT: *** THE TESTS HAVE HOLES ***")
        for s in survived:
            print(f"    - {s}")
    else:
        print("  RESULT: every way of breaking the auditor is caught by a test")
    print("=" * 74)
    return 1 if survived else 0


if __name__ == "__main__":
    sys.exit(main())
