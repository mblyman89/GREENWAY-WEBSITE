"use server";

/**
 * D224 + D225 — Menu Card Fallbacks: the pictures for each website category
 * that show on every card in that category without a photo of its own.
 *
 * D225 (owner): "I want to be able to add many fallback images to the
 * categories, so that the menu has a variety of images used." A category now
 * holds a list (owner order, up to MAX_FALLBACKS_PER_CATEGORY).
 *
 * Five actions, one per button on the page:
 *   - uploadFallbackAction: one or more new pictures from the computer. Each
 *     goes into the media library first (same checks as the Media Library
 *     upload: size cap, type list, and the bytes must really be that type),
 *     then is added to the END of the category list.
 *   - pickFallbackAction: add a picture already in the media library.
 *   - removeFallbackPictureAction: take one picture out of the list.
 *   - moveFallbackAction: move one picture up or down (the first one is what
 *     a product page shows when its stable pick lands there, and the order
 *     the cards rotate in).
 *   - clearFallbackAction: remove every picture; cards go back to the older
 *     generic substitutes or the mockup.
 * Each one writes an audit row (before/after), keeps the media "Where used"
 * ledger honest (one slot per picture: field image:<media id>), and clears
 * the public menu caches so the shop updates at once. Every decision lives
 * in src/lib/menu/menu-card-fallback-core.ts.
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
  MAX_FALLBACKS_PER_CATEGORY,
  fallbackUsageField,
  parseFallbackCategory,
  parseMediaId,
  fallbackUploadProblem,
  movedOrder,
  roomFor,
  type FallbackCategory,
} from "@/lib/menu/menu-card-fallback-core";
import {
  currentFallbackList,
  fallbackMediaExists,
  addMenuCardFallbacks,
  removeMenuCardFallback,
  reorderMenuCardFallbacks,
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
  if (r.reason === "missing_0356") return "Migration 0356 has not been applied yet, so a category can hold only one picture and cannot be re-ordered. Apply it in Supabase, then try again.";
  if (r.reason === "permission") return "The database refused the save (permission). Re-apply migrations 0355 and 0356, then try again.";
  if (r.reason === "full") return `This category already has ${MAX_FALLBACKS_PER_CATEGORY} pictures, the most it can hold. Remove one first.`;
  return `That did not save: ${r.message}`;
}

function nameOf(category: FallbackCategory): string {
  return formatWebsiteCategory(category);
}

type Session = { userId: string; email: string; profile: { id: string } };

async function listOrEmpty(category: FallbackCategory): Promise<string[]> {
  try {
    return (await currentFallbackList(category)).mediaIds;
  } catch {
    return [];
  }
}

/**
 * Keep the "Where used" ledger equal to the list: one slot per picture, the
 * D224 single slot (field "image") retired, removed pictures cleared.
 */
async function syncUsage(category: FallbackCategory, before: readonly string[], after: readonly string[]): Promise<void> {
  await clearUsage(MENU_CARD_FALLBACK_ENTITY, category, MENU_CARD_FALLBACK_FIELD).catch(() => undefined);
  for (const id of before) {
    if (!after.includes(id)) await clearUsage(MENU_CARD_FALLBACK_ENTITY, category, fallbackUsageField(id)).catch(() => undefined);
  }
  for (const id of after) {
    await recordUsage(id, MENU_CARD_FALLBACK_ENTITY, category, fallbackUsageField(id)).catch(() => undefined);
  }
}

async function afterChange(
  session: Session,
  category: FallbackCategory,
  action: string,
  before: readonly string[],
  extra: Record<string, unknown>,
): Promise<string[]> {
  const after = await listOrEmpty(category);
  await syncUsage(category, before, after);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action,
    entityType: MENU_CARD_FALLBACK_ENTITY,
    entityId: category,
    before: { media_ids: before },
    after: { media_ids: after, ...extra },
  });
  revalidatePublicMenuSurfaces();
  revalidatePath(MENU_CARD_FALLBACK_PAGE);
  return after;
}

function savedText(category: FallbackCategory, count: number): string {
  if (count <= 1) return `Saved. ${nameOf(category)} cards without their own photo now show this picture.`;
  return `Saved. ${nameOf(category)} has ${count} pictures: cards without their own photo show a mix of them and rotate through them.`;
}

