/**
 * GARNISHMENT CORE - disposable earnings, exemptions, caps, and how to split a
 * paycheck that cannot satisfy everyone.
 *
 * books-33. Michael's instruction for this slice, verbatim: "I also need a way
 * to set garnishments and child support deductions."
 *
 * WHY THIS FILE IS LONGER THAN IT LOOKS LIKE IT SHOULD BE.
 *
 * Garnishment is the part of payroll where an employer becomes personally
 * liable for arithmetic. Withhold too little on a child support order and the
 * employer can be on the hook for the shortfall. Withhold too much and it is a
 * wage claim. There is no safe direction to be wrong in, and the calculation
 * has four independent traps that a reasonable person would not guess:
 *
 *   1. DISPOSABLE EARNINGS IS NOT NET PAY. 15 U.S.C. 1672(b) defines it as
 *      earnings less "any amounts required by law to be withheld". Taxes are
 *      required by law. Health insurance, 401(k), union dues and a uniform
 *      deduction are NOT, no matter how routine they feel. Subtracting them
 *      shrinks disposable earnings and under-withholds on the order. This is
 *      the single most common error in the field.
 *
 *   2. FEDERAL AND STATE BOTH APPLY, AND THE EMPLOYEE GETS THE BETTER DEAL.
 *      The CCPA sets a federal ceiling; Washington sets its own exemption. The
 *      employer applies whichever leaves the employee MORE money. Applying only
 *      one of them is wrong roughly half the time.
 *
 *   3. THE WEEKLY FORMULA DOES NOT SURVIVE A BIWEEKLY PAYROLL. The statute is
 *      written per workweek. Greenway pays every two weeks. 29 CFR 870.10(c)(2)
 *      says to multiply the number of workweeks by the minimum wage and then by
 *      thirty - so the protected floor DOUBLES for a biweekly cheque. Using the
 *      weekly figure on a biweekly cheque over-garnishes every single time.
 *
 *   4. SUPPORT ORDERS ESCAPE THE 25 PERCENT CAP ENTIRELY. 15 U.S.C. 1673(b)
 *      replaces it with 50, 55, 60 or 65 percent depending on two facts most
 *      payroll systems never ask for: whether the employee supports another
 *      family, and whether any arrears are older than twelve weeks.
 *
 * Every one of those four is implemented here as a named function with the
 * citation attached, so the trap is visible in the code rather than buried in
 * a total.
 *
 * STANDING RULE 62d - NEVER INVENT A DEFAULT. The federal minimum wage is NOT
 * hardcoded. 29 CFR 870.10 still speaks in terms of the $4.25 wage of 1991 and
 * quotes dollar figures frozen at that level; anybody copying $127.50 out of
 * the regulation today would be badly wrong. The wage is an input, and an
 * absent one produces a refusal rather than a guess.
 *
 * WHAT THIS FILE IS NOT. It is not legal advice and it does not decide
 * priority between competing writs on its own authority - where the law does
 * not settle an ordering it says so and asks Michael. It is pure: no database,
 * no clock, no network.
 */

// ===========================================================================
// 1) MONEY UNITS
//
// Everything is WHOLE CENTS. No floats crossing a function boundary, because a
// half cent that survives twenty-six pay periods becomes a real discrepancy
// against a court order, and courts do not accept floating point as a reason.
// ===========================================================================

/** Thousandths of a cent per hour - the unit the rate registry speaks. */
export type MilliCentsPerHour = number;

export function centsToDollars(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  return `${neg ? "-" : ""}$${(abs / 100).toFixed(2)}`;
}

// ===========================================================================
// 2) INPUT SHAPES - mirrors of public.wage_orders in migration 0198
// ===========================================================================

/** Mirrors wage_orders.order_kind. */
export type WageOrderKind =
  | "child_support"
  | "spousal_support"
  | "creditor"
  | "consumer_debt"
  | "student_loan"
  | "federal_tax_levy"
  | "state_tax_levy";

export type WageOrder = {
  readonly id: string;
  readonly employeeId: string;
  readonly orderKind: WageOrderKind;
  readonly caseNumber: string;
  /**
   * Fixed amount per pay period, in cents. Exactly one of this and
   * `percentOfDisposableBasisPoints` is set - the database enforces the XOR
   * with wage_orders_states_one_measure.
   */
  readonly amountCents: number | null;
  /** Basis points of disposable earnings. 2500 = 25%. */
  readonly percentOfDisposableBasisPoints: number | null;
  /**
   * Whether any arrears are more than twelve weeks old. Drives the 50 to 55 and
   * 60 to 65 bump in 15 U.S.C. 1673(b)(2). Nullable, and null on a support
   * order is a REFUSAL, not a false.
   */
  readonly arrearsOverTwelveWeeks: boolean | null;
  /**
   * Whether the employee supports another spouse or dependent child. Drives 50
   * versus 60 percent. Same rule: null on a support order refuses.
   */
  readonly supportsSecondFamily: boolean | null;
  /** Lower number is satisfied first. Only meaningful within a kind. */
  readonly priority: number;
};

