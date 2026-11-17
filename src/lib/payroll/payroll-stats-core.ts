/**
 * src/lib/payroll/payroll-stats-core.ts   (D248 slice 5)
 *
 * PAYROLL ANALYTICS: hours per workweek, overtime trend, estimated labor cost,
 * break compliance, shift lengths, sick balances - across the last N workweeks,
 * per employee and for the store.
 *
 * Owner (D248, verbatim excerpt): "...stats, charts, graphs, anything that an
 * expert, professional enterprise grade system would have for managing
 * payroll. Sick time, breaks, overtime, total hours per week, total per
 * period, gross pay..."
 *
 * Works from punches directly, so it shows something useful before any pay
 * period exists. Rules match the time cards and the pay engine:
 *   - a punch belongs to the Pacific day it clocked in, and that day's workweek;
 *   - overtime = over 40 hours in a fixed workweek (never averaged);
 *   - open punches and punches over 24h are EXCLUDED and counted, never guessed;
 *   - with no workweek set, weeks are shown Sunday-Saturday for the chart but
 *     overtime is NOT split (null), as on the time cards.
 * Labor cost here is an ESTIMATE at each person's current rate (straight time
 * plus the half-time premium); the pay preview is the computed figure.
 *
 * PURE. No I/O. Self-tests at the bottom.
 */

import { addPacificDays } from "@/lib/reports/timezone";
import { IMPLAUSIBLE_SHIFT_MINUTES, LONG_SHIFT_MINUTES, NEAR_OT_MINUTES, OT_THRESHOLD_MINUTES, spanMinutes } from "@/lib/payroll/time-card-core";
import type { WeekdayIndex } from "@/lib/payroll/timesheet-core";

export type StatsPunch = {
  readonly employeeId: string;
  readonly kind: "work" | "break";
  /** Pacific day of clock-in. */
  readonly day: string;
  readonly clockInIso: string;
  readonly clockOutIso: string | null;
};

export type StatsEmployee = {
  readonly id: string;
  readonly name: string;
  /** Current hourly rate, milli-cents. null = none on file (salary or missing). */
  readonly rateMilliCents: number | null;
};

export type StatsFlag = { readonly employeeId: string; readonly day: string };

/** Signed ledger minutes per employee, all time to date (balance = sum). */
export type SickLedgerRow = { readonly employeeId: string; readonly kind: string; readonly minutes: number; readonly date: string };

export type WeekStat = {
  readonly startDate: string;
  readonly endDate: string;
  readonly workMinutes: number;
  readonly overtimeMinutes: number | null;
  readonly breakMinutes: number;
  readonly employeesWorked: number;
  readonly shifts: number;
  readonly estLaborCents: number;
  readonly breakFlags: number;
};

export type EmployeeStat = {
  readonly employeeId: string;
  readonly name: string;
  readonly workMinutes: number;
  readonly overtimeMinutes: number | null;
  readonly weeksWorked: number;
  readonly avgWeekMinutes: number;
  readonly maxWeekMinutes: number;
  readonly weeksOver40: number;
  readonly weeksNearOt: number;
  readonly shifts: number;
  readonly avgShiftMinutes: number;
  readonly longShifts: number;
  readonly breakFlags: number;
  readonly daysWorked: number;
  /** Share of days worked with no meal-break flag, 0-100, null when no days. */
  readonly breakCompliancePct: number | null;
  readonly estLaborCents: number | null;
  readonly sickUsedMinutes: number;
  readonly sickBalanceMinutes: number;
  /** Per-week minutes, aligned with StatsResult.weeks. */
  readonly byWeek: readonly number[];
};

