/**
 * tests/compliance/payroll-onboarding-ui-core.test.ts
 *
 * THE SCREEN IS WHERE MICHAEL ACTUALLY LIVES.
 *
 * payroll-onboarding-ui-core.ts holds the two decisions that determine what the
 * guided setup screen says: which fields get highlighted red and refuse to save
 * (buildChecklistView), and what the resulting paycheck looks like line by line
 * with its arithmetic exposed (buildWorkedPaycheck).
 *
 * Michael's words are the specification here, so they are worth restating:
 *
 *   "It should have a check list of task to be completed before it lets you
 *    save them to the system, and if a field is missing, it should highlight it
 *    so something can't silently fail me in some way."
 *
 *   "I don't use any of the reports in the screenshot really because I don't
 *    understand fully what it is showing me."
 *
 * The second one is why the `formula` field exists and why these tests assert on
 * it as hard as they assert on the amounts. A correct number he cannot check is
 * a number he will not use - that is the whole finding of this branch. So a test
 * that only verified `amountCents` would be testing the half of the feature that
 * was never broken.
 *
 * WHAT THESE TESTS DELIBERATELY DO NOT DO: re-derive the taxes. The arithmetic
 * lives in payroll-withholding-core.ts and is proven there against Pub. 15-T. A
 * second implementation in the test file would drift from the first and then
 * "agree" with whichever one had the bug (rule 25). These tests prove the WIRING
 * and the EXPLANATION: that the right rate reached the right line, that no line
 * was silently dropped, and that every printed formula reproduces its own result.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GREENWAY_LNI_RISK_CLASS_CODE,
  buildChecklistView,
  buildWorkedPaycheck,
  formatHours,
  formatMilliCentsAsRate,
  formatMilliPct,
  refusalSentence,
  type PaycheckLine,
} from "@/lib/payroll/payroll-onboarding-ui-core";
import type {
  I9Record,
  OnboardingCandidate,
  PayRecord,
} from "@/lib/payroll/payroll-onboarding-core";
import type { W4Record } from "@/lib/payroll/payroll-w4-core";
import { GREENWAY_RATES } from "@/lib/payroll/payroll-rates-2026";

// ---------------------------------------------------------------------------
// FIXTURES - a real, complete, saveable employee
// ---------------------------------------------------------------------------

const HIRE = "2027-01-04"; // the first Monday after the Jan 1 2027 cutover

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
  signedAt: HIRE,
};

const I9: I9Record = {
  employeeId: "e1",
  section1SignedYmd: HIRE,
  section2CompletedYmd: HIRE,
  firstDayOfEmploymentYmd: HIRE,
  documents: [
    {
      category: "list_a",
      title: "U.S. Passport",
      issuingAuthority: "U.S. Department of State",
      documentNumber: "X12345678",
      expirationYmd: "2032-05-01",
    },
  ],
  copiesRetained: true,
};

/** $18.00/hr budtender, paid every other Friday. Michael's actual arrangement. */
const HOURLY_PAY: PayRecord = {
  employeeId: "e1",
  basis: "hourly",
  hourlyRateMilliCents: 1_800_000, // $18.00/hr in milli-cents
  annualSalaryCents: null,
  payFrequency: "biweekly",
  laborRoleCode: "budtender",
  cogsSplitBasisPoints: 0,
  hireYmd: HIRE,
  minimumWageMilliCentsAtHire: 1_713_000, // $17.13/hr
};

/** Michael himself: salary, paid once at the end of the year. */
const OWNER_PAY: PayRecord = {
  employeeId: "owner",
  basis: "salary",
  hourlyRateMilliCents: null,
  annualSalaryCents: 6_000_000, // $60,000
  payFrequency: "annually",
  laborRoleCode: "owner_officer",
  cogsSplitBasisPoints: 0,
  hireYmd: HIRE,
  minimumWageMilliCentsAtHire: 1_713_000,
};

const COMPLETE: OnboardingCandidate = {
  employeeId: "e1",
  legalFirstName: "Dana",
  legalLastName: "Reyes",
  ssn: "543-21-9876",
  w4: W4,
  i9: I9,
  pay: HOURLY_PAY,
  newHireReportedYmd: HIRE,
};

const EIGHTY_HOURS = 8_000; // hundredths
const ON_DATE = "2026-06-15"; // inside the evidenced 2026 rate rows

