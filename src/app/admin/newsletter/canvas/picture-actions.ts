"use server";

/**
 * D243 E-4 (SOP-22 G-124): server actions for the AI picture tools.
 * Anyone who can write posts (blog.manage) can use them; every run is
 * audited (newsletter.picture.<tool>). FLUX results are polled with the
 * N-8b aiFluxPollAction and saved to Media there.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getCanvasPost } from "@/lib/cms/newsletter-canvas-server";
import { aspectOf } from "@/lib/cms/newsletter-ai-core";
import { EXTEND_SIDES, PICTURE_TOOLS, type ExtendSide, type PictureTool, type ToolEngine } from "@/lib/cms/newsletter-picture-core";
import { runPictureTool, type PictureOut } from "@/lib/cms/newsletter-picture-server";

const TOOL_KEYS = PICTURE_TOOLS.map((t) => t.key);
const ENGINES: ToolEngine[] = ["gpt", "gemini", "flux", "local"];

export async function aiPictureToolAction(
  postId: string,
  p: {
    tool: string;
    engine: string | null;
    sourceUrl: string | null;
    ask?: string;
    colour?: string;
    look?: string;
    motion?: string;
    frames?: number;
    count?: number;
    aspect?: string;
    maskDataUrl?: string | null;
    extend?: { side?: string; percent?: number; shape?: string | null };
  },
): Promise<PictureOut> {
  const session = await requirePermission("blog.manage");
  const post = await getCanvasPost(String(postId ?? ""));
  if (!post) return { ok: false, error: "Newsletter not found." };
  if (post.kind !== "newsletter") return { ok: false, error: "The canvas is only for newsletters." };
  const tool = (TOOL_KEYS.includes(p?.tool as PictureTool) ? p.tool : "generate") as PictureTool;
  const engine = ENGINES.includes(p?.engine as ToolEngine) ? (p.engine as ToolEngine) : null;
  const side = (EXTEND_SIDES.some((s) => s.key === p?.extend?.side) ? p.extend?.side : "all") as ExtendSide;
  const ask = String(p?.ask ?? "").trim().slice(0, 1500);
  try {
    const out = await runPictureTool({
      tool,
      engine,
      sourceUrl: p?.sourceUrl ? String(p.sourceUrl).slice(0, 2000) : null,
      opts: { ask, colour: String(p?.colour ?? "").slice(0, 7), look: String(p?.look ?? "").slice(0, 40), motion: String(p?.motion ?? "").slice(0, 40), frames: Number(p?.frames) || 3 },
      maskDataUrl: typeof p?.maskDataUrl === "string" ? p.maskDataUrl : null,
      extend: { side, percent: Number(p?.extend?.percent) || 50, shape: p?.extend?.shape ? String(p.extend.shape).slice(0, 20) : null },
      aspect: aspectOf(p?.aspect).key,
      count: Number(p?.count) || 3,
      postId,
      actorId: session.userId,
      actorEmail: session.email,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: `newsletter.picture.${tool}`,
      entityType: "blog_post",
      entityId: postId,
      after: { ok: out.ok, engine, edit: Boolean(p?.sourceUrl), ask: ask.slice(0, 200), mediaIds: out.ok && out.kind === "done" ? out.results.map((r) => r.mediaId) : [], flux: out.ok && out.kind === "flux" },
    });
    return out;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "The picture tool failed." };
  }
}
