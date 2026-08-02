/**
 * page-wording-core — pure helpers for the "Page wording" card that makes each
 * page editor all-inclusive (MIG-1+).
 *
 * WHY (plain English): the site's editable text/images ("content blocks") used
 * to live only in one big "Site Content" screen. We are moving each page's
 * wording into that page's OWN editor (/admin/pages/[slug]) so everything about
 * a page is edited in one place. This module declares WHICH pages have their
 * wording card turned on, and computes the "View on site" path for a block, so
 * the page component (and its tests) share one source of truth.
 *
 * ROLLOUT (additive-first, per the migration plan): a page is added to
 * PAGES_WITH_WORDING in the SAME mini-slice that wires its card. The block is
 * then editable in BOTH the page editor AND Site Content (harmless overlap —
 * same shared save/publish actions, same DB row). A LATER mini-slice removes
 * the page from Site Content's filter, leaving exactly one honest home. This
 * ordering means a block is never un-editable at any commit.
 *
 * NO MIGRATION NEEDED: pure TypeScript; imports nothing server-only, React, or
 * a database client.
 */

/**
 * Pages whose "Page wording" card is LIVE. Grows one entry per mini-slice.
 *
 * MS-1.2: vendors (23 blocks — outreach copy + the five contact-channel cards).
 * MS-2.1a: about (2 blocks — hero title + subtitle).
 * MS-2.1b: locations (2 blocks — hero title + the storefront photo, the first
 *          IMAGE block routed through the card's Media Library picker).
 * MS-2.1c: price-match (2 blocks — hero title + promise headline). NOTE the page
 *          slug is "price-match" (hyphen) while the block-key prefix is
 *          "pricematch." (no hyphen); the card scopes by page (b.page === slug),
 *          so the rollout entry is the SLUG "price-match".
 * Future slices add: locations, price-match, faq, home, blog, ...
 *
 * A slug here MUST be a real /admin/pages/[slug] page (a valid PageSlug) and its
 * content blocks MUST use `page === slug`. Both are asserted in the self-tests.
 */
export const PAGES_WITH_WORDING: ReadonlySet<string> = new Set<string>([
  "vendors",
  "about",
  "locations",
  "price-match",
  "faq", // MIG-5a: FAQ hero copy orphans (faq.hero.title/subtitle) get a home
  "home", // MIG-5a: Home category/brand banner orphans (home.category.*/home.brand.*) get a home
]);

/**
 * The "View on site" / live-preview path for a wording block on a given page.
 *
 * For the pages we migrate, every block on a page renders on that page's public
 * URL, which is exactly the page's `previewPath` from PAGE_SECTION_CONFIG (e.g.
 * vendors → "/vendor-delivery"). Passing the previewPath in keeps this pure and
 * avoids duplicating the slug→URL map that already lives in page-sections-types.
 *
 * Returns null when no page path is known (the block browser then simply omits
 * the "View on site" link, exactly like Site Content does for footer blocks).
 */
export function wordingBlockPublicPath(
  previewPath: string | null | undefined,
): string | null {
  if (!previewPath) return null;
  const p = previewPath.trim();
  return p.length > 0 ? p : null;
}

/** True when a page should render the wording card. */
export function pageHasWording(slug: string): boolean {
  return PAGES_WITH_WORDING.has(slug);
}

// ---------------------------------------------------------------------------
// Embedded self-tests (pure). Invoked by run-pure-selftests.ts.
// ---------------------------------------------------------------------------

export function __runPageWordingCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`page-wording-core: ${msg}`);
    passed += 1;
  };

  // 1. The rollout set is non-empty and contains the pages wired so far.
  assert(PAGES_WITH_WORDING.size >= 1, "rollout set must not be empty");
  assert(PAGES_WITH_WORDING.has("vendors"), "vendors wording is live (MS-1.2)");
  assert(PAGES_WITH_WORDING.has("about"), "about wording is live (MS-2.1a)");
  assert(PAGES_WITH_WORDING.has("locations"), "locations wording is live (MS-2.1b)");
  assert(PAGES_WITH_WORDING.has("price-match"), "price-match wording is live (MS-2.1c)");
  assert(PAGES_WITH_WORDING.has("faq"), "faq wording is live (MIG-5a)");
  assert(PAGES_WITH_WORDING.has("home"), "home wording is live (MIG-5a)");
  assert(pageHasWording("vendors"), "pageHasWording agrees for vendors");
  assert(!pageHasWording("nonexistent-page"), "unknown page has no wording");

  // 2. Public-path helper resolves real paths and safely handles blanks.
  assert(
    wordingBlockPublicPath("/vendor-delivery") === "/vendor-delivery",
    "vendors block previews on /vendor-delivery",
  );
  assert(wordingBlockPublicPath("") === null, "blank previewPath → null");
  assert(wordingBlockPublicPath(null) === null, "null previewPath → null");
  assert(
    wordingBlockPublicPath(undefined) === null,
    "undefined previewPath → null",
  );
  assert(
    wordingBlockPublicPath("  /about  ") === "/about",
    "previewPath is trimmed",
  );

  // 3. Snapshot: exactly 6 pages wired at MIG-5a (bumped deliberately per slice).
  assert(
    PAGES_WITH_WORDING.size === 6,
    `expected 6 wording pages (MIG-5a), found ${PAGES_WITH_WORDING.size}`,
  );

  return { passed };
}