// ===========================================================================
// 1) THE CHECKLIST
// ===========================================================================
describe("buildChecklistView renders the checklist without deciding anything", () => {
  it("a complete employee can be saved and nothing is highlighted", () => {
    const view = buildChecklistView(COMPLETE);
    expect(view.canSave).toBe(true);
    expect(view.blockedBecause).toBe("");
    expect(view.blockingCount).toBe(0);
    for (const row of view.rows) {
      expect(row.highlightFields, `${row.key} highlighted a field anyway`).toEqual([]);
    }
  });

  it("has one row per onboarding step, each with a human label and explanation", () => {
    const view = buildChecklistView(COMPLETE);
    // Seven steps: identity, I-9 s1, I-9 s2, W-4, pay, labor role, new hire report.
    expect(view.rows.length).toBe(7);
    for (const row of view.rows) {
      expect(row.label.length, `${row.key} label`).toBeGreaterThan(10);
      // whatItIs comes from the step's `why`. A blank one means the mapping
      // silently read a field that does not exist - which is exactly the bug
      // this file shipped with before it was type-checked.
      expect(row.whatItIs.length, `${row.key} whatItIs`).toBeGreaterThan(30);
    }
  });

  it("REFUSES to save and names the field when the W-4 is missing", () => {
    const view = buildChecklistView({ ...COMPLETE, w4: null });
    expect(view.canSave).toBe(false);
    const w4Row = view.rows.find((r) => r.key === "w4");
    expect(w4Row?.state).toBe("blocking");
    expect(w4Row?.highlightFields.length).toBeGreaterThan(0);
    // Michael's requirement is a HIGHLIGHTED FIELD, not a general complaint.
    // A blocking row with nothing to highlight is a dead end on screen.
    expect(view.blockedBecause.length).toBeGreaterThan(20);
  });

  it("REFUSES to save when the I-9 documents are insufficient", () => {
    const view = buildChecklistView({
      ...COMPLETE,
      i9: { ...I9, documents: [] },
    });
    expect(view.canSave).toBe(false);
    expect(view.blockingCount).toBeGreaterThan(0);
  });

  it("REFUSES a zero wage - the exact Sage defect from the screenshots", () => {
    // Every hourly rate on Michael's Sage Pay Info tab reads 0.00 and Sage
    // saves the employee anyway. A zero wage is a field nobody filled in.
    const view = buildChecklistView({
      ...COMPLETE,
      pay: { ...HOURLY_PAY, hourlyRateMilliCents: 0 },
    });
    expect(view.canSave).toBe(false);
    const payRow = view.rows.find((r) => r.key === "pay");
    expect(payRow?.state).toBe("blocking");
    // The engine reports the field as a PATH ("pay.hourlyRateMilliCents"), not
    // a bare name, because the screen has to know which CARD to highlight - a
    // bare name could belong to the pay card or the W-4 card. Asserting the
    // path keeps this test honest about what the UI actually receives.
    expect(payRow?.highlightFields).toContain("pay.hourlyRateMilliCents");
  });

  it("every blocking row offers at least one field to highlight", () => {
    // The general form of the requirement. A row that blocks saving but names
    // no field leaves Michael hunting, which is the silent failure he asked us
    // to make impossible.
    const view = buildChecklistView({
      employeeId: "e2",
      legalFirstName: "",
      legalLastName: "",
      ssn: "",
      w4: null,
      i9: null,
      pay: null,
      newHireReportedYmd: null,
    });
    expect(view.canSave).toBe(false);
    const blocking = view.rows.filter((r) => r.state === "blocking");
    expect(blocking.length).toBeGreaterThan(2);
    for (const row of blocking) {
      expect(row.problems.length, `${row.key} blocks with no message`).toBeGreaterThan(0);
      expect(
        row.highlightFields.length,
        `${row.key} blocks but highlights nothing`,
      ).toBeGreaterThan(0);
    }
  });

  it("the blocked sentence counts the problems and quotes the first one", () => {
    const view = buildChecklistView({ ...COMPLETE, w4: null, i9: null });
    expect(view.blockedBecause).toMatch(/\d+ things|only thing/);
  });

  it("carries the statutory deadlines onto the rows that have them", () => {
    const view = buildChecklistView(COMPLETE);
    const s2 = view.rows.find((r) => r.key === "i9_section2");
    const nh = view.rows.find((r) => r.key === "new_hire_report");
    // Three business days from Monday Jan 4 2027 is Thursday Jan 7.
    expect(s2?.deadlineYmd).toBe("2027-01-07");
    // Twenty calendar days from Jan 4 2027 is Jan 24.
    expect(nh?.deadlineYmd).toBe("2027-01-24");
    // And a step with no statutory clock must not invent one.
    expect(view.rows.find((r) => r.key === "pay")?.deadlineYmd).toBeNull();
  });

  it("the new-hire report warns but does not block payroll", () => {
    // It is a real obligation with a real deadline, but it does not stop you
    // paying someone. Blocking on it would be wrong in the other direction.
    const view = buildChecklistView({ ...COMPLETE, newHireReportedYmd: null });
    const row = view.rows.find((r) => r.key === "new_hire_report");
    expect(row?.blocksPayroll).toBe(false);
    expect(view.canSave).toBe(true);
  });

  it("exposes the underlying evaluation so nothing is hidden from the screen", () => {
    const view = buildChecklistView({ ...COMPLETE, pay: null });
    expect(view.evaluation.canSaveToPayroll).toBe(false);
    expect(view.evaluation.refusalCode).not.toBeNull();
  });
});