/** Everything the engine needs about the cheque being garnished. */
export type PaycheckFacts = {
  /**
   * GROSS earnings for the period, in cents. Includes overtime, bonuses and
   * commissions. Sick pay is earnings too and IS included here - it is money
   * for personal services in the relevant sense, even though it is excluded
   * from the overtime regular rate for a different reason entirely.
   */
  readonly grossCents: number;
  /**
   * Amounts REQUIRED BY LAW to be withheld, in cents: federal income tax,
   * social security, medicare, and in Washington the employee share of PFML
   * and WA Cares. NOTHING ELSE.
   */
  readonly requiredByLawWithheldCents: number;
  /**
   * Deductions that are NOT required by law - health premiums, retirement,
   * dues. Captured only so the engine can SHOW that it correctly ignored them.
   * Standing rule 64a: proving we did not subtract these is worth more than
   * silently not subtracting them.
   */
  readonly voluntaryDeductionsCents: number;
  /**
   * Workweeks, or fractions of one, compensated by this cheque. 2 for a normal
   * biweekly period. 29 CFR 870.10(c)(2) multiplies the protected floor by
   * this. NOT derived from the pay frequency, because a final cheque can cover
   * a fraction of a week.
   */
  readonly workweeksInPeriod: number;
};

/** The two minimum wages the exemption formulas need. */
export type MinimumWageFacts = {
  /**
   * Federal minimum hourly wage in force when the earnings are payable, in
   * thousandths of a cent. Null means unknown, and unknown means refuse.
   */
  readonly federalMilliCentsPerHour: MilliCentsPerHour | null;
  /**
   * The highest minimum wage law in the state at the time the earnings are
   * payable, in thousandths of a cent. Null means unknown - which is the live
   * situation for every date in 2027 until L&I publishes on 2026-09-30.
   */
  readonly stateMilliCentsPerHour: MilliCentsPerHour | null;
};

// ===========================================================================
// 3) REFUSALS
// ===========================================================================

export type GarnishmentRefusalCode =
  | "NO_FEDERAL_MINIMUM_WAGE"
  | "NO_STATE_MINIMUM_WAGE"
  | "NEGATIVE_GROSS"
  | "WITHHOLDING_EXCEEDS_GROSS"
  | "NO_WORKWEEK_COUNT"
  | "ORDER_HAS_NO_MEASURE"
  | "ORDER_HAS_TWO_MEASURES"
  | "SUPPORT_MISSING_SECOND_FAMILY_ANSWER"
  | "SUPPORT_MISSING_ARREARS_ANSWER"
  | "PERCENT_OUT_OF_RANGE"
  | "UNKNOWN_ORDER_KIND";

export type GarnishmentRefusal = {
  readonly code: GarnishmentRefusalCode;
  readonly message: string;
  readonly fix: string;
  readonly authorityIds: readonly string[];
  readonly orderId?: string;
};

export type GarnishmentResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusals: readonly GarnishmentRefusal[] };

function refuse(
  code: GarnishmentRefusalCode,
  message: string,
  fix: string,
  authorityIds: readonly string[] = [],
  orderId?: string,
): GarnishmentRefusal {
  return { code, message, fix, authorityIds, orderId };
}

// ===========================================================================
// 4) DISPOSABLE EARNINGS - trap 1
//
// 15 U.S.C. 1672(b): "that part of the earnings of any individual remaining
// after the deduction from those earnings of any amounts required by law to be
// withheld."
//
// The `ignored` field is not decoration. When Michael asks why the garnishment
// is bigger than he expected, the answer is almost always that health insurance
// was not subtracted, and the engine should be able to say so before he calls
// anyone.
// ===========================================================================

export type DisposableEarnings = {
  readonly grossCents: number;
  readonly requiredByLawWithheldCents: number;
  readonly disposableCents: number;
  /** Voluntary deductions that were deliberately NOT subtracted. */
  readonly ignoredVoluntaryCents: number;
  readonly explanation: string;
};

