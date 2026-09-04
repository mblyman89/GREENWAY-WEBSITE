/**
 * SLICE 18D — the register's classification VISIBILITY logic.
 *
 * 18B made these products findable if a budtender already knew to type
 * "suppository". 18D makes them VISIBLE to a budtender who does not. The
 * question every test here answers is the same one: can a marker or a chip
 * ever tell a budtender something the limit meter would contradict?
 *
 * The answer has to be no, because the two are read from the same predicates.
 * These tests prove that rather than assuming it.
 */
import { describe, expect, it } from "vitest";

import {
  POS_CLASSIFICATION_KINDS,
  POS_CLASSIFICATION_LABELS,
  POS_CLASSIFICATION_TITLES,
  posClassificationChips,
  productClassifications,
  productHasClassification,
  type PosClassificationKind,
} from "@/lib/pos/classification-search-core";
import {
  LIMIT_BUCKET_LABELS,
  LOW_THC_UNIT_MAX_MG,
  MEDICAL_LIMITS,
  RECREATIONAL_LIMITS,
  lineBucket,
} from "@/lib/compliance/sales-limits-core";
import { filterMenuProducts } from "@/lib/pos/sale-grid-core";
import type { PosMenuProduct } from "@/lib/pos/sale-flow-core";

/** A realistic register product; overrides shadow the ordinary defaults. */
function prod(over: Partial<PosMenuProduct> = {}): PosMenuProduct {
  return {
    productId: "p1",
    variantId: "v1",
    name: "Blue Dream",
    brand: "Farm",
    category: "flower",
    categories: ["flower"],
    variantLabel: "3.5g",
    regularPriceMinor: 3000,
    costMinorUnits: null,
    inventoryStatus: "in-stock",
    ...over,
  };
}

const DRINK = prod({
  productId: "d",
  variantId: "d1",
  name: "Low-THC Seltzer",
  category: "edible-liquid",
  categories: ["edible-liquid"],
  variantLabel: "12oz",
  lowThcLiquid: true,
  unitThcMg: 4,
});

const SUPP = prod({
  productId: "s",
  variantId: "s1",
  name: "Relief Insert",
  category: "topical",
  categories: ["topical"],
  variantLabel: "6ct",
  otherwiseTaken: true,
  unitsPerPackage: 6,
});

const FLOWER = prod({ productId: "f", variantId: "f1" });

