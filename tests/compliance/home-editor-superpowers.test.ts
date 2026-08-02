/**
 * SLICE 112 — Home page editor "superpowers" (Website → Pages → Home).
 *
 * Michael: give the Home page editor real control over how many product cards
 * show, and — since the home page is banner-heavy — make sure every banner has
 * the image helpers AND that Creative Studio can generate perfect replacement
 * art for the homepage placeholder images.
 *
 * What ships (ONE cohesive feature, LIVE-LOOK-SAFE — everything defaults to 16,
 * the count the homepage shipped with, until the owner picks otherwise):
 *   - a pure home-section-settings-core (card-count model stored in the
 *     existing page_sections.settings JSON — NO migration),
 *   - the "Today's Deal" highlights grid (<HomeDailyDeals>) + the "Shop by
 *     Brand" grid (<HomeBrands>) both take a `count` prop (no more hardcoded
 *     LIMIT = 16), wired from page.tsx,
 *   - the Home editor gains a "Home page display" card (daily-deal count → the
 *     locked home.settings config section) and a per-section "Grid — cards
 *     shown" control on the brand grid,
 *   - Creative Studio recognition for the homepage bands: the home.category/
 *     home.brand image SPECS + the website-category-band PLACEMENT already
 *     exist; this slice adds the missing Midjourney "home-band" PRESET so the
 *     owner can generate perfect textless art for /home/category-banner.webp
 *     and /home/brand-banner.webp.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  HOME_CARD_COUNTS,
  HOME_CARD_COUNT_DEFAULT,
  HOME_CARD_COUNT_OPTIONS,
  DAILY_DEALS_COUNT_KEY,
  BRAND_COUNT_KEY,
  clampHomeCardCount,
  readHomeCardCount,
  writeHomeCardCount,
} from "@/lib/cms/home-section-settings-core";
import { presetById, PRESETS } from "@/lib/marketing/midjourney-core";
import { placementById } from "@/lib/marketing/creative-placements-core";
import { resolveImageSpec } from "@/lib/cms/image-spec-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("home-section-settings-core — card-count model", () => {
  it("defaults are live-look-safe (16, six choices incl. 16)", () => {
    expect(HOME_CARD_COUNT_DEFAULT).toBe(16);
    expect(HOME_CARD_COUNTS.length).toBe(6);
    expect(HOME_CARD_COUNTS).toContain(16);
    expect(HOME_CARD_COUNT_OPTIONS.length).toBe(6);
    const opt16 = HOME_CARD_COUNT_OPTIONS.find((o) => o.value === 16);
    expect(opt16?.label).toContain("default");
  });

  it("clampHomeCardCount validates exact membership, else default", () => {
    expect(clampHomeCardCount(4)).toBe(4);
    expect(clampHomeCardCount(24)).toBe(24);
    expect(clampHomeCardCount("12")).toBe(12);
    expect(clampHomeCardCount(15)).toBe(HOME_CARD_COUNT_DEFAULT);
    expect(clampHomeCardCount(0)).toBe(HOME_CARD_COUNT_DEFAULT);
    expect(clampHomeCardCount(-8)).toBe(HOME_CARD_COUNT_DEFAULT);
    expect(clampHomeCardCount(1000)).toBe(HOME_CARD_COUNT_DEFAULT);
    expect(clampHomeCardCount(null)).toBe(HOME_CARD_COUNT_DEFAULT);
    expect(clampHomeCardCount(undefined)).toBe(HOME_CARD_COUNT_DEFAULT);
    expect(clampHomeCardCount("junk")).toBe(HOME_CARD_COUNT_DEFAULT);
    expect(clampHomeCardCount({})).toBe(HOME_CARD_COUNT_DEFAULT);
  });

  it("readHomeCardCount pulls a key from settings JSON with fallback", () => {
    expect(readHomeCardCount({ cardCount: 20 }, BRAND_COUNT_KEY)).toBe(20);
    expect(readHomeCardCount({ dailyDealsCount: "8" }, DAILY_DEALS_COUNT_KEY)).toBe(8);
    expect(readHomeCardCount(null, BRAND_COUNT_KEY)).toBe(HOME_CARD_COUNT_DEFAULT);
    expect(readHomeCardCount({ cardCount: 99 }, BRAND_COUNT_KEY)).toBe(
      HOME_CARD_COUNT_DEFAULT,
    );
    expect(readHomeCardCount({}, "missing")).toBe(HOME_CARD_COUNT_DEFAULT);
  });

  it("writeHomeCardCount merges without dropping sibling keys or mutating input", () => {
    const original = { lanes: "brand", titleClassName: "x" };
    const merged = writeHomeCardCount(original, BRAND_COUNT_KEY, 12);
    expect(merged.lanes).toBe("brand");
    expect(merged.titleClassName).toBe("x");
    expect(merged.cardCount).toBe(12);
    // input untouched (immutability)
    expect("cardCount" in original).toBe(false);
    // junk coerces to default
    expect(writeHomeCardCount({}, BRAND_COUNT_KEY, "bogus").cardCount).toBe(
      HOME_CARD_COUNT_DEFAULT,
    );
  });
});

describe("Creative Studio recognition for the homepage bands", () => {
  it("adds the Midjourney 'home-band' preset (wide 16:9, textless)", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(7);
    const p = presetById("home-band");
    expect(p).toBeTruthy();
    expect(p?.brief.aspectRatio).toBe("16:9");
    expect((p?.description ?? "").toLowerCase()).toContain("homepage");
  });

  it("keeps the website-category-band placement for the homepage bands", () => {
    const pl = placementById("website-category-band");
    expect(pl).toBeTruthy();
    expect(pl?.group).toBe("website");
  });

  it("home.category/home.brand image specs resolve to the exact wide band (1600 wide)", () => {
    expect(resolveImageSpec("home.category.image").presets[0].width).toBe(1600);
    expect(resolveImageSpec("home.brand.image").presets[0].width).toBe(1600);
  });
});

describe("render wiring — hardcoded LIMIT = 16 is gone; count is threaded", () => {
  it("HomeDailyDeals takes a count prop and has no 'const LIMIT = 16'", () => {
    const src = read("src/components/home/HomeDailyDeals.tsx");
    expect(src).not.toContain("const LIMIT = 16");
    expect(src).toContain("count = HOME_CARD_COUNT_DEFAULT");
    expect(src).toContain("const LIMIT = count");
    // useMemo deps include the derived LIMIT (no eslint exhaustive-deps warning)
    expect(src).toContain("[pool, shuffle, LIMIT]");
  });

  it("HomeBrands takes a count prop and has no 'const LIMIT = 16'", () => {
    const src = read("src/components/home/HomeBrands.tsx");
    expect(src).not.toContain("const LIMIT = 16");
    expect(src).toContain("count = HOME_CARD_COUNT_DEFAULT");
    // PR 2: HomeBrands now shuffles/limits VENDOR entries (not free-text brands)
    // but still honours the owner count prop via the same shuffle-memo pattern.
    expect(src).toContain("[vendors, shuffle, LIMIT]");
  });

  it("PromoGrid forwards brandCount to HomeBrands", () => {
    const src = read("src/components/home/PromoGrid.tsx");
    expect(src).toContain("brandCount");
    expect(src).toContain("count={brandCount}");
  });

  it("page.tsx resolves both counts from page_sections.settings and threads them", () => {
    const src = read("src/app/page.tsx");
    expect(src).toContain("readHomeCardCount");
    expect(src).toContain('sections.find((s) => s.key === "home.settings")');
    expect(src).toContain("count={dailyDealsCount}");
    expect(src).toContain("brandCount={brandCount}");
  });
});

describe("editor superpowers — home settings config + brand grid control", () => {
  it("seeds a LOCKED, non-visible home.settings config section (dailyDealsCount 16)", () => {
    const src = read("src/lib/cms/page-sections-seed.ts");
    expect(src).toContain('section_key: "home.settings"');
    expect(src).toContain("locked: true");
    expect(src).toContain("dailyDealsCount: 16");
  });

  it("home cap is 5 so the config row doesn't steal a visible banner slot", () => {
    const src = read("src/lib/cms/page-sections-types.ts");
    expect(src).toMatch(/home:\s*\{[^}]*cap:\s*5/);
  });

  it("SectionCard exposes a brand-grid 'cards shown' control + threads settings_json", () => {
    const src = read("src/components/admin/SectionCard.tsx");
    expect(src).toContain('d.settings.lanes === "brand"');
    expect(src).toContain('name="settings_json"');
    expect(src).toContain("Grid — cards shown");
    // uses the per-section image spec (exact band size in the Canva helper)
    expect(src).toContain("resolveImageSpec");
    expect(src).toContain("spec={imageSpec}");
  });

  it("saveSectionAction merges settings_json without dropping sibling keys", () => {
    const src = read("src/app/admin/pages/[slug]/actions.ts");
    expect(src).toContain("parseSettings");
    expect(src).toContain("input.settings = settings");
    expect(src).toContain("saveHomeSettingsAction");
  });

  it("the store saveHomeSettings shallow-merges + publishes the config row", () => {
    const src = read("src/lib/cms/page-sections-store.ts");
    expect(src).toContain("export async function saveHomeSettings");
    expect(src).toContain("...(row.settings ?? {}), ...patch");
    expect(src).toContain("ensureSectionsSeeded");
  });

  it("the Home editor renders a 'Home page display' card and hides the config row", () => {
    const page = read("src/app/admin/pages/[slug]/page.tsx");
    expect(page).toContain("HomeDisplaySettingsCard");
    expect(page).toContain('s.section_key !== "home.settings"');
    const card = read("src/components/admin/HomeDisplaySettingsCard.tsx");
    expect(card).toContain("Home page display");
    expect(card).toContain("daily_deals_count");
  });
});
