"use server";

/**
 * D248 slice 1 - Payroll command center: pay schedule actions.
 *
 * Owner + admin (settings.manage, the same gate as /admin/payroll - the owner's
 * rule is "the only thing an admin can do is pay vendors and pay employees").
 * Every save is audited. Nothing here books a journal, files a form or moves
 * money: it saves the schedule, sets the workweek and adds PLANNED pay periods.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { validateScheduleInput, isIsoDay } from "@/lib/payroll/pay-schedule-core";
import { generateYear, loadPaySchedule, savePaySchedule, saveWorkweek } from "@/lib/payroll/pay-schedule-store";

const SCHEDULE = "/admin/payroll-center/schedule";

const back = (kind: "msg" | "error", text: string, extra = ""): never =>
  redirect(`${SCHEDULE}?${kind}=${encodeURIComponent(text)}${extra}`);

export async function savePayScheduleAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const v = validateScheduleInput({
    frequency: String(formData.get("frequency") ?? ""),
    anchorPayDate: String(formData.get("anchor_pay_date") ?? ""),
    lagDays: String(formData.get("lag_days") ?? ""),
    holidayRule: String(formData.get("holiday_rule") ?? ""),
  });
  if (!v.ok) back("error", v.errors.join(" "));
  if (!v.ok) return;
  let before: unknown = null;
  let failure: string | null = null;
  try {
    before = await loadPaySchedule();
    await savePaySchedule(v.schedule, session.profile.id);
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }
  if (failure) back("error", failure);
  await recordAudit({
    actorId: session.profile.id,
    action: "payroll.schedule.save",
    entityType: "site_settings",
    entityId: "payroll_pay_schedule",
    before,
    after: v.schedule,
  }).catch(() => {});
  revalidatePath("/admin/payroll-center", "layout");
  back("msg", "Pay schedule saved. Check the preview below, then add the periods to the calendar.");
}

export async function saveWorkweekAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const raw = String(formData.get("workweek_starts_on") ?? "");
  const startsOn = /^[0-6]$/.test(raw) ? Number(raw) : NaN;
  const eff = String(formData.get("workweek_effective_date") ?? "").trim();
  if (!Number.isInteger(startsOn)) back("error", "Pick the day your workweek starts.");
  if (!isIsoDay(eff)) back("error", "Enter the date this workweek takes effect.");
  let failure: string | null = null;
  try {
    await saveWorkweek(startsOn, eff);
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }
  if (failure) back("error", failure);
  await recordAudit({
    actorId: session.profile.id,
    action: "payroll.workweek.save",
    entityType: "company_profile",
    entityId: "workweek_starts_on",
    after: { workweek_starts_on: startsOn, workweek_effective_date: eff },
  }).catch(() => {});
  revalidatePath("/admin/payroll-center", "layout");
  back("msg", "Workweek saved. Overtime is now counted per workweek from this day.");
}

export async function generatePeriodsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const year = Number(String(formData.get("year") ?? ""));
  if (!Number.isInteger(year) || year < 2024 || year > 2035) back("error", "Pick a year between 2024 and 2035.");
  let outcome: Awaited<ReturnType<typeof generateYear>> | null = null;
  try {
    const schedule = await loadPaySchedule();
    if (!schedule) back("error", "Save the pay schedule first.");
    if (schedule) outcome = await generateYear(schedule, year);
  } catch (e) {
    back("error", e instanceof Error ? e.message : String(e), `&year=${year}`);
  }
  if (!outcome) return;
  await recordAudit({
    actorId: session.profile.id,
    action: "payroll.periods.generate",
    entityType: "pay_periods",
    entityId: String(year),
    after: outcome,
  }).catch(() => {});
  revalidatePath("/admin/payroll-center", "layout");
  revalidatePath("/admin/books/timesheets");
  revalidatePath("/admin/books/pay-run");
  const parts = [
    `${outcome.inserted} pay period${outcome.inserted === 1 ? "" : "s"} added for ${year}`,
    outcome.alreadyOnFile ? `${outcome.alreadyOnFile} already on file` : "",
    outcome.conflicts ? `${outcome.conflicts} skipped because they clash with periods already on file (listed below)` : "",
  ].filter(Boolean);
  back("msg", `${parts.join(", ")}.`, `&year=${year}`);
}
