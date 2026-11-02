/**
 * src/lib/reports/cultivera-benchmark-core.ts — CVB-4: the pure heart of the Cultivera benchmark.
 *
 * Owner (2026-11-01, verbatim in docs/roadmap/CVB-CULTIVERA-BENCHMARK.md §1): "I want to compare
 * Cultivera's system with ours. I want to know everything. Leave nothing out. ... Maybe add a total build
 * cost amount that goes down as our system outperforms theirs as well as account for the 5500 less for not
 * using Cultivera anymore. ... Total build was 40k."
 *
 * Three jobs, no I/O (stores and pages call these; migration 0337 holds the data):
 *   1. INGEST  - Cultivera's reports/daily-sales rows (dollar floats) -> one cents row per Pacific day, the
 *                exact shape cvb_upsert_benchmark_days takes; manifest files -> cvb_register_archive_run.
 *   2. COMPARE - our figure vs Cultivera's per metric and period: difference, percent, and a status
 *                (ahead / behind / even / info / not_comparable). A missing side is NEVER treated as zero.
 *   3. PAYBACK - the append-only ledger in cultivera_payback_entries: remaining = build cost - savings -
 *                outperformance -/+ adjustments; an outperformance credit is only ever the positive,
 *                measured amount for a closed period, keyed once per metric and period.
 *
 * Money is integer cents throughout. Days are plain Pacific calendar dates "YYYY-MM-DD".
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RUN_ID_RE = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
/** The same pattern as the 0337 check on cultivera_archive_files.file_name (and the harvester's names). */
export const ARCHIVE_FILE_NAME_RE = /^[a-z0-9_]+(\.(p\d{4}|\d{4}-\d{2}|s\d{5}|cc\d{5}))?\.(jsonl\.gz|json|jsonl)$/;
/** cvb_register_archive_run refuses more files than this. */
export const MAX_ARCHIVE_FILES = 5000;
/** cvb_upsert_benchmark_days refuses more rows than this per call. */
export const DAYS_BATCH_SIZE = 1000;

/**
 * Cultivera dollars (a float such as 8684.14) -> integer cents, half away from zero. toFixed(6) first, because
 * 1.005 * 100 is 100.49999999999999 in binary floating point. Non-finite -> null (never a silent 0).
 */
export function dollarsToCents(d: unknown): number | null {
  if (!fin(d)) return null;
  const cents = Math.round(Number((Math.abs(d) * 100).toFixed(6)));
  return d < 0 ? -cents : cents === 0 ? 0 : cents;
}

/** A real calendar date "YYYY-MM-DD" (rejects 2026-02-30). */
export function isDay(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DAY_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function ymd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Calendar days from..to inclusive (0 when to < from or either is not a date). */
export function daysInRange(from: string, to: string): number {
  if (!isDay(from) || !isDay(to)) return 0;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return b < a ? 0 : Math.round((b - a) / 86_400_000) + 1;
}

/** The same calendar dates one year earlier (Feb 29 -> Feb 28). */
export function samePeriodLastYear(from: string, to: string): { from: string; to: string } | null {
  if (!isDay(from) || !isDay(to) || to < from) return null;
  const back = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
    return ymd(y - 1, m, Math.min(d, last));
  };
  return { from: back(from), to: back(to) };
}

// ---------------------------------------------------------------------------
// 1. INGEST
// ---------------------------------------------------------------------------

/** One row of Cultivera's reports/daily-sales, as measured 2026-11-01 (dollars). */
export type CultiveraDailySalesRaw = {
  Day?: unknown;
  Month?: unknown;
  Year?: unknown;
  GrossSales?: unknown;
  Discounts?: unknown;
  Taxes?: unknown;
  Returns?: unknown;
  NetSales?: unknown;
  Cost?: unknown;
  GrossProfit?: unknown;
  NetProfit?: unknown;
  CashRedemption?: unknown;
};

/** Exactly the jsonb keys cvb_upsert_benchmark_days reads. */
export type BenchmarkDayRow = {
  day: string;
  gross_sales_minor: number;
  discounts_minor: number;
  taxes_minor: number;
  returns_minor: number;
  net_sales_minor: number;
  cost_minor: number;
  gross_profit_minor: number;
  net_profit_minor: number;
  cash_redemption_minor: number;
};

