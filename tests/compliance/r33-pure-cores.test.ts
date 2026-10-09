/**
 * tests/compliance/r33-pure-cores.test.ts  (R33, T-329)
 *
 * The four new R33 pure cores run their self-tests under vitest too (the
 * pure runner floors them: 39 / 38 / 33 / 39), plus focused behaviour checks
 * of the rules the owner can see: the strain library never overrides a
 * person's strain type, the drift notice, and the size words.
 */
import { describe, it, expect } from "vitest";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { __runLotStrainPropagationCoreTests } from "@/lib/inventory/lot-strain-propagation-core";
import { __runLotDetailsPropagationCoreTests, strainDrift, strainTypeChanged } from "@/lib/inventory/lot-details-propagation-core";
import { __runProductFactsOverlayCoreTests } from "@/lib/menu/product-facts-overlay-core";
import { __runPdpSizeCoreTests, pdpSizeLine, purchaseSizeLabel } from "@/lib/menu/pdp-size-core";
import { __runMenuCategoryOverrideCoreTests } from "@/lib/menu/menu-category-override-core";
import { attachStrainProfile, type TerpeneIndex, type StrainTypeIndex } from "@/lib/menu/strain-terpenes";

describe("R33 pure cores", () => {
  it.each([
    ["lot-strain-propagation-core", __runLotStrainPropagationCoreTests, 39],
    ["lot-details-propagation-core", __runLotDetailsPropagationCoreTests, 38],
    ["product-facts-overlay-core", __runProductFactsOverlayCoreTests, 33],
    ["pdp-size-core", __runPdpSizeCoreTests, 39],
  ] as const)("%s self-tests pass at their floor", (_n, run, floor) => {
    const r = run();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(floor);
  });
  it("menu-category-override-core grew the house-type tests", () => {
    expect(__runMenuCategoryOverrideCoreTests().passed).toBeGreaterThanOrEqual(24);
  });
});

describe("R33 attachStrainProfile respects a person's strain type", () => {
  const base = { id: "K", name: "Blue Dream", brand: "B", category: "flower", strainType: "indica", strainName: "Blue Dream", thc: null, cbd: null } as unknown as GreenwayMenuItem;
  const terps: TerpeneIndex = new Map([["blue dream", ["myrcene"]]]);
  const types: StrainTypeIndex = new Map([["blue dream", "sativa"]]);
  it("library corrects an unstamped card", () => {
    const [o] = attachStrainProfile([base], terps, types);
    expect(o.strainType).toBe("sativa");
  });
  it("library never replaces a reviewer-stamped card; terpenes still fill", () => {
    const [o] = attachStrainProfile([{ ...base, strainTypeSource: "reviewer" }], terps, types);
    expect(o.strainType).toBe("indica");
    expect(o.terpenes).toEqual(["myrcene"]);
  });
});

describe("R33 drift + change detection", () => {
  it("drift only for PUBLISHED cards that differ from a lot that HAS a type", () => {
    const cards = [
      { name: "A", strainType: "hybrid", versionStatus: "published" },
      { name: "B", strainType: "indica", versionStatus: "published" },
      { name: "C", strainType: "hybrid", versionStatus: "staged" },
    ];
    expect(strainDrift("indica", cards).map((d) => d.cardName)).toEqual(["A"]);
    expect(strainDrift(null, cards)).toEqual([]);
    expect(strainDrift("unknown", cards)).toEqual([]);
  });
  it("strainTypeChanged is canonical (case/blank)", () => {
    expect(strainTypeChanged("Hybrid", "hybrid")).toBe(false);
    expect(strainTypeChanged(null, "")).toBe(false);
    expect(strainTypeChanged("hybrid", "indica")).toBe(true);
  });
});

describe("R33 size words", () => {
  it("flower and concentrate get grams + the retail fraction; edibles stay with their own chip", () => {
    expect(pdpSizeLine({ category: "flower", variants: [{ label: "7g" }] })).toBe("7 g (1/4 oz)");
    expect(pdpSizeLine({ category: "concentrate", variants: [{ label: "1g" }] })).toBe("1 g");
    expect(pdpSizeLine({ category: "edible-solid", variants: [{ label: "50g" }] })).toBeNull();
    expect(purchaseSizeLabel("3.5g", "flower")).toBe("3.5 g (1/8 oz)");
  });
});
