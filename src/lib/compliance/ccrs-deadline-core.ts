/**
 * src/lib/compliance/ccrs-deadline-core.ts  (Slice 106)
 *
 * PURE calculator for the WA cannabis retailer MONTHLY reporting/payment deadline
 * so a filing can never quietly slip past due. No I/O; tsx-testable.
 *
 * VERIFIED FACT (WA LCB "Cannabis Tax Reporting Guide", grounded in
 * RCW 69.50.535 and WAC 314-55-089 / 314-55-092):
 *   • Cannabis retail licensees must submit a Retailer Sales and Tax report
 *     (LIQ-1295) of their MONTHLY sales — EVEN WITH NO SALES —
 *   • "on or before the 20th of the next month following completed sales."
 *   • "If the 20th falls on a weekend or a holiday, the next business day is the
 *     tax due date."
 *   • A 2% late-payment penalty accrues on the balance after the due date.
 *
 * Holidays vary by year, so we do NOT hardcode a guessed list: the due-date
 * calculator rolls a weekend 20th to the next business day by default, and
 * accepts an OPTIONAL set of holiday ISO dates (owner/config supplied) that also
 * roll forward. This keeps the math honest — we never assert a holiday we can't
 * verify, and the owner can add the LCB's published holidays if desired.
 *
 * This module answers, for a given period (a calendar month) and "today":
 *   • the statutory due date,
 *   • how many days until/after it,
 *   • a status: upcoming | due_soon | due_today | overdue | filed,
 * and given the set of already-exported periods, flags any UNFILED period whose
 * window has closed. Whether a period was "filed" is decided by the caller
 * (e.g. presence of a ccrs_export_batches row / a recorded LIQ-1295 filing).
 */

export type ReportingPeriod = {
  /** Calendar year of the sales month. */
  year: number;
  /** 1–12 sales month. */
  month: number;
};

export type DeadlineStatus =
  | "filed" // caller says this period is already filed
  | "upcoming" // due date is more than `soonDays` away
  | "due_soon" // within `soonDays` and not yet due
  | "due_today" // due date is today
  | "overdue"; // past the due date and not filed

export type PeriodDeadline = {
  period: ReportingPeriod;
  /** ISO YYYY-MM-DD statutory due date (20th of the following month, rolled). */
  dueDate: string;
  /** Signed days from today to due date (negative once overdue). */
  daysUntilDue: number;
  status: DeadlineStatus;
  filed: boolean;
};

const WEEKEND = new Set([0, 6]); // Sun, Sat

