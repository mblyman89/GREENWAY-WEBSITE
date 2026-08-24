/**
 * tests/compliance/form-940-checks.test.ts   (books-47, slice D)
 *
 * THE CHECK TAB, ATTACKED.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE FAILURE THIS FILE EXISTS TO PREVENT
 * ───────────────────────────────────────────────────────────────────────────
 *
 * A reconciliation screen has one job and one catastrophic failure mode: it
 * can show a green tick for a check that did not happen. That is strictly
 * worse than having no Check tab at all, because Michael would file on the
 * strength of it.
 *
 * There are three ways to get that green tick wrongly, and this file drives
 * every one of them with data that must produce a RED or an ORANGE:
 *
 *   1. Comparing a figure with itself. Always agrees, proves nothing.
 *   2. Treating a missing figure as zero. Two zeroes agree beautifully.
 *   3. Reporting a real disagreement in a soft tone that reads as fine.
 *
 * So the tests below deliberately BREAK a return and assert the check turns
 * red, then deliberately REMOVE a figure and assert the check goes orange
 * rather than green. Standing rule 34: every gate runs both directions.
 */
import { describe, expect, it } from "vitest";

import { form940Checks } from "@/lib/payroll/form-940-checks";
import { buildForm940, type Form940Request, type Form940Return } from "@/lib/payroll/form-940-core";

function greenwayRequest(): Form940Request {
  return {
    year: 2027,
    employees: [
      {
        employeeId: "joan",
        name: "Joan",
        totalPaymentsCents: 4_400_000,
        exemptPaymentsCents: 0,
        excludedFromStateUnemploymentTax: false,
      },
      {
        employeeId: "nicholas",
        name: "Nicholas",
        totalPaymentsCents: 620_000,
        exemptPaymentsCents: 0,
        excludedFromStateUnemploymentTax: false,
      },
    ],
    statePayments: {
      paidOnTimeCents: 50_000,
      paidLateCents: 0,
      notPaidCents: 0,
      taxableStateWagesCents: 1_320_000,
      experienceRateBps: 540,
    },
    filingTest: {
      maxQuarterWagesThisYearCents: 2_000_000,
      maxQuarterWagesPriorYearCents: 0,
      weeksWithAnyEmployeeThisYear: 52,
      weeksWithAnyEmployeePriorYear: 0,
    },
    creditReductionMilliPct: 0,
    depositedCents: 0,
    quarterly: { q1Cents: 5_130, q2Cents: 930, q3Cents: 930, q4Cents: 930 },
  };
}

function cleanReturn(): Form940Return {
  const r = buildForm940(greenwayRequest());
  if (!r.ok) throw new Error(`fixture refused: ${r.refusals.map((x) => x.code).join(", ")}`);
  return r.ret;
}

/**
 * Rewrite one line of a real return.
 *
 * The engine will not produce an inconsistent return — that is the point of
 * the engine — so the only honest way to prove the checks CAN fail is to
 * corrupt a correct return after the fact and confirm the corruption is
 * caught. This is a test helper and deliberately lives nowhere else.
 */
function withLine(ret: Form940Return, line: string, amountCents: number): Form940Return {
  const lines = ret.lines.map((l) => (l.line === line ? { ...l, amountCents } : l));
  return { ...ret, lines };
}

/**
 * Delete a line from a return entirely.
 *
 * ═══ WHY THIS IS THE ONLY WAY TO MODEL "MISSING" ═══
 *
 * `Form940Line.amountCents` is a plain `number`. There is no such thing as a
 * line that is present but has no value — a blank line 10 carries 0 with
 * `blank: true`, which for footing purposes is a real zero.
 *
 * So the one genuinely unknown state is a line the engine never emitted, and
 * that is what this helper constructs. Getting this wrong is how a
 * reconciliation ends up comparing invented zeroes and painting green.
 */
function withoutLine(ret: Form940Return, line: string): Form940Return {
  return { ...ret, lines: ret.lines.filter((l) => l.line !== line) };
}

/** One line's amount, or null when the engine did not emit that line. */
function lineOf(ret: Form940Return, line: string): number | null {
  return ret.lines.find((l) => l.line === line)?.amountCents ?? null;
}

