/**
 * src/lib/enrichment/text-erase-server.ts  (D244 round 3, slice R-9)
 *
 * Owner (verbatim): "I need a way to remove text on a product picture. I want
 * to drag a box over the text, then click a button to remove it. … If there
 * is the perfect image for a product, but it has a different name on it, I
 * want the ai to help recommend the name to be removed from the image. Can we
 * use flux for this or is one of the other ai models we use."
 *
 * Two AI models, each for what it is good at:
 *   - the vision model (mediaAiModel) READS the photo: where each piece of
 *     text is, and whether it names this product (findTextOnPhoto);
 *   - FLUX.1 Fill [pro] (flux-pro-1.0-fill) REMOVES it: the picture plus a
 *     black/white mask (white = the boxes) and it repaints only the boxes
 *     to match the packaging around them (startTextErase).
 *
 * The browser drives the FLUX poll (no long function), the same pattern as
 * the newsletter canvas. The finished picture is saved as a NEW library
 * photo (the original is never touched) carrying the original's vendor /
 * brand / role / pack facts, tagged text-removed, source text-removed:<id>.
 * Nothing is attached here: the person presses Attach / Attach as cover on
 * the before/after view (AGENTS.md: the AI never attaches on its own).
 */
import "server-only";
import { generateVisionJson, isAiConfigured } from "@/lib/ai/provider";
import { mediaAiModel } from "@/lib/media/media-describe-store";
import { getBudgetStatus } from "@/lib/ai/router";
import { logAiUsage } from "@/lib/ai/usage";
import { isFluxConfigured, pollFluxTask, submitFluxTask } from "@/lib/marketing/flux-client";
import { fluxFillBody } from "@/lib/cms/newsletter-picture-core";
import { loadInput } from "@/lib/cms/newsletter-ai-server";
import { getMedia, publicUrlForKey, uploadMedia } from "@/lib/media/store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { MediaAsset } from "@/lib/supabase/types";
import {
  ERASE_DILATE_PX,
  ERASE_FALLBACK_MODEL,
  ERASE_MODEL,
  ERASE_TAGS,
  cleanBox,
  eraseBody,
  eraseSendSize,
  eraseUnavailable,
  growBoxes,
  interleaveRgba,
  pasteBackPlan,
  TEXT_FIND_SYSTEM,
  checkEraseBoxes,
  erasePrompt,
  eraseMaskSvg,
  erasedSource,
  erasedStatus,
  erasedTitle,
  parseTextFind,
  textFindUserPrompt,
  type EraseBox,
  type EraseProduct,
  type FoundText,
} from "./text-erase-core";

type Fail = { ok: false; error: string };

export function mediaPublicUrl(a: Pick<MediaAsset, "public_url" | "storage_key">): string | null {
  return a.public_url || publicUrlForKey(a.storage_key) || null;
}

async function budgetBlocked(): Promise<Fail | null> {
  const b = await getBudgetStatus().catch(() => null);
  return b?.blocked ? { ok: false, error: b.reason ?? "The monthly AI budget is used up." } : null;
}

export async function textEraseReady(): Promise<{ vision: boolean; flux: boolean }> {
  return { vision: isAiConfigured, flux: await isFluxConfigured().catch(() => false) };
}

// ---------------------------------------------------------------------------
// 1. Find the text (vision, read only)
// ---------------------------------------------------------------------------

export type FindTextOut = { ok: true; found: FoundText[] } | Fail;

export async function findTextOnPhoto(p: { mediaId: string; product: EraseProduct; productKey: string; actorId: string | null }): Promise<FindTextOut> {
  if (!isAiConfigured) return { ok: false, error: "AI is not set up, so the text cannot be found automatically. Drag boxes by hand." };
  const blocked = await budgetBlocked();
  if (blocked) return blocked;
  const asset = await getMedia(p.mediaId);
  const url = asset ? mediaPublicUrl(asset) : null;
  if (!asset || !url) return { ok: false, error: "That photo is not in the media library any more." };
  try {
    const out = await generateVisionJson({
      system: TEXT_FIND_SYSTEM,
      user: textFindUserPrompt(p.product),
      imageUrl: url,
      model: mediaAiModel(),
      detail: "high",
      maxTokens: 900,
      context: { feature: "product.remove_text.find", entityType: "product", entityId: p.productKey, actorId: p.actorId },
    });
    const found = parseTextFind(out.content, p.product);
    if (!found) return { ok: false, error: "The AI answer could not be read. Try again, or drag boxes by hand." };
    return { ok: true, found };
  } catch (err) {
    return { ok: false, error: `Finding the text failed (${err instanceof Error ? err.message.slice(0, 160) : "error"}). Drag boxes by hand.` };
  }
}

