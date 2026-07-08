"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { uploadMedia, recordUsage } from "@/lib/media/store";
import type { SocialLinks } from "@/lib/vendors/types";
import {
  parseSocialDraft,
  mergeSocialLinks,
  summarizeSocialAccept,
  SOCIAL_DRAFT_PLATFORMS,
} from "@/lib/vendors/social-draft-core";
import { getVendorById, getBrandById } from "@/lib/vendors/store";
import { generateVendorProfile } from "@/lib/ai/ai-vendor";
import { persistSuggestion, reviewSuggestion, getSuggestion } from "@/lib/ai/suggestions";
import { acceptWithComplianceGate } from "@/lib/ai/accept-gate";
import { AiNotConfiguredError } from "@/lib/ai/provider";
import { researchUrl, researchSocial, isCrawlerConfigured, CrawlerNotConfiguredError } from "@/lib/ai/crawler-client";
import { importImageFromUrl, HarvestImageError } from "@/lib/media/harvest";

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/gif"]);

/**
 * H12a: read EVERY typed social platform from the profile form. Previously only
 * instagram/facebook round-tripped, so a tiktok/youtube handle saved onto
 * social_json (e.g. by the research_social accept below) would be silently
 * WIPED on the next profile save. The form now has inputs for all six.
 */
function socialFromForm(formData: FormData): SocialLinks {
  const s: SocialLinks = {};
  for (const key of SOCIAL_DRAFT_PLATFORMS) {
    const v = String(formData.get(key) ?? "").trim();
    if (v) s[key] = v;
  }
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
    license_number: orNull(formData.get("license_number")),
    mission_statement: orNull(formData.get("mission_statement")),
    about: orNull(formData.get("about")),
    website: orNull(formData.get("website")),
    email: orNull(formData.get("email")),
    phone: orNull(formData.get("phone")),
    vendor_day_notes: orNull(formData.get("vendor_day_notes")),
    internal_notes: orNull(formData.get("internal_notes")),
    social_json: socialFromForm(formData),
    // Contact / address + ops facts (0081).
    vendor_number: orNull(formData.get("vendor_number")),
    dba: orNull(formData.get("dba")),
    shipping_address1: orNull(formData.get("shipping_address1")),
    shipping_address2: orNull(formData.get("shipping_address2")),
    shipping_city: orNull(formData.get("shipping_city")),
    shipping_state: orNull(formData.get("shipping_state")),
    shipping_zip: orNull(formData.get("shipping_zip")),
    billing_address1: orNull(formData.get("billing_address1")),
    billing_address2: orNull(formData.get("billing_address2")),
    billing_city: orNull(formData.get("billing_city")),
    billing_state: orNull(formData.get("billing_state")),
    billing_zip: orNull(formData.get("billing_zip")),
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

  // Sage Vendor ID (migration 0091) — saved separately and best-effort so the
  // profile form keeps working even before the column exists.
  if (formData.has("sage_vendor_id")) {
    const { error: sageErr } = await admin
      .from("vendors")
      .update({ sage_vendor_id: orNull(formData.get("sage_vendor_id")) })
      .eq("id", id);
    if (sageErr) {
      console.warn("vendors.sage_vendor_id not saved (apply migration 0091):", sageErr.message);
    }
  }

  // Separate update so a not-yet-applied migration 0099 can't fail the whole
  // vendor save (same fail-soft pattern as sage_vendor_id above).
  if (formData.has("product_philosophy")) {
    const { error: philErr } = await admin
      .from("vendors")
      .update({ product_philosophy: orNull(formData.get("product_philosophy")) })
      .eq("id", id);
    if (philErr) {
      console.warn("vendors.product_philosophy not saved (apply migration 0099):", philErr.message);
    }
  }

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
    const draft = await generateVendorProfile(
      {
        kind: "vendor",
        displayName: vendor.display_name,
        currentMission: vendor.mission_statement,
        currentAbout: vendor.about,
        website: vendor.website,
        instruction,
      },
      { entityId: id, actorId: session.userId, actorEmail: session.email },
    );

    if (draft.mission) {
      await persistSuggestion({
        entity_type: "vendor",
        entity_id: id,
        field_key: "mission_statement",
        suggested_value: draft.mission,
        input_summary: `${vendor.display_name} · mission${instruction ? " · " + instruction : ""}`,
        generated_by: session.userId,
        confidence: draft.confidence,
        source: draft.source,
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
        confidence: draft.confidence,
        source: draft.source,
      });
    }
    if (draft.philosophy) {
      await persistSuggestion({
        entity_type: "vendor",
        entity_id: id,
        field_key: "product_philosophy",
        suggested_value: draft.philosophy,
        input_summary: `${vendor.display_name} · philosophy${instruction ? " · " + instruction : ""}`,
        generated_by: session.userId,
        confidence: draft.confidence,
        source: draft.source,
      });
    }

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "vendor.ai_drafted",
      entityType: "vendor",
      entityId: id,
      after: { fields: ["mission_statement", "about", "product_philosophy"], flags: draft.complianceFlags },
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

  // Only allow writing the known profile fields (product_philosophy since
  // migration 0099 — same field brands have always had).
  const allowed = new Set(["mission_statement", "about", "product_philosophy"]);
  if (!allowed.has(suggestion!.field_key)) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Unsupported field."));
  }

  // S-4: compliance RE-SCAN at accept — blocking flags refuse the accept.
  const gate = await acceptWithComplianceGate(suggestion!);
  if (!gate.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "vendor.ai_accept_blocked",
      entityType: "vendor",
      entityId: vendorId,
      after: { field: suggestion!.field_key, ...gate.audit },
    });
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent(gate.message) + "#ai-drafts");
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
    after: { field: suggestion!.field_key, ...gate.audit },
  });

  revalidatePath(`/admin/vendors/${vendorId}`);
  redirect(`/admin/vendors/${vendorId}?saved=1#ai-drafts`);
}

