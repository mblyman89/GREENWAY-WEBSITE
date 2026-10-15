/**
 * src/lib/catalog/image-memory-server.ts — R51 (items 3, 4, 5), server half.
 *
 * Reads for the onboarding row's "Product images" panel, in a few bounded
 * reads for the WHOLE page, and the one memory write the attach action makes.
 *
 *   - product_image_memory (0279): what a person attached before, by identity
 *     key. A database without 0279 reads as "no memory" (never an error).
 *   - "on record": the galleries of product_enrichments and kb_products that
 *     share the identity key (0234 identity_key), i.e. images already approved
 *     for this product before the memory table existed.
 *   - the gallery of the enrichment the draft attaches to (suggestion key).
 *   - the media library (draft + published, never archived), ONE read.
 *
 * Identity keys per draft (same order everywhere): the 0234-stamped
 * catalog_product_drafts.identity_key first, then identityForDraft(row). Read
 * from both, write to the first, so the action and the page always agree.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { identityForDraft } from "@/lib/catalog/product-identity-core";
import { readLibraryPickerAssets } from "@/lib/media/library-picker-server";
import {
  isImageMemoryTableMissing,
  recommendImages,
  type ImageMemoryRow,
  type ImageMemorySource,
  type ImageRecommendView,
} from "./image-recommend-core";

export const IMAGE_MEMORY_SELECT = "identity_key, media_asset_id, times_confirmed, last_confirmed_at, source";
const READ_LIMIT = 2000;

export type ImageDraftRow = {
  id: string;
  name: string | null;
  brand_name: string | null;
  vendor_name: string | null;
  category: string | null;
  chosen_website_category?: string | null;
  identity_key?: string | null;
};

/** Identity keys for one draft, stamped key first. Never contains "". */
export function imageIdentityKeys(d: ImageDraftRow): string[] {
  const keys = [(d.identity_key ?? "").trim(), (identityForDraft(d).identityKey ?? "").trim()];
  return keys.filter((k, i) => k.length >= 3 && keys.indexOf(k) === i);
}

type MemRow = ImageMemoryRow & { identity_key: string };

export async function loadImageMemory(keys: readonly string[]): Promise<{ ok: boolean; missing: boolean; rows: MemRow[] }> {
  const uniq = Array.from(new Set(keys.filter(Boolean)));
  if (uniq.length === 0 || !isSupabaseServiceConfigured) return { ok: true, missing: false, rows: [] };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("product_image_memory")
      .select(IMAGE_MEMORY_SELECT)
      .in("identity_key", uniq)
      .order("last_confirmed_at", { ascending: false })
      .limit(READ_LIMIT);
    if (error) return isImageMemoryTableMissing(error) ? { ok: true, missing: true, rows: [] } : { ok: false, missing: false, rows: [] };
    return { ok: true, missing: false, rows: (data as MemRow[] | null) ?? [] };
  } catch {
    return { ok: false, missing: false, rows: [] };
  }
}

/** identity_key -> media ids in approved galleries (enrichments + KB products). */
export async function loadOnRecordImageIds(keys: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const uniq = Array.from(new Set(keys.filter(Boolean)));
  if (uniq.length === 0 || !isSupabaseServiceConfigured) return out;
  const admin = createSupabaseAdminClient();
  const add = (k: string | null | undefined, ids: unknown) => {
    if (!k || !Array.isArray(ids)) return;
    const cur = out.get(k) ?? [];
    for (const id of ids) if (typeof id === "string" && id && !cur.includes(id)) cur.push(id);
    out.set(k, cur);
  };
  // Each table read on its own: a database without 0234's column on one of
  // them still answers from the other.
  for (const table of ["product_enrichments", "kb_products"] as const) {
    try {
      const { data, error } = await admin.from(table).select("identity_key, image_media_ids").in("identity_key", uniq).limit(READ_LIMIT);
      if (error) continue;
      for (const r of (data as { identity_key: string | null; image_media_ids: unknown }[] | null) ?? []) add(r.identity_key, r.image_media_ids);
    } catch {
      /* best effort */
    }
  }
  return out;
}

/** pos_product_key -> gallery ids of that enrichment. */
export async function loadGalleryIds(posKeys: readonly (string | null)[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const uniq = Array.from(new Set(posKeys.map((k) => (k ?? "").trim()).filter(Boolean)));
  if (uniq.length === 0 || !isSupabaseServiceConfigured) return out;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("product_enrichments").select("pos_product_key, image_media_ids").in("pos_product_key", uniq).limit(READ_LIMIT);
    if (error) return out;
    for (const r of (data as { pos_product_key: string; image_media_ids: string[] | null }[] | null) ?? []) {
      out.set(r.pos_product_key, (r.image_media_ids ?? []).filter((x) => typeof x === "string"));
    }
  } catch {
    /* best effort */
  }
  return out;
}

