/**
 * src/lib/accounting/financial-statements-mentor.ts   (books-17)
 *
 * THE CPA WHO SITS NEXT TO MICHAEL.
 *
 * Michael's words, books-17: *"I want a PhD level cpa coaching me every step of
 * the way... I love the hand holding method, it forces me to be responsible and
 * accurate and timely."*
 *
 * So every exported function in `financial-statements-core.ts` has a lesson
 * here, and `assertEveryExportedFunctionIsTaught()` reads the core module FROM
 * DISK to prove it. That gate is not decoration: during this slice a new
 * function (`comparabilityRefusal`) was added to the engine and the gate caught
 * it unprompted, before any human noticed. A function that ships without an
 * explanation is an unfinished function (standing rule 26).
 *
 * The five fields are deliberate. `plainEnglish` says what it does.
 * `whyItExists` says what goes wrong without it. `theTrap` names the specific
 * mistake — usually one Michael has actually made, or one that cost a real
 * cannabis business a real case. `whatIWouldDo` is the advice a CPA would
 * actually give out loud. `authorityIds` ties it back to something quotable, so
 * none of it is opinion wearing a lab coat.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type MentorLesson = {
  /** The exported function this lesson teaches. */
  fn: string;
  plainEnglish: string;
  whyItExists: string;
  theTrap: string;
  whatIWouldDo: string;
  authorityIds: readonly string[];
};

