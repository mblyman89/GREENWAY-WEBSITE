/**
 * tests/compliance/d224-menu-card-fallback.test.ts  (D224)
 *
 * Owner: "I want to be able to set a fallback image to be used for products
 * when one isn't specifically set to that products menu card yet. There
 * should be one image per website category, when set, automatically shows on
 * all cards in that category without a product image set."
 *
 *   1. The pure core: self-tests + the ladder (own photo always wins; the
 *      fallback is always marked imageIsFallback; final category decides).
 *   2. Migration 0355: one row per website category, RLS on, service role
 *      only, PG check registered, MIGRATIONS_TO_RUN entry, factory reset KEEP.
 *   3. The page: in the Admin nav, guarded by the same permission it is
 *      advertised under, upload + library pick + remove, audited, caches cleared.
 *   4. Wiring pins: every card surface runs the overlay AFTER the image
 *      resolver and the category re-file; register info card; admin product
 *      page; media where-used; the syndication feed stays exact-photo only.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  __runMenuCardFallbackTests,
  applyMenuCardFallbacks,
  pickWithCategoryFallback,
  coverageByCategory,
  fallbackPageRows,
  FALLBACK_CATEGORIES,
  MENU_CARD_FALLBACK_PAGE,
  parseFallbackCategory,
} from "@/lib/menu/menu-card-fallback-core";
import { websiteCategoryDefinitions } from "@/lib/pos/category-taxonomy";
import { adminNav } from "@/components/admin/admin-nav-data";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("D224 core", () => {
  it("self-tests pass", () => {
    const r = __runMenuCardFallbackTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(70); // D225 grew the suite
  });
  it("is registered in the pure self-test runner with its exact count", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain(
      'assertRan("menu-card-fallback-core", __runMenuCardFallbackTests(), 70);',
    );
  });
  it("one slot per website category, never a POS category", () => {
    expect(FALLBACK_CATEGORIES).toEqual(websiteCategoryDefinitions.map((d) => d.value));
    expect(parseFallbackCategory("Flower")).toBe("flower");
    expect(parseFallbackCategory("Usable Marijuana")).toBeNull();
  });
  it("own photo wins, blank and generic substitutes are replaced, always badged", () => {
    const urls = new Map([["flower", "https://cdn/f.webp"]]);
    const out = applyMenuCardFallbacks(
      [
        { category: "flower", imageUrl: "https://own.webp", imageIsFallback: false },
        { category: "flower" },
        { category: "flower", imageUrl: "https://generic.webp", imageIsFallback: true },
        { category: "vapes" },
      ],
      urls,
    );
    expect(out[0]).toEqual({ category: "flower", imageUrl: "https://own.webp", imageIsFallback: false });
    expect(out[1]).toMatchObject({ imageUrl: "https://cdn/f.webp", imageIsFallback: true });
    expect(out[2]).toMatchObject({ imageUrl: "https://cdn/f.webp", imageIsFallback: true });
    expect(out[3]).toEqual({ category: "vapes" });
  });
  it("one-product form for the register card and admin page", () => {
    expect(pickWithCategoryFallback({ url: "own", source: "exact", isFallback: false }, "fb")).toMatchObject({ url: "own" });
    expect(pickWithCategoryFallback(null, "fb")).toEqual({ url: "fb", source: "website_category", isFallback: true });
    expect(pickWithCategoryFallback(null, null)).toBeNull();
  });
  it("the page lists all categories with live coverage", () => {
    const cov = coverageByCategory([{ category: "flower" }, { category: "flower", imageUrl: "x", imageIsFallback: false }]);
    const rows = fallbackPageRows([], [], cov);
    expect(rows).toHaveLength(websiteCategoryDefinitions.length);
    expect(rows.find((r) => r.category === "flower")?.coverage).toEqual({ cards: 2, withoutOwnPhoto: 1 });
    expect(rows.find((r) => r.category === "flower")?.pictures).toEqual([]); // D225: a list per category
  });
});

describe("D224 migration 0355", () => {
  const sql = read("supabase/migrations/0355_menu_card_fallback_images.sql");
  it("one row per website category, keyed and constrained", () => {
    expect(sql).toMatch(/create table if not exists public\.menu_card_fallback_images/);
    expect(sql).toMatch(/website_category text primary key/);
    for (const d of websiteCategoryDefinitions) expect(sql).toContain(`'${d.value}'`);
    expect(sql).toContain("references public.media_assets(id) on delete cascade");
  });
  it("RLS on, revoked from public roles, exact verbs for the service role", () => {
    expect(sql).toContain("alter table public.menu_card_fallback_images enable row level security;");
    expect(sql).toContain("revoke all on table public.menu_card_fallback_images from public, anon, authenticated;");
    expect(sql).toContain("grant select, insert, update, delete on table public.menu_card_fallback_images to service_role;");
  });
  it("rollback, PG check, run list, schema snapshot, factory reset", () => {
    expect(existsSync(path.join(ROOT, "supabase/rollbacks/0355_menu_card_fallback_images.rollback.sql"))).toBe(true);
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toContain("menu-card-fallback-0355-pg-check.sql");
    expect(read("scripts/recon/menu-card-fallback-0355-pg-check.sql")).toContain("MENU CARD FALLBACK 0355 CHECK PASSED");
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("0355_menu_card_fallback_images");
    expect(read("src/lib/admin/schema-tables.ts")).toContain("menu_card_fallback_images");
    expect(read("src/lib/accounting/factory-reset-core.ts")).toContain("menu_card_fallback_images");
    expect(read("src/lib/platform/db-contract.generated.json")).toContain('"menu_card_fallback_images"');
  });
});

describe("D224 the admin page", () => {
  const page = read("src/app/admin/menu-card-fallbacks/page.tsx");
  const actions = read("src/app/admin/menu-card-fallbacks/actions.ts");
  it("is in the Admin menu under the same permission the page enforces", () => {
    const nav = adminNav.find((n) => n.href === MENU_CARD_FALLBACK_PAGE);
    expect(nav).toBeTruthy();
    expect(nav?.group).toBe("Admin");
    expect(nav?.permission).toBe("products.enrich");
    expect(page).toContain('await requirePermission("products.enrich");');
  });
  it("upload, choose from the library, remove", () => {
    expect(page).toContain("action={uploadFallbackAction}");
    expect(page).toContain("action={pickFallbackAction}");
    expect(page).toContain("action={clearFallbackAction}");
    expect(page).toContain("readLibraryPickerAssets(scope, { query })");
    expect(page).toContain('data-testid="fallback-migration-missing"');
  });
  it("every action is guarded, byte-checked, audited, ledgered and clears the menu caches", () => {
    // D225 reshaped these: five actions share one afterChange (audit + ledger + caches).
    expect(actions.startsWith('"use server";')).toBe(true);
    expect(actions.match(/await requirePermission\(PERMISSION\)/g)?.length).toBe(5);
    expect(actions).toContain("checkFileSignature(file.type");
    expect(actions).toContain("fallbackUploadProblem(file, MEDIA_UPLOAD_MAX_BYTES)");
    expect(actions).toContain("await fallbackMediaExists(mediaId)");
    expect(actions).toContain('"menu_card_fallback.set"');
    expect(actions).toContain('"menu_card_fallback.cleared"');
    expect(actions).toContain("recordUsage(id, MENU_CARD_FALLBACK_ENTITY, category, fallbackUsageField(id))");
    expect(actions).toContain("clearUsage(MENU_CARD_FALLBACK_ENTITY, category, MENU_CARD_FALLBACK_FIELD)");
    expect(actions.match(/revalidatePublicMenuSurfaces\(\);/g)?.length).toBe(1);
  });
});

describe("D224 wiring: every place a menu card picture shows", () => {
  it("server: snapshot cached for a minute, tagged, failure never stored", () => {
    const s = read("src/lib/menu/menu-card-fallback-server.ts");
    expect(s).toContain('import "server-only";');
    expect(s).toContain("revalidate: PUBLIC_SNAPSHOT_TTL_SECONDS");
    expect(s).toContain("tags: [MENU_CACHE_TAG]");
  });
  it("shop grid + category pages: outermost, after the re-file", () => {
    expect(read("src/components/menu/ShopPage.tsx")).toContain(
      "const enrichedMenuItems = await withMenuCardFallbacks(await withProductTags(await withCategoryOverride(",
    );
  });
  it("home + specials: after the image resolver", () => {
    for (const f of ["src/app/(site)/page.tsx", "src/app/(site)/specials/page.tsx"]) {
      expect(read(f)).toContain(".then((items) => withResolvedImages(items)).then((items) => withMenuCardFallbacks(items))");
    }
  });
  it("product page + its related rail", () => {
    const s = read("src/app/(site)/menu/products/[id]/page.tsx");
    expect(s).toContain(
      ": await withMenuCardFallbacks(await withProductTags(await withCategoryOverride(await withDohCompliance(await withMenuProfile(await withResolvedImages([baseItem]))))));",
    );
    expect(s).toContain("await withMenuCardFallbacks(await withResolvedImages(selection.items))");
    // a fallback is never offered to Google as the product photo
    expect(s).toContain("item.imageUrl && !item.imageIsFallback ? imageObjectFor(");
  });
  it("register info card + admin product page use the same ladder", () => {
    expect(read("src/app/api/pos/product-image/route.ts")).toContain(
      "pickWithCategoryFallback(ladder, await menuCardFallbackUrlForProduct(item.id, item.category))",
    );
    const cc = read("src/lib/enrichment/command-center.ts");
    expect(cc).toContain("pickWithCategoryFallback(ladderImage, categoryFallbackUrl)");
    expect(read("src/app/admin/products/[key]/page.tsx")).toContain("fallbackSourceLabel(center.liveImage.source)");
  });
  it("links: media where-used, KB fallback images", () => {
    expect(read("src/app/admin/media/[id]/page.tsx")).toContain('u.entity_type === "menu_card_fallback"');
    expect(read("src/app/admin/knowledge-base/images/page.tsx")).toContain('href="/admin/menu-card-fallbacks"');
  });
  it("the image sitemap and the syndication feed stay exact-photo only", () => {
    expect(read("src/app/sitemap.ts")).toContain("isFallback: item.imageIsFallback");
    expect(read("src/lib/syndication/feed-source.ts")).not.toContain("menu-card-fallback");
  });
});
