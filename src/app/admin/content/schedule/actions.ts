"use server";

/**
 * R46-S1: server actions for scheduled publish / unpublish.
 * (Release actions, R46-S2, live in release-actions.ts.)
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { safeAdminPath } from "@/lib/media/return-state-core";
import { validateScheduleInput, formatRunAt } from "@/lib/cms/content-schedule-core";
import {
  createSchedule,
  cancelSchedule,
  labelForTarget,
} from "@/lib/cms/content-schedule-server";

const SCHEDULE_ROUTE = "/admin/content/schedule";

/** Append a flash param before any #anchor. */
function withFlash(path: string, flash: string): string {
  const [base, hash] = path.split("#", 2);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${flash}${hash ? `#${hash}` : ""}`;
}

export async function scheduleChangeAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const back = safeAdminPath(String(formData.get("return_to") ?? ""), SCHEDULE_ROUTE);
  // Either two hidden fields (editor cards) or one "kind|key" picker value
  // (the Schedule page). The core validates both parts either way.
  const combined = String(formData.get("target") ?? "");
  const [cKind, ...cRest] = combined.split("|");
  const v = validateScheduleInput(
    {
      kind: combined ? cKind : formData.get("target_kind"),
      key: combined ? cRest.join("|") : formData.get("target_key"),
      action: formData.get("action"),
      runAtLocal: formData.get("run_at_local"),
    },
    new Date().toISOString(),
  );
  if (!v.ok) redirect(withFlash(back, `error=${encodeURIComponent(v.error)}`));

  const label = await labelForTarget(v.value.kind, v.value.key);
  const res = await createSchedule(v.value, label, session.userId);
  if (res.error) redirect(withFlash(back, `error=${encodeURIComponent(res.error)}`));

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "schedule.create",
    entityType: v.value.kind,
    entityId: v.value.key,
    after: { action: v.value.action, run_at: v.value.runAt, schedule_id: res.id ?? null, label },
  });
  revalidatePath(back.split(/[?#]/)[0]);
  revalidatePath(SCHEDULE_ROUTE);
  const when = formatRunAt(v.value.runAt);
  const msg = `${v.value.action === "publish" ? "Scheduled to go live" : "Scheduled to come down"} ${when}${v.value.snapped ? " (moved to the next 5-minute mark)" : ""}.`;
  redirect(withFlash(back, `scheduled=${encodeURIComponent(msg)}`));
}

export async function cancelScheduleAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const back = safeAdminPath(String(formData.get("return_to") ?? ""), SCHEDULE_ROUTE);
  const id = String(formData.get("schedule_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect(back);
  const res = await cancelSchedule(id);
  if (res.error) redirect(withFlash(back, `error=${encodeURIComponent(res.error)}`));
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "schedule.cancel",
    entityType: res.row?.target_kind ?? "content_schedule",
    entityId: res.row?.target_key ?? id,
    after: { schedule_id: id },
  });
  revalidatePath(back.split(/[?#]/)[0]);
  revalidatePath(SCHEDULE_ROUTE);
  redirect(withFlash(back, `scheduled=${encodeURIComponent("Schedule cancelled.")}`));
}
