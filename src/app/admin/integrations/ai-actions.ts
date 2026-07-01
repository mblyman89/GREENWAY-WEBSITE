"use server";

/**
 * src/app/admin/integrations/ai-actions.ts
 *
 * E13 (Integrations helpers + AI). Server action for the "Ask about
 * integrations" helper on the Integrations page. It answers plain-language
 * setup questions grounded strictly on INTEGRATION_GUIDES so it never invents
 * a step or a key name that doesn't exist.
 *
 * Gated on settings.manage (same as the Integrations page) and audit-logged.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { answerIntegrationQuestion } from "@/lib/admin/concierge-assistant";

export type AskIntegrationResult =
  | { ok: true; answer: string; model: string }
  | { ok: false; error: string };

export async function askIntegrationAction(
  _prev: AskIntegrationResult | null,
  formData: FormData,
): Promise<AskIntegrationResult> {
  const session = await requirePermission("settings.manage");

  const question = String(formData.get("question") ?? "").trim();
  const rawId = String(formData.get("integrationId") ?? "").trim();
  const integrationId = rawId.length > 0 ? rawId : undefined;

  if (question.length < 3) {
    return { ok: false, error: "Please type a question about connecting an integration." };
  }
  if (question.length > 600) {
    return { ok: false, error: "That question is a bit long — please shorten it." };
  }

  try {
    const res = await answerIntegrationQuestion(question, {
      integrationId,
      context: { actorId: session.profile.id, actorEmail: session.email },
    });

    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: "integration.ai.ask",
      entityType: "integration",
      entityId: integrationId ?? "general",
      after: { question, model: res.model },
    });

    return { ok: true, answer: res.answer, model: res.model };
  } catch (err) {
    const message = err instanceof Error ? err.message : "The integrations helper is unavailable right now.";
    return { ok: false, error: message };
  }
}
