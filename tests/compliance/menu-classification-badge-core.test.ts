/**
 * SLICE 18C — the on-card classification pills and the PDP allowance
 * disclosure.
 *
 * The core's own self-tests run inside CI's pure sweep. This file pins the
 * behaviour a SHOPPER experiences, and the cross-surface agreements that stop
 * the website from advertising an allowance the register would refuse:
 *
 *   - a pill appears ONLY when the till would route the product to that bucket,
 *   - the badge and 18B's FILTER always agree (or filtering to a lane would
 *     show unbadged cards, and vice versa),
 *   - the disclosure's figures come from the statute in the bucket's OWN unit
 *     (the "10 units" vs "0.357 oz" trap),
 *   - the copy makes no medical-multiple claim, because these are the only two
 *     buckets that do NOT triple for a DOH-database patient,
 *   - an unreviewed product gets silence, never a negative claim.
 */
import { describe, expect, it } from "vitest";

import type { GreenwayMenuItem } from "@/lib/leafly/types";
import {
  CLASSIFICATION_DISCLOSURE_BODIES,
  CLASSIFICATION_DISCLOSURE_CITATION,
  CLASSIFICATION_PILL_LABELS,
  CLASSIFICATION_PILL_TONES,
  CLASSIFICATION_PILL_TONE_AMBER,
  CLASSIFICATION_PILL_TONE_CHOICES,
  CLASSIFICATION_PILL_TONE_SLATE,
  CLASSIFICATION_PILL_TONE_TEAL,
  CLASSIFICATION_PILL_TONE_VIOLET,
  classificationBucketOwnerLabel,
  classificationDisclosuresForItem,
  classificationPillHelp,
  classificationPillsForItem,
  shouldShowClassificationPill,
} from "@/lib/menu/menu-classification-badge-core";
import {
  CLASSIFICATION_FILTER_HELP,
  CLASSIFICATION_FILTER_KINDS,
  CLASSIFICATION_FILTER_LABELS,
  itemHasClassification,
} from "@/lib/menu/menu-classification-filter-core";
import {
  LIMIT_BUCKET_LABELS,
  LOW_THC_UNIT_MAX_MG,
  MEDICAL_LIMITS,
  RECREATIONAL_LIMITS,
  formatLimitAmount,
  qualifiesAsLowThcLiquid,
  qualifiesAsOtherwiseTaken,
} from "@/lib/compliance/sales-limits-core";
import { DOH_PILL_TONE } from "@/lib/menu/menu-doh-badge-core";

function item(over: Partial<GreenwayMenuItem> & { id: string }): GreenwayMenuItem {
  return {
    name: "Test Item",
    brand: "Test Brand",
    category: "flower",
    priceMinorUnits: 3000,
    ...over,
  } as GreenwayMenuItem;
}

const goodDrink = (id = "d") =>
  item({ id, category: "edible-liquid", lowThcLiquid: true, unitThcMg: 4 });
const goodSupp = (id = "s") =>
  item({ id, category: "topical", otherwiseTaken: true, unitsPerPackage: 10 });

describe("18C badge — the graceful default", () => {
  it("renders nothing for an ordinary product", () => {
    expect(classificationPillsForItem(item({ id: "a" }))).toEqual([]);
    expect(shouldShowClassificationPill(item({ id: "a2" }))).toBe(false);
    expect(classificationDisclosuresForItem(item({ id: "a3" }))).toEqual([]);
  });

  it("stays silent about an UNREVIEWED product rather than making a negative claim", () => {
    // A null otherwiseTaken is the PERMISSIVE direction, so "not a
    // suppository" is a claim we cannot support for an unreviewed product.
    const unreviewed = item({
      id: "u",
      category: "edible-liquid",
      lowThcLiquid: null,
      unitThcMg: null,
      otherwiseTaken: null,
      unitsPerPackage: null,
    });
    expect(classificationPillsForItem(unreviewed)).toEqual([]);
    expect(classificationDisclosuresForItem(unreviewed)).toEqual([]);
  });

  it("a liquid category alone earns nothing", () => {
    expect(classificationPillsForItem(item({ id: "b", category: "edible-liquid" }))).toEqual([]);
  });
});

