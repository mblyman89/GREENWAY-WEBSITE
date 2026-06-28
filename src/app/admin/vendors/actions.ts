"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { uploadMedia, recordUsage } from "@/lib/media/store";
import type { SocialLinks } from "@/lib/vendors/types";
import { getVendorById, getBrandById } from "@/lib/vendors/store";
import { generateVendorProfile } from "@/lib/ai/ai-vendor";
import { persistSuggestion, reviewSuggestion, getSuggestion } from "@/lib/ai/suggestions";
import { AiNotConfiguredError } from "@/lib/ai/provider";

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/gif"]);

function socialFromForm(formData: FormData): SocialLinks {
  const s: SocialLinks = {};
  const ig = String(formData.get("instagram") ?? "").trim();
  const fb = String(formData.get("facebook") ?? "").trim();
  if (ig) s.instagram = ig;
  if (fb) s.facebook = fb;
  return s;
}

/** Update a vendor profile (text fields + optional logo upload). */
export async function updateVendor(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin/vendors?error=" + encodeURIComponent("Missing vendor id."));

  const admin = createSupabaseAdminClient();

  const update: Record<string, unknown> = {
    display_name: String(formData.get("display_name") ?? "").trim(),
    legal_name: orNull(formData.get("legal_name")),
    mission_statement: orNull(formData.get("mission_statement")),
    about: orNull(formData.get("about")),
    website: orNull(formData.get("website")),
    email: orNull(formData.get("email")),
    phone: orNull(formData.get("phone")),
    vendor_day_notes: orNull(formData.get("vendor_day_notes")),
    internal_notes: orNull(formData.get("internal_notes")),
    social_json: socialFromForm(formData),
    updated_by: session.userId,
  };

  // Optional logo upload.
  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (!IMAGE_MIME.has(logo.type)) {
      redirect(`/admin/vendors/${id}?error=` + encodeURIComponent("Logo must be PNG, JPG, WEBP, SVG, or GIF."));
    }
    if (logo.size > MAX_LOGO_BYTES) {
      redirect(`/admin/vendors/${id}?error=` + encodeURIComponent("Logo exceeds 5 MB."));
    }
    const buffer = Buffer.from(await logo.arrayBuffer());
    const asset = await uploadMedia({
      buffer,
      filename: logo.name,
      mimeType: logo.type,
      usageType: "vendor-logo",
      title: `${update.display_name} logo`,
      altText: `${update.display_name} logo`,
      uploadedBy: session.userId,
      status: "published", // logos are meant to be displayed
    });
    update.logo_media_id = asset.id;
    await recordUsage(asset.id, "vendor", id, "logo");
  }

  const { error } = await admin.from("vendors").update(update).eq("id", id);
  if (error) redirect(`/admin/vendors/${id}?error=` + encodeURIComponent(error.message));

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "vendor.updated",
    entityType: "vendor",
    entityId: id,
  });

  revalidatePath("/admin/vendors");
  revalidatePath(`/admin/vendors/${id}`);
  redirect(`/admin/vendors/${id}?saved=1`);
}

/** Publish or unpublish (draft) a vendor. */
export async function setVendorStatus(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "draft");
  if (!id) redirect("/admin/vendors?error=" + encodeURIComponent("Missing vendor id."));

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("vendors").update({ status, updated_by: session.userId }).eq("id", id);
  if (error) redirect(`/admin/vendors/${id}?error=` + encodeURIComponent(error.message));

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: status === "published" ? "vendor.published" : "vendor.unpublished",
    entityType: "vendor",
    entityId: id,
  });

  revalidatePath("/admin/vendors");
  revalidatePath(`/admin/vendors/${id}`);
  revalidatePath("/vendors");
  redirect(`/admin/vendors/${id}?saved=1`);
}

