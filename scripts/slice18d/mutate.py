#!/usr/bin/env python3
"""
SLICE 18D - MUTATION HARNESS.

Michael: "Test everything including the tests."

A green suite proves nothing on its own. It could be green because the code is
right, or green because the assertions never actually look. The only way to
tell the difference is to BREAK the code on purpose and confirm the suite
notices.

Every mutant below is a defect a budtender would feel, or a lie the register
would tell: a marker on a product the limit meter would refuse, a chip that
filters to nothing, an invisible filter with no control to clear it, a
classification computed and thrown away.

If a mutant SURVIVES, the suite has a hole and the SUITE gets strengthened -
never the mutant softened.

SAFETY (this edits tracked source, so it is built to fail safe):
  1. PRE-FLIGHT: every anchor must match EXACTLY ONCE in its file. If any
     anchor is missing or ambiguous, we abort having written nothing at all.
  2. BASELINE: the suite must be green before we start. Mutation results are
     meaningless against an already-red suite.
  3. RESTORE: originals are held in memory and rewritten in a `finally`, so
     Ctrl-C, an exception or a failing subprocess still leaves a clean tree.
  4. VERIFY: after restoring we re-run the baseline to prove the tree really is
     back where it started.
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

SEARCH_CORE = "src/lib/pos/classification-search-core.ts"
GRID_CORE = "src/lib/pos/sale-grid-core.ts"
SALE_FLOW = "src/app/pos/SaleFlow.tsx"
SELFTESTS = "scripts/compliance/run-pure-selftests.ts"

VITEST = [
    "npx",
    "vitest",
    "run",
    "tests/compliance/pos-classification-visibility.test.ts",
    "tests/compliance/pos-classification-plumbing.test.ts",
    "tests/compliance/sale-grid-core.test.ts",
]
SELFTEST_CMD = ["npx", "tsx", "scripts/slice18d/run-selftests.ts"]

EM_DASH = "\u2014"


@dataclass(frozen=True)
class Mutant:
    ident: str
    path: str
    old: str
    new: str
    why: str


MUTANTS: list[Mutant] = [
    # -- THE CENTRAL RULE: a marker must mean the LIMIT METER agrees ---------
    Mutant(
        "M01-marker-uses-raw-flags",
        SEARCH_CORE,
        "  const line = toLine(product);\n  return kind === \"low_thc_liquid\"\n    ? qualifiesAsLowThcLiquid(line)\n    : qualifiesAsOtherwiseTaken(line);\n}",
        "  return kind === \"low_thc_liquid\"\n    ? product.lowThcLiquid === true\n    : product.otherwiseTaken === true;\n}",
        "Key the marker off the raw booleans instead of the register's rules. "
        "THE bug of this slice: a 99 mg drink would wear a 'Low-THC' marker "
        "while the meter still counts it against the 72 oz liquid limit.",
    ),
    Mutant(
        "M02-marker-inverted",
        SEARCH_CORE,
        "  return kind === \"low_thc_liquid\"\n    ? qualifiesAsLowThcLiquid(line)\n    : qualifiesAsOtherwiseTaken(line);",
        "  return kind === \"low_thc_liquid\"\n    ? qualifiesAsOtherwiseTaken(line)\n    : qualifiesAsLowThcLiquid(line);",
        "Swap the two predicates so a suppository is marked 'Low-THC' and a "
        "beverage is marked 'Suppository'.",
    ),
    Mutant(
        "M03-marker-always-on",
        SEARCH_CORE,
        "export function productHasClassification(\n  product: ClassifiableProduct,\n  kind: PosClassificationKind,\n): boolean {",
        "export function productHasClassification(\n  product: ClassifiableProduct,\n  kind: PosClassificationKind,\n): boolean {\n  if (kind) return true;",
        "Mark every product in every lane, so flower wears a suppository badge.",
    ),
    Mutant(
        "M04-marker-always-off",
        SEARCH_CORE,
        "export function productClassifications(\n  product: ClassifiableProduct,\n): PosClassificationKind[] {\n  return POS_CLASSIFICATION_KINDS.filter((kind) =>\n    productHasClassification(product, kind),\n  );",
        "export function productClassifications(\n  product: ClassifiableProduct,\n): PosClassificationKind[] {\n  return [];",
        "The whole slice computed and thrown away: no tile ever shows a marker. "
        "This is the 18C product-page defect in its register form.",
    ),
    # -- Lane order and counts ----------------------------------------------
    Mutant(
        "M05-lane-order-unstable",
        SEARCH_CORE,
        "export const POS_CLASSIFICATION_KINDS: readonly PosClassificationKind[] = [\n  \"low_thc_liquid\",\n  \"otherwise_taken\",\n] as const;",
        "export const POS_CLASSIFICATION_KINDS: readonly PosClassificationKind[] = [\n  \"otherwise_taken\",\n  \"low_thc_liquid\",\n] as const;",
        "Reverse the lane order so chips move between shifts and muscle memory "
        "sends a budtender to the wrong chip.",
    ),
    Mutant(
        "M06-chip-for-empty-lane",
        SEARCH_CORE,
        "  return POS_CLASSIFICATION_KINDS.filter((kind) => (counts.get(kind) ?? 0) > 0).map(",
        "  return POS_CLASSIFICATION_KINDS.filter((kind) => (counts.get(kind) ?? 0) >= 0).map(",
        "Render a chip for a lane with zero stock: tapping it empties the grid "
        "and promises inventory the store does not have.",
    ),
    Mutant(
        "M07-chip-count-wrong",
        SEARCH_CORE,
        "      counts.set(kind, (counts.get(kind) ?? 0) + 1);",
        "      counts.set(kind, (counts.get(kind) ?? 0) + 2);",
        "Inflate the chip count so the number beside the chip disagrees with "
        "the number of tiles the chip actually shows.",
    ),
    # -- Labels and the shared vocabulary -----------------------------------
    Mutant(
        "M08-title-hand-typed",
        SEARCH_CORE,
        "  low_thc_liquid: LIMIT_BUCKET_LABELS.low_thc_liquid,\n  otherwise_taken: LIMIT_BUCKET_LABELS.otherwise_taken,",
        "  low_thc_liquid: \"Low THC drinks\",\n  otherwise_taken: \"Suppositories\",",
        "Retype the statutory wording instead of deriving it, so the register "
        "and the limit meter can describe the same bucket two different ways.",
    ),
    Mutant(
        "M09-label-promises-a-number",
        SEARCH_CORE,
        "  low_thc_liquid: \"Low-THC\",\n  otherwise_taken: \"Suppository\",",
        "  low_thc_liquid: \"200 mg cap\",\n  otherwise_taken: \"10 units\",",
        "Put a quantity on a chip. The allowance depends on the WHOLE cart, so "
        "a per-product number is a promise the register cannot keep.",
    ),
    # -- The filter knob -----------------------------------------------------
    Mutant(
        "M10-filter-knob-ignored",
        GRID_CORE,
        "  const lane = classification\n    ? searched.filter((p) => productHasClassification(p, classification))\n    : searched;",
        "  const lane = searched;",
        "The chip highlights but the grid never narrows.",
    ),
    Mutant(
        "M11-filter-knob-not-optional",
        GRID_CORE,
        "  classification: PosClassificationKind | null = null,",
        "  classification: PosClassificationKind | null,",
        "Drop the default so the knob is no longer optional. Every existing "
        "three-argument caller changes meaning.",
    ),
    Mutant(
        "M12-filter-uses-raw-flag",
        GRID_CORE,
        "    ? searched.filter((p) => productHasClassification(p, classification))",
        "    ? searched.filter((p) => p.lowThcLiquid === true || p.otherwiseTaken === true)",
        "Filter on the raw flags, so the 'Low-THC' chip surfaces a 99 mg drink "
        "the meter refuses to treat as low-THC.",
    ),
    Mutant(
        "M13-filter-drops-category",
        GRID_CORE,
        "  if (!category) return lane;\n  const key = category.trim().toLowerCase();\n  if (!key) return lane;\n  return lane.filter((p) => (p.category ?? \"\").trim().toLowerCase() === key);",
        "  return lane;",
        "Regress B36: the classification filter silently disables the category "
        "chip, so 18D would not be additive.",
    ),
    # -- The sale screen -----------------------------------------------------
    Mutant(
        "M14-chips-not-rendered",
        SALE_FLOW,
        "          {classificationChips.length > 0 ? (",
        "          {false ? (",
        "Derive the chips and never render them - the registry-read-discarded "
        "defect 18C found on the product page, repeated at the register.",
    ),
    Mutant(
        "M15-lane-not-passed-to-filter",
        SALE_FLOW,
        "    () => filterMenuProducts(bundle.products, query, category, activeClassification).slice(0, 60),",
        "    () => filterMenuProducts(bundle.products, query, category).slice(0, 60),",
        "Tapping a chip changes nothing: the grid keeps showing everything.",
    ),
    Mutant(
        "M16-invisible-filter",
        SALE_FLOW,
        "    () =>\n      classification && classificationChips.some((c) => c.kind === classification)\n        ? classification\n        : null,",
        "    () => classification,",
        "Remove the self-healing derivation. When the last low-THC drink sells "
        "out the chip disappears while the filter stays on, leaving an empty "
        "grid and no control on screen to clear it.",
    ),
    Mutant(
        "M17-quick-search-filtered",
        SALE_FLOW,
        "    () => filterMenuProducts(bundle.products, query, null).slice(0, 6),",
        "    () => filterMenuProducts(bundle.products, query, null, activeClassification).slice(0, 6),",
        "Apply the lane to the main-screen quick search too, which AM-A "
        "explicitly forbids: an invisible filter there reads as missing stock.",
    ),
    Mutant(
        "M18-tile-marker-not-rendered",
        SALE_FLOW,
        "          <ClassificationBadge product={product} />",
        "          {null}",
        "The tile marker vanishes, so a budtender is never told a product is "
        "specially limited unless they already knew to search for it.",
    ),
    Mutant(
        "M19-marker-hardcodes-label",
        SALE_FLOW,
        "          {POS_CLASSIFICATION_LABELS[kind]}",
        "          {\"Low-THC\"}",
        "Hard-code the label so a suppository is labelled 'Low-THC' on the tile.",
    ),
    Mutant(
        "M20-marker-not-silent",
        SALE_FLOW,
        "  if (kinds.length === 0) return null;",
        "  if (kinds.length === -1) return null;",
        "Render the badge wrapper for every product. Silence is the only honest "
        "output for an unclassified product, because a stale bundle looks "
        "identical to one that is genuinely in no lane.",
    ),
    # -- CI registration ------------------------------------------------------
    Mutant(
        "M21-core-unregistered-in-ci",
        SELFTESTS,
        "{ const r = __runPosClassificationSearchTests(); if (r.passed < 1)",
        "{ const r = { passed: 1 }; if (r.passed < 1)",
        "Stop running the register core's self-tests in CI while still printing "
        "a reassuring line.",
    ),
]


def run(cmd: list[str]) -> tuple[bool, str]:
    proc = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    return proc.returncode == 0, f"exit {proc.returncode}"


def gate_passes() -> tuple[bool, str]:
    ok, detail = run(SELFTEST_CMD)
    if not ok:
        return False, f"selftest {detail}"
    ok, detail = run(VITEST)
    if not ok:
        return False, f"vitest {detail}"
    return True, "green"


def main() -> int:
    print("=" * 74)
    print("SLICE 18D MUTATION HARNESS")
    print("=" * 74)

    # -- 1. PRE-FLIGHT: verify every anchor before touching anything --------
    problems: list[str] = []
    originals: dict[str, str] = {}
    for m in MUTANTS:
        full = REPO / m.path
        if m.path not in originals:
            originals[m.path] = full.read_text(encoding="utf-8")
        hits = originals[m.path].count(m.old)
        if hits != 1:
            problems.append(f"  {m.ident}: anchor matched {hits}x in {m.path}")
    if problems:
        print("PRE-FLIGHT FAILED - no files were written:")
        print("\n".join(problems))
        return 2
    print(f"pre-flight OK: {len(MUTANTS)} anchors, each unique.")

    # -- 2. BASELINE ---------------------------------------------------------
    ok, detail = gate_passes()
    if not ok:
        print(f"BASELINE IS RED ({detail}) - fix that before mutating.")
        return 2
    print("baseline green.\n")

    killed = 0
    survivors: list[Mutant] = []

    try:
        for m in MUTANTS:
            full = REPO / m.path
            text = originals[m.path]
            full.write_text(text.replace(m.old, m.new, 1), encoding="utf-8")

            ok, detail = gate_passes()
            if ok:
                survivors.append(m)
                print(f"  SURVIVED  {m.ident}  <-- TEST GAP")
                print(f"            {m.why}")
            else:
                killed += 1
                print(f"  killed    {m.ident}  ({detail})")

            full.write_text(text, encoding="utf-8")
    finally:
        # -- 3. UNCONDITIONAL RESTORE ---------------------------------------
        for path, text in originals.items():
            (REPO / path).write_text(text, encoding="utf-8")
        print("\nall source files restored.")

    # -- 4. VERIFY THE TREE IS TRULY CLEAN ----------------------------------
    ok, detail = gate_passes()
    status = "green" if ok else "RED " + EM_DASH + " " + detail
    print(f"post-restore baseline: {status}")
    if not ok:
        return 2

    print("=" * 74)
    print(f"killed {killed}/{len(MUTANTS)}   survivors: {len(survivors)}")
    print("=" * 74)
    if survivors:
        print("\nStrengthen the suite until each survivor dies:")
        for m in survivors:
            print(f"  - {m.ident}: {m.why}")
        return 1
    print("Every mutant was caught. The tests test.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
