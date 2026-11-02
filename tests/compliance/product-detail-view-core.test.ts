/**
 * Register lot details — vitest mirror for the client-safe parser.
 * The register trusts nothing from the network: bad shapes become null,
 * non-http COA links are dropped, and everything is size-capped.
 */
import { describe, expect, it } from "vitest";

import {
  DETAIL_PARSE_MAX_LOTS,
  __runProductDetailViewCoreTests,
  parseProductDetailsResponse,
  terpeneLabel,
} from "@/lib/pos/product-detail-view-core";

describe("product-detail-view-core self-tests", () => {
  it("all pass", () => {
    expect(() => __runProductDetailViewCoreTests()).not.toThrow();
  });
});

describe("product-detail-view-core pins", () => {
  it("rejects garbage", () => {
    expect(parseProductDetailsResponse(null)).toBeNull();
    expect(parseProductDetailsResponse("x")).toBeNull();
  });

  it("drops javascript: COA links and caps lots", () => {
    const one = { lotId: "a", headline: "Lot a", summary: "", sellable: 1, sections: [], terpenes: [], coaUrl: "javascript:alert(1)" };
    const r = parseProductDetailsResponse({ lots: Array.from({ length: 40 }, () => one), lotCount: 40, warnings: [] });
    expect(r).not.toBeNull();
    expect(r!.lots.length).toBeLessThanOrEqual(DETAIL_PARSE_MAX_LOTS);
    expect(r!.lots.every((l) => l.coaUrl === null)).toBe(true);
  });

  it("formats terpene ppm", () => {
    expect(terpeneLabel(4210)).toContain("0.42%");
  });
});
