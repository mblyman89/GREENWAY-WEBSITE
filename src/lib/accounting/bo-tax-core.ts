/**
 * bo-tax-core.ts — Washington's three sales-side taxes, told apart.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Michael's instruction, verbatim:
 *
 *   "we need to account for sales tax by all three types, state/ local/ b&o.
 *    its important that the books account for b&o as it is an expense and not
 *    a liability."
 *
 * Two of the three already existed. `src/lib/reports/wa-tax.ts` has computed
 * `stateSalesTaxMinor` and `localSalesTaxMinor` separately for a long time, at
 * 650 and 280 basis points, and the tax report page already prints both. The
 * third — B&O — did not exist anywhere. Measured on books-59:
 *
 *   grep -rn "75040"  outside the chart of accounts  -> nothing
 *   grep -rn "32200"  outside the chart of accounts  -> nothing
 *   grep -rn B&O rate anywhere in src                -> nothing
 *
 * So the chart of accounts had been carrying `75040 B&O Tax Expense` and
 * `32200 B&O Tax Payable` since migration 0173, and nothing on earth ever
 * posted a cent to either one. That is the actual gap this file closes.
 *
 *
 * THE UNIT PROBLEM — WHY B&O CANNOT USE BASIS POINTS
 * -------------------------------------------------
 * Every rate in this system is an integer number of BASIS POINTS. That worked
 * while sales tax was the only rate: 6.5% is exactly 650 bps, 2.8% is exactly
 * 280 bps. Washington's B&O Retailing rate does not fit:
 *
 *     Retailing                      0.004710  =  47.10 basis points
 *     Service and Other Activities   0.015000  = 150    basis points
 *
 * 47.10 is not an integer. There is no way to store it in bps without changing
 * the rate, and changing the rate means disagreeing with a filed government
 * return. Measured against Michael's own July 2026 return, taxable base
 * $168,465.17:
 *
 *     DOR's 0.004710        ->  $793.47   <- what he filed and paid
 *     47 bps (round down)   ->  $791.79   understates by  $1.68 per month
 *     48 bps (round up)     ->  $808.63   overstates  by $15.16 per month
 *
 * So B&O rates are stored in MILLIONTHS of the base — the rate times 1,000,000.
 * `0.004710` becomes `4710`; `0.015000` becomes `15000`. Both exact integers.
 * Basis points convert into the same unit without moving (650 bps = 65000
 * millionths), so nothing that already worked changes its answer. See standing
 * rule 114.
 *
 *
 * THE PART MICHAEL AND THE CHART OF ACCOUNTS DISAGREE ABOUT
 * --------------------------------------------------------
 * He said B&O "is an expense and not a liability." The chart of accounts
 * carries BOTH `75040 B&O Tax Expense` and `32200 B&O Tax Payable`.
 *
 * Both are right, and they are answering different questions. The reason B&O
 * differs from the other two taxes is the one thing that really matters here,
 * and it is the thing he is pointing at:
 *
 *   RETAIL SALES TAX and the 37% CANNABIS EXCISE are TRUST money. Greenway
 *   collects them from the customer on the state's behalf. They were never
 *   Greenway's. They hit a liability (32100 / 32000) on the way in and clear
 *   it on the way out, and they NEVER TOUCH THE P&L. Greenway is a bagman.
 *
 *   B&O is a tax ON GREENWAY, measured by gross receipts. Nobody collected it
 *   from a customer. It is Greenway's own cost of being in business, so it IS
 *   an expense and it DOES reduce book profit. That is his point and it is
 *   correct.
 *
 * The payable is not a contradiction of that; it is the timing. Accrual books
 * recognise the expense in the month the sales happened (July) even though the
 * cash leaves in the next month (25 August, per the return's own due date). In
 * between, the amount owed sits in 32200. So a single month books as:
 *
 *     DEBIT   75040  B&O Tax Expense      858.80    <- the expense he means
 *     CREDIT  32200  B&O Tax Payable      858.80    <- merely "not paid yet"
 *
 * and on payment:
 *
 *     DEBIT   32200  B&O Tax Payable      858.80
 *     CREDIT  10100  the bank             858.80
 *
 * The liability is temporary bookkeeping plumbing; the expense is the economic
 * fact. If B&O were booked the way sales tax is booked — straight to a
 * liability with no expense side — Greenway's profit would be overstated by the
 * full B&O for every month, forever. That is the error worth preventing.
 *
 * This file therefore keeps BOTH sides and refuses to let the expense side be
 * dropped. It does not remove the payable, because removing it would be
 * guessing at what he meant instead of reading what he said.
 *
 *
 * 280E — THE OTHER REASON THE EXPENSE SIDE MATTERS
 * -----------------------------------------------
 * Migration 0173 tags `75040` as `nondeductible_280e`. Being an expense in the
 * books does NOT make B&O deductible on the federal return for a cannabis
 * retailer. The expense is real for book purposes and disallowed for tax
 * purposes, which is exactly the kind of difference that belongs in the
 * book-to-tax bridge. This file computes book figures and takes no position on
 * the return.
 *
 *
 * PURE MODULE. No I/O, no React, no server imports — so the tests can run it
 * directly and the numbers can be proved against a real filed return.
 */

