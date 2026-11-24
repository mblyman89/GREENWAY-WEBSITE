/**
 * src/lib/promotions/display-rules-cache-core.ts — USAGE-8d (2026-11-25)
 *
 * WHY: `loadPublishedRuleSnapshots()` (promotions + targets + exclusions +
 * configs + never-discount: 4–5 PostgREST reads) ran UNCACHED on every render
 * of the storefront layout, the home page and /specials — i.e. on every ISR
 * regeneration of every public page (1.6K time-based + 683 tag regenerations in
 * the 12 h baseline), on top of every page's own reads.
 *
 * WHAT: the three STOREFRONT DISPLAY callers read a cached copy keyed under
 * PUBLISHED_RULES_TAG with a 60 s floor. Freshness on edit is unchanged: every
 * promotion/specials/never-discount admin action already calls
 * `revalidatePath("/(site)", "layout")`, which makes data cached under that
 * layout stale on the next render, and the same actions now also clear the
 * tag by name.
 *
 * RULE 18 — CACHE THE DISPLAY, NEVER CACHE THE MONEY. The register, order
 * pricing, promo-guard and every admin page keep calling the UNCACHED
 * `loadPublishedRuleSnapshots()`; only the public pages import the cached
 * entry point (pinned by the compliance test). The client cart re-prices with
 * these rules for display; the order is re-priced server-side, uncached, at
 * checkout.
 */

export const PUBLISHED_RULES_TAG: string = "published-rules";
export const PUBLISHED_RULES_TTL_SECONDS = 60;

/** The only files allowed to import the cached (display) entry point. */
export const DISPLAY_RULES_CALLERS: readonly string[] = [
  "src/app/(site)/layout.tsx",
  "src/app/(site)/page.tsx",
  "src/app/(site)/specials/page.tsx",
];

/** Money paths that must keep the UNCACHED read. */
export const MONEY_RULES_CALLERS: readonly string[] = [
  "src/lib/pos/auto-discount.ts",
  "src/lib/promotions/promo-guard.ts",
];

export function __runDisplayRulesCacheTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`display-rules-cache-core FAIL: ${name}`);
    }
  };
  ok(PUBLISHED_RULES_TAG === "published-rules", "tag name");
  ok(PUBLISHED_RULES_TAG !== "live-menu", "not the menu tag (menu edits must not refetch rules)");
  ok(PUBLISHED_RULES_TTL_SECONDS === 60, "60 s floor (same as the page TTL)");
  ok(DISPLAY_RULES_CALLERS.length === 3, "three display callers");
  ok(DISPLAY_RULES_CALLERS.every((f) => f.startsWith("src/app/(site)/")), "display callers are public pages only");
  ok(!DISPLAY_RULES_CALLERS.some((f) => MONEY_RULES_CALLERS.includes(f)), "no money path is a display caller");
  ok(MONEY_RULES_CALLERS.every((f) => !f.startsWith("src/app/(site)/")), "money paths are server libs");
  if (failed > 0) throw new Error(`display-rules-cache-core: ${failed} failed`);
  return { passed, failed };
}
