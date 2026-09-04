#!/usr/bin/env python3
"""
SLICE 18-0 mutation testing.

Owner instruction: "Make sure to test everything including the tests."

A green suite proves nothing on its own - it might be asserting things that are
true no matter what the code does. So we deliberately BREAK each compliance
decision and require the suite to notice. A mutant that survives is a hole.

PRE-FLIGHT DISCIPLINE (this is the part that matters):
Every mutation is (file, exact-old-text, new-text). Before running anything we
verify each `old` appears EXACTLY ONCE in its file. If an anchor is missing or
ambiguous we ABORT the whole run rather than skip it - because a mutation that
silently fails to apply looks identical to a mutation that was caught, and
would report a false PASS. That failure mode would make this entire exercise
worse than useless.
"""
import subprocess
import sys

MUTANTS = [
    # ---------------------------------------------------------------- gate --
    (
        "the gate stops firing on liquid shelves",
        "src/lib/inventory/receiving-classification-core.ts",
        "needsOtherwiseTakenPick: isLiquidShelf || suspected,",
        "needsOtherwiseTakenPick: suspected,",
    ),
    (
        "the gate ignores the suppository detector",
        "src/lib/inventory/receiving-classification-core.ts",
        "needsOtherwiseTakenPick: isLiquidShelf || suspected,",
        "needsOtherwiseTakenPick: isLiquidShelf,",
    ),
    (
        "the gate stops blocking (warns instead of refusing)",
        "src/lib/inventory/receiving-classification-core.ts",
        "if (input.assessment.needsOtherwiseTakenPick && otFlag === \"\") {",
        "if (false) {",
    ),
    (
        "YES no longer requires a unit count",
        "src/lib/inventory/receiving-classification-core.ts",
        "if (otFlag === \"yes\" && unitsPerPackage === null) {",
        "if (false) {",
    ),
    (
        "a fractional unit count is accepted",
        "src/lib/inventory/receiving-classification-core.ts",
        "if (!Number.isInteger(n)) {",
        "if (false) {",
    ),
    (
        "the 4 mg low-THC ceiling is dropped",
        "src/lib/inventory/receiving-classification-core.ts",
        "if (unitThcMg > LOW_THC_UNIT_MAX_MG) {",
        "if (false) {",
    ),
    (
        "low-THC becomes a hard gate too (breaks the asymmetry)",
        "src/lib/inventory/receiving-classification-core.ts",
        "promptsLowThcLiquid: isLiquidShelf,",
        "promptsLowThcLiquid: false,",
    ),
    (
        "provenance lies: a machine default claims to be human",
        "src/lib/inventory/receiving-classification-core.ts",
        """      otherwiseTaken:
        otFlag === ""
          ? RECEIVING_CLASSIFICATION_PROVENANCE.machine
          : RECEIVING_CLASSIFICATION_PROVENANCE.human,""",
        "      otherwiseTaken: RECEIVING_CLASSIFICATION_PROVENANCE.human,",
    ),
    (
        "the two flags are no longer mutually exclusive",
        "src/lib/inventory/receiving-classification-core.ts",
        "if (otFlag === \"yes\" && lowThcLiquid === true) {",
        "if (false) {",
    ),
    # -------------------------------------------------------------- review --
    (
        "the dock stops warning about unclassified suspects",
        "src/lib/inventory/intake-review-core.ts",
        "if (line.otherwise_taken == null && suspectsOtherwiseTaken({",
        "if (false && suspectsOtherwiseTaken({",
    ),
    (
        "the dock re-nags a product a human already answered",
        "src/lib/inventory/intake-review-core.ts",
        "if (line.otherwise_taken == null && suspectsOtherwiseTaken({",
        "if (line.otherwise_taken !== true && suspectsOtherwiseTaken({",
    ),
    # ----------------------------------------------------------- injection --
    (
        "the flags are dropped on the way to the menu",
        "src/lib/pos/draft-injection-core.ts",
        "otherwise_taken: d.chosen_otherwise_taken ?? null,",
        "otherwise_taken: null,",
    ),
    (
        "an explicit false collapses into null",
        "src/lib/pos/draft-injection-core.ts",
        "otherwise_taken: d.chosen_otherwise_taken ?? null,",
        "otherwise_taken: d.chosen_otherwise_taken || null,",
    ),
    (
        "the unit count is dropped on the way to the menu",
        "src/lib/pos/draft-injection-core.ts",
        "units_per_package: d.chosen_units_per_package ?? null,",
        "units_per_package: null,",
    ),
    # ------------------------------------------------- stage 4: read-back --
    # These three are the quietest failures in the pipeline. None of them
    # crash, none of them corrupt data, and none of them fail a typecheck in
    # isolation. They just make the dock nag about lots a human already
    # classified, until staff learn to scroll past the compliance warning
    # entirely. That is why they get mutants of their own.
    (
        "the read-back stops selecting the human's answer",
        "src/lib/inventory/intake-store.ts",
        "unit_cost_minor_units, otherwise_taken\",",
        "unit_cost_minor_units\",",
    ),
    (
        "the answer is dropped at the map into the review summary",
        "src/app/admin/inventory/intake/[id]/page.tsx",
        "otherwise_taken: l.otherwise_taken,",
        "",
    ),
    (
        "unanswered collapses into answered-no at the read-back",
        "src/app/admin/inventory/intake/[id]/page.tsx",
        "otherwise_taken: l.otherwise_taken,",
        "otherwise_taken: l.otherwise_taken ?? false,",
    ),
]

