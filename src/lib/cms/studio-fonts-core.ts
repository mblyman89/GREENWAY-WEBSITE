/**
 * studio-fonts-core — D234 slice C-1 (SOP-11b, G-94 / F-11-19). Pure.
 *
 * The website binds the owner's Heading and Body fonts (Admin → Branding →
 * Fonts, blocks `site.font.heading` / `site.font.body`) to `--font-heading` /
 * `--font-body` on <html> (`src/app/(site)/layout.tsx`), and globals.css uses
 * them for body text and for h1–h6. The back office never set them, so a
 * banner box on "Site font" was drawn in Arial in the studio and in the site
 * font on the website: the lines wrapped differently and items looked moved.
 *
 * These helpers give the studio the SAME stacks the website computes (same
 * `fontStack` call, same defaults), the @font-face for an uploaded site font,
 * and the rule for the Checks warning "this text uses System default" (each
 * visitor's device picks that font, so it can never match the studio).
 */
import { DEFAULT_BODY_FONT_ID, DEFAULT_HEADING_FONT_ID, fontStack, resolveFont } from "./fonts";
import { customFontFaceCss, isCustomFontId } from "./custom-font-core";

export type SiteFontIds = { heading: string; body: string };

/** The two content blocks the website reads (same keys as the site layout). */
export const SITE_FONT_KEYS = ["site.font.heading", "site.font.body"] as const;

/** Blank / missing → the website's defaults (both "system"). */
export function normalizeSiteFontIds(heading: string | null | undefined, body: string | null | undefined): SiteFontIds {
  const h = (heading ?? "").trim();
  const b = (body ?? "").trim();
  return { heading: h || DEFAULT_HEADING_FONT_ID, body: b || DEFAULT_BODY_FONT_ID };
}

/**
 * CSS for the studio canvas: the same two variables the website sets on <html>,
 * plus the body font itself (the website's <html> rule is
 * `font-family: var(--font-body, …)`; inside the back office the canvas is the
 * only place that should take it).
 */
export function siteFontVars(ids: SiteFontIds): Record<string, string> {
  return {
    "--font-heading": fontStack(ids.heading, DEFAULT_HEADING_FONT_ID),
    "--font-body": fontStack(ids.body, DEFAULT_BODY_FONT_ID),
    fontFamily: "var(--font-body, Arial, Helvetica, sans-serif)",
  };
}

/** @font-face for an uploaded site font (same helper the site layout uses). */
export function siteFontFaces(ids: SiteFontIds): string {
  return customFontFaceCss([ids.heading, ids.body]);
}

/** True when the id ends up as the device's own font ("System default"). */
export function isDeviceFont(id: string, fallbackId = "system"): boolean {
  if (isCustomFontId(id)) return false;
  return resolveFont(id, fallbackId).id === "system";
}

/**
 * The font a text box really uses on the website. `boxFont` "site" means
 * "inherit": a heading tag (h1/h2) takes the Heading font, anything else the
 * Body font. Returns null when it inherits and the site fonts are unknown.
 */
export function effectiveBoxFont(boxFont: string, html: "p" | "h2" | "span", site: SiteFontIds | null | undefined): string | null {
  if (boxFont && boxFont !== "site") return boxFont;
  if (!site) return null;
  return html === "h2" ? site.heading : site.body;
}

export function __runStudioFontsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL studio-fonts-core: ${m}`);
    }
  };
  const def = normalizeSiteFontIds("", null);
  ok(def.heading === DEFAULT_HEADING_FONT_ID && def.body === DEFAULT_BODY_FONT_ID, "blank = website defaults");
  const v = siteFontVars({ heading: "oswald", body: "inter" });
  ok(v["--font-heading"] === fontStack("oswald", DEFAULT_HEADING_FONT_ID), "heading = the website's stack");
  ok(v["--font-body"] === fontStack("inter", DEFAULT_BODY_FONT_ID), "body = the website's stack");
  ok(v.fontFamily.startsWith("var(--font-body"), "canvas text takes the body font");
  ok(siteFontFaces({ heading: "custom:0123456789abcdef.woff2", body: "inter" }).includes("gwf-0123456789abcdef"), "uploaded site font gets its @font-face");
  ok(siteFontFaces(def) === "", "no uploaded font, no css");
  ok(isDeviceFont("system"), "system is the device font");
  ok(isDeviceFont("no-such-font"), "unknown falls back to system, like the website");
  ok(!isDeviceFont("oswald"), "a library font is not");
  ok(!isDeviceFont("custom:0123456789abcdef.woff2"), "an uploaded font is not");
  ok(effectiveBoxFont("site", "h2", { heading: "oswald", body: "inter" }) === "oswald", "headline inherits heading");
  ok(effectiveBoxFont("site", "p", { heading: "oswald", body: "inter" }) === "inter", "body inherits body");
  ok(effectiveBoxFont("site", "p", null) === null, "unknown site fonts");
  ok(effectiveBoxFont("bebas", "h2", null) === "bebas", "picked font wins");
  return { passed, failed };
}
