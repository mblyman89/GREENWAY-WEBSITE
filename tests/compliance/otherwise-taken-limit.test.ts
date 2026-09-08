/**
 * tests/compliance/otherwise-taken-limit.test.ts
 *
 * SLICE 17 — the "otherwise taken into the body" ten-unit transaction limit.
 *
 * WAC 314-55-095(1)(d)(i)(D), verbatim:
 *   "(D) Ten units of a cannabis-infused product otherwise taken into the body;"
 *
 * WAC 314-55-010(40), verbatim:
 *   "'Product(s) otherwise taken into the body' means a cannabis-infused product
 *    for human consumption or ingestion intended for uses other than inhalation,
 *    oral ingestion, or external application to the skin."
 *
 * RCW 69.50.101, verbatim:
 *   "'Unit' means an individual consumable item within a package of one or more
 *    consumable items..."
 *   "'Package' means a container that has a single unit or group of units."
 *
 * These tests are written RED-first, before the implementation.
 */
import { describe, expect, it } from "vitest";
import {
  LIMIT_BUCKETS,
  LIMIT_BUCKET_LABELS,
  LIMIT_BUCKET_UNITS,
  MEDICAL_LIMITS,
  RECREATIONAL_LIMITS,
  clampLimitProfile,
  evaluateCart,
  formatLimitAmount,
  isThcBucket,
  isUnitCountBucket,
  lineBucket,
  lineUnits,
  qualifiesAsOtherwiseTaken,
  suspectsOtherwiseTaken,
  type LimitCartLine,
} from "@/lib/compliance/sales-limits-core";

/** A flagged suppository line. */
function supp(over: Partial<LimitCartLine> = {}): LimitCartLine {
  return {
    category: "topical",
    quantity: 1,
    otherwiseTaken: true,
    unitsPerPackage: 1,
    ...over,
  };
}

describe("SLICE 17 — the sixth bucket exists and is unit-counted", () => {
  it("otherwise_taken is a real bucket in the canonical list", () => {
    expect(LIMIT_BUCKETS).toContain("otherwise_taken");
  });

  it("there are now exactly six buckets", () => {
    expect(LIMIT_BUCKETS).toHaveLength(6);
  });

  it("the bucket is denominated in UNITS, not grams and not mg", () => {
    expect(LIMIT_BUCKET_UNITS.otherwise_taken).toBe("units");
    expect(isThcBucket("otherwise_taken")).toBe(false);
    expect(isUnitCountBucket("otherwise_taken")).toBe(true);
  });

  it("no other bucket claims the units denomination", () => {
    const unitCount = LIMIT_BUCKETS.filter((b) => LIMIT_BUCKET_UNITS[b] === "units");
    expect(unitCount).toEqual(["otherwise_taken"]);
  });

  it("has a human label that does not pretend to be a weight", () => {
    const label = LIMIT_BUCKET_LABELS.otherwise_taken;
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toMatch(/\boz\b|\bounce/i);
  });
});

describe("SLICE 17 — the statutory figure is ten, for BOTH customer types", () => {
  it("recreational is ten units — WAC 314-55-095(1)(d)(i)(D)", () => {
    expect(RECREATIONAL_LIMITS.otherwise_taken).toBe(10);
  });

  it("medical is ALSO ten — WAC 314-55-095(2)(d) does not list this category", () => {
    expect(MEDICAL_LIMITS.otherwise_taken).toBe(10);
  });

  it("medical is NOT tripled to thirty", () => {
    expect(MEDICAL_LIMITS.otherwise_taken).not.toBe(30);
    expect(MEDICAL_LIMITS.otherwise_taken / RECREATIONAL_LIMITS.otherwise_taken).toBe(1);
  });

  it("every GRAM bucket still triples — the non-tripling is specific, not a bug", () => {
    for (const bucket of LIMIT_BUCKETS) {
      if (LIMIT_BUCKET_UNITS[bucket] !== "g") continue;
      expect(MEDICAL_LIMITS[bucket] / RECREATIONAL_LIMITS[bucket]).toBe(3);
    }
  });

  it("exactly two buckets refuse to triple: low_thc_liquid and otherwise_taken", () => {
    const flat = LIMIT_BUCKETS.filter(
      (b) => MEDICAL_LIMITS[b] === RECREATIONAL_LIMITS[b],
    );
    expect([...flat].sort()).toEqual(["low_thc_liquid", "otherwise_taken"]);
  });
});

