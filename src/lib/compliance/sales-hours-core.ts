/**
 * src/lib/compliance/sales-hours-core.ts  (S-12)
 *
 * PURE sales-hours logic for the WAC 314-55-147 gate. No server-only imports —
 * unit-testable with tsx.
 *
 * WAC 314-55-147: a retailer may sell cannabis only between 8:00 a.m. and
 * 12:00 a.m. (midnight). Those are STATUTORY bounds on the STORE's wall clock
 * (America/Los_Angeles — Port Orchard, WA). The owner may configure a TIGHTER
 * window (e.g. actual store hours 9:00–21:00) but can never widen past the
 * statute; normalizeSalesHoursWindow clamps any configured value into the
 * statutory range.
 *
 * All times are minutes-after-midnight on the Pacific wall clock:
 *   statutory open  = 480   (8:00 AM)
 *   statutory close = 1440  (midnight — exclusive upper bound)
 */
import { pacificParts } from "@/lib/reports/timezone";

/** Statutory earliest sale time: 8:00 AM Pacific (WAC 314-55-147). */
export const STATUTORY_OPEN_MINUTES = 8 * 60; // 480
/** Statutory latest sale time: midnight Pacific, exclusive (WAC 314-55-147). */
export const STATUTORY_CLOSE_MINUTES = 24 * 60; // 1440

export type SalesHoursWindow = {
  /** Minutes after Pacific midnight when sales may start (>= 480). */
  openMinutes: number;
  /** Minutes after Pacific midnight when sales must stop, exclusive (<= 1440). */
  closeMinutes: number;
};

/** The widest legal window — the default when the owner has not tightened it. */
export const DEFAULT_SALES_HOURS: SalesHoursWindow = {
  openMinutes: STATUTORY_OPEN_MINUTES,
  closeMinutes: STATUTORY_CLOSE_MINUTES,
};

/**
 * Normalize an untrusted (DB/form) value into a valid window. Guarantees:
 * statutory clamp (can tighten, never widen), integers, open < close. Any
 * nonsense collapses to the statutory default.
 */
export function normalizeSalesHoursWindow(raw: unknown): SalesHoursWindow {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) ? Math.round(n) : fallback;
  };
  let open = num(r.openMinutes, STATUTORY_OPEN_MINUTES);
  let close = num(r.closeMinutes, STATUTORY_CLOSE_MINUTES);
  // Clamp INTO the statutory window (tighter is allowed; wider is not).
  open = Math.min(Math.max(open, STATUTORY_OPEN_MINUTES), STATUTORY_CLOSE_MINUTES);
  close = Math.min(Math.max(close, STATUTORY_OPEN_MINUTES), STATUTORY_CLOSE_MINUTES);
  if (open >= close) return { ...DEFAULT_SALES_HOURS };
  return { openMinutes: open, closeMinutes: close };
}

/** Parse "HH:MM" (24h) into minutes-after-midnight, or null when invalid. */
export function parseHmToMinutes(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 24 || mi < 0 || mi > 59) return null;
  const total = h * 60 + mi;
  return total > 1440 ? null : total;
}

