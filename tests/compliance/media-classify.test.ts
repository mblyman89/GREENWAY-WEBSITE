/**
 * tests/compliance/media-classify.test.ts — Slice H10b (media classifier).
 *
 * Pins the PURE classifier that tells a product image from a vendor/brand
 * logo (and icons/banners) so harvested assets stop being misfiled. The
 * owner's screenshot showed the exact failure this exists to catch: a
 * Rosinade beverage CAN imported as "Vendor logo".
 */
import { describe, it, expect } from "vitest";
import {
  classifyMediaAsset,
  crawlPath,
  suggestTags,
  VISION_SUBJECTS,
  type ClassifySignals,
} from "@/lib/media/classify-core";
import { isValidPurpose } from "@/lib/media/taxonomy";

function sig(over: Partial<ClassifySignals> = {}): ClassifySignals {
  return { ...over };
}

describe("crawlPath", () => {
  it("extracts the path from crawl:<url> provenance", () => {
    expect(crawlPath("crawl:https://site.com/edibles/gummy.jpg")).toBe("/edibles/gummy.jpg");
  });
  it("returns '' for non-crawl sources and junk", () => {
    expect(crawlPath("upload")).toBe("");
    expect(crawlPath(null)).toBe("");
    expect(crawlPath("crawl:not a url")).toBe("");
  });
});

describe("classifyMediaAsset — the Rosinade misfile (owner's screenshot)", () => {
  it("re-categorises a product can imported as vendor-logo when vision sees packaging", () => {
    const r = classifyMediaAsset(sig({
      filename: "Constellation-Rosinade-Lemonade-640x1156.png",
      source: "crawl:https://example.com/wp-content/uploads/Constellation-Rosinade-Lemonade.png",
      currentUsageType: "vendor-logo",
      width: 640,
      height: 1156,
      visionSubject: "product-packaging",
      entityName: "Alpha Crux Llc",
    }));
    expect(r.usageType).toBe("product");
    expect(r.overturnsPrior).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
    expect(r.reasons.join(" ")).toMatch(/packaging/i);
  });

  it("even WITHOUT vision, filename + tall portrait shape beat the logo prior", () => {
    const r = classifyMediaAsset(sig({
      filename: "Constellation-Rosinade-Lemonade-640x1156.png",
      currentUsageType: "vendor-logo",
      width: 640,
      height: 1156,
    }));
    expect(r.usageType).toBe("product");
    expect(r.overturnsPrior).toBe(true);
  });
});

describe("classifyMediaAsset — logos stay logos", () => {
  it("vision logo-wordmark + logo filename → keeps the vendor-logo prior", () => {
    const r = classifyMediaAsset(sig({
      filename: "fairwinds-logo.svg",
      mimeType: "image/svg+xml",
      currentUsageType: "vendor-logo",
      visionSubject: "logo-wordmark",
    }));
    expect(r.usageType).toBe("vendor-logo"); // prior refines generic logo
    expect(r.overturnsPrior).toBe(false);
  });

  it("brand-logo prior refines a logo verdict to brand-logo", () => {
    const r = classifyMediaAsset(sig({
      filename: "wordmark.png",
      currentUsageType: "brand-logo",
      visionSubject: "logo-wordmark",
    }));
    expect(r.usageType).toBe("brand-logo");
  });

  it("logo verdict with NO prior suggests generic 'logo'", () => {
    const r = classifyMediaAsset(sig({ filename: "acme-logo.png", visionSubject: "logo-wordmark" }));
    expect(r.usageType).toBe("logo");
  });
});

describe("classifyMediaAsset — path/shape/format signals", () => {
  it("harvested from an /edibles/ page → product", () => {
    const r = classifyMediaAsset(sig({
      filename: "IMG_2041.jpg",
      source: "crawl:https://vendor.com/edibles/cosmic-crunch.jpg",
    }));
    expect(r.usageType).toBe("product");
  });

  it("small square → icon", () => {
    const r = classifyMediaAsset(sig({ filename: "favicon-32.png", width: 32, height: 32 }));
    expect(r.usageType).toBe("icon");
  });

  it("very wide raster with banner word → banner", () => {
    const r = classifyMediaAsset(sig({ filename: "spring-hero.jpg", width: 1920, height: 500 }));
    expect(r.usageType).toBe("banner");
  });

  it("no signals at all → keeps prior at low confidence, never throws", () => {
    const r = classifyMediaAsset(sig({ currentUsageType: "hero" }));
    expect(r.usageType).toBe("hero");
    expect(r.confidence).toBeLessThanOrEqual(0.3);
    expect(r.overturnsPrior).toBe(false);
  });

  it("no signals and no prior → other", () => {
    const r = classifyMediaAsset(sig({}));
    expect(r.usageType).toBe("other");
  });

  it("always returns a VALID taxonomy purpose id", () => {
    const cases: ClassifySignals[] = [
      { filename: "x-logo.svg", mimeType: "image/svg+xml" },
      { filename: "gummy-can.jpg", width: 600, height: 1200 },
      { filename: "hero-banner.jpg", width: 2000, height: 600 },
      { filename: "badge-icon.png", width: 48, height: 48 },
      {},
    ];
    for (const c of cases) {
      const r = classifyMediaAsset(c);
      expect(isValidPurpose(r.usageType)).toBe(true);
    }
  });

  it("confidence stays within 0.2..0.95", () => {
    for (const c of [{}, { filename: "logo.svg", visionSubject: "logo-wordmark" as const, mimeType: "image/svg+xml" }]) {
      const r = classifyMediaAsset(c);
      expect(r.confidence).toBeGreaterThanOrEqual(0.2);
      expect(r.confidence).toBeLessThanOrEqual(0.95);
    }
  });
});

describe("VISION_SUBJECTS vocabulary", () => {
  it("is a closed list including the classes the classifier maps", () => {
    for (const s of ["product-packaging", "logo-wordmark", "icon-or-badge", "other"]) {
      expect(VISION_SUBJECTS).toContain(s);
    }
  });
});

describe("suggestTags", () => {
  it("keeps importer tags, adds class + entity + category words, normalized", () => {
    const cls = classifyMediaAsset(sig({
      filename: "Constellation-Rosinade-Lemonade.png",
      source: "crawl:https://vendor.com/edibles/rosinade.png",
      visionSubject: "product-packaging",
      entityName: "Alpha Crux Llc",
      tags: ["harvested"],
    }));
    const tags = suggestTags(cls, sig({
      filename: "Constellation-Rosinade-Lemonade.png",
      source: "crawl:https://vendor.com/edibles/rosinade.png",
      entityName: "Alpha Crux Llc",
      tags: ["harvested"],
    }));
    expect(tags).toContain("harvested");
    expect(tags).toContain("product");
    expect(tags).toContain("alpha-crux-llc");
    expect(tags).toContain("edibles");
    expect(tags).toContain("product-image");
    expect(tags.length).toBeLessThanOrEqual(12);
  });

  it("logo classes get the needs-logo-review routing tag", () => {
    const s = sig({ filename: "acme-logo.svg", currentUsageType: "vendor-logo", visionSubject: "logo-wordmark" });
    const cls = classifyMediaAsset(s);
    expect(suggestTags(cls, s)).toContain("needs-logo-review");
  });

  it("dedupes and caps at 12", () => {
    const s = sig({ tags: Array.from({ length: 20 }, (_, i) => `t-${i}`), filename: "logo.png" });
    const cls = classifyMediaAsset(s);
    expect(suggestTags(cls, s).length).toBeLessThanOrEqual(12);
  });
});
