/**
 * tests/compliance/classification-status-parity.test.ts   (SLICE 18A)
 *
 * THE POINT OF THIS FILE.
 *
 * There are now THREE places that decide "does this product need a compliance
 * classification?":
 *
 *   1. the receiving gate    — assessReceivingClassification()      (18-0)
 *   2. the worklist/badges   — assessClassificationStatus()         (18A)
 *   3. the register's engine — categoryToBucket()                   (16/17)
 *
 * If (1) and (2) ever disagree, the system develops a blind spot that is
 * invisible from either side: the worklist would list products the receiving
 * gate never asks about, or — far worse — the gate would ask about products the
 * worklist then reports as fine, so a manager auditing the worklist would
 * conclude the catalog is clean while it isn't.
 *
 * That is not hypothetical. It is exactly the class of bug SLICE 18-0 existed
 * to fix: two correct-looking implementations of one idea, wired to different
 * surfaces, with nothing forcing them to agree.
 *
 * So this file does not test either function's behaviour in isolation (their
 * own suites do that). It tests that they AGREE, over the full cross-product of
 * inputs that matter.
 */
import { describe, it, expect } from "vitest";
import {
  assessClassificationStatus,
  summarizeClassificationStatuses,
  type ProductClassificationFacts,
} from "@/lib/inventory/classification-status-core";
import { assessReceivingClassification } from "@/lib/inventory/receiving-classification-core";
import { categoryToBucket, LOW_THC_UNIT_MAX_MG } from "@/lib/compliance/sales-limits-core";

const facts = (over: Partial<ProductClassificationFacts> = {}): ProductClassificationFacts => ({
  posProductKey: "pos-1",
  productName: "Blue Dream 3.5g",
  inventoryType: "Usable Marijuana",
  resolvedWebsiteCategory: "flower",
  otherwiseTaken: null,
  unitsPerPackage: null,
  lowThcLiquid: null,
  unitThcMg: null,
  ...over,
});

// The categories the two doors must agree about. Drawn from categoryToBucket's
// own switch (sales-limits-core.ts:274-318) so this list cannot silently fall
// behind the engine — plus junk values, which must be handled not thrown on.
const CATEGORIES = [
  "flower",
  "popcorn-bud",
  "trim",
  "preroll",
  "blunt",
  "preroll-pack",
  "infused-flower",
  "infused-preroll",
  "infused-blunt",
  "infused-preroll-pack",
  "cartridge",
  "disposable-cartridge",
  "concentrate",
  "rso",
  "edible-solid",
  "edible-liquid",
  "tincture",
  "topical",
  "accessories",
  "merch",
  "paraphernalia",
  "",
  "   ",
  "NOT-A-REAL-CATEGORY",
] as const;

const NAMES = [
  "Blue Dream 3.5g",
  "Relief Suppositories 6ct",
  "SUPPOSITORY 10-pack",
  "Hibiscus Seltzer 4pk",
  "supp blend",
  "",
] as const;

describe("SLICE 18A — the worklist and the receiving gate agree on SCOPE", () => {
  it("agrees on every category × name combination", () => {
    let checked = 0;
    for (const category of CATEGORIES) {
      for (const name of NAMES) {
        const gate = assessReceivingClassification({
          productName: name,
          inventoryType: "Usable Marijuana",
          resolvedWebsiteCategory: category,
        });
        const status = assessClassificationStatus(
          facts({ productName: name, resolvedWebsiteCategory: category }),
        );

        // Scope: the gate asks ⟺ the worklist tracks.
        expect(
          status.inScope,
          `scope disagreement for category="${category}" name="${name}"`,
        ).toBe(gate.needsOtherwiseTakenPick);

        // The two underlying signals must match individually too, not just
        // their OR — otherwise one could compensate for the other's error.
        expect(status.isLiquidShelf).toBe(gate.isLiquidShelf);
        expect(status.suspected).toBe(gate.suspected);
        checked += 1;
      }
    }
    // Guard against a refactor that empties the loop and passes vacuously.
    expect(checked).toBe(CATEGORIES.length * NAMES.length);
    expect(checked).toBeGreaterThan(100);
  });

  it("both derive the liquid shelf from categoryToBucket, not a private list", () => {
    // If either side hard-coded its own category list, this would drift the
    // day the engine adds a bucket. Compare BOTH against the engine itself.
    for (const category of CATEGORIES) {
      const expected = categoryToBucket(category) === "liquid_edible";
      expect(
        assessClassificationStatus(facts({ resolvedWebsiteCategory: category })).isLiquidShelf,
      ).toBe(expected);
      expect(
        assessReceivingClassification({
          productName: "x",
          inventoryType: null,
          resolvedWebsiteCategory: category,
        }).isLiquidShelf,
      ).toBe(expected);
    }
  });

  it("agrees on WHICH question gets asked, not merely that one does", () => {
    // The 18-0 asymmetry: otherwise-taken is gated everywhere in scope, but
    // low-THC is only prompted on the liquid shelf. The worklist must mirror
    // that or it would nag suppositories about being beverages.
    for (const category of CATEGORIES) {
      for (const name of NAMES) {
        const gate = assessReceivingClassification({
          productName: name,
          inventoryType: null,
          resolvedWebsiteCategory: category,
        });
        const status = assessClassificationStatus(
          facts({ productName: name, inventoryType: null, resolvedWebsiteCategory: category }),
        );
        const worklistAsksLowThc = status.reasons.includes("low_thc_unanswered");
        expect(
          worklistAsksLowThc,
          `low-THC prompt disagreement for "${category}" / "${name}"`,
        ).toBe(gate.promptsLowThcLiquid);
      }
    }
  });
});