const MONEY_FIELDS: ReadonlyArray<[keyof CultiveraDailySalesRaw, keyof BenchmarkDayRow]> = [
  ["GrossSales", "gross_sales_minor"],
  ["Discounts", "discounts_minor"],
  ["Taxes", "taxes_minor"],
  ["Returns", "returns_minor"],
  ["NetSales", "net_sales_minor"],
  ["Cost", "cost_minor"],
  ["GrossProfit", "gross_profit_minor"],
  ["NetProfit", "net_profit_minor"],
  ["CashRedemption", "cash_redemption_minor"],
];

export type IngestProblem = { index: number; problem: string };

/** One raw row -> a cents row, or the reason it cannot be stored (never a guessed field). */
export function normalizeDailySalesRow(raw: CultiveraDailySalesRaw): BenchmarkDayRow | string {
  if (!raw || typeof raw !== "object") return "not an object";
  const { Day, Month, Year } = raw;
  if (!Number.isInteger(Day) || !Number.isInteger(Month) || !Number.isInteger(Year)) return "Day / Month / Year missing";
  const day = ymd(Year as number, Month as number, Day as number);
  if (!isDay(day)) return `not a calendar date (${day})`;
  const out: Partial<BenchmarkDayRow> = { day };
  for (const [src, dst] of MONEY_FIELDS) {
    const c = dollarsToCents(raw[src]);
    if (c === null) return `${String(src)} missing or not a number`;
    (out as Record<string, unknown>)[dst] = c;
  }
  return out as BenchmarkDayRow;
}

/**
 * All raw rows -> cents rows sorted by day. A day that appears twice with DIFFERENT figures is a problem (both
 * kept out: we cannot tell which is right); identical duplicates collapse to one.
 */
export function normalizeDailySales(raws: readonly CultiveraDailySalesRaw[]): {
  rows: BenchmarkDayRow[];
  problems: IngestProblem[];
  duplicates: number;
  conflicts: string[];
} {
  const byDay = new Map<string, BenchmarkDayRow>();
  const conflicted = new Set<string>();
  const problems: IngestProblem[] = [];
  let duplicates = 0;
  raws.forEach((raw, index) => {
    const r = normalizeDailySalesRow(raw);
    if (typeof r === "string") {
      problems.push({ index, problem: r });
      return;
    }
    const prev = byDay.get(r.day);
    if (!prev) {
      byDay.set(r.day, r);
      return;
    }
    duplicates++;
    if (JSON.stringify(prev) !== JSON.stringify(r)) conflicted.add(r.day);
  });
  for (const d of conflicted) byDay.delete(d);
  const rows = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return { rows, problems, duplicates, conflicts: [...conflicted].sort() };
}

/** Split rows into calls of at most DAYS_BATCH_SIZE. */
export function dayBatches<T>(rows: readonly T[], size = DAYS_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  const n = Math.max(1, Math.floor(size));
  for (let i = 0; i < rows.length; i += n) out.push(rows.slice(i, i + n));
  return out;
}

export type ManifestFile = { name?: unknown; bytes?: unknown; sha256?: unknown; rows?: unknown };
export type RegisterFile = { name: string; bytes: number; sha256: string; rows: number | null };

/**
 * The crawler's manifest -> the p_files list cvb_register_archive_run takes. Refuses (returns problems)
 * rather than dropping a file, because a partial archive would look complete.
 */
export function manifestToRegisterFiles(manifest: { files?: unknown } | null | undefined): {
  files: RegisterFile[];
  problems: string[];
} {
  const problems: string[] = [];
  const list = manifest && Array.isArray(manifest.files) ? (manifest.files as ManifestFile[]) : null;
  if (!list) return { files: [], problems: ["the manifest has no file list"] };
  if (list.length === 0) problems.push("the manifest lists no files");
  if (list.length > MAX_ARCHIVE_FILES) problems.push(`the manifest lists ${list.length} files; at most ${MAX_ARCHIVE_FILES}`);
  const seen = new Set<string>();
  const files: RegisterFile[] = [];
  for (const f of list) {
    const name = typeof f?.name === "string" ? f.name : "";
    if (!ARCHIVE_FILE_NAME_RE.test(name)) {
      problems.push(`not an archive file name: ${JSON.stringify(f?.name ?? null)}`);
      continue;
    }
    if (seen.has(name)) {
      problems.push(`listed twice: ${name}`);
      continue;
    }
    seen.add(name);
    if (!Number.isInteger(f.bytes) || (f.bytes as number) < 0) problems.push(`${name}: bytes missing`);
    if (typeof f.sha256 !== "string" || !SHA_RE.test(f.sha256)) problems.push(`${name}: sha256 missing`);
    const rows = f.rows === null || f.rows === undefined ? null : f.rows;
    if (rows !== null && (!Number.isInteger(rows) || (rows as number) < 0)) problems.push(`${name}: rows not a count`);
    files.push({ name, bytes: f.bytes as number, sha256: f.sha256 as string, rows: rows as number | null });
  }
  return problems.length ? { files: [], problems } : { files, problems };
}

