/**
 * src/lib/crypto/crypto-form8949-core.ts
 *
 * R1-F3 — Form 8949 / Schedule D report engine (PURE, float-free).
 * NO I/O, no server-only imports — safe under tsx and vitest.
 *
 * What it does
 * ------------
 * Consumes the output of the R1-C cost-basis engine (DisposalResult /
 * LotConsumption from crypto-cost-basis-core.ts) and renders it into the exact
 * lines a US taxpayer files:
 *
 *   • IRS Form 8949 rows — one row per (disposal, holding-period) group, with
 *     columns (a) description, (b) date acquired, (c) date sold, (d) proceeds,
 *     (e) cost or other basis, (f)/(g) adjustment code/amount, (h) gain/loss.
 *   • Schedule D totals — net short-term, net long-term, combined net, the
 *     $3,000 capital-loss cap ($1,500 married-filing-separately), and the loss
 *     carried forward to next year.
 *
 * Digital-asset boxes (CRITICAL, per 2024/2025 Form 8949 instructions)
 * --------------------------------------------------------------------
 * Self-custody crypto is NOT reported to the taxpayer on a Form 1099-B/1099-DA
 * (no broker involved). Such transactions go on Form 8949 in:
 *   • Box (I)  — SHORT-term, "transactions not reported to you on Form 1099-B".
 *   • Box (L)  — LONG-term,  "transactions not reported to you on Form 1099-B".
 * (Boxes A/B/D/E are for basis-reported broker sales; C/F are legacy non-crypto
 * "other". For self-custody digital assets the correct boxes are I and L.)
 *
 * VARIOUS date-acquired
 * ---------------------
 * When a single disposal consumes MULTIPLE acquisition lots with different
 * acquisition dates, column (b) is rendered "VARIOUS" — exactly as the IRS
 * instructions permit. If every consumed lot shares one acquisition date, that
 * date is shown.
 *
 * Missing basis is NEVER silently $0
 * ----------------------------------
 * If the underlying disposal had a missing-basis shortfall (units with no known
 * lot), that fact is carried through on the row (hasMissingBasis) and surfaced
 * in the summary so the caller can hard-block filing until basis is supplied
 * (R1-C already refuses to invent a $0 basis).
 *
 * Money math
 * ----------
 * All internal money is integer USD CENTS. Whole-dollar rounding (IRS allows
 * rounding to whole dollars on a return) is applied ONLY at render time via
 * centsToWholeDollars() with half-up rounding; the cent-precise values are also
 * exposed so callers never lose precision.
 */

import type {
  DisposalResult,
  LotConsumption,
  HoldingPeriod,
} from "./crypto-cost-basis-core";

// ---------------------------------------------------------------------------
// Public constants.
// ---------------------------------------------------------------------------

/** Form 8949 box for self-custody (not-on-1099-B) SHORT-term digital assets. */
export const FORM8949_SHORT_TERM_BOX = "I" as const;
/** Form 8949 box for self-custody (not-on-1099-B) LONG-term digital assets. */
export const FORM8949_LONG_TERM_BOX = "L" as const;

/** Column (b) sentinel when a row aggregates lots of differing acquire dates. */
export const DATE_ACQUIRED_VARIOUS = "VARIOUS" as const;

/**
 * Schedule D capital-loss deduction cap against ordinary income.
 * $3,000 general; $1,500 married-filing-separately. Excess carries forward.
 */
export const CAPITAL_LOSS_CAP_CENTS = 300000; // $3,000.00
export const CAPITAL_LOSS_CAP_MFS_CENTS = 150000; // $1,500.00

export type Form8949Box = typeof FORM8949_SHORT_TERM_BOX | typeof FORM8949_LONG_TERM_BOX;

/** Filing status that affects the capital-loss cap. */
export type FilingStatus = "single" | "mfj" | "mfs" | "hoh" | "qw";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

