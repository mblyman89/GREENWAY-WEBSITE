/**
 * src/lib/payroll/payroll-onboarding-ui-core.ts  (books-25)
 *
 * WHAT THE SCREEN NEEDS, COMPUTED WHERE IT CAN BE TESTED.
 *
 * This module holds no JSX and does no I/O. It exists because the guided setup
 * screen has to do three things that are easy to get wrong and impossible to
 * test inside a React component:
 *
 *   1) render the checklist, with the exact fields to highlight
 *   2) show a WORKED PAYCHECK - every line, with the arithmetic visible
 *   3) name the authority behind each line
 *
 * WHY THE WORKED PAYCHECK IS THE POINT OF THE WHOLE SCREEN
 *
 * Michael's problem was never arithmetic. He has a Master's in accounting. His
 * words:
 *
 *   "my accounting skills aren't bad or the problem here. I'm the one feeding
 *    the reports and they are accurate because I know what I'm doing as an
 *    accountant, I have no idea what I'm doing with sage. There is this huge
 *    disconnect between me and the system and it's dragging me down."
 *
 * and:
 *
 *   "I don't use any of the reports in the screenshot really because I don't
 *    understand fully what it is showing me."
 *
 * So the deficit is not knowledge, it is LEGIBILITY. Sage shows him a number
 * called "WAPFL ER 26" and he cannot see where it came from, cannot check it,
 * and therefore cannot trust it. An accountant who cannot audit a figure is
 * being asked to sign something he cannot verify.
 *
 * The fix is not more explanation. It is showing the FORMULA next to the RESULT
 * so he can re-derive it himself in five seconds. A number he can re-derive is
 * a number he owns. That is what buildWorkedPaycheck() produces: not a total,
 * but a total plus the sentence that generates it.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 *
 * It does not compute tax. computePaycheckTaxes() in payroll-withholding-core
 * already does that, with ~2,200 lines of tested arithmetic behind it, and a
 * second implementation here would eventually disagree with the first in a way
 * nobody would notice until a 941 did not tie (standing rule 25). This module
 * WIRES the stored setup into that engine and then EXPLAINS what came back.
 */
import { GREENWAY_RATES } from "@/lib/payroll/payroll-rates-2026";
import type { RateLookup } from "@/lib/payroll/payroll-rate-registry-core";
import {
  ONBOARDING_STEPS,
  evaluateOnboarding,
  hourlyGrossCents,
  salaryGrossForPeriodCents,
  type OnboardingCandidate,
  type OnboardingEvaluation,
  type PayRecord,
} from "@/lib/payroll/payroll-onboarding-core";
import {
  ZERO_YTD,
  computePaycheckTaxes,
  formatCentsPlain,
  type PaycheckTaxes,
  type PayrollRefusal,
} from "@/lib/payroll/payroll-withholding-core";
import type { W4Record } from "@/lib/payroll/payroll-w4-core";
import { PAY_FREQUENCY_LABELS, PAY_PERIODS_PER_YEAR } from "@/lib/payroll/payroll-w4-core";

// ===========================================================================
// 1) THE CHECKLIST, AS THE SCREEN RENDERS IT
// ===========================================================================

export type ChecklistRowState = "done" | "blocking" | "warning" | "not_started";

/**
 * One problem, still attached to the field it is about. See D-16.
 *
 * `severity` travels with it because a screen that shows every complaint in
 * danger red teaches the reader that red means nothing. A blank ESD work code
 * is lawful; a malformed one is not; they must not look the same.
 */
export type FieldProblemPair = {
  readonly field: string;
  readonly message: string;
  readonly severity: "block" | "warn";
};

/**
 * Which statutory deadline belongs on which checklist row.
 *
 * `onboardingDeadlines()` returns three dated obligations keyed by their own
 * names ("i9_section2", "new_hire_report", "i9_retention"), while the checklist
 * is keyed by step ("identity", "w4", "pay", ...). Only two of the three line up
 * with a step, and none of the keys are equal, so this correspondence is stated
 * once here rather than guessed at the call site.
 *
 * Steps absent from this map simply have no deadline, which is the truth: there
 * is no statutory clock on deciding someone's hourly rate.
 */