describe("18C badge — a pill means the REGISTER agrees", () => {
  it("badges a genuinely qualifying drink and suppository", () => {
    const drink = classificationPillsForItem(goodDrink());
    expect(drink).toHaveLength(1);
    expect(drink[0].kind).toBe("low_thc_liquid");
    expect(drink[0].label).toBe("Low-THC");
    expect(drink[0].tone.id).toBe("amber");

    const supp = classificationPillsForItem(goodSupp());
    expect(supp).toHaveLength(1);
    expect(supp[0].kind).toBe("otherwise_taken");
    expect(supp[0].label).toBe("Suppository");
    expect(supp[0].tone.id).toBe("violet");
  });

  /**
   * THE CENTRAL CASE. Every row has a raw flag set to `true` but does NOT
   * qualify under the register's three-condition test. A badge keyed on the
   * boolean would mislabel all of them, promising an allowance the till
   * refuses — the website and the register contradicting each other in public.
   */
  it.each([
    ["over the 4 mg per-unit ceiling", { category: "edible-liquid", lowThcLiquid: true, unitThcMg: 9 }],
    ["flag set with no mg figure", { category: "edible-liquid", lowThcLiquid: true }],
    ["zero mg", { category: "edible-liquid", lowThcLiquid: true, unitThcMg: 0 }],
    ["negative mg", { category: "edible-liquid", lowThcLiquid: true, unitThcMg: -1 }],
    ["a non-liquid category", { category: "flower", lowThcLiquid: true, unitThcMg: 4 }],
    ["flower flagged otherwise-taken", { category: "flower", otherwiseTaken: true }],
  ])("shows NO pill: %s", (_label, over) => {
    const subject = item({ id: "x", ...(over as Partial<GreenwayMenuItem>) });
    expect(classificationPillsForItem(subject)).toEqual([]);
    expect(classificationDisclosuresForItem(subject)).toEqual([]);
  });

  it("exactly at the 4 mg ceiling still qualifies (boundary is inclusive)", () => {
    const atCeiling = item({
      id: "edge",
      category: "edible-liquid",
      lowThcLiquid: true,
      unitThcMg: LOW_THC_UNIT_MAX_MG,
    });
    expect(classificationPillsForItem(atCeiling)).toHaveLength(1);

    const justOver = item({
      id: "edge2",
      category: "edible-liquid",
      lowThcLiquid: true,
      unitThcMg: LOW_THC_UNIT_MAX_MG + 0.01,
    });
    expect(classificationPillsForItem(justOver)).toEqual([]);
  });

  it("agrees with the register's OWN predicates over a matrix", () => {
    const fixtures = [
      item({ id: "m1" }),
      goodDrink("m2"),
      goodSupp("m3"),
      item({ id: "m4", category: "edible-liquid", lowThcLiquid: true, unitThcMg: 9 }),
      item({ id: "m5", category: "flower", otherwiseTaken: true }),
      item({ id: "m6", category: "tincture", lowThcLiquid: true, unitThcMg: 1 }),
      item({ id: "m7", category: "topical", otherwiseTaken: true, unitsPerPackage: 1 }),
      item({ id: "m8", category: "edible-liquid", lowThcLiquid: false, unitThcMg: 2 }),
    ];
    // Anti-vacuity: the matrix must contain BOTH badged and unbadged products,
    // or an always-empty implementation would pass.
    const badgedCount = fixtures.filter((f) => classificationPillsForItem(f).length > 0).length;
    expect(badgedCount).toBeGreaterThan(0);
    expect(badgedCount).toBeLessThan(fixtures.length);

    for (const subject of fixtures) {
      const kinds = classificationPillsForItem(subject).map((p) => p.kind);
      const line = {
        category: subject.category,
        lowThcLiquid: subject.lowThcLiquid ?? null,
        unitThcMg: subject.unitThcMg ?? null,
        otherwiseTaken: subject.otherwiseTaken ?? null,
        unitsPerPackage: subject.unitsPerPackage ?? null,
        quantity: 1,
        grams: 0,
      };
      expect(kinds.includes("low_thc_liquid")).toBe(
        qualifiesAsLowThcLiquid(line as Parameters<typeof qualifiesAsLowThcLiquid>[0]),
      );
      expect(kinds.includes("otherwise_taken")).toBe(
        qualifiesAsOtherwiseTaken(line as Parameters<typeof qualifiesAsOtherwiseTaken>[0]),
      );
    }
  });

  /**
   * If the badge and the FILTER ever disagree, a shopper who ticks
   * "Low-THC Beverages" sees cards with no pill (or the reverse). 18B's facet
   * and 18C's badge must be the same predicate, and this proves it.
   */
  it("never disagrees with the 18B filter", () => {
    const fixtures = [
      item({ id: "f1" }),
      goodDrink("f2"),
      goodSupp("f3"),
      item({ id: "f4", category: "edible-liquid", lowThcLiquid: true, unitThcMg: 5 }),
      item({ id: "f5", category: "topical", otherwiseTaken: true, unitsPerPackage: 10, lowThcLiquid: true, unitThcMg: 3 }),
    ];
    let compared = 0;
    for (const subject of fixtures) {
      const badged = classificationPillsForItem(subject).map((p) => p.kind);
      for (const kind of CLASSIFICATION_FILTER_KINDS) {
        expect(badged.includes(kind)).toBe(itemHasClassification(subject, kind));
        compared += 1;
      }
    }
    expect(compared).toBe(fixtures.length * CLASSIFICATION_FILTER_KINDS.length);
  });

  it("shows both pills for a dual-flagged product, in stable lane order", () => {
    const both = item({
      id: "both",
      category: "topical",
      otherwiseTaken: true,
      unitsPerPackage: 10,
      lowThcLiquid: true,
      unitThcMg: 4,
    });
    const pills = classificationPillsForItem(both);
    expect(pills).toHaveLength(2);
    expect(pills.map((p) => p.kind)).toEqual([...CLASSIFICATION_FILTER_KINDS]);
  });
});

