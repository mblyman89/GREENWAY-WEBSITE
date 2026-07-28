/**
 * tests/compliance/vendor-list-state.test.ts — Task E (Vendors list filter
 * round-trip).
 *
 * Pins the pure helpers that keep the Vendors & Brands list's filter/sort/page
 * state alive across detail navigation: the list carries state into each card's
 * detail link via an opaque `from` token, and the detail page reconstructs the
 * exact list URL from that token — always sanitised back through the allow-list
 * so a tampered token can't steer the back link off the admin app.
 */
import { describe, it, expect } from "vitest";
import {
  pickVendorListParams,
  vendorListQueryString,
  vendorDetailHref,
  vendorListBackHref,
  VENDOR_LIST_KEYS,
  resolveVendorScope,
} from "@/lib/vendors/list-state-core";

describe("pickVendorListParams", () => {
  it("keeps only recognised, non-empty params", () => {
    expect(
      pickVendorListParams({
        q: "green",
        status: "published",
        scope: "",
        active: "true",
        license: "has",
        itype: "",
        icat: "flower",
        page: "3",
        // not a list key — must be dropped:
        saved: "1",
      }),
    ).toEqual({
      q: "green",
      status: "published",
      active: "true",
      license: "has",
      icat: "flower",
      page: "3",
    });
  });

  it("drops the default page=1 for a clean URL", () => {
    expect(pickVendorListParams({ q: "x", page: "1" })).toEqual({ q: "x" });
  });

  it("trims whitespace and ignores blank/array values gracefully", () => {
    expect(pickVendorListParams({ q: "  hi  ", status: ["published"] })).toEqual({
      q: "hi",
      status: "published",
    });
  });

  it("tolerates null/undefined", () => {
    expect(pickVendorListParams(null)).toEqual({});
    expect(pickVendorListParams(undefined)).toEqual({});
  });
});

describe("vendorListQueryString", () => {
  it("serialises in the canonical key order", () => {
    const qs = vendorListQueryString({ page: "2", q: "green", status: "published" });
    expect(qs).toBe("?q=green&status=published&page=2");
  });

  it("returns empty string when there are no params", () => {
    expect(vendorListQueryString({})).toBe("");
  });
});

describe("vendorDetailHref", () => {
  it("carries the list state into the detail link via an encoded `from` token", () => {
    const href = vendorDetailHref("abc-123", { q: "green", status: "published", page: "2" });
    expect(href.startsWith("/admin/vendors/abc-123?from=")).toBe(true);
    const from = new URL(href, "https://x").searchParams.get("from");
    expect(from).toBe("q=green&status=published&page=2");
  });

  it("returns a bare detail href when there are no filters", () => {
    expect(vendorDetailHref("abc-123", {})).toBe("/admin/vendors/abc-123");
  });
});

describe("vendorListBackHref", () => {
  it("round-trips the detail `from` token back to the exact list URL", () => {
    const params = { q: "green", status: "published", license: "has", page: "4" };
    const href = vendorDetailHref("v1", params);
    const from = new URL(href, "https://x").searchParams.get("from");
    expect(vendorListBackHref(from)).toBe(
      "/admin/vendors?q=green&status=published&license=has&page=4",
    );
  });

  it("falls back to the bare list when the token is absent", () => {
    expect(vendorListBackHref(undefined)).toBe("/admin/vendors");
    expect(vendorListBackHref(null)).toBe("/admin/vendors");
    expect(vendorListBackHref("")).toBe("/admin/vendors");
  });

  it("sanitises a tampered token through the allow-list (no junk survives)", () => {
    // A token trying to inject an unknown key + an off-list value.
    const token = encodeURIComponent("q=green&evil=1&status=published");
    expect(vendorListBackHref(token)).toBe("/admin/vendors?q=green&status=published");
  });

  it("never produces an off-site or absolute path", () => {
    const token = encodeURIComponent("q=" + encodeURIComponent("https://evil.example"));
    const href = vendorListBackHref(token);
    expect(href.startsWith("/admin/vendors")).toBe(true);
  });
});

describe("VENDOR_LIST_KEYS", () => {
  it("covers every filter/sort/page dimension of the list page", () => {
    expect(VENDOR_LIST_KEYS).toEqual([
      "q",
      "status",
      "scope",
      "active",
      "license",
      "itype",
      "icat",
      "page",
    ]);
  });
});

// ── SLICE 79: default scope = current vendors only ──────────────────────────
describe("resolveVendorScope", () => {
  it("defaults to 'current' when the param is absent, empty, or junk", () => {
    for (const raw of [undefined, null, "", "  ", "banana"]) {
      const r = resolveVendorScope(raw, true);
      expect(r).toEqual({ requested: "current", effective: "current", fallback: false });
    }
  });

  it("maps the legacy 'mine' value to 'current' so old bookmarks keep working", () => {
    expect(resolveVendorScope("mine", true)).toEqual({
      requested: "current",
      effective: "current",
      fallback: false,
    });
  });

  it("honours explicit 'all' and 'unused' requests", () => {
    expect(resolveVendorScope("all", true)).toEqual({
      requested: "all",
      effective: "all",
      fallback: false,
    });
    expect(resolveVendorScope("unused", true)).toEqual({
      requested: "unused",
      effective: "unused",
      fallback: false,
    });
  });

  it("falls back to 'all' (disclosed) when there are no inventory vendors", () => {
    expect(resolveVendorScope(undefined, false)).toEqual({
      requested: "current",
      effective: "all",
      fallback: true,
    });
    expect(resolveVendorScope("unused", false)).toEqual({
      requested: "unused",
      effective: "all",
      fallback: true,
    });
    // Explicit "all" with no inventory is NOT a fallback — it's what was asked for.
    expect(resolveVendorScope("all", false)).toEqual({
      requested: "all",
      effective: "all",
      fallback: false,
    });
  });
});
