/**
 * tests/compliance/form-box-adapters.test.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS ACTUALLY FOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The adapters translate four engines into one box shape. A translation layer
 * has exactly two ways to be wrong, and both of them look perfect on screen:
 *
 *   1. IT CHANGES A NUMBER. A units slip - cents read as dollars, hours read as
 *      cents - produces a form that renders beautifully and is wrong. So every
 *      test below that touches an amount compares the box against the ENGINE's
 *      own figure, computed live in the same test, never against a number typed
 *      into this file. A number typed here could be copied from the same
 *      misunderstanding that produced the bug.
 *
 *   2. IT GOES SILENTLY STALE. The IRS adds a line to Form 941; the engine emits
 *      it; the adapter has no classification for it. If the adapter defaulted,
 *      that line would appear on screen coloured with an assertion about whose
 *      money it is that nobody ever made. The exhaustiveness tests here drive
 *      the REAL engines with the REAL fixtures and demand that every line they
 *      emit is classified - so a new line breaks this suite instead of quietly
 *      teaching Michael something false.
 *
 * The engine fixtures are deliberately the same ones the engines' own suites
 * use: Greenway's actually-filed Q2 2026 figures, and the IRS's own printed
 * Form 940 worked example. Inventing fresh fixtures here would test the
 * adapters against data no agency has ever seen.
 */
import { describe, it, expect } from "vitest";

import {
  ALL_TAUGHT_FORM_IDS,
  FORM_ID_940,
  FORM_ID_941,
  FORM_ID_W2,
  form940Boxes,
  form941Boxes,
  taughtFormTitle,
  w2Boxes,
  waBoxes,
  __runFormBoxAdapterTests,
} from "@/lib/payroll/form-box-adapters";
import { boxTone, formatBoxValue, splitMoney, type FormBox } from "@/lib/payroll/form-box-core";
import { buildForm940, type Form940Request } from "@/lib/payroll/form-940-core";
import { buildForm941, type Form941Request, type Form941Return } from "@/lib/payroll/form-941-core";
import { buildW2, type W2Form, type W2Request } from "@/lib/payroll/form-w2-core";
import {
  applyMilliPct,
  MEDICARE_RATE_MILLI_PCT,
  OASDI_RATE_MILLI_PCT,
} from "@/lib/payroll/payroll-withholding-core";
import { type YtdAccumulatorRow } from "@/lib/payroll/ytd-core";
import {
  buildWaQuarter,
  waLinesForForm,
  type WaQuarterFormId,
  type WaQuarterRequest,
  type WaQuarterReturn,
} from "@/lib/payroll/wa-quarterly-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * FIXTURES — the same shapes the engines' own suites use
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Greenway's real Q2 2026 rates, as filed. */
const Q2_2026_RATES = {
  sutaUiMilliPct: 370,
  sutaEafMilliPct: 30,
  pfmlTotalMilliPct: 1_130,
  pfmlEmployeeShareMilliPct: 71_430,
  waCaresMilliPct: 580,
  lniEmployeeMilliCentsPerHour: 16_445,
  lniEmployerMilliCentsPerHour: 39_485,
} as const;

function waRequest(): WaQuarterRequest {
  return {
    quarter: { year: 2026, quarter: 2 },
    subjects: [
      {
        subjectId: "e1",
        displayName: "Employee One",
        wagesCents: 4_000_000,
        esdTaxableWagesCents: 4_000_000,
        pfmlTaxableWagesCents: 4_000_000,
        hours: 2_000,
      },
      {
        subjectId: "e2",
        displayName: "Employee Two",
        wagesCents: 2_892_345,
        esdTaxableWagesCents: 2_892_345,
        pfmlTaxableWagesCents: 2_892_345,
        hours: 1_558,
      },
    ],
    rates: Q2_2026_RATES,
    pfml: { employerOwesEmployerShare: false, determinedAverageHeadcount: 10 },
  };
}

function waReturn(): WaQuarterReturn {
  const r = buildWaQuarter(waRequest());
  if (!r.ok) throw new Error(`WA fixture refused: ${r.refusals.map((x) => x.code).join(", ")}`);
  return r.value;
}

/**
 * The IRS's own printed Form 940 example: Joan, Sara and John.
 *
 * Reused rather than reinvented so the adapter is exercised on a return whose
 * every figure the IRS printed the answer to.
 */
