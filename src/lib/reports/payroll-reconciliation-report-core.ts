/**
 * src/lib/reports/payroll-reconciliation-report-core.ts   (books-27)
 *
 * SAGE'S EXCEPTION REPORT, DONE PROPERLY.
 *
 * Baseline §8.3 measured the one Sage report genuinely worth copying. It prints
 * four columns — Taxable Gross, Amt Withheld, Calculated Amt, Difference — and
 * for Q2 2026 the Difference column is 0.00 on every row. That is the "prove it
 * to me" control an accountant actually wants: it recomputes what SHOULD have
 * been withheld, sets it beside what WAS withheld, and shows the gap.
 *
 * Michael's words: *"I don't use any of the reports in the screenshot really
 * because I don't understand fully what it is showing me."* This one is
 * understandable the moment the columns are named in English, because a column
 * of zeros means nothing is wrong and any non-zero is a name and an amount to
 * go look at.
 *
 * WHAT WE FIXED ON THE WAY ACROSS
 *
 *   1. Sage printed it "for MED_COGS". Nobody knows what that is. We name the
 *      levy in English and say whose money it is (§8.9 defect).
 *   2. Sage listed 26 people to tell you about 10 — sixteen rows of zeros for
 *      inactive records. We suppress and disclose (§8.3, §8.1 defect).
 *   3. Sage showed one quarter at a time. ASC 205-10-45-1 says comparative
 *      presentation is ordinarily necessary; we carry the prior period.
 *   4. Sage showed the total difference as a bare number with no verdict. We
 *      say, in a sentence, whether the report found anything.
 *
 * THE FRACTIONS-OF-CENTS TRAP — THE REASON THIS MODULE EXISTS AT ALL
 *
 * The single most misread number in payroll is the small residual difference
 * between two ways of computing the same tax. Withholding happens per employee,
 * per paycheque, and each one rounds to a whole cent. The return computes the
 * tax on the QUARTER'S TOTAL wages in one multiplication, rounding once. Those
 * two answers differ by a few cents and BOTH ARE CORRECT.
 *
 * Michael's own filed Q2 941 shows it: line 6 is 14,204.64, line 12 is
 * 14,204.57, and the −0.07 in between is line 7, "Current quarter's adjustment
 * for fractions of cents." The IRS puts a line on the form for it precisely
 * because it is expected and unavoidable.
 *
 * So this engine computes the expectation BOTH WAYS and labels the residual for
 * what it is. An engine that only computed one way would either raise a false
 * alarm every single quarter or hide a real error inside a tolerance — and both
 * of those failures look identical to the reader, which is exactly the
 * condition standing rule 48 exists to prevent.
 *
 * Money is integer cents throughout, rates are milli-percent, and the
 * multiplication is `applyMilliPct` from the withholding engine — reused, not
 * re-declared (standing rule 25), so the reconciliation and the paycheque can
 * never round differently.
 */
import { applyMilliPct } from "@/lib/payroll/payroll-withholding-core";
import { formatCents, signedCents } from "@/lib/reports/reports-presentation-core";

// ---------------------------------------------------------------------------
// 1) WHAT A LINE OF THE REPORT IS
// ---------------------------------------------------------------------------

/**
 * One subject on the report — normally one employee.
 *
 * `actualWithheldCents` is what the books say came out. `taxableGrossCents` is
 * the base it should have been computed on. Nothing else is needed, and
 * deliberately so: a reconciliation that accepts the expected figure as an
 * input is not a reconciliation, it is a spreadsheet agreeing with itself.
 */
export type ReconcileSubject = {
  readonly subjectId: string;
  /** The person's name as Michael would say it, not an employee number. */
  readonly displayName: string;
  readonly taxableGrossCents: number;
  readonly actualWithheldCents: number;
};

