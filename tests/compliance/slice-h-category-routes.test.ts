/**
 * SLICE H — THE SHOP PAGE BECOMES CACHEABLE, AND CATEGORIES BECOME REAL PAGES.
 *
 * THE DEFECT, MEASURED (not inferred)
 * ───────────────────────────────────
 * `/menu` read `searchParams`. Next.js documents the consequence:
 *
 *   "`searchParams` is a Request-time API whose values cannot be known ahead of
 *    time. Using it will opt the page into dynamic rendering at request time."
 *
 * Probing the live deployment showed exactly that. `/menu` was the ONLY public
 * route on the site that never came from the CDN:
 *
 *     /menu       MISS  MISS  MISS   private, no-cache, no-store
 *     /           STALE (age 753)    public
 *     /vendors    HIT   (age 3494)   public
 *     /about      PRERENDER          public
 *     /blog       PRERENDER          public
 *
 * PageSpeed reported the cost as "server responded slowly (observed 1324 ms)",
 * est. savings 1,220 ms — on the single most-visited page on the site.
 *
 * `draftMode()` was suspected three times across earlier slices and cleared by
 * controlled comparison every time: `/` and `/blog` both call it and both cache.
 * The only structural difference between `/` and `/menu` was `searchParams`.
 *
 * WHAT THIS SUITE GUARDS
 * ──────────────────────
 * 1. Neither shop route reads a request-time API — the regression that would
 *    silently undo the entire slice while every other test stayed green.
 * 2. The category routes are actually enumerated and prerendered.
 * 3. Unknown slugs 404 at the edge instead of rendering the whole menu under a
 *    wrong canonical.
 * 4. Each category page carries its OWN canonical — pointing them back at
 *    /menu would tell Google the 21 pages are duplicates and waste the slice.
 * 5. The sitemap advertises exactly the routes that are prerendered.
 * 6. Internal links point at the new paths.
 * 7. Both routes render through ONE shared component so they cannot drift.
 *
 * TECHNIQUE NOTE — comments are stripped before asserting. These files EXPLAIN
 * at length why `searchParams` was removed, and a test that matched its own
 * subject's prose would be a false positive (the trap documented in SLICE 18-0
 * mutant #15). Every source assertion below runs against CODE ONLY, and each
 * block carries an anti-vacuity guard so a stripper failing open cannot pass.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MENU_ROOT_PATH,
  ROUTABLE_CATEGORIES,
  ROUTABLE_FACET,
  __runMenuFacetTests,
  allCategoryPaths,
  allCategoryRouteParams,
  categoryBreadcrumbs,
  categoryMetaDescription,
  categoryMetaTitle,
  categoryPath,
  isRoutableCategorySlug,
} from "@/lib/menu/menu-facet-core";
import { websiteCategoryDefinitions } from "@/lib/pos/category-taxonomy";

const repoRoot = process.cwd();
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ") // {/* jsx */}
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */
    .replace(/^\s*\/\/.*$/gm, " "); // // line
}

/**
 * Assert the stripper produced usable code rather than an empty string.
 *
 * NOTE ON THE THRESHOLD: these route files are deliberately comment-heavy —
 * they document a measured production defect and why the fix is shaped the way
 * it is — so a ratio-based guard (e.g. "at least a quarter of the original")
 * fails on exactly the files worth documenting, which would punish good
 * commenting. What actually needs proving is that the stripper did not eat the
 * CODE, so assert on a required token plus a small absolute floor.
 */
function guardStripped(code: string, original: string, mustContain: string) {
  expect(original.length).toBeGreaterThan(0);
  expect(code).toContain(mustContain);
  expect(code.trim().length).toBeGreaterThan(120);
}

const MENU_ROUTE = "src/app/menu/page.tsx";
const CATEGORY_ROUTE = "src/app/menu/[category]/page.tsx";
const SHOP_RENDERER = "src/components/menu/ShopPage.tsx";
const SITEMAP = "src/app/sitemap.ts";
const NAV_DATA = "src/components/site/navigation-data.ts";
const MOBILE_NAV = "src/components/site/MobileNavigation.tsx";

