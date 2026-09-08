/**
 * tests/compliance/liquid-volume-plumbing.test.ts  (SLICE L3)
 *
 * THE PLUMBING TEST for the liquid volume fact.
 *
 * L1 rebased the liquid limit onto millilitres and L2 taught every size parser
 * to read litres. Both were correct and both were UNREACHABLE, because nothing
 * in the receiving pipeline ever produced a net_volume_ml: the fact site never
 * derived one, and intake-menu-staging-core.ts hardcoded `net_volume_ml: null`
 * on top of whatever it might have carried. So every received liquid arrived
 * at the register with an unknown size and the engine substituted a 28 g
 * category default — a 1.5 L bottle counted as one ounce.
 *
 * That is the SLICE 18-0 lesson repeating: a rule nobody can invoke is
 * indistinguishable from no rule at all. So this file does not re-test the
 * arithmetic (liquid-volume-core.test.ts and the derivation module's own
 * self-tests do that). It proves the fact is CONNECTED, hop by hop, and that
 * no stage quietly drops it.
 *
 * Pure stages are exercised for real. Stages behind a database are asserted
 * against their SOURCE — deliberately, because a mock would prove my test
 * double works, not that the pipeline does.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDraftInjectionPlan,
  type ApprovedDraftForInjection,
} from "@/lib/pos/draft-injection-core";
import { buildIntakeMasteringPlan } from "@/lib/pos/intake-mastering-core";
import { buildIntakeStagedVersionPlan } from "@/lib/pos/intake-menu-staging-core";
import {
  deriveNetVolumeMl,
  deriveNetWeightGrams,
  LIQUID_VOLUME_TYPES,
} from "@/lib/compliance/liquid-volume-derivation-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// Statute constants derived HERE, independently, so this file cannot pass by
// re-importing the same wrong number the implementation uses.
const STATUTE_FLOZ_TO_ML = 29.5735;
const STATUTE_REC_FLOZ = 72;
const REC_ML = STATUTE_REC_FLOZ * STATUTE_FLOZ_TO_ML; // 2129.292

// ---------------------------------------------------------------------------
// STAGE 1 — the derivation itself, on the shapes the extractor really emits
// ---------------------------------------------------------------------------
describe("SLICE L3 — stage 1: a package volume is derived from the name", () => {
  it("multiplies an 'N x volume' carton instead of recording one bottle", () => {
    // THE bug this module exists for. Verified against the live extractor:
    // "4 x 50ml" reports a SINGLE 50 ml size and NO packCount, so the naive
    // `sizes[0]` read records a 200 ml carton as 50 ml — a 4x oversell.
    const d = deriveNetVolumeMl({
      rawName: "Ray's Lemonade 4 x 50ml",
      sizes: [{ quantity: 50, unit: "ml" }],
      packCount: null,
    });
    expect(d.netVolumeMl).toBeCloseTo(200, 4);
    expect(d.perUnitMl).toBeCloseTo(50, 4);
    expect(d.packCount).toBe(4);
    expect(d.source).toBe("name-pack");
  });

  it("resolves the no-space spelling the extractor cannot see at all", () => {
    // "4x50ml" yields sizes: [] from the extractor. Without the raw-name
    // pattern this is a silent null.
    const d = deriveNetVolumeMl({ rawName: "Ray's Lemonade 4x50ml", sizes: [], packCount: null });
    expect(d.netVolumeMl).toBeCloseTo(200, 4);
  });

  it("applies an extractor-reported pack count to a per-unit volume", () => {
    // A 6-pack of 12 fl oz is 72 fl oz — the ENTIRE daily limit in one carton.
    const d = deriveNetVolumeMl({
      rawName: "Legal Cherry 6 Pack 12 fl oz",
      sizes: [{ quantity: 12, unit: "floz" }],
      packCount: 6,
    });
    expect(d.netVolumeMl).toBeCloseTo(REC_ML, 2);
    expect(d.packCount).toBe(6);
  });

  it("refuses to read bare ounces as a volume, in EITHER direction", () => {
    // "1.7 oz" on a salve is weight; "12 oz" on a root beer is almost
    // certainly fluid. The name alone cannot distinguish them, so guessing
    // would either invent a volume for a salve or undercount a drink.
    for (const name of ["A.C. Topical Salve 1.7 oz", "Mirth Legal Root Beer 12 oz"]) {
      const d = deriveNetVolumeMl({
        rawName: name,
        sizes: [{ quantity: name.includes("Salve") ? 1.7 : 12, unit: "oz" }],
        packCount: null,
      });
      expect(d.netVolumeMl).toBeNull();
      expect(d.reasons).toContain("bare_ounces_present");
    }
  });

  it("resolves a genuine conflict UPWARD, because bigger allows fewer packages", () => {
    const d = deriveNetVolumeMl({
      rawName: "Mystery Syrup 100ml 750ml",
      sizes: [
        { quantity: 100, unit: "ml" },
        { quantity: 750, unit: "ml" },
      ],
      packCount: null,
    });
    expect(d.netVolumeMl).toBeCloseTo(750, 4);
    expect(d.confidence).toBe("ambiguous");
    // The fail direction is the whole point: had it resolved DOWNWARD to 100,
    // the register would allow 21 bottles of a 750 ml syrup (15.75 L).
    expect(Math.floor(REC_ML / 750)).toBe(2);
  });

  it("treats the same volume restated in two units as one volume", () => {
    const d = deriveNetVolumeMl({
      rawName: "Elixir 100ml 3.4 fl oz",
      sizes: [
        { quantity: 3.4, unit: "floz" },
        { quantity: 100, unit: "ml" },
      ],
      packCount: null,
    });
    expect(d.reasons).not.toContain("conflicting_volumes");
    expect(d.confidence).toBe("verified");
  });

  it("never mistakes a dose statement for a volume", () => {
    expect(
      deriveNetVolumeMl({ rawName: "Gummies 10 x 20mg", sizes: [], packCount: null }).netVolumeMl,
    ).toBeNull();
  });

  it("converts 'N x fl oz' by the statute constant, not as millilitres", () => {
    // GAP FOUND BY MUTATION M8: unitWordToVolumeUnit() is reached ONLY from
    // the raw-name "N x volume" branch, so mapping floz->ml there survived
    // every other test. 12 fl oz read as 12 ml is a 177x oversell.
    const d = deriveNetVolumeMl({ rawName: "Vitalis Shot 2 x 2 fl oz", sizes: [], packCount: null });
    expect(d.netVolumeMl).toBeCloseTo(4 * STATUTE_FLOZ_TO_ML, 3);
    expect(d.netVolumeMl).not.toBeCloseTo(4, 1);
    const c = deriveNetVolumeMl({ rawName: "Carton 6 x 12 fl oz", sizes: [], packCount: null });
    expect(c.netVolumeMl).toBeCloseTo(REC_ML, 2);
  });

  it("never counts grams as millilitres", () => {
    // GAP FOUND BY MUTATION M7: pushing gram sizes into the volume list
    // survived, because no vitest case fed a gram-only size in.
    const d = deriveNetVolumeMl({
      rawName: "Cannasol Rick Simpson Oil 1g",
      sizes: [{ quantity: 1, unit: "g" }],
      packCount: null,
    });
    expect(d.netVolumeMl).toBeNull();
    expect(d.reasons).toContain("no_volume_in_name");
    // A 1 g RSO syringe read as 1 ml would allow 2,129 of them.
    const big = deriveNetVolumeMl({
      rawName: "Bulk Oil 500g",
      sizes: [{ quantity: 500, unit: "g" }],
      packCount: null,
    });
    expect(big.netVolumeMl).toBeNull();
  });

  it("refuses a zero or negative stated volume", () => {
    // A 0 ml volume would divide the cap by zero and allow infinite packages.
    expect(
      deriveNetVolumeMl({ rawName: "x 0ml", sizes: [{ quantity: 0, unit: "ml" }], packCount: null })
        .netVolumeMl,
    ).toBeNull();
    expect(
      deriveNetVolumeMl({ rawName: "y", sizes: [{ quantity: -5, unit: "ml" }], packCount: null })
        .netVolumeMl,
    ).toBeNull();
    expect(deriveNetWeightGrams([{ quantity: 0, unit: "g" }])).toBeNull();
    expect(deriveNetWeightGrams([{ quantity: -3, unit: "oz" }])).toBeNull();
  });

  it("never lets a bare 'l' swallow the L of a word", () => {
    expect(
      deriveNetVolumeMl({ rawName: "4 x 2 Lemonade", sizes: [], packCount: null }).netVolumeMl,
    ).toBeNull();
    expect(
      deriveNetVolumeMl({ rawName: "2 x 1 Liter", sizes: [], packCount: null }).netVolumeMl,
    ).toBeCloseTo(2000, 4);
  });

  it("keeps weight and volume in separate lanes", () => {
    const sizes = [{ quantity: 1.7, unit: "oz" as const }];
    expect(deriveNetWeightGrams(sizes)).toBeCloseTo(1.7 * 28.349523125, 4);
    expect(deriveNetVolumeMl({ rawName: "Salve 1.7 oz", sizes, packCount: null }).netVolumeMl).toBeNull();
  });

  it("scopes the volume-limited types to liquids, leaving topicals alone", () => {
    // The owner's decision: topicals stay on WEIGHTED ounces until their own
    // slice. If someone adds "Topical Ointment" here, that decision has been
    // pre-empted silently.
    expect(LIQUID_VOLUME_TYPES.has("Liquid Edible")).toBe(true);
    expect(LIQUID_VOLUME_TYPES.has("Tincture")).toBe(true);
    expect(LIQUID_VOLUME_TYPES.has("Topical Ointment")).toBe(false);
    expect(LIQUID_VOLUME_TYPES.has("Solid Edible")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// STAGE 2 — the receiving planner (pure; exercised for real)
// ---------------------------------------------------------------------------
describe("SLICE L3 — stage 2: the planned item carries the volume", () => {
  const draft = (over: Partial<ApprovedDraftForInjection> = {}): ApprovedDraftForInjection => ({
    id: "d1",
    pos_product_key: "PK-LIQ",
    name: "Fairwinds Sleepy Time Tincture 30ml",
    brand_name: "Fairwinds",
    vendor_name: "Fairwinds Mfg",
    strain_name: null,
    thc_pct: null,
    cbd_pct: null,
    total_thc_pct: null,
    potency_json: null,
    price_minor_units: 3000,
    updated_at: "2025-06-01T00:00:00Z",
    inventory_type: "Tincture",
    chosen_website_category: "tincture",
    ...over,
  });

  const plan = (d: ApprovedDraftForInjection) =>
    buildDraftInjectionPlan({
      drafts: [d],
      existingKeys: new Set<string>(),
      enrichmentByDraftId: new Map([
        [d.id, { websiteCategory: d.chosen_website_category ?? "tincture", strainType: null, onHandQty: 5, packageLabel: "each" }],
      ]),
      baseSortOrder: 0,
    });

  it("derives 30 ml for a 30ml tincture and tags its provenance", () => {
    const p = plan(draft());
    expect(p.items).toHaveLength(1);
    expect(p.items[0].net_volume_ml).toBeCloseTo(30, 4);
    expect(p.items[0].fact_provenance.net_volume_ml).toBe("name");
  });

  it("derives 1000 ml for a 1L bottle — the L2 fix reaching the limit", () => {
    // The headline case. Before L1/L2/L3 this bottle had no volume, no litre
    // parsing, and a grams-based limit, so the register allowed 72 of them.
    const p = plan(draft({ name: "Happy Apple Cider 1L", inventory_type: "Liquid Edible", chosen_website_category: "edible-liquid" }));
    expect(p.items[0].net_volume_ml).toBeCloseTo(1000, 4);
    expect(Math.floor(REC_ML / (p.items[0].net_volume_ml as number))).toBe(2);
  });

  it("derives the MULTIPLIED volume for a carton, through the real planner", () => {
    const p = plan(draft({ name: "Ray's Lemonade 4 x 50ml", inventory_type: "Liquid Edible", chosen_website_category: "edible-liquid" }));
    expect(p.items[0].net_volume_ml).toBeCloseTo(200, 4);
    expect(p.items[0].fact_provenance.net_volume_ml).toBe("name-pack");
  });

  it("raises a confirmation diagnostic for a multiplied carton", () => {
    const p = plan(draft({ name: "Ray's Lemonade 4 x 50ml", inventory_type: "Liquid Edible", chosen_website_category: "edible-liquid" }));
    const d = p.diagnostics.find((x) => x.code === "net_volume_needs_confirmation");
    expect(d).toBeTruthy();
    expect(d?.severity).toBe("warning");
    // It must carry enough for a human to answer without re-deriving.
    expect(d?.context?.netVolumeMl).toBeCloseTo(200, 4);
    expect(d?.context?.perUnitMl).toBeCloseTo(50, 4);
    expect(d?.context?.packCount).toBe(4);
  });

  it("still RECORDS the fail-closed volume while it awaits confirmation", () => {
    // An unanswered question must never be the thing that lets an oversell
    // through. The diagnostic asks; the number already protects.
    const p = plan(draft({ name: "Ray's Lemonade 4 x 50ml", inventory_type: "Liquid Edible", chosen_website_category: "edible-liquid" }));
    expect(p.items[0].net_volume_ml).not.toBeNull();
  });

  it("flags a liquid whose volume could NOT be derived", () => {
    const p = plan(draft({ name: "Mystery Drink", inventory_type: "Liquid Edible", chosen_website_category: "edible-liquid" }));
    expect(p.items[0].net_volume_ml).toBeNull();
    const d = p.diagnostics.find((x) => x.code === "net_volume_missing");
    expect(d).toBeTruthy();
    expect(d?.message).toMatch(/72 fl oz/);
  });

  it("does NOT flag a solid edible for a missing volume", () => {
    const p = plan(draft({ name: "Wyld Gummies 10 x 10mg", inventory_type: "Solid Edible", chosen_website_category: "edible" }));
    expect(p.diagnostics.find((x) => x.code === "net_volume_missing")).toBeUndefined();
  });

  it("records a net weight for a weight-labelled product without inventing a volume", () => {
    const p = plan(draft({ name: "A.C. Topical Salve 1.7 oz", inventory_type: "Topical Ointment", chosen_website_category: "topical" }));
    expect(p.items[0].net_weight_grams).toBeCloseTo(1.7 * 28.349523125, 3);
    expect(p.items[0].net_volume_ml).toBeNull();
    expect(p.items[0].fact_provenance.net_weight_grams).toBe("name");
  });

  it("leaves the volume null rather than zero when nothing is known", () => {
    // null = "nobody knows". 0 would be a claim, and a claim of zero volume
    // would divide the limit by zero or allow infinite packages.
    const p = plan(draft({ name: "Unlabelled Item", inventory_type: "Solid Edible", chosen_website_category: "edible" }));
    expect(p.items[0].net_volume_ml).toBeNull();
    expect(p.items[0].net_volume_ml).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// STAGE 3 — mastering: the fact must reach inventory_lots as well
// ---------------------------------------------------------------------------
describe("SLICE L3 — stage 3: the lot fact bundle carries the volume", () => {
  const masterPlan = (name: string, invType: string) =>
    buildIntakeMasteringPlan({
      drafts: [
        {
          id: "d1",
          pos_product_key: "PK-LIQ",
          name,
          brand_name: "Fairwinds",
          vendor_name: "Fairwinds Mfg",
          strain_name: null,
          thc_pct: null,
          cbd_pct: null,
          total_thc_pct: null,
          potency_json: null,
          price_minor_units: 3000,
          updated_at: "2025-06-01T00:00:00Z",
          inventory_type: invType,
          chosen_website_category: "edible-liquid",
        },
      ],
      existingKeys: new Set<string>(),
      enrichmentByDraftId: new Map([
        ["d1", { websiteCategory: "edible-liquid", strainType: null, onHandQty: 5, packageLabel: "each" }],
      ]),
      liveCards: [],
    });

  it("puts the volume in lotFactsByKey so the golden record agrees with the menu", () => {
    const p = masterPlan("Happy Apple Cider 1L", "Liquid Edible");
    const facts = p.lotFactsByKey.get("PK-LIQ");
    expect(facts).toBeTruthy();
    expect(facts?.net_volume_ml).toBeCloseTo(1000, 4);
  });

  it("keeps a bottle whose ONLY fact is its size", () => {
    // Before L3 the bundle gate required one of the five SLICE 62 facts, so a
    // product with a volume and nothing else was dropped entirely — losing
    // precisely the fact the sales limit is measured from.
    const p = masterPlan("Zoots Zooties Drink 750 ml", "Liquid Edible");
    const facts = p.lotFactsByKey.get("PK-LIQ");
    expect(facts).toBeTruthy();
    expect(facts?.net_volume_ml).toBeCloseTo(750, 4);
    expect(facts?.servings_per_pack).toBeNull();
    expect(facts?.mg_per_serving).toBeNull();
    expect(facts?.package_thc_mg).toBeNull();
    expect(facts?.ratio_label).toBeNull();
  });

  it("carries the volume onto the new card itself", () => {
    const p = masterPlan("Happy Apple Cider 1L", "Liquid Edible");
    expect(p.newCards).toHaveLength(1);
    expect(p.newCards[0].net_volume_ml).toBeCloseTo(1000, 4);
  });
});

// ---------------------------------------------------------------------------
// STAGE 4 — the staged snapshot: the hardcoded null
// ---------------------------------------------------------------------------
describe("SLICE L3 — stage 4: the snapshot no longer overwrites the volume", () => {
  const src = read("src/lib/pos/intake-menu-staging-core.ts");

  it("does not hardcode net_volume_ml to null anywhere", () => {
    // The exact defect: `net_volume_ml: null,` sat in masteredToSnapshot()
    // while the carry-forward mapper 90 lines below mapped it correctly, so a
    // CARRIED card kept its volume and a NEWLY RECEIVED one lost it.
    expect(src).not.toMatch(/net_volume_ml:\s*null,/);
    expect(src).not.toMatch(/net_weight_grams:\s*null,/);
  });

  it("maps it from the mastered card", () => {
    expect(src).toMatch(/net_volume_ml:\s*it\.net_volume_ml\s*\?\?\s*null,/);
    expect(src).toMatch(/net_weight_grams:\s*it\.net_weight_grams\s*\?\?\s*null,/);
  });

  it("carries the volume through a real staging plan, intake AND carried", () => {
    const plan = buildIntakeStagedVersionPlan({
      publishedItems: [],
      approvedDrafts: [
        {
          id: "d1",
          pos_product_key: "PK-LIQ",
          name: "Happy Apple Cider 1L",
          brand_name: "Happy Apple",
          vendor_name: "Happy Apple Co",
          strain_name: null,
          thc_pct: null,
          cbd_pct: null,
          total_thc_pct: null,
          potency_json: null,
          price_minor_units: 1800,
          updated_at: "2025-06-01T00:00:00Z",
          inventory_type: "Liquid Edible",
          chosen_website_category: "edible-liquid",
        },
      ],
      enrichmentByDraftId: new Map([
        ["d1", { websiteCategory: "edible-liquid", strainType: null, onHandQty: 4, packageLabel: "each" }],
      ]),
    });
    const staged = plan.items.find((i) => i.source_item_id === "PK-LIQ");
    expect(staged).toBeTruthy();
    expect(staged?.origin).toBe("intake");
    // THE assertion this whole slice is for: the volume survives to the row
    // that gets INSERTed into menu_items.
    expect(staged?.net_volume_ml).toBeCloseTo(1000, 4);
  });
});

// ---------------------------------------------------------------------------
// STAGE 5 — persistence: the executor must actually write the columns
// ---------------------------------------------------------------------------
describe("SLICE L3 — stage 5: the columns are written", () => {
  it("writes net_volume_ml onto inventory_lots with the other lot facts", () => {
    const src = read("src/lib/pos/intake-menu-staging.ts");
    expect(src).toMatch(/net_volume_ml:\s*facts\.net_volume_ml,/);
    expect(src).toMatch(/net_weight_grams:\s*facts\.net_weight_grams,/);
  });

  it("writes net_volume_ml onto menu_items", () => {
    const src = read("src/lib/pos/intake-menu-staging.ts");
    expect(src.match(/net_volume_ml:\s*it\.net_volume_ml,/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("has the columns to write to (migration 0138, no new migration needed)", () => {
    const sql = read("supabase/migrations/0138_structured_product_facts.sql");
    expect(sql).toMatch(/inventory_lots add column if not exists net_volume_ml/);
    expect(sql).toMatch(/menu_items add column if not exists net_volume_ml/);
  });
});

// ---------------------------------------------------------------------------
// STAGE 6 — the read path: register and website
// ---------------------------------------------------------------------------
describe("SLICE L3 — stage 6: the volume reaches the register and the website", () => {
  it("maps the column onto GreenwayMenuItem", () => {
    const src = read("src/lib/pos/live-menu.ts");
    expect(src).toMatch(/netVolumeMl:\s*row\.net_volume_ml\s*\?\?\s*null,/);
    expect(src).toMatch(/netWeightGrams:\s*row\.net_weight_grams\s*\?\?\s*null,/);
  });

  it("declares the fields on the shared item type", () => {
    const src = read("src/lib/leafly/types.ts");
    expect(src).toMatch(/netVolumeMl\?:\s*number \| null;/);
    expect(src).toMatch(/netWeightGrams\?:\s*number \| null;/);
  });

  it("reads the row with select('*'), so the column arrives without a query change", () => {
    // This is WHY the fix is a one-line mapping and not a schema hunt: the
    // data was already on the wire and simply discarded.
    const src = read("src/lib/pos/menu-version.ts");
    expect(src).toMatch(/\.select\("\*"\)/);
  });

  it("has the column typed on the row so a mapping typo is a compile error", () => {
    const src = read("src/lib/pos/db-types.ts");
    expect(src).toMatch(/net_volume_ml:\s*number \| null;/);
  });
});

// ---------------------------------------------------------------------------
// STAGE 7 — the oracle: does the plumbed fact actually cap the sale?
// ---------------------------------------------------------------------------
describe("SLICE L3 — stage 7: the plumbed volume produces the legal count", () => {
  // Each case runs the REAL planner and then divides the 72 fl oz cap by what
  // came out. `oldAllowed` is what the register permitted before this work,
  // when every liquid fell back to DEFAULT_UNIT_GRAMS["edible-liquid"] = 28
  // against a 2016 g cap — exactly 72 packages regardless of size.
  const cases: { name: string; invType: string; legal: number; oldAllowed: number }[] = [
    { name: "Shot 2 fl oz", invType: "Liquid Edible", legal: 36, oldAllowed: 72 },
    { name: "Quencher 12 fl oz", invType: "Liquid Edible", legal: 6, oldAllowed: 72 },
    { name: "Tincture 100ml", invType: "Tincture", legal: 21, oldAllowed: 72 },
    { name: "Syrup 500ml", invType: "Liquid Edible", legal: 4, oldAllowed: 72 },
    { name: "Bottle 750 ml", invType: "Liquid Edible", legal: 2, oldAllowed: 72 },
    { name: "Cider 1L", invType: "Liquid Edible", legal: 2, oldAllowed: 72 },
    { name: "Growler 1.5 L", invType: "Liquid Edible", legal: 1, oldAllowed: 72 },
    { name: "Lemonade 4 x 50ml", invType: "Liquid Edible", legal: 10, oldAllowed: 72 },
    { name: "Dropper 10ml", invType: "Tincture", legal: 212, oldAllowed: 72 },
  ];

  it.each(cases)("$name allows $legal packages, not $oldAllowed", ({ name, invType, legal }) => {
    const p = buildDraftInjectionPlan({
      drafts: [
        {
          id: "d1",
          pos_product_key: "PK-X",
          name,
          brand_name: "B",
          vendor_name: "V",
          strain_name: null,
          thc_pct: null,
          cbd_pct: null,
          total_thc_pct: null,
          potency_json: null,
          price_minor_units: 1000,
          updated_at: "2025-06-01T00:00:00Z",
          inventory_type: invType,
          chosen_website_category: "edible-liquid",
        },
      ],
      existingKeys: new Set<string>(),
      enrichmentByDraftId: new Map([
        ["d1", { websiteCategory: "edible-liquid", strainType: null, onHandQty: 9, packageLabel: "each" }],
      ]),
      baseSortOrder: 0,
    });
    const ml = p.items[0].net_volume_ml;
    expect(ml).not.toBeNull();
    expect(Math.floor(REC_ML / (ml as number))).toBe(legal);
  });

  it("proves the 10ml dropper case was UNDER-selling, not over", () => {
    // The old basis capped a 10 ml dropper at 72 units when 212 are legal.
    // The error ran both ways, and this direction cost legal sales.
    expect(212).toBeGreaterThan(72);
  });
});
