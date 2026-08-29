/**
 * src/lib/accounting/deposit-clearing-core.ts
 *
 * THE SECOND LEG OF THE CASH TRAIL: clearing `10400 Undeposited Funds` when the
 * money actually lands at the bank.
 *
 * WHAT THIS FIXES, AND WHY IT IS URGENT AFTER books-94
 * ----------------------------------------------------
 * books-94 wired the drawer close. Every reconciled shift now DEBITS
 * `10400 Undeposited Funds` with the day's takings. Nothing credits it. Grep
 * `10400` across `src/` before this file and the only writers are the close
 * builder and its specimen panel.
 *
 * An asset account that is only ever debited is not a slow leak, it is a
 * permanent and growing lie: the balance sheet claims the business is holding
 * cash in a drawer-to-bank limbo that in reality was banked weeks ago, and the
 * same dollar is then counted a second time when the bank balance is read.
 * books-94 was a half. This is the other half, and it is the half that makes
 * the first one safe.
 *
 * WHY THIS USES THE 0189 MATCHING VOCABULARY AND THE EXPENSE PATH DID NOT
 * ----------------------------------------------------------------------
 * `bank-expense-service.ts` records, deliberately and at length, that it does
 * NOT use migration 0189's matching suite, because matching means "this bank
 * row and this EXISTING journal are the same money" and the bank-expense family
 * has no in-system counterpart — the feed is the only source, so there is
 * nothing to match TO.
 *
 * THE DEPOSIT IS THE EXACT OPPOSITE CASE, and that is why this file exists
 * rather than an extra branch in the expense path. The in-system counterpart
 * now exists: books-94 created it. A deposit is a bank row that must be matched
 * to till closes that were already posted. The recorded reasoning is not
 * contradicted here, it is completed — 0189's own whitelist already names
 * `10400` as a matchable account (migration 0189, lines 636 and 834), which is
 * the schema saying this leg was always meant to arrive.
 *
 * THE SIGN WALL — READ BEFORE CHANGING ANY ARITHMETIC
 * ---------------------------------------------------
 * There are two opposite money-sign conventions in this database:
 *
 *     plaid_transactions.amount_cents : POSITIVE = money LEFT the account
 *     gl_journal_lines.amount_cents   : POSITIVE = DEBIT
 *
 * A deposit ARRIVES, so it is Plaid-NEGATIVE and must become a ledger-POSITIVE
 * debit to `10200`. This module does NOT perform that negation itself. It calls
 * `plaidToLedgerCashCents` in `bank-match-core.ts`, which the module header
 * there names as the ONLY sanctioned crossing in the repository, and which the
 * database re-checks independently via `gl_bank_sign_agrees()`.
 *
 * This matters more here than almost anywhere else in the system, because of
 * the failure mode recorded in standing rule 19: this business has ALREADY had
 * backwards signs once, in the Sage books. A wrongly-signed match STILL
 * BALANCES. Debits still equal credits, nothing errors, no screen turns red.
 * The only symptom is a wrong tax return. So the sign is not re-derived here at
 * any cost — a second implementation of a negation is a second chance to get it
 * backwards.
 *
 * WHAT THIS MODULE REFUSES TO DECIDE
 * ----------------------------------
 * It does not guess which bank row is a deposit. A transfer in from Michael's
 * own account, an ATM settlement credit and a sales deposit are all money
 * arriving, and telling them apart from a descriptor is exactly the guess that
 * standing rule 1 forbids. The caller states the event kind; this module checks
 * that the stated kind is one this entry is allowed to book, and refuses the
 * rest by name.
 *
 * WHAT books-96 CHANGED, AND WHY
 * ------------------------------
 * books-95 credited `10400` with ONE lumped line. That was enough to make the
 * balance fall, but it threw away the only fact an auditor asks for: WHICH
 * DAYS did this deposit bank? It also left D-76 alive - nothing retired a
 * banked day, so the pool's "oldest uncleared" date never aged out and after
 * one month every deposit was refused as too old.
 *
 * So the credit is now split: ONE CREDIT LINE PER BUSINESS DAY the deposit
 * clears, oldest first, each line naming its day. The ledger itself now
 * answers "which days are in this bag", and a fully banked day genuinely
 * leaves the pool.
 *
 * THE OWNER'S PROCEDURE, WHICH THIS ENTRY IS SHAPED AROUND (rule 24)
 * -----------------------------------------------------------------
 *     "I will keep cash at the shop and start doing daily deposit bags. Even
 *     if I don't make it to the bank for 15 days, each deposit will still
 *     match the day it came from. I don't want to add complexity by routing
 *     money around before it hits the bank."
 *
 * Two consequences are wired in rather than assumed. First, a deposit is
 * EXPECTED to land on whole-day boundaries, so one that stops in the middle of
 * a day says the bag was broken open, and that earns a warning. Second, there
 * is no in-between account.
 *
 * DELIBERATE LIMIT: THERE IS NO HOME-SAFE ACCOUNT (rule 133f)
 * -----------------------------------------------------------
 * An obvious-looking design would add a `10150 Cash in Owner's Safe` between
 * the drawer and the bank, because that is physically where the money used to
 * sit. It is NOT built, and its absence is a decision, not an oversight:
 *
 *     "I don't want to include the home safe."
 *
 * Cash now stays at the shop in sealed daily bags. Adding an account for a
 * place the money no longer goes would create a balance nobody counts and
 * nobody clears - a second `10400` with the same one-way defect. If that ever
 * changes, the change is a new account plus a new leg, not a quiet reuse of
 * this one.
 *
 * MONEY RULE: integer CENTS, never a float.
 *
 * PURE. No I/O, no clock, no database. Every input is an argument.
 */