// ---------------------------------------------------------------------------
// 2. Remove it (FLUX Erase; Fill only as the fallback)
// ---------------------------------------------------------------------------

export type EraseMethod = "erase" | "fill";
export type StartEraseOut = { ok: true; pollingUrl: string; prompt: string; boxes: EraseBox[]; method: EraseMethod } | Fail;

/** The photo turned upright (EXIF) on white, as the browser showed it when the boxes were drawn. */
async function uprightPicture(buf: Buffer): Promise<{ png: Buffer; width: number; height: number } | null> {
  const sharp = (await import("sharp")).default;
  const png = await sharp(buf).rotate().flatten({ background: "#ffffff" }).png().toBuffer();
  const meta = await sharp(png).metadata();
  if (!meta.width || !meta.height) return null;
  return { png, width: meta.width, height: meta.height };
}

/**
 * D244 R-17: FLUX Erase (BFL's purpose-built remover, no prompt) on a copy
 * sized to about 1 MP, mask = the padded boxes, dilate_pixels 12. When the
 * BFL project has no Erase access, FLUX Fill with a positive-only prompt.
 */
export async function startTextErase(p: { mediaId: string; boxes: readonly EraseBox[]; surface?: string | null; productKey: string; actorId: string | null; actorEmail?: string | null }): Promise<StartEraseOut> {
  const check = checkEraseBoxes(p.boxes);
  if (!check.ok) return check;
  if (!(await isFluxConfigured().catch(() => false))) return { ok: false, error: "FLUX is not set up (Settings → Integrations), so text cannot be removed yet." };
  const blocked = await budgetBlocked();
  if (blocked) return blocked;
  const asset = await getMedia(p.mediaId);
  const url = asset ? mediaPublicUrl(asset) : null;
  if (!asset || !url) return { ok: false, error: "That photo is not in the media library any more." };
  const input = await loadInput(url);
  if ("ok" in input) return input;
  const sharp = (await import("sharp")).default;
  let image: Buffer;
  let mask: Buffer;
  try {
    const up = await uprightPicture(input.buf);
    if (!up) return { ok: false, error: "The picture size could not be read." };
    const send = eraseSendSize(up.width, up.height);
    image = await sharp(up.png).resize(send.width, send.height, { fit: "fill" }).jpeg({ quality: 95 }).toBuffer();
    mask = await sharp(Buffer.from(eraseMaskSvg(send.width, send.height, check.boxes))).greyscale().png().toBuffer();
  } catch {
    return { ok: false, error: "That file is not a picture FLUX can read." };
  }
  const prompt = erasePrompt({ surface: p.surface });
  let method: EraseMethod = "erase";
  let sub = await submitFluxTask(ERASE_MODEL, eraseBody({ imageB64: image.toString("base64"), maskB64: mask.toString("base64") }));
  if (!sub.ok && eraseUnavailable(sub.error)) {
    method = "fill";
    sub = await submitFluxTask(ERASE_FALLBACK_MODEL, fluxFillBody({ imageB64: image.toString("base64"), maskB64: mask.toString("base64"), prompt }));
  }
  await logAiUsage({
    feature: "product.remove_text.flux",
    entityType: "product",
    entityId: p.productKey,
    actorId: p.actorId,
    actorEmail: p.actorEmail ?? null,
    model: method === "erase" ? ERASE_MODEL : ERASE_FALLBACK_MODEL,
    ok: sub.ok,
    estimated: true,
    errorNote: sub.ok ? (sub.cost ? `credits ${sub.cost}` : null) : sub.error.slice(0, 200),
  }).catch(() => {});
  if (!sub.ok) return sub;
  return { ok: true, pollingUrl: sub.pollingUrl, prompt: method === "erase" ? "" : prompt, boxes: check.boxes, method };
}

/**
 * D244 R-17 paste-back: FLUX's answer is laid over the ORIGINAL through the
 * boxes (grown a little, edges feathered), so nothing outside the boxes can
 * change: no new text, barcodes or blur appear anywhere else, and the photo
 * keeps its full size. Returns null when it cannot (the raw answer is kept).
 */
