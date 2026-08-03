/**
 * src/lib/ui/glow-card-core.ts
 *
 * The one shared "glowing side-lit card" recipe used across the site.
 *
 * This is the treatment first authored on the product cards
 * (src/components/menu/ProductCardVisual.tsx) and then ported to the vendor
 * cards (src/components/vendors/VendorDirectory.tsx): a near-black panel with
 * two colored radial glows bleeding in from the left & right edges, a subtle
 * vertical panel gradient, and a triple inset/drop shadow — plus three thin,
 * blurred "glow strips" (left vertical, right vertical, soft bottom line) that
 * give the card its premium edge-lit look.
 *
 * SLICE 117 (Polish P1a): extracted here VERBATIM so the Specials weekly-deal
 * cards can share the EXACT same look as the product + vendor cards (owner
 * request — "I want the specials cards to have the same level of beauty").
 * ProductCardVisual and VendorDirectory now import this module; the emitted
 * style strings are byte-identical to what they hand-rolled before, and the
 * self-tests below pin those exact strings so a future refactor can't drift
 * one card family away from the others.
 *
 * PURE + FRAMEWORK-FREE: no React, no DOM — just data + string builders, so it
 * runs in the pure self-test harness.
 */

import type { CSSProperties } from "react";

/**
 * The color inputs for one glowing card. `left`/`right` may differ (a "split
 * neon" card, e.g. a leaning-hybrid product) or match (a single-color card).
 * `panel` is the mid-stop of the vertical background gradient.
 */
export type GlowTone = {
  border: string;
  glowLeft: string;
  glowSoftLeft: string;
  glowRight: string;
  glowSoftRight: string;
  panel: string;
};

/**
 * The inline style for the card SHELL — border color, near-black base, the two
 * edge radial glows over a vertical panel gradient, and the triple shadow.
 *
 * EXACT: the returned `backgroundImage` and `boxShadow` strings are
 * byte-identical to the originals in ProductCardVisual.cardStyle and
 * VendorDirectory.glowCardStyle. Do not "tidy" the numbers — the self-tests
 * pin them.
 */
export function glowCardStyle(tone: GlowTone): CSSProperties {
  return {
    borderColor: tone.border,
    backgroundColor: "#101010",
    backgroundImage: `radial-gradient(ellipse 54% 72% at -9% 44%, ${tone.glowLeft} 0%, ${tone.glowSoftLeft} 28%, rgba(20,20,20,0) 61%), radial-gradient(ellipse 48% 68% at 108% 61%, ${tone.glowRight} 0%, ${tone.glowSoftRight} 26%, rgba(20,20,20,0) 59%), linear-gradient(180deg, rgba(18,18,18,0.94), ${tone.panel} 48%, rgba(10,10,10,0.98))`,
    boxShadow: `inset 18px 0 34px -31px ${tone.glowLeft}, inset -18px 0 34px -31px ${tone.glowRight}, 0 13px 28px rgba(0,0,0,0.38)`,
  };
}

/**
 * Tailwind class strings for the three "glow strips" overlaid on the card.
 * (Their background COLOR is set inline from the tone — see the components.)
 * EXACT copies of the classes used on the vendor card.
 */
export const GLOW_STRIP_LEFT_CLASS =
  "pointer-events-none absolute -left-px top-10 h-[42%] w-px opacity-90 blur-[1px]";
export const GLOW_STRIP_RIGHT_CLASS =
  "pointer-events-none absolute -right-px top-[31%] h-[46%] w-px opacity-90 blur-[1px]";
export const GLOW_STRIP_BOTTOM_CLASS =
  "pointer-events-none absolute inset-x-7 -bottom-px h-px opacity-70 blur-[1px]";

/**
 * An on-brand palette of glow tones for cards that have no intrinsic color
 * (vendors, specials weekday cards, etc.). Cycled by index so adjacent cards
 * differ. Byte-identical to the vendor-card palette so the two pages read as
 * one cohesive family.
 */
