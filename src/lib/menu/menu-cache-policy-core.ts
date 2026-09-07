/**
 * src/lib/menu/menu-cache-policy-core.ts
 *
 * SLICE A (performance) — THE CACHE POLICY, AS PURE DATA.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * The customer site rebuilt the entire published menu from the database on
 * EVERY page view: ~49 sequential round trips, repeated for every visitor,
 * every refresh, every back-button press. Nothing was cached, and three public
 * pages carried `export const dynamic = "force-dynamic"`, which switched
 * caching off explicitly.
 *
 * That instinct came from a real bug (SLICE 48): the site used to read a
 * COMMITTED JSON SNAPSHOT, so clearing the back office had no effect on the
 * website — a frozen menu. `force-dynamic` guaranteed freshness by paying full
 * price on every request. It worked, and it was slow.
 *
 * The correct tool is not a timer and not "no cache". It is a TAGGED cache
 * that is thrown away the instant the menu changes. The menu changes when WE
 * change it, not on a schedule.
 *
 * THE DANGEROUS PART, STATED PLAINLY
 * ──────────────────────────────────
 * `loadLiveMenuAll()` is not only the website's loader. It is also read by:
 *   - `src/lib/orders/order-pricing.ts:133` — repriceOrderLines(), which
 *     decides what a customer is CHARGED, and
 *   - `src/app/api/pos/menu/route.ts:87` — the register's menu sync.
 *
 * Caching a price that money is computed from is how a shop accidentally sells
 * at yesterday's price. So the rule this module encodes is absolute:
 *
 *     CACHE THE DISPLAY. NEVER CACHE THE MONEY.
 *
 * Public, read-only, human-facing pages may serve a cached copy. Anything that
 * prices, charges, decrements stock, or answers the register reads straight
 * through to the database, exactly as it does today. That is why this slice
 * adds a SEPARATE cached entry point instead of caching the shared loader:
 * the fast path is opt-in, and the money path cannot accidentally inherit it.
 *
 * THE SECOND DANGEROUS PART — IN-PLACE WRITES
 * ───────────────────────────────────────────
 * `menu_items` rows of the PUBLISHED version are mutated in place by paths
 * that are not "publish" at all — a sale decrements stock
 * (`src/lib/inventory/sale-decrement.ts:132-167`), staff flag an item out of
 * stock (`src/app/api/pos/stock-flag/route.ts:78`), prices are corrected
 * (`src/lib/inventory/price-write-store.ts:239`). None of those call
 * `revalidatePath` today. So "cache until Publish" alone would leave a sold-out
 * product showing as in stock indefinitely.
 *
 * Hence two independent defences, belt and braces:
 *   1. TAG invalidation — instant, exact, fires on publish/reset.
 *   2. A bounded TTL — a safety net so that ANY write path we have not yet
 *      wired up self-heals within a known, short, stated window instead of
 *      going stale forever. A cache with no expiry is a promise that every
 *      future developer will remember something. This one does not rely on that.
 *
 * Everything here is PURE: no imports, no I/O, no Next.js. It can be reasoned
 * about and tested in isolation, and it carries its own self-test below.
 */

/**
 * The cache tag every public menu read is stored under. One tag, one string,
 * used by both the reader and the invalidator, so they can never drift apart.
 */
export const MENU_CACHE_TAG = "live-menu";

/**
 * The key parts `unstable_cache` uses to name the cached entry. Distinct from
 * the tag on purpose: the tag is what we invalidate, the key is what we store.
 */
export const MENU_CACHE_KEY = ["live-menu", "published", "v1"] as const;

