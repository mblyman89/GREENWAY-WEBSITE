/**
 * tests/compliance/r29-draft-injection-lab-pct.test.ts
 *
 * R29: an intake draft's THC/CBD numbers are LAB PERCENTS (WCIA lab schema
 * uom "pct"). For mg-dosed products (edibles, liquids, topicals) they must
 * never stand in for milligrams. Before R29, "Gummies - 100mg THC" with a
 * 0.5 % lab figure came out as a VERIFIED 0.5 mg per serving x 200 servings,
 * and a Bytes 2:2:2:1 gummy reached the menu card as "0.12mg".
 *
 * This file was added after the R29 mutation harness showed that reverting
 * `thcColumn: null` in examineDraftFacts went unnoticed by every other
 * test. It pins the fact engine and the staged-menu row.
 */
import { describe, expect, it } from "vitest";
import {
  buildDraftInjectionPlan,
  examineDraftFacts,
  type ApprovedDraftForInjection,
} from "@/lib/pos/draft-injection-core";

function draft(over: Partial<ApprovedDraftForInjection>): ApprovedDraftForInjection {
  return {
    id: "d1",
    pos_product_key: "K1",
    name: "X",
    brand_name: "Bytes",
    vendor_name: "Vendor LLC",
    strain_name: null,
    thc_pct: null,
    cbd_pct: null,
    total_thc_pct: null,
    potency_json: null,
    price_minor_units: 2000,
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function stage(d: ApprovedDraftForInjection, websiteCategory: string) {
  return buildDraftInjectionPlan({
    drafts: [d],
    existingKeys: new Set(),
    enrichmentByDraftId: new Map([["d1", { websiteCategory, strainType: null, onHandQty: 5, packageLabel: null }]]),
    baseSortOrder: 0,
  });
}

const GUMMY_100 = draft({
  name: "Gummies - 100mg THC",
  inventory_type: "Solid Edible",
  thc_pct: 0.5,
  total_thc_pct: 0.5,
  potency_json: { thc: 0.5 },
});

const BYTES = draft({
  name: "Bytes 2:2:2:1 CBG:CBC:CBD:THC Gummies",
  inventory_type: "Solid Edible",
  thc_pct: 0.12,
  total_thc_pct: 0.12,
  cbd_pct: 0.25,
  potency_json: { thc: 0.12, cbd: 0.25, cbg: 0.24 },
});

describe("R29 - lab percents are never read as milligrams at draft injection", () => {
  it("fact engine: a 0.5 % lab figure does not become a verified 0.5 mg serving / 200 servings", () => {
    const e = examineDraftFacts(GUMMY_100)!;
    expect(e).not.toBeNull();
    // R37 S2: the only serving figures are Washington's 10 mg rule on the
    // name's 100 mg (10 x 10 mg), held single-source like the total they
    // divide - never the 0.5 mg / 200 servings the lab percent produced.
    expect(e.mgPerServing?.value).toBe(10);
    expect(e.mgPerServing?.source).toBe("wa-rule");
    expect(e.mgPerServing?.confidence).toBe("single-source");
    expect(e.servingsPerPack?.value).toBe(10);
    expect(e.servingsPerPack?.confidence).toBe("single-source");
    // The name's "100mg" survives, sourced from the name alone, never "name+column".
    expect(e.packageThcMg?.value).toBe(100);
    expect(e.packageThcMg?.source).toBe("name");
  });

  it("fact engine: a 0.12 % lab figure on a ratio gummy produces no package THC", () => {
    const e = examineDraftFacts(BYTES)!;
    expect(e.packageThcMg).toBeNull();
    expect(e.packageCbdMg).toBeNull();
  });

  it("fact engine: percent-mode products are not examined at all (flower keeps the percent path)", () => {
    expect(examineDraftFacts(draft({ name: "Blue Dream 1g", inventory_type: "Usable Marijuana", total_thc_pct: 24.1 }))).toBeNull();
  });

  it("staged row: no 0.5 mg / 200 servings / 0.12 mg anywhere, and the reason is disclosed", () => {
    for (const d of [GUMMY_100, BYTES]) {
      const p = stage(d, "edibles");
      const row = p.items[0];
      expect(row).toBeDefined();
      expect(row.mg_per_serving).not.toBe(0.5);
      expect(row.servings_per_pack).not.toBe(200);
      expect(row.package_thc_mg).not.toBe(0.12);
      expect(row.package_thc_mg).not.toBe(0.5);
      expect(row.thc).toBeNull();
      expect(row.cbd).toBeNull();
      const printed = JSON.stringify(row.compounds_json);
      expect(printed).not.toMatch(/"0\.12"|"0\.25"|"0\.24"|"0\.5"/);
      expect(p.diagnostics.map((x) => x.code)).toContain("lab_percent_not_mg");
    }
  });

  it("staged row: the ratio from the name is kept for the strain slot", () => {
    const row = stage(BYTES, "edibles").items[0];
    expect(row.ratio_label).toMatch(/CBG:CBC:CBD:THC/);
  });

  it("control: flower still prints its honest lab percents", () => {
    const p = stage(
      draft({ name: "Blue Dream 1g", inventory_type: "Usable Marijuana", thc_pct: 21.5, total_thc_pct: 24.1, cbd_pct: 0.4, potency_json: { thc: 21.5 } }),
      "flower",
    );
    const row = p.items[0];
    expect(row.thc).toBe("24.1%");
    expect(row.cbd).toBe("0.4%");
    expect(p.diagnostics.map((x) => x.code)).not.toContain("lab_percent_not_mg");
  });
});
