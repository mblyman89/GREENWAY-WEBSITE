/**
 * Saved-cart smart inventory release — pure core tests.
 *
 * Pins the contract that kills the Cultivera pain: a saved cart NEVER
 * reserves inventory (holds are minimal local snapshots), and when the live
 * cart and the saved cart compete for the same physical units the register
 * NOTICES, names the saved sale, and lets the cashier release it — advisory
 * only, never a block.
 */
import { describe, it, expect } from "vitest";
import {
  heldQuantities,
  heldStockConflicts,
  describeHeldLines,
  __runHeldStockCoreTests,
  type HeldConflictLine,
} from "@/lib/pos/held-stock-core";
import type { HeldSale } from "@/lib/pos/register-polish-core";
import type { PosMenuProduct } from "@/lib/pos/sale-flow-core";

const hold: HeldSale = {
  heldAtIso: "2026-07-13T18:00:00.000Z",
  heldByName: "Sam",
  lines: [
    { variantId: "v1", quantity: 1 },
    { variantId: "v2", quantity: 2 },
    { variantId: "v2", quantity: 1 },
  ],
};

const line = (over: Partial<HeldConflictLine>): HeldConflictLine => ({
  variantId: "v1",
  productName: "Blue Dream",
  variantLabel: "3.5g",
  quantity: 1,
  unitsLeft: 1,
  ...over,
});

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

describe("pos/held-stock-core — heldQuantities", () => {
  it("returns an empty map for a missing hold", () => {
    expect(heldQuantities(null).size).toBe(0);
    expect(heldQuantities(undefined).size).toBe(0);
  });

  it("sums repeated variants", () => {
    const q = heldQuantities(hold);
    expect(q.get("v1")).toBe(1);
    expect(q.get("v2")).toBe(3);
    expect(q.get("v9")).toBeUndefined();
  });
});

describe("pos/held-stock-core — heldStockConflicts (the Cultivera fix)", () => {
  it("flags the signature case: the LAST unit is parked in the saved sale", () => {
    const c = heldStockConflicts([line({})], hold);
    expect(c).toHaveLength(1);
    expect(c[0].variantId).toBe("v1");
    expect(c[0].message).toContain("Blue Dream · 3.5g");
    expect(c[0].message).toContain("not enough for both carts");
  });

  it("never lets a resumed hold conflict with itself (hold = null)", () => {
    expect(heldStockConflicts([line({})], null)).toHaveLength(0);
  });

  it("stays quiet when the shelf covers both carts", () => {
    expect(heldStockConflicts([line({ unitsLeft: 2 })], hold)).toHaveLength(0);
    // Exactly enough is enough: cart 1 + held 3 = 4 left.
    expect(heldStockConflicts([line({ variantId: "v2", quantity: 1, unitsLeft: 4 })], hold)).toHaveLength(0);
  });

  it("flags a summed hold exceeding the count (cart 2 + held 3 > 4 left)", () => {
    expect(heldStockConflicts([line({ variantId: "v2", quantity: 2, unitsLeft: 4 })], hold)).toHaveLength(1);
  });

  it("skips unknown or corrupt counts — no arithmetic without a number", () => {
    expect(heldStockConflicts([line({ unitsLeft: null })], hold)).toHaveLength(0);
    expect(heldStockConflicts([line({ unitsLeft: undefined })], hold)).toHaveLength(0);
    expect(heldStockConflicts([line({ unitsLeft: -1 })], hold)).toHaveLength(0);
  });

  it("ignores lines the hold does not contain", () => {
    expect(heldStockConflicts([line({ variantId: "v9" })], hold)).toHaveLength(0);
  });

  it("still names the hold when the count already reads zero", () => {
    // unitsLeft 0 + a hold on the variant: the hold explains where a unit
    // may physically be — exactly the owner's scenario. Named, never blocked.
    expect(heldStockConflicts([line({ unitsLeft: 0 })], hold)).toHaveLength(1);
  });
});

describe("pos/held-stock-core — describeHeldLines", () => {
  it("is empty for a missing or empty hold", () => {
    expect(describeHeldLines(null, products)).toBe("");
  });

  it("names quantities and sizes from the CURRENT bundle", () => {
    expect(describeHeldLines(hold, products)).toBe("1× Blue Dream · 3.5g, 3× Sour Gummies");
  });

  it("counts vanished variants honestly, never guesses names", () => {
    expect(describeHeldLines({ ...hold, lines: [{ variantId: "gone", quantity: 2 }] }, products)).toBe(
      "2 items no longer on the menu",
    );
  });

  it("caps the named list with +N more", () => {
    const mixed: HeldSale = {
      ...hold,
      lines: [
        { variantId: "v1", quantity: 1 },
        { variantId: "v2", quantity: 1 },
        { variantId: "gone", quantity: 1 },
      ],
    };
    expect(describeHeldLines(mixed, products, 1)).toBe(
      "1× Blue Dream · 3.5g, +1 more, 1 item no longer on the menu",
    );
  });
});

describe("embedded self-tests", () => {
  it("pass", () => {
    expect(() => __runHeldStockCoreTests()).not.toThrow();
  });
});
