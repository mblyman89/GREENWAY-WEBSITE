"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { uploadMedia, updateMediaMeta, setMediaStatus, whereUsed, getMedia, publicUrlForKey, recordUsage } from "@/lib/media/store";
import { generate, generateVision, isAiConfigured } from "@/lib/ai/provider";
import { COMPLIANCE_SYSTEM, checkCompliance } from "@/lib/ai/compliance";
import { normalizeTags } from "@/lib/media/taxonomy";
import { classifyMediaAsset, suggestTags, crawlPath } from "@/lib/media/classify-core";
import {
  entityNameFromTitle,
  deriveCategoryWord,
  nameFromFilename,
  buildMediaSuggestInstruction,
  parseMediaSuggestResponse,
} from "@/lib/media/suggest-core";
import { buildGroundedFacts } from "@/lib/ai/kb/retrieval";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  bestProductMatches,
  buildProductLinkPayload,
  parseProductLinkPayload,
  isLogoUsage,
  withLogoReviewTag,
  type ProductForMatch,
} from "@/lib/media/product-link-core";
import { persistSuggestion, reviewSuggestion, getSuggestion, listSuggestions } from "@/lib/ai/suggestions";
import { attachKbProductImage, listKbProducts } from "@/lib/ai/kb/store";
import type { AiSuggestion } from "@/lib/enrichment/types";

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

/* ------------------------------------------------------------------
 * Slice H10c — KB-grounded "suggest EVERYTHING" for a media asset.
 *
 * ONE structured call fills every field: title + description + alt text
 * (grounded in KB knowledge — category vocabulary like rosin/edibles,
 * vendor/brand about/mission/philosophy — instead of literal pixels),
 * plus a usage_type verdict and placement tags from the H10b classifier
 * (the vision verdict feeds the classifier, which may OVERTURN the
 * import-time stamp — e.g. a product can misfiled as "Vendor logo").
 *
 * Drafts-only: the result pre-fills the editor form; the staffer
 * reviews/edits and clicks Save. Nothing is written here.
 * ------------------------------------------------------------------ */

export type MediaSuggestAllResult =
  | {
      ok: true;
      title: string;
      description: string;
      altText: string;
      usageType: string;
      /** Comma-joined for the tags input. */
      tags: string;
      confidence: number;
      reasons: string[];
      /** True when the suggested usage_type contradicts the current one. */
      overturnsPrior: boolean;
      complianceFlags: string[];
      method: "vision" | "context";
      /** Which KB sources grounded the copy (kb:category:…, entity:about…). */
      sources: string[];
    }
  | { ok: false; error: string };

/** Best-effort vendor/brand about+mission+philosophy for grounding. */
async function loadEntityFacts(entityName: string): Promise<{ block: string; sources: string[] }> {
  if (!entityName || !isSupabaseServiceConfigured) return { block: "", sources: [] };
  const lines: string[] = [];
  const sources: string[] = [];
  try {
    const admin = createSupabaseAdminClient();
    const needle = entityName.toLowerCase();
    // Vendors carry mission_statement/about/product_philosophy (0003 + 0099).
    const { data: vendors } = await admin
      .from("vendors")
      .select("display_name,about,mission_statement,product_philosophy")
      .limit(500);
    const v = (vendors ?? []).find(
      (r) => String(r.display_name ?? "").toLowerCase() === needle,
    );
    if (v) {
      if (v.about) { lines.push(`About ${v.display_name}: ${v.about}`); sources.push("entity:vendor:about"); }
      if (v.mission_statement) { lines.push(`${v.display_name} mission: ${v.mission_statement}`); sources.push("entity:vendor:mission"); }
      if (v.product_philosophy) { lines.push(`${v.display_name} product philosophy: ${v.product_philosophy}`); sources.push("entity:vendor:philosophy"); }
    }
    // Brands carry about/mission_statement/product_philosophy (0003).
    const { data: brands } = await admin
      .from("brands")
      .select("display_name,about,mission_statement,product_philosophy")
      .limit(500);
    const b = (brands ?? []).find(
      (r) => String(r.display_name ?? "").toLowerCase() === needle,
    );
    if (b) {
      if (b.about) { lines.push(`About ${b.display_name}: ${b.about}`); sources.push("entity:brand:about"); }
      if (b.mission_statement) { lines.push(`${b.display_name} mission: ${b.mission_statement}`); sources.push("entity:brand:mission"); }
      if (b.product_philosophy) { lines.push(`${b.display_name} product philosophy: ${b.product_philosophy}`); sources.push("entity:brand:philosophy"); }
    }
  } catch {
    // Best-effort: grounding is thinner, never fails the suggestion.
  }
  return { block: lines.join("\n"), sources };
}

