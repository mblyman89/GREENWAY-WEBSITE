/**
 * src/lib/staffing/tips-core.ts  (Fix Phase 2.1c · employee tip tracker)
 *
 * PURE. No I/O. Registered in scripts/compliance/run-pure-selftests.ts.
 *
 * Owner message 6: "I want to add to this an employee tip tracker with a new
 * page in the employee drop down menu to track tips and give stats on them.
 * Please check the existing code and logic for tip tracking."
 *
 * THE EXISTING TIP RECORD (checked, reused, not replaced)
 * -------------------------------------------------------
 *   drawer_sessions.tips_minor (migration 0134, feature slice 30): tips
 *   counted out of the tip jar at close, in cents. NULL = not recorded,
 *   0 = the cashier counted an empty jar. "Employee money - never part of
 *   expected-close or over/short drawer math" (the column comment). It is
 *   typed on the iPad close screen (RegisterShell "Tips (counted
 *   separately)") and on the back-office close form, validated by
 *   till-core.ts (MAX_TIPS_MINOR, tipsToMinor), and written by
 *   registers/store.ts closeDrawerBlind.
 *
 * WHOSE TIPS
 * ----------
 *   The register tells the closer "Count the tip jar by itself - tips are
 *   your money" (RegisterShell close step 1), so a session's tips belong to
 *   the employee who CLOSED it (drawer_sessions.closed_by). When a different
 *   employee opened the drawer, the report says so on the row; it never
 *   splits the money on its own (no tip-pool rule exists in the code or the
 *   SOPs, so none is invented).
 *
 * Money is integer cents throughout. NULL stays "not recorded", never 0.
 */

/* ─── inputs ─────────────────────────────────────────────────────────────── */

export type TipSessionRow = {
  sessionId: string;
  registerId: string;
  businessDay: string;
  status: string; // closed | reconciled | verified (open sessions are skipped)
  openedBy: string | null;
  closedBy: string | null;
  tipsMinor: number | null;
  closedAt: string | null;
};

/* ─── outputs ────────────────────────────────────────────────────────────── */

export type EmployeeTipStats = {
  employeeId: string;
  /** Sessions this employee closed in range. */
  sessionsClosed: number;
  /** Of those, how many have a tip figure (0 counts: a real empty jar). */
  sessionsRecorded: number;
  sessionsNotRecorded: number;
  totalMinor: number;
  /** Whole cents; 0 when nothing recorded. */
  averagePerRecordedMinor: number;
  highestMinor: number;
  highestDay: string | null;
  /** Distinct business days with at least one recorded figure. */
  daysRecorded: number;
  /** Worked minutes in range (time clock), when known. */
  workedMinutes: number | null;
  /** Cents per worked hour, whole cents; null when no hours. */
  perHourMinor: number | null;
};

export type TipDay = { businessDay: string; totalMinor: number; recorded: number; notRecorded: number };
export type TipWeekday = { weekday: number; label: string; days: number; totalMinor: number; averagePerDayMinor: number };

export type TipReport = {
  employees: EmployeeTipStats[];
  days: TipDay[];
  weekdays: TipWeekday[];
  store: {
    sessionsClosed: number;
    sessionsRecorded: number;
    sessionsNotRecorded: number;
    totalMinor: number;
    averagePerRecordedMinor: number;
    /** Share of closed sessions with a tip figure, one decimal ("92.0%"). */
    recordedRate: string;
  };
  /** Closed sessions with no closer on record (cannot be attributed). */
  unattributed: { count: number; totalMinor: number };
  /** The rows behind the figures, newest first (for the session list). */
  sessions: (TipSessionRow & { openedByOther: boolean })[];
};

/* ─── helpers ────────────────────────────────────────────────────────────── */

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function isTipFigure(v: unknown): v is number {
  return Number.isSafeInteger(v) && (v as number) >= 0;
}

/** Day of week of a calendar day (the day string is already Pacific). */
export function weekdayOf(day: string): number {
  const t = Date.parse(`${day}T12:00:00Z`);
  return Number.isNaN(t) ? -1 : new Date(t).getUTCDay();
}

function pct(n: number, d: number): string {
  return d <= 0 ? "0.0%" : `${((n / d) * 100).toFixed(1)}%`;
}