describe("SLICE 17 — formatting renders units, never a weight", () => {
  it("formats as units", () => {
    expect(formatLimitAmount("otherwise_taken", 10)).toBe("10 units");
  });

  it("singular reads naturally", () => {
    expect(formatLimitAmount("otherwise_taken", 1)).toBe("1 unit");
  });

  it("zero is plural", () => {
    expect(formatLimitAmount("otherwise_taken", 0)).toBe("0 units");
  });

  it("NEVER renders the ten-unit cap as ounces or grams or mg", () => {
    const out = formatLimitAmount("otherwise_taken", 10);
    expect(out).not.toMatch(/oz|gram|\bg\b|mg/i);
  });

  it("the other buckets are unaffected by the new unit type", () => {
    expect(formatLimitAmount("concentrate", 7)).toBe("7 g");
    expect(formatLimitAmount("low_thc_liquid", 200)).toBe("200 mg THC");
    expect(formatLimitAmount("usable", 28)).toBe("1 oz");
  });
});

describe("SLICE 17 — qualification is explicit and fails safe to NOT qualifying", () => {
  it("a flagged suppository qualifies", () => {
    expect(qualifiesAsOtherwiseTaken(supp())).toBe(true);
  });

  it("an unflagged topical does NOT qualify", () => {
    expect(qualifiesAsOtherwiseTaken(supp({ otherwiseTaken: false }))).toBe(false);
  });

  it("a null flag does NOT qualify — unknown never unlocks a different bucket", () => {
    expect(qualifiesAsOtherwiseTaken(supp({ otherwiseTaken: null }))).toBe(false);
  });

  it("an absent flag does NOT qualify", () => {
    const line: LimitCartLine = { category: "topical", quantity: 1 };
    expect(qualifiesAsOtherwiseTaken(line)).toBe(false);
  });

  it("a truthy-but-not-true value does NOT qualify (no loose coercion)", () => {
    for (const junk of ["true", 1, {}, [], "yes"]) {
      const line = supp({ otherwiseTaken: junk as unknown as boolean });
      expect(qualifiesAsOtherwiseTaken(line)).toBe(false);
    }
  });

  it("flower flagged by mistake does NOT qualify — flower is inhaled/usable", () => {
    expect(qualifiesAsOtherwiseTaken(supp({ category: "flower" }))).toBe(false);
  });

  it("a concentrate flagged by mistake does NOT qualify", () => {
    expect(qualifiesAsOtherwiseTaken(supp({ category: "concentrate" }))).toBe(false);
  });

  it("a solid edible flagged by mistake does NOT qualify — that is oral ingestion", () => {
    expect(qualifiesAsOtherwiseTaken(supp({ category: "edible-solid" }))).toBe(false);
  });

  it("a null category does NOT qualify", () => {
    expect(qualifiesAsOtherwiseTaken(supp({ category: null }))).toBe(false);
  });
});

describe("SLICE 17 — unit counting follows RCW 69.50.101", () => {
  it("one suppository is one unit", () => {
    expect(lineUnits(supp({ quantity: 1 }))).toBe(1);
  });

  it("a box of six is SIX units, not one package", () => {
    expect(lineUnits(supp({ quantity: 1, unitsPerPackage: 6 }))).toBe(6);
  });

  it("two boxes of six is twelve units", () => {
    expect(lineUnits(supp({ quantity: 2, unitsPerPackage: 6 }))).toBe(12);
  });

  it("unitsPerPackage defaults to 1 when absent", () => {
    const line: LimitCartLine = {
      category: "topical",
      quantity: 3,
      otherwiseTaken: true,
    };
    expect(lineUnits(line)).toBe(3);
  });

  it("a non-qualifying line contributes ZERO units", () => {
    expect(lineUnits(supp({ otherwiseTaken: false, quantity: 5 }))).toBe(0);
  });

  it("negative quantity contributes zero, never a negative credit", () => {
    expect(lineUnits(supp({ quantity: -4 }))).toBe(0);
  });

  it("fractional units are floored — you cannot sell half a suppository", () => {
    expect(lineUnits(supp({ quantity: 2.7 }))).toBe(2);
  });

  it("a fractional unitsPerPackage is floored too", () => {
    expect(lineUnits(supp({ quantity: 1, unitsPerPackage: 6.9 }))).toBe(6);
  });

  it("a zero or negative unitsPerPackage falls back to 1, never zero", () => {
    expect(lineUnits(supp({ quantity: 2, unitsPerPackage: 0 }))).toBe(2);
    expect(lineUnits(supp({ quantity: 2, unitsPerPackage: -3 }))).toBe(2);
  });

  it("NaN quantity contributes zero", () => {
    expect(lineUnits(supp({ quantity: Number.NaN }))).toBe(0);
  });
});

