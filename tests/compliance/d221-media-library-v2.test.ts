/**
 * D221 M1+M2 - media library v2: one row per file, provenance, vendor-scoped
 * suggestions, auto-publish of vendor-sourced assets.
 *
 * Owner (D221): "the reason there are so many duplicates is because when I
 * scrape a vendor menu, it often uses the same image for all products on that
 * menu ... if there is a smarter, better way to utilize the one image for
 * multiple products, then lets clean up all the duplicates" / "please change
 * agents.md to allow the ai to auto publish assets".
 *
 * The SQL side (fold, repoint, unique index, search, backfill) is executed for
 * real by scripts/recon/media-library-v2-0352-pg-check.sql in the migrations
 * CI job. These tests pin the app-side rules and the wiring.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTO_PUBLISH_REASON,
  VENDOR_SOURCE_PLATFORMS,
  contentHashFromStorageKey,
  isMissingColumn,
  isUniqueViolation,
  mediaMatchesQuery,
  provenancePatch,
  shouldAutoPublish,
} from "../../src/lib/media/provenance-core";
import {
  NAME_MATCH_MAX,
  NO_BRAND_CAP,
  OTHER_VENDOR_CAP,
  nameMatchScore,
  recommendImages,
  vendorMatch,
} from "../../src/lib/catalog/image-recommend-core";
import type { LibraryPickerAsset } from "../../src/lib/media/library-picker-core";
import { libraryPickerView } from "../../src/lib/media/library-picker-core";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MIG = read("supabase/migrations/0352_media_library_v2.sql");

const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";

function asset(over: Partial<LibraryPickerAsset> = {}): LibraryPickerAsset {
  return {
    id: over.id ?? "a1",
    filename: "gelato.jpg",
    title: "Gelato - Phat Panda (Cultivera)",
    alt_text: null,
    tags: ["cultivera", "product-image"],
    usage_type: "product",
    status: "published",
    mime_type: "image/jpeg",
    license_status: null,
    created_at: "2026-01-01T00:00:00Z",
    url: "https://x/y.jpg",
    ...over,
  };
}

describe("content hash", () => {
  it("reads the 16-hex hash out of a storage key, same as the 0352 trigger", () => {
    expect(contentHashFromStorageKey("product/abcdef0123456789-gelato.webp")).toBe("abcdef0123456789");
    expect(contentHashFromStorageKey("uploads/0123456789abcdef-x.png")).toBe("0123456789abcdef");
    expect(contentHashFromStorageKey("logo.png")).toBeNull();
    expect(contentHashFromStorageKey(null)).toBeNull();
    // the SQL trigger uses the same pattern
    expect(MIG).toContain("new.content_hash := substring(new.storage_key from '/([0-9a-f]{16})')");
  });
});

describe("auto-publish rule (AGENTS.md rule 3, amended D221)", () => {
  const ok = { platform: "cultivera", vendorId: V1, mimeType: "image/webp" };
  it("publishes a vendor-menu picture whose vendor is known", () => {
    expect(shouldAutoPublish(ok)).toBe(true);
    expect(shouldAutoPublish({ ...ok, mimeType: "application/pdf" })).toBe(true);
    for (const p of VENDOR_SOURCE_PLATFORMS) expect(shouldAutoPublish({ ...ok, platform: p })).toBe(true);
  });
  it("never publishes without a vendor, from an upload / AI / unknown source, a copy, or a flagged row", () => {
    expect(shouldAutoPublish({ ...ok, vendorId: null })).toBe(false);
    expect(shouldAutoPublish({ ...ok, platform: "upload" })).toBe(false);
    expect(shouldAutoPublish({ ...ok, platform: "ai" })).toBe(false);
    expect(shouldAutoPublish({ ...ok, platform: null })).toBe(false);
    expect(shouldAutoPublish({ ...ok, canonicalId: V2 })).toBe(false);
    expect(shouldAutoPublish({ ...ok, reviewState: "needs_review" })).toBe(false);
    expect(shouldAutoPublish({ ...ok, mimeType: "text/html" })).toBe(false);
  });
  it("never touches a row a person archived or already published", () => {
    expect(shouldAutoPublish({ ...ok, status: "archived" })).toBe(false);
    expect(shouldAutoPublish({ ...ok, status: "published" })).toBe(false);
  });
  it("matches the SQL rule in public.media_auto_publish()", () => {
    expect(MIG).toContain(`publish_reason = '${AUTO_PUBLISH_REASON}'`);
    expect(MIG).toMatch(/m\.platform in \('cultivera', 'growflow', 'leaflink', 'email', 'website'\)/);
    expect(MIG).toMatch(/m\.vendor_id is not null/);
    expect(MIG).toMatch(/m\.canonical_id is null/);
    expect(MIG).toMatch(/m\.review_state = 'ok'/);
  });
  it("AGENTS.md records the owner-authorized exception, and keeps attaching human", () => {
    const agents = read("AGENTS.md");
    expect(agents).toContain("please change agents.md to allow the ai to auto publish assets");
    expect(agents).toContain("vendor-source-auto");
    expect(agents).toMatch(/Attaching an asset to a live product[^.]*stays drafts-only/);
  });
});

describe("provenance patch is gap-fill only", () => {
  it("fills empty columns and never overwrites a set one", () => {
    const patch = provenancePatch(
      { vendor_id: null, product_name: "Kept Name", platform: "", category: null },
      { vendorId: V1, productName: "Menu Name", platform: "growflow", category: " Flower ", menuItemRef: "growflow:1" },
    );
    expect(patch).toEqual({ vendor_id: V1, platform: "growflow", category: "flower", menu_item_ref: "growflow:1" });
  });
  it("ignores blanks and nulls", () => {
    expect(provenancePatch({}, { vendorId: null, productName: "  " })).toEqual({});
    expect(provenancePatch({}, undefined)).toEqual({});
  });
});

describe("error classification", () => {
  it("unique violation = another save of the same file won", () => {
    expect(isUniqueViolation({ code: "23505", message: "x" })).toBe(true);
    expect(isUniqueViolation({ message: 'duplicate key value violates unique constraint "uq_media_assets_live_content_hash"' })).toBe(true);
    expect(isUniqueViolation({ code: "42501" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
  it("missing column = 0352 not applied yet (the app keeps working)", () => {
    expect(isMissingColumn({ code: "42703" })).toBe(true);
    expect(isMissingColumn({ code: "PGRST204" })).toBe(true);
    expect(isMissingColumn({ message: "column media_assets.content_hash does not exist" })).toBe(true);
    expect(isMissingColumn({ code: "23505" })).toBe(false);
  });
});

describe("media page search", () => {
  const m = {
    title: "IMG_2231",
    filename: "img.jpg",
    tags: ["cultivera"],
    product_name: "Gelato Cake 3.5g",
    visible_text: "PHAT PANDA indica",
    credit_text: "Phat Panda Farms",
  };
  it("every word must match, across the new fields", () => {
    expect(mediaMatchesQuery(m, "gelat 3.5")).toBe(true);
    expect(mediaMatchesQuery(m, "panda indica")).toBe(true);
    expect(mediaMatchesQuery(m, "gelato sativa")).toBe(false);
    expect(mediaMatchesQuery(m, "")).toBe(true);
  });
});

describe("same-vendor suggestions", () => {
  it("vendorMatch: same / other / unknown", () => {
    expect(vendorMatch({ vendor_id: V1 }, { vendorId: V1 })).toBe("same");
    expect(vendorMatch({ brand_id: V2 }, { brandId: V2 })).toBe("same");
    expect(vendorMatch({ vendor_id: V2 }, { vendorId: V1 })).toBe("other");
    expect(vendorMatch({ vendor_id: null }, { vendorId: V1 })).toBe("unknown");
    expect(vendorMatch({ vendor_id: V1 }, {})).toBe("unknown");
  });
  it("a picture filed under the product's own vendor ranks above the same picture from another vendor", () => {
    const product = { name: "Gelato", brand: "Phat Panda", vendorId: V1 };
    const mine = nameMatchScore(asset({ id: "m", vendor_id: V1 }), product).confidence;
    const theirs = nameMatchScore(asset({ id: "t", vendor_id: V2 }), product).confidence;
    expect(mine).toBeGreaterThan(theirs);
    expect(theirs).toBeLessThanOrEqual(OTHER_VENDOR_CAP);
    expect(mine).toBeLessThanOrEqual(NAME_MATCH_MAX);
  });
  it("a same-vendor picture may pass the no-brand cap; an unknown-vendor one may not", () => {
    const product = { name: "Gelato Cake", brand: "Phat Panda", vendorId: V1 };
    const bare = { title: "Gelato Cake", filename: "gc.jpg", tags: [] as string[] };
    expect(nameMatchScore(asset({ ...bare, vendor_id: null }), product).confidence).toBeLessThanOrEqual(NO_BRAND_CAP);
    expect(nameMatchScore(asset({ ...bare, vendor_id: V1 }), product).confidence).toBeGreaterThan(NO_BRAND_CAP);
  });
  it("the menu's product name and the package text count as asset words", () => {
    const a = asset({ title: "IMG_0001", filename: "img.jpg", tags: [], product_name: "Wedding Cake", visible_text: "PHAT PANDA" });
    expect(nameMatchScore(a, { name: "Wedding Cake", brand: "Phat Panda" }).confidence).toBeGreaterThan(80);
    const v = recommendImages({ assets: [a], product: { name: "Wedding Cake", brand: "Phat Panda" } });
    expect(v.items.map((i) => i.id)).toEqual(["a1"]);
    const p = libraryPickerView({ assets: [a], query: "wedding", scope: "all", galleryIds: [], productName: "Wedding Cake" });
    expect(p.tiles).toHaveLength(1);
  });
});

describe("wiring", () => {
  it("the harvest dedupes on content_hash with order+limit (never maybeSingle on a set that can hold copies)", () => {
    const h = read("src/lib/media/harvest.ts");
    expect(h).toContain('.eq("content_hash", hash16)');
    expect(h).not.toMatch(/like\("storage_key"[^\n]*\n[^\n]*\.limit\(1\)\n[^\n]*\.maybeSingle\(\)/);
    expect(h).toContain("applyProvenance");
  });
  it("uploads reuse the existing row by stored key and survive the unique-index race", () => {
    const s = read("src/lib/media/store.ts");
    expect(s).toContain("findLiveMediaForKey(storageKey)");
    expect(s).toContain("isUniqueViolation(error)");
  });
  it("every vendor-menu save passes provenance", () => {
    for (const f of ["cultivera", "growflow", "leaflink"]) {
      const src = read(`src/lib/purchasing/${f}-media.ts`);
      expect(src, f).toContain(`menuProvenance("${f}", item, vendorLabel, "image")`);
      expect(src, f).toContain(`menuProvenance("${f}", item, vendorLabel, "coa")`);
    }
  });
  it("the picker pool is vendor-scoped and range-paged (no .limit >= 1000)", () => {
    const p = read("src/lib/media/library-picker-server.ts");
    expect(p).toContain(".range(from, from + SCOPED_PAGE - 1)");
    expect(p).toContain('rpc("media_search"');
    expect(p).not.toMatch(/\.limit\(\s*\d{4,}/);
    expect(read("src/lib/catalog/image-memory-server.ts")).toContain("vendorIds: drafts.map((d) => d.vendor_id)");
    expect(read("src/app/admin/products/[key]/page.tsx")).toContain("vendorIds: [e?.vendor_id]");
  });
  it("0352 folds copies before it makes content_hash unique, under a lock", () => {
    const lock = MIG.indexOf("lock table public.media_assets in share row exclusive mode");
    const fold = MIG.indexOf("perform public.media_canonicalize(false)");
    const uniq = MIG.indexOf("create unique index if not exists uq_media_assets_live_content_hash");
    expect(lock).toBeGreaterThan(0);
    expect(fold).toBeGreaterThan(lock);
    expect(uniq).toBeGreaterThan(fold);
    expect(MIG).toMatch(/where status <> 'archived' and content_hash is not null/);
  });
  it("copies are archived, never deleted", () => {
    expect(MIG).not.toMatch(/delete from public\.media_assets/);
    expect(MIG).toMatch(/set status = 'archived'/);
  });
  it("the post-apply scenario check is registered", () => {
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toContain(
      '{ file: "scripts/recon/media-library-v2-0352-pg-check.sql", mustPrint: "MEDIA LIBRARY V2 0352 CHECK PASSED" }',
    );
  });
});
