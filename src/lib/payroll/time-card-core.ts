/**
 * src/lib/payroll/time-card-core.ts   (D248 slice 2)
 *
 * THE TIME CARD: one employee, one pay period, laid out the way a payroll
 * clerk reads it - workweek by workweek, day by day, every punch, every
 * break, every flag, with regular / overtime / sick hours per week and for the
 * period.
 *
 * Owner (D248, verbatim excerpt): "I need a much better, more enterprise way of
 * managing time cards, adjustments, stats ... Sick time, breaks, overtime, total
 * hours per week, total per period ..."
 *
 * WHY A SECOND HOURS CALCULATION EXISTS AT ALL
 *
 * The pay engine (timesheet-core.computePeriodHours) is the authority for what
 * gets paid, and it REFUSES a whole employee when one punch is open. That is
 * right for pay and useless for a manager trying to find the bad punch. This
 * file therefore lays out the card even when the engine refuses, using the
 * same rules (WA / FLSA: 40 hours per fixed workweek, closed punches only,
 * break punches unpaid), and then CROSS-CHECKS itself against the engine
 * wherever the engine produced numbers. A disagreement is printed, never
 * resolved silently.
 *
 * Minutes, not hundredths: this file adds whole minutes so a day reads "7h 45m"
 * exactly as the punches say. The comparison to the engine (hundredths of an
 * hour, rounded per punch) allows the rounding difference and no more.
 *
 * PURE. No I/O. Self-tests at the bottom (__runTimeCardCoreTests), registered
 * in scripts/compliance/run-pure-selftests.ts. Never books, files or pays.
 */

import { addPacificDays } from "@/lib/reports/timezone";
import { daysBetweenDayKeys, splitIntoWorkweeks, type WeekdayIndex } from "@/lib/payroll/timesheet-core";

/* ═════════════════════════════════════════════════════════════════════════ *
 * TYPES
 * ═════════════════════════════════════════════════════════════════════════ */

/** One punch, already placed on its Pacific day by the store. */
export type CardPunch = {
  readonly id: string;
  readonly employeeId: string;
  readonly kind: "work" | "break";
  /** Pacific YYYY-MM-DD of the clock-in (the day the punch belongs to). */
  readonly day: string;
  readonly clockInIso: string;
  readonly clockOutIso: string | null;
  /** Pacific "YYYY-MM-DDTHH:mm" for edit inputs. */
  readonly inLocal: string;
  readonly outLocal: string;
  readonly source: string;
  readonly notes: string | null;
  readonly breakReason: string | null;
};

export type CardFlag = { readonly day: string; readonly code: string; readonly label: string; readonly detail: string };

export type CardDay = {
  readonly day: string;
  readonly punches: readonly CardPunch[];
  /** Closed work-punch minutes (paid time). */
  readonly workMinutes: number;
  /** Closed break-punch minutes (unpaid). */
  readonly breakMinutes: number;
  /** Sick leave taken that day (minutes, positive). */
  readonly sickMinutes: number;
  readonly hasOpenPunch: boolean;
  readonly edited: boolean;
  readonly flags: readonly CardFlag[];
};

export type CardWeek = {
  readonly index: number;
  readonly startDate: string;
  readonly endDate: string;
  readonly isPartial: boolean;
  readonly days: readonly CardDay[];
  readonly workMinutes: number;
  readonly regularMinutes: number;
  readonly overtimeMinutes: number;
  readonly breakMinutes: number;
  readonly sickMinutes: number;
};

export type ExceptionCode =
  | "OPEN_PUNCH"
  | "LONG_SHIFT"
  | "BREAK_FLAG"
  | "OVERTIME"
  | "NEAR_OVERTIME"
  | "PARTIAL_WEEK"
  | "EDITED"
  | "ENGINE_REFUSED"
  | "ENGINE_MISMATCH"
  | "NO_RATE";

export type CardException = {
  readonly code: ExceptionCode;
  readonly severity: "block" | "warn" | "info";
  readonly message: string;
  readonly day?: string;
};