function row(ret: Form940Return, title: string) {
  const found = form940Checks(ret).find((r) => r.title === title);
  expect(found, `no check titled "${title}"`).toBeDefined();
  return found!;
}

const FOOTS = "The taxable wage base foots";
const SUM = "The annual tax is the sum of its parts";
const PART5 = "Part 5 foots to the annual tax";
const CREDIT = "Was the full state credit earned?";

describe("the Form 940 Check tab reconciles a clean return", () => {
  it("produces a row for every identity the return can prove about itself", () => {
    const rows = form940Checks(cleanReturn());
    // A Check tab with no rows renders "nothing to reconcile", which is the
    // silent failure this whole file exists to prevent.
    expect(rows.length).toBe(4);
    expect(rows.map((r) => r.title)).toEqual([FOOTS, SUM, PART5, CREDIT]);
  });

  it("agrees on all four when the year is clean", () => {
    for (const r of form940Checks(cleanReturn())) {
      expect(r.outcome, `${r.title} should agree on a clean return`).toBe("agrees");
      expect(r.tone).toBe("green");
      expect(r.differenceCents).toBe(0);
    }
  });

  it("never compares a figure against itself", () => {
    // A row whose two sides are read from the same line always agrees and
    // proves nothing. Caught by labels, because the VALUES legitimately match.
    for (const r of form940Checks(cleanReturn())) {
      expect(r.leftLabel).not.toBe(r.rightLabel);
      expect(r.leftLabel.length).toBeGreaterThan(5);
      expect(r.rightLabel.length).toBeGreaterThan(5);
    }
  });

  /**
   * GATE HOLE FOUND BY MUTATION, THEN CLOSED.
   *
   * The credit row's disagreement wording could be rewritten to say "something
   * is wrong with the return" and every test stayed green. That single
   * sentence is the difference between Michael spending an afternoon hunting a
   * bug in a form that is arithmetically perfect, and Michael learning that a
   * state payment went out late and setting a calendar reminder.
   *
   * The QUESTION each row asks is checked here too. A reconciliation that
   * shows two numbers without saying what is being compared is a puzzle, not
   * a check, and the wording is the entire product.
   */
  it("frames the lost-credit finding as a cost, never as a mistake on the form", () => {
    const rows = form940Checks(cleanReturn());
    const credit = rows.find((r) => r.title === CREDIT);
    expect(credit).toBeDefined();

    // The row's own question must explain the 0.6%-versus-6.0% mechanism
    // BEFORE any number appears, because that is what makes the figure mean
    // something when it does appear.
    expect(credit!.question).toContain("0.6%");
    expect(credit!.question).toContain("5.4%");
    // The question must name the CONSEQUENCE correctly too. A mutation that
    // reworded this to "something is wrong with the return" survived the first
    // campaign, because the assertions below only guarded `meaning`. The
    // question is the sentence Michael reads first, so it is guarded here.
    expect(credit!.question).toContain("credit that was lost");
    expect(credit!.question.toLowerCase()).not.toContain("wrong with the return");

    // And the disagreement wording is asserted through a genuinely
    // disagreeing return, so the string being checked is the one Michael
    // would actually read.
    const lost = row(withLine(cleanReturn(), "12", 27_920), CREDIT);
    expect(lost.meaning).toContain("NOT an error");
    expect(lost.meaning).toContain("credit");
    expect(lost.meaning.toLowerCase()).toContain("due date");
    // It must not describe a correct return as broken.
    expect(lost.meaning.toLowerCase()).not.toContain("something is wrong with the return");
  });

  it("explains what each comparison MEANS, not merely that it matched", () => {
    for (const r of form940Checks(cleanReturn())) {
      expect(r.meaning.length, `${r.title} has a thin explanation`).toBeGreaterThan(80);
      expect(r.meaning.toLowerCase()).not.toBe("match");
      expect(r.question.length).toBeGreaterThan(40);
    }
  });
});

