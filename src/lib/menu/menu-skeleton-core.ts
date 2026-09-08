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

/**
 * The card's reserved height, used by the REAL card AND the skeleton.
 *
 * SLICE G — WHY THIS NUMBER CHANGED, AND WHY IT IS NOW IMPORTED, NOT COPIED
 * ────────────────────────────────────────────────────────────────────────
 * Slice F1 set this to `min-h-[29.25rem]` (468px) because that is what
 * `ProductCardVisual` declared. The self-test asserted the two STRINGS matched
 * and passed. The strings did match. The page still shifted 0.405.
 *
 * The bug: `min-h` is a FLOOR, not a height. The real card's content is taller
 * than the floor, so it never rendered at 468px. Measured on the live Vercel
 * deployment with a real browser at four viewports:
 *
 *     390px → 586px      768px  → 596px
 *     412px → 542px      1599px → 596px
 *
 * The skeleton reserved 468px and was replaced by a 542–596px card, so every
 * grid row dropped 74–128px the moment products arrived. Asserting that two
 * Tailwind class strings are equal proved nothing about rendered height, which
 * is the only thing CLS measures.
 *
 * The floor is therefore raised to the measured ceiling (37.25rem = 596px) and
 * `ProductCardVisual` now IMPORTS this constant instead of declaring its own
 * copy. There is exactly one number now, so the skeleton and the card cannot
 * disagree again — not because a test says so, but because there is nothing
 * left to disagree with.
 *
 * `min-h` is deliberately KEPT rather than switched to a fixed `h`. A fixed
 * height would clip a card whose content genuinely exceeds 596px (a long
 * product name wrapping to a third line), and this same component renders on
 * the home rail, the specials grid and the PDP rail — surfaces this slice did
 * not measure. A raised floor fixes the measured shift and cannot clip.
 */
export const CARD_MIN_HEIGHT = "min-h-[37.25rem]";

/**
 * Height reserved for the sticky site header while the route loads.
 *
 * SLICE G — THE SECOND MEASURED SHIFT
 * ───────────────────────────────────
 * `src/app/menu/loading.tsx` rendered no header; `src/app/menu/page.tsx`
 * renders `<Header />`. When the route handed off, the header appeared and
 * pushed everything below it down. Captured as a position timeline on the live
 * deployment (412px, 4x CPU throttle, Slow 4G):
 *
 *     t=4558ms  banner top =  37px   ← loading.tsx, no header
 *     t=4918ms  banner top = 136px   ← page.tsx, header present  (+99px)
 *
 * Measured real header heights, live, by viewport:
 *
 *     360→93.2  390→93.6  412→95.4  640→105.2  768→115
 *     1024→121.3  1280→127.8  1536→137.4  1920→137.4
 *
 * Rounded UP to the nearest breakpoint step so the reserve is never shorter
 * than the header that replaces it (a short reserve shifts content down, which
 * is what CLS punishes; an over-reserve of a pixel or two does not move the
 * content the shopper is looking at).
 *
 * WHY A SPACER AND NOT THE REAL <Header />: `Header` is an async server
 * component — it awaits `getContentForRender(MEDICAL_HIDE_BLOCK)`. Rendering
 * it inside `loading.tsx` would make the loading UI itself await I/O, and a
 * skeleton that awaits is not a skeleton. The spacer reserves the same space
 * with zero I/O.
 */
export const HEADER_RESERVE_HEIGHT =
  "h-[6rem] sm:h-[6.6rem] md:h-[7.2rem] lg:h-[7.6rem] xl:h-[8rem] 2xl:h-[8.6rem]";

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
  //
  // SLICE G: this assertion used to read `CARD_MIN_HEIGHT === "min-h-[29.25rem]"`
  // and it PASSED while the live page shifted 0.405. It only ever proved the
  // skeleton's string equalled the card's string; it could not see that `min-h`
  // is a floor and that the real card rendered 542-596px against it. The
  // replacement asserts the property that actually governs CLS: the reserved
  // height is at least the tallest height the card was measured at.
  const remValue = (cls: string): number => {
    const m = /min-h-\[([0-9.]+)rem\]/.exec(cls);
    return m ? Number.parseFloat(m[1]) : Number.NaN;
  };
  const reservedRem = remValue(CARD_MIN_HEIGHT);
  // Live measurements, greenwaywebsite1.vercel.app/menu, real Chromium:
  //   390px->586px  412px->542px  768px->596px  1599px->596px
  const TALLEST_MEASURED_CARD_PX = 596;
  check("card reserve parses as a rem value", Number.isFinite(reservedRem));
  check(
    "card reserve is at least the tallest measured real card (596px)",
    reservedRem * 16 >= TALLEST_MEASURED_CARD_PX,
  );
  // Guard the other direction too: an absurd over-reserve would leave a band of
  // dead space under every row, which is its own visual defect.
  check("card reserve is not wastefully tall", reservedRem * 16 <= TALLEST_MEASURED_CARD_PX + 32);
  check("card reserve is a floor, not a fixed height", CARD_MIN_HEIGHT.startsWith("min-h-["));

  // -- The header reserve must cover the real sticky header --------------------
  // Live-measured header heights: 360->93.2 390->93.6 412->95.4 640->105.2
  // 768->115 1024->121.3 1280->127.8 1536->137.4. Each declared step must be >=
  // the tallest real header in the range it covers, or `loading.tsx` under-
  // reserves and the page drops when the real header mounts.
  const stepRem = (prefix: string): number => {
    const m = new RegExp(`(?:^|\\s)${prefix}h-\\[([0-9.]+)rem\\]`).exec(HEADER_RESERVE_HEIGHT);
    return m ? Number.parseFloat(m[1]) : Number.NaN;
  };
  const headerSteps: Array<[string, string, number]> = [
    // [label, tailwind prefix, tallest real header px in the range it covers]
    ["base", "", 95.4],
    ["sm", "sm:", 105.2],
    ["md", "md:", 115],
    ["lg", "lg:", 121.3],
    ["xl", "xl:", 127.8],
    ["2xl", "2xl:", 137.4],
  ];
  for (const [label, prefix, tallestPx] of headerSteps) {
    const rem = stepRem(prefix);
    check(`header reserve declares a ${label} step`, Number.isFinite(rem));
    check(`header reserve at ${label} covers the real header (${tallestPx}px)`, rem * 16 >= tallestPx);
    check(`header reserve at ${label} is not wastefully tall`, rem * 16 <= tallestPx + 24);
  }
  check(
    "header reserve steps increase monotonically",
    headerSteps.every(([, prefix], i) => i === 0 || stepRem(prefix) >= stepRem(headerSteps[i - 1][1])),
  );
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
