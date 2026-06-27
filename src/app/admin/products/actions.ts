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
  reviewSuggestion,
  getSuggestion,
  type ProductFacts,
} from "@/lib/ai/suggestions";

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

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: `product.${status}`,
    entityType: "product",
    entityId: key,
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

  await reviewSuggestion(id, "accepted", session.userId);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "product.ai_accepted",
    entityType: "product",
    entityId: key,
    after: { field: sugg!.field_key },
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
