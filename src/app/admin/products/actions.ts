"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { uploadMedia, recordUsage } from "@/lib/media/store";
import { ensureEnrichment, updateEnrichment, getEnrichment } from "@/lib/enrichment/store";
import {
  generateProductDescription,
  generateProductTags,
  generateProductSensory,
  generateProductEffects,
  reviewSuggestion,
  getSuggestion,
  type ProductFacts,
} from "@/lib/ai/suggestions";
import { writeBackOnPublish } from "@/lib/ai/kb/writeback";
import { acceptWithComplianceGate } from "@/lib/ai/accept-gate";
import { checkCompliance } from "@/lib/ai/compliance";
import { getMedia } from "@/lib/media/store";
import { attachImageToGallery } from "@/lib/ai/kb/product-images-core";
import { importImageFromUrl, HarvestImageError } from "@/lib/media/harvest";

const ALLOWED_TAGS = new Set([
  "new-arrival",
  "best-seller",
  "staff-pick",
  "local",
  "high-cbd",
  "high-thc",
  "value",
  "limited",
]);
const MAX_IMG_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function orNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

function tagsFromForm(formData: FormData): string[] {
  return formData
    .getAll("tags")
    .map((t) => String(t).trim().toLowerCase())
    .filter((t) => ALLOWED_TAGS.has(t));
}

/** Save the marketing enrichment for a product (text + flags + optional image). */
export async function updateProductEnrichment(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const key = String(formData.get("key") ?? "");
  if (!key) redirect("/admin/products?error=" + encodeURIComponent("Missing product key."));

  // Lazy-init the row so we can always update by key.
  await ensureEnrichment(
    key,
    {
      name: orNull(formData.get("posName")),
      brand: orNull(formData.get("posBrand")),
      category: orNull(formData.get("posCategory")),
    },
    session.userId,
  );

  const update: Record<string, unknown> = {
    display_name: orNull(formData.get("display_name")),
    description: orNull(formData.get("description")),
    short_description: orNull(formData.get("short_description")),
    staff_note: orNull(formData.get("staff_note")),
    seo_title: orNull(formData.get("seo_title")),
    seo_description: orNull(formData.get("seo_description")),
    brand_id: orNull(formData.get("brand_id")),
    vendor_id: orNull(formData.get("vendor_id")),
    tags: tagsFromForm(formData),
    staff_pick: formData.get("staff_pick") === "on",
    featured: formData.get("featured") === "on",
  };

  // Visibility override: "inherit" | "show" | "hide"
  const vis = String(formData.get("visibility") ?? "inherit");
  update.hidden_override = vis === "inherit" ? null : vis === "hide";
  update.hidden_reason = vis === "hide" ? orNull(formData.get("hidden_reason")) : null;

  // Optional image upload → media library (published) → add to gallery.
  const image = formData.get("image");
  if (image instanceof File && image.size > 0) {
    if (!IMAGE_MIME.has(image.type)) {
      redirect(`/admin/products/${encodeURIComponent(key)}?error=` + encodeURIComponent("Image must be PNG, JPG, WEBP, or GIF."));
    }
    if (image.size > MAX_IMG_BYTES) {
      redirect(`/admin/products/${encodeURIComponent(key)}?error=` + encodeURIComponent("Image exceeds 5 MB."));
    }
    const buffer = Buffer.from(await image.arrayBuffer());
    const asset = await uploadMedia({
      buffer,
      filename: image.name,
      mimeType: image.type,
      usageType: "product",
      title: `${update.display_name || "Product"} image`,
      altText: String(update.display_name || formData.get("posName") || "Product image"),
      uploadedBy: session.userId,
      status: "published",
    });
    const current = await getEnrichment(key);
    const gallery = current?.image_media_ids ?? [];
    update.image_media_ids = [...gallery, asset.id];
    update.primary_media_id = current?.primary_media_id ?? asset.id;
    await recordUsage(asset.id, "product", key, "image");
  }

  await updateEnrichment(key, update as Parameters<typeof updateEnrichment>[1], session.userId);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.enriched",
    entityType: "product",
    entityId: key,
  });

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${encodeURIComponent(key)}`);
  redirect(`/admin/products/${encodeURIComponent(key)}?saved=1`);
}

/** Publish / unpublish / archive the enrichment. */
export async function setEnrichmentStatus(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const key = String(formData.get("key") ?? "");
  const raw = String(formData.get("status") ?? "draft");
  const status = raw === "published" ? "published" : raw === "archived" ? "archived" : "draft";
  if (!key) redirect("/admin/products?error=" + encodeURIComponent("Missing product key."));

  await ensureEnrichment(key, {}, session.userId);
  await updateEnrichment(key, { status }, session.userId);

  // On PUBLISH, promote the validated facts into the KB (drafts-only, non-
  // destructive, compliance-gated). Best-effort: never blocks the publish.
  let writeback: Awaited<ReturnType<typeof writeBackOnPublish>> = null;
  if (status === "published") {
    writeback = await writeBackOnPublish(key, session.userId);
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: `product.${status}`,
    entityType: "product",
    entityId: key,
    after: writeback ? { kb_writeback: writeback } : undefined,
  });

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${encodeURIComponent(key)}`);
  revalidatePath("/menu");
  redirect(`/admin/products/${encodeURIComponent(key)}?saved=1`);
}

