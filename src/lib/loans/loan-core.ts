/**
 * src/lib/loans/loan-core.ts — Manual loan foundation (pure core).
 *
 * No I/O, no network, no server-only imports — fully unit-testable with tsx and
 * mirrored in vitest. This is the "loan brain": it turns owner-entered loan
 * terms into an integer-safe amortization schedule and plain-English summaries.
 *
 * WHY MANUAL (not Plaid): some servicers (e.g. Cenlar for Sound CU's mortgage)
 * will not return full Liabilities detail through Plaid. So the owner enters the
 * loan terms once, we generate the exact schedule, and later match the monthly
 * payment against the connected Timberland account for an audit trail.
 *
 * MONEY RULE (standing): every dollar amount is an INTEGER of CENTS. Nothing is
 * a float in storage or in the schedule rows.
 *
 * RATE RULE: interest rates are stored as INTEGER THOUSANDTHS-OF-A-PERCENT
 * ("milli-percent"): 2.375% = 2375, 3.99% = 3990, 0% = 0. The decimal rate is
 * value / 100000 (2375 / 100000 = 0.02375). We use finer resolution than the
 * Plaid mortgage table's basis points on purpose: 2.375% is NOT an integer in
 * basis points (237.5), and rounding it to 238 bps throws the monthly interest
 * off by ~$2. Milli-percent represents Michael's real rate exactly.
 *
 * The amortization math is deliberately the textbook servicer method, which we
 * VERIFIED against Michael's real Sound CU statement to the penny:
 *   interest_this_month = round( balance_before * (rateMilliPct / 100000) / 12 )
 * so a 2.375% loan on a $501,091.76 balance yields exactly $991.74, matching the
 * statement.
 */

// ---------------------------------------------------------------------------
// 0) Small helpers (float-free money + rate formatting).
// ---------------------------------------------------------------------------

/** Format integer cents as "$1,234.56" (or "-$…"); "—" for null/non-finite. */
export function formatLoanCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const neg = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const dollarsStr = dollars.toLocaleString("en-US");
  const centsStr = rem.toString().padStart(2, "0");
  return `${neg ? "-" : ""}$${dollarsStr}.${centsStr}`;
}

/**
 * Format integer milli-percent (thousandths of a percent) as "2.375%".
 * 2375 -> "2.375%", 3990 -> "3.99%", 500 -> "0.5%", 0 -> "0%". "—" if null.
 */
export function formatRateMilliPct(milli: number | null | undefined): string {
  if (milli === null || milli === undefined || !Number.isFinite(milli)) return "—";
  const neg = milli < 0;
  const abs = Math.abs(Math.trunc(milli));
  const whole = Math.floor(abs / 1000);
  const frac = abs % 1000;
  let out: string;
  if (frac === 0) {
    out = `${whole}%`;
  } else {
    const fracStr = frac.toString().padStart(3, "0").replace(/0+$/, "");
    out = `${whole}.${fracStr}%`;
  }
  return `${neg ? "-" : ""}${out}`;
}

/**
 * Convert a dollars string/number to integer cents, float-safe.
 * Accepts "475588.75", "$475,588.75", 475588.75. Returns null if unparseable.
 */
export function dollarsToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let s: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    s = input.toFixed(2);
  } else {
    s = input.trim().replace(/[$,\s]/g, "");
    if (s === "") return null;
  }
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, fracRaw = ""] = s.split(".");
  const frac = (fracRaw + "00").slice(0, 2);
  const cents = Number(whole) * 100 + Number(frac);
  if (!Number.isFinite(cents)) return null;
  return neg ? -cents : cents;
}

/**
 * Convert a percent string/number to integer milli-percent (thousandths of a
 * percent), float-safe. Accepts "2.375", 2.375, "2.375%".
 * 2.375% -> 2375; 3.99% -> 3990; 0% -> 0. Returns null if unparseable.
 * Rounds to the nearest thousandth of a percent.
 */