export type OnboardingImagesRead = {
  /** draft id -> recommendations */
  views: Map<string, ImageRecommendView>;
  libraryOk: boolean;
  /** 0279 not applied yet: recommendations work, memory is not kept. */
  memoryMissing: boolean;
};

/**
 * Everything the panel needs for one page of drafts. `targetKeys` maps a
 * draft id to its suggestion key (waitingKeyForDraft), the enrichment the
 * Attach button writes to. Never throws.
 */
export async function loadOnboardingImageRecommendations(
  drafts: readonly ImageDraftRow[],
  targetKeys: ReadonlyMap<string, string | null>,
): Promise<OnboardingImagesRead> {
  const views = new Map<string, ImageRecommendView>();
  if (drafts.length === 0) return { views, libraryOk: true, memoryMissing: false };
  const keysByDraft = new Map(drafts.map((d) => [d.id, imageIdentityKeys(d)] as const));
  const allKeys = [...keysByDraft.values()].flat();
  const [library, memory, onRecord, galleries] = await Promise.all([
    readLibraryPickerAssets("all"),
    loadImageMemory(allKeys),
    loadOnRecordImageIds(allKeys),
    loadGalleryIds([...targetKeys.values()]),
  ]);
  for (const d of drafts) {
    const keys = keysByDraft.get(d.id) ?? [];
    const mem = memory.rows.filter((r) => keys.includes(r.identity_key));
    const rec = keys.flatMap((k) => onRecord.get(k) ?? []);
    const target = targetKeys.get(d.id) ?? null;
    views.set(
      d.id,
      recommendImages({
        assets: library.assets,
        product: { name: d.name, brand: d.brand_name, vendor: d.vendor_name, category: d.chosen_website_category ?? d.category },
        memory: mem,
        onRecordIds: rec,
        galleryIds: target ? galleries.get(target) ?? [] : [],
      }),
    );
  }
  return { views, libraryOk: library.ok, memoryMissing: memory.missing };
}

/**
 * Remember that a person attached `mediaId` to the product with `identityKey`.
 * Upsert by (identity_key, media_asset_id): +1 times_confirmed on repeat.
 * Returns `missing:true` when 0279 is not applied (the attach still landed).
 */
export async function rememberImageAttach(input: {
  identityKey: string;
  mediaId: string;
  posProductKey: string | null;
  source: ImageMemorySource;
  actorId: string | null;
}): Promise<{ ok: boolean; missing: boolean; error?: string }> {
  const key = (input.identityKey ?? "").trim();
  const mediaId = (input.mediaId ?? "").trim();
  if (key.length < 3 || !mediaId || !isSupabaseServiceConfigured) return { ok: false, missing: false, error: "Nothing to remember." };
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("product_image_memory")
    .select("id, times_confirmed")
    .eq("identity_key", key)
    .eq("media_asset_id", mediaId)
    .maybeSingle();
  if (error) return isImageMemoryTableMissing(error) ? { ok: false, missing: true } : { ok: false, missing: false, error: error.message };
  if (data) {
    const row = data as { id: string; times_confirmed: number | null };
    const { error: upErr } = await admin
      .from("product_image_memory")
      .update({
        times_confirmed: Math.max(1, Number(row.times_confirmed ?? 1)) + 1,
        last_confirmed_by: input.actorId,
        last_confirmed_at: now,
        last_pos_product_key: input.posProductKey,
      })
      .eq("id", row.id);
    return upErr ? { ok: false, missing: false, error: upErr.message } : { ok: true, missing: false };
  }
  const { error: insErr } = await admin.from("product_image_memory").insert({
    identity_key: key,
    media_asset_id: mediaId,
    source: input.source,
    last_pos_product_key: input.posProductKey,
    first_confirmed_by: input.actorId,
    last_confirmed_by: input.actorId,
    first_confirmed_at: now,
    last_confirmed_at: now,
  });
  if (insErr) {
    if (isImageMemoryTableMissing(insErr)) return { ok: false, missing: true };
    // A concurrent attach of the same pair already wrote it: that IS the memory.
    if ((insErr as { code?: string }).code === "23505") return { ok: true, missing: false };
    return { ok: false, missing: false, error: insErr.message };
  }
  return { ok: true, missing: false };
}
