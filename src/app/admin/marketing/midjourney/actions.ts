"use server";

import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { suggestBrief, isAiConfigured, type BriefSuggestion } from "@/lib/marketing/midjourney-ai";
import { suggestCreativeConcept, type CreativeConcept } from "@/lib/marketing/creative-ai";
import { getStoreProfile } from "@/lib/admin/store-profile-store";
import { listVendors } from "@/lib/vendors/store";
import { checkFluxTask, getFluxCredits, submitFluxImages } from "@/lib/marketing/flux-client";
import { publicUrlForKey, uploadMedia } from "@/lib/media/store";
import type { FluxImageSettings } from "@/lib/marketing/flux-core";
import { placementById } from "@/lib/marketing/creative-placements-core";
import { loadPublishedRuleSnapshots } from "@/lib/promotions/discount-engine";
import { weeklyDealSummaries } from "@/lib/promotions/published-rules-core";
import { MEDIA_UPLOAD_MAX_BYTES, tooLargeMessage } from "@/lib/media/gif-core";

export type BriefAssistResult =
  | { ok: true; suggestion: BriefSuggestion }
  | { ok: false; error: string };

/** Build a grounded brand-context blurb from REAL store + vendor data. */
async function buildBrandContext(): Promise<string> {
  const [profile, vendors] = await Promise.all([
    getStoreProfile().catch(() => null),
    listVendors({ status: "published" }).catch(() => [] as Awaited<ReturnType<typeof listVendors>>),
  ]);
  const lines: string[] = [];
  if (profile) {
    lines.push(`Store: ${profile.storeName} — a licensed cannabis retailer in ${profile.city}, ${profile.state}.`);
  }
  const vendorNames = vendors.slice(0, 12).map((v) => v.display_name).filter(Boolean);
  if (vendorNames.length) {
    lines.push(`Some brands/vendors carried: ${vendorNames.join(", ")}.`);
  }
  lines.push("Audience: adults 21+. Tone: premium, clean, welcoming, professional.");
  return lines.join("\n");
}

/**
 * Ask the AI to expand a short idea into structured brief fields, grounded in
 * the store's real brand context. Drafts-only — the employee edits before use.
 */
export async function assistBriefAction(input: {
  idea: string;
  presetLabel?: string;
}): Promise<BriefAssistResult> {
  const session = await requirePermission("content.edit");
  if (!isAiConfigured) return { ok: false, error: "AI is not configured. Fill the brief fields manually." };
  const idea = (input.idea ?? "").trim();
  if (idea.length < 3) return { ok: false, error: "Describe your idea in a few words first." };

  try {
    const brandContext = await buildBrandContext();
    const suggestion = await suggestBrief({ idea, presetLabel: input.presetLabel, brandContext });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "midjourney.brief_assist",
      entityType: "marketing",
      entityId: "midjourney",
      after: { idea, preset: input.presetLabel ?? null },
    });
    return { ok: true, suggestion };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI request failed." };
  }
}

/**
 * Build a grounded blurb of the store's LIVE promotions from the published
 * discount rules (real offer mechanics — the same source the menu uses).
 */
async function buildPromotionsContext(): Promise<string> {
  try {
    const snapshots = await loadPublishedRuleSnapshots();
    const weekly = weeklyDealSummaries(snapshots).filter((d) => d.fromDatabase || d.title);
    if (!weekly.length) return "";
    const lines = weekly.map(
      (d) =>
        `${d.weekday[0].toUpperCase()}${d.weekday.slice(1)}: ${d.title} — ${d.offerLabel}${d.description ? ` (${d.description})` : ""}`,
    );
    return lines.join("\n");
  } catch {
    return "";
  }
}

export type CreativeConceptActionResult =
  | { ok: true; concept: CreativeConcept; complianceFlags: string[] }
  | { ok: false; error: string };

/**
 * Greenway AI creative director: draft a full image concept for a chosen
 * placement + idea, grounded in the store profile and LIVE promotions.
 * DRAFTS-ONLY — the suggestion fills the builder's editable fields.
 */
export async function suggestCreativeConceptAction(input: {
  idea: string;
  placementId?: string | null;
}): Promise<CreativeConceptActionResult> {
  const session = await requirePermission("content.edit");
  if (!isAiConfigured) return { ok: false, error: "AI is not configured. Fill the brief fields manually." };

  const placement = placementById(input.placementId);
  try {
    const [brandContext, promotionsContext] = await Promise.all([
      buildBrandContext(),
      buildPromotionsContext(),
    ]);
    const res = await suggestCreativeConcept({
      idea: input.idea ?? "",
      placement,
      brandContext,
      promotionsContext,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "creative.concept_assist",
      entityType: "marketing",
      entityId: placement?.id ?? "creative-studio",
      after: { idea: (input.idea ?? "").slice(0, 300), placement: placement?.id ?? null, flags: res.complianceFlags },
    });
    return { ok: true, concept: res.concept, complianceFlags: res.complianceFlags };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI request failed." };
  }
}

export type FluxTaskTicket = { ok: true; id: string; pollingUrl: string; seed?: number; cost?: number; outputMp?: number } | { ok: false; error: string };

export type FluxSubmitImagesResult =
  | { ok: true; model: string; width?: number; height?: number; warnings: string[]; tasks: FluxTaskTicket[]; totalCost: number }
  | { ok: false; error: string };

/**
 * R62: submit 1, 2, 3, 4 or 8 images exactly like the BFL Playground. The
 * prompt is sent verbatim with only verified per-model fields. The browser
 * then polls each task with checkFluxTaskAction (no server timeout). content.edit.
 */
