/**
 * tests/compliance/intake-mastering-core.test.ts
 *
 * Product mastering for intake (Option A Slice 2) — pins the grouping
 * contract:
 *   - SAME VENDOR ONLY (owner rule, vendor axis): drafts roll up into one
 *     card only when vendor + website category + product family all match —
 *     WCIA manifests carry no per-line brand and the store's vendors are
 *     licensed per-brand, so the vendor IS the brand axis; a blank vendor or
 *     an unconfident family is NEVER grouped (standalone card + warning);
 *   - LOT ACCURACY: every variant keeps ITS OWN lot's identity
 *     (`${lotKey}-onboarded`) so the variant-aware sale path (PR #552)
 *     decrements / CCRS-stamps / costs the exact lot that was sold;
 *   - RESTOCK MERGE: a group matching exactly ONE live card joins that card
 *     as new variants; matching MORE than one live card is never merged on a
 *     guess (new card + warning); hidden/medical-only cards are never
 *     targets;
 *   - ELIGIBILITY UNCHANGED: keyless / unpriced / unmapped-category /
 *     superseded drafts are still refused by buildDraftInjectionPlan with
 *     the same diagnostics.
 */
import { describe, expect, it } from "vitest";
import {
  buildIntakeMasteringPlan,
  deriveFamily,
  familyFromName,
  groupingCategoryAxis,
  __runIntakeMasteringCoreTests,
  type LiveCardCandidate,
} from "@/lib/pos/intake-mastering-core";
import type { ApprovedDraftForInjection, DraftEnrichment } from "@/lib/pos/draft-injection-core";