export const FINANCIAL_STATEMENT_LESSONS: readonly MentorLesson[] = [
  {
    fn: "wallSideOf",
    plainEnglish:
      "Tells you which side of the §280E line an account sits on: above the line, where it helps you, " +
      "or below it, where you spend real money and get nothing back on your taxes.",
    whyItExists:
      "For an ordinary business the layout of an income statement is a matter of taste. For you it is " +
      "worth roughly forty cents on every dollar, because §280E denies every deduction below the gross " +
      "income line while leaving cost of goods sold untouched. The line is a tax boundary, not a " +
      "formatting choice.",
    theTrap:
      "Deciding an account's side at report time based on what would look better. That is precisely " +
      "what Harborside and Alterman did when they pushed operating costs into cost of goods sold, and " +
      "both lost. The side comes from the account type in your chart of accounts — a decision you made " +
      "deliberately, in advance, and can defend.",
    whatIWouldDo:
      "Get the chart of accounts right once, with a reason written down for every account that sits " +
      "above the line, and then never move an account to change an outcome. If an account is in the " +
      "wrong place, fix the chart and say why — do not fix the report.",
    authorityIds: ["IRC_280E", "REG_1_61_3_A", "HARBORSIDE", "ALTERMAN_COGS_FORMULA"],
  },
  {
    fn: "tbDoesNotTieRefusal",
    plainEnglish:
      "Builds the refusal you see when debits do not equal credits, and it names the exact amount you " +
      "are out by.",
    whyItExists:
      "Because the amount is the clue. A round number suggests a missing entry; an odd number suggests " +
      "a transposition; twice a familiar figure suggests something imported twice. Hiding the number " +
      "throws away the best evidence you have.",
    theTrap:
      "The suspense account. Your books once carried a $4,624,697.31 difference for months because " +
      "every report rendered anyway and nobody was ever shown the number. A difference parked in an " +
      "account is a difference nobody looks at again.",
    whatIWouldDo:
      "Treat an out-of-balance trial balance as a stop-work condition. Find the one-sided entry the " +
      "same day. It is nearly always a single journal, and it gets exponentially harder to find as " +
      "more activity piles on top of it.",
    authorityIds: ["REG_SX_210_4_01_NOT_MISLEADING", "CON8_CH7_PR12_NOTE_NOT_SUBSTITUTE"],
  },
  {
    fn: "assertIntegerCents",
    plainEnglish:
      "Stops a number that is not a whole count of cents from getting anywhere near your financial " +
      "statements. Half a cent, a blank, or a value produced by a broken calculation is rejected on " +
      "the spot instead of being printed.",
    whyItExists:
      "This exists because I attacked the formatter on purpose and it failed. Asked to print half a " +
      "cent it produced the text $0.10.5, and asked to print a broken calculation it produced $NaN.NaN. " +
      "The first one is the frightening one: it is not obviously wrong at a glance, it sits in a column " +
      "of ordinary-looking money, and it means a fraction of a cent got into your ledger and nothing " +
      "objected. A report that prints nonsense is more dangerous than one that stops, because the " +
      "nonsense gets printed, filed, and believed.",
    theTrap:
      "Assuming money is safe because it came from the database. It arrives from imports, from " +
      "spreadsheets, and from arithmetic done elsewhere in the code, and any one of those can hand back " +
      "a fraction. The classic path is a percentage applied with ordinary decimal arithmetic: 37% of " +
      "$100.03 is not a whole number of cents, and if nobody rounds it deliberately the fraction rides " +
      "along quietly until the year-end totals are off by an amount nobody can trace.",
    whatIWouldDo:
      "If you ever see this error, do not round the number and carry on. Go and find where the fraction " +
      "was created, because the fraction is the symptom and the calculation that made it is the disease " +
      "\u2014 it is still running, and it is still producing fractions everywhere else. Rounding at the " +
      "point of display hides it and guarantees you meet it again at year end.",
    authorityIds: ["REG_SX_210_4_01_NOT_MISLEADING", "CON8_CH7_PR12_NOTE_NOT_SUBSTITUTE"],
  },
  {
    fn: "formatCents",
    plainEnglish:
      "Turns whole cents into dollars for display, showing negatives in parentheses rather than with a " +
      "minus sign.",
    whyItExists:
      "Every amount in this system is stored as an integer number of cents. Money is never a decimal " +
      "in code, because 0.1 + 0.2 is genuinely not 0.3 in a computer, and a fraction of a cent " +
      "repeated across thousands of transactions becomes a real difference nobody can explain.",
    theTrap:
      "A minus sign is one pixel wide and easy to miss on a printed page. Parentheses are not. That is " +
      "why Regulation S-X requires negatives to be shown in a way that clearly distinguishes them.",
    whatIWouldDo:
      "Never type a dollar amount into a spreadsheet to do side arithmetic and then paste it back. " +
      "That round trip through a floating point cell is exactly where a cent goes missing.",
    authorityIds: ["REG_SX_210_4_01_NOT_MISLEADING"],
  },
  {
    fn: "shareInMilliPercent",
    plainEnglish:
      "Works out what percentage one number is of another, expressed in thousandths of a percent, and " +
      "returns nothing at all when the base is zero.",
    whyItExists:
      "Percentages are stored as integers for the same reason money is. And when the prior period is " +
      "zero, there IS no percentage — dividing by zero would give infinity, and reporting 0% would be " +
      "a confident lie.",
    theTrap:
      "Showing '0% change' when last month was zero and this month is $40,000. That is not a 0% change; " +
      "it is a new line item, which is usually the most interesting thing on the whole report.",
    whatIWouldDo:
      "When you see a blank percentage on a variance report, look harder rather than less hard. A blank " +
      "means something appeared or disappeared, and both are worth a minute of your time.",
    authorityIds: ["REG_SX_210_4_01_NOT_MISLEADING"],
  },
  {
    fn: "formatMilliPercent",
    plainEnglish: "Displays an ownership or variance percentage without ever touching a decimal number.",
    whyItExists:
      "Ownership decides who is taxed on what. Dividing 85,500 by 1,000 in floating point is how a " +
      "report ends up saying 8.549999999999999%, and a number like that on a document going to the IRS " +
      "makes everything around it look sloppy.",
    theTrap:
      "Assuming small percentages are harmless. Your grandfather's 5% is what makes his K-1 exist at " +
      "all, and a rounding error there is a wrong K-1 for a real person.",
    whatIWouldDo:
      "Keep ownership in whole thousandths of a percent everywhere, including any spreadsheet you keep " +
      "on the side, so the two never disagree.",
    authorityIds: ["IRC_1367_STOCK_BASIS_ADJUSTMENTS"],
  },
  {
    fn: "requiresSeparateDisclosure",
    plainEnglish:
      "Answers whether an item is big enough that it deserves its own line rather than being lumped " +
      "into 'other' — the test is more than five percent of the section.",
    whyItExists:
      "A large number hidden inside 'other current liabilities' is a large number nobody looks at. " +
      "Regulation S-X names accrued payrolls and taxes specifically, which for you means the excise tax " +
      "payable and the payroll accruals.",
    theTrap:
      "Reading 'in excess of 5 percent' as 'at least 5 percent'. Exactly five percent is NOT a breakout. " +
      "The engine tests strictly greater than, and there is a test that proves it does.",
    whatIWouldDo:
      "When the system tells you an item needs its own line, give it one and leave it there. Consistency " +
      "between months is what makes a trend visible.",
    authorityIds: ["REG_SX_210_5_02_BALANCE_SHEET_ORDER"],
  },
  {
    fn: "buildIncomeStatement",
    plainEnglish:
      "Builds your profit and loss statement, with the §280E wall drawn across the middle of it as a " +
      "real line, and a memo explaining why the profit at the bottom is not the number you are taxed on.",
    whyItExists:
      "Book net income for a cannabis retailer is close to meaningless on its own. You can lose money " +
      "on paper and still owe substantial federal tax, because everything below the gross income line " +
      "is disallowed. Showing the profit without showing the wall would be the most misleading number " +
      "this system could print.",
    theTrap:
      "Burying the 37% excise tax in cost of goods sold because it feels like a cost of selling. The " +
      "IRS Chief Counsel memorandum written about the Washington tax, to a lawyer in Seattle, says it " +
      "is NOT inventoriable cost, NOT a deduction and NOT a credit — it reduces the amount you realized " +
      "on the sale. It belongs between gross sales and net sales.",
    whatIWouldDo:
      "Read this statement from the wall outwards. Above the line, ask whether every dollar of inventory " +
      "cost has been captured and documented, because that is the only relief §280E allows you. Below " +
      "the line, ask whether the spending is worth it, because none of it reduces your tax.",
    authorityIds: [
      "IRC_280E",
      "REG_1_61_3_A",
      "CCA_201531016_EXCISE_AMOUNT_REALIZED",
      "REG_SX_210_5_03_CAPTION_ORDER",
      "CON8_CH7_PR12_NOTE_NOT_SUBSTITUTE",
      "ALPENGLOW_EXCLUSION",
      "ASC_330_10_30_1_INVENTORY_COST",
      "REG_1_461_4_G_6_TAX_ECONOMIC_PERFORMANCE",
    ],
  },
  {
    fn: "buildBalanceSheet",
    plainEnglish:
      "Shows what you own and what you owe at one moment in time, split between what is current and " +
      "what is not, and refuses to print if the two sides do not agree.",
    whyItExists:
      "The income statement covers a period; this covers an instant. It is where an inventory problem " +
      "or a missing liability becomes visible, because those distort the picture without necessarily " +
      "unbalancing the books.",
    theTrap:
      "Letting the software decide what is current and what is long-term from the account number. " +
      "Whether a debt is current is a fact about when it is DUE, and guessing it from a code range is " +
      "how a long-term obligation lands in current liabilities and makes a healthy business look " +
      "insolvent. This engine asks; it never guesses.",
    whatIWouldDo:
      "Look at the abnormal balances section first, every single month. A negative inventory or a cash " +
      "account in credit is impossible in the real world, so it means the books are wrong — and this " +
      "system surfaces them rather than netting them away, because netting is where errors hide.",
    authorityIds: [
      "ASC_205_10_45_1A_FULL_SET",
      "REG_SX_210_5_02_BALANCE_SHEET_ORDER",
      "ASC_210_20_45_4_NOT_FAITHFUL",
      "CON8_CH7_PR33_NETTING",
      "REG_1_471_2_D_VERIFY_BY_COUNT",
    ],
  },
  {
    fn: "buildCashFlowStatement",
    plainEnglish:
      "Proves that the cash you started with, plus everything that moved, equals the cash you actually " +
      "counted at the end — and refuses to print if it does not.",
    whyItExists:
      "You run a cash business in an industry banks will not touch. This statement is the closest thing " +
      "your books have to a theft detector. Profit is an opinion until the cash agrees.",
    theTrap:
      "Calling the difference an 'adjustment' and moving on. A cash difference is never a rounding " +
      "issue: it is either a transaction nobody recorded or money that left the building, and both are " +
      "things you need to know about today rather than at year end.",
    whatIWouldDo:
      "When this refuses, count the drawer and the safe again before touching the books at all. Then " +
      "look for a vendor paid out of the till, an owner draw taken in cash, an ATM refill, or a deposit " +
      "dated a day off. It is almost always one of those five.",
    authorityIds: [
      "ASC_230_10_45_7_GROSS_NOT_NET",
      "CON8_CH7_PR12_NOTE_NOT_SUBSTITUTE",
      "REG_SX_210_4_01_NOT_MISLEADING",
    ],
  },
  {
    fn: "buildEquityStatement",
    plainEnglish:
      "Tracks each owner's stake: what they started with, what income was allocated to them, what the " +
      "disallowed expenses took away, what they were actually paid, and whether any of it turned into " +
      "a taxable gain.",
    whyItExists:
      "Stock basis and the accumulated adjustments account are the two numbers that decide whether a " +
      "distribution is tax-free or taxable. They are also the two numbers most commonly confused with " +
      "each other, and getting them wrong shows up as a surprise on a personal return.",
    theTrap:
      "Three traps stacked together. First, assuming basis and AAA are the same account — basis stops " +
      "at zero, AAA does not, because §1368(e)(1)(A) expressly disregards the 'but not below zero' " +
      "language. Second, testing distributions against basis BEFORE adding the year's income, which " +
      "invents a capital gain that does not exist. Third, splitting distributions pro-rata: your mother " +
      "is allocated 10% but is not paid, so pro-rata would be wrong for two of three shareholders.",
    whatIWouldDo:
      "Watch your own basis like a fuel gauge. §280E expenses burn it down even in a profitable year, " +
      "and once it hits zero every further dollar you take out is a capital gain — tax owed in a year " +
      "the money is already spent. If basis is heading to zero, talk about payroll versus distributions " +
      "BEFORE you take the money, not in April.",
    authorityIds: ["IRC_1367_STOCK_BASIS_ADJUSTMENTS", "IRC_1368_DISTRIBUTIONS_AAA", "IRC_280E"],
  },
  {
    fn: "comparabilityRefusal",
    plainEnglish:
      "Checks that two statements can honestly be compared before any variance is calculated — same " +
      "business, and periods of roughly the same length.",
    whyItExists:
      "A variance report is arithmetic, and arithmetic will happily compare a month to a quarter and " +
      "report a 200% increase in sales that is really just more days.",
    theTrap:
      "Comparing Greenway to the ATM operation because both are 'the business'. They are four separate " +
      "sets of books — Greenway, the ATM, the landholding company and personal — and the ATM is a " +
      "Schedule C while the retailer is an S corporation. They do not even share a tax return.",
    whatIWouldDo:
      "Compare month to month and year to year within one entity. If you want to know how the whole " +
      "enterprise is doing, look at each set of books in turn rather than adding them together.",
    authorityIds: ["ASC_205_10_45_1_COMPARATIVES", "REG_SX_210_4_01_NOT_MISLEADING"],
  },
  {
    fn: "compareIncomeStatements",
    plainEnglish:
      "Puts this period next to a prior one line by line and shows what changed, matching lines by " +
      "name rather than by position.",
    whyItExists:
      "A single month tells you almost nothing. Two months side by side is where you notice that " +
      "shrinkage doubled or that a vendor quietly raised prices.",
    theTrap:
      "Matching lines by position. If the prior period had one fewer line — no discounts that month, " +
      "say — every row below it shifts by one, and you end up comparing payroll against utilities on a " +
      "report that looks perfectly reasonable.",
    whatIWouldDo:
      "Look at the biggest dollar variances first, not the biggest percentages. A 300% increase on a " +
      "$40 line does not matter; a 4% increase on cost of goods sold is thousands of dollars.",
    authorityIds: [
      "ASC_205_10_45_1_COMPARATIVES",
      "REG_SX_210_5_03_CAPTION_ORDER",
      "CON8_CH7_PR39_HOMOGENEITY",
    ],
  },
  {
    fn: "__runFinancialStatementsCoreTests",
    plainEnglish:
      "Runs the engine's own internal checks — money formatting, the five percent test, the wall " +
      "covering every account type, and the calendar arithmetic.",
    whyItExists:
      "These are the assumptions everything else is built on. They are checked inside the module so a " +
      "broken build fails loudly at the point of use rather than quietly producing wrong statements.",
    theTrap:
      "Trusting a test suite that has never been shown a real bug. Every numeric assertion in this " +
      "slice was proven capable of failing by deliberately breaking the engine and confirming the tests " +
      "noticed — including one occasion where a test asserted something that was simply not true.",
    whatIWouldDo:
      "If this ever throws, stop and read the message rather than working around it. It is telling you " +
      "that an assumption the rest of the statements rest on has stopped holding.",
    authorityIds: ["REG_SX_210_4_01_NOT_MISLEADING"],
  },
] as const;

