/**
 * src/lib/accounting/basis-aaa-core.ts   (books-19)
 *
 * THE THREE RUNNING BALANCES THAT DECIDE WHETHER A DISTRIBUTION IS TAXED.
 *
 * Roadmap item 3 of 8. Pure functions, integer cents, no I/O, no database, no
 * dates beyond the fiscal year label. Everything here is a consequence of a
 * quoted authority in `basis-aaa-authorities.ts`.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE OF THE PROBLEM
 * ---------------------------------------------------------------------------
 *
 * Three balances, kept at two different levels:
 *
 *   STOCK BASIS   per shareholder   floor at zero        \u00a71367(a)(2)
 *   DEBT BASIS    per shareholder   floor at zero        \u00a71367(b)(2), \u00a71.1367-2
 *   AAA           per CORPORATION   no floor from losses \u00a71.1368-2(a)(3)(ii)
 *                                   floor from distributions \u00a71.1368-2(a)(3)(iii)
 *
 * They are adjusted in prescribed and DIFFERENT orders \u2014 \u00a71.1367-1(f) for
 * basis, \u00a71.1368-2(a)(5) for AAA. The most consequential difference: for basis,
 * distributions are subtracted BEFORE nondeductible expenses and losses; for
 * AAA, expenses and losses come first and distributions third. Implementing one
 * order and reusing it for both is the classic way to get this wrong, so the
 * two sequences are written out separately below and each step carries the
 * subparagraph it comes from.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS ENGINE REFUSES TO DO
 * ---------------------------------------------------------------------------
 *
 * It refuses rather than warns (standing rule 27) whenever the answer would
 * depend on a fact it has not been given: unknown earnings and profits, an
 * unknown \u00a71.1367-1(g) election, ownership that does not total 100%, a
 * distribution to somebody who is not a shareholder. Every refusal names the
 * authority that makes the missing fact matter, and says what to go and find.
 *
 * A wrong answer here is not a rounding error. It is the difference between a
 * tax-free draw and a reported capital gain.
 */
import type { StatementRefusal } from "@/lib/accounting/financial-statements-core";

// ---------------------------------------------------------------------------
// 1) MONEY, AND THE REFUSAL TO PRETEND
// ---------------------------------------------------------------------------

/** Standing rule 4: money is integer cents, always. Never a float. */
export function assertBasisCents(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(
      `INTEGER CENTS VIOLATION: ${label} = ${value}. Money is integer cents in this system; ` +
        `a fractional cent means a float crept in upstream and every later comparison is unsafe.`,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `UNSAFE INTEGER: ${label} = ${value}. Beyond Number.MAX_SAFE_INTEGER arithmetic silently ` +
        `stops being exact, which is worse than failing.`,
    );
  }
}

export type BasisRefusalCode =
  | "NOT_INTEGER_CENTS"
  | "NEGATIVE_INPUT"
  | "NO_SHAREHOLDERS"
  | "DUPLICATE_SHAREHOLDER"
  | "OWNERSHIP_NOT_100_PCT"
  | "UNKNOWN_SHAREHOLDER_IN_DISTRIBUTIONS"
  | "EARNINGS_AND_PROFITS_UNKNOWN"
  | "HAS_ACCUMULATED_EARNINGS_AND_PROFITS"
  | "ELECTIVE_ORDERING_UNKNOWN"
  | "BEGINNING_BASIS_NEGATIVE"
  | "BEGINNING_DEBT_BASIS_NEGATIVE"
  | "DEBT_BASIS_EXCEEDS_PRINCIPAL"
  | "FISCAL_YEAR_OUT_OF_RANGE"
  | "PRIOR_YEAR_NOT_CARRIED"
  | "AAA_OPENING_NOT_ZERO_IN_FIRST_YEAR";

export const ALL_BASIS_REFUSAL_CODES: readonly BasisRefusalCode[] = [
  "NOT_INTEGER_CENTS",
  "NEGATIVE_INPUT",
  "NO_SHAREHOLDERS",
  "DUPLICATE_SHAREHOLDER",
  "OWNERSHIP_NOT_100_PCT",
  "UNKNOWN_SHAREHOLDER_IN_DISTRIBUTIONS",
  "EARNINGS_AND_PROFITS_UNKNOWN",
  "HAS_ACCUMULATED_EARNINGS_AND_PROFITS",
  "ELECTIVE_ORDERING_UNKNOWN",
  "BEGINNING_BASIS_NEGATIVE",
  "BEGINNING_DEBT_BASIS_NEGATIVE",
  "DEBT_BASIS_EXCEEDS_PRINCIPAL",
  "FISCAL_YEAR_OUT_OF_RANGE",
  "PRIOR_YEAR_NOT_CARRIED",
  "AAA_OPENING_NOT_ZERO_IN_FIRST_YEAR",
] as const;

/** Same shape as a statement refusal, narrowed to this slice's codes. */
export type BasisRefusal = Omit<StatementRefusal, "code"> & { code: BasisRefusalCode };

/** The S election takes effect for Greenway in this year. \u00a71.1368-2(a)(1). */
export const FIRST_S_CORP_YEAR = 2026;
export const LAST_SUPPORTED_YEAR = 2100;

// ---------------------------------------------------------------------------
// 2) INPUTS
// ---------------------------------------------------------------------------

export type ShareholderYearInput = {
  shareholderName: string;
  /** 85% is 85_000. Integer milli-percent so three shareholders can sum exactly. */
  ownershipMilliPercent: number;
  /** Stock basis carried in from last year. Never negative (\u00a71367(a)(2) floor). */
  beginningStockBasisCents: number;
  /**
   * Debt basis carried in. Only real loans FROM the shareholder TO the company.
   * A personal guarantee of a bank loan is NOT debt basis.
   */
  beginningDebtBasisCents: number;
  /**
   * Face principal still outstanding at year end, per \u00a71.1367-2(c)(1)'s cap:
   * restored debt basis may never exceed it.
   */
  debtPrincipalCents: number;
  /** Losses suspended by \u00a71366(d)(1) in prior years, waiting for basis. */
  suspendedLossCarryforwardCents: number;
  /** Capital this shareholder put in during the year. Increases basis directly. */
  contributionsCents: number;
  /** Cash actually distributed to this person. NOT assumed pro-rata (rule 7). */
  distributionsCents: number;
};