describe("18C badge — vocabulary and tones", () => {
  it("shows the short form on the pill and the FULL shopper label in the title", () => {
    const pill = classificationPillsForItem(goodDrink())[0];
    expect(pill.label).toBe(CLASSIFICATION_PILL_LABELS.low_thc_liquid);
    expect(pill.title).toBe(CLASSIFICATION_FILTER_LABELS.low_thc_liquid);
    // The short form must genuinely be shorter, or the title adds nothing.
    expect(pill.label.length).toBeLessThan(pill.title.length);
  });

  it("keeps every pill label short enough for the narrow card lane", () => {
    for (const kind of CLASSIFICATION_FILTER_KINDS) {
      const label = CLASSIFICATION_PILL_LABELS[kind];
      expect(label.length).toBeGreaterThan(0);
      // The lane renders at 0.62rem with wide tracking; anything longer than
      // this wraps and breaks the card rhythm.
      expect(label.length).toBeLessThanOrEqual(12);
      expect(label.trim()).toBe(label);
    }
  });

  it("does not reuse the DOH blue or the deal green", () => {
    // Blue is DOH; green is the deal badge and the profile dot. A compliance
    // classification that borrows either reads as a sale or as a DOH product.
    for (const kind of CLASSIFICATION_FILTER_KINDS) {
      const tone = CLASSIFICATION_PILL_TONES[kind];
      expect(tone.id).not.toBe(DOH_PILL_TONE.id);
      expect(tone.border).not.toBe(DOH_PILL_TONE.border);
      expect(tone.dot).not.toBe(DOH_PILL_TONE.dot);
      expect(`${tone.border}${tone.text}${tone.dot}`).not.toMatch(/greenway/i);
    }
  });

  it("gives the two lanes visually distinct tones", () => {
    expect(CLASSIFICATION_PILL_TONES.low_thc_liquid.id).not.toBe(
      CLASSIFICATION_PILL_TONES.otherwise_taken.id,
    );
  });

  it("exposes named alternates so a recolour is one line", () => {
    expect(CLASSIFICATION_PILL_TONE_CHOICES.length).toBeGreaterThanOrEqual(4);
    const ids = CLASSIFICATION_PILL_TONE_CHOICES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        CLASSIFICATION_PILL_TONE_AMBER.id,
        CLASSIFICATION_PILL_TONE_VIOLET.id,
        CLASSIFICATION_PILL_TONE_TEAL.id,
        CLASSIFICATION_PILL_TONE_SLATE.id,
      ]),
    );
    for (const tone of CLASSIFICATION_PILL_TONE_CHOICES) {
      expect(tone.border.length).toBeGreaterThan(0);
      expect(tone.text.length).toBeGreaterThan(0);
      expect(tone.dot.length).toBeGreaterThan(0);
    }
  });

  it("shares the sidebar's help sentence and keeps staff wording separate", () => {
    expect(classificationPillHelp("low_thc_liquid")).toBe(CLASSIFICATION_FILTER_HELP.low_thc_liquid);
    expect(classificationBucketOwnerLabel("otherwise_taken")).toBe(
      LIMIT_BUCKET_LABELS.otherwise_taken,
    );
    // Shoppers get plain language; staff get the statutory phrasing.
    expect(classificationBucketOwnerLabel("low_thc_liquid")).not.toBe(
      CLASSIFICATION_FILTER_LABELS.low_thc_liquid,
    );
  });
});

