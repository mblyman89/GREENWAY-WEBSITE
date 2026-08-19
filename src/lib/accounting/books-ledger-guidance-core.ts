/**
 * src/lib/accounting/books-ledger-guidance-core.ts   (slice books-08)
 *
 * THE GENERAL LEDGER AND THE CHART OF ACCOUNTS, WITH A MENTOR ATTACHED.
 * =============================================================================
 *
 * WHY THIS MODULE EXISTS, AND WHY IT DOES MORE THAN EXPLAIN
 *
 * Michael asked for a guidance layer on these two screens. Building it turned up
 * something that had to be fixed before any guidance could honestly be written,
 * so this module does two jobs that turn out to be the same job:
 *
 *   1. It makes the ledger's "Balance" column TRUE (balance forward).
 *   2. It teaches him to read that column adversarially.
 *
 * You cannot do (2) without (1). Teaching someone to distrust a number that is
 * already wrong trains them to distrust correct books, which is worse than
 * teaching nothing at all.
 *
 * -----------------------------------------------------------------------------
 * THE DEFECT, PROVEN BY EXECUTION AGAINST REAL POSTGRESQL (never assumed)
 * -----------------------------------------------------------------------------
 * `gl_general_ledger` computes the running balance as a window function over
 * ONLY the rows inside the requested date range:
 *
 *     sum(r.amount_cents) over (partition by r.account_code
 *                              order by r.journal_date, r.journal_no, r.line_no)
 *
 * The SQL function defaults `p_from` to 2025-12-31 precisely so the opening
 * balances are included. But the ledger PAGE passed 2026-01-01 (the line in the
 * sand), and migration 0172 REQUIRES the opening-balance journal to be dated
 * 2025-12-31. So the page was excluding, every time, the one entry that says
 * what Michael owned on day one.
 *
 * Executed on a throwaway PG15 with a fixture of $4,000 opening cash and a
 * $3,000 payment in March:
 *
 *     window from 2026-01-01  ->  running balance = -300000   (shown on screen)
 *     window from 2025-12-31  ->  running balance = +100000   (the truth)
 *
 * The screen showed cash of NEGATIVE $3,000.00 when the business really held
 * POSITIVE $1,000.00. And the same default on the trial balance page reported
 * `abnormal_count = 2` where the truth is 0, while still returning
 * `balanced = true` and `certified = true` — a period-activity report wearing a
 * balance sheet's clothes, certifying a false alarm.
 *
 * THAT IS MICHAEL'S OWN DISASTER, RE-CREATED BY OUR OWN REPORT. "Negative
 * inventory" and "negative ATM cash" are two of the documented failures in the
 * permanent test corpus (standing rule 19). A screen that manufactures them on
 * correct books is not a cosmetic bug: it is a machine for destroying his trust
 * in the exact signal this slice is built to teach him to watch.
 *
 * -----------------------------------------------------------------------------
 * THE FIX: BALANCE FORWARD — what real ledger software has always done
 * -----------------------------------------------------------------------------
 * The wrong fix is "widen the default window to inception". That turns every
 * income-statement view into inception-to-date and destroys period reporting:
 * you could never again ask "what did I spend in March?".
 *
 * The right fix is the one every general ledger package has printed at the top
 * of every account page for fifty years:
 *
 *     BALANCE FORWARD .......  1,234.56
 *     03/15  payment ........   (300.00)   934.56
 *
 * Everything before the window is FOLDED into one opening figure; the window
 * shows the period's activity; the running balance starts from the fold and is
 * therefore a real balance at every row. One query (inception-to-date), one
 * pure fold, no migration, and the period view is preserved exactly.
 *
 * `foldBalanceForward()` below does that fold, and it is pure, so it is fully
 * testable without a database.
 *
 * -----------------------------------------------------------------------------
 * ARCHITECTURE (standing rule: logic here, rendering there)
 * -----------------------------------------------------------------------------
 * Everything in this file is PURE: no I/O, no Date.now(), no randomness, no
 * Supabase. The .tsx explainers render DATA exported from here. A diagram that
 * drifts from the engine is worse than no diagram — it teaches the wrong thing
 * with confidence.
 *
 * Money is in MINOR UNITS (integer cents) throughout. No floats anywhere near
 * a balance.
 */

import type { AccountType, NormalBalance } from "./ledger-core";
import { expectedNormalBalance, blockOf, COA_BLOCKS } from "./coa-core";
import { findGuidanceAuthority } from "./books-guidance-core";
import { LEDGER_AUTHORITIES_NEW } from "./books-ledger-authorities";

/**
 * Re-exported so a caller that already imports this core does not need to know
 * that the raw authority data lives in a separate leaf module (it lives there
 * to keep the registry free of an import cycle; see that file's header).
 */
export { LEDGER_AUTHORITIES_NEW };

// ===========================================================================
// 1) AUTHORITIES
//
// The three primary sources this slice added live in books-ledger-authorities.ts
// (a leaf module, so the shared registry can merge them without an import
// cycle) and are re-exported above.
//
// Authorities that ALREADY EXIST in books-guidance-core are referenced BY ID
// and deliberately NOT redefined here. Re-typing a quote is exactly how two
// screens end up citing the same rule with different words — the citation drift
// that module was built to catch.
// ===========================================================================

/**
 * Authorities this module cites that are DEFINED ELSEWHERE. Listed explicitly so
 * the self-tests can prove every one still resolves — a citation that silently
 * stops resolving is how a screen loses its legal support without anyone noticing.
 */
export const LEDGER_AUTHORITIES_REUSED: readonly string[] = [
  "REG_1_446_1_A_2_CLEARLY_REFLECT",
  "REG_1_446_1_D_2_SEPARATE_BOOKS",
  "REG_1_446_1_E_2_II_B_NOT_A_METHOD",
  "AS_1105_11_COMPLETENESS",
  "AS_2401_58_JOURNAL_ENTRIES",
  "WAC_314_55_087_AUDIT_TRAIL",
  "IRC_280E",
  "IRC_6001_SUBSTANTIATION",
];

// ===========================================================================
// 2) BALANCE FORWARD — the fix, as a pure fold
// ===========================================================================

/**
 * The minimum shape this module needs from a ledger row. Deliberately a
 * STRUCTURAL subset of `LedgerRow` (ledger-store.ts) rather than an import of
 * it, so this core stays free of anything that touches the database. If
 * `LedgerRow` ever loses one of these fields, the call site stops compiling —
 * which is the desired outcome.
 */
export type LedgerLineLike = {
  journal_date: string;
  journal_no: number;
  journal_status: string;
  account_code: string;
  account_name: string;
  memo: string | null;
  description: string | null;
  source_kind: string | null;
  source_ref: string | null;
  debit_cents: number;
  credit_cents: number;
};

/**
 * PERMANENT vs TEMPORARY — the distinction that decides what a "balance" means.
 *
 * This is not decoration. It changes the arithmetic:
 *
 *   PERMANENT (real) accounts — assets, liabilities, equity. These carry their
 *   balance forever. Cash on 2027-03-01 is every dollar that ever came in minus
 *   every dollar that ever went out, back to the opening balance. Their balance
 *   is INCEPTION-TO-DATE.
 *
 *   TEMPORARY (nominal) accounts — income, cogs, expense, other income, other
 *   expense. These measure ONE YEAR and then reset. On the last day of the year
 *   their balances are swept into Retained Earnings by a closing entry, so they
 *   start the next year at zero. Their balance is FISCAL-YEAR-TO-DATE.
 *
 * WHY THIS IS IN THE CODE AND NOT JUST IN A COMMENT: folding prior-year revenue
 * forward into a 2027 ledger would report two years of sales as if they were one
 * year's. It happens to be harmless in fiscal 2026 — the first year, where there
 * is no prior year to carry — which is exactly what makes it dangerous: the bug
 * would not appear until 2027-01-01, on live books, after go-live.
 */
export type AccountNature = "permanent" | "temporary";

/** Which of the two natures does this account type have? Total function. */
export function natureOf(type: AccountType): AccountNature {
  return type === "asset" || type === "liability" || type === "equity"
    ? "permanent"
    : "temporary";
}

/**
 * First day of the fiscal year containing `isoDate`.
 *
 * The fiscal year here is the CALENDAR year, matching `fiscalYearOf()` in
 * ledger-core.ts and `gl_periods` (0172), which numbers periods 1-12 by month.
 * If the entity ever adopts a non-calendar year this is the single place that
 * changes.
 */
export function fiscalYearStartOf(isoDate: string): string {
  return `${isoDate.slice(0, 4)}-01-01`;
}

/**
 * THE DATE THE BALANCE-FORWARD FOLD STARTS FROM, given an account's nature.
 *
 * Returns null for permanent accounts, meaning "no floor — fold everything back
 * to inception". Returns the fiscal-year start for temporary accounts, meaning
 * "fold only this year; last year was closed out to Retained Earnings".
 */
export function foldStartFor(windowFrom: string, nature: AccountNature): string | null {
  return nature === "permanent" ? null : fiscalYearStartOf(windowFrom);
}

/** One account's activity for the window, with a TRUE opening figure. */
export type AccountSection = {
  accountCode: string;
  accountName: string;
  /** Net of every line dated BEFORE the window. Positive = net debit. */
  balanceForwardCents: number;
  /** True when at least one pre-window line existed to fold. */
  hasBalanceForward: boolean;
  /** How many lines were folded — shown so the fold is never a black box. */
  foldedLineCount: number;
  /** The window's own lines, each carrying a running balance that starts at the fold. */
  rows: readonly (LedgerLineLike & { runningBalanceCents: number })[];
  /** Balance after the last row in the window. */
  closingBalanceCents: number;
  /**
   * Permanent accounts carry from inception; temporary accounts carry only from
   * the start of the fiscal year. Carried on the section so the screen can label
   * the row honestly instead of the reader having to infer it.
   */
  nature: AccountNature;
  /**
   * The date the fold started from: null for permanent (inception), or the
   * fiscal-year start for temporary. Rendered next to "Balance forward" so the
   * figure is never a number with no provenance.
   */
  foldStartDate: string | null;
  /**
   * Temporary-account lines from PRIOR fiscal years that were deliberately not
   * folded. Counted rather than silently discarded: if this is non-zero and the
   * prior year was never formally closed, the books are telling you something,
   * and `detectUnclosedPriorYear()` is what asks the question.
   */
  droppedPriorYearLineCount: number;
};

