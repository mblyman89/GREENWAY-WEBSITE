/**
 * src/lib/accounting/financial-statements-ui-core.ts   (books-42)
 *
 * EVERY DECISION THE FINANCIAL STATEMENTS SCREEN MAKES, IN A FILE A TEST CAN REACH.
 *
 * WHY THIS FILE EXISTS. A `page.tsx` cannot be unit tested in this repository —
 * the vitest include is `tests/compliance/` and a server component reaches the
 * database — so any rule that lives in JSX is a rule nothing checks. The page
 * that goes with this file is markup and nothing else.
 *
 * NOTHING HERE READS THE CLOCK, THE DATABASE, OR THE FILESYSTEM. Every input
 * arrives as an argument.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SITUATION THIS SLICE WALKED INTO
 * ─────────────────────────────────────────────────────────────────────────────
 * `financial-statements-core.ts` is 1,600 lines of finished, tested engine that
 * NOTHING COULD REACH. Zero imports from `src/app`, zero from `src/components`.
 * Its 132 tests passed every night and Michael could not see a single number
 * they produced. The books-38 gap report named it, and this slice closes it.
 *
 * Wiring an engine is not typing `import`. The engine asks for a `TrialBalance`
 * shape that the screens do not produce, and it asks for FACTS — which accounts
 * carry the excise, which liabilities are long-term, whether the corporation
 * has accumulated E&P — that the database does not hold. Every one of those is
 * handled here, in the open, as either an adapter or a named blocker.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS SLICE FOUND, AND WHY IT MATTERS MORE THAN THE SCREEN
 * ─────────────────────────────────────────────────────────────────────────────
 * `buildIncomeStatement` takes `exciseAccountCodes`. It then filters those codes
 * against EVERY row of the trial balance, not only the income and expense rows.
 *
 * Greenway's real chart of accounts (migration 0173) contains exactly one
 * account with the word "excise" in its name that carries the 37%:
 *
 *     32000  Cannabis Excise Tax Payable (37%) — TRUST      LIABILITY
 *
 * It is a LIABILITY, because RCW 69.50.535(4) makes the excise trust money and
 * this chart recognises revenue NET of it. There is no income-type or
 * expense-type excise account in Greenway's chart at all.
 *
 * So the single most natural thing anyone would ever do — pass the account
 * called "excise" as the excise account — was tested by execution against a
 * BALANCED trial balance, and produced this:
 *
 *     gross sales   $10,000.00
 *     net sales     $13,200.00      <-- NET SALES EXCEEDED GROSS SALES
 *     net income     $6,000.00      (the truth was $2,300.00)
 *
 * and nothing refused. The liability carries a CREDIT balance, so subtracting
 * it added. Worse, the same $3,700 remained in current liabilities on the
 * balance sheet, so one number was counted twice in opposite directions and the
 * balance sheet still tied.
 *
 * The engine's own tests never caught it because they use fictional codes
 * `4900` and `6900`, which are income and expense types. The engine was never
 * shown a chart like Michael's. That is standing rule 23 exactly: attack the
 * engine with the inputs it was never asked about.
 *
 * `assertRoleCodesAreProfitAndLoss()` below is the guard, and it runs BEFORE the
 * engine is called. It is not a comment. It throws, and a test proves it throws.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OTHER THING THIS FILE REFUSES TO DO
 * ─────────────────────────────────────────────────────────────────────────────
 * It will not invent a fact in order to render a statement.
 *
 * Three of the four statements need information the database does not hold:
 *
 *   • which liabilities are NON-CURRENT — a fact about the Wells Fargo loan
 *     terms, which Michael has not supplied;
 *   • the operating / investing / financing split for cash flow — nothing
 *     computes this today;
 *   • accumulated E&P, beginning AAA, and beginning stock basis per shareholder
 *     — Form 2553, CP261 and Schedule M-2, none of which are on file.
 *
 * A zero would render. A zero would also be a lie, and it would be a confident,
 * well-formatted, printable lie. So each becomes a `StatementBlocker` with the
 * document that answers it named, and the statement says what it cannot say.
 */

import {
  buildBalanceSheet,
  buildIncomeStatement,
  formatCents,
  type BalanceSheet,
  type IncomeStatement,
  type StatementLine,
  type StatementRefusal,
  type StatementRefusalCode,
  type StatementResult,
  type WallSide,
} from "./financial-statements-core";
import type {
  AccountType,
  NormalBalance,
  TrialBalance,
  TrialBalanceRow,
} from "./trial-balance-core";
import { isWrongSide, type TrialBalanceView } from "./books-ledger-guidance-core";
import type { ScreenTone } from "@/lib/ui/screen-tone-core";

// ---------------------------------------------------------------------------
// 1) THE HOUSE TONES.
//
// Same four the pay-run, 941 and WA quarterly screens use, for the same reason:
// a state that is CORRECT but wants attention has to look different from a
// state that is WRONG, or Michael learns to treat both the same way. There is
// no `--admin-warning` token in this codebase; gold and orange are the two
// intermediate tones that exist.
// ---------------------------------------------------------------------------

/**
 * BOOKS-46: NOW AN ALIAS. See `@/lib/ui/screen-tone-core` - this union was one
 * of four identical declarations under four different names (rules 23 and 25).
 */
export type FsTone = ScreenTone;

