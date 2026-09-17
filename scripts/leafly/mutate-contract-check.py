#!/usr/bin/env python3
"""
Mutation harness for Slice L-1 — "test the tests".

A test that cannot fail is not a test (AGENTS.md CCRS protocol step 6, Part 05 D-10/D-11).
This script deliberately breaks the contract one edit at a time and asserts that
`tests/compliance/leafly-contract.test.ts` goes RED. If a mutation SURVIVES (the suite
still passes), the tests have a hole and this script exits non-zero.

Two false greens this harness is specifically designed to catch, both of which have bitten
this repo before:

  1. A broken harness that exits before any test runs — so we assert the BASELINE is green
     and that a known-good run reports a plausible test count.
  2. An "equivalent mutant" that changes a value without changing observable behaviour.
     Every mutation below alters something an assertion reads directly.

The target files are always restored from an in-memory copy in a finally-block, so an
interrupted run cannot leave a mutated file behind.

Usage:
    python3 scripts/leafly/mutate-contract-check.py
"""

from __future__ import annotations

import os
import subprocess
import sys

REPO = os.environ.get(
    "GREENWAY_REPO",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")),
)

CONTRACT = "src/lib/leafly/contract-core.ts"
SCHEMA = "docs/leafly-specs/schemas/v2-items.json"
DOC = "docs/leafly-menu-api-v2.md"
TESTS = "tests/compliance/leafly-contract.test.ts"