export type StatsResult = {
  readonly weeks: readonly WeekStat[];
  readonly employees: readonly EmployeeStat[];
  readonly byWeekday: readonly { weekday: number; label: string; avgMinutes: number }[];
  readonly byHour: readonly { hour: number; workerMinutes: number }[];
  readonly totals: {
    readonly workMinutes: number;
    readonly overtimeMinutes: number | null;
    readonly overtimeSharePct: number | null;
    readonly estLaborCents: number;
    readonly avgShiftMinutes: number;
    readonly breakCompliancePct: number | null;
    readonly excludedOpen: number;
    readonly excludedImplausible: number;
    readonly employeesNoRate: readonly string[];
    readonly sickUsedMinutes: number;
    readonly sickBalanceMinutes: number;
  };
  readonly otSplit: boolean;
};

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Weekday 0-6 of a YYYY-MM-DD day key (calendar arithmetic, no timezone). */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** First day of the workweek containing `day`. */
export function weekStartOf(day: string, anchor: WeekdayIndex): string {
  return addPacificDays(day, -((weekdayOf(day) - anchor + 7) % 7));
}

/** The N workweeks ending with the one containing `today`, oldest first. */
export function weekRange(today: string, anchor: WeekdayIndex, n: number): { startDate: string; endDate: string }[] {
  const n2 = Math.max(1, Math.min(52, Math.floor(n)));
  const last = weekStartOf(today, anchor);
  const out: { startDate: string; endDate: string }[] = [];
  for (let i = n2 - 1; i >= 0; i--) {
    const s = addPacificDays(last, -7 * i);
    out.push({ startDate: s, endDate: addPacificDays(s, 6) });
  }
  return out;
}

/** Straight time + half-time premium, whole cents. */
export function estWages(workMinutes: number, otMinutes: number, rateMilliCents: number): number {
  return Math.round((workMinutes * rateMilliCents + otMinutes * rateMilliCents * 0.5) / 60 / 1000);
}

