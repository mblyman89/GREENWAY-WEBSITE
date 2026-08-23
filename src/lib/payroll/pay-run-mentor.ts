/**
 * src/lib/payroll/pay-run-mentor.ts   (books-39 phase F)
 *
 * THE CPA SITTING NEXT TO MICHAEL ON PAYDAY.
 *
 * Michael asked for this in so many words:
 *
 *   "I want a cpa mentor guiding me every step of the way. I want check lists
 *    and blockers if things are right. I want it to tell me how to do it
 *    properly if I mess it up."
 *
 * So this file is not decoration around the pay run. It is the part that makes
 * an unfamiliar screen usable by somebody who has not practised accounting in
 * thirteen years and is running his first payroll on 1 January 2027 with no
 * bookkeeper to ask.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO node:fs IN THIS FILE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The coverage gates that prove every refusal code has a lesson live in
 * `pay-run-mentor-gates.ts`, not here. In books-33 a mentor file mixed lesson
 * data with `readFileSync`, the data was imported by a client component, and
 * `node:fs` went into a browser bundle - which broke every deployment while CI
 * stayed green. Standing rule 65b. This file is plain data and pure functions
 * so it can be imported anywhere.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EVERY LESSON HAS A "HOW TO FIX IT IF YOU GOT IT WRONG"
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The dangerous moment in payroll is not the refusal. A refusal stops and
 * explains itself. The dangerous moment is the cheque that was PAID on a wrong
 * number, because by then the money has moved, a deposit may have been made,
 * and the fix is no longer "change the figure" - it is an amended return, or a
 * W-2c, or a conversation with an employee about money already spent.
 *
 * Software that only prevents mistakes abandons the user at the exact moment
 * they most need help. So every lesson here carries a recovery path, and the
 * recovery paths distinguish BEFORE THE MONEY MOVED from AFTER, because those
 * are different problems with different answers.
 */

import {
  ALL_PAY_RUN_REFUSAL_CODES,
  ALL_W4_PROVENANCES,
  type PayRunRefusalCode,
  type W4Provenance,
} from "@/lib/payroll/pay-run-core";
import {
  PAY_RUN_AUTHORITIES,
  type PayRunAuthorityId,
} from "@/lib/payroll/pay-run-authorities";

/* ═══════════════════════════════════════════════════════════════════════════
 * 1) THE PRE-FLIGHT CHECKLIST
 *
 * What must be true BEFORE a pay run means anything. Ordered, because the
 * order is the lesson: a mistake at step 1 makes every later step wrong while
 * each of them still looks internally consistent.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type PayRunCheckKey =
  | "rates-on-file"
  | "punches-clean"
  | "w4-on-file"
  | "pay-frequency-right"
  | "orders-current"
  | "ytd-carried-in"
  | "read-three-cheques";

export type PayRunCheck = {
  readonly key: PayRunCheckKey;
  readonly order: number;
  /** The question, phrased so "no" is obviously a problem. */
  readonly question: string;
  /** Why it sits at this point in the order and not later. */
  readonly whyThisOrder: string;
  /** The physical action that answers it. Never "verify the data". */
  readonly howToCheck: string;
  /** What it costs to get this one wrong, in money or in filings. */
  readonly ifItFails: string;
};

