/**
 * src/lib/crypto/crypto-income-report-core.ts
 *
 * R1-F4 — Crypto ORDINARY-INCOME report engine (PURE, float-free).
 * NO I/O, no server-only imports — safe under tsx and vitest.
 *
 * What it does
 * ------------
 * Staking rewards, FTSO/delegation rewards, mining, airdrops, hard forks,
 * interest/yield, referral bonuses and crypto received as payment are ORDINARY
 * INCOME, taxed at the coin's fair-market value (FMV) in USD on the day you
 * received it (dominion & control). That same FMV also becomes the cost basis
 * of those coins going forward — but that basis-lot side already lives in the
 * R1-C cost-basis engine; THIS module produces the INCOME side of the return.
 *
 * It takes a list of priced income events and aggregates them:
 *   • by TAX YEAR (UTC calendar year of receipt),
 *   • split into NON-BUSINESS (Schedule 1 "Other income", flows to Form 1040)
 *     vs BUSINESS/self-employment (Schedule C, subject to SE tax),
 *   • with a per-tag breakdown so the audit binder can show exactly what made
 *     up each number.
 *
 * IRS anchors (see research/r1f-tax-reports-bible.md §§ 40–43, 69–70, 139–140):
 *   • Staking = ordinary income at FMV on dominion & control — Rev. Rul. 2023-14.
 *   • Mining/airdrops/rewards = ordinary income at FMV — Notice 2014-21, FAQ Q57–Q59.
 *   • Hard fork coins = ordinary income at FMV when usable — Rev. Rul. 2019-24, FAQ Q104–Q107.
 *   • Non-business ordinary income → Schedule 1; business/SE → Schedule C — FAQ Q60, Q110.
 *
 * Money math
 * ----------
 * Every FMV is integer USD CENTS (safe-integer range, like the rest of the app).
 * No floats ever touch a dollar amount. Whole-dollar rounding for the return is
 * available at render via centsToWholeDollars (shared with the 8949 engine's
 * convention: half-up on the absolute value, sign preserved).
 */

// ---------------------------------------------------------------------------
// Income tag vocabulary (the createsIncome=true tags from the classification
// core). Kept as an explicit allow-list so a non-income tag can NEVER leak into
// the income report, and so a caller passing a garbage tag is rejected loudly.
// ---------------------------------------------------------------------------

export const INCOME_TAGS = [
  "reward_staking",
  "reward_ftso",
  "reward_mining",
  "airdrop",
  "fork",
  "interest",
  "income_payment",
  "reward_referral",
] as const;

export type IncomeTag = (typeof INCOME_TAGS)[number];

const INCOME_TAG_SET: ReadonlySet<string> = new Set(INCOME_TAGS);

/** True when a tag key is an ordinary-income tag we report here. */
export function isIncomeTag(tag: string): tag is IncomeTag {
  return INCOME_TAG_SET.has(tag);
}

/**
 * Which US schedule an income event lands on.
 *   • "schedule-1" : non-business ordinary income ("Other income"), most cases.
 *   • "schedule-c" : business / self-employment income (mining-as-trade,
 *                    contractor pay), subject to SE tax.
 */
export type IncomeSchedule = "schedule-1" | "schedule-c";

// ---------------------------------------------------------------------------
// Inputs.
// ---------------------------------------------------------------------------

/** One priced ordinary-income receipt. */
export interface IncomeEvent {
  /** Stable id (usually the source transaction id) — for traceability. */
  id: string;
  /** The income tag — MUST be one of INCOME_TAGS. */
  tag: string;
  /** Asset ticker/symbol, e.g. "FLR", "SGB", "BTC" (for the per-asset detail). */
  assetSymbol: string;
  /** Fair-market value in integer USD cents on the receipt date. */
  fmvCents: number;
  /** Receipt timestamp (ms epoch) — determines the tax year (UTC). */
  receivedAtMs: number;
  /**
   * True when this receipt is BUSINESS / self-employment income (Schedule C +
   * SE tax). Defaults to false (non-business → Schedule 1), the conservative
   * common case for a hobby delegator/staker.
   */
  isBusiness?: boolean;
}