export async function submitFluxImagesAction(settings: FluxImageSettings): Promise<FluxSubmitImagesResult> {
  const session = await requirePermission("content.edit");
  if (!settings || typeof settings.prompt !== "string" || !settings.prompt.trim()) return { ok: false, error: "Write a prompt first." };
  if (settings.prompt.length > 20000) return { ok: false, error: "That prompt is too long (20,000 characters max)." };
  const referenceImages = (settings.referenceImages ?? []).filter((r) => typeof r === "string" && /^https:\/\//i.test(r.trim()));
  const res = await submitFluxImages({ ...settings, referenceImages });
  if (!res.ok) return res;
  const totalCost = res.tasks.reduce((s, t) => s + (t.ok && t.cost ? t.cost : 0), 0);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "flux.image_submitted",
    entityType: "media",
    entityId: null,
    after: {
      model: res.model,
      count: res.tasks.length,
      accepted: res.tasks.filter((t) => t.ok).length,
      width: res.width ?? null,
      height: res.height ?? null,
      referenceCount: referenceImages.length,
      cost: totalCost,
    },
  }).catch(() => undefined);
  return { ok: true, model: res.model, width: res.width, height: res.height, warnings: res.warnings, tasks: res.tasks, totalCost };
}

export type FluxCheckActionResult =
  | { state: "pending"; label?: string; progress?: number }
  | { state: "ready"; asset: { id: string; url: string; filename: string; title: string }; draftCache?: string }
  | { state: "failed"; error: string };

/**
 * R62: poll up to 8 FLUX tasks (image or video) in parallel, ONCE. Finished
 * files are saved to the media library as DRAFTS. The browser repeats the call
 * for tasks still "pending", so long jobs never hit a server time limit.
 */
export async function checkFluxTasksAction(
  tasks: { pollingUrl: string; kind: "image" | "video"; prompt: string }[],
): Promise<FluxCheckActionResult[]> {
  const session = await requirePermission("content.edit");
  const list = Array.isArray(tasks) ? tasks.slice(0, 8) : [];
  return Promise.all(
    list.map(async (t): Promise<FluxCheckActionResult> => {
      const kind = t?.kind === "video" ? "video" : "image";
      const res = await checkFluxTask({
        pollingUrl: String(t?.pollingUrl ?? ""),
        kind,
        prompt: String(t?.prompt ?? "").slice(0, 20000),
        uploadedBy: session.userId,
        tags: ["marketing"],
      });
      if (res.state !== "ready") return res;
      const a = res.asset;
      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: kind === "video" ? "flux.video_generated" : "flux.image_generated",
        entityType: "media",
        entityId: a.id,
        after: { mime: a.mime_type, size: a.size_bytes },
      }).catch(() => undefined);
      const dc = res.result && typeof res.result.draft_cache === "string" ? res.result.draft_cache : undefined;
      return {
        state: "ready",
        asset: { id: a.id, url: a.public_url ?? publicUrlForKey(a.storage_key) ?? "", filename: a.filename, title: a.title ?? a.filename },
        draftCache: dc,
      };
    }),
  );
}

/** R62: current BFL credit balance for the studio header. content.edit. */
export async function fluxCreditsAction(): Promise<{ credits: number | null }> {
  await requirePermission("content.edit");
  return { credits: await getFluxCredits() };
}

/**
 * Upload a single reference image DIRECTLY from the prompt builder so the
 * employee can bring their own FLUX.2 reference without first visiting the
 * Media page. Reuses the SAME verified media pipeline (uploadMedia -> public
 * `media` bucket) the Media page uses, so the file persists, gets a stable
 * public URL FLUX can fetch, and is reusable later. Saved as a DRAFT tagged
 * "flux-reference" (AI-adjacent asset the staffer can publish/curate later).
 *
 * Only raster images are accepted here: FLUX.2 references must be fetchable
 * pictures (PNG / JPEG / WEBP / GIF) — SVG/PDF are not valid image references.
 */
const FLUX_REF_MAX_BYTES = MEDIA_UPLOAD_MAX_BYTES; // R43: match media library ceiling (Vercel 4.5 MB body cap)
const FLUX_REF_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export type FluxReferenceUploadResult =
  | { ok: true; reference: { id: string; url: string; label: string } }
  | { ok: false; error: string };

export async function uploadFluxReferenceAction(
  formData: FormData,
): Promise<FluxReferenceUploadResult> {
  const session = await requirePermission("content.edit");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image to upload." };
  }
  if (!FLUX_REF_ALLOWED_MIME.has(file.type)) {
    return {
      ok: false,
      error: `Unsupported type: ${file.type || file.name}. Use PNG, JPG, WEBP, or GIF.`,
    };
  }
  if (file.size > FLUX_REF_MAX_BYTES) {
    return { ok: false, error: tooLargeMessage(file.name, file.size) };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const asset = await uploadMedia({
      buffer,
      filename: file.name,
      mimeType: file.type,
      usageType: "marketing",
      tags: ["marketing", "flux-reference"],
      uploadedBy: session.userId,
      status: "draft",
    });

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "media.uploaded",
      entityType: "media_asset",
      entityId: asset.id,
      after: { via: "flux_reference_upload" },
    });

    const url = asset.public_url ?? publicUrlForKey(asset.storage_key) ?? "";
    if (!url) {
      return { ok: false, error: "Uploaded, but no public URL is available. Check storage configuration." };
    }
    return {
      ok: true,
      reference: { id: asset.id, url, label: asset.title || asset.filename },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Upload failed." };
  }
}
