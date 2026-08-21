/**
 * tests/compliance/payroll-reconciliation-report.test.ts   (slice books-27)
 *
 * THE GATE OVER THE RECONCILIATION REPORT AND THE KNOWN-GOOD QUARTER.
 *
 * This suite has an advantage almost no test suite gets: an ORACLE. Every
 * figure in `known-good-quarters.ts` came off a return that was actually filed
 * with a government agency and accepted. So the central assertions here are not
 * "the code agrees with what I expected" — they are "the code agrees with what
 * the State of Washington and the IRS actually charged."
 *
 * Standing rule 22 says the test is a suspect, so the organising question is
 * what expensive lie this engine could tell:
 *
 *   1. A CLEAN REPORT THAT SHOULD BE DIRTY. Someone is under-withheld, the
 *      report says everything ties, and it is found at year end instead.
 *   2. A DIRTY REPORT THAT SHOULD BE CLEAN. Rounding is called an error every
 *      quarter until Michael stops reading the report at all. This one is
 *      subtler and arguably worse, because it destroys the control silently.
 *   3. THE TOLERANCE THAT SWALLOWS A REAL ERROR. A fixed dollar threshold hides
 *      genuine differences at small headcounts.
 *   4. THE COLLAPSED TWO-STEP. PFML computed with one combined rate looks
 *      right, is off by cents, and disagrees with the filed return.
 *   5. A CORRUPT ORACLE. If the fixture stops agreeing with itself, every test
 *      here starts lying in the same direction at once and all still pass.
 */
import { describe, expect, it } from "vitest";

import {
  applyBasis,
  buildReconciliationReport,
  maxRoundingDriftCents,
  type ExpectationBasis,
  type ReconcileSubject,
} from "@/lib/reports/payroll-reconciliation-report-core";
import {
  Q2_2026_EMPLOYEES,
  Q2_2026_GROSS_WAGES_CENTS,
  Q2_2026_TOTAL_HOURS,
  Q2_2026_FILED_FIGURES,
  assertKnownGoodQuarterCrossFoots,
  filedFigure,
} from "@/lib/reports/known-good-quarters";
import {
  RECONCILIATION_LESSONS,
  assertEveryReconciliationFunctionIsTaught,
  reconciliationCitedAuthorityIds,
  reconciliationExportedFunctionNames,
  reconciliationLessonFor,
  reconciliationTaughtFunctionNames,
} from "@/lib/reports/payroll-reconciliation-mentor";
import { findGuidanceAuthority } from "@/lib/accounting/books-guidance-core";

const MEDICARE_EMPLOYEE: ExpectationBasis = { kind: "percent_of_wages", rateMilliPct: 1_450 };

/** Turn the filed wage detail into subjects whose withholding is exactly right. */
function perfectSubjects(basis: ExpectationBasis): ReconcileSubject[] {
  return Q2_2026_EMPLOYEES.map((e) => ({
    subjectId: e.subjectId,
    displayName: e.displayName,
    taxableGrossCents: e.wagesCents,
    actualWithheldCents: applyBasis(basis, e.wagesCents),
  }));
}

const HOURS: Record<string, number> = Object.fromEntries(
  Q2_2026_EMPLOYEES.map((e) => [e.subjectId, e.hours]),
);

// ---------------------------------------------------------------------------
// 5) THE ORACLE MUST AGREE WITH ITSELF FIRST
// ---------------------------------------------------------------------------