describe("Slice H — the pure facet core", () => {
  it("its own self-tests all pass", () => {
    const result = __runMenuFacetTests();
    expect(result.failed).toBe(0);
    expect(result.passed).toBeGreaterThan(0);
  });

  it("routes exactly the categories the taxonomy owns — no more, no fewer", () => {
    // The prerendered set is DERIVED from the taxonomy rather than copied, so
    // adding a category in one place cannot leave the shop with a route the
    // sitemap does not advertise (or vice versa).
    expect([...ROUTABLE_CATEGORIES].sort()).toEqual(
      websiteCategoryDefinitions.map((d) => d.value).sort(),
    );
    expect(ROUTABLE_CATEGORIES.length).toBe(websiteCategoryDefinitions.length);
  });

  it("only `category` was promoted to a route segment", () => {
    // Brands (191) and vendors (113) are OPEN sets that change with every
    // receiving run, and their combinations are unbounded. Promoting them would
    // create an infinite prerender surface and a crawl trap. Categories are a
    // closed set of 21 owned by category-taxonomy.ts. This pins that decision.
    expect(ROUTABLE_FACET).toBe("category");
  });

  it("rejects every slug that is not a real category (fails closed)", () => {
    for (const bad of [
      "",
      " ",
      "Flower",
      " flower ",
      "flower/",
      "../admin",
      "%2e%2e",
      "brands",
      "vendors",
      "nope",
    ]) {
      expect(isRoutableCategorySlug(bad), `accepted bad slug: ${JSON.stringify(bad)}`).toBe(false);
    }
    // ...and accepts every real one.
    for (const good of ROUTABLE_CATEGORIES) {
      expect(isRoutableCategorySlug(good), `rejected real category: ${good}`).toBe(true);
    }
  });

  it("every category produces a distinct, well-formed path", () => {
    const paths = allCategoryPaths();
    expect(paths.length).toBe(ROUTABLE_CATEGORIES.length);
    expect(new Set(paths).size).toBe(paths.length); // no collisions
    for (const p of paths) {
      expect(p.startsWith(`${MENU_ROOT_PATH}/`)).toBe(true);
      expect(p).not.toContain("?"); // a query string here would defeat the slice
      expect(p).toMatch(/^\/menu\/[a-z0-9-]+$/);
    }
  });

  it("metadata is unique per category and within search-engine limits", () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const category of ROUTABLE_CATEGORIES) {
      const title = categoryMetaTitle(category);
      const description = categoryMetaDescription(category);
      // Duplicate titles/descriptions across 21 pages is what tells a search
      // engine they are the same page — precisely what this slice undoes.
      titles.add(title);
      descriptions.add(description);
      expect(description.length).toBeLessThanOrEqual(155);
      expect(description.length).toBeGreaterThan(0);
      expect(title).toContain("Greenway");
    }
    expect(titles.size).toBe(ROUTABLE_CATEGORIES.length);
    expect(descriptions.size).toBe(ROUTABLE_CATEGORIES.length);
  });

  it("breadcrumbs lead back to the shop root", () => {
    for (const category of ROUTABLE_CATEGORIES) {
      const crumbs = categoryBreadcrumbs(category);
      expect(crumbs.length).toBeGreaterThanOrEqual(2);
      expect(crumbs[0]!.href).toBe(MENU_ROOT_PATH);
      expect(crumbs.at(-1)!.href).toBe(categoryPath(category));
    }
  });
});

