/**
 * src/lib/media/store.ts
 *
 * Server-side media library service: upload assets to the private `media`
 * bucket, create/update media_assets rows, track usage, and publish/archive.
 *
 * Published assets are publicly readable (RLS in migration 0003) so they can be
 * served as logos/banners; drafts stay staff-only.
 */
import "server-only";
import crypto from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured, supabaseUrl } from "@/lib/supabase/env";
import type { MediaAsset } from "@/lib/supabase/types";

const MEDIA_BUCKET = "media";

export function publicUrlForKey(storageKey: string): string | null {
  if (!supabaseUrl) return null;
  return `${supabaseUrl}/storage/v1/object/public/${MEDIA_BUCKET}/${storageKey}`;
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