export type RegisterResult =
  | { status: "archived"; runId: string; files: number; bytes: number; rows: number }
  | { status: "already"; runId: string };

/** Read cvb_register_archive_run's jsonb answer; anything unexpected -> null (shown as an error). */
export function parseRegisterResult(x: unknown): RegisterResult | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.run_id !== "string" || !RUN_ID_RE.test(o.run_id)) return null;
  if (o.status === "already") return { status: "already", runId: o.run_id };
  if (o.status !== "archived") return null;
  if (![o.files, o.bytes, o.rows].every((v) => Number.isInteger(v) && (v as number) >= 0)) return null;
  return { status: "archived", runId: o.run_id, files: o.files as number, bytes: o.bytes as number, rows: o.rows as number };
}

/** Read cvb_upsert_benchmark_days's jsonb answer. */
export function parseDaysResult(x: unknown): { rows: number; written: number; keptNewer: number } | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const v = [o.rows, o.written, o.kept_newer];
  if (!v.every((n) => Number.isInteger(n) && (n as number) >= 0)) return null;
  if ((o.written as number) + (o.kept_newer as number) !== (o.rows as number)) return null;
  return { rows: o.rows as number, written: o.written as number, keptNewer: o.kept_newer as number };
}

export function isValidArchiveRunId(id: unknown): id is string {
  return typeof id === "string" && RUN_ID_RE.test(id);
}

// ---------------------------------------------------------------------------
// 2. COMPARE
// ---------------------------------------------------------------------------

/** "up" = more is better, "down" = less is better, "info" = shown without a verdict. */
export type Direction = "up" | "down" | "info";

export type MetricKey =
  | "gross_sales"
  | "discounts"
  | "taxes"
  | "returns"
  | "net_sales"
  | "cost"
  | "gross_profit"
  | "net_profit";

export type MetricDef = { key: MetricKey; label: string; direction: Direction; field: keyof BenchmarkDayRow };

/**
 * The metric catalogue (roadmap §5). Discounts and returns: less is better for the store. Taxes and cost follow
 * sales volume, so they get no verdict (a lower cost is not "winning" if it is because we sold less).
 */
export const METRICS: readonly MetricDef[] = [
  { key: "gross_sales", label: "Gross sales", direction: "up", field: "gross_sales_minor" },
  { key: "discounts", label: "Discounts", direction: "down", field: "discounts_minor" },
  { key: "returns", label: "Returns", direction: "down", field: "returns_minor" },
  { key: "net_sales", label: "Net sales", direction: "up", field: "net_sales_minor" },
  { key: "taxes", label: "Taxes", direction: "info", field: "taxes_minor" },
  { key: "cost", label: "Cost of goods", direction: "info", field: "cost_minor" },
  { key: "gross_profit", label: "Gross profit", direction: "up", field: "gross_profit_minor" },
  { key: "net_profit", label: "Net profit", direction: "up", field: "net_profit_minor" },
];

export type CompareStatus = "ahead" | "behind" | "even" | "info" | "not_comparable";

export type MetricComparison = {
  key: MetricKey;
  label: string;
  oursMinor: number | null;
  theirsMinor: number | null;
  diffMinor: number | null;
  /** Difference as a percent of Cultivera's figure, 1 decimal; null when theirs is 0 or missing. */
  pct: number | null;
  status: CompareStatus;
};