export function computeDisposableEarnings(
  pay: PaycheckFacts,
): GarnishmentResult<DisposableEarnings> {
  if (!Number.isFinite(pay.grossCents) || pay.grossCents < 0) {
    return {
      ok: false,
      refusals: [
        refuse(
          "NEGATIVE_GROSS",
          "This paycheck has negative or missing gross pay, so there is nothing sensible to garnish from.",
          "Check the pay run - a negative gross usually means a correction was entered in the wrong direction.",
          ["usc-15-1672-disposable"],
        ),
      ],
    };
  }
  if (
    !Number.isFinite(pay.requiredByLawWithheldCents) ||
    pay.requiredByLawWithheldCents < 0 ||
    pay.requiredByLawWithheldCents > pay.grossCents
  ) {
    return {
      ok: false,
      refusals: [
        refuse(
          "WITHHOLDING_EXCEEDS_GROSS",
          "The taxes and other legally required withholding on this cheque add up to more than the gross pay, which cannot be right, so I stopped rather than produce a garnishment from a nonsense number.",
          "Check the tax lines on this pay run before setting up any withholding.",
          ["usc-15-1672-disposable"],
        ),
      ],
    };
  }

  const disposable = pay.grossCents - pay.requiredByLawWithheldCents;
  const ignored = Math.max(0, Math.floor(pay.voluntaryDeductionsCents || 0));

  const explanation =
    `Gross pay ${centsToDollars(pay.grossCents)} less ${centsToDollars(pay.requiredByLawWithheldCents)} of legally required withholding leaves ${centsToDollars(disposable)} of disposable earnings.` +
    (ignored > 0
      ? ` The ${centsToDollars(ignored)} of voluntary deductions - things like health insurance or retirement - were deliberately NOT subtracted. They feel like they should count, but the law only lets you subtract what you are REQUIRED to withhold, and subtracting them here would shortchange the order and leave you liable for the difference.`
      : "");

  return {
    ok: true,
    value: {
      grossCents: pay.grossCents,
      requiredByLawWithheldCents: pay.requiredByLawWithheldCents,
      disposableCents: disposable,
      ignoredVoluntaryCents: ignored,
      explanation,
    },
  };
}

// ===========================================================================
// 5) THE PERIOD-ADJUSTED FLOOR - trap 3
//
// 29 CFR 870.10(c)(2): "The number of workweeks, or fractions thereof, should
// be multiplied times the applicable Federal minimum wage and that amount
// should be multiplied by 30."
//
// The regulation's own worked examples use the 1991 minimum wage of $4.25 and
// arrive at $127.50 a week. We reproduce the FORMULA, never the frozen figures.
// The unit test proves the formula reproduces $127.50 when fed $4.25, which is
// how we know the arithmetic matches the government's without inheriting a
// wage that is thirty-five years stale.
// ===========================================================================

export function protectedFloorCents(args: {
  readonly minimumWageMilliCentsPerHour: MilliCentsPerHour;
  readonly multipleOfMinimumWage: number; // 30 for CCPA, 35 or 50 for WA
  readonly workweeksInPeriod: number;
}): number {
  // milli-cents per hour * hours-multiple = milli-cents, then to cents.
  const perWeekMilliCents = args.minimumWageMilliCentsPerHour * args.multipleOfMinimumWage;
  const totalMilliCents = perWeekMilliCents * args.workweeksInPeriod;
  return Math.round(totalMilliCents / 1000);
}

// ===========================================================================
// 6) THE FEDERAL CCPA CEILING - 15 U.S.C. 1673(a)
//
// The LESSER of 25 percent of disposable earnings, or the amount by which
// disposable earnings exceed thirty times the federal minimum wage.
// ===========================================================================

export type CcpaCeiling = {
  readonly ceilingCents: number;
  readonly twentyFivePercentCents: number;
  readonly excessOverFloorCents: number;
  readonly floorCents: number;
  readonly binding: "twenty_five_percent" | "thirty_times_minimum_wage";
  readonly explanation: string;
};

export function ccpaCeiling(args: {
  readonly disposableCents: number;
  readonly federalMinimumWageMilliCents: MilliCentsPerHour;
  readonly workweeksInPeriod: number;
}): CcpaCeiling {
  const quarter = Math.floor(args.disposableCents * 0.25);
  const floor = protectedFloorCents({
    minimumWageMilliCentsPerHour: args.federalMinimumWageMilliCents,
    multipleOfMinimumWage: 30,
    workweeksInPeriod: args.workweeksInPeriod,
  });
  const excess = Math.max(0, args.disposableCents - floor);
  const ceiling = Math.min(quarter, excess);

  // WHICH RULE BINDS IS DECIDED BEFORE ROUNDING, DELIBERATELY.
  //
  // `quarter` is floored to whole cents. Just below the crossover point the
  // floored quarter can come out EQUAL to the excess even though the true
  // quarter is larger - at $169.99 the exact quarter is $42.4975 and the
  // excess is $42.49, but both floor to 4249. Comparing the floored values
  // then reports "25% is binding" on a cheque where the protected floor is
  // actually what limits it. The withheld amount is right either way; the
  // SENTENCE Michael reads is not, and under rule 64a the explanation is the
  // product, not a garnish on it.
  //
  // So compare exactly, in integers: quarter <= excess  <=>  D*25 <= excess*100.
  const binding =
    args.disposableCents * 25 <= excess * 100
      ? "twenty_five_percent"
      : "thirty_times_minimum_wage";

  const explanation =
    `Federal law caps this at the LESSER of 25% of disposable earnings (${centsToDollars(quarter)}) ` +
    `or whatever is left above thirty times the federal minimum wage for ${args.workweeksInPeriod} workweek${args.workweeksInPeriod === 1 ? "" : "s"} (${centsToDollars(floor)} protected, leaving ${centsToDollars(excess)}). ` +
    `The ${binding === "twenty_five_percent" ? "25% figure" : "protected-floor figure"} is smaller, so the federal ceiling is ${centsToDollars(ceiling)}.` +
    (excess === 0
      ? " Disposable earnings do not exceed the protected floor at all, so federal law allows NOTHING to be garnished from this cheque."
      : "");

  return {
    ceilingCents: ceiling,
    twentyFivePercentCents: quarter,
    excessOverFloorCents: excess,
    floorCents: floor,
    binding,
    explanation,
  };
}