export async function suggestMediaAllAction(id: string): Promise<MediaSuggestAllResult> {
  const session = await requirePermission("media.manage");
  if (!isAiConfigured) {
    return { ok: false, error: "AI is not configured. Set AI_API_KEY to enable suggestions." };
  }
  const asset = await getMedia(id);
  if (!asset) return { ok: false, error: "Asset not found." };

  // --- 1) Derive the grounding query from the asset's own signals -----------
  const entityName = entityNameFromTitle(asset.title);
  const derivedName = nameFromFilename(asset.filename);
  const path = crawlPath(asset.source);
  const categoryWord = deriveCategoryWord({
    path,
    filename: asset.filename,
    tags: asset.tags,
  });

  // --- 2) Pull KB knowledge (category vocab + brand notes + entity copy) ----
  const [grounded, entity] = await Promise.all([
    buildGroundedFacts({
      name: derivedName || entityName || asset.filename || "media asset",
      brand: entityName || null,
      vendor: entityName || null,
      category: categoryWord || null,
    }),
    loadEntityFacts(entityName),
  ]);

  // --- 3) ONE structured call: vision verdict + title + description + alt ---
  const instruction = buildMediaSuggestInstruction({
    groundedBlock: grounded.block,
    entityBlock: entity.block,
    entityName: entityName || null,
    derivedName: derivedName || null,
    filename: asset.filename,
    currentUsageType: asset.usage_type,
  });

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
        user: instruction,
        imageUrl: imageUrl!,
        temperature: 0.4,
        // H12b: three extra label fields in the JSON — headroom so the reply
        // never truncates mid-object (parse would fall back to prose salvage).
        maxTokens: 400,
        context: { ...ctx, feature: "media.suggest_all" },
      });
    } else {
      method = "context";
      raw = await generate({
        system: COMPLIANCE_SYSTEM,
        user: instruction,
        temperature: 0.4,
        maxTokens: 400,
        context: { ...ctx, feature: "media.suggest_all" },
      });
    }

    const parsed = parseMediaSuggestResponse(raw);

    // --- 4) Classify (vision verdict + row signals; may overturn the prior) --
    const signals = {
      filename: asset.filename,
      source: asset.source,
      title: asset.title,
      tags: asset.tags,
      mimeType: asset.mime_type,
      width: asset.width,
      height: asset.height,
      currentUsageType: asset.usage_type,
      visionSubject: method === "vision" ? parsed.visionSubject : null,
      entityName: entityName || null,
    };
    const cls = classifyMediaAsset(signals);
    const tags = suggestTags(cls, signals);
    // H12b: label facts the vision call read off the packaging become tags so
    // the library is filterable by strain / strain type ("hybrid", "blue-dream").
    for (const t of [parsed.labelStrain, parsed.labelStrainType]) {
      const n = t.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
      if (n && !tags.includes(n) && tags.length < 12) tags.push(n);
    }

    const combinedText = [parsed.title, parsed.description, parsed.altText].filter(Boolean).join(" ");
    const flags = checkCompliance(combinedText).flags;

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "media.ai_suggest_all",
      entityType: "media_asset",
      entityId: id,
      after: {
        method,
        usageType: cls.usageType,
        confidence: cls.confidence,
        overturnsPrior: cls.overturnsPrior,
        visionSubject: parsed.visionSubject,
        labelRatio: parsed.labelRatio || undefined,
        labelStrain: parsed.labelStrain || undefined,
        labelStrainType: parsed.labelStrainType || undefined,
        sources: [...grounded.sources, ...entity.sources],
        complianceFlags: flags,
      },
    });

    return {
      ok: true,
      title: parsed.title,
      description: parsed.description,
      altText: parsed.altText,
      usageType: cls.usageType,
      tags: tags.join(", "),
      confidence: cls.confidence,
      reasons: [
        ...cls.reasons,
        // H12b: show the owner exactly what was read off the packaging.
        ...(parsed.labelRatio ? [`Label ratio read from packaging: ${parsed.labelRatio}`] : []),
        ...(parsed.labelStrain ? [`Strain on label: ${parsed.labelStrain}`] : []),
        ...(parsed.labelStrainType ? [`Strain type on label: ${parsed.labelStrainType}`] : []),
      ],
      overturnsPrior: cls.overturnsPrior,
      complianceFlags: flags,
      method,
      sources: [...grounded.sources, ...entity.sources],
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI suggestion failed." };
  }
}