/**
 * FOLD EVERYTHING BEFORE THE WINDOW INTO AN OPENING FIGURE.
 *
 * Feed this the INCEPTION-TO-DATE rows (i.e. call the RPC with `from = null`,
 * letting it use its own 2025-12-31 default) plus the window the user actually
 * asked for. Rows dated before `windowFrom` are summed into
 * `balanceForwardCents`; rows inside the window are returned with a running
 * balance that continues from it.
 *
 * SIGN CONVENTION, stated once because getting it wrong is the whole ballgame:
 * a line's contribution is `debit_cents - credit_cents`. POSITIVE means a net
 * DEBIT balance. This matches `gl_journal_lines.amount_cents` and the trial
 * balance exactly, so no screen has to translate.
 *
 * NATURE-AWARE. Pass `natures` (build it with `natureMapFrom()`) and permanent
 * accounts fold from inception while temporary accounts fold only from the start
 * of the fiscal year, because their prior years were closed to Retained
 * Earnings. Omit it and everything folds from inception — correct in fiscal 2026
 * because no prior year exists, and overstated afterwards. Always pass it.
 *
 * PURE: no clock, no I/O. Input order is not trusted — rows are sorted here by
 * (date, journal_no) so a caller cannot produce a different running balance by
 * handing them over shuffled.
 */
export function foldBalanceForward(
  allRows: readonly LedgerLineLike[],
  windowFrom: string,
  natures?: ReadonlyMap<string, AccountNature>,
): readonly AccountSection[] {
  const byAccount = new Map<string, LedgerLineLike[]>();
  for (const r of allRows) {
    const list = byAccount.get(r.account_code);
    if (list) list.push(r);
    else byAccount.set(r.account_code, [r]);
  }

  const sections: AccountSection[] = [];

  for (const [code, rowsIn] of byAccount) {
    // Deterministic order regardless of what the caller handed us.
    const rows = [...rowsIn].sort((a, b) => {
      if (a.journal_date !== b.journal_date) return a.journal_date < b.journal_date ? -1 : 1;
      return a.journal_no - b.journal_no;
    });

    // Nature decides HOW FAR BACK the fold reaches. Unknown accounts are treated
    // as PERMANENT, deliberately: that folds everything and can only ever
    // OVERSTATE how much history is shown. The opposite default would silently
    // drop opening balances — which is the exact defect this function exists to
    // fix, so the safe direction is not a matter of taste.
    const nature = natures?.get(code) ?? "permanent";
    const foldStart = foldStartFor(windowFrom, nature);

    let forward = 0;
    let folded = 0;
    let dropped = 0;
    const windowRows: (LedgerLineLike & { runningBalanceCents: number })[] = [];

    for (const r of rows) {
      const delta = r.debit_cents - r.credit_cents;
      const beforeWindow = r.journal_date < windowFrom;
      // A temporary account's prior YEARS were closed out to Retained Earnings,
      // so they are not part of this year's figure and must not be folded.
      const insideFoldReach = foldStart === null || r.journal_date >= foldStart;
      if (beforeWindow && insideFoldReach) {
        forward += delta;
        folded += 1;
      } else if (!beforeWindow) {
        windowRows.push({ ...r, runningBalanceCents: 0 });
      } else {
        // A temporary account's prior-year line: correctly excluded from this
        // year's figure, but counted so the exclusion is visible and testable.
        dropped += 1;
      }
    }

    // Second pass so the running balance provably starts AT the fold.
    let running = forward;
    for (const wr of windowRows) {
      running += wr.debit_cents - wr.credit_cents;
      wr.runningBalanceCents = running;
    }

    sections.push({
      accountCode: code,
      accountName: rows[0]?.account_name ?? code,
      balanceForwardCents: forward,
      hasBalanceForward: folded > 0,
      foldedLineCount: folded,
      rows: windowRows,
      closingBalanceCents: running,
      nature,
      foldStartDate: foldStart,
      droppedPriorYearLineCount: dropped,
    });
  }

  return sections.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

/**
 * Build the nature lookup the fold wants, from the same `AccountFacts` the
 * scanner already receives. One input, one derivation — so the fold and the
 * scanner can never disagree about what kind of account something is.
 */
export function natureMapFrom(
  facts: readonly AccountFacts[],
): ReadonlyMap<string, AccountNature> {
  const m = new Map<string, AccountNature>();
  for (const f of facts) m.set(f.code, natureOf(f.accountType));
  return m;
}

// ===========================================================================
// 3) THE WRONG-SIDE SCANNER — the thing nothing was doing
//
// The trial balance counts abnormal accounts. It cannot say WHICH LINE made an
// account go wrong, because it only ever sees totals. The general ledger is the
// only report in the system that sees transactions, so it is the only place
// this question can be answered — and until this slice, nothing asked it.
//
// TONE, DELIBERATELY. A credit balance in cash is not fraud; it is usually a
// missing deposit or a payment entered twice. Every finding below is phrased as
// something to go and look at, with the NEXT ACTION attached. Michael's standing
// instruction is that the system "pushes back and tries to help me enter it
// correctly rather than rejecting it outright" — and this is a REPORT, not a
// posting gate, so it advises and never blocks. The hard refusals live in the
// posting service where they belong.
// ===========================================================================

export type LedgerFindingCode =
  | "WRONG_SIDE_CLOSING"
  | "WRONG_SIDE_INTRAPERIOD"
  | "NEGATIVE_INVENTORY"
  | "NEGATIVE_CASH"
  | "UNEXPLAINED_ROUND_PLUG"
  | "THIN_DESCRIPTION_LARGE_AMOUNT"
  | "PRIOR_YEAR_NEVER_CLOSED";

export const ALL_LEDGER_FINDING_CODES: readonly LedgerFindingCode[] = [
  "WRONG_SIDE_CLOSING",
  "WRONG_SIDE_INTRAPERIOD",
  "NEGATIVE_INVENTORY",
  "NEGATIVE_CASH",
  "UNEXPLAINED_ROUND_PLUG",
  "THIN_DESCRIPTION_LARGE_AMOUNT",
  "PRIOR_YEAR_NEVER_CLOSED",
] as const;

/**
 * Severity is about how hard to look, never about blame.
 *   "look"  — worth a glance; often perfectly fine
 *   "check" — go and confirm this against a document today
 *   "stop"  — this cannot be true of a real business; something is wrong
 */
export type LedgerSeverity = "look" | "check" | "stop";

export const LEDGER_SEVERITY_MEANING: Record<LedgerSeverity, string> = {
  look: "Probably fine. Worth knowing about, not worth losing sleep over.",
  check:
    "Go and confirm this against a document before the month closes. It is the kind of thing that is easy to fix today and expensive to fix in a year.",
  stop:
    "This cannot be true of a real business. A physical thing cannot be less than nothing. Something was recorded wrong, or something real is missing.",
};

export type LedgerFinding = {
  code: LedgerFindingCode;
  severity: LedgerSeverity;
  accountCode: string;
  accountName: string;
  /** The line that caused it, when a single line can be named. */
  journalNo: number | null;
  journalDate: string | null;
  /** The balance in question, in cents. Positive = net debit. */
  balanceCents: number;
  /** Plain English. No jargon, no accusation. */
  headline: string;
  /** What to actually go and do about it. Never a finding without a remedy. */
  whatToDo: string;
  authorityIds: readonly string[];
};

/** What the scanner needs to know about an account. Comes from `listAccounts()`. */
export type AccountFacts = {
  code: string;
  name: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
};

/** A materially large line, for the thin-description screen. $2,500.00. */
export const LARGE_LINE_CENTS = 250_000;

/** Below this many characters a description is not a description. */
export const THIN_DESCRIPTION_CHARS = 8;

/** A "suspiciously round" amount: whole hundreds of dollars or more. */
export function isRoundHundred(cents: number): boolean {
  return cents !== 0 && Math.abs(cents) % 10_000 === 0;
}

/**
 * Is this balance on the wrong side of normal?
 *
 * Positive cents = net debit. So a debit-normal account is wrong when negative,
 * and a credit-normal account is wrong when positive. A ZERO balance is never
 * wrong — an account that nets to nothing is closed, not abnormal. This mirrors
 * the trial balance SQL (`having sum(...) <> 0`) exactly, on purpose: two
 * screens disagreeing about what "abnormal" means would be its own defect.
 */
export function isWrongSide(balanceCents: number, normal: NormalBalance): boolean {
  if (balanceCents === 0) return false;
  return normal === "debit" ? balanceCents < 0 : balanceCents > 0;
}

/** Cash-ish accounts live in block 1; inventory in block 2. */
function isInventoryAccount(code: string, type: AccountType): boolean {
  return type === "asset" && blockOf(code) === 2;
}
function isCashAccount(code: string, type: AccountType): boolean {
  return type === "asset" && blockOf(code) === 1;
}

/**
 * SCAN ONE ACCOUNT'S SECTION FOR THINGS A CPA WOULD STOP ON.
 *
 * Order matters: the most specific finding wins, so a negative inventory
 * balance is reported as NEGATIVE_INVENTORY (with the count-and-adjust remedy
 * from §1.471-2(d)) rather than as a generic wrong-side balance. Reporting the
 * generic version of a specific problem is how real findings get ignored.
 */
export function scanAccountSection(
  section: AccountSection,
  facts: AccountFacts,
): readonly LedgerFinding[] {
  const out: LedgerFinding[] = [];
  const base = { accountCode: facts.code, accountName: facts.name };

  // ── (1) THE CLOSING BALANCE ───────────────────────────────────────────────
  if (isWrongSide(section.closingBalanceCents, facts.normalBalance)) {
    const last = section.rows[section.rows.length - 1];
    if (isInventoryAccount(facts.code, facts.accountType)) {
      out.push({
        ...base,
        code: "NEGATIVE_INVENTORY",
        severity: "stop",
        journalNo: last?.journal_no ?? null,
        journalDate: last?.journal_date ?? null,
        balanceCents: section.closingBalanceCents,
        headline:
          "This inventory account ends the period holding LESS THAN NOTHING. You cannot have negative jars on a shelf, so this is not a small discrepancy — either sales were recorded for product that was never received into the books, or a purchase never got entered.",
        whatToDo:
          "Find the first line below where the balance goes under zero — that date is when the books and the shelf parted company. Then count the actual product and post a counted adjustment. The tax regulation expects book inventory to be checked against a physical count and corrected to match; that count is what makes your cost of goods sold defensible.",
        authorityIds: ["REG_1_471_2_D_VERIFY_BY_COUNT", "IRC_280E"],
      });
    } else if (isCashAccount(facts.code, facts.accountType)) {
      out.push({
        ...base,
        code: "NEGATIVE_CASH",
        severity: "stop",
        journalNo: last?.journal_no ?? null,
        journalDate: last?.journal_date ?? null,
        balanceCents: section.closingBalanceCents,
        headline:
          "This cash account ends the period NEGATIVE. A till, a vault or an ATM cassette cannot contain less than nothing, so a real deposit is almost certainly missing from the books, or one payment got entered twice.",
        whatToDo:
          "Work down to the first line that pushes the balance below zero and check that date against the bank statement or the cash count. In a cash business this is nearly always an unrecorded deposit — and an unrecorded deposit is invisible on the trial balance, because a missing entry cancels itself and the books still foot.",
        authorityIds: ["AS_1105_11_COMPLETENESS", "REG_1_6001_1_A_PERMANENT_BOOKS"],
      });
    } else {
      out.push({
        ...base,
        code: "WRONG_SIDE_CLOSING",
        severity: "check",
        journalNo: last?.journal_no ?? null,
        journalDate: last?.journal_date ?? null,
        balanceCents: section.closingBalanceCents,
        headline: `This account normally carries a ${facts.normalBalance} balance and it is currently sitting on the other side.`,
        whatToDo:
          "Sometimes this is real and fine — a bank account overdrawn, a vendor you have overpaid, a customer in credit. Sometimes it means an entry went in backwards. Read down the lines and find the one that flipped it; if you can explain it in a sentence, write that sentence into the memo and it stops being a question forever.",
        authorityIds: ["REG_1_446_1_A_2_CLEARLY_REFLECT"],
      });
    }
  }

  // ── (2) THE LINE THAT DID IT — only when the account ENDS FINE ────────────
  // An account that dips wrong-side mid-period and recovers is the subtle one:
  // no total anywhere in the system will ever show it, because by month-end it
  // looks perfect. This is the single clearest example of why a ledger is read
  // line by line and not in summary.
  if (!isWrongSide(section.closingBalanceCents, facts.normalBalance)) {
    const dip = section.rows.find((r) => isWrongSide(r.runningBalanceCents, facts.normalBalance));
    if (dip) {
      out.push({
        ...base,
        code: "WRONG_SIDE_INTRAPERIOD",
        severity: "look",
        journalNo: dip.journal_no,
        journalDate: dip.journal_date,
        balanceCents: dip.runningBalanceCents,
        headline:
          "This account went to the wrong side partway through the period and then came back, so it looks perfect on every summary report and only shows up here.",
        whatToDo:
          "Usually this just means things were entered out of order — the payment keyed before the deposit. Worth a look because the other explanation is that something was recorded in the wrong month, and if that month is already closed the fix is a fresh correcting entry, not an edit.",
        authorityIds: ["REG_1_446_1_E_2_II_B_NOT_A_METHOD"],
      });
    }
  }

  // ── (3) THE $4.6M LAZY ENTRY, IN MINIATURE ───────────────────────────────
  // Round + big + hand-typed + no explanation. That combination is precisely
  // what a plug looks like, and it is in the permanent test corpus because it
  // has already happened once in these books.
  for (const r of section.rows) {
    const amount = Math.max(r.debit_cents, r.credit_cents);
    const text = (r.description || r.memo || "").trim();
    const manual = r.source_kind === "manual" || r.source_kind === null;

    if (manual && amount >= LARGE_LINE_CENTS && isRoundHundred(amount) && text.length < THIN_DESCRIPTION_CHARS) {
      out.push({
        ...base,
        code: "UNEXPLAINED_ROUND_PLUG",
        severity: "check",
        journalNo: r.journal_no,
        journalDate: r.journal_date,
        balanceCents: amount,
        headline:
          "A large, perfectly round, hand-typed amount with almost nothing written next to it. That exact combination is what a balancing plug looks like — a number chosen to make something agree rather than because it happened.",
        whatToDo:
          "If it is real, say so in the memo right now while you still remember: which invoice, which deposit, which document. One sentence today removes the question permanently. If you cannot say what it was for, that is the answer — it needs to be traced or reversed.",
        authorityIds: ["AS_2401_58_JOURNAL_ENTRIES", "IRC_6001_SUBSTANTIATION"],
      });
    } else if (amount >= LARGE_LINE_CENTS && text.length < THIN_DESCRIPTION_CHARS) {
      out.push({
        ...base,
        code: "THIN_DESCRIPTION_LARGE_AMOUNT",
        severity: "look",
        journalNo: r.journal_no,
        journalDate: r.journal_date,
        balanceCents: amount,
        headline:
          "A large amount with next to nothing written beside it. It is almost certainly fine; it just cannot prove itself.",
        whatToDo:
          "Add a line of memo naming the document. You will not remember this in three years, and three years is exactly how long it takes for someone to ask.",
        authorityIds: ["WAC_314_55_087_AUDIT_TRAIL", "IRC_6001_SUBSTANTIATION"],
      });
    }
  }

  return out;
}

/** Scan every section. Accounts with no facts are skipped, never guessed at. */
export function scanLedger(
  sections: readonly AccountSection[],
  facts: readonly AccountFacts[],
): readonly LedgerFinding[] {
  const byCode = new Map(facts.map((f) => [f.code, f]));
  const out: LedgerFinding[] = [];
  for (const s of sections) {
    const f = byCode.get(s.accountCode);
    if (!f) continue; // never invent a normal balance
    out.push(...scanAccountSection(s, f));
  }
  out.push(...detectUnclosedPriorYear(sections));
  return out;
}

/**
 * THE YEAR-END CLOSE CHECK.
 *
 * A temporary account only resets to zero because somebody posts a CLOSING
 * ENTRY on the last day of the year, sweeping the year's profit into Retained
 * Earnings. If that entry is never posted, the balance sheet and the tax return
 * disagree about retained earnings, and nothing about the trial balance
 * complains — it still foots perfectly, because the missing entry is missing
 * from both sides at once.
 *
 * This raises ONE finding for the whole ledger, not one per account, because it
 * is one omission. It is reported as "check" rather than "stop": early in a new
 * year the close legitimately may not have been done yet, and a report must not
 * cry wolf about something that is merely not-yet-due.
 */
export function detectUnclosedPriorYear(
  sections: readonly AccountSection[],
): readonly LedgerFinding[] {
  const affected = sections.filter(
    (s) => s.nature === "temporary" && s.droppedPriorYearLineCount > 0,
  );
  if (affected.length === 0) return [];

  const lines = affected.reduce((n, s) => n + s.droppedPriorYearLineCount, 0);
  return [
    {
      code: "PRIOR_YEAR_NEVER_CLOSED",
      severity: "check",
      accountCode: affected[0].accountCode,
      accountName: `${affected.length} income and expense account${affected.length === 1 ? "" : "s"}`,
      journalNo: null,
      journalDate: affected[0].foldStartDate,
      balanceCents: 0,
      headline:
        `This ledger contains ${lines} income or expense line${lines === 1 ? "" : "s"} from a previous year. Those lines are correctly left out of this year's figures — last year is last year — but they are only truly "gone" if a year-end closing entry actually moved last year's profit into Retained Earnings.`,
      whatToDo:
        "Open last year's final month and confirm a closing entry exists that zeroes every income and expense account into Retained Earnings. If it does not, your balance sheet understates Retained Earnings by exactly last year's profit, and the trial balance will not warn you, because a missing entry is missing from both sides and the books still add up.",
      authorityIds: ["REG_1_446_1_A_2_CLEARLY_REFLECT", "AS_1105_11_COMPLETENESS"],
    },
  ];
}

/** Sort order for display: stop first, then check, then look. */
export const SEVERITY_RANK: Record<LedgerSeverity, number> = { stop: 0, check: 1, look: 2 };

export function sortFindings(findings: readonly LedgerFinding[]): readonly LedgerFinding[] {
  return [...findings].sort((a, b) => {
    if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) {
      return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    }
    if (a.accountCode !== b.accountCode) return a.accountCode.localeCompare(b.accountCode);
    return (a.journalNo ?? 0) - (b.journalNo ?? 0);
  });
}

