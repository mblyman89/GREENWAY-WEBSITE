"use server";

/**
 * D224 — Menu Card Fallbacks: set / change / remove the one picture per
 * website category that shows on every card in that category without a
 * photo of its own.
 *
 * Three actions, one per button on the page:
 *   - uploadFallbackAction: a new picture from the computer. It goes into the
 *     media library first (same checks as the Media Library upload: size cap,
 *     type list, and the bytes must really be that type), then becomes the
 *     category's fallback.
 *   - pickFallbackAction: a picture already in the media library.
 *   - clearFallbackAction: remove the fallback; cards go back to the older
 *     generic substitutes or the mockup.
 * Each one writes an audit row (before/after), keeps the media "Where used"
 * ledger honest, and clears the public menu caches so the shop updates at
 * once. Every decision lives in src/lib/menu/menu-card-fallback-core.ts.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { checkFileSignature } from "@/lib/media/file-signature-core";
import { uploadMedia, recordUsage, clearUsage } from "@/lib/media/store";
import { MEDIA_UPLOAD_MAX_BYTES } from "@/lib/media/gif-core";
import { revalidatePublicMenuSurfaces } from "@/lib/site/public-surfaces";
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";
import {
  MENU_CARD_FALLBACK_PAGE,
  MENU_CARD_FALLBACK_ENTITY,
  MENU_CARD_FALLBACK_FIELD,
  parseFallbackCategory,
  parseMediaId,
  fallbackUploadProblem,
  type FallbackCategory,
} from "@/lib/menu/menu-card-fallback-core";
import {
  currentFallbackMediaId,
  fallbackMediaExists,
  setMenuCardFallback,
  clearMenuCardFallback,
  type FallbackWriteResult,
} from "@/lib/menu/menu-card-fallback-server";

const PERMISSION = "products.enrich" as const;

function back(kind: "msg" | "error", text: string, category?: string | null): never {
  const anchor = category ? `#cat-${category}` : "";
  redirect(`${MENU_CARD_FALLBACK_PAGE}?${kind}=${encodeURIComponent(text)}${anchor}`);
}

function writeProblem(r: Exclude<FallbackWriteResult, { ok: true }>): string {
  if (r.reason === "missing_table") return "Migration 0355 has not been applied yet, so fallbacks cannot be saved. Apply it in Supabase, then try again.";
  if (r.reason === "permission") return "The database refused the save (permission). Re-apply migration 0355, then try again.";
  return `That did not save: ${r.message}`;
}

function nameOf(category: FallbackCategory): string {
  return formatWebsiteCategory(category);
}

async function setAndRecord(
  session: { userId: string; email: string; profile: { id: string } },
  category: FallbackCategory,
  mediaId: string,
  how: "upload" | "library",
): Promise<FallbackWriteResult> {
  const before = await currentFallbackMediaId(category);
  const r = await setMenuCardFallback(category, mediaId, session.profile.id ?? null);
  if (!r.ok) return r;
  await recordUsage(mediaId, MENU_CARD_FALLBACK_ENTITY, category, MENU_CARD_FALLBACK_FIELD).catch(() => undefined);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "menu_card_fallback.set",
    entityType: MENU_CARD_FALLBACK_ENTITY,
    entityId: category,
    before: { media_id: before },
    after: { media_id: mediaId, via: how },
  });
  revalidatePublicMenuSurfaces();
  revalidatePath(MENU_CARD_FALLBACK_PAGE);
  return { ok: true };
}

/** Upload a new picture and make it the category's fallback. */
export async function uploadFallbackAction(formData: FormData): Promise<void> {
  const session = await requirePermission(PERMISSION);
  const category = parseFallbackCategory(formData.get("category"));
  if (!category) back("error", "Pick a website category first.");

  const file = formData.get("file");
  if (!(file instanceof File)) back("error", "Choose a picture to upload.", category);
  const problem = fallbackUploadProblem(file, MEDIA_UPLOAD_MAX_BYTES);
  if (problem) back("error", problem, category);

  const buffer = Buffer.from(await file.arrayBuffer());
  // R45-S2 (OWASP): prove the type from the bytes, not the browser label.
  const sig = checkFileSignature(file.type, new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), file.name);
  if (!sig.ok) back("error", sig.error, category);

  let mediaId: string;
  try {
    const asset = await uploadMedia({
      buffer,
      filename: file.name,
      mimeType: file.type,
      title: `${nameOf(category)} menu card fallback`,
      altText: `${nameOf(category)} product`,
      usageType: "product",
      tags: ["menu-card-fallback", category],
      uploadedBy: session.userId,
      status: "published",
    });
    mediaId = asset.id;
  } catch (err) {
    back("error", `The upload failed: ${err instanceof Error ? err.message : String(err)}`, category);
  }

  const r = await setAndRecord(session, category, mediaId, "upload");
  if (!r.ok) back("error", writeProblem(r), category);
  back("msg", `Saved. ${nameOf(category)} cards without their own photo now show this picture.`, category);
}

/** Use a picture that is already in the media library. */
export async function pickFallbackAction(formData: FormData): Promise<void> {
  const session = await requirePermission(PERMISSION);
  const category = parseFallbackCategory(formData.get("category"));
  if (!category) back("error", "Pick a website category first.");
  const mediaId = parseMediaId(formData.get("mediaId"));
  if (!mediaId) back("error", "That picture could not be found. Search again and pick it.", category);
  if (!(await fallbackMediaExists(mediaId))) {
    back("error", "That picture is not an image in the media library (or it is archived). Pick another one.", category);
  }

  const r = await setAndRecord(session, category, mediaId, "library");
  if (!r.ok) back("error", writeProblem(r), category);
  back("msg", `Saved. ${nameOf(category)} cards without their own photo now show this picture.`, category);
}

/** Remove the category's fallback. */
export async function clearFallbackAction(formData: FormData): Promise<void> {
  const session = await requirePermission(PERMISSION);
  const category = parseFallbackCategory(formData.get("category"));
  if (!category) back("error", "Pick a website category first.");

  const before = await currentFallbackMediaId(category);
  const r = await clearMenuCardFallback(category);
  if (!r.ok) back("error", writeProblem(r), category);
  await clearUsage(MENU_CARD_FALLBACK_ENTITY, category, MENU_CARD_FALLBACK_FIELD).catch(() => undefined);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "menu_card_fallback.cleared",
    entityType: MENU_CARD_FALLBACK_ENTITY,
    entityId: category,
    before: { media_id: before },
    after: { media_id: null },
  });
  revalidatePublicMenuSurfaces();
  revalidatePath(MENU_CARD_FALLBACK_PAGE);
  back("msg", `Removed. ${nameOf(category)} cards without a photo go back to the generic fallback or the mockup. The picture stays in the media library.`, category);
}
