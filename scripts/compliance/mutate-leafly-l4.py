#!/usr/bin/env python3
"""SLICE L-4 mutation harness -- "test the tests".

L-4 builds two things that are dangerous in opposite directions:

  * `readback-core.ts` -- the GET /menu contract and the reconciler that compares
    what Leafly STORED against what we SENT. Its job is to catch the defects a
    200 response cannot: a dropped photo, a silently missing item, a medical flag
    that disagrees. If the reconciler goes blind, the owner is told the menu is
    correct when it is not.

  * `certification-core.ts` -- the gate that decides whether to tell the owner
    "you are ready to ask Leafly for menu certification". It is dangerous in BOTH
    directions. A false ready costs a failed review plus two business days'
    notice before the next attempt. A false not-ready leaves the owner waiting on
    a blocker we invented -- which is exactly what finding L-20 was.

A green suite is not evidence that either of those works. The question this
harness answers is the harder one: IF SOMEBODY BROKE ONE, WOULD THE SUITE
NOTICE?

Every mutation below is a real, plausible regression, and several are the exact
defect the slice exists to prevent, deliberately reintroduced:

  * the readback contract "tidied" to match the write contract -- i.e. defects
    L-06 and L-07 restored, which is the single most likely future edit here
  * the reconciler declaring a clean match while an item is missing
  * a dropped photo (L-10) downgraded from error to warning
  * a medical-flag disagreement silently ignored (a compliance matter)
  * the certification gate auto-passing the manual-tools criterion that Leafly
    says is disqualifying -- the most expensive wrong answer in the slice
  * "untested" laundered into "pass" for authentication
  * finding L-20 restored: in-stock graded per VARIANT instead of per ITEM
  * the propagation window (L-19) zeroed, so premature comparisons read as real
    differences and provoke a re-push

HARNESS LESSONS 1-7, carried verbatim from L-2 and L-3 because each one was
learned by being burned:

1. NEVER pipe vitest into sed/grep to read its result -- the pipeline's exit code
   becomes the last command's, so every failure reports as a pass.
2. Do the replacement in Python with plain `.replace`, never `perl -e`.
3. VERIFY THE MUTATION ACTUALLY CHANGED THE FILE. A pattern that no longer
   matches mutates nothing, the suite passes, and the harness scores it CAUGHT --
   inflating the score exactly when the harness has stopped working.
4. Verify the baseline is GREEN before mutating. Mutation results are meaningless
   on a red baseline.
5. Ambiguity is an ERROR, not a coin flip. If a pattern appears more than once the
   harness refuses rather than mutating an arbitrary occurrence.
6. Cap the child Node heap and run vitest single-threaded; an uncapped heap took
   the whole tmux server down mid-sweep on this box, and a truncated log looks a
   lot like a finished one. Flush every line so an incomplete run is visible.
7. VERIFY FLAG NAMES against the installed vitest's `--help` before using them.
   An unrecognised flag exits non-zero, which the harness reads as CAUGHT -- so it
   would report a perfect score while never running a single test. The baseline
   check is what catches this, which is precisely why it exists.
"""
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

READBACK = Path("src/lib/leafly/readback-core.ts")
CERT = Path("src/lib/leafly/certification-core.ts")

# The vitest files that must notice. Both L-4 compliance files plus the
# registry that enforces the self-test floors, because several mutations below
# are designed to be caught by an embedded assertion rather than a vitest case.
TESTS = [
    "tests/compliance/leafly-readback.test.ts",
    "tests/compliance/leafly-certification.test.ts",
    "tests/compliance/pure-selftests.test.ts",
]

# The pure self-tests also run through the standalone entry point, which THROWS
# rather than reporting, and enforces the per-core assertion floors.
SELFTEST_ENTRY = "scripts/compliance/run-pure-selftests.ts"

