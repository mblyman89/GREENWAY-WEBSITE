/**
 * src/lib/accounting/related-party-loan-core.ts   (books-76)
 *
 * MICHAEL'S DECISION, TURNED INTO POSTINGS AND INTO A LIST OF WHAT IS MISSING.
 *
 * THE DECISION. Verbatim: "I want to classify the cash in the atm as a loan. It
 * doesn't need to be interest bearing or have a term limit, but I suppose I
 * could create a contract spelling out the cash loan and repayment method."
 *
 * That closes D-41, whose census verdict said in as many words that it "closes
 * when Michael confirms whether the money is expected to be repaid." He has
 * confirmed. This module is what the confirmation buys.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE IS FOR, IN ONE PARAGRAPH
 * ---------------------------------------------------------------------------
 *
 * Three different kinds of money move through the ATM bank account (6228) and
 * they were being treated as one thing. books-75 measured them and D-57 wrote
 * them down: SETTLEMENT money that belongs to cardholders and is merely in the
 * ATM's custody ($526,620.00 measured), SURCHARGE money that is the ATM's own
 * revenue ($16,272.50 measured), and the SWEEPS to the cannabis account
 * ($526,937.58 measured) which is the flow Michael has now labelled a loan.
 * Booking all of it as ATM income would overstate that entity's income by 33.4x.
 * `splitAtmCircuit` refuses to let the three be conflated. Everything else here
 * exists to answer the question the label immediately raises: if it is a loan,
 * what does the law require, and can this codebase currently deliver it?
 *
 * ---------------------------------------------------------------------------
 * THE ANSWER TO THAT LAST QUESTION IS NO, AND SAYING SO IS THE DELIVERABLE
 * ---------------------------------------------------------------------------
 *
 * Standing rule 43: a refusal code that no code path emits is decoration. The
 * companion failure is quieter — a computation that returns a number it had no
 * business computing. Both were live here, and both were MEASURED, not guessed:
 *
 *   * `loan-core.ts` offers `kind: "interest_free"` and hard-zeroes the monthly
 *     rate for it. So the existing engine cannot represent an imputed rate at
 *     all; "interest free" is treated as a permanent property of the loan
 *     rather than as a description of what the lender chose to charge.
 *
 *   * A probe run against the real engine with Michael's terms
 *     (`termMonths: 0`, because he said no term limit) returned ZERO schedule
 *     rows and ZERO total interest. Not an error — a clean, confident, empty
 *     answer. A demand loan is unrepresentable, and the engine does not say so.
 *
 *   * `FEDERAL_SHORT_TERM_RATES` in `interest-rates-evidenced.ts` is EMPTY, on
 *     purpose, because nobody has supplied the revenue rulings. That is the
 *     correct state. It also means the AFR this loan needs cannot be looked up
 *     today, and any interest figure produced right now would be invented.
 *
 * So this module does not compute imputed interest. It computes the REQUIREMENT
 * for imputed interest, states the inputs that requirement needs, and refuses
 * with a specific code naming whichever input is absent. When the rulings are
 * loaded and the loan is documented, the same function starts answering. That
 * is the D-52 parameterized-door pattern: the door is real, and it is locked
 * for stated reasons rather than nailed shut behind a comment.
 *
 * ---------------------------------------------------------------------------
 * 36000 VERSUS 34000 — DECIDED ON MEASURED GROUNDS, NOT PREFERENCE
 * ---------------------------------------------------------------------------
 *
 * Two seeded accounts could hold this balance and the choice is not cosmetic:
 *
 *   34000 Notes & Loans Payable — the chart comment (migration 0173, verbatim)
 *         is 'CONTROL, driven by the loan subledger and its amortization
 *         schedule.' It is a CONTROL account. Posting to it requires a loan
 *         subledger row and a schedule. Michael's loan has no term, so it has
 *         no amortization schedule, so the subledger that drives 34000 cannot
 *         be built for it. Routing here would mean inventing a term.
 *
 *   36000 Due To / From Related Entity — chart comment, verbatim: 'Intercompany
 *         between greenway / atm / landholding / personal. Must net to ZERO
 *         across all four on consolidation — a standing close check.'
 *
 * 36000 wins on the measured ground that it is the only one of the two that can
 * hold a balance with no schedule, and on a second ground that books-74 already
 * established: the net-to-zero close check makes 36000 a MEASURING INSTRUMENT.
 * A due-from that cycles is evidence of two businesses dealing with each other.
 * One that only ever ratchets upward is evidence of a single unified enterprise,
 * which is the exhibit against him under Alternative Health Care Advocates, 151
 * T.C. No. 13 (2018). Michael's entities, in his words, "exist solely to
 * mitigate 280E", so which account this sits in is itself part of the record.
 *
 * If the loan is ever given a real term and a real schedule, 34000 becomes
 * correct and `loanControlAccountFor` says so rather than being edited.
 *
 * ---------------------------------------------------------------------------
 * PURITY
 * ---------------------------------------------------------------------------
 *
 * Zero imports. No clock, no I/O, no randomness. Money is integer cents. Rates
 * are integer milli-percent, matching `manual_loans.rate_milli_pct`. Every
 * function is total: it returns a value or a refusal, never a throw, except the
 * self-test runner at the bottom.
 *
 * TARGET IS ES2017. The `/s` (dotAll) regex flag is forbidden repo-wide and is
 * not used here; there are no regexes in this file at all.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * 1) THE ENTITIES AND THE ACCOUNTS
 * ══════════════════════════════════════════════════════════════════════════ */

/** The four sets of books. Mirrors `expense-classification-core.ts`. */
export type LoanEntity = "greenway" | "atm" | "landholding" | "personal";

export const LOAN_ENTITIES: readonly LoanEntity[] = [
  "greenway",
  "atm",
  "landholding",
  "personal",
];

/**
 * Accounts this module is allowed to name. Each was read from migration
 * 0173_chart_of_accounts.sql; the test drift-checks every one against that file
 * so a renamed or dropped account fails the build instead of failing silently.
 */