/** Update a brand profile (text + optional logo). */
export async function updateBrand(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const id = String(formData.get("id") ?? "");
  const vendorId = String(formData.get("vendorId") ?? "");
  if (!id) redirect("/admin/vendors?error=" + encodeURIComponent("Missing brand id."));

  const admin = createSupabaseAdminClient();
  const update: Record<string, unknown> = {
    display_name: String(formData.get("display_name") ?? "").trim(),
    about: orNull(formData.get("about")),
    mission_statement: orNull(formData.get("mission_statement")),
    product_philosophy: orNull(formData.get("product_philosophy")),
    website: orNull(formData.get("website")),
    status: String(formData.get("status") ?? "draft"),
    updated_by: session.userId,
  };

  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (!IMAGE_MIME.has(logo.type)) {
      redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Brand logo must be an image."));
    }
    if (logo.size > MAX_LOGO_BYTES) {
      redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Brand logo exceeds 5 MB."));
    }
    const buffer = Buffer.from(await logo.arrayBuffer());
    const asset = await uploadMedia({
      buffer,
      filename: logo.name,
      mimeType: logo.type,
      usageType: "brand-logo",
      title: `${update.display_name} logo`,
      altText: `${update.display_name} logo`,
      uploadedBy: session.userId,
      status: "published",
    });
    update.logo_media_id = asset.id;
    await recordUsage(asset.id, "brand", id, "logo");
  }

  const { error } = await admin.from("brands").update(update).eq("id", id);
  if (error) redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent(error.message));

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "brand.updated",
    entityType: "brand",
    entityId: id,
  });

  revalidatePath(`/admin/vendors/${vendorId}`);
  redirect(`/admin/vendors/${vendorId}?saved=1#brand-${id}`);
}

function orNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

/**
 * "Research with AI" — draft a compliant mission + about for a vendor and
 * persist them as PENDING suggestions (drafts-only). Nothing is written to the
 * vendor record until staff click Accept. Honest: the model writes a tasteful
 * starting draft from the name + hints, it does not browse the web.
 */
export async function researchVendorAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/admin/vendors?error=" + encodeURIComponent("Missing vendor id."));

  const vendor = await getVendorById(id);
  if (!vendor) redirect("/admin/vendors?error=" + encodeURIComponent("Vendor not found."));

  const instruction = orNull(formData.get("instruction"));

  try {
    const draft = await generateVendorProfile({
      kind: "vendor",
      displayName: vendor.display_name,
      currentMission: vendor.mission_statement,
      currentAbout: vendor.about,
      website: vendor.website,
      instruction,
    });

    if (draft.mission) {
      await persistSuggestion({
        entity_type: "vendor",
        entity_id: id,
        field_key: "mission_statement",
        suggested_value: draft.mission,
        input_summary: `${vendor.display_name} · mission${instruction ? " · " + instruction : ""}`,
        generated_by: session.userId,
      });
    }
    if (draft.about) {
      await persistSuggestion({
        entity_type: "vendor",
        entity_id: id,
        field_key: "about",
        suggested_value: draft.about,
        input_summary: `${vendor.display_name} · about${instruction ? " · " + instruction : ""}`,
        generated_by: session.userId,
      });
    }

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "vendor.ai_drafted",
      entityType: "vendor",
      entityId: id,
      after: { fields: ["mission_statement", "about"], flags: draft.complianceFlags },
    });
  } catch (err) {
    const msg =
      err instanceof AiNotConfiguredError
        ? "AI isn't set up yet. Add an AI_API_KEY to enable drafting."
        : "Couldn't draft a profile right now. Please try again.";
    redirect(`/admin/vendors/${id}?error=` + encodeURIComponent(msg));
  }

  revalidatePath(`/admin/vendors/${id}`);
  redirect(`/admin/vendors/${id}?saved=1#ai-drafts`);
}

/** Accept an AI vendor-profile suggestion: write the value, mark accepted. */
export async function acceptVendorSuggestionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const suggestionId = String(formData.get("suggestionId") ?? "");
  const vendorId = String(formData.get("vendorId") ?? "");
  if (!suggestionId || !vendorId) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Missing suggestion."));
  }

  const suggestion = await getSuggestion(suggestionId);
  if (!suggestion || suggestion.entity_type !== "vendor" || suggestion.entity_id !== vendorId) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Suggestion not found."));
  }

  // Only allow writing the two known profile fields.
  const allowed = new Set(["mission_statement", "about"]);
  if (!allowed.has(suggestion!.field_key)) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Unsupported field."));
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("vendors")
    .update({ [suggestion!.field_key]: suggestion!.suggested_value, updated_by: session.userId })
    .eq("id", vendorId);
  if (error) redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent(error.message));

  await reviewSuggestion(suggestionId, "accepted", session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "vendor.ai_accepted",
    entityType: "vendor",
    entityId: vendorId,
    after: { field: suggestion!.field_key },
  });

  revalidatePath(`/admin/vendors/${vendorId}`);
  redirect(`/admin/vendors/${vendorId}?saved=1#ai-drafts`);
}

