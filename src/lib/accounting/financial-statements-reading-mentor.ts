/**
 * src/lib/accounting/financial-statements-reading-mentor.ts   (books-42)
 *
 * HOW TO READ THE FINANCIAL STATEMENTS. THE OTHER HALF OF THE TEACHING.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS AND WHY IT IS SEPARATE
 * ─────────────────────────────────────────────────────────────────────────────
 * `financial-statements-mentor.ts` already teaches every exported function in
 * the engine — what it does, why it exists, the trap, what I would do. That
 * module is organised by FUNCTION, and `assertEveryExportedFunctionIsTaught()`
 * proves it is complete.
 *
 * Michael asked for something that module cannot give him. His words:
 *
 *     "I want to know how best to read them, to use them as a tool rather than
 *      a piece of paper with numbers on them. I want the cpa mentor to teach me
 *      everything important about them."
 *
 * That is a different axis entirely. Knowing what `buildBalanceSheet()` does
 * tells you nothing about what to DO when you are holding a balance sheet at
 * ten o'clock on a Tuesday. One is documentation of code; the other is
 * professional judgement. Mixing them would have meant either bloating the
 * function lessons until the coverage gate's meaning blurred, or quietly
 * dropping the coverage gate. Both are worse than a second file.
 *
 * So: that module teaches the ENGINE. This module teaches the STATEMENTS.
 * Each has its own completeness gate, and neither can rot without a test going
 * red.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MAKES THIS DIFFERENT FROM A TEXTBOOK
 * ─────────────────────────────────────────────────────────────────────────────
 * Every general-purpose explanation of financial statements ever written is
 * WRONG FOR MICHAEL in the same specific way: it assumes net income is the
 * point. For a §280E business it is not. Tax is computed on gross income —
 * revenue less cost of goods sold — and every deduction below that line is
 * denied. So a cannabis retailer can lose money on paper and owe substantial
 * federal tax in the same year, and no ordinary guide to reading a P&L will
 * prepare anyone for that.
 *
 * Everything here is therefore written for a Washington I-502 retailer, an S
 * corporation, with three shareholders, taking cash across a counter, unable to
 * use ordinary banking. Not for a business in general.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO AUTHORITY IS RE-DECLARED HERE (standing rule 2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Every `authorityIds` entry below resolves through `findGuidanceAuthority()`
 * in books-guidance-core, which merges every registry in the system — 382
 * authorities as of this slice. A gate proves every id here resolves, so a
 * citation cannot quietly become a dead reference.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { FsStatementId } from "./financial-statements-ui-core";

// ---------------------------------------------------------------------------
// 1) THE STATEMENT LESSONS.
//
// Nine fields. More than the function lessons, because reading a statement
// involves more decisions than calling a function does.
// ---------------------------------------------------------------------------

export type StatementLesson = {
  statement: FsStatementId;
  /** The name a CPA would say out loud. */
  title: string;
  /** The single question this statement exists to answer. */
  theQuestionItAnswers: string;
  /** Period or instant? Michael has to know which he is holding. */
  periodOrInstant: string;
  /** What it is, in two or three plain sentences. */
  whatItIs: string;
  /** The order to read it in, and why that order. */
  howToReadIt: string;
  /** What "good" looks like for THIS business, not a business in general. */
  whatGoodLooksLike: string;
  /** The mistake that costs the most, stated as a mistake. */
  theExpensiveMistake: string;
  /** What is different because this is a cannabis business. */
  the280eTwist: string;
  /** The advice a CPA would actually give out loud. */
  whatIWouldDo: string;
  authorityIds: readonly string[];
};

