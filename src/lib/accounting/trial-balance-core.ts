/**
 * src/lib/accounting/trial-balance-core.ts   (slice F4)
 *
 * THE TRIAL BALANCE — the first slice where the books can be READ, not just
 * written to. PURE: no I/O, no `server-only`, no Supabase. Every function here
 * is a decision or a computation, so all of it is testable without a database.
 *
 * ---------------------------------------------------------------------------
 * THE ONE THING THAT MATTERS MOST IN THIS FILE
 * ---------------------------------------------------------------------------
 * A trial balance that foots to zero is NOT proof that it is correct.
 *
 * This is the single most dangerous misconception in computerised bookkeeping,
 * and it is exactly the shape of the drift Michael already lived through. Any
 * SUBSET of a double-entry ledger that happens to contain whole journals will
 * foot to zero, because every journal individually sums to zero. So a report
 * can omit half the ledger, or include entries that were cancelled, and still
 * display a triumphant "BALANCED".
 *
 * PROVEN BY EXECUTION, not by reasoning (standing rule 13a). Against a real
 * PostgreSQL with 0172+0173+0174 applied:
 *
 *   - Journal 1: a real sale.        cash +1,000.00, revenue -1,000.00  (posted)
 *   - Journal 2: a mistaken sale.    cash +2,500.00, revenue -2,500.00  (reversed)
 *   - Journal 3: the reversal of #2. cash -2,500.00, revenue +2,500.00  (posted)
 *
 * The TRUTH is cash +1,000.00 / revenue -1,000.00.
 *
 * Filtering on `status = 'posted'` — the obvious, natural thing to write —
 * produced:
 *
 *      10100 Cash on Hand — Vault      -1,500.00      <-- WRONG
 *      50010 Sales — Flower             1,500.00      <-- WRONG
 *      foots to 0  ->  "BALANCED"                     <-- AND IT LIED
 *
 * Because 0174's `trg_gl_mark_reversed` flips the ORIGINAL to status
 * 'reversed' while the REVERSAL itself stays 'posted', filtering on 'posted'
 * keeps the reversal and drops the thing it was reversing. You are left with
 * one naked half of a cancelled pair: $2,500 of negative cash and $2,500 of
 * revenue that never existed. The report still balanced. Nothing warned.
 *
 * That is a fictional set of books that passes its own self-check.
 *
 * THE RULE, therefore, and it is not negotiable:
 *
 *     A trial balance includes journals with status 'posted' OR 'reversed'.
 *     Never 'posted' alone. Never a draft, ever.
 *
 * Reversed journals KEEP their lines (0172 makes posted lines immutable), and
 * the matching reversal supplies the offsetting lines, so including both is
 * what nets a cancelled transaction to zero. That is also the GAAP-correct
 * presentation: ASC 250 says you correct by reversal, and the audit trail shows
 * both the error and its correction rather than pretending the error never
 * happened.
 *
 * `JOURNAL_STATUSES_IN_TRIAL_BALANCE` below is the single source of that truth,
 * and `assertTrialBalanceStatusFilter()` exists so the rule is enforced rather
 * than merely documented.
 *
 * ---------------------------------------------------------------------------
 * WHAT ELSE THIS FILE REFUSES TO DO
 * ---------------------------------------------------------------------------
 * - It will not present an out-of-balance trial balance as if it were fine.
 *   `buildTrialBalance` returns `balanced: false` AND a loud diagnosis. The UI
 *   is required to refuse to export an unbalanced TB (standing rule 14).
 * - It will not silently plug a difference (standing rule 12). There is no code
 *   path here that adds a balancing figure. If it does not tie, it says so.
 * - It will not mix entities. Four ledger entities exist and each files a
 *   different tax form; a combined trial balance across them is meaningless and
 *   is refused.
 * - It will not use floating point anywhere. Integer cents throughout.
 *
 * All money is integer cents. Debits are POSITIVE, credits are NEGATIVE
 * (0172's signed convention), so "debits equal credits" is the arithmetic fact
 * "the lines sum to zero".
 */

// ---------------------------------------------------------------------------
// 1) The status rule — the heart of this slice.
// ---------------------------------------------------------------------------

/** Journal statuses that exist in 0172. */
export const ALL_JOURNAL_STATUSES = ["draft", "posted", "reversed"] as const;
export type JournalStatus = (typeof ALL_JOURNAL_STATUSES)[number];

/**
 * The ONLY statuses a trial balance may include.
 *
 * See the file header for the executed proof of why 'posted' alone is wrong and
 * silently produces a balanced-but-fictional report.
 */
export const JOURNAL_STATUSES_IN_TRIAL_BALANCE: readonly JournalStatus[] = [
  "posted",
  "reversed",
];

