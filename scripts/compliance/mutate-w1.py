#!/usr/bin/env python3
"""SLICE W1 mutation harness -- TEST THE TESTS.

The pre-W1 suite was fully GREEN while "1/8 oz" read as 224 g on the discount
side and null on the compliance side. Green means nothing by itself. This
harness re-introduces each defect one at a time -- including the exact original
regexes -- and demands the suite CATCHES it. A survivor is untested behaviour.

EQUIVALENT MUTANTS -- REMOVED AFTER MEASUREMENT, NOT AFTER GUESSING.
The first run left 4 survivors. scripts/probe-survivors.ts checked each one
directly and proved none can change observable behaviour, so no test could ever
kill them:

  - "decimal alternative first": the pattern is ANCHORED, so a short match
    fails at `\s*(unit)$` and the engine backtracks into the remaining
    alternatives. All 8 probe labels captured identically under both orderings
    ("1 1/2 oz" -> "1 1/2"). (It also proved a comment in weight-label-core
    FALSE, which W1d corrected.)
  - the three numeric guards, removed ONE at a time: byte-identical output
    across all 8 probes, because the guards deliberately overlap.

Removing them PAIRWISE, however, IS observable -- "0g" returns 0 instead of
null, and "1/0 oz" returns Infinity into the WAC limit arithmetic. Those are
the two mutations that replaced the four below, so this harness measures real
coverage instead of reporting permanent survivors.
"""
import io
import subprocess
import sys

VITEST = [
    "npx", "vitest", "run",
    "tests/compliance/weight-label-parity.test.ts",
    "tests/compliance/variant-grams-core.test.ts",
    "tests/compliance/cart-discount-parity.test.ts",
    "tests/compliance/pure-selftests.test.ts",
    "tests/compliance/liquid-limit-ml-plumbing.test.ts",
]

CORE = "src/lib/compliance/weight-label-core.ts"
ENGINE = "src/lib/promotions/discount-engine-core.ts"
CART = "src/lib/specials/cart-discount.ts"
VARIANT = "src/lib/pos/variant-grams-core.ts"