export const GLOW_TONES: GlowTone[] = [
  {
    // Greenway green.
    border: "#4f8f5a",
    glowLeft: "rgba(79,143,90,0.95)",
    glowSoftLeft: "rgba(126,184,127,0.34)",
    glowRight: "rgba(79,143,90,0.95)",
    glowSoftRight: "rgba(126,184,127,0.34)",
    panel: "rgba(15,28,18,0.76)",
  },
  {
    // Gold → orange (matches the brand accent buttons).
    border: "#b0863d",
    glowLeft: "rgba(217,150,39,0.92)",
    glowSoftLeft: "rgba(255,191,53,0.34)",
    glowRight: "rgba(217,117,39,0.92)",
    glowSoftRight: "rgba(255,151,53,0.34)",
    panel: "rgba(34,25,13,0.74)",
  },
  {
    // Amber → lime.
    border: "#8a9a4f",
    glowLeft: "rgba(190,170,70,0.92)",
    glowSoftLeft: "rgba(214,200,110,0.34)",
    glowRight: "rgba(126,151,95,0.95)",
    glowSoftRight: "rgba(160,184,127,0.34)",
    panel: "rgba(27,29,17,0.74)",
  },
  {
    // Deep emerald → teal (a cooler green so adjacent cards differ).
    border: "#3f8f7a",
    glowLeft: "rgba(63,143,122,0.95)",
    glowSoftLeft: "rgba(116,196,178,0.32)",
    glowRight: "rgba(84,153,120,0.92)",
    glowSoftRight: "rgba(126,196,160,0.32)",
    panel: "rgba(12,28,26,0.76)",
  },
];

/** Cycle the palette by index (safe for any non-negative integer). */
export function glowToneByIndex(index: number): GlowTone {
  const n = GLOW_TONES.length;
  const i = ((Math.trunc(index) % n) + n) % n;
  return GLOW_TONES[i];
}

/**
 * SLICE T-312: blog / newsletter card glow tones.
 *
 * Unlike vendor / specials cards (which cycle GLOW_TONES for variety), a blog
 * card has an INTRINSIC color: its category pill. So each category maps to a
 * fixed single-color glow tone whose color MATCHES that pill, giving the card
 * our signature edge-lit glow in its own type color:
 *
 *   PRODUCTS  -> greenway green  (pill: var(--greenway))
 *   DEALS     -> orange          (pill: var(--orange))
 *   CULTURE   -> indica blue     (pill stays WHITE; glow is our indica blue)
 *   NEWSLETTER-> gold / yellow   (pill: var(--gold))
 *
 * The green / orange / gold glow rgba values are byte-identical to the ones the
 * product + vendor cards already use for those hues (see GLOW_TONES and
 * ProductCardVisual cardTones), and the CULTURE blue is byte-identical to the
 * product card's `indica` glow (rgba(84,153,184,0.95) / rgba(116,184,214,0.34)),
 * so the whole site reads as one glowing family. The self-tests pin these exact
 * strings so a future edit can't drift one category away from the others.
 */
export type BlogGlowCategory = "PRODUCTS" | "DEALS" | "CULTURE" | "NEWSLETTER";