/**
 * Safety-net expiry, in seconds.
 *
 * WHY 60 AND NOT "FOREVER": stock is decremented in place by real sales
 * without any revalidation call (see the header). Sixty seconds bounds how
 * long the WEBSITE can advertise a product the shelf no longer has. It is not
 * the primary freshness mechanism — tag invalidation is, and it is instant —
 * this is only the floor under it.
 *
 * WHY 60 AND NOT 5: at 4,500 products the full rebuild is the expensive thing
 * we are trying to stop doing. A 5-second window would rebuild ~12× more often
 * for freshness nobody can perceive on a browsing page.
 *
 * WHY THIS IS SAFE TO GET SLIGHTLY WRONG: the register and the checkout price
 * are NOT cached. The worst case is a shopper briefly sees an item that just
 * sold out; the order is then rejected at pricing time with the existing 409
 * ("The menu is being updated. Please refresh and try again.",
 * `order-pricing.ts:136-139`). We can show a stale card. We can never take
 * stale money.
 */
export const MENU_CACHE_TTL_SECONDS = 60;

/**
 * Next.js 16 requires a second argument to `revalidateTag` — omitting it logs
 * a deprecation warning (`next/dist/server/web/spec-extension/revalidate.js:42-44`).
 * "max" means "expire this tag as far as the cache allows", which is what a
 * publish means: the old menu is gone, not merely stale.
 */
export const MENU_REVALIDATE_PROFILE = "max";

/** A surface that reads the published menu, and whether it may serve a cached copy. */
export type MenuReadSurface = {
  /** Human-readable name, used in the audit table and in test failure messages. */
  readonly name: string;
  /** Where it lives, so a reader can go and check the claim. */
  readonly anchor: string;
  /** True = may serve a cached copy. False = must read through to the database. */
  readonly cacheable: boolean;
  /** Why. Written for a person, not a compiler. */
  readonly reason: string;
};

/**
 * Every caller of the live-menu loaders, classified. This list is the slice's
 * argument in table form: if a surface is not here, it has not been considered,
 * and the self-test below refuses to let the cacheable set grow silently.
 */
export const MENU_READ_SURFACES: readonly MenuReadSurface[] = [
  // ── Safe to cache: read-only, public, display-only ──────────────────────
  {
    name: "Shop menu (/menu)",
    anchor: "src/app/menu/page.tsx:57",
    cacheable: true,
    reason: "Browsing surface. Shows cards; charges nobody.",
  },
  {
    name: "Home page featured products (/)",
    anchor: "src/app/page.tsx:63",
    cacheable: true,
    reason: "Browsing surface. Shows cards; charges nobody.",
  },
  {
    name: "Specials (/specials)",
    anchor: "src/app/specials/page.tsx:42",
    cacheable: true,
    reason: "Browsing surface. Shows cards; charges nobody.",
  },
  {
    name: "Product detail (/menu/products/[id])",
    anchor: "src/app/menu/products/[id]/page.tsx:109",
    cacheable: true,
    reason:
      "Browsing surface. The price shown is re-verified server-side at order placement by repriceOrderLines, so a stale card cannot become a stale charge.",
  },
  {
    name: "Vendors & Partners (/vendor-delivery)",
    anchor: "src/app/vendor-delivery/page.tsx:38",
    cacheable: true,
    reason: "Directory derived from menu vendor names. Display only.",
  },
  {
    name: "Sitemap (/sitemap.xml)",
    anchor: "src/app/sitemap.ts:46",
    cacheable: true,
    reason: "A list of URLs for search engines. No prices, no stock.",
  },

  // ── MUST NOT be cached: money, stock, and the register ──────────────────
  {
    name: "Order repricing",
    anchor: "src/lib/orders/order-pricing.ts:133",
    cacheable: false,
    reason:
      "Decides what the customer is CHARGED. A cached price is a wrong price. Reads through, always.",
  },
  {
    name: "Order completion check",
    anchor: "src/lib/orders/order-pricing.ts:358",
    cacheable: false,
    reason: "Enforces legal purchase limits on a real transaction. Must see present truth.",
  },
  {
    name: "Register menu sync (/api/pos/menu)",
    anchor: "src/app/api/pos/menu/route.ts:87",
    cacheable: false,
    reason:
      "The sales floor's copy of prices and stock. Stale data here oversells product that is physically gone.",
  },
  {
    name: "Register product image lookup",
    anchor: "src/app/api/pos/product-image/route.ts:39",
    cacheable: false,
    reason: "Register-facing endpoint; kept on the read-through path with the rest of the register.",
  },
  {
    name: "Admin DOH product registry",
    anchor: "src/components/admin/medical/DohProductRegistry.tsx:44",
    cacheable: false,
    reason:
      "Back-office compliance screen. Staff must see the effect of their edit immediately, not in a minute.",
  },
];

