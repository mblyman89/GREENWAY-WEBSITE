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
  parseSpecialsPresentation,
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
    // align → text block + gradient direction
    expect(src).toContain("items-end text-right");
    expect(src).toContain("items-center text-center");
    expect(src).toContain("items-start text-left");
    expect(src).toContain("justify-start");
    expect(src).toContain("justify-end");
    // SLICE 117 bug fix: image position is built via a template literal
    // (`object-cover ${...}`) so the object-* classes live in the focus record
    // + the legacy fallback ternary rather than as one contiguous string. We
    // still guarantee the object-cover base + both legacy positions exist.
    expect(src).toContain("object-cover ");
    expect(src).toContain("object-right"); // legacy default (left-aligned text)
    expect(src).toContain("object-left"); // legacy right-aligned text
    // The independent image control (the actual fix) is present with a
    // byte-identical default when omitted.
    expect(src).toContain("imageFocus");
    expect(src).toContain("legacyObjectClass");
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
    // SLICE 117: the independent image-focus is threaded through too so moving
    // the banner text no longer drags the image behind it.
    expect(src).toContain("imageFocus={pres.todaysDealsBannerImageFocus}");
  });

  it("SLICE 117: Today's Deal image-focus is decoupled from text (bug fix)", () => {
    const daily = read("src/components/specials/SpecialsDailyDeals.tsx");
    // SpecialsDailyDeals accepts + forwards the independent image focus.
    expect(daily).toContain("imageFocus");
    expect(daily).toContain("imageFocus={imageFocus}");
    // The presentation carries an image-focus that defaults to "right" so the
    // live look is byte-identical (legacy: left text shoved the image right).
    const core = read("src/lib/specials/specials-presentation-core.ts");
    expect(core).toContain("todaysDealsBannerImageFocus");
    expect(core).toContain("isImageFocus");
    expect(core).toContain('todaysDealsBannerImageFocus: "right"');
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

  it("SLICE 121 (SET-2): banner tab has an image-focus control (moves image independently)", () => {
    const src = read("src/components/admin/SpecialsPresentationEditor.tsx");
    // Imports + friendly labels for the 5 focus options.
    expect(src).toContain("IMAGE_FOCUSES");
    expect(src).toContain("IMAGE_FOCUS_LABELS");
    // A button group that writes the already-threaded presentation field.
    expect(src).toContain('setGlobal("todaysDealsBannerImageFocus", f)');
    expect(src).toContain("IMAGE_FOCUSES.map");
    // A human-readable heading for the control.
    expect(src).toContain("Image focus");
  });

  it("SLICE 121 (SET-2): the editor's live BannerPreview honors image focus (not text-derived)", () => {
    const src = read("src/components/admin/SpecialsPresentationEditor.tsx");
    // Preview receives the focus and maps it with the SAME object-* classes as
    // the public SectionBanner, independent of textAlign.
    expect(src).toContain("imageFocus={pres.todaysDealsBannerImageFocus}");
    expect(src).toContain("PREVIEW_FOCUS_OBJECT_CLASS[imageFocus]");
    expect(src).toContain('center: "object-center"');
    expect(src).toContain('top: "object-top"');
    expect(src).toContain('bottom: "object-bottom"');
    expect(src).toContain('left: "object-left"');
    expect(src).toContain('right: "object-right"');
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

// ── SLICE 120 (SET-1): TOP hero honors text position + image focus ─────────
// The hero was a hardcoded block that ignored placement (text pinned left,
// vertically centered, image shoved right), so staff could edit the copy but
// not MOVE it. SET-1 adds three presentation fields (byte-identical defaults)
// and wires the hero render to consume them.
describe("SLICE 120 (SET-1): TOP hero placement in the presentation model", () => {
  it("adds heroBanner* fields with today's-look defaults (left/center/right)", () => {
    const def = defaultSpecialsPresentation();
    expect(def.heroBannerTextAlign).toBe("left");
    expect(def.heroBannerVerticalAlign).toBe("center");
    // "right" reproduces the old `content.imageFocus ?? "right"` behavior.
    expect(def.heroBannerImageFocus).toBe("right");
  });

  it("normalize applies valid hero placement + round-trips through serialize", () => {
    const norm = normalizeSpecialsPresentation({
      heroBannerTextAlign: "center",
      heroBannerVerticalAlign: "top",
      heroBannerImageFocus: "left",
    });
    expect(norm.heroBannerTextAlign).toBe("center");
    expect(norm.heroBannerVerticalAlign).toBe("top");
    expect(norm.heroBannerImageFocus).toBe("left");
    const back = parseSpecialsPresentation(serializeSpecialsPresentation(norm))!;
    expect(back.heroBannerTextAlign).toBe("center");
    expect(back.heroBannerVerticalAlign).toBe("top");
    expect(back.heroBannerImageFocus).toBe("left");
  });

  it("bad hero placement falls back to the live-look-safe default", () => {
    const bad = normalizeSpecialsPresentation({
      heroBannerTextAlign: "nope",
      heroBannerVerticalAlign: "nope",
      heroBannerImageFocus: "nope",
    });
    expect(bad.heroBannerTextAlign).toBe("left");
    expect(bad.heroBannerVerticalAlign).toBe("center");
    expect(bad.heroBannerImageFocus).toBe("right");
  });

  it("SpecialsContent hero consumes the presentation placement (not hardcoded)", () => {
    const src = read("src/components/specials/SpecialsContent.tsx");
    // Reads the three placement values from the presentation.
    expect(src).toContain("pres.heroBannerTextAlign");
    expect(src).toContain("pres.heroBannerVerticalAlign");
    expect(src).toContain("pres.heroBannerImageFocus");
    // Vertical + horizontal + text-align classes drive the layout.
    expect(src).toContain("heroJustifyClass");
    expect(src).toContain("heroColumnItemsClass");
    expect(src).toContain("heroTextItemsClass");
    // Image focus now flows from the presentation, no longer hardwired.
    expect(src).toContain("HERO_FOCUS_OBJECT_CLASS[heroImageFocus]");
    expect(src).not.toContain('HERO_FOCUS_OBJECT_CLASS[content.imageFocus ?? "right"]');
    // The default (left) case preserves TODAY's exact 100deg gradient.
    expect(src).toContain("linear-gradient(100deg,rgba(0,0,0,0.96)");
  });
});

// ── SLICE 122 (SET-3): finish the Specials editor — 3 tabs in page order, the
// hero IMAGE moved into Tab 1 (with placement + a live preview), and the unused
// /admin/pages/specials builder retired ─────────────────────────────────────
// Michael: "Let's finish off the specials page editor mortal combat style, make
// it epic!" The hero image upload moves out of the Pages builder into the ONE
// Specials editor's first tab (page order: Top hero → weekly cards → Today's
// Deal banner), each with a live preview, then the orphaned Pages-builder twin
// is retired so there is exactly ONE place to edit Specials. Live-look-safe:
// heroBannerImage defaults to "" and the public page falls back to the seeded
// content-copy image, so nothing changes until Michael edits + Publishes.
describe("SLICE 122 (SET-3): hero image lives in the presentation model", () => {
  it("adds heroBannerImage (default \"\", trimmed, round-trips)", () => {
    const def = defaultSpecialsPresentation();
    // Byte-identical default: blank => graceful fallback to content copy.
    expect(def.heroBannerImage).toBe("");

    const norm = normalizeSpecialsPresentation({
      heroBannerImage: "  /media/hero.webp  ",
    });
    expect(norm.heroBannerImage).toBe("/media/hero.webp");

    const back = parseSpecialsPresentation(serializeSpecialsPresentation(norm))!;
    expect(back.heroBannerImage).toBe("/media/hero.webp");
  });

  it("a non-string hero image falls back to the live-look-safe default", () => {
    const bad = normalizeSpecialsPresentation({
      heroBannerImage: 123 as unknown as string,
    });
    expect(bad.heroBannerImage).toBe("");
  });
});

describe("SLICE 122 (SET-3): public hero image = presentation first, then copy", () => {
  it("specials/page.tsx feeds the hero image with a graceful fallback", () => {
    const src = read("src/app/specials/page.tsx");
    // presentation wins when set; otherwise the seeded content-copy image; else
    // undefined. This keeps the live page byte-identical until Michael edits.
    expect(src).toContain(
      "presentation.heroBannerImage || hero?.image || undefined",
    );
  });
});

describe("SLICE 122 (SET-3): the ONE editor now has 3 tabs in page order", () => {
  const src = read("src/components/admin/SpecialsPresentationEditor.tsx");

  it("declares a three-key TabKey (hero, cards, banner) defaulting to hero", () => {
    expect(src).toContain('type TabKey = "hero" | "cards" | "banner"');
    // First tab is the TOP hero (matches the public page order).
    expect(src).toContain('useState<TabKey>("hero")');
  });

  it("the tab bar is in public-page order: Top hero → cards → banner", () => {
    const heroIdx = src.indexOf('key: "hero"');
    const cardsIdx = src.indexOf('key: "cards"');
    const bannerIdx = src.indexOf('key: "banner"');
    expect(heroIdx).toBeGreaterThan(-1);
    expect(cardsIdx).toBeGreaterThan(-1);
    expect(bannerIdx).toBeGreaterThan(-1);
    expect(heroIdx).toBeLessThan(cardsIdx);
    expect(cardsIdx).toBeLessThan(bannerIdx);
  });

  it("the hero tab has the moved hero image field + placement controls", () => {
    // Hero image now lives here (moved out of the Pages builder).
    expect(src).toContain('setGlobal("heroBannerImage"');
    // Text position + image focus controls write the SET-1 hero fields.
    expect(src).toContain('setGlobal("heroBannerTextAlign"');
    expect(src).toContain('setGlobal("heroBannerVerticalAlign"');
    expect(src).toContain('setGlobal("heroBannerImageFocus"');
  });

  it("has a live HeroPreview that honors focus (not text-derived)", () => {
    expect(src).toContain("HeroPreview");
    // The preview positions the image from the chosen focus, like the banner one.
    expect(src).toContain("PREVIEW_FOCUS_OBJECT_CLASS[imageFocus]");
  });

  it("no longer routes staff to the retired /admin/pages/specials builder", () => {
    expect(src).not.toContain("/admin/pages/specials");
  });

  it("the editor page passes the hero image spec", () => {
    const page = read("src/app/admin/specials/page.tsx");
    expect(page).toContain("SPECIALS_HERO_SPEC");
    expect(page).toContain("heroSpec={SPECIALS_HERO_SPEC}");
  });
});

describe("SLICE 122 (SET-3): the /admin/pages/specials twin is retired", () => {
  it("PAGE_SECTION_CONFIG no longer defines a specials slug", () => {
    const src = read("src/lib/cms/page-sections-types.ts");
    // The only remaining mention is the explanatory comment, never a config key.
    expect(src).not.toContain('specials: { label: "Specials"');
  });

  it("the Help FAQ points at the dedicated /admin/specials editor", () => {
    const src = read("src/lib/admin/help-content.ts");
    expect(src).toContain('href: "/admin/specials"');
    expect(src).not.toContain('href: "/admin/pages/specials"');
  });
});
