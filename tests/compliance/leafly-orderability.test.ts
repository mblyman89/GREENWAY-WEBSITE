/**
 * tests/compliance/leafly-orderability.test.ts — SLICE L-3.
 *
 * Findings L-09 (`availableForPickup` never sent) and L-11 (`variant.medical`
 * hardcoded) are the two places in the Leafly integration where getting it
 * wrong is not a data-quality problem but a legal one. This file is the
 * compliance-grade guard on both.
 *
 * It is deliberately a SEPARATE file from `leafly-payload-schema.test.ts`.
 * That file answers "would Leafly accept this payload?" — a schema question.
 * This one answers "should we be sending it at all?" — a fulfilment and
 * statutory question. A payload can be perfectly schema-valid and still offer a
 * card-only product to an anonymous shopper.
 *
 * Every assertion here is grounded in a source that is quoted at the assertion:
 *   - the vendored live schema, `docs/leafly-specs/schemas/v2-items.json`
 *   - WAC 246-70 via `docs/MEDICAL_CANNABIS_COMPLIANCE.md`
 *   - the owner's own Q5 answer, quoted verbatim in `leafly-recon/slice-L1-todo.md`
 */
import { describe, it, expect } from "vitest";

import {
  DOH_CATEGORIES_BLOCKED_FROM_PICKUP,
  decideOrderability,
  isDohCategoryBlockedFromPickup,
  orderabilityReasonLabel,
  resolveVariantMedical,
  summarizeOrderability,
  ORDERABILITY_SUMMARY_EXAMPLE_LIMIT,
  __runLeaflyOrderabilityTests,
} from "@/lib/leafly/orderability-core";
import { buildLeaflyItemsPayload, toLeaflyItem } from "@/lib/leafly/payload-core";
import { toSyndicationItem, type SyndicationItem } from "@/lib/syndication/menu-feed-core";
import {
  DEFAULT_LEAFLY_SETTINGS,
  resolveLeaflySettings,
} from "@/lib/syndication/sync-settings-core";

/** A realistic in-stock recreational item. */
function item(over: Partial<SyndicationItem> & { id: string }): SyndicationItem {
  return {
    name: "Blue Dream",
    brand: "Greenway",
    category: "flower",
    strainType: "hybrid",
    strainName: "Blue Dream",
    thc: "24.1%",
    cbd: null,
    description: "Smooth and balanced.",
    priceMinorUnits: 1500,
    inStock: true,
    variants: [
      { id: `${over.id}-v1`, label: "3.5g", priceMinorUnits: 1500, inStock: true, inventoryLevel: 6 },
    ],
    ...over,
  };
}

describe("L-3 · the pure self-tests run and pass", () => {
  it("runs a real number of assertions with zero failures", () => {
    const r = __runLeaflyOrderabilityTests();
    expect(r.failed).toBe(0);
    // A suite that returns { passed: 0 } never executed. Guard the guard.
    expect(r.passed).toBeGreaterThan(35);
  });
});