describe("SLICE 17 — routing: the flagged line leaves the liquid bucket entirely", () => {
  it("lineBucket sends a flagged suppository to otherwise_taken", () => {
    expect(lineBucket(supp())).toBe("otherwise_taken");
  });

  it("lineBucket leaves an UNflagged topical in liquid_edible", () => {
    expect(lineBucket(supp({ otherwiseTaken: false }))).toBe("liquid_edible");
  });

  it("a flagged suppository contributes NOTHING to the 72 oz liquid bucket", () => {
    const res = evaluateCart([supp({ quantity: 4 })], "recreational");
    const liquid = res.buckets.find((b) => b.bucket === "liquid_edible")!;
    const other = res.buckets.find((b) => b.bucket === "otherwise_taken")!;
    expect(liquid.used).toBe(0);
    expect(other.used).toBe(4);
  });

  it("a balm (unflagged topical) still counts toward the 72 oz liquid bucket", () => {
    const res = evaluateCart([supp({ otherwiseTaken: false, quantity: 1 })], "recreational");
    const liquid = res.buckets.find((b) => b.bucket === "liquid_edible")!;
    expect(liquid.used).toBeGreaterThan(0);
  });

  it("the two buckets are mutually exclusive across a mixed cart", () => {
    const res = evaluateCart(
      [supp({ quantity: 3 }), supp({ otherwiseTaken: false, quantity: 2 })],
      "recreational",
    );
    expect(res.buckets.find((b) => b.bucket === "otherwise_taken")!.used).toBe(3);
    // SLICE L4 — millilitres. 56 g carried across at its ounce-count
    // (2 oz -> 59.147 ml). The POINT of this assertion is unchanged: the
    // flagged suppository contributes NOTHING here and only the ordinary
    // liquid line lands in this bucket.
    expect(res.buckets.find((b) => b.bucket === "liquid_edible")!.used).toBeCloseTo(
      (56 / 28) * 29.5735,
      3,
    );
  });
});

describe("SLICE 17 — the ten-unit boundary blocks correctly", () => {
  it("ten units is allowed — the limit is inclusive", () => {
    const res = evaluateCart([supp({ quantity: 10 })], "recreational");
    expect(res.blocked).toBe(false);
    expect(res.buckets.find((b) => b.bucket === "otherwise_taken")!.exceeded).toBe(false);
  });

  it("eleven units is BLOCKED", () => {
    const res = evaluateCart([supp({ quantity: 11 })], "recreational");
    expect(res.blocked).toBe(true);
    expect(res.buckets.find((b) => b.bucket === "otherwise_taken")!.exceeded).toBe(true);
  });

  it("a medical patient is blocked at exactly the same place — no enhancement", () => {
    expect(evaluateCart([supp({ quantity: 10 })], "medical").blocked).toBe(false);
    expect(evaluateCart([supp({ quantity: 11 })], "medical").blocked).toBe(true);
  });

  it("two boxes of six (12 units) is blocked even though it is only two items", () => {
    const res = evaluateCart([supp({ quantity: 2, unitsPerPackage: 6 })], "recreational");
    expect(res.blocked).toBe(true);
    expect(res.buckets.find((b) => b.bucket === "otherwise_taken")!.used).toBe(12);
  });

  it("the reason string is written in UNITS and names the overage", () => {
    const res = evaluateCart([supp({ quantity: 13 })], "recreational");
    const reason = res.reasons.join(" ");
    expect(reason).toMatch(/13 units/);
    expect(reason).toMatch(/10 units/);
    expect(reason).toMatch(/over by 3 units/);
    expect(reason).not.toMatch(/oz|mg/i);
  });

  it("units accumulate across separate lines", () => {
    const res = evaluateCart(
      [supp({ quantity: 6 }), supp({ quantity: 5 })],
      "recreational",
    );
    expect(res.buckets.find((b) => b.bucket === "otherwise_taken")!.used).toBe(11);
    expect(res.blocked).toBe(true);
  });

  it("usedLabel and maxLabel are unit-denominated", () => {
    const res = evaluateCart([supp({ quantity: 4 })], "recreational");
    const b = res.buckets.find((x) => x.bucket === "otherwise_taken")!;
    expect(b.usedLabel).toBe("4 units");
    expect(b.maxLabel).toBe("10 units");
  });
});

