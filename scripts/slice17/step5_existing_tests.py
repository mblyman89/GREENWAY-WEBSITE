#!/usr/bin/env python3
"""SLICE 17 step 5 — update the three existing tests that correctly noticed a
sixth bucket appeared.

HOUSE RULE: never loosen an assertion to go green. Each of these is made
STRONGER than it was:
  - the parity test now asserts the exact SET of tripling vs non-tripling
    buckets rather than "every other bucket triples";
  - the empty-cart test asserts the exact bucket NAMES, not just a count;
  - the membership test gains the sixth name and a unit-map completeness check.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if not (ROOT / "package.json").is_file():
    raise SystemExit(f"repo root wrong: {ROOT}")

EDITS: list[tuple[str, str, str]] = [
    # ---------------------------------------------------------------- 1 ----
    (
        "tests/compliance/low-thc-liquid-feature-parity.test.ts",
        """  it("the medical default is NOT tripled, unlike every other bucket", () => {
    // Guard rail against a well-meaning "consistency" fix.
    expect(DEFAULT_SALES_LIMIT_SETTINGS.med[BUCKET]).toBe(DEFAULT_SALES_LIMIT_SETTINGS.rec[BUCKET]);
    for (const b of LIMIT_BUCKETS) {
      if (b === BUCKET) continue;
      expect(DEFAULT_SALES_LIMIT_SETTINGS.med[b], b).toBeGreaterThan(DEFAULT_SALES_LIMIT_SETTINGS.rec[b]);
    }
  });""",
        """  it("the medical default is NOT tripled, unlike the GRAM buckets", () => {
    // Guard rail against a well-meaning "consistency" fix.
    expect(DEFAULT_SALES_LIMIT_SETTINGS.med[BUCKET]).toBe(DEFAULT_SALES_LIMIT_SETTINGS.rec[BUCKET]);
    // SLICE 17 STRENGTHENED: rather than "every OTHER bucket triples" (which
    // silently became false when otherwise_taken arrived), pin the exact SET
    // on each side. Adding a seventh bucket now forces a deliberate decision
    // about which side it belongs on instead of quietly breaking a loop.
    const triples = LIMIT_BUCKETS.filter(
      (b) => DEFAULT_SALES_LIMIT_SETTINGS.med[b] > DEFAULT_SALES_LIMIT_SETTINGS.rec[b],
    );
    const flat = LIMIT_BUCKETS.filter(
      (b) => DEFAULT_SALES_LIMIT_SETTINGS.med[b] === DEFAULT_SALES_LIMIT_SETTINGS.rec[b],
    );
    expect([...triples].sort()).toEqual([
      "concentrate",
      "liquid_edible",
      "solid_edible",
      "usable",
    ]);
    // low_thc_liquid: WAC 314-55-095(2)(d) says "up to 200 mg" — same figure.
    // otherwise_taken: WAC 314-55-095(2)(d) does not list the category at all.
    expect([...flat].sort()).toEqual(["low_thc_liquid", "otherwise_taken"]);
    // And every tripling bucket triples EXACTLY, not merely "more".
    for (const b of triples) {
      expect(DEFAULT_SALES_LIMIT_SETTINGS.med[b] / DEFAULT_SALES_LIMIT_SETTINGS.rec[b], b).toBe(3);
    }
  });""",
    ),
    # ---------------------------------------------------------------- 2 ----
    (
        "tests/compliance/low-thc-liquid-limit.test.ts",
        """  it("an empty cart is clean across all five buckets", () => {
    const v = evaluateCart([]);
    expect(v.blocked).toBe(false);
    expect(v.buckets).toHaveLength(5);
    for (const b of v.buckets) expect(b.usedGrams).toBe(0);
  });""",
        """  it("an empty cart is clean across EVERY bucket, named explicitly", () => {
    const v = evaluateCart([]);
    expect(v.blocked).toBe(false);
    // SLICE 17 STRENGTHENED: assert the bucket NAMES, not a bare count. A
    // count silently tolerates a rename or a swap; the names do not.
    expect(v.buckets.map((b) => b.bucket)).toEqual([
      "usable",
      "solid_edible",
      "concentrate",
      "liquid_edible",
      "low_thc_liquid",
      "otherwise_taken",
    ]);
    for (const b of v.buckets) {
      expect(b.usedGrams).toBe(0);
      expect(b.used).toBe(0);
      expect(b.exceeded).toBe(false);
    }
  });""",
    ),
    # ---------------------------------------------------------------- 3a ---
    # The completeness assertion below references LIMIT_BUCKET_UNITS, which this
    # file does not currently import. Verified by reading the import block: it
    # has LIMIT_BUCKET_LABELS but not LIMIT_BUCKET_UNITS. Without this edit the
    # new assertion would throw ReferenceError rather than assert anything.
    (
        "tests/compliance/sales-limits.test.ts",
        """  LIMIT_BUCKETS,
  LIMIT_BUCKET_LABELS,
  DEFAULT_UNIT_GRAMS,""",
        """  LIMIT_BUCKETS,
  LIMIT_BUCKET_LABELS,
  LIMIT_BUCKET_UNITS,
  DEFAULT_UNIT_GRAMS,""",
    ),
    # ---------------------------------------------------------------- 3b ---
    (
        "tests/compliance/sales-limits.test.ts",
        """    // SLICE 16: five buckets now — the fifth is low_thc_liquid. Rather than
    // just bumping 4→5, assert the ACTUAL membership so this test fails if a
    // bucket is ever added, removed, or renamed without a deliberate decision.
    expect([...LIMIT_BUCKETS]).toEqual([
      "usable",
      "solid_edible",
      "concentrate",
      "liquid_edible",
      "low_thc_liquid",
    ]);
    for (const bucket of LIMIT_BUCKETS) {
      expect(LIMIT_BUCKET_LABELS[bucket]).toBeTruthy();
    }""",
        """    // SLICE 16: five buckets. SLICE 17: six — the sixth is otherwise_taken.
    // Rather than just bumping the count, assert the ACTUAL membership so this
    // test fails if a bucket is ever added, removed, or renamed without a
    // deliberate decision.
    expect([...LIMIT_BUCKETS]).toEqual([
      "usable",
      "solid_edible",
      "concentrate",
      "liquid_edible",
      "low_thc_liquid",
      "otherwise_taken",
    ]);
    for (const bucket of LIMIT_BUCKETS) {
      expect(LIMIT_BUCKET_LABELS[bucket]).toBeTruthy();
      // SLICE 17: every bucket must declare its unit. A bucket with no entry
      // here would fall through formatLimitAmount to the ounces branch and
      // render a count or an mg figure as a weight.
      expect(LIMIT_BUCKET_UNITS[bucket], bucket).toBeTruthy();
    }""",
    ),
]

# BUGFIX (caught by the test suite, not by review): the original version of this
# loop read each file FRESH FROM DISK per edit and buffered the result. With two
# edits targeting the same file, both reads saw the ORIGINAL bytes, so the second
# buffered string silently clobbered the first. The import edit vanished and the
# assertion it supported threw ReferenceError.
#
# Accumulate per-file in a dict instead, so edit N+1 sees edit N's output while
# still writing NOTHING until every anchor across every file has matched exactly.
buffered: dict[Path, str] = {}
for rel, find, replace in EDITS:
    path = ROOT / rel
    if path not in buffered:
        buffered[path] = path.read_text(encoding="utf-8")
    text = buffered[path]
    n = text.count(find)
    if n != 1:
        raise SystemExit(f"ANCHOR FAIL ({n}x) in {rel}: {find[:70]!r}")
    buffered[path] = text.replace(find, replace)

for path, out in buffered.items():
    path.write_text(out, encoding="utf-8")
    print(f"PATCHED {path.relative_to(ROOT)}")
print(f"OK: {len(EDITS)} anchors applied across {len(buffered)} files")