/** One plain sentence summarising a scan. Never alarming, never falsely calm. */
export function summariseFindings(findings: readonly LedgerFinding[]): {
  tone: "clean" | "notice" | "warning";
  headline: string;
} {
  const stops = findings.filter((f) => f.severity === "stop").length;
  const checks = findings.filter((f) => f.severity === "check").length;

  if (stops > 0) {
    return {
      tone: "warning",
      headline: `${stops} ${stops === 1 ? "balance is" : "balances are"} impossible for a real business — something physical is less than nothing. Start there.`,
    };
  }
  if (checks > 0) {
    return {
      tone: "notice",
      headline: `${checks} ${checks === 1 ? "line is" : "lines are"} worth confirming against a document before this month closes.`,
    };
  }
  if (findings.length > 0) {
    return {
      tone: "notice",
      headline: `Nothing serious. ${findings.length} minor ${findings.length === 1 ? "item" : "items"} worth a glance.`,
    };
  }
  return {
    tone: "clean",
    headline:
      "Nothing on this ledger is sitting on the wrong side, and no line is large, round and unexplained. Note that this checks whether what IS here makes sense — it cannot see a transaction that was never entered.",
  };
}

// ===========================================================================
// 3b) THE TRIAL BALANCE, BUILT FROM THE SAME FOLD
//
// A trial balance and a general ledger must never disagree. Before this slice
// they could: the ledger page and the trial balance page each summed their own
// query over their own window, and BOTH windows started on 2026-01-01, which
// excludes the cut-over opening balances (dated 2025-12-31, the only pre-2026
// date the schema permits — 0172's line-in-the-sand constraint).
//
// The result was not a rounding difference. It was a trial balance that showed
// PERIOD ACTIVITY under a column headed "Balance", counted accounts as being on
// the "wrong side" because their opening balance was missing, and then still
// FOOTED perfectly — so nothing anywhere raised a hand. A report that is wrong
// and self-certifying is worse than a report that is merely wrong.
//
// Building the trial balance from the SAME sections the ledger renders makes
// that class of disagreement structurally impossible rather than merely
// unlikely.
// ===========================================================================

