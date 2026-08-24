/**
 * src/lib/accounting/financial-statements-core.ts   (books-17)
 *
 * THE FOUR FINANCIAL STATEMENTS, BUILT SO THEY CANNOT LIE.
 *
 * Income statement, balance sheet, cash flow, statement of stockholders'
 * equity — assembled from a trial balance that has already proven it ties.
 *
 * ---------------------------------------------------------------------------
 * THE ONE IDEA THAT SHAPES THIS WHOLE FILE
 * ---------------------------------------------------------------------------
 *
 * For a normal retailer, where a cost sits on the income statement is a
 * presentation question. For Greenway it is a TAX question worth roughly forty
 * cents on the dollar, because §280E denies every deduction below the gross
 * income line while leaving cost of goods sold alone. So the layout is not
 * cosmetic. A cost recorded one line too low costs real money, and a cost moved
 * one line too high to save money is the exact behaviour that lost Harborside
 * and Alterman their cases.
 *
 * The wall is therefore drawn ON THE FACE of the statement as a real line item
 * (FASB CON 8 Ch. 7 ¶PR12: a note is not an acceptable substitute for
 * recognition), and the engine NEVER moves a cost across it by inference. An
 * account's side of the wall comes from its account type, which comes from the
 * chart of accounts, which is Michael's documented decision — not a guess made
 * at render time.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE REFUSES TO DO
 * ---------------------------------------------------------------------------
 *
 * It will not render a statement from a trial balance that does not tie. Not
 * with a warning, not with a suspense line, not with a footnote (standing rules
 * 14 and 27; Reg S-X §210.4-01(a)(1): a statement not prepared in accordance
 * with GAAP is presumed misleading "despite footnote or other disclosures").
 *
 * A refusal returns `{ ok: false, statement: null }`. The type makes it
 * impossible to hand back a refusal WITH numbers attached, because the one
 * thing worse than no report is a report that looks finished and is wrong.
 */
import {
  type AccountType,
  type TrialBalance,
  type TrialBalanceRow,
  isValidYmd,
} from "@/lib/accounting/trial-balance-core";
import { describeRoster } from "@/lib/accounting/shareholder-roster-core";

// ---------------------------------------------------------------------------
// 1) THE §280E WALL
// ---------------------------------------------------------------------------

/**
 * Which side of the §280E line an amount falls on.
 *
 * Three values, not two. "not_applicable" exists because balance sheet
 * accounts have no side at all, and forcing them into one would quietly imply
 * a tax consequence that does not exist.
 */
export type WallSide = "above_the_line" | "below_the_line" | "not_applicable";

export const ALL_WALL_SIDES: readonly WallSide[] = [
  "above_the_line",
  "below_the_line",
  "not_applicable",
] as const;

export const WALL_SIDE_MEANING: Readonly<Record<WallSide, string>> = {
  above_the_line:
    "Counts against your income for tax. Revenue, the excise tax, and cost of goods sold all sit " +
    "here — §280E does not reach any of them, because gross income is computed before deductions.",
  below_the_line:
    "Does NOT count against your income for tax. Real money you actually spent — rent, wages, " +
    "advertising, utilities — that §280E disallows because you sell a Schedule I substance.",
  not_applicable:
    "A balance sheet account. It shows what you own and owe at a moment in time and has no effect " +
    "on the year's taxable income at all.",
};

/**
 * The mapping from account type to wall side.
 *
 * Deliberately a total map over the union rather than a switch with a default.
 * A default case would silently absorb a new account type added years from now
 * and put it on whichever side the default happened to be — and the tests
 * assert this map covers the union exactly, so adding a type without deciding
 * its side breaks the build instead of quietly costing money.
 */
export const WALL_SIDE_BY_ACCOUNT_TYPE: Readonly<Record<AccountType, WallSide>> = {
  asset: "not_applicable",
  liability: "not_applicable",
  equity: "not_applicable",
  income: "above_the_line",
  cogs: "above_the_line",
  expense: "below_the_line",
  other_income: "above_the_line",
  other_expense: "below_the_line",
};

/** The authorities behind the wall, cited on the face of the statement. */
export const WALL_AUTHORITY_IDS: readonly string[] = [
  "IRC_280E",
  "REG_1_61_3_A",
  "REG_1_471_3_B_RESELLER_COST",
  "ALPENGLOW_EXCLUSION",
  "HARBORSIDE",
  "PATIENTS_MUTUAL_RESELLER",
  "SENATE_REPORT_97_494",
  "CON8_CH7_PR12_NOTE_NOT_SUBSTITUTE",
] as const;

export function wallSideOf(accountType: AccountType): WallSide {
  return WALL_SIDE_BY_ACCOUNT_TYPE[accountType];
}

// ---------------------------------------------------------------------------
// 2) REFUSALS
// ---------------------------------------------------------------------------

export type StatementRefusalCode =
  | "TB_DOES_NOT_TIE"
  | "TB_EMPTY"
  | "BAD_DATE_RANGE"
  | "PERIOD_MISMATCH"
  | "ENTITY_MISMATCH"
  | "BALANCE_SHEET_DOES_NOT_TIE"
  | "CASH_FLOW_DOES_NOT_TIE"
  | "EQUITY_ROLLFORWARD_DOES_NOT_TIE"
  | "OWNERSHIP_NOT_100_PCT"
  | "EARNINGS_AND_PROFITS_UNKNOWN"
  | "ACCOUNT_ROLE_CONFLICT"
  | "DUPLICATE_SHAREHOLDER"
  | "NO_SHAREHOLDERS"
  | "NEGATIVE_EQUITY_MOVEMENT";

export const ALL_STATEMENT_REFUSAL_CODES: readonly StatementRefusalCode[] = [
  "TB_DOES_NOT_TIE",
  "TB_EMPTY",
  "BAD_DATE_RANGE",
  "PERIOD_MISMATCH",
  "ENTITY_MISMATCH",
  "BALANCE_SHEET_DOES_NOT_TIE",
  "CASH_FLOW_DOES_NOT_TIE",
  "EQUITY_ROLLFORWARD_DOES_NOT_TIE",
  "OWNERSHIP_NOT_100_PCT",
  "EARNINGS_AND_PROFITS_UNKNOWN",
  "ACCOUNT_ROLE_CONFLICT",
  "DUPLICATE_SHAREHOLDER",
  "NO_SHAREHOLDERS",
  "NEGATIVE_EQUITY_MOVEMENT",
] as const;

export type StatementRefusal = {
  code: StatementRefusalCode;
  /** What went wrong, in Michael's language. Never jargon-only. */
  message: string;
  /** What to actually do about it. A refusal without a remedy is a dead end. */
  whatToDo: string;
  authorityIds: readonly string[];
};

/**
 * The result type.
 *
 * A discriminated union, so `ok: false` and a populated statement cannot
 * coexist — the compiler enforces what a convention would only request.
 */
export type StatementResult<T> =
  | { ok: true; statement: T; refusals: readonly [] }
  | { ok: false; statement: null; refusals: readonly StatementRefusal[] };

function allow<T>(statement: T): StatementResult<T> {
  return { ok: true, statement, refusals: [] };
}

function refuse<T>(refusals: readonly StatementRefusal[]): StatementResult<T> {
  return { ok: false, statement: null, refusals };
}

/**
 * The refusal Michael will see most often, and the one that matters most.
 *
 * It NAMES THE AMOUNT. During the 2023 review a $4,624,697.31 difference was
 * carried in a suspense account for months precisely because every report
 * rendered anyway and nobody was ever shown the number (standing rule 19).
 */
export function tbDoesNotTieRefusal(differenceCents: number): StatementRefusal {
  return {
    code: "TB_DOES_NOT_TIE",
    message:
      `The books are out of balance by ${formatCents(differenceCents)}. Debits and credits do not ` +
      `agree, so any statement built on them would be arithmetic performed on the wrong numbers.`,
    whatToDo:
      "Find the entry that is one-sided before anything else. Sort the journal by date and look for a " +
      "line whose debit and credit do not match, an entry posted to only one account, or an import " +
      "that ran twice. Do NOT create an account to hold the difference — a difference parked in an " +
      "account is a difference nobody ever looks at again.",
    authorityIds: ["REG_SX_210_4_01_NOT_MISLEADING", "CON8_CH7_PR12_NOTE_NOT_SUBSTITUTE"],
  };
}

