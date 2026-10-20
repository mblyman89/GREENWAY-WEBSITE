/**
 * src/lib/compliance/compliance-calendar-core.ts
 *
 * PURE compliance-calendar logic (GAP LOW / Roadmap S-18). No DB, no
 * `server-only` — computes, for each recurring licensing obligation, the
 * CURRENT pending period, its due date, and its status (done / due / overdue)
 * from a plain Pacific calendar date + a "done" map.
 *
 * Recurring obligations tracked (per the roadmap):
 *  - LIQ-1295 monthly tax report — due by the 20th for the PRIOR month.
 *  - Weekly CCRS submission — Sun–Sat reporting week; submit within the week
 *    after it ends.
 *  - CCTV 45-day retention spot-check — monthly (WAC 314-55-105 requires 45
 *    days of retained footage; a monthly check catches a dead recorder well
 *    inside the window).
 *  - Scale calibration / WSDA weighing-device registration — annual.
 *  - Employee badge & visitor-log check — monthly.
 *  - R-3: DOR Combined Excise Tax Return — monthly, due the 25th of the
 *    following month, rolled to the next business day over a weekend or WA
 *    legal holiday (RCW 82.32.045(1); DOR 2026 due-date table).
 *
 * All date math is plain calendar arithmetic (no timezone parsing); callers
 * feed the STORE's Pacific wall-clock date via lib/reports/timezone.
 */

import {
  EMPTY_CONTEXT,
  monthBeforeStartAndPastDue,
  waiverKey,
  weekBeforeStart,
  type ObligationContext,
  type Waiver,
} from "./obligation-waiver-core";
// R-3: ONE WA legal-holiday table for the whole system (pure; imports a type only).
import { isWaLegalHoliday } from "@/lib/payroll/wa-quarterly-core";

// ---------------------------------------------------------------------------
// Plain calendar dates
// ---------------------------------------------------------------------------
export type PlainDate = { y: number; m: number; d: number }; // m = 1..12

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 = Sunday … 6 = Saturday, for a plain calendar date. */
export function weekdayOf(date: PlainDate): number {
  return new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
}

