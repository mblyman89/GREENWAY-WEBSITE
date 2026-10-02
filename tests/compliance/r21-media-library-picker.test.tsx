/**
 * Round 21 (C) — the enrichment editor's "add a photo" starts in the media
 * library, not the OS file dialog.
 *
 * Owner, verbatim: "on enrichment, when I click to add a photo, it opens my
 * finder on my computer rather than looking in the media content page where
 * all image assets live."
 *
 * Proven here:
 *   1. the pure picker core (pickable formats, search, order, copy) + its
 *      exact self-test count;
 *   2. the server reader, driven through the REAL postgrest-js client against
 *      the in-memory FakePostgrest: named columns, archived excluded in the
 *      query, product scope, bounded, a failed read reported as ok:false;
 *   3. the picker component render: one attach form per tile posting
 *      key/mediaId/source=library, "Already added" for gallery photos, the
 *      GET search form, the empty and read-error states;
 *   4. the product page wiring: the picker sits OUTSIDE the multipart editor
 *      form, the Images panel leads with the library, and the file input is
 *      relabelled as the secondary path;
 *   5. the guidance buttons: "Choose from the media library" (#library)
 *      comes before "Upload a new photo" (#upload).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({
  ...((await orig()) as object),
  isSupabaseServiceConfigured: true,
  supabaseUrl: "https://x.supabase.co",
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () =>
      new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }),
  };
});

import {
  __runLibraryPickerCoreTests,
  isPickableImage,
  libraryPickerView,
  libraryPickerHref,
  LIBRARY_EMPTY_COPY,
  LIBRARY_PICKER_MAX,
  LIBRARY_READ_ERROR_COPY,
  LIBRARY_READ_LIMIT,
  PICKABLE_IMAGE_MIME,
  type LibraryPickerAsset,
} from "@/lib/media/library-picker-core";
import { readLibraryPickerAssets, LIBRARY_PICKER_COLUMNS } from "@/lib/media/library-picker-server";
import { MediaLibraryPicker, LIBRARY_ATTACH_SOURCE } from "@/app/admin/products/[key]/MediaLibraryPicker";
import { buildGuidanceActions, buildAssetGuidance } from "@/lib/enrichment/match-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const asset = (over: Partial<LibraryPickerAsset> & { id: string }): LibraryPickerAsset => ({
  filename: "photo.jpg",
  title: null,
  alt_text: null,
  tags: [],
  usage_type: "product",
  status: "published",
  mime_type: "image/jpeg",
  license_status: null,
  created_at: "2026-01-01T00:00:00Z",
  url: "https://cdn/x.jpg",
  ...over,
});

const row = (over: Record<string, unknown>) => ({
  storage_key: "ab/cd.jpg",
  public_url: null,
  filename: "x.jpg",
  title: "T",
  alt_text: null,
  tags: [],
  usage_type: "product",
  status: "published",
  mime_type: "image/jpeg",
  license_status: null,
  created_at: "2026-01-01T00:00:00Z",
  size_bytes: 99,
  description: "not read",
  ...over,
});

beforeEach(() => {
  st.db = new FakePostgrest();
});

// === 1. Core ==================================================================
describe("R21 (C) library-picker-core", () => {
  it("self-tests pass at the exact registered count", () => {
    expect(__runLibraryPickerCoreTests()).toEqual({ passed: 34, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain(
      'assertRan("library-picker-core", __runLibraryPickerCoreTests(), 34);',
    );
  });

  it("offers exactly the formats the editor upload accepts", () => {
    const actions = read("src/app/admin/products/actions.ts");
    const m = /const IMAGE_MIME = new Set\(\[([^\]]+)\]\)/.exec(actions);
    expect(m).not.toBeNull();
    const uploadMimes = m![1]!.split(",").map((s) => s.trim().replace(/"/g, ""));
    expect([...PICKABLE_IMAGE_MIME].sort()).toEqual(uploadMimes.sort());
  });

  it("archived and non-image assets are never offered; drafts are, with a badge", () => {
    expect(isPickableImage(asset({ id: "a", status: "archived" }))).toBe(false);
    expect(isPickableImage(asset({ id: "a", mime_type: "application/pdf" }))).toBe(false);
    const v = libraryPickerView({
      assets: [asset({ id: "d", status: "draft", title: "Draft pic" })],
      query: "", scope: "product", galleryIds: [], productName: "",
    });
    expect(v.tiles[0]!.draft).toBe(true);
  });

  it("orders by how well the asset names THIS product, then newest", () => {
    const v = libraryPickerView({
      assets: [
        asset({ id: "new", title: "Unrelated", created_at: "2026-05-01T00:00:00Z" }),
        asset({ id: "half", title: "Grape something", created_at: "2026-04-01T00:00:00Z" }),
        asset({ id: "full", title: "Grape Gas", created_at: "2025-01-01T00:00:00Z" }),
      ],
      query: "", scope: "product", galleryIds: [], productName: "Grape Gas",
    });
    expect(v.tiles.map((t) => t.id)).toEqual(["full", "half", "new"]);
  });

  it("caps the grid and says so", () => {
    const many = Array.from({ length: LIBRARY_PICKER_MAX + 5 }, (_, i) => asset({ id: `m${i}` }));
    const v = libraryPickerView({ assets: many, query: "", scope: "product", galleryIds: [], productName: "" });
    expect(v.tiles).toHaveLength(LIBRARY_PICKER_MAX);
    expect(v.truncated).toBe(true);
  });
});

// === 2. Server reader ==========================================================
describe("R21 (C) readLibraryPickerAssets (real postgrest-js → FakePostgrest)", () => {
  it("reads named columns, excludes archived in the query, product scope, bounded, newest first", async () => {
    st.db.rows("media_assets").push(
      row({ id: "p1", created_at: "2026-01-02T00:00:00Z" }),
      row({ id: "p2", created_at: "2026-01-03T00:00:00Z" }),
      row({ id: "arch", status: "archived" }),
      row({ id: "logo", usage_type: "brand-logo" }),
    );
    const r = await readLibraryPickerAssets("product");
    expect(r.ok).toBe(true);
    expect(r.assets.map((a) => a.id)).toEqual(["p2", "p1"]);
    const get = st.db.log.find((q) => q.table === "media_assets")!;
    expect(get.url.searchParams.get("select")).toBe(LIBRARY_PICKER_COLUMNS.replace(/\s+/g, ""));
    expect(get.url.searchParams.get("status")).toBe("neq.archived");
    expect(get.url.searchParams.get("usage_type")).toBe("eq.product");
    expect(get.url.searchParams.get("limit")).toBe(String(LIBRARY_READ_LIMIT));
    expect(get.url.searchParams.get("order")).toBe("created_at.desc");
    expect(LIBRARY_PICKER_COLUMNS).not.toContain("*");
    expect(LIBRARY_PICKER_COLUMNS).not.toContain("description");
  });

  it("all scope drops the usage filter; thumbnails use the public bucket URL, else public_url", async () => {
    st.db.rows("media_assets").push(
      row({ id: "logo", usage_type: "brand-logo", storage_key: "k/logo.png" }),
      row({ id: "nokey", storage_key: null, public_url: "https://elsewhere/p.jpg" }),
    );
    const r = await readLibraryPickerAssets("all");
    const get = st.db.log.find((q) => q.table === "media_assets")!;
    expect(get.url.searchParams.has("usage_type")).toBe(false);
    const byId = new Map(r.assets.map((a) => [a.id, a]));
    expect(byId.get("logo")!.url).toBe("https://x.supabase.co/storage/v1/object/public/media/k/logo.png");
    expect(byId.get("nokey")!.url).toBe("https://elsewhere/p.jpg");
  });

  it("a failed read is ok:false (the page says so), never a silently empty library", async () => {
    st.db.missing.add("media_assets");
    const r = await readLibraryPickerAssets("product");
    expect(r).toEqual({ ok: false, assets: [] });
  });
});

// === 3. Component =============================================================
describe("R21 (C) MediaLibraryPicker render", () => {
  const action = async () => {};
  const view = libraryPickerView({
    assets: [
      asset({ id: "in-gallery", title: "Already here" }),
      asset({ id: "pick-me", title: "Grape Gas jar", filename: "gg.jpg", license_status: "pending-review" }),
    ],
    query: "", scope: "product", galleryIds: ["in-gallery"], productName: "Grape Gas",
  });
  const html = renderToStaticMarkup(
    <MediaLibraryPicker productKey="SKU 9" back="/admin/products?q=gas" view={view} readOk action={action} />,
  );

  it("is the #library section the guidance and Images panel jump to", () => {
    expect(html).toContain('id="library"');
    expect(html).toContain("Choose from your media library");
  });

  it("one attach form per pickable tile, posting key / mediaId / source=library", () => {
    expect(LIBRARY_ATTACH_SOURCE).toBe("library");
    expect((html.match(/data-testid="library-add"/g) ?? []).length).toBe(1);
    expect(html).toContain('name="mediaId" value="pick-me"');
    expect(html).toContain('name="key" value="SKU 9"');
    expect(html).toContain('name="source" value="library"');
    expect(html).not.toContain('name="mediaId" value="in-gallery"');
  });

  it("a photo already on the product says so instead of offering a button", () => {
    expect((html.match(/data-testid="library-already"/g) ?? []).length).toBe(1);
    expect(html).toContain("Already added");
  });

  it("best match is first; the rights badge shows on harvested art", () => {
    expect(html.indexOf('data-media-id="pick-me"')).toBeLessThan(html.indexOf('data-media-id="in-gallery"'));
    expect(html).toContain("Rights check");
  });

  it("search is a GET form back to this product's #library, keeping back", () => {
    const form = /<form[^>]*data-testid="library-search"[^>]*>/.exec(html)?.[0] ?? "";
    expect(form).toContain('method="get"');
    // A GET submit replaces the action's query but keeps its fragment (HTML
    // "mutate action URL"), so the browser lands back on the picker.
    expect(form).toContain('action="/admin/products/SKU%209#library"');
    expect(html).toContain('name="lq"');
    expect(html).toContain('name="back" value="/admin/products?q=gas"');
    expect(html).toContain(`href="${libraryPickerHref("SKU 9", { scope: "all", back: "/admin/products?q=gas" }).replace(/&/g, "&amp;")}"`);
  });

  it("upload is offered as the secondary path", () => {
    expect(html).toContain('href="#upload"');
    expect(html).toContain("Upload a new photo from your computer");
  });

  it("empty library and failed read each say what happened", () => {
    const empty = renderToStaticMarkup(
      <MediaLibraryPicker
        productKey="k" back={null} readOk action={action}
        view={libraryPickerView({ assets: [], query: "", scope: "product", galleryIds: [], productName: "" })}
      />,
    );
    expect(empty).toContain(LIBRARY_EMPTY_COPY);
    expect(empty).not.toContain('data-testid="library-grid"');
    const failed = renderToStaticMarkup(
      <MediaLibraryPicker
        productKey="k" back={null} readOk={false} action={action}
        view={libraryPickerView({ assets: [], query: "", scope: "product", galleryIds: [], productName: "" })}
      />,
    );
    expect(failed).toContain(LIBRARY_READ_ERROR_COPY.replace(/\u2019/g, "\u2019"));
    expect(failed).toContain('role="alert"');
    expect(failed).not.toContain(LIBRARY_EMPTY_COPY);
  });
});

// === 4. Page wiring ===========================================================
describe("R21 (C) product page wiring", () => {
  const page = read("src/app/admin/products/[key]/page.tsx");

  it("the picker renders OUTSIDE the multipart editor form (no nested forms)", () => {
    const picker = page.indexOf("<MediaLibraryPicker");
    const editorOpen = page.indexOf("<form action={updateProductEnrichment}");
    const editorClose = page.indexOf("</form>", editorOpen);
    expect(picker).toBeGreaterThan(0);
    expect(picker).toBeLessThan(editorOpen);
    expect(page.slice(editorOpen, editorClose)).not.toContain("<MediaLibraryPicker");
    expect(page).toContain("action={attachMatchedMedia}\n        />");
  });

  it("reads the library with the GET params and marks the gallery", () => {
    expect(page).toContain("const libraryScope = parseLibraryScope(lscope);");
    expect(page).toContain("readLibraryPickerAssets(libraryScope)");
    expect(page).toContain("query: parseLibraryQuery(lq),");
    expect(page).toContain("galleryIds,");
    expect(page).toContain("readOk={libraryRead.ok}");
  });

  it("the Images panel leads with the library; the file input is the secondary path", () => {
    const lib = page.indexOf('data-testid="images-choose-library"');
    const upload = page.indexOf('<label id="upload"');
    expect(lib).toBeGreaterThan(0);
    expect(lib).toBeLessThan(upload);
    expect(page).toContain("Or upload a new photo from your computer");
    expect(page).not.toContain('<span className={label}>Add image</span>');
    // The upload path itself is unchanged: same field name and formats.
    expect(page).toContain('name="image" accept="image/png,image/jpeg,image/webp,image/gif"');
  });

  it("the attach action it posts to is the audited, usage-recording one", () => {
    const actions = read("src/app/admin/products/actions.ts");
    const fn = actions.slice(actions.indexOf("export async function attachMatchedMedia"), actions.indexOf("export async function importVendorImage"));
    expect(fn).toContain('requirePermission("products.enrich")');
    expect(fn).toContain('String(formData.get("mediaId")');
    expect(fn).toContain('recordUsage(mediaId, "product", key, "image")');
    expect(fn).toContain('action: "product.match_image_attached"');
  });
});

// === 5. Guidance ==============================================================
describe("R21 (C) guidance: library before upload", () => {
  it("jump buttons and plain-English lines both put the library first", () => {
    const acts = buildGuidanceActions({
      hasDescription: true, hasImage: false, kbMatches: 0, mediaMatches: 0, vendorMatches: 0, substituteAvailable: false,
    });
    const hrefs = acts.map((a) => a.href);
    expect(hrefs.indexOf("#library")).toBeGreaterThanOrEqual(0);
    expect(hrefs.indexOf("#library")).toBeLessThan(hrefs.indexOf("#upload"));
    const lines = buildAssetGuidance({
      hasDescription: true, hasImage: false, kbMatches: 0, mediaMatches: 0, vendorMatches: 0, substituteAvailable: false,
    });
    expect(lines.findIndex((l) => l.includes("media library first"))).toBeLessThan(
      lines.findIndex((l) => l.includes("upload it below")),
    );
  });

  it("an image already on the product means no library nag", () => {
    const acts = buildGuidanceActions({
      hasDescription: false, hasImage: true, kbMatches: 0, mediaMatches: 0, vendorMatches: 0, substituteAvailable: false,
    });
    expect(acts.some((a) => a.href === "#library")).toBe(false);
  });
});
