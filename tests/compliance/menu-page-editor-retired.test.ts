/**
 * MIG-6 Slice 2 — the /admin/pages/menu page-builder editor is RETIRED.
 *
 * Michael's decision: the Shop (/menu) top banner is now the dedicated Shop
 * Banner carousel editor (/admin/content/shop-banner, SLICE A / SHOP-1) with up
 * to ten fully-editable slides. A second tier of "extra banners" under the
 * carousel is no longer needed — the carousel plus the Specials and Home promo
 * areas cover the store's promotional space with no extra room taken on the page.
 *
 * This retirement mirrors the loyalty and specials retirements before it:
 * removing the "menu" slug from PAGE_SECTION_CONFIG makes /admin/pages/menu ->
 * notFound (via [slug]/page.tsx's isValidPageSlug guard), so there is ONE clear
 * place to manage the Shop banner. The menu.hero.* copy blocks stay SEEDED and
 * are read via the public page's graceful fallback, so nothing on the public
 * /menu page breaks.
 *
 * NEVER GUESS contracts under test (source-markup pins so a future refactor
 * can't silently un-retire it):
 *  - PAGE_SECTION_CONFIG no longer defines a "menu" slug (only the comment may
 *    mention it), so isValidPageSlug("menu") is false.
 *  - The admin nav no longer carries a "Menu" -> /admin/pages/menu entry.
 *  - The Help FAQ no longer points at /admin/pages/menu (it points shoppers'
 *    editors at the Shop Banner editor instead).
 *  - The menu.hero.* content-block SEEDS survive (public page graceful fallback).
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { isValidPageSlug } from "@/lib/cms/page-sections-types";

const read = (rel: string) => readFileSync(rel, "utf8");

describe("MIG-6 Slice 2 — /admin/pages/menu is retired", () => {
  it("PAGE_SECTION_CONFIG no longer defines a menu slug", () => {
    const src = read("src/lib/cms/page-sections-types.ts");
    // Only the explanatory comment may mention menu, never a config key.
    expect(src).not.toContain('menu: { label: "Menu"');
  });

  it("isValidPageSlug('menu') is false (route -> notFound)", () => {
    expect(isValidPageSlug("menu")).toBe(false);
  });

  it("the admin nav no longer links to /admin/pages/menu", () => {
    const src = read("src/components/admin/admin-nav-data.ts");
    expect(src).not.toContain('href: "/admin/pages/menu"');
  });

  it("the Help FAQ points at the Shop Banner editor, not /admin/pages/menu", () => {
    const src = read("src/lib/admin/help-content.ts");
    expect(src).not.toContain('href: "/admin/pages/menu"');
    expect(src).toContain('href: "/admin/content/shop-banner"');
  });

  it("the menu.hero.* content blocks are still SEEDED (public fallback intact)", () => {
    const src = read("src/lib/cms/content-blocks-seed.ts");
    expect(src).toContain('block_key: "menu.hero.title"');
    expect(src).toContain('block_key: "menu.hero.subtitle"');
  });
});