export function addDays(date: PlainDate, days: number): PlainDate {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Compare calendar dates: negative when a < b, 0 equal, positive when a > b. */
export function compareDates(a: PlainDate, b: PlainDate): number {
  return (a.y * 10000 + a.m * 100 + a.d) - (b.y * 10000 + b.m * 100 + b.d);
}

export function formatPlainDate(date: PlainDate): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.y}-${pad(date.m)}-${pad(date.d)}`;
}

// ---------------------------------------------------------------------------
// Task definitions
// ---------------------------------------------------------------------------
export type CalendarTaskId =
  | "liq1295"
  | "ccrs_weekly"
  | "cctv_retention"
  | "scale_calibration"
  | "badge_visitor_log"
  | "dor_excise";

export type CalendarTaskDef = {
  id: CalendarTaskId;
  label: string;
  description: string;
  authority: string;
  cadence: "monthly" | "weekly" | "annual";
};

export const CALENDAR_TASKS: readonly CalendarTaskDef[] = [
  {
    id: "liq1295",
    label: "LIQ-1295 monthly tax report",
    description:
      "File the LCB monthly tax report and remit the 37% excise for LAST month. Due by the 20th.",
    authority: "RCW 69.50.535 / LCB reporting",
    cadence: "monthly",
  },
  {
    id: "ccrs_weekly",
    label: "Weekly CCRS submission",
    description:
      "Upload the CCRS CSVs covering the most recent Sunday–Saturday reporting week.",
    authority: "WAC 314-55-083(4) traceability reporting",
    cadence: "weekly",
  },
  {
    id: "cctv_retention",
    label: "CCTV 45-day retention spot-check",
    description:
      "Pull up footage from 45 days ago on a few cameras to prove the recorder is keeping the full statutory window.",
    authority: "WAC 314-55-105 (surveillance retention)",
    cadence: "monthly",
  },
  {
    id: "scale_calibration",
    label: "Scale calibration / WSDA registration",
    description:
      "Have deli/inventory scales serviced-calibrated and the WSDA weighing-device registration renewed for the year.",
    authority: "RCW 19.94 (weights & measures)",
    cadence: "annual",
  },
  {
    id: "badge_visitor_log",
    label: "Employee badge & visitor-log check",
    description:
      "Verify every worker's LCB-compliant badge is current and the visitor log is complete for the month.",
    authority: "WAC 314-55-083(1)-(2)",
    cadence: "monthly",
  },
  {
    // R-3. Greenway files MONTHLY ("Filing Frequency: Monthly", DOR return
    // July 2026). Due the 25th of the next month; DOR moves a weekend/holiday
    // due date to the next business day. 9% penalty from the day after
    // (RCW 82.32.090(1)).
    id: "dor_excise",
    label: "DOR Combined Excise Tax Return",
    description:
      "File the Department of Revenue excise return (sales tax, B&O) for LAST month and pay it. Due the 25th; when the 25th is a weekend or legal holiday, the next business day.",
    authority: "RCW 82.32.045(1) / RCW 82.32.090(1) (9% late penalty)",
    cadence: "monthly",
  },
] as const;

// ---------------------------------------------------------------------------
// Current pending period per task
// ---------------------------------------------------------------------------
export type PendingPeriod = {
  /** Stable key marking the period done, e.g. "2026-01", "2026-W-2026-01-10", "2026". */
  periodKey: string;
  /** Human label, e.g. "January 2026", "Week of Jan 4–10". */
  periodLabel: string;
  dueDate: PlainDate;
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthKey(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

/**
 * The pending period + due date for a task as of `today` (Pacific calendar
 * date). Each task has exactly ONE pending period at a time — the most recent
 * one whose work can already be performed.
 */
export function pendingPeriodFor(id: CalendarTaskId, today: PlainDate): PendingPeriod {
  switch (id) {
    case "liq1295": {
      // Report for the PRIOR month, due the 20th of the current month.
      const py = today.m === 1 ? today.y - 1 : today.y;
      const pm = today.m === 1 ? 12 : today.m - 1;
      return {
        periodKey: monthKey(py, pm),
        periodLabel: `${MONTH_NAMES[pm - 1]} ${py}`,
        dueDate: { y: today.y, m: today.m, d: 20 },
      };
    }
    case "ccrs_weekly": {
      // Most recently COMPLETED Sun–Sat week. VERIFIED (LCB CCRS FAQ, Task W):
      // weekly reporting is expected "no later than Sunday for the previous
      // week" — the day AFTER the week ends, NOT the end of the following week.
      const wd = weekdayOf(today); // 0 = Sunday
      const lastSaturday = addDays(today, -(wd + 1));
      const weekStart = addDays(lastSaturday, -6);
      return {
        periodKey: `W-${formatPlainDate(weekStart)}`,
        periodLabel: `Week ${formatPlainDate(weekStart)} – ${formatPlainDate(lastSaturday)}`,
        dueDate: addDays(lastSaturday, 1),
      };
    }
    case "cctv_retention":
    case "badge_visitor_log": {
      // Current month, due by month-end.
      return {
        periodKey: monthKey(today.y, today.m),
        periodLabel: `${MONTH_NAMES[today.m - 1]} ${today.y}`,
        dueDate: { y: today.y, m: today.m, d: daysInMonth(today.y, today.m) },
      };
    }
    case "dor_excise": {
      // Return for the PRIOR month, due the 25th of this month (rolled).
      const py = today.m === 1 ? today.y - 1 : today.y;
      const pm = today.m === 1 ? 12 : today.m - 1;
      return dorPeriod(py, pm);
    }
    case "scale_calibration": {
      // Current calendar year, due by Dec 31.
      return {
        periodKey: String(today.y),
        periodLabel: `Calendar year ${today.y}`,
        dueDate: { y: today.y, m: 12, d: 31 },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// R-3: DOR Combined Excise Tax Return due date
// ---------------------------------------------------------------------------
export type DorExciseDue = {
  /** The 25th of the month after the return month (YYYY-MM-DD). */
  namedDate: string;
  /** The last day to file without penalty: the named date, rolled forward
   *  over Saturdays, Sundays and WA legal holidays. */
  dueDate: string;
  /** Why the date moved (the FIRST reason it could not stay put). */
  shiftedBy: "none" | "weekend" | "holiday";
};

/**
 * The due date of the DOR return for `month` of `year` (month = the month the
 * sales happened, 1..12). RCW 82.32.045(1): due "within 25 days after the end
 * of the month"; DOR: "If the due date falls on a weekend or legal holiday,
 * the due date is extended to the next business day." Pinned against DOR's
 * published 2026 table for every month (tests/compliance/r3-...).
 */
export function dorExciseDueDate(year: number, month: number): DorExciseDue {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) {
    throw new Error(`DOR return year must be a whole year, got ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`DOR return month must be 1-12, got ${month}`);
  }
  const named: PlainDate = month === 12 ? { y: year + 1, m: 1, d: 25 } : { y: year, m: month + 1, d: 25 };
  let due = named;
  let shiftedBy: DorExciseDue["shiftedBy"] = "none";
  for (let i = 0; i < 10; i++) {
    const wd = weekdayOf(due);
    const weekend = wd === 0 || wd === 6;
    const holiday = !weekend && isWaLegalHoliday(formatPlainDate(due));
    if (!weekend && !holiday) break;
    if (shiftedBy === "none") shiftedBy = weekend ? "weekend" : "holiday";
    due = addDays(due, 1);
  }
  return { namedDate: formatPlainDate(named), dueDate: formatPlainDate(due), shiftedBy };
}

