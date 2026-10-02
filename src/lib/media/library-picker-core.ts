/**
 * src/lib/media/library-picker-core.ts — Round 21 (C).
 *
 * Owner, verbatim: "on enrichment, when I click to add a photo, it opens my
 * finder on my computer rather than looking in the media content page where
 * all image assets live."
 *
 * The enrichment editor's only "add a photo" control was a native
 * <input type="file"> — the OS file dialog. The enterprise pattern (WordPress
 * "Media Library" tab beside "Upload files", Contentful / Optimizely DAM
 * pickers, Shopify "Select file") is LIBRARY FIRST: browse and search the
 * assets you already own, upload only when the photo genuinely isn't there.
 * Every upload from the editor already lands in the library, so the library
 * is the single catalogue.
 *
 * This module is the pure decision layer for that picker: which assets are
 * pickable, how a search narrows them, how they are ordered for THIS product,
 * which ones are already on the product, and the honest empty-state copy.
 * No I/O; inputs are never mutated. The server reader lives in
 * library-picker-server.ts; the page renders what this returns.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** The media_assets columns the picker reads (named, never `*`). */
export type LibraryPickerAsset = {
  id: string;
  filename: string | null;
  title: string | null;
  alt_text: string | null;
  tags: string[] | null;
  usage_type: string | null;
  status: string | null;
  mime_type: string | null;
  license_status: string | null;
  created_at: string | null;
  /** Thumbnail URL resolved by the server reader (null = no thumbnail). */
  url: string | null;
};

export type LibraryScope = "product" | "all";

export type LibraryTile = {
  id: string;
  url: string | null;
  /** Title, else filename, else "(untitled image)". */
  label: string;
  /** Filename shown under a titled tile (null when label IS the filename). */
  sub: string | null;
  alt: string;
  /** Already in this product's gallery — no attach button. */
  alreadyAdded: boolean;
  /** media_assets.status = draft (it still renders; the badge is honest). */
  draft: boolean;
  /** license_status = pending-review (harvested art awaiting a rights check). */
  rightsPending: boolean;
  /** 0..1 share of the product's name words found in the asset's text. */
  relevance: number;
};

export type LibraryPickerView = {
  tiles: LibraryTile[];
  /** Pickable assets in scope that matched the search (before the cap). */
  matched: number;
  /** Pickable assets in scope, ignoring the search. */
  inScope: number;
  truncated: boolean;
  /** Plain-English line when there are no tiles; null otherwise. */
  emptyText: string | null;
  query: string;
  scope: LibraryScope;
};

export type LibraryPickerInput = {
  assets: readonly LibraryPickerAsset[];
  query: string | null | undefined;
  scope: LibraryScope;
  galleryIds: readonly string[];
  /** The product's name words drive the default ordering (best match first). */
  productName: string | null | undefined;
  limit?: number;
};

// ---------------------------------------------------------------------------
// Constants + copy
// ---------------------------------------------------------------------------

/** Tiles rendered before "search to narrow" (a full grid row count on lg). */
export const LIBRARY_PICKER_MAX = 24;
/** Rows the server reader asks for — bounded, newest first. */
export const LIBRARY_READ_LIMIT = 400;
/** Search box cap (characters). */
export const LIBRARY_QUERY_MAX = 80;

/**
 * Exactly the formats the editor's upload accepts (actions.ts IMAGE_MIME), so
 * the picker never offers a file the upload path would have refused.
 */
export const PICKABLE_IMAGE_MIME: readonly string[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const PICKABLE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

export const LIBRARY_EMPTY_COPY =
  "Your media library has no product photos yet. Upload one below, or harvest vendor menus to pull photos in.";
export const LIBRARY_EMPTY_ALL_COPY =
  "Your media library has no images yet. Upload one below, or harvest vendor menus to pull photos in.";
export const LIBRARY_NO_MATCH_COPY = (q: string) =>
  `No library images match \u201C${q}\u201D. Try fewer words, switch to all images, or upload a new photo below.`;
export const LIBRARY_READ_ERROR_COPY =
  "The media library couldn\u2019t be read just now, so nothing is listed. Reload the page, or upload a new photo below.";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lower-case word tokens (a–z, 0–9). */
export function pickerTokens(s: string | null | undefined): string[] {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 0);
}