describe("Slice H — neither shop route reads a request-time API", () => {
  // THE REGRESSION GUARD. A single `searchParams` read anywhere in either route
  // file makes the page dynamic again and silently restores the 1,324 ms
  // server response this slice removed. Nothing else in the suite would notice.
  for (const file of [MENU_ROUTE, CATEGORY_ROUTE, SHOP_RENDERER]) {
    it(`${file} reads no searchParams / cookies() / headers()`, () => {
      const original = read(file);
      const code = stripComments(original);
      guardStripped(code, original, "ShopPage");

      expect(code, "reads searchParams").not.toMatch(/\bsearchParams\b/);
      expect(code, "reads cookies()").not.toMatch(/\bcookies\s*\(\s*\)/);
      expect(code, "reads headers()").not.toMatch(/\bheaders\s*\(\s*\)/);
      expect(code, "forces dynamic rendering").not.toMatch(
        /export const dynamic\s*=\s*["']force-dynamic["']/,
      );
    });
  }

  it("both routes declare the same revalidate window as the menu data cache", () => {
    // Page cache and data cache expiring together avoids one serving content
    // the other has already dropped.
    for (const file of [MENU_ROUTE, CATEGORY_ROUTE]) {
      const code = stripComments(read(file));
      const match = code.match(/export const revalidate = (\d+);/);
      expect(match, `${file} declares no revalidate`).not.toBeNull();
      expect(Number(match![1]), `${file} revalidate mismatch`).toBe(60);
    }
  });
});

describe("Slice H — the category routes are prerendered and fail closed", () => {
  const original = read(CATEGORY_ROUTE);
  const code = stripComments(original);

  it("enumerates every category at build time", () => {
    guardStripped(code, original, "generateStaticParams");
    expect(code).toMatch(/export function generateStaticParams\s*\(/);
    // Derived from the shared core, NOT hand-listed — a hand-listed copy is how
    // the route set and the sitemap drift apart.
    expect(code).toContain("allCategoryRouteParams()");
    expect(allCategoryRouteParams().length).toBe(ROUTABLE_CATEGORIES.length);
  });

  it("404s unknown slugs at the edge instead of rendering the whole menu", () => {
    expect(code).toMatch(/export const dynamicParams = false;/);
    // Belt and braces: even if that config changed, the component itself must
    // refuse a slug it does not recognise rather than render the full catalog
    // under a category canonical.
    expect(code).toContain("isRoutableCategorySlug");
    expect(code).toMatch(/notFound\(\)/);
  });

  it("each category page canonicalises to ITSELF, not to /menu", () => {
    // Pointing all 21 canonicals back at the shop root would tell search
    // engines these are duplicate pages and throw away the SEO half of the
    // slice entirely.
    expect(code).toMatch(/path:\s*categoryPath\(category\)/);
    expect(code).toMatch(/title:\s*categoryMetaTitle\(category\)/);
    expect(code).toMatch(/description:\s*categoryMetaDescription\(category\)/);
  });
});

describe("Slice H — one renderer, two routes, no drift", () => {
  it("both routes import AND render the shared shop component", () => {
    for (const file of [MENU_ROUTE, CATEGORY_ROUTE]) {
      const code = stripComments(read(file));
      expect(code, `${file} does not import ShopPage`).toMatch(
        /import\s*\{[^}]*\bShopPage\b[^}]*\}\s*from\s*["']@\/components\/menu\/ShopPage["']/,
      );
      expect(code, `${file} does not render <ShopPage>`).toMatch(/<ShopPage[\s>]/);
    }
  });

  it("neither route file performs catalog I/O of its own", () => {
    // If a route started loading the catalog itself, the two shop pages could
    // show different products — and the route would lose the streaming shape
    // Slice F2 established.
    for (const file of [MENU_ROUTE, CATEGORY_ROUTE]) {
      const code = stripComments(read(file));
      for (const forbidden of [
        "loadLiveMenuItemsCached(",
        "withMenuProfile(",
        "withResolvedImages(",
        "getPageBanners(",
        "getShopCarouselForRender(",
      ]) {
        expect(code, `${file} performs ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("the category route opens the grid on its own category", () => {
    const code = stripComments(read(CATEGORY_ROUTE));
    expect(code).toMatch(/initialCategory=\{category\}/);
  });

  it("the shared renderer passes the route category through as a plain value", () => {
    // The category reaches the browser as a normal prop derived from a ROUTE
    // SEGMENT. That is the whole distinction this slice rests on: a segment is
    // statically known, a query string is request-time.
    const code = stripComments(read(SHOP_RENDERER));
    expect(code).toMatch(/initialSearchParams=\{initialCategory \? \{ category: initialCategory \} : \{\}\}/);
  });
});

describe("Slice H — the sitemap advertises exactly what is prerendered", () => {
  const original = read(SITEMAP);
  const code = stripComments(original);

  it("is built from the same core the routes are enumerated from", () => {
    guardStripped(code, original, "sitemap");
    expect(code).toContain("allCategoryPaths");
  });

  it("advertises one entry per routable category", () => {
    // Derived, not hand-listed, so the advertised set and the prerendered set
    // are the same set by construction.
    expect(allCategoryPaths().length).toBe(allCategoryRouteParams().length);
    expect(allCategoryPaths().length).toBe(ROUTABLE_CATEGORIES.length);
  });
});

describe("Slice H — internal links point at the new paths", () => {
  it("navigation no longer deep-links the legacy ?category= query string", () => {
    // Internal links pointing at `/menu?category=x` would send every shopper
    // and every crawler to the uncacheable query-string form of the page,
    // bypassing the 21 prerendered documents this slice created.
    for (const file of [NAV_DATA, MOBILE_NAV]) {
      const code = stripComments(read(file));
      expect(code, `${file} still uses ?category=`).not.toContain("/menu?category=");
    }
  });

  it("navigation links resolve to real, prerendered routes", () => {
    // Stronger than "no query strings": every `/menu/<slug>` link the nav ships
    // must correspond to a slug that `generateStaticParams` actually emits.
    // A typo like `/menu/flowers` would 404 at the edge under
    // `dynamicParams = false` — a dead nav link, live on the site.
    const prerendered = new Set(allCategoryPaths());
    let checked = 0;

    for (const file of [NAV_DATA, MOBILE_NAV]) {
      const code = stripComments(read(file));
      for (const match of code.matchAll(/["'`](\/menu\/[a-z0-9-]+)["'`]/g)) {
        const href = match[1]!;
        expect(prerendered.has(href), `${file}: ${href} is not a prerendered route`).toBe(true);
        checked += 1;
      }
    }

    // Anti-vacuity: this test is worthless if the regex matched nothing.
    expect(checked).toBeGreaterThan(0);
  });
});
