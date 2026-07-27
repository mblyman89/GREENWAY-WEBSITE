/**
 * tests/compliance/reprocess-core.test.ts
 *
 * SLICE 67 — the re-run-intelligence planner. The embedded self-tests
 * (__runReprocessCoreTests) carry the full real-data matrix; these vitest
 * mirrors pin the five load-bearing guarantees so a CI-visible test fails
 * loudly if any of them regresses.
 */
import { describe, it, expect } from "vitest";
import {
  planLotReprocess,
  planMenuItemReprocess,
  parseMgDisplay,
  __runReprocessCoreTests,
  type LotReprocessInput,
  type MenuItemReprocessInput,
} from "@/lib/inventory/reprocess-core";

const blankLot: LotReprocessInput = {
  id: "L1",
  product_name: null,
  inventory_type: null,
  strain_type: null,
  servings_per_pack: null,
  mg_per_serving: null,
  package_thc_mg: null,
  package_cbd_mg: null,
  ratio_label: null,
  minor_cannabinoids_json: [],
  fact_provenance: {},
  lab_total_thc_pct: null,
  lab_thc_pct: null,
  lab_cbd_pct: null,
};

const blankItem: MenuItemReprocessInput = {
  id: "M1",
  name: "",
  product_name: null,
  brand_name: "",
  vendor_name: null,
  category: "edible-solid",
  strain_type: "unknown",
  strain_name: null,
  pos_inventory_type: null,
  pos_inventory_category: null,
  thc: null,
  servings_per_pack: null,
  mg_per_serving: null,
  package_thc_mg: null,
  package_cbd_mg: null,
  ratio_label: null,
  compounds_json: [],
  fact_provenance: {},
};

describe("SLICE 67 — reprocess planner", () => {
  it("runs the full embedded self-test suite", () => {
    expect(() => __runReprocessCoreTests()).not.toThrow();
  });

  it("fills only verified facts and is idempotent (Moxey lot)", () => {
    const input = {
      ...blankLot,
      product_name: "M-MT-400BAL - Moxey Balance 3:1 Peppermints (300mg CBG/100mg THC)",
      inventory_type: "Solid Edible",
      lab_total_thc_pct: 4.7,
      lab_cbd_pct: 0.37,
    };
    const patch = planLotReprocess(input);
    expect(patch?.update.package_thc_mg).toBe(100);
    expect(patch?.update.ratio_label).toBe("3:1");
    // Apply the patch conceptually: with the facts present, second pass is a no-op.
    const second = planLotReprocess({
      ...input,
      package_thc_mg: 100,
      ratio_label: "3:1",
      minor_cannabinoids_json: [{ type: "cbg", value: "300", unit: "mg" }],
      fact_provenance: { package_thc_mg: "name-internal", ratio_label: "name" },
    });
    expect(second).toBeNull();
  });

  it("never overwrites a reviewer's decision (provenance blocks the fill)", () => {
    const patch = planLotReprocess({
      ...blankLot,
      product_name: "M-MT-400BAL - Moxey Balance 3:1 Peppermints (300mg CBG/100mg THC)",
      inventory_type: "Solid Edible",
      lab_total_thc_pct: 4.7,
      minor_cannabinoids_json: [{ type: "cbg", value: "300", unit: "mg" }],
      fact_provenance: { package_thc_mg: "reviewer", ratio_label: "reviewer" },
    });
    expect(patch === null || !("package_thc_mg" in patch.update)).toBe(true);
  });

  it("corrects displayed THC to the verified package total and renames only raw-named rows", () => {
    const raw = "Gummy - Rainbow (Variety) - 10 x 10mg - 100mg THC";
    const patch = planMenuItemReprocess({
      ...blankItem,
      name: raw,
      product_name: raw,
      vendor_name: "Journeyman",
      pos_inventory_type: "Solid Edible",
      thc: "10mg",
    });
    expect(patch?.update.thc).toBe("100mg");
    expect(patch?.update.pos_inventory_category).toBe("Gummies");
    expect(patch?.update.name).toBe("Gummy Rainbow Variety 10 X 10mg 100mg THC");
    expect(patch && "product_name" in patch.update).toBe(false);
  });

  it("percent-mode rows get no mg facts and unverifiable rows are no-ops (never guess)", () => {
    const flower = planMenuItemReprocess({
      ...blankItem,
      name: "A.C. Flower - Gelato Cake - 3.5g (I)",
      product_name: "A.C. Flower - Gelato Cake - 3.5g (I)",
      vendor_name: "Artizen",
      category: "flower",
      strain_name: "Gelato Cake",
      pos_inventory_type: "Usable Marijuana",
      thc: "28.94%",
    });
    expect(flower && "package_thc_mg" in flower.update).toBe(false);
    expect(flower?.update.strain_type).toBe("indica");
    expect(
      planMenuItemReprocess({
        ...blankItem,
        name: "Blue Dream 1g",
        product_name: "Blue Dream 1g",
        category: "flower",
        strain_name: "Blue Dream",
        pos_inventory_type: "Usable Marijuana",
        pos_inventory_category: "Flower",
        strain_type: "hybrid",
      }),
    ).toBeNull();
    expect(parseMgDisplay("~21%")).toBeNull();
  });
});