/* ─── the report ─────────────────────────────────────────────────────────── */

export function buildTipReport(input: {
  sessions: readonly TipSessionRow[];
  /** employee id → worked minutes in range (time clock). */
  workedMinutes?: ReadonlyMap<string, number>;
}): TipReport {
  const closed = input.sessions.filter((s) => s.status !== "open");
  const per = new Map<string, EmployeeTipStats & { _days: Set<string> }>();
  const days = new Map<string, TipDay>();
  const unattributed = { count: 0, totalMinor: 0 };
  let recorded = 0;
  let total = 0;

  for (const s of closed) {
    const has = isTipFigure(s.tipsMinor);
    const amount = has ? (s.tipsMinor as number) : 0;
    const d = days.get(s.businessDay) ?? { businessDay: s.businessDay, totalMinor: 0, recorded: 0, notRecorded: 0 };
    if (has) {
      d.recorded += 1;
      d.totalMinor += amount;
      recorded += 1;
      total += amount;
    } else d.notRecorded += 1;
    days.set(s.businessDay, d);

    if (!s.closedBy) {
      unattributed.count += 1;
      unattributed.totalMinor += amount;
      continue;
    }
    let e = per.get(s.closedBy);
    if (!e) {
      e = {
        employeeId: s.closedBy,
        sessionsClosed: 0,
        sessionsRecorded: 0,
        sessionsNotRecorded: 0,
        totalMinor: 0,
        averagePerRecordedMinor: 0,
        highestMinor: 0,
        highestDay: null,
        daysRecorded: 0,
        workedMinutes: null,
        perHourMinor: null,
        _days: new Set(),
      };
      per.set(s.closedBy, e);
    }
    e.sessionsClosed += 1;
    if (has) {
      e.sessionsRecorded += 1;
      e.totalMinor += amount;
      e._days.add(s.businessDay);
      if (e.highestDay === null || amount > e.highestMinor) {
        e.highestMinor = amount;
        e.highestDay = s.businessDay;
      }
    } else e.sessionsNotRecorded += 1;
  }

  const employees: EmployeeTipStats[] = [...per.values()].map(({ _days, ...e }) => {
    const worked = input.workedMinutes?.get(e.employeeId);
    const workedMinutes = typeof worked === "number" && worked >= 0 ? worked : null;
    return {
      ...e,
      daysRecorded: _days.size,
      averagePerRecordedMinor: e.sessionsRecorded > 0 ? Math.round(e.totalMinor / e.sessionsRecorded) : 0,
      workedMinutes,
      perHourMinor: workedMinutes && workedMinutes > 0 ? Math.round((e.totalMinor * 60) / workedMinutes) : null,
    };
  });
  employees.sort((a, b) => b.totalMinor - a.totalMinor || a.employeeId.localeCompare(b.employeeId));

  const dayList = [...days.values()].sort((a, b) => a.businessDay.localeCompare(b.businessDay));
  const wk = WEEKDAY.map((label, weekday) => ({ weekday, label, days: 0, totalMinor: 0, averagePerDayMinor: 0 }));
  for (const d of dayList) {
    if (d.recorded === 0) continue; // a day with no figure says nothing about tips
    const w = weekdayOf(d.businessDay);
    if (w < 0) continue;
    wk[w].days += 1;
    wk[w].totalMinor += d.totalMinor;
  }
  for (const w of wk) w.averagePerDayMinor = w.days > 0 ? Math.round(w.totalMinor / w.days) : 0;

  const openedOther = (s: TipSessionRow) => !!s.openedBy && !!s.closedBy && s.openedBy !== s.closedBy;
  const sessions = [...closed]
    .sort((a, b) => (b.businessDay === a.businessDay ? (b.closedAt ?? "").localeCompare(a.closedAt ?? "") : b.businessDay.localeCompare(a.businessDay)))
    .map((s) => ({ ...s, openedByOther: openedOther(s) }));

  return {
    employees,
    days: dayList,
    weekdays: wk,
    store: {
      sessionsClosed: closed.length,
      sessionsRecorded: recorded,
      sessionsNotRecorded: closed.length - recorded,
      totalMinor: total,
      averagePerRecordedMinor: recorded > 0 ? Math.round(total / recorded) : 0,
      recordedRate: pct(recorded, closed.length),
    },
    unattributed,
    sessions,
  };
}

