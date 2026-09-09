#!/usr/bin/env python3
"""
scripts/compliance/mutate-d1.py  (SLICE D1)

TEST THE TESTS. A green suite proves nothing unless a broken implementation
turns it red. This harness reintroduces each defect D1 fixed, one at a time,
runs the D1 suites, and requires a FAILURE. A mutation that survives means the
tests do not actually protect that behaviour.

Every file is restored from its exact pre-mutation bytes in a finally block, and
the tree is verified clean at the end.

Run:  python3 scripts/compliance/mutate-d1.py
"""

import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ENGINE = "src/lib/promotions/discount-engine-core.ts"
APPORTION = "src/lib/promotions/bundle-apportionment-core.ts"
CART = "src/lib/specials/cart-discount.ts"
PUBLISHED = "src/lib/promotions/published-rules-core.ts"
SEED = "src/lib/promotions/daily-deal-seed.ts"

SUITES = [
    "tests/compliance/doobie-tuesday-and-sunday.test.ts",
    "tests/compliance/pure-selftests.test.ts",
    # SLICE D2: these guard the card/cart advertising parity fixes (the struck
    # card price and the merch brand-match guard).
    "tests/compliance/cart-discount-parity.test.ts",
    "tests/compliance/promotions-harmony-parity.test.ts",
    "tests/compliance/deal-badge-core.test.ts",
    "tests/compliance/cart-estimator-core.test.ts",
]

# (label, file, old, new) - each reintroduces a real defect this slice removed.
MUTATIONS = [
    (
        "either/or reverts to 'whichever saves the customer LESS'",
        ENGINE,
        "savingsA >= savingsB ? optionA : optionB",
        "savingsA <= savingsB ? optionA : optionB",
    ),
    (
        "N-for-M reverts to a FLOORED whole-number percent",
        APPORTION,
        "Math.floor(ideal[i])",
        "Math.floor(ideal[i] * 0.97)",
    ),
    (
        "apportionment stops topping up to the target (silent shortfall)",
        APPORTION,
        "while (placed < target && steps < maxSteps) {",
        "while (false && placed < target && steps < maxSteps) {",
    ),
    (
        "apportionment rounds AGAINST the customer instead of up",
        APPORTION,
        "Math.ceil",
        "Math.floor",
    ),
    (
        "Tuesday tier 4+ drops from 25% back to 20%",
        SEED,
        "{ at: 4, percent: 25 },",
        "{ at: 4, percent: 20 },",
    ),
    (
        "Tuesday tier threshold moves from 4 to 6 prerolls",
        SEED,
        "{ at: 4, percent: 25 },",
        "{ at: 6, percent: 25 },",
    ),
    (
        "seedConfigFor stops deriving from the seed (returns nothing)",
        PUBLISHED,
        'const tiers = DAILY_DEAL_SEEDS.find((s) => s.promoKey === "daily.tuesday")?.qtyTiers;',
        "const tiers: { at: number; percent: number }[] | undefined = undefined;",
    ),
    (
        "website cart drifts back to a flat 20% at all quantities",
        CART,
        "const percent = totalEligibleUnits >= 4 ? 25 : 20;",
        "const percent = 20;",
    ),
    (
        "website cart tier threshold drifts away from the engine",
        CART,
        "const percent = totalEligibleUnits >= 4 ? 25 : 20;",
        "const percent = totalEligibleUnits >= 8 ? 25 : 20;",
    ),
    (
        "cost floor removed from the bundle spread (below-cost sales)",
        ENGINE,
        "floorMinorUnits: clampEngineUnit(l, 0)",
        "floorMinorUnits: 0",
    ),
    # ----------------------------------------------------------------- D2
    (
        "D2: flat percent reverts to rounding AGAINST the customer",
        ENGINE,
        "Math.ceil((line.regularPriceMinorUnits * p) / 100)",
        "Math.round((line.regularPriceMinorUnits * p) / 100)",
    ),
    (
        "D2: website cart rounds differently from the register",
        CART,
        "Math.ceil((line.regularPriceMinorUnits * cappedPercent) / 100)",
        "Math.round((line.regularPriceMinorUnits * cappedPercent) / 100)",
    ),
    (
        "D2: Wednesday's 20% base tier disappears (back to nothing under $150)",
        SEED,
        "{ at: 0, percent: 20 },",
        "{ at: 5000, percent: 20 },",
    ),
    (
        "D2: Wednesday's $150 threshold moves",
        SEED,
        "{ at: 15000, percent: 30 },",
        "{ at: 20000, percent: 30 },",
    ),
    (
        "D2: the $50/15% ladder rung comes back to the website cart",
        CART,
        "return spendMinorUnits > 0 ? 20 : 0; // every eligible basket gets 20%",
        "if (spendMinorUnits >= 5000) return 15;\n  return 0;",
    ),
    (
        "D2: admin save silently drops the zero-threshold base tier",
        "src/app/admin/promotions/actions.ts",
        "at >= 0 && Number.isFinite(percent)",
        "at > 0 && Number.isFinite(percent)",
    ),
    (
        "D2: seedConfigFor stops deriving Wednesday from the seed",
        PUBLISHED,
        'const tiers = DAILY_DEAL_SEEDS.find((s) => s.promoKey === "daily.wednesday")?.spendTiers;',
        "const tiers: { at: number; percent: number }[] | undefined = undefined;",
    ),
    # ---- SLICE D2: card/cart advertising parity -------------------------
    (
        "struck card price reverts to the HEADLINE percent (over-advertises)",
        PUBLISHED,
        "  const guaranteed = Math.max(...matching.map((s) => guaranteedPercentFor(s, item)));",
        "  const guaranteed = Math.max(...matching.map((s) => headlinePercentFor(s)));",
    ),
    (
        "guaranteedPercentFor spend branch returns the TOP tier",
        PUBLISHED,
        "    return tierPercent(item.priceMinorUnits, tiers);",
        "    return Math.max(...tiers.map((t) => t.percent));",
    ),
    (
        "merch brand-match guard removed (branded merch struck on Thursday)",
        ENGINE,
        "  if (isMerch(line) && !catMatch) return false;",
        "  if (false && isMerch(line) && !catMatch) return false;",
    ),
    (
        "Wednesday base spend tier reverts to a $50 threshold",
        SEED,
        "      { at: 0, percent: 20 },\n      { at: 15000, percent: 30 },",
        "      { at: 5000, percent: 20 },\n      { at: 15000, percent: 30 },",
    ),
    (
        "card guarantee joins its rule by TITLE instead of identity",
        PUBLISHED,
        "  const matching = activeRules.filter((s) => ruleMatchesLine(snapshotToEngineRule(s), line));",
        "  const matching = activeRules.filter((s) => s.title === deal.label);",
    ),
    (
        "guaranteedPercentFor checks the authored percent BEFORE basket mechanics",
        PUBLISHED,
        'if (s.discountType === "basket" || c.basketTopItem || c.basketNforM) return 0;\n  if (s.discountPercent > 0',
        'if (s.discountPercent > 0',
    ),
    (
        "Tuesday 4+ tier reverts to 20% (advertised 25% not honoured)",
        SEED,
        "      { at: 1, percent: 20 },\n      { at: 4, percent: 25 },",
        "      { at: 1, percent: 20 },\n      { at: 4, percent: 20 },",
    ),
]


