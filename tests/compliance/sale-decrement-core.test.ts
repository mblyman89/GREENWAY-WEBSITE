/**
 * POS B19 — sale inventory decrement core (pure) tests.
 *
 * Pins the contracts that make completed sales finally reduce stock:
 *  - variant matching (explicit id → single-variant → trailing "(label)"),
 *  - oversell clamps at 0 and is reported (never a silent negative),
 *  - item inventory_status recompute uses the import pipeline's exact
 *    thresholds but never flips an UNTRACKED item (all-zero levels),
 *  - lot consumption is FIFO oldest-first with sold_out marking and
 *    shortfall reporting,
 *  - the summary line doubles as the human audit trail.
 */
import { describe, it, expect } from "vitest";
import {
  buildVariantDecrementPlan,
  buildLotDecrementPlan,
  statusForLevelTotal,
  trailingLabel,
  summarizeDecrement,
  __runSaleDecrementCoreTests,
  type ItemForDecrement,
  type VariantForDecrement,
  type LotForDecrement,
} from "@/lib/inventory/sale-decrement-core";

const items: ItemForDecrement[] = [
  { rowId: "item-row-1", sourceItemId: "prod-1", inventoryStatus: "in-stock" },
  { rowId: "item-row-2", sourceItemId: "prod-2", inventoryStatus: "in-stock" },
];
const variants: VariantForDecrement[] = [
  { rowId: "v-1", menuItemRowId: "item-row-1", sourceVariantId: "var-1", label: "3.5g", inventoryLevel: 5 },
  { rowId: "v-2", menuItemRowId: "item-row-1", sourceVariantId: "var-2", label: "7g", inventoryLevel: 2 },
  { rowId: "v-3", menuItemRowId: "item-row-2", sourceVariantId: "var-3", label: "1g", inventoryLevel: 1 },
];

describe("inventory/sale-decrement-core — variant plan (POS B19)", () => {
  it("decrements by explicit variant id and recomputes item status", () => {
    const plan = buildVariantDecrementPlan(
      [{ lineId: "l1", productId: "prod-1", variantId: "var-1", productName: "Blue Dream (3.5g)", quantity: 4 }],
      items,
      variants,
    );
    // GW-012: delta is the RAW units sold (negative) for the atomic DB write.
    expect(plan.variantUpdates).toEqual([{ rowId: "v-1", newLevel: 1, delta: -4 }]);
    expect(plan.itemStatusUpdates).toEqual([{ rowId: "item-row-1", newStatus: "low-stock" }]);
    expect(plan.oversold).toHaveLength(0);
  });

  it("falls back to the trailing (label) the register bakes into names", () => {
    const plan = buildVariantDecrementPlan(
      [{ lineId: "l1", productId: "prod-1", variantId: null, productName: "Blue Dream (7g)", quantity: 2 }],
      items,
      variants,
    );
    expect(plan.variantUpdates).toEqual([{ rowId: "v-2", newLevel: 0, delta: -2 }]);
  });

  it("clamps oversell at 0, reports it, and flips a tracked item to unavailable", () => {
    const plan = buildVariantDecrementPlan(
      [{ lineId: "l1", productId: "prod-2", variantId: null, productName: "Solo Gram", quantity: 3 }],
      items,
      variants,
    );
    expect(plan.variantUpdates[0].newLevel).toBe(0);
    expect(plan.oversold).toHaveLength(1);
    expect(plan.itemStatusUpdates).toEqual([{ rowId: "item-row-2", newStatus: "unavailable" }]);
  });

  it("never flips status for untracked items and reports unmatched lines", () => {
    const untrackedItems: ItemForDecrement[] = [{ rowId: "i", sourceItemId: "p", inventoryStatus: "in-stock" }];
    const untrackedVariants: VariantForDecrement[] = [
      { rowId: "v", menuItemRowId: "i", sourceVariantId: "sv", label: "each", inventoryLevel: 0 },
    ];
    const plan = buildVariantDecrementPlan(
      [
        { lineId: "l1", productId: "p", variantId: "sv", productName: "Untracked", quantity: 1 },
        { lineId: "l2", productId: "ghost", variantId: null, productName: "Ghost", quantity: 1 },
      ],
      untrackedItems,
      untrackedVariants,
    );
    expect(plan.itemStatusUpdates).toHaveLength(0);
    expect(plan.unmatched).toHaveLength(1);
  });
});