export function lessonFor(fn: string): MentorLesson | undefined {
  return FINANCIAL_STATEMENT_LESSONS.find((l) => l.fn === fn);
}

export function taughtFunctionNames(): readonly string[] {
  return FINANCIAL_STATEMENT_LESSONS.map((l) => l.fn);
}

export function citedAuthorityIds(): readonly string[] {
  const out = new Set<string>();
  for (const l of FINANCIAL_STATEMENT_LESSONS) for (const id of l.authorityIds) out.add(id);
  return [...out].sort();
}

/**
 * Read the exported function names out of the core module ON DISK.
 *
 * Deliberately textual rather than importing the module and inspecting it.
 * Importing would only ever see what the module chose to export at runtime;
 * reading the source sees what a developer actually wrote, which is the thing
 * that needs to be covered.
 */
export function exportedCoreFunctionNames(): readonly string[] {
  const path = join(process.cwd(), "src", "lib", "accounting", "financial-statements-core.ts");
  const src = readFileSync(path, "utf8");
  const names: string[] = [];
  const re = /^export function ([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  let m: RegExpExecArray | null = re.exec(src);
  while (m !== null) {
    names.push(m[1]);
    m = re.exec(src);
  }
  return names;
}

/**
 * THE COVERAGE GATE (standing rule 26).
 *
 * Fails three ways, and all three matter:
 *   - zero functions found, which would mean the regex broke and the gate had
 *     started passing vacuously;
 *   - an exported function with no lesson;
 *   - a lesson for a function that no longer exists, which is how a mentor
 *     layer rots into describing code that was deleted years ago.
 */
export function assertEveryExportedFunctionIsTaught(): void {
  const exported = exportedCoreFunctionNames();
  if (exported.length === 0) {
    throw new Error(
      "financial-statements-mentor: found NO exported functions in financial-statements-core.ts. " +
        "The coverage gate cannot read the source, so it would pass without checking anything.",
    );
  }

  const taught = new Set(taughtFunctionNames());
  const untaught = exported.filter((n) => !taught.has(n));
  if (untaught.length > 0) {
    throw new Error(
      `financial-statements-mentor: these exported functions have no lesson: ${untaught.join(", ")}. ` +
        "Michael asked to be coached at every step, so a function that ships without an explanation is " +
        "an unfinished function (standing rule 26).",
    );
  }

  const exportedSet = new Set(exported);
  const orphans = taughtFunctionNames().filter((n) => !exportedSet.has(n));
  if (orphans.length > 0) {
    throw new Error(
      `financial-statements-mentor: these lessons teach functions that no longer exist: ${orphans.join(", ")}. ` +
        "A mentor layer that describes deleted code teaches something false.",
    );
  }
}