export type ReconcileLine = {
  readonly subjectId: string;
  readonly displayName: string;
  readonly taxableGrossCents: number;
  readonly actualWithheldCents: number;
  /** Recomputed from the rate, per subject, rounded once at this level. */
  readonly expectedWithheldCents: number;
  /** actual − expected. Positive means too much came out. */
  readonly differenceCents: number;
  readonly ties: boolean;
  /** A whole sentence, safe to render on its own. */
  readonly plain: string;
};

/**
 * How the expectation is computed. Three shapes, because Washington uses three.
 *
 *   - `percent_of_wages`   Medicare, Social Security, UI, EAF, WA Cares.
 *   - `share_of_premium`   PFML. The premium is a percentage of wages, and then
 *                          the employee pays a percentage OF THE PREMIUM. Two
 *                          roundings, and doing it in one step gives a
 *                          different answer — verified against the filed
 *                          return, which only reproduces the two-step way.
 *   - `per_hour`           L&I workers' compensation, which is charged per hour
 *                          worked and not on wages at all.
 */
export type ExpectationBasis =
  | { readonly kind: "percent_of_wages"; readonly rateMilliPct: number }
  | {
      readonly kind: "share_of_premium";
      readonly premiumRateMilliPct: number;
      readonly shareOfPremiumMilliPct: number;
    }
  | { readonly kind: "per_hour"; readonly rateMilliCentsPerHour: number };

export type ReconcileRequest = {
  /** English name of the levy, e.g. "Medicare — employee half". */
  readonly levyName: string;
  /** "the employee" or "Greenway" — whose money this is. */
  readonly bornBy: string;
  readonly basis: ExpectationBasis;
  readonly subjects: readonly ReconcileSubject[];
  /** Hours per subject, required only for a `per_hour` basis. */
  readonly hoursBySubjectId?: Readonly<Record<string, number>>;
  /** Where the rate came from, so a reader can check it. */
  readonly rateSource: string;
  readonly periodLabel: string;
};

// ---------------------------------------------------------------------------
// 2) THE TWO WAYS TO COMPUTE, AND WHY BOTH ARE KEPT
// ---------------------------------------------------------------------------

/**
 * Apply the basis to one amount. Pure, integer in, integer out.
 *
 * The `share_of_premium` branch rounds TWICE on purpose. Greenway's filed Q2
 * PFML return reports 556.32 of employee premium on 68,923.45 of wages. Rounding
 * once (1.13% × 71.43% collapsed into a single rate) does not reproduce 556.32.
 * Rounding twice — premium 778.83, then 71.43% of that — reproduces it exactly.
 * The State's arithmetic is the specification here, not our preference.
 */
export function applyBasis(basis: ExpectationBasis, amountCents: number, hours = 0): number {
  if (!Number.isInteger(amountCents)) {
    throw new Error(
      `applyBasis requires integer cents (standing rule 13e); got ${amountCents}`,
    );
  }
  switch (basis.kind) {
    case "percent_of_wages":
      return applyMilliPct(amountCents, basis.rateMilliPct);
    case "share_of_premium": {
      const premium = applyMilliPct(amountCents, basis.premiumRateMilliPct);
      return applyMilliPct(premium, basis.shareOfPremiumMilliPct);
    }
    case "per_hour": {
      if (!Number.isInteger(hours)) {
        throw new Error(`applyBasis per_hour requires integer hours; got ${hours}`);
      }
      const product = hours * basis.rateMilliCentsPerHour;
      if (!Number.isSafeInteger(product)) {
        throw new Error("applyBasis per_hour overflow");
      }
      // Half away from zero, matching applyMilliPct's rounding exactly.
      const q = Math.floor(Math.abs(product) / 1000);
      const r = Math.abs(product) - q * 1000;
      const rounded = r * 2 >= 1000 ? q + 1 : q;
      return product < 0 ? -rounded : rounded;
    }
  }
}