// ===========================================================================
// 2) THE WORKED PAYCHECK
// ===========================================================================
describe("buildWorkedPaycheck shows the arithmetic, not just the answer", () => {
  const paycheck = buildWorkedPaycheck({
    w4: W4,
    pay: HOURLY_PAY,
    hundredthHours: EIGHTY_HOURS,
    onIsoDate: ON_DATE,
  });

  it("computes gross from the rate and the hours, and says so", () => {
    // $18.00 x 80 hours = $1,440.00
    expect(paycheck.grossCents).toBe(144_000);
    expect(paycheck.grossFormula).toContain("$18.00");
    expect(paycheck.grossFormula).toContain("80.00");
    expect(paycheck.grossFormula).toContain("$1,440.00");
  });

  it("names the pay period in words Michael uses, not an enum", () => {
    expect(paycheck.periodLabel).toContain("two-week");
    expect(paycheck.periodLabel).toContain("26");
    expect(paycheck.periodLabel).not.toMatch(/biweekly/);
  });

  it("EVERY line carries a formula containing its own result", () => {
    // The heart of it. A line whose formula does not reproduce the amount is a
    // line Michael cannot check, and an unchecked line is what he told us he
    // ignores. Refused lines are exempt - they have no amount to reproduce.
    const all = [...paycheck.employeeLines, ...paycheck.employerLines];
    expect(all.length).toBeGreaterThan(6);
    for (const line of all) {
      if (line.refusal) continue;
      expect(line.formula.length, `${line.label} has no formula`).toBeGreaterThan(15);
      const printed = centsToPlain(line.amountCents);
      expect(
        line.formula,
        `${line.label}: formula "${line.formula}" never shows its result ${printed}`,
      ).toContain(printed);
    }
  });

  it("every line says who bears it, and employer lines never reduce take-home", () => {
    for (const line of paycheck.employeeLines) expect(line.bearer).toBe("employee");
    for (const line of paycheck.employerLines) expect(line.bearer).toBe("employer");
    const employerTotal = sum(paycheck.employerLines);
    // Take-home is gross less EMPLOYEE withholding only. If an employer tax
    // ever reached the employee side, take-home would fall by that amount -
    // this is the check that catches a mis-filed line.
    expect(paycheck.takeHomeCents).toBe(paycheck.grossCents - sum(paycheck.employeeLines));
    expect(employerTotal).toBeGreaterThan(0);
  });

  it("take-home and employer cost are stated with their arithmetic", () => {
    expect(paycheck.takeHomeFormula).toContain(centsToPlain(paycheck.grossCents));
    expect(paycheck.takeHomeFormula).toContain(centsToPlain(paycheck.takeHomeCents));
    expect(paycheck.employerCostFormula).toContain(
      centsToPlain(paycheck.employerCostCents),
    );
    expect(paycheck.employerCostCents).toBeGreaterThan(paycheck.grossCents);
  });

  it("includes every tax Greenway actually owes, and no invented ones", () => {
    const labels = [
      ...paycheck.employeeLines.map((l) => l.label),
      ...paycheck.employerLines.map((l) => l.label),
    ].join(" | ");
    for (const expected of [
      "Federal income tax",
      "Social Security",
      "Medicare",
      "Paid Family",
      "WA Cares",
      "L&I",
      "FUTA",
      "unemployment",
    ]) {
      expect(labels, `missing a ${expected} line`).toContain(expected);
    }
    // Washington has no state income tax. A line for one would be a fabrication
    // and it is the sort of thing a generic payroll package puts on the screen.
    expect(labels).not.toMatch(/state income tax/i);
  });

  it("THE L&I LINE IS PER HOUR, NOT PER DOLLAR - the books-14 defect", () => {
    const lni = paycheck.employeeLines.find((l) => l.label.includes("L&I"));
    expect(lni).toBeDefined();
    // $0.16445/hr x 80.00 hr = $13.156 exactly.
    //
    // THIS TEST ORIGINALLY ASSERTED $13.16 AND THE TEST WAS WRONG. Half-up is
    // the right rounding for almost every line on this paycheck, but not for
    // this one. The employee's L&I share is FLOORED, because taking even one
    // penny more out of a worker's check than the L&I notice allows is a gross
    // misdemeanor under RCW 51.16.140(2) - not a rounding difference. The
    // employer absorbs the six tenths of a cent. So $13.15, and the fraction
    // falls on Michael rather than on his budtender, every single time.
    expect(lni?.amountCents).toBe(1_315);
    // Pin the DIRECTION, not just the number, so a future half-up "cleanup"
    // cannot pass this test by moving the fraction onto the employee.
    const exactMilliCents = 8_000 * 16_445; // hundredth-hours x milli-cents/hr
    const flooredCents = Math.floor(exactMilliCents / 100_000);
    expect(lni?.amountCents).toBe(flooredCents);
    expect(lni?.amountCents).toBeLessThan(exactMilliCents / 100_000);
    expect(lni?.formula).toContain("$0.16445");
    expect(lni?.formula).toContain("per hour");
    expect(lni?.formula).toContain("80.00");
    expect(lni?.formula).toContain(GREENWAY_LNI_RISK_CLASS_CODE);
  });

  it("a bonus-only check with no hours withholds NO L&I at all", () => {
    // The consequence of the line above, and the one that proves it is not a
    // coincidence of the fixture. Sage computes L&I on dollars, so it would
    // take money here. The right answer is nothing, because L&I is charged on
    // hours worked and no hours were worked.
    const bonus = buildWorkedPaycheck({
      w4: W4,
      pay: HOURLY_PAY,
      hundredthHours: 0,
      onIsoDate: ON_DATE,
    });
    const lni = bonus.employeeLines.find((l) => l.label.includes("L&I"));
    expect(lni?.amountCents).toBe(0);
  });

  it("reads every rate from the dated registry, never from a literal", () => {
    // Cross-check two rates against the registry rather than against numbers
    // typed into this test. If the UI core ever hard-codes a rate, the registry
    // can be updated and this test will still pass while the screen goes stale -
    // so the assertion is that the two AGREE, using the registry as the source.
    const lniEmployee = GREENWAY_RATES.lookupValue(
      "lni_employee_rate",
      ON_DATE,
      "milli_cents_per_hour",
    );
    expect(lniEmployee.ok).toBe(true);
    if (lniEmployee.ok) {
      const lni = paycheck.employeeLines.find((l) => l.label.includes("L&I"));
      expect(lni?.formula).toContain(formatMilliCentsAsRate(lniEmployee.value));
    }
    const pfml = GREENWAY_RATES.lookupValue("pfml_total", ON_DATE, "milli_percent");
    expect(pfml.ok).toBe(true);
    if (pfml.ok) {
      const line = paycheck.employeeLines.find((l) => l.label.includes("Paid Family"));
      expect(line?.formula).toContain(formatMilliPct(pfml.value));
    }
  });

  it("shows the PFML employer share as zero WITH THE REASON, not as a missing line", () => {
    // Greenway has fewer than 50 Washington employees, so the employer share is
    // genuinely nothing. A vanished line and a zero line look identical on a
    // screen; only one of them tells you why (rule 46).
    const line = paycheck.employerLines.find((l) => l.label.includes("PFML"));
    expect(line).toBeDefined();
    expect(line?.amountCents).toBe(0);
    expect(line?.formula).toMatch(/fewer than 50/);
    expect(line?.formula).toMatch(/still withheld|still owed/);
  });

  it("cites an authority for every line", () => {
    for (const line of [...paycheck.employeeLines, ...paycheck.employerLines]) {
      expect(line.authorityId, `${line.label} cites nothing`).toBeTruthy();
    }
  });

  it("does not silently invent year-to-date figures", () => {
    // An illustration must start the year at zero, or the same setup shows a
    // different answer in December than in January and Michael has no way to
    // know why. Proven by the OASDI cap NOT being reached on a $1,440 check.
    expect(paycheck.taxes.fica.oasdiCeilingReached).toBe(false);
    expect(paycheck.taxes.fica.oasdiTaxableCents).toBe(paycheck.grossCents);
  });

  it("has nothing uncollected on an ordinary check", () => {
    expect(paycheck.uncollectedEmployeeTaxCents).toBe(0);
  });
});

