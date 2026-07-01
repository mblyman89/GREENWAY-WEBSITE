"use server";

/**
 * src/app/admin/concierge-actions.ts
 *
 * E5 (Global AI chatbot). Server action powering the global concierge widget.
 * Read-only / advisory. Gated on dashboard.view (anyone on staff can ask).
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  answerConciergeQuestion,
  isAiConfigured,
  type ConciergeTurn,
} from "@/lib/admin/concierge-assistant";

export type ConciergeAskResult =
  | { ok: true; answer: string; model: string }
  | { ok: false; error: string };

export async function askConciergeAction(input: {
  question: string;
  history?: ConciergeTurn[];
}): Promise<ConciergeAskResult> {
  const session = await requirePermission("dashboard.view");

  const q = (input.question ?? "").trim();
  if (!q) return { ok: false, error: "Type a question first." };
  if (q.length > 800) return { ok: false, error: "That question is a bit long — try shortening it." };

  if (!isAiConfigured) {
    return {
      ok: false,
      error:
        "AI isn't set up yet. Add an AI_API_KEY (or OPENAI_API_KEY) in your environment to enable the assistant.",
    };
  }

  try {
    const res = await answerConciergeQuestion(q, {
      history: input.history,
      context: { actorId: session.userId, actorEmail: session.email },
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "concierge.ask",
      entityType: "concierge",
      after: { model: res.model },
    }).catch(() => {});
    return { ok: true, answer: res.answer, model: res.model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI request failed. Please try again." };
  }
}