describe("L-09 · availableForPickup is emitted, and fails closed", () => {
  it("is always present on every item", () => {
    // The schema offers three states: true, false, and omitted. Omitted means
    // "keep Leafly's current setting", which during a sync is silence about a
    // fact that may have changed. We always state it.
    const built = buildLeaflyItemsPayload([item({ id: "a" }), item({ id: "b" })], {
      pickupEnabled: true,
    });
    expect(built.items).toHaveLength(2);
    for (const it of built.items) {
      expect(it).toHaveProperty("availableForPickup");
      expect(typeof it.availableForPickup).toBe("boolean");
    }
  });

  it("is a plain boolean, never null — the schema declares `type: \"boolean\"`", () => {
    const built = buildLeaflyItemsPayload([item({ id: "a" })], { pickupEnabled: true });
    expect(built.items[0].availableForPickup).not.toBeNull();
    const json = JSON.stringify(built);
    expect(json).not.toContain('"availableForPickup":null');
    expect(json).not.toContain('"availableForPickup":"');
  });

  it("defaults to FALSE when the caller says nothing about ordering", () => {
    // This is the single most important default in the slice. A caller that has
    // not thought about ordering must not be able to switch it on by accident.
    expect(toLeaflyItem(item({ id: "a" }))?.availableForPickup).toBe(false);
    expect(buildLeaflyItemsPayload([item({ id: "a" })]).items[0].availableForPickup).toBe(false);
  });

  it("is TRUE only when the owner has enabled ordering and the item is in stock", () => {
    expect(toLeaflyItem(item({ id: "a" }), { pickupEnabled: true })?.availableForPickup).toBe(true);
  });

  it("withdraws the offer EXPLICITLY when an item goes out of stock", () => {
    // The regression this protects against is subtle and expensive: omitting the
    // field on a sold-out item leaves Leafly's existing `true` in place, so the
    // shop keeps taking orders for a product that is gone.
    const sold = item({
      id: "sold-out",
      inStock: false,
      variants: [{ id: "v", label: "3.5g", priceMinorUnits: 1500, inStock: false, inventoryLevel: 0 }],
    });
    const out = toLeaflyItem(sold, { pickupEnabled: true });
    expect(out).not.toBeNull();
    expect(out).toHaveProperty("availableForPickup");
    expect(out?.availableForPickup).toBe(false);
  });

  it("uses the camelCase v2 name and never the removed v1 snake_case one", () => {
    const json = JSON.stringify(buildLeaflyItemsPayload([item({ id: "a" })], { pickupEnabled: true }));
    expect(json).toContain('"availableForPickup"');
    expect(json).not.toContain('"available_for_pickup"');
  });

  it("never leaks our internal dohCategory onto the wire", () => {
    // `dohCategory` is a Greenway field. Leafly declares no such property, so
    // sending it would put an undeclared field on every DOH-verified product.
    const json = JSON.stringify(
      buildLeaflyItemsPayload([item({ id: "a", dohCategory: "general_use" })], { pickupEnabled: true }),
    );
    expect(json).not.toContain('"dohCategory"');
    expect(json).not.toContain('"doh_category"');
  });
});

describe("L-3 · the WAC 246-70 High-THC gate is statutory, not a preference", () => {
  it("blocks high_thc from pickup", () => {
    // docs/MEDICAL_CANNABIS_COMPLIANCE.md: "HARD GATE: a `high_thc` product may
    // NEVER be sold to a non-cardholder. This is statutory — no manager
    // override exists." A recognition card cannot be checked when an anonymous
    // shopper places an order on leafly.com.
    expect(isDohCategoryBlockedFromPickup("high_thc")).toBe(true);
    expect(DOH_CATEGORIES_BLOCKED_FROM_PICKUP).toContain("high_thc");
  });

  it("does NOT block the two unrestricted DOH lanes", () => {
    // general_use sells to anyone 21+; high_cbd is sales-tax-free for anyone by
    // statute. Blocking them would punish the owner for doing his DOH homework.
    expect(isDohCategoryBlockedFromPickup("general_use")).toBe(false);
    expect(isDohCategoryBlockedFromPickup("high_cbd")).toBe(false);
  });

  it("treats an unverified product as unrestricted, not as suspicious", () => {
    // Most stock has no registry row. Reading "absent" as "restricted" would
    // block the entire menu.
    expect(isDohCategoryBlockedFromPickup(null)).toBe(false);
    expect(isDohCategoryBlockedFromPickup(undefined)).toBe(false);
  });

  it("keeps a high_thc product un-orderable even in stock, enabled, and endorsed", () => {
    const ht = item({ id: "ht", dohCategory: "high_thc" });
    expect(toLeaflyItem(ht, { pickupEnabled: true })?.availableForPickup).toBe(false);
    expect(
      toLeaflyItem(ht, { pickupEnabled: true, medicallyEndorsed: true })?.availableForPickup,
    ).toBe(false);
  });

  it("still PUBLISHES the high_thc product — it is legal to show, not to order", () => {
    const out = toLeaflyItem(item({ id: "ht", dohCategory: "high_thc" }), { pickupEnabled: true });
    expect(out).not.toBeNull();
    expect(out?.name).toBe("Blue Dream");
  });

  it("reports the statutory reason rather than a vague refusal", () => {
    const d = decideOrderability({ inStock: true, pickupEnabled: true, dohCategory: "high_thc" });
    expect(d.reason).toBe("doh_restricted");
    const label = orderabilityReasonLabel("doh_restricted");
    expect(label).toContain("246-70");
    expect(label).toContain("recognition card");
  });

  it("ranks the statutory reason above a transient stock problem", () => {
    const d = decideOrderability({ inStock: false, pickupEnabled: true, dohCategory: "high_thc" });
    expect(d.reason).toBe("doh_restricted");
  });
});

