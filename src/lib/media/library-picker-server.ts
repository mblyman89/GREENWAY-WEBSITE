/**
 * src/lib/media/library-picker-server.ts — Round 21 (C), widened D221 M1.
 *
 * Reads the media library for the enrichment editor's "Choose from your media
 * library" picker and for the onboarding image recommendations. Named columns
 * only, archived rows excluded in the query. A failed read is reported as
 * `ok: false` so the page can say so instead of showing an empty library that
 * isn't really empty. Thumbnails use the same public-bucket URL every other
 * admin grid uses (publicUrlForKey, falling back to the stored public_url).
 *
 * D221 M1 (owner: suggestions were "not even the same vendor"): the pool used
 * to be ONLY the newest LIBRARY_READ_LIMIT rows - with 8,000+ images most of a
 * vendor's pictures were simply never looked at. Now the pool is:
 *   1. every live image filed under the product's own vendor / brand cards
 *      (0352 provenance; `.range()` paged, capped at SCOPED_READ_MAX), plus
 *   2. the top hits of public.media_search for the typed search (ranked full
 *      text + typo tolerance over product name, package text, captions...), plus
 *   3. the newest LIBRARY_READ_LIMIT rows, as before.
 * Before 0352 is applied, (1) and (2) quietly add nothing and the reader
 * behaves exactly as it did.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { publicUrlForKey } from "./store";
import { LIBRARY_READ_LIMIT, type LibraryPickerAsset, type LibraryScope } from "./library-picker-core";
import { isMissingColumn } from "./provenance-core";
import { semanticNeighbors, semanticSearch } from "./media-embed-server";
import { rrfFuse } from "./media-embed-core";

const BASE_COLUMNS =
  "id, storage_key, public_url, filename, title, alt_text, tags, usage_type, status, mime_type, license_status, created_at";
/** D221 M1 (0352) columns. */
const V2_COLUMNS = "vendor_id, brand_id, product_name, visible_text, ai_caption, role, pack_size";
export const LIBRARY_PICKER_COLUMNS = `${BASE_COLUMNS}, ${V2_COLUMNS}`;

/** Page size for the vendor/brand-scoped read (well under PostgREST's 1,000). */
const SCOPED_PAGE = 500;
/** Most rows the vendor/brand-scoped read will pull. */
export const SCOPED_READ_MAX = 3000;
/** media_search hits added for a typed search. */
const SEARCH_HITS = 200;

type Row = {
  id: string;
  storage_key: string | null;
  public_url: string | null;
  filename: string | null;
  title: string | null;
  alt_text: string | null;
  tags: string[] | null;
  usage_type: string | null;
  status: string | null;
  mime_type: string | null;
  license_status: string | null;
  created_at: string | null;
  vendor_id?: string | null;
  brand_id?: string | null;
  product_name?: string | null;
  visible_text?: string | null;
  ai_caption?: string | null;
  role?: string | null;
  pack_size?: string | null;
};

export type LibraryPickerRead = { ok: true; assets: LibraryPickerAsset[] } | { ok: false; assets: [] };

export type LibraryPickerReadOptions = {
  /** Vendor cards whose pictures must be in the pool. */
  vendorIds?: readonly (string | null | undefined)[];
  /** Brand cards whose pictures must be in the pool. */
  brandIds?: readonly (string | null | undefined)[];
  /** A typed search; its media_search hits join the pool. */
  query?: string | null;
};

function toAsset(r: Row): LibraryPickerAsset {
  return {
    id: r.id,
    filename: r.filename,
    title: r.title,
    alt_text: r.alt_text,
    tags: r.tags,
    usage_type: r.usage_type,
    status: r.status,
    mime_type: r.mime_type,
    license_status: r.license_status,
    created_at: r.created_at,
    url: (r.storage_key ? publicUrlForKey(r.storage_key) : null) ?? r.public_url ?? null,
    vendor_id: r.vendor_id ?? null,
    brand_id: r.brand_id ?? null,
    product_name: r.product_name ?? null,
    visible_text: r.visible_text ?? null,
    ai_caption: r.ai_caption ?? null,
    role: r.role ?? null,
    pack_size: r.pack_size ?? null,
  };
}