// ---------------------------------------------------------------------------
// 3) MONEY AND PERCENTAGES — integers only
// ---------------------------------------------------------------------------

/**
 * THE MONEY GUARD.
 *
 * Every money value entering this module passes through here. It exists
 * because trying to break the formatter produced these three outputs:
 *
 *     formatCents(Infinity) -> "$Infinity.NaN"
 *     formatCents(NaN)      -> "$NaN.NaN"
 *     formatCents(10.5)     -> "$0.10.5"
 *
 * The third is the dangerous one. It is not obviously broken at a glance, it
 * appears in the middle of a column of real money, and it means a fractional
 * cent reached the ledger and nothing stopped it. A formatter that prints
 * nonsense is worse than one that refuses, because the nonsense gets printed,
 * filed and believed.
 *
 * Money is INTEGER CENTS everywhere in this codebase (standing rule 4). This
 * throws rather than returning a refusal because a non-integer amount is a
 * PROGRAMMING error upstream, not a bookkeeping condition Michael can fix by
 * looking at a journal — and a bug that surfaces as a polite refusal is a bug
 * that ships.
 */
export function assertIntegerCents(cents: number, what: string): void {
  if (!Number.isFinite(cents) || !Number.isInteger(cents)) {
    throw new Error(
      `NOT_INTEGER_CENTS: ${what} received ${String(cents)}. Money is whole cents — never a ` +
        `fraction, never NaN, never Infinity. A fractional cent here means the value was computed ` +
        `with floating point somewhere upstream, and the difference will not stay small.`,
    );
  }
  if (!Number.isSafeInteger(cents)) {
    throw new Error(
      `CENTS_OUT_OF_SAFE_RANGE: ${what} received ${String(cents)}, which is beyond the range where ` +
        `JavaScript can hold an integer exactly. Above roughly $90,000,000,000,000 arithmetic starts ` +
        `silently rounding.`,
    );
  }
}

/**
 * Format integer cents as dollars.
 *
 * Negatives are shown in parentheses, per Reg S-X §210.4-01(c): a minus sign
 * is easy to miss and a parenthesis is not.
 */
export function formatCents(cents: number): string {
  assertIntegerCents(cents, "formatCents");
  const negative = cents < 0;
  const abs = negative ? -cents : cents;
  const dollars = Math.trunc(abs / 100);
  const remainder = abs - dollars * 100;
  const pennies = remainder < 10 ? `0${remainder}` : `${remainder}`;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `($${grouped}.${pennies})` : `$${grouped}.${pennies}`;
}

/**
 * A share expressed in MILLI-PERCENT (percent × 1000), or null.
 *
 * Null when the base is zero. Not 0, and not Infinity: "no percentage exists"
 * is a different statement from "the percentage is zero", and collapsing the
 * two is how a divide-by-zero becomes a plausible-looking 0% on a report.
 */
export function shareInMilliPercent(partCents: number, wholeCents: number): number | null {
  if (wholeCents === 0) return null;
  return Math.trunc((partCents * 100000) / wholeCents);
}

/**
 * Render milli-percent as a percentage string, using integer math only.
 *
 * `ownership / 1000` would be a float on a number that decides who owns what,
 * and 85_500 / 1000 is the kind of division that eventually produces
 * "8.549999999999999%" on a report. Integers all the way down instead.
 */
export function formatMilliPercent(milliPercent: number): string {
  const negative = milliPercent < 0;
  const abs = negative ? -milliPercent : milliPercent;
  const whole = Math.trunc(abs / 1000);
  const frac = abs - whole * 1000;
  if (frac === 0) return `${negative ? "-" : ""}${whole}%`;
  const padded = frac < 10 ? `00${frac}` : frac < 100 ? `0${frac}` : `${frac}`;
  return `${negative ? "-" : ""}${whole}.${padded.replace(/0+$/, "")}%`;
}

/**
 * The Reg S-X 5-02 breakout test: strictly MORE than 5 percent.
 *
 * The regulation says "in excess of", so exactly five percent is not a
 * breakout. That is arithmetic rather than judgment, which is why it is
 * computed here instead of asked of anyone.
 */
export function requiresSeparateDisclosure(itemCents: number, totalCents: number): boolean {
  if (totalCents === 0) return false;
  const abs = itemCents < 0 ? -itemCents : itemCents;
  const absTotal = totalCents < 0 ? -totalCents : totalCents;
  // abs/absTotal > 0.05  <=>  abs * 100 > absTotal * 5, in integers only.
  return abs * 100 > absTotal * 5;
}

// ---------------------------------------------------------------------------
// 4) THE INCOME STATEMENT
// ---------------------------------------------------------------------------

export type StatementLine = {
  key: string;
  label: string;
  amountCents: number;
  accountCodes: readonly string[];
  wallSide: WallSide;
  isSubtotal: boolean;
  indent: number;
  authorityIds: readonly string[];
};

/**
 * The book-to-tax bridge.
 *
 * Book net income is NOT taxable income for a §280E business, and the gap is
 * enormous rather than marginal. Showing book net income alone would be the
 * single most misleading number this system could print, so it never appears
 * without this memo attached.
 */
export type TaxBridgeMemo = {
  bookNetIncomeCents: number;
  /** Gross income under Treas. Reg. §1.61-3(a) — what §280E actually taxes. */
  grossIncomeCents: number;
  disallowedDeductionsCents: number;
  /** Gross income again, since every deduction below it is denied. */
  approximateTaxableIncomeCents: number;
  explanation: string;
  authorityIds: readonly string[];
};

export type IncomeStatement = {
  entityCode: string;
  fromDate: string;
  toDate: string;
  lines: readonly StatementLine[];
  grossSalesCents: number;
  exciseTaxCents: number;
  netSalesCents: number;
  costOfGoodsSoldCents: number;
  /** THE NUMBER §280E CARES ABOUT. Treas. Reg. §1.61-3(a). */
  grossIncomeCents: number;
  operatingExpensesCents: number;
  otherIncomeCents: number;
  otherExpenseCents: number;
  netIncomeCents: number;
  taxBridge: TaxBridgeMemo;
};

export type BuildIncomeStatementInput = {
  trialBalance: TrialBalance;
  /** Account codes carrying the WA cannabis excise. Supplied, never guessed. */
  exciseAccountCodes?: readonly string[];
  /** Contra-revenue codes (discounts, returns) other than the excise. */
  contraRevenueAccountCodes?: readonly string[];
};

/** Present a set of rows as a positive number on the side they belong on. */
function sumPresented(rows: readonly TrialBalanceRow[], side: "debit" | "credit"): number {
  let total = 0;
  for (const r of rows) total += side === "debit" ? r.balanceCents : -r.balanceCents;
  return total;
}

/**
 * Guards shared by every statement built from a trial balance.
 *
 * Ordered deliberately: date problems first (they explain an empty result),
 * then emptiness (it explains a zero total), then the tie. Reporting "out of
 * balance by $0.00" on an empty period would be technically true and useless.
 */
function trialBalanceRefusal(tb: TrialBalance): StatementRefusal | null {
  if (!isValidYmd(tb.fromDate) || !isValidYmd(tb.toDate) || tb.fromDate > tb.toDate) {
    return {
      code: "BAD_DATE_RANGE",
      message:
        `The reporting period "${tb.fromDate}" to "${tb.toDate}" is not a valid range. A financial ` +
        `statement is always FOR a period, and a period that runs backwards or uses a date that does ` +
        `not exist would silently report on nothing.`,
      whatToDo:
        "Pick a start date on or before the end date, both as real calendar dates (YYYY-MM-DD).",
      authorityIds: ["REG_SX_210_4_01_NOT_MISLEADING"],
    };
  }
  if (tb.rows.length === 0) {
    return {
      code: "TB_EMPTY",
      message:
        "There are no ledger balances in this period, so there is nothing to report. An empty " +
        "statement showing zeros would imply you had no activity, which is a different claim entirely.",
      whatToDo:
        "Check the entity code and the date range. An empty result almost always means the filter is " +
        "wrong rather than that the business stood still — remember the 18 accounts tagged GRWNY " +
        "instead of GRNWY that vanished from every entity-filtered report.",
      authorityIds: ["REG_SX_210_4_01_NOT_MISLEADING"],
    };
  }
  if (!tb.balanced || tb.differenceCents !== 0) {
    return tbDoesNotTieRefusal(tb.differenceCents);
  }
  return null;
}