// ---------------------------------------------------------------------------
// UNITS
// ---------------------------------------------------------------------------

/**
 * A tax rate expressed in MILLIONTHS of the taxable base: the decimal rate
 * multiplied by 1,000,000. `0.004710` -> `4710`. Always an integer.
 *
 * Chosen over basis points because Washington's B&O Retailing rate is 47.10
 * basis points and cannot be stored as an integer bps value. See rule 114.
 */
export type RateMillionths = number;

/** Scale factor between a decimal rate and `RateMillionths`. */
export const RATE_MILLIONTHS_SCALE = 1_000_000;

/** Basis points to millionths. 650 bps -> 65000. Exact for every integer bps. */
export function bpsToMillionths(bps: number): RateMillionths {
  if (!Number.isInteger(bps)) {
    throw new Error(
      `[${BO_REFUSAL.BPS_NOT_INTEGER}] bpsToMillionths: basis points must be an integer, got ${String(bps)}`,
    );
  }
  return bps * 100;
}

// ---------------------------------------------------------------------------
// THE THREE TYPES
// ---------------------------------------------------------------------------

/**
 * The three sales-side tax types Michael named, plus the distinction that
 * actually drives the accounting.
 *
 * `trust` — collected FROM the customer FOR the state. A liability only.
 *           Never an expense, never in the P&L.
 * `own`   — a tax ON Greenway itself. An expense, with a payable for timing.
 */
export type WaTaxKind = "trust" | "own";

export type WaSalesTaxType = "state_sales" | "local_sales" | "bo";

export const ALL_WA_SALES_TAX_TYPES: readonly WaSalesTaxType[] = [
  "state_sales",
  "local_sales",
  "bo",
];

/**
 * B&O is not one rate. Washington taxes different ACTIVITIES at different
 * rates, and Greenway has two of them on the same return:
 *
 *   retailing         — the store's cannabis and accessory sales
 *   service_and_other — the ATM surcharge income
 *
 * They are separate lines on the filed return with separate rates, so they are
 * separate here. Collapsing them into one "B&O rate" would silently tax the
 * ATM at the retail rate.
 */
export type BoClassification = "retailing" | "service_and_other";

export const ALL_BO_CLASSIFICATIONS: readonly BoClassification[] = [
  "retailing",
  "service_and_other",
];

// ---------------------------------------------------------------------------
// RATES AS FILED
// ---------------------------------------------------------------------------

/**
 * The rates Michael actually filed with, quoted from his July 2026 return and
 * given to me directly:
 *
 *   "it is currently set at .00471 for retailing, and .015000 for the atm
 *    activity (service and other activities less than 1,000,000 in the prior
 *    year)"
 *
 * These are DEFAULTS, not constants of nature. The legislature changes B&O
 * rates, and the service rate here is conditional on prior-year receipts
 * staying under $1,000,000 — a threshold Greenway could cross. Rule 114(d):
 * never inline a rate where a future change cannot reach it. Anything that
 * computes B&O takes a `BoRates` argument; these are only the starting values.
 */
export const DEFAULT_BO_RATES: Readonly<Record<BoClassification, RateMillionths>> = {
  retailing: 4710, // 0.004710 — WA DOR "Retailing" classification
  service_and_other: 15000, // 0.015000 — "Service and Other Activities (Less Than $1,000,000 in the Prior Year)"
};

/** The label DOR prints on the return, so the UI can match the paper. */
export const BO_CLASSIFICATION_LABELS: Readonly<Record<BoClassification, string>> = {
  retailing: "Retailing",
  service_and_other: "Service and Other Activities (Less Than $1,000,000 in the Prior Year)",
};

/**
 * Which entity's money each B&O classification measures. Greenway's retail
 * sales are the store; the surcharge is the ATM operation. Michael:
 *
 *   "the surcharge only is what i enter into the dor portal when paying sales
 *    taxes. the atm service provider deposits the surcharge separate so it
 *    will be very simple to track."
 *
 * Only the SURCHARGE is Greenway's revenue. The cash a customer withdraws is
 * not revenue at all — it is the vault's money moving — and taxing withdrawal
 * volume as gross receipts would be a catastrophic overstatement.
 */
export const BO_CLASSIFICATION_ENTITY: Readonly<Record<BoClassification, string>> = {
  retailing: "greenway",
  service_and_other: "atm",
};

export type BoRates = Readonly<Record<BoClassification, RateMillionths>>;

// ---------------------------------------------------------------------------
// THE ACCOUNTS (from migration 0173 — not invented here)
// ---------------------------------------------------------------------------

/** `75040 B&O Tax Expense` — the expense side Michael is insisting on. */
export const ACCOUNT_BO_EXPENSE = "75040";

/** `32200 B&O Tax Payable` — accrued but unpaid. Timing only. */
export const ACCOUNT_BO_PAYABLE = "32200";

