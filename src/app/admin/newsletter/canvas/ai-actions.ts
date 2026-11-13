"use server";

/**
 * D238 N-8b (SOP-22 G-118): server actions for the canvas AI studio.
 * Anyone who can write posts (blog.manage) can use it. Every call is checked
 * against the monthly AI budget, logged to the AI usage ledger and audited.
 * Words from the AI are only returned when they pass the copy check and the
 * compliance check; pictures are saved to Media as new files.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { normalizeCanvas, type CanvasBlock } from "@/lib/cms/newsletter-canvas-core";
import { getCanvasPost } from "@/lib/cms/newsletter-canvas-server";
import { AI_ASK_MAX, aspectOf, type ImageEngine } from "@/lib/cms/newsletter-ai-core";
import {
  aiBuildCanvas,
  aiImage,
  aiImproveBlock,
  aiSubjectIdeas,
  pollFluxForCanvas,
  type BuildOut,
  type FluxPollOut,
  type IdeasOut,
  type ImageOut,
  type ImproveOut,
} from "@/lib/cms/newsletter-ai-server";

type Fail = { ok: false; error: string };

async function newsletterOrFail(postId: string): Promise<Fail | null> {
  const post = await getCanvasPost(String(postId ?? ""));
  if (!post) return { ok: false, error: "Newsletter not found." };
  if (post.kind !== "newsletter") return { ok: false, error: "The canvas is only for newsletters." };
  return null;
}

function failMsg(e: unknown): Fail {
  return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "The AI call failed." };
}

const ask = (v: unknown) => String(v ?? "").trim().slice(0, AI_ASK_MAX);

/** Build with AI: headline, intro, up to three notes, the button, subject and preview text. */
export async function aiBuildCanvasAction(postId: string, raw: unknown, request: string): Promise<BuildOut> {
  const session = await requirePermission("blog.manage");
  const bad = await newsletterOrFail(postId);
  if (bad) return bad;
  try {
    const out = await aiBuildCanvas(normalizeCanvas(raw), postId, ask(request), { actorId: session.userId, actorEmail: session.email });
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "newsletter.canvas.ai_build", entityType: "blog_post", entityId: postId, after: { ok: out.ok, ask: ask(request).slice(0, 200), error: out.ok ? null : out.error.slice(0, 200) } });
    return out;
  } catch (e) {
    return failMsg(e);
  }
}

/** Improve the selected section (review quotes are locked). */
export async function aiImproveBlockAction(postId: string, rawBlock: unknown, request: string): Promise<ImproveOut> {
  const session = await requirePermission("blog.manage");
  const bad = await newsletterOrFail(postId);
  if (bad) return bad;
  const block: CanvasBlock | undefined = normalizeCanvas({ blocks: [rawBlock] }).blocks[0];
  if (!block) return { ok: false, error: "Pick a section first." };
  try {
    const out = await aiImproveBlock(block, postId, ask(request), { actorId: session.userId, actorEmail: session.email });
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "newsletter.canvas.ai_improve", entityType: "blog_post", entityId: postId, after: { ok: out.ok, block: block.type, ask: ask(request).slice(0, 200), changed: out.ok ? out.changed : [] } });
    return out;
  } catch (e) {
    return failMsg(e);
  }
}

/** Five subject line + preview text ideas from this week's facts. */
export async function aiSubjectIdeasAction(postId: string, raw: unknown): Promise<IdeasOut> {
  const session = await requirePermission("blog.manage");
  const bad = await newsletterOrFail(postId);
  if (bad) return bad;
  try {
    const out = await aiSubjectIdeas(normalizeCanvas(raw), postId, { actorId: session.userId, actorEmail: session.email });
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "newsletter.canvas.ai_subjects", entityType: "blog_post", entityId: postId, after: { ok: out.ok, count: out.ok ? out.ideas.length : 0 } });
    return out;
  } catch (e) {
    return failMsg(e);
  }
}

const ENGINES: ImageEngine[] = ["gpt", "gemini", "flux"];

/** Edit the selected picture (or make a new one) with GPT Image, Gemini or FLUX. */
export async function aiImageAction(
  postId: string,
  p: { engine: string; ask: string; sourceUrl: string | null; aspect: string; removeBackground: boolean },
): Promise<ImageOut> {
  const session = await requirePermission("blog.manage");
  const bad = await newsletterOrFail(postId);
  if (bad) return bad;
  const engine = ENGINES.includes(p.engine as ImageEngine) ? (p.engine as ImageEngine) : "gpt";
  const request = String(p.ask ?? "").trim().slice(0, 1500);
  if (!request && !p.removeBackground) return { ok: false, error: "Say what the AI should do with the picture." };
  try {
    const out = await aiImage({
      engine,
      ask: request || "Remove the background completely. Keep the subject exactly as it is, with clean edges.",
      sourceUrl: p.sourceUrl ? String(p.sourceUrl).slice(0, 2000) : null,
      aspect: aspectOf(p.aspect).key,
      removeBackground: Boolean(p.removeBackground),
      postId,
      actorId: session.userId,
      actorEmail: session.email,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "newsletter.canvas.ai_image",
      entityType: "blog_post",
      entityId: postId,
      after: { ok: out.ok, engine, edit: Boolean(p.sourceUrl), removeBackground: Boolean(p.removeBackground), ask: request.slice(0, 200), mediaId: out.ok && out.kind === "done" ? out.mediaId : null },
    });
    return out;
  } catch (e) {
    return failMsg(e);
  }
}

/** One FLUX poll (the browser repeats every few seconds). */
export async function aiFluxPollAction(postId: string, pollingUrl: string, prompt: string): Promise<FluxPollOut> {
  const session = await requirePermission("blog.manage");
  const bad = await newsletterOrFail(postId);
  if (bad) return { state: "failed", error: bad.error };
  try {
    const out = await pollFluxForCanvas(String(pollingUrl), String(prompt ?? "").slice(0, 1500), session.userId);
    if (out.state === "ready") {
      await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "newsletter.canvas.ai_image_flux_ready", entityType: "media_asset", entityId: out.mediaId, after: { postId } });
    }
    return out;
  } catch (e) {
    return { state: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "FLUX check failed." };
  }
}
