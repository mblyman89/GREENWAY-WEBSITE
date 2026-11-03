/**
 * src/lib/reports/forecast-source-core.ts  (CVB-9, pure)
 *
 * Forecast data source switch (owner request 2026-11-02, decision CVB-D16):
 *
 *   greenway   our own completed orders only (the default, and the only choice for everyone but the owner)
 *   blend      our days, plus Cultivera history for days BEFORE the cut-over on which we have no figures
 *   cultivera  Cultivera history only (days before the cut-over)
 *
 * Rules, never bent:
 *   - Cultivera days are used only before the cut-over date, never on a day we have our own figures;
 *   - no cut-over date set = Cultivera is not used at all (said in the note, never guessed);
 *   - every day keeps the name of the system it came from, so the chart and the AI can say so.
 *
 * Owner words: "I want the Cultivera data to be clearly marked somehow so I know which systems data we are using
 * as a forecast or comparison".
 */
import { CULTIVERA_LABEL } from "@/lib/reports/cultivera-history-core";

export type ForecastSource = "greenway" | "blend" | "cultivera";
export type DaySource = "greenway" | "cultivera";

export const FORECAST_SOURCES: readonly { key: ForecastSource; label: string }[] = [
  { key: "greenway", label: "Greenway only" },
  { key: "blend", label: "Greenway + Cultivera history" },
  { key: "cultivera", label: "Cultivera only" },
];

/** Read ?source=; the two Cultivera choices need the owner's permission, otherwise Greenway only. */
export function parseForecastSource(raw: unknown, canUseCultivera: boolean): ForecastSource {
  if (raw === "blend" || raw === "cultivera") return canUseCultivera ? raw : "greenway";
  return "greenway";
}

export type Obs = { date: string; value: number };
export type TaggedObs = Obs & { source: DaySource };

export type SourceSeries = {
  revenue: TaggedObs[];
  orders: TaggedObs[];
  units: TaggedObs[];
};

export type CultiveraDay = { day: string; revenue_minor: number; orders: number; units: number };

export type SourceInfo = {
  source: ForecastSource;
  cutover: string | null;
  greenwayDays: number;
  cultiveraDays: number;
  firstCultivera: string | null;
  lastCultivera: string | null;
  /** One plain sentence naming the system(s) that fed the forecast (shown on the page and given to the AI). */
  note: string;
  /** A problem the owner must see (no cut-over date, no history built, unreadable history). */
  warning: string | null;
};

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

const sortByDate = <T extends { date: string }>(a: T[]) => a.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));

/**
 * Combine our series with Cultivera's days for the chosen source.
 *   ours        our per-day figures (already completed orders, Pacific days)
 *   cultivera   cultivera_history_days rows (any range; clipped here)
 *   cutover     gl_conversion_config.cutover_date (null = Cultivera never used)
 *   today, lookbackDays  the window the forecaster learns from (Cultivera-only ends at its last usable day)
 *   historyError  a failed read of Cultivera history (shown, and the forecast falls back to Greenway only)
 */
export function combineSeries(input: {
  source: ForecastSource;
  ours: { revenue: Obs[]; orders: Obs[]; units: Obs[] };
  cultivera: readonly CultiveraDay[];
  cutover: string | null;
  today: string;
  lookbackDays: number;
  historyError?: string | null;
}): { series: SourceSeries; info: SourceInfo } {
  const { ours, cutover, today, lookbackDays } = input;
  let source = input.source;
  let warning: string | null = null;

  const tagOurs = (a: Obs[]): TaggedObs[] => a.map((o) => ({ ...o, source: "greenway" as const }));

  if (source !== "greenway") {
    if (input.historyError) {
      warning = `${CULTIVERA_LABEL} history could not be read (${input.historyError}). This forecast uses Greenway figures only.`;
      source = "greenway";
    } else if (!cutover) {
      warning = `No cut-over date is set (Accounting \u2192 Conversion), so ${CULTIVERA_LABEL} history is not used. This forecast uses Greenway figures only.`;
      source = "greenway";
    } else if (!input.cultivera.some((d) => d.day < cutover)) {
      warning = `No ${CULTIVERA_LABEL} history before the cut-over (${cutover}) is stored yet. Build it on Cultivera Archive \u2192 Build report history. This forecast uses Greenway figures only.`;
      source = "greenway";
    }
  }

  const usable = cutover ? input.cultivera.filter((d) => d.day < cutover) : [];
  let series: SourceSeries;

  if (source === "greenway") {
    series = { revenue: tagOurs(ours.revenue), orders: tagOurs(ours.orders), units: tagOurs(ours.units) };
  } else if (source === "cultivera") {
    const last = usable.reduce((m, d) => (d.day > m ? d.day : m), "");
    const from = addDays(last, -(lookbackDays - 1));
    const win = usable.filter((d) => d.day >= from && d.day <= last);
    const tag = (pick: (d: CultiveraDay) => number): TaggedObs[] =>
      sortByDate(win.map((d) => ({ date: d.day, value: pick(d), source: "cultivera" as const })));
    series = { revenue: tag((d) => d.revenue_minor), orders: tag((d) => d.orders), units: tag((d) => d.units) };
  } else {
    const from = addDays(today, -lookbackDays);
    const ourDays = new Set<string>([...ours.revenue, ...ours.orders, ...ours.units].map((o) => o.date));
    const fill = usable.filter((d) => d.day >= from && d.day <= today && !ourDays.has(d.day));
    const mix = (a: Obs[], pick: (d: CultiveraDay) => number): TaggedObs[] =>
      sortByDate([...tagOurs(a), ...fill.map((d) => ({ date: d.day, value: pick(d), source: "cultivera" as const }))]);
    series = { revenue: mix(ours.revenue, (d) => d.revenue_minor), orders: mix(ours.orders, (d) => d.orders), units: mix(ours.units, (d) => d.units) };
  }

  const cultDates = series.revenue.filter((o) => o.source === "cultivera").map((o) => o.date);
  const ourCount = new Set([...series.revenue, ...series.orders, ...series.units].filter((o) => o.source === "greenway").map((o) => o.date)).size;
  const first = cultDates[0] ?? null;
  const last = cultDates[cultDates.length - 1] ?? null;

  let note: string;
  if (source === "greenway") note = "Data source: Greenway figures only (our completed orders).";
  else if (source === "cultivera")
    note = `Data source: ${CULTIVERA_LABEL} only \u2014 ${cultDates.length} days of Cultivera completed orders${first ? ` (${first} to ${last})` : ""}, all before the cut-over on ${cutover}. Greenway figures are not used.`;
  else
    note = `Data source: Greenway + ${CULTIVERA_LABEL} \u2014 ${ourCount} Greenway days and ${cultDates.length} Cultivera days${first ? ` (${first} to ${last})` : ""}. Cultivera fills only days before the cut-over on ${cutover} that have no Greenway figures.`;

  return {
    series,
    info: { source, cutover, greenwayDays: ourCount, cultiveraDays: cultDates.length, firstCultivera: first, lastCultivera: last, note, warning },
  };
}

