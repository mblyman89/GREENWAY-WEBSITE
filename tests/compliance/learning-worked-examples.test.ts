import { describe, it, expect } from "vitest";

import {
  allWorkedExamples,
  workedExampleFor,
  lessonsWithWorkedExamples,
  workedExampleCoverage,
  dorAnnualRateMilliPercentFor,
  money,
  ENGINE_REFUSAL_MARKER,
  type WorkedExample,
} from "@/lib/accounting/worked-examples-core";
import {
  assertWorkedExamplesAreWellFormed,
  assertEveryExampleTargetsARealLesson,
  assertNoDuplicateExampleTargets,
  assertEveryExampleIsSubstantive,
  assertEveryExampleShowsATrap,
  assertExamplesAreBuiltFromEngines,
  assertNoHandTypedMoneyInExamples,
  assertNoExampleRendersARefusal,
  assertSamenessClaimsAreTrue,
} from "@/lib/accounting/worked-examples-gates";
import { allLessons, lessonKey, type LessonSourceKey } from "@/lib/accounting/learning-path-core";
import { DOR_ANNUAL_RATES } from "@/lib/accounting/interest-rates-evidenced";

/* ==========================================================================
 * WORKED EXAMPLES — THE TEACHING LAYER, CHECKED AGAINST THE ENGINES
 *
 * Not to be confused with tests/compliance/timesheet-worked-examples.test.ts,
 * which executes the Department of Labor's own published arithmetic against the
 * timesheet engine. That file asks "is the ENGINE right?". This file asks a
 * different question: "does what Michael READS on the learning screen match
 * what the engines actually do?"
 *
 * Those are genuinely different failure modes. An engine can be perfectly
 * correct while the example beside it teaches the opposite, and no test of the
 * engine will ever notice, because the example is prose as far as the compiler
 * is concerned.
 *
 * THIS IS NOT HYPOTHETICAL. While building worked-examples-core.ts the SSN
 * example was written around "078-05-1120" — the 1938 wallet-card number — as
 * the one the system REFUSES. Calling ssnProblems() showed the reverse: the
 * engine accepts it and refuses "123-45-6789". The prose was confidently
 * backwards and would have shipped. Section 4 below locks that specific pair
 * down permanently.
 * ========================================================================== */

/** A minimal well-formed example, used to drive the gates negative. */
function goodExample(over: Partial<WorkedExample> = {}): WorkedExample {
  return {
    lessonKey: "penalties:computeDorPenalty",
    title: "A title",
    setup: "A setup sentence long enough to clear the minimum length the gate enforces.",
    rows: [
      { given: "First case", output: "$1.00", soWhat: "Something meaningful about it." },
      { given: "Second case", output: "$2.00", soWhat: "Something else meaningful.", isTrap: true },
    ],
    takeaway: "A takeaway sentence long enough to clear the minimum length the gate enforces.",
    ...over,
  };
}

describe("1) the worked examples are structurally sound", () => {
  it("every example points at a lesson that really exists in the curriculum", () => {
    const real = new Set(allLessons().map((l) => lessonKey(l.source as LessonSourceKey, l.fn)));
    expect(real.size).toBeGreaterThan(50); // non-vacuity: the curriculum loaded

    for (const e of allWorkedExamples()) {
      expect(real.has(e.lessonKey), `${e.lessonKey} is not a real lesson key`).toBe(true);
    }
  });

  it("there are examples at all, and each is reachable by its key", () => {
    const examples = allWorkedExamples();
    expect(examples.length).toBeGreaterThan(0);

    for (const e of examples) {
      expect(workedExampleFor(e.lessonKey)).toEqual(e);
    }
    expect(workedExampleFor("penalties:thisFunctionDoesNotExist")).toBeNull();
  });

  it("lessonsWithWorkedExamples() agrees with the examples themselves", () => {
    expect([...lessonsWithWorkedExamples()].sort()).toEqual(
      allWorkedExamples().map((e) => e.lessonKey).sort(),
    );
  });

  it("the full gate suite passes on the real examples", () => {
    expect(() => assertWorkedExamplesAreWellFormed()).not.toThrow();
  });
});

/* ==========================================================================
 * 2) EVERY GATE IS PROVABLY FAILABLE
 *
 * Standing rule 39: a check that cannot fail is not a check. Each gate below is
 * driven with a deliberately broken example and must reject it. Without this
 * section a typo in a gate's condition would leave it permanently green while
 * appearing to guard something.
 * ========================================================================== */

