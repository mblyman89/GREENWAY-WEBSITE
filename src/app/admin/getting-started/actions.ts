"use server";

import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  answerSetupQuestion,
  isAiConfigured,
} from "@/lib/admin/ai-setup-assistant";

export type SetupAskResult =
  | { ok: true; answer: string; model: string }
  | { ok: false; error: string };

/**
 * Answer a plain-language setup question via the AI concierge. Read-only /
 * advisory — never changes settings. Gated on dashboard.view (anyone on staff
 * can ask for help getting set up).
 */
export async function askSetupAction(question: string): Promise<SetupAskResult> {
  const session = await requirePermission("dashboard.view");

  const q = question.trim();
  if (!q) return { ok: false, error: "Type a question first." };
  if (q.length > 500) {
    return { ok: false, error: "That question is a bit long — try shortening it." };
  }

  if (!isAiConfigured) {
    return {
      ok: false,
      error:
        "AI isn't set up yet. Add an AI_API_KEY in your environment to enable the setup concierge. The written steps above still work without it.",
    };
  }

  try {
    const res = await answerSetupQuestion(q, {
      actorId: session.userId,
      actorEmail: session.email,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "setup.ai_ask",
      entityType: "setup",
      after: { model: res.model },
    });
    return { ok: true, answer: res.answer, model: res.model };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "AI request failed. Please try again.";
    return { ok: false, error: message };
  }
}