/** `32100 Retail Sales Tax Payable — TRUST`. Liability only, never an expense. */
export const ACCOUNT_SALES_TAX_PAYABLE = "32100";

// ---------------------------------------------------------------------------
// ROUNDING
// ---------------------------------------------------------------------------

/**
 * Apply a millionths rate to a base in integer cents, rounding half away from
 * zero — which is what DOR's own return does, verified line by line against
 * the July filing.
 *
 * Integer arithmetic throughout. `base * rate` for a month like July is about
 * 1.7e7 * 4.7e3 = 8e10, far inside Number.MAX_SAFE_INTEGER (9e15), so there is
 * no float drift to worry about. A guard below makes that explicit rather than
 * leaving it as a comforting assumption.
 */
/**
 * REFUSAL CODES.
 *
 * Every guard in this file carries a unique code, and the tests pin the CODE
 * rather than the prose. This exists because of a real escape found by the
 * books-59 mutation campaign (M10): the negative-gross guard was disabled and
 * the suite stayed GREEN, because a *different* guard fired instead
 * (deductions 0 > gross -100) and its message happened to contain the word
 * "negative", which satisfied a `.toThrow(/negative/i)` assertion.
 *
 * The test passed for the wrong reason and would have kept passing with the
 * guard gone. Matching on prose is matching on a coincidence; a code cannot be
 * satisfied by accident, and rewording a message can no longer silently
 * decouple a test from the guard it believes it is testing.
 */
export const BO_REFUSAL = {
  BASE_NOT_INTEGER: "BO-E01",
  RATE_NOT_INTEGER: "BO-E02",
  RATE_NEGATIVE: "BO-E03",
  PRODUCT_UNSAFE: "BO-E04",
  GROSS_NOT_INTEGER: "BO-E05",
  DEDUCTIONS_NOT_INTEGER: "BO-E06",
  GROSS_NEGATIVE: "BO-E07",
  DEDUCTIONS_NEGATIVE: "BO-E08",
  DEDUCTIONS_EXCEED_GROSS: "BO-E09",
  NO_RATE_FOR_CLASSIFICATION: "BO-E10",
  ACCRUAL_NOT_INTEGER: "BO-E11",
  ACCRUAL_NOT_POSITIVE: "BO-E12",
  PAYMENT_NOT_POSITIVE: "BO-E13",
  BPS_NOT_INTEGER: "BO-E14",
} as const;

export type BoRefusalCode = (typeof BO_REFUSAL)[keyof typeof BO_REFUSAL];

export const ALL_BO_REFUSAL_CODES: readonly BoRefusalCode[] = Object.values(BO_REFUSAL);

export function applyRateMillionths(baseCents: number, rate: RateMillionths): number {
  if (!Number.isInteger(baseCents)) {
    throw new Error(
      `[${BO_REFUSAL.BASE_NOT_INTEGER}] applyRateMillionths: base must be integer cents, got ${String(baseCents)}`,
    );
  }
  if (!Number.isInteger(rate)) {
    throw new Error(
      `[${BO_REFUSAL.RATE_NOT_INTEGER}] applyRateMillionths: rate must be integer millionths, got ${String(rate)}`,
    );
  }
  if (rate < 0) {
    throw new Error(
      `[${BO_REFUSAL.RATE_NEGATIVE}] applyRateMillionths: a negative tax rate is not a thing (${String(rate)})`,
    );
  }
  const product = Math.abs(baseCents) * rate;
  if (!Number.isSafeInteger(product)) {
    // Rule 40: a guard that can never fire is an untested guard, so this one
    // is reachable in the tests with a deliberately absurd base.
    throw new Error(
      `[${BO_REFUSAL.PRODUCT_UNSAFE}] applyRateMillionths: base ${String(baseCents)} x rate ${String(rate)} exceeds safe integer ` +
        `range; this figure is too large to compute exactly and must not be approximated`,
    );
  }
  const sign = baseCents < 0 ? -1 : 1;
  return sign * Math.round(product / RATE_MILLIONTHS_SCALE);
}

// ---------------------------------------------------------------------------
// ONE B&O LINE
// ---------------------------------------------------------------------------

export type BoLine = {
  readonly classification: BoClassification;
  readonly label: string;
  readonly entity: string;
  /** Gross receipts for the classification, integer cents. */
  readonly grossCents: number;
  /** Deductions claimed, integer cents. Zero on every Greenway return so far. */
  readonly deductionsCents: number;
  /** gross - deductions. What the rate is applied to. */
  readonly taxableCents: number;
  readonly rate: RateMillionths;
  /** The tax, integer cents. */
  readonly taxCents: number;
};

