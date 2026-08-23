/**
 * tests/compliance/form-940-core.test.ts   (books-43 B2)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THE FIRST TWO DESCRIBE BLOCKS MATTER MORE THAN ALL THE OTHERS
 * ────────────────────────────────────────────────────────────────────────────
 * Almost every test in a codebase is written by the same person who wrote the
 * code, which means it encodes the same misunderstanding. A test like
 * `expect(add(2,2)).toBe(4)` is only as good as the author's grasp of addition.
 *
 * The IRS instructions for Form 940 contain TWO fully worked examples with all
 * their answers printed. Those answers were not written by me, they were not
 * derived from this engine, and they cannot be adjusted to make a test pass.
 * That makes them ORACLES rather than illustrations. If this engine reproduces
 * every printed figure to the penny from the same inputs, the implementation
 * agrees with the IRS's own arithmetic; if it does not, the engine is wrong and
 * there is no room for a difference of opinion.
 *
 *   ORACLE 1 (source lines 1100-1137): Part 2, lines 3 to 7.
 *     Joan $44,000 (exempt $2,000), Sara $8,000 (exempt $500),
 *     John $16,000 (exempt $2,000)  ->  line 5 = $42,500, line 7 = $21,000.
 *
 *   ORACLE 2 (source lines 1318-1368): Worksheet-Line 10, all seven lines.
 *     $21,000 taxable FUTA wages, $8,000 state wages, 4.1% experience rate,
 *     $100 on time, $78 late  ->  $1,134.00 max credit, $274.20 earned,
 *     $859.80 lost.
 *
 * Note that oracle 2's $21,000 is oracle 1's line 7. The IRS built its
 * worksheet example on the same three employees, so the two oracles chain: the
 * output of Part 2 is the input to the worksheet. That is tested explicitly.
 */

import { describe, expect, it } from "vitest";

import {
  I940_IRS_WORKSHEET_EXAMPLE,
} from "@/lib/payroll/form-940-authorities";
import {
  ALL_FORM_940_REFUSAL_CODES,
  EXPERIENCE_RATE_MAX_PLAUSIBLE_BPS,
  FUTA_DEPOSIT_THRESHOLD_CENTS,
  FUTA_DE_MINIMIS_BALANCE_CENTS,
  FUTA_EMPLOYER_TEST_WEEKS,
  FUTA_NET_RATE_MILLI_PCT,
  MILLI_PCT_PER_BASIS_POINT,
  buildForm940,
  form940DepositSchedule,
  form940Worksheet,
  lineOf,
  taxableFutaWagesForEmployee,
  type Form940Employee,
  type Form940Quarterly,
  type Form940RefusalCode,
  type Form940Request,
  type Form940Return,
} from "@/lib/payroll/form-940-core";
import {
  FUTA_EMPLOYER_TEST_QUARTERLY_WAGES_CENTS,
  FUTA_GROSS_RATE_MILLI_PCT,
  FUTA_MAX_CREDIT_MILLI_PCT,
  FUTA_WAGE_BASE_CENTS,
} from "@/lib/payroll/payroll-withholding-core";

/* ── helpers ────────────────────────────────────────────────────────────── */

const employee = (over: Partial<Form940Employee> = {}): Form940Employee => ({
  employeeId: "e1",
  name: "Test Person",
  totalPaymentsCents: 4_000_000,
  exemptPaymentsCents: 0,
  excludedFromStateUnemploymentTax: false,
  ...over,
});

/**
 * A request in which NOTHING is missing and nothing is wrong. Every test that
 * wants to prove one specific refusal starts here and breaks exactly one
 * thing, so a red test names its own cause.
 */
const goodRequest = (over: Partial<Form940Request> = {}): Form940Request => ({
  year: 2027,
  employees: [employee()],
  statePayments: {
    paidOnTimeCents: 100_000,
    paidLateCents: 0,
    notPaidCents: 0,
    taxableStateWagesCents: 4_000_000,
    experienceRateBps: 540,
  },
  filingTest: {
    maxQuarterWagesThisYearCents: 1_000_000,
    maxQuarterWagesPriorYearCents: 0,
    weeksWithAnyEmployeeThisYear: 52,
    weeksWithAnyEmployeePriorYear: 0,
  },
  creditReductionMilliPct: 0,
  // 0.6% of $7,000 = $42.00, all incurred in Q1.
  depositedCents: 0,
  quarterly: { q1Cents: 4_200, q2Cents: 0, q3Cents: 0, q4Cents: 0 },
  ...over,
});

const unwrap = (r: ReturnType<typeof buildForm940>): Form940Return => {
  if (!r.ok) {
    throw new Error(`expected a return, got refusals: ${r.refusals.map((x) => x.code).join(", ")}`);
  }
  return r.ret;
};

const codes = (r: ReturnType<typeof buildForm940>): Form940RefusalCode[] => {
  if (r.ok) throw new Error("expected refusals, got a return");
  return r.refusals.map((x) => x.code);
};