export const STATEMENT_LESSONS: readonly StatementLesson[] = [
  {
    statement: "income",
    title: "The income statement (profit and loss)",
    theQuestionItAnswers:
      "Did the business make money over this period — and how much of that will actually be taxed?",
    periodOrInstant:
      "A PERIOD. It covers a stretch of time — a month, a quarter, a year — and it starts again at " +
      "zero each year, because the closing entry sweeps it all into retained earnings.",
    whatItIs:
      "A list of everything that came in and everything that went out, arranged so that each " +
      "subtotal answers a different question. It is the only statement that tells you whether the " +
      "business model works. The balance sheet tells you where you stand; this tells you which " +
      "direction you are moving.",
    howToReadIt:
      "From the middle outwards, not from the top down. Find the §280E wall line first and read " +
      "UPWARDS: gross sales, less excise, less discounts, equals net sales; less cost of goods " +
      "sold, equals gross income. That top block is the part of your business the tax code " +
      "recognises, and gross income is the number §280E taxes. Then read DOWNWARDS from the wall: " +
      "everything there is real money you spent that buys you nothing back. Only then look at net " +
      "income, and treat it as one fact among several rather than the verdict.",
    whatGoodLooksLike:
      "For a Washington retailer buying at wholesale, gross margin usually lands between 40% and " +
      "50% of net sales. Below 35% something is wrong with purchasing, pricing, or shrinkage. " +
      "Spending below the wall under about 25% of net sales is tight operating; above 35% and you " +
      "are paying tax on money that is already gone. Steady beats spectacular: a margin that moves " +
      "several points a month usually means a cut-off problem rather than a business change.",
    theExpensiveMistake:
      "Reading net income as though it were the tax base. It is not, and the gap is not marginal — " +
      "it is the whole of your operating expenses. Owners who read the bottom line and plan around " +
      "it are the ones who are genuinely astonished in April.",
    the280eTwist:
      "§280E denies every deduction and credit for a business trafficking in a controlled substance. " +
      "Cost of goods sold survives, because it is not a deduction — it is subtracted in arriving at " +
      "gross income under Treas. Reg. §1.61-3(a), and Congress cannot tax gross receipts as income " +
      "without a constitutional problem. That is the whole of the relief available to you, which is " +
      "why the wall is drawn on the statement as a physical line rather than left implied.",
    whatIWouldDo:
      "Run it monthly, not quarterly, and always look at two months side by side. A single month " +
      "tells you almost nothing; two months is where you notice that shrinkage doubled or a vendor " +
      "quietly raised prices. And when you look for savings, look BELOW the wall first — a dollar " +
      "saved there is a full dollar, because it was never going to be deductible anyway.",
    authorityIds: [
      "IRC_280E",
      "REG_1_61_3_A",
      "HARBORSIDE",
      "ALTERMAN_COGS_FORMULA",
      "CCA_201531016_EXCISE_AMOUNT_REALIZED",
      "REG_SX_210_5_03_CAPTION_ORDER",
    ],
  },
  {
    statement: "balance",
    title: "The balance sheet",
    theQuestionItAnswers: "What does the business own and owe at this exact moment?",
    periodOrInstant:
      "An INSTANT. It is a photograph taken at the close of one day. Nothing on it describes a " +
      "period, which is why 'the balance sheet for July' is a phrase that does not quite mean " +
      "anything — it is the balance sheet AS OF the 31st.",
    whatItIs:
      "Everything the business owns on the left, everything it owes and everything the owners have " +
      "put in or left in on the right. The two sides are equal by construction, which is why the " +
      "fact that they balance proves nothing at all about whether they are right.",
    howToReadIt:
      "Abnormal balances first, before any total. Cash in credit or negative inventory is " +
      "impossible in the real world, so it means the books are wrong rather than the business is, " +
      "and every other statement inherits the error. Then current assets against current " +
      "liabilities — can the next twelve months of bills be paid? Then, and this is the step no " +
      "textbook includes, subtract the trust money. The excise and sales tax sitting in liabilities " +
      "is money you are HOLDING for the state; it is in your bank account and it is not yours.",
    whatGoodLooksLike:
      "Current assets comfortably above current liabilities — 150% or better. Inventory that moves: " +
      "compare it against a month of cost of goods sold and ask how many weeks of stock you are " +
      "financing. And no surprises: a balance sheet that looks different from last month in a way " +
      "you cannot immediately explain is a balance sheet with an error in it.",
    theExpensiveMistake:
      "Treating the bank balance as available money. A substantial part of it is excise and sales " +
      "tax collected on the state's behalf. Spending trust money on operations is the slowest and " +
      "most common way a cash business dies — the shortfall does not become visible until the " +
      "return is due, and by then it has been happening for months.",
    the280eTwist:
      "Inventory is the one asset on this page that turns into a tax deduction, so how it is valued " +
      "is worth real money. §280E denies your operating expenses, which leaves cost of goods sold as " +
      "the only route — and the inventory figure here IS the cost of goods sold figure on the income " +
      "statement, arrived at from the other direction. Treas. Reg. §1.471-2(d) requires inventory to " +
      "be verified by physical count, not inferred from a system, which is exactly why the cycle " +
      "count screens exist. An inventory number you cannot defend is a §280E position you cannot " +
      "defend, and it is the only position you have.",
    whatIWouldDo:
      "Print it on the same day each month and keep the last twelve. The value of a balance sheet is " +
      "almost entirely in the comparison — one on its own is a photograph of a stranger. And never " +
      "net anything: if you are owed money and you owe money to the same party, show both. Netting " +
      "is where errors hide.",
    authorityIds: [
      "ASC_205_10_45_1A_FULL_SET",
      "REG_SX_210_5_02_BALANCE_SHEET_ORDER",
      "ASC_210_20_45_4_NOT_FAITHFUL",
      "CON8_CH7_PR33_NETTING",
      "REG_1_471_2_D_VERIFY_BY_COUNT",
      "RCW_69_50_535",
    ],
  },
  {
    statement: "cash_flow",
    title: "The statement of cash flows",
    theQuestionItAnswers: "Where did the cash actually go, and does it agree with what I counted?",
    periodOrInstant:
      "A PERIOD, anchored at both ends by an instant: the cash you had at the start and the cash you " +
      "counted at the end.",
    whatItIs:
      "The bridge between two cash balances, split three ways: operating (running the shop), " +
      "investing (buying or selling things you keep), and financing (borrowing, repaying, and money " +
      "in or out from the owners). It exists because profit is an accounting opinion and cash is a " +
      "fact, and the two routinely disagree.",
    howToReadIt:
      "Backwards, from the bottom. Take the ending cash figure and compare it to what you physically " +
      "counted in the drawer, the safe and the bank. If they do not agree to the cent, stop — " +
      "nothing above is worth reading. When they do agree, look at operating cash flow against net " +
      "income: if profit is positive and operating cash is negative, the money went into inventory " +
      "or somebody is not paying you.",
    whatGoodLooksLike:
      "Operating cash flow positive and in the same neighbourhood as gross income. Investing small " +
      "or zero, because you have almost no fixed assets. Financing showing the loan repayments and " +
      "the owner distributions and nothing you cannot name.",
    theExpensiveMistake:
      "Calling a difference an 'adjustment' and moving on. A cash difference is never a rounding " +
      "issue. It is either a transaction nobody recorded or money that left the building, and both " +
      "are things to know about today rather than at year end.",
    the280eTwist:
      "Two things collide here and this is the statement where you see it. First, you run a cash " +
      "business in an industry banks will not touch, so this statement is the closest thing your " +
      "books have to a theft detector — at an ordinary business the bank statement does that job, " +
      "and here a large share of takings never touches a bank at all, leaving the reconciliation " +
      "between what the books say and what somebody counted by hand as the only control. Second, " +
      "§280E makes your tax bill larger than your profit, and that bill is paid in CASH. An ordinary " +
      "retailer sets aside a share of what it earned; you have to set aside more than you earned. " +
      "That is why this statement, not the income statement, is the one that tells you whether the " +
      "business survives the year.",
    whatIWouldDo:
      "When it refuses to tie, count the drawer and the safe again before touching the books at all. " +
      "Then look for a vendor paid out of the till, an owner draw taken in cash, an ATM refill, or a " +
      "deposit dated a day off. It is almost always one of those five, and it is almost never fraud " +
      "— but the only way to know that is to find it.",
    authorityIds: [
      "ASC_230_10_45_7_GROSS_NOT_NET",
      "CON8_CH7_PR12_NOTE_NOT_SUBSTITUTE",
      "REG_SX_210_4_01_NOT_MISLEADING",
    ],
  },
  {
    statement: "equity",
    title: "The statement of equity, stock basis and AAA",
    theQuestionItAnswers:
      "What is my stake worth, and can I take money out without triggering a tax bill?",
    periodOrInstant:
      "A PERIOD. It is a roll-forward: what each owner started with, what happened, what they end " +
      "with. The closing figures become next year's opening figures, which is why an error here " +
      "does not go away — it compounds.",
    whatItIs:
      "Three related things on one page. Book equity, which is what the balance sheet says the " +
      "owners' share is worth. Stock basis, which is a TAX number personal to each shareholder and " +
      "decides whether a distribution is tax-free. And the accumulated adjustments account, which " +
      "is the S corporation's running total of previously taxed income.",
    howToReadIt:
      "Down your own column, in order. Beginning basis, plus your share of income, minus your share " +
      "of the non-deductible expenses, minus what you were actually paid. If the result would go " +
      "below zero, the excess is a capital gain and the statement says so. Read the AAA column " +
      "beside it but do not confuse the two: they move almost identically and they have different " +
      "floors.",
    whatGoodLooksLike:
      "Basis comfortably positive and not trending toward zero. Distributions less than the income " +
      "allocated to you. AAA positive, which means the money coming out is previously taxed income " +
      "rather than something else.",
    theExpensiveMistake:
      "Three of them, stacked. Assuming basis and AAA are the same account — basis stops at zero, " +
      "AAA does not, because §1368(e)(1)(A) expressly disregards the 'but not below zero' language. " +
      "Testing distributions against basis BEFORE adding the year's income, which invents a capital " +
      "gain that does not exist. And splitting distributions pro-rata to ownership: your mother is " +
      "allocated 10% but is not paid, so pro-rata would be wrong for two of the three shareholders " +
      "and would understate your own draw, which is the figure most likely to trip §1368(b)(2).",
    the280eTwist:
      "This is the one most owners never see coming. §280E-disallowed expenses still reduce your " +
      "stock basis, even though they gave you no deduction. So basis burns down in a year the " +
      "company was profitable and you were taxed on more than you kept. Watch it like a fuel gauge: " +
      "once it hits zero, every further dollar you take out is a capital gain — tax owed in a year " +
      "the money is already spent.",
    whatIWouldDo:
      "Look at it before you take money out, not afterwards. If basis is heading for zero the answer " +
      "is usually to shift part of what you take from distributions to payroll: wages are deductible " +
      "to the company, they do not consume basis, and they come with withholding already done. That " +
      "conversation is worth having in October, not April.",
    authorityIds: [
      "IRC_1367_STOCK_BASIS_ADJUSTMENTS",
      "IRC_1368_DISTRIBUTIONS_AAA",
      "IRC_280E",
    ],
  },
] as const;