describe("2) every gate rejects the defect it exists to catch", () => {
  it("the real-lesson gate rejects a key that does not exist", () => {
    expect(() =>
      assertEveryExampleTargetsARealLesson([goodExample({ lessonKey: "penalties:notARealFn" })]),
    ).toThrow(/does not exist/);
  });

  it("the real-lesson gate rejects an empty list rather than passing vacuously", () => {
    expect(() => assertEveryExampleTargetsARealLesson([])).toThrow(/vacuously/);
  });

  it("the duplicate gate rejects two examples claiming one lesson", () => {
    expect(() =>
      assertNoDuplicateExampleTargets([goodExample(), goodExample()]),
    ).toThrow(/duplicate lesson keys/);
  });

  it("the substance gate rejects a single-row example", () => {
    expect(() =>
      assertEveryExampleIsSubstantive([
        goodExample({ rows: [{ given: "Only case", output: "$1.00", soWhat: "Not a comparison at all." }] }),
      ]),
    ).toThrow(/One row is a sentence/);
  });

  it("the substance gate rejects an example whose outputs contain no numbers", () => {
    expect(() =>
      assertEveryExampleIsSubstantive([
        goodExample({
          rows: [
            { given: "A", output: "quite a lot", soWhat: "A vague statement about it." },
            { given: "B", output: "rather less", soWhat: "Another vague statement." },
          ],
        }),
      ]),
    ).toThrow(/not one row output contains a digit/);
  });

  it("the substance gate rejects a row with no explanation", () => {
    expect(() =>
      assertEveryExampleIsSubstantive([
        goodExample({
          rows: [
            { given: "A", output: "$1.00", soWhat: "ok" },
            { given: "B", output: "$2.00", soWhat: "Something meaningful about this one." },
          ],
        }),
      ]),
    ).toThrow(/no real 'so what'/);
  });

  it("the trap gate rejects an example with no trap row", () => {
    expect(() =>
      assertEveryExampleShowsATrap([
        goodExample({
          rows: [
            { given: "A", output: "$1.00", soWhat: "Something meaningful about it." },
            { given: "B", output: "$2.00", soWhat: "Something else meaningful." },
          ],
        }),
      ]),
    ).toThrow(/mark no row as the trap/);
  });

  it("the refusal gate rejects a row carrying the engine-refusal marker", () => {
    expect(() =>
      assertNoExampleRendersARefusal([
        goodExample({
          rows: [
            { given: "A", output: `${ENGINE_REFUSAL_MARKER} rate_not_evidenced_for_date`, soWhat: "Meaningful sentence here." },
            { given: "B", output: "$2.00", soWhat: "Another meaningful sentence." },
          ],
        }),
      ]),
    ).toThrow(/an engine refused/);
  });

  it("the refusal gate rejects an empty list rather than scanning nothing", () => {
    expect(() => assertNoExampleRendersARefusal([])).toThrow(/zero rows/);
  });

  it("the sameness gate rejects a row claiming parity with a different number", () => {
    expect(() =>
      assertSamenessClaimsAreTrue([
        goodExample({
          rows: [
            { given: "A", output: "$1.00", soWhat: "It costs the same as the other one." },
            { given: "B", output: "$2.00", soWhat: "A meaningful sentence about this." },
          ],
        }),
      ]),
    ).toThrow(/no other row in the example shares its output/);
  });

  it("the sameness gate ACCEPTS a parity claim that is actually true", () => {
    expect(() =>
      assertSamenessClaimsAreTrue([
        goodExample({
          rows: [
            { given: "A", output: "$1.00", soWhat: "It costs exactly the same as the other one." },
            { given: "B", output: "$1.00", soWhat: "A meaningful sentence about this." },
          ],
        }),
      ]),
    ).not.toThrow();
  });

  it("the source-reading gates run against the real file and pass", () => {
    expect(() => assertExamplesAreBuiltFromEngines()).not.toThrow();
    expect(() => assertNoHandTypedMoneyInExamples()).not.toThrow();
  });
});

/* ==========================================================================
 * 3) THE NUMBERS ARE THE ENGINES' OWN
 *
 * These pin the arithmetic that Michael will read. They are not duplicating the
 * engine tests: they assert that the RENDERED example carries the figure, which
 * is the thing that breaks when a builder is rewired to the wrong argument.
 * ========================================================================== */

