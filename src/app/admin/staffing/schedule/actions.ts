"use server";

/**
 * Schedule-builder server actions (Slice 69 — item 4). Managers create, edit,
 * remove, and copy SCHEDULED shifts on the weekly grid. All input is validated
 * by the pure schedule-core before touching the database, and every write is
 * audited.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  createScheduledShift,
  updateScheduledShift,
  deleteScheduledShift,
  copyWeekSchedule,
} from "@/lib/staffing/store";
import { parseShiftDraft, mondayOf } from "@/lib/staffing/schedule-core";

export type ScheduleActionResult = { ok: boolean; error?: string; errors?: string[] };

const BASE = "/admin/staffing/schedule";

export async function createShiftAction(fd: FormData): Promise<ScheduleActionResult> {
  const session = await requirePermission("staffing.manage");
  const parsed = parseShiftDraft({
    employeeId: fd.get("employeeId"),
    businessDay: fd.get("businessDay"),
    shiftRole: fd.get("shiftRole"),
    start: fd.get("start"),
    end: fd.get("end"),
    notes: fd.get("notes"),
  });
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const res = await createScheduledShift(parsed.value);
  if (!res.ok) return { ok: false, error: res.error };
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "shift.schedule.create",
    entityType: "shifts",
    entityId: res.id,
    after: parsed.value,
  });
  revalidatePath(BASE);
  return { ok: true };
}

export async function updateShiftAction(fd: FormData): Promise<ScheduleActionResult> {
  const session = await requirePermission("staffing.manage");
  const id = String(fd.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Missing shift id." };
  const parsed = parseShiftDraft({
    employeeId: "placeholder", // employee not editable on update; satisfies the parser
    businessDay: fd.get("businessDay"),
    shiftRole: fd.get("shiftRole"),
    start: fd.get("start"),
    end: fd.get("end"),
    notes: fd.get("notes"),
  });
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const res = await updateScheduledShift({
    id,
    businessDay: parsed.value.businessDay,
    shiftRole: parsed.value.shiftRole,
    start: parsed.value.start,
    end: parsed.value.end,
    notes: parsed.value.notes,
  });
  if (!res.ok) return { ok: false, error: res.error };
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "shift.schedule.update",
    entityType: "shifts",
    entityId: id,
    after: parsed.value,
  });
  revalidatePath(BASE);
  return { ok: true };
}

export async function deleteShiftAction(fd: FormData): Promise<ScheduleActionResult> {
  const session = await requirePermission("staffing.manage");
  const id = String(fd.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Missing shift id." };
  const res = await deleteScheduledShift(id);
  if (!res.ok) return { ok: false, error: res.error };
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "shift.schedule.delete",
    entityType: "shifts",
    entityId: id,
  });
  revalidatePath(BASE);
  return { ok: true };
}

export async function copyWeekAction(fd: FormData): Promise<ScheduleActionResult> {
  const session = await requirePermission("staffing.manage");
  const fromMonday = mondayOf(String(fd.get("fromMonday") ?? "").trim());
  const toMonday = mondayOf(String(fd.get("toMonday") ?? "").trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromMonday) || !/^\d{4}-\d{2}-\d{2}$/.test(toMonday)) {
    return { ok: false, error: "Pick a valid source and target week." };
  }
  if (fromMonday === toMonday) return { ok: false, error: "Source and target weeks are the same." };
  const res = await copyWeekSchedule(fromMonday, toMonday);
  if (!res.ok) return { ok: false, error: res.error };
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "shift.schedule.copy_week",
    entityType: "shifts",
    entityId: toMonday,
    after: { fromMonday, toMonday, copied: res.copied },
  });
  revalidatePath(BASE);
  return { ok: true, ...(res.copied === 0 ? { error: "The source week had no scheduled shifts." } : {}) };
}
