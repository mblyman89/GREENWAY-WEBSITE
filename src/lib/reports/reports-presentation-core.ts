/**
 * src/lib/reports/reports-presentation-core.ts   (books-27)
 *
 * THE READABILITY ENGINE. Same power as Sage, laid out so a human can read it.
 *
 * Michael, verbatim (standing rule 1):
 *   "I don't want ours to be ugly with headers that are stacked in that weird
 *    way making the data impossible to read and understand. I want the same
 *    amount of power Sage has, but displayed in a way that is significantly
 *    easier to read and understand."
 * And, from the Sage baseline §8.3:
 *   "I don't use any of the reports in the screenshot really because I don't
 *    understand fully what it is showing me."
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM, MEASURED RATHER THAN FELT (standing rule 11)
 * ---------------------------------------------------------------------------
 *
 * "Ugly" is not a specification. Before writing a line of this engine the
 * thirteen Sage reports were read and the defects counted, and they are
 * recorded in docs/SAGE_PAYROLL_BASELINE_2026.md:
 *
 *   §8.9  THIRTY-THREE value columns, wrapped over EIGHT physical lines per
 *         employee. That is the "stacked headers" Michael is describing. With
 *         26 employees that is 208 physical lines to show 26 people's pay.
 *
 *   §8.9  Column names are machine tokens: FIT_COGS, SS_COG, MED_COGS,
 *         WAPFML_COG, WALTC_SAL, SUI2_COGS_C, FUI_SALES_C, WALIER_COG. To read
 *         that row you must already know that SUI2 is the EAF surcharge, that
 *         WALTC is WA Cares under its old name, and that a trailing _C means
 *         the employer's side. Nine of those tokens are not English words.
 *
 *   §8.3  26 employees listed to tell him about 10. Fifteen are inactive
 *         records with 0.00 in every column. 58% of the rows are noise.
 *
 *   §8.7  The Employee Compensation report: seven columns, 26 employees, and
 *         EVERY CELL BLANK. Structure with no content.
 *
 *   §8.8  Negative sick-leave balances printed as bare negatives (-48.01),
 *         which reads like a bug rather than "48 hours advanced".
 *
 * Those five are the acceptance criteria. This engine is not "prettier"; it is
 * measurably answering each one, and the tests assert the counts.
 *
 * ---------------------------------------------------------------------------
 * WHY THE AUTHORITY FILE EXISTS NEXT DOOR
 * ---------------------------------------------------------------------------
 *
 * Layout decisions made on taste get undone on taste. Every rule below cites
 * `reporting-authorities.ts`, whose quotes are verified verbatim against the
 * primary sources by scripts/verify-verbatim-quotes.ts on every CI run. The
 * FASB has a qualitative characteristic named UNDERSTANDABILITY (CON 8 QC30)
 * and an entire section on aggregation (PR35/PR36) that says, in terms, that
 * too little aggregation drowns the reader and too much destroys information.
 * This engine implements that sentence.
 *
 * ---------------------------------------------------------------------------
 * PURITY AND UNITS
 * ---------------------------------------------------------------------------
 *
 * No I/O, no Date.now(), no randomness, no server imports. Every function is a
 * total function of its arguments so the tests can sweep domains rather than
 * sample a happy value (standing rule 15b).
 *
 * MONEY IS INTEGER CENTS. Never floats (standing rule 13e). A report that
 * rounds differently from the engine that filed the return is a report that
 * starts an argument with the IRS, and the books-26 fixture (Q2 2026 line 12 =
 * 1_420_457 cents) is the reason we know our arithmetic matches his filing to
 * the penny.
 */

import {
  CON8_QC30_UNDERSTANDABILITY,
  CON8_QC31_OMISSION_MISLEADS,
  CON8_PR35_AGGREGATION_REQUIRED,
  CON8_PR36_OVER_AGGREGATION,
  CON8_PR13_DETAIL_CANNOT_BE_RECOVERED,
  ASC_205_10_45_1_COMPARATIVES,
  ASC_205_10_45_3_COMPARABILITY,
} from "./reporting-authorities";

