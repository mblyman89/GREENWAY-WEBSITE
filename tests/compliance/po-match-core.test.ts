/**
 * tests/compliance/po-match-core.test.ts
 *
 * W5 — pins the suggest-and-confirm manifest ↔ PO matching contract:
 *   - only sent/partial POs are candidates (a truck can't fulfill a draft the
 *     vendor never saw, and terminal POs are done);
 *   - vendor-id match outranks normalized-name match outranks no match;
 *   - within a tier, the expected date closest to the delivery wins;
 *   - unmatched POs only surface when NOTHING vendor-matches (flagged loudly);
 *   - every suggestion carries a human-readable reason. NEVER auto-links —
 *     this module only ranks; a human confirms.
 */
import { describe, expect, it } from "vitest";
import {
  suggestPoMatches,
  normalizeVendorName,
  LINKABLE_PO_STATUSES,
  __runPoMatchCoreTests,
  type PoMatchCandidate,
  type ManifestMatchFacts,
} from "@/lib/inventory/po-match-core";

function po(over: Partial<PoMatchCandidate>): PoMatchCandidate {
  return {
    id: "p1",
    po_number: "PO-000001",
    vendor_id: "v1",
    vendor_name: "Fairwinds",
    status: "sent",
    expected_date: "2026-02-10",
    subtotal_minor_units: 250000,
    line_count: 4,
    ...over,
  };
}

function mf(over: Partial<ManifestMatchFacts>): ManifestMatchFacts {
  return {
    vendor_id: "v1",
    vendor_label: "Fairwinds",
    transfer_date: "2026-02-10",
    eta_date: null,
    ...over,
  };
}

describe("po-match-core: candidate pool", () => {
  it("only sent/partial POs are linkable", () => {
    expect([...LINKABLE_PO_STATUSES]).toEqual(["sent", "partial"]);
    const all = ["draft", "submitted", "sent", "partial", "received", "cancelled"].map((s, i) =>
      po({ id: s + i, status: s }),
    );
    const out = suggestPoMatches(mf({}), all, 10);
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.po.status === "sent" || s.po.status === "partial")).toBe(true);
  });

  it("returns [] when there are no open POs at all", () => {
    expect(suggestPoMatches(mf({}), [po({ status: "received" })], 10)).toEqual([]);
    expect(suggestPoMatches(mf({}), [], 10)).toEqual([]);
  });
});

describe("po-match-core: ranking", () => {
  it("vendor-id match beats name match beats none", () => {
    const out = suggestPoMatches(
      mf({}),
      [
        po({ id: "byname", vendor_id: "zz", vendor_name: " FAIRWINDS " }),
        po({ id: "byid", vendor_id: "v1", vendor_name: "Whatever Label" }),
      ],
      10,
    );
    expect(out.map((s) => s.po.id)).toEqual(["byid", "byname"]);
    expect(out[0].vendorMatch).toBe("id");
    expect(out[1].vendorMatch).toBe("name");
  });

  it("closest expected date wins inside a tier; unknown dates sort last", () => {
    const out = suggestPoMatches(
      mf({ transfer_date: "2026-02-10" }),
      [
        po({ id: "far", expected_date: "2026-03-01" }),
        po({ id: "near", expected_date: "2026-02-09" }),
        po({ id: "nodate", expected_date: null }),
      ],
      10,
    );
    expect(out.map((s) => s.po.id)).toEqual(["near", "far", "nodate"]);
  });

  it("vendor-matched POs completely hide unmatched ones", () => {
    const out = suggestPoMatches(
      mf({}),
      [po({ id: "mine", vendor_id: "v1" }), po({ id: "other", vendor_id: "vZ", vendor_name: "Zed Farms" })],
      10,
    );
    expect(out.map((s) => s.po.id)).toEqual(["mine"]);
  });

  it("with zero vendor matches, unmatched POs surface but warn loudly", () => {
    const out = suggestPoMatches(
      mf({ vendor_id: "vX", vendor_label: "Nobody Farms" }),
      [po({ id: "stranger" })],
      10,
    );
    expect(out).toHaveLength(1);
    expect(out[0].vendorMatch).toBe("none");
    expect(out[0].reason).toContain("check carefully");
  });

  it("respects the limit (default 3)", () => {
    const many = Array.from({ length: 6 }, (_, i) => po({ id: `p${i}` }));
    expect(suggestPoMatches(mf({}), many)).toHaveLength(3);
    expect(suggestPoMatches(mf({}), many, 5)).toHaveLength(5);
  });
});

describe("po-match-core: reasons & normalization", () => {
  it("every suggestion has a non-empty plain-English reason", () => {
    const out = suggestPoMatches(mf({}), [po({}), po({ id: "p2", status: "partial" })], 10);
    for (const s of out) {
      expect(s.reason.length).toBeGreaterThan(10);
    }
    expect(out.find((s) => s.po.status === "partial")?.reason).toContain("partially received");
  });

  it("same-day expected date reads 'expected exactly this day'", () => {
    const out = suggestPoMatches(mf({ transfer_date: "2026-02-10" }), [po({ expected_date: "2026-02-10" })], 10);
    expect(out[0].reason).toContain("expected exactly this day");
  });

  it("normalizeVendorName strips case, punctuation, extra spaces", () => {
    expect(normalizeVendorName("  Fair-Winds, LLC. ")).toBe("fair winds llc");
    expect(normalizeVendorName(null)).toBe("");
    expect(normalizeVendorName("FAIRWINDS")).toBe(normalizeVendorName("fairwinds"));
  });

  it("falls back to eta_date when transfer_date is missing", () => {
    const out = suggestPoMatches(
      mf({ transfer_date: null, eta_date: "2026-02-10" }),
      [po({ id: "near", expected_date: "2026-02-11" }), po({ id: "far", expected_date: "2026-03-05" })],
      10,
    );
    expect(out.map((s) => s.po.id)).toEqual(["near", "far"]);
  });
});

describe("po-match-core: embedded self-tests", () => {
  it("pass", () => {
    expect(__runPoMatchCoreTests().passed).toBeGreaterThan(0);
  });
});
