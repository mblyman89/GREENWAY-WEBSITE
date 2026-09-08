/**
 * tests/compliance/liquid-limit-ml-website.test.ts  (SLICE L5a)
 *
 * L4 proved the 72 FLUID ounce (2129.292 ml) cap is enforced on the register,
 * on the server placement gate and on the pickup completion gate. It did NOT
 * prove it on the surface the CUSTOMER actually touches, and the customer
 * surface was wrong in two independent ways. Both were MEASURED with a live
 * probe (scripts/compliance/probe-l5a.ts) before a line of this was written.
 *
 * DEFECT 1 — the website could not see a bottle's size at all.
 *   CartItemInput carried no volume, so cartLimitLines' only volume source was
 *   volumeMlFromLabel(variantLabel). src/lib/pos/transform.ts renders the
 *   package label "each" as the EMPTY STRING, and mg/pack labels ("100mg",
 *   "4pk") state no volume either. Measured before the fix:
 *
 *     label ""      qty 72 -> volumeMl=undefined  BLOCKED=false
 *     label "100mg" qty 72 -> volumeMl=undefined  BLOCKED=false
 *     label "4pk"   qty 72 -> volumeMl=undefined  BLOCKED=false
 *
 *   Those lines fell to DEFAULT_UNIT_GRAMS["edible-liquid"] = 28 and exactly
 *   72 packages of ANY size read as legal. The register blocked the same
 *   product at 3 and the server refused the order: the shopper was shown a
 *   legal basket, then refused at the door. That disagreement is precisely
 *   what L4 set out to end.
 *
 * DEFECT 2 — one card hides the sizes of the rest. (A hole in L4 ITSELF.)
 *   All three call sites wrote `item.netVolumeMl ?? volumeMlFromLabel(label)`,
 *   preferring the CARD measure over the VARIANT label. transform.ts's
 *   groupingIdentity() keys on brand+category+strain+medical and DELIBERATELY
 *   omits package size, so ONE card routinely holds a 750 ml and a 1.5 L lot —
 *   while netVolumeMl is derived from `firstAvailable`, the first variant WITH
 *   STOCK. Measured before the fix: buying 2 x 1.5 L resolved 750 ml per unit,
 *   totalled 1500 ml, and PASSED a cap it exceeds by 41% (3000 vs 2129.292).
 *   This one was live on the REGISTER too, not just the website.
 *
 * Fix: a single shared pure resolveUnitVolumeMl(variantLabel, cardNetVolumeMl).
 * The LABEL wins (it describes the thing being sold); the card measure is the
 * fallback for labels that state no volume. null stays UNKNOWN, never zero.
 *
 * Every figure below is derived from the statutory constant or from a real
 * parse — none is assumed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REC_LIQUID_ML,
  ML_PER_FLUID_OUNCE,
  resolveUnitVolumeMl,
  volumeMlFromLabel,
} from "../../src/lib/compliance/liquid-volume-core";
import {
  cartLimitBlock,
  cartLimitLines,
  evaluateCartMeter,
  type CartLimitLineInput,
} from "../../src/lib/menu/cart-limit-meter-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** A storefront cart line, defaulted to the liquid shelf. */
function line(over: Partial<CartLimitLineInput> = {}): CartLimitLineInput {
  return {
    category: "edible-liquid",
    quantity: 1,
    variantLabel: "",
    ...over,
  };
}

function volumeOf(items: CartLimitLineInput[]): number | undefined {
  const [first] = cartLimitLines(items);
  return (first as { volumeMl?: number }).volumeMl;
}

