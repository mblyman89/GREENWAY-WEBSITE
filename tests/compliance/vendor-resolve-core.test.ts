/**
 * tests/compliance/vendor-resolve-core.test.ts  (H17)
 *
 * Intake vendor resolution pure core — the "no vendor associated with
 * products" fix. Grounded in the owner's real SPR bundle: the WCIA transfer
 * carries from_license_name "Seattles Private Reserve" + from_license_number
 * "417068" at the DOCUMENT level; the old exact-ilike matcher left vendor_id
 * NULL for any spelling drift or missing vendors row, so lots/drafts had no
 * vendor and vendor-axis mastering had nothing to group on.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeVendorKey,
  normalizeLicense,
  pickVendorByNormalizedName,
  vendorSlugCandidate,
  __runVendorResolveCoreTests,
  type VendorNameCandidate,
} from "@/lib/inventory/vendor-resolve-core";

describe("H17 vendor-resolve-core", () => {
  it("passes the embedded self-test suite", () => {
    const r = __runVendorResolveCoreTests();
    expect(r.failed).toBe(0);
  });

  it("normalizes the real-world drift cases", () => {
    expect(normalizeVendorKey("Seattle's Private Reserve")).toBe(
      normalizeVendorKey("Seattles Private Reserve"),
    );
    expect(normalizeVendorKey("  SEATTLES   PRIVATE-RESERVE ")).toBe("seattles private reserve");
    expect(normalizeVendorKey("A & B Farms")).toBe("a and b farms");
    expect(normalizeVendorKey(null)).toBe("");
  });

  it("compares licenses digits-only", () => {
    expect(normalizeLicense("Lic #417068")).toBe("417068");
    expect(normalizeLicense(" 417068 ")).toBe("417068");
    expect(normalizeLicense("12")).toBeNull();
    expect(normalizeLicense(null)).toBeNull();
  });

  it("matches by normalized display_name / dba / legal_name", () => {
    const rows: VendorNameCandidate[] = [
      { id: "v1", display_name: "Fine Detail Greenway" },
      { id: "v2", display_name: "Seattle's Private Reserve", dba: "SPR" },
      { id: "v3", display_name: "Other Farm", legal_name: "Other Farm LLC" },
    ];
    expect(pickVendorByNormalizedName("Seattles Private Reserve", rows)?.id).toBe("v2");
    expect(pickVendorByNormalizedName("spr", rows)?.id).toBe("v2");
    expect(pickVendorByNormalizedName("other farm llc", rows)?.id).toBe("v3");
    expect(pickVendorByNormalizedName("No Such Vendor", rows)).toBeNull();
    expect(pickVendorByNormalizedName("", rows)).toBeNull();
  });

  it("builds deterministic slugs for auto-created draft vendors", () => {
    expect(vendorSlugCandidate("Seattles Private Reserve")).toBe("seattles-private-reserve");
    expect(vendorSlugCandidate("A & B Farms!")).toBe("a-and-b-farms");
  });
});