export function boLine(args: {
  readonly classification: BoClassification;
  readonly grossCents: number;
  readonly deductionsCents?: number;
  readonly rates: BoRates;
}): BoLine {
  const { classification, grossCents, rates } = args;
  const deductionsCents = args.deductionsCents ?? 0;

  if (!Number.isInteger(grossCents)) {
    throw new Error(
      `[${BO_REFUSAL.GROSS_NOT_INTEGER}] boLine: gross must be integer cents, got ${String(grossCents)}`,
    );
  }
  if (!Number.isInteger(deductionsCents)) {
    throw new Error(
      `[${BO_REFUSAL.DEDUCTIONS_NOT_INTEGER}] boLine: deductions must be integer cents, got ${String(deductionsCents)}`,
    );
  }
  if (grossCents < 0) {
    throw new Error(
      `[${BO_REFUSAL.GROSS_NEGATIVE}] boLine: gross receipts for ${classification} are negative (${String(grossCents)}). ` +
        `B&O is measured on gross receipts; a negative figure means the source data is wrong, ` +
        `and guessing at it would put a wrong number on a government return.`,
    );
  }
  if (deductionsCents < 0) {
    throw new Error(
      `[${BO_REFUSAL.DEDUCTIONS_NEGATIVE}] boLine: deductions cannot be negative, got ${String(deductionsCents)}`,
    );
  }
  if (deductionsCents > grossCents) {
    throw new Error(
      `[${BO_REFUSAL.DEDUCTIONS_EXCEED_GROSS}] boLine: deductions ${String(deductionsCents)} exceed gross ${String(grossCents)} for ` +
        `${classification}; that would make the taxable amount negative`,
    );
  }

  const rate = rates[classification];
  if (rate === undefined) {
    throw new Error(
      `[${BO_REFUSAL.NO_RATE_FOR_CLASSIFICATION}] boLine: no rate supplied for classification ${classification}`,
    );
  }
  const taxableCents = grossCents - deductionsCents;

  return {
    classification,
    label: BO_CLASSIFICATION_LABELS[classification],
    entity: BO_CLASSIFICATION_ENTITY[classification],
    grossCents,
    deductionsCents,
    taxableCents,
    rate,
    taxCents: applyRateMillionths(taxableCents, rate),
  };
}

// ---------------------------------------------------------------------------
// THE WHOLE RETURN — ALL THREE TYPES SIDE BY SIDE
// ---------------------------------------------------------------------------

export type ThreeTypeBreakdown = {
  /** State retail sales tax — TRUST. Liability only. */
  readonly stateSalesTaxCents: number;
  /** Local (Port Orchard) sales tax — TRUST. Liability only. */
  readonly localSalesTaxCents: number;
  /** B&O — Greenway's OWN tax. Expense, with a payable for timing. */
  readonly boTaxCents: number;
  readonly boLines: readonly BoLine[];
  /** state + local. The trust money. Never an expense. */
  readonly trustTaxCents: number;
  /** What all three come to — the DOR "Total Tax" figure. */
  readonly totalTaxCents: number;
};

export type ThreeTypeInput = {
  /** Retail taxable base for sales tax, integer cents. */
  readonly retailBaseCents: number;
  /** ATM surcharge income, integer cents. Surcharge ONLY — never withdrawal volume. */
  readonly atmSurchargeCents: number;
  readonly stateSalesRateBps: number;
  readonly localSalesRateBps: number;
  readonly boRates: BoRates;
  readonly retailDeductionsCents?: number;
  readonly atmDeductionsCents?: number;
};

/**
 * Compute all three types from one month's figures.
 *
 * NOTE ON WHAT THE B&O RETAILING BASE IS. On the July return the Retailing
 * gross ($168,465.17) equals the Retail Sales gross exactly. The B&O base is
 * the same pre-tax retail base the sales tax uses — the collected sales tax and
 * the 37% excise are not part of Greenway's gross receipts, because they were
 * never Greenway's money. This function takes the base as given rather than
 * re-deriving it, so the caller's own back-out logic (already proved in
 * wa-tax.ts) stays the single source of that number.
 */
export function threeTypeBreakdown(input: ThreeTypeInput): ThreeTypeBreakdown {
  const {
    retailBaseCents,
    atmSurchargeCents,
    stateSalesRateBps,
    localSalesRateBps,
    boRates,
  } = input;

  const stateSalesTaxCents = applyRateMillionths(
    retailBaseCents,
    bpsToMillionths(stateSalesRateBps),
  );
  const localSalesTaxCents = applyRateMillionths(
    retailBaseCents,
    bpsToMillionths(localSalesRateBps),
  );

  const lines: BoLine[] = [
    boLine({
      classification: "retailing",
      grossCents: retailBaseCents,
      deductionsCents: input.retailDeductionsCents ?? 0,
      rates: boRates,
    }),
  ];
  // The ATM line only exists when there is surcharge income. A zero line on a
  // return is noise, and DOR does not print one.
  if (atmSurchargeCents > 0) {
    lines.push(
      boLine({
        classification: "service_and_other",
        grossCents: atmSurchargeCents,
        deductionsCents: input.atmDeductionsCents ?? 0,
        rates: boRates,
      }),
    );
  }

  const boTaxCents = lines.reduce((sum, l) => sum + l.taxCents, 0);
  const trustTaxCents = stateSalesTaxCents + localSalesTaxCents;

  return {
    stateSalesTaxCents,
    localSalesTaxCents,
    boTaxCents,
    boLines: lines,
    trustTaxCents,
    totalTaxCents: trustTaxCents + boTaxCents,
  };
}

