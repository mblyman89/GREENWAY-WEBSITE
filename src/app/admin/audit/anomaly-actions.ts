"use server";

/**
 * Server actions for the Security Log anomaly assistant (Slice 62).
 *
 * books-22: re-gated from "users.manage" to "audit.view" (OWNER ONLY), the
 * same permission the Security Log page requires. These actions read the log
 * and hand it to an assistant, so they expose exactly what the page exposes.
 * A gate on the page with a looser gate on its own server actions is not a
 * gate -- the actions are callable directly.
 */
import { requirePermission } from "@/lib/auth/session";
import { askAuditAssistant, type AuditAssistantResult } from "@/lib/admin/audit-anomaly";

export async function askAuditAssistantAction(question: string): Promise<AuditAssistantResult> {
  const session = await requirePermission("audit.view");
  return askAuditAssistant(question, {
    actorId: session.profile.id,
    actorEmail: session.email,
  });
}
