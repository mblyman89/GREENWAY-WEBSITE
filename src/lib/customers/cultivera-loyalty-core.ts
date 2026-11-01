/**
 * src/lib/customers/cultivera-loyalty-core.ts  (CVL - owner interrupt, 2026-11-01)
 *
 * Owner (verbatim): "cultivera, naturally, does not provide the total loyalty
 * earned, spent, or current amount in the downloadable spreadsheet. which means
 * I need you to add to this fetcher the ability to slowly crawl through each
 * customer record and pull out this info and automatically apply the data to
 * the customers in our back office."
 *
 * PURE (no I/O). Turns the crawler's verified files into the rows that
 * apply_cultivera_loyalty (migration 0336) takes, plus the preview staff
 * review before applying (rule 3: crawler output is a draft until a person
 * applies it).
 *
 * Facts (measured live 2026-11-01, crawler/app/cultivera_loyalty.py):
 *  - Cultivera's customer record carries LoyaltyPoints = the CURRENT balance
 *    (a decimal, e.g. 509.13) and LoyaltyPointsApplied = points spent.
 *  - "Earned" is not on the record. It is the accrual report summed by type:
 *    1 Create Order + 5 Initial Loyalty Points (+ signed type 7 adjustments,
 *    shown separately). Cultivera's balance does NOT always equal its own
 *    history (customer 2322: 783 + 694.23 - 900 = 577.23, record says 509.13),
 *    so the balance is ALWAYS the record's value and never derived. The
 *    difference is shown, never "fixed".
 *  - Our ledger stores whole points. The opening credit is the Cultivera
 *    balance rounded to the nearest point (509.13 -> 509, 675.6 -> 676); the
 *    exact decimal is kept in customer_cultivera_loyalty.
 *  - Money in minor units: LoyaltyAmountApplied and Total are dollars there.
 */

export const APPLY_BATCH_SIZE = 500; // apply_cultivera_loyalty refuses more
export const LOYALTY_FILE = "customer_loyalty.jsonl";
export const ACCRUAL_FILE = "accrual_totals.json";
export const SKIPPED_FILE = "skipped.jsonl";

/** One line of customer_loyalty.jsonl (the crawler writes only these keys). */
export type CrawledLoyalty = {
  Id: number;
  CustomerNo?: string | null;
  LoyaltyPoints: number;
  LoyaltyPointsApplied?: number | null;
  LoyaltyAmountApplied?: number | null;
  Total?: number | null;
  NumberOfOrders?: number | null;
  TotalUnits?: number | null;
  IsDeleted?: boolean | null;
};

export type AccrualTotals = {
  rows: number;
  earnedOrders: number;
  returned: number;
  applied: number;
  cancelled: number;
  initial: number;
  adjusted: number;
};

export type AccrualFile = {
  count?: number;
  dateFrom?: string;
  dateTo?: string;
  unknownTypes?: Record<string, number>;
  customers?: Record<string, Partial<AccrualTotals>>;
};

/** The json each element of apply_cultivera_loyalty's p_rows array must be. */
export type ApplyRow = {
  external_id: string;
  balance: number;
  spent_points: number;
  spent_minor: number;
  earned_orders: number | null;
  initial: number | null;
  adjusted: number | null;
  returned: number | null;
  cancelled: number | null;
  accrual_rows: number | null;
  orders: number | null;
  total_minor: number | null;
  deleted: boolean;
  opening_points: number;
};

export type RowProblem = { externalId: string; problem: string };

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Dollars (float) -> cents, rounded half away from zero at the boundary (rule 8). */
export function dollarsToMinor(d: number): number {
  // toFixed(6) first: 1.005 * 100 is 100.49999999999999 in binary floating point.
  const cents = Math.round(Number((Math.abs(d) * 100).toFixed(6)));
  return d < 0 ? -cents : cents;
}
/** Whole points our ledger credits for a Cultivera balance (nearest point; never negative). */
export function openingPoints(balance: number): number {
  if (!fin(balance) || balance <= 0) return 0;
  return Math.round(balance);
}

/** Cultivera's "total earned" = orders + initial points (adjustments are shown on their own). */
export function earnedTotal(a: Partial<AccrualTotals> | undefined): number | null {
  if (!a) return null;
  return r2((a.earnedOrders ?? 0) + (a.initial ?? 0));
}

/**
 * What Cultivera's own history says the balance should be. Only to SHOW a
 * difference; the record's balance always wins.
 */
export function historyBalance(a: Partial<AccrualTotals> | undefined): number | null {
  if (!a) return null;
  return r2((a.initial ?? 0) + (a.earnedOrders ?? 0) + (a.adjusted ?? 0) - (a.applied ?? 0) + (a.cancelled ?? 0) - (a.returned ?? 0));
}