/** Reject an AI vendor-profile suggestion (no write to the vendor). */
export async function rejectVendorSuggestionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const suggestionId = String(formData.get("suggestionId") ?? "");
  const vendorId = String(formData.get("vendorId") ?? "");
  if (!suggestionId || !vendorId) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Missing suggestion."));
  }
  await reviewSuggestion(suggestionId, "rejected", session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "vendor.ai_rejected",
    entityType: "vendor",
    entityId: vendorId,
  });
  revalidatePath(`/admin/vendors/${vendorId}`);
  redirect(`/admin/vendors/${vendorId}?saved=1#ai-drafts`);
}

/* ------------------------------------------------------------------ *
 * BRAND-level "Research with AI" (parallel to the vendor lifecycle).
 * Brands have three drafted fields: mission_statement, about, and
 * product_philosophy. Drafts-only: nothing is written until Accept.
 * ------------------------------------------------------------------ */

/** Brand fields the AI is allowed to draft + the human can accept. */
const BRAND_AI_FIELDS = new Set(["mission_statement", "about", "product_philosophy"]);

/** "Research with AI" for a brand → up to 3 pending suggestions. */
export async function researchBrandAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const brandId = String(formData.get("brandId") ?? "");
  const vendorId = String(formData.get("vendorId") ?? "");
  if (!brandId || !vendorId) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Missing brand id."));
  }

  const brand = await getBrandById(brandId);
  if (!brand) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Brand not found."));
  }

  const instruction = orNull(formData.get("instruction"));

  try {
    const draft = await generateVendorProfile({
      kind: "brand",
      displayName: brand!.display_name,
      currentMission: brand!.mission_statement,
      currentAbout: brand!.about,
      currentPhilosophy: brand!.product_philosophy,
      website: brand!.website,
      instruction,
    });

    const toPersist: { field: string; value: string }[] = [];
    if (draft.mission) toPersist.push({ field: "mission_statement", value: draft.mission });
    if (draft.about) toPersist.push({ field: "about", value: draft.about });
    if (draft.philosophy) toPersist.push({ field: "product_philosophy", value: draft.philosophy });

    for (const p of toPersist) {
      await persistSuggestion({
        entity_type: "brand",
        entity_id: brandId,
        field_key: p.field,
        suggested_value: p.value,
        input_summary: `${brand!.display_name} · ${p.field}${instruction ? " · " + instruction : ""}`,
        generated_by: session.userId,
      });
    }

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "brand.ai_drafted",
      entityType: "brand",
      entityId: brandId,
      after: { fields: toPersist.map((p) => p.field), flags: draft.complianceFlags },
    });
  } catch (err) {
    const msg =
      err instanceof AiNotConfiguredError
        ? "AI isn't set up yet. Add an AI_API_KEY to enable drafting."
        : "Couldn't draft a brand profile right now. Please try again.";
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent(msg));
  }

  revalidatePath(`/admin/vendors/${vendorId}`);
  redirect(`/admin/vendors/${vendorId}?saved=1#brand-${brandId}`);
}

/** Accept an AI brand-profile suggestion: write the value, mark accepted. */
export async function acceptBrandSuggestionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const suggestionId = String(formData.get("suggestionId") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const vendorId = String(formData.get("vendorId") ?? "");
  if (!suggestionId || !brandId || !vendorId) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Missing suggestion."));
  }

  const suggestion = await getSuggestion(suggestionId);
  if (!suggestion || suggestion.entity_type !== "brand" || suggestion.entity_id !== brandId) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Suggestion not found."));
  }
  if (!BRAND_AI_FIELDS.has(suggestion!.field_key)) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Unsupported field."));
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("brands")
    .update({ [suggestion!.field_key]: suggestion!.suggested_value, updated_by: session.userId })
    .eq("id", brandId);
  if (error) redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent(error.message));

  await reviewSuggestion(suggestionId, "accepted", session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "brand.ai_accepted",
    entityType: "brand",
    entityId: brandId,
    after: { field: suggestion!.field_key },
  });

  revalidatePath(`/admin/vendors/${vendorId}`);
  redirect(`/admin/vendors/${vendorId}?saved=1#brand-${brandId}`);
}

/** Reject an AI brand-profile suggestion (no write to the brand). */
export async function rejectBrandSuggestionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const suggestionId = String(formData.get("suggestionId") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const vendorId = String(formData.get("vendorId") ?? "");
  if (!suggestionId || !brandId || !vendorId) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Missing suggestion."));
  }
  await reviewSuggestion(suggestionId, "rejected", session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "brand.ai_rejected",
    entityType: "brand",
    entityId: brandId,
  });
  revalidatePath(`/admin/vendors/${vendorId}`);
  redirect(`/admin/vendors/${vendorId}?saved=1#brand-${brandId}`);
}
