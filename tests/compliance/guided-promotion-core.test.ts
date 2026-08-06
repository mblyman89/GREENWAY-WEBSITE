/**
 * tests/compliance/guided-promotion-core.test.ts  (PR-P5)
 *
 * GUIDED THURSDAY BRAND SALE — the pure brain, pinned.
 *
 * The guided workflow turns "brand X, 20%, this Thursday" into a ready-to-
 * review promotion draft. This suite proves the transform is safe and
 * predictable: it targets Thursday, clamps the percent, resolves brands
 * against the live menu case-insensitively, drops (and reports) unknown
 * brands, and refuses to build a "sale on nothing".
 */
import { describe, it, expect } from "vitest";
import {
  THURSDAY,
  GUIDED_PERCENT_MIN,
  GUIDED_PERCENT_MAX,
  clampGuidedPercent,
  defaultThursdayTitle,
  buildThursdayBrandSaleDraft,
  parseGuidedParams,
  guidedNewPromotionHref,
} from "@/lib/promotions/guided-promotion-core";

const MENU = ["Fairwinds", "Avitas", "Dama", "Top Shelf Co"];

describe("clampGuidedPercent", () => {
  it("clamps above the max", () => expect(clampGuidedPercent(200)).toBe(GUIDED_PERCENT_MAX));
  it("floors zero/negative to the min", () => {
    expect(clampGuidedPercent(0)).toBe(GUIDED_PERCENT_MIN);
    expect(clampGuidedPercent(-10)).toBe(GUIDED_PERCENT_MIN);
  });
  it("rounds non-integers", () => expect(clampGuidedPercent(19.6)).toBe(20));
  it("floors NaN to the min", () => expect(clampGuidedPercent(Number.NaN)).toBe(GUIDED_PERCENT_MIN));
});

describe("defaultThursdayTitle", () => {
  it("names one brand", () =>
    expect(defaultThursdayTitle(["Avitas"], 20)).toBe("Top Shelf Thursday — Avitas 20% off"));
  it("joins two brands", () =>
    expect(defaultThursdayTitle(["Avitas", "Dama"], 15)).toBe(
      "Top Shelf Thursday — Avitas & Dama 15% off",
    ));
  it("counts three or more", () =>
    expect(defaultThursdayTitle(["A", "B", "C"], 10)).toBe("Top Shelf Thursday — 3 brands 10% off"));
});

describe("buildThursdayBrandSaleDraft", () => {
  it("builds a Thursday percent draft from a known brand", () => {
    const r = buildThursdayBrandSaleDraft({ brands: ["Avitas"], percent: 20 }, MENU);
    expect(r.promotion).not.toBeNull();
    expect(r.promotion?.weekday).toBe(THURSDAY);
    expect(r.promotion?.discount_type).toBe("percent");
    expect(r.promotion?.discount_percent).toBe(20);
    expect(r.promotion?.per_item_sale).toBe(true);
    expect(r.promotion?.status).toBe("draft");
    expect(r.promotion?.targets).toHaveLength(1);
    expect(r.promotion?.targets[0]).toMatchObject({ scope: "brand", value: "Avitas" });
    expect(r.promotion?.exclusions).toHaveLength(0);
  });

  it("resolves brands case-insensitively to the canonical spelling", () => {
    const r = buildThursdayBrandSaleDraft({ brands: ["avitas", "FAIRWINDS"], percent: 15 }, MENU);
    expect(r.validBrands).toEqual(expect.arrayContaining(["Avitas", "Fairwinds"]));
    expect(r.promotion?.targets).toHaveLength(2);
  });

  it("drops and reports unknown brands but still builds from valid ones", () => {
    const r = buildThursdayBrandSaleDraft({ brands: ["Avitas", "Ghost Brand"], percent: 25 }, MENU);
    expect(r.promotion).not.toBeNull();
    expect(r.droppedBrands).toContain("Ghost Brand");
    expect(r.validBrands).toEqual(["Avitas"]);
    expect(r.warnings.some((w) => w.includes("Ghost Brand"))).toBe(true);
  });

  it("refuses to build when nothing valid is selected", () => {
    const r = buildThursdayBrandSaleDraft({ brands: ["Nope", "Nada"], percent: 20 }, MENU);
    expect(r.promotion).toBeNull();
    expect(r.warnings.some((w) => w.toLowerCase().includes("nothing"))).toBe(true);
  });

  it("clamps an out-of-range percent and warns", () => {
    const r = buildThursdayBrandSaleDraft({ brands: ["Avitas"], percent: 150 }, MENU);
    expect(r.promotion?.discount_percent).toBe(GUIDED_PERCENT_MAX);
    expect(r.warnings.some((w) => w.includes("adjusted"))).toBe(true);
  });

  it("honours a custom title override (trimmed)", () => {
    const r = buildThursdayBrandSaleDraft(
      { brands: ["Avitas"], percent: 20, titleOverride: "  My Custom Sale  " },
      MENU,
    );
    expect(r.promotion?.title).toBe("My Custom Sale");
  });

  it("deduplicates repeated brand picks", () => {
    const r = buildThursdayBrandSaleDraft({ brands: ["Avitas", "avitas", "AVITAS"], percent: 20 }, MENU);
    expect(r.validBrands).toEqual(["Avitas"]);
    expect(r.promotion?.targets).toHaveLength(1);
  });
});

describe("parseGuidedParams + guidedNewPromotionHref", () => {
  it("parses brands, percent and title", () => {
    const parsed = parseGuidedParams({ brands: "Avitas, Dama", percent: "20", title: "Sale" });
    expect(parsed?.brands).toEqual(["Avitas", "Dama"]);
    expect(parsed?.percent).toBe(20);
    expect(parsed?.titleOverride).toBe("Sale");
  });

  it("returns null when there is nothing to parse", () => {
    expect(parseGuidedParams({})).toBeNull();
  });

  it("builds a round-trippable href", () => {
    const href = guidedNewPromotionHref({ brands: ["Avitas", "Dama"], percent: 20 });
    expect(href).toContain("brands=Avitas%2CDama");
    expect(href).toContain("percent=20");
  });
});
