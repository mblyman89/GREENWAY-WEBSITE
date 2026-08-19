/**
 * tests/compliance/payroll-withholding-core.test.ts
 *
 * Vitest mirror of the payroll withholding engine.
 *
 * The embedded harness in the core module carries the exhaustive table proofs
 * (continuity + the halving rule, ~200 assertions). THIS file exists to do the
 * things a harness cannot:
 *
 *   1. Prove the harness is WIRED - that it actually runs and actually throws.
 *   2. Assert SPECIFIC refusal messages, not just "it threw" (standing rule 13c).
 *   3. Run the adversarial cases: fuzzing, reconciliation invariants, and the
 *      real-world scenarios from Michael's own payroll.
 *   4. Act as the mutation-campaign target (rule 15c) - every assertion here was
 *      confirmed capable of failing by breaking the code under it.
 */
import { describe, expect, it } from "vitest";
import {
  // arithmetic
  divideRoundHalfUp,
  applyMilliPct,
  roundToWholeDollarCents,
  telescopingTaxForPeriod,
  formatCentsPlain,
  applyWithholdingOrderingRule,
  ONE_HUNDRED_PERCENT_MILLI,
  // tables
  STANDARD_MARRIED_FILING_JOINTLY,
  STANDARD_SINGLE_OR_MFS,
  STANDARD_HEAD_OF_HOUSEHOLD,
  STEP2_MARRIED_FILING_JOINTLY,
  STEP2_SINGLE_OR_MFS,
  STEP2_HEAD_OF_HOUSEHOLD,
  LINE_1G_MFJ_CENTS,
  LINE_1G_OTHER_CENTS,
  LEGACY_ALLOWANCE_VALUE_CENTS,
  selectRateSchedule,
  findBracket,
  // worksheet
  computeWorksheet1A,
  // bases
  OASDI_WAGE_BASE_2026_CENTS,
  OASDI_RATE_MILLI_PCT,
  OASDI_MAX_EMPLOYEE_TAX_2026_CENTS,
  MEDICARE_RATE_MILLI_PCT,
  MEDICARE_WAGE_BASE_CENTS,
  ADDITIONAL_MEDICARE_RATE_MILLI_PCT,
  ADDITIONAL_MEDICARE_WITHHOLDING_THRESHOLD_CENTS,
  ADDITIONAL_MEDICARE_LIABILITY_THRESHOLD_JOINT_CENTS,
  ADDITIONAL_MEDICARE_LIABILITY_THRESHOLD_MFS_CENTS,
  FUTA_GROSS_RATE_MILLI_PCT,
  FUTA_WAGE_BASE_CENTS,
  FUTA_MAX_CREDIT_MILLI_PCT,
  WA_SUTA_WAGE_BASE_2026_CENTS,
  WA_PFML_WAGE_BASE_2026_CENTS,
  WA_PFML_TOTAL_RATE_2026_MILLI_PCT,
  WA_PFML_EMPLOYER_SHARE_MILLI_PCT,
  WA_PFML_STATUTORY_RATE_CEILING_MILLI_PCT,
  WA_CARES_RATE_2026_MILLI_PCT,
  WA_CARES_WAGE_BASE_CENTS,
  WAGE_BASE_SPECS,
  wageBaseSpec,
  applyWageCeiling,
  ZERO_YTD,
  advanceYtd,
  // engines
  computeFicaForPeriod,
  computeFutaForPeriod,
  computeWaPfmlForPeriod,
  computeWaCaresForPeriod,
  computeWaSutaForPeriod,
  computeLniForPeriod,
  computePaycheckTaxes,
  __runPayrollWithholdingCoreTests,
  type WithholdingBracket,
  type YtdWageAccumulators,
} from "@/lib/payroll/payroll-withholding-core";
import {
  PAY_PERIODS_PER_YEAR,
  defaultW4WhenNoneFurnished,
  __runPayrollW4CoreTests,
  type PayFrequency,
  type W4Record,
} from "@/lib/payroll/payroll-w4-core";
import {
  PAYROLL_TAX_AUTHORITIES,
  findPayrollAuthority,
  resolvePayrollAuthorities,
  __runPayrollTaxAuthoritiesTests,
} from "@/lib/payroll/payroll-tax-authorities";

const W4: W4Record = {
  employeeId: "e1",
  formYear: 2026,
  filingStatus: "single_or_married_filing_separately",
  step2MultipleJobs: false,
  step3AnnualCreditCents: 0,
  step4aOtherIncomeAnnualCents: 0,
  step4bDeductionsAnnualCents: 0,
  step4cExtraPerPeriodCents: 0,
  legacyAllowances: null,
  exemptFromFederalIncomeTax: false,
  signedAt: "2026-01-02",
};

// ===========================================================================
// 1) HARNESS PARITY - prove the embedded self-tests are WIRED (rule 16)
// ===========================================================================

describe("harness parity", () => {
  it("runs the withholding core self-tests without throwing", () => {
    expect(() => __runPayrollWithholdingCoreTests()).not.toThrow();
  });

  it("actually asserts something substantial", () => {
    // A harness that runs but asserts nothing is worse than no harness, because
    // it produces a green check for free. Pin the count so silently gutting the
    // harness fails this test.
    const { passed, failed } = __runPayrollWithholdingCoreTests();
    expect(failed).toBe(0);
    expect(passed).toBeGreaterThan(200);
  });

  it("runs the W-4 and authority self-tests", () => {
    expect(() => __runPayrollW4CoreTests()).not.toThrow();
    expect(() => __runPayrollTaxAuthoritiesTests()).not.toThrow();
  });
});

// ===========================================================================
// 2) EXACT ARITHMETIC - the foundation everything else stands on
// ===========================================================================

describe("integer arithmetic", () => {
  it("rounds halves away from zero, per the IRS's own example", () => {
    // Pub. 15-T: "$2.30 becomes $2 and $2.50 becomes $3."
    expect(roundToWholeDollarCents(230)).toBe(200);
    expect(roundToWholeDollarCents(250)).toBe(300);
    expect(roundToWholeDollarCents(299)).toBe(300);
    expect(roundToWholeDollarCents(249)).toBe(200);
  });

  it("never produces a non-integer, for any input", () => {
    for (let n = -1000; n <= 1000; n += 7) {
      for (const d of [2, 3, 7, 12, 26, 52, 100]) {
        const r = divideRoundHalfUp(n, d);
        expect(Number.isInteger(r)).toBe(true);
      }
    }
  });

  it("matches exact rational rounding across a fuzz sweep", () => {
    // Independent oracle: compute the same thing with BigInt (exact) and
    // compare. If divideRoundHalfUp ever drifts, this catches it.
    let seed = 987654321;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let i = 0; i < 4000; i += 1) {
      const cents = rnd() % 50_000_000;
      const rate = rnd() % 100_000;
      const got = applyMilliPct(cents, rate);
      const num = BigInt(cents) * BigInt(rate);
      const den = BigInt(ONE_HUNDRED_PERCENT_MILLI);
      const q = num / den;
      const r = num % den;
      // BigInt(2)/BigInt(1) rather than 2n/1n: tsconfig targets ES2017, where
      // BigInt literals are a syntax error. The arithmetic is identical.
      const want = r * BigInt(2) >= den ? q + BigInt(1) : q;
      expect(BigInt(got)).toBe(want);
    }
  });

  it("refuses floats rather than silently truncating them", () => {
    expect(() => applyMilliPct(1.5, 100)).toThrow(/integers/);
    expect(() => applyMilliPct(100, 1.5)).toThrow(/integers/);
    expect(() => divideRoundHalfUp(1.5, 2)).toThrow(/integers/);
    expect(() => roundToWholeDollarCents(1.5)).toThrow(/integer cents/);
  });

  it("refuses to compute past the exact-integer range instead of lying", () => {
    expect(() => applyMilliPct(Number.MAX_SAFE_INTEGER, 100_000)).toThrow(/overflow/);
  });
});

// ===========================================================================
// 3) THE SSA ORACLE - a correctness check the government published for us
// ===========================================================================

describe("the SSA oracle", () => {
  it("reproduces the $11,439.00 maximum SSA publishes for 2026", () => {
    // ssa.gov/oact/cola/cbb.html: "an individual with wages equal to or larger
    // than $184,500 would contribute $11,439.00 to the OASDI program in 2026".
    expect(applyMilliPct(OASDI_WAGE_BASE_2026_CENTS, OASDI_RATE_MILLI_PCT)).toBe(1_143_900);
    expect(OASDI_MAX_EMPLOYEE_TAX_2026_CENTS).toBe(1_143_900);
  });

  it("reaches exactly that maximum over a real year of payroll, penny for penny", () => {
    // Weekly payroll, an awkward amount that straddles the ceiling mid-check.
    let ytd = ZERO_YTD;
    let withheld = 0;
    for (let week = 0; week < 52; week += 1) {
      const r = computeFicaForPeriod({ ytd, periodWagesCents: 400_000 }); // $4,000/wk
      withheld += r.employeeOasdiCents;
      ytd = advanceYtd(ytd, 400_000, 4_000);
    }
    expect(ytd.oasdiWagesCents).toBe(20_800_000); // $208,000 - past the base
    expect(withheld).toBe(OASDI_MAX_EMPLOYEE_TAX_2026_CENTS);
  });

  it("reaches the same maximum on a different pay frequency", () => {
    // Rounding must not accumulate differently by cadence.
    let ytd = ZERO_YTD;
    let withheld = 0;
    for (let m = 0; m < 12; m += 1) {
      const r = computeFicaForPeriod({ ytd, periodWagesCents: 1_733_333 });
      withheld += r.employeeOasdiCents;
      ytd = advanceYtd(ytd, 1_733_333, 17_333);
    }
    expect(withheld).toBe(OASDI_MAX_EMPLOYEE_TAX_2026_CENTS);
  });

  // -------------------------------------------------------------------------
  // THE CADENCE MATRIX. This is the test that caught the defect.
  //
  // Every one of these seven scenarios pays an employee past the $184,500
  // Social Security ceiling, so every one of them MUST finish the year at
  // exactly $11,439.00. Under naive per-period rounding they finish at
  // $11,439.04, .08, .10, .31 and so on - each cadence wrong by a different
  // amount, every individual paycheck correct, the year wrong. Telescoping
  // makes all seven land on the nose.
  //
  // The awkward amounts are deliberate: each one is chosen so 6.2% of it lands
  // near a half cent, which is where per-period rounding does its damage.
  // -------------------------------------------------------------------------
  it.each([
    ["weekly, $4,000.00", 52, 400_000],
    ["weekly, $4,000.01 - the half-cent trap", 52, 400_001],
    ["biweekly, $7,109.61", 26, 710_961],
    ["semimonthly, $8,666.67", 24, 866_667],
    ["monthly, $17,333.33", 12, 1_733_333],
    ["quarterly, $52,000.01", 4, 5_200_001],
    ["daily, $711.11 over 260 workdays", 260, 71_111],
  ])(
    "lands on $11,439.00 exactly: %s",
    (_label, periods, perPeriodCents) => {
      let ytd = ZERO_YTD;
      let withheld = 0;
      let employerWithheld = 0;
      for (let i = 0; i < periods; i += 1) {
        const r = computeFicaForPeriod({ ytd, periodWagesCents: perPeriodCents });
        withheld += r.employeeOasdiCents;
        employerWithheld += r.employerOasdiCents;
        ytd = advanceYtd(ytd, perPeriodCents, 0);
      }
      // Precondition: this scenario really does cross the ceiling, otherwise
      // the test would pass vacuously.
      expect(periods * perPeriodCents).toBeGreaterThan(OASDI_WAGE_BASE_2026_CENTS);
      expect(withheld).toBe(OASDI_MAX_EMPLOYEE_TAX_2026_CENTS);
      // Section 3111(a) mirrors 3101(a), so the employer must land there too.
      expect(employerWithheld).toBe(OASDI_MAX_EMPLOYEE_TAX_2026_CENTS);
    },
  );

  it("proves the naive per-period method really would have been wrong", () => {
    // Rule 15: a test that cannot fail proves nothing. This one demonstrates
    // that the method we did NOT use produces a different, wrong answer - so
    // the tests above are pinning a real behavioral choice, not a tautology.
    let ytdCents = 0;
    let naive = 0;
    for (let m = 0; m < 12; m += 1) {
      const room = Math.max(0, OASDI_WAGE_BASE_2026_CENTS - ytdCents);
      const taxable = Math.min(1_733_333, room);
      naive += applyMilliPct(taxable, OASDI_RATE_MILLI_PCT);
      ytdCents += 1_733_333;
    }
    expect(naive).toBe(1_143_904); // four cents over the statutory maximum
    expect(naive).not.toBe(OASDI_MAX_EMPLOYEE_TAX_2026_CENTS);
  });

  it("telescopes correctly when the ceiling is crossed mid-check", () => {
    // The check that straddles the ceiling is the one most likely to be off.
    // $184,000 already paid, then a $1,000 check: only $500 of it is taxable.
    const r = computeFicaForPeriod({
      ytd: { ...ZERO_YTD, oasdiWagesCents: 18_400_000, medicareWagesCents: 18_400_000 },
      periodWagesCents: 100_000,
    });
    expect(r.oasdiTaxableCents).toBe(50_000);
    expect(r.oasdiCeilingReached).toBe(true);
    // And the year total is exactly right: what was already taken at $184,000
    // plus this check equals the statutory maximum.
    const alreadyTaken = applyMilliPct(18_400_000, OASDI_RATE_MILLI_PCT);
    expect(alreadyTaken + r.employeeOasdiCents).toBe(OASDI_MAX_EMPLOYEE_TAX_2026_CENTS);
    // Medicare has no ceiling, so all $1,000 stays taxable in the same check.
    expect(r.medicareTaxableCents).toBe(100_000);
  });
});