const DEADLINE_KEY_FOR_STEP: Readonly<Record<string, string>> = {
  i9_section2: "i9_section2",
  new_hire_report: "new_hire_report",
};

/**
 * Greenway's L&I risk class: 6403, Stores - Specialty Groceries.
 *
 * From Michael's own L&I rate notice for account 521,756-00, which is also
 * where payroll-rates-2026.ts gets the two per-hour rates. Named as a constant
 * rather than typed into a call so there is exactly one place to change it if
 * L&I ever reclassifies the store.
 */
export const GREENWAY_LNI_RISK_CLASS_CODE = "6403";

/**
 * The evidence document behind a rate, on a given date.
 *
 * The engine wants a document id alongside several rates, and refuses to compute
 * without one - correctly, because "which piece of paper did this number come
 * from?" is the only question that makes a rate auditable. Reading it off the
 * same registry row that supplied the rate keeps the number and its provenance
 * from ever drifting apart, which typing the id in by hand would eventually
 * guarantee. Returns null when there is no row, so the engine can issue its own
 * refusal instead of receiving a fabricated citation.
 */
function documentIdFor(
  key: Parameters<typeof GREENWAY_RATES.lookup>[0],
  onIsoDate: string,
): string | null {
  const row = GREENWAY_RATES.lookup(key, onIsoDate);
  return row.ok ? row.value.documentId : null;
}

export type ChecklistRow = {
  key: string;
  label: string;
  /** One plain sentence: what this step is for. */
  whatItIs: string;
  state: ChecklistRowState;
  /** True when payroll cannot run without it. */
  blocksPayroll: boolean;
  /** Dotted field paths to highlight, in order. Empty when the step is done. */
  highlightFields: readonly string[];
  /** What to fix, addressed to Michael. Empty when the step is done. */
  problems: readonly string[];
  /**
   * The SAME information as `highlightFields` and `problems`, but PAIRED - so
   * that asking "what is wrong with this one box" cannot return the sentence
   * belonging to a different box. See D-16 in docs/DEFECTS.md.
   *
   * The two arrays above are index-aligned by construction and are kept
   * because the checklist renders them as flat lists, which is all they were
   * ever asked for. What they cannot safely answer is a LOOKUP, and a screen
   * that puts an error under a specific input is doing a lookup whether or not
   * it says so. That is the shape of the bug: for eight slices the labor_role
   * step raised exactly one problem, so index 0 was always the right answer by
   * accident, and the day a second problem joined it the first field started
   * displaying the second field's complaint.
   */
  fieldProblems: readonly FieldProblemPair[];
  /** The statutory deadline for this step, when it has one. */
  deadlineYmd: string | null;
};

export type ChecklistView = {
  rows: readonly ChecklistRow[];
  canSave: boolean;
  /** The one-line answer to "why can't I save?" - empty when you can. */
  blockedBecause: string;
  /** Count of steps that block payroll and are not done. */
  blockingCount: number;
  /** Non-blocking issues worth knowing about. */
  warningCount: number;
  evaluation: OnboardingEvaluation;
};

/**
 * Turn an evaluation into rows a screen can render without making any decisions
 * of its own.
 *
 * The component gets no discretion here on purpose. If the view layer decides
 * what counts as "done", then two screens can disagree about whether the same
 * employee is ready - and the one Michael happens to be looking at becomes the
 * truth.
 */