export function percentToMilliPct(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let s: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    s = String(input);
  } else {
    s = input.trim().replace(/[%\s]/g, "");
    if (s === "") return null;
  }
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  // milli-percent = percent * 1000, computed off strings to stay float-free.
  const [whole, fracRaw = ""] = s.split(".");
  // Take up to 4 fractional digits, then round to 3 (thousandths of a percent).
  const frac4 = (fracRaw + "0000").slice(0, 4);
  const milliTimes10 = Number(whole) * 10000 + Number(frac4); // whole*1000*10 + frac(ten-thousandths)
  const milli = Math.round(milliTimes10 / 10);
  if (!Number.isFinite(milli)) return null;
  return neg ? -milli : milli;
}

// ---------------------------------------------------------------------------
// 1) Loan kinds + input shape.
// ---------------------------------------------------------------------------

/**
 * "amortizing"    — standard fixed-rate loan (e.g. the 2.375% 15-yr mortgage).
 *                   Fixed monthly P&I; interest = balance * monthlyRate.
 * "interest_free" — 0% promo (e.g. Jared 18-month). Flat principal / term; the
 *                   interest column is always $0 until the promo would expire.
 */
export type LoanKind = "amortizing" | "interest_free";

export type LoanInput = {
  /** Stable id (uuid or slug). */
  id: string;
  /** Human name, e.g. "Sound CU mortgage" or "Jared". */
  name: string;
  kind: LoanKind;

  /** Original financed principal, in integer cents. */
  originalPrincipalCents: number;
  /** Interest rate in integer milli-percent (2375 = 2.375%; 0 for interest-free). */
  rateMilliPct: number;
  /** Total number of monthly payments in the schedule (e.g. 180, 18). */
  termMonths: number;

  /**
   * First payment date, ISO "YYYY-MM-DD". Schedule rows step one calendar month
   * at a time from here.
   */
  firstPaymentDate: string;

  /**
   * OPTIONAL fixed scheduled monthly payment (principal+interest only, no
   * escrow), integer cents. If provided for an amortizing loan we trust it (it
   * is what the servicer actually charges — Michael's is $4,276.16). If omitted
   * we derive it from principal/rate/term.
   */
  scheduledPaymentCents?: number | null;
};

// ---------------------------------------------------------------------------
// 2) Date stepping (calendar months) — pure, no Date-locale surprises.
// ---------------------------------------------------------------------------