export function statementLessonFor(id: FsStatementId): StatementLesson | undefined {
  return STATEMENT_LESSONS.find((l) => l.statement === id);
}

// ---------------------------------------------------------------------------
// 2) THE THINGS THAT ARE TRUE ACROSS ALL FOUR.
//
// A CPA teaching a client does not only explain each statement; there is a
// short list of principles that make the whole set usable, and every one of
// them is a lesson learned the hard way.
// ---------------------------------------------------------------------------

export type StatementPrinciple = {
  key: string;
  headline: string;
  body: string;
  authorityIds: readonly string[];
};

export const STATEMENT_PRINCIPLES: readonly StatementPrinciple[] = [
  {
    key: "they_are_a_set",
    headline: "The four are one document, not four documents",
    body:
      "Net income on the income statement lands in equity on the balance sheet. The change in cash " +
      "on the balance sheet is what the cash flow statement explains. The distributions on the " +
      "equity statement are the financing outflow on the cash flow statement. Reading one alone is " +
      "like reading one page of a contract — everything you need is there and the meaning is not. " +
      "When two of them disagree, the disagreement IS the finding.",
    authorityIds: ["ASC_205_10_45_1A_FULL_SET"],
  },
  {
    key: "balancing_proves_nothing",
    headline: "A statement that balances is not a statement that is right",
    body:
      "Every journal individually sums to zero, so any subset of the ledger that contains whole " +
      "journals will balance. A report can omit half your books and still print the word BALANCED. " +
      "This has happened here: eighteen accounts, including the whole of payroll, once vanished from " +
      "a report because of a four-letter typo in an entity code, and the report footed perfectly. " +
      "Balancing is a necessary condition and nothing more.",
    authorityIds: ["REG_SX_210_4_01_NOT_MISLEADING"],
  },
  {
    key: "comparison_is_the_value",
    headline: "One period on its own is nearly worthless",
    body:
      "The entire diagnostic value of financial statements is in comparison — this month against " +
      "last month, this year against last year. A number on its own has no scale. The first time " +
      "you see gross margin at 43% it means nothing; the second time, when it was 47% last month, it " +
      "means everything. Keep them, in order, and look at them together.",
    authorityIds: ["ASC_205_10_45_1_COMPARATIVES", "CON8_CH7_PR39_HOMOGENEITY"],
  },
  {
    key: "consistency_beats_precision",
    headline: "Consistent beats precise",
    body:
      "If an item is classified one way in January and another way in February, the comparison " +
      "between them is destroyed and no amount of accuracy in either month repairs it. Pick a " +
      "treatment, write down why, and keep it. When it genuinely has to change, change it in both " +
      "periods and say so.",
    authorityIds: ["ASC_205_10_45_1_COMPARATIVES", "REG_SX_210_5_03_CAPTION_ORDER"],
  },
  {
    key: "never_move_to_change_an_outcome",
    headline: "Never move an account to change an outcome",
    body:
      "The temptation on a §280E return is enormous, because moving a cost above the wall is worth " +
      "roughly forty cents on the dollar. Harborside and Alterman both did it and both lost. The " +
      "side an account sits on comes from a decision made in advance, in the chart of accounts, for " +
      "a reason you wrote down. If an account is in the wrong place, fix the chart and record why — " +
      "do not fix the report.",
    authorityIds: ["IRC_280E", "HARBORSIDE", "ALTERMAN_COGS_FORMULA"],
  },
  {
    key: "notes_are_not_optional",
    headline: "A number without its context is not information",
    body:
      "FASB's own conceptual framework says notes are not a substitute for recognition — but the " +
      "reverse matters more to you. Recognising a number without explaining it produces a figure " +
      "nobody can act on. Why inventory jumped, what the loan balance actually is, which " +
      "liabilities are trust money: none of that is visible in the totals, and all of it changes " +
      "what the totals mean.",
    authorityIds: ["CON8_CH7_PR12_NOTE_NOT_SUBSTITUTE"],
  },
  {
    key: "management_accounts",
    headline: "These are management accounts and they carry no assurance",
    body:
      "Nobody independent has checked them. That is fine for running the business and it is not fine " +
      "for handing to a lender as though it were an audit. If somebody outside needs assurance, that " +
      "is a separate engagement with a separate report attached, and the difference is a legal one " +
      "rather than a matter of presentation.",
    authorityIds: ["REG_SX_210_4_01_NOT_MISLEADING"],
  },
] as const;

