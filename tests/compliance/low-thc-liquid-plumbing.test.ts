/**
 * tests/compliance/low-thc-liquid-plumbing.test.ts  (SLICE 16)
 *
 * The engine tests in low-thc-liquid-limit.test.ts prove the RULE is right.
 * This file proves the FACT ACTUALLY ARRIVES.
 *
 * That is the failure this slice was most likely to ship: a correct engine that
 * never receives the flag, so every low-THC drink silently falls back to the
 * 72 oz bucket and nothing looks broken. The classification has to survive four
 * hops on the register path and three on the website path, and it has to be
 * snapshotted onto the order or the pickup gate re-derives the wrong answer.
 *
 * Three surfaces must agree on an identical basket:
 *
 *   register  priceCart -> limitLinesFor
 *   website   cartLimitLines
 *   pickup    the stored order-line snapshot
 *
 * If any one of them drops the flag, that surface applies the 72 oz volume rule
 * to a product the statute exempted, and a legal sale is refused. Michael's
 * whole reason for the slice was that he is losing legal sales today.
 */
import { describe, expect, it } from "vitest";
import {
  limitLinesFor,
  priceCart,
  type PosMenuProduct,
} from "../../src/lib/pos/sale-flow-core";
import { cartLimitLines } from "../../src/lib/menu/cart-limit-meter-core";
import {
  evaluateCart,
  qualifiesAsLowThcLiquid,
  lineBucket,
} from "../../src/lib/compliance/sales-limits-core";

/** A qualifying 4 mg can, as the POS menu bundle would deliver it. */
const CAN: PosMenuProduct = {
  productId: "prod-drink",
  variantId: "var-drink-12oz",
  name: "Hi-Fi Hops 4mg",
  brand: "Lagunitas",
  category: "edible-liquid",
  categories: ["edible-liquid"],
  variantLabel: "12oz",
  regularPriceMinor: 800,
  costMinorUnits: null,
  inventoryStatus: "in-stock",
  lowThcLiquid: true,
  unitThcMg: 4,
};

/** The trap product: one bottle, 16 mg total, label says "4 servings x 4 mg". */
const BOTTLE: PosMenuProduct = {
  productId: "prod-bottle",
  variantId: "var-bottle-16mg",
  name: "Tonic 16mg",
  brand: "House",
  category: "edible-liquid",
  categories: ["edible-liquid"],
  variantLabel: "2oz",
  regularPriceMinor: 1500,
  costMinorUnits: null,
  inventoryStatus: "in-stock",
  lowThcLiquid: false,
  unitThcMg: 16,
};

/** A liquid nobody has classified yet. */
const UNCLASSIFIED: PosMenuProduct = {
  productId: "prod-unknown",
  variantId: "var-unknown",
  name: "New Seltzer",
  brand: "New Vendor",
  category: "edible-liquid",
  categories: ["edible-liquid"],
  variantLabel: "12oz",
  regularPriceMinor: 700,
  costMinorUnits: null,
  inventoryStatus: "in-stock",
};

describe("register path \u2014 the fact survives priceCart \u2192 limitLinesFor", () => {
  it("a qualifying can reaches the engine with its classification intact", () => {
    const priced = priceCart([{ product: CAN, quantity: 4 }], []);
    const [line] = limitLinesFor(priced.lines);

    expect(line.lowThcLiquid).toBe(true);
    expect(line.unitThcMg).toBe(4);
    // The point of the whole slice: it lands in the mg bucket.
    expect(lineBucket(line)).toBe("low_thc_liquid");
    expect(qualifiesAsLowThcLiquid(line)).toBe(true);
  });

  it("a 4-pack rung as four units counts as 16 mg, not one 4 mg unit", () => {
    // Michael: "one can is one unit, and a 4 pack of cans is 4 units. So a 4
    // pack would qualify, the budtender would scan each can in the pack."
    const asOneLine = limitLinesFor(priceCart([{ product: CAN, quantity: 4 }], []).lines);
    const v = evaluateCart(asOneLine, "recreational");
    const bucket = v.buckets.find((b) => b.bucket === "low_thc_liquid")!;
    expect(bucket.used).toBe(16);
  });

  it("the 16 mg bottle does NOT qualify even though its serving math says 4 mg", () => {
    const priced = priceCart([{ product: BOTTLE, quantity: 1 }], []);
    const [line] = limitLinesFor(priced.lines);
    expect(line.lowThcLiquid).toBe(false);
    expect(lineBucket(line)).toBe("liquid_edible");
  });

  it("an unclassified liquid arrives as null and is treated as a normal liquid", () => {
    const priced = priceCart([{ product: UNCLASSIFIED, quantity: 1 }], []);
    const [line] = limitLinesFor(priced.lines);
    expect(line.lowThcLiquid).toBeNull();
    expect(line.unitThcMg).toBeNull();
    expect(lineBucket(line)).toBe("liquid_edible");
  });

  it("50 cans is legal on the register; 51 is not", () => {
    const ok = evaluateCart(
      limitLinesFor(priceCart([{ product: CAN, quantity: 50 }], []).lines),
      "recreational",
    );
    expect(ok.blocked).toBe(false);

    const over = evaluateCart(
      limitLinesFor(priceCart([{ product: CAN, quantity: 51 }], []).lines),
      "recreational",
    );
    expect(over.blocked).toBe(true);
    // And the customer must be told in milligrams, not fake ounces.
    expect(over.reasons.join(" ")).toContain("mg THC");
    expect(over.reasons.join(" ")).not.toContain("oz");
  });
});