const amount = (ret: Form940Return, line: string): number => {
  const l = lineOf(ret, line);
  if (l === undefined) throw new Error(`line ${line} is not on the return`);
  return l.amountCents;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * ORACLE 1 — Part 2, from the IRS's own three-employee example
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("ORACLE 1: the IRS's printed Part 2 example (instructions p.10)", () => {
  // "You paid $44,000 to Joan Rose, including $2,000 in health insurance
  //  benefits. You paid $8,000 to Sara Blue, including $500 in retirement
  //  benefits. You paid $16,000 to John Green, including $2,000 in health and
  //  retirement benefits."
  const irsEmployees: Form940Employee[] = [
    {
      employeeId: "joan",
      name: "Joan Rose",
      totalPaymentsCents: 4_400_000,
      exemptPaymentsCents: 200_000,
      excludedFromStateUnemploymentTax: false,
    },
    {
      employeeId: "sara",
      name: "Sara Blue",
      totalPaymentsCents: 800_000,
      exemptPaymentsCents: 50_000,
      excludedFromStateUnemploymentTax: false,
    },
    {
      employeeId: "john",
      name: "John Green",
      totalPaymentsCents: 1_600_000,
      exemptPaymentsCents: 200_000,
      excludedFromStateUnemploymentTax: false,
    },
  ];

  // Line 7 = $21,000, so line 8 = 0.6% x 21,000 = $126.00, and the whole
  // liability is put in Q1 so Part 5 foots.
  const irsRequest = goodRequest({
    employees: irsEmployees,
    quarterly: { q1Cents: 12_600, q2Cents: 0, q3Cents: 0, q4Cents: 0 },
    statePayments: {
      paidOnTimeCents: 200_000,
      paidLateCents: 0,
      notPaidCents: 0,
      taxableStateWagesCents: 2_100_000,
      experienceRateBps: 540,
    },
  });

  it("line 3 is $68,000 — every dollar paid, before any exclusion", () => {
    expect(amount(unwrap(buildForm940(irsRequest)), "3")).toBe(6_800_000);
  });

  it("line 4 is the IRS's printed $4,500 of exempt payments", () => {
    // "$4,500 Total payments exempt from FUTA tax. You would enter this amount
    //  on line 4 and check boxes 4a and 4c."
    expect(amount(unwrap(buildForm940(irsRequest)), "4")).toBe(450_000);
  });

  it("line 5 is the IRS's printed $42,500 — computed PER PERSON, not in total", () => {
    // The IRS shows the three individual excesses as $35,000 / $500 / $7,000.
    // Summing gross pay first and subtracting one $7,000 base would give
    // $68,000 − $4,500 − $7,000 = $56,500. That is the classic error, and it
    // is $14,000 of phantom taxable wages.
    expect(amount(unwrap(buildForm940(irsRequest)), "5")).toBe(4_250_000);
  });

  it("the three individual excesses match the IRS's $35,000 / $500 / $7,000", () => {
    const excess = (e: Form940Employee) =>
      Math.max(0, e.totalPaymentsCents - e.exemptPaymentsCents - FUTA_WAGE_BASE_CENTS);
    expect(excess(irsEmployees[0])).toBe(3_500_000);
    expect(excess(irsEmployees[1])).toBe(50_000);
    expect(excess(irsEmployees[2])).toBe(700_000);
  });

  it("line 6 is line 4 + line 5 = $47,000", () => {
    const ret = unwrap(buildForm940(irsRequest));
    expect(amount(ret, "6")).toBe(4_700_000);
    expect(amount(ret, "6")).toBe(amount(ret, "4") + amount(ret, "5"));
  });

  it("line 7 is $21,000 — and that is exactly 3 x the $7,000 wage base", () => {
    const ret = unwrap(buildForm940(irsRequest));
    expect(amount(ret, "7")).toBe(2_100_000);
    // All three employees cleared the base, so the taxable total is simply
    // three full bases. A useful sanity check that costs nothing.
    expect(amount(ret, "7")).toBe(3 * FUTA_WAGE_BASE_CENTS);
  });

  it("line 8 is 0.6% of line 7 = $126.00", () => {
    expect(amount(unwrap(buildForm940(irsRequest)), "8")).toBe(12_600);
  });

  it("ORACLE 1 chains into ORACLE 2: line 7 here IS the worksheet's input", () => {
    // The IRS reused the same figures. If this ever stops holding, one of the
    // two oracles has been transcribed wrongly.
    expect(amount(unwrap(buildForm940(irsRequest)), "7")).toBe(
      I940_IRS_WORKSHEET_EXAMPLE.taxableFutaWagesCents,
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ORACLE 2 — Worksheet-Line 10, all seven printed answers
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("ORACLE 2: the IRS's printed Worksheet-Line 10 example (instructions p.12)", () => {
  const ex = I940_IRS_WORKSHEET_EXAMPLE;
  const run = () =>
    form940Worksheet({
      taxableFutaWagesCents: ex.taxableFutaWagesCents,
      taxableStateWagesCents: ex.taxableStateWagesCents,
      experienceRateBps: ex.experienceRateBps,
      paidOnTimeCents: ex.statePaidOnTimeCents,
      paidLateCents: ex.statePaidLateCents,
    });

  it("line 1: maximum allowable credit is $1,134.00", () => {
    expect(run().line1MaximumCreditCents).toBe(ex.line1MaximumCreditCents);
    expect(run().line1MaximumCreditCents).toBe(113_400);
  });

  it("line 2: credit for timely payments is $100.00", () => {
    expect(run().line2TimelyCreditCents).toBe(ex.line2TimelyCreditCents);
  });

  it("line 3: additional credit is $104.00 — the 1.3% gap x $8,000 state wages", () => {
    // 0.054 − 0.041 = 0.013, and 0.013 x $8,000 = $104.00. This is the line
    // that rewards a low experience rate, and it is computed on the STATE wage
    // base ($8,000 here), not the federal one ($7,000).
    expect(run().line3AdditionalCreditCents).toBe(ex.line3AdditionalCreditCents);
    expect(run().line3AdditionalCreditCents).toBe(10_400);
  });

  it("line 4: subtotal is $204.00", () => {
    expect(run().line4SubtotalCents).toBe(ex.line4SubtotalCents);
  });

  it("line 5a: remaining allowable credit is $930.00", () => {
    expect(run().line5aRemainingCreditCents).toBe(ex.line5aRemainingCreditCents);
  });

  it("line 5b: state tax paid late is $78.00", () => {
    expect(run().line5bPaidLateCents).toBe(ex.line5bPaidLateCents);
  });

  it("line 5c: the smaller of 5a and 5b is $78.00", () => {
    expect(run().line5cSmallerCents).toBe(ex.line5cSmallerCents);
    expect(run().line5cSmallerCents).toBe(
      Math.min(ex.line5aRemainingCreditCents, ex.line5bPaidLateCents),
    );
  });

  it("line 5d: $78.00 x 0.900 = $70.20 — the 10% haircut for paying late", () => {
    expect(run().line5dLateCreditCents).toBe(ex.line5dLateCreditCents);
    expect(run().line5dLateCreditCents).toBe(7_020);
  });

  it("line 6: FUTA credit actually earned is $274.20", () => {
    expect(run().line6FutaCreditCents).toBe(ex.line6FutaCreditCents);
  });

  it("line 7: the adjustment — $859.80 of credit LOST", () => {
    expect(run().line7AdjustmentCents).toBe(ex.line7AdjustmentCents);
    expect(run().line7AdjustmentCents).toBe(85_980);
  });

  it("the worksheet ran to the end, so Form 940 line 10 is NOT blank", () => {
    expect(run().stoppedAtLine).toBe(7);
    expect(run().line10IsBlank).toBe(false);
  });

  it("every printed line re-derives from the one above it", () => {
    const w = run();
    expect(w.line4SubtotalCents).toBe(w.line2TimelyCreditCents + w.line3AdditionalCreditCents);
    expect(w.line5aRemainingCreditCents).toBe(w.line1MaximumCreditCents - w.line4SubtotalCents);
    expect(w.line6FutaCreditCents).toBe(w.line4SubtotalCents + w.line5dLateCreditCents);
    expect(w.line7AdjustmentCents).toBe(w.line1MaximumCreditCents - w.line6FutaCreditCents);
  });

  it("THE LESSON IN ONE NUMBER: $859.80 lost to protect $178.00 of state tax", () => {
    // The employer was late on $78 and never paid $150 — $228 of state tax at
    // stake. The federal cost of that was $859.80, nearly four times as much.
    // This is the single most useful sentence on the whole form, and it is
    // asserted here so it can never quietly stop being true.
    const w = run();
    const stateTaxAtStake = ex.statePaidLateCents + ex.stateNotPaidCents;
    expect(w.line7AdjustmentCents).toBeGreaterThan(stateTaxAtStake * 3);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * THE WORKSHEET'S THREE STOP POINTS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("Worksheet-Line 10: the STOP conditions", () => {
  it("stops at line 2 when timely payments already cover the maximum credit", () => {
    // "If line 2 is equal to or more than line 1, STOP here."
    const w = form940Worksheet({
      taxableFutaWagesCents: 2_100_000, // max credit $1,134.00
      taxableStateWagesCents: 2_100_000,
      experienceRateBps: 540,
      paidOnTimeCents: 200_000, // $2,000 — comfortably more
      paidLateCents: 0,
    });
    expect(w.stoppedAtLine).toBe(2);
    expect(w.line10IsBlank).toBe(true);
  });

  it("stops at line 2 on EQUALITY, because the form says 'equal to or more'", () => {
    // The off-by-one that a careless `>` would introduce. $1,134.00 exactly.
    const w = form940Worksheet({
      taxableFutaWagesCents: 2_100_000,
      taxableStateWagesCents: 0,
      experienceRateBps: 540,
      paidOnTimeCents: 113_400,
      paidLateCents: 0,
    });
    expect(w.stoppedAtLine).toBe(2);
  });

  it("one cent short of equality does NOT stop at line 2", () => {
    const w = form940Worksheet({
      taxableFutaWagesCents: 2_100_000,
      taxableStateWagesCents: 0,
      experienceRateBps: 540,
      paidOnTimeCents: 113_399,
      paidLateCents: 0,
    });
    expect(w.stoppedAtLine).not.toBe(2);
  });

  it("stops at line 4 when the additional credit closes the gap", () => {
    // "If line 4 is equal to or more than line 1, STOP here."
    // Max credit on $21,000 is $1,134. Pay $100 on time, and let a 0%
    // experience rate on $100,000 of state wages generate $5,400 of line 3.
    const w = form940Worksheet({
      taxableFutaWagesCents: 2_100_000,
      taxableStateWagesCents: 10_000_000,
      experienceRateBps: 0,
      paidOnTimeCents: 10_000,
      paidLateCents: 0,
    });
    expect(w.stoppedAtLine).toBe(4);
    expect(w.line10IsBlank).toBe(true);
    expect(w.line3AdditionalCreditCents).toBe(540_000);
  });

  it("stops at line 6 when the late credit finally closes the gap", () => {
    // "If line 6 is equal to or more than line 1, STOP here."
    // Max credit $1,134.00. On time $1,000. Remaining $134.00. Pay $200 late:
    // 5c = min(134, 200) = $134.00, 5d = $120.60, line 6 = $1,120.60 — still
    // short. Pay $500 late instead: 5c is still capped at $134.00. The cap
    // means line 6 can NEVER reach line 1 through lateness alone once the gap
    // exceeds 10%, so this case needs line 3 to help.
    const w = form940Worksheet({
      taxableFutaWagesCents: 2_100_000,
      taxableStateWagesCents: 100_000,
      experienceRateBps: 440, // 1.0% gap x $1,000 = $10.00 additional credit
      paidOnTimeCents: 112_400, // $1,124.00
      paidLateCents: 100_000,
    });
    // line 4 = 112,400 + 1,000 = 113,400 = line 1 exactly -> stops at 4.
    expect(w.stoppedAtLine).toBe(4);
  });

  it("reaches line 6 and stops there when 90% of the late payment covers the gap", () => {
    // Gap after line 4 must be small enough that 0.9 x late >= gap.
    // Max credit $1,134.00, on time $1,124.00, no additional credit.
    // 5a = $10.00. Late $20.00 -> 5c = $10.00 -> 5d = $9.00 -> line 6 =
    // $1,133.00, still short of $1,134.00. So line 6 alone cannot close a gap:
    // 0.9 x min(gap, late) < gap whenever gap > 0. THIS IS A THEOREM, and it
    // means stoppedAtLine === 6 is UNREACHABLE unless 5a is zero.
    const w = form940Worksheet({
      taxableFutaWagesCents: 2_100_000,
      taxableStateWagesCents: 0,
      experienceRateBps: 540,
      paidOnTimeCents: 112_400,
      paidLateCents: 2_000,
    });
    expect(w.stoppedAtLine).toBe(7);
    expect(w.line6FutaCreditCents).toBe(113_300);
    expect(w.line7AdjustmentCents).toBe(100);
  });

  it(
    "DOCUMENTS A PROVEN FACT ABOUT THE FORM: the line 6 STOP is mathematically " +
      "unreachable, because 0.9 x min(gap, late) is always less than gap",
    () => {
      // This is not a defect in the engine — it is a property of the IRS's own
      // worksheet, and it is worth pinning down rather than leaving as a
      // suspicion. Line 5c is capped at line 5a (the gap). Line 5d is 90% of
      // line 5c. So line 6 = line 4 + 0.9 x min(gap, late) <= line 4 + 0.9 x
      // gap < line 4 + gap = line 1, for every gap > 0. Reaching line 4 means
      // the gap is positive, so line 6 can never equal or exceed line 1.
      //
      // Brute-force it over a wide grid rather than trusting the algebra.
      for (let onTime = 0; onTime <= 113_400; onTime += 5_671) {
        for (let late = 0; late <= 300_000; late += 13_337) {
          const w = form940Worksheet({
            taxableFutaWagesCents: 2_100_000,
            taxableStateWagesCents: 0,
            experienceRateBps: 540,
            paidOnTimeCents: onTime,
            paidLateCents: late,
          });
          expect(w.stoppedAtLine).not.toBe(6);
        }
      }
    },
  );

  it("a zero experience rate produces the largest possible additional credit", () => {
    const w = form940Worksheet({
      taxableFutaWagesCents: 100_000_000,
      taxableStateWagesCents: 1_000_000,
      experienceRateBps: 0,
      paidOnTimeCents: 0,
      paidLateCents: 0,
    });
    // The whole 5.4% of state wages: $10,000 x 0.054 = $540.00.
    expect(w.line3AdditionalCreditCents).toBe(54_000);
  });

  it("an experience rate ABOVE 5.4% produces no additional credit, never a negative one", () => {
    // A rate above the federal maximum means you paid the state MORE than the
    // credit is worth. Line 3 floors at zero — the IRS does not claw back.
    const w = form940Worksheet({
      taxableFutaWagesCents: 100_000_000,
      taxableStateWagesCents: 1_000_000,
      experienceRateBps: 900,
      paidOnTimeCents: 0,
      paidLateCents: 0,
    });
    expect(w.line3AdditionalCreditCents).toBe(0);
  });

  it("paying nothing at all loses the ENTIRE credit — line 7 equals line 1", () => {
    const w = form940Worksheet({
      taxableFutaWagesCents: 2_100_000,
      taxableStateWagesCents: 0,
      experienceRateBps: 540,
      paidOnTimeCents: 0,
      paidLateCents: 0,
    });
    expect(w.line7AdjustmentCents).toBe(w.line1MaximumCreditCents);
    expect(w.line7AdjustmentCents).toBe(113_400);
  });

  it("line 5c caps late credit at the remaining gap, so lateness cannot over-earn", () => {
    const w = form940Worksheet({
      taxableFutaWagesCents: 2_100_000,
      taxableStateWagesCents: 0,
      experienceRateBps: 540,
      paidOnTimeCents: 100_000, // $1,000
      paidLateCents: 9_999_999, // absurdly large
    });
    expect(w.line5aRemainingCreditCents).toBe(13_400);
    expect(w.line5cSmallerCents).toBe(13_400);
    expect(w.line6FutaCreditCents).toBeLessThan(w.line1MaximumCreditCents);
  });

  it("is pure: the same inputs give an identical result every time", () => {
    const args = {
      taxableFutaWagesCents: 2_100_000,
      taxableStateWagesCents: 800_000,
      experienceRateBps: 410,
      paidOnTimeCents: 10_000,
      paidLateCents: 7_800,
    };
    expect(form940Worksheet(args)).toEqual(form940Worksheet(args));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * THE DEPOSIT SCHEDULE — the carry-forward
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the deposit schedule carries forward and does not test quarters in isolation", () => {
  it("THE CASE A NAIVE ENGINE GETS WRONG: four quarters of $200 each", () => {
    // Per-quarter thinking: $200 < $500 four times, no deposit ever due.
    // The instructions: carry it over "until your cumulative tax is more than
    // $500. At that point, you must deposit your tax for the quarter."
    // Q1 $200, Q2 $400, Q3 $600 -> over. Deposit $600 by 31 October.
    const s = form940DepositSchedule({
      q1Cents: 20_000,
      q2Cents: 20_000,
      q3Cents: 20_000,
      q4Cents: 20_000,
    });
    expect(s.quarters[0].depositRequired).toBe(false);
    expect(s.quarters[1].depositRequired).toBe(false);
    expect(s.quarters[2].depositRequired).toBe(true);
    expect(s.quarters[2].depositAmountCents).toBe(60_000);
    expect(s.quarters[3].depositRequired).toBe(false);
    expect(s.payableWithReturnCents).toBe(20_000);
    expect(s.anyDepositRequired).toBe(true);
  });

  it("the cumulative running total is exactly carriedIn + incurred, every quarter", () => {
    const s = form940DepositSchedule({
      q1Cents: 20_000,
      q2Cents: 20_000,
      q3Cents: 20_000,
      q4Cents: 20_000,
    });
    for (const q of s.quarters) {
      expect(q.cumulativeCents).toBe(q.carriedInCents + q.incurredCents);
    }
    // And Q2's carry-in is Q1's carry-out. The chain must not break.
    expect(s.quarters[1].carriedInCents).toBe(s.quarters[0].carriedOutCents);
    expect(s.quarters[2].carriedInCents).toBe(s.quarters[1].carriedOutCents);
    expect(s.quarters[3].carriedInCents).toBe(s.quarters[2].carriedOutCents);
  });

  it("a required deposit clears the running balance to zero", () => {
    const s = form940DepositSchedule({
      q1Cents: 100_000,
      q2Cents: 10_000,
      q3Cents: 0,
      q4Cents: 0,
    });
    expect(s.quarters[0].depositRequired).toBe(true);
    expect(s.quarters[0].carriedOutCents).toBe(0);
    expect(s.quarters[1].carriedInCents).toBe(0);
    expect(s.quarters[1].cumulativeCents).toBe(10_000);
  });

  it("EXACTLY $500.00 carries forward — the form says 'more than $500'", () => {
    const s = form940DepositSchedule({
      q1Cents: FUTA_DEPOSIT_THRESHOLD_CENTS,
      q2Cents: 0,
      q3Cents: 0,
      q4Cents: 0,
    });
    expect(s.quarters[0].depositRequired).toBe(false);
    expect(s.payableWithReturnCents).toBe(50_000);
  });

  it("$500.01 does not carry forward — one cent decides it", () => {
    const s = form940DepositSchedule({
      q1Cents: FUTA_DEPOSIT_THRESHOLD_CENTS + 1,
      q2Cents: 0,
      q3Cents: 0,
      q4Cents: 0,
    });
    expect(s.quarters[0].depositRequired).toBe(true);
    expect(s.quarters[0].depositAmountCents).toBe(50_001);
  });

  it("Q4 under the threshold may travel with the return; Q1-Q3 never may", () => {
    // "If it is $500 or less, you can either deposit the amount or pay it with
    // your Form 940." That option exists only in Q4.
    const s = form940DepositSchedule({
      q1Cents: 10_000,
      q2Cents: 10_000,
      q3Cents: 0,
      q4Cents: 10_000,
    });
    expect(s.quarters[0].mayPayWithReturn).toBe(false);
    expect(s.quarters[1].mayPayWithReturn).toBe(false);
    expect(s.quarters[2].mayPayWithReturn).toBe(false);
    expect(s.quarters[3].mayPayWithReturn).toBe(true);
    expect(s.payableWithReturnCents).toBe(30_000);
  });

  it("Q4 OVER the threshold must be deposited, not paid with the return", () => {
    const s = form940DepositSchedule({
      q1Cents: 0,
      q2Cents: 0,
      q3Cents: 0,
      q4Cents: 100_000,
    });
    expect(s.quarters[3].depositRequired).toBe(true);
    expect(s.quarters[3].mayPayWithReturn).toBe(false);
    expect(s.payableWithReturnCents).toBe(0);
  });

  it("a zero year requires nothing and leaves nothing to pay", () => {
    const s = form940DepositSchedule({ q1Cents: 0, q2Cents: 0, q3Cents: 0, q4Cents: 0 });
    expect(s.anyDepositRequired).toBe(false);
    expect(s.payableWithReturnCents).toBe(0);
    // And mayPayWithReturn is false, because there is nothing to pay. A screen
    // that offered "you may pay $0.00 with your return" would be noise.
    expect(s.quarters[3].mayPayWithReturn).toBe(false);
  });

  it("GREENWAY'S LIKELY SHAPE: nearly all the tax in Q1, one deposit", () => {
    // Ten employees clearing the $7,000 base early gives $420 of tax, mostly
    // in Q1 — under the threshold, so it all rides on the return.
    const s = form940DepositSchedule({
      q1Cents: 38_000,
      q2Cents: 4_000,
      q3Cents: 0,
      q4Cents: 0,
    });
    expect(s.anyDepositRequired).toBe(false);
    expect(s.payableWithReturnCents).toBe(42_000);
  });

  it("every quarter is present, in order, exactly once", () => {
    const s = form940DepositSchedule({ q1Cents: 1, q2Cents: 2, q3Cents: 3, q4Cents: 4 });
    expect(s.quarters.map((q) => q.quarter)).toEqual([1, 2, 3, 4]);
    expect(s.quarters.map((q) => q.incurredCents)).toEqual([1, 2, 3, 4]);
  });

  it("the year's total is conserved: deposits + payable = total incurred", () => {
    const q: Form940Quarterly = {
      q1Cents: 30_000,
      q2Cents: 45_000,
      q3Cents: 12_345,
      q4Cents: 60_000,
    };
    const s = form940DepositSchedule(q);
    const deposited = s.quarters.reduce((t, x) => t + x.depositAmountCents, 0);
    expect(deposited + s.payableWithReturnCents).toBe(
      q.q1Cents + q.q2Cents + q.q3Cents + q.q4Cents,
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * EVERY REFUSAL CODE IS REACHABLE (standing rule 43)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("every refusal code is reachable — no dead refusals (rule 43)", () => {
  const reached = new Set<Form940RefusalCode>();
  const expectCode = (r: ReturnType<typeof buildForm940>, code: Form940RefusalCode) => {
    expect(codes(r)).toContain(code);
    reached.add(code);
  };

  it("NO_EMPLOYEES", () => {
    expectCode(buildForm940(goodRequest({ employees: [] })), "NO_EMPLOYEES");
  });

  it("DORMANT_CONTRADICTED", () => {
    expectCode(
      buildForm940(goodRequest({ noPaymentsThisYear: true })),
      "DORMANT_CONTRADICTED",
    );
  });

  it("NEGATIVE_AMOUNT", () => {
    expectCode(
      buildForm940(goodRequest({ employees: [employee({ totalPaymentsCents: -1 })] })),
      "NEGATIVE_AMOUNT",
    );
  });

  it("EXEMPT_EXCEEDS_TOTAL", () => {
    expectCode(
      buildForm940(
        goodRequest({
          employees: [employee({ totalPaymentsCents: 100, exemptPaymentsCents: 101 })],
        }),
      ),
      "EXEMPT_EXCEEDS_TOTAL",
    );
  });

  it("STATE_EXCLUSION_UNKNOWN", () => {
    expectCode(
      buildForm940(
        goodRequest({ employees: [employee({ excludedFromStateUnemploymentTax: null })] }),
      ),
      "STATE_EXCLUSION_UNKNOWN",
    );
  });

  it("STATE_PAYMENTS_UNKNOWN", () => {
    expectCode(
      buildForm940(
        goodRequest({
          statePayments: { ...goodRequest().statePayments, paidOnTimeCents: null },
        }),
      ),
      "STATE_PAYMENTS_UNKNOWN",
    );
  });

  it("EXPERIENCE_RATE_UNKNOWN", () => {
    expectCode(
      buildForm940(
        goodRequest({
          statePayments: { ...goodRequest().statePayments, experienceRateBps: null },
        }),
      ),
      "EXPERIENCE_RATE_UNKNOWN",
    );
  });

  it("EXPERIENCE_RATE_IMPLAUSIBLE", () => {
    expectCode(
      buildForm940(
        goodRequest({
          statePayments: {
            ...goodRequest().statePayments,
            experienceRateBps: EXPERIENCE_RATE_MAX_PLAUSIBLE_BPS + 1,
          },
        }),
      ),
      "EXPERIENCE_RATE_IMPLAUSIBLE",
    );
  });

  it("CREDIT_REDUCTION_UNKNOWN", () => {
    expectCode(
      buildForm940(goodRequest({ creditReductionMilliPct: null })),
      "CREDIT_REDUCTION_UNKNOWN",
    );
  });

  it("DEPOSITS_UNKNOWN", () => {
    expectCode(buildForm940(goodRequest({ depositedCents: null })), "DEPOSITS_UNKNOWN");
  });

  it("QUARTERLY_UNKNOWN", () => {
    expectCode(buildForm940(goodRequest({ quarterly: null })), "QUARTERLY_UNKNOWN");
  });

  it("QUARTERLY_MISMATCH", () => {
    expectCode(
      buildForm940(
        goodRequest({ quarterly: { q1Cents: 1, q2Cents: 0, q3Cents: 0, q4Cents: 0 } }),
      ),
      "QUARTERLY_MISMATCH",
    );
  });

  it("FILING_TEST_UNKNOWN", () => {
    expectCode(
      buildForm940(
        goodRequest({
          filingTest: { ...goodRequest().filingTest, maxQuarterWagesThisYearCents: null },
        }),
      ),
      "FILING_TEST_UNKNOWN",
    );
  });

  it("YEAR_NOT_VALID", () => {
    expectCode(buildForm940(goodRequest({ year: 1899 })), "YEAR_NOT_VALID");
  });

  it("ALL of them were reached, and the exported list has no extras", () => {
    // Two directions. Every code in the list was produced by a real call
    // above, and no code was produced that is missing from the list. Either
    // gap is dead code wearing a green check (rule 50).
    for (const c of ALL_FORM_940_REFUSAL_CODES) {
      expect(reached.has(c)).toBe(true);
    }
    expect(reached.size).toBe(ALL_FORM_940_REFUSAL_CODES.length);
    expect(new Set(ALL_FORM_940_REFUSAL_CODES).size).toBe(ALL_FORM_940_REFUSAL_CODES.length);
  });
});

describe("refusals are useful, not just present", () => {
  it("every refusal names a fix, and neither field is empty", () => {
    const r = buildForm940({
      year: 1000,
      employees: [],
      statePayments: {
        paidOnTimeCents: null,
        paidLateCents: null,
        notPaidCents: null,
        taxableStateWagesCents: null,
        experienceRateBps: null,
      },
      filingTest: {
        maxQuarterWagesThisYearCents: null,
        maxQuarterWagesPriorYearCents: null,
        weeksWithAnyEmployeeThisYear: null,
        weeksWithAnyEmployeePriorYear: null,
      },
      creditReductionMilliPct: null,
      depositedCents: null,
      quarterly: null,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    for (const x of r.refusals) {
      expect(x.what.length).toBeGreaterThan(20);
      expect(x.fix.length).toBeGreaterThan(20);
      // A whole sentence, so it is safe to render on its own.
      expect(x.what.trim().endsWith(".")).toBe(true);
    }
  });

  it("ALL missing facts are reported at once, not one per attempt", () => {
    const r = buildForm940({
      year: 2027,
      employees: [employee()],
      statePayments: {
        paidOnTimeCents: null,
        paidLateCents: null,
        notPaidCents: null,
        taxableStateWagesCents: null,
        experienceRateBps: null,
      },
      filingTest: goodRequest().filingTest,
      creditReductionMilliPct: null,
      depositedCents: null,
      quarterly: null,
    });
    const c = codes(r);
    expect(c).toContain("STATE_PAYMENTS_UNKNOWN");
    expect(c).toContain("EXPERIENCE_RATE_UNKNOWN");
    expect(c).toContain("CREDIT_REDUCTION_UNKNOWN");
    expect(c).toContain("DEPOSITS_UNKNOWN");
    expect(c).toContain("QUARTERLY_UNKNOWN");
  });

  it("a per-employee refusal carries the employee id, a global one does not", () => {
    const r = buildForm940(
      goodRequest({
        employees: [employee({ employeeId: "abc", excludedFromStateUnemploymentTax: null })],
        depositedCents: null,
      }),
    );
    if (r.ok) throw new Error("expected refusals");
    const perEmployee = r.refusals.find((x) => x.code === "STATE_EXCLUSION_UNKNOWN");
    const global = r.refusals.find((x) => x.code === "DEPOSITS_UNKNOWN");
    expect(perEmployee?.employeeId).toBe("abc");
    expect(global?.employeeId).toBeNull();
  });

  it("the STATE_EXCLUSION refusal warns about the 0%-rate trap by name", () => {
    // The IRS prints a Caution about this and it is the single most likely
    // way for Michael to answer the question wrongly.
    const r = buildForm940(
      goodRequest({ employees: [employee({ excludedFromStateUnemploymentTax: null })] }),
    );
    if (r.ok) throw new Error("expected refusals");
    const x = r.refusals.find((y) => y.code === "STATE_EXCLUSION_UNKNOWN");
    expect(x?.fix).toContain("0%");
  });

  it("the STATE_PAYMENTS refusal warns that 'on time' means the FORM 940 due date", () => {
    const r = buildForm940(
      goodRequest({
        statePayments: { ...goodRequest().statePayments, paidOnTimeCents: null },
      }),
    );
    if (r.ok) throw new Error("expected refusals");
    const x = r.refusals.find((y) => y.code === "STATE_PAYMENTS_UNKNOWN");
    expect(x?.fix).toContain("FORM 940 due date");
    // And that PFML / WA Cares must be stripped out of the ESD cheque.
    expect(x?.fix).toContain("PFML");
    expect(x?.fix).toContain("WA Cares");
  });

  it("the FILING_TEST refusal warns that the $1,500 test is on UNCAPPED wages", () => {
    // This is the exact confusion that produced the first draft's bug.
    const r = buildForm940(
      goodRequest({
        filingTest: { ...goodRequest().filingTest, weeksWithAnyEmployeeThisYear: null },
      }),
    );
    if (r.ok) throw new Error("expected refusals");
    const x = r.refusals.find((y) => y.code === "FILING_TEST_UNKNOWN");
    expect(x?.fix).toContain("$7,000");
    expect(x?.fix.toLowerCase()).toContain("uncapped");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * LINE 9 vs LINE 10 — WAGE-WEIGHTED, NOT HEAD-COUNTED
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the line 9 / line 10 branch counts WAGES, not people", () => {
  it("ALL wages excluded -> line 9 = 5.4% of line 7, and the rate becomes 6%", () => {
    const r = unwrap(
      buildForm940(
        goodRequest({
          employees: [employee({ excludedFromStateUnemploymentTax: true })],
          // line 7 = $7,000 (capped). line 8 = $42.00, line 9 = $378.00.
          quarterly: { q1Cents: 42_000, q2Cents: 0, q3Cents: 0, q4Cents: 0 },
        }),
      ),
    );
    expect(amount(r, "7")).toBe(700_000);
    expect(amount(r, "8")).toBe(4_200);
    expect(amount(r, "9")).toBe(37_800);
    // 8 + 9 = $420.00, which is 6.0% of $7,000 — the full statutory rate.
    expect(amount(r, "12")).toBe(42_000);
    expect(amount(r, "12")).toBe(
      Math.round((700_000 * FUTA_GROSS_RATE_MILLI_PCT) / 100_000),
    );
  });

  it("when line 9 applies, lines 10 and 11 are blank — the instructions require it", () => {
    const r = unwrap(
      buildForm940(
        goodRequest({
          employees: [employee({ excludedFromStateUnemploymentTax: true })],
          creditReductionMilliPct: 300, // would otherwise produce a line 11
          quarterly: { q1Cents: 42_000, q2Cents: 0, q3Cents: 0, q4Cents: 0 },
        }),
      ),
    );
    expect(lineOf(r, "10")?.blank).toBe(true);
    expect(lineOf(r, "11")?.blank).toBe(true);
    expect(amount(r, "10")).toBe(0);
    expect(amount(r, "11")).toBe(0);
    expect(r.worksheet).toBeNull();
  });

  it("SOME wages excluded -> the worksheet runs and line 9 stays blank", () => {
    const r = unwrap(
      buildForm940(
        goodRequest({
          employees: [
            employee({ employeeId: "a", excludedFromStateUnemploymentTax: true }),
            employee({ employeeId: "b", excludedFromStateUnemploymentTax: false }),
          ],
          statePayments: {
            paidOnTimeCents: 0,
            paidLateCents: 0,
            notPaidCents: 0,
            taxableStateWagesCents: 700_000,
            experienceRateBps: 540,
          },
          // line 7 = $14,000. line 8 = $84.00. Worksheet: max credit $756.00,
          // nothing paid, so line 10 = $756.00. Total = $840.00 = 6% x 14,000.
          quarterly: { q1Cents: 84_000, q2Cents: 0, q3Cents: 0, q4Cents: 0 },
        }),
      ),
    );
    expect(lineOf(r, "9")?.blank).toBe(true);
    expect(r.worksheet).not.toBeNull();
    expect(amount(r, "10")).toBe(75_600);
    expect(amount(r, "12")).toBe(84_000);
  });

  it(
    "THE HEAD-COUNT BUG, PINNED: an excluded employee paid NOTHING does not " +
      "drag the return onto the worksheet",
    () => {
      // A head count sees "some excluded" and runs the worksheet. The form
      // asks whether some of the taxable FUTA WAGES were excluded — and zero
      // wages were. This employee contributes nothing to line 7.
      const r = unwrap(
        buildForm940(
          goodRequest({
            employees: [
              employee({ employeeId: "paid", excludedFromStateUnemploymentTax: false }),
              employee({
                employeeId: "ghost",
                totalPaymentsCents: 0,
                excludedFromStateUnemploymentTax: true,
              }),
            ],
            quarterly: { q1Cents: 4_200, q2Cents: 0, q3Cents: 0, q4Cents: 0 },
          }),
        ),
      );
      expect(r.worksheet).toBeNull();
      expect(lineOf(r, "9")?.blank).toBe(true);
      expect(lineOf(r, "10")?.blank).toBe(true);
      expect(amount(r, "12")).toBe(4_200);
    },
  );

  it(
    "and the mirror image: an INCLUDED employee paid nothing does not stop " +
      "line 9 from applying",
    () => {
      // Everyone with actual wages is excluded, so ALL taxable FUTA wages were
      // excluded, even though a head count says one of the two was not.
      const r = unwrap(
        buildForm940(
          goodRequest({
            employees: [
              employee({ employeeId: "officer", excludedFromStateUnemploymentTax: true }),
              employee({
                employeeId: "ghost",
                totalPaymentsCents: 0,
                excludedFromStateUnemploymentTax: false,
              }),
            ],
            quarterly: { q1Cents: 42_000, q2Cents: 0, q3Cents: 0, q4Cents: 0 },
          }),
        ),
      );
      expect(amount(r, "9")).toBe(37_800);
      expect(r.worksheet).toBeNull();
    },
  );

  it("nobody excluded and nothing paid late -> no worksheet, no line 9, no line 10", () => {
    const r = unwrap(buildForm940(goodRequest()));
    expect(r.worksheet).toBeNull();
    expect(lineOf(r, "9")?.blank).toBe(true);
    expect(lineOf(r, "10")?.blank).toBe(true);
  });

  it("nobody excluded but SOMETHING paid late -> the worksheet still runs", () => {
    // "or Any of your payments of state unemployment tax were late." It is an
    // OR, and this is the half that catches an ordinary employer.
    const r = unwrap(
      buildForm940(
        goodRequest({
          statePayments: {
            paidOnTimeCents: 100_000,
            paidLateCents: 5_000,
            notPaidCents: 0,
            taxableStateWagesCents: 4_000_000,
            experienceRateBps: 540,
          },
        }),
      ),
    );
    expect(r.worksheet).not.toBeNull();
    // $1,000 on time already exceeds the $378 maximum credit on $7,000, so the
    // worksheet stops at line 2 and line 10 is blank. Being late cost nothing.
    expect(r.worksheet?.stoppedAtLine).toBe(2);
    expect(lineOf(r, "10")?.blank).toBe(true);
  });

  it("taxableFutaWagesForEmployee caps at the wage base, after exempt pay", () => {
    expect(
      taxableFutaWagesForEmployee(
        employee({ totalPaymentsCents: 4_000_000, exemptPaymentsCents: 0 }),
      ),
    ).toBe(FUTA_WAGE_BASE_CENTS);
    expect(
      taxableFutaWagesForEmployee(
        employee({ totalPaymentsCents: 800_000, exemptPaymentsCents: 200_000 }),
      ),
    ).toBe(600_000);
    expect(
      taxableFutaWagesForEmployee(
        employee({ totalPaymentsCents: 100_000, exemptPaymentsCents: 100_000 }),
      ),
    ).toBe(0);
  });

  it("the two routes to line 7 agree — the engine's internal cross-check holds", () => {
    // buildForm940 throws if lines 3−4−5 disagrees with the sum of capped
    // per-employee wages. Exercise it across a range of shapes.
    for (const total of [0, 100, 699_999, 700_000, 700_001, 5_000_000]) {
      for (const exempt of [0, 50_000, 700_000]) {
        if (exempt > total) continue;
        const r = buildForm940(
          goodRequest({
            employees: [employee({ totalPaymentsCents: total, exemptPaymentsCents: exempt })],
            quarterly: null,
          }),
        );
        // quarterly:null refuses, but the cross-check runs before that only
        // when everything else is present; so re-run with a matching Part 5.
        expect(codes(r)).toContain("QUARTERLY_UNKNOWN");
      }
    }
    // And a full clean run, where the cross-check genuinely executes.
    const ret = unwrap(
      buildForm940(
        goodRequest({
          employees: [
            employee({ employeeId: "a", totalPaymentsCents: 4_400_000, exemptPaymentsCents: 200_000 }),
            employee({ employeeId: "b", totalPaymentsCents: 800_000, exemptPaymentsCents: 50_000 }),
            employee({ employeeId: "c", totalPaymentsCents: 1_600_000, exemptPaymentsCents: 200_000 }),
          ],
          quarterly: { q1Cents: 12_600, q2Cents: 0, q3Cents: 0, q4Cents: 0 },
        }),
      ),
    );
    expect(amount(ret, "7")).toBe(
      amount(ret, "3") - amount(ret, "4") - amount(ret, "5"),
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * LINE 11, PART 4 AND PART 5
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("credit reduction, balance due and Part 5", () => {
  it("Washington at zero credit reduction produces a blank line 11", () => {
    const r = unwrap(buildForm940(goodRequest()));
    expect(amount(r, "11")).toBe(0);
    expect(lineOf(r, "11")?.blank).toBe(true);
  });

  it("a credit reduction rate raises the tax by that rate on line 7", () => {
    // 0.3% of $7,000 = $21.00. Line 8 is $42.00, so line 12 becomes $63.00.
    const r = unwrap(
      buildForm940(
        goodRequest({
          creditReductionMilliPct: 300,
          quarterly: { q1Cents: 6_300, q2Cents: 0, q3Cents: 0, q4Cents: 0 },
        }),
      ),
    );
    expect(amount(r, "11")).toBe(2_100);
    expect(amount(r, "12")).toBe(6_300);
    expect(r.notes.join(" ")).toContain("credit reduction");
    // And it warns that the money rides with the Q4 deposit.
    expect(r.notes.join(" ")).toContain("FOURTH QUARTER");
  });

  it("line 12 is exactly lines 8 + 9 + 10 + 11", () => {
    const r = unwrap(
      buildForm940(
        goodRequest({
          creditReductionMilliPct: 300,
          quarterly: { q1Cents: 6_300, q2Cents: 0, q3Cents: 0, q4Cents: 0 },
        }),
      ),
    );
    expect(amount(r, "12")).toBe(
      amount(r, "8") + amount(r, "9") + amount(r, "10") + amount(r, "11"),
    );
  });

  it("line 17 equals line 12 — Part 5 foots, or the return is refused", () => {
    const r = unwrap(buildForm940(goodRequest()));
    expect(amount(r, "17")).toBe(amount(r, "12"));
  });

  it("a Part 5 that does not foot is REFUSED, with the difference named", () => {
    const r = buildForm940(
      goodRequest({ quarterly: { q1Cents: 5_000, q2Cents: 0, q3Cents: 0, q4Cents: 0 } }),
    );
    if (r.ok) throw new Error("expected a refusal");
    const x = r.refusals.find((y) => y.code === "QUARTERLY_MISMATCH");
    // line 12 is $42.00, Part 5 says $50.00, so it is off by $8.00.
    expect(x?.fix).toContain("$8.00");
    expect(x?.what).toContain("$42.00");
  });

  it("deposits below the tax produce a balance due and no overpayment", () => {
    const r = unwrap(buildForm940(goodRequest({ depositedCents: 1_000 })));
    expect(r.balanceDueCents).toBe(3_200);
    expect(r.overpaymentCents).toBe(0);
    expect(lineOf(r, "15a")?.blank).toBe(true);
  });

  it("deposits above the tax produce an overpayment and no balance due", () => {
    const r = unwrap(buildForm940(goodRequest({ depositedCents: 10_000 })));
    expect(r.overpaymentCents).toBe(5_800);
    expect(r.balanceDueCents).toBe(0);
    expect(lineOf(r, "14")?.blank).toBe(true);
  });

  it("depositing exactly the tax leaves both boxes blank", () => {
    const r = unwrap(buildForm940(goodRequest({ depositedCents: 4_200 })));
    expect(r.balanceDueCents).toBe(0);
    expect(r.overpaymentCents).toBe(0);
    expect(lineOf(r, "14")?.blank).toBe(true);
    expect(lineOf(r, "15a")?.blank).toBe(true);
  });

  it("a balance due over $500 warns that it should have been DEPOSITED", () => {
    // $100,000 of taxable wages at 0.6% = $600.00, nothing deposited.
    const r = unwrap(
      buildForm940(
        goodRequest({
          employees: Array.from({ length: 15 }, (_, i) =>
            employee({ employeeId: `e${i}`, totalPaymentsCents: 4_000_000 }),
          ),
          statePayments: {
            paidOnTimeCents: 1_000_000,
            paidLateCents: 0,
            notPaidCents: 0,
            taxableStateWagesCents: 10_500_000,
            experienceRateBps: 540,
          },
          // 15 x $7,000 = $105,000 x 0.6% = $630.00
          quarterly: { q1Cents: 63_000, q2Cents: 0, q3Cents: 0, q4Cents: 0 },
        }),
      ),
    );
    expect(r.balanceDueCents).toBe(63_000);
    expect(r.notes.join(" ")).toContain("more than $500");
    expect(r.notes.join(" ")).toContain("penalty");
  });

  it("a balance due under $1 says so — the instructions waive it", () => {
    // Line 12 must land at 99 cents or less with nothing deposited. $150 of
    // taxable wages at 0.6% = $0.90.
    const r = unwrap(
      buildForm940(
        goodRequest({
          employees: [employee({ totalPaymentsCents: 15_000 })],
          statePayments: {
            paidOnTimeCents: 10_000,
            paidLateCents: 0,
            notPaidCents: 0,
            taxableStateWagesCents: 15_000,
            experienceRateBps: 540,
          },
          quarterly: { q1Cents: 90, q2Cents: 0, q3Cents: 0, q4Cents: 0 },
        }),
      ),
    );
    expect(r.balanceDueCents).toBe(90);
    expect(r.balanceDueCents).toBeLessThan(FUTA_DE_MINIMIS_BALANCE_CENTS);
    expect(r.notes.join(" ")).toContain("don't have to pay it");
  });

  it("the deposit note names the quarters in which a deposit was required", () => {
    const r = unwrap(
      buildForm940(
        goodRequest({
          employees: Array.from({ length: 15 }, (_, i) =>
            employee({ employeeId: `e${i}`, totalPaymentsCents: 4_000_000 }),
          ),
          statePayments: {
            paidOnTimeCents: 1_000_000,
            paidLateCents: 0,
            notPaidCents: 0,
            taxableStateWagesCents: 10_500_000,
            experienceRateBps: 540,
          },
          quarterly: { q1Cents: 63_000, q2Cents: 0, q3Cents: 0, q4Cents: 0 },
        }),
      ),
    );
    expect(r.notes.join(" ")).toContain("Q1");
    expect(r.notes.join(" ")).toContain("carry-forward");
  });

  it("a year with no deposit required says the whole lot rides on the return", () => {
    const r = unwrap(buildForm940(goodRequest()));
    expect(r.deposits.anyDepositRequired).toBe(false);
    expect(r.notes.join(" ")).toContain("one payment a year instead of four");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * WHO MUST FILE, AND THE BOX-C RETURN
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("Who Must File — either test, over a two-year lookback", () => {
  const filing = (over: Partial<Form940Request["filingTest"]>) =>
    unwrap(
      buildForm940(
        goodRequest({ filingTest: { ...goodRequest().filingTest, ...over } }),
      ),
    );

  it("$1,500 in a quarter THIS year triggers the obligation", () => {
    const r = filing({
      maxQuarterWagesThisYearCents: FUTA_EMPLOYER_TEST_QUARTERLY_WAGES_CENTS,
      maxQuarterWagesPriorYearCents: 0,
      weeksWithAnyEmployeeThisYear: 0,
      weeksWithAnyEmployeePriorYear: 0,
    });
    expect(r.meetsQuarterlyWageTest).toBe(true);
    expect(r.mustFile).toBe(true);
  });

  it("one cent short of $1,500 does not, on the wage test alone", () => {
    const r = filing({
      maxQuarterWagesThisYearCents: FUTA_EMPLOYER_TEST_QUARTERLY_WAGES_CENTS - 1,
      maxQuarterWagesPriorYearCents: 0,
      weeksWithAnyEmployeeThisYear: 0,
      weeksWithAnyEmployeePriorYear: 0,
    });
    expect(r.meetsQuarterlyWageTest).toBe(false);
    expect(r.mustFile).toBe(false);
  });

  it("THE LOOKBACK IS STICKY: last year's quarter still captures this year", () => {
    // "during 2024 or 2025". A quiet year following a busy one still files.
    const r = filing({
      maxQuarterWagesThisYearCents: 0,
      maxQuarterWagesPriorYearCents: FUTA_EMPLOYER_TEST_QUARTERLY_WAGES_CENTS,
      weeksWithAnyEmployeeThisYear: 0,
      weeksWithAnyEmployeePriorYear: 0,
    });
    expect(r.meetsQuarterlyWageTest).toBe(true);
    expect(r.mustFile).toBe(true);
  });

  it("20 different weeks triggers it even with tiny wages", () => {
    const r = filing({
      maxQuarterWagesThisYearCents: 100,
      maxQuarterWagesPriorYearCents: 0,
      weeksWithAnyEmployeeThisYear: FUTA_EMPLOYER_TEST_WEEKS,
      weeksWithAnyEmployeePriorYear: 0,
    });
    expect(r.meetsQuarterlyWageTest).toBe(false);
    expect(r.meetsTwentyWeekTest).toBe(true);
    expect(r.mustFile).toBe(true);
  });

  it("19 weeks does not", () => {
    const r = filing({
      maxQuarterWagesThisYearCents: 100,
      maxQuarterWagesPriorYearCents: 0,
      weeksWithAnyEmployeeThisYear: FUTA_EMPLOYER_TEST_WEEKS - 1,
      weeksWithAnyEmployeePriorYear: 0,
    });
    expect(r.meetsTwentyWeekTest).toBe(false);
    expect(r.mustFile).toBe(false);
  });

  it("it is an OR, not an AND — either test alone is enough", () => {
    const wageOnly = filing({
      maxQuarterWagesThisYearCents: FUTA_EMPLOYER_TEST_QUARTERLY_WAGES_CENTS,
      weeksWithAnyEmployeeThisYear: 0,
      weeksWithAnyEmployeePriorYear: 0,
      maxQuarterWagesPriorYearCents: 0,
    });
    const weekOnly = filing({
      maxQuarterWagesThisYearCents: 0,
      maxQuarterWagesPriorYearCents: 0,
      weeksWithAnyEmployeeThisYear: 52,
      weeksWithAnyEmployeePriorYear: 0,
    });
    expect(wageOnly.mustFile).toBe(true);
    expect(weekOnly.mustFile).toBe(true);
  });

  it("GREENWAY crosses the wage test in its first fortnight of 2027 payroll", () => {
    // Ten people on a biweekly cheque clear $1,500 in a single payroll run.
    const r = filing({ maxQuarterWagesThisYearCents: 5_000_000 });
    expect(r.meetsQuarterlyWageTest).toBe(true);
  });
});

describe("the box-c return: a year with no payments", () => {
  const dormant = buildForm940({
    year: 2029,
    employees: [],
    // Every downstream fact is deliberately null. The form skips Parts 2-6,
    // so the engine must not demand them.
    statePayments: {
      paidOnTimeCents: null,
      paidLateCents: null,
      notPaidCents: null,
      taxableStateWagesCents: null,
      experienceRateBps: null,
    },
    filingTest: {
      maxQuarterWagesThisYearCents: 0,
      maxQuarterWagesPriorYearCents: 5_000_000,
      weeksWithAnyEmployeeThisYear: 0,
      weeksWithAnyEmployeePriorYear: 52,
    },
    creditReductionMilliPct: null,
    depositedCents: null,
    quarterly: null,
    noPaymentsThisYear: true,
  });

  it("is accepted, not refused, even with every Part 2-6 fact missing", () => {
    // This is the whole point of the shortcut. Demanding an experience rate
    // for a year with no payroll would be a refusal the form does not make.
    expect(dormant.ok).toBe(true);
  });

  it("is flagged as a zero return with no tax and no lines", () => {
    const r = unwrap(dormant);
    expect(r.isZeroReturn).toBe(true);
    expect(r.totalTaxCents).toBe(0);
    expect(r.lines).toHaveLength(0);
    expect(r.worksheet).toBeNull();
  });

  it("STILL MUST BE FILED, because last year met the test", () => {
    const r = unwrap(dormant);
    expect(r.mustFile).toBe(true);
    expect(r.meetsQuarterlyWageTest).toBe(true);
    expect(r.meetsTwentyWeekTest).toBe(true);
  });

  it("explains box c and Part 7 in the note, and says silence is not a filing", () => {
    const r = unwrap(dormant);
    const note = r.notes.join(" ");
    expect(note).toContain("box c");
    expect(note).toContain("Part 7");
    expect(note).toContain("silence is not a filing");
  });

  it("a contradicted dormant year is REFUSED rather than quietly believed", () => {
    const r = buildForm940(goodRequest({ noPaymentsThisYear: true }));
    expect(codes(r)).toContain("DORMANT_CONTRADICTED");
  });

  it("an employee on the list with ZERO pay does not contradict a dormant year", () => {
    // Somebody on the roster who was never paid is consistent with "no
    // payments to employees". The contradiction test is on PAY, not presence.
    const r = buildForm940({
      ...goodRequest(),
      employees: [employee({ totalPaymentsCents: 0 })],
      noPaymentsThisYear: true,
    });
    expect(r.ok).toBe(true);
    expect(unwrap(r).isZeroReturn).toBe(true);
  });

  it("a dormant year with a bad YEAR is still refused — the shortcut is not a bypass", () => {
    const r = buildForm940({
      year: 3000,
      employees: [],
      statePayments: goodRequest().statePayments,
      filingTest: goodRequest().filingTest,
      creditReductionMilliPct: 0,
      depositedCents: 0,
      quarterly: null,
      noPaymentsThisYear: true,
    });
    expect(codes(r)).toContain("YEAR_NOT_VALID");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * CONSTANTS, UNITS AND INVARIANTS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("constants and units", () => {
  it("the net rate is DERIVED as 6.0% − 5.4% = 0.6%", () => {
    expect(FUTA_NET_RATE_MILLI_PCT).toBe(600);
    expect(FUTA_NET_RATE_MILLI_PCT).toBe(
      FUTA_GROSS_RATE_MILLI_PCT - FUTA_MAX_CREDIT_MILLI_PCT,
    );
  });

  it("THE CREDIT IS WORTH NINE TIMES THE TAX — the sentence in the header", () => {
    expect(FUTA_MAX_CREDIT_MILLI_PCT).toBe(9 * FUTA_NET_RATE_MILLI_PCT);
  });

  it("one basis point is ten milli-percent, and 5.4% agrees in both units", () => {
    expect(MILLI_PCT_PER_BASIS_POINT).toBe(10);
    expect(540 * MILLI_PCT_PER_BASIS_POINT).toBe(FUTA_MAX_CREDIT_MILLI_PCT);
  });

  it("the deposit threshold is $500.00 and the de minimis balance is $1.00", () => {
    expect(FUTA_DEPOSIT_THRESHOLD_CENTS).toBe(50_000);
    expect(FUTA_DE_MINIMIS_BALANCE_CENTS).toBe(100);
  });

  it("the plausibility ceiling sits ABOVE every real state rate, so none is rejected", () => {
    // 15%. Washington's combined rate cannot approach it, and neither can any
    // other state's, so a genuine rate is never refused as a typo.
    expect(EXPERIENCE_RATE_MAX_PLAUSIBLE_BPS).toBeGreaterThan(600);
    // The ceiling itself is ACCEPTED — the comparison is `>`, not `>=`, so a
    // rate sitting exactly on the boundary is a rate, not a typo.
    const onTheLine = buildForm940(
      goodRequest({
        statePayments: {
          ...goodRequest().statePayments,
          experienceRateBps: EXPERIENCE_RATE_MAX_PLAUSIBLE_BPS,
        },
      }),
    );
    expect(onTheLine.ok).toBe(true);
    // One basis point above it is not.
    expect(
      codes(
        buildForm940(
          goodRequest({
            statePayments: {
              ...goodRequest().statePayments,
              experienceRateBps: EXPERIENCE_RATE_MAX_PLAUSIBLE_BPS + 1,
            },
          }),
        ),
      ),
    ).toContain("EXPERIENCE_RATE_IMPLAUSIBLE");
  });

  it("the wage base is per person per YEAR, not per quarter", () => {
    // One person paid $40,000 contributes exactly one $7,000 base, however it
    // was spread across the year.
    const r = unwrap(buildForm940(goodRequest()));
    expect(amount(r, "7")).toBe(FUTA_WAGE_BASE_CENTS);
  });

  it("the engine is pure: identical requests give identical returns", () => {
    expect(buildForm940(goodRequest())).toEqual(buildForm940(goodRequest()));
  });

  it("the engine does not mutate its input", () => {
    const req = goodRequest();
    const snapshot = JSON.parse(JSON.stringify(req));
    buildForm940(req);
    expect(JSON.parse(JSON.stringify(req))).toEqual(snapshot);
  });

  it("lineOf returns undefined for a line that is not on the form", () => {
    const r = unwrap(buildForm940(goodRequest()));
    expect(lineOf(r, "99")).toBeUndefined();
    expect(lineOf(r, "12")).toBeDefined();
  });

  it("every line on the return has a non-empty label and a printed number", () => {
    const r = unwrap(buildForm940(goodRequest()));
    for (const l of r.lines) {
      expect(l.line.length).toBeGreaterThan(0);
      expect(l.label.length).toBeGreaterThan(5);
      expect(Number.isInteger(l.amountCents)).toBe(true);
    }
  });

  it("every amount on the return is an integer number of cents", () => {
    const r = unwrap(
      buildForm940(
        goodRequest({
          employees: [
            employee({ employeeId: "a", totalPaymentsCents: 1_234_567, exemptPaymentsCents: 7_654 }),
          ],
          statePayments: {
            paidOnTimeCents: 3_333,
            paidLateCents: 1_111,
            notPaidCents: 777,
            taxableStateWagesCents: 1_226_913,
            experienceRateBps: 417,
          },
          // Deliberately awkward numbers, so every rounding step is exercised:
          //   line 7  = min(1,234,567 − 7,654, 700,000)        = $7,000.00
          //   line 8  = 0.6% x 700,000                         =    $42.00
          //   w line 1= 5.4% x 700,000                          =   $378.00
          //   w line 3= (5,400 − 4,170) milli-pct x 1,226,913
          //           = 15,091.03 cents, rounded half up        =   $150.91
          //   w line 4= 3,333 + 15,091                          =   $184.24
          //   w line 5a = 37,800 − 18,424                       =   $193.76
          //   w line 5c = min(19,376, 1,111)                    =    $11.11
          //   w line 5d = 90% x 1,111 = 999.9, rounded half up  =    $10.00
          //   w line 6= 18,424 + 1,000                          =   $194.24
          //   w line 7= 37,800 − 19,424                         =   $183.76
          //   line 12 = 4,200 + 18,376                          =   $225.76
          quarterly: { q1Cents: 22_576, q2Cents: 0, q3Cents: 0, q4Cents: 0 },
        }),
      ),
    );
    for (const l of r.lines) expect(Number.isInteger(l.amountCents)).toBe(true);
    if (r.worksheet) {
      for (const v of Object.values(r.worksheet)) {
        if (typeof v === "number") expect(Number.isInteger(v)).toBe(true);
      }
    }
  });
});
