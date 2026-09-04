#!/usr/bin/env python3
"""SLICE 17 step 12 — update the two exact-shape tests that correctly caught the
new fields, and the migration-tip test that pins the highest migration number.

BOTH failures were the tests doing their job:

  * pos-sale-flow-core.test.ts asserts limitLinesFor's EXACT output shape with
    toEqual rather than objectContaining, precisely so that a new field cannot
    appear unnoticed. It appeared; the test noticed. Correct behaviour.
  * migration-execution-gate.test.ts pins the highest migration number so a
    parallel branch cannot silently claim the same one.

HOUSE RULE: never loosen an assertion to go green. Neither is relaxed to
objectContaining. The shapes are extended and made STRONGER by additionally
pinning that a flower line is never classified as otherwise-taken.

The migration test carries a "RE-VERIFIED, not inherited" ritual in its comment.
That ritual was actually re-run for this change rather than copied:
    ls [0-9]*.sql | wc -l                        -> 217
    ls [0-9]*.sql | grep -cvE '^[0-9]{4}_'       -> 0
    ls [0-9]*.sql | sort -c                      -> exits clean
    ls [0-9]*.sql | cut -c1-4 | sort | uniq -d   -> 0 lines
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if not (ROOT / "package.json").is_file():
    raise SystemExit(f"repo root wrong: {ROOT}")

FLOW = "tests/compliance/pos-sale-flow-core.test.ts"
MIG = "tests/compliance/migration-execution-gate.test.ts"

EDITS: list[tuple[str, str, str]] = [
    (
        FLOW,
        """    // SLICE 16: limitLinesFor now also emits the low-THC beverage
    // classification on every line. Asserted EXPLICITLY rather than relaxed to
    // objectContaining, so this test still pins the exact shape \u2014 and now also
    // pins that a flower line is never classified as a low-THC beverage.
    expect(limitLinesFor(priced.lines)).toEqual([
      { category: "flower", quantity: 2, lowThcLiquid: null, unitThcMg: null },
    ]);""",
        """    // SLICE 16: limitLinesFor now also emits the low-THC beverage
    // classification on every line. SLICE 17 adds the otherwise-taken pair.
    // Asserted EXPLICITLY rather than relaxed to objectContaining, so this test
    // still pins the exact shape \u2014 and now also pins that a flower line is
    // never classified as a low-THC beverage NOR as otherwise taken into the
    // body. Flower is inhaled; it can be neither.
    expect(limitLinesFor(priced.lines)).toEqual([
      {
        category: "flower",
        quantity: 2,
        lowThcLiquid: null,
        unitThcMg: null,
        otherwiseTaken: null,
        unitsPerPackage: null,
      },
    ]);""",
    ),
    (
        FLOW,
        """    expect(limitLinesFor(priced.lines)).toEqual([
      { category: "flower", quantity: 2, grams: 14, lowThcLiquid: null, unitThcMg: null },
    ]);""",
        """    expect(limitLinesFor(priced.lines)).toEqual([
      {
        category: "flower",
        quantity: 2,
        grams: 14,
        lowThcLiquid: null,
        unitThcMg: null,
        otherwiseTaken: null,
        unitsPerPackage: null,
      },
    ]);""",
    ),
    (
        MIG,
        """    expect(listed[listed.length - 1]).toMatch(/^0216_/);""",
        """    //
    // SLICE 17 re-ran the ENTIRE ritual above from scratch rather than
    // inheriting the previous line's numbers, exactly as that paragraph
    // demands. Fresh results: `ls [0-9]*.sql | wc -l` returns 217 (was 216,
    // +1 for 0217_otherwise_taken_limit.sql); the malformed-name count is 0;
    // `sort -c` exits clean; and the duplicate-number check returns 0.
    //
    // 0217 adds the ten-unit "otherwise taken into the body" limit
    // (WAC 314-55-095(1)(d)(i)(D)) and ALSO repairs a defect from 0216: that
    // migration added low_thc_liquid/unit_thc_mg to menu_items and
    // inventory_lots but never to order_lines, even though orders-store.ts
    // writes them there and order-pricing.ts reads them back at the pickup
    // gate. The missing-column ladder swallowed the error, so the snapshot was
    // silently dropped on every order.
    expect(listed[listed.length - 1]).toMatch(/^0217_/);""",
    ),
]

buffered: dict[Path, str] = {}
for rel, find, replace in EDITS:
    path = ROOT / rel
    if path not in buffered:
        buffered[path] = path.read_text(encoding="utf-8")
    text = buffered[path]
    n = text.count(find)
    if n != 1:
        raise SystemExit(f"ANCHOR FAIL ({n}x) in {rel}: {find[:80]!r}")
    buffered[path] = text.replace(find, replace)

for path, out in buffered.items():
    path.write_text(out, encoding="utf-8")
    print(f"PATCHED {path.relative_to(ROOT)}")
print(f"OK: {len(EDITS)} anchors applied across {len(buffered)} files")
