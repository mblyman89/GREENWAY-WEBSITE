/**
 * src/lib/accounting/period-close-core.ts   (books-18)
 *
 * THE PERIOD CLOSE GATE — deciding whether a month has EARNED the right to be
 * sealed.
 *
 * Roadmap item 2 of 8. Consumes the financial statements built in books-17,
 * exactly as the mandated order requires: a period may not close on statements
 * that do not tie, and it cannot know whether they tie without building them.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS AND IS NOT
 * ---------------------------------------------------------------------------
 *
 * The database already knows HOW to close a period. `gl_close_period` in
 * migration 0172 refuses to close a period that is not open, refuses to close
 * over unposted drafts, stamps who did it and when, and writes an audit event.
 * `gl_reopen_period` demands a written reason and refuses outright to reopen a
 * period marked 'locked', because 'locked' means a tax return was filed on
 * those numbers.
 *
 * That machinery is correct and is NOT reimplemented here. Reimplementing it
 * would create a second opinion about what "closed" means, and two opinions
 * drift (standing rule 2).
 *
 * This module answers the question the database cannot: SHOULD it close?
 * It is a pure function over evidence. It touches no network, no clock and no
 * database, so the same inputs always produce the same verdict and the whole
 * thing is testable without a server.
 *
 * ---------------------------------------------------------------------------
 * WHY THE GATE IS HARSH
 * ---------------------------------------------------------------------------
 *
 * Because being wrong afterwards is dramatically more expensive than being
 * slow beforehand. ASC 250-10-45-23: an error found after statements are
 * issued "shall be reported as an error correction, by restating the
 * prior-period financial statements." ASC 250-10-45-22 forbids the tempting
 * shortcut of burying last month's mistake in this month's income. And
 * ASC 250-10-50-7 means a restatement must be announced, not done quietly.
 *
 * Ten minutes of checking is cheaper than all three. So this refuses; it does
 * not warn (standing rule 27).
 */
import {
  type StatementRefusal,
  formatCents,
  assertIntegerCents,
} from "@/lib/accounting/financial-statements-core";
import { ENTITY_CODES } from "@/lib/accounting/cutover-core";

// ---------------------------------------------------------------------------
// 1) WHAT A PERIOD CAN BE
// ---------------------------------------------------------------------------

/**
 * Mirrors the `status` check constraint on `gl_periods` exactly.
 *
 * If these ever disagree with the database, the screen will happily offer a
 * button the server refuses to honour. A test asserts the three values and the
 * order match the migration.
 */
export type PeriodStatus = "open" | "closed" | "locked";

export const ALL_PERIOD_STATUSES: readonly PeriodStatus[] = [
  "open",
  "closed",
  "locked",
] as const;

export const PERIOD_STATUS_MEANING: Readonly<Record<PeriodStatus, string>> = {
  open: "Entries can still be posted into this month. Nothing is settled.",
  closed:
    "Month-end work is finished and the month is sealed. It can be reopened, but only " +
    "deliberately, with a written reason that is kept forever.",
  locked:
    "A tax return has been filed on these numbers. This is permanent \u2014 nothing reopens a locked " +
    "period, because the figures have left the building and are now on a government form.",
};

// ---------------------------------------------------------------------------
// 2) THE CHECKLIST
// ---------------------------------------------------------------------------

/**
 * Every question asked before a month may be sealed.
 *
 * These are IDs rather than free text so a check cannot be quietly reworded
 * into something weaker, and so the same check means the same thing in the
 * database, the UI and the tests.
 */
export type CloseCheckId =
  | "TRIAL_BALANCE_TIES"
  | "NO_UNPOSTED_DRAFTS"
  | "STATEMENTS_BUILD"
  | "CASH_COUNTED"
  | "BANK_RECONCILED"
  | "INVENTORY_COUNTED"
  | "EXCISE_ACCRUED"
  | "PAYROLL_POSTED"
  | "NO_ABNORMAL_BALANCES"
  | "PRIOR_PERIOD_CLOSED";