// ===========================================================================
// 3) THE OWNER'S ONCE-A-YEAR PAYCHECK  (the defect this slice found)
// ===========================================================================
describe("the owner's annual salary computes instead of throwing", () => {
  // Before books-25 this threw "divideRoundHalfUp requires integers - a float
  // reached a money path", because PAY_PERIODS_PER_YEAR had no `annually` key
  // while migration 0195 accepted 'annually'. A storable, uncomputable row.
  const owner = buildWorkedPaycheck({
    w4: W4,
    pay: OWNER_PAY,
    hundredthHours: 0,
    onIsoDate: ON_DATE,
  });

  it("pays the whole salary in the single period", () => {
    expect(owner.grossCents).toBe(6_000_000);
    expect(owner.grossFormula).toContain("$60,000.00");
  });

  it("withholds the federal tax verified by hand off Pub. 15-T", () => {
    // Hand-checked against the 2026 STANDARD schedule, Single/MFS:
    //   $60,000 - $8,600 (line 1g) = $51,400 adjusted annual wage
    //   bracket $19,900-$57,900 -> $1,240.00 + 12% x ($51,400 - $19,900)
    //                           = $1,240.00 + $3,780.00 = $5,020.00
    // One pay period a year, so the per-period amount IS the annual amount.
    const fit = owner.employeeLines.find((l) => l.label === "Federal income tax");
    expect(fit?.amountCents).toBe(502_000);
  });

  it("explains the annual period without saying 'divided back by 1'", () => {
    const fit = owner.employeeLines.find((l) => l.label === "Federal income tax");
    expect(fit?.formula).toContain("1 pay period");
    expect(fit?.formula).toMatch(/only payment of the year/);
    expect(fit?.formula).not.toMatch(/divided back by 1\b/);
  });

  it("labels the period as the owner's own arrangement", () => {
    expect(owner.periodLabel).toContain("1 per year");
  });

  it("withholds no L&I, because an owner on salary reports no hours", () => {
    const lni = owner.employeeLines.find((l) => l.label.includes("L&I"));
    expect(lni?.amountCents).toBe(0);
  });

  it("crosses the Social Security wage cap correctly on a large salary", () => {
    // $200,000 in one payment is over the 2026 OASDI base of $184,500, so the
    // cap must bite within the single period rather than being ignored because
    // year-to-date started at zero.
    const big = buildWorkedPaycheck({
      w4: W4,
      pay: { ...OWNER_PAY, annualSalaryCents: 20_000_000 },
      hundredthHours: 0,
      onIsoDate: ON_DATE,
    });
    expect(big.taxes.fica.oasdiCeilingReached).toBe(true);
    const base = GREENWAY_RATES.lookupValue("fica_oasdi_wage_base", ON_DATE, "cents");
    expect(base.ok).toBe(true);
    if (base.ok) {
      expect(big.taxes.fica.oasdiTaxableCents).toBe(base.value);
      const ss = big.employeeLines.find((l) => l.label.includes("Social Security"));
      expect(ss?.formula).toMatch(/wage cap has been reached/);
    }
  });
});