export function buildIncomeStatement(
  input: BuildIncomeStatementInput,
): StatementResult<IncomeStatement> {
  const tb = input.trialBalance;
  const guard = trialBalanceRefusal(tb);
  if (guard !== null) return refuse<IncomeStatement>([guard]);

  const exciseCodes = new Set(input.exciseAccountCodes ?? []);
  const contraCodes = new Set(input.contraRevenueAccountCodes ?? []);

  // D3: ONE ACCOUNT IN TWO ROLES IS SUBTRACTED TWICE.
  //
  // Passing 4900 as BOTH the excise and a contra-revenue code removed it once
  // as excise and again as a discount: on $10.00 of sales with $3.00 of excise,
  // net sales came out $4.00 instead of $7.00. At Greenway's 37% rate that
  // understates net sales by the second largest number on the statement. There
  // is no reading in which one account is simultaneously the state excise and a
  // customer discount, so this is refused rather than resolved by precedence —
  // picking a winner would silently discard whichever meaning the caller
  // actually intended.
  const overlap = [...exciseCodes].filter((c) => contraCodes.has(c));
  if (overlap.length > 0) {
    return refuse<IncomeStatement>([
      {
        code: "ACCOUNT_ROLE_CONFLICT",
        message:
          `Account ${overlap.join(", ")} is listed as BOTH the excise tax and a customer discount. It ` +
          `would be subtracted from sales twice, understating net sales by the full amount of the ` +
          `excise — which for you is 37% of gross.`,
        whatToDo:
          "Decide which one the account actually is. The Washington cannabis excise belongs on its own " +
          "account, listed only as an excise code; discounts, returns and allowances belong on a " +
          "separate account listed only as contra-revenue.",
        authorityIds: ["REG_SX_210_5_03_CAPTION_ORDER", "CCA_201531016_EXCISE_AMOUNT_REALIZED"],
      },
    ]);
  }

  const incomeRows = tb.rows.filter((r) => r.accountType === "income");
  const cogsRows = tb.rows.filter((r) => r.accountType === "cogs");
  const opexRows = tb.rows.filter((r) => r.accountType === "expense");
  const otherIncomeRows = tb.rows.filter((r) => r.accountType === "other_income");
  const otherExpenseRows = tb.rows.filter((r) => r.accountType === "other_expense");

  // The excise may be tagged on an income account (contra-revenue) or booked as
  // an expense account. Both are found, because which one Michael used is a
  // fact about his chart of accounts, not something to infer.
  const exciseRows = tb.rows.filter((r) => exciseCodes.has(r.accountCode));
  const contraRows = tb.rows.filter((r) => contraCodes.has(r.accountCode));
  const grossRows = incomeRows.filter(
    (r) => !exciseCodes.has(r.accountCode) && !contraCodes.has(r.accountCode),
  );

  const grossSalesCents = sumPresented(grossRows, "credit");
  const exciseTaxCents = sumPresented(exciseRows, "debit");
  const contraRevenueCents = sumPresented(contraRows, "debit");
  const netSalesCents = grossSalesCents - exciseTaxCents - contraRevenueCents;

  const costOfGoodsSoldCents = sumPresented(cogsRows, "debit");
  const grossIncomeCents = netSalesCents - costOfGoodsSoldCents;

  // Operating expenses EXCLUDE anything already counted as excise, so an
  // excise account booked as an expense is not double counted.
  const operatingExpensesCents = sumPresented(
    opexRows.filter((r) => !exciseCodes.has(r.accountCode)),
    "debit",
  );
  const otherIncomeCents = sumPresented(otherIncomeRows, "credit");
  const otherExpenseCents = sumPresented(otherExpenseRows, "debit");

  const operatingIncomeCents = grossIncomeCents - operatingExpensesCents;
  const netIncomeCents = operatingIncomeCents + otherIncomeCents - otherExpenseCents;

  const lines: StatementLine[] = [];

  lines.push({
    key: "gross_sales",
    label: "Gross sales",
    amountCents: grossSalesCents,
    accountCodes: grossRows.map((r) => r.accountCode),
    wallSide: "above_the_line",
    isSubtotal: false,
    indent: 0,
    authorityIds: ["REG_SX_210_5_03_CAPTION_ORDER"],
  });

  if (exciseTaxCents !== 0 || exciseCodes.size > 0) {
    lines.push({
      key: "excise_tax",
      label: "Less: Washington cannabis excise tax (37%)",
      amountCents: exciseTaxCents,
      accountCodes: exciseRows.map((r) => r.accountCode),
      wallSide: "above_the_line",
      isSubtotal: false,
      indent: 1,
      authorityIds: [
        "CCA_201531016_EXCISE_AMOUNT_REALIZED",
        "REG_SX_210_5_03_CAPTION_ORDER",
        "RCW_69_50_535",
        "REG_1_461_4_G_6_TAX_ECONOMIC_PERFORMANCE",
      ],
    });
  }

  if (contraRevenueCents !== 0) {
    lines.push({
      key: "contra_revenue",
      label: "Less: discounts, returns and allowances",
      amountCents: contraRevenueCents,
      accountCodes: contraRows.map((r) => r.accountCode),
      wallSide: "above_the_line",
      isSubtotal: false,
      indent: 1,
      authorityIds: ["REG_SX_210_5_03_CAPTION_ORDER"],
    });
  }

  lines.push({
    key: "net_sales",
    label: "Net sales",
    amountCents: netSalesCents,
    accountCodes: [],
    wallSide: "above_the_line",
    isSubtotal: true,
    indent: 0,
    authorityIds: ["REG_SX_210_5_03_CAPTION_ORDER"],
  });

  lines.push({
    key: "cost_of_goods_sold",
    label: "Cost of goods sold",
    amountCents: costOfGoodsSoldCents,
    accountCodes: cogsRows.map((r) => r.accountCode),
    wallSide: "above_the_line",
    isSubtotal: false,
    indent: 0,
    authorityIds: [
      "REG_1_471_3_B_RESELLER_COST",
      "PATIENTS_MUTUAL_RESELLER",
      "ALTERMAN_COGS_FORMULA",
      "REG_SX_210_5_03_CAPTION_ORDER",
    ],
  });

  lines.push({
    key: "gross_income",
    label: "GROSS INCOME — the number §280E taxes",
    amountCents: grossIncomeCents,
    accountCodes: [],
    wallSide: "above_the_line",
    isSubtotal: true,
    indent: 0,
    authorityIds: ["REG_1_61_3_A", "IRC_280E", "ALPENGLOW_EXCLUSION"],
  });

  // THE WALL, drawn on the face of the statement. CON 8 ¶PR12.
  lines.push({
    key: "the_280e_wall",
    label:
      "———— §280E WALL: everything below this line is real money you spent that you may NOT deduct ————",
    amountCents: 0,
    accountCodes: [],
    wallSide: "not_applicable",
    isSubtotal: false,
    indent: 0,
    authorityIds: WALL_AUTHORITY_IDS,
  });

  lines.push({
    key: "operating_expenses",
    label: "Operating expenses (disallowed by §280E)",
    amountCents: operatingExpensesCents,
    accountCodes: opexRows.map((r) => r.accountCode),
    wallSide: "below_the_line",
    isSubtotal: false,
    indent: 0,
    authorityIds: ["IRC_280E", "CHAMP", "HARBORSIDE"],
  });

  if (otherIncomeCents !== 0) {
    lines.push({
      key: "other_income",
      label: "Other income",
      amountCents: otherIncomeCents,
      accountCodes: otherIncomeRows.map((r) => r.accountCode),
      wallSide: "above_the_line",
      isSubtotal: false,
      indent: 0,
      authorityIds: ["REG_SX_210_5_03_CAPTION_ORDER"],
    });
  }

  if (otherExpenseCents !== 0) {
    lines.push({
      key: "other_expense",
      label: "Other expense",
      amountCents: otherExpenseCents,
      accountCodes: otherExpenseRows.map((r) => r.accountCode),
      wallSide: "below_the_line",
      isSubtotal: false,
      indent: 0,
      authorityIds: ["IRC_280E"],
    });
  }

  lines.push({
    key: "net_income",
    label: "Net income (book)",
    amountCents: netIncomeCents,
    accountCodes: [],
    wallSide: "not_applicable",
    isSubtotal: true,
    indent: 0,
    authorityIds: ["CON8_CH7_PR39_HOMOGENEITY"],
  });

  const disallowedDeductionsCents = operatingExpensesCents + otherExpenseCents;

  const taxBridge: TaxBridgeMemo = {
    bookNetIncomeCents: netIncomeCents,
    grossIncomeCents,
    disallowedDeductionsCents,
    approximateTaxableIncomeCents: grossIncomeCents,
    explanation:
      `Your book net income is ${formatCents(netIncomeCents)}, but that is NOT what you are taxed on. ` +
      `§280E denies every deduction below the gross income line, so the federal starting point is ` +
      `${formatCents(grossIncomeCents)} — a difference of ` +
      `${formatCents(disallowedDeductionsCents)} of real money you spent and cannot deduct. This is why ` +
      `a cannabis retailer can owe federal tax in a year it lost money on paper. The one relief the law ` +
      `does allow is cost of goods sold, which is why every dollar of inventory cost has to be captured ` +
      `properly and documented — and why moving an operating expense into cost of goods sold to save ` +
      `tax is exactly what Harborside and Alterman were penalised for.`,
    authorityIds: [
      "IRC_280E",
      "REG_1_61_3_A",
      "ALPENGLOW_EXCLUSION",
      "HARBORSIDE",
      "ALTERMAN_COGS_FORMULA",
      "SENATE_REPORT_97_494",
    ],
  };

  return allow<IncomeStatement>({
    entityCode: tb.entityCode,
    fromDate: tb.fromDate,
    toDate: tb.toDate,
    lines,
    grossSalesCents,
    exciseTaxCents,
    netSalesCents,
    costOfGoodsSoldCents,
    grossIncomeCents,
    operatingExpensesCents,
    otherIncomeCents,
    otherExpenseCents,
    netIncomeCents,
    taxBridge,
  });
}