export const ALL_CLOSE_CHECK_IDS: readonly CloseCheckId[] = [
  "PRIOR_PERIOD_CLOSED",
  "TRIAL_BALANCE_TIES",
  "NO_UNPOSTED_DRAFTS",
  "STATEMENTS_BUILD",
  "CASH_COUNTED",
  "BANK_RECONCILED",
  "INVENTORY_COUNTED",
  "EXCISE_ACCRUED",
  "PAYROLL_POSTED",
  "NO_ABNORMAL_BALANCES",
] as const;

/**
 * How badly a failed check blocks the close.
 *
 * There are only two levels ON PURPOSE. A third level called "warning" would
 * be a button Michael learns to click past, and a control that is habitually
 * dismissed is not a control (standing rule 27). Either a check stops the
 * close or it is not a check.
 *
 * `advisory` exists solely for checks that CANNOT be evaluated from data and
 * require a human to assert something, and even those must be affirmatively
 * confirmed before the close proceeds. They do not pass by default.
 */
export type CheckSeverity = "blocking" | "advisory";

export type CloseCheck = {
  id: CloseCheckId;
  /** The question, phrased the way it would be asked out loud. */
  question: string;
  /** Why this check exists at all. */
  whyItMatters: string;
  severity: CheckSeverity;
  /** What proves it, when a human has to assert rather than the data show. */
  evidenceRequired: string | null;
  authorityIds: readonly string[];
};

export const CLOSE_CHECKS: readonly CloseCheck[] = [
  {
    id: "PRIOR_PERIOD_CLOSED",
    question: "Is the month before this one already closed?",
    whyItMatters:
      "Closing months out of order leaves a hole. If June is sealed while May is still open, " +
      "somebody can post into May afterwards and June's opening balances silently stop matching " +
      "May's closing balances \u2014 and nothing will ever tell you, because both months individually " +
      "still tie.",
    severity: "blocking",
    evidenceRequired: null,
    authorityIds: ["REG_1_6001_1_A_PERMANENT_BOOKS"],
  },
  {
    id: "TRIAL_BALANCE_TIES",
    question: "Do total debits equal total credits?",
    whyItMatters:
      "If they do not, every number downstream is arithmetic performed on the wrong figures. This " +
      "is the check that would have caught the $4,624,697.31 sitting in suspense during the 2023 " +
      "review, which survived for months only because every report rendered anyway.",
    severity: "blocking",
    evidenceRequired: null,
    authorityIds: ["REG_1_6001_1_A_PERMANENT_BOOKS", "REG_1_446_1_A_2_CLEARLY_REFLECT"],
  },
  {
    id: "NO_UNPOSTED_DRAFTS",
    question: "Has every draft entry in this month been posted or deleted?",
    whyItMatters:
      "A draft left inside a closed month is stranded forever \u2014 it can never post, because posting " +
      "into a closed period is refused. It is real work that silently evaporates. The database " +
      "enforces this too; the check exists here so you see it BEFORE clicking close rather than as " +
      "an error afterwards.",
    severity: "blocking",
    evidenceRequired: null,
    authorityIds: ["REG_1_6001_1_A_PERMANENT_BOOKS"],
  },
  {
    id: "STATEMENTS_BUILD",
    question: "Do all four financial statements actually build without refusing?",
    whyItMatters:
      "The statements carry their own gates \u2014 the balance sheet must balance, the cash flow must " +
      "tie to counted cash, the equity rollforward must reconcile. If any of them refuses, the " +
      "month is not finished no matter how tidy the trial balance looks.",
    severity: "blocking",
    evidenceRequired: null,
    authorityIds: ["ASC_250_10_45_23_RESTATE", "REG_1_446_1_A_2_CLEARLY_REFLECT"],
  },
  {
    id: "CASH_COUNTED",
    question: "Was the cash physically counted at month end, and does it agree with the books?",
    whyItMatters:
      "This is a cash business in an industry banks will not touch, which makes the count the single " +
      "most important control there is. A difference here is never rounding: it is either a " +
      "transaction nobody recorded or money that left the building.",
    severity: "blocking",
    evidenceRequired: "A dated count sheet, signed by whoever counted it.",
    authorityIds: ["REG_1_6001_1_A_PERMANENT_BOOKS"],
  },
  {
    id: "BANK_RECONCILED",
    question: "Has every bank account been reconciled to a statement?",
    whyItMatters:
      "The bank is the one record Greenway does not write itself. Anything the books say that the " +
      "bank does not confirm is unverified.",
    severity: "blocking",
    evidenceRequired: "The bank statement for the month, matched to the ledger.",
    authorityIds: ["REG_1_6001_1_A_PERMANENT_BOOKS"],
  },
  {
    id: "INVENTORY_COUNTED",
    question: "Was inventory counted, and does the count support the balance sheet figure?",
    whyItMatters:
      "Under \u00a7280E, inventory is nearly the only relief available \u2014 what lands in inventory becomes " +
      "cost of goods sold and reduces taxable income, and what does not is disallowed. An inventory " +
      "figure nobody counted is the most expensive guess in the whole ledger.",
    severity: "blocking",
    evidenceRequired: "The physical count, with the variance to the ledger explained.",
    authorityIds: ["REG_1_471_2_D_VERIFY_BY_COUNT", "IRC_280E"],
  },
  {
    id: "EXCISE_ACCRUED",
    question: "Is the 37% excise on this month's sales recorded as a liability?",
    whyItMatters:
      "The excise is roughly a third of gross sales. Leaving it off understates what is owed by an " +
      "enormous amount and makes a month look profitable when the money is already spoken for.",
    severity: "blocking",
    evidenceRequired: null,
    authorityIds: ["REG_1_446_1_A_2_CLEARLY_REFLECT"],
  },
  {
    id: "PAYROLL_POSTED",
    question: "Is every pay run in this month posted, with the employer taxes accrued?",
    whyItMatters:
      "Wages paid but not booked understate expenses, and employer payroll taxes accrued in the " +
      "wrong month move a real liability into a period where nobody is looking for it.",
    severity: "blocking",
    evidenceRequired: null,
    authorityIds: ["REG_1_446_1_A_2_CLEARLY_REFLECT"],
  },
  {
    id: "NO_ABNORMAL_BALANCES",
    question: "Has every backwards account balance been explained?",
    whyItMatters:
      "Negative inventory and a cash account in credit are impossible in the real world, so they mean " +
      "the books are wrong. They must be surfaced and explained rather than netted away against " +
      "something else \u2014 netting without intent is, in the FASB's words, not representationally " +
      "faithful.",
    severity: "advisory",
    evidenceRequired: "A written explanation for each abnormal balance.",
    authorityIds: ["ASC_210_20_45_4_NOT_FAITHFUL", "CON8_CH7_PR33_NETTING"],
  },
];