// ---------------------------------------------------------------------------
// 2) THE ADAPTER — and why it is not a one-liner.
//
// TWO TYPES IN THIS CODEBASE ARE CALLED A TRIAL BALANCE AND THEY ARE NOT THE
// SAME TYPE.
//
//   `TrialBalanceView` (books-ledger-guidance-core) is what the SCREENS build.
//       lines / foots / abnormalCount / unmappedAccountCodes
//       Each line knows its code, name, balance, debit, credit, nature and
//       whether it is abnormal. It does NOT know its ACCOUNT TYPE.
//
//   `TrialBalance` (trial-balance-core) is what the ENGINE demands.
//       rows / balanced / differenceCents / abnormalRows / lineCount
//       Each row MUST know its account type, because account type is the only
//       thing that decides which side of the §280E wall a dollar falls on.
//
// So the adapter has to re-join the chart of accounts. That join is the whole
// risk: an account the chart cannot explain has no type, and an account with no
// type cannot be placed above or below the wall. Guessing "expense" would move
// real money to the wrong side of a tax boundary worth roughly forty cents on
// the dollar.
//
// This adapter therefore does NOT guess. Unmapped accounts are returned
// separately and the screen refuses to present statements while any exist —
// which is the GRWNY/GRNWY typo corpus (standing rule 19) wearing a new hat:
// eighteen accounts, including the whole of payroll, once vanished from a
// report that looked perfectly healthy.
// ---------------------------------------------------------------------------

/** One account's classification, as the chart of accounts states it. */
export type FsAccountFact = {
  code: string;
  name: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  /** 0173 seeds this; `50900` and `50910` are the contra-revenue accounts. */
  isContra: boolean;
};

export type FsAdaptResult =
  | { ok: true; trialBalance: TrialBalance; unmappedAccountCodes: readonly [] }
  | { ok: false; trialBalance: null; unmappedAccountCodes: readonly string[] };

/**
 * Turn the screen's trial balance into the engine's trial balance.
 *
 * REFUSES when any account on the report is missing from the chart. It would be
 * easy to drop those rows and carry on — the totals would still foot, because
 * dropping a row keeps neither side — but the statement would then silently
 * omit money. It would be equally easy to default them to `expense`; that puts
 * them below the §280E wall, which is the most expensive possible guess.
 */
export function adaptTrialBalance(
  view: TrialBalanceView,
  facts: readonly FsAccountFact[],
  entityCode: string,
  fromDate: string,
  toDate: string,
): FsAdaptResult {
  const byCode = new Map(facts.map((f) => [f.code, f]));

  const unmapped: string[] = [];
  for (const l of view.lines) if (!byCode.has(l.accountCode)) unmapped.push(l.accountCode);
  if (unmapped.length > 0 || view.unmappedAccountCodes.length > 0) {
    const all = new Set([...unmapped, ...view.unmappedAccountCodes]);
    return { ok: false, trialBalance: null, unmappedAccountCodes: [...all].sort() };
  }

  const rows: TrialBalanceRow[] = view.lines.map((l) => {
    // Non-null assertion is safe: the loop above proved every code is present.
    const f = byCode.get(l.accountCode) as FsAccountFact;
    return {
      accountCode: l.accountCode,
      accountName: l.accountName,
      accountType: f.accountType,
      normalBalance: f.normalBalance,
      balanceCents: l.balanceCents,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      // The screen's view does not carry a per-account line count. One is the
      // honest floor: this row exists, so at least one line produced it.
      // Deliberately NOT zero, which would read as "no evidence".
      lineCount: 1,
      // Recomputed from the SAME function the ledger scanner and the trial
      // balance screen use, rather than trusting the flag that arrived. One
      // definition of "abnormal", three screens.
      isAbnormal: isWrongSide(l.balanceCents, f.normalBalance),
    };
  });

  let totalDebitCents = 0;
  let totalCreditCents = 0;
  for (const r of rows) {
    totalDebitCents += r.debitCents;
    totalCreditCents += r.creditCents;
  }

  return {
    ok: true,
    unmappedAccountCodes: [],
    trialBalance: {
      entityCode,
      fromDate,
      toDate,
      rows,
      totalDebitCents,
      totalCreditCents,
      balanced: totalDebitCents === totalCreditCents,
      differenceCents: totalDebitCents - totalCreditCents,
      abnormalRows: rows.filter((r) => r.isAbnormal),
      lineCount: rows.length,
    },
  };
}

// ---------------------------------------------------------------------------
// 3) THE ROLE GUARD — the defect described in the header.
// ---------------------------------------------------------------------------

/** Account types that can legitimately appear on an income statement. */
export const PROFIT_AND_LOSS_TYPES: readonly AccountType[] = [
  "income",
  "cogs",
  "expense",
  "other_income",
  "other_expense",
];

export function isProfitAndLossType(t: AccountType): boolean {
  return (PROFIT_AND_LOSS_TYPES as readonly string[]).includes(t);
}

/**
 * Refuse a balance-sheet account being offered as an excise or contra-revenue
 * code, BEFORE the engine is called.
 *
 * THE PROOF THIS IS NEEDED, from a probe run against the real chart:
 *
 *     exciseAccountCodes: ["32000"]        // the trust LIABILITY
 *     -> gross sales $10,000.00
 *     -> net sales   $13,200.00            // net exceeded gross
 *     -> net income   $6,000.00            // the truth was $2,300.00
 *     -> nothing refused
 *
 * A liability carries a credit balance, and the engine presents excise on the
 * DEBIT side, so subtracting it added. The same $3,700 also stayed in current
 * liabilities, so it was counted twice in opposite directions on two statements
 * that both tied.
 *
 * Throws rather than returning a refusal on purpose. A caller that supplies a
 * liability as the excise account has a configuration error, not a data
 * problem, and it must be fixed in the chart rather than displayed as a card.
 */
export function assertRoleCodesAreProfitAndLoss(
  codes: readonly string[],
  facts: readonly FsAccountFact[],
  role: "excise" | "contra-revenue",
): void {
  const byCode = new Map(facts.map((f) => [f.code, f]));
  const offenders: string[] = [];
  for (const c of codes) {
    const f = byCode.get(c);
    if (f && !isProfitAndLossType(f.accountType)) {
      offenders.push(`${f.code} ${f.name} (${f.accountType})`);
    }
  }
  if (offenders.length === 0) return;

  throw new Error(
    `FS_ROLE_CODE_NOT_PROFIT_AND_LOSS: ${offenders.join("; ")} was offered as ${
      role === "excise" ? "the excise account" : "a contra-revenue account"
    }, but it is a balance sheet account. Subtracting a credit balance from sales ADDS to it: a ` +
      `test of exactly this produced net sales of $13,200.00 against gross sales of $10,000.00 and ` +
      `nothing objected. Washington's 37% excise is trust money under RCW 69.50.535(4) and this ` +
      `chart already recognises revenue net of it, so there is no excise line on the income ` +
      `statement at all — account 32000 belongs in current liabilities and nowhere else.`,
  );
}