/* ------------------------------------------------------------------
 * Slice H10d — product-image → product link (drafts-only) + logo
 * validator routing.
 *
 * "if its a product image, we need to link it to a product … vendor
 * logos should be flagged and sent to a logo validator" — owner.
 *
 * suggestProductLinksAction matches the asset against kb_products
 * (conservative token overlap, scored + reasoned) and persists the
 * best candidates as PENDING ai_suggestions rows (field_key
 * "media_product_link"). NOTHING attaches until the owner clicks
 * Accept, which runs the existing attachKbProductImage() from H9c.
 *
 * routeLogoForReviewAction stamps the needs-logo-review tag so logo
 * assets surface in the validation lane (tag-searchable in the
 * library) — idempotent, keeps every existing tag.
 * ------------------------------------------------------------------ */

export type ProductLinkSuggestion = {
  suggestionId: string;
  productId: string;
  productName: string;
  brandSlug: string;
  score: number;
  reasons: string[];
};

export type ProductLinkResult =
  | { ok: true; suggestions: ProductLinkSuggestion[]; note: string }
  | { ok: false; error: string };

/** Find likely kb_products for this image and save drafts-only link suggestions. */
export async function suggestProductLinksAction(id: string): Promise<ProductLinkResult> {
  const session = await requirePermission("media.manage");
  const asset = await getMedia(id);
  if (!asset) return { ok: false, error: "Asset not found." };

  const entityName = entityNameFromTitle(asset.title);
  const derivedName = nameFromFilename(asset.filename);
  if (!derivedName && !entityName) {
    return { ok: false, error: "Not enough signals (no usable filename or title) to match a product." };
  }

  // Candidates: every non-archived KB product (drafts included — the owner is
  // usually enriching drafts when harvested images arrive).
  const rows = await listKbProducts("all", 1000);
  const candidates: ProductForMatch[] = rows
    .filter((r) => r.status !== "archived")
    .map((r) => ({
      id: r.id,
      brand_slug: r.brand_slug,
      product_slug: r.product_slug,
      variant_label: r.variant_label,
      display_name: r.display_name,
      category: r.category,
      status: r.status,
    }));
  if (candidates.length === 0) {
    return { ok: false, error: "No KB products to match against yet." };
  }

  const matches = bestProductMatches(
    { derivedName, entityName, extraText: (asset.tags ?? []).join(" ") },
    candidates,
  );
  if (matches.length === 0) {
    return { ok: false, error: "No confident product match — link it manually from the product page." };
  }

  // Skip candidates that already have a pending suggestion for this asset.
  const existing = await listSuggestions("media_asset", id, "pending");
  const alreadySuggested = new Set(
    existing
      .filter((s) => s.field_key === "media_product_link")
      .map((s) => parseProductLinkPayload(s.suggested_value)?.product_id)
      .filter(Boolean),
  );

  const out: ProductLinkSuggestion[] = [];
  for (const m of matches) {
    if (alreadySuggested.has(m.product.id)) {
      continue;
    }
    const saved = await persistSuggestion({
      entity_type: "media_asset",
      entity_id: id,
      field_key: "media_product_link",
      suggested_value: buildProductLinkPayload(id, m),
      input_summary: `Match ${derivedName || entityName} → ${m.product.display_name} (${m.product.brand_slug})`,
      generated_by: session.userId,
      confidence: m.score,
      source: asset.source ?? "kb",
    });
    out.push({
      suggestionId: saved.id,
      productId: m.product.id,
      productName: m.product.display_name,
      brandSlug: m.product.brand_slug,
      score: m.score,
      reasons: m.reasons,
    });
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "media.product_link_suggested",
    entityType: "media_asset",
    entityId: id,
    after: { count: out.length, productIds: out.map((s) => s.productId) },
  });

  const note =
    out.length > 0
      ? `${out.length} product link${out.length === 1 ? "" : "s"} suggested — review below and accept to attach.`
      : "Matches found but all were already suggested — review the pending suggestions below.";
  revalidatePath(`/admin/media/${id}`);
  return { ok: true, suggestions: out, note };
}

/** List pending product-link suggestions for one asset (server page helper). */
export async function pendingProductLinks(id: string): Promise<
  { suggestion: AiSuggestion; productId: string; productName: string; brandSlug: string; score: number; reasons: string[] }[]