/**
 * H12a: accept a `research_social` reference draft — the crawler's social-link
 * sweep. There is no single profile COLUMN for it (which is why the generic
 * accept said "Unsupported field."); instead the draft body is parsed back
 * into structured links and GAP-FILLED into social_json on the vendor or
 * brand. Existing values are never overwritten — the owner's hand-entered
 * handles always win. Drafts-only lifecycle preserved: a human clicked Accept,
 * the draft is marked accepted, and the audit records exactly what changed.
 */
export async function acceptSocialDraftAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const suggestionId = String(formData.get("suggestionId") ?? "");
  const vendorId = String(formData.get("vendorId") ?? "");
  if (!suggestionId || !vendorId) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Missing suggestion."));
  }

  const suggestion = await getSuggestion(suggestionId);
  if (!suggestion || suggestion.field_key !== "research_social") {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Suggestion not found."));
  }
  const entityType = suggestion!.entity_type;
  const entityId = suggestion!.entity_id;
  const table = entityType === "vendor" ? "vendors" : entityType === "brand" ? "brands" : null;
  if (!table || (entityType === "vendor" && entityId !== vendorId)) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Unsupported suggestion target."));
  }

  const parsed = parseSocialDraft(suggestion!.suggested_value);
  if (Object.keys(parsed.links).length === 0 && parsed.unsupported.length === 0) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("No social links found in this draft."));
  }

  const admin = createSupabaseAdminClient();
  const { data: row, error: loadError } = await admin
    .from(table!)
    .select("id, social_json")
    .eq("id", entityId)
    .maybeSingle();
  if (loadError || !row) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent(loadError?.message ?? "Record not found."));
  }

  const mergeResult = mergeSocialLinks(
    (row as { social_json: SocialLinks | null }).social_json,
    parsed.links,
  );
  if (mergeResult.filled.length > 0) {
    const { error } = await admin
      .from(table!)
      .update({ social_json: mergeResult.merged, updated_by: session.userId })
      .eq("id", entityId);
    if (error) redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent(error.message));
  }

  await reviewSuggestion(suggestionId, "accepted", session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: `${entityType}.social_accepted`,
    entityType,
    entityId,
    after: {
      field: "research_social",
      filled: mergeResult.filled,
      alreadySet: mergeResult.alreadySet,
      unsupported: parsed.unsupported,
    },
  });

  const msg = summarizeSocialAccept(mergeResult, parsed.unsupported);
  revalidatePath(`/admin/vendors/${vendorId}`);
  redirect(`/admin/vendors/${vendorId}?saved=1&note=${encodeURIComponent(msg)}#ai-drafts`);
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
    const draft = await generateVendorProfile(
      {
        kind: "brand",
        displayName: brand!.display_name,
        currentMission: brand!.mission_statement,
        currentAbout: brand!.about,
        currentPhilosophy: brand!.product_philosophy,
        website: brand!.website,
        instruction,
      },
      { entityId: brandId, actorId: session.userId, actorEmail: session.email },
    );

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
        confidence: draft.confidence,
        source: draft.source,
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

  // S-4: compliance RE-SCAN at accept — blocking flags refuse the accept.
  const gate = await acceptWithComplianceGate(suggestion!);
  if (!gate.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "brand.ai_accept_blocked",
      entityType: "brand",
      entityId: brandId,
      after: { field: suggestion!.field_key, ...gate.audit },
    });
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent(gate.message) + `#brand-${brandId}`);
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
    after: { field: suggestion!.field_key, ...gate.audit },
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

