"use server";

/**
 * D243 E-5 (SOP-22 G-125): Ask the canvas. The AI looks at the preview and
 * proposes steps; nothing changes until the owner presses Apply in the
 * browser (decision 4). Needs blog.manage; every ask is audited
 * (newsletter.ai_ask) and every Apply is audited (newsletter.ai_ask_apply).
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getCanvasPost } from "@/lib/cms/newsletter-canvas-server";
import { askCanvas, type AskOut } from "@/lib/cms/newsletter-ask-server";
import { ASK_MAX } from "@/lib/cms/newsletter-ask-core";

export async function askCanvasAction(postId: string, p: { ask: string; doc: unknown; shot: string }): Promise<AskOut> {
  const session = await requirePermission("blog.manage");
  const post = await getCanvasPost(String(postId ?? ""));
  if (!post) return { ok: false, error: "Newsletter not found." };
  if (post.kind !== "newsletter") return { ok: false, error: "The canvas is only for newsletters." };
  const ask = String(p?.ask ?? "").trim().slice(0, ASK_MAX);
  try {
    const out = await askCanvas({ postId, ask, doc: p?.doc, shot: p?.shot, actorId: session.userId, actorEmail: session.email });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "newsletter.ai_ask",
      entityType: "blog_post",
      entityId: postId,
      after: { ok: out.ok, ask: ask.slice(0, 300), steps: out.ok ? out.ops.length : 0, dropped: out.ok ? out.dropped.length : 0, model: out.ok ? out.model : null },
    });
    return out;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Ask the canvas failed." };
  }
}

/** Audit trail for an Apply (the change itself is saved by the normal canvas save). */
export async function askCanvasAppliedAction(postId: string, p: { ask: string; applied: number; pictures: number; skipped: number }): Promise<{ ok: true }> {
  const session = await requirePermission("blog.manage");
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "newsletter.ai_ask_apply",
    entityType: "blog_post",
    entityId: String(postId ?? ""),
    after: { ask: String(p?.ask ?? "").slice(0, 300), applied: Number(p?.applied) || 0, pictures: Number(p?.pictures) || 0, skipped: Number(p?.skipped) || 0 },
  });
  return { ok: true };
}