export type BasisYearInput = {
  entityCode: string;
  fiscalYear: number;
  /**
   * Entity-level ordinary income allocated pro rata. \u00a71366(a).
   * May be negative; a negative value is the year's loss.
   */
  ordinaryIncomeCents: number;
  /**
   * Tax-exempt income. Increases stock basis (\u00a71367(a)(1)) but NOT the AAA
   * (\u00a71368(e)(1)(A) excludes it), which is precisely why they are separate.
   */
  taxExemptIncomeCents: number;
  /**
   * Expenses for which NO deduction is allowable \u2014 the \u00a7280E disallowance,
   * as defined by \u00a71.1367-1(c)(2). Positive number. Must NOT include anything
   * merely deferred to a later year.
   */
  nonDeductibleExpenseCents: number;
  shareholders: readonly ShareholderYearInput[];
  /**
   * Does the corporation have accumulated E&P from a C year?
   *
   * `null` means UNKNOWN and the engine refuses. Michael has stated Greenway
   * has none \u2014 it has never been a C corporation and has had no ownership
   * changes since formation \u2014 so callers pass `false`. It stays a required
   * input rather than a hardcoded assumption because the day it changes, the
   * whole \u00a71368(c) apparatus switches on and silence would be dangerous.
   */
  hasAccumulatedEarningsAndProfits: boolean | null;
  /**
   * Has a \u00a71.1367-1(g) elective-ordering statement been attached to a filed
   * return? `null` means UNKNOWN and the engine refuses. This is a fact about
   * a piece of paper and will not be guessed (standing rule 1).
   */
  electiveOrderingAdopted: boolean | null;
  /** AAA brought forward. Must be exactly 0 in the first S year. */
  beginningAaaCents: number;
  /** Other Adjustments Account brought forward \u2014 tax-exempt income lives here. */
  beginningOaaCents: number;
  /**
   * Were these opening balances produced by `carryForward` from the prior
   * year's computed result?
   *
   * `null` means UNKNOWN and the engine refuses. For any year after the first,
   * the opening balances are not free-standing facts \u2014 they are last year's
   * closing balances, and the only way to know they are right is to know where
   * they came from. Typing them in by hand is how a chain silently breaks:
   * every individual year still foots, so nothing looks wrong.
   *
   * The first S year is exempt, because there is no prior year to carry from.
   */
  openingBalancesCarriedFromPriorYear: boolean | null;
};

// ---------------------------------------------------------------------------
// 3) OUTPUTS
// ---------------------------------------------------------------------------

/** One shareholder's stock-basis schedule, step by step in \u00a71.1367-1(f) order. */
export type StockBasisSchedule = {
  shareholderName: string;
  ownershipMilliPercent: number;
  /** Step 0. */
  beginningStockBasisCents: number;
  /** Capital contributed. \u00a71012 / \u00a7358 \u2014 not part of the (f) sequence. */
  contributionsCents: number;
  /** Step (f)(1): income increases basis first. */
  allocatedOrdinaryIncomeCents: number;
  allocatedTaxExemptIncomeCents: number;
  basisAfterIncreasesCents: number;
  /** Step (f)(2): distributions, before expenses and losses. */
  distributionsCents: number;
  distributionAppliedAgainstBasisCents: number;
  /** \u00a71368(b)(2): the part above basis is a capital gain. */
  capitalGainOnExcessDistributionCents: number;
  basisAfterDistributionsCents: number;
  /** Step (f)(3): the \u00a7280E damage. */
  nonDeductibleExpenseCents: number;
  nonDeductibleExpenseAppliedToStockCents: number;
  basisAfterNonDeductibleCents: number;
  /** Step (f)(4): losses last. */
  lossAvailableCents: number;
  lossAllowedAgainstStockCents: number;
  lossAllowedAgainstDebtCents: number;
  /** \u00a71366(d)(2)(A): what could not be used, carried forward indefinitely. */
  suspendedLossCarryforwardCents: number;
  endingStockBasisCents: number;
  /** Debt basis, which absorbs only after stock basis is spent. \u00a71.1367-2(b)(1). */
  beginningDebtBasisCents: number;
  debtBasisRestoredCents: number;
  debtBasisReducedCents: number;
  endingDebtBasisCents: number;
};

export type AaaSchedule = {
  beginningAaaCents: number;
  /** (a)(5)(i) increases first. Tax-exempt income is excluded by \u00a71368(e)(1)(A). */
  increasesCents: number;
  /** (a)(5)(ii) expenses and losses, excluding any net negative adjustment. */
  nonDeductibleAndLossCents: number;
  aaaBeforeDistributionsCents: number;
  /** (a)(5)(iii) distributions, but not below zero. */
  distributionsAppliedToAaaCents: number;
  /** (a)(5)(iv) a net loss year is applied LAST, after distributions. */
  netNegativeAdjustmentCents: number;
  endingAaaCents: number;
  /** OAA: tax-exempt income and its related expenses. Never mixed into AAA. */
  beginningOaaCents: number;
  endingOaaCents: number;
};

/**
 * The one-class-of-stock observation.
 *
 * Deliberately NOT a refusal and deliberately NOT silence. See
 * \u00a71.1361-1(l)(2)(i): unequal distributions do not by themselves create a
 * second class of stock, because the test is about the RIGHTS in the governing
 * documents. But the same paragraph's last sentence says unequal distributions
 * "are to be given appropriate tax effect." So the honest output is a
 * quantified observation plus the question only Michael's documents can answer.
 */
export type ProportionalityFinding = {
  isStrictlyProportionate: boolean;
  totalDistributionsCents: number;
  /** Per shareholder: what pro rata would have been, and what was actually paid. */
  byShareholder: readonly {
    shareholderName: string;
    ownershipMilliPercent: number;
    proRataShareCents: number;
    actuallyPaidCents: number;
    varianceCents: number;
  }[];
  /** Plain-English statement of what this does and does not mean. */
  explanation: string;
  /** What Michael has to go and check. Empty when strictly proportionate. */
  whatToVerify: string;
  authorityIds: readonly string[];
};

export type BasisAaaResult =
  | { ok: false; refusals: readonly BasisRefusal[] }
  | {
      ok: true;
      entityCode: string;
      fiscalYear: number;
      shareholders: readonly StockBasisSchedule[];
      aaa: AaaSchedule;
      proportionality: ProportionalityFinding;
    };