export function findCloseCheck(id: CloseCheckId): CloseCheck | undefined {
  return CLOSE_CHECKS.find((c) => c.id === id);
}

// ---------------------------------------------------------------------------
// 3) REFUSALS
// ---------------------------------------------------------------------------

export type CloseRefusalCode =
  | "PERIOD_NOT_OPEN"
  | "PERIOD_LOCKED"
  | "PRIOR_PERIOD_STILL_OPEN"
  | "CHECK_FAILED"
  | "CHECK_UNANSWERED"
  | "EVIDENCE_MISSING"
  | "UNKNOWN_CHECK"
  | "DUPLICATE_CHECK_RESULT"
  | "REASON_REQUIRED"
  | "CANNOT_REOPEN_LOCKED"
  | "FUTURE_PERIOD"
  | "UNKNOWN_ENTITY"
  | "INVALID_PERIOD"
  | "INVALID_FISCAL_YEAR";

export const ALL_CLOSE_REFUSAL_CODES: readonly CloseRefusalCode[] = [
  "PERIOD_NOT_OPEN",
  "PERIOD_LOCKED",
  "PRIOR_PERIOD_STILL_OPEN",
  "CHECK_FAILED",
  "CHECK_UNANSWERED",
  "EVIDENCE_MISSING",
  "UNKNOWN_CHECK",
  "DUPLICATE_CHECK_RESULT",
  "REASON_REQUIRED",
  "CANNOT_REOPEN_LOCKED",
  "FUTURE_PERIOD",
  "UNKNOWN_ENTITY",
  "INVALID_PERIOD",
  "INVALID_FISCAL_YEAR",
] as const;

