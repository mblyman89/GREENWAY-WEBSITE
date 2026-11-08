/**
 * src/lib/staffing/break-clock-core.ts  (owner D211 · clock out for lunch or an "other" break)
 *
 * Owner (verbatim): "My employees told me they cannot clock out for a lunch break. The logic
 * currently requires them to close their drawer first. There needs to be an option to clock out
 * for lunch, or, for an “other” reason."
 *
 * PURE rules (zero I/O) shared by every clock surface (register, back-office time clock, phone,
 * Hours, reports, timesheets, night watch, cockpit):
 *   - the break reasons and their words;
 *   - validating a break request (Other needs a note);
 *   - the clock state machine (off / working / on break) and what each button does;
 *   - the Washington meal-break checks (WAC 296-126-092) that the reports and timesheets SHOW as
 *     flags. They never change pay on their own (standing rule 62d).
 *
 * Law, verified:
 *   WAC 296-126-092(1): a meal period of at least 30 minutes, starting no earlier than the 2nd
 *     hour and no later than the 5th hour of the shift; on the employer's time if the employee
 *     must stay on duty.
 *   WAC 296-126-092(2): no more than 5 consecutive hours worked without a meal period.
 *   WAC 296-126-092(4): a paid 10-minute rest period for every 4 hours worked (stays ON the clock,
 *     so it is not a clock-out reason here).
 *   29 CFR 785.18: rest periods of 5 to 20 minutes are paid work time.
 *   29 CFR 785.19: a bona fide meal period (fully relieved, ordinarily 30 minutes or more) is not.
 */
import { pacificDayKey } from "@/lib/reports/timezone";

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

export const BREAK_REASONS = ["lunch", "other"] as const;
export type BreakReason = (typeof BREAK_REASONS)[number];

export const BREAK_REASON_LABELS: Record<BreakReason, string> = {
  lunch: "Lunch",
  other: "Other",
};

export const BREAK_NOTE_MIN = 3;
export const BREAK_NOTE_MAX = 200;

/** Meal and rest thresholds (minutes), WAC 296-126-092 / 29 CFR 785.18. */
export const MEAL_MIN_MINUTES = 30;
export const MEAL_EARLIEST_START_MIN = 120; // 2nd hour
export const MEAL_LATEST_START_MIN = 300; // 5th hour
export const MAX_CONSECUTIVE_WORK_MIN = 300; // 5 hours
export const SHORT_BREAK_PAID_MAX_MIN = 20; // 785.18
/** A break still open after this many hours is flagged (night watch, Hours). */
export const LONG_OPEN_BREAK_HOURS = 3;

export function isBreakReason(v: unknown): v is BreakReason {
  return typeof v === "string" && (BREAK_REASONS as readonly string[]).includes(v);
}

export function breakReasonLabel(reason: string | null | undefined): string {
  return isBreakReason(reason) ? BREAK_REASON_LABELS[reason] : "Break";
}

/** "Lunch" or "Other: doctor called back". */
export function describeBreak(reason: string | null | undefined, note: string | null | undefined): string {
  const label = breakReasonLabel(reason);
  const n = (note ?? "").trim();
  return n ? `${label}: ${n}` : label;
}

export type BreakRequest = { reason: BreakReason; note: string | null };

/**
 * Validate what the employee chose. Lunch needs no note (one is kept if typed). Other needs a
 * short note so the manager knows why someone left the floor.
 */
export function parseBreakRequest(
  rawReason: unknown,
  rawNote: unknown,
): { ok: true; value: BreakRequest } | { ok: false; error: string } {
  const reason = typeof rawReason === "string" ? rawReason.trim().toLowerCase() : "";
  if (!isBreakReason(reason)) return { ok: false, error: "Pick a break reason: Lunch or Other." };
  const note = typeof rawNote === "string" ? rawNote.trim().replace(/\s+/g, " ") : "";
  if (note.length > BREAK_NOTE_MAX) {
    return { ok: false, error: `Keep the break note under ${BREAK_NOTE_MAX} characters.` };
  }
  if (reason === "other") {
    if (note.length < BREAK_NOTE_MIN) {
      return { ok: false, error: "Say why in a few words for an Other break (for example: doctor call, family pickup)." };
    }
    return { ok: true, value: { reason, note } };
  }
  if (note.length > 0 && note.length < BREAK_NOTE_MIN) {
    return { ok: false, error: `A break note needs at least ${BREAK_NOTE_MIN} characters, or leave it blank.` };
  }
  return { ok: true, value: { reason, note: note || null } };
}