/** True when a journal in this status belongs in a trial balance. */
export function isReportableStatus(status: string): boolean {
  return (JOURNAL_STATUSES_IN_TRIAL_BALANCE as readonly string[]).includes(status);
}

/**
 * Guard for any caller that builds its own status filter (a SQL WHERE clause, a
 * `.in()` on a query builder, a hand-written array).
 *
 * WHY THIS EXISTS: F3 shipped `requiresSecondApprover()` and `canSelfApprove()`
 * that nothing ever called. The rule existed and enforced nothing. This slice
 * does not repeat that: the status rule is not a comment, it is a function that
 * throws, and the tests prove it throws.
 *
 * Rejects: 'posted' alone (the dangerous default), any list containing 'draft',
 * an empty list, and unknown statuses.
 */
export function assertTrialBalanceStatusFilter(statuses: readonly string[]): void {
  if (!Array.isArray(statuses) || statuses.length === 0) {
    throw new Error(
      "TB_STATUS_FILTER_EMPTY: a trial balance must state which journal statuses it includes. An unfiltered ledger read would include unposted drafts.",
    );
  }
  for (const s of statuses) {
    if (!(ALL_JOURNAL_STATUSES as readonly string[]).includes(s)) {
      throw new Error(`TB_STATUS_FILTER_UNKNOWN: '${s}' is not a journal status.`);
    }
  }
  if (statuses.includes("draft")) {
    throw new Error(
      "TB_STATUS_FILTER_DRAFT: a draft journal has not been posted and must never appear in a trial balance.",
    );
  }
  const hasPosted = statuses.includes("posted");
  const hasReversed = statuses.includes("reversed");
  if (hasPosted && !hasReversed) {
    throw new Error(
      "TB_STATUS_FILTER_ORPHANS_REVERSALS: including 'posted' without 'reversed' drops every journal that was reversed while KEEPING its reversal. That leaves one naked half of a cancelled pair, which still foots to zero and still reports BALANCED while being wrong. Include both.",
    );
  }
  if (hasReversed && !hasPosted) {
    throw new Error(
      "TB_STATUS_FILTER_REVERSED_ONLY: including 'reversed' without 'posted' reports only entries that were cancelled.",
    );
  }
}

// ---------------------------------------------------------------------------
// 2) Types.
// ---------------------------------------------------------------------------

export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "income"
  | "cogs"
  | "expense"
  | "other_income"
  | "other_expense";

export type NormalBalance = "debit" | "credit";

/** One ledger line as it arrives from the database, already entity-filtered. */
export type LedgerLineInput = {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  /** Signed integer cents: positive = debit, negative = credit. */
  amountCents: number;
  /** Journal status; used to prove the caller filtered correctly. */
  status: string;
  /** Pacific business date, YYYY-MM-DD. */
  journalDate: string;
};

/** One row of the finished trial balance. */
export type TrialBalanceRow = {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  /** Net signed balance in cents (positive = net debit). */
  balanceCents: number;
  /** Presentation: the debit column, or 0. Always non-negative. */
  debitCents: number;
  /** Presentation: the credit column, or 0. Always non-negative. */
  creditCents: number;
  /** Number of ledger lines that produced this balance. */
  lineCount: number;
  /**
   * True when the balance sits on the OPPOSITE side from the account's normal
   * balance (e.g. a cash account with a credit balance). Not an error by
   * itself — a bank overdraft is real — but it is always worth a human's eye,
   * and negative inventory / negative ATM cash are on Michael's permanent
   * failure corpus (standing rule 19).
   */
  isAbnormal: boolean;
};

export type TrialBalance = {
  entityCode: string;
  fromDate: string;
  toDate: string;
  rows: TrialBalanceRow[];
  totalDebitCents: number;
  totalCreditCents: number;
  /** True only when total debits === total credits exactly. */
  balanced: boolean;
  /** Signed cents by which the TB fails to tie. Zero when balanced. */
  differenceCents: number;
  /** Accounts whose balance is on the wrong side of normal. */
  abnormalRows: TrialBalanceRow[];
  /** Total ledger lines included. */
  lineCount: number;
};

// ---------------------------------------------------------------------------
// 3) Date handling — no Date objects, no timezones, no drift.
// ---------------------------------------------------------------------------

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a YYYY-MM-DD string, INCLUDING that the day exists in that month.
 *
 * Deliberately string-based. `new Date("2026-02-30")` silently rolls forward to
 * March 2, which in a date-ranged financial report means quietly reporting the
 * wrong period. Leap years are handled explicitly, because a February 29 bug
 * appears once every four years — which is exactly when nobody is looking for it.
 */
