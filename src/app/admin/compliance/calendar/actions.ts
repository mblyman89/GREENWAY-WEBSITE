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
import {
  runComplianceReminders,
  type ReminderRunResult,
} from "@/lib/notifications/compliance-reminders";

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

/**
 * books-90: send today's reminders NOW, rather than waiting for the 8am cron.
 *
 * WHY THIS BUTTON EXISTS AT ALL. The cron route has said, in its own docblock
 * since Task W, that "a signed-in staff member may also trigger it manually
 * (e.g. a 'run reminders now' button)", and authorize() genuinely accepts a
 * staff session to make that possible. The button was never built. So the
 * capability was real, reachable in principle, and unreachable in practice -
 * standing rule 50's exact shape, and standing rule 133 now forbids shipping
 * the large-entry email while its only trigger is a scheduler Michael cannot
 * see or press.
 *
 * It is safe to press repeatedly: every reminder is deduped against
 * compliance_reminder_log by a per-day key, so a second press sends nothing a
 * first press already sent, and reports how many it skipped for that reason.
 */
export async function sendRemindersNowAction(): Promise<ReminderRunResult> {
  // Same gate as the page this button lives on, so nobody can reach the send
  // from a screen they are not allowed to open.
  const session = await requirePermission("compliance.calendar");

  const result = await runComplianceReminders();

  // Audited whether or not anything went out: "nothing was due" and "nobody
  // ever pressed it" must stay distinguishable when someone asks later why a
  // deadline passed unannounced.
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "compliance_reminders.sent_manually",
    entityType: "compliance_reminder",
    entityId: null,
    after: {
      ran: result.ran,
      planned: result.planned,
      sent: result.sent,
      deduped: result.deduped,
      unsent: result.unsent,
    },
  });

  revalidatePath(BASE);
  return result;
}
