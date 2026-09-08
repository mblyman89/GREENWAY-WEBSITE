/**
 * SLICE T1/T2/T3 — the liquid bucket is a SHELF, not two type strings.
 *
 * Three defects are pinned here, all of them measured before they were fixed:
 *
 *  T1  The L5 receiving gate fired on any liquid-bucket shelf with no derivable
 *      VOLUME. The statute puts salves in that bucket, but a balm tin is
 *      labelled "2oz" or "30g" and never in ml — so the gate asked for a number
 *      the package does not carry and REFUSED every weight-labelled salve.
 *
 *  T2  Topicals got no measurement at injection at all.
 *
 *  T3  The real root cause, and it is about DRINKS: injection keyed measurement
 *      off MG_FACT_TYPES / LIQUID_VOLUME_TYPES. Nine of the eleven inventory
 *      types that reach the ml-metered bucket were in NEITHER list, including
 *      Soda and Beverage, so an ordinary can was never measured and 72 of them
 *      sold — a 12x oversell.
 *
 * The statutory ground for all of it, WAC 314-55-095(1)(d)(i)(E), effective
 * 1/7/2025: "72 ounces of cannabis-infused product in liquid form for oral
 * ingestion or applied topically to the skin". One clause, one bucket, drinks
 * and salves together.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  assessReceivingVolume,
  validateReceivingVolumeChoice,
} from "@/lib/inventory/receiving-classification-core";
import {
  deriveNetVolumeMl,
  deriveNetWeightGrams,
} from "@/lib/compliance/liquid-volume-derivation-core";
import { extractNameFacts } from "@/lib/inventory/fact-extraction-core";
import { categoryToBucket, evaluateCart } from "@/lib/compliance/sales-limits-core";
import { resolveWebsiteCategory } from "@/lib/inventory/website-category-resolver";
import { INVENTORY_TYPE_CATALOG } from "@/lib/pos/inventory-type-catalog";
import { buildDraftInjectionPlan } from "@/lib/pos/draft-injection-core";
import type {
  ApprovedDraftForInjection,
  DraftEnrichment,
} from "@/lib/pos/draft-injection-core";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

/** Assess a real product name exactly the way both production callers do. */
function assessByName(name: string, category: string) {
  const facts = extractNameFacts(name);
  return assessReceivingVolume({
    resolvedWebsiteCategory: category,
    derivedVolumeMl: deriveNetVolumeMl({
      rawName: name,
      sizes: facts.sizes,
      packCount: facts.packCount,
    }).netVolumeMl,
    derivedWeightGrams: deriveNetWeightGrams(facts.sizes),
  });
}

/** Push one draft through the real injection planner. */
function inject(name: string, inventoryType: string, websiteCategory: string) {
  const draft = {
    id: "d1",
    pos_product_key: "KEY-1",
    name,
    brand_name: "Brand",
    vendor_name: "Vendor",
    strain_name: null,
    thc_pct: null,
    cbd_pct: null,
    total_thc_pct: null,
    potency_json: null,
    price_minor_units: 1000,
    updated_at: "2026-01-01T00:00:00Z",
    inventory_type: inventoryType,
  } as unknown as ApprovedDraftForInjection;
  const enrichment = new Map<string, DraftEnrichment>([
    [
      "d1",
      {
        websiteCategory,
        strainType: null,
        onHandQty: 5,
        packageLabel: "each",
      } as DraftEnrichment,
    ],
  ]);
  const plan = buildDraftInjectionPlan({
    drafts: [draft],
    existingKeys: new Set<string>(),
    enrichmentByDraftId: enrichment,
    baseSortOrder: 100,
  });
  const item = plan.items[0] as unknown as Record<string, unknown> | undefined;
  return {
    netVolumeMl: (item?.net_volume_ml ?? null) as number | null,
    netWeightGrams: (item?.net_weight_grams ?? null) as number | null,
    missingDiagnostics: plan.diagnostics.filter((d) => d.code === "net_volume_missing"),
  };
}

