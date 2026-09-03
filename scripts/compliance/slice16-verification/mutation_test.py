#!/usr/bin/env python3
"""
SLICE 16 -- mutation testing for the low-THC beverage limit.

Michael asked us to "test it AND the tests before shipping". A green suite only
proves the tests AGREE with today's code; it does not prove they would NOTICE if
the code changed. So we deliberately inject each of the plausible wrong
implementations -- the ones a future maintainer (or a future agent working from
memory instead of the statute) would most likely write -- and assert the suite
goes RED.

A mutant that SURVIVES (suite still green) is a hole in the test suite.

Run:  python3 scripts/slice16/mutation_test.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]

# Fail loudly if this file is ever moved without updating the depth above.
# A silently-wrong repo root would make every mutant "survive" for the wrong
# reason and turn this verification asset into a liar.
if not (REPO / "package.json").is_file():
    raise SystemExit(
        f"repo root resolution is wrong: {REPO} has no package.json. "
        "This script moved directories - update the parents[N] depth."
    )
ENGINE = REPO / "src/lib/compliance/sales-limits-core.ts"
SUITES = [
    "tests/compliance/low-thc-liquid-limit.test.ts",
    "tests/compliance/sales-limits.test.ts",
]

# (name, why-a-human-would-write-this, find, replace)
MUTANTS: list[tuple[str, str, str, str]] = [
    (
        "cap-as-ounces",
        'Reads "200" in the WAC and assumes it is 200 oz like the 72 oz line above it.',
        "  low_thc_liquid: 200, // 200 mg THC \u2014 WAC 314-55-095(1)(d)(i)(F)",
        "  low_thc_liquid: 200 * GRAMS_PER_OUNCE, // mutant",
    ),
    (
        "medical-tripled",
        "Every other medical bucket is 3x rec, so a maintainer 'fixes the bug' and triples this one too.",
        "  low_thc_liquid: 200, // 200 mg THC \u2014 NOT tripled. See the note above.",
        "  low_thc_liquid: 600, // mutant",
    ),
    (
        "per-unit-ceiling-off-by-one",
        "Reads 'no more than four milligrams' as an exclusive bound.",
        "  return mg <= LOW_THC_UNIT_MAX_MG;",
        "  return mg < LOW_THC_UNIT_MAX_MG;",
    ),
    (
        "per-unit-ceiling-wrong-number",
        "Confuses the 4 mg per-unit ceiling with some other number.",
        "export const LOW_THC_UNIT_MAX_MG = 4;",
        "export const LOW_THC_UNIT_MAX_MG = 10;",
    ),
    (
        "flag-not-required",
        "Drops the explicit intake flag and trusts the mg field alone -- the exact "
        "shortcut that makes a 16 mg multi-serving bottle qualify.",
        "  if (line.lowThcLiquid !== true) return false;",
        "  if (line.lowThcLiquid === false) return false;",
    ),
    (
        "truthy-flag",
        "Uses a loose truthy check so the string \"false\" / 1 / {} unlock the bucket.",
        "  if (line.lowThcLiquid !== true) return false;",
        "  if (!line.lowThcLiquid) return false;",
    ),
    (
        "additive-not-exclusive",
        "Treats (E) and (F) as additive -- qualifying units burn BOTH the 72 oz "
        "volume bucket and the 200 mg bucket. The WAC says 'unless'.",
        "  if (qualifiesAsLowThcLiquid(line)) return \"low_thc_liquid\";\n  return categoryToBucket(line.category);",
        "  return categoryToBucket(line.category);",
    ),
    (
        "quantity-ignored",
        "Counts the product once instead of once per can -- breaks the 4-pack rule.",
        "  if (!qualifiesAsLowThcLiquid(line)) return 0;",
        "  if (!qualifiesAsLowThcLiquid(line)) return 0;\n  return Number(line.unitThcMg) || 0;\n  // eslint-disable-next-line no-unreachable",
    ),
    (
        "negative-mg-accepted",
        "Forgets that a bad intake value can be negative or zero.",
        "  if (!Number.isFinite(mg) || mg <= 0) return false;",
        "  if (!Number.isFinite(mg)) return false;",
    ),
    (
        "solid-edible-qualifies",
        "Lets a low-THC gummy into the beverage bucket -- (E)/(F) are liquid-only.",
        '  if (categoryToBucket(line.category) !== "liquid_edible") return false;',
        "  // bucket check removed",
    ),
    (
        "formats-thc-as-ounces",
        "Formats the mg bucket through gramsToOunces, so 200 mg renders as '7.143 oz'.",
        "  if (isThcBucket(bucket)) return `${round3(amount)} mg THC`;",
        "  if (isThcBucket(bucket)) return `${gramsToOunces(amount)} oz`;",
    ),
    (
        "bucket-dropped-from-list",
        "Removes the bucket from the exported list -- settings UI silently loses it.",
        '  "liquid_edible",\n  "low_thc_liquid",\n] as const;',
        '  "liquid_edible",\n] as const;',
    ),
]


def run_suite() -> bool:
    """True when the suite is GREEN."""
    proc = subprocess.run(
        ["npx", "vitest", "run", *SUITES],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


def main() -> int:
    original = ENGINE.read_text()

    print("=" * 74)
    print("SLICE 16 MUTATION TEST -- proving the tests would catch a regression")
    print("=" * 74)

    print("\nBaseline (unmutated engine) ... ", end="", flush=True)
    if not run_suite():
        print("RED -- baseline must be green before mutating. Aborting.")
        return 1
    print("GREEN")

    survivors: list[str] = []
    unapplied: list[str] = []

    try:
        for name, why, find, replace in MUTANTS:
            count = original.count(find)
            if count != 1:
                unapplied.append(f"{name} (anchor matched {count}x, expected 1)")
                print(f"\n  !! {name}: anchor not unique ({count}x) -- MUTANT NOT APPLIED")
                continue

            ENGINE.write_text(original.replace(find, replace, 1))
            green = run_suite()
            ENGINE.write_text(original)

            status = "SURVIVED (test gap!)" if green else "killed"
            mark = "!!" if green else "ok"
            print(f"\n  [{mark}] {name}: {status}")
            print(f"       why a human writes this: {why}")
            if green:
                survivors.append(name)
    finally:
        ENGINE.write_text(original)

    print("\n" + "=" * 74)
    print(f"mutants: {len(MUTANTS)}   killed: {len(MUTANTS) - len(survivors) - len(unapplied)}"
          f"   survived: {len(survivors)}   not-applied: {len(unapplied)}")
    if unapplied:
        print("NOT APPLIED (fix the anchors):")
        for u in unapplied:
            print(f"  - {u}")
    if survivors:
        print("SURVIVORS -- the suite does NOT catch these:")
        for s in survivors:
            print(f"  - {s}")
        return 1
    if unapplied:
        return 1
    print("ALL MUTANTS KILLED -- the suite has real teeth.")
    print("=" * 74)
    # restore-verify
    assert ENGINE.read_text() == original, "engine not restored!"
    return 0


if __name__ == "__main__":
    sys.exit(main())
