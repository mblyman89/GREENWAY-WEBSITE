/**
 * tests/compliance/receiving-classification-parity.test.ts  (SLICE 18-0)
 *
 * THE WHOLE POINT OF THIS SLICE, IN ONE FILE.
 *
 * The same physical product — a box of six suppositories — can enter Greenway
 * through two completely different doors:
 *
 *   DOOR 1  the one-time Cultivera IMPORT  → fact review → menu_items
 *   DOOR 2  RECEIVING a vendor manifest    → onboarding  → menu_items
 *
 * SLICE 17 built door 1. Door 2 did not exist, and a product that came through
 * it reached the shelf with otherwise_taken = NULL — which, because the
 * fail-safe here is inverted, means the ten-unit limit silently never engaged.
 *
 * These tests assert the property that actually protects the licence: THE DOOR
 * MUST NOT MATTER. Two identical products classified identically must produce
 * byte-identical limit inputs and therefore identical limit outcomes. If a
 * future change makes one door forget a field, this file fails even if every
 * other test in the repo still passes — because every other test only ever
 * looks at one door at a time.
 */
import { describe, it, expect } from "vitest";
import { parseOtherwiseTakenClassification, parseLowThcClassification } from "@/lib/pos/fact-review-core";
import {
  assessReceivingClassification,
  validateReceivingClassificationChoice,
} from "@/lib/inventory/receiving-classification-core";
import { evaluateCart, type LimitCartLine } from "@/lib/compliance/sales-limits-core";

/** What door 1 (fact review) produces for a six-count suppository box. */
function viaImport(): { otherwiseTaken: boolean | null; unitsPerPackage: number | null } {
  const r = parseOtherwiseTakenClassification("yes", "6");
  if (!r.ok) throw new Error("import path refused a valid classification: " + r.error);
  return {
    otherwiseTaken: r.facts.otherwiseTaken ?? null,
    unitsPerPackage: r.facts.unitsPerPackage ?? null,
  };
}

/** What door 2 (receiving) produces for the SAME product. */
function viaReceiving(): { otherwiseTaken: boolean | null; unitsPerPackage: number | null } {
  const assessment = assessReceivingClassification({
    productName: "Relief Suppositories 6ct",
    inventoryType: "Suppository",
    resolvedWebsiteCategory: "topical",
  });
  const r = validateReceivingClassificationChoice({
    assessment,
    otherwiseTaken: "yes",
    unitsPerPackage: "6",
  });
  if (!r.ok) throw new Error("receiving path refused a valid classification: " + r.error);
  return { otherwiseTaken: r.otherwiseTaken, unitsPerPackage: r.unitsPerPackage };
}

describe("SLICE 18-0 — import and receiving must classify identically", () => {
  it("produces the same otherwise-taken facts through both doors", () => {
    expect(viaReceiving()).toEqual(viaImport());
  });

  it("produces the same LIMIT OUTCOME through both doors", () => {
    const line = (facts: { otherwiseTaken: boolean | null; unitsPerPackage: number | null }): LimitCartLine => ({
      category: "topical",
      quantity: 2, // two boxes of six = twelve units, over the ten-unit maximum
      otherwiseTaken: facts.otherwiseTaken,
      unitsPerPackage: facts.unitsPerPackage,
      name: "Relief Suppositories 6ct",
      inventoryType: "Suppository",
    });

    const fromImport = evaluateCart([line(viaImport())]);
    const fromReceiving = evaluateCart([line(viaReceiving())]);

    // Same verdict...
    expect(fromReceiving.blocked).toBe(fromImport.blocked);
    // ...and it is the CORRECT verdict, not two matching wrong answers.
    expect(fromReceiving.blocked).toBe(true);

    const impBucket = fromImport.buckets.find((b) => b.bucket === "otherwise_taken");
    const recBucket = fromReceiving.buckets.find((b) => b.bucket === "otherwise_taken");
    expect(recBucket?.usedGrams).toBe(impBucket?.usedGrams);
    expect(recBucket?.usedGrams).toBe(12);
  });

  it("both doors refuse a YES with no unit count, with the same effect", () => {
    const imp = parseOtherwiseTakenClassification("yes", "");
    expect(imp.ok).toBe(false);

    const rec = validateReceivingClassificationChoice({
      assessment: { needsOtherwiseTakenPick: true, promptsLowThcLiquid: false },
      otherwiseTaken: "yes",
    });
    expect(rec.ok).toBe(false);
  });

  it("both doors refuse a fractional unit count", () => {
    expect(parseOtherwiseTakenClassification("yes", "2.5").ok).toBe(false);
    expect(
      validateReceivingClassificationChoice({
        assessment: { needsOtherwiseTakenPick: true, promptsLowThcLiquid: false },
        otherwiseTaken: "yes",
        unitsPerPackage: "2.5",
      }).ok,
    ).toBe(false);
  });
});

