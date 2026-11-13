/**
 * src/lib/cms/newsletter-picture-server.ts
 *
 * D243 E-4 (SOP-22 G-124): the AI picture tools, server side.
 *   - Erase / Replace what I paint: FLUX Fill (flux-pro-1.0-fill) with the
 *     painted mask (white = redraw, black = keep).
 *   - Extend / stretch: FLUX Expand (flux-pro-1.0-expand), pixels per side.
 *   - Remove background, Change a colour, Relight, Style look, Variations:
 *     GPT Image or Gemini through the N-8b picture path (aiImage).
 *   - Enlarge 2×: sharp on our own server (no AI, no cost).
 *   - AI GIF: the AI draws frame 1, then edits it into the next frames, and
 *     the N-8c GIF maker joins them (email-weight limits included).
 *
 * Every AI call: the prompt check (WAC 314-55-155) and the safety rules
 * (buildPicturePrompt), the monthly AI budget (budgetBlock), the AI usage
 * ledger (logAiUsage). Every result is a NEW Media file; originals are kept.
 */
import "server-only";
import { logAiUsage } from "@/lib/ai/usage";
import { isFluxConfigured, submitFluxTask } from "@/lib/marketing/flux-client";
import { fetchCapped } from "./newsletter-canvas-server";
import { buildCanvasGif } from "./newsletter-motion-server";
import { isProbeableUrl } from "./newsletter-canvas-core";
import { aiImage, budgetBlock, imageEngines, loadInput, saveResult, type ImageOut } from "./newsletter-ai-server";
import type { ImageAspectKey, ImageEngine } from "./newsletter-ai-core";
import {
  EXTEND_SHAPES,
  VARIATIONS_MAX,
  buildPicturePrompt,
  extendPadding,
  fluxExpandBody,
  fluxFillBody,
  maskBase64,
  padToRatio,
  padTotal,
  pickEngine,
  resultTitle,
  toolDef,
  upscalePlan,
  type ExtendSide,
  type PictureOpts,
  type PictureTool,
  type ToolEngine,
} from "./newsletter-picture-core";

type Actor = { actorId: string | null; actorEmail: string | null };
type Fail = { ok: false; error: string };

export type PictureOut =
  | { ok: true; kind: "done"; results: { url: string; mediaId: string }[]; engine: ToolEngine; transparent: boolean; note?: string }
  | { ok: true; kind: "flux"; pollingUrl: string; prompt: string }
  | Fail;

export type PictureRequest = {
  tool: PictureTool;
  engine: ToolEngine | null;
  sourceUrl: string | null;
  opts: PictureOpts;
  /** Erase/Replace: the painted mask as a PNG data URL (any size; it is scaled to the picture). */
  maskDataUrl?: string | null;
  /** Extend: a side + percent, or a target shape. */
  extend?: { side?: ExtendSide; percent?: number; shape?: string | null };
  aspect: ImageAspectKey;
  count?: number;
  postId: string;
} & Actor;

function toOut(r: ImageOut): PictureOut {
  if (!r.ok) return r;
  if (r.kind === "flux") return r;
  return { ok: true, kind: "done", results: [{ url: r.url, mediaId: r.mediaId }], engine: r.engine, transparent: r.transparent };
}

/** One tool run. The browser polls FLUX tasks with the N-8b poll action. */
export async function runPictureTool(p: PictureRequest): Promise<PictureOut> {
  const def = toolDef(p.tool);
  const available = await imageEngines();
  const engine = pickEngine(def.key, p.engine, available);
  if (!engine) {
    return { ok: false, error: def.engines.includes("flux") && def.engines.length === 1 ? `${def.label} uses FLUX. Connect FLUX in Settings > Integrations.` : "No picture AI is set up for this tool (OPENAI_API_KEY or AI_GEMINI_API_KEY)." };
  }
  if (def.needsSource && !(p.sourceUrl && isProbeableUrl(p.sourceUrl))) return { ok: false, error: "Pick a picture on the canvas first (it needs a public https link)." };
  if (def.key === "upscale") return enlarge(p);
  if (def.key === "gif-frame") return aiGif(p, engine as ImageEngine);
  if (def.key === "variation") return variations(p, engine as ImageEngine);

  const built = buildPicturePrompt(def.key, p.opts);
  if (!built.ok) return { ok: false, error: built.error };

  if (def.key === "erase" || def.key === "replace") return fluxFill(p, built.prompt);
  if (def.key === "extend") return fluxExpand(p, built.prompt);

  // GPT Image / Gemini (generate, remove-bg, recolor, relight, style).
  const r = await aiImage({
    engine: engine as ImageEngine,
    ask: String(p.opts.ask ?? "").slice(0, 1500) || def.label,
    promptReady: built.prompt,
    feature: `newsletter.picture.${def.key}.${engine}`,
    sourceUrl: def.needsSource ? p.sourceUrl : null,
    aspect: p.aspect,
    removeBackground: def.key === "remove-bg",
    postId: p.postId,
    actorId: p.actorId,
    actorEmail: p.actorEmail,
  });
  return toOut(r);
}

