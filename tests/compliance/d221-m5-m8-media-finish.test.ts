/**
 * D221 M5 to M8 - undo auto-publish, find similar, library UI v2,
 * collections, search log, storefront image SEO, and the media library <->
 * review queue buttons.
 *
 * Owner (D221): "Please make sure there is a button from the media library
 * page to the review page and back please. Please finish the last slices of
 * work to be done now."
 *
 * The SQL side is executed for real by
 * scripts/recon/media-library-m5-0354-pg-check.sql in the migrations CI job.
 * These tests pin the pure rules and the wiring.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { __runLibraryV2CoreTests, parseBulkAction, BULK_ACTIONS } from "../../src/lib/media/library-v2-core";
import { __runImageSeoCoreTests, pickImageAlt, imageObjectFor, sitemapImages } from "../../src/lib/seo/image-seo-core";
import { __runImageRecommendCoreTests, parseImageSearchScope } from "../../src/lib/catalog/image-recommend-core";
import { __runLibraryPickerCoreTests, libraryPickerHref } from "../../src/lib/media/library-picker-core";
import { productSchema } from "../../src/lib/seo/seo";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("D221 navigation: media library <-> review queue", () => {
  it("the library header has a Review queue button", () => {
    const page = read("src/app/admin/media/page.tsx");
    expect(page).toContain('href="/admin/media/review" data-testid="media-review-queue-button"');
    expect(page).toContain("Review queue (");
    expect(page).toContain('href="/admin/media/collections"');
  });
  it("the review queue has a Back to media library button", () => {
    const page = read("src/app/admin/media/review/page.tsx");
    expect(page).toContain('data-testid="media-review-back-button"');
    expect(page).toContain("Back to media library");
    expect(page).toMatch(/href="\/admin\/media"/);
  });
  it("the collections page links back too", () => {
    expect(read("src/app/admin/media/collections/page.tsx")).toContain("Back to media library");
  });
});

describe("D221 migration 0354", () => {
  const sql = read("supabase/migrations/0354_media_library_m5_m8.sql");
  it("ships the undo, similar, collections and search log", () => {
    for (const n of [
      "function public.media_set_auto_publish(p_mode text, p_ids uuid[] default null)",
      "function public.media_similar(",
      "function public.media_search_summary(",
      "create table if not exists public.media_collections",
      "create table if not exists public.media_collection_items",
      "create table if not exists public.media_search_log",
      "'auto_reverted'",
    ]) {
      expect(sql).toContain(n);
    }
  });
  it("is service-role only and never deletes rows", () => {
    expect(sql).toContain("revoke all on function public.media_set_auto_publish(text, uuid[]) from public, anon, authenticated;");
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/\bdrop\s+table\b/i);
  });
  it("ships the editor-safe copy, the rollback and the pg-check", () => {
    expect(existsSync(join(root, "supabase/migrations/editor-safe/0354_media_library_m5_m8.EDITOR_SAFE.sql"))).toBe(true);
    expect(existsSync(join(root, "supabase/rollbacks/0354_media_library_m5_m8.rollback.sql"))).toBe(true);
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toContain("media-library-m5-0354-pg-check.sql");
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("0354_media_library_m5_m8.sql");
  });
});

describe("D221 pure cores", () => {
  it("self-tests pass", () => {
    expect(__runLibraryV2CoreTests().passed).toBeGreaterThanOrEqual(60);
    expect(__runImageSeoCoreTests().passed).toBeGreaterThanOrEqual(15);
    expect(__runImageRecommendCoreTests().passed).toBeGreaterThanOrEqual(35);
    expect(__runLibraryPickerCoreTests().passed).toBeGreaterThanOrEqual(37);
  });
  it("bulk actions are a closed list, and none of them attaches to a product", () => {
    expect([...BULK_ACTIONS].sort()).toEqual(["add-to-collection", "archive", "publish", "redescribe", "set-vendor", "undo-auto"]);
    expect(parseBulkAction("attach")).toBeNull();
    expect(parseBulkAction("delete")).toBeNull();
  });
  it("search scope + picker hrefs", () => {
    expect(parseImageSearchScope("brand")).toBe("brand");
    expect(parseImageSearchScope("x")).toBe("vendor");
    expect(libraryPickerHref("k", { searchIn: "all" })).toBe("/admin/products/k?lv=all#library");
  });
});

describe("D221 M7 actions", () => {
  const src = read("src/app/admin/media/library-actions.ts");
  it("every action needs media.manage and writes an audit row", () => {
    const fns = src.split("export async function ").slice(1);
    expect(fns.length).toBe(5);
    for (const f of fns) expect(f).toContain('requirePermission("media.manage")');
    expect(src).toContain("media.auto_publish_undone");
    expect(src).not.toMatch(/\.delete\(/);
  });
});

describe("D221 M6 search in onboarding and enrichment", () => {
  it("the enrichment picker has scope chips, find similar and why-chips", () => {
    const p = read("src/app/admin/products/[key]/MediaLibraryPicker.tsx");
    expect(p).toContain("data-testid={`library-search-in-${lv}`}");
    for (const chip of ['searchChip("vendor", "This vendor"', 'searchChip("brand", "This brand"', 'searchChip("all", "Everything"']) expect(p).toContain(chip);
    for (const id of ["library-find-similar", "library-search-chips", "library-search-results"]) {
      expect(p).toContain(id);
    }
    const page = read("src/app/admin/products/[key]/page.tsx");
    expect(page).toContain("readImageSearch({");
    expect(page).toContain('logMediaSearch("picker"');
  });
  it("the onboarding panel has search and find similar", () => {
    const p = read("src/components/admin/catalog/OnboardingImagesPanel.tsx");
    expect(p).toContain("onboarding-image-search");
    expect(p).toContain("onboarding-image-chips");
    expect(p).toContain("Find similar");
  });
});

describe("D221 M8 storefront image SEO", () => {
  it("alt text prefers seo_alt", () => {
    expect(pickImageAlt({ seo_alt: "Jar of Blue Dream" }, "Blue Dream")).toBe("Jar of Blue Dream");
    expect(pickImageAlt(null, "Blue Dream")).toBe("Blue Dream");
  });
  it("Product JSON-LD carries an ImageObject for the own photo", () => {
    const io = imageObjectFor("https://cdn.test/a.jpg", { seo_title: "Blue Dream jar", credit_text: "Acme" }, "Blue Dream");
    const s = productSchema({ id: "K", name: "Blue Dream", imageObject: io }) as { image?: { "@type": string; creditText?: string } };
    expect(s.image?.["@type"]).toBe("ImageObject");
    expect(s.image?.creditText).toBe("Acme");
    const plain = productSchema({ id: "K", name: "Blue Dream", image: "https://cdn.test/a.jpg" }) as { image?: unknown };
    expect(plain.image).toBe("https://cdn.test/a.jpg");
  });
  it("the PDP and sitemap are wired, fallback pictures excluded", () => {
    const pdp = read("src/app/(site)/menu/products/[id]/page.tsx");
    expect(pdp).toContain("imageSeoForUrl(item.imageUrl)");
    expect(pdp).toContain("!item.imageIsFallback ? imageObjectFor(");
    expect(pdp).toContain("alt={imageAlt || item.name}");
    const sm = read("src/app/sitemap.ts");
    expect(sm).toContain("sitemapImages(");
    expect(sitemapImages([{ url: "https://a/1.jpg", isFallback: true }])).toEqual([]);
  });
});

describe("D221 factory reset", () => {
  it("keeps the new tables", () => {
    const f = read("src/lib/accounting/factory-reset-core.ts");
    for (const t of ["media_collections", "media_collection_items", "media_search_log"]) {
      expect(f).toContain(`{ table: "${t}", disposition: "KEEP"`);
    }
  });
});