describe("known-good quarter — the oracle", () => {
  it("cross-foots: wages, hours, and the Form 941 internal arithmetic", () => {
    expect(() => assertKnownGoodQuarterCrossFoots()).not.toThrow();
  });

  it("the ten filed wage figures add to the base all four returns agree on", () => {
    const sum = Q2_2026_EMPLOYEES.reduce((a, e) => a + e.wagesCents, 0);
    expect(sum).toBe(Q2_2026_GROSS_WAGES_CENTS);
    expect(sum).toBe(6_892_345);
  });

  it("the hours tie to both the ESD and the L&I return", () => {
    expect(Q2_2026_EMPLOYEES.reduce((a, e) => a + e.hours, 0)).toBe(Q2_2026_TOTAL_HOURS);
    expect(Q2_2026_TOTAL_HOURS).toBe(3_558);
  });

  it("is not vacuous: there are figures, and every one is fully described", () => {
    expect(Q2_2026_FILED_FIGURES.length).toBeGreaterThanOrEqual(14);
    for (const f of Q2_2026_FILED_FIGURES) {
      expect(f.form.length, `${f.id}.form`).toBeGreaterThan(0);
      expect(f.line.length, `${f.id}.line`).toBeGreaterThan(0);
      expect(f.plainEnglish.length, `${f.id}.plainEnglish`).toBeGreaterThan(20);
      expect(f.reproducedBy.length, `${f.id}.reproducedBy`).toBeGreaterThan(20);
      expect(Number.isInteger(f.filedAmountCents), `${f.id} is not integer cents`).toBe(true);
    }
  });

  it("figure ids are unique", () => {
    const ids = Q2_2026_FILED_FIGURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("filedFigure finds a real line and misses a fake one", () => {
    expect(filedFigure("941-line-12")?.filedAmountCents).toBe(1_420_457);
    expect(filedFigure("941-line-999")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// THE ARITHMETIC MUST REPRODUCE WHAT THE AGENCIES ACTUALLY CHARGED
// ---------------------------------------------------------------------------

describe("applyBasis — reproducing the filed returns to the cent", () => {
  it("Medicare, both halves: 68,923.45 x 2.9% = 941 line 5c", () => {
    expect(applyBasis({ kind: "percent_of_wages", rateMilliPct: 2_900 }, Q2_2026_GROSS_WAGES_CENTS))
      .toBe(filedFigure("941-line-5c")!.filedAmountCents);
  });

  it("Social Security, both halves: 68,923.45 x 12.4% = 941 line 5a", () => {
    expect(applyBasis({ kind: "percent_of_wages", rateMilliPct: 12_400 }, Q2_2026_GROSS_WAGES_CENTS))
      .toBe(filedFigure("941-line-5a")!.filedAmountCents);
  });

  it("unemployment at the FILED 0.37%, not Sage's stale 0.64%", () => {
    expect(applyBasis({ kind: "percent_of_wages", rateMilliPct: 370 }, Q2_2026_GROSS_WAGES_CENTS))
      .toBe(filedFigure("esd-ui")!.filedAmountCents);
    // And prove the stale rate would NOT have reproduced the filing.
    expect(applyBasis({ kind: "percent_of_wages", rateMilliPct: 640 }, Q2_2026_GROSS_WAGES_CENTS))
      .not.toBe(filedFigure("esd-ui")!.filedAmountCents);
  });

  it("the EAF surcharge at the FILED 0.03%", () => {
    expect(applyBasis({ kind: "percent_of_wages", rateMilliPct: 30 }, Q2_2026_GROSS_WAGES_CENTS))
      .toBe(filedFigure("esd-eaf")!.filedAmountCents);
  });

  it("WA Cares at 0.58%", () => {
    expect(applyBasis({ kind: "percent_of_wages", rateMilliPct: 580 }, Q2_2026_GROSS_WAGES_CENTS))
      .toBe(filedFigure("wa-cares")!.filedAmountCents);
  });

  it("PFML the TWO-STEP way reproduces the filed 556.32", () => {
    const twoStep = applyBasis(
      { kind: "share_of_premium", premiumRateMilliPct: 1_130, shareOfPremiumMilliPct: 71_430 },
      Q2_2026_GROSS_WAGES_CENTS,
    );
    expect(twoStep).toBe(filedFigure("pfml-employee")!.filedAmountCents);
    expect(twoStep).toBe(55_632);
  });

  it("PFML COLLAPSED into one rate does NOT reproduce the filing — the trap, proven", () => {
    // 1.13% x 71.43% = 0.8071...%, i.e. 807 milli-percent to the nearest unit.
    const collapsed = applyBasis(
      { kind: "percent_of_wages", rateMilliPct: 807 },
      Q2_2026_GROSS_WAGES_CENTS,
    );
    expect(collapsed).not.toBe(55_632);
  });

  it("L&I is charged per HOUR and ignores wages entirely", () => {
    expect(applyBasis({ kind: "per_hour", rateMilliCentsPerHour: 55_930 }, 0, Q2_2026_TOTAL_HOURS))
      .toBe(filedFigure("lni-premium")!.filedAmountCents);
    expect(filedFigure("lni-premium")!.filedAmountCents).toBe(198_999);
  });

  it("throws rather than rounding when a float reaches a money path", () => {
    expect(() => applyBasis(MEDICARE_EMPLOYEE, 100.5)).toThrow(/integer cents/i);
    expect(() =>
      applyBasis({ kind: "per_hour", rateMilliCentsPerHour: 55_930 }, 0, 3_558.5),
    ).toThrow(/integer hours/i);
  });

  it("zero wages produce zero tax, not a crash", () => {
    expect(applyBasis(MEDICARE_EMPLOYEE, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3) THE TOLERANCE THAT SWALLOWS A REAL ERROR
// ---------------------------------------------------------------------------

describe("maxRoundingDriftCents — derived, never tuned", () => {
  it("scales with headcount instead of being a fixed dollar figure", () => {
    expect(maxRoundingDriftCents(0)).toBe(0);
    expect(maxRoundingDriftCents(1)).toBe(1);
    expect(maxRoundingDriftCents(10)).toBe(5);
    expect(maxRoundingDriftCents(11)).toBe(6);
    expect(maxRoundingDriftCents(400)).toBe(200);
  });

  it("is monotonic — more people can never permit LESS drift", () => {
    for (let n = 1; n < 200; n++) {
      expect(maxRoundingDriftCents(n)).toBeGreaterThanOrEqual(maxRoundingDriftCents(n - 1));
    }
  });

  it("rejects nonsense rather than silently returning a bound", () => {
    expect(() => maxRoundingDriftCents(-1)).toThrow();
    expect(() => maxRoundingDriftCents(2.5)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 1) AND 2) THE CLEAN REPORT THAT SHOULD BE DIRTY, AND VICE VERSA
// ---------------------------------------------------------------------------

describe("buildReconciliationReport — against Michael's real filed quarter", () => {
  const cleanReq = {
    levyName: "Medicare — employee half",
    bornBy: "the employee",
    basis: MEDICARE_EMPLOYEE,
    subjects: perfectSubjects(MEDICARE_EMPLOYEE),
    rateSource: "IRS Pub. 15, 1.45% employee share",
    periodLabel: "Q2 2026",
  };

  it("reproduces Sage §8.3: ten people, every Difference zero", () => {
    const r = buildReconciliationReport(cleanReq);
    expect(r.lines).toHaveLength(10);
    expect(r.everyLineTies).toBe(true);
    expect(r.exceptions).toHaveLength(0);
    expect(r.totalDifferenceCents).toBe(0);
    for (const l of r.lines) expect(l.differenceCents).toBe(0);
  });

  it("the employee Medicare total is the 999.39 the baseline verified", () => {
    const r = buildReconciliationReport(cleanReq);
    expect(r.totalTaxableGrossCents).toBe(Q2_2026_GROSS_WAGES_CENTS);
    expect(r.totalActualWithheldCents).toBe(99_939);
    // And it is exactly half of 941 line 5c, which carries both halves.
    expect(99_939 * 2).toBe(filedFigure("941-line-5c")!.filedAmountCents + 0);
  });

  it("the verdict says 'nothing to chase' in words, not with a green dot", () => {
    const r = buildReconciliationReport(cleanReq);
    expect(r.verdict).toMatch(/nothing to chase/i);
    expect(r.verdict).toContain("10");
  });

  it("CATCHES a single under-withheld employee — the lie that costs the most", () => {
    const subjects = perfectSubjects(MEDICARE_EMPLOYEE);
    const tampered = subjects.map((s, i) =>
      i === 3 ? { ...s, actualWithheldCents: s.actualWithheldCents - 5_000 } : s,
    );
    const r = buildReconciliationReport({ ...cleanReq, subjects: tampered });
    expect(r.everyLineTies).toBe(false);
    expect(r.exceptions).toHaveLength(1);
    expect(r.exceptions[0].displayName).toBe(subjects[3].displayName);
    expect(r.exceptions[0].differenceCents).toBe(-5_000);
    // The verdict must NAME the problem, not merely stop saying it is clean.
    expect(r.verdict).not.toMatch(/nothing to chase/i);
    expect(r.verdict).toContain("-$50.00");
  });

  it("sorts exceptions largest-first, because the biggest usually explains the rest", () => {
    const subjects = perfectSubjects(MEDICARE_EMPLOYEE).map((s, i) =>
      i < 3 ? { ...s, actualWithheldCents: s.actualWithheldCents + (i + 1) * 100 } : s,
    );
    const r = buildReconciliationReport({ ...cleanReq, subjects });
    expect(r.exceptions.map((e) => e.differenceCents)).toEqual([300, 200, 100]);
  });

  it("an OVER-withholding is caught too, not just an under", () => {
    const subjects = perfectSubjects(MEDICARE_EMPLOYEE);
    const tampered = subjects.map((s, i) =>
      i === 0 ? { ...s, actualWithheldCents: s.actualWithheldCents + 1 } : s,
    );
    const r = buildReconciliationReport({ ...cleanReq, subjects: tampered });
    expect(r.exceptions).toHaveLength(1);
    expect(r.exceptions[0].differenceCents).toBe(1);
  });

  it("suppresses the inactive records and SAYS how many — §8.3's 26-for-10", () => {
    const inactive: ReconcileSubject[] = Array.from({ length: 16 }, (_, i) => ({
      subjectId: `inactive-${i}`,
      displayName: `Inactive Person ${i}`,
      taxableGrossCents: 0,
      actualWithheldCents: 0,
    }));
    const r = buildReconciliationReport({
      ...cleanReq,
      subjects: [...cleanReq.subjects, ...inactive],
    });
    expect(r.lines).toHaveLength(10);
    expect(r.hiddenCount).toBe(16);
    expect(r.hiddenDisclosure).toContain("16");
    expect(r.hiddenDisclosure).toContain("26");
    // Suppression must not change a single figure.
    expect(r.totalTaxableGrossCents).toBe(Q2_2026_GROSS_WAGES_CENTS);
    expect(r.everyLineTies).toBe(true);
  });

  it("does NOT suppress someone with zero wages but non-zero withholding", () => {
    // That combination is a genuine defect and hiding it would be the worst
    // possible behaviour: money withheld against no wages at all.
    const r = buildReconciliationReport({
      ...cleanReq,
      subjects: [
        ...cleanReq.subjects,
        {
          subjectId: "ghost",
          displayName: "Ghost Entry",
          taxableGrossCents: 0,
          actualWithheldCents: 1_234,
        },
      ],
    });
    expect(r.hiddenCount).toBe(0);
    expect(r.lines).toHaveLength(11);
    expect(r.exceptions.some((e) => e.displayName === "Ghost Entry")).toBe(true);
  });

  it("every line carries a whole sentence a human can read on its own", () => {
    const r = buildReconciliationReport(cleanReq);
    for (const l of r.lines) {
      expect(l.plain).toContain(l.displayName);
      expect(l.plain.length).toBeGreaterThan(40);
      // No machine tokens leak into the prose (§8.9 defect).
      expect(l.plain).not.toMatch(/_COGS|_SAL|MED_C\b/);
    }
  });

  it("an empty subject list does not crash and does not claim success falsely", () => {
    const r = buildReconciliationReport({ ...cleanReq, subjects: [] });
    expect(r.lines).toHaveLength(0);
    expect(r.totalTaxableGrossCents).toBe(0);
    expect(r.exceptions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// THE FRACTIONS-OF-CENTS RESIDUAL — 941 LINE 7
// ---------------------------------------------------------------------------

describe("fractions of cents — expected rounding must not read as an error", () => {
  it("Medicare on this quarter happens to tie exactly, so no adjustment is claimed", () => {
    const r = buildReconciliationReport({
      levyName: "Medicare — employee half",
      bornBy: "the employee",
      basis: MEDICARE_EMPLOYEE,
      subjects: perfectSubjects(MEDICARE_EMPLOYEE),
      rateSource: "IRS Pub. 15",
      periodLabel: "Q2 2026",
    });
    expect(r.fractionsOfCents.residualCents).toBe(0);
    expect(r.fractionsOfCents.isExpectedRounding).toBe(true);
    expect(r.fractionsOfCents.plain).toMatch(/no fractions-of-cents adjustment/i);
  });

  it("L&I DOES drift by a cent per-person versus the total, and calls it rounding", () => {
    // Verified independently: per-employee hours x rate sums to 1,989.98 while
    // 3,558 hours x $0.5593 in one go is the filed 1,989.99.
    const basis: ExpectationBasis = { kind: "per_hour", rateMilliCentsPerHour: 55_930 };
    const subjects: ReconcileSubject[] = Q2_2026_EMPLOYEES.map((e) => ({
      subjectId: e.subjectId,
      displayName: e.displayName,
      taxableGrossCents: e.wagesCents,
      actualWithheldCents: applyBasis(basis, 0, e.hours),
    }));
    const r = buildReconciliationReport({
      levyName: "Workers' compensation (L&I)",
      bornBy: "Greenway",
      basis,
      subjects,
      hoursBySubjectId: HOURS,
      rateSource: "L&I class 6403-05 at $0.5593 per hour",
      periodLabel: "Q2 2026",
    });
    expect(r.everyLineTies).toBe(true); // every PERSON is right
    expect(r.fractionsOfCents.residualCents).toBe(-1); // the TOTAL differs by a cent
    expect(r.fractionsOfCents.isExpectedRounding).toBe(true);
    expect(r.fractionsOfCents.computedOnTotalCents).toBe(198_999); // the filed figure
    expect(r.fractionsOfCents.plain).toMatch(/rounding, not a mistake/i);
    expect(r.fractionsOfCents.plain).toMatch(/line 7/i);
  });

  it("a residual OUTSIDE the arithmetic bound is NOT excused as rounding", () => {
    // Ten people can drift at most five cents. Force a wage base mismatch far
    // beyond that and the report must stop calling it rounding.
    const basis = MEDICARE_EMPLOYEE;
    const subjects = perfectSubjects(basis);
    const r = buildReconciliationReport({
      levyName: "Medicare — employee half",
      bornBy: "the employee",
      basis,
      subjects,
      rateSource: "IRS Pub. 15",
      periodLabel: "Q2 2026",
    });
    // Sanity: the honest case is inside the bound.
    expect(Math.abs(r.fractionsOfCents.residualCents)).toBeLessThanOrEqual(
      maxRoundingDriftCents(10),
    );

    // Now a genuinely inconsistent base: one person's wages doubled in the
    // detail but not in the total the return was computed on.
    const skewed = subjects.map((s, i) =>
      i === 1 ? { ...s, taxableGrossCents: s.taxableGrossCents + 1_000_000 } : s,
    );
    const bad = buildReconciliationReport({
      levyName: "Medicare — employee half",
      bornBy: "the employee",
      basis,
      subjects: skewed,
      rateSource: "IRS Pub. 15",
      periodLabel: "Q2 2026",
    });
    // The per-person sum and the on-total figure still agree for a flat rate,
    // so the DIFFERENCE column is where this shows up — and it must.
    expect(bad.everyLineTies).toBe(false);
    expect(bad.exceptions.length).toBeGreaterThan(0);
  });

  it("REFUSES to call a large residual rounding — the mutation that survived", () => {
    // Found by the rule-15c mutation run: hard-coding `isExpectedRounding =
    // true` survived, because nothing here had ever exercised the false branch.
    // A report that excuses every gap as rounding is worse than no report, so
    // this is the assertion that makes the branch real.
    //
    // The scenario is a genuine one: the hours the return was computed on do
    // not match the hours in the detail. Ten people can drift at most five
    // cents; this drifts by $559.31, which cannot be rounding.
    const basis: ExpectationBasis = { kind: "per_hour", rateMilliCentsPerHour: 55_930 };
    const subjects: ReconcileSubject[] = Q2_2026_EMPLOYEES.map((e) => ({
      subjectId: e.subjectId,
      displayName: e.displayName,
      taxableGrossCents: e.wagesCents,
      actualWithheldCents: applyBasis(basis, 0, e.hours),
    }));
    const phantomHours = { ...HOURS, "phantom-crew": 1_000 };
    const r = buildReconciliationReport({
      levyName: "Workers' compensation (L&I)",
      bornBy: "Greenway",
      basis,
      subjects,
      hoursBySubjectId: phantomHours,
      rateSource: "L&I class 6403-05 at $0.5593 per hour",
      periodLabel: "Q2 2026",
    });
    expect(r.fractionsOfCents.isExpectedRounding).toBe(false);
    expect(Math.abs(r.fractionsOfCents.residualCents)).toBeGreaterThan(
      maxRoundingDriftCents(10),
    );
    // And it must SAY so, in words, rather than only flipping a boolean.
    expect(r.fractionsOfCents.plain).toMatch(/not rounding/i);
    expect(r.fractionsOfCents.plain).toMatch(/different wage base/i);
    expect(r.fractionsOfCents.plain).not.toMatch(/rounding, not a mistake/i);
  });

  it("the bound is respected exactly at the boundary, not approximately", () => {
    expect(maxRoundingDriftCents(10)).toBe(5);
    expect(maxRoundingDriftCents(1)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// THE MENTOR COVERAGE GATE (standing rule 26)
// ---------------------------------------------------------------------------

describe("payroll-reconciliation-mentor", () => {
  it("teaches every exported function across BOTH core modules", () => {
    expect(() => assertEveryReconciliationFunctionIsTaught()).not.toThrow();
  });

  it("the gate reads a non-empty function list, so it cannot pass vacuously", () => {
    expect(reconciliationExportedFunctionNames().length).toBeGreaterThanOrEqual(5);
  });

  it("cites no authority that does not exist", () => {
    const dangling = reconciliationCitedAuthorityIds().filter(
      (id) => findGuidanceAuthority(id) === undefined,
    );
    expect(dangling).toEqual([]);
  });

  it("every lesson has all five fields genuinely filled in", () => {
    for (const l of RECONCILIATION_LESSONS) {
      expect(l.plainEnglish.length, `${l.fn}.plainEnglish`).toBeGreaterThan(40);
      expect(l.whyItExists.length, `${l.fn}.whyItExists`).toBeGreaterThan(40);
      expect(l.theTrap.length, `${l.fn}.theTrap`).toBeGreaterThan(40);
      expect(l.whatIWouldDo.length, `${l.fn}.whatIWouldDo`).toBeGreaterThan(40);
      expect(l.authorityIds.length, `${l.fn}.authorityIds`).toBeGreaterThan(0);
    }
  });

  it("reconciliationLessonFor finds a real lesson and misses a fake one", () => {
    expect(reconciliationLessonFor("buildReconciliationReport")).toBeDefined();
    expect(reconciliationLessonFor("notARealFunction")).toBeUndefined();
  });

  it("no function is taught twice", () => {
    const names = reconciliationTaughtFunctionNames();
    expect(new Set(names).size).toBe(names.length);
  });
});