/** Generate an AI draft (description or tags) for a product. */
export async function generateProductAi(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const key = String(formData.get("key") ?? "");
  const kind = String(formData.get("kind") ?? "description");
  if (!key) redirect("/admin/products?error=" + encodeURIComponent("Missing product key."));

  const facts: ProductFacts = {
    name: String(formData.get("posName") ?? "Product"),
    brand: orNull(formData.get("posBrand")),
    category: orNull(formData.get("posCategory")),
    strainType: orNull(formData.get("posStrainType")),
    strainName: orNull(formData.get("posStrainName")),
    thc: orNull(formData.get("posThc")),
    cbd: orNull(formData.get("posCbd")),
  };

  try {
    if (kind === "tags") {
      await generateProductTags(key, facts, session.userId);
    } else if (kind === "sensory") {
      await generateProductSensory(key, facts, session.userId);
    } else if (kind === "effects") {
      await generateProductEffects(key, facts, session.userId);
    } else {
      await generateProductDescription(key, facts, session.userId);
    }
  } catch (err) {
    redirect(`/admin/products/${encodeURIComponent(key)}?error=` + encodeURIComponent((err as Error).message));
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.ai_generated",
    entityType: "product",
    entityId: key,
    after: { kind },
  });

  revalidatePath(`/admin/products/${encodeURIComponent(key)}`);
  redirect(`/admin/products/${encodeURIComponent(key)}?ai=1#ai`);
}

/** Accept an AI suggestion: apply its value to the enrichment, mark accepted. */
export async function acceptSuggestion(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const id = String(formData.get("id") ?? "");
  const key = String(formData.get("key") ?? "");
  if (!id || !key) redirect(`/admin/products/${encodeURIComponent(key)}?error=` + encodeURIComponent("Missing suggestion."));

  const sugg = await getSuggestion(id);
  if (!sugg) redirect(`/admin/products/${encodeURIComponent(key)}?error=` + encodeURIComponent("Suggestion not found."));

  // S-4: compliance RE-SCAN at accept — blocking flags refuse the accept.
  const gate = await acceptWithComplianceGate(sugg!);
  if (!gate.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "product.ai_accept_blocked",
      entityType: "product",
      entityId: key,
      after: { field: sugg!.field_key, ...gate.audit },
    });
    redirect(`/admin/products/${encodeURIComponent(key)}?error=` + encodeURIComponent(gate.message) + "#ai");
  }

  await ensureEnrichment(key, {}, session.userId);

  if (sugg!.field_key === "description") {
    await updateEnrichment(key, { description: sugg!.suggested_value }, session.userId);
  } else if (sugg!.field_key === "tags") {
    const tags = (sugg!.suggested_value ?? "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => ALLOWED_TAGS.has(t));
    await updateEnrichment(key, { tags }, session.userId);
  }
  // sensory + effects have no enrichment column; they are validated facts that
  // live on the accepted suggestion and are promoted to the KB (on accept here
  // and again on publish via writeBackOnPublish). No enrichment write needed.

  await reviewSuggestion(id, "accepted", session.userId);

  // Promote the newly-validated fact(s) into the KB (drafts-only, best-effort).
  const writeback = await writeBackOnPublish(key, session.userId);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.ai_accepted",
    entityType: "product",
    entityId: key,
    after: { field: sugg!.field_key, kb_writeback: writeback ?? undefined, ...gate.audit },
  });

  revalidatePath(`/admin/products/${encodeURIComponent(key)}`);
  redirect(`/admin/products/${encodeURIComponent(key)}?saved=1#ai`);
}

/** Reject an AI suggestion (discard, mark rejected). */
export async function rejectSuggestion(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const id = String(formData.get("id") ?? "");
  const key = String(formData.get("key") ?? "");
  if (!id) redirect(`/admin/products/${encodeURIComponent(key)}?error=` + encodeURIComponent("Missing suggestion."));

  await reviewSuggestion(id, "rejected", session.userId);
  revalidatePath(`/admin/products/${encodeURIComponent(key)}`);
  redirect(`/admin/products/${encodeURIComponent(key)}?#ai`);
}

// ---------------------------------------------------------------------------
// SLICE 38 — command-center apply actions. Each one is an explicit human
// click on a SUGGESTED match (KB copy, media asset, vendor image). Nothing is
// auto-applied; every apply is audited; text is compliance-scanned first.
// ---------------------------------------------------------------------------

const APPLYABLE_TEXT_FIELDS = new Set(["description", "short_description"]);

