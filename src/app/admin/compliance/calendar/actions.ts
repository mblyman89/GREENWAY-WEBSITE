"use server";

/**
 * Server actions for the S-18 compliance calendar. Marking a period done (or
 * undoing it) is permission-gated and audited — the calendar is the owner's
 * WAC 314-55-509 "we track our obligations" evidence, so who/when matters.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { setPeriodDone } from "@/lib/compliance/compliance-calendar-store";

const BASE = "/admin/compliance/calendar";

export async function setPeriodDoneAction(formData: FormData): Promise<void> {
  // books-23: signing off a statutory obligation is the owner's own act. Gated
  // to match the page rather than the old settings.manage, so an admin cannot
  // mark the LIQ-1295 filed on a page they can no longer open.
  const session = await requirePermission("compliance.calendar");
  const taskId = String(formData.get("task_id") ?? "");
  const periodKey = String(formData.get("period_key") ?? "");
  const done = String(formData.get("done") ?? "") === "1";

  if (!taskId || !periodKey) redirect(BASE);

  const res = await setPeriodDone({
    taskId,
    periodKey,
    done,
    byEmail: session.email,
  });

  if (!res.ok) {
    redirect(`${BASE}?error=${encodeURIComponent(res.error ?? "Could not save.")}`);
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: done ? "compliance_calendar.done" : "compliance_calendar.undone",
    entityType: "compliance_calendar",
    entityId: `${taskId}:${periodKey}`,
    after: { taskId, periodKey, done },
  });

  revalidatePath(BASE);
  revalidatePath("/admin");
  redirect(`${BASE}?saved=1`);
}