import {
  plaidToLedgerCashCents,
  bankDirection,
  daysApart,
  isOnOrAfterCutover,
  MATCH_WINDOW_HARD_DAYS,
  type BankRow,
} from "./bank-match-core";
import {
  allocateDepositFifo,
  clearedDayDescription,
  type UndepositedDay,
  type FifoAllocation,
} from "./deposit-fifo-core";

/** `10200 Bank — Operating`. Where the money actually lands. */
export const BANK_OPERATING_ACCOUNT = "10200";

/** `10400 Undeposited Funds`. The limbo books-94 fills and this file empties. */
export const UNDEPOSITED_ACCOUNT = "10400";

/**
 * The ledger `source_kind` for this entry. `bank` is in
 * APPROVAL_EXEMPT_SOURCE_KINDS, which is correct here for a reason worth
 * stating: this entry creates nothing and decides nothing. It moves a dollar
 * the owner already counted from one asset account to another asset account.
 * There is no income, no expense, no 280E consequence and no tax position for
 * an approver to weigh.
 */
export const DEPOSIT_SOURCE_KIND = "bank" as const;

/**
 * Every way this entry is REFUSED outright.
 *
 * books-95 said here that every one of these was a refusal and that "a warning
 * that can be clicked past is not a control." That sentence was too broad, and
 * the owner overruled the case it got wrong:
 *
 *     "For question 1, post with a warning."
 *
 * The reasoning behind the correction is worth keeping, because it is the test
 * for which bucket any future case belongs in. A refusal is right when posting
 * would write something FALSE - money arriving that did not arrive, a sale
 * counted twice, cash credited below zero. Every code below is one of those.
 *
 * A refusal is WRONG when the event really happened and the only complaint is
 * that the books find it surprising. Cash that sat in the shop for six weeks is
 * still cash that reached the bank; refusing it does not make the deposit go
 * away, it makes the deposit unrecordable, and the owner's next move is to
 * force it in somewhere it does not belong. A control that people route around
 * is worse than a loud note they read. So "this is odd" is a WARNING that
 * posts, and it is carried on the journal itself - see `DepositWarningCode`.
 */
export type DepositRefusalCode =
  /** The bank row shows money LEAVING. That is not a deposit. */
  | "DEPOSIT_WRONG_DIRECTION"
  /** Zero-dollar row. Nothing to clear. */
  | "DEPOSIT_ZERO_AMOUNT"
  /** Not whole cents. */
  | "DEPOSIT_NON_INTEGER_CENTS"
  /** Still pending: the amount and the date can both still change. */
  | "DEPOSIT_PENDING_ROW"
  /** Plaid withdrew the row. The right entry for an event that did not happen is none. */
  | "DEPOSIT_REMOVED_ROW"
  /** Dated before the line in the sand. Belongs to the Sage books. */
  | "DEPOSIT_PRE_CUTOVER"
  /** The caller says this row is something other than a sales deposit. */
  | "DEPOSIT_WRONG_EVENT_KIND"
  /** Nothing is sitting in 10400 to clear. */
  | "DEPOSIT_NOTHING_UNDEPOSITED"
  /** The deposit is larger than everything counted into 10400. */
  | "DEPOSIT_EXCEEDS_UNDEPOSITED"
  /** A day in the pool is zero or negative, so the pool disagrees with itself. */
  | "DEPOSIT_POOL_NOT_POSITIVE"
  /** The day-by-day split did not add up to the deposit. Never post an entry that limps. */
  | "DEPOSIT_ALLOCATION_MISMATCH"
  /** A date that is not a real ISO date. */
  | "DEPOSIT_INVALID_DATE"
  /** This bank row already cleared something. */
  | "DEPOSIT_ALREADY_MATCHED";

