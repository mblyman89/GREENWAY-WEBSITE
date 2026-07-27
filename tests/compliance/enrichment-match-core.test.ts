/**
 * tests/compliance/enrichment-match-core.test.ts — SLICE 38.
 *
 * Pins the Product Enrichment command-center matching engine
 * (src/lib/enrichment/match-core.ts). Owner: "I want the system to be
 * incredibly intelligent and capable of looking through our media assets,
 * look through our vendor data, look through our kb, and match assets to
 * products effectively and efficiently. If there are no assets to enrich
 * the item with, suggest methods for getting the assets needed. Or ask if
 * we'd like to use a fall back image instead."
 */
import { describe, it, expect } from "vitest";
import {
  tokenizeEnrichment,
  scoreKbCandidate,
  scoreMediaCandidate,
  scoreVendorCandidate,
  rankMatches,
  buildAssetGuidance,
  buildGuidanceActions,
  parseEnrichmentSort,
  parseEnrichmentStatusFilter,
  sortEnrichmentList,
  filterByEnrichmentStatus,
  gapCount,
  MIN_MATCH_SCORE,
  type PosProductSignals,
  type SortableGapRow,
} from "@/lib/enrichment/match-core";

const pos: PosProductSignals = { name: "Blue Dream Flower 3.5g", brand: "Phat Panda", category: "flower" };

describe("tokenizeEnrichment", () => {
  it("lowercases, splits on punctuation, drops stop words and pure numbers", () => {
    expect(tokenizeEnrichment("Blue Dream 3.5g Flower")).toEqual(["blue", "dream", "5g", "flower"]);
    expect(tokenizeEnrichment("THC 100mg Pack of 10")).toEqual(["100mg"]);
  });

  it("is null/empty safe", () => {
    expect(tokenizeEnrichment(null)).toEqual([]);
    expect(tokenizeEnrichment("")).toEqual([]);
    expect(tokenizeEnrichment(undefined)).toEqual([]);
  });
});

describe("scoreKbCandidate", () => {
  const base = {
    id: "k1",
    display_name: "Blue Dream Flower",
    brand_slug: "phat-panda",
    variant_label: "3.5g",
    category: "flower",
    status: "published",
    hasImage: true,
    hasDescription: true,
  };

  it("scores an exact name + brand match high with reasons", () => {
    const m = scoreKbCandidate(pos, base);
    expect(m.score).toBeGreaterThanOrEqual(0.9);
    expect(m.reasons.some((r) => r.startsWith("Name overlap"))).toBe(true);
    expect(m.reasons.some((r) => r.startsWith("Brand matches"))).toBe(true);
    expect(m.reasons).toContain("Has a product image.");
    expect(m.reasons).toContain("Has a validated description.");
    expect(m.reasons).toContain("Published KB entry.");
  });

  it("halves the score when brands disagree", () => {
    const agree = scoreKbCandidate(pos, base);
    const disagree = scoreKbCandidate(pos, { ...base, brand_slug: "other-farms" });
    expect(disagree.score).toBeLessThan(agree.score);
    expect(disagree.reasons.some((r) => r.startsWith("Brand differs"))).toBe(true);
  });
});

describe("scoreMediaCandidate", () => {
  it("matches on title/alt/tags tokens and surfaces usage/status reasons", () => {
    const m = scoreMediaCandidate(pos, {
      id: "m1",
      title: "blue-dream-flower.jpg",
      alt_text: null,
      tags: ["phat panda"],
      usage_type: "product",
      status: "published",
    });
    expect(m.score).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
    expect(m.reasons).toContain("Tagged as a product image.");
    expect(m.reasons).toContain("Published in the media library.");
  });

  it("scores 0 with an explanatory reason when there is nothing to compare", () => {
    const m = scoreMediaCandidate(pos, {
      id: "m2", title: null, alt_text: null, tags: [], usage_type: null, status: "draft",
    });
    expect(m.score).toBe(0);
    expect(m.reasons[0]).toBe("Not enough text to compare.");
  });
});

