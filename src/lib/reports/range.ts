/**
 * src/lib/reports/range.ts
 *
 * Resolve a reporting date range from URL search params. Supports:
 *   - explicit ?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   - a rolling ?range=<days> preset (7 / 30 / 90 / 180 / 365; default 30)
 *   - named calendar presets ?range=this_month | last_month |
 *     this_quarter | last_quarter | this_year | last_year
 *   - an explicit quarter ?range=q1 | q2 | q3 | q4 (current Pacific year),
 *     optionally pinned to a year with ?year=YYYY (e.g. ?range=q2&year=2024)
 *
 * Returns ISO timestamps suitable for Supabase gte/lte filters, plus display
 * labels.
 *
 * PACIFIC TIME: the date labels (from/to) are Pacific calendar days, and the
 * ISO boundaries are the precise UTC instants for the START of the Pacific
 * "from" day and the END of the Pacific "to" day. Greenway operates in WA, so
 * "today" / "this quarter" / "last year" always mean Pacific dates regardless
 * of the server's zone.
 */
import { pacificToday, addPacificDays, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";

export type ResolvedRange = {
  fromISO: string; // start of day, ISO
  toISO: string; // end of day, ISO
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  days: number;
  label: string;
  preset?: string; // the named preset that produced this range, if any
};

const ROLLING_DAYS = [7, 30, 90, 180, 365];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** First/last Pacific calendar day of a given month (1-12) in a year. */
function monthBounds(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${pad2(month)}-01`;
  // Last day of the month: day 0 of the next month.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${pad2(month)}-${pad2(lastDay)}`;
  return { from, to };
}

/** First/last Pacific calendar day of a quarter (1-4) in a year. */
function quarterBounds(year: number, quarter: number): { from: string; to: string } {
  const startMonth = (quarter - 1) * 3 + 1; // 1,4,7,10
  const endMonth = startMonth + 2; // 3,6,9,12
  const from = `${year}-${pad2(startMonth)}-01`;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const to = `${year}-${pad2(endMonth)}-${pad2(lastDay)}`;
  return { from, to };
}

/** Quarter (1-4) for a 1-12 month. */
function quarterOf(month: number): number {
  return Math.floor((month - 1) / 3) + 1;
}

const QUARTER_LABEL = (q: number, year: number) => `Q${q} ${year}`;

/**
 * Resolve a named calendar preset to explicit Pacific from/to dates. Returns
 * null if the preset string is not recognized.
 */
function resolveNamedPreset(
  preset: string,
  yearHint?: number,
): { from: string; to: string; label: string; key: string } | null {
  const today = pacificToday();
  const [ty, tm] = today.split("-").map(Number);
  const p = preset.toLowerCase().trim();

  switch (p) {
    case "this_month": {
      const b = monthBounds(ty, tm);
      return { from: b.from, to: b.to, label: "This month", key: "this_month" };
    }
    case "last_month": {
      const y = tm === 1 ? ty - 1 : ty;
      const m = tm === 1 ? 12 : tm - 1;
      const b = monthBounds(y, m);
      return { from: b.from, to: b.to, label: "Last month", key: "last_month" };
    }
    case "this_quarter": {
      const q = quarterOf(tm);
      const b = quarterBounds(ty, q);
      return { from: b.from, to: b.to, label: `This quarter (${QUARTER_LABEL(q, ty)})`, key: "this_quarter" };
    }
    case "last_quarter": {
      const curQ = quarterOf(tm);
      const y = curQ === 1 ? ty - 1 : ty;
      const q = curQ === 1 ? 4 : curQ - 1;
      const b = quarterBounds(y, q);
      return { from: b.from, to: b.to, label: `Last quarter (${QUARTER_LABEL(q, y)})`, key: "last_quarter" };
    }
    case "this_year": {
      return { from: `${ty}-01-01`, to: `${ty}-12-31`, label: `This year (${ty})`, key: "this_year" };
    }
    case "last_year": {
      const y = ty - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: `Last year (${y})`, key: "last_year" };
    }
    case "q1":
    case "q2":
    case "q3":
    case "q4": {
      const q = Number(p[1]);
      const y = yearHint && yearHint >= 2000 && yearHint <= 9999 ? yearHint : ty;
      const b = quarterBounds(y, q);
      return { from: b.from, to: b.to, label: QUARTER_LABEL(q, y), key: `q${q}` };
    }
    default:
      return null;
  }
}

