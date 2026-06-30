/**
 * src/lib/reports/range.ts
 *
 * Resolve a reporting date range from URL search params. Supports either explicit
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD, or a ?range=<days> preset (default 30). Returns
 * ISO timestamps suitable for Supabase gte/lte filters, plus display labels.
 *
 * PACIFIC TIME: the date labels (from/to) are Pacific calendar days, and the
 * ISO boundaries are the precise UTC instants for the START of the Pacific
 * "from" day and the END of the Pacific "to" day. Greenway operates in WA, so
 * "today" / "last 30 days" always mean Pacific days regardless of server zone.
 */
import { pacificToday, addPacificDays, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";

export type ResolvedRange = {
  fromISO: string; // start of day, ISO
  toISO: string; // end of day, ISO
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  days: number;
  label: string;
};

export function resolveRange(sp: {
  from?: string;
  to?: string;
  range?: string;
}): ResolvedRange {
  let fromDate: string;
  let toDate: string;

  const validDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

  if (validDate(sp.from) && validDate(sp.to)) {
    fromDate = sp.from as string;
    toDate = sp.to as string;
  } else {
    const days = [7, 30, 90, 180, 365].includes(Number(sp.range)) ? Number(sp.range) : 30;
    // Anchor to the Pacific calendar: today (PT) back to (today − days + 1).
    toDate = pacificToday();
    fromDate = addPacificDays(toDate, -(days - 1));
  }

  // Guard against reversed ranges.
  if (fromDate > toDate) {
    const t = fromDate;
    fromDate = toDate;
    toDate = t;
  }

  // Boundaries are the precise UTC instants for the Pacific day edges.
  const fromISO = pacificWallTimeToUtcISO(fromDate, "start");
  const toISO = pacificWallTimeToUtcISO(toDate, "end");
  const days = Math.max(1, Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86400000));

  return {
    fromISO,
    toISO,
    fromDate,
    toDate,
    days,
    label: `${fromDate} → ${toDate}`,
  };
}
