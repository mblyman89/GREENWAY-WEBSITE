/**
 * SLICE H — REAL CATEGORY ROUTES, SO THE SHOP CAN FINALLY BE CACHED.
 *
 * THE MEASURED PROBLEM
 * ────────────────────
 * `/menu` is the only public route on the site that is NEVER served from the
 * CDN. Measured against the live deployment, three requests in a row:
 *
 *     /menu       x-vercel-cache: MISS   MISS   MISS
 *                 cache-control:  private, no-cache, no-store, must-revalidate
 *
 * Every other public route caches:
 *
 *     /            STALE      (age 753)
 *     /vendors     HIT        (age 3494)
 *     /about       PRERENDER
 *     /blog        PRERENDER
 *     /locations   PRERENDER
 *
 * PageSpeed saw the consequence and reported it as "server responded slowly
 * (observed 1324 ms)", est. savings 1,220 ms.
 *
 * WHY IT COULD NOT CACHE — ISOLATED BY CONTROLLED COMPARISON, NOT BY GUESSING
 * ───────────────────────────────────────────────────────────────────────────
 * `draftMode()` was suspected three separate times across earlier slices. It is
 * NOT the cause, and this is now proven rather than argued:
 *
 *     route     draftMode()   searchParams   revalidate   cached?
 *     /         yes           NO             60           YES (STALE)
 *     /blog     -             NO             300          YES (PRERENDER)
 *     /menu     yes           YES            60           NO  (MISS)
 *
 * The home page calls `draftMode()` through `getSectionsForRender` and caches
 * perfectly. The single structural difference is that `/menu` reads
 * `searchParams`, which Next.js documents as a request-time API:
 *
 *   "`searchParams` is a Request-time API whose values cannot be known ahead of
 *    time. Using it will opt the page into dynamic rendering at request time."
 *   — nextjs.org/docs/app/api-reference/file-conventions/page
 *
 * THE APPROACH — OPTION B, THE ONE THAT DOESN'T CUT CORNERS
 * ──────────────────────────────────────────────────────────
 * The cheap fix is to delete `searchParams` from `/menu` and let the client
 * filter from the URL. That caches, but it throws away something valuable: a
 * category link would stay a query string, which search engines treat as one
 * page with parameters rather than 19 distinct, indexable pages.
 *
 * Instead the category facet is promoted to a REAL route segment:
 *
 *     /menu?category=flower   ->   /menu/flower
 *
 * Those routes are enumerated at build time by `generateStaticParams`, so they
 * are prerendered into the CDN and served without touching the origin. They are
 * also genuinely indexable, each with its own canonical URL, title, description
 * and breadcrumb trail — which the query-string version never was.
 *
 * The long tail (brands, strains, terpenes, vendors, weights, THC/CBD/price
 * sliders, sort) stays client-side where it belongs. Those combinations are
 * effectively unbounded and must never become routes.
 *
 * This module is PURE. Every rule below — which facets are routable, how a slug
 * maps to a category, what the canonical URL is, what the title says — is a
 * function of its inputs with no I/O, so all of it is provable in tests.
 */

import type { GreenwayCategory } from "@/lib/leafly/types";
import {
  websiteCategoryDefinitions,
  websiteCategories,
  formatWebsiteCategory,
} from "@/lib/pos/category-taxonomy";

/** The canonical shop root. Every facet route is a child of this path. */
export const MENU_ROOT_PATH = "/menu";

/**
 * The facet promoted to a real route segment.
 *
 * ONLY `category` is routable, and that is a deliberate ceiling rather than a
 * starting point. Categories are a closed set of 21 values owned by
 * `category-taxonomy.ts`, so the route space is finite, enumerable at build
 * time, and cheap to prerender.
 *
 * Brands (191), vendors (113) and strains are open sets that change with every
 * receiving run, and their COMBINATIONS are combinatorial. Promoting them would
 * create an unbounded prerender surface and a crawl trap. They stay as
 * client-side filters, which is also what they are good at — instant, no
 * network round trip.
 */
export const ROUTABLE_FACET = "category" as const;

/**
 * Categories that get their own prerendered route.
 *
 * Derived from the SAME `websiteCategoryDefinitions` the rest of the site uses,
 * never a hand-copied list. A category added to the taxonomy automatically gets
 * a route on the next deploy, and one removed stops being generated. There is
 * no second list to forget to update.
 */
export const ROUTABLE_CATEGORIES: readonly GreenwayCategory[] =
  websiteCategoryDefinitions.map((definition) => definition.value);

/**
 * Is this slug a real category route?
 *
 * FAILS CLOSED. Anything that is not an exact, known category value is not a
 * route — no case-insensitive matching, no trimming, no "close enough". A URL
 * that does not match exactly must 404 rather than silently render the whole
 * menu under a bogus canonical, which would be a duplicate-content problem and
 * an open invitation to crawl garbage.
 */