export type TimeCard = {
  readonly employeeId: string;
  readonly fullName: string;
  /** null when the workweek is not set: hours are shown, OT is not split. */
  readonly weeks: readonly CardWeek[] | null;
  /** Used when weeks is null: the days in date order. */
  readonly days: readonly CardDay[];
  readonly workMinutes: number;
  readonly regularMinutes: number | null;
  readonly overtimeMinutes: number | null;
  readonly breakMinutes: number;
  readonly sickMinutes: number;
  readonly daysWorked: number;
  readonly punchCount: number;
  readonly editedCount: number;
  readonly exceptions: readonly CardException[];
  /** "ready" = nothing blocks pay; "attention" = warnings; "blocked" = pay cannot be computed. */
  readonly status: "ready" | "attention" | "blocked" | "no_hours";
};

/** What the pay engine said about this employee, when it was run. */
export type EngineView =
  | { readonly kind: "not_run" }
  | { readonly kind: "refused"; readonly messages: readonly string[] }
  | {
      readonly kind: "computed";
      readonly regularHundredthHours: number;
      readonly overtimeHundredthHours: number;
      readonly grossCents: number;
    };

/* ═════════════════════════════════════════════════════════════════════════ *
 * CONSTANTS
 * ═════════════════════════════════════════════════════════════════════════ */

/** WA / FLSA weekly threshold, in minutes (RCW 49.46.130, 29 CFR 778.104). */
export const OT_THRESHOLD_MINUTES = 40 * 60;
/** "Getting close" warning at 36 hours in a workweek. */
export const NEAR_OT_MINUTES = 36 * 60;
/** A single work punch longer than this is probably a missed clock-out. */
export const LONG_SHIFT_MINUTES = 12 * 60;

/* ═════════════════════════════════════════════════════════════════════════ *
 * HELPERS
 * ═════════════════════════════════════════════════════════════════════════ */

/** Closed-span minutes from timestamps; null when open or unparseable or negative. */
export function spanMinutes(inIso: string, outIso: string | null): number | null {
  if (!outIso) return null;
  const a = Date.parse(inIso);
  const b = Date.parse(outIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 60_000);
}

/** Every Pacific day key from start to end inclusive (bounded at 62 days). */
export function dayKeysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let d = start;
  for (let i = 0; i < 62 && daysBetweenDayKeys(d, end) >= 0; i += 1) {
    out.push(d);
    d = addPacificDays(d, 1);
  }
  return out;
}

