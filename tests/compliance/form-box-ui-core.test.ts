/**
 * tests/compliance/form-box-ui-core.test.ts
 *
 * The decisions behind the Form / Why / Check screen, attacked directly.
 *
 * Every test here corresponds to a way the screen could look completely fine
 * and be wrong: a bar whose segments overflow, a green tick on a check that was
 * never performed, a box that invites a click and teaches nothing, an empty box
 * that is correct being displayed exactly like an empty box that is a mistake.
 *
 * None of it requires rendering React, which is the point of keeping the logic
 * out of the component.
 */
import { describe, it, expect } from "vitest";

import {
  checkRow,
  checkSummary,
  checkTone,
  renderableBoxes,
  splitBar,
  untaughtBoxes,
  __runFormBoxUiCoreTests,
} from "@/lib/payroll/form-box-ui-core";
import { type BoxLesson, type FormBox } from "@/lib/payroll/form-box-core";
import { form940Boxes } from "@/lib/payroll/form-box-adapters";
import { buildForm940, type Form940Request } from "@/lib/payroll/form-940-core";
import { buildWaQuarter, type WaQuarterRequest } from "@/lib/payroll/wa-quarterly-core";
import { waBoxes } from "@/lib/payroll/form-box-adapters";
import { WA_QUARTERLY_LESSONS } from "@/lib/payroll/form-box-lessons-wa";

function box(over: Partial<FormBox>): FormBox {
  return {
    formId: "f",
    box: "1",
    caption: "Caption",
    measure: "money",
    amountCents: 0,
    quantity: null,
    whose: "employer_cost",
    derivation: "derivation",
    blankOnPurpose: null,
    notComputedYet: null,
    emphasise: false,
    ...over,
  };
}

function lesson(over: Partial<BoxLesson>): BoxLesson {
  return {
    formId: "f",
    box: "1",
    headline: "h",
    plainEnglish: "p",
    whereItComesFrom: "w",
    howToReadIt: "r",
    commonMistake: null,
    whatToDo: "d",
    examples: [],
    quotes: [],
    tiesTo: [],
    ...over,
  };
}

const row = (left: number | null, right: number | null, tolerance = 0) =>
  checkRow({
    title: "Title",
    question: "Does the left tie to the right?",
    leftLabel: "left",
    leftCents: left,
    rightLabel: "right",
    rightCents: right,
    toleranceCents: tolerance,
    agreesMeaning: "They tie.",
    disagreesMeaning: "They do not tie.",
    missingMeaning: "A figure has not been supplied.",
  });

/* ═══════════════════════════════════════════════════════════════════════════ */

describe("form-box-ui-core self-tests", () => {
  it("passes its embedded suite", () => {
    expect(() => __runFormBoxUiCoreTests()).not.toThrow();
  });
});

/**
 * The exact mistake this section exists to catch, written out so the test can
 * prove it is looking at ratios capable of exposing it.
 *
 * ═══ WHY THIS HELPER IS HERE AND NOT A HAND-PICKED LIST ═══
 *
 * An earlier version of this gate swept `employee` from 1 to 200 against a
 * constant total of 201 and asserted the widths summed to 100. It passed
 * against the correct implementation AND against a mutant that rounded both
 * shares independently, because that sweep was mathematically incapable of
 * failing:
 *
 *   Two shares of one total have fractional parts summing to 0 or to 1. For
 *   BOTH to round up, both fractions must be at least 0.5, which can only
 *   happen when both are exactly 0.5 (Math.round breaks ties upward). A total
 *   of 201 can never place a share on a .5 boundary, so no ratio in that sweep
 *   could ever produce 101.
 *
 * Two hundred assertions, zero of them able to fail: rule 39, a gate that
 * parses nothing approves everything. So the corpus below is DERIVED from the
 * mutant rather than guessed at, and the derivation is itself asserted to be
 * non-empty before the property is checked.
 */
function wouldOverflowUnderIndependentRounding(employerCents: number, employeeCents: number): boolean {
  const total = employerCents + employeeCents;
  if (total === 0) return false;
  const a = Math.round((employerCents * 100) / total);
  const b = Math.round((employeeCents * 100) / total);
  return a + b !== 100;
}

