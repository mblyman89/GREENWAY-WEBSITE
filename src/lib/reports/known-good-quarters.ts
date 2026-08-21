/**
 * src/lib/reports/known-good-quarters.ts   (books-27)
 *
 * A QUARTER WHERE WE KNOW THE RIGHT ANSWER, BECAUSE THE GOVERNMENT TOLD US.
 *
 * Michael's words, books-27: *"For the reports engine, yes keep them as known
 * good quarters to reference."*
 *
 * WHY THIS IS NOT AN ORDINARY TEST FIXTURE
 *
 * Most fixtures are invented by the person writing the test, which means they
 * can only ever prove the code agrees with its author. Every figure in this
 * file was taken off a return that was actually filed with a government agency
 * and accepted, each with a confirmation number. When our arithmetic disagrees
 * with this file, our arithmetic is wrong — there is no third possibility to
 * argue about. That is the difference between a test and an oracle.
 *
 * Standing rule 59 ranks evidence, and this quarter sits at the top tier: a
 * filed return, not a printout of what a program believed. The distinction is
 * not academic. Two of the four defects originally recorded against these books
 * evaporated the moment the filed returns were read, because they had been
 * found in a Sage printout rather than in a filing (baseline §13.5).
 *
 * THE CROSS-FOOT THAT MAKES IT TRUSTWORTHY
 *
 * One wage number — 68,923.45 — appears on four separately filed returns to
 * three different agencies:
 *
 *   • Form 941 line 2 (IRS)
 *   • Form 5208A box 13 and the 5208B detail (WA ESD)
 *   • The PFML / WA Cares return (WA ESD, separate system)
 *   • The L&I quarterly report, rounded to whole dollars as L&I requires
 *
 * Four filings independently agreeing on one base is a far stronger statement
 * than any single one of them. A change to this file is therefore a serious
 * act: it should only ever happen because an amended return was filed, and the
 * amendment should be recorded here alongside the original.
 *
 * UNITS. Money is integer cents. Rates are milli-percent (1.45% = 1_450) or
 * milli-cents per hour ($0.5593/hr = 55_930). Hours are whole hours, which is
 * how both ESD and L&I collect them for this quarter.
 */

export type KnownGoodEmployee = {
  readonly subjectId: string;
  readonly displayName: string;
  /** Total wages, which for this quarter equal taxable wages for every person. */
  readonly wagesCents: number;
  readonly hours: number;
};

/**
 * The ten people on the Q2 2026 5208B wage detail, in the order the return
 * lists them. SSNs are deliberately NOT reproduced: they are not needed to
 * reconcile anything, and a fixture file is the last place they belong.
 */
export const Q2_2026_EMPLOYEES: readonly KnownGoodEmployee[] = [
  { subjectId: "benoit-stephen", displayName: "Stephen Benoit", wagesCents: 490_110, hours: 158 },
  { subjectId: "britton-angela", displayName: "Angela Britton", wagesCents: 1_334_032, hours: 565 },
  { subjectId: "clark-autumn", displayName: "Autumn E Clark", wagesCents: 831_322, hours: 479 },
  { subjectId: "cole-daylin", displayName: "Daylin A Cole", wagesCents: 755_416, hours: 441 },
  { subjectId: "dee-larry", displayName: "Larry E Dee", wagesCents: 858_915, hours: 466 },
  { subjectId: "giovannini-bailey", displayName: "Bailey Giovannini", wagesCents: 85_913, hours: 46 },
  { subjectId: "johnson-jermaine", displayName: "Jermaine Johnson", wagesCents: 393_157, hours: 225 },
  { subjectId: "smith-zachary", displayName: "Zachary M Smith", wagesCents: 569_050, hours: 332 },
  { subjectId: "solis-isana", displayName: "Isana Solis", wagesCents: 415_753, hours: 227 },
  { subjectId: "taitague-raelene", displayName: "Raelene Q Taitague", wagesCents: 1_158_677, hours: 619 },
] as const;

/** The wage base every one of the four returns agrees on. */
export const Q2_2026_GROSS_WAGES_CENTS = 6_892_345;
/** Total hours, on both the ESD and the L&I return. */
export const Q2_2026_TOTAL_HOURS = 3_558;

/**
 * One line of a filed return, with enough provenance to go and check it.
 *
 * `filedAmountCents` is what the agency actually assessed or the form actually
 * printed. `reproducedBy` describes, in English, the arithmetic that gets there
 * — every one of which has been run and matched to the cent.
 */
export type FiledFigure = {
  readonly id: string;
  readonly form: string;
  readonly line: string;
  readonly plainEnglish: string;
  readonly filedAmountCents: number;
  readonly reproducedBy: string;
  /** Agency confirmation number where the filing carried one. */
  readonly confirmation: string | null;
};