describe("3) the rendered numbers are the ones the engines produce", () => {
  it("the overtime example proves 80 hours can cost two different amounts", () => {
    const e = workedExampleFor("onboarding:hourlyGrossCents");
    expect(e).not.toBeNull();

    // 40 + 40 at $24.50 = $1,960.00 straight time.
    // 45 + 35 is the same 80 hours, but week one earns 5 hours of half-rate
    // premium: 5 x $12.25 = $61.25, so $2,021.25.
    const outputs = e!.rows.map((r) => r.output);
    expect(outputs).toContain("$1,960.00");
    expect(outputs).toContain("$2,021.25");
    expect(outputs).toContain("$61.25");
  });

  it("the difference row really is the difference of the other two", () => {
    const e = workedExampleFor("onboarding:hourlyGrossCents")!;
    const cents = (s: string) => Math.round(Number(s.replace(/[$,]/g, "")) * 100);
    const [even, lopsided, diff] = e.rows.map((r) => cents(r.output));
    expect(lopsided - even).toBe(diff);
  });

  it("the DOR ladder shows one day and sixteen days costing the same, then a jump", () => {
    const e = workedExampleFor("penalties:computeDorPenalty")!;
    // Rows are ordered by lateness: 1 day, 16 days, 39 days, 157 days.
    expect(e.rows).toHaveLength(4);
    // The whole lesson: rows 0 and 1 are IDENTICAL in cost.
    expect(e.rows[0].output).toBe(e.rows[1].output);
    // And row 2 is not.
    expect(e.rows[2].output).not.toBe(e.rows[1].output);
    // Every row names its step.
    expect(e.rows[0].output).toMatch(/Step 1/);
    expect(e.rows[2].output).toMatch(/Step 2/);
    expect(e.rows[3].output).toMatch(/Step 3/);
  });

  it("the salary example's 26 cheques add back to exactly the salary", () => {
    const e = workedExampleFor("onboarding:salaryGrossForPeriodCents")!;
    const totalRow = e.rows.find((r) => r.given.includes("added back up"));
    expect(totalRow).toBeDefined();
    // $55,000.00 against a $55,000.00 salary — the same figure twice.
    expect(totalRow!.output).toBe("$55,000.00 against a $55,000.00 salary");
    expect(totalRow!.soWhat).toMatch(/Exactly the salary/);
  });

  it("the salary example puts the remainder where its sentence says it goes", () => {
    // ─────────────────────────────────────────────────────────────────────
    // THIS TEST EXISTS BECAUSE A MUTANT SURVIVED.
    //
    // The mutation campaign for books-45 rewired the "FIRST biweekly cheque"
    // row to read period 25 instead of period 0. Every number on screen
    // changed — the first cheque became $2,115.38 — and all 34 tests stayed
    // green, because nothing pinned the first cheque's actual VALUE. The row's
    // sentence went on claiming "the remainder is paid out here, at the start"
    // while the figure beside it said otherwise. That is precisely the
    // prose-disagrees-with-arithmetic defect this whole module was built to
    // stop, surviving inside the module built to stop it.
    //
    // So this checks the CLASS, not the instance: the first cheque must differ
    // from the rest by exactly the remainder, and the pieces must still sum to
    // the salary.
    // ─────────────────────────────────────────────────────────────────────
    const e = workedExampleFor("onboarding:salaryGrossForPeriodCents")!;
    const cents = (s: string) => Math.round(Number(s.replace(/[$,]/g, "")) * 100);

    const firstRow = e.rows.find((r) => r.given.includes("FIRST"))!;
    const restRow = e.rows.find((r) => r.given.includes("Every other"))!;

    const first = cents(firstRow.output);
    const rest = cents(restRow.output);

    // $55,000.00 / 26 = $2,115.3846..., so 26 x $2,115.38 = $54,999.88 and the
    // 12-cent remainder belongs to the first cheque.
    expect(rest).toBe(2_115_38);
    expect(first).toBe(2_115_50);
    expect(first).toBeGreaterThan(rest);
    expect(first - rest).toBe(55_000_00 - rest * 26);
    expect(first + rest * 25).toBe(55_000_00);
  });

  it("the salary example does not claim monthly divides cleanly when it does not", () => {
    // $55,000 / 12 = $4,583.333..., so January absorbs the remainder and the
    // row must SAY so. An earlier draft asserted "twelve divides cleanly" in
    // hand-typed prose while the engine returned $4,583.37 — the exact class of
    // defect this module exists to prevent.
    const e = workedExampleFor("onboarding:salaryGrossForPeriodCents")!;
    const monthly = e.rows.find((r) => r.given.includes("monthly"))!;
    expect(monthly.output).toBe("$4,583.37 in January, then $4,583.33");
    expect(monthly.soWhat).toMatch(/does not divide it cleanly/);
  });

  it("the five-agency example gives five genuinely different answers", () => {
    const e = workedExampleFor("penalties:AGENCY_CLOCKS")!;
    expect(e.rows).toHaveLength(5);
    const distinct = new Set(e.rows.map((r) => r.output));
    // If "late is late" were true these would collapse. WA ESD and L&I share a
    // schedule so they legitimately match; everything else must differ.
    expect(distinct.size).toBeGreaterThanOrEqual(4);
  });

  it("the LCB example shows the deadline rolling off a weekend and not off a weekday", () => {
    const e = workedExampleFor("penalties:lcbDueDateForSalesMonth")!;
    // January 2027 sales -> 20 Feb 2027 is a Saturday -> Monday 22 Feb.
    expect(e.rows[0].output).toContain("2027-02-22");
    expect(e.rows[0].output).toContain("saturday");
    // April 2027 sales -> 20 May 2027 is a Thursday, so no roll at all.
    expect(e.rows[1].output).toBe("Due 2027-05-20");
  });

  it("the months example shows 1 day and 28 days both counting as one month", () => {
    const e = workedExampleFor("penalties:monthsOrPartThereof")!;
    expect(e.rows[0].output).toBe("1 month for penalty purposes");
    expect(e.rows[1].output).toBe("1 month for penalty purposes");
    expect(e.rows[2].output).toBe("2 months for penalty purposes");
  });

  it("the hire-day example shows three clocks that do not agree", () => {
    const e = workedExampleFor("onboarding:onboardingDeadlines")!;
    const outs = e.rows.map((r) => r.output);
    // Hired Monday 2027-01-04: I-9 section 2 is 3 BUSINESS days -> Thursday.
    expect(outs).toContain("2027-01-07");
    // New-hire report is 20 CALENDAR days -> 2027-01-24.
    expect(outs).toContain("2027-01-24");
    // Retention is 3 years.
    expect(outs).toContain("2030-01-04");
  });
});

