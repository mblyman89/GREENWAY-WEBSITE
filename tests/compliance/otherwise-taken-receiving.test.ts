/**
 * tests/compliance/otherwise-taken-receiving.test.ts  (SLICE 18-0)
 *
 * THE RECEIVING GATE.
 *
 * SLICE 17 built the ten-unit limit and wired classification into FACT REVIEW —
 * the screen that reviews the one-time Cultivera import. Every product that
 * enters the store AFTER that cutover arrives through RECEIVING instead, and
 * receiving never had a classification step. Worse, fact review is scoped to an
 * `import_id`, which a received lot does not have, so a suppository received
 * next month could not reach the classification screen even in principle.
 *
 * That matters more here than anywhere else in the codebase because SLICE 17's
 * fail-safe is INVERTED (migration 0217, "*** THE FAIL-SAFE IS INVERTED ***"):
 * an unflagged suppository is categorised `topical`, `topical` maps to the
 * liquid_edible bucket, and that bucket is 2016 g — so large that a box of
 * suppositories is effectively unlimited. Silence does not fail closed here.
 * Silence disables a statutory limit.
 *
 * So this gate exists to make sure nobody can be silent. It is deliberately
 * TARGETED, not universal: it may only demand an answer when the answer could
 * actually change a limit, because a gate that interrupts a flower delivery to
 * ask about suppositories is a gate staff will learn to click through blindly.
 *
 * These tests pin the shape of that targeting, and — just as importantly — pin
 * the REASONS, so a later reader cannot mistake the deliberate asymmetry
 * between the two flags for an oversight.
 */
import { describe, it, expect } from "vitest";
import {
  assessReceivingClassification,
  validateReceivingClassificationChoice,
  otherwiseTakenPickerPlaceholder,
  RECEIVING_CLASSIFICATION_PROVENANCE,
  type ReceivingClassificationAssessment,
} from "@/lib/inventory/receiving-classification-core";
import { categoryToBucket, qualifiesAsOtherwiseTaken } from "@/lib/compliance/sales-limits-core";

// The three website categories that reach the liquid_edible bucket. Derived
// here from the REAL categoryToBucket rather than hardcoded, so that if anybody
// ever adds a fourth liquid category the gate is forced to grow with it instead
// of quietly leaving the new shelf ungated.
const LIQUID_SHELVES = ["edible-liquid", "tincture", "topical"] as const;

describe("SLICE 18-0 — the liquid shelves this gate must cover", () => {
  it("the three shelves under test really are the liquid_edible ones", () => {
    for (const c of LIQUID_SHELVES) {
      expect(categoryToBucket(c)).toBe("liquid_edible");
    }
  });

  it("a suppository can ONLY hide on those shelves, which is why they are gated", () => {
    // qualifiesAsOtherwiseTaken refuses to move a line out of its statutory
    // bucket unless the category is a liquid one. So the gate's scope is not a
    // style choice — asking on a flower lot could never change any outcome.
    for (const c of LIQUID_SHELVES) {
      expect(
        qualifiesAsOtherwiseTaken({
          category: c,
          quantity: 1,
          otherwiseTaken: true,
          unitsPerPackage: 6,
        }),
      ).toBe(true);
    }
    for (const c of ["flower", "cartridge", "edible-solid", "concentrate", "preroll"]) {
      expect(
        qualifiesAsOtherwiseTaken({
          category: c,
          quantity: 1,
          otherwiseTaken: true,
          unitsPerPackage: 6,
        }),
      ).toBe(false);
    }
  });
});