describe("SLICE 18-0 — the low-THC beverage agrees across both doors too", () => {
  it("classifies a qualifying 4 mg seltzer identically", () => {
    const imp = parseLowThcClassification("yes", "4");
    expect(imp.ok).toBe(true);
    if (!imp.ok) return;

    const rec = validateReceivingClassificationChoice({
      assessment: assessReceivingClassification({
        productName: "Craft Cannabis Seltzer 4pk",
        inventoryType: "Liquid Marijuana Infused Edible",
        resolvedWebsiteCategory: "edible-liquid",
      }),
      otherwiseTaken: "no",
      lowThcLiquid: "yes",
      unitThcMg: "4",
    });
    expect(rec.ok).toBe(true);
    if (!rec.ok) return;

    expect(rec.lowThcLiquid).toBe(imp.facts.lowThcLiquid);
    expect(rec.unitThcMg).toBe(imp.facts.unitThcMg);
  });

  it("both doors refuse a 16 mg container claiming the low-THC allowance", () => {
    expect(parseLowThcClassification("yes", "16").ok).toBe(false);
    expect(
      validateReceivingClassificationChoice({
        assessment: { needsOtherwiseTakenPick: false, promptsLowThcLiquid: true },
        lowThcLiquid: "yes",
        unitThcMg: "16",
      }).ok,
    ).toBe(false);
  });
});

describe("SLICE 18-0 — the regression this slice exists to prevent", () => {
  it("an UNCLASSIFIED suppository is effectively unlimited — the bug, pinned", () => {
    // This is what a received suppository looked like before this slice: it
    // reached the shelf with otherwise_taken NULL. Twelve of them do not block,
    // because 12 topical units is nothing against a 2016 g liquid allowance.
    const unclassified = evaluateCart([
      {
        category: "topical",
        quantity: 12,
        otherwiseTaken: null,
        unitsPerPackage: null,
        name: "Relief Suppositories",
        inventoryType: "Suppository",
      },
    ]);
    expect(unclassified.blocked).toBe(false);

    // ...but the detector must at least SHOUT about it, which is the only
    // reason the old behaviour was survivable at all.
    expect(unclassified.warnings.length).toBeGreaterThan(0);
    expect(unclassified.warnings[0]).toMatch(/looks like a suppository/i);

    // And the warning must send the reader somewhere they can ACTUALLY act.
    // Before this slice it named ONLY the menu-import facts screen — a screen
    // scoped to an import_id, which a RECEIVED lot never has. That advice was
    // unreachable for every product arriving after the Cultivera cutover,
    // i.e. every product from now on. Both doors must now be named, because a
    // budtender reading this warning has no way to know which door the product
    // came through.
    expect(unclassified.warnings[0]).toMatch(/menu-import facts screen/i);
    expect(unclassified.warnings[0]).toMatch(/product onboarding/i);
  });

  it("the receiving gate makes that state unreachable for a liquid-shelf lot", () => {
    // You cannot approve a topical lot without answering. So the NULL state
    // above can no longer be produced by the receiving door at all.
    const a = assessReceivingClassification({
      productName: "Relief Suppositories",
      inventoryType: "Suppository",
      resolvedWebsiteCategory: "topical",
    });
    expect(a.needsOtherwiseTakenPick).toBe(true);
    expect(validateReceivingClassificationChoice({ assessment: a }).ok).toBe(false);
  });
});