export const PAY_RUN_CHECKS: readonly PayRunCheck[] = [
  {
    key: "rates-on-file",
    order: 1,
    question: "Is every rate for this pay DATE on file, with the notice it came from?",
    whyThisOrder:
      "A missing rate is the only problem here that is wrong for everybody at once, so it is " +
      "worth knowing before you look at a single person. It is also the one most likely to be " +
      "true in January: L&I, ESD and the PFML premium all reset on 1 January, and Greenway's " +
      "first payroll is 1 January 2027.",
    howToCheck:
      "The pay run refuses outright and names each missing rate. If it computed, they are all " +
      "on file. Rates are chosen by PAY DATE, not by the period worked, so a period ending in " +
      "December that pays in January needs the new year's rates.",
    ifItFails:
      "Nothing is computed at all, which is the point. The alternative - carrying last year's " +
      "figure forward - produces a small, entirely plausible error on every cheque for a year, " +
      "and it surfaces as a reconciliation difference twelve months later with no obvious cause.",
  },
  {
    key: "punches-clean",
    order: 2,
    question: "Are the timesheets finished — no open punches, no overlaps?",
    whyThisOrder:
      "Hours drive gross pay, and gross pay drives everything after it: withholding, the " +
      "employer's own taxes, and the disposable earnings any garnishment is measured against. " +
      "A wrong hour figure makes all of them wrong in proportion, so each one still looks " +
      "internally consistent while all of them are wrong together.",
    howToCheck:
      "Open Timesheets for this period. The pay run reads exactly the figures that screen " +
      "shows, so if it is clean there it is clean here. Anyone the timesheet refused appears " +
      "as a BLOCKED line rather than being quietly left out of the run.",
    ifItFails:
      "That person is blocked and nobody else is affected. Fix the punch and re-open the run; " +
      "nothing was saved, so there is nothing to undo.",
  },
  {
    key: "w4-on-file",
    order: 3,
    question: "Does everybody have a signed W-4 — and is it actually SIGNED?",
    whyThisOrder:
      "A missing W-4 does not stop a cheque. The law says exactly what to do without one, so " +
      "the cheque computes and is arithmetically correct. That is precisely why it needs " +
      "checking deliberately: nothing will break to remind you.",
    howToCheck:
      "Any line marked NEEDS ATTENTION says which of the two it is - no form at all, or a form " +
      "on file that nobody signed. An unsigned W-4 is not a W-4, so the elections written on " +
      "it are disregarded entirely and the person is withheld as single with no adjustments.",
    ifItFails:
      "The employee is over-withheld all year and gets it back as a refund the following April. " +
      "It is not an employer penalty and it is not an error on your part - but it is somebody's " +
      "money sitting with the IRS for a year, and they will ask you about it.",
  },
  {
    key: "pay-frequency-right",
    order: 4,
    question: "Is each person's pay frequency right — biweekly for staff, annual for the owner?",
    whyThisOrder:
      "This one is invisible. Every other item on this list announces itself; a wrong pay " +
      "frequency produces a completely ordinary-looking cheque with the wrong income tax on it.",
    howToCheck:
      "Staffing → the employee → Pay. Greenway's staff are biweekly, which is 26 cheques a " +
      "year. Michael is annual, which is 1. If no frequency is set at all, the line is BLOCKED " +
      "rather than guessed at.",
    ifItFails:
      "The federal tables annualise the wages, find the bracket, then divide back down by the " +
      "number of periods. Believe 24 where the truth is 26 and every income-tax figure is out " +
      "by about eight percent, all year, and it will not tie out until the W-2.",
  },
  {
    key: "orders-current",
    order: 5,
    question: "Has any garnishment or support order been released, changed, or ended?",
    whyThisOrder:
      "Court orders arrive and end by post, on their own schedule, with no connection to " +
      "payday. Nothing in the software can know an order was released; only you can.",
    howToCheck:
      "Payroll → Garnishments lists every ACTIVE order. Suspended and terminated orders are " +
      "excluded from the run entirely. Compare it against the paperwork on your desk.",
    ifItFails:
      "Withholding on a released order is worse than missing one, and the asymmetry is the " +
      "point: the money has already gone to somebody not entitled to it, so getting it back " +
      "means recovering it from them, not simply correcting a figure. Missing one is " +
      "recoverable from the next cheque.",
  },
  {
    key: "ytd-carried-in",
    order: 6,
    question: "For the FIRST run of a year: are the year-to-date figures carried in correctly?",
    whyThisOrder:
      "Year-to-date decides when the Social Security wage base stops applying. It only matters " +
      "for people who cross it, and it matters enormously for them.",
    howToCheck:
      "Payroll → Year to date. For 1 January 2027 every figure should be zero, because the " +
      "wage bases reset on the calendar year. For a mid-year cutover they must match the last " +
      "payroll run in the old system, to the penny.",
    ifItFails:
      "Understated year-to-date keeps withholding Social Security after the ceiling is reached, " +
      "so the employee over-pays and it must be refunded. Overstated stops withholding early, " +
      "and the employer owes the difference plus the matching share.",
  },
  {
    key: "read-three-cheques",
    order: 7,
    question: "Have you actually read three finished cheques, line by line?",
    whyThisOrder:
      "Last, because it is the only check that can catch a category of error nobody predicted. " +
      "The six above test things somebody thought of in advance.",
    howToCheck:
      "Pick the highest-paid person, the lowest-paid person, and anyone with a garnishment. " +
      "Read every line and ask whether it is roughly the size you expected. You are not " +
      "re-doing the arithmetic - you are checking that nothing is an order of magnitude out.",
    ifItFails:
      "If a figure looks wrong, it probably is. Stop the run rather than paying it. Nothing has " +
      "been saved until you approve, so stopping costs nothing but a delay.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * 2) REFUSAL LESSONS — one per code, and the gate proves it
 * ═══════════════════════════════════════════════════════════════════════════ */

export type PayRunRefusalLesson = {
  readonly code: PayRunRefusalCode;
  /** One line, for a banner. */
  readonly headline: string;
  /** Why refusing beats computing anyway. */
  readonly whyWeStop: string;
  /** The exact next click. */
  readonly whatToDo: string;
  /** What it would have cost had the software guessed instead. */
  readonly costOfGuessing: string;
};

export const PAY_RUN_REFUSAL_LESSONS: readonly PayRunRefusalLesson[] = [
  {
    code: "NO_HOURS",
    headline: "The timesheet could not produce hours for this person",
    whyWeStop:
      "Hours are the first number in the chain. Everything after them - gross, withholding, " +
      "the employer's taxes, the base a garnishment is measured against - is computed FROM " +
      "them, so there is no honest figure to print without them.",
    whatToDo:
      "Open Timesheets for this pay period and fix this person's punches. The usual cause is " +
      "an open punch: somebody clocked in and never clocked out. Everyone else in the run is " +
      "unaffected and their cheques are already computed.",
    costOfGuessing:
      "Treating a missing punch as zero hours pays somebody nothing for a day they worked, and " +
      "it looks exactly like a short week rather than like an error.",
  },
  {
    code: "NO_GROSS",
    headline: "There are hours, but no pay rate to value them at",
    whyWeStop:
      "Hours without a rate is not zero pay, it is unknown pay. A rate that was never entered " +
      "reads as 'unknown', and the difference between unknown and zero is the whole reason " +
      "this stops instead of printing a cheque for nothing.",
    whatToDo:
      "Staffing → this employee → Pay. Set the basis (hourly or salary) and the rate. Then " +
      "re-open the pay run; nothing has been saved.",
    costOfGuessing:
      "A zero rate produces a cheque for $0.00 that is internally consistent - taxes of zero " +
      "on gross of zero all reconcile perfectly - and would be paid without anything looking " +
      "wrong until the employee asked where their wages went.",
  },
  {
    code: "NO_PAY_FREQUENCY",
    headline: "No current pay record says how often this person is paid",
    whyWeStop:
      "The number of pay periods in a year is a DIVISOR in the federal withholding tables, not " +
      "a label. Pub. 15-T annualises the wages, finds the bracket, then divides back down by " +
      "it, so the wrong value moves every income-tax figure.",
    whatToDo:
      "Staffing → this employee → Pay, and set the pay frequency. Greenway's staff are " +
      "biweekly (26 a year); the owner is annual (1 a year).",
    costOfGuessing:
      "Assuming biweekly for the owner, who is paid annually, annualises his salary twenty-six " +
      "times over. That lands in the top bracket and withholds an enormous figure which looks " +
      "entirely plausible on screen, because nothing about it is arithmetically inconsistent.",
  },
  {
    code: "RATE_NOT_ON_FILE",
    headline: "A rate every cheque needs has no evidenced row for this pay date",
    whyWeStop:
      "These premiums come out of the employee's own cheque. Computing without one withholds " +
      "nothing for it, which overstates take-home pay AND overstates the disposable earnings " +
      "that any garnishment is measured against.",
    whatToDo:
      "Books → Payroll rates. Enter the rate from the agency notice and attach the notice " +
      "itself, so the figure can be traced back to its source years later.",
    costOfGuessing:
      "This one is not hypothetical. Carrying a missing PFML rate through as zero made a test " +
      "cheque $19.37 too high, and because a creditor garnishment takes 25% of disposable " +
      "earnings, it over-garnished somebody already being garnished. It survived review and " +
      "was caught only by running it.",
  },
  {
    code: "NO_MINIMUM_WAGE",
    headline: "The minimum wage in force on this pay date is not on file",
    whyWeStop:
      "The protected floor - the amount a garnishment may never take a person below - is a " +
      "multiple of the minimum wage. No minimum wage means no floor, and no floor means every " +
      "garnishment computed would take too much from the lowest-paid people on the payroll.",
    whatToDo:
      "Open Payroll → Rates and enter both the Washington and the federal minimum wage " +
      "effective for this pay date, each with the notice it came from. Washington's changes " +
      "EVERY January and L&I announces the new figure around 30 September, so the number for " +
      "a January payroll is published the previous autumn - it is not something to wait for.",
    costOfGuessing:
      "Reusing last year's Washington figure under-protects every garnished employee by the " +
      "amount of the annual increase, quietly, on every cheque until somebody notices.",
  },
  {
    code: "ENGINE_REFUSED",
    headline: "The net-pay engine declined to produce a figure, and said why",
    whyWeStop:
      "The engine's own reasons are carried through word for word rather than being summarised " +
      "here. It knows exactly which cap or floor it could not apply, and re-wording that would " +
      "give one problem two different descriptions in two places.",
    whatToDo:
      "Read the reason shown on the line - it names the missing fact. Most often it is one of " +
      "the two garnishment questions: whether the employee supports another family, and " +
      "whether any arrears are more than twelve weeks old.",
    costOfGuessing:
      "Those two answers are the difference between a 50% and a 65% ceiling on somebody's " +
      "wages. Defaulting either one silently under-withholds child support, and unpaid support " +
      "withholding is the one error in this whole domain that lands on the employer personally.",
  },
  {
    code: "DOES_NOT_RECONCILE",
    headline: "The parts of this cheque do not add back to the whole",
    whyWeStop:
      "Gross, less every deduction, must equal net exactly. If it does not, one of the figures " +
      "is wrong and there is no way to tell which from the outside. This should never appear.",
    whatToDo:
      "Do not pay this run. This indicates a defect in the software rather than in your data, " +
      "so nothing you change on a screen will fix it. Record which employee and which pay date " +
      "produced it - that is what makes it findable.",
    costOfGuessing:
      "A cheque that does not reconcile will not tie to the 941, the W-2, or the bank. The " +
      "error compounds through every filing that reads it, and it is found at the worst " +
      "possible moment: reconciling a quarter that has already been filed.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * 3) THE W-4 PROVENANCE LESSONS
 *
 * Why a line can be arithmetically perfect and still need a human.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type W4ProvenanceLesson = {
  readonly provenance: W4Provenance;
  readonly headline: string;
  /** Plain English for what happened. */
  readonly whatItMeans: string;
  /** Whether Michael must do anything, and what. */
  readonly whatToDo: string;
  /**
   * Which authority makes this the right treatment.
   *
   * TYPED AS THE UNION, NOT AS `string`, AND HERE IS WHY.
   *
   * The first draft of this file typed it `string | null` and cited all three
   * authorities by their TypeScript const name — "NO_W4_TREAT_AS_SINGLE" —
   * instead of by the authority's real id,
   * "pay-run-cfr-31-3402-f2-1-no-certificate". `tsc` was perfectly happy. All
   * three citations resolved to nothing, and a citation that resolves to
   * nothing is worse than no citation at all: it tells Michael the sentence
   * beneath it has been checked against the law when nothing checked it
   * (standing rule 24).
   *
   * Narrowing the field turns that mistake into a red squiggle. `null` is still
   * permitted, for a lesson that is genuinely practice rather than law — but it
   * has to be written deliberately, and it cannot happen by typo.
   */
  readonly authorityId: PayRunAuthorityId | null;
};

export const W4_PROVENANCE_LESSONS: readonly W4ProvenanceLesson[] = [
  {
    provenance: "furnished",
    headline: "The employee told us how to withhold",
    whatItMeans:
      "A signed W-4 is on file and its elections were used exactly as written. This is the " +
      "normal case and needs nothing from you.",
    whatToDo: "Nothing.",
    authorityId: "pay-run-cfr-31-3402-f2-1-furnish-on-hire",
  },
  {
    provenance: "statutory_default_no_w4",
    headline: "No W-4 on file — the law chose, not the employee",
    whatItMeans:
      "There is no W-4 for this person, so the regulation supplies the answer: withhold as " +
      "single with no adjustments. The cheque is legally correct. It is also almost certainly " +
      "withholding more than the employee actually owes.",
    whatToDo:
      "Pay the cheque - it is correct - and get a signed W-4 before the next one. Every " +
      "additional period on the default is more of their money held back until April.",
    authorityId: "pay-run-cfr-31-3402-f2-1-no-certificate",
  },
  {
    provenance: "statutory_default_unsigned",
    headline: "A W-4 exists but nobody signed it — it must be disregarded",
    whatItMeans:
      "A form is on file with elections written on it, and no signature. An unsigned " +
      "certificate is invalid, and the employer is required to disregard it entirely - not to " +
      "partly honour it. So this person is withheld as single with no adjustments, exactly as " +
      "if the form did not exist.",
    whatToDo:
      "Pay the cheque - withholding as single is the legally correct treatment here - then get " +
      "the signature before the next run. This is the more urgent of the two cases, because it " +
      "looks finished: the employee filled the form in and believes their elections are in " +
      "force; they are not, and nobody chases a form that is already on file. The form is " +
      "otherwise complete, so this is one signature, not a new W-4.",
    authorityId: "pay-run-cfr-31-3402-f2-1-invalid-certificate",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * 4) HOW TO FIX IT AFTER THE MONEY HAS MOVED
 *
 * Michael: "I want it to tell me how to do it properly if I mess it up."
 *
 * These are the recoveries, and they are separated by WHEN the mistake is
 * found, because that is what changes the answer - not the size of the error.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type RecoveryKey =
  | "before-approval"
  | "after-approval-before-payment"
  | "after-payment-same-quarter"
  | "after-quarter-filed"
  | "after-w2-issued";

export type PayRunRecovery = {
  readonly key: RecoveryKey;
  readonly when: string;
  readonly headline: string;
  readonly whatToDo: string;
  /** The thing people get wrong about this stage. */
  readonly theTrap: string;
};

export const PAY_RUN_RECOVERIES: readonly PayRunRecovery[] = [
  {
    key: "before-approval",
    when: "You are looking at the run and have not approved it.",
    headline: "Nothing has been saved. Just fix it and look again.",
    whatToDo:
      "Correct whatever is wrong at its source - the punch, the rate, the W-4, the order - and " +
      "re-open the pay run. It is recomputed from scratch every time you open it, so there is " +
      "no stale copy to clear and nothing to undo.",
    theTrap:
      "Trying to correct a figure ON the pay run screen instead of at its source. There is " +
      "deliberately no way to type over a computed number here. A cheque you can hand-edit is " +
      "a cheque nobody can reproduce later, which is exactly the position the old spreadsheet " +
      "left you in.",
  },
  {
    key: "after-approval-before-payment",
    when: "The run is approved but no money has left the bank.",
    headline: "Still recoverable cleanly. Reverse before you re-run.",
    whatToDo:
      "Reverse the run so the year-to-date accumulators go back to where they were, then fix " +
      "the source and run it again. Do NOT simply run a second time on top - that adds a " +
      "second set of wages to the year-to-date and the wage bases will be wrong for the rest " +
      "of the year.",
    theTrap:
      "Assuming that because no money moved, nothing was recorded. The year-to-date figures " +
      "were updated at approval, and they are what every ceiling for the rest of the year is " +
      "measured against.",
  },
  {
    key: "after-payment-same-quarter",
    when: "Employees have been paid, and the quarter is not filed yet.",
    headline: "Fix it on the next cheque, in the same quarter, and keep the paper.",
    whatToDo:
      "Under-withheld: recover it from the next cheque within the same quarter, so the 941 for " +
      "the quarter is right as filed. Over-withheld: refund it on the next cheque. Either way " +
      "write down what happened and why, and tell the employee before their next payslip " +
      "looks strange to them.",
    theTrap:
      "Crossing a quarter boundary while 'catching up'. A correction made in April for a " +
      "March error means the Q1 941 was filed wrong and the Q2 941 is now also wrong. Inside " +
      "one quarter it is a self-correcting adjustment; across two it is an amended return.",
  },
  {
    key: "after-quarter-filed",
    when: "The 941 for that quarter has already gone in.",
    headline: "This is a 941-X. It is routine, and it is not optional.",
    whatToDo:
      "File Form 941-X for the affected quarter. It has its own deadlines and its own rules " +
      "about whether you are correcting an underpayment or claiming a refund, and those two " +
      "paths differ. This is the point at which the question is worth an hour of a CPA's time " +
      "rather than an afternoon of yours.",
    theTrap:
      "Quietly absorbing a small under-withholding rather than filing. The amount is not the " +
      "issue - the mismatch between what was deposited and what the wage records show is the " +
      "issue, and it is precisely what a payroll examination compares.",
  },
  {
    key: "after-w2-issued",
    when: "W-2s are out and the employee has probably filed.",
    headline: "W-2c, and the employee needs to know immediately.",
    whatToDo:
      "Issue a corrected W-2c and send it to the employee and to the Social Security " +
      "Administration. If they have already filed a return using the original, they may need " +
      "to amend it, and that is a cost your error has imposed on them.",
    theTrap:
      "Waiting until next January to 'fix it on the next W-2'. Wages belong to the year they " +
      "were PAID. Moving them to a later year to tidy up the paperwork misstates two years " +
      "instead of one.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * 5) LOOKUPS
 * ═══════════════════════════════════════════════════════════════════════════ */

export function payRunRefusalLesson(code: PayRunRefusalCode): PayRunRefusalLesson | null {
  return PAY_RUN_REFUSAL_LESSONS.find((l) => l.code === code) ?? null;
}

export function w4ProvenanceLesson(p: W4Provenance): W4ProvenanceLesson | null {
  return W4_PROVENANCE_LESSONS.find((l) => l.provenance === p) ?? null;
}

export function payRunRecovery(key: RecoveryKey): PayRunRecovery | null {
  return PAY_RUN_RECOVERIES.find((r) => r.key === key) ?? null;
}

/**
 * Codes and provenances with no lesson.
 *
 * Derived by comparing against the ENGINE's own exported lists rather than
 * against a copy kept here. A hand-maintained list of codes drifts the moment
 * somebody adds an eighth refusal, and it drifts silently - the count still
 * looks right (standing rule 50). `pay-run-mentor-gates.ts` additionally
 * verifies those lists against the engine's SOURCE, so a code that exists only
 * in the union and never in a runtime array cannot hide either.
 */
export function untaughtPayRunCodes(): {
  readonly refusalCodes: readonly string[];
  readonly provenances: readonly string[];
} {
  const taughtCodes = new Set(PAY_RUN_REFUSAL_LESSONS.map((l) => l.code));
  const taughtProv = new Set(W4_PROVENANCE_LESSONS.map((l) => l.provenance));
  return {
    refusalCodes: ALL_PAY_RUN_REFUSAL_CODES.filter((c) => !taughtCodes.has(c)),
    provenances: ALL_W4_PROVENANCES.filter((p) => !taughtProv.has(p)),
  };
}

/**
 * Authority ids referenced by a lesson that do not exist in the registry.
 *
 * A lesson citing a rule that is not in `pay-run-authorities.ts` is worse than
 * a lesson citing nothing: it reads as though it has been checked against the
 * law when nothing checked it (standing rule 24).
 */
export function danglingAuthorityIds(): readonly string[] {
  const known = new Set<string>(PAY_RUN_AUTHORITIES.map((a) => a.id));
  return W4_PROVENANCE_LESSONS.map((l) => l.authorityId).filter(
    (id): id is PayRunAuthorityId => id !== null && !known.has(id),
  );
}

/**
 * The opposite direction: authorities this slice mirrored that NO lesson cites.
 *
 * An uncited authority is research that never reached Michael — verbatim,
 * verified against the corpus, and invisible. books-36 found exactly that
 * condition across ten mentor modules, so it is worth a function rather than a
 * hope.
 *
 * TWO OF THE FIVE ARE EXPECTED TO BE UNCITED BY THE PROVENANCE LESSONS, and
 * that is not a defect: the remittance clock and the January minimum-wage
 * adjustment are not about which W-4 governs. They are cited by the CHECKLIST
 * and by the refusal lessons instead. So this reports raw facts and the gate
 * decides what is acceptable, rather than this function quietly excusing two
 * ids and reporting a clean answer.
 */
export function uncitedByProvenanceLessons(): readonly string[] {
  const cited = new Set<string>(
    W4_PROVENANCE_LESSONS.map((l) => l.authorityId).filter((id): id is PayRunAuthorityId => id !== null),
  );
  return PAY_RUN_AUTHORITIES.filter((a) => !cited.has(a.id)).map((a) => a.id);
}