export type TrialBalanceLine = {
  accountCode: string;
  accountName: string;
  /** Positive = net debit. Same convention as everywhere else in the system. */
  balanceCents: number;
  debitCents: number;
  creditCents: number;
  nature: AccountNature;
  /** True when the balance sits on the opposite side from this account's normal. */
  isAbnormal: boolean;
};

export type TrialBalanceView = {
  lines: readonly TrialBalanceLine[];
  totalDebitCents: number;
  totalCreditCents: number;
  /** Debits minus credits. Zero means the books foot. */
  differenceCents: number;
  foots: boolean;
  abnormalCount: number;
  /** Accounts present in the ledger that the chart could not explain. */
  unmappedAccountCodes: readonly string[];
};

/**
 * BUILD A TRIAL BALANCE FROM FOLDED SECTIONS.
 *
 * Each account's figure is its CLOSING balance — opening carried forward plus
 * the window's own activity — which is what the word "balance" means. Accounts
 * that net to exactly zero are dropped, matching the trial balance SQL's
 * `having sum(...) <> 0`, so the two never disagree about which rows exist.
 *
 * "Abnormal" is decided here, once, by `isWrongSide()` — the same function the
 * ledger scanner uses. One definition, two screens.
 *
 * An account the chart cannot explain is NOT silently assumed to be normal: it
 * still contributes to the totals (its money is real) but it is named in
 * `unmappedAccountCodes` so the screen can say so out loud. This is the exact
 * shape of the GRWNY/GRNWY typo that once hid eighteen accounts, including the
 * whole of payroll.
 */
export function buildTrialBalance(
  sections: readonly AccountSection[],
  facts: readonly AccountFacts[],
): TrialBalanceView {
  const byCode = new Map(facts.map((f) => [f.code, f]));
  const lines: TrialBalanceLine[] = [];
  const unmapped: string[] = [];

  for (const sec of sections) {
    const bal = sec.closingBalanceCents;
    if (bal === 0) continue;

    const f = byCode.get(sec.accountCode);
    if (!f) unmapped.push(sec.accountCode);

    lines.push({
      accountCode: sec.accountCode,
      accountName: sec.accountName,
      balanceCents: bal,
      debitCents: bal > 0 ? bal : 0,
      creditCents: bal < 0 ? -bal : 0,
      nature: sec.nature,
      // Unknown account -> not claimed to be abnormal. We do not invent a
      // normal balance; we report the account as unmapped instead.
      isAbnormal: f ? isWrongSide(bal, f.normalBalance) : false,
    });
  }

  lines.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

  const totalDebitCents = lines.reduce((n, l) => n + l.debitCents, 0);
  const totalCreditCents = lines.reduce((n, l) => n + l.creditCents, 0);
  const differenceCents = totalDebitCents - totalCreditCents;

  return {
    lines,
    totalDebitCents,
    totalCreditCents,
    differenceCents,
    foots: differenceCents === 0,
    abnormalCount: lines.filter((l) => l.isAbnormal).length,
    unmappedAccountCodes: unmapped.sort(),
  };
}

// ===========================================================================
// 4) HOW TO READ A LEDGER — the mentor sequence
//
// This is the part Michael actually asked for: not "what is a ledger" but the
// order a professional reads one in, and WHY that order. The order is the
// teaching. Most people start at the biggest number; a CPA starts by checking
// that the window even contains what it claims to.
// ===========================================================================

export type LedgerReadingStep = {
  step: number;
  action: string;
  why: string;
  ifSkipped: string;
  authorityIds: readonly string[];
};

export const LEDGER_READING_STEPS: readonly LedgerReadingStep[] = [
  {
    step: 1,
    action:
      "Look at the dates at the top before you look at a single number, and check whether 'Balance forward' appears.",
    why:
      "A ledger is only ever a window onto a period, and the balance you see is only true if everything before that window has been carried in. Balance forward is that carry-in. Without it the first number you read is not a balance at all, it is a subtotal of one month pretending to be a balance.",
    ifSkipped:
      "You read a period's activity as though it were a balance. That is not hypothetical here: this screen used to start every account at zero on 1 January and drop the opening balances entirely, so a cash account holding $1,000 displayed as NEGATIVE $3,000. Same books, same lines, wrong window.",
    authorityIds: ["REG_1_446_1_A_2_CLEARLY_REFLECT"],
  },
  {
    step: 2,
    action: "Check the entity selector. Greenway, the ATM, the land, or you personally.",
    why:
      "Four sets of books, four different tax consequences. The same $500 is a deduction in one and a §280E disallowance in another. Reading the right number from the wrong entity produces a confident, wrong answer.",
    ifSkipped:
      "The argument that the ATM and the rental are genuinely separate businesses gets weaker every time their numbers are read together — and that separation is what keeps §280E away from them.",
    authorityIds: ["REG_1_446_1_D_2_SEPARATE_BOOKS"],
  },
  {
    step: 3,
    action:
      "Run your eye down the Balance column looking ONLY for the wrong side — negatives on things you own, positives on things you owe.",
    why:
      "This is the fastest error detector in accounting and it costs about four seconds. Nearly every serious bookkeeping failure shows up first as a balance on the wrong side: a backwards entry, a missing deposit, product sold that was never received.",
    ifSkipped:
      "Your Sage books carried eight inventory accounts with impossible credit balances totalling a negative $4.39 million, and they were sitting there in plain sight for years. Nobody looked at this column.",
    authorityIds: ["REG_1_471_2_D_VERIFY_BY_COUNT"],
  },
  {
    step: 4,
    action:
      "When a balance is wrong-sided, do NOT look at the total — walk down the lines and find the first one that pushed it over.",
    why:
      "The total tells you there is a problem; only the line tells you what happened, and the date on that line is usually the whole answer. This is the one thing a ledger can do that no summary report can.",
    ifSkipped:
      "People 'fix' a wrong balance by posting an adjustment for the difference. That is a plug. It makes the symptom disappear and leaves the cause in place — and now there are two wrong entries instead of one.",
    authorityIds: ["AS_2401_58_JOURNAL_ENTRIES"],
  },
  {
    step: 5,
    action: "Read the Detail column on the biggest amounts. Ask whether the words explain the number.",
    why:
      "'Adjustment' next to $4,624,697.31 is not an explanation, and that is not an invented example — it is in these books. A large amount whose description could apply to anything is the single most reliable sign of an entry made to force a total.",
    ifSkipped:
      "You keep the number and lose the reason. Three years later the burden of proving it was real is yours, and 'I remember it being right' is not evidence.",
    authorityIds: ["IRC_6001_SUBSTANTIATION", "WAC_314_55_087_AUDIT_TRAIL"],
  },
  {
    step: 6,
    action: "Look at what is marked REVERSED, and satisfy yourself you know why each one happened.",
    why:
      "Reversals are shown here, never hidden, because that is how a correction is supposed to work: the mistake and its undoing both stay visible. A ledger you can delete from is a story, not a record.",
    ifSkipped:
      "A pattern of reversals around period ends is one of the first things an examiner looks for. Better that you noticed it, and can say why, before anyone asks.",
    authorityIds: ["REG_1_446_1_E_2_II_B_NOT_A_METHOD"],
  },
  {
    step: 7,
    action:
      "Finally, remember what this screen CANNOT tell you: whether anything is missing.",
    why:
      "Every line here is a line somebody entered. A sale that was never written down is not faint on this report, it is absent — and its absence is invisible, because a missing entry leaves out a debit AND a credit, so the books still balance perfectly.",
    ifSkipped:
      "You conclude that balanced books are complete books. They are not the same claim, and only comparing to something OUTSIDE the books — the bank statement, the cash count, the CCRS report — can settle the second one.",
    authorityIds: ["AS_1105_11_COMPLETENESS"],
  },
];

// ===========================================================================
// 5) THE CHART OF ACCOUNTS — what choosing an account actually decides
//
// Michael's note: "the chart of accounts is fairly solid, I'm guessing we just
// need GAAP specific methods and logic, plus mapping accounts."
//
// He is right that the STRUCTURE is solid (coa-core enforces blocks, normal
// balances, contra handling, mirrored categories). What is missing is the part
// that matters most in a §280E business: the reason the choice is consequential
// at all. Picking an account here is not filing. It is deciding whether a
// dollar is deductible.
// ===========================================================================

export type AccountChoiceConsequence = {
  /** The account family, in his words not the textbook's. */
  family: string;
  /** Which block of the chart. */
  block: number;
  /** What choosing it DECIDES. The consequence, not the definition. */
  decides: string;
  /** The mistake that actually gets made here. */
  commonMistake: string;
  /** How to tell you have it right. */
  tellTale: string;
  authorityIds: readonly string[];
};