describe("L-11 · medical is gated on the endorsement, not on a flag", () => {
  it("is FALSE today, which matches the owner's own answer", () => {
    // Owner, Q5, verbatim (leafly-recon/slice-L1-todo.md): "we carry doh
    // products, but we have not been certified yet. So we will only have
    // regular non medical sales at the start until we get the endorsement."
    const built = buildLeaflyItemsPayload(
      [item({ id: "a" }), item({ id: "b", dohCategory: "general_use" })],
      { pickupEnabled: true },
    );
    for (const it of built.items) {
      for (const v of it.variants) expect(v.medical).toBe(false);
    }
  });

  it("stays false for a DOH-verified product while the store is unendorsed", () => {
    expect(
      toLeaflyItem(item({ id: "a", dohCategory: "high_cbd" }))?.variants[0].medical,
    ).toBe(false);
  });

  it("stays false for an endorsed store when the product is not DOH-verified", () => {
    expect(
      toLeaflyItem(item({ id: "a" }), { medicallyEndorsed: true })?.variants[0].medical,
    ).toBe(false);
  });

  it("becomes true only when BOTH the store is endorsed and the product is verified", () => {
    expect(
      toLeaflyItem(item({ id: "a", dohCategory: "general_use" }), { medicallyEndorsed: true })
        ?.variants[0].medical,
    ).toBe(true);
  });

  it("cannot be asserted by anything on the variant itself", () => {
    // The L-11 defect was a value nothing could change; the naive repair is a
    // per-variant boolean, which is worse — any import could set it. Medical is
    // derived from the store and the registry, full stop.
    const sneaky = item({ id: "a" });
    (sneaky.variants[0] as unknown as Record<string, unknown>).medical = true;
    expect(toLeaflyItem(sneaky)?.variants[0].medical).toBe(false);
  });

  it("applies the same gate to a synthesized default variant", () => {
    const noVariants = item({ id: "edible", category: "edible", dohCategory: "general_use", variants: [] });
    expect(toLeaflyItem(noVariants)?.variants[0].medical).toBe(false);
    expect(toLeaflyItem(noVariants, { medicallyEndorsed: true })?.variants[0].medical).toBe(true);
  });

  it("keeps the two gates independent: an endorsed high_thc item is medical AND un-orderable", () => {
    const out = toLeaflyItem(item({ id: "ht", dohCategory: "high_thc" }), {
      pickupEnabled: true,
      medicallyEndorsed: true,
    });
    expect(out?.variants[0].medical).toBe(true);
    expect(out?.availableForPickup).toBe(false);
  });

  it("resolveVariantMedical fails closed on junk and on absence", () => {
    expect(resolveVariantMedical()).toBe(false);
    expect(resolveVariantMedical(undefined)).toBe(false);
    expect(resolveVariantMedical({ endorsed: true })).toBe(false);
    expect(
      resolveVariantMedical({ endorsed: true, dohCategory: "nonsense" as never }),
    ).toBe(false);
  });
});