// ---------------------------------------------------------------------------
// 1) THE SAGE TOKEN DICTIONARY — machine names to English
// ---------------------------------------------------------------------------

/**
 * What each Sage payroll field actually means, in words.
 *
 * EVERY ENTRY WAS DECODED FROM MICHAEL'S OWN REPORTS AND CONFIRMED
 * ARITHMETICALLY, not guessed from the name (standing rule 1). The proofs are
 * written up in the baseline §8.9. Two examples, because the difference between
 * decoding and guessing is the whole point:
 *
 *   WALTC — the name says "long-term care", which is WA Cares under its
 *   original title. CONFIRMED: WALTC_COG 606.48 + WALTC_SAL 387.13 = 993.61,
 *   and 0.58% of the annual gross 171,297.28 = 993.52. The rate matches the
 *   WA Cares statutory ceiling in RCW 50B.04.080(1).
 *
 *   SUI2 — nothing in the name says what the "2" is. It is the EAF surcharge,
 *   confirmed because the filed Q2 return prints UI at 0.37% and EAF at 0.03%
 *   as separate lines, and SUI2 tracks the second.
 *
 * `plain` is what the report prints. `expanded` is the tooltip. `sageToken` is
 * kept so that when Michael sets our report beside a Sage one he can see they
 * are the same field — migrating someone's mental model is not the same as
 * replacing it.
 */
export type FieldMeaning = {
  readonly sageToken: string;
  readonly plain: string;
  readonly expanded: string;
  /** Who actually pays it. The single most confusing thing about payroll. */
  readonly bornBy: "employee" | "employer" | "both" | "n/a";
  /** Which §280E side the cost sits on, where that applies. */
  readonly costSide: "cogs" | "selling" | "split" | "n/a";
};