describe("the Check tab turns red on a return that does not foot", () => {
  /**
   * Rule 83: drive each gate with a broken input, or it is decoration.
   * Every test here corrupts exactly one line and asserts the RIGHT row
   * catches it — a check that fires on everything is as useless as one that
   * fires on nothing.
   */
  it("catches a wage base that does not subtract", () => {
    const broken = withLine(cleanReturn(), "7", 1_320_001);
    const r = row(broken, FOOTS);
    expect(r.outcome).toBe("disagrees");
    expect(r.tone).toBe("danger");
    expect(r.differenceCents).toBe(-1);
  });

  it("catches adjustments that do not add to the annual tax", () => {
    const broken = withLine(cleanReturn(), "12", 20_000);
    const r = row(broken, SUM);
    expect(r.outcome).toBe("disagrees");
    expect(r.tone).toBe("danger");
  });

  it("catches Part 5 failing to foot, which the IRS checks automatically", () => {
    const broken = withLine(cleanReturn(), "17", 7_921);
    const r = row(broken, PART5);
    expect(r.outcome).toBe("disagrees");
    expect(r.tone).toBe("danger");
    expect(r.differenceCents).toBe(1);
  });

  it("reports lost state credit in dollars rather than merely flagging it", () => {
    // Line 12 above line 8 means credit was clawed back. The row must say so
    // AND carry the cost, because the number is the only actionable part.
    const broken = withLine(cleanReturn(), "12", 27_920);
    const r = row(broken, CREDIT);
    expect(r.outcome).toBe("disagrees");
    expect(r.differenceCents).toBe(7_920 - 27_920);
    expect(r.meaning).toContain("cost");
    // It must NOT be described as an error on the return. The form is right;
    // the year was expensive. Misdescribing it sends Michael hunting a bug.
    expect(r.meaning).toContain("NOT an error");
  });

  it("does not fire every row for a single broken line", () => {
    // A gate that goes red everywhere tells you nothing about where to look.
    const broken = withLine(cleanReturn(), "7", 999);
    const outcomes = form940Checks(broken);
    const disagreeing = outcomes.filter((r) => r.outcome === "disagrees");
    expect(disagreeing.length).toBeGreaterThanOrEqual(1);
    expect(disagreeing.length).toBeLessThan(outcomes.length);
    expect(row(broken, PART5).outcome).toBe("agrees");
  });
});