/**
 * Same SHAPE as a statement refusal, deliberately — one idea, one shape, so the
 * UI can render a refusal from either engine without caring which produced it.
 *
 * The `code` is this slice's own union rather than the statement one. An
 * earlier draft wrote `StatementRefusal & { code: string }` and the compiler
 * rejected it, correctly: an intersection cannot WIDEN a narrower union, and
 * silencing that with a cast would have let a close emit a refusal code that
 * nothing downstream had a case for.
 */
export type CloseRefusal = Omit<StatementRefusal, "code"> & { code: CloseRefusalCode };

function refusal(
  code: CloseRefusalCode,
  message: string,
  whatToDo: string,
  authorityIds: readonly string[],
): CloseRefusal {
  return { code, message, whatToDo, authorityIds };
}

// ---------------------------------------------------------------------------
// 3b) WHICH PERIOD IS THIS, ACTUALLY?
// ---------------------------------------------------------------------------

/**
 * The earliest fiscal year these books can describe. Standing rule 10: the line
 * in the sand is 2026-01-01, and `gl_periods` enforces it as
 * `check (fiscal_year between 2026 and 2100)`.
 */
export const FIRST_FISCAL_YEAR = 2026;
export const LAST_FISCAL_YEAR = 2100;

/**
 * Validate WHICH PERIOD is being talked about, before considering whether it
 * may close.
 *
 * This exists because of a defect found by attacking the suite after it went
 * green (standing rule 33). The engine checked the checklist meticulously and
 * never checked its own inputs, so `periodNo: NaN` produced the sentence
 * "Period 2026-NaN is ready to close. All 10 checks pass." A screen that says
 * that is worse than a screen that crashes, because Michael would believe it.
 *
 * It is ONE function rather than a patch at each call site, because the defect
 * was a class and not an instance (standing rule 23): nothing here validated
 * identity at all. Both entry points call this, so neither can drift from the
 * other or from the database.
 *
 * Every bound below is copied from the `gl_periods` check constraints in
 * migration 0172, not invented. If they disagreed, this would approve a close
 * the server then rejects.
 */
export function validatePeriodIdentity(input: {
  entityCode?: string;
  fiscalYear: number;
  periodNo: number;
}): CloseRefusal[] {
  const out: CloseRefusal[] = [];

  if (input.entityCode !== undefined && !ENTITY_CODES.includes(input.entityCode as never)) {
    out.push(
      refusal(
        "UNKNOWN_ENTITY",
        `"${input.entityCode}" is not one of the four sets of books.`,
        `There are exactly four: ${ENTITY_CODES.join(", ")}. A close aimed at anything else is ` +
          `aimed at nothing, and would silently seal no month at all.`,
        ["REG_1_6001_1_A_PERMANENT_BOOKS"],
      ),
    );
  }

  if (!Number.isInteger(input.periodNo) || input.periodNo < 1 || input.periodNo > 12) {
    out.push(
      refusal(
        "INVALID_PERIOD",
        `There is no month ${String(input.periodNo)}.`,
        "Months run 1 to 12. The database enforces the same range, so a period outside it does " +
          "not exist and cannot be closed \u2014 no matter what a checklist says about it.",
        ["REG_1_6001_1_A_PERMANENT_BOOKS"],
      ),
    );
  }

  if (
    !Number.isInteger(input.fiscalYear) ||
    input.fiscalYear < FIRST_FISCAL_YEAR ||
    input.fiscalYear > LAST_FISCAL_YEAR
  ) {
    out.push(
      refusal(
        "INVALID_FISCAL_YEAR",
        `${String(input.fiscalYear)} is not a fiscal year these books cover.`,
        `These books begin at ${FIRST_FISCAL_YEAR} \u2014 the deliberate line in the sand \u2014 and the ` +
          `database refuses anything outside ${FIRST_FISCAL_YEAR} to ${LAST_FISCAL_YEAR}. Earlier ` +
          `years are handled as history, not reopened here.`,
        ["REG_1_6001_1_A_PERMANENT_BOOKS"],
      ),
    );
  }

  return out;
}

/**
 * The last calendar day of a month, without touching Date.
 *
 * Written out rather than derived from a Date object because Date arithmetic
 * silently applies a timezone, and a month-end that shifts by one day depending
 * on where the server is running is a bug that only appears in production.
 */
