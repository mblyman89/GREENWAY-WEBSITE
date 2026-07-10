/**
 * tests/compliance/lead-vendor-thread-core.test.ts
 *
 * W11 — pins the vendor-identity threading contract (audit gap G8):
 *   - a reconciled vendor lead threads its REAL vendors.id into the PO
 *     builder, with honest provenance (license match vs name match);
 *   - an unmatched lead threads the display name ONLY — an id is never
 *     invented (standing rule: never guess);
 *   - no vendor lead / blank name → nothing threaded;
 *   - the builder remains suggest-and-confirm: this module only decides what
 *     to PRE-SELECT; the human confirms the vendor before saving.
 */
import { describe, expect, it } from "vitest";
import {
  resolveLeadVendorThread,
  __runLeadVendorThreadCoreTests,
} from "@/lib/discovery/lead-vendor-thread-core";

describe("lead-vendor-thread-core (W11)", () => {
  it("no vendor lead → nothing threaded", () => {
    expect(resolveLeadVendorThread(null)).toEqual({
      vendorId: null,
      vendorName: null,
      via: "none",
    });
  });

  it("license-confident reconciliation ('existing') → id threaded with license provenance", () => {
    const t = resolveLeadVendorThread({
      display_name: "Fairwinds",
      matched_vendor_id: "v-1",
      match_state: "existing",
    });
    expect(t.vendorId).toBe("v-1");
    expect(t.vendorName).toBe("Fairwinds");
    expect(t.via).toBe("reconciled_license");
  });

  it("name-based reconciliation ('possible') → id threaded but provenance flags it as name-derived", () => {
    const t = resolveLeadVendorThread({
      display_name: "Phat Panda",
      matched_vendor_id: "v-2",
      match_state: "possible",
    });
    expect(t.vendorId).toBe("v-2");
    expect(t.via).toBe("reconciled_name");
  });

  it("unmatched lead → name only, id is NEVER invented", () => {
    const t = resolveLeadVendorThread({
      display_name: "Brand New Farm",
      matched_vendor_id: null,
      match_state: "unmatched",
    });
    expect(t.vendorId).toBeNull();
    expect(t.vendorName).toBe("Brand New Farm");
    expect(t.via).toBe("name_only");
  });

  it("blank display name with no match → none (whitespace never threaded)", () => {
    const t = resolveLeadVendorThread({
      display_name: "   ",
      matched_vendor_id: null,
      match_state: "unmatched",
    });
    expect(t).toEqual({ vendorId: null, vendorName: null, via: "none" });
  });

  it("embedded self-tests pass", () => {
    const { passed } = __runLeadVendorThreadCoreTests();
    expect(passed).toBeGreaterThan(0);
  });
});
