/**
 * SLICE F1 — THE SHOP PAGE WAS SHOWING THE HOME PAGE'S SKELETON.
 *
 * THE DEFECT
 * ──────────
 * `src/app/loading.tsx` was the ONLY loading file in the entire app. Next.js
 * resolves `loading.js` by walking UP the segment tree from the requested
 * route, so a shopper opening `/menu` was served the ROOT skeleton — which is
 * shaped like the HOME page: a `film-strip` hero and a `md:grid-cols-3` row of
 * three promo cards. Nothing about it resembles a shop.
 *
 * This was not inferred. The raw first chunk off the wire was dumped and
 * matched byte-for-byte against `src/app/loading.tsx`.
 *
 * Measured on the live site (Node fetch, `Accept-Encoding: identity`, reading
 * the body chunk by chunk — `curl` buffers and misreports chunk timing):
 *
 *     476 ms  first byte — HOME PAGE skeleton painted   <- reported as FCP
 *    1678 ms  shop banner + filter skeleton arrive
 *    2808 ms  the real site <header> arrives
 *    2849 ms  first product card arrives                <- reported as LCP
 *    3027 ms  stream ends
 *
 * The framework's own documentation names this exact failure:
 *
 *   "A `loading.js` high in the tree … the entire page falls back to a
 *    full-page skeleton instead of streaming granularly."
 *   — nextjs.org/docs/app/getting-started/linking-and-navigating (Streaming)
 *
 * WHY THIS MODULE EXISTS (rather than hard-coding classes in the .tsx)
 * ───────────────────────────────────────────────────────────────────
 * A skeleton is only useful if its geometry MATCHES the real component. If the
 * placeholder is a different size than what replaces it, the page visibly jumps
 * — that is Cumulative Layout Shift, and it would trade one bad score for
 * another. So the measurements below are not decorative: each one is copied
 * from the real component and PINNED by `__runMenuSkeletonTests()`. If someone
 * later restyles the grid without updating the skeleton, the test fails.
 *
 * Every value below was read directly from source:
 *
 *   SHOP_GRID_SHELL   src/components/menu/InteractiveMenuBrowser.tsx:1365
 *   SHOP_CARD_GRID    same file, the product `<div className="grid gap-5 …">`
 *   CARD_MIN_HEIGHT   src/components/menu/ProductCardVisual.tsx:314
 *   CARD_IMAGE_HEIGHT src/components/menu/ProductCardVisual.tsx:337
 *   SIDEBAR_WIDTH     the `lg:grid-cols-[280px_1fr]` track in the shell
 *
 * HOW MANY PLACEHOLDER CARDS
 * ──────────────────────────
 * Only what can be seen matters. Painting 2,562 grey rectangles would recreate
 * the very problem being fixed. The grid is 4-up at `lg`, 2-up at `sm`, 1-up
 * below, so 8 cards fills roughly two rows on desktop and overflows the fold on
 * phones — enough that the screen looks full, cheap enough to be free.
 */

/** The outer grid of the real browser. Sidebar + content, identical tracks. */
export const SHOP_GRID_SHELL =
  "mx-auto grid max-w-[var(--shop-max)] gap-5 overflow-x-clip px-3 py-5 sm:px-4 md:px-8 md:py-8 lg:grid-cols-[280px_1fr] lg:gap-8";

/** The product card grid: 1-up, 2-up at sm, 4-up at lg. */
export const SHOP_CARD_GRID = "grid gap-5 sm:grid-cols-2 lg:grid-cols-4";

/** `min-h-[29.25rem]` on the real card root. */
export const CARD_MIN_HEIGHT = "min-h-[29.25rem]";

/**
 * The real card's image well is `h-[14.15rem]` with `md:h-[14.65rem]`. In the
 * source those two classes are NOT adjacent — other utilities sit between them:
 *
 *   className="relative h-[14.15rem] overflow-hidden bg-white p-0 shadow-[…] md:h-[14.65rem]"
 *   — src/components/menu/ProductCardVisual.tsx:337
 *
 * They are therefore kept as SEPARATE constants. A single combined string would
 * never match the real file, which would make the anti-drift assertion below
 * either fail permanently or have to be weakened into something that proves
 * nothing. Two exact constants keep the guard honest.
 */