// ---------------------------------------------------------------------------
// 5) THE BALANCE SHEET
// ---------------------------------------------------------------------------

export type BalanceSheetSection = {
  key: string;
  label: string;
  lines: readonly StatementLine[];
  totalCents: number;
};

export type BalanceSheet = {
  entityCode: string;
  /** A balance sheet is AS OF an instant, not FOR a period. */
  asOfDate: string;
  currentAssets: BalanceSheetSection;
  nonCurrentAssets: BalanceSheetSection;
  totalAssetsCents: number;
  currentLiabilities: BalanceSheetSection;
  nonCurrentLiabilities: BalanceSheetSection;
  totalLiabilitiesCents: number;
  equity: BalanceSheetSection;
  totalEquityCents: number;
  totalLiabilitiesAndEquityCents: number;
  /**
   * Accounts sitting on the wrong side of their normal balance. SURFACED, not
   * netted away — FASB CON 8 Ch. 7 ¶PR33 says there is no conceptual basis for
   * netting assets against liabilities, and netting is where errors hide.
   */
  abnormalBalances: readonly TrialBalanceRow[];
  /** Items exceeding the 5% threshold of 17 C.F.R. §210.5-02 captions 8/20. */
  requiredBreakouts: readonly string[];
};

export type BuildBalanceSheetInput = {
  trialBalance: TrialBalance;
  /**
   * Account codes that are NON-current. Passed in explicitly.
   *
   * Current versus non-current is a FACT about each account — when the money
   * is due — not something derivable from an account number. Guessing it from
   * a code range is how a long-term note ends up in current liabilities and
   * makes the business look insolvent when it is not.
   */
  nonCurrentAccountCodes?: readonly string[];
  /** Net income for the period, closed into equity. */
  periodNetIncomeCents?: number;
};

function toLine(r: TrialBalanceRow, side: "debit" | "credit"): StatementLine {
  return {
    key: r.accountCode,
    label: r.accountName,
    amountCents: side === "debit" ? r.balanceCents : -r.balanceCents,
    accountCodes: [r.accountCode],
    wallSide: wallSideOf(r.accountType),
    isSubtotal: false,
    indent: 1,
    authorityIds: ["REG_SX_210_5_02_BALANCE_SHEET_ORDER"],
  };
}

function section(
  key: string,
  label: string,
  rows: readonly TrialBalanceRow[],
  side: "debit" | "credit",
): BalanceSheetSection {
  const lines = rows.map((r) => toLine(r, side));
  let total = 0;
  for (const l of lines) total += l.amountCents;
  return { key, label, lines, totalCents: total };
}

export function buildBalanceSheet(input: BuildBalanceSheetInput): StatementResult<BalanceSheet> {
  const tb = input.trialBalance;
  const guard = trialBalanceRefusal(tb);
  if (guard !== null) return refuse<BalanceSheet>([guard]);

  const nonCurrent = new Set(input.nonCurrentAccountCodes ?? []);

  const assetRows = tb.rows.filter((r) => r.accountType === "asset");
  const liabilityRows = tb.rows.filter((r) => r.accountType === "liability");
  const equityRows = tb.rows.filter((r) => r.accountType === "equity");

  const currentAssets = section(
    "current_assets",
    "Current assets",
    assetRows.filter((r) => !nonCurrent.has(r.accountCode)),
    "debit",
  );
  const nonCurrentAssets = section(
    "non_current_assets",
    "Non-current assets",
    assetRows.filter((r) => nonCurrent.has(r.accountCode)),
    "debit",
  );
  const currentLiabilities = section(
    "current_liabilities",
    "Current liabilities",
    liabilityRows.filter((r) => !nonCurrent.has(r.accountCode)),
    "credit",
  );
  const nonCurrentLiabilities = section(
    "non_current_liabilities",
    "Non-current liabilities",
    liabilityRows.filter((r) => nonCurrent.has(r.accountCode)),
    "credit",
  );
  const equity = section("equity", "Stockholders' equity", equityRows, "credit");

  const periodNetIncomeCents = input.periodNetIncomeCents ?? 0;
  assertIntegerCents(periodNetIncomeCents, "period net income");
  const totalAssetsCents = currentAssets.totalCents + nonCurrentAssets.totalCents;
  const totalLiabilitiesCents = currentLiabilities.totalCents + nonCurrentLiabilities.totalCents;
  const totalEquityCents = equity.totalCents + periodNetIncomeCents;
  const totalLiabilitiesAndEquityCents = totalLiabilitiesCents + totalEquityCents;

  if (totalAssetsCents !== totalLiabilitiesAndEquityCents) {
    return refuse<BalanceSheet>([
      {
        code: "BALANCE_SHEET_DOES_NOT_TIE",
        message:
          `Assets of ${formatCents(totalAssetsCents)} do not equal liabilities plus equity of ` +
          `${formatCents(totalLiabilitiesAndEquityCents)} — a difference of ` +
          `${formatCents(totalAssetsCents - totalLiabilitiesAndEquityCents)}. The trial balance ties, so ` +
          `the problem is in how the accounts are classified, not in the bookkeeping arithmetic.`,
        whatToDo:
          "Look for an account whose type is wrong — an equity account typed as a liability, or the " +
          "period's net income not being carried into equity. Every account must be exactly one of " +
          "asset, liability or equity on this statement.",
        authorityIds: ["REG_SX_210_5_02_BALANCE_SHEET_ORDER", "CON8_CH7_PR33_NETTING"],
      },
    ]);
  }

  // CON 8 ¶PR33: surface these, never net them away.
  const abnormalBalances = tb.rows.filter(
    (r) =>
      r.isAbnormal &&
      (r.accountType === "asset" || r.accountType === "liability" || r.accountType === "equity"),
  );

  // Reg S-X §210.5-02 captions 8 and 20: strictly more than 5%.
  const requiredBreakouts: string[] = [];
  for (const l of currentAssets.lines) {
    if (requiresSeparateDisclosure(l.amountCents, currentAssets.totalCents)) {
      requiredBreakouts.push(l.label);
    }
  }
  for (const l of currentLiabilities.lines) {
    if (requiresSeparateDisclosure(l.amountCents, currentLiabilities.totalCents)) {
      requiredBreakouts.push(l.label);
    }
  }

  return allow<BalanceSheet>({
    entityCode: tb.entityCode,
    asOfDate: tb.toDate,
    currentAssets,
    nonCurrentAssets,
    totalAssetsCents,
    currentLiabilities,
    nonCurrentLiabilities,
    totalLiabilitiesCents,
    equity,
    totalEquityCents,
    totalLiabilitiesAndEquityCents,
    abnormalBalances,
    requiredBreakouts,
  });
}

