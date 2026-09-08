#!/usr/bin/env python3
"""
L5a mutation harness — TEST THE TESTS.

A passing suite proves nothing on its own; it only proves the suite agrees with
today's code. This deliberately BREAKS the L5a fix, one edit at a time, and
demands the suite NOTICE. A mutation that survives is a hole in the tests, not
a curiosity.

Each mutation: apply to a pristine copy -> run the L5a suites -> restore.
Python string .replace() with an exact count assertion (never perl/regex: `$`
and `\\s` get mangled in TS source), plus a read-back off disk.

Usage:  python3 scripts/compliance/mutate-l5a.py
"""
import io
import os
import shutil
import subprocess
import sys
import tempfile

CORE = "src/lib/compliance/liquid-volume-core.ts"
METER = "src/lib/menu/cart-limit-meter-core.ts"
PANEL = "src/components/menu/ProductDetailPurchasePanel.tsx"
PROVIDER = "src/components/cart/CartProvider.tsx"
POSMENU = "src/app/api/pos/menu/route.ts"
PRICING = "src/lib/orders/order-pricing.ts"
LIVEMENU = "src/lib/pos/live-menu.ts"

SUITES = [
    "tests/compliance/liquid-limit-ml-website.test.ts",
    "tests/compliance/liquid-limit-ml-engine.test.ts",
    "tests/compliance/liquid-limit-ml-plumbing.test.ts",
    "tests/compliance/liquid-volume-core.test.ts",
]

# (id, file, old, new, what breaking it would mean in the real world)
MUTATIONS = [
    # ---- the precedence itself (defect 2) ---------------------------------
    ("M01", CORE,
     "  const fromLabel = volumeMlFromLabel(variantLabel);\n  if (fromLabel !== null) return fromLabel;",
     "  const fromLabel = volumeMlFromLabel(variantLabel);\n  if (fromLabel !== null && cardNetVolumeMl == null) return fromLabel;",
     "card measure silently outranks the label again = the 1.5L-on-a-750-card oversell returns"),
    ("M02", CORE,
     "  const fromLabel = volumeMlFromLabel(variantLabel);\n  if (fromLabel !== null) return fromLabel;",
     "  const fromLabel = volumeMlFromLabel(variantLabel);\n  if (false) return fromLabel;",
     "label ignored entirely; every variant measured as the first in-stock lot"),
    ("M03", CORE,
     "    cardNetVolumeMl > 0\n  ) {\n    return cardNetVolumeMl;",
     "    cardNetVolumeMl >= 0\n  ) {\n    return cardNetVolumeMl;",
     "a 0 ml card measure becomes a real size -> line reads as free of the limit"),
    ("M04", CORE,
     "  if (\n    typeof cardNetVolumeMl === \"number\" &&\n    Number.isFinite(cardNetVolumeMl) &&\n    cardNetVolumeMl > 0\n  ) {\n    return cardNetVolumeMl;\n  }\n  return null;",
     "  return null;",
     "card measure never used -> unlabelled 'each' bottles go unmeasured again"),
    ("M05", CORE,
     "  if (\n    typeof cardNetVolumeMl === \"number\" &&\n    Number.isFinite(cardNetVolumeMl) &&\n    cardNetVolumeMl > 0\n  ) {",
     "  if (\n    typeof cardNetVolumeMl === \"number\" &&\n    cardNetVolumeMl > 0\n  ) {",
     "NaN/Infinity card measure leaks through as a volume"),
    ("M06", CORE,
     "  return null;\n}\n\n/** Render millilitres for a human",
     "  return 0;\n}\n\n/** Render millilitres for a human",
     "UNKNOWN becomes 0 — the single most dangerous coercion in the module"),
    # ---- the website wiring (defect 1) ------------------------------------
    ("M07", METER,
     "    const perUnitMl = resolveUnitVolumeMl(item.variantLabel, item.unitVolumeMl);",
     "    const perUnitMl = resolveUnitVolumeMl(item.variantLabel, null);",
     "website drops the measured volume -> 72 unlabelled bottles read legal again"),
    ("M08", METER,
     "    const perUnitMl = resolveUnitVolumeMl(item.variantLabel, item.unitVolumeMl);",
     "    const perUnitMl = resolveUnitVolumeMl(null, item.unitVolumeMl);",
     "website ignores the label -> mixed-size cards mis-measured online"),
    ("M09", METER,
     "      ...(volumeMl !== null && volumeMl > 0 ? { volumeMl } : {}),",
     "      ...(volumeMl !== null && volumeMl > 999999 ? { volumeMl } : {}),",
     "volume computed then dropped before the engine ever sees it"),
    ("M10", PANEL,
     "            unitVolumeMl: item.netVolumeMl ?? null,",
     "            unitVolumeMl: null,",
     "product page stops carrying the measurement into the cart"),
    ("M11", PROVIDER,
     "  unitVolumeMl?: number | null;",
     "  unitVolumeMlXX?: number | null;",
     "the cart item shape loses the field, so nothing can supply it"),
    # ---- the other surfaces that must not disagree ------------------------
    ("M12", POSMENU,
     "        unitVolumeMl: resolveUnitVolumeMl(variant.label, item.netVolumeMl),",
     "        unitVolumeMl: item.netVolumeMl ?? volumeMlFromLabel(variant.label),",
     "the REGISTER reverts to card-first precedence (the original defect 2)"),
    ("M13", PRICING,
     "      unitVolumeMl: resolveUnitVolumeMl(w.resolved.variant.label, w.resolved.item.netVolumeMl),",
     "      unitVolumeMl: w.resolved.item.netVolumeMl ?? volumeMlFromLabel(w.resolved.variant.label),",
     "the SERVER order gate reverts to card-first precedence"),
    ("M14", LIVEMENU,
     "    netVolumeMl: row.net_volume_ml ?? null,",
     "    netVolumeMl: null,",
     "the measurement never leaves the database; every fix above goes inert"),
    # ---- the cap itself ---------------------------------------------------
    ("M15", CORE,
     "export const REC_LIQUID_FLUID_OUNCES = 72;",
     "export const REC_LIQUID_FLUID_OUNCES = 720;",
     "the statutory cap is loosened tenfold"),
    ("M16", CORE,
     "export const ML_PER_FLUID_OUNCE = 29.5735;",
     "export const ML_PER_FLUID_OUNCE = 28.0;",
     "fluid ounces quietly become weight ounces again — the owner's Q1 decision"),
]