function cleanIds(ids: readonly (string | null | undefined)[] | undefined): string[] {
  return [...new Set((ids ?? []).map((v) => (v ?? "").trim()).filter((v) => /^[0-9a-f-]{36}$/i.test(v)))].slice(0, 100);
}

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** The vendor/brand-scoped pool, `.range()` paged. [] before 0352. */
async function readScoped(admin: Admin, scope: LibraryScope, vendorIds: string[], brandIds: string[]): Promise<Row[]> {
  if (vendorIds.length === 0 && brandIds.length === 0) return [];
  const ors: string[] = [];
  if (vendorIds.length) ors.push(`vendor_id.in.(${vendorIds.join(",")})`);
  if (brandIds.length) ors.push(`brand_id.in.(${brandIds.join(",")})`);
  const out: Row[] = [];
  for (let from = 0; from < SCOPED_READ_MAX; from += SCOPED_PAGE) {
    let q = admin
      .from("media_assets")
      .select(LIBRARY_PICKER_COLUMNS)
      .neq("status", "archived")
      .or(ors.join(","))
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + SCOPED_PAGE - 1);
    if (scope === "product") q = q.eq("usage_type", "product");
    const { data, error } = await q;
    if (error) return out; // 0352 not applied, or a transient error: the base pool still stands
    const rows = (data as Row[] | null) ?? [];
    out.push(...rows);
    if (rows.length < SCOPED_PAGE) break;
  }
  return out;
}

/** The media_search hits for a typed query, as rows. [] before 0352. */
async function readSearchHits(admin: Admin, query: string, vendorId: string | null): Promise<Row[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await admin.rpc("media_search", {
    p_query: q,
    p_vendor_id: vendorId,
    p_limit: SEARCH_HITS,
    p_offset: 0,
  });
  if (error || !Array.isArray(data)) return [];
  const ids = (data as { media_id: string }[]).map((r) => r.media_id).filter(Boolean);
  if (ids.length === 0) return [];
  const { data: rows, error: rowsErr } = await admin.from("media_assets").select(LIBRARY_PICKER_COLUMNS).in("id", ids);
  if (rowsErr) return [];
  return (rows as Row[] | null) ?? [];
}

export async function readLibraryPickerAssets(
  scope: LibraryScope,
  opts: LibraryPickerReadOptions = {},
): Promise<LibraryPickerRead> {
  if (!isSupabaseServiceConfigured) return { ok: true, assets: [] };
  try {
    const admin = createSupabaseAdminClient();
    const newest = async (cols: string) => {
      let q = admin
        .from("media_assets")
        .select(cols)
        .neq("status", "archived")
        .order("created_at", { ascending: false })
        .limit(LIBRARY_READ_LIMIT);
      if (scope === "product") q = q.eq("usage_type", "product");
      return q;
    };
    let base = await newest(LIBRARY_PICKER_COLUMNS);
    let v2 = true;
    if (base.error && isMissingColumn(base.error)) {
      base = await newest(BASE_COLUMNS); // 0352 not applied yet
      v2 = false;
    }
    if (base.error) return { ok: false, assets: [] };

    const vendorIds = cleanIds(opts.vendorIds);
    const brandIds = cleanIds(opts.brandIds);
    const [scoped, hits] = v2
      ? await Promise.all([
          readScoped(admin, scope, vendorIds, brandIds),
          opts.query ? readSearchHits(admin, opts.query, vendorIds.length === 1 ? vendorIds[0]! : null) : Promise.resolve([]),
        ])
      : [[], []];

    // Search hits first, then the product's own vendor, then the newest.
    const seen = new Set<string>();
    const assets: LibraryPickerAsset[] = [];
    for (const r of [...hits, ...scoped, ...(((base.data as unknown) as Row[] | null) ?? [])]) {
      if (!r?.id || seen.has(r.id) || r.status === "archived") continue;
      if (scope === "product" && r.usage_type !== "product") continue;
      seen.add(r.id);
      assets.push(toAsset(r));
    }
    return { ok: true, assets };
  } catch {
    return { ok: false, assets: [] };
  }
}