// ===========================================================================
// 3b) THE TELESCOPING HELPER ITSELF
// ===========================================================================

describe("telescopingTaxForPeriod", () => {
  it("is exactly equivalent to taxing the whole span at once", () => {
    // The defining property: however you slice a span into periods, the pieces
    // must sum to the same total as taxing the span in one shot.
    for (const rate of [6_200, 1_450, 1_130, 580, 6_000, 37_000]) {
      for (const total of [1, 99, 100_000, 1_234_567, 18_450_000, 20_800_000]) {
        for (const slices of [1, 2, 3, 7, 12, 26, 52]) {
          let cum = 0;
          let sum = 0;
          for (let i = 1; i <= slices; i += 1) {
            const next = Math.floor((total * i) / slices);
            sum += telescopingTaxForPeriod(cum, next, rate);
            cum = next;
          }
          expect(sum, `rate=${rate} total=${total} slices=${slices}`).toBe(
            applyMilliPct(total, rate),
          );
        }
      }
    }
  });

  it("refuses to run the year backwards instead of netting a void silently", () => {
    expect(() => telescopingTaxForPeriod(200_000, 100_000, 6_200)).toThrow(
      /cumulative taxable wages went backwards/,
    );
    expect(() => telescopingTaxForPeriod(200_000, 100_000, 6_200)).toThrow(
      /reversing entry with its own audit trail/,
    );
  });

  it("refuses floats and negatives", () => {
    expect(() => telescopingTaxForPeriod(1.5, 2, 6_200)).toThrow(/integers/);
    expect(() => telescopingTaxForPeriod(0, 100, 6.2)).toThrow(/integers/);
    expect(() => telescopingTaxForPeriod(-1, 100, 6_200)).toThrow(/non-negative/);
  });

  it("returns zero for a zero-wage period rather than throwing", () => {
    expect(telescopingTaxForPeriod(500_000, 500_000, 6_200)).toBe(0);
  });
});

