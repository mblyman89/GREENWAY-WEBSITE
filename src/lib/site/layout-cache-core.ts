/**
 * src/lib/site/layout-cache-core.ts — USAGE-7b (owner: Michael, 2026-11-24)
 *
 * THE SHARED SITE LAYOUT MUST NOT CARRY THE `live-menu` TAG.
 *
 * WHY (measured, AGENTS.md rule 18)
 * ─────────────────────────────────
 * Next.js propagates every `unstable_cache` tag a render reads into the page's
 * ISR entry. `src/app/(site)/layout.tsx` wraps EVERY public page, and it read
 * `menuCardRotationLists()`, whose snapshot was tagged MENU_CACHE_TAG
 * (`live-menu`). So every `revalidatePublicMenuSurfaces()` call (≈49 admin
 * write paths: inventory, imports, photos, tags, recalls, promotions …) marked
 * EVERY public page stale — /about, /faq, /privacy-policy, /terms-of-use,
 * /locations, /price-match — not only the menu surfaces it names. The build
 * route table shows those content pages on a 1 h clock, yet the ISR report for
 * the 12 h before this slice showed /about rewritten 131 times (≈11/h): the
 * clock was not the cause, the menu tag was. Each of those rewrites is a billed
 * ISR write of the full page (8 KB units).
 *
 * THE FIX
 * ───────
 * The menu-card fallback snapshot (owner-chosen pictures per website category,
 * edited ONLY on /admin/menu-card-fallbacks) gets its OWN tag,
 * MENU_CARD_FALLBACK_TAG, cleared by that admin page's actions and nothing
 * else. It is deliberately NOT cleared by `revalidatePublicMenuSurfaces()` —
 * doing so would re-couple every menu edit to every page, which is the bug.
 * Its TTL is a backstop for a media URL changing underneath it (rare), so it
 * can be long.
 *
 * NEVER MONEY: these pictures are display data only. Prices, stock and deals
 * do not flow through this tag.
 *
 * PURE: constants + a guard, provable in tests.
 */

/** The menu-card fallback snapshot's own data-cache tag (not `live-menu`). */
export const MENU_CARD_FALLBACK_TAG: string = "menu-card-fallbacks";

/**
 * Backstop TTL for the fallback snapshot. Saves clear the tag immediately, so
 * this only bounds a change made outside the admin page (none exist today).
 */
export const MENU_CARD_FALLBACK_TTL_SECONDS = 3600;

/** The catalog tag the shared layout must never read (mirrors MENU_CACHE_TAG). */
export const LAYOUT_FORBIDDEN_TAG: string = "live-menu";

/**
 * True when a set of tags is safe for a cache read by the shared site layout:
 * it must not contain the catalog tag, and must not be empty (an untagged read
 * cannot be cleared on save and would wait out its TTL).
 */
export function layoutTagsAreIsolated(tags: readonly string[]): boolean {
  return tags.length > 0 && !tags.includes(LAYOUT_FORBIDDEN_TAG);
}

export function __runLayoutCacheTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[layout-cache] FAIL: ${label}`);
    }
  };

  check("fallback tag is not the catalog tag", MENU_CARD_FALLBACK_TAG !== LAYOUT_FORBIDDEN_TAG);
  check("fallback tag is a non-empty slug", /^[a-z][a-z0-9-]+$/.test(MENU_CARD_FALLBACK_TAG));
  check("fallback tag is within Next's 256-char tag limit", MENU_CARD_FALLBACK_TAG.length <= 256);
  check("forbidden tag mirrors live-menu", LAYOUT_FORBIDDEN_TAG === "live-menu");
  check("TTL is an integer", Number.isInteger(MENU_CARD_FALLBACK_TTL_SECONDS));
  check("TTL is longer than the 60 s menu clock", MENU_CARD_FALLBACK_TTL_SECONDS > 60);
  check("TTL is at most a day (backstop, not forever)", MENU_CARD_FALLBACK_TTL_SECONDS <= 86_400);

  check("own tag is isolated", layoutTagsAreIsolated([MENU_CARD_FALLBACK_TAG]));
  check("live-menu alone is not isolated", !layoutTagsAreIsolated(["live-menu"]));
  check("live-menu mixed in is not isolated", !layoutTagsAreIsolated([MENU_CARD_FALLBACK_TAG, "live-menu"]));
  check("no tags is not isolated (cannot be cleared on save)", !layoutTagsAreIsolated([]));
  check("public-content is isolated", layoutTagsAreIsolated(["public-content"]));
  check("store hours tag is isolated", layoutTagsAreIsolated(["google-store-hours"]));
  check("case matters (Next tags are exact)", layoutTagsAreIsolated(["Live-Menu"]));

  return { passed, failed };
}
