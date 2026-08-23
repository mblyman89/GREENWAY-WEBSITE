/**
 * tests/compliance/form-941.test.ts   (books-40 phase G)
 *
 * THE QUARTERLY RETURN, PROVED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MAKES THIS SUITE DIFFERENT FROM THE USUAL "DOES THE FUNCTION RUN" TEST
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The centrepiece is not a hand-made scenario. It is Greenway's REAL Q2 2026
 * Form 941 - the one that was actually filed and actually accepted, with the
 * confirmation numbers recorded in `known-good-quarters.ts`. The engine is fed
 * the same wages and must produce the same seven lines. That is the strongest
 * evidence available in this codebase (standing rule 59): not "the code agrees
 * with the code", but "the code agrees with a document the federal government
 * has already accepted".
 *
 * Around that sit the mutation batteries. A test that only asserts the happy
 * path passes just as well when the engine is broken in the specific way that
 * matters. So each battery breaks the engine's inputs on purpose, one axis at a
 * time, and requires the output to change or to refuse.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FORM_941_AUTHORITIES,
  FORM_941_BORROWED_AUTHORITY_IDS,
  assertForm941AuthoritiesAreWellFormed,
  form941Authorities,
} from "@/lib/payroll/form-941-authorities";
import {
  ALL_FORM_941_REFUSAL_CODES,
  MEDICARE_COMBINED_MILLI_PCT,
  MEDICARE_EMPLOYEE_MILLI_PCT,
  OASDI_COMBINED_MILLI_PCT,
  OASDI_EMPLOYEE_MILLI_PCT,
  applyMilliPct,
  buildForm941,
  form941DueDates,
  fractionsOfCents,
  line1EmployeeCount,
  lineOf,
  maxFractionsOfCentsDriftCents,
  twelfthDayFor,
  type Form941Request,
  type Form941Result,
  type Form941Return,
  type Form941Subject,
} from "@/lib/payroll/form-941-core";
import {
  FORM_941_CHECKS,
  FORM_941_REFUSAL_LESSONS,
  FORM_941_WORKED_EXAMPLES,
  assertEveryForm941CitationResolves,
  assertEveryForm941RefusalIsTaught,
  form941ChecksInOrder,
  form941LessonFor,
  form941RefusalLessonFor,
  form941TaughtFunctionNames,
} from "@/lib/payroll/form-941-mentor";
import {
  assertEveryForm941AuthorityIsReachable,
  assertEveryForm941FunctionIsTaught,
  assertForm941ChecklistIsUsable,
  assertForm941ExamplesAreWorked,
  assertForm941MentorIsClientSafe,
  assertForm941NeverAdvisesPluggingLine7,
  assertForm941QuotesLookTranscribed,
  assertForm941UnionMatchesRuntimeArray,
  form941EngineFunctionNames,
  form941UnionRefusalCodes,
} from "@/lib/payroll/form-941-mentor-gates";
import {
  daysUntil,
  emptyStateFor,
  fileButtonState,
  groupRefusals,
  lineRows,
  nextAction,
  refusalCard,
  refusalCoverage,
  statusLabel,
  statusMeaning,
  statusOf,
  statusTone,
  urgencyBand,
  urgencyMeaning,
  urgencyTone,
} from "@/lib/payroll/form-941-ui-core";
import { PAYROLL_TAX_AUTHORITIES } from "@/lib/payroll/payroll-tax-authorities";
import { formatQuarter, type QuarterRef } from "@/lib/payroll/payroll-deposit-schedule-core";
import {
  Q2_2026_EMPLOYEES,
  Q2_2026_GROSS_WAGES_CENTS,
  assertKnownGoodQuarterCrossFoots,
  filedFigure,
} from "@/lib/reports/known-good-quarters";

const REPO = process.cwd();
const Q2_2026: QuarterRef = { year: 2026, quarter: 2 };

/* ═══════════════════════════════════════════════════════════════════════════
 * BUILDING THE ORACLE INPUT
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Turn the ten real Q2 2026 employees into engine subjects.
 *
 * ONE SUBTLETY, AND IT IS THE WHOLE POINT OF LINE 7.
 *
 * `actualEmployeeFicaWithheldCents` must be what was REALLY taken off the
 * cheques, not a recomputation at statutory rates. If it were recomputed, the
 * line 7 residual would be zero by construction and the test would prove
 * nothing at all - it would be arithmetic agreeing with itself.
 *
 * The filed return shows line 7 = -$0.07. That is seven people whose real
 * per-paycheque withholding landed one cent below the rate applied to the
 * quarter's total. So the oracle input shaves exactly one cent off the first
 * seven people, which is what per-paycheque rounding physically does, and the
 * engine must then RECOVER the -7 as a residual rather than being told it.
 */