export const SAGE_FIELD_DICTIONARY: readonly FieldMeaning[] = [
  {
    sageToken: "Gross",
    plain: "Gross pay",
    expanded: "Everything earned before a single deduction — the number the employee thinks of as their pay.",
    bornBy: "employee",
    costSide: "split",
  },
  {
    sageToken: "FIT",
    plain: "Federal income tax withheld",
    expanded:
      "Income tax held back from the employee's cheque and forwarded to the IRS. It is the employee's money the whole time; you are only the custodian.",
    bornBy: "employee",
    costSide: "n/a",
  },
  {
    sageToken: "SS",
    plain: "Social Security (employee half)",
    expanded: "6.2% of wages, withheld from the employee. You match it separately — that is the _C row.",
    bornBy: "employee",
    costSide: "n/a",
  },
  {
    sageToken: "SS_C",
    plain: "Social Security (your half)",
    expanded: "Your matching 6.2%. This one is your expense, not a withholding — it costs you real money.",
    bornBy: "employer",
    costSide: "split",
  },
  {
    sageToken: "MED",
    plain: "Medicare (employee half)",
    expanded: "1.45% of wages, withheld from the employee. No wage cap, unlike Social Security.",
    bornBy: "employee",
    costSide: "n/a",
  },
  {
    sageToken: "MED_C",
    plain: "Medicare (your half)",
    expanded: "Your matching 1.45%. Your expense. Together with your Social Security half this is the 7.65% everyone quotes.",
    bornBy: "employer",
    costSide: "split",
  },
  {
    sageToken: "FUI",
    plain: "Federal unemployment (FUTA)",
    expanded:
      "Federal unemployment tax. Employer-only — never withheld from anyone. Reported once a year on Form 940, not on the quarterly 941.",
    bornBy: "employer",
    costSide: "split",
  },
  {
    sageToken: "SUI",
    plain: "State unemployment (UI)",
    expanded:
      "Washington unemployment insurance, employer-only. Your rate is specific to your business and history — for 2026 it is 0.37%, which the filed Q2 return prints on its face.",
    bornBy: "employer",
    costSide: "split",
  },
  {
    sageToken: "SUI2",
    plain: "Employment Administration Fund (EAF)",
    expanded:
      "A separate Washington surcharge that rides alongside unemployment, which is why Sage numbered it 2. Yours is 0.03%. Sage has been calculating it at 0.64% — that is one of the two real defects found in your live books.",
    bornBy: "employer",
    costSide: "split",
  },
  {
    sageToken: "WAPFML",
    plain: "Paid Family & Medical Leave",
    expanded:
      "Washington's paid-leave premium. You have fewer than fifty employees, so you are exempt from the employer share and correctly pay 0.00 of it — the employee portion is still withheld.",
    bornBy: "employee",
    costSide: "n/a",
  },
  {
    sageToken: "WALTC",
    plain: "WA Cares",
    expanded:
      "Washington's long-term-care programme — the token says LTC because that was its original name. Employee-paid only. Your Q2 total was 399.76, correctly reported on the filed return.",
    bornBy: "employee",
    costSide: "n/a",
  },
  {
    sageToken: "WALIER",
    plain: "L&I workers' compensation",
    expanded:
      "Industrial insurance, charged per HOUR worked rather than per dollar earned — which is why it is the one line that does not move with wages. One risk class, 6403-05, at 0.5593 per hour.",
    bornBy: "both",
    costSide: "split",
  },
  {
    sageToken: "SICK_Accrue",
    plain: "Sick leave earned",
    expanded:
      "Paid sick leave earned this period. Confirmed from your own paycheques at one hour per forty worked, which is the Washington statutory floor.",
    bornBy: "n/a",
    costSide: "n/a",
  },
  {
    sageToken: "SICK_Taken",
    plain: "Sick leave used",
    expanded: "Paid sick hours actually taken in the period.",
    bornBy: "n/a",
    costSide: "n/a",
  },
  {
    sageToken: "SICK_Remain",
    plain: "Sick leave balance",
    expanded:
      "What is left. When this is negative it means you ADVANCED leave the person had not yet earned — permissible and generous, but our reports say 'advanced' rather than printing a bare minus sign that looks like a bug.",
    bornBy: "n/a",
    costSide: "n/a",
  },
  {
    sageToken: "LOAN_01",
    plain: "Employee loan repayment",
    expanded: "A repayment withheld from net pay against a loan you made. Not a tax and not an expense — it is your money coming back.",
    bornBy: "employee",
    costSide: "n/a",
  },
  {
    sageToken: "PREMERA_C",
    plain: "Medical insurance (employer-paid)",
    expanded: "Your share of medical cover. An employer cost, not a withholding.",
    bornBy: "employer",
    costSide: "split",
  },
  {
    sageToken: "DELTA_C",
    plain: "Dental insurance (employer-paid)",
    expanded: "Your share of dental cover. An employer cost, not a withholding.",
    bornBy: "employer",
    costSide: "split",
  },
] as const;

/**
 * Translate a Sage token to English.
 *
 * SUFFIX-AWARE, because Sage encodes THREE facts in one token: the levy, the
 * §280E cost side (_COGS/_COG vs _SALES/_SAL), and whether it is the employer's
 * half (trailing _C). `SUI2_COGS_C` is EAF + cost-of-goods labour + employer
 * side. A dictionary keyed on whole tokens would need 33 entries and would go
 * stale the moment Sage adds a department; decomposing is the smaller,
 * verifiable thing.
 *
 * ORDER MATTERS AND IS TESTED. `_C` must be stripped before `_COG`, or
 * "SS_COGS_C" loses its "_C" to the wrong rule. There is a negative-control
 * test for exactly that.
 *
 * Returns null for an unknown token rather than inventing a meaning. A report
 * that silently mislabels a column is worse than one that admits it does not
 * know — standing rule 1, and the whole reason Michael cannot trust Sage's.
 */
