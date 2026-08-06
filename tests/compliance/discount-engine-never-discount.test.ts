/**
 * tests/compliance/discount-engine-never-discount.test.ts  (PR-P4)
 *
 * GLOBAL NEVER-DISCOUNT LIST — the pricing proof.
 *
 * PR-P4 adds an owner-managed global "never discount" list: any product on it
 * must be sold at its TRUE regular price by EVERY promotion path — the POS
 * register, the online cart, daily deals, and every hand-built promotion —
 * with NO exceptions. The rule mirrors the engine's core principle,
 * "Exclusions win": a never-discount key beats every rule, every storewide
 * sale, and every priority.
 *
 * The enforcement is a single pure transform, applyNeverDiscount, which folds
 * the protected keys into every rule's excludeProductKeys before evaluation,
 * plus an optional third parameter to computePromotions that applies it
 * automatically. This suite pins that transform and its effect end-to-end so
 * the guarantee can never silently drift.
 *
 * Fail-safe by design: an empty list is a pure no-op (existing carts and every
 * prior test are unaffected), so a missing/unapplied migration cannot change
 * a single price.
 */
import { describe, it, expect } from "vitest";
import {
  applyNeverDiscount,
  computePromotions,
  type EngineCartLine,
  type EngineRule,
} from "@/lib/promotions/discount-engine-core";

// ---------------------------------------------------------------------------
// Builders — minimal, explicit, exactly the shape the engine consumes.
// ---------------------------------------------------------------------------

function line(over: Partial<EngineCartLine> = {}): EngineCartLine {
  return {
    lineId: over.lineId ?? "L1",
    regularPriceMinorUnits: over.regularPriceMinorUnits ?? 5000,
    quantity: over.quantity ?? 1,
    categories: over.categories ?? ["flower"],
    brand: over.brand ?? "Acme",
    productKey: over.productKey ?? "PK-1",
    variantLabel: over.variantLabel ?? "3.5g",
    costMinorUnits: over.costMinorUnits ?? null,
  };
}

function rule(over: Partial<EngineRule> = {}): EngineRule {
  return {
    id: over.id ?? "R1",
    title: over.title ?? "Test rule",
    discountType: over.discountType ?? "percent",
    discountPercent: over.discountPercent ?? 20,
    discountFixed: over.discountFixed ?? 0,
    priority: over.priority ?? 0,
    storewide: over.storewide ?? true,
    targetCategories: over.targetCategories ?? [],
    targetBrands: over.targetBrands ?? [],
    targetProductKeys: over.targetProductKeys ?? [],
    excludeCategories: over.excludeCategories ?? [],
    excludeBrands: over.excludeBrands ?? [],
    excludeProductKeys: over.excludeProductKeys ?? [],
    config: over.config ?? {},
  };
}

// ---------------------------------------------------------------------------
// applyNeverDiscount — the pure transform.
// ---------------------------------------------------------------------------

describe("applyNeverDiscount (pure transform)", () => {
  it("is a no-op when the list is empty (returns the same array reference)", () => {
    const rules = [rule()];
    expect(applyNeverDiscount(rules, [])).toBe(rules);
  });

  it("is a no-op when the list is only blanks (whitespace filtered out)", () => {
    const rules = [rule()];
    expect(applyNeverDiscount(rules, ["", "   "])).toBe(rules);
  });

  it("folds the keys into EVERY rule's excludeProductKeys", () => {
    const rules = [
      rule({ id: "A", excludeProductKeys: ["EXISTING"] }),
      rule({ id: "B", excludeProductKeys: [] }),
    ];
    const out = applyNeverDiscount(rules, ["PK-1", "PK-2"]);
    expect(out[0].excludeProductKeys).toEqual(
      expect.arrayContaining(["EXISTING", "PK-1", "PK-2"]),
    );
    expect(out[1].excludeProductKeys).toEqual(
      expect.arrayContaining(["PK-1", "PK-2"]),
    );
  });

  it("dedups keys and trims surrounding whitespace", () => {
    const out = applyNeverDiscount([rule({ excludeProductKeys: ["PK-1"] })], [
      "PK-1",
      " PK-1 ",
      "PK-2",
      "PK-2",
    ]);
    const keys = out[0].excludeProductKeys;
    // PK-1 already present + PK-2 added once (no duplicates).
    expect(keys.filter((k) => k === "PK-1")).toHaveLength(1);
    expect(keys.filter((k) => k === "PK-2")).toHaveLength(1);
  });

  it("does NOT mutate the input rules", () => {
    const input = [rule({ excludeProductKeys: [] })];
    const snapshotBefore = [...input[0].excludeProductKeys];
    applyNeverDiscount(input, ["PK-9"]);
    expect(input[0].excludeProductKeys).toEqual(snapshotBefore);
  });
});