// ---------------------------------------------------------------------------
// 4) VALIDATION \u2014 one place, so every caller is guarded identically
// ---------------------------------------------------------------------------

/**
 * Everything that must be true before any arithmetic is attempted.
 *
 * Returns ALL problems rather than the first, because sending Michael back
 * three times for three facts is three times the interruption.
 */
export function validateBasisInput(input: BasisYearInput): readonly BasisRefusal[] {
  const refusals: BasisRefusal[] = [];

  if (
    !Number.isInteger(input.fiscalYear) ||
    input.fiscalYear < FIRST_S_CORP_YEAR ||
    input.fiscalYear > LAST_SUPPORTED_YEAR
  ) {
    refusals.push({
      code: "FISCAL_YEAR_OUT_OF_RANGE",
      message:
        `The fiscal year given was ${String(input.fiscalYear)}. This engine only computes basis ` +
        `for ${FIRST_S_CORP_YEAR} through ${LAST_SUPPORTED_YEAR}.`,
      whatToDo:
        `Greenway's S election runs from ${FIRST_S_CORP_YEAR}. There is no basis schedule before ` +
        `that because there was no S corporation. Check the year you passed in.`,
      authorityIds: ["REG_1_1368_2_A_1_AAA_NOT_APPORTIONED"],
    });
  }

  const cents: Array<[number, string]> = [
    [input.ordinaryIncomeCents, "ordinaryIncomeCents"],
    [input.taxExemptIncomeCents, "taxExemptIncomeCents"],
    [input.nonDeductibleExpenseCents, "nonDeductibleExpenseCents"],
    [input.beginningAaaCents, "beginningAaaCents"],
    [input.beginningOaaCents, "beginningOaaCents"],
  ];
  for (const [v, label] of cents) {
    if (!Number.isInteger(v)) {
      refusals.push({
        code: "NOT_INTEGER_CENTS",
        message: `${label} is ${String(v)}, which is not a whole number of cents.`,
        whatToDo:
          "Money in this system is integer cents. A fraction means a float got in upstream; " +
          "find where the division happened rather than rounding it here.",
        authorityIds: [],
      });
    }
  }

  if (input.nonDeductibleExpenseCents < 0) {
    refusals.push({
      code: "NEGATIVE_INPUT",
      message:
        `nonDeductibleExpenseCents is ${input.nonDeductibleExpenseCents}. Disallowed expenses are ` +
        `supplied as a positive number and subtracted by the engine.`,
      whatToDo:
        "Pass the magnitude of the \u00a7280E disallowance, not a negative. A negative here would " +
        "silently INCREASE basis, which is the opposite of what \u00a71367(a)(2)(D) requires.",
      authorityIds: ["REG_1_1367_1_C_2_NONCAPITAL_NONDEDUCTIBLE"],
    });
  }

  if (input.taxExemptIncomeCents < 0) {
    refusals.push({
      code: "NEGATIVE_INPUT",
      message: `taxExemptIncomeCents is ${input.taxExemptIncomeCents}, which cannot be negative.`,
      whatToDo: "Tax-exempt income is an increase or it is zero. Check the source figure.",
      authorityIds: ["IRC_1367_STOCK_BASIS_ADJUSTMENTS"],
    });
  }

  if (input.hasAccumulatedEarningsAndProfits === null) {
    refusals.push({
      code: "EARNINGS_AND_PROFITS_UNKNOWN",
      message:
        "Whether the company has accumulated earnings and profits from a C-corporation year is " +
        "unknown, so the distribution rules cannot be chosen.",
      whatToDo:
        "With no E&P, \u00a71368(b) applies and distributions are tested against stock basis alone. " +
        "With E&P, \u00a71368(c) applies and part of a distribution can be a taxable dividend even " +
        "when you have plenty of basis. These give different answers, so the fact is required.",
      authorityIds: ["IRC_1368_DISTRIBUTIONS_AAA"],
    });
  } else if (input.hasAccumulatedEarningsAndProfits) {
    refusals.push({
      code: "HAS_ACCUMULATED_EARNINGS_AND_PROFITS",
      message:
        "This company is recorded as having accumulated earnings and profits from a C year. " +
        "That puts distributions under \u00a71368(c), which this engine does not implement.",
      whatToDo:
        "Greenway was recorded as having no E&P \u2014 it has never been a C corporation. If that has " +
        "changed, the \u00a71368(c) ordering (AAA, then dividend from E&P, then basis, then gain) has " +
        "to be built before any distribution here can be trusted. Do not override this.",
      authorityIds: ["IRC_1368_DISTRIBUTIONS_AAA"],
    });
  }

  if (input.electiveOrderingAdopted === null) {
    refusals.push({
      code: "ELECTIVE_ORDERING_UNKNOWN",
      message:
        "It is not recorded whether a \u00a71.1367-1(g) elective ordering statement was ever attached " +
        "to a filed return.",
      whatToDo:
        "Look at the S-corporation returns already filed. If any of them carries a statement " +
        "electing to take losses before nondeductible expenses, the answer is yes and it stays " +
        "yes until the IRS permits a change. If none does, the answer is no.",
      authorityIds: ["REG_1_1367_1_G_ELECTIVE_ORDERING"],
    });
  }

  if (
    input.fiscalYear === FIRST_S_CORP_YEAR &&
    Number.isInteger(input.beginningAaaCents) &&
    input.beginningAaaCents !== 0
  ) {
    refusals.push({
      code: "AAA_OPENING_NOT_ZERO_IN_FIRST_YEAR",
      message:
        `The opening AAA for ${FIRST_S_CORP_YEAR} was given as ${input.beginningAaaCents} cents, ` +
        `but the first S year must open at exactly zero.`,
      whatToDo:
        "\u00a71.1368-2(a)(1) is explicit: on the first day of the first S year the AAA balance is " +
        "zero. A non-zero opening means a prior-year balance was carried in from a year that was " +
        "not an S year. Find where that number came from.",
      authorityIds: ["REG_1_1368_2_A_1_AAA_NOT_APPORTIONED"],
    });
  }

  if (
    Number.isInteger(input.fiscalYear) &&
    input.fiscalYear > FIRST_S_CORP_YEAR &&
    input.openingBalancesCarriedFromPriorYear !== true
  ) {
    refusals.push({
      code: "PRIOR_YEAR_NOT_CARRIED",
      message:
        input.openingBalancesCarriedFromPriorYear === null
          ? `It is not recorded whether the opening balances for ${input.fiscalYear} came from ` +
            `the ${input.fiscalYear - 1} computation, so they cannot be relied on.`
          : `The opening balances for ${input.fiscalYear} were entered directly rather than ` +
            `carried from the ${input.fiscalYear - 1} computation.`,
      whatToDo:
        `Basis is a chain: ${input.fiscalYear}'s opening balances ARE ${input.fiscalYear - 1}'s ` +
        `closing balances, including each person's suspended losses under \u00a71366(d)(2)(A) and ` +
        `their debt basis. Run ${input.fiscalYear - 1} first, pass its result through ` +
        `carryForward, and use what that returns. If ${input.fiscalYear - 1} was never computed ` +
        `here, compute it \u2014 do not retype figures off the return, because a hand-typed opening ` +
        `balance produces a year that adds up perfectly and is still wrong.`,
      authorityIds: ["IRC_1366_D_2_CARRYOVER", "REG_1_1367_2_C_1_DEBT_RESTORATION"],
    });
  }

  refusals.push(...validateShareholders(input.shareholders));
  return refusals;
}