/**
 * Things that are TRUE, POSTED, and worth saying out loud.
 *
 * A warning never blocks the entry. It travels on the journal memo so it is
 * still there in a year when someone reads the ledger without this screen.
 */
export type DepositWarningCode =
  /**
   * The oldest cash in this deposit is more than `MATCH_WINDOW_HARD_DAYS` old.
   * books-95 refused this. The owner's decision was to post it and say so.
   */
  | "DEPOSIT_AGED_PAST_WINDOW"
  /**
   * The deposit ran out part-way through a business day, so one day's takings
   * are split across two bank deposits. Under the owner's stated procedure -
   * one sealed bag per business day - that should not happen, so it is a
   * signal that a bag was opened or a day was banked in pieces.
   */
  | "DEPOSIT_SPLITS_A_DAY";

export type DepositWarning = {
  readonly code: DepositWarningCode;
  readonly message: string;
};

/** One line of the entry, in ledger convention: positive = debit. */
export type DepositLine = {
  readonly lineNo: number;
  readonly accountCode: string;
  readonly amountCents: number;
  readonly description: string;
};

export type DepositJournal = {
  readonly journalDate: string;
  readonly sourceKind: typeof DEPOSIT_SOURCE_KIND;
  readonly sourceRef: string;
  readonly memo: string;
  readonly lines: readonly DepositLine[];
};

export type DepositResult =
  | {
      readonly kind: "journal";
      readonly journal: DepositJournal;
      readonly explanation: string;
      /** Empty when nothing is odd. Never used to block. */
      readonly warnings: readonly DepositWarning[];
      /** Which days this deposit banked, oldest first. */
      readonly allocation: FifoAllocation;
    }
  | {
      readonly kind: "refused";
      readonly code: DepositRefusalCode;
      readonly explanation: string;
    };

export type DepositInput = {
  /** The bank row, in PLAID convention (positive = money out). */
  readonly row: BankRow;
  /**
   * What the caller says this row is. Only `deposit_of_sales` may clear 10400.
   * Anything else is refused BY NAME rather than ignored.
   */
  readonly eventKind: string;
  /**
   * The pool in `10400`, ALREADY BROKEN DOWN BY BUSINESS DAY and sorted oldest
   * first. Supplied by the caller because reading the ledger is I/O.
   *
   * books-95 took a total and an oldest-date as two separate numbers. That let
   * a caller hand over a pair that could not both be true, and made the total
   * the only thing the entry could talk about. The days ARE the pool: the
   * balance is their sum and the oldest date is the first one, so neither can
   * drift from the other.
   */
  readonly days: readonly UndepositedDay[];
  /** True when this bank row has already cleared a deposit. */
  readonly alreadyMatched?: boolean;
};