describe("SLICE 17 — the owner may tighten but never widen", () => {
  it("clamp accepts a tighter recreational figure", () => {
    const p = clampLimitProfile(
      { ...RECREATIONAL_LIMITS, otherwise_taken: 5 },
      RECREATIONAL_LIMITS,
    );
    expect(p.otherwise_taken).toBe(5);
  });

  it("clamp REFUSES to widen past the statutory ten", () => {
    const p = clampLimitProfile(
      { ...RECREATIONAL_LIMITS, otherwise_taken: 99 },
      RECREATIONAL_LIMITS,
    );
    expect(p.otherwise_taken).toBe(10);
  });

  it("clamp refuses to widen the MEDICAL figure past ten either", () => {
    const p = clampLimitProfile({ ...MEDICAL_LIMITS, otherwise_taken: 30 }, MEDICAL_LIMITS);
    expect(p.otherwise_taken).toBe(10);
  });

  it("garbage falls back to the statutory figure", () => {
    const p = clampLimitProfile(
      { ...RECREATIONAL_LIMITS, otherwise_taken: Number.NaN },
      RECREATIONAL_LIMITS,
    );
    expect(p.otherwise_taken).toBe(10);
  });

  // ── The count buckets must stay WHOLE ────────────────────────────────────
  //
  // Migration 0217 puts a `= floor(...)` CHECK on both settings columns, so a
  // fractional cap cannot be written through the back office. But
  // clampLimitProfile takes `raw: unknown` and is the choke point for values
  // arriving from anywhere else — a legacy row written before the constraint
  // existed, a hand-edited JSON override, a future import path. Defence in
  // depth: the constraint guards the write, the clamp guards the read.
  //
  // A fractional ceiling is not a cosmetic problem. With a cap of 10.5 a cart
  // of 10 units is under and 11 is over, so the effective limit is 10 — but
  // the SCREEN says "10.5 units", and a budtender who trusts the screen will
  // argue with a customer they cannot satisfy. Worse, it renders a COUNT of
  // physical items as a fraction, which is nonsense on its face.
  it("clamp FLOORS a fractional recreational cap to a whole number of units", () => {
    const p = clampLimitProfile(
      { ...RECREATIONAL_LIMITS, otherwise_taken: 7.9 },
      RECREATIONAL_LIMITS,
    );
    expect(p.otherwise_taken).toBe(7);
    expect(Number.isInteger(p.otherwise_taken)).toBe(true);
  });

  it("clamp FLOORS a fractional medical cap too", () => {
    const p = clampLimitProfile({ ...MEDICAL_LIMITS, otherwise_taken: 3.5 }, MEDICAL_LIMITS);
    expect(p.otherwise_taken).toBe(3);
  });

  it("flooring never rounds UP into a wider limit than the owner asked for", () => {
    // 9.99 must become 9, not 10. Rounding would hand back a unit the owner
    // deliberately took away.
    const p = clampLimitProfile(
      { ...RECREATIONAL_LIMITS, otherwise_taken: 9.99 },
      RECREATIONAL_LIMITS,
    );
    expect(p.otherwise_taken).toBe(9);
  });

  it("a fractional cap below 1 collapses to the statutory figure, never to zero", () => {
    // clamp() already treats <= 0 as garbage, but 0.4 is > 0 and finite, so it
    // survives that guard and reaches the floor — where it would become 0. A
    // zero cap would block EVERY suppository sale in the shop, which is not a
    // limit, it is an outage. It must fall back to the statute instead.
    const p = clampLimitProfile(
      { ...RECREATIONAL_LIMITS, otherwise_taken: 0.4 },
      RECREATIONAL_LIMITS,
    );
    expect(p.otherwise_taken).toBe(10);
  });

  it("the WEIGHT buckets are NOT floored — 0.5 g is a real quantity", () => {
    // Proof the floor is targeted, not a blanket integer cast. Flooring grams
    // would silently destroy every fractional gram limit in the system.
    const p = clampLimitProfile(
      { ...RECREATIONAL_LIMITS, concentrate: 6.5 },
      RECREATIONAL_LIMITS,
    );
    expect(p.concentrate).toBe(6.5);
  });

  it("every unit-count bucket in the profile is a whole number after clamping", () => {
    // Derived, so a SEVENTH bucket added later cannot skip this rule silently.
    const fractional = Object.fromEntries(
      LIMIT_BUCKETS.map((b) => [b, RECREATIONAL_LIMITS[b] - 0.5]),
    );
    const p = clampLimitProfile(fractional, RECREATIONAL_LIMITS);
    for (const b of LIMIT_BUCKETS) {
      if (isUnitCountBucket(b)) {
        expect(Number.isInteger(p[b]), `${b} clamped to a fractional count`).toBe(true);
      }
    }
  });
});