/** One line on IRS Form 8949 (Part I short-term / Part II long-term). */
export interface Form8949Row {
  /** Which 8949 part/box: "I" (short) or "L" (long). */
  box: Form8949Box;
  holdingPeriod: HoldingPeriod;
  /** Column (a): property description, e.g. "1.5 FLR". */
  descriptionColA: string;
  /** Column (b): date acquired — an ISO date (YYYY-MM-DD) or "VARIOUS". */
  dateAcquiredColB: string;
  /** Column (c): date sold/disposed — ISO date (YYYY-MM-DD). */
  dateSoldColC: string;
  /** Column (d): proceeds, integer cents. */
  proceedsCents: number;
  /** Column (e): cost or other basis, integer cents. */
  costBasisCents: number;
  /** Column (f): adjustment code (empty string when none). */
  adjustmentCodeColF: string;
  /** Column (g): amount of adjustment, integer cents (0 when none). */
  adjustmentCents: number;
  /** Column (h): gain or (loss) = (d) − (e) + (g), integer cents. */
  gainLossCents: number;
  /** Source disposal id (traceability back to the ledger). */
  disposalId: string;
  /** True when the source disposal had unmatched (missing-basis) units. */
  hasMissingBasis: boolean;
}

/** Totals for one Form 8949 part (short or long). */
export interface Form8949PartTotals {
  box: Form8949Box;
  holdingPeriod: HoldingPeriod;
  rowCount: number;
  proceedsCents: number;
  costBasisCents: number;
  adjustmentCents: number;
  gainLossCents: number;
}

/** The Schedule D roll-up + capital-loss cap + carryforward. */
export interface ScheduleDResult {
  /** Net short-term gain/(loss), cents (Sched D line 7-ish). */
  shortTermNetCents: number;
  /** Net long-term gain/(loss), cents (Sched D line 15-ish). */
  longTermNetCents: number;
  /** Combined net capital gain/(loss), cents (Sched D line 16). */
  netCapitalGainCents: number;
  /**
   * Amount actually deductible against ordinary income THIS year (cents).
   * Positive net gains flow through unchanged; net losses are capped at
   * CAPITAL_LOSS_CAP(_MFS)_CENTS (a NEGATIVE number, i.e. the allowed loss).
   */
  allowedLossOrGainCents: number;
  /** Capital loss carried forward to next year (cents, >= 0). */
  lossCarryforwardCents: number;
  filingStatus: FilingStatus;
  capUsedCents: number;
}

/** Full Form 8949 + Schedule D report. */
export interface Form8949Report {
  rows: Form8949Row[];
  shortTermTotals: Form8949PartTotals;
  longTermTotals: Form8949PartTotals;
  scheduleD: ScheduleDResult;
  /** True when ANY row traces to a disposal with missing basis. */
  hasAnyMissingBasis: boolean;
}

// ---------------------------------------------------------------------------
// Inputs.
// ---------------------------------------------------------------------------

/**
 * One priced disposal to render, plus the asset symbol and (scaled) quantity so
 * column (a) reads like "1.5 FLR". The DisposalResult carries all the money and
 * holding-period detail we need from the R1-C engine.
 */
export interface Form8949DisposalInput {
  /** Asset ticker/symbol for column (a), e.g. "FLR", "XLM", "BTC". */
  assetSymbol: string;
  /** Human quantity string for column (a), e.g. "1.5" (already formatted). */
  quantityDisplay: string;
  disposal: DisposalResult;
}

