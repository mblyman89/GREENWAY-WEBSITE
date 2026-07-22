/**
 * Mirrors the embedded self-tests in src/lib/admin/back-link-core.ts
 * (GW-029: state-carrying "Back to ..." navigation). The list pages keep
 * filters in the URL; withBackParam carries that state into detail links as
 * ?back=<urlencoded qs>; backHref restores it — and only ever restores a
 * QUERY STRING onto the caller's own fallback route (never a foreign path).
 */
import { describe, expect, it } from "vitest";
import {
  TRANSIENT_QUERY_KEYS,
  backHref,
  currentQueryString,
  withBackParam,
} from "@/lib/admin/back-link-core";

describe("currentQueryString", () => {
  it("carries filters and search", () => {
    expect(currentQueryString({ status: "new", q: "sarah" })).toBe("status=new&q=sarah");
  });
  it("strips transient flash params (stale banners must not come back)", () => {
    expect(currentQueryString({ status: "new", error: "x", saved: "1" })).toBe("status=new");
    expect(currentQueryString({ error: "x" })).toBe("");
    for (const k of ["error", "ok", "msg", "saved"]) {
      expect(TRANSIENT_QUERY_KEYS.has(k)).toBe(true);
    }
  });
  it("strips one-shot result banners (created/resolved/who and AI/KB flash counters)", () => {
    expect(currentQueryString({ status: "new", created: "SKU-1", resolved: "1", who: "Sarah" })).toBe(
      "status=new",
    );
    expect(currentQueryString({ tab: "drafts", generated: "3", clusters: "2", kbdone: "1" })).toBe(
      "tab=drafts",
    );
  });
  it("handles empty/null and multi-value params", () => {
    expect(currentQueryString({})).toBe("");
    expect(currentQueryString(null)).toBe("");
    expect(currentQueryString({ tag: ["a", "b"] })).toBe("tag=a&tag=b");
    expect(currentQueryString({ q: undefined })).toBe("");
  });
  it("carries a nested back key so multi-level chains restore every hop", () => {
    expect(currentQueryString({ back: "status=new" })).toBe("back=status%3Dnew");
  });
});

describe("withBackParam", () => {
  it("appends ?back= with the urlencoded current query", () => {
    expect(withBackParam("/admin/orders/123", { status: "new", q: "sarah" })).toBe(
      "/admin/orders/123?back=status%3Dnew%26q%3Dsarah",
    );
  });
  it("leaves the link clean when the page has no state", () => {
    expect(withBackParam("/admin/orders/123", {})).toBe("/admin/orders/123");
    expect(withBackParam("/admin/orders/123", { error: "boom" })).toBe("/admin/orders/123");
  });
  it("uses & when the link already has a query", () => {
    expect(withBackParam("/admin/orders/123?tab=notes", { q: "x" })).toBe(
      "/admin/orders/123?tab=notes&back=q%3Dx",
    );
  });
});

describe("backHref", () => {
  it("restores the list URL from the carried query", () => {
    expect(backHref("/admin/orders", "status=new&q=sarah")).toBe("/admin/orders?status=new&q=sarah");
    expect(backHref("/admin/orders", "?status=new")).toBe("/admin/orders?status=new");
  });
  it("falls back to the bare route when nothing was carried", () => {
    expect(backHref("/admin/orders", undefined)).toBe("/admin/orders");
    expect(backHref("/admin/orders", "")).toBe("/admin/orders");
    expect(backHref("/admin/orders", ["a=1", "b=2"])).toBe("/admin/orders");
  });
  it("SAFETY: only a query string is ever restored — never a foreign destination", () => {
    expect(backHref("/admin/orders", "/etc/passwd")).toBe("/admin/orders");
    expect(backHref("/admin/orders", "//evil.com")).toBe("/admin/orders");
    expect(backHref("/admin/orders", "https://evil.com")).toBe("/admin/orders");
    expect(backHref("/admin/orders", "\\\\evil")).toBe("/admin/orders");
    // ...but an encoded URL as a VALUE is a legitimate filter value.
    expect(backHref("/admin/orders", "a=https%3A%2F%2Fok")).toBe("/admin/orders?a=https%3A%2F%2Fok");
  });
  it("round-trip: list -> detail -> back restores the identical list URL (minus transients)", () => {
    const sp = { status: "new", q: "sarah", saved: "1" };
    const link = withBackParam("/admin/orders/123", sp);
    const backVal = decodeURIComponent(link.split("back=")[1]);
    expect(backHref("/admin/orders", backVal)).toBe("/admin/orders?status=new&q=sarah");
  });
  it("two-level round-trip: item -> menu (with its own back) -> list", () => {
    const menuSp = { back: "q=abc" };
    const itemLink = withBackParam("/admin/purchasing/menus/5/item/9", menuSp);
    const itemBackVal = decodeURIComponent(itemLink.split("back=")[1]);
    const restoredMenu = backHref("/admin/purchasing/menus/5", itemBackVal);
    expect(restoredMenu).toBe("/admin/purchasing/menus/5?back=q%3Dabc");
    const menuBack = new URLSearchParams(restoredMenu.split("?")[1]).get("back") ?? "";
    expect(backHref("/admin/purchasing/menus", menuBack)).toBe("/admin/purchasing/menus?q=abc");
  });
});
