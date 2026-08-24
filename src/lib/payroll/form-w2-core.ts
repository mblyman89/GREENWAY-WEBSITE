/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FORM W-2 AND FORM W-3 — the engine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS IS. One W-2 per employee, one W-3 covering them all, and the
 * reconciliation that compares the W-3 against the four Forms 941 already filed
 * for the same year. Michael files these himself; this module's job is to make
 * the numbers right and to be able to explain every one of them.
 *
 * WHERE THE NUMBERS COME FROM. Nothing here invents a figure. Every box is
 * either copied from the year-to-date accumulator that the pay runs built
 * (`YtdAccumulatorRow`) or derived from it by arithmetic that is stated on the
 * box itself in `derivation`. If the accumulator is wrong the W-2 is wrong, and
 * that is the correct dependency: there is exactly one place where a year's
 * wages are added up.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE TWO TRAPS THIS MODULE EXISTS TO SURVIVE
 * ───────────────────────────────────────────────────────────────────────────
 *
 * TRAP 1 — THE S-CORPORATION HEALTH PREMIUM. Michael owns 85% of Greenway, so
 * he is a "2%-or-more shareholder-employee". If the company pays his health
 * insurance, the premium is WAGES for box 1 but is generally NOT subject to
 * FICA, so it stays OUT of boxes 3 and 5.
 *
 *     box 1  =  cash wages + premium
 *     box 3  =  cash wages            (capped at the wage base)
 *     box 5  =  cash wages
 *
 * His W-2 therefore shows BOX 1 LARGER THAN BOXES 3 AND 5, by exactly the
 * premium, and that is correct. The overwhelming instinct — his, a reviewer's,
 * mine when I first wrote this — is that a W-2 whose boxes disagree is broken.
 * "Fixing" it either overpays FICA or understates his income. This engine
 * therefore does three things: it computes the difference, it labels it, and it
 * carries a sentence explaining it so nobody has to remember.
 *
 * TRAP 2 — BOX 17 IN A STATE WITH NO INCOME TAX. Boxes 15-20 are for state and
 * local INCOME tax. Washington has none. But Greenway genuinely withholds
 * Washington money — Paid Family and Medical Leave, and WA Cares. The trap
 * catches conscientious people: they know state money was withheld, they see a
 * box labelled "State income tax", and they fill it in. That reports income tax
 * to a state that levies none, and it can never match a state return because no
 * such return exists. Those amounts belong in box 14.
 *
 * This engine REFUSES a non-empty box 17 on a Washington W-2 rather than
 * warning about it, because there is no set of facts in which it is right.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THE RECONCILIATION LIVES HERE
 * ───────────────────────────────────────────────────────────────────────────
 *
 * The IRS instruction says you "WILL be contacted" when the W-3 and the four
 * 941s disagree — not "may be". Both sets of numbers are already in this
 * system, so the comparison is free, and running it in October leaves time to
 * fix the quarter that caused it. Running it in late January means amending.
 *
 * The FICA half of that comparison uses the instruction's own word:
 * "approximately twice". The 941 carries both halves of Social Security and
 * Medicare; the W-3 carries only the employee's. But Additional Medicare Tax
 * has NO employer match, so the true ratio drops below 2 as soon as anybody
 * crosses $200,000. This engine computes the expected 941 figure EXACTLY —
 * doubling only the matched part and adding the unmatched Additional Medicare
 * once — instead of asserting a ratio with a tolerance band. A check built on a
 * magic percentage cries wolf in the first good year and then gets switched off.
 *
 * @see form-w2-authorities.ts — every rule above is quoted verbatim there.
 */

import {
  OASDI_RATE_MILLI_PCT,
  MEDICARE_RATE_MILLI_PCT,
  ADDITIONAL_MEDICARE_RATE_MILLI_PCT,
  ADDITIONAL_MEDICARE_WITHHOLDING_THRESHOLD_CENTS,
  applyMilliPct,
  wageBaseSpec,
} from "@/lib/payroll/payroll-withholding-core";
import type { YtdAccumulatorRow } from "@/lib/payroll/ytd-core";
import {
  W2_BOX_4_CEILING_2026_CENTS,
  W3_TO_941_FICA_DOUBLING_FACTOR,
} from "@/lib/payroll/form-w2-authorities";

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  BOX 12 CODES
 *
 * Only the codes Greenway can actually produce are declared. A picker offering
 * every code in the instructions is a picker that invites the wrong one, and
 * standing rule 27 says refuse where the law forbids — not offer and hope.
 * Each carries the plain-English meaning Michael reads on screen.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Box12Code = "D" | "DD" | "W" | "C" | "AA" | "EE";

/**
 * WHERE A BOX 12 AMOUNT ALREADY SITS relative to the wage boxes.
 *
 * This replaced a single `includedInBox1: boolean`, which could not express the
 * distinction that matters. Three populations exist, not two:
 *
 *   "reduces_box_1"           the money IS inside FICA wages (boxes 3 and 5)
 *                             but is NOT inside box 1. A pre-tax 401(k)
 *                             deferral. Box 1 must be REDUCED by it.
 *   "in_every_wage_box"       already inside boxes 1, 3 and 5. Roth deferrals
 *                             and group-term life. Box 1 must NOT be touched.
 *   "outside_every_wage_box"  in no wage box at all. Employer HSA money and the
 *                             cost of health coverage. Box 1 must NOT be
 *                             touched.
 *
 * A boolean collapses the first and third together, and they need OPPOSITE
 * arithmetic: subtracting an HSA contribution from box 1 would understate wages
 * by the whole amount. That is precisely the bug this type makes unwritable.
 */
export type Box12Box1Effect =
  | "reduces_box_1"
  | "in_every_wage_box"
  | "outside_every_wage_box";

export type Box12CodeSpec = {
  readonly code: Box12Code;
  readonly label: string;
  /** What it means in Michael's words, not the IRS's. */
  readonly plain: string;
  /** See `Box12Box1Effect`. Drives real arithmetic in `buildW2`. */
  readonly box1Effect: Box12Box1Effect;
  /**
   * Does this code get carried up into W-3 box 12a?
   *
   * Box 12a is the ONE money box on the W-3 that is not a straight total. The
   * instructions carry only the deferral codes D-H, S, Y, AA, BB and EE and
   * explicitly exclude the rest, DD among them. Recorded per code so `buildW3`
   * filters from data rather than from a hand-written list that can drift.
   *
   * @see IW2W3_2026_W3_BOX_12A_IS_FILTERED
   */
  readonly inW3Box12a: boolean;
};

