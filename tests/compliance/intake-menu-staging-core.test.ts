/**
 * tests/compliance/intake-menu-staging-core.test.ts
 *
 * Intake auto-carry (owner Option B) — pins the intake-accept → staged-version
 * snapshot contract:
 *   - FULL SNAPSHOT: publishing is an atomic swap, so a new staged version must
 *     carry EVERY currently-published item forward + append the new intake
 *     items; it must never reduce to just the new items (that would wipe the
 *     live menu on publish);
 *   - LIVE PRODUCT WINS: a lot-number (POS-key) collision with a live item is
 *     skipped with a superseded diagnostic — accepting a manifest never
 *     overwrites a live product's price/data;
 *   - NEVER GUESS: unpriced / keyless / unmapped-category approved drafts are
 *     refused with diagnostics (delegated to buildDraftInjectionPlan);
 *   - DRAFTS-ONLY: the planner only PLANS a staged version — a human still
 *     publishes.
 */
import { describe, expect, it } from "vitest";
import {
  buildIntakeStagedVersionPlan,
  __runIntakeMenuStagingCoreTests,
  type CarryForwardItem,
} from "@/lib/pos/intake-menu-staging-core";
import type { ApprovedDraftForInjection, DraftEnrichment } from "@/lib/pos/draft-injection-core";

function published(over: Partial<CarryForwardItem>): CarryForwardItem {
  return {
    source_item_id: "LIVE-1",
    name: "Live Flower 3.5g",
    product_name: "Live Flower 3.5g",
    brand_name: "House",
    vendor_name: "House LLC",
    category: "flower",
    filter_categories: ["flower"],
    pos_inventory_type: null,
    pos_inventory_category: null,
    strain_type: "hybrid",
    strain_name: "Blue Dream",
    thc: "22%",
    cbd: "0.3%",
    total_thc_json: { type: "thc", value: "22", unit: "%" },
    total_cbd_json: null,
    compounds_json: [],
    description: "Live desc.",
    price_label: "$40.00 3.5g",
    price_minor_units: 4000,
    inventory_status: "in-stock",
    hidden: false,
    hidden_reason: null,
    variants: [
      {
        source_variant_id: "LIVE-1-v",
        label: "3.5g",
        price_minor_units: 4000,
        inventory_level: 12,
        medical: false,
      },
    ],
    ...over,
  };
}

function draft(over: Partial<ApprovedDraftForInjection>): ApprovedDraftForInjection {
  return {
    id: "d1",
    pos_product_key: "LOT-NEW-1",
    name: "New Concentrate 1g",
    brand_name: "Fairwinds",
    vendor_name: "Fairwinds LLC",
    strain_name: "GG4",
    thc_pct: 70,
    cbd_pct: 0.2,
    total_thc_pct: 74.5,
    potency_json: { thc: 70 },
    price_minor_units: 3000,
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function enrich(over: Partial<DraftEnrichment>): DraftEnrichment {
  return {
    websiteCategory: "concentrate",
    strainType: "hybrid",
    onHandQty: 8,
    packageLabel: "1g",
    ...over,
  };
}

describe("intake-menu-staging-core: empty live menu", () => {
  it("stages exactly the approved intake item, keyed on the lot number", () => {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [],
      approvedDrafts: [draft({})],
      enrichmentByDraftId: new Map([["d1", enrich({})]]),
    });
    expect(plan.items).toHaveLength(1);
    expect(plan.carriedCount).toBe(0);
    expect(plan.addedCount).toBe(1);
    expect(plan.hasChanges).toBe(true);
    expect(plan.items[0].origin).toBe("intake");
    expect(plan.items[0].source_item_id).toBe("LOT-NEW-1");
    expect(plan.items[0].sort_order).toBe(0);
    expect(plan.items[0].variants).toHaveLength(1);
  });
});

describe("intake-menu-staging-core: full snapshot", () => {
  it("carries every published item forward, then appends the intake item", () => {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [published({}), published({ source_item_id: "LIVE-2", name: "Live Edible" })],
      approvedDrafts: [draft({})],
      enrichmentByDraftId: new Map([["d1", enrich({})]]),
    });
    expect(plan.items).toHaveLength(3);
    expect(plan.carriedCount).toBe(2);
    expect(plan.addedCount).toBe(1);
    expect(plan.items[0]).toMatchObject({ origin: "carried", sort_order: 0 });
    expect(plan.items[1]).toMatchObject({ origin: "carried", sort_order: 1 });
    expect(plan.items[2]).toMatchObject({ origin: "intake", sort_order: 2 });
    // Carried items are verbatim, variants preserved.
    expect(plan.items[0].price_minor_units).toBe(4000);
    expect(plan.items[0].variants[0].source_variant_id).toBe("LIVE-1-v");
  });
});