MUTATIONS = [
    # --- THE ORIGINAL DEFECT, restored verbatim --------------------------
    (
        "engine: restore the ORIGINAL unanchored regex (1/8 oz -> 224 g)",
        ENGINE,
        "export function gramsForLabel(label?: string | null): number {\n"
        "  return parseWeightLabelGrams(label) ?? 0;\n"
        "}",
        "export function gramsForLabel(label?: string | null): number {\n"
        "  if (!label) return 0;\n"
        "  const s = label.trim().toLowerCase();\n"
        "  const oz = s.match(/([\\d.]+)\\s*(oz|ounce)/);\n"
        "  if (oz) return parseFloat(oz[1]) * 28;\n"
        "  const g = s.match(/([\\d.]+)\\s*g\\b/);\n"
        "  if (g) return parseFloat(g[1]);\n"
        "  return 0;\n"
        "}",
    ),
    (
        "cart: restore the ORIGINAL unanchored regex on the website side",
        CART,
        "export function gramsForLabel(label?: string): number {\n"
        "  return parseWeightLabelGrams(label) ?? 0;\n"
        "}",
        "export function gramsForLabel(label?: string): number {\n"
        "  if (!label) return 0;\n"
        "  const n = label.trim().toLowerCase();\n"
        "  const oz = n.match(/([\\d.]+)\\s*(oz|ounce)/);\n"
        "  if (oz) return parseFloat(oz[1]) * 28;\n"
        "  const g = n.match(/([\\d.]+)\\s*g\\b/);\n"
        "  if (g) return parseFloat(g[1]);\n"
        "  return 0;\n"
        "}",
    ),
    (
        "variant: restore the old regex (drops fraction support -> parsers disagree again)",
        VARIANT,
        "  return parseWeightLabelGrams(label);\n}",
        "  if (typeof label !== \"string\") return null;\n"
        "  const s = label.trim().toLowerCase();\n"
        "  if (!s) return null;\n"
        "  const m = s.match(/^(\\d+(?:\\.\\d+)?)\\s*(g|gram|grams|oz|ounce|ounces)$/);\n"
        "  if (!m) return null;\n"
        "  const qty = Number(m[1]);\n"
        "  if (!Number.isFinite(qty) || qty <= 0) return null;\n"
        "  return round3(m[2].startsWith(\"g\") ? qty : qty * GRAMS_PER_OUNCE);\n}",
    ),
    # --- anchoring --------------------------------------------------------
    (
        "core: drop the ^ anchor (substring matching returns)",
        CORE,
        "const WEIGHT_LABEL_RE = new RegExp(`^(${QTY})\\\\s*(g|gram|grams|oz|ounce|ounces)$`);",
        "const WEIGHT_LABEL_RE = new RegExp(`(${QTY})\\\\s*(g|gram|grams|oz|ounce|ounces)$`);",
    ),
    (
        "core: drop the $ anchor (trailing text tolerated -> '10pk 0.5g' parses)",
        CORE,
        "const WEIGHT_LABEL_RE = new RegExp(`^(${QTY})\\\\s*(g|gram|grams|oz|ounce|ounces)$`);",
        "const WEIGHT_LABEL_RE = new RegExp(`^(${QTY})\\\\s*(g|gram|grams|oz|ounce|ounces)`);",
    ),
    (
        "core: admit ml as a weight unit (VOLUME becomes WEIGHT -- the L2 defect)",
        CORE,
        "const WEIGHT_LABEL_RE = new RegExp(`^(${QTY})\\\\s*(g|gram|grams|oz|ounce|ounces)$`);",
        "const WEIGHT_LABEL_RE = new RegExp(`^(${QTY})\\\\s*(g|gram|grams|oz|ounce|ounces|ml|mg)$`);",
    ),
    # --- quantity alternation ordering (load-bearing) ---------------------
    # (an 'alternation order' mutant lived here; proven EQUIVALENT -- see docstring)
    (
        "core: drop fraction support entirely (1/8 oz stops parsing)",
        CORE,
        "const QTY = `(?:\\\\d+\\\\s+\\\\d+\\\\/\\\\d+|\\\\d+\\\\s*[${UNI}]|\\\\d+\\\\/\\\\d+|[${UNI}]|\\\\d+(?:\\\\.\\\\d+)?)`;",
        "const QTY = `(?:\\\\d+(?:\\\\.\\\\d+)?)`;",
    ),
    # --- fraction arithmetic ---------------------------------------------
    (
        "core: invert the fraction (1/8 oz -> 8x an ounce)",
        CORE,
        "    return Number(fraction[1]) / den;",
        "    return den / Number(fraction[1]);",
    ),
    (
        "core: drop the integer part of a mixed number (1 1/2 oz -> 14 g)",
        CORE,
        "    return Number(mixedAscii[1]) + Number(mixedAscii[2]) / den;",
        "    return Number(mixedAscii[2]) / den;",
    ),
    # (a lone 'zero denominator' mutant lived here; EQUIVALENT alone)
    (
        "core: drop the mixed-unicode integer part",
        CORE,
        "    return Number(mixedUnicode[1]) + frac;",
        "    return frac;",
    ),
    # --- unit resolution --------------------------------------------------
    (
        "core: treat every unit as grams (an ounce becomes 1 g)",
        CORE,
        '  const grams = m[2].startsWith("g") ? qty : qty * STATUTORY_GRAMS_PER_OUNCE;',
        "  const grams = qty;",
    ),
    (
        "core: treat every unit as ounces (a gram becomes 28 g)",
        CORE,
        '  const grams = m[2].startsWith("g") ? qty : qty * STATUTORY_GRAMS_PER_OUNCE;',
        "  const grams = qty * STATUTORY_GRAMS_PER_OUNCE;",
    ),
    (
        "core: use 28.35 for the statutory ounce (loosens a LICENSE constant)",
        CORE,
        '  const grams = m[2].startsWith("g") ? qty : qty * STATUTORY_GRAMS_PER_OUNCE;',
        '  const grams = m[2].startsWith("g") ? qty : qty * 28.35;',
    ),
    # --- refusal guards ---------------------------------------------------
    # --- the guards are redundant SINGLY but not JOINTLY (measured) -------
    (
        "core: remove BOTH numeric guards at once ('0g' -> 0 instead of null)",
        CORE,
        [
            (
                "  if (qty === null || !Number.isFinite(qty) || qty <= 0) return null;",
                "  if (qty === null) return null;",
            ),
            (
                "  if (!Number.isFinite(grams) || grams <= 0) return null;",
                "  // MUTANT: grams guard removed too.",
            ),
        ],
    ),
    (
        "core: unguard grams AND qty AND the zero denominator ('1/0 oz' -> Infinity)",
        CORE,
        [
            (
                "    const den = Number(fraction[2]);\n    if (den === 0) return null;",
                "    const den = Number(fraction[2]);",
            ),
            (
                "  if (qty === null || !Number.isFinite(qty) || qty <= 0) return null;",
                "  if (qty === null) return null;",
            ),
            (
                "  if (!Number.isFinite(grams) || grams <= 0) return null;",
                "  // MUTANT: all three guards removed.",
            ),
        ],
    ),
    (
        "core: skip the trim/lowercase normalisation",
        CORE,
        '  const s = label.trim().toLowerCase().replace(/\\s+/g, " ");',
        "  const s = label;",
    ),
    (
        "core: drop the non-string guard (hostile input throws)",
        CORE,
        '  if (typeof label !== "string") return null;',
        "  if (false) return null;",
    ),
    (
        "core: round to 0 decimals (3.5 g eighth becomes 4 g)",
        CORE,
        "  return Math.round(n * 1000) / 1000;",
        "  return Math.round(n);",
    ),
    # --- the fixture table itself ----------------------------------------
    (
        "core: corrupt the shared fixture table (1/8 oz declared as 224 g)",
        CORE,
        '{ label: "1/8 oz", grams: 3.5, why: "THE FIX -- was 224 g (matched the \'8 oz\' substring)" },',
        '{ label: "1/8 oz", grams: 224, why: "corrupted" },',
    ),
    (
        "core: empty the fixture table (parity loops would pass vacuously)",
        CORE,
        "export const WEIGHT_LABEL_FIXTURES: ReadonlyArray<{ label: string; grams: number | null; why: string }> = [",
        "export const WEIGHT_LABEL_FIXTURES: ReadonlyArray<{ label: string; grams: number | null; why: string }> = [].concat([",
    ),
]