/** "7h 45m", "8h", "45m", "0h". */
export function fmtMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0 && r === 0) return "0h";
  if (h === 0) return `${r}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

/** Decimal hours to two places, the way Sage shows them: 465 -> "7.75". */
export function decimalHours(min: number): string {
  return (Math.round((min / 60) * 100) / 100).toFixed(2);
}

/** Hundredths of an hour to minutes (for the engine cross-check). */
export function hundredthsToMinutes(h: number): number {
  return Math.round((h * 60) / 100);
}

/* ═════════════════════════════════════════════════════════════════════════ *
 * BUILD ONE CARD
 * ═════════════════════════════════════════════════════════════════════════ */

function buildDay(
  day: string,
  punches: readonly CardPunch[],
  flags: readonly CardFlag[],
  sickMinutes: number,
): CardDay {
  let work = 0;
  let brk = 0;
  let open = false;
  let edited = false;
  for (const p of punches) {
    const m = spanMinutes(p.clockInIso, p.clockOutIso);
    if (m === null) open = true;
    else if (p.kind === "work") work += m;
    else brk += m;
    if (p.source === "manager_edit") edited = true;
  }
  return {
    day,
    punches: [...punches].sort((a, b) => Date.parse(a.clockInIso) - Date.parse(b.clockInIso)),
    workMinutes: work,
    breakMinutes: brk,
    sickMinutes: Math.max(0, sickMinutes),
    hasOpenPunch: open,
    edited,
    flags,
  };
}

/**
 * Lay out one employee's card for a period.
 *
 * `workweekStartsOn` null means nobody chose the workweek: the days and totals
 * still show, but regular/overtime is NOT split (that would be a guess).
 */
export function buildTimeCard(args: {
  employeeId: string;
  fullName: string;
  startDate: string;
  endDate: string;
  workweekStartsOn: WeekdayIndex | null;
  punches: readonly CardPunch[];
  breakFlags?: readonly CardFlag[];
  /** Sick usage by Pacific day, minutes positive. */
  sickByDay?: Readonly<Record<string, number>>;
  engine?: EngineView;
  hasHourlyRate?: boolean;
}): TimeCard {
  const mine = args.punches.filter((p) => p.employeeId === args.employeeId);
  const keys = dayKeysBetween(args.startDate, args.endDate);
  const sick = args.sickByDay ?? {};
  const flagList = args.breakFlags ?? [];
  const days = keys.map((k) =>
    buildDay(
      k,
      mine.filter((p) => p.day === k),
      flagList.filter((f) => f.day === k),
      sick[k] ?? 0,
    ),
  );

  let weeks: CardWeek[] | null = null;
  if (args.workweekStartsOn !== null) {
    weeks = splitIntoWorkweeks({ startDate: args.startDate, endDate: args.endDate }, args.workweekStartsOn).map(
      (seg, i) => {
        const wd = days.filter(
          (d) => daysBetweenDayKeys(seg.startDate, d.day) >= 0 && daysBetweenDayKeys(d.day, seg.endDate) >= 0,
        );
        const work = wd.reduce((s, d) => s + d.workMinutes, 0);
        const ot = Math.max(0, work - OT_THRESHOLD_MINUTES);
        return {
          index: i + 1,
          startDate: seg.startDate,
          endDate: seg.endDate,
          isPartial: seg.isPartial,
          days: wd,
          workMinutes: work,
          regularMinutes: work - ot,
          overtimeMinutes: ot,
          breakMinutes: wd.reduce((s, d) => s + d.breakMinutes, 0),
          sickMinutes: wd.reduce((s, d) => s + d.sickMinutes, 0),
        };
      },
    );
  }

  const workMinutes = days.reduce((s, d) => s + d.workMinutes, 0);
  const overtimeMinutes = weeks ? weeks.reduce((s, w) => s + w.overtimeMinutes, 0) : null;
  const regularMinutes = overtimeMinutes === null ? null : workMinutes - overtimeMinutes;

  const ex: CardException[] = [];
  for (const d of days) {
    for (const p of d.punches) {
      const m = spanMinutes(p.clockInIso, p.clockOutIso);
      if (m === null) {
        ex.push({
          code: "OPEN_PUNCH",
          severity: "block",
          day: d.day,
          message: `${p.kind === "break" ? "A break" : "A work punch"} on ${d.day} has no clock-out. Pay cannot be computed until it is closed.`,
        });
      } else if (p.kind === "work" && m > LONG_SHIFT_MINUTES) {
        ex.push({
          code: "LONG_SHIFT",
          severity: "warn",
          day: d.day,
          message: `A ${fmtMinutes(m)} work punch on ${d.day} - longer than 12 hours, likely a missed clock-out.`,
        });
      }
    }
    for (const f of d.flags) {
      ex.push({ code: "BREAK_FLAG", severity: "warn", day: d.day, message: `${f.label} (${f.detail}).` });
    }
  }
  if (weeks) {
    for (const w of weeks) {
      if (w.overtimeMinutes > 0) {
        ex.push({
          code: "OVERTIME",
          severity: "info",
          message: `Workweek ${w.index} (${w.startDate} to ${w.endDate}): ${decimalHours(w.overtimeMinutes)} overtime hours at 1.5x.`,
        });
      } else if (w.workMinutes >= NEAR_OT_MINUTES) {
        ex.push({
          code: "NEAR_OVERTIME",
          severity: "info",
          message: `Workweek ${w.index}: ${decimalHours(w.workMinutes)} hours - within 4 hours of overtime.`,
        });
      }
      if (w.isPartial && w.workMinutes > 0) {
        ex.push({
          code: "PARTIAL_WEEK",
          severity: "warn",
          message: `Workweek ${w.index} is cut by the pay period edge (${w.startDate} to ${w.endDate}). Overtime counts the WHOLE workweek, so hours in the neighbouring period matter.`,
        });
      }
    }
  }
  const editedCount = mine.filter((p) => p.source === "manager_edit").length;
  if (editedCount > 0) {
    ex.push({ code: "EDITED", severity: "info", message: `${editedCount} punch(es) were entered or changed by a manager (reason on file).` });
  }
  if (args.hasHourlyRate === false && workMinutes > 0) {
    ex.push({ code: "NO_RATE", severity: "block", message: "Hours were worked but there is no current hourly rate on file, so gross pay cannot be computed." });
  }
  const engine = args.engine ?? { kind: "not_run" as const };
  if (engine.kind === "refused") {
    for (const m of engine.messages) ex.push({ code: "ENGINE_REFUSED", severity: "block", message: m });
  } else if (engine.kind === "computed" && regularMinutes !== null && overtimeMinutes !== null) {
    // The engine rounds each punch to hundredths of an hour (0.6 min); allow
    // half a minute per punch plus one of slack and nothing more.
    const tol = Math.ceil(mine.length * 0.5) + 1;
    const eReg = hundredthsToMinutes(engine.regularHundredthHours);
    const eOt = hundredthsToMinutes(engine.overtimeHundredthHours);
    if (Math.abs(eReg - regularMinutes) > tol || Math.abs(eOt - overtimeMinutes) > tol) {
      ex.push({
        code: "ENGINE_MISMATCH",
        severity: "warn",
        message: `The pay engine says ${decimalHours(eReg)} regular / ${decimalHours(eOt)} OT; this card adds up to ${decimalHours(regularMinutes)} / ${decimalHours(overtimeMinutes)}. Pay uses the engine's numbers; check the punches.`,
      });
    }
  }

  const blocked = ex.some((e) => e.severity === "block");
  const warn = ex.some((e) => e.severity === "warn");
  const punchCount = mine.length;
  const status: TimeCard["status"] = blocked
    ? "blocked"
    : punchCount === 0 && days.every((d) => d.sickMinutes === 0)
      ? "no_hours"
      : warn
        ? "attention"
        : "ready";

  return {
    employeeId: args.employeeId,
    fullName: args.fullName,
    weeks,
    days,
    workMinutes,
    regularMinutes,
    overtimeMinutes,
    breakMinutes: days.reduce((s, d) => s + d.breakMinutes, 0),
    sickMinutes: days.reduce((s, d) => s + d.sickMinutes, 0),
    daysWorked: days.filter((d) => d.workMinutes > 0 || d.hasOpenPunch).length,
    punchCount,
    editedCount,
    exceptions: ex,
    status,
  };
}

