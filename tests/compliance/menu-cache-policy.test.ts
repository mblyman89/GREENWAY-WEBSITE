/**
 * tests/compliance/menu-cache-policy.test.ts
 *
 * SLICE A (performance) — guards the caching of the published menu.
 *
 * The customer site now serves the menu from a cache instead of rebuilding it
 * from ~49 database round trips on every page view. Caching a cannabis menu is
 * not a free lunch: get it wrong and you either
 *
 *   (a) freeze the website so the back office stops affecting it — the exact
 *       SLICE 48 bug the live-menu module was written to kill, or
 *   (b) charge a customer a cached, stale price — far worse.
 *
 * These tests exist so neither can happen silently. They read the REAL source
 * files, not a description of them, because the thing being guarded is which
 * function each call site actually calls.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MENU_CACHE_TAG,
  MENU_CACHE_KEY,
  MENU_CACHE_TTL_SECONDS,
  MENU_REVALIDATE_PROFILE,
  MENU_READ_SURFACES,
  CACHEABLE_SURFACE_NAMES,
  isCacheableSurface,
  menuCacheOptions,
  freshnessPromise,
  __runMenuCachePolicyTests,
} from "@/lib/menu/menu-cache-policy-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const LIVE_MENU = read("src/lib/pos/live-menu.ts");
const PUBLIC_SURFACES = read("src/lib/site/public-surfaces.ts");
const ORDER_PRICING = read("src/lib/orders/order-pricing.ts");
const REGISTER_MENU = read("src/app/api/pos/menu/route.ts");

describe("the pure policy proves itself", () => {
  it("passes every one of its own assertions", () => {
    const result = __runMenuCachePolicyTests();
    expect(result.failed).toBe(0);
    expect(result.passed).toBeGreaterThan(35);
  });
});

describe("THE MONEY RULE — cache the display, never the money", () => {
  it("order repricing reads the UNCACHED loader, so a customer is never charged a cached price", () => {
    // repriceOrderLines decides what the customer actually pays.
    expect(ORDER_PRICING).toContain("loadLiveMenuAll()");
    expect(
      ORDER_PRICING,
      "order-pricing.ts must NOT use a cached menu loader — a cached price is a wrong price",
    ).not.toContain("loadLiveMenuAllCached");
    expect(ORDER_PRICING).not.toContain("loadLiveMenuItemsCached");
  });

  it("the register's menu sync reads the UNCACHED loader, so the sales floor cannot oversell", () => {
    expect(REGISTER_MENU).toContain("loadLiveMenuAll()");
    expect(
      REGISTER_MENU,
      "the register must see present stock, not a cached copy",
    ).not.toContain("Cached");
  });

  it("no money or register surface is classified cacheable", () => {
    for (const s of MENU_READ_SURFACES) {
      if (/repricing|completion|register/i.test(s.name)) {
        expect(s.cacheable, `${s.name} must never be cacheable`).toBe(false);
      }
    }
  });

  it("an unknown surface fails CLOSED (slow and correct beats fast and wrong)", () => {
    expect(isCacheableSurface("A page nobody has classified yet")).toBe(false);
    expect(isCacheableSurface("")).toBe(false);
  });
});

describe("THE FRESHNESS RULE — publishing must still change the site instantly", () => {
  it("the canonical invalidation helper clears the DATA tag, not just the pages", () => {
    // This is what protects the SLICE 48 guarantee. Without it, a publish would
    // re-render fresh pages from a stale cache — stale data wearing a new hat.
    expect(PUBLIC_SURFACES).toContain("revalidateTag");
    expect(PUBLIC_SURFACES).toContain("MENU_CACHE_TAG");
  });

  it("clears the data tag BEFORE revalidating the pages (order is load-bearing)", () => {
    const tagAt = PUBLIC_SURFACES.indexOf("revalidateTag(MENU_CACHE_TAG");
    const pathAt = PUBLIC_SURFACES.indexOf("revalidatePath(path)");
    expect(tagAt).toBeGreaterThan(-1);
    expect(pathAt).toBeGreaterThan(-1);
    expect(
      tagAt,
      "the data cache must be cleared before the page cache, or the pages rebuild from stale data",
    ).toBeLessThan(pathAt);
  });

  it("still refreshes all four public menu surfaces (nothing was lost)", () => {
    for (const path of ["/", "/menu", "/specials", "/vendor-delivery"]) {
      expect(PUBLIC_SURFACES).toContain(`"${path}"`);
    }
  });

  it("passes the Next.js 16 second argument to revalidateTag", () => {
    // Next 16 deprecates the single-argument form
    // (next/dist/server/web/spec-extension/revalidate.js:42-44).
    expect(PUBLIC_SURFACES).toContain("MENU_REVALIDATE_PROFILE");
    expect(["default", "seconds", "minutes", "hours", "days", "weeks", "max"]).toContain(
      MENU_REVALIDATE_PROFILE,
    );
  });

  it("invalidation never throws — a publish that already committed must not report failure", () => {
    const fn = PUBLIC_SURFACES.slice(PUBLIC_SURFACES.indexOf("export function revalidatePublicMenuSurfaces"));
    expect(fn).toContain("try {");
    expect(fn).toContain("catch");
  });

  it("the tag used for READING is the identical string used for INVALIDATING", () => {
    // Both sides import the same constant rather than retyping a literal —
    // this is the whole reason the policy is a shared module.
    expect(LIVE_MENU).toContain("menuCacheOptions()");
    expect(menuCacheOptions().tags).toEqual([MENU_CACHE_TAG]);
    expect(PUBLIC_SURFACES).toContain("MENU_CACHE_TAG");
  });
});

describe("THE INTAKE PATH — the permanent way products arrive", () => {
  /**
   * Menu Import is a ONE-TIME Cultivera migration. From then on every product
   * enters through receiving: manifest + JSON intake, approval, auto-publish.
   * So the intake path is the one that must invalidate forever, not the
   * import path. Both funnel through the same RPC and the same helper.
   */
  const INTAKE = read("src/lib/pos/intake-menu-staging.ts");

  it("intake auto-publish calls the canonical invalidation helper", () => {
    expect(INTAKE).toContain("revalidatePublicMenuSurfaces");
  });

  it("intake publishes through the same atomic RPC as the manual publish", () => {
    expect(INTAKE).toContain("publish_menu_version");
  });

  it("both publish call sites route through the one helper, so neither can forget the cache", () => {
    const IMPORTS_ACTION = read("src/app/admin/menu-imports/actions.ts");
    expect(IMPORTS_ACTION).toContain("revalidatePublicMenuSurfaces");
    expect(INTAKE).toContain("revalidatePublicMenuSurfaces");
  });
});