// ---------------------------------------------------------------------------
// 6) THE STATEMENT OF CASH FLOWS
// ---------------------------------------------------------------------------

export type CashFlowStatement = {
  entityCode: string;
  fromDate: string;
  toDate: string;
  beginningCashCents: number;
  operatingCents: number;
  investingCents: number;
  financingCents: number;
  netChangeCents: number;
  endingCashCents: number;
  lines: readonly StatementLine[];
};

export type BuildCashFlowInput = {
  entityCode: string;
  fromDate: string;
  toDate: string;
  beginningCashCents: number;
  /** Counted, not derived. For a cash business this is the anchor. */
  endingCashCents: number;
  operatingCents: number;
  investingCents: number;
  financingCents: number;
};

/**
 * The cash flow statement, proved out against real counted cash.
 *
 * For a business that takes cash across the counter, this statement is the
 * closest thing to a fraud detector the books contain. Beginning cash plus the
 * three activity totals MUST equal the cash actually counted at period end. A
 * difference is not a rounding issue — it is either an unrecorded transaction
 * or money that left the building.
 */
export function buildCashFlowStatement(
  input: BuildCashFlowInput,
): StatementResult<CashFlowStatement> {
  if (!isValidYmd(input.fromDate) || !isValidYmd(input.toDate) || input.fromDate > input.toDate) {
    return refuse<CashFlowStatement>([
      {
        code: "BAD_DATE_RANGE",
        message: `The cash flow period "${input.fromDate}" to "${input.toDate}" is not a valid range.`,
        whatToDo: "Provide a start date on or before the end date, both as real YYYY-MM-DD dates.",
        authorityIds: ["REG_SX_210_4_01_NOT_MISLEADING"],
      },
    ]);
  }

  assertIntegerCents(input.beginningCashCents, "beginning cash");
  assertIntegerCents(input.endingCashCents, "ending cash (counted)");
  assertIntegerCents(input.operatingCents, "cash from operating activities");
  assertIntegerCents(input.investingCents, "cash from investing activities");
  assertIntegerCents(input.financingCents, "cash from financing activities");

  const netChangeCents = input.operatingCents + input.investingCents + input.financingCents;
  const impliedEnding = input.beginningCashCents + netChangeCents;

  if (impliedEnding !== input.endingCashCents) {
    const diff = input.endingCashCents - impliedEnding;
    return refuse<CashFlowStatement>([
      {
        code: "CASH_FLOW_DOES_NOT_TIE",
        message:
          `Starting cash of ${formatCents(input.beginningCashCents)} plus the movements recorded ` +
          `(${formatCents(netChangeCents)}) comes to ${formatCents(impliedEnding)}, but the cash ` +
          `actually counted was ${formatCents(input.endingCashCents)} — a difference of ` +
          `${formatCents(diff)}. In a cash business that difference is the most important number on ` +
          `this page, and it will not be presented as an "adjustment".`,
        whatToDo:
          "Count the drawer and the safe again first, then look for a transaction that never made it " +
          "into the books: a vendor paid from the till, an owner draw taken in cash, an ATM refill, or " +
          "a deposit recorded on a different day than it was made. Do NOT plug the difference — a plug " +
          "here hides exactly the thing this statement exists to reveal.",
        authorityIds: ["CON8_CH7_PR12_NOTE_NOT_SUBSTITUTE", "REG_SX_210_4_01_NOT_MISLEADING"],
      },
    ]);
  }

  const lines: StatementLine[] = [
    {
      key: "beginning_cash",
      label: "Cash at beginning of period",
      amountCents: input.beginningCashCents,
      accountCodes: [],
      wallSide: "not_applicable",
      isSubtotal: false,
      indent: 0,
      authorityIds: [],
    },
    {
      key: "operating",
      label: "Cash from operating activities",
      amountCents: input.operatingCents,
      accountCodes: [],
      wallSide: "not_applicable",
      isSubtotal: false,
      indent: 0,
      authorityIds: ["CON8_CH7_PR39_HOMOGENEITY"],
    },
    {
      key: "investing",
      label: "Cash from investing activities",
      amountCents: input.investingCents,
      accountCodes: [],
      wallSide: "not_applicable",
      isSubtotal: false,
      indent: 0,
      authorityIds: ["CON8_CH7_PR39_HOMOGENEITY"],
    },
    {
      key: "financing",
      label: "Cash from financing activities",
      amountCents: input.financingCents,
      accountCodes: [],
      wallSide: "not_applicable",
      isSubtotal: false,
      indent: 0,
      authorityIds: ["CON8_CH7_PR39_HOMOGENEITY"],
    },
    {
      key: "net_change",
      label: "Net change in cash",
      amountCents: netChangeCents,
      accountCodes: [],
      wallSide: "not_applicable",
      isSubtotal: true,
      indent: 0,
      authorityIds: [],
    },
    {
      key: "ending_cash",
      label: "Cash at end of period (counted)",
      amountCents: input.endingCashCents,
      accountCodes: [],
      wallSide: "not_applicable",
      isSubtotal: true,
      indent: 0,
      authorityIds: [],
    },
  ];

  return allow<CashFlowStatement>({
    entityCode: input.entityCode,
    fromDate: input.fromDate,
    toDate: input.toDate,
    beginningCashCents: input.beginningCashCents,
    operatingCents: input.operatingCents,
    investingCents: input.investingCents,
    financingCents: input.financingCents,
    netChangeCents,
    endingCashCents: input.endingCashCents,
    lines,
  });
}

// ---------------------------------------------------------------------------
// 7) STOCKHOLDERS' EQUITY, STOCK BASIS AND AAA
// ---------------------------------------------------------------------------

export type ShareholderEquityRow = {
  shareholderName: string;
  ownershipMilliPercent: number;
  beginningBasisCents: number;
  allocatedIncomeCents: number;
  nonDeductibleExpenseCents: number;
  distributionsCents: number;
  endingBasisCents: number;
  /** §1368(b)(2): a distribution beyond basis is a capital gain. */
  gainOnExcessDistributionCents: number;
};

export type EquityStatement = {
  entityCode: string;
  fromDate: string;
  toDate: string;
  beginningEquityCents: number;
  netIncomeCents: number;
  distributionsCents: number;
  contributionsCents: number;
  endingEquityCents: number;
  shareholders: readonly ShareholderEquityRow[];
  /**
   * AAA has NO zero floor — §1368(e)(1)(A) expressly disregards the phrase
   * "(but not below zero)" from §1367(a)(2). Stock basis DOES have one. Two
   * accounts, nearly identical adjustments, different floors.
   */
  beginningAaaCents: number;
  endingAaaCents: number;
  /** Warnings that are not refusals: real, but not fatal to the statement. */
  warnings: readonly string[];
};

export type ShareholderInput = {
  shareholderName: string;
  ownershipMilliPercent: number;
  beginningBasisCents: number;
};