// ===========================================================================
// 7) THE WASHINGTON EXEMPTION - RCW 6.27.150
//
// Washington protects the GREATEST of a multiple of a minimum wage or a
// percentage of disposable earnings, and the multiplier, the percentage AND
// WHICH minimum wage all change with the kind of debt:
//
//   (1) ordinary judgment  - greatest of 35x FEDERAL MW or 75%
//   (3) private student loan - greater of 50x the HIGHEST STATE MW or 85%
//   (4) consumer debt      - greater of 35x the STATE MW or 80%
//
// Note (1) says federal and (4) says state. That is not a transcription slip;
// the statute really does switch, and in Washington the difference is large
// because the state wage is more than double the federal one.
// ===========================================================================

export type WashingtonExemption = {
  readonly exemptCents: number;
  readonly nonExemptCents: number;
  readonly wageMultipleCents: number;
  readonly percentageCents: number;
  readonly binding: "wage_multiple" | "percentage";
  readonly explanation: string;
};

export function washingtonExemption(args: {
  readonly disposableCents: number;
  readonly orderKind: WageOrderKind;
  readonly wages: MinimumWageFacts;
  readonly workweeksInPeriod: number;
}): GarnishmentResult<WashingtonExemption> {
  let multiple: number;
  let percentBasisPoints: number;
  let whichWage: "federal" | "state";
  let cite: string;

  switch (args.orderKind) {
    case "student_loan":
      multiple = 50;
      percentBasisPoints = 8_500;
      whichWage = "state";
      cite = "rcw-6-27-150-student-loan";
      break;
    case "consumer_debt":
      multiple = 35;
      percentBasisPoints = 8_000;
      whichWage = "state";
      cite = "rcw-6-27-150-consumer-debt";
      break;
    case "spousal_support":
      // RCW 26.18.090(3) exempts fifty percent for maintenance wage
      // assignments and expressly disapplies RCW 6.27.150 to them.
      multiple = 0;
      percentBasisPoints = 5_000;
      whichWage = "federal";
      cite = "rcw-26-18-090-fifty-percent";
      break;
    case "creditor":
      multiple = 35;
      percentBasisPoints = 7_500;
      whichWage = "federal";
      cite = "rcw-6-27-150-general";
      break;
    case "child_support":
    case "federal_tax_levy":
    case "state_tax_levy":
      // These do not run through RCW 6.27.150 at all. Handled by the caller;
      // returning a zero exemption here would be a silent wrong answer, so we
      // refuse instead.
      return {
        ok: false,
        refusals: [
          refuse(
            "UNKNOWN_ORDER_KIND",
            `A ${args.orderKind.replace(/_/g, " ")} is not governed by the ordinary Washington garnishment exemption, so asking for that exemption would give a wrong answer.`,
            "This kind of order is computed on its own path. If you are seeing this message, the pay run called the wrong function - tell the developer, do not adjust the order.",
            ["rcw-6-27-150-general"],
          ),
        ],
      };
    default: {
      const never: never = args.orderKind;
      return {
        ok: false,
        refusals: [
          refuse(
            "UNKNOWN_ORDER_KIND",
            `I do not know how to apply the Washington exemption to an order of kind "${String(never)}".`,
            "Check the order kind on this wage order.",
          ),
        ],
      };
    }
  }

  const wage =
    whichWage === "state"
      ? args.wages.stateMilliCentsPerHour
      : args.wages.federalMilliCentsPerHour;

  if (multiple > 0 && wage === null) {
    return {
      ok: false,
      refusals: [
        whichWage === "state"
          ? refuse(
              "NO_STATE_MINIMUM_WAGE",
              "I cannot work out the Washington exemption for this order, because it is measured against the state minimum wage and I have no evidenced figure for the date this cheque is payable. I will not reuse last year's - a stale wage produces a garnishment that looks right and is not.",
              "Add the Washington minimum wage for this year to the rate registry, with the L&I announcement it came from. Labor and Industries publishes it on September 30 for the following January.",
              ["rcw-6-27-150-general", "rcw-49-46-020-minimum-wage"],
            )
          : refuse(
              "NO_FEDERAL_MINIMUM_WAGE",
              "I cannot work out the Washington exemption for this order, because it is measured against the FEDERAL minimum wage and no federal figure is on file.",
              "Add the federal minimum hourly wage in force on this pay date to the rate registry.",
              ["rcw-6-27-150-general"],
            ),
      ],
    };
  }

  const wageMultipleCents =
    multiple > 0 && wage !== null
      ? protectedFloorCents({
          minimumWageMilliCentsPerHour: wage,
          multipleOfMinimumWage: multiple,
          workweeksInPeriod: args.workweeksInPeriod,
        })
      : 0;

  const percentageCents = Math.floor((args.disposableCents * percentBasisPoints) / 10_000);

  // "Greatest of" - the employee keeps whichever protects more.
  const exempt = Math.min(args.disposableCents, Math.max(wageMultipleCents, percentageCents));
  const binding = wageMultipleCents >= percentageCents ? "wage_multiple" : "percentage";

  const explanation =
    multiple > 0
      ? `Washington protects the GREATER of ${multiple} times the ${whichWage} minimum wage for ${args.workweeksInPeriod} workweek${args.workweeksInPeriod === 1 ? "" : "s"} (${centsToDollars(wageMultipleCents)}) or ${percentBasisPoints / 100}% of disposable earnings (${centsToDollars(percentageCents)}). ` +
        `The ${binding === "wage_multiple" ? "wage multiple" : "percentage"} is larger, so ${centsToDollars(exempt)} is protected and at most ${centsToDollars(args.disposableCents - exempt)} can be taken under state law.`
      : `Washington protects ${percentBasisPoints / 100}% of disposable earnings for this kind of order, which is ${centsToDollars(exempt)}, leaving at most ${centsToDollars(args.disposableCents - exempt)}.`;

  return {
    ok: true,
    value: {
      exemptCents: exempt,
      nonExemptCents: Math.max(0, args.disposableCents - exempt),
      wageMultipleCents,
      percentageCents,
      binding,
      explanation: `${explanation} (${cite})`,
    },
  };
}