/* ═════════════════════════════════════════════════════════════════════════ *
 * PERIOD ROLL-UP
 * ═════════════════════════════════════════════════════════════════════════ */

export type PeriodRollup = {
  readonly employees: number;
  readonly withHours: number;
  readonly ready: number;
  readonly attention: number;
  readonly blocked: number;
  readonly workMinutes: number;
  readonly regularMinutes: number | null;
  readonly overtimeMinutes: number | null;
  readonly breakMinutes: number;
  readonly sickMinutes: number;
  readonly breakFlagCount: number;
  readonly openPunchCount: number;
  readonly editedCount: number;
  /** Hours worked per day across everybody, for the bar chart. */
  readonly byDay: readonly { day: string; workMinutes: number }[];
  /** True only when every employee with hours is "ready" or "attention". */
  readonly canApprove: boolean;
};

export function rollUp(cards: readonly TimeCard[]): PeriodRollup {
  const withH = cards.filter((c) => c.status !== "no_hours");
  const anyNull = cards.some((c) => c.overtimeMinutes === null);
  const dayMap = new Map<string, number>();
  for (const c of cards) for (const d of c.days) dayMap.set(d.day, (dayMap.get(d.day) ?? 0) + d.workMinutes);
  const blocked = cards.filter((c) => c.status === "blocked").length;
  return {
    employees: cards.length,
    withHours: withH.length,
    ready: cards.filter((c) => c.status === "ready").length,
    attention: cards.filter((c) => c.status === "attention").length,
    blocked,
    workMinutes: cards.reduce((s, c) => s + c.workMinutes, 0),
    regularMinutes: anyNull ? null : cards.reduce((s, c) => s + (c.regularMinutes ?? 0), 0),
    overtimeMinutes: anyNull ? null : cards.reduce((s, c) => s + (c.overtimeMinutes ?? 0), 0),
    breakMinutes: cards.reduce((s, c) => s + c.breakMinutes, 0),
    sickMinutes: cards.reduce((s, c) => s + c.sickMinutes, 0),
    breakFlagCount: cards.reduce((s, c) => s + c.exceptions.filter((e) => e.code === "BREAK_FLAG").length, 0),
    openPunchCount: cards.reduce((s, c) => s + c.exceptions.filter((e) => e.code === "OPEN_PUNCH").length, 0),
    editedCount: cards.reduce((s, c) => s + c.editedCount, 0),
    byDay: [...dayMap.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, workMinutes]) => ({ day, workMinutes })),
    canApprove: blocked === 0 && !anyNull && withH.length > 0,
  };
}