export type BuildEquityStatementInput = {
  entityCode: string;
  fromDate: string;
  toDate: string;
  beginningEquityCents: number;
  netIncomeCents: number;
  /** Positive number; reduces equity. */
  distributionsCents: number;
  contributionsCents: number;
  /** §280E-disallowed expenses for the period, entity level. */
  nonDeductibleExpenseCents: number;
  beginningAaaCents: number;
  shareholders: readonly ShareholderInput[];
  /**
   * Distributions actually PAID to each shareholder, by name.
   *
   * This exists because of a specific Greenway fact: allocation and payment
   * are NOT the same thing here. Income is allocated strictly pro rata, but
   * distributions are not all actually paid out - at least one minority holder
   * is allocated income without receiving cash for it. Splitting distributions
   * pro rata to ownership would therefore be wrong for several of the four
   * shareholders, and it would understate Michael's own draw — the one number
   * most likely to trip §1368(b)(2). So it is supplied as fact, per person.
   *
   * WHICH holders are paid and which are only allocated is an OWNER FACT that
   * has not been re-confirmed since the roster was corrected in books-50. It
   * is deliberately not hard-coded here; this field is the input that carries
   * it.
   */
  distributionsByShareholder: Readonly<Record<string, number>>;
  /**
   * Does the corporation have accumulated earnings and profits from a C year?
   *
   * `null` means UNKNOWN, and unknown means the engine REFUSES. This is not
   * caution for its own sake: the answer selects between §1368(b) and
   * §1368(c), which are materially different tax outcomes. Guessing "probably
   * no E&P" would be the single most expensive assumption in this codebase.
   */
  hasAccumulatedEandP: boolean | null;
};

