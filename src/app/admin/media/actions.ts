"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { uploadMedia, updateMediaMeta, setMediaStatus, whereUsed, getMedia } from "@/lib/media/store";
import { generate, isAiConfigured } from "@/lib/ai/provider";
import { COMPLIANCE_SYSTEM, checkCompliance } from "@/lib/ai/compliance";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB ceiling for the library
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "application/pdf",
]);

function orNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

function tagsFromForm(v: FormDataEntryValue | null): string[] {
  return String(v ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Upload one or more files into the media library. */
export async function uploadMediaAction(formData: FormData): Promise<void> {
  const session = await requirePermission("media.manage");

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const single = formData.get("file");
  if (single instanceof File && single.size > 0) files.push(single);

  if (files.length === 0) {
    redirect("/admin/media?error=" + encodeURIComponent("Choose at least one file to upload."));
  }

  const usageType = orNull(formData.get("usage_type")) ?? undefined;
  const tags = tagsFromForm(formData.get("tags"));
  const altText = orNull(formData.get("alt_text")) ?? undefined;
  const status = String(formData.get("status") ?? "draft") === "published" ? "published" : "draft";

  let uploaded = 0;
  for (const file of files) {
    if (!ALLOWED_MIME.has(file.type)) {
      redirect("/admin/media?error=" + encodeURIComponent(`Unsupported type: ${file.type || file.name}. Allowed: PNG, JPG, WEBP, GIF, SVG, PDF.`));
    }
    if (file.size > MAX_BYTES) {
      redirect("/admin/media?error=" + encodeURIComponent(`${file.name} exceeds 10 MB.`));
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const asset = await uploadMedia({
      buffer,
      filename: file.name,
      mimeType: file.type,
      usageType,
      tags,
      altText,
      uploadedBy: session.userId,
      status,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "media.uploaded",
      entityType: "media_asset",
      entityId: asset.id,
    });
    uploaded += 1;
  }

  revalidatePath("/admin/media");
  redirect(`/admin/media?saved=${uploaded}`);
}

/** Update metadata for a single asset. */
export async function updateMediaMetaAction(formData: FormData): Promise<void> {
  const session = await requirePermission("media.manage");
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin/media?error=" + encodeURIComponent("Missing media id."));

  await updateMediaMeta(id, {
    title: orNull(formData.get("title")) ?? undefined,
    alt_text: orNull(formData.get("alt_text")) ?? undefined,
    description: orNull(formData.get("description")) ?? undefined,
    usage_type: orNull(formData.get("usage_type")) ?? undefined,
    tags: tagsFromForm(formData.get("tags")),
  });

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "media.meta_updated",
    entityType: "media_asset",
    entityId: id,
  });

  revalidatePath("/admin/media");
  revalidatePath(`/admin/media/${id}`);
  redirect(`/admin/media/${id}?saved=1`);
}

/** Publish / unpublish / archive an asset. */
export async function setMediaStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("media.manage");
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("status") ?? "draft");
  const status = raw === "published" ? "published" : raw === "archived" ? "archived" : "draft";
  const returnTo = String(formData.get("returnTo") ?? `/admin/media/${id}`);
  if (!id) redirect("/admin/media?error=" + encodeURIComponent("Missing media id."));

  await setMediaStatus(id, status);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: `media.${status}`,
    entityType: "media_asset",
    entityId: id,
  });

  revalidatePath("/admin/media");
  revalidatePath(`/admin/media/${id}`);
  redirect(`${returnTo}?saved=1`);
}

/**
 * Delete an asset. Guarded: refuses to delete if the asset is currently used
 * by any entity. The caller must archive/replace first.
 */
export async function deleteMediaAction(formData: FormData): Promise<void> {
  const session = await requirePermission("media.manage");
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin/media?error=" + encodeURIComponent("Missing media id."));

  const used = await whereUsed(id);
  if (used.length > 0) {
    redirect(`/admin/media/${id}?error=` + encodeURIComponent(`Cannot delete: in use by ${used.length} place(s). Replace or archive it first.`));
  }

  const asset = await getMedia(id);
  const admin = createSupabaseAdminClient();

  // Remove the storage object first (best-effort), then the row.
  if (asset?.storage_key) {
    await admin.storage.from("media").remove([asset.storage_key]);
  }
  const { error } = await admin.from("media_assets").delete().eq("id", id);
  if (error) redirect(`/admin/media/${id}?error=` + encodeURIComponent(error.message));

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "media.deleted",
    entityType: "media_asset",
    entityId: id,
  });

  revalidatePath("/admin/media");
  redirect("/admin/media?deleted=1");
}

/**
 * Client-callable: suggest descriptive alt text for an asset based on its
 * title / filename / usage / tags context. Drafts-only — returns a suggestion
 * the staffer accepts/edits before saving via updateMediaMetaAction.
 *
 * Note: this is a context-based suggestion (not image vision); it gives a solid
 * starting point that the human refines for accuracy.
 */
export type MediaAltResult =
  | { ok: true; value: string; complianceFlags: string[] }
  | { ok: false; error: string };

export async function suggestMediaAltAction(id: string): Promise<MediaAltResult> {
  const session = await requirePermission("media.manage");
  if (!isAiConfigured) {
    return { ok: false, error: "AI is not configured. Set AI_API_KEY to enable suggestions." };
  }
  const asset = await getMedia(id);
  if (!asset) return { ok: false, error: "Asset not found." };

  const context = [
    asset.title ? `Title: ${asset.title}` : null,
    asset.filename ? `Filename: ${asset.filename}` : null,
    asset.usage_type ? `Used as: ${asset.usage_type}` : null,
    asset.tags && asset.tags.length ? `Tags: ${asset.tags.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const user = `Write ALT TEXT for an image used on a licensed Washington cannabis retailer's website, following all rules. Alt text describes the image for screen-reader users and SEO. Return ONE plain sentence, 8-16 words, no quotes, no "image of"/"photo of" prefix, tasteful and adult-oriented. Base it on this context:\n\n${context || "A brand image for the website."}`;

  try {
    const text = await generate({ system: COMPLIANCE_SYSTEM, user, temperature: 0.5, maxTokens: 60 });
    const clean = text.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ").trim();
    const flags = checkCompliance(clean).flags;
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "media.ai_alt_text",
      entityType: "media_asset",
      entityId: id,
      after: { complianceFlags: flags },
    });
    return { ok: true, value: clean, complianceFlags: flags };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI suggestion failed." };
  }
}