export const RELATED_PARTY_LOAN_ACCOUNTS = {
  /** Cash — Clearing / In Transit. "Must clear to zero at close." */
  CLEARING: "10900",
  /** Bank — ATM Vault Account. CONTROL. */
  ATM_VAULT: "10300",
  /** Bank — Operating (the 6048 side of the sweep). */
  OPERATING: "10200",
  /** ATM Surcharge Income. The ATM entity's own revenue. */
  SURCHARGE_INCOME: "51000",
  /** Notes & Loans Payable. CONTROL, needs a subledger + schedule. */
  NOTES_PAYABLE: "34000",
  /** Due To / From Related Entity. Must net to ZERO across all four. */
  DUE_TO_FROM: "36000",
  /** Interest Expense. */
  INTEREST_EXPENSE: "85010",
  /** Shareholder Contributions — where a non-bona-fide "loan" IN lands. */
  CONTRIBUTIONS: "41100",
  /** Shareholder Distributions — where a non-bona-fide "loan" OUT lands. */
  DISTRIBUTIONS: "41000",
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * 2) THE THREE FLOWS THROUGH THE ATM ACCOUNT (D-57)
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * What a given dollar moving through account 6228 actually IS.
 *
 * These three were measured in books-75 and written down as D-57. The reason
 * they need a type rather than a comment is that they look identical in the
 * bank feed — three deposits, same account, same shape — and only their meaning
 * differs. Meaning that lives only in someone's head gets lost.
 */
export type AtmFlowKind =
  /**
   * Cardholder money. The ATM dispensed cash to a stranger and the network
   * settles that amount back. It was never the ATM's, it is merely in its
   * custody. Belongs in 10900 and must clear to zero.
   */
  | "settlement_custody"
  /**
   * The surcharge the cardholder paid for using the machine. This IS the ATM
   * entity's revenue — taxable, and B&O at the .015000 service rate, NOT the
   * .00471 retailing rate, and not touched by §280E because the ATM is not a
   * cannabis business.
   */
  | "surcharge_revenue"
  /**
   * A sweep from the ATM account to the cannabis operating account. This is the
   * flow Michael has now labelled a loan.
   */
  | "loan_advance"
  /**
   * Cash moving back the other way, reducing the outstanding balance. Applied
   * FIFO against the oldest advance per §1.482-2(a)(1)(iv)(A).
   */
  | "loan_repayment";

export const ATM_FLOW_KINDS: readonly AtmFlowKind[] = [
  "settlement_custody",
  "surcharge_revenue",
  "loan_advance",
  "loan_repayment",
];

/**
 * The figures books-75 measured, restated here so the split can be tested
 * against real numbers rather than invented ones. Source: D-57 in
 * docs/DEFECTS.md, produced by scripts/recon/atm-custody-measure.py.
 */
export const MEASURED_SETTLEMENT_CENTS = 52_662_000;
export const MEASURED_SURCHARGE_CENTS = 1_627_250;
export const MEASURED_SWEEP_CENTS = 52_693_758;

/**
 * The overstatement D-57 found, to one decimal place, expressed in tenths so it
 * stays an integer: booking the whole circuit as ATM revenue instead of only
 * the surcharge overstates that entity's income by 33.4x.
 */
export const MEASURED_OVERSTATEMENT_TENTHS = 334;

export type AtmCircuitInput = {
  readonly settlementCents: number;
  readonly surchargeCents: number;
  readonly sweepCents: number;
};

export type AtmCircuitSplit = {
  /** Custody. Not income. Not the loan. 10900. */
  readonly custodyCents: number;
  readonly custodyAccount: string;
  /** Real revenue of a non-cannabis entity. 51000. */
  readonly revenueCents: number;
  readonly revenueAccount: string;
  /** The loan. 36000 (see loanControlAccountFor). */
  readonly loanCents: number;
  /**
   * What the naive treatment would have called ATM income, and the multiple by
   * which it overstates. Carried so the number appears in output, not prose.
   */
  readonly naiveRevenueCents: number;
  readonly overstatementTenths: number;
};

/**
 * Split the ATM circuit into its three economically distinct parts.
 *
 * Pure arithmetic, but the arithmetic is not the point — the point is that
 * three numbers which arrive looking alike leave labelled, and that the
 * overstatement is computed and returned rather than described.
 *
 * `overstatementTenths` is guarded: if surcharge is zero the multiple is
 * undefined, and 0 is returned rather than Infinity, because Infinity would
 * serialise to null in JSON and vanish.
 */
