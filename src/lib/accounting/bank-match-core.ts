/**
 * src/lib/accounting/bank-match-core.ts   (slice books-05)
 *
 * BANK MATCHING AND RECONCILIATION — the PURE core.
 *
 * No I/O, no network, no `server-only`, no Supabase. Every function here is a
 * decision or an arithmetic transformation, so all of it is testable without a
 * database and all of it is mirrored in vitest.
 *
 * ---------------------------------------------------------------------------
 * OWNER CONTEXT, recorded verbatim (standing rule 1)
 * ---------------------------------------------------------------------------
 *   "Slice 5 — bank matching. Every draft entry matched against what actually
 *    hit the bank, so nothing is invented and nothing is missed."
 *
 *   "I want push back... like if I loan my employees some money... I want to be
 *    able to make entries manually, but the system pushes back and try's to help
 *    me enter it correctly rather than rejecting it out right."
 *
 *   "I really think it's smart to not just block, but explain why, and even
 *    better, show me a way to do it properly. I learn best visually."
 *
 *   "I would like all the help I can get and for it to be accurate and precise
 *    stated from actual verbatim text from authoritative sources."
 *
 *   "gate everything, lock everything, block everything... no asking, hard no!"
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS THE MOST DANGEROUS ONE IN THE PROJECT SO FAR
 * ---------------------------------------------------------------------------
 * Every other slice fails LOUDLY. A payroll entry that is out of balance will
 * not post. A bill with no vendor will not post. Bank matching is different,
 * and the difference is the whole reason this file is written the way it is:
 *
 *   A WRONGLY MATCHED BANK TRANSACTION STILL BALANCES.
 *
 * If the sign is flipped, both lines flip together and the journal still sums
 * to zero. If a transfer between Michael's own accounts is coded as revenue, the
 * entry balances. If a deposit is matched to the wrong day's sales, the entry
 * balances. If a bank row is posted twice, both entries balance. There is no
 * imbalance, no error, no red text. The only symptom is a wrong tax return,
 * discovered — if ever — by an examiner rather than by the owner.
 *
 * So this file's job is not to make matching easy. It is to make the SILENT
 * failures noisy, and to refuse the ones that cannot be made safe.
 *
 * ---------------------------------------------------------------------------
 * §1  THE AUTHORITIES, VERBATIM
 * ---------------------------------------------------------------------------
 * These are quoted exactly, from primary sources, verified 2026-08-17. They are
 * not decoration: several tests in this file assert that this text has not
 * drifted, because a paraphrased regulation is a regulation you cannot rely on
 * in a dispute.
 *
 * ---------------------------------------------------------------------------
 * A1. IRM 4.10.4, Examination of Income (revised 08-29-2025)
 *     https://www.irs.gov/irm/part4/irm_04-010-004
 *     Note: §4.10.4.1.8 "Related Resources" expressly lists "Marijuana Cases".
 * ---------------------------------------------------------------------------
 *
 * A1a — IRM 4.10.4.2.3.7(2), what a bank analysis is FOR:
 *
 *   "This analysis is used to:
 *      a. Identify deposits which may be taxable income,
 *      b. Determine whether business expenses may have been paid from other
 *         sources (such as cash-on-hand or accumulated funds) or are overstated,
 *      c. Estimate the risk of commingled personal and business bank/financial
 *         accounts, and
 *      d. Determine whether cash is deposited."
 *
 * A1b — IRM 4.10.4.2.3.7(3)(a), the deposit-level tests an examiner runs:
 *
 *   "Analyze the deposits. Look for unusual deposits (size or source),
 *    frequency of deposits. Also check for deposits of cash, specific deposits
 *    that do not follow the taxpayer's normal routine or pattern, nontaxable
 *    deposits such as loans and transfers, commingling of personal and business
 *    activities, and cash-back when a deposit is made."
 *
 * A1c — IRM 4.10.4.2.3.7(3)(b) Reminder, the transfer trap:
 *
 *   "Nontaxable funds, transfers-in, and returned deposits need to be
 *    subtracted from total deposits to get 'Taxable Deposits.'"
 *
 * A1d — IRM 4.10.4.2.3.4(4), weak internal controls. This list is, read
 * honestly, a catalogue of every way an unreviewed bank matcher can hurt you:
 *
 *   "a. Books and records that cannot be reconciled to the tax return
 *    b. Transactions that are not properly authorized
 *    c. Recorded transactions are not valid
 *    d. Existing transactions are not recorded
 *    e. Transactions are improperly valued
 *    f. Transactions are improperly classified
 *    g. Transaction are recorded at the improper time
 *    h. Transactions are incorrectly summarized
 *    i. Transactions all made by the same person or related parties
 *    j. Significant commingling of business and personal funds"
 *
 * A1e — IRM 4.10.4.2.3.7(8), the stakes:
 *
 *   "A potentially material misstatement of taxable income identified through a
 *    bank/financial account analysis establishes a reasonable likelihood of
 *    additional unreported taxable income justifying the use of a formal
 *    indirect method to make the actual determination of tax liability."
 *
 *   PLAIN ENGLISH: if your bank does not tie to your books, the examiner is
 *   permitted to stop believing your books and reconstruct your income himself.
 *
 * A1f — IRM 4.10.4.1.6.5, cash-on-hand defined. Greenway is cash-only, so this
 * is the sentence that governs the gap between the register and the deposit:
 *
 *   "Generally, cash-on-hand is currency (not balances in bank/financial
 *    accounts) associated with routine business practices and/or the need to
 *    complete cash transactions with customers."
 *
 * ---------------------------------------------------------------------------
 * A2. Reg. §1.6001-1, Records
 *     https://www.law.cornell.edu/cfr/text/26/1.6001-1
 * ---------------------------------------------------------------------------
 *   (a) "...shall keep such permanent books of account or records, including
 *        inventories, as are sufficient to establish the amount of gross
 *        income, deductions, credits, or other matters required to be shown by
 *        such person in any return of such tax or information."
 *
 *   (e) "The books or records required by this section shall be kept at all
 *        times available for inspection by authorized internal revenue officers
 *        or employees, and shall be retained so long as the contents thereof
 *        may become material in the administration of any internal revenue law."
 *
 * ---------------------------------------------------------------------------
 * A3. WAC 314-55-087, Recordkeeping requirements for cannabis licensees
 *     (current text: WSR 24-19-040, filed 9/11/24, effective 10/12/24)
 *     https://app.leg.wa.gov/wac/default.aspx?cite=314-55-087
 * ---------------------------------------------------------------------------
 *   (1) "Cannabis licensees are responsible to keep records that clearly
 *        reflect all financial transactions and the financial condition of the
 *        business. The following records must be kept and maintained on the
 *        licensed premises for a five-year period and must be made available
 *        for inspection if requested by an employee of the LCB:"
 *
 *   (1)(b) "Bank statements and canceled checks for any accounts relating to
 *           the licensed business;"
 *
 *   (2)(a) "Provides an audit trail so that details (invoices and vouchers)
 *           underlying the summary accounting data may be identified and made
 *           available upon request."
 *
 *   (2)(b) "Provides the opportunity to trace any transaction back to the
 *           original source or forward to a final total. If printouts of
 *           transactions are not made when they are processed, the system must
 *           have the ability to reconstruct these transactions."
 *
 *   THIS IS A STATE-LAW MANDATE FOR EXACTLY WHAT THIS FILE BUILDS. A match must
 *   carry its evidence in BOTH directions — bank row to journal, journal back to
 *   bank row — and because the retention period is five years, a match is never
 *   destroyed. It is superseded, and the supersession is itself a record.
 *
 * ---------------------------------------------------------------------------
 * A4. IRC §163(a), Interest
 *     https://www.law.cornell.edu/uscode/text/26/163
 * ---------------------------------------------------------------------------
 *   "(a) General rule. There shall be allowed as a deduction all interest paid
 *    or accrued within the taxable year on indebtedness."
 *
 *   The word doing the work is "interest". A mortgage payment is not an
 *   expense; it is three different things wearing one number — deductible
 *   interest, a non-deductible reduction of the liability, and escrow, which is
 *   still Michael's money sitting in someone else's hands. Coding the whole
 *   payment to an expense account overstates deductions and understates both
 *   assets and equity, every single month.
 *
 * ---------------------------------------------------------------------------
 * §2  THE SIGN WALL — read this before changing anything below
 * ---------------------------------------------------------------------------
 * There are two sign conventions in this repository and THEY ARE OPPOSITE.
 *
 *   PLAID  (src/lib/plaid/plaid-money-core.ts, migration 0157 line 96):
 *     POSITIVE amount_cents = money LEFT the account  (an outflow)
 *     NEGATIVE amount_cents = money CAME IN           (an inflow)
 *
 *   GENERAL LEDGER (migration 0172, gl_journal_lines table comment):
 *     POSITIVE amount_cents = DEBIT
 *     NEGATIVE amount_cents = CREDIT
 *
 * Now put them together. Money leaving the bank must CREDIT the bank asset —
 * that is a NEGATIVE ledger amount — but the very same event is a POSITIVE
 * Plaid amount. The conventions are exactly inverted for the cash line.
 *
 * This is not a hypothetical. Standing rule 19 makes the owner's real history
 * the permanent test corpus, and one of those failures is BACKWARDS CARD SIGNS.
 * The same mistake is sitting here waiting to be made a second time, in a new
 * place, silently — because as established above, a sign-flipped match still
 * balances perfectly.
 *
 * The defence is that exactly ONE function in this codebase is allowed to cross
 * between the two worlds: `plaidToLedgerCashCents()`. It is four lines long, it
 * is tested against every boundary value, and the database refuses any bank
 * journal whose cash line disagrees with it. Nothing else may negate a bank
 * amount. If you find yourself writing a minus sign in front of a Plaid amount
 * anywhere else in this repository, you have found a bug.
 *
 * MONEY RULE (standing): integer CENTS, never a float.
 * TIME RULE  (standing): Pacific (America/Los_Angeles) is the business clock.
 */

import type { CostClass, EntityCode } from "./ledger-core";

// ===========================================================================
// §3  THE SIGN BRIDGE — the only sanctioned crossing between the two worlds
// ===========================================================================

/**
 * Which way did the money move, described in the way a human thinks about it
 * rather than the way either system stores it.
 */
export type BankDirection = "money_in" | "money_out";

/**
 * THE ONE FUNCTION ALLOWED TO CONVERT A PLAID AMOUNT INTO A LEDGER AMOUNT.
 *
 * Plaid: positive = money out.  Ledger: positive = debit.
 * Money out must credit cash (negative). Money in must debit cash (positive).
 * So the conversion is a negation — and that negation lives here, once.
 *
 * Zero is preserved as zero rather than becoming `-0`, which is a real hazard:
 * `Object.is(-0, 0)` is false, and `-0` serialises to `0` in JSON but not in
 * every snapshot comparison. This bit exact behaviour is asserted in the tests.
 */
export function plaidToLedgerCashCents(plaidAmountCents: number): number {
  if (!Number.isInteger(plaidAmountCents)) {
    throw new Error(
      `BANK_NON_INTEGER_CENTS: bank amounts must be whole cents, received ${String(plaidAmountCents)}`,
    );
  }
  if (plaidAmountCents === 0) return 0; // never -0
  return -plaidAmountCents;
}

/** Direction of a raw Plaid amount. Zero-value rows are treated as money_in. */
export function bankDirection(plaidAmountCents: number): BankDirection {
  return plaidAmountCents > 0 ? "money_out" : "money_in";
}

/**
 * Magnitude in positive cents, for display. Never used for posting — posting
 * always goes through `plaidToLedgerCashCents`.
 */
export function bankMagnitudeCents(plaidAmountCents: number): number {
  return Math.abs(plaidAmountCents);
}

// ===========================================================================
// §4  INPUTS — the shapes this core reasons about
// ===========================================================================

/**
 * A bank row as it exists in `plaid_transactions` (migration 0157). Field names
 * mirror the database columns deliberately: a rename in one place should break
 * the build rather than silently read `undefined`.
 */
export type BankRow = {
  /** Plaid `transaction_id`. The idempotency key. */
  transactionId: string;
  /** Plaid `account_id`. */
  accountId: string;
  /** SIGNED, PLAID CONVENTION: positive = money OUT. Integer cents. */
  amountCents: number;
  /** ISO date `YYYY-MM-DD` (the `date` column). */
  date: string;
  /** Plaid `name` (raw descriptor). */
  name: string;
  /** Plaid `merchant_name`, when present. */
  merchantName?: string | null;
  /** True while the transaction is still pending. */
  pending: boolean;
  /** Plaid soft-delete flag. */
  removed: boolean;
  /** Plaid PFC primary category, when present. */
  categoryPrimary?: string | null;
};

/** A ledger journal that is a candidate to be matched to a bank row. */
export type JournalCandidate = {
  journalId: string;
  entityCode: EntityCode;
  /** ISO date `YYYY-MM-DD`. */
  journalDate: string;
  /**
   * The SIGNED LEDGER amount on the CASH line of this journal (positive =
   * debit = money in). Already in ledger convention — this is the number the
   * bank row must agree with after conversion.
   */
  cashLineCents: number;
  /** The cash account this journal touches, e.g. "10200". */
  cashAccountCode: string;
  memo: string;
  sourceKind: string;
  /** True once this journal has been matched to some bank row. */
  alreadyMatched: boolean;
};

/**
 * The kind of real-world event a bank row represents. This is the single most
 * consequential field in the whole slice, because it decides whether a dollar
 * becomes income, an expense, a transfer, or nothing at all.
 */
export type BankEventKind =
  | "deposit_of_sales" // cash/card takings reaching the bank
  | "vendor_payment" // paying a bill that is already on the books
  | "payroll_funding" // net pay / tax ACH leaving for the payroll rails
  | "loan_payment" // mortgage or note payment (interest/principal/escrow)
  | "own_transfer" // between Michael's own accounts — NOT income, NOT expense
  | "owner_draw" // money out to the owner personally
  | "owner_contribution" // money in from the owner personally
  | "bank_fee" // service charges, wire fees, returned-item fees
  | "interest_income" // interest credited by the bank
  | "tax_payment" // excise, sales tax, payroll tax remittance
  | "atm_vault" // ATM vault load / settlement (separate Schedule C)
  | "unknown"; // deliberately not guessed

/** A proposed match awaiting the owner's decision. */
export type MatchProposal = {
  bankRow: BankRow;
  journal: JournalCandidate | null;
  eventKind: BankEventKind;
  /** 0..100000 milli-percent. 100000 = certain. */
  confidenceMilliPct: number;
  /** Why the engine thinks so, in plain English, for the owner to read. */
  reasons: string[];
};

