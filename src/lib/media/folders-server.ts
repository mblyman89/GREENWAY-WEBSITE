/**
 * src/lib/media/folders-server.ts — R65 S2. Gathers WHERE every media asset is
 * used so folders-core can file it (products in use, pages, specials cards).
 *
 * Read-only, best-effort: every source is optional (a missing table / column
 * just contributes nothing), so the library never breaks because one source
 * is unavailable.
 *
 * Sources (all verified in migrations):
 *   media_usages                       — every recordUsage() call
 *   product_enrichments / kb_products  — primary_media_id + image_media_ids (product galleries)
 *   vendors / brands                   — logo_media_id / hero_media_id
 *   blog_posts / newsletter_assets     — hero/og/pdf/page media ids
 *   home_carousel_slides               — Home page (image_media_id + image URL columns)
 *   shop_carousel_slides               — Shop / Menu page (media ids + presentation JSON)
 *   page_sections                      — page_slug (media id + image + settings JSON)
 *   content_blocks                     — page + block_key (values embed the public URL)
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import type { MediaAsset } from "@/lib/supabase/types";
import { NO_USE, type FolderUse } from "./folders-core";

type Row = Record<string, unknown>;
const PRODUCT_ENTITIES = new Set(["product", "kb_product", "cultivera_strain"]);
const PAGE_SIZE = 1000;

/** Page through a table (Supabase caps a single read at 1000 rows). */
async function readAll(table: string, cols: string, max = 20000): Promise<Row[]> {
  const admin = createSupabaseAdminClient();
  const out: Row[] = [];
  try {
    for (let from = 0; from < max; from += PAGE_SIZE) {
      const { data, error } = await admin.from(table).select(cols).range(from, from + PAGE_SIZE - 1);
      if (error || !data) break;
      out.push(...(data as unknown as Row[]));
      if (data.length < PAGE_SIZE) break;
    }
  } catch {
    /* optional source */
  }
  return out;
}

/** Every media asset (paged — the old page only ever showed the newest 200). */
export async function listAllMedia(): Promise<MediaAsset[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const out: MediaAsset[] = [];
  for (let from = 0; from < 20000; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("media_assets")
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error || !data) break;
    out.push(...(data as MediaAsset[]));
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}

const KEY_RE = /\/object\/public\/media\/([^"'\s)?#\\<>]+)/g;

/** Storage keys embedded in any value (URL form), decoded. */
function keysIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(KEY_RE)) {
    try {
      out.push(decodeURIComponent(m[1]!));
    } catch {
      out.push(m[1]!);
    }
  }
  return out;
}

function ids(v: unknown): string[] {
  if (typeof v === "string" && v) return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && !!x);
  return [];
}

/**
 * PERF-S10: the 11 "where is this used" source reads do not depend on the
 * asset list, so the media page starts them IN PARALLEL with listAllMedia()
 * and countMedia() and joins afterwards (buildMediaUses(assets, sources)).
 */
export function loadMediaUseSources() {
  return Promise.all([
    readAll("media_usages", "media_asset_id,entity_type"),
    readAll("product_enrichments", "primary_media_id,image_media_ids"),
    readAll("kb_products", "primary_media_id,image_media_ids"),
    readAll("vendors", "logo_media_id,hero_media_id"),
    readAll("brands", "logo_media_id"),
    readAll("blog_posts", "hero_media_id,og_media_id"),
    readAll("newsletter_assets", "pdf_media_id,page_media_ids"),
    readAll("home_carousel_slides", "*", 200),
    readAll("shop_carousel_slides", "*", 200),
    readAll("page_sections", "*", 1000),
    readAll("content_blocks", "page,block_key,published_value,draft_value", 5000),
  ]);
}
export type MediaUseSources = Awaited<ReturnType<typeof loadMediaUseSources>>;

export async function buildMediaUses(
  assets: MediaAsset[],
  preloaded?: Promise<MediaUseSources> | MediaUseSources,
): Promise<Map<string, FolderUse>> {
  const uses = new Map<string, FolderUse>();
  if (!isSupabaseServiceConfigured || assets.length === 0) return uses;
  const byKey = new Map(assets.map((a) => [a.storage_key, a.id]));
  const known = new Set(assets.map((a) => a.id));
  const get = (id: string): FolderUse | null => {
    if (!known.has(id)) return null;
    let u = uses.get(id);
    if (!u) {
      u = { ...NO_USE, pages: [], slots: [] };
      uses.set(id, u);
    }
    return u;
  };
  const mark = (id: string, opts: { product?: boolean; page?: string; slot?: string }) => {
    const u = get(id);
    if (!u) return;
    u.anywhere = true;
    if (opts.product) u.onProduct = true;
    if (opts.page && !u.pages.includes(opts.page)) u.pages.push(opts.page);
    if (opts.slot && !u.slots.includes(opts.slot)) u.slots.push(opts.slot);
  };
  const markText = (text: string, opts: { page?: string; slot?: string }) => {
    for (const k of keysIn(text)) {
      const id = byKey.get(k);
      if (id) mark(id, opts);
    }
  };

  const [usages, enr, kb, vendors, brands, blog, news, home, shop, sections, blocks] = await (preloaded ?? loadMediaUseSources());

  for (const r of usages) {
    const id = String(r.media_asset_id ?? "");
    const et = String(r.entity_type ?? "");
    mark(id, { product: PRODUCT_ENTITIES.has(et) });
  }
  for (const r of [...enr, ...kb]) for (const id of [...ids(r.primary_media_id), ...ids(r.image_media_ids)]) mark(id, { product: true });
  for (const r of [...vendors, ...brands]) for (const id of [...ids(r.logo_media_id), ...ids(r.hero_media_id)]) mark(id, {});
  for (const r of blog) for (const id of [...ids(r.hero_media_id), ...ids(r.og_media_id)]) mark(id, { page: "blog" });
  for (const r of news) for (const id of [...ids(r.pdf_media_id), ...ids(r.page_media_ids)]) mark(id, { page: "blog" });
  for (const r of home) {
    for (const id of ids(r.image_media_id)) mark(id, { page: "home" });
    markText(JSON.stringify(r), { page: "home" });
  }
  for (const r of shop) {
    for (const id of [...ids(r.image_media_id), ...ids(r.image_media_id_mobile)]) mark(id, { page: "menu" });
    markText(JSON.stringify(r), { page: "menu" });
  }
  for (const r of sections) {
    const page = String(r.page_slug ?? "") || undefined;
    for (const id of ids(r.image_media_id)) mark(id, { page });
    markText(JSON.stringify(r), { page });
  }
  for (const r of blocks) {
    const text = `${r.published_value ?? ""}\n${r.draft_value ?? ""}`;
    if (!text.includes("/object/public/media/")) continue;
    markText(text, { page: String(r.page ?? "") || undefined, slot: String(r.block_key ?? "") || undefined });
  }
  return uses;
}