describe("18C disclosure — honest, statutory, unit-correct", () => {
  it("reads its figures from the statute rather than hard-coding them", () => {
    const drink = classificationDisclosuresForItem(goodDrink())[0];
    expect(drink.limit).toBe("200 mg THC");
    expect(drink.limit).toBe(
      formatLimitAmount("low_thc_liquid", RECREATIONAL_LIMITS.low_thc_liquid),
    );
    expect(drink.citation).toBe("WAC 314-55-095");
    expect(drink.citation).toBe(CLASSIFICATION_DISCLOSURE_CITATION);
    expect(drink.headline).toBe(CLASSIFICATION_FILTER_LABELS.low_thc_liquid);
  });

  /**
   * THE UNIT TRAP. otherwise_taken counts ITEMS. sales-limits-core warns that a
   * formatter assuming weight renders "10 units" as "0.357 oz", which is
   * meaningless and dangerously wrong on a customer-facing page.
   */
  it("renders the suppository allowance as a COUNT, never a weight", () => {
    const supp = classificationDisclosuresForItem(goodSupp())[0];
    expect(supp.limit).toBe("10 units");
    expect(supp.limit).toBe(
      formatLimitAmount("otherwise_taken", RECREATIONAL_LIMITS.otherwise_taken),
    );
    expect(supp.limit).not.toMatch(/oz|gram|\bg\b/i);
    expect(supp.limit).not.toMatch(/mg/i);
  });

  /**
   * These two buckets are the ONLY ones that do not triple for a DOH-database
   * patient. Every other bucket does, so the pattern-matching instinct is
   * wrong here and the copy must never hint at a medical multiple.
   */
  it("makes no medical-multiple claim, because there is none", () => {
    expect(MEDICAL_LIMITS.low_thc_liquid).toBe(RECREATIONAL_LIMITS.low_thc_liquid);
    expect(MEDICAL_LIMITS.otherwise_taken).toBe(RECREATIONAL_LIMITS.otherwise_taken);

    for (const kind of CLASSIFICATION_FILTER_KINDS) {
      const body = CLASSIFICATION_DISCLOSURE_BODIES[kind];
      expect(body).not.toMatch(/triple|three times|3\s*x/i);
      expect(body).not.toMatch(/\bmedical\b|\bpatient\b|\bDOH\b/i);
    }
  });

  it("promises no quantity, and defers the final number to the store", () => {
    for (const kind of CLASSIFICATION_FILTER_KINDS) {
      const body = CLASSIFICATION_DISCLOSURE_BODIES[kind];
      // Only the cart meter can compute a true maximum, because it depends on
      // the whole basket.
      expect(body).not.toMatch(/you can buy \d|up to \d+ of/i);
      expect(body).toMatch(/confirmed in store/i);
      expect(body).toMatch(/separate/i);
    }
  });

  it("states the per-unit ceiling from the shared constant", () => {
    expect(CLASSIFICATION_DISCLOSURE_BODIES.low_thc_liquid).toContain(`${LOW_THC_UNIT_MAX_MG} mg`);
  });

  it("explains that the low-THC allowance spares the liquid limit", () => {
    // This is the actual shopper benefit and the reason the badge exists.
    expect(CLASSIFICATION_DISCLOSURE_BODIES.low_thc_liquid).toMatch(/72/);
  });

  it("gives one disclosure per earned lane", () => {
    const both = item({
      id: "both2",
      category: "topical",
      otherwiseTaken: true,
      unitsPerPackage: 10,
      lowThcLiquid: true,
      unitThcMg: 4,
    });
    const disclosures = classificationDisclosuresForItem(both);
    expect(disclosures).toHaveLength(2);
    expect(disclosures.map((d) => d.kind)).toEqual([...CLASSIFICATION_FILTER_KINDS]);
    // Each carries its own correctly-united figure.
    expect(disclosures[0].limit).toBe("200 mg THC");
    expect(disclosures[1].limit).toBe("10 units");
  });

  it("keeps the disclosure aligned with the pill, always", () => {
    for (const subject of [item({ id: "z1" }), goodDrink("z2"), goodSupp("z3")]) {
      expect(classificationDisclosuresForItem(subject).map((d) => d.kind)).toEqual(
        classificationPillsForItem(subject).map((p) => p.kind),
      );
    }
  });
});