// ---------------------------------------------------------------------------
// 3) THE WORKED EXAMPLE.
//
// Michael's standing expectation is a worked example with real arithmetic, and
// the reason is specific: §280E is impossible to feel in the abstract. The
// numbers below are ILLUSTRATIVE and labelled as such — they are not Greenway's
// actual results, because the first real month of the new books has not closed.
// The SHAPE is Greenway's: a Washington retailer, revenue recognised net of the
// 37% excise, no fixed assets.
//
// Every figure is integer cents and every subtotal is derived, so a test can
// re-compute the whole example and catch the day somebody edits one number and
// forgets the total below it.
// ---------------------------------------------------------------------------

export type WorkedExampleLine = {
  label: string;
  amountCents: number;
  /** True for figures that are computed from the lines above. */
  isDerived: boolean;
  note: string;
};

export const WORKED_EXAMPLE_IS_ILLUSTRATIVE =
  "These figures are illustrative, not Greenway's actual results. They are shaped like a real " +
  "month at a Washington retailer so the arithmetic is recognisable, and they are labelled here so " +
  "nobody ever mistakes a teaching example for a set of books.";

/** Gross sales in the worked example. */
export const EXAMPLE_GROSS_SALES_CENTS = 200_000_00;
export const EXAMPLE_DISCOUNTS_CENTS = 8_000_00;
export const EXAMPLE_COGS_CENTS = 110_000_00;
export const EXAMPLE_OPEX_CENTS = 78_000_00;
/** A representative federal rate for an S corporation shareholder. */
export const EXAMPLE_TAX_RATE_BP = 3700;