// ===========================================================================
// §5  THE REFUSALS — every way a bank match can be silently wrong
// ===========================================================================

/**
 * Each code is a specific, named failure. The rule (owner directive: "gate
 * everything, lock everything, block everything... no asking, hard no!") is
 * that a `hardBlock` finding is a REFUSAL, not a warning. A warning that can be
 * clicked past is not a control; it is a speed bump with a legal opinion.
 *
 * Every code here must have a plain-English translation in gl-refusal-core.ts.
 * A drift test in the vitest mirror enforces that in both directions: no code
 * without a translation, and no translation for a code that does not exist.
 */
export type BankFindingCode =
  | "BANK_PENDING_ROW"
  | "BANK_REMOVED_ROW"
  | "BANK_SIGN_DISAGREES"
  | "BANK_AMOUNT_MISMATCH"
  | "BANK_ALREADY_MATCHED"
  | "BANK_JOURNAL_ALREADY_MATCHED"
  | "BANK_DATE_TOO_FAR"
  | "BANK_ENTITY_MISMATCH"
  | "BANK_TRANSFER_AS_INCOME"
  | "BANK_DOUBLE_COUNT_RISK"
  | "BANK_LOAN_SINGLE_LINE"
  | "BANK_NO_COST_CLASS"
  | "BANK_UNCLASSIFIED"
  | "BANK_NON_INTEGER_CENTS"
  | "BANK_PRE_CUTOVER"
  | "BANK_INVALID_DATE"
  | "BANK_COMMINGLED";

export type BankFinding = {
  code: BankFindingCode;
  /** True = refuse. False = explain, and let the owner proceed knowingly. */
  hardBlock: boolean;
  /** One sentence, plain English, no jargon, addressed to the owner. */
  message: string;
  /** The authority that makes this a rule rather than an opinion. */
  authority: string;
  /** What to do instead — never a dead end. */
  remedy: string;
};

/**
 * How many days apart a bank row and a journal may be and still be considered
 * the same event. Cash deposits genuinely lag the sale: takings are counted at
 * close, bagged, and carried to the bank the next business day, and a weekend
 * or a bank holiday stretches that further.
 *
 * Five days is chosen so that a Friday sale deposited on the following Wednesday
 * (Fri -> Sat/Sun closed -> Mon holiday -> Tue/Wed) still matches, while a
 * month-apart pairing does not. IRM 4.10.4.2.3.4(4)(g) names "transaction are
 * recorded at the improper time" as a weak-control symptom, so an unlimited
 * window would be building the symptom in on purpose.
 */
export const MATCH_WINDOW_DAYS = 5;

/**
 * Beyond this, the engine will not even propose. It is the difference between
 * "probably the same event" and "two events that happen to share a number".
 */
export const MATCH_WINDOW_HARD_DAYS = 30;

/** The line in the sand (standing rule 10), enforced in the schema too. */
export const LINE_IN_THE_SAND = "2026-01-01";

// ===========================================================================
// §5b  THE AUTHORITIES AS DATA — the same quotations §1 sets out in prose
// ===========================================================================
/**
 * WHY THIS EXISTS WHEN §1 ABOVE ALREADY QUOTES EVERYTHING.
 *
 * §1 is a comment. A comment cannot be rendered on a screen, cannot be
 * asserted against by a test, and cannot be cited by a finding. The owner-only
 * teaching page needs this text in front of Michael, and the ONLY safe way to
 * do that is to read it from here.
 *
 * The unsafe way — the obvious way — is to retype the quotations into the page
 * component. That produces two copies of a federal regulation in one codebase,
 * and the day someone corrects one of them the other becomes a quiet lie with a
 * citation attached. A misquoted authority is worse than no authority: it is
 * something Michael would rely on in a dispute, and it would not hold.
 *
 * So the page renders THIS array, the drift tests assert against THIS array,
 * and there is exactly one place in the repository where each sentence lives.
 *
 * Every `quote` below is transcribed verbatim from the primary source and was
 * verified 2026-08-17. Nothing here is summarised. Where a plain-English
 * reading is useful it goes in `soWhat`, clearly separated, so that our words
 * can never be mistaken for the government's.
 */
export type BankAuthorityKind =
  | "statute"
  | "regulation"
  | "irs_guidance"
  | "state_law"
  | "state_manual";

export type BankAuthority = {
  /** Stable key referenced by findings and by the UI. */
  id: string;
  kind: BankAuthorityKind;
  /** Formal citation as it would appear in a memo. */
  cite: string;
  /** VERBATIM text. Transcribed from the source, never summarised. */
  quote: string;
  /** What it means for Greenway specifically, in plain English. Ours, not theirs. */
  soWhat: string;
  /** Where to read it. */
  source: string;
};

export const BANK_AUTHORITIES: readonly BankAuthority[] = [
  {
    id: "IRM_BANK_ANALYSIS_PURPOSE",
    kind: "irs_guidance",
    cite: "IRM 4.10.4.2.3.7(2)",
    quote:
      "This analysis is used to: a. Identify deposits which may be taxable income, " +
      "b. Determine whether business expenses may have been paid from other sources " +
      "(such as cash-on-hand or accumulated funds) or are overstated, c. Estimate the " +
      "risk of commingled personal and business bank/financial accounts, and " +
      "d. Determine whether cash is deposited.",
    soWhat:
      "This is the examiner's own checklist, and every line of it is aimed at a cash business " +
      "with more than one account. You are a cash business with four sets of books. Reconciling " +
      "every month is not bookkeeping tidiness — it is preparing the exact document an examiner " +
      "would otherwise build about you, without you.",
    source: "IRM Part 4, Chapter 10, Section 4 (revised 08-29-2025). https://www.irs.gov/irm/part4/irm_04-010-004",
  },
  {
    id: "IRM_TRANSFERS_IN",
    kind: "irs_guidance",
    cite: "IRM 4.10.4.2.3.7(3)(b), Reminder",
    quote:
      "Nontaxable funds, transfers-in, and returned deposits need to be subtracted from " +
      "total deposits to get 'Taxable Deposits.'",
    soWhat:
      "This is why moving your own money between your own accounts is the single most dangerous " +
      "ordinary event in the whole system. Total deposits are NOT income. If a transfer between " +
      "your accounts is recorded on only one side, the deposit sits there looking exactly like " +
      "revenue you never earned — and you would pay tax on it.",
    source: "IRM Part 4, Chapter 10, Section 4 (revised 08-29-2025). https://www.irs.gov/irm/part4/irm_04-010-004",
  },
  {
    id: "IRM_WEAK_CONTROLS",
    kind: "irs_guidance",
    cite: "IRM 4.10.4.2.3.4(4)",
    quote:
      "a. Books and records that cannot be reconciled to the tax return " +
      "b. Transactions that are not properly authorized " +
      "c. Recorded transactions are not valid " +
      "d. Existing transactions are not recorded " +
      "e. Transactions are improperly valued " +
      "f. Transactions are improperly classified " +
      "g. Transaction are recorded at the improper time " +
      "h. Transactions are incorrectly summarized " +
      "i. Transactions all made by the same person or related parties " +
      "j. Significant commingling of business and personal funds",
    soWhat:
      "Read (d) again: 'Existing transactions are not recorded.' That is the bank-fee trap on this " +
      "page, described by the IRS as an indicator of weak internal control. Read (i) too — every " +
      "transaction here is made by you, which you cannot change, so the compensating control has to " +
      "be the system pushing back rather than a second person.",
    source: "IRM Part 4, Chapter 10, Section 4 (revised 08-29-2025). https://www.irs.gov/irm/part4/irm_04-010-004",
  },
  {
    id: "IRM_MISSTATEMENT_STAKES",
    kind: "irs_guidance",
    cite: "IRM 4.10.4.2.3.7(8)",
    quote:
      "A potentially material misstatement of taxable income identified through a bank/financial " +
      "account analysis establishes a reasonable likelihood of additional unreported taxable income " +
      "justifying the use of a formal indirect method to make the actual determination of tax liability.",
    soWhat:
      "This is the consequence sentence, and it is worth reading twice. If your bank does not tie to " +
      "your books, the examiner is permitted to STOP BELIEVING YOUR BOOKS and reconstruct your income " +
      "himself, by his method, from your deposits. Everything on this page exists to make sure that " +
      "never becomes available to him.",
    source: "IRM Part 4, Chapter 10, Section 4 (revised 08-29-2025). https://www.irs.gov/irm/part4/irm_04-010-004",
  },
  {
    id: "BARS_UNRECORDED_ITEMS",
    kind: "state_manual",
    cite: "WA State Auditor's Office, BARS Manual §3.1.9.15(4)",
    quote:
      "Identifying transactions from the bank accounts need to be recorded in the accounting records. " +
      "For example, some of these items could include interest earned, bank fees or charges, NSF checks, " +
      "and unrecorded deposits ... Accounting records should be updated for all such transactions " +
      "identified in the bank statements.",
    soWhat:
      "The word that matters is 'need'. Finding a bank fee during a reconciliation does not complete the " +
      "reconciliation; POSTING it does. This is the sentence behind the refusal that will not let you sign " +
      "off a month while settled bank lines still have no entry.",
    source:
      "Washington State Auditor's Office, Budgeting, Accounting and Reporting System (BARS) Manual, " +
      "§3.1.9.15 Reconciliations. https://sao.wa.gov/bars-annual-filing/bars-cash-manual/",
  },
  {
    id: "BARS_NO_FURTHER_DIFFERENCES",
    kind: "state_manual",
    cite: "WA State Auditor's Office, BARS Manual §3.1.9.15(5)",
    quote:
      "After adjusting for reconciling items, there should be no further differences between bank " +
      "statements and accounting records.",
    soWhat:
      "'No further differences' means zero, reached by explaining every item — not zero reached by writing " +
      "a number into an account until the page balances. That second thing has a name in this system: a plug. " +
      "It is the $4,624,697.31 entry in the old books, and it is why this engine will not let a difference be " +
      "adjusted away.",
    source:
      "Washington State Auditor's Office, Budgeting, Accounting and Reporting System (BARS) Manual, " +
      "§3.1.9.15 Reconciliations. https://sao.wa.gov/bars-annual-filing/bars-cash-manual/",
  },
  {
    id: "WAC_314_55_087_RECORDS",
    kind: "state_law",
    cite: "WAC 314-55-087(1), (1)(b)",
    quote:
      "Cannabis licensees are responsible to keep records that clearly reflect all financial transactions " +
      "and the financial condition of the business. The following records must be kept and maintained on the " +
      "licensed premises for a five-year period and must be made available for inspection if requested by an " +
      "employee of the LCB: ... Bank statements and canceled checks for any accounts relating to the licensed business;",
    soWhat:
      "Five years, on the premises, on demand. This is why a match in this system is never deleted when you " +
      "change your mind — it is superseded, and the supersession is itself a record. The LCB can ask for the " +
      "bank statements behind your books, and the two have to agree.",
    source:
      "WAC 314-55-087 (current text WSR 24-19-040, filed 9/11/24, effective 10/12/24). " +
      "https://app.leg.wa.gov/wac/default.aspx?cite=314-55-087",
  },
  {
    id: "WAC_314_55_087_AUDIT_TRAIL",
    kind: "state_law",
    cite: "WAC 314-55-087(2)(b)",
    quote:
      "Provides the opportunity to trace any transaction back to the original source or forward to a final " +
      "total. If printouts of transactions are not made when they are processed, the system must have the " +
      "ability to reconstruct these transactions.",
    soWhat:
      "'Back to the original source or forward to a final total' is a state-law description of exactly what a " +
      "bank match is. Every match here stores the bank row it came from and the journal it points to, in both " +
      "directions, because a one-way link satisfies neither half of this sentence.",
    source:
      "WAC 314-55-087 (current text WSR 24-19-040, filed 9/11/24, effective 10/12/24). " +
      "https://app.leg.wa.gov/wac/default.aspx?cite=314-55-087",
  },
  {
    id: "REG_1_6001_1_RECORDS",
    kind: "regulation",
    cite: "26 C.F.R. §1.6001-1(a), (e)",
    quote:
      "...shall keep such permanent books of account or records, including inventories, as are sufficient to " +
      "establish the amount of gross income, deductions, credits, or other matters required to be shown by such " +
      "person in any return of such tax or information. ... The books or records required by this section shall " +
      "be kept at all times available for inspection by authorized internal revenue officers or employees, and " +
      "shall be retained so long as the contents thereof may become material in the administration of any " +
      "internal revenue law.",
    soWhat:
      "The burden is yours. Nobody has to prove your books are wrong; you have to be able to establish they are " +
      "right. A reconciled bank account is the cheapest, most persuasive evidence of that you will ever produce.",
    source: "26 C.F.R. §1.6001-1. https://www.law.cornell.edu/cfr/text/26/1.6001-1",
  },
  {
    id: "IRC_163_A_INTEREST",
    kind: "statute",
    cite: "26 U.S.C. §163(a)",
    quote:
      "General rule. There shall be allowed as a deduction all interest paid or accrued within the taxable year " +
      "on indebtedness.",
    soWhat:
      "The word doing the work is 'interest'. A mortgage payment is not an expense — it is three things wearing " +
      "one number: deductible interest, principal that just reduces what you owe, and escrow that is still your " +
      "money in someone else's hands. Coding the whole payment to an expense account overstates your deductions " +
      "and understates your equity, every single month.",
    source: "26 U.S.C. §163. https://www.law.cornell.edu/uscode/text/26/163",
  },
  {
    id: "IRC_280E_TRAFFICKING",
    kind: "statute",
    cite: "26 U.S.C. §280E",
    quote:
      "No deduction or credit shall be allowed for any amount paid or incurred during the taxable year in " +
      "carrying on any trade or business if such trade or business (or the activities which comprise such trade " +
      "or business) consists of trafficking in controlled substances (within the meaning of schedule I and II of " +
      "the Controlled Substances Act) which is prohibited by Federal law or the law of any State in which such " +
      "trade or business is conducted.",
    soWhat:
      "Read it closely: it disallows deductions of a TRADE OR BUSINESS that traffics. It does not disallow " +
      "deductions of a PERSON who happens to own one. That distinction is the whole reason the four entities in " +
      "this system are kept rigorously apart.",
    source: "26 U.S.C. §280E. https://www.law.cornell.edu/uscode/text/26/280E",
  },
  {
    id: "CHAMP_SEPARATE_BUSINESS",
    kind: "irs_guidance",
    cite:
      "Californians Helping to Alleviate Medical Problems, Inc. v. Commissioner, 128 T.C. 173 (2007)",
    quote:
      "Section 280E ... does not preclude petitioner from deducting expenses attributable to a trade or business " +
      "separate and apart from that consisting of trafficking in controlled substances.",
    soWhat:
      "This is the case that makes your building and your ATM safe. The landholding company rents real estate and " +
      "the ATM company dispenses cash; neither one traffics in anything. So the interest on the building loan is " +
      "deductible in full under §163(a), and this engine splits a loan payment accordingly instead of burying it " +
      "in the store's non-deductible pile. Getting this wrong costs real money in the wrong direction — you would " +
      "be over-paying tax on a deduction you are entitled to.",
    source: "128 T.C. 173 (2007). https://www.leagle.com/decision/200714012tc17311260",
  },
  {
    id: "USC_31_5324_STRUCTURING",
    kind: "statute",
    cite: "31 U.S.C. §5324(a)(3)",
    quote:
      "No person shall, for the purpose of evading the reporting requirements of section 5313(a) or 5325 or any " +
      "regulation prescribed under any such section ... structure or assist in structuring, or attempt to structure " +
      "or assist in structuring, any transaction with one or more domestic financial institutions.",
    soWhat:
      "Note the four words 'for the purpose of evading'. The crime is the INTENT, not the amount — which is why " +
      "this system will show you a pattern of deposits sitting just under the reporting threshold and will never " +
      "call it structuring. It cannot know why you did it. You can. Depositing your money is not an offence; " +
      "splitting it up to keep the bank quiet is.",
    source: "31 U.S.C. §5324. https://www.law.cornell.edu/uscode/text/31/5324",
  },
] as const;