export function isValidYmd(value: string): boolean {
  if (typeof value !== "string" || !YMD_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= lengths[month - 1];
}

/** Lexicographic comparison is correct for zero-padded YYYY-MM-DD. */
export function isOnOrBefore(a: string, b: string): boolean {
  return a <= b;
}

/** Inclusive on both ends — a TB "through 3/31" must include 3/31. */
export function isWithinRange(date: string, fromDate: string, toDate: string): boolean {
  return date >= fromDate && date <= toDate;
}

// ---------------------------------------------------------------------------
// 4) Presentation.
// ---------------------------------------------------------------------------

/**
 * Split a signed balance into the debit/credit columns a human reads.
 * Positive → debit column. Negative → credit column (as a positive number).
 * Zero → both columns zero.
 */
export function splitDebitCredit(balanceCents: number): {
  debitCents: number;
  creditCents: number;
} {
  if (!Number.isInteger(balanceCents)) {
    throw new Error(
      `TB_NON_INTEGER_CENTS: ${balanceCents} is not an integer. Money is integer cents; a fractional cent means a float leaked into a money path.`,
    );
  }
  if (balanceCents > 0) return { debitCents: balanceCents, creditCents: 0 };
  if (balanceCents < 0) return { debitCents: 0, creditCents: -balanceCents };
  return { debitCents: 0, creditCents: 0 };
}

/** The side a balance actually sits on. Zero has no side. */
export function sideOf(balanceCents: number): NormalBalance | "zero" {
  if (balanceCents > 0) return "debit";
  if (balanceCents < 0) return "credit";
  return "zero";
}

/**
 * True when a balance sits opposite its account's normal side. A zero balance
 * is never abnormal.
 */
export function isAbnormalBalance(
  balanceCents: number,
  normalBalance: NormalBalance,
): boolean {
  const side = sideOf(balanceCents);
  if (side === "zero") return false;
  return side !== normalBalance;
}

// ---------------------------------------------------------------------------
// 5) Building the trial balance.
// ---------------------------------------------------------------------------

export type BuildTrialBalanceInput = {
  entityCode: string;
  fromDate: string;
  toDate: string;
  lines: readonly LedgerLineInput[];
};

/**
 * Build a trial balance from ledger lines.
 *
 * REFUSES (never returns a soft result) when:
 *   - the entity code is blank
 *   - either date is malformed or impossible (2026-02-30, 2027-02-29)
 *   - the range runs backwards
 *   - any line carries a status not permitted in a trial balance (this is the
 *     wired enforcement of the rule in §1 — a caller that forgets the filter is
 *     stopped here rather than quietly producing a fictional report)
 *   - any line falls outside the requested date range
 *   - any amount is not an integer, or is zero (0172 forbids zero-value lines)
 *
 * It does NOT refuse an out-of-balance result: an unbalanced trial balance is a
 * REAL FINDING that Michael must see, not an exception to swallow. It is
 * reported with `balanced: false` and an exact difference. What the UI must
 * refuse is EXPORTING one.
 */
export function buildTrialBalance(input: BuildTrialBalanceInput): TrialBalance {
  const entityCode = (input.entityCode ?? "").trim();
  if (!entityCode) {
    throw new Error(
      "TB_NO_ENTITY: a trial balance is always for exactly one entity. Greenway, the ATM operation, the landholding and personal each file a different tax form; combining them produces a number that belongs on no return.",
    );
  }
  if (!isValidYmd(input.fromDate)) {
    throw new Error(`TB_BAD_FROM_DATE: '${input.fromDate}' is not a real calendar date (YYYY-MM-DD).`);
  }
  if (!isValidYmd(input.toDate)) {
    throw new Error(`TB_BAD_TO_DATE: '${input.toDate}' is not a real calendar date (YYYY-MM-DD).`);
  }
  if (!isOnOrBefore(input.fromDate, input.toDate)) {
    throw new Error(
      `TB_RANGE_BACKWARDS: the range starts ${input.fromDate} and ends ${input.toDate}. A backwards range silently returns nothing, which looks identical to "no activity".`,
    );
  }

  const byCode = new Map<string, TrialBalanceRow>();
  let lineCount = 0;

  for (const line of input.lines) {
    if (!isReportableStatus(line.status)) {
      throw new Error(
        `TB_UNREPORTABLE_STATUS: a line arrived from a journal with status '${line.status}'. A trial balance includes only ${JOURNAL_STATUSES_IN_TRIAL_BALANCE.join(" and ")}. See the proof in this file's header: filtering wrongly still foots to zero and still reports BALANCED.`,
      );
    }
    if (!isValidYmd(line.journalDate)) {
      throw new Error(`TB_BAD_LINE_DATE: a line carries the date '${line.journalDate}'.`);
    }
    if (!isWithinRange(line.journalDate, input.fromDate, input.toDate)) {
      throw new Error(
        `TB_LINE_OUT_OF_RANGE: a line dated ${line.journalDate} is outside ${input.fromDate}..${input.toDate}. The database query, not this function, must scope the period — silently dropping it here would hide a query bug.`,
      );
    }
    if (!Number.isInteger(line.amountCents)) {
      throw new Error(
        `TB_NON_INTEGER_CENTS: a line on ${line.accountCode} carries ${line.amountCents}. Money is integer cents.`,
      );
    }
    if (line.amountCents === 0) {
      throw new Error(
        `TB_ZERO_LINE: a line on ${line.accountCode} is zero. 0172 forbids zero-value lines; one here means the data did not come from the ledger.`,
      );
    }

    lineCount += 1;
    const existing = byCode.get(line.accountCode);
    if (existing) {
      // Same code must always describe the same account.
      if (existing.normalBalance !== line.normalBalance || existing.accountType !== line.accountType) {
        throw new Error(
          `TB_ACCOUNT_INCONSISTENT: account ${line.accountCode} arrived with two different definitions. One account code must mean one account.`,
        );
      }
      existing.balanceCents += line.amountCents;
      existing.lineCount += 1;
    } else {
      byCode.set(line.accountCode, {
        accountCode: line.accountCode,
        accountName: line.accountName,
        accountType: line.accountType,
        normalBalance: line.normalBalance,
        balanceCents: line.amountCents,
        debitCents: 0,
        creditCents: 0,
        lineCount: 1,
        isAbnormal: false,
      });
    }
  }

  const rows = Array.from(byCode.values()).sort((a, b) =>
    a.accountCode < b.accountCode ? -1 : a.accountCode > b.accountCode ? 1 : 0,
  );

  let totalDebitCents = 0;
  let totalCreditCents = 0;
  for (const row of rows) {
    const split = splitDebitCredit(row.balanceCents);
    row.debitCents = split.debitCents;
    row.creditCents = split.creditCents;
    row.isAbnormal = isAbnormalBalance(row.balanceCents, row.normalBalance);
    totalDebitCents += row.debitCents;
    totalCreditCents += row.creditCents;
  }

  const differenceCents = totalDebitCents - totalCreditCents;

  return {
    entityCode,
    fromDate: input.fromDate,
    toDate: input.toDate,
    rows,
    totalDebitCents,
    totalCreditCents,
    balanced: differenceCents === 0,
    differenceCents,
    abnormalRows: rows.filter((r) => r.isAbnormal),
    lineCount,
  };
}

// ---------------------------------------------------------------------------
// 6) Reading the result honestly.
// ---------------------------------------------------------------------------

export type TrialBalanceVerdict = {
  /** May this trial balance be exported / relied upon? */
  exportable: boolean;
  /** Plain English, written for Michael, not for a developer. */
  headline: string;
  /** Everything a human should look at before trusting the numbers. */
  warnings: string[];
};

/**
 * Turn a trial balance into a plain-English verdict.
 *
 * DESIGN NOTE, and it is deliberate: an EMPTY trial balance is reported as a
 * warning, never as success. Zero equals zero, so an empty TB technically
 * "balances" — and a report that says BALANCED when it read nothing at all is
 * precisely how a broken query masquerades as healthy books.
 */
export function describeTrialBalance(tb: TrialBalance): TrialBalanceVerdict {
  const warnings: string[] = [];

  if (tb.lineCount === 0) {
    return {
      exportable: false,
      headline: `No activity found for ${tb.entityCode} between ${tb.fromDate} and ${tb.toDate}. This is NOT a clean bill of health — an empty report balances trivially. Confirm the period and the entity are right before concluding there was nothing to report.`,
      warnings: [
        "Nothing was read from the ledger. Either there genuinely was no activity, or the period/entity is wrong, or the query failed.",
      ],
    };
  }

  if (!tb.balanced) {
    const off = tb.differenceCents;
    return {
      exportable: false,
      headline: `THE BOOKS DO NOT BALANCE. Debits exceed credits by ${off} cents (${tb.totalDebitCents} vs ${tb.totalCreditCents}) for ${tb.entityCode}, ${tb.fromDate} to ${tb.toDate}. This report cannot be used or exported until the cause is found.`,
      warnings: [
        "Every journal is forced to balance when it posts, so a trial balance that does not tie means lines were lost, double-counted, or read from outside the ledger. Do not adjust anything to make it tie — find the cause. A balancing plug is exactly how drift starts.",
      ],
    };
  }

  for (const row of tb.abnormalRows) {
    warnings.push(
      `${row.accountCode} ${row.accountName} normally carries a ${row.normalBalance} balance but currently sits on the ${sideOf(row.balanceCents)} side (${row.balanceCents} cents). Sometimes legitimate (an overdrawn bank account), sometimes the first visible sign of a real problem — negative inventory and negative ATM cash both look exactly like this.`,
    );
  }

  return {
    exportable: true,
    headline: `${tb.entityCode} balances for ${tb.fromDate} to ${tb.toDate}: ${tb.totalDebitCents} cents of debits against ${tb.totalCreditCents} cents of credits across ${tb.rows.length} accounts and ${tb.lineCount} lines.`,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 7) Self-tests (standing rules 13, 15, 16).
// ---------------------------------------------------------------------------

function expect(label: string, condition: boolean): void {
  if (!condition) throw new Error(`trial-balance-core self-test FAILED: ${label}`);
}

function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `trial-balance-core self-test FAILED: ${label} (expected ${String(expected)}, got ${String(actual)})`,
    );
  }
}

