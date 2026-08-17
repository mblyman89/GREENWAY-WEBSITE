/**
 * src/lib/accounting/cutover-core.ts   (slice books-02)
 *
 * THE CONVERSION. Everything about leaving Cultivera and Sage behind on
 * 1 November 2026, expressed as pure functions with no I/O.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OWNER'S PLAN, recorded verbatim (Michael, 2026-08-17):
 *
 *   "I am cutting over from Cultivera pos and sage on November 1st 2026. I will
 *    drop Cultivera completely. I will keep sage and run both books in parallel
 *    until year end. If all goes well, we will drop sage and use our platform
 *    exclusively. Sage will have all of my Cultivera activity recorded in it
 *    already, so I won't need to recreate the full year. I will start from
 *    beginning balances."
 *
 *   "we are accrual based for all entities and my person."
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * THREE THINGS THIS FILE IS RESPONSIBLE FOR
 *
 *   1. THE DATES. The cut-over is 2026-11-01. The opening balance sheet is
 *      therefore dated 2026-10-31 — the close of business the day before. The
 *      parallel run is 2026-11-01 through 2026-12-31. These were hard-coded as
 *      2025-12-31 throughout the ledger, built for a 1 January cut-over that is
 *      not happening; migration 0184 moves them and this module is the
 *      application-side statement of the same truth, so a test can compare the
 *      two independently.
 *
 *   2. THE OPENING BALANCE SHEET IS *PROVED*, NOT ASSUMED. A conversion is the
 *      one moment where a wrong number can never be found again: everything
 *      afterwards is measured from it, and it balances either way. So the
 *      worksheet is checked for far more than "debits equal credits" — see
 *      `reviewOpeningBalances`.
 *
 *   3. THE PARALLEL RUN IS THE PROOF. Two months of running both systems is
 *      the only real evidence the conversion worked. `reconcileParallelRun`
 *      compares this platform's trial balance to Sage's, account by account,
 *      and REFUSES to call it clean on anything but an exact match.
 *
 * WHY "AGREES WITH SAGE" IS NOT THE SAME AS "CORRECT"
 * Sage contains Michael's own Cultivera-era bookkeeping. If a treatment was
 * wrong in Sage, matching it exactly reproduces the error with more confidence.
 * So a clean reconciliation is reported as *consistent*, never as *correct*,
 * and the wording is asserted in the tests. This is the same discipline as the
 * trial-balance banner in books-view-core: an empty set of books balances too.
 *
 * PURITY. No database, no network, no clock, no randomness. Every function is
 * total and deterministic; the same inputs always give byte-identical output.
 * Money is INTEGER CENTS throughout (standing rule 7).
 */

// ---------------------------------------------------------------------------
// THE DATES
// ---------------------------------------------------------------------------

/**
 * The first day of business on this platform.
 *
 * NOTE ON THE `: string` ANNOTATIONS BELOW. These are deliberately widened from
 * their literal types. They mirror `gl_conversion_config`, which is DATA and can
 * be moved without a deploy; typing them as the literal "2026-11-01" would let
 * TypeScript "prove" comparisons between two of them are impossible and reject
 * the very assertions that exist to catch a bad edit.
 */
export const CUTOVER_DATE: string = "2026-11-01";

/**
 * The date the opening balance sheet carries: the close of business the day
 * before the cut-over. This is the single most important date in the ledger —
 * every period, comparative and tax figure is measured from it.
 */
export const OPENING_BALANCE_DATE: string = "2026-10-31";

/** The window in which the books are kept in BOTH systems. */
export const PARALLEL_RUN_START: string = "2026-11-01";
export const PARALLEL_RUN_END: string = "2026-12-31";

/**
 * The date the ledger was ORIGINALLY built around, kept here for one reason: a
 * test asserts it is no longer used as the opening date. Deleting it would make
 * that test impossible to write.
 */
export const SUPERSEDED_OPENING_DATE: string = "2025-12-31";

/** The four sets of books. */
export const ENTITY_CODES = ["greenway", "atm", "landholding", "personal"] as const;
export type EntityCode = (typeof ENTITY_CODES)[number];

/**
 * Owner decision 2026-08-17: "we are accrual based for all entities and my
 * person." Stated per entity because basis is an entity-level tax attribute.
 */
export const ACCOUNTING_BASIS: Readonly<Record<EntityCode, "accrual" | "cash">> = {
  greenway: "accrual",
  atm: "accrual",
  landholding: "accrual",
  personal: "accrual",
};

// ---------------------------------------------------------------------------
// SMALL PURE HELPERS
// ---------------------------------------------------------------------------

/** Days in a month, leap-year aware. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Strict YYYY-MM-DD validation. No Date object, so no timezone can intrude. */
export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(5, 7));
  const day = Number(s.slice(8, 10));
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  return day <= daysInMonth(year, month);
}

/** Compare ISO dates as strings — valid because the format sorts naturally. */
export function isOnOrAfter(a: string, b: string): boolean {
  return a >= b;
}