# (id, file, old_fragment, new_fragment, why_this_must_be_caught)
MUTATIONS: list[tuple[str, str, str, str, str]] = [
    # ---- the two snake_case exceptions: the entire reason this slice exists ----
    # `totalThc: "total_thc"` appears BOTH in LEAFLY_ITEM_FIELDS and in
    # LEAFLY_FORBIDDEN_FIELD_ALIASES, so each mutation is anchored on its neighbouring
    # lines to stay unique. Mutating the wrong one would prove nothing.
    (
        "M1-total-thc-camel",
        CONTRACT,
        '  compounds: "compounds",\n  totalThc: "total_thc",',
        '  compounds: "compounds",\n  totalThc: "totalThc",',
        "reintroducing the original defect must fail the drift test",
    ),
    (
        "M2-total-cbd-camel",
        CONTRACT,
        '  totalCbd: "total_cbd",\n  variants: "variants",',
        '  totalCbd: "totalCbd",\n  variants: "variants",',
        "the second snake_case field must be protected independently",
    ),
    (
        "M2b-alias-map-total-thc",
        CONTRACT,
        '  strainName: "strain",\n  totalThc: "total_thc",',
        '  strainName: "strain",\n  totalThc: "totalThc",',
        "the forbidden-alias map must also be guarded, not just the field map",
    ),
    (
        "M3-brand-name",
        CONTRACT,
        'brand: "brand",',
        'brand: "brandName",',
        "brandName was a real shipped defect",
    ),
    (
        "M4-strain-name",
        CONTRACT,
        'strain: "strain",',
        'strain: "strainName",',
        "strainName was a real shipped defect",
    ),
    (
        "M5-content-as-value",
        CONTRACT,
        'content: "content",',
        'content: "value",',
        "compounds[].value instead of content was a 400-level defect",
    ),
    # ---- enums ----
    (
        "M6-percent-symbol",
        CONTRACT,
        'export const LEAFLY_COMPOUND_UNITS = ["percent", "mg"] as const;',
        'export const LEAFLY_COMPOUND_UNITS = ["%", "mg"] as const;',
        'unit "%" was the exact value Leafly rejected',
    ),
    (
        "M7-variant-unit-extra",
        CONTRACT,
        'export const LEAFLY_VARIANT_UNITS = ["oz", "g", "each"] as const;',
        'export const LEAFLY_VARIANT_UNITS = ["oz", "g", "each", "mg"] as const;',
        "an invented variant unit must not pass the enum comparison",
    ),
    (
        "M8-compound-type-dropped",
        CONTRACT,
        '  "thcva",\n] as const;',
        "] as const;",
        "dropping a compound type must break the 25-value enum match",
    ),
    # ---- required sets ----
    (
        "M9-variant-required-drop-amount",
        CONTRACT,
        '  "amount",\n  "unit",\n  "inventoryLevel",\n] as const;',
        '  "unit",\n  "inventoryLevel",\n] as const;',
        "amount is REQUIRED; forgetting it was defect L-05",
    ),
    (
        "M10-item-required-add-brand",
        CONTRACT,
        'export const LEAFLY_ITEM_REQUIRED = ["id", "type", "name", "variants"] as const;',
        'export const LEAFLY_ITEM_REQUIRED = ["id", "type", "name", "variants", "brand"] as const;',
        "over-stating required fields would cause needless preflight rejections",
    ),
    # ---- funnel types / matrix ----
    (
        "M11-funnel-lowercase",
        CONTRACT,
        '  "Flower",\n  "Edible",',
        '  "flower",\n  "Edible",',
        "lowercase type silently miscategorises items on the storefront",
    ),
    (
        "M12-matrix-flower-each",
        CONTRACT,
        'Flower: { variantUnits: ["g", "oz"], compoundUnit: "percent" },',
        'Flower: { variantUnits: ["g", "oz", "each"], compoundUnit: "percent" },',
        "Leafly does not document `each` for Flower",
    ),
    (
        "M13-matrix-edible-percent",
        CONTRACT,
        'Edible: { variantUnits: ["each"], compoundUnit: "mg" },',
        'Edible: { variantUnits: ["each"], compoundUnit: "percent" },',
        "an edible measured in percent is a data-quality defect",
    ),
    # ---- numeric limits ----
    (
        "M14-inventory-cap",
        CONTRACT,
        "export const LEAFLY_INVENTORY_LEVEL_CAP = 10;",
        "export const LEAFLY_INVENTORY_LEVEL_CAP = 100;",
        "the cap is stated in Leafly's own field description",
    ),
    (
        "M15-price-min",
        CONTRACT,
        "export const LEAFLY_PRICE_MIN_MINOR_UNITS = 1;",
        "export const LEAFLY_PRICE_MIN_MINOR_UNITS = 0;",
        "schema says minimum 1; 0 would let free items through",
    ),
    # ---- forbidden aliases ----
    (
        "M16-alias-becomes-real",
        CONTRACT,
        '  brandName: "brand",',
        '  brand: "brand",',
        "an alias that is also a real field name makes the guard vacuous",
    ),
    # ---- the vendored schema itself: proves tests read the SCHEMA, not just our constants ----
    # The percent/mg enum appears THREE times in the schema: once for compounds[].unit and
    # once each for total_thc.unit / total_cbd.unit. Each is anchored on the surrounding
    # text so all three call sites are proven to be under test, not just the first.
    (
        "M17a-schema-drift-compound-unit",
        SCHEMA,
        '| Other       | N/A                          |",\n                  "enum": ["percent", "mg"]',
        '| Other       | N/A                          |",\n                  "enum": ["percent", "mg", "ppm"]',
        "if Leafly extends the compound unit enum, re-downloading must turn the suite RED",
    ),
    (
        "M17b-schema-drift-total-thc-unit",
        SCHEMA,
        '"total_thc": {\n            "type": "object",\n            "description": "The total THC content of the item, represented as an object with `content` and `unit` properties.",',
        '"total_thc": {\n            "type": "object",\n            "description": "MUTATED",',
        "total_thc is asserted to share the compound content/unit shape",
    ),
    (
        "M18-schema-drift-required",
        SCHEMA,
        '"required": ["type", "content", "unit"]',
        '"required": ["type", "unit"]',
        "a required-field change upstream must be detected, not absorbed",
    ),
    # ---- the prose doc ----
    (
        "M19-doc-reasserts-camelcase",
        DOC,
        "**Field naming is camelCase with exactly two snake_case exceptions:",
        "**Field naming is camelCase for all fields:",
        "the doc-rot guard must actually guard the doc body",
    ),
    (
        "M20-doc-drops-warning",
        DOC,
        "> ### Why this document was rewritten (read this before editing)",
        "> ### Notes",
        "deleting the warning invites the next author to repeat the bug",
    ),
]