function form940Request(): Form940Request {
  return {
    year: 2027,
    employees: [
      {
        employeeId: "joan",
        name: "Joan",
        totalPaymentsCents: 4_400_000,
        exemptPaymentsCents: 200_000,
        excludedFromStateUnemploymentTax: false,
      },
      {
        employeeId: "sara",
        name: "Sara",
        totalPaymentsCents: 800_000,
        exemptPaymentsCents: 50_000,
        excludedFromStateUnemploymentTax: false,
      },
      {
        employeeId: "john",
        name: "John",
        totalPaymentsCents: 1_600_000,
        exemptPaymentsCents: 200_000,
        excludedFromStateUnemploymentTax: false,
      },
    ],
    statePayments: {
      paidOnTimeCents: 200_000,
      paidLateCents: 0,
      notPaidCents: 0,
      taxableStateWagesCents: 2_100_000,
      experienceRateBps: 540,
    },
    filingTest: {
      maxQuarterWagesThisYearCents: 1_000_000,
      maxQuarterWagesPriorYearCents: 0,
      weeksWithAnyEmployeeThisYear: 52,
      weeksWithAnyEmployeePriorYear: 0,
    },
    creditReductionMilliPct: 0,
    depositedCents: 0,
    quarterly: { q1Cents: 12_600, q2Cents: 0, q3Cents: 0, q4Cents: 0 },
  };
}

function form940Return() {
  const r = buildForm940(form940Request());
  if (!r.ok) throw new Error(`940 fixture refused: ${r.refusals.map((x) => x.code).join(", ")}`);
  return r.ret;
}

/**
 * The employee half of FICA at the statutory rates, in integer cents.
 *
 * Used to build the fixture's `actualEmployeeFicaWithheldCents` so that Form 941
 * line 7 (fractions of cents) comes out at or near zero. The engine REFUSES a
 * line 7 too large to be rounding, which is correct of it, so a fixture with
 * invented withholding figures would be rejected rather than adapted — and this
 * suite is testing the adapter, not re-testing the engine's refusals.
 */
function employeeFicaHalfCents(wagesCents: number): number {
  // 6.2% + 1.45% = 7.65%, applied the way the engine applies it: each component
  // rounded separately, because that is how a paycheque is actually computed.
  return Math.round((wagesCents * 620) / 10_000) + Math.round((wagesCents * 145) / 10_000);
}

const E1_WAGES = 4_000_000;
const E2_WAGES = 2_892_345;

function form941Request(): Form941Request {
  return {
    quarter: { year: 2026, quarter: 2 },
    subjects: [
      {
        subjectId: "e1",
        displayName: "Employee One",
        wagesCents: E1_WAGES,
        oasdiTaxableWagesCents: E1_WAGES,
        medicareTaxableWagesCents: E1_WAGES,
        federalIncomeTaxWithheldCents: 300_000,
        actualEmployeeFicaWithheldCents: employeeFicaHalfCents(E1_WAGES),
        onPayrollForTwelfthPayPeriod: true,
      },
      {
        subjectId: "e2",
        displayName: "Employee Two",
        wagesCents: E2_WAGES,
        oasdiTaxableWagesCents: E2_WAGES,
        medicareTaxableWagesCents: E2_WAGES,
        federalIncomeTaxWithheldCents: 180_000,
        actualEmployeeFicaWithheldCents: employeeFicaHalfCents(E2_WAGES),
        onPayrollForTwelfthPayPeriod: true,
      },
    ],
    // NOT null. The engine refuses DEPOSITS_UNKNOWN on a null, which is right of
    // it — assuming zero would turn a fully paid quarter into a balance due for
    // the whole quarter's tax. A figure is supplied so the adapter sees a
    // complete return including lines 13 and 14.
    totalDepositsCents: 900_000,
    sourceLabel: "form-box-adapters.test.ts fixture",
  };
}

function form941Return(): Form941Return {
  const r = buildForm941(form941Request());
  if (!r.ok) throw new Error(`941 fixture refused: ${r.refusals.map((x) => x.code).join(", ")}`);
  return r;
}

const W2_YEAR = 2026;
const W2_WAGES = 6_000_000;

/**
 * A year-to-date row, built with the ENGINE's own rate helpers.
 *
 * The withheld figures are not typed in. `applyMilliPct` with the exported
 * statutory rates is the same path the payroll engine uses, so if a rate ever
 * changes this fixture follows it instead of pinning a stale number and
 * reporting a false failure.
 */