describe("L-3 · the DOH category survives the syndication boundary", () => {
  it("carries a verified category from the source row onto the syndication item", () => {
    const mapped = toSyndicationItem({
      source_item_id: "p-1",
      name: "Tincture",
      brand_name: "Acme",
      category: "tincture",
      strain_type: null,
      strain_name: null,
      thc: null,
      cbd: null,
      description: null,
      price_minor_units: 4000,
      inventory_status: "in-stock",
      hidden: false,
      variants: [{ source_variant_id: "v", label: "30ml", price_minor_units: 4000, inventory_level: 4 }],
      doh_category: "high_thc",
    });
    expect(mapped.dohCategory).toBe("high_thc");
  });

  it("leaves it absent when the product has no registry row", () => {
    const mapped = toSyndicationItem({
      source_item_id: "p-2",
      name: "Flower",
      brand_name: null,
      category: "flower",
      strain_type: null,
      strain_name: null,
      thc: null,
      cbd: null,
      description: null,
      price_minor_units: 1500,
      inventory_status: "in-stock",
      hidden: false,
      variants: [{ source_variant_id: "v", label: "3.5g", price_minor_units: 1500, inventory_level: 4 }],
    });
    expect(mapped.dohCategory).toBeUndefined();
  });

  it("never invents a category — the end-to-end effect is a blocked pickup", () => {
    // This is the whole point of threading the field: a high_thc row in the POS
    // must end up un-orderable on Leafly without anyone remembering to do it.
    const src = toSyndicationItem({
      source_item_id: "p-3",
      name: "High-THC Capsules",
      brand_name: null,
      category: "edible",
      strain_type: null,
      strain_name: null,
      thc: null,
      cbd: null,
      description: null,
      price_minor_units: 5000,
      inventory_status: "in-stock",
      hidden: false,
      variants: [{ source_variant_id: "v", label: "10ct", price_minor_units: 5000, inventory_level: 9 }],
      doh_category: "high_thc",
    });
    const built = buildLeaflyItemsPayload([src], { pickupEnabled: true, medicallyEndorsed: true });
    expect(built.items[0].availableForPickup).toBe(false);
  });
});

describe("L-3 · the owner's settings", () => {
  it("defaults ordering OFF so merging this slice changes nothing for shoppers", () => {
    expect(DEFAULT_LEAFLY_SETTINGS.sendPickupAvailability).toBe(false);
    expect(resolveLeaflySettings(null).sendPickupAvailability).toBe(false);
  });

  it("reads a settings row saved before L-3 as OFF, never as undefined", () => {
    const old = resolveLeaflySettings({ pacingMs: 0, maxRetries: 3, syncMode: "post" });
    expect(old.sendPickupAvailability).toBe(false);
    expect(typeof old.sendPickupAvailability).toBe("boolean");
  });

  it("lets the owner turn ordering on and back off again", () => {
    expect(resolveLeaflySettings({ sendPickupAvailability: "on" }).sendPickupAvailability).toBe(true);
    expect(resolveLeaflySettings({ sendPickupAvailability: "false" }).sendPickupAvailability).toBe(false);
  });

  it("falls back to OFF for unrecognised input", () => {
    expect(resolveLeaflySettings({ sendPickupAvailability: "perhaps" }).sendPickupAvailability).toBe(false);
  });

  it("defaults images ON now that the v2 imageUrl field is proven to exist (L-10 tail)", () => {
    // The old default was false, justified by "Leafly v2 items payload has no
    // image field (verified)". The vendored schema defines `imageUrl`.
    expect(DEFAULT_LEAFLY_SETTINGS.sendImages).toBe(true);
  });
});

/**
 * The owner-facing explanation.
 *
 * A correct `availableForPickup` that nobody can see is only half the fix. If
 * the owner switches ordering on and three products stay unorderable because
 * they are High-THC, he must be told that in English, with their names --
 * otherwise the statutory gate looks like a bug and the pressure will be to
 * "fix" it. These tests hold that explanation to the same standard as the wire.
 */
