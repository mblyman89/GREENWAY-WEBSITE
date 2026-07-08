/**
 * tests/compliance/media-product-link.test.ts — Slice H10d (product-image →
 * product link, drafts-only + logo-validator routing).
 *
 * Pins the PURE matcher that suggests which kb_products row a harvested
 * product image belongs to (conservative token overlap with score + reasons;
 * nothing attaches without the owner's Accept), the suggestion payload
 * round-trip, and the logo-review routing helpers.
 */
import { describe, it, expect } from "vitest";
import {
  tokenize,
  scoreProductMatch,
  bestProductMatches,
  buildProductLinkPayload,
  parseProductLinkPayload,
  isLogoUsage,
  withLogoReviewTag,
  MIN_LINK_SCORE,
  LOGO_REVIEW_TAG,
  type ProductForMatch,
} from "@/lib/media/product-link-core";

function product(over: Partial<ProductForMatch> = {}): ProductForMatch {
  return {
    id: "p1",
    brand_slug: "constellation",
    product_slug: "rosinade-lemonade",
    variant_label: "",
    display_name: "Rosinade Lemonade",
    category: "edible",
    status: "draft",
    ...over,
  };
}

describe("tokenize", () => {
  it("lowercases, splits on separators, drops stop-words and bare numbers", () => {
    expect(tokenize("Constellation-Rosinade-Lemonade 100 MG THC")).toEqual([
      "constellation",
      "rosinade",
      "lemonade",
    ]);
  });
  it("tolerates null/empty", () => {
    expect(tokenize(null)).toEqual([]);
    expect(tokenize("")).toEqual([]);
  });
});

describe("scoreProductMatch — the Rosinade case", () => {
  it("matches the crawl filename to the KB product with a strong score", () => {
    const m = scoreProductMatch(
      { derivedName: "Constellation Rosinade Lemonade", entityName: "Constellation" },
      product(),
    );
    expect(m.score).toBeGreaterThanOrEqual(0.9); // full name coverage + brand bonus
    expect(m.reasons.join(" ")).toMatch(/rosinade/i);
    expect(m.reasons.join(" ")).toMatch(/brand matches/i);
  });

  it("halves the score when the brand disagrees", () => {
    const same = scoreProductMatch({ derivedName: "Rosinade Lemonade", entityName: "Constellation" }, product());
    const other = scoreProductMatch({ derivedName: "Rosinade Lemonade", entityName: "Fairwinds" }, product());
    expect(other.score).toBeLessThan(same.score);
    expect(other.reasons.join(" ")).toMatch(/brand differs/i);
  });

  it("scores 0 with a reason when there is nothing to compare", () => {
    const m = scoreProductMatch({}, product());
    expect(m.score).toBe(0);
    expect(m.reasons.length).toBeGreaterThan(0);
  });

  it("partial name overlap alone does not fabricate certainty", () => {
    // Only "lemonade" overlaps → 1/2 product words = 0.5, no brand signal.
    const m = scoreProductMatch({ derivedName: "Sparkling Lemonade Poster" }, product());
    expect(m.score).toBeLessThanOrEqual(0.5);
  });
});

describe("bestProductMatches", () => {
  const catalog: ProductForMatch[] = [
    product(),
    product({ id: "p2", product_slug: "rosinade-grape", display_name: "Rosinade Grape" }),
    product({ id: "p3", brand_slug: "fairwinds", product_slug: "deep-sleep", display_name: "Deep Sleep Tincture" }),
  ];

  it("ranks the right product first and filters below MIN_LINK_SCORE", () => {
    const out = bestProductMatches(
      { derivedName: "Constellation Rosinade Lemonade", entityName: "Constellation" },
      catalog,
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].product.id).toBe("p1");
    for (const m of out) expect(m.score).toBeGreaterThanOrEqual(MIN_LINK_SCORE);
    expect(out.some((m) => m.product.id === "p3")).toBe(false); // unrelated product excluded
  });

  it("returns [] when nothing clears the bar", () => {
    expect(bestProductMatches({ derivedName: "team photo" }, catalog)).toEqual([]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      product({ id: `x${i}`, product_slug: `rosinade-${i}`, display_name: `Rosinade ${i}` }),
    );
    const out = bestProductMatches({ derivedName: "Constellation Rosinade", entityName: "Constellation" }, many, 5);
    expect(out.length).toBeLessThanOrEqual(5);
  });
});

describe("product-link payload round-trip", () => {
  it("serialises and parses back exactly", () => {
    const m = scoreProductMatch(
      { derivedName: "Constellation Rosinade Lemonade", entityName: "Constellation" },
      product(),
    );
    const raw = buildProductLinkPayload("media-1", m);
    const p = parseProductLinkPayload(raw);
    expect(p).not.toBeNull();
    expect(p!.kind).toBe("product-link");
    expect(p!.media_id).toBe("media-1");
    expect(p!.product_id).toBe("p1");
    expect(p!.product_display_name).toBe("Rosinade Lemonade");
    expect(p!.score).toBe(m.score);
    expect(p!.reasons).toEqual(m.reasons);
  });

  it("rejects junk defensively (never throws)", () => {
    expect(parseProductLinkPayload(null)).toBeNull();
    expect(parseProductLinkPayload("")).toBeNull();
    expect(parseProductLinkPayload("not json")).toBeNull();
    expect(parseProductLinkPayload('{"kind":"other"}')).toBeNull();
    expect(parseProductLinkPayload('{"kind":"product-link"}')).toBeNull(); // missing ids
  });
});

describe("logo routing", () => {
  it("isLogoUsage matches exactly the logo classes", () => {
    expect(isLogoUsage("logo")).toBe(true);
    expect(isLogoUsage("vendor-logo")).toBe(true);
    expect(isLogoUsage("brand-logo")).toBe(true);
    expect(isLogoUsage("product")).toBe(false);
    expect(isLogoUsage(null)).toBe(false);
  });

  it("withLogoReviewTag is idempotent and keeps existing tags", () => {
    const once = withLogoReviewTag(["harvested"]);
    expect(once).toEqual(["harvested", LOGO_REVIEW_TAG]);
    expect(withLogoReviewTag(once)).toEqual(once);
    expect(withLogoReviewTag(null)).toEqual([LOGO_REVIEW_TAG]);
  });

  it("caps at 12 tags and the routing tag always survives the cap", () => {
    const many = Array.from({ length: 12 }, (_, i) => `t-${i}`);
    const out = withLogoReviewTag(many);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out).toContain(LOGO_REVIEW_TAG);
  });
});