describe("THE SAFETY NET — bounded staleness for in-place writes", () => {
  /**
   * A sale decrements stock directly on the published rows
   * (sale-decrement.ts:132-167) and does NOT revalidate. The TTL is what stops
   * that becoming permanent staleness.
   */
  it("the cache has a finite expiry — never cache a menu forever", () => {
    expect(Number.isFinite(MENU_CACHE_TTL_SECONDS)).toBe(true);
    expect(MENU_CACHE_TTL_SECONDS).toBeGreaterThan(0);
  });

  it("stale stock self-heals within two minutes", () => {
    expect(MENU_CACHE_TTL_SECONDS).toBeLessThanOrEqual(120);
  });

  it("the TTL is actually applied to the cached loader", () => {
    expect(menuCacheOptions().revalidate).toBe(MENU_CACHE_TTL_SECONDS);
    expect(LIVE_MENU).toContain("unstable_cache");
  });

  it("the owner-facing promise quotes the real TTL, so docs cannot drift from code", () => {
    expect(freshnessPromise("sale")).toContain(String(MENU_CACHE_TTL_SECONDS));
    expect(freshnessPromise("publish")).toContain("Immediately");
  });
});

describe("the cached loaders are additive — the originals still exist", () => {
  it("keeps the uncached loaders for the register and pricing", () => {
    expect(LIVE_MENU).toContain("export async function loadLiveMenuAll(");
    expect(LIVE_MENU).toContain("export async function loadLiveMenuItems(");
    expect(LIVE_MENU).toContain("export async function getLiveMenuItemById(");
  });

  it("adds the cached variants as SEPARATE, opt-in exports", () => {
    expect(LIVE_MENU).toContain("loadLiveMenuAllCached");
    expect(LIVE_MENU).toContain("loadLiveMenuItemsCached");
    expect(LIVE_MENU).toContain("getLiveMenuItemByIdCached");
  });

  it("the hidden filter runs OUTSIDE the cache, so one entry serves both views", () => {
    const cachedFn = LIVE_MENU.slice(LIVE_MENU.indexOf("loadLiveMenuItemsCached"));
    expect(cachedFn).toContain("filter((item) => !item.hidden)");
  });

  it("hidden products never reach the public cached list", () => {
    // Guards the SLICE 48/fact-review promise: hiding an item hides it.
    expect(LIVE_MENU).toContain("!item.hidden");
  });
});