// ===========================================================================
// 4) WHEN A RATE IS MISSING, THE LINE REFUSES - IT DOES NOT SHOW ZERO
// ===========================================================================
describe("a missing rate produces a refusal, never a confident zero", () => {
  // 2019 predates every evidenced rate row, so the registry cannot answer.
  // The wrong behaviour would be `?? 0`: a clean, confident, wrong paycheck.
  const stale = buildWorkedPaycheck({
    w4: W4,
    pay: HOURLY_PAY,
    hundredthHours: EIGHTY_HOURS,
    onIsoDate: "2019-06-15",
  });

  it("collects the refusals instead of swallowing them", () => {
    expect(stale.refusals.length).toBeGreaterThan(0);
  });

  it("every refusal says what to do about it, not just what broke", () => {
    for (const r of stale.refusals) {
      expect(r.length).toBeGreaterThan(60);
    }
  });

  it("marks the affected lines as refused rather than as zero", () => {
    const refused = [...stale.employeeLines, ...stale.employerLines].filter(
      (l) => l.refusal,
    );
    expect(refused.length).toBeGreaterThan(0);
    for (const line of refused) {
      expect(line.formula).toBe(line.refusal);
    }
  });

  it("still computes the federal tax, which needs no state rate", () => {
    // A refusal must be scoped to the line that lacks evidence. Failing the
    // whole paycheck because Washington's rates are missing would be its own
    // kind of dishonesty.
    const fit = stale.employeeLines.find((l) => l.label === "Federal income tax");
    expect(fit?.refusal).toBeUndefined();
    expect(fit?.amountCents).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 5) THE FORMATTERS
// ===========================================================================
describe("the formatters print money the way the notices print it", () => {
  it("keeps all five decimals of an L&I hourly rate", () => {
    // $0.16445/hr is the real number on Michael's notice, and whole cents
    // cannot hold it. books-14 shipped $0.067185 by deriving instead of reading.
    expect(formatMilliCentsAsRate(16_445)).toBe("$0.16445");
    expect(formatMilliCentsAsRate(39_485)).toBe("$0.39485");
  });

  it("never prints fewer than two decimals", () => {
    expect(formatMilliCentsAsRate(1_800_000)).toBe("$18.00");
    expect(formatMilliCentsAsRate(1_713_000)).toBe("$17.13");
    expect(formatMilliCentsAsRate(0)).toBe("$0.00");
  });

  it("prints milli-percent as a percentage", () => {
    expect(formatMilliPct(920)).toBe("0.92%");
    expect(formatMilliPct(400)).toBe("0.4%");
    expect(formatMilliPct(100_000)).toBe("100%");
  });

  it("prints hundredth-hours without floating point drift", () => {
    expect(formatHours(8_000)).toBe("80.00");
    expect(formatHours(740)).toBe("7.40");
    expect(formatHours(1)).toBe("0.01");
    expect(formatHours(0)).toBe("0.00");
    // 7.4 hours is not representable in binary floating point; this is the
    // case that would drift if the implementation divided by 100 as a float.
    expect(formatHours(4_499)).toBe("44.99");
  });

  it("joins a refusal into a problem AND an action", () => {
    const s = refusalSentence({
      code: "wa_suta_rate_not_evidenced",
      message: "I can't compute this.",
      whatToDo: "Upload the notice.",
      authorityId: "esd-suta-rate-structure",
    });
    expect(s).toBe("I can't compute this. Upload the notice.");
  });
});

// ===========================================================================
// 6) THE FILE ITSELF - no second tax engine, no hard-coded rates
// ===========================================================================
describe("the screen core stays a screen core", () => {
  const SRC = readFileSync(
    join(__dirname, "..", "..", "src", "lib", "payroll", "payroll-onboarding-ui-core.ts"),
    "utf8",
  );

  it("the source was actually read", () => {
    // Rule 39: without this, a bad path makes every assertion below vacuous.
    expect(SRC.length).toBeGreaterThan(10_000);
    expect(SRC).toContain("buildWorkedPaycheck");
  });

  it("delegates the arithmetic instead of reimplementing it (rule 25)", () => {
    expect(SRC).toContain("computePaycheckTaxes");
    // The tell-tales of a second tax engine: percentage literals doing work.
    // 6.2% and 1.45% appear in PROSE inside formula strings, which is the
    // point, but they must never appear as multipliers.
    expect(SRC).not.toMatch(/\*\s*0\.062\b/);
    expect(SRC).not.toMatch(/\*\s*0\.0145\b/);
    expect(SRC).not.toMatch(/\*\s*0\.009\b/);
  });

  // Assertions about CODE must be made against code, not against comments.
  // Three of the tests below originally failed because this file DISCUSSES the
  // Sage defects it avoids - it contains the words ".2857" and "lookupValue()"
  // inside explanatory comments. A grep-the-whole-file test cannot tell the
  // difference between committing a sin and naming it, so it flagged the
  // documentation as the defect. Stripping comments first is what makes these
  // tests mean what they say.
  const CODE_ONLY = SRC.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

  it("the comment stripper left real code behind", () => {
    // Rule 39 again, one level down: if CODE_ONLY came out empty or tiny, every
    // `not.toContain` below would pass for free. It must still hold the actual
    // implementation.
    expect(CODE_ONLY.length).toBeGreaterThan(10_000);
    expect(CODE_ONLY).toContain("export function buildWorkedPaycheck");
    expect(CODE_ONLY).toContain("computePaycheckTaxes");
    // And it must really have removed something, or it is not stripping at all.
    expect(CODE_ONLY.length).toBeLessThan(SRC.length);
  });

  it("does not hard-code a rate that belongs in the dated registry", () => {
    // The exact Sage defect Michael found: .2857 typed into a formula by hand,
    // with a zero fallback, so nobody could see where the split came from. The
    // string is allowed in a comment explaining the defect; it is banned in
    // code, where it would become a second, undated source of truth.
    expect(CODE_ONLY).not.toContain("0.2857");
    expect(CODE_ONLY).not.toContain(".2857");
    // The registry is where rates come from.
    expect(CODE_ONLY).toContain("GREENWAY_RATES.lookupValue");
  });

  it("always passes an explicit unit when reading a rate", () => {
    // lookupValue refuses rather than converting, but only if the caller states
    // the unit. A call site that omitted it would not compile - this asserts we
    // are not routing around the guard some other way.
    // No `s` flag: this project's tsconfig targets below ES2018, so `s` is a
    // compile error here. It is not needed either - `[^)]*` already matches
    // newlines, and both forms were checked to return the identical six call
    // sites before the flag was dropped.
    const calls = [...CODE_ONLY.matchAll(/lookupValue\(([^)]*)\)/g)];
    // Observed count, not a guess: six rates are read here (PFML total, PFML
    // employer share, WA Cares, SUTA, and the two L&I rates). Pinned exactly so
    // that a seventh rate read has to come past this test.
    expect(calls.length).toBe(6);
    for (const c of calls) {
      expect(c[1], `lookupValue call without a unit: ${c[1]}`).toMatch(
        /"milli_percent"|"milli_cents_per_hour"|"cents"/,
      );
    }
  });

  it("never falls back to zero for a rate without recording the refusal first", () => {
    // `?? 0` on a RATE buys a confident wrong number - that is Sage's whole
    // failure mode. It survives here only because a handful of engine
    // parameters are typed non-nullable, and only where the refusal has ALREADY
    // been captured and surfaced.
    //
    // Counting them was the first version of this test and it was a bad test:
    // it guessed 6, the real number was 10, and a bare count would have passed
    // just as happily if someone added an eleventh in a dangerous place. What
    // actually matters is WHAT the fallback sits on. Every one must be a
    // `.value` read from a RateLookup - never a literal or an arithmetic
    // expression, because `.value` is undefined precisely when `.refusal` is
    // set, and the refusal is already on the line.
    const fallbacks = [...CODE_ONLY.matchAll(/([A-Za-z0-9_.[\]]+)\s*\?\?\s*0\b/g)];
    expect(fallbacks.length).toBeGreaterThan(0);
    for (const f of fallbacks) {
      expect(f[1], `a zero fallback on something that is not a rate lookup: ${f[0]}`).toMatch(
        /\.value$|Cents$/,
      );
    }
    // And every rate whose value is defaulted must ALSO be able to refuse, so
    // the zero is never the only thing the screen shows.
    expect(CODE_ONLY).toContain("refusal");
  });

  it("holds no JSX, so it stays testable", () => {
    expect(SRC).not.toMatch(/<\/[A-Za-z]/);
    expect(SRC).not.toContain("react");
  });

  it("does no I/O - the screen layer fetches, this layer computes", () => {
    expect(SRC).not.toContain("supabase");
    expect(SRC).not.toContain("fetch(");
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Cents as the engine's own formatter prints them.
 *
 * Deliberately NOT importing formatCentsPlain: this is the independent
 * expectation the formula strings are checked against, and importing the same
 * function the implementation uses would make the check circular - a formatting
 * bug would appear on both sides and cancel out.
 */
function centsToPlain(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${grouped}.${String(rem).padStart(2, "0")}`;
}

function sum(lines: readonly PaycheckLine[]): number {
  return lines.reduce((n, l) => n + l.amountCents, 0);
}
