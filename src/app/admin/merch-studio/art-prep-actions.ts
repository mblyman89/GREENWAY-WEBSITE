"use server";

/**
 * D267 - Merch Studio "Prep for Printful" (server). Reuses the picture-tool
 * plumbing: fetchCapped (public https only, 12 MB cap), sharp Lanczos, the
 * FLUX client + monthly AI budget + AI usage ledger, and saveResult-style
 * Media saves. FLUX polling reuses printFluxPollAction (client side).
 * D268: Remove background no longer uses GPT Image (gpt-image-2 refuses
 * transparent output) - see merchRemoveBgAction. Every result is a NEW
 * Media file (usage "merch"); originals are never touched. Audited.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { logAiUsage } from "@/lib/ai/usage";
import { isFluxConfigured, submitFluxTask } from "@/lib/marketing/flux-client";
import { fetchCapped } from "@/lib/cms/newsletter-canvas-server";
import { budgetBlock } from "@/lib/cms/newsletter-ai-server";
import { uploadMedia, publicUrlForKey } from "@/lib/media/store";
import { FLUX_ISOLATE_PROMPT, KEY_MAX_PX, borderColor, keyOutBackground, printUpscalePlan } from "@/lib/merch-studio/art-prep-core";

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

async function savePng(buf: Buffer, title: string, uploadedBy: string, tag: string): Promise<{ url: string; mediaId: string } | Fail> {
  const asset = await uploadMedia({ buffer: buf, filename: `merch-art-${tag}-${Date.now().toString(36)}.png`, mimeType: "image/png", usageType: "merch", tags: ["merch", "merch-art", tag], title: title.slice(0, 120), altText: "", uploadedBy, status: "published", optimize: false });
  const url = publicUrlForKey(asset.storage_key) ?? asset.public_url;
  return url ? { url, mediaId: asset.id } : { ok: false, error: "Saved, but the picture has no public link." };
}

/** Key the flat border colour out (edge flood-fill, soft edge). null = border is not one flat colour. */
async function keyOut(buf: Buffer, minUniform: number): Promise<{ png: Buffer; cleared: number } | { already: true } | null> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(buf, { limitInputPixels: KEY_MAX_PX }).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = borderColor(data, info.width, info.height);
  if (b.transparent > 0.6) return { already: true };
  if (b.uniform < minUniform) return null;
  const cleared = keyOutBackground(data, info.width, info.height, b.color);
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  return { png, cleared };
}

/**
 * D268 - Remove background for print (transparent PNG).
 *   1. Logo on a flat colour (most logos): keyed out on our server - exact
 *      pixels, free, instant. Inside details are kept (edge flood-fill).
 *   2. Busy / photo background: FLUX Kontext Pro redraws it onto flat magenta
 *      (poll with printFluxPollAction), then merchKeyOutAction cuts it out.
 */
export async function merchRemoveBgAction(p: { url: string; title?: string }): Promise<PrepOut> {
  const session = await requirePermission("content.edit");
  const r = await fetchCapped(String(p?.url ?? "").slice(0, 2000));
  if (!r.buf) return { ok: false, error: `The picture could not be loaded (${r.error ?? "error"}).` };
  const title = String(p.title ?? "Artwork").slice(0, 80);
  let k: Awaited<ReturnType<typeof keyOut>>;
  try {
    k = await keyOut(r.buf, 0.85);
  } catch {
    return { ok: false, error: "That file is not a picture we can read." };
  }
  if (k && "already" in k) return { ok: false, error: "This picture already has a see-through background." };
  if (k) {
    const saved = await savePng(k.png, `${title} (no background)`, session.userId, "no-bg");
    if ("ok" in saved) return saved;
    await audit(session, "merch.art.remove_bg", { mediaId: saved.mediaId, engine: "local", cleared: Math.round(k.cleared * 100) });
    return { ok: true, kind: "done", url: saved.url, mediaId: saved.mediaId, note: "Background removed (transparent PNG)." };
  }
  // Busy background -> FLUX Kontext onto flat magenta.
  if (!(await isFluxConfigured())) return { ok: false, error: "The background is not one flat colour, and FLUX is not set up (Settings > Integrations)." };
  const blocked = await budgetBlock();
  if (blocked) return blocked;
  let b64: string;
  try {
    const sharp = (await import("sharp")).default;
    b64 = (await sharp(r.buf).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).png().toBuffer()).toString("base64");
  } catch {
    return { ok: false, error: "That file is not a picture FLUX can read." };
  }
  const sub = await submitFluxTask("flux-kontext-pro", { prompt: FLUX_ISOLATE_PROMPT, input_image: b64, output_format: "png", safety_tolerance: 2 });
  await logAiUsage({ feature: "merch.art.remove_bg.flux", entityType: "merch_design", entityId: ENTITY, actorId: session.userId, actorEmail: session.email, model: "flux-kontext-pro", ok: sub.ok, estimated: true, errorNote: sub.ok ? (sub.cost ? `credits ${sub.cost}` : null) : sub.error.slice(0, 200) });
  await audit(session, "merch.art.remove_bg", { engine: "flux", ok: sub.ok });
  if (!sub.ok) return sub;
  return { ok: true, kind: "flux", pollingUrl: sub.pollingUrl, prompt: "Background removed (FLUX Kontext)" };
}

/** D268 step 2 for busy backgrounds: cut the flat colour FLUX painted behind the art. */
export async function merchKeyOutAction(p: { url: string; title?: string }): Promise<PrepOut> {
  const session = await requirePermission("content.edit");
  const r = await fetchCapped(String(p?.url ?? "").slice(0, 2000));
  if (!r.buf) return { ok: false, error: `The picture could not be loaded (${r.error ?? "error"}).` };
  try {
    const k = await keyOut(r.buf, 0.5);
    if (!k || "already" in k) return { ok: false, error: "FLUX did not give a clean flat background - try again or use a cleaner source." };
    const saved = await savePng(k.png, `${String(p.title ?? "Artwork").slice(0, 80)} (no background)`, session.userId, "no-bg");
    if ("ok" in saved) return saved;
    await audit(session, "merch.art.remove_bg", { mediaId: saved.mediaId, engine: "flux+local" });
    return { ok: true, kind: "done", url: saved.url, mediaId: saved.mediaId, note: "Background removed with FLUX (transparent PNG)." };
  } catch {
    return { ok: false, error: "That file is not a picture we can read." };
  }
}