// ---------------------------------------------------------------------------
// THE JOURNAL ENTRY — WHERE HIS "EXPENSE NOT LIABILITY" POINT LIVES
// ---------------------------------------------------------------------------

export type JournalLine = {
  readonly accountCode: string;
  readonly debitCents: number;
  readonly creditCents: number;
  readonly memo: string;
};

/**
 * The accrual entry for one month's B&O.
 *
 * This is the whole reason the slice exists. Compare with how sales tax books:
 * sales tax touches a liability and nothing else, because it is not Greenway's
 * money. B&O books an EXPENSE, because it is.
 */
export function boAccrualEntry(args: {
  readonly boTaxCents: number;
  readonly periodLabel: string;
}): readonly JournalLine[] {
  const { boTaxCents, periodLabel } = args;
  if (!Number.isInteger(boTaxCents)) {
    throw new Error(
      `[${BO_REFUSAL.ACCRUAL_NOT_INTEGER}] boAccrualEntry: tax must be integer cents, got ${String(boTaxCents)}`,
    );
  }
  if (boTaxCents <= 0) {
    throw new Error(
      `[${BO_REFUSAL.ACCRUAL_NOT_POSITIVE}] boAccrualEntry: refusing to book a zero or negative B&O accrual (${String(boTaxCents)}). ` +
        `An empty journal entry hides the fact that no B&O was computed.`,
    );
  }
  return [
    {
      accountCode: ACCOUNT_BO_EXPENSE,
      debitCents: boTaxCents,
      creditCents: 0,
      memo:
        `B&O tax on ${periodLabel} gross receipts. A tax ON Greenway, not collected from ` +
        `customers — so it is a real expense and it reduces profit, unlike sales tax and the ` +
        `37% excise which are trust money.`,
    },
    {
      accountCode: ACCOUNT_BO_PAYABLE,
      debitCents: 0,
      creditCents: boTaxCents,
      memo:
        `B&O owed for ${periodLabel}, not yet paid. This liability is TIMING only — the ` +
        `expense above is the economic fact. Clears when DOR is paid.`,
    },
  ];
}

/** Paying it: clear the payable, move the cash. No expense here — already booked. */
export function boPaymentEntry(args: {
  readonly boTaxCents: number;
  readonly periodLabel: string;
  readonly bankAccountCode: string;
}): readonly JournalLine[] {
  const { boTaxCents, periodLabel, bankAccountCode } = args;
  if (boTaxCents <= 0 || !Number.isInteger(boTaxCents)) {
    throw new Error(
      `[${BO_REFUSAL.PAYMENT_NOT_POSITIVE}] boPaymentEntry: tax must be a positive integer, got ${String(boTaxCents)}`,
    );
  }
  return [
    {
      accountCode: ACCOUNT_BO_PAYABLE,
      debitCents: boTaxCents,
      creditCents: 0,
      memo: `Clearing the ${periodLabel} B&O payable. The expense was recognised when the sales happened.`,
    },
    {
      accountCode: bankAccountCode,
      debitCents: 0,
      creditCents: boTaxCents,
      memo: `B&O paid to WA DOR for ${periodLabel}.`,
    },
  ];
}

/** True when an entry balances. Used by the tests and by any caller that posts. */
export function entryBalances(lines: readonly JournalLine[]): boolean {
  const d = lines.reduce((s, l) => s + l.debitCents, 0);
  const c = lines.reduce((s, l) => s + l.creditCents, 0);
  return d === c && d > 0;
}

/**
 * Does this set of journal lines recognise B&O as an expense at all?
 *
 * Exists so a test can FAIL if someone ever "simplifies" the accrual into a
 * liability-only entry the way sales tax is booked. That change would look
 * tidy, pass a balance check, and overstate Greenway's profit by the full B&O
 * every single month.
 */
export function recognisesBoExpense(lines: readonly JournalLine[]): boolean {
  return lines.some((l) => l.accountCode === ACCOUNT_BO_EXPENSE && l.debitCents > 0);
}

// ---------------------------------------------------------------------------
// EMBEDDED SELF-TESTS
// ---------------------------------------------------------------------------

function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`bo-tax-core self-test FAILED: ${msg}`);
}

/**
 * Assert that `fn` throws THE SPECIFIC refusal named by `code`.
 *
 * Deliberately not "throws anything". M10 escaped the books-59 campaign because
 * a test accepted any throw whose message contained "negative", and a different
 * guard obliged. Pinning the code makes each guard individually load-bearing.
 */