export async function pasteBack(originalBuf: Buffer, resultBuf: Buffer, boxes: readonly EraseBox[]): Promise<Buffer | null> {
  if (!boxes.length) return null;
  const sharp = (await import("sharp")).default;
  const up = await uprightPicture(originalBuf);
  if (!up) return null;
  const { width: W, height: H } = up;
  const plan = pasteBackPlan(eraseSendSize(W, H).scale, ERASE_DILATE_PX);
  const rgb = await sharp(resultBuf).resize(W, H, { fit: "fill" }).removeAlpha().toColourspace("srgb").raw().toBuffer();
  const alpha = await sharp(Buffer.from(eraseMaskSvg(W, H, growBoxes(boxes, W, H, plan.growPx)))).blur(plan.featherPx).extractChannel(0).raw().toBuffer();
  if (rgb.length !== W * H * 3 || alpha.length !== W * H) return null;
  const overlay = Buffer.from(interleaveRgba(rgb, alpha));
  return sharp(up.png)
    .composite([{ input: overlay, raw: { width: W, height: H, channels: 4 } }])
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

/** The boxes the browser sends back with each poll (already checked + padded at start). */
export function pollBoxes(raw: unknown): EraseBox[] {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v.slice(0, 12).map(cleanBox).filter((b): b is EraseBox => b !== null);
}

// ---------------------------------------------------------------------------
// 3. Poll once; when ready save a NEW library photo
// ---------------------------------------------------------------------------

export type ErasePollOut =
  | { state: "pending"; progress?: number; label?: string }
  | { state: "ready"; mediaId: string; url: string; published: boolean }
  | { state: "failed"; error: string };

export async function pollTextErase(p: { pollingUrl: string; originalId: string; actorId: string | null; boxes?: unknown }): Promise<ErasePollOut> {
  const r = await pollFluxTask(String(p.pollingUrl));
  if (!(r.status === "ready" && r.sampleUrl)) {
    if (r.terminal) return { state: "failed", error: r.detail ?? "FLUX reported an error." };
    return { state: "pending", progress: r.progress, label: r.label };
  }
  const original = await getMedia(p.originalId);
  if (!original) return { state: "failed", error: "The original photo is gone from the library." };
  try {
    // The download URL comes from BFL's own poll answer, never the browser.
    const res = await fetch(r.sampleUrl, { cache: "no-store" });
    if (!res.ok) return { state: "failed", error: `Downloading the result failed (${res.status}). Press Remove text again.` };
    let buffer: Buffer = Buffer.from(await res.arrayBuffer());
    let mime = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (!mime.startsWith("image/")) mime = "image/jpeg";
    // D244 R-17: paste the answer back over the original inside the boxes only.
    const ourl = mediaPublicUrl(original);
    const boxes = pollBoxes(p.boxes);
    if (ourl && boxes.length) {
      const oin = await loadInput(ourl).catch(() => null);
      if (oin && !("ok" in oin)) {
        const merged = await pasteBack(oin.buf, buffer, boxes).catch(() => null);
        if (merged) {
          buffer = merged;
          mime = "image/jpeg";
        }
      }
    }
    const status = erasedStatus(original);
    const title = erasedTitle(original.title || original.filename);
    const saved = await uploadMedia({
      buffer,
      filename: `${title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80).toLowerCase() || "text-removed"}.${mime === "image/png" ? "png" : "jpg"}`,
      mimeType: mime,
      title,
      altText: original.alt_text ?? undefined,
      description: `Text removed with FLUX from library photo ${original.id} (only the boxed areas changed).`,
      usageType: original.usage_type || "product",
      tags: [...new Set([...(original.tags ?? []).filter((t) => t !== "text-removed"), ...ERASE_TAGS])],
      uploadedBy: p.actorId,
      status,
      source: erasedSource(original.id),
      licenseStatus: original.license_status ?? undefined,
    });
    // Carry the product facts (0352 columns) so the recommender treats it as
    // the same vendor's product photo. Best effort: an older database skips.
    await createSupabaseAdminClient()
      .from("media_assets")
      .update({
        vendor_id: original.vendor_id ?? null,
        brand_id: original.brand_id ?? null,
        role: original.role ?? null,
        category: original.category ?? null,
        pack_size: original.pack_size ?? null,
        platform: original.platform ?? null,
      })
      .eq("id", saved.id)
      .then(
        () => null,
        () => null,
      );
    const url = mediaPublicUrl(saved);
    if (!url) return { state: "failed", error: "Saved, but the picture has no public link." };
    return { state: "ready", mediaId: saved.id, url, published: status === "published" };
  } catch (err) {
    return { state: "failed", error: err instanceof Error ? err.message.slice(0, 300) : "Saving the result failed." };
  }
}