/* ==========================================================================
 * 4) THE DEFECT THAT PROVED THE DESIGN
 * ========================================================================== */

describe("4) the SSN example matches the engine, not intuition", () => {
  it("refuses the placeholder and ACCEPTS the famous wallet-card number", () => {
    const e = workedExampleFor("onboarding:maskSsn")!;

    const placeholder = e.rows.find((r) => r.given.includes("123-45-6789"))!;
    expect(placeholder.output).toMatch(/^Refused/);

    const famous = e.rows.find((r) => r.given.includes("078-05-1120"))!;
    expect(famous.output).toBe("Accepted");
    // And it must be flagged as the trap, because "accepted" is the surprise.
    expect(famous.isTrap).toBe(true);
  });

  it("never shows a full SSN back, only the last four", () => {
    const e = workedExampleFor("onboarding:maskSsn")!;
    const shown = e.rows.find((r) => r.given.includes("Shown back"))!;
    expect(shown.output).toBe("XXX-XX-4021");
  });
});

/* ==========================================================================
 * 5) THE EVIDENCED-RATE DEPENDENCY IS HONEST
 * ========================================================================== */

describe("5) the DOR interest rate is read from evidence, never invented", () => {
  it("converts basis points to milli-percent rather than passing them through", () => {
    // 600 bp = 6% = 6,000 milli-percent. Passing 600 straight through would bill
    // 0.6% — a plausible-looking integer and a tenfold error.
    const row = DOR_ANNUAL_RATES.find((r) => r.year === 2027);
    expect(row).toBeDefined();
    expect(dorAnnualRateMilliPercentFor(2027)).toBe(row!.basisPoints * 10);
    expect(dorAnnualRateMilliPercentFor(2027)).toBe(6_000);
  });

  it("returns null for a year with no evidence instead of guessing", () => {
    expect(dorAnnualRateMilliPercentFor(1999)).toBeNull();
  });

  it("the examples that need the rate are not silently rendering a refusal", () => {
    // If DOR_ANNUAL_RATES ever stops covering 2027, this fails loudly here
    // rather than shipping a lesson that reads "ENGINE-REFUSAL".
    for (const e of allWorkedExamples()) {
      for (const r of e.rows) {
        expect(r.output).not.toContain(ENGINE_REFUSAL_MARKER);
      }
    }
  });
});

/* ==========================================================================
 * 6) HOUSEKEEPING
 * ========================================================================== */

describe("6) formatting and coverage reporting", () => {
  it("money() formats integer cents and refuses floats", () => {
    expect(money(0)).toBe("$0.00");
    expect(money(5)).toBe("$0.05");
    expect(money(123_456_78)).toBe("$123,456.78");
    expect(money(-1_00)).toBe("-$1.00");
    expect(() => money(1.5)).toThrow(/integer cents/);
  });

  it("coverage is reported honestly against the real lesson count", () => {
    const total = allLessons().length;
    const c = workedExampleCoverage(total);
    expect(c.withExample).toBe(allWorkedExamples().length);
    expect(c.totalLessons).toBe(total);
    expect(c.withExample).toBeLessThanOrEqual(total);
    // It must NAME the gap rather than implying completeness.
    expect(c.sentence).toMatch(/gap/);
  });

  it("coverage refuses a zero or non-integer lesson count", () => {
    expect(() => workedExampleCoverage(0)).toThrow(/real lesson count/);
    expect(() => workedExampleCoverage(-1)).toThrow(/real lesson count/);
    expect(() => workedExampleCoverage(1.5)).toThrow(/real lesson count/);
  });

  it("building the examples twice produces identical output (no ambient clock)", () => {
    expect(allWorkedExamples()).toEqual(allWorkedExamples());
  });
});