/** Compare one metric. A null on either side is "not comparable", never a zero. */
export function compareMetric(def: MetricDef, oursMinor: number | null, theirsMinor: number | null): MetricComparison {
  const base = { key: def.key, label: def.label, oursMinor, theirsMinor };
  if (!Number.isInteger(oursMinor) || !Number.isInteger(theirsMinor)) {
    return { ...base, oursMinor: Number.isInteger(oursMinor) ? oursMinor : null, theirsMinor: Number.isInteger(theirsMinor) ? theirsMinor : null, diffMinor: null, pct: null, status: "not_comparable" };
  }
  const ours = oursMinor as number;
  const theirs = theirsMinor as number;
  const diff = ours - theirs;
  const pct = theirs === 0 ? null : Math.round((diff / Math.abs(theirs)) * 1000) / 10;
  let status: CompareStatus;
  if (def.direction === "info") status = "info";
  else if (diff === 0) status = "even";
  else status = (def.direction === "up" ? diff > 0 : diff < 0) ? "ahead" : "behind";
  return { ...base, diffMinor: diff, pct, status };
}

/** A period's totals for one side, with how many of its days actually have a figure. */
export type PeriodTotals = {
  from: string;
  to: string;
  daysInPeriod: number;
  daysWithData: number;
  /** null for a metric when no day in the period has data (never 0). */
  totals: Record<MetricKey, number | null>;
};

/** Sum cents rows (either side, same shape) over from..to inclusive. */
export function sumPeriod(rows: readonly BenchmarkDayRow[], from: string, to: string): PeriodTotals {
  const totals = Object.fromEntries(METRICS.map((m) => [m.key, null])) as Record<MetricKey, number | null>;
  let daysWithData = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    if (!isDay(r.day) || r.day < from || r.day > to || seen.has(r.day)) continue;
    seen.add(r.day);
    daysWithData++;
    for (const m of METRICS) {
      const v = r[m.field];
      if (Number.isInteger(v)) totals[m.key] = (totals[m.key] ?? 0) + (v as number);
    }
  }
  return { from, to, daysInPeriod: daysInRange(from, to), daysWithData, totals };
}

export type PeriodComparison = {
  ours: PeriodTotals;
  theirs: PeriodTotals;
  /** Both sides have a figure for every day of their period. */
  complete: boolean;
  metrics: MetricComparison[];
  ahead: number;
  behind: number;
};

/**
 * Compare two periods metric by metric. If either side is missing days the comparison is still shown, but
 * `complete` is false and every verdict becomes not_comparable: a partial period cannot win or lose.
 */
export function comparePeriods(ours: PeriodTotals, theirs: PeriodTotals): PeriodComparison {
  const complete =
    ours.daysInPeriod > 0 &&
    theirs.daysInPeriod > 0 &&
    ours.daysWithData === ours.daysInPeriod &&
    theirs.daysWithData === theirs.daysInPeriod &&
    ours.daysInPeriod === theirs.daysInPeriod;
  const metrics = METRICS.map((m) => {
    const c = compareMetric(m, ours.totals[m.key], theirs.totals[m.key]);
    return complete || c.status === "not_comparable" ? c : { ...c, status: "not_comparable" as const };
  });
  return {
    ours,
    theirs,
    complete,
    metrics,
    ahead: metrics.filter((m) => m.status === "ahead").length,
    behind: metrics.filter((m) => m.status === "behind").length,
  };
}

// ---------------------------------------------------------------------------
// 3. PAYBACK
// ---------------------------------------------------------------------------

export type PaybackKind = "build_cost" | "saving" | "outperform" | "adjustment";

export type PaybackEntry = {
  entryKey: string;
  entryDate: string;
  kind: PaybackKind;
  amountMinor: number;
  note: string;
};

/** The two figures 0337 seeds (the owner's words, 2026-11-01). */
export const OWNER_BUILD_COST_MINOR = 4_000_000;
export const OWNER_FIRST_SAVING_MINOR = 550_000;

export type PaybackSummary = {
  buildCostMinor: number;
  savingsMinor: number;
  outperformMinor: number;
  adjustmentsMinor: number;
  /** What is still to be paid back (never below 0). */
  remainingMinor: number;
  /** How far past paid-back we are (0 until then). */
  aheadByMinor: number;
  /** Paid back so far as a percent of the build cost, 1 decimal, capped at 100; null with no build cost. */
  pctPaidBack: number | null;
  /** The first entry date on which the running total reached zero; null if not yet. */
  paidBackOn: string | null;
  /** Rows the summary refused (bad kind / sign / date), listed so nothing is silently ignored. */
  rejected: string[];
};