describe("every public browsing page reads the cached loader", () => {
  const CASES: { file: string; needle: string }[] = [
    { file: "src/app/menu/page.tsx", needle: "loadLiveMenuItemsCached" },
    { file: "src/app/page.tsx", needle: "loadLiveMenuItemsCached" },
    { file: "src/app/specials/page.tsx", needle: "loadLiveMenuItemsCached" },
    { file: "src/app/vendor-delivery/page.tsx", needle: "loadLiveMenuAllCached" },
    { file: "src/app/sitemap.ts", needle: "loadLiveMenuItemsCached" },
    { file: "src/app/menu/products/[id]/page.tsx", needle: "getLiveMenuItemByIdCached" },
  ];

  for (const c of CASES) {
    it(`${c.file} uses the cached path`, () => {
      expect(read(c.file)).toContain(c.needle);
    });
  }

  it("the shop menu no longer calls the uncached loader at all", () => {
    const MENU = read("src/app/menu/page.tsx");
    // `loadLiveMenuItemsCached` contains `loadLiveMenuItems`, so match the call.
    expect(MENU).not.toContain("loadLiveMenuItems()");
  });

  it("the product page's related-items query is cached too (it loaded the catalog twice)", () => {
    const PID = read("src/app/menu/products/[id]/page.tsx");
    expect(PID).toContain("loadLiveMenuItemsCached()");
    expect(PID).not.toContain("await loadLiveMenuItems()");
  });

  it("the classified cacheable list matches the pages actually switched", () => {
    expect(CACHEABLE_SURFACE_NAMES.length).toBe(CASES.length);
  });
});

describe("the cache key and tag are well-formed", () => {
  it("the tag is a stable, whitespace-free string", () => {
    expect(MENU_CACHE_TAG).toBe("live-menu");
    expect(MENU_CACHE_TAG).not.toMatch(/\s/);
  });

  it("the key parts are all non-empty", () => {
    expect(MENU_CACHE_KEY.length).toBeGreaterThan(0);
    for (const part of MENU_CACHE_KEY) expect(part.trim().length).toBeGreaterThan(0);
  });

  it("every classified surface anchors to a real file that exists", () => {
    for (const s of MENU_READ_SURFACES) {
      const file = s.anchor.split(":")[0]!;
      expect(() => read(file), `${s.anchor} does not point at a real file`).not.toThrow();
    }
  });

  it("every classified surface's anchor line number is within the file", () => {
    for (const s of MENU_READ_SURFACES) {
      const [file, lineStr] = s.anchor.split(":");
      const lines = read(file!).split("\n").length;
      expect(Number(lineStr), `${s.anchor} points past the end of the file`).toBeLessThanOrEqual(
        lines,
      );
    }
  });
});