// ---------------------------------------------------------------------------
// The clock state machine
// ---------------------------------------------------------------------------

export type ClockState = "off" | "working" | "on_break";
export type ClockIntent = "in" | "out" | "break" | "back";

/** Work out the state from the employee's open punch (if any). */
export function clockStateOf(open: { punch_kind: string } | null | undefined): ClockState {
  if (!open) return "off";
  return open.punch_kind === "break" ? "on_break" : "working";
}

export type ClockDecision =
  | { kind: "clock_in" }
  | { kind: "clock_out" }
  | { kind: "start_break" }
  | { kind: "end_break" }
  | { kind: "already"; message: string }
  | { kind: "refuse"; message: string };

/**
 * What a button press does. `intent` null = a plain PIN pad that toggles:
 *   off -> clock in; working -> full clock out (D84 guard applies); on break -> back from break.
 * "out" while on break is refused with words: come back first, then clock out (so the drawer
 * guard and the shift's last punch are both honest).
 */
export function decideClockAction(intent: ClockIntent | null, state: ClockState): ClockDecision {
  switch (intent) {
    case null:
      return state === "off" ? { kind: "clock_in" } : state === "working" ? { kind: "clock_out" } : { kind: "end_break" };
    case "in":
      if (state === "off") return { kind: "clock_in" };
      if (state === "on_break") return { kind: "end_break" };
      return { kind: "already", message: "already clocked in. Nothing changed." };
    case "out":
      if (state === "working") return { kind: "clock_out" };
      if (state === "on_break") {
        return { kind: "refuse", message: "is on a break. Tap Back from break first, then clock out at the end of the shift." };
      }
      return { kind: "already", message: "already clocked out. Nothing changed." };
    case "break":
      if (state === "working") return { kind: "start_break" };
      if (state === "on_break") return { kind: "already", message: "is already on a break. Nothing changed." };
      return { kind: "refuse", message: "is not clocked in, so there is no shift to take a break from. Clock in first." };
    case "back":
      if (state === "on_break") return { kind: "end_break" };
      if (state === "working") return { kind: "already", message: "is already back on the clock. Nothing changed." };
      return { kind: "refuse", message: "is not on a break. Clock in instead." };
  }
}

/** Success words for the banner, e.g. "Ana: out for Lunch at 12:02 PM." */
export function breakSuccessMessage(
  name: string,
  action: "break_start" | "break_end",
  reason: string | null | undefined,
  timeLabel: string,
): string {
  const at = timeLabel ? ` at ${timeLabel}` : "";
  if (action === "break_start") return `${name}: out for ${breakReasonLabel(reason)}${at}. Your drawer stays yours. Tap Back from break when you return.`;
  return `${name}: back from ${breakReasonLabel(reason).toLowerCase()}${at}. On the clock again.`;
}

/**
 * Back-office banner after a clock form posts (?clocked=<action>&who=<name>).
 * Unknown actions fall back to plain words so an old link never shows junk.
 */
export function clockedBannerText(action: string | null | undefined, who?: string | null): string {
  const name = who ? `${who} ` : "";
  switch (action) {
    case "in":
      return `${name}clocked IN.`;
    case "out":
      return `${name}clocked OUT.`;
    case "break_start":
      return `${name}is out on a break (off the clock). Clock in again when back.`;
    case "break_end":
      return `${name}is back from break and on the clock again.`;
    default:
      return `${name}clock updated.`;
  }
}