export type FractionsOfCents = {
  /** Each subject computed and rounded separately, then added up. */
  readonly sumOfPerSubjectCents: number;
  /** The period total computed in one multiplication, rounded once. */
  readonly computedOnTotalCents: number;
  /** sumOfPerSubject − computedOnTotal. This is 941 line 7. */
  readonly residualCents: number;
  readonly isExpectedRounding: boolean;
  readonly plain: string;
};

/**
 * The threshold that separates "rounding" from "error".
 *
 * Not a tolerance and not a tuned number. Each subject's own rounding can move
 * the total by at most half a cent, so N subjects can drift at most N half-cents
 * — and we take the ceiling, which is the arithmetic maximum rather than a
 * guess. A residual inside that bound is provably rounding. A residual outside
 * it CANNOT be rounding, so it is a real difference and is reported as one.
 *
 * This matters more than it looks. A fixed tolerance of, say, five dollars
 * would swallow a genuine error at eleven employees and raise a false alarm at
 * four hundred. A bound derived from the arithmetic scales correctly and is
 * defensible to an examiner, which a tuned constant never is.
 */
export function maxRoundingDriftCents(subjectCount: number): number {
  if (!Number.isInteger(subjectCount) || subjectCount < 0) {
    throw new Error(`maxRoundingDriftCents requires a non-negative integer; got ${subjectCount}`);
  }
  return Math.ceil(subjectCount / 2);
}

// ---------------------------------------------------------------------------
// 3) THE REPORT
// ---------------------------------------------------------------------------

export type ReconciliationReport = {
  readonly levyName: string;
  readonly bornBy: string;
  readonly periodLabel: string;
  readonly rateSource: string;
  readonly lines: readonly ReconcileLine[];
  readonly hiddenCount: number;
  readonly hiddenDisclosure: string | null;
  readonly totalTaxableGrossCents: number;
  readonly totalActualWithheldCents: number;
  readonly totalExpectedWithheldCents: number;
  readonly totalDifferenceCents: number;
  readonly fractionsOfCents: FractionsOfCents;
  /** True only when every single line ties to the cent. */
  readonly everyLineTies: boolean;
  /** The one sentence to put at the top of the page. */
  readonly verdict: string;
  /** Names and amounts to go look at, in descending order of size. */
  readonly exceptions: readonly ReconcileLine[];
};

/**
 * Build the reconciliation.
 *
 * READING ORDER IS DESIGNED, not incidental. `verdict` first, because 99% of
 * the time the answer is "nothing is wrong" and Michael should be able to close
 * the page in four seconds. Then `exceptions`, which is empty on a clean
 * quarter and is the entire point on a dirty one. The full line list is last,
 * because it is evidence rather than information — CON 8 ¶PR35 requires
 * aggregation so a reader is not made to derive the answer himself, and ¶PR36
 * warns that aggregating too far obscures it, which is why the detail is still
 * there underneath.
 *
 * Subjects with no wages AND no withholding are suppressed and counted, never
 * silently dropped — §8.3's sixteen empty rows out of twenty-six.
 */
