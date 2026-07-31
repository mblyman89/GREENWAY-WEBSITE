/**
 * SLICE 123 (LOY-1) — the Loyalty hero becomes a full, SPECIAL banner editor,
 * and the /admin/pages/loyalty twin is retired.
 *
 * Michael: make the Loyalty page all-inclusive under /admin/loyalty-page. The
 * hero banner should have the SAME editing features as every other banner —
 * image focus, all text alignments, editable text boxes, the Creative-Studio
 * helper + presets, AND the live real-time preview — PLUS extra "special"
 * powers: a cursive/script font option for the flourish line, on-brand color
 * options, and line-break stacking. Recreate the artwork via Flux (textless
 * background, no baked-in words). Default renders the new look (owner-approved
 * live-look change).
 *
 * Pins:
 *   - core (loyalty-hero-core): default is the NEW look (new art + overlay text
 *     recreating the classic headline), font/color/scale guards, line-break
 *     splitting, normalize/serialize/parse round-trip,
 *   - script fonts are wired into the real font system (fonts.ts + loader) and
 *     the shared ContentFontField gains the "script" category,
 *   - the public render uses a LoyaltyHeroBanner fed the resolved presentation,
 *   - the editor has image + mobile image + font/color pickers + align/focus +
 *     the live preview (the real banner) + save/publish/restore actions,
 *   - the seed registers loyalty.hero.presentation as richjson,
 *   - the /admin/pages/loyalty twin is retired (no PAGE_SECTION_CONFIG slug, FAQ
 *     re-pointed).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  LOYALTY_HERO_PRESENTATION_BLOCK,
  HERO_FONTS,
  HERO_COLORS,
  defaultLoyaltyHeroPresentation,
  normalizeLoyaltyHeroPresentation,
  serializeLoyaltyHeroPresentation,
  parseLoyaltyHeroPresentation,
  resolveLoyaltyHeroPresentation,
  heroFontStack,
  heroColorHex,
  isScriptHeroFont,
  isHeroFont,
  isHeroColor,
  clampScriptScale,
  heroTextLines,
} from "@/lib/loyalty/loyalty-hero-core";
import { FONT_OPTIONS } from "@/lib/cms/fonts";

const read = (p: string) => readFileSync(p, "utf8");

describe("loyalty-hero-core: the pure presentation model", () => {
  it("default recreates the classic look with the NEW textless art", () => {
    const def = defaultLoyaltyHeroPresentation();
    expect(def.image).toBe("/brand/greenway-loyalty-hero-2026-desktop.png");
    expect(def.imageMobile).toBe("/brand/greenway-loyalty-hero-2026-mobile.png");
    expect(def.imageFocus).toBe("left");
    expect(def.textAlign).toBe("right");
    expect(def.eyebrow.text).toBe("A Smoking Deal!");
    expect(def.title.text).toBe("Greenway\nLoyalty\nPoints");
    expect(def.subtitle.text).toBe("Earn Points With Every Purchase");
    expect(isScriptHeroFont(def.subtitle.font)).toBe(true);
  });

  it("offers display, sans, AND script fonts (the cursive option)", () => {
    const groups = new Set(HERO_FONTS.map((f) => f.group));
    expect(groups.has("display")).toBe(true);
    expect(groups.has("sans")).toBe(true);
    expect(groups.has("script")).toBe(true);
    // At least a couple of script choices as Michael requested.
    expect(HERO_FONTS.filter((f) => f.group === "script").length).toBeGreaterThanOrEqual(2);
  });

  it("offers on-brand colors (white, gold, greenway green)", () => {
    const byId = new Map(HERO_COLORS.map((c) => [c.id, c.hex]));
    expect(byId.get("white")).toBe("#ffffff");
    expect(byId.get("gold")).toBe("#ffd700");
    expect(byId.get("green")).toBe("#7ed957");
  });

  it("font/color guards + resolvers behave", () => {
    expect(isHeroFont("anton")).toBe(true);
    expect(isHeroFont("nope")).toBe(false);
    expect(isHeroColor("gold")).toBe(true);
    expect(isHeroColor("nope")).toBe(false);
    expect(heroFontStack("great-vibes")).toContain("--gw-font-great-vibes");
    expect(heroColorHex("gold")).toBe("#ffd700");
    expect(heroColorHex("nope")).toBe("#ffffff");
  });

  it("supports line-break stacking (Enter to stack lines)", () => {
    expect(heroTextLines("A\nB\nC")).toEqual(["A", "B", "C"]);
    expect(heroTextLines("\n\nHi\n\n")).toEqual(["Hi"]);
    expect(heroTextLines("")).toEqual([]);
  });

  it("script scale clamps 1..2", () => {
    expect(clampScriptScale(0)).toBe(1);
    expect(clampScriptScale(9)).toBe(2);
    expect(clampScriptScale(1.4)).toBe(1.4);
  });

  it("normalize/serialize/parse round-trips (keeps line breaks + style)", () => {
    const custom = normalizeLoyaltyHeroPresentation({
      textAlign: "left",
      title: { text: "One\nTwo", font: "bebas", color: "green", show: true, scriptScale: 1 },
      subtitle: { text: "Flow", font: "pacifico", color: "gold", show: false, scriptScale: 1.5 },
    });
    const round = parseLoyaltyHeroPresentation(serializeLoyaltyHeroPresentation(custom))!;
    expect(round.title.text).toBe("One\nTwo");
    expect(round.title.font).toBe("bebas");
    expect(round.subtitle.font).toBe("pacifico");
    expect(round.subtitle.scriptScale).toBe(1.5);
    expect(round.subtitle.show).toBe(false);
  });

  it("resolve(null) returns the default; bad JSON falls back", () => {
    expect(resolveLoyaltyHeroPresentation(null).image).toBe(
      defaultLoyaltyHeroPresentation().image,
    );
    expect(parseLoyaltyHeroPresentation("not json")).toBeNull();
  });
});

describe("script fonts are wired into the real font system", () => {
  it("fonts.ts registers the 3 script faces with a script category", () => {
    const ids = new Set(FONT_OPTIONS.map((f) => f.id));
    expect(ids.has("great-vibes")).toBe(true);
    expect(ids.has("dancing-script")).toBe(true);
    expect(ids.has("pacifico")).toBe(true);
    expect(FONT_OPTIONS.some((f) => f.category === "script")).toBe(true);
  });

  it("fonts-loader loads the script fonts and exposes their CSS vars", () => {
    const loader = read("src/lib/cms/fonts-loader.ts");
    expect(loader).toContain("Great_Vibes");
    expect(loader).toContain("Dancing_Script");
    expect(loader).toContain("Pacifico");
    expect(loader).toContain("--gw-font-great-vibes");
    expect(loader).toContain("--gw-font-dancing-script");
    expect(loader).toContain("--gw-font-pacifico");
    // All three must be spread onto <html> via fontVariablesClassName.
    expect(loader).toContain("greatVibes.variable");
    expect(loader).toContain("dancingScript.variable");
    expect(loader).toContain("pacifico.variable");
  });

  it("the shared font picker knows the script category", () => {
    const field = read("src/components/admin/ContentFontField.tsx");
    expect(field).toContain('"script"');
    expect(field).toMatch(/script:\s*"Script/);
  });
});

describe("the public /loyalty render uses the editable hero banner", () => {
  it("LoyaltyHeroBanner consumes the presentation (fonts/colors/lines/focus)", () => {
    const c = read("src/components/loyalty/LoyaltyHeroBanner.tsx");
    expect(c).toContain("heroFontStack");
    expect(c).toContain("heroColorHex");
    expect(c).toContain("heroTextLines");
    expect(c).toContain("LoyaltyHeroPresentation");
    // Renders both a mobile (3/1) and a wide desktop (3200/563) banner.
    expect(c).toContain("aspect-[3/1]");
    expect(c).toContain("aspect-[3200/563]");
  });

  it("the page resolves the presentation and feeds the signup form", () => {
    const page = read("src/app/loyalty/page.tsx");
    expect(page).toContain("LOYALTY_HERO_PRESENTATION_BLOCK");
    expect(page).toContain("resolveLoyaltyHeroPresentation");
    expect(page).toContain("heroPresentation={heroPresentation}");
  });

  it("the signup form renders the banner in place of baked images", () => {
    const form = read("src/components/loyalty/LoyaltySignupForm.tsx");
    expect(form).toContain("LoyaltyHeroBanner");
    expect(form).toContain("heroPresentation");
  });
});

describe("the Loyalty page editor owns the hero (all tools + live preview)", () => {
  it("the editor has image + mobile image, font & color pickers, align/focus", () => {
    const ed = read("src/components/admin/LoyaltyHeroEditor.tsx");
    // Image pickers (desktop + mobile) via ContentImageField w/ specs.
    expect(ed).toContain("ContentImageField");
    expect(ed).toContain("desktopSpec");
    expect(ed).toContain("mobileSpec");
    // Font + color pickers.
    expect(ed).toContain("HERO_FONTS");
    expect(ed).toContain("HERO_COLORS");
    // Alignment + focus (both desktop and mobile focus).
    expect(ed).toContain("TEXT_ALIGNS");
    expect(ed).toContain("TEXT_VALIGNS");
    expect(ed).toContain("IMAGE_FOCUSES");
    expect(ed).toContain('setField("imageFocusMobile"');
    // The cursive size control (script scale) is present.
    expect(ed).toContain("scriptScale");
  });

  it("the live preview renders the REAL public banner", () => {
    const ed = read("src/components/admin/LoyaltyHeroEditor.tsx");
    expect(ed).toContain("LoyaltyHeroBanner");
    expect(ed).toContain("presentation={pres}");
  });

  it("the admin page mounts the hero editor with specs + media + hero actions", () => {
    const page = read("src/app/admin/loyalty-page/page.tsx");
    expect(page).toContain("LoyaltyHeroEditor");
    expect(page).toContain('resolveImageSpec("loyalty.hero.image")');
    expect(page).toContain('resolveImageSpec("loyalty.hero.image_mobile")');
    expect(page).toContain("saveLoyaltyHeroDraftAction");
    expect(page).toContain("publishLoyaltyHeroAction");
    expect(page).toContain("restoreLoyaltyHeroRevisionAction");
    expect(page).toContain("mediaChoices");
  });

  it("the hero actions save/publish the richjson block and revalidate /loyalty", () => {
    const actions = read("src/app/admin/loyalty-page/actions.ts");
    expect(actions).toContain("saveLoyaltyHeroDraftAction");
    expect(actions).toContain("publishLoyaltyHeroAction");
    expect(actions).toContain("restoreLoyaltyHeroRevisionAction");
    expect(actions).toContain("isLoyaltyHeroBlock");
    expect(actions).toContain('revalidatePath("/loyalty")');
  });

  it("the presentation block is seeded as richjson", () => {
    const seed = read("src/lib/cms/content-blocks-seed.ts");
    expect(seed).toContain("LOYALTY_HERO_PRESENTATION_BLOCK");
    expect(seed).toContain("serializeLoyaltyHeroPresentation(defaultLoyaltyHeroPresentation())");
    // richjson => no migration (search from the seed ENTRY, not the import).
    const idx = seed.indexOf("block_key: LOYALTY_HERO_PRESENTATION_BLOCK");
    expect(idx).toBeGreaterThan(0);
    expect(seed.slice(idx, idx + 500)).toContain('field_type: "richjson"');
  });

  it("the core self-test is registered in the pure-selftest runner", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain("__runLoyaltyHeroCoreTests");
  });

  it("the block key constant is stable", () => {
    expect(LOYALTY_HERO_PRESENTATION_BLOCK).toBe("loyalty.hero.presentation");
  });
});

describe("the /admin/pages/loyalty twin is retired", () => {
  it("PAGE_SECTION_CONFIG no longer defines a loyalty slug", () => {
    const src = read("src/lib/cms/page-sections-types.ts");
    // Only the explanatory comment may mention loyalty, never a config key.
    expect(src).not.toContain('loyalty: { label: "Loyalty"');
  });

  it("the Help FAQ points at the dedicated /admin/loyalty-page editor", () => {
    const src = read("src/lib/admin/help-content.ts");
    expect(src).not.toContain('href: "/admin/pages/loyalty"');
  });

  it("the admin nav Loyalty link points at /admin/loyalty-page", () => {
    const nav = read("src/components/admin/admin-nav-data.ts");
    expect(nav).toContain('href: "/admin/loyalty-page"');
  });
});
