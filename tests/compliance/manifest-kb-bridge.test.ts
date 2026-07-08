/**
 * tests/compliance/manifest-kb-bridge.test.ts — Slice H11a (Manifest → KB
 * bridge, drafts-only).
 *
 * Pins the PURE mapping from a staged manifest lot (a signed WCIA/generic
 * transfer line) to the KB write-back facts, plus the non-destructive vendor
 * license gap-fill and the promote/skip policy. The server side reuses the
 * long-standing writeBackProductFacts merge (drafts-only, idempotent), so the
 * compliance surface to pin is this mapping: never fabricate identity, never
 * guess a brand, never overwrite a populated vendor license, never promote
 * refused product.
 */
import { describe, it, expect } from "vitest";
import {
  cleanStrainName,
  deriveVariantLabel,
  chooseKbCategory,
  isPromotableLot,
  lotToWritebackFacts,
  extractVendorLicense,
  vendorLicensePatch,
  summarizeBridgeOutcome,
  MANIFEST_FACT_CONFIDENCE,
  MANIFEST_FACT_SOURCE,
  type ManifestLotFacts,
} from "@/lib/inventory/manifest-kb-bridge-core";

function lot(over: Partial<ManifestLotFacts> = {}): ManifestLotFacts {
  return {
    product_name: "Golden Pineapple Preroll 1g",
    strain_name: "Golden Pineapple ", // WCIA trailing-space bug, verbatim
    category: "EndProduct",
    inventory_type: "Usable Marijuana",
    pos_product_key: "SKU-123",
    lot_code: "LOT-9",
    unit_weight: 1,
    unit_weight_uom: "g",
    brand_name: null,
    brand_id: null,
    vendor_id: "vendor-1",
    status: "active",
    disposition: "accepted",
    ...over,
  };
}

describe("cleanStrainName", () => {
  it("trims the WCIA trailing-space bug and collapses whitespace", () => {
    expect(cleanStrainName("Golden Pineapple ")).toBe("Golden Pineapple");
    expect(cleanStrainName("  Blue   Dream ")).toBe("Blue Dream");
  });
  it("returns null for empty/missing", () => {
    expect(cleanStrainName("")).toBeNull();
    expect(cleanStrainName("   ")).toBeNull();
    expect(cleanStrainName(null)).toBeNull();
    expect(cleanStrainName(undefined)).toBeNull();
  });
});

describe("deriveVariantLabel", () => {
  it("joins weight + uom, trimming trailing zeros", () => {
    expect(deriveVariantLabel(3.5, "g")).toBe("3.5 g");
    expect(deriveVariantLabel(1.0, "g")).toBe("1 g");
    expect(deriveVariantLabel(3.567, "g")).toBe("3.57 g");
  });
  it("weight without uom is just the number", () => {
    expect(deriveVariantLabel(2, null)).toBe("2");
  });
  it("null for missing/zero/negative/NaN weight — falls to empty variant", () => {
    expect(deriveVariantLabel(null, "g")).toBeNull();
    expect(deriveVariantLabel(0, "g")).toBeNull();
    expect(deriveVariantLabel(-1, "g")).toBeNull();
    expect(deriveVariantLabel(Number.NaN, "g")).toBeNull();
  });
});

describe("chooseKbCategory", () => {
  it("prefers the descriptive inventory_type over the coarse WCIA category", () => {
    expect(chooseKbCategory("EndProduct", "Usable Marijuana")).toBe("Usable Marijuana");
    expect(chooseKbCategory("EndProduct", "Concentrate for Inhalation")).toBe(
      "Concentrate for Inhalation",
    );
  });
  it("falls back to category, then null", () => {
    expect(chooseKbCategory("EndProduct", null)).toBe("EndProduct");
    expect(chooseKbCategory("EndProduct", "  ")).toBe("EndProduct");
    expect(chooseKbCategory(null, null)).toBeNull();
  });
});

describe("isPromotableLot (KB facts ≠ inventory activation)", () => {
  it("promotes active, quarantined and pending lots — the signed transfer is real", () => {
    expect(isPromotableLot("active", "accepted")).toBe(true);
    expect(isPromotableLot("quarantine", null)).toBe(true);
    expect(isPromotableLot("pending", null)).toBe(true);
    expect(isPromotableLot(null, null)).toBe(true);
  });
  it("NEVER promotes refused/destroyed product (may have failed QA)", () => {
    expect(isPromotableLot("rejected", null)).toBe(false);
    expect(isPromotableLot("quarantine", "rejected_at_dock")).toBe(false);
    expect(isPromotableLot("destroyed", null)).toBe(false);
  });
});

