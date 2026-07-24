"use server";

/**
 * src/app/admin/handbook-ack-actions.ts  (SLICE 36)
 *
 * Server action behind the handbook acknowledgment screen: the signed-in
 * staff user reads the handbook, types their full name, checks the box, and
 * this records their acknowledgment of the CURRENT handbook version
 * (handbook_acknowledgments, migration 0136). You can only acknowledge for
 * YOURSELF — the staff id comes from the session, never from the form.
 */
import { requireStaff } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { HANDBOOK_VERSION } from "@/lib/staffing/handbook-content";
import { normalizeAcknowledgedName } from "@/lib/staffing/handbook-ack-core";
import { recordHandbookAcknowledgment } from "@/lib/staffing/handbook-ack-store";

export type HandbookAckResult = { ok: true } | { ok: false; error: string };

export async function acknowledgeHandbookAction(
  _prev: HandbookAckResult | null,
  form: FormData,
): Promise<HandbookAckResult> {
  const session = await requireStaff();

  // The box itself — unchecked means the browser sends nothing.
  if (String(form.get("agree") ?? "") !== "on") {
    return { ok: false, error: "Check the box to confirm you read the handbook and will abide by it." };
  }

  const name = normalizeAcknowledgedName(String(form.get("acknowledged_name") ?? ""));
  if (!name.ok) return { ok: false, error: name.reason };

  const result = await recordHandbookAcknowledgment({
    staffId: session.userId,
    acknowledgedName: name.name,
  });
  if (!result.ok) return { ok: false, error: result.error };

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "handbook.acknowledged",
    entityType: "handbook",
    entityId: HANDBOOK_VERSION,
    after: { version: HANDBOOK_VERSION, acknowledgedName: name.name },
  });

  return { ok: true };
}
