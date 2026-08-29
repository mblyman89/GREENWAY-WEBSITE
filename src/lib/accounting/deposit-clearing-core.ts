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
 * Every way this entry can be silently wrong. Each is a REFUSAL, never a
 * warning: a warning that can be clicked past is not a control.
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
  /** The bank row and the counted cash are too far apart in time to be the same money. */
  | "DEPOSIT_DATE_TOO_FAR"
  /** A date that is not a real ISO date. */
  | "DEPOSIT_INVALID_DATE"
  /** This bank row already cleared something. */
  | "DEPOSIT_ALREADY_MATCHED";

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
  | { readonly kind: "journal"; readonly journal: DepositJournal; readonly explanation: string }
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
   * Total currently sitting in `10400`, in ledger convention (positive =
   * debit balance = cash counted but not yet banked). Supplied by the caller
   * because reading the ledger is I/O and this module is pure.
   */
  readonly undepositedBalanceMinor: number;
  /**
   * The business day of the OLDEST till close making up that balance, ISO
   * `YYYY-MM-DD`. Used only to refuse a pairing that is too far apart to be
   * the same money.
   */
  readonly oldestUndepositedDate: string;
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

  // ── What is actually waiting to be cleared ────────────────────────────────
  if (!Number.isInteger(input.undepositedBalanceMinor)) {
    return refuse(
      "DEPOSIT_NON_INTEGER_CENTS",
      "The Undeposited Funds balance is not a whole number of cents.",
    );
  }

  if (input.undepositedBalanceMinor <= 0) {
    return refuse(
      "DEPOSIT_NOTHING_UNDEPOSITED",
      "Nothing is sitting in Undeposited Funds, so there is no counted cash for " +
        "this deposit to clear. Either the drawer closes have not been " +
        "reconciled yet, or this money came from somewhere other than the tills.",
    );
  }

  if (depositMinor > input.undepositedBalanceMinor) {
    return refuse(
      "DEPOSIT_EXCEEDS_UNDEPOSITED",
      `The bank received ${money(depositMinor)} but only ` +
        `${money(input.undepositedBalanceMinor)} was counted out of the tills. ` +
        "Clearing the larger figure would credit Undeposited Funds below zero, " +
        "which says more cash left the drawers than was ever put in them.",
    );
  }

  // ── Are these plausibly the same money? ───────────────────────────────────
  const gap = daysApart(input.oldestUndepositedDate, row.date);
  if (gap === null) {
    return refuse(
      "DEPOSIT_INVALID_DATE",
      "One of those dates is not a real calendar date, so the two cannot be " +
        "compared.",
    );
  }

  if (gap > MATCH_WINDOW_HARD_DAYS) {
    return refuse(
      "DEPOSIT_DATE_TOO_FAR",
      `The oldest uncleared till cash is from ${input.oldestUndepositedDate} and ` +
        `this deposit is dated ${row.date} — ${gap} days apart. Beyond ` +
        `${MATCH_WINDOW_HARD_DAYS} days these are two events that happen to ` +
        "share a number, not the same money.",
    );
  }

  // ── The entry ─────────────────────────────────────────────────────────────
  // Two lines, summing to zero. Debit the bank because the money arrived there;
  // credit Undeposited Funds because it is no longer in limbo. No income line:
  // the revenue was recognised at the sale, and recognising it again here would
  // double the day's takings.
  const lines: DepositLine[] = [
    {
      lineNo: 1,
      accountCode: BANK_OPERATING_ACCOUNT,
      amountCents: depositMinor,
      description: `Deposit reached the bank ${row.date}`,
    },
    {
      lineNo: 2,
      accountCode: UNDEPOSITED_ACCOUNT,
      amountCents: -depositMinor,
      description: "Till cash cleared out of Undeposited Funds",
    },
  ];

  const remaining = input.undepositedBalanceMinor - depositMinor;
  const tail =
    remaining === 0
      ? "That clears Undeposited Funds back to zero."
      : `${money(remaining)} of counted cash is still waiting to reach the bank.`;

  return {
    kind: "journal",
    journal: {
      journalDate: row.date,
      sourceKind: DEPOSIT_SOURCE_KIND,
      sourceRef: depositSourceRef(row.transactionId),
      memo: `Deposit ${money(depositMinor)} cleared to bank`,
      lines,
    },
    explanation:
      `${money(depositMinor)} counted out of the tills reached the bank on ` +
      `${row.date}. This moves it out of Undeposited Funds and into the ` +
      `operating account. No income is recorded — the sale was already booked ` +
      `when it was rung up. ${tail}`,
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

function inputFixture(over: Partial<DepositInput> = {}): DepositInput {
  return {
    row: rowFixture(),
    eventKind: "deposit_of_sales",
    undepositedBalanceMinor: 50_000,
    oldestUndepositedDate: "2026-11-02",
    ...over,
  };
}

export function __runDepositClearingTests(): void {
  // ── the happy path ────────────────────────────────────────────────────────
  const ok = buildDepositClearingJournal(inputFixture());
  expect("a settled sales deposit produces a journal", ok.kind === "journal");
  if (ok.kind !== "journal") return;

  expect("two lines", ok.journal.lines.length === 2);
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

  // ── a partial deposit leaves the rest visible ─────────────────────────────
  const partial = buildDepositClearingJournal(
    inputFixture({ undepositedBalanceMinor: 80_000 }),
  );
  expect("a partial deposit still posts", partial.kind === "journal");
  if (partial.kind === "journal") {
    expect("and it names what is still outstanding",
      partial.explanation.includes("$300.00"));
  }

  // ── refusals ──────────────────────────────────────────────────────────────
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

  const nothing = buildDepositClearingJournal(
    inputFixture({ undepositedBalanceMinor: 0 }),
  );
  expect("nothing undeposited is refused",
    nothing.kind === "refused" && nothing.code === "DEPOSIT_NOTHING_UNDEPOSITED");

  const tooBig = buildDepositClearingJournal(
    inputFixture({ undepositedBalanceMinor: 10_000 }),
  );
  expect("a deposit bigger than the counted cash is refused",
    tooBig.kind === "refused" && tooBig.code === "DEPOSIT_EXCEEDS_UNDEPOSITED");
  if (tooBig.kind === "refused") {
    expect("and it shows both figures",
      tooBig.explanation.includes("$500.00") && tooBig.explanation.includes("$100.00"));
  }

  const far = buildDepositClearingJournal(
    inputFixture({ oldestUndepositedDate: "2026-08-01" }),
  );
  expect("a pairing 30+ days apart is refused",
    far.kind === "refused" && far.code === "DEPOSIT_DATE_TOO_FAR");

  const dup = buildDepositClearingJournal(inputFixture({ alreadyMatched: true }));
  expect("a bank row that already cleared is refused",
    dup.kind === "refused" && dup.code === "DEPOSIT_ALREADY_MATCHED");

  // An exact-size deposit is the normal case and must NOT trip the exceeds
  // guard: `>` and `>=` differ by exactly the everyday scenario.
  const exact = buildDepositClearingJournal(
    inputFixture({ undepositedBalanceMinor: 50_000 }),
  );
  expect("banking exactly what was counted is allowed", exact.kind === "journal");

  console.log("deposit-clearing-core self-tests: all passed");
}
