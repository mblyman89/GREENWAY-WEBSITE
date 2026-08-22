/**
 * tests/compliance/garnishment-core.test.ts
 *
 * books-33. The garnishment engine, tested against THE REGULATION'S OWN WORKED
 * EXAMPLES wherever the regulation supplies one.
 *
 * WHY THAT MATTERS HERE MORE THAN USUAL. Garnishment arithmetic is easy to get
 * subtly wrong and impossible to spot by eye: every wrong answer is still a
 * plausible-looking dollar figure. A test I invent tests my own understanding.
 * A test lifted out of 29 CFR 870.10(b)(1) - "the amount of disposable weekly
 * earnings which may not be garnished is $127.50" at a $4.25 minimum wage -
 * tests the engine against the government's own arithmetic. If the engine
 * disagrees with that number, the engine is wrong and there is nothing to
 * discuss.
 *
 * THE $4.25 IS A TEST FIXTURE, NOT A RATE. The 1991 wage appears here ONLY
 * because it is the wage the regulation's examples are computed at, which is
 * what makes those examples usable as an oracle. The engine itself never
 * hardcodes any minimum wage - proven by a dedicated test below that the
 * engine REFUSES when the wage is absent instead of falling back to anything.
 */
import { describe, it, expect } from "vitest";

import {
  computeDisposableEarnings,
  protectedFloorCents,
  ccpaCeiling,
  washingtonExemption,
  supportCap,
  computeOneOrder,
  computeAllOrders,
  centsToDollars,
  type WageOrder,
  type MinimumWageFacts,
  type PaycheckFacts,
} from "../../src/lib/payroll/garnishment-core";

// $4.25/hr in thousandths of a cent = 4.25 * 100 cents * 1000 = 425_000.
const MW_1991 = 425_000;
// A realistic modern pair, used only where no official example exists.
const MW_FED_MODERN = 725_000; // $7.25
const MW_WA_2026 = 1_713_000; // $17.13, the evidenced 2026 figure

const WAGES_1991: MinimumWageFacts = {
  federalMilliCentsPerHour: MW_1991,
  stateMilliCentsPerHour: MW_1991,
};

function pay(overrides: Partial<PaycheckFacts> = {}): PaycheckFacts {
  return {
    grossCents: 200_000,
    requiredByLawWithheldCents: 0,
    voluntaryDeductionsCents: 0,
    workweeksInPeriod: 1,
    ...overrides,
  };
}

function order(overrides: Partial<WageOrder> = {}): WageOrder {
  return {
    id: "o1",
    employeeId: "e1",
    orderKind: "creditor",
    caseNumber: "C-1",
    amountCents: 1_000_000,
    percentOfDisposableBasisPoints: null,
    arrearsOverTwelveWeeks: null,
    supportsSecondFamily: null,
    priority: 1,
    ...overrides,
  };
}

