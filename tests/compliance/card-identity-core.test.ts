/**
 * tests/compliance/card-identity-core.test.ts  (SLICE 66)
 *
 * Card identity overlay pure core \u2014 the D1/D2/D3 label fixes, grounded in the
 * owner's real screenshots: "CERES - 435011" printed on every topical/edible
 * card (D1), a brand linked in Product Enrichment stored but never displayed
 * (D2), and vendors.dba never preferred for customer display (D3).
 */
import { describe, it, expect } from "vitest";
import {
  applyCardIdentity,
  vendorShortLabel,
  __runCardIdentityCoreTests,
} from "@/lib/menu/card-identity-core";
import {
  stripLicenseSuffix,
  extractLicenseFromLabel,
  normalizeVendorKey,
} from "@/lib/inventory/vendor-resolve-core";

describe("SLICE 66 card-identity-core", () => {
  it("passes the embedded self-test suite", () => {
    expect(() => __runCardIdentityCoreTests()).not.toThrow();
  });

  it("strips trailing license numbers conservatively (D1, real CERES card)", () => {
    expect(stripLicenseSuffix("CERES - 435011")).toBe("CERES");
    expect(stripLicenseSuffix("CERES (435011)")).toBe("CERES");
    expect(stripLicenseSuffix("CERES 435011")).toBe("CERES");
    // Never guess: labels without a real license suffix are untouched.
    expect(stripLicenseSuffix("2727")).toBe("2727");
    expect(stripLicenseSuffix("Cloud 9")).toBe("Cloud 9");
    expect(stripLicenseSuffix("Farm 2020")).toBe("Farm 2020");
    expect(stripLicenseSuffix("435011 Farms")).toBe("435011 Farms");
    expect(stripLicenseSuffix(null)).toBe("");
  });

  it("extracts the license the label carries, or null", () => {
    expect(extractLicenseFromLabel("CERES - 435011")).toBe("435011");
    expect(extractLicenseFromLabel("CERES")).toBeNull();
    expect(extractLicenseFromLabel("2727")).toBeNull();
  });

  it("prefers dba, strips license (D3)", () => {
    expect(vendorShortLabel({ display_name: "Ceres Holdings LLC - 435011", dba: "CERES" })).toBe("CERES");
    expect(vendorShortLabel({ display_name: "CERES - 435011", dba: null })).toBe("CERES");
    expect(vendorShortLabel({ display_name: "Fairwinds Manufacturing", dba: "  " })).toBe(
      "Fairwinds Manufacturing",
    );
  });

  it("overlays enrichment brand + short vendor onto items (D1+D2+D3)", () => {
    const items = [
      { id: "POS-1", brand: "", vendor: "CERES - 435011", name: "Healing Balm" },
      { id: "POS-2", brand: "Row Brand", vendor: "Fairwinds Manufacturing", name: "Tincture" },
      { id: "POS-3", brand: "", vendor: undefined as string | undefined, name: "Mystery" },
    ];
    const out = applyCardIdentity(
      items,
      new Map([["POS-2", "Fairwinds"]]),
      new Map([[normalizeVendorKey("Fairwinds Manufacturing"), "Fairwinds"]]),
    );
    expect(out[0].vendor).toBe("CERES"); // D1: license stripped even unmatched
    expect(out[1].brand).toBe("Fairwinds"); // D2: enrichment brand wins
    expect(out[1].vendor).toBe("Fairwinds"); // D3: short label
    expect(out[2]).toBe(items[2]); // untouched by reference
    expect(out[0].name).toBe("Healing Balm"); // other fields preserved
  });
});