export function lastDayOfMonth(fiscalYear: number, periodNo: number): number {
  const leap =
    fiscalYear % 4 === 0 && (fiscalYear % 100 !== 0 || fiscalYear % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[periodNo - 1];
}

/**
 * Refuse to close a month that has not finished yet.
 *
 * This is the check that makes `FUTURE_PERIOD` reachable. The code was declared
 * from the start and no call site ever emitted it, which 81 passing tests did
 * not notice, because the test only asserted that nothing UNDECLARED is emitted
 * and never the reverse. Standing rule 34 exists precisely for this, and it was
 * still missed \u2014 so it is now asserted in both directions.
 *
 * The accounting reason is more important than the tidiness one. Today is
 * 2026-08-20. Closing 2026-08 today seals a month with eleven days of sales
 * still to come, and every one of those sales would then have nowhere to post.
 * Under ASC 250 the repair for that is not a correcting entry, it is a
 * restatement of an issued statement.
 *
 * `today` is REQUIRED and is supplied by the caller. Reading the clock in here
 * would make the function impure and untestable; making the argument optional
 * would let a caller switch the check off by leaving it out. So it is asked for
 * every time, and a malformed date is refused rather than assumed
 * (standing rule 1).
 */
export function refuseIfNotFinished(
  fiscalYear: number,
  periodNo: number,
  today: string,
): CloseRefusal[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return [
      refusal(
        "FUTURE_PERIOD",
        `"${today}" is not a date in YYYY-MM-DD form, so this cannot tell whether the month has ` +
          `finished.`,
        "This is a wiring fault rather than a bookkeeping one. Rather than assume the month is " +
          "over, the close stops here.",
        ["REG_1_6001_1_A_PERMANENT_BOOKS"],
      ),
    ];
  }
  // Identity is validated separately; a nonsense period cannot be compared.
  if (!Number.isInteger(fiscalYear) || !Number.isInteger(periodNo) || periodNo < 1 || periodNo > 12) {
    return [];
  }

  const endOfPeriod = `${String(fiscalYear).padStart(4, "0")}-${String(periodNo).padStart(2, "0")}-${String(
    lastDayOfMonth(fiscalYear, periodNo),
  ).padStart(2, "0")}`;

  // ISO dates compare correctly as plain strings, which is the whole reason
  // this format is used rather than a locale one.
  if (today <= endOfPeriod) {
    return [
      refusal(
        "FUTURE_PERIOD",
        `${periodLabel(fiscalYear, periodNo)} has not finished yet \u2014 today is ${today} and the ` +
          `month runs through ${endOfPeriod}.`,
        "Wait until the month is actually over. Sealing a month early leaves the remaining days " +
          "with nowhere to post, and the fix for that afterwards is restating a statement you " +
          "already issued, not a correcting entry.",
        ["ASC_250_10_45_23_RESTATE", "ASC_250_10_45_22_NOT_CURRENT_INCOME"],
      ),
    ];
  }
  return [];
}

/**
 * Render a period label safely.
 *
 * Only pads when the number is a real month. Previously `String(NaN).padStart`
 * produced "NaN" and `String(-1).padStart(2,"0")` produced "-1", both of which
 * were then printed inside a confident sentence.
 */
export function periodLabel(fiscalYear: number, periodNo: number): string {
  const y = Number.isInteger(fiscalYear) ? String(fiscalYear) : `[invalid year ${String(fiscalYear)}]`;
  const m =
    Number.isInteger(periodNo) && periodNo >= 1 && periodNo <= 12
      ? String(periodNo).padStart(2, "0")
      : `[invalid month ${String(periodNo)}]`;
  return `${y}-${m}`;
}

// ---------------------------------------------------------------------------
// 4) THE VERDICT
// ---------------------------------------------------------------------------

/**
 * One answered check.
 *
 * `passed: null` means NOT YET ANSWERED, and it is a distinct state from
 * `false` on purpose. "Nobody looked" and "we looked and it is wrong" are
 * different facts, and collapsing them into one boolean is precisely how an
 * unanswered question comes to be treated as a passed one.
 */
export type CloseCheckResult = {
  id: CloseCheckId;
  passed: boolean | null;
  /** Free-text note, or the evidence reference for checks that require one. */
  note: string;
};