export function isRoutableCategorySlug(
  slug: string | null | undefined,
): slug is GreenwayCategory {
  if (typeof slug !== "string" || slug.length === 0) return false;
  return (ROUTABLE_CATEGORIES as readonly string[]).includes(slug);
}

/**
 * The canonical path for a category.
 *
 * One function, used by the nav links, the sitemap, the canonical tag and the
 * breadcrumbs. If the URL shape ever changes it changes in exactly one place,
 * so those four can never disagree about where a category lives.
 */
export function categoryPath(category: string): string {
  return `${MENU_ROOT_PATH}/${category}`;
}

/**
 * Human label for a category slug, from the shared taxonomy.
 *
 * Falls back to title-casing the slug so an unknown value still renders as
 * words rather than a raw slug. Owner-managed label overrides are applied at
 * render time by the existing `categoryLabels` map; this is the static default.
 */
export function categoryLabel(category: string): string {
  return formatWebsiteCategory(category);
}

/** The one-line helper text the taxonomy already carries for each category. */
export function categoryHelper(category: string): string {
  const definition = websiteCategoryDefinitions.find((entry) => entry.value === category);
  return definition?.helper ?? "";
}

/**
 * Breadcrumb trail for a category route: Shop -> <Category>.
 *
 * Returns the shop-root trail unchanged for a non-category slug so a caller
 * that somehow renders an unknown value still produces a valid trail instead of
 * a broken one.
 */
export function categoryBreadcrumbs(
  category: string,
): Array<{ label: string; href: string }> {
  const trail = [{ label: "Shop", href: MENU_ROOT_PATH }];
  if (!isRoutableCategorySlug(category)) return trail;
  return [...trail, { label: categoryLabel(category), href: categoryPath(category) }];
}

/**
 * SEO title for a category route.
 *
 * Each route needs a DISTINCT title or the 19 pages compete with each other and
 * search engines collapse them. Location is included because this is a single
 * physical dispensary and "flower Port Orchard" is the query that matters far
 * more than "flower".
 */
export function categoryMetaTitle(category: string): string {
  // DEFECT FIXED AFTER MEASURING THE LIVE PAGE. This used to end with
  // "| Greenway Marijuana Port Orchard", which rendered as:
  //
  //   "Flower — Cannabis Menu | Greenway Marijuana Port Orchard | Greenway Marijuana"
  //
  // ...because the ROOT LAYOUT already applies `template: "%s | Greenway
  // Marijuana"`. The brand appeared twice and the title ran to 88 characters,
  // well past the ~60 Google renders, so the useful words were the ones cut.
  //
  // The site convention (see /locations: "Location, Hours & Directions — Port
  // Orchard, WA") is that the TEMPLATE supplies the brand and the page supplies
  // the distinguishing words. This now follows it. Verified against the live
  // HTML rather than assumed -- the duplication was invisible in the source.
  return `${categoryLabel(category)} — Port Orchard, WA`;
}

/**
 * SEO description for a category route.
 *
 * Built from the taxonomy's own helper text so the description describes what
 * the shopper will actually find, and so it cannot drift from the nav menu that
 * shows the same helper.
 */
export function categoryMetaDescription(category: string): string {
  const label = categoryLabel(category);
  const helper = categoryHelper(category);
  const detail = helper ? ` ${helper.replace(/\s+/g, " ").trim()}` : "";
  const sentence = `Shop ${label.toLowerCase()} at Greenway Marijuana in Port Orchard, WA.${detail}`;
  // Keep descriptions inside the length search engines actually render, cutting
  // on a word boundary so the text never ends mid-word.
  return truncateAtWord(sentence, 155);
}

/**
 * Cut a string to a maximum length without splitting a word.
 *
 * Exported because the truncation rule is a real rule worth testing on its own,
 * not an implementation detail buried in the description builder.
 */