/* ------------------------------------------------------------------ *
 * DF-6: "Research with the crawler" — delegate to the Python worker.
 * The worker fetches the URL, extracts honestly (CSS-first → LLM →
 * verify → compliance), and writes pending drafts into ai_suggestions
 * with source=crawl:<url>. We just kick it off and report the count.
 * Drafts-only: nothing is written to the vendor/brand record here.
 * ------------------------------------------------------------------ */

/**
 * Map a crawl failure to a user-facing message. IMPORTANT: callers must call
 * `unstable_rethrow(err)` BEFORE this, so Next.js control-flow errors (the
 * success-path `redirect()` throws NEXT_REDIRECT internally) propagate instead
 * of being swallowed and shown as "Crawler error: NEXT_REDIRECT".
 */
function crawlFailureMessage(err: unknown): string {
  if (err instanceof CrawlerNotConfiguredError) return "Crawler isn't set up yet.";
  if (err instanceof Error && err.name === "AbortError") {
    return "Crawler timed out — the page may be slow or blocking robots. Try again, or try a simpler page (e.g. the About page).";
  }
  return `Crawler error: ${err instanceof Error ? err.message : "please try again"}`;
}

/** Crawl a URL for a VENDOR → pending drafts in the review queue. */
export async function crawlVendorAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const id = String(formData.get("id") ?? "");
  const url = String(formData.get("url") ?? "").trim();
  if (!id) redirect("/admin/vendors?error=" + encodeURIComponent("Missing vendor id."));
  if (!url || !/^https?:\/\//i.test(url)) {
    redirect(`/admin/vendors/${id}?error=` + encodeURIComponent("Enter a valid http(s) URL to research."));
  }
  if (!isCrawlerConfigured()) {
    redirect(`/admin/vendors/${id}?error=` + encodeURIComponent("Crawler isn't set up yet (CRAWLER_BASE_URL / CRAWLER_SHARED_SECRET)."));
  }

  const vendor = await getVendorById(id);
  if (!vendor) redirect("/admin/vendors?error=" + encodeURIComponent("Vendor not found."));

  try {
    const result = await researchUrl({
      url,
      entityType: "vendor",
      entityId: id,
      displayName: vendor!.display_name,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "vendor.crawl_drafted",
      entityType: "vendor",
      entityId: id,
      after: { url, written: result.drafts_written, skipped: result.drafts_skipped, fromCache: result.from_cache },
    });
    if (!result.ok) {
      redirect(`/admin/vendors/${id}?error=` + encodeURIComponent(`Couldn't research that page: ${result.error || "unknown error"}`));
    }
    const msg =
      result.drafts_written > 0
        ? `Researched ${result.pages?.length ?? 1} page(s) on ${url} — ${result.drafts_written} draft(s) added for review.`
        : `Researched ${result.pages?.length ?? 1} page(s) on ${url} — no new drafts (nothing verifiable found, or already pending).`;
    revalidatePath(`/admin/vendors/${id}`);
    redirect(`/admin/vendors/${id}?saved=1&note=${encodeURIComponent(msg)}#ai-drafts`);
  } catch (err) {
    unstable_rethrow(err); // let NEXT_REDIRECT (success path) propagate
    redirect(`/admin/vendors/${id}?error=` + encodeURIComponent(crawlFailureMessage(err)));
  }
}