async function fluxReady(): Promise<Fail | null> {
  if (!(await isFluxConfigured())) return { ok: false, error: "FLUX is not set up (Settings > Integrations)." };
  return budgetBlock();
}

async function fluxFill(p: PictureRequest, prompt: string): Promise<PictureOut> {
  const blocked = await fluxReady();
  if (blocked) return blocked;
  const maskB64 = maskBase64(p.maskDataUrl);
  if (!maskB64) return { ok: false, error: "Paint over the part to change first." };
  const input = await loadInput(String(p.sourceUrl));
  if ("ok" in input) return input;
  const sharp = (await import("sharp")).default;
  let mask: Buffer;
  let image: Buffer;
  try {
    const meta = await sharp(input.buf).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) return { ok: false, error: "The picture size could not be read." };
    // FLUX wants a plain picture (no see-through) and a black/white mask the same size.
    image = await sharp(input.buf).flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
    mask = await sharp(Buffer.from(maskB64, "base64"))
      .flatten({ background: "#000000" })
      .resize({ width: w, height: h, fit: "fill" })
      .greyscale()
      .threshold(16)
      .png()
      .toBuffer();
  } catch {
    return { ok: false, error: "The painted area could not be read. Paint again." };
  }
  const sub = await submitFluxTask("flux-pro-1.0-fill", fluxFillBody({ imageB64: image.toString("base64"), maskB64: mask.toString("base64"), prompt }));
  await logAiUsage({ feature: `newsletter.picture.${p.tool}.flux`, entityType: "blog_post", entityId: p.postId, actorId: p.actorId, actorEmail: p.actorEmail, model: "flux-pro-1.0-fill", ok: sub.ok, estimated: true, errorNote: sub.ok ? (sub.cost ? `credits ${sub.cost}` : null) : sub.error.slice(0, 200) });
  if (!sub.ok) return sub;
  return { ok: true, kind: "flux", pollingUrl: sub.pollingUrl, prompt };
}

async function fluxExpand(p: PictureRequest, prompt: string): Promise<PictureOut> {
  const blocked = await fluxReady();
  if (blocked) return blocked;
  const input = await loadInput(String(p.sourceUrl));
  if ("ok" in input) return input;
  const sharp = (await import("sharp")).default;
  let image: Buffer;
  let w = 0;
  let h = 0;
  try {
    const meta = await sharp(input.buf).metadata();
    w = meta.width ?? 0;
    h = meta.height ?? 0;
    image = await sharp(input.buf).flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
  } catch {
    return { ok: false, error: "That file is not a picture FLUX can read." };
  }
  if (!w || !h) return { ok: false, error: "The picture size could not be read." };
  const shape = EXTEND_SHAPES.find((s) => s.key === p.extend?.shape);
  const pad = shape ? padToRatio(w, h, shape.ratio) : extendPadding(w, h, p.extend?.side ?? "all", Number(p.extend?.percent ?? 50));
  if (padTotal(pad) === 0) return { ok: false, error: "The picture is already that shape." };
  const sub = await submitFluxTask("flux-pro-1.0-expand", fluxExpandBody({ imageB64: image.toString("base64"), pad, prompt }));
  await logAiUsage({ feature: "newsletter.picture.extend.flux", entityType: "blog_post", entityId: p.postId, actorId: p.actorId, actorEmail: p.actorEmail, model: "flux-pro-1.0-expand", ok: sub.ok, estimated: true, errorNote: sub.ok ? (sub.cost ? `credits ${sub.cost}` : null) : sub.error.slice(0, 200) });
  if (!sub.ok) return sub;
  return { ok: true, kind: "flux", pollingUrl: sub.pollingUrl, prompt };
}