/**
 * The contra-revenue codes, taken from the chart rather than typed in.
 *
 * `gl_accounts.is_contra` is a real column (migration 0172) and 0173 seeds it
 * true on `50900 Discounts & Comps` and `50910 Returns & Refunds`. Reading the
 * flag means the day Michael adds a third contra account it appears here
 * automatically, instead of being silently treated as ordinary revenue.
 *
 * Filtered to income types deliberately: `20810 Inventory Shrink / Waste
 * Reserve` and `41000 Shareholder Distributions` are also contra, and neither
 * is a customer discount.
 */
export function contraRevenueCodesFrom(facts: readonly FsAccountFact[]): readonly string[] {
  return facts
    .filter((f) => f.isContra && f.accountType === "income")
    .map((f) => f.code)
    .sort();
}

/**
 * The excise codes, taken from the chart rather than typed in.
 *
 * Returns EMPTY for Greenway, and that is the correct answer, not a gap. This
 * function exists so the emptiness is DERIVED and stays true if the chart
 * changes, rather than being a hard-coded `[]` that nobody revisits.
 */
export function exciseCodesFrom(facts: readonly FsAccountFact[]): readonly string[] {
  return facts
    .filter((f) => isProfitAndLossType(f.accountType) && /excise/i.test(f.name))
    .map((f) => f.code)
    .sort();
}

// ---------------------------------------------------------------------------
// 4) BLOCKERS — the facts only Michael can supply.
//
// A blocker is not an error. It is a question with a document attached. The
// difference matters: an error says the system is broken, a blocker says the
// system is waiting, and waiting is the correct state for a statement whose
// inputs genuinely do not exist yet.
// ---------------------------------------------------------------------------

export type FsStatementId = "income" | "balance" | "cash_flow" | "equity";

export type StatementBlocker = {
  statement: FsStatementId;
  /** Short enough to be a card heading. */
  what: string;
  /** Why the statement cannot honestly be produced without it. */
  why: string;
  /** The actual document that answers it. Never "ask your accountant". */
  whereToGetIt: string;
  authorityIds: readonly string[];
};

/**
 * What is missing, given what is on file.
 *
 * Deliberately takes booleans rather than reading anything. "Do we know the E&P
 * answer" is a fact the store establishes; whether that makes the equity
 * statement renderable is a decision, and decisions live here where tests can
 * reach them.
 */
export type FsFactsOnFile = {
  /** Has Michael stated which liabilities are long-term? */
  nonCurrentClassificationSupplied: boolean;
  /** Does anything compute the operating/investing/financing split? */
  cashFlowActivitySplitSupplied: boolean;
  /** Form 2553 + CP261. `null` means unknown, which REFUSES. */
  hasAccumulatedEandP: boolean | null;
  /** Schedule M-2, line 8, prior year. */
  beginningAaaSupplied: boolean;
  /** Beginning stock basis for all four shareholders. */
  beginningBasisSupplied: boolean;
};

export function blockersFor(facts: FsFactsOnFile): readonly StatementBlocker[] {
  const out: StatementBlocker[] = [];

  if (!facts.nonCurrentClassificationSupplied) {
    out.push({
      statement: "balance",
      what: "Which debts are long-term",
      why:
        "Current versus long-term is a fact about WHEN money is due, and it cannot be read off an " +
        "account number. Until it is stated, every liability shows as current — which makes the " +
        "business look far tighter than it is, because the Wells Fargo balance appears as though " +
        "all of it were payable this year.",
      whereToGetIt:
        "The Wells Fargo loan agreement: the amortisation schedule shows how much principal falls " +
        "due within twelve months of the balance sheet date. That portion is current; the rest is not.",
      authorityIds: ["REG_SX_210_5_02_BALANCE_SHEET_ORDER"],
    });
  }

  if (!facts.cashFlowActivitySplitSupplied) {
    out.push({
      statement: "cash_flow",
      what: "The operating, investing and financing split",
      why:
        "The cash flow statement proves that the cash you started with, plus everything that moved, " +
        "equals the cash you actually counted. Nothing in the books tags a movement as operating, " +
        "investing or financing yet, so the three totals would have to be invented — and inventing " +
        "them would defeat the only statement whose whole job is to be checkable against a counted drawer.",
      whereToGetIt:
        "This is engineering work rather than paperwork: the general ledger needs an activity tag " +
        "per journal source. It is the next natural slice after this one.",
      authorityIds: ["ASC_230_10_45_7_GROSS_NOT_NET"],
    });
  }

  if (facts.hasAccumulatedEandP === null) {
    out.push({
      statement: "equity",
      what: "Whether the company has accumulated earnings and profits",
      why:
        "This single yes/no decides whether distributions are governed by §1368(b) or §1368(c), and " +
        "those are materially different tax outcomes for you personally. Guessing 'probably not' " +
        "would be the most expensive assumption in this system, so the engine refuses instead.",
      whereToGetIt:
        "Form 2553 (the S election) and the IRS acceptance letter CP261. If the company has been an " +
        "S corporation since formation and never operated as a C corporation, the answer is no — but " +
        "it needs to be the letter that says so, not a recollection.",
      authorityIds: ["IRC_1368_DISTRIBUTIONS_AAA"],
    });
  }

  if (!facts.beginningAaaSupplied) {
    out.push({
      statement: "equity",
      what: "The accumulated adjustments account at the start of the year",
      why:
        "AAA is the running total that decides how much can come out tax-free. It is not the same as " +
        "your stock basis and it is not retained earnings — §1368(e)(1)(A) removes the 'but not below " +
        "zero' floor that basis has, so AAA can go negative while basis cannot.",
      whereToGetIt:
        "The prior year's Form 1120-S, Schedule M-2, ending balance in the AAA column. That figure " +
        "carries forward and becomes this year's opening balance.",
      authorityIds: ["IRC_1368_DISTRIBUTIONS_AAA"],
    });
  }

  if (!facts.beginningBasisSupplied) {
    out.push({
      statement: "equity",
      what: "Each shareholder's stock basis at the start of the year",
      why:
        "Basis is what makes a distribution tax-free. Once it reaches zero every further dollar taken " +
        "out is a capital gain — tax owed in a year the money is already spent. §280E expenses burn " +
        "basis down even in a profitable year, which is why this matters more here than at an " +
        "ordinary business.",
      whereToGetIt:
        "Each shareholder's own basis schedule, now Form 7203. It is a personal record rather than a " +
        "company one, which is exactly why it is so often missing.",
      authorityIds: ["IRC_1367_STOCK_BASIS_ADJUSTMENTS"],
    });
  }

  return out;
}