/** Copy suggested text (from the KB or a vendor menu line) into the draft. */
export async function applyMatchedText(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const key = String(formData.get("key") ?? "");
  const field = String(formData.get("field") ?? "");
  const value = String(formData.get("value") ?? "").trim();
  const source = String(formData.get("source") ?? "match");
  if (!key) redirect("/admin/products?error=" + encodeURIComponent("Missing product key."));
  if (!APPLYABLE_TEXT_FIELDS.has(field) || !value) {
    redirect(`/admin/products/${encodeURIComponent(key)}?error=` + encodeURIComponent("Nothing to apply."));
  }

  // Compliance gate: blocking flags refuse the apply (warn-only passes).
  const scan = checkCompliance(value);
  if (scan.blockingFlags.length > 0) {
    redirect(
      `/admin/products/${encodeURIComponent(key)}?error=` +
        encodeURIComponent(`Blocked by compliance check: ${scan.blockingFlags.join(", ")}.`),
    );
  }

  await ensureEnrichment(key, {}, session.userId);
  await updateEnrichment(key, { [field]: value } as Parameters<typeof updateEnrichment>[1], session.userId);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.match_text_applied",
    entityType: "product",
    entityId: key,
    after: { field, source, warnings: scan.flags },
  });

  revalidatePath(`/admin/products/${encodeURIComponent(key)}`);
  redirect(`/admin/products/${encodeURIComponent(key)}?saved=1`);
}

/** Attach an EXISTING media-library asset (KB image / library match) to the gallery. */
export async function attachMatchedMedia(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const key = String(formData.get("key") ?? "");
  const mediaId = String(formData.get("mediaId") ?? "").trim();
  const source = String(formData.get("source") ?? "match");
  if (!key) redirect("/admin/products?error=" + encodeURIComponent("Missing product key."));
  if (!mediaId) redirect(`/admin/products/${encodeURIComponent(key)}?error=` + encodeURIComponent("Missing media id."));

  const asset = await getMedia(mediaId);
  if (!asset) {
    redirect(`/admin/products/${encodeURIComponent(key)}?error=` + encodeURIComponent("That media asset no longer exists."));
  }

  await ensureEnrichment(key, {}, session.userId);
  const current = await getEnrichment(key);
  const merge = attachImageToGallery(
    {
      image_media_ids: current?.image_media_ids ?? [],
      primary_media_id: current?.primary_media_id ?? null,
    },
    mediaId,
  );
  if (merge.alreadyPresent) {
    redirect(`/admin/products/${encodeURIComponent(key)}?saved=1`);
  }
  await updateEnrichment(
    key,
    { image_media_ids: merge.image_media_ids, primary_media_id: merge.primary_media_id },
    session.userId,
  );
  await recordUsage(mediaId, "product", key, "image");

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.match_image_attached",
    entityType: "product",
    entityId: key,
    after: { mediaId, source, becamePrimary: merge.becamePrimary },
  });

  revalidatePath(`/admin/products/${encodeURIComponent(key)}`);
  redirect(`/admin/products/${encodeURIComponent(key)}?saved=1`);
}

/** Import a VENDOR-hosted image (Cultivera/GrowFlow menu line) then attach it. */
export async function importVendorImage(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const key = String(formData.get("key") ?? "");
  const imageUrl = String(formData.get("imageUrl") ?? "").trim();
  const label = String(formData.get("label") ?? "Product").trim() || "Product";
  const platform = String(formData.get("platform") ?? "vendor");
  if (!key) redirect("/admin/products?error=" + encodeURIComponent("Missing product key."));
  if (!imageUrl) redirect(`/admin/products/${encodeURIComponent(key)}?error=` + encodeURIComponent("Missing image URL."));

  let assetId: string;
  try {
    const { asset } = await importImageFromUrl({
      imageUrl,
      usageType: "product",
      title: `${label} (${platform} import)`,
      altText: label,
      uploadedBy: session.userId,
      tags: [platform, "enrichment-import"],
    });
    assetId = asset.id;
  } catch (err) {
    const msg = err instanceof HarvestImageError ? err.message : "Could not import that vendor image.";
    redirect(`/admin/products/${encodeURIComponent(key)}?error=` + encodeURIComponent(msg));
    return;
  }

  await ensureEnrichment(key, {}, session.userId);
  const current = await getEnrichment(key);
  const merge = attachImageToGallery(
    {
      image_media_ids: current?.image_media_ids ?? [],
      primary_media_id: current?.primary_media_id ?? null,
    },
    assetId,
  );
  if (!merge.alreadyPresent) {
    await updateEnrichment(
      key,
      { image_media_ids: merge.image_media_ids, primary_media_id: merge.primary_media_id },
      session.userId,
    );
    await recordUsage(assetId, "product", key, "image");
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.vendor_image_imported",
    entityType: "product",
    entityId: key,
    after: { assetId, platform, becamePrimary: merge.becamePrimary },
  });

  revalidatePath(`/admin/products/${encodeURIComponent(key)}`);
  redirect(`/admin/products/${encodeURIComponent(key)}?saved=1`);
}
