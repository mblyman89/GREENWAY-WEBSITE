/**
 * SLICE 111 — Big Specials editor upgrade (Website → Specials).
 *
 * Michael: build ALL specials editing into the ONE Specials editor page, kept
 * clean with a TAB SYSTEM (weekly cards vs. Today's Deal banner & products).
 * Give the "Today's Deal" wide banner the SAME image helpers every other slot
 * gets (paste URL OR Media-Library pick + Canva size helper), a live-products
 * COUNT control next to the show/hide toggle, and text-alignment options
 * (left/center/right + top/center/bottom) so the banner title/subtitle always
 * sit nicely over whatever image is chosen — while leaving the banner's text
 * (title/subtitle come from Promotions) and all discount math untouched. Add a
 * "Specials banner" preset to Creative Studio + a "Specials — Today's Deal
 * banner" destination. Dark-theme the editor inputs. Everything is
 * LIVE-LOOK-SAFE: defaults reproduce today's look until edited.
 *
 * Pins:
 *   - core: the 4 new presentation fields (default 16/left/center/""), count
 *     clamp 1..24, align/valign guards, round-trip, and that the default is
 *     still byte-identical to the pre-existing default,
 *   - SectionBanner gains textAlign + verticalAlign props mapped to
 *     justify/items/text-align + gradient + image object-position,
 *   - SpecialsDailyDeals consumes count + bannerImage + align props (default =
 *     today's exact look: 16 items, /home/hero-banner.webp, left),
 *   - SpecialsContent threads pres.todaysDeals* down to SpecialsDailyDeals,
 *   - the editor is tabbed, uses ContentImageField for the banner, has the
 *     count + align controls, and has NO leftover white (bg-white) inputs,
 *   - the editor page loads mediaChoices + passes SPECIALS_BANNER_SPEC,
 *   - image-spec-core exposes SPECIALS_BANNER_SPEC (wide), the placement
 *     "website-specials-banner" exists + tracks the spec, and the midjourney
 *     "specials-banner" preset exists.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  TEXT_ALIGNS,
  TEXT_VALIGNS,
  TODAYS_DEALS_COUNT_DEFAULT,
  TODAYS_DEALS_COUNT_MIN,
  TODAYS_DEALS_COUNT_MAX,
  clampTodaysDealsCount,
  isTextAlign,
  isTextVAlign,
  defaultSpecialsPresentation,
  normalizeSpecialsPresentation,
  serializeSpecialsPresentation,
} from "@/lib/specials/specials-presentation-core";
import { SPECIALS_BANNER_SPEC } from "@/lib/cms/image-spec-core";
import {
  placementById,
} from "@/lib/marketing/creative-placements-core";
import { presetById, PRESETS } from "@/lib/marketing/midjourney-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("specials-presentation-core — new banner/count/align fields", () => {
  it("defaults are live-look-safe (16 items, no override image, left/center)", () => {
    const def = defaultSpecialsPresentation();
    expect(def.todaysDealsCount).toBe(16);
    expect(def.todaysDealsBannerImage).toBe("");
    expect(def.todaysDealsBannerTextAlign).toBe("left");
    expect(def.todaysDealsBannerVerticalAlign).toBe("center");
  });

  it("count constants + clamp behave (1..24, default 16)", () => {
    expect(TODAYS_DEALS_COUNT_DEFAULT).toBe(16);
    expect(TODAYS_DEALS_COUNT_MIN).toBe(1);
    expect(TODAYS_DEALS_COUNT_MAX).toBe(24);
    expect(clampTodaysDealsCount(0)).toBe(1);
    expect(clampTodaysDealsCount(99)).toBe(24);
    expect(clampTodaysDealsCount(8)).toBe(8);
    expect(clampTodaysDealsCount(8.9)).toBe(8);
    expect(clampTodaysDealsCount("12")).toBe(12);
    expect(clampTodaysDealsCount("abc")).toBe(16);
    expect(clampTodaysDealsCount(undefined)).toBe(16);
  });

  it("align/valign guards accept valid, reject invalid", () => {
    expect([...TEXT_ALIGNS]).toEqual(["left", "center", "right"]);
    expect([...TEXT_VALIGNS]).toEqual(["top", "center", "bottom"]);
    expect(isTextAlign("left") && isTextAlign("center") && isTextAlign("right")).toBe(true);
    expect(isTextAlign("justify")).toBe(false);
    expect(isTextVAlign("top") && isTextVAlign("center") && isTextVAlign("bottom")).toBe(true);
    expect(isTextVAlign("middle")).toBe(false);
  });

  it("normalize coerces the new fields; round-trips through serialize", () => {
    const norm = normalizeSpecialsPresentation({
      todaysDealsBannerImage: "  /media/deal.webp  ",
      todaysDealsBannerTextAlign: "right",
      todaysDealsBannerVerticalAlign: "bottom",
      todaysDealsCount: 40,
    });
    expect(norm.todaysDealsBannerImage).toBe("/media/deal.webp");
    expect(norm.todaysDealsBannerTextAlign).toBe("right");
    expect(norm.todaysDealsBannerVerticalAlign).toBe("bottom");
    expect(norm.todaysDealsCount).toBe(24); // clamped
    const json = serializeSpecialsPresentation(norm);
    const back = normalizeSpecialsPresentation(JSON.parse(json));
    expect(back.todaysDealsBannerImage).toBe("/media/deal.webp");
    expect(back.todaysDealsBannerTextAlign).toBe("right");
    expect(back.todaysDealsBannerVerticalAlign).toBe("bottom");
    expect(back.todaysDealsCount).toBe(24);
  });

  it("bad align/valign/count fall back to defaults (never breaks the page)", () => {
    const bad = normalizeSpecialsPresentation({
      todaysDealsBannerTextAlign: "nope",
      todaysDealsBannerVerticalAlign: "nope",
      todaysDealsCount: NaN,
    });
    expect(bad.todaysDealsBannerTextAlign).toBe("left");
    expect(bad.todaysDealsBannerVerticalAlign).toBe("center");
    expect(bad.todaysDealsCount).toBe(16);
  });
});

describe("SectionBanner gains alignment props (legible over any image)", () => {
  it("exposes textAlign + verticalAlign props defaulting to today's look", () => {
    const src = read("src/components/home/SectionBanner.tsx");
    expect(src).toContain("textAlign = \"left\"");
    expect(src).toContain("verticalAlign = \"center\"");
    expect(src).toContain('textAlign?: "left" | "center" | "right"');
    expect(src).toContain('verticalAlign?: "top" | "center" | "bottom"');
    // align → text block + image position + gradient direction
    expect(src).toContain("items-end text-right");
    expect(src).toContain("items-center text-center");
    expect(src).toContain("items-start text-left");
    expect(src).toContain("object-cover object-right"); // default (left align)
    expect(src).toContain("object-cover object-left");
    expect(src).toContain("justify-start");
    expect(src).toContain("justify-end");
  });
});

describe("public render threads the new presentation fields (default = today)", () => {
  it("SpecialsDailyDeals consumes count + bannerImage + align, with safe defaults", () => {
    const src = read("src/components/specials/SpecialsDailyDeals.tsx");
    expect(src).toContain("DEFAULT_LIMIT = 16");
    expect(src).toContain('DEFAULT_BANNER_IMAGE = "/home/hero-banner.webp"');
    expect(src).toContain("bannerImage");
    expect(src).toContain("count");
    expect(src).toContain("bannerSrc");
    expect(src).toContain("imageSrc={bannerSrc}");
    expect(src).toContain("textAlign={textAlign}");
    expect(src).toContain("verticalAlign={verticalAlign}");
  });

  it("SpecialsContent passes pres.todaysDeals* down to SpecialsDailyDeals", () => {
    const src = read("src/components/specials/SpecialsContent.tsx");
    expect(src).toContain("bannerImage={pres.todaysDealsBannerImage}");
    expect(src).toContain("count={pres.todaysDealsCount}");
    expect(src).toContain("textAlign={pres.todaysDealsBannerTextAlign}");
    expect(src).toContain("verticalAlign={pres.todaysDealsBannerVerticalAlign}");
  });
});

describe("the ONE editor is tabbed, uses the image helper, and is dark-themed", () => {
  it("has a tab system (weekly cards vs. Today's Deal banner & products)", () => {
    const src = read("src/components/admin/SpecialsPresentationEditor.tsx");
    expect(src).toContain("setTab");
    expect(src).toContain("Weekly deal cards");
    expect(src).toContain("Today's Deal banner & products");
  });

  it("uses ContentImageField for the banner + count + alignment controls", () => {
    const src = read("src/components/admin/SpecialsPresentationEditor.tsx");
    expect(src).toContain("ContentImageField");
    expect(src).toContain("todaysDealsBannerImage");
    expect(src).toContain("todaysDealsCount");
    expect(src).toContain("clampTodaysDealsCount");
    expect(src).toContain("todaysDealsBannerTextAlign");
    expect(src).toContain("todaysDealsBannerVerticalAlign");
    // Creative Studio nudge with the new preset/destination
    expect(src).toContain("Specials banner");
  });

  it("has NO leftover white inputs (dark-themed) and no light hover fallback", () => {
    const src = read("src/components/admin/SpecialsPresentationEditor.tsx");
    // No text/select input should be bg-white (the only text-black left is the
    // legit bold offer-badge chip on an orange fill).
    expect(src).not.toContain("bg-white");
    expect(src).not.toContain("admin-surface-2,#f3f4f6");
    expect(src).toContain("bg-[var(--admin-surface-2)]");
  });

  it("editor page loads media choices + passes the banner spec", () => {
    const src = read("src/app/admin/specials/page.tsx");
    expect(src).toContain("listMedia");
    expect(src).toContain("mediaChoices");
    expect(src).toContain("SPECIALS_BANNER_SPEC");
    expect(src).toContain("spec={SPECIALS_BANNER_SPEC}");
    // themed (no light red error banner)
    expect(src).not.toContain("bg-red-50");
  });
});

describe("Creative Studio: specials banner spec + placement + preset", () => {
  it("SPECIALS_BANNER_SPEC is a wide banner (WIDE_BANNER family, 1600×560)", () => {
    expect(SPECIALS_BANNER_SPEC.id).toBe("specials-todays-deal-banner");
    expect(SPECIALS_BANNER_SPEC.aspectRatio).toBeGreaterThan(2);
    expect(SPECIALS_BANNER_SPEC.presets[0].width).toBe(1600);
    expect(SPECIALS_BANNER_SPEC.presets[0].height).toBe(560);
  });

  it('placement "website-specials-banner" exists and tracks the spec dims', () => {
    const p = placementById("website-specials-banner");
    expect(p).toBeTruthy();
    expect(p!.group).toBe("website");
    expect(p!.width).toBe(SPECIALS_BANNER_SPEC.presets[0].width);
    expect(p!.height).toBe(SPECIALS_BANNER_SPEC.presets[0].height);
  });

  it('midjourney preset "specials-banner" exists', () => {
    expect(presetById("specials-banner")).toBeTruthy();
    expect(PRESETS.length).toBeGreaterThanOrEqual(6);
  });
});