/** Split out so the shareholder rules can be tested against bad input directly. */
export function validateShareholders(
  shareholders: readonly ShareholderYearInput[],
): readonly BasisRefusal[] {
  const refusals: BasisRefusal[] = [];

  if (shareholders.length === 0) {
    refusals.push({
      code: "NO_SHAREHOLDERS",
      message: "No shareholders were supplied, so there is nobody to compute basis for.",
      whatToDo:
        "An S corporation has at least one shareholder by definition. Supply the roster: for " +
        "Greenway that is Michael at 85%, his mother at 10%, and Nicholas Mullan at 5%.",
      authorityIds: ["IRC_1361_B_1_D_ONE_CLASS"],
    });
    return refusals;
  }

  const seen = new Set<string>();
  for (const sh of shareholders) {
    const key = sh.shareholderName.trim().toLowerCase();
    if (key.length === 0) {
      refusals.push({
        code: "DUPLICATE_SHAREHOLDER",
        message: "A shareholder was supplied with a blank name.",
        whatToDo:
          "Basis is tracked per person and a blank name cannot be told apart from another blank " +
          "name. Give every shareholder their actual name.",
        authorityIds: ["IRC_1366_D_LOSS_LIMITATION"],
      });
      continue;
    }
    if (seen.has(key)) {
      refusals.push({
        code: "DUPLICATE_SHAREHOLDER",
        message: `"${sh.shareholderName}" appears more than once in the shareholder list.`,
        whatToDo:
          "Combine the two rows into one. Two rows for one person splits their basis in half and " +
          "each half will hit the \u00a71366(d)(1) ceiling early, understating the losses they may " +
          "deduct.",
        authorityIds: ["IRC_1366_D_LOSS_LIMITATION"],
      });
    }
    seen.add(key);

    if (sh.beginningStockBasisCents < 0) {
      refusals.push({
        code: "BEGINNING_BASIS_NEGATIVE",
        message:
          `${sh.shareholderName} has a beginning stock basis of ${sh.beginningStockBasisCents} ` +
          `cents. Stock basis cannot be negative.`,
        whatToDo:
          "\u00a71367(a)(2) says basis is reduced \"but not below zero\". A negative carry-in means last " +
          "year's schedule let it go below zero \u2014 fix the prior year rather than starting this " +
          "one from an impossible number.",
        authorityIds: ["IRC_1367_STOCK_BASIS_ADJUSTMENTS"],
      });
    }
    if (sh.beginningDebtBasisCents < 0) {
      refusals.push({
        code: "BEGINNING_DEBT_BASIS_NEGATIVE",
        message:
          `${sh.shareholderName} has a beginning debt basis of ${sh.beginningDebtBasisCents} cents.`,
        whatToDo:
          "\u00a71.1367-2(b)(1) reduces debt basis \"but not below zero\" as well. Correct the prior year.",
        authorityIds: ["REG_1_1367_2_B_1_DEBT_REDUCTION"],
      });
    }
    if (sh.beginningDebtBasisCents > sh.debtPrincipalCents) {
      refusals.push({
        code: "DEBT_BASIS_EXCEEDS_PRINCIPAL",
        message:
          `${sh.shareholderName} has debt basis of ${sh.beginningDebtBasisCents} cents against ` +
          `principal of ${sh.debtPrincipalCents} cents.`,
        whatToDo:
          "Debt basis can never exceed what was actually loaned \u2014 \u00a71.1367-2(c)(1) caps restoration " +
          "at the adjusted basis of the debt. Either the loan balance is understated or the debt " +
          "basis is overstated. Find the note.",
        authorityIds: ["REG_1_1367_2_C_1_DEBT_RESTORATION"],
      });
    }
    if (sh.suspendedLossCarryforwardCents < 0) {
      refusals.push({
        code: "NEGATIVE_INPUT",
        message:
          `${sh.shareholderName} has a suspended loss carryforward of ` +
          `${sh.suspendedLossCarryforwardCents} cents, which is not a meaningful figure.`,
        whatToDo:
          "A suspended loss is a positive amount waiting to be used, or zero. Check last year's " +
          "schedule.",
        authorityIds: ["IRC_1366_D_2_CARRYOVER"],
      });
    }
    if (sh.distributionsCents < 0) {
      refusals.push({
        code: "NEGATIVE_INPUT",
        message:
          `${sh.shareholderName} has distributions of ${sh.distributionsCents} cents. A negative ` +
          `distribution is a contribution and belongs in contributionsCents.`,
        whatToDo:
          "Money going OUT to a shareholder is a distribution; money coming IN is a contribution. " +
          "They adjust basis at different points in the \u00a71.1367-1(f) sequence, so they cannot be " +
          "netted against each other.",
        authorityIds: ["REG_1_1367_1_F_ORDERING"],
      });
    }
    if (sh.contributionsCents < 0) {
      refusals.push({
        code: "NEGATIVE_INPUT",
        message: `${sh.shareholderName} has contributions of ${sh.contributionsCents} cents.`,
        whatToDo: "A negative contribution is a distribution. Put it in the right field.",
        authorityIds: ["REG_1_1367_1_F_ORDERING"],
      });
    }
    if (!Number.isInteger(sh.ownershipMilliPercent) || sh.ownershipMilliPercent <= 0) {
      refusals.push({
        code: "OWNERSHIP_NOT_100_PCT",
        message:
          `${sh.shareholderName} has an ownership of ${String(sh.ownershipMilliPercent)} ` +
          `milli-percent, which is not a positive whole number.`,
        whatToDo:
          "Ownership is whole milli-percent: 85% is 85000. A shareholder owning nothing is not a " +
          "shareholder.",
        authorityIds: ["IRC_1361_B_1_D_ONE_CLASS"],
      });
    }
  }

  const total = shareholders.reduce((s, sh) => s + sh.ownershipMilliPercent, 0);
  if (total !== 100_000) {
    refusals.push({
      code: "OWNERSHIP_NOT_100_PCT",
      message:
        `Ownership totals ${total} milli-percent, not 100000 (100%). It is off by ` +
        `${Math.abs(100_000 - total)} milli-percent.`,
      whatToDo:
        "Every share of an S corporation is owned by somebody, and income is allocated strictly " +
        "pro rata. If the percentages do not total 100 the allocation is wrong for everyone. For " +
        "Greenway the roster is 85000 + 10000 + 5000.",
      authorityIds: ["IRC_1366_D_LOSS_LIMITATION"],
    });
  }

  return refusals;
}