# (file, name, from, to)
MUTATIONS = [
    # ===================================================== readback vocabulary
    # THE anti-merge mutations. "Tidying" the readback contract to match the
    # write contract is the most plausible future edit in this slice, and it is
    # how defects L-06 and L-07 happened in the first place.
    (READBACK, "L-06 RETURNS: readback brand field renamed to the write spelling",
     '  brandName: "brandName",\n  cbdContent: "cbdContent",',
     '  brandName: "brand",\n  cbdContent: "cbdContent",'),
    (READBACK, "L-07 RETURNS: readback strain field renamed to the write spelling",
     '  strainName: "strainName",\n  thcContent: "thcContent",',
     '  strainName: "strain",\n  thcContent: "thcContent",'),
    (READBACK, "the readback->write rename table is emptied (brand/strain stop mapping)",
     '  brandName: "brand",\n  strainName: "strain",\n} as const;',
     "} as const;"),
    (READBACK, "the rename table maps brand to the WRONG write field",
     '  brandName: "brand",\n  strainName: "strain",\n} as const;',
     '  brandName: "brandName",\n  strainName: "strain",\n} as const;'),
    (READBACK, "a readback item field is silently dropped from the vocabulary",
     '  imageUrl: "imageUrl",\n  isReservable: "isReservable",',
     '  isReservable: "isReservable",'),
    (READBACK, "a readback item field is misspelled (would never match Leafly's body)",
     '  thcUnit: "thcUnit",\n  type: "type",',
     '  thcUnit: "thcUnits",\n  type: "type",'),

    # ------------------------------------------- Leafly-owned fields
    # Reconciling these would report the owner's own Menu Manager edits as
    # integration errors.
    (READBACK, "Leafly-owned fields list is emptied (Menu Manager edits become errors)",
     '  "created",\n  "hidden",\n  "isStaffPick",\n  "lastModified",\n] as const;',
     "] as const;"),
    (READBACK, "'hidden' is no longer treated as Leafly-owned",
     '  "created",\n  "hidden",\n  "isStaffPick",',
     '  "created",\n  "isStaffPick",'),

    # ------------------------------------- refused correspondences (rule 3)
    (READBACK, "the refused correspondences are quietly asserted as facts (rule 3 breach)",
     "export const LEAFLY_READBACK_UNVERIFIED_CORRESPONDENCES = [",
     "export const LEAFLY_READBACK_UNVERIFIED_CORRESPONDENCES: never[] = [] as never[];\nconst _LEAFLY_READBACK_UNVERIFIED_CORRESPONDENCES_UNUSED = ["),

    # ============================================================ id handling
    (READBACK, "a blank id is accepted as a real id (would match the wrong item)",
     '    return trimmed === "" ? null : trimmed;',
     "    return trimmed;"),
    (READBACK, "ids stop being trimmed (whitespace breaks every comparison)",
     "    const trimmed = value.trim();",
     "    const trimmed = value;"),
    (READBACK, "numeric ids from Leafly are rejected instead of coerced",
     '  if (typeof value === "number" && Number.isFinite(value)) return String(value);',
     '  if (false) return String(value);'),

    # ================================================== parse: must fail soft
    (READBACK, "an HTML error page is parsed as a valid empty menu",
     '  if (typeof body === "string") {',
     "  if (false) {"),
    (READBACK, "a response with no result array is accepted as a menu",
     "  if (!Array.isArray(rawResult)) {",
     "  if (false && !Array.isArray(rawResult)) {"),
    (READBACK, "a non-object body is accepted as a menu",
     "  if (!isRecord(body)) {",
     "  if (false) {"),

    # ============================================ reconcile: the safety net
    (READBACK, "a MISSING item is no longer reported (the defect a 200 cannot show)",
     '      add(\n        "error",\n        "missing_from_leafly",',
     '      add(\n        "info",\n        "missing_from_leafly",'),
    (READBACK, "missing items stop being collected at all",
     "      missingFromLeafly.push(id);",
     "      void id;"),
    (READBACK, "L-10 REGRESSES: a dropped photo is downgraded to a warning",
     '      add(\n        "error",\n        "image_dropped",',
     '      add(\n        "warning",\n        "image_dropped",'),
    (READBACK, "COMPLIANCE: a medical-flag disagreement is downgraded to a warning",
     '        add(\n          "error",\n          "medical_mismatch",',
     '        add(\n          "warning",\n          "medical_mismatch",'),
    (READBACK, "the medical flag stops being compared at all",
     "      if (bv.medical !== null && bv.medical !== sv.medical) {",
     "      if (false) {"),
    (READBACK, "reconcile reports OK even when errors were found",
     '    ok: issues.every((i) => i.severity !== "error"),',
     "    ok: true,"),
    (READBACK, "reconcile treats warnings as fatal (would block on Menu Manager edits)",
     '    ok: issues.every((i) => i.severity !== "error"),',
     "    ok: issues.length === 0,"),
    (READBACK, "hand-added Menu Manager items are reported as ERRORS, not info",
     '      add(\n        "info",\n        "extra_at_leafly",',
     '      add(\n        "error",\n        "extra_at_leafly",'),
    (READBACK, "an unreadable readback reconciles as clean",
     '          severity: "error",\n          code: "readback_unreadable",',
     '          severity: "info",\n          code: "readback_unreadable",'),
    (READBACK, "the compared-item counter stops counting (report corruption)",
     "    compared += 1;",
     "    compared += 0;"),
    (READBACK, "the per-code issue cap is set to zero (every problem suppressed)",
     "export const LEAFLY_RECONCILE_ISSUES_PER_CODE = 5;",
     "export const LEAFLY_RECONCILE_ISSUES_PER_CODE = 0;"),

    # ============================== propagation window -- finding L-19
    (READBACK, "L-19 REGRESSES: the sandbox propagation window is zeroed",
     "export const LEAFLY_SANDBOX_PROPAGATION_SECONDS = 150;",
     "export const LEAFLY_SANDBOX_PROPAGATION_SECONDS = 0;"),
    (READBACK, "the sandbox window is wrong (30s instead of Leafly's 2.5 minutes)",
     "export const LEAFLY_SANDBOX_PROPAGATION_SECONDS = 150;",
     "export const LEAFLY_SANDBOX_PROPAGATION_SECONDS = 30;"),
    (READBACK, "the production window is wrong (copied from sandbox)",
     "export const LEAFLY_PRODUCTION_PROPAGATION_SECONDS = 300;",
     "export const LEAFLY_PRODUCTION_PROPAGATION_SECONDS = 150;"),
    (READBACK, "the window ignores the environment (production graded as sandbox)",
     "  return environment === \"sandbox\"\n    ? LEAFLY_SANDBOX_PROPAGATION_SECONDS\n    : LEAFLY_PRODUCTION_PROPAGATION_SECONDS;",
     "  void environment;\n  return LEAFLY_SANDBOX_PROPAGATION_SECONDS;"),
    (READBACK, "a premature comparison is never flagged (phantom diffs read as real)",
     "  if (elapsed < windowSeconds) {",
     "  if (false) {"),
    (READBACK, "FAILS UNSAFE: unknown push time is reported as 'too soon'",
     "  if (!lastPushAt) {\n    return {\n      tooSoon: false,",
     "  if (!lastPushAt) {\n    return {\n      tooSoon: true,"),
    (READBACK, "FAILS UNSAFE: an unparseable timestamp is reported as 'too soon'",
     "  if (Number.isNaN(pushedMs)) {\n    return {\n      tooSoon: false,",
     "  if (Number.isNaN(pushedMs)) {\n    return {\n      tooSoon: true,"),
    (READBACK, "a clock-skewed future push is silently treated as premature",
     "  if (elapsed < 0) {\n    return {\n      tooSoon: false,",
     "  if (elapsed < 0) {\n    return {\n      tooSoon: true,"),

    # ==================================================== certification gate
    # The manual-tools criterion is the most expensive wrong answer in the slice:
    # Leafly says Postman/curl traffic is disqualifying, and it is retroactive.
    (CERT, "DISQUALIFYING: the manual-tools criterion auto-passes when unanswered",
     '      status: "attest",\n      finding:\n        "Only you can answer this one.',
     '      status: "pass",\n      finding:\n        "Only you can answer this one.'),
    (CERT, "an admitted Postman/curl history is downgraded to a warning-ish pass",
     '      status: "fail",\n      finding:\n        "Postman or curl has been used against the Leafly sandbox.',
     '      status: "pass",\n      finding:\n        "Postman or curl has been used against the Leafly sandbox.'),
    (CERT, "'attest' counts as a pass, so readiness no longer requires confirmation",
     '    criteria.every((c) => c.status === "pass") && inputs.environment === "sandbox";',
     '    criteria.every((c) => c.status !== "fail") && inputs.environment === "sandbox";'),
    (CERT, "readiness ignores the environment (production asks for sandbox certification)",
     '    criteria.every((c) => c.status === "pass") && inputs.environment === "sandbox";',
     '    criteria.every((c) => c.status === "pass");'),

    # ---- authentication: untested must never launder into pass ----
    (CERT, "'credentials saved but never used' is laundered into a PASS",
     '      status: "unknown",\n      finding:\n        "Credentials are saved but no live call has been made',
     '      status: "pass",\n      finding:\n        "Credentials are saved but no live call has been made'),
    (CERT, "a REJECTED token exchange is reported as unknown rather than failed",
     '      status: "fail",\n      finding: "The last attempt to authenticate with Leafly was rejected.",',
     '      status: "unknown",\n      finding: "The last attempt to authenticate with Leafly was rejected.",'),
    (CERT, "missing credentials no longer fail authentication",
     "  if (!inputs.credentialsConfigured) {",
     "  if (false) {"),

    # ---- 200-level responses ----
    (CERT, "an EMPTY request log passes the 200-level criterion",
     '      status: "fail",\n      finding: "No live menu push has been made',
     '      status: "pass",\n      finding: "No live menu push has been made'),
    (CERT, "a failing MOST RECENT push is accepted",
     "    if (!isSuccess(last)) {",
     "    if (false) {"),
    (CERT, "chronological order stops mattering (last becomes first)",
     "    const last = inputs.recentPushStatuses[inputs.recentPushStatuses.length - 1];",
     "    const last = inputs.recentPushStatuses[0];"),
    (CERT, "the success range is wrong (3xx counted as success)",
     "  return status >= 200 && status <= 299;",
     "  return status >= 200 && status <= 399;"),

    # ---- cadence ----
    (CERT, "the cadence criterion passes with no scheduled sync",
     "  if (inputs.scheduledSyncEnabled) {",
     "  if (true) {"),

    # ---- data quality, incl. finding L-20 ----
    (CERT, "L-20 RETURNS: in-stock graded per VARIANT instead of per ITEM",
     "    const inStockFraction = inputs.inStockItemCount / inputs.itemCount;",
     "    const inStockFraction = inputs.inStockVariantCount / inputs.variantCount;"),
    (CERT, "the in-stock requirement text drifts back to my paraphrase",
     'export const LEAFLY_IN_STOCK_REQUIREMENT_TEXT =\n  "Variants contain inventory that reflect most items are in stock";',
     'export const LEAFLY_IN_STOCK_REQUIREMENT_TEXT =\n  "most variants in stock";'),
    (CERT, "the in-stock majority threshold is dropped to nothing",
     "export const GREENWAY_IN_STOCK_MAJORITY_FRACTION = 0.5;",
     "export const GREENWAY_IN_STOCK_MAJORITY_FRACTION = 0.0;"),
    (CERT, "the in-stock threshold demands perfection (would block a normal shop)",
     "export const GREENWAY_IN_STOCK_MAJORITY_FRACTION = 0.5;",
     "export const GREENWAY_IN_STOCK_MAJORITY_FRACTION = 1.0;"),
    (CERT, "an empty menu passes data quality",
     "  if (inputs.itemCount === 0) {",
     "  if (false) {"),
    (CERT, "a never-reconciled menu passes data quality (200 mistaken for correct)",
     "  if (inputs.reconcile === null) {",
     "  if (false) {"),
    (CERT, "a reconcile WITH errors passes data quality",
     "  } else if (!inputs.reconcile.ok) {",
     "  } else if (false) {"),

    # ---- structural guarantees ----
    (CERT, "Leafly's 2-business-day notice is understated",
     "export const LEAFLY_CERTIFICATION_NOTICE_BUSINESS_DAYS = 2;",
     "export const LEAFLY_CERTIFICATION_NOTICE_BUSINESS_DAYS = 0;"),
    (CERT, "blockers are never collected (the owner is told nothing to fix)",
     "    blockers.push(`${c.finding} \\u2014 ${c.remedy}`);",
     "    void c;"),
    (CERT, "production stops being a blocker",
     '  if (inputs.environment !== "sandbox") {',
     "  if (false) {"),
]