function parseIso(iso: string): PlainDate {
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) };
}

function dorPeriod(y: number, m: number): PendingPeriod {
  return {
    periodKey: monthKey(y, m),
    periodLabel: `${MONTH_NAMES[m - 1]} ${y}`,
    dueDate: parseIso(dorExciseDueDate(y, m).dueDate),
  };
}

// ---------------------------------------------------------------------------
// Status evaluation
// ---------------------------------------------------------------------------
export type DoneRecord = { doneAt: string; byEmail: string | null };
/** taskId -> periodKey -> record. */
export type DoneMap = Partial<Record<CalendarTaskId, Record<string, DoneRecord>>>;

/**
 * S-12d adds two quiet statuses for the two State-reporting tasks only
 * (liq1295, ccrs_weekly), from the shared ObligationContext:
 *  - before_start: the period is before the first day of sales (weekly: the
 *    week ended before it; monthly: the month ended before it AND its due
 *    date has passed, so a real upcoming deadline is still shown as due);
 *  - dismissed: checked off on the CCRS page with a written reason.
 * Neither counts as overdue. Precedence: done > before_start > dismissed.
 */
export type CalendarEntryStatus = "done" | "due" | "overdue" | "before_start" | "dismissed";

export type CalendarEntry = {
  task: CalendarTaskDef;
  period: PendingPeriod;
  status: CalendarEntryStatus;
  /** Days until the due date (negative when overdue). */
  daysUntilDue: number;
  done: DoneRecord | null;
  /** S-12d: the written reason when status is "dismissed". */
  waiver?: Waiver | null;
};

function daysBetween(a: PlainDate, b: PlainDate): number {
  const ms =
    Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86_400_000);
}

/** Evaluate every task's current pending period against the done map. */
export function evaluateCalendar(
  today: PlainDate,
  doneMap: DoneMap,
  ctx: ObligationContext = EMPTY_CONTEXT,
): CalendarEntry[] {
  return CALENDAR_TASKS.map((task) => {
    const period = pendingPeriodFor(task.id, today);
    const done = doneMap[task.id]?.[period.periodKey] ?? null;
    const daysUntilDue = daysBetween(today, period.dueDate);
    let status: CalendarEntryStatus = done ? "done" : daysUntilDue < 0 ? "overdue" : "due";
    let waiver: Waiver | null = null;
    if (!done && (task.id === "liq1295" || task.id === "ccrs_weekly")) {
      const todayIso = formatPlainDate(today);
      const dueIso = formatPlainDate(period.dueDate);
      let beforeStart = false;
      if (task.id === "ccrs_weekly") {
        // the pending week always ended yesterday-or-earlier (its Saturday)
        beforeStart = weekBeforeStart(formatPlainDate(addDays(period.dueDate, -1)), ctx.startDate);
      } else {
        const [y, m] = period.periodKey.split("-").map(Number);
        beforeStart = monthBeforeStartAndPastDue(y, m, dueIso, todayIso, ctx.startDate);
      }
      // the pending period has always ended (prior month / last full week)
      const w = ctx.waivers.get(waiverKey(task.id, period.periodKey)) ?? null;
      if (beforeStart) status = "before_start";
      else if (w) {
        status = "dismissed";
        waiver = w;
      }
    }
    return { task, period, status, daysUntilDue, done, waiver };
  });
}

/** Count of overdue entries — the dashboard nag number. */
export function overdueCount(entries: CalendarEntry[]): number {
  return entries.filter((e) => e.status === "overdue").length;
}