export function decodeSageToken(token: string): {
  readonly meaning: FieldMeaning;
  readonly costSide: "cogs" | "selling" | "unspecified";
  readonly isEmployerSide: boolean;
} | null {
  if (typeof token !== "string" || token.length === 0) return null;

  let rest = token.trim();
  if (rest.length === 0) return null;

  // 1) Employer-side marker FIRST. It is always the outermost suffix.
  let isEmployerSide = false;
  if (rest.endsWith("_C")) {
    isEmployerSide = true;
    rest = rest.slice(0, -2);
  }

  // 2) Then the cost side. Sage is inconsistent about the plural (COG vs COGS,
  //    SAL vs SALES) — both spellings appear in the same report, which is
  //    itself part of why these are hard to read.
  let costSide: "cogs" | "selling" | "unspecified" = "unspecified";
  for (const suffix of ["_COGS", "_COG"] as const) {
    if (rest.endsWith(suffix)) {
      costSide = "cogs";
      rest = rest.slice(0, -suffix.length);
      break;
    }
  }
  if (costSide === "unspecified") {
    for (const suffix of ["_SALES", "_SAL"] as const) {
      if (rest.endsWith(suffix)) {
        costSide = "selling";
        rest = rest.slice(0, -suffix.length);
        break;
      }
    }
  }

  // 3) What is left is the levy. Look for the employer variant first when the
  //    _C marker was present, because SS and SS_C are genuinely different
  //    facts with different payers.
  const wanted = isEmployerSide ? `${rest}_C` : rest;
  const direct = SAGE_FIELD_DICTIONARY.find((f) => f.sageToken === wanted);
  if (direct) return { meaning: direct, costSide, isEmployerSide };

  const base = SAGE_FIELD_DICTIONARY.find((f) => f.sageToken === rest);
  if (base) return { meaning: base, costSide, isEmployerSide };

  return null;
}

// ---------------------------------------------------------------------------
// 2) THE LAYOUT RULES — each one answers a measured Sage defect
// ---------------------------------------------------------------------------

/**
 * A layout rule, stated so it can be argued with and tested.
 *
 * `sageDefect` names the thing in Michael's actual reports that this rule
 * fixes, with the baseline section that measured it. `authorityIds` ties the
 * rule to quoted text. A rule with neither is a preference, and preferences do
 * not belong in an engine.
 */
export type LayoutRule = {
  readonly id: string;
  readonly rule: string;
  readonly sageDefect: string;
  readonly baselineSection: string;
  readonly authorityIds: readonly string[];
};