export function buildEquityStatement(
  input: BuildEquityStatementInput,
): StatementResult<EquityStatement> {
  const refusals: StatementRefusal[] = [];

  if (!isValidYmd(input.fromDate) || !isValidYmd(input.toDate) || input.fromDate > input.toDate) {
    refusals.push({
      code: "BAD_DATE_RANGE",
      message: `The equity period "${input.fromDate}" to "${input.toDate}" is not a valid range.`,
      whatToDo: "Provide a start date on or before the end date, both as real YYYY-MM-DD dates.",
      authorityIds: ["REG_SX_210_4_01_NOT_MISLEADING"],
    });
  }

  assertIntegerCents(input.beginningEquityCents, "beginning equity");
  assertIntegerCents(input.netIncomeCents, "net income");
  assertIntegerCents(input.distributionsCents, "distributions");
  assertIntegerCents(input.contributionsCents, "contributions");
  assertIntegerCents(input.nonDeductibleExpenseCents, "non-deductible expenses");
  assertIntegerCents(input.beginningAaaCents, "beginning AAA");
  for (const sh of input.shareholders) {
    assertIntegerCents(sh.beginningBasisCents, `beginning basis for ${sh.shareholderName}`);
    if (!Number.isInteger(sh.ownershipMilliPercent)) {
      throw new Error(
        `NOT_INTEGER_MILLI_PERCENT: ownership for ${sh.shareholderName} is ` +
          `${String(sh.ownershipMilliPercent)}. Ownership is percent × 1000 as a whole number, so 85% ` +
          `is 85000 — a fraction here would put floating point directly into who owns what.`,
      );
    }
  }
  for (const [name, cents] of Object.entries(input.distributionsByShareholder)) {
    assertIntegerCents(cents, `distribution paid to ${name}`);
  }

  // D6: AN S CORPORATION HAS SHAREHOLDERS BY DEFINITION.
  //
  // An empty list used to be accepted, because the ownership check below is
  // guarded by `length > 0`. The result was an equity statement with AAA
  // computed and NO basis tracking at all — silently omitting the part that
  // decides whether a distribution is taxable. Found by attacking the engine
  // with inputs it was never asked about (standing rule 23).
  if (input.shareholders.length === 0) {
    refusals.push({
      code: "NO_SHAREHOLDERS",
      message:
        "No shareholders were provided. An S corporation has at least one owner by definition, and " +
        "without the register there is no stock basis to track — which is the number that decides " +
        "whether a distribution is tax-free or a capital gain.",
      whatToDo:
        `Provide the shareholder register for this period. For Greenway the split on file is ` +
        `${describeRoster()}.`,
      authorityIds: ["IRC_1367_STOCK_BASIS_ADJUSTMENTS"],
    });
  }

  // D2: DUPLICATE NAMES DOUBLE COUNT DISTRIBUTIONS.
  //
  // Two rows both named "A" each looked themselves up in
  // `distributionsByShareholder` and each claimed the FULL amount. The
  // rollforward tie check did not catch it, because it sums the lookup table
  // (one key) against the company total — both sides agreed while the
  // per-shareholder rows quietly doubled. That produces two K-1s reporting
  // distributions that were never made. A shareholder entered twice during a
  // register edit is the same class of error as the GRWNY/GRNWY typo on the
  // permanent failure corpus (standing rule 19).
  {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const sh of input.shareholders) {
      if (seen.has(sh.shareholderName)) duplicates.add(sh.shareholderName);
      seen.add(sh.shareholderName);
    }
    if (duplicates.size > 0) {
      refusals.push({
        code: "DUPLICATE_SHAREHOLDER",
        message:
          `${[...duplicates].join(", ")} appears more than once on the shareholder register. Each ` +
          `owner must appear exactly once, because every row looks up its own distributions by name — ` +
          `two rows with the same name would each claim the whole amount and report distributions on ` +
          `two K-1s that were only paid once.`,
        whatToDo:
          "Combine the duplicate entries into a single row with the owner's total percentage. If they " +
          "are genuinely two different people who share a name, distinguish them on the register (a " +
          "middle initial, or 'Jr.'), because the name is what the distribution is keyed to.",
        authorityIds: ["IRC_1367_STOCK_BASIS_ADJUSTMENTS", "IRC_1368_DISTRIBUTIONS_AAA"],
      });
    }
  }

  // D5: A NEGATIVE DISTRIBUTION IS NOT A THING.
  //
  // `distributionsCents: -100000` used to INCREASE basis and AAA out of
  // nothing. Money either left the company or it did not. A reversed
  // distribution is a CONTRIBUTION, which is already a separate input.
  if (input.distributionsCents < 0) {
    refusals.push({
      code: "NEGATIVE_EQUITY_MOVEMENT",
      message:
        `Distributions are recorded as ${formatCents(input.distributionsCents)}, a negative number. A ` +
        `distribution is money leaving the company; a negative one would silently ADD to stock basis ` +
        `and to AAA, inventing basis that was never paid for.`,
      whatToDo:
        "If an owner put money back in, record it as a contribution — that is a separate line and it " +
        "affects basis differently. If a distribution was recorded in error, correct the original " +
        "entry rather than posting a negative one on top of it.",
      authorityIds: ["IRC_1367_STOCK_BASIS_ADJUSTMENTS", "IRC_1368_DISTRIBUTIONS_AAA"],
    });
  }
  if (input.contributionsCents < 0) {
    refusals.push({
      code: "NEGATIVE_EQUITY_MOVEMENT",
      message:
        `Contributions are recorded as ${formatCents(input.contributionsCents)}, a negative number. A ` +
        `negative contribution is a distribution, and calling it the wrong thing changes how it is ` +
        `taxed.`,
      whatToDo:
        "Record money leaving the company as a distribution, on the distributions line, so it is " +
        "tested against stock basis under §1368.",
      authorityIds: ["IRC_1368_DISTRIBUTIONS_AAA"],
    });
  }

  // Ownership must total exactly 100%. In MILLI-PERCENT so 85% + 5% + 5% + 5%
  // is 85000 + 5000 + 5000 + 5000 = 100000 EXACTLY, with no floating point
  // anywhere near a number that decides who owns what.
  //
  // Note that totalling 100% does NOT mean the roster is right: the superseded
  // three-person register also totalled exactly 100000, which is why it went
  // unnoticed for forty-nine slices. See shareholder-roster-core.
  let ownership = 0;
  for (const s of input.shareholders) ownership += s.ownershipMilliPercent;
  if (input.shareholders.length > 0 && ownership !== 100000) {
    refusals.push({
      code: "OWNERSHIP_NOT_100_PCT",
      message:
        `Ownership adds up to ${formatMilliPercent(ownership)}, not 100%. Every dollar of an S ` +
        `corporation's income has to be allocated to somebody, so the percentages must total exactly 100.`,
      whatToDo:
        `Check the shareholder register. For Greenway the split on file is ${describeRoster()}. ` +
        `If that has changed, the change needs documenting before it is reported.`,
      authorityIds: ["IRC_1367_STOCK_BASIS_ADJUSTMENTS"],
    });
  }

  // THE ROLLFORWARD MUST TIE, TWO WAYS.
  //
  // (1) The distributions handed out shareholder-by-shareholder must add up to
  //     the entity-level distribution total. If they do not, either somebody is
  //     missing or somebody was paid twice, and both produce a wrong K-1 next
  //     year. Caught here rather than at the K-1 stage, because by then the
  //     number has already been reported to the government.
  //
  // (2) Every name PAID must be a shareholder of record. Paying a distribution
  //     to a name that holds no stock is either a payroll item wearing the
  //     wrong hat or a mis-keyed name — and a mis-keyed name is not
  //     hypothetical here: eighteen Greenway accounts were once tagged GRWNY
  //     instead of GRNWY and silently vanished from every filtered report
  //     (standing rule 19).
  {
    const namesOfRecord = new Set(input.shareholders.map((s) => s.shareholderName));
    let paidTotal = 0;
    const unknownNames: string[] = [];
    for (const [name, cents] of Object.entries(input.distributionsByShareholder)) {
      paidTotal += cents;
      if (!namesOfRecord.has(name)) unknownNames.push(name);
    }

    if (unknownNames.length > 0) {
      refusals.push({
        code: "ENTITY_MISMATCH",
        message:
          `A distribution was recorded to ${unknownNames.join(", ")}, who is not on the shareholder ` +
          `register for this period. Money left the company for somebody who does not own any of it.`,
        whatToDo:
          "Check the spelling against the shareholder register first — a name one character off is the " +
          "most common cause, and it is exactly how the GRWNY/GRNWY typo hid eighteen accounts. If the " +
          "name is right, then this was not a distribution: it was wages, a loan, or a reimbursement, " +
          "and it belongs in one of those accounts instead.",
        authorityIds: ["IRC_1368_DISTRIBUTIONS_AAA"],
      });
    }

    if (input.shareholders.length > 0 && paidTotal !== input.distributionsCents) {
      refusals.push({
        code: "EQUITY_ROLLFORWARD_DOES_NOT_TIE",
        message:
          `The distributions listed by shareholder come to ${formatCents(paidTotal)}, but the company ` +
          `recorded ${formatCents(input.distributionsCents)} of distributions for the period — a ` +
          `difference of ${formatCents(input.distributionsCents - paidTotal)}. One of those two numbers ` +
          `is wrong, and both of them feed next year's K-1s.`,
        whatToDo:
          "Pull the actual payments — checks, transfers, cash out of the safe — and list them by " +
          "person. Do NOT make the difference disappear by spreading it pro-rata across the owners: " +
          "not every shareholder is actually paid the distribution they are allocated, so a " +
          "pro-rata split would be wrong for several of the four shareholders and would " +
          "understate Michael's own draw.",
        authorityIds: ["IRC_1368_DISTRIBUTIONS_AAA", "IRC_1367_STOCK_BASIS_ADJUSTMENTS"],
      });
    }
  }

  // THE HARD BLOCK. §1368(b) or §1368(c)? Nobody knows until Michael produces
  // the Form 2553 and the CP261, so nobody gets a number (standing rule 14).
  if (input.hasAccumulatedEandP === null) {
    refusals.push({
      code: "EARNINGS_AND_PROFITS_UNKNOWN",
      message:
        "Nobody has confirmed whether the company carries accumulated earnings and profits from a " +
        "period before the S election. Until that is answered, the tax treatment of a distribution " +
        "cannot be computed: with no E&P the rules of §1368(b) apply, with E&P the very different " +
        "rules of §1368(c) apply, and the difference can be an unexpected dividend.",
      whatToDo:
        "Find the Form 2553 and the IRS acceptance letter (CP261) and confirm the date the S election " +
        "took effect. If the company has been an S corporation since formation and has never been " +
        "taxed as a C corporation, the answer is almost certainly no E&P — but it must be CONFIRMED " +
        "from the documents, not assumed, because this is the assumption that produces a surprise " +
        "dividend on a return.",
      authorityIds: ["IRC_1368_DISTRIBUTIONS_AAA"],
    });
  }

  if (refusals.length > 0) return refuse<EquityStatement>(refusals);

  const warnings: string[] = [];

  const shareholders: ShareholderEquityRow[] = input.shareholders.map((s) => {
    const allocatedIncomeCents = Math.trunc(
      (input.netIncomeCents * s.ownershipMilliPercent) / 100000,
    );
    const nonDeductibleExpenseCents = Math.trunc(
      (input.nonDeductibleExpenseCents * s.ownershipMilliPercent) / 100000,
    );
    // D4: `Object.hasOwn`, never a bare index.
    //
    // A shareholder named "constructor" (or "toString", "valueOf",
    // "hasOwnProperty") used to resolve UP THE PROTOTYPE CHAIN, so `?? 0` never
    // fired and this became a FUNCTION. The arithmetic below then produced NaN
    // and carried it into ending basis. Unlikely as a human name — but this is
    // a plain object used as a lookup table keyed by user-supplied strings,
    // which is exactly the shape of that bug, and it costs one line to close.
    const distributionsCents = Object.hasOwn(input.distributionsByShareholder, s.shareholderName)
      ? input.distributionsByShareholder[s.shareholderName]
      : 0;

    // §1368(d) ORDERING. Income first, then non-deductible expenses, and only
    // THEN are distributions tested against what is left. Testing distributions
    // before adding the year's income invents a capital gain out of nothing.
    const afterIncome = s.beginningBasisCents + allocatedIncomeCents;
    // §1367(a)(2) flush: "but not below zero" — stock basis HAS a floor.
    const afterNonDeductible = Math.max(0, afterIncome - nonDeductibleExpenseCents);
    const endingBasisCents = Math.max(0, afterNonDeductible - distributionsCents);
    // §1368(b)(2): the excess is gain from the sale or exchange of property.
    const gainOnExcessDistributionCents = Math.max(0, distributionsCents - afterNonDeductible);

    if (gainOnExcessDistributionCents > 0) {
      warnings.push(
        `${s.shareholderName} took ${formatCents(distributionsCents)} but only had ` +
          `${formatCents(afterNonDeductible)} of basis to take it against. Under §1368(b)(2) the excess ` +
          `of ${formatCents(gainOnExcessDistributionCents)} is a CAPITAL GAIN reportable on a personal ` +
          `return — tax owed in a year the money may already be spent. The §280E disallowed expenses ` +
          `are what ate the basis, which is how a cannabis owner ends up taxed on his own money coming ` +
          `back to him.`,
      );
    }

    return {
      shareholderName: s.shareholderName,
      ownershipMilliPercent: s.ownershipMilliPercent,
      beginningBasisCents: s.beginningBasisCents,
      allocatedIncomeCents,
      nonDeductibleExpenseCents,
      distributionsCents,
      endingBasisCents,
      gainOnExcessDistributionCents,
    };
  });

  // AAA — AND THERE IS NO Math.max(0, ...) HERE, ON PURPOSE.
  //
  // §1368(e)(1)(A) says the phrase "(but not below zero)" in §1367(a)(2) SHALL
  // BE DISREGARDED for the accumulated adjustments account. Stock basis has a
  // floor; AAA does not. Adding a zero floor here would look like a tidy fix
  // and would be a misstatement of the statute — and for a §280E business it
  // would hide the fact that AAA is deeply negative, which is the single most
  // informative number about how much the wall is really costing.
  const endingAaaCents =
    input.beginningAaaCents +
    input.netIncomeCents -
    input.nonDeductibleExpenseCents -
    input.distributionsCents;

  if (endingAaaCents < 0) {
    warnings.push(
      `Your Accumulated Adjustments Account is negative at ${formatCents(endingAaaCents)}. That is ` +
        `allowed — §1368(e)(1)(A) specifically removes the "not below zero" floor that applies to ` +
        `stock basis — but it is worth understanding. A negative AAA usually means non-deductible ` +
        `§280E expenses have exceeded the income allocated out, which is the structural condition of a ` +
        `cannabis retailer. Stock basis and AAA are NOT the same account and will not agree.`,
    );
  }

  const endingEquityCents =
    input.beginningEquityCents +
    input.netIncomeCents +
    input.contributionsCents -
    input.distributionsCents;

  return allow<EquityStatement>({
    entityCode: input.entityCode,
    fromDate: input.fromDate,
    toDate: input.toDate,
    beginningEquityCents: input.beginningEquityCents,
    netIncomeCents: input.netIncomeCents,
    distributionsCents: input.distributionsCents,
    contributionsCents: input.contributionsCents,
    endingEquityCents,
    shareholders,
    beginningAaaCents: input.beginningAaaCents,
    endingAaaCents,
    warnings,
  });
}

