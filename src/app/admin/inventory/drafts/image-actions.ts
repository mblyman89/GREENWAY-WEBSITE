"use server";
/**
 * src/app/admin/inventory/drafts/image-actions.ts — R51 (items 3, 4, 5).
 *
 * The onboarding row's "Product images" buttons:
 *   - attachOnboardingImageAction: attach one Content -> Media asset (draft or
 *     published) to the product this draft becomes.
 *   - importOnboardingImageAction: import a web image URL (e.g. one Gemini
 *     found) into Content -> Media, then attach it the same way.
 *
 * Both re-read the draft on the server (the browser only says WHICH draft and
 * WHICH asset/URL), resolve the target with the SAME suggestion key the S07
 * door and the waiting-facts list use (waitingKeyForDraft ->
 * suggestionTargetKey), attach to that enrichment's gallery (the
 * attachMatchedMedia pattern in admin/products/actions.ts), also attach to the
 * KB product when the draft is linked to one, record the media usage, write
 * the image MEMORY (0279) under the draft's identity key, and audit.
 *
 * A person clicked Attach: this is the human validation AGENTS.md requires.
 * Imports land as media DRAFTS with license pending-review (harvest.ts), so a
 * web photo is never published by being attached here.
 */
import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getMedia, recordUsage } from "@/lib/media/store";
import { importImageFromUrl, HarvestImageError } from "@/lib/media/harvest";
import { validateResearchUrl } from "@/lib/enrichment/research-core";
import { ensureEnrichment, getEnrichment, updateEnrichment } from "@/lib/enrichment/store";
import { attachImageToGallery } from "@/lib/ai/kb/product-images-core";
import { attachKbProductImage } from "@/lib/ai/kb/store";
import { readDraftForWaiting } from "@/lib/catalog/waiting-facts-server";
import { draftsHref, normalizeDraftView } from "@/lib/catalog/draft-deep-link-core";
import { imageIdentityKeys, rememberImageAttach, type ImageDraftRow } from "@/lib/catalog/image-memory-server";
import { parseImageMemorySource, type ImageMemorySource } from "@/lib/catalog/image-recommend-core";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function back(fd: FormData, draftId: string, code: "attached" | "already" | "error", msg: string): string {
  return draftsHref({
    status: normalizeDraftView(str(fd, "return_status")),
    manifestId: str(fd, "return_manifest") || null,
    draftId,
    extra: { img: code, ...(msg ? { img_msg: msg.slice(0, 300) } : {}) },
  });
}

type Attached = { sentence: string; code: "attached" | "already" };

/** The shared tail: gallery + KB + usage + memory + audit. */
async function attachToDraftProduct(opts: {
  draftId: string;
  mediaId: string;
  source: ImageMemorySource;
  session: { userId: string; email: string | null };
  extraAudit?: Record<string, unknown>;
}): Promise<Attached | { error: string }> {
  const draft = await readDraftForWaiting(opts.draftId);
  if (!draft) return { error: "This onboarding draft could not be read just now - refresh the page." };
  if (draft.status !== "draft" && draft.status !== "approved") {
    return { error: "This product was dismissed, so no image was attached. Restore it first." };
  }
  const key = draft.key;
  if (!key) {
    return { error: "This product has no POS card key yet, so there is no card to put the photo on. Approve it first, or attach the photo on the Enrichment page." };
  }
  const row = draft.row as ImageDraftRow & { kb_product_id?: string | null; name?: string | null; brand_name?: string | null; category?: string | null };

  await ensureEnrichment(key, { name: row.name ?? null, brand: row.brand_name ?? null, category: row.category ?? null }, opts.session.userId);
  const current = await getEnrichment(key);
  const merge = attachImageToGallery(
    { image_media_ids: current?.image_media_ids ?? [], primary_media_id: current?.primary_media_id ?? null },
    opts.mediaId,
  );
  if (!merge.alreadyPresent) {
    await updateEnrichment(key, { image_media_ids: merge.image_media_ids, primary_media_id: merge.primary_media_id }, opts.session.userId);
    await recordUsage(opts.mediaId, "product", key, "image");
  }

  // The KB product too, when this draft is linked to one (0234 kb_product_id).
  let kb: string | null = null;
  const kbId = (row.kb_product_id ?? "").trim();
  if (kbId) {
    const r = await attachKbProductImage(kbId, opts.mediaId, opts.session.userId).catch(() => ({ ok: false }));
    kb = r.ok ? kbId : null;
  }

  // Memory, under the draft's identity key (stamped key first).
  const identityKey = imageIdentityKeys({ ...row, id: opts.draftId })[0] ?? "";
  const mem = identityKey
    ? await rememberImageAttach({ identityKey, mediaId: opts.mediaId, posProductKey: key, source: opts.source, actorId: opts.session.userId })
    : { ok: false, missing: false };

  await recordAudit({
    actorId: opts.session.userId,
    actorEmail: opts.session.email,
    action: "catalog_draft.image_attached",
    entityType: "catalog_product_drafts",
    entityId: opts.draftId,
    after: {
      mediaId: opts.mediaId,
      source: opts.source,
      enrichmentKey: key,
      kbProductId: kb,
      alreadyPresent: merge.alreadyPresent,
      becamePrimary: merge.becamePrimary,
      identityKey: identityKey || null,
      remembered: mem.ok,
      ...(opts.extraAudit ?? {}),
    },
  });
  revalidatePath("/admin/inventory/drafts");
  revalidatePath(`/admin/products/${encodeURIComponent(key)}`);

  const memNote = mem.ok
    ? " It is remembered for the next delivery of this product."
    : mem.missing
      ? " (Image memory turns on once migration 0279 is applied.)"
      : "";
  if (merge.alreadyPresent) return { code: "already", sentence: `That photo was already on this product.${memNote}` };
  return {
    code: "attached",
    sentence: `${merge.becamePrimary ? "Attached as the cover photo." : "Attached to the product's gallery."}${memNote}`,
  };
}