describe("18D — productHasClassification delegates to the register's predicates", () => {
  it("marks a product only when the limit meter would agree", () => {
    expect(productHasClassification(DRINK, "low_thc_liquid")).toBe(true);
    expect(productHasClassification(SUPP, "otherwise_taken")).toBe(true);
    expect(productHasClassification(FLOWER, "low_thc_liquid")).toBe(false);
    expect(productHasClassification(FLOWER, "otherwise_taken")).toBe(false);
  });

  /**
   * THE CENTRAL AGREEMENT. For every product, wearing a marker must mean the
   * cart line for that product routes to that bucket. If these two could ever
   * disagree, the register would be showing a budtender an allowance the till
   * refuses to honour.
   */
  it("a marker and the cart line's bucket are the same fact", () => {
    const cases: PosMenuProduct[] = [
      DRINK,
      SUPP,
      FLOWER,
      prod({ category: "edible-liquid", lowThcLiquid: true, unitThcMg: 4 }),
      prod({ category: "edible-liquid", lowThcLiquid: true, unitThcMg: 5 }),
      prod({ category: "edible-liquid", lowThcLiquid: true }),
      prod({ category: "topical", otherwiseTaken: true, unitsPerPackage: 2 }),
      prod({ category: "topical" }),
      prod({ category: "concentrate", otherwiseTaken: true }),
    ];

    let marked = 0;
    for (const p of cases) {
      const bucket = lineBucket({
        category: p.category,
        quantity: 1,
        lowThcLiquid: p.lowThcLiquid ?? null,
        unitThcMg: p.unitThcMg ?? null,
        otherwiseTaken: p.otherwiseTaken ?? null,
        unitsPerPackage: p.unitsPerPackage ?? null,
      });
      for (const kind of POS_CLASSIFICATION_KINDS) {
        const wearsMarker = productHasClassification(p, kind);
        if (wearsMarker) marked += 1;
        // The one asymmetry worth stating precisely: lineBucket resolves a
        // dual-flagged product to otherwise_taken, so a product CAN legitimately
        // satisfy low_thc_liquid while bucketing as otherwise_taken. What must
        // never happen is a marker on a product the predicate refuses.
        if (wearsMarker) {
          expect(["low_thc_liquid", "otherwise_taken"]).toContain(bucket);
        }
        if (!wearsMarker && bucket === kind) {
          throw new Error(`bucket says ${kind} but no marker was shown`);
        }
      }
    }
    // ANTI-VACUITY: the loop actually exercised positive cases.
    expect(marked).toBeGreaterThan(2);
  });

  it.each([
    ["flag but no mg", prod({ category: "edible-liquid", lowThcLiquid: true }), "low_thc_liquid"],
    ["over the ceiling", prod({ category: "edible-liquid", lowThcLiquid: true, unitThcMg: 5 }), "low_thc_liquid"],
    ["zero mg", prod({ category: "edible-liquid", lowThcLiquid: true, unitThcMg: 0 }), "low_thc_liquid"],
    ["negative mg", prod({ category: "edible-liquid", lowThcLiquid: true, unitThcMg: -1 }), "low_thc_liquid"],
    ["wrong bucket", prod({ category: "flower", lowThcLiquid: true, unitThcMg: 4 }), "low_thc_liquid"],
    ["flagged flower", prod({ category: "flower", otherwiseTaken: true }), "otherwise_taken"],
    ["flagged concentrate", prod({ category: "concentrate", otherwiseTaken: true }), "otherwise_taken"],
  ] as [string, PosMenuProduct, PosClassificationKind][])(
    "refuses to mark a flagged-but-non-qualifying product: %s",
    (_label, product, kind) => {
      expect(productHasClassification(product, kind)).toBe(false);
      expect(productClassifications(product)).not.toContain(kind);
    },
  );

  it("honours the statutory ceiling exactly (<= 4 mg, not < 4 mg)", () => {
    const at = prod({ category: "edible-liquid", lowThcLiquid: true, unitThcMg: LOW_THC_UNIT_MAX_MG });
    const over = prod({
      category: "edible-liquid",
      lowThcLiquid: true,
      unitThcMg: LOW_THC_UNIT_MAX_MG + 0.01,
    });
    expect(productHasClassification(at, "low_thc_liquid")).toBe(true);
    expect(productHasClassification(over, "low_thc_liquid")).toBe(false);
    // Pin the constant itself so a silent widening of the statute is caught.
    expect(LOW_THC_UNIT_MAX_MG).toBe(4);
  });

  it("requires a literal true, so an intake bug cannot widen an allowance", () => {
    const stringy = prod({
      category: "topical",
      otherwiseTaken: "true" as unknown as boolean,
      unitsPerPackage: 6,
    });
    const numeric = prod({
      category: "edible-liquid",
      lowThcLiquid: 1 as unknown as boolean,
      unitThcMg: 4,
    });
    expect(productHasClassification(stringy, "otherwise_taken")).toBe(false);
    expect(productHasClassification(numeric, "low_thc_liquid")).toBe(false);
  });
});

describe("18D — silence is never a negative claim", () => {
  /**
   * The flags are OPTIONAL on PosMenuProduct precisely so a bundle cached
   * before SLICE 16/17 still parses. So "no flags" is indistinguishable from
   * "not classified yet" — and for otherwiseTaken the missing flag is the
   * PERMISSIVE direction. The register must therefore say nothing, not
   * "ordinary".
   */
  it("a stale bundle produces no lanes rather than a false ordinary claim", () => {
    const staleDrink = prod({ category: "edible-liquid", categories: ["edible-liquid"] });
    const staleSupp = prod({ category: "topical", categories: ["topical"] });
    expect(productClassifications(staleDrink)).toEqual([]);
    expect(productClassifications(staleSupp)).toEqual([]);
    // And nothing anywhere in the API returns a "not classified" label that a
    // UI could render as a positive statement.
    expect(Object.values(POS_CLASSIFICATION_LABELS)).not.toContain("Ordinary");
    expect(Object.values(POS_CLASSIFICATION_LABELS)).not.toContain("Unclassified");
  });

  it("an empty product does not crash and claims nothing", () => {
    expect(productClassifications({} as PosMenuProduct)).toEqual([]);
    expect(posClassificationChips([])).toEqual([]);
  });
});

describe("18D — lanes and chips", () => {
  it("reports lanes in a stable order, not input order", () => {
    const dual = prod({
      category: "topical",
      otherwiseTaken: true,
      lowThcLiquid: true,
      unitThcMg: 4,
    });
    expect(productClassifications(dual)).toEqual(["low_thc_liquid", "otherwise_taken"]);
    expect(POS_CLASSIFICATION_KINDS).toEqual(["low_thc_liquid", "otherwise_taken"]);
  });

  it("omits a lane with no qualifying stock instead of showing a zero chip", () => {
    const chips = posClassificationChips([FLOWER, SUPP]);
    expect(chips).toHaveLength(1);
    expect(chips[0]?.kind).toBe("otherwise_taken");
    expect(chips.every((c) => c.count > 0)).toBe(true);
  });

  it("counts each lane accurately and never double-counts within one lane", () => {
    const chips = posClassificationChips([FLOWER, DRINK, DRINK, DRINK, SUPP]);
    expect(chips.map((c) => [c.kind, c.count])).toEqual([
      ["low_thc_liquid", 3],
      ["otherwise_taken", 1],
    ]);
  });

  it("does not conjure a chip from a flagged-but-non-qualifying product", () => {
    const bogus = prod({ category: "edible-liquid", lowThcLiquid: true, unitThcMg: 99 });
    expect(posClassificationChips([bogus, FLOWER])).toEqual([]);
  });

  it("shows no chips at all for an ordinary menu", () => {
    expect(posClassificationChips([FLOWER, prod({ category: "edibles" })])).toEqual([]);
  });
});