describe("SLICE 17 — the suspicion detector makes the silent gap visible", () => {
  it("flags a product whose NAME says suppository", () => {
    expect(suspectsOtherwiseTaken({ name: "Relief Suppository 10mg" })).toBe(true);
  });

  it("is case insensitive and matches plurals", () => {
    expect(suspectsOtherwiseTaken({ name: "SUPPOSITORIES 6pk" })).toBe(true);
  });

  it("flags on the CCRS inventory type", () => {
    expect(
      suspectsOtherwiseTaken({ name: "Wellness Insert", inventoryType: "Suppository" }),
    ).toBe(true);
  });

  it("does NOT flag a transdermal patch — skin application is EXCLUDED by 010(40)", () => {
    expect(suspectsOtherwiseTaken({ name: "Transdermal Patch 20mg" })).toBe(false);
    expect(suspectsOtherwiseTaken({ name: "Patch", inventoryType: "Transdermal" })).toBe(false);
  });

  it("does NOT flag a sublingual tincture — oral ingestion is EXCLUDED by 010(40)", () => {
    expect(suspectsOtherwiseTaken({ name: "Sublingual Tincture 1oz" })).toBe(false);
  });

  it("does NOT flag ordinary topicals", () => {
    for (const name of ["Lavender Balm", "Cooling Lotion", "Muscle Salve", "Bath Salts"]) {
      expect(suspectsOtherwiseTaken({ name })).toBe(false);
    }
  });

  it("does NOT flag flower or edibles", () => {
    expect(suspectsOtherwiseTaken({ name: "Blue Dream 3.5g" })).toBe(false);
    expect(suspectsOtherwiseTaken({ name: "Watermelon Gummies" })).toBe(false);
  });

  it("tolerates null/empty input without throwing", () => {
    expect(suspectsOtherwiseTaken({ name: null })).toBe(false);
    expect(suspectsOtherwiseTaken({ name: "" })).toBe(false);
    expect(suspectsOtherwiseTaken({})).toBe(false);
  });

  it("evaluateCart WARNS when a suspicious line was never classified", () => {
    const res = evaluateCart(
      [{ category: "topical", quantity: 1, name: "Relief Suppository 10mg" }],
      "recreational",
    );
    expect(res.warnings.join(" ")).toMatch(/suppositor/i);
  });

  it("the warning does NOT block the sale — a name regex must never block", () => {
    const res = evaluateCart(
      [{ category: "topical", quantity: 1, name: "Relief Suppository 10mg" }],
      "recreational",
    );
    expect(res.blocked).toBe(false);
  });

  it("a CLASSIFIED suppository produces NO warning — the question was answered", () => {
    const res = evaluateCart(
      [{ ...supp(), name: "Relief Suppository 10mg" }],
      "recreational",
    );
    expect(res.warnings.join(" ")).not.toMatch(/suppositor/i);
  });

  it("an explicit NO also silences the warning — 'someone looked and said no' counts", () => {
    const res = evaluateCart(
      [
        {
          category: "topical",
          quantity: 1,
          name: "Relief Suppository 10mg",
          otherwiseTaken: false,
        },
      ],
      "recreational",
    );
    expect(res.warnings.join(" ")).not.toMatch(/suppositor/i);
  });
});