// ===========================================================================
describe("T1 — a weight-labelled salve is already measured", () => {
  // These are real WA shelf products. Every one of them was UNONBOARDABLE
  // before this slice: the gate fired and there was no honest answer, because
  // converting weight-oz to ml needs a density nobody has.
  const salves: Array<[string, number]> = [
    ["Fairwinds Flow Cream 2oz", 56.699],
    ["Ceres Wellness Balm 1.7oz", 48.1942],
    ["Green Revolution Sublime Salve 30g", 30],
  ];

  it.each(salves)("onboards %s without inventing a volume", (name, grams) => {
    const a = assessByName(name, "topical");
    expect(a.isVolumeMeteredShelf).toBe(true);
    // The weight is what makes it measured. The volume stays honestly null —
    // no density was invented to manufacture one.
    expect(a.derivedVolumeMl).toBeNull();
    expect(a.derivedWeightGrams).toBeCloseTo(grams, 3);
    expect(a.hasUsableMeasure).toBe(true);
    expect(a.needsVolumePick).toBe(false);
    expect(validateReceivingVolumeChoice({ assessment: a }).ok).toBe(true);
  });

  it("still onboards a volume-labelled topical (a roll-on is in ml)", () => {
    const a = assessByName("Zoots Zootrx Releaf Balm 50ml", "topical");
    expect(a.derivedVolumeMl).toBe(50);
    expect(a.needsVolumePick).toBe(false);
  });

  it("STILL gates a topical with no size at all — fail-closed is intact", () => {
    const a = assessByName("Fairwinds Relief Balm", "topical");
    expect(a.derivedVolumeMl).toBeNull();
    expect(a.derivedWeightGrams).toBeNull();
    expect(a.hasUsableMeasure).toBe(false);
    expect(a.needsVolumePick).toBe(true);
    const r = validateReceivingVolumeChoice({ assessment: a });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("volume_required");
  });

  it("STILL gates a DRINK with no size — the L5 guarantee cannot regress", () => {
    const a = assessByName("Mystery Tonic", "edible-liquid");
    expect(a.needsVolumePick).toBe(true);
    expect(validateReceivingVolumeChoice({ assessment: a }).ok).toBe(false);
  });

  it("a bare ounce is STILL not a volume anywhere in the chain", () => {
    // The weight path must not become a back door for the bare-ounce guess the
    // whole liquids round refused to make.
    const facts = extractNameFacts("Fairwinds Flow Cream 2oz");
    const vol = deriveNetVolumeMl({
      rawName: "Fairwinds Flow Cream 2oz",
      sizes: facts.sizes,
      packCount: facts.packCount,
    });
    expect(vol.netVolumeMl).toBeNull();
  });

  it("junk weights are not measurements", () => {
    for (const junk of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const a = assessReceivingVolume({
        resolvedWebsiteCategory: "topical",
        derivedVolumeMl: null,
        derivedWeightGrams: junk,
      });
      expect(a.derivedWeightGrams, String(junk)).toBeNull();
      expect(a.needsVolumePick, String(junk)).toBe(true);
    }
  });

  it("leaves non-liquid shelves completely alone", () => {
    for (const cat of ["flower", "concentrate", "edible-solid", "preroll", "accessories"]) {
      const a = assessReceivingVolume({
        resolvedWebsiteCategory: cat,
        derivedVolumeMl: null,
        derivedWeightGrams: null,
      });
      expect(a.isVolumeMeteredShelf, cat).toBe(false);
      expect(a.needsVolumePick, cat).toBe(false);
    }
  });
});

// ===========================================================================
describe("T1 — the weight carries across EXACTLY, no density invented", () => {
  // The reason a weight is a complete answer: lineMl() converts an ounce-count
  // to an ounce-count. If this ever stops being exact, the gate is accepting a
  // measure the engine cannot honour.
  const cases: Array<[number, number]> = [
    [1, 72],
    [1.7, 42],
    [2, 36],
    [4, 18],
    [8, 9],
  ];

  it.each(cases)("a %s oz salve still allows exactly %i units", (oz, legal) => {
    const perUnitGrams = oz * 28; // statutory ounce equivalence, not a density
    let last = 0;
    for (let q = 1; q <= 500; q += 1) {
      const r = evaluateCart([
        { category: "topical", quantity: q, grams: perUnitGrams * q } as never,
      ]);
      const b = r.buckets.find((x) => x.bucket === "liquid_edible");
      if (b && !b.exceeded) last = q;
      else break;
    }
    expect(last).toBe(legal);
  });

  it("a salve and a drink SHARE one bucket, exactly as the statute says", () => {
    // Clause (E) is one limit covering both. If they ever stop sharing, a
    // customer could take a full 72 oz of drink AND a pile of salve.
    const r = evaluateCart([
      { category: "topical", quantity: 1, grams: 8 * 28 } as never,
      { category: "edible-liquid", quantity: 1, volumeMl: 750 } as never,
    ]);
    const buckets = r.buckets.filter((b) => b.bucket === "liquid_edible");
    expect(buckets).toHaveLength(1);
    expect(buckets[0].used).toBeGreaterThan(750);
  });
});