export interface BuildIncomeReportInput {
  events: readonly IncomeEvent[];
}

// ---------------------------------------------------------------------------
// Outputs.
// ---------------------------------------------------------------------------

/** Per-tag total within a (year, schedule) bucket. */
export interface IncomeTagTotal {
  tag: IncomeTag;
  eventCount: number;
  amountCents: number;
}

/** A schedule bucket (Schedule 1 or Schedule C) within one tax year. */
export interface IncomeScheduleTotals {
  schedule: IncomeSchedule;
  eventCount: number;
  amountCents: number;
  /** Per-tag breakdown, sorted in INCOME_TAGS display order, non-zero only. */
  byTag: IncomeTagTotal[];
}

/** Everything for one tax year. */
export interface IncomeYearReport {
  taxYear: number;
  schedule1: IncomeScheduleTotals;
  scheduleC: IncomeScheduleTotals;
  /** schedule1.amountCents + scheduleC.amountCents. */
  totalIncomeCents: number;
  eventCount: number;
}

/** The whole income report across all years present. */
export interface IncomeReport {
  /** Years sorted ascending. */
  years: IncomeYearReport[];
  totalIncomeCents: number;
  eventCount: number;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function assertSafeInt(v: number, what: string): number {
  if (!Number.isFinite(v) || !Number.isInteger(v)) {
    throw new Error(`crypto-income-report-core: ${what} must be an integer, got ${String(v)}`);
  }
  if (!Number.isSafeInteger(v)) {
    throw new Error(`crypto-income-report-core: ${what} exceeds safe-integer range`);
  }
  return v;
}

/** UTC calendar year of a ms-epoch timestamp. */
export function taxYearOf(ms: number): number {
  if (!Number.isFinite(ms)) throw new Error("crypto-income-report-core: non-finite timestamp");
  return new Date(Math.trunc(ms)).getUTCFullYear();
}

/**
 * IRS whole-dollar rounding (half-up on the absolute value, sign preserved).
 * Matches the Form 8949 engine's convention so both reports round identically.
 */
export function centsToWholeDollars(cents: number): number {
  assertSafeInt(cents, "cents");
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const rounded = rem >= 50 ? dollars + 1 : dollars;
  return neg ? -rounded : rounded;
}

// Mutable accumulator for one schedule bucket during aggregation.
interface ScheduleAccum {
  eventCount: number;
  amountCents: number;
  byTag: Map<IncomeTag, { eventCount: number; amountCents: number }>;
}

function newScheduleAccum(): ScheduleAccum {
  return { eventCount: 0, amountCents: 0, byTag: new Map() };
}

function addToScheduleAccum(acc: ScheduleAccum, tag: IncomeTag, amountCents: number): void {
  acc.eventCount += 1;
  acc.amountCents += amountCents;
  const cur = acc.byTag.get(tag);
  if (cur) {
    cur.eventCount += 1;
    cur.amountCents += amountCents;
  } else {
    acc.byTag.set(tag, { eventCount: 1, amountCents });
  }
}

function finalizeSchedule(schedule: IncomeSchedule, acc: ScheduleAccum): IncomeScheduleTotals {
  const byTag: IncomeTagTotal[] = [];
  // Emit in the canonical INCOME_TAGS display order, non-zero-count only.
  for (const tag of INCOME_TAGS) {
    const t = acc.byTag.get(tag);
    if (t && t.eventCount > 0) {
      byTag.push({ tag, eventCount: t.eventCount, amountCents: t.amountCents });
    }
  }
  return {
    schedule,
    eventCount: acc.eventCount,
    amountCents: acc.amountCents,
    byTag,
  };
}

// ---------------------------------------------------------------------------
// Top-level builder.
// ---------------------------------------------------------------------------

/**
 * Aggregate priced income events into a per-year, per-schedule report.
 * Rejects any non-income tag (never silently drops or miscategorizes) and any
 * out-of-range money value.
 */
export function buildIncomeReport(input: BuildIncomeReportInput): IncomeReport {
  // year -> { sched1, schedC }
  const byYear = new Map<number, { sched1: ScheduleAccum; schedC: ScheduleAccum }>();

  let totalIncomeCents = 0;
  let eventCount = 0;

  for (const ev of input.events) {
    if (!isIncomeTag(ev.tag)) {
      throw new Error(
        `crypto-income-report-core: event ${ev.id} has non-income tag "${ev.tag}" — refusing to report it as income`,
      );
    }
    assertSafeInt(ev.fmvCents, `event ${ev.id} fmvCents`);
    if (ev.fmvCents < 0) {
      throw new Error(`crypto-income-report-core: event ${ev.id} has negative FMV`);
    }
    const year = taxYearOf(ev.receivedAtMs);

    let bucket = byYear.get(year);
    if (!bucket) {
      bucket = { sched1: newScheduleAccum(), schedC: newScheduleAccum() };
      byYear.set(year, bucket);
    }

    const target = ev.isBusiness ? bucket.schedC : bucket.sched1;
    addToScheduleAccum(target, ev.tag, ev.fmvCents);

    totalIncomeCents += ev.fmvCents;
    eventCount += 1;
  }

  const years: IncomeYearReport[] = [];
  const sortedYears = Array.from(byYear.keys()).sort((a, b) => a - b);
  for (const year of sortedYears) {
    const bucket = byYear.get(year)!;
    const schedule1 = finalizeSchedule("schedule-1", bucket.sched1);
    const scheduleC = finalizeSchedule("schedule-c", bucket.schedC);
    years.push({
      taxYear: year,
      schedule1,
      scheduleC,
      totalIncomeCents: schedule1.amountCents + scheduleC.amountCents,
      eventCount: schedule1.eventCount + scheduleC.eventCount,
    });
  }

  return { years, totalIncomeCents, eventCount };
}

/** Convenience: pull one year's report out of a full report (or null). */
export function incomeYear(report: IncomeReport, taxYear: number): IncomeYearReport | null {
  for (const y of report.years) {
    if (y.taxYear === taxYear) return y;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Self-tests (bare-call style; throws on failure, prints pass line).
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `crypto-income-report-core: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

// A couple of fixed UTC timestamps in known years (no numeric separators).
const T_2023 = Date.UTC(2023, 5, 15); // Jun 15 2023
const T_2024_A = Date.UTC(2024, 0, 1); // Jan 1 2024
const T_2024_B = Date.UTC(2024, 11, 31); // Dec 31 2024
const T_2025 = Date.UTC(2025, 2, 10); // Mar 10 2025

export function __runCryptoIncomeReportCoreTests(): void {
  // --- income-tag allow-list ---
  eq(isIncomeTag("reward_ftso"), true, "FTSO is income");
  eq(isIncomeTag("reward_staking"), true, "staking is income");
  eq(isIncomeTag("airdrop"), true, "airdrop is income");
  eq(isIncomeTag("interest"), true, "interest is income");
  eq(isIncomeTag("buy"), false, "buy is NOT income");
  eq(isIncomeTag("sell"), false, "sell is NOT income");
  eq(isIncomeTag("transfer"), false, "transfer is NOT income");

  // --- whole-dollar rounding parity with 8949 engine ---
  eq(centsToWholeDollars(49), 0, "49c -> $0");
  eq(centsToWholeDollars(50), 1, "50c -> $1");
  eq(centsToWholeDollars(-150), -2, "-150c -> -$2");

  // --- tax year is UTC calendar year ---
  eq(taxYearOf(T_2024_A), 2024, "Jan 1 2024 -> 2024");
  eq(taxYearOf(T_2024_B), 2024, "Dec 31 2024 -> 2024");

  // --- basic Schedule 1 aggregation, single year ---
  const r1 = buildIncomeReport({
    events: [
      { id: "a", tag: "reward_ftso", assetSymbol: "FLR", fmvCents: 1234, receivedAtMs: T_2024_A },
      { id: "b", tag: "reward_ftso", assetSymbol: "FLR", fmvCents: 766, receivedAtMs: T_2024_B },
      { id: "c", tag: "airdrop", assetSymbol: "SGB", fmvCents: 5000, receivedAtMs: T_2024_A },
    ],
  });
  eq(r1.years.length, 1, "one year present");
  eq(r1.years[0].taxYear, 2024, "year is 2024");
  eq(r1.years[0].schedule1.amountCents, 7000, "sched1 total = 1234+766+5000");
  eq(r1.years[0].scheduleC.amountCents, 0, "no business income");
  eq(r1.years[0].totalIncomeCents, 7000, "year total");
  eq(r1.totalIncomeCents, 7000, "report total");
  eq(r1.eventCount, 3, "three events");

  // --- per-tag breakdown in display order, non-zero only ---
  const s1 = r1.years[0].schedule1;
  eq(s1.byTag.length, 2, "two tags present (ftso, airdrop)");
  eq(s1.byTag[0].tag, "reward_ftso", "ftso listed before airdrop (display order)");
  eq(s1.byTag[0].eventCount, 2, "two ftso events");
  eq(s1.byTag[0].amountCents, 2000, "ftso total 1234+766");
  eq(s1.byTag[1].tag, "airdrop", "airdrop second");
  eq(s1.byTag[1].amountCents, 5000, "airdrop total");

  // --- business income routes to Schedule C ---
  const r2 = buildIncomeReport({
    events: [
      { id: "m1", tag: "reward_mining", assetSymbol: "BTC", fmvCents: 100000, receivedAtMs: T_2024_A, isBusiness: true },
      { id: "p1", tag: "income_payment", assetSymbol: "BTC", fmvCents: 50000, receivedAtMs: T_2024_A, isBusiness: true },
      { id: "st", tag: "reward_staking", assetSymbol: "FLR", fmvCents: 2500, receivedAtMs: T_2024_A },
    ],
  });
  eq(r2.years[0].scheduleC.amountCents, 150000, "business income on Schedule C");
  eq(r2.years[0].schedule1.amountCents, 2500, "non-business staking on Schedule 1");
  eq(r2.years[0].totalIncomeCents, 152500, "year total combines both schedules");
  eq(r2.years[0].scheduleC.byTag.length, 2, "two business tags");

  // --- multi-year split, sorted ascending ---
  const r3 = buildIncomeReport({
    events: [
      { id: "y25", tag: "interest", assetSymbol: "USDC", fmvCents: 900, receivedAtMs: T_2025 },
      { id: "y23", tag: "reward_ftso", assetSymbol: "SGB", fmvCents: 300, receivedAtMs: T_2023 },
      { id: "y24", tag: "reward_ftso", assetSymbol: "FLR", fmvCents: 600, receivedAtMs: T_2024_A },
    ],
  });
  eq(r3.years.length, 3, "three distinct years");
  eq(r3.years[0].taxYear, 2023, "first year 2023 (sorted)");
  eq(r3.years[1].taxYear, 2024, "second year 2024");
  eq(r3.years[2].taxYear, 2025, "third year 2025");
  eq(incomeYear(r3, 2025)?.schedule1.amountCents, 900, "lookup 2025 income");
  eq(incomeYear(r3, 2099), null, "missing year -> null");

  // --- rejects a non-income tag loudly (never miscategorizes) ---
  let threwTag = false;
  try {
    buildIncomeReport({ events: [{ id: "bad", tag: "sell", assetSymbol: "FLR", fmvCents: 100, receivedAtMs: T_2024_A }] });
  } catch {
    threwTag = true;
  }
  eq(threwTag, true, "non-income tag rejected");

  // --- rejects negative FMV ---
  let threwNeg = false;
  try {
    buildIncomeReport({ events: [{ id: "neg", tag: "airdrop", assetSymbol: "FLR", fmvCents: -1, receivedAtMs: T_2024_A }] });
  } catch {
    threwNeg = true;
  }
  eq(threwNeg, true, "negative FMV rejected");

  // --- empty input -> empty report ---
  const empty = buildIncomeReport({ events: [] });
  eq(empty.years.length, 0, "no years");
  eq(empty.totalIncomeCents, 0, "zero total");
  eq(empty.eventCount, 0, "zero events");

  console.log("crypto-income-report-core self-tests: all passed");
}
