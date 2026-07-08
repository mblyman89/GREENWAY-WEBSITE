/**
 * tests/compliance/media-return-state.test.ts — Slice H12d.
 *
 * Pins the media-library filter round-trip: grid links carry ?q/&status/&usage
 * into the detail page, forms carry it back through returnTo, and the action
 * redirect validator can never be steered off the admin app.
 */
import { describe, it, expect } from "vitest";
import {
  pickListParams,
  listQueryString,
  withListParams,
  appendQuery,
  safeAdminPath,
} from "@/lib/media/return-state-core";

describe("pickListParams", () => {
  it("keeps only non-empty filter params", () => {
    expect(pickListParams({ q: "shot", status: "draft", usage: "", saved: "1" })).toEqual({
      q: "shot",
      status: "draft",
    });
  });
  it("takes the first value of array params and tolerates null/undefined", () => {
    expect(pickListParams({ status: ["draft", "published"] })).toEqual({ status: "draft" });
    expect(pickListParams(null)).toEqual({});
    expect(pickListParams(undefined)).toEqual({});
  });
});

describe("withListParams / listQueryString", () => {
  it("builds the owner's filtered-drafts scenario end to end", () => {
    const params = pickListParams({ status: "draft" });
    // Grid link into the detail page carries the filter…
    expect(withListParams("/admin/media/abc", params)).toBe("/admin/media/abc?status=draft");
    // …and the back link restores the filtered library view.
    expect(withListParams("/admin/media", params)).toBe("/admin/media?status=draft");
  });
  it("no active filters → clean paths", () => {
    expect(withListParams("/admin/media", {})).toBe("/admin/media");
    expect(listQueryString({})).toBe("");
  });
  it("extra params (saved=1) merge with the filters", () => {
    expect(withListParams("/admin/media/abc", { status: "draft" }, { saved: "1" })).toBe(
      "/admin/media/abc?status=draft&saved=1",
    );
  });
  it("encodes search text safely", () => {
    expect(listQueryString({ q: "blue dream 1:1" })).toBe("q=blue+dream+1%3A1");
  });
});

describe("appendQuery", () => {
  it("appends to an href that already has a query string", () => {
    expect(appendQuery("/admin/media/abc?status=draft", { saved: "1" })).toBe(
      "/admin/media/abc?status=draft&saved=1",
    );
  });
  it("overrides an existing key instead of duplicating it", () => {
    expect(appendQuery("/admin/media?saved=9", { saved: "1" })).toBe("/admin/media?saved=1");
  });
  it("works on a bare path", () => {
    expect(appendQuery("/admin/media", { deleted: "1" })).toBe("/admin/media?deleted=1");
  });
});

describe("safeAdminPath — redirect target validation", () => {
  it("passes in-app admin paths (with query strings)", () => {
    expect(safeAdminPath("/admin/media?status=draft", "/admin/media")).toBe(
      "/admin/media?status=draft",
    );
    expect(safeAdminPath("/admin/media/abc?q=x", "/admin/media")).toBe("/admin/media/abc?q=x");
  });
  it("rejects external URLs, protocol-relative, and non-admin paths", () => {
    expect(safeAdminPath("https://evil.com/admin/media", "/admin/media")).toBe("/admin/media");
    expect(safeAdminPath("//evil.com/admin", "/admin/media")).toBe("/admin/media");
    expect(safeAdminPath("/logout", "/admin/media")).toBe("/admin/media");
    expect(safeAdminPath("", "/admin/media")).toBe("/admin/media");
    expect(safeAdminPath(null, "/admin/media")).toBe("/admin/media");
  });
});