function validEntry(e: PaybackEntry): string | null {
  if (!e || typeof e.entryKey !== "string" || e.entryKey.length < 3) return "missing key";
  if (!isDay(e.entryDate)) return `${e.entryKey}: bad date`;
  if (!Number.isInteger(e.amountMinor)) return `${e.entryKey}: amount not whole cents`;
  if (!["build_cost", "saving", "outperform", "adjustment"].includes(e.kind)) return `${e.entryKey}: unknown kind`;
  if (e.kind !== "adjustment" && e.amountMinor <= 0) return `${e.entryKey}: must be positive`;
  return null;
}

/**
 * Remaining = build cost - savings - outperformance - adjustments. (An adjustment is signed the way it
 * reduces the debt: +X pays down X more, -X puts X back.) The same sign rules as the 0337 check.
 */
export function paybackSummary(entries: readonly PaybackEntry[]): PaybackSummary {
  const rejected: string[] = [];
  const seen = new Set<string>();
  const ok: PaybackEntry[] = [];
  for (const e of entries) {
    const bad = validEntry(e);
    if (bad) rejected.push(bad);
    else if (seen.has(e.entryKey)) rejected.push(`${e.entryKey}: listed twice`);
    else {
      seen.add(e.entryKey);
      ok.push(e);
    }
  }
  ok.sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : a.kind === "build_cost" ? -1 : b.kind === "build_cost" ? 1 : 0));
  let build = 0;
  let savings = 0;
  let outp = 0;
  let adj = 0;
  let paidBackOn: string | null = null;
  for (const e of ok) {
    if (e.kind === "build_cost") build += e.amountMinor;
    else if (e.kind === "saving") savings += e.amountMinor;
    else if (e.kind === "outperform") outp += e.amountMinor;
    else adj += e.amountMinor;
    const left = build - savings - outp - adj;
    if (build > 0 && left <= 0 && paidBackOn === null) paidBackOn = e.entryDate;
    if (left > 0) paidBackOn = null; // a later build cost or negative adjustment re-opens it
  }
  const net = build - savings - outp - adj;
  const paid = build - Math.max(0, net);
  return {
    buildCostMinor: build,
    savingsMinor: savings,
    outperformMinor: outp,
    adjustmentsMinor: adj,
    remainingMinor: Math.max(0, net),
    aheadByMinor: Math.max(0, -net),
    pctPaidBack: build > 0 ? Math.min(100, Math.round((paid / build) * 1000) / 10) : null,
    paidBackOn: net <= 0 && build > 0 ? paidBackOn : null,
    rejected,
  };
}

/** The key an outperformance credit is stored under: once per metric and period, ever. */
export function outperformKey(metric: MetricKey, from: string, to: string): string {
  return `outperform:${metric}:${from}:${to}`;
}

export type OutperformCredit = {
  entryKey: string;
  entryDate: string;
  kind: "outperform";
  amountMinor: number;
  note: string;
  basis: { metric: MetricKey; from: string; to: string; oursMinor: number; theirsMinor: number; theirsFrom: string; theirsTo: string };
};

/**
 * What an outperformance credit for a CLOSED, COMPLETE period would be, or why there is none. Only an "up"
 * metric can be credited, and only its positive measured difference: never estimated, never negative.
 */
export function outperformCredit(
  cmp: PeriodComparison,
  metric: MetricKey,
  todayPacific: string,
): OutperformCredit | string {
  const def = METRICS.find((m) => m.key === metric);
  if (!def || def.direction !== "up") return "only a more-is-better metric can be credited";
  if (!isDay(todayPacific) || !(cmp.ours.to < todayPacific)) return "the period is not closed yet";
  if (!cmp.complete) return "one side is missing days in this period";
  const m = cmp.metrics.find((x) => x.key === metric);
  if (!m || m.diffMinor === null || m.oursMinor === null || m.theirsMinor === null) return "no figure to compare";
  if (m.diffMinor <= 0) return "we did not beat Cultivera on this metric for this period";
  return {
    entryKey: outperformKey(metric, cmp.ours.from, cmp.ours.to),
    entryDate: cmp.ours.to,
    kind: "outperform",
    amountMinor: m.diffMinor,
    note: `${def.label} ${cmp.ours.from}..${cmp.ours.to} beat Cultivera's ${cmp.theirs.from}..${cmp.theirs.to}`,
    basis: { metric, from: cmp.ours.from, to: cmp.ours.to, oursMinor: m.oursMinor, theirsMinor: m.theirsMinor, theirsFrom: cmp.theirs.from, theirsTo: cmp.theirs.to },
  };
}