def run_suite() -> bool:
    p = subprocess.run(VITEST, capture_output=True, text=True)
    return p.returncode == 0


def main() -> int:
    print("Baseline: the suite must be GREEN before mutating.")
    if not run_suite():
        print("  BASELINE IS RED - fix that first.")
        return 1
    print("  baseline green.\n")

    caught, survived = 0, []
    for i, (name, path, spec, *rest) in enumerate(MUTATIONS, start=1):
        # A mutation carries EITHER a single (old, new) pair -- passed as two
        # trailing fields -- OR a list of pairs applied TOGETHER. Joint edits
        # exist because some guards in this module are redundant singly and
        # observable only in combination (measured, see docstring), so a
        # one-line mutation of them is an unkillable equivalent mutant.
        edits = spec if isinstance(spec, list) else [(spec, rest[0])]
        with io.open(path, encoding="utf-8") as f:
            original = f.read()
        bad = [o for o, _ in edits if original.count(o) != 1]
        if bad:
            print(f"[{i:2}/{len(MUTATIONS)}] SKIP (bad anchor): {name}")
            survived.append(f"{name}  [BAD ANCHOR]")
            continue
        mutated = original
        for o, nw in edits:
            mutated = mutated.replace(o, nw, 1)
        with io.open(path, "w", encoding="utf-8") as f:
            f.write(mutated)
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