export const ACCOUNT_CHOICE_CONSEQUENCES: readonly AccountChoiceConsequence[] = [
  {
    family: "Cost of goods sold (block 6) versus operating expense (block 7)",
    block: 6,
    decides:
      "Whether the dollar survives §280E. Cost of goods sold comes off your income before §280E can touch it; an operating expense of a cannabis business does not come off at all. This one choice is worth more money to you than every other line on this page combined.",
    commonMistake:
      "Sweeping anything that feels product-related into COGS because it is the favourable answer. As a RESELLER your cost of goods is essentially the invoice price of the product plus the cost of getting it here — not your budtenders, not rent, not the security guard, however much those feel like a cost of selling.",
    tellTale:
      "Ask: would this dollar exist if I had bought the product and never opened the doors? If the answer is no, it is almost certainly an operating expense, and calling it COGS is the exact position the IRS has beaten cannabis retailers on repeatedly.",
    authorityIds: ["IRC_280E", "REG_1_471_3_B", "CCA_201504011"],
  },
  {
    family: "Capital assets (block 2) versus repairs and maintenance (block 7)",
    block: 2,
    decides:
      "Which YEAR the money comes off. Something with a life beyond this year has to go on the balance sheet and come off gradually; a repair comes off now.",
    commonMistake:
      "Booking a new display case, a security system or a build-out to Repairs because a single invoice arrived and it felt like an expense.",
    tellTale:
      "Will it still be here and still useful next year? Then it is capital. The regulation is explicit that plant and equipment with a life extending substantially beyond the year is charged to a capital account, not an expense account.",
    authorityIds: ["REG_1_446_1_A_4_II_CAPITAL_VS_EXPENSE"],
  },
  {
    family: "Excise tax payable (block 3) versus revenue (block 5)",
    block: 3,
    decides:
      "Whether you are reporting money that was never yours as income. The 37% excise is collected and held for the state; it is a liability from the second it is collected.",
    commonMistake:
      "Letting excise land in a revenue account to make a total agree. This is why the chart physically refuses it — a 5xxxx code cannot hold a liability, so the mistake is unrepresentable rather than merely discouraged.",
    tellTale:
      "If the money is going to the Liquor and Cannabis Board rather than staying with you, it is a liability. It is not income you later pay away.",
    authorityIds: ["RCW_69_50_535", "IRC_7501_TRUST"],
  },
  {
    family: "Owner draws (block 4) versus wages (block 7)",
    block: 4,
    decides:
      "Whether it hits the profit and loss at all. A distribution is not an expense of the business; your W-2 wage is.",
    commonMistake:
      "Treating money taken out of the business as though it reduced profit. It does not — it reduces equity.",
    tellTale:
      "Did payroll tax get withheld on it? If not, it is not wages. As an S-corp shareholder-employee that split is watched closely, because it is the difference between wages subject to payroll tax and distributions that are not.",
    authorityIds: ["REG_1_446_1_A_2_CLEARLY_REFLECT"],
  },
  {
    family: "Separate-business accounts (the ATM and the land)",
    block: 7,
    decides:
      "Whether §280E reaches those activities at all. They are separate trades or businesses, and their expenses are ordinary deductible expenses — but only for as long as their books stay genuinely separate.",
    commonMistake:
      "Paying an ATM or rental cost out of the Greenway account and coding it to a Greenway expense because that is where the money moved from.",
    tellTale:
      "The regulation is blunt: no trade or business is treated as separate and distinct unless a complete and separable set of books and records is kept for it. Four entities exist in this system for exactly that reason. Use them.",
    authorityIds: ["REG_1_446_1_D_2_SEPARATE_BOOKS", "CHAMP", "IRC_280E"],
  },
];

/** Every block, described in one plain sentence, for the COA explainer. */
export type BlockNote = { block: number; name: string; plainEnglish: string };

export const COA_BLOCK_NOTES: readonly BlockNote[] = [
  { block: 1, name: COA_BLOCKS[1].name, plainEnglish: "Money you can spend today: tills, vault, bank, the ATM cassette." },
  { block: 2, name: COA_BLOCKS[2].name, plainEnglish: "Things you own: product on the shelf, equipment, the build-out." },
  { block: 3, name: COA_BLOCKS[3].name, plainEnglish: "Money you owe: vendors, payroll taxes, and the excise you are holding for the state." },
  { block: 4, name: COA_BLOCKS[4].name, plainEnglish: "What the business is worth to its owners, and what has been taken out." },
  { block: 5, name: COA_BLOCKS[5].name, plainEnglish: "What you sold — before any cost comes off." },
  { block: 6, name: COA_BLOCKS[6].name, plainEnglish: "What the product itself cost you. The §280E-protected column." },
  { block: 7, name: COA_BLOCKS[7].name, plainEnglish: "The cost of running the shop. In a cannabis business, mostly not deductible." },
  { block: 8, name: COA_BLOCKS[8].name, plainEnglish: "Things outside normal trading: interest, one-off gains and losses." },
  { block: 9, name: COA_BLOCKS[9].name, plainEnglish: "Memo-only counters that never touch the financial statements." },
];

// ===========================================================================
// 6) SELF-TESTS
//
// Standing rule 15: a green check is worthless until it has been shown it can
// go red. So every predicate here is asserted BOTH ways — the wrong thing is
// refused, not merely the right thing accepted — and the owner's real
// historical failures are replayed rather than invented examples.
// ===========================================================================

function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`books-ledger-guidance-core self-test failed: ${msg}`);
}
function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `books-ledger-guidance-core self-test failed: ${msg} (expected ${String(expected)}, got ${String(actual)})`,
    );
  }
}

function line(
  over: Partial<LedgerLineLike> & { journal_date: string; journal_no: number },
): LedgerLineLike {
  return {
    journal_status: "posted",
    account_code: "10100",
    account_name: "Cash",
    memo: null,
    description: "a perfectly ordinary description",
    source_kind: "manual",
    source_ref: null,
    debit_cents: 0,
    credit_cents: 0,
    ...over,
  };
}