export function workedExample(): readonly WorkedExampleLine[] {
  const netSales = EXAMPLE_GROSS_SALES_CENTS - EXAMPLE_DISCOUNTS_CENTS;
  const grossIncome = netSales - EXAMPLE_COGS_CENTS;
  const bookNet = grossIncome - EXAMPLE_OPEX_CENTS;
  // Integer arithmetic: basis points, multiply before divide, then truncate.
  const taxOnGross = Math.trunc((grossIncome * EXAMPLE_TAX_RATE_BP) / 10_000);
  const taxIfOrdinary = Math.trunc((bookNet * EXAMPLE_TAX_RATE_BP) / 10_000);

  return [
    {
      label: "Gross sales",
      amountCents: EXAMPLE_GROSS_SALES_CENTS,
      isDerived: false,
      note:
        "Already net of the 37% excise. Under RCW 69.50.535(4) that money is held in trust for the " +
        "state and was never revenue, so it does not appear on this statement at all — it sits in " +
        "current liabilities until it is paid over.",
    },
    {
      label: "Less: discounts and comps",
      amountCents: EXAMPLE_DISCOUNTS_CENTS,
      isDerived: false,
      note: "Contra-revenue. A discount reduces what you earned; it is not something you bought.",
    },
    {
      label: "Net sales",
      amountCents: netSales,
      isDerived: true,
      note: "What the customers actually paid you, after everything you gave back.",
    },
    {
      label: "Less: cost of goods sold",
      amountCents: EXAMPLE_COGS_CENTS,
      isDerived: false,
      note:
        "The product itself. This is the ONLY thing on the whole statement that reduces your tax, " +
        "because it is subtracted in arriving at gross income rather than deducted from it.",
    },
    {
      label: "GROSS INCOME — the number §280E taxes",
      amountCents: grossIncome,
      isDerived: true,
      note:
        "A gross margin of 42.71% of net sales — squarely in the healthy band for a Washington " +
        "retailer. This is the figure the IRS starts from, and for you it is very nearly the figure " +
        "it finishes at.",
    },
    {
      label: "Less: operating expenses (below the §280E wall)",
      amountCents: EXAMPLE_OPEX_CENTS,
      isDerived: false,
      note:
        "Rent, wages that are not inventoriable, insurance, professional fees, utilities. Every " +
        "dollar real, every dollar spent, not one dollar deductible.",
    },
    {
      label: "Book net income",
      amountCents: bookNet,
      isDerived: true,
      note: "What the books say you kept. It is not what you will be taxed on.",
    },
    {
      label: "Tax computed on GROSS income (§280E)",
      amountCents: taxOnGross,
      isDerived: true,
      note:
        "37% of gross income, because the operating expenses are denied. This is the real bill.",
    },
    {
      label: "Tax if you were an ordinary retailer",
      amountCents: taxIfOrdinary,
      isDerived: true,
      note: "37% of book net income. The difference between these two lines is the cost of §280E.",
    },
    {
      label: "THE COST OF §280E, this month",
      amountCents: taxOnGross - taxIfOrdinary,
      isDerived: true,
      note:
        "Extra tax paid purely because of what you sell. Note that it is larger than the book " +
        "profit itself — which is precisely how a profitable-looking month becomes a cash problem.",
    },
  ];
}

