"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { uploadMedia, updateMediaMeta, setMediaStatus, whereUsed, getMedia, publicUrlForKey } from "@/lib/media/store";
import { generate, generateVision, isAiConfigured } from "@/lib/ai/provider";
import { COMPLIANCE_SYSTEM, checkCompliance } from "@/lib/ai/compliance";
import { normalizeTags } from "@/lib/media/taxonomy";

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
  // Normalise to our kebab-case placement convention + de-dupe + cap.
  return normalizeTags(String(v ?? ""));
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
  // A single shared title only makes sense for one file; for batches let each
  // asset default to its filename (staff rename per-asset afterward).
  const sharedTitle = files.length === 1 ? orNull(formData.get("title")) ?? undefined : undefined;
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
      title: sharedTitle,
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
 * Client-callable: suggest descriptive alt text for an asset. When the image is
 * a publicly-reachable raster (the AI provider can fetch it), this uses true
 * IMAGE VISION — the model actually looks at the picture. Otherwise (SVG, or no
 * public URL yet) it falls back to a context-based suggestion from the title /
 * filename / usage / tags. Drafts-only — the staffer accepts/edits before
 * saving via updateMediaMetaAction. The result reports which method was used.
 */
export type MediaAltResult =
  | { ok: true; value: string; complianceFlags: string[]; method: "vision" | "context" }
  | { ok: false; error: string };

const VISION_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);

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

  // Decide whether we can use true vision: a fetchable URL + a raster mime type.
  const imageUrl = asset.public_url ?? publicUrlForKey(asset.storage_key);
  const canUseVision = Boolean(imageUrl) && VISION_MIME.has((asset.mime_type ?? "").toLowerCase());

  const ctx = { entityType: "media", entityId: id, actorId: session.userId, actorEmail: session.email };

  try {
    let raw: string;
    let method: "vision" | "context";

    if (canUseVision) {
      method = "vision";
      raw = await generateVision({
        system: COMPLIANCE_SYSTEM,
        user: `Look at this image used on a licensed Washington cannabis retailer's website and write ALT TEXT for it, following all rules. Alt text describes the image for screen-reader users and SEO. Return ONE plain sentence, 8-16 words, no quotes, no "image of"/"photo of" prefix, tasteful and adult-oriented. Describe what is actually visible (subject, setting, colors, mood). Extra context if helpful:\n${context || "(none provided)"}`,
        imageUrl: imageUrl!,
        temperature: 0.5,
        maxTokens: 80,
        context: { ...ctx, feature: "media.alt_text" },
      });
    } else {
      method = "context";
      raw = await generate({
        system: COMPLIANCE_SYSTEM,
        user: `Write ALT TEXT for an image used on a licensed Washington cannabis retailer's website, following all rules. Alt text describes the image for screen-reader users and SEO. Return ONE plain sentence, 8-16 words, no quotes, no "image of"/"photo of" prefix, tasteful and adult-oriented. Base it on this context:\n\n${context || "A brand image for the website."}`,
        temperature: 0.5,
        maxTokens: 60,
        context: { ...ctx, feature: "media.alt_text" },
      });
    }

    const clean = raw.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ").trim();
    const flags = checkCompliance(clean).flags;
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "media.ai_alt_text",
      entityType: "media_asset",
      entityId: id,
      after: { complianceFlags: flags, method },
    });
    return { ok: true, value: clean, complianceFlags: flags, method };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI suggestion failed." };
  }
}

/**
 * Client-callable: auto-fetch a suggested TITLE + DESCRIPTION for an asset.
 * Uses true image vision when the asset is a fetchable raster; otherwise falls
 * back to a context-based suggestion from filename / usage / tags. Drafts-only:
 * the staffer reviews/edits before saving. Returns both fields plus the method.
 */
export type MediaMetaResult =
  | { ok: true; title: string; description: string; method: "vision" | "context" }
  | { ok: false; error: string };

export async function suggestMediaMetaAction(id: string): Promise<MediaMetaResult> {
  const session = await requirePermission("media.manage");
  if (!isAiConfigured) {
    return { ok: false, error: "AI is not configured. Set AI_API_KEY to enable suggestions." };
  }
  const asset = await getMedia(id);
  if (!asset) return { ok: false, error: "Asset not found." };

  const context = [
    asset.filename ? `Filename: ${asset.filename}` : null,
    asset.usage_type ? `Purpose: ${asset.usage_type}` : null,
    asset.tags && asset.tags.length ? `Placement tags: ${asset.tags.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const imageUrl = asset.public_url ?? publicUrlForKey(asset.storage_key);
  const canUseVision = Boolean(imageUrl) && VISION_MIME.has((asset.mime_type ?? "").toLowerCase());
  const ctx = { entityType: "media", entityId: id, actorId: session.userId, actorEmail: session.email };

  const instruction =
    `For an image in a licensed Washington cannabis retailer's media library, return STRICT JSON ` +
    `{"title": "...", "description": "..."} and nothing else. ` +
    `title = a short human-friendly label (2-6 words, Title Case, NOT a filename). ` +
    `description = one tasteful sentence about what the asset is and where it would be used. ` +
    `Follow all compliance rules. Context:\n${context || "(none provided)"}`;

  try {
    let raw: string;
    let method: "vision" | "context";
    if (canUseVision) {
      method = "vision";
      raw = await generateVision({
        system: COMPLIANCE_SYSTEM,
        user: instruction,
        imageUrl: imageUrl!,
        temperature: 0.5,
        maxTokens: 160,
        context: { ...ctx, feature: "media.meta" },
      });
    } else {
      method = "context";
      raw = await generate({
        system: COMPLIANCE_SYSTEM,
        user: instruction,
        temperature: 0.5,
        maxTokens: 160,
        context: { ...ctx, feature: "media.meta" },
      });
    }

    let title = "";
    let description = "";
    try {
      const jsonStart = raw.indexOf("{");
      const jsonEnd = raw.lastIndexOf("}");
      const parsed = JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart, jsonEnd + 1) : raw);
      title = String(parsed.title ?? "").trim();
      description = String(parsed.description ?? "").trim();
    } catch {
      // If the model didn't return JSON, treat the whole thing as a description.
      description = raw.trim().replace(/\s+/g, " ");
    }

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "media.ai_meta",
      entityType: "media_asset",
      entityId: id,
      after: { method },
    });
    return { ok: true, title, description, method };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI suggestion failed." };
  }
}