describe("a missing figure is reported as unknown, never as agreement", () => {
  /**
   * THE MOST DANGEROUS BUG THIS MODULE COULD HAVE.
   *
   * If a missing line were read as zero, then two missing lines would compare
   * 0 against 0, agree, and paint green. Michael would see a tick for a
   * reconciliation that never happened. Rule 62d: never invent a default.
   */
  it("goes orange, not green, when the quarterly split was never supplied", () => {
    const noQuarters = withoutLine(cleanReturn(), "17");
    const r = row(noQuarters, PART5);
    expect(r.outcome).toBe("cannot_check");
    expect(r.tone).toBe("orange");
    expect(r.tone).not.toBe("green");
    expect(r.differenceCents).toBeNull();
    // And it must name what is missing rather than shrug.
    expect(r.meaning.toLowerCase()).toContain("not been supplied");
  });

  it("goes orange when the wage base is incomplete", () => {
    const r = row(withoutLine(cleanReturn(), "6"), FOOTS);
    expect(r.outcome).toBe("cannot_check");
    expect(r.tone).toBe("orange");
  });

  it("does not let two missing figures agree with each other", () => {
    // The specific catastrophe: null vs null must never be "0 equals 0".
    const ret = withoutLine(withoutLine(cleanReturn(), "12"), "17");
    const r = row(ret, PART5);
    expect(r.outcome).toBe("cannot_check");
    expect(r.outcome).not.toBe("agrees");
    expect(r.leftCents).toBeNull();
    expect(r.rightCents).toBeNull();
  });

  /**
   * GATE HOLES FOUND BY MUTATION, THEN CLOSED.
   *
   * Two separate mutations made a MISSING adjustment line vanish into a
   * passing sum, and the whole suite stayed green through both:
   *
   *   - `sumOrNull` skipping nulls instead of refusing on them, so lines
   *     8 + (missing) + 10 + 11 quietly totalled the ones that happened to be
   *     present and matched line 12 by luck.
   *   - `adjustmentCents` returning 0 for a line that is absent rather than
   *     only for one that is blank BY DESIGN, which erases the distinction
   *     the function was written to preserve.
   *
   * Both produce the exact catastrophe this file exists to prevent: a green
   * tick on a reconciliation that did not happen. The clean-return tests could
   * never catch them, because on a clean return nothing is absent. So the
   * absence has to be constructed deliberately.
   */
  it("refuses the sum when an adjustment line is absent entirely", () => {
    // Not blank — ABSENT. A line the engine never emitted means the return is
    // not the shape this module believes it is, and quietly leaving it out of
    // the addition would report a total that was never verified.
    const r = row(withoutLine(cleanReturn(), "10"), SUM);
    expect(r.outcome, "an absent adjustment must block the sum, not be skipped").toBe(
      "cannot_check",
    );
    expect(r.tone).toBe("orange");
    expect(r.outcome).not.toBe("agrees");
    expect(r.leftCents).toBeNull();
  });

  /**
   * GATE HOLE FOUND BY MUTATION, THEN CLOSED.
   *
   * On a clean return lines 9, 10 and 11 are ALL ZERO, so a mutation that read
   * line 9 twice and never read line 11 changed nothing and survived. Every
   * test in the file was comparing zeroes against zeroes and calling it a
   * reconciliation.
   *
   * This is the subtlest version of the vacuity problem: the fixture was too
   * well-behaved to exercise the code. A clean year is the year we want, but
   * it is the worst possible test case for an addition, because 8 + 0 + 0 + 0
   * foots no matter which zeroes you pick.
   *
   * So this test builds a return where each adjustment is DISTINCT and
   * non-zero. Now dropping or duplicating any one of them changes the total.
   */
  it("adds each adjustment line exactly once, proven with distinct non-zero values", () => {
    let ret = cleanReturn();
    // Distinct primes-ish values so no two combinations coincide by accident.
    ret = withLine(ret, "9", 1_100);
    ret = withLine(ret, "10", 2_300);
    ret = withLine(ret, "11", 4_700);
    const expected = 7_920 + 1_100 + 2_300 + 4_700;
    ret = withLine(ret, "12", expected);

    const r = row(ret, SUM);
    expect(r.leftCents, "lines 8+9+10+11 must each be counted once").toBe(expected);
    expect(r.outcome).toBe("agrees");

    // And each one must genuinely participate: change any single adjustment
    // by one cent and the sum must stop agreeing.
    for (const line of ["9", "10", "11"] as const) {
      const nudged = withLine(ret, line, (lineOf(ret, line) ?? 0) + 1);
      expect(
        row(nudged, SUM).outcome,
        `line ${line} is not actually included in the sum`,
      ).toBe("disagrees");
    }
  });

  it("refuses the sum when the best-case tax itself is absent", () => {
    // Line 8 is the first term of the addition. If it disappeared, skipping it
    // would total the three adjustments alone and compare that against line
    // 12 — a comparison that is arithmetically meaningless but visually
    // identical to a real one.
    const r = row(withoutLine(cleanReturn(), "8"), SUM);
    expect(r.outcome).toBe("cannot_check");
    expect(r.tone).toBe("orange");
    expect(r.leftCents).toBeNull();
  });

  it("still treats a deliberately blank adjustment line as a real zero", () => {
    // Lines 9-11 are blank on a clean return BY DESIGN — the IRS reads a blank
    // and a 0.00 differently — but they genuinely contribute nothing to the
    // footing. If this were treated as unknown, the sum check could never run
    // on a well-run year, which is every year we hope to have.
    const clean = cleanReturn();
    const nine = clean.lines.find((l) => l.line === "9");
    expect(nine?.blank, "fixture no longer has a blank line 9").toBe(true);
    // Blank on the printed form, but genuinely zero in the arithmetic — the
    // engine carries 0 and sets the flag, and both facts are true at once.
    expect(nine?.amountCents).toBe(0);
    expect(row(clean, SUM).outcome).toBe("agrees");
  });
});