export function buildChecklistView(candidate: OnboardingCandidate): ChecklistView {
  const evaluation = evaluateOnboarding(candidate);

  const rows: ChecklistRow[] = ONBOARDING_STEPS.map((step) => {
    const stepEval = evaluation.steps.find((s) => s.key === step.key);

    const problems = stepEval?.problems ?? [];
    const blocking = problems.filter((p) => p.severity === "block");
    const warnings = problems.filter((p) => p.severity === "warn");

    let state: ChecklistRowState;
    if (blocking.length > 0) state = "blocking";
    else if (warnings.length > 0) state = "warning";
    else if (stepEval?.complete) state = "done";
    else state = "not_started";

    // The deadline list is keyed by DEADLINE name, not by step key, and the two
    // vocabularies only partly overlap - "i9_retention" belongs to no step at
    // all. Mapping them explicitly beats a clever join that silently matches
    // nothing: a checklist row that quietly loses its statutory due date is the
    // exact class of failure Michael described as being failed silently.
    const deadlineKey = DEADLINE_KEY_FOR_STEP[step.key];
    const deadline = deadlineKey
      ? evaluation.deadlines.find((d) => d.key === deadlineKey)
      : undefined;

    return {
      key: step.key,
      label: step.label,
      whatItIs: step.why,
      state,
      blocksPayroll: step.blocksPayroll,
      highlightFields: problems.map((p) => p.field),
      problems: problems.map((p) => p.message),
      fieldProblems: problems.map((p) => ({
        field: p.field,
        message: p.message,
        severity: p.severity,
      })),
      deadlineYmd: deadline?.dueYmd ?? null,
    };
  });

  const blockingCount = rows.filter((r) => r.state === "blocking").length;
  const warningCount = rows.filter((r) => r.state === "warning").length;

  return {
    rows,
    canSave: evaluation.canSaveToPayroll,
    blockedBecause: evaluation.canSaveToPayroll
      ? ""
      : plainBlockedSentence(blockingCount, rows),
    blockingCount,
    warningCount,
    evaluation,
  };
}

/**
 * The sentence under the disabled Save button.
 *
 * "Validation failed" tells you nothing. This names the count and the first
 * offender, because the first thing anyone wants to know is where to click.
 */
function plainBlockedSentence(blockingCount: number, rows: readonly ChecklistRow[]): string {
  const firstBad = rows.find((r) => r.state === "blocking");
  if (!firstBad) {
    return "Some required information is still missing, so this cannot be saved yet.";
  }
  const detail = firstBad.problems[0] ?? `${firstBad.label} is not finished.`;
  if (blockingCount === 1) {
    return `${detail} That is the only thing standing in the way.`;
  }
  return (
    `${detail} That is 1 of ${blockingCount} things that still need attention - ` +
    `each one is marked below.`
  );
}

// ===========================================================================
// 2) THE WORKED PAYCHECK
// ===========================================================================

/**
 * One line of the paycheck, with its arithmetic exposed.
 *
 * `formula` is the field that matters. It is not a description of what the line
 * means - it is the actual calculation with the actual numbers substituted in,
 * so the result can be checked on paper. "$0.16445 x 80.00 hours = $13.16" can
 * be verified. "Workers' compensation withholding" cannot.
 */
export type PaycheckLine = {
  label: string;
  amountCents: number;
  /** The arithmetic, with real numbers in it. */
  formula: string;
  /** Who bears it. Employer lines never reduce take-home. */
  bearer: "employee" | "employer";
  /** The authority id, when the line has one. */
  authorityId?: string;
  /** Present only when the engine refused to compute the line. */
  refusal?: string;
};

export type WorkedPaycheck = {
  /** The pay period this illustrates. */
  periodLabel: string;
  grossCents: number;
  grossFormula: string;
  employeeLines: readonly PaycheckLine[];
  employerLines: readonly PaycheckLine[];
  takeHomeCents: number;
  takeHomeFormula: string;
  employerCostCents: number;
  employerCostFormula: string;
  /**
   * Employee tax the check was too small to cover, if any.
   *
   * Normally zero. It stops being zero when withholding exceeds gross - and the
   * shortfall does not disappear, it becomes something the employer either
   * recovers from a later check or pays. Surfaced because a take-home of zero
   * with a silent shortfall behind it is exactly the kind of thing that looks
   * fine on screen and turns up on a 941.
   */
  uncollectedEmployeeTaxCents: number;
  /** Lines the engine could not compute, surfaced rather than hidden. */
  refusals: readonly string[];
  /** The raw engine output, for anything the screen wants that is not above. */
  taxes: PaycheckTaxes;
};

/**
 * Compute one illustrative paycheck and explain every line of it.
 *
 * This is an ILLUSTRATION, not a payroll run. Nothing here is stored, and no
 * liability is created. Its job is to answer the question Michael could never
 * answer in Sage: "if I save this setup, what will actually come out of this
 * person's check, and why?"
 */