export type CloseVerdict =
  | { ok: true; canClose: true; refusals: readonly []; summary: string }
  | { ok: false; canClose: false; refusals: readonly CloseRefusal[]; summary: string };

export type EvaluateCloseInput = {
  /**
   * Which set of books. Named `entityCode`, not `entityId`, because the value
   * is "greenway" and not a uuid. Every sibling engine uses `entityCode` for
   * this and reserves `entityId` for the database primary key; an earlier draft
   * here called it `entityId` and holding a code in a field named id is exactly
   * the kind of small drift that becomes a real bug once a screen binds to it
   * (standing rule 2).
   */
  entityCode: string;
  fiscalYear: number;
  periodNo: number;
  status: PeriodStatus;
  /** Status of the immediately preceding period; null when this is the first. */
  priorPeriodStatus: PeriodStatus | null;
  results: readonly CloseCheckResult[];
  /**
   * Today, as ISO `YYYY-MM-DD`, supplied by the caller.
   *
   * Passed in rather than read from the clock so this module stays pure and a
   * test can sit on any date it likes.
   *
   * REQUIRED, not optional. An earlier draft made it optional and skipped the
   * "has the month actually finished" check when it was absent. That is a gate
   * switched off by leaving an argument out \u2014 which is how every gate that has
   * ever been bypassed got bypassed (standing rules 14 and 27). Making it
   * required means the compiler asks the question at every call site, and there
   * is no quiet path around it.
   */
  today: string;
};

/**
 * Decide whether this period may close.
 *
 * Collects EVERY reason rather than stopping at the first, because a checklist
 * that reveals one problem per attempt turns a ten-minute close into a
 * ten-round argument.
 */
export function evaluatePeriodClose(input: EvaluateCloseInput): CloseVerdict {
  const refusals: CloseRefusal[] = [];

  // --- which period is this, actually? -------------------------------------
  refusals.push(...validatePeriodIdentity(input));

  // --- has the month even finished? ----------------------------------------
  refusals.push(...refuseIfNotFinished(input.fiscalYear, input.periodNo, input.today));

  // --- the period itself ---------------------------------------------------
  if (input.status === "locked") {
    refusals.push(
      refusal(
        "PERIOD_LOCKED",
        `Period ${periodLabel(input.fiscalYear, input.periodNo)} is locked. A tax ` +
          `return was filed on these numbers.`,
        "Nothing to do \u2014 and nothing that CAN be done. A locked period is permanent. If a figure in " +
          "it turns out to be wrong, the fix is an amended return, not an edit to the books.",
        ["ASC_250_10_45_23_RESTATE"],
      ),
    );
  } else if (input.status === "closed") {
    refusals.push(
      refusal(
        "PERIOD_NOT_OPEN",
        `Period ${periodLabel(input.fiscalYear, input.periodNo)} is already closed.`,
        "If something genuinely needs to change, reopen it deliberately with a written reason. The " +
          "reason is kept forever, which is the point.",
        ["REG_1_6001_1_A_PERMANENT_BOOKS"],
      ),
    );
  }

  if (input.priorPeriodStatus === "open") {
    refusals.push(
      refusal(
        "PRIOR_PERIOD_STILL_OPEN",
        "The month before this one is still open, so this month cannot be sealed yet.",
        "Close the earlier month first. Closing out of order lets somebody post into the earlier " +
          "month afterwards, at which point this month's opening balances quietly stop agreeing " +
          "with it and nothing will ever tell you.",
        ["REG_1_6001_1_A_PERMANENT_BOOKS"],
      ),
    );
  }

  // --- the answers themselves ---------------------------------------------
  const seen = new Set<string>();
  for (const r of input.results) {
    if (!ALL_CLOSE_CHECK_IDS.includes(r.id)) {
      refusals.push(
        refusal(
          "UNKNOWN_CHECK",
          `"${String(r.id)}" is not one of the close checks.`,
          "Somebody has answered a question this system does not ask. That usually means a stale " +
            "screen or a hand-built request. Reload the close screen and start again.",
          ["REG_1_6001_1_A_PERMANENT_BOOKS"],
        ),
      );
      continue;
    }
    if (seen.has(r.id)) {
      refusals.push(
        refusal(
          "DUPLICATE_CHECK_RESULT",
          `The check "${r.id}" was answered more than once.`,
          "Two answers to one question means one of them is going to be ignored, and nobody can " +
            "tell which. Reload the close screen so each check is answered exactly once.",
          ["REG_1_6001_1_A_PERMANENT_BOOKS"],
        ),
      );
      continue;
    }
    seen.add(r.id);
  }

  // --- every check must be present, answered, passed, and evidenced --------
  for (const check of CLOSE_CHECKS) {
    const result = input.results.find((r) => r.id === check.id);

    if (!result || result.passed === null) {
      refusals.push(
        refusal(
          "CHECK_UNANSWERED",
          `Nobody has answered: ${check.question}`,
          `${check.whyItMatters} An unanswered check is not a passed one, so this stays blocked ` +
            `until somebody actually looks.`,
          check.authorityIds,
        ),
      );
      continue;
    }

    if (result.passed === false) {
      refusals.push(
        refusal(
          "CHECK_FAILED",
          `Failed: ${check.question}${result.note ? ` \u2014 ${result.note}` : ""}`,
          check.whyItMatters,
          check.authorityIds,
        ),
      );
      continue;
    }

    if (check.evidenceRequired !== null && result.note.trim().length === 0) {
      refusals.push(
        refusal(
          "EVIDENCE_MISSING",
          `"${check.question}" was marked done, but no evidence was recorded.`,
          `${check.evidenceRequired} Marking a check done without recording what proves it is how a ` +
            `checklist turns into a formality.`,
          check.authorityIds,
        ),
      );
    }
  }

  const label = periodLabel(input.fiscalYear, input.periodNo);
  if (refusals.length > 0) {
    return {
      ok: false,
      canClose: false,
      refusals,
      summary:
        `Period ${label} cannot close yet: ${refusals.length} ` +
        `${refusals.length === 1 ? "thing needs" : "things need"} attention.`,
    };
  }
  return {
    ok: true,
    canClose: true,
    refusals: [],
    summary: `Period ${label} is ready to close. All ${CLOSE_CHECKS.length} checks pass.`,
  };
}