describe("scoreVendorCandidate", () => {
  it("flags importable vendor images and available descriptions", () => {
    const m = scoreVendorCandidate(pos, {
      id: "v1", platform: "cultivera", name: "Blue Dream Flower 3.5g", brand: "Phat Panda",
      category: "Flower", image_url: "https://cdn.example/bd.jpg", media_asset_id: null,
      description: "A classic favorite.",
    });
    expect(m.score).toBeGreaterThanOrEqual(0.9);
    expect(m.reasons).toContain("Vendor image available to import.");
    expect(m.reasons).toContain("Vendor description available.");
  });

  it("prefers the already-saved asset reason over import when media_asset_id set", () => {
    const m = scoreVendorCandidate(pos, {
      id: "v2", platform: "growflow", name: "Blue Dream Flower", brand: null,
      category: null, image_url: "https://cdn.example/bd.jpg", media_asset_id: "asset-1",
      description: null,
    });
    expect(m.reasons).toContain("Image already saved to the media library.");
    expect(m.reasons).not.toContain("Vendor image available to import.");
  });
});

describe("rankMatches", () => {
  it("gates below MIN_MATCH_SCORE, sorts best-first, and caps", () => {
    const ranked = rankMatches(
      [
        { candidate: "low", score: 0.4, reasons: [] },
        { candidate: "high", score: 0.9, reasons: [] },
        { candidate: "mid", score: 0.6, reasons: [] },
      ],
      5,
    );
    expect(ranked.map((r) => r.candidate)).toEqual(["high", "mid"]);
    expect(rankMatches([{ candidate: 1, score: 1, reasons: [] }], 0)).toEqual([]);
  });
});

describe("buildAssetGuidance", () => {
  it("returns nothing when both description and image exist", () => {
    expect(
      buildAssetGuidance({
        hasDescription: true, hasImage: true, kbMatches: 3, mediaMatches: 1,
        vendorMatches: 2, substituteAvailable: true,
      }),
    ).toEqual([]);
  });

  it("gives the full acquisition checklist including the fallback offer when bare", () => {
    const lines = buildAssetGuidance({
      hasDescription: false, hasImage: false, kbMatches: 0, mediaMatches: 0,
      vendorMatches: 0, substituteAvailable: true, brand: "Phat Panda",
    });
    expect(lines.some((l) => l.includes("Harvest the vendor"))).toBe(true);
    expect(lines.some((l) => l.includes("Phat Panda rep"))).toBe(true);
    expect(lines.some((l) => l.includes("Photograph the product in store"))).toBe(true);
    expect(lines.some((l) => l.includes("approved fallback image"))).toBe(true);
    expect(lines.some((l) => l.includes("AI description"))).toBe(true);
  });

  it("leads with review-matches and skips harvest/fallback when not applicable", () => {
    const lines = buildAssetGuidance({
      hasDescription: true, hasImage: false, kbMatches: 1, mediaMatches: 0,
      vendorMatches: 2, substituteAvailable: false,
    });
    expect(lines[0]).toContain("suggested matches");
    expect(lines.some((l) => l.includes("Harvest the vendor"))).toBe(false);
    expect(lines.some((l) => l.includes("fallback image"))).toBe(false);
  });
});

