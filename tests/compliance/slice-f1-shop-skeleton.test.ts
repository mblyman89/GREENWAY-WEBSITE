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
    const skeleton = stripComments(read("src/app/menu/loading.tsx"));
    expect(skeleton).not.toContain("film-strip");
    expect(skeleton).not.toContain("md:grid-cols-3");
  });

  it("the skeleton renders a shop: filter rail plus a product grid", () => {
    const skeleton = read("src/app/menu/loading.tsx");
    expect(skeleton).toContain("<aside");
    expect(skeleton).toContain("SHOP_CARD_GRID");
    expect(skeleton).toContain("skeletonCardKeys");
  });

  it("the skeleton reads its geometry from the pinned core, not hard-coded copies", () => {
    // Hard-coded duplicates are how a skeleton silently drifts out of sync with
    // the component it stands in for. Importing the constants means the
    // self-test above is actually guarding the rendered markup.
    const skeleton = read("src/app/menu/loading.tsx");
    expect(skeleton).toContain('from "@/lib/menu/menu-skeleton-core"');
    expect(skeleton).toContain("SHOP_GRID_SHELL");
    expect(skeleton).toContain("CARD_MIN_HEIGHT");
    expect(skeleton).toContain("CARD_IMAGE_HEIGHT");
  });

  it("the skeleton performs no data access", () => {
    // A skeleton that awaits anything is no longer a skeleton. It must be a
    // synchronous component so it can flush with the first byte.
    const skeleton = read("src/app/menu/loading.tsx");
    expect(skeleton).not.toContain("await ");
    expect(skeleton).not.toContain("async function");
    expect(skeleton).not.toContain("loadLiveMenuItems");
    expect(skeleton).not.toContain("createClient");
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

  it("the ROOT skeleton is left untouched for every other route", () => {
    // /menu is the only route being retargeted. The home page and everything
    // else must keep the skeleton they already had.
    const rootLoading = read("src/app/loading.tsx");
    expect(rootLoading).toContain("film-strip");
    expect(rootLoading).toContain("md:grid-cols-3");
  });
});