/** Cents as `$1,234.56`, for sentences a human reads. */
export function money(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const part = String(abs % 100).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${grouped}.${part}`;
}

function refuse(code: DepositRefusalCode, explanation: string): DepositResult {
  return { kind: "refused", code, explanation };
}

/**
 * Build the entry that moves counted cash out of Undeposited Funds and into the
 * operating bank account, once the bank says the money arrived.
 *
 * Returns a REFUSAL rather than throwing, because every refusal here is a
 * sentence the owner needs to read, not a stack trace.
 */
export function buildDepositClearingJournal(input: DepositInput): DepositResult {
  const { row } = input;

  // ── The bank row must be a real, settled, in-scope row ────────────────────
  if (!Number.isInteger(row.amountCents)) {
    return refuse(
      "DEPOSIT_NON_INTEGER_CENTS",
      "That bank amount is not a whole number of cents, so it cannot be booked.",
    );
  }

  if (row.pending) {
    return refuse(
      "DEPOSIT_PENDING_ROW",
      "That deposit is still pending at the bank. A pending amount and date can " +
        "both still change, so booking it now would record a figure the bank may " +
        "contradict tomorrow.",
    );
  }

  if (row.removed) {
    return refuse(
      "DEPOSIT_REMOVED_ROW",
      "The bank withdrew that line, so the deposit did not happen. The correct " +
        "entry for an event that did not happen is no entry at all.",
    );
  }

  if (!isOnOrAfterCutover(row.date)) {
    return refuse(
      "DEPOSIT_PRE_CUTOVER",
      `That deposit is dated ${row.date}, which is before these books begin. ` +
        "Anything earlier belongs to the Sage books and to closed, filed years.",
    );
  }

  // ── The direction. This is the sign wall, and it is not re-derived here ───
  if (row.amountCents === 0) {
    return refuse(
      "DEPOSIT_ZERO_AMOUNT",
      "That bank row is for zero dollars, so there is nothing to clear.",
    );
  }

  if (bankDirection(row.amountCents) !== "money_in") {
    return refuse(
      "DEPOSIT_WRONG_DIRECTION",
      "Money LEFT the account on that row, so it is a payment rather than a " +
        "deposit. Clearing Undeposited Funds with it would say cash arrived at " +
        "the bank when the opposite happened.",
    );
  }

  // The ONE sanctioned crossing between Plaid signs and ledger signs. A deposit
  // is Plaid-negative and must come back positive (a debit to the bank).
  const depositMinor = plaidToLedgerCashCents(row.amountCents);

  // ── What the caller says this row IS ──────────────────────────────────────
  if (input.eventKind !== "deposit_of_sales") {
    return refuse(
      "DEPOSIT_WRONG_EVENT_KIND",
      `That row is recorded as "${input.eventKind}", not a deposit of sales. ` +
        "Money arriving from a transfer between your own accounts, an ATM " +
        "settlement or an owner contribution is not till cash, and clearing " +
        "Undeposited Funds with it would hide that the takings never arrived.",
    );
  }

  if (input.alreadyMatched === true) {
    return refuse(
      "DEPOSIT_ALREADY_MATCHED",
      "That bank line has already cleared a deposit. Using it twice would " +
        "empty Undeposited Funds for money that only arrived once.",
    );
  }

  // ── What is actually waiting to be cleared ──────────────────────────────
  // The pool is a list of days, so every check below is asked of the days
  // themselves. There is no separate "balance" that could disagree with them.
  for (const d of input.days) {
    if (!Number.isInteger(d.amountMinor)) {
      return refuse(
        "DEPOSIT_NON_INTEGER_CENTS",
        `The counted cash for ${d.date} is not a whole number of cents.`,
      );
    }
    if (d.amountMinor <= 0) {
      // Rule 135: zero is an answer and it is the wrong one here. A day worth
      // nothing should have been dropped when the pool was folded; a day worth
      // less than nothing means more was banked for it than was ever counted.
      // Either way the pool disagrees with itself, and silently skipping the
      // day would bank the discrepancy.
      return refuse(
        "DEPOSIT_POOL_NOT_POSITIVE",
        `Undeposited Funds shows ${money(d.amountMinor)} for ${d.date}. A day ` +
          "waiting to be banked must be worth more than nothing, so the books " +
          "disagree with themselves and nothing was cleared against them.",
      );
    }
  }

  const poolMinor = input.days.reduce((a, d) => a + d.amountMinor, 0);

  if (poolMinor <= 0) {
    return refuse(
      "DEPOSIT_NOTHING_UNDEPOSITED",
      "Nothing is sitting in Undeposited Funds, so there is no counted cash for " +
        "this deposit to clear. Either the drawer closes have not been " +
        "reconciled yet, or this money came from somewhere other than the tills.",
    );
  }

  if (depositMinor > poolMinor) {
    return refuse(
      "DEPOSIT_EXCEEDS_UNDEPOSITED",
      `The bank received ${money(depositMinor)} but only ${money(poolMinor)} ` +
        "was counted out of the tills. Clearing the larger figure would credit " +
        "Undeposited Funds below zero, which says more cash left the drawers " +
        "than was ever put in them.",
    );
  }

  // ── Split it across the days it came from, oldest first ──────────────────────────────
  const allocation = allocateDepositFifo(depositMinor, input.days);

  // The split must account for every cent. If it does not, something upstream
  // is wrong in a way this module cannot see, and a journal that limps is worse
  // than no journal: it balances, so nothing downstream would ever notice.
  //
  // THIS GUARD CANNOT CURRENTLY FIRE, AND THAT IS STATED ON PURPOSE (133f).
  // Every day above is positive, the pool is positive, and the deposit is no
  // larger than the pool, so FIFO cannot come up short. A books-96 mutation
  // probe proved it: disabling this branch changed no test, because no input
  // reaches it. It is kept as belt-and-braces against a future change to the
  // guards above, and the invariant it depends on is asserted directly by a
  // property test rather than left to this unreachable line to notice.
  if (allocation.appliedMinor !== depositMinor) {
    return refuse(
      "DEPOSIT_ALLOCATION_MISMATCH",
      `The deposit is ${money(depositMinor)} but only ` +
        `${money(allocation.appliedMinor)} could be matched to counted days. ` +
        "Nothing was posted, because an entry that quietly drops the difference " +
        "would still balance and nobody would ever find it.",
    );
  }

  // ── Is this pairing plausible in time? ──────────────────────────────
  const oldestBanked = allocation.days[0]?.date ?? null;
  if (oldestBanked === null) {
    return refuse(
      "DEPOSIT_NOTHING_UNDEPOSITED",
      "No counted day was matched to this deposit, so there is nothing to clear.",
    );
  }

  const gap = daysApart(oldestBanked, row.date);
  if (gap === null) {
    return refuse(
      "DEPOSIT_INVALID_DATE",
      "One of those dates is not a real calendar date, so the two cannot be " +
        "compared.",
    );
  }

  // ── Warnings: true, posted, and said out loud ──────────────────────────────
  const warnings: DepositWarning[] = [];

  if (gap > MATCH_WINDOW_HARD_DAYS) {
    // books-95 REFUSED this. The owner overruled it: "For question 1, post with
    // a warning." The deposit really happened, and refusing a real deposit does
    // not un-happen it - it teaches people to book the money somewhere it does
    // not belong. So it posts, and the note rides on the journal.
    warnings.push({
      code: "DEPOSIT_AGED_PAST_WINDOW",
      message:
        `The oldest cash in this deposit is from ${oldestBanked}, ${gap} days ` +
        `before it reached the bank on ${row.date}. Anything past ` +
        `${MATCH_WINDOW_HARD_DAYS} days is worth a second look: cash that sits ` +
        "that long is usually a bag that was missed, not a bag that was late. " +
        "It was posted anyway, because the money did arrive.",
    });
  }

  const partialDay = allocation.days.find((d) => !d.full);
  if (partialDay !== undefined) {
    warnings.push({
      code: "DEPOSIT_SPLITS_A_DAY",
      message:
        `This deposit covers only ${money(partialDay.appliedMinor)} of the ` +
        `${money(partialDay.dayTotalMinor)} counted on ${partialDay.date}, so ` +
        "that day's takings are split across two bank deposits. With one sealed " +
        "bag per business day that should not happen, so either a bag was " +
        "opened or part of the day was banked separately.",
    });
  }

  // ── The entry ──────────────────────────────
  // ONE debit to the bank, then ONE CREDIT PER BUSINESS DAY this deposit
  // banked. The whole thing sums to zero. No income line: the revenue was
  // recognised at the sale, and recognising it again would double the takings.
  //
  // WHY THE CREDIT IS SPLIT rather than lumped. books-95 wrote a single credit,
  // which balanced but recorded nothing about WHICH days were in the bag. Three
  // things now depend on the split, and none can be recovered later from a
  // lumped line: an auditor can tie one bank credit to named Z-reports; a fully
  // banked day genuinely retires from the pool, which is D-76; and the aging
  // figure comes to mean the oldest day still OPEN rather than the oldest day
  // that ever existed.
  //
  // Each credit carries its day in the description via `clearedDayDescription`,
  // because the journal header is dated when the BANK received the money, which
  // is exactly the date that differs from the business day.
  const lines: DepositLine[] = [
    {
      lineNo: 1,
      accountCode: BANK_OPERATING_ACCOUNT,
      amountCents: depositMinor,
      description: `Deposit reached the bank ${row.date}`,
    },
    // `amount_cents` carries a `<> 0` check in the schema, and a day worth zero
    // was refused above, so every line here is non-zero by construction.
    ...allocation.days.map((d, i) => ({
      lineNo: i + 2,
      accountCode: UNDEPOSITED_ACCOUNT,
      amountCents: -d.appliedMinor,
      description: clearedDayDescription(d.date),
    })),
  ];

  const remaining = allocation.remainingMinor;
  const tail =
    remaining === 0
      ? "That clears Undeposited Funds back to zero."
      : `${money(remaining)} of counted cash is still waiting to reach the bank.`;

  // Name the days in the sentence, not only in the lines. The owner reads the
  // sentence; the auditor reads the lines. Both must say the same thing.
  const dayList = allocation.days.map((d) => d.date).join(", ");
  const covers =
    allocation.days.length === 1
      ? `It covers the takings counted on ${dayList}.`
      : `It covers ${allocation.days.length} business days: ${dayList}.`;

  const memoWarn =
    warnings.length === 0 ? "" : ` [${warnings.map((w) => w.code).join(" ")}]`;

  return {
    kind: "journal",
    journal: {
      journalDate: row.date,
      sourceKind: DEPOSIT_SOURCE_KIND,
      sourceRef: depositSourceRef(row.transactionId),
      // The warning code rides on the memo so it survives in the ledger itself.
      // A warning that exists only on the screen that posted it is gone the
      // moment the screen closes.
      memo: `Deposit ${money(depositMinor)} cleared to bank${memoWarn}`,
      lines,
    },
    explanation:
      `${money(depositMinor)} counted out of the tills reached the bank on ` +
      `${row.date}. ${covers} This moves it out of Undeposited Funds and into ` +
      `the operating account. No income is recorded — the sale was already ` +
      `booked when it was rung up. ${tail}`,
    warnings,
    allocation,
  };
}

/** The prefix that keeps this event's refs from colliding with any other. */
export const DEPOSIT_SOURCE_PREFIX = "deposit-clear";

/**
 * The idempotency key. The Plaid `transaction_id` is unique in the table and
 * stable for the life of a settled transaction, so a replay of the same bank
 * row can never produce a second entry.
 */
export function depositSourceRef(transactionId: string): string {
  return `${DEPOSIT_SOURCE_PREFIX}:${transactionId}`;
}

/* ===========================================================================
 * SELF-TESTS (rule: a pure module proves itself without a database)
 * ======================================================================== */

function expect(what: string, cond: boolean): void {
  if (!cond) throw new Error(`deposit-clearing-core self-test FAILED: ${what}`);
}

function rowFixture(over: Partial<BankRow> = {}): BankRow {
  return {
    transactionId: "txn_dep_1",
    accountId: "acct_1",
    // PLAID CONVENTION: negative = money came IN. A deposit of $500.00.
    amountCents: -50_000,
    date: "2026-11-03",
    name: "DEPOSIT",
    pending: false,
    removed: false,
    ...over,
  };
}

/**
 * The pool as DAYS. The default is the ordinary case: one sealed bag, one
 * business day, banked the next morning.
 */
function daysFixture(): UndepositedDay[] {
  return [{ date: "2026-11-02", amountMinor: 50_000, sourceRef: "till-close:s1" }];
}

function inputFixture(over: Partial<DepositInput> = {}): DepositInput {
  return {
    row: rowFixture(),
    eventKind: "deposit_of_sales",
    days: daysFixture(),
    ...over,
  };
}

export function __runDepositClearingTests(): void {
  // ── the happy path ──────────────────────────────
  const ok = buildDepositClearingJournal(inputFixture());
  expect("a settled sales deposit produces a journal", ok.kind === "journal");
  if (ok.kind !== "journal") return;

  expect("one day banked means two lines", ok.journal.lines.length === 2);
  expect(
    "the entry sums to zero",
    ok.journal.lines.reduce((a, l) => a + l.amountCents, 0) === 0,
  );

  const bank = ok.journal.lines.find((l) => l.accountCode === BANK_OPERATING_ACCOUNT);
  const und = ok.journal.lines.find((l) => l.accountCode === UNDEPOSITED_ACCOUNT);
  expect("the bank account is debited", bank !== undefined && bank.amountCents === 50_000);
  expect("undeposited funds is credited", und !== undefined && und.amountCents === -50_000);

  // THE SIGN WALL, asserted as a value and not as a comment. A Plaid-negative
  // (money in) row must become a ledger-POSITIVE debit. If this ever inverts,
  // the entry still balances and nothing else in the system will notice.
  expect("money IN becomes a DEBIT to the bank", (bank?.amountCents ?? 0) > 0);

  expect("no income line is invented", ok.journal.lines.every((l) =>
    l.accountCode === BANK_OPERATING_ACCOUNT || l.accountCode === UNDEPOSITED_ACCOUNT));
  expect("the explanation says the sale was already booked",
    ok.explanation.includes("already booked"));
  expect("a full clear says so", ok.explanation.includes("back to zero"));
  expect("the ref is the plaid id", ok.journal.sourceRef === "deposit-clear:txn_dep_1");
  expect("an ordinary deposit warns about nothing", ok.warnings.length === 0);
  expect("and the memo stays clean", !ok.journal.memo.includes("["));

  // ── the credit names the day it cleared, not the day it banked ──────────────────────────────
  // This is the D-76 fix seen from the outside. The journal is dated 2026-11-03
  // (the bank), the day banked is 2026-11-02 (the till). If the credit carried
  // the journal date it would never cancel the debit it paid off.
  expect("the journal is dated when the bank got it", ok.journal.journalDate === "2026-11-03");
  expect("but the credit names the business day",
    und?.description === clearedDayDescription("2026-11-02"));
  expect("and the sentence names it too", ok.explanation.includes("2026-11-02"));

  // ── a deposit covering several days gets a credit for each ──────────────────────────────
  const threeDays: UndepositedDay[] = [
    { date: "2026-11-01", amountMinor: 30_000, sourceRef: "till-close:a" },
    { date: "2026-11-02", amountMinor: 10_000, sourceRef: "till-close:b" },
    { date: "2026-11-03", amountMinor: 10_000, sourceRef: "till-close:c" },
  ];
  const multi = buildDepositClearingJournal(inputFixture({ days: threeDays }));
  expect("a three-day bag posts", multi.kind === "journal");
  if (multi.kind === "journal") {
    const credits = multi.journal.lines.filter(
      (l) => l.accountCode === UNDEPOSITED_ACCOUNT);
    expect("one credit per day, not one lump", credits.length === 3);
    expect("the debit is still a single line",
      multi.journal.lines.filter((l) => l.accountCode === BANK_OPERATING_ACCOUNT).length === 1);
    expect("it still sums to zero",
      multi.journal.lines.reduce((a, l) => a + l.amountCents, 0) === 0);
    expect("line numbers are unique and dense",
      new Set(multi.journal.lines.map((l) => l.lineNo)).size === 4 &&
      Math.max(...multi.journal.lines.map((l) => l.lineNo)) === 4);
    expect("every credit names a distinct day",
      new Set(credits.map((l) => l.description)).size === 3);
    expect("the days are named oldest first",
      credits[0].description === clearedDayDescription("2026-11-01") &&
      credits[2].description === clearedDayDescription("2026-11-03"));
    expect("and the sentence counts them", multi.explanation.includes("3 business days"));
    expect("a whole-day bag warns about nothing", multi.warnings.length === 0);
  }

  // ── oldest first is not decorative ──────────────────────────────
  // Handed the same days, a deposit too small to cover them all must take the
  // OLDEST, leaving the newest open. If this ever became newest-first the pool
  // would age forever while the totals stayed perfect.
  const partialPool = buildDepositClearingJournal(
    inputFixture({ row: rowFixture({ amountCents: -30_000 }), days: threeDays }),
  );
  expect("a short deposit still posts", partialPool.kind === "journal");
  if (partialPool.kind === "journal") {
    const credits = partialPool.journal.lines.filter(
      (l) => l.accountCode === UNDEPOSITED_ACCOUNT);
    expect("it clears exactly the oldest day",
      credits.length === 1 && credits[0].description === clearedDayDescription("2026-11-01"));
    expect("and 2026-11-02 is now the oldest still open",
      partialPool.allocation.oldestOpenDate === "2026-11-02");
    expect("the rest is reported as still waiting",
      partialPool.allocation.remainingMinor === 20_000);
  }

  // ── a partial deposit leaves the rest visible ──────────────────────────────
  const partial = buildDepositClearingJournal(
    inputFixture({
      days: [
        { date: "2026-11-01", amountMinor: 50_000, sourceRef: "till-close:a" },
        { date: "2026-11-02", amountMinor: 30_000, sourceRef: "till-close:b" },
      ],
    }),
  );
  expect("a partial deposit still posts", partial.kind === "journal");
  if (partial.kind === "journal") {
    expect("and it names what is still outstanding",
      partial.explanation.includes("$300.00"));
  }

  // ── WARNINGS: true, posted, and said out loud ──────────────────────────────
  // Michael: "For question 1, post with a warning." Aged cash must POST.
  const aged = buildDepositClearingJournal(
    inputFixture({
      days: [{ date: "2026-08-01", amountMinor: 50_000, sourceRef: "till-close:old" }],
    }),
  );
  expect("cash older than the window POSTS, it is not refused",
    aged.kind === "journal");
  if (aged.kind === "journal") {
    expect("and it carries the aged warning",
      aged.warnings.some((w) => w.code === "DEPOSIT_AGED_PAST_WINDOW"));
    expect("the warning names the day and the gap",
      aged.warnings[0].message.includes("2026-08-01") &&
      aged.warnings[0].message.includes("94 days"));
    expect("the warning survives on the journal memo",
      aged.journal.memo.includes("DEPOSIT_AGED_PAST_WINDOW"));
    expect("and it still says the money arrived",
      aged.warnings[0].message.includes("posted anyway"));
  }

  // Half a day banked = a bag was opened. True, posted, worth saying.
  const splitDay = buildDepositClearingJournal(
    inputFixture({
      row: rowFixture({ amountCents: -20_000 }),
      days: [{ date: "2026-11-02", amountMinor: 50_000, sourceRef: "till-close:s1" }],
    }),
  );
  expect("banking half a day POSTS", splitDay.kind === "journal");
  if (splitDay.kind === "journal") {
    expect("and warns that the day was split",
      splitDay.warnings.some((w) => w.code === "DEPOSIT_SPLITS_A_DAY"));
    expect("naming both figures",
      splitDay.warnings[0].message.includes("$200.00") &&
      splitDay.warnings[0].message.includes("$500.00"));
    expect("the day stays open because it was not fully banked",
      splitDay.allocation.oldestOpenDate === "2026-11-02");
  }

  // ── refusals ──────────────────────────────
  const outflow = buildDepositClearingJournal(
    inputFixture({ row: rowFixture({ amountCents: 50_000 }) }),
  );
  expect("money going OUT is refused",
    outflow.kind === "refused" && outflow.code === "DEPOSIT_WRONG_DIRECTION");

  const zero = buildDepositClearingJournal(
    inputFixture({ row: rowFixture({ amountCents: 0 }) }),
  );
  expect("a zero row is refused",
    zero.kind === "refused" && zero.code === "DEPOSIT_ZERO_AMOUNT");

  const pending = buildDepositClearingJournal(
    inputFixture({ row: rowFixture({ pending: true }) }),
  );
  expect("a pending row is refused",
    pending.kind === "refused" && pending.code === "DEPOSIT_PENDING_ROW");

  const removed = buildDepositClearingJournal(
    inputFixture({ row: rowFixture({ removed: true }) }),
  );
  expect("a removed row is refused",
    removed.kind === "refused" && removed.code === "DEPOSIT_REMOVED_ROW");

  const old = buildDepositClearingJournal(
    inputFixture({ row: rowFixture({ date: "2025-12-31" }) }),
  );
  expect("a pre-cutover row is refused",
    old.kind === "refused" && old.code === "DEPOSIT_PRE_CUTOVER");

  const wrongKind = buildDepositClearingJournal(
    inputFixture({ eventKind: "own_transfer" }),
  );
  expect("a transfer is refused",
    wrongKind.kind === "refused" && wrongKind.code === "DEPOSIT_WRONG_EVENT_KIND");
  if (wrongKind.kind === "refused") {
    expect("and the refusal names the kind it saw",
      wrongKind.explanation.includes("own_transfer"));
  }

  const nothing = buildDepositClearingJournal(inputFixture({ days: [] }));
  expect("nothing undeposited is refused",
    nothing.kind === "refused" && nothing.code === "DEPOSIT_NOTHING_UNDEPOSITED");

  const tooBig = buildDepositClearingJournal(
    inputFixture({
      days: [{ date: "2026-11-02", amountMinor: 10_000, sourceRef: "till-close:s1" }],
    }),
  );
  expect("a deposit bigger than the counted cash is refused",
    tooBig.kind === "refused" && tooBig.code === "DEPOSIT_EXCEEDS_UNDEPOSITED");
  if (tooBig.kind === "refused") {
    expect("and it shows both figures",
      tooBig.explanation.includes("$500.00") && tooBig.explanation.includes("$100.00"));
  }

  // A day worth zero or less means the pool contradicts itself. Rule 135: that
  // is a question, and the answer is not "skip the day and bank the rest".
  const negDay = buildDepositClearingJournal(
    inputFixture({
      days: [
        { date: "2026-11-01", amountMinor: -1, sourceRef: "till-close:a" },
        { date: "2026-11-02", amountMinor: 50_001, sourceRef: "till-close:b" },
      ],
    }),
  );
  expect("a negative day is refused, not netted away",
    negDay.kind === "refused" && negDay.code === "DEPOSIT_POOL_NOT_POSITIVE");

  const zeroDay = buildDepositClearingJournal(
    inputFixture({
      days: [
        { date: "2026-11-01", amountMinor: 0, sourceRef: "till-close:a" },
        { date: "2026-11-02", amountMinor: 50_000, sourceRef: "till-close:b" },
      ],
    }),
  );
  expect("a zero day is refused too",
    zeroDay.kind === "refused" && zeroDay.code === "DEPOSIT_POOL_NOT_POSITIVE");

  const fractional = buildDepositClearingJournal(
    inputFixture({
      days: [{ date: "2026-11-02", amountMinor: 50_000.5, sourceRef: "till-close:s1" }],
    }),
  );
  expect("a fractional day is refused",
    fractional.kind === "refused" && fractional.code === "DEPOSIT_NON_INTEGER_CENTS");

  const badDate = buildDepositClearingJournal(
    inputFixture({
      days: [{ date: "not-a-date", amountMinor: 50_000, sourceRef: "till-close:s1" }],
    }),
  );
  expect("an unparseable business day is refused",
    badDate.kind === "refused" && badDate.code === "DEPOSIT_INVALID_DATE");

  const dup = buildDepositClearingJournal(inputFixture({ alreadyMatched: true }));
  expect("a bank row that already cleared is refused",
    dup.kind === "refused" && dup.code === "DEPOSIT_ALREADY_MATCHED");

  // An exact-size deposit is the normal case and must NOT trip the exceeds
  // guard: `>` and `>=` differ by exactly the everyday scenario.
  const exact = buildDepositClearingJournal(inputFixture());
  expect("banking exactly what was counted is allowed", exact.kind === "journal");

  // One cent over is the other side of that boundary.
  const oneOver = buildDepositClearingJournal(
    inputFixture({ row: rowFixture({ amountCents: -50_001 }) }),
  );
  expect("one cent more than was counted is refused",
    oneOver.kind === "refused" && oneOver.code === "DEPOSIT_EXCEEDS_UNDEPOSITED");

  console.log("deposit-clearing-core self-tests: all passed");
}