export function blockersForStatement(
  blockers: readonly StatementBlocker[],
  statement: FsStatementId,
): readonly StatementBlocker[] {
  return blockers.filter((b) => b.statement === statement);
}

// ---------------------------------------------------------------------------
// 5) READINESS — one honest word per statement.
// ---------------------------------------------------------------------------

export type FsReadiness = "ready" | "blocked" | "refused";

export type FsStatementCard = {
  id: FsStatementId;
  title: string;
  /** The QUESTION this statement answers. Michael asked to be taught this. */
  question: string;
  readiness: FsReadiness;
  tone: FsTone;
  /** One sentence saying where this stands. */
  status: string;
  blockers: readonly StatementBlocker[];
};

export function readinessTone(r: FsReadiness): FsTone {
  if (r === "ready") return "green";
  if (r === "blocked") return "gold";
  return "danger";
}

/**
 * The question each statement answers.
 *
 * This exists because of the exact thing Michael asked for: he wanted the
 * statements to be "a tool rather than a piece of paper with numbers on it".
 * A statement you cannot state the question for is a piece of paper. Putting
 * the question at the top of every card is the cheapest possible way to make
 * the tool visible.
 */
export const STATEMENT_QUESTIONS: Readonly<Record<FsStatementId, string>> = {
  income: "Did the business make money over this period — and how much of that will actually be taxed?",
  balance: "What does the business own and owe at this exact moment?",
  cash_flow: "Where did the cash actually go, and does it agree with what I counted?",
  equity: "What is my stake worth, and can I take money out without triggering a tax bill?",
};

export const STATEMENT_TITLES: Readonly<Record<FsStatementId, string>> = {
  income: "Income statement",
  balance: "Balance sheet",
  cash_flow: "Statement of cash flows",
  equity: "Statement of equity, basis and AAA",
};

export function statementCards(
  incomeResult: StatementResult<IncomeStatement> | null,
  balanceResult: StatementResult<BalanceSheet> | null,
  blockers: readonly StatementBlocker[],
): readonly FsStatementCard[] {
  const card = (
    id: FsStatementId,
    result: StatementResult<unknown> | null,
  ): FsStatementCard => {
    const mine = blockersForStatement(blockers, id);
    let readiness: FsReadiness;
    let status: string;

    if (result !== null && !result.ok) {
      readiness = "refused";
      status = result.refusals[0]?.message ?? "This statement cannot be produced.";
    } else if (mine.length > 0) {
      readiness = "blocked";
      status =
        mine.length === 1
          ? `Waiting on one thing: ${mine[0].what.toLowerCase()}.`
          : `Waiting on ${mine.length} things before this can be produced honestly.`;
    } else if (result !== null && result.ok) {
      readiness = "ready";
      status = "Produced from the ledger, and it ties.";
    } else {
      readiness = "blocked";
      status = "Nothing has been produced for this period yet.";
    }

    return {
      id,
      title: STATEMENT_TITLES[id],
      question: STATEMENT_QUESTIONS[id],
      readiness,
      tone: readinessTone(readiness),
      status,
      blockers: mine,
    };
  };

  return [
    card("income", incomeResult),
    card("balance", balanceResult),
    card("cash_flow", null),
    card("equity", null),
  ];
}

// ---------------------------------------------------------------------------
// 6) PRESENTING THE INCOME STATEMENT — the wall, and what sits either side.
// ---------------------------------------------------------------------------

export type FsRow = {
  key: string;
  label: string;
  /** Pre-formatted, because formatting money is a decision too. */
  amount: string;
  amountCents: number;
  wallSide: WallSide;
  isSubtotal: boolean;
  /** True for the literal wall line, which renders as a rule not a number. */
  isWall: boolean;
  indent: number;
  authorityIds: readonly string[];
};

/** The engine's own key for the §280E wall line. Matched, never re-invented. */
export const WALL_LINE_KEY = "the_280e_wall";

export function incomeRows(statement: IncomeStatement): readonly FsRow[] {
  return statement.lines.map((l: StatementLine) => ({
    key: l.key,
    label: l.label,
    amount: l.key === WALL_LINE_KEY ? "" : formatCents(l.amountCents),
    amountCents: l.amountCents,
    wallSide: l.wallSide,
    isSubtotal: l.isSubtotal,
    isWall: l.key === WALL_LINE_KEY,
    indent: l.indent,
    authorityIds: l.authorityIds,
  }));
}

/**
 * How much of the spending below the wall bought nothing back in tax relief.
 *
 * This is the number Michael needs and no statement prints on its own: the
 * dollars that are genuinely, legally spent and genuinely, legally
 * non-deductible. Expressed as cents so the caller formats it once.
 */