/** Trim, collapse whitespace, cap length. Non-strings → "". */
export function parseLibraryQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, LIBRARY_QUERY_MAX).trim();
}

/** Only "all" widens; anything else is the product-image default. */
export function parseLibraryScope(raw: unknown): LibraryScope {
  return raw === "all" ? "all" : "product";
}

function extOf(filename: string | null): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename ?? "");
  return m ? m[1]!.toLowerCase() : "";
}

/**
 * Pickable = not archived AND an image format the upload path accepts. A row
 * with no mime type falls back to its file extension (older rows).
 */
export function isPickableImage(a: LibraryPickerAsset): boolean {
  if (!a || typeof a.id !== "string" || a.id.trim() === "") return false;
  if (a.status === "archived") return false;
  const mime = (a.mime_type ?? "").toLowerCase().trim();
  if (mime) return PICKABLE_IMAGE_MIME.includes(mime);
  return PICKABLE_EXT.has(extOf(a.filename));
}

function haystack(a: LibraryPickerAsset): Set<string> {
  return new Set(
    pickerTokens(
      `${a.title ?? ""} ${a.filename ?? ""} ${a.alt_text ?? ""} ${(a.tags ?? []).join(" ")} ${a.usage_type ?? ""}`,
    ),
  );
}

/** Every search word must appear (AND), the way the media page's box narrows. */
function matchesQuery(words: Set<string>, queryTokens: string[]): boolean {
  return queryTokens.every((q) => {
    if (words.has(q)) return true;
    for (const w of words) if (w.startsWith(q)) return true;
    return false;
  });
}

