/**
 * src/lib/reports/range.ts
 *
 * Resolve a reporting date range from URL search params. Supports either explicit
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD, or a ?range=<days> preset (default 30). Returns
 * ISO timestamps suitable for Supabase gte/lte filters, plus display labels.
 */
export type ResolvedRange = {
  fromISO: string; // start of day, ISO
  toISO: string; // end of day, ISO
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  days: number;
  label: string;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    fromDate = ymd(start);
    toDate = ymd(end);
  }

  // Guard against reversed ranges.
  if (fromDate > toDate) {
    const t = fromDate;
    fromDate = toDate;
    toDate = t;
  }

  const fromISO = new Date(`${fromDate}T00:00:00.000Z`).toISOString();
  const toISO = new Date(`${toDate}T23:59:59.999Z`).toISOString();
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