function iso(y: number, m: number, d: number): string {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/** UTC day difference a - b in whole days. */
function dayDiff(aIso: string, bIso: string): number {
  const a = Date.parse(`${aIso}T00:00:00Z`);
  const b = Date.parse(`${bIso}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

function dowUtc(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

function addDay(isoDate: string): string {
  const t = Date.parse(`${isoDate}T00:00:00Z`) + 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * The statutory due date for a sales month: the 20th of the FOLLOWING month,
 * rolled forward to the next business day if it lands on a weekend or a supplied
 * holiday. PURE.
 */
export function dueDateForPeriod(period: ReportingPeriod, holidays: ReadonlySet<string> = new Set()): string {
  // Following month.
  let y = period.year;
  let m = period.month + 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  let due = iso(y, m, 20);
  // Roll forward off weekends / holidays.
  // Bounded loop (max ~5 iterations for a long weekend + holiday run).
  for (let i = 0; i < 10; i += 1) {
    if (WEEKEND.has(dowUtc(due)) || holidays.has(due)) {
      due = addDay(due);
    } else {
      break;
    }
  }
  return due;
}

/**
 * Compute the deadline + status for one period relative to `today` (ISO date).
 * `filed` is supplied by the caller. PURE.
 */
export function periodDeadline(
  period: ReportingPeriod,
  todayIso: string,
  filed: boolean,
  opts?: { holidays?: ReadonlySet<string>; soonDays?: number },
): PeriodDeadline {
  const soonDays = opts?.soonDays ?? 5;
  const dueDate = dueDateForPeriod(period, opts?.holidays);
  const daysUntilDue = dayDiff(dueDate, todayIso);

  let status: DeadlineStatus;
  if (filed) status = "filed";
  else if (daysUntilDue < 0) status = "overdue";
  else if (daysUntilDue === 0) status = "due_today";
  else if (daysUntilDue <= soonDays) status = "due_soon";
  else status = "upcoming";

  return { period, dueDate, daysUntilDue, status, filed };
}

/** period → "YYYY-MM" key. PURE. */
export function periodKey(p: ReportingPeriod): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

/** "YYYY-MM" key → period. PURE. */
export function keyToPeriod(key: string): ReportingPeriod {
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) };
}

/** Last day of a calendar month (handles leap Feb). PURE. */
function lastDayOfMonth(year: number, month: number): number {
  // Day 0 of the *next* month is the last day of this month (UTC).
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Return the set of "YYYY-MM" calendar months that are FULLY covered by the
 * inclusive date range [fromIso, toIso]. A month counts as covered only when the
 * range spans from at-or-before its first day to at-or-after its last day, so a
 * partial-month export never falsely marks a sales month as "on record". PURE.
 *
 * `fromIso`/`toIso` may be full ISO timestamps; only the date part is used.
 */
export function monthsFullyCoveredByRange(fromIso: string, toIso: string): Set<string> {
  const out = new Set<string>();
  const from = String(fromIso).slice(0, 10);
  const to = String(toIso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return out;
  }
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  // Walk month-by-month from the from-month through the to-month (bounded).
  for (let guard = 0; guard < 600; guard += 1) {
    const first = iso(y, m, 1);
    const last = iso(y, m, lastDayOfMonth(y, m));
    if (from <= first && to >= last) out.add(periodKey({ year: y, month: m }));
    if (y === endY && m === endM) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** The calendar month N months before the month containing `todayIso`. PURE. */
export function priorPeriod(todayIso: string, monthsBack: number): ReportingPeriod {
  const y = Number(todayIso.slice(0, 4));
  const m = Number(todayIso.slice(5, 7));
  // Convert to a 0-based absolute month index, subtract, convert back.
  const abs = y * 12 + (m - 1) - monthsBack;
  return { year: Math.floor(abs / 12), month: (abs % 12) + 1 };
}

/**
 * Build the deadline picture for the most recent `lookbackMonths` sales months
 * (excluding the current, still-in-progress month, whose report isn't due yet).
 * `filedPeriodKeys` is the set of "YYYY-MM" the caller knows are filed.
 * Returns newest-first, plus the single most urgent unfiled item. PURE.
 */
export function reportingDeadlineOverview(
  todayIso: string,
  filedPeriodKeys: ReadonlySet<string>,
  opts?: { holidays?: ReadonlySet<string>; soonDays?: number; lookbackMonths?: number },
): { periods: PeriodDeadline[]; mostUrgentUnfiled: PeriodDeadline | null; anyOverdue: boolean } {
  const lookback = opts?.lookbackMonths ?? 3;
  const periods: PeriodDeadline[] = [];
  // monthsBack = 1 is last month (its report is the one currently due).
  for (let back = 1; back <= lookback; back += 1) {
    const p = priorPeriod(todayIso, back);
    const filed = filedPeriodKeys.has(periodKey(p));
    periods.push(periodDeadline(p, todayIso, filed, opts));
  }

  const unfiled = periods.filter((p) => !p.filed);
  // Most urgent = smallest daysUntilDue (overdue = most negative) among unfiled.
  const mostUrgentUnfiled =
    unfiled.length > 0
      ? unfiled.reduce((a, b) => (b.daysUntilDue < a.daysUntilDue ? b : a))
      : null;
  const anyOverdue = periods.some((p) => p.status === "overdue");

  return { periods, mostUrgentUnfiled, anyOverdue };
}

// ── Self-tests (tsx) ────────────────────────────────────────────────────────

export function __runCcrsDeadlineTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // June 2024 sales → due July 22, 2024 (the 20th was a Saturday; per the LCB
  // guide the June 2024 report was due July 22, 2024). Verifies weekend roll.
  ok(dueDateForPeriod({ year: 2024, month: 6 }) === "2024-07-22", `June 2024 due 2024-07-22 (got ${dueDateForPeriod({ year: 2024, month: 6 })})`);

  // A weekday 20th stays put: Jan 2025 sales → Feb 20, 2025 (Thursday).
  ok(dueDateForPeriod({ year: 2025, month: 1 }) === "2025-02-20", `Jan 2025 due 2025-02-20 (got ${dueDateForPeriod({ year: 2025, month: 1 })})`);

  // December rolls the year: Dec 2025 sales → Jan 20, 2026 (Tuesday).
  ok(dueDateForPeriod({ year: 2025, month: 12 }) === "2026-01-20", `Dec 2025 due 2026-01-20 (got ${dueDateForPeriod({ year: 2025, month: 12 })})`);

  // Holiday roll: if Feb 20 2025 were a supplied holiday, roll to Feb 21.
  ok(
    dueDateForPeriod({ year: 2025, month: 1 }, new Set(["2025-02-20"])) === "2025-02-21",
    "supplied holiday rolls forward",
  );

  // Status transitions relative to a fixed due date (Jan 2025 → 2025-02-20).
  const p = { year: 2025, month: 1 };
  ok(periodDeadline(p, "2025-02-10", false).status === "upcoming", "upcoming");
  ok(periodDeadline(p, "2025-02-17", false).status === "due_soon", "due_soon within 5 days");
  ok(periodDeadline(p, "2025-02-20", false).status === "due_today", "due_today");
  ok(periodDeadline(p, "2025-02-21", false).status === "overdue", "overdue");
  ok(periodDeadline(p, "2025-02-21", true).status === "filed", "filed overrides");
  ok(periodDeadline(p, "2025-02-21", false).daysUntilDue === -1, "overdue by 1 day");

  // priorPeriod math.
  ok(periodKey(priorPeriod("2026-01-10", 1)) === "2025-12", "priorPeriod crosses year (Dec 2025)");
  ok(periodKey(priorPeriod("2026-03-10", 2)) === "2026-01", "priorPeriod 2 months back");

  // keyToPeriod round-trips periodKey.
  ok(
    periodKey(keyToPeriod("2024-07")) === "2024-07" && keyToPeriod("2024-07").month === 7,
    "keyToPeriod round-trips",
  );

  // monthsFullyCoveredByRange: a full calendar month is covered.
  {
    const cov = monthsFullyCoveredByRange("2024-06-01", "2024-06-30");
    ok(cov.has("2024-06") && cov.size === 1, "full June 2024 covered");
  }
  // Partial month is NOT covered (range starts mid-month).
  {
    const cov = monthsFullyCoveredByRange("2024-06-05", "2024-06-30");
    ok(!cov.has("2024-06") && cov.size === 0, "partial June (late start) NOT covered");
  }
  // Partial month is NOT covered (range ends before month end).
  {
    const cov = monthsFullyCoveredByRange("2024-06-01", "2024-06-29");
    ok(!cov.has("2024-06"), "partial June (early end) NOT covered");
  }
  // Multi-month range covers every whole month it spans, drops the partial ends.
  {
    const cov = monthsFullyCoveredByRange("2024-05-15", "2024-08-10");
    ok(
      cov.has("2024-06") && cov.has("2024-07") && !cov.has("2024-05") && !cov.has("2024-08"),
      "multi-month range covers only whole interior months",
    );
  }
  // Feb leap-year full month.
  {
    const cov = monthsFullyCoveredByRange("2024-02-01", "2024-02-29");
    ok(cov.has("2024-02"), "leap Feb 2024 (29 days) fully covered");
  }
  // Timestamp inputs (only date part used) and year-spanning range.
  {
    const cov = monthsFullyCoveredByRange("2023-12-01T00:00:00Z", "2024-01-31T23:59:59Z");
    ok(cov.has("2023-12") && cov.has("2024-01"), "timestamp range spans Dec 2023 + Jan 2024");
  }
  // Inverted / malformed range → empty.
  ok(monthsFullyCoveredByRange("2024-06-30", "2024-06-01").size === 0, "inverted range → empty");

  // Overview scenario A: only last month (Jan 2025) is unfiled; older months filed.
  // Today 2025-02-21 → Jan 2025 report was due 2025-02-20 (Thu, weekday) → overdue by 1 day.
  const overviewA = reportingDeadlineOverview(
    "2025-02-21",
    new Set(["2024-12", "2024-11"]), // Dec+Nov filed, Jan 2025 UNFILED
    { lookbackMonths: 3 },
  );
  ok(overviewA.anyOverdue, "overview A flags overdue");
  ok(
    overviewA.mostUrgentUnfiled?.period.month === 1 &&
      overviewA.mostUrgentUnfiled?.period.year === 2025,
    "overview A most urgent unfiled is Jan 2025",
  );

  // Overview scenario B: MULTIPLE unfiled — Nov 2024 AND Jan 2025 both unfiled.
  // "Most urgent" = the one overdue the LONGEST (greatest 2% late-penalty exposure),
  // which is Nov 2024 (due 2024-12-20), not the more-recent Jan 2025.
  const overviewB = reportingDeadlineOverview(
    "2025-02-21",
    new Set(["2024-12"]), // only Dec 2024 filed; Nov 2024 + Jan 2025 unfiled
    { lookbackMonths: 3 },
  );
  ok(overviewB.anyOverdue, "overview B flags overdue");
  ok(
    overviewB.mostUrgentUnfiled?.period.month === 11 &&
      overviewB.mostUrgentUnfiled?.period.year === 2024,
    "overview B most urgent unfiled is the OLDEST overdue (Nov 2024)",
  );

  // All filed → nothing urgent, not overdue.
  const allFiled = reportingDeadlineOverview(
    "2025-02-21",
    new Set(["2024-12", "2025-01", "2024-11"]),
    { lookbackMonths: 3 },
  );
  ok(allFiled.mostUrgentUnfiled === null && !allFiled.anyOverdue, "all filed → clear");

  if (failed === 0) console.log(`ccrs-deadline-core: all ${passed} tests passed`);
  return { passed, failed };
}