export function computeStats(args: {
  today: string;
  weeks: number;
  workweekStartsOn: WeekdayIndex | null;
  employees: readonly StatsEmployee[];
  punches: readonly StatsPunch[];
  breakFlags: readonly StatsFlag[];
  sickLedger: readonly SickLedgerRow[];
}): StatsResult {
  const otSplit = args.workweekStartsOn !== null;
  const anchor: WeekdayIndex = args.workweekStartsOn ?? 0;
  const range = weekRange(args.today, anchor, args.weeks);
  const first = range[0].startDate;
  const last = range[range.length - 1].endDate;
  const inRange = (d: string) => d >= first && d <= last;
  const weekIdx = (d: string) => range.findIndex((w) => d >= w.startDate && d <= w.endDate);

  let excludedOpen = 0;
  let excludedImplausible = 0;
  // employee -> week -> minutes ; and per-employee shift lists
  const work = new Map<string, number[]>();
  const brk = new Map<string, number[]>();
  const shifts = new Map<string, number[]>();
  const daysWorked = new Map<string, Set<string>>();
  const weekdayMinutes = new Array(7).fill(0);
  const hourMinutes = new Array(24).fill(0);
  for (const p of args.punches) {
    if (!inRange(p.day)) continue;
    const m = spanMinutes(p.clockInIso, p.clockOutIso);
    if (m === null) {
      excludedOpen++;
      continue;
    }
    if (m > IMPLAUSIBLE_SHIFT_MINUTES) {
      excludedImplausible++;
      continue;
    }
    const wi = weekIdx(p.day);
    if (wi < 0) continue;
    const map = p.kind === "work" ? work : brk;
    const arr = map.get(p.employeeId) ?? new Array(range.length).fill(0);
    arr[wi] += m;
    map.set(p.employeeId, arr);
    if (p.kind === "work") {
      const s = shifts.get(p.employeeId) ?? [];
      s.push(m);
      shifts.set(p.employeeId, s);
      const dw = daysWorked.get(p.employeeId) ?? new Set<string>();
      dw.add(p.day);
      daysWorked.set(p.employeeId, dw);
      weekdayMinutes[weekdayOf(p.day)] += m;
      // spread across clock hours (Pacific hour of each minute is approximated by UTC offset of the start)
      const startMs = Date.parse(p.clockInIso);
      const offsetMin = pacificOffsetGuess(p.day, p.clockInIso);
      for (let k = 0; k < m; k += 15) {
        const h = new Date(startMs + k * 60000 + offsetMin * 60000).getUTCHours();
        hourMinutes[h] += Math.min(15, m - k);
      }
    }
  }

  const flagsBy = new Map<string, StatsFlag[]>();
  for (const f of args.breakFlags) {
    if (!inRange(f.day)) continue;
    const l = flagsBy.get(f.employeeId) ?? [];
    l.push(f);
    flagsBy.set(f.employeeId, l);
  }

  const sickBal = new Map<string, number>();
  const sickUsed = new Map<string, number>();
  for (const r of args.sickLedger) {
    if (r.date > args.today) continue;
    sickBal.set(r.employeeId, (sickBal.get(r.employeeId) ?? 0) + r.minutes);
    if (r.kind === "usage" && inRange(r.date)) sickUsed.set(r.employeeId, (sickUsed.get(r.employeeId) ?? 0) + Math.abs(r.minutes));
  }

  const noRate: string[] = [];
  const employees: EmployeeStat[] = args.employees.map((e) => {
    const w = work.get(e.id) ?? new Array(range.length).fill(0);
    const total = w.reduce((s, x) => s + x, 0);
    const ot = otSplit ? w.reduce((s, x) => s + Math.max(0, x - OT_THRESHOLD_MINUTES), 0) : null;
    const worked = w.filter((x) => x > 0);
    const sh = shifts.get(e.id) ?? [];
    const dw = daysWorked.get(e.id)?.size ?? 0;
    const flagDays = new Set((flagsBy.get(e.id) ?? []).map((f) => f.day)).size;
    let est: number | null = null;
    if (e.rateMilliCents && e.rateMilliCents > 0) est = w.reduce((s, x) => s + estWages(x, otSplit ? Math.max(0, x - OT_THRESHOLD_MINUTES) : 0, e.rateMilliCents as number), 0);
    else if (total > 0) noRate.push(e.name);
    return {
      employeeId: e.id,
      name: e.name,
      workMinutes: total,
      overtimeMinutes: ot,
      weeksWorked: worked.length,
      avgWeekMinutes: worked.length ? Math.round(total / worked.length) : 0,
      maxWeekMinutes: Math.max(0, ...w),
      weeksOver40: w.filter((x) => x > OT_THRESHOLD_MINUTES).length,
      weeksNearOt: w.filter((x) => x >= NEAR_OT_MINUTES && x <= OT_THRESHOLD_MINUTES).length,
      shifts: sh.length,
      avgShiftMinutes: sh.length ? Math.round(sh.reduce((s, x) => s + x, 0) / sh.length) : 0,
      longShifts: sh.filter((x) => x > LONG_SHIFT_MINUTES).length,
      breakFlags: (flagsBy.get(e.id) ?? []).length,
      daysWorked: dw,
      breakCompliancePct: dw ? Math.round(((dw - Math.min(dw, flagDays)) / dw) * 1000) / 10 : null,
      estLaborCents: est,
      sickUsedMinutes: sickUsed.get(e.id) ?? 0,
      sickBalanceMinutes: sickBal.get(e.id) ?? 0,
      byWeek: w,
    };
  });

  const rateBy = new Map(args.employees.map((e) => [e.id, e.rateMilliCents]));
  const weeks: WeekStat[] = range.map((r, i) => {
    let wm = 0;
    let otm = 0;
    let est = 0;
    let n = 0;
    for (const [id, arr] of work) {
      const x = arr[i];
      if (x <= 0) continue;
      n++;
      wm += x;
      const o = otSplit ? Math.max(0, x - OT_THRESHOLD_MINUTES) : 0;
      otm += o;
      const rate = rateBy.get(id);
      if (rate && rate > 0) est += estWages(x, o, rate);
    }
    let bm = 0;
    for (const arr of brk.values()) bm += arr[i];
    let sc = 0;
    let fl = 0;
    for (const p of args.punches) if (p.kind === "work" && p.day >= r.startDate && p.day <= r.endDate) {
      const m = spanMinutes(p.clockInIso, p.clockOutIso);
      if (m !== null && m <= IMPLAUSIBLE_SHIFT_MINUTES) sc++;
    }
    for (const f of args.breakFlags) if (f.day >= r.startDate && f.day <= r.endDate) fl++;
    return { startDate: r.startDate, endDate: r.endDate, workMinutes: wm, overtimeMinutes: otSplit ? otm : null, breakMinutes: bm, employeesWorked: n, shifts: sc, estLaborCents: est, breakFlags: fl };
  });

  // Average per weekday over the range's occurrences of that weekday.
  const byWeekday = WD.map((label, wd) => ({ weekday: wd, label, avgMinutes: Math.round(weekdayMinutes[wd] / range.length) }));
  const byHour = hourMinutes.map((m, hour) => ({ hour, workerMinutes: Math.round(m / (range.length * 7)) }));

  const totalWork = weeks.reduce((s, w) => s + w.workMinutes, 0);
  const totalOt = otSplit ? weeks.reduce((s, w) => s + (w.overtimeMinutes ?? 0), 0) : null;
  const allShifts = [...shifts.values()].flat();
  const totDays = employees.reduce((s, e) => s + e.daysWorked, 0);
  let totFlagDays = 0;
  for (const e of args.employees) {
    const dw = daysWorked.get(e.id)?.size ?? 0;
    totFlagDays += Math.min(dw, new Set((flagsBy.get(e.id) ?? []).map((f) => f.day)).size);
  }

  return {
    weeks,
    employees: [...employees].sort((a, b) => b.workMinutes - a.workMinutes || a.name.localeCompare(b.name)),
    byWeekday,
    byHour,
    totals: {
      workMinutes: totalWork,
      overtimeMinutes: totalOt,
      overtimeSharePct: totalOt !== null && totalWork > 0 ? Math.round((totalOt / totalWork) * 1000) / 10 : null,
      estLaborCents: weeks.reduce((s, w) => s + w.estLaborCents, 0),
      avgShiftMinutes: allShifts.length ? Math.round(allShifts.reduce((s, x) => s + x, 0) / allShifts.length) : 0,
      breakCompliancePct: totDays ? Math.round(((totDays - totFlagDays) / totDays) * 1000) / 10 : null,
      excludedOpen,
      excludedImplausible,
      employeesNoRate: noRate,
      sickUsedMinutes: employees.reduce((s, e) => s + e.sickUsedMinutes, 0),
      sickBalanceMinutes: employees.reduce((s, e) => s + e.sickBalanceMinutes, 0),
    },
    otSplit,
  };
}

