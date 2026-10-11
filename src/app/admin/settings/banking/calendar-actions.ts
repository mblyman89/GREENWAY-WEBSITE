"use server";

/**
 * R40 - ACH calendar actions: mark the current period of a task done, or undo.
 * Owner/admin only (settings.manage). Validation is the pure core's
 * checkMarkDone; the store refuses to write if it could not read first.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { pacificToday } from "@/lib/reports/timezone";
import { setAchTaskDone } from "@/lib/payments/ach-guide-store";

const CAL = "/admin/settings/banking/calendar";

function back(qs: { msg?: string; error?: string }, anchor = ""): never {
  const p = new URLSearchParams();
  if (qs.msg) p.set("msg", qs.msg.slice(0, 600));
  if (qs.error) p.set("error", qs.error.slice(0, 600));
  revalidatePath(CAL);
  revalidatePath("/admin/settings/banking/guide");
  redirect(`${CAL}?${p.toString()}${anchor}`);
}

export async function achTaskDoneAction(fd: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const taskId = String(fd.get("task_id") ?? "");
  const periodKey = String(fd.get("period_key") ?? "");
  const done = String(fd.get("done") ?? "1") === "1";
  const note = String(fd.get("note") ?? "");
  const r = await setAchTaskDone({ taskId, periodKey, todayIso: pacificToday(), done, note, byEmail: session.email });
  if (!r.ok) back({ error: r.error }, `#task-${taskId}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: done ? "ach.calendar.done" : "ach.calendar.undone",
    entityType: "site_settings",
    entityId: "ach_calendar_done",
    after: { task: taskId, period: periodKey },
  }).catch(() => {});
  back({ msg: done ? "Marked done. Thank you." : "Marked not done." }, `#task-${taskId}`);
}