export function disallowedSpendCents(statement: IncomeStatement): number {
  return statement.taxBridge.disallowedDeductionsCents;
}

/**
 * The gap between what the books say you earned and what the tax code says.
 *
 * Positive means tax is computed on MORE than you actually made. For a §280E
 * business this is the normal case, and it is the single most surprising fact
 * about cannabis accounting for anyone seeing it for the first time.
 */
export function bookToTaxGapCents(statement: IncomeStatement): number {
  return statement.taxBridge.grossIncomeCents - statement.taxBridge.bookNetIncomeCents;
}

/**
 * Is this a period where the books show a LOSS but tax is still owed?
 *
 * The cruellest arithmetic in the industry, and the reason a cannabis retailer
 * cannot read an income statement the way anybody else reads one.
 */
export function losingMoneyButStillTaxed(statement: IncomeStatement): boolean {
  return statement.netIncomeCents < 0 && statement.grossIncomeCents > 0;
}

// ---------------------------------------------------------------------------
// 7) THE RATIOS A CPA ACTUALLY RUNS.
//
// Michael asked to be taught how to READ these statements, not just what they
// are. Reading a statement means running a small number of checks in a fixed
// order and knowing what the answers should look like. That is what this
// section is: the checks, with the thresholds that apply to a WASHINGTON
// CANNABIS RETAILER rather than to a business in general.
//
// EVERY RATIO IS INTEGER ARITHMETIC IN BASIS POINTS (1% = 100 bp). No floats
// anywhere near money or the percentages derived from it. A ratio whose
// denominator is zero returns `null` — not zero, because "there is no answer"
// and "the answer is nothing" are different statements, and a confident 0.0%
// on a report is a lie that looks like data.
// ---------------------------------------------------------------------------

/** One percent, expressed in the basis points this module uses. */
export const ONE_PERCENT_BP = 100;

/**
 * `part / whole` in basis points, rounded half away from zero.
 *
 * Integer only. `Math.round` is applied to an integer quotient computed by
 * multiplying first, so no floating point value ever holds a money figure.
 */
export function basisPoints(partCents: number, wholeCents: number): number | null {
  if (!Number.isInteger(partCents) || !Number.isInteger(wholeCents)) {
    throw new Error(
      `FS_RATIO_NOT_INTEGER: basisPoints received ${String(partCents)} / ${String(wholeCents)}. ` +
        "Ratios are computed from whole cents, because a fraction here means a float touched money upstream.",
    );
  }
  if (wholeCents === 0) return null;
  const scaled = (partCents * 10_000) / wholeCents;
  return Math.round(scaled);
}

/** Render basis points as a percentage string, without ever touching a float on money. */
export function formatBasisPoints(bp: number | null): string {
  if (bp === null) return "—";
  const neg = bp < 0;
  const abs = Math.abs(bp);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  return `${neg ? "-" : ""}${whole}.${String(frac).padStart(2, "0")}%`;
}

export type FsRatingBand = "healthy" | "watch" | "concern" | "unknown";

export type FsRatio = {
  key: string;
  label: string;
  /** In basis points, or null when the denominator is zero. */
  valueBp: number | null;
  display: string;
  /** What this number MEANS, in Michael's language. */
  meaning: string;
  /** What a good answer looks like for a WA cannabis retailer specifically. */
  goodLooksLike: string;
  band: FsRatingBand;
  tone: FsTone;
};

export function bandTone(b: FsRatingBand): FsTone {
  if (b === "healthy") return "green";
  if (b === "watch") return "gold";
  if (b === "concern") return "orange";
  return "neutral";
}

/**
 * Band a ratio where HIGHER IS BETTER.
 *
 * Boundaries are inclusive at the healthy end on purpose: a gross margin of
 * exactly the target is healthy, not "watch". A test pins both sides.
 */
export function bandHigherIsBetter(
  valueBp: number | null,
  healthyAtOrAboveBp: number,
  watchAtOrAboveBp: number,
): FsRatingBand {
  if (valueBp === null) return "unknown";
  if (valueBp >= healthyAtOrAboveBp) return "healthy";
  if (valueBp >= watchAtOrAboveBp) return "watch";
  return "concern";
}

/** Band a ratio where LOWER IS BETTER. */
export function bandLowerIsBetter(
  valueBp: number | null,
  healthyAtOrBelowBp: number,
  watchAtOrBelowBp: number,
): FsRatingBand {
  if (valueBp === null) return "unknown";
  if (valueBp <= healthyAtOrBelowBp) return "healthy";
  if (valueBp <= watchAtOrBelowBp) return "watch";
  return "concern";
}

/**
 * The four income statement ratios, in the order a CPA runs them.
 *
 * ORDER IS THE TEACHING. Gross margin first, because §280E means it is the only
 * margin that reduces tax. Then the wall ratio, which is the number that has no
 * equivalent at a normal business. Then operating expenses against sales. Net
 * margin LAST, deliberately — it is the number every owner looks at first and
 * it is the least informative one on a cannabis income statement.
 */