def run_suites(cwd: str) -> bool:
    """True = suites PASS (mutation SURVIVED = bad)."""
    env = dict(os.environ, NODE_OPTIONS="--max-old-space-size=3000")
    proc = subprocess.run(
        ["npx", "vitest", "run", *SUITES],
        cwd=cwd, env=env, capture_output=True, text=True, timeout=1800,
    )
    return proc.returncode == 0


def main() -> int:
    repo = os.getcwd()
    caught, survived = [], []

    for mid, path, old, new, meaning in MUTATIONS:
        full = os.path.join(repo, path)
        original = io.open(full, encoding="utf-8").read()
        count = original.count(old)
        if count != 1:
            print(f"{mid}  ERROR: anchor matched {count}x in {path} (expected 1)")
            survived.append((mid, path, meaning, f"anchor {count}x"))
            continue

        backup = tempfile.mktemp(suffix=".bak")
        shutil.copy2(full, backup)
        try:
            io.open(full, "w", encoding="utf-8").write(original.replace(old, new, 1))
            back = io.open(full, encoding="utf-8").read()
            assert new in back, f"{mid}: mutation did not land on disk"

            passed = run_suites(repo)
            if passed:
                survived.append((mid, path, meaning, "SUITES STILL PASSED"))
                print(f"{mid}  SURVIVED  <-- HOLE IN THE TESTS: {meaning}")
            else:
                caught.append(mid)
                print(f"{mid}  caught    ({meaning})")
        finally:
            shutil.copy2(backup, full)
            os.unlink(backup)
            assert io.open(full, encoding="utf-8").read() == original, f"{mid}: RESTORE FAILED on {path}"

    print("\n" + "=" * 70)
    print(f"L5a MUTATION RESULT: {len(caught)}/{len(MUTATIONS)} caught, {len(survived)} survived")
    if survived:
        print("\nSURVIVORS (each is a hole to close or to justify in writing):")
        for mid, path, meaning, why in survived:
            print(f"  {mid} {path}\n      {meaning}\n      {why}")
        return 1
    print("Every mutation was caught.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