/** Validate an owner-entered saving ("dollars" text such as "5,500" or "5500.00"). */
export function savingFromInput(input: { dollars: string; date: string; note: string }): Omit<PaybackEntry, "entryKey"> | string {
  const text = (input.dollars ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return "enter a dollar amount such as 5500 or 5,500.00";
  const cents = dollarsToCents(Number(text));
  if (cents === null || cents <= 0) return "the amount must be more than $0";
  if (cents > 100_000_000) return "the amount is more than $1,000,000; check it";
  if (!isDay(input.date)) return "pick the date of the saving";
  const note = (input.note ?? "").trim();
  if (note.length < 1 || note.length > 1000) return "say what was saved (1 to 1,000 characters)";
  return { entryDate: input.date, kind: "saving", amountMinor: cents, note };
}

/** "$34,500.00" / "-$5.00" for cents. */
export function formatCents(minor: number | null): string {
  if (minor === null || !Number.isInteger(minor)) return "not available";
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${neg ? "-" : ""}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runCultiveraBenchmarkCoreTests(): { passed: number; failed: number } {
  let n = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`cultivera-benchmark-core: ${m}`);
    n++;
  };

  // dollars -> cents
  ok(dollarsToCents(8684.14) === 868414 && dollarsToCents(1.005) === 101 && dollarsToCents(-1.005) === -101, "cents rounding");
  ok(dollarsToCents(0) === 0 && dollarsToCents(-0) === 0 && dollarsToCents(Number.NaN) === null && dollarsToCents("1") === null, "cents edge");
  ok(isDay("2024-02-29") && !isDay("2026-02-29") && !isDay("2026-13-01") && !isDay("x"), "isDay");
  ok(daysInRange("2026-10-01", "2026-10-31") === 31 && daysInRange("2026-10-02", "2026-10-01") === 0, "daysInRange");
  const ly = samePeriodLastYear("2028-02-29", "2028-03-31");
  ok(ly?.from === "2027-02-28" && ly.to === "2027-03-31" && samePeriodLastYear("2026-02-02", "2026-02-01") === null, "last year");

  // ingest: the measured 2026-10-31 row
  const measured = { Day: 31, Month: 10, Year: 2026, GrossSales: 8684.14, Discounts: 2577.7, Taxes: 2779.9, Returns: 0.0, CashRedemption: 0.0, NetSales: 6106.44, Cost: 3686.18, GrossProfit: 4997.96, NetProfit: 2420.26 };
  const r = normalizeDailySalesRow(measured);
  ok(typeof r !== "string" && r.day === "2026-10-31" && r.gross_sales_minor === 868414 && r.discounts_minor === 257770 && r.net_sales_minor === 610644 && r.cost_minor === 368618, "measured row");
  ok(normalizeDailySalesRow({ ...measured, Day: 30, Month: 2 }) === "not a calendar date (2026-02-30)", "bad date");
  ok(String(normalizeDailySalesRow({ ...measured, Cost: null })).includes("Cost"), "missing money refused");
  const norm = normalizeDailySales([
    measured,
    { ...measured },
    { ...measured, Day: 1, Month: 1 },
    { ...measured, Day: 1, Month: 1, NetSales: 1 },
    { ...measured, Day: 2, Month: 1, Year: 2026 },
    { Day: "x" } as CultiveraDailySalesRaw,
  ]);
  ok(norm.rows.map((x) => x.day).join() === "2026-01-02,2026-10-31" && norm.duplicates === 2 && norm.conflicts.join() === "2026-01-01" && norm.problems.length === 1 && norm.problems[0].index === 5, "normalize: sorted, dupes, conflicts kept out");
  ok(dayBatches([1, 2, 3, 4, 5], 2).length === 3 && dayBatches([], 2).length === 0, "batches");

  // manifest -> register files
  const sha = "a".repeat(64);
  const good = manifestToRegisterFiles({ files: [{ name: "manifest.json", bytes: 1, sha256: sha }, { name: "orders.2024-08.jsonl.gz", bytes: 9, sha256: sha, rows: 40 }, { name: "cycle_count_details.cc00012.jsonl.gz", bytes: 9, sha256: sha, rows: 3 }, { name: "errors.jsonl", bytes: 0, sha256: sha, rows: null }] });
  ok(good.problems.length === 0 && good.files.length === 4 && good.files[0].rows === null && good.files[1].rows === 40, "manifest ok");
  const bad = manifestToRegisterFiles({ files: [{ name: "../x.json", bytes: 1, sha256: sha }, { name: "a.json", bytes: -1, sha256: "no" }, { name: "a.json", bytes: 1, sha256: sha }] });
  ok(bad.files.length === 0 && bad.problems.length === 4, "manifest refused whole");
  ok(manifestToRegisterFiles(null).problems[0] === "the manifest has no file list" && manifestToRegisterFiles({ files: [] }).problems.length === 1, "empty manifest");
  ok(ARCHIVE_FILE_NAME_RE.test("sales_lines.p0003.jsonl.gz") && ARCHIVE_FILE_NAME_RE.test("valuation_snapshot_rows.s00001.jsonl.gz") && !ARCHIVE_FILE_NAME_RE.test("Sales.json"), "file names");

  // RPC answers
  const run = "20261101T200000Z-0337abcd";
  ok(parseRegisterResult({ status: "archived", run_id: run, files: 3, bytes: 7100, rows: 42 })?.status === "archived", "register archived");
  ok(parseRegisterResult({ status: "already", run_id: run })?.status === "already", "register already");
  ok(parseRegisterResult({ status: "archived", run_id: run, files: 1.5, bytes: 1, rows: 1 }) === null && parseRegisterResult({ status: "x", run_id: run }) === null && parseRegisterResult({ status: "already", run_id: "../" }) === null, "register refused");
  ok(parseDaysResult({ rows: 2, written: 1, kept_newer: 1 })?.keptNewer === 1 && parseDaysResult({ rows: 2, written: 2, kept_newer: 1 }) === null, "days result");
  ok(isValidArchiveRunId(run) && !isValidArchiveRunId("x"), "run id");

  // compare
  const gs = METRICS.find((m) => m.key === "gross_sales")!;
  const disc = METRICS.find((m) => m.key === "discounts")!;
  const cost = METRICS.find((m) => m.key === "cost")!;
  ok(compareMetric(gs, 110, 100).status === "ahead" && compareMetric(gs, 110, 100).pct === 10, "up ahead");
  ok(compareMetric(disc, 110, 100).status === "behind" && compareMetric(disc, 90, 100).status === "ahead", "down metric");
  ok(compareMetric(cost, 1, 2).status === "info" && compareMetric(gs, 5, 5).status === "even", "info / even");
  const nc = compareMetric(gs, null, 100);
  ok(nc.status === "not_comparable" && nc.diffMinor === null && nc.oursMinor === null && nc.theirsMinor === 100, "missing is never zero");
  ok(compareMetric(gs, 10, 0).pct === null && compareMetric(gs, -10, -20).pct === 50, "pct edge");

  const theirsRows: BenchmarkDayRow[] = [
    { day: "2025-10-01", gross_sales_minor: 1000, discounts_minor: 100, taxes_minor: 300, returns_minor: 0, net_sales_minor: 900, cost_minor: 400, gross_profit_minor: 600, net_profit_minor: 500, cash_redemption_minor: 0 },
    { day: "2025-10-02", gross_sales_minor: 1000, discounts_minor: 100, taxes_minor: 300, returns_minor: 10, net_sales_minor: 890, cost_minor: 400, gross_profit_minor: 600, net_profit_minor: 490, cash_redemption_minor: 0 },
  ];
  const oursRows: BenchmarkDayRow[] = theirsRows.map((x) => ({ ...x, day: x.day.replace("2025", "2026"), gross_sales_minor: 1200, gross_profit_minor: 750, discounts_minor: 50 }));
  const theirs = sumPeriod(theirsRows, "2025-10-01", "2025-10-02");
  const ours = sumPeriod(oursRows, "2026-10-01", "2026-10-02");
  ok(theirs.totals.gross_sales === 2000 && theirs.totals.returns === 10 && theirs.daysWithData === 2, "sum period");
  const cmp = comparePeriods(ours, theirs);
  ok(cmp.complete && cmp.metrics.find((m) => m.key === "gross_profit")!.diffMinor === 300 && cmp.ahead === 3 && cmp.behind === 0, "complete compare");
  const empty = sumPeriod([], "2026-11-01", "2026-11-01");
  ok(empty.totals.gross_sales === null && empty.daysWithData === 0, "empty period is null, not 0");
  const partial = comparePeriods(sumPeriod(oursRows, "2026-10-01", "2026-10-03"), sumPeriod(theirsRows, "2025-10-01", "2025-10-03"));
  ok(!partial.complete && partial.metrics.every((m) => m.status === "not_comparable") && partial.ahead === 0, "partial cannot win");

  // payback: the owner's figures
  const seed: PaybackEntry[] = [
    { entryKey: "owner-build-cost", entryDate: "2026-11-01", kind: "build_cost", amountMinor: OWNER_BUILD_COST_MINOR, note: "40k" },
    { entryKey: "owner-saving-2026-11-01", entryDate: "2026-11-01", kind: "saving", amountMinor: OWNER_FIRST_SAVING_MINOR, note: "5500" },
  ];
  const s0 = paybackSummary(seed);
  ok(s0.remainingMinor === 3_450_000 && s0.pctPaidBack === 13.8 && s0.paidBackOn === null && formatCents(s0.remainingMinor) === "$34,500.00", "owner start: $34,500 left");
  const credit = outperformCredit(cmp, "gross_profit", "2026-11-01");
  ok(typeof credit !== "string" && credit.amountMinor === 300 && credit.entryKey === "outperform:gross_profit:2026-10-01:2026-10-02" && credit.basis.theirsMinor === 1200, "credit = measured diff");
  ok(outperformCredit(cmp, "gross_profit", "2026-10-02") === "the period is not closed yet", "open period");
  ok(outperformCredit(cmp, "discounts", "2026-11-01") === "only a more-is-better metric can be credited", "down metric not credited");
  ok(outperformCredit(partial, "gross_profit", "2026-11-01") === "one side is missing days in this period", "partial not credited");
  const behind = comparePeriods(theirs, ours);
  ok(String(outperformCredit(behind, "gross_profit", "2026-11-01")).includes("did not beat"), "never a negative credit");

  const s1 = paybackSummary([...seed,
    { entryKey: "big", entryDate: "2027-03-01", kind: "outperform", amountMinor: 3_000_000, note: "x" },
    { entryKey: "sv2", entryDate: "2027-04-01", kind: "saving", amountMinor: 500_000, note: "x" },
    { entryKey: "fix", entryDate: "2027-05-01", kind: "adjustment", amountMinor: -10_000, note: "x" },
  ]);
  ok(s1.remainingMinor === 0 && s1.aheadByMinor === 40_000 && s1.paidBackOn === "2027-04-01" && s1.pctPaidBack === 100, "paid back");
  const s2 = paybackSummary([...seed, { entryKey: "neg", entryDate: "2026-11-02", kind: "saving", amountMinor: -1, note: "x" }, { ...seed[1] }, { entryKey: "k", entryDate: "2026-02-30", kind: "saving", amountMinor: 1, note: "x" }]);
  ok(s2.rejected.length === 3 && s2.remainingMinor === 3_450_000, "bad rows rejected, listed");
  ok(paybackSummary([]).pctPaidBack === null && paybackSummary([]).remainingMinor === 0, "no build cost");

  // owner-entered saving
  const sv = savingFromInput({ dollars: "$5,500.00", date: "2026-12-01", note: "December Cultivera invoice not charged" });
  ok(typeof sv !== "string" && sv.amountMinor === 550_000 && sv.kind === "saving", "saving parsed");
  ok(typeof savingFromInput({ dollars: "5.555", date: "2026-12-01", note: "x" }) === "string" && typeof savingFromInput({ dollars: "0", date: "2026-12-01", note: "x" }) === "string" && typeof savingFromInput({ dollars: "10", date: "bad", note: "x" }) === "string" && typeof savingFromInput({ dollars: "10", date: "2026-12-01", note: " " }) === "string", "saving refused");
  ok(formatCents(-500) === "-$5.00" && formatCents(null) === "not available", "format");
  return { passed: n, failed: 0 };
}