describe("L5a — resolveUnitVolumeMl: the variant label outranks the card measure", () => {
  it("prefers a label that states a volume, even when a card measure exists", () => {
    // THE DEFECT-2 REGRESSION. Card says 750 (the first in-stock lot); the
    // shopper is buying the 1.5 L lot on the SAME card.
    expect(resolveUnitVolumeMl("1.5L", 750)).toBeCloseTo(1500, 6);
    // ...and it is not merely "always take the bigger number":
    expect(resolveUnitVolumeMl("750ml", 1500)).toBeCloseTo(750, 6);
    expect(resolveUnitVolumeMl("12 fl oz", 750)).toBeCloseTo(12 * ML_PER_FLUID_OUNCE, 6);
  });

  it("falls back to the card measure exactly when the label states no volume", () => {
    // transform.ts maps the package label "each" -> "".
    expect(resolveUnitVolumeMl("", 750)).toBeCloseTo(750, 6);
    expect(resolveUnitVolumeMl("100mg", 750)).toBeCloseTo(750, 6);
    expect(resolveUnitVolumeMl("4pk", 750)).toBeCloseTo(750, 6);
    // A bare ounce is AMBIGUOUS on a liquid (fluid vs weight), so the parser
    // declines it and the measured card figure is the honest answer.
    expect(resolveUnitVolumeMl("12oz", 750)).toBeCloseTo(750, 6);
    expect(resolveUnitVolumeMl(null, 750)).toBeCloseTo(750, 6);
    expect(resolveUnitVolumeMl(undefined, 750)).toBeCloseTo(750, 6);
  });

  it("keeps UNKNOWN as null and never coerces it to zero", () => {
    // 0 would read as "free of the limit" — the single most dangerous value.
    expect(resolveUnitVolumeMl("", null)).toBeNull();
    expect(resolveUnitVolumeMl("100mg", undefined)).toBeNull();
    expect(resolveUnitVolumeMl("4pk", 0)).toBeNull();
    expect(resolveUnitVolumeMl("", -5)).toBeNull();
    expect(resolveUnitVolumeMl("", Number.NaN)).toBeNull();
    expect(resolveUnitVolumeMl("", Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("never invents a volume for a weight-only label", () => {
    // No density is assumed anywhere: a 3.5 g label yields nothing.
    expect(resolveUnitVolumeMl("3.5g", null)).toBeNull();
    expect(volumeMlFromLabel("3.5g")).toBeNull();
  });
});

describe("L5a — the storefront meter now sees the bottle", () => {
  it("BLOCKS 72 unlabelled 750 ml bottles that used to read as legal", () => {
    // Before L5a this exact basket measured volumeMl=undefined, fell to the
    // 28 g default, and reported BLOCKED=false.
    const items = [line({ quantity: 72, variantLabel: "", unitVolumeMl: 750 })];
    expect(volumeOf(items)).toBeCloseTo(54000, 3);
    expect(cartLimitBlock(items).over).toBe(true);
  });

  it("blocks the same basket behind an mg-dosed and a pack label too", () => {
    for (const label of ["100mg", "4pk", "each"]) {
      const items = [line({ quantity: 72, variantLabel: label, unitVolumeMl: 750 })];
      expect(cartLimitBlock(items).over).toBe(true);
    }
  });

  it("blocks 3 x 750 ml — the basket the register already refused", () => {
    const items = [line({ quantity: 3, variantLabel: "", unitVolumeMl: 750 })];
    expect(volumeOf(items)).toBeCloseTo(2250, 3);
    expect(2250).toBeGreaterThan(REC_LIQUID_ML);
    expect(cartLimitBlock(items).over).toBe(true);
  });

  it("blocks 2 x 1.5 L bought off a card whose measure says 750 (defect 2)", () => {
    const items = [line({ quantity: 2, variantLabel: "1.5L", unitVolumeMl: 750 })];
    // TRUE volume is 3000 ml. Card-first precedence measured 1500 and passed.
    expect(volumeOf(items)).toBeCloseTo(3000, 3);
    expect(cartLimitBlock(items).over).toBe(true);
  });

  it("still ALLOWS a legal basket — this is a limit, not a ban", () => {
    // 2 x 750 = 1500 ml, comfortably under 2129.292.
    const items = [line({ quantity: 2, variantLabel: "", unitVolumeMl: 750 })];
    expect(volumeOf(items)).toBeCloseTo(1500, 3);
    expect(cartLimitBlock(items).over).toBe(false);
  });

  it("holds exactly at the boundary: at the cap passes, one ml over blocks", () => {
    const at = [line({ quantity: 1, variantLabel: "", unitVolumeMl: REC_LIQUID_ML })];
    expect(cartLimitBlock(at).over).toBe(false);
    const over = [line({ quantity: 1, variantLabel: "", unitVolumeMl: REC_LIQUID_ML + 1 })];
    expect(cartLimitBlock(over).over).toBe(true);
  });

  it("sums MIXED sizes across separate lines against the one cap", () => {
    // 1500 + 750 = 2250 ml > 2129.292. Neither line is over on its own.
    const items = [
      line({ quantity: 1, variantLabel: "1.5L", unitVolumeMl: null }),
      line({ quantity: 1, variantLabel: "", unitVolumeMl: 750 }),
    ];
    expect(cartLimitBlock([items[0]]).over).toBe(false);
    expect(cartLimitBlock([items[1]]).over).toBe(false);
    expect(cartLimitBlock(items).over).toBe(true);
  });

  it("counts a tincture on the same volume cap", () => {
    const items = [line({ category: "tincture", quantity: 3, variantLabel: "", unitVolumeMl: 750 })];
    expect(cartLimitBlock(items).over).toBe(true);
  });

  it("leaves an UNMEASURED liquid on the old weight basis rather than guessing", () => {
    // Fail-honest, not fail-loud: with no label volume and no card measure the
    // meter must NOT invent one. It keeps the pre-existing behaviour so this
    // slice cannot block a product it knows nothing about.
    const items = [line({ quantity: 1, variantLabel: "", unitVolumeMl: null })];
    expect(volumeOf(items)).toBeUndefined();
    expect(cartLimitBlock(items).over).toBe(false);
  });

  it("does not touch non-liquid shelves", () => {
    const flower = [line({ category: "flower", quantity: 2, variantLabel: "3.5g", unitVolumeMl: 750 })];
    expect(cartLimitBlock(flower).over).toBe(false);
  });

  it("reports the liquid bucket in ml, and the meter agrees with the block", () => {
    const items = [line({ quantity: 3, variantLabel: "", unitVolumeMl: 750 })];
    const meter = evaluateCartMeter(items);
    const liquid = meter.buckets.find((b) => b.bucket === "liquid_edible");
    expect(liquid).toBeDefined();
    expect(liquid!.used).toBeCloseTo(2250, 3);
    expect(liquid!.max).toBeCloseTo(REC_LIQUID_ML, 3);
    // The bucket's own unit must be ml — if this ever reads "g" the cap has
    // silently reverted to the weighted-ounce basis that caused the oversell.
    expect(liquid!.unit).toBe("ml");
    expect(liquid!.exceeded).toBe(true);
    // The meter the shopper READS and the gate that BLOCKS must never diverge.
    expect(cartLimitBlock(items).over).toBe(liquid!.exceeded);
  });

  it("treats quantity 0 as zero volume, not as unknown", () => {
    const items = [line({ quantity: 0, variantLabel: "", unitVolumeMl: 750 })];
    expect(cartLimitBlock(items).over).toBe(false);
  });
});

describe("L5a — the wiring that carries the measurement to the shopper", () => {
  it("CartItemInput declares unitVolumeMl, or nothing above can supply it", () => {
    const src = read("src/components/cart/CartProvider.tsx");
    expect(src).toMatch(/unitVolumeMl\?: number \| null;/);
  });

  it("the product page passes the measured volume into the cart", () => {
    const src = read("src/components/menu/ProductDetailPurchasePanel.tsx");
    expect(src).toContain("unitVolumeMl: item.netVolumeMl ?? null,");
  });

  it("both storefront hard blocks run the same pure core", () => {
    // The drawer and checkout must agree with each other and with the meter.
    expect(read("src/components/cart/CartProvider.tsx")).toContain("cartLimitBlock(items)");
    expect(read("src/components/checkout/CheckoutFlow.tsx")).toContain("cartLimitBlock(items)");
  });

  it("NO surface still prefers the card measure over the variant label", () => {
    // The defect-2 shape, pinned dead across every call site at once.
    for (const p of [
      "src/app/api/pos/menu/route.ts",
      "src/lib/orders/order-pricing.ts",
      "src/lib/menu/cart-limit-meter-core.ts",
    ]) {
      const src = read(p);
      expect(src).not.toMatch(/netVolumeMl \?\? volumeMlFromLabel/);
      expect(src).not.toMatch(/unitVolumeMl \?\? volumeMlFromLabel/);
      expect(src).toContain("resolveUnitVolumeMl(");
    }
  });

  it("the live menu loader still carries net_volume_ml to the storefront", () => {
    // If this mapping is dropped, every fix above goes quietly inert.
    expect(read("src/lib/pos/live-menu.ts")).toContain("netVolumeMl: row.net_volume_ml ?? null");
  });
});