function draft(over: Partial<ApprovedDraftForInjection>): ApprovedDraftForInjection {
  return {
    id: "d1",
    pos_product_key: "LOT-A",
    name: "Blue Dream 1g",
    brand_name: "Fairwinds",
    vendor_name: "Fairwinds LLC",
    strain_name: "Blue Dream",
    thc_pct: 21.5,
    cbd_pct: 0.4,
    total_thc_pct: 24.1,
    potency_json: { thc: 21.5 },
    price_minor_units: 1200,
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function enrich(over: Partial<DraftEnrichment>): DraftEnrichment {
  return {
    websiteCategory: "flower",
    strainType: "hybrid",
    onHandQty: 10,
    packageLabel: "1g",
    ...over,
  };
}

function live(over: Partial<LiveCardCandidate>): LiveCardCandidate {
  return {
    source_item_id: "card-1",
    name: "Blue Dream",
    brand_name: "Fairwinds",
    vendor_name: "Fairwinds LLC",
    category: "flower",
    strain_name: "Blue Dream",
    hidden: false,
    variants: [{ source_variant_id: "LOT-OLD-onboarded", medical: false }],
    ...over,
  };
}

function plan(
  drafts: ApprovedDraftForInjection[],
  e: [string, DraftEnrichment][],
  liveCards: LiveCardCandidate[] = [],
  existing: string[] = [],
) {
  return buildIntakeMasteringPlan({
    drafts,
    existingKeys: new Set(existing),
    enrichmentByDraftId: new Map(e),
    liveCards,
  });
}

describe("intake-mastering-core: within-invoice rollup", () => {
  it("rolls two lots of the same brand+strain+category into one card, each variant keeping its own lot key", () => {
    const p = plan(
      [
        draft({}),
        draft({ id: "d2", pos_product_key: "LOT-B", name: "Blue Dream 3.5g", price_minor_units: 3500 }),
      ],
      [
        ["d1", enrich({})],
        ["d2", enrich({ packageLabel: "3.5g" })],
      ],
    );
    expect(p.newCards).toHaveLength(1);
    const card = p.newCards[0];
    expect(card.source_item_id).toBe("LOT-A");
    expect(card.name).toBe("Blue Dream");
    expect(card.variants.map((v) => v.source_variant_id)).toEqual([
      "LOT-A-onboarded",
      "LOT-B-onboarded",
    ]);
    expect(card.price_minor_units).toBe(1200); // cheapest variant leads
    expect(p.diagnostics.some((d) => d.code === "intake_master_grouped")).toBe(true);
  });

  it("never groups across vendors (owner rule) or across strains", () => {
    const vendors = plan(
      [draft({}), draft({ id: "d2", pos_product_key: "LOT-B", vendor_name: "Other Farms LLC" })],
      [
        ["d1", enrich({})],
        ["d2", enrich({})],
      ],
    );
    expect(vendors.newCards).toHaveLength(2);

    const strains = plan(
      [draft({}), draft({ id: "d2", pos_product_key: "LOT-B", strain_name: "GG4", name: "GG4 1g" })],
      [
        ["d1", enrich({})],
        ["d2", enrich({})],
      ],
    );
    expect(strains.newCards).toHaveLength(2);
  });

  it("rolls up different brand labels under the SAME vendor (vendors are licensed per-brand)", () => {
    const p = plan(
      [
        draft({}),
        draft({
          id: "d2",
          pos_product_key: "LOT-B",
          name: "Blue Dream 3.5g",
          brand_name: "Other Label",
          price_minor_units: 3500,
        }),
      ],
      [
        ["d1", enrich({})],
        ["d2", enrich({ packageLabel: "3.5g" })],
      ],
    );
    expect(p.newCards).toHaveLength(1);
    expect(p.newCards[0].variants).toHaveLength(2);
  });
});

describe("intake-mastering-core: restock merge into live cards", () => {
  it("appends the lot to the ONE matching live card instead of duplicating it", () => {
    const p = plan([draft({})], [["d1", enrich({})]], [live({})]);
    expect(p.newCards).toHaveLength(0);
    expect(p.mergedVariantCount).toBe(1);
    expect(p.mergesByCardKey.get("card-1")?.[0].source_variant_id).toBe("LOT-A-onboarded");
    expect(p.diagnostics.some((d) => d.code === "intake_master_restock")).toBe(true);
  });

  it("never merges when the identity matches more than one live card", () => {
    const p = plan(
      [draft({})],
      [["d1", enrich({})]],
      [live({}), live({ source_item_id: "card-2", variants: [] })],
    );
    expect(p.newCards).toHaveLength(1);
    expect(p.mergedVariantCount).toBe(0);
    expect(
      p.diagnostics.some(
        (d) => d.code === "intake_master_merge_ambiguous" && d.severity === "warning",
      ),
    ).toBe(true);
  });

  it("never targets hidden or medical-only live cards, and drops lots already live as variants", () => {
    const noTargets = plan(
      [draft({})],
      [["d1", enrich({})]],
      [
        live({ hidden: true }),
        live({
          source_item_id: "card-med",
          variants: [{ source_variant_id: "LOT-M-onboarded", medical: true }],
        }),
      ],
    );
    expect(noTargets.newCards).toHaveLength(1);
    expect(noTargets.mergedVariantCount).toBe(0);

    const alreadyLive = plan(
      [draft({})],
      [["d1", enrich({})]],
      [live({ variants: [{ source_variant_id: "LOT-A-onboarded", medical: false }] })],
    );
    expect(alreadyLive.newCards).toHaveLength(0);
    expect(alreadyLive.mergedVariantCount).toBe(0);
    expect(alreadyLive.diagnostics.some((d) => d.code === "intake_lot_already_live")).toBe(true);
  });
});

describe("intake-mastering-core: never guess", () => {
  it("keeps blank-vendor and ambiguous-name drafts as standalone cards with warnings", () => {
    const p = plan(
      [
        draft({ vendor_name: null }),
        draft({ id: "d2", pos_product_key: "LOT-X", name: "Fairwinds 1g", strain_name: null }),
      ],
      [
        ["d1", enrich({})],
        ["d2", enrich({ websiteCategory: "paraphernalia" })],
      ],
    );
    expect(p.newCards).toHaveLength(2);
    expect(p.diagnostics.some((d) => d.code === "intake_master_no_vendor")).toBe(true);
    expect(p.diagnostics.some((d) => d.code === "intake_master_ambiguous_name")).toBe(true);
  });

  it("delegates eligibility to buildDraftInjectionPlan (diagnostics unchanged)", () => {
    const p = plan(
      [
        draft({ id: "nk", pos_product_key: null }),
        draft({ id: "np", pos_product_key: "LOT-NP", price_minor_units: null }),
        draft({ id: "sp", pos_product_key: "LIVE-KEY" }),
      ],
      [
        ["nk", enrich({})],
        ["np", enrich({})],
        ["sp", enrich({})],
      ],
      [],
      ["LIVE-KEY"],
    );
    expect(p.newCards).toHaveLength(0);
    expect(p.diagnostics.some((d) => d.code === "draft_inject_no_pos_key")).toBe(true);
    expect(p.diagnostics.some((d) => d.code === "draft_inject_no_price")).toBe(true);
    expect(p.diagnostics.some((d) => d.code === "draft_superseded_by_pos")).toBe(true);
  });
});

describe("intake-mastering-core: family derivation", () => {
  it("uses the strain for strain-led categories and the noise-stripped name otherwise", () => {
    expect(
      deriveFamily({ category: "flower", vendor: "X", name: "whatever", strainName: "Blue_Dream" }),
    ).toEqual({ family: "blue-dream", display: "Blue Dream" });
    expect(
      deriveFamily({
        category: "edible-solid",
        vendor: "Fairwinds LLC",
        brand: "Fairwinds",
        name: "Fairwinds - Rainbow Chews 100mg pack",
        strainName: null,
      }),
    ).toEqual({ family: "rainbow-chews", display: "Rainbow Chews" });
  });

  it("refuses to guess when the name strips to nothing", () => {
    expect(familyFromName("Fairwinds 3.5g", "Fairwinds")).toBeNull();
  });

  it("strips vendor prefixes too (label-list form)", () => {
    expect(familyFromName("Fairwinds LLC Healing Balm 300mg", ["", "Fairwinds LLC"])).toEqual(
      "Healing Balm",
    );
  });
});

describe("intake-mastering-core: pack-axis rollup (prerolls / infused prerolls / blunts)", () => {
  it("folds pack categories onto their single-form axis for identity only", () => {
    expect(groupingCategoryAxis("preroll-pack")).toBe("preroll");
    expect(groupingCategoryAxis("infused-preroll-pack")).toBe("infused-preroll");
    expect(groupingCategoryAxis("preroll")).toBe("preroll");
    expect(groupingCategoryAxis("infused-preroll")).toBe("infused-preroll");
    expect(groupingCategoryAxis("flower")).toBe("flower");
  });

  it("strips numbered pack tokens from family names", () => {
    expect(familyFromName("Rainbow Chews 5pk", "")).toEqual("Rainbow Chews");
    expect(familyFromName("Healing Balm 2-pack", "")).toEqual("Healing Balm");
  });

  it("rolls a single preroll and its 5-pack into ONE card reachable from both sections", () => {
    const p = buildIntakeMasteringPlan({
      drafts: [
        draft({ id: "d1", pos_product_key: "LOT-S", name: "Blue Dream Preroll 1g", price_minor_units: 800 }),
        draft({ id: "d2", pos_product_key: "LOT-P5", name: "Blue Dream Prerolls 5pk", price_minor_units: 3000 }),
      ],
      existingKeys: new Set(),
      enrichmentByDraftId: new Map([
        ["d1", enrich({ websiteCategory: "preroll", packageLabel: "1g" })],
        ["d2", enrich({ websiteCategory: "preroll-pack", packageLabel: "5pk" })],
      ]),
      liveCards: [],
    });
    expect(p.newCards).toHaveLength(1);
    expect(p.newCards[0].variants.map((v) => v.source_variant_id)).toEqual([
      "LOT-S-onboarded",
      "LOT-P5-onboarded",
    ]);
    expect(p.newCards[0].filter_categories).toContain("preroll");
    expect(p.newCards[0].filter_categories).toContain("preroll-pack");
  });

  it("never folds infused onto non-infused", () => {
    const p = buildIntakeMasteringPlan({
      drafts: [
        draft({ id: "i1", pos_product_key: "LOT-I1", name: "GG4 Infused Preroll", strain_name: "GG4", price_minor_units: 1500 }),
        draft({ id: "i2", pos_product_key: "LOT-I2", name: "GG4 Infused Prerolls 2pk", strain_name: "GG4", price_minor_units: 2800 }),
        draft({ id: "n1", pos_product_key: "LOT-N1", name: "GG4 Preroll", strain_name: "GG4", price_minor_units: 700 }),
      ],
      existingKeys: new Set(),
      enrichmentByDraftId: new Map([
        ["i1", enrich({ websiteCategory: "infused-preroll" })],
        ["i2", enrich({ websiteCategory: "infused-preroll-pack", packageLabel: "2pk" })],
        ["n1", enrich({ websiteCategory: "preroll" })],
      ]),
      liveCards: [],
    });
    expect(p.newCards).toHaveLength(2);
    const infused = p.newCards.find((c) => c.variants.length === 2);
    expect(infused?.variants.map((v) => v.source_variant_id)).toEqual([
      "LOT-I1-onboarded",
      "LOT-I2-onboarded",
    ]);
  });

  it("rolls blunts up on the preroll axis (single blunt + 3-pack)", () => {
    const p = buildIntakeMasteringPlan({
      drafts: [
        draft({ id: "b1", pos_product_key: "LOT-B1", name: "Grape Ape Blunt 1g", strain_name: "Grape Ape", price_minor_units: 900 }),
        draft({ id: "b3", pos_product_key: "LOT-B3", name: "Grape Ape Blunts 3 pack", strain_name: "Grape Ape", price_minor_units: 2400 }),
      ],
      existingKeys: new Set(),
      enrichmentByDraftId: new Map([
        ["b1", enrich({ websiteCategory: "preroll" })],
        ["b3", enrich({ websiteCategory: "preroll-pack", packageLabel: "3pk" })],
      ]),
      liveCards: [],
    });
    expect(p.newCards).toHaveLength(1);
    expect(p.newCards[0].variants).toHaveLength(2);
  });

  it("merges a 5-pack restock into the live single-preroll card and records the pack category", () => {
    const p = buildIntakeMasteringPlan({
      drafts: [
        draft({ id: "d1", pos_product_key: "LOT-NEWPK", name: "Blue Dream Prerolls 5pk", price_minor_units: 3000 }),
      ],
      existingKeys: new Set(),
      enrichmentByDraftId: new Map([
        ["d1", enrich({ websiteCategory: "preroll-pack", packageLabel: "5pk" })],
      ]),
      liveCards: [
        live({
          source_item_id: "card-pr",
          category: "preroll",
          variants: [{ source_variant_id: "LOT-OLDPR-onboarded", medical: false }],
        }),
      ],
    });
    expect(p.newCards).toHaveLength(0);
    expect(p.mergedVariantCount).toBe(1);
    expect(p.mergesByCardKey.get("card-pr")?.[0].source_variant_id).toBe("LOT-NEWPK-onboarded");
    expect(p.mergeCategoriesByCardKey.get("card-pr")).toContain("preroll-pack");
  });
});

describe("intake-mastering-core: other variant-bearing categories (topicals / RSO / liquids / tinctures)", () => {
  it("groups topical sizes on the noise-stripped name", () => {
    const p = buildIntakeMasteringPlan({
      drafts: [
        draft({ id: "t1", pos_product_key: "LOT-T1", name: "Healing Balm 100mg", strain_name: null, price_minor_units: 1800 }),
        draft({ id: "t2", pos_product_key: "LOT-T2", name: "Fairwinds Healing Balm 300mg jar", strain_name: null, price_minor_units: 4200 }),
      ],
      existingKeys: new Set(),
      enrichmentByDraftId: new Map([
        ["t1", enrich({ websiteCategory: "topical", packageLabel: "100mg" })],
        ["t2", enrich({ websiteCategory: "topical", packageLabel: "300mg" })],
      ]),
      liveCards: [],
    });
    expect(p.newCards).toHaveLength(1);
    expect(p.newCards[0].variants).toHaveLength(2);
  });

  it("groups RSO sizes strain-led", () => {
    const p = buildIntakeMasteringPlan({
      drafts: [
        draft({ id: "r1", pos_product_key: "LOT-R1", name: "ACDC RSO 1g", strain_name: "ACDC", price_minor_units: 2500 }),
        draft({ id: "r2", pos_product_key: "LOT-R2", name: "ACDC RSO Syringe 0.5g", strain_name: "ACDC", price_minor_units: 1500 }),
      ],
      existingKeys: new Set(),
      enrichmentByDraftId: new Map([
        ["r1", enrich({ websiteCategory: "rso", packageLabel: "1g" })],
        ["r2", enrich({ websiteCategory: "rso", packageLabel: "0.5g" })],
      ]),
      liveCards: [],
    });
    expect(p.newCards).toHaveLength(1);
    expect(p.newCards[0].variants).toHaveLength(2);
  });
});

describe("intake-mastering-core: embedded self-tests", () => {
  it("pass", () => {
    expect(__runIntakeMasteringCoreTests().passed).toBeGreaterThan(0);
  });
});