def run_suites():
    """Return True when the suites PASS."""
    env = dict(os.environ, NODE_OPTIONS="--max-old-space-size=3000")
    p = subprocess.run(
        ["npx", "vitest", "run", *SUITES],
        cwd=REPO,
        env=env,
        capture_output=True,
        text=True,
        timeout=900,
    )
    return p.returncode == 0, p.stdout + p.stderr


def summarise(out):
    clean = re.sub(r"\x1b\[[0-9;]*m", "", out)
    for line in clean.splitlines():
        if re.match(r"^\s+(Test Files|Tests)\s+\d", line):
            print("      " + line.strip())


def main():
    print("Baseline: the suites must PASS before any mutation.")
    ok, out = run_suites()
    summarise(out)
    if not ok:
        print("BASELINE IS RED - fix the suite before mutation testing.")
        sys.exit(1)
    print("Baseline green.\n")

    caught, survived = 0, []

    for i, (label, relpath, old, new) in enumerate(MUTATIONS, 1):
        path = os.path.join(REPO, relpath)
        with open(path, "r", encoding="utf-8") as f:
            pristine = f.read()

        n = pristine.count(old)
        if n < 1:
            print(f"{i:2}. {label}\n      SKIPPED - anchor not found in {relpath}")
            survived.append(label + " (anchor missing)")
            continue

        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(pristine.replace(old, new, 1))
            ok, out = run_suites()
            if ok:
                print(f"{i:2}. {label}\n      SURVIVED - the tests did NOT catch this")
                summarise(out)
                survived.append(label)
            else:
                print(f"{i:2}. {label}\n      caught")
                caught += 1
        finally:
            with open(path, "w", encoding="utf-8") as f:
                f.write(pristine)
            with open(path, "r", encoding="utf-8") as f:
                assert f.read() == pristine, f"RESTORE FAILED for {relpath}"

    print(f"\nMutation score: {caught}/{len(MUTATIONS)} caught")

    dirty = subprocess.run(
        ["git", "diff", "--stat", "--", ENGINE, APPORTION, CART, PUBLISHED, SEED],
        cwd=REPO, capture_output=True, text=True,
    ).stdout.strip()
    print("Tree restored." if not dirty else f"WARNING - files left modified:\n{dirty}")

    print("\nRe-verifying the suites are green after restore...")
    ok, out = run_suites()
    summarise(out)
    if not ok:
        print("POST-RESTORE RED - the tree was not restored correctly.")
        sys.exit(1)

    if survived:
        print("\nSURVIVING MUTATIONS (gaps in the net):")
        for s in survived:
            print("  -", s)
        sys.exit(1)
    print("\nAll mutations caught.")


if __name__ == "__main__":
    main()