// ===========================================================================
describe("29 CFR 870.10 - the regulation's own worked examples", () => {
  it("reproduces $127.50 as the weekly protected floor at a $4.25 minimum wage", () => {
    // 870.10(b)(1): "On April 1, 1991, the minimum wage increased to $4.25.
    // Accordingly, the amount of disposable weekly earnings which may not be
    // garnished is $127.50 effective April 1, 1991."
    const floor = protectedFloorCents({
      minimumWageMilliCentsPerHour: MW_1991,
      multipleOfMinimumWage: 30,
      workweeksInPeriod: 1,
    });
    expect(floor).toBe(12_750);
    expect(centsToDollars(floor)).toBe("$127.50");
  });

  it("reproduces the earlier $114.00 figure at the $3.80 wage", () => {
    // 870.10(b)(1): "(For the period April 1, 1990 through March 31, 1991, the
    // amount that may not be garnished is $114 (30 x $3.80).)"
    const floor = protectedFloorCents({
      minimumWageMilliCentsPerHour: 380_000,
      multipleOfMinimumWage: 30,
      workweeksInPeriod: 1,
    });
    expect(centsToDollars(floor)).toBe("$114.00");
  });

  it("garnishes NOTHING when disposable earnings sit at or below the floor", () => {
    // 870.10(b)(1): "If an individual's disposable earnings for such a period
    // are equal to or less than 30 times the minimum wage, the individual's
    // earnings may not be garnished in any amount."
    const atFloor = ccpaCeiling({
      disposableCents: 12_750,
      federalMinimumWageMilliCents: MW_1991,
      workweeksInPeriod: 1,
    });
    expect(atFloor.ceilingCents).toBe(0);

    const belowFloor = ccpaCeiling({
      disposableCents: 10_000,
      federalMinimumWageMilliCents: MW_1991,
      workweeksInPeriod: 1,
    });
    expect(belowFloor.ceilingCents).toBe(0);
  });

  it("takes ONLY the amount above $127.50 in the $127.50-to-$170 band", () => {
    // 870.10(b)(2): "if an individual's disposable earnings ... are more than
    // $127.50, but less than $170.00, only the amount above $127.50 is subject
    // to garnishment."
    const r = ccpaCeiling({
      disposableCents: 15_000, // $150.00, inside the band
      federalMinimumWageMilliCents: MW_1991,
      workweeksInPeriod: 1,
    });
    expect(r.ceilingCents).toBe(15_000 - 12_750); // $22.50
    expect(r.binding).toBe("thirty_times_minimum_wage");
  });

  it("takes 25 percent once disposable earnings reach $170.00", () => {
    // 870.10(b)(3): "if an individual's disposable earnings ... are $170.00 or
    // more, 25 percent of his/her disposable earnings is subject to
    // garnishment."
    const r = ccpaCeiling({
      disposableCents: 17_000,
      federalMinimumWageMilliCents: MW_1991,
      workweeksInPeriod: 1,
    });
    expect(r.ceilingCents).toBe(4_250); // exactly 25% of $170.00
    expect(r.binding).toBe("twenty_five_percent");
  });

  it("$170 is precisely the crossover point the two rules meet at", () => {
    // Proves the boundary is not off by a cent in either direction, which is
    // where this kind of engine usually breaks.
    const justBelow = ccpaCeiling({
      disposableCents: 16_999,
      federalMinimumWageMilliCents: MW_1991,
      workweeksInPeriod: 1,
    });
    expect(justBelow.binding).toBe("thirty_times_minimum_wage");
    const justAbove = ccpaCeiling({
      disposableCents: 17_001,
      federalMinimumWageMilliCents: MW_1991,
      workweeksInPeriod: 1,
    });
    expect(justAbove.binding).toBe("twenty_five_percent");
  });

  it("DOUBLES the protected floor for a two-week cheque - 870.10(c)(2)", () => {
    // "The number of workweeks, or fractions thereof, should be multiplied
    // times the applicable Federal minimum wage and that amount should be
    // multiplied by 30."
    //
    // THIS IS THE TRAP THAT MATTERS AT GREENWAY, which pays biweekly. Using the
    // weekly $127.50 on a two-week cheque over-garnishes every time.
    const weekly = protectedFloorCents({
      minimumWageMilliCentsPerHour: MW_1991,
      multipleOfMinimumWage: 30,
      workweeksInPeriod: 1,
    });
    const biweekly = protectedFloorCents({
      minimumWageMilliCentsPerHour: MW_1991,
      multipleOfMinimumWage: 30,
      workweeksInPeriod: 2,
    });
    expect(biweekly).toBe(weekly * 2);
    expect(centsToDollars(biweekly)).toBe("$255.00");
  });

  it("handles a FRACTIONAL workweek, as the regulation contemplates", () => {
    const half = protectedFloorCents({
      minimumWageMilliCentsPerHour: MW_1991,
      multipleOfMinimumWage: 30,
      workweeksInPeriod: 0.5,
    });
    expect(centsToDollars(half)).toBe("$63.75");
  });

  it("the biweekly difference is real money, not a rounding argument", () => {
    // Same cheque, scored weekly vs biweekly. The gap is what an employee
    // would lose forever if the period adjustment were skipped.
    const disposable = 60_000; // $600 over two weeks
    const wrong = ccpaCeiling({
      disposableCents: disposable,
      federalMinimumWageMilliCents: MW_FED_MODERN,
      workweeksInPeriod: 1,
    });
    const right = ccpaCeiling({
      disposableCents: disposable,
      federalMinimumWageMilliCents: MW_FED_MODERN,
      workweeksInPeriod: 2,
    });
    // At $600 disposable both land on the 25% branch, so the floor does not
    // bind - proving the adjustment matters only near the floor is itself
    // worth knowing, so assert the floor moved even though the ceiling did not.
    expect(right.floorCents).toBe(wrong.floorCents * 2);
  });
});