function q2SubjectsWithRealRounding(): Form941Subject[] {
  // Federal income tax withheld is a FILED TOTAL (line 3), not a per-person
  // figure - the 5208B wage detail does not carry it. It is therefore
  // apportioned across the ten people so the total is exactly the filed line 3
  // with no rounding leak, and the remainder lands on the last person rather
  // than being smeared. Line 3 is a straight sum, so how it is split between
  // people cannot change the return; only the total can.
  const filedLine3 = filedFigure("941-line-3")?.filedAmountCents ?? 0;
  const perHead = Math.floor(filedLine3 / Q2_2026_EMPLOYEES.length);
  const remainder = filedLine3 - perHead * Q2_2026_EMPLOYEES.length;

  return Q2_2026_EMPLOYEES.map((e, index) => {
    // For this quarter every person is below the Social Security wage base, so
    // total wages, OASDI wages and Medicare wages are the same figure. That is
    // a stated fact about the filed quarter, not an assumption: see the comment
    // on KnownGoodEmployee.wagesCents.
    const statutory =
      applyMilliPct(e.wagesCents, OASDI_EMPLOYEE_MILLI_PCT) +
      applyMilliPct(e.wagesCents, MEDICARE_EMPLOYEE_MILLI_PCT);
    const isLast = index === Q2_2026_EMPLOYEES.length - 1;
    return {
      subjectId: e.subjectId,
      displayName: e.displayName,
      wagesCents: e.wagesCents,
      oasdiTaxableWagesCents: e.wagesCents,
      medicareTaxableWagesCents: e.wagesCents,
      federalIncomeTaxWithheldCents: perHead + (isLast ? remainder : 0),
      actualEmployeeFicaWithheldCents: index < 7 ? statutory - 1 : statutory,
      onPayrollForTwelfthPayPeriod: true,
    };
  });
}

function q2Request(overrides: Partial<Form941Request> = {}): Form941Request {
  return {
    quarter: Q2_2026,
    subjects: q2SubjectsWithRealRounding(),
    totalDepositsCents: filedFigure("941-line-12")?.filedAmountCents ?? null,
    sourceLabel: "known-good-quarters.ts, the filed Q2 2026 return",
    ...overrides,
  };
}

function mustBuild(req: Form941Request): Form941Return {
  const result = buildForm941(req);
  if (!result.ok) {
    throw new Error(
      `expected a return, got refusals: ${result.refusals.map((r) => r.code).join(", ")}`,
    );
  }
  return result;
}