function throwsCode(fn: () => unknown, code: BoRefusalCode, what: string): void {
  let msg: string | null = null;
  try {
    fn();
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  ok(msg !== null, `expected a throw: ${what}`);
  ok(
    (msg ?? "").includes(`[${code}]`),
    `expected refusal ${code} for ${what}, got: ${String(msg)}`,
  );
}

/**
 * THE JULY 2026 RETURN, as filed. Confirmation # 0-053-958-352.
 * Mirrored at docs/authorities/state-wa/dor-combined-excise-return-july-2026.txt
 * and reconciled line by line before being used (standing rule 115).
 */
export const JULY_2026_RETURN_AS_FILED = {
  retailBaseCents: 16_846_517, // 168,465.17
  atmSurchargeCents: 435_500, //   4,355.00
  boRetailingTaxCents: 79_347, //     793.47
  boServiceTaxCents: 6_533, //      65.33
  boTotalTaxCents: 85_880, //     858.80
  stateSalesTaxCents: 1_095_024, //  10,950.24
  localSalesTaxCents: 471_702, //   4,717.02
  totalTaxCents: 1_652_606, //  16,526.06
  confirmation: "0-053-958-352",
} as const;

export function __runBoTaxCoreTests(): void {
  let n = 0;
  const t = (msg: string, fn: () => void): void => {
    fn();
    n += 1;
    void msg;
  };

  // --- units -------------------------------------------------------------
  t("bps convert exactly", () => {
    ok(bpsToMillionths(650) === 65_000, "650 bps -> 65000");
    ok(bpsToMillionths(280) === 28_000, "280 bps -> 28000");
    ok(bpsToMillionths(0) === 0, "0 bps -> 0");
  });

  t("a non-integer bps is refused", () => {
    throwsCode(() => bpsToMillionths(47.1), BO_REFUSAL.BPS_NOT_INTEGER, "47.1 bps");
  });

  t("the B&O rates are exact integers in millionths", () => {
    ok(DEFAULT_BO_RATES.retailing === 4710, "retailing 0.004710 -> 4710");
    ok(DEFAULT_BO_RATES.service_and_other === 15_000, "service 0.015000 -> 15000");
    for (const c of ALL_BO_CLASSIFICATIONS) {
      ok(Number.isInteger(DEFAULT_BO_RATES[c]), `${c} rate is an integer`);
    }
  });

  // --- THE POINT OF RULE 114: bps cannot hold the retailing rate ---------
  t("basis points would misstate the filed return", () => {
    const base = JULY_2026_RETURN_AS_FILED.retailBaseCents;
    const exact = applyRateMillionths(base, 4710);
    const down = applyRateMillionths(base, bpsToMillionths(47));
    const up = applyRateMillionths(base, bpsToMillionths(48));
    ok(exact === JULY_2026_RETURN_AS_FILED.boRetailingTaxCents, "exact rate matches the filing");
    ok(down !== exact, "47 bps does NOT match — this is why millionths exist");
    ok(up !== exact, "48 bps does NOT match either");
    ok(exact - down === 168, "rounding down understates by $1.68");
    ok(up - exact === 1516, "rounding up overstates by $15.16");
  });

  // --- every line of the real return ------------------------------------
  t("B&O Retailing ties to the filed return", () => {
    const l = boLine({
      classification: "retailing",
      grossCents: JULY_2026_RETURN_AS_FILED.retailBaseCents,
      rates: DEFAULT_BO_RATES,
    });
    ok(
      l.taxCents === JULY_2026_RETURN_AS_FILED.boRetailingTaxCents,
      `retailing: got ${String(l.taxCents)}, filed ${String(JULY_2026_RETURN_AS_FILED.boRetailingTaxCents)}`,
    );
    ok(l.entity === "greenway", "retailing belongs to the store");
  });

  t("B&O Service and Other ties to the filed return", () => {
    const l = boLine({
      classification: "service_and_other",
      grossCents: JULY_2026_RETURN_AS_FILED.atmSurchargeCents,
      rates: DEFAULT_BO_RATES,
    });
    ok(
      l.taxCents === JULY_2026_RETURN_AS_FILED.boServiceTaxCents,
      `service: got ${String(l.taxCents)}, filed ${String(JULY_2026_RETURN_AS_FILED.boServiceTaxCents)}`,
    );
    ok(l.entity === "atm", "the surcharge belongs to the ATM operation");
  });

  t("all three types reproduce the whole return", () => {
    const b = threeTypeBreakdown({
      retailBaseCents: JULY_2026_RETURN_AS_FILED.retailBaseCents,
      atmSurchargeCents: JULY_2026_RETURN_AS_FILED.atmSurchargeCents,
      stateSalesRateBps: 650,
      localSalesRateBps: 280,
      boRates: DEFAULT_BO_RATES,
    });
    ok(b.stateSalesTaxCents === JULY_2026_RETURN_AS_FILED.stateSalesTaxCents, "state line");
    ok(b.localSalesTaxCents === JULY_2026_RETURN_AS_FILED.localSalesTaxCents, "local line");
    ok(b.boTaxCents === JULY_2026_RETURN_AS_FILED.boTotalTaxCents, "B&O subtotal");
    ok(b.totalTaxCents === JULY_2026_RETURN_AS_FILED.totalTaxCents, "grand total");
    ok(b.boLines.length === 2, "two B&O lines");
  });

  t("the three types are genuinely different amounts", () => {
    const b = threeTypeBreakdown({
      retailBaseCents: JULY_2026_RETURN_AS_FILED.retailBaseCents,
      atmSurchargeCents: JULY_2026_RETURN_AS_FILED.atmSurchargeCents,
      stateSalesRateBps: 650,
      localSalesRateBps: 280,
      boRates: DEFAULT_BO_RATES,
    });
    const three = [b.stateSalesTaxCents, b.localSalesTaxCents, b.boTaxCents];
    ok(new Set(three).size === 3, "state, local and B&O are three distinct figures");
    ok(b.trustTaxCents === b.stateSalesTaxCents + b.localSalesTaxCents, "trust = state + local");
    ok(!three.includes(0), "none of the three is zero on a real month");
  });

  t("no ATM line when there is no surcharge", () => {
    const b = threeTypeBreakdown({
      retailBaseCents: 10_000_00,
      atmSurchargeCents: 0,
      stateSalesRateBps: 650,
      localSalesRateBps: 280,
      boRates: DEFAULT_BO_RATES,
    });
    ok(b.boLines.length === 1, "one line only");
    ok(b.boLines[0]?.classification === "retailing", "and it is retailing");
  });

  // --- the two rates must not be swapped or shared ----------------------
  t("the ATM is not taxed at the retail rate", () => {
    const atRetail = applyRateMillionths(
      JULY_2026_RETURN_AS_FILED.atmSurchargeCents,
      DEFAULT_BO_RATES.retailing,
    );
    ok(
      atRetail !== JULY_2026_RETURN_AS_FILED.boServiceTaxCents,
      "the service rate is 3.18x the retail rate; using one for the other is a real error",
    );
  });

  // --- the accounting: HIS point ---------------------------------------
  t("the accrual books an EXPENSE, not just a liability", () => {
    const e = boAccrualEntry({ boTaxCents: 85_880, periodLabel: "July 2026" });
    ok(entryBalances(e), "the entry balances");
    ok(recognisesBoExpense(e), "75040 is debited — B&O hits the P&L");
    const exp = e.find((l) => l.accountCode === ACCOUNT_BO_EXPENSE);
    const pay = e.find((l) => l.accountCode === ACCOUNT_BO_PAYABLE);
    ok(exp?.debitCents === 85_880, "expense debited in full");
    ok(pay?.creditCents === 85_880, "payable credited in full");
  });

  t("B&O never books like sales tax", () => {
    const e = boAccrualEntry({ boTaxCents: 85_880, periodLabel: "July 2026" });
    ok(
      !e.some((l) => l.accountCode === ACCOUNT_SALES_TAX_PAYABLE),
      "B&O must never touch the trust sales-tax liability 32100",
    );
    // A liability-only entry — the "tidy simplification" that would overstate
    // profit forever — must be detectable as wrong.
    const wrong: readonly JournalLine[] = [
      { accountCode: ACCOUNT_BO_PAYABLE, debitCents: 0, creditCents: 85_880, memo: "x" },
      { accountCode: "10100", debitCents: 85_880, creditCents: 0, memo: "y" },
    ];
    ok(!recognisesBoExpense(wrong), "a liability-only entry is correctly seen as missing the expense");
  });

  t("payment clears the payable and books no second expense", () => {
    const p = boPaymentEntry({
      boTaxCents: 85_880,
      periodLabel: "July 2026",
      bankAccountCode: "10100",
    });
    ok(entryBalances(p), "payment balances");
    ok(!recognisesBoExpense(p), "paying it must NOT expense it again");
    ok(p[0]?.accountCode === ACCOUNT_BO_PAYABLE && p[0].debitCents === 85_880, "payable cleared");
  });

  t("accrue then pay leaves the payable at zero", () => {
    const a = boAccrualEntry({ boTaxCents: 85_880, periodLabel: "July 2026" });
    const p = boPaymentEntry({
      boTaxCents: 85_880,
      periodLabel: "July 2026",
      bankAccountCode: "10100",
    });
    const net = [...a, ...p]
      .filter((l) => l.accountCode === ACCOUNT_BO_PAYABLE)
      .reduce((s, l) => s + l.creditCents - l.debitCents, 0);
    ok(net === 0, "the liability is fully temporary");
    const expense = [...a, ...p]
      .filter((l) => l.accountCode === ACCOUNT_BO_EXPENSE)
      .reduce((s, l) => s + l.debitCents, 0);
    ok(expense === 85_880, "and the expense is recognised exactly once");
  });

  // --- refusals ---------------------------------------------------------
  t("bad inputs are refused, and each by ITS OWN guard", () => {
    // Every one pins a distinct refusal code. Under the old prose matching,
    // M10 could disable the negative-gross guard and stay green because the
    // deductions guard fired instead and said the word "negative".
    throwsCode(
      () => boLine({ classification: "retailing", grossCents: -1, rates: DEFAULT_BO_RATES }),
      BO_REFUSAL.GROSS_NEGATIVE,
      "negative gross",
    );
    throwsCode(
      () => boLine({ classification: "retailing", grossCents: 100.5, rates: DEFAULT_BO_RATES }),
      BO_REFUSAL.GROSS_NOT_INTEGER,
      "fractional cents",
    );
    throwsCode(
      () =>
        boLine({
          classification: "retailing",
          grossCents: 100,
          deductionsCents: 200,
          rates: DEFAULT_BO_RATES,
        }),
      BO_REFUSAL.DEDUCTIONS_EXCEED_GROSS,
      "deductions above gross",
    );
    throwsCode(
      () =>
        boLine({
          classification: "retailing",
          grossCents: 100,
          deductionsCents: -5,
          rates: DEFAULT_BO_RATES,
        }),
      BO_REFUSAL.DEDUCTIONS_NEGATIVE,
      "negative deductions",
    );
    throwsCode(() => applyRateMillionths(100, -5), BO_REFUSAL.RATE_NEGATIVE, "negative rate");
    throwsCode(() => applyRateMillionths(100, 1.5), BO_REFUSAL.RATE_NOT_INTEGER, "fractional rate");
    throwsCode(
      () => applyRateMillionths(1.5, 100),
      BO_REFUSAL.BASE_NOT_INTEGER,
      "fractional base",
    );
    throwsCode(
      () => boAccrualEntry({ boTaxCents: 0, periodLabel: "x" }),
      BO_REFUSAL.ACCRUAL_NOT_POSITIVE,
      "zero accrual",
    );
    throwsCode(
      () => boAccrualEntry({ boTaxCents: -5, periodLabel: "x" }),
      BO_REFUSAL.ACCRUAL_NOT_POSITIVE,
      "negative accrual",
    );
    throwsCode(
      () => boAccrualEntry({ boTaxCents: 1.5, periodLabel: "x" }),
      BO_REFUSAL.ACCRUAL_NOT_INTEGER,
      "fractional accrual",
    );
    throwsCode(
      () => boPaymentEntry({ boTaxCents: 0, periodLabel: "x", bankAccountCode: "10100" }),
      BO_REFUSAL.PAYMENT_NOT_POSITIVE,
      "zero payment",
    );
  });

  t("the negative-gross guard is reached BEFORE any other guard", () => {
    // The precise reason M10 escaped: with gross -100 and deductions 0, the
    // deductions-exceed-gross comparison (0 > -100) is also true. Guard order
    // is therefore load-bearing, and this test says so out loud.
    throwsCode(
      () =>
        boLine({
          classification: "retailing",
          grossCents: -100,
          deductionsCents: 0,
          rates: DEFAULT_BO_RATES,
        }),
      BO_REFUSAL.GROSS_NEGATIVE,
      "negative gross must be blamed on the gross, not the deductions",
    );
  });

  t("every refusal code is unique", () => {
    const codes = ALL_BO_REFUSAL_CODES;
    ok(new Set(codes).size === codes.length, "no two guards share a code");
    ok(codes.length === 14, `expected 14 refusal codes, found ${String(codes.length)}`);
  });

  // Rule 40: the overflow guard is reachable, so prove it fires.
  t("an absurd base is refused rather than approximated", () => {
    throwsCode(
      () => applyRateMillionths(Number.MAX_SAFE_INTEGER, 4710),
      BO_REFUSAL.PRODUCT_UNSAFE,
      "overflow",
    );
  });

  t("rounding is half away from zero, as DOR does it", () => {
    // 0.5 cent cases, chosen so the division lands exactly on .5
    ok(applyRateMillionths(1_000_000, 5) === 5, "exact, no rounding needed");
    ok(applyRateMillionths(100, 15_000) === 2, "1.50 -> 2 (half up)");
    ok(applyRateMillionths(1, 4710) === 0, "0.00471 -> 0");
  });

  t("zero base gives zero tax without throwing", () => {
    const l = boLine({ classification: "retailing", grossCents: 0, rates: DEFAULT_BO_RATES });
    ok(l.taxCents === 0, "no receipts, no tax");
    ok(l.taxableCents === 0, "taxable zero");
  });

  t("deductions reduce the taxable amount", () => {
    const l = boLine({
      classification: "retailing",
      grossCents: 100_000_00,
      deductionsCents: 10_000_00,
      rates: DEFAULT_BO_RATES,
    });
    ok(l.taxableCents === 90_000_00, "gross less deductions");
    ok(l.taxCents === applyRateMillionths(90_000_00, 4710), "tax on the net figure");
  });

  t("the vocabulary is walked, not hand-listed", () => {
    // Rule 43: every classification must have a rate, a label and an entity.
    for (const c of ALL_BO_CLASSIFICATIONS) {
      ok(DEFAULT_BO_RATES[c] > 0, `${c} has a rate`);
      ok(BO_CLASSIFICATION_LABELS[c].length > 0, `${c} has a label`);
      ok(BO_CLASSIFICATION_ENTITY[c].length > 0, `${c} has an entity`);
    }
    ok(
      Object.keys(DEFAULT_BO_RATES).length === ALL_BO_CLASSIFICATIONS.length,
      "no rate exists for a classification that is not in the list",
    );
    ok(ALL_WA_SALES_TAX_TYPES.length === 3, "three types, as Michael named them");
  });

  console.log(`bo-tax-core: ${String(n)} self-test groups passed`);
}