export async function attachOnboardingImageAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const draftId = str(formData, "draft_id");
  const mediaId = str(formData, "media_id");
  const source = parseImageMemorySource(str(formData, "source"));
  if (!draftId) redirect(draftsHref({ extra: { img: "error", img_msg: "Missing the onboarding draft id - refresh the page." } }));
  let target = "";
  try {
    const asset = mediaId ? await getMedia(mediaId) : null;
    if (!asset || asset.status === "archived") {
      target = back(formData, draftId, "error", "That image is no longer in the media library (or was archived).");
    } else {
      const r = await attachToDraftProduct({ draftId, mediaId: asset.id, source, session });
      target = "error" in r ? back(formData, draftId, "error", r.error) : back(formData, draftId, r.code, r.sentence);
    }
  } catch (err) {
    unstable_rethrow(err);
    target = back(formData, draftId, "error", `Could not attach: ${String(err).slice(0, 160)}`);
  }
  redirect(target);
}

export async function importOnboardingImageAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const draftId = str(formData, "draft_id");
  const label = str(formData, "label").slice(0, 160) || "Product";
  if (!draftId) redirect(draftsHref({ extra: { img: "error", img_msg: "Missing the onboarding draft id - refresh the page." } }));
  const check = validateResearchUrl(str(formData, "image_url"));
  if (!check.ok) redirect(back(formData, draftId, "error", check.reason.replace("page's URL", "image URL")));
  const imageUrl = (check as { ok: true; url: string }).url;

  let target = "";
  try {
    let assetId = "";
    let deduped = false;
    try {
      // Title carries the product's own words so the recommender finds it
      // next time even before memory (image-recommend-core name match).
      const { asset, deduped: d } = await importImageFromUrl({
        imageUrl,
        usageType: "product",
        title: `${label} (web import)`,
        altText: label,
        uploadedBy: session.userId,
        tags: ["web-research", "onboarding-import"],
      });
      assetId = asset.id;
      deduped = d;
    } catch (err) {
      target = back(formData, draftId, "error", err instanceof HarvestImageError ? err.message : "Could not import that image.");
    }
    if (assetId) {
      const r = await attachToDraftProduct({ draftId, mediaId: assetId, source: "import", session, extraAudit: { imageUrl, deduped } });
      target = "error" in r
        ? back(formData, draftId, "error", r.error)
        : back(formData, draftId, r.code, `${deduped ? "That image was already in your media library. " : "Imported to Content \u2192 Media as a draft (rights pending review). "}${r.sentence}`);
    }
  } catch (err) {
    unstable_rethrow(err);
    target = back(formData, draftId, "error", `Could not import: ${String(err).slice(0, 160)}`);
  }
  redirect(target);
}
