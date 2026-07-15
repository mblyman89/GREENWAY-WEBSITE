/**
 * POS Slice B42 — vitest mirror for the product-info core.
 *
 * Runs the full self-test suite, then pins the behaviors the register and
 * the menu route depend on: server-side description trimming (device cache
 * stays small), fact omission (no invented "THC: —" rows on merch), and
 * the display caps.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_INFO_DESCRIPTION,
  MAX_INFO_TERPENES,
  __runProductInfoCoreTests,
  buildProductInfo,
  strainTypeLabel,
  trimDescription,
} from "@/lib/pos/product-info-core";
import type { PosMenuProduct } from "@/lib/pos/sale-flow-core";

function product(overrides: Partial<PosMenuProduct> = {}): PosMenuProduct {
  return {
    productId: "p1",
    variantId: "v1",
    name: "Blue Dream",
    brand: "Greenway",
    category: "flower",
    categories: ["flower"],
    variantLabel: "3.5g",
    regularPriceMinor: 2500,
    costMinorUnits: null,
    inventoryStatus: "in-stock",
    ...overrides,
  };
}

describe("product-info-core self-tests", () => {
  it("all pass", () => {
    expect(() => __runProductInfoCoreTests()).not.toThrow();
  });
});

describe("product-info-core pins", () => {
  it("caps descriptions at a word boundary with an ellipsis (bundle stays small)", () => {
    const long = "lorem ipsum ".repeat(100);
    const out = trimDescription(long);
    expect(out.length).toBeLessThanOrEqual(MAX_INFO_DESCRIPTION + 1);
    expect(out.endsWith("…")).toBe(true);
    expect(trimDescription("short")).toBe("short");
  });

  it("omits missing facts instead of inventing rows (merch shows no potency)", () => {
    const view = buildProductInfo(product({ category: "merch", thc: null, cbd: null }));
    expect(view.rows).toHaveLength(0);
    expect(view.terpenes).toHaveLength(0);
    expect(view.description).toBe("");
  });

  it("builds potency rows + capped terpenes for a cannabis item", () => {
    const view = buildProductInfo(
      product({
        strainType: "sativa-hybrid",
        thc: "22%",
        cbd: "0.1%",
        terpenes: ["myrcene", "limonene", "pinene", "linalool", "humulene", "caryophyllene"],
        description: "  Bright and   citrusy. ",
      }),
    );
    expect(view.rows).toEqual([
      { label: "Type", value: "Sativa hybrid" },
      { label: "THC", value: "22%" },
      { label: "CBD", value: "0.1%" },
    ]);
    expect(view.terpenes).toHaveLength(MAX_INFO_TERPENES);
    expect(view.description).toBe("Bright and citrusy.");
  });

  it("never shows an 'Unknown' strain type", () => {
    expect(strainTypeLabel("unknown")).toBeNull();
    expect(strainTypeLabel(null)).toBeNull();
    expect(strainTypeLabel("weird-value")).toBeNull();
  });
});