/** Build the apply rows. A record that is not a usable number is listed, never guessed. */
export function buildApplyRows(
  records: CrawledLoyalty[],
  accrual: AccrualFile | null,
): { rows: ApplyRow[]; problems: RowProblem[]; duplicates: number } {
  const byCustomer = accrual?.customers ?? {};
  const seen = new Set<string>();
  const rows: ApplyRow[] = [];
  const problems: RowProblem[] = [];
  let duplicates = 0;
  for (const rec of records) {
    const id = Number.isInteger(rec?.Id) && rec.Id > 0 ? String(rec.Id) : "";
    if (!id) {
      problems.push({ externalId: String(rec?.Id ?? "?"), problem: "no Cultivera customer id" });
      continue;
    }
    if (seen.has(id)) {
      duplicates++;
      continue;
    }
    seen.add(id);
    if (!fin(rec.LoyaltyPoints)) {
      problems.push({ externalId: id, problem: "the Cultivera record has no loyalty balance" });
      continue;
    }
    if (rec.LoyaltyPoints < 0) {
      problems.push({ externalId: id, problem: `Cultivera shows a negative balance (${rec.LoyaltyPoints}); nothing is credited` });
    }
    const a = byCustomer[id];
    rows.push({
      external_id: id,
      balance: r2(rec.LoyaltyPoints),
      spent_points: fin(rec.LoyaltyPointsApplied) ? r2(rec.LoyaltyPointsApplied) : 0,
      spent_minor: fin(rec.LoyaltyAmountApplied) ? dollarsToMinor(rec.LoyaltyAmountApplied) : 0,
      earned_orders: a ? r2(a.earnedOrders ?? 0) : null,
      initial: a ? r2(a.initial ?? 0) : null,
      adjusted: a ? r2(a.adjusted ?? 0) : null,
      returned: a ? r2(a.returned ?? 0) : null,
      cancelled: a ? r2(a.cancelled ?? 0) : null,
      accrual_rows: a ? Math.trunc(a.rows ?? 0) : null,
      orders: fin(rec.NumberOfOrders) ? Math.trunc(rec.NumberOfOrders) : null,
      total_minor: fin(rec.Total) ? dollarsToMinor(rec.Total) : null,
      deleted: rec.IsDeleted === true,
      opening_points: openingPoints(rec.LoyaltyPoints),
    });
  }
  return { rows, problems, duplicates };
}

export type LoyaltyPreview = {
  crawled: number;
  matched: number;
  unmatched: number;
  unmatchedSample: string[];
  toCredit: number;
  pointsToCredit: number;
  alreadyCredited: number;
  zeroBalance: number;
  deletedInCultivera: number;
  historyDiffers: number;
  historyDiffersSample: { externalId: string; balance: number; history: number }[];
  totals: { balance: number; spent: number; earned: number };
  problems: RowProblem[];
  unknownAccrualTypes: Record<string, number>;
};

/**
 * The preview staff review before applying. `ours` = Cultivera ids that are
 * customers here; `credited` = ids whose opening was already credited.
 */
export function previewApply(
  rows: ApplyRow[],
  ours: ReadonlySet<string>,
  credited: ReadonlySet<string>,
  problems: RowProblem[] = [],
  accrual: AccrualFile | null = null,
): LoyaltyPreview {
  const p: LoyaltyPreview = {
    crawled: rows.length,
    matched: 0,
    unmatched: 0,
    unmatchedSample: [],
    toCredit: 0,
    pointsToCredit: 0,
    alreadyCredited: 0,
    zeroBalance: 0,
    deletedInCultivera: 0,
    historyDiffers: 0,
    historyDiffersSample: [],
    totals: { balance: 0, spent: 0, earned: 0 },
    problems,
    unknownAccrualTypes: accrual?.unknownTypes ?? {},
  };
  for (const r of rows) {
    if (!ours.has(r.external_id)) {
      p.unmatched++;
      if (p.unmatchedSample.length < 20) p.unmatchedSample.push(r.external_id);
      continue;
    }
    p.matched++;
    if (r.deleted) p.deletedInCultivera++;
    p.totals.balance = r2(p.totals.balance + r.balance);
    p.totals.spent = r2(p.totals.spent + r.spent_points);
    p.totals.earned = r2(p.totals.earned + (r.earned_orders ?? 0) + (r.initial ?? 0));
    if (r.opening_points <= 0) p.zeroBalance++;
    else if (credited.has(r.external_id)) p.alreadyCredited++;
    else {
      p.toCredit++;
      p.pointsToCredit += r.opening_points;
    }
    const a = accrual?.customers?.[r.external_id];
    const h = historyBalance(a);
    if (h !== null && Math.abs(h - r.balance) >= 0.01) {
      p.historyDiffers++;
      if (p.historyDiffersSample.length < 20) p.historyDiffersSample.push({ externalId: r.external_id, balance: r.balance, history: h });
    }
  }
  return p;
}

