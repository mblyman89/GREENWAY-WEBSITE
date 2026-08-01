/**
 * MIG-1 MS-1.2 — the all-inclusive "Page wording" card.
 *
 * These pins lock the pure contract the Vendors page editor relies on:
 *   - the rollout set is additive and starts with vendors at MS-1.2,
 *     then adds about at MS-2.1a,
 *   - pageHasWording agrees with the set,
 *   - the public-path helper returns a real path for a page and safely yields
 *     null for blank/missing previewPaths (so the block browser omits the
 *     "View on site" link rather than linking somewhere broken),
 *   - exactly two pages are wired at MS-2.1a (a deliberate, per-slice snapshot).
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

  it("has exactly two wording pages at MS-2.1a (snapshot)", () => {
    expect(PAGES_WITH_WORDING.size).toBe(2);
  });

  it("passes its embedded pure self-tests", () => {
    const r = __runPageWordingCoreTests();
    expect(r.passed).toBeGreaterThanOrEqual(11);
  });
});
