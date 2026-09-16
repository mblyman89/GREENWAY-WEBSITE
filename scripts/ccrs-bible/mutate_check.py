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
PREFLIGHT = "src/lib/compliance/ccrs-preflight-core.ts"
ADJCORE = "src/lib/compliance/ccrs-inventory-adjustment-core.ts"

STAMP_TESTS = "tests/compliance/ccrs-file-stamp.test.ts"
SELF_TESTS = "tests/compliance/pure-selftests.test.ts"
BATCH_TESTS = "tests/compliance/ccrs-batch.test.ts"
PREFLIGHT_TESTS = "tests/compliance/ccrs-preflight.test.ts"

# The PREproduction generator writes the files the owner actually uploads to
# the LCB. It is not application code, but a silent defect here costs a real
# ten-minute upload cycle and teaches us a false lesson, so it is mutated too.
GENERATOR = "scripts/compliance/generate-preprod-test-files.ts"
GENERATOR_TESTS = "tests/compliance/ccrs-preprod-generator.test.ts"

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
    # ---- S-02: pre-flight blocking errors E7-E13 ----
    (
        "M9-strain-substring-match",
        PREFLIGHT,
        "  return (RESERVED_STRAIN_NAMES as readonly string[]).includes(n);",
        "  return (RESERVED_STRAIN_NAMES as readonly string[]).some((r) => n.includes(r));",
        PREFLIGHT_TESTS,
        "E11 must be EXACT match — a substring test would reject 'Other Kush'.",
    ),
    (
        "M10-totalcost-allows-zero",
        PREFLIGHT,
        "  if (minor == null || !Number.isFinite(minor) || minor <= 0) return { value: null, ok: false };",
        "  if (minor == null || !Number.isFinite(minor) || minor < 0) return { value: null, ok: false };",
        PREFLIGHT_TESTS,
        "E7: TotalCost of exactly 0 must still be an error [G L0614].",
    ),
    (
        "M11-sample-wrong-cost",
        PREFLIGHT,
        'export const TRADE_SAMPLE_TOTAL_COST = "0.01";',
        'export const TRADE_SAMPLE_TOTAL_COST = "0.00";',
        PREFLIGHT_TESTS,
        "E7: a trade sample must report exactly $0.01 [FAQ L0035].",
    ),
    (
        "M12-excise-wrong-rate",
        PREFLIGHT,
        "export const CCRS_EXCISE_BPS = 3700;",
        "export const CCRS_EXCISE_BPS = 3500;",
        PREFLIGHT_TESTS,
        "E12: the rate is 37%, and must reproduce the FAQ's $4.44 exactly.",
    ),
    (
        "M13-excise-ignores-discount",
        PREFLIGHT,
        "  return Math.max(0, quantity * unitPriceMinorUnits - discountMinorUnits);",
        "  return Math.max(0, quantity * unitPriceMinorUnits);",
        PREFLIGHT_TESTS,
        "E12: the taxable base is POST-discount [FAQ L0155-L0160].",
    ),
    (
        "M14-excise-tolerance-too-wide",
        PREFLIGHT,
        "export const EXCISE_TOLERANCE_MINOR_UNITS = 1;",
        "export const EXCISE_TOLERANCE_MINOR_UNITS = 100;",
        PREFLIGHT_TESTS,
        "E12: a dollar of slack would let a real mismatch through.",
    ),
    (
        "M15-medical-exempt-always",
        PREFLIGHT,
        "  if (input.isMedicalExempt) return null; // [G L1378] \"Only Medical … 0\"",
        "  return null; // mutated: everything exempt",
        PREFLIGHT_TESTS,
        "E12 must still fire for NON-exempt rows (today IsMedical is always FALSE).",
    ),
    (
        "M16-type-gate-misses-guide-spelling",
        PREFLIGHT,
        '    .replace(/^useable /, "usable ");',
        "    ;",
        PREFLIGHT_TESTS,
        "E9/E10: the guide spells it 'Useable cannabis'; missing it skips real rows.",
    ),
    (
        "M17-adjustment-detail-not-required",
        PREFLIGHT,
        'export const DETAIL_REQUIRED_REASONS = ["Other", "Theft"] as const;',
        'export const DETAIL_REQUIRED_REASONS = ["Other"] as const;',
        PREFLIGHT_TESTS,
        "E13: Theft also requires a detail [G L1111].",
    ),
    (
        "M18-issue-rows-capped",
        PREFLIGHT,
        "  return { code, severity, specPin: specPinFor(code), message, rows };",
        "  return { code, severity, specPin: specPinFor(code), message, rows: rows.slice(0, 25) };",
        PREFLIGHT_TESTS,
        "Part 08: row lists are NEVER capped — a cap hides the blocking row.",
    ),
    (
        "M19-verdict-emits-bad-row",
        PREFLIGHT,
        "  if (f.onHandQty > f.initialQty) {",
        "  if (false) {",
        PREFLIGHT_TESTS,
        "E8 rows must be WITHHELD; emitting one gets the whole file rejected.",
    ),
    (
        "M20-verdict-order-e7-first",
        PREFLIGHT,
        "  if (f.onHandQty > f.initialQty) {\n    return {\n      emit: false,\n      code: \"E8_ONHAND_GT_INITIAL\",",
        "  if (f.onHandQty > f.initialQty) {\n    return {\n      emit: false,\n      code: \"E7_TOTALCOST_ZERO\",",
        PREFLIGHT_TESTS,
        "A count problem must be reported as E8, not mislabelled E7.",
    ),
    (
        "M21-product-returns-first-only",
        PREFLIGHT,
        "  if (!f.description.trim()) {",
        "  if (out.length === 0 && !f.description.trim()) {",
        PREFLIGHT_TESTS,
        "Both E9 and E10 must surface together; hiding one causes a second rejection.",
    ),
    (
        "M22-e13-not-enforced",
        ADJCORE,
        "  if (adjustmentDetailRequired(ccrsReason) && !detail) {",
        "  if (false) {",
        PREFLIGHT_TESTS,
        "E13: an Other/Theft row with no detail must be withheld [G L1111].",
    ),
    (
        "M23-generator-emits-lf",
        GENERATOR,
        '    writeFileSync(join(OUT, outName), csv, "utf8");',
        "    writeFileSync(join(OUT, outName), "
        'csv.replace(/\\r\\n/g, "\\n"), "utf8");',
        GENERATOR_TESTS,
        "The owner uploads these files to CCRS. LF instead of CRLF is the most "
        "likely real-world rejection [G L0196], and it is invisible on screen.",
    ),
    (
        "M24-generator-probe-accidentally-valid",
        GENERATOR,
        "  if (t.breakNumberRecords) {",
        "  if (false && t.breakNumberRecords) {",
        GENERATOR_TESTS,
        "An EXPECT-ERROR file that is secretly VALID is worse than a broken "
        "one: CCRS accepts it and we record the wrong lesson for T-54.",
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
    baseline_targets = (
        STAMP_TESTS,
        SELF_TESTS,
        BATCH_TESTS,
        PREFLIGHT_TESTS,
        GENERATOR_TESTS,
    )
    for target in baseline_targets:
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
    res = run(["git", "diff", "--stat", CORE, GATE, PREFLIGHT, ADJCORE, GENERATOR])
    print("\nPost-run git diff vs index (S-01 edits only, no mutations):")
    print(res.stdout or "  (clean)")
    print("\nAll mutations killed. The tests can fail. ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