/** Enlarge 2× with sharp (Lanczos + a light sharpen). No AI, no budget. */
async function enlarge(p: PictureRequest): Promise<PictureOut> {
  const r = await fetchCapped(String(p.sourceUrl));
  if (!r.buf) return { ok: false, error: `The picture could not be loaded (${r.error ?? "error"}).` };
  const sharp = (await import("sharp")).default;
  try {
    const meta = await sharp(r.buf).metadata();
    const plan = upscalePlan(meta.width ?? 0, meta.height ?? 0);
    if (!plan.ok) return plan;
    const img = sharp(r.buf, { limitInputPixels: 8192 * 8192 }).rotate().resize({ width: plan.width, height: plan.height, kernel: "lanczos3" }).sharpen({ sigma: 0.6 });
    const png = Boolean(meta.hasAlpha);
    const out = png ? await img.png().toBuffer() : await img.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    const saved = await saveResult(out.toString("base64"), png ? "image/png" : "image/jpeg", resultTitle("upscale", ""), "local", p.actorId);
    if (!saved.ok) return saved;
    return { ok: true, kind: "done", results: [{ url: saved.url, mediaId: saved.mediaId }], engine: "local", transparent: png, note: `${plan.width} × ${plan.height} px` };
  } catch {
    return { ok: false, error: "That file is not a picture that can be enlarged." };
  }
}

/** Up to 3 variations, drawn at the same time. */
async function variations(p: PictureRequest, engine: ImageEngine): Promise<PictureOut> {
  const n = Math.max(1, Math.min(VARIATIONS_MAX, Math.round(Number(p.count) || 3)));
  const prompts = Array.from({ length: n }, (_, i) => buildPicturePrompt("variation", { ...p.opts, variant: i + 1 }));
  const bad = prompts.find((x) => !x.ok);
  if (bad && !bad.ok) return { ok: false, error: bad.error };
  const runs = await Promise.all(
    prompts.map((b) =>
      aiImage({ engine, ask: "variation", promptReady: b.ok ? b.prompt : "", feature: `newsletter.picture.variation.${engine}`, sourceUrl: p.sourceUrl, aspect: p.aspect, removeBackground: false, postId: p.postId, actorId: p.actorId, actorEmail: p.actorEmail }),
    ),
  );
  const results = runs.flatMap((r) => (r.ok && r.kind === "done" ? [{ url: r.url, mediaId: r.mediaId }] : []));
  if (!results.length) {
    const first = runs.find((r) => !r.ok);
    return { ok: false, error: first && !first.ok ? first.error : "No variation came back." };
  }
  return { ok: true, kind: "done", results, engine, transparent: false, note: results.length < n ? `${n - results.length} of ${n} did not come back.` : undefined };
}

/** AI GIF: frame 1 is drawn, the next frames are edits of frame 1, then joined. */
async function aiGif(p: PictureRequest, engine: ImageEngine): Promise<PictureOut> {
  const frames = Number(p.opts.frames) === 4 ? 4 : 3;
  const first = buildPicturePrompt("gif-frame", { ...p.opts, frame: 1, frames });
  if (!first.ok) return { ok: false, error: first.error };
  const shape = p.aspect === "banner" ? "banner" : p.aspect === "square" ? "square" : "wide";
  const base = await aiImage({ engine, ask: String(p.opts.ask ?? ""), promptReady: first.prompt, feature: `newsletter.picture.gif.${engine}`, sourceUrl: p.sourceUrl && isProbeableUrl(p.sourceUrl) ? p.sourceUrl : null, aspect: p.aspect, removeBackground: false, postId: p.postId, actorId: p.actorId, actorEmail: p.actorEmail });
  if (!base.ok) return base;
  if (base.kind !== "done") return { ok: false, error: "The AI GIF needs GPT Image or Gemini." };
  const rest = await Promise.all(
    Array.from({ length: frames - 1 }, (_, i) => {
      const b = buildPicturePrompt("gif-frame", { ...p.opts, frame: i + 2, frames });
      return aiImage({ engine, ask: "gif frame", promptReady: b.ok ? b.prompt : "", feature: `newsletter.picture.gif.${engine}`, sourceUrl: base.url, aspect: p.aspect, removeBackground: false, postId: p.postId, actorId: p.actorId, actorEmail: p.actorEmail });
    }),
  );
  const urls = [base.url, ...rest.flatMap((r) => (r.ok && r.kind === "done" ? [r.url] : []))];
  if (urls.length < 2) {
    const bad = rest.find((r) => !r.ok);
    return { ok: false, error: bad && !bad.ok ? bad.error : "The AI could not draw the next frames." };
  }
  const gif = await buildCanvasGif({ urls, seconds: 0.6, shape, width: 600, title: resultTitle("gif-frame", String(p.opts.ask ?? "")), uploadedBy: p.actorId });
  if (!gif.ok) return gif;
  return { ok: true, kind: "done", results: [{ url: gif.url, mediaId: gif.mediaId }], engine, transparent: false, note: `${gif.frames} frames, ${Math.round(gif.bytes / 1024)} KB. The frames are in Media too.` };
}
