/**
 * SLICE 116 — Shop page layout: filters hug left, wider cards, 4-up rows.
 *
 * Michael (+ screenshot): the filters section should hug the LEFT, the product
 * cards should be wider and fill all the way to the RIGHT (using the dead space
 * on large monitors), STILL four cards per row, with the category heading
 * tracking left and the search + sort tracking right so alignment holds. Mobile
 * and tablet must be untouched.
 *
 * NEVER GUESS contracts under test (source-markup pins so a future refactor
 * can't silently regress the layout):
 *  - A single width token `--shop-max` is the one source of truth for the shop
 *    content width, and the menu page + browser cage both consume it.
 *  - The product-card grids are 4-up at desktop (`lg:grid-cols-4`) with the
 *    tablet 2-up (`sm:grid-cols-2`) kept; the old 3-up (`lg:grid-cols-3
 *    2xl:grid-cols-4`) is gone (so cards grow wide instead of capping at 3).
 *  - The two-column sidebar track (`lg:grid-cols-[280px_1fr]`) and the toolbar
 *    (heading left / search + sort right, `justify-between`) are preserved.
 *  - The shared Breadcrumbs component keeps its 88rem default for every other
 *    page, but exposes a `maxWidthClassName` prop, and the menu page passes the
 *    wider shop width so the crumb aligns with the hero + cards.
 *
 * Also pins the tiny cosmetic fix folded into this slice: the Legal Policies
 * editor page-title input is themed (no `bg-white`/`text-black`).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

const GLOBALS = read("src/app/globals.css");
// SLICE H: `/menu` and `/menu/[category]` render through one shared component,
// so the shop's width-capped wrappers live there now. The route files are thin
// entry points. Pointing at the renderer keeps this guard covering BOTH routes.
const MENU_PAGE = read("src/components/menu/ShopPage.tsx");
const MENU_ROUTE = read("src/app/menu/page.tsx");
const CATEGORY_ROUTE = read("src/app/menu/[category]/page.tsx");
const BROWSER = read("src/components/menu/InteractiveMenuBrowser.tsx");
const CRUMBS = read("src/components/site/Breadcrumbs.tsx");
const LEGAL = read("src/app/admin/legal-policies/page.tsx");

describe("SLICE 116 — shop width token", () => {
  it("defines a single --shop-max token in :root", () => {
    expect(GLOBALS).toContain("--shop-max: 120rem;");
  });

  it("menu page consumes the token for hero, banners, and suspense (3 wrappers)", () => {
    // SLICE F2 moved the Suspense fallback's wrappers out of this file and into
    // the SHARED skeleton (src/components/menu/MenuSkeleton.tsx), so that the
    // navigation placeholder (src/app/menu/loading.tsx) and the streaming
    // placeholder are the same markup and cannot drift apart.
    //
    // The token was NOT dropped — it moved. So the invariant is asserted across
    // both files that now render the shop's width-capped wrappers. Counting only
    // page.tsx would fail for a refactor that improved the code, which would
    // make this test an obstacle rather than a guard.
    const skeleton = read("src/components/menu/MenuSkeleton.tsx");
    const shell = read("src/lib/menu/menu-skeleton-core.ts");
    const countIn = (source: string) =>
      (source.match(/max-w-\[var\(--shop-max\)\]/g) || []).length;

    expect(countIn(MENU_PAGE) + countIn(skeleton) + countIn(shell)).toBeGreaterThanOrEqual(3);

    // The page itself must still cage its own banner block and breadcrumb.
    expect(countIn(MENU_PAGE)).toBeGreaterThanOrEqual(2);

    // The old fixed 88rem cage must be gone from BOTH the page and the skeleton.
    expect(MENU_PAGE).not.toContain("mx-auto max-w-[88rem]");
    expect(skeleton).not.toContain("mx-auto max-w-[88rem]");
  });

  it("browser cage consumes the token (no fixed 88rem cage)", () => {
    expect(BROWSER).toContain("max-w-[var(--shop-max)]");
    expect(BROWSER).not.toContain("max-w-[88rem]");
  });
});

describe("SLICE 116 — 4-up product grids at desktop", () => {
  it("every product-card grid is sm:2-up then lg:4-up", () => {
    const fourUp = (BROWSER.match(/grid gap-5 sm:grid-cols-2 lg:grid-cols-4/g) || []).length;
    expect(fourUp).toBe(5);
  });

  it("the old 3-up (lg:grid-cols-3 2xl:grid-cols-4) is fully removed", () => {
    expect(BROWSER).not.toContain("lg:grid-cols-3 2xl:grid-cols-4");
    expect(BROWSER).not.toContain("lg:grid-cols-3");
  });

  it("keeps the 280px sidebar track and the flex justify-between toolbar", () => {
    expect(BROWSER).toContain("lg:grid-cols-[280px_1fr]");
    expect(BROWSER).toContain("sm:justify-between");
  });
});

describe("SLICE 116 — breadcrumb alignment (non-breaking, opt-in)", () => {
  it("Breadcrumbs keeps its 88rem default for every other page", () => {
    expect(CRUMBS).toContain('maxWidthClassName = "max-w-[88rem]"');
    expect(CRUMBS).toContain("${maxWidthClassName}");
  });

  it("only the menu page opts into the wider shop width", () => {
    expect(MENU_PAGE).toContain('maxWidthClassName="max-w-[var(--shop-max)]"');
  });

  it("SLICE H: both shop routes render through the shared renderer that carries the width", () => {
    // Without this, a route could stop calling <ShopPage /> and render its own
    // markup: the assertion above would still pass (the shared file is
    // unchanged) while the live page silently lost the shop width. Each route
    // must both IMPORT and RENDER the shared component.
    for (const [name, source] of [
      ["/menu", MENU_ROUTE],
      ["/menu/[category]", CATEGORY_ROUTE],
    ] as const) {
      expect(source, `${name} does not import ShopPage`).toMatch(
        /import\s*\{[^}]*\bShopPage\b[^}]*\}\s*from\s*["']@\/components\/menu\/ShopPage["']/,
      );
      expect(source, `${name} does not render <ShopPage>`).toMatch(/<ShopPage[\s>]/);
    }
  });
});

describe("SLICE 116 — Legal Policies title input themed (cosmetic pre-fix)", () => {
  it("the page-title input no longer uses the off-theme white background", () => {
    expect(LEGAL).not.toContain("bg-white px-3 py-2 text-sm text-black");
    // and uses the canonical dark admin surface token instead
    expect(LEGAL).toContain("bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)]");
  });
});
