/**
 * tests/compliance/form-box-lessons-940.test.ts   (books-47, slice D)
 *
 * THE FORM 940 LESSONS, ATTACKED.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS GATE IS ACTUALLY FOR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Teaching material fails in a way that ordinary code does not: it stays
 * green forever, because nothing executes it. A lesson can quote an
 * instruction that does not exist, teach a line the form does not have, or
 * carry a worked example whose arithmetic is simply wrong, and every test in
 * the repository will keep passing.
 *
 * So this file checks four separate things, and each one corresponds to a way
 * the lessons could be confidently wrong:
 *
 *   1. Every quote appears VERBATIM in the mirrored IRS instructions.
 *   2. Every lesson is reachable — its box exists on the real engine output.
 *   3. Every worked example's arithmetic is correct, checked by doing the sum.
 *   4. The teaching claims about FUTA hold against the real engine.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY IT DOES NOT WRITE ITS OWN QUOTE MATCHER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Standing rule 39: a self-check that re-implements the gate tests nothing.
 * This file imports `quoteSegments` and `matchesInOrder` from the real
 * verifier, so what is proven here is the same code that guards the repo.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FORM_940_LESSONS,
  FORM_940_SOURCE_URL,
  FORM_940_WHO_MUST_FILE_QUOTE,
  FUTA_WAGE_BASE_DOLLARS,
} from "@/lib/payroll/form-box-lessons-940";
import { FORM_940_SOURCE_PATH } from "@/lib/payroll/form-940-authorities";
import { form940Boxes } from "@/lib/payroll/form-box-adapters";
import { lessonFor, splitMoney } from "@/lib/payroll/form-box-core";
import { buildForm940, type Form940Request } from "@/lib/payroll/form-940-core";
import { matchesInOrder, quoteSegments } from "../../scripts/verify-verbatim-quotes";

/** Identical normalisation on BOTH sides, so neither gets latitude the other lacks. */
function normalise(s: string): string {
  return s
    .replace(/\u2019/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const CORPUS = normalise(readFileSync(join(process.cwd(), FORM_940_SOURCE_PATH), "utf8"));

/**
 * Split a quote into its verbatim segments, refusing rather than casting.
 *
 * `quoteSegments` returns null when a quote is malformed — an empty segment,
 * a leading or trailing elision, that sort of thing. Casting that null away
 * with `as string[]` would hand `matchesInOrder` an empty list, and a matcher
 * given nothing to match reports success. That is standing rule 39 in its
 * purest form: a gate that parses nothing approves everything.
 *
 * So a malformed quote fails HERE, by name, instead of passing silently.
 */
function segmentsOf(quote: string): readonly string[] {
  const segments = quoteSegments(normalise(quote));
  if (segments === null || segments.length === 0) {
    throw new Error(`quote could not be split into verbatim segments: ${quote.slice(0, 80)}...`);
  }
  return segments;
}

/**
 * Greenway's own shape, at the scale the lessons use in their examples.
 *
 * Joan is well above the $7,000 ceiling and Nicholas is below it, which is the
 * pairing that makes the per-person cap visible. The state facts are supplied
 * so the engine produces a RETURN rather than refusals — the refusal paths are
 * already covered by form-940-core.test.ts and are not this gate's subject.
 */
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

function builtReturn() {
  const r = buildForm940(greenwayRequest());
  if (!r.ok) throw new Error(`fixture refused: ${r.refusals.map((x) => x.code).join(", ")}`);
  return r.ret;
}

/* ═══════════════════════════════════════════════════════════════════════ */

describe("every Form 940 quote is really in the IRS instructions", () => {
  /**
   * Rule 83: drive the gate with a broken input first, so we know it can fail.
   * If this passes, every assertion below it is decoration.
   */
  it("rejects a sentence the IRS never wrote", () => {
    const invented =
      "Multiply line 7 by 0.42 and send the result to the Washington State Liquor Board.";
    expect(matchesInOrder(CORPUS, segmentsOf(invented))).toBe(false);

    // And a quote that is real but has ONE word altered must also be rejected,
    // because that is the failure that actually happens in practice — nobody
    // invents a whole sentence, they paraphrase while copying.
    const almost =
      "To figure your total FUTA tax before adjustments, multiply line 7 by 0.007 and then " +
      "enter the result on line 8.";
    expect(matchesInOrder(CORPUS, segmentsOf(almost))).toBe(false);

    // A malformed quote must throw rather than quietly match everything.
    expect(() => segmentsOf("")).toThrow();
  });

  it("finds every quote carried by a lesson", () => {
    let checked = 0;
    for (const lesson of FORM_940_LESSONS) {
      for (const q of lesson.quotes) {
        expect(
          matchesInOrder(CORPUS, segmentsOf(q.quote)),
          `box ${lesson.box}: quote not found in ${FORM_940_SOURCE_PATH}`,
        ).toBe(true);
        checked += 1;
      }
    }
    // A loop over an empty list passes silently. Rule 39.
    expect(checked, "no quotes were checked; this test proves nothing").toBeGreaterThanOrEqual(6);
  });

  /**
   * GATE HOLE FOUND BY MUTATION, THEN CLOSED.
   *
   * The threshold above is a floor on the TOTAL, and a floor on a total does
   * not protect any individual lesson. A mutation that emptied the line 5
   * lesson's `quotes` array left the count at six and the whole suite green —
   * so line 5, the most misread line on the form, would have taught Michael
   * on my authority alone. Standing rule 24: verbatim authority or no feature.
   *
   * Asserted PER LESSON, so emptying any single one fails by name.
   */
  it("gives every single lesson at least one verbatim quote of its own", () => {
    expect(FORM_940_LESSONS.length).toBeGreaterThanOrEqual(8);
    for (const lesson of FORM_940_LESSONS) {
      expect(
        lesson.quotes.length,
        `line ${lesson.box} teaches with no authority behind it`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("finds the who-must-file quote that sits outside the lesson list", () => {
    expect(
      matchesInOrder(CORPUS, segmentsOf(FORM_940_WHO_MUST_FILE_QUOTE.quote)),
    ).toBe(true);
  });

  it("points every quote at the mirrored file and a reachable URL", () => {
    for (const lesson of FORM_940_LESSONS) {
      for (const q of lesson.quotes) {
        expect(q.sourcePath).toBe(FORM_940_SOURCE_PATH);
        expect(q.sourceUrl).toBe(FORM_940_SOURCE_URL);
        expect(q.sourceUrl.startsWith("https://")).toBe(true);
        // A citation that does not name the form is not a citation.
        expect(q.cite).toContain("940");
        expect(q.soWhat.length).toBeGreaterThan(40);
      }
    }
  });
});

describe("every lesson is reachable from the real engine", () => {
  it("teaches only lines Form 940 actually has", () => {
    const boxes = form940Boxes(builtReturn());
    const realLines = new Set(boxes.map((b) => b.box));
    expect(realLines.size).toBeGreaterThan(5);

    for (const lesson of FORM_940_LESSONS) {
      expect(
        realLines.has(lesson.box),
        `lesson teaches line ${lesson.box}, which the engine never emits`,
      ).toBe(true);
      expect(lesson.formId).toBe("form_940");
    }
  });

  it("is found by lessonFor, the same lookup the screen uses", () => {
    const boxes = form940Boxes(builtReturn());
    for (const lesson of FORM_940_LESSONS) {
      const found = lessonFor(FORM_940_LESSONS, "form_940", lesson.box);
      expect(found, `lessonFor could not retrieve box ${lesson.box}`).toBeDefined();
      expect(found!.headline).toBe(lesson.headline);
    }
    // And a line with no lesson must return undefined rather than something.
    const untaught = boxes.find((b) => lessonFor(FORM_940_LESSONS, "form_940", b.box) === undefined);
    expect(untaught, "expected at least one untaught line, or the test below is vacuous").toBeDefined();
  });

  it("carries no duplicate box, because a duplicate silently shadows", () => {
    // Two lessons with the same box number means lessonFor returns the first
    // and the second is unreachable teaching that nothing will ever surface.
    const seen = new Set<string>();
    for (const lesson of FORM_940_LESSONS) {
      expect(seen.has(lesson.box), `box ${lesson.box} is taught twice`).toBe(false);
      seen.add(lesson.box);
    }
  });

  it("has no placeholder text left in it", () => {
    // A draft lesson that ships reads as authoritative and teaches nothing.
    for (const lesson of FORM_940_LESSONS) {
      for (const field of [
        lesson.headline,
        lesson.plainEnglish,
        lesson.whereItComesFrom,
        lesson.howToReadIt,
        lesson.whatToDo,
      ]) {
        expect(field.toLowerCase()).not.toContain("placeholder");
        expect(field.toLowerCase()).not.toContain("todo");
        expect(field.length).toBeGreaterThan(30);
      }
    }
  });
});

describe("the worked examples are arithmetically true", () => {
  it("gets the per-person cap right: $37,000 of excess, $13,200 taxable", () => {
    // The line 5 example claims Joan's excess is $37,000 and line 7 is $13,200.
    // Checked against the ENGINE rather than against the prose, so the lesson
    // cannot drift away from what the software actually computes.
    const ret = builtReturn();
    const line5 = ret.lines.find((l) => l.line === "5");
    const line7 = ret.lines.find((l) => l.line === "7");
    expect(line5?.amountCents).toBe(3_700_000);
    expect(line7?.amountCents).toBe(1_320_000);

    // And the cross-check the example itself offers: $7,000 + $6,200 = $13,200.
    expect(700_000 + 620_000).toBe(1_320_000);
  });

  it("gets the 0.6% best case right: $79.20", () => {
    const ret = builtReturn();
    const line8 = ret.lines.find((l) => l.line === "8");
    expect(line8?.amountCents).toBe(7_920);
    // The ten-to-one claim in the same example.
    expect(1_320_000 * 6 / 1000).toBe(7_920);
    expect(1_320_000 * 60 / 1000).toBe(79_200);
    expect(79_200 - 7_920).toBe(71_280);
  });

  it("gets the late-payment claw-back right: $200 on $2,000 paid late", () => {
    // 90 cents on the dollar survives, so 10% is lost.
    const lateCents = 200_000;
    const credited = Math.round(lateCents * 0.9);
    expect(lateCents - credited).toBe(20_000);
  });

  it("gets the quarterly split right: the four quarters equal line 12", () => {
    const ret = builtReturn();
    const line12 = ret.lines.find((l) => l.line === "12");
    const q = greenwayRequest().quarterly!;
    expect(q.q1Cents + q.q2Cents + q.q3Cents + q.q4Cents).toBe(line12?.amountCents);
    // The example's own figures.
    expect(5_130 + 930 + 930 + 930).toBe(7_920);
  });

  /**
   * GATE HOLE FOUND BY MUTATION, THEN CLOSED.
   *
   * Changing the line 3 example's stated answer from "$50,200.00" to
   * "$5,020.00" left all sixteen tests green. The worked examples are the part
   * Michael asked for by name — "I like colors and worked examples and such" —
   * and they were the one part nothing checked. A worked example that
   * contradicts the software is worse than no example, because it is read as
   * confirmation.
   *
   * So every example that states a dollar answer for a line the engine emits
   * is now parsed and compared against that line. The prose and the arithmetic
   * cannot drift apart without this failing.
   */
  it("proves each worked example's answer against the line the engine computes", () => {
    const ret = builtReturn();

    /** "$50,200.00" -> 5020000 cents. Returns null for anything not a plain amount. */
    function parseDollars(s: string): number | null {
      const m = /^\$([\d,]+)\.(\d{2})$/.exec(s.trim());
      if (!m) return null;
      return Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]);
    }

    /**
     * The lessons whose examples are built on THIS fixture — Joan $44,000 and
     * Nicholas $6,200 — and must therefore agree with it to the cent.
     *
     * Named explicitly rather than discovered, because "skip anything that
     * does not match" is how a comparison test quietly stops comparing: a
     * wrong answer would simply be filtered out and the gate would pass. The
     * late-payment example on line 10 deliberately uses different facts and is
     * checked by the arithmetic identity test below instead.
     */
    const FIXTURE_BASED_LINES = ["3", "5", "7", "8", "12", "17"] as const;

    let compared = 0;
    for (const box of FIXTURE_BASED_LINES) {
      const lesson = FORM_940_LESSONS.find((l) => l.box === box);
      expect(lesson, `no lesson for line ${box}`).toBeDefined();

      const line = ret.lines.find((l) => l.line === box);
      expect(line, `engine emits no line ${box}`).toBeDefined();
      expect(line!.amountCents, `line ${box} is blank on this fixture`).not.toBeNull();

      const stated = lesson!.examples
        .map((ex) => parseDollars(ex.answer))
        .filter((v): v is number => v !== null);

      expect(
        stated.length,
        `line ${box} has no worked example stating a dollar answer`,
      ).toBeGreaterThanOrEqual(1);

      expect(
        stated,
        `line ${box}: no worked example matches the engine's ${line!.amountCents} cents`,
      ).toContain(line!.amountCents);
      compared += 1;
    }

    // Rule 39: if the list above were ever emptied, the loop proves nothing.
    expect(compared).toBe(FIXTURE_BASED_LINES.length);
  });

  it("states the wage base the engine actually applies", () => {
    // The prose says $7,000. If the engine ever used a different cap the
    // lessons would be teaching a number the software does not use.
    expect(FUTA_WAGE_BASE_DOLLARS).toBe(7_000);
    const ret = builtReturn();
    const line3 = ret.lines.find((l) => l.line === "3");
    const line5 = ret.lines.find((l) => l.line === "5");
    // Joan capped at 7,000 plus Nicholas's full 6,200.
    const taxable = (line3?.amountCents ?? 0) - (line5?.amountCents ?? 0);
    expect(taxable).toBe(FUTA_WAGE_BASE_DOLLARS * 100 + 620_000);
  });
});

describe("the central teaching claim about FUTA holds", () => {
  it("shows Form 940 as one hundred percent the employer's money", () => {
    // Every lesson says FUTA is never withheld. If a line were ever classified
    // as employee money the lessons would be lying, so the claim is asserted
    // against the adapter rather than merely written down.
    const split = splitMoney(form940Boxes(builtReturn()));
    expect(split.employeeCents).toBe(0);
    expect(split.employerCents).toBeGreaterThan(0);
    expect(split.employerMilliPct).toBe(100_000);
  });

  it("keeps the wage-base lines out of the money split", () => {
    // Lines 3, 5 and 7 are the biggest figures on the form and nobody owes
    // them. If they leaked into the split, the "whose money" bar would claim
    // Greenway owes fifty thousand dollars of federal unemployment tax.
    const split = splitMoney(form940Boxes(builtReturn()));
    expect(split.totalCents).toBeLessThan(100_000);
  });

  it("teaches every line the whose-money table calls employer_cost and a reader would query", () => {
    // Not every line needs a lesson yet, but the four that decide the tax do:
    // 8 is the best case, 9 and 10 are the claw-backs, 12 is the answer.
    const taught = new Set(FORM_940_LESSONS.map((l) => l.box));
    for (const decisive of ["8", "9", "10", "12"]) {
      expect(taught.has(decisive), `line ${decisive} decides the tax and must be taught`).toBe(true);
    }
  });
});
