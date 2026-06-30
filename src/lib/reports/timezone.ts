/**
 * src/lib/reports/timezone.ts  (Run 5 / Slice 20)
 *
 * Pacific-time helpers for the reporting suite. Greenway operates in Port
 * Orchard, WA, so every dashboard bucket (day, hour, month) and every date
 * range boundary must be anchored to America/Los_Angeles — NOT UTC.
 *
 * Why Intl instead of manual offsets
 * ----------------------------------
 * Washington observes daylight saving time (PST = UTC−8, PDT = UTC−7). A fixed
 * offset would drift twice a year. `Intl.DateTimeFormat` with the IANA zone
 * "America/Los_Angeles" resolves the correct offset for any given instant, so
 * our buckets stay correct across the spring-forward / fall-back transitions.
 *
 * Everything here is pure (no I/O), so it is safe to import anywhere — including
 * route handlers, server components, and tsx test scripts.
 */

export const PACIFIC_TZ = "America/Los_Angeles";

// A single shared formatter is cheaper than constructing one per call.
const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export type PacificParts = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
};

/** Break an instant (Date or ISO string) into its Pacific wall-clock parts. */
export function pacificParts(input: Date | string): PacificParts {
  const date = typeof input === "string" ? new Date(input) : input;
  const map: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  // Intl emits "24" for midnight in hour23/hourCycle edge cases on some engines;
  // normalize to 0.
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Pacific calendar day as YYYY-MM-DD. */
export function pacificDayKey(input: Date | string): string {
  const p = pacificParts(input);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Pacific month bucket as YYYY-MM. */
export function pacificMonthKey(input: Date | string): string {
  const p = pacificParts(input);
  return `${p.year}-${pad2(p.month)}`;
}

/** Pacific hour-of-day (0-23). */
export function pacificHour(input: Date | string): number {
  return pacificParts(input).hour;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Compute the UTC offset (in minutes) that America/Los_Angeles has at a given
 * instant. Positive means "ahead of UTC", which Pacific never is, so the result
 * is always negative (−480 for PST, −420 for PDT).
 */
export function pacificOffsetMinutes(at: Date): number {
  // Format the instant in both UTC and Pacific, then diff the wall clocks.
  const utc = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
  const pac = new Date(at.toLocaleString("en-US", { timeZone: PACIFIC_TZ }));
  return Math.round((pac.getTime() - utc.getTime()) / 60000);
}

/**
 * Convert a Pacific wall-clock date (YYYY-MM-DD) + time-of-day into the precise
 * UTC instant it represents. Used to build query boundaries: "start of this
 * Pacific day" / "end of this Pacific day" as UTC ISO strings for Supabase
 * gte/lte filters.
 *
 * Algorithm: take the naive UTC interpretation of the wall clock, then correct
 * by the zone's offset at that approximate instant. We iterate once to settle
 * DST boundary cases (the offset at the corrected instant may differ from the
 * naive one near a transition).
 */
export function pacificWallTimeToUtcISO(
  ymd: string,
  time: "start" | "end" | { h: number; m: number; s: number; ms: number },
): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  let h = 0;
  let mi = 0;
  let se = 0;
  let ms = 0;
  if (time === "start") {
    h = 0;
    mi = 0;
    se = 0;
    ms = 0;
  } else if (time === "end") {
    h = 23;
    mi = 59;
    se = 59;
    ms = 999;
  } else {
    ({ h, m: mi, s: se, ms } = time);
  }

  // Naive: treat the wall clock as if it were UTC.
  const naiveUtcMs = Date.UTC(y, mo - 1, d, h, mi, se, ms);
  // Offset at that approximate instant (negative for Pacific).
  let offsetMin = pacificOffsetMinutes(new Date(naiveUtcMs));
  // The true UTC instant is naive minus the offset.
  let utcMs = naiveUtcMs - offsetMin * 60000;
  // Re-check offset at the corrected instant and settle once (DST edges).
  const offsetMin2 = pacificOffsetMinutes(new Date(utcMs));
  if (offsetMin2 !== offsetMin) {
    offsetMin = offsetMin2;
    utcMs = naiveUtcMs - offsetMin * 60000;
  }
  return new Date(utcMs).toISOString();
}

/** Today's Pacific calendar date as YYYY-MM-DD. */
export function pacificToday(): string {
  return pacificDayKey(new Date());
}

/**
 * Add `days` to a Pacific YYYY-MM-DD date and return the new YYYY-MM-DD. Pure
 * calendar arithmetic (no zone math needed — we operate on the date label).
 */
export function addPacificDays(ymd: string, days: number): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, mo - 1, d) + days * 86400000;
  const nd = new Date(t);
  return `${nd.getUTCFullYear()}-${pad2(nd.getUTCMonth() + 1)}-${pad2(nd.getUTCDate())}`;
}

/** Human label for an hour-of-day, e.g. 0 -> "12 AM", 13 -> "1 PM". */
export function formatHourLabel(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}
