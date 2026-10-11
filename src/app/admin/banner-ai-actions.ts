"use server";
/**
 * src/app/admin/banner-ai-actions.ts — R41 S8 "✨ AI suggest" for Banner Studio.
 *
 * DRAFTS-ONLY (bible rule 3): this action LOOKS at the picture and RETURNS a
 * suggestion. It never writes to the database. Banner Studio previews it, and
 * only "Apply" changes the editor's unsaved state; the owner still presses
 * Save draft / Publish in that editor.
 */
import { requirePermission } from "@/lib/auth/session";
import { generateVision, isAiConfigured } from "@/lib/ai/provider";
import { COMPLIANCE_SYSTEM } from "@/lib/ai/compliance";
import { publicSiteOrigin } from "@/lib/site/site-domain-core";
import { normalizeDesign } from "@/lib/cms/banner-design-core";
import {
  PLACEMENT_SYSTEM,
  absoluteImageUrl,
  buildPlacementPrompt,
  parsePlacementReply,
  promptInputFor,
  type PlacementSuggestion,
} from "@/lib/cms/banner-ai-core";

export type BannerAiResult = { ok: true; suggestion: PlacementSuggestion } | { ok: false; message: string };

export async function suggestBannerPlacementAction(input: {
  imageSrc: string;
  design: unknown;
  legacy?: { eyebrow?: string; title?: string; subtitle?: string };
  device?: "desktop" | "mobile";
}): Promise<BannerAiResult> {
  const session = await requirePermission("content.edit");
  if (!isAiConfigured) return { ok: false, message: "AI isn't set up yet. Ask your developer to add the AI key, then try again." };

  const design = normalizeDesign(input?.design);
  if (!design) return { ok: false, message: "Couldn't read this banner's design. Refresh and try again." };
  const imageUrl = absoluteImageUrl(input?.imageSrc, publicSiteOrigin(process.env));
  if (!imageUrl) return { ok: false, message: "Pick a picture for this banner first (the AI needs to see it)." };
  const device = input?.device === "mobile" ? "mobile" : "desktop";
  const legacy = {
    eyebrow: String(input?.legacy?.eyebrow ?? "").slice(0, 600),
    title: String(input?.legacy?.title ?? "").slice(0, 600),
    subtitle: String(input?.legacy?.subtitle ?? "").slice(0, 600),
  };

  let raw: string;
  try {
    raw = await generateVision({
      system: `${COMPLIANCE_SYSTEM}\n\n${PLACEMENT_SYSTEM}`,
      user: buildPlacementPrompt(promptInputFor(design, legacy, device)),
      imageUrl,
      temperature: 0.2,
      maxTokens: 300,
      context: { feature: "banner.placement", entityType: "banner", actorId: session.userId, actorEmail: session.email },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return {
      ok: false,
      message: /\(4\d\d\)/.test(msg)
        ? "The AI couldn't open this picture. If it's a brand-new upload, save first so it has a public link, then try again."
        : "The AI didn't answer just now. Please try again in a minute.",
    };
  }
  const suggestion = parsePlacementReply(raw);
  if (!suggestion) return { ok: false, message: "The AI's answer wasn't usable this time. Please try again." };
  return { ok: true, suggestion };
}
