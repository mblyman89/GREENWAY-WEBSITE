"use server";

/**
 * D263 S3: Print Studio picture actions (content.edit). Thin wrappers over
 * the newsletter picture tools (FLUX erase/replace/expand, background
 * removal, 2× enlarge, generate) and the enrichment FLUX text-erase. Every
 * run is audited (print.picture.<tool>). Usage is logged under the
 * "print_design" entity so it never touches a blog post.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { aspectOf } from "@/lib/cms/newsletter-ai-core";
import { PICTURE_TOOLS, type PictureTool, type ToolEngine } from "@/lib/cms/newsletter-picture-core";
import { runPictureTool, type PictureOut } from "@/lib/cms/newsletter-picture-server";
import { pollFluxForCanvas, type FluxPollOut } from "@/lib/cms/newsletter-ai-server";
import { findTextOnPhoto, pollMode, pollTextErase, startTextErase, type ErasePollOut, type FindTextOut, type StartEraseOut } from "@/lib/enrichment/text-erase-server";
import { parseEraseBoxes } from "@/lib/enrichment/text-erase-core";
import { findLiveMediaForKey } from "@/lib/media/store";
import { supabaseUrl } from "@/lib/supabase/env";
import { logAiUsage } from "@/lib/ai/usage";
import { isFluxConfigured, submitFluxTask } from "@/lib/marketing/flux-client";
import { budgetBlock } from "@/lib/cms/newsletter-ai-server";
import { fetchCapped } from "@/lib/cms/newsletter-canvas-server";
import { checkImageAsk } from "@/lib/cms/newsletter-ai-core";
import { isProbeableUrl } from "@/lib/cms/newsletter-canvas-core";
import { uploadMedia, publicUrlForKey } from "@/lib/media/store";
import { enlargeBuffer, keyOutBuffer } from "@/lib/media/key-out-server";
import { FLUX_ISOLATE_PROMPT } from "@/lib/merch-studio/art-prep-core";
import { fluxSizeFor, layerPrompt, recreatePrompt } from "@/lib/printing/print-layers-core";

const TOOL_KEYS = PICTURE_TOOLS.map((t) => t.key);
const ENGINES: ToolEngine[] = ["gpt", "gemini", "flux", "local"];
const ENTITY = "print-studio";
const PRINT_PRODUCT = { name: "a printed sign or flyer", brand: null, strainName: null, vendor: null, category: null };

export async function printPictureToolAction(p: {
  tool: string;
  engine: string | null;
  sourceUrl: string | null;
  ask?: string;
  aspect?: string;
  maskDataUrl?: string | null;
  ratio?: number | null;
  side?: string;
  percent?: number;
  /** D271: pixels the print needs (Enlarge goes up to 4x to reach it). */
  targetW?: number;
  targetH?: number;
}): Promise<PictureOut> {
  const session = await requirePermission("content.edit");
  const tool = (TOOL_KEYS.includes(p?.tool as PictureTool) ? p.tool : "generate") as PictureTool;
  const engine = ENGINES.includes(p?.engine as ToolEngine) ? (p.engine as ToolEngine) : null;
  const ask = String(p?.ask ?? "").trim().slice(0, 1500);
  const side = (["all", "left", "right", "top", "bottom"].includes(String(p?.side)) ? p.side : "all") as "all";
  // D271: print-grade versions (no 1200 px email cap; logos keyed out exactly, free).
  if (tool === "upscale") return asPicture(await printEnlargeAction({ url: String(p?.sourceUrl ?? ""), targetW: p?.targetW, targetH: p?.targetH }));
  if (tool === "remove-bg") {
    const local = await localCutout(String(p?.sourceUrl ?? ""), session.userId);
    if (local) return asPicture(local);
  }
  try {
    const out = await runPictureTool({
      tool,
      engine,
      sourceUrl: p?.sourceUrl ? String(p.sourceUrl).slice(0, 2000) : null,
      opts: { ask },
      maskDataUrl: typeof p?.maskDataUrl === "string" ? p.maskDataUrl : null,
      extend: { side, percent: Number(p?.percent) || 50, shape: null, ratio: Number(p?.ratio) || null },
      aspect: aspectOf(p?.aspect).key,
      count: 1,
      postId: ENTITY,
      actorId: session.userId,
      actorEmail: session.email,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: `print.picture.${tool}`,
      entityType: "print_design",
      entityId: ENTITY,
      after: { ok: out.ok, engine, ask: ask.slice(0, 200), mediaIds: out.ok && out.kind === "done" ? out.results.map((r) => r.mediaId) : [], flux: out.ok && out.kind === "flux" },
    }).catch(() => {});
    return out;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "The picture tool failed." };
  }
}