/** Only rows for our customers, in batches the function accepts. */
export function applyBatches(rows: ApplyRow[], ours: ReadonlySet<string>, size = APPLY_BATCH_SIZE): ApplyRow[][] {
  const mine = rows.filter((r) => ours.has(r.external_id));
  const out: ApplyRow[][] = [];
  for (let i = 0; i < mine.length; i += size) out.push(mine.slice(i, i + size));
  return out;
}

export type ApplyResult = { rows: number; matched: number; unmatched: number; accountsCreated: number; openingsCredited: number; openingsAlreadyDone: number };

export function sumResults(results: ApplyResult[]): ApplyResult {
  const z: ApplyResult = { rows: 0, matched: 0, unmatched: 0, accountsCreated: 0, openingsCredited: 0, openingsAlreadyDone: 0 };
  for (const r of results) for (const k of Object.keys(z) as (keyof ApplyResult)[]) z[k] += Number(r?.[k] ?? 0);
  return z;
}

/** Read one apply_cultivera_loyalty answer; anything else is an error, never a guess. */
export function parseApplyResult(v: unknown): ApplyResult | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const keys: (keyof ApplyResult)[] = ["rows", "matched", "unmatched", "accountsCreated", "openingsCredited", "openingsAlreadyDone"];
  const out = {} as ApplyResult;
  for (const k of keys) {
    if (typeof o[k] !== "number" || !Number.isInteger(o[k])) return null;
    out[k] = o[k] as number;
  }
  return out;
}

export type CrawlState = {
  status?: string;
  error?: string;
  progress?: { total?: number | null; saved?: number; skipped?: number };
  stages?: Record<string, { status?: string } | undefined>;
};

/** One plain line for the run page. */
export function crawlSummary(active: boolean, s: CrawlState | null): { line: string; canApply: boolean; canResume: boolean } {
  const st = s?.status ?? "pending";
  const total = s?.progress?.total ?? null;
  const done = (s?.progress?.saved ?? 0) + (s?.progress?.skipped ?? 0);
  const of = total ? `${done.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} customers read` : "listing customers";
  if (active || st === "running") return { line: `Running: ${of}. It goes slowly on purpose; you can leave this page.`, canApply: false, canResume: false };
  if (st === "done") return { line: `Finished: ${of}. Review the preview, then apply.`, canApply: true, canResume: false };
  if (st === "paused") return { line: `Paused after its time limit: ${of}. Press Continue to pick up where it stopped.`, canApply: false, canResume: true };
  if (st === "cancelled") return { line: `Stopped: ${of}. Press Continue to pick up where it stopped.`, canApply: false, canResume: true };
  if (st === "failed") return { line: `Stopped with a problem: ${s?.error ?? "unknown"}. ${of}. Press Continue to retry the rest.`, canApply: false, canResume: true };
  return { line: "Not started.", canApply: false, canResume: false };
}