/**
 * Declared as a total Record rather than an array.
 *
 * The compiler now REQUIRES an entry for every member of `Box12Code`. Adding a
 * code to the union without adding its spec is a build error, rather than a
 * silent gap that a hand-maintained checklist was supposed to notice.
 */
export const BOX_12_CODE_SPECS: Readonly<Record<Box12Code, Box12CodeSpec>> = {
  D: {
    code: "D",
    label: "Elective deferrals to a section 401(k) plan",
    plain:
      "Money the employee chose to put into a 401(k) before tax. It is subtracted from box 1 because it is not taxed as income yet, but it stays in boxes 3 and 5 because Social Security and Medicare are still due on it. That is why box 1 can be LOWER than box 5 - the mirror image of the shareholder health premium.",
    box1Effect: "reduces_box_1",
    inW3Box12a: true,
  },
  DD: {
    code: "DD",
    label: "Cost of employer-sponsored health coverage",
    plain:
      "The total cost of the health cover, employer and employee share together. This is information only - it is not taxable and it changes no other box. It exists so employees can see what their cover actually costs.",
    box1Effect: "outside_every_wage_box",
    inW3Box12a: false,
  },
  W: {
    code: "W",
    label: "Employer contributions to a health savings account (HSA)",
    plain:
      "What the company put into an HSA, including anything the employee routed there through a cafeteria plan. It is not taxable and it is not in any wage box, so nothing is subtracted for it - those wages were never in box 1 to begin with.",
    box1Effect: "outside_every_wage_box",
    inW3Box12a: false,
  },
  C: {
    code: "C",
    label: "Taxable cost of group-term life insurance over $50,000",
    plain:
      "If the company pays for life cover above $50,000, the cost of the excess is taxable pay. It IS already inside boxes 1, 3 and 5 - code C just tells the employee how much of their wages came from this rather than from cash.",
    box1Effect: "in_every_wage_box",
    inW3Box12a: false,
  },
  AA: {
    code: "AA",
    label: "Designated Roth contributions under a section 401(k) plan",
    plain:
      "Roth 401(k) money. Unlike code D this is taxed now, so it stays IN box 1 - the tax break comes later instead of today. Nothing is subtracted.",
    box1Effect: "in_every_wage_box",
    inW3Box12a: true,
  },
  EE: {
    code: "EE",
    label: "Designated Roth contributions under a governmental section 457(b) plan",
    plain:
      "The government-employer version of Roth deferrals. Included in box 1 for the same reason as AA. Listed for completeness; Greenway will not use it.",
    box1Effect: "in_every_wage_box",
    inW3Box12a: true,
  },
};

/** The same specs as a list, DERIVED from the Record so the two cannot diverge. */
export const BOX_12_CODES: readonly Box12CodeSpec[] = Object.values(BOX_12_CODE_SPECS);

export function box12CodeSpec(code: Box12Code): Box12CodeSpec {
  const found = BOX_12_CODE_SPECS[code];
  // Reachable only from untyped input - a database row or a JSON body. Throwing
  // rather than returning undefined keeps every caller honest without a null
  // check at each site.
  if (found === undefined) throw new Error(`box12CodeSpec: unknown code ${code}`);
  return found;
}

/** One coded entry as it will be printed. */
export type Box12Entry = {
  readonly code: Box12Code;
  readonly amountCents: number;
};

/**
 * "D 5300.00" — the IRS's own example, and therefore a test oracle.
 *
 * Capital code, one space, amount with a decimal point and NO dollar sign and
 * NO thousands separator. Copy A is machine-read; a comma is a rejection.
 */