/** The exact set of names permitted to serve cached data. Anything else is a bug. */
export const CACHEABLE_SURFACE_NAMES: readonly string[] = MENU_READ_SURFACES.filter(
  (s) => s.cacheable,
).map((s) => s.name);

/**
 * Is this surface allowed to serve a cached copy? Unknown surfaces answer
 * FALSE — fail closed. A new caller that nobody classified gets the slow,
 * correct behaviour rather than silently inheriting the fast, possibly-wrong one.
 */
export function isCacheableSurface(name: string): boolean {
  const found = MENU_READ_SURFACES.find((s) => s.name === name);
  return found ? found.cacheable : false;
}

/**
 * The options object handed to `unstable_cache`. Built here, in one place, so
 * the tag used for reading is provably the same string used for invalidating.
 */
export function menuCacheOptions(): { revalidate: number; tags: string[] } {
  return { revalidate: MENU_CACHE_TTL_SECONDS, tags: [MENU_CACHE_TAG] };
}

/**
 * Plain-English explanation of what the shopper sees after a given event.
 * Used by the docs and the tests so the promise we make to the owner and the
 * behaviour of the code cannot drift apart.
 */
export function freshnessPromise(event: "publish" | "reset" | "sale" | "price-edit"): string {
  switch (event) {
    case "publish":
    case "reset":
      return "Immediately. The cache is cleared as part of the action, so the very next visitor sees the new menu.";
    case "sale":
    case "price-edit":
      return `Within ${MENU_CACHE_TTL_SECONDS} seconds on the website. The register and checkout are never cached, so they are correct instantly.`;
  }
}

// ── Self-test ────────────────────────────────────────────────────────────────
/**
 * The module proves its own invariants. Called by the compliance test AND
 * runnable directly, so a broken policy cannot reach main.
 */