export const LAYOUT_RULES: readonly LayoutRule[] = [
  {
    id: "one-row-per-subject",
    rule:
      "One subject gets ONE row. If a row cannot fit the width, the answer is fewer columns on the summary and a detail view underneath — never the same row wrapped over eight physical lines.",
    sageDefect:
      "The Current/Quarterly/Yearly Earnings reports print 33 value columns wrapped over 8 physical lines per employee. Twenty-six employees becomes 208 lines, and the eye cannot follow one person across the wrap.",
    baselineSection: "§8.9",
    authorityIds: [CON8_QC30_UNDERSTANDABILITY.id, CON8_PR35_AGGREGATION_REQUIRED.id],
  },
  {
    id: "english-column-names",
    rule:
      "Every column is named in English. The machine token is available on hover for anyone reconciling against Sage, but it is never the label.",
    sageDefect:
      "Columns are named FIT_COGS, SS_COG, WAPFML_COG, WALTC_SAL, SUI2_COGS_C, FUI_SALES_C, WALIER_COG. Reading a row requires knowing that SUI2 means the EAF surcharge and WALTC means WA Cares.",
    baselineSection: "§8.9",
    authorityIds: [CON8_QC30_UNDERSTANDABILITY.id],
  },
  {
    id: "summary-then-detail",
    rule:
      "Lead with the handful of numbers that answer the question, and put everything else one click away. Nothing is deleted; it is ranked.",
    sageDefect:
      "Every Sage report opens at full detail, so the important number and the trivial one arrive with equal weight and the reader has to do the ranking.",
    baselineSection: "§8.9",
    authorityIds: [CON8_PR35_AGGREGATION_REQUIRED.id, CON8_PR36_OVER_AGGREGATION.id, CON8_PR13_DETAIL_CANNOT_BE_RECOVERED.id],
  },
  {
    id: "suppress-empty-subjects",
    rule:
      "A subject with nothing to report is hidden by default and the count of hidden subjects is stated on the report. Hidden is not deleted, and the reader is told.",
    sageDefect:
      "The Exception Report lists all 26 employees to tell Michael about 10. Fifteen have 0.00 in every column. 58% of the rows carry no information.",
    baselineSection: "§8.3",
    authorityIds: [CON8_PR35_AGGREGATION_REQUIRED.id, CON8_QC31_OMISSION_MISLEADS.id],
  },
  {
    id: "no-empty-reports",
    rule:
      "A report with no data says so in a sentence, explains what would populate it, and does not render an empty grid.",
    sageDefect:
      "The Employee Compensation report renders 7 columns for 26 employees with EVERY CELL BLANK. It has never been populated, so it teaches nothing and nobody opens it.",
    baselineSection: "§8.7",
    authorityIds: [CON8_QC30_UNDERSTANDABILITY.id],
  },
  {
    id: "name-the-sign",
    rule:
      "A negative number that means something specific is labelled with what it means, not printed as a bare minus sign.",
    sageDefect:
      "Four of eight employees show negative sick-leave balances (Angela -48.01). That is advanced leave, which is legal and deliberate, but a bare negative reads like a bug.",
    baselineSection: "§8.8",
    authorityIds: [CON8_QC30_UNDERSTANDABILITY.id],
  },
  {
    id: "always-comparative",
    rule:
      "Every figure is shown against a comparison period, with the change stated in both dollars and percent.",
    sageDefect:
      "The payroll reports print a single period in isolation, so a number can only be judged against memory.",
    baselineSection: "§8.9",
    authorityIds: [ASC_205_10_45_1_COMPARATIVES.id],
  },
  {
    id: "refuse-false-comparison",
    rule:
      "When something material changed between the two periods, the comparison is annotated and the percentage is withheld rather than printed as though it were like-for-like.",
    sageDefect:
      "Nothing in Sage knows that the unemployment rate moved from 0.64% to 0.37%, so a trend line across that boundary looks like a business change when it is a rate change.",
    baselineSection: "§9",
    authorityIds: [ASC_205_10_45_3_COMPARABILITY.id],
  },
] as const;

// ---------------------------------------------------------------------------
// 3) COMPARISON — the arithmetic behind "up 12.0% from last quarter"
// ---------------------------------------------------------------------------

export type ComparabilityBreak = {
  /** What changed between the periods, in Michael's words. */
  readonly what: string;
  /** Why it makes the two periods not like-for-like. */
  readonly why: string;
};

export type PeriodComparison =
  | {
      readonly ok: true;
      readonly currentCents: number;
      readonly priorCents: number;
      readonly changeCents: number;
      /** Basis points, integer. 1_200 = 12.00%. Null when prior is zero. */
      readonly changeBasisPoints: number | null;
      readonly direction: "up" | "down" | "flat";
      readonly plain: string;
    }
  | {
      readonly ok: false;
      readonly currentCents: number;
      readonly priorCents: number;
      readonly changeCents: number;
      readonly refusalReason: string;
      readonly breaks: readonly ComparabilityBreak[];
      readonly plain: string;
    };

/**
 * Compare a figure against the prior period.
 *
 * WHY THIS CAN REFUSE. ASC 205-10-45-3 says prior figures "shall in fact be
 * comparable" and any exception "shall be clearly brought out." Two shalls.
 * When a rate changed underneath the numbers, a percentage is not a fact about
 * the business — it is a fact about the rate — and printing it unqualified is
 * the report telling a confident lie. So when the caller declares a break, we
 * still show both amounts and the dollar difference (those remain true) and we
 * withhold the percentage while naming what changed.
 *
 * WHY BASIS POINTS AND NOT A FLOAT. Standing rule 13e. 12.34% is 1_234, exactly,
 * forever. A float percentage re-derived on a screen is how two pages come to
 * disagree about the same change.
 *
 * DIVISION BY ZERO IS A REAL CASE, not an edge case: the first quarter after
 * cutover has no prior. It returns a null percentage with an English sentence
 * rather than Infinity or NaN.
 */