export const CARD_IMAGE_HEIGHT_BASE = "h-[14.15rem]";
export const CARD_IMAGE_HEIGHT_MD = "md:h-[14.65rem]";

/** Convenience for the skeleton's own className. */
export const CARD_IMAGE_HEIGHT = `${CARD_IMAGE_HEIGHT_BASE} ${CARD_IMAGE_HEIGHT_MD}`;

/** The fixed sidebar track width at `lg`. */
export const SIDEBAR_WIDTH_REM = 280;

/** Placeholder cards to paint. Two full desktop rows. */
export const SKELETON_CARD_COUNT = 8;

/** Stable keys so React does not warn and the markup is deterministic. */
export function skeletonCardKeys(count: number = SKELETON_CARD_COUNT): string[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  return Array.from({ length: Math.floor(count) }, (_, index) => `skeleton-card-${index}`);
}

// ── Self-test ───────────────────────────────────────────────────────────────
/**
 * These assertions are the guard rail. They pin the skeleton's geometry to the
 * REAL component's geometry, so the placeholder cannot silently drift away from
 * what replaces it and start causing layout shift.
 */
export function __runMenuSkeletonTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[menu-skeleton] FAIL: ${label}`);
    }
  };

  // ── The shell must match InteractiveMenuBrowser's outer <section> ─────────
  // The two-column track is what positions the sidebar; if this drifts, the
  // filter rail jumps sideways when the real browser mounts.
  check("shell declares the 280px sidebar track", SHOP_GRID_SHELL.includes("lg:grid-cols-[280px_1fr]"));
  check("shell is width-capped to --shop-max", SHOP_GRID_SHELL.includes("max-w-[var(--shop-max)]"));
  check("shell is centered", SHOP_GRID_SHELL.includes("mx-auto"));
  check("shell keeps the desktop gap", SHOP_GRID_SHELL.includes("lg:gap-8"));

  // ── The card grid must match the real product grid exactly ───────────────
  // Same column counts at the same breakpoints = same number of rows = same
  // page height, so nothing reflows when real cards arrive.
  check("card grid is 2-up at sm", SHOP_CARD_GRID.includes("sm:grid-cols-2"));
  check("card grid is 4-up at lg", SHOP_CARD_GRID.includes("lg:grid-cols-4"));
  check("card grid gap matches the real grid", SHOP_CARD_GRID.includes("gap-5"));

  // ── Card metrics must match ProductCardVisual ────────────────────────────
  check("card min height matches the real card", CARD_MIN_HEIGHT === "min-h-[29.25rem]");
  check("card image base height matches the real card", CARD_IMAGE_HEIGHT_BASE === "h-[14.15rem]");
  check("card image md height matches the real card", CARD_IMAGE_HEIGHT_MD === "md:h-[14.65rem]");
  check(
    "the composed image height contains both breakpoints",
    CARD_IMAGE_HEIGHT.includes(CARD_IMAGE_HEIGHT_BASE) && CARD_IMAGE_HEIGHT.includes(CARD_IMAGE_HEIGHT_MD),
  );
  check("sidebar width matches the grid track", SIDEBAR_WIDTH_REM === 280);

  // ── The count is enough to fill a screen but cheap ───────────────────────
  check("enough cards to fill two desktop rows", SKELETON_CARD_COUNT >= 8);
  check("not so many that the skeleton is itself heavy", SKELETON_CARD_COUNT <= 12);

  // ── Key generation is deterministic and safe ─────────────────────────────
  const keys = skeletonCardKeys();
  check("produces the requested number of keys", keys.length === SKELETON_CARD_COUNT);
  check("keys are unique", new Set(keys).size === keys.length);
  check("keys are stable across calls", skeletonCardKeys()[0] === keys[0]);
  check("zero count yields no keys", skeletonCardKeys(0).length === 0);
  check("negative count yields no keys", skeletonCardKeys(-5).length === 0);
  check("non-finite count yields no keys", skeletonCardKeys(Number.NaN).length === 0);
  check("fractional count is floored", skeletonCardKeys(3.7).length === 3);

  return { passed, failed };
}