/** Look up one authority by id. Returns undefined rather than throwing. */
export function findBankAuthority(id: string): BankAuthority | undefined {
  return BANK_AUTHORITIES.find((a) => a.id === id);
}

// ===========================================================================
// §6  DATE HELPERS — integer arithmetic only, no Date parsing surprises
// ===========================================================================

/**
 * Parse `YYYY-MM-DD` into a day number, WITHOUT constructing a `Date`.
 *
 * `new Date("2026-11-01")` is parsed as UTC midnight while `new Date(2026, 10,
 * 1)` is local midnight, and mixing them silently shifts a day in Pacific time —
 * which would move a transaction across a month-end and therefore across a
 * reporting period. Slice 4 was bitten by a related `Date.UTC` two-digit-year
 * trap, so this core does not construct `Date` objects at all.
 *
 * Returns null for anything that is not a real calendar date.
 */
export function parseIsoDateParts(
  iso: string,
): { y: number; m: number; d: number } | null {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  const lengths = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[m - 1] ?? 0;
}

/**
 * Days since 1970-01-01 for a `YYYY-MM-DD` string, by pure integer arithmetic
 * (Howard Hinnant's civil-days algorithm). Returns null for an invalid date.
 */
export function isoToDayNumber(iso: string): number | null {
  const parts = parseIsoDateParts(iso);
  if (!parts) return null;
  const { y, m, d } = parts;
  const yAdj = m <= 2 ? y - 1 : y;
  const era = Math.floor(yAdj / 400);
  const yoe = yAdj - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Absolute whole days between two ISO dates, or null if either is invalid. */
export function daysApart(isoA: string, isoB: string): number | null {
  const a = isoToDayNumber(isoA);
  const b = isoToDayNumber(isoB);
  if (a === null || b === null) return null;
  return Math.abs(a - b);
}

/** True when the date is on or after the line in the sand (2026-01-01). */
export function isOnOrAfterCutover(iso: string): boolean {
  const d = isoToDayNumber(iso);
  const line = isoToDayNumber(LINE_IN_THE_SAND);
  if (d === null || line === null) return false;
  return d >= line;
}

// ===========================================================================
// §7  CLASSIFICATION — what kind of event is this, and how sure are we
// ===========================================================================

/**
 * Descriptor patterns. These are SIGNALS, never conclusions: the highest score
 * a descriptor alone can produce is deliberately capped below certainty, so the
 * owner is always the one who decides. IRM 4.10.4.2.3.4(4)(f) lists
 * "transactions are improperly classified" as a weak-control symptom, and a
 * matcher that classified on a string alone would be manufacturing exactly that.
 */
const DESCRIPTOR_SIGNALS: ReadonlyArray<{
  pattern: RegExp;
  kind: BankEventKind;
  weight: number;
  why: string;
}> = [
  { pattern: /\b(transfer|xfer|to savings|from savings|online banking transfer)\b/i, kind: "own_transfer", weight: 30000, why: "the descriptor says transfer" },
  { pattern: /\b(deposit|cash deposit|branch deposit|atm deposit)\b/i, kind: "deposit_of_sales", weight: 25000, why: "the descriptor says deposit" },
  { pattern: /\b(service charge|monthly fee|maintenance fee|wire fee|overdraft|nsf|returned item)\b/i, kind: "bank_fee", weight: 40000, why: "the descriptor names a bank charge" },
  { pattern: /\binterest (paid|earned|credit)\b/i, kind: "interest_income", weight: 40000, why: "the descriptor says interest earned" },
  { pattern: /\b(mortgage|cenlar|loan payment|note payment|principal and interest)\b/i, kind: "loan_payment", weight: 35000, why: "the descriptor names a loan payment" },
  { pattern: /\b(payroll|direct deposit|adp|gusto|paychex|net pay)\b/i, kind: "payroll_funding", weight: 35000, why: "the descriptor names payroll" },
  { pattern: /\b(dor|department of revenue|irs|eftps|excise|use tax|estimated tax)\b/i, kind: "tax_payment", weight: 35000, why: "the descriptor names a taxing authority" },
  { pattern: /\b(atm|vault load|pai |payment alliance)\b/i, kind: "atm_vault", weight: 30000, why: "the descriptor names the ATM business" },
];

/** Clamp a milli-percent into 0..100000. */
export function clampMilliPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100000) return 100000;
  return Math.round(v);
}

/**
 * Score a bank row against a journal candidate. Returns 0..100000 milli-percent
 * plus the human-readable reasons.
 *
 * The scoring is deliberately conservative and the reasons are deliberately
 * verbose, because the owner is the reviewer and a proposal he cannot audit is
 * worse than no proposal at all.
 */
export function scoreMatch(
  row: BankRow,
  candidate: JournalCandidate,
): { confidenceMilliPct: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const ledgerCash = plaidToLedgerCashCents(row.amountCents);

  // 1) The amount. This is the strongest single signal, and an exact match on
  //    BOTH magnitude and direction is worth more than anything else here.
  if (ledgerCash === candidate.cashLineCents) {
    score += 55000;
    reasons.push(
      `The amount matches exactly, and in the right direction: ${formatSignedCents(ledgerCash)} on both sides.`,
    );
  } else if (Math.abs(ledgerCash) === Math.abs(candidate.cashLineCents)) {
    // Same magnitude, opposite direction. This is the sign-inversion landmine
    // wearing a disguise, and it is worth NEGATIVE score, not positive.
    score -= 40000;
    reasons.push(
      "The amounts are the same size but point in OPPOSITE directions. That is the classic backwards-sign error, so this pairing is being pushed down rather than up.",
    );
  } else {
    reasons.push(
      `The amounts differ: the bank says ${formatSignedCents(ledgerCash)} and the entry says ${formatSignedCents(candidate.cashLineCents)}.`,
    );
  }

  // 2) The date, on a sliding scale.
  const gap = daysApart(row.date, candidate.journalDate);
  if (gap === null) {
    reasons.push("One of the dates is not a real calendar date, so the timing could not be compared.");
  } else if (gap === 0) {
    score += 25000;
    reasons.push("Same day.");
  } else if (gap <= MATCH_WINDOW_DAYS) {
    score += 25000 - gap * 4000;
    reasons.push(
      `${gap} day${gap === 1 ? "" : "s"} apart, which is normal for cash that is counted at close and carried to the bank on the next business day.`,
    );
  } else if (gap <= MATCH_WINDOW_HARD_DAYS) {
    reasons.push(
      `${gap} days apart. That is outside the normal deposit lag, so the timing is not being counted in favour of this pairing.`,
    );
  } else {
    score -= 30000;
    reasons.push(
      `${gap} days apart, which is far beyond any plausible deposit lag. Two separate events that happen to share an amount will look exactly like this.`,
    );
  }

  // 3) Already matched. Not fatal to the score by itself — the refusal layer
  //    handles it — but it must be visible in the reasons.
  if (candidate.alreadyMatched) {
    score -= 50000;
    reasons.push("That entry is already matched to a different bank line.");
  }

  return { confidenceMilliPct: clampMilliPct(score), reasons };
}

/**
 * Classify what a bank row appears to be. Never returns certainty from a
 * descriptor alone: the cap is enforced and asserted in the tests.
 */
export function classifyBankRow(row: BankRow): {
  kind: BankEventKind;
  confidenceMilliPct: number;
  reasons: string[];
} {
  const haystack = `${row.name ?? ""} ${row.merchantName ?? ""}`;
  const reasons: string[] = [];
  let best: { kind: BankEventKind; weight: number } = { kind: "unknown", weight: 0 };

  for (const sig of DESCRIPTOR_SIGNALS) {
    if (sig.pattern.test(haystack)) {
      reasons.push(`Looks like ${labelForKind(sig.kind).toLowerCase()} because ${sig.why}.`);
      if (sig.weight > best.weight) best = { kind: sig.kind, weight: sig.weight };
    }
  }

  if (best.kind === "unknown") {
    reasons.push(
      "Nothing in the description is recognisable, so this is being left as unknown rather than guessed at. An unlabelled line you review is far safer than a labelled one you trust.",
    );
  }

  // A descriptor is never proof. 45000 is below the "confident" band on purpose.
  return { kind: best.kind, confidenceMilliPct: clampMilliPct(Math.min(best.weight, 45000)), reasons };
}

/** Human label for an event kind. */
export function labelForKind(kind: BankEventKind): string {
  switch (kind) {
    case "deposit_of_sales": return "A deposit of sales";
    case "vendor_payment": return "A payment to a vendor";
    case "payroll_funding": return "Payroll funding";
    case "loan_payment": return "A loan payment";
    case "own_transfer": return "A transfer between your own accounts";
    case "owner_draw": return "An owner draw";
    case "owner_contribution": return "An owner contribution";
    case "bank_fee": return "A bank fee";
    case "interest_income": return "Interest earned";
    case "tax_payment": return "A tax payment";
    case "atm_vault": return "An ATM vault movement";
    case "unknown": return "Not yet identified";
  }
}

// ===========================================================================
// §8  THE REFUSAL ENGINE
// ===========================================================================

/** The full input to a match decision. */
export type MatchRequest = {
  row: BankRow;
  candidate: JournalCandidate | null;
  eventKind: BankEventKind;
  entityCode: EntityCode;
  /** Cost classes on any NEW lines this match would create. */
  proposedCostClasses?: CostClass[];
  /** For a loan payment: how the payment splits. Cents, all non-negative. */
  loanSplit?: { interestCents: number; principalCents: number; escrowCents: number };
  /** Set true when the owner has confirmed both sides of an own-account transfer. */
  transferCounterpartyConfirmed?: boolean;
  /**
   * True when THIS BANK ROW is already matched to some journal. The mirror of
   * `candidate.alreadyMatched`, and both directions are needed: one journal must
   * not absorb two bank lines, and one bank line must not create two journals.
   * Guarding only one side leaves the other wide open.
   */
  bankRowAlreadyMatched?: boolean;
};

export type MatchVerdict = {
  /** True only when every hard block is clear. */
  postable: boolean;
  findings: BankFinding[];
  /** The ledger-convention cash amount this match would post. */
  ledgerCashCents: number;
  direction: BankDirection;
};

/**
 * Evaluate a proposed match. This is the gate: if it says `postable: false`,
 * nothing downstream may post, and the database enforces the same rules
 * independently (defence in depth — a UI can be bypassed, a CHECK cannot).
 */