// ---------------------------------------------------------------------------
// D244 E-3: the detail page's recommender pool helpers.
// ---------------------------------------------------------------------------

/** Pictures by id (remembered / on-record picks), archived dropped. [] on any failure. */
export async function readLibraryAssetsByIds(ids: readonly (string | null | undefined)[]): Promise<LibraryPickerAsset[]> {
  const clean = cleanIds(ids);
  if (clean.length === 0 || !isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const byIds = (cols: string) => admin.from("media_assets").select(cols).in("id", clean).range(0, 199);
    let r = await byIds(LIBRARY_PICKER_COLUMNS);
    if (r.error && isMissingColumn(r.error)) r = await byIds(BASE_COLUMNS);
    if (r.error) return [];
    return (((r.data as unknown) as Row[] | null) ?? []).filter((x) => x?.id && x.status !== "archived").map(toAsset);
  } catch {
    return [];
  }
}

/** The media_search hits for one query, as assets (whole library). [] before 0352 or on failure. */
export async function readSearchHitAssets(query: string, limit = 60): Promise<LibraryPickerAsset[]> {
  if (!isSupabaseServiceConfigured || (query ?? "").trim().length < 2) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("media_search", { p_query: query.trim(), p_vendor_id: null, p_limit: Math.min(SEARCH_HITS, Math.max(1, limit)), p_offset: 0 });
    if (error || !Array.isArray(data)) return [];
    const order = (data as { media_id: string }[]).map((r) => r.media_id).filter(Boolean);
    if (order.length === 0) return [];
    const { data: rows, error: rowsErr } = await admin.from("media_assets").select(LIBRARY_PICKER_COLUMNS).in("id", order).range(0, 199);
    if (rowsErr) return [];
    const byId = new Map((((rows as unknown) as Row[] | null) ?? []).map((r) => [r.id, r] as const));
    return order.flatMap((id) => {
      const r = byId.get(id);
      return r && r.status !== "archived" ? [toAsset(r)] : [];
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// D221 M6: "Search for a better picture" and "Find similar"
// ---------------------------------------------------------------------------

export type ImageSearchRequest = {
  /** Typed words (2+ characters), or empty. */
  query?: string | null;
  /** vendor = this product's vendor only, brand = this brand only, all = whole library. */
  scope: "vendor" | "brand" | "all";
  vendorId?: string | null;
  brandId?: string | null;
  /** A media id: list the pictures like it (0354 media_similar) instead. */
  similarTo?: string | null;
  /** "product" limits to product-purpose pictures (the enrichment picker's default). */
  usage?: LibraryScope;
};

export type ImageSearchRead = {
  ok: boolean;
  /** In the order to show (best first). */
  assets: LibraryPickerAsset[];
  /** media id -> why-chips from media_similar (Find similar only). */
  chips: Map<string, string[]>;
  /** Plain words when something is not available yet (never a silent empty). */
  note: string | null;
};

const SIMILAR_LABEL: Record<string, string> = {
  "same-file": "Same file",
  "same-vendor": "Same vendor",
  "same-brand": "Same brand",
  "similar-name": "Similar name",
  "same-strain": "Same strain",
  "similar-label": "Similar label text",
  "same-category": "Same category",
};

/** The ordered pool for one search / find-similar request. Never throws. */
export async function readImageSearch(req: ImageSearchRequest): Promise<ImageSearchRead> {
  const empty = (note: string | null, ok = true): ImageSearchRead => ({ ok, assets: [], chips: new Map(), note });
  if (!isSupabaseServiceConfigured) return empty("The database isn't configured on this deployment.", false);
  try {
    const admin = createSupabaseAdminClient();
    const vendorId = cleanIds([req.vendorId])[0] ?? null;
    const brandId = cleanIds([req.brandId])[0] ?? null;
    const similarTo = cleanIds([req.similarTo])[0] ?? null;
    let ids: string[] = [];
    const chips = new Map<string, string[]>();
    if (similarTo) {
      const { data, error } = await admin.rpc("media_similar", { p_id: similarTo, p_limit: 48 });
      if (error) return empty(/does not exist|could not find|schema cache/i.test(error.message) ? "Find similar needs the 0354 database update." : error.message, false);
      for (const r of (data as { media_id: string; reasons: string[] | null }[] | null) ?? []) {
        ids.push(r.media_id);
        chips.set(r.media_id, (r.reasons ?? []).map((x) => SIMILAR_LABEL[x] ?? x));
      }
      // D244 R-4: photos that READ or LOOK like it (embeddings), fused by RRF.
      const near = await semanticNeighbors(similarTo, 48);
      if (near.length) {
        const textNear = near.filter((r) => r.kind === "text").map((r) => r.media_id);
        const imageNear = near.filter((r) => r.kind === "image").map((r) => r.media_id);
        for (const id of textNear) chips.set(id, [...(chips.get(id) ?? []), "Similar description"]);
        for (const id of imageNear) chips.set(id, [...(chips.get(id) ?? []), "Looks alike"]);
        ids = rrfFuse([ids, imageNear, textNear]).map((h) => h.id).slice(0, 72);
      }
    } else {
      const q = (req.query ?? "").trim();
      if (q.length >= 2) {
        const { data, error } = await admin.rpc("media_search", {
          p_query: q,
          p_vendor_id: req.scope === "vendor" ? vendorId : null,
          p_limit: SEARCH_HITS,
          p_offset: 0,
        });
        if (error) return empty(/does not exist|could not find|schema cache/i.test(error.message) ? "Search needs the 0352 database update." : error.message, false);
        ids = ((data as { media_id: string }[] | null) ?? []).map((r) => r.media_id).filter(Boolean);
        // D244 R-4: hybrid search - the word hits and the meaning hits (text and
        // picture embeddings) fused by Reciprocal Rank Fusion. Off = words only.
        const sem = await semanticSearch(q, 40);
        if (sem.length) {
          const words = new Set(ids);
          const semText = sem.filter((r) => r.kind === "text").map((r) => r.media_id);
          const semImage = sem.filter((r) => r.kind === "image").map((r) => r.media_id);
          for (const id of new Set([...semText, ...semImage])) if (!words.has(id)) chips.set(id, ["Matches by meaning"]);
          ids = rrfFuse([ids, semText, semImage]).map((h) => h.id).slice(0, SEARCH_HITS);
        }
      } else if ((req.scope === "vendor" && vendorId) || (req.scope === "brand" && brandId)) {
        const rows = await readScoped(admin, req.usage ?? "all", req.scope === "vendor" && vendorId ? [vendorId] : [], req.scope === "brand" && brandId ? [brandId] : []);
        ids = rows.map((r) => r.id);
      } else {
        return empty(req.scope === "all" ? "Type at least two letters to search the whole library." : "This product has no vendor / brand card yet. Search the whole library instead.");
      }
    }
    if (ids.length === 0) return { ok: true, assets: [], chips, note: null };
    const rows: Row[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await admin.from("media_assets").select(LIBRARY_PICKER_COLUMNS).in("id", ids.slice(i, i + 200)).range(0, 199);
      if (error) return empty(error.message, false);
      rows.push(...((data as Row[] | null) ?? []));
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const assets: LibraryPickerAsset[] = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (!r || r.status === "archived") continue;
      if (req.usage === "product" && r.usage_type !== "product") continue;
      if (!similarTo && req.scope === "brand" && brandId && (r.brand_id ?? "") !== brandId) continue;
      // D244 R-4: meaning hits come from the whole library; keep the vendor scope.
      if (!similarTo && req.scope === "vendor" && vendorId && (r.vendor_id ?? "") !== vendorId) continue;
      assets.push(toAsset(r));
    }
    return { ok: true, assets, chips, note: null };
  } catch (e) {
    return empty(e instanceof Error ? e.message : "Search failed.", false);
  }
}