// ---------------------------------------------------------------------------
// self-tests
// ---------------------------------------------------------------------------

export function __runForecastSourceTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("  x forecast-source-core:", m);
    }
  };

  ok(parseForecastSource("blend", true) === "blend", "owner may blend");
  ok(parseForecastSource("cultivera", true) === "cultivera", "owner may use Cultivera only");
  ok(parseForecastSource("blend", false) === "greenway" && parseForecastSource("cultivera", false) === "greenway", "others get Greenway only");
  ok(parseForecastSource("nonsense", true) === "greenway" && parseForecastSource(undefined, true) === "greenway", "default Greenway");

  const ours = {
    revenue: [{ date: "2026-10-30", value: 500 }, { date: "2026-11-01", value: 900 }, { date: "2026-11-02", value: 1000 }],
    orders: [{ date: "2026-10-30", value: 5 }, { date: "2026-11-01", value: 9 }, { date: "2026-11-02", value: 10 }],
    units: [{ date: "2026-10-30", value: 6 }, { date: "2026-11-01", value: 12 }, { date: "2026-11-02", value: 14 }],
  };
  const cult: CultiveraDay[] = [
    { day: "2026-05-01", revenue_minor: 111, orders: 1, units: 1 },
    { day: "2026-10-29", revenue_minor: 700, orders: 7, units: 8.5 },
    { day: "2026-10-30", revenue_minor: 650, orders: 6, units: 7 },
    { day: "2026-10-31", revenue_minor: 800, orders: 8, units: 9 },
    { day: "2026-11-01", revenue_minor: 999, orders: 9, units: 9 },
  ];
  const base = { ours, cultivera: cult, cutover: "2026-11-01", today: "2026-11-02", lookbackDays: 30 };

  const g = combineSeries({ ...base, source: "greenway" });
  ok(g.series.revenue.length === 3 && g.series.revenue.every((o) => o.source === "greenway"), "Greenway only untouched");
  ok(g.info.cultiveraDays === 0 && /Greenway figures only/.test(g.info.note) && g.info.warning === null, "Greenway note");

  const b = combineSeries({ ...base, source: "blend" });
  const bd = b.series.revenue.map((o) => `${o.date}:${o.source}:${o.value}`).join(",");
  ok(bd === "2026-10-29:cultivera:700,2026-10-30:greenway:500,2026-10-31:cultivera:800,2026-11-01:greenway:900,2026-11-02:greenway:1000", `blend fills only our gaps before cut-over: ${bd}`);
  ok(!b.series.revenue.some((o) => o.date === "2026-05-01"), "outside the lookback window left out");
  ok(!b.series.revenue.some((o) => o.source === "cultivera" && o.date >= "2026-11-01"), "never on or after the cut-over");
  ok(b.series.units.find((o) => o.date === "2026-10-29")?.value === 8.5, "fractional units kept");
  ok(b.info.cultiveraDays === 2 && b.info.greenwayDays === 3 && b.info.firstCultivera === "2026-10-29", "blend counts");
  ok(/Greenway \+ Cultivera \(imported\)/.test(b.info.note) && /2026-11-01/.test(b.info.note), "blend note names both and the cut-over");

  const c = combineSeries({ ...base, source: "cultivera", lookbackDays: 2 });
  ok(c.series.revenue.map((o) => o.date).join() === "2026-10-30,2026-10-31", "Cultivera only: last lookback days before cut-over");
  ok(c.series.revenue.every((o) => o.source === "cultivera"), "Cultivera only tags");
  ok(/Cultivera \(imported\) only/.test(c.info.note) && /not used/.test(c.info.note), "Cultivera note");

  const nc = combineSeries({ ...base, source: "blend", cutover: null });
  ok(nc.info.source === "greenway" && /No cut-over date/.test(nc.info.warning ?? ""), "no cut-over: Greenway only, said");
  const nh = combineSeries({ ...base, source: "cultivera", cultivera: [] });
  ok(nh.info.source === "greenway" && /Build report history/.test(nh.info.warning ?? ""), "no history: said where to build it");
  const er = combineSeries({ ...base, source: "blend", historyError: "boom" });
  ok(er.info.source === "greenway" && /could not be read \(boom\)/.test(er.info.warning ?? ""), "read error shown, never silent");

  return { passed, failed };
}