describe("SLICE 18-0 — assessReceivingClassification: WHEN the gate fires", () => {
  it("requires the otherwise-taken answer on every liquid_edible shelf", () => {
    for (const c of LIQUID_SHELVES) {
      const a = assessReceivingClassification({
        productName: "House Brand Something",
        inventoryType: "Liquid Marijuana Infused Edible",
        resolvedWebsiteCategory: c,
      });
      expect(a.needsOtherwiseTakenPick).toBe(true);
    }
  });

  it("does NOT require it on shelves where the answer could not change a limit", () => {
    for (const c of ["flower", "cartridge", "edible-solid", "concentrate", "preroll", "rso"]) {
      const a = assessReceivingClassification({
        productName: "Blue Dream 3.5g",
        inventoryType: "Usable Marijuana",
        resolvedWebsiteCategory: c,
      });
      expect(a.needsOtherwiseTakenPick).toBe(false);
    }
  });

  it("requires it when the name betrays a suppository even on an UNMAPPED category", () => {
    // The dangerous case: the resolver has no category yet, so the shelf test
    // cannot help. The detector is the only thing standing between this lot and
    // a silently unlimited shelf.
    const a = assessReceivingClassification({
      productName: "Relief Suppositories 4pk",
      inventoryType: null,
      resolvedWebsiteCategory: null,
    });
    expect(a.needsOtherwiseTakenPick).toBe(true);
    expect(a.suspected).toBe(true);
  });

  it("requires it when the CCRS inventory type says Suppository on a NON-liquid shelf", () => {
    // A mis-categorised suppository is exactly the scenario the limit is meant
    // to catch. The category alone would have let this through.
    const a = assessReceivingClassification({
      productName: "Evening Relief 10ct",
      inventoryType: "Suppository",
      resolvedWebsiteCategory: "edible-solid",
    });
    expect(a.needsOtherwiseTakenPick).toBe(true);
    expect(a.suspected).toBe(true);
  });

  it("does not fire the detector on the two products people wrongly assume qualify", () => {
    // WAC 314-55-010(40) excludes external application to the skin (patches)
    // and oral ingestion (sublingual tinctures). Both are commonly mistaken for
    // this bucket. They must not be *suspected* — though a tincture is still
    // gated by its shelf, which is a different and correct reason.
    const patch = assessReceivingClassification({
      productName: "Transdermal Patch 20mg",
      inventoryType: "Topical",
      resolvedWebsiteCategory: "topical",
    });
    expect(patch.suspected).toBe(false);
    expect(patch.needsOtherwiseTakenPick).toBe(true); // shelf, not suspicion

    const tincture = assessReceivingClassification({
      productName: "Sublingual Tincture 1oz",
      inventoryType: "Tincture",
      resolvedWebsiteCategory: "tincture",
    });
    expect(tincture.suspected).toBe(false);
  });
});

describe("SLICE 18-0 — the deliberate asymmetry between the two flags", () => {
  /**
   * This block exists to STATE A REASON, not just an outcome. Without it the
   * next reader sees one flag gated and the other merely prompted and
   * reasonably concludes somebody forgot to finish the job.
   *
   * otherwise_taken fails PERMISSIVELY: an unanswered suppository lands in the
   * 2016 g bucket and the ten-unit limit never engages — an unlawful over-sale.
   * That risk justifies blocking a human.
   *
   * low_thc_liquid fails CONSERVATIVELY: an unanswered beverage stays in the
   * 2016 g liquid bucket, which for a bulky low-dose drink is TIGHTER than the
   * 200 mg carve-out. The worst case is a lawful sale we declined to make.
   * That risk does not justify blocking a delivery.
   */
  it("gates otherwise_taken but only PROMPTS low_thc_liquid, on the liquid shelves", () => {
    const a = assessReceivingClassification({
      productName: "Craft Cannabis Seltzer 4pk",
      inventoryType: "Liquid Marijuana Infused Edible",
      resolvedWebsiteCategory: "edible-liquid",
    });
    expect(a.needsOtherwiseTakenPick).toBe(true);
    expect(a.promptsLowThcLiquid).toBe(true);
    expect(a).not.toHaveProperty("needsLowThcLiquidPick");
  });

  it("never prompts for low-THC outside the liquid shelves", () => {
    const a = assessReceivingClassification({
      productName: "Blue Dream 3.5g",
      inventoryType: "Usable Marijuana",
      resolvedWebsiteCategory: "flower",
    });
    expect(a.promptsLowThcLiquid).toBe(false);
  });

  it("a suspected suppository on a non-liquid shelf is gated but NOT low-THC prompted", () => {
    const a = assessReceivingClassification({
      productName: "Relief Suppository 6ct",
      inventoryType: "Suppository",
      resolvedWebsiteCategory: "edible-solid",
    });
    expect(a.needsOtherwiseTakenPick).toBe(true);
    expect(a.promptsLowThcLiquid).toBe(false);
  });
});