export function incomeRatios(statement: IncomeStatement): readonly FsRatio[] {
  const net = statement.netSalesCents;

  const grossMarginBp = basisPoints(statement.grossIncomeCents, net);
  const wallBp = basisPoints(statement.taxBridge.disallowedDeductionsCents, net);
  const opexBp = basisPoints(statement.operatingExpensesCents, net);
  const netMarginBp = basisPoints(statement.netIncomeCents, net);

  const mk = (
    key: string,
    label: string,
    valueBp: number | null,
    meaning: string,
    goodLooksLike: string,
    band: FsRatingBand,
  ): FsRatio => ({
    key,
    label,
    valueBp,
    display: formatBasisPoints(valueBp),
    meaning,
    goodLooksLike,
    band,
    tone: bandTone(band),
  });

  return [
    mk(
      "gross_margin",
      "Gross margin",
      grossMarginBp,
      "Of every dollar of net sales, this much is left after paying for the product itself. For you " +
        "this is not one metric among many — it is the ONLY part of your income statement that " +
        "reduces the tax bill, because §280E allows cost of goods sold and denies everything else.",
      "A Washington retailer buying at wholesale usually lands between 40% and 50%. Below 35% and " +
        "either purchasing has slipped or shrinkage is being absorbed into cost quietly.",
      bandHigherIsBetter(grossMarginBp, 4000, 3500),
    ),
    mk(
      "disallowed_spend",
      "Spending §280E disallows",
      wallBp,
      "Of every dollar of net sales, this much was spent below the wall — rent, wages that are not " +
        "inventoriable, marketing, insurance, professional fees. Real money, out of the door, with " +
        "no deduction attached. At an ordinary business this figure does not exist.",
      "Every point you move from below the wall to above it — legitimately, with documentation — is " +
        "worth roughly forty cents on the dollar. Below 25% of net sales is tight operating; above " +
        "35% and the tax on money you did not keep starts to hurt.",
      bandLowerIsBetter(wallBp, 2500, 3500),
    ),
    mk(
      "opex_ratio",
      "Operating expenses to sales",
      opexBp,
      "What it costs to keep the doors open, as a share of sales. Read this next to the line above " +
        "it: the two are nearly the same money seen from two angles, one asking 'is it affordable' " +
        "and the other asking 'is it deductible'.",
      "Stable is more important than low. A ratio that moves more than a few points month to month " +
        "usually means something was posted to the wrong period rather than that costs changed.",
      bandLowerIsBetter(opexBp, 2500, 3500),
    ),
    mk(
      "net_margin",
      "Net margin (book)",
      netMarginBp,
      "What the books say you kept. Listed LAST on purpose. This is the number every owner looks at " +
        "first and it is the least useful one you have, because it is computed after deductions the " +
        "IRS will not allow. You can show a loss here and still owe substantial federal tax.",
      "Judge it against gross margin, never on its own. If net margin is falling while gross margin " +
        "holds, the problem is below the wall — and below the wall is where a dollar saved is worth " +
        "the most, because it was never going to be deductible anyway.",
      bandHigherIsBetter(netMarginBp, 500, 0),
    ),
  ];
}

/**
 * The balance sheet ratios.
 *
 * Only two, and that is deliberate. A small retailer with no receivables and no
 * fixed assets does not need a page of them; it needs to know whether it can
 * pay next month's bills and how much of the business is borrowed.
 */
export function balanceRatios(sheet: BalanceSheet): readonly FsRatio[] {
  const currentRatioBp = basisPoints(
    sheet.currentAssets.totalCents,
    sheet.currentLiabilities.totalCents,
  );
  const debtToAssetsBp = basisPoints(sheet.totalLiabilitiesCents, sheet.totalAssetsCents);

  const mk = (
    key: string,
    label: string,
    valueBp: number | null,
    meaning: string,
    goodLooksLike: string,
    band: FsRatingBand,
  ): FsRatio => ({
    key,
    label,
    valueBp,
    display: formatBasisPoints(valueBp),
    meaning,
    goodLooksLike,
    band,
    tone: bandTone(band),
  });

  return [
    mk(
      "current_ratio",
      "Current ratio",
      currentRatioBp,
      "What you could pay with, against what falls due within the year. Shown as a percentage: 200% " +
        "means you hold two dollars of short-term assets for every dollar of short-term debt.",
      "Above 150% is comfortable. Below 100% means the next twelve months of bills exceed everything " +
        "you could turn into cash — which for a business that cannot borrow from a bank is the single " +
        "most dangerous position on this page. Note that trust money you are HOLDING for the state " +
        "sits in these liabilities: it is not yours, and this ratio is honest about that.",
      bandHigherIsBetter(currentRatioBp, 15_000, 10_000),
    ),
    mk(
      "debt_to_assets",
      "Debt to assets",
      debtToAssetsBp,
      "How much of everything the business owns is really owed to somebody else — lenders, vendors, " +
        "and the state.",
      "Below 50% is a business that owns itself. Above 70% and most of what is on the shelf has " +
        "already been claimed by somebody. Remember that a chunk of it is excise and sales tax held " +
        "in trust, which was never yours in the first place.",
      bandLowerIsBetter(debtToAssetsBp, 5000, 7000),
    ),
  ];
}

/**
 * TRUST MONEY, SEPARATED OUT.
 *
 * RCW 69.50.535(4) makes the 37% excise money the buyer paid you to hold for
 * the LCB. The sales tax is the same. It sits in your bank account and it is
 * not your money, which is why a healthy-looking cash balance can still be a
 * business that cannot pay its bills.
 *
 * This is not a ratio; it is the single most useful thing the balance sheet can
 * tell a cash-heavy cannabis retailer, and no standard statement layout shows it.
 */
export function trustMoneyHeldCents(
  sheet: BalanceSheet,
  trustAccountCodes: readonly string[],
): number {
  const trust = new Set(trustAccountCodes);
  let total = 0;
  for (const l of [...sheet.currentLiabilities.lines, ...sheet.nonCurrentLiabilities.lines]) {
    if (l.accountCodes.some((c) => trust.has(c))) total += l.amountCents;
  }
  return total;
}

/**
 * The trust accounts in Greenway's chart, derived from the chart itself.
 *
 * `32000` excise and `32100` retail sales tax. Both are described in 0173 as
 * "CONTROL + TRUST". Derived by name rather than hard-coded so a new trust
 * account cannot silently escape the calculation.
 */
export function trustAccountCodesFrom(facts: readonly FsAccountFact[]): readonly string[] {
  return facts
    .filter((f) => f.accountType === "liability" && /TRUST/.test(f.name))
    .map((f) => f.code)
    .sort();
}

