/**
 * src/lib/pos/held-stock-core.ts  (Saved-cart smart inventory release)
 *
 * PURE hold-vs-shelf awareness for the register. Zero I/O — unit-testable
 * with tsx.
 *
 * THE PROBLEM (the owner's Cultivera pain): legacy POS systems reserve
 * inventory the moment a cart is saved, so the register reads "zero
 * quantity" and refuses to sell a unit that is physically in the store —
 * just stuck in a saved cart somewhere. Our design already avoids the root
 * cause: a B17 hold is a MINIMAL local snapshot (variant ids + counts) and
 * NEVER reserves stock; inventory only moves when an order COMPLETES (B19).
 *
 * THE REMAINING GAP this core closes: the menu's unitsLeft count doesn't
 * know about the saved cart either. When the store's LAST unit of a product
 * is parked in a saved sale and a second customer wants one, the live cart
 * and the saved cart silently compete for the same physical unit — the
 * cashier just sees "LAST ONE" with no idea the missing stock is parked
 * ten feet away. These helpers NOTICE the overlap, NAME the saved sale
 * (who parked it, what's in it), and let the flow offer the owner's exact
 * ask: "prompt the user if they want to delete the saved sale so we can
 * sell the item to someone else."
 *
 * DISCIPLINE (same as B32): warnings only, NEVER blocks — the cached menu
 * can lag the shelf, and the B19 decrement + server completion gate remain
 * the authority. Deleting a hold is already an unaudited one-tap action on
 * the home screen; surfacing the same action at the conflict moment adds
 * convenience, not new powers.
 */

import type { HeldSale } from "@/lib/pos/register-polish-core";
import type { PosMenuProduct } from "@/lib/pos/sale-flow-core";

// ---------------------------------------------------------------------------
// Held quantities — what the saved sale is sitting on, by variant
// ---------------------------------------------------------------------------

/** Sum the hold's quantity per variant (a hold may repeat a variant id). */
export function heldQuantities(hold: HeldSale | null | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!hold) return map;
  for (const line of hold.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) continue;
    map.set(line.variantId, (map.get(line.variantId) ?? 0) + line.quantity);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Conflict detection — live cart vs saved cart vs what the menu says is left
// ---------------------------------------------------------------------------

/** A live cart line's stock facts, as the conflict detector needs them. */
export type HeldConflictLine = {
  variantId: string;
  productName: string;
  variantLabel: string | null;
  quantity: number;
  /** Menu's variant-level count when known (B32); null/undefined = unknown. */
  unitsLeft: number | null | undefined;
};

/** One live-cart line the saved sale is competing with. */
export type HeldStockConflict = {
  variantId: string;
  /** Plain-English fact: what the menu shows vs what the hold is sitting on. */
  message: string;
};

/**
 * Name every live-cart line the SAVED sale is competing with: the menu's
 * count can't cover both carts (cartQty > unitsLeft − heldQty) AND the hold
 * actually contains that variant. Lines with an unknown count are skipped —
 * with no number there is no arithmetic, and the tile-level badge already
 * covers "may be out". Pass hold = null when the live sale IS the resumed
 * hold (it must never conflict with itself).
 */
export function heldStockConflicts(
  lines: HeldConflictLine[],
  hold: HeldSale | null | undefined,
): HeldStockConflict[] {
  const held = heldQuantities(hold);
  if (held.size === 0) return [];
  const conflicts: HeldStockConflict[] = [];
  for (const line of lines) {
    const heldQty = held.get(line.variantId) ?? 0;
    if (heldQty <= 0) continue;
    if (typeof line.unitsLeft !== "number" || !Number.isInteger(line.unitsLeft) || line.unitsLeft < 0) {
      continue; // unknown count — nothing to reason about
    }
    if (line.quantity <= line.unitsLeft - heldQty) continue; // shelf covers both carts
    const label = line.variantLabel ? `${line.productName} · ${line.variantLabel}` : line.productName;
    conflicts.push({
      variantId: line.variantId,
      message:
        `${label}: the menu shows ${line.unitsLeft} left and the saved sale is holding ` +
        `${heldQty} of them — not enough for both carts.`,
    });
  }
  return conflicts;
}

// ---------------------------------------------------------------------------
// Hold contents at a glance — "what's actually in the saved sale?"
// ---------------------------------------------------------------------------

/**
 * Describe the hold's contents against the CURRENT bundle ("2× Blue Dream ·
 * 3.5g, 1× Sour Gummies · 10pk, +2 more"). The owner's staff should never
 * have to load a saved sale just to find out what it is sitting on. Variants
 * no longer on the menu are counted honestly, never guessed at.
 */