export async function printFluxPollAction(pollingUrl: string, prompt: string): Promise<FluxPollOut> {
  const session = await requirePermission("content.edit");
  try {
    return await pollFluxForCanvas(String(pollingUrl ?? "").slice(0, 600), String(prompt ?? "").slice(0, 1500), session.userId);
  } catch (e) {
    return { state: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "FLUX check failed." };
  }
}

/** A public media URL → its media_assets id (text-erase needs the library row). */
async function mediaIdForUrl(url: string): Promise<string | null> {
  const base = `${String(supabaseUrl ?? "").replace(/\/+$/, "")}/storage/v1/object/public/media/`;
  const u = String(url ?? "").split("?")[0];
  if (!supabaseUrl || !u.startsWith(base)) return null;
  const asset = await findLiveMediaForKey(decodeURIComponent(u.slice(base.length))).catch(() => null);
  return asset?.id ?? null;
}

export async function printFindTextAction(url: string): Promise<FindTextOut & { mediaId?: string }> {
  const session = await requirePermission("content.edit");
  const mediaId = await mediaIdForUrl(url);
  if (!mediaId) return { ok: false, error: "Text removal works on pictures from the media library. Upload it first." };
  const out = await findTextOnPhoto({ mediaId, product: PRINT_PRODUCT, productKey: ENTITY, actorId: session.userId });
  return out.ok ? { ...out, mediaId } : out;
}

export async function printStartEraseAction(url: string, boxesJson: string, mode = "letters"): Promise<StartEraseOut & { mediaId?: string }> {
  const session = await requirePermission("content.edit");
  const mediaId = await mediaIdForUrl(url);
  if (!mediaId) return { ok: false, error: "Text removal works on pictures from the media library. Upload it first." };
  const out = await startTextErase({ mediaId, boxes: parseEraseBoxes(boxesJson), surface: "printed sign", mode: pollMode(mode), productKey: ENTITY, actorId: session.userId, actorEmail: session.email });
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "print.picture.remove_text", entityType: "print_design", entityId: ENTITY, after: { mediaId, ok: out.ok } }).catch(() => {});
  return out.ok ? { ...out, mediaId } : out;
}

export async function printPollEraseAction(pollingUrl: string, mediaId: string, boxesJson: string, mode = "letters"): Promise<ErasePollOut> {
  const session = await requirePermission("content.edit");
  try {
    return await pollTextErase({ pollingUrl: String(pollingUrl ?? "").slice(0, 600), originalId: String(mediaId ?? "").slice(0, 80), actorId: session.userId, boxes: String(boxesJson ?? "").slice(0, 4000), mode: pollMode(mode) });
  } catch (e) {
    return { state: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "FLUX check failed." };
  }
}

// ── D271: picture layers + print-grade AI tools ──────────────────────────────

export type LayerOut = { ok: true; kind: "done"; url: string; mediaId: string; note: string; transparent?: boolean } | { ok: true; kind: "flux"; pollingUrl: string; prompt: string; keyOut?: boolean } | { ok: false; error: string };

function asPicture(o: LayerOut): PictureOut {
  if (!o.ok) return o;
  if (o.kind === "flux") return { ok: true, kind: "flux", pollingUrl: o.pollingUrl, prompt: o.prompt };
  return { ok: true, kind: "done", results: [{ url: o.url, mediaId: o.mediaId }], engine: "local", transparent: !!o.transparent, note: o.note };
}

async function saveLayer(buf: Buffer, mime: string, title: string, uploadedBy: string, tag: string): Promise<{ url: string; mediaId: string } | { ok: false; error: string }> {
  const ext = mime === "image/png" ? "png" : "jpg";
  const asset = await uploadMedia({ buffer: buf, filename: `print-${tag}-${Date.now().toString(36)}.${ext}`, mimeType: mime, usageType: "banner", tags: ["print-studio", tag], title: title.slice(0, 120), altText: "", uploadedBy, status: "published", optimize: false });
  const url = publicUrlForKey(asset.storage_key) ?? asset.public_url;
  return url ? { url, mediaId: asset.id } : { ok: false, error: "Saved, but the picture has no public link." };
}

