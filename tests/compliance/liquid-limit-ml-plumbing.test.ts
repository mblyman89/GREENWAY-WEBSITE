/**
 * tests/compliance/liquid-limit-ml-plumbing.test.ts  (SLICE L4)
 *
 * liquid-limit-ml-engine.test.ts proves the RULE is right: the liquid bucket
 * is metered in millilitres against 72 FLUID ounces (2129.292 ml).
 *
 * This file proves the MEASUREMENT ACTUALLY ARRIVES.
 *
 * That is the failure this slice was most likely to ship, and it is the exact
 * shape of the bug the owner reported. A correct cap is completely inert if no
 * line ever supplies a volume: every liquid then falls back to the
 * weight-carried basis, a 1.5 L bottle produces no weight at all, the engine
 * reaches for DEFAULT_UNIT_GRAMS["edible-liquid"] = 28, and exactly 72 bottles
 * fit the limit no matter how big they are. Nothing looks broken. The numbers
 * even look plausible. That is precisely why it survived until Michael found
 * it by hand.
 *
 * So the volume has to survive every hop on four surfaces, and they all have
 * to agree about the same basket:
 *
 *   register  priceCart -> limitLinesFor
 *   website   cartLimitLines
 *   server    repriceOrderLines' limit lines (placement)
 *   pickup    the stored order_lines snapshot (completion gate)
 *
 * If any one of them drops it, that surface silently reverts to the 28 g
 * default and the oversell comes straight back.
 *
 * The tests below use MEASURED values, never assumed ones. Each figure is
 * derived from the statutory constant (29.5735 ml per fluid ounce) or from
 * the parse of a real label, and the equivalences asserted here were probed
 * against the live modules before being written down.
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
  lineBucket,
  lineMl,
  type LimitCartLine,
} from "../../src/lib/compliance/sales-limits-core";
// REC_LIQUID_ML lives here; sales-limits-core imports it rather than
// re-exporting it, so it must be taken from its home module.
import {
  ML_PER_FLUID_OUNCE,
  REC_LIQUID_ML,
  volumeMlFromLabel,
  lineVolumeMl,
} from "../../src/lib/compliance/liquid-volume-core";
import { gramsFromVariantLabel, normalizeUnitGrams } from "../../src/lib/pos/variant-grams-core";
import { readFileSync } from "node:fs";

/** Millilitres the liquid bucket reports as consumed. */
function liquidMl(lines: LimitCartLine[]): number {
  const v = evaluateCart(lines, "recreational");
  return v.buckets.find((b) => b.bucket === "liquid_edible")!.used;
}