function ytdFor(): YtdAccumulatorRow {
  return {
    employeeId: "emp-1",
    taxYear: W2_YEAR,
    wages: {
      oasdiWagesCents: W2_WAGES,
      medicareWagesCents: W2_WAGES,
      futaWagesCents: 700_000,
      waSutaWagesCents: 700_000,
      waPfmlWagesCents: W2_WAGES,
      waCaresWagesCents: W2_WAGES,
      lniHundredthHours: 200_000,
    },
    oasdiEmployeeCents: applyMilliPct(W2_WAGES, OASDI_RATE_MILLI_PCT),
    medicareEmployeeCents: applyMilliPct(W2_WAGES, MEDICARE_RATE_MILLI_PCT),
    addlMedicareEmployeeCents: 0,
    federalIncomeTaxCents: 800_000,
    lastRunId: "run-26",
  };
}

function w2Request(over: Partial<W2Request> = {}): W2Request {
  return {
    taxYear: W2_YEAR,
    employee: {
      employeeId: "emp-1",
      firstNameAndInitial: "Michael",
      lastName: "Lyman",
      suffix: null,
      ssn: "123456789",
      isTwoPercentShareholder: false,
      scorpHealthPremiumCents: 0,
      box12: [],
      box14: [],
      retirementPlan: false,
      statutoryEmployee: false,
      thirdPartySickPay: false,
      isVoid: false,
    },
    ytd: ytdFor(),
    state: {
      stateCode: "WA",
      employerStateIdNumber: "000-073905-00-0",
      stateWagesCents: 0,
      stateIncomeTaxCents: 0,
    },
    ...over,
  };
}

function w2Form(): W2Form {
  const r = buildW2(w2Request());
  // W2Result narrows to the W2Form ITSELF on success - there is no `.form`
  // wrapper. Getting this wrong yields `undefined.boxes`, which is a loud
  // failure rather than a quiet one, which is the point of the discriminant.
  if (!r.ok) throw new Error(`W-2 fixture refused: ${r.refusals.map((x) => x.code).join(", ")}`);
  return r;
}