/** Upload one or more new pictures and add them to the category list. */
export async function uploadFallbackAction(formData: FormData): Promise<void> {
  const session = await requirePermission(PERMISSION);
  const category = parseFallbackCategory(formData.get("category"));
  if (!category) back("error", "Pick a website category first.");

  const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) back("error", "Choose a picture to upload.", category);

  const before = await listOrEmpty(category);
  const room = roomFor(before.length, files.length);
  if (room === 0) back("error", `${nameOf(category)} already has ${MAX_FALLBACKS_PER_CATEGORY} pictures, the most it can hold. Remove one first.`, category);
  const take = files.slice(0, room);

  // Check every file before uploading any, so a bad one never leaves half a batch.
  const checked: Array<{ file: File; buffer: Buffer }> = [];
  for (const file of take) {
    const problem = fallbackUploadProblem(file, MEDIA_UPLOAD_MAX_BYTES);
    if (problem) back("error", problem, category);
    const buffer = Buffer.from(await file.arrayBuffer());
    // R45-S2 (OWASP): prove the type from the bytes, not the browser label.
    const sig = checkFileSignature(file.type, new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), file.name);
    if (!sig.ok) back("error", sig.error, category);
    checked.push({ file, buffer });
  }

  const mediaIds: string[] = [];
  for (const { file, buffer } of checked) {
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
      mediaIds.push(asset.id);
    } catch (err) {
      if (mediaIds.length === 0) back("error", `The upload failed: ${err instanceof Error ? err.message : String(err)}`, category);
      break; // keep the ones that did upload
    }
  }

  const r = await addMenuCardFallbacks(category, mediaIds, session.profile.id ?? null);
  if (!r.ok) back("error", writeProblem(r), category);
  const after = await afterChange(session, category, "menu_card_fallback.set", before, { via: "upload", uploaded: mediaIds });
  const capped = files.length > take.length ? ` ${files.length - take.length} more did not fit (the limit is ${MAX_FALLBACKS_PER_CATEGORY}).` : "";
  back("msg", `${savedText(category, after.length)}${capped}`, category);
}

/** Add a picture that is already in the media library. */
export async function pickFallbackAction(formData: FormData): Promise<void> {
  const session = await requirePermission(PERMISSION);
  const category = parseFallbackCategory(formData.get("category"));
  if (!category) back("error", "Pick a website category first.");
  const mediaId = parseMediaId(formData.get("mediaId"));
  if (!mediaId) back("error", "That picture could not be found. Search again and pick it.", category);
  if (!(await fallbackMediaExists(mediaId))) {
    back("error", "That picture is not an image in the media library (or it is archived). Pick another one.", category);
  }

  const before = await listOrEmpty(category);
  const r = await addMenuCardFallbacks(category, [mediaId], session.profile.id ?? null);
  if (!r.ok) back("error", writeProblem(r), category);
  const after = await afterChange(session, category, "menu_card_fallback.set", before, { via: "library", added: mediaId });
  back("msg", savedText(category, after.length), category);
}

/** Take one picture out of the category list. */
export async function removeFallbackPictureAction(formData: FormData): Promise<void> {
  const session = await requirePermission(PERMISSION);
  const category = parseFallbackCategory(formData.get("category"));
  if (!category) back("error", "Pick a website category first.");
  const mediaId = parseMediaId(formData.get("mediaId"));
  if (!mediaId) back("error", "That picture could not be found.", category);

  const before = await listOrEmpty(category);
  const r = await removeMenuCardFallback(category, mediaId);
  if (!r.ok) back("error", writeProblem(r), category);
  const after = await afterChange(session, category, "menu_card_fallback.removed", before, { removed: mediaId });
  back(
    "msg",
    after.length > 0
      ? `Removed. ${nameOf(category)} has ${after.length} picture${after.length === 1 ? "" : "s"} left. The removed one stays in the media library.`
      : `Removed. ${nameOf(category)} cards without a photo go back to the generic fallback or the mockup. The picture stays in the media library.`,
    category,
  );
}

/** Move one picture up or down in the category list. */
export async function moveFallbackAction(formData: FormData): Promise<void> {
  const session = await requirePermission(PERMISSION);
  const category = parseFallbackCategory(formData.get("category"));
  if (!category) back("error", "Pick a website category first.");
  const mediaId = parseMediaId(formData.get("mediaId"));
  const direction = formData.get("direction") === "up" ? "up" : "down";
  if (!mediaId) back("error", "That picture could not be found.", category);

  const before = await listOrEmpty(category);
  const order = movedOrder(before, mediaId, direction);
  if (!order) back("error", `That picture is already ${direction === "up" ? "first" : "last"}.`, category);
  const r = await reorderMenuCardFallbacks(category, order);
  if (!r.ok) back("error", writeProblem(r), category);
  await afterChange(session, category, "menu_card_fallback.reordered", before, { moved: mediaId, direction });
  back("msg", `Moved. ${nameOf(category)} cards rotate in the new order.`, category);
}

/** Remove every picture from the category. */
export async function clearFallbackAction(formData: FormData): Promise<void> {
  const session = await requirePermission(PERMISSION);
  const category = parseFallbackCategory(formData.get("category"));
  if (!category) back("error", "Pick a website category first.");

  const before = await listOrEmpty(category);
  const r = await clearMenuCardFallback(category);
  if (!r.ok) back("error", writeProblem(r), category);
  await afterChange(session, category, "menu_card_fallback.cleared", before, {});
  back("msg", `Removed. ${nameOf(category)} cards without a photo go back to the generic fallback or the mockup. The pictures stay in the media library.`, category);
}
