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
import { approvePayPeriod, computeTimesheetForPeriod } from "@/lib/payroll/timesheet-store";
import { PREVIEW_COLUMNS, type PreviewColumnKey } from "@/lib/payroll/pay-preview-core";
import { parseAmount, parseSageCsv } from "@/lib/payroll/sage-compare-core";
import { loadSageEntries, saveSageEntries } from "@/lib/payroll/sage-compare-store";
import { loadPayRun } from "@/lib/payroll/pay-run-store";

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

/* ── D248 slice 2: time cards ─────────────────────────────────────────────── */

const TIME_CARDS = "/admin/payroll-center/time-cards";

/**
 * Approve a period's hours from the time-card screen. Same write as the owner's
 * timesheet screen (approvePayPeriod - never a locked period), same rule: the
 * pay engine is re-run at the moment of the write and any employee it refuses
 * blocks the approval. Approval marks the hours as checked; it books nothing.
 */
export async function approveTimeCardsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const periodId = String(formData.get("period_id") ?? "");
  const to = (kind: "msg" | "error", text: string): never =>
    redirect(`${TIME_CARDS}?period=${encodeURIComponent(periodId)}&${kind}=${encodeURIComponent(text)}`);
  if (!periodId) redirect(`${TIME_CARDS}?error=${encodeURIComponent("Choose a pay period first.")}`);

  let failure: string | null = null;
  let label = "";
  try {
    const computed = await computeTimesheetForPeriod(periodId);
    if (!computed.ok) {
      failure = `The hours could not be re-checked, so nothing was approved. ${computed.message}`;
    } else if (computed.refusedCount > 0) {
      const who = computed.sheets.filter((s) => s.refusals.length > 0).map((s) => s.employee.fullName).join(", ");
      failure = `Not approved: ${who} still ha${computed.refusedCount === 1 ? "s" : "ve"} time-clock problems. Fix the punches flagged in red, then approve.`;
    } else {
      const res = await approvePayPeriod(periodId, session.profile.id);
      if (!res.ok) failure = res.message;
      else label = res.period.label;
    }
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }
  if (failure) to("error", failure);
  await recordAudit({
    actorId: session.profile.id,
    action: "payroll.hours.approve",
    entityType: "pay_period",
    entityId: periodId,
    after: { status: "approved", via: "payroll-center/time-cards" },
  }).catch(() => {});
  revalidatePath(TIME_CARDS);
  to("msg", `Hours approved for ${label}. Nothing was booked or paid - this marks the hours as checked.`);
}

/* ── D248 slice 4: Sage comparison ─────────────────────────────────────────── */

const COMPARE = "/admin/payroll-center/compare";
const toCompare = (periodId: string, kind: "msg" | "error", text: string, extra = ""): never =>
  redirect(`${COMPARE}?period=${encodeURIComponent(periodId)}${extra}&${kind}=${encodeURIComponent(text)}`);

type Entries = Record<string, Partial<Record<PreviewColumnKey, number>>>;

/** The employees on this period's pay run - the only ids a Sage amount may be saved against. */
async function runEmployees(periodId: string): Promise<{ id: string; name: string }[] | string> {
  const run = await loadPayRun(periodId);
  if (!run.ok) return run.message;
  return run.result.lines.map((l) => ({ id: l.employeeId, name: l.employeeName }));
}

/**
 * Save the Sage amounts typed into the grid for ONE employee (field names
 * `sage_<columnKey>`). Blank clears that line. Other employees are untouched.
 */
export async function saveSageEmployeeAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const periodId = String(formData.get("period_id") ?? "");
  const employeeId = String(formData.get("employee_id") ?? "");
  const extra = `&emp=${encodeURIComponent(employeeId)}`;
  if (!periodId || !employeeId) redirect(`${COMPARE}?error=${encodeURIComponent("Choose a pay period and an employee first.")}`);

  let failure: string | null = null;
  let name = "";
  let before: unknown = null;
  let after: unknown = null;
  try {
    const emps = await runEmployees(periodId);
    if (typeof emps === "string") failure = emps;
    else {
      const emp = emps.find((e) => e.id === employeeId);
      if (!emp) failure = "That employee is not on this pay run, so nothing was saved.";
      else {
        name = emp.name;
        const row: Partial<Record<PreviewColumnKey, number>> = {};
        const bad: string[] = [];
        for (const c of PREVIEW_COLUMNS) {
          const p = parseAmount(String(formData.get(`sage_${c.key}`) ?? ""));
          if (!p.ok) bad.push(`${c.label}: ${p.error}`);
          else if (p.value !== null) row[c.key] = p.value;
        }
        if (bad.length > 0) failure = `Nothing was saved. ${bad.join(" ")}`;
        else {
          const cur = await loadSageEntries(periodId);
          if (!cur.ok) failure = cur.message;
          else {
            const next: Entries = { ...cur.doc.entries };
            before = next[employeeId] ?? null;
            if (Object.keys(row).length === 0) delete next[employeeId];
            else next[employeeId] = row;
            after = next[employeeId] ?? null;
            await saveSageEntries(periodId, next, session.profile.id);
          }
        }
      }
    }
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }
  if (failure) toCompare(periodId, "error", failure, extra);
  await recordAudit({
    actorId: session.profile.id,
    action: "payroll.sage_compare.save",
    entityType: "pay_period",
    entityId: periodId,
    before: { employeeId, amounts: before },
    after: { employeeId, amounts: after },
  }).catch(() => {});
  revalidatePath(COMPARE);
  toCompare(periodId, "msg", `Sage amounts saved for ${name}. Comparison only - nothing was booked or paid.`, extra);
}

/**
 * Paste a CSV of Sage's numbers (the downloaded preview CSV with Sage's
 * figures typed in works as-is). Matched by exact employee name. Each pasted
 * employee's lines replace what was saved for them; others are untouched.
 * Any problem (unknown name, bad amount) stops the save - nothing partial.
 */
export async function pasteSageCsvAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const periodId = String(formData.get("period_id") ?? "");
  const text = String(formData.get("csv") ?? "");
  if (!periodId) redirect(`${COMPARE}?error=${encodeURIComponent("Choose a pay period first.")}`);

  let failure: string | null = null;
  let count = 0;
  try {
    if (text.trim() === "") failure = "Paste the CSV first.";
    else if (text.length > 200_000) failure = "That paste is too large for one pay period.";
    else {
      const emps = await runEmployees(periodId);
      if (typeof emps === "string") failure = emps;
      else {
        const parsed = parseSageCsv(text, emps);
        if (parsed.problems.length > 0) failure = `Nothing was saved. ${parsed.problems.slice(0, 8).join(" ")}`;
        else if (Object.keys(parsed.entries).length === 0) failure = "No Sage amounts were found in the paste.";
        else {
          const cur = await loadSageEntries(periodId);
          if (!cur.ok) failure = cur.message;
          else {
            const next: Entries = { ...cur.doc.entries, ...parsed.entries };
            count = Object.keys(parsed.entries).length;
            await saveSageEntries(periodId, next, session.profile.id);
          }
        }
      }
    }
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }
  if (failure) toCompare(periodId, "error", failure);
  await recordAudit({
    actorId: session.profile.id,
    action: "payroll.sage_compare.paste",
    entityType: "pay_period",
    entityId: periodId,
    after: { employees: count, via: "csv" },
  }).catch(() => {});
  revalidatePath(COMPARE);
  toCompare(periodId, "msg", `Sage amounts saved for ${count} employee${count === 1 ? "" : "s"}. Comparison only - nothing was booked or paid.`);
}