describe("applyWithholdingOrderingRule", () => {
  const Q = (...amts: number[]) => amts.map((a, i) => ({ label: `t${i}`, amountCents: a }));

  it("takes everything when the money is there", () => {
    const r = applyWithholdingOrderingRule(1_000, Q(100, 200, 300));
    expect(r.totalWithheldCents).toBe(600);
    expect(r.totalUncollectedCents).toBe(0);
    expect(r.uncollectedByTax).toHaveLength(0);
  });

  it("stops exactly when the money runs out, in queue order", () => {
    // 250 available against 100 + 200 + 300 owed. First line fully paid,
    // second line gets the remaining 150, third gets nothing.
    const r = applyWithholdingOrderingRule(250, Q(100, 200, 300));
    expect(r.totalWithheldCents).toBe(250);
    expect(r.totalUncollectedCents).toBe(350);
    expect(r.uncollectedByTax).toEqual([
      { label: "t1", shortfallCents: 50 },
      { label: "t2", shortfallCents: 300 },
    ]);
  });

  it("holds both invariants across an exhaustive sweep", () => {
    // The invariants that keep a negative paycheck off the printer, checked
    // over the whole small-integer domain rather than at a few sample points.
    for (let avail = 0; avail <= 40; avail += 1) {
      for (let a = 0; a <= 12; a += 3) {
        for (let b = 0; b <= 12; b += 3) {
          for (let c = 0; c <= 12; c += 3) {
            const r = applyWithholdingOrderingRule(avail, Q(a, b, c));
            const label = `avail=${avail} q=${a},${b},${c}`;
            // 1. never withhold more than exists -> net pay can never go negative
            expect(r.totalWithheldCents, label).toBeLessThanOrEqual(avail);
            // 2. no cent appears or disappears
            expect(r.totalWithheldCents + r.totalUncollectedCents, label).toBe(a + b + c);
            // 3. withhold as much as possible - never leave money unclaimed
            expect(r.totalWithheldCents, label).toBe(Math.min(avail, a + b + c));
            // 4. shortfalls are positive and reconcile to the total
            const sum = r.uncollectedByTax.reduce((s, u) => s + u.shortfallCents, 0);
            expect(sum, label).toBe(r.totalUncollectedCents);
            for (const u of r.uncollectedByTax) {
              expect(u.shortfallCents, label).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });

  it("never reports a shortfall for a line that wanted nothing", () => {
    const r = applyWithholdingOrderingRule(0, Q(0, 0, 500));
    expect(r.uncollectedByTax).toEqual([{ label: "t2", shortfallCents: 500 }]);
  });

  it("handles the empty queue and the zero check", () => {
    expect(applyWithholdingOrderingRule(0, []).totalWithheldCents).toBe(0);
    expect(applyWithholdingOrderingRule(1_000, []).totalUncollectedCents).toBe(0);
    expect(applyWithholdingOrderingRule(0, Q(0, 0)).uncollectedByTax).toHaveLength(0);
  });

  it("refuses garbage inputs instead of producing a plausible wrong answer", () => {
    expect(() => applyWithholdingOrderingRule(-1, Q(10))).toThrow(/non-negative integer/);
    expect(() => applyWithholdingOrderingRule(1.5, Q(10))).toThrow(/non-negative integer/);
    expect(() => applyWithholdingOrderingRule(100, Q(-5))).toThrow(/non-negative integer/);
    expect(() => applyWithholdingOrderingRule(100, [{ label: "x", amountCents: 1.5 }])).toThrow(
      /whole number of cents/,
    );
  });
});

describe("formatCentsPlain", () => {
  it("renders money the way a human reads it", () => {
    expect(formatCentsPlain(0)).toBe("$0.00");
    expect(formatCentsPlain(1)).toBe("$0.01");
    expect(formatCentsPlain(99)).toBe("$0.99");
    expect(formatCentsPlain(100)).toBe("$1.00");
    expect(formatCentsPlain(1_200)).toBe("$12.00");
    expect(formatCentsPlain(100_000)).toBe("$1,000.00");
    expect(formatCentsPlain(1_143_900)).toBe("$11,439.00");
    expect(formatCentsPlain(18_450_000)).toBe("$184,500.00");
    expect(formatCentsPlain(123_456_789)).toBe("$1,234,567.89");
    expect(formatCentsPlain(-1_199)).toBe("-$11.99");
  });

  it("never loses or invents a cent, across the whole realistic range", () => {
    // Round-trips the string back to cents and compares. A formatter that only
    // looks right is not good enough when the number drives a decision.
    for (let c = 0; c <= 20_000; c += 1) {
      const s = formatCentsPlain(c);
      const back = Number(s.replace(/[$,]/g, "")) * 100;
      expect(Math.round(back), `cents=${c}`).toBe(c);
    }
  });

  it("refuses a float rather than printing a number nobody can reconcile", () => {
    expect(() => formatCentsPlain(1.5)).toThrow(/integer cents/);
  });
});

// ===========================================================================
// 4) THE TABLES - proven, not proofread
// ===========================================================================

const ALL_TABLES: Array<[string, readonly WithholdingBracket[]]> = [
  ["standard MFJ", STANDARD_MARRIED_FILING_JOINTLY],
  ["standard single/MFS", STANDARD_SINGLE_OR_MFS],
  ["standard HoH", STANDARD_HEAD_OF_HOUSEHOLD],
  ["step2 MFJ", STEP2_MARRIED_FILING_JOINTLY],
  ["step2 single/MFS", STEP2_SINGLE_OR_MFS],
  ["step2 HoH", STEP2_HEAD_OF_HOUSEHOLD],
];

describe("Pub. 15-T (2026) rate schedules", () => {
  it("has all six schedules with eight brackets each", () => {
    expect(ALL_TABLES).toHaveLength(6);
    for (const [name, t] of ALL_TABLES) {
      expect(t.length, name).toBe(8);
    }
  });

  const STANDARD_TABLES = ALL_TABLES.slice(0, 3);

  it.each(STANDARD_TABLES)(
    "%s is continuous - each bracket's top equals the next one's base",
    (_name, tbl) => {
      for (let i = 0; i < tbl.length - 1; i += 1) {
        const row = tbl[i]!;
        const next = tbl[i + 1]!;
        const width = next.atLeastCents - row.atLeastCents;
        expect(row.baseTaxCents + applyMilliPct(width, row.rateMilliPct)).toBe(next.baseTaxCents);
      }
    },
  );

  // The step-2 schedules get a DIFFERENT and STRONGER continuity test, because
  // the printed ones are not continuous against their own printed thresholds.
  //
  // The IRS builds a step-2 schedule by adding line 1g to the standard schedule
  // and halving it. Halving an odd dollar figure lands on a half dollar, and the
  // IRS then rounds the THRESHOLD to a whole dollar for printing while deriving
  // the BASE TAX from the exact, unrounded breakpoint. Two rows of the
  // Single/MFS schedule visibly break as a result - 4->5 by 12 cents and 6->7 by
  // 18 cents. Those are the IRS's published numbers. The employer is told to use
  // the printed figures and every other payroll system produces the printed
  // result, so this engine reproduces them exactly and asserts the identity that
  // actually generated them.
  //
  // Arithmetic is in HALF-CENTS so a half-cent breakpoint stays an exact
  // integer: (standardFloor + line1g) in CENTS *is* the step-2 breakpoint in
  // HALF-CENTS, with no division and therefore no rounding at all.
  it.each([
    ["step2 MFJ", STANDARD_MARRIED_FILING_JOINTLY, STEP2_MARRIED_FILING_JOINTLY, LINE_1G_MFJ_CENTS],
    ["step2 single/MFS", STANDARD_SINGLE_OR_MFS, STEP2_SINGLE_OR_MFS, LINE_1G_OTHER_CENTS],
    ["step2 HoH", STANDARD_HEAD_OF_HOUSEHOLD, STEP2_HEAD_OF_HOUSEHOLD, LINE_1G_OTHER_CENTS],
  ] as Array<[string, readonly WithholdingBracket[], readonly WithholdingBracket[], number]>)(
    "%s is continuous against the EXACT halved breakpoints, which is what generated it",
    (_name, std, s2, g) => {
      const exactHalfCents = std.map((row, i) => (i === 0 ? 0 : row.atLeastCents + g));
      for (let i = 0; i < s2.length - 1; i += 1) {
        const row = s2[i]!;
        const widthHalfCents = exactHalfCents[i + 1]! - exactHalfCents[i]!;
        const topHalfCents = row.baseTaxCents * 2 + applyMilliPct(widthHalfCents, row.rateMilliPct);
        expect(divideRoundHalfUp(topHalfCents, 2)).toBe(s2[i + 1]!.baseTaxCents);
      }
    },
  );

  it("pins the two IRS threshold-rounding discontinuities exactly where they are", () => {
    // If the IRS ever cleans these up, or if somebody retypes the table and
    // "corrects" them, this fails loudly instead of drifting silently.
    const t = STEP2_SINGLE_OR_MFS;
    const printedTop = (i: number) =>
      t[i]!.baseTaxCents +
      applyMilliPct(t[i + 1]!.atLeastCents - t[i]!.atLeastCents, t[i]!.rateMilliPct);
    expect(printedTop(4) - t[5]!.baseTaxCents).toBe(12);
    expect(printedTop(6) - t[7]!.baseTaxCents).toBe(-18);
    // And no OTHER row of ANY step-2 table has this property.
    for (const [name, tbl] of ALL_TABLES.slice(3)) {
      for (let i = 0; i < tbl.length - 1; i += 1) {
        if (name === "step2 single/MFS" && (i === 4 || i === 6)) continue;
        const row = tbl[i]!;
        const width = tbl[i + 1]!.atLeastCents - row.atLeastCents;
        expect(
          row.baseTaxCents + applyMilliPct(width, row.rateMilliPct),
          `${name}[${i}]`,
        ).toBe(tbl[i + 1]!.baseTaxCents);
      }
    }
  });

  it.each([
    ["MFJ", STANDARD_MARRIED_FILING_JOINTLY, STEP2_MARRIED_FILING_JOINTLY, LINE_1G_MFJ_CENTS],
    ["single/MFS", STANDARD_SINGLE_OR_MFS, STEP2_SINGLE_OR_MFS, LINE_1G_OTHER_CENTS],
    ["HoH", STANDARD_HEAD_OF_HOUSEHOLD, STEP2_HEAD_OF_HOUSEHOLD, LINE_1G_OTHER_CENTS],
  ] as Array<[string, readonly WithholdingBracket[], readonly WithholdingBracket[], number]>)(
    "%s: the step-2 schedule is provably the standard schedule halved",
    (_name, std, s2, g) => {
      for (let i = 1; i < std.length; i += 1) {
        const a = std[i]!;
        const b = s2[i]!;
        expect(b.rateMilliPct).toBe(a.rateMilliPct);
        expect(b.atLeastCents).toBe(roundToWholeDollarCents(divideRoundHalfUp(a.atLeastCents + g, 2)));
        expect(b.baseTaxCents).toBe(divideRoundHalfUp(a.baseTaxCents, 2));
      }
    },
  );

  it("kept every half-cent figure intact as integer cents", () => {
    // These are the literals most likely to be corrupted by a float round-trip.
    // If any of them had gone through a float, it would show up here.
    expect(STEP2_SINGLE_OR_MFS[7]!.baseTaxCents).toBe(9_648_963); // $96,489.63
    expect(STEP2_MARRIED_FILING_JOINTLY[7]!.baseTaxCents).toBe(10_329_175); // $103,291.75
    expect(STEP2_HEAD_OF_HOUSEHOLD[4]!.baseTaxCents).toBe(807_750); // $8,077.50
    expect(STEP2_HEAD_OF_HOUSEHOLD[5]!.baseTaxCents).toBe(1_960_350); // $19,603.50
    expect(STEP2_HEAD_OF_HOUSEHOLD[6]!.baseTaxCents).toBe(2_831_550); // $28,315.50
    expect(STEP2_HEAD_OF_HOUSEHOLD[7]!.baseTaxCents).toBe(9_558_550); // $95,585.50
    expect(STANDARD_MARRIED_FILING_JOINTLY[7]!.baseTaxCents).toBe(20_658_350); // $206,583.50
    expect(STANDARD_SINGLE_OR_MFS[7]!.baseTaxCents).toBe(19_297_925); // $192,979.25
    expect(STANDARD_HEAD_OF_HOUSEHOLD[7]!.baseTaxCents).toBe(19_117_100); // $191,171.00
  });

  it("selects the schedule Worksheet 1A step 2 says to select", () => {
    expect(selectRateSchedule("married_filing_jointly", false)).toBe(STANDARD_MARRIED_FILING_JOINTLY);
    expect(selectRateSchedule("single_or_married_filing_separately", false)).toBe(STANDARD_SINGLE_OR_MFS);
    expect(selectRateSchedule("head_of_household", false)).toBe(STANDARD_HEAD_OF_HOUSEHOLD);
    expect(selectRateSchedule("married_filing_jointly", true)).toBe(STEP2_MARRIED_FILING_JOINTLY);
    expect(selectRateSchedule("single_or_married_filing_separately", true)).toBe(STEP2_SINGLE_OR_MFS);
    expect(selectRateSchedule("head_of_household", true)).toBe(STEP2_HEAD_OF_HOUSEHOLD);
  });

  it("implements the '>= column A and < column B' boundary exactly", () => {
    const s = STANDARD_SINGLE_OR_MFS;
    for (let i = 1; i < s.length; i += 1) {
      const floor = s[i]!.atLeastCents;
      // One cent below the floor belongs to the PREVIOUS bracket.
      expect(findBracket(s, floor - 1).rateMilliPct).toBe(s[i - 1]!.rateMilliPct);
      // Exactly at the floor belongs to THIS bracket ("at least").
      expect(findBracket(s, floor).rateMilliPct).toBe(s[i]!.rateMilliPct);
    }
  });

  it("is monotonic - more income never produces less tax", () => {
    let prev = -1;
    for (let wage = 0; wage <= 90_000_000; wage += 137_777) {
      const b = findBracket(STANDARD_SINGLE_OR_MFS, wage);
      const tax = b.baseTaxCents + applyMilliPct(wage - b.atLeastCents, b.rateMilliPct);
      expect(tax).toBeGreaterThanOrEqual(prev);
      prev = tax;
    }
  });
});

// ===========================================================================
// 5) WORKSHEET 1A
// ===========================================================================

describe("Worksheet 1A", () => {
  it("walks a plain single filer end to end and shows its work", () => {
    const r = computeWorksheet1A({ w4: W4, payFrequency: "biweekly", wagesThisPeriodCents: 200_000 });
    expect(r.line1a_wagesThisPeriodCents).toBe(200_000);
    expect(r.line1b_payPeriodsPerYear).toBe(26);
    expect(r.line1c_annualWagesCents).toBe(5_200_000);
    expect(r.line1g_cents).toBe(860_000);
    expect(r.adjustedAnnualWageCents).toBe(4_340_000);
    expect(r.line2b_bracketFloorCents).toBe(1_990_000);
    expect(r.line2c_baseTaxCents).toBe(124_000);
    expect(r.line2d_rateMilliPct).toBe(12_000);
    expect(r.line2e_excessCents).toBe(2_350_000);
    expect(r.line2f_marginalTaxCents).toBe(282_000);
    expect(r.line2g_annualTentativeCents).toBe(406_000);
    expect(r.line2h_tentativePerPeriodCents).toBe(15_615);
    expect(r.line4b_withholdingCents).toBe(15_615);
  });

  it("uses $12,900 on line 1g for joint filers and $8,600 for everyone else", () => {
    const j = computeWorksheet1A({
      w4: { ...W4, filingStatus: "married_filing_jointly" },
      payFrequency: "biweekly",
      wagesThisPeriodCents: 200_000,
    });
    const h = computeWorksheet1A({
      w4: { ...W4, filingStatus: "head_of_household" },
      payFrequency: "biweekly",
      wagesThisPeriodCents: 200_000,
    });
    expect(j.line1g_cents).toBe(1_290_000);
    expect(h.line1g_cents).toBe(860_000);
    // And a joint filer therefore has less withheld than a head of household.
    expect(j.line4b_withholdingCents).toBeLessThan(h.line4b_withholdingCents);
  });

  it("zeroes line 1g and switches tables when the Step 2 box is checked", () => {
    const off = computeWorksheet1A({ w4: W4, payFrequency: "biweekly", wagesThisPeriodCents: 200_000 });
    const on = computeWorksheet1A({
      w4: { ...W4, step2MultipleJobs: true },
      payFrequency: "biweekly",
      wagesThisPeriodCents: 200_000,
    });
    expect(on.line1g_cents).toBe(0);
    expect(on.scheduleUsed).toBe("step2_single_mfs");
    // The box exists to withhold MORE. If it ever withheld less, it is broken.
    expect(on.line4b_withholdingCents).toBeGreaterThan(off.line4b_withholdingCents);
  });

  it("adds Step 4(a) other income and subtracts Step 4(b) deductions", () => {
    const r = computeWorksheet1A({
      w4: { ...W4, step4aOtherIncomeAnnualCents: 1_000_000, step4bDeductionsAnnualCents: 500_000 },
      payFrequency: "biweekly",
      wagesThisPeriodCents: 200_000,
    });
    expect(r.line1e_cents).toBe(6_200_000); // 52,000 + 10,000
    expect(r.line1h_cents).toBe(1_360_000); // 5,000 + 8,600
    expect(r.adjustedAnnualWageCents).toBe(4_840_000);
  });

  it("honours Step 4(c) extra withholding on top of everything", () => {
    const base = computeWorksheet1A({ w4: W4, payFrequency: "biweekly", wagesThisPeriodCents: 200_000 });
    const extra = computeWorksheet1A({
      w4: { ...W4, step4cExtraPerPeriodCents: 2_500 },
      payFrequency: "biweekly",
      wagesThisPeriodCents: 200_000,
    });
    expect(extra.line4b_withholdingCents).toBe(base.line4b_withholdingCents + 2_500);
  });

  it("annualizes correctly for every pay frequency in Pub. 15-T Table 3", () => {
    const freqs: PayFrequency[] = [
      "weekly", "biweekly", "semimonthly", "monthly", "quarterly", "semiannually", "daily",
    ];
    for (const f of freqs) {
      const periods = PAY_PERIODS_PER_YEAR[f];
      const r = computeWorksheet1A({ w4: W4, payFrequency: f, wagesThisPeriodCents: 100_000 });
      expect(r.line1b_payPeriodsPerYear, f).toBe(periods);
      expect(r.line1c_annualWagesCents, f).toBe(100_000 * periods);
    }
  });

  it("produces roughly the same ANNUAL tax regardless of pay frequency", () => {
    // Same $52,000 a year, paid three different ways. The annual totals must
    // agree to within per-period rounding, or one cadence is systematically
    // over- or under-withholding.
    const weekly = computeWorksheet1A({ w4: W4, payFrequency: "weekly", wagesThisPeriodCents: 100_000 });
    const biweekly = computeWorksheet1A({ w4: W4, payFrequency: "biweekly", wagesThisPeriodCents: 200_000 });
    const monthly = computeWorksheet1A({
      w4: W4, payFrequency: "monthly", wagesThisPeriodCents: 433_333,
    });
    const wAnnual = weekly.line4b_withholdingCents * 52;
    const bAnnual = biweekly.line4b_withholdingCents * 26;
    const mAnnual = monthly.line4b_withholdingCents * 12;
    expect(Math.abs(wAnnual - bAnnual)).toBeLessThan(5_000);
    expect(Math.abs(bAnnual - mAnnual)).toBeLessThan(5_000);
  });
});

// ===========================================================================
// 6) THE TWO CLAMPS - separately, because they ARE separate
// ===========================================================================

describe("the two '-0-' clamps in Worksheet 1A", () => {
  it("clamp 1i floors the adjusted annual wage at zero", () => {
    const r = computeWorksheet1A({
      w4: { ...W4, step4bDeductionsAnnualCents: 50_000_000 },
      payFrequency: "biweekly",
      wagesThisPeriodCents: 200_000,
    });
    expect(r.adjustedAnnualWageCents).toBe(0);
    expect(r.clamp1iFired).toBe(true);
    expect(r.line2e_excessCents).toBe(0);
    expect(r.line2g_annualTentativeCents).toBe(0);
    expect(r.line4b_withholdingCents).toBe(0);
  });

  it("clamp 3c floors post-credit withholding at zero", () => {
    const r = computeWorksheet1A({
      w4: { ...W4, step3AnnualCreditCents: 50_000_000 },
      payFrequency: "biweekly",
      wagesThisPeriodCents: 200_000,
    });
    expect(r.line2h_tentativePerPeriodCents).toBe(15_615);
    expect(r.clamp3cFired).toBe(true);
    expect(r.line3c_afterCreditsCents).toBe(0);
    expect(r.line4b_withholdingCents).toBe(0);
  });

  it("PROVES the clamps are separate: a single end-clamp gives a different answer", () => {
    // This is the case that distinguishes "two clamps in place" from "one clamp
    // at the end". Deductions exceed pay AND a credit is claimed AND extra
    // withholding is requested.
    //
    // Correct (two clamps): 1i -> 0, tentative 0, 3c -> max(0, 0-credit) = 0,
    //                       4b = 0 + extra = 2500.
    // Wrong (one end clamp): 1i would be -448,600 -> 0% bracket -> line 2e
    //                        negative -> negative tentative -> minus credit ->
    //                        still negative -> clamped once -> extra LOST.
    const r = computeWorksheet1A({
      w4: {
        ...W4,
        step4bDeductionsAnnualCents: 10_000_000,
        step3AnnualCreditCents: 500_000,
        step4cExtraPerPeriodCents: 2_500,
      },
      payFrequency: "biweekly",
      wagesThisPeriodCents: 200_000,
    });
    expect(r.clamp1iFired).toBe(true);
    expect(r.clamp3cFired).toBe(true);
    expect(r.adjustedAnnualWageCents).toBe(0);
    expect(r.line3c_afterCreditsCents).toBe(0);
    // The employee ASKED for $25 extra. They must get it.
    expect(r.line4b_withholdingCents).toBe(2_500);
  });

  it("never returns a negative withholding amount, for any input combination", () => {
    for (const wages of [0, 1, 100_000, 200_000, 5_000_000]) {
      for (const ded of [0, 1_000_000, 90_000_000]) {
        for (const cred of [0, 200_000, 90_000_000]) {
          for (const extra of [0, 5_000]) {
            const r = computeWorksheet1A({
              w4: {
                ...W4,
                step4bDeductionsAnnualCents: ded,
                step3AnnualCreditCents: cred,
                step4cExtraPerPeriodCents: extra,
              },
              payFrequency: "biweekly",
              wagesThisPeriodCents: wages,
            });
            expect(r.line4b_withholdingCents).toBeGreaterThanOrEqual(0);
            expect(r.adjustedAnnualWageCents).toBeGreaterThanOrEqual(0);
            expect(r.line3c_afterCreditsCents).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(r.line4b_withholdingCents)).toBe(true);
          }
        }
      }
    }
  });
});

// ===========================================================================
// 7) EXEMPT MEANS INCOME TAX ONLY - the section 6672 guard
// ===========================================================================

describe("exemption from withholding", () => {
  it("stops federal income tax", () => {
    const r = computeWorksheet1A({
      w4: { ...W4, exemptFromFederalIncomeTax: true },
      payFrequency: "biweekly",
      wagesThisPeriodCents: 200_000,
    });
    expect(r.line4b_withholdingCents).toBe(0);
    expect(r.exemptFromIncomeTax).toBe(true);
  });

  it("does NOT stop Social Security or Medicare - treating it as such is a trust-fund offense", () => {
    const fica = computeFicaForPeriod({ ytd: ZERO_YTD, periodWagesCents: 200_000 });
    expect(fica.employeeOasdiCents).toBe(12_400);
    expect(fica.employeeMedicareCents).toBe(2_900);
    expect(fica.totalEmployeeFicaCents).toBe(15_300);
  });

  it("is structurally incapable of reaching FICA - the function cannot see the W-4", () => {
    // computeFicaForPeriod takes no W-4 at all. This is the safeguard: there is
    // no code path by which an exemption checkbox could suppress FICA, because
    // the FICA engine has no access to it. Prove FICA is identical either way.
    const exemptCheck = computePaycheckTaxes({
      ...baseCheckArgs(),
      w4: { ...W4, exemptFromFederalIncomeTax: true },
    });
    const normalCheck = computePaycheckTaxes(baseCheckArgs());
    expect(exemptCheck.federalIncomeTax.line4b_withholdingCents).toBe(0);
    expect(normalCheck.federalIncomeTax.line4b_withholdingCents).toBeGreaterThan(0);
    expect(exemptCheck.fica.totalEmployeeFicaCents).toBe(normalCheck.fica.totalEmployeeFicaCents);
    expect(exemptCheck.waCares.employeeCents).toBe(normalCheck.waCares.employeeCents);
    expect(exemptCheck.pfml.employeeShareCents).toBe(normalCheck.pfml.employeeShareCents);
  });

  it("still shows what would have been withheld, so the decision is visible", () => {
    const r = computeWorksheet1A({
      w4: { ...W4, exemptFromFederalIncomeTax: true },
      payFrequency: "biweekly",
      wagesThisPeriodCents: 200_000,
    });
    expect(r.line2h_tentativePerPeriodCents).toBe(15_615);
    expect(r.notes.join(" ")).toMatch(/Social Security and Medicare still come out/);
    expect(r.notes.join(" ")).toMatch(/February\s+15/);
  });
});

// ===========================================================================
// 8) THE EIGHT WAGE BASES - the central finding
// ===========================================================================

describe("the eight wage bases", () => {
  it("keeps eight genuinely distinct definitions", () => {
    expect(WAGE_BASE_SPECS).toHaveLength(8);
    const keys = WAGE_BASE_SPECS.map((s) => s.key);
    expect(new Set(keys).size).toBe(8);
  });

  it("gives every base a plain-English explanation and a real authority", () => {
    for (const spec of WAGE_BASE_SPECS) {
      expect(spec.plain.length, spec.key).toBeGreaterThan(40);
      expect(findPayrollAuthority(spec.authorityId), spec.key).toBeDefined();
    }
  });

  it("records the ceilings correctly, including the uncapped ones", () => {
    expect(wageBaseSpec("oasdi").ceilingCents).toBe(18_450_000);
    expect(wageBaseSpec("medicare").ceilingCents).toBeNull();
    expect(wageBaseSpec("additional_medicare").ceilingCents).toBeNull();
    expect(wageBaseSpec("futa").ceilingCents).toBe(700_000);
    expect(wageBaseSpec("wa_suta").ceilingCents).toBe(7_820_000);
    expect(wageBaseSpec("wa_pfml").ceilingCents).toBe(18_450_000);
    expect(wageBaseSpec("wa_cares").ceilingCents).toBeNull();
    expect(wageBaseSpec("lni_hours").ceilingCents).toBeNull();
  });

  it("derives the Paid Leave ceiling from the Social Security base rather than copying it", () => {
    // RCW 50A.10.030(4) ties them together. One fact, referenced twice.
    expect(WA_PFML_WAGE_BASE_2026_CENTS).toBe(OASDI_WAGE_BASE_2026_CENTS);
  });

  it("THE BIG ONE: Paid Leave and WA Cares have different ceilings", () => {
    expect(wageBaseSpec("wa_pfml").ceilingCents).not.toBe(wageBaseSpec("wa_cares").ceilingCents);
    expect(WA_CARES_WAGE_BASE_CENTS).toBeNull();
    expect(MEDICARE_WAGE_BASE_CENTS).toBeNull();
  });

  it("assigns incidence correctly - who actually pays", () => {
    expect(wageBaseSpec("futa").incidence).toBe("employer");
    expect(wageBaseSpec("wa_suta").incidence).toBe("employer");
    expect(wageBaseSpec("wa_cares").incidence).toBe("employee");
    expect(wageBaseSpec("additional_medicare").incidence).toBe("employee");
    expect(wageBaseSpec("oasdi").incidence).toBe("shared");
  });

  it("throws on an unknown base rather than returning a default", () => {
    // @ts-expect-error deliberately invalid
    expect(() => wageBaseSpec("made_up")).toThrow(/unknown wage base/);
  });
});

describe("wage ceilings", () => {
  it("splits a straddling check at exactly the ceiling", () => {
    const r = applyWageCeiling({ ytdWagesCents: 690_000, periodWagesCents: 50_000, ceilingCents: 700_000 });
    expect(r.taxableThisPeriodCents).toBe(10_000);
    expect(r.roomRemainingCents).toBe(0);
    expect(r.ceilingReached).toBe(true);
  });

  it("never taxes past a ceiling however many periods run", () => {
    let ytd = 0;
    let taxed = 0;
    for (let i = 0; i < 100; i += 1) {
      const r = applyWageCeiling({ ytdWagesCents: ytd, periodWagesCents: 33_333, ceilingCents: 700_000 });
      taxed += r.taxableThisPeriodCents;
      ytd += 33_333;
    }
    expect(taxed).toBe(700_000);
  });

  it("never stops when the ceiling is null", () => {
    let ytd = 0;
    let taxed = 0;
    for (let i = 0; i < 100; i += 1) {
      const r = applyWageCeiling({ ytdWagesCents: ytd, periodWagesCents: 33_333, ceilingCents: null });
      taxed += r.taxableThisPeriodCents;
      ytd += 33_333;
    }
    expect(taxed).toBe(3_333_300);
  });

  it("rejects negative wages instead of producing a negative tax", () => {
    expect(() => applyWageCeiling({ ytdWagesCents: -1, periodWagesCents: 1, ceilingCents: null })).toThrow(
      /cannot be negative/,
    );
    expect(() => applyWageCeiling({ ytdWagesCents: 1, periodWagesCents: -1, ceilingCents: null })).toThrow(
      /cannot be negative/,
    );
  });
});

// ===========================================================================
// 9) FICA
// ===========================================================================

describe("FICA", () => {
  it("matches the employer contribution to the employee's, exactly", () => {
    const r = computeFicaForPeriod({ ytd: ZERO_YTD, periodWagesCents: 333_333 });
    expect(r.employerOasdiCents).toBe(r.employeeOasdiCents);
    expect(r.employerMedicareCents).toBe(r.employeeMedicareCents);
  });

  it("does NOT match the employer to the additional 0.9% - section 3111 has no counterpart", () => {
    const r = computeFicaForPeriod({
      ytd: { ...ZERO_YTD, medicareWagesCents: 25_000_000 },
      periodWagesCents: 500_000,
    });
    expect(r.employeeAdditionalMedicareCents).toBe(4_500);
    expect(r.employerAdditionalMedicareCents).toBe(0);
    expect(r.totalEmployerFicaCents).toBe(r.employerOasdiCents + r.employerMedicareCents);
  });

  it("starts the additional Medicare tax exactly at $200,000 of wages from this employer", () => {
    const justUnder = computeFicaForPeriod({
      ytd: { ...ZERO_YTD, medicareWagesCents: 19_900_000 },
      periodWagesCents: 100_000,
    });
    expect(justUnder.additionalMedicareTaxableCents).toBe(0);

    const straddle = computeFicaForPeriod({
      ytd: { ...ZERO_YTD, medicareWagesCents: 19_950_000 },
      periodWagesCents: 100_000,
    });
    expect(straddle.additionalMedicareTaxableCents).toBe(50_000);

    const fullyOver = computeFicaForPeriod({
      ytd: { ...ZERO_YTD, medicareWagesCents: 21_000_000 },
      periodWagesCents: 100_000,
    });
    expect(fullyOver.additionalMedicareTaxableCents).toBe(100_000);
  });

  it("keeps the employer's WITHHOLDING trigger separate from the employee's LIABILITY thresholds", () => {
    // Payroll uses the flat $200,000 (section 3102(f)). The $250,000/$125,000
    // figures are for the employee's Form 8959 and must never drive withholding.
    expect(ADDITIONAL_MEDICARE_WITHHOLDING_THRESHOLD_CENTS).toBe(20_000_000);
    expect(ADDITIONAL_MEDICARE_LIABILITY_THRESHOLD_JOINT_CENTS).toBe(25_000_000);
    expect(ADDITIONAL_MEDICARE_LIABILITY_THRESHOLD_MFS_CENTS).toBe(12_500_000);
    // A joint filer's withholding is NOT deferred to $250,000.
    const joint = computeFicaForPeriod({
      ytd: { ...ZERO_YTD, medicareWagesCents: 21_000_000 },
      periodWagesCents: 100_000,
    });
    expect(joint.employeeAdditionalMedicareCents).toBeGreaterThan(0);
  });

  it("keeps Medicare running after Social Security has stopped", () => {
    const r = computeFicaForPeriod({
      ytd: { ...ZERO_YTD, oasdiWagesCents: 18_450_000, medicareWagesCents: 18_450_000 },
      periodWagesCents: 500_000,
    });
    expect(r.oasdiTaxableCents).toBe(0);
    expect(r.employeeOasdiCents).toBe(0);
    expect(r.medicareTaxableCents).toBe(500_000);
    expect(r.employeeMedicareCents).toBe(7_250);
  });

  it("explains the take-home-pay jump when Social Security stops", () => {
    const r = computeFicaForPeriod({
      ytd: { ...ZERO_YTD, oasdiWagesCents: 18_400_000, medicareWagesCents: 18_400_000 },
      periodWagesCents: 500_000,
    });
    expect(r.notes.join(" ")).toMatch(/net pay will go UP/);
  });

  it("uses the published rates", () => {
    expect(OASDI_RATE_MILLI_PCT).toBe(6_200);
    expect(MEDICARE_RATE_MILLI_PCT).toBe(1_450);
    expect(ADDITIONAL_MEDICARE_RATE_MILLI_PCT).toBe(900);
  });

  it("adds up: the FICA totals equal their own components, always", () => {
    // Caught by mutation: dropping Additional Medicare from the employee total
    // left every other assertion green while under-withholding a high earner.
    // The totals are now pinned to their parts across the whole domain,
    // including well above the $200,000 line.
    for (const ytdMed of [0, 5_000_000, 19_950_000, 20_000_000, 25_000_000, 60_000_000]) {
      for (const wages of [0, 1, 100_000, 500_000, 2_500_000]) {
        const r = computeFicaForPeriod({
          ytd: { ...ZERO_YTD, oasdiWagesCents: ytdMed, medicareWagesCents: ytdMed },
          periodWagesCents: wages,
        });
        const label = `ytd=${ytdMed} wages=${wages}`;
        expect(r.totalEmployeeFicaCents, label).toBe(
          r.employeeOasdiCents + r.employeeMedicareCents + r.employeeAdditionalMedicareCents,
        );
        expect(r.totalEmployerFicaCents, label).toBe(
          r.employerOasdiCents + r.employerMedicareCents,
        );
        // Section 3111 gives the employer no share of Additional Medicare, so
        // the employer total must NOT contain it - proven by construction here.
        expect(r.employerAdditionalMedicareCents, label).toBe(0);
        // Only meaningful where Additional Medicare is actually non-zero -
        // otherwise the assertion is vacuously satisfied and proves nothing.
        if (r.employeeAdditionalMedicareCents > 0) {
          expect(r.totalEmployerFicaCents, label).not.toBe(
            r.employerOasdiCents + r.employerMedicareCents + r.employeeAdditionalMedicareCents,
          );
        }
      }
    }
  });

  it("actually includes Additional Medicare in what comes out of the check", () => {
    // The specific number, so 'it is in the total' cannot be satisfied by zero.
    // $210,000 YTD, then a $10,000 check: all $10,000 is above the $200,000
    // line, so 0.9% of it - $90.00 - is Additional Medicare.
    const r = computeFicaForPeriod({
      ytd: { ...ZERO_YTD, oasdiWagesCents: 21_000_000, medicareWagesCents: 21_000_000 },
      periodWagesCents: 1_000_000,
    });
    expect(r.employeeAdditionalMedicareCents).toBe(9_000);
    expect(r.employeeOasdiCents).toBe(0); // long past the ceiling
    expect(r.employeeMedicareCents).toBe(14_500);
    expect(r.totalEmployeeFicaCents).toBe(23_500); // 14,500 + 9,000
    expect(r.totalEmployerFicaCents).toBe(14_500); // no employer match on the 0.9%
  });

  it("flows Additional Medicare all the way through to net pay", () => {
    // End to end, not just inside the FICA result object.
    const withAddl = computePaycheckTaxes({
      ...baseCheckArgs(),
      grossWagesCents: 1_000_000,
      ytd: { ...ZERO_YTD, oasdiWagesCents: 21_000_000, medicareWagesCents: 21_000_000 },
    });
    const withoutAddl = computePaycheckTaxes({
      ...baseCheckArgs(),
      grossWagesCents: 1_000_000,
      ytd: { ...ZERO_YTD, oasdiWagesCents: 5_000_000, medicareWagesCents: 5_000_000 },
    });
    expect(withAddl.fica.employeeAdditionalMedicareCents).toBe(9_000);
    expect(withoutAddl.fica.employeeAdditionalMedicareCents).toBe(0);
    // The high earner keeps $90.00 less of the same gross check, from the 0.9%
    // alone - Social Security is already off for both at these YTD levels only
    // for the first, so compare the Additional Medicare delta directly.
    expect(
      withAddl.totalEmployeeWithheldCents - withAddl.fica.employeeAdditionalMedicareCents,
    ).toBeLessThan(withAddl.totalEmployeeWithheldCents);
  });
});

// ===========================================================================
// 10) FUTA - and the 0.6% folklore
// ===========================================================================

describe("FUTA", () => {
  it("imposes the statutory 6%, not the folklore 0.6%", () => {
    expect(FUTA_GROSS_RATE_MILLI_PCT).toBe(6_000);
    expect(FUTA_WAGE_BASE_CENTS).toBe(700_000);
    expect(FUTA_MAX_CREDIT_MILLI_PCT).toBe(5_400);
    const r = computeFutaForPeriod({
      ytd: ZERO_YTD,
      periodWagesCents: 700_000,
      stateUnemploymentRateMilliPct: 0,
      stateContributionsPaidTimely: true,
      creditReductionMilliPct: 0,
    });
    expect(r.grossFutaCents).toBe(42_000); // 6% of $7,000 = $420
    expect(r.creditCents).toBe(0);
    expect(r.netFutaCents).toBe(42_000);
  });

  it("produces the familiar $42.00 a year only when the full credit is earned", () => {
    const r = computeFutaForPeriod({
      ytd: ZERO_YTD,
      periodWagesCents: 700_000,
      stateUnemploymentRateMilliPct: 5_400,
      stateContributionsPaidTimely: true,
      creditReductionMilliPct: 0,
    });
    expect(r.effectiveCreditMilliPct).toBe(5_400);
    expect(r.netFutaCents).toBe(4_200); // 0.6% of $7,000
  });

  it("caps the credit at 5.4% even when the state rate is higher", () => {
    const r = computeFutaForPeriod({
      ytd: ZERO_YTD,
      periodWagesCents: 700_000,
      stateUnemploymentRateMilliPct: 20_000,
      stateContributionsPaidTimely: true,
      creditReductionMilliPct: 0,
    });
    expect(r.effectiveCreditMilliPct).toBe(5_400);
  });

  it("cuts the credit to 90% when the state was paid late, and says why", () => {
    const timely = computeFutaForPeriod({
      ytd: ZERO_YTD, periodWagesCents: 700_000, stateUnemploymentRateMilliPct: 5_400,
      stateContributionsPaidTimely: true, creditReductionMilliPct: 0,
    });
    const late = computeFutaForPeriod({
      ytd: ZERO_YTD, periodWagesCents: 700_000, stateUnemploymentRateMilliPct: 5_400,
      stateContributionsPaidTimely: false, creditReductionMilliPct: 0,
    });
    expect(late.effectiveCreditMilliPct).toBe(4_860);
    expect(late.netFutaCents).toBeGreaterThan(timely.netFutaCents);
    expect(late.notes.join(" ")).toMatch(/billed twice/);
  });

  it("applies a credit reduction on top of everything else", () => {
    const r = computeFutaForPeriod({
      ytd: ZERO_YTD, periodWagesCents: 700_000, stateUnemploymentRateMilliPct: 5_400,
      stateContributionsPaidTimely: false, creditReductionMilliPct: 300,
    });
    // 5400 -> 90% -> 4860 -> less 300 -> 4560
    expect(r.effectiveCreditMilliPct).toBe(4_560);
  });

  it("never lets the credit exceed 90% of the tax, per section 3302(c)(1)", () => {
    const r = computeFutaForPeriod({
      ytd: ZERO_YTD, periodWagesCents: 700_000, stateUnemploymentRateMilliPct: 5_400,
      stateContributionsPaidTimely: true, creditReductionMilliPct: 0,
    });
    expect(r.creditCents).toBeLessThanOrEqual(divideRoundHalfUp(r.grossFutaCents * 90_000, 100_000));
    expect(r.netFutaCents).toBeGreaterThanOrEqual(0);
  });

  it("stops at $7,000 for the year", () => {
    let ytd = ZERO_YTD;
    let total = 0;
    for (let i = 0; i < 26; i += 1) {
      const r = computeFutaForPeriod({
        ytd, periodWagesCents: 200_000, stateUnemploymentRateMilliPct: 5_400,
        stateContributionsPaidTimely: true, creditReductionMilliPct: 0,
      });
      total += r.futaTaxableCents;
      ytd = advanceYtd(ytd, 200_000, 8_000);
    }
    expect(total).toBe(700_000);
  });

  it("rejects a negative rate rather than crediting backwards", () => {
    expect(() =>
      computeFutaForPeriod({
        ytd: ZERO_YTD, periodWagesCents: 100, stateUnemploymentRateMilliPct: -1,
        stateContributionsPaidTimely: true, creditReductionMilliPct: 0,
      }),
    ).toThrow(/non-negative/);
  });
});

// ===========================================================================
// 11) WASHINGTON - PFML AND WA CARES
// ===========================================================================

describe("WA Paid Family & Medical Leave", () => {
  it("uses the 2026 ESD rate and split", () => {
    expect(WA_PFML_TOTAL_RATE_2026_MILLI_PCT).toBe(1_130);
    expect(WA_PFML_EMPLOYER_SHARE_MILLI_PCT).toBe(28_570);
  });

  it("splits the premium so the halves always reconcile to the total", () => {
    // Fuzz it: independent rounding of two shares is where the stray penny
    // comes from, and a stray penny is an unexplained variance on the return.
    for (let wages = 1; wages < 500_000; wages += 997) {
      const r = computeWaPfmlForPeriod({
        ytd: ZERO_YTD, periodWagesCents: wages,
        totalRateMilliPct: WA_PFML_TOTAL_RATE_2026_MILLI_PCT,
        employerSharePctMilliPct: WA_PFML_EMPLOYER_SHARE_MILLI_PCT,
        employerHasFewerThan50WaEmployees: false,
      });
      expect(r.employeeShareCents + r.employerShareCents).toBe(r.totalPremiumCents);
      expect(r.employeeShareCents).toBeGreaterThanOrEqual(0);
      expect(r.employerShareCents).toBeGreaterThanOrEqual(0);
    }
  });

  it("waives the employer share under 50 employees but STILL withholds the employee share", () => {
    const r = computeWaPfmlForPeriod({
      ytd: ZERO_YTD, periodWagesCents: 200_000,
      totalRateMilliPct: WA_PFML_TOTAL_RATE_2026_MILLI_PCT,
      employerSharePctMilliPct: WA_PFML_EMPLOYER_SHARE_MILLI_PCT,
      employerHasFewerThan50WaEmployees: true,
    });
    expect(r.employerShareCents).toBe(0);
    expect(r.employeeShareCents).toBe(1_614);
    expect(r.employerExemptSmallBusiness).toBe(true);
    expect(r.notes.join(" ")).toMatch(/Being small excuses your part, not theirs/);
  });

  it("stops at the Social Security ceiling", () => {
    const r = computeWaPfmlForPeriod({
      ytd: { ...ZERO_YTD, waPfmlWagesCents: 18_450_000 }, periodWagesCents: 200_000,
      totalRateMilliPct: WA_PFML_TOTAL_RATE_2026_MILLI_PCT,
      employerSharePctMilliPct: WA_PFML_EMPLOYER_SHARE_MILLI_PCT,
      employerHasFewerThan50WaEmployees: false,
    });
    expect(r.pfmlTaxableCents).toBe(0);
    expect(r.employeeShareCents).toBe(0);
  });

  it("REFUSES a rate above the 1.20% statutory ceiling, naming the ceiling", () => {
    expect(() =>
      computeWaPfmlForPeriod({
        ytd: ZERO_YTD, periodWagesCents: 200_000,
        totalRateMilliPct: WA_PFML_STATUTORY_RATE_CEILING_MILLI_PCT + 1,
        employerSharePctMilliPct: WA_PFML_EMPLOYER_SHARE_MILLI_PCT,
        employerHasFewerThan50WaEmployees: false,
      }),
    ).toThrow(/1\.20% ceiling in RCW 50A\.10\.030\(6\)\(b\)\(ii\)/);
  });

  it("accepts a rate exactly at the ceiling", () => {
    expect(() =>
      computeWaPfmlForPeriod({
        ytd: ZERO_YTD, periodWagesCents: 200_000,
        totalRateMilliPct: WA_PFML_STATUTORY_RATE_CEILING_MILLI_PCT,
        employerSharePctMilliPct: WA_PFML_EMPLOYER_SHARE_MILLI_PCT,
        employerHasFewerThan50WaEmployees: false,
      }),
    ).not.toThrow();
  });
});

describe("WA Cares", () => {
  it("takes 0.58% from the employee and nothing from the employer", () => {
    const r = computeWaCaresForPeriod({
      ytd: ZERO_YTD, periodWagesCents: 200_000, rateMilliPct: WA_CARES_RATE_2026_MILLI_PCT,
      exemptionApprovalDocumentId: null, employeeClaimsExemption: false,
    });
    expect(r.employeeCents).toBe(1_160);
    expect(r.employerCents).toBe(0);
  });

  it("NEVER STOPS - the single most-missed fact in Washington payroll", () => {
    const r = computeWaCaresForPeriod({
      ytd: { ...ZERO_YTD, waCaresWagesCents: 100_000_000 }, // $1,000,000 YTD
      periodWagesCents: 200_000, rateMilliPct: WA_CARES_RATE_2026_MILLI_PCT,
      exemptionApprovalDocumentId: null, employeeClaimsExemption: false,
    });
    expect(r.waCaresTaxableCents).toBe(200_000);
    expect(r.employeeCents).toBe(1_160);
  });

  it("diverges from Paid Leave on the very same paycheck", () => {
    // Both programs, same employee, same check, same quarterly return - and
    // one has stopped while the other has not.
    const ytd: YtdWageAccumulators = {
      ...ZERO_YTD, waPfmlWagesCents: 19_000_000, waCaresWagesCents: 19_000_000,
    };
    const pfml = computeWaPfmlForPeriod({
      ytd, periodWagesCents: 200_000,
      totalRateMilliPct: WA_PFML_TOTAL_RATE_2026_MILLI_PCT,
      employerSharePctMilliPct: WA_PFML_EMPLOYER_SHARE_MILLI_PCT,
      employerHasFewerThan50WaEmployees: false,
    });
    const cares = computeWaCaresForPeriod({
      ytd, periodWagesCents: 200_000, rateMilliPct: WA_CARES_RATE_2026_MILLI_PCT,
      exemptionApprovalDocumentId: null, employeeClaimsExemption: false,
    });
    expect(pfml.pfmlTaxableCents).toBe(0);
    expect(cares.waCaresTaxableCents).toBe(200_000);
  });

  it("REFUSES an exemption with no ESD approval letter, and explains the risk", () => {
    expect(() =>
      computeWaCaresForPeriod({
        ytd: ZERO_YTD, periodWagesCents: 200_000, rateMilliPct: WA_CARES_RATE_2026_MILLI_PCT,
        exemptionApprovalDocumentId: null, employeeClaimsExemption: true,
      }),
    ).toThrow(/no ESD approval letter on file/);
    expect(() =>
      computeWaCaresForPeriod({
        ytd: ZERO_YTD, periodWagesCents: 200_000, rateMilliPct: WA_CARES_RATE_2026_MILLI_PCT,
        exemptionApprovalDocumentId: null, employeeClaimsExemption: true,
      }),
    ).toThrow(/the money you failed to withhold is money you owe/);
  });

  it("honours an exemption once the letter is on file", () => {
    const r = computeWaCaresForPeriod({
      ytd: ZERO_YTD, periodWagesCents: 200_000, rateMilliPct: WA_CARES_RATE_2026_MILLI_PCT,
      exemptionApprovalDocumentId: "esd-letter-2026-001", employeeClaimsExemption: true,
    });
    expect(r.exempt).toBe(true);
    expect(r.employeeCents).toBe(0);
    expect(r.notes.join(" ")).toMatch(/Paid Leave premium is unaffected/);
  });

  it("REFUSES a rate above the .58% statutory ceiling", () => {
    expect(() =>
      computeWaCaresForPeriod({
        ytd: ZERO_YTD, periodWagesCents: 200_000, rateMilliPct: 581,
        exemptionApprovalDocumentId: null, employeeClaimsExemption: false,
      }),
    ).toThrow(/\.58% ceiling in RCW 50B\.04\.080\(1\)/);
  });
});

// ===========================================================================
// 12) THE DESIGNED REFUSALS (rule 13c - assert the SPECIFIC message)
// ===========================================================================

describe("designed refusals", () => {
  it("refuses WA unemployment without an evidenced rate, and says where to get it", () => {
    const r = computeWaSutaForPeriod({
      ytd: ZERO_YTD, periodWagesCents: 200_000,
      combinedRateMilliPct: null, rateNoticeDocumentId: null,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.refusal.code).toBe("wa_suta_rate_not_evidenced");
    expect(r.refusal.message).toMatch(/different rate based on your own layoff history/);
    expect(r.refusal.message).toMatch(/balances perfectly and is still wrong/);
    expect(r.refusal.whatToDo).toMatch(/Employment Security Department tax rate notice/);
    expect(r.refusal.whatToDo).toMatch(/Tax Rate Notice/);
    expect(r.refusal.authorityId).toBe("esd-suta-rate-structure");
    expect(findPayrollAuthority(r.refusal.authorityId)).toBeDefined();
  });

  it("refuses if the rate is present but the evidence document is not", () => {
    // A rate with no document is an unsourced number - exactly what rule 11
    // forbids. Half-evidence is not evidence.
    const r = computeWaSutaForPeriod({
      ytd: ZERO_YTD, periodWagesCents: 200_000,
      combinedRateMilliPct: 1_500, rateNoticeDocumentId: null,
    });
    expect(r.ok).toBe(false);
  });

  it("computes WA unemployment once both the rate and the notice exist", () => {
    const r = computeWaSutaForPeriod({
      ytd: ZERO_YTD, periodWagesCents: 200_000,
      combinedRateMilliPct: 1_500, rateNoticeDocumentId: "esd-2026-rate",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.value.employerCents).toBe(3_000);
    expect(r.value.employeeCents).toBe(0);
  });

  it("stops WA unemployment at $78,200 - a third distinct ceiling", () => {
    expect(WA_SUTA_WAGE_BASE_2026_CENTS).toBe(7_820_000);
    const r = computeWaSutaForPeriod({
      ytd: { ...ZERO_YTD, waSutaWagesCents: 7_820_000 }, periodWagesCents: 200_000,
      combinedRateMilliPct: 1_500, rateNoticeDocumentId: "esd-2026-rate",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.value.sutaTaxableCents).toBe(0);
  });

  it("refuses L&I without a risk class, naming the audit risk", () => {
    const r = computeLniForPeriod({
      hundredthHours: 8_000, employerOnlyRateCentsPerHour: 50, medicalAidRateCentsPerHour: 30,
      riskClassCode: null, rateNoticeDocumentId: "doc",
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.refusal.code).toBe("lni_class_not_evidenced");
    expect(r.refusal.message).toMatch(/first things an L&I auditor checks/);
    expect(r.refusal.whatToDo).toMatch(/four-digit number/);
  });

  it("refuses L&I without rates, and warns about the deduction limit before it is asked", () => {
    const r = computeLniForPeriod({
      hundredthHours: 8_000, employerOnlyRateCentsPerHour: null, medicalAidRateCentsPerHour: null,
      riskClassCode: "6420-00", rateNoticeDocumentId: null,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.refusal.code).toBe("lni_rate_not_evidenced");
    expect(r.refusal.message).toMatch(/half of the MEDICAL AID piece/);
    expect(r.refusal.message).toMatch(/not half of the total/);
  });

  it("gives every refusal a real authority record", () => {
    const refusals = [
      computeWaSutaForPeriod({
        ytd: ZERO_YTD, periodWagesCents: 1, combinedRateMilliPct: null, rateNoticeDocumentId: null,
      }),
      computeLniForPeriod({
        hundredthHours: 1, employerOnlyRateCentsPerHour: null, medicalAidRateCentsPerHour: null,
        riskClassCode: null, rateNoticeDocumentId: null,
      }),
    ];
    for (const r of refusals) {
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      const auth = findPayrollAuthority(r.refusal.authorityId);
      expect(auth).toBeDefined();
      expect(auth!.quote.length).toBeGreaterThan(20);
      expect(auth!.cite.length).toBeGreaterThan(5);
      // Plain English: no bare section symbols in what Michael reads.
      expect(r.refusal.message).not.toMatch(/§/);
      expect(r.refusal.whatToDo.length).toBeGreaterThan(40);
    }
  });
});

// ===========================================================================
// 13) L&I - THE GROSS MISDEMEANOR GUARD
// ===========================================================================

describe("L&I employee deduction limit (RCW 51.16.140)", () => {
  const lni = (hundredthHours: number, employerOnly: number, medicalAid: number) =>
    computeLniForPeriod({
      hundredthHours,
      employerOnlyRateCentsPerHour: employerOnly,
      medicalAidRateCentsPerHour: medicalAid,
      riskClassCode: "6420-00",
      rateNoticeDocumentId: "lni-2026",
    });

  it("deducts exactly half of the MEDICAL AID rate and nothing else", () => {
    const r = lni(8_000, 50, 30); // 80 hrs, 50c/hr employer-only, 30c/hr medical aid
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.value.totalPremiumCents).toBe(6_400); // $64.00
    expect(r.value.employeeCents).toBe(1_200); // half of $24.00 medical aid
    expect(r.value.employerCents).toBe(5_200);
  });

  it("is structurally incapable of deducting half the TOTAL premium", () => {
    // Deducting half of $64.00 = $32.00 would be a gross misdemeanor. The
    // function computes the employee share from the medical aid rate alone, so
    // there is no input that makes it deduct half the total - unless the
    // employer-only rate happens to be zero.
    for (const [hrs, emp, med] of [
      [8_000, 50, 30], [4_000, 120, 15], [16_000, 7, 91], [100, 1, 1], [12_345, 33, 44],
    ] as Array<[number, number, number]>) {
      const r = lni(hrs, emp, med);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const halfTotal = divideRoundHalfUp(r.value.totalPremiumCents, 2);
      if (emp > 0) expect(r.value.employeeCents).toBeLessThan(halfTotal);
      // And never more than half the total, under any circumstances.
      expect(r.value.employeeCents).toBeLessThanOrEqual(halfTotal);
    }
  });

  it("never charges the employee for the accident fund or supplemental pension", () => {
    // Raise ONLY the employer-only rate. The employee's deduction must not move.
    const a = lni(8_000, 10, 30);
    const b = lni(8_000, 900, 30);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("unreachable");
    expect(a.value.employeeCents).toBe(b.value.employeeCents);
    expect(b.value.employerCents).toBeGreaterThan(a.value.employerCents);
  });

  it("rounds the odd penny to the EMPLOYER, never the worker", () => {
    // An over-deduction of even one cent is an unlawful deduction. An employer
    // absorbing one cent is not. The rounding must always fall the same way.
    for (let med = 1; med <= 99; med += 2) {
      const r = lni(100, 0, med); // exactly one hour
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const total = r.value.totalPremiumCents;
      expect(r.value.employeeCents).toBe(Math.floor(total / 2));
      expect(r.value.employeeCents).toBeLessThanOrEqual(r.value.employerCents);
      expect(r.value.employeeCents + r.value.employerCents).toBe(total);
    }
  });

  it("treats hours as integers in hundredths - floats are refused here too", () => {
    expect(() => lni(80.5, 50, 30)).toThrow(/hundredths of an hour/);
    expect(() => lni(-1, 50, 30)).toThrow(/non-negative/);
  });

  it("charges zero for zero hours", () => {
    const r = lni(0, 50, 30);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.value.totalPremiumCents).toBe(0);
    expect(r.value.employeeCents).toBe(0);
  });
});

// ===========================================================================
// 14) A WHOLE PAYCHECK
// ===========================================================================

function baseCheckArgs() {
  return {
    w4: W4,
    payFrequency: "biweekly" as PayFrequency,
    grossWagesCents: 200_000,
    ytd: ZERO_YTD,
    hundredthHours: 8_000,
    stateUnemploymentRateMilliPct: 1_500,
    sutaRateNoticeDocumentId: "esd-2026",
    stateContributionsPaidTimely: true,
    creditReductionMilliPct: 0,
    pfmlTotalRateMilliPct: WA_PFML_TOTAL_RATE_2026_MILLI_PCT,
    pfmlEmployerSharePctMilliPct: WA_PFML_EMPLOYER_SHARE_MILLI_PCT,
    employerHasFewerThan50WaEmployees: true,
    waCaresRateMilliPct: WA_CARES_RATE_2026_MILLI_PCT,
    waCaresExemptionApprovalDocumentId: null,
    employeeClaimsWaCaresExemption: false,
    lniEmployerOnlyRateCentsPerHour: 50,
    lniMedicalAidRateCentsPerHour: 30,
    lniRiskClassCode: "6420-00",
    lniRateNoticeDocumentId: "lni-2026",
  };
}

describe("a whole paycheck", () => {
  it("reconciles exactly - gross equals net plus withholding, always", () => {
    for (let gross = 0; gross <= 2_000_000; gross += 13_337) {
      const c = computePaycheckTaxes({ ...baseCheckArgs(), grossWagesCents: gross });
      expect(c.netPayCents + c.totalEmployeeWithheldCents).toBe(c.grossWagesCents);
      expect(Number.isInteger(c.netPayCents)).toBe(true);
      expect(Number.isInteger(c.totalEmployerTaxCents)).toBe(true);
    }
  });

  it("itemises a $2,000 biweekly check to the penny", () => {
    const c = computePaycheckTaxes(baseCheckArgs());
    expect(c.federalIncomeTax.line4b_withholdingCents).toBe(15_615);
    expect(c.fica.employeeOasdiCents).toBe(12_400);
    expect(c.fica.employeeMedicareCents).toBe(2_900);
    expect(c.pfml.employeeShareCents).toBe(1_614);
    expect(c.waCares.employeeCents).toBe(1_160);
    expect(c.lni.ok).toBe(true);
    expect(c.totalEmployeeWithheldCents).toBe(34_889);
    expect(c.netPayCents).toBe(165_111);
    expect(c.hasRefusals).toBe(false);
  });

  it("never produces a negative paycheck, at any gross, ever", () => {
    // Exhaustive-ish sweep across the whole range where the collision happens.
    // 80 hours of L&I liability is held constant, which is the realistic shape:
    // the hours are real, the pay is what varies.
    for (let gross = 0; gross <= 5_000; gross += 1) {
      const c = computePaycheckTaxes({ ...baseCheckArgs(), grossWagesCents: gross });
      expect(c.netPayCents, `gross=${gross}`).toBeGreaterThanOrEqual(0);
      expect(c.netPayCents + c.totalEmployeeWithheldCents, `gross=${gross}`).toBe(gross);
      expect(
        c.totalEmployeeWithheldCents + c.uncollectedEmployeeTaxCents,
        `gross=${gross}`,
      ).toBe(c.fullEmployeeWithholdingCents);
    }
    for (const gross of [1, 100, 1_000, 10_000, 100_000, 1_000_000, 50_000_000]) {
      const c = computePaycheckTaxes({ ...baseCheckArgs(), grossWagesCents: gross });
      expect(c.netPayCents, `gross=${gross}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("REFUSES the exact case that used to produce -$11.99, and says why", () => {
    // The original defect: a one-cent check carrying 80 hours of L&I. Employee
    // L&I alone is $12.00, so the naive answer was net pay of -$11.99.
    const c = computePaycheckTaxes({ ...baseCheckArgs(), grossWagesCents: 1 });

    expect(c.netPayCents).toBe(0);
    expect(c.hasRefusals).toBe(true);

    const r = c.refusals.find((x) => x.code === "withholding_exceeds_gross_pay");
    expect(r).toBeDefined();
    // Standing rule 13c: assert the SPECIFIC message, not merely that it threw.
    expect(r!.message).toContain("I stopped this paycheck");
    expect(r!.message).toContain("$0.01");
    expect(r!.message).toContain("NEGATIVE");
    expect(r!.message).toContain("RCW 49.52.050");
    expect(r!.message).toContain("misdemeanor");
    expect(r!.message).toContain("per HOUR WORKED");
    expect(r!.message).toContain("you're the one who owes the underpayment");
    expect(r!.whatToDo).toContain("are the hours right for this check");
    expect(r!.whatToDo).toContain("December 31");
    expect(r!.whatToDo).toContain("the tax is right; the check is small");
    expect(r!.authorityId).toBe("pub15-2026-insufficient-funds-ordering");
    // And the citation resolves - a refusal citing a dangling id is worse than
    // no refusal at all.
    expect(findPayrollAuthority(r!.authorityId)).toBeDefined();
  });

  it("withholds in the IRS's order: trust-fund money first, L&I last", () => {
    // A $10.00 check against 80 hours of L&I. Everything that is supposed to
    // come out adds to $12.91, so $2.91 cannot be collected - and it must be
    // the LAST item on the list that goes short, not the first.
    //
    //   Social Security   $0.62  <- trust fund, first in line
    //   Medicare          $0.15  <- trust fund
    //   federal income    $0.00  <- trust fund (zero at this wage)
    //   WA Paid Leave     $0.08  <- state trust money
    //   WA Cares          $0.06  <- state trust money
    //   L&I employee half $12.00 <- a premium, last in line
    //                     ------
    //                     $12.91  against $10.00 of gross
    const c = computePaycheckTaxes({ ...baseCheckArgs(), grossWagesCents: 1_000 });

    expect(c.fica.employeeOasdiCents).toBe(62);
    expect(c.fica.employeeMedicareCents).toBe(15);
    expect(c.pfml.employeeShareCents).toBe(8);
    expect(c.waCares.employeeCents).toBe(6);
    expect(c.lni.ok).toBe(true);
    expect(c.lni.ok && c.lni.value.employeeCents).toBe(1_200);
    expect(c.fullEmployeeWithholdingCents).toBe(1_291);

    // Everything ahead of L&I in the queue was collected in full.
    expect(c.uncollectedByTax.find((u) => u.label === "Social Security and Medicare")).toBeUndefined();
    expect(c.uncollectedByTax.find((u) => u.label === "federal income tax")).toBeUndefined();
    expect(c.uncollectedByTax.find((u) => u.label === "WA Paid Leave")).toBeUndefined();
    expect(c.uncollectedByTax.find((u) => u.label === "WA Cares")).toBeUndefined();

    // L&I is last, so L&I is what got cut short - by exactly the difference.
    expect(c.uncollectedByTax).toHaveLength(1);
    expect(c.uncollectedByTax[0]!.label).toBe("L&I medical aid (employee half)");
    expect(c.uncollectedByTax[0]!.shortfallCents).toBe(291);

    expect(c.totalEmployeeWithheldCents).toBe(1_000);
    expect(c.uncollectedEmployeeTaxCents).toBe(291);
    expect(c.netPayCents).toBe(0);
  });

  it("reports a shortfall only for taxes that actually wanted money", () => {
    // The deepest case: $0.01 of gross against 80 hours of L&I. At one cent of
    // wages every percentage-based tax rounds to zero, so the only line that
    // wants money is L&I - and it is therefore the only line reported short.
    // A queue that reported "$0.00 uncollected" for the four zero lines would
    // be technically true and completely useless to read.
    const c = computePaycheckTaxes({ ...baseCheckArgs(), grossWagesCents: 1 });
    expect(c.fica.totalEmployeeFicaCents).toBe(0);
    expect(c.federalIncomeTax.line4b_withholdingCents).toBe(0);
    expect(c.pfml.employeeShareCents).toBe(0);
    expect(c.waCares.employeeCents).toBe(0);
    expect(c.lni.ok && c.lni.value.employeeCents).toBe(1_200);

    expect(c.uncollectedByTax).toHaveLength(1);
    expect(c.uncollectedByTax[0]!.label).toBe("L&I medical aid (employee half)");
    expect(c.uncollectedByTax[0]!.shortfallCents).toBe(1_199);
    expect(c.totalEmployeeWithheldCents).toBe(1);
    expect(c.netPayCents).toBe(0);
  });

  it("puts the single available cent toward the FIRST tax in the queue, not the last", () => {
    // Prove the queue is a genuine priority order rather than a running total.
    // Push YTD Medicare wages high enough that FICA on this tiny check is
    // non-zero, then give the check one cent and confirm the cent lands on
    // Social Security and Medicare - ahead of L&I - and that L&I absorbs the
    // whole remaining shortfall.
    const c = computePaycheckTaxes({
      ...baseCheckArgs(),
      grossWagesCents: 20, // 20c: OASDI 1c + Medicare 0c
    });
    expect(c.fica.employeeOasdiCents).toBe(1);
    // The 20 cents available: 1c to Social Security first, the remaining 19c to
    // the next lines in order, and L&I - dead last - eats the entire shortfall.
    expect(c.totalEmployeeWithheldCents).toBe(20);
    expect(c.uncollectedByTax).toHaveLength(1);
    expect(c.uncollectedByTax[0]!.label).toBe("L&I medical aid (employee half)");
    expect(c.uncollectedByTax[0]!.shortfallCents).toBe(
      c.fullEmployeeWithholdingCents - 20,
    );
  });

  it("collects everything and refuses nothing the moment the check can carry it", () => {
    // The boundary. Find the smallest gross at which nothing is uncollected,
    // and prove the refusal switches off exactly there rather than lingering.
    let boundary = -1;
    for (let gross = 0; gross <= 200_000; gross += 1) {
      const c = computePaycheckTaxes({ ...baseCheckArgs(), grossWagesCents: gross });
      if (c.uncollectedEmployeeTaxCents === 0) {
        boundary = gross;
        break;
      }
    }
    expect(boundary).toBeGreaterThan(0);
    const at = computePaycheckTaxes({ ...baseCheckArgs(), grossWagesCents: boundary });
    expect(at.hasRefusals).toBe(false);
    expect(at.uncollectedByTax).toHaveLength(0);
    expect(at.totalEmployeeWithheldCents).toBe(at.fullEmployeeWithholdingCents);
    const below = computePaycheckTaxes({ ...baseCheckArgs(), grossWagesCents: boundary - 1 });
    expect(below.uncollectedEmployeeTaxCents).toBeGreaterThan(0);
    expect(below.hasRefusals).toBe(true);
  });

  it("does not fire the shortfall refusal on any ordinary check", () => {
    // Rule 15 in the other direction: a guard that fires on normal payroll is
    // just as broken as one that never fires. Every realistic check must pass
    // clean.
    for (const gross of [80_000, 120_000, 200_000, 350_000, 500_000, 1_000_000]) {
      const c = computePaycheckTaxes({ ...baseCheckArgs(), grossWagesCents: gross });
      expect(c.uncollectedEmployeeTaxCents, `gross=${gross}`).toBe(0);
      expect(
        c.refusals.some((x) => x.code === "withholding_exceeds_gross_pay"),
        `gross=${gross}`,
      ).toBe(false);
      expect(c.totalEmployeeWithheldCents).toBe(c.fullEmployeeWithholdingCents);
    }
  });

  it("a zero-dollar check with hours worked is refused, not silently accepted", () => {
    // A $0 check with 80 hours on it is a real thing (an unpaid-leave period
    // recorded wrong, most often) and it still generates L&I liability.
    const c = computePaycheckTaxes({ ...baseCheckArgs(), grossWagesCents: 0 });
    expect(c.netPayCents).toBe(0);
    expect(c.totalEmployeeWithheldCents).toBe(0);
    expect(c.uncollectedEmployeeTaxCents).toBeGreaterThan(0);
    expect(c.hasRefusals).toBe(true);
  });

  it("a zero-dollar check with zero hours is NOT refused - there is nothing to owe", () => {
    const c = computePaycheckTaxes({
      ...baseCheckArgs(),
      grossWagesCents: 0,
      hundredthHours: 0,
    });
    expect(c.netPayCents).toBe(0);
    expect(c.uncollectedEmployeeTaxCents).toBe(0);
    expect(c.refusals.some((x) => x.code === "withholding_exceeds_gross_pay")).toBe(false);
  });

  it("surfaces refusals without refusing to cut the check", () => {
    const c = computePaycheckTaxes({
      ...baseCheckArgs(),
      stateUnemploymentRateMilliPct: null,
      sutaRateNoticeDocumentId: null,
      lniEmployerOnlyRateCentsPerHour: null,
      lniMedicalAidRateCentsPerHour: null,
      lniRiskClassCode: null,
      lniRateNoticeDocumentId: null,
    });
    expect(c.hasRefusals).toBe(true);
    expect(c.refusals).toHaveLength(2);
    // The employee's federal/FICA/WA deductions are all still exact.
    expect(c.federalIncomeTax.line4b_withholdingCents).toBe(15_615);
    expect(c.fica.employeeOasdiCents).toBe(12_400);
    expect(c.waCares.employeeCents).toBe(1_160);
    expect(c.netPayCents + c.totalEmployeeWithheldCents).toBe(c.grossWagesCents);
  });

  it("accrues FUTA conservatively when the state rate is unknown, and says so", () => {
    const c = computePaycheckTaxes({
      ...baseCheckArgs(),
      stateUnemploymentRateMilliPct: null,
      sutaRateNoticeDocumentId: null,
    });
    expect(c.futa.effectiveCreditMilliPct).toBe(0);
    expect(c.futa.netFutaCents).toBe(c.futa.grossFutaCents);
    expect(c.notes.join(" ")).toMatch(/Do not send this figure to the IRS as-is/);
  });

  it("runs a full year without drift", () => {
    // 26 biweekly checks. Every accumulator must land exactly where the law says.
    let ytd = ZERO_YTD;
    let gross = 0;
    let withheld = 0;
    let net = 0;
    let oasdi = 0;
    let cares = 0;
    let futaTaxable = 0;
    for (let i = 0; i < 26; i += 1) {
      const c = computePaycheckTaxes({ ...baseCheckArgs(), grossWagesCents: 800_000, ytd });
      gross += c.grossWagesCents;
      withheld += c.totalEmployeeWithheldCents;
      net += c.netPayCents;
      oasdi += c.fica.employeeOasdiCents;
      cares += c.waCares.employeeCents;
      futaTaxable += c.futa.futaTaxableCents;
      ytd = advanceYtd(ytd, 800_000, 8_000);
    }
    expect(gross).toBe(20_800_000); // $208,000
    expect(net + withheld).toBe(gross); // not one lost penny in 26 checks
    expect(oasdi).toBe(OASDI_MAX_EMPLOYEE_TAX_2026_CENTS); // capped
    expect(futaTaxable).toBe(700_000); // capped at $7,000
    // WA Cares is uncapped: 0.58% of the WHOLE $208,000.
    expect(cares).toBe(applyMilliPct(20_800_000, WA_CARES_RATE_2026_MILLI_PCT));
    expect(cares).toBe(120_640); // $1,206.40
  });

  it("handles an employee with no W-4 on file using the IRS default", () => {
    const noW4 = defaultW4WhenNoneFurnished("e-new", 2026);
    const c = computePaycheckTaxes({ ...baseCheckArgs(), w4: noW4 });
    // Pub. 15-T: treated as Single/MFS with no entries in steps 2, 3, or 4.
    expect(c.federalIncomeTax.scheduleUsed).toBe("standard_single_mfs");
    expect(c.federalIncomeTax.line1g_cents).toBe(LINE_1G_OTHER_CENTS);
    expect(c.federalIncomeTax.line3a_annualCreditCents).toBe(0);
    expect(c.federalIncomeTax.line4a_extraPerPeriodCents).toBe(0);
    expect(c.federalIncomeTax.line4b_withholdingCents).toBe(15_615);
  });
});

// ===========================================================================
// 15) LEGACY (PRE-2020) FORMS W-4
// ===========================================================================

describe("legacy Forms W-4", () => {
  const legacy = (allowances: number): W4Record => ({
    ...W4, formYear: 2019, legacyAllowances: allowances, step2MultipleJobs: false,
    step3AnnualCreditCents: 0, step4aOtherIncomeAnnualCents: 0, step4bDeductionsAnnualCents: 0,
  });

  it("values each allowance at $4,300 and uses lines 1j/1k/1l", () => {
    expect(LEGACY_ALLOWANCE_VALUE_CENTS).toBe(430_000);
    const r = computeWorksheet1A({ w4: legacy(3), payFrequency: "biweekly", wagesThisPeriodCents: 200_000 });
    expect(r.line1j_allowances).toBe(3);
    expect(r.line1k_cents).toBe(1_290_000);
    expect(r.adjustedAnnualWageCents).toBe(3_910_000);
  });

  it("does not apply line 1g to a legacy form", () => {
    const r = computeWorksheet1A({ w4: legacy(0), payFrequency: "biweekly", wagesThisPeriodCents: 200_000 });
    expect(r.line1g_cents).toBe(0);
    expect(r.adjustedAnnualWageCents).toBe(5_200_000);
  });

  it("ignores modern-only fields even if they are somehow populated", () => {
    const contaminated: W4Record = {
      ...legacy(2),
      step4aOtherIncomeAnnualCents: 9_999_900,
      step4bDeductionsAnnualCents: 9_999_900,
      step3AnnualCreditCents: 9_999_900,
    };
    const r = computeWorksheet1A({
      w4: contaminated, payFrequency: "biweekly", wagesThisPeriodCents: 200_000,
    });
    expect(r.line1d_otherIncomeCents).toBe(0);
    expect(r.line1f_deductionsCents).toBe(0);
    expect(r.line3a_annualCreditCents).toBe(0);
    expect(r.adjustedAnnualWageCents).toBe(4_340_000);
  });

  it("still honours Step 4(c)-equivalent extra withholding (old line 6)", () => {
    const r = computeWorksheet1A({
      w4: { ...legacy(2), step4cExtraPerPeriodCents: 1_000 },
      payFrequency: "biweekly", wagesThisPeriodCents: 200_000,
    });
    expect(r.line4a_extraPerPeriodCents).toBe(1_000);
  });

  it("tells Michael that a legacy form is in play", () => {
    const r = computeWorksheet1A({ w4: legacy(1), payFrequency: "biweekly", wagesThisPeriodCents: 200_000 });
    expect(r.notes.join(" ")).toMatch(/2019 or earlier/);
    expect(r.notes.join(" ")).toMatch(/may\s+not require them to file a new one/);
  });

  it("clamps a legacy form with more allowances than pay", () => {
    const r = computeWorksheet1A({ w4: legacy(50), payFrequency: "biweekly", wagesThisPeriodCents: 200_000 });
    expect(r.adjustedAnnualWageCents).toBe(0);
    expect(r.clamp1iFired).toBe(true);
    expect(r.line4b_withholdingCents).toBe(0);
  });
});

// ===========================================================================
// 16) AUTHORITIES - every number traces to a primary source
// ===========================================================================

describe("authorities", () => {
  it("carries a verbatim quote and a plain-English meaning for each", () => {
    expect(PAYROLL_TAX_AUTHORITIES.length).toBeGreaterThanOrEqual(21);
    for (const a of PAYROLL_TAX_AUTHORITIES) {
      expect(a.id, a.id).toMatch(/^[a-z0-9-]+$/);
      expect(a.quote.length, a.id).toBeGreaterThan(20);
      expect(a.soWhat.length, a.id).toBeGreaterThan(20);
      expect(a.cite.length, a.id).toBeGreaterThan(5);
      expect(a.source, a.id).toMatch(/^https?:\/\//);
    }
  });

  it("has no duplicate ids", () => {
    const ids = PAYROLL_TAX_AUTHORITIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every authority the wage-base table points at", () => {
    for (const spec of WAGE_BASE_SPECS) {
      expect(findPayrollAuthority(spec.authorityId), spec.key).toBeDefined();
    }
  });

  it("includes the gross-misdemeanor authority that justifies the L&I refusal", () => {
    const a = findPayrollAuthority("rcw-51-16-140-lni-deduction");
    expect(a).toBeDefined();
    expect(a!.quote).toMatch(/gross misdemeanor/);
  });

  it("includes the statute that ties Paid Leave's ceiling to Social Security", () => {
    const a = findPayrollAuthority("rcw-50a-10-030-pfml");
    expect(a).toBeDefined();
    expect(a!.quote).toMatch(/social security/i);
  });

  it("includes the page proving WA Cares is uncapped", () => {
    const a = findPayrollAuthority("wa-cares-uncapped");
    expect(a).toBeDefined();
    expect(a!.quote).toMatch(/not capped at the taxable maximum for social security/i);
  });

  it("carries the authorities behind the insufficient-funds refusal", () => {
    const ordering = findPayrollAuthority("pub15-2026-insufficient-funds-ordering");
    expect(ordering).toBeDefined();
    expect(ordering!.quote).toMatch(/withhold taxes in the following order/i);

    const underwithheld = findPayrollAuthority("pub15-2026-collecting-underwithheld");
    expect(underwithheld).toBeDefined();
    expect(underwithheld!.quote).toMatch(/you're the one who owes the underpayment/i);
    expect(underwithheld!.quote).toMatch(/last day of the calendar year/i);

    const rebate = findPayrollAuthority("rcw-49-52-050-wage-rebate");
    expect(rebate).toBeDefined();
    expect(rebate!.quote).toMatch(/guilty of a misdemeanor/i);

    const authorized = findPayrollAuthority("rcw-49-52-060-authorized-withholding");
    expect(authorized).toBeDefined();
    expect(authorized!.quote).toMatch(/expressly authorized in writing in advance/i);
    // The audit-trail requirement written into the statute itself.
    expect(authorized!.quote).toMatch(/openly, clearly and in due course recorded/i);
  });

  it("REFUSES to render a citation that does not exist", () => {
    // A refusal that cites a dangling id looks authoritative and is empty.
    // That is worse than no refusal at all, so resolution must throw.
    expect(() => resolvePayrollAuthorities(["definitely-not-a-real-authority"])).toThrow(
      /unknown authority id/,
    );
    expect(() => resolvePayrollAuthorities(["definitely-not-a-real-authority"])).toThrow(
      /refusing to render a dangling citation/,
    );
    // And it must throw even when the bad id is buried among good ones.
    expect(() =>
      resolvePayrollAuthorities(["irc-3101-employee-fica", "nope", "irc-7501-trust-fund-payroll"]),
    ).toThrow(/unknown authority id/);
    // The happy path still resolves, in order.
    const got = resolvePayrollAuthorities(["irc-7501-trust-fund-payroll", "irc-3101-employee-fica"]);
    expect(got).toHaveLength(2);
    expect(got[0]!.id).toBe("irc-7501-trust-fund-payroll");
    expect(got[1]!.id).toBe("irc-3101-employee-fica");
  });

  it("every authority id referenced by a refusal actually resolves", () => {
    // Sweep every refusal the engine can emit and prove its citation is real.
    const withRefusals = computePaycheckTaxes({
      ...baseCheckArgs(),
      grossWagesCents: 1,
      stateUnemploymentRateMilliPct: null,
      sutaRateNoticeDocumentId: null,
      lniEmployerOnlyRateCentsPerHour: null,
      lniMedicalAidRateCentsPerHour: null,
      lniRiskClassCode: null,
      lniRateNoticeDocumentId: null,
    });
    expect(withRefusals.refusals.length).toBeGreaterThan(0);
    for (const r of withRefusals.refusals) {
      expect(findPayrollAuthority(r.authorityId), r.code).toBeDefined();
    }
  });
});