export function __runMenuCachePolicyTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[menu-cache-policy] FAIL: ${label}`);
    }
  };
  const eq = (label: string, actual: unknown, expected: unknown) =>
    check(`${label} (got ${JSON.stringify(actual)})`, Object.is(actual, expected));

  // ── The tag and key are real, stable strings ──────────────────────────────
  eq("tag is the agreed string", MENU_CACHE_TAG, "live-menu");
  check("tag is non-empty", MENU_CACHE_TAG.trim().length > 0);
  check("tag has no whitespace", !/\s/.test(MENU_CACHE_TAG));
  check("key parts are all non-empty", MENU_CACHE_KEY.every((k) => k.trim().length > 0));

  // ── TTL is bounded and sane ───────────────────────────────────────────────
  check("TTL is a positive number", MENU_CACHE_TTL_SECONDS > 0);
  check("TTL is finite — never cache forever", Number.isFinite(MENU_CACHE_TTL_SECONDS));
  check("TTL is an integer number of seconds", Number.isInteger(MENU_CACHE_TTL_SECONDS));
  check(
    "TTL is short enough that stale stock self-heals within a couple of minutes",
    MENU_CACHE_TTL_SECONDS <= 120,
  );
  check(
    "TTL is long enough to actually be a cache (not a rebuild-every-few-seconds trap)",
    MENU_CACHE_TTL_SECONDS >= 30,
  );

  // ── The Next.js 16 contract ───────────────────────────────────────────────
  check(
    "revalidate profile is one Next.js 16 accepts",
    ["default", "seconds", "minutes", "hours", "days", "weeks", "max"].includes(
      MENU_REVALIDATE_PROFILE,
    ),
  );
  eq("publish expires the tag as hard as possible", MENU_REVALIDATE_PROFILE, "max");

  // ── Options are built from the constants, not retyped ─────────────────────
  const opts = menuCacheOptions();
  eq("options carry the TTL", opts.revalidate, MENU_CACHE_TTL_SECONDS);
  eq("options carry exactly one tag", opts.tags.length, 1);
  eq("options tag IS the invalidation tag", opts.tags[0], MENU_CACHE_TAG);

  // ── THE SAFETY INVARIANT: money is never cacheable ────────────────────────
  const money = [
    "Order repricing",
    "Order completion check",
    "Register menu sync (/api/pos/menu)",
  ];
  for (const name of money) {
    check(`${name} is classified`, MENU_READ_SURFACES.some((s) => s.name === name));
    check(`${name} MUST NOT be cacheable`, isCacheableSurface(name) === false);
  }

  // No surface that prices, charges, or serves the register may be cacheable.
  const dangerous = MENU_READ_SURFACES.filter((s) =>
    /reprice|register|completion|charge|price/i.test(`${s.name} ${s.reason}`),
  );
  check("the dangerous set is not empty (the filter actually matches things)", dangerous.length > 0);
  check(
    "no register/pricing surface is marked cacheable",
    MENU_READ_SURFACES.filter((s) => /register|repricing|completion/i.test(s.name)).every(
      (s) => !s.cacheable,
    ),
  );

  // ── Fail closed on the unknown ────────────────────────────────────────────
  check("an unclassified surface is NOT cacheable", isCacheableSurface("Some Future Page") === false);
  check("an empty name is NOT cacheable", isCacheableSurface("") === false);

  // ── The cacheable set is exactly what we reviewed ─────────────────────────
  eq("exactly six cacheable surfaces", CACHEABLE_SURFACE_NAMES.length, 6);
  check(
    "the shop menu is cacheable (this slice's whole point)",
    isCacheableSurface("Shop menu (/menu)"),
  );
  check("the home page is cacheable", isCacheableSurface("Home page featured products (/)"));
  check("specials is cacheable", isCacheableSurface("Specials (/specials)"));
  check(
    "the product page is cacheable",
    isCacheableSurface("Product detail (/menu/products/[id])"),
  );

  // ── Every entry is documented well enough to be audited ───────────────────
  check("every surface has a name", MENU_READ_SURFACES.every((s) => s.name.trim().length > 0));
  check(
    "every surface anchors to a file and line",
    MENU_READ_SURFACES.every((s) => /^src\/.+:\d+$/.test(s.anchor)),
  );
  check(
    "every surface explains itself in a full sentence",
    MENU_READ_SURFACES.every((s) => s.reason.trim().length > 20 && s.reason.trim().endsWith(".")),
  );
  check(
    "no duplicate surface names",
    new Set(MENU_READ_SURFACES.map((s) => s.name)).size === MENU_READ_SURFACES.length,
  );
  check(
    "no duplicate anchors",
    new Set(MENU_READ_SURFACES.map((s) => s.anchor)).size === MENU_READ_SURFACES.length,
  );

  // ── The promise we print matches the behaviour we built ───────────────────
  check("publish promises immediacy", freshnessPromise("publish").includes("Immediately"));
  check("reset promises immediacy", freshnessPromise("reset").includes("Immediately"));
  check(
    "a sale states the bounded window using the real TTL",
    freshnessPromise("sale").includes(String(MENU_CACHE_TTL_SECONDS)),
  );
  check(
    "a sale reassures that the register is never cached",
    freshnessPromise("sale").includes("never cached"),
  );
  check(
    "a price edit states the same bounded window",
    freshnessPromise("price-edit").includes(String(MENU_CACHE_TTL_SECONDS)),
  );
  check(
    "every promise is a real sentence",
    (["publish", "reset", "sale", "price-edit"] as const).every(
      (e) => freshnessPromise(e).length > 30 && freshnessPromise(e).trim().endsWith("."),
    ),
  );

  return { passed, failed };
}
