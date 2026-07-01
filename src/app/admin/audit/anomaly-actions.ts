"use server";

/**
 * Server actions for the audit-log anomaly assistant (Slice 62).
 * users.manage-gated (same permission the Audit Log page requires).
 */
import { requirePermission } from "@/lib/auth/session";
import { askAuditAssistant, type AuditAssistantResult } from "@/lib/admin/audit-anomaly";

export async function askAuditAssistantAction(question: string): Promise<AuditAssistantResult> {
  const session = await requirePermission("users.manage");
  return askAuditAssistant(question, {
    actorId: session.profile.id,
    actorEmail: session.email,
  });
}
