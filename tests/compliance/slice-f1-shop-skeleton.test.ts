import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  SHOP_GRID_SHELL,
  SHOP_CARD_GRID,
  CARD_MIN_HEIGHT,
  CARD_IMAGE_HEIGHT_BASE,
  CARD_IMAGE_HEIGHT_MD,
  SKELETON_CARD_COUNT,
  skeletonCardKeys,
  __runMenuSkeletonTests,
} from "@/lib/menu/menu-skeleton-core";

const repoRoot = resolve(__dirname, "..", "..");
const read = (relativePath: string) => readFileSync(resolve(repoRoot, relativePath), "utf8");

/**
 * Remove block comments, line comments, and JSX comments so assertions target
 * markup that actually renders rather than prose that merely describes it.
 */
function stripComments(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * SLICE F1 — the shop page must have its own skeleton.
 *
 * The defect these tests lock out: `/menu` had no `loading.tsx`, so Next.js
 * walked UP the tree and served the ROOT skeleton, which is shaped like the
 * HOME page. Shoppers saw a fake hero and three promo cards while waiting for
 * a product grid.
 *
 * The second thing locked in is GEOMETRY. A skeleton that is a different size
 * than the component replacing it causes a visible jump (layout shift). So the
 * skeleton's grid tracks and card metrics are asserted to match the values read
 * out of the real components.
 */
describe("Slice F1 — the shop page owns its loading skeleton", () => {
  it("the core module's own invariants hold", () => {
    const { passed, failed } = __runMenuSkeletonTests();
    expect(failed).toBe(0);
    expect(passed).toBeGreaterThan(0);
  });

  it("src/app/menu/loading.tsx exists", () => {
    // This is the whole point of the slice. Without this file the framework
    // falls back to the root home-shaped skeleton.
    expect(existsSync(resolve(repoRoot, "src/app/menu/loading.tsx"))).toBe(true);
  });

  it("the shop skeleton does NOT reuse the home page's shapes", () => {
    // `film-strip` and the 3-up promo row are the ROOT skeleton's signature.
    // If either appears in the RENDERED MARKUP here, the home-page shape has
    // leaked back in.
    //
    // Comments are stripped before asserting: this file's own documentation
    // explains the defect and necessarily names those shapes, and a prose
    // mention is not a rendered `<div>`. Stripping keeps the assertion aimed at
    // what actually reaches the browser.
    const loading = stripComments(read("src/app/menu/loading.tsx"));
    const skeleton = stripComments(read("src/components/menu/MenuSkeleton.tsx"));
    for (const source of [loading, skeleton]) {
      expect(source).not.toContain("film-strip");
      expect(source).not.toContain("md:grid-cols-3");
    }
  });

  it("the skeleton renders a shop: filter rail plus a product grid", () => {
    // SLICE F2 moved the markup into the SHARED skeleton so the navigation
    // placeholder and the streaming fallback are the same component.
    const skeleton = read("src/components/menu/MenuSkeleton.tsx");
    expect(skeleton).toContain("<aside");
    expect(skeleton).toContain("SHOP_CARD_GRID");
    expect(skeleton).toContain("skeletonCardKeys");
  });

  it("loading.tsx renders the shared shop skeleton", () => {
    // The route file must delegate, not re-implement. A second copy of the
    // markup is exactly how the two placeholders would drift apart.
    const loading = read("src/app/menu/loading.tsx");
    expect(loading).toContain('from "@/components/menu/MenuSkeleton"');
    expect(loading).toContain("ShopBrowserSkeleton");
  });

  it("the skeleton reads its geometry from the pinned core, not hard-coded copies", () => {
    // Hard-coded duplicates are how a skeleton silently drifts out of sync with
    // the component it stands in for. Importing the constants means the
    // self-test above is actually guarding the rendered markup.
    const skeleton = read("src/components/menu/MenuSkeleton.tsx");
    expect(skeleton).toContain('from "@/lib/menu/menu-skeleton-core"');
    expect(skeleton).toContain("SHOP_GRID_SHELL");
    expect(skeleton).toContain("CARD_MIN_HEIGHT");
    expect(skeleton).toContain("CARD_IMAGE_HEIGHT");
  });

  it("the skeleton performs no data access", () => {
    // A skeleton that awaits anything is no longer a skeleton. Both the route
    // file and the shared component must be synchronous so they flush with the
    // first byte.
    for (const path of ["src/app/menu/loading.tsx", "src/components/menu/MenuSkeleton.tsx"]) {
      const source = read(path);
      expect(source).not.toContain("await ");
      expect(source).not.toContain("async function");
      expect(source).not.toContain("loadLiveMenuItems");
      expect(source).not.toContain("createClient");
    }
  });

  it("the skeleton's grid tracks match InteractiveMenuBrowser's real shell", () => {
    // Read the REAL component and require the shared constant to be a literal
    // substring of it. This is the anti-drift guard: restyle the browser's grid
    // without updating the skeleton and this fails.
    const browser = read("src/components/menu/InteractiveMenuBrowser.tsx");
    expect(browser).toContain(SHOP_GRID_SHELL);
  });

  it("the skeleton's card grid matches the real product grid", () => {
    const browser = read("src/components/menu/InteractiveMenuBrowser.tsx");
    expect(browser).toContain(SHOP_CARD_GRID);
  });

  it("the skeleton's card metrics match the real ProductCardVisual", () => {
    // The image well's two breakpoint classes are not adjacent in the real
    // component (other utilities sit between them), so each is asserted on its
    // own. Both must be present for the placeholder to occupy the same height
    // as the card that replaces it.
    const card = read("src/components/menu/ProductCardVisual.tsx");
    expect(card).toContain(CARD_MIN_HEIGHT);
    expect(card).toContain(CARD_IMAGE_HEIGHT_BASE);
    expect(card).toContain(CARD_IMAGE_HEIGHT_MD);
  });

  it("paints enough cards to fill the viewport without being heavy itself", () => {
    expect(SKELETON_CARD_COUNT).toBeGreaterThanOrEqual(8);
    expect(SKELETON_CARD_COUNT).toBeLessThanOrEqual(12);
    expect(skeletonCardKeys()).toHaveLength(SKELETON_CARD_COUNT);
  });

  it("F2: the page component itself awaits nothing expensive before returning", () => {
    // THE CORE OF SLICE F2. Previously every await -- the catalog read and its
    // whole enrichment chain -- ran ABOVE the return, so <Suspense> had nothing
    // left to stream and the shell did not reach the browser until ~2.8s.
    //
    // The exported page may still await `searchParams` (cheap, no I/O, and
    // required for deep links). What it must NOT do is load the catalog before
    // returning its shell.
    const code = stripComments(read("src/app/menu/page.tsx"));
    const pageStart = code.indexOf("export default async function MenuPage");
    expect(pageStart).toBeGreaterThan(-1);
    const pageBody = code.slice(pageStart);

    for (const forbidden of [
      "loadLiveMenuItemsCached(",
      "withMenuProfile(",
      "withResolvedImages(",
      "withDisplayKnowledge(",
      "withDohCompliance(",
      "withCategoryOverride(",
      "loadCategoryLabelMap(",
      "getPageBanners(",
      "getShopCarouselForRender(",
    ]) {
      expect(pageBody).not.toContain(forbidden);
    }
  });

  it("F2: the expensive data work lives in a child below a Suspense boundary", () => {
    const code = stripComments(read("src/app/menu/page.tsx"));
    // The child that does the loading must exist...
    expect(code).toMatch(/async function MenuBrowserSection\s*\(/);
    // ...it must be the thing wrapped by Suspense...
    expect(code).toMatch(/<Suspense[\s\S]*?<MenuBrowserSection/);
    // ...and it must be what performs the catalog read.
    const childStart = code.indexOf("async function MenuBrowserSection");
    const childBody = code.slice(childStart, code.indexOf("export default async function MenuPage"));
    expect(childBody).toContain("loadLiveMenuItemsCached()");
  });

  it("F2: the Suspense fallback is the real shop skeleton, not a text placeholder", () => {
    // The old fallback was the string "Loading menu filters...". Even had it
    // rendered, it would have been a bare line of text where a shop should be.
    const code = stripComments(read("src/app/menu/page.tsx"));
    expect(code).not.toContain("Loading menu filters");
    expect(code).toMatch(/fallback=\{[\s\S]*?ShopBrowserSkeleton/);
  });

  it("F2: the shell (header, breadcrumbs, footer) renders outside the boundary", () => {
    // These are what make the first paint look like the real site. If they were
    // inside the Suspense boundary they would be withheld until the catalog
    // resolved -- which is precisely the old behavior.
    const code = stripComments(read("src/app/menu/page.tsx"));
    const suspenseStart = code.indexOf("<Suspense");
    expect(suspenseStart).toBeGreaterThan(-1);
    const beforeBoundary = code.slice(0, suspenseStart);
    expect(beforeBoundary).toContain("<Header />");
    expect(beforeBoundary).toContain("<Breadcrumbs");
  });

  it("the ROOT skeleton is left untouched for every other route", () => {
    // /menu is the only route being retargeted. The home page and everything
    // else must keep the skeleton they already had.
    const rootLoading = read("src/app/loading.tsx");
    expect(rootLoading).toContain("film-strip");
    expect(rootLoading).toContain("md:grid-cols-3");
  });
});