/** The day before an ISO date, without constructing a Date. */
export function previousDay(iso: string): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  let y = year;
  let m = month;
  let d = day - 1;
  if (d === 0) {
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
    d = daysInMonth(y, m);
  }
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/** Format integer cents as plain dollars for a human-facing sentence. */
export function formatCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${grouped}.${frac}`;
}

/** Is this date inside the parallel run? */
export function isInParallelRun(iso: string): boolean {
  return iso >= PARALLEL_RUN_START && iso <= PARALLEL_RUN_END;
}

// ---------------------------------------------------------------------------
// THE OPENING BALANCE WORKSHEET
// ---------------------------------------------------------------------------

export const EVIDENCE_KINDS = [
  "bank_statement",
  "loan_statement",
  "inventory_count",
  "fixed_asset_schedule",
  "ap_aging",
  "ar_aging",
  "tax_notice",
  "payroll_report",
  "sage_trial_balance",
  "k1_or_return",
  "legal_document",
  "other",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "income"
  | "cogs"
  | "expense"
  | "other_income"
  | "other_expense";

export type OpeningRow = {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  /** Positive = debit, negative = credit. Integer cents. Never zero. */
  amountCents: number;
  evidenceKind: EvidenceKind;
  evidenceRef: string;
  evidenceNote?: string | null;
  status: "staged" | "excluded" | "posted";
  exclusionReason?: string | null;
};

export type CutoverSeverity = "block" | "warn" | "note";

export type CutoverFinding = {
  code: string;
  severity: CutoverSeverity;
  /** Plain English. Michael has not opened an accounting book in 13 years. */
  concern: string;
  suggestion: string;
  accountCodes: readonly string[];
};

export type OpeningReview = {
  /** May the worksheet be blessed into a journal? */
  blessable: boolean;
  debitCents: number;
  creditCents: number;
  /** debit − credit. Non-zero means a plug to Opening Balance Equity. */
  differenceCents: number;
  stagedCount: number;
  excludedCount: number;
  findings: readonly CutoverFinding[];
};

/**
 * The account the difference is plugged to when the worksheet does not balance.
 * 0176 uses 40400 Opening Balance Equity and that must not diverge.
 */
export const OPENING_BALANCE_EQUITY_CODE = "40400";
export const RETAINED_EARNINGS_CODE = "40300";

/**
 * Accounts that essentially always carry an opening balance for a business like
 * this one. Their ABSENCE is the most dangerous thing on a conversion, because
 * a missing balance is invisible — nothing is out, the sheet still balances,
 * and the number simply is not there.
 *
 * These produce warnings, never blocks: Michael's business is his to describe,
 * and there are legitimate reasons for any one of them to be absent.
 */
export const EXPECTED_OPENING_ACCOUNTS: ReadonlyArray<{
  code: string;
  label: string;
  why: string;
}> = [
  {
    code: "10100",
    label: "the operating bank account",
    why: "A business with a bank account has a balance in it on the day it converts.",
  },
  {
    code: "12100",
    label: "inventory",
    why:
      "A retailer holds inventory. On a conversion this is also the number that " +
      "drives cost of goods sold, and under §280E it is the deduction that " +
      "actually survives — an understated opening inventory overstates income.",
  },
];

/**
 * REVIEW THE OPENING BALANCE WORKSHEET.
 *
 * This is more suspicious than a normal validation, on purpose. The failure it
 * exists to catch is not "the sheet does not balance" — that one announces
 * itself. It is "the sheet balances and is wrong", which never announces itself
 * and can never be found afterwards.
 *
 * Only two things BLOCK, and both are structural rather than judgemental:
 * an empty worksheet, and a row that cannot be posted at all. Everything else
 * warns, because the owner knows his business and the advisor does not.
 */
export function reviewOpeningBalances(
  rows: readonly OpeningRow[],
): OpeningReview {
  const findings: CutoverFinding[] = [];
  const staged = rows.filter((r) => r.status === "staged");
  const excluded = rows.filter((r) => r.status === "excluded");

  let debitCents = 0;
  let creditCents = 0;
  for (const r of staged) {
    if (r.amountCents > 0) debitCents += r.amountCents;
    else creditCents += -r.amountCents;
  }
  const differenceCents = debitCents - creditCents;

  // ── BLOCK: nothing to bless ──────────────────────────────────────────────
  if (staged.length === 0) {
    findings.push({
      code: "CUT_EMPTY_WORKSHEET",
      severity: "block",
      concern:
        "There are no staged rows, so there is no opening balance sheet to post.",
      suggestion:
        "Enter the balances from the last Sage trial balance dated " +
        `${OPENING_BALANCE_DATE}, one row per account, each pointing at the document it came from.`,
      accountCodes: [],
    });
  }

  // ── BLOCK: a row that cannot be posted ───────────────────────────────────
  const zeroRows = staged.filter((r) => r.amountCents === 0);
  if (zeroRows.length > 0) {
    findings.push({
      code: "CUT_ZERO_AMOUNT",
      severity: "block",
      concern:
        "One or more rows have an amount of zero. A zero opening balance is not a " +
        "balance, it is an absence, and absences are not recorded.",
      suggestion: "Delete the row, or set it aside as excluded with a reason.",
      accountCodes: zeroRows.map((r) => r.accountCode),
    });
  }

  const missingEvidence = staged.filter(
    (r) => r.evidenceRef.trim().length < 3,
  );
  if (missingEvidence.length > 0) {
    findings.push({
      code: "CUT_NO_EVIDENCE",
      severity: "block",
      concern:
        "One or more rows have no document behind them. A number without a document " +
        "is not an opening balance, it is a guess wearing a suit.",
      suggestion:
        "Point each row at something you can physically pick up — a statement date, " +
        "a Sage report number, a count sheet.",
      accountCodes: missingEvidence.map((r) => r.accountCode),
    });
  }

  // ── WARN: the sheet does not balance ─────────────────────────────────────
  if (differenceCents !== 0 && staged.length > 0) {
    findings.push({
      code: "CUT_UNBALANCED",
      severity: "warn",
      concern:
        `The worksheet is out by ${formatCents(Math.abs(differenceCents))}. It can still be ` +
        `posted — the difference goes to account ${OPENING_BALANCE_EQUITY_CODE} ` +
        "(Opening Balance Equity) — but that account is a parking space, not an answer.",
      suggestion:
        "Post it if you need to keep moving, then find the difference before year end. " +
        "Anything left sitting in Opening Balance Equity at 31 December is a number " +
        "nobody can explain to the IRS.",
      accountCodes: [OPENING_BALANCE_EQUITY_CODE],
    });
  }

  // ── WARN: an expected account is simply absent ───────────────────────────
  const stagedCodes = new Set(staged.map((r) => r.accountCode));
  for (const expected of EXPECTED_OPENING_ACCOUNTS) {
    if (!stagedCodes.has(expected.code) && staged.length > 0) {
      findings.push({
        code: `CUT_MISSING_${expected.code}`,
        severity: "warn",
        concern: `There is no opening balance for ${expected.label} (${expected.code}). ${expected.why}`,
        suggestion:
          "If it genuinely has no balance, set the row aside as excluded with that reason " +
          "written down, so the decision is part of the record rather than an omission.",
        accountCodes: [expected.code],
      });
    }
  }

  // ── WARN: income statement accounts on an opening balance sheet ──────────
  //
  // This is the classic conversion error and it is worth its own check. Opening
  // balances are a BALANCE SHEET: assets, liabilities and equity. Bringing in a
  // revenue or expense balance restates the current year's profit on day one,
  // and because it still balances, nothing complains.
  const pandl = staged.filter((r) =>
    ["income", "cogs", "expense", "other_income", "other_expense"].includes(
      r.accountType,
    ),
  );
  if (pandl.length > 0) {
    findings.push({
      code: "CUT_PANDL_ACCOUNT",
      severity: "warn",
      concern:
        "An opening balance sheet should only contain things you OWN, things you OWE, " +
        "and what is left over. These rows are income or expense accounts, and bringing " +
        "them across restates this year's profit before you have traded a single day on " +
        "the new system.",
      suggestion:
        `Roll prior-year profit into ${RETAINED_EARNINGS_CODE} (Retained Earnings) instead. ` +
        "Sage keeps the year's detail — you said it already has all the Cultivera activity in it.",
      accountCodes: pandl.map((r) => r.accountCode),
    });
  }

  // ── WARN: the whole sheet leans on one document ──────────────────────────
  if (staged.length >= 4) {
    const fromSage = staged.filter((r) => r.evidenceKind === "sage_trial_balance");
    if (fromSage.length === staged.length) {
      findings.push({
        code: "CUT_SINGLE_SOURCE",
        severity: "warn",
        concern:
          "Every row cites the Sage trial balance and nothing else. That proves the " +
          "numbers were copied faithfully; it does not prove they were right in Sage.",
        suggestion:
          "Tie at least cash to a bank statement and inventory to a physical count at " +
          `${OPENING_BALANCE_DATE}. Those two are the ones an auditor tests first, and ` +
          "they are the two you can actually verify independently.",
        accountCodes: [],
      });
    }
  }

  // ── NOTE: excluded rows are part of the record ───────────────────────────
  if (excluded.length > 0) {
    findings.push({
      code: "CUT_EXCLUSIONS_RECORDED",
      severity: "note",
      concern:
        `${excluded.length} row(s) were deliberately set aside. That decision is stored ` +
        "with its reason, which is exactly right.",
      suggestion: "No action needed. Re-read the reasons before you bless the sheet.",
      accountCodes: excluded.map((r) => r.accountCode),
    });
  }

  const order: Record<CutoverSeverity, number> = { block: 0, warn: 1, note: 2 };
  const sorted = [...findings].sort((a, b) => {
    const d = order[a.severity] - order[b.severity];
    return d !== 0 ? d : a.code.localeCompare(b.code);
  });

  return {
    blessable: !sorted.some((f) => f.severity === "block"),
    debitCents,
    creditCents,
    differenceCents,
    stagedCount: staged.length,
    excludedCount: excluded.length,
    findings: sorted,
  };
}

// ---------------------------------------------------------------------------
// THE PARALLEL RUN
// ---------------------------------------------------------------------------

export type BalanceLine = {
  accountCode: string;
  accountName?: string;
  /** Net balance in integer cents. Positive = debit, negative = credit. */
  balanceCents: number;
};

export type AccountComparison = {
  accountCode: string;
  accountName: string;
  /** Null when the account is absent from that system entirely. */
  platformCents: number | null;
  sageCents: number | null;
  /** platform − sage, treating an absent side as zero. */
  differenceCents: number;
  status: "match" | "differs" | "only_platform" | "only_sage";
};

export type ParallelRunReport = {
  periodStart: string;
  periodEnd: string;
  /** True only when EVERY account matches to the cent. */
  consistent: boolean;
  comparisons: readonly AccountComparison[];
  /** Just the ones needing attention, in descending order of size. */
  discrepancies: readonly AccountComparison[];
  totalAbsoluteDifferenceCents: number;
  /** Written for Michael. Never says "correct". */
  verdict: string;
};

/**
 * COMPARE THIS PLATFORM'S TRIAL BALANCE TO SAGE'S, ACCOUNT BY ACCOUNT.
 *
 * The comparison is EXACT. There is no tolerance, not even a cent, and that is
 * deliberate: a tolerance is a decision to stop looking, and on a conversion the
 * whole point is to keep looking until the two systems agree completely. A
 * one-cent difference is a rounding rule that differs somewhere, and rounding
 * rules that differ do not stay one cent apart forever.
 *
 * Accounts present in only one system are reported as their own status rather
 * than being folded into "differs", because the fix is completely different: a
 * missing account is usually a mapping that was never set up, while a differing
 * balance is usually a transaction treated differently.
 */
export function reconcileParallelRun(
  platform: readonly BalanceLine[],
  sage: readonly BalanceLine[],
  periodStart: string = PARALLEL_RUN_START,
  periodEnd: string = PARALLEL_RUN_END,
): ParallelRunReport {
  const platformMap = new Map<string, BalanceLine>();
  for (const l of platform) platformMap.set(l.accountCode, l);
  const sageMap = new Map<string, BalanceLine>();
  for (const l of sage) sageMap.set(l.accountCode, l);

  const allCodes = [...new Set([...platformMap.keys(), ...sageMap.keys()])].sort();

  const comparisons: AccountComparison[] = allCodes.map((code) => {
    const p = platformMap.get(code);
    const s = sageMap.get(code);
    const pc = p ? p.balanceCents : null;
    const sc = s ? s.balanceCents : null;
    const difference = (pc ?? 0) - (sc ?? 0);

    let status: AccountComparison["status"];
    if (pc === null) status = "only_sage";
    else if (sc === null) status = "only_platform";
    else if (difference === 0) status = "match";
    else status = "differs";

    return {
      accountCode: code,
      accountName: p?.accountName ?? s?.accountName ?? "",
      platformCents: pc,
      sageCents: sc,
      differenceCents: difference,
      status,
    };
  });

  const discrepancies = comparisons
    .filter((c) => c.status !== "match")
    .sort((a, b) => {
      const d = Math.abs(b.differenceCents) - Math.abs(a.differenceCents);
      return d !== 0 ? d : a.accountCode.localeCompare(b.accountCode);
    });

  const totalAbsoluteDifferenceCents = discrepancies.reduce(
    (sum, c) => sum + Math.abs(c.differenceCents),
    0,
  );

  const consistent = discrepancies.length === 0 && comparisons.length > 0;

  // THE WORDING MATTERS AND IS ASSERTED IN THE TESTS.
  //
  // "Consistent", never "correct". Sage contains Michael's own Cultivera-era
  // bookkeeping; if a treatment was wrong there, matching it exactly reproduces
  // the error with more confidence than before. Telling him the books are
  // "correct" because they agree with the system he is replacing would be the
  // single most misleading sentence this application could print.
  let verdict: string;
  if (comparisons.length === 0) {
    verdict =
      "There is nothing to compare yet. Load both trial balances for " +
      `${periodStart} to ${periodEnd} and run this again.`;
  } else if (consistent) {
    verdict =
      `Every account agrees with Sage to the cent for ${periodStart} to ${periodEnd}. ` +
      "That means the two systems are consistent — it does not mean the numbers are " +
      "right, because Sage is where the old treatment lives too. It does mean nothing " +
      "was lost or double-counted in the move, which is what the parallel run is for.";
  } else {
    const worst = discrepancies[0]!;
    verdict =
      `${discrepancies.length} account(s) do not agree with Sage, ` +
      `${formatCents(totalAbsoluteDifferenceCents)} in total. The largest is ` +
      `${worst.accountCode}${worst.accountName ? ` (${worst.accountName})` : ""} at ` +
      `${formatCents(Math.abs(worst.differenceCents))}. Start there — on a conversion the ` +
      "biggest difference is usually one missing entry rather than many small ones.";
  }

  return {
    periodStart,
    periodEnd,
    consistent,
    comparisons,
    discrepancies,
    totalAbsoluteDifferenceCents,
    verdict,
  };
}

/**
 * MAY SAGE BE RETIRED?
 *
 * Michael: "If all goes well, we will drop sage and use our platform
 * exclusively." This decides what "all goes well" means, and it deliberately
 * refuses to be the one who decides — it reports readiness, and the owner acts.
 */
export type RetirementCheck = {
  ready: boolean;
  reasons: readonly string[];
};

export function canRetireLegacySystem(
  report: ParallelRunReport,
  openingReview: OpeningReview,
): RetirementCheck {
  const reasons: string[] = [];

  if (!openingReview.blessable) {
    reasons.push(
      "The opening balance sheet has not been posted cleanly yet, so there is no " +
        "agreed starting point to have run in parallel FROM.",
    );
  }
  if (openingReview.differenceCents !== 0) {
    reasons.push(
      `${formatCents(Math.abs(openingReview.differenceCents))} is still sitting in ` +
        `Opening Balance Equity (${OPENING_BALANCE_EQUITY_CODE}). That is an unexplained ` +
        "number at the very bottom of the books.",
    );
  }
  if (report.comparisons.length === 0) {
    reasons.push("The parallel run has not been reconciled at all yet.");
  } else if (!report.consistent) {
    reasons.push(
      `${report.discrepancies.length} account(s) still disagree with Sage, ` +
        `${formatCents(report.totalAbsoluteDifferenceCents)} in total.`,
    );
  }
  if (report.periodEnd < PARALLEL_RUN_END) {
    reasons.push(
      `The parallel run was only reconciled through ${report.periodEnd}. You said you ` +
        `would run both systems until year end (${PARALLEL_RUN_END}).`,
    );
  }

  return { ready: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// SELF-TESTS
//
// Called bare by scripts/compliance/run-pure-selftests.ts and again by
// tests/compliance/cutover-core.test.ts. Returns void, THROWS on failure.
// ---------------------------------------------------------------------------

function ok(cond: boolean, label: string): void {
  if (!cond) throw new Error(`cutover-core: ${label}`);
}

function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `cutover-core: ${label} — expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

