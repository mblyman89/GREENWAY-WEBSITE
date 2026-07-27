/**
 * src/lib/menu/variant-collapse-core.ts — SLICE 70 (restock readiness)
 *
 * PURE, client-safe collapse of visually-identical size variants on the
 * WEBSITE's size selectors. Zero I/O — registered in
 * scripts/compliance/run-pure-selftests.ts and mirrored in vitest.
 *
 * WHY THIS EXISTS (verified gap, never guessed): a restock of the SAME
 * product from the SAME vendor arrives under a NEW lot number and — by
 * design — joins the live card as a NEW variant that keeps ITS OWN lot
 * identity (`source_variant_id = ${lotKey}-onboarded`, load-bearing for FIFO
 * decrement, CCRS stamping, costs, and recalls; see intake-mastering-core).
 * When the restock's package label AND price match an existing size (the
 * common case: another "3.5g @ $40.00" of the very same product), the
 * website's size dropdown rendered the SAME line twice — and a shopper could
 * select the drained older lot's row (add-to-cart dead at 0 units) while the
 * fresh lot sat in stock one row below. intake-menu-staging-core's own
 * pinned test proves the double row exists ("restock: variant appended to
 * live card" with the same "3.5g" label).
 *
 * THE FIX IS DISPLAY-ONLY: group variants by (label, price, medical) — the
 * IDENTICAL identity key the Cultivera transform has always used to merge
 * duplicate variants at import time (transform.ts mergeVariantDuplicates:
 * `[label, priceMinorUnits, medical].join("|")`) — and show ONE row per
 * group. Nothing stored changes: menu_variants keep one row per lot, the
 * register bundle still lists every lot separately (staff sell lot-
 * accurately by barcode), and the admin/back office sees every lot.
 *
 * REPRESENTATIVE SELECTION (FIFO-friendly, never oversells):
 *   • The shown row is the group's FIRST variant WITH stock, in the caller's
 *     order. Callers pass sortVariantsBySize() output, which is stable, so
 *     within a same-label/price group the original append order survives —
 *     and restocks are APPENDED after existing variants, so "first in-stock"
 *     = the OLDEST lot that still has units. Selling the oldest lot first
 *     matches the store's FIFO consumption on the lot layer.
 *   • The representative keeps its OWN id and its OWN inventoryLevel. The
 *     id is a REAL source_variant_id, so the cart → order → decrement path
 *     consumes exactly that lot; the purchase cap honestly reflects the lot
 *     actually being sold (we never let one add-to-cart promise units that
 *     would have to be silently pulled from a different lot). When the
 *     shown lot drains, the next render picks the next in-stock lot.
 *   • All-empty group → the first variant represents it (the card is
 *     "unavailable" then anyway; add-to-cart stays disabled).
 *
 * DIFFERENT price or medical flag NEVER collapses — a "3.5g $38.00" restock
 * beside a "3.5g $40.00" original is two honest offers the shopper should
 * see ("restock: new variant keeps its own price" is a pinned behaviour).
 */

/** The minimal variant shape the collapse needs (GreenwayMenuVariant fits). */
export type CollapsibleVariant = {
  id: string;
  label: string;
  priceMinorUnits: number;
  inventoryLevel: number;
  medical: boolean;
};

/** The transform.ts mergeVariantDuplicates identity, byte-for-byte. */
function displayKey(v: CollapsibleVariant): string {
  return [v.label, v.priceMinorUnits, v.medical ? "medical" : "adult"].join("|");
}

/**
 * Collapse duplicate (label, price, medical) rows to ONE row each for
 * customer display. Preserves the caller's order (first occurrence of each
 * group anchors its position). Within a group the representative is the
 * first variant with inventoryLevel > 0, else the first variant. PURE —
 * returns a NEW array; never mutates the input. Input without duplicates
 * comes back element-for-element identical (same objects, same order).
 */
export function collapseVariantsForDisplay<T extends CollapsibleVariant>(
  variants: readonly T[],
): T[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const v of variants) {
    const key = displayKey(v);
    const list = groups.get(key);
    if (list) {
      list.push(v);
    } else {
      groups.set(key, [v]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const group = groups.get(key)!;
    return group.find((v) => v.inventoryLevel > 0) ?? group[0];
  });
}

/**
 * Total sellable units behind ONE displayed row — every hidden duplicate's
 * stock counts toward the card's honest depth. Used for "is there ANY stock
 * behind this size" questions; purchase caps still use the representative's
 * own level (one lot per add-to-cart, matching the decrement path).
 */
export function groupInventoryTotal<T extends CollapsibleVariant>(
  variants: readonly T[],
  representative: T,
): number {
  const key = displayKey(representative);
  let total = 0;
  for (const v of variants) {
    if (displayKey(v) === key) total += Math.max(0, Math.trunc(Number(v.inventoryLevel) || 0));
  }
  return total;
}