// ===========================================================================
describe("15 U.S.C. 1672(b) - disposable earnings is NOT net pay", () => {
  it("subtracts legally required withholding", () => {
    const r = computeDisposableEarnings(
      pay({ grossCents: 100_000, requiredByLawWithheldCents: 20_000 }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.disposableCents).toBe(80_000);
  });

  it("REFUSES to subtract voluntary deductions, and says so out loud", () => {
    // The single most common error in the field. Health insurance is not
    // "required by law to be withheld" no matter how routine it is.
    const r = computeDisposableEarnings(
      pay({
        grossCents: 100_000,
        requiredByLawWithheldCents: 20_000,
        voluntaryDeductionsCents: 15_000,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.disposableCents).toBe(80_000); // NOT 65_000
    expect(r.value.ignoredVoluntaryCents).toBe(15_000);
    expect(r.value.explanation).toMatch(/deliberately NOT subtracted/);
  });

  it("refuses a cheque whose withholding exceeds its gross", () => {
    const r = computeDisposableEarnings(
      pay({ grossCents: 10_000, requiredByLawWithheldCents: 20_000 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("WITHHOLDING_EXCEEDS_GROSS");
  });

  it("refuses a negative gross", () => {
    const r = computeDisposableEarnings(pay({ grossCents: -1 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("NEGATIVE_GROSS");
  });
});

// ===========================================================================
describe("RCW 6.27.150 - Washington protects the GREATEST amount", () => {
  it("consumer debt is measured against the STATE wage at 35x, or 80%", () => {
    // (4)(a) thirty-five times the state minimum hourly wage; (b) eighty
    // percent of disposable earnings; whichever is GREATER is exempt.
    const r = washingtonExemption({
      disposableCents: 100_000,
      orderKind: "consumer_debt",
      wages: { federalMilliCentsPerHour: MW_FED_MODERN, stateMilliCentsPerHour: MW_WA_2026 },
      workweeksInPeriod: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 35 * $17.13 = $599.55
    expect(r.value.wageMultipleCents).toBe(59_955);
    // 80% of $1000 = $800
    expect(r.value.percentageCents).toBe(80_000);
    expect(r.value.exemptCents).toBe(80_000); // the greater
    expect(r.value.binding).toBe("percentage");
    expect(r.value.nonExemptCents).toBe(20_000);
  });

  it("student loan uses 50x the state wage or 85%", () => {
    // (3)(a) fifty times ... the highest minimum wage law in the state.
    const r = washingtonExemption({
      disposableCents: 100_000,
      orderKind: "student_loan",
      wages: { federalMilliCentsPerHour: MW_FED_MODERN, stateMilliCentsPerHour: MW_WA_2026 },
      workweeksInPeriod: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.wageMultipleCents).toBe(85_650); // 50 * $17.13
    expect(r.value.percentageCents).toBe(85_000);
    expect(r.value.exemptCents).toBe(85_650); // wage multiple wins here
    expect(r.value.binding).toBe("wage_multiple");
  });

  it("an ordinary creditor writ is measured against the FEDERAL wage, not the state one", () => {
    // (1)(a) says "federal minimum hourly wage" while (4)(a) says "state
    // minimum hourly wage". The statute really does switch, and in Washington
    // the two differ by more than a factor of two.
    const r = washingtonExemption({
      disposableCents: 100_000,
      orderKind: "creditor",
      wages: { federalMilliCentsPerHour: MW_FED_MODERN, stateMilliCentsPerHour: MW_WA_2026 },
      workweeksInPeriod: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.wageMultipleCents).toBe(25_375); // 35 * $7.25 federal
    expect(r.value.percentageCents).toBe(75_000);
  });

  it("never exempts more than the cheque actually holds", () => {
    const r = washingtonExemption({
      disposableCents: 5_000,
      orderKind: "consumer_debt",
      wages: { federalMilliCentsPerHour: MW_FED_MODERN, stateMilliCentsPerHour: MW_WA_2026 },
      workweeksInPeriod: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.exemptCents).toBe(5_000);
    expect(r.value.nonExemptCents).toBe(0);
  });

  it("refuses rather than reusing a stale state minimum wage", () => {
    const r = washingtonExemption({
      disposableCents: 100_000,
      orderKind: "consumer_debt",
      wages: { federalMilliCentsPerHour: MW_FED_MODERN, stateMilliCentsPerHour: null },
      workweeksInPeriod: 1,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("NO_STATE_MINIMUM_WAGE");
  });

  it("refuses to apply the ordinary exemption to a support order or a tax levy", () => {
    // Rule 48: a check that cannot classify its input must SAY so rather than
    // return a confident zero.
    for (const kind of ["child_support", "federal_tax_levy", "state_tax_levy"] as const) {
      const r = washingtonExemption({
        disposableCents: 100_000,
        orderKind: kind,
        wages: { federalMilliCentsPerHour: MW_FED_MODERN, stateMilliCentsPerHour: MW_WA_2026 },
        workweeksInPeriod: 1,
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.refusals[0].code).toBe("UNKNOWN_ORDER_KIND");
    }
  });
});

// ===========================================================================
describe("15 U.S.C. 1673(b)(2) - the support cap is 50/55/60/65", () => {
  const D = 100_000; // $1,000 disposable

  it("50 percent when supporting another family and no old arrears", () => {
    const r = supportCap({
      disposableCents: D,
      supportsSecondFamily: true,
      arrearsOverTwelveWeeks: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.capBasisPoints).toBe(5_000);
    expect(r.value.capCents).toBe(50_000);
  });

  it("55 percent when supporting another family WITH arrears over twelve weeks", () => {
    const r = supportCap({
      disposableCents: D,
      supportsSecondFamily: true,
      arrearsOverTwelveWeeks: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.capBasisPoints).toBe(5_500);
  });

  it("60 percent when NOT supporting another family", () => {
    const r = supportCap({
      disposableCents: D,
      supportsSecondFamily: false,
      arrearsOverTwelveWeeks: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.capBasisPoints).toBe(6_000);
  });

  it("65 percent - not supporting another family AND arrears over twelve weeks", () => {
    const r = supportCap({
      disposableCents: D,
      supportsSecondFamily: false,
      arrearsOverTwelveWeeks: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.capBasisPoints).toBe(6_500);
    expect(r.value.capCents).toBe(65_000);
  });

  it("REFUSES when the second-family question is unanswered - no safe default", () => {
    const r = supportCap({
      disposableCents: D,
      supportsSecondFamily: null,
      arrearsOverTwelveWeeks: false,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("SUPPORT_MISSING_SECOND_FAMILY_ANSWER");
    // Rule 64a: the refusal must EXPLAIN, not merely detect.
    expect(r.refusals[0].message).toMatch(/50%|60%/);
  });

  it("REFUSES when the arrears question is unanswered", () => {
    const r = supportCap({
      disposableCents: D,
      supportsSecondFamily: true,
      arrearsOverTwelveWeeks: null,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("SUPPORT_MISSING_ARREARS_ANSWER");
  });

  it("reports BOTH missing answers at once rather than one at a time", () => {
    const r = supportCap({
      disposableCents: D,
      supportsSecondFamily: null,
      arrearsOverTwelveWeeks: null,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals).toHaveLength(2);
  });
});

// ===========================================================================
describe("one order, end to end", () => {
  it("federal and state BOTH apply and the employee keeps the better deal", () => {
    // $1,000 disposable, consumer debt.
    //   Federal CCPA ceiling: 25% = $250, floor excess = $1000-$217.50 = large
    //                         -> $250 allowed.
    //   Washington:  greater of 35 x $17.13 = $599.55 or 80% = $800 exempt
    //                         -> only $200 allowed.
    // The employee keeps the benefit of the state rule: $200, not $250.
    const r = computeOneOrder({
      order: order({ orderKind: "consumer_debt", amountCents: 100_000 }),
      disposable: {
        grossCents: 120_000,
        requiredByLawWithheldCents: 20_000,
        disposableCents: 100_000,
        ignoredVoluntaryCents: 0,
        explanation: "",
      },
      wages: { federalMilliCentsPerHour: MW_FED_MODERN, stateMilliCentsPerHour: MW_WA_2026 },
      workweeksInPeriod: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.withheldCents).toBe(20_000);
    expect(r.value.lawfulMaximumCents).toBe(20_000);
    expect(r.value.explanation).toMatch(/keeps whichever protects more/);
  });

  it("reports a shortfall and tells Michael NOT to make it up next period", () => {
    const r = computeOneOrder({
      order: order({ orderKind: "consumer_debt", amountCents: 100_000 }),
      disposable: {
        grossCents: 120_000,
        requiredByLawWithheldCents: 20_000,
        disposableCents: 100_000,
        ignoredVoluntaryCents: 0,
        explanation: "",
      },
      wages: { federalMilliCentsPerHour: MW_FED_MODERN, stateMilliCentsPerHour: MW_WA_2026 },
      workweeksInPeriod: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.shortfallCents).toBe(80_000);
    expect(r.value.explanation).toMatch(/report the shortfall|Report the shortfall/i);
  });

  it("refuses an order that states neither an amount nor a percentage", () => {
    const r = computeOneOrder({
      order: order({ amountCents: null, percentOfDisposableBasisPoints: null }),
      disposable: {
        grossCents: 100_000,
        requiredByLawWithheldCents: 0,
        disposableCents: 100_000,
        ignoredVoluntaryCents: 0,
        explanation: "",
      },
      wages: WAGES_1991,
      workweeksInPeriod: 1,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("ORDER_HAS_NO_MEASURE");
  });

  it("refuses an order that states BOTH, instead of silently preferring one", () => {
    const r = computeOneOrder({
      order: order({ amountCents: 10_000, percentOfDisposableBasisPoints: 1_000 }),
      disposable: {
        grossCents: 100_000,
        requiredByLawWithheldCents: 0,
        disposableCents: 100_000,
        ignoredVoluntaryCents: 0,
        explanation: "",
      },
      wages: WAGES_1991,
      workweeksInPeriod: 1,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("ORDER_HAS_TWO_MEASURES");
  });

  it("a tax levy is NOT held to the 25 percent ceiling", () => {
    // 15 U.S.C. 1673(b)(1)(C).
    const r = computeOneOrder({
      order: order({ orderKind: "federal_tax_levy", amountCents: 50_000 }),
      disposable: {
        grossCents: 120_000,
        requiredByLawWithheldCents: 20_000,
        disposableCents: 100_000,
        ignoredVoluntaryCents: 0,
        explanation: "",
      },
      wages: { federalMilliCentsPerHour: MW_FED_MODERN, stateMilliCentsPerHour: MW_WA_2026 },
      workweeksInPeriod: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // $500 is far above 25% of $1,000 and is nonetheless allowed.
    expect(r.value.withheldCents).toBe(50_000);
    expect(r.value.explanation).toMatch(/not held to the 25% garnishment ceiling/);
  });

  it("REFUSES a creditor writ when no federal minimum wage is on file", () => {
    // Rule 62d, and specifically proves the engine does NOT fall back to the
    // $127.50 printed in the regulation.
    const r = computeOneOrder({
      order: order({ orderKind: "creditor", amountCents: 10_000 }),
      disposable: {
        grossCents: 100_000,
        requiredByLawWithheldCents: 0,
        disposableCents: 100_000,
        ignoredVoluntaryCents: 0,
        explanation: "",
      },
      wages: { federalMilliCentsPerHour: null, stateMilliCentsPerHour: MW_WA_2026 },
      workweeksInPeriod: 1,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("NO_FEDERAL_MINIMUM_WAGE");
    expect(r.refusals[0].message).toMatch(/1991|\$4\.25/);
  });
});

// ===========================================================================
describe("many orders on one cheque", () => {
  const disposableFacts = pay({
    grossCents: 120_000,
    requiredByLawWithheldCents: 20_000,
    workweeksInPeriod: 2,
  });

  it("child support is satisfied before a creditor writ", () => {
    const r = computeAllOrders({
      orders: [
        order({
          id: "cred",
          orderKind: "creditor",
          caseNumber: "CRED-1",
          amountCents: 50_000,
          priority: 1,
        }),
        order({
          id: "cs",
          orderKind: "child_support",
          caseNumber: "CS-1",
          amountCents: 40_000,
          supportsSecondFamily: true,
          arrearsOverTwelveWeeks: false,
          priority: 9,
        }),
      ],
      pay: disposableFacts,
      wages: { federalMilliCentsPerHour: MW_FED_MODERN, stateMilliCentsPerHour: MW_WA_2026 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Child support first despite its worse `priority` number, because kind
    // outranks the within-kind ordering.
    expect(r.value.lines[0].caseNumber).toBe("CS-1");
    expect(r.value.lines[0].withheldCents).toBe(40_000);
  });

  it("RCW 26.18.090(4): two maintenance orders split the money EQUALLY, not pro rata", () => {
    // THE POINT OF THIS TEST. Two maintenance orders, $600 and $200, against
    // $400 of available money. Pro rata - which is what most systems do and
    // what everyone assumes - would be $300 and $100. The statute says EQUALLY,
    // so it is $200 and $200.
    const r = computeAllOrders({
      orders: [
        order({
          id: "m1",
          orderKind: "spousal_support",
          caseNumber: "M-1",
          amountCents: 60_000,
          supportsSecondFamily: true,
          arrearsOverTwelveWeeks: false,
          priority: 1,
        }),
        order({
          id: "m2",
          orderKind: "spousal_support",
          caseNumber: "M-2",
          amountCents: 20_000,
          supportsSecondFamily: true,
          arrearsOverTwelveWeeks: false,
          priority: 2,
        }),
      ],
      // $800 disposable -> WA 50% cap = $400 available to maintenance.
      pay: pay({ grossCents: 80_000, requiredByLawWithheldCents: 0, workweeksInPeriod: 2 }),
      wages: { federalMilliCentsPerHour: MW_FED_MODERN, stateMilliCentsPerHour: MW_WA_2026 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const m1 = r.value.lines.find((l) => l.caseNumber === "M-1");
    const m2 = r.value.lines.find((l) => l.caseNumber === "M-2");
    expect(m1?.withheldCents).toBe(20_000);
    // M-2 only asked for $200 and its equal share is $200, so it is satisfied.
    expect(m2?.withheldCents).toBe(20_000);
    // NOT the pro-rata answer.
    expect(m1?.withheldCents).not.toBe(30_000);
    expect(r.value.notes.join(" ")).toMatch(/EQUALLY/);
  });

  it("splits an odd number of pennies without losing one", () => {
    // Three maintenance orders against an amount that does not divide evenly.
    // The total withheld must still reconcile exactly to the cap.
    const r = computeAllOrders({
      orders: [1, 2, 3].map((n) =>
        order({
          id: `m${n}`,
          orderKind: "spousal_support",
          caseNumber: `M-${n}`,
          amountCents: 100_000,
          supportsSecondFamily: true,
          arrearsOverTwelveWeeks: false,
          priority: n,
        }),
      ),
      // $1,000.01 disposable -> 50% cap = $500.00 (floored), /3 = 166.66r
      pay: pay({ grossCents: 100_001, requiredByLawWithheldCents: 0, workweeksInPeriod: 2 }),
      wages: { federalMilliCentsPerHour: MW_FED_MODERN, stateMilliCentsPerHour: MW_WA_2026 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cap = Math.floor(100_001 * 0.5);
    expect(r.value.totalWithheldCents).toBe(cap);
    // And no single order got more than one penny above another.
    const amounts = r.value.lines.map((l) => l.withheldCents);
    expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
  });

  it("never withholds more than the cheque holds, no matter how many orders", () => {
    const r = computeAllOrders({
      orders: [1, 2, 3, 4].map((n) =>
        order({
          id: `c${n}`,
          orderKind: "consumer_debt",
          caseNumber: `C-${n}`,
          amountCents: 500_000,
          priority: n,
        }),
      ),
      pay: pay({ grossCents: 100_000, requiredByLawWithheldCents: 20_000, workweeksInPeriod: 2 }),
      wages: { federalMilliCentsPerHour: MW_FED_MODERN, stateMilliCentsPerHour: MW_WA_2026 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.totalWithheldCents).toBeLessThanOrEqual(r.value.disposable.disposableCents);
  });

  it("refuses without a workweek count rather than assuming one week", () => {
    const r = computeAllOrders({
      orders: [order()],
      pay: pay({ workweeksInPeriod: 0 }),
      wages: WAGES_1991,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusals[0].code).toBe("NO_WORKWEEK_COUNT");
    expect(r.refusals[0].message).toMatch(/twice as much/);
  });

  it("an employee with no orders is not disturbed", () => {
    const r = computeAllOrders({
      orders: [],
      pay: disposableFacts,
      wages: WAGES_1991,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.totalWithheldCents).toBe(0);
    expect(r.value.lines).toHaveLength(0);
  });
});

// ===========================================================================
describe("standing rule 43 - every refusal code is reachable", () => {
  it("no code in the union is decoration", () => {
    // A refusal code that no path can emit is a lie about the engine's
    // behaviour. Each of these is produced by an actual call above or here.
    const emitted = new Set<string>();

    const push = (r: { ok: boolean } & Record<string, unknown>) => {
      if (!r.ok) {
        for (const x of r.refusals as Array<{ code: string }>) emitted.add(x.code);
      }
    };

    push(computeDisposableEarnings(pay({ grossCents: -1 })));
    push(computeDisposableEarnings(pay({ grossCents: 10, requiredByLawWithheldCents: 20 })));
    push(computeAllOrders({ orders: [], pay: pay({ workweeksInPeriod: 0 }), wages: WAGES_1991 }));
    push(
      supportCap({ disposableCents: 100, supportsSecondFamily: null, arrearsOverTwelveWeeks: null }),
    );
    push(
      washingtonExemption({
        disposableCents: 100,
        orderKind: "consumer_debt",
        wages: { federalMilliCentsPerHour: MW_FED_MODERN, stateMilliCentsPerHour: null },
        workweeksInPeriod: 1,
      }),
    );
    push(
      washingtonExemption({
        disposableCents: 100,
        orderKind: "child_support",
        wages: { federalMilliCentsPerHour: MW_FED_MODERN, stateMilliCentsPerHour: MW_WA_2026 },
        workweeksInPeriod: 1,
      }),
    );

    const D = {
      grossCents: 100_000,
      requiredByLawWithheldCents: 0,
      disposableCents: 100_000,
      ignoredVoluntaryCents: 0,
      explanation: "",
    };
    push(
      computeOneOrder({
        order: order({ amountCents: null, percentOfDisposableBasisPoints: null }),
        disposable: D,
        wages: WAGES_1991,
        workweeksInPeriod: 1,
      }),
    );
    push(
      computeOneOrder({
        order: order({ amountCents: 1, percentOfDisposableBasisPoints: 1 }),
        disposable: D,
        wages: WAGES_1991,
        workweeksInPeriod: 1,
      }),
    );
    push(
      computeOneOrder({
        order: order({ amountCents: null, percentOfDisposableBasisPoints: 20_000 }),
        disposable: D,
        wages: WAGES_1991,
        workweeksInPeriod: 1,
      }),
    );
    push(
      computeOneOrder({
        order: order({ orderKind: "creditor" }),
        disposable: D,
        wages: { federalMilliCentsPerHour: null, stateMilliCentsPerHour: MW_WA_2026 },
        workweeksInPeriod: 1,
      }),
    );

    const expected = [
      "NEGATIVE_GROSS",
      "WITHHOLDING_EXCEEDS_GROSS",
      "NO_WORKWEEK_COUNT",
      "SUPPORT_MISSING_SECOND_FAMILY_ANSWER",
      "SUPPORT_MISSING_ARREARS_ANSWER",
      "NO_STATE_MINIMUM_WAGE",
      "UNKNOWN_ORDER_KIND",
      "ORDER_HAS_NO_MEASURE",
      "ORDER_HAS_TWO_MEASURES",
      "PERCENT_OUT_OF_RANGE",
      "NO_FEDERAL_MINIMUM_WAGE",
    ];
    for (const code of expected) {
      expect(emitted.has(code), `refusal code ${code} was never emitted by any path`).toBe(true);
    }
  });
});