export function buildReconciliationReport(req: ReconcileRequest): ReconciliationReport {
  const hours = req.hoursBySubjectId ?? {};

  const active = req.subjects.filter(
    (s) => s.taxableGrossCents !== 0 || s.actualWithheldCents !== 0,
  );
  const hiddenCount = req.subjects.length - active.length;

  const lines: ReconcileLine[] = active.map((s) => {
    const expected = applyBasis(req.basis, s.taxableGrossCents, hours[s.subjectId] ?? 0);
    const difference = s.actualWithheldCents - expected;
    const ties = difference === 0;
    return {
      subjectId: s.subjectId,
      displayName: s.displayName,
      taxableGrossCents: s.taxableGrossCents,
      actualWithheldCents: s.actualWithheldCents,
      expectedWithheldCents: expected,
      differenceCents: difference,
      ties,
      plain: ties
        ? `${s.displayName}: ${formatCents(s.actualWithheldCents)} withheld on ${formatCents(s.taxableGrossCents)} of wages — exactly what the rate produces.`
        : `${s.displayName}: ${formatCents(s.actualWithheldCents)} was withheld but the rate produces ${formatCents(expected)} on ${formatCents(s.taxableGrossCents)} of wages — ${signedCents(difference)}.`,
    };
  });

  const totalTaxableGrossCents = lines.reduce((a, l) => a + l.taxableGrossCents, 0);
  const totalActualWithheldCents = lines.reduce((a, l) => a + l.actualWithheldCents, 0);
  const sumOfPerSubjectCents = lines.reduce((a, l) => a + l.expectedWithheldCents, 0);

  const totalHours = Object.values(hours).reduce((a, h) => a + h, 0);
  const computedOnTotalCents = applyBasis(req.basis, totalTaxableGrossCents, totalHours);

  const residualCents = sumOfPerSubjectCents - computedOnTotalCents;
  const bound = maxRoundingDriftCents(lines.length);
  const isExpectedRounding = Math.abs(residualCents) <= bound;

  const fractionsOfCents: FractionsOfCents = {
    sumOfPerSubjectCents,
    computedOnTotalCents,
    residualCents,
    isExpectedRounding,
    plain:
      residualCents === 0
        ? "Adding up each person's tax gives exactly the same answer as taxing the quarter's total wages in one go. No fractions-of-cents adjustment is needed."
        : isExpectedRounding
          ? `Adding up each person's tax comes to ${formatCents(sumOfPerSubjectCents)}, while taxing the quarter's total wages in one calculation gives ${formatCents(computedOnTotalCents)}. The ${formatCents(Math.abs(residualCents))} between them is rounding, not a mistake — every paycheque rounds to the nearest cent and the return rounds once. This is the number that belongs on Form 941 line 7, "fractions of cents".`
          : `Adding up each person's tax comes to ${formatCents(sumOfPerSubjectCents)}, but taxing the quarter's total wages gives ${formatCents(computedOnTotalCents)} — a gap of ${formatCents(Math.abs(residualCents))}. With ${lines.length} people on the report, rounding alone cannot move the total by more than ${formatCents(bound)}, so this gap is not rounding. Something is being computed on a different wage base.`,
  };

  const totalExpectedWithheldCents = sumOfPerSubjectCents;
  const totalDifferenceCents = totalActualWithheldCents - totalExpectedWithheldCents;
  const exceptions = lines.filter((l) => !l.ties).sort((a, b) => Math.abs(b.differenceCents) - Math.abs(a.differenceCents));
  const everyLineTies = exceptions.length === 0;

  const verdict = everyLineTies
    ? `Nothing to chase. All ${lines.length} people tie to the cent: ${formatCents(totalActualWithheldCents)} of ${req.levyName} was withheld on ${formatCents(totalTaxableGrossCents)} of wages, which is exactly what the rate produces.`
    : `${exceptions.length} of ${lines.length} ${exceptions.length === 1 ? "person does" : "people do"} not tie. ${req.levyName} is off by ${signedCents(totalDifferenceCents)} in total on ${formatCents(totalTaxableGrossCents)} of wages. The names are listed below, largest first.`;

  return {
    levyName: req.levyName,
    bornBy: req.bornBy,
    periodLabel: req.periodLabel,
    rateSource: req.rateSource,
    lines,
    hiddenCount,
    hiddenDisclosure:
      hiddenCount === 0
        ? null
        : `${hiddenCount} of ${req.subjects.length} people had no wages and nothing withheld this period and are hidden. Show them if you want to confirm they are genuinely inactive.`,
    totalTaxableGrossCents,
    totalActualWithheldCents,
    totalExpectedWithheldCents,
    totalDifferenceCents,
    fractionsOfCents,
    everyLineTies,
    verdict,
    exceptions,
  };
}