function row(over: Partial<OpeningRow> & { accountCode: string }): OpeningRow {
  return {
    accountName: over.accountName ?? `Account ${over.accountCode}`,
    accountType: over.accountType ?? "asset",
    amountCents: over.amountCents ?? 100000,
    evidenceKind: over.evidenceKind ?? "bank_statement",
    evidenceRef: over.evidenceRef ?? "Statement 2026-10-31",
    evidenceNote: over.evidenceNote ?? null,
    status: over.status ?? "staged",
    exclusionReason: over.exclusionReason ?? null,
    accountCode: over.accountCode,
  };
}

/** A minimal balanced worksheet that trips no warnings. */
function balancedSheet(): OpeningRow[] {
  return [
    row({ accountCode: "10100", amountCents: 5000000, evidenceKind: "bank_statement" }),
    row({ accountCode: "12100", amountCents: 3000000, evidenceKind: "inventory_count" }),
    row({
      accountCode: RETAINED_EARNINGS_CODE,
      accountType: "equity",
      amountCents: -8000000,
      evidenceKind: "k1_or_return",
    }),
  ];
}

export function __runCutoverCoreTests(): void {
  // ── THE DATES. These are the whole reason this slice exists. ─────────────
  eq(CUTOVER_DATE, "2026-11-01", "the cut-over is 1 November 2026");
  eq(OPENING_BALANCE_DATE, "2026-10-31", "the opening balance sheet is 31 October 2026");
  eq(
    OPENING_BALANCE_DATE,
    previousDay(CUTOVER_DATE),
    "the opening balance date is exactly the day before the cut-over",
  );
  eq(PARALLEL_RUN_START, CUTOVER_DATE, "the parallel run starts at the cut-over");
  eq(PARALLEL_RUN_END, "2026-12-31", "the parallel run ends at year end");
  ok(
    OPENING_BALANCE_DATE !== SUPERSEDED_OPENING_DATE,
    "the opening date is NOT the superseded 2025-12-31 the ledger was built around",
  );
  // The line-in-the-sand CHECK in 0172 permits journal_date >= 2026-01-01.
  // 2026-10-31 satisfies that arm on its own, so no constraint change is needed.
  ok(
    isOnOrAfter(OPENING_BALANCE_DATE, "2026-01-01"),
    "the opening date satisfies the line-in-the-sand constraint without an exemption",
  );

  // ── previousDay: month, year and leap boundaries ─────────────────────────
  eq(previousDay("2026-11-01"), "2026-10-31", "1 Nov -> 31 Oct");
  eq(previousDay("2026-01-01"), "2025-12-31", "new year rolls back");
  eq(previousDay("2026-03-01"), "2026-02-28", "2026 is not a leap year");
  eq(previousDay("2024-03-01"), "2024-02-29", "2024 IS a leap year");
  eq(previousDay("2000-03-01"), "2000-02-29", "2000 is a leap year (div 400)");
  eq(previousDay("1900-03-01"), "1900-02-28", "1900 is NOT a leap year (div 100)");
  eq(previousDay("2026-05-01"), "2026-04-30", "April has 30 days");
  eq(previousDay("2026-11-15"), "2026-11-14", "mid-month is trivial");

  // ── date validation ──────────────────────────────────────────────────────
  ok(isValidIsoDate("2026-11-01"), "a real date is valid");
  ok(isValidIsoDate("2024-02-29"), "leap day 2024 is valid");
  ok(!isValidIsoDate("2026-02-29"), "2026 has no 29 February");
  ok(!isValidIsoDate("2026-13-01"), "month 13 is invalid");
  ok(!isValidIsoDate("2026-11-31"), "November has 30 days");
  ok(!isValidIsoDate("11/01/2026"), "US format is rejected");
  ok(!isValidIsoDate(""), "empty is rejected");

  // ── the parallel run window ──────────────────────────────────────────────
  ok(isInParallelRun("2026-11-01"), "the first day is inside the window");
  ok(isInParallelRun("2026-12-31"), "the last day is inside the window");
  ok(isInParallelRun("2026-11-30"), "a middle day is inside");
  ok(!isInParallelRun("2026-10-31"), "the opening balance date is BEFORE the window");
  ok(!isInParallelRun("2027-01-01"), "the new year is after the window");

  // ── accounting basis (owner decision) ────────────────────────────────────
  for (const e of ENTITY_CODES) {
    eq(ACCOUNTING_BASIS[e], "accrual", `${e} is accrual basis`);
  }
  eq(ENTITY_CODES.length, 4, "there are four sets of books");

  // ── formatCents ──────────────────────────────────────────────────────────
  eq(formatCents(0), "$0.00", "zero");
  eq(formatCents(5), "$0.05", "five cents");
  eq(formatCents(4523), "$45.23", "dollars and cents");
  eq(formatCents(100000), "$1,000.00", "thousands separator");
  eq(formatCents(123456789), "$1,234,567.89", "millions");
  eq(formatCents(-4523), "-$45.23", "negative sign outside the dollar sign");

  // ── the clean worksheet ──────────────────────────────────────────────────
  {
    const r = reviewOpeningBalances(balancedSheet());
    ok(r.blessable, "a clean worksheet can be blessed");
    eq(r.differenceCents, 0, "a clean worksheet balances");
    eq(r.debitCents, 8000000, "debits total correctly");
    eq(r.creditCents, 8000000, "credits total correctly");
    eq(r.stagedCount, 3, "three staged rows");
    eq(
      r.findings.filter((f) => f.severity === "block").length,
      0,
      "a clean worksheet raises no blocks",
    );
  }

  // ── an empty worksheet blocks ────────────────────────────────────────────
  {
    const r = reviewOpeningBalances([]);
    ok(!r.blessable, "an empty worksheet cannot be blessed");
    ok(
      r.findings.some((f) => f.code === "CUT_EMPTY_WORKSHEET"),
      "an empty worksheet says so",
    );
  }

  // ── evidence is mandatory ────────────────────────────────────────────────
  {
    const rows = balancedSheet();
    rows[0] = { ...rows[0]!, evidenceRef: "  " };
    const r = reviewOpeningBalances(rows);
    ok(!r.blessable, "a row without evidence blocks the whole sheet");
    ok(
      r.findings.some((f) => f.code === "CUT_NO_EVIDENCE"),
      "the missing evidence is named",
    );
  }

  // ── a zero-amount row blocks ───────────────────────────────────────────────
  //
  // Added after the slice books-02 mutation campaign: removing this check
  // SURVIVED the suite, which meant nothing tested it. A zero opening balance
  // is the quietest failure on this whole screen — it looks like a decision
  // ("this account starts at nothing") but it is almost always an unfinished
  // row, and it changes no total, so nothing else ever complains about it.
  {
    const rows = [...balancedSheet(), row({ accountCode: "13000", amountCents: 0 })];
    const r = reviewOpeningBalances(rows);
    ok(!r.blessable, "a zero-amount row blocks the sheet");
    const f = r.findings.find((x) => x.code === "CUT_ZERO_AMOUNT");
    ok(f !== undefined, "the zero-amount row is reported");
    eq(f!.severity, "block", "a zero amount is a block, not a warning");
    ok(f!.accountCodes.includes("13000"), "the offending account is named");
    // it must not have disturbed the arithmetic
    eq(r.differenceCents, 0, "a zero row contributes nothing to the totals");
    // NEGATIVE CONTROL: the clean sheet must NOT raise this.
    ok(
      !reviewOpeningBalances(balancedSheet()).findings.some(
        (x) => x.code === "CUT_ZERO_AMOUNT",
      ),
      "a worksheet with no zero rows does not trip the zero-amount block",
    );
    // an EXCLUDED zero row is fine — exclusions are not posted.
    ok(
      reviewOpeningBalances([
        ...balancedSheet(),
        row({
          accountCode: "13000",
          amountCents: 0,
          status: "excluded",
          exclusionReason: "Account closed in 2025",
        }),
      ]).blessable,
      "an excluded zero row does not block",
    );
  }

  // ── an unbalanced sheet WARNS but does not block ─────────────────────────
  {
    const rows = balancedSheet();
    rows[0] = { ...rows[0]!, amountCents: 5000001 };
    const r = reviewOpeningBalances(rows);
    eq(r.differenceCents, 1, "one cent out is detected");
    ok(r.blessable, "an unbalanced sheet can still be posted (it plugs to 40400)");
    const f = r.findings.find((x) => x.code === "CUT_UNBALANCED");
    ok(f !== undefined, "the imbalance is reported");
    eq(f!.severity, "warn", "the imbalance warns rather than blocks");
    ok(
      f!.accountCodes.includes(OPENING_BALANCE_EQUITY_CODE),
      "the plug account is named so it can be found later",
    );
  }

  // ── P&L accounts on a balance sheet ──────────────────────────────────────
  {
    const rows = [
      ...balancedSheet(),
      row({ accountCode: "50100", accountType: "cogs", amountCents: 1 }),
      row({ accountCode: "40100", accountType: "income", amountCents: -1 }),
    ];
    const r = reviewOpeningBalances(rows);
    const f = r.findings.find((x) => x.code === "CUT_PANDL_ACCOUNT");
    ok(f !== undefined, "income and expense accounts are flagged");
    eq(f!.accountCodes.length, 2, "both offending rows are named");
    ok(
      f!.suggestion.includes(RETAINED_EARNINGS_CODE),
      "the suggestion points at retained earnings",
    );
    // NEGATIVE CONTROL: the clean sheet must NOT raise this.
    ok(
      !reviewOpeningBalances(balancedSheet()).findings.some(
        (x) => x.code === "CUT_PANDL_ACCOUNT",
      ),
      "a balance-sheet-only worksheet does not trigger the P&L warning",
    );
  }

  // ── a missing expected account ───────────────────────────────────────────
  {
    const rows = balancedSheet().filter((r2) => r2.accountCode !== "12100");
    const r = reviewOpeningBalances(rows);
    ok(
      r.findings.some((f) => f.code === "CUT_MISSING_12100"),
      "missing inventory is called out (it drives COGS and 280E)",
    );
    // NEGATIVE CONTROL
    ok(
      !reviewOpeningBalances(balancedSheet()).findings.some(
        (f) => f.code === "CUT_MISSING_12100",
      ),
      "inventory present means no warning",
    );
  }

  // ── the single-source warning ────────────────────────────────────────────
  {
    const rows: OpeningRow[] = [
      row({ accountCode: "10100", amountCents: 1000, evidenceKind: "sage_trial_balance" }),
      row({ accountCode: "12100", amountCents: 1000, evidenceKind: "sage_trial_balance" }),
      row({ accountCode: "13000", amountCents: 1000, evidenceKind: "sage_trial_balance" }),
      row({
        accountCode: RETAINED_EARNINGS_CODE,
        accountType: "equity",
        amountCents: -3000,
        evidenceKind: "sage_trial_balance",
      }),
    ];
    const r = reviewOpeningBalances(rows);
    ok(
      r.findings.some((f) => f.code === "CUT_SINGLE_SOURCE"),
      "a worksheet sourced entirely from Sage is flagged",
    );
    // NEGATIVE CONTROL: mixed evidence does not trip it.
    const mixed = [...rows];
    mixed[0] = { ...mixed[0]!, evidenceKind: "bank_statement" };
    ok(
      !reviewOpeningBalances(mixed).findings.some((f) => f.code === "CUT_SINGLE_SOURCE"),
      "mixed evidence does not trip the single-source warning",
    );
  }

  // ── excluded rows are noted, not punished ────────────────────────────────
  {
    const rows = [
      ...balancedSheet(),
      row({
        accountCode: "19999",
        status: "excluded",
        exclusionReason: "Old suspense account, written off in 2024",
      }),
    ];
    const r = reviewOpeningBalances(rows);
    eq(r.excludedCount, 1, "the exclusion is counted");
    ok(r.blessable, "an excluded row does not block");
    const f = r.findings.find((x) => x.code === "CUT_EXCLUSIONS_RECORDED");
    ok(f !== undefined, "the exclusion is acknowledged");
    eq(f!.severity, "note", "an exclusion is a note, not a problem");
    // and it must NOT count toward the totals
    eq(r.stagedCount, 3, "an excluded row is not staged");
    eq(r.differenceCents, 0, "an excluded row does not affect the balance");
  }

  // ── findings are deterministically ordered ───────────────────────────────
  {
    const rows = balancedSheet().filter((r2) => r2.accountCode !== "12100");
    const a = reviewOpeningBalances(rows);
    const b = reviewOpeningBalances(rows);
    eq(
      JSON.stringify(a.findings),
      JSON.stringify(b.findings),
      "the same worksheet always produces byte-identical findings",
    );
    // blocks first
    const severities = a.findings.map((f) => f.severity);
    const idxBlock = severities.lastIndexOf("block");
    const idxWarn = severities.indexOf("warn");
    if (idxBlock >= 0 && idxWarn >= 0) {
      ok(idxBlock < idxWarn, "blocks sort before warnings");
    }
  }

  // ── THE PARALLEL RUN ─────────────────────────────────────────────────────
  {
    const platform: BalanceLine[] = [
      { accountCode: "10100", accountName: "Bank", balanceCents: 5000000 },
      { accountCode: "12100", accountName: "Inventory", balanceCents: 3000000 },
    ];
    const sage: BalanceLine[] = [
      { accountCode: "10100", accountName: "Bank", balanceCents: 5000000 },
      { accountCode: "12100", accountName: "Inventory", balanceCents: 3000000 },
    ];
    const r = reconcileParallelRun(platform, sage);
    ok(r.consistent, "identical trial balances reconcile");
    eq(r.discrepancies.length, 0, "nothing to chase");
    eq(r.totalAbsoluteDifferenceCents, 0, "no absolute difference");
    // THE WORDING. This is a safety property, not a style preference.
    ok(
      r.verdict.includes("consistent"),
      "a clean reconciliation says the systems are CONSISTENT",
    );
    ok(
      !r.verdict.includes("correct"),
      "a clean reconciliation must NEVER claim the numbers are correct",
    );
  }

  // ── one cent apart is NOT clean ──────────────────────────────────────────
  {
    const platform: BalanceLine[] = [{ accountCode: "10100", balanceCents: 5000000 }];
    const sage: BalanceLine[] = [{ accountCode: "10100", balanceCents: 4999999 }];
    const r = reconcileParallelRun(platform, sage);
    ok(!r.consistent, "a single cent breaks the reconciliation — there is no tolerance");
    eq(r.discrepancies.length, 1, "the one account is reported");
    eq(r.discrepancies[0]!.differenceCents, 1, "the difference is exact and signed");
    eq(r.discrepancies[0]!.status, "differs", "the status is 'differs'");
    eq(r.totalAbsoluteDifferenceCents, 1, "absolute difference is one cent");
  }

  // ── accounts present in only one system ──────────────────────────────────
  {
    const platform: BalanceLine[] = [
      { accountCode: "10100", balanceCents: 100 },
      { accountCode: "19000", balanceCents: 500 },
    ];
    const sage: BalanceLine[] = [
      { accountCode: "10100", balanceCents: 100 },
      { accountCode: "28000", balanceCents: -700 },
    ];
    const r = reconcileParallelRun(platform, sage);
    ok(!r.consistent, "asymmetric charts do not reconcile");
    const onlyP = r.comparisons.find((c) => c.accountCode === "19000");
    const onlyS = r.comparisons.find((c) => c.accountCode === "28000");
    eq(onlyP!.status, "only_platform", "an account only we have is labelled as such");
    eq(onlyS!.status, "only_sage", "an account only Sage has is labelled as such");
    eq(onlyP!.sageCents, null, "the absent side is null, not zero");
    eq(onlyS!.platformCents, null, "the absent side is null, not zero");
    // but the arithmetic still treats absence as zero
    eq(onlyP!.differenceCents, 500, "an absent side contributes zero to the difference");
    eq(onlyS!.differenceCents, 700, "sign is platform minus sage");
  }

  // ── discrepancies are sorted biggest first ───────────────────────────────
  {
    const platform: BalanceLine[] = [
      { accountCode: "10100", balanceCents: 100 },
      { accountCode: "12100", balanceCents: 100000 },
      { accountCode: "13000", balanceCents: 5000 },
    ];
    const sage: BalanceLine[] = [
      { accountCode: "10100", balanceCents: 90 },
      { accountCode: "12100", balanceCents: 0 },
      { accountCode: "13000", balanceCents: 4000 },
    ];
    const r = reconcileParallelRun(platform, sage);
    eq(r.discrepancies.length, 3, "all three differ");
    eq(r.discrepancies[0]!.accountCode, "12100", "the biggest difference is first");
    eq(r.discrepancies[1]!.accountCode, "13000", "then the next biggest");
    eq(r.discrepancies[2]!.accountCode, "10100", "then the smallest");
    eq(r.totalAbsoluteDifferenceCents, 100000 + 1000 + 10, "absolute differences sum");
    ok(r.verdict.includes("12100"), "the verdict names the biggest offender");
  }

  // ── nothing loaded ───────────────────────────────────────────────────────
  {
    const r = reconcileParallelRun([], []);
    ok(!r.consistent, "an empty comparison is NOT consistent — it is unproven");
    ok(r.verdict.includes("nothing to compare"), "and it says so plainly");
  }

  // ── RETIREMENT READINESS ─────────────────────────────────────────────────
  {
    const cleanReview = reviewOpeningBalances(balancedSheet());
    const cleanRun = reconcileParallelRun(
      [{ accountCode: "10100", balanceCents: 100 }],
      [{ accountCode: "10100", balanceCents: 100 }],
    );
    const ready = canRetireLegacySystem(cleanRun, cleanReview);
    ok(ready.ready, "a clean opening sheet and a clean parallel run means ready");
    eq(ready.reasons.length, 0, "with nothing outstanding");

    // Each blocker in isolation.
    const unbalanced = reviewOpeningBalances(
      balancedSheet().map((r2, i) =>
        i === 0 ? { ...r2, amountCents: r2.amountCents + 100 } : r2,
      ),
    );
    ok(
      !canRetireLegacySystem(cleanRun, unbalanced).ready,
      "money parked in Opening Balance Equity blocks retirement",
    );

    const dirtyRun = reconcileParallelRun(
      [{ accountCode: "10100", balanceCents: 100 }],
      [{ accountCode: "10100", balanceCents: 99 }],
    );
    ok(
      !canRetireLegacySystem(dirtyRun, cleanReview).ready,
      "a disagreeing parallel run blocks retirement",
    );

    const shortRun = reconcileParallelRun(
      [{ accountCode: "10100", balanceCents: 100 }],
      [{ accountCode: "10100", balanceCents: 100 }],
      PARALLEL_RUN_START,
      "2026-11-30",
    );
    const shortCheck = canRetireLegacySystem(shortRun, cleanReview);
    ok(!shortCheck.ready, "stopping the parallel run early blocks retirement");
    ok(
      shortCheck.reasons.some((x) => x.includes("2026-12-31")),
      "and it says the run was meant to go to year end",
    );

    const noRun = canRetireLegacySystem(reconcileParallelRun([], []), cleanReview);
    ok(!noRun.ready, "an unreconciled parallel run blocks retirement");
  }

  // ── determinism sweep ────────────────────────────────────────────────────
  {
    // A deterministic pseudo-random sweep: the same seed must always produce the
    // same report. No Math.random anywhere in this module.
    let seed = 42;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let i = 0; i < 200; i += 1) {
      const codes = ["10100", "12100", "20100", "40300"];
      const p: BalanceLine[] = codes.map((c) => ({
        accountCode: c,
        balanceCents: (next() % 200000) - 100000,
      }));
      const s: BalanceLine[] = p.map((l) => ({
        accountCode: l.accountCode,
        balanceCents: l.balanceCents,
      }));
      const a = reconcileParallelRun(p, s);
      const b = reconcileParallelRun(p, s);
      ok(a.consistent, `identical inputs reconcile (iteration ${i})`);
      eq(
        JSON.stringify(a),
        JSON.stringify(b),
        `the report is deterministic (iteration ${i})`,
      );
      // and perturbing exactly one account always breaks it
      const perturbed = s.map((l, j) =>
        j === 0 ? { ...l, balanceCents: l.balanceCents + 1 } : l,
      );
      ok(
        !reconcileParallelRun(p, perturbed).consistent,
        `a one-cent perturbation is always caught (iteration ${i})`,
      );
    }
  }
}