describe("worklist sorting + filtering", () => {
  const rows: SortableGapRow[] = [
    { name: "Alpha", brand: "Z Farms", category: "edible", hasDescription: true, hasImage: true, hasBrandLink: true, enrichmentStatus: "published" },
    { name: "Bravo", brand: "A Farms", category: "flower", hasDescription: false, hasImage: false, hasBrandLink: false, enrichmentStatus: null },
    { name: "Charlie", brand: "M Farms", category: "flower", hasDescription: true, hasImage: false, hasBrandLink: true, enrichmentStatus: "draft" },
  ];

  it("parses sort and status params defensively", () => {
    expect(parseEnrichmentSort("bogus")).toBe("gaps");
    expect(parseEnrichmentSort("brand")).toBe("brand");
    expect(parseEnrichmentStatusFilter("published")).toBe("published");
    expect(parseEnrichmentStatusFilter("junk")).toBe("");
  });

  it("counts gaps and sorts most-broken first by default", () => {
    expect(gapCount(rows[1]!)).toBe(3);
    expect(gapCount(rows[0]!)).toBe(0);
    const sorted = sortEnrichmentList(rows, "gaps");
    expect(sorted[0]!.name).toBe("Bravo");
    expect(sorted[2]!.name).toBe("Alpha");
    // Does not mutate the input.
    expect(rows[0]!.name).toBe("Alpha");
  });

  it("supports name/brand/category/status sorts", () => {
    expect(sortEnrichmentList(rows, "name")[0]!.name).toBe("Alpha");
    expect(sortEnrichmentList(rows, "brand")[0]!.brand).toBe("A Farms");
    expect(sortEnrichmentList(rows, "category")[0]!.category).toBe("edible");
    const byStatus = sortEnrichmentList(rows, "status");
    expect(byStatus[0]!.enrichmentStatus).toBe("published");
    expect(byStatus[2]!.enrichmentStatus).toBeNull();
  });

  it("filters by enrichment status including never-enriched", () => {
    expect(filterByEnrichmentStatus(rows, "none").map((r) => r.name)).toEqual(["Bravo"]);
    expect(filterByEnrichmentStatus(rows, "draft").map((r) => r.name)).toEqual(["Charlie"]);
    expect(filterByEnrichmentStatus(rows, "")).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// SLICE 72 — worklist intelligence: smart priority, price sorts, stock filter.
// Mirrors the embedded self-tests in match-core.ts.
// ---------------------------------------------------------------------------

import {
  enrichmentPriorityScore,
  parseEnrichmentStockFilter,
  filterByStock,
} from "@/lib/enrichment/match-core";

describe("worklist intelligence — SLICE 72", () => {
  const worklist: SortableGapRow[] = [
    { name: "Dead", brand: "B", category: "flower", hasDescription: false, hasImage: false, hasBrandLink: false, enrichmentStatus: null, hasTags: false, priceMinorUnits: 4000, inventoryStatus: "unavailable" },
    { name: "Hot", brand: "B", category: "flower", hasDescription: false, hasImage: false, hasBrandLink: false, enrichmentStatus: null, hasTags: false, priceMinorUnits: 4000, inventoryStatus: "in-stock" },
    { name: "Done", brand: "B", category: "flower", hasDescription: true, hasImage: true, hasBrandLink: true, enrichmentStatus: "published", hasTags: true, priceMinorUnits: 9000, inventoryStatus: "in-stock" },
  ];

  it("priority score: in-stock broken beats sold-out broken beats complete", () => {
    expect(enrichmentPriorityScore(worklist[1]!)).toBeGreaterThan(enrichmentPriorityScore(worklist[0]!));
    expect(enrichmentPriorityScore(worklist[0]!)).toBeGreaterThan(enrichmentPriorityScore(worklist[2]!));
  });

  it("priority sort puts sellable + broken first and complete last", () => {
    const sorted = sortEnrichmentList(worklist, "priority");
    expect(sorted[0]!.name).toBe("Hot");
    expect(sorted[2]!.name).toBe("Done");
  });

  it("price sorts work both directions", () => {
    expect(sortEnrichmentList(worklist, "priceHigh")[0]!.name).toBe("Done");
    expect(sortEnrichmentList(worklist, "priceLow")[0]!.priceMinorUnits).toBe(4000);
  });

  it("stock filter matches POS inventory_status exactly; empty keeps all", () => {
    expect(filterByStock(worklist, "in-stock")).toHaveLength(2);
    expect(filterByStock(worklist, "unavailable").map((r) => r.name)).toEqual(["Dead"]);
    expect(filterByStock(worklist, "")).toHaveLength(3);
  });

  it("parsers accept the new keys and stay defensive", () => {
    expect(parseEnrichmentSort("priority")).toBe("priority");
    expect(parseEnrichmentSort("priceHigh")).toBe("priceHigh");
    expect(parseEnrichmentSort("priceLow")).toBe("priceLow");
    expect(parseEnrichmentStockFilter("low-stock")).toBe("low-stock");
    expect(parseEnrichmentStockFilter("junk")).toBe("");
  });

  it("legacy rows without SLICE 72 fields degrade gracefully", () => {
    const legacy: SortableGapRow[] = [
      { name: "Old", brand: "B", category: "flower", hasDescription: false, hasImage: false, hasBrandLink: false, enrichmentStatus: null },
    ];
    expect(sortEnrichmentList(legacy, "priority")).toHaveLength(1);
    expect(sortEnrichmentList(legacy, "priceHigh")).toHaveLength(1);
    expect(Number.isFinite(enrichmentPriorityScore(legacy[0]!))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SLICE 73 — jump-to buttons. Owner: "If we don't have the details we need for
// a product, I want jump to buttons added to the detail page that takes me to
// where I need to be to fetch/scrape that info."
// ---------------------------------------------------------------------------
describe("SLICE 73 — buildGuidanceActions (jump-to buttons)", () => {
  const bare = buildGuidanceActions({
    hasDescription: false, hasImage: false, kbMatches: 0, mediaMatches: 0,
    vendorMatches: 0, substituteAvailable: true, hasBrandLink: false,
    searchQuery: "Grape Gas 3.5g",
  });

  it("fully enriched product with a linked brand gets no buttons", () => {
    expect(
      buildGuidanceActions({
        hasDescription: true, hasImage: true, kbMatches: 0, mediaMatches: 0,
        vendorMatches: 0, substituteAvailable: true, hasBrandLink: true,
      }),
    ).toEqual([]);
  });

  it("missing image with no vendor matches offers the vendor-menu harvest jump", () => {
    expect(bare.some((a) => a.href === "/admin/purchasing/menus")).toBe(true);
  });

  it("media-library jump pre-fills the search with the product name", () => {
    expect(bare.some((a) => a.href === "/admin/media?q=Grape%20Gas%203.5g")).toBe(true);
  });

  it("offers KB harvest, in-page upload anchor and fallback manager for a missing image", () => {
    expect(bare.some((a) => a.href === "/admin/knowledge-base/harvest")).toBe(true);
    expect(bare.some((a) => a.href === "#upload")).toBe(true);
    expect(bare.some((a) => a.href === "/admin/knowledge-base/images")).toBe(true);
  });

  it("missing description jumps to the AI panel; unlinked brand jumps to the brand panel last", () => {
    expect(bare.some((a) => a.href === "#ai")).toBe(true);
    expect(bare[bare.length - 1]!.href).toBe("#brand");
  });

  it("every button carries a label and a plain-English hint", () => {
    expect(bare.every((a) => a.label.length > 0 && a.hint.length > 0)).toBe(true);
  });

  it("review-matches leads when suggestions exist, and satisfied needs drop their buttons", () => {
    const withMatches = buildGuidanceActions({
      hasDescription: false, hasImage: false, kbMatches: 2, mediaMatches: 0,
      vendorMatches: 1, substituteAvailable: false,
    });
    expect(withMatches[0]!.href).toBe("#matches");
    expect(withMatches.some((a) => a.href === "/admin/purchasing/menus")).toBe(false);
    expect(withMatches.some((a) => a.href === "/admin/knowledge-base/images")).toBe(false);
    // hasBrandLink omitted → legacy callers never see a brand nag.
    expect(withMatches.some((a) => a.href === "#brand")).toBe(false);
  });

  it("blank search query falls back to a plain media-library link", () => {
    const noQuery = buildGuidanceActions({
      hasDescription: true, hasImage: false, kbMatches: 0, mediaMatches: 0,
      vendorMatches: 0, substituteAvailable: false, searchQuery: "   ",
    });
    expect(noQuery.some((a) => a.href === "/admin/media")).toBe(true);
    expect(noQuery.some((a) => a.href === "#ai")).toBe(false);
  });
});
