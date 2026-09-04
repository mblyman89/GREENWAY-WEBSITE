#!/usr/bin/env python3
"""SLICE 17 step 4 — every LimitProfile construction site gains otherwise_taken.

TypeScript found these for us: LimitProfile is a closed Record, so omitting the
new field is a compile error rather than a silent `undefined` max. That is
exactly why the profile is typed that way.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if not (ROOT / "package.json").is_file():
    raise SystemExit(f"repo root wrong: {ROOT}")

EDITS: list[tuple[str, str, str]] = [
    # ---- the bucket->categories map in the pure core --------------------
    (
        "src/lib/compliance/sales-limits-core.ts",
        """    // SLICE 16: low-THC beverages are NOT a category of their own — they are
    // `edible-liquid` products carrying a per-product flag. This list stays
    // empty by design; the staff reference explains the flag instead.
    low_thc_liquid: [],
  };""",
        """    // SLICE 16: low-THC beverages are NOT a category of their own — they are
    // `edible-liquid` products carrying a per-product flag. This list stays
    // empty by design; the staff reference explains the flag instead.
    low_thc_liquid: [],
    // SLICE 17: same shape. A suppository arrives as `topical` and is moved
    // into this bucket by an explicit per-product flag, not by its slug — a
    // "topical" shelf legitimately holds both balms (skin → 72 oz) and
    // suppositories (otherwise taken → 10 units), and no single slug can
    // express that split.
    otherwise_taken: [],
  };""",
    ),
    # ---- server settings defaults ----------------------------------------
    (
        "src/lib/compliance/sales-limits.ts",
        """  // SLICE 16: low_thc_liquid is 200 mg THC for BOTH profiles — the medical
  // figure is NOT tripled (WAC 314-55-095(2)(d) says "up to 200 mg").
  rec: { usable: 28, solid_edible: 448, concentrate: 7, liquid_edible: 2016, low_thc_liquid: 200 },
  med: { usable: 84, solid_edible: 1344, concentrate: 21, liquid_edible: 6048, low_thc_liquid: 200 },""",
        """  // SLICE 16: low_thc_liquid is 200 mg THC for BOTH profiles — the medical
  // figure is NOT tripled (WAC 314-55-095(2)(d) says "up to 200 mg").
  // SLICE 17: otherwise_taken is 10 UNITS for both profiles — WAC
  // 314-55-095(2)(d) does not list the category at all, so no enhancement.
  rec: {
    usable: 28,
    solid_edible: 448,
    concentrate: 7,
    liquid_edible: 2016,
    low_thc_liquid: 200,
    otherwise_taken: 10,
  },
  med: {
    usable: 84,
    solid_edible: 1344,
    concentrate: 21,
    liquid_edible: 6048,
    low_thc_liquid: 200,
    otherwise_taken: 10,
  },""",
    ),
    # ---- register self-test fixture --------------------------------------
    (
        "src/lib/pos/sale-flow-core.ts",
        """    rec: { usable: 28, solid_edible: 453.6, concentrate: 7, liquid_edible: 2016, low_thc_liquid: 200 },
    med: { usable: 84, solid_edible: 1360.8, concentrate: 21, liquid_edible: 6048, low_thc_liquid: 200 },""",
        """    rec: {
      usable: 28,
      solid_edible: 453.6,
      concentrate: 7,
      liquid_edible: 2016,
      low_thc_liquid: 200,
      otherwise_taken: 10,
    },
    med: {
      usable: 84,
      solid_edible: 1360.8,
      concentrate: 21,
      liquid_edible: 6048,
      low_thc_liquid: 200,
      otherwise_taken: 10,
    },""",
    ),
    # ---- register test fixture -------------------------------------------
    (
        "tests/compliance/pos-sale-flow-core.test.ts",
        """  rec: { usable: 28, solid_edible: 453.6, concentrate: 7, liquid_edible: 2016, low_thc_liquid: 200 },
  med: { usable: 84, solid_edible: 1360.8, concentrate: 21, liquid_edible: 6048, low_thc_liquid: 200 },""",
        """  rec: {
    usable: 28,
    solid_edible: 453.6,
    concentrate: 7,
    liquid_edible: 2016,
    low_thc_liquid: 200,
    otherwise_taken: 10,
  },
  med: {
    usable: 84,
    solid_edible: 1360.8,
    concentrate: 21,
    liquid_edible: 6048,
    low_thc_liquid: 200,
    otherwise_taken: 10,
  },""",
    ),
]

buffered: list[tuple[Path, str]] = []
for rel, find, replace in EDITS:
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    n = text.count(find)
    if n != 1:
        raise SystemExit(f"ANCHOR FAIL ({n}x) in {rel}: {find[:70]!r}")
    buffered.append((path, text.replace(find, replace)))

for path, out in buffered:
    path.write_text(out, encoding="utf-8")
    print(f"PATCHED {path.relative_to(ROOT)}")
print(f"OK: {len(EDITS)} anchors applied")