describe("SLICE 18A — the asymmetry survives, and is visible in urgency", () => {
  it("an unanswered otherwise-taken is URGENT; an unanswered low-THC is not", () => {
    // This is the 18-0 fail-safe doctrine expressed as UI priority. Pinning it
    // here means a future tidy-up that makes both reasons the same colour has
    // to argue with a test, rather than quietly erase the distinction.
    const otOnly = assessClassificationStatus(
      facts({ productName: "Relief Suppositories 6ct", resolvedWebsiteCategory: "edible-solid" }),
    );
    expect(otOnly.reasons).toEqual(["otherwise_taken_unanswered"]);
    expect(otOnly.urgent).toBe(true);

    const lowThcOnly = assessClassificationStatus(
      facts({ resolvedWebsiteCategory: "edible-liquid", otherwiseTaken: false }),
    );
    expect(lowThcOnly.reasons).toEqual(["low_thc_unanswered"]);
    expect(lowThcOnly.urgent).toBe(false);
  });

  it("states the REASON for the asymmetry, so it cannot read as an oversight", () => {
    // Same guard 18-0 put on its own gate. The direction a blank FAILS is what
    // earns a question the right to be urgent:
    //   otherwise_taken null -> sells under the 100-unit limit  (permissive)
    //   low_thc_liquid null  -> falls back to 72 oz             (conservative)
    // Anyone flipping the urgency has to explain why that stops being true.
    const permissive = assessClassificationStatus(
      facts({ productName: "Suppository 6ct", resolvedWebsiteCategory: "edible-solid" }),
    );
    const conservative = assessClassificationStatus(
      facts({ resolvedWebsiteCategory: "edible-liquid", otherwiseTaken: false }),
    );
    expect(permissive.urgent).toBe(true);
    expect(conservative.urgent).toBe(false);
    expect(permissive.urgent).not.toBe(conservative.urgent);
  });
});

describe("SLICE 18A — null is UNKNOWN, false is an ANSWER", () => {
  it("keeps them distinct everywhere it matters", () => {
    const unanswered = assessClassificationStatus(
      facts({ productName: "Suppository 6ct", otherwiseTaken: null }),
    );
    const answeredNo = assessClassificationStatus(
      facts({ productName: "Suppository 6ct", otherwiseTaken: false }),
    );

    expect(unanswered.settled).toBe(false);
    expect(answeredNo.settled).toBe(true);
    expect(unanswered.urgent).toBe(true);
    expect(answeredNo.urgent).toBe(false);

    // If a future refactor ever coerces null -> false (the tempting
    // simplification), these two collapse into each other and the worklist
    // silently empties. That would look like success.
    expect(unanswered.reasons).not.toEqual(answeredNo.reasons);
  });

  it("an out-of-scope product is 'not applicable', never 'settled'", () => {
    // Counting never-asked products as settled would let the rollup claim
    // credit for work nobody did, and the percentage would look great.
    const flower = assessClassificationStatus(facts({ resolvedWebsiteCategory: "flower" }));
    expect(flower.inScope).toBe(false);
    expect(flower.settled).toBe(false);
    expect(flower.reasons).toEqual([]);

    const roll = summarizeClassificationStatuses([flower, flower, flower]);
    expect(roll.inScope).toBe(0);
    expect(roll.settled).toBe(0);
    expect(roll.needsAttention).toBe(0);
  });
});

describe("SLICE 18A — the 4 mg ceiling matches the engine's constant", () => {
  it("uses LOW_THC_UNIT_MAX_MG rather than a copied literal", () => {
    // A hard-coded 4 here would survive the owner changing the constant, and
    // the worklist would start contradicting the register.
    const at = assessClassificationStatus(
      facts({
        resolvedWebsiteCategory: "edible-liquid",
        otherwiseTaken: false,
        lowThcLiquid: true,
        unitThcMg: LOW_THC_UNIT_MAX_MG,
      }),
    );
    const over = assessClassificationStatus(
      facts({
        resolvedWebsiteCategory: "edible-liquid",
        otherwiseTaken: false,
        lowThcLiquid: true,
        unitThcMg: LOW_THC_UNIT_MAX_MG + 0.001,
      }),
    );
    // "no more than four milligrams" — 4.0 exactly still qualifies.
    expect(at.reasons).not.toContain("low_thc_contradiction");
    expect(over.reasons).toContain("low_thc_contradiction");
  });

  it("ignores a non-finite mg value instead of crashing or false-flagging", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const s = assessClassificationStatus(
        facts({
          resolvedWebsiteCategory: "edible-liquid",
          otherwiseTaken: false,
          lowThcLiquid: true,
          unitThcMg: bad,
        }),
      );
      expect(s.reasons).not.toContain("low_thc_contradiction");
    }
  });
});