// ---------------------------------------------------------------------------
// Meal-break checks (WAC 296-126-092) and summaries
// ---------------------------------------------------------------------------

export type BreakPunch = {
  employeeId: string;
  kind: "work" | "break";
  reason: string | null;
  clockInIso: string;
  clockOutIso: string | null;
};

export type BreakFlagCode = "NO_MEAL_AFTER_5H" | "MEAL_UNDER_30" | "MEAL_LATE_START" | "SHORT_OTHER_BREAK" | "OPEN_BREAK";

export const BREAK_FLAG_TEXT: Record<BreakFlagCode, { label: string; rule: string }> = {
  NO_MEAL_AFTER_5H: {
    label: "Worked more than 5 hours in a row without a lunch",
    rule: "WAC 296-126-092(2): no more than 5 consecutive hours without a meal period.",
  },
  MEAL_UNDER_30: {
    label: "Lunch shorter than 30 minutes",
    rule: "WAC 296-126-092(1): a meal period is at least 30 minutes. A shorter one may be paid time (29 CFR 785.19).",
  },
  MEAL_LATE_START: {
    label: "Lunch started after the 5th hour",
    rule: "WAC 296-126-092(1): the meal period starts between the 2nd and 5th hour of the shift.",
  },
  SHORT_OTHER_BREAK: {
    label: "Other break of 20 minutes or less (unpaid here)",
    rule: "29 CFR 785.18: a rest period of 5 to 20 minutes is paid work time. Review whether it should be.",
  },
  OPEN_BREAK: {
    label: "Break never ended",
    rule: "A break punch with no end time. Close it on Hours with a reason so pay is right.",
  },
};

export type DayBreakFlag = { employeeId: string; day: string; code: BreakFlagCode; detail: string };

function mins(aIso: string, bIso: string): number {
  return Math.max(0, Math.round((Date.parse(bIso) - Date.parse(aIso)) / 60_000));
}

/**
 * Per employee, per Pacific day (by clock-in): the meal-break flags. Closed punches only for the
 * timing rules; an open break gets OPEN_BREAK. `nowIso` closes a still-running work punch for the
 * 5-hours check only when `includeOpenWork` is set (live screens), never for payroll.
 */
