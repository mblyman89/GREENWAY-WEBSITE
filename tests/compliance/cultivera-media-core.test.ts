/**
 * Vitest mirror of the cultivera-media-core self-tests (CV-5).
 * Exercises the SAME behaviors as __runCultiveraMediaCoreTests so CI
 * covers the media-save planner even without the pure runner.
 */
import { describe, expect, it } from "vitest";
import {
  isHttpUrl,
  planMediaSaves,
  remainingMediaCount,
  vendorTag,
  cultiveraMediaTags,
  mediaTitleForItem,
  mediaAltForItem,
  bulkSaveSummary,
  type MediaItemLike,
} from "@/lib/purchasing/cultivera-media-core";

function mk(over: Partial<MediaItemLike>): MediaItemLike {
  return {
    id: "i1",
    name: "Blue Dream",
    brand: "Acme",
    image_url: null,
    coa_url: null,
    media_asset_id: null,
    coa_media_asset_id: null,
    ...over,
  };
}

describe("isHttpUrl", () => {
  it("accepts http(s) and trims", () => {
    expect(isHttpUrl("https://cdn.example.com/a.png")).toBe(true);
    expect(isHttpUrl("http://cdn.example.com/a.png")).toBe(true);
    expect(isHttpUrl("  https://x.y/a.pdf  ")).toBe(true);
  });
  it("rejects null/empty/other schemes/relative", () => {
    expect(isHttpUrl(null)).toBe(false);
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl("ftp://x.y/a")).toBe(false);
    expect(isHttpUrl("data:image/png;base64,xx")).toBe(false);
    expect(isHttpUrl("/relative/path.png")).toBe(false);
  });
});

describe("planMediaSaves", () => {
  const items: MediaItemLike[] = [
    mk({ id: "a", image_url: "https://c/a.png", coa_url: "https://c/a.pdf" }),
    mk({ id: "b", image_url: "https://c/b.png", media_asset_id: "already" }),
    mk({ id: "c", coa_url: "https://c/c.pdf", coa_media_asset_id: "already" }),
    mk({ id: "d", image_url: "not-a-url", coa_url: "https://c/d.pdf" }),
    mk({ id: "e" }),
  ];

  it("plans unlinked fetchable urls in menu order (image before coa)", () => {
    const plan = planMediaSaves(items, 100);
    expect(plan).toHaveLength(3);
    expect(plan[0]).toMatchObject({ itemId: "a", kind: "image", url: "https://c/a.png" });
    expect(plan[1]).toMatchObject({ itemId: "a", kind: "coa" });
    expect(plan[2]).toMatchObject({ itemId: "d", kind: "coa" });
  });
  it("caps at the limit", () => {
    expect(planMediaSaves(items, 2)).toHaveLength(2);
    expect(planMediaSaves(items, 0)).toHaveLength(0);
    expect(planMediaSaves(items, -5)).toHaveLength(0);
  });
  it("skips fully linked items and empty input", () => {
    const linked = [
      mk({ id: "z", image_url: "https://c/z.png", media_asset_id: "m", coa_url: "https://c/z.pdf", coa_media_asset_id: "c" }),
    ];
    expect(planMediaSaves(linked, 10)).toHaveLength(0);
    expect(planMediaSaves([], 10)).toHaveLength(0);
  });
  it("remainingMediaCount counts all unlinked", () => {
    expect(remainingMediaCount(items)).toBe(3);
    expect(remainingMediaCount([])).toBe(0);
  });
});

describe("vendorTag", () => {
  it("kebab-cases and trims punctuation", () => {
    expect(vendorTag("Acme Farms LLC")).toBe("acme-farms-llc");
    expect(vendorTag("  Fine & Dandy!  ")).toBe("fine-dandy");
    expect(vendorTag("")).toBe("");
    expect(vendorTag("A".repeat(60))).toHaveLength(40);
  });
});

describe("cultiveraMediaTags", () => {
  it("builds cultivera + kind + vendor tags", () => {
    expect(cultiveraMediaTags("Acme Farms", "image")).toEqual(["cultivera", "product-image", "acme-farms"]);
    expect(cultiveraMediaTags("Acme Farms", "coa")).toEqual(["cultivera", "coa", "acme-farms"]);
    expect(cultiveraMediaTags("", "image")).toEqual(["cultivera", "product-image"]);
    expect(cultiveraMediaTags("COA", "coa")).toEqual(["cultivera", "coa"]);
  });
});

describe("mediaTitleForItem / mediaAltForItem", () => {
  it("titles with brand, coa suffix, fallbacks", () => {
    expect(mediaTitleForItem({ name: "Blue Dream", brand: "Acme" }, "image")).toBe("Blue Dream — Acme (Cultivera)");
    expect(mediaTitleForItem({ name: "Blue Dream", brand: null }, "image")).toBe("Blue Dream (Cultivera)");
    expect(mediaTitleForItem({ name: "Blue Dream", brand: "Acme" }, "coa")).toBe("Blue Dream COA (Cultivera)");
    expect(mediaTitleForItem({ name: null, brand: null }, "image")).toBe("Cultivera menu item (Cultivera)");
  });
  it("alt text with/without vendor", () => {
    expect(mediaAltForItem({ name: "Blue Dream", brand: "Acme" }, "Acme Farms")).toBe(
      "Blue Dream product image from Acme Farms",
    );
    expect(mediaAltForItem({ name: "Blue Dream", brand: null }, "")).toBe("Blue Dream product image");
  });
});

describe("bulkSaveSummary", () => {
  it("joins the parts that exist", () => {
    expect(bulkSaveSummary({ images: 3, coas: 2, deduped: 1, failed: 0, remaining: 4 })).toBe(
      "Saved 3 images and 2 COAs · 1 duplicate reused · 4 more to go — run again",
    );
    expect(bulkSaveSummary({ images: 1, coas: 0, deduped: 0, failed: 0, remaining: 0 })).toBe("Saved 1 image");
    expect(bulkSaveSummary({ images: 0, coas: 1, deduped: 0, failed: 0, remaining: 0 })).toBe("Saved 1 COA");
    expect(bulkSaveSummary({ images: 0, coas: 0, deduped: 0, failed: 2, remaining: 0 })).toBe(
      "Nothing new to save · 2 failed",
    );
    expect(bulkSaveSummary({ images: 0, coas: 0, deduped: 3, failed: 0, remaining: 0 })).toBe(
      "Nothing new to save · 3 duplicates reused",
    );
  });
});