// ===========================================================================
describe("T3 — EVERY inventory type that reaches the bucket gets measured", () => {
  it("enumerates the bucket from the live resolver, not from a fixed list", () => {
    // Grounding assertion: if someone adds a new liquid type, it appears here
    // automatically and the coverage test below will exercise it.
    const labels = Array.from(new Set(INVENTORY_TYPE_CATALOG.map((e) => e.label)));
    const inBucket = labels.filter(
      (l) =>
        categoryToBucket(
          resolveWebsiteCategory({ inventoryType: l, productName: "Product" }).websiteCategory,
        ) === "liquid_edible",
    );
    // Measured at the time of writing: far more than the two the old lists knew.
    expect(inBucket.length).toBeGreaterThanOrEqual(8);
    for (const expected of ["Soda", "Beverage", "Topical", "Bath Salts", "Roll On"]) {
      expect(inBucket, `${expected} must reach the liquid bucket`).toContain(expected);
    }
  });

  // Each of these was measured as recording NOTHING before this slice.
  const previouslyUnmeasured: Array<[string, string, string, "ml" | "g", number]> = [
    ["Craft Soda 12 fl oz", "Soda", "edible-liquid", "ml", 354.882],
    ["Hi-Fi Hops 355ml", "Beverage", "edible-liquid", "ml", 355],
    ["Wellness Shot 2 fl oz", "Shots", "edible-liquid", "ml", 59.147],
    ["Roll On 10ml", "Roll On", "topical", "ml", 10],
    ["Relief Balm 2oz", "Topical", "topical", "g", 56.699],
    ["Bath Soak 8oz", "Bath Salts", "topical", "g", 226.7962],
  ];

  it.each(previouslyUnmeasured)(
    "%s (%s) is now measured at injection",
    (name, invType, cat, unit, expected) => {
      const r = inject(name, invType, cat);
      if (unit === "ml") {
        expect(r.netVolumeMl).toBeCloseTo(expected, 3);
      } else {
        expect(r.netWeightGrams).toBeCloseTo(expected, 3);
      }
      expect(r.missingDiagnostics).toHaveLength(0);
    },
  );

  it("a 12 fl oz soda is a VOLUME, never 12 weight-ounces", () => {
    // The difference between these two readings is the whole bug: 354.882 ml
    // vs 12 * 28 = 336 g carried across. Pin the fluid reading explicitly.
    const r = inject("Craft Soda 12 fl oz", "Soda", "edible-liquid");
    expect(r.netVolumeMl).toBeCloseTo(12 * 29.5735, 3);
    expect(r.netVolumeMl).not.toBeCloseTo(12 * 28, 0);
  });

  it("the types that already worked did NOT move", () => {
    expect(inject("Lemonade 750ml", "Liquid Edible", "edible-liquid").netVolumeMl).toBe(750);
    expect(inject("Tincture 30ml", "Tincture", "edible-liquid").netVolumeMl).toBe(30);
  });

  // T4: the FIRST cut of this slice warned twice for one fault on the two
  // types the OLD list also covered (Liquid Edible, Tincture) — the new bucket
  // pass and the old L5 block both fired. Testing only "Soda" hid it, because
  // Soda was never on the old list. Every type in the bucket is checked now.
  const bucketTypes: Array<[string, string, string]> = [
    ["Mystery Tonic", "Liquid Edible", "edible-liquid"],
    ["Mystery Tincture", "Tincture", "edible-liquid"],
    ["Mystery Soda", "Soda", "edible-liquid"],
    ["Mystery Drink", "Beverage", "edible-liquid"],
    ["Mystery Balm", "Topical", "topical"],
    ["Mystery Soak", "Bath Salts", "topical"],
  ];

  it.each(bucketTypes)(
    "%s (%s) with no derivable size warns EXACTLY once — never twice",
    (name, invType, cat) => {
      const r = inject(name, invType, cat);
      expect(r.netVolumeMl).toBeNull();
      expect(r.netWeightGrams).toBeNull();
      // One fault is one warning. A duplicate trains the dock to ignore them.
      expect(r.missingDiagnostics).toHaveLength(1);
      expect(r.missingDiagnostics[0].severity).toBe("warning");
      expect(r.missingDiagnostics[0].message).toMatch(/72 fl oz/);
    },
  );

  it("a WEIGHT-measured liquid raises no missing-size warning at all", () => {
    // The removed L5 block keyed on the VOLUME being null, so it warned about
    // a 1.7 oz salve that the weight had already measured perfectly well.
    const r = inject("A.C. Topical Salve 1.7 oz", "Topical Ointment", "topical");
    expect(r.netWeightGrams).toBeCloseTo(1.7 * 28.349523125, 3);
    expect(r.missingDiagnostics).toHaveLength(0);
  });

  it("only ONE place in injection owns the missing-size warning", () => {
    // Two owners is how the duplicate happened. Keep it at one.
    const src = read("src/lib/pos/draft-injection-core.ts");
    const sites = src.match(/code: "net_volume_missing"/g) ?? [];
    expect(sites).toHaveLength(1);
  });

  it("never invents a measurement for a non-liquid product", () => {
    const r = inject("Blue Dream 3.5g", "Usable Cannabis", "flower");
    expect(r.netVolumeMl).toBeNull();
    expect(r.missingDiagnostics).toHaveLength(0);
  });

  it("the oversell it closes: 72 unmeasured cans used to pass", () => {
    // The pre-fix behaviour, reproduced from the fallback path. This is what a
    // Soda looked like at the register when injection recorded nothing.
    const unmeasured = evaluateCart([
      { category: "edible-liquid", quantity: 72, grams: null, volumeMl: null } as never,
    ]);
    expect(unmeasured.buckets.find((b) => b.bucket === "liquid_edible")?.exceeded).toBe(false);

    // The same 72 cans, now that a 12 fl oz can is actually measured.
    const measured = evaluateCart([
      { category: "edible-liquid", quantity: 72, volumeMl: 354.882 * 72 } as never,
    ]);
    const b = measured.buckets.find((x) => x.bucket === "liquid_edible");
    expect(b?.exceeded).toBe(true);
    expect(b?.used).toBeGreaterThan(25000); // 864 fl oz against a 72 fl oz cap
  });
});