/**
 * The one sentence the worked example exists to make unavoidable.
 *
 * Derived rather than typed, so it can never drift from the numbers above.
 */
export function theSentence(): string {
  const lines = workedExample();
  const bookNet = lines.find((l) => l.label === "Book net income");
  const cost = lines.find((l) => l.label === "THE COST OF §280E, this month");
  if (!bookNet || !cost) throw new Error("WORKED_EXAMPLE_BROKEN: expected lines are missing.");
  return (
    `The books show ${dollars(bookNet.amountCents)} of profit, and §280E costs ` +
    `${dollars(cost.amountCents)} in extra tax on top of what an ordinary retailer would pay. ` +
    `That is why net income is not the number to run this business on.`
  );
}

function dollars(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  const withCommas = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "(" : ""}$${withCommas}.${String(frac).padStart(2, "0")}${neg ? ")" : ""}`;
}

// ---------------------------------------------------------------------------
// 4) THE COVERAGE GATES (standing rule 26, and rule 39 — guard the guard).
// ---------------------------------------------------------------------------

/**
 * Read the statement ids the UI core declares, FROM DISK.
 *
 * Textual on purpose, exactly like `exportedCoreFunctionNames()` does for the
 * engine. Importing the type would tell us what TypeScript erased; reading the
 * source tells us what a developer actually wrote, which is the thing that
 * needs to be covered.
 */
export function declaredStatementIds(sourcePath?: string): readonly string[] {
  const path =
    sourcePath ??
    join(process.cwd(), "src", "lib", "accounting", "financial-statements-ui-core.ts");
  const src = readFileSync(path, "utf8");
  const m = /export type FsStatementId =([^;]+);/.exec(src);
  if (m === null) return [];
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

/**
 * THE GATE.
 *
 * Fails four ways, and all four matter:
 *   - zero ids found, meaning the regex broke and the gate had started passing
 *     vacuously while inspecting nothing (rule 39);
 *   - a statement with no reading lesson;
 *   - a lesson for a statement that no longer exists;
 *   - a lesson with an empty field, which is a lesson that looks complete in a
 *     list and teaches nothing when opened.
 *
 * `sourcePath` exists so a test can point the gate at a DOCTORED copy of the UI
 * core and prove the gate actually fires. This follows the house pattern in
 * `timesheet-mentor-gates.ts`, `ytd-mentor-gates.ts` and
 * `internal-control-mentor.ts`. Without it the gate can only ever be observed
 * passing, and a gate nobody has watched fail is standing rule 16's whole
 * complaint — a green check that has never been earned.
 */
export function assertEveryStatementIsTaught(sourcePath?: string): void {
  const declared = declaredStatementIds(sourcePath);
  if (declared.length === 0) {
    throw new Error(
      "financial-statements-reading-mentor: found NO statement ids in financial-statements-ui-core.ts. " +
        "The coverage gate cannot read the source, so it would pass without checking anything.",
    );
  }

  const taught = new Set(STATEMENT_LESSONS.map((l) => String(l.statement)));
  const untaught = declared.filter((d) => !taught.has(d));
  if (untaught.length > 0) {
    throw new Error(
      `financial-statements-reading-mentor: these statements have no reading lesson: ${untaught.join(", ")}. ` +
        "Michael asked to be taught how to READ them, so a statement that ships without a reading " +
        "lesson is an unfinished statement (standing rule 26).",
    );
  }

  const declaredSet = new Set(declared);
  const orphans = [...taught].filter((t) => !declaredSet.has(t));
  if (orphans.length > 0) {
    throw new Error(
      `financial-statements-reading-mentor: these lessons teach statements that no longer exist: ${orphans.join(", ")}. ` +
        "A mentor layer that describes something deleted teaches something false.",
    );
  }

  const FIELDS: readonly (keyof StatementLesson)[] = [
    "title",
    "theQuestionItAnswers",
    "periodOrInstant",
    "whatItIs",
    "howToReadIt",
    "whatGoodLooksLike",
    "theExpensiveMistake",
    "the280eTwist",
    "whatIWouldDo",
  ];
  for (const lesson of STATEMENT_LESSONS) {
    for (const f of FIELDS) {
      const v = lesson[f];
      if (typeof v !== "string" || v.trim().length === 0) {
        throw new Error(
          `financial-statements-reading-mentor: lesson for '${lesson.statement}' has an empty '${String(f)}'. ` +
            "A field left blank looks complete in a list and teaches nothing when opened.",
        );
      }
    }
    if (lesson.authorityIds.length === 0) {
      throw new Error(
        `financial-statements-reading-mentor: lesson for '${lesson.statement}' cites no authority. ` +
          "Advice without a citation is opinion wearing a lab coat.",
      );
    }
  }
}

/** Every authority id this module cites, deduplicated and sorted. */
export function citedReadingAuthorityIds(): readonly string[] {
  const out = new Set<string>();
  for (const l of STATEMENT_LESSONS) for (const id of l.authorityIds) out.add(id);
  for (const p of STATEMENT_PRINCIPLES) for (const id of p.authorityIds) out.add(id);
  return [...out].sort();
}
