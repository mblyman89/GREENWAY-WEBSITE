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
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ALL_TAUGHT_FORM_IDS,
  ALL_WHOSE_TABLES,
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

    /*
     * ═══ WAS `=== ret.lines.length`, CHANGED IN books-61 ═══
     *
     * The adapter now also emits the ENTITY area - the EIN, legal name, trade
     * name, address and city/state/ZIP that sit above line 1. Before this the
     * 941 rendered with none of them, on either page, which is not a return.
     *
     * The count is not simply bumped to 5 + lines. Asserting the RELATIONSHIP
     * keeps the check meaningful: every engine line must still survive, the
     * five entity boxes must be present, and nothing else may appear.
     */
    const boxes = form941Boxes(ret);
    const ids = boxes.map((b) => b.box);
    const entity = ["ein", "name", "tradeName", "address", "cityStateZip"];
    for (const e of entity) expect(ids, `941 lost entity box ${e}`).toContain(e);
    for (const l of ret.lines) expect(ids, `941 lost line ${l.line}`).toContain(l.line);
    expect(boxes.length).toBe(ret.lines.length + entity.length);
  });

  it("Form 940: classifies every line the engine produces AND names the employer", () => {
    /*
     * ═══ THIS ASSERTION USED TO PIN THE DEFECT, books-63 ═══
     *
     * It read `expect(form940Boxes(ret).length).toBe(ret.lines.length)` — an
     * exact equality that made the absence of the entity area a REQUIREMENT.
     * The 941 test directly above and the W-2 test directly below were both
     * upgraded in books-61 when this same defect was found on those two forms.
     * This one was not, so a live Form 940 printed its FUTA arithmetic under a
     * completely anonymous header on both of its pages, and the suite defended
     * that.
     *
     * The lesson is rule 23 arriving as a test rather than as code: two of
     * three sibling assertions were fixed, and the third went on certifying the
     * bug. Both adapters now call one shared `employerEntityBoxes`.
     */
    const ret = form940Return();
    expect(ret.lines.length).toBeGreaterThan(15);
    expect(() => form940Boxes(ret)).not.toThrow();

    const boxes = form940Boxes(ret);
    const ids = boxes.map((b) => b.box);
    const entity = ["ein", "name", "tradeName", "address", "cityStateZip"];
    for (const e of entity) expect(ids, `940 lost entity box ${e}`).toContain(e);
    for (const l of ret.lines) expect(ids, `940 lost line ${l.line}`).toContain(l.line);
    expect(boxes.length).toBe(ret.lines.length + entity.length);
  });

  /**
   * THE CLASS, not the three instances.
   *
   * The 941, the 940 and the W-2 each lost their identity area in turn, and
   * each was fixed separately. This asserts the shared builder exists and that
   * BOTH employment-tax adapters route through it, so a fourth return cannot be
   * written with an inline copy that drifts.
   */
  it("the 941 and the 940 get their entity area from ONE shared builder", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "payroll", "form-box-adapters.ts"),
      "utf8",
    );
    expect(src).toMatch(/function employerEntityBoxes\(/);
    expect(src).toMatch(/employerEntityBoxes\(FORM_ID_941, "Form 941"\)/);
    expect(src).toMatch(/employerEntityBoxes\(FORM_ID_940, "Form 940"\)/);

    // And the identity text both forms print comes from one place too: the 940
    // delegates to the 941's builder because the EIN splits identically on
    // both page 2s. A second copy could disagree about the hyphen.
    const facs = readFileSync(
      join(process.cwd(), "src", "lib", "payroll", "form-facsimile-core.ts"),
      "utf8",
    );
    expect(facs).toMatch(/nine40IdentityText = nine41IdentityText/);
  });

  /**
   * Every box the shared builder emits must be MAPPED on both forms' paper.
   *
   * Discovered from the box map rather than listed here: a box that exists in
   * the adapter and not in the map places nowhere, and `facsimileBoxes` skips
   * it silently as "lives on another page".
   */
  it("every entity box the 940 emits has a rectangle on the 940's paper", () => {
    const ret = form940Return();
    const ids = new Set(form940Boxes(ret).map((b) => b.box));
    const map = JSON.parse(
      readFileSync(
        join(process.cwd(), "src", "lib", "payroll", "form-box-map.generated.json"),
        "utf8",
      ),
    ) as Record<string, { copies: Record<string, string[]>[] }>;

    const mappedAnywhere = new Set<string>([
      ...Object.keys(map["940-p1"].copies[0]),
      ...Object.keys(map["940-p2"].copies[0]),
    ]);
    for (const e of ["ein", "name", "tradeName", "address", "cityStateZip"]) {
      expect(ids, `the adapter stopped emitting ${e}`).toContain(e);
      expect(mappedAnywhere, `940 entity box ${e} has no rectangle`).toContain(e);
    }
    // Page 2 repeats exactly the name and the EIN, because the sheets get
    // separated in handling. Measured, and pinned so a re-derivation that
    // dropped them would fail here rather than print an anonymous page 2.
    expect(Object.keys(map["940-p2"].copies[0])).toContain("ein");
    expect(Object.keys(map["940-p2"].copies[0])).toContain("name");
  });

  it("Form W-2: classifies every box the engine produces", () => {
    const form = w2Form();
    expect(form.boxes.length).toBeGreaterThan(5);
    expect(() => w2Boxes(form)).not.toThrow();

    /*
     * Same change as the 941, same reason: `w2Boxes` now also emits the seven
     * identity boxes (a-f and 15). A live W-2 previously produced only the
     * eight money boxes the engine computes - no SSN, no EIN, no employer, no
     * employee name - while the teaching specimen produced all 26, which is
     * why nobody noticed. The relationship is asserted, not a bare total.
     */
    const boxes = w2Boxes(form);
    const ids = boxes.map((b) => b.box);
    const identity = ["a", "b", "c", "d", "e", "f", "15"];
    for (const i of identity) expect(ids, `W-2 lost identity box ${i}`).toContain(i);
    for (const b of form.boxes) expect(ids, `W-2 lost box ${b.box}`).toContain(b.box);
    expect(boxes.length).toBe(form.boxes.length + identity.length);
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE OWNERSHIP REGISTRY IS COMPLETE — CHECKED AGAINST THE SOURCE FILE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ADDED books-55. AND IT IS OVERDUE, WHICH IS THE INTERESTING PART.
 *
 * `ALL_WHOSE_TABLES` was introduced in this slice with a docblock in
 * form-box-adapters.ts that says, in as many words:
 *
 *   "So the list is a named export, and `tests/compliance/form-box-adapters
 *    .test.ts` reads THIS FILE'S OWN SOURCE and asserts that every
 *    `export const *_WHOSE` declaration in it appears here."
 *
 * THAT SENTENCE WAS FALSE WHEN IT WAS WRITTEN. Measured before writing this
 * block: `grep -rc ALL_WHOSE_TABLES tests/` found NOTHING ANYWHERE, and
 * `grep -c readFileSync` in this file returned 0. The registry existed, the
 * runtime assertion `assertEveryClassificationIsJustified` iterated it, and
 * the promised completeness gate did not exist. So a fifth `*_WHOSE` table
 * could have been added and left out of the registry exactly as before, with
 * a comment nearby confidently explaining why that was impossible.
 *
 * A comment describing a gate is not a gate. This is standing rule 39 turned
 * on its author: a verifier that cannot see something approves it, and a
 * verifier that does not exist approves everything. The docblock was doing
 * the work of reassurance while doing none of the work of checking, which is
 * strictly worse than no comment at all, because it stops the next reader
 * from looking.
 *
 * WHY THE CHECK MUST READ SOURCE TEXT. The failure mode is a DECLARATION that
 * exists and is not REGISTERED. At runtime the unregistered table is simply
 * an object nobody passed anywhere; there is no reflective way to ask a
 * TypeScript module "what did you export that I did not import". So the file
 * is read as text and the `export const *_WHOSE` declarations are counted.
 * This is the same justified exception the wiring gate uses: an absence in a
 * module cannot be detected from inside that module.
 */
describe("books-55: every ownership table is in the registry that gates them", () => {
  const ADAPTERS = "src/lib/payroll/form-box-adapters.ts";

  /**
   * Deliberately NOT stripping comments here.
   *
   * The pattern requires `export const NAME_WHOSE` at the START of a line,
   * and every comment line in this repo's style is indented or begins with
   * `*`, `//` or `/*`. A commented-out declaration therefore does not match,
   * and a real one always does. Verified by the mutation that comments a
   * table out: it must NOT make this gate pass by making the table vanish
   * from the count while the registry still lists it — which is why the two
   * directions below are separate assertions.
   */
  function declaredWhoseTables(): readonly string[] {
    const src = readFileSync(join(process.cwd(), ADAPTERS), "utf8");
    return [...src.matchAll(/^export const ([A-Z0-9_]*_WHOSE)\b/gm)].map((m) => m[1]);
  }

  it("finds the ownership tables at all, so this gate is not vacuous", () => {
    // Rule 66d / rule 39: existence before absence. If the regex silently
    // stopped matching — a rename to `export const whose941`, a formatter
    // that indents top-level declarations — every assertion below would pass
    // by comparing two empty things.
    const declared = declaredWhoseTables();
    expect(
      declared.length,
      `no "export const *_WHOSE" declarations were found in ${ADAPTERS}. Either they were ` +
        `renamed, or this gate's pattern has gone stale and is now checking nothing.`,
    ).toBeGreaterThanOrEqual(4);
    expect(declared).toContain("FORM_W3_WHOSE");
  });

  it("registers every declared ownership table, so none escapes the prose checks", () => {
    const declared = declaredWhoseTables();
    // The registry holds [displayName, table] pairs and NOT the identifier, so
    // identity is established by object reference: import the module's own
    // exports and match each declared name to the object the registry carries.
    const registeredTables = new Set(ALL_WHOSE_TABLES.map(([, table]) => table));
    expect(
      registeredTables.size,
      "two entries in ALL_WHOSE_TABLES point at the SAME object, so one form's ownership " +
        "rows are being checked twice and another form's not at all.",
    ).toBe(ALL_WHOSE_TABLES.length);
    expect(
      ALL_WHOSE_TABLES.length,
      `${ADAPTERS} declares ${declared.length} ownership tables (${declared.join(", ")}) but ` +
        `ALL_WHOSE_TABLES holds ${ALL_WHOSE_TABLES.length}. Every table not in that list has ` +
        `its ownership classifications - whose money each box is, and why - checked by ` +
        `nothing. That is how thirty-one W-3 rows nearly shipped unverified.`,
    ).toBe(declared.length);
  });

  it("gives every registered table a form name a person can act on", () => {
    for (const [name, table] of ALL_WHOSE_TABLES) {
      // "table[3] box 12b" is not a failure message anybody can use. The name
      // is the difference between a red test and a red test that tells
      // Michael which of his forms is wrong.
      expect(name, "a registry entry has no form name").toMatch(/^(Form|Washington)\b/);
      expect(name.length).toBeGreaterThan(5);
      expect(Object.keys(table).length, `${name} has an empty ownership table`).toBeGreaterThan(0);
    }
    const names = ALL_WHOSE_TABLES.map(([n]) => n);
    expect(new Set(names).size, `duplicate form names in the registry: ${names.join(", ")}`).toBe(
      names.length,
    );
  });

  it("runs the runtime justification pass over all of them, W-3 included", () => {
    // assertEveryClassificationIsJustified() is already exercised by the
    // embedded suite, but nothing tied it to the W-3's 31 rows specifically.
    const w3 = ALL_WHOSE_TABLES.find(([n]) => n === "Form W-3");
    expect(w3, "Form W-3 is missing from the ownership registry").toBeDefined();
    expect(Object.keys(w3![1]).length).toBe(31);
  });
});