/** Render minutes-after-midnight as "HH:MM" (24h). 1440 renders as "24:00". */
export function minutesToHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Human label, e.g. 480 -> "8:00 AM", 1440 -> "midnight". */
export function minutesToLabel(minutes: number): string {
  if (minutes === 1440 || minutes === 0) return "midnight";
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  let h = h24 % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

export type SalesHoursVerdict = {
  allowed: boolean;
  /** Pacific wall-clock minutes-after-midnight of the checked instant. */
  minuteOfDay: number;
  /** Why the sale is blocked ("" when allowed). */
  reason: string;
  /** True when the block is the STATUTE, not just the owner's tighter window. */
  statutory: boolean;
};

/**
 * Judge whether a sale may complete at `at` under the given window. The
 * window is re-normalized defensively so a corrupted setting can never widen
 * past WAC 314-55-147.
 */
export function evaluateSalesHours(
  at: Date | string,
  window: SalesHoursWindow = DEFAULT_SALES_HOURS,
): SalesHoursVerdict {
  const w = normalizeSalesHoursWindow(window);
  const p = pacificParts(at);
  const minuteOfDay = p.hour * 60 + p.minute;

  const insideStatute =
    minuteOfDay >= STATUTORY_OPEN_MINUTES && minuteOfDay < STATUTORY_CLOSE_MINUTES;
  const insideWindow = minuteOfDay >= w.openMinutes && minuteOfDay < w.closeMinutes;

  if (insideWindow) return { allowed: true, minuteOfDay, reason: "", statutory: false };

  if (!insideStatute) {
    return {
      allowed: false,
      minuteOfDay,
      statutory: true,
      reason:
        "WAC 314-55-147 prohibits cannabis sales between midnight and 8:00 AM (store time). " +
        "This sale cannot be completed until 8:00 AM Pacific.",
    };
  }
  return {
    allowed: false,
    minuteOfDay,
    statutory: false,
    reason:
      `This store's configured sales hours are ${minutesToLabel(w.openMinutes)}–` +
      `${minutesToLabel(w.closeMinutes)} (store time). An owner can widen the window in ` +
      "Settings → Sales hours (never past the WAC 314-55-147 limit of 8:00 AM–midnight).",
  };
}

// ---------------------------------------------------------------------------
// Self-tests (pure; run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runSalesHoursCoreTests(): void {
  let failures = 0;
  function expect(name: string, cond: boolean) {
    if (cond) {
      console.log(`  ok - ${name}`);
    } else {
      failures += 1;
      console.error(`  FAIL - ${name}`);
    }
  }

  // normalize: default, clamp-wider, tighter kept, nonsense collapses.
  const d = normalizeSalesHoursWindow(null);
  expect("normalize null -> statutory", d.openMinutes === 480 && d.closeMinutes === 1440);
  const wide = normalizeSalesHoursWindow({ openMinutes: 0, closeMinutes: 2000 });
  expect("normalize cannot widen past statute", wide.openMinutes === 480 && wide.closeMinutes === 1440);
  const tight = normalizeSalesHoursWindow({ openMinutes: 540, closeMinutes: 1260 });
  expect("normalize keeps tighter window", tight.openMinutes === 540 && tight.closeMinutes === 1260);
  const inverted = normalizeSalesHoursWindow({ openMinutes: 1300, closeMinutes: 600 });
  expect("normalize inverted -> statutory", inverted.openMinutes === 480 && inverted.closeMinutes === 1440);

  // parse/format helpers.
  expect("parse 08:00", parseHmToMinutes("08:00") === 480);
  expect("parse 23:45", parseHmToMinutes("23:45") === 1425);
  expect("parse 24:00", parseHmToMinutes("24:00") === 1440);
  expect("parse junk", parseHmToMinutes("8pm") === null);
  expect("parse 24:30 invalid", parseHmToMinutes("24:30") === null);
  expect("format 480", minutesToHm(480) === "08:00");
  expect("label 1440", minutesToLabel(1440) === "midnight");
  expect("label 1425", minutesToLabel(1425) === "11:45 PM");

  // evaluate — instants chosen for their PACIFIC wall clock (PST = UTC-8).
  // 2024-01-15T20:00Z = 12:00 PM PST — allowed under default window.
  const noonPst = evaluateSalesHours("2024-01-15T20:00:00.000Z");
  expect("noon PST allowed", noonPst.allowed);
  // 2024-01-15T12:00Z = 4:00 AM PST — statutory block.
  const fourAm = evaluateSalesHours("2024-01-15T12:00:00.000Z");
  expect("4 AM PST blocked", !fourAm.allowed);
  expect("4 AM PST statutory", fourAm.statutory);
  expect("4 AM reason cites WAC", fourAm.reason.includes("314-55-147"));
  // 2024-01-15T16:00Z = 8:00 AM PST — the boundary is INCLUSIVE at open.
  const eightAm = evaluateSalesHours("2024-01-15T16:00:00.000Z");
  expect("8:00 AM PST exactly allowed", eightAm.allowed);
  // 2024-01-16T07:59Z = 11:59 PM PST Jan 15 — inside statute (close exclusive at 1440).
  const lateNight = evaluateSalesHours("2024-01-16T07:59:00.000Z");
  expect("11:59 PM PST allowed", lateNight.allowed);
  // 2024-01-16T08:00Z = 12:00 AM PST — midnight itself is BLOCKED.
  const midnight = evaluateSalesHours("2024-01-16T08:00:00.000Z");
  expect("midnight PST blocked", !midnight.allowed && midnight.statutory);
  // DST check: 2024-07-15T14:30Z = 7:30 AM PDT (UTC-7) — blocked.
  const dstMorning = evaluateSalesHours("2024-07-15T14:30:00.000Z");
  expect("7:30 AM PDT blocked (DST-aware)", !dstMorning.allowed && dstMorning.statutory);
  // 2024-07-15T15:30Z = 8:30 AM PDT — allowed.
  const dstOpen = evaluateSalesHours("2024-07-15T15:30:00.000Z");
  expect("8:30 AM PDT allowed (DST-aware)", dstOpen.allowed);

  // Owner-tightened window: 9:00–21:00. 8:30 AM PST is legal by statute but
  // outside the configured window -> blocked, NOT statutory.
  const tightWin = { openMinutes: 540, closeMinutes: 1260 };
  // 2024-01-15T16:30Z = 8:30 AM PST.
  const beforeOpen = evaluateSalesHours("2024-01-15T16:30:00.000Z", tightWin);
  expect("tighter window blocks pre-open", !beforeOpen.allowed && !beforeOpen.statutory);
  expect("tighter-window reason mentions settings", beforeOpen.reason.includes("Sales hours"));
  // 2024-01-15T20:00Z = 12:00 PM PST — inside tighter window.
  const insideTight = evaluateSalesHours("2024-01-15T20:00:00.000Z", tightWin);
  expect("tighter window allows midday", insideTight.allowed);

  if (failures > 0) {
    throw new Error(`sales-hours-core self-tests: ${failures} failure(s)`);
  }
  console.log("sales-hours-core self-tests: all passed");
}