// ---------------------------------------------------------------------------
// 5) REOPENING
// ---------------------------------------------------------------------------

export type ReopenInput = {
  status: PeriodStatus;
  reason: string;
  fiscalYear: number;
  periodNo: number;
};

/**
 * Whether a closed period may be reopened, and on what terms.
 *
 * Mirrors `gl_reopen_period`: a locked period never reopens, and a reason is
 * mandatory. The minimum length is 3 characters to match the database's
 * `length(btrim(p_reason)) < 3` exactly \u2014 if the two disagreed, the screen
 * would accept a reason the server then rejects.
 */
export function evaluatePeriodReopen(input: ReopenInput): CloseVerdict {
  const refusals: CloseRefusal[] = [];
  const label = periodLabel(input.fiscalYear, input.periodNo);
  refusals.push(...validatePeriodIdentity(input));

  if (input.status === "locked") {
    refusals.push(
      refusal(
        "CANNOT_REOPEN_LOCKED",
        `Period ${label} is locked because a tax return was filed on it. Locked is permanent.`,
        "If a number in a locked period is wrong, the route is an amended return prepared with your " +
          "CPA \u2014 not an edit to sealed books. Changing figures a return was built on, after the " +
          "fact, is the single worst thing you can do to your own audit defence.",
        ["ASC_250_10_45_23_RESTATE", "ASC_250_10_50_7_DISCLOSE_RESTATEMENT"],
      ),
    );
  } else if (input.status === "open") {
    refusals.push(
      refusal(
        "PERIOD_NOT_OPEN",
        `Period ${label} is already open. There is nothing to reopen.`,
        "No action needed.",
        ["REG_1_6001_1_A_PERMANENT_BOOKS"],
      ),
    );
  }

  if (input.reason.trim().length < 3) {
    refusals.push(
      refusal(
        "REASON_REQUIRED",
        "Reopening a closed month requires a written reason.",
        "Write what changed and why, in a sentence somebody could understand a year from now. This " +
          "is kept permanently and is exactly the kind of record that turns a reopened month from " +
          "something that looks suspicious into something that looks controlled.",
        ["REG_1_6001_1_A_PERMANENT_BOOKS", "ASC_250_10_50_7_DISCLOSE_RESTATEMENT"],
      ),
    );
  }

  if (refusals.length > 0) {
    return { ok: false, canClose: false, refusals, summary: `Period ${label} cannot be reopened.` };
  }
  return {
    ok: true,
    canClose: true,
    refusals: [],
    summary: `Period ${label} may be reopened. The reason will be recorded permanently.`,
  };
}