describe("SLICE 18-0 — validateReceivingClassificationChoice", () => {
  const gated: Pick<
    ReceivingClassificationAssessment,
    "needsOtherwiseTakenPick" | "promptsLowThcLiquid"
  > = { needsOtherwiseTakenPick: true, promptsLowThcLiquid: true };
  const open: Pick<
    ReceivingClassificationAssessment,
    "needsOtherwiseTakenPick" | "promptsLowThcLiquid"
  > = { needsOtherwiseTakenPick: false, promptsLowThcLiquid: false };

  it("refuses to approve a gated line with no answer at all", () => {
    const r = validateReceivingClassificationChoice({ assessment: gated });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("otherwise_taken_required");
    // The message must explain the CONSEQUENCE, not just name a field. Staff
    // who understand why they are being stopped do not learn to click through.
    expect(r.error).toMatch(/suppositor/i);
  });

  it("refuses a value that is neither yes nor no", () => {
    const r = validateReceivingClassificationChoice({
      assessment: gated,
      otherwiseTaken: "maybe",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("otherwise_taken_invalid");
  });

  it("demands the unit count with YES, because a missing count under-counts the limit", () => {
    // Without it we would store the flag and multiply by the default of 1,
    // counting a box of six as ONE unit — a 6x under-count of a statutory
    // maximum. This mirrors parseOtherwiseTakenClassification exactly.
    const r = validateReceivingClassificationChoice({
      assessment: gated,
      otherwiseTaken: "yes",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("units_per_package_required");
  });

  it("refuses a fractional unit count", () => {
    const r = validateReceivingClassificationChoice({
      assessment: gated,
      otherwiseTaken: "yes",
      unitsPerPackage: "2.5",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("units_per_package_invalid");
    expect(r.error).toMatch(/whole number/i);
  });

  it("refuses zero, negative and non-numeric unit counts", () => {
    for (const bad of ["0", "-3", "six", "abc", "NaN"]) {
      const r = validateReceivingClassificationChoice({
        assessment: gated,
        otherwiseTaken: "yes",
        unitsPerPackage: bad,
      });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.code).toBe("units_per_package_invalid");
    }
  });

  it("accepts YES with a whole count and records it as a HUMAN assertion", () => {
    const r = validateReceivingClassificationChoice({
      assessment: gated,
      otherwiseTaken: "yes",
      unitsPerPackage: "6",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.otherwiseTaken).toBe(true);
    expect(r.unitsPerPackage).toBe(6);
    expect(r.provenance.otherwiseTaken).toBe(RECEIVING_CLASSIFICATION_PROVENANCE.human);
  });

  it("accepts NO as a human assertion too — a deliberate 'no' is not the same as silence", () => {
    const r = validateReceivingClassificationChoice({
      assessment: gated,
      otherwiseTaken: "no",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.otherwiseTaken).toBe(false);
    expect(r.provenance.otherwiseTaken).toBe(RECEIVING_CLASSIFICATION_PROVENANCE.human);
  });

  it("machine-defaults an UNGATED line to false and says so in the provenance", () => {
    // This is the provenance-honesty rule. When nobody was asked, we must not
    // write a value that LOOKS like somebody answered. 18A's "unclassified
    // worklist" depends on being able to tell these two apart.
    const r = validateReceivingClassificationChoice({ assessment: open });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.otherwiseTaken).toBe(false);
    expect(r.provenance.otherwiseTaken).toBe(RECEIVING_CLASSIFICATION_PROVENANCE.machine);
  });

  it("a human answer on an ungated line is still accepted and still counts as human", () => {
    // The human always outranks the machine (the SLICE 64 rule).
    const r = validateReceivingClassificationChoice({
      assessment: open,
      otherwiseTaken: "yes",
      unitsPerPackage: "4",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.otherwiseTaken).toBe(true);
    expect(r.unitsPerPackage).toBe(4);
    expect(r.provenance.otherwiseTaken).toBe(RECEIVING_CLASSIFICATION_PROVENANCE.human);
  });

  it("accepts a unit count WITHOUT a yes, because packaging is a fact in its own right", () => {
    const r = validateReceivingClassificationChoice({
      assessment: open,
      unitsPerPackage: "4",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unitsPerPackage).toBe(4);
  });

  // ------------------------------------------------------------ low-THC --
  it("never blocks on a missing low-THC answer, even when prompted", () => {
    const r = validateReceivingClassificationChoice({ assessment: gated, otherwiseTaken: "no" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lowThcLiquid).toBeNull();
    // Null, not false: nobody answered, and we refuse to invent an answer.
    expect(r.provenance.lowThcLiquid).toBe(RECEIVING_CLASSIFICATION_PROVENANCE.unanswered);
  });

  it("refuses a low-THC yes above the 4 mg statutory ceiling", () => {
    const r = validateReceivingClassificationChoice({
      assessment: gated,
      otherwiseTaken: "no",
      lowThcLiquid: "yes",
      unitThcMg: "16",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("low_thc_invalid");
    // The SLICE 16 servings-vs-units mistake must be named in the message.
    expect(r.error).toMatch(/container/i);
  });

  it("demands the mg figure with a low-THC yes", () => {
    const r = validateReceivingClassificationChoice({
      assessment: gated,
      otherwiseTaken: "no",
      lowThcLiquid: "yes",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("low_thc_required");
  });

  it("accepts a qualifying low-THC beverage", () => {
    const r = validateReceivingClassificationChoice({
      assessment: gated,
      otherwiseTaken: "no",
      lowThcLiquid: "yes",
      unitThcMg: "4",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lowThcLiquid).toBe(true);
    expect(r.unitThcMg).toBe(4);
    expect(r.provenance.lowThcLiquid).toBe(RECEIVING_CLASSIFICATION_PROVENANCE.human);
  });

  it("refuses to let a product be BOTH otherwise-taken and a low-THC beverage", () => {
    // The two buckets are mutually exclusive by construction (lineBucket picks
    // otherwise_taken first). Accepting both would silently discard one answer
    // the human actually gave, which is worse than refusing.
    const r = validateReceivingClassificationChoice({
      assessment: gated,
      otherwiseTaken: "yes",
      unitsPerPackage: "6",
      lowThcLiquid: "yes",
      unitThcMg: "4",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("mutually_exclusive");
  });

  it("treats whitespace-only input as absent everywhere", () => {
    const r = validateReceivingClassificationChoice({
      assessment: open,
      otherwiseTaken: "   ",
      unitsPerPackage: "  ",
      lowThcLiquid: " ",
      unitThcMg: "   ",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unitsPerPackage).toBeNull();
    expect(r.lowThcLiquid).toBeNull();
    expect(r.unitThcMg).toBeNull();
  });
});

describe("SLICE 18-0 — the picker tells the truth about what 'leave it alone' means", () => {
  it("says PICK when an answer is required", () => {
    expect(otherwiseTakenPickerPlaceholder({ needsOtherwiseTakenPick: true })).toMatch(/pick/i);
  });

  it("says what the machine will assume when an answer is NOT required", () => {
    const label = otherwiseTakenPickerPlaceholder({ needsOtherwiseTakenPick: false });
    expect(label).toMatch(/no/i);
    expect(label).not.toMatch(/pick a/i);
  });
});
