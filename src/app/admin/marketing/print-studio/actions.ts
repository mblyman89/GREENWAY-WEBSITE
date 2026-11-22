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
}): Promise<PictureOut> {
  const session = await requirePermission("content.edit");
  const tool = (TOOL_KEYS.includes(p?.tool as PictureTool) ? p.tool : "generate") as PictureTool;
  const engine = ENGINES.includes(p?.engine as ToolEngine) ? (p.engine as ToolEngine) : null;
  const ask = String(p?.ask ?? "").trim().slice(0, 1500);
  const side = (["all", "left", "right", "top", "bottom"].includes(String(p?.side)) ? p.side : "all") as "all";
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