export function evaluateMatch(req: MatchRequest): MatchVerdict {
  const findings: BankFinding[] = [];
  const { row, candidate } = req;

  // --- Integrity of the bank row itself ------------------------------------
  if (!Number.isInteger(row.amountCents)) {
    findings.push({
      code: "BANK_NON_INTEGER_CENTS",
      hardBlock: true,
      message: "That bank amount is not a whole number of cents.",
      authority: "Standing money rule: integer cents, never a float.",
      remedy:
        "A fraction of a cent means something upstream used floating-point arithmetic. Do not round it here — find where the fraction came from, because whatever produced it is producing it everywhere.",
    });
    // Everything below depends on the amount, so stop.
    return { postable: false, findings, ledgerCashCents: 0, direction: "money_in" };
  }

  const ledgerCashCents = plaidToLedgerCashCents(row.amountCents);
  const direction = bankDirection(row.amountCents);

  if (row.pending) {
    findings.push({
      code: "BANK_PENDING_ROW",
      hardBlock: true,
      message: "That line is still pending at the bank, so it cannot be posted yet.",
      authority: "Reg. §1.6001-1(a) — records must be sufficient to establish the amount.",
      remedy:
        "A pending charge can change its amount and its date before it settles, and some vanish entirely. If it were posted now, the books would record a number the bank later contradicts. Wait for it to settle — usually one to three days — and it will appear here ready to match.",
    });
  }

  if (row.removed) {
    findings.push({
      code: "BANK_REMOVED_ROW",
      hardBlock: true,
      message: "The bank withdrew that line, so there is nothing to record.",
      authority: "Reg. §1.6001-1(a); WAC 314-55-087(2)(b) (trace to original source).",
      remedy:
        "Plaid marks a transaction as removed when the bank reverses or cancels it. The correct entry for an event that did not happen is no entry at all. It is kept on file rather than deleted so the audit trail still shows it was considered.",
    });
  }

  if (req.bankRowAlreadyMatched === true) {
    findings.push({
      code: "BANK_ALREADY_MATCHED",
      hardBlock: true,
      message: "That bank line is already matched to an entry on the books.",
      authority: "IRM 4.10.4.2.3.4(4)(c) — 'Recorded transactions are not valid'; WAC 314-55-087(2)(b) (trace any transaction back to the original source).",
      remedy:
        "One line at the bank is one event in the world, so it gets exactly one entry. Matching it a second time would record the same money twice — and because both entries balance, the books would look perfectly healthy while the income or the expense was doubled. If the first match was wrong, undo it; the old match is kept on file as superseded rather than deleted, so the audit trail still shows what happened and why.",
    });
  }

  // Check the date is a real date BEFORE judging whether it is pre-cut-over.
  // `isOnOrAfterCutover` returns false for garbage, which would otherwise
  // surface as "dated before 2026-01-01" — a confident, specific, WRONG
  // explanation. A wrong explanation is worse than no explanation, because it
  // sends the reader off to fix something that was never the problem.
  const dateValid = parseIsoDateParts(row.date) !== null;
  if (!dateValid) {
    findings.push({
      code: "BANK_INVALID_DATE",
      hardBlock: true,
      message: `"${String(row.date)}" is not a readable calendar date.`,
      authority: "Reg. §1.6001-1(a) — records must be sufficient to establish the amount and the date.",
      remedy:
        "Every entry has to land in a period, because periods are what tax returns are made of. A date that cannot be read cannot be placed in one. This almost always means the feed sent something unexpected rather than that you did anything wrong — the raw payload is kept on file, so the original can be checked.",
    });
  } else if (!isOnOrAfterCutover(row.date)) {
    findings.push({
      code: "BANK_PRE_CUTOVER",
      hardBlock: true,
      message: `That bank line is dated before ${LINE_IN_THE_SAND}, which is earlier than these books begin.`,
      authority: "Owner standing rule 10 — the line in the sand, enforced in the schema.",
      remedy:
        "Anything before the cut-over belongs to the Sage books and to your accountant's closed years. Posting it here would create a second, contradictory record of a year that is already filed. If it genuinely belongs in this year, correct the date at the source.",
    });
  }

  // --- The sign wall -------------------------------------------------------
  if (candidate) {
    const sameSign =
      (ledgerCashCents > 0 && candidate.cashLineCents > 0) ||
      (ledgerCashCents < 0 && candidate.cashLineCents < 0) ||
      (ledgerCashCents === 0 && candidate.cashLineCents === 0);

    if (!sameSign) {
      findings.push({
        code: "BANK_SIGN_DISAGREES",
        hardBlock: true,
        message:
          "The bank and the entry disagree about which way the money moved.",
        authority:
          "Plaid stores positive as money OUT (migration 0157); the ledger stores positive as a DEBIT (migration 0172). The two are opposite, so this is checked deliberately.",
        remedy:
          "This is the error that hides best, because a backwards entry still balances — both lines flip together, debits still equal credits, and nothing looks wrong. Check the entry: money arriving in the bank must DEBIT the bank account, and money leaving must CREDIT it.",
      });
    } else if (ledgerCashCents !== candidate.cashLineCents) {
      findings.push({
        code: "BANK_AMOUNT_MISMATCH",
        hardBlock: true,
        message: `The amounts do not agree: the bank shows ${formatSignedCents(ledgerCashCents)} and the entry shows ${formatSignedCents(candidate.cashLineCents)}.`,
        authority: "IRM 4.10.4.2.3.4(4)(e) — 'Transactions are improperly valued'.",
        remedy:
          "A near-miss usually means a fee was netted out, a deposit combined two days, or a partial payment was made. Do not force the match. Either correct the entry to what the bank actually did, or split the deposit so each piece matches its own bank line.",
      });
    }

    if (candidate.alreadyMatched) {
      findings.push({
        code: "BANK_JOURNAL_ALREADY_MATCHED",
        hardBlock: true,
        message: "That entry is already matched to a different bank line.",
        authority: "IRM 4.10.4.2.3.4(4)(c) — 'Recorded transactions are not valid'.",
        remedy:
          "Matching one entry to two bank lines would count the same money twice. If the first match was wrong, undo it — the old match stays on file as a superseded record — and then make this one.",
      });
    }

    if (candidate.entityCode !== req.entityCode) {
      findings.push({
        code: "BANK_ENTITY_MISMATCH",
        hardBlock: true,
        message: `That entry belongs to ${candidate.entityCode}, but this match is being made under ${req.entityCode}.`,
        authority: "IRM 4.10.4.2.3.4(4)(j) — 'Significant commingling of business and personal funds'.",
        remedy:
          "You run four separate sets of books: the shop, the ATM business, the land, and you personally. Money that crosses between them is a loan or a distribution, never a shared entry. Post it in the entity that actually owns the account, then record the movement between entities on purpose.",
      });
    }

    const gap = daysApart(row.date, candidate.journalDate);
    if (gap !== null && gap > MATCH_WINDOW_HARD_DAYS) {
      findings.push({
        code: "BANK_DATE_TOO_FAR",
        hardBlock: true,
        message: `Those two are ${gap} days apart, which is too far to be the same event.`,
        authority: "IRM 4.10.4.2.3.4(4)(g) — 'Transaction are recorded at the improper time'.",
        remedy:
          "Two unrelated transactions that happen to share an amount look identical to a matcher. If this really is the same event, the date on one of them is wrong and that is what needs fixing.",
      });
    }
  }

  // --- The classification traps -------------------------------------------
  if (req.eventKind === "own_transfer" && req.transferCounterpartyConfirmed !== true) {
    findings.push({
      code: "BANK_TRANSFER_AS_INCOME",
      hardBlock: true,
      message:
        "A transfer between your own accounts needs both sides identified before it can post.",
      authority:
        "IRM 4.10.4.2.3.7(3)(b): \"Nontaxable funds, transfers-in, and returned deposits need to be subtracted from total deposits to get 'Taxable Deposits.'\"",
      remedy:
        "Moving your own money is not income and not an expense — it is the same dollar in a different pocket. If only one side is recorded, the deposit side looks like revenue you never earned and the withdrawal side looks like a cost you never paid, and both of them are wrong at once. Point at the matching line in the other account and this posts cleanly through the in-transit account.",
    });
  }

  if (req.eventKind === "unknown") {
    findings.push({
      code: "BANK_UNCLASSIFIED",
      hardBlock: true,
      message: "That line has not been identified yet, so it cannot post.",
      authority: "IRM 4.10.4.2.3.4(4)(f) — 'Transactions are improperly classified'.",
      remedy:
        "This is deliberate. A guess that lands in the wrong account is far more expensive than a line that sits and waits for you, because the guess looks finished. Tell it what this was and it will remember the pattern for next time.",
    });
  }

  // --- The double-count trap ----------------------------------------------
  if (candidate === null && wouldCreateIncomeOrExpense(req.eventKind)) {
    findings.push({
      code: "BANK_DOUBLE_COUNT_RISK",
      hardBlock: true,
      message:
        "Creating a brand-new entry from this bank line risks recording the same money twice.",
      authority: "IRM 4.10.4.2.3.7(5) — excess deposits over reported income read as unreported income.",
      remedy:
        "Your sales already post from the point of sale and your bills already post from the purchasing screen. When the deposit arrives, the income is on the books already — the bank line just proves the money landed. Match it to the entry that exists. Only create a new entry when nothing on the books explains it, and then say what it was.",
    });
  }

  // --- The loan-payment trap ----------------------------------------------
  if (req.eventKind === "loan_payment") {
    const split = req.loanSplit;
    const total = bankMagnitudeCents(row.amountCents);
    if (!split) {
      findings.push({
        code: "BANK_LOAN_SINGLE_LINE",
        hardBlock: true,
        message: "A loan payment cannot be recorded as one number.",
        authority:
          "IRC §163(a): \"There shall be allowed as a deduction all interest paid or accrued within the taxable year on indebtedness.\"",
        remedy:
          "One payment leaves the bank, but three different things happen. The interest is a deductible expense. The principal is not an expense at all — it reduces what you owe, which increases what you own. The escrow is still your money, just held by the servicer for taxes and insurance. Coding the whole payment to an expense account overstates your deduction and understates your equity every single month. Enter the three pieces from the statement and this will post correctly.",
      });
    } else {
      const sum = split.interestCents + split.principalCents + split.escrowCents;
      const anyNegative =
        split.interestCents < 0 || split.principalCents < 0 || split.escrowCents < 0;
      if (anyNegative || sum !== total) {
        findings.push({
          code: "BANK_LOAN_SINGLE_LINE",
          hardBlock: true,
          message: anyNegative
            ? "One of the loan split amounts is negative."
            : `The three pieces add up to ${formatCents(sum)}, but the payment was ${formatCents(total)}.`,
          authority: "IRC §163(a); IRM 4.10.4.2.3.4(4)(e) — 'Transactions are improperly valued'.",
          remedy:
            "Interest, principal and escrow must together equal the payment exactly, and none of them can be negative. Take the three figures straight off the servicer's statement rather than calculating them — the statement is the evidence an examiner will ask for.",
        });
      }
    }
  }

  // --- The §280E trap (the one that hides) ---------------------------------
  //
  // This gate is written to catch the ABSENCE of a cost class, not just an
  // invalid one. The first draft only checked validity, which meant the case it
  // was written to stop — a new P&L entry created with NO §280E tag at all —
  // sailed straight through, because an empty list has no invalid members. That
  // is slice 4's Defect 13 reappearing in a new file, and it is precisely the
  // kind of failure this whole project exists to prevent: the line balances, the
  // journal posts, nothing looks wrong, and the amount silently vanishes from
  // the disallowed column of the tax return.
  const classes = req.proposedCostClasses ?? [];
  if (candidate === null && createsPnlLines(req.eventKind)) {
    if (classes.length === 0) {
      findings.push({
        code: "BANK_NO_COST_CLASS",
        hardBlock: true,
        message: "A new entry from a bank line is missing its §280E label.",
        authority: "IRC §280E; Reg. §1.471-3(b) (Greenway is a reseller).",
        remedy:
          "Every §280E report reads the cost class on the line, not the account number. A line posted without one balances perfectly and looks completely normal, while quietly dropping out of the disallowed column. Nothing appears broken — the only symptom is a wrong tax return months later. Say what this cost was and the label follows automatically.",
      });
    } else if (classes.some((c) => !isValidCostClass(c))) {
      // Belt and braces. TypeScript makes this unreachable from typed code, but
      // this core is also reached from JSON over RPC, where the type system is
      // a suggestion rather than a guarantee.
      findings.push({
        code: "BANK_NO_COST_CLASS",
        hardBlock: true,
        message: "That §280E label is not one of the recognised ones.",
        authority: "IRC §280E; migration 0172 CHECK constraint on gl_journal_lines.cost_class.",
        remedy:
          "The label has to be one the reports understand: a direct cost of goods, an allocable cost of goods, a disallowed §280E cost, a separate business, personal, or none. Anything else would be stored but never counted.",
      });
    }
  }

  // --- Commingling: a personal cost inside a business entity ---------------
  if (req.entityCode !== "personal" && classes.includes("personal")) {
    findings.push({
      code: "BANK_COMMINGLED",
      hardBlock: true,
      message: `That line is being coded as personal inside the ${req.entityCode} books.`,
      authority:
        "IRM 4.10.4.2.3.4(4)(j) — 'Significant commingling of business and personal funds'; IRM 4.10.4.2.3.7(2)(c) — an examiner estimates 'the risk of commingled personal and business bank/financial accounts'.",
      remedy:
        "If the company paid for something personal, that is not an expense of the company — it is money taken out of the company, which is an owner draw. Recording it as an expense understates the profit the company actually made and overstates its costs, and in an S corporation it also quietly changes your basis. Post it as a draw and it lands correctly in both places at once. If it really was a business cost, give it the business label instead.",
    });
  }

  const postable = findings.every((f) => !f.hardBlock);
  return { postable, findings, ledgerCashCents, direction };
}

/** Event kinds that would create P&L impact if posted as a fresh entry. */
function wouldCreateIncomeOrExpense(kind: BankEventKind): boolean {
  return (
    kind === "deposit_of_sales" ||
    kind === "vendor_payment" ||
    kind === "payroll_funding"
  );
}

/**
 * Event kinds whose fresh entry touches profit and loss, and therefore MUST
 * carry a §280E cost class.
 *
 * Deliberately WIDER than `wouldCreateIncomeOrExpense`. That function answers
 * "could this double-count?"; this one answers "does this hit the P&L?". A bank
 * fee, interest earned and a tax payment are all P&L items that legitimately
 * originate at the bank — nothing upstream posts them — so they are allowed
 * through the double-count gate but must still be labelled. Transfers, draws,
 * contributions and loan payments are balance-sheet movements and are not
 * required to carry one.
 */
function createsPnlLines(kind: BankEventKind): boolean {
  return (
    kind === "deposit_of_sales" ||
    kind === "vendor_payment" ||
    kind === "payroll_funding" ||
    kind === "bank_fee" ||
    kind === "interest_income" ||
    kind === "tax_payment"
  );
}

function isValidCostClass(c: string): boolean {
  return (
    c === "cogs_direct" ||
    c === "cogs_allocable" ||
    c === "nondeductible_280e" ||
    c === "separate_business" ||
    c === "personal" ||
    c === "none"
  );
}

// ===========================================================================
// §9  THE RECONCILIATION — proving the book balance equals the bank balance
// ===========================================================================

export type ReconciliationInput = {
  /** Bank's own closing balance for the period, in cents (positive = money). */
  statementClosingCents: number;
  /** The ledger balance of the cash account, signed ledger convention. */
  ledgerBalanceCents: number;
  /** Bank rows in the period that are NOT yet matched (Plaid convention). */
  unmatchedBankRows: BankRow[];
  /** Journals touching cash that are NOT yet matched (ledger convention). */
  unmatchedJournals: JournalCandidate[];
};

export type ReconciliationResult = {
  statementClosingCents: number;
  ledgerBalanceCents: number;
  /** Money the bank knows about that the books do not. */
  inBankNotBooksCents: number;
  /** Money the books know about that the bank does not (e.g. cheques in flight). */
  inBooksNotBankCents: number;
  /** What the ledger SHOULD be once everything outstanding clears. */
  adjustedLedgerCents: number;
  /**
   * What the BANK should be once everything outstanding clears. A real
   * reconciliation adjusts BOTH sides; see the note on `reconcile`.
   */
  adjustedBankCents: number;
  /** Zero means the ARITHMETIC closes. Anything else is the number to explain. */
  differenceCents: number;
  ties: boolean;
  /**
   * How many settled bank lines are real activity with no entry on the books
   * yet. THESE ARE NOT TIMING DIFFERENCES. A bank fee, interest, an NSF return
   * or a forgotten auto-debit means the books are incomplete until a journal
   * entry is posted — see `complete` below and D8 in the header notes.
   */
  unrecordedItemCount: number;
  /** The total of those unrecorded items, in ledger convention. */
  unrecordedItemCents: number;
  /**
   * THE HONEST ANSWER. `ties` only says the arithmetic closes; it can be true
   * while an expense is missing from the profit and loss entirely, because an
   * unrecorded item sits on BOTH sides of the equation and cancels itself out.
   * `complete` means it ties AND there is nothing left to write down.
   */
  complete: boolean;
  /**
   * The only green light. Never sign off on `ties` alone — that is exactly how
   * a year of card fees goes unclaimed and the return overstates income.
   */
  readyToSignOff: boolean;
  /** Plain-English narrative for the owner. */
  narrative: string[];
};