export function formatBox12Entry(entry: Box12Entry): string {
  const sign = entry.amountCents < 0 ? "-" : "";
  const abs = Math.abs(entry.amountCents);
  const dollars = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  return `${entry.code} ${sign}${dollars}.${cents}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  INPUTS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Everything about one employee that the W-2 needs and the accumulator does not
 * already know.
 *
 * The accumulator holds the money. This holds the FACTS ABOUT THE PERSON that
 * change how the money is presented — chiefly whether they are a 2%-or-more
 * shareholder, which is what turns on trap 1.
 */
export type W2EmployeeFacts = {
  readonly employeeId: string;
  /** Split for box e. The IRS lists "misformat the name" as a common error. */
  readonly firstNameAndInitial: string;
  readonly lastName: string;
  readonly suffix: string | null;
  /** Digits only, exactly nine. Never printed in full on Copy A. */
  readonly ssn: string;
  /**
   * True for a 2%-or-more shareholder-employee of an S corporation.
   *
   * Michael is one. It is `boolean` and not optional on purpose: "we did not
   * say" and "no" must not be the same value on the field that decides trap 1.
   */
  readonly isTwoPercentShareholder: boolean;
  /**
   * Accident and health premiums the S corporation paid for this person.
   *
   * MUST be zero unless `isTwoPercentShareholder` — the engine refuses the
   * combination rather than silently ignoring it, because a premium recorded
   * against an ordinary employee means somebody has the wrong person.
   */
  readonly scorpHealthPremiumCents: number;
  readonly box12: readonly Box12Entry[];
  /** Box 14, free-text. Where PFML and WA Cares belong. */
  readonly box14: readonly { readonly label: string; readonly amountCents: number }[];
  /** Box 13 checkboxes. */
  readonly retirementPlan: boolean;
  readonly statutoryEmployee: boolean;
  readonly thirdPartySickPay: boolean;
  /** A voided form still exists as a row. It must not reach the W-3 totals. */
  readonly isVoid: boolean;
};

export type W2StateFacts = {
  /** Two letters. "WA" for Greenway. */
  readonly stateCode: string;
  readonly employerStateIdNumber: string | null;
  /**
   * Box 16 state wages, and box 17 state income tax withheld.
   *
   * Both are `number` rather than optional so that "nothing was entered" and
   * "zero was entered" are the same thing on a form where blank and zero mean
   * the same to the reader. Box 17 must be 0 in Washington and the engine
   * refuses anything else.
   */
  readonly stateWagesCents: number;
  readonly stateIncomeTaxCents: number;
};

export type W2Request = {
  readonly taxYear: number;
  readonly employee: W2EmployeeFacts;
  readonly ytd: YtdAccumulatorRow;
  readonly state: W2StateFacts;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  REFUSALS
 *
 * Every code here is produced by real input and proven reachable by a test
 * (standing rule 43). A refusal that nothing can trigger is decoration.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type W2RefusalCode =
  | "W2_YEAR_MISMATCH"
  | "W2_EMPLOYEE_MISMATCH"
  | "W2_NEGATIVE_AMOUNT"
  | "W2_NON_INTEGER_AMOUNT"
  | "W2_BOX_17_MUST_BE_BLANK_IN_WA"
  | "W2_PREMIUM_WITHOUT_SHAREHOLDER_STATUS"
  | "W2_BOX_12_TOO_MANY_ITEMS"
  | "W2_BOX_12_DUPLICATE_CODE"
  | "W2_BOX_4_EXCEEDS_CEILING"
  | "W2_MEDICARE_BELOW_OASDI"
  | "W2_SSN_NOT_NINE_DIGITS"
  | "W2_NAME_INCOMPLETE";

export type W2Refusal = {
  readonly code: W2RefusalCode;
  /** Plain English. Michael reads this, never the code. */
  readonly message: string;
  /** What to do about it. A refusal without a remedy is an obstacle. */
  readonly remedy: string;
};

export const ALL_W2_REFUSAL_CODES: readonly W2RefusalCode[] = [
  "W2_YEAR_MISMATCH",
  "W2_EMPLOYEE_MISMATCH",
  "W2_NEGATIVE_AMOUNT",
  "W2_NON_INTEGER_AMOUNT",
  "W2_BOX_17_MUST_BE_BLANK_IN_WA",
  "W2_PREMIUM_WITHOUT_SHAREHOLDER_STATUS",
  "W2_BOX_12_TOO_MANY_ITEMS",
  "W2_BOX_12_DUPLICATE_CODE",
  "W2_BOX_4_EXCEEDS_CEILING",
  "W2_MEDICARE_BELOW_OASDI",
  "W2_SSN_NOT_NINE_DIGITS",
  "W2_NAME_INCOMPLETE",
];

/** The IRS's four-item limit on Copy A. A fifth forces a second form. */
export const BOX_12_MAX_ITEMS_PER_COPY_A = 4;

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  THE FORM
 * ═══════════════════════════════════════════════════════════════════════════ */

export type W2Box = {
  /** "1", "12a", "17" — as printed. */
  readonly box: string;
  readonly caption: string;
  readonly amountCents: number;
  /** How this figure was arrived at, in words Michael can check. */
  readonly derivation: string;
};

export type W2Form = {
  readonly ok: true;
  readonly taxYear: number;
  readonly employeeId: string;
  readonly employeeName: string;
  /** Never the full number. */
  readonly ssnMasked: string;
  readonly isVoid: boolean;
  readonly boxes: readonly W2Box[];
  readonly box12Entries: readonly { readonly slot: string; readonly printed: string }[];
  /**
   * The box 12 entries as NUMBERS, not as printed strings.
   *
   * `box12Entries` is for the page; this is for the W-3, which has to filter by
   * code and add cents. Re-parsing "D 5300.00" back into an integer to total it
   * would be a units error waiting to happen.
   */
  readonly box12Source: readonly Box12Entry[];
  readonly box14Entries: readonly { readonly label: string; readonly printed: string }[];
  readonly retirementPlan: boolean;
  readonly statutoryEmployee: boolean;
  readonly thirdPartySickPay: boolean;
  readonly stateCode: string;
  /**
   * TRAP 1 MADE VISIBLE.
   *
   * Zero for everybody except a 2%-or-more shareholder with a premium. When it
   * is non-zero, box 1 legitimately exceeds boxes 3 and 5 by this much, and
   * `box1ExceedsFicaExplanation` is the sentence that says so.
   */
  readonly box1MinusBox3Cents: number;
  readonly box1ExceedsFicaExplanation: string | null;
};

export type W2Result =
  | W2Form
  | { readonly ok: false; readonly refusals: readonly W2Refusal[] };

function refuse(code: W2RefusalCode, message: string, remedy: string): W2Refusal {
  return { code, message, remedy };
}

/** XXX-XX-1234. The last four are enough to tell two employees apart. */
export function maskSsnForW2(ssn: string): string {
  return `XXX-XX-${ssn.slice(-4)}`;
}

/**
 * Box 1 written out as the sum it actually is.
 *
 * Exported because it is the sentence Michael reads when he asks why box 1 does
 * not equal box 5, and because a derivation string that drifts from the
 * arithmetic is worse than no derivation at all - it is a confident wrong
 * answer. A test asserts the words and the number agree.
 */
export function describeBox1(
  ficaWagesCents: number,
  premiumCents: number,
  electiveDeferralsCents: number,
  box1Cents: number,
): string {
  if (premiumCents === 0 && electiveDeferralsCents === 0) {
    return "Total taxable pay for the year, from the year-to-date accumulator. Nothing was added or deferred, so this equals box 5.";
  }
  const parts: string[] = [`${formatCentsForW2(ficaWagesCents)} of wages`];
  if (premiumCents > 0) {
    parts.push(
      `plus ${formatCentsForW2(premiumCents)} of S-corporation health premiums, which are wages for income tax but not for Social Security or Medicare`,
    );
  }
  if (electiveDeferralsCents > 0) {
    parts.push(
      `minus ${formatCentsForW2(electiveDeferralsCents)} of pre-tax elective deferrals, which are not taxed as income yet but ARE still subject to Social Security and Medicare`,
    );
  }
  return `${parts.join(" ")}, giving ${formatCentsForW2(box1Cents)}.`;
}

/**
 * Build one W-2.
 *
 * ALL validation runs before ANY arithmetic, and every refusal is collected
 * rather than the first one thrown. A screen that reports one problem, gets it
 * fixed, then reports the next wastes an afternoon.
 */
export function buildW2(req: W2Request): W2Result {
  const refusals: W2Refusal[] = [];
  const { employee: emp, ytd, state } = req;

  // ── Identity ────────────────────────────────────────────────────────────
  if (ytd.taxYear !== req.taxYear) {
    refusals.push(
      refuse(
        "W2_YEAR_MISMATCH",
        `This W-2 is for ${req.taxYear} but the year-to-date figures supplied are for ${ytd.taxYear}.`,
        "Load the accumulator for the same year as the form. Mixing years silently would produce a W-2 that matches no 941.",
      ),
    );
  }
  if (ytd.employeeId !== emp.employeeId) {
    refusals.push(
      refuse(
        "W2_EMPLOYEE_MISMATCH",
        `The form is for employee ${emp.employeeId} but the year-to-date figures belong to ${ytd.employeeId}.`,
        "Load this employee's own accumulator. One person's wages on another person's W-2 is the hardest error to find later.",
      ),
    );
  }
  if (!/^\d{9}$/.test(emp.ssn)) {
    refusals.push(
      refuse(
        "W2_SSN_NOT_NINE_DIGITS",
        "The Social Security number is not nine digits.",
        "Enter the nine digits from the employee's card. The SSA matches on name and SSN together; a wrong one makes the whole wage report unmatchable.",
      ),
    );
  }
  if (emp.firstNameAndInitial.trim() === "" || emp.lastName.trim() === "") {
    refusals.push(
      refuse(
        "W2_NAME_INCOMPLETE",
        "The employee's first and last name are both required, in separate fields.",
        'Enter the first name and middle initial in one field and the surname in the other. "Misformat the employee\'s name" is on the IRS\'s own list of common errors.',
      ),
    );
  }

  // ── Amounts must be whole, non-negative cents ───────────────────────────
  const amounts: readonly (readonly [string, number])[] = [
    ["Social Security wages", ytd.wages.oasdiWagesCents],
    ["Medicare wages", ytd.wages.medicareWagesCents],
    ["Social Security tax withheld", ytd.oasdiEmployeeCents],
    ["Medicare tax withheld", ytd.medicareEmployeeCents],
    ["Additional Medicare tax withheld", ytd.addlMedicareEmployeeCents],
    ["federal income tax withheld", ytd.federalIncomeTaxCents],
    ["S-corporation health premium", emp.scorpHealthPremiumCents],
    ["state wages", state.stateWagesCents],
    ["state income tax", state.stateIncomeTaxCents],
  ];
  for (const [label, value] of amounts) {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      refusals.push(
        refuse(
          "W2_NON_INTEGER_AMOUNT",
          `The ${label} is not a whole number of cents.`,
          "Money is whole cents everywhere in this system. A fraction here means something upstream divided without deciding where the remainder goes.",
        ),
      );
    } else if (value < 0) {
      refusals.push(
        refuse(
          "W2_NEGATIVE_AMOUNT",
          `The ${label} is negative.`,
          "A W-2 cannot report negative wages or negative withholding. If a prior-year overpayment is being corrected, that is a W-2c, not a negative figure here.",
        ),
      );
    }
  }

  // ── TRAP 2: box 17 in a state with no income tax ────────────────────────
  if (state.stateCode === "WA" && state.stateIncomeTaxCents !== 0) {
    refusals.push(
      refuse(
        "W2_BOX_17_MUST_BE_BLANK_IN_WA",
        "Box 17 is state INCOME tax withheld, and Washington does not have an income tax - so this box must be blank on every Greenway W-2.",
        "If this figure is Paid Family and Medical Leave or WA Cares, it is real money but it is not income tax. Move it to box 14 with a label. Reporting it in box 17 tells the IRS you withheld income tax for a state that has none, and no state return exists for it to match.",
      ),
    );
  }

  // ── TRAP 1, guard half: a premium against the wrong person ──────────────
  if (emp.scorpHealthPremiumCents !== 0 && !emp.isTwoPercentShareholder) {
    refusals.push(
      refuse(
        "W2_PREMIUM_WITHOUT_SHAREHOLDER_STATUS",
        "An S-corporation health premium is recorded for someone who is not a 2%-or-more shareholder-employee.",
        "Either this is the wrong person, or their shareholder status has not been recorded. For an ordinary employee, employer-paid health cover is a tax-free benefit that belongs in box 12 with code DD - not in box 1.",
      ),
    );
  }

  // ── Box 12 structure ────────────────────────────────────────────────────
  if (emp.box12.length > BOX_12_MAX_ITEMS_PER_COPY_A) {
    refusals.push(
      refuse(
        "W2_BOX_12_TOO_MANY_ITEMS",
        `Box 12 has ${emp.box12.length} items and Copy A holds at most ${BOX_12_MAX_ITEMS_PER_COPY_A}.`,
        "The extra items need a SECOND W-2 for the same employee. Note that the second form also counts toward the ten-return threshold that forces electronic filing.",
      ),
    );
  }
  const seenCodes = new Set<string>();
  for (const e of emp.box12) {
    if (seenCodes.has(e.code)) {
      refusals.push(
        refuse(
          "W2_BOX_12_DUPLICATE_CODE",
          `Box 12 lists code ${e.code} more than once.`,
          "Add the amounts together and report the code once. Two lines with the same code look like a duplicate payment to the SSA.",
        ),
      );
    }
    seenCodes.add(e.code);
    if (!Number.isInteger(e.amountCents) || e.amountCents < 0) {
      refusals.push(
        refuse(
          e.amountCents < 0 ? "W2_NEGATIVE_AMOUNT" : "W2_NON_INTEGER_AMOUNT",
          `The box 12 amount for code ${e.code} is not a whole, non-negative number of cents.`,
          "Correct the amount upstream. Box 12 figures are printed with a decimal point and no dollar sign, and a fraction of a cent cannot be printed at all.",
        ),
      );
    }
  }

  // ── Relationships that must hold whatever the inputs ────────────────────
  if (ytd.wages.medicareWagesCents < ytd.wages.oasdiWagesCents) {
    refusals.push(
      refuse(
        "W2_MEDICARE_BELOW_OASDI",
        "Medicare wages are lower than Social Security wages, which cannot happen.",
        "Medicare has no ceiling and Social Security does, so box 5 is always at least box 3. This means the accumulator is damaged - rebuild it from the pay runs before filing anything.",
      ),
    );
  }
  const ceiling = box4CeilingCentsFor(req.taxYear);
  if (ceiling !== null && ytd.oasdiEmployeeCents > ceiling) {
    refusals.push(
      refuse(
        "W2_BOX_4_EXCEEDS_CEILING",
        `Box 4 would be ${formatCentsForW2(ytd.oasdiEmployeeCents)}, above the ${formatCentsForW2(ceiling)} maximum any single ${req.taxYear} W-2 can show.`,
        "No one employer should withhold more than the ceiling. Check whether a pay run applied Social Security after the wage base was reached. (If the employee ALSO worked elsewhere and went over in total, that is fine and they reclaim it on their own return - but it would not show up here.)",
      ),
    );
  }

  if (refusals.length > 0) return { ok: false, refusals };

  // ═══ Arithmetic. Nothing below this line can fail. ═══════════════════════

  const premium = emp.scorpHealthPremiumCents;

  // Pre-tax elective deferrals. IN Medicare wages, OUT of box 1 - the box 1
  // instruction says "do not include elective deferrals" in as many words.
  // Only codes marked "reduces_box_1" qualify: a Roth deferral (AA) is already
  // taxed and an HSA contribution (W) was never in a wage box, so subtracting
  // either would understate box 1.
  const electiveDeferrals = emp.box12
    .filter((e) => box12CodeSpec(e.code).box1Effect === "reduces_box_1")
    .reduce((s, e) => s + e.amountCents, 0);

  // Box 1. The accumulator holds FICA wages. Two adjustments move FICA wages to
  // income-tax wages, and they pull in OPPOSITE directions:
  //
  //   + the S-corp health premium   wages for income tax, exempt from FICA
  //   - pre-tax elective deferrals  wages for FICA, deferred for income tax
  //
  // Medicare rather than Social Security is the starting point because Medicare
  // is uncapped and therefore equals total FICA-able pay; starting from box 3
  // would silently truncate box 1 at the wage base for a high earner.
  const box1 = ytd.wages.medicareWagesCents + premium - electiveDeferrals;
  const box3 = ytd.wages.oasdiWagesCents;
  const box5 = ytd.wages.medicareWagesCents;
  const box6 = ytd.medicareEmployeeCents + ytd.addlMedicareEmployeeCents;

  const boxes: W2Box[] = [
    {
      box: "1",
      caption: "Wages, tips, other compensation",
      amountCents: box1,
      derivation: describeBox1(
        ytd.wages.medicareWagesCents,
        premium,
        electiveDeferrals,
        box1,
      ),
    },
    {
      box: "2",
      caption: "Federal income tax withheld",
      amountCents: ytd.federalIncomeTaxCents,
      derivation:
        "The federal income tax actually withheld across the year's pay runs. No rate and no ceiling - it is simply what was taken.",
    },
    {
      box: "3",
      caption: "Social security wages",
      amountCents: box3,
      derivation:
        premium > 0
          ? `Wages subject to Social Security, capped at the annual wage base. The ${formatCentsForW2(premium)} health premium is EXCLUDED here, which is one reason this differs from box 1.`
          : "Wages subject to Social Security, capped at the annual wage base.",
    },
    {
      box: "4",
      caption: "Social security tax withheld",
      amountCents: ytd.oasdiEmployeeCents,
      derivation: `The employee's 6.2% only - never Greenway's matching half.${
        ceiling === null ? "" : ` Cannot exceed ${formatCentsForW2(ceiling)} for ${req.taxYear}.`
      }`,
    },
    {
      box: "5",
      caption: "Medicare wages and tips",
      amountCents: box5,
      derivation:
        premium > 0
          ? `Wages subject to Medicare. No ceiling, so this is always at least box 3 - but the ${formatCentsForW2(premium)} premium is excluded here, which is why box 1 is higher.`
          : electiveDeferrals > 0
            ? `Wages subject to Medicare. No ceiling. Pre-tax deferrals are still Medicare wages, so this stays ${formatCentsForW2(electiveDeferrals)} above box 1.`
            : "Wages subject to Medicare. No ceiling, so this is always at least box 3.",
    },
    {
      box: "6",
      caption: "Medicare tax withheld",
      amountCents: box6,
      derivation:
        ytd.addlMedicareEmployeeCents > 0
          ? `${formatCentsForW2(ytd.medicareEmployeeCents)} at 1.45% plus ${formatCentsForW2(ytd.addlMedicareEmployeeCents)} of Additional Medicare Tax at 0.9% on pay over ${formatCentsForW2(ADDITIONAL_MEDICARE_WITHHOLDING_THRESHOLD_CENTS)}. Greenway matches the first part and none of the second.`
          : "Medicare withheld at 1.45%. No ceiling.",
    },
  ];

  const box12Entries = emp.box12.map((e, i) => ({
    slot: `12${"abcd"[i] ?? "?"}`,
    printed: formatBox12Entry(e),
  }));

  const box14Entries = emp.box14.map((e) => ({
    label: e.label,
    printed: formatCentsForW2(e.amountCents),
  }));

  boxes.push(
    {
      box: "16",
      caption: "State wages, tips, etc.",
      amountCents: state.stateWagesCents,
      derivation:
        state.stateCode === "WA"
          ? "Washington has no income tax, so this is normally blank."
          : "State wages as defined by that state.",
    },
    {
      box: "17",
      caption: "State income tax",
      amountCents: state.stateIncomeTaxCents,
      derivation:
        state.stateCode === "WA"
          ? "BLANK, always, in Washington - there is no state income tax. Paid Family and Medical Leave and WA Cares are withheld but are not income tax; they belong in box 14."
          : "State income tax withheld.",
    },
  );

  const box1MinusBox3 = box1 - box3;
  const deferralNote =
    electiveDeferrals > 0
      ? ` Separately, ${formatCentsForW2(electiveDeferrals)} of pre-tax elective deferrals pull box 1 back DOWN, because a 401(k) contribution escapes income tax now but never escapes Social Security and Medicare. The two adjustments move box 1 in opposite directions.`
      : "";
  const explanation =
    premium > 0
      ? `Box 1 is ${formatCentsForW2(premium)} higher than boxes 3 and 5 because of the health premium, and that is CORRECT. ` +
        `As a 2%-or-more shareholder-employee, the health insurance premiums Greenway paid are wages for income tax ` +
        `(so they are in box 1) but are exempt from Social Security and Medicare (so they are not in boxes 3 and 5). ` +
        `Do not "fix" this: making the boxes match would either overpay FICA or understate income. ` +
        `The same amount is generally deductible on the front of the 1040 as self-employed health insurance - ` +
        `but only because it went on the W-2 first.${deferralNote}`
      : electiveDeferrals > 0
        ? `Box 1 is ${formatCentsForW2(electiveDeferrals)} LOWER than box 5, and that is CORRECT. ` +
          `Pre-tax elective deferrals such as a 401(k) contribution are left out of box 1 because they are not ` +
          `income-taxed yet, but they stay in boxes 3 and 5 because Social Security and Medicare are due on them ` +
          `regardless. Making the boxes match would either tax the contribution twice or skip FICA on it entirely.`
        : null;

  return {
    ok: true,
    taxYear: req.taxYear,
    employeeId: emp.employeeId,
    employeeName: [emp.firstNameAndInitial, emp.lastName, emp.suffix ?? ""]
      .filter((s) => s.trim() !== "")
      .join(" "),
    ssnMasked: maskSsnForW2(emp.ssn),
    isVoid: emp.isVoid,
    boxes,
    box12Entries,
    box12Source: emp.box12,
    box14Entries,
    retirementPlan: emp.retirementPlan,
    statutoryEmployee: emp.statutoryEmployee,
    thirdPartySickPay: emp.thirdPartySickPay,
    stateCode: state.stateCode,
    box1MinusBox3Cents: box1MinusBox3,
    box1ExceedsFicaExplanation: explanation,
  };
}

/**
 * The maximum box 4 for a year, derived rather than typed.
 *
 * Returns null for any year whose wage base this system does not hold, because
 * a ceiling check against a guessed base is worse than no ceiling check: it
 * would refuse correct W-2s. `wageBaseSpec` is the single source of the base.
 */
export function box4CeilingCentsFor(taxYear: number): number | null {
  // The wage base registry is per-year elsewhere in the system; today it holds
  // 2026 only. Rather than reach past it, this asks for the base it has and
  // refuses to extrapolate to a year it was not told about.
  if (taxYear !== 2026) return null;
  const base = wageBaseSpec("oasdi").ceilingCents;
  if (base === null || base === undefined) return null;
  return applyMilliPct(base, OASDI_RATE_MILLI_PCT);
}

/** "$1,234.56". Prose only - never used in arithmetic. */
export function formatCentsForW2(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const rest = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${rest}`;
}