const byBox = (boxes: readonly FormBox[], id: string): FormBox => {
  const b = boxes.find((x) => x.box === id);
  // Throwing beats returning undefined: `expect(undefined).toBe(undefined)`
  // passes cheerfully while comparing nothing to nothing.
  if (b === undefined) throw new Error(`no box "${id}" among [${boxes.map((x) => x.box).join(", ")}]`);
  return b;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. THE EMBEDDED SELF-TESTS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("form-box-adapters self-tests", () => {
  it("passes its embedded suite", () => {
    expect(() => __runFormBoxAdapterTests()).not.toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. EXHAUSTIVENESS — driven by the real engines
 *
 * These are the tests that will one day fail for a good reason.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("every line the engines actually emit is classified", () => {
  it("Form 941: classifies every line the engine produces", () => {
    const ret = form941Return();
    expect(ret.lines.length).toBeGreaterThan(5);
    // If any line were unclassified the adapter throws, naming it.
    expect(() => form941Boxes(ret)).not.toThrow();
    expect(form941Boxes(ret).length).toBe(ret.lines.length);
  });

  it("Form 940: classifies every line the engine produces", () => {
    const ret = form940Return();
    expect(ret.lines.length).toBeGreaterThan(15);
    expect(() => form940Boxes(ret)).not.toThrow();
    expect(form940Boxes(ret).length).toBe(ret.lines.length);
  });

  it("Form W-2: classifies every box the engine produces", () => {
    const form = w2Form();
    expect(form.boxes.length).toBeGreaterThan(5);
    expect(() => w2Boxes(form)).not.toThrow();
    expect(w2Boxes(form).length).toBe(form.boxes.length);
  });

  it("Washington: every line of every WA form survives translation", () => {
    const ret = waReturn();
    const forms: readonly WaQuarterFormId[] = [
      "esd_5208a",
      "esd_5208b",
      "pfml_wa_cares",
      "lni_quarterly",
    ];
    let seen = 0;
    for (const f of forms) {
      const engineLines = waLinesForForm(ret, f);
      const boxes = waBoxes(ret, f);
      expect(boxes.length).toBe(engineLines.length);
      seen += boxes.length;
    }
    // Rule 66d: prove the thing exists before proving anything about it. A loop
    // over four empty lists would pass every assertion above.
    expect(seen).toBeGreaterThan(8);
  });

  it("names every form it can render, and refuses to name one it cannot", () => {
    for (const id of ALL_TAUGHT_FORM_IDS) {
      expect(taughtFormTitle(id).length).toBeGreaterThan(10);
      // The agency must be named: four forms means four different logins.
      expect(taughtFormTitle(id)).toMatch(/\(|IRS|SSA|ESD|Industries/);
    }
    expect(() => taughtFormTitle("form_1099_nec")).toThrow(/no title/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. NO NUMBER MAY CHANGE IN TRANSLATION
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("translation must not alter a single figure", () => {
  it("Form 941: every money line matches the engine's own cents", () => {
    const ret = form941Return();
    const boxes = form941Boxes(ret);
    let compared = 0;
    for (const line of ret.lines) {
      const b = byBox(boxes, line.line);
      if (line.isCount) continue;
      expect(b.amountCents).toBe(line.amountCents);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(5);
  });

  it("Form 940: every line matches the engine's own cents", () => {
    const ret = form940Return();
    const boxes = form940Boxes(ret);
    for (const line of ret.lines) {
      expect(byBox(boxes, line.line).amountCents).toBe(line.amountCents);
    }
  });

  it("Form W-2: every box matches the engine's own cents", () => {
    const form = w2Form();
    const boxes = w2Boxes(form);
    for (const b of form.boxes) {
      expect(byBox(boxes, b.box).amountCents).toBe(b.amountCents);
    }
  });

  it("Washington: money boxes match the engine to the cent", () => {
    const ret = waReturn();
    for (const line of ret.lines) {
      const boxes = waBoxes(ret, line.form);
      expect(byBox(boxes, line.id).amountCents).toBe(line.amountCents);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. THE UNITS TRAPS
 *
 * Each of these is a specific bug that would render perfectly.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("units: a headcount is not money and an hour is not a cent", () => {
  it("941 line 1 becomes a COUNT, and never prints as dollars", () => {
    const ret = form941Return();
    const line1 = ret.lines.find((l) => l.line === "1");
    expect(line1, "the engine must emit line 1").toBeDefined();
    expect(line1!.isCount).toBe(true);

    const box = byBox(form941Boxes(ret), "1");
    expect(box.measure).toBe("count");
    // The headcount moves to quantity. Two employees left in amountCents would
    // print as "$0.02" - which looks like a real, tiny, plausible amount.
    expect(box.quantity).toBe(line1!.amountCents);
    expect(box.amountCents).toBe(0);
    const printed = formatBoxValue(box);
    expect(printed).not.toContain("$");
    expect(printed).toContain(String(line1!.amountCents));
  });

  it("L&I hours arrive as HUNDREDTHS, so the shared formatter prints them right", () => {
    const ret = waReturn();
    const engineLine = waLinesForForm(ret, "lni_quarterly").find((l) => l.measure === "hours");
    expect(engineLine, "the L&I return must have an hours line").toBeDefined();

    const box = byBox(waBoxes(ret, "lni_quarterly"), engineLine!.id);
    expect(box.measure).toBe("hours");
    // The engine counts whole hours; FormBox.quantity is hundredths.
    expect(box.quantity).toBe(engineLine!.quantity! * 100);
    // 3,558 hours must not become 3,558 cents, nor 355,800 hours.
    expect(formatBoxValue(box)).not.toContain("$");
    expect(formatBoxValue(box)).toContain("3,558");
  });

  it("the hours line carries no cents, so it cannot be added to money", () => {
    const ret = waReturn();
    const boxes = waBoxes(ret, "lni_quarterly");
    const hours = boxes.filter((b) => b.measure === "hours");
    expect(hours.length).toBeGreaterThan(0);
    for (const h of hours) expect(h.amountCents).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. WHOSE MONEY — the classifications that carry legal weight
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("whose money: the classifications a colour asserts", () => {
  it("941 line 2 is a WAGE BASE, so it stays visually quiet despite being biggest", () => {
    const ret = form941Return();
    const boxes = form941Boxes(ret);
    const line2 = byBox(boxes, "2");
    expect(line2.whose).toBe("tax_base");
    expect(boxTone(line2)).toBe("neutral");

    // Prove it really is the biggest figure, or the point is theoretical.
    const biggest = Math.max(...boxes.filter((b) => b.measure === "money").map((b) => b.amountCents));
    expect(line2.amountCents).toBe(biggest);
  });

  it("941 line 3 is the employees' money, held in trust", () => {
    expect(byBox(form941Boxes(form941Return()), "3").whose).toBe("employee_money");
  });

  it("941 line 5a is SHARED, and says so with both halves named", () => {
    const b = byBox(form941Boxes(form941Return()), "5a");
    expect(b.whose).toBe("shared");
    expect(boxTone(b)).toBe("orange");
    // A "contains the word withheld" heuristic gets this box wrong, and it is
    // the largest tax on the return.
    expect(b.derivation).toContain("6.2%");
    expect(b.derivation).toContain("12.4%");
  });

  it("940 has NO shared and NO employee-money line anywhere", () => {
    const boxes = form940Boxes(form940Return());
    const money = boxes.filter((b) => b.measure === "money");
    expect(money.length).toBeGreaterThan(10);
    for (const b of money) {
      expect(b.whose === "employee_money", `line ${b.box} must not be employee money`).toBe(false);
      expect(b.whose === "shared", `line ${b.box} must not be shared`).toBe(false);
    }
    // And at least one line must actually be employer cost, or the loop above
    // is satisfied by a form made entirely of wage bases.
    expect(money.some((b) => b.whose === "employer_cost")).toBe(true);
  });

  it("Social Security is SHARED on the 941 and EMPLOYEE money on the W-2", () => {
    // Both are correct. The 941 line is the combined 12.4%; the W-2 box is only
    // the employee's 6.2%. This difference is what makes the W-3-to-941
    // reconciliation possible, and collapsing it would break that silently.
    expect(byBox(form941Boxes(form941Return()), "5a").whose).toBe("shared");
    expect(byBox(w2Boxes(w2Form()), "4").whose).toBe("employee_money");
  });

  it("proves the classification numerically: 941 line 5a is TWICE the employee halves", () => {
    // The relationship the two classifications above assert, checked in cents
    // rather than asserted in prose. The 941 and W-2 fixtures describe different
    // wage figures, so the comparison is built on the 941's OWN subjects: sum
    // the employee 6.2% halves the fixture withheld, and line 5a must be twice
    // that. This is the reconciliation the Check tab will show, and it only
    // works because 5a is "shared" (both halves) while W-2 box 4 is
    // "employee_money" (one half). Collapse either and this test goes red.
    const line5a = byBox(form941Boxes(form941Return()), "5a").amountCents;
    const employeeOasdiHalves =
      Math.round((E1_WAGES * 620) / 10_000) + Math.round((E2_WAGES * 620) / 10_000);
    expect(employeeOasdiHalves).toBeGreaterThan(0);
    // Exactly twice, to within the rounding that line 7 exists to absorb.
    expect(Math.abs(line5a - employeeOasdiHalves * 2)).toBeLessThanOrEqual(200);

    // And the same box on a W-2 must be ONE half, never two: the W-2 box 4 for
    // a $60,000 earner is 6.2% of it, not 12.4%.
    const box4 = byBox(w2Boxes(w2Form()), "4").amountCents;
    expect(box4).toBe(Math.round((W2_WAGES * 620) / 10_000));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. BLANK ON PURPOSE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("a box that is empty for a good reason must say so", () => {
  it("W-2 box 17 is blank on purpose in Washington, with the reason attached", () => {
    const b = byBox(w2Boxes(w2Form()), "17");
    expect(b.amountCents).toBe(0);
    expect(b.blankOnPurpose).not.toBeNull();
    expect(b.blankOnPurpose).toContain("no state income tax");
    // The trap: Paid Leave and WA Cares ARE withheld, and belong in box 14.
    expect(b.blankOnPurpose).toContain("box 14");
    // And the neutral tone must win over the money category (trap 2 in core).
    expect(boxTone(b)).toBe("neutral");
  });

  it("Form 940 carries the engine's blank flag through, never a false zero", () => {
    const ret = form940Return();
    const boxes = form940Boxes(ret);
    let blanks = 0;
    for (const line of ret.lines) {
      const b = byBox(boxes, line.line);
      if (line.blank) {
        expect(b.blankOnPurpose, `line ${line.line} is blank but unexplained`).not.toBeNull();
        expect(b.blankOnPurpose).toContain("different things to the IRS");
        blanks += 1;
      } else {
        expect(b.blankOnPurpose, `line ${line.line} is not blank but claims to be`).toBeNull();
      }
    }
    // Rule 66d: the fixture must actually contain a deliberately blank line, or
    // this test proves only that the else-branch works.
    expect(blanks).toBeGreaterThan(0);
  });

  it("a W-2 box 16 with real out-of-state wages is NOT called blank", () => {
    // The condition is on the VALUE, not the state. Hard-coding box 16 as
    // always blank in Washington would hide an Oregon-earned wage figure.
    const r = buildW2(
      w2Request({
        state: {
          stateCode: "WA",
          employerStateIdNumber: "000-073905-00-0",
          stateWagesCents: 1_500_000,
          stateIncomeTaxCents: 0,
        },
      }),
    );
    if (!r.ok) throw new Error(`fixture refused: ${r.refusals.map((x) => x.code).join(", ")}`);
    const b = byBox(w2Boxes(r), "16");
    expect(b.amountCents).toBe(1_500_000);
    expect(b.blankOnPurpose).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7. THE SPLIT BAR, ON REAL RETURNS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the whose-money visualisation on real returns", () => {
  it("Form 940 reads as 100% Greenway's money", () => {
    const split = splitMoney(form940Boxes(form940Return()));
    expect(split.employeeCents).toBe(0);
    expect(split.employerMilliPct).toBe(100_000);
    // Which is the whole point of FUTA and should be visible without reading.
  });

  it("the L&I split is nowhere near 50/50, which is the lesson", () => {
    const ret = waReturn();
    const boxes = waBoxes(ret, "lni_quarterly");
    const split = splitMoney(boxes);
    expect(split.employeeCents).toBeGreaterThan(0);
    expect(split.employerCents).toBeGreaterThan(split.employeeCents * 2);
    // 29.403% / 70.597% for risk class 6403 at Greenway's 2026 rates. Asserted
    // in milli-percent, i.e. to three decimal places, precisely so that nobody
    // can later "tidy" it to a round 30/70 and have the test still pass.
    expect(split.employeeMilliPct).toBe(29_403);
    expect(split.employerMilliPct).toBe(70_597);

    // And the split must be the RATE ratio, independent of how many hours were
    // worked: the two rates alone decide who carries what share.
    const rateRatio = Math.round((16_445 * 100_000) / (16_445 + 39_485));
    expect(split.employeeMilliPct).toBe(rateRatio);
  });

  it("the L&I split ignores the return's own total line", () => {
    const ret = waReturn();
    const boxes = waBoxes(ret, "lni_quarterly");
    const total = boxes.find((b) => b.box === "lni-premium");
    expect(total, "the L&I return must have a combined premium line").toBeDefined();
    expect(total!.whose).toBe("shared");
    // The split's total must equal the form's own total, not twice it.
    expect(splitMoney(boxes).totalCents).toBe(total!.amountCents);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8. EVERY BOX IS RENDERABLE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("every translated box can actually be drawn", () => {
  it("gives every box a caption, a derivation and a printable value", () => {
    const ret = waReturn();
    const all: readonly FormBox[] = [
      ...form941Boxes(form941Return()),
      ...form940Boxes(form940Return()),
      ...w2Boxes(w2Form()),
      ...waBoxes(ret, "esd_5208a"),
      ...waBoxes(ret, "pfml_wa_cares"),
      ...waBoxes(ret, "lni_quarterly"),
    ];
    expect(all.length).toBeGreaterThan(40);
    for (const b of all) {
      expect(b.caption.length, `box ${b.formId}:${b.box} has no caption`).toBeGreaterThan(3);
      expect(b.derivation.length, `box ${b.formId}:${b.box} has no derivation`).toBeGreaterThan(20);
      expect(b.formId.length).toBeGreaterThan(3);
      expect(formatBoxValue(b).length).toBeGreaterThan(0);
      expect(boxTone(b)).toBeTruthy();
    }
  });

  it("stamps the right formId on every box, so lessons stay reachable", () => {
    // A lesson is looked up by (formId, box). If an adapter stamped the wrong
    // formId, every lesson for that form would become unreachable while the
    // form still rendered perfectly - a whole teaching surface silently dark.
    for (const b of form941Boxes(form941Return())) expect(b.formId).toBe(FORM_ID_941);
    for (const b of form940Boxes(form940Return())) expect(b.formId).toBe(FORM_ID_940);
    for (const b of w2Boxes(w2Form())) expect(b.formId).toBe(FORM_ID_W2);
    // Washington keeps the engine's own ids, deliberately and unchanged.
    const ret = waReturn();
    for (const b of waBoxes(ret, "lni_quarterly")) expect(b.formId).toBe("lni_quarterly");
    for (const b of waBoxes(ret, "pfml_wa_cares")) expect(b.formId).toBe("pfml_wa_cares");
  });
});
