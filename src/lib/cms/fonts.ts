/**
 * src/lib/cms/fonts.ts
 *
 * The curated font library for the site. A non-technical editor picks a heading
 * font and a body font from this list in Admin → Site Content; the choice is
 * stored in two content blocks (site.font.heading / site.font.body) and applied
 * site-wide via CSS variables (--font-heading / --font-body).
 *
 * WHY A CURATED LIST (not "any font")?
 * Web pages can only use fonts the browser can fetch — they are NOT pulled from
 * the computer's installed fonts. So we ship a hand-picked set of high-quality,
 * license-clean Google Fonts (plus the safe system stack). Each is loaded with
 * next/font for performance (self-hosted, no layout shift, no external request).
 *
 * Adding a font later = add a next/font loader in fonts-loader.ts and a registry
 * entry here with the matching CSS variable.
 */

export type FontCategory = "sans" | "serif" | "display" | "mono";

export type FontOption = {
  /** Stable id stored in the content block (e.g. "poppins"). */
  id: string;
  /** Friendly name shown in the picker. */
  label: string;
  /** Short description of the vibe so staff can choose confidently. */
  note: string;
  category: FontCategory;
  /**
   * The CSS variable this font is bound to in the root layout (via next/font).
   * `null` for the system stack, which uses no webfont.
   */
  cssVar: string | null;
  /** The full CSS font-family value (variable + sensible fallbacks). */
  stack: string;
};

/** System stack — fast, no webfont, the safe default. */
const SYSTEM_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const FONT_OPTIONS: FontOption[] = [
  {
    id: "system",
    label: "System default",
    note: "Fast, clean, matches the visitor's device. No webfont.",
    category: "sans",
    cssVar: null,
    stack: SYSTEM_STACK,
  },
  {
    id: "inter",
    label: "Inter",
    note: "Modern, neutral, highly legible. Great all-rounder.",
    category: "sans",
    cssVar: "--gw-font-inter",
    stack: `var(--gw-font-inter), ${SYSTEM_STACK}`,
  },
  {
    id: "poppins",
    label: "Poppins",
    note: "Friendly geometric sans. Rounded and approachable.",
    category: "sans",
    cssVar: "--gw-font-poppins",
    stack: `var(--gw-font-poppins), ${SYSTEM_STACK}`,
  },
  {
    id: "montserrat",
    label: "Montserrat",
    note: "Strong, urban, great for bold headlines.",
    category: "sans",
    cssVar: "--gw-font-montserrat",
    stack: `var(--gw-font-montserrat), ${SYSTEM_STACK}`,
  },
  {
    id: "oswald",
    label: "Oswald",
    note: "Tall, condensed, punchy. Big poster-style headings.",
    category: "display",
    cssVar: "--gw-font-oswald",
    stack: `var(--gw-font-oswald), ${SYSTEM_STACK}`,
  },
  {
    id: "bebas",
    label: "Bebas Neue",
    note: "All-caps display. Loud, confident, banner energy.",
    category: "display",
    cssVar: "--gw-font-bebas",
    stack: `var(--gw-font-bebas), ${SYSTEM_STACK}`,
  },
  {
    id: "anton",
    label: "Anton",
    note: "Ultra-bold condensed display. Maximum impact headlines.",
    category: "display",
    cssVar: "--gw-font-anton",
    stack: `var(--gw-font-anton), ${SYSTEM_STACK}`,
  },
  {
    id: "playfair",
    label: "Playfair Display",
    note: "Elegant high-contrast serif. Upscale, editorial feel.",
    category: "serif",
    cssVar: "--gw-font-playfair",
    stack: `var(--gw-font-playfair), Georgia, serif`,
  },
  {
    id: "merriweather",
    label: "Merriweather",
    note: "Readable classic serif. Warm and trustworthy for body text.",
    category: "serif",
    cssVar: "--gw-font-merriweather",
    stack: `var(--gw-font-merriweather), Georgia, serif`,
  },
  {
    id: "roboto-slab",
    label: "Roboto Slab",
    note: "Slab serif. Sturdy and modern, good for headings or body.",
    category: "serif",
    cssVar: "--gw-font-roboto-slab",
    stack: `var(--gw-font-roboto-slab), Georgia, serif`,
  },
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    note: "Monospaced. Technical, receipt-like, distinctive.",
    category: "mono",
    cssVar: "--gw-font-jetbrains",
    stack: `var(--gw-font-jetbrains), ui-monospace, monospace`,
  },
];

const FONT_BY_ID = new Map(FONT_OPTIONS.map((f) => [f.id, f]));

/** Default choices when no block is set. */
export const DEFAULT_HEADING_FONT_ID = "system";
export const DEFAULT_BODY_FONT_ID = "system";

/** Resolve a font id (possibly null/unknown) to a font option, with fallback. */
export function resolveFont(
  id: string | null | undefined,
  fallbackId: string,
): FontOption {
  if (id && FONT_BY_ID.has(id)) return FONT_BY_ID.get(id)!;
  return FONT_BY_ID.get(fallbackId) ?? FONT_OPTIONS[0];
}

/** The CSS font-family stack for a stored font id (with fallback). */
export function fontStack(
  id: string | null | undefined,
  fallbackId: string,
): string {
  return resolveFont(id, fallbackId).stack;
}