async function loadPic(url: string): Promise<{ buf: Buffer } | { ok: false; error: string }> {
  const u = String(url ?? "").slice(0, 2000);
  if (!isProbeableUrl(u)) return { ok: false, error: "Pick a picture with a public link first (upload it to Media)." };
  const r = await fetchCapped(u);
  return r.buf ? { buf: r.buf } : { ok: false, error: `The picture could not be loaded (${r.error ?? "error"}).` };
}

async function fluxGate(): Promise<{ ok: false; error: string } | null> {
  if (!(await isFluxConfigured())) return { ok: false, error: "FLUX is not set up (Settings > Integrations)." };
  return budgetBlock();
}

async function logFlux(session: { userId: string; email: string | null }, feature: string, model: string, sub: { ok: boolean; cost?: number | null; error?: string }) {
  await logAiUsage({ feature, entityType: "print_design", entityId: ENTITY, actorId: session.userId, actorEmail: session.email, model, ok: sub.ok, estimated: true, errorNote: sub.ok ? (sub.cost ? `credits ${sub.cost}` : null) : String(sub.error ?? "").slice(0, 200) });
  await recordAudit({ actorId: session.userId, actorEmail: session.email, action: `print.layer.${feature.split(".")[2] ?? "ai"}`, entityType: "print_design", entityId: ENTITY, after: { ok: sub.ok, model } }).catch(() => {});
}

/** Flat background → keyed out here (exact, free). null = not flat (needs AI). */
async function localCutout(url: string, userId: string): Promise<LayerOut | null> {
  const r = await loadPic(url);
  if ("ok" in r) return r;
  const k = await keyOutBuffer(r.buf, 0.85).catch(() => null);
  if (k && "already" in k) return { ok: false, error: "This picture already has a see-through background." };
  if (!k) return null;
  const saved = await saveLayer(k.png, "image/png", "Cut-out (no background)", userId, "no-bg");
  if ("ok" in saved) return saved;
  return { ok: true, kind: "done", url: saved.url, mediaId: saved.mediaId, note: "Background removed on our server (see-through PNG).", transparent: true };
}

/** Remove background for a placed picture: exact key-out for flat backgrounds, FLUX Kontext → magenta → key-out for busy ones. */
export async function printLayerRemoveBgAction(url: string): Promise<LayerOut> {
  const session = await requirePermission("content.edit");
  const local = await localCutout(url, session.userId);
  if (local) return local;
  const gate = await fluxGate();
  if (gate) return gate;
  const r = await loadPic(url);
  if ("ok" in r) return r;
  const sharp = (await import("sharp")).default;
  const b64 = (await sharp(r.buf).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).png().toBuffer()).toString("base64");
  const sub = await submitFluxTask("flux-kontext-pro", { prompt: FLUX_ISOLATE_PROMPT.replace("logo or artwork", "subject"), input_image: b64, output_format: "png", safety_tolerance: 2 });
  await logFlux(session, "print.layer.remove_bg.flux", "flux-kontext-pro", sub);
  if (!sub.ok) return sub;
  return { ok: true, kind: "flux", pollingUrl: sub.pollingUrl, prompt: "Cut-out (FLUX Kontext)", keyOut: true };
}

/** Step 2 after FLUX painted magenta behind the subject: cut it out. */
export async function printLayerKeyOutAction(url: string): Promise<LayerOut> {
  const session = await requirePermission("content.edit");
  const r = await loadPic(url);
  if ("ok" in r) return r;
  const k = await keyOutBuffer(r.buf, 0.5).catch(() => null);
  if (!k || "already" in k) return { ok: false, error: "FLUX did not give a clean flat background - try again." };
  const saved = await saveLayer(k.png, "image/png", "Cut-out (no background)", session.userId, "no-bg");
  if ("ok" in saved) return saved;
  return { ok: true, kind: "done", url: saved.url, mediaId: saved.mediaId, note: "Background removed (see-through PNG).", transparent: true };
}