export function __runBooksLedgerGuidanceCoreTests(): void {
  // ── AUTHORITIES ──────────────────────────────────────────────────────────
  {
    const seen = new Set<string>();
    for (const a of LEDGER_AUTHORITIES_NEW) {
      ok(!seen.has(a.id), `authority ${a.id} appears once`);
      seen.add(a.id);
      ok(a.cite.trim().length > 0, `${a.id} has a citation`);
      ok(a.quote.trim().length > 40, `${a.id} has substantive quoted text`);
      ok(a.soWhat.trim().length > 40, `${a.id} explains why it matters to Greenway`);
      ok(a.source.trim().length > 0, `${a.id} says where to read it`);
    }
    // EVERY NEW AUTHORITY MUST SURVIVE THE MERGE INTACT.
    //
    // This is subtler than "does it resolve". The shared registry de-duplicates
    // by id and, on a collision, the FIRST registry to claim an id wins unless a
    // DIVERGENCE_RULINGS entry says otherwise. So if one of these ids ever
    // collided with an existing one, our text would be silently discarded and
    // the screen would quote something else under our citation — the exact
    // failure mode that registry was built to prevent, arriving through the back
    // door. Comparing the QUOTE (not merely checking presence) catches it.
    for (const a of LEDGER_AUTHORITIES_NEW) {
      const merged = findGuidanceAuthority(a.id);
      ok(merged !== undefined, `${a.id} is present in the merged registry`);
      eq(merged?.quote, a.quote, `${a.id} kept OUR verbatim text through the merge`);
      eq(merged?.cite, a.cite, `${a.id} kept our citation through the merge`);
      eq(merged?.kind, a.kind, `${a.id} kept its kind (and therefore its weight) through the merge`);
    }
    // Every REUSED id must still resolve. This is the negative control that
    // catches a rename in the shared registry before Michael sees a blank card.
    for (const id of LEDGER_AUTHORITIES_REUSED) {
      ok(findGuidanceAuthority(id) !== undefined, `reused authority ${id} still resolves`);
    }
    // ...and prove that check CAN fail, so it is not a tautology.
    eq(
      findGuidanceAuthority("NO_SUCH_AUTHORITY_AT_ALL"),
      undefined,
      "the resolver returns undefined for an unknown id (so the check above can fail)",
    );
  }

  // ── BALANCE FORWARD: the exact defect, replayed ──────────────────────────
  {
    // The fixture executed against real PostgreSQL: $4,000 opening cash dated
    // 2025-12-31, $3,000 spent 2026-03-15. Truth = $1,000.
    const rows: LedgerLineLike[] = [
      line({ journal_date: "2025-12-31", journal_no: 1, debit_cents: 400_000, source_kind: "opening_balance" }),
      line({ journal_date: "2026-03-15", journal_no: 2, credit_cents: 300_000 }),
    ];
    const sections = foldBalanceForward(rows, "2026-01-01");
    eq(sections.length, 1, "one account produces one section");
    const s = sections[0];
    eq(s.balanceForwardCents, 400_000, "the opening balance is carried forward, not dropped");
    eq(s.hasBalanceForward, true, "the fold is flagged so the screen can show it");
    eq(s.foldedLineCount, 1, "the number of folded lines is reported");
    eq(s.rows.length, 1, "only the window's own lines are listed");
    eq(s.closingBalanceCents, 100_000, "the closing balance is the TRUE $1,000.00");
    eq(s.rows[0].runningBalanceCents, 100_000, "the running balance starts from the fold");

    // THE NEGATIVE CONTROL. Without the fold — i.e. the behaviour that shipped —
    // the same rows produce the -$3,000 that the screen was showing. If this
    // assertion ever fails, the bug is fixed somewhere else and this test is
    // no longer testing anything.
    const brokenWindow = rows.filter((r) => r.journal_date >= "2026-01-01");
    const brokenBalance = brokenWindow.reduce((n, r) => n + r.debit_cents - r.credit_cents, 0);
    eq(brokenBalance, -300_000, "the OLD behaviour really did produce a negative balance");
    ok(brokenBalance !== s.closingBalanceCents, "the fold changes the answer (so it is doing work)");
    ok(
      isWrongSide(brokenBalance, "debit") && !isWrongSide(s.closingBalanceCents, "debit"),
      "the old behaviour manufactured a false wrong-side balance; the fix removes it",
    );
  }

  // ── BALANCE FORWARD: properties, not one happy example ───────────────────
  {
    // Sweep: for any split point, forward + window activity must equal the
    // total. No cent may be lost or invented by the fold. (Rule 13d.)
    const many: LedgerLineLike[] = [];
    for (let i = 0; i < 40; i++) {
      const day = String((i % 28) + 1).padStart(2, "0");
      const month = i < 20 ? "01" : "02";
      many.push(
        line({
          journal_date: `2026-${month}-${day}`,
          journal_no: i + 1,
          debit_cents: i % 2 === 0 ? (i + 1) * 137 : 0,
          credit_cents: i % 2 === 0 ? 0 : (i + 1) * 91,
        }),
      );
    }
    const total = many.reduce((n, r) => n + r.debit_cents - r.credit_cents, 0);
    for (const cut of ["2026-01-01", "2026-01-15", "2026-02-01", "2026-02-20", "2027-01-01"]) {
      const secs = foldBalanceForward(many, cut);
      const s = secs[0];
      const windowSum = s.rows.reduce((n, r) => n + r.debit_cents - r.credit_cents, 0);
      eq(s.balanceForwardCents + windowSum, total, `no cent lost or invented at cut ${cut}`);
      eq(s.closingBalanceCents, total, `closing balance is the same total at cut ${cut}`);
      // Every running balance must equal forward + the sum of rows up to it.
      let walk = s.balanceForwardCents;
      for (const r of s.rows) {
        walk += r.debit_cents - r.credit_cents;
        eq(r.runningBalanceCents, walk, `running balance is monotone-consistent at cut ${cut}`);
      }
    }
    // A cut before everything folds nothing; a cut after everything folds all.
    eq(foldBalanceForward(many, "2020-01-01")[0].foldedLineCount, 0, "nothing folded when the cut precedes all rows");
    eq(foldBalanceForward(many, "2030-01-01")[0].rows.length, 0, "nothing shown when the cut follows all rows");
    eq(
      foldBalanceForward(many, "2030-01-01")[0].closingBalanceCents,
      total,
      "a fully folded account still reports the right closing balance",
    );
  }

  // ── BALANCE FORWARD: input order must not change the answer ──────────────
  {
    const a = line({ journal_date: "2026-01-05", journal_no: 2, debit_cents: 500 });
    const b = line({ journal_date: "2026-01-02", journal_no: 1, credit_cents: 200 });
    const forward = foldBalanceForward([a, b], "2026-01-01")[0];
    const backward = foldBalanceForward([b, a], "2026-01-01")[0];
    eq(forward.closingBalanceCents, backward.closingBalanceCents, "shuffled input gives the same balance");
    eq(forward.rows[0].journal_no, 1, "rows are ordered by date regardless of input order");
    eq(backward.rows[0].journal_no, 1, "and the same when handed over reversed");
  }

  // ── isWrongSide: proven to return BOTH values across the whole domain ────
  {
    eq(isWrongSide(-1, "debit"), true, "a negative debit-normal balance is wrong-sided");
    eq(isWrongSide(1, "debit"), false, "a positive debit-normal balance is fine");
    eq(isWrongSide(1, "credit"), true, "a positive credit-normal balance is wrong-sided");
    eq(isWrongSide(-1, "credit"), false, "a negative credit-normal balance is fine");
    eq(isWrongSide(0, "debit"), false, "zero is never abnormal (matches the trial balance SQL)");
    eq(isWrongSide(0, "credit"), false, "zero is never abnormal for credit accounts either");
    // Sweep both directions so neither branch is a tautology.
    let trues = 0;
    let falses = 0;
    for (const n of [-1000, -1, 0, 1, 1000]) {
      for (const nb of ["debit", "credit"] as NormalBalance[]) {
        if (isWrongSide(n, nb)) trues++;
        else falses++;
      }
    }
    ok(trues > 0 && falses > 0, "isWrongSide returns both true and false across the domain");
  }

  // ── THE OWNER'S CORPUS: negative inventory ───────────────────────────────
  {
    const rows: LedgerLineLike[] = [
      line({ journal_date: "2026-02-01", journal_no: 5, account_code: "20100", account_name: "Inventory — Flower", credit_cents: 50_000 }),
    ];
    const sections = foldBalanceForward(rows, "2026-01-01");
    const findings = scanLedger(sections, [
      { code: "20100", name: "Inventory — Flower", accountType: "asset", normalBalance: "debit" },
    ]);
    const neg = findings.find((f) => f.code === "NEGATIVE_INVENTORY");
    ok(neg !== undefined, "a credit-balance inventory account is caught");
    eq(neg?.severity, "stop", "negative inventory is a STOP, not a gentle note");
    ok(
      (neg?.authorityIds ?? []).includes("REG_1_471_2_D_VERIFY_BY_COUNT"),
      "the finding cites the count-and-adjust regulation",
    );
    // NEGATIVE CONTROL: a positive inventory balance must produce nothing.
    const clean = foldBalanceForward(
      [line({ journal_date: "2026-02-01", journal_no: 5, account_code: "20100", account_name: "Inventory — Flower", debit_cents: 50_000 })],
      "2026-01-01",
    );
    eq(
      scanLedger(clean, [{ code: "20100", name: "Inventory — Flower", accountType: "asset", normalBalance: "debit" }])
        .filter((f) => f.code === "NEGATIVE_INVENTORY").length,
      0,
      "a healthy inventory balance produces no negative-inventory finding",
    );
  }

  // ── THE OWNER'S CORPUS: negative ATM cash ────────────────────────────────
  {
    const rows: LedgerLineLike[] = [
      line({ journal_date: "2026-02-01", journal_no: 7, account_code: "10300", account_name: "Bank — ATM Vault", credit_cents: 25_000 }),
    ];
    const findings = scanLedger(foldBalanceForward(rows, "2026-01-01"), [
      { code: "10300", name: "Bank — ATM Vault", accountType: "asset", normalBalance: "debit" },
    ]);
    const cash = findings.find((f) => f.code === "NEGATIVE_CASH");
    ok(cash !== undefined, "negative cash is caught");
    eq(cash?.severity, "stop", "negative cash is a STOP");
    ok(
      (cash?.authorityIds ?? []).includes("AS_1105_11_COMPLETENESS"),
      "the finding points at completeness, because the usual cause is a missing deposit",
    );
    // The specific finding must WIN over the generic one.
    eq(
      findings.filter((f) => f.code === "WRONG_SIDE_CLOSING").length,
      0,
      "the generic wrong-side finding is suppressed when the specific one fires",
    );
  }

  // ── THE OWNER'S CORPUS: the $4,624,697.31 lazy plug ─────────────────────
  {
    // The real one was not round, so the round-plug screen alone would miss it.
    // The thin-description screen must catch it anyway. Both are asserted.
    const lazy = line({
      journal_date: "2026-06-30",
      journal_no: 99,
      account_code: "20100",
      account_name: "Inventory — Flower",
      debit_cents: 462_469_731,
      description: "adjust",
      source_kind: "manual",
    });
    const findings = scanLedger(foldBalanceForward([lazy], "2026-01-01"), [
      { code: "20100", name: "Inventory — Flower", accountType: "asset", normalBalance: "debit" },
    ]);
    ok(
      findings.some((f) => f.code === "THIN_DESCRIPTION_LARGE_AMOUNT" || f.code === "UNEXPLAINED_ROUND_PLUG"),
      "the real $4.62M lazy entry is flagged by its thin description",
    );

    // And a round one is caught as a plug specifically.
    const round = line({
      journal_date: "2026-06-30",
      journal_no: 100,
      account_code: "70100",
      account_name: "Repairs",
      debit_cents: 500_000,
      description: "adj",
      source_kind: "manual",
    });
    const rf = scanLedger(foldBalanceForward([round], "2026-01-01"), [
      { code: "70100", name: "Repairs", accountType: "expense", normalBalance: "debit" },
    ]);
    ok(rf.some((f) => f.code === "UNEXPLAINED_ROUND_PLUG"), "a large round unexplained manual entry is flagged as a plug");

    // NEGATIVE CONTROL: the same amount WITH a real explanation is not flagged.
    const explained = line({
      journal_date: "2026-06-30",
      journal_no: 101,
      account_code: "70100",
      account_name: "Repairs",
      debit_cents: 500_000,
      description: "HVAC compressor replacement, invoice 88121 from Kitsap Mechanical",
      source_kind: "manual",
    });
    const ef = scanLedger(foldBalanceForward([explained], "2026-01-01"), [
      { code: "70100", name: "Repairs", accountType: "expense", normalBalance: "debit" },
    ]);
    eq(
      ef.filter((f) => f.code === "UNEXPLAINED_ROUND_PLUG").length,
      0,
      "a documented entry of the same size is NOT flagged (the screen reads the memo, not the amount alone)",
    );
    // ...and a SMALL round entry is not flagged either, or the report would cry wolf.
    const small = line({
      journal_date: "2026-06-30",
      journal_no: 102,
      account_code: "70100",
      account_name: "Repairs",
      debit_cents: 10_000,
      description: "adj",
      source_kind: "manual",
    });
    eq(
      scanLedger(foldBalanceForward([small], "2026-01-01"), [
        { code: "70100", name: "Repairs", accountType: "expense", normalBalance: "debit" },
      ]).filter((f) => f.code === "UNEXPLAINED_ROUND_PLUG").length,
      0,
      "a small round entry is not treated as a plug",
    );
  }

  // ── THE SUBTLE ONE: a dip that recovers ─────────────────────────────────
  {
    const rows: LedgerLineLike[] = [
      line({ journal_date: "2026-03-01", journal_no: 1, credit_cents: 90_000 }),
      line({ journal_date: "2026-03-05", journal_no: 2, debit_cents: 150_000 }),
    ];
    const findings = scanLedger(foldBalanceForward(rows, "2026-01-01"), [
      { code: "10100", name: "Cash", accountType: "asset", normalBalance: "debit" },
    ]);
    const dip = findings.find((f) => f.code === "WRONG_SIDE_INTRAPERIOD");
    ok(dip !== undefined, "an account that dips wrong-side and recovers is still reported");
    eq(dip?.journalNo, 1, "the finding names the line that caused the dip");
    eq(dip?.severity, "look", "a recovered dip is a 'look', not a 'stop'");
    // NEGATIVE CONTROL: same two lines in the sensible order produce no dip.
    const fine: LedgerLineLike[] = [
      line({ journal_date: "2026-03-01", journal_no: 1, debit_cents: 150_000 }),
      line({ journal_date: "2026-03-05", journal_no: 2, credit_cents: 90_000 }),
    ];
    eq(
      scanLedger(foldBalanceForward(fine, "2026-01-01"), [
        { code: "10100", name: "Cash", accountType: "asset", normalBalance: "debit" },
      ]).filter((f) => f.code === "WRONG_SIDE_INTRAPERIOD").length,
      0,
      "deposit-then-payment produces no dip finding",
    );
  }

  // ── THE WHOLE POINT OF BALANCE FORWARD, AS A SCAN ───────────────────────
  {
    // With the fold, correct books produce ZERO findings. Without it, they
    // produce a false NEGATIVE_CASH. This is the assertion that proves the fix
    // and the guidance are the same subject.
    const rows: LedgerLineLike[] = [
      line({ journal_date: "2025-12-31", journal_no: 1, debit_cents: 400_000, source_kind: "opening_balance" }),
      line({ journal_date: "2026-03-15", journal_no: 2, credit_cents: 300_000 }),
    ];
    const facts: AccountFacts[] = [{ code: "10100", name: "Cash", accountType: "asset", normalBalance: "debit" }];

    const withFold = scanLedger(foldBalanceForward(rows, "2026-01-01"), facts);
    eq(withFold.length, 0, "correct books with balance forward produce no findings at all");

    const withoutFold = scanLedger(
      foldBalanceForward(rows.filter((r) => r.journal_date >= "2026-01-01"), "2026-01-01"),
      facts,
    );
    ok(
      withoutFold.some((f) => f.code === "NEGATIVE_CASH"),
      "without the fold the SAME correct books raise a false negative-cash alarm",
    );
  }

  // ── SORTING AND SUMMARY ─────────────────────────────────────────────────
  {
    const rows: LedgerLineLike[] = [
      line({ journal_date: "2026-02-01", journal_no: 5, account_code: "20100", account_name: "Inventory", credit_cents: 50_000 }),
    ];
    const findings = scanLedger(foldBalanceForward(rows, "2026-01-01"), [
      { code: "20100", name: "Inventory", accountType: "asset", normalBalance: "debit" },
    ]);

    // THE SORT MUST BE TESTED WITH ALL THREE SEVERITIES PRESENT, AND DELIBERATELY
    // HANDED OVER IN THE WRONG ORDER. An earlier version of this test sorted a
    // single finding and asserted it came first — which is true of EVERY possible
    // ordering, so the assertion could not fail. The mutation suite caught it by
    // reversing SEVERITY_RANK and staying green. That is standing rule 15b in
    // action: if nothing in the domain fails, it is a tautology, not a test.
    const mixed: LedgerFinding[] = [
      { ...findings[0], code: "THIN_DESCRIPTION_LARGE_AMOUNT", severity: "look", accountCode: "70100", journalNo: 3 },
      { ...findings[0], code: "WRONG_SIDE_CLOSING", severity: "check", accountCode: "30100", journalNo: 2 },
      { ...findings[0], code: "NEGATIVE_INVENTORY", severity: "stop", accountCode: "20100", journalNo: 1 },
    ];
    const order = sortFindings(mixed).map((f) => f.severity).join(",");
    eq(order, "stop,check,look", "findings sort most-serious first, from a deliberately reversed input");

    // Ties break by account code, then journal number, so the list never
    // reshuffles between two renders of the same data.
    const ties: LedgerFinding[] = [
      { ...findings[0], severity: "check", accountCode: "70100", journalNo: 9 },
      { ...findings[0], severity: "check", accountCode: "10100", journalNo: 4 },
      { ...findings[0], severity: "check", accountCode: "10100", journalNo: 2 },
    ];
    eq(
      sortFindings(ties).map((f) => `${f.accountCode}:${f.journalNo}`).join("|"),
      "10100:2|10100:4|70100:9",
      "equal severities break ties by account then journal number (a stable, repeatable order)",
    );

    const sorted = sortFindings(findings);
    eq(sorted[0].severity, "stop", "the most serious finding sorts first");

    eq(summariseFindings([]).tone, "clean", "an empty scan is clean");
    ok(
      summariseFindings([]).headline.includes("cannot see a transaction that was never entered"),
      "even the clean message states what the check cannot prove (D8 discipline)",
    );
    eq(summariseFindings(findings).tone, "warning", "a stop-level finding makes the summary a warning");
    // Prove the summary is not stuck on one answer.
    const tones = new Set([summariseFindings([]).tone, summariseFindings(findings).tone]);
    ok(tones.size === 2, "summariseFindings really does vary with its input");
  }

  // ── ACCOUNTS WITH NO FACTS ARE SKIPPED, NEVER GUESSED ───────────────────
  {
    const rows = [line({ journal_date: "2026-02-01", journal_no: 1, account_code: "99999", credit_cents: 10_000 })];
    eq(
      scanLedger(foldBalanceForward(rows, "2026-01-01"), []).length,
      0,
      "an account whose normal balance is unknown is skipped rather than assumed",
    );
  }

  // ── THE TEACHING CONTENT ────────────────────────────────────────────────
  {
    LEDGER_READING_STEPS.forEach((s, i) => {
      eq(s.step, i + 1, `reading step ${i + 1} is numbered in order`);
      ok(s.action.trim().length > 20, `step ${s.step} has an instruction`);
      ok(s.why.trim().length > 40, `step ${s.step} explains why it sits here`);
      ok(s.ifSkipped.trim().length > 40, `step ${s.step} says what goes wrong when skipped`);
      for (const id of s.authorityIds) {
        ok(
          findGuidanceAuthority(id) !== undefined || LEDGER_AUTHORITIES_NEW.some((a) => a.id === id),
          `step ${s.step} cites a resolvable authority (${id})`,
        );
      }
    });

    for (const c of ACCOUNT_CHOICE_CONSEQUENCES) {
      ok(c.decides.trim().length > 40, `${c.family} says what the choice decides`);
      ok(c.commonMistake.trim().length > 40, `${c.family} names the real mistake`);
      ok(c.tellTale.trim().length > 30, `${c.family} gives a way to tell`);
      ok(c.block >= 1 && c.block <= 9, `${c.family} names a real block`);
      for (const id of c.authorityIds) {
        ok(
          findGuidanceAuthority(id) !== undefined || LEDGER_AUTHORITIES_NEW.some((a) => a.id === id),
          `${c.family} cites a resolvable authority (${id})`,
        );
      }
    }

    // Block notes must cover every block in the real chart, with the real names.
    eq(COA_BLOCK_NOTES.length, 9, "every block of the chart is described");
    for (const n of COA_BLOCK_NOTES) {
      eq(
        n.name,
        COA_BLOCKS[n.block as keyof typeof COA_BLOCKS].name,
        `block ${n.block} uses the chart's own name (so a rename cannot drift)`,
      );
      ok(n.plainEnglish.trim().length > 15, `block ${n.block} is explained in plain English`);
    }
  }

  // ── THE SCANNER AGREES WITH THE CHART ────────────────────────────────────
  {
    // isWrongSide must agree with coa-core's expectedNormalBalance for every
    // account type, or the ledger and the chart would disagree about what
    // "abnormal" means. Swept across all types rather than sampled (rule 15b).
    const types: AccountType[] = [
      "asset", "liability", "equity", "income", "cogs", "expense", "other_income", "other_expense",
    ];
    for (const t of types) {
      const nb = expectedNormalBalance(t, false);
      eq(isWrongSide(nb === "debit" ? -100 : 100, nb), true, `${t}: a balance opposite its normal side is flagged`);
      eq(isWrongSide(nb === "debit" ? 100 : -100, nb), false, `${t}: a balance on its normal side is not flagged`);
    }
    // Contra accounts flip, and the scanner must follow the flip.
    eq(expectedNormalBalance("asset", true), "credit", "a contra asset is credit-normal");
    eq(isWrongSide(100, expectedNormalBalance("asset", true)), true, "a debit balance in a contra asset is flagged");
  }

  // ── BOUNDARIES AND HOSTILE INPUT (rule 13f) ─────────────────────────────
  {
    eq(foldBalanceForward([], "2026-01-01").length, 0, "no rows produces no sections");
    eq(scanLedger([], []).length, 0, "no sections produces no findings");

    eq(isRoundHundred(0), false, "zero is not a round plug");
    eq(isRoundHundred(10_000), true, "$100.00 is round");
    eq(isRoundHundred(10_001), false, "$100.01 is not round");
    eq(isRoundHundred(-10_000), true, "roundness is about magnitude, not direction");

    // Very large magnitudes must stay exact — no float creep in a money path.
    const huge = foldBalanceForward(
      [
        line({ journal_date: "2025-01-01", journal_no: 1, debit_cents: 900_719_925_474 }),
        line({ journal_date: "2026-06-01", journal_no: 2, credit_cents: 900_719_925_473 }),
      ],
      "2026-01-01",
    )[0];
    eq(huge.closingBalanceCents, 1, "a one-cent residue survives nine-hundred-billion-cent inputs exactly");
    ok(Number.isSafeInteger(huge.closingBalanceCents), "the balance is a safe integer, not a float");

    // Same date, different journal numbers: order must still be deterministic.
    const sameDay = foldBalanceForward(
      [
        line({ journal_date: "2026-04-01", journal_no: 9, debit_cents: 100 }),
        line({ journal_date: "2026-04-01", journal_no: 3, credit_cents: 40 }),
      ],
      "2026-01-01",
    )[0];
    eq(sameDay.rows[0].journal_no, 3, "same-date rows order by journal number");
    eq(sameDay.closingBalanceCents, 60, "and still total correctly");

    // The line in the sand itself is INSIDE the window, not before it.
    const onTheLine = foldBalanceForward(
      [line({ journal_date: "2026-01-01", journal_no: 1, debit_cents: 500 })],
      "2026-01-01",
    )[0];
    eq(onTheLine.foldedLineCount, 0, "a row dated exactly on the window start is not folded away");
    eq(onTheLine.rows.length, 1, "it is shown in the window");

    // Multiple accounts stay separate — a fold must never bleed across accounts.
    const multi = foldBalanceForward(
      [
        line({ journal_date: "2025-12-31", journal_no: 1, account_code: "10100", debit_cents: 100 }),
        line({ journal_date: "2025-12-31", journal_no: 1, account_code: "30100", credit_cents: 100 }),
        line({ journal_date: "2026-05-01", journal_no: 2, account_code: "10100", credit_cents: 30 }),
      ],
      "2026-01-01",
    );
    eq(multi.length, 2, "two accounts produce two sections");
    eq(multi[0].accountCode, "10100", "sections are sorted by account code");
    eq(multi[0].closingBalanceCents, 70, "account 10100 keeps its own balance");
    eq(multi[1].closingBalanceCents, -100, "account 30100 keeps its own balance");
  }

  // ── PERMANENT vs TEMPORARY ────────────────────────────────────────────
  {
    // natureOf must be TOTAL over the account types — sweep them all, never a
    // sample. A type added later with no nature would otherwise default to
    // whatever the ?? on the map happened to say.
    const allTypes: readonly AccountType[] = [
      "asset", "liability", "equity", "income",
      "cogs", "expense", "other_income", "other_expense",
    ];
    const permanent = allTypes.filter((t) => natureOf(t) === "permanent");
    const temporary = allTypes.filter((t) => natureOf(t) === "temporary");
    eq(permanent.length, 3, "exactly three account types are permanent");
    eq(temporary.length, 5, "exactly five account types are temporary");
    for (const t of ["asset", "liability", "equity"] as const) {
      eq(natureOf(t), "permanent", `${t} is a balance-sheet (permanent) account`);
    }
    for (const t of ["income", "cogs", "expense", "other_income", "other_expense"] as const) {
      eq(natureOf(t), "temporary", `${t} is an income-statement (temporary) account`);
    }

    eq(fiscalYearStartOf("2027-06-30"), "2027-01-01", "fiscal year starts in January");
    eq(fiscalYearStartOf("2026-01-01"), "2026-01-01", "a January date is its own year start");
    eq(foldStartFor("2027-06-01", "permanent"), null, "permanent accounts fold to inception");
    eq(foldStartFor("2027-06-01", "temporary"), "2027-01-01", "temporary accounts fold to this year only");

    // THE FY2027 LANDMINE, REPLAYED.
    //
    // One cash account and one revenue account, each with a 2026 line and a 2027
    // line, viewed through a 2027 window. Cash must carry BOTH years. Revenue
    // must carry only 2027 — otherwise the 2027 income statement reports two
    // years of sales, and the error is invisible in 2026 because 2026 has no
    // prior year to double-count.
    const natures = natureMapFrom([
      { code: "10100", name: "Cash", accountType: "asset", normalBalance: "debit" },
      { code: "50100", name: "Sales", accountType: "income", normalBalance: "credit" },
    ]);
    const rows = [
      line({ journal_date: "2026-03-01", journal_no: 1, account_code: "10100", debit_cents: 500_00 }),
      line({ journal_date: "2026-03-01", journal_no: 1, account_code: "50100", account_name: "Sales", credit_cents: 500_00 }),
      line({ journal_date: "2027-02-01", journal_no: 2, account_code: "10100", debit_cents: 300_00 }),
      line({ journal_date: "2027-02-01", journal_no: 2, account_code: "50100", account_name: "Sales", credit_cents: 300_00 }),
    ];
    const y2027 = foldBalanceForward(rows, "2027-06-01", natures);
    const cash = y2027.find((x) => x.accountCode === "10100")!;
    const sales = y2027.find((x) => x.accountCode === "50100")!;

    eq(cash.closingBalanceCents, 800_00, "cash carries every year since inception");
    eq(cash.foldStartDate, null, "cash folds from inception, so it has no fold floor");
    eq(sales.closingBalanceCents, -300_00, "revenue carries ONLY the current fiscal year");
    eq(sales.foldStartDate, "2027-01-01", "revenue folds from the start of its fiscal year");
    eq(sales.droppedPriorYearLineCount, 1, "the 2026 revenue line is excluded, and counted");
    eq(cash.droppedPriorYearLineCount, 0, "nothing is ever dropped from a permanent account");

    // NEGATIVE CONTROL: without the nature map, the old behaviour returns — which
    // proves this test would fail if the nature logic were removed.
    const naive = foldBalanceForward(rows, "2027-06-01");
    eq(
      naive.find((x) => x.accountCode === "50100")!.closingBalanceCents,
      -800_00,
      "without natures, revenue double-counts the prior year (the defect this prevents)",
    );

    // An unknown account is treated as PERMANENT — the direction that can only
    // over-report history, never silently drop an opening balance.
    const unknown = foldBalanceForward(
      [line({ journal_date: "2026-01-05", journal_no: 1, account_code: "99999", debit_cents: 1 })],
      "2027-01-01",
      natures,
    )[0];
    eq(unknown.nature, "permanent", "an account missing from the chart folds from inception");
    eq(unknown.balanceForwardCents, 1, "so its history is carried, not discarded");
  }

  // ── YEAR-END CLOSE DETECTION ───────────────────────────────────────
  {
    const natures = natureMapFrom([
      { code: "50100", name: "Sales", accountType: "income", normalBalance: "credit" },
    ]);
    const withPriorYear = foldBalanceForward(
      [
        line({ journal_date: "2026-03-01", journal_no: 1, account_code: "50100", account_name: "Sales", credit_cents: 100 }),
        line({ journal_date: "2027-03-01", journal_no: 2, account_code: "50100", account_name: "Sales", credit_cents: 50 }),
      ],
      "2027-06-01",
      natures,
    );
    const raised = detectUnclosedPriorYear(withPriorYear);
    eq(raised.length, 1, "prior-year income lines raise exactly one finding for the whole ledger");
    eq(raised[0].code, "PRIOR_YEAR_NEVER_CLOSED", "with the right code");
    eq(raised[0].severity, "check", "and a severity of check, because an early-year close may simply not be due yet");
    ok(raised[0].whatToDo.length > 40, "and it says what to actually do");

    // NEGATIVE CONTROL — no prior year, no finding. Without this the detector
    // could return a finding unconditionally and still pass the test above.
    const noPriorYear = foldBalanceForward(
      [line({ journal_date: "2027-03-01", journal_no: 1, account_code: "50100", account_name: "Sales", credit_cents: 50 })],
      "2027-06-01",
      natures,
    );
    eq(detectUnclosedPriorYear(noPriorYear).length, 0, "a first year raises no close finding");

    // A permanent account with years of history must NEVER raise it.
    const permOnly = foldBalanceForward(
      [line({ journal_date: "2026-03-01", journal_no: 1, account_code: "10100", debit_cents: 100 })],
      "2027-06-01",
      natureMapFrom([{ code: "10100", name: "Cash", accountType: "asset", normalBalance: "debit" }]),
    );
    eq(detectUnclosedPriorYear(permOnly).length, 0, "carrying cash forward is not a missing close");
  }

  // ── THE TRIAL BALANCE, BUILT FROM THE SAME FOLD ─────────────────────────
  {
    const facts: AccountFacts[] = [
      { code: "10100", name: "Cash", accountType: "asset", normalBalance: "debit" },
      { code: "30100", name: "Accounts payable", accountType: "liability", normalBalance: "credit" },
    ];
    // Opening 2025-12-31: cash 4000 debit / AP 4000 credit. Then a 3000 payment.
    const rows = [
      line({ journal_date: "2025-12-31", journal_no: 1, account_code: "10100", debit_cents: 400_000 }),
      line({ journal_date: "2025-12-31", journal_no: 1, account_code: "30100", account_name: "Accounts payable", credit_cents: 400_000 }),
      line({ journal_date: "2026-03-15", journal_no: 2, account_code: "10100", credit_cents: 300_000 }),
      line({ journal_date: "2026-03-15", journal_no: 2, account_code: "30100", account_name: "Accounts payable", debit_cents: 300_000 }),
    ];

    // THE REAL DEFECT, REPLAYED: the window that the page used to use.
    const tb = buildTrialBalance(
      foldBalanceForward(rows, "2026-01-01", natureMapFrom(facts)),
      facts,
    );
    eq(tb.lines.length, 2, "both accounts appear");
    eq(tb.lines[0].balanceCents, 100_000, "cash is 4000 opening less 3000 paid = 1000");
    ok(tb.foots, "the trial balance foots");
    eq(tb.differenceCents, 0, "debits equal credits");
    eq(
      tb.abnormalCount,
      0,
      "and NOTHING is abnormal — the false alarm this slice removed",
    );

    // PROOF THE ABNORMAL CHECK IS NOT SIMPLY ALWAYS ZERO. Cash with a credit
    // balance is genuinely abnormal and must still be caught.
    const bad = buildTrialBalance(
      foldBalanceForward(
        [line({ journal_date: "2026-03-15", journal_no: 2, account_code: "10100", credit_cents: 300_000 })],
        "2026-01-01",
        natureMapFrom(facts),
      ),
      facts,
    );
    eq(bad.abnormalCount, 1, "a genuinely negative cash balance is still reported as abnormal");
    ok(bad.lines[0].isAbnormal, "and the offending line is the one flagged");

    // THE FALSE-CERTIFICATION TEST.
    //
    // Every fixture above is balanced, so `foots` is true in all of them — which
    // means none of them can tell the difference between a trial balance that
    // genuinely foots and one that merely CLAIMS to. This slice exists because a
    // report that certifies itself is more dangerous than one that is plainly
    // wrong, so the suite has to contain a set of books that does NOT foot and
    // has to insist the report says so.
    //
    // `bad` above is a single one-sided line: 3000 credit and nothing on the
    // other side. Real books can never look like this, which is the point.
    ok(!bad.foots, "a one-sided set of books does NOT foot");
    eq(bad.differenceCents, -300_000, "and the difference is reported exactly, not rounded to zero");
    eq(bad.totalDebitCents, 0, "with no debits");
    eq(bad.totalCreditCents, 300_000, "and the full amount in credits");

    // An account that nets to zero is dropped, matching the trial balance SQL's
    // `having sum(...) <> 0`. Two screens disagreeing here would be its own bug.
    const zeroed = buildTrialBalance(
      foldBalanceForward(
        [
          line({ journal_date: "2026-01-05", journal_no: 1, account_code: "10100", debit_cents: 500 }),
          line({ journal_date: "2026-01-06", journal_no: 2, account_code: "10100", credit_cents: 500 }),
        ],
        "2026-01-01",
        natureMapFrom(facts),
      ),
      facts,
    );
    eq(zeroed.lines.length, 0, "an account that nets to zero is not listed");
    ok(zeroed.foots, "and an empty trial balance still foots");

    // THE GRWNY/GRNWY FINGERPRINT: an account the chart cannot explain is named,
    // never silently treated as normal.
    const unmapped = buildTrialBalance(
      foldBalanceForward(
        [line({ journal_date: "2026-02-01", journal_no: 1, account_code: "61000", account_name: "Wages", debit_cents: 900 })],
        "2026-01-01",
      ),
      facts,
    );
    eq(unmapped.unmappedAccountCodes.length, 1, "an account missing from the chart is reported");
    eq(unmapped.unmappedAccountCodes[0], "61000", "by code, so it can be found");
    eq(unmapped.abnormalCount, 0, "and is never CLAIMED to be normal or abnormal");
    eq(unmapped.totalDebitCents, 900, "its money still counts toward the totals");

    // Sign convention, stated as an assertion so it cannot quietly invert.
    eq(tb.lines[0].debitCents, 100_000, "a positive balance renders in the DEBIT column");
    eq(tb.lines[0].creditCents, 0, "and not in the credit column");
    eq(tb.lines[1].creditCents, 100_000, "a negative balance renders in the CREDIT column");
    eq(tb.lines[1].debitCents, 0, "and not in the debit column");
  }
}