// ---------------------------------------------------------------------------
// computePromotions — end-to-end enforcement via the optional 3rd param.
// ---------------------------------------------------------------------------

describe("computePromotions honours the never-discount list", () => {
  it("keeps a protected product at TRUE regular price against a storewide sale", () => {
    const lines = [line({ productKey: "PK-PROTECTED", regularPriceMinorUnits: 5000 })];
    const rules = [rule({ storewide: true, discountPercent: 30 })];

    // Without protection: the storewide 30% applies.
    const unprotected = computePromotions(lines, rules);
    expect(unprotected.lines[0].unitPriceMinorUnits).toBeLessThan(5000);

    // With protection: full regular price, zero savings.
    const protectedResult = computePromotions(lines, rules, ["PK-PROTECTED"]);
    expect(protectedResult.lines[0].unitPriceMinorUnits).toBe(5000);
    expect(protectedResult.lines[0].unitSavingsMinorUnits).toBe(0);
    expect(protectedResult.totalSavingsMinorUnits).toBe(0);
  });

  it("beats EVERY rule regardless of priority", () => {
    const lines = [line({ productKey: "PK-PROTECTED", regularPriceMinorUnits: 4000 })];
    const rules = [
      rule({ id: "low", priority: 1, discountPercent: 10 }),
      rule({ id: "high", priority: 99, discountPercent: 50 }),
    ];
    const out = computePromotions(lines, rules, ["PK-PROTECTED"]);
    expect(out.lines[0].unitPriceMinorUnits).toBe(4000);
    expect(out.lines[0].appliedRuleId).toBeUndefined();
  });

  it("protects only the listed product; other lines still get the deal", () => {
    const lines = [
      line({ lineId: "L1", productKey: "PK-PROTECTED", regularPriceMinorUnits: 5000 }),
      line({ lineId: "L2", productKey: "PK-NORMAL", regularPriceMinorUnits: 5000 }),
    ];
    const rules = [rule({ storewide: true, discountPercent: 20 })];
    const out = computePromotions(lines, rules, ["PK-PROTECTED"]);

    const protectedLine = out.lines.find((l) => l.lineId === "L1")!;
    const normalLine = out.lines.find((l) => l.lineId === "L2")!;
    expect(protectedLine.unitPriceMinorUnits).toBe(5000);
    expect(normalLine.unitPriceMinorUnits).toBeLessThan(5000);
  });

  it("matches the product key case-insensitively", () => {
    const lines = [line({ productKey: "pk-protected", regularPriceMinorUnits: 3000 })];
    const rules = [rule({ storewide: true, discountPercent: 25 })];
    const out = computePromotions(lines, rules, ["PK-PROTECTED"]);
    expect(out.lines[0].unitPriceMinorUnits).toBe(3000);
    expect(out.lines[0].unitSavingsMinorUnits).toBe(0);
  });

  it("empty list leaves pricing exactly as before (fail-safe no-op)", () => {
    const lines = [line({ productKey: "PK-1", regularPriceMinorUnits: 5000 })];
    const rules = [rule({ storewide: true, discountPercent: 20 })];
    const withEmpty = computePromotions(lines, rules, []);
    const withoutParam = computePromotions(lines, rules);
    expect(withEmpty.lines[0].unitPriceMinorUnits).toBe(
      withoutParam.lines[0].unitPriceMinorUnits,
    );
    expect(withEmpty.totalDiscountedMinorUnits).toBe(
      withoutParam.totalDiscountedMinorUnits,
    );
  });
});