export function buildWorkedPaycheck(args: {
  w4: W4Record;
  pay: PayRecord;
  /** Hours in HUNDREDTHS (8000 = 80.00 hours). Ignored for salary. */
  hundredthHours: number;
  /** The date whose rates apply. */
  onIsoDate: string;
}): WorkedPaycheck {
  const { w4, pay, hundredthHours, onIsoDate } = args;

  // --- gross -------------------------------------------------------------
  let grossCents: number;
  let grossFormula: string;
  const periods = PAY_PERIODS_PER_YEAR[pay.payFrequency];

  if (pay.basis === "hourly") {
    const rate = pay.hourlyRateMilliCents ?? 0;
    grossCents = hourlyGrossCents(rate, hundredthHours);
    grossFormula =
      `${formatMilliCentsAsRate(rate)} per hour x ${(hundredthHours / 100).toFixed(2)} hours ` +
      `= ${formatCentsPlain(grossCents)}`;
  } else {
    const annual = pay.annualSalaryCents ?? 0;
    // WHICH period to illustrate is a real decision, not an arbitrary index.
    //
    // Period 0 absorbs the rounding remainder ($70,000 over 26 periods puts an
    // extra $0.20 in the first check), so period 0 is the ATYPICAL one. We show
    // period 1 - the amount 25 of the 26 checks will actually be - because an
    // illustration that shows the one-off high check teaches the wrong number.
    //
    // But when there is only ONE period in the year there is no period 1, and
    // that is not a hypothetical: it is Michael's own pay. "I pay myself once at
    // the end of the year." Hard-coding 1 threw
    // "periodIndex 1 is outside 0..0 for annually pay" on the owner's own
    // paycheck. With a single period, period 0 IS the typical period.
    const illustratedPeriod = periods === 1 ? 0 : 1;
    grossCents = salaryGrossForPeriodCents(annual, pay.payFrequency, illustratedPeriod);
    grossFormula =
      periods === 1
        ? `${formatCentsPlain(annual)} paid once = ${formatCentsPlain(grossCents)}`
        : `${formatCentsPlain(annual)} per year / ${periods} pay periods ` +
          `= ${formatCentsPlain(grossCents)}`;
  }

  // --- rates, read from the registry rather than typed in here -----------
  // Every one of these is a dated, evidenced row. Hard-coding any of them
  // would create a second source of truth that cannot be audited - which is
  // exactly the Sage defect where .2857 was typed into a formula by hand.
  //
  // NOTE THE UNIT ARGUMENT. lookupValue() requires the caller to state the unit
  // it expects, and refuses rather than converting if the stored row disagrees.
  // That is not ceremony: 1_130 is a plausible number as milli-percent, as
  // cents, and as milli-cents per hour, so a silent unit mix-up is a 1000x
  // error that still looks like money. Passing the unit turns it into a refusal.
  const refusals: string[] = [];

  /**
   * Unwrap a rate lookup, recording the refusal instead of pretending.
   *
   * A lookup can genuinely fail - a rate with no evidenced row covering this
   * date, or one stored in the wrong unit. The wrong answer would be `?? 0`,
   * because a zero rate computes a clean, confident, wrong paycheck (rule 46).
   * We keep the refusal, show it on the line it belongs to, and let the caller
   * see that the figure is missing rather than free.
   */
  function rate(
    label: string,
    lookup: RateLookup<number>,
  ): { value: number | null; refusal: string | null } {
    if (lookup.ok) return { value: lookup.value, refusal: null };
    const sentence = `${label}: ${lookup.refusal.message} ${lookup.refusal.whatToDo}`;
    refusals.push(sentence);
    return { value: null, refusal: sentence };
  }

  const pfmlTotal = rate(
    "Paid Family & Medical Leave rate",
    GREENWAY_RATES.lookupValue("pfml_total", onIsoDate, "milli_percent"),
  );
  const pfmlEmployerShare = rate(
    "PFML employer share",
    GREENWAY_RATES.lookupValue("pfml_employer_share_of_total", onIsoDate, "milli_percent"),
  );
  const waCares = rate(
    "WA Cares rate",
    GREENWAY_RATES.lookupValue("wa_cares_total", onIsoDate, "milli_percent"),
  );
  const suta = rate(
    "Unemployment (SUTA) rate",
    GREENWAY_RATES.lookupValue("wa_suta_total", onIsoDate, "milli_percent"),
  );
  const lniEmployee = rate(
    "L&I employee rate",
    GREENWAY_RATES.lookupValue("lni_employee_rate", onIsoDate, "milli_cents_per_hour"),
  );
  const lniEmployer = rate(
    "L&I employer rate",
    GREENWAY_RATES.lookupValue("lni_employer_rate", onIsoDate, "milli_cents_per_hour"),
  );

  const taxes = computePaycheckTaxes({
    w4,
    payFrequency: pay.payFrequency,
    grossWagesCents: grossCents,
    // An ILLUSTRATION starts the year at zero. Real year-to-date figures would
    // make this screen show a different answer in December than in January for
    // the same setup, which is not what "what will come out of this check?"
    // means. ZERO_YTD is reused rather than re-typed so a new accumulator added
    // to the engine cannot be silently forgotten here.
    ytd: ZERO_YTD,
    hundredthHours: pay.basis === "hourly" ? hundredthHours : 0,
    // Passing null where a rate refused is deliberate: the engine already knows
    // how to refuse a line for want of an evidenced rate, and it says so in
    // Michael's language. Substituting a zero here would silently buy a wrong
    // number rather than an honest gap.
    stateUnemploymentRateMilliPct: suta.value,
    sutaRateNoticeDocumentId: documentIdFor("wa_suta_total", onIsoDate),
    stateContributionsPaidTimely: true,
    creditReductionMilliPct: 0,
    pfmlTotalRateMilliPct: pfmlTotal.value ?? 0,
    pfmlEmployerSharePctMilliPct: pfmlEmployerShare.value ?? 0,
    employerHasFewerThan50WaEmployees: true,
    waCaresRateMilliPct: waCares.value ?? 0,
    waCaresExemptionApprovalDocumentId: null,
    employeeClaimsWaCaresExemption: false,
    lniEmployeeRateMilliCentsPerHour: lniEmployee.value,
    lniEmployerRateMilliCentsPerHour: lniEmployer.value,
    lniRiskClassCode: GREENWAY_LNI_RISK_CLASS_CODE,
    lniRateNoticeDocumentId: documentIdFor("lni_employee_rate", onIsoDate),
  });

  // The engine's own refusals matter as much as the registry's - a SUTA rate
  // that is not on file stops a line either way, and Michael should see one
  // list of everything that is missing, not two.
  for (const r of taxes.refusals) {
    refusals.push(`${r.message} ${r.whatToDo}`);
  }

  // --- employee side -----------------------------------------------------
  const employeeLines: PaycheckLine[] = [];

  employeeLines.push({
    label: "Federal income tax",
    amountCents: taxes.federalIncomeTax.line4b_withholdingCents,
    formula: worksheetFormula(taxes, grossCents, periods),
    bearer: "employee",
    authorityId: "pub15t-2026-automated-method",
  });

  employeeLines.push({
    label: "Social Security (OASDI)",
    amountCents: taxes.fica.employeeOasdiCents,
    formula:
      `${formatCentsPlain(taxes.fica.oasdiTaxableCents)} x 6.2% ` +
      `= ${formatCentsPlain(taxes.fica.employeeOasdiCents)}` +
      (taxes.fica.oasdiCeilingReached
        ? " (the yearly Social Security wage cap has been reached, so only the part " +
          "of this check still under the cap was taxed)"
        : ""),
    bearer: "employee",
    authorityId: "irc-3101-employee-fica",
  });

  employeeLines.push({
    label: "Medicare",
    amountCents: taxes.fica.employeeMedicareCents + taxes.fica.employeeAdditionalMedicareCents,
    formula:
      `${formatCentsPlain(taxes.fica.medicareTaxableCents)} x 1.45% ` +
      `= ${formatCentsPlain(taxes.fica.employeeMedicareCents)}` +
      (taxes.fica.employeeAdditionalMedicareCents > 0
        ? `, plus ${formatCentsPlain(taxes.fica.employeeAdditionalMedicareCents)} ` +
          `Additional Medicare Tax at 0.9% on the wages above the threshold ` +
          `(employee only - there is no employer match on that part)`
        : " (no wage cap - Medicare runs on every dollar)"),
    bearer: "employee",
    authorityId: "irc-3101-employee-fica",
  });

  employeeLines.push({
    label: "WA Paid Family & Medical Leave",
    amountCents: taxes.pfml.employeeShareCents,
    // The share is shown as a share, not as a magic decimal. Sage hard-codes
    // .2857 here with a zero fallback; the number below is derived.
    formula: pfmlTotal.refusal
      ? pfmlTotal.refusal
      : `${formatCentsPlain(taxes.pfml.pfmlTaxableCents)} x ` +
        `${formatMilliPct(pfmlTotal.value ?? 0)} = ` +
        `${formatCentsPlain(taxes.pfml.totalPremiumCents)} total premium, of which ` +
        `the employee share is ${formatCentsPlain(taxes.pfml.employeeShareCents)}`,
    bearer: "employee",
    authorityId: "rcw-50a-10-030-pfml",
    refusal: pfmlTotal.refusal ?? undefined,
  });

  employeeLines.push({
    label: "WA Cares Fund",
    amountCents: taxes.waCares.employeeCents,
    formula: taxes.waCares.exempt
      ? "Exempt - an approved WA Cares exemption is on file, so nothing is withheld."
      : waCares.refusal
        ? waCares.refusal
        : `${formatCentsPlain(taxes.waCares.waCaresTaxableCents)} x ` +
          `${formatMilliPct(waCares.value ?? 0)} = ` +
          `${formatCentsPlain(taxes.waCares.employeeCents)} (no wage cap - this one runs ` +
          `on every dollar, unlike Social Security)`,
    bearer: "employee",
    authorityId: "rcw-50b-04-080-wa-cares",
    refusal: waCares.refusal ?? undefined,
  });

  if (taxes.lni.ok) {
    employeeLines.push({
      label: "L&I workers' compensation (employee half)",
      amountCents: taxes.lni.value.employeeCents,
      // THE LINE THAT MATTERS MOST. Sage computes L&I as a percentage of
      // dollars; it is a rate per HOUR. On a bonus-only check Sage would
      // withhold something and the right answer is nothing.
      formula:
        `${formatMilliCentsAsRate(lniEmployee.value ?? 0)} per hour x ` +
        `${formatHours(taxes.lni.value.hundredthHours)} hours worked = ` +
        `${formatCentsPlain(taxes.lni.value.employeeCents)} ` +
        `(per HOUR, not per dollar - risk class ${GREENWAY_LNI_RISK_CLASS_CODE})`,
      bearer: "employee",
      authorityId: "rcw-51-16-140-lni-deduction",
    });
  } else {
    employeeLines.push({
      label: "L&I workers' compensation (employee half)",
      amountCents: 0,
      formula: refusalSentence(taxes.lni.refusal),
      bearer: "employee",
      refusal: refusalSentence(taxes.lni.refusal),
      authorityId: "rcw-51-16-140-lni-deduction",
    });
  }

  // --- employer side -----------------------------------------------------
  const employerLines: PaycheckLine[] = [
    {
      label: "Social Security (employer match)",
      amountCents: taxes.fica.employerOasdiCents,
      formula:
        `${formatCentsPlain(taxes.fica.oasdiTaxableCents)} x 6.2% ` +
        `= ${formatCentsPlain(taxes.fica.employerOasdiCents)} (matches the employee, ` +
        `dollar for dollar)`,
      bearer: "employer",
      authorityId: "irc-3111-employer-fica",
    },
    {
      label: "Medicare (employer match)",
      amountCents: taxes.fica.employerMedicareCents,
      formula:
        `${formatCentsPlain(taxes.fica.medicareTaxableCents)} x 1.45% ` +
        `= ${formatCentsPlain(taxes.fica.employerMedicareCents)}` +
        (taxes.fica.employeeAdditionalMedicareCents > 0
          ? " (the Additional Medicare Tax above is employee-only; there is no " +
            "employer match on it)"
          : ""),
      bearer: "employer",
      authorityId: "irc-3111-employer-fica",
    },
    {
      label: "FUTA (federal unemployment)",
      amountCents: taxes.futa.netFutaCents,
      formula: futaFormula(taxes),
      bearer: "employer",
      authorityId: "irc-3301-futa-rate",
    },
  ];

  if (taxes.suta.ok) {
    employerLines.push({
      label: "WA unemployment (SUTA)",
      amountCents: taxes.suta.value.employerCents,
      formula:
        `${formatCentsPlain(taxes.suta.value.sutaTaxableCents)} x ` +
        `${formatMilliPct(suta.value ?? 0)} ` +
        `= ${formatCentsPlain(taxes.suta.value.employerCents)} ` +
        `(employer-paid: none of this comes out of their check)`,
      bearer: "employer",
      authorityId: "esd-suta-rate-structure",
    });
  } else {
    employerLines.push({
      label: "WA unemployment (SUTA)",
      amountCents: 0,
      formula: refusalSentence(taxes.suta.refusal),
      bearer: "employer",
      refusal: refusalSentence(taxes.suta.refusal),
      authorityId: "esd-suta-rate-structure",
    });
  }

  if (taxes.lni.ok) {
    employerLines.push({
      label: "L&I workers' compensation (employer share)",
      amountCents: taxes.lni.value.employerCents,
      formula:
        `${formatMilliCentsAsRate(lniEmployer.value ?? 0)} per hour x ` +
        `${formatHours(taxes.lni.value.hundredthHours)} hours worked = ` +
        `${formatCentsPlain(taxes.lni.value.employerCents)}`,
      bearer: "employer",
      authorityId: "rcw-51-16-140-lni-deduction",
    });
  }

  // Shown even when it is zero, and the formula says WHY it is zero. Greenway
  // has fewer than fifty Washington employees, so the employer share of PFML is
  // genuinely nothing - and a line that silently vanishes is indistinguishable
  // from a line somebody forgot (rule 46).
  employerLines.push({
    label: "WA PFML (employer share)",
    amountCents: taxes.pfml.employerShareCents,
    formula: taxes.pfml.employerExemptSmallBusiness
      ? `${formatCentsPlain(0)} - with fewer than 50 Washington employees you are not ` +
        `required to pay the employer share. The employee's portion is still withheld ` +
        `and still owed.`
      : `${formatCentsPlain(taxes.pfml.totalPremiumCents)} total premium minus the ` +
        `employee's ${formatCentsPlain(taxes.pfml.employeeShareCents)} ` +
        `= ${formatCentsPlain(taxes.pfml.employerShareCents)}`,
    bearer: "employer",
    authorityId: "rcw-50a-10-030-pfml",
  });

  // Both totals come from the engine rather than from summing the lines above.
  // Adding up the display rows would produce a number that agrees with the
  // screen and disagrees with the ledger the moment a line is added, renamed or
  // conditionally hidden - and the screen would still look perfectly correct.
  const takeHomeCents = taxes.netPayCents;
  const employerCostCents = grossCents + taxes.totalEmployerTaxCents;

  return {
    periodLabel: periodLabelFor(pay),
    grossCents,
    grossFormula,
    employeeLines,
    employerLines,
    takeHomeCents,
    takeHomeFormula:
      `${formatCentsPlain(grossCents)} gross - ` +
      `${formatCentsPlain(taxes.totalEmployeeWithheldCents)} withheld ` +
      `= ${formatCentsPlain(takeHomeCents)} take-home`,
    uncollectedEmployeeTaxCents: taxes.uncollectedEmployeeTaxCents,
    employerCostCents,
    employerCostFormula:
      `${formatCentsPlain(grossCents)} gross + ` +
      `${formatCentsPlain(taxes.totalEmployerTaxCents)} employer taxes ` +
      `= ${formatCentsPlain(employerCostCents)} total cost to Greenway`,
    refusals,
    taxes,
  };
}