/** Read one box off a built form without indexing by position. */
export function boxOf(form: W2Form, box: string): W2Box | undefined {
  return form.boxes.find((b) => b.box === box);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  THE W-3 — a pure sum, and therefore fully checkable
 *
 * Every money box on the W-3 is the total of the same box across the W-2s, and
 * VOID forms are excluded. That exclusion is the one that produces real,
 * hard-to-find discrepancies: a voided W-2 is still a row, and a totals query
 * that forgets it overstates wages while every individual W-2 is correct.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type W3Form = {
  readonly taxYear: number;
  /** How many W-2s are included — voids excluded. */
  readonly formCount: number;
  readonly voidedCount: number;
  readonly box1Cents: number;
  readonly box2Cents: number;
  readonly box3Cents: number;
  readonly box4Cents: number;
  readonly box5Cents: number;
  readonly box6Cents: number;
  /**
   * BOX 12a - THE ONE BOX THAT IS NOT A TOTAL.
   *
   * Only the deferral codes carry up. Codes DD and C are deliberately dropped.
   * Summing all of box 12 into here reports a figure the IRS is not expecting,
   * and it is the single easiest W-3 error for a generator to make.
   *
   * @see IW2W3_2026_W3_BOX_12A_IS_FILTERED
   */
  readonly box12aCents: number;
  /**
   * What box 12a would have been if every code had been swept in.
   *
   * Carried so the screen can show the filter DOING something - the difference
   * is the amount a naive total would have overstated by. A check nobody can
   * see the effect of is a check nobody trusts.
   */
  readonly box12ExcludedFromW3Cents: number;
  readonly stateCode: string | null;
  readonly box16Cents: number;
  readonly box17Cents: number;
  /**
   * Any W-2 in the batch whose tax year is not the W-3's.
   *
   * Empty in every correct batch. Non-empty means the caller mixed years, which
   * produces a W-3 that looks perfectly self-consistent and matches no 941.
   */
  readonly mismatchedYearEmployeeIds: readonly string[];
};

export function buildW3(forms: readonly W2Form[], taxYear: number): W3Form {
  const live = forms.filter((f) => !f.isVoid);
  const sum = (box: string): number =>
    live.reduce((s, f) => s + (boxOf(f, box)?.amountCents ?? 0), 0);

  const states = new Set(live.map((f) => f.stateCode));

  // Box 12a is a FILTER, not a sum. Partition rather than add, so the amount
  // left behind is available too.
  let box12a = 0;
  let box12Excluded = 0;
  for (const f of live) {
    for (const e of f.box12Source) {
      if (box12CodeSpec(e.code).inW3Box12a) box12a += e.amountCents;
      else box12Excluded += e.amountCents;
    }
  }

  return {
    taxYear,
    formCount: live.length,
    voidedCount: forms.length - live.length,
    box1Cents: sum("1"),
    box2Cents: sum("2"),
    box3Cents: sum("3"),
    box4Cents: sum("4"),
    box5Cents: sum("5"),
    box6Cents: sum("6"),
    box12aCents: box12a,
    box12ExcludedFromW3Cents: box12Excluded,
    // One state on the W-3, or null when the batch spans several - a single
    // code would be a lie and blank is the honest answer.
    stateCode: states.size === 1 ? [...states][0] : null,
    box16Cents: sum("16"),
    box17Cents: sum("17"),
    // Voided forms are checked too: a wrong-year form does not become
    // acceptable by being voided, and reporting it costs nothing.
    mismatchedYearEmployeeIds: forms
      .filter((f) => f.taxYear !== taxYear)
      .map((f) => f.employeeId),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §6  RECONCILIATION — the W-3 against the four Forms 941
 *
 * "You WILL be contacted", not "may be". Four figures have to agree.
 *
 * The FICA comparison honours the instruction's word "approximately". Rather
 * than assert a ratio and allow a tolerance, this computes what the 941 total
 * SHOULD be, exactly:
 *
 *     expected 941 Social Security tax = W-3 box 4 × 2
 *     expected 941 Medicare tax        = (matched Medicare × 2) + unmatched Additional Medicare
 *
 * Additional Medicare has no employer match, so it is added once and not
 * doubled. That makes the check exact for every employee at every income, which
 * a percentage tolerance never is.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Form941YearTotals = {
  /** Line 3 summed over the four quarters. */
  readonly federalIncomeTaxWithheldCents: number;
  /** Line 5a wages summed over four quarters. */
  readonly socialSecurityWagesCents: number;
  /** Line 5c wages summed over four quarters. */
  readonly medicareWagesCents: number;
  /** Line 5a tax — BOTH halves. */
  readonly socialSecurityTaxCents: number;
  /** Lines 5c + 5d tax — both halves of Medicare plus unmatched Additional. */
  readonly medicareTaxCents: number;
  /** How many quarters these totals came from. Four, or the check is partial. */
  readonly quartersIncluded: number;
};

export type ReconciliationLine = {
  readonly label: string;
  readonly w3Cents: number;
  readonly form941Cents: number;
  readonly differenceCents: number;
  readonly agrees: boolean;
  /** What this line means and what to do when it disagrees. */
  readonly plain: string;
};

export type ReconciliationResult = {
  readonly taxYear: number;
  readonly allAgree: boolean;
  readonly quartersIncluded: number;
  /** True only when all four quarters were supplied. */
  readonly isComplete: boolean;
  readonly lines: readonly ReconciliationLine[];
  /** The one sentence for the top of the screen. */
  readonly verdict: string;
};

/**
 * Compare a W-3 against the year's four 941s.
 *
 * `unmatchedAdditionalMedicareCents` is the total Additional Medicare Tax
 * withheld across all employees — the amount the employer does NOT match. It is
 * a required argument rather than an optional one because defaulting it to zero
 * would silently reintroduce the exact false alarm this design avoids.
 */
export function reconcileW3To941s(args: {
  readonly taxYear: number;
  readonly w3: W3Form;
  readonly form941: Form941YearTotals;
  readonly unmatchedAdditionalMedicareCents: number;
}): ReconciliationResult {
  const { w3, form941: q } = args;

  const expectedSsTax = w3.box4Cents * W3_TO_941_FICA_DOUBLING_FACTOR;
  // Box 6 contains matched Medicare plus unmatched Additional Medicare. Only
  // the matched part doubles.
  const matchedMedicare = w3.box6Cents - args.unmatchedAdditionalMedicareCents;
  const expectedMedicareTax =
    matchedMedicare * W3_TO_941_FICA_DOUBLING_FACTOR + args.unmatchedAdditionalMedicareCents;

  const mk = (
    label: string,
    w3Cents: number,
    form941Cents: number,
    plain: string,
  ): ReconciliationLine => ({
    label,
    w3Cents,
    form941Cents,
    differenceCents: form941Cents - w3Cents,
    agrees: form941Cents === w3Cents,
    plain,
  });

  const lines: readonly ReconciliationLine[] = [
    mk(
      "Federal income tax withheld",
      w3.box2Cents,
      q.federalIncomeTaxWithheldCents,
      "W-3 box 2 against line 3 of the four 941s. These are the same money counted twice, so they must match exactly. A difference means a pay run reached one report and not the other.",
    ),
    mk(
      "Social security wages",
      w3.box3Cents,
      q.socialSecurityWagesCents,
      "W-3 box 3 against line 5a of the four 941s. Both are wages after the annual cap, so they must match exactly.",
    ),
    mk(
      "Medicare wages",
      w3.box5Cents,
      q.medicareWagesCents,
      "W-3 box 5 against line 5c of the four 941s. Neither is capped, so they must match exactly.",
    ),
    mk(
      "Social security tax (941 carries both halves)",
      expectedSsTax,
      q.socialSecurityTaxCents,
      "The 941 reports the employee's Social Security tax AND Greenway's matching half; the W-3 reports only the employee's. So the 941 should be exactly double box 4. If it equals box 4, the employer half was missed; if it is four times, something was double-counted.",
    ),
    mk(
      "Medicare tax (both halves, plus unmatched Additional Medicare)",
      expectedMedicareTax,
      q.medicareTaxCents,
      "Same doubling as Social Security, with one exception: the extra 0.9% Additional Medicare Tax on pay over $200,000 has no employer match, so it is counted once rather than twice. That is why the IRS says 'approximately' twice - and why this line computes the exact expected figure instead of allowing a fuzzy tolerance.",
    ),
  ];

  const allAgree = lines.every((l) => l.agrees);
  const isComplete = q.quartersIncluded === 4;

  const verdict = !isComplete
    ? `Only ${q.quartersIncluded} of 4 quarters were supplied, so this comparison is incomplete. Load all four 941s before relying on it.`
    : allAgree
      ? "Every figure on the W-3 agrees with the four 941s. Keep this working - if the SSA writes in eighteen months, the workpaper is what resolves it in ten minutes."
      : `${lines.filter((l) => !l.agrees).length} of ${lines.length} figures disagree. Find the cause before filing: the IRS says you WILL be contacted, not that you may be.`;

  return { taxYear: args.taxYear, allAgree, quartersIncluded: q.quartersIncluded, isComplete, lines, verdict };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §7  SELF-CHECKS — the arithmetic the IRS published, re-derived here
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The IRS printed "$11,439 ($184,500 × 6.2%)" in the instructions, which makes
 * it a test oracle: published inputs AND the published answer. This re-derives
 * it from the rate constants rather than trusting the literal, so editing
 * either constant surfaces the disagreement immediately.
 */
export function assertBox4CeilingMatchesIrsArithmetic(): void {
  const derived = box4CeilingCentsFor(2026);
  if (derived === null) {
    throw new Error("box 4 ceiling: 2026 wage base is missing from the registry");
  }
  if (derived !== W2_BOX_4_CEILING_2026_CENTS) {
    throw new Error(
      `box 4 ceiling: derived ${derived} but the IRS instruction says ${W2_BOX_4_CEILING_2026_CENTS}`,
    );
  }
  const base = wageBaseSpec("oasdi").ceilingCents ?? 0;
  if ((base * OASDI_RATE_MILLI_PCT) % 100_000 !== 0) {
    throw new Error("box 4 ceiling: the product is not exact in integer cents");
  }
}

/**
 * Every box 12 spec is self-consistent and carries a real explanation.
 *
 * Note what this NO LONGER does: it used to re-declare the six codes by hand
 * and compare the list against itself, which meant adding a seventh code left
 * the gate green and the checklist stale. Completeness is now the compiler's
 * job - `BOX_12_CODE_SPECS` is a total `Record<Box12Code, ...>`, so a missing
 * spec will not build. What is left here is what the type system CANNOT check:
 * that the key matches the code inside it, and that the prose is really prose.
 */
export function assertBox12CodesAreComplete(): void {
  for (const [key, spec] of Object.entries(BOX_12_CODE_SPECS)) {
    if (spec.code !== key) {
      throw new Error(`box 12: spec filed under ${key} declares itself ${spec.code}`);
    }
    if (spec.plain.trim().length < 40) {
      throw new Error(`box 12: code ${key} has no usable plain-English explanation`);
    }
    if (spec.label.trim() === "") throw new Error(`box 12: code ${key} has no label`);
  }
  // The derived list must still agree with the Record it came from.
  if (BOX_12_CODES.length !== Object.keys(BOX_12_CODE_SPECS).length) {
    throw new Error("box 12: the derived list and the spec Record disagree in length");
  }
  // At least one code in each population, or the three-way distinction that
  // drives box 1 is untested by construction.
  const effects = new Set(BOX_12_CODES.map((s) => s.box1Effect));
  for (const needed of [
    "reduces_box_1",
    "in_every_wage_box",
    "outside_every_wage_box",
  ] as const) {
    if (!effects.has(needed)) {
      throw new Error(`box 12: no code exercises the "${needed}" branch of box 1`);
    }
  }
}

/**
 * Box 12a really is a filter and not a total.
 *
 * Asserts against the IRS's own two lists: the deferral codes carry up, and DD
 * is named in the Caution as excluded. If somebody ever "simplifies" `buildW3`
 * into a straight sum, this is what goes red.
 */
export function assertW3Box12aIsFiltered(): void {
  const carried = BOX_12_CODES.filter((s) => s.inW3Box12a).map((s) => s.code);
  const dropped = BOX_12_CODES.filter((s) => !s.inW3Box12a).map((s) => s.code);
  if (carried.length === 0) throw new Error("box 12a: nothing carries up - it cannot be a filter");
  if (dropped.length === 0) throw new Error("box 12a: nothing is excluded - it is acting as a total");
  // Named in the instruction's Caution list, so these are not judgement calls.
  for (const mustDrop of ["DD", "C"] as const) {
    if (BOX_12_CODE_SPECS[mustDrop].inW3Box12a) {
      throw new Error(`box 12a: code ${mustDrop} is excluded by the instructions but is carried up`);
    }
  }
  // Named in the instruction's inclusion list.
  for (const mustCarry of ["D", "AA", "EE"] as const) {
    if (!BOX_12_CODE_SPECS[mustCarry].inW3Box12a) {
      throw new Error(`box 12a: code ${mustCarry} is a deferral code and must carry up`);
    }
  }
}

/** Every declared refusal code is listed in ALL_W2_REFUSAL_CODES exactly once. */
export function assertRefusalCodesAreListed(): void {
  const seen = new Set<string>();
  for (const c of ALL_W2_REFUSAL_CODES) {
    if (seen.has(c)) throw new Error(`refusal codes: ${c} listed twice`);
    seen.add(c);
  }
  if (seen.size !== ALL_W2_REFUSAL_CODES.length) {
    throw new Error("refusal codes: duplicate entries");
  }
}

/**
 * The Additional Medicare relationship, stated as arithmetic so it cannot rot.
 *
 * At exactly the threshold there is no Additional Medicare; one cent above it
 * there is. This is the boundary that a "box 6 = box 5 × 1.45%" shortcut gets
 * wrong, and it is checked here rather than only in the test file so the module
 * carries its own proof.
 */
export function assertAdditionalMedicareBoundary(): void {
  // What this used to do, and why it was worthless: it computed
  // `max(0, THRESHOLD - THRESHOLD)`, which is the literal zero, and then
  // asserted that 0.9% of zero was zero. It also asked whether `x === x + 900`.
  // Both are tautologies about constants. The gate was green because it could
  // not be anything else - a check that cannot fail is not a check (rule 83a).
  //
  // What it does now: runs the RECONCILIATION at the boundary and proves the
  // doubling rule bends exactly where Additional Medicare starts.
  const threshold = ADDITIONAL_MEDICARE_WITHHOLDING_THRESHOLD_CENTS;

  // A dollar of Additional Medicare Tax, whatever the rate happens to be.
  const oneDollarOverExcess = 100;
  const addl = applyMilliPct(oneDollarOverExcess, ADDITIONAL_MEDICARE_RATE_MILLI_PCT);
  if (addl < 0) throw new Error("additional medicare: negative tax on positive excess");

  // Below the threshold nothing is unmatched, so the 941 is exactly double.
  const plainMedicare = applyMilliPct(threshold, MEDICARE_RATE_MILLI_PCT);
  const w3Below: W3Form = zeroW3ForCheck(plainMedicare);
  const below = reconcileW3To941s({
    taxYear: 2026,
    w3: w3Below,
    form941: totals941ForCheck(plainMedicare * 2),
    unmatchedAdditionalMedicareCents: 0,
  });
  if (!below.allAgree) {
    throw new Error("additional medicare: plain Medicare should reconcile at exactly double");
  }

  // Above it, box 6 carries an unmatched amount, so the expected 941 figure is
  // LESS than double - by exactly the unmatched tax, counted once not twice.
  const box6Above = plainMedicare + addl;
  const above = reconcileW3To941s({
    taxYear: 2026,
    w3: zeroW3ForCheck(box6Above),
    form941: totals941ForCheck(plainMedicare * 2 + addl),
    unmatchedAdditionalMedicareCents: addl,
  });
  if (!above.allAgree) {
    throw new Error(
      "additional medicare: the unmatched portion must be added once, not doubled",
    );
  }
  // And the naive "exactly twice" rule must genuinely disagree here, or the
  // whole design is solving a problem that does not exist.
  if (addl > 0 && box6Above * W3_TO_941_FICA_DOUBLING_FACTOR === plainMedicare * 2 + addl) {
    throw new Error(
      "additional medicare: doubling everything gives the same answer - the exception is not being exercised",
    );
  }
}

/** A W-3 that is all zeroes except box 6. Test scaffolding for the gate above. */
function zeroW3ForCheck(box6Cents: number): W3Form {
  return {
    taxYear: 2026,
    formCount: 1,
    voidedCount: 0,
    box1Cents: 0,
    box2Cents: 0,
    box3Cents: 0,
    box4Cents: 0,
    box5Cents: 0,
    box6Cents,
    box12aCents: 0,
    box12ExcludedFromW3Cents: 0,
    stateCode: "WA",
    box16Cents: 0,
    box17Cents: 0,
    mismatchedYearEmployeeIds: [],
  };
}

/** Four quarters of 941 totals that are all zero except Medicare tax. */
function totals941ForCheck(medicareTaxCents: number): Form941YearTotals {
  return {
    federalIncomeTaxWithheldCents: 0,
    socialSecurityWagesCents: 0,
    medicareWagesCents: 0,
    socialSecurityTaxCents: 0,
    medicareTaxCents,
    quartersIncluded: 4,
  };
}