export function describeHeldLines(
  hold: HeldSale | null | undefined,
  products: PosMenuProduct[],
  maxNamed = 3,
): string {
  if (!hold || hold.lines.length === 0) return "";
  const byVariant = new Map(products.map((p) => [p.variantId, p]));
  const named: string[] = [];
  let unknown = 0;
  for (const [variantId, qty] of heldQuantities(hold)) {
    const p = byVariant.get(variantId);
    if (!p) {
      unknown += qty;
      continue;
    }
    const label = p.variantLabel ? `${p.name} · ${p.variantLabel}` : p.name;
    named.push(`${qty}× ${label}`);
  }
  const parts = named.slice(0, maxNamed);
  const extraNamed = named.length - parts.length;
  const extras: string[] = [];
  if (extraNamed > 0) extras.push(`+${extraNamed} more`);
  if (unknown > 0) extras.push(`${unknown} item${unknown === 1 ? "" : "s"} no longer on the menu`);
  return [...parts, ...extras].join(", ");
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runHeldStockCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.error(`FAIL held-stock-core: ${name}`);
    }
  };

  const hold: HeldSale = {
    heldAtIso: "2026-07-13T18:00:00.000Z",
    heldByName: "Sam",
    lines: [
      { variantId: "v1", quantity: 1 },
      { variantId: "v2", quantity: 2 },
      { variantId: "v2", quantity: 1 }, // repeated variant sums to 3
    ],
  };

  // -- heldQuantities ----------------------------------------------------------
  ok(heldQuantities(null).size === 0, "null hold = empty map");
  ok(heldQuantities(hold).get("v1") === 1, "single line quantity");
  ok(heldQuantities(hold).get("v2") === 3, "repeated variant sums");
  ok(heldQuantities(hold).get("v9") === undefined, "absent variant = undefined");

  // -- heldStockConflicts ------------------------------------------------------
  const line = (over: Partial<HeldConflictLine>): HeldConflictLine => ({
    variantId: "v1",
    productName: "Blue Dream",
    variantLabel: "3.5g",
    quantity: 1,
    unitsLeft: 1,
    ...over,
  });

  // The signature case: LAST unit on the menu, and the hold is sitting on it.
  {
    const c = heldStockConflicts([line({})], hold);
    ok(c.length === 1 && c[0].variantId === "v1", "last unit held elsewhere = conflict");
    ok(c[0].message.includes("Blue Dream · 3.5g"), "conflict names the product + size");
    ok(c[0].message.includes("shows 1 left"), "conflict states the menu count");
    ok(c[0].message.includes("holding 1"), "conflict states the held count");
    ok(c[0].message.includes("not enough for both carts"), "conflict says why it matters");
  }
  ok(heldStockConflicts([line({})], null).length === 0, "no hold = no conflicts (resumed-hold guard)");
  ok(heldStockConflicts([line({ unitsLeft: 2 })], hold).length === 0, "shelf covers both carts = no conflict");
  ok(heldStockConflicts([line({ unitsLeft: null })], hold).length === 0, "unknown count = skipped");
  ok(heldStockConflicts([line({ unitsLeft: undefined })], hold).length === 0, "undefined count = skipped");
  ok(heldStockConflicts([line({ unitsLeft: -1 })], hold).length === 0, "negative count = skipped (corrupt)");
  ok(heldStockConflicts([line({ variantId: "v9" })], hold).length === 0, "variant not in hold = no conflict");
  ok(
    heldStockConflicts([line({ variantId: "v2", quantity: 2, unitsLeft: 4 })], hold).length === 1,
    "cart 2 + held 3 > 4 left = conflict on summed hold",
  );
  ok(
    heldStockConflicts([line({ variantId: "v2", quantity: 1, unitsLeft: 4 })], hold).length === 0,
    "cart 1 + held 3 = exactly 4 left = no conflict",
  );
  // unitsLeft 0 with a hold: the count already lags — still a conflict worth
  // naming (the hold explains where a unit may be), never a block.
  ok(heldStockConflicts([line({ unitsLeft: 0 })], hold).length === 1, "zero left + held = conflict named");

  // -- describeHeldLines -------------------------------------------------------
  const products: PosMenuProduct[] = [
    {
      productId: "p1",
      variantId: "v1",
      name: "Blue Dream",
      brand: null,
      category: "flower",
      categories: ["flower"],
      variantLabel: "3.5g",
      regularPriceMinor: 3500,
      costMinorUnits: null,
      inventoryStatus: "in-stock",
    },
    {
      productId: "p2",
      variantId: "v2",
      name: "Sour Gummies",
      brand: null,
      category: "edibles",
      categories: ["edibles"],
      variantLabel: null,
      regularPriceMinor: 1800,
      costMinorUnits: null,
      inventoryStatus: "in-stock",
    },
  ];
  ok(describeHeldLines(null, products) === "", "null hold = empty description");
  ok(
    describeHeldLines(hold, products) === "1× Blue Dream · 3.5g, 3× Sour Gummies",
    "describes quantities + names (label only when present)",
  );
  ok(
    describeHeldLines({ ...hold, lines: [{ variantId: "gone", quantity: 2 }] }, products) ===
      "2 items no longer on the menu",
    "vanished variants counted honestly",
  );
  ok(
    describeHeldLines(
      {
        ...hold,
        lines: [
          { variantId: "v1", quantity: 1 },
          { variantId: "v2", quantity: 1 },
          { variantId: "gone", quantity: 1 },
        ],
      },
      products,
      1,
    ) === "1× Blue Dream · 3.5g, +1 more, 1 item no longer on the menu",
    "maxNamed caps the list with +N more",
  );

  console.log(`pos/held-stock-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`${fail} pos/held-stock-core tests failed`);
}