export function comparePeriods(
  currentCents: number,
  priorCents: number,
  breaks: readonly ComparabilityBreak[] = [],
): PeriodComparison {
  if (!Number.isInteger(currentCents) || !Number.isInteger(priorCents)) {
    throw new Error(
      `comparePeriods requires integer cents (standing rule 13e); got ${currentCents} and ${priorCents}`,
    );
  }

  const changeCents = currentCents - priorCents;

  if (breaks.length > 0) {
    const what = breaks.map((b) => b.what).join("; ");
    return {
      ok: false,
      currentCents,
      priorCents,
      changeCents,
      refusalReason:
        "These two periods are not measured the same way, so a percentage change would describe the change in method, not the change in your business.",
      breaks,
      plain:
        `${formatCents(currentCents)} this period against ${formatCents(priorCents)} last period ` +
        `(${signedCents(changeCents)}). No percentage is shown because ${what}.`,
    };
  }

  if (priorCents === 0) {
    return {
      ok: true,
      currentCents,
      priorCents,
      changeCents,
      changeBasisPoints: null,
      direction: currentCents === 0 ? "flat" : "up",
      plain:
        currentCents === 0
          ? "Nothing in either period."
          : `${formatCents(currentCents)} this period. There is no prior period to compare against, so no percentage is possible.`,
    };
  }

  // Round half away from zero on the basis-point scale, so -0.5 does not become
  // 0 and read as "flat" when it is not.
  //
  // `|| 0` is not cosmetic. `-Math.round(0.4)` is NEGATIVE ZERO, which compares
  // equal to 0 but formats with a leading minus, so a report can print "-0%".
  // Adding zero collapses it to a plain 0.
  const raw = (changeCents * 10_000) / priorCents;
  const changeBasisPoints = (raw < 0 ? -Math.round(Math.abs(raw)) : Math.round(raw)) || 0;
  const direction: "up" | "down" | "flat" =
    changeCents > 0 ? "up" : changeCents < 0 ? "down" : "flat";

  // A MOVEMENT TOO SMALL TO SHOW AS A PERCENTAGE IS STILL A MOVEMENT.
  //
  // A penny off two thousand dollars is 0.005%, which rounds to zero basis
  // points. Printing "down 0%" is a sentence that contradicts itself, and a
  // reader who sees it twice stops trusting the column. The dollars are exact
  // and stay; the percentage is replaced with an honest bound.
  const tooSmallToShow = changeBasisPoints === 0 && changeCents !== 0;

  return {
    ok: true,
    currentCents,
    priorCents,
    changeCents,
    changeBasisPoints,
    direction,
    plain:
      direction === "flat"
        ? `${formatCents(currentCents)}, unchanged from last period.`
        : tooSmallToShow
          ? `${formatCents(currentCents)}, ${direction} by less than 0.01% from ${formatCents(priorCents)} (${signedCents(changeCents)}).`
          : `${formatCents(currentCents)}, ${direction} ${formatBasisPoints(Math.abs(changeBasisPoints))} from ${formatCents(priorCents)} (${signedCents(changeCents)}).`,
  };
}

// ---------------------------------------------------------------------------
// 4) FORMATTING — small, boring, and used everywhere so nothing disagrees
// ---------------------------------------------------------------------------

/** `1420457` -> `"$14,204.57"`. Negatives get a minus, never parentheses. */
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`formatCents requires integer cents (standing rule 13e); got ${cents}`);
  }
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const grouped = dollars.toLocaleString("en-US");
  return `${negative ? "-" : ""}$${grouped}.${String(remainder).padStart(2, "0")}`;
}

/** Same, with an explicit sign, for a change column. */
export function signedCents(cents: number): string {
  if (cents === 0) return "no change";
  return cents > 0 ? `+${formatCents(cents)}` : formatCents(cents);
}

