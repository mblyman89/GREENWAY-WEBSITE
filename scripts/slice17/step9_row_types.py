#!/usr/bin/env python3
"""SLICE 17 step 9 — close the five gaps tsc found after the plumbing splice.

These were NOT guessed: `tsc --noEmit` named each one precisely. That is the
closed-Record/closed-object type system doing exactly the job it was designed
for, and it is why the engine used a closed `Record<LimitBucket, ...>` in the
first place.

  1-2. db-types.ts MenuItemRow needs the two new DB columns. MenuItemWithVariants
       (live-menu.ts and menu-version.ts) is `MenuItemRow & {...}`, so fixing
       the base type fixes both call sites at once.
  3.   The fact-review test fixture must supply the two new facts.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if not (ROOT / "package.json").is_file():
    raise SystemExit(f"repo root wrong: {ROOT}")

EDITS: list[tuple[str, str, str]] = [
    (
        "src/lib/pos/db-types.ts",
        """  low_thc_liquid: boolean | null;
  /** SLICE 16 \u2014 mg of active delta-9 THC in ONE sellable unit (one can). */
  unit_thc_mg: number | null;""",
        """  low_thc_liquid: boolean | null;
  /** SLICE 16 \u2014 mg of active delta-9 THC in ONE sellable unit (one can). */
  unit_thc_mg: number | null;
  /**
   * SLICE 17 \u2014 "product otherwise taken into the body", WAC 314-55-010(40):
   * "intended for uses other than inhalation, oral ingestion, or external
   * application to the skin". In practice a suppository.
   *
   * true  = counts against the TEN UNIT limit, WAC 314-55-095(1)(d)(i)(D).
   * false = reviewed and does NOT qualify.
   * null  = not yet reviewed.
   *
   * READ THE FAIL-SAFE CAREFULLY \u2014 IT IS THE REVERSE OF low_thc_liquid ABOVE.
   * An unflagged suppository is categorised `topical`, which buckets as a
   * 2016 g liquid, i.e. effectively unlimited. So null here is PERMISSIVE, not
   * conservative. It cannot be derived from category, because one `topical`
   * shelf holds both skin balms (72 oz) and suppositories (10 units).
   */
  otherwise_taken: boolean | null;
  /**
   * SLICE 17 \u2014 individual consumable items in one package, per RCW 69.50.101
   * ("an individual consumable item within a package of one or more
   * consumable items"). A box of six suppositories is 6.
   *
   * DISTINCT from servings_per_pack: servings divide ONE container by dose,
   * units are physically separate items.
   */
  units_per_package: number | null;""",
    ),
    (
        "tests/compliance/slice6a-fact-review-visibility.test.ts",
        """      lowThcLiquid: null,
      unitThcMg: null,""",
        """      lowThcLiquid: null,
      unitThcMg: null,
      otherwiseTaken: null,
      unitsPerPackage: null,""",
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