// ---------------------------------------------------------------------------
// Self-tests — run via scripts/compliance/run-pure-selftests.ts
// ---------------------------------------------------------------------------
export function __runVariantCollapseTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const expect = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log(`FAIL: variant-collapse ${name}`);
    }
  };
  const v = (
    id: string,
    label: string,
    priceMinorUnits: number,
    inventoryLevel: number,
    medical = false,
  ) => ({ id, label, priceMinorUnits, inventoryLevel, medical });

  // The owner's restock case: same label + price, old lot drained, new lot
  // stocked → ONE row, represented by the lot that still has units.
  {
    const out = collapseVariantsForDisplay([
      v("LOT-OLD-onboarded", "3.5g", 4000, 0),
      v("LOT-NEW-onboarded", "3.5g", 4000, 20),
    ]);
    expect("restock dupe: one row", out.length === 1);
    expect("restock dupe: in-stock lot shown", out[0].id === "LOT-NEW-onboarded");
    expect("restock dupe: shown level is the lot's own", out[0].inventoryLevel === 20);
  }

  // BOTH lots stocked: the FIRST in caller order wins (restocks are appended
  // after existing variants, so this is the OLDEST lot — FIFO-friendly).
  {
    const out = collapseVariantsForDisplay([
      v("LOT-OLD-onboarded", "3.5g", 4000, 2),
      v("LOT-NEW-onboarded", "3.5g", 4000, 20),
    ]);
    expect("both stocked: oldest lot shown", out.length === 1 && out[0].id === "LOT-OLD-onboarded");
  }

  // ALL drained: first variant represents; nothing invented.
  {
    const out = collapseVariantsForDisplay([
      v("A", "3.5g", 4000, 0),
      v("B", "3.5g", 4000, 0),
    ]);
    expect("all empty: first represents", out.length === 1 && out[0].id === "A");
  }

  // Different PRICE never collapses (pinned: a restock may carry its own price).
  {
    const out = collapseVariantsForDisplay([
      v("A", "3.5g", 4000, 5),
      v("B", "3.5g", 3800, 5),
    ]);
    expect("price differs: two rows", out.length === 2);
  }

  // Different MEDICAL flag never collapses (the Med chip is real information).
  {
    const out = collapseVariantsForDisplay([
      v("A", "3.5g", 4000, 5, false),
      v("B", "3.5g", 4000, 5, true),
    ]);
    expect("medical differs: two rows", out.length === 2);
  }

  // No duplicates → identical output (same objects, same order).
  {
    const input = [v("A", "1g", 1200, 3), v("B", "3.5g", 3500, 4), v("C", "7g", 6500, 0)];
    const out = collapseVariantsForDisplay(input);
    expect(
      "no dupes: pass-through",
      out.length === 3 && out[0] === input[0] && out[1] === input[1] && out[2] === input[2],
    );
    expect("input not mutated", input.length === 3);
  }

  // Group position anchors at FIRST occurrence (sorted order survives).
  {
    const out = collapseVariantsForDisplay([
      v("A", "1g", 1200, 0),
      v("B", "3.5g", 3500, 4),
      v("C", "1g", 1200, 9),
    ]);
    expect("anchor order: 1g stays first", out.length === 2 && out[0].id === "C" && out[1].id === "B");
  }

  // Three-lot pile-up: still one row, first stocked wins.
  {
    const out = collapseVariantsForDisplay([
      v("A", "100mg", 2500, 0),
      v("B", "100mg", 2500, 0),
      v("C", "100mg", 2500, 7),
    ]);
    expect("three lots: one row, stocked lot shown", out.length === 1 && out[0].id === "C");
  }

  // groupInventoryTotal sums the WHOLE group behind the shown row.
  {
    const all = [
      v("A", "3.5g", 4000, 2),
      v("B", "3.5g", 4000, 20),
      v("C", "7g", 6500, 5),
    ];
    const out = collapseVariantsForDisplay(all);
    expect("total: group sums both lots", groupInventoryTotal(all, out[0]) === 22);
    expect("total: other size untouched", groupInventoryTotal(all, out[1]) === 5);
  }

  // Defensive: garbage levels never poison the total.
  {
    const all = [
      v("A", "1g", 1200, Number.NaN as unknown as number),
      v("B", "1g", 1200, 3),
    ];
    const out = collapseVariantsForDisplay(all);
    expect("garbage level: total stays finite", groupInventoryTotal(all, out[0]) === 3);
  }

  // Empty input → empty output.
  expect("empty in, empty out", collapseVariantsForDisplay([]).length === 0);

  console.log(`variant-collapse self-tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