/** Normalize an unknown JSON payload into a DoneMap (drops junk safely). */
export function normalizeDoneMap(raw: unknown): DoneMap {
  const out: DoneMap = {};
  if (!raw || typeof raw !== "object") return out;
  const ids = new Set<string>(CALENDAR_TASKS.map((t) => t.id));
  for (const [taskId, periods] of Object.entries(raw as Record<string, unknown>)) {
    if (!ids.has(taskId) || !periods || typeof periods !== "object") continue;
    const clean: Record<string, DoneRecord> = {};
    for (const [key, rec] of Object.entries(periods as Record<string, unknown>)) {
      if (!rec || typeof rec !== "object") continue;
      const r = rec as Record<string, unknown>;
      if (typeof r.doneAt !== "string") continue;
      clean[key] = {
        doneAt: r.doneAt,
        byEmail: typeof r.byEmail === "string" ? r.byEmail : null,
      };
    }
    if (Object.keys(clean).length > 0) out[taskId as CalendarTaskId] = clean;
  }
  return out;
}

// ---------------------------------------------------------------------------
// R-3: DOR excise reminders (pure; the reminder engine sends and dedupes)
// ---------------------------------------------------------------------------
export type DorExciseReminder = {
  stage: "dor_due_soon" | "dor_due_today" | "dor_overdue_daily";
  dedupeKey: string;
  subject: string;
  body: string;
  urgency: "warning" | "critical";
  linkPath: string;
};

/** Days before the due day the "due soon" note may go out (one per period). */
export const DOR_DUE_SOON_DAYS = 5;

/**
 * Reminders for the DOR return. Looks at the pending period (last month) and
 * the month before it, so a return that was never marked filed keeps nagging
 * after the month turns. Nothing for a period marked done on the calendar.
 * Oldest first.
 */
export function planDorExciseReminders(today: PlainDate, done: DoneMap): DorExciseReminder[] {
  const out: DorExciseReminder[] = [];
  const todayIso = formatPlainDate(today);
  const py = today.m === 1 ? today.y - 1 : today.y;
  const pm = today.m === 1 ? 12 : today.m - 1;
  const ppy = pm === 1 ? py - 1 : py;
  const ppm = pm === 1 ? 12 : pm - 1;
  for (const [y, m] of [[ppy, ppm], [py, pm]] as const) {
    const period = dorPeriod(y, m);
    if (done.dor_excise?.[period.periodKey]) continue;
    const dueIso = formatPlainDate(period.dueDate);
    const days = daysBetween(today, period.dueDate);
    const label = period.periodLabel;
    const linkPath = "/admin/compliance/calendar";
    if (days > DOR_DUE_SOON_DAYS) continue;
    if (days >= 1) {
      out.push({
        stage: "dor_due_soon",
        dedupeKey: `dor_due_soon:${period.periodKey}`,
        subject: `DOR excise return for ${label} is due ${dueIso}`,
        body: `The Department of Revenue Combined Excise Tax Return for ${label} is due ${dueIso} (${days} day${days === 1 ? "" : "s"} from today). File and pay it in My DOR, then mark it done on the compliance calendar. A late return costs a 9% penalty (RCW 82.32.090(1)).`,
        urgency: "warning",
        linkPath,
      });
    } else if (days === 0) {
      out.push({
        stage: "dor_due_today",
        dedupeKey: `dor_due_today:${period.periodKey}`,
        subject: `DOR excise return for ${label} is due TODAY (${dueIso})`,
        body: `Today is the last day to file and pay the DOR Combined Excise Tax Return for ${label} without a penalty. Starting tomorrow DOR adds 9% of the tax (RCW 82.32.090(1)). After filing, mark it done on the compliance calendar.`,
        urgency: "critical",
        linkPath,
      });
    } else {
      out.push({
        stage: "dor_overdue_daily",
        dedupeKey: `dor_overdue_daily:${period.periodKey}:${todayIso}`,
        subject: `OVERDUE: DOR excise return for ${label} (was due ${dueIso})`,
        body: `The DOR Combined Excise Tax Return for ${label} was due ${dueIso} and is not marked filed. DOR's late penalty is 9% of the tax, rising to 19% if still unpaid after the last day of the following month and 29% after the second month (RCW 82.32.090(1)). File and pay it in My DOR now, then mark it done on the compliance calendar. If it was already filed, just mark it done.`,
        urgency: "critical",
        linkPath,
      });
    }
  }
  return out;
}