// ---------------------------------------------------------------------------
// 8) COMPARATIVE PERIODS
// ---------------------------------------------------------------------------

export type ComparativeLine = {
  key: string;
  label: string;
  currentCents: number;
  priorCents: number;
  varianceCents: number;
  /** Milli-percent, or null when the prior period is zero. */
  variancePctMilli: number | null;
};

/** Days from 1970-01-01 for a validated YYYY-MM-DD string. No Date objects. */
function epochDayOf(ymd: string): number {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  // Howard Hinnant's days-from-civil, in integers. No timezone, no drift.
  const yAdj = m <= 2 ? y - 1 : y;
  const era = Math.trunc(yAdj / 400);
  const yoe = yAdj - era * 400;
  const doy = Math.trunc((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.trunc(yoe / 4) - Math.trunc(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inclusive length of a period, in days. */
function periodLengthDays(fromDate: string, toDate: string): number {
  return epochDayOf(toDate) - epochDayOf(fromDate) + 1;
}

/**
 * Are these two statements even comparable?
 *
 * Two ways a variance report can be a confident lie:
 *
 *   1. DIFFERENT ENTITIES. Greenway against the ATM, or against the
 *      landholding company. Every subtotal adds up and the report is
 *      meaningless. Worse here than elsewhere, because the ATM is a Schedule C
 *      sole proprietorship and the retailer is an S corporation — they do not
 *      even share a tax return.
 *
 *   2. DIFFERENT PERIOD LENGTHS. A month against a quarter shows a 200%
 *      "increase" in sales that is really just more days. That is the error
 *      that makes an owner think something is wrong when nothing is — or, far
 *      worse, think nothing is wrong when something is.
 *
 * A three-day tolerance lets a 28-day February be compared with a 31-day
 * January, which is a comparison a retailer genuinely wants. Anything wider is
 * refused rather than footnoted (standing rule 27).
 */
export function comparabilityRefusal(
  current: IncomeStatement,
  prior: IncomeStatement,
): StatementRefusal | null {
  if (current.entityCode !== prior.entityCode) {
    return {
      code: "ENTITY_MISMATCH",
      message:
        `This compares "${current.entityCode}" against "${prior.entityCode}" — two different ` +
        `businesses. Every variance on the page would measure the gap between two companies rather ` +
        `than a change over time.`,
      whatToDo:
        "Compare each entity against its own prior period. Greenway, the ATM, the landholding company " +
        "and personal are four separate sets of books and they do not even share a tax return — the " +
        "ATM is a Schedule C, the retailer is an S corporation.",
      authorityIds: ["REG_SX_210_4_01_NOT_MISLEADING"],
    };
  }

  const curDays = periodLengthDays(current.fromDate, current.toDate);
  const priorDays = periodLengthDays(prior.fromDate, prior.toDate);
  if (Math.abs(curDays - priorDays) > 3) {
    return {
      code: "PERIOD_MISMATCH",
      message:
        `This compares ${curDays} days against ${priorDays} days. Every percentage on the page would ` +
        `be measuring the difference in length as if it were a change in the business.`,
      whatToDo:
        "Compare periods of the same length — month against month, quarter against quarter, year " +
        "against year. If you genuinely need to compare unequal periods, label the result a run rate, " +
        "because that is a different claim than a variance.",
      authorityIds: ["REG_SX_210_4_01_NOT_MISLEADING"],
    };
  }
  return null;
}

/**
 * Compare two income statements line by line.
 *
 * Lines are matched BY KEY, never by position. A prior period with one fewer
 * line — no excise contra that month, say — would shift every subsequent row
 * under positional matching and produce a variance report that is entirely
 * fictional while looking completely plausible.
 *
 * A line present in only one period still appears, with the missing side at
 * zero, because a line that appeared or disappeared is usually the single most
 * interesting fact on the whole comparison.
 */
export function compareIncomeStatements(
  current: IncomeStatement,
  prior: IncomeStatement,
): readonly ComparativeLine[] {
  const refusal = comparabilityRefusal(current, prior);
  if (refusal !== null) {
    throw new Error(`${refusal.code}: ${refusal.message} ${refusal.whatToDo}`);
  }

  const byKeyPrior = new Map(prior.lines.map((l) => [l.key, l]));
  const seen = new Set<string>();
  const out: ComparativeLine[] = [];

  for (const c of current.lines) {
    if (c.key === "the_280e_wall") continue;
    seen.add(c.key);
    const p = byKeyPrior.get(c.key);
    const priorCents = p ? p.amountCents : 0;
    const varianceCents = c.amountCents - priorCents;
    out.push({
      key: c.key,
      label: c.label,
      currentCents: c.amountCents,
      priorCents,
      varianceCents,
      variancePctMilli: shareInMilliPercent(varianceCents, Math.abs(priorCents)),
    });
  }

  for (const p of prior.lines) {
    if (p.key === "the_280e_wall" || seen.has(p.key)) continue;
    out.push({
      key: p.key,
      label: p.label,
      currentCents: 0,
      priorCents: p.amountCents,
      varianceCents: -p.amountCents,
      variancePctMilli: shareInMilliPercent(-p.amountCents, Math.abs(p.amountCents)),
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// 9) SELF-TESTS
// ---------------------------------------------------------------------------

function eq(actual: unknown, expected: unknown, what: string): void {
  if (actual !== expected) {
    throw new Error(
      `financial-statements-core self-test failed: ${what} — expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

/**
 * Self-tests that run inside the module, so a broken build fails loudly at the
 * point of use rather than quietly producing wrong statements.
 */
export function __runFinancialStatementsCoreTests(): void {
  // Money formatting, including the parenthesised negative of Reg S-X 4-01(c).
  eq(formatCents(0), "$0.00", "formatCents(0)");
  eq(formatCents(5), "$0.05", "formatCents(5)");
  eq(formatCents(100), "$1.00", "formatCents(100)");
  eq(formatCents(123456789), "$1,234,567.89", "formatCents(123456789)");
  eq(formatCents(-462469731), "($4,624,697.31)", "formatCents negative");

  // Percentages: null on a zero base, never a fake zero.
  eq(shareInMilliPercent(50, 0), null, "zero base yields null");
  eq(shareInMilliPercent(5000, 100000), 5000, "5% is 5000 milli-percent");

  // The 5% test is "in excess of": exactly 5% does NOT break out.
  eq(requiresSeparateDisclosure(5000, 100000), false, "exactly 5% is not a breakout");
  eq(requiresSeparateDisclosure(5001, 100000), true, "just over 5% is a breakout");

  // The wall covers every account type with no silent default.
  const types: AccountType[] = [
    "asset",
    "liability",
    "equity",
    "income",
    "cogs",
    "expense",
    "other_income",
    "other_expense",
  ];
  for (const t of types) {
    if (!ALL_WALL_SIDES.includes(wallSideOf(t))) {
      throw new Error(`financial-statements-core self-test failed: no wall side for ${t}`);
    }
  }
  eq(wallSideOf("cogs"), "above_the_line", "COGS is above the wall");
  eq(wallSideOf("expense"), "below_the_line", "operating expense is below the wall");

  // Period arithmetic, which the comparability gate depends on.
  eq(periodLengthDays("2026-07-01", "2026-07-31"), 31, "July is 31 days");
  eq(periodLengthDays("2026-02-01", "2026-02-28"), 28, "Feb 2026 is 28 days");
  eq(periodLengthDays("2024-02-01", "2024-02-29"), 29, "Feb 2024 is 29 days");
  eq(periodLengthDays("2026-01-01", "2026-12-31"), 365, "2026 is 365 days");
}