// ---------------------------------------------------------------------------
// 5) ALLOCATION \u2014 pro rata, to the cent, with the remainder placed honestly
// ---------------------------------------------------------------------------

/**
 * Fault injection switch for the allocation guard, and nothing else.
 *
 * The guard at the end of `allocateProRata` can only fire if the allocator
 * immediately above it is already broken, which means no ordinary input can
 * ever reach it. That left the guard untested \u2014 a mutation harness deleted it
 * outright and the whole suite stayed green. A safety net nobody has ever seen
 * catch anything is not known to be a safety net.
 *
 * Standing rule 16 says prove the gate is wired, so the gate is given a way to
 * be provoked deliberately. This is exported ONLY so the test suite can flip it
 * and watch the refusal happen. It is false in every real code path.
 */
export let injectAllocationFaultForTesting = false;

/** Flip the allocation fault switch. Test-only; always restore in a `finally`. */
export function setAllocationFaultForTesting(on: boolean): void {
  injectAllocationFaultForTesting = on;
}

/**
 * Split an amount by ownership so the parts sum EXACTLY to the whole.
 *
 * Naive rounding of three percentages loses or invents cents, and a cent that
 * appears from nowhere is a silent plug (standing rule 12). This uses the
 * largest-remainder method: floor everyone, then hand the leftover cents out
 * one at a time to the largest fractional remainders, ties broken by the
 * larger holding and then by name so the result is deterministic.
 *
 * Works for negative totals too \u2014 a loss year \u2014 by allocating the magnitude
 * and flipping the signs back, so a loss splits the same way a profit does.
 */