describe("inventory/sale-decrement-core — lot plan (POS B19)", () => {
  const lots: LotForDecrement[] = [
    { id: "lot-a", posProductKey: "prod-1", onHandQty: 2, ccrsExternalId: "LOT-A-CCRS" },
    { id: "lot-b", posProductKey: "prod-1", onHandQty: 5, ccrsExternalId: "LOT-B-CCRS" },
  ];

  it("consumes lots FIFO and marks drained lots sold out", () => {
    const plan = buildLotDecrementPlan(
      [{ lineId: "l1", productId: "prod-1", variantId: null, productName: "BD", quantity: 3 }],
      lots,
    );
    // GW-012: delta = units consumed from THAT lot (negative), for the
    // atomic DB write.
    expect(plan.lotUpdates).toEqual([
      { id: "lot-a", posProductKey: "prod-1", newOnHand: 0, soldOut: true, delta: -2 },
      { id: "lot-b", posProductKey: "prod-1", newOnHand: 4, soldOut: false, delta: -1 },
    ]);
    expect(plan.shortfalls).toHaveLength(0);
  });

  it("B20: stamps the FIRST consumed lot's CCRS id per product key, never fabricates", () => {
    const plan = buildLotDecrementPlan(
      [{ lineId: "l1", productId: "prod-1", variantId: null, productName: "BD", quantity: 3 }],
      lots,
    );
    expect(plan.lineExternalIds.get("prod-1")).toBe("LOT-A-CCRS");
    const noId = buildLotDecrementPlan(
      [{ lineId: "l1", productId: "p", variantId: null, productName: "X", quantity: 1 }],
      [{ id: "lot-x", posProductKey: "p", onHandQty: 5 }],
    );
    expect(noId.lineExternalIds.size).toBe(0);
  });

  it("reports the exact uncovered remainder as a shortfall", () => {
    const plan = buildLotDecrementPlan(
      [{ lineId: "l1", productId: "prod-1", variantId: null, productName: "BD", quantity: 10 }],
      lots,
    );
    expect(plan.shortfalls).toHaveLength(1);
    expect(plan.shortfalls[0]).toContain("3 unit(s)");
  });
});

describe("inventory/sale-decrement-core — helpers", () => {
  it("status thresholds mirror the import pipeline exactly", () => {
    expect(statusForLevelTotal(0)).toBe("unavailable");
    expect(statusForLevelTotal(3)).toBe("low-stock");
    expect(statusForLevelTotal(4)).toBe("in-stock");
  });

  it("extracts only a TRAILING parenthesized label", () => {
    expect(trailingLabel("Blue Dream (3.5g)")).toBe("3.5g");
    expect(trailingLabel("Weird (a) middle")).toBeNull();
  });

  it("summary carries warnings only when they exist", () => {
    const clean = summarizeDecrement({
      variantPlan: { variantUpdates: [], itemStatusUpdates: [], oversold: [], unmatched: [] },
      lotPlan: { lotUpdates: [], lineExternalIds: new Map(), shortfalls: [] },
      lineCount: 1,
    });
    expect(clean).not.toContain("OVERSOLD");
    const dirty = summarizeDecrement({
      variantPlan: { variantUpdates: [], itemStatusUpdates: [], oversold: ["x"], unmatched: [] },
      lotPlan: { lotUpdates: [], lineExternalIds: new Map(), shortfalls: ["y"] },
      lineCount: 1,
    });
    expect(dirty).toContain("OVERSOLD");
    expect(dirty).toContain("LOT SHORTFALL");
  });
});

describe("embedded self-tests", () => {
  it("sale-decrement-core self-tests pass", () => {
    expect(() => __runSaleDecrementCoreTests()).not.toThrow();
  });
});