export function dayBreakFlags(punches: readonly BreakPunch[], opts: { nowIso?: string; includeOpenWork?: boolean } = {}): DayBreakFlag[] {
  const groups = new Map<string, BreakPunch[]>();
  for (const p of punches) {
    if (!Number.isFinite(Date.parse(p.clockInIso))) continue;
    const key = `${p.employeeId}|${pacificDayKey(p.clockInIso)}`;
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  const out: DayBreakFlag[] = [];
  for (const [key, list] of groups) {
    const [employeeId, day] = key.split("|") as [string, string];
    const sorted = [...list].sort((a, b) => Date.parse(a.clockInIso) - Date.parse(b.clockInIso));
    const firstIn = sorted[0]!.clockInIso;
    let run = 0;
    let longestRun = 0;
    let hadMeal = false;
    let lastEnd: string | null = null;
    for (const p of sorted) {
      const end = p.clockOutIso ?? (p.kind === "work" && opts.includeOpenWork && opts.nowIso ? opts.nowIso : null);
      if (p.kind === "break") {
        if (!p.clockOutIso) {
          out.push({ employeeId, day, code: "OPEN_BREAK", detail: `${breakReasonLabel(p.reason)} since ${p.clockInIso}` });
          continue;
        }
        const len = mins(p.clockInIso, p.clockOutIso);
        if (p.reason === "lunch") {
          const startAt = mins(firstIn, p.clockInIso);
          if (len < MEAL_MIN_MINUTES) out.push({ employeeId, day, code: "MEAL_UNDER_30", detail: `${len} min lunch` });
          if (startAt > MEAL_LATEST_START_MIN) out.push({ employeeId, day, code: "MEAL_LATE_START", detail: `lunch began ${Math.floor(startAt / 60)}h ${startAt % 60}m into the shift` });
          if (len >= MEAL_MIN_MINUTES) {
            hadMeal = true;
            longestRun = Math.max(longestRun, run);
            run = 0;
          }
        } else if (len <= SHORT_BREAK_PAID_MAX_MIN && len >= 5) {
          out.push({ employeeId, day, code: "SHORT_OTHER_BREAK", detail: `${len} min Other break` });
        }
        lastEnd = p.clockOutIso;
        continue;
      }
      if (!end) continue;
      // A gap between punches (not a recorded break) does not reset the run unless it is 30+ minutes.
      if (lastEnd && mins(lastEnd, p.clockInIso) >= MEAL_MIN_MINUTES) {
        longestRun = Math.max(longestRun, run);
        run = 0;
      }
      run += mins(p.clockInIso, end);
      lastEnd = end;
    }
    longestRun = Math.max(longestRun, run);
    if (longestRun > MAX_CONSECUTIVE_WORK_MIN) {
      out.push({
        employeeId,
        day,
        code: "NO_MEAL_AFTER_5H",
        detail: `${Math.floor(longestRun / 60)}h ${longestRun % 60}m worked in a row${hadMeal ? "" : " with no lunch"}`,
      });
    }
  }
  return out.sort((a, b) => (a.day === b.day ? a.employeeId.localeCompare(b.employeeId) : a.day.localeCompare(b.day)));
}

export type BreakSummary = {
  lunchCount: number;
  lunchMinutes: number;
  otherCount: number;
  otherMinutes: number;
  openBreaks: number;
};

export const EMPTY_BREAK_SUMMARY: BreakSummary = { lunchCount: 0, lunchMinutes: 0, otherCount: 0, otherMinutes: 0, openBreaks: 0 };

/** Break totals per employee (closed breaks count minutes; open ones are counted apart). */
export function summarizeBreaks(punches: readonly BreakPunch[]): Map<string, BreakSummary> {
  const out = new Map<string, BreakSummary>();
  for (const p of punches) {
    if (p.kind !== "break") continue;
    const s = out.get(p.employeeId) ?? { ...EMPTY_BREAK_SUMMARY };
    if (!p.clockOutIso) {
      s.openBreaks += 1;
    } else if (p.reason === "lunch") {
      s.lunchCount += 1;
      s.lunchMinutes += mins(p.clockInIso, p.clockOutIso);
    } else {
      s.otherCount += 1;
      s.otherMinutes += mins(p.clockInIso, p.clockOutIso);
    }
    out.set(p.employeeId, s);
  }
  return out;
}

/** True when a break has been open longer than LONG_OPEN_BREAK_HOURS. */
export function isLongOpenBreak(clockInIso: string, nowIso: string): boolean {
  return mins(clockInIso, nowIso) > LONG_OPEN_BREAK_HOURS * 60;
}

/** Postgres/PostgREST "column does not exist" for the 0348 columns -> plain words. */
export const BREAK_MIGRATION_MISSING =
  "Breaks need database migration 0348 (time punch breaks). Ask the owner to run it in Supabase; until then use a full clock-out.";

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runBreakClockCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`break-clock-core FAIL: ${msg}`);
    }
  };

  // reasons
  ok(isBreakReason("lunch") && isBreakReason("other"), "lunch and other are reasons");
  ok(!isBreakReason("rest") && !isBreakReason("") && !isBreakReason(null), "rest/blank/null are not");
  ok(breakReasonLabel("lunch") === "Lunch" && breakReasonLabel("x") === "Break", "labels");
  ok(describeBreak("other", " doctor ") === "Other: doctor", "describe with note");
  ok(describeBreak("lunch", null) === "Lunch", "describe without note");

  // parseBreakRequest
  const l = parseBreakRequest("lunch", "");
  ok(l.ok && l.value.reason === "lunch" && l.value.note === null, "lunch with no note ok");
  const l2 = parseBreakRequest(" LUNCH ", "  quick   bite ");
  ok(l2.ok && l2.value.note === "quick bite", "lunch note trimmed and collapsed");
  ok(!parseBreakRequest("lunch", "ab").ok, "lunch with a 2-char note refused");
  ok(!parseBreakRequest("other", "").ok, "other without a note refused");
  ok(!parseBreakRequest("other", "ab").ok, "other with a too-short note refused");
  const o = parseBreakRequest("other", "doctor call");
  ok(o.ok && o.value.reason === "other" && o.value.note === "doctor call", "other with a note ok");
  ok(!parseBreakRequest("other", "x".repeat(201)).ok, "note over 200 refused");
  ok(!parseBreakRequest("rest", "").ok, "rest is not a clock-out reason");
  ok(!parseBreakRequest(undefined, "").ok, "no reason refused");

  // state machine
  ok(clockStateOf(null) === "off", "no punch = off");
  ok(clockStateOf({ punch_kind: "work" }) === "working", "work = working");
  ok(clockStateOf({ punch_kind: "break" }) === "on_break", "break = on break");
  ok(decideClockAction(null, "off").kind === "clock_in", "pad off -> in");
  ok(decideClockAction(null, "working").kind === "clock_out", "pad working -> out");
  ok(decideClockAction(null, "on_break").kind === "end_break", "pad on break -> back");
  ok(decideClockAction("in", "on_break").kind === "end_break", "in while on break = back");
  ok(decideClockAction("in", "working").kind === "already", "in while working = already");
  ok(decideClockAction("out", "on_break").kind === "refuse", "out while on break refused");
  ok(decideClockAction("out", "off").kind === "already", "out while off = already");
  ok(decideClockAction("break", "working").kind === "start_break", "break while working");
  ok(decideClockAction("break", "on_break").kind === "already", "break while on break = already");
  ok(decideClockAction("break", "off").kind === "refuse", "break while off refused");
  ok(decideClockAction("back", "on_break").kind === "end_break", "back while on break");
  ok(decideClockAction("back", "working").kind === "already", "back while working = already");
  ok(decideClockAction("back", "off").kind === "refuse", "back while off refused");

  // messages
  ok(breakSuccessMessage("Ana", "break_start", "lunch", "12:02 PM").startsWith("Ana: out for Lunch at 12:02 PM."), "start words");
  ok(breakSuccessMessage("Ana", "break_end", "other", "").startsWith("Ana: back from other."), "end words");

  // meal flags. 2027-01-04 is winter (UTC-8): 17:00Z = 9:00 AM Pacific.
  const E = "e1";
  const at = (h: number, m = 0) => new Date(Date.UTC(2027, 0, 4, 17 + h, m)).toISOString();
  const good: BreakPunch[] = [
    { employeeId: E, kind: "work", reason: null, clockInIso: at(0), clockOutIso: at(4) },
    { employeeId: E, kind: "break", reason: "lunch", clockInIso: at(4), clockOutIso: at(4, 30) },
    { employeeId: E, kind: "work", reason: null, clockInIso: at(4, 30), clockOutIso: at(8, 30) },
  ];
  ok(dayBreakFlags(good).length === 0, "4h + 30m lunch + 4h = clean");
  const noMeal: BreakPunch[] = [{ employeeId: E, kind: "work", reason: null, clockInIso: at(0), clockOutIso: at(6) }];
  const f1 = dayBreakFlags(noMeal);
  ok(f1.length === 1 && f1[0]!.code === "NO_MEAL_AFTER_5H" && f1[0]!.day === "2027-01-04", "6h straight flagged");
  ok(dayBreakFlags([{ ...noMeal[0]!, clockOutIso: at(5) }]).length === 0, "exactly 5h is fine");
  const shortMeal: BreakPunch[] = [
    { employeeId: E, kind: "work", reason: null, clockInIso: at(0), clockOutIso: at(3) },
    { employeeId: E, kind: "break", reason: "lunch", clockInIso: at(3), clockOutIso: at(3, 20) },
    { employeeId: E, kind: "work", reason: null, clockInIso: at(3, 20), clockOutIso: at(6) },
  ];
  const f2 = dayBreakFlags(shortMeal).map((f) => f.code);
  ok(f2.includes("MEAL_UNDER_30"), "20 min lunch flagged");
  ok(f2.includes("NO_MEAL_AFTER_5H"), "a short lunch does not reset the 5h run");
  const late: BreakPunch[] = [
    { employeeId: E, kind: "work", reason: null, clockInIso: at(0), clockOutIso: at(5, 30) },
    { employeeId: E, kind: "break", reason: "lunch", clockInIso: at(5, 30), clockOutIso: at(6) },
    { employeeId: E, kind: "work", reason: null, clockInIso: at(6), clockOutIso: at(8) },
  ];
  const f3 = dayBreakFlags(late).map((f) => f.code);
  ok(f3.includes("MEAL_LATE_START") && f3.includes("NO_MEAL_AFTER_5H"), "lunch at 5h30 flagged twice");
  const other: BreakPunch[] = [
    { employeeId: E, kind: "work", reason: null, clockInIso: at(0), clockOutIso: at(2) },
    { employeeId: E, kind: "break", reason: "other", clockInIso: at(2), clockOutIso: at(2, 15) },
    { employeeId: E, kind: "work", reason: null, clockInIso: at(2, 15), clockOutIso: at(4) },
  ];
  ok(dayBreakFlags(other).map((f) => f.code).join() === "SHORT_OTHER_BREAK", "15 min other flagged as maybe-paid");
  const openB: BreakPunch[] = [
    { employeeId: E, kind: "work", reason: null, clockInIso: at(0), clockOutIso: at(2) },
    { employeeId: E, kind: "break", reason: "lunch", clockInIso: at(2), clockOutIso: null },
  ];
  ok(dayBreakFlags(openB).map((f) => f.code).join() === "OPEN_BREAK", "open break flagged");
  const live = dayBreakFlags([{ employeeId: E, kind: "work", reason: null, clockInIso: at(0), clockOutIso: null }], { nowIso: at(6), includeOpenWork: true });
  ok(live.length === 1 && live[0]!.code === "NO_MEAL_AFTER_5H", "live open work counted when asked");
  ok(dayBreakFlags([{ employeeId: E, kind: "work", reason: null, clockInIso: at(0), clockOutIso: null }], { nowIso: at(6) }).length === 0, "open work ignored for payroll");
  const gap: BreakPunch[] = [
    { employeeId: E, kind: "work", reason: null, clockInIso: at(0), clockOutIso: at(3) },
    { employeeId: E, kind: "work", reason: null, clockInIso: at(3, 45), clockOutIso: at(6, 45) },
  ];
  ok(dayBreakFlags(gap).length === 0, "an unrecorded 45 min gap splits the run");

  // summaries
  const sum = summarizeBreaks([...good, ...other.map((p) => ({ ...p, employeeId: "e2" })), ...openB.map((p) => ({ ...p, employeeId: "e3" }))]);
  ok(sum.get(E)?.lunchCount === 1 && sum.get(E)?.lunchMinutes === 30, "lunch summary");
  ok(sum.get("e2")?.otherCount === 1 && sum.get("e2")?.otherMinutes === 15, "other summary");
  ok(sum.get("e3")?.openBreaks === 1 && sum.get("e3")?.lunchCount === 0, "open break summary");
  ok(isLongOpenBreak(at(0), at(3, 1)) && !isLongOpenBreak(at(0), at(3)), "long open break at 3h");

  // back-office banner
  ok(clockedBannerText("in", "Ana") === "Ana clocked IN.", "banner in");
  ok(clockedBannerText("out") === "clocked OUT.", "banner out no name");
  ok(clockedBannerText("break_start", "Ana").includes("break"), "banner break start");
  ok(clockedBannerText("break_end", "Ana").includes("back from break"), "banner break end");
  ok(clockedBannerText("junk") === "clock updated.", "banner unknown");

  return { passed, failed };
}
