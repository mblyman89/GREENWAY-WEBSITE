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
 *
 * All date math is plain calendar arithmetic (no timezone parsing); callers
 * feed the STORE's Pacific wall-clock date via lib/reports/timezone.
 */

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
  | "badge_visitor_log";

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
// Status evaluation
// ---------------------------------------------------------------------------
export type DoneRecord = { doneAt: string; byEmail: string | null };
/** taskId -> periodKey -> record. */
export type DoneMap = Partial<Record<CalendarTaskId, Record<string, DoneRecord>>>;

export type CalendarEntryStatus = "done" | "due" | "overdue";

export type CalendarEntry = {
  task: CalendarTaskDef;
  period: PendingPeriod;
  status: CalendarEntryStatus;
  /** Days until the due date (negative when overdue). */
  daysUntilDue: number;
  done: DoneRecord | null;
};

function daysBetween(a: PlainDate, b: PlainDate): number {
  const ms =
    Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86_400_000);
}

/** Evaluate every task's current pending period against the done map. */
export function evaluateCalendar(today: PlainDate, doneMap: DoneMap): CalendarEntry[] {
  return CALENDAR_TASKS.map((task) => {
    const period = pendingPeriodFor(task.id, today);
    const done = doneMap[task.id]?.[period.periodKey] ?? null;
    const daysUntilDue = daysBetween(today, period.dueDate);
    const status: CalendarEntryStatus = done ? "done" : daysUntilDue < 0 ? "overdue" : "due";
    return { task, period, status, daysUntilDue, done };
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