describe("website path \u2014 the fact survives cartLimitLines", () => {
  it("a qualifying can reaches the engine from the shop cart", () => {
    const [line] = cartLimitLines([
      { category: "edible-liquid", quantity: 4, variantLabel: "12oz", lowThcLiquid: true, unitThcMg: 4 },
    ]);
    expect(lineBucket(line)).toBe("low_thc_liquid");
  });

  it("an unclassified liquid stays in the 72 oz bucket", () => {
    const [line] = cartLimitLines([
      { category: "edible-liquid", quantity: 1, variantLabel: "12oz" },
    ]);
    expect(line.lowThcLiquid).toBeNull();
    expect(lineBucket(line)).toBe("liquid_edible");
  });
});

describe("the three surfaces agree on an identical basket", () => {
  // This is the regression that matters most. The register, the website and the
  // pickup gate each build LimitCartLines through DIFFERENT code. If they ever
  // disagree, a customer is told one thing online and another at the counter.
  const QTY = 40;

  it("register, website and stored-order snapshot reach the same verdict", () => {
    const register = limitLinesFor(priceCart([{ product: CAN, quantity: QTY }], []).lines);

    const website = cartLimitLines([
      { category: "edible-liquid", quantity: QTY, variantLabel: "12oz", lowThcLiquid: true, unitThcMg: 4 },
    ]);

    // What completion-gate.ts reconstructs from order_lines: the placement-time
    // snapshot of category, quantity and the low-THC classification.
    const pickup = [
      { category: "edible-liquid", quantity: QTY, lowThcLiquid: true, unitThcMg: 4 },
    ];

    const a = evaluateCart(register, "recreational");
    const b = evaluateCart(website, "recreational");
    const c = evaluateCart(pickup, "recreational");

    const used = (v: typeof a) => v.buckets.find((x) => x.bucket === "low_thc_liquid")!.used;
    expect(used(a)).toBe(160);
    expect(used(b)).toBe(160);
    expect(used(c)).toBe(160);
    expect(a.blocked).toBe(false);
    expect(b.blocked).toBe(false);
    expect(c.blocked).toBe(false);
  });

  it("a pickup gate that LOST the snapshot would wrongly block \u2014 proving why step 6 exists", () => {
    // Same 40 cans, but the stored line has no classification (what the gate
    // would see if the snapshot were never written). 40 x 355 ml of volume
    // blows the 2016 g liquid bucket, so the customer gets refused at the
    // counter for an order the website legally accepted.
    const withoutSnapshot = [
      { category: "edible-liquid", quantity: QTY, grams: 355 * QTY },
    ];
    const v = evaluateCart(withoutSnapshot, "recreational");
    expect(v.blocked).toBe(true);

    // With the snapshot, the same basket is fine. This asymmetry IS the reason
    // the order snapshot is not optional.
    const withSnapshot = [
      { category: "edible-liquid", quantity: QTY, grams: 355 * QTY, lowThcLiquid: true, unitThcMg: 4 },
    ];
    expect(evaluateCart(withSnapshot, "recreational").blocked).toBe(false);
  });

  it("a qualifying line consumes NO volume from the 72 oz bucket", () => {
    // (E) and (F) are alternatives. Even though the line still carries its
    // grams, a qualifying drink must not burn both buckets.
    const lines = [
      { category: "edible-liquid", quantity: 50, grams: 355 * 50, lowThcLiquid: true, unitThcMg: 4 },
    ];
    const v = evaluateCart(lines, "recreational");
    expect(v.buckets.find((b) => b.bucket === "liquid_edible")!.used).toBe(0);
    expect(v.buckets.find((b) => b.bucket === "low_thc_liquid")!.used).toBe(200);
    expect(v.blocked).toBe(false);
  });

  it("mixed basket: a qualifying drink and a normal liquid each hit their own bucket", () => {
    const v = evaluateCart(
      [
        { category: "edible-liquid", quantity: 10, lowThcLiquid: true, unitThcMg: 4 },
        { category: "edible-liquid", quantity: 1, grams: 1000 },
      ],
      "recreational",
    );
    expect(v.buckets.find((b) => b.bucket === "low_thc_liquid")!.used).toBe(40);
    expect(v.buckets.find((b) => b.bucket === "liquid_edible")!.used).toBe(1000);
    expect(v.blocked).toBe(false);
  });
});