/** A menu card as the POS bundle delivers it, with the L3-plumbed volume. */
function card(over: Partial<PosMenuProduct>): PosMenuProduct {
  return {
    productId: "prod",
    variantId: "var",
    name: "Product",
    brand: "House",
    category: "edible-liquid",
    categories: ["edible-liquid"],
    variantLabel: null,
    regularPriceMinor: 1000,
    costMinorUnits: null,
    inventoryStatus: "in-stock",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. The defect itself, reproduced and then closed
// ---------------------------------------------------------------------------

describe("the reported defect: a big bottle must not be sold 72 times", () => {
  // Michael: "it allows me to sell an incredibly larger amount that I'm
  // allowed to sell." This is that sentence as an executable assertion.
  const BOTTLE_1_5L = card({
    productId: "prod-15l",
    variantId: "var-15l",
    name: "Infused Lemonade",
    variantLabel: "1.5L",
    unitVolumeMl: 1500,
  });

  it("PROOF OF THE BUG: a 1.5 L bottle has no parseable weight at all", () => {
    // This is the root cause. gramsFromVariantLabel's regex accepts only
    // g|gram|grams|oz|ounce|ounces, so every metric volume label returns null
    // and the engine falls back to the 28 g category default.
    expect(gramsFromVariantLabel("1.5L")).toBeNull();
    expect(gramsFromVariantLabel("750ml")).toBeNull();
    expect(gramsFromVariantLabel("100ml")).toBeNull();
    expect(gramsFromVariantLabel("12 fl oz")).toBeNull();
  });

  it("PROOF OF THE BUG: on the 28 g default, 72 bottles of ANY size fit", () => {
    // What the register did before L4: no grams, no volume, category default.
    // 72 x 28 = 2016, exactly the old cap, for a 1.5 L bottle as readily as
    // for a 30 ml tincture. 108 LITRES of product, sold as "legal".
    const legacy = [{ category: "edible-liquid", quantity: 72 }];
    expect(evaluateCart(legacy, "recreational").blocked).toBe(false);
  });

  it("FIXED: the same bottle now meters its real volume and stops at one", () => {
    const one = limitLinesFor(priceCart([{ product: BOTTLE_1_5L, quantity: 1 }], []).lines);
    expect(one[0].volumeMl).toBe(1500);
    expect(liquidMl(one)).toBe(1500);
    expect(evaluateCart(one, "recreational").blocked).toBe(false);

    const two = limitLinesFor(priceCart([{ product: BOTTLE_1_5L, quantity: 2 }], []).lines);
    expect(liquidMl(two)).toBe(3000);
    // 3000 ml against a 2129.292 ml cap.
    expect(evaluateCart(two, "recreational").blocked).toBe(true);
  });

  it("FIXED: 72 of them is refused by a factor of fifty", () => {
    const lines = limitLinesFor(priceCart([{ product: BOTTLE_1_5L, quantity: 72 }], []).lines);
    expect(liquidMl(lines)).toBe(108000);
    expect(liquidMl(lines) / REC_LIQUID_ML).toBeGreaterThan(50);
    expect(evaluateCart(lines, "recreational").blocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. The register surface
// ---------------------------------------------------------------------------

describe("register path — the volume survives priceCart -> limitLinesFor", () => {
  it("the plumbed net_volume_ml reaches the engine untouched", () => {
    const p = card({ variantLabel: "750ml", unitVolumeMl: 750 });
    const [line] = limitLinesFor(priceCart([{ product: p, quantity: 2 }], []).lines);
    expect(line.volumeMl).toBe(1500);
    expect(lineBucket(line)).toBe("liquid_edible");
  });

  it("a card staged BEFORE the L3 plumbing still gets its volume from the label", () => {
    // No unitVolumeMl at all. The API route parses the label; this asserts the
    // parse the route relies on, so an old cached bundle is not left uncapped.
    expect(volumeMlFromLabel("750ml")).toBe(750);
    expect(volumeMlFromLabel("1.5L")).toBe(1500);
    expect(volumeMlFromLabel("12 fl oz")).toBeCloseTo(12 * ML_PER_FLUID_OUNCE, 2);
  });

  it("a line with NO volume is omitted, not zeroed", () => {
    // Critical distinction. volumeMl: 0 would read as "this line consumes no
    // liquid" and take the product out of the limit entirely. Absent means
    // "unknown", and lineMl() then carries the weight across instead.
    const p = card({ variantLabel: "each", unitVolumeMl: null });
    const [line] = limitLinesFor(priceCart([{ product: p, quantity: 1 }], []).lines);
    expect(line.volumeMl).toBeUndefined();
    expect("volumeMl" in line).toBe(false);
    // Still metered — on the category default, exactly as before L4.
    expect(lineMl(line)).toBeCloseTo((28 / 28) * ML_PER_FLUID_OUNCE, 2);
  });

  it("quantity multiplies: the LINE total is what the bucket sees", () => {
    const p = card({ variantLabel: "100ml", unitVolumeMl: 100 });
    for (const q of [1, 5, 21, 22]) {
      const lines = limitLinesFor(priceCart([{ product: p, quantity: q }], []).lines);
      expect(liquidMl(lines)).toBe(100 * q);
      // 21 x 100 = 2100 <= 2129.292 < 2200 = 22 x 100.
      expect(evaluateCart(lines, "recreational").blocked).toBe(q > 21);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The website surface
// ---------------------------------------------------------------------------

describe("website path — the volume survives cartLimitLines", () => {
  it("the shop cart meters the plumbed volume", () => {
    const [line] = cartLimitLines([
      { category: "edible-liquid", quantity: 2, variantLabel: "750ml", unitVolumeMl: 750 },
    ]);
    expect(line.volumeMl).toBe(1500);
  });

  it("the shop cart falls back to the label when the card predates L3", () => {
    const [line] = cartLimitLines([
      { category: "edible-liquid", quantity: 2, variantLabel: "750ml" },
    ]);
    expect(line.volumeMl).toBe(1500);
  });

  it("an unmeasurable label leaves the line on the weight basis", () => {
    const [line] = cartLimitLines([
      { category: "edible-liquid", quantity: 1, variantLabel: "each" },
    ]);
    expect("volumeMl" in line).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. The pickup surface — the snapshot
// ---------------------------------------------------------------------------

describe("pickup path — the stored snapshot is read back, not re-derived", () => {
  it("the completion gate reads unit_volume_ml off the stored line", () => {
    // Source assert: the gate is async and DB-bound, so this pins the wiring
    // that the runtime test below models.
    const src = readFileSync("src/lib/orders/order-pricing.ts", "utf8");
    expect(src).toContain("normalizeUnitGrams(line.unit_volume_ml)");
    expect(src).toContain("...(volumeMl !== null && volumeMl > 0 ? { volumeMl } : {})");
  });

  it("placement writes the snapshot, conditionally and positively", () => {
    const src = readFileSync("src/lib/orders/orders-store.ts", "utf8");
    expect(src).toContain("unit_volume_ml: l.unitVolumeMl");
    // Only written when it is a real positive number — an omitted column reads
    // back as null, which the gate treats as unknown rather than as zero.
    expect(src).toContain('typeof l.unitVolumeMl === "number" && l.unitVolumeMl > 0');
  });

  it("the missing-column ladder has a rung for an unapplied 0223", () => {
    // Placement must never fail because the owner has not run the migration.
    const src = readFileSync("src/lib/orders/orders-store.ts", "utf8");
    expect(src).toContain("buildLineRows(true, true, true, true, true)");
    expect(src).toContain("buildLineRows(true, true, true, true, false)");
    expect(src).toContain("buildLineRows(false, false, false, false, false)");
  });

  it("the migration exists and is nullable with no backfill", () => {
    const sql = readFileSync("supabase/migrations/0223_liquid_volume_ml_snapshot.sql", "utf8");
    expect(sql).toContain("add column if not exists unit_volume_ml numeric(12,3)");
    expect(sql).not.toMatch(/not null/i);
    expect(sql).not.toMatch(/\bupdate\s+public\.order_lines\b/i);
  });

  it("a PostgREST numeric string is coerced, not dropped", () => {
    // pg numeric can arrive as a string. If that silently became null the
    // pickup gate would revert every liquid to the 28 g default.
    expect(normalizeUnitGrams("750")).toBe(750);
    expect(lineVolumeMl(normalizeUnitGrams("750"), 2)).toBe(1500);
    expect(normalizeUnitGrams(null)).toBeNull();
    expect(lineVolumeMl(normalizeUnitGrams(null), 2)).toBeNull();
  });

  it("a legacy row with no snapshot keeps the old, still-correct answer", () => {
    // 0223 unapplied, or a row written before this slice. The line falls back
    // to the weight it did snapshot, which for an ounce-labelled product is
    // numerically identical to its fluid-ounce reading.
    const legacy: LimitCartLine[] = [{ category: "edible-liquid", quantity: 1, grams: 336 }];
    expect(liquidMl(legacy)).toBeCloseTo(12 * ML_PER_FLUID_OUNCE, 2);
  });
});

// ---------------------------------------------------------------------------
// 5. All four surfaces on one basket
// ---------------------------------------------------------------------------

describe("the four surfaces agree on an identical basket", () => {
  // The regression that matters most. Each surface builds its LimitCartLines
  // through different code. If they disagree, a customer is told one thing
  // online, another at the register, and refused at the counter.
  const QTY = 2;

  it("register, website, placement and pickup reach the same verdict", () => {
    const p = card({ variantLabel: "750ml", unitVolumeMl: 750 });

    const register = limitLinesFor(priceCart([{ product: p, quantity: QTY }], []).lines);
    const website = cartLimitLines([
      { category: "edible-liquid", quantity: QTY, variantLabel: "750ml", unitVolumeMl: 750 },
    ]);
    // What repriceOrderLines builds at placement, and what the completion gate
    // reconstructs from order_lines — both reduce to a per-unit ml x quantity.
    const placement: LimitCartLine[] = [
      { category: "edible-liquid", quantity: QTY, volumeMl: lineVolumeMl(750, QTY)! },
    ];
    const pickup: LimitCartLine[] = [
      {
        category: "edible-liquid",
        quantity: QTY,
        volumeMl: lineVolumeMl(normalizeUnitGrams("750"), QTY)!,
      },
    ];

    for (const surface of [register, website, placement, pickup]) {
      expect(liquidMl(surface)).toBe(1500);
      expect(evaluateCart(surface, "recreational").blocked).toBe(false);
    }
  });

  it("and they agree that three bottles is over", () => {
    const p = card({ variantLabel: "750ml", unitVolumeMl: 750 });
    const register = limitLinesFor(priceCart([{ product: p, quantity: 3 }], []).lines);
    const website = cartLimitLines([
      { category: "edible-liquid", quantity: 3, variantLabel: "750ml", unitVolumeMl: 750 },
    ]);
    const pickup: LimitCartLine[] = [
      { category: "edible-liquid", quantity: 3, volumeMl: 2250 },
    ];
    for (const surface of [register, website, pickup]) {
      expect(evaluateCart(surface, "recreational").blocked).toBe(true);
    }
  });

  it("a pickup gate that LOST the snapshot would wrongly ALLOW — why the column exists", () => {
    // Same three 750 ml bottles, but the stored line has no volume and no
    // parseable weight (a metric label yields neither). The gate falls back to
    // the 28 g default: 3 x 28 = 84 g, a rounding error against the cap. The
    // counter would hand over 2.25 litres and call it legal.
    const lost: LimitCartLine[] = [{ category: "edible-liquid", quantity: 3 }];
    expect(evaluateCart(lost, "recreational").blocked).toBe(false);

    const kept: LimitCartLine[] = [{ category: "edible-liquid", quantity: 3, volumeMl: 2250 }];
    expect(evaluateCart(kept, "recreational").blocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Nothing that was already correct moved
// ---------------------------------------------------------------------------

describe("no correct answer changed", () => {
  it("an ounce-labelled liquid reads identically through weight or volume", () => {
    // The heart of the safety proof. For an ounce label the 28 cancels:
    //   grams / 28 * 29.5735  ==  ounces * 29.5735
    // so the rebase cannot move a single verdict for these products.
    for (const oz of [1, 2, 4, 8, 12, 16, 32]) {
      const viaWeight: LimitCartLine[] = [
        { category: "edible-liquid", quantity: 1, grams: oz * 28 },
      ];
      const viaVolume: LimitCartLine[] = [
        { category: "edible-liquid", quantity: 1, volumeMl: oz * ML_PER_FLUID_OUNCE },
      ];
      expect(liquidMl(viaWeight)).toBeCloseTo(liquidMl(viaVolume), 2);
    }
  });

  it("the register's own 12oz card still allows exactly 6 and refuses 7", () => {
    // unitGrams is supplied BY THE BUNDLE: /api/pos/menu calls
    // gramsFromVariantLabel and priceCart reads the result off the card
    // (sale-flow-core.ts:446). Building the card the way the route does is
    // what makes this a real regression test rather than a default-value one.
    const p = card({ variantLabel: "12oz", unitGrams: gramsFromVariantLabel("12oz") });
    const six = limitLinesFor(priceCart([{ product: p, quantity: 6 }], []).lines);
    const seven = limitLinesFor(priceCart([{ product: p, quantity: 7 }], []).lines);
    expect(evaluateCart(six, "recreational").blocked).toBe(false);
    expect(evaluateCart(seven, "recreational").blocked).toBe(true);
  });

  it("a low-THC drink still bypasses the volume bucket entirely", () => {
    // (E) and (F) are alternatives. Adding a volume must not make a qualifying
    // drink burn both buckets — that would refuse a sale the statute allows.
    const p = card({
      variantLabel: "12 fl oz",
      unitVolumeMl: 354.882,
      lowThcLiquid: true,
      unitThcMg: 4,
    });
    const lines = limitLinesFor(priceCart([{ product: p, quantity: 50 }], []).lines);
    const v = evaluateCart(lines, "recreational");
    expect(v.buckets.find((b) => b.bucket === "liquid_edible")!.used).toBe(0);
    expect(v.buckets.find((b) => b.bucket === "low_thc_liquid")!.used).toBe(200);
    expect(v.blocked).toBe(false);
  });

  it("a suppository still counts in units, not millilitres", () => {
    const p = card({
      category: "topical",
      categories: ["topical"],
      variantLabel: "10ml",
      unitVolumeMl: 10,
      otherwiseTaken: true,
      unitsPerPackage: 6,
    });
    const lines = limitLinesFor(priceCart([{ product: p, quantity: 1 }], []).lines);
    const v = evaluateCart(lines, "recreational");
    expect(v.buckets.find((b) => b.bucket === "otherwise_taken")!.used).toBe(6);
    expect(v.buckets.find((b) => b.bucket === "liquid_edible")!.used).toBe(0);
  });

  it("a topical is untouched by the rebase (owner: topicals stay on weight for now)", () => {
    // 1 / 1.7 / 2 / 4 / 8 oz -> 72 / 42 / 36 / 18 / 9 packages, identical to
    // the pre-L4 answers. Michael: "leave topicals as weighted ounces."
    const expected: [number, number][] = [
      [1, 72],
      [1.7, 42],
      [2, 36],
      [4, 18],
      [8, 9],
    ];
    for (const [oz, maxUnits] of expected) {
      const at: LimitCartLine[] = [
        { category: "topical", quantity: maxUnits, grams: oz * 28 * maxUnits },
      ];
      const over: LimitCartLine[] = [
        { category: "topical", quantity: maxUnits + 1, grams: oz * 28 * (maxUnits + 1) },
      ];
      expect(evaluateCart(at, "recreational").blocked).toBe(false);
      expect(evaluateCart(over, "recreational").blocked).toBe(true);
    }
  });

  it("non-liquid buckets never see a volume", () => {
    const flower = limitLinesFor(
      priceCart([{ product: card({ category: "flower", categories: ["flower"], variantLabel: "3.5g" }), quantity: 1 }], []).lines,
    );
    expect("volumeMl" in flower[0]).toBe(false);
    expect(evaluateCart(flower, "recreational").blocked).toBe(false);
  });
});