// ---------------------------------------------------------------------------
// 8) THE READING ORDER.
//
// Michael's request, verbatim: he wants to know "how best to read them, to use
// them as a tool rather than a piece of paper with numbers on them."
//
// So this is the order, as data rather than prose, so the screen renders it and
// a test can prove the screen did not drop a step. It is the order a CPA
// actually uses on a client's monthly pack, adapted for §280E.
// ---------------------------------------------------------------------------

export type ReadingStep = {
  step: number;
  statement: FsStatementId;
  /** What to look at. */
  look: string;
  /** The question to ask while looking at it. */
  ask: string;
  /** What a bad answer looks like, and what it usually means. */
  ifItLooksWrong: string;
};

export const READING_ORDER: readonly ReadingStep[] = [
  {
    step: 1,
    statement: "balance",
    look: "The abnormal balances panel, before any other number on any statement.",
    ask:
      "Is anything sitting on the wrong side — cash in credit, inventory negative? Those are " +
      "impossible in the real world, so they mean the books are wrong rather than the business is.",
    ifItLooksWrong:
      "Negative inventory is almost always a sale posted before the receipt of the goods. Negative " +
      "cash is almost always a deposit dated a day late or a payment entered twice. Fix it before " +
      "you read anything else, because every statement below inherits it.",
  },
  {
    step: 2,
    statement: "income",
    look: "Gross margin — net sales less cost of goods sold, as a percentage.",
    ask:
      "Is it where it was last month? This is the only margin §280E lets you keep, so a slip here " +
      "costs you twice: once in cash, and again because the relief it would have given is gone.",
    ifItLooksWrong:
      "A falling gross margin with steady sales is usually purchasing, shrinkage, or discounting " +
      "that nobody signed off. Check the discounts and comps account before you blame the vendors.",
  },
  {
    step: 3,
    statement: "income",
    look: "The §280E wall line, and the total of everything below it.",
    ask:
      "How much did I spend that buys me nothing back? That total, multiplied by your tax rate, is " +
      "the extra tax you pay purely for being in this industry.",
    ifItLooksWrong:
      "If the total below the wall is growing faster than sales, look for costs that could " +
      "LEGITIMATELY sit above it — inventoriable labour is the usual candidate — and then " +
      "document the reason before moving anything. Never move an account to change an outcome.",
  },
  {
    step: 4,
    statement: "income",
    look: "The tax bridge memo at the foot of the income statement.",
    ask:
      "What is the gap between what the books say I earned and what I will be taxed on? For a " +
      "cannabis retailer that gap is the whole story.",
    ifItLooksWrong:
      "If book net income is negative and gross income is positive, you are losing money and paying " +
      "tax at the same time. That is not a bug in the report; it is §280E working as written, and " +
      "it is the situation to take to a planning conversation rather than an accounting one.",
  },
  {
    step: 5,
    statement: "balance",
    look: "Trust money held — excise and sales tax you are holding for the state.",
    ask:
      "How much of the cash on hand is not mine? Subtract it mentally from the bank balance before " +
      "you decide the business can afford anything.",
    ifItLooksWrong:
      "If trust liabilities are growing while cash is flat, the trust money is being spent on " +
      "operations. That is the most common way a cash business dies, and it is a slow one — the " +
      "shortfall does not become visible until the return is due.",
  },
  {
    step: 6,
    statement: "cash_flow",
    look: "Ending cash on the statement against the cash you physically counted.",
    ask: "Do they agree to the cent?",
    ifItLooksWrong:
      "A difference is never rounding. It is an unrecorded transaction or money that left the " +
      "building. Count again, then look for a vendor paid from the till, an owner draw taken in " +
      "cash, an ATM refill, or a deposit dated a day off. It is almost always one of those five.",
  },
  {
    step: 7,
    statement: "equity",
    look: "Your own stock basis, and how far it has to fall before it reaches zero.",
    ask:
      "If I keep taking money out at this rate, when does a distribution become a capital gain?",
    ifItLooksWrong:
      "Basis heading toward zero is a conversation to have BEFORE you take the money, not in April. " +
      "The usual answer is to shift some of what you take from distributions to payroll, which is " +
      "deductible to the company and does not consume basis.",
  },
];

/** Every step that concerns one statement, in order. */
export function readingStepsFor(statement: FsStatementId): readonly ReadingStep[] {
  return READING_ORDER.filter((s) => s.statement === statement);
}

// ---------------------------------------------------------------------------
// 9) REFUSALS, ON SCREEN.
// ---------------------------------------------------------------------------

export type FsRefusalCard = {
  code: string;
  headline: string;
  body: string;
  whatToDo: string;
  authorityIds: readonly string[];
};

export function refusalCard(r: StatementRefusal): FsRefusalCard {
  return {
    code: r.code,
    headline: REFUSAL_HEADLINES[r.code] ?? "This statement cannot be produced.",
    body: r.message,
    whatToDo: r.whatToDo,
    authorityIds: r.authorityIds,
  };
}

/**
 * A short headline per refusal code.
 *
 * The engine's `message` is the full explanation and it is often three lines
 * long. A card needs something readable at a glance above it. Every code the
 * engine can emit has an entry, and a coverage gate proves it — a refusal that
 * falls through to a generic headline is a refusal Michael skims past.
 *
 * THE TYPE IS DELIBERATELY `Record<StatementRefusalCode, string>` AND NOT
 * `Record<string, string>`. Two things now have to agree before this ships: the
 * compiler, which will not let the object be missing a key, and the runtime
 * coverage test, which reads `ALL_STATEMENT_REFUSAL_CODES`. That redundancy is
 * on purpose. The compiler catches the day someone adds a code to the union;
 * the test catches the day someone adds a code to the exported ARRAY and
 * forgets the union, which the compiler would happily allow. Written the loose
 * way, this map was missing `PERIOD_MISMATCH` and nothing complained until the
 * gate was written — which is standing rule 39 in miniature: a check that
 * accepts any key approves every key.
 */
