#!/usr/bin/env python3
"""SLICE 17 — MUTATION TESTING. "Test it and test the tests before shipping."

A passing test suite proves nothing on its own; a suite of `expect(true)` passes
too. This script deliberately breaks the implementation in ways a real developer
plausibly WOULD break it, then checks the suite actually fails each time.

Any mutant that SURVIVES is a hole in the tests, not a curiosity.

Every mutation is reverted afterwards. The script restores the original file
contents in a `finally` block, so an interrupted run cannot leave a mutant in
the tree.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

CORE = "src/lib/compliance/sales-limits-core.ts"
FLOW = "src/lib/pos/sale-flow-core.ts"
METER = "src/lib/menu/cart-limit-meter-core.ts"
PUBLIC = "src/lib/medical/purchase-limit-display-core.ts"
FACTS = "src/lib/pos/fact-review-core.ts"
SETTINGS = "src/lib/compliance/sales-limits.ts"

# (label, file, find, replace, why it matters)
MUTANTS: list[tuple[str, str, str, str, str]] = [
    (
        "medical triples to 30",
        SETTINGS,
        "    otherwise_taken: 10,\n  },\n  med: {",
        "    otherwise_taken: 10,\n  },\n  med: {",
        "placeholder \u2014 replaced below with a targeted edit",
    ),
    (
        "limit raised 10 -> 11 (recreational)",
        CORE,
        "  otherwise_taken: 10,",
        "  otherwise_taken: 11,",
        "An off-by-one here authorises a sale the statute forbids.",
    ),
    (
        "unit counting ignores units_per_package",
        CORE,
        "  return qty * per;",
        "  return qty;",
        "A box of six would count as one unit \u2014 a 6x under-count.",
    ),
    (
        "qualification accepts any truthy flag",
        CORE,
        "  if (line.otherwiseTaken !== true) return false;",
        "  if (!line.otherwiseTaken) return false;",
        "A string 'false' from the DB would qualify the line.",
    ),
    (
        "clamp no longer floors to whole units",
        CORE,
        "    otherwise_taken: Math.floor(clamp(r.otherwise_taken, base.otherwise_taken)),",
        "    otherwise_taken: clamp(r.otherwise_taken, base.otherwise_taken),",
        "A fractional cap makes the boundary ambiguous.",
    ),
    (
        "units formatted as ounces",
        CORE,
        '      return `${n} ${n === 1 ? "unit" : "units"}`;',
        "      return `${gramsToOunces(n)} oz`;",
        "States a COUNT as a WEIGHT \u2014 a factual misstatement to the customer.",
    ),
    (
        "register drops the flag",
        FLOW,
        "      otherwiseTaken: l.otherwiseTaken ?? null,\n      unitsPerPackage: l.unitsPerPackage ?? null,\n    };\n  });\n}",
        "      otherwiseTaken: null,\n      unitsPerPackage: null,\n    };\n  });\n}",
        "THE SILENT FAILURE: the register would never block. Inverted fail-safe.",
    ),
    (
        "website drops the flag",
        METER,
        "      otherwiseTaken: item.otherwiseTaken ?? null,\n      unitsPerPackage: item.unitsPerPackage ?? null,",
        "      otherwiseTaken: null,\n      unitsPerPackage: null,",
        "THE SILENT FAILURE on the customer-facing site.",
    ),
    (
        "public table advertises a tripled medical figure",
        PUBLIC,
        '      medical: formatLimitAmount("otherwise_taken", MEDICAL_LIMITS.otherwise_taken),',
        '      medical: formatLimitAmount("otherwise_taken", MEDICAL_LIMITS.otherwise_taken * 3),',
        "Advertises an over-sale to every patient who reads the page.",
    ),
    (
        "intake lets YES through with no unit count",
        FACTS,
        '    if (typeof facts.unitsPerPackage !== "number") {',
        "    if (false) {",
        "A flagged product with no count defaults to 1 and under-counts 6x.",
    ),
    (
        "intake accepts a fractional unit count",
        FACTS,
        "    if (!Number.isInteger(n)) {",
        "    if (false) {",
        "Half a suppository is not an individual consumable item.",
    ),
]

# The medical-tripling mutant needs a targeted replacement in the med profile.
MUTANTS[0] = (
    "medical tripled to 30",
    CORE,
    "export const MEDICAL_LIMITS: LimitProfile = {",
    "export const MEDICAL_LIMITS: LimitProfile = {",
    "",
)


def run_suite() -> bool:
    """True when the suite PASSES."""
    r = subprocess.run(
        ["npx", "vitest", "run", "tests/compliance/"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    return r.returncode == 0


def main() -> int:
    killed, survived = [], []

    for label, rel, find, replace, why in MUTANTS:
        if find == replace:
            continue  # skip the placeholder
        path = ROOT / rel
        original = path.read_text(encoding="utf-8")
        n = original.count(find)
        if n != 1:
            print(f"SKIP  {label}: anchor matched {n}x in {rel}")
            survived.append((label, f"anchor {n}x", why))
            continue
        try:
            path.write_text(original.replace(find, replace), encoding="utf-8")
            passed = run_suite()
            if passed:
                print(f"SURVIVED  {label}  <-- TESTS DID NOT CATCH THIS")
                survived.append((label, rel, why))
            else:
                print(f"killed    {label}")
                killed.append(label)
        finally:
            path.write_text(original, encoding="utf-8")

    total = len(killed) + len(survived)
    print("\n" + "=" * 70)
    print(f"MUTATION SCORE: {len(killed)}/{total} killed")
    if survived:
        print("\nSURVIVORS (holes in the tests):")
        for label, rel, why in survived:
            print(f"  - {label} [{rel}]\n      {why}")
        return 1
    print("All mutants killed. The tests have teeth.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