/**
 * Pacific UTC offset (minutes) at a clock-in, from the day key and the UTC
 * instant: the Pacific day is either the UTC day or the day before, and the
 * offset is -420 (PDT) or -480 (PST). Pure, no Intl.
 */
function pacificOffsetGuess(day: string, iso: string): number {
  const t = Date.parse(iso);
  for (const off of [-420, -480]) {
    const local = new Date(t + off * 60000);
    const key = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
    if (key === day) return dstOffset(t, off);
  }
  return -480;
}

/** US DST: second Sunday of March 2am to first Sunday of November 2am (local). */
function dstOffset(t: number, fallback: number): number {
  const y = new Date(t).getUTCFullYear();
  const nthSunday = (month: number, n: number) => {
    const d = new Date(Date.UTC(y, month, 1));
    const first = (7 - d.getUTCDay()) % 7;
    return Date.UTC(y, month, 1 + first + 7 * (n - 1));
  };
  const start = nthSunday(2, 2) + 10 * 3600000; // 2am PST = 10:00 UTC
  const end = nthSunday(10, 1) + 9 * 3600000; // 2am PDT = 09:00 UTC
  if (t >= start && t < end) return -420;
  if (Number.isFinite(t)) return -480;
  return fallback;
}

/* ═══════════════════════════════════════════════════════════════════════ *
 * SELF-TESTS
 * ═══════════════════════════════════════════════════════════════════════ */

