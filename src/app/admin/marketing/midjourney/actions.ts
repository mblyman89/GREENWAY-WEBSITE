"use server";

import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { suggestBrief, isAiConfigured, type BriefSuggestion } from "@/lib/marketing/midjourney-ai";
import { getStoreProfile } from "@/lib/admin/store-profile-store";
import { listVendors } from "@/lib/vendors/store";
import { generateFluxImage } from "@/lib/marketing/flux-client";
import { publicUrlForKey } from "@/lib/media/store";
import type { CreativeBrief } from "@/lib/marketing/midjourney-core";

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

export type FluxGenerateResult =
  | {
      ok: true;
      asset: { id: string; url: string; filename: string; title: string };
      endpoint: string;
      warnings: string[];
    }
  | { ok: false; error: string };

/**
 * Generate an image with FLUX 2 from the SAME creative brief the builder holds
 * and save it into the media library as a DRAFT (AI output is employee-validated
 * before publish). Reuses the shared prompt builder via flux-core. content.edit.
 */
export async function generateFluxAction(input: {
  brief: CreativeBrief;
  outputFormat?: "png" | "jpeg";
}): Promise<FluxGenerateResult> {
  const session = await requirePermission("content.edit");
  const brief = input.brief;
  if (!brief || typeof brief.subject !== "string" || brief.subject.trim().length < 3) {
    return { ok: false, error: "Add at least a subject before generating." };
  }

  const res = await generateFluxImage({
    brief,
    outputFormat: input.outputFormat,
    usageType: "marketing",
    title: brief.subject.trim().slice(0, 120),
    tags: ["marketing"],
    uploadedBy: session.userId,
  });

  if (!res.ok) return { ok: false, error: res.error };

  const url = res.asset.public_url ?? publicUrlForKey(res.asset.storage_key) ?? "";
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "flux.image_generated",
    entityType: "media",
    entityId: res.asset.id,
    after: { endpoint: res.endpoint, width: res.request.width, height: res.request.height, subject: brief.subject },
  });

  return {
    ok: true,
    asset: {
      id: res.asset.id,
      url,
      filename: res.asset.filename,
      title: res.asset.title ?? res.asset.filename,
    },
    endpoint: res.endpoint,
    warnings: res.warnings,
  };
}