describe("lotToWritebackFacts", () => {
  it("maps a WCIA line to drafts-only KB facts", () => {
    const facts = lotToWritebackFacts(lot());
    expect(facts).not.toBeNull();
    expect(facts!.posProductKey).toBe("SKU-123");
    expect(facts!.productName).toBe("Golden Pineapple Preroll 1g");
    expect(facts!.strainName).toBe("Golden Pineapple"); // trailing space fixed
    expect(facts!.category).toBe("Usable Marijuana");
    expect(facts!.variantLabel).toBe("1 g");
    expect(facts!.vendorId).toBe("vendor-1");
    expect(facts!.confidence).toBe(MANIFEST_FACT_CONFIDENCE);
    expect(facts!.source).toBe(MANIFEST_FACT_SOURCE);
  });

  it("NEVER fabricates identity: no name or no key → skip (null)", () => {
    expect(lotToWritebackFacts(lot({ product_name: null }))).toBeNull();
    expect(lotToWritebackFacts(lot({ product_name: "  " }))).toBeNull();
    expect(lotToWritebackFacts(lot({ pos_product_key: null, lot_code: null }))).toBeNull();
  });

  it("falls back to lot_code for the POS key (mirrors intake staging)", () => {
    const facts = lotToWritebackFacts(lot({ pos_product_key: null }));
    expect(facts!.posProductKey).toBe("LOT-9");
  });

  it("NEVER guesses a brand — WCIA carries vendor, not brand, per line", () => {
    const facts = lotToWritebackFacts(lot());
    expect(facts!.brandName).toBeNull(); // writeback buckets as unknown-brand
    const withBrand = lotToWritebackFacts(lot({ brand_name: "Freddy's Fuego", brand_id: "b1" }));
    expect(withBrand!.brandName).toBe("Freddy's Fuego");
    expect(withBrand!.brandId).toBe("b1");
  });
});

describe("extractVendorLicense", () => {
  it("reads WCIA from_license_number from an object or JSON string", () => {
    expect(extractVendorLicense({ from_license_number: "412345" })).toBe("412345");
    expect(extractVendorLicense(JSON.stringify({ from_license_number: " 412345 " }))).toBe(
      "412345",
    );
    expect(extractVendorLicense({ FROM_LICENSE_NUMBER: "9" })).toBe("9"); // case-insensitive
    expect(extractVendorLicense({ vendor_license: "77" })).toBe("77"); // generic
    expect(extractVendorLicense({ from_license_number: 412345 })).toBe("412345"); // numeric quirk
  });
  it("null for non-JSON text (CCRS CSV payloads), arrays and missing keys", () => {
    expect(extractVendorLicense("SubmittedBy,foo\nA,B")).toBeNull();
    expect(extractVendorLicense(["x"])).toBeNull();
    expect(extractVendorLicense({ transfer_id: "T-1" })).toBeNull();
    expect(extractVendorLicense(null)).toBeNull();
  });
});

describe("vendorLicensePatch (non-destructive gap-fill)", () => {
  it("fills only an EMPTY existing license", () => {
    expect(vendorLicensePatch(null, "412345")).toBe("412345");
    expect(vendorLicensePatch("  ", "412345")).toBe("412345");
  });
  it("NEVER overwrites a populated license", () => {
    expect(vendorLicensePatch("999999", "412345")).toBeNull();
  });
  it("no incoming license → no patch", () => {
    expect(vendorLicensePatch(null, null)).toBeNull();
    expect(vendorLicensePatch(null, "  ")).toBeNull();
  });
});

describe("summarizeBridgeOutcome", () => {
  it("audit note always states drafts-only and reflects the counters", () => {
    const note = summarizeBridgeOutcome({
      promoted: 12,
      skipped: 2,
      strainsEnriched: 3,
      vendorLicenseFilled: true,
    });
    expect(note).toContain("12 product facts promoted as KB drafts");
    expect(note).toContain("3 strain(s) gap-filled");
    expect(note).toContain("2 line(s) skipped");
    expect(note).toContain("vendor license number captured");
    expect(note).toContain("Drafts-only — nothing published.");
  });
  it("singular form + quiet omissions", () => {
    const note = summarizeBridgeOutcome({
      promoted: 1,
      skipped: 0,
      strainsEnriched: 0,
      vendorLicenseFilled: false,
    });
    expect(note).toContain("1 product fact promoted");
    expect(note).not.toContain("strain");
    expect(note).not.toContain("license");
  });
});