export function allocateProRata(
  totalCents: number,
  shareholders: readonly { shareholderName: string; ownershipMilliPercent: number }[],
): ReadonlyMap<string, number> {
  assertBasisCents(totalCents, "amount to allocate");
  const out = new Map<string, number>();
  if (shareholders.length === 0) return out;

  const sign = totalCents < 0 ? -1 : 1;
  const magnitude = Math.abs(totalCents);
  const totalMilli = shareholders.reduce((s, sh) => s + sh.ownershipMilliPercent, 0);
  if (totalMilli <= 0) {
    for (const sh of shareholders) out.set(sh.shareholderName, 0);
    return out;
  }

  const rows = shareholders.map((sh) => {
    const exact = magnitude * sh.ownershipMilliPercent;
    return {
      name: sh.shareholderName,
      milli: sh.ownershipMilliPercent,
      floor: Math.floor(exact / totalMilli),
      remainder: exact % totalMilli,
    };
  });

  let placed = rows.reduce((s, r) => s + r.floor, 0);
  const leftover = magnitude - placed;

  const order = [...rows].sort(
    (a, b) => b.remainder - a.remainder || b.milli - a.milli || a.name.localeCompare(b.name),
  );
  for (let i = 0; i < leftover; i += 1) {
    order[i % order.length].floor += 1;
  }

  placed = 0;
  for (const r of rows) {
    out.set(r.name, sign * r.floor);
    placed += r.floor;
  }
  if (placed !== magnitude || injectAllocationFaultForTesting) {
    throw new Error(
      `ALLOCATION LOST MONEY: distributed ${placed} of ${magnitude} cents. This is a bug in ` +
        `allocateProRata, not in the data, and it must never be papered over.`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// 6) THE STOCK AND DEBT BASIS SEQUENCE \u2014 \u00a71.1367-1(f), in order
// ---------------------------------------------------------------------------

/**
 * One shareholder's year.
 *
 * The four steps below are numbered to match \u00a71.1367-1(f) exactly. Do not
 * reorder them for convenience; the order IS the rule.
 */
export function computeStockBasisSchedule(args: {
  shareholder: ShareholderYearInput;
  allocatedOrdinaryIncomeCents: number;
  allocatedTaxExemptIncomeCents: number;
  allocatedNonDeductibleCents: number;
}): StockBasisSchedule {
  const sh = args.shareholder;
  const income = args.allocatedOrdinaryIncomeCents;
  const exempt = args.allocatedTaxExemptIncomeCents;
  const nonDeductible = args.allocatedNonDeductibleCents;

  assertBasisCents(income, `allocated ordinary income for ${sh.shareholderName}`);
  assertBasisCents(exempt, `allocated tax-exempt income for ${sh.shareholderName}`);
  assertBasisCents(nonDeductible, `allocated nondeductible expense for ${sh.shareholderName}`);

  // A negative allocation of ordinary income IS this year's loss. It is not an
  // increase, so it must not be added in step (f)(1); it joins the loss pool
  // handled at step (f)(4).
  const currentYearLoss = income < 0 ? -income : 0;
  const currentYearIncome = income > 0 ? income : 0;

  // --- Step (f)(1): increases -------------------------------------------
  // Contributions are not part of the (f) sequence at all; they are basis
  // under \u00a71012 from the moment they are paid in, so they sit at the front.
  const basisAfterIncreases =
    sh.beginningStockBasisCents + sh.contributionsCents + currentYearIncome + exempt;

  // --- Step (f)(2): distributions, BEFORE expenses and losses ------------
  // \u00a71368(b)(1): tax-free to the extent of basis.
  // \u00a71368(b)(2): the excess is gain from the sale or exchange of property.
  const distributionApplied = Math.min(sh.distributionsCents, Math.max(0, basisAfterIncreases));
  const capitalGain = Math.max(0, sh.distributionsCents - Math.max(0, basisAfterIncreases));
  const basisAfterDistributions = basisAfterIncreases - distributionApplied;

  // --- Step (f)(3): noncapital, nondeductible expenses -------------------
  // This is where \u00a7280E lands. Floor at zero per \u00a71367(a)(2).
  const nonDeductibleToStock = Math.min(nonDeductible, basisAfterDistributions);
  const basisAfterNonDeductible = basisAfterDistributions - nonDeductibleToStock;

  // Anything left over spills to debt basis. \u00a71.1367-2(b)(1) lists (B),(C),(D),
  // and (E) \u2014 note (A), distributions, is absent, which is why the excess
  // distribution above became a capital gain instead of eating the loan.
  const nonDeductibleSpill = nonDeductible - nonDeductibleToStock;

  // --- Step (f)(4): losses, last ----------------------------------------
  const lossAvailable = currentYearLoss + sh.suspendedLossCarryforwardCents;

  // Debt basis first heals (\u00a71.1367-2(c)(1)) only in a NET INCREASE year. A
  // year with a loss to absorb is not one, so restoration is computed against
  // the net increase actually present.
  const netIncrease = Math.max(
    0,
    currentYearIncome + exempt - nonDeductible - currentYearLoss - sh.distributionsCents,
  );
  const roomToRestore = Math.max(0, sh.debtPrincipalCents - sh.beginningDebtBasisCents);
  const debtRestored = Math.min(netIncrease, roomToRestore);

  const debtBasisAvailable = sh.beginningDebtBasisCents + debtRestored;
  const debtAfterSpill = Math.max(0, debtBasisAvailable - nonDeductibleSpill);
  const spillTakenFromDebt = debtBasisAvailable - debtAfterSpill;

  const lossAgainstStock = Math.min(lossAvailable, basisAfterNonDeductible);
  const lossRemaining = lossAvailable - lossAgainstStock;
  const lossAgainstDebt = Math.min(lossRemaining, debtAfterSpill);

  // \u00a71366(d)(2)(A): whatever is left is suspended, indefinitely, for THIS
  // shareholder. It is not lost and it does not belong to anyone else.
  const suspended = lossRemaining - lossAgainstDebt;

  return {
    shareholderName: sh.shareholderName,
    ownershipMilliPercent: sh.ownershipMilliPercent,
    beginningStockBasisCents: sh.beginningStockBasisCents,
    contributionsCents: sh.contributionsCents,
    allocatedOrdinaryIncomeCents: currentYearIncome,
    allocatedTaxExemptIncomeCents: exempt,
    basisAfterIncreasesCents: basisAfterIncreases,
    distributionsCents: sh.distributionsCents,
    distributionAppliedAgainstBasisCents: distributionApplied,
    capitalGainOnExcessDistributionCents: capitalGain,
    basisAfterDistributionsCents: basisAfterDistributions,
    nonDeductibleExpenseCents: nonDeductible,
    nonDeductibleExpenseAppliedToStockCents: nonDeductibleToStock,
    basisAfterNonDeductibleCents: basisAfterNonDeductible,
    lossAvailableCents: lossAvailable,
    lossAllowedAgainstStockCents: lossAgainstStock,
    lossAllowedAgainstDebtCents: lossAgainstDebt,
    suspendedLossCarryforwardCents: suspended,
    endingStockBasisCents: basisAfterNonDeductible - lossAgainstStock,
    beginningDebtBasisCents: sh.beginningDebtBasisCents,
    debtBasisRestoredCents: debtRestored,
    debtBasisReducedCents: spillTakenFromDebt + lossAgainstDebt,
    endingDebtBasisCents: debtAfterSpill - lossAgainstDebt,
  };
}

// ---------------------------------------------------------------------------
// 7) THE AAA SEQUENCE \u2014 \u00a71.1368-2(a)(5), a DIFFERENT order
// ---------------------------------------------------------------------------

/**
 * The corporate-level account. One account, not apportioned (\u00a71.1368-2(a)(1)).
 *
 * Note carefully how this differs from the basis sequence above:
 *   - tax-exempt income does NOT increase AAA (\u00a71368(e)(1)(A)); it goes to OAA
 *   - losses and expenses come BEFORE distributions, not after
 *   - a net loss year is deferred to step (iv), AFTER distributions
 *   - losses may push AAA below zero; distributions may not
 */
export function computeAaaSchedule(args: {
  beginningAaaCents: number;
  beginningOaaCents: number;
  ordinaryIncomeCents: number;
  taxExemptIncomeCents: number;
  nonDeductibleExpenseCents: number;
  totalDistributionsCents: number;
}): AaaSchedule {
  assertBasisCents(args.beginningAaaCents, "beginning AAA");
  assertBasisCents(args.beginningOaaCents, "beginning OAA");
  assertBasisCents(args.totalDistributionsCents, "total distributions");

  const income = args.ordinaryIncomeCents > 0 ? args.ordinaryIncomeCents : 0;
  const loss = args.ordinaryIncomeCents < 0 ? -args.ordinaryIncomeCents : 0;

  // \u00a71368(e)(1)(C)(ii): a "net negative adjustment" is the excess of
  // reductions over increases for the year, ignoring distributions. When there
  // is one, step (a)(5)(ii) skips it and step (a)(5)(iv) applies it later.
  const increases = income;
  const reductions = loss + args.nonDeductibleExpenseCents;
  const netNegativeAdjustment = Math.max(0, reductions - increases);

  // (i) increases first
  const afterIncreases = args.beginningAaaCents + increases;

  // (ii) decreases, WITHOUT the net negative adjustment.
  //
  // Read this slowly, because the obvious reading is wrong and it costs money.
  // \u00a71.1368-2(a)(5)(ii) defers the reductions "without taking into account any
  // net negative adjustment". A net negative adjustment is NOT the whole pile
  // of reductions \u2014 \u00a71368(e)(1)(C)(ii) defines it as the EXCESS (if any) of the
  // reductions over the increases. So the part of the reductions that the
  // year's own increases can absorb is still taken here at step (ii); only the
  // excess is held back for step (iv).
  //
  // Getting this wrong is invisible whenever increases are zero (both readings
  // then give the same answer), which is exactly why it survived the first
  // draft. It shows up the moment a year has income AND disallowed expense \u2014
  // in other words, every single \u00a7280E year Greenway will ever have.
  const decreasesNow = reductions - netNegativeAdjustment;
  const beforeDistributions = afterIncreases - decreasesNow;

  // (iii) distributions, but NOT below zero \u2014 \u00a71.1368-2(a)(3)(iii)
  const distributionsApplied = Math.min(
    args.totalDistributionsCents,
    Math.max(0, beforeDistributions),
  );
  const afterDistributions = beforeDistributions - distributionsApplied;

  // (iv) and now the net negative adjustment, which MAY go below zero
  const ending = afterDistributions - netNegativeAdjustment;

  return {
    beginningAaaCents: args.beginningAaaCents,
    increasesCents: increases,
    nonDeductibleAndLossCents: decreasesNow,
    aaaBeforeDistributionsCents: beforeDistributions,
    distributionsAppliedToAaaCents: distributionsApplied,
    netNegativeAdjustmentCents: netNegativeAdjustment,
    endingAaaCents: ending,
    beginningOaaCents: args.beginningOaaCents,
    // Tax-exempt income lives in OAA and never touches AAA.
    endingOaaCents: args.beginningOaaCents + args.taxExemptIncomeCents,
  };
}

// ---------------------------------------------------------------------------
// 8) THE ONE-CLASS-OF-STOCK OBSERVATION \u2014 surfaced, accurately
// ---------------------------------------------------------------------------

/**
 * Compare what was paid to what pro rata would have been.
 *
 * This deliberately does NOT refuse. \u00a71.1361-1(l)(1) makes the test turn on the
 * RIGHTS conferred by the governing documents, and the regulation's own
 * Example 2 has two equal shareholders paid a year apart and still finds one
 * class of stock. Refusing would be as wrong as staying silent \u2014 and standing
 * rule 27 says refuse only where the law actually forbids, not where it raises
 * a question.
 */
export function assessProportionality(
  shareholders: readonly StockBasisSchedule[],
): ProportionalityFinding {
  const total = shareholders.reduce((s, sh) => s + sh.distributionsCents, 0);
  const proRata = allocateProRata(total, shareholders);

  const byShareholder = shareholders.map((sh) => {
    const expected = proRata.get(sh.shareholderName) ?? 0;
    return {
      shareholderName: sh.shareholderName,
      ownershipMilliPercent: sh.ownershipMilliPercent,
      proRataShareCents: expected,
      actuallyPaidCents: sh.distributionsCents,
      varianceCents: sh.distributionsCents - expected,
    };
  });

  const isProportionate = byShareholder.every((r) => r.varianceCents === 0);

  if (isProportionate) {
    return {
      isStrictlyProportionate: true,
      totalDistributionsCents: total,
      byShareholder,
      explanation:
        total === 0
          ? "No distributions were paid this year, so no proportionality question arises."
          : "Every shareholder received exactly their ownership share of the distributions, so " +
            "there is nothing here that could be argued to create a second class of stock.",
      whatToVerify: "",
      authorityIds: [
        "IRC_1361_B_1_D_ONE_CLASS",
        "REG_1_1361_1_L_1_IDENTICAL_RIGHTS",
        "REG_1_1361_1_L_2_I_GOVERNING_PROVISIONS",
      ],
    };
  }

  const overpaid = byShareholder
    .filter((r) => r.varianceCents > 0)
    .map((r) => `${r.shareholderName} received ${formatCents(r.varianceCents)} more than pro rata`);
  const underpaid = byShareholder
    .filter((r) => r.varianceCents < 0)
    .map(
      (r) => `${r.shareholderName} received ${formatCents(-r.varianceCents)} less than pro rata`,
    );

  return {
    isStrictlyProportionate: false,
    totalDistributionsCents: total,
    byShareholder,
    explanation:
      "Distributions this year were NOT in proportion to ownership: " +
      [...overpaid, ...underpaid].join("; ") +
      ". This is not, by itself, a second class of stock. The test in \u00a71.1361-1(l)(1) is whether " +
      "all shares confer IDENTICAL RIGHTS to distributions and liquidation proceeds, and that is " +
      "answered by the charter, the bylaws, state law, and any binding agreement about " +
      "distributions \u2014 not by what the cheques happened to be. The regulation's own example has " +
      "one shareholder paid a full year before another and still finds a single class of stock. " +
      "But the last sentence of \u00a71.1361-1(l)(2)(i) does not let it go entirely: distributions " +
      "that differ in amount \"are to be given appropriate tax effect in accordance with the facts " +
      "and circumstances\", which means the gap has to be characterised as something \u2014 a loan " +
      "from the company, additional compensation, or a gift between the shareholders.",
    whatToVerify:
      "Two things, and they are separate questions. FIRST, confirm the governing documents give " +
      "every share identical distribution and liquidation rights; if they do, the S election is " +
      "not in danger from this. SECOND, decide what the unequal amounts actually were. If the " +
      "intention is that the underpaid shareholder is simply owed money later, that is a payable " +
      "and should be on the books as one. If it is compensation it belongs on a W-2. Leaving it " +
      "uncharacterised is the only genuinely bad option.",
    authorityIds: [
      "IRC_1361_B_1_D_ONE_CLASS",
      "REG_1_1361_1_L_1_IDENTICAL_RIGHTS",
      "REG_1_1361_1_L_2_I_GOVERNING_PROVISIONS",
    ],
  };
}

/** Cents to a readable dollar string. Used only in prose, never in arithmetic. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const rest = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${rest}`;
}

// ---------------------------------------------------------------------------
// 9) THE WHOLE YEAR
// ---------------------------------------------------------------------------

/**
 * Validate, allocate, and run both sequences for one fiscal year.
 *
 * Refuses with every problem at once rather than the first one found.
 */
export function computeBasisAndAaa(input: BasisYearInput): BasisAaaResult {
  const refusals = validateBasisInput(input);
  if (refusals.length > 0) return { ok: false, refusals };

  const roster = input.shareholders.map((sh) => ({
    shareholderName: sh.shareholderName,
    ownershipMilliPercent: sh.ownershipMilliPercent,
  }));

  const incomeByName = allocateProRata(input.ordinaryIncomeCents, roster);
  const exemptByName = allocateProRata(input.taxExemptIncomeCents, roster);
  const nonDeductibleByName = allocateProRata(input.nonDeductibleExpenseCents, roster);

  const schedules = input.shareholders.map((sh) =>
    computeStockBasisSchedule({
      shareholder: sh,
      allocatedOrdinaryIncomeCents: incomeByName.get(sh.shareholderName) ?? 0,
      allocatedTaxExemptIncomeCents: exemptByName.get(sh.shareholderName) ?? 0,
      allocatedNonDeductibleCents: nonDeductibleByName.get(sh.shareholderName) ?? 0,
    }),
  );

  const totalDistributions = input.shareholders.reduce((s, sh) => s + sh.distributionsCents, 0);

  const aaa = computeAaaSchedule({
    beginningAaaCents: input.beginningAaaCents,
    beginningOaaCents: input.beginningOaaCents,
    ordinaryIncomeCents: input.ordinaryIncomeCents,
    taxExemptIncomeCents: input.taxExemptIncomeCents,
    nonDeductibleExpenseCents: input.nonDeductibleExpenseCents,
    totalDistributionsCents: totalDistributions,
  });

  return {
    ok: true,
    entityCode: input.entityCode,
    fiscalYear: input.fiscalYear,
    shareholders: schedules,
    aaa,
    proportionality: assessProportionality(schedules),
  };
}

/**
 * Carry one year's closing balances into the next year's opening balances.
 *
 * Exists so that a multi-year schedule cannot be assembled by hand, which is
 * where continuity errors come from. \u00a71366(d)(2)(A) suspended losses and
 * \u00a71.1367-2 debt basis both have to travel, and both are easy to drop.
 */
export type CarryForwardFacts = {
  contributionsByShareholder?: Readonly<Record<string, number>>;
  distributionsByShareholder?: Readonly<Record<string, number>>;
  debtPrincipalByShareholder?: Readonly<Record<string, number>>;
};

/**
 * Check next-year facts against the roster BEFORE they are used.
 *
 * These three maps are keyed by shareholder name, and a lookup that misses
 * returns undefined, which the carry-forward would otherwise quietly turn into
 * zero. So "Micheal Lyman" instead of "Michael Lyman" would not raise anything
 * \u2014 it would simply record that Michael took no distribution, understate his
 * basis reduction, and overstate the AAA. That is a silent plug, and standing
 * rule 12 forbids silent plugs. A name that matches nobody is refused.
 */
export function validateCarryForwardFacts(
  previous: Extract<BasisAaaResult, { ok: true }>,
  nextYearFacts: CarryForwardFacts = {},
): readonly BasisRefusal[] {
  const known = new Set(previous.shareholders.map((sh) => sh.shareholderName));
  const refusals: BasisRefusal[] = [];

  const maps: readonly (readonly [string, Readonly<Record<string, number>> | undefined])[] = [
    ["contributions", nextYearFacts.contributionsByShareholder],
    ["distributions", nextYearFacts.distributionsByShareholder],
    ["debt principal", nextYearFacts.debtPrincipalByShareholder],
  ];

  for (const [label, map] of maps) {
    if (!map) continue;
    for (const name of Object.keys(map)) {
      if (known.has(name)) continue;
      refusals.push({
        code: "UNKNOWN_SHAREHOLDER_IN_DISTRIBUTIONS",
        message:
          `The ${label} for next year name "${name}", who is not a shareholder in the year ` +
          `being carried forward. The roster is: ${[...known].join(", ")}.`,
        whatToDo:
          `Either correct the spelling of "${name}" so it matches the roster exactly, or, if ` +
          `${name} genuinely became a shareholder, do not carry the year forward blindly \u2014 a ` +
          `new shareholder changes the ownership percentages, and those have to be entered for ` +
          `the new year. Names are matched exactly, including capitals and spacing, on purpose: ` +
          `a near-miss must fail loudly rather than silently record zero.`,
        authorityIds: ["IRC_1366_D_2_CARRYOVER"],
      });
    }
  }

  return refusals;
}

export function carryForward(
  previous: Extract<BasisAaaResult, { ok: true }>,
  nextYearFacts: CarryForwardFacts = {},
): Pick<
  BasisYearInput,
  | "beginningAaaCents"
  | "beginningOaaCents"
  | "shareholders"
  | "openingBalancesCarriedFromPriorYear"
> & {
  fiscalYear: number;
} {
  const refusals = validateCarryForwardFacts(previous, nextYearFacts);
  if (refusals.length > 0) {
    throw new Error(
      `CARRY FORWARD REFUSED: ${refusals.map((r) => r.message).join(" ")}`,
    );
  }

  const shareholders: ShareholderYearInput[] = previous.shareholders.map((sh) => ({
    shareholderName: sh.shareholderName,
    ownershipMilliPercent: sh.ownershipMilliPercent,
    beginningStockBasisCents: sh.endingStockBasisCents,
    beginningDebtBasisCents: sh.endingDebtBasisCents,
    debtPrincipalCents:
      nextYearFacts.debtPrincipalByShareholder?.[sh.shareholderName] ?? sh.endingDebtBasisCents,
    suspendedLossCarryforwardCents: sh.suspendedLossCarryforwardCents,
    contributionsCents: nextYearFacts.contributionsByShareholder?.[sh.shareholderName] ?? 0,
    distributionsCents: nextYearFacts.distributionsByShareholder?.[sh.shareholderName] ?? 0,
  }));

  return {
    fiscalYear: previous.fiscalYear + 1,
    beginningAaaCents: previous.aaa.endingAaaCents,
    beginningOaaCents: previous.aaa.endingOaaCents,
    shareholders,
    // This is the ONLY place this may be set to true, and it is set by the
    // machine rather than by a caller asserting it. That is what makes the
    // PRIOR_YEAR_NOT_CARRIED gate mean something.
    openingBalancesCarriedFromPriorYear: true,
  };
}