export const REFUSAL_HEADLINES: Readonly<Record<StatementRefusalCode, string>> = {
  TB_DOES_NOT_TIE: "The books do not balance, so nothing can be built on them",
  TB_EMPTY: "There is nothing in this period",
  BAD_DATE_RANGE: "That period is not a real range of dates",
  ACCOUNT_ROLE_CONFLICT: "One account is being asked to play two parts",
  BALANCE_SHEET_DOES_NOT_TIE: "Assets do not equal liabilities plus equity",
  CASH_FLOW_DOES_NOT_TIE: "The cash movement does not reach the cash you counted",
  NO_SHAREHOLDERS: "No shareholders are on file",
  DUPLICATE_SHAREHOLDER: "The same shareholder appears twice",
  NEGATIVE_EQUITY_MOVEMENT: "A movement that should be positive is negative",
  OWNERSHIP_NOT_100_PCT: "Ownership does not add up to exactly 100%",
  EQUITY_ROLLFORWARD_DOES_NOT_TIE: "Equity does not roll forward to the closing figure",
  ENTITY_MISMATCH: "Two different sets of books are being compared",
  // Emitted by `comparabilityRefusal()` when a comparison puts two periods of
  // unequal LENGTH side by side. It is the quietest wrong answer on the whole
  // screen: every percentage still renders, and every one of them is measuring
  // the difference in calendar days as though it were a change in the business.
  PERIOD_MISMATCH: "These two periods are not the same length",
  EARNINGS_AND_PROFITS_UNKNOWN: "Nobody has said whether there is accumulated E&P",
};

// ---------------------------------------------------------------------------
// 10) THE BOUNDARY, RESTATED ON EVERY SCREEN THAT PRODUCES A STATEMENT.
// ---------------------------------------------------------------------------

/**
 * What this screen is, and what it is not.
 *
 * These statements are MANAGEMENT accounts prepared from Michael's own ledger.
 * They are not audited, not reviewed, not compiled by an independent
 * accountant, and they carry no assurance. That sentence exists because a
 * well-formatted PDF with the word "Balance Sheet" at the top is routinely
 * handed to landlords, lenders and insurers as though it were something more.
 */
export const STATEMENT_SCOPE_NOTE =
  "These are management accounts built from your own ledger. They are not audited, not reviewed " +
  "and not compiled by an independent accountant, and nobody outside this business has checked " +
  "them. Reg S-X, which several of the presentation rules here come from, governs companies filing " +
  "with the SEC — it does not bind you. It is followed anyway because it is the clearest published " +
  "statement of how not to be misleading, and a lender who knows what a real balance sheet looks " +
  "like will recognise the layout.";

export function scopeNoteMentionsNoAssurance(): boolean {
  return /not audited/.test(STATEMENT_SCOPE_NOTE) && /does not bind you/.test(STATEMENT_SCOPE_NOTE);
}

// ---------------------------------------------------------------------------
// 11) THE ONE CALL THE PAGE MAKES.
//
// Everything above is a decision; this is the sequence. It exists so the page
// contains no logic at all, and so the ORDER of the guards is itself testable —
// the role guard must run before the engine, or the engine produces the wrong
// number before anyone can object to the input.
// ---------------------------------------------------------------------------

export type FsScreenInput = {
  view: TrialBalanceView;
  facts: readonly FsAccountFact[];
  entityCode: string;
  fromDate: string;
  toDate: string;
  nonCurrentAccountCodes: readonly string[];
  factsOnFile: FsFactsOnFile;
};

export type FsScreen = {
  adapted: FsAdaptResult;
  income: StatementResult<IncomeStatement> | null;
  balance: StatementResult<BalanceSheet> | null;
  blockers: readonly StatementBlocker[];
  cards: readonly FsStatementCard[];
  exciseAccountCodes: readonly string[];
  contraRevenueAccountCodes: readonly string[];
  trustAccountCodes: readonly string[];
};

export function buildFsScreen(input: FsScreenInput): FsScreen {
  const excise = exciseCodesFrom(input.facts);
  const contra = contraRevenueCodesFrom(input.facts);

  // THE GUARD RUNS FIRST. Not after the engine, not alongside it. If a balance
  // sheet account has been offered as an excise or discount code, the engine
  // would return a confident, tying, WRONG statement, and a refusal raised
  // afterwards would be arguing with a number already on the screen.
  assertRoleCodesAreProfitAndLoss(excise, input.facts, "excise");
  assertRoleCodesAreProfitAndLoss(contra, input.facts, "contra-revenue");

  const adapted = adaptTrialBalance(
    input.view,
    input.facts,
    input.entityCode,
    input.fromDate,
    input.toDate,
  );

  const blockers = blockersFor(input.factsOnFile);

  if (!adapted.ok) {
    return {
      adapted,
      income: null,
      balance: null,
      blockers,
      cards: statementCards(null, null, blockers),
      exciseAccountCodes: excise,
      contraRevenueAccountCodes: contra,
      trustAccountCodes: trustAccountCodesFrom(input.facts),
    };
  }

  const income = buildIncomeStatement({
    trialBalance: adapted.trialBalance,
    exciseAccountCodes: excise,
    contraRevenueAccountCodes: contra,
  });

  const balance = buildBalanceSheet({
    trialBalance: adapted.trialBalance,
    nonCurrentAccountCodes: input.nonCurrentAccountCodes,
    periodNetIncomeCents: income.ok ? income.statement.netIncomeCents : 0,
  });

  return {
    adapted,
    income,
    balance,
    blockers,
    cards: statementCards(income, balance, blockers),
    exciseAccountCodes: excise,
    contraRevenueAccountCodes: contra,
    trustAccountCodes: trustAccountCodesFrom(input.facts),
  };
}