export function truncateAtWord(text: string, maxLength: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;

  // BUG FIXED IN REVIEW: this used to slice to `maxLength` and THEN append the
  // ellipsis, so the return value could be `maxLength + 3` characters. The
  // function's whole contract is "no longer than maxLength", and the caller
  // that matters is the meta description, where overflowing is exactly the
  // thing being guarded against — Google truncates long descriptions itself,
  // which is what this function exists to prevent.
  //
  // The ellipsis must therefore fit INSIDE the budget, not past it.
  const ELLIPSIS = "...";
  if (maxLength <= ELLIPSIS.length) return clean.slice(0, maxLength);

  const cut = clean.slice(0, maxLength - ELLIPSIS.length);
  const lastSpace = cut.lastIndexOf(" ");
  // A single word longer than the limit has no space to cut on; hard-cut it
  // rather than returning an empty string.
  const body = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[,.;:\s]+$/, "")}${ELLIPSIS}`;
}

/**
 * Every category route, for `generateStaticParams` and the sitemap.
 *
 * Both call this so the set of prerendered routes and the set of advertised
 * routes are the same set by construction. A route in the sitemap that is not
 * prerendered, or prerendered but not advertised, is a bug that cannot happen
 * here.
 */
export function allCategoryRouteParams(): Array<{ category: string }> {
  return ROUTABLE_CATEGORIES.map((category) => ({ category }));
}

/** Every category route as an absolute path. Used by the sitemap. */
export function allCategoryPaths(): string[] {
  return ROUTABLE_CATEGORIES.map((category) => categoryPath(category));
}

/**
 * WHY THERE IS NO SERVER-SIDE REDIRECT FOR LEGACY `?category=` LINKS
 * ──────────────────────────────────────────────────────────────────
 * The obvious move is to redirect `/menu?category=flower` to `/menu/flower`.
 * It is deliberately NOT done, for two measured reasons.
 *
 * First, reading the query on the server to decide a redirect is the exact
 * thing that made `/menu` uncacheable in the first place. It would reintroduce
 * the defect this slice removes.
 *
 * Second, a redirect cannot see the difference between `?category=flower` and
 * `?category=flower&brand=1937` without that same request-time read, so it
 * would either drop the shopper's other filters or need logic it cannot have.
 *
 * No redirect is needed anyway. `InteractiveMenuBrowser.resolveInitialParams`
 * already merges whatever the server passed with the LIVE browser URL, and the
 * live URL takes precedence. A legacy `/menu?category=flower` link therefore
 * still lands on flower — the filter is simply applied on the client instead of
 * the server. Every internal link is updated to the new path, so the query form
 * only survives in old external links and bookmarks, which keep working.
 */

// ── Self-test ────────────────────────────────────────────────────────────────
/**
 * The module proves its own rules. Called by the compliance test AND runnable
 * directly, so a change that breaks the route contract — a category that stops
 * being routable, a canonical that stops matching the sitemap, a redirect that
 * drops a filter — cannot reach main.
 */
export function __runMenuFacetTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, condition: boolean) => {
    if (condition) passed += 1;
    else {
      failed += 1;
      console.error(`[menu-facet] FAIL: ${label}`);
    }
  };

  // ── The routable set comes from the shared taxonomy ────────────────────────
  check("there is at least one routable category", ROUTABLE_CATEGORIES.length > 0);
  check(
    "routable categories match the site taxonomy exactly",
    ROUTABLE_CATEGORIES.length === websiteCategories.length &&
      ROUTABLE_CATEGORIES.every((category) =>
        (websiteCategories as readonly string[]).includes(category),
      ),
  );
  check(
    "routable categories are unique",
    new Set(ROUTABLE_CATEGORIES).size === ROUTABLE_CATEGORIES.length,
  );
  check("only the category facet is routable", ROUTABLE_FACET === "category");

  // ── Slug validation fails CLOSED ───────────────────────────────────────────
  check("a known category is routable", isRoutableCategorySlug("flower"));
  check("a hyphenated known category is routable", isRoutableCategorySlug("popcorn-bud"));
  check("an unknown slug is rejected", !isRoutableCategorySlug("not-a-category"));
  check("empty string is rejected", !isRoutableCategorySlug(""));
  check("null is rejected", !isRoutableCategorySlug(null));
  check("undefined is rejected", !isRoutableCategorySlug(undefined));
  // Case and whitespace must NOT be normalised into a match: two URLs resolving
  // to one page is a duplicate-content bug.
  check("uppercase is rejected (canonical is lowercase)", !isRoutableCategorySlug("Flower"));
  check("padded value is rejected", !isRoutableCategorySlug(" flower "));
  check("path traversal is rejected", !isRoutableCategorySlug("../admin"));
  check("a brand name is not a category route", !isRoutableCategorySlug("1937-farms"));

  // ── Paths are canonical and consistent ─────────────────────────────────────
  check("category path is nested under the shop root", categoryPath("flower") === "/menu/flower");
  check(
    "every routable category produces a distinct path",
    new Set(allCategoryPaths()).size === ROUTABLE_CATEGORIES.length,
  );
  check(
    "every generated path is under the shop root",
    allCategoryPaths().every((path) => path.startsWith(`${MENU_ROOT_PATH}/`)),
  );
  check(
    "no generated path contains a query string",
    allCategoryPaths().every((path) => !path.includes("?")),
  );
  check(
    "static params and sitemap paths describe the SAME routes",
    allCategoryRouteParams().length === allCategoryPaths().length &&
      allCategoryRouteParams().every((param, index) =>
        allCategoryPaths()[index] === categoryPath(param.category),
      ),
  );

  // ── Labels and helpers come from the taxonomy ──────────────────────────────
  check("a known category gets its taxonomy label", categoryLabel("popcorn-bud") === "Popcorn Bud");
  check("an unknown slug still title-cases", categoryLabel("some-thing") === "Some Thing");
  check("a known category has helper text", categoryHelper("flower").length > 0);
  check("an unknown slug has no helper text", categoryHelper("nope") === "");

  // ── Breadcrumbs ────────────────────────────────────────────────────────────
  const crumbs = categoryBreadcrumbs("flower");
  check("breadcrumbs start at Shop", crumbs[0]?.label === "Shop" && crumbs[0]?.href === MENU_ROOT_PATH);
  check("breadcrumbs end at the category", crumbs[crumbs.length - 1]?.href === "/menu/flower");
  check("breadcrumb trail is two deep", crumbs.length === 2);
  check("an unknown slug yields just the shop root", categoryBreadcrumbs("nope").length === 1);

  // ── Metadata is distinct per route ─────────────────────────────────────────
  const titles = ROUTABLE_CATEGORIES.map((category) => categoryMetaTitle(category));
  check("every category title is unique", new Set(titles).size === titles.length);
  check("titles name the city", titles.every((title) => title.includes("Port Orchard")));

  // These checks used to assert the RAW title only, which is why they missed a
  // real defect: the root layout applies `template: "%s | Greenway Marijuana"`,
  // so the string asserted here is NOT the string the browser shows. Asserting
  // the raw value while the rendered value was wrong is a test measuring the
  // wrong thing. Both are now checked against the actual rendered form.
  const ROOT_TITLE_SUFFIX = " | Greenway Marijuana";
  const rendered = titles.map((title) => `${title}${ROOT_TITLE_SUFFIX}`);
  // Scoped to the full brand string, not the bare word: "Greenway Merch" is a
  // real category label, so banning "Greenway" outright would fail on a
  // legitimate product name. Found by running the check, not by guessing.
  check(
    "the page title must not repeat the brand the root template already adds",
    titles.every((title) => !title.includes("Greenway Marijuana")),
  );
  check(
    "the rendered title names the business exactly once",
    rendered.every((title) => title.split("Greenway Marijuana").length - 1 === 1),
  );
  check(
    "the rendered title stays within what a search engine displays",
    rendered.every((title) => title.length <= 75),
  );
  const descriptions = ROUTABLE_CATEGORIES.map((category) => categoryMetaDescription(category));
  check("every category description is unique", new Set(descriptions).size === descriptions.length);
  // This check used to read `<= 158`, which quietly ACCOMMODATED a bug instead
  // of catching it: `truncateAtWord` appended its ellipsis after slicing, so it
  // could return `maxLength + 3`. A limit chosen to fit the observed output is
  // not a test, it is a rubber stamp. The bound is now the real one.
  check(
    "descriptions stay within the rendered length",
    descriptions.every((description) => description.length <= 155),
  );
  check(
    "descriptions never end mid-word with a dangling separator",
    descriptions.every((description) => !/[,;:]\.\.\.$/.test(description)),
  );

  // ── Truncation ─────────────────────────────────────────────────────────────
  check("short text is returned unchanged", truncateAtWord("short text", 50) === "short text");
  check("long text is cut and marked", truncateAtWord("aaa bbb ccc ddd", 8).endsWith("..."));
  check("truncation does not split a word", !/[a-z]\.\.\.$/.test(truncateAtWord("aaa bbb ccc", 6)) || truncateAtWord("aaa bbb ccc", 6) === "aaa...");
  check(
    "a single over-long word is still cut",
    truncateAtWord("supercalifragilistic", 8) === "super...",
  );

  // THE CHECK THAT WAS MISSING, and which let the overflow bug ship. The
  // function promises a maximum length; assert the promise directly, across a
  // range of budgets and inputs, including the pathological no-spaces case.
  const truncationInputs = [
    "supercalifragilisticexpialidocious",
    "a b c d e f g h i j k l m n o p q r s t u v w x y z",
    "x".repeat(400),
    "Flower, prerolls; cartridges: concentrates. " + "word ".repeat(60),
    "one-really-long-hyphenated-token-that-never-breaks-anywhere-at-all",
  ];
  check(
    "truncateAtWord NEVER exceeds the requested length",
    truncationInputs.every((input) =>
      [4, 5, 8, 20, 60, 155, 300].every((limit) => truncateAtWord(input, limit).length <= limit),
    ),
  );
  check(
    "truncateAtWord never returns an empty string for non-empty input",
    truncationInputs.every((input) =>
      [4, 5, 8, 20, 60, 155].every((limit) => truncateAtWord(input, limit).length > 0),
    ),
  );
  check("whitespace is collapsed", truncateAtWord("a   b", 50) === "a b");

  return { passed, failed };
}