export function splitAtmCircuit(input: AtmCircuitInput): AtmCircuitSplit {
  const settlement = Math.trunc(input.settlementCents);
  const surcharge = Math.trunc(input.surchargeCents);
  const sweep = Math.trunc(input.sweepCents);

  const naive = settlement + surcharge;
  const tenths =
    surcharge > 0 ? Math.round((naive * 10) / surcharge) : 0;

  return {
    custodyCents: settlement,
    custodyAccount: RELATED_PARTY_LOAN_ACCOUNTS.CLEARING,
    revenueCents: surcharge,
    revenueAccount: RELATED_PARTY_LOAN_ACCOUNTS.SURCHARGE_INCOME,
    loanCents: sweep,
    naiveRevenueCents: naive,
    overstatementTenths: tenths,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3) IS IT A LOAN AT ALL? — §1.482-2(a)(1)(ii)(B)
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The facts that decide whether an "alleged indebtedness" is bona fide.
 *
 * Every field is a fact about the world, deliberately NOT a judgement. The
 * judgement is `assessBonaFide`'s job, so that changing the standard changes one
 * function rather than the meaning of stored data.
 *
 * Michael's answers as of books-76 are recorded in `MICHAELS_ATM_LOAN_AS_STATED`
 * below. Everything he has not answered is `null`, never `false` — the two are
 * different and collapsing them is how "not asked" becomes "no".
 */
export type BonaFideFacts = {
  /** Is there a signed note or written agreement? */
  readonly hasWrittenInstrument: boolean | null;
  /** Does the agreement state a rate of interest? */
  readonly statesInterestRate: boolean | null;
  /** Is there a maturity date or a stated term? */
  readonly hasMaturityDate: boolean | null;
  /** Is there a repayment schedule or a stated repayment method? */
  readonly hasRepaymentSchedule: boolean | null;
  /** Have repayments actually been made? Conduct, not intent. */
  readonly hasActualRepayments: boolean | null;
  /**
   * Does the balance move BOTH directions over time, or only ratchet up?
   * The books-74 measuring-instrument point, reduced to a fact.
   */
  readonly balanceCyclesBothWays: boolean | null;
  /** Is the outstanding balance tracked anywhere at all? */
  readonly balanceIsTracked: boolean | null;
  /** Was demand ever made, or the loan otherwise enforced? */
  readonly demandEverMade: boolean | null;
};

/**
 * Michael's ATM loan exactly as he has described it, and nothing more.
 *
 * This is EVIDENCE, not design. It is what he said, transcribed. Two fields are
 * `null` rather than `false` because he has not been asked, and one — the
 * contract — is `false` today because he said "I suppose I could create" one,
 * which is an intention and not an instrument.
 */
export const MICHAELS_ATM_LOAN_AS_STATED: BonaFideFacts = {
  // "I suppose I could create a contract" — offered, not written.
  hasWrittenInstrument: false,
  // "It doesn't need to be interest bearing."
  statesInterestRate: false,
  // "or have a term limit."
  hasMaturityDate: false,
  // The contract he offered would spell out "the cash loan and repayment
  // method", so today there is none.
  hasRepaymentSchedule: false,
  // books-75: "When one account needs cash, I move it there. If the other needs
  // cash, I move it back." Cash does go back, so this is true as CONDUCT.
  hasActualRepayments: true,
  // Same sentence: it moves both ways. This is the fact that helps him most.
  balanceCyclesBothWays: true,
  // Not asked. Sage holds no due-to/due-from account (books-73 measured 288
  // accounts, none of them intercompany), so this is probably false — but
  // "probably" is a guess and rule 1 forbids recording it as an answer.
  balanceIsTracked: null,
  // Not asked.
  demandEverMade: null,
};

export type BonaFideVerdict = "BONA_FIDE" | "NOT_BONA_FIDE" | "UNDETERMINED";

export type BonaFideAssessment = {
  readonly verdict: BonaFideVerdict;
  /** Which facts point toward a real loan. */
  readonly supporting: readonly string[];
  /** Which facts point away from one. */
  readonly undermining: readonly string[];
  /** Which facts have simply not been established. */
  readonly unknown: readonly string[];
  /**
   * If the substance is not indebtedness, what it is instead — the two the
   * regulation names by example. Null when the verdict is not NOT_BONA_FIDE.
   */
  readonly substanceIfNotDebt: "contribution_to_capital" | "distribution" | null;
};

/**
 * Weigh the facts against §1.482-2(a)(1)(ii)(B).
 *
 * NOT a scoring model. There is no threshold to tune, because a number would
 * imply a precision the regulation does not have — it says "not in fact a bona
 * fide indebtedness" and leaves that to facts and circumstances. What this does
 * is sort the facts into three honest piles and refuse to conclude while a
 * relevant one is missing. UNDETERMINED is the expected answer today, and it is
 * the right answer; a system that returned BONA_FIDE here would be telling
 * Michael he is safe on the strength of questions nobody asked him.
 *
 * `direction` decides which substance the money would fall into if it is not
 * debt, because that is not symmetric: money INTO the entity that is not a loan
 * is a capital contribution (it raises basis, it is not taxable, it is not
 * coming back); money OUT that is not a loan is a distribution (taxable to the
 * extent it exceeds basis). Same facts, opposite tax result, so the caller must
 * state which way the money went.
 */
export function assessBonaFide(
  facts: BonaFideFacts,
  direction: "in" | "out",
): BonaFideAssessment {
  const supporting: string[] = [];
  const undermining: string[] = [];
  const unknown: string[] = [];

  const weigh = (
    value: boolean | null,
    ifTrue: string,
    ifFalse: string,
    ifNull: string,
  ): void => {
    if (value === null) unknown.push(ifNull);
    else if (value) supporting.push(ifTrue);
    else undermining.push(ifFalse);
  };

  weigh(
    facts.hasWrittenInstrument,
    "There is a written instrument.",
    "There is no written note. §1.482-2(a)(1)(ii)(A) says a writing is not required, so this is not fatal by itself — but with no writing, conduct has to carry the whole weight.",
    "Nobody has established whether a written note exists.",
  );
  weigh(
    facts.statesInterestRate,
    "A rate of interest is stated.",
    "No rate of interest is stated, which is the express trigger in §1.482-2(a)(1)(i) and forces the AFR imputation in (a)(2)(iii)(B)(2).",
    "Nobody has established whether a rate is stated.",
  );
  weigh(
    facts.hasMaturityDate,
    "There is a maturity date.",
    "There is no maturity date, so this is a DEMAND loan and the daily Federal short-term rate of (a)(2)(iii)(C) applies instead of a single fixed rate.",
    "Nobody has established whether there is a maturity date.",
  );
  weigh(
    facts.hasRepaymentSchedule,
    "There is a repayment schedule.",
    "There is no repayment schedule or stated repayment method.",
    "Nobody has established whether a repayment method is stated.",
  );
  weigh(
    facts.hasActualRepayments,
    "Repayments have actually been made — conduct, which outweighs paperwork.",
    "No repayment has ever been made, which is the single strongest fact against calling this debt.",
    "Nobody has established whether repayments have been made.",
  );
  weigh(
    facts.balanceCyclesBothWays,
    "The balance moves both directions, which evidences two entities dealing with each other rather than one pocket.",
    "The balance only ratchets in one direction, which is the exhibit for a single unified enterprise under Alternative Health Care Advocates.",
    "Nobody has established whether the balance cycles or only ratchets.",
  );
  weigh(
    facts.balanceIsTracked,
    "The outstanding balance is tracked.",
    "The outstanding balance is not tracked anywhere, so there is no amount that could be demanded.",
    "Nobody has established whether the balance is tracked.",
  );
  weigh(
    facts.demandEverMade,
    "Demand has been made or the loan otherwise enforced.",
    "Demand has never been made. On a demand loan that is the enforcement mechanism, so never using it is meaningful.",
    "Nobody has established whether demand has ever been made.",
  );

  // Rule 48: a check that cannot classify its input must fail, not guess. An
  // open question outranks a favourable tally, so UNKNOWN is checked FIRST.
  if (unknown.length > 0) {
    return {
      verdict: "UNDETERMINED",
      supporting,
      undermining,
      unknown,
      substanceIfNotDebt: null,
    };
  }

  // With every fact in hand, the two that carry real weight are conduct:
  // whether money actually comes back, and whether the balance is tracked so
  // that "the balance" is a thing at all. Paperwork cannot substitute for
  // either — (a)(1)(ii)(B) says the safe haven cannot save a loan that is not
  // bona fide even when the stated rate is perfect.
  const conductSupportsDebt =
    facts.hasActualRepayments === true && facts.balanceIsTracked === true;

  if (!conductSupportsDebt) {
    return {
      verdict: "NOT_BONA_FIDE",
      supporting,
      undermining,
      unknown,
      substanceIfNotDebt:
        direction === "in" ? "contribution_to_capital" : "distribution",
    };
  }

  return {
    verdict: "BONA_FIDE",
    supporting,
    undermining,
    unknown,
    substanceIfNotDebt: null,
  };
}

/**
 * What the contract Michael offered to write has to contain to move the facts
 * above from UNDETERMINED to BONA_FIDE.
 *
 * Ordered by how much each item helps, most first. Item 2 is the one that
 * eliminates an entire category of exposure for the price of one sentence.
 */
export const CONTRACT_REQUIREMENTS: readonly {
  readonly item: string;
  readonly why: string;
  readonly cite: string;
}[] = [
  {
    item: "A stated principal amount, or a stated maximum advance under a revolving line.",
    why:
      "A loan whose amount nobody can state is not a loan anybody could demand repayment of. " +
      "Because Michael moves cash whichever way the need runs, the honest instrument is a " +
      "revolving line with a ceiling, not a fixed note for one number.",
    cite: "26 C.F.R. §1.482-2(a)(1)(ii)(B)",
  },
  {
    item:
      "A stated rate of interest of at least 100% of the applicable Federal short-term rate, " +
      "compounded semiannually, floating with each quarter's published rate.",
    why:
      "This is the highest-value sentence in the document. It puts the loan inside the 100%-130% " +
      "safe haven, so the imputation in (a)(2)(iii)(B)(2) never happens and no examiner has to be " +
      "persuaded that the rate was reasonable. Stating the rate as a FORMULA rather than a number " +
      "means it stays inside the safe haven when the AFR moves, without amending the contract.",
    cite: "26 C.F.R. §1.482-2(a)(2)(iii)(B)",
  },
  {
    item: "A repayment method — even 'payable on demand' — and an actual practice of honouring it.",
    why:
      "Michael said the contract would spell out 'the cash loan and repayment method', which is " +
      "exactly right. 'Payable on demand' is a real term and is enough. What it costs is that " +
      "demand must be capable of being made and met; a demand that would bankrupt the borrower is " +
      "evidence the parties never meant it.",
    cite: "26 C.F.R. §1.482-2(a)(2)(iii)(C)",
  },
  {
    item: "A running balance, maintained contemporaneously, with each advance and repayment dated.",
    why:
      "The dates are not bookkeeping neatness — they are the input to the FIFO rule, which is how " +
      "the age of the outstanding balance gets computed rather than asserted later. This is also " +
      "the item the app can produce automatically once the loan is on the ledger, which is why this " +
      "slice puts it there.",
    cite: "26 C.F.R. §1.482-2(a)(1)(iv)(A)",
  },
  {
    item: "Signature by both entities, with the signer's capacity named on each side.",
    why:
      "Michael controls both sides, so the same human signs twice. That is permitted and ordinary. " +
      "Naming the capacity — as Member of the ATM entity, as Member of Greenway — is what shows two " +
      "parties contracted, rather than one person writing himself a memo.",
    cite: "26 C.F.R. §1.482-2(a)(1)(ii)(A)",
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * 4) WHICH ACCOUNT HOLDS IT — 36000 vs 34000
 * ══════════════════════════════════════════════════════════════════════════ */

export type LoanControlChoice = {
  readonly account: string;
  readonly reason: string;
  /** True when the choice requires a loan subledger row + amortization schedule. */
  readonly requiresSubledger: boolean;
};

/**
 * Choose between 36000 and 34000 on the facts, never on preference.
 *
 * The deciding fact is whether an amortization schedule can exist. 34000's own
 * chart comment says it is 'driven by the loan subledger and its amortization
 * schedule' — so a loan with no term cannot legitimately live there, because
 * the thing that drives the account cannot be built. Michael's loan has no
 * term, so today the answer is 36000. If he ever gives it a term, this function
 * returns 34000 without anyone editing it, which is the difference between a
 * decision and a hardcoded constant.
 */
export function loanControlAccountFor(facts: BonaFideFacts): LoanControlChoice {
  if (facts.hasMaturityDate === true && facts.hasRepaymentSchedule === true) {
    return {
      account: RELATED_PARTY_LOAN_ACCOUNTS.NOTES_PAYABLE,
      reason:
        "The loan has a term and a repayment schedule, so an amortization schedule exists and the " +
        "loan subledger that drives 34000 can be built. 34000 is a CONTROL account and this is what " +
        "it is for.",
      requiresSubledger: true,
    };
  }

  return {
    account: RELATED_PARTY_LOAN_ACCOUNTS.DUE_TO_FROM,
    reason:
      "The loan has no term and no repayment schedule, so no amortization schedule exists and the " +
      "subledger that drives 34000 cannot be built for it — routing there would mean inventing a " +
      "term. 36000 holds an intercompany balance without one, and its net-to-zero close check makes " +
      "it a measuring instrument: a balance that cycles evidences two businesses, a balance that " +
      "only ratchets evidences one.",
    requiresSubledger: false,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5) IMPUTED INTEREST — THE REQUIREMENT, AND WHY IT CANNOT BE COMPUTED YET
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Term buckets from §1.482-2(a)(2)(iii)(C). A demand loan is its own case and
 * does not use the term table.
 */
export type AfrTermClass = "short_term" | "mid_term" | "long_term" | "demand";

/**
 * Classify which Federal rate applies.
 *
 * Straight from (a)(2)(iii)(C): 3 years or less → short-term; over 3 but not
 * over 9 → mid-term; over 9 → long-term; no term at all → demand, which takes
 * the short-term rate but on a DAILY basis, which is why it is a separate case
 * and not folded into "short_term". Conflating them would silently turn a
 * moving daily series into one fixed annual number.
 */
export function afrTermClassFor(termMonths: number | null): AfrTermClass {
  if (termMonths === null || termMonths <= 0) return "demand";
  if (termMonths <= 36) return "short_term";
  if (termMonths <= 108) return "mid_term";
  return "long_term";
}

export const IMPUTED_INTEREST_REFUSAL_CODES = [
  /** No AFR is loaded for the period. `FEDERAL_SHORT_TERM_RATES` is empty. */
  "AFR_NOT_LOADED",
  /** The loan is not bona fide, so §1.482-2(a) does not apply at all. */
  "NOT_BONA_FIDE_INDEBTEDNESS",
  /** Bona fide status is still undetermined; conclude nothing. */
  "BONA_FIDE_UNDETERMINED",
  /** A rate at or above the lower limit is already charged — no imputation. */
  "RATE_ALREADY_AT_ARMS_LENGTH",
  /** Principal is zero or negative; there is nothing outstanding. */
  "NO_PRINCIPAL_OUTSTANDING",
] as const;

export type ImputedInterestRefusalCode =
  (typeof IMPUTED_INTEREST_REFUSAL_CODES)[number];

export type ImputedInterestInput = {
  readonly principalCents: number;
  /** Rate actually charged, integer milli-percent. 0 = none charged. */
  readonly chargedRateMilliPct: number;
  /** Term in months, or null for a demand loan. */
  readonly termMonths: number | null;
  /**
   * 100% of the AFR for the period, integer milli-percent, or null when no
   * revenue ruling has been loaded. Null is the state today.
   */
  readonly afrLowerLimitMilliPct: number | null;
  readonly facts: BonaFideFacts;
  readonly direction: "in" | "out";
};

export type ImputedInterestRequirement =
  | {
      readonly kind: "required";
      /** The rate the law substitutes, integer milli-percent. */
      readonly imputedRateMilliPct: number;
      readonly termClass: AfrTermClass;
      readonly compounding: "semiannual";
      /** Which entity picks up phantom interest INCOME. */
      readonly lenderRecognisesIncome: true;
      /**
       * Whether the borrower's matching interest expense is deductible. For
       * Greenway it is not: §280E disallows it, so the imputation is not a wash.
       */
      readonly borrowerDeductionAllowed: boolean;
      readonly explanation: string;
    }
  | {
      readonly kind: "refused";
      readonly code: ImputedInterestRefusalCode;
      readonly explanation: string;
      /** What would have to be true for this to compute. */
      readonly resolution: string;
    };

/**
 * Determine whether interest must be imputed, and at what rate.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not return a dollar amount. Two
 * reasons, both measured rather than assumed:
 *
 *   1. `FEDERAL_SHORT_TERM_RATES` is empty, so there is no AFR to apply. The
 *      refusal AFR_NOT_LOADED is the honest output and is reachable today —
 *      it is in fact the output for Michael's loan right now.
 *
 *   2. On a demand loan the rate applies "for each day on which any amount ...
 *      is outstanding" and unpaid accrued interest is itself outstanding. That
 *      is a daily compounding series over a rate that changes quarterly, and it
 *      needs the transfer history that this slice's census row says is not yet
 *      wired. Producing an annual approximation would give Michael a number
 *      that reconciles against itself and is wrong against the IRS.
 *
 * Every one of the five refusal codes is reachable; the tests prove each with a
 * distinct input, because standing rule 43 says an unreachable code is
 * decoration.
 *
 * ORDER MATTERS, most specific first. NO_PRINCIPAL_OUTSTANDING is checked
 * before the bona fide gate: if nothing is outstanding there is no indebtedness
 * to characterise, and asking whether a zero balance is bona fide is a category
 * error, not a hard question.
 */
export function imputedInterestRequirement(
  input: ImputedInterestInput,
): ImputedInterestRequirement {
  const principal = Math.trunc(input.principalCents);

  if (principal <= 0) {
    return {
      kind: "refused",
      code: "NO_PRINCIPAL_OUTSTANDING",
      explanation:
        "Nothing is outstanding, so there is no indebtedness to impute interest on.",
      resolution: "Nothing to resolve. This is the correct answer for a settled balance.",
    };
  }

  const assessment = assessBonaFide(input.facts, input.direction);

  if (assessment.verdict === "UNDETERMINED") {
    return {
      kind: "refused",
      code: "BONA_FIDE_UNDETERMINED",
      explanation:
        "Whether this is bona fide indebtedness has not been established, and §1.482-2(a) " +
        "applies only to bona fide indebtedness. Imputing interest on an amount that may turn " +
        "out to be a contribution or a distribution would compute the wrong thing precisely.",
      resolution:
        "Answer the open facts: " + assessment.unknown.join(" "),
    };
  }

  if (assessment.verdict === "NOT_BONA_FIDE") {
    const substance =
      assessment.substanceIfNotDebt === "contribution_to_capital"
        ? "a contribution to capital (41100), which raises basis and is not repayable"
        : "a distribution (41000), which is taxable to the extent it exceeds basis";
    return {
      kind: "refused",
      code: "NOT_BONA_FIDE_INDEBTEDNESS",
      explanation:
        "§1.482-2(a)(1)(ii)(B) excludes alleged indebtedness that is not in fact bona fide, " +
        "'even if the stated rate of interest thereon would be within the safe haven rates'. " +
        "Payments are 'treated according to their substance', and the substance here is " +
        substance +
        ".",
      resolution:
        "Either establish the loan properly — see CONTRACT_REQUIREMENTS — or book the amount " +
        "as what it actually is. Interest is the wrong question until that is settled.",
    };
  }

  if (input.afrLowerLimitMilliPct === null) {
    return {
      kind: "refused",
      code: "AFR_NOT_LOADED",
      explanation:
        "The applicable Federal rate for this period has not been loaded. " +
        "FEDERAL_SHORT_TERM_RATES in interest-rates-evidenced.ts is empty on purpose: the rate " +
        "is set quarterly by the Secretary and published in a revenue ruling, so it is a document " +
        "to be looked up, not a number to be reasoned toward.",
      resolution:
        "Load the quarterly revenue ruling rate into FEDERAL_SHORT_TERM_RATES with its " +
        "evidenceSource. The registry rejects a row with no source.",
    };
  }

  if (input.chargedRateMilliPct >= input.afrLowerLimitMilliPct) {
    return {
      kind: "refused",
      code: "RATE_ALREADY_AT_ARMS_LENGTH",
      explanation:
        "The rate actually charged is at or above 100% of the AFR, so it is inside the safe " +
        "haven of §1.482-2(a)(2)(iii)(B)(1) and no allocation is made.",
      resolution:
        "Nothing to resolve. This is the outcome the contract should be written to produce.",
    };
  }

  const termClass = afrTermClassFor(input.termMonths);

  return {
    kind: "required",
    // (a)(2)(iii)(B)(2): the arm's length rate "shall be equal to the lower
    // limit". Not the shortfall, not a negotiated figure — the lower limit.
    imputedRateMilliPct: input.afrLowerLimitMilliPct,
    termClass,
    compounding: "semiannual",
    lenderRecognisesIncome: true,
    // §280E. The borrower here is the cannabis entity, so the matching expense
    // is disallowed and the imputation is asymmetric — income on one side, no
    // deduction on the other.
    borrowerDeductionAllowed: false,
    explanation:
      termClass === "demand"
        ? "No term was stated, so this is a demand loan and the rate is the Federal short-term " +
          "rate in effect for EACH DAY any amount is outstanding, including unpaid accrued " +
          "interest. The rate below is the lower limit for the period given; a full computation " +
          "needs the daily balance history."
        : "The loan has a stated term, so a single applicable Federal rate applies for its " +
          "duration, compounded semiannually.",
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6) FIFO — §1.482-2(a)(1)(iv)(A)
 * ══════════════════════════════════════════════════════════════════════════ */

export type LoanMovement = {
  /** ISO YYYY-MM-DD. */
  readonly date: string;
  readonly kind: "loan_advance" | "loan_repayment";
  readonly amountCents: number;
};

export type OpenAdvance = {
  readonly date: string;
  readonly originalCents: number;
  readonly outstandingCents: number;
};

export type FifoResult = {
  readonly openAdvances: readonly OpenAdvance[];
  readonly outstandingCents: number;
  /** Repayment money with no advance left to apply against. */
  readonly unappliedRepaymentCents: number;
  /** Did the balance ever return to zero? The cycling evidence, measured. */
  readonly balanceReachedZero: boolean;
};

/**
 * Apply repayments against advances oldest-first.
 *
 * §1.482-2(a)(1)(iv)(A): "payments or credits are applied against amounts in a
 * first-in, first-out (FIFO) order." Following the regulation rather than
 * choosing an order matters for a reason beyond compliance: the AGE of the
 * outstanding balance is the fact that shows whether this behaves like debt,
 * and an age computed by rule is evidence while an age chosen afterwards is not.
 *
 * `balanceReachedZero` is returned because it is the single most useful fact in
 * the whole module for Michael's actual risk. A related-party balance that
 * touches zero is a loan that got repaid. One that never does is the exhibit
 * against him. Sorting is by date string — ISO dates sort correctly as text,
 * and a stable tiebreak on original index keeps same-day movements in the order
 * supplied rather than in whatever order the sort happens to produce.
 */
export function applyRepaymentsFifo(
  movements: readonly LoanMovement[],
): FifoResult {
  const indexed = movements.map((m, i) => ({ m, i }));
  indexed.sort((a, b) => {
    if (a.m.date < b.m.date) return -1;
    if (a.m.date > b.m.date) return 1;
    return a.i - b.i;
  });

  const open: { date: string; originalCents: number; outstandingCents: number }[] = [];
  let unapplied = 0;
  let reachedZero = false;
  let sawAnyAdvance = false;

  for (const { m } of indexed) {
    const amount = Math.trunc(m.amountCents);
    if (amount <= 0) continue;

    if (m.kind === "loan_advance") {
      sawAnyAdvance = true;
      open.push({ date: m.date, originalCents: amount, outstandingCents: amount });
      continue;
    }

    let remaining = amount;
    for (const advance of open) {
      if (remaining === 0) break;
      if (advance.outstandingCents === 0) continue;
      const applied = Math.min(advance.outstandingCents, remaining);
      advance.outstandingCents -= applied;
      remaining -= applied;
    }
    if (remaining > 0) unapplied += remaining;

    // Check AFTER each repayment, not only at the end: a balance that hit zero
    // in March and was re-advanced in April cycled, and a final-balance check
    // would miss exactly that.
    if (sawAnyAdvance) {
      let total = 0;
      for (const a of open) total += a.outstandingCents;
      if (total === 0) reachedZero = true;
    }
  }

  const remainingOpen = open.filter((a) => a.outstandingCents > 0);
  let outstanding = 0;
  for (const a of remainingOpen) outstanding += a.outstandingCents;

  return {
    openAdvances: remainingOpen.map((a) => ({
      date: a.date,
      originalCents: a.originalCents,
      outstandingCents: a.outstandingCents,
    })),
    outstandingCents: outstanding,
    unappliedRepaymentCents: unapplied,
    balanceReachedZero: reachedZero,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7) SELF-TESTS
 * ══════════════════════════════════════════════════════════════════════════ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("related-party-loan-core: " + msg);
}

/**
 * Runs under `scripts/compliance/run-pure-selftests.ts`, with no test runner.
 * The point is that these invariants hold in production too, not only under
 * vitest.
 */
export function __runRelatedPartyLoanCoreTests(): void {
  // --- The three flows stay separate, with the measured numbers. -----------
  const split = splitAtmCircuit({
    settlementCents: MEASURED_SETTLEMENT_CENTS,
    surchargeCents: MEASURED_SURCHARGE_CENTS,
    sweepCents: MEASURED_SWEEP_CENTS,
  });
  assert(split.custodyCents === MEASURED_SETTLEMENT_CENTS, "custody must be settlement");
  assert(split.revenueCents === MEASURED_SURCHARGE_CENTS, "revenue must be surcharge only");
  assert(split.custodyAccount === "10900", "custody goes to 10900");
  assert(split.revenueAccount === "51000", "surcharge goes to 51000");
  assert(
    split.overstatementTenths === MEASURED_OVERSTATEMENT_TENTHS,
    "the D-57 overstatement must reproduce at 33.4x, got " + split.overstatementTenths,
  );
  assert(
    splitAtmCircuit({ settlementCents: 100, surchargeCents: 0, sweepCents: 0 })
      .overstatementTenths === 0,
    "zero surcharge must give 0, never Infinity",
  );

  // --- Michael's loan as stated is UNDETERMINED, not favourable. -----------
  const asStated = assessBonaFide(MICHAELS_ATM_LOAN_AS_STATED, "out");
  assert(
    asStated.verdict === "UNDETERMINED",
    "unanswered facts must give UNDETERMINED, got " + asStated.verdict,
  );
  assert(asStated.unknown.length === 2, "exactly two facts are unasked");
  assert(asStated.substanceIfNotDebt === null, "UNDETERMINED names no substance");

  // --- Direction decides the substance, and it is not symmetric. -----------
  const bad: BonaFideFacts = {
    hasWrittenInstrument: false,
    statesInterestRate: false,
    hasMaturityDate: false,
    hasRepaymentSchedule: false,
    hasActualRepayments: false,
    balanceCyclesBothWays: false,
    balanceIsTracked: false,
    demandEverMade: false,
  };
  assert(
    assessBonaFide(bad, "in").substanceIfNotDebt === "contribution_to_capital",
    "money in that is not debt is a contribution",
  );
  assert(
    assessBonaFide(bad, "out").substanceIfNotDebt === "distribution",
    "money out that is not debt is a distribution",
  );

  // --- Conduct, not paperwork, is what makes it bona fide. -----------------
  const paperOnly: BonaFideFacts = {
    ...bad,
    hasWrittenInstrument: true,
    statesInterestRate: true,
    hasMaturityDate: true,
    hasRepaymentSchedule: true,
  };
  assert(
    assessBonaFide(paperOnly, "out").verdict === "NOT_BONA_FIDE",
    "perfect paperwork with no repayment and no tracked balance is still not bona fide",
  );
  const real: BonaFideFacts = {
    ...paperOnly,
    hasActualRepayments: true,
    balanceCyclesBothWays: true,
    balanceIsTracked: true,
    demandEverMade: true,
  };
  assert(assessBonaFide(real, "out").verdict === "BONA_FIDE", "conduct + paper = bona fide");

  // --- 36000 vs 34000 turns on the schedule, not on preference. ------------
  assert(
    loanControlAccountFor(MICHAELS_ATM_LOAN_AS_STATED).account === "36000",
    "no term means 36000",
  );
  assert(
    !loanControlAccountFor(MICHAELS_ATM_LOAN_AS_STATED).requiresSubledger,
    "36000 needs no subledger",
  );
  assert(loanControlAccountFor(real).account === "34000", "term + schedule means 34000");
  assert(loanControlAccountFor(real).requiresSubledger, "34000 needs a subledger");

  // --- Term classification, including the demand case. ---------------------
  assert(afrTermClassFor(null) === "demand", "no term is a demand loan");
  assert(afrTermClassFor(0) === "demand", "zero term is a demand loan");
  assert(afrTermClassFor(36) === "short_term", "36 months is short-term");
  assert(afrTermClassFor(37) === "mid_term", "37 months is mid-term");
  assert(afrTermClassFor(108) === "mid_term", "108 months is mid-term");
  assert(afrTermClassFor(109) === "long_term", "109 months is long-term");

  // --- Every refusal code is reachable. Rule 43. ---------------------------
  const seen = new Set<string>();
  const push = (r: ImputedInterestRequirement): void => {
    if (r.kind === "refused") seen.add(r.code);
  };
  push(
    imputedInterestRequirement({
      principalCents: 0,
      chargedRateMilliPct: 0,
      termMonths: null,
      afrLowerLimitMilliPct: 4000,
      facts: real,
      direction: "out",
    }),
  );
  push(
    imputedInterestRequirement({
      principalCents: 100,
      chargedRateMilliPct: 0,
      termMonths: null,
      afrLowerLimitMilliPct: 4000,
      facts: MICHAELS_ATM_LOAN_AS_STATED,
      direction: "out",
    }),
  );
  push(
    imputedInterestRequirement({
      principalCents: 100,
      chargedRateMilliPct: 0,
      termMonths: null,
      afrLowerLimitMilliPct: 4000,
      facts: bad,
      direction: "out",
    }),
  );
  push(
    imputedInterestRequirement({
      principalCents: 100,
      chargedRateMilliPct: 0,
      termMonths: null,
      afrLowerLimitMilliPct: null,
      facts: real,
      direction: "out",
    }),
  );
  push(
    imputedInterestRequirement({
      principalCents: 100,
      chargedRateMilliPct: 5000,
      termMonths: null,
      afrLowerLimitMilliPct: 4000,
      facts: real,
      direction: "out",
    }),
  );
  for (const code of IMPUTED_INTEREST_REFUSAL_CODES) {
    assert(seen.has(code), "refusal code never emitted, so it is decoration: " + code);
  }

  // --- The imputation itself: the lower limit, not the shortfall. ----------
  const req = imputedInterestRequirement({
    principalCents: MEASURED_SWEEP_CENTS,
    chargedRateMilliPct: 0,
    termMonths: null,
    afrLowerLimitMilliPct: 4200,
    facts: real,
    direction: "out",
  });
  assert(req.kind === "required", "a zero-rate bona fide loan with an AFR must impute");
  if (req.kind === "required") {
    assert(req.imputedRateMilliPct === 4200, "the imputed rate IS the lower limit");
    assert(req.termClass === "demand", "no term is a demand loan");
    assert(req.compounding === "semiannual", "(a)(2)(iii)(B)(2) says compounded semiannually");
    assert(!req.borrowerDeductionAllowed, "280E disallows the cannabis borrower's interest");
  }

  // --- Michael's loan today refuses, and the code says which input is out. -
  const today = imputedInterestRequirement({
    principalCents: MEASURED_SWEEP_CENTS,
    chargedRateMilliPct: 0,
    termMonths: null,
    afrLowerLimitMilliPct: null,
    facts: MICHAELS_ATM_LOAN_AS_STATED,
    direction: "out",
  });
  assert(today.kind === "refused", "today the answer must be a refusal");
  if (today.kind === "refused") {
    // The bona fide gate is reached before the AFR gate, and that ordering is
    // deliberate: there is no point pricing a loan that may not be a loan.
    assert(
      today.code === "BONA_FIDE_UNDETERMINED",
      "the open questions outrank the missing rate, got " + today.code,
    );
  }

  // --- FIFO, oldest first. -------------------------------------------------
  const fifo = applyRepaymentsFifo([
    { date: "2026-01-10", kind: "loan_advance", amountCents: 10_000 },
    { date: "2026-02-10", kind: "loan_advance", amountCents: 20_000 },
    { date: "2026-03-10", kind: "loan_repayment", amountCents: 15_000 },
  ]);
  assert(fifo.outstandingCents === 15_000, "30k advanced less 15k repaid");
  assert(fifo.openAdvances.length === 1, "the January advance is fully retired first");
  assert(fifo.openAdvances[0].date === "2026-02-10", "FIFO retires the oldest first");
  assert(fifo.openAdvances[0].outstandingCents === 15_000, "5k of February was applied");
  assert(!fifo.balanceReachedZero, "this balance never touched zero");

  // Out-of-order input must not change the answer.
  const shuffled = applyRepaymentsFifo([
    { date: "2026-03-10", kind: "loan_repayment", amountCents: 15_000 },
    { date: "2026-02-10", kind: "loan_advance", amountCents: 20_000 },
    { date: "2026-01-10", kind: "loan_advance", amountCents: 10_000 },
  ]);
  assert(
    shuffled.outstandingCents === fifo.outstandingCents &&
      shuffled.openAdvances.length === fifo.openAdvances.length &&
      shuffled.openAdvances[0].date === fifo.openAdvances[0].date,
    "FIFO must sort by date, not trust input order",
  );

  // Cycling: hits zero mid-history, then re-advances. The final balance is
  // non-zero, so only a per-repayment check can see that it cycled.
  const cycled = applyRepaymentsFifo([
    { date: "2026-01-10", kind: "loan_advance", amountCents: 10_000 },
    { date: "2026-02-10", kind: "loan_repayment", amountCents: 10_000 },
    { date: "2026-03-10", kind: "loan_advance", amountCents: 5_000 },
  ]);
  assert(cycled.balanceReachedZero, "a balance that hit zero in February cycled");
  assert(cycled.outstandingCents === 5_000, "and then 5k was re-advanced");

  // Overpayment is surfaced, not silently swallowed.
  const over = applyRepaymentsFifo([
    { date: "2026-01-10", kind: "loan_advance", amountCents: 1_000 },
    { date: "2026-02-10", kind: "loan_repayment", amountCents: 2_500 },
  ]);
  assert(over.unappliedRepaymentCents === 1_500, "excess repayment must be reported");
  assert(over.outstandingCents === 0, "and the balance floors at zero");

  // A repayment with no advance at all is entirely unapplied, and that is NOT
  // a balance reaching zero — it never left zero.
  const orphan = applyRepaymentsFifo([
    { date: "2026-01-10", kind: "loan_repayment", amountCents: 500 },
  ]);
  assert(orphan.unappliedRepaymentCents === 500, "orphan repayment is unapplied");
  assert(!orphan.balanceReachedZero, "a balance that never existed did not cycle");

  // --- The contract checklist is real content, not headings. ---------------
  assert(CONTRACT_REQUIREMENTS.length === 5, "five contract requirements");
  for (const r of CONTRACT_REQUIREMENTS) {
    assert(r.item.length > 20, "contract item too thin: " + r.item);
    assert(r.why.length > 80, "contract rationale too thin: " + r.item);
    assert(r.cite.indexOf("1.482-2") >= 0, "each requirement cites the regulation");
  }
}