/**
 * Reconcile. The whole point, in one sentence: prove that the number in the
 * books and the number at the bank are the same number, and when they are not,
 * say exactly how much is unexplained rather than hiding it in a plug.
 *
 * The plug is not hypothetical here. Standing rule 19 records that the owner's
 * Sage books carried a "20009 LAZY INVENTORY ENTRY" of $4,624,697.31 — a single
 * balancing figure that concealed two separate structural problems for years.
 * This function therefore never balances itself. It reports the difference and
 * refuses to characterise it.
 *
 * ---------------------------------------------------------------------------
 * BOTH SIDES GET ADJUSTED. THIS IS THE WHOLE ALGORITHM:
 * ---------------------------------------------------------------------------
 *   adjusted books = book balance   + settled bank lines not yet written down
 *   adjusted bank  = bank statement + entries written down but not yet cleared
 *   difference     = adjusted books - adjusted bank      (zero = it ties)
 *
 * The second line is the one that is easy to leave out, and leaving it out is a
 * defect that fails in the WORST direction: it invents an unexplained gap out of
 * books that are perfectly clean. A cheque Michael wrote on the 30th that the
 * payee has not cashed is correctly on the books and correctly absent from the
 * statement. Nothing is wrong. If the reconciliation flagged that as a gap every
 * month, it would be training him to ignore its warnings — and then the month a
 * gap is REAL, he ignores that one too. A control that cries wolf is worse than
 * no control, because it manufactures the very complacency it exists to prevent.
 *
 * (This exact defect was present in the first draft of this file and was caught
 * by writing the textbook uncashed-cheque case as a test. It is documented here
 * so it cannot quietly come back.)
 *
 * ---------------------------------------------------------------------------
 * "TIES" IS NOT "DONE". THE SECOND DEFECT, AND THE MORE DANGEROUS ONE:
 * ---------------------------------------------------------------------------
 * Proven against live PostgreSQL with empty books and one unrecorded $77.00
 * bank fee, this function returned `ties: true, difference: 0` and told the
 * owner "everything ties to the penny". The arithmetic was flawless. The
 * conclusion was false. An unrecorded bank line is added to the ledger side AND
 * is already inside the bank's closing balance, so it cancels itself and the
 * difference is zero — while $77 of deductible expense is missing from the
 * profit and loss entirely.
 *
 * A reconciliation has TWO kinds of reconciling item, and they are not
 * interchangeable:
 *
 *   TIMING DIFFERENCES  — uncashed cheques, deposits in transit.
 *                         The books are already right. They clear themselves.
 *                         NO ENTRY IS NEEDED.
 *
 *   UNRECORDED ITEMS    — bank charges, interest, NSF returns, forgotten
 *                         auto-debits. The books are WRONG until an entry is
 *                         posted. AN ENTRY IS MANDATORY.
 *
 * WA SAO BARS Manual §3.1.9.15(4), verbatim:
 *   "Identifying transactions from the bank accounts need to be recorded in the
 *    accounting records. For example, some of these items could include
 *    interest earned, bank fees or charges, NSF checks, and unrecorded deposits
 *    ... Accounting records should be updated for all such transactions
 *    identified in the bank statements."
 * §3.1.9.15(5), verbatim:
 *   "After adjusting for reconciling items, there should be no further
 *    differences between bank statements and accounting records."
 *
 * So `ties` is reported honestly as what it is — arithmetic — and `complete`
 * (ties AND nothing left unrecorded) is the flag that governs sign-off. Scaled
 * across a year of card fees this is a real deduction never claimed, on a
 * return that OVERSTATES income: tax paid that was never owed.
 */
export function reconcile(input: ReconciliationInput): ReconciliationResult {
  let inBankNotBooksCents = 0;
  let unrecordedItemCount = 0;
  for (const row of input.unmatchedBankRows) {
    if (row.removed) continue; // withdrawn by the bank; not real
    if (row.pending) continue; // not settled; not yet a fact
    inBankNotBooksCents += plaidToLedgerCashCents(row.amountCents);
    // Settled, not withdrawn, and no entry against it: this is real money that
    // has moved and has not been written down. It is NOT a timing difference.
    unrecordedItemCount += 1;
  }

  let inBooksNotBankCents = 0;
  for (const j of input.unmatchedJournals) {
    inBooksNotBankCents += j.cashLineCents;
  }

  // The ledger, brought forward for everything the bank has already done but
  // the books have not yet recorded.
  const adjustedLedgerCents = input.ledgerBalanceCents + inBankNotBooksCents;
  // The statement, brought forward for everything the books have recorded but
  // the bank has not yet processed (uncashed cheques, deposits in transit).
  const adjustedBankCents = input.statementClosingCents + inBooksNotBankCents;
  const differenceCents = adjustedLedgerCents - adjustedBankCents;
  const ties = differenceCents === 0;
  const unrecordedItemCents = inBankNotBooksCents;
  // THE DISTINCTION THAT MATTERS. `ties` is arithmetic; `complete` is truth.
  const complete = ties && unrecordedItemCount === 0;
  const readyToSignOff = complete;

  const narrative: string[] = [];
  narrative.push(
    `The bank says you closed at ${formatCents(input.statementClosingCents)}. Your books say ${formatSignedCents(input.ledgerBalanceCents)}.`,
  );
  if (unrecordedItemCount > 0) {
    narrative.push(
      `${unrecordedItemCount} settled bank line(s) totalling ${formatSignedCents(unrecordedItemCents)} have not been recorded in the books yet. These are NOT cheques waiting to clear — this is money that has already moved and has no entry against it: bank charges, card fees, interest, a returned payment, an automatic debit. Each one needs a journal entry before this month is finished.`,
    );
    narrative.push(
      "Be careful here: the arithmetic can still come out to zero while these are outstanding, because an unrecorded bank line sits on both sides of the comparison and cancels itself. Balancing is not the same as being complete. A year of unrecorded card fees left this way is a deduction you never claimed, on a return that overstates your income — you would be paying tax you do not owe.",
    );
  }
  if (inBooksNotBankCents !== 0) {
    narrative.push(
      `${input.unmatchedJournals.length} entr(y/ies) totalling ${formatSignedCents(inBooksNotBankCents)} are on the books but have not reached the bank — cheques that have not been cashed, or deposits still in transit. These are not errors: they are correctly on the books and correctly not yet at the bank, so the statement is adjusted for them rather than the books.`,
    );
  }
  if (complete) {
    narrative.push(
      "Everything ties to the penny and there is nothing left to write down. This is the statement your accountant needs, and the one an examiner asks for first. Safe to sign off.",
    );
  } else if (ties) {
    narrative.push(
      `The arithmetic closes, but this month is NOT finished: ${unrecordedItemCount} bank line(s) still need an entry. Post those first, then reconcile again. Do not sign this off yet.`,
    );
  } else {
    narrative.push(
      `There is ${formatSignedCents(differenceCents)} that nothing explains. Do not adjust anything to make this disappear — that is precisely how the $4,624,697.31 plug got into the old books and stayed there for years. Find the missing line.`,
    );
  }

  return {
    statementClosingCents: input.statementClosingCents,
    ledgerBalanceCents: input.ledgerBalanceCents,
    inBankNotBooksCents,
    inBooksNotBankCents,
    adjustedLedgerCents,
    adjustedBankCents,
    differenceCents,
    ties,
    unrecordedItemCount,
    unrecordedItemCents,
    complete,
    readyToSignOff,
    narrative,
  };
}

// ===========================================================================
// §10  THE LOAN SPLIT — turning one payment into three honest lines
// ===========================================================================

export type LoanJournalLine = {
  accountCode: string;
  /** SIGNED ledger cents. Positive = debit. */
  amountCents: number;
  costClass: CostClass;
  description: string;
};

/**
 * WHICH ENTITY'S INTEREST IS DISALLOWED, AND WHY.
 *
 * §280E disallows deductions for "any trade or business" that consists of
 * trafficking in a controlled substance. The operative words are *trade or
 * business*, not *taxpayer*, and that distinction is the single most valuable
 * structural fact in Michael's whole tax position.
 *
 * The controlling authority is Californians Helping to Alleviate Medical
 * Problems, Inc. v. Commissioner, 128 T.C. 173 (2007) ("CHAMP"), in which the
 * Tax Court held that a taxpayer carrying on a second, genuinely separate trade
 * or business alongside the trafficking business may deduct the expenses of that
 * second business in full. §280E reaches the trafficking business only.
 *
 * Applying that to the four sets of books:
 *
 *   greenway     — IS the trafficking business. Its interest is a real §163(a)
 *                  expense, but §280E disallows the deduction. Tagged
 *                  `nondeductible_280e` so the disallowance is computed, not
 *                  forgotten. (Note it is still a genuine cost of doing
 *                  business; it is only the DEDUCTION that is denied.)
 *   landholding  — a separate real-estate trade or business. Mortgage interest
 *                  on the property is fully deductible under §163(a).
 *   atm          — a separate business (its own Schedule C). Its interest is
 *                  fully deductible.
 *   personal     — not a business expense at all; personal interest is governed
 *                  by §163(h) and is generally not deductible, so it is never
 *                  tagged as a business cost class.
 *
 * This function exists because the first draft of this file hardcoded
 * `nondeductible_280e` for EVERY entity. That single wrong constant would have
 * overstated Michael's tax on the land and the ATM business every month it ran,
 * quietly, with the books balancing perfectly the whole time.
 */
export function interestCostClassFor(entityCode: EntityCode): CostClass {
  switch (entityCode) {
    case "greenway":
      // The trafficking business. A real expense; the deduction is denied.
      return "nondeductible_280e";
    case "landholding":
    case "atm":
      // Separate trades or businesses under CHAMP. §280E does not reach them.
      return "separate_business";
    case "personal":
      return "personal";
  }
}

/**
 * Build the journal for a loan payment. This is where deferred "PR C" — the
 * Timberland-to-loan matching that `todo.md` says was "deliberately deferred
 * until the GL exists, so matching posts a real journal entry instead of a
 * standalone link we'd rebuild later" — finally lands as a posting rule.
 *
 * Accounts used are the ones that already exist in migration 0173. Nothing here
 * is invented:
 *   10200  Bank — Operating          (asset, credited: money leaves)
 *   28000  is NOT used — see below.
 *
 * The caller supplies the liability and interest account codes because the
 * mortgage, the Jared note and any future Wells Fargo facility each have their
 * own accounts. Refusing to hardcode them is deliberate.
 */
export function buildLoanPaymentLines(args: {
  bankAmountCents: number; // Plaid convention (positive = out)
  entityCode: EntityCode;
  cashAccountCode: string;
  loanLiabilityAccountCode: string;
  interestExpenseAccountCode: string;
  escrowAssetAccountCode: string;
  split: { interestCents: number; principalCents: number; escrowCents: number };
}): LoanJournalLine[] {
  const { split } = args;
  const cash = plaidToLedgerCashCents(args.bankAmountCents);
  const lines: LoanJournalLine[] = [];

  if (split.interestCents > 0) {
    const klass = interestCostClassFor(args.entityCode);
    lines.push({
      accountCode: args.interestExpenseAccountCode,
      amountCents: split.interestCents, // debit — a real expense
      costClass: klass,
      description:
        klass === "nondeductible_280e"
          ? "Interest — an expense under IRC §163(a), but disallowed by §280E in the cannabis business"
          : "Interest — deductible under IRC §163(a)",
    });
  }
  if (split.principalCents > 0) {
    lines.push({
      accountCode: args.loanLiabilityAccountCode,
      amountCents: split.principalCents, // debit — the debt shrinks
      costClass: "none",
      description: "Principal — reduces the loan balance; not an expense",
    });
  }
  if (split.escrowCents > 0) {
    lines.push({
      accountCode: args.escrowAssetAccountCode,
      amountCents: split.escrowCents, // debit — still your money
      costClass: "none",
      description: "Escrow — held by the servicer for taxes and insurance",
    });
  }

  lines.push({
    accountCode: args.cashAccountCode,
    amountCents: cash, // credit — money left the bank
    costClass: "none",
    description: "Cash out of the operating account",
  });

  return lines;
}

/** Sum the signed cents of a set of lines. Zero means debits equal credits. */
export function sumLines(lines: LoanJournalLine[]): number {
  return lines.reduce((acc, l) => acc + l.amountCents, 0);
}

// ===========================================================================
// §10b  STRUCTURING SURVEILLANCE — the thing nobody warns a cash business about
// ===========================================================================

/**
 * The dollar figure that makes a bank file a Currency Transaction Report.
 *
 * 31 CFR 1010.311, verbatim:
 *   "Each financial institution other than a casino shall file a report of each
 *    deposit, withdrawal, exchange of currency or other payment or transfer, by,
 *    through, or to such financial institution which involves a transaction in
 *    currency of more than $10,000, except as otherwise provided in this
 *    section."
 */
export const CTR_THRESHOLD_CENTS = 1000000;

/**
 * Deposits within this much of the threshold are "just under" it. There is no
 * statutory band — the statute is about purpose, not amount — so this is a
 * review trigger, not a legal line.
 */
export const STRUCTURING_NEAR_MISS_CENTS = 100000; // $1,000 below the threshold

export type StructuringSignal = {
  /** Deposits that were large enough to be reported. Entirely normal. */
  reportableCount: number;
  /** Cash deposits landing in the $9,000–$10,000 band. */
  nearThresholdCount: number;
  nearThresholdTotalCents: number;
  /** True when the near-threshold pattern is worth the owner's attention. */
  worthReviewing: boolean;
  narrative: string[];
};

/**
 * Look at a run of cash deposits and tell Michael what an examiner would see.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE. This function is INFORMATIONAL. It
 * never blocks a posting and it never concludes anything, and both of those are
 * deliberate legal choices, not softness:
 *
 * 31 U.S.C. §5324(a) makes it an offence to "structure or assist in structuring
 * ... any transaction with one or more domestic financial institutions" — but
 * only when done "for the purpose of evading the reporting requirements". The
 * offence is in the PURPOSE. Amounts alone prove nothing: a shop that genuinely
 * takes about nine thousand dollars a day and banks it daily will produce a
 * column of $9,4xx deposits forever, entirely innocently, and that is Greenway's
 * actual profile as a cash-only retailer.
 *
 * The penalty for getting this wrong is not small — §5324(d)(1): "Whoever
 * violates this section shall be fined in accordance with title 18, United
 * States Code, imprisoned for not more than 5 years, or both."
 *
 * So the honest and useful thing for a bookkeeping system to do is neither to
 * accuse nor to stay silent. It is to show the owner the same pattern an
 * examiner will pull, at the time he can still remember why each deposit was the
 * size it was, rather than three years later when he cannot. Being unsurprised
 * is the entire defence.
 */