// ===========================================================================
// 8) THE SUPPORT CAP - trap 4, 15 U.S.C. 1673(b)(2)
//
// 50% supporting another family, 60% if not, each +5 points when any part of
// the withholding is for arrears older than twelve weeks.
//
// Both inputs are nullable and BOTH REFUSE WHEN NULL. There is no safe default:
// assume 50 and you under-withhold and become liable; assume 65 and you
// over-garnish someone's paycheque. The only correct behaviour is to ask.
// ===========================================================================

export type SupportCap = {
  readonly capBasisPoints: number;
  readonly capCents: number;
  readonly explanation: string;
};

export function supportCap(args: {
  readonly disposableCents: number;
  readonly supportsSecondFamily: boolean | null;
  readonly arrearsOverTwelveWeeks: boolean | null;
  readonly orderId?: string;
}): GarnishmentResult<SupportCap> {
  const refusals: GarnishmentRefusal[] = [];

  if (args.supportsSecondFamily === null) {
    refusals.push(
      refuse(
        "SUPPORT_MISSING_SECOND_FAMILY_ANSWER",
        "I cannot work out the support cap because nobody has recorded whether this employee is supporting another spouse or dependent child. That one answer is the difference between 50% and 60% of their disposable earnings, so guessing it wrong either shortchanges the order - which can land on you - or takes too much out of their cheque.",
        "Ask the employee, or read it off the withholding order, and record it on the wage order.",
        ["usc-15-1673-support-cap"],
        args.orderId,
      ),
    );
  }
  if (args.arrearsOverTwelveWeeks === null) {
    refusals.push(
      refuse(
        "SUPPORT_MISSING_ARREARS_ANSWER",
        "I cannot work out the support cap because nobody has recorded whether any of the arrears are more than twelve weeks old. That adds five percentage points to the cap.",
        "The withholding order normally states it. Record it on the wage order.",
        ["usc-15-1673-support-cap"],
        args.orderId,
      ),
    );
  }

  if (refusals.length > 0) return { ok: false, refusals };

  const base = args.supportsSecondFamily ? 5_000 : 6_000;
  const bp = base + (args.arrearsOverTwelveWeeks ? 500 : 0);
  const capCents = Math.floor((args.disposableCents * bp) / 10_000);

  const explanation =
    `Support orders are not held to the ordinary 25% ceiling. Because this employee ${args.supportsSecondFamily ? "IS" : "is NOT"} supporting another spouse or dependent child, the cap starts at ${base / 100}%` +
    (args.arrearsOverTwelveWeeks
      ? `, and because some arrears are more than twelve weeks old it rises by five points to ${bp / 100}%`
      : `, and with no arrears older than twelve weeks it stays at ${bp / 100}%`) +
    ` of ${centsToDollars(args.disposableCents)} disposable earnings, which is ${centsToDollars(capCents)}.`;

  return { ok: true, value: { capBasisPoints: bp, capCents, explanation } };
}