describe("18D — labels are honest and register-appropriate", () => {
  it("keeps chip labels short and puts the statutory phrasing in the title", () => {
    for (const kind of POS_CLASSIFICATION_KINDS) {
      const label = POS_CLASSIFICATION_LABELS[kind];
      const title = POS_CLASSIFICATION_TITLES[kind];
      expect(label.trim()).not.toBe("");
      expect(label.length).toBeLessThanOrEqual(12);
      expect(title.length).toBeGreaterThan(label.length);
    }
  });

  /**
   * The titles must DERIVE from the shared limit vocabulary rather than be
   * retyped, so the register and the limit meter cannot describe the same
   * bucket two different ways.
   */
  it("derives titles from LIMIT_BUCKET_LABELS, not a private copy", () => {
    expect(POS_CLASSIFICATION_TITLES.low_thc_liquid).toBe(LIMIT_BUCKET_LABELS.low_thc_liquid);
    expect(POS_CLASSIFICATION_TITLES.otherwise_taken).toBe(LIMIT_BUCKET_LABELS.otherwise_taken);
  });

  it("never promises a quantity on a chip", () => {
    for (const label of Object.values(POS_CLASSIFICATION_LABELS)) {
      expect(label).not.toMatch(/\d/);
    }
  });

  /**
   * These are the ONLY two buckets that do not triple for a medical patient.
   * A register label that implied a medical multiple would be wrong, so this
   * pins the underlying fact the copy depends on.
   */
  it("pins that neither bucket triples for medical", () => {
    expect(MEDICAL_LIMITS.low_thc_liquid).toBe(RECREATIONAL_LIMITS.low_thc_liquid);
    expect(MEDICAL_LIMITS.otherwise_taken).toBe(RECREATIONAL_LIMITS.otherwise_taken);
    // And a control: a bucket that DOES triple, so the assertion above is not
    // passing because every bucket happens to be equal.
    expect(MEDICAL_LIMITS.usable).toBe(RECREATIONAL_LIMITS.usable * 3);
  });
});

describe("18D — filterMenuProducts keeps every promise it already made", () => {
  const menu = [DRINK, SUPP, FLOWER, prod({ productId: "x", variantId: "x1", name: "Strong Drink", category: "edible-liquid", lowThcLiquid: true, unitThcMg: 99 })];

  it("behaves identically when the new argument is omitted", () => {
    expect(filterMenuProducts(menu, "", null)).toHaveLength(4);
    expect(filterMenuProducts(menu, "", null, null)).toHaveLength(4);
    expect(filterMenuProducts(menu, "", "flower")).toHaveLength(1);
    expect(filterMenuProducts(menu, "blue", null)).toHaveLength(1);
  });

  it("narrows to exactly the products the register would route to the bucket", () => {
    const low = filterMenuProducts(menu, "", null, "low_thc_liquid");
    expect(low.map((p) => p.variantId)).toEqual(["d1"]);
    const oth = filterMenuProducts(menu, "", null, "otherwise_taken");
    expect(oth.map((p) => p.variantId)).toEqual(["s1"]);
  });

  it("excludes a flagged product the meter would not honour", () => {
    const low = filterMenuProducts(menu, "", null, "low_thc_liquid");
    expect(low.map((p) => p.variantId)).not.toContain("x1");
  });

  it("composes with the category chip and the search query", () => {
    expect(filterMenuProducts(menu, "", "topical", "otherwise_taken")).toHaveLength(1);
    expect(filterMenuProducts(menu, "", "flower", "otherwise_taken")).toHaveLength(0);
    expect(filterMenuProducts(menu, "seltzer", null, "low_thc_liquid")).toHaveLength(1);
    expect(filterMenuProducts(menu, "zzzznope", null, "low_thc_liquid")).toHaveLength(0);
  });

  it("returns an empty grid for a lane with no stock, not the whole menu", () => {
    expect(filterMenuProducts([FLOWER], "", null, "low_thc_liquid")).toHaveLength(0);
  });

  it("does not mutate the array it was given", () => {
    const input = [...menu];
    filterMenuProducts(input, "", null, "low_thc_liquid");
    expect(input).toHaveLength(4);
    expect(input.map((p) => p.variantId)).toEqual(["d1", "s1", "f1", "x1"]);
  });
});