// ---------------------------------------------------------------------------
// 6) EXPLAINING A DIFFERENCE THE HONEST WAY
// ---------------------------------------------------------------------------

/**
 * When a check fails on a money difference, say what it is in plain money and
 * refuse to describe it as an adjustment.
 *
 * `assertIntegerCents` is reused rather than reimplemented so that a fractional
 * cent is impossible here for the same reason it is impossible on a statement.
 */
export function describeDifference(differenceCents: number, whatWasCompared: string): string {
  // An empty label produced ": out by $0.01." \u2014 a sentence that starts with a
  // colon and never says what is out by a penny. A difference nobody can name
  // is not a finding, so this throws rather than printing it.
  if (whatWasCompared.trim().length === 0) {
    throw new Error(
      "describeDifference needs to know WHAT was compared \u2014 an unnamed difference is not a finding",
    );
  }
  assertIntegerCents(differenceCents, `difference for ${whatWasCompared}`);
  if (differenceCents === 0) {
    return `${whatWasCompared}: agrees exactly.`;
  }
  return (
    `${whatWasCompared}: out by ${formatCents(Math.abs(differenceCents))}. ` +
    `That is a real difference, not a rounding issue \u2014 find it before sealing the month.`
  );
}

// ---------------------------------------------------------------------------
// 7) SELF-TESTS
// ---------------------------------------------------------------------------

/**
 * Pure self-tests, runnable without a test framework.
 *
 * Kept because a module that can prove itself in isolation is a module that
 * can be trusted when the harness around it changes.
 */
export function __runPeriodCloseCoreTests(): void {
  const fail = (m: string): never => {
    throw new Error(`period-close-core self-test failed: ${m}`);
  };

  // Every check id appears in the checklist exactly once.
  if (CLOSE_CHECKS.length !== ALL_CLOSE_CHECK_IDS.length) {
    fail("CLOSE_CHECKS and ALL_CLOSE_CHECK_IDS are different lengths");
  }
  for (const id of ALL_CLOSE_CHECK_IDS) {
    if (CLOSE_CHECKS.filter((c) => c.id === id).length !== 1) fail(`check ${id} is not unique`);
  }

  // A fully passed checklist closes.
  const allPass: CloseCheckResult[] = CLOSE_CHECKS.map((c) => ({
    id: c.id,
    passed: true,
    note: c.evidenceRequired ? "evidence on file" : "",
  }));
  const good = evaluatePeriodClose({
    entityCode: "greenway",
    fiscalYear: 2026,
    periodNo: 6,
    status: "open",
    priorPeriodStatus: "closed",
    results: allPass,
    today: "2030-01-15",
  });
  if (!good.ok) fail(`a fully passed checklist should close, got: ${good.refusals[0]?.code}`);

  // An empty checklist does not.
  const empty = evaluatePeriodClose({
    entityCode: "greenway",
    fiscalYear: 2026,
    periodNo: 6,
    status: "open",
    priorPeriodStatus: "closed",
    results: [],
    today: "2030-01-15",
  });
  if (empty.ok) fail("an unanswered checklist must not close");
  if (empty.refusals.length !== CLOSE_CHECKS.length) {
    fail(`expected one refusal per unanswered check, got ${empty.refusals.length}`);
  }

  // Locked never reopens.
  const locked = evaluatePeriodReopen({
    status: "locked",
    reason: "a perfectly good reason",
    fiscalYear: 2026,
    periodNo: 1,
  });
  if (locked.ok) fail("a locked period must never reopen");

  // Fractional cents are impossible.
  let threw = false;
  try {
    describeDifference(10.5, "cash");
  } catch {
    threw = true;
  }
  if (!threw) fail("describeDifference must reject a fractional cent");

  console.log(`period-close-core: self-tests passed (${CLOSE_CHECKS.length} checks)`);
}