// ===========================================================================
// 9) ONE ORDER, START TO FINISH
//
// Applies trap 2: federal ceiling AND state exemption both computed, employee
// gets whichever is better for them.
// ===========================================================================

export type OrderComputation = {
  readonly orderId: string;
  readonly orderKind: WageOrderKind;
  readonly caseNumber: string;
  /** What the order asks for before any cap. */
  readonly requestedCents: number;
  /** The most the law allows from this cheque for this order. */
  readonly lawfulMaximumCents: number;
  /** What will actually be withheld. */
  readonly withheldCents: number;
  /** Requested minus withheld - the part the cap prevented. */
  readonly shortfallCents: number;
  readonly explanation: string;
};

export function computeOneOrder(args: {
  readonly order: WageOrder;
  readonly disposable: DisposableEarnings;
  readonly wages: MinimumWageFacts;
  readonly workweeksInPeriod: number;
}): GarnishmentResult<OrderComputation> {
  const { order, disposable } = args;

  // --- what does the order ask for? -------------------------------------
  const hasAmount = order.amountCents !== null;
  const hasPercent = order.percentOfDisposableBasisPoints !== null;

  if (!hasAmount && !hasPercent) {
    return {
      ok: false,
      refusals: [
        refuse(
          "ORDER_HAS_NO_MEASURE",
          `The order on case ${order.caseNumber} does not say how much to withhold - neither a dollar amount nor a percentage.`,
          "Open the wage order and enter either a fixed amount per pay period or a percentage of disposable earnings, whichever the paperwork specifies.",
          [],
          order.id,
        ),
      ],
    };
  }
  if (hasAmount && hasPercent) {
    return {
      ok: false,
      refusals: [
        refuse(
          "ORDER_HAS_TWO_MEASURES",
          `The order on case ${order.caseNumber} states both a dollar amount and a percentage, and those will disagree on most cheques. I will not pick one.`,
          "Open the wage order and delete whichever one the paperwork does not actually say.",
          [],
          order.id,
        ),
      ],
    };
  }
  if (hasPercent) {
    const bp = order.percentOfDisposableBasisPoints as number;
    if (!Number.isFinite(bp) || bp <= 0 || bp > 10_000) {
      return {
        ok: false,
        refusals: [
          refuse(
            "PERCENT_OUT_OF_RANGE",
            `The order on case ${order.caseNumber} asks for a percentage that is not between zero and one hundred.`,
            "Correct the percentage on the wage order.",
            [],
            order.id,
          ),
        ],
      };
    }
  }

  const requested = hasAmount
    ? Math.max(0, Math.floor(order.amountCents as number))
    : Math.floor(
        (disposable.disposableCents * (order.percentOfDisposableBasisPoints as number)) / 10_000,
      );

  // --- what does the law allow? -----------------------------------------
  let lawfulMax: number;
  let capExplanation: string;

  if (order.orderKind === "federal_tax_levy" || order.orderKind === "state_tax_levy") {
    // 15 U.S.C. 1673(b)(1)(C): the 25% restriction does not apply to "any debt
    // due for any State or Federal tax". The exempt amount for a FEDERAL levy
    // comes from IRS Publication 1494 under 26 U.S.C. 6334(d), which is a
    // filing-status and dependents table we have NOT mirrored. So the engine
    // does not invent a cap: it takes the amount the taxing authority itself
    // computed, which is what the levy paperwork states.
    lawfulMax = Math.min(requested, disposable.disposableCents);
    capExplanation =
      `Tax levies are not held to the 25% garnishment ceiling. The exempt amount is worked out by the taxing authority itself and printed on the levy paperwork, so this withholds the amount the notice states, limited only by what is actually on the cheque. ` +
      `Take the exempt-amount figure from the levy notice; do not compute it here.`;
  } else if (order.orderKind === "child_support" || order.orderKind === "spousal_support") {
    const cap = supportCap({
      disposableCents: disposable.disposableCents,
      supportsSecondFamily: order.supportsSecondFamily,
      arrearsOverTwelveWeeks: order.arrearsOverTwelveWeeks,
      orderId: order.id,
    });
    if (!cap.ok) return cap;

    // Washington caps maintenance withholding at fifty percent of disposable
    // earnings (RCW 26.18.090(2)), which can be stricter than the federal
    // support cap. The employee keeps the benefit of the stricter one.
    const waCap = Math.floor(disposable.disposableCents * 0.5);
    const federalCap = cap.value.capCents;
    lawfulMax = Math.min(federalCap, waCap);
    capExplanation =
      `${cap.value.explanation} Washington separately caps withholding for support at 50% of disposable earnings (${centsToDollars(waCap)}). ` +
      `Both apply and the employee keeps the benefit of whichever is stricter, so the ceiling here is ${centsToDollars(lawfulMax)}.`;
  } else {
    if (args.wages.federalMilliCentsPerHour === null) {
      return {
        ok: false,
        refusals: [
          refuse(
            "NO_FEDERAL_MINIMUM_WAGE",
            "I cannot cap this garnishment, because the federal ceiling is measured against thirty times the federal minimum hourly wage and no federal figure is on file for this pay date. I am refusing rather than using the dollar amounts printed in the regulation - those were frozen at the 1991 wage of $4.25 and copying them today would over-garnish badly.",
            "Add the federal minimum hourly wage in force on this pay date to the rate registry.",
            ["cfr-870-10-longer-period", "usc-15-1673-max-garnishment"],
            order.id,
          ),
        ],
      };
    }
    const fed = ccpaCeiling({
      disposableCents: disposable.disposableCents,
      federalMinimumWageMilliCents: args.wages.federalMilliCentsPerHour,
      workweeksInPeriod: args.workweeksInPeriod,
    });
    const wa = washingtonExemption({
      disposableCents: disposable.disposableCents,
      orderKind: order.orderKind,
      wages: args.wages,
      workweeksInPeriod: args.workweeksInPeriod,
    });
    if (!wa.ok) return wa;

    // TRAP 2. Both apply; the employee keeps the benefit of the better one, so
    // the lawful maximum is the SMALLER of the two allowances.
    lawfulMax = Math.min(fed.ceilingCents, wa.value.nonExemptCents);
    capExplanation =
      `${fed.explanation} ${wa.value.explanation} ` +
      `Both federal and state limits apply and the employee keeps whichever protects more, so the most that can come out of this cheque is the smaller allowance: ${centsToDollars(lawfulMax)}.`;
  }

  lawfulMax = Math.max(0, Math.min(lawfulMax, disposable.disposableCents));
  const withheld = Math.min(requested, lawfulMax);
  const shortfall = Math.max(0, requested - withheld);

  const explanation =
    `Case ${order.caseNumber} asks for ${centsToDollars(requested)}. ${capExplanation} ` +
    (shortfall > 0
      ? `That is less than the order asks for, so ${centsToDollars(withheld)} comes out and ${centsToDollars(shortfall)} goes unpaid this period. This is NOT a mistake and you should not make it up out of the next cheque on your own initiative - report the shortfall to the issuing agency, which is what the order requires and what protects you.`
      : `The full amount fits within the limit, so ${centsToDollars(withheld)} comes out.`);

  return {
    ok: true,
    value: {
      orderId: order.id,
      orderKind: order.orderKind,
      caseNumber: order.caseNumber,
      requestedCents: requested,
      lawfulMaximumCents: lawfulMax,
      withheldCents: withheld,
      shortfallCents: shortfall,
      explanation,
    },
  };
}