export const BLOG_CATEGORY_GLOW_TONES: Record<BlogGlowCategory, GlowTone> = {
  // Greenway green (matches the PRODUCTS pill).
  PRODUCTS: {
    border: "#4f8f5a",
    glowLeft: "rgba(79,143,90,0.95)",
    glowSoftLeft: "rgba(126,184,127,0.34)",
    glowRight: "rgba(79,143,90,0.95)",
    glowSoftRight: "rgba(126,184,127,0.34)",
    panel: "rgba(15,28,18,0.76)",
  },
  // Orange (matches the DEALS pill + the brand accent buttons).
  DEALS: {
    border: "#b46f34",
    glowLeft: "rgba(217,117,39,0.92)",
    glowSoftLeft: "rgba(255,151,53,0.34)",
    glowRight: "rgba(217,117,39,0.92)",
    glowSoftRight: "rgba(255,151,53,0.34)",
    panel: "rgba(42,25,13,0.72)",
  },
  // Indica blue (our indica glow) - the CULTURE pill stays WHITE.
  CULTURE: {
    border: "#5499b8",
    glowLeft: "rgba(84,153,184,0.95)",
    glowSoftLeft: "rgba(116,184,214,0.34)",
    glowRight: "rgba(84,153,184,0.95)",
    glowSoftRight: "rgba(116,184,214,0.34)",
    panel: "rgba(11,26,34,0.75)",
  },
  // Gold / yellow (matches the NEWSLETTER pill).
  NEWSLETTER: {
    border: "#b0863d",
    glowLeft: "rgba(217,180,39,0.92)",
    glowSoftLeft: "rgba(255,215,53,0.34)",
    glowRight: "rgba(217,180,39,0.92)",
    glowSoftRight: "rgba(255,215,53,0.34)",
    panel: "rgba(34,29,13,0.74)",
  },
};

/** The glow tone for a blog category (defaults to the CULTURE blue if a future
 *  category slips through un-mapped, so a card can never render un-glowed). */
export function blogCategoryGlowTone(category: string): GlowTone {
  return (
    BLOG_CATEGORY_GLOW_TONES[category as BlogGlowCategory] ??
    BLOG_CATEGORY_GLOW_TONES.CULTURE
  );
}

/**
 * Self-tests. These PIN the exact emitted style strings so no future edit can
 * silently drift one card family's glow away from the others.
 */