describe("L-3 · the ordering summary the owner actually reads", () => {
  const menu: SyndicationItem[] = [
    item({ id: "ok-1", name: "Blue Dream 3.5g" }),
    item({ id: "ok-2", name: "Gelato 7g", dohCategory: "general_use" }),
    item({ id: "oos-1", name: "Sold Out Shatter", inStock: false }),
    item({ id: "doh-1", name: "RSO High-THC 1g", dohCategory: "high_thc" }),
  ];

  it("counts exactly what the payload will say, never a second opinion", () => {
    const summary = summarizeOrderability(menu, { pickupEnabled: true });
    const built = buildLeaflyItemsPayload(menu, { pickupEnabled: true });
    const orderableOnTheWire = built.items.filter(
      (i) => i.availableForPickup === true,
    ).length;

    // The anti-drift assertion. If someone changes one path and not the other,
    // this fails rather than quietly lying to the owner.
    expect(summary.orderable).toBe(orderableOnTheWire);
    expect(summary.orderable).toBe(2);
  });

  it("reconciles: orderable + blocked always equals the total", () => {
    for (const pickupEnabled of [true, false]) {
      const s = summarizeOrderability(menu, { pickupEnabled });
      const blocked = s.blocked.reduce((n, g) => n + g.count, 0);
      expect(s.orderable + blocked).toBe(s.total);
      expect(s.total).toBe(menu.length);
    }
  });

  it("names the High-THC product and cites the statute, so the gate is not mistaken for a bug", () => {
    const s = summarizeOrderability(menu, { pickupEnabled: true });
    const doh = s.blocked.find((g) => g.reason === "doh_restricted");
    expect(doh).toBeDefined();
    expect(doh?.count).toBe(1);
    expect(doh?.examples).toContain("RSO High-THC 1g");
    // WAC 246-70 must be quoted to him, not paraphrased away.
    expect(doh?.label).toContain("246-70");
    expect(doh?.label).toContain("recognition card");
  });

  it("separates a temporary stock problem from a permanent statutory one", () => {
    const s = summarizeOrderability(menu, { pickupEnabled: true });
    const reasons = s.blocked.map((g) => g.reason);
    expect(reasons).toContain("out_of_stock");
    expect(reasons).toContain("doh_restricted");
    // These must never be merged: one is fixed by restocking, the other never is.
    expect(s.blocked.find((g) => g.reason === "out_of_stock")?.examples).toContain(
      "Sold Out Shatter",
    );
  });

  it("when ordering is off, gives ONE answer instead of blaming the products", () => {
    const s = summarizeOrderability(menu, { pickupEnabled: false });
    expect(s.orderable).toBe(0);
    expect(s.blocked).toHaveLength(1);
    expect(s.blocked[0].reason).toBe("pickup_disabled");
    expect(s.blocked[0].count).toBe(menu.length);
    // It must not report the in-stock items as "out of stock" in this state.
    expect(s.blocked.map((g) => g.reason)).not.toContain("out_of_stock");
  });

  it("caps the examples so a 400-item menu cannot flood the admin page", () => {
    const big = Array.from({ length: 400 }, (_, i) =>
      item({ id: `x-${i}`, name: `Item ${i}`, inStock: false }),
    );
    const s = summarizeOrderability(big, { pickupEnabled: true });
    expect(s.blocked[0].count).toBe(400);
    expect(s.blocked[0].examples).toHaveLength(ORDERABILITY_SUMMARY_EXAMPLE_LIMIT);
  });

  it("lists the biggest cause first and stays stable between refreshes", () => {
    // The DOH item is fed FIRST deliberately. If the sort were ever dropped,
    // the groups would come out in accidental menu order and this smaller cause
    // would be displayed above the larger one -- so the assertion below only
    // passes because a real sort is happening, not because the input happened
    // to already be in the right order.
    const mixed = [
      item({ id: "d-1", dohCategory: "high_thc" }),
      ...Array.from({ length: 4 }, (_, i) => item({ id: `o-${i}`, inStock: false })),
    ];
    const first = summarizeOrderability(mixed, { pickupEnabled: true });
    const second = summarizeOrderability(mixed, { pickupEnabled: true });
    expect(first.blocked[0].reason).toBe("out_of_stock");
    // Deterministic ordering: the page must not reshuffle on every load.
    expect(first.blocked.map((g) => g.reason)).toEqual(second.blocked.map((g) => g.reason));
  });

  it("survives an empty feed without throwing", () => {
    const s = summarizeOrderability([], { pickupEnabled: true });
    expect(s).toEqual({ total: 0, orderable: 0, blocked: [] });
  });

  it("every group carries a human sentence, never a bare code", () => {
    const s = summarizeOrderability(menu, { pickupEnabled: true });
    for (const g of s.blocked) {
      expect(g.label).toBe(orderabilityReasonLabel(g.reason));
      expect(g.label.length).toBeGreaterThan(20);
      // A raw enum leaking into the UI would be a non-answer.
      expect(g.label).not.toBe(g.reason);
    }
  });
});