describe("the split bar cannot overflow its container", () => {
  it("sweeps ratios that PROVABLY break independent rounding, and still totals 100", () => {
    // Derive, rather than assume, which ratios are adversarial.
    const adversarial: Array<[number, number]> = [];
    const benign: Array<[number, number]> = [];
    for (let total = 2; total <= 500; total += 1) {
      for (let employer = 0; employer <= total; employer += 1) {
        const employee = total - employer;
        if (wouldOverflowUnderIndependentRounding(employer, employee)) {
          adversarial.push([employer, employee]);
        } else if (employer % 97 === 0) {
          benign.push([employer, employee]);
        }
      }
    }

    // ─── The guard on the corpus itself ───────────────────────────────────
    // If this ever drops to zero the sweep below has stopped being a test of
    // anything, exactly as the 201-total version had. Fail loudly instead of
    // reporting a green tick over an empty search.
    expect(
      adversarial.length,
      "the sweep contains no ratio capable of exposing independent rounding; " +
        "widen the range or this test proves nothing",
    ).toBeGreaterThan(100);

    // The classic case, named so a reader can see what "adversarial" means:
    // one eighth and seven eighths land on 12.5% and 87.5%, both tie upward,
    // and independent rounding yields 13 + 88 = 101.
    expect(wouldOverflowUnderIndependentRounding(1, 7)).toBe(true);
    expect(wouldOverflowUnderIndependentRounding(29_403, 70_597)).toBe(false);

    // ─── The property, over the adversarial ratios and some ordinary ones ──
    for (const [employer, employee] of [...adversarial, ...benign]) {
      const bar = splitBar([
        box({ box: "ee", amountCents: employee, whose: "employee_money" }),
        box({ box: "er", amountCents: employer, whose: "employer_cost" }),
      ]);
      const width = bar.segments.reduce((n, s) => n + s.widthPct, 0);
      expect(width, `split ${employer} employer / ${employee} employee`).toBe(100);
    }
  });

  it("draws 13% + 87% on the one-eighth split, never 13% + 88%", () => {
    // The single most legible instance of the property above, asserted on the
    // actual numbers so a failure names the defect instead of a loop index.
    const bar = splitBar([
      box({ box: "er", amountCents: 1_000, whose: "employer_cost" }),
      box({ box: "ee", amountCents: 7_000, whose: "employee_money" }),
    ]);
    const employer = bar.segments.find((s) => s.label.includes("Greenway"))!;
    const employee = bar.segments.find((s) => s.label.includes("employees"))!;
    expect(employer.widthPct).toBe(13);
    expect(employee.widthPct).toBe(87);
    expect(employer.widthPct + employee.widthPct).toBe(100);
    // The rounded-down segment must still carry the honest share for the
    // caption: 87.5%, not the 87% the geometry was forced to.
    expect(employee.exactMilliPct).toBe(87_500);
    expect(employer.exactMilliPct).toBe(12_500);
  });

  it("never emits a negative or over-wide segment", () => {
    for (const [a, b] of [
      [0, 1],
      [1, 0],
      [1, 1_000_000],
      [1_000_000, 1],
    ]) {
      for (const s of splitBar([
        box({ box: "ee", amountCents: a, whose: "employee_money" }),
        box({ box: "er", amountCents: b, whose: "employer_cost" }),
      ]).segments) {
        expect(s.widthPct).toBeGreaterThanOrEqual(0);
        expect(s.widthPct).toBeLessThanOrEqual(100);
      }
    }
  });

  it("draws NOTHING rather than an empty grey strip when no money moved", () => {
    const bar = splitBar([box({ amountCents: 0 })]);
    expect(bar.empty).toBe(true);
    expect(bar.segments).toHaveLength(0);
    // And the percentages stay null, so no caption can claim "0% was yours".
    expect(bar.split.employerMilliPct).toBeNull();
  });

  it("keeps the CSS width and the teachable share as different numbers", () => {
    // Greenway's real L&I split: 29.403% employee. The bar is 29% wide; the
    // caption must not therefore say "29%".
    const bar = splitBar([
      box({ box: "ee", amountCents: 58_511, whose: "employee_money" }),
      box({ box: "er", amountCents: 140_488, whose: "employer_cost" }),
    ]);
    const employee = bar.segments.find((s) => s.label.includes("employees"))!;
    expect(employee.widthPct).toBe(29);
    expect(employee.exactMilliPct).toBe(29_403);
    expect(employee.widthPct * 1000).not.toBe(employee.exactMilliPct);
  });

  it("shows Form 940 as entirely Greenway's money, on the real engine", () => {
    const req: Form940Request = {
      year: 2027,
      employees: [
        {
          employeeId: "joan",
          name: "Joan",
          totalPaymentsCents: 4_400_000,
          exemptPaymentsCents: 200_000,
          excludedFromStateUnemploymentTax: false,
        },
      ],
      statePayments: {
        paidOnTimeCents: 200_000,
        paidLateCents: 0,
        notPaidCents: 0,
        taxableStateWagesCents: 700_000,
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
      quarterly: { q1Cents: 4_200, q2Cents: 0, q3Cents: 0, q4Cents: 0 },
    };
    const built = buildForm940(req);
    if (!built.ok) throw new Error(built.refusals.map((r) => r.code).join(", "));
    const bar = splitBar(form940Boxes(built.ret));
    expect(bar.empty).toBe(false);
    // One gold bar across the whole width, which is the lesson of FUTA.
    expect(bar.segments[0].widthPct).toBe(100);
    expect(bar.segments[1].widthPct).toBe(0);
    expect(bar.split.employeeCents).toBe(0);
  });
});

describe("a check that was never performed is not a check that passed", () => {
  it("reports cannot_check, in orange, naming what is missing", () => {
    const r = row(100, null);
    expect(r.outcome).toBe("cannot_check");
    expect(r.differenceCents).toBeNull();
    expect(r.tone).toBe("orange");
    expect(r.tone).not.toBe("green");
    expect(r.meaning).toContain("not been supplied");
  });

  it("does not treat a missing figure as zero", () => {
    // Treating null as 0 would report a difference of the entire amount and
    // scream about a catastrophe that has not happened.
    expect(row(100_000, null).differenceCents).toBeNull();
    expect(row(null, 100_000).outcome).toBe("cannot_check");
  });

  it("paints a disagreement in danger and an agreement in green", () => {
    // ═══ WHY THIS TEST EXISTS ═══
    // A mutation campaign replaced `tone: agrees ? "green" : "danger"` with a
    // flat `tone: "green"` and the whole suite stayed green. Only the
    // cannot_check tone was ever asserted, so a reconciliation that FAILED
    // would have rendered with a reassuring green tick beside it — the single
    // most dangerous defect this screen could ship, because Michael would be
    // told his 941 ties when it does not. Every outcome now has its colour
    // pinned, and each is asserted not to be the others (rule 34).
    const disagrees = row(100_000, 95_000);
    expect(disagrees.outcome).toBe("disagrees");
    expect(disagrees.tone).toBe("danger");
    expect(disagrees.tone).not.toBe("green");
    expect(disagrees.tone).not.toBe("orange");
    expect(disagrees.meaning).toContain("do not tie");

    const agrees = row(100_000, 100_000);
    expect(agrees.outcome).toBe("agrees");
    expect(agrees.tone).toBe("green");
    expect(agrees.tone).not.toBe("danger");
    expect(agrees.meaning).toContain("They tie.");

    // All three outcomes must be visually distinguishable from one another,
    // or the colour is decoration rather than information.
    const tones = [agrees.tone, disagrees.tone, row(100_000, null).tone];
    expect(new Set(tones).size).toBe(3);
  });

  it("still compares when both figures are present (rule 34, both directions)", () => {
    expect(row(100, 100).outcome).toBe("agrees");
    expect(row(100, 101).outcome).toBe("disagrees");
    expect(row(100, 101).differenceCents).toBe(-1);
    expect(row(101, 100).differenceCents).toBe(1);
  });

  it("honours a tolerance at its exact edge, and one cent past it", () => {
    expect(row(100_007, 100_000, 7).outcome).toBe("agrees");
    expect(row(100_008, 100_000, 7).outcome).toBe("disagrees");
    // Negative drift too — the fractions-of-cents line goes both ways.
    expect(row(99_993, 100_000, 7).outcome).toBe("agrees");
    expect(row(99_992, 100_000, 7).outcome).toBe("disagrees");
  });

  it("lets one disagreement dominate any number of passes", () => {
    const pass = row(1, 1);
    const fail = row(1, 2);
    expect(checkTone([pass, pass, pass, pass, fail])).toBe("danger");
    expect(checkTone([pass, pass, pass])).toBe("green");
    expect(checkTone([pass, row(1, null)])).toBe("orange");
    // No checks at all must not read as success.
    expect(checkTone([])).toBe("neutral");
  });

  it("summarises in counts, and says what to do about a disagreement", () => {
    expect(checkSummary([row(1, 1), row(1, 2)])).toContain("Do not file");
    expect(checkSummary([row(1, 1), row(1, 2)])).toContain("1 DISAGREES");
    expect(checkSummary([row(1, 1), row(1, null)])).toContain("could not be checked");
    expect(checkSummary([row(1, 1), row(1, null)])).toContain("not a passed check");
    expect(checkSummary([row(1, 1)])).toContain("ties to the record");
    expect(checkSummary([])).toContain("nothing to reconcile");
  });
});

describe("a box invites a click only when it can actually teach", () => {
  it("marks exactly the boxes that have a lesson", () => {
    const rendered = renderableBoxes(
      [box({ box: "1" }), box({ box: "2" }), box({ box: "3" })],
      [lesson({ box: "1" }), lesson({ box: "3" })],
    );
    expect(rendered.map((r) => r.hasLesson)).toEqual([true, false, true]);
    expect(untaughtBoxes(rendered)).toEqual(["2"]);
  });

  it("does not accept a lesson belonging to a different form", () => {
    // The silent failure this prevents: an adapter stamps the wrong formId and
    // every lesson quietly stops being found while the form still renders.
    const rendered = renderableBoxes([box({ box: "1", formId: "f" })], [
      lesson({ box: "1", formId: "SOME_OTHER_FORM" }),
    ]);
    expect(rendered[0].hasLesson).toBe(false);
  });

  it("finds every Washington lesson through the real adapter", () => {
    // End to end: the engine emits lines, the adapter translates them, and the
    // lessons written against the engine's own ids must still be found. If the
    // ids drifted anywhere along that chain this is where it shows.
    const req: WaQuarterRequest = {
      quarter: { year: 2026, quarter: 2 },
      subjects: [
        {
          subjectId: "e1",
          displayName: "Employee One",
          wagesCents: 6_892_345,
          esdTaxableWagesCents: 6_892_345,
          pfmlTaxableWagesCents: 6_892_345,
          hours: 3_558,
        },
      ],
      rates: {
        sutaUiMilliPct: 370,
        sutaEafMilliPct: 30,
        pfmlTotalMilliPct: 1_130,
        pfmlEmployeeShareMilliPct: 71_430,
        waCaresMilliPct: 580,
        lniEmployeeMilliCentsPerHour: 16_445,
        lniEmployerMilliCentsPerHour: 39_485,
      },
      pfml: { employerOwesEmployerShare: false, determinedAverageHeadcount: 10 },
    };
    const built = buildWaQuarter(req);
    if (!built.ok) throw new Error(built.refusals.map((r) => r.code).join(", "));

    const lni = renderableBoxes(waBoxes(built.value, "lni_quarterly"), WA_QUARTERLY_LESSONS);
    // Three of the four L&I boxes are taught; the combined premium line is a
    // total and is deliberately not a separate lesson.
    expect(lni.length).toBeGreaterThanOrEqual(4);
    expect(lni.filter((r) => r.hasLesson).length).toBeGreaterThanOrEqual(3);

    const pfml = renderableBoxes(waBoxes(built.value, "pfml_wa_cares"), WA_QUARTERLY_LESSONS);
    expect(pfml.length).toBeGreaterThanOrEqual(3);
    // Every box on this form is taught, and that is asserted as a count so it
    // cannot regress silently.
    expect(untaughtBoxes(pfml)).toEqual([]);
  });
});

describe("an empty box that is correct must not look like an omission", () => {
  it("separates blank-on-purpose from merely empty", () => {
    const rendered = renderableBoxes(
      [
        box({ box: "17", amountCents: 0, blankOnPurpose: "Washington has no state income tax." }),
        box({ box: "13", amountCents: 0 }),
        box({ box: "12", amountCents: 1_500 }),
      ],
      [],
    );
    expect(rendered[0].correctlyBlank).toBe(true);
    expect(rendered[1].correctlyBlank).toBe(false);
    expect(rendered[1].empty).toBe(true);
    expect(rendered[2].empty).toBe(false);
  });

  it("keeps an hours box with real hours out of 'empty'", () => {
    // An hours box carries 0 cents by design. Judging emptiness on cents would
    // call 3,558 reported hours an empty box.
    const rendered = renderableBoxes(
      [box({ box: "h", measure: "hours", amountCents: 0, quantity: 355_800, whose: "shared" })],
      [],
    );
    expect(rendered[0].empty).toBe(false);
    expect(rendered[0].printed).toContain("3,558");
    expect(rendered[0].printed).not.toContain("$");
  });
});