/** Double the pixels for print (up to 4x when the printed size needs it). No AI cost. */
export async function printEnlargeAction(p: { url: string; targetW?: number; targetH?: number }): Promise<LayerOut> {
  const session = await requirePermission("content.edit");
  const r = await loadPic(p?.url);
  if ("ok" in r) return r;
  const tw = Number(p?.targetW) || 0;
  const th = Number(p?.targetH) || 0;
  try {
    const e = await enlargeBuffer(r.buf, tw > 0 && th > 0 ? { w: tw, h: th } : null);
    if (!e.ok) return e;
    const saved = await saveLayer(e.out, e.mime, `Enlarged ${e.factor}x for print`, session.userId, "enlarged");
    if ("ok" in saved) return saved;
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "print.layer.enlarge", entityType: "print_design", entityId: ENTITY, after: { mediaId: saved.mediaId, width: e.width, height: e.height } }).catch(() => {});
    return { ok: true, kind: "done", url: saved.url, mediaId: saved.mediaId, note: `Enlarged ${e.factor}x to ${e.width.toLocaleString()} x ${e.height.toLocaleString()} px.`, transparent: e.mime === "image/png" };
  } catch {
    return { ok: false, error: "That picture is too big to enlarge in one go, or not a picture." };
  }
}

/** FLUX Deblur: redraw soft / pixelated pictures sharper. */
export async function printSharpenAction(url: string): Promise<LayerOut> {
  const session = await requirePermission("content.edit");
  const gate = await fluxGate();
  if (gate) return gate;
  const r = await loadPic(url);
  if ("ok" in r) return r;
  const sharp = (await import("sharp")).default;
  const b64 = (await sharp(r.buf).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).png().toBuffer()).toString("base64");
  const sub = await submitFluxTask("flux-tools/deblur-v1", { image: b64, output_format: "png", safety_tolerance: 2 });
  await logFlux(session, "print.layer.sharpen.flux", "flux-tools/deblur-v1", sub);
  if (!sub.ok) return sub;
  return { ok: true, kind: "flux", pollingUrl: sub.pollingUrl, prompt: "Sharpened (FLUX Deblur)" };
}

/** Make a picture to place on the canvas (FLUX.2 pro, right shape, optional cut-out + reference pictures). */
export async function printMakeLayerAction(p: { ask: string; cutout: boolean; ratio: number; refs?: string[] }): Promise<LayerOut> {
  const session = await requirePermission("content.edit");
  const ask = String(p?.ask ?? "").trim().slice(0, 1200);
  const must = checkImageAsk(ask).filter((i) => i.level === "must-fix");
  if (must.length) return { ok: false, error: must.map((i) => i.text).join(" ") };
  const gate = await fluxGate();
  if (gate) return gate;
  const refs = (Array.isArray(p?.refs) ? p.refs : []).map(String).filter(isProbeableUrl).slice(0, 4);
  const size = fluxSizeFor(Number(p?.ratio) || 1);
  const body: Record<string, string | number> = { prompt: layerPrompt(ask, !!p?.cutout, refs.length > 0), width: size.width, height: size.height, output_format: "png", safety_tolerance: 2 };
  refs.forEach((u, i) => (body[i ? `input_image_${i + 1}` : "input_image"] = u));
  const sub = await submitFluxTask("flux-2-pro", body);
  await logFlux(session, "print.layer.make.flux", "flux-2-pro", sub);
  if (!sub.ok) return sub;
  return { ok: true, kind: "flux", pollingUrl: sub.pollingUrl, prompt: ask, keyOut: !!p?.cutout };
}

/** Recreate the whole canvas as one picture (FLUX.2 pro, the canvas render as the reference, same shape). */
export async function printRecreateAction(p: { dataUrl: string; ask?: string; keepText: boolean; ratio: number }): Promise<LayerOut> {
  const session = await requirePermission("content.edit");
  const ask = String(p?.ask ?? "").trim().slice(0, 800);
  const must = ask ? checkImageAsk(ask).filter((i) => i.level === "must-fix") : [];
  if (must.length) return { ok: false, error: must.map((i) => i.text).join(" ") };
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(p?.dataUrl ?? "").slice(0, 12_000_000));
  if (!m) return { ok: false, error: "The canvas could not be captured. Try again." };
  const gate = await fluxGate();
  if (gate) return gate;
  const size = fluxSizeFor(Number(p?.ratio) || 1);
  const sub = await submitFluxTask("flux-2-pro", { prompt: recreatePrompt(ask, !!p?.keepText), input_image: m[2], width: size.width, height: size.height, output_format: "png", safety_tolerance: 2 });
  await logFlux(session, "print.layer.recreate.flux", "flux-2-pro", sub);
  if (!sub.ok) return sub;
  return { ok: true, kind: "flux", pollingUrl: sub.pollingUrl, prompt: "Canvas recreated as one picture (FLUX.2)" };
}