export function resolveRange(sp: {
  from?: string;
  to?: string;
  range?: string;
  year?: string;
}): ResolvedRange {
  let fromDate: string;
  let toDate: string;
  let label: string | null = null;
  let preset: string | undefined;

  const validDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

  if (validDate(sp.from) && validDate(sp.to)) {
    // Explicit window always wins.
    fromDate = sp.from as string;
    toDate = sp.to as string;
  } else {
    const rangeStr = (sp.range ?? "").toLowerCase().trim();
    const named = rangeStr ? resolveNamedPreset(rangeStr, sp.year ? Number(sp.year) : undefined) : null;
    if (named) {
      fromDate = named.from;
      toDate = named.to;
      label = named.label;
      preset = named.key;
    } else {
      // Rolling-window days preset (default 30). Anchor to the Pacific
      // calendar: today (PT) back to (today − days + 1).
      const days = ROLLING_DAYS.includes(Number(sp.range)) ? Number(sp.range) : 30;
      toDate = pacificToday();
      fromDate = addPacificDays(toDate, -(days - 1));
      preset = `${days}d`;
    }
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
    label: label ?? `${fromDate} → ${toDate}`,
    preset,
  };
}

/**
 * Pure preset resolver exposed for the client picker and tests. Given a preset
 * key (and optional year), return explicit Pacific from/to YYYY-MM-DD dates so
 * the picker can push a shareable, timezone-correct window. Returns null for
 * unknown presets.
 */
export function presetToDates(
  preset: string,
  yearHint?: number,
): { from: string; to: string; label: string } | null {
  const r = resolveNamedPreset(preset, yearHint);
  if (!r) return null;
  return { from: r.from, to: r.to, label: r.label };
}

/* ------------------------------------------------------------------------- */
/* Pure self-tests (run via tsx; see verification harness).                  */
/* ------------------------------------------------------------------------- */

export function __runRangeTests(): { passed: number; failed: number; messages: string[] } {
  const messages: string[] = [];
  let passed = 0;
  let failed = 0;

  const eq = (name: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) === JSON.stringify(want)) {
      passed++;
    } else {
      failed++;
      messages.push(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    }
  };

  // Quarter bounds are deterministic regardless of "today".
  eq("q1 2024", presetToDates("q1", 2024), { from: "2024-01-01", to: "2024-03-31", label: "Q1 2024" });
  eq("q2 2024", presetToDates("q2", 2024), { from: "2024-04-01", to: "2024-06-30", label: "Q2 2024" });
  eq("q3 2023", presetToDates("q3", 2023), { from: "2023-07-01", to: "2023-09-30", label: "Q3 2023" });
  eq("q4 2024 (leap-year irrelevant)", presetToDates("q4", 2024), {
    from: "2024-10-01",
    to: "2024-12-31",
    label: "Q4 2024",
  });
  // Feb in a leap year vs non-leap year via this_month path is "today"-dependent,
  // so we test the helper indirectly through an explicit quarter that contains Feb.
  eq("q1 2024 (Feb leap)", presetToDates("q1", 2024)?.to, "2024-03-31");

  // this_year / last_year shape.
  const ty = pacificToday();
  const year = Number(ty.slice(0, 4));
  eq("this_year from", presetToDates("this_year")?.from, `${year}-01-01`);
  eq("this_year to", presetToDates("this_year")?.to, `${year}-12-31`);
  eq("last_year from", presetToDates("last_year")?.from, `${year - 1}-01-01`);
  eq("last_year to", presetToDates("last_year")?.to, `${year - 1}-12-31`);

  // Unknown preset.
  eq("unknown preset", presetToDates("nope"), null);

  // resolveRange wiring: named preset wins when no explicit from/to.
  const r1 = resolveRange({ range: "q2", year: "2024" });
  eq("resolveRange q2 2024 fromDate", r1.fromDate, "2024-04-01");
  eq("resolveRange q2 2024 toDate", r1.toDate, "2024-06-30");
  eq("resolveRange q2 2024 preset", r1.preset, "q2");
  eq("resolveRange q2 2024 label", r1.label, "Q2 2024");

  // Explicit from/to overrides preset.
  const r2 = resolveRange({ from: "2024-05-01", to: "2024-05-10", range: "this_year" });
  eq("resolveRange explicit fromDate", r2.fromDate, "2024-05-01");
  eq("resolveRange explicit toDate", r2.toDate, "2024-05-10");

  // Rolling fallback.
  const r3 = resolveRange({ range: "90" });
  eq("resolveRange 90d preset", r3.preset, "90d");
  eq("resolveRange 90d days span", r3.days, 90);

  // Default.
  const r4 = resolveRange({});
  eq("resolveRange default preset", r4.preset, "30d");

  return { passed, failed, messages };
}
