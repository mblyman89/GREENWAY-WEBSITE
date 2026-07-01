/**
 * src/lib/staffing/schedule-core.ts
 *
 * PURE, dependency-free logic for the weekly schedule builder (Slice 69,
 * item 4). Week math, time parsing, duration + coverage tallies, and shift
 * validation. No I/O — unit-testable via tsx. All calendar reasoning is in
 * Pacific wall-clock terms (the store converts to UTC on write).
 */

export type Hm = { h: number; m: number };

/** Parse "HH:MM" (24h) into {h,m}; returns null if invalid. */
export function parseHhmm(raw: string): Hm | null {
  const s = String(raw ?? "").trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

/** Format {h,m} as "H:MM AM/PM" for display. */
export function formatHm(hm: Hm): string {
  const h12 = ((hm.h + 11) % 12) + 1;
  const ampm = hm.h < 12 ? "AM" : "PM";
  return `${h12}:${String(hm.m).padStart(2, "0")} ${ampm}`;
}

/** Add N days to a YYYY-MM-DD string, returning YYYY-MM-DD (calendar math, UTC-safe). */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Day-of-week for a YMD: 0=Sunday … 6=Saturday. */
export function dowYmd(ymd: string): number {
  const [y, mo, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

/** The Monday (YMD) of the week containing the given YMD. */
export function mondayOf(ymd: string): string {
  const dow = dowYmd(ymd); // 0=Sun..6=Sat
  const backToMonday = (dow + 6) % 7; // Sun->6, Mon->0, Tue->1, ...
  return addDaysYmd(ymd, -backToMonday);
}

/** The 7 YMD strings Mon..Sun for the week starting at `mondayYmd`. */
export function weekDays(mondayYmd: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysYmd(mondayYmd, i));
}

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Short human label for a YMD, e.g. "Mon Jun 10". */
export function shortDayLabel(ymd: string): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${dows[dt.getUTCDay()]} ${months[dt.getUTCMonth()]} ${d}`;
}

/**
 * Shift duration in minutes for a Pacific-wall-clock start/end on the same day.
 * If end <= start it is treated as crossing midnight (adds 24h) — a common
 * closing shift.
 */
export function shiftDurationMinutes(start: Hm, end: Hm): number {
  const s = start.h * 60 + start.m;
  let e = end.h * 60 + end.m;
  if (e <= s) e += 24 * 60;
  return e - s;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export type ShiftDraft = {
  employeeId: string;
  businessDay: string; // YMD
  shiftRole: "sales" | "manager" | "lead" | "other";
  start: Hm;
  end: Hm;
  notes?: string | null;
};

export type ParsedShift =
  | { ok: true; value: ShiftDraft }
  | { ok: false; errors: string[] };

const ROLES = ["sales", "manager", "lead", "other"] as const;

export function parseShiftDraft(input: {
  employeeId: unknown;
  businessDay: unknown;
  shiftRole: unknown;
  start: unknown;
  end: unknown;
  notes?: unknown;
}): ParsedShift {
  const errors: string[] = [];
  const employeeId = String(input.employeeId ?? "").trim();
  if (employeeId === "") errors.push("Pick an employee.");

  const businessDay = String(input.businessDay ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDay)) errors.push("A valid day is required.");

  const roleRaw = String(input.shiftRole ?? "sales").trim();
  const shiftRole = (ROLES.includes(roleRaw as (typeof ROLES)[number]) ? roleRaw : "sales") as ShiftDraft["shiftRole"];

  const start = parseHhmm(String(input.start ?? ""));
  if (!start) errors.push("Start time must be HH:MM.");
  const end = parseHhmm(String(input.end ?? ""));
  if (!end) errors.push("End time must be HH:MM.");

  if (start && end && shiftDurationMinutes(start, end) < 15) {
    errors.push("A shift must be at least 15 minutes.");
  }
  if (start && end && shiftDurationMinutes(start, end) > 16 * 60) {
    errors.push("A shift can't be longer than 16 hours.");
  }

  const notes = String(input.notes ?? "").trim() || null;

  if (errors.length || !start || !end) return { ok: false, errors: errors.length ? errors : ["Invalid times."] };
  return { ok: true, value: { employeeId, businessDay, shiftRole, start, end, notes } };
}

// ---------------------------------------------------------------------------
// Coverage summary
// ---------------------------------------------------------------------------
export type CoverageCell = { count: number; minutes: number };

/**
 * Per-day coverage across a week: how many shifts + total scheduled minutes.
 * `shifts` are lightweight {businessDay, minutes} rows.
 */
export function weekCoverage(
  weekYmds: string[],
  shifts: { businessDay: string; minutes: number }[],
): Record<string, CoverageCell> {
  const map: Record<string, CoverageCell> = {};
  for (const ymd of weekYmds) map[ymd] = { count: 0, minutes: 0 };
  for (const s of shifts) {
    if (map[s.businessDay]) {
      map[s.businessDay].count += 1;
      map[s.businessDay].minutes += s.minutes;
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Tests (run via tsx)
// ---------------------------------------------------------------------------
export function __runScheduleCoreTests(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  };

  // parseHhmm
  assert(JSON.stringify(parseHhmm("09:30")) === JSON.stringify({ h: 9, m: 30 }), "parse 09:30");
  assert(parseHhmm("24:00") === null, "reject 24:00");
  assert(parseHhmm("9:5") === null, "reject 9:5");
  assert(formatHm({ h: 13, m: 5 }) === "1:05 PM", "format 1:05 PM");
  assert(formatHm({ h: 0, m: 0 }) === "12:00 AM", "format midnight");

  // date math
  assert(addDaysYmd("2024-06-10", 1) === "2024-06-11", "add day");
  assert(addDaysYmd("2024-02-28", 1) === "2024-02-29", "leap day");
  assert(addDaysYmd("2024-12-31", 1) === "2025-01-01", "year roll");
  assert(dowYmd("2024-06-10") === 1, "2024-06-10 is Monday");
  assert(mondayOf("2024-06-13") === "2024-06-10", "Thu -> Mon");
  assert(mondayOf("2024-06-16") === "2024-06-10", "Sun -> Mon");
  assert(mondayOf("2024-06-10") === "2024-06-10", "Mon -> Mon");
  const wk = weekDays("2024-06-10");
  assert(wk.length === 7 && wk[0] === "2024-06-10" && wk[6] === "2024-06-16", "week days");

  // duration
  assert(shiftDurationMinutes({ h: 9, m: 0 }, { h: 17, m: 0 }) === 480, "8h shift");
  assert(shiftDurationMinutes({ h: 22, m: 0 }, { h: 2, m: 0 }) === 240, "overnight 4h");
  assert(formatDuration(480) === "8h", "8h label");
  assert(formatDuration(510) === "8h 30m", "8h30 label");

  // shift validation
  const okShift = parseShiftDraft({
    employeeId: "e1",
    businessDay: "2024-06-10",
    shiftRole: "sales",
    start: "09:00",
    end: "17:00",
  });
  assert(okShift.ok && okShift.value.shiftRole === "sales", "valid shift");
  const badShift = parseShiftDraft({
    employeeId: "",
    businessDay: "nope",
    shiftRole: "sales",
    start: "09:00",
    end: "09:05",
  });
  assert(!badShift.ok, "bad shift rejected (no emp, bad day, too short)");

  // coverage
  const cov = weekCoverage(wk, [
    { businessDay: "2024-06-10", minutes: 480 },
    { businessDay: "2024-06-10", minutes: 300 },
    { businessDay: "2024-06-12", minutes: 240 },
  ]);
  assert(cov["2024-06-10"].count === 2 && cov["2024-06-10"].minutes === 780, "monday coverage");
  assert(cov["2024-06-11"].count === 0, "tuesday empty");

  console.log("schedule-core: ALL TESTS PASSED");
}