// ===========================================================================
// 3) FORMATTERS
//
// These exist so the formula strings above read like something a person would
// write on paper, rather than like a debug dump.
// ===========================================================================

/** 16445 milli-cents/hour -> "$0.16445". Five decimals, because that is real. */
export function formatMilliCentsAsRate(milliCents: number): string {
  const dollars = milliCents / 100_000;
  // Trim trailing zeros but never below 2 decimals, so $17.00 does not become
  // "$17" and $0.16445 keeps all five.
  const s = dollars.toFixed(5).replace(/0+$/, "");
  const trimmed = s.endsWith(".") ? `${s}00` : s;
  const parts = trimmed.split(".");
  const decimals = parts[1] ?? "";
  return `$${parts[0]}.${decimals.padEnd(2, "0")}`;
}

/** 920 milli-percent -> "0.92%". */
export function formatMilliPct(milliPct: number): string {
  const pct = milliPct / 1000;
  return `${pct.toFixed(pct < 0.1 ? 3 : 2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

/** 8000 hundredth-hours -> "80.00". */
export function formatHours(hundredthHours: number): string {
  // Integer division on purpose: hundredthHours is an integer count and
  // dividing by 100 in floating point is the one arithmetic here that could
  // reintroduce drift into a displayed number.
  const whole = Math.trunc(hundredthHours / 100);
  const frac = Math.abs(hundredthHours % 100);
  return `${whole}.${String(frac).padStart(2, "0")}`;
}

/** A refusal, as one sentence Michael can act on. */
export function refusalSentence(refusal: PayrollRefusal): string {
  return `${refusal.message} ${refusal.whatToDo}`;
}

function periodLabelFor(pay: PayRecord): string {
  // Michael's own cadence gets said out loud, because "biweekly" is the exact
  // word Sage used while defaulting him to weekly, and the count is the thing
  // that actually drives the arithmetic.
  if (pay.payFrequency === "biweekly") {
    return "One two-week pay period (every other Friday, 26 per year)";
  }
  if (pay.payFrequency === "annually") {
    return "One annual payment (1 per year - this is how you pay yourself)";
  }
  // Falls back to the shared label map rather than interpolating the raw enum,
  // so a frequency can never render as "One semimonthly pay period".
  return `One pay period - ${PAY_FREQUENCY_LABELS[pay.payFrequency]}`;
}

function worksheetFormula(
  taxes: PaycheckTaxes,
  grossCents: number,
  periods: number,
): string {
  const fit = taxes.federalIncomeTax;
  if (fit.line4b_withholdingCents === 0 && fit.clamp3cFired) {
    return (
      `${formatCentsPlain(0)} - the credits claimed in Step 3 of their W-4 cover the ` +
      `whole calculated amount. Withholding stops at zero; it never becomes a refund ` +
      `paid through payroll.`
    );
  }
  const annualised = formatCentsPlain(fit.line1c_annualWagesCents);
  const perPeriod =
    periods === 1
      ? // Saying "divided back by 1" out loud would read like a mistake. For an
        // annual period the annualise/de-annualise round trip is the identity,
        // so the sentence says so plainly.
        `no annualising is needed because this is the only payment of the year`
      : `then divided back by ${periods}`;
  return (
    `${formatCentsPlain(grossCents)} x ${periods} pay period${periods === 1 ? "" : "s"} = ` +
    `${annualised} a year, run through the Pub. 15-T percentage-method table, ` +
    `${perPeriod} = ${formatCentsPlain(fit.line4b_withholdingCents)}`
  );
}

function futaFormula(taxes: PaycheckTaxes): string {
  const f = taxes.futa;
  if (f.futaTaxableCents === 0) {
    return (
      `${formatCentsPlain(0)} - the $7,000 FUTA wage base is already used up ` +
      `for this employee this year, so nothing more is owed`
    );
  }
  // 6.0% gross less the state credit. Both halves are shown because the net rate
  // alone (typically 0.6%) looks like an arbitrary small number, and the credit
  // is the part that disappears if state contributions are ever paid late.
  return (
    `${formatCentsPlain(f.futaTaxableCents)} x 6.0% = ` +
    `${formatCentsPlain(f.grossFutaCents)}, less a state credit of ` +
    `${formatCentsPlain(f.creditCents)} ` +
    `(${formatMilliPct(f.effectiveCreditMilliPct)}) = ${formatCentsPlain(f.netFutaCents)}`
  );
}