/** Crawl a URL for a BRAND → pending drafts in the review queue. */
export async function crawlBrandAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const brandId = String(formData.get("brandId") ?? "");
  const vendorId = String(formData.get("vendorId") ?? "");
  const url = String(formData.get("url") ?? "").trim();
  if (!brandId || !vendorId) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Missing brand id."));
  }
  if (!url || !/^https?:\/\//i.test(url)) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Enter a valid http(s) URL to research."));
  }
  if (!isCrawlerConfigured()) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Crawler isn't set up yet."));
  }

  const brand = await getBrandById(brandId);
  if (!brand) redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Brand not found."));

  try {
    const result = await researchUrl({
      url,
      entityType: "brand",
      entityId: brandId,
      displayName: brand!.display_name,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "brand.crawl_drafted",
      entityType: "brand",
      entityId: brandId,
      after: { url, written: result.drafts_written, skipped: result.drafts_skipped, fromCache: result.from_cache },
    });
    if (!result.ok) {
      redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent(`Couldn't research that page: ${result.error || "unknown error"}`));
    }
    const msg =
      result.drafts_written > 0
        ? `Researched ${result.pages?.length ?? 1} page(s) on ${url} — ${result.drafts_written} brand draft(s) added for review.`
        : `Researched ${result.pages?.length ?? 1} page(s) on ${url} — no new drafts (nothing verifiable found, or already pending).`;
    revalidatePath(`/admin/vendors/${vendorId}`);
    redirect(`/admin/vendors/${vendorId}?saved=1&note=${encodeURIComponent(msg)}#brand-${brandId}`);
  } catch (err) {
    unstable_rethrow(err); // let NEXT_REDIRECT (success path) propagate
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent(crawlFailureMessage(err)));
  }
}

/** Pull a VENDOR's public Instagram business profile → pending drafts (DF-9, sanctioned). */
export async function crawlVendorSocialAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const id = String(formData.get("id") ?? "");
  const handle = String(formData.get("handle") ?? "").trim();
  if (!id) redirect("/admin/vendors?error=" + encodeURIComponent("Missing vendor id."));
  if (!handle) {
    redirect(`/admin/vendors/${id}?error=` + encodeURIComponent("Enter the vendor's Instagram handle."));
  }
  if (!isCrawlerConfigured()) {
    redirect(`/admin/vendors/${id}?error=` + encodeURIComponent("Crawler isn't set up yet (CRAWLER_BASE_URL / CRAWLER_SHARED_SECRET)."));
  }

  const vendor = await getVendorById(id);
  if (!vendor) redirect("/admin/vendors?error=" + encodeURIComponent("Vendor not found."));

  try {
    const result = await researchSocial({
      handle,
      entityType: "vendor",
      entityId: id,
      displayName: vendor!.display_name,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "vendor.social_drafted",
      entityType: "vendor",
      entityId: id,
      after: { handle, written: result.drafts_written, skipped: result.drafts_skipped },
    });
    if (!result.ok) {
      redirect(`/admin/vendors/${id}?error=` + encodeURIComponent(`Couldn't read @${handle}: ${result.error || "unknown error"}`));
    }
    const msg =
      result.drafts_written > 0
        ? `Pulled @${handle} — ${result.drafts_written} draft(s) added for review.`
        : `Pulled @${handle} — no new drafts (nothing verifiable found, or already pending).`;
    revalidatePath(`/admin/vendors/${id}`);
    redirect(`/admin/vendors/${id}?saved=1&note=${encodeURIComponent(msg)}#ai-drafts`);
  } catch (err) {
    unstable_rethrow(err); // let NEXT_REDIRECT (success path) propagate
    redirect(`/admin/vendors/${id}?error=` + encodeURIComponent(crawlFailureMessage(err)));
  }
}

