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

const BASE_COLUMNS =
  "id, storage_key, public_url, filename, title, alt_text, tags, usage_type, status, mime_type, license_status, created_at";
/** D221 M1 (0352) columns. */
const V2_COLUMNS = "vendor_id, brand_id, product_name, visible_text, ai_caption, role";
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
