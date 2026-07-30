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
const MENU_PAGE = read("src/app/menu/page.tsx");
const BROWSER = read("src/components/menu/InteractiveMenuBrowser.tsx");
const CRUMBS = read("src/components/site/Breadcrumbs.tsx");
const LEGAL = read("src/app/admin/legal-policies/page.tsx");

describe("SLICE 116 — shop width token", () => {
  it("defines a single --shop-max token in :root", () => {
    expect(GLOBALS).toContain("--shop-max: 120rem;");
  });

  it("menu page consumes the token for hero, banners, and suspense (3 wrappers)", () => {
    const count = (MENU_PAGE.match(/max-w-\[var\(--shop-max\)\]/g) || []).length;
    // 3 page wrappers + the breadcrumb prop value = 4 usages of the token.
    expect(count).toBeGreaterThanOrEqual(3);
    // The old fixed 88rem cage must be gone from the menu page.
    expect(MENU_PAGE).not.toContain("mx-auto max-w-[88rem]");
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
});

describe("SLICE 116 — Legal Policies title input themed (cosmetic pre-fix)", () => {
  it("the page-title input no longer uses the off-theme white background", () => {
    expect(LEGAL).not.toContain("bg-white px-3 py-2 text-sm text-black");
    // and uses the canonical dark admin surface token instead
    expect(LEGAL).toContain("bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)]");
  });
});