/** Parse customer_loyalty.jsonl. A line that is not a record is counted. */
export function parseLoyaltyJsonl(text: string): { records: CrawledLoyalty[]; bad: number } {
  const records: CrawledLoyalty[] = [];
  let bad = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const v = JSON.parse(t) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) records.push(v as CrawledLoyalty);
      else bad++;
    } catch {
      bad++;
    }
  }
  return { records, bad };
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runCultiveraLoyaltyCoreTests(): { passed: number; failed: number } {
  let n = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`cultivera-loyalty-core: ${m}`);
    n++;
  };
  // Measured customers (2026-11-01).
  const recs: CrawledLoyalty[] = [
    { Id: 2322, LoyaltyPoints: 509.13, LoyaltyPointsApplied: 900, LoyaltyAmountApplied: 0, Total: 1234.56, NumberOfOrders: 20, IsDeleted: false },
    { Id: 5219, LoyaltyPoints: 675.6, LoyaltyPointsApplied: 2100, LoyaltyAmountApplied: 1.005, Total: 999, NumberOfOrders: 30 },
    { Id: 1, LoyaltyPoints: 0, LoyaltyPointsApplied: 0, Total: 116, NumberOfOrders: 4 },
    { Id: 2322, LoyaltyPoints: 1 },
    { Id: 77, LoyaltyPoints: Number.NaN },
    { Id: 78, LoyaltyPoints: -3, IsDeleted: true },
    { Id: 0, LoyaltyPoints: 5 },
  ];
  const acc: AccrualFile = {
    unknownTypes: { "9": 2 },
    customers: {
      "2322": { rows: 24, initial: 783, earnedOrders: 694.23, applied: 900 },
      "1": { rows: 5, initial: 20, earnedOrders: 116 },
    },
  };
  const { rows, problems, duplicates } = buildApplyRows(recs, acc);
  ok(rows.length === 4 && duplicates === 1, "dedupe by id, first copy wins");
  ok(problems.some((p) => p.externalId === "77") && problems.some((p) => p.problem.includes("negative")) && problems.some((p) => p.problem.includes("no Cultivera customer id")), "problems listed");
  const a = rows.find((r) => r.external_id === "2322")!;
  ok(a.balance === 509.13 && a.opening_points === 509 && a.spent_points === 900, "2322 balance from the record");
  ok(a.total_minor === 123456 && a.earned_orders === 694.23 && a.initial === 783 && a.accrual_rows === 24, "2322 money in cents + accrual");
  const b = rows.find((r) => r.external_id === "5219")!;
  ok(b.opening_points === 676 && b.earned_orders === null && b.spent_minor === 101, "5219 rounds to nearest, no accrual = null");
  ok(rows.find((r) => r.external_id === "78")!.opening_points === 0, "negative balance credits 0");
  ok(openingPoints(0.4) === 0 && openingPoints(0.5) === 1 && openingPoints(-1) === 0, "openingPoints");
  ok(dollarsToMinor(-1.005) === -101 && dollarsToMinor(0) === 0, "dollarsToMinor symmetric");
  ok(earnedTotal(acc.customers!["2322"]) === 1477.23 && earnedTotal(undefined) === null, "earned = orders + initial");
  ok(historyBalance(acc.customers!["2322"]) === 577.23, "history balance (the measured mismatch)");

  const ours = new Set(["2322", "5219", "1"]);
  const pv = previewApply(rows, ours, new Set(["5219"]), problems, acc);
  ok(pv.matched === 3 && pv.unmatched === 1 && pv.unmatchedSample[0] === "78", "match by Cultivera id");
  ok(pv.toCredit === 1 && pv.pointsToCredit === 509 && pv.alreadyCredited === 1 && pv.zeroBalance === 1, "credit counts");
  // Both measured mismatches: 2322 (record 509.13 vs history 577.23) and 1 (record 0 vs history 136).
  ok(pv.historyDiffers === 2 && pv.historyDiffersSample.map((x) => x.externalId).join() === "2322,1", "history differences shown");
  ok(pv.unknownAccrualTypes["9"] === 2, "unknown accrual types surfaced");
  ok(pv.totals.balance === 1184.73 && pv.totals.spent === 3000, "totals");

  const batches = applyBatches(rows, ours, 2);
  ok(batches.length === 2 && batches[0].length === 2 && batches.flat().every((r) => ours.has(r.external_id)), "batches only ours");
  ok(applyBatches([], ours).length === 0, "no rows no batches");

  ok(parseApplyResult({ rows: 1, matched: 1, unmatched: 0, accountsCreated: 1, openingsCredited: 1, openingsAlreadyDone: 0 })?.matched === 1, "parse result");
  ok(parseApplyResult({ rows: 1 }) === null && parseApplyResult(null) === null && parseApplyResult({ rows: 1.5, matched: 1, unmatched: 0, accountsCreated: 0, openingsCredited: 0, openingsAlreadyDone: 0 }) === null, "bad result refused");
  const sum = sumResults([
    { rows: 2, matched: 2, unmatched: 0, accountsCreated: 1, openingsCredited: 2, openingsAlreadyDone: 0 },
    { rows: 1, matched: 0, unmatched: 1, accountsCreated: 0, openingsCredited: 0, openingsAlreadyDone: 1 },
  ]);
  ok(sum.rows === 3 && sum.openingsCredited === 2 && sum.openingsAlreadyDone === 1, "sum");

  ok(crawlSummary(true, { status: "running", progress: { total: 16588, saved: 100, skipped: 2 } }).line.includes("102 of 16,588"), "running line");
  ok(crawlSummary(false, { status: "done" }).canApply, "done can apply");
  ok(!crawlSummary(false, { status: "paused" }).canApply && crawlSummary(false, { status: "paused" }).canResume, "paused resumes");
  ok(crawlSummary(false, { status: "failed", error: "x" }).line.includes("x"), "failed shows error");
  ok(!crawlSummary(false, null).canApply, "no state");

  const pj = parseLoyaltyJsonl('{"Id":1,"LoyaltyPoints":2}\n\n[1]\n{bad\n');
  ok(pj.records.length === 1 && pj.bad === 2, "jsonl parse");
  return { passed: n, failed: 0 };
}