function throws(label: string, fn: () => unknown, mustInclude?: string): void {
  let threw = false;
  let message = "";
  try {
    fn();
  } catch (err) {
    threw = true;
    message = err instanceof Error ? err.message : String(err);
  }
  if (!threw) throw new Error(`trial-balance-core self-test FAILED: ${label} (nothing was thrown)`);
  if (mustInclude && !message.includes(mustInclude)) {
    throw new Error(
      `trial-balance-core self-test FAILED: ${label} threw the WRONG error. Expected it to mention '${mustInclude}', got: ${message}`,
    );
  }
}

/** A line builder so tests state only what they are actually testing. */
function line(over: Partial<LedgerLineInput> = {}): LedgerLineInput {
  return {
    accountCode: "10100",
    accountName: "Cash on Hand — Vault",
    accountType: "asset",
    normalBalance: "debit",
    amountCents: 100000,
    status: "posted",
    journalDate: "2026-03-01",
    ...over,
  };
}

export function __runTrialBalanceCoreTests(): void {
  // --- the status rule ---------------------------------------------------
  eq(JOURNAL_STATUSES_IN_TRIAL_BALANCE.length, 2, "exactly two reportable statuses");
  expect("posted is reportable", isReportableStatus("posted"));
  expect("reversed is reportable", isReportableStatus("reversed"));
  expect("draft is NOT reportable", !isReportableStatus("draft"));
  expect("nonsense is NOT reportable", !isReportableStatus("whatever"));

  // The dangerous default must be refused BY NAME.
  throws(
    "'posted' alone is refused (THE headline defect this slice exists to prevent)",
    () => assertTrialBalanceStatusFilter(["posted"]),
    "TB_STATUS_FILTER_ORPHANS_REVERSALS",
  );
  throws(
    "'reversed' alone is refused",
    () => assertTrialBalanceStatusFilter(["reversed"]),
    "TB_STATUS_FILTER_REVERSED_ONLY",
  );
  throws(
    "a filter including drafts is refused",
    () => assertTrialBalanceStatusFilter(["posted", "reversed", "draft"]),
    "TB_STATUS_FILTER_DRAFT",
  );
  throws(
    "an empty filter is refused",
    () => assertTrialBalanceStatusFilter([]),
    "TB_STATUS_FILTER_EMPTY",
  );
  throws(
    "an unknown status is refused",
    () => assertTrialBalanceStatusFilter(["posted", "reversed", "void"]),
    "TB_STATUS_FILTER_UNKNOWN",
  );
  // The correct filter passes, in either order.
  assertTrialBalanceStatusFilter(["posted", "reversed"]);
  assertTrialBalanceStatusFilter(["reversed", "posted"]);

  // --- dates -------------------------------------------------------------
  expect("a normal date is valid", isValidYmd("2026-03-01"));
  expect("2026-02-30 does not exist", !isValidYmd("2026-02-30"));
  expect("2027-02-29 does not exist (2027 is not a leap year)", !isValidYmd("2027-02-29"));
  expect("2028-02-29 DOES exist (2028 is a leap year)", isValidYmd("2028-02-29"));
  expect("2100-02-29 does not exist (century, not divisible by 400)", !isValidYmd("2100-02-29"));
  expect("2000-02-29 DOES exist (divisible by 400)", isValidYmd("2000-02-29"));
  expect("month 13 is refused", !isValidYmd("2026-13-01"));
  expect("month 00 is refused", !isValidYmd("2026-00-01"));
  expect("day 00 is refused", !isValidYmd("2026-01-00"));
  expect("April has no 31st", !isValidYmd("2026-04-31"));
  expect("December 31 is fine", isValidYmd("2026-12-31"));
  expect("an unpadded date is refused", !isValidYmd("2026-3-1"));
  expect("a slashed date is refused", !isValidYmd("2026/03/01"));
  expect("empty is refused", !isValidYmd(""));

  expect("range is inclusive at the start", isWithinRange("2026-03-01", "2026-03-01", "2026-03-31"));
  expect("range is inclusive at the end", isWithinRange("2026-03-31", "2026-03-01", "2026-03-31"));
  expect("a day before is outside", !isWithinRange("2026-02-28", "2026-03-01", "2026-03-31"));
  expect("a day after is outside", !isWithinRange("2026-04-01", "2026-03-01", "2026-03-31"));

  // --- debit/credit presentation -----------------------------------------
  eq(splitDebitCredit(500).debitCents, 500, "a positive balance is a debit");
  eq(splitDebitCredit(500).creditCents, 0, "a debit has no credit column");
  eq(splitDebitCredit(-500).creditCents, 500, "a negative balance is a credit, shown positive");
  eq(splitDebitCredit(-500).debitCents, 0, "a credit has no debit column");
  eq(splitDebitCredit(0).debitCents, 0, "zero has no debit");
  eq(splitDebitCredit(0).creditCents, 0, "zero has no credit");
  throws("a fractional cent is refused", () => splitDebitCredit(10.5), "TB_NON_INTEGER_CENTS");

  // SWEEP (standing rule 13d): across a wide range, the columns must always
  // reconstruct the original signed balance exactly. No cent invented or lost.
  for (let cents = -100000; cents <= 100000; cents += 137) {
    const { debitCents, creditCents } = splitDebitCredit(cents);
    eq(debitCents - creditCents, cents, `sweep reconstructs ${cents}`);
    expect(`sweep: debit column never negative at ${cents}`, debitCents >= 0);
    expect(`sweep: credit column never negative at ${cents}`, creditCents >= 0);
    expect(`sweep: only one column is used at ${cents}`, debitCents === 0 || creditCents === 0);
  }
  // Boundaries.
  eq(splitDebitCredit(Number.MAX_SAFE_INTEGER).debitCents, Number.MAX_SAFE_INTEGER, "max safe integer");
  eq(splitDebitCredit(-Number.MAX_SAFE_INTEGER).creditCents, Number.MAX_SAFE_INTEGER, "min safe integer");
  eq(splitDebitCredit(1).debitCents, 1, "one cent debit");
  eq(splitDebitCredit(-1).creditCents, 1, "one cent credit");

  // --- abnormal balances --------------------------------------------------
  expect("a debit account with a credit balance is abnormal", isAbnormalBalance(-100, "debit"));
  expect("a debit account with a debit balance is normal", !isAbnormalBalance(100, "debit"));
  expect("a credit account with a debit balance is abnormal", isAbnormalBalance(100, "credit"));
  expect("a credit account with a credit balance is normal", !isAbnormalBalance(-100, "credit"));
  expect("zero is never abnormal for a debit account", !isAbnormalBalance(0, "debit"));
  expect("zero is never abnormal for a credit account", !isAbnormalBalance(0, "credit"));

  // --- building -----------------------------------------------------------
  const simple = buildTrialBalance({
    entityCode: "greenway",
    fromDate: "2026-03-01",
    toDate: "2026-03-31",
    lines: [
      line({ amountCents: 100000 }),
      line({
        accountCode: "50010",
        accountName: "Sales — Flower",
        accountType: "income",
        normalBalance: "credit",
        amountCents: -100000,
      }),
    ],
  });
  expect("a simple TB balances", simple.balanced);
  eq(simple.differenceCents, 0, "no difference when balanced");
  eq(simple.totalDebitCents, 100000, "debit total");
  eq(simple.totalCreditCents, 100000, "credit total");
  eq(simple.rows.length, 2, "two accounts");
  eq(simple.lineCount, 2, "two lines");
  eq(simple.abnormalRows.length, 0, "nothing abnormal");
  eq(simple.rows[0].accountCode, "10100", "rows sort by account code");
  eq(simple.rows[1].accountCode, "50010", "rows sort by account code (2)");
  expect("a balanced TB is exportable", describeTrialBalance(simple).exportable);

  // Many lines on one account aggregate.
  const aggregated = buildTrialBalance({
    entityCode: "greenway",
    fromDate: "2026-03-01",
    toDate: "2026-03-31",
    lines: [
      line({ amountCents: 30000 }),
      line({ amountCents: 70000, journalDate: "2026-03-15" }),
      line({
        accountCode: "50010",
        accountName: "Sales — Flower",
        accountType: "income",
        normalBalance: "credit",
        amountCents: -100000,
      }),
    ],
  });
  eq(aggregated.rows.length, 2, "three lines collapse into two accounts");
  eq(aggregated.rows[0].balanceCents, 100000, "cash aggregates to 100000");
  eq(aggregated.rows[0].lineCount, 2, "cash shows two lines");
  expect("aggregated TB balances", aggregated.balanced);

  // ***** THE HEADLINE TEST *****
  // Reproduces the exact scenario proven against real PostgreSQL. Including the
  // reversed original nets the cancelled pair to zero and leaves the truth.
  const withReversal = buildTrialBalance({
    entityCode: "greenway",
    fromDate: "2026-03-01",
    toDate: "2026-03-31",
    lines: [
      // Journal 1 — the real sale, still posted.
      line({ amountCents: 100000 }),
      line({
        accountCode: "50010",
        accountName: "Sales — Flower",
        accountType: "income",
        normalBalance: "credit",
        amountCents: -100000,
      }),
      // Journal 2 — the mistake. Status flipped to 'reversed' by 0174's trigger.
      line({ amountCents: 250000, status: "reversed", journalDate: "2026-03-05" }),
      line({
        accountCode: "50010",
        accountName: "Sales — Flower",
        accountType: "income",
        normalBalance: "credit",
        amountCents: -250000,
        status: "reversed",
        journalDate: "2026-03-05",
      }),
      // Journal 3 — the reversal itself, posted.
      line({ amountCents: -250000, journalDate: "2026-03-05" }),
      line({
        accountCode: "50010",
        accountName: "Sales — Flower",
        accountType: "income",
        normalBalance: "credit",
        amountCents: 250000,
        journalDate: "2026-03-05",
      }),
    ],
  });
  expect("a TB containing a reversed pair still balances", withReversal.balanced);
  eq(
    withReversal.rows.find((r) => r.accountCode === "10100")!.balanceCents,
    100000,
    "THE HEADLINE: cash is 100000 (the real sale), NOT -150000 (what 'posted' alone produces)",
  );
  eq(
    withReversal.rows.find((r) => r.accountCode === "50010")!.balanceCents,
    -100000,
    "THE HEADLINE: revenue is -100000, NOT +150000",
  );
  eq(withReversal.abnormalRows.length, 0, "correctly built, nothing is abnormal");

  // NEGATIVE CONTROL (standing rule 15a). Prove the WRONG filter produces the
  // WRONG answer — if this ever stops being true, the headline test above has
  // become a tautology and is no longer proving anything.
  const naiveLines = [
    line({ amountCents: 100000 }),
    line({
      accountCode: "50010",
      accountName: "Sales — Flower",
      accountType: "income",
      normalBalance: "credit",
      amountCents: -100000,
    }),
    line({ amountCents: -250000, journalDate: "2026-03-05" }),
    line({
      accountCode: "50010",
      accountName: "Sales — Flower",
      accountType: "income",
      normalBalance: "credit",
      amountCents: 250000,
      journalDate: "2026-03-05",
    }),
  ]; // the reversed original DROPPED, exactly as `status = 'posted'` would
  const naive = buildTrialBalance({
    entityCode: "greenway",
    fromDate: "2026-03-01",
    toDate: "2026-03-31",
    lines: naiveLines,
  });
  expect("the WRONG filter still foots to zero — which is why it is dangerous", naive.balanced);
  eq(
    naive.rows.find((r) => r.accountCode === "10100")!.balanceCents,
    -150000,
    "the WRONG filter invents -150000 of cash",
  );
  expect(
    "the WRONG filter produces an ABNORMAL cash balance — the only visible clue",
    naive.abnormalRows.some((r) => r.accountCode === "10100"),
  );
  expect(
    "and describeTrialBalance surfaces that clue rather than staying silent",
    describeTrialBalance(naive).warnings.length > 0,
  );

  // --- refusals -----------------------------------------------------------
  throws(
    "a draft line is refused",
    () =>
      buildTrialBalance({
        entityCode: "greenway",
        fromDate: "2026-03-01",
        toDate: "2026-03-31",
        lines: [line({ status: "draft" })],
      }),
    "TB_UNREPORTABLE_STATUS",
  );
  throws(
    "a blank entity is refused",
    () =>
      buildTrialBalance({ entityCode: "  ", fromDate: "2026-03-01", toDate: "2026-03-31", lines: [] }),
    "TB_NO_ENTITY",
  );
  throws(
    "an impossible from-date is refused",
    () =>
      buildTrialBalance({
        entityCode: "greenway",
        fromDate: "2026-02-30",
        toDate: "2026-03-31",
        lines: [],
      }),
    "TB_BAD_FROM_DATE",
  );
  throws(
    "a backwards range is refused",
    () =>
      buildTrialBalance({
        entityCode: "greenway",
        fromDate: "2026-03-31",
        toDate: "2026-03-01",
        lines: [],
      }),
    "TB_RANGE_BACKWARDS",
  );
  throws(
    "a line outside the range is refused",
    () =>
      buildTrialBalance({
        entityCode: "greenway",
        fromDate: "2026-03-01",
        toDate: "2026-03-31",
        lines: [line({ journalDate: "2026-04-01" })],
      }),
    "TB_LINE_OUT_OF_RANGE",
  );
  throws(
    "a zero-value line is refused",
    () =>
      buildTrialBalance({
        entityCode: "greenway",
        fromDate: "2026-03-01",
        toDate: "2026-03-31",
        lines: [line({ amountCents: 0 })],
      }),
    "TB_ZERO_LINE",
  );
  throws(
    "a fractional-cent line is refused",
    () =>
      buildTrialBalance({
        entityCode: "greenway",
        fromDate: "2026-03-01",
        toDate: "2026-03-31",
        lines: [line({ amountCents: 1.5 })],
      }),
    "TB_NON_INTEGER_CENTS",
  );
  throws(
    "one account code with two definitions is refused",
    () =>
      buildTrialBalance({
        entityCode: "greenway",
        fromDate: "2026-03-01",
        toDate: "2026-03-31",
        lines: [line(), line({ normalBalance: "credit", accountType: "income" })],
      }),
    "TB_ACCOUNT_INCONSISTENT",
  );

  // --- an out-of-balance TB is REPORTED, not thrown ------------------------
  const broken = buildTrialBalance({
    entityCode: "greenway",
    fromDate: "2026-03-01",
    toDate: "2026-03-31",
    lines: [
      line({ amountCents: 100000 }),
      line({
        accountCode: "50010",
        accountName: "Sales — Flower",
        accountType: "income",
        normalBalance: "credit",
        amountCents: -99999,
      }),
    ],
  });
  expect("an out-of-balance TB is reported, not thrown", !broken.balanced);
  eq(broken.differenceCents, 1, "off by exactly one cent, and it says so");
  expect("an out-of-balance TB is NOT exportable", !describeTrialBalance(broken).exportable);
  expect(
    "and it refuses to suggest plugging the difference",
    describeTrialBalance(broken).warnings.join(" ").includes("Do not adjust anything"),
  );

  // --- the empty trial balance --------------------------------------------
  const empty = buildTrialBalance({
    entityCode: "greenway",
    fromDate: "2026-03-01",
    toDate: "2026-03-31",
    lines: [],
  });
  expect("an empty TB technically balances (0 === 0)", empty.balanced);
  expect(
    "but it is NEVER exportable — a report that read nothing must not claim health",
    !describeTrialBalance(empty).exportable,
  );
  expect(
    "and it says so in plain English",
    describeTrialBalance(empty).headline.includes("NOT a clean bill of health"),
  );

  // --- abnormal detection on real shapes -----------------------------------
  const negativeInventory = buildTrialBalance({
    entityCode: "greenway",
    fromDate: "2026-03-01",
    toDate: "2026-03-31",
    lines: [
      line({
        accountCode: "12100",
        accountName: "Inventory — Flower",
        accountType: "asset",
        normalBalance: "debit",
        amountCents: -50000,
      }),
      line({
        accountCode: "50010",
        accountName: "Sales — Flower",
        accountType: "income",
        normalBalance: "credit",
        amountCents: 50000,
      }),
    ],
  });
  eq(negativeInventory.abnormalRows.length, 2, "negative inventory AND a debit-balance income account both flagged");
  expect("negative inventory is surfaced (standing rule 19)", describeTrialBalance(negativeInventory).warnings.length === 2);

  // --- a large realistic set still ties ------------------------------------
  const many: LedgerLineInput[] = [];
  let running = 0;
  for (let i = 1; i <= 400; i += 1) {
    const amount = i * 37;
    running += amount;
    many.push(line({ amountCents: amount, journalDate: "2026-03-10" }));
  }
  many.push(
    line({
      accountCode: "50010",
      accountName: "Sales — Flower",
      accountType: "income",
      normalBalance: "credit",
      amountCents: -running,
      journalDate: "2026-03-10",
    }),
  );
  const big = buildTrialBalance({
    entityCode: "greenway",
    fromDate: "2026-03-01",
    toDate: "2026-03-31",
    lines: many,
  });
  expect("401 lines still tie exactly", big.balanced);
  eq(big.lineCount, 401, "all lines counted");
  eq(big.rows[0].balanceCents, running, "aggregation is exact over 400 lines");
}
