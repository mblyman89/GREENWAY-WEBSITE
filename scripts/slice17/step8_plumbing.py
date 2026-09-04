#!/usr/bin/env python3
"""SLICE 17 step 8 — carry `otherwiseTaken` / `unitsPerPackage` end to end.

Owner's instruction: "The limits should be blocked for the customer facing
website and register."

Both surfaces already run the same engine (`evaluateCart`), so "blocking" is
achieved by making sure the two new per-line facts actually REACH the engine on
every path. The fan-out mirrors SLICE 16's lowThcLiquid hop for hop, verified by
grepping every `lowThcLiquid` reference in src/ and covering each one:

  intake  : fact-review-core.ts (facts type, row->facts, apply, csv, blanks)
            fact-review-store.ts (FACT_COLUMN map)
            fact-review-bulk-core.ts, import-commit-core.ts (blank rows)
  menu    : leafly/types.ts, live-menu.ts
  register: sale-flow-core.ts (product type, priced line type, price fan-out,
            limitLinesFor)
  website : cart-limit-meter-core.ts, CartProvider.tsx,
            ProductDetailPurchasePanel.tsx
  api     : api/pos/menu/route.ts, api/orders/route.ts
  server  : order-pricing.ts (input type, priced fan-out, limitLines, gate)
  snapshot: orders-store.ts, orders/types.ts

NOTE ON THE SNAPSHOT GUARD: SLICE 16 wrote its snapshot only when the product
genuinely qualified. The same conditional shape is used here, but keyed on
`otherwiseTaken === true` plus a positive unitsPerPackage, so an unclassified
line writes nothing and reads back as null.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if not (ROOT / "package.json").is_file():
    raise SystemExit(f"repo root wrong: {ROOT}")

EDITS: list[tuple[str, str, str]] = [
    # ================= leafly/types.ts =====================================
    (
        "src/lib/leafly/types.ts",
        """  lowThcLiquid?: boolean | null;
  /** SLICE 16 \u2014 mg of active delta-9 THC in ONE sellable unit (one can). */
  unitThcMg?: number | null;""",
        """  lowThcLiquid?: boolean | null;
  /** SLICE 16 \u2014 mg of active delta-9 THC in ONE sellable unit (one can). */
  unitThcMg?: number | null;
  /**
   * SLICE 17 \u2014 "otherwise taken into the body" (WAC 314-55-010(40)): consumed
   * by a route other than inhalation, oral ingestion, or application to the
   * skin. In practice a suppository. true routes the line to the TEN UNIT
   * bucket of WAC 314-55-095(1)(d)(i)(D).
   *
   * CAUTION \u2014 unlike lowThcLiquid, absent/null here is the PERMISSIVE
   * direction: an unflagged suppository is a `topical`, which buckets as a
   * 2016 g liquid and is effectively unlimited. That is why intake review and
   * suspectsOtherwiseTaken() exist.
   */
  otherwiseTaken?: boolean | null;
  /** SLICE 17 \u2014 individual consumable items per package (RCW 69.50.101). */
  unitsPerPackage?: number | null;""",
    ),
    # ================= live-menu.ts ========================================
    (
        "src/lib/pos/live-menu.ts",
        """    lowThcLiquid: row.low_thc_liquid ?? null,
    unitThcMg: row.unit_thc_mg ?? null,""",
        """    lowThcLiquid: row.low_thc_liquid ?? null,
    unitThcMg: row.unit_thc_mg ?? null,
    // SLICE 17 \u2014 the otherwise-taken classification rides to the website and
    // the register on the same select("*"), so no query change is needed.
    // `?? null` keeps a pre-0217 database reading as "not classified".
    otherwiseTaken: row.otherwise_taken ?? null,
    unitsPerPackage: row.units_per_package ?? null,""",
    ),
    # ================= cart-limit-meter-core.ts ============================
    (
        "src/lib/menu/cart-limit-meter-core.ts",
        """  lowThcLiquid?: boolean | null;
  /** SLICE 16 \u2014 mg of active delta-9 THC in ONE sellable unit (one can). */
  unitThcMg?: number | null;
};""",
        """  lowThcLiquid?: boolean | null;
  /** SLICE 16 \u2014 mg of active delta-9 THC in ONE sellable unit (one can). */
  unitThcMg?: number | null;
  /**
   * SLICE 17 \u2014 "otherwise taken into the body" (suppositories), routing this
   * line to the ten-unit bucket. Absent/null = not classified.
   *
   * Note the fail-safe INVERTS here versus lowThcLiquid above: an unclassified
   * suppository counts as a normal liquid and is effectively unlimited, so a
   * missing flag under-restricts rather than over-restricts.
   */
  otherwiseTaken?: boolean | null;
  /** SLICE 17 \u2014 individual items per package; a box of six is 6. */
  unitsPerPackage?: number | null;
};""",
    ),
    (
        "src/lib/menu/cart-limit-meter-core.ts",
        """      lowThcLiquid: item.lowThcLiquid ?? null,
      unitThcMg: item.unitThcMg ?? null,
    };""",
        """      lowThcLiquid: item.lowThcLiquid ?? null,
      unitThcMg: item.unitThcMg ?? null,
      // SLICE 17 \u2014 mirrors the register's limitLinesFor() exactly, so the
      // website meter and the register can never disagree about the same cart.
      // This is what makes the ten-unit limit BLOCK ON THE WEBSITE, per the
      // owner's instruction, rather than only at the register.
      otherwiseTaken: item.otherwiseTaken ?? null,
      unitsPerPackage: item.unitsPerPackage ?? null,
    };""",
    ),
    # ================= sale-flow-core.ts ===================================
    (
        "src/lib/pos/sale-flow-core.ts",
        """  unitThcMg?: number | null;
  /**
   * B32 \u2014 variant-level units remaining from the published menu, when known.""",
        """  unitThcMg?: number | null;
  /**
   * SLICE 17 \u2014 "otherwise taken into the body" (WAC 314-55-010(40)), i.e. a
   * suppository. Routes this line to the TEN UNIT bucket.
   *
   * Optional so bundles cached before SLICE 17 still parse. But note the
   * fail-safe INVERTS versus lowThcLiquid: an old bundle missing this flag
   * counts a suppository as a normal liquid, which is PERMISSIVE, not
   * restrictive. Re-sync the device bundle after intake classification.
   */
  otherwiseTaken?: boolean | null;
  /**
   * SLICE 17 \u2014 individual consumable items in one package (RCW 69.50.101).
   * A box of six suppositories is 6 and rings as six units.
   */
  unitsPerPackage?: number | null;
  /**
   * B32 \u2014 variant-level units remaining from the published menu, when known.""",
    ),
    (
        "src/lib/pos/sale-flow-core.ts",
        """  lowThcLiquid?: boolean | null;
  /** SLICE 16 \u2014 mg of active delta-9 THC in one sellable unit. */
  unitThcMg?: number | null;
};""",
        """  lowThcLiquid?: boolean | null;
  /** SLICE 16 \u2014 mg of active delta-9 THC in one sellable unit. */
  unitThcMg?: number | null;
  /** SLICE 17 \u2014 the otherwise-taken classification, carried from the menu
   *  card so limitLinesFor() can route this line to the ten-unit bucket. */
  otherwiseTaken?: boolean | null;
  /** SLICE 17 \u2014 individual items per package (a box of six is 6). */
  unitsPerPackage?: number | null;
};""",
    ),
    (
        "src/lib/pos/sale-flow-core.ts",
        """      lowThcLiquid: entry.product.lowThcLiquid ?? null,
      unitThcMg: entry.product.unitThcMg ?? null,
    });""",
        """      lowThcLiquid: entry.product.lowThcLiquid ?? null,
      unitThcMg: entry.product.unitThcMg ?? null,
      // SLICE 17: the otherwise-taken classification travels with the line.
      otherwiseTaken: entry.product.otherwiseTaken ?? null,
      unitsPerPackage: entry.product.unitsPerPackage ?? null,
    });""",
    ),
    (
        "src/lib/pos/sale-flow-core.ts",
        """      lowThcLiquid: l.lowThcLiquid ?? null,
      unitThcMg: l.unitThcMg ?? null,
    };
  });
}""",
        """      lowThcLiquid: l.lowThcLiquid ?? null,
      unitThcMg: l.unitThcMg ?? null,
      // SLICE 17 \u2014 the otherwise-taken classification. qualifiesAsOtherwise
      // Taken() demands `otherwiseTaken === true` AND a topical/liquid-bucket
      // category, so passing these through unconditionally is safe. As with
      // the low-THC carve-out the grams STILL ride along; a qualifying line
      // simply never consumes them, because the item count is the limit.
      otherwiseTaken: l.otherwiseTaken ?? null,
      unitsPerPackage: l.unitsPerPackage ?? null,
    };
  });
}""",
    ),
    # ================= orders/types.ts =====================================
    (
        "src/lib/orders/types.ts",
        """  /** SLICE 16 \u2014 low-THC beverage classification snapshot (migration 0216). */
  lowThcLiquid?: boolean | null;
  /** SLICE 16 \u2014 mg active delta-9 THC per sellable unit, snapshot. */
  unitThcMg?: number | null;
};""",
        """  /** SLICE 16 \u2014 low-THC beverage classification snapshot (migration 0216;
   *  the order_lines COLUMN was actually added by 0217 \u2014 see that file). */
  lowThcLiquid?: boolean | null;
  /** SLICE 16 \u2014 mg active delta-9 THC per sellable unit, snapshot. */
  unitThcMg?: number | null;
  /** SLICE 17 \u2014 otherwise-taken classification snapshot (migration 0217). */
  otherwiseTaken?: boolean | null;
  /** SLICE 17 \u2014 individual items per package at sale time, snapshot. */
  unitsPerPackage?: number | null;
};""",
    ),
    (
        "src/lib/orders/types.ts",
        """  low_thc_liquid?: boolean | null;""",
        """  low_thc_liquid?: boolean | null;
  /** SLICE 17 \u2014 order_lines snapshot columns (migration 0217). */
  otherwise_taken?: boolean | null;
  units_per_package?: number | string | null;""",
    ),
    # ================= order-pricing.ts ====================================
    (
        "src/lib/orders/order-pricing.ts",
        """  lowThcLiquid?: boolean | null;
  /** SLICE 16 \u2014 mg active delta-9 THC per sellable unit. */
  unitThcMg?: number | null;""",
        """  lowThcLiquid?: boolean | null;
  /** SLICE 16 \u2014 mg active delta-9 THC per sellable unit. */
  unitThcMg?: number | null;
  /**
   * SLICE 17 \u2014 the otherwise-taken classification resolved from the live menu
   * at placement, so it can be both evaluated now and snapshotted onto the
   * stored line for the pickup gate.
   */
  otherwiseTaken?: boolean | null;
  /** SLICE 17 \u2014 individual consumable items per package. */
  unitsPerPackage?: number | null;""",
    ),
    (
        "src/lib/orders/order-pricing.ts",
        """      lowThcLiquid: w.resolved.item.lowThcLiquid ?? null,
      unitThcMg: w.resolved.item.unitThcMg ?? null,
    });""",
        """      lowThcLiquid: w.resolved.item.lowThcLiquid ?? null,
      unitThcMg: w.resolved.item.unitThcMg ?? null,
      // SLICE 17: the otherwise-taken classification from the resolved menu
      // item. Unclassified products resolve to null and are counted as normal
      // liquids \u2014 which for a suppository is the PERMISSIVE direction, hence
      // the intake review queue backing this up.
      otherwiseTaken: w.resolved.item.otherwiseTaken ?? null,
      unitsPerPackage: w.resolved.item.unitsPerPackage ?? null,
    });""",
    ),
    (
        "src/lib/orders/order-pricing.ts",
        """      lowThcLiquid: l.lowThcLiquid ?? null,
      unitThcMg: l.unitThcMg ?? null,
    };
  });""",
        """      lowThcLiquid: l.lowThcLiquid ?? null,
      unitThcMg: l.unitThcMg ?? null,
      // SLICE 17 \u2014 same routing the register and the website cart use, so all
      // three agree on an identical basket.
      otherwiseTaken: l.otherwiseTaken ?? null,
      unitsPerPackage: l.unitsPerPackage ?? null,
    };
  });""",
    ),
    (
        "src/lib/orders/order-pricing.ts",
        """      lowThcLiquid: lowThc,
      unitThcMg,
    });""",
        """      lowThcLiquid: lowThc,
      unitThcMg,
      // SLICE 17 \u2014 read back the placement-time classification snapshot
      // (migration 0217). `=== true` on purpose: PostgREST can hand back a
      // string, and only a real boolean true may move this line into the
      // ten-unit bucket. Legacy rows are null \u2192 normal liquid.
      otherwiseTaken: line.otherwise_taken === true,
      unitsPerPackage: normalizeUnitGrams(line.units_per_package),
    });""",
    ),
    # ================= orders-store.ts (SNAPSHOT) ==========================
    (
        "src/lib/orders/orders-store.ts",
        """      ...(withLowThc && l.lowThcLiquid === true && typeof l.unitThcMg === "number" && l.unitThcMg > 0
        ? { low_thc_liquid: true, unit_thc_mg: l.unitThcMg }
        : {}),""",
        """      ...(withLowThc && l.lowThcLiquid === true && typeof l.unitThcMg === "number" && l.unitThcMg > 0
        ? { low_thc_liquid: true, unit_thc_mg: l.unitThcMg }
        : {}),
      // SLICE 17 \u2014 sale-time otherwise-taken snapshot (migration 0217).
      // Same conditional shape as the low-THC snapshot above: only written
      // when the product is actually classified, so an omitted column reads
      // back as null and the completion gate treats it as a normal product.
      //
      // This snapshot matters MORE than the low-THC one, not less. Because the
      // fail-safe is inverted, a dropped snapshot means the pickup gate
      // re-evaluates a suppository as a 72 oz liquid and fails to block, so
      // the gate would disagree with the sale that was actually made.
      ...(withOtherwiseTaken &&
      l.otherwiseTaken === true &&
      typeof l.unitsPerPackage === "number" &&
      l.unitsPerPackage > 0
        ? { otherwise_taken: true, units_per_package: l.unitsPerPackage }
        : {}),""",
    ),
    (
        "src/lib/orders/orders-store.ts",
        """  const buildLineRows = (withCategory: boolean, withUnitGrams: boolean, withLowThc: boolean) =>""",
        """  const buildLineRows = (
    withCategory: boolean,
    withUnitGrams: boolean,
    withLowThc: boolean,
    withOtherwiseTaken: boolean,
  ) =>""",
    ),
    (
        "src/lib/orders/orders-store.ts",
        """  let { error: linesError } = await admin
    .from("order_lines")
    .insert(buildLineRows(true, true, true));
  if (linesError && isMissingColumnError(linesError)) {
    ({ error: linesError } = await admin
      .from("order_lines")
      .insert(buildLineRows(true, true, false)));
  }
  if (linesError && isMissingColumnError(linesError)) {
    ({ error: linesError } = await admin
      .from("order_lines")
      .insert(buildLineRows(true, false, false)));
  }
  if (linesError && isMissingColumnError(linesError)) {
    ({ error: linesError } = await admin
      .from("order_lines")
      .insert(buildLineRows(false, false, false)));
  }""",
        """  let { error: linesError } = await admin
    .from("order_lines")
    .insert(buildLineRows(true, true, true, true));
  if (linesError && isMissingColumnError(linesError)) {
    // SLICE 17 rung: drop the otherwise_taken snapshot (0217 unapplied).
    ({ error: linesError } = await admin
      .from("order_lines")
      .insert(buildLineRows(true, true, true, false)));
  }
  if (linesError && isMissingColumnError(linesError)) {
    ({ error: linesError } = await admin
      .from("order_lines")
      .insert(buildLineRows(true, true, false, false)));
  }
  if (linesError && isMissingColumnError(linesError)) {
    ({ error: linesError } = await admin
      .from("order_lines")
      .insert(buildLineRows(true, false, false, false)));
  }
  if (linesError && isMissingColumnError(linesError)) {
    ({ error: linesError } = await admin
      .from("order_lines")
      .insert(buildLineRows(false, false, false, false)));
  }""",
    ),
    # ================= api routes ==========================================
    (
        "src/app/api/pos/menu/route.ts",
        """        lowThcLiquid: item.lowThcLiquid ?? null,
        unitThcMg: item.unitThcMg ?? null,""",
        """        lowThcLiquid: item.lowThcLiquid ?? null,
        unitThcMg: item.unitThcMg ?? null,
        // SLICE 17 \u2014 the register bundle carries the otherwise-taken facts so
        // the device can enforce the ten-unit limit offline.
        otherwiseTaken: item.otherwiseTaken ?? null,
        unitsPerPackage: item.unitsPerPackage ?? null,""",
    ),
    (
        "src/app/api/orders/route.ts",
        """      lowThcLiquid: l.lowThcLiquid ?? null,
      unitThcMg: l.unitThcMg ?? null,""",
        """      lowThcLiquid: l.lowThcLiquid ?? null,
      unitThcMg: l.unitThcMg ?? null,
      // SLICE 17 \u2014 carried onto the stored line so the pickup completion gate
      // re-reads the sale-time classification instead of re-deriving it.
      otherwiseTaken: l.otherwiseTaken ?? null,
      unitsPerPackage: l.unitsPerPackage ?? null,""",
    ),
    # ================= website cart ========================================
    (
        "src/components/cart/CartProvider.tsx",
        """  lowThcLiquid?: boolean | null;""",
        """  lowThcLiquid?: boolean | null;
  /** SLICE 17 \u2014 otherwise-taken (suppository) classification for the meter. */
  otherwiseTaken?: boolean | null;
  /** SLICE 17 \u2014 individual items per package; a box of six is 6. */
  unitsPerPackage?: number | null;""",
    ),
    (
        "src/components/menu/ProductDetailPurchasePanel.tsx",
        """            lowThcLiquid: item.lowThcLiquid ?? null,
            unitThcMg: item.unitThcMg ?? null,""",
        """            lowThcLiquid: item.lowThcLiquid ?? null,
            unitThcMg: item.unitThcMg ?? null,
            // SLICE 17 \u2014 so the website cart meter counts suppository UNITS.
            otherwiseTaken: item.otherwiseTaken ?? null,
            unitsPerPackage: item.unitsPerPackage ?? null,""",
    ),
    # ================= intake / fact review ================================
    (
        "src/lib/pos/fact-review-store.ts",
        """  lowThcLiquid: "low_thc_liquid",
  unitThcMg: "unit_thc_mg",""",
        """  lowThcLiquid: "low_thc_liquid",
  unitThcMg: "unit_thc_mg",
  otherwiseTaken: "otherwise_taken",
  unitsPerPackage: "units_per_package",""",
    ),
    (
        "src/lib/pos/fact-review-core.ts",
        """  lowThcLiquid: boolean | null;
  /**""",
        """  lowThcLiquid: boolean | null;
  /**
   * SLICE 17 \u2014 "otherwise taken into the body" (WAC 314-55-010(40)): a route
   * of administration that is neither inhaled, swallowed, nor applied to the
   * skin. In practice a suppository. true routes the line to the ten-unit
   * limit of WAC 314-55-095(1)(d)(i)(D).
   *
   * null means NOT YET REVIEWED, and is deliberately distinct from false.
   * Because an unflagged suppository buckets as a 2016 g liquid (effectively
   * unlimited), null is the PERMISSIVE state \u2014 the opposite of lowThcLiquid.
   * That is precisely why this is an explicit review field.
   */
  otherwiseTaken: boolean | null;
  /**
   * SLICE 17 \u2014 individual consumable items in one package (RCW 69.50.101):
   * "an individual consumable item within a package of one or more consumable
   * items". A box of six suppositories is 6, and rings as six units. NOT the
   * same as servings_per_pack, which divides ONE container by dose.
   */
  unitsPerPackage: number | null;
  /**""",
    ),
    (
        "src/lib/pos/fact-review-core.ts",
        """  lowThcLiquid: boolean | null;
  unitThcMg: number | null;""",
        """  lowThcLiquid: boolean | null;
  unitThcMg: number | null;
  otherwiseTaken: boolean | null;
  unitsPerPackage: number | null;""",
    ),
    (
        "src/lib/pos/fact-review-core.ts",
        """    lowThcLiquid: row.low_thc_liquid,
    unitThcMg: num(row.unit_thc_mg),""",
        """    lowThcLiquid: row.low_thc_liquid,
    unitThcMg: num(row.unit_thc_mg),
    otherwiseTaken: row.otherwise_taken,
    unitsPerPackage: num(row.units_per_package),""",
    ),
    (
        "src/lib/pos/fact-review-core.ts",
        """    lowThcLiquid: item.lowThcLiquid,
    unitThcMg: item.unitThcMg,""",
        """    lowThcLiquid: item.lowThcLiquid,
    unitThcMg: item.unitThcMg,
    otherwiseTaken: item.otherwiseTaken,
    unitsPerPackage: item.unitsPerPackage,""",
    ),
    (
        "src/lib/pos/fact-review-core.ts",
        """        cell(row.facts.lowThcLiquid === null ? "unclassified" : row.facts.lowThcLiquid ? "yes" : "no"),
        cell(row.facts.unitThcMg),""",
        """        cell(row.facts.lowThcLiquid === null ? "unclassified" : row.facts.lowThcLiquid ? "yes" : "no"),
        cell(row.facts.unitThcMg),
        cell(
          row.facts.otherwiseTaken === null
            ? "unclassified"
            : row.facts.otherwiseTaken
              ? "yes"
              : "no",
        ),
        cell(row.facts.unitsPerPackage),""",
    ),
]

# The "blank facts" literals appear at THREE sites across three files, and they
# do NOT share one indentation: fact-review-core's EMPTY_FACTS constant sits at
# 2 spaces while the two test-fixture builders sit at 4. Verified with `cat -A`
# rather than assumed - the 4-space anchor matched 0x on import-commit-core.
# Each site is therefore anchored with its own exact leading whitespace, and the
# surrounding line pins it to one occurrence per file.
BLANKS: list[tuple[str, str, str]] = [
    # fact-review-core.ts: EMPTY_FACTS (2-space), pinned by the closing `};`.
    (
        "src/lib/pos/fact-review-core.ts",
        """  lowThcLiquid: null,
  unitThcMg: null,
};""",
        """  lowThcLiquid: null,
  unitThcMg: null,
  otherwiseTaken: null,
  unitsPerPackage: null,
};""",
    ),
    # fact-review-core.ts: fixture builder (4-space), pinned by factProvenance.
    (
        "src/lib/pos/fact-review-core.ts",
        """    lowThcLiquid: null,
    unitThcMg: null,
    factProvenance: {},""",
        """    lowThcLiquid: null,
    unitThcMg: null,
    otherwiseTaken: null,
    unitsPerPackage: null,
    factProvenance: {},""",
    ),
    # import-commit-core.ts: fixture builder (4-space).
    (
        "src/lib/pos/import-commit-core.ts",
        """    lowThcLiquid: null,
    unitThcMg: null,
    factProvenance: {},""",
        """    lowThcLiquid: null,
    unitThcMg: null,
    otherwiseTaken: null,
    unitsPerPackage: null,
    factProvenance: {},""",
    ),
    # fact-review-bulk-core.ts: nested `facts` object at SIX spaces. The bulk
    # tool defaults to null (UNCLASSIFIED) rather than false on purpose - it
    # must never invent a classification the reviewer did not make. That
    # reasoning applies with even more force here, since for otherwiseTaken a
    # wrong `false` would silently disable the ten-unit limit.
    (
        "src/lib/pos/fact-review-bulk-core.ts",
        """      lowThcLiquid: null,
      unitThcMg: null,
    },""",
        """      lowThcLiquid: null,
      unitThcMg: null,
      // SLICE 17. Same discipline: null = UNCLASSIFIED, never a guessed false.
      otherwiseTaken: null,
      unitsPerPackage: null,
    },""",
    ),
]
EDITS.extend(BLANKS)

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