/* ─── range, correction, CSV ─────────────────────────────────────────────── */

/** Longest range one tip report reads: a year, for year-end statements. */
export const TIP_REPORT_MAX_DAYS = 366;

export function checkTipRange(from: string, to: string): { ok: true } | { ok: false; error: string } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to)) return { ok: false, error: "Pick both days as YYYY-MM-DD." };
  if (from > to) return { ok: false, error: "The From day is after the To day." };
  const n = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (!Number.isFinite(n)) return { ok: false, error: "Those are not real dates." };
  if (n > TIP_REPORT_MAX_DAYS) return { ok: false, error: `Pick ${TIP_REPORT_MAX_DAYS} days or fewer (you picked ${n}).` };
  return { ok: true };
}

/** Same ceiling the register uses for one close (till-core MAX_TIPS_MINOR). */
export const TIP_CORRECTION_MAX_MINOR = 1_000_000;
export const TIP_CORRECTION_REASON_MIN = 5;
export const TIP_CORRECTION_REASON_MAX = 300;

/**
 * A manager's correction of one closed session's tip figure. Blank amount
 * means "not recorded" (NULL) - a real answer, kept apart from $0.00. A
 * reason is always required; the change is audited with before and after.
 */
export function validateTipCorrection(input: {
  amountRaw: string;
  reason: string;
  status: string;
}): { ok: true; tipsMinor: number | null; reason: string } | { ok: false; error: string } {
  if (input.status === "open") return { ok: false, error: "That drawer is still open. Tips are recorded when it is closed." };
  const reason = input.reason.trim();
  if (reason.length < TIP_CORRECTION_REASON_MIN) return { ok: false, error: "Write why the tip figure is being changed (at least 5 characters)." };
  if (reason.length > TIP_CORRECTION_REASON_MAX) return { ok: false, error: `Keep the reason under ${TIP_CORRECTION_REASON_MAX} characters.` };
  const raw = input.amountRaw.trim().replace(/[$,\s]/g, "");
  if (raw === "") return { ok: true, tipsMinor: null, reason };
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { ok: false, error: "Enter tips as dollars and cents (like 42.50), or leave it blank for not recorded." };
  const [whole, frac = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return { ok: false, error: "That amount is not a number." };
  if (cents > TIP_CORRECTION_MAX_MINOR) return { ok: false, error: "That tip amount is implausibly large. Check the number." };
  return { ok: true, tipsMinor: cents, reason };
}

export const TIP_CSV_HEADERS = [
  "Business day",
  "Register",
  "Closed by",
  "Opened by",
  "Status",
  "Tips",
  "Recorded",
] as const;

function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function tipCsv(
  sessions: readonly TipSessionRow[],
  nameOf: (id: string | null) => string,
  registerOf: (id: string) => string,
): string {
  const rows = sessions.map((s) => [
    s.businessDay,
    registerOf(s.registerId),
    nameOf(s.closedBy),
    nameOf(s.openedBy),
    s.status,
    isTipFigure(s.tipsMinor) ? (s.tipsMinor / 100).toFixed(2) : "",
    isTipFigure(s.tipsMinor) ? "yes" : "not recorded",
  ]);
  return [TIP_CSV_HEADERS as readonly string[], ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function formatWorked(minutes: number | null): string {
  if (minutes === null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/* ─── self-tests ─────────────────────────────────────────────────────────── */

export function __runTipsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`tips-core FAIL: ${m}`);
    }
  };
  const s = (id: string, day: string, closedBy: string | null, tips: number | null, extra: Partial<TipSessionRow> = {}): TipSessionRow => ({
    sessionId: id,
    registerId: "R1",
    businessDay: day,
    status: "reconciled",
    openedBy: closedBy,
    closedBy,
    tipsMinor: tips,
    closedAt: `${day}T23:00:00Z`,
    ...extra,
  });
  const r = buildTipReport({
    sessions: [
      s("1", "2026-11-02", "A", 4250), // Monday
      s("2", "2026-11-03", "A", 0), // counted empty jar
      s("3", "2026-11-03", "A", null), // not recorded
      s("4", "2026-11-02", "B", 1000, { openedBy: "C" }),
      s("5", "2026-11-04", null, 500),
      s("6", "2026-11-04", "B", 9999, { status: "open" }),
    ],
    workedMinutes: new Map([["A", 600]]),
  });
  const a = r.employees.find((e) => e.employeeId === "A")!;
  ok(a.sessionsClosed === 3 && a.sessionsRecorded === 2 && a.sessionsNotRecorded === 1, "A: zero counts as recorded, null does not");
  ok(a.totalMinor === 4250 && a.averagePerRecordedMinor === 2125, "A: total and average per recorded shift");
  ok(a.highestMinor === 4250 && a.highestDay === "2026-11-02", "A: highest");
  ok(a.daysRecorded === 2, "A: days recorded");
  ok(a.perHourMinor === 425 && a.workedMinutes === 600, "A: $42.50 over 10h = $4.25/h");
  const b = r.employees.find((e) => e.employeeId === "B")!;
  ok(b.sessionsClosed === 1 && b.totalMinor === 1000, "open session skipped");
  ok(b.perHourMinor === null, "no hours = no per-hour figure, never a guess");
  ok(r.sessions.find((x) => x.sessionId === "4")!.openedByOther, "opened by someone else is flagged, not split");
  ok(r.unattributed.count === 1 && r.unattributed.totalMinor === 500, "no closer = unattributed, given to nobody");
  ok(r.store.totalMinor === 5750 && r.store.sessionsClosed === 5 && r.store.sessionsRecorded === 4, "store totals");
  ok(r.store.recordedRate === "80.0%", "recorded rate");
  ok(r.employees[0].employeeId === "A", "sorted by total, highest first");
  const mon = r.weekdays[1];
  ok(mon.label === "Monday" && mon.days === 1 && mon.totalMinor === 5250, "weekday totals (2026-11-02 is a Monday)");
  ok(r.days.length === 3 && r.days[0].businessDay === "2026-11-02", "days ascending");
  ok(r.sessions[0].businessDay === "2026-11-04", "sessions newest first");
  ok(buildTipReport({ sessions: [] }).store.recordedRate === "0.0%", "empty report safe");
  // corrections
  const c1 = validateTipCorrection({ amountRaw: "$42.50", reason: "jar recount", status: "closed" });
  ok(c1.ok && c1.tipsMinor === 4250, "correction parses dollars");
  const c2 = validateTipCorrection({ amountRaw: "", reason: "was typed by mistake", status: "reconciled" });
  ok(c2.ok && c2.tipsMinor === null, "blank = not recorded");
  const c3 = validateTipCorrection({ amountRaw: "0", reason: "empty jar", status: "closed" });
  ok(c3.ok && c3.tipsMinor === 0, "zero is a real answer");
  ok(!validateTipCorrection({ amountRaw: "5", reason: "x", status: "closed" }).ok, "reason required");
  ok(!validateTipCorrection({ amountRaw: "5", reason: "recount", status: "open" }).ok, "open drawer refused");
  ok(!validateTipCorrection({ amountRaw: "-5", reason: "recount", status: "closed" }).ok, "negative refused");
  ok(!validateTipCorrection({ amountRaw: "1.234", reason: "recount", status: "closed" }).ok, "sub-cent refused");
  ok(!validateTipCorrection({ amountRaw: "20000", reason: "recount", status: "closed" }).ok, "over the register ceiling refused");
  // range + csv
  ok(checkTipRange("2026-01-01", "2026-12-31").ok, "a full year accepted");
  ok(!checkTipRange("2025-01-01", "2026-12-31").ok, "over a year refused");
  ok(!checkTipRange("2026-02-02", "2026-02-01").ok, "reversed refused");
  const csv = tipCsv([s("9", "2026-11-02", "A", null)], (id) => (id === "A" ? "=Ann" : ""), () => "Front");
  ok(csv.includes("'=Ann") && csv.includes("not recorded"), "csv neutralises formulas and keeps not-recorded apart");
  ok(formatWorked(605) === "10h 5m" && formatWorked(null) === "—", "worked format");
  ok(weekdayOf("2026-11-08") === 0, "weekday of a Sunday");
  return { passed, failed };
}