// ===========================================================================
describe("T1/T3 — the wiring, without which none of this reaches production", () => {
  it("both gate call sites pass the derived weight", () => {
    const server = read("src/lib/inventory/catalog-drafts.ts");
    expect(server).toContain("const derivedWeightGrams = deriveNetWeightGrams(derivedFacts.sizes);");
    expect(server).toMatch(
      /assessReceivingVolume\(\{[\s\S]*?derivedWeightGrams,[\s\S]*?\}\)/,
    );
    const page = read("src/app/admin/inventory/drafts/page.tsx");
    expect(page).toContain("derivedWeightGrams: deriveNetWeightGrams(facts.sizes)");
  });

  it("the weight is derived from the SAME sizes array as the volume", () => {
    // Two parsers would drift; the gate would then ask about a size the
    // injection already knew, or stay silent about one it did not.
    const server = read("src/lib/inventory/catalog-drafts.ts");
    expect(server).toContain("deriveNetWeightGrams(derivedFacts.sizes)");
    expect(server).toContain("sizes: derivedFacts.sizes,");
  });

  it("injection scopes measurement by BUCKET, not by inventory-type list", () => {
    const src = read("src/lib/pos/draft-injection-core.ts");
    expect(src).toContain('if (categoryToBucket(websiteCategory) === "liquid_edible") {');
    // The old list must no longer be what decides who gets measured.
    expect(src).not.toMatch(/if \(LIQUID_VOLUME_TYPES\.has\(invType\)\) \{\s*const bucketFacts/);
  });

  it("the bucket pass FILLS GAPS and never overwrites an existing measure", () => {
    // Overwriting would let this pass undo a human measurement carried by L5.
    const src = read("src/lib/pos/draft-injection-core.ts");
    expect(src).toMatch(/if \(categoryToBucket\(websiteCategory\) === "liquid_edible"\) \{[\s\S]*?if \(netVolumeMl === null\) \{/);
    expect(src).toMatch(/if \(netWeightGrams === null\) \{/);
  });

  it("the statutory reason topicals stay in the bucket is written down", () => {
    // A future reader will have the same instinct the owner had. The reason
    // has to be in the file, not in a chat log.
    const src = read("tests/compliance/liquid-limit-ml-engine.test.ts");
    expect(src).toContain("APPLIED TOPICALLY TO THE SKIN");
    expect(src).toContain("314-55-095");
  });

  it("the stale 'later slice moves them' claim is gone from the derivation doc", () => {
    const src = read("src/lib/compliance/liquid-volume-derivation-core.ts");
    expect(src).not.toContain("stays on WEIGHTED ounces by owner decision");
    expect(src).toContain("DO NOT USE THIS SET TO DECIDE WHO GETS MEASURED");
  });
});
