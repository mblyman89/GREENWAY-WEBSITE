"use server";

/**
 * D267 - Merch Studio "Prep for Printful" (server). Reuses the picture-tool
 * plumbing: fetchCapped (public https only, 12 MB cap), sharp Lanczos, the
 * FLUX client + monthly AI budget + AI usage ledger, and saveResult-style
 * Media saves. Remove background reuses printPictureToolAction and FLUX
 * polling reuses printFluxPollAction (client side). Every result is a NEW
 * Media file (usage "merch"); originals are never touched. Audited.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { logAiUsage } from "@/lib/ai/usage";
import { isFluxConfigured, submitFluxTask } from "@/lib/marketing/flux-client";
import { fetchCapped } from "@/lib/cms/newsletter-canvas-server";
import { budgetBlock } from "@/lib/cms/newsletter-ai-server";
import { uploadMedia, publicUrlForKey } from "@/lib/media/store";
import { printUpscalePlan } from "@/lib/merch-studio/art-prep-core";

type Fail = { ok: false; error: string };
export type PrepOut = { ok: true; kind: "done"; url: string; mediaId: string; note: string } | { ok: true; kind: "flux"; pollingUrl: string; prompt: string } | Fail;

const ENTITY = "merch-studio";
const clampIn = (n: unknown) => Math.max(0.5, Math.min(40, Number(n) || 0));

async function audit(session: { userId: string; email: string | null }, action: string, after: Record<string, unknown>) {
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action, entityType: "merch_design", entityId: ENTITY, after }).catch(() => {});
}

/** Enlarge to 300 DPI at the placement size (sharp, Lanczos + light sharpen). No AI, no cost. */
export async function merchUpscaleAction(p: { url: string; title?: string; widthIn: number; heightIn: number }): Promise<PrepOut> {
  const session = await requirePermission("content.edit");
  const r = await fetchCapped(String(p?.url ?? "").slice(0, 2000));
  if (!r.buf) return { ok: false, error: `The picture could not be loaded (${r.error ?? "error"}).` };
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(r.buf).metadata();
    const plan = printUpscalePlan(meta.width ?? 0, meta.height ?? 0, clampIn(p.widthIn), clampIn(p.heightIn));
    if (!plan.ok) return plan;
    const out = await sharp(r.buf, { limitInputPixels: 8192 * 8192 }).rotate().resize({ width: plan.width, height: plan.height, kernel: "lanczos3" }).sharpen({ sigma: 0.6 }).png({ compressionLevel: 9 }).toBuffer();
    const asset = await uploadMedia({
      buffer: out,
      filename: `merch-art-300dpi-${Date.now().toString(36)}.png`,
      mimeType: "image/png",
      usageType: "merch",
      tags: ["merch", "merch-art", "print-ready"],
      title: `${String(p.title ?? "Artwork").slice(0, 80)} (300 DPI)`,
      altText: "",
      uploadedBy: session.userId,
      status: "published",
      optimize: false,
    });
    const url = publicUrlForKey(asset.storage_key) ?? asset.public_url;
    if (!url) return { ok: false, error: "Saved, but the picture has no public link." };
    await audit(session, "merch.art.upscale", { mediaId: asset.id, width: plan.width, height: plan.height });
    return { ok: true, kind: "done", url, mediaId: asset.id, note: `Enlarged ${plan.factor}x to ${plan.width} x ${plan.height} px.` };
  } catch {
    return { ok: false, error: "That file is not a picture that can be enlarged." };
  }
}

/** FLUX Deblur (flux-tools/deblur-v1): regenerates soft / pixelated art sharper. No prompt. Poll with printFluxPollAction. */
export async function merchSharpenAction(p: { url: string }): Promise<PrepOut> {
  const session = await requirePermission("content.edit");
  if (!(await isFluxConfigured())) return { ok: false, error: "FLUX is not set up (Settings > Integrations)." };
  const blocked = await budgetBlock();
  if (blocked) return blocked;
  const r = await fetchCapped(String(p?.url ?? "").slice(0, 2000));
  if (!r.buf) return { ok: false, error: `The picture could not be loaded (${r.error ?? "error"}).` };
  let b64: string;
  try {
    const sharp = (await import("sharp")).default;
    // FLUX tools take up to ~4 MP; shrink only if bigger (we enlarge afterwards anyway).
    b64 = (await sharp(r.buf).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).png().toBuffer()).toString("base64");
  } catch {
    return { ok: false, error: "That file is not a picture FLUX can read." };
  }
  const sub = await submitFluxTask("flux-tools/deblur-v1", { image: b64, output_format: "png", safety_tolerance: 2 });
  await logAiUsage({ feature: "merch.art.sharpen.flux", entityType: "merch_design", entityId: ENTITY, actorId: session.userId, actorEmail: session.email, model: "flux-tools/deblur-v1", ok: sub.ok, estimated: true, errorNote: sub.ok ? (sub.cost ? `credits ${sub.cost}` : null) : sub.error.slice(0, 200) });
  await audit(session, "merch.art.sharpen", { ok: sub.ok });
  if (!sub.ok) return sub;
  return { ok: true, kind: "flux", pollingUrl: sub.pollingUrl, prompt: "Sharpened for print (FLUX Deblur)" };
}