/** Pull a BRAND's public Instagram business profile → pending drafts (DF-9, sanctioned). */
export async function crawlBrandSocialAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const brandId = String(formData.get("brandId") ?? "");
  const vendorId = String(formData.get("vendorId") ?? "");
  const handle = String(formData.get("handle") ?? "").trim();
  if (!brandId || !vendorId) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Missing brand id."));
  }
  if (!handle) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Enter the brand's Instagram handle."));
  }
  if (!isCrawlerConfigured()) {
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Crawler isn't set up yet."));
  }

  const brand = await getBrandById(brandId);
  if (!brand) redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent("Brand not found."));

  try {
    const result = await researchSocial({
      handle,
      entityType: "brand",
      entityId: brandId,
      displayName: brand!.display_name,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "brand.social_drafted",
      entityType: "brand",
      entityId: brandId,
      after: { handle, written: result.drafts_written, skipped: result.drafts_skipped },
    });
    if (!result.ok) {
      redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent(`Couldn't read @${handle}: ${result.error || "unknown error"}`));
    }
    const msg =
      result.drafts_written > 0
        ? `Pulled @${handle} — ${result.drafts_written} brand draft(s) added for review.`
        : `Pulled @${handle} — no new drafts (nothing verifiable found, or already pending).`;
    revalidatePath(`/admin/vendors/${vendorId}`);
    redirect(`/admin/vendors/${vendorId}?saved=1&note=${encodeURIComponent(msg)}#brand-${brandId}`);
  } catch (err) {
    unstable_rethrow(err); // let NEXT_REDIRECT (success path) propagate
    redirect(`/admin/vendors/${vendorId}?error=` + encodeURIComponent(crawlFailureMessage(err)));
  }
}

/* ------------------------------------------------------------------
 * Slice H3 — logo & image pipeline: one-click "save to Media Library"
 * for crawler-discovered image candidates, and one-click "set as logo".
 *
 * The crawler only ever REPORTS image URLs (research_logos /
 * research_images reference drafts). Downloading is a human decision:
 * these actions fetch the image server-side (size/MIME capped,
 * private hosts refused), content-hash dedupe it, and store it as a
 * media_assets DRAFT with source=crawl:<url> and
 * license_status='pending-review'. Assigning it as a vendor/brand
 * logo is a separate explicit click that also publishes the asset —
 * mirroring the manual logo-upload path.
 * ------------------------------------------------------------------ */

/** Import one crawler-found image into the Media Library (draft). */
export async function importHarvestImageAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const vendorId = String(formData.get("vendorId") ?? "");
  const entityType = String(formData.get("entityType") ?? ""); // "vendor" | "brand"
  const entityId = String(formData.get("entityId") ?? "");
  const imageUrl = String(formData.get("imageUrl") ?? "").trim();
  const assign = String(formData.get("assign") ?? "") === "logo";
  const back = `/admin/vendors/${vendorId}`;

  if (!vendorId || !entityId || !imageUrl || (entityType !== "vendor" && entityType !== "brand")) {
    redirect(`${back}?error=` + encodeURIComponent("Missing image details."));
  }

  const entity =
    entityType === "vendor" ? await getVendorById(entityId) : await getBrandById(entityId);
  if (!entity) redirect(`${back}?error=` + encodeURIComponent("Vendor/brand not found."));
  const displayName = entity!.display_name;

  try {
    const { asset, deduped } = await importImageFromUrl({
      imageUrl,
      usageType: entityType === "vendor" ? "vendor-logo" : "brand-logo",
      title: `${displayName} (harvested)`,
      altText: `${displayName} logo`,
      uploadedBy: session.userId,
      tags: [entityType === "vendor" ? "vendor-logo" : "brand-logo"],
    });

    let note: string;
    if (assign) {
      // Assigning as logo is the human's explicit publish decision.
      const admin = createSupabaseAdminClient();
      const table = entityType === "vendor" ? "vendors" : "brands";
      const { error } = await admin
        .from(table)
        .update({ logo_media_id: asset.id })
        .eq("id", entityId);
      if (error) redirect(`${back}?error=` + encodeURIComponent(error.message));
      await admin.from("media_assets").update({ status: "published" }).eq("id", asset.id);
      await recordUsage(asset.id, entityType, entityId, "logo");
      note = `Logo saved${deduped ? " (already in the library — reused)" : ""} and assigned to ${displayName}.`;
    } else {
      note = deduped
        ? "That image is already in the Media Library — reused the existing copy."
        : "Image saved to the Media Library as a draft (license: pending review).";
    }

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: assign ? `${entityType}.harvest_logo_assigned` : `${entityType}.harvest_image_saved`,
      entityType,
      entityId,
      after: { imageUrl, mediaAssetId: asset.id, deduped },
    });

    revalidatePath(back);
    redirect(`${back}?saved=1&note=${encodeURIComponent(note)}`);
  } catch (err) {
    unstable_rethrow(err); // let NEXT_REDIRECT (success path) propagate
    const msg = err instanceof HarvestImageError ? err.message : "Couldn't import that image.";
    redirect(`${back}?error=` + encodeURIComponent(msg));
  }
}