> {
  const rows = await listSuggestions("media_asset", id, "pending");
  const out = [];
  for (const s of rows) {
    if (s.field_key !== "media_product_link") continue;
    const p = parseProductLinkPayload(s.suggested_value);
    if (!p) continue;
    out.push({
      suggestion: s,
      productId: p.product_id,
      productName: p.product_display_name,
      brandSlug: p.brand_slug,
      score: p.score,
      reasons: p.reasons,
    });
  }
  return out;
}

/** Owner ACCEPTS a product-link draft → attach via the H9c gallery merge. */
export async function acceptProductLinkAction(formData: FormData): Promise<void> {
  const session = await requirePermission("media.manage");
  const suggestionId = String(formData.get("suggestionId") ?? "");
  const mediaId = String(formData.get("mediaId") ?? "");
  const back = `/admin/media/${mediaId}`;
  if (!suggestionId || !mediaId) redirect(`${back}?error=` + encodeURIComponent("Missing suggestion details."));

  const suggestion = await getSuggestion(suggestionId);
  if (!suggestion || suggestion.entity_id !== mediaId || suggestion.field_key !== "media_product_link") {
    redirect(`${back}?error=` + encodeURIComponent("Suggestion not found."));
  }
  const payload = parseProductLinkPayload(suggestion!.suggested_value);
  if (!payload) redirect(`${back}?error=` + encodeURIComponent("Suggestion payload unreadable."));

  const res = await attachKbProductImage(payload!.product_id, mediaId, session.userId);
  if (!res.ok) redirect(`${back}?error=` + encodeURIComponent(res.error ?? "Attach failed."));

  await reviewSuggestion(suggestionId, "accepted", session.userId);
  await recordUsage(mediaId, "kb_product", payload!.product_id, "gallery");
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "media.product_link_accepted",
    entityType: "media_asset",
    entityId: mediaId,
    after: { productId: payload!.product_id, becamePrimary: res.becamePrimary, alreadyPresent: res.alreadyPresent },
  });

  revalidatePath(back);
  redirect(
    `${back}?saved=1&note=` +
      encodeURIComponent(
        `Attached to ${payload!.product_display_name}${res.becamePrimary ? " (set as primary image)" : ""}.`,
      ),
  );
}

/** Owner REJECTS a product-link draft — nothing attaches. */
export async function rejectProductLinkAction(formData: FormData): Promise<void> {
  const session = await requirePermission("media.manage");
  const suggestionId = String(formData.get("suggestionId") ?? "");
  const mediaId = String(formData.get("mediaId") ?? "");
  const back = `/admin/media/${mediaId}`;
  if (!suggestionId || !mediaId) redirect(`${back}?error=` + encodeURIComponent("Missing suggestion details."));

  const suggestion = await getSuggestion(suggestionId);
  if (!suggestion || suggestion.entity_id !== mediaId || suggestion.field_key !== "media_product_link") {
    redirect(`${back}?error=` + encodeURIComponent("Suggestion not found."));
  }
  await reviewSuggestion(suggestionId, "rejected", session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "media.product_link_rejected",
    entityType: "media_asset",
    entityId: mediaId,
  });
  revalidatePath(back);
  redirect(`${back}?saved=1&note=` + encodeURIComponent("Product link rejected."));
}

/** Route a logo asset to the validation lane (needs-logo-review tag). */
export async function routeLogoForReviewAction(formData: FormData): Promise<void> {
  const session = await requirePermission("media.manage");
  const id = String(formData.get("id") ?? "");
  const back = `/admin/media/${id}`;
  if (!id) redirect("/admin/media?error=" + encodeURIComponent("Missing asset id."));

  const asset = await getMedia(id);
  if (!asset) redirect(`${back}?error=` + encodeURIComponent("Asset not found."));
  if (!isLogoUsage(asset!.usage_type)) {
    redirect(`${back}?error=` + encodeURIComponent("Only logo-type assets can be routed to logo review."));
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("media_assets")
    .update({ tags: withLogoReviewTag(asset!.tags) })
    .eq("id", id);
  if (error) redirect(`${back}?error=` + encodeURIComponent(error.message));

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "media.logo_routed_for_review",
    entityType: "media_asset",
    entityId: id,
  });
  revalidatePath(back);
  redirect(`${back}?saved=1&note=` + encodeURIComponent("Flagged for logo validation (needs-logo-review)."));
}