describe("intake-menu-staging-core: live product wins on lot collision", () => {
  it("keeps the live row and skips the intake row with a superseded diagnostic", () => {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [published({ source_item_id: "LOT-NEW-1", price_minor_units: 9999 })],
      approvedDrafts: [draft({})],
      enrichmentByDraftId: new Map([["d1", enrich({})]]),
    });
    expect(plan.items).toHaveLength(1);
    expect(plan.addedCount).toBe(0);
    expect(plan.hasChanges).toBe(false);
    expect(plan.items[0].price_minor_units).toBe(9999);
    expect(plan.diagnostics.some((d) => d.code === "draft_superseded_by_pos")).toBe(true);
  });
});

describe("intake-menu-staging-core: nothing to stage", () => {
  it("reports no changes when there are no approved drafts", () => {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [published({})],
      approvedDrafts: [],
      enrichmentByDraftId: new Map(),
    });
    expect(plan.items).toHaveLength(1);
    expect(plan.hasChanges).toBe(false);
    expect(plan.addedCount).toBe(0);
  });
});

describe("intake-menu-staging-core: never guess", () => {
  it("refuses unpriced / keyless / unmapped approved drafts with diagnostics", () => {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [],
      approvedDrafts: [
        draft({ id: "np", pos_product_key: "LOT-NP", price_minor_units: null }),
        draft({ id: "nk", pos_product_key: null }),
        draft({ id: "uc", pos_product_key: "LOT-UC" }),
      ],
      enrichmentByDraftId: new Map([
        ["np", enrich({})],
        ["nk", enrich({})],
        ["uc", enrich({ websiteCategory: null })],
      ]),
    });
    expect(plan.items).toHaveLength(0);
    expect(plan.hasChanges).toBe(false);
    expect(plan.diagnostics.some((d) => d.code === "draft_inject_no_price")).toBe(true);
    expect(plan.diagnostics.some((d) => d.code === "draft_inject_no_pos_key")).toBe(true);
    expect(plan.diagnostics.some((d) => d.code === "draft_inject_unmapped_category")).toBe(true);
  });
});

describe("intake-menu-staging-core: pack-axis restock (composer filter union)", () => {
  it("merges a 5-pack lot into the live single-preroll card and unions filter_categories", () => {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [
        published({
          name: "Blue Dream",
          category: "preroll",
          filter_categories: ["preroll"],
          variants: [
            {
              source_variant_id: "LOT-OLDPR-onboarded",
              label: "1g",
              price_minor_units: 800,
              inventory_level: 6,
              medical: false,
            },
          ],
        }),
      ],
      approvedDrafts: [
        draft({
          pos_product_key: "LOT-NEWPK",
          name: "Blue Dream Prerolls 5pk",
          brand_name: "House",
          strain_name: "Blue Dream",
          price_minor_units: 3000,
        }),
      ],
      enrichmentByDraftId: new Map([
        ["d1", enrich({ websiteCategory: "preroll-pack", packageLabel: "5pk", onHandQty: 10 })],
      ]),
    });
    expect(plan.items).toHaveLength(1);
    expect(plan.addedCount).toBe(0);
    expect(plan.mergedCount).toBe(1);
    const card = plan.items[0];
    expect(card.variants).toHaveLength(2);
    // LOT ACCURACY: the pack variant keeps ITS OWN lot's identity.
    expect(card.variants[1].source_variant_id).toBe("LOT-NEWPK-onboarded");
    // The card's primary category is untouched; filter_categories now covers
    // BOTH browse sections so the card stays reachable from each.
    expect(card.category).toBe("preroll");
    expect(card.filter_categories).toContain("preroll");
    expect(card.filter_categories).toContain("preroll-pack");
  });
});

describe("intake-menu-staging-core: embedded self-tests", () => {
  it("pass", () => {
    expect(__runIntakeMenuStagingCoreTests().passed).toBeGreaterThan(0);
  });
});
