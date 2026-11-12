/**
 * D234 slice C-1 (SOP-11b, G-94 / G-95; F-11-19 / F-11-20): the studio
 * canvas uses the website's Heading/Body fonts and draws each text box with
 * the website's tag, and Checks warns when banner text is System default.
 * Owner (D234), verbatim: "I want to fix everything." … "Q-11-17: I approve and agree."
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { __runStudioFontsCoreTests, normalizeSiteFontIds, siteFontVars, SITE_FONT_KEYS } from "@/lib/cms/studio-fonts-core";
import { __runBannerDesignCoreTests, boxStyle, checkDesign, defaultDesign, DESIGN_ROLES, roleInfo } from "@/lib/cms/banner-design-core";
import { DEFAULT_BODY_FONT_ID, DEFAULT_HEADING_FONT_ID, fontStack } from "@/lib/cms/fonts";

const read = (p: string) => readFileSync(p, "utf8");
const L = { eyebrow: "New", title: "Hello there", subtitle: "Come in" };

describe("C-1: the studio reads the same font blocks as the website (G-94)", () => {
  it("same keys and the same fontStack call as the site layout", () => {
    const site = read("src/app/(site)/layout.tsx");
    for (const k of SITE_FONT_KEYS) expect(site).toContain(`"${k}"`);
    expect(site).toMatch(/fontStack\(\s*fonts\["site\.font\.heading"\],\s*DEFAULT_HEADING_FONT_ID/);
    const v = siteFontVars(normalizeSiteFontIds("oswald", "inter"));
    expect(v["--font-heading"]).toBe(fontStack("oswald", DEFAULT_HEADING_FONT_ID));
    expect(v["--font-body"]).toBe(fontStack("inter", DEFAULT_BODY_FONT_ID));
  });
  it("the studio segment layout loads them and provides them", () => {
    const l = read("src/components/admin/perf/StudioRulesLayout.tsx");
    expect(l).toContain("getContentValues([...SITE_FONT_KEYS])");
    expect(l).toContain("<StudioSiteFontsProvider fonts={fonts}>");
    expect(l).toContain("siteFontFaces(fonts)");
    for (const r of ["specials", "pages/[slug]", "settings/branding", "loyalty-page", "content/shop-banner"])
      expect(read(`src/app/admin/${r}/layout.tsx`)).toContain("StudioRulesLayout as default");
  });
  it("the canvas puts the font variables on its container", () => {
    const c = read("src/components/admin/banner-studio/StudioCanvas.tsx");
    expect(c).toContain("const fontVars = useStudioFontVars();");
    expect(c).toContain("...css(containerStyle(card)), ...fontVars");
  });
  it("pure self-tests pass", () => {
    expect(__runStudioFontsCoreTests().failed).toBe(0);
    expect(__runBannerDesignCoreTests().failed).toBe(0);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain("__runStudioFontsCoreTests");
  });
});

describe("C-1: the studio draws the website's tags (G-95)", () => {
  it("each role maps to the same tag the website uses", () => {
    const c = read("src/components/admin/banner-studio/StudioCanvas.tsx");
    expect(c).toContain("const Tag = roleInfo(b.role).html;");
    expect(c).toContain("<Tag\n                    key={b.id}\n                    role=\"button\"");
    expect(c).not.toMatch(/<div\n\s+key=\{b\.id\}\n\s+role="button"/);
    const site = read("src/components/site/DesignedBanner.tsx");
    expect(site).toContain("const info = roleInfo(b.role);");
    expect(roleInfo("headline").html).toBe("h2");
    expect(DESIGN_ROLES.every((r) => ["p", "h2", "span"].includes(r.html))).toBe(true);
  });
  it("box margins are reset, so a p/h2 tag adds no space", () => {
    for (const b of defaultDesign("hero").boxes) expect(boxStyle(b).margin).toBe("0");
  });
});

describe("C-1: System default warning", () => {
  it("existing behaviour unchanged without site fonts", () => {
    expect(checkDesign(defaultDesign("hero"), L).some((w) => w.code === "DEVICE_FONT")).toBe(false);
  });
  it("warns when the site fonts are System default; not with web fonts", () => {
    expect(checkDesign(defaultDesign("hero"), L, { heading: "system", body: "system" }).some((w) => w.code === "DEVICE_FONT")).toBe(true);
    expect(checkDesign(defaultDesign("hero"), L, { heading: "oswald", body: "inter" }).some((w) => w.code === "DEVICE_FONT")).toBe(false);
  });
  it("Checks tab and tab counter pass the site fonts", () => {
    // D234 C-4: checkAllWidths = checkDesign(design, legacy, siteFonts) + every-width checks.
    expect(read("src/components/admin/banner-studio/WarningsPanel.tsx")).toContain("checkAllWidths(design, legacy, siteFonts)");
    expect(read("src/components/admin/banner-studio/BannerStudio.tsx")).toContain("checkAllWidths(design, legacy, siteFonts).length");
    expect(read("src/lib/cms/studio-drift-core.ts")).toContain("checkDesign(design, legacy, siteFonts)");
  });
});