// ===========================================================================
// 10) MANY ORDERS ON ONE CHEQUE
//
// The hard case, and the one Michael will eventually hit.
//
// Two rules do real work here:
//
//   - CHILD SUPPORT IS PAID FIRST. Federal law requires income withholding for
//     support to take priority over other garnishments.
//
//   - MULTIPLE MAINTENANCE ORDERS ARE SPLIT EQUALLY. RCW 26.18.090(4): where
//     the non-exempt earnings will not satisfy them all, the employer must
//     "apportion the obligor's nonexempt disposable earnings between or among
//     the various obligees EQUALLY."
//
//     EQUALLY. Not pro rata by amount owed, which is what almost everyone
//     assumes and what several payroll packages actually do. Two orders, one
//     for $600 and one for $200, against $400 available, is $200 and $200 -
//     NOT $300/$100. The engine implements equal division with the leftover
//     pennies handed out one at a time in priority order so the total always
//     reconciles to the cent.
// ===========================================================================

const KIND_PRIORITY: Record<WageOrderKind, number> = {
  child_support: 1,
  spousal_support: 2,
  federal_tax_levy: 3,
  state_tax_levy: 4,
  student_loan: 5,
  consumer_debt: 6,
  creditor: 7,
};

export type MultiOrderResult = {
  readonly disposable: DisposableEarnings;
  readonly lines: readonly OrderComputation[];
  readonly totalWithheldCents: number;
  readonly totalShortfallCents: number;
  /** Notes Michael needs to act on, such as reporting a shortfall. */
  readonly notes: readonly string[];
  readonly explanation: string;
};