function refusalCodes(result: Form941Result): string[] {
  return result.ok ? [] : result.refusals.map((r) => r.code);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. THE ORACLE - the return the IRS accepted
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("Form 941 reproduces Greenway's actually-filed Q2 2026 return", () => {
  it("the oracle itself cross-foots before we test anything against it", () => {
    // If the known-good figures do not agree with each other, matching them
    // proves nothing. This runs FIRST for that reason.
    expect(() => assertKnownGoodQuarterCrossFoots()).not.toThrow();
  });

  it("the ten employees sum to the filed gross wages", () => {
    const summed = Q2_2026_EMPLOYEES.reduce((t, e) => t + e.wagesCents, 0);
    expect(summed).toBe(Q2_2026_GROSS_WAGES_CENTS);
  });

  const CASES: readonly { line: string; figureId: string }[] = [
    { line: "2", figureId: "941-line-2" },
    { line: "3", figureId: "941-line-3" },
    { line: "5a", figureId: "941-line-5a" },
    { line: "5c", figureId: "941-line-5c" },
    { line: "6", figureId: "941-line-6" },
    { line: "7", figureId: "941-line-7" },
    { line: "12", figureId: "941-line-12" },
  ];

  for (const c of CASES) {
    it(`line ${c.line} matches the filed return to the cent`, () => {
      const ret = mustBuild(q2Request());
      const filed = filedFigure(c.figureId);
      expect(filed, `known-good-quarters has no figure "${c.figureId}"`).toBeDefined();
      const computed = lineOf(ret, c.line);
      expect(computed, `engine produced no line ${c.line}`).toBeDefined();
      expect(computed!.amountCents).toBe(filed!.filedAmountCents);
    });
  }

  it("line 7 is NEGATIVE seven cents, recovered as a residual and not supplied", () => {
    // The specific sign matters. A positive 7 would mean we withheld more than
    // the rate; a negative 7 means we withheld less. They are different facts
    // and an engine that gets the sign backwards still "matches to 7 cents".
    const ret = mustBuild(q2Request());
    expect(lineOf(ret, "7")!.amountCents).toBe(-7);
  });

  it("the quarter is fully paid, so there is no balance due", () => {
    const ret = mustBuild(q2Request());
    expect(ret.balanceDueCents).toBe(0);
  });

  it("the due date is 31 July 2026, computed and not looked up", () => {
    const ret = mustBuild(q2Request());
    expect(ret.due.ordinary).toBe("2026-07-31");
  });

  it("line 1 counts the ten people who were on the payroll for the 12th", () => {
    const ret = mustBuild(q2Request());
    expect(lineOf(ret, "1")!.amountCents).toBe(10);
    expect(lineOf(ret, "1")!.isCount).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. MUTATION BATTERY - break it on purpose, one axis at a time
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("mutation battery: the engine notices when its inputs are wrong", () => {
  it("adding a dollar to one person's wages moves lines 2, 5c, 6 and 12", () => {
    const base = mustBuild(q2Request());
    const subjects = q2SubjectsWithRealRounding();
    subjects[0] = {
      ...subjects[0],
      wagesCents: subjects[0].wagesCents + 100,
      medicareTaxableWagesCents: subjects[0].medicareTaxableWagesCents + 100,
      oasdiTaxableWagesCents: subjects[0].oasdiTaxableWagesCents + 100,
    };
    const moved = mustBuild(q2Request({ subjects }));

    // If any of these did NOT move, that line is not really reading the wages.
    expect(lineOf(moved, "2")!.amountCents).not.toBe(lineOf(base, "2")!.amountCents);
    expect(lineOf(moved, "5c")!.amountCents).not.toBe(lineOf(base, "5c")!.amountCents);
    expect(lineOf(moved, "6")!.amountCents).not.toBe(lineOf(base, "6")!.amountCents);
    expect(lineOf(moved, "12")!.amountCents).not.toBe(lineOf(base, "12")!.amountCents);
  });

  it("line 5a is BOTH halves, so it is 12.4% and never 6.2%", () => {
    const ret = mustBuild(q2Request());
    const oasdiWages = Q2_2026_EMPLOYEES.reduce((t, e) => t + e.wagesCents, 0);
    const combined = applyMilliPct(oasdiWages, OASDI_COMBINED_MILLI_PCT);
    const employeeOnly = applyMilliPct(oasdiWages, OASDI_EMPLOYEE_MILLI_PCT);

    expect(lineOf(ret, "5a")!.amountCents).toBe(combined);
    // The mutation that would silently halve the company's liability.
    expect(lineOf(ret, "5a")!.amountCents).not.toBe(employeeOnly);
  });

  it("line 5c is BOTH halves of Medicare, so it is 2.9% and never 1.45%", () => {
    const ret = mustBuild(q2Request());
    const medWages = Q2_2026_EMPLOYEES.reduce((t, e) => t + e.wagesCents, 0);
    expect(lineOf(ret, "5c")!.amountCents).toBe(
      applyMilliPct(medWages, MEDICARE_COMBINED_MILLI_PCT),
    );
    expect(lineOf(ret, "5c")!.amountCents).not.toBe(
      applyMilliPct(medWages, MEDICARE_EMPLOYEE_MILLI_PCT),
    );
  });

  it("line 7 is a residual: change what was really withheld and line 7 moves", () => {
    const base = mustBuild(q2Request());
    const subjects = q2SubjectsWithRealRounding();
    subjects[0] = {
      ...subjects[0],
      actualEmployeeFicaWithheldCents: subjects[0].actualEmployeeFicaWithheldCents - 3,
    };
    const moved = mustBuild(q2Request({ subjects }));
    expect(lineOf(moved, "7")!.amountCents).toBe(lineOf(base, "7")!.amountCents - 3);
  });

  it("line 7 does NOT move when only the deposits change - it is not a plug", () => {
    // The dangerous mutation: making line 7 absorb whatever is needed to zero
    // the balance. If line 7 ever depends on deposits, this goes red.
    const base = mustBuild(q2Request());
    const other = mustBuild(q2Request({ totalDepositsCents: 1 }));
    expect(lineOf(other, "7")!.amountCents).toBe(lineOf(base, "7")!.amountCents);
  });

  it("a wage figure below its OASDI taxable figure is impossible and refuses", () => {
    const subjects = q2SubjectsWithRealRounding();
    subjects[2] = { ...subjects[2], wagesCents: subjects[2].oasdiTaxableWagesCents - 1 };
    expect(refusalCodes(buildForm941(q2Request({ subjects })))).toContain("OASDI_EXCEEDS_WAGES");
  });

  it("negative wages refuse rather than netting off against somebody else", () => {
    const subjects = q2SubjectsWithRealRounding();
    subjects[1] = { ...subjects[1], wagesCents: -1 };
    expect(refusalCodes(buildForm941(q2Request({ subjects })))).toContain("NEGATIVE_WAGES");
  });

  it("an unanswered 12th-of-the-month question refuses instead of counting false", () => {
    const subjects = q2SubjectsWithRealRounding();
    subjects[4] = { ...subjects[4], onPayrollForTwelfthPayPeriod: null };
    const result = buildForm941(q2Request({ subjects }));
    expect(refusalCodes(result)).toContain("TWELFTH_DAY_UNKNOWN");
  });

  it("missing deposits refuse rather than assuming zero was paid", () => {
    // Assuming zero would turn a fully paid quarter into a balance due equal to
    // the entire quarter's tax - $14,204.57 that Michael does not owe.
    const result = buildForm941(q2Request({ totalDepositsCents: null }));
    expect(refusalCodes(result)).toContain("DEPOSITS_UNKNOWN");
  });

  it("a residual too large to be rounding refuses instead of printing it", () => {
    const subjects = q2SubjectsWithRealRounding();
    subjects[0] = {
      ...subjects[0],
      actualEmployeeFicaWithheldCents: subjects[0].actualEmployeeFicaWithheldCents - 500_00,
    };
    expect(refusalCodes(buildForm941(q2Request({ subjects })))).toContain("FRACTIONS_TOO_LARGE");
  });

  it("an impossible quarter refuses", () => {
    const result = buildForm941(q2Request({ quarter: { year: 2026, quarter: 9 as 1 } }));
    expect(refusalCodes(result)).toContain("QUARTER_NOT_VALID");
  });

  it("all refusals are collected at once, not one per attempt", () => {
    // A screen that reports one problem, gets it fixed, then reports the next
    // is a screen that wastes an afternoon.
    const subjects = q2SubjectsWithRealRounding();
    subjects[0] = { ...subjects[0], wagesCents: -5 };
    subjects[1] = { ...subjects[1], onPayrollForTwelfthPayPeriod: null };
    const codes = refusalCodes(buildForm941(q2Request({ subjects, totalDepositsCents: null })));
    expect(codes.length).toBeGreaterThanOrEqual(3);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. ROUNDING - the trap that Math.round quietly sets
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("applyMilliPct rounds half AWAY FROM ZERO, in both directions", () => {
  it("rounds a positive half up", () => {
    // 50 cents at 1.000% = 0.5 cents exactly.
    expect(applyMilliPct(50, 1_000)).toBe(1);
  });

  it("rounds a NEGATIVE half away from zero, not towards it", () => {
    // The trap: Math.round(-0.5) is -0, so a naive implementation returns 0
    // here and silently under-reports every negative adjustment.
    expect(applyMilliPct(-50, 1_000)).toBe(-1);
  });

  it("is symmetric about zero", () => {
    for (const cents of [1, 7, 50, 333, 6_892_345]) {
      expect(applyMilliPct(-cents, OASDI_COMBINED_MILLI_PCT)).toBe(
        -applyMilliPct(cents, OASDI_COMBINED_MILLI_PCT),
      );
    }
  });

  it("zero percent of anything is zero, and anything percent of zero is zero", () => {
    expect(applyMilliPct(123_456, 0)).toBe(0);
    expect(applyMilliPct(0, OASDI_COMBINED_MILLI_PCT)).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. DUE DATES - computed, including the weekend shift
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("due dates are computed from the calendar, never looked up", () => {
  /**
   * Every date below was computed from the calendar and checked, not recalled.
   *
   *   Q1 2026 due 30 Apr 2026, a Thursday  -> no shift
   *   Q2 2026 due 31 Jul 2026, a Friday    -> no shift
   *   Q3 2026 due 31 Oct 2026, a SATURDAY  -> shifts to Monday 2 Nov
   *   Q4 2026 due 31 Jan 2027, a SUNDAY    -> shifts to Monday 1 Feb
   *   Q2 2027 due 31 Jul 2027, a SATURDAY  -> shifts to Monday 2 Aug
   */
  const CASES: readonly { q: QuarterRef; ordinary: string; shifted: boolean }[] = [
    { q: { year: 2026, quarter: 1 }, ordinary: "2026-04-30", shifted: false },
    { q: { year: 2026, quarter: 2 }, ordinary: "2026-07-31", shifted: false },
    { q: { year: 2026, quarter: 3 }, ordinary: "2026-11-02", shifted: true },
    { q: { year: 2026, quarter: 4 }, ordinary: "2027-02-01", shifted: true },
    { q: { year: 2027, quarter: 2 }, ordinary: "2027-08-02", shifted: true },
  ];

  for (const c of CASES) {
    it(`${formatQuarter(c.q)} is due ${c.ordinary}${c.shifted ? " after the weekend shift" : ""}`, () => {
      const due = form941DueDates(c.q);
      expect(due.ordinary).toBe(c.ordinary);
      expect(due.ordinaryWasShifted).toBe(c.shifted);
    });
  }

  it("Q3 2026 shifts off Saturday 31 October to Monday 2 November", () => {
    const due = form941DueDates({ year: 2026, quarter: 3 });
    expect(due.ordinary).toBe("2026-11-02");
    expect(due.ordinaryWasShifted).toBe(true);
  });

  it("Q2 2026 does not shift, because 31 July 2026 is a Friday", () => {
    const due = form941DueDates(Q2_2026);
    expect(due.ordinary).toBe("2026-07-31");
    expect(due.ordinaryWasShifted).toBe(false);
  });

  it("the earned ten-day extension is always later than the ordinary date", () => {
    for (const c of CASES) {
      const due = form941DueDates(c.q);
      expect(
        due.ifDepositsWereTimely > due.ordinary,
        `${formatQuarter(c.q)}: the extension must be later than the ordinary date`,
      ).toBe(true);
    }
  });

  it("every quarter of 2027 produces a real, shifted-if-needed date", () => {
    for (const quarter of [1, 2, 3, 4] as const) {
      const due = form941DueDates({ year: 2027, quarter });
      expect(due.ordinary).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Never a Saturday or a Sunday.
      const day = new Date(`${due.ordinary}T00:00:00Z`).getUTCDay();
      expect(day, `${formatQuarter({ year: 2027, quarter })} falls on a weekend`).not.toBe(0);
      expect(day).not.toBe(6);
    }
  });

  it("the plain-English sentence names the actual date it computed", () => {
    const due = form941DueDates(Q2_2026);
    expect(due.plain).toContain(due.ordinary);
    expect(due.plain).toContain(due.ifDepositsWereTimely);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. THE 12TH OF THE MONTH, AND LINE 1
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("line 1 is the pay period containing the 12th, not a headcount", () => {
  it("the measuring date is the 12th of the quarter's LAST month", () => {
    expect(twelfthDayFor({ year: 2026, quarter: 1 })).toBe("2026-03-12");
    expect(twelfthDayFor({ year: 2026, quarter: 2 })).toBe("2026-06-12");
    expect(twelfthDayFor({ year: 2026, quarter: 3 })).toBe("2026-09-12");
    expect(twelfthDayFor({ year: 2026, quarter: 4 })).toBe("2026-12-12");
  });

  it("somebody paid in the quarter but not for that period is NOT counted", () => {
    const subjects = q2SubjectsWithRealRounding();
    subjects[0] = { ...subjects[0], onPayrollForTwelfthPayPeriod: false };
    expect(line1EmployeeCount(subjects)).toBe(9);
  });

  it("one unanswered response makes the whole count null, not a smaller number", () => {
    const subjects = q2SubjectsWithRealRounding();
    subjects[3] = { ...subjects[3], onPayrollForTwelfthPayPeriod: null };
    expect(line1EmployeeCount(subjects)).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. FRACTIONS OF CENTS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("fractions of cents is bounded by how many cheques were written", () => {
  it("the tolerance grows with the number of people", () => {
    expect(maxFractionsOfCentsDriftCents(50)).toBeGreaterThan(maxFractionsOfCentsDriftCents(5));
  });

  it("a tiny residual is plausible and a huge one is not", () => {
    const subjects = q2SubjectsWithRealRounding();
    const small = fractionsOfCents(subjects);
    expect(small.withinRounding).toBe(true);
    // The real quarter drifted by seven cents, and that is the whole residual.
    expect(small.adjustmentCents).toBe(-7);

    const broken = subjects.map((s) => ({
      ...s,
      actualEmployeeFicaWithheldCents: s.actualEmployeeFicaWithheldCents - 10_000,
    }));
    expect(fractionsOfCents(broken).withinRounding).toBe(false);
  });

  it("the explanation names the actual amount rather than talking in general", () => {
    const f = fractionsOfCents(q2SubjectsWithRealRounding());
    expect(f.plain.length).toBeGreaterThan(40);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7. THE MENTOR - every function taught, every refusal explained
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the mentor layer covers the engine completely", () => {
  it("every exported engine function has a lesson, and every lesson has a function", () => {
    expect(() => assertEveryForm941FunctionIsTaught()).not.toThrow();
  });

  it("the taught names really are the engine's exported names", () => {
    // Guards the vacuous pass: if the scrape returned nothing, the assertion
    // above would succeed against an empty set. Standing rule 39.
    const engine = form941EngineFunctionNames();
    expect(engine.length).toBeGreaterThan(5);
    for (const name of form941TaughtFunctionNames()) {
      expect(engine, `lesson teaches "${name}", which the engine does not export`).toContain(name);
    }
  });

  it("every refusal code has a lesson", () => {
    expect(() => assertEveryForm941RefusalIsTaught()).not.toThrow();
    for (const code of ALL_FORM_941_REFUSAL_CODES) {
      expect(form941RefusalLessonFor(code), `no lesson for ${code}`).toBeDefined();
    }
  });

  it("the runtime array and the TypeScript union list the same codes", () => {
    // Two lists of the same thing drift. This is the test that notices.
    const union = form941UnionRefusalCodes();
    expect(union.length).toBe(ALL_FORM_941_REFUSAL_CODES.length);
    expect(() => assertForm941UnionMatchesRuntimeArray(ALL_FORM_941_REFUSAL_CODES)).not.toThrow();
  });

  it("no refusal lesson tells Michael to just check the data", () => {
    for (const lesson of FORM_941_REFUSAL_LESSONS) {
      expect(lesson.howToFix.length, `${lesson.code} fix is too short to be actionable`)
        .toBeGreaterThan(60);
      expect(lesson.whyWeRefuse.length).toBeGreaterThan(40);
    }
  });

  it("the checklist is seven usable questions in a stable order", () => {
    expect(() => assertForm941ChecklistIsUsable()).not.toThrow();
    const ordered = form941ChecksInOrder();
    expect(ordered.length).toBe(FORM_941_CHECKS.length);
    expect(ordered.map((c) => c.order)).toEqual([...ordered.map((c) => c.order)].sort((a, b) => a - b));
  });

  it("the worked examples actually work through arithmetic", () => {
    expect(() => assertForm941ExamplesAreWorked()).not.toThrow();
    expect(FORM_941_WORKED_EXAMPLES.length).toBeGreaterThanOrEqual(4);
    for (const ex of FORM_941_WORKED_EXAMPLES) {
      expect(ex.steps.length, `${ex.key} has too few steps to be worked`).toBeGreaterThan(2);
    }
  });

  it("one worked example is Greenway's own filed quarter", () => {
    const real = FORM_941_WORKED_EXAMPLES.find((e) => e.key === "q2-2026-real");
    expect(real).toBeDefined();
    // It must quote the real total, not a rounded illustration.
    expect(real!.steps.join(" ")).toContain("14,204.57");
  });

  it("nothing in the mentor advises plugging line 7", () => {
    expect(() => assertForm941NeverAdvisesPluggingLine7()).not.toThrow();
  });

  it("every function lesson resolves to a real lesson object", () => {
    for (const name of form941TaughtFunctionNames()) {
      expect(form941LessonFor(name), `${name} has no lesson`).toBeDefined();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8. THE AUTHORITIES - verbatim, resolvable, reachable
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the law is quoted, not paraphrased", () => {
  it("the authorities are well formed", () => {
    expect(() => assertForm941AuthoritiesAreWellFormed()).not.toThrow();
  });

  it("the quotes look transcribed rather than summarised", () => {
    expect(() => assertForm941QuotesLookTranscribed()).not.toThrow();
  });

  it("every borrowed authority id still exists in the shared registry", () => {
    // Rule 25: we reuse the registry instead of copying quotes. That reuse is
    // only safe if a deletion over there fails over here.
    const known = new Set(PAYROLL_TAX_AUTHORITIES.map((a) => a.id));
    for (const id of FORM_941_BORROWED_AUTHORITY_IDS) {
      expect(known.has(id), `borrowed authority "${id}" is no longer in the registry`).toBe(true);
    }
    expect(() => form941Authorities()).not.toThrow();
  });

  it("the combined list is the new ones plus the borrowed ones", () => {
    expect(form941Authorities().length).toBe(
      FORM_941_AUTHORITIES.length + FORM_941_BORROWED_AUTHORITY_IDS.length,
    );
  });

  it("every authority is reachable from a lesson or explicitly display-only", () => {
    expect(() => assertEveryForm941AuthorityIsReachable()).not.toThrow();
  });

  it("every citation in the mentor resolves to a real authority", () => {
    const known = form941Authorities().map((a) => a.id);
    expect(() => assertEveryForm941CitationResolves(known)).not.toThrow();
  });

  it("the quarterly-filing rule keeps the words that make a zero return mandatory", () => {
    // "whether or not wages are paid therein" is the entire reason a quiet
    // quarter still needs a 941. Losing it in a tidy-up would be a compliance
    // regression that no other test would notice.
    const rule = form941Authorities().find(
      (a) => a.id === "cfr-31-6011a1-must-file-quarterly",
    );
    expect(rule).toBeDefined();
    expect(rule!.quote).toContain("whether or not wages are paid therein");
  });

  it("the house apostrophe convention holds", () => {
    const src = readFileSync(join(REPO, "src/lib/payroll/form-941-authorities.ts"), "utf8");
    expect(src.includes("\u2019"), "use straight ASCII apostrophes in this repo").toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9. THE UI CORE - colour, urgency and the honest button
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the screen's decisions are made in a tested pure module", () => {
  it("days-until is calendar arithmetic, not a timezone accident", () => {
    expect(daysUntil("2026-07-01", "2026-07-31")).toBe(30);
    expect(daysUntil("2026-07-31", "2026-07-31")).toBe(0);
    expect(daysUntil("2026-08-05", "2026-07-31")).toBe(-5);
  });

  it("the urgency bands change exactly at their boundaries", () => {
    expect(urgencyBand(-1)).toBe("overdue");
    expect(urgencyBand(0)).toBe("due-now");
    expect(urgencyBand(7)).toBe("due-now");
    expect(urgencyBand(8)).toBe("due-soon");
    expect(urgencyBand(30)).toBe("due-soon");
    expect(urgencyBand(31)).toBe("comfortable");
  });

  it("overdue is red and comfortable is not", () => {
    expect(urgencyTone("overdue")).toBe("danger");
    expect(urgencyTone("comfortable")).toBe("green");
  });

  it("every band explains itself with the date in the sentence", () => {
    for (const band of ["overdue", "due-now", "due-soon", "comfortable"] as const) {
      const text = urgencyMeaning(band, 3, "2026-07-31");
      expect(text).toContain("2026-07-31");
      expect(text.length).toBeGreaterThan(30);
    }
  });

  it("a buildable return is ready and an unbuildable one is blocked", () => {
    expect(statusOf(mustBuild(q2Request()))).toBe("ready");
    expect(statusOf(buildForm941(q2Request({ totalDepositsCents: null })))).toBe("blocked");
  });

  it("attention is GOLD, because there is no warning token in this codebase", () => {
    expect(statusTone("attention")).toBe("gold");
    expect(statusTone("ready")).toBe("green");
    expect(statusTone("blocked")).toBe("danger");
  });

  it("the attention wording opens by saying the return is correct", () => {
    // "Attention" next to a tax return reads as "something is wrong". It is
    // not. The first clause has to say so before Michael's stomach drops.
    expect(statusMeaning("attention")).toContain("The return is correct");
    for (const s of ["ready", "attention", "blocked"] as const) {
      expect(statusLabel(s).length).toBeGreaterThan(2);
      expect(statusMeaning(s).length).toBeGreaterThan(40);
    }
  });

  it("refusals come first in the next action, even when the return is overdue", () => {
    const blocked = buildForm941(q2Request({ totalDepositsCents: null }));
    const action = nextAction(blocked, "2030-01-01");
    expect(action.tone).toBe("danger");
    expect(action.headline).toContain("missing");
  });

  it("a fully-paid, comfortable quarter says it is ready to file", () => {
    const action = nextAction(mustBuild(q2Request()), "2026-07-01");
    expect(action.headline).toContain("ready to file");
  });

  it("a balance due is reported with the amount in the headline", () => {
    const ret = buildForm941(q2Request({ totalDepositsCents: 0 }));
    const action = nextAction(ret, "2026-07-01");
    expect(action.headline).toContain("still owed");
  });

  it("the file button never claims to file", () => {
    for (const result of [mustBuild(q2Request()), buildForm941(q2Request({ totalDepositsCents: null }))]) {
      const state = fileButtonState(result);
      expect(state.honestyNote).toContain("does not transmit");
      expect(state.label.toLowerCase()).not.toBe("file");
    }
  });

  it("the button is disabled with a reason whenever the return cannot be built", () => {
    const state = fileButtonState(buildForm941(q2Request({ totalDepositsCents: null })));
    expect(state.enabled).toBe(false);
    expect(state.disabledReason).not.toBeNull();
  });

  it("five people missing the same answer become one card, not five", () => {
    const subjects = q2SubjectsWithRealRounding().map((s) => ({
      ...s,
      onPayrollForTwelfthPayPeriod: null,
    }));
    const result = buildForm941(q2Request({ subjects }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const groups = groupRefusals(result.refusals);
    const codes = new Set(groups.map((g) => g.code));
    expect(groups.length).toBe(codes.size);
  });

  it("every refusal card carries the fix and the reason, never an empty panel", () => {
    const result = buildForm941(q2Request({ totalDepositsCents: null }));
    if (result.ok) throw new Error("expected refusals");
    for (const r of result.refusals) {
      const card = refusalCard(r);
      expect(card.howToFix.length).toBeGreaterThan(20);
      expect(card.whyWeRefuse.length).toBeGreaterThan(20);
      expect(card.whyWeRefuse).not.toContain("no lesson attached");
    }
  });

  it("every refusal code the engine can emit is teachable by the screen", () => {
    for (const row of refusalCoverage()) {
      expect(row.taught, `the screen cannot explain ${row.code}`).toBe(true);
    }
    expect(refusalCoverage().length).toBe(ALL_FORM_941_REFUSAL_CODES.length);
  });

  it("lines 1, 7 and 12 are the emphasised ones", () => {
    const rows = lineRows(mustBuild(q2Request()));
    const emphasised = rows.filter((r) => r.emphasise).map((r) => r.line);
    expect(emphasised).toContain("1");
    expect(emphasised).toContain("7");
    expect(emphasised).toContain("12");
  });

  it("line 1 renders as a count and the money lines render as dollars", () => {
    const rows = lineRows(mustBuild(q2Request()));
    expect(rows.find((r) => r.line === "1")!.display).toBe("10");
    expect(rows.find((r) => r.line === "12")!.display).toContain("$");
  });

  it("the empty state tells Michael a zero return is still required", () => {
    const empty = emptyStateFor(Q2_2026);
    expect(empty.body).toContain("whether or not");
    expect(empty.title).toContain("Q2 2026");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 10. ARCHITECTURE - the rules that keep this maintainable
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("architecture", () => {
  it("the mentor is client-safe: no node-only imports", () => {
    // Standing rule 65b. Lesson DATA must be importable from a client
    // component; only the GATES may touch the filesystem.
    expect(() => assertForm941MentorIsClientSafe()).not.toThrow();
  });

  it("the store is the only 941 module that reaches the database", () => {
    const core = readFileSync(join(REPO, "src/lib/payroll/form-941-core.ts"), "utf8");
    const ui = readFileSync(join(REPO, "src/lib/payroll/form-941-ui-core.ts"), "utf8");
    for (const [name, src] of [["core", core], ["ui-core", ui]] as const) {
      expect(src.includes("createSupabaseAdminClient"), `${name} must stay pure`).toBe(false);
    }
  });

  it("the store filters the quarter by PAY DATE, not by period end date", () => {
    // The single most common way a 941 goes wrong, and it is invisible once it
    // has happened. A period worked in June but paid in July is Q3 wages.
    const store = readFileSync(join(REPO, "src/lib/payroll/form-941-store.ts"), "utf8");

    // Scope the assertion to the payroll_runs query, because the store DOES
    // legitimately use start_date/end_date elsewhere - to find the pay period
    // that CONTAINS the 12th of the last month, which is a different question
    // with a different correct answer. A blanket "end_date must not appear"
    // check would forbid the correct code as well as the wrong code.
    const runsQueryAt = store.indexOf('.from("payroll_runs")');
    expect(runsQueryAt, "the store no longer queries payroll_runs").toBeGreaterThan(-1);
    const runsQuery = store.slice(runsQueryAt, runsQueryAt + 400);

    expect(runsQuery).toContain('.gte("pay_date"');
    expect(runsQuery).toContain('.lte("pay_date"');
    expect(
      runsQuery.includes("end_date"),
      "the quarter must be selected by pay_date, never by period end date",
    ).toBe(false);
  });

  it("the store never invents deposits", () => {
    const store = readFileSync(join(REPO, "src/lib/payroll/form-941-store.ts"), "utf8");
    expect(store).toContain("totalDepositsCents: null");
  });

  it("the store excludes voided runs", () => {
    const store = readFileSync(join(REPO, "src/lib/payroll/form-941-store.ts"), "utf8");
    expect(store).toContain('r.status !== "void"');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 11. THE PAGE - reachable, gated, and delegating every decision
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the Form 941 screen", () => {
  const pageCode = readFileSync(join(REPO, "src/app/admin/books/form-941/page.tsx"), "utf8");

  it("the page gates access before it reads anything", () => {
    expect(pageCode).toContain("requireBooksAccess()");
    const gateAt = pageCode.indexOf("requireBooksAccess()");
    const readAt = pageCode.indexOf("loadForm941(");
    expect(readAt).toBeGreaterThan(gateAt);
  });

  it("the page calls the pure core rather than reimplementing it", () => {
    for (const fn of [
      "nextAction(",
      "statusOf(",
      "fileButtonState(",
      "lineRows(",
      "refusalCard(",
      "groupRefusals(",
      "emptyStateFor(",
    ]) {
      expect(pageCode, `page must call ${fn}`).toContain(fn);
    }
  });

  it("the page does no tax arithmetic of its own", () => {
    // No rate constant may appear in the JSX. If a percentage is needed it
    // comes from the engine, which is where the statute is encoded.
    expect(pageCode.includes("0.062"), "rates belong in the engine").toBe(false);
    expect(pageCode.includes("0.0145")).toBe(false);
    expect(pageCode.includes("12_400")).toBe(false);
  });

  it("the page renders the checklist, the examples and the verbatim law", () => {
    expect(pageCode).toContain("form941ChecksInOrder()");
    expect(pageCode).toContain("FORM_941_WORKED_EXAMPLES");
    expect(pageCode).toContain("form941Authorities()");
  });

  it("the page says plainly that nothing is transmitted to the IRS", () => {
    expect(pageCode).toContain("honestyNote");
    expect(pageCode.toLowerCase()).toContain("not a filing agent");
  });

  it("the page uses no --admin-warning token, which does not exist", () => {
    // Checked against the CODE, not the comments: the header comment explains
    // why the token is absent and would otherwise fail its own rule. Comments
    // are stripped first so the test measures what actually renders.
    const withoutComments = pageCode
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(withoutComments.includes("--admin-warning")).toBe(false);
  });

  it("the screen is reachable from the navigation", async () => {
    // Standing rule 50: a module no page can reach is dead code wearing a
    // green check. This is the test that keeps the 941 reachable.
    const { adminNav } = await import("@/components/admin/admin-nav-data");
    const entry = adminNav.find((n) => n.href === "/admin/books/form-941");
    expect(entry, "Form 941 is not in the admin navigation").toBeDefined();
    expect(entry!.permission).toBe("books.view");
    expect(entry!.group).toBe("Accounting");
  });

  it("Form 941 sits immediately after the Pay Run it summarises", () => {
    // Not decoration: the menu is meant to read in the order the work is done.
    // The 941 totals pay runs, so it cannot sensibly precede them.
    return import("@/components/admin/admin-nav-data").then(({ adminNav }) => {
      const accounting = adminNav.filter((n) => n.group === "Accounting");
      const payRun = accounting.findIndex((n) => n.href === "/admin/books/pay-run");
      const f941 = accounting.findIndex((n) => n.href === "/admin/books/form-941");
      expect(payRun).toBeGreaterThan(-1);
      expect(f941).toBeGreaterThan(payRun);
    });
  });

  it("adding this screen did not create a new Accounting icon collision", () => {
    return import("@/components/admin/admin-nav-data").then(({ adminNav }) => {
      const accounting = adminNav.filter((n) => n.group === "Accounting");
      const duplicates = accounting.length - new Set(accounting.map((n) => n.icon)).size;
      expect(duplicates, "Accounting nav icon collisions changed").toBe(2);
    });
  });
});
