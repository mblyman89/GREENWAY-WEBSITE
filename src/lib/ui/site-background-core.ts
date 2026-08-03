/**
 * SHARED SITE BACKGROUND — canonical textured gradient (SLICE T-313)
 * ---------------------------------------------------------------------------
 * Every customer-facing page used to control its own page background. Most of
 * the "good" pages (About, FAQ, Medical, Blog, Specials, Price-Match) painted a
 * near-identical textured radial gradient over black; a handful (Home, Shop,
 * Locations, Vendors) shipped a plain-black background instead, so the site
 * looked inconsistent as shoppers moved between pages.
 *
 * This module is the single source of truth for the shared background. It pins
 * the canonical gradient + texture class strings so no future edit can silently
 * drift one page's backdrop away from the rest. The <SiteBackground> component
 * (src/components/site/SiteBackground.tsx) renders these strings as a fixed,
 * behind-everything layer that every page mounts.
 *
 * The gradient is the About-page recipe — the one shipped page that already used
 * ALL THREE brand colors (orange, gold, greenway green) — so applying it site-
 * wide keeps the look Michael liked while making every page match.
 *
 * Pure + dependency-free so it can be unit-tested in isolation and imported by
 * both server components and the pure self-test harness.
 */

/** The three brand colors, byte-identical to globals.css :root. */
export const SITE_BG_ORANGE = "rgba(255,127,0,0.13)"; // --orange  #ff7f00
export const SITE_BG_GOLD = "rgba(255,215,0,0.11)"; //   --gold    #ffd700
export const SITE_BG_GREEN = "rgba(126,217,87,0.08)"; //  --greenway #7ed957

/**
 * The canonical radial-gradient stack, byte-identical to the About page overlay
 * (AboutContent.tsx). Three brand-color radials, each fading to transparent.
 * Written as a Tailwind arbitrary `bg-[...]` value (underscores = spaces).
 */
export const SITE_BG_GRADIENT_CLASS =
  "bg-[radial-gradient(circle_at_18%_10%,rgba(255,127,0,0.13),transparent_18rem)," +
  "radial-gradient(circle_at_88%_18%,rgba(255,215,0,0.11),transparent_22rem)," +
  "radial-gradient(circle_at_52%_88%,rgba(126,217,87,0.08),transparent_24rem)]";

/**
 * The full class string for the shared background LAYER. `fixed inset-0` pins it
 * to the viewport behind ALL page content (pages like Home / Shop render several
 * sibling sections, so a fixed layer covers them uniformly). `-z-10` keeps it
 * behind content; `pointer-events-none` makes it click-through; `bg-black` is the
 * base the brand radials sit on.
 */
export const SITE_BG_LAYER_CLASS =
  "pointer-events-none fixed inset-0 -z-10 bg-black " + SITE_BG_GRADIENT_CLASS;

/**
 * Self-tests. These PIN the exact emitted strings so no future edit can silently
 * change the shared background (which would re-introduce the very inconsistency
 * this slice removes).
 */
export function runSiteBackgroundSelfTests(): string[] {
  const failures: string[] = [];
  const check = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
  };

  // The gradient uses ALL THREE brand colors, in the About-page recipe order.
  check(
    SITE_BG_GRADIENT_CLASS.includes(SITE_BG_ORANGE),
    "site bg: includes the brand orange radial",
  );
  check(
    SITE_BG_GRADIENT_CLASS.includes(SITE_BG_GOLD),
    "site bg: includes the brand gold radial",
  );
  check(
    SITE_BG_GRADIENT_CLASS.includes(SITE_BG_GREEN),
    "site bg: includes the greenway green radial",
  );
  check(
    (SITE_BG_GRADIENT_CLASS.match(/radial-gradient/g) ?? []).length === 3,
    "site bg: exactly three radial gradients (one per brand color)",
  );

  // Byte-identical to the shipped About overlay so the site-wide look matches
  // the page Michael liked.
  check(
    SITE_BG_GRADIENT_CLASS ===
      "bg-[radial-gradient(circle_at_18%_10%,rgba(255,127,0,0.13),transparent_18rem)," +
        "radial-gradient(circle_at_88%_18%,rgba(255,215,0,0.11),transparent_22rem)," +
        "radial-gradient(circle_at_52%_88%,rgba(126,217,87,0.08),transparent_24rem)]",
    "site bg: gradient class is byte-identical to the About-page recipe",
  );

  // The layer is fixed, behind everything, click-through, over black.
  check(
    SITE_BG_LAYER_CLASS.startsWith("pointer-events-none fixed inset-0 -z-10 bg-black "),
    "site bg: layer is a fixed, click-through, behind-everything black base",
  );
  check(
    SITE_BG_LAYER_CLASS.endsWith(SITE_BG_GRADIENT_CLASS),
    "site bg: layer ends with the canonical gradient",
  );

  return failures;
}

/** Adapter for scripts/compliance/run-pure-selftests.ts (assertNoFailures). */
export function __runSiteBackgroundTests(): { passed: number; failed: number } {
  const failures = runSiteBackgroundSelfTests();
  return { passed: 0, failed: failures.length };
}