export function __runPayrollStatsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`payroll-stats-core FAIL: ${name}`);
    }
  };

  ok("weekday Tue", weekdayOf("2026-11-17") === 2);
  ok("weekday Sun", weekdayOf("2026-11-15") === 0);
  ok("week start Sunday anchor", weekStartOf("2026-11-17", 0) === "2026-11-15");
  ok("week start Monday anchor", weekStartOf("2026-11-17", 1) === "2026-11-16");
  ok("week start on anchor day", weekStartOf("2026-11-15", 0) === "2026-11-15");
  ok("week start Saturday anchor", weekStartOf("2026-11-17", 6) === "2026-11-14");
  const wr = weekRange("2026-11-17", 0, 4);
  ok("range length", wr.length === 4);
  ok("range ends with current week", wr[3].startDate === "2026-11-15" && wr[3].endDate === "2026-11-21");
  ok("range oldest first", wr[0].startDate === "2026-10-25");
  ok("range clamps", weekRange("2026-11-17", 0, 500).length === 52 && weekRange("2026-11-17", 0, 0).length === 1);
  ok("est wages straight", estWages(60, 0, 2000000) === 2000);
  ok("est wages OT premium", estWages(120, 60, 2000000) === 4000 + 1000);

  // Pacific Nov (PST, -8): 16:00Z = 8:00 local
  const P = (id: string, day: string, inZ: string, outZ: string | null, kind: "work" | "break" = "work"): StatsPunch => ({ employeeId: id, kind, day, clockInIso: inZ, clockOutIso: outZ });
  const punches: StatsPunch[] = [];
  // e1: five 9h days in week of Nov 15 (45h -> 5h OT)
  for (const d of ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]) {
    punches.push(P("e1", d, `${d}T16:00:00Z`, new Date(Date.parse(`${d}T16:00:00Z`) + 9 * 3600000).toISOString()));
  }
  // e1 break 30m on the 16th
  punches.push(P("e1", "2026-11-16", "2026-11-16T20:00:00Z", "2026-11-16T20:30:00Z", "break"));
  // e2: one 6h day prior week, one open punch, one 30h punch
  punches.push(P("e2", "2026-11-10", "2026-11-10T17:00:00Z", "2026-11-10T23:00:00Z"));
  punches.push(P("e2", "2026-11-17", "2026-11-17T17:00:00Z", null));
  punches.push(P("e2", "2026-11-12", "2026-11-12T17:00:00Z", "2026-11-13T23:00:00Z"));
  // e3: out of range
  punches.push(P("e3", "2026-01-05", "2026-01-05T17:00:00Z", "2026-01-05T20:00:00Z"));

  const emps: StatsEmployee[] = [
    { id: "e1", name: "Alex", rateMilliCents: 2000000 },
    { id: "e2", name: "Bo", rateMilliCents: null },
    { id: "e3", name: "Cy", rateMilliCents: 1713000 },
  ];
  const s = computeStats({
    today: "2026-11-17",
    weeks: 4,
    workweekStartsOn: 0,
    employees: emps,
    punches,
    breakFlags: [{ employeeId: "e1", day: "2026-11-17" }, { employeeId: "e1", day: "2026-01-01" }],
    sickLedger: [
      { employeeId: "e1", kind: "accrual", minutes: 600, date: "2026-10-01" },
      { employeeId: "e1", kind: "usage", minutes: -120, date: "2026-11-02" },
      { employeeId: "e1", kind: "accrual", minutes: 60, date: "2026-12-01" },
    ],
  });
  const a = s.employees.find((e) => e.employeeId === "e1")!;
  const b = s.employees.find((e) => e.employeeId === "e2")!;
  const c = s.employees.find((e) => e.employeeId === "e3")!;
  ok("e1 total 45h", a.workMinutes === 45 * 60);
  ok("e1 OT 5h", a.overtimeMinutes === 300);
  ok("e1 weeks over 40", a.weeksOver40 === 1);
  ok("e1 shifts", a.shifts === 5 && a.avgShiftMinutes === 540);
  ok("e1 est wages", a.estLaborCents === estWages(2700, 300, 2000000));
  ok("e1 break flag in range only", a.breakFlags === 1);
  ok("e1 break compliance 80%", a.breakCompliancePct === 80);
  ok("e1 sick balance to date", a.sickBalanceMinutes === 480);
  ok("e1 sick used in range", a.sickUsedMinutes === 120);
  ok("e2 open + implausible excluded", s.totals.excludedOpen === 1 && s.totals.excludedImplausible === 1);
  ok("e2 only the 6h counts", b.workMinutes === 360);
  ok("e2 no rate listed", s.totals.employeesNoRate.includes("Bo") && b.estLaborCents === null);
  ok("e3 out of range zero", c.workMinutes === 0 && !s.totals.employeesNoRate.includes("Cy"));
  ok("sorted by hours", s.employees[0].employeeId === "e1");
  ok("week totals", s.weeks[3].workMinutes === 2700 && s.weeks[3].overtimeMinutes === 300 && s.weeks[2].workMinutes === 360);
  ok("week headcount", s.weeks[3].employeesWorked === 1 && s.weeks[2].employeesWorked === 1);
  ok("week break minutes", s.weeks[3].breakMinutes === 30);
  ok("week shifts", s.weeks[3].shifts === 5);
  ok("totals", s.totals.workMinutes === 3060 && s.totals.overtimeMinutes === 300);
  ok("OT share", s.totals.overtimeSharePct === Math.round((300 / 3060) * 1000) / 10);
  ok("byWeek aligned", a.byWeek.length === 4 && a.byWeek[3] === 2700);
  ok("weekday avg Mon", s.byWeekday[1].avgMinutes === Math.round(540 / 4));
  ok("hour profile 8am local present", s.byHour[8].workerMinutes > 0 && s.byHour[3].workerMinutes === 0);
  ok("hour profile pacific (16Z=8am not 16)", s.byHour[16].workerMinutes > 0 && s.byHour[17].workerMinutes === 0);

  const n = computeStats({ today: "2026-11-17", weeks: 4, workweekStartsOn: null, employees: emps, punches, breakFlags: [], sickLedger: [] });
  ok("no workweek: OT null", n.otSplit === false && n.totals.overtimeMinutes === null && n.employees[0].overtimeMinutes === null);
  ok("no workweek: est without premium", n.employees.find((e) => e.employeeId === "e1")!.estLaborCents === estWages(2700, 0, 2000000));
  ok("no workweek: hours still shown", n.totals.workMinutes === 3060);
  ok("store break compliance", s.totals.breakCompliancePct === Math.round(((6 - 1) / 6) * 1000) / 10);
  ok("empty input safe", computeStats({ today: "2026-11-17", weeks: 2, workweekStartsOn: 0, employees: [], punches: [], breakFlags: [], sickLedger: [] }).totals.breakCompliancePct === null);
  ok("DST summer offset", pacificOffsetGuess("2026-07-01", "2026-07-01T16:00:00Z") === -420);
  ok("winter offset", pacificOffsetGuess("2026-12-01", "2026-12-01T16:00:00Z") === -480);
  return { passed, failed };
}
