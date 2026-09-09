#!/usr/bin/env python3
"""SLICE D3 mutation harness - TEST THE TESTS.

A green suite proves nothing on its own: the pre-D3 suite was green while the
advertised Saturday headline reached nobody in 100% of clearance baskets. This
harness re-introduces each defect one at a time and demands the suite CATCHES
it. A surviving mutant is an untested line of behaviour.

Usage:  python3 scripts/compliance/mutate-d3.py
"""
import io
import subprocess
import sys

VITEST = [
    "npx", "vitest", "run",
    "tests/compliance/saturday-headline.test.ts",
    "tests/compliance/pure-selftests.test.ts",
    "tests/compliance/cart-discount-parity.test.ts",
    "tests/compliance/promotions-harmony-parity.test.ts",
]

ENGINE = "src/lib/promotions/discount-engine-core.ts"
CART = "src/lib/specials/cart-discount.ts"
CORE = "src/lib/promotions/saturday-headline-core.ts"

# (name, path, old, new)  -- each reverts one D3 guarantee.
MUTATIONS = [
    # --- the clearance hijack (DEFECT 1) ---------------------------------
    (
        "core: ignore competing offers (restores the clearance hijack)",
        CORE,
        "    if (competing >= headline) continue;",
        "    if (false && competing >= headline) continue;",
    ),
    (
        "core: treat every competing offer as blocking (headline never awarded)",
        CORE,
        "    if (competing >= headline) continue;",
        "    if (competing >= 0) continue;",
    ),
    (
        "engine: stop passing competing savings into the basket rule",
        ENGINE,
        "    const discounts = applyOnePromotion(rule, lines, competing);",
        "    const discounts = applyOnePromotion(rule, lines, undefined);",
    ),
    (
        "engine: never build the competing map",
        ENGINE,
        "  if (ordered.some(isBasketHeadline)) {",
        "  if (false && ordered.some(isBasketHeadline)) {",
    ),
    (
        "engine: let basket rules contribute to their own competing map",
        ENGINE,
        "      if (isBasketHeadline(rule)) continue;",
        "      if (false) continue;",
    ),
    # --- headline target selection ---------------------------------------
    (
        "core: pick the DEAREST line instead of the cheapest",
        CORE,
        "      c.regularPriceMinorUnits < bestPrice ||",
        "      c.regularPriceMinorUnits > bestPrice ||",
    ),
    (
        "core: drop the deterministic tie-break (cart-order sensitivity)",
        CORE,
        "      (c.regularPriceMinorUnits === bestPrice && bestId !== null && c.lineId < bestId)",
        "      (c.regularPriceMinorUnits === bestPrice && bestId !== null && false)",
    ),
    (
        "core: never award a headline at all",
        CORE,
        "      bestId = c.lineId;",
        "      bestId = bestId;",
    ),
    # --- exact-cent maths (DEFECT 2) -------------------------------------
    (
        "core: round the DISCOUNT down (the pre-D2 under-delivery)",
        CORE,
        "  return Math.ceil((regularPriceMinorUnits * percent) / 100);",
        "  return Math.floor((regularPriceMinorUnits * percent) / 100);",
    ),
    (
        "core: round the PRICE instead of the discount (the original defect)",
        CORE,
        "  return Math.ceil((regularPriceMinorUnits * percent) / 100);",
        "  return regularPriceMinorUnits - Math.round(regularPriceMinorUnits * (1 - percent / 100));",
    ),
    (
        "core: give the headline rate to EVERY unit on the line",
        CORE,
        "  const headlineUnits = isHeadlineLine ? Math.min(1, qty) : 0;",
        "  const headlineUnits = isHeadlineLine ? qty : 0;",
    ),
    (
        "core: give the headline to NO unit on the target line",
        CORE,
        "  const headlineUnits = isHeadlineLine ? Math.min(1, qty) : 0;",
        "  const headlineUnits = 0;",
    ),
    (
        "core: ceil the blended unit (overcharges the line)",
        CORE,
        "    blendedUnitMinorUnits: Math.floor(total / qty),",
        "    blendedUnitMinorUnits: Math.ceil(total / qty),",
    ),
    (
        "core: mislabel a blended line with the rest percent",
        CORE,
        "  return Math.round((savingsMinorUnits / regularTotal) * 100);",
        "  return 15;",
    ),
    # --- website parity ---------------------------------------------------
    (
        "cart: website reverts to rounding the price",
        CART,
        "        const t = saturdayLineTotal(line.regularPriceMinorUnits, line.quantity, 30, 15, true);",
        "        const t = { blendedUnitMinorUnits: Math.round(line.regularPriceMinorUnits * 0.85) };",
    ),
    (
        "cart: website picks the headline by cart order",
        CART,
        "      const topLineId = pickHeadlineLine(",
        "      const topLineId = ((): string | null => eligible[0]?.lineId ?? null)() ?? pickHeadlineLine(",
    ),
    (
        "cart: website swaps the two percents",
        CART,
        '          resultMap.set(line.lineId, applyPercentLine(line, 30, "Super Saturday"));',
        '          resultMap.set(line.lineId, applyPercentLine(line, 15, "Super Saturday"));',
    ),
    (
        "cart: everything else gets 30 instead of 15",
        CART,
        '          resultMap.set(line.lineId, applyPercentLine(line, 15, "Super Saturday"));\n          continue;',
        '          resultMap.set(line.lineId, applyPercentLine(line, 30, "Super Saturday"));\n          continue;',
    ),
    # --- cost floor must never regress -----------------------------------
    (
        "engine: drop the cost-floor clamp on the blended line",
        ENGINE,
        "          const blendedUnit = clampEngineUnit(l, t.blendedUnitMinorUnits);",
        "          const blendedUnit = t.blendedUnitMinorUnits;",
    ),
]


def run_suite() -> bool:
    """True when the suite PASSES."""
    p = subprocess.run(VITEST, capture_output=True, text=True)
    return p.returncode == 0


def main() -> int:
    print("Baseline: the suite must be GREEN before mutating.")
    if not run_suite():
        print("  BASELINE IS RED - fix that first.")
        return 1
    print("  baseline green.\n")

    caught, survived = 0, []
    for i, (name, path, old, new) in enumerate(MUTATIONS, start=1):
        with io.open(path, encoding="utf-8") as f:
            original = f.read()
        if original.count(old) != 1:
            print(f"[{i:2}/{len(MUTATIONS)}] SKIP (anchor {original.count(old)}x): {name}")
            survived.append(f"{name}  [BAD ANCHOR]")
            continue
        with io.open(path, "w", encoding="utf-8") as f:
            f.write(original.replace(old, new, 1))
        try:
            passed = run_suite()
        finally:
            with io.open(path, "w", encoding="utf-8") as f:
                f.write(original)
        if passed:
            print(f"[{i:2}/{len(MUTATIONS)}] SURVIVED  {name}")
            survived.append(name)
        else:
            print(f"[{i:2}/{len(MUTATIONS)}] caught    {name}")
            caught += 1

    print(f"\nRESULT: {caught}/{len(MUTATIONS)} mutations caught.")
    if survived:
        print("SURVIVORS (untested behaviour):")
        for s in survived:
            print(f"  - {s}")
        return 1
    print("Every injected defect was caught.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