export const Q2_2026_FILED_FIGURES: readonly FiledFigure[] = [
  {
    id: "941-line-2",
    form: "Form 941, Q2 2026",
    line: "Line 2",
    plainEnglish: "Total wages paid to everyone in the quarter.",
    filedAmountCents: 6_892_345,
    reproducedBy: "The ten employee wage figures on the 5208B add to exactly this.",
    confirmation: null,
  },
  {
    id: "941-line-3",
    form: "Form 941, Q2 2026",
    line: "Line 3",
    plainEnglish: "Federal income tax withheld from paycheques.",
    filedAmountCents: 365_935,
    reproducedBy:
      "Not derivable from a rate. Income tax withholding depends on each person's W-4, so this figure comes from the payroll records and is checked by adding up the paycheques.",
    confirmation: null,
  },
  {
    id: "941-line-5a",
    form: "Form 941, Q2 2026",
    line: "Line 5a",
    plainEnglish: "Social Security tax — both halves, yours and the employees'.",
    filedAmountCents: 854_651,
    reproducedBy: "68,923.45 x 12.4% = 8,546.51 exactly.",
    confirmation: null,
  },
  {
    id: "941-line-5c",
    form: "Form 941, Q2 2026",
    line: "Line 5c",
    plainEnglish: "Medicare tax — both halves.",
    filedAmountCents: 199_878,
    reproducedBy: "68,923.45 x 2.9% = 1,998.78 exactly. The employee half alone is 1.45% = 999.39.",
    confirmation: null,
  },
  {
    id: "941-line-6",
    form: "Form 941, Q2 2026",
    line: "Line 6",
    plainEnglish: "Total federal tax for the quarter, before the rounding adjustment.",
    filedAmountCents: 1_420_464,
    reproducedBy: "3,659.35 + 8,546.51 + 1,998.78 = 14,204.64.",
    confirmation: null,
  },
  {
    id: "941-line-7",
    form: "Form 941, Q2 2026",
    line: "Line 7",
    plainEnglish:
      "The fractions-of-cents adjustment. Rounding every paycheque to the cent does not give quite the same total as taxing the quarter in one go, and the IRS puts a line on the form for the difference.",
    filedAmountCents: -7,
    reproducedBy: "14,204.57 - 14,204.64 = -0.07.",
    confirmation: null,
  },
  {
    id: "941-line-12",
    form: "Form 941, Q2 2026",
    line: "Line 12",
    plainEnglish: "Total federal tax owed for the quarter.",
    filedAmountCents: 1_420_457,
    reproducedBy:
      "14,204.64 - 0.07. This is also the exact figure the deposit-schedule engine was built on before the return was in hand, and the return confirmed it.",
    confirmation: null,
  },
  {
    id: "esd-ui",
    form: "WA Form 5208A (EAMS), Q2 2026",
    line: "UI tax due",
    plainEnglish: "Unemployment insurance tax.",
    filedAmountCents: 25_502,
    reproducedBy:
      "68,923.45 x 0.37% = 255.02 exactly. Sage carries 0.64%, which is stale — at 0.64% this line would have been 441.11.",
    confirmation: "G2413C8A6HP330LL",
  },
  {
    id: "esd-eaf",
    form: "WA Form 5208A (EAMS), Q2 2026",
    line: "EAF tax due",
    plainEnglish: "Employment Administration Fund surcharge.",
    filedAmountCents: 2_068,
    reproducedBy: "68,923.45 x 0.03% = 20.68 exactly. Sage carries 0.64% for at least one employee, which is wrong.",
    confirmation: "G2413C8A6HP330LL",
  },
  {
    id: "esd-total",
    form: "WA Form 5208A (EAMS), Q2 2026",
    line: "Total due",
    plainEnglish: "What was actually paid to Employment Security.",
    filedAmountCents: 27_570,
    reproducedBy: "255.02 + 20.68 = 275.70.",
    confirmation: "G2413C8A6HP330LL",
  },
  {
    id: "pfml-employee",
    form: "WA PFML return, Q2 2026",
    line: "Paid Leave premiums withheld",
    plainEnglish: "Paid Family and Medical Leave taken out of employee paycheques.",
    filedAmountCents: 55_632,
    reproducedBy:
      "Two steps, and the order matters: the premium is 68,923.45 x 1.13% = 778.83, and the employee pays 71.43% of the premium = 556.32. Collapsing it into one rate does not reproduce the filed figure.",
    confirmation: null,
  },
  {
    id: "pfml-employer",
    form: "WA PFML return, Q2 2026",
    line: "Employer Medical + Employer Family",
    plainEnglish:
      "Greenway's share of Paid Leave — zero, because a business with fewer than fifty employees is not required to pay it.",
    filedAmountCents: 0,
    reproducedBy:
      "The employer share would be 28.57% of the 778.83 premium = 222.51. It is 0.00 on the filed return because the small-employer relief is being taken.",
    confirmation: null,
  },
  {
    id: "wa-cares",
    form: "WA Cares return, Q2 2026",
    line: "Total WA Cares premiums",
    plainEnglish: "The long-term care premium, all of it employee money.",
    filedAmountCents: 39_976,
    reproducedBy: "68,923.45 x 0.58% = 399.76 exactly.",
    confirmation: null,
  },
  {
    id: "lni-premium",
    form: "L&I quarterly report, Q2 2026",
    line: "Class 6403-05 amount owed",
    plainEnglish:
      "Workers' compensation. Charged per hour worked, not on wages — the only levy here that ignores what people were paid.",
    filedAmountCents: 198_999,
    reproducedBy: "3,558 hours x $0.5593 per hour = 1,989.99 exactly. One risk class only.",
    confirmation: "12616784",
  },
] as const;