export function computeAllOrders(args: {
  readonly orders: readonly WageOrder[];
  readonly pay: PaycheckFacts;
  readonly wages: MinimumWageFacts;
}): GarnishmentResult<MultiOrderResult> {
  if (!Number.isFinite(args.pay.workweeksInPeriod) || args.pay.workweeksInPeriod <= 0) {
    return {
      ok: false,
      refusals: [
        refuse(
          "NO_WORKWEEK_COUNT",
          "I cannot apply the garnishment limits without knowing how many workweeks this cheque covers. The protected floor is a WEEKLY figure that has to be multiplied up, and using the weekly number on a two-week cheque takes roughly twice as much as the law allows.",
          "Set the number of workweeks on the pay period - two for a normal biweekly period.",
          ["cfr-870-10-longer-period"],
        ),
      ],
    };
  }

  const disposable = computeDisposableEarnings(args.pay);
  if (!disposable.ok) return disposable;

  const sorted = [...args.orders].sort((a, b) => {
    const k = KIND_PRIORITY[a.orderKind] - KIND_PRIORITY[b.orderKind];
    return k !== 0 ? k : a.priority - b.priority;
  });

  const refusals: GarnishmentRefusal[] = [];
  const lines: OrderComputation[] = [];
  const notes: string[] = [];

  // --- equal apportionment for competing MAINTENANCE orders -------------
  const maintenance = sorted.filter((o) => o.orderKind === "spousal_support");
  const equalShareByOrderId = new Map<string, number>();

  if (maintenance.length > 1) {
    const waCap = Math.floor(disposable.value.disposableCents * 0.5);
    const each = Math.floor(waCap / maintenance.length);
    let leftover = waCap - each * maintenance.length;
    for (const o of maintenance) {
      const extra = leftover > 0 ? 1 : 0;
      leftover -= extra;
      equalShareByOrderId.set(o.id, each + extra);
    }
    notes.push(
      `There ${maintenance.length === 2 ? "are two maintenance orders" : `are ${maintenance.length} maintenance orders`} against this employee and the non-exempt pay will not cover them all. Washington requires the available money to be split EQUALLY between them - not in proportion to what each one asks for, which is what most people assume. Each gets ${centsToDollars(each)}. If an obligee thinks that is unfair, the remedy is a court order reapportioning it, not a change here.`,
    );
  }

  for (const order of sorted) {
    const one = computeOneOrder({
      order,
      disposable: disposable.value,
      wages: args.wages,
      workweeksInPeriod: args.pay.workweeksInPeriod,
    });
    if (!one.ok) {
      refusals.push(...one.refusals);
      continue;
    }

    let line = one.value;

    const equalShare = equalShareByOrderId.get(order.id);
    if (equalShare !== undefined && line.withheldCents > equalShare) {
      const cappedWithheld = equalShare;
      line = {
        ...line,
        lawfulMaximumCents: Math.min(line.lawfulMaximumCents, equalShare),
        withheldCents: cappedWithheld,
        shortfallCents: Math.max(0, line.requestedCents - cappedWithheld),
        explanation: `${line.explanation} Because more than one maintenance order is competing for the same pay, the available money is divided EQUALLY, which limits this one to ${centsToDollars(equalShare)}.`,
      };
    }

    lines.push(line);
  }

  if (refusals.length > 0) return { ok: false, refusals };

  // --- the aggregate ceiling --------------------------------------------
  // Orders are satisfied in priority order until the money runs out. Support
  // comes first; a creditor writ gets what is left, which is frequently zero.
  let remaining = disposable.value.disposableCents;
  const finalLines: OrderComputation[] = [];

  for (const line of lines) {
    const canTake = Math.max(0, Math.min(line.withheldCents, remaining));
    remaining -= canTake;
    if (canTake === line.withheldCents) {
      finalLines.push(line);
    } else {
      finalLines.push({
        ...line,
        withheldCents: canTake,
        shortfallCents: Math.max(0, line.requestedCents - canTake),
        explanation: `${line.explanation} There was only ${centsToDollars(canTake)} left on the cheque after the higher-priority orders, so that is all that could be taken.`,
      });
    }
  }

  const totalWithheld = finalLines.reduce((n, l) => n + l.withheldCents, 0);
  const totalShortfall = finalLines.reduce((n, l) => n + l.shortfallCents, 0);

  if (totalShortfall > 0) {
    notes.push(
      `${centsToDollars(totalShortfall)} could not be withheld this period because the legal limits would not allow it. Report the shortfall to the agency that issued the order. Do not quietly take extra next period to catch up - that is over-garnishing, and the fact that it evens out does not make it lawful.`,
    );
  }
  if (disposable.value.ignoredVoluntaryCents > 0) {
    notes.push(
      `${centsToDollars(disposable.value.ignoredVoluntaryCents)} of voluntary deductions were correctly left in the calculation. If these numbers ever look too high to you, this is usually why - the law does not let health insurance or retirement reduce the base a garnishment is figured on.`,
    );
  }

  const explanation =
    `${disposable.value.explanation} ` +
    (finalLines.length === 0
      ? "There are no active orders against this employee, so nothing is withheld."
      : `${finalLines.length} order${finalLines.length === 1 ? "" : "s"} applied, ${centsToDollars(totalWithheld)} withheld in total, leaving ${centsToDollars(disposable.value.disposableCents - totalWithheld)} of disposable earnings.`);

  return {
    ok: true,
    value: {
      disposable: disposable.value,
      lines: finalLines,
      totalWithheldCents: totalWithheld,
      totalShortfallCents: totalShortfall,
      notes,
      explanation,
    },
  };
}