export function detectStructuringPattern(
  cashDeposits: ReadonlyArray<{ date: string; amountCents: number }>,
): StructuringSignal {
  let reportableCount = 0;
  let nearThresholdCount = 0;
  let nearThresholdTotalCents = 0;

  for (const d of cashDeposits) {
    if (!Number.isInteger(d.amountCents)) continue;
    // Deposits arrive as Plaid-negative (money in). Compare on magnitude.
    const magnitude = Math.abs(d.amountCents);
    if (magnitude > CTR_THRESHOLD_CENTS) {
      reportableCount += 1;
    } else if (magnitude >= CTR_THRESHOLD_CENTS - STRUCTURING_NEAR_MISS_CENTS) {
      nearThresholdCount += 1;
      nearThresholdTotalCents += magnitude;
    }
  }

  const worthReviewing = nearThresholdCount >= 3;
  const narrative: string[] = [];

  if (nearThresholdCount === 0) {
    narrative.push(
      "No pattern of deposits sitting just under the ten-thousand-dollar reporting line. Nothing to look at here.",
    );
  } else {
    narrative.push(
      `${nearThresholdCount} cash deposit(s) totalling ${formatCents(nearThresholdTotalCents)} landed between ${formatCents(CTR_THRESHOLD_CENTS - STRUCTURING_NEAR_MISS_CENTS)} and ${formatCents(CTR_THRESHOLD_CENTS)}.`,
    );
    narrative.push(
      "This is not an accusation and nothing is being blocked. Here is why you are being shown it: when a bank takes in more than $10,000 in cash it must file a report, and that is completely routine. What is a crime is arranging deposits to stay under that line on purpose — the law is about intent, not about the amount.",
    );
    narrative.push(
      "A shop that genuinely takes about nine thousand dollars a day and banks it every day will produce this exact pattern forever, innocently. That is most likely what this is. The reason to look now rather than later is simple: an examiner can pull this same list years from now, and you want to be the person who already knew about it and can say why, instead of seeing it for the first time across a table.",
    );
  }

  if (reportableCount > 0) {
    narrative.push(
      `${reportableCount} deposit(s) were over the line and will have been reported by the bank. That is normal and nothing needs doing — depositing large amounts of cash is lawful. Only avoiding the report is not.`,
    );
  }

  return {
    reportableCount,
    nearThresholdCount,
    nearThresholdTotalCents,
    worthReviewing,
    narrative,
  };
}

// ===========================================================================
// §11  FORMATTING — integer-only money rendering
// ===========================================================================