export function filedFigure(id: string): FiledFigure | undefined {
  return Q2_2026_FILED_FIGURES.find((f) => f.id === id);
}

/**
 * THE CROSS-FOOT GATE.
 *
 * Proves the fixture is internally consistent before anything is allowed to
 * reconcile against it. A corrupt oracle is worse than no oracle, because every
 * test that depends on it starts lying in the same direction at once.
 *
 * Throws rather than returning a boolean on purpose (standing rule 48): a
 * consistency check whose result can be ignored is a check that will be
 * ignored.
 */
export function assertKnownGoodQuarterCrossFoots(): void {
  if (Q2_2026_EMPLOYEES.length !== 10) {
    throw new Error(
      `known-good-quarters: expected the 10 employees on the filed 5208B, found ${Q2_2026_EMPLOYEES.length}.`,
    );
  }

  const wageSum = Q2_2026_EMPLOYEES.reduce((a, e) => a + e.wagesCents, 0);
  if (wageSum !== Q2_2026_GROSS_WAGES_CENTS) {
    throw new Error(
      `known-good-quarters: the employee wages add to ${wageSum} cents but the filed returns all say ${Q2_2026_GROSS_WAGES_CENTS}.`,
    );
  }

  const hourSum = Q2_2026_EMPLOYEES.reduce((a, e) => a + e.hours, 0);
  if (hourSum !== Q2_2026_TOTAL_HOURS) {
    throw new Error(
      `known-good-quarters: the employee hours add to ${hourSum} but the ESD and L&I returns both say ${Q2_2026_TOTAL_HOURS}.`,
    );
  }

  const line2 = filedFigure("941-line-2");
  if (!line2 || line2.filedAmountCents !== Q2_2026_GROSS_WAGES_CENTS) {
    throw new Error("known-good-quarters: 941 line 2 no longer matches the wage base.");
  }

  // The 941's own internal arithmetic: 3 + 5a + 5c = 6, and 6 + 7 = 12.
  const l3 = filedFigure("941-line-3")?.filedAmountCents;
  const l5a = filedFigure("941-line-5a")?.filedAmountCents;
  const l5c = filedFigure("941-line-5c")?.filedAmountCents;
  const l6 = filedFigure("941-line-6")?.filedAmountCents;
  const l7 = filedFigure("941-line-7")?.filedAmountCents;
  const l12 = filedFigure("941-line-12")?.filedAmountCents;
  if (
    l3 === undefined ||
    l5a === undefined ||
    l5c === undefined ||
    l6 === undefined ||
    l7 === undefined ||
    l12 === undefined
  ) {
    throw new Error("known-good-quarters: a Form 941 line is missing from the fixture.");
  }
  if (l3 + l5a + l5c !== l6) {
    throw new Error(
      `known-good-quarters: 941 lines 3 + 5a + 5c = ${l3 + l5a + l5c} but line 6 says ${l6}.`,
    );
  }
  if (l6 + l7 !== l12) {
    throw new Error(`known-good-quarters: 941 line 6 + line 7 = ${l6 + l7} but line 12 says ${l12}.`);
  }

  // ESD's own total.
  const ui = filedFigure("esd-ui")?.filedAmountCents;
  const eaf = filedFigure("esd-eaf")?.filedAmountCents;
  const esdTotal = filedFigure("esd-total")?.filedAmountCents;
  if (ui === undefined || eaf === undefined || esdTotal === undefined) {
    throw new Error("known-good-quarters: an ESD line is missing from the fixture.");
  }
  if (ui + eaf !== esdTotal) {
    throw new Error(`known-good-quarters: ESD UI + EAF = ${ui + eaf} but the return totals ${esdTotal}.`);
  }
}