export function runGlowCardCoreSelfTests(): string[] {
  const failures: string[] = [];
  const check = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
  };

  const tone: GlowTone = {
    border: "#4f8f5a",
    glowLeft: "rgba(79,143,90,0.95)",
    glowSoftLeft: "rgba(126,184,127,0.34)",
    glowRight: "rgba(79,143,90,0.95)",
    glowSoftRight: "rgba(126,184,127,0.34)",
    panel: "rgba(15,28,18,0.76)",
  };
  const style = glowCardStyle(tone);

  check(style.borderColor === "#4f8f5a", "borderColor passes through tone.border");
  check(style.backgroundColor === "#101010", "backgroundColor is the near-black base");

  check(
    style.backgroundImage ===
      "radial-gradient(ellipse 54% 72% at -9% 44%, rgba(79,143,90,0.95) 0%, rgba(126,184,127,0.34) 28%, rgba(20,20,20,0) 61%), radial-gradient(ellipse 48% 68% at 108% 61%, rgba(79,143,90,0.95) 0%, rgba(126,184,127,0.34) 26%, rgba(20,20,20,0) 59%), linear-gradient(180deg, rgba(18,18,18,0.94), rgba(15,28,18,0.76) 48%, rgba(10,10,10,0.98))",
    "backgroundImage string is byte-identical to the shipped recipe",
  );

  check(
    style.boxShadow ===
      "inset 18px 0 34px -31px rgba(79,143,90,0.95), inset -18px 0 34px -31px rgba(79,143,90,0.95), 0 13px 28px rgba(0,0,0,0.38)",
    "boxShadow string is byte-identical to the shipped recipe",
  );

  // Split-tone (left != right) is honored on both sides.
  const split = glowCardStyle({
    border: "#000",
    glowLeft: "L",
    glowSoftLeft: "SL",
    glowRight: "R",
    glowSoftRight: "SR",
    panel: "P",
  });
  check(
    typeof split.backgroundImage === "string" &&
      split.backgroundImage.includes("at -9% 44%, L 0%, SL 28%") &&
      split.backgroundImage.includes("at 108% 61%, R 0%, SR 26%") &&
      split.backgroundImage.includes("rgba(18,18,18,0.94), P 48%"),
    "split tone: left/right/panel land in the right slots",
  );
  check(
    typeof split.boxShadow === "string" &&
      split.boxShadow === "inset 18px 0 34px -31px L, inset -18px 0 34px -31px R, 0 13px 28px rgba(0,0,0,0.38)",
    "split tone: boxShadow uses left then right",
  );

  // Strip classes are the exact vendor-card classes.
  check(
    GLOW_STRIP_LEFT_CLASS === "pointer-events-none absolute -left-px top-10 h-[42%] w-px opacity-90 blur-[1px]",
    "left strip class exact",
  );
  check(
    GLOW_STRIP_RIGHT_CLASS === "pointer-events-none absolute -right-px top-[31%] h-[46%] w-px opacity-90 blur-[1px]",
    "right strip class exact",
  );
  check(
    GLOW_STRIP_BOTTOM_CLASS === "pointer-events-none absolute inset-x-7 -bottom-px h-px opacity-70 blur-[1px]",
    "bottom strip class exact",
  );

  // Palette is 4 on-brand tones; cycling wraps.
  check(GLOW_TONES.length === 4, "palette has 4 tones");
  check(glowToneByIndex(0) === GLOW_TONES[0], "index 0 -> tone 0");
  check(glowToneByIndex(4) === GLOW_TONES[0], "index 4 wraps -> tone 0");
  check(glowToneByIndex(5) === GLOW_TONES[1], "index 5 wraps -> tone 1");
  check(glowToneByIndex(-1) === GLOW_TONES[3], "negative index wraps into range");

  // SLICE T-312: blog category glow tones are pinned + match their pill colors.
  check(
    Object.keys(BLOG_CATEGORY_GLOW_TONES).sort().join(",") ===
      "CULTURE,DEALS,NEWSLETTER,PRODUCTS",
    "blog glow: exactly the four categories are mapped",
  );
  check(
    BLOG_CATEGORY_GLOW_TONES.PRODUCTS.glowLeft === "rgba(79,143,90,0.95)" &&
      BLOG_CATEGORY_GLOW_TONES.PRODUCTS.glowLeft ===
        BLOG_CATEGORY_GLOW_TONES.PRODUCTS.glowRight,
    "blog glow: PRODUCTS is the greenway green (single color)",
  );
  check(
    BLOG_CATEGORY_GLOW_TONES.DEALS.glowLeft === "rgba(217,117,39,0.92)" &&
      BLOG_CATEGORY_GLOW_TONES.DEALS.glowLeft ===
        BLOG_CATEGORY_GLOW_TONES.DEALS.glowRight,
    "blog glow: DEALS is the brand orange (single color)",
  );
  check(
    BLOG_CATEGORY_GLOW_TONES.CULTURE.glowLeft === "rgba(84,153,184,0.95)" &&
      BLOG_CATEGORY_GLOW_TONES.CULTURE.glowSoftLeft === "rgba(116,184,214,0.34)",
    "blog glow: CULTURE is the indica blue (byte-identical to the product card indica glow)",
  );
  check(
    BLOG_CATEGORY_GLOW_TONES.NEWSLETTER.glowLeft === "rgba(217,180,39,0.92)" &&
      BLOG_CATEGORY_GLOW_TONES.NEWSLETTER.glowLeft ===
        BLOG_CATEGORY_GLOW_TONES.NEWSLETTER.glowRight,
    "blog glow: NEWSLETTER is the gold/yellow (single color)",
  );
  check(
    blogCategoryGlowTone("PRODUCTS") === BLOG_CATEGORY_GLOW_TONES.PRODUCTS &&
      blogCategoryGlowTone("CULTURE") === BLOG_CATEGORY_GLOW_TONES.CULTURE,
    "blog glow: accessor returns the mapped tone",
  );
  check(
    blogCategoryGlowTone("SOMETHING_NEW") === BLOG_CATEGORY_GLOW_TONES.CULTURE,
    "blog glow: unknown category falls back to a real tone (never un-glowed)",
  );

  return failures;
}

/** Adapter for scripts/compliance/run-pure-selftests.ts (assertNoFailures). */
export function __runGlowCardCoreTests(): { passed: number; failed: number } {
  const failures = runGlowCardCoreSelfTests();
  return { passed: 0, failed: failures.length };
}
