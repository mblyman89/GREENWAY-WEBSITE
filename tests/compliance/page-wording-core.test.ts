/**
 * MIG-1 MS-1.2 — the all-inclusive "Page wording" card.
 *
 * These pins lock the pure contract the Vendors page editor relies on:
 *   - the rollout set is additive and starts with vendors at MS-1.2,
 *     then adds about at MS-2.1a, then locations at MS-2.1b, then
 *     price-match at MS-2.1c,
 *   - pageHasWording agrees with the set,
 *   - the public-path helper returns a real path for a page and safely yields
 *     null for blank/missing previewPaths (so the block browser omits the
 *     "View on site" link rather than linking somewhere broken),
 *   - exactly four pages are wired at MS-2.1c (a deliberate, per-slice snapshot).
 *
 * It also runs the module's embedded self-tests so the two never drift.
 */
import { describe, expect, it } from "vitest";

import {
  PAGES_WITH_WORDING,
  pageHasWording,
  wordingBlockPublicPath,
  __runPageWordingCoreTests,
} from "@/lib/cms/page-wording-core";

describe("page-wording-core", () => {
  it("wires vendors wording at MS-1.2", () => {
    expect(PAGES_WITH_WORDING.has("vendors")).toBe(true);
    expect(pageHasWording("vendors")).toBe(true);
  });

  it("wires about wording at MS-2.1a", () => {
    expect(PAGES_WITH_WORDING.has("about")).toBe(true);
    expect(pageHasWording("about")).toBe(true);
  });

  it("wires locations wording at MS-2.1b", () => {
    expect(PAGES_WITH_WORDING.has("locations")).toBe(true);
    expect(pageHasWording("locations")).toBe(true);
  });

  it("wires price-match wording at MS-2.1c (slug has a hyphen)", () => {
    expect(PAGES_WITH_WORDING.has("price-match")).toBe(true);
    expect(pageHasWording("price-match")).toBe(true);
  });

  it("does not wire unknown pages", () => {
    expect(pageHasWording("nope")).toBe(false);
  });

  it("resolves the vendors public path and handles blanks safely", () => {
    expect(wordingBlockPublicPath("/vendor-delivery")).toBe("/vendor-delivery");
    expect(wordingBlockPublicPath("")).toBeNull();
    expect(wordingBlockPublicPath(null)).toBeNull();
    expect(wordingBlockPublicPath(undefined)).toBeNull();
    expect(wordingBlockPublicPath("  /about  ")).toBe("/about");
  });

  it("wires faq wording at MIG-5a", () => {
    expect(PAGES_WITH_WORDING.has("faq")).toBe(true);
    expect(pageHasWording("faq")).toBe(true);
  });

  it("does NOT wire home wording (MIG-5a-fix removed the duplicate)", () => {
    // The Home category/brand banners are edited in the Home "Sections" tab
    // (page_sections). The home.category.*/home.brand.* content blocks are only
    // the legacy render fallback behind them, so surfacing them in a Page
    // wording card was a duplicate editor. MIG-5a-fix removed it.
    expect(PAGES_WITH_WORDING.has("home")).toBe(false);
    expect(pageHasWording("home")).toBe(false);
  });

  it("has exactly five wording pages after MIG-5a-fix (snapshot)", () => {
    expect(PAGES_WITH_WORDING.size).toBe(5);
  });

  it("passes its embedded pure self-tests", () => {
    const r = __runPageWordingCoreTests();
    expect(r.passed).toBeGreaterThanOrEqual(13);
  });
});
