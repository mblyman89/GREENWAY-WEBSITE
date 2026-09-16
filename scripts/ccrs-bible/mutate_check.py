#!/usr/bin/env python3
"""
Mutation harness — "test the tests" (Part 05 D-10).

A test that cannot fail is not a test. This script deliberately breaks the
implementation one edit at a time and asserts that the named test file goes
RED. If a mutation survives (tests still pass), the test suite has a hole and
the script exits non-zero.

The target file is ALWAYS restored from an in-memory copy of the original in a
finally-block, so an interrupted run cannot leave a mutated file behind.

Usage:
    python3 scripts/ccrs-bible/mutate_check.py
"""

from __future__ import annotations

import os
import subprocess
import sys

REPO = os.environ.get(
    "CCRS_REPO",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")),
)

CORE = "src/lib/compliance/ccrs-batch-core.ts"
GATE = "src/lib/compliance/ccrs-submit-gate-core.ts"

STAMP_TESTS = "tests/compliance/ccrs-file-stamp.test.ts"
SELF_TESTS = "tests/compliance/pure-selftests.test.ts"
BATCH_TESTS = "tests/compliance/ccrs-batch.test.ts"

# (id, file, old_fragment, new_fragment, test_target, why)
MUTATIONS = [
    (
        "M1-stamp-utc",
        CORE,
        "  const t = pacificParts(now); // America/Los_Angeles wall clock",
        "  const t = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1,\n"
        "    day: now.getUTCDate(), hour: now.getUTCHours(),\n"
        "    minute: now.getUTCMinutes(), second: now.getUTCSeconds() };",
        STAMP_TESTS,
        "Regression to UTC stamping must be caught (FAQ L0075: name is PST).",
    ),
    (
        "M2-stamp-no-pad",
        CORE,
        '  const p = (n: number, w = 2) => String(n).padStart(w, "0");',
        "  const p = (n: number, _w = 2) => String(n);",
        STAMP_TESTS,
        "Dropping zero-pad must be caught (stamp must always be 14 digits).",
    ),
    (
        "M3-stamp-month-off-by-one",
        CORE,
        "    `${t.year}${p(t.month)}${p(t.day)}`",
        "    `${t.year}${p(t.month - 1)}${p(t.day)}`",
        STAMP_TESTS,
        "Off-by-one in month must be caught.",
    ),
    (
        "M4-pad-not-idempotent",
        CORE,
        "    if (cells.length >= width) continue; // already padded (idempotent)",
        "    // mutated: idempotence guard removed",
        STAMP_TESTS,
        "Padding twice must not double-pad; guard removal must be caught.",
    ),
    (
        "M5-pad-touches-data-rows",
        CORE,
        "  for (let i = 0; i < 3; i += 1) {",
        "  for (let i = 0; i < lines.length; i += 1) {",
        STAMP_TESTS,
        "Padding must touch ONLY the 3 header rows, never data rows.",
    ),
    (
        "M6-pad-drops-trailing-crlf",
        CORE,
        '  return lines.join("\\r\\n") + (hadTrailingCrLf ? "\\r\\n" : "");',
        '  return lines.join("\\r\\n");',
        STAMP_TESTS,
        "Dropping the trailing CRLF must be caught by verifyCcrsFile round-trip.",
    ),
    (
        "M7-gate-always-submittable",
        GATE,
        "submittable: errors.length === 0,",
        "submittable: true,",
        SELF_TESTS,
        "The registered gate self-test must actually fail when the gate breaks.",
    ),
    (
        "M8-filename-stamp-literal",
        CORE,
        "  return `${type}_${lic}_${ccrsFileStamp(now)}.csv`;",
        '  return `${type}_${lic}_20250615130000.csv`;',
        STAMP_TESTS,
        "Filename must derive from the live stamp, not a hard-coded value.",
    ),
]


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, cwd=REPO, capture_output=True, text=True, timeout=300
    )


def vitest(target: str) -> subprocess.CompletedProcess:
    # NOTE: Vitest 4 removed the "basic" reporter; passing it makes vitest try
    # to import "basic" as a custom reporter module and exit non-zero BEFORE
    # running a single test. That would mark every mutation "killed" for the
    # wrong reason — a false green. "dot" is a real Vitest 4 reporter.
    res = run(["npx", "vitest", "run", target, "--reporter=dot"])
    # Guard against infrastructure failures masquerading as test failures.
    if "ERR_LOAD_URL" in res.stderr or "Failed to load url" in res.stderr:
        raise RuntimeError(
            f"vitest infrastructure error (not a test failure) for {target}:\n"
            f"{res.stderr[-1500:]}"
        )
    return res


def main() -> int:
    # 1. Baseline: everything must be GREEN before we start.
    print("=" * 66)
    print("BASELINE (all targets must be green before mutating)")
    print("=" * 66)
    for target in (STAMP_TESTS, SELF_TESTS, BATCH_TESTS):
        res = vitest(target)
        state = "PASS" if res.returncode == 0 else "FAIL"
        print(f"  [{state}] {target}")
        if res.returncode != 0:
            print("ABORT: baseline is not green; fix that first.")
            print(res.stdout[-3000:])
            return 1

    survived: list[str] = []
    killed: list[str] = []

    for mid, path, old, new, target, why in MUTATIONS:
        full = os.path.join(REPO, path)
        with open(full, "r", encoding="utf-8") as fh:
            original = fh.read()

        if original.count(old) != 1:
            print(f"\n[{mid}] ABORT: anchor not unique in {path} "
                  f"(found {original.count(old)}x). No guessing — fix anchor.")
            return 1

        try:
            with open(full, "w", encoding="utf-8") as fh:
                fh.write(original.replace(old, new, 1))

            res = vitest(target)
            out = res.stdout + res.stderr
            # A mutation counts as KILLED only if tests actually RAN and
            # reported failures. A non-zero exit with no "failed" tally means
            # the harness broke, not the code — that must not read as success.
            ran_and_failed = "failed" in out and "Tests " in out
            if res.returncode != 0 and ran_and_failed:
                killed.append(mid)
                verdict = "KILLED  (test went red — good)"
            elif res.returncode != 0:
                print(f"\n[{mid}] INCONCLUSIVE: vitest exited {res.returncode} "
                      f"without a test tally. Not counting as killed.")
                print(out[-2000:])
                return 1
            else:
                survived.append(mid)
                verdict = "SURVIVED (TEST HOLE!)"
            tally = ""
            for line in out.splitlines():
                if line.strip().startswith("Tests "):
                    tally = line.strip()
                    break
            print(f"\n[{mid}] {verdict}")
            print(f"    file : {path}")
            print(f"    test : {target}")
            print(f"    why  : {why}")
            if tally:
                print(f"    tally: {tally}")
        finally:
            with open(full, "w", encoding="utf-8") as fh:
                fh.write(original)

        # Prove the restore worked before moving on.
        with open(full, "r", encoding="utf-8") as fh:
            if fh.read() != original:
                print(f"[{mid}] FATAL: restore of {path} failed.")
                return 1

    print("\n" + "=" * 66)
    print(f"RESULT: {len(killed)} killed, {len(survived)} survived")
    print("=" * 66)
    if survived:
        for mid in survived:
            print(f"  SURVIVED: {mid}")
        return 1

    # Final proof: working tree is byte-identical to how we found it.
    res = run(["git", "diff", "--stat", CORE, GATE])
    print("\nPost-run git diff vs index (S-01 edits only, no mutations):")
    print(res.stdout or "  (clean)")
    print("\nAll mutations killed. The tests can fail. ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