# Harness lesson 6.
CHILD_ENV = {
    "NODE_OPTIONS": "--max-old-space-size=1536",
}


def run(cmd: list[str]) -> int:
    """Run a command, capturing output. Returns the REAL exit code.

    Never piped -- see harness lesson 1.
    """
    env = {**os.environ, **CHILD_ENV}
    return subprocess.run(
        cmd,
        cwd=REPO,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    ).returncode


def suite_fails() -> bool:
    """True when EITHER the vitest files OR the pure self-tests go red.

    `--no-file-parallelism --maxWorkers=1` keeps this to a single worker, and
    both flag names were CHECKED against this installed vitest's `--help`
    before use (harness lesson 7).
    """
    if run(
        [
            "npx",
            "vitest",
            "run",
            "--no-file-parallelism",
            "--maxWorkers=1",
            *TESTS,
        ]
    ) != 0:
        return True
    if run(["npx", "tsx", SELFTEST_ENTRY]) != 0:
        return True
    return False


def main() -> int:
    files = sorted({m[0] for m in MUTATIONS})
    originals = {f: (REPO / f).read_text() for f in files}

    print("=== SLICE L-4 mutation testing ===")
    print(f"    {len(MUTATIONS)} mutations across {len(files)} files\n", flush=True)

    print("--- baseline (must be GREEN before any mutation) ---", flush=True)
    if suite_fails():
        print("  BASELINE IS RED -- aborting. Fix the suite before mutating it.")
        for f in files:
            (REPO / f).write_text(originals[f])
        return 1
    print("  baseline GREEN\n", flush=True)

    caught = 0
    missed: list[str] = []
    harness_errors: list[str] = []

    try:
        for i, (path, name, frm, to) in enumerate(MUTATIONS, start=1):
            # Restore every file so mutations never stack.
            for f in files:
                (REPO / f).write_text(originals[f])

            src = originals[path]
            if frm not in src:
                print(f"  M{i:02d} HARNESS ERROR -- pattern not found: {name}", flush=True)
                harness_errors.append(name)
                continue
            if src.count(frm) > 1:
                print(
                    f"  M{i:02d} HARNESS ERROR -- pattern is ambiguous "
                    f"({src.count(frm)}x): {name}",
                    flush=True,
                )
                harness_errors.append(name)
                continue

            mutated = src.replace(frm, to, 1)
            if mutated == src:
                print(f"  M{i:02d} HARNESS ERROR -- mutation was a no-op: {name}", flush=True)
                harness_errors.append(name)
                continue

            (REPO / path).write_text(mutated)

            if suite_fails():
                caught += 1
                print(f"  M{i:02d} CAUGHT   [{path.name}] {name}", flush=True)
            else:
                print(f"  M{i:02d} *** SURVIVED *** [{path.name}] {name}", flush=True)
                missed.append(f"[{path.name}] {name}")
    finally:
        for f in files:
            (REPO / f).write_text(originals[f])
        for f in files:
            assert (REPO / f).read_text() == originals[f], f"RESTORE FAILED for {f}"
        print("\n  all sources restored byte-identical", flush=True)

    total = len(MUTATIONS)
    print(
        f"\n=== L-4: {caught}/{total} caught, {len(missed)} survived, "
        f"{len(harness_errors)} harness error(s) ==="
    )
    for m in missed:
        print(f"    SURVIVED: {m}")
    for h in harness_errors:
        print(f"    HARNESS ERROR: {h}")

    return 0 if (caught == total and not harness_errors) else 1


if __name__ == "__main__":
    sys.exit(main())