/** Parse "YYYY-MM-DD" into {y,m,d}; returns null if malformed. */
export function parseIsoDate(iso: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!iso || typeof iso !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/** Days in a given month (1-12), accounting for leap years. */
function daysInMonth(y: number, m: number): number {
  if (m === 2) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return leap ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Add `n` calendar months to an ISO date, clamping the day (e.g. Jan 31 + 1mo → Feb 28). */
export function addMonthsIso(iso: string, n: number): string | null {
  const p = parseIsoDate(iso);
  if (!p) return null;
  const totalMonthIndex = (p.y * 12 + (p.m - 1)) + n;
  const y = Math.floor(totalMonthIndex / 12);
  const m = (totalMonthIndex % 12) + 1;
  const d = Math.min(p.d, daysInMonth(y, m));
  const mm = m.toString().padStart(2, "0");
  const dd = d.toString().padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// 3) Scheduled payment derivation (amortizing).
// ---------------------------------------------------------------------------

/**
 * Standard amortization payment, integer cents, for a loan of `principalCents`
 * at `rateMilliPct` (thousandths of a percent) over `termMonths`. Rounds to the
 * nearest cent. For 0% loans this degrades to principal/term (flat).
 */
export function computeScheduledPaymentCents(
  principalCents: number,
  rateMilliPct: number,
  termMonths: number,
): number {
  if (termMonths <= 0) return 0;
  if (rateMilliPct === 0) {
    return Math.round(principalCents / termMonths);
  }
  const monthlyRate = rateMilliPct / 100000 / 12; // e.g. 2375 -> 0.02375/12
  const factor = Math.pow(1 + monthlyRate, -termMonths);
  const payment = (principalCents * monthlyRate) / (1 - factor);
  return Math.round(payment);
}

// ---------------------------------------------------------------------------
// 4) Amortization schedule rows.
// ---------------------------------------------------------------------------

export type AmortRow = {
  /** 1-based payment number. */
  number: number;
  /** Scheduled date, ISO "YYYY-MM-DD". */
  date: string;
  /** Scheduled payment this month (P&I only), integer cents. */
  paymentCents: number;
  /** Interest portion, integer cents. */
  interestCents: number;
  /** Principal portion, integer cents. */
  principalCents: number;
  /** Remaining balance AFTER this payment, integer cents. */
  balanceCents: number;
};

export type AmortSchedule = {
  rows: AmortRow[];
  /** Sum of every interest row, integer cents (total interest over the loan). */
  totalInterestCents: number;
  /** Sum of every payment row, integer cents. */
  totalPaidCents: number;
  /** The level scheduled monthly payment used, integer cents. */
  scheduledPaymentCents: number;
};

/**
 * Build a full amortization schedule from a LoanInput.
 *
 * Amortizing: level payment; interest = round(balance * monthlyRate); principal
 * = payment - interest; the FINAL row absorbs rounding so the balance lands
 * exactly at 0.
 *
 * Interest-free: interest is always 0; principal = flat principal/term; the
 * final row absorbs rounding so the balance lands exactly at 0.
 */
export function buildAmortizationSchedule(loan: LoanInput): AmortSchedule {
  const rows: AmortRow[] = [];
  const term = Math.max(0, Math.trunc(loan.termMonths));
  const principal0 = Math.max(0, Math.trunc(loan.originalPrincipalCents));

  const scheduled =
    loan.scheduledPaymentCents && loan.scheduledPaymentCents > 0
      ? Math.trunc(loan.scheduledPaymentCents)
      : computeScheduledPaymentCents(principal0, loan.rateMilliPct, term);

  const monthlyRate =
    loan.kind === "interest_free" || loan.rateMilliPct === 0 ? 0 : loan.rateMilliPct / 100000 / 12;

  let balance = principal0;
  let totalInterest = 0;
  let totalPaid = 0;

  for (let i = 1; i <= term; i++) {
    const isLast = i === term;
    const date = addMonthsIso(loan.firstPaymentDate, i - 1) ?? loan.firstPaymentDate;

    const interest = monthlyRate === 0 ? 0 : Math.round(balance * monthlyRate);
    let principalPortion = scheduled - interest;

    if (isLast) {
      // Final row: pay off exactly whatever is left (plus its interest).
      principalPortion = balance;
    } else if (principalPortion > balance) {
      principalPortion = balance;
    }

    // Guard against negative principal on tiny/edge inputs.
    if (principalPortion < 0) principalPortion = 0;

    const payment = principalPortion + interest;
    balance = balance - principalPortion;
    if (balance < 0) balance = 0;

    totalInterest += interest;
    totalPaid += payment;

    rows.push({
      number: i,
      date,
      paymentCents: payment,
      interestCents: interest,
      principalCents: principalPortion,
      balanceCents: balance,
    });

    if (balance === 0) break;
  }

  return {
    rows,
    totalInterestCents: totalInterest,
    totalPaidCents: totalPaid,
    scheduledPaymentCents: scheduled,
  };
}

// ---------------------------------------------------------------------------
// 5) Plain-English loan summary view.
// ---------------------------------------------------------------------------

export type LoanSummaryInput = {
  name: string;
  kind: LoanKind;
  originalPrincipalCents: number;
  /** Current remaining principal, integer cents (owner-provided or derived). */
  currentBalanceCents: number | null;
  rateMilliPct: number;
  termMonths: number;
  firstPaymentDate: string;
  maturityDate: string | null;
  scheduledPaymentCents: number | null;
};

export type LoanSummaryView = {
  name: string;
  kindText: string;
  originalText: string;
  balanceText: string;
  rateText: string;
  termText: string;
  paymentText: string;
  firstPaymentText: string;
  maturityText: string;
  /** Percent of the loan paid off, whole number 0..100 (null balance -> null). */
  paidOffPercent: number | null;
};

export function buildLoanSummaryView(input: LoanSummaryInput): LoanSummaryView {
  const kindText = input.kind === "interest_free" ? "Interest-free" : "Amortizing (fixed rate)";
  const rateText =
    input.kind === "interest_free" || input.rateMilliPct === 0
      ? "0% (interest-free)"
      : formatRateMilliPct(input.rateMilliPct);
  const termText = input.termMonths > 0 ? `${input.termMonths} months` : "—";

  let paidOffPercent: number | null = null;
  if (
    input.currentBalanceCents !== null &&
    Number.isFinite(input.currentBalanceCents) &&
    input.originalPrincipalCents > 0
  ) {
    const paid = input.originalPrincipalCents - input.currentBalanceCents;
    const pct = Math.round((paid / input.originalPrincipalCents) * 100);
    paidOffPercent = Math.max(0, Math.min(100, pct));
  }

  return {
    name: input.name,
    kindText,
    originalText: formatLoanCents(input.originalPrincipalCents),
    balanceText: formatLoanCents(input.currentBalanceCents),
    rateText,
    termText,
    paymentText: formatLoanCents(input.scheduledPaymentCents),
    firstPaymentText: input.firstPaymentDate || "—",
    maturityText: input.maturityDate || "—",
    paidOffPercent,
  };
}

// ---------------------------------------------------------------------------
// 6) Self-tests (run by scripts/compliance/run-pure-selftests.ts and vitest).
// ---------------------------------------------------------------------------

export function __runLoanCoreTests(): void {
  const failures: string[] = [];
  const ok = (cond: boolean, msg: string): void => {
    if (!cond) failures.push(msg);
  };

  // ---- money / rate parsing ------------------------------------------------
  ok(dollarsToCents("475588.75") === 47558875, "dollarsToCents plain");
  ok(dollarsToCents("$475,588.75") === 47558875, "dollarsToCents formatted");
  ok(dollarsToCents(21881.91) === 2188191, "dollarsToCents number");
  ok(dollarsToCents("-12.50") === -1250, "dollarsToCents negative");
  ok(dollarsToCents("") === null, "dollarsToCents empty -> null");
  ok(dollarsToCents("abc") === null, "dollarsToCents junk -> null");

  ok(percentToMilliPct("2.375") === 2375, "percentToMilliPct 2.375");
  ok(percentToMilliPct(2.375) === 2375, "percentToMilliPct number");
  ok(percentToMilliPct("2.375%") === 2375, "percentToMilliPct with % sign");
  ok(percentToMilliPct("0") === 0, "percentToMilliPct zero");
  ok(percentToMilliPct("3.99") === 3990, "percentToMilliPct 3.99");
  ok(percentToMilliPct("") === null, "percentToMilliPct empty -> null");

  ok(formatLoanCents(47558875) === "$475,588.75", "formatLoanCents");
  ok(formatLoanCents(null) === "—", "formatLoanCents null");
  ok(formatRateMilliPct(2375) === "2.375%", "formatRateMilliPct 2.375");
  ok(formatRateMilliPct(3990) === "3.99%", "formatRateMilliPct 3.99");
  ok(formatRateMilliPct(5000) === "5%", "formatRateMilliPct whole");
  ok(formatRateMilliPct(0) === "0%", "formatRateMilliPct zero");

  // ---- date stepping -------------------------------------------------------
  ok(addMonthsIso("2022-06-01", 0) === "2022-06-01", "addMonths 0");
  ok(addMonthsIso("2022-06-01", 1) === "2022-07-01", "addMonths 1");
  ok(addMonthsIso("2022-06-01", 12) === "2023-06-01", "addMonths 12");
  ok(addMonthsIso("2022-01-31", 1) === "2022-02-28", "addMonths clamps to Feb");
  ok(addMonthsIso("2024-01-31", 1) === "2024-02-29", "addMonths leap Feb");
  ok(parseIsoDate("2022-13-01") === null, "parseIsoDate rejects month 13");

  // ---- amortization: mortgage sanity (VERIFIED vs real statement) ----------
  // Original principal $647,000.00; 2.375%; 180 months. Servicer P&I = $4,276.16.
  const pmt = computeScheduledPaymentCents(64700000, 2375, 180);
  ok(pmt === 427616, `mortgage payment == $4,276.16 (got ${formatLoanCents(pmt)})`);

  const mortgage: LoanInput = {
    id: "m1",
    name: "Sound CU mortgage",
    kind: "amortizing",
    originalPrincipalCents: 64700000,
    rateMilliPct: 2375,
    termMonths: 180,
    firstPaymentDate: "2022-06-01",
    scheduledPaymentCents: 427616,
  };
  const sched = buildAmortizationSchedule(mortgage);
  ok(sched.rows.length === 180, `mortgage schedule has 180 rows (got ${sched.rows.length})`);
  ok(sched.rows[0].date === "2022-06-01", "mortgage first row date");
  ok(sched.rows[179].date === "2037-05-01", "mortgage final row date == May 2037");
  ok(sched.rows[179].balanceCents === 0, "mortgage pays off to 0");
  // First month interest = round(647000.00 * 0.02375/12) = $1,280.52 (matches PDF row 2022-06).
  ok(sched.rows[0].interestCents === 128052, `mortgage first interest == $1,280.52 (got ${formatLoanCents(sched.rows[0].interestCents)})`);
  ok(sched.rows[0].principalCents === 427616 - 128052, "mortgage first principal = payment - interest");
  // Balance after first payment: 647000.00 - 2995.64 = 644004.36 (matches PDF).
  ok(sched.rows[0].balanceCents === 64400436, `mortgage balance after pmt 1 == $644,004.36 (got ${formatLoanCents(sched.rows[0].balanceCents)})`);
  // Total paid should be > principal (there is interest).
  ok(sched.totalPaidCents > 64700000, "mortgage total paid exceeds principal");
  ok(sched.totalInterestCents > 0, "mortgage has positive total interest");

  // ---- amortization: Jared interest-free -----------------------------------
  // Original $21,881.91; 0%; 18 months; first payment 2026-07-17.
  const jared: LoanInput = {
    id: "j1",
    name: "Jared",
    kind: "interest_free",
    originalPrincipalCents: 2188191,
    rateMilliPct: 0,
    termMonths: 18,
    firstPaymentDate: "2026-07-17",
  };
  const jsched = buildAmortizationSchedule(jared);
  ok(jsched.rows.length === 18, `jared schedule 18 rows (got ${jsched.rows.length})`);
  ok(jsched.totalInterestCents === 0, "jared: zero total interest");
  ok(jsched.rows[jsched.rows.length - 1].balanceCents === 0, "jared: pays off to 0");
  ok(jsched.rows[0].date === "2026-07-17", "jared first payment date");
  ok(jsched.rows[1].date === "2026-08-17", "jared second payment date (+1 month)");
  // Flat payment ~ 21881.91/18 = 1215.66 (rounded); sum of payments == principal.
  ok(jsched.totalPaidCents === 2188191, `jared total paid == original principal (got ${formatLoanCents(jsched.totalPaidCents)})`);
  ok(jsched.rows[0].paymentCents === 121566, `jared level payment ~ $1,215.66 (got ${formatLoanCents(jsched.rows[0].paymentCents)})`);

  // ---- summary view --------------------------------------------------------
  const view = buildLoanSummaryView({
    name: "Sound CU mortgage",
    kind: "amortizing",
    originalPrincipalCents: 64700000,
    currentBalanceCents: 47558875,
    rateMilliPct: 2375,
    termMonths: 180,
    firstPaymentDate: "2022-06-01",
    maturityDate: "2037-05-01",
    scheduledPaymentCents: 427616,
  });
  ok(view.rateText === "2.375%", "summary rate");
  ok(view.balanceText === "$475,588.75", "summary balance");
  ok(view.paymentText === "$4,276.16", "summary payment");
  ok(view.paidOffPercent === 26, `summary paid-off % (got ${String(view.paidOffPercent)})`);

  const jview = buildLoanSummaryView({
    name: "Jared",
    kind: "interest_free",
    originalPrincipalCents: 2188191,
    currentBalanceCents: 2098091,
    rateMilliPct: 0,
    termMonths: 18,
    firstPaymentDate: "2026-07-17",
    maturityDate: null,
    scheduledPaymentCents: 121566,
  });
  ok(jview.rateText === "0% (interest-free)", "jared summary rate text");
  ok(jview.maturityText === "—", "jared summary maturity em dash");

  if (failures.length) {
    throw new Error(`loan-core self-tests FAILED:\n  - ${failures.join("\n  - ")}`);
  }
  console.log("loan-core self-tests: all passed");
}