/** `123456` -> `"$1,234.56"`. Negative values keep their minus sign. */
export function formatCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const withCommas = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${withCommas}.${String(rem).padStart(2, "0")}`;
}

/** Like `formatCents`, but positives carry an explicit `+`. */
export function formatSignedCents(cents: number): string {
  if (cents > 0) return `+${formatCents(cents)}`;
  return formatCents(cents);
}

// ===========================================================================
// §12  VISUAL MODEL — the data the explainer screen draws
// ===========================================================================

export type ReconciliationBar = {
  label: string;
  cents: number;
  tone: "bank" | "books" | "gap";
  hint: string;
};

/**
 * Turn a reconciliation into the bars the UI draws. Kept here, in the pure
 * core, so the picture the owner looks at is computed by the same tested code
 * that decides whether things tie — not re-derived in a component where it
 * could drift away from the truth it is supposed to illustrate.
 */
export function reconciliationBars(r: ReconciliationResult): ReconciliationBar[] {
  const bars: ReconciliationBar[] = [
    {
      label: "Bank statement",
      cents: r.statementClosingCents,
      tone: "bank",
      hint: "What the bank says you had at the close of the period. This is the fact.",
    },
    {
      label: "Your books",
      cents: r.ledgerBalanceCents,
      tone: "books",
      hint: "What the ledger says. This is the claim.",
    },
  ];
  if (r.inBankNotBooksCents !== 0 || r.unrecordedItemCount > 0) {
    bars.push({
      label: "At the bank, not in the books",
      cents: r.inBankNotBooksCents,
      tone: "gap",
      hint: `${r.unrecordedItemCount} settled bank line(s) with no entry yet. Money that has already moved. Each one needs a journal entry — these do NOT clear themselves.`,
    });
  }
  if (r.inBooksNotBankCents !== 0) {
    bars.push({
      label: "In the books, not at the bank",
      cents: r.inBooksNotBankCents,
      tone: "gap",
      hint: "Entries that have not cleared — uncashed cheques, deposits in transit.",
    });
  }
  bars.push({
    label: r.ties ? "Unexplained (none)" : "Unexplained",
    cents: r.differenceCents,
    tone: "gap",
    hint: r.ties
      ? r.complete
        ? "Nothing left over and nothing left to write down. This is what a finished reconciliation looks like."
        : "The arithmetic closes, but this month is not finished — the bank lines above still need entries. Balancing is not the same as being complete."
      : "This is the number to chase. Never adjust it away.",
  });
  return bars;
}

// ===========================================================================
// §13  SELF-TESTS
// ===========================================================================

/**
 * Registered in scripts/compliance/run-pure-selftests.ts and mirrored in
 * tests/compliance/bank-match-core.test.ts.
 *
 * Standing rule 15: every test must be proven capable of failing. The mutation
 * harness scripts/compliance/mutate-slice-books-05.py does that proving.
 */
export function __runBankMatchCoreTests(): void {
  let checks = 0;
  const eq = <T>(actual: T, expected: T, what: string): void => {
    checks += 1;
    if (!Object.is(actual, expected)) {
      throw new Error(`bank-match-core: ${what} — expected ${String(expected)}, got ${String(actual)}`);
    }
  };
  const ok = (cond: boolean, what: string): void => {
    checks += 1;
    if (!cond) throw new Error(`bank-match-core: ${what}`);
  };

  // --- §3 the sign bridge --------------------------------------------------
  eq(plaidToLedgerCashCents(5000), -5000, "money out becomes a credit");
  eq(plaidToLedgerCashCents(-5000), 5000, "money in becomes a debit");
  eq(Object.is(plaidToLedgerCashCents(0), 0), true, "zero stays +0, never -0");
  eq(bankDirection(1), "money_out", "positive plaid = out");
  eq(bankDirection(-1), "money_in", "negative plaid = in");
  eq(bankDirection(0), "money_in", "zero treated as in");
  eq(bankMagnitudeCents(-7), 7, "magnitude is absolute");

  // The round trip must be an involution.
  for (const v of [-1000000, -1, 0, 1, 999999]) {
    eq(plaidToLedgerCashCents(plaidToLedgerCashCents(v)), v, `round trip preserves ${v}`);
  }

  let threw = false;
  try {
    plaidToLedgerCashCents(1.5);
  } catch {
    threw = true;
  }
  ok(threw, "a fractional cent is refused, not rounded");

  // --- §6 dates ------------------------------------------------------------
  eq(isoToDayNumber("1970-01-01"), 0, "epoch is day zero");
  eq(isoToDayNumber("2026-01-01"), 20454, "2026-01-01 day number");
  eq(daysApart("2026-11-01", "2026-11-06"), 5, "five days apart");
  eq(isoToDayNumber("2026-02-30"), null, "Feb 30 is not a date");
  eq(isoToDayNumber("2024-02-29"), 19782, "2024 is a leap year");
  eq(isoToDayNumber("2100-02-29"), null, "2100 is NOT a leap year");
  eq(isoToDayNumber("bad"), null, "garbage is rejected");
  eq(isoToDayNumber("2026-13-01"), null, "month 13 is rejected");
  ok(isOnOrAfterCutover("2026-01-01"), "the line itself is inclusive");
  ok(!isOnOrAfterCutover("2025-12-31"), "the day before is out");

  // --- §11 formatting ------------------------------------------------------
  eq(formatCents(0), "$0.00", "zero formats");
  eq(formatCents(1234567), "$12,345.67", "thousands separator");
  eq(formatCents(-500), "-$5.00", "negative keeps its sign");
  eq(formatSignedCents(500), "+$5.00", "positive gains a plus");
  eq(formatSignedCents(-500), "-$5.00", "negative unchanged");
  eq(formatCents(5), "$0.05", "sub-dollar pads");

  // --- §7 classification ---------------------------------------------------
  const dep = classifyBankRow(mkRow({ name: "BRANCH CASH DEPOSIT" }));
  eq(dep.kind, "deposit_of_sales", "a deposit is recognised");
  ok(dep.confidenceMilliPct <= 45000, "a descriptor never reaches certainty");
  const unk = classifyBankRow(mkRow({ name: "ZZQQ 8891" }));
  eq(unk.kind, "unknown", "gibberish stays unknown");
  eq(unk.confidenceMilliPct, 0, "unknown carries no confidence");

  // --- §8 the refusals -----------------------------------------------------
  const pendingV = evaluateMatch({
    row: mkRow({ pending: true }),
    candidate: null,
    eventKind: "bank_fee",
    entityCode: "greenway",
  });
  ok(!pendingV.postable, "a pending row cannot post");
  ok(hasCode(pendingV, "BANK_PENDING_ROW"), "pending is named");

  const removedV = evaluateMatch({
    row: mkRow({ removed: true }),
    candidate: null,
    eventKind: "bank_fee",
    entityCode: "greenway",
  });
  ok(hasCode(removedV, "BANK_REMOVED_ROW"), "a removed row is named");

  // The sign wall: same magnitude, wrong direction.
  const flipped = evaluateMatch({
    row: mkRow({ amountCents: 10000 }), // money OUT -> ledger -10000
    candidate: mkJournal({ cashLineCents: 10000 }), // a DEBIT
    eventKind: "vendor_payment",
    entityCode: "greenway",
  });
  ok(!flipped.postable, "a backwards match is refused");
  ok(hasCode(flipped, "BANK_SIGN_DISAGREES"), "the sign disagreement is named");

  const goodMatch = evaluateMatch({
    row: mkRow({ amountCents: 10000 }),
    candidate: mkJournal({ cashLineCents: -10000 }),
    eventKind: "vendor_payment",
    entityCode: "greenway",
  });
  ok(goodMatch.postable, "a correct match posts");
  eq(goodMatch.ledgerCashCents, -10000, "money out lands as a credit");

  const amountOff = evaluateMatch({
    row: mkRow({ amountCents: 10000 }),
    candidate: mkJournal({ cashLineCents: -10001 }),
    eventKind: "vendor_payment",
    entityCode: "greenway",
  });
  ok(hasCode(amountOff, "BANK_AMOUNT_MISMATCH"), "one cent off is still off");

  const transfer = evaluateMatch({
    row: mkRow({ amountCents: -5000, name: "ONLINE BANKING TRANSFER" }),
    candidate: null,
    eventKind: "own_transfer",
    entityCode: "greenway",
  });
  ok(!transfer.postable, "an unconfirmed transfer is refused");
  ok(hasCode(transfer, "BANK_TRANSFER_AS_INCOME"), "the transfer trap is named");

  const transferOk = evaluateMatch({
    row: mkRow({ amountCents: -5000 }),
    candidate: null,
    eventKind: "own_transfer",
    entityCode: "greenway",
    transferCounterpartyConfirmed: true,
  });
  ok(transferOk.postable, "a confirmed transfer posts");

  const dbl = evaluateMatch({
    row: mkRow({ amountCents: -100000 }),
    candidate: null,
    eventKind: "deposit_of_sales",
    entityCode: "greenway",
  });
  ok(hasCode(dbl, "BANK_DOUBLE_COUNT_RISK"), "creating income from a deposit is caught");

  const unclassified = evaluateMatch({
    row: mkRow({}),
    candidate: null,
    eventKind: "unknown",
    entityCode: "greenway",
  });
  ok(hasCode(unclassified, "BANK_UNCLASSIFIED"), "unknown is refused, not guessed");

  const entityX = evaluateMatch({
    row: mkRow({ amountCents: 100 }),
    candidate: mkJournal({ cashLineCents: -100, entityCode: "personal" }),
    eventKind: "vendor_payment",
    entityCode: "greenway",
  });
  ok(hasCode(entityX, "BANK_ENTITY_MISMATCH"), "commingling across entities is caught");

  const stale = evaluateMatch({
    row: mkRow({ amountCents: 100, date: "2026-11-01" }),
    candidate: mkJournal({ cashLineCents: -100, journalDate: "2026-06-01" }),
    eventKind: "vendor_payment",
    entityCode: "greenway",
  });
  ok(hasCode(stale, "BANK_DATE_TOO_FAR"), "a five-month gap is refused");

  const preCut = evaluateMatch({
    row: mkRow({ date: "2025-12-31" }),
    candidate: null,
    eventKind: "bank_fee",
    entityCode: "greenway",
    proposedCostClasses: ["nondeductible_280e"],
  });
  ok(hasCode(preCut, "BANK_PRE_CUTOVER"), "pre-cutover is refused");

  // --- D6: a garbage date must not be described as "before the cut-over" ---
  const badDate = evaluateMatch({
    row: mkRow({ date: "not-a-date" }),
    candidate: null,
    eventKind: "bank_fee",
    entityCode: "greenway",
    proposedCostClasses: ["nondeductible_280e"],
  });
  ok(hasCode(badDate, "BANK_INVALID_DATE"), "an unreadable date is named for what it is");
  ok(
    !hasCode(badDate, "BANK_PRE_CUTOVER"),
    "and is NOT mislabelled as pre-cutover — a confident wrong explanation is worse than none",
  );
  ok(!badDate.postable, "and it still cannot post");

  // --- D2: the BANK-ROW side of double-posting -----------------------------
  const rowUsed = evaluateMatch({
    row: mkRow({ amountCents: 10000 }),
    candidate: mkJournal({ cashLineCents: -10000 }),
    eventKind: "vendor_payment",
    entityCode: "greenway",
    bankRowAlreadyMatched: true,
  });
  ok(hasCode(rowUsed, "BANK_ALREADY_MATCHED"), "one bank line cannot feed two entries");
  ok(!rowUsed.postable, "and it is a refusal, not a warning");

  // The mirror image: the JOURNAL side. Both directions must be guarded, and
  // this test exists because the coverage check below caught that the engine
  // raised this code while nothing ever exercised it.
  const journalUsed = evaluateMatch({
    row: mkRow({ amountCents: 10000 }),
    candidate: mkJournal({ cashLineCents: -10000, alreadyMatched: true }),
    eventKind: "vendor_payment",
    entityCode: "greenway",
  });
  ok(
    hasCode(journalUsed, "BANK_JOURNAL_ALREADY_MATCHED"),
    "one entry cannot absorb two bank lines either",
  );
  ok(!journalUsed.postable, "and that is a refusal too");

  // --- D3: commingling — a personal cost inside a business entity ----------
  const commingled = evaluateMatch({
    row: mkRow({ amountCents: 15000 }),
    candidate: null,
    eventKind: "vendor_payment",
    entityCode: "greenway",
    proposedCostClasses: ["personal"],
  });
  ok(hasCode(commingled, "BANK_COMMINGLED"), "a personal cost in the shop's books is caught");
  const personalOk = evaluateMatch({
    row: mkRow({ amountCents: 15000 }),
    candidate: mkJournal({ cashLineCents: -15000, entityCode: "personal" }),
    eventKind: "vendor_payment",
    entityCode: "personal",
    proposedCostClasses: ["personal"],
  });
  ok(
    !hasCode(personalOk, "BANK_COMMINGLED"),
    "but a personal cost in the PERSONAL books is perfectly fine",
  );

  // --- D5: the §280E gate must catch the MISSING label, not just a bad one -
  const noClass = evaluateMatch({
    row: mkRow({ amountCents: 2500 }),
    candidate: null,
    eventKind: "bank_fee", // a P&L item that legitimately starts at the bank
    entityCode: "greenway",
    // proposedCostClasses deliberately omitted
  });
  ok(
    hasCode(noClass, "BANK_NO_COST_CLASS"),
    "an entry with NO 280E label is refused — this is the case the first draft let through",
  );
  ok(!noClass.postable, "and it cannot post");

  const withClass = evaluateMatch({
    row: mkRow({ amountCents: 2500 }),
    candidate: null,
    eventKind: "bank_fee",
    entityCode: "greenway",
    proposedCostClasses: ["nondeductible_280e"],
  });
  ok(withClass.postable, "the same fee posts once it is labelled");
  ok(
    !hasCode(withClass, "BANK_DOUBLE_COUNT_RISK"),
    "a bank fee is not a double-count risk — nothing upstream posts it",
  );

  // Untyped callers (JSON over RPC) can still smuggle in a bad value.
  const badClass = evaluateMatch({
    row: mkRow({ amountCents: 2500 }),
    candidate: null,
    eventKind: "bank_fee",
    entityCode: "greenway",
    proposedCostClasses: ["totally_made_up" as CostClass],
  });
  ok(hasCode(badClass, "BANK_NO_COST_CLASS"), "an unrecognised label is refused too");

  // Balance-sheet movements are not required to carry a cost class.
  const draw = evaluateMatch({
    row: mkRow({ amountCents: 50000 }),
    candidate: null,
    eventKind: "owner_draw",
    entityCode: "greenway",
  });
  ok(draw.postable, "an owner draw is a balance-sheet movement and needs no 280E label");

  // --- loan payments -------------------------------------------------------
  const loanNoSplit = evaluateMatch({
    row: mkRow({ amountCents: 250000, name: "CENLAR MORTGAGE" }),
    candidate: null,
    eventKind: "loan_payment",
    entityCode: "landholding",
  });
  ok(hasCode(loanNoSplit, "BANK_LOAN_SINGLE_LINE"), "a one-line loan payment is refused");

  const loanBadSplit = evaluateMatch({
    row: mkRow({ amountCents: 250000 }),
    candidate: null,
    eventKind: "loan_payment",
    entityCode: "landholding",
    loanSplit: { interestCents: 90000, principalCents: 150000, escrowCents: 1 },
  });
  ok(hasCode(loanBadSplit, "BANK_LOAN_SINGLE_LINE"), "a split that does not add up is refused");

  const loanGood = evaluateMatch({
    row: mkRow({ amountCents: 250000 }),
    candidate: null,
    eventKind: "loan_payment",
    entityCode: "landholding",
    loanSplit: { interestCents: 90000, principalCents: 150000, escrowCents: 10000 },
  });
  ok(loanGood.postable, "a correct three-way split posts");

  const loanNeg = evaluateMatch({
    row: mkRow({ amountCents: 250000 }),
    candidate: null,
    eventKind: "loan_payment",
    entityCode: "landholding",
    loanSplit: { interestCents: -1, principalCents: 250001, escrowCents: 0 },
  });
  ok(hasCode(loanNeg, "BANK_LOAN_SINGLE_LINE"), "a negative component is refused even when the total ties");

  const lines = buildLoanPaymentLines({
    bankAmountCents: 250000,
    entityCode: "landholding",
    cashAccountCode: "10200",
    loanLiabilityAccountCode: "34000",
    interestExpenseAccountCode: "85010",
    escrowAssetAccountCode: "12200",
    split: { interestCents: 90000, principalCents: 150000, escrowCents: 10000 },
  });
  eq(sumLines(lines), 0, "the loan journal balances to the penny");
  eq(lines.length, 4, "three pieces plus the cash line");
  eq(lines[lines.length - 1].amountCents, -250000, "cash is credited");
  ok(
    lines.some((l) => l.accountCode === "34000" && l.amountCents === 150000),
    "principal debits the liability, it is not an expense",
  );

  // --- D4: §280E must follow the ENTITY, not be hardcoded ------------------
  // CHAMP, 128 T.C. 173 (2007): a separate trade or business is outside §280E.
  eq(interestCostClassFor("greenway"), "nondeductible_280e", "the shop's interest is disallowed by 280E");
  eq(interestCostClassFor("landholding"), "separate_business", "the land is a separate business (CHAMP)");
  eq(interestCostClassFor("atm"), "separate_business", "the ATM business is separate (CHAMP)");
  eq(interestCostClassFor("personal"), "personal", "personal interest is not a business cost");

  const landInterest = lines.find((l) => l.accountCode === "85010");
  ok(landInterest !== undefined, "the landholding journal has an interest line");
  eq(
    landInterest?.costClass,
    "separate_business",
    "landholding mortgage interest is NOT disallowed — hardcoding 280E here overstates the tax",
  );

  const shopLines = buildLoanPaymentLines({
    bankAmountCents: 250000,
    entityCode: "greenway",
    cashAccountCode: "10200",
    loanLiabilityAccountCode: "34000",
    interestExpenseAccountCode: "85010",
    escrowAssetAccountCode: "12200",
    split: { interestCents: 90000, principalCents: 150000, escrowCents: 10000 },
  });
  eq(
    shopLines.find((l) => l.accountCode === "85010")?.costClass,
    "nondeductible_280e",
    "the shop's own interest IS disallowed",
  );
  eq(sumLines(shopLines), 0, "and that journal balances too");

  // --- §9 reconciliation ---------------------------------------------------
  const tie = reconcile({
    statementClosingCents: 100000,
    ledgerBalanceCents: 100000,
    unmatchedBankRows: [],
    unmatchedJournals: [],
  });
  ok(tie.ties, "a clean period ties");
  eq(tie.differenceCents, 0, "and the difference is zero");
  eq(tie.unrecordedItemCount, 0, "nothing unrecorded");
  ok(tie.complete, "and it is COMPLETE, not merely tied");
  ok(tie.readyToSignOff, "so it is safe to sign off");

  const withOutstanding = reconcile({
    statementClosingCents: 100000,
    ledgerBalanceCents: 95000,
    unmatchedBankRows: [mkRow({ amountCents: -5000 })], // +5000 to the ledger
    unmatchedJournals: [],
  });
  ok(withOutstanding.ties, "an unrecorded deposit explains the gap exactly");
  eq(withOutstanding.unrecordedItemCount, 1, "but it is still one real unrecorded item");
  ok(!withOutstanding.complete, "so this is NOT complete \u2014 ties is not the same as done (D8)");
  ok(!withOutstanding.readyToSignOff, "and it must not be offered for sign-off yet");

  const pendingIgnored = reconcile({
    statementClosingCents: 100000,
    ledgerBalanceCents: 100000,
    unmatchedBankRows: [mkRow({ amountCents: -99999, pending: true })],
    unmatchedJournals: [],
  });
  ok(pendingIgnored.ties, "a pending row does not move the reconciliation");

  const removedIgnored = reconcile({
    statementClosingCents: 100000,
    ledgerBalanceCents: 100000,
    unmatchedBankRows: [mkRow({ amountCents: -99999, removed: true })],
    unmatchedJournals: [],
  });
  ok(removedIgnored.ties, "a removed row does not move the reconciliation");

  // --- D1: THE DEFECT THAT WAS ACTUALLY IN THIS FILE -----------------------
  // The textbook uncashed cheque. Statement $1,000, books $900, one cheque for
  // $100 written but not yet cashed. Adjusted bank = 1000 - 100 = 900 = books.
  // IT TIES. The first draft reported a false -$100 gap because it adjusted the
  // books for outstanding bank items but never adjusted the bank for
  // outstanding book items.
  const outstandingCheque = reconcile({
    statementClosingCents: 100000,
    ledgerBalanceCents: 90000,
    unmatchedBankRows: [],
    unmatchedJournals: [mkJournal({ cashLineCents: -10000, memo: "cheque 1041" })],
  });
  eq(outstandingCheque.inBooksNotBankCents, -10000, "the uncashed cheque is seen");
  eq(outstandingCheque.adjustedBankCents, 90000, "the STATEMENT is adjusted for it");
  eq(outstandingCheque.adjustedLedgerCents, 90000, "the books are unchanged");
  eq(outstandingCheque.differenceCents, 0, "and there is no gap");
  ok(outstandingCheque.ties, "an uncashed cheque is NOT an unexplained difference");
  eq(outstandingCheque.unrecordedItemCount, 0, "a cheque in flight is NOT an unrecorded item");
  ok(outstandingCheque.complete, "a timing difference alone is a COMPLETE reconciliation");
  ok(outstandingCheque.readyToSignOff, "and it may be signed off");

  // --- D8: THE SECOND DEFECT THAT WAS ACTUALLY IN THIS FILE ----------------
  // Proven against live PostgreSQL. Books entirely empty; the bank shows one
  // $77.00 service fee nobody recorded. The arithmetic closes perfectly,
  // because the fee is added to the ledger side AND is already inside the
  // bank's closing balance, so it cancels itself. The old code said
  // "everything ties to the penny" while $77 of deductible expense was missing
  // from the profit and loss altogether. This test is the reason it cannot
  // say that again.
  const unrecordedFee = reconcile({
    statementClosingCents: -7700,
    ledgerBalanceCents: 0,
    unmatchedBankRows: [mkRow({ amountCents: 7700, name: "MONTHLY SERVICE FEE" })],
    unmatchedJournals: [],
  });
  eq(unrecordedFee.differenceCents, 0, "the arithmetic really does close");
  ok(unrecordedFee.ties, "so `ties` is honestly true \u2014 it describes arithmetic only");
  eq(unrecordedFee.unrecordedItemCount, 1, "but one bank line has no entry against it");
  eq(unrecordedFee.unrecordedItemCents, -7700, "and it is a $77.00 credit to cash");
  ok(!unrecordedFee.complete, "THE FIX: a balanced month with missing entries is NOT complete");
  ok(!unrecordedFee.readyToSignOff, "and must never be presented as ready to sign off");
  ok(
    !unrecordedFee.narrative.some((n) => n.includes("Everything ties to the penny")),
    "the narrative must NOT declare victory while an expense is missing from the books",
  );
  ok(
    unrecordedFee.narrative.some((n) => n.includes("not the same as being complete")),
    "it must say plainly that balancing is not the same as being finished",
  );
  ok(
    unrecordedFee.narrative.some((n) => n.includes("Do not sign this off yet")),
    "and it must tell the owner exactly what to do next",
  );

  // A deposit in transit: recorded in the books, not yet at the bank.
  const depositInTransit = reconcile({
    statementClosingCents: 100000,
    ledgerBalanceCents: 110000,
    unmatchedBankRows: [],
    unmatchedJournals: [mkJournal({ cashLineCents: 10000 })],
  });
  ok(depositInTransit.ties, "a deposit in transit also ties");
  eq(depositInTransit.adjustedBankCents, 110000, "the statement is brought up to it");

  // Both kinds outstanding at once, on both sides.
  const bothSides = reconcile({
    statementClosingCents: 100000,
    ledgerBalanceCents: 90000,
    unmatchedBankRows: [mkRow({ amountCents: 2000 })], // a fee: ledger -2000
    unmatchedJournals: [mkJournal({ cashLineCents: -12000 })], // uncashed cheque
  });
  eq(bothSides.adjustedLedgerCents, 88000, "books adjusted for the unrecorded fee");
  eq(bothSides.adjustedBankCents, 88000, "bank adjusted for the uncashed cheque");
  ok(bothSides.ties, "both adjustments applied, so it ties");
  eq(bothSides.unrecordedItemCount, 1, "the fee still needs an entry; the cheque does not");
  ok(!bothSides.complete, "so the month is not finished even though it balances");

  // A pending or removed row is not real, so it is not an unrecorded ITEM
  // either. Proving this matters: if pending rows counted, every reconciliation
  // would be permanently 'incomplete' and the flag would be ignored.
  eq(pendingIgnored.unrecordedItemCount, 0, "a pending row is not an unrecorded item");
  ok(pendingIgnored.complete, "so a period with only pending rows is complete");
  eq(removedIgnored.unrecordedItemCount, 0, "a removed row is not an unrecorded item");
  ok(removedIgnored.complete, "so a period with only removed rows is complete");

  const broken = reconcile({
    statementClosingCents: 100000,
    ledgerBalanceCents: 12345,
    unmatchedBankRows: [],
    unmatchedJournals: [],
  });
  ok(!broken.ties, "an unexplained gap is reported, not absorbed");
  eq(broken.differenceCents, -87655, "and reported exactly");
  ok(
    broken.narrative.some((n) => n.includes("4,624,697.31")),
    "the narrative names the historical plug so the lesson travels with the number",
  );

  // --- §12 bars ------------------------------------------------------------
  const bars = reconciliationBars(broken);
  ok(bars.length >= 3, "the picture has at least bank, books and the gap");
  ok(bars.some((b) => b.tone === "gap"), "the gap is drawn");

  // --- scoring -------------------------------------------------------------
  const exact = scoreMatch(mkRow({ amountCents: 10000 }), mkJournal({ cashLineCents: -10000 }));
  ok(exact.confidenceMilliPct >= 70000, "an exact same-day match scores high");
  const inverted = scoreMatch(mkRow({ amountCents: 10000 }), mkJournal({ cashLineCents: 10000 }));
  ok(
    inverted.confidenceMilliPct < exact.confidenceMilliPct,
    "a sign-inverted pairing scores BELOW the correct one",
  );
  ok(
    inverted.reasons.some((r) => r.includes("OPPOSITE")),
    "and says so in words the owner can read",
  );
  eq(clampMilliPct(-5), 0, "confidence never goes negative");
  eq(clampMilliPct(999999), 100000, "confidence never exceeds certainty");
  eq(clampMilliPct(Number.NaN), 0, "NaN confidence collapses to zero");

  // --- V1: structuring surveillance ----------------------------------------
  const clean = detectStructuringPattern([
    { date: "2026-11-02", amountCents: -250000 },
    { date: "2026-11-03", amountCents: -310000 },
  ]);
  eq(clean.nearThresholdCount, 0, "ordinary deposits raise nothing");
  ok(!clean.worthReviewing, "and nothing needs reviewing");

  const nearMiss = detectStructuringPattern([
    { date: "2026-11-02", amountCents: -940000 },
    { date: "2026-11-03", amountCents: -965000 },
    { date: "2026-11-04", amountCents: -912000 },
  ]);
  eq(nearMiss.nearThresholdCount, 3, "three deposits sit just under the line");
  eq(nearMiss.nearThresholdTotalCents, 2817000, "and are totalled exactly");
  ok(nearMiss.worthReviewing, "three in a row is worth a look");
  ok(
    nearMiss.narrative.some((n) => n.includes("not an accusation")),
    "the wording refuses to accuse — the statute is about purpose, not amount",
  );
  ok(
    nearMiss.narrative.some((n) => n.includes("innocently")),
    "and says plainly that this is most likely innocent",
  );

  const overLine = detectStructuringPattern([{ date: "2026-11-02", amountCents: -1200000 }]);
  eq(overLine.reportableCount, 1, "a large deposit is counted as reportable");
  eq(overLine.nearThresholdCount, 0, "and is NOT treated as near-threshold");
  ok(
    overLine.narrative.some((n) => n.includes("lawful")),
    "banking a lot of cash is lawful and the text says so",
  );
  eq(CTR_THRESHOLD_CENTS, 1000000, "the CTR threshold is $10,000 per 31 CFR 1010.311");

  // Exactly $10,000 is NOT over the line: the rule says "more than $10,000".
  const exactlyTen = detectStructuringPattern([{ date: "2026-11-02", amountCents: -1000000 }]);
  eq(exactlyTen.reportableCount, 0, "$10,000 exactly is not 'more than $10,000'");
  eq(exactlyTen.nearThresholdCount, 1, "it counts as near the threshold instead");

  // --- property sweep: the sign bridge over a wide range --------------------
  for (let i = -100000; i <= 100000; i += 977) {
    const led = plaidToLedgerCashCents(i);
    ok(Math.abs(led) === Math.abs(i), `magnitude preserved at ${i}`);
    if (i !== 0) ok(led !== i, `sign genuinely flips at ${i}`);
  }

  // --- EVERY DECLARED CODE MUST BE REACHABLE -------------------------------
  // Two codes in the first draft of this file were declared in the union and
  // never raised by anything: BANK_ALREADY_MATCHED and BANK_COMMINGLED. They
  // read like protections in a code review, and they protected nothing. This
  // check makes that class of lie impossible to repeat: if a code is added to
  // the union, some test above must have provoked it, or this fails.
  const provoked = new Set<string>();
  const collect = (v: MatchVerdict): void => {
    for (const f of v.findings) provoked.add(f.code);
  };
  for (const v of [
    pendingV, removedV, flipped, goodMatch, amountOff, transfer, transferOk,
    dbl, unclassified, entityX, stale, preCut, badDate, rowUsed, journalUsed,
    commingled, noClass, withClass, badClass, draw, loanNoSplit, loanBadSplit,
    loanGood, loanNeg, personalOk,
  ]) {
    collect(v);
  }
  // Provoked separately: it returns early, before any other check can run.
  collect(
    evaluateMatch({
      row: mkRow({ amountCents: 10.5 }),
      candidate: null,
      eventKind: "bank_fee",
      entityCode: "greenway",
    }),
  );

  for (const code of ALL_BANK_FINDING_CODES) {
    ok(
      provoked.has(code),
      `${code} is declared but no test provokes it — a refusal nothing can raise is not a control, it is a comment`,
    );
  }

  // --- §5b the authorities table ------------------------------------------
  // A table of verbatim federal and state text is only worth having if it is
  // guarded. Unguarded, it degrades exactly the way §1 warns about: someone
  // tidies a quotation, nothing fails, and Michael is left relying in a dispute
  // on a sentence that is not what the source actually says.
  {
    const ids = new Set<string>();
    for (const a of BANK_AUTHORITIES) {
      ok(a.id.trim().length > 0, "every authority carries a stable id");
      ok(!ids.has(a.id), `authority id ${a.id} is declared twice — a duplicate id makes lookup ambiguous`);
      ids.add(a.id);
      ok(a.cite.trim().length > 0, `${a.id} carries a formal citation`);

      // A quotation short enough to be a label is not a quotation. Every real
      // entry in this table is a full sentence or more; the shortest is
      // §163(a) at well over 80 characters.
      ok(
        a.quote.trim().length >= 60,
        `${a.id} quote is too short to be verbatim source text — a paraphrase wearing a citation is worse than no citation`,
      );

      // The plain-English gloss must actually say something. "See above" and
      // "N/A" are non-answers, and this whole file exists because Michael is
      // owed an explanation rather than a shrug.
      ok(
        a.soWhat.trim().length >= 60,
        `${a.id} soWhat is too short to explain anything to a non-accountant`,
      );

      // A citation with nowhere to read it cannot be checked by Michael, and an
      // authority he cannot check is one he has to take on faith.
      ok(
        /https?:\/\//.test(a.source),
        `${a.id} source has no URL — an authority that cannot be looked up cannot be verified`,
      );

      // D9 class: literal escape sequences in prose. This text goes straight to
      // a screen, so "\u00a7280E" would be read by Michael as those exact
      // characters rather than as §280E.
      ok(
        !/\\u[0-9a-fA-F]{4}/.test(a.quote + a.soWhat),
        `${a.id} contains a literal \\uXXXX escape — it would render as gibberish on the page`,
      );

      // SUBSTANCE, NOT JUST LENGTH.
      //
      // Added because mutant A7 SURVIVED the length check. Replacing the first
      // sentence of a gloss with "See above." left the remaining sentences long
      // enough to clear 60 characters, so a real degradation passed unnoticed.
      // Length alone cannot tell an explanation from a shrug — this is the same
      // hole found in gl-refusal-core, where "TODO" cleared a non-empty check.
      //
      // A cross-reference is not an explanation. Michael is reading THIS entry;
      // pointing him somewhere else is the one thing the mentor must never do.
      const gloss = a.soWhat.toLowerCase();
      for (const nonAnswer of [
        "see above",
        "see below",
        "as described elsewhere",
        "refer to the source",
        "n/a",
        "tbd",
        "todo",
        "self-explanatory",
      ]) {
        ok(
          !gloss.includes(nonAnswer),
          `${a.id} gloss contains the non-answer "${nonAnswer}" — a cross-reference is not an explanation`,
        );
      }
    }

    // Negative controls for the two guards above (standing rule 15b): prove
    // they actually discriminate rather than passing everything put to them.
    ok(
      !/https?:\/\//.test("IRM Part 4, Chapter 10"),
      "the source-URL guard genuinely rejects a citation with no link",
    );
    // The negative control for the escape scanner needs a string that CONTAINS
    // a literal backslash-u escape. Writing one out here would be a literal
    // escape sequence sitting in this file, which is the exact thing the
    // source-level D9 drift guard in the vitest mirror scans for and forbids —
    // two correct guards in direct conflict.
    //
    // Building it from a backslash and the letter "u" satisfies both: the
    // fixture is genuinely a "\u00a7" escape at runtime, and there is no
    // literal escape sequence in the source for the scanner to trip over.
    // Assembling test data is legitimate; suppressing either guard would not be.
    const D9_FIXTURE = `carrying on any trade or business under ${"\\"}u00a7280E`;
    ok(
      /\\u[0-9a-fA-F]{4}/.test(D9_FIXTURE),
      "the escape-sequence guard genuinely detects the D9 defect in authority text",
    );
    ok(
      "See above. The rest of this sentence is padding that clears any length floor."
        .toLowerCase()
        .includes("see above"),
      "the non-answer guard genuinely detects the A7 defect a length check let through",
    );

    // Anchor assertions on the exact words that carry the most weight. If any
    // of these sentences is ever "cleaned up", this fails loudly rather than
    // silently changing what Michael is told the law says.
    const mustSay: Array<[string, RegExp]> = [
      // The examiner's own stated purpose — item (d) is "whether cash is
      // deposited", which is the whole of Greenway's exposure in one clause.
      ["IRM_BANK_ANALYSIS_PURPOSE", /Determine whether cash is deposited/],
      // The consequence sentence: the examiner may reconstruct income himself.
      ["IRM_MISSTATEMENT_STAKES", /formal indirect method/],
      // The transfer trap that turns moving your own money into phantom income.
      ["IRM_TRANSFERS_IN", /transfers-in, and returned deposits need to be subtracted/],
      // (d) of the weak-controls list is the bank-fee trap, in the IRS's words.
      ["IRM_WEAK_CONTROLS", /Existing transactions are not recorded/],
      // "need to be recorded" — the verb behind the sign-off refusal.
      ["BARS_UNRECORDED_ITEMS", /need to be recorded in the accounting records/],
      // "no further differences" — the sentence a plug pretends to satisfy.
      ["BARS_NO_FURTHER_DIFFERENCES", /no further differences/],
      // Five-year retention, on premises, on demand.
      ["WAC_314_55_087_RECORDS", /five-year period/],
      // Trace back to source or forward to a total: a match, described by law.
      ["WAC_314_55_087_AUDIT_TRAIL", /trace any transaction back to the original source/],
      // CHAMP's operative words — the reason the building and ATM are safe.
      ["CHAMP_SEPARATE_BUSINESS", /separate and apart from/],
      // §280E reaches a trade or business, not a person.
      ["IRC_280E_TRAFFICKING", /consists of trafficking in controlled substances/],
      // Structuring turns on PURPOSE, which is why we never accuse.
      ["USC_31_5324_STRUCTURING", /for the purpose of evading the reporting requirements/],
      // The burden of proof is Michael's.
      ["REG_1_6001_1_RECORDS", /sufficient to establish the amount of gross income/],
      // Interest is deductible; the other two thirds of a mortgage payment are not.
      ["IRC_163_A_INTEREST", /all interest paid or accrued within the taxable year/],
    ];
    for (const [id, re] of mustSay) {
      const a = findBankAuthority(id);
      ok(a !== undefined, `authority ${id} is missing from BANK_AUTHORITIES`);
      ok(
        a !== undefined && re.test(a.quote),
        `${id} no longer contains its load-bearing words (${String(re)}) — the quotation has drifted from the source`,
      );
    }

    // Every id named above must exist, and every authority in the table must be
    // anchored by one of them. Otherwise an entry could be added, rendered to
    // Michael, and never checked by anything.
    for (const a of BANK_AUTHORITIES) {
      ok(
        mustSay.some(([id]) => id === a.id),
        `${a.id} is in the table but has no anchor assertion — unguarded verbatim text will drift`,
      );
    }

    eq(findBankAuthority("NO_SUCH_AUTHORITY"), undefined, "unknown authority id returns undefined");

    // The four §280E-relevant entities depend on CHAMP being read correctly.
    const champ = findBankAuthority("CHAMP_SEPARATE_BUSINESS");
    ok(
      champ !== undefined && /163\(a\)/.test(champ.soWhat),
      "the CHAMP gloss points at §163(a) — the deduction the separate-business holding actually unlocks",
    );
  }

  if (checks < 140) {
    throw new Error(`bank-match-core: expected at least 140 assertions, ran ${checks}`);
  }
}

/**
 * The runtime mirror of the `BankFindingCode` union.
 *
 * A TypeScript union evaporates at runtime, so nothing can iterate it. This
 * array is the iterable copy, and the `satisfies` clause below plus the
 * exhaustiveness check make the two impossible to drift apart: add a code to the
 * union without adding it here and the build fails; add one here that is not in
 * the union and the build fails.
 */
export const ALL_BANK_FINDING_CODES = [
  "BANK_PENDING_ROW",
  "BANK_REMOVED_ROW",
  "BANK_SIGN_DISAGREES",
  "BANK_AMOUNT_MISMATCH",
  "BANK_ALREADY_MATCHED",
  "BANK_JOURNAL_ALREADY_MATCHED",
  "BANK_DATE_TOO_FAR",
  "BANK_ENTITY_MISMATCH",
  "BANK_TRANSFER_AS_INCOME",
  "BANK_DOUBLE_COUNT_RISK",
  "BANK_LOAN_SINGLE_LINE",
  "BANK_NO_COST_CLASS",
  "BANK_UNCLASSIFIED",
  "BANK_NON_INTEGER_CENTS",
  "BANK_PRE_CUTOVER",
  "BANK_INVALID_DATE",
  "BANK_COMMINGLED",
] as const satisfies ReadonlyArray<BankFindingCode>;

/**
 * Compile-time proof that the array above covers the union completely.
 * If a member of `BankFindingCode` is missing from `ALL_BANK_FINDING_CODES`,
 * this assignment stops type-checking.
 */
const _codeCoverageProof: BankFindingCode extends (typeof ALL_BANK_FINDING_CODES)[number]
  ? true
  : never = true;
void _codeCoverageProof;

function hasCode(v: MatchVerdict, code: BankFindingCode): boolean {
  return v.findings.some((f) => f.code === code);
}

function mkRow(over: Partial<BankRow>): BankRow {
  return {
    transactionId: "tx_1",
    accountId: "acct_1",
    amountCents: -10000,
    date: "2026-11-02",
    name: "TEST",
    merchantName: null,
    pending: false,
    removed: false,
    categoryPrimary: null,
    ...over,
  };
}

function mkJournal(over: Partial<JournalCandidate>): JournalCandidate {
  return {
    journalId: "j_1",
    entityCode: "greenway",
    journalDate: "2026-11-02",
    cashLineCents: 10000,
    cashAccountCode: "10200",
    memo: "test",
    sourceKind: "bank",
    alreadyMatched: false,
    ...over,
  };
}