/** Sort for the board: blocked first, then attention, ready, no hours; then name. */
export function sortCards(cards: readonly TimeCard[]): TimeCard[] {
  const rank: Record<TimeCard["status"], number> = { blocked: 0, attention: 1, ready: 2, no_hours: 3 };
  return [...cards].sort((a, b) => rank[a.status] - rank[b.status] || a.fullName.localeCompare(b.fullName));
}

/* ═════════════════════════════════════════════════════════════════════════ *
 * SELF-TESTS
 * ═════════════════════════════════════════════════════════════════════════ */

export function __runTimeCardCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ time-card-core: ${m}`);
    }
  };

  // Helpers.
  ok(spanMinutes("2026-11-02T16:00:00Z", "2026-11-03T00:00:00Z") === 480, "span 8h");
  ok(spanMinutes("2026-11-02T16:00:00Z", null) === null, "open span null");
  ok(spanMinutes("2026-11-02T16:00:00Z", "2026-11-02T15:00:00Z") === null, "negative span null");
  ok(dayKeysBetween("2026-11-01", "2026-11-14").length === 14, "14 days");
  ok(dayKeysBetween("2026-11-01", "2026-11-01").length === 1, "1 day");
  ok(dayKeysBetween("2026-11-02", "2026-11-01").length === 0, "reversed 0");
  ok(fmtMinutes(465) === "7h 45m" && fmtMinutes(480) === "8h" && fmtMinutes(45) === "45m" && fmtMinutes(0) === "0h", "fmtMinutes");
  ok(decimalHours(465) === "7.75" && decimalHours(2700) === "45.00", "decimalHours");
  ok(hundredthsToMinutes(775) === 465, "hundredths->minutes");

  // Build: Sunday workweek, Nov 1-14 2026 (Nov 1 is a Sunday).
  const P = (id: string, day: string, inZ: string, outZ: string | null, kind: "work" | "break" = "work", source = "web"): CardPunch => ({
    id,
    employeeId: "e1",
    kind,
    day,
    clockInIso: inZ,
    clockOutIso: outZ,
    inLocal: "",
    outLocal: "",
    source,
    notes: null,
    breakReason: kind === "break" ? "lunch" : null,
  });
  // Week 1: five 9h days Mon-Fri = 45h -> 5h OT. One 30m lunch on Monday.
  const w1: CardPunch[] = [];
  for (let i = 0; i < 5; i += 1) {
    const d = `2026-11-0${2 + i}`;
    w1.push(P(`a${i}`, d, `${d}T16:00:00Z`, `${d}T23:00:00Z`));
    w1.push(P(`b${i}`, d, `${d}T23:30:00Z`, `${d.slice(0, 8)}0${3 + i}T01:30:00Z`));
  }
  w1.push(P("L", "2026-11-02", "2026-11-02T23:00:00Z", "2026-11-02T23:30:00Z", "break"));
  // Week 2: Mon 8h edited.
  const w2 = [P("c1", "2026-11-09", "2026-11-09T16:00:00Z", "2026-11-10T00:00:00Z", "work", "manager_edit")];
  const card = buildTimeCard({
    employeeId: "e1",
    fullName: "Pat",
    startDate: "2026-11-01",
    endDate: "2026-11-14",
    workweekStartsOn: 0,
    punches: [...w1, ...w2, { ...P("x", "2026-11-03", "2026-11-03T16:00:00Z", null), employeeId: "OTHER" }],
    sickByDay: { "2026-11-10": 240 },
  });
  ok(card.weeks !== null && card.weeks.length === 2, "two full weeks");
  ok(card.weeks![0].workMinutes === 45 * 60, "week1 45h");
  ok(card.weeks![0].overtimeMinutes === 300 && card.weeks![0].regularMinutes === 2400, "week1 5h OT");
  ok(card.weeks![0].breakMinutes === 30, "week1 30m break");
  ok(card.weeks![1].workMinutes === 480 && card.weeks![1].overtimeMinutes === 0, "week2 8h no OT");
  ok(card.weeks![1].sickMinutes === 240 && card.sickMinutes === 240, "sick 4h");
  ok(card.workMinutes === 53 * 60 && card.regularMinutes === 48 * 60 && card.overtimeMinutes === 300, "period totals");
  ok(card.punchCount === 12, "other employee's punch excluded");
  ok(card.daysWorked === 6, "6 days worked");
  ok(card.editedCount === 1 && card.exceptions.some((e) => e.code === "EDITED"), "edited counted");
  ok(card.exceptions.some((e) => e.code === "OVERTIME"), "OT info");
  ok(card.status === "ready", `ready (got ${card.status})`);
  ok(card.days.find((d) => d.day === "2026-11-02")!.punches[0].id === "a0", "punches sorted by time");
  ok(card.days.find((d) => d.day === "2026-11-09")!.edited, "day edited flag");

  // Open punch blocks; long shift warns.
  const open = buildTimeCard({
    employeeId: "e1",
    fullName: "Pat",
    startDate: "2026-11-01",
    endDate: "2026-11-14",
    workweekStartsOn: 0,
    punches: [P("o", "2026-11-03", "2026-11-03T16:00:00Z", null), P("l", "2026-11-04", "2026-11-04T10:00:00Z", "2026-11-05T00:00:00Z")],
  });
  ok(open.status === "blocked", "open punch blocks");
  ok(open.exceptions.some((e) => e.code === "OPEN_PUNCH" && e.day === "2026-11-03"), "open punch day");
  ok(open.exceptions.some((e) => e.code === "LONG_SHIFT"), "14h shift warns");
  ok(open.days.find((d) => d.day === "2026-11-03")!.hasOpenPunch, "day open flag");
  ok(open.workMinutes === 14 * 60, "open punch not counted");

  // No workweek: no OT split, no guess.
  const nw = buildTimeCard({ employeeId: "e1", fullName: "Pat", startDate: "2026-11-01", endDate: "2026-11-14", workweekStartsOn: null, punches: w1 });
  ok(nw.weeks === null && nw.overtimeMinutes === null && nw.regularMinutes === null, "no workweek -> no OT split");
  ok(nw.workMinutes === 45 * 60, "hours still shown");

  // Near OT (37h) and partial week (Wed anchor on a Sun-Sat period).
  const near: CardPunch[] = [];
  for (let i = 0; i < 4; i += 1) {
    const d = `2026-11-0${2 + i}`;
    near.push(P(`n${i}`, d, `${d}T14:00:00Z`, `${d}T23:15:00Z`));
  }
  const nc = buildTimeCard({ employeeId: "e1", fullName: "Pat", startDate: "2026-11-01", endDate: "2026-11-14", workweekStartsOn: 0, punches: near });
  ok(nc.exceptions.some((e) => e.code === "NEAR_OVERTIME"), "near OT at 37h");
  const pc = buildTimeCard({ employeeId: "e1", fullName: "Pat", startDate: "2026-11-01", endDate: "2026-11-14", workweekStartsOn: 3, punches: near });
  ok(pc.weeks!.length === 3 && pc.weeks![0].isPartial, "Wed anchor -> 3 segments");
  ok(pc.exceptions.some((e) => e.code === "PARTIAL_WEEK"), "partial week warned");
  ok(pc.status === "attention", "partial -> attention");

  // Break flags flow through as warnings on the right day.
  const fc = buildTimeCard({
    employeeId: "e1",
    fullName: "Pat",
    startDate: "2026-11-01",
    endDate: "2026-11-14",
    workweekStartsOn: 0,
    punches: w2,
    breakFlags: [{ day: "2026-11-09", code: "NO_MEAL_AFTER_5H", label: "No lunch", detail: "8h" }],
  });
  ok(fc.days.find((d) => d.day === "2026-11-09")!.flags.length === 1, "flag on day");
  ok(fc.status === "attention" && fc.exceptions.some((e) => e.code === "BREAK_FLAG"), "flag -> attention");

  // Engine cross-check.
  const agree = buildTimeCard({
    employeeId: "e1", fullName: "Pat", startDate: "2026-11-01", endDate: "2026-11-14", workweekStartsOn: 0, punches: w1,
    engine: { kind: "computed", regularHundredthHours: 4000, overtimeHundredthHours: 500, grossCents: 1 },
  });
  ok(!agree.exceptions.some((e) => e.code === "ENGINE_MISMATCH"), "engine agrees");
  const disagree = buildTimeCard({
    employeeId: "e1", fullName: "Pat", startDate: "2026-11-01", endDate: "2026-11-14", workweekStartsOn: 0, punches: w1,
    engine: { kind: "computed", regularHundredthHours: 4000, overtimeHundredthHours: 300, grossCents: 1 },
  });
  ok(disagree.exceptions.some((e) => e.code === "ENGINE_MISMATCH"), "engine mismatch printed");
  const refused = buildTimeCard({
    employeeId: "e1", fullName: "Pat", startDate: "2026-11-01", endDate: "2026-11-14", workweekStartsOn: 0, punches: w1,
    engine: { kind: "refused", messages: ["No hourly rate."] },
  });
  ok(refused.status === "blocked", "engine refusal blocks");
  const norate = buildTimeCard({ employeeId: "e1", fullName: "Pat", startDate: "2026-11-01", endDate: "2026-11-14", workweekStartsOn: 0, punches: w2, hasHourlyRate: false });
  ok(norate.status === "blocked" && norate.exceptions.some((e) => e.code === "NO_RATE"), "no rate blocks");

  // Empty card.
  const empty = buildTimeCard({ employeeId: "e2", fullName: "Zed", startDate: "2026-11-01", endDate: "2026-11-14", workweekStartsOn: 0, punches: w1 });
  ok(empty.status === "no_hours" && empty.workMinutes === 0, "no hours");
  const sickOnly = buildTimeCard({ employeeId: "e2", fullName: "Zed", startDate: "2026-11-01", endDate: "2026-11-14", workweekStartsOn: 0, punches: [], sickByDay: { "2026-11-03": 480 } });
  ok(sickOnly.status === "ready" && sickOnly.sickMinutes === 480, "sick-only card is ready");

  // Roll-up.
  const r = rollUp([card, open, empty]);
  ok(r.employees === 3 && r.withHours === 2 && r.blocked === 1 && r.ready === 1, "rollup counts");
  ok(r.workMinutes === card.workMinutes + open.workMinutes, "rollup minutes");
  ok(r.openPunchCount === 1, "rollup open punches");
  ok(!r.canApprove, "blocked -> cannot approve");
  ok(rollUp([card, empty]).canApprove, "clean -> can approve");
  ok(!rollUp([nw]).canApprove && rollUp([nw]).overtimeMinutes === null, "no workweek -> cannot approve, OT null");
  ok(!rollUp([empty]).canApprove, "nobody worked -> nothing to approve");
  ok(r.byDay.length === 14 && r.byDay[0].day === "2026-11-01", "byDay 14 days sorted");
  ok(r.byDay.find((d) => d.day === "2026-11-02")!.workMinutes === 540, "byDay Monday 9h");
  const sorted = sortCards([empty, card, open]);
  ok(sorted[0] === open && sorted[1] === card && sorted[2] === empty, "sort blocked first");

  return { passed, failed };
}
