/**
 * src/lib/media/store.ts
 *
 * Server-side media library service (split delivery model — migration 0012):
 *   • PUBLIC `media` bucket  → website-facing imagery (logos, banners, hero /
 *     carousel, blog covers, product images). Served via the public CDN
 *     endpoint with stable, cacheable URLs.
 *   • PRIVATE `media-private` bucket → restricted documents (newsletter PDFs and
 *     any future private files). Served ONLY through short-lived signed URLs.
 *
 * This is the industry-standard approach (Wix / Squarespace / Shopify): public
 * read for content meant to be displayed, signed URLs for restricted files.
 */
import "server-only";
import crypto from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured, supabaseUrl } from "@/lib/supabase/env";
import type { MediaAsset } from "@/lib/supabase/types";

/** Public bucket for site imagery (public = true after migration 0012). */
const MEDIA_BUCKET = "media";
/** Private bucket for restricted documents (newsletter PDFs, etc.). */
export const MEDIA_PRIVATE_BUCKET = "media-private";

/**
 * Stable public CDN URL for an image stored in the public `media` bucket. Only
 * valid once the bucket is public (migration 0012); before that the endpoint
 * 400s, which is exactly the blank-thumbnail bug this migration fixes.
 */
export function publicUrlForKey(storageKey: string): string | null {
  if (!supabaseUrl) return null;
  return `${supabaseUrl}/storage/v1/object/public/${MEDIA_BUCKET}/${storageKey}`;
}

/**
 * Mint a short-lived signed URL for a restricted file in the PRIVATE bucket
 * (e.g. a newsletter PDF). Default expiry 1 hour. Returns null if storage is
 * not configured or signing fails.
 */
export async function signedUrlForPrivateKey(
  storageKey: string,
  expiresInSeconds = 60 * 60,
): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.storage
      .from(MEDIA_PRIVATE_BUCKET)
      .createSignedUrl(storageKey, expiresInSeconds);
    if (error || !data) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

export type UploadMediaInput = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  altText?: string;
  title?: string;
  usageType?: string; // e.g. "vendor-logo", "brand-logo", "hero", "banner"
  tags?: string[];
  uploadedBy: string | null;
  status?: "draft" | "published";
};

export async function uploadMedia(input: UploadMediaInput): Promise<MediaAsset> {
  const admin = createSupabaseAdminClient();
  const hash = crypto.createHash("sha256").update(input.buffer).digest("hex");
  const ext = extFromFilename(input.filename) || extFromMime(input.mimeType);
  const folder = input.usageType ? input.usageType.replace(/[^a-z0-9-]/gi, "-") : "uploads";
  const storageKey = `${folder}/${hash.slice(0, 16)}-${sanitize(input.filename)}${ext && !input.filename.toLowerCase().endsWith(ext) ? ext : ""}`;

  const { error: upErr } = await admin.storage.from(MEDIA_BUCKET).upload(storageKey, input.buffer, {
    contentType: input.mimeType,
    upsert: true,
  });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  const { data, error } = await admin
    .from("media_assets")
    .insert({
      storage_key: storageKey,
      public_url: publicUrlForKey(storageKey),
      filename: input.filename,
      mime_type: input.mimeType,
      size_bytes: input.buffer.length,
      alt_text: input.altText ?? null,
      title: input.title ?? input.filename,
      usage_type: input.usageType ?? null,
      tags: input.tags ?? [],
      status: input.status ?? "draft",
      uploaded_by: input.uploadedBy,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`media_assets insert failed: ${error?.message}`);
  return data as MediaAsset;
}

export async function listMedia(opts?: { usageType?: string; status?: string; limit?: number }): Promise<MediaAsset[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin.from("media_assets").select("*").order("created_at", { ascending: false }).limit(opts?.limit ?? 200);
  if (opts?.usageType) q = q.eq("usage_type", opts.usageType);
  if (opts?.status) q = q.eq("status", opts.status);
  const { data } = await q;
  return (data as MediaAsset[] | null) ?? [];
}

/**
 * Batch-resolve a set of media asset ids to their public URLs. Returns a Map
 * keyed by media id; ids without a published/known asset are simply absent.
 * Used by visual grids (products) to render thumbnails without N+1 queries.
 */
export async function resolveMediaUrls(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0 || !isSupabaseServiceConfigured) return out;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("media_assets")
    .select("id, storage_key")
    .in("id", unique);
  for (const row of (data as { id: string; storage_key: string }[] | null) ?? []) {
    const url = publicUrlForKey(row.storage_key);
    if (url) out.set(row.id, url);
  }
  return out;
}

export async function getMedia(id: string): Promise<MediaAsset | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("media_assets").select("*").eq("id", id).maybeSingle();
  return (data as MediaAsset | null) ?? null;
}

export async function setMediaStatus(id: string, status: "draft" | "published" | "archived"): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("media_assets").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function updateMediaMeta(
  id: string,
  meta: { alt_text?: string; title?: string; description?: string; tags?: string[]; usage_type?: string },
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("media_assets").update(meta).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Record that an asset is used by an entity (vendor/brand/etc.) at a field. */
export async function recordUsage(mediaAssetId: string, entityType: string, entityId: string, fieldKey: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  // Clear any prior usage for this exact slot, then record the new one.
  await admin.from("media_usages").delete().match({ entity_type: entityType, entity_id: entityId, field_key: fieldKey });
  await admin.from("media_usages").insert({ media_asset_id: mediaAssetId, entity_type: entityType, entity_id: entityId, field_key: fieldKey });
}

export async function whereUsed(mediaAssetId: string): Promise<{ entity_type: string; entity_id: string; field_key: string | null }[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("media_usages")
    .select("entity_type, entity_id, field_key")
    .eq("media_asset_id", mediaAssetId);
  return (data as { entity_type: string; entity_id: string; field_key: string | null }[] | null) ?? [];
}

export async function countMedia(): Promise<{ total: number; published: number }> {
  if (!isSupabaseServiceConfigured) return { total: 0, published: 0 };
  const admin = createSupabaseAdminClient();
  const [{ count: total }, { count: published }] = await Promise.all([
    admin.from("media_assets").select("id", { count: "exact", head: true }),
    admin.from("media_assets").select("id", { count: "exact", head: true }).eq("status", "published"),
  ]);
  return { total: total ?? 0, published: published ?? 0 };
}

function sanitize(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60) || "asset";
}
function extFromFilename(name: string): string {
  const m = name.toLowerCase().match(/\.(png|jpe?g|webp|gif|svg|pdf)$/);
  return m ? `.${m[1]}` : "";
}
function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "application/pdf": ".pdf",
  };
  return map[mime] ?? "";
}