/** `1234` -> `"12.34%"`. Trailing zeros trimmed: `1200` -> `"12%"`. */
export function formatBasisPoints(bp: number): string {
  if (!Number.isInteger(bp)) {
    throw new Error(`formatBasisPoints requires integer basis points; got ${bp}`);
  }
  const negative = bp < 0;
  const abs = Math.abs(bp);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const body =
    frac === 0
      ? `${whole}%`
      : frac % 10 === 0
        ? `${whole}.${frac / 10}%`
        : `${whole}.${String(frac).padStart(2, "0")}%`;
  return negative ? `-${body}` : body;
}

/**
 * Print a leave balance the way a person would say it.
 *
 * Answers the §8.8 defect directly. Hours are integer HUNDREDTHS (4801 = 48.01)
 * for the same reason money is cents.
 */
export function formatLeaveBalance(hundredthsOfHours: number): string {
  if (!Number.isInteger(hundredthsOfHours)) {
    throw new Error(`formatLeaveBalance requires integer hundredths of hours; got ${hundredthsOfHours}`);
  }
  const abs = Math.abs(hundredthsOfHours);
  const hours = (abs / 100).toFixed(2);
  if (hundredthsOfHours < 0) return `${hours} hours advanced`;
  if (hundredthsOfHours === 0) return "none available";
  return `${hours} hours available`;
}

// ---------------------------------------------------------------------------
// 5) SUBJECT SUPPRESSION — 26 rows to tell you about 10
// ---------------------------------------------------------------------------

export type SuppressionResult<T> = {
  readonly shown: readonly T[];
  readonly hiddenCount: number;
  /** Always rendered when hiddenCount > 0. Hiding silently is not allowed. */
  readonly disclosure: string | null;
};

/**
 * Hide subjects that have nothing to say, and SAY SO.
 *
 * The disclosure sentence is not optional politeness. CON 8 QC31 warns that
 * excluding information can make a report "incomplete and therefore
 * potentially misleading" — the cure is that the reader always knows something
 * was withheld and can ask for it. Hidden-and-disclosed is a summary;
 * hidden-and-silent is a lie of omission.
 *
 * `hasContent` is supplied by the caller because "empty" is domain knowledge:
 * zero wages is empty on an earnings report, and a live fact on a headcount.
 */
export function suppressEmptySubjects<T>(
  subjects: readonly T[],
  hasContent: (subject: T) => boolean,
  noun = "employees",
): SuppressionResult<T> {
  const shown = subjects.filter((s) => hasContent(s));
  const hiddenCount = subjects.length - shown.length;
  return {
    shown,
    hiddenCount,
    disclosure:
      hiddenCount === 0
        ? null
        : `${hiddenCount} of ${subjects.length} ${noun} had nothing to report this period and are hidden. Show them if you want to confirm they are genuinely inactive.`,
  };
}

// ---------------------------------------------------------------------------
// 6) THE EMPTY REPORT — structure with no content is worse than nothing
// ---------------------------------------------------------------------------

export type EmptyStateNotice = {
  readonly headline: string;
  readonly whyEmpty: string;
  readonly whatWouldFillIt: string;
};

/**
 * What to render instead of an empty grid.
 *
 * The §8.7 defect: Sage's Employee Compensation report draws seven columns and
 * twenty-six rows of nothing. It has structure and no content, and a grid of
 * blanks does not tell the reader whether the answer is "nothing happened" or
 * "this feature was never switched on."
 *
 * Those two are completely different facts and the reader deserves to know
 * which one he is looking at. Standing rule 48 in report form: a report that
 * cannot classify its input must say so, never render as though it had.
 */
export function emptyStateFor(
  reportName: string,
  whatWouldFillIt: string,
  everPopulated: boolean,
): EmptyStateNotice {
  return {
    headline: `${reportName} has nothing to show yet.`,
    whyEmpty: everPopulated
      ? "There is no activity in the period you selected. The report works — the period is genuinely quiet."
      : "This report has never had any data in it. That usually means the thing it tracks is not being recorded yet, not that nothing happened.",
    whatWouldFillIt,
  };
}