export interface BuildForm8949Input {
  disposals: readonly Form8949DisposalInput[];
  filingStatus?: FilingStatus;
  /**
   * Prior-year capital loss carried INTO this year (cents, >= 0). It reduces a
   * net gain or adds to a net loss before the annual cap is applied.
   */
  priorLossCarryforwardCents?: number;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function assertSafeInt(v: number, what: string): number {
  if (!Number.isFinite(v) || !Number.isInteger(v)) {
    throw new Error(`crypto-form8949-core: ${what} must be an integer, got ${String(v)}`);
  }
  if (!Number.isSafeInteger(v)) {
    throw new Error(`crypto-form8949-core: ${what} exceeds safe-integer range`);
  }
  return v;
}

/**
 * Format a ms-epoch timestamp as an ISO calendar date (YYYY-MM-DD, UTC).
 * PURE and deterministic — no locale, no timezone drift.
 */
export function msToIsoDate(ms: number): string {
  if (!Number.isFinite(ms)) throw new Error("crypto-form8949-core: non-finite timestamp");
  const d = new Date(Math.trunc(ms));
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const mm = m < 10 ? `0${m}` : `${m}`;
  const dd = day < 10 ? `0${day}` : `${day}`;
  return `${y}-${mm}-${dd}`;
}

/**
 * IRS whole-dollar rounding (half-up on the absolute value, sign preserved).
 * Cents 50..99 round up; the return may round every entry to whole dollars.
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

/**
 * Collapse the acquisition dates of a disposal's consumed lots into column (b):
 * a single ISO date when all lots share one acquire date, else "VARIOUS".
 * Returns "" when there are no consumptions (fully missing-basis disposal).
 */
function dateAcquiredColumn(consumptions: readonly LotConsumption[]): string {
  if (consumptions.length === 0) return "";
  const first = msToIsoDate(consumptions[0].acquiredAtMs);
  for (let i = 1; i < consumptions.length; i += 1) {
    if (msToIsoDate(consumptions[i].acquiredAtMs) !== first) return DATE_ACQUIRED_VARIOUS;
  }
  return first;
}

/** Sum consumed-lot fields for a given holding period within one disposal. */
function sumForPeriod(
  consumptions: readonly LotConsumption[],
  period: HoldingPeriod,
): { proceedsCents: number; basisCents: number; gainCents: number; count: number; dates: number[] } {
  let proceedsCents = 0;
  let basisCents = 0;
  let gainCents = 0;
  let count = 0;
  const dates: number[] = [];
  for (const c of consumptions) {
    if (c.holdingPeriod !== period) continue;
    proceedsCents += c.proceedsCents;
    basisCents += c.basisCents;
    gainCents += c.gainCents;
    count += 1;
    dates.push(c.acquiredAtMs);
  }
  return { proceedsCents, basisCents, gainCents, count, dates };
}

function dateAcquiredForDates(datesMs: readonly number[]): string {
  if (datesMs.length === 0) return "";
  const first = msToIsoDate(datesMs[0]);
  for (let i = 1; i < datesMs.length; i += 1) {
    if (msToIsoDate(datesMs[i]) !== first) return DATE_ACQUIRED_VARIOUS;
  }
  return first;
}

// ---------------------------------------------------------------------------
// Row building.
// ---------------------------------------------------------------------------

/**
 * Build the Form 8949 rows for ONE priced disposal. A disposal that consumed
 * both short- and long-term lots yields up to TWO rows (one per part), because
 * Form 8949 short-term (Part I) and long-term (Part II) are filed separately.
 */
export function buildRowsForDisposal(input: Form8949DisposalInput): Form8949Row[] {
  const { assetSymbol, quantityDisplay, disposal } = input;
  const desc = `${quantityDisplay} ${assetSymbol}`.trim();
  const dateSold = msToIsoDate(disposal.consumptions.length > 0
    ? disposal.consumptions[0].disposedAtMs
    : 0);
  const rows: Form8949Row[] = [];

  const periods: HoldingPeriod[] = ["short", "long"];
  for (const period of periods) {
    const s = sumForPeriod(disposal.consumptions, period);
    if (s.count === 0) continue;
    const box: Form8949Box = period === "short" ? FORM8949_SHORT_TERM_BOX : FORM8949_LONG_TERM_BOX;
    // Column (c) date sold: use the actual disposed time of these consumptions.
    const disposedMs = disposal.consumptions.find((c) => c.holdingPeriod === period)?.disposedAtMs ?? 0;
    rows.push({
      box,
      holdingPeriod: period,
      descriptionColA: desc,
      dateAcquiredColB: dateAcquiredForDates(s.dates),
      dateSoldColC: msToIsoDate(disposedMs),
      proceedsCents: assertSafeInt(s.proceedsCents, "proceedsCents"),
      costBasisCents: assertSafeInt(s.basisCents, "costBasisCents"),
      adjustmentCodeColF: "",
      adjustmentCents: 0,
      gainLossCents: assertSafeInt(s.gainCents, "gainLossCents"),
      disposalId: disposal.disposalId,
      hasMissingBasis: disposal.hasMissingBasis,
    });
  }

  // A disposal that matched NOTHING (fully missing basis) still deserves a
  // flagged, zero-money placeholder row so it is never silently dropped.
  if (rows.length === 0 && disposal.hasMissingBasis) {
    rows.push({
      box: FORM8949_SHORT_TERM_BOX,
      holdingPeriod: "short",
      descriptionColA: desc,
      dateAcquiredColB: dateAcquiredColumn(disposal.consumptions),
      dateSoldColC: dateSold,
      proceedsCents: assertSafeInt(disposal.matchedProceedsCents, "proceedsCents"),
      costBasisCents: 0,
      adjustmentCodeColF: "",
      adjustmentCents: 0,
      gainLossCents: assertSafeInt(disposal.matchedProceedsCents, "gainLossCents"),
      disposalId: disposal.disposalId,
      hasMissingBasis: true,
    });
  }

  return rows;
}

function totalsFor(rows: readonly Form8949Row[], box: Form8949Box, period: HoldingPeriod): Form8949PartTotals {
  let proceedsCents = 0;
  let costBasisCents = 0;
  let adjustmentCents = 0;
  let gainLossCents = 0;
  let rowCount = 0;
  for (const r of rows) {
    if (r.holdingPeriod !== period) continue;
    proceedsCents += r.proceedsCents;
    costBasisCents += r.costBasisCents;
    adjustmentCents += r.adjustmentCents;
    gainLossCents += r.gainLossCents;
    rowCount += 1;
  }
  return { box, holdingPeriod: period, rowCount, proceedsCents, costBasisCents, adjustmentCents, gainLossCents };
}

// ---------------------------------------------------------------------------
// Schedule D.
// ---------------------------------------------------------------------------

/**
 * Compute Schedule D from short/long net gains, folding in any prior-year loss
 * carryforward, then applying the annual capital-loss deduction cap and
 * computing the loss that carries to next year.
 */
export function computeScheduleD(
  shortTermNetCents: number,
  longTermNetCents: number,
  filingStatus: FilingStatus,
  priorLossCarryforwardCents: number,
): ScheduleDResult {
  assertSafeInt(shortTermNetCents, "shortTermNetCents");
  assertSafeInt(longTermNetCents, "longTermNetCents");
  if (priorLossCarryforwardCents < 0) {
    throw new Error("crypto-form8949-core: priorLossCarryforwardCents must be >= 0");
  }
  assertSafeInt(priorLossCarryforwardCents, "priorLossCarryforwardCents");

  // A prior-year carryforward is a LOSS, so it reduces the year's net.
  const netCapitalGainCents = shortTermNetCents + longTermNetCents - priorLossCarryforwardCents;

  const capCents =
    filingStatus === "mfs" ? CAPITAL_LOSS_CAP_MFS_CENTS : CAPITAL_LOSS_CAP_CENTS;

  let allowedLossOrGainCents: number;
  let lossCarryforwardCents: number;
  let capUsedCents: number;

  if (netCapitalGainCents >= 0) {
    // Net gain: fully reportable, nothing carried forward.
    allowedLossOrGainCents = netCapitalGainCents;
    lossCarryforwardCents = 0;
    capUsedCents = 0;
  } else {
    const totalLoss = -netCapitalGainCents; // positive magnitude
    const deductible = Math.min(totalLoss, capCents);
    allowedLossOrGainCents = -deductible; // a negative number (allowed loss)
    lossCarryforwardCents = totalLoss - deductible; // remainder to next year
    capUsedCents = deductible;
  }

  return {
    shortTermNetCents,
    longTermNetCents,
    netCapitalGainCents,
    allowedLossOrGainCents,
    lossCarryforwardCents,
    filingStatus,
    capUsedCents,
  };
}

// ---------------------------------------------------------------------------
// Top-level report builder.
// ---------------------------------------------------------------------------

export function buildForm8949Report(input: BuildForm8949Input): Form8949Report {
  const filingStatus: FilingStatus = input.filingStatus ?? "single";
  const priorLoss = input.priorLossCarryforwardCents ?? 0;

  const rows: Form8949Row[] = [];
  let hasAnyMissingBasis = false;
  for (const d of input.disposals) {
    const rs = buildRowsForDisposal(d);
    for (const r of rs) {
      rows.push(r);
      if (r.hasMissingBasis) hasAnyMissingBasis = true;
    }
  }

  const shortTermTotals = totalsFor(rows, FORM8949_SHORT_TERM_BOX, "short");
  const longTermTotals = totalsFor(rows, FORM8949_LONG_TERM_BOX, "long");

  const scheduleD = computeScheduleD(
    shortTermTotals.gainLossCents,
    longTermTotals.gainLossCents,
    filingStatus,
    priorLoss,
  );

  return { rows, shortTermTotals, longTermTotals, scheduleD, hasAnyMissingBasis };
}

// ---------------------------------------------------------------------------
// Self-tests (bare-call style; throws on failure, prints pass line).
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `crypto-form8949-core: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const DAY = 86400000;

function mkConsumption(over: Partial<LotConsumption> & { holdingPeriod: HoldingPeriod }): LotConsumption {
  return {
    lotId: over.lotId ?? "lot",
    quantityScaled: over.quantityScaled ?? BigInt(0),
    proceedsCents: over.proceedsCents ?? 0,
    basisCents: over.basisCents ?? 0,
    gainCents: over.gainCents ?? 0,
    acquiredAtMs: over.acquiredAtMs ?? 0,
    disposedAtMs: over.disposedAtMs ?? 0,
    holdingPeriod: over.holdingPeriod,
  };
}

function mkDisposal(over: Partial<DisposalResult> & { disposalId: string }): DisposalResult {
  return {
    disposalId: over.disposalId,
    matchedQuantityScaled: over.matchedQuantityScaled ?? BigInt(0),
    missingBasisQuantityScaled: over.missingBasisQuantityScaled ?? BigInt(0),
    consumptions: over.consumptions ?? [],
    matchedProceedsCents: over.matchedProceedsCents ?? 0,
    matchedBasisCents: over.matchedBasisCents ?? 0,
    realizedGainCents: over.realizedGainCents ?? 0,
    shortTermGainCents: over.shortTermGainCents ?? 0,
    longTermGainCents: over.longTermGainCents ?? 0,
    hasMissingBasis: over.hasMissingBasis ?? false,
  };
}

export function __runCryptoForm8949CoreTests(): void {
  // --- whole-dollar rounding (half-up on absolute value) ---
  eq(centsToWholeDollars(0), 0, "0c -> $0");
  eq(centsToWholeDollars(49), 0, "49c -> $0");
  eq(centsToWholeDollars(50), 1, "50c -> $1 (half up)");
  eq(centsToWholeDollars(150), 2, "150c -> $2");
  eq(centsToWholeDollars(149), 1, "149c -> $1");
  eq(centsToWholeDollars(-50), -1, "-50c -> -$1");
  eq(centsToWholeDollars(-149), -1, "-149c -> -$1");

  // --- iso date (UTC, deterministic) ---
  eq(msToIsoDate(0), "1970-01-01", "epoch iso date");
  eq(msToIsoDate(DAY), "1970-01-02", "day 1 iso date");

  // --- short-term row from a single-lot disposal ---
  const shortDisposal = mkDisposal({
    disposalId: "d1",
    hasMissingBasis: false,
    consumptions: [
      mkConsumption({
        holdingPeriod: "short",
        proceedsCents: 15000,
        basisCents: 10000,
        gainCents: 5000,
        acquiredAtMs: 10 * DAY,
        disposedAtMs: 100 * DAY,
      }),
    ],
  });
  const shortRows = buildRowsForDisposal({ assetSymbol: "FLR", quantityDisplay: "1.5", disposal: shortDisposal });
  eq(shortRows.length, 1, "single short-term row");
  eq(shortRows[0].box, "I", "self-custody short-term -> box I");
  eq(shortRows[0].holdingPeriod, "short", "row is short-term");
  eq(shortRows[0].descriptionColA, "1.5 FLR", "column a description");
  eq(shortRows[0].dateAcquiredColB, "1970-01-11", "column b single acquire date");
  eq(shortRows[0].dateSoldColC, "1970-04-11", "column c date sold");
  eq(shortRows[0].proceedsCents, 15000, "column d proceeds");
  eq(shortRows[0].costBasisCents, 10000, "column e basis");
  eq(shortRows[0].gainLossCents, 5000, "column h gain");

  // --- long-term uses box L ---
  const longDisposal = mkDisposal({
    disposalId: "d2",
    consumptions: [
      mkConsumption({
        holdingPeriod: "long",
        proceedsCents: 20000,
        basisCents: 8000,
        gainCents: 12000,
        acquiredAtMs: 0,
        disposedAtMs: 500 * DAY,
      }),
    ],
  });
  const longRows = buildRowsForDisposal({ assetSymbol: "BTC", quantityDisplay: "0.01", disposal: longDisposal });
  eq(longRows[0].box, "L", "self-custody long-term -> box L");
  eq(longRows[0].holdingPeriod, "long", "row is long-term");

  // --- a disposal spanning BOTH periods yields two rows ---
  const splitDisposal = mkDisposal({
    disposalId: "d3",
    consumptions: [
      mkConsumption({ holdingPeriod: "short", proceedsCents: 5000, basisCents: 3000, gainCents: 2000, acquiredAtMs: 400 * DAY, disposedAtMs: 500 * DAY }),
      mkConsumption({ holdingPeriod: "long", proceedsCents: 6000, basisCents: 1000, gainCents: 5000, acquiredAtMs: 0, disposedAtMs: 500 * DAY }),
    ],
  });
  const splitRows = buildRowsForDisposal({ assetSymbol: "XLM", quantityDisplay: "10", disposal: splitDisposal });
  eq(splitRows.length, 2, "split disposal -> two rows");
  eq(splitRows[0].box, "I", "first row short box I");
  eq(splitRows[1].box, "L", "second row long box L");

  // --- VARIOUS when multiple acquire dates within one period ---
  const variousDisposal = mkDisposal({
    disposalId: "d4",
    consumptions: [
      mkConsumption({ holdingPeriod: "short", proceedsCents: 1000, basisCents: 500, gainCents: 500, acquiredAtMs: 10 * DAY, disposedAtMs: 100 * DAY }),
      mkConsumption({ holdingPeriod: "short", proceedsCents: 1000, basisCents: 400, gainCents: 600, acquiredAtMs: 20 * DAY, disposedAtMs: 100 * DAY }),
    ],
  });
  const variousRows = buildRowsForDisposal({ assetSymbol: "FLR", quantityDisplay: "2", disposal: variousDisposal });
  eq(variousRows.length, 1, "two same-period lots -> one aggregated row");
  eq(variousRows[0].dateAcquiredColB, "VARIOUS", "differing acquire dates -> VARIOUS");
  eq(variousRows[0].proceedsCents, 2000, "aggregated proceeds");
  eq(variousRows[0].costBasisCents, 900, "aggregated basis");
  eq(variousRows[0].gainLossCents, 1100, "aggregated gain");

  // --- same acquire date within a period is NOT various ---
  const sameDateDisposal = mkDisposal({
    disposalId: "d4b",
    consumptions: [
      mkConsumption({ holdingPeriod: "short", proceedsCents: 1000, basisCents: 500, gainCents: 500, acquiredAtMs: 10 * DAY, disposedAtMs: 100 * DAY }),
      mkConsumption({ holdingPeriod: "short", proceedsCents: 1000, basisCents: 400, gainCents: 600, acquiredAtMs: 10 * DAY, disposedAtMs: 100 * DAY }),
    ],
  });
  const sameDateRows = buildRowsForDisposal({ assetSymbol: "FLR", quantityDisplay: "2", disposal: sameDateDisposal });
  eq(sameDateRows[0].dateAcquiredColB, "1970-01-11", "same acquire dates -> single date, not VARIOUS");

  // --- missing-basis disposal produces a flagged placeholder row ---
  const missingDisposal = mkDisposal({
    disposalId: "d5",
    hasMissingBasis: true,
    matchedProceedsCents: 0,
    consumptions: [],
  });
  const missingRows = buildRowsForDisposal({ assetSymbol: "XLM", quantityDisplay: "5", disposal: missingDisposal });
  eq(missingRows.length, 1, "missing-basis disposal still yields a row");
  eq(missingRows[0].hasMissingBasis, true, "row flagged missing basis");

  // --- Schedule D: net gain flows through, no carryforward ---
  const dGain = computeScheduleD(5000, 12000, "single", 0);
  eq(dGain.netCapitalGainCents, 17000, "net gain sum");
  eq(dGain.allowedLossOrGainCents, 17000, "gain fully reportable");
  eq(dGain.lossCarryforwardCents, 0, "no carryforward on a gain");

  // --- Schedule D: net loss under the cap, fully deductible ---
  const smallLoss = computeScheduleD(-100000, -50000, "single", 0);
  eq(smallLoss.netCapitalGainCents, -150000, "net loss sum");
  eq(smallLoss.allowedLossOrGainCents, -150000, "loss below cap fully allowed");
  eq(smallLoss.lossCarryforwardCents, 0, "nothing carried when under cap");

  // --- Schedule D: net loss over the $3,000 cap -> capped + carryforward ---
  const bigLoss = computeScheduleD(-400000, -100000, "single", 0);
  eq(bigLoss.netCapitalGainCents, -500000, "net loss sum");
  eq(bigLoss.allowedLossOrGainCents, -300000, "loss capped at $3,000");
  eq(bigLoss.lossCarryforwardCents, 200000, "excess $2,000 carried forward");
  eq(bigLoss.capUsedCents, 300000, "cap used = $3,000");

  // --- Schedule D: MFS cap is $1,500 ---
  const mfsLoss = computeScheduleD(-500000, 0, "mfs", 0);
  eq(mfsLoss.allowedLossOrGainCents, -150000, "mfs loss capped at $1,500");
  eq(mfsLoss.lossCarryforwardCents, 350000, "mfs excess carried forward");

  // --- Schedule D: prior-year carryforward reduces this year's net ---
  const withPrior = computeScheduleD(100000, 0, "single", 250000);
  eq(withPrior.netCapitalGainCents, -150000, "prior loss reduces net");
  eq(withPrior.allowedLossOrGainCents, -150000, "resulting loss under cap fully allowed");

  // --- prior carryforward turning a gain into an over-cap loss ---
  const priorOverCap = computeScheduleD(0, 0, "single", 500000);
  eq(priorOverCap.allowedLossOrGainCents, -300000, "prior-only loss capped");
  eq(priorOverCap.lossCarryforwardCents, 200000, "prior-only excess carried");

  // --- negative prior carryforward is rejected ---
  let threwNeg = false;
  try { computeScheduleD(0, 0, "single", -1); } catch { threwNeg = true; }
  eq(threwNeg, true, "negative prior carryforward rejected");

  // --- full report builder: totals + Schedule D wiring ---
  const report = buildForm8949Report({
    disposals: [
      { assetSymbol: "FLR", quantityDisplay: "1.5", disposal: shortDisposal },
      { assetSymbol: "BTC", quantityDisplay: "0.01", disposal: longDisposal },
      { assetSymbol: "XLM", quantityDisplay: "10", disposal: splitDisposal },
    ],
    filingStatus: "single",
  });
  // rows: shortDisposal(1) + longDisposal(1) + splitDisposal(2) = 4
  eq(report.rows.length, 4, "report row count");
  // short totals: shortDisposal 5000 + split short 2000 = 7000
  eq(report.shortTermTotals.gainLossCents, 7000, "short-term total gain");
  // long totals: longDisposal 12000 + split long 5000 = 17000
  eq(report.longTermTotals.gainLossCents, 17000, "long-term total gain");
  eq(report.scheduleD.netCapitalGainCents, 24000, "report net capital gain");
  eq(report.hasAnyMissingBasis, false, "report has no missing basis");

  // --- report surfaces missing basis when present ---
  const missingReport = buildForm8949Report({
    disposals: [{ assetSymbol: "XLM", quantityDisplay: "5", disposal: missingDisposal }],
  });
  eq(missingReport.hasAnyMissingBasis, true, "report surfaces missing basis");

  console.log("crypto-form8949-core self-tests: all passed");
}