SUITES = [
    "tests/compliance/otherwise-taken-receiving.test.ts",
    "tests/compliance/receiving-classification-parity.test.ts",
    "tests/compliance/receiving-pipeline-plumbing.test.ts",
    "tests/compliance/otherwise-taken-limit.test.ts",
    "tests/compliance/low-thc-liquid-limit.test.ts",
]


def read(p):
    with open(p, encoding="utf-8") as fh:
        return fh.read()


def write(p, s):
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(s)


# ---------------------------------------------------------------- PRE-FLIGHT
print("PRE-FLIGHT: verifying every anchor matches exactly once")
originals = {}
problems = []
for name, path, old, new in MUTANTS:
    if path not in originals:
        originals[path] = read(path)
    n = originals[path].count(old)
    if n != 1:
        problems.append(f"  {name}: anchor appears {n}x in {path}")

if problems:
    print("ABORT - anchors are not unique. Nothing was run:")
    for p in problems:
        print(p)
    sys.exit(1)
print(f"  OK - all {len(MUTANTS)} anchors unique\n")

# ------------------------------------------------------------------- BASELINE
print("BASELINE: the suite must be green before we break anything")
r = subprocess.run(
    ["npx", "vitest", "run", *SUITES],
    capture_output=True, text=True,
)
if r.returncode != 0:
    print("ABORT - baseline is already failing.")
    print(r.stdout[-3000:])
    sys.exit(1)
print("  OK - baseline green\n")

# ------------------------------------------------------------------- MUTATE
survivors = []
try:
    for i, (name, path, old, new) in enumerate(MUTANTS, 1):
        write(path, originals[path].replace(old, new))
        r = subprocess.run(
            ["npx", "vitest", "run", *SUITES],
            capture_output=True, text=True,
        )
        write(path, originals[path])  # restore immediately
        if r.returncode == 0:
            survivors.append(name)
            print(f"  [{i:2}/{len(MUTANTS)}] SURVIVED  <-- HOLE: {name}")
        else:
            print(f"  [{i:2}/{len(MUTANTS)}] killed    {name}")
finally:
    for path, src in originals.items():
        write(path, src)
    print("\nall files restored")

print()
if survivors:
    print(f"{len(survivors)} MUTANT(S) SURVIVED - the tests do not cover:")
    for s in survivors:
        print("  - " + s)
    sys.exit(1)
print(f"ALL {len(MUTANTS)} MUTANTS KILLED")