function relevanceOf(words: Set<string>, nameTokens: string[]): number {
  if (nameTokens.length === 0) return 0;
  const hits = nameTokens.filter((t) => words.has(t)).length;
  return Number((hits / nameTokens.length).toFixed(2));
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function libraryPickerView(input: LibraryPickerInput): LibraryPickerView {
  const query = parseLibraryQuery(input.query);
  const scope = input.scope === "all" ? "all" : "product";
  const limit =
    typeof input.limit === "number" && Number.isInteger(input.limit) && input.limit > 0 ? input.limit : LIBRARY_PICKER_MAX;
  const gallery = new Set((input.galleryIds ?? []).filter((g) => typeof g === "string").map((g) => g.trim()));
  const nameTokens = [...new Set(pickerTokens(input.productName))];
  const queryTokens = [...new Set(pickerTokens(query))];

  const seen = new Set<string>();
  const pickable: LibraryPickerAsset[] = [];
  for (const a of input.assets ?? []) {
    if (!isPickableImage(a)) continue;
    const id = a.id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    if (scope === "product" && a.usage_type !== "product") continue;
    pickable.push(a);
  }

  const scored = pickable
    .map((a) => {
      const words = haystack(a);
      return { a, words, relevance: relevanceOf(words, nameTokens) };
    })
    .filter((s) => matchesQuery(s.words, queryTokens));

  scored.sort((x, y) => {
    if (y.relevance !== x.relevance) return y.relevance - x.relevance;
    const xd = x.a.created_at ?? "";
    const yd = y.a.created_at ?? "";
    if (xd !== yd) return xd < yd ? 1 : -1;
    return x.a.id < y.a.id ? -1 : x.a.id > y.a.id ? 1 : 0;
  });

  const tiles: LibraryTile[] = scored.slice(0, limit).map(({ a, relevance }) => {
    const title = (a.title ?? "").trim();
    const filename = (a.filename ?? "").trim();
    const label = title || filename || "(untitled image)";
    return {
      id: a.id.trim(),
      url: a.url ?? null,
      label,
      sub: title && filename ? filename : null,
      alt: (a.alt_text ?? "").trim() || label,
      alreadyAdded: gallery.has(a.id.trim()),
      draft: a.status === "draft",
      rightsPending: a.license_status === "pending-review",
      relevance,
    };
  });

  let emptyText: string | null = null;
  if (tiles.length === 0) {
    if (pickable.length === 0) emptyText = scope === "product" ? LIBRARY_EMPTY_COPY : LIBRARY_EMPTY_ALL_COPY;
    else emptyText = LIBRARY_NO_MATCH_COPY(query);
  }

  return {
    tiles,
    matched: scored.length,
    inScope: pickable.length,
    truncated: scored.length > tiles.length,
    emptyText,
    query,
    scope,
  };
}

/** "Showing 24 of 61 — search to narrow." / "3 images." */
export function libraryCountText(v: Pick<LibraryPickerView, "tiles" | "matched" | "truncated">): string {
  if (v.matched === 0) return "";
  if (v.truncated) return `Showing ${v.tiles.length} of ${v.matched} \u2014 search to narrow.`;
  return `${v.matched} image${v.matched === 1 ? "" : "s"}.`;
}

/**
 * The picker's own URL (search + scope travel as GET params; the fragment
 * brings the browser back to the picker). `back` is preserved so the page's
 * back link still returns to the filtered product list.
 */
export function libraryPickerHref(
  key: string,
  opts: { query?: string | null; scope?: LibraryScope; back?: string | null },
): string {
  const p = new URLSearchParams();
  if (opts.back) p.set("back", opts.back);
  const q = parseLibraryQuery(opts.query ?? "");
  if (q) p.set("lq", q);
  if (opts.scope === "all") p.set("lscope", "all");
  const qs = p.toString();
  return `/admin/products/${encodeURIComponent(key)}${qs ? `?${qs}` : ""}#library`;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runLibraryPickerCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, label: string) => {
    if (!cond) throw new Error(`library-picker-core: ${label}`);
    passed++;
  };
  const A = (over: Partial<LibraryPickerAsset> & { id: string }): LibraryPickerAsset => ({
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

  // parse
  ok(parseLibraryQuery("  grape   gas ") === "grape gas", "query collapses whitespace");
  ok(parseLibraryQuery(42) === "", "non-string query → empty");
  ok(parseLibraryQuery("x".repeat(200)).length === LIBRARY_QUERY_MAX, "query capped");
  ok(parseLibraryScope("all") === "all" && parseLibraryScope("ALL") === "product" && parseLibraryScope(undefined) === "product", "scope parse");

  // pickable
  ok(isPickableImage(A({ id: "a" })), "published jpeg pickable");
  ok(!isPickableImage(A({ id: "a", status: "archived" })), "archived refused");
  ok(isPickableImage(A({ id: "a", status: "draft" })), "draft still pickable");
  ok(!isPickableImage(A({ id: "a", mime_type: "application/pdf", filename: "x.pdf" })), "pdf refused");
  ok(!isPickableImage(A({ id: "a", mime_type: "image/svg+xml" })), "svg refused (upload refuses it too)");
  ok(isPickableImage(A({ id: "a", mime_type: null, filename: "old.PNG" })), "null mime falls back to extension");
  ok(!isPickableImage(A({ id: "a", mime_type: null, filename: "notes.txt" })), "null mime + non-image ext refused");
  ok(!isPickableImage(A({ id: "  " })), "blank id refused");

  // scope + order
  const assets = [
    A({ id: "old-match", title: "Grape Gas 3.5g jar", created_at: "2025-01-01T00:00:00Z" }),
    A({ id: "new-nomatch", title: "Blue Dream", created_at: "2026-03-01T00:00:00Z" }),
    A({ id: "logo", title: "Grape Gas logo", usage_type: "brand-logo", created_at: "2026-02-01T00:00:00Z" }),
    A({ id: "arch", title: "Grape Gas", status: "archived" }),
    A({ id: "pdf", title: "Grape Gas sheet", mime_type: "application/pdf" }),
    A({ id: "old-match", title: "dupe" }),
  ];
  const v = libraryPickerView({ assets, query: "", scope: "product", galleryIds: [], productName: "Grape Gas 3.5g" });
  ok(v.tiles.map((t) => t.id).join(",") === "old-match,new-nomatch", "product scope: best name match first, archived/pdf/logo/dupe out");
  ok(v.inScope === 2 && v.matched === 2 && !v.truncated && v.emptyText === null, "product scope counts");
  ok(v.tiles[0]!.relevance === 1 && v.tiles[1]!.relevance === 0, "relevance computed from product name words");
  const all = libraryPickerView({ assets, query: null, scope: "all", galleryIds: [], productName: "Grape Gas 3.5g" });
  ok(all.tiles.map((t) => t.id).join(",") === "old-match,logo,new-nomatch", "all scope includes the logo, ranked by relevance then newest");

  // search
  const s = libraryPickerView({ assets, query: "blue", scope: "product", galleryIds: [], productName: "Grape Gas" });
  ok(s.tiles.length === 1 && s.tiles[0]!.id === "new-nomatch", "search narrows (AND, prefix)");
  const s2 = libraryPickerView({ assets, query: "grape blue", scope: "product", galleryIds: [], productName: "" });
  ok(s2.tiles.length === 0 && s2.emptyText === LIBRARY_NO_MATCH_COPY("grape blue"), "AND search with no hit → no-match copy");
  const s3 = libraryPickerView({ assets: [A({ id: "f", title: null, filename: "IMG_2041-gelato.webp", mime_type: "image/webp" })], query: "gelato", scope: "product", galleryIds: [], productName: "" });
  ok(s3.tiles.length === 1 && s3.tiles[0]!.label === "IMG_2041-gelato.webp" && s3.tiles[0]!.sub === null, "search hits filename; untitled tile labelled by filename");
  const s4 = libraryPickerView({ assets: [A({ id: "t", tags: ["pre-roll"], title: "Thing" })], query: "pre", scope: "product", galleryIds: [], productName: "" });
  ok(s4.tiles.length === 1, "search hits tags");

  // tiles
  const t = libraryPickerView({
    assets: [A({ id: "g", title: "Gallery pic", filename: "g.jpg", status: "draft", license_status: "pending-review", alt_text: "" })],
    query: "", scope: "product", galleryIds: [" g "], productName: "",
  }).tiles[0]!;
  ok(t.alreadyAdded && t.draft && t.rightsPending, "already-added, draft and rights-pending flags");
  ok(t.sub === "g.jpg" && t.alt === "Gallery pic", "titled tile shows filename sub; blank alt falls back to label");
  ok(libraryPickerView({ assets: [A({ id: "u", title: null, filename: null })], query: "", scope: "product", galleryIds: [], productName: "" }).tiles[0]!.label === "(untitled image)", "untitled fallback");

  // empty states
  ok(libraryPickerView({ assets: [], query: "", scope: "product", galleryIds: [], productName: "x" }).emptyText === LIBRARY_EMPTY_COPY, "empty product library copy");
  ok(libraryPickerView({ assets: [], query: "", scope: "all", galleryIds: [], productName: "x" }).emptyText === LIBRARY_EMPTY_ALL_COPY, "empty whole library copy");

  // cap
  const many = Array.from({ length: 30 }, (_, i) => A({ id: `m${String(i).padStart(2, "0")}`, created_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z` }));
  const capped = libraryPickerView({ assets: many, query: "", scope: "product", galleryIds: [], productName: "" });
  ok(capped.tiles.length === LIBRARY_PICKER_MAX && capped.truncated && capped.matched === 30, "capped at the max with truncated flag");
  ok(capped.tiles[0]!.id === "m29", "ties broken newest first");
  ok(libraryCountText(capped) === "Showing 24 of 30 \u2014 search to narrow.", "truncated count text");
  ok(libraryCountText({ tiles: [], matched: 1, truncated: false }) === "1 image.", "singular count text");
  ok(libraryCountText({ tiles: [], matched: 0, truncated: false }) === "", "no count text when nothing matched");
  ok(libraryPickerView({ assets: many, query: "", scope: "product", galleryIds: [], productName: "", limit: 0 }).tiles.length === LIBRARY_PICKER_MAX, "invalid limit → default");

  // href
  ok(libraryPickerHref("SKU 9", { query: " gas ", scope: "all", back: "/admin/products?q=x" }) === "/admin/products/SKU%209?back=%2Fadmin%2Fproducts%3Fq%3Dx&lq=gas&lscope=all#library", "href keeps back, query, scope, fragment");
  ok(libraryPickerHref("k", {}) === "/admin/products/k#library", "bare href");

  // purity
  const frozen = Object.freeze([Object.freeze(A({ id: "z" }))]) as readonly LibraryPickerAsset[];
  libraryPickerView({ assets: frozen, query: "", scope: "product", galleryIds: Object.freeze(["z"]), productName: "z" });
  ok(true, "frozen inputs not mutated");

  return { passed, failed: 0 };
}
