/**
 * tests/compliance/greenway-chart-fixture.ts   (books-42)
 *
 * ONE SET OF BOOKS THAT EVERY FINANCIAL-STATEMENT TEST ARGUES ABOUT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS — a mistake worth recording
 * ─────────────────────────────────────────────────────────────────────────────
 * The books-42 owner report describes a real defect: handing Greenway's excise
 * account `32000` — a trust LIABILITY — to `buildIncomeStatement()` makes net
 * sales EXCEED gross sales on a perfectly balanced trial balance, with nothing
 * refusing.
 *
 * That defect was demonstrated in `financial-statements-ui-core.test.ts` using
 * the fixture below, and it produces net sales of $13,200.00 against gross
 * sales of $10,000.00.
 *
 * When the owner-report gate was written, it re-derived the same claim — but
 * from a SECOND, hand-written trial balance invented in that file. That fixture
 * had no contra-revenue account in it, so the same bug produced $13,700.00
 * instead. Both numbers are real outputs of the real engine. Both demonstrate
 * the same defect. But the report can only quote one of them, and the gate
 * checked it against the other.
 *
 * Nothing was wrong with either test. The problem was that there were two
 * fixtures pretending to be "Greenway's books". A second copy of a fact is not
 * a second source of truth; it is a future disagreement with a date on it. So
 * the fixture is extracted here, ONCE, and both suites import it. The number in
 * the report is now derived from the same books both tests use, and if this
 * fixture ever changes, every claim that depends on it moves together or the
 * build fails.
 *
 * This is the same lesson the slice itself is about, applied to the tests: the
 * $13,200 figure balanced perfectly in one file and was wrong in another, and
 * only executing both against one another exposed it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE PARTICULAR ACCOUNTS
 * ─────────────────────────────────────────────────────────────────────────────
 * These are Greenway's REAL chart codes, taken from migration 0173 — not the
 * engine's own fictional `4900` / `6900`, which are income and expense types.
 * Greenway's chart has no income-type excise account at all, which is exactly
 * why the defect this fixture demonstrates was never exercised by the engine's
 * own 132 tests. The fixture is the input the engine was never asked about.
 */

import type { FsAccountFact } from "@/lib/accounting/financial-statements-ui-core";
import type { TrialBalanceView } from "@/lib/accounting/books-ledger-guidance-core";

/** Greenway's chart of accounts, as the financial statement layer sees it. */
export const GREENWAY_FACTS: readonly FsAccountFact[] = [
  { code: "10100", name: "Cash on Hand — Vault", accountType: "asset", normalBalance: "debit", isContra: false },
  { code: "20010", name: "Inventory — Flower", accountType: "asset", normalBalance: "debit", isContra: false },
  { code: "20810", name: "Inventory Shrink / Waste Reserve", accountType: "asset", normalBalance: "credit", isContra: true },
  { code: "30000", name: "Accounts Payable", accountType: "liability", normalBalance: "credit", isContra: false },
  { code: "32000", name: "Cannabis Excise Tax Payable (37%) — TRUST", accountType: "liability", normalBalance: "credit", isContra: false },
  { code: "32100", name: "Retail Sales Tax Payable — TRUST", accountType: "liability", normalBalance: "credit", isContra: false },
  { code: "34000", name: "Notes & Loans Payable", accountType: "liability", normalBalance: "credit", isContra: false },
  { code: "40300", name: "Retained Earnings", accountType: "equity", normalBalance: "credit", isContra: false },
  { code: "40400", name: "Opening Balance Equity", accountType: "equity", normalBalance: "credit", isContra: false },
  { code: "41000", name: "Shareholder Distributions", accountType: "equity", normalBalance: "debit", isContra: true },
  { code: "50010", name: "Sales — Flower", accountType: "income", normalBalance: "credit", isContra: false },
  { code: "50900", name: "Discounts & Comps", accountType: "income", normalBalance: "debit", isContra: true },
  { code: "50910", name: "Returns & Refunds", accountType: "income", normalBalance: "debit", isContra: true },
  { code: "60010", name: "COGS — Flower", accountType: "cogs", normalBalance: "debit", isContra: false },
  { code: "73030", name: "Hardware & Equipment", accountType: "expense", normalBalance: "debit", isContra: false },
];

export type FixtureLine = TrialBalanceView["lines"][number];

/**
 * Build one trial balance line from a SIGNED balance (positive = net debit).
 *
 * Exported because suites need to build variant books — an unmapped account, an
 * out-of-balance month — and they must do it with the same line shape as the
 * fixture rather than a second hand-rolled literal. A `TrialBalanceLine` has
 * seven fields; a literal that forgets `debitCents` type-checks under a cast and
 * then produces NaN downstream, which is exactly how this slice lost an hour.
 */
export function line(accountCode: string, accountName: string, balanceCents: number): FixtureLine {
  return {
    accountCode,
    accountName,
    balanceCents,
    debitCents: balanceCents > 0 ? balanceCents : 0,
    creditCents: balanceCents < 0 ? -balanceCents : 0,
    nature: "permanent",
    isAbnormal: false,
  };
}

/**
 * A balanced month on Greenway's books. Signed cents: positive = net debit.
 *
 * Returns a fresh object each call so no suite can mutate another's fixture.
 */
export function greenwayView(): TrialBalanceView {
  const lines: FixtureLine[] = [
    line("10100", "Cash on Hand — Vault", 4_000_00),
    line("20010", "Inventory — Flower", 6_000_00),
    line("30000", "Accounts Payable", -2_000_00),
    line("32000", "Cannabis Excise Tax Payable (37%) — TRUST", -3_700_00),
    line("32100", "Retail Sales Tax Payable — TRUST", -1_000_00),
    line("34000", "Notes & Loans Payable", -5_000_00),
    line("40300", "Retained Earnings", -1_000_00),
    line("40400", "Opening Balance Equity", 5_000_00),
    line("50010", "Sales — Flower", -10_000_00),
    line("50900", "Discounts & Comps", 500_00),
    line("60010", "COGS — Flower", 6_000_00),
    line("73030", "Hardware & Equipment", 1_200_00),
  ];

  let d = 0;
  let c = 0;
  for (const l of lines) {
    d += l.debitCents;
    c += l.creditCents;
  }

  return {
    lines,
    totalDebitCents: d,
    totalCreditCents: c,
    differenceCents: d - c,
    foots: d === c,
    abnormalCount: 0,
    unmappedAccountCodes: [],
  };
}

/**
 * The contra-revenue codes present in the fixture above.
 *
 * Named rather than inlined because the $13,200.00 figure the owner report
 * quotes depends on `50900` being passed as contra-revenue. Omit it and the
 * same defect produces a different number — which is precisely how the two
 * fixtures came to disagree in the first place.
 */
export const GREENWAY_CONTRA_CODES: readonly string[] = ["50900", "50910"];

/** Greenway's cannabis excise account. A trust LIABILITY — never an expense. */
export const GREENWAY_EXCISE_LIABILITY_CODE = "32000";