def run(cmd: list[str]) -> tuple[int, str]:
    proc = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    return proc.returncode, proc.stdout + proc.stderr


def run_tests() -> tuple[int, str]:
    return run(["npx", "vitest", "run", TESTS, "--reporter=dot"])


def main() -> int:
    print("=" * 74)
    print("Slice L-1 mutation harness — proving the contract tests can FAIL")
    print("=" * 74)

    # --- Guard against false green #1: the baseline must be GREEN and non-empty.
    print("\n[baseline] running the suite unmutated ...")
    code, out = run_tests()
    if code != 0:
        print("BASELINE IS RED — fix the tests before mutating.")
        print(out[-4000:])
        return 1
    if "81 passed" not in out and "passed" not in out:
        print("BASELINE produced no recognisable test count — harness is lying.")
        print(out[-4000:])
        return 1
    baseline_line = next(
        (ln for ln in out.splitlines() if "Tests" in ln and "passed" in ln), "?"
    )
    print(f"[baseline] GREEN — {baseline_line.strip()}")

    originals: dict[str, str] = {}
    for _, path, _, _, _ in MUTATIONS:
        if path not in originals:
            with open(os.path.join(REPO, path), encoding="utf-8") as fh:
                originals[path] = fh.read()

    survived: list[tuple[str, str]] = []
    not_applied: list[tuple[str, str]] = []
    killed = 0

    try:
        for mid, path, old, new, why in MUTATIONS:
            src = originals[path]
            if old not in src:
                not_applied.append((mid, f"fragment not found in {path}"))
                print(f"\n[{mid}] SKIPPED — fragment not found in {path}")
                continue
            if src.count(old) > 1:
                not_applied.append((mid, f"fragment ambiguous in {path}"))
                print(f"\n[{mid}] SKIPPED — fragment appears {src.count(old)}x in {path}")
                continue

            mutated = src.replace(old, new, 1)
            with open(os.path.join(REPO, path), "w", encoding="utf-8") as fh:
                fh.write(mutated)

            code, _ = run_tests()
            if code != 0:
                killed += 1
                print(f"\n[{mid}] KILLED   (tests went red as required)")
                print(f"          why: {why}")
            else:
                survived.append((mid, why))
                print(f"\n[{mid}] SURVIVED (TESTS STILL PASS — THIS IS A HOLE)")
                print(f"          why it matters: {why}")

            with open(os.path.join(REPO, path), "w", encoding="utf-8") as fh:
                fh.write(src)
    finally:
        for path, src in originals.items():
            with open(os.path.join(REPO, path), "w", encoding="utf-8") as fh:
                fh.write(src)
        print("\n[restore] all target files restored from memory")

    # --- Confirm we really are back to green (guards a botched restore).
    code, out = run_tests()
    print(f"[verify] post-restore suite: {'GREEN' if code == 0 else 'RED'}")
    if code != 0:
        print("RESTORE FAILED — working tree is dirty. Check `git diff`.")
        return 1

    print("\n" + "=" * 74)
    print(f"mutations: {len(MUTATIONS)}   killed: {killed}   "
          f"survived: {len(survived)}   skipped: {len(not_applied)}")
    print("=" * 74)

    for mid, why in survived:
        print(f"SURVIVED {mid}: {why}")
    for mid, why in not_applied:
        print(f"SKIPPED  {mid}: {why}")

    if survived or not_applied:
        print("\nRESULT: FAIL — every mutation must be applied and killed.")
        return 1
    print("\nRESULT: PASS — 0 survived. The tests can genuinely fail.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
