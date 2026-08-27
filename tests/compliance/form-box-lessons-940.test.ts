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

/**
 * ═══ WHAT IS ACTUALLY PRINTED ON FORM 940, READ OFF THE PAPER (books-54) ═══
 *
 * Thirty numbered lines, transcribed from the filed 2025 Form 940 at
 * /workspace/2025_FORM_940_-_SAGE.pdf by extracting its text and reading each
 * label in context. This is an OUTSIDE MEASUREMENT: it does not come from the
 * engine, the specimen table, or the ownership table, so it can contradict all
 * three. That is the whole point (rule 39).
 *
 * WHY THIS LIST REPLACED AN ENGINE-DERIVED ONE. The gate below used to read
 * `form940Boxes(builtReturn())` and refuse any lesson for a line the engine did
 * not emit. That sounds strict and is actually the wrong shape, because the
 * engine emits only the eighteen lines that carry an AMOUNT for one particular
 * fixture. The twelve tickbox and text lines -- 1a, 1b, 2, 4a-4e, 15b-15e --
 * are on the paper, print on Michael's own filed copy, and can never be
 * emitted by an arithmetic engine, so the old gate made them permanently
 * unteachable. It was enforcing "the engine knows about it" while reading as
 * "the form has it".
 *
 * The 941 never had this restriction, which is why books-53 could teach its
 * tickboxes (lines 4, 15b-15e, 16-18) without a fight.
 *
 * A regex was NOT used to build this list. An earlier attempt at one on this
 * very form returned 28 labels including the false positives "24" and "25" from
 * a paragraph of body text, and MISSED "5f" because a lowercase word followed
 * it. Every entry below was confirmed by reading its surrounding line.
 */
/*
 * ═══ books-65: THE LIST WAS SHORT BY FIVE, AND IT IS THE SAME CLASS AGAIN ═══
 *
 * The note above records that this list REPLACED an engine-derived one because
 * the engine could only emit lines carrying an amount, which made twelve
 * tickbox lines "permanently unteachable". Correct diagnosis, incomplete cure:
 * the replacement enumerated the NUMBERED lines and stopped, while the gate
 * below reads as "is this on the paper?".
 *
 * The five identifier boxes at the top of page 1 are on the paper. Measured on
 * Michael's own filed return rather than argued:
 *
 *   $ pdftotext -layout -f 1 -l 1 "2025_FORM_940_-_SAGE.pdf" -
 *     Employer identification number
 *     (EIN)                    4 6   4 2 1 7 0 1 6
 *     Trade name (if any)
 *     Address
 *     Name (not your trade name)
 *
 * They print, they carry his data, and until books-65 the teaching specimen had
 * no box for them at all — which is defect D-15, the reason his company profile
 * never appeared on any form. Adding the boxes fixed the printing; adding the
 * lessons removed the untaught marker; and this list has to admit they exist or
 * the gate rejects the lessons for boxes the form demonstrably has.
 *
 * They are listed by their box ID rather than by a line number because the IRS
 * does not number them — the form prints them as captioned spaces above line
 * 1a. The ids match the specimen and the facsimile, which is what makes a
 * company-profile value reach paper.
 */
const LINES_ON_THE_PRINTED_940: readonly string[] = [
  // The identifier spaces at the top of page 1. Not numbered by the IRS.
  "ein", // Employer identification number (EIN)
  "name", // Name (not your trade name)
  "tradeName", // Trade name (if any)
  "address", // Address - number, street, and suite or room number
  "cityStateZip", // City, state, and ZIP code
  "1a", // If you had to pay state unemployment tax in one state only...
  "1b", // ...in more than one state, you are a multi-state employer
  "2", // If you paid wages in a state that is subject to CREDIT REDUCTION
  "3", // Total payments to all employees
  "4", // Payments exempt from FUTA tax
  "4a", // Check all that apply: Fringe benefits
  "4b", // Group-term life insurance
  "4c", // Retirement/Pension
  "4d", // Dependent care
  "4e", // Other
  "5", // Total of payments made to each employee in excess of $7,000
  "6", // Subtotal (line 4 + line 5 = line 6)
  "7", // Total taxable FUTA wages (line 3 - line 6 = line 7)
  "8", // FUTA tax before adjustments (line 7 x 0.006 = line 8)
  "9", // If ALL of the taxable FUTA wages were excluded from state unemployment tax
  "10", // If SOME of the taxable FUTA wages were excluded...
  "11", // If credit reduction applies, enter the total from Schedule A
  "12", // Total FUTA tax after adjustments
  "13", // FUTA tax deposited for the year, including any overpayment applied
  "14", // Balance due
  "15a", // Overpayment
  "15b", // Check one: Apply to next return. / Send a refund.
  "15c", // Routing number
  "15d", // Type: Checking / Savings
  "15e", // Account number
  "16a", // 1st quarter (January 1 - March 31)
  "16b", // 2nd quarter (April 1 - June 30)
  "16c", // 3rd quarter (July 1 - September 30)
  "16d", // 4th quarter (October 1 - December 31)
  "17", // Total tax liability for the year
];

describe("every lesson is reachable from the real engine", () => {
  it("teaches only lines Form 940 actually has", () => {
    // 30 numbered lines plus the five unnumbered identifier spaces at the top
    // of page 1 (books-65). Still a hard number rather than a floor: a line
    // vanishing from this list should require someone to say so.
    expect(LINES_ON_THE_PRINTED_940).toHaveLength(35);
    const onPaper = new Set(LINES_ON_THE_PRINTED_940);

    for (const lesson of FORM_940_LESSONS) {
      expect(
        onPaper.has(lesson.box),
        `lesson teaches line ${lesson.box}, which is not printed on Form 940`,
      ).toBe(true);
      expect(lesson.formId).toBe("form_940");
    }
  });

  /**
   * RULE 15 -- the gate above must be able to fail.
   *
   * A `Set.has` check against a hand-written list is exactly the kind of gate
   * that passes vacuously if the list is wrong or empty. Assert a line that is
   * NOT on the 940 is rejected, and one that IS is accepted.
   */
  it("would reject a lesson for a line the form does not have", () => {
    const onPaper = new Set(LINES_ON_THE_PRINTED_940);
    // Form 941 has lines 18 and 5a. Form 940 has neither.
    expect(onPaper.has("18")).toBe(false);
    expect(onPaper.has("5a")).toBe(false);
    // And the boundaries of the real list.
    expect(onPaper.has("1a")).toBe(true);
    expect(onPaper.has("17")).toBe(true);
  });

  /**
   * THE ENGINE-VERSUS-PAPER GAP, STATED RATHER THAN HIDDEN.
   *
   * Replacing the engine-derived list with the printed one would be a quiet
   * loosening if nothing recorded what the engine covers. So this measures the
   * gap explicitly: every line the engine DOES emit must be on the paper (an
   * engine emitting a line that does not exist is a serious bug), and the lines
   * on the paper that the engine cannot emit must be exactly the twelve tickbox
   * and text lines.
   */
  it("emits only real lines, and the gap is exactly the twelve non-amount lines", () => {
    /*
     * ═══ WIDENED IN books-63, AND WHY IT IS NOT A LOOSENING ═══
     *
     * `form940Boxes` now also emits the employer ENTITY area - the EIN, legal
     * name, trade name, address and city/state/ZIP that fill the top of page 1
     * and are repeated at the top of page 2. Before books-63 it did not, so a
     * live 940 printed its whole FUTA arithmetic under an anonymous header on
     * both pages. See D-09.
     *
     * Those five are NOT numbered lines, so they must not be added to
     * `LINES_ON_THE_PRINTED_940` - that list is what proves the form has thirty
     * lines and that the twelve tickbox/text lines are the exact gap. Adding
     * text boxes to it would corrupt the very thing this file measures.
     *
     * So they are named, asserted PRESENT, and then excluded before the
     * line-level check. Naming them is what stops this being a hole: a sixth
     * unexpected box id still fails, and an entity box that stopped being
     * emitted fails too - which is the defect D-09 actually was.
     */
    const ENTITY_BOXES = ["ein", "name", "tradeName", "address", "cityStateZip"] as const;

    const emittedAll = form940Boxes(builtReturn()).map((b) => b.box);
    for (const e of ENTITY_BOXES) {
      expect(emittedAll, `the 940 stopped emitting entity box ${e} - this is D-09`).toContain(e);
    }

    const emitted = emittedAll.filter((b) => !ENTITY_BOXES.includes(b as (typeof ENTITY_BOXES)[number]));
    const onPaper = new Set(LINES_ON_THE_PRINTED_940);
    for (const box of emitted) {
      expect(onPaper.has(box), `engine emits line ${box}, which is not on the form`).toBe(true);
    }
    // books-65: compare against emittedAll, not emitted. LINES_ON_THE_PRINTED_940
    // now names the five identity boxes as well, because pdftotext of Michael's
    // filed 2025 940 prints them on page 1. They ARE emitted, so subtracting the
    // entity-stripped list would falsely report them as missing from the engine.
    const notEmitted = LINES_ON_THE_PRINTED_940.filter((b) => !emittedAll.includes(b));
    expect(notEmitted).toEqual([
      "1a",
      "1b",
      "2",
      "4a",
      "4b",
      "4c",
      "4d",
      "4e",
      "15b",
      "15c",
      "15d",
      "15e",
    ]);
  });

  it("is found by lessonFor, the same lookup the screen uses", () => {
    const boxes = form940Boxes(builtReturn());
    for (const lesson of FORM_940_LESSONS) {
      const found = lessonFor(FORM_940_LESSONS, "form_940", lesson.box);
      expect(found, `lessonFor could not retrieve box ${lesson.box}`).toBeDefined();
      expect(found!.headline).toBe(lesson.headline);
    }
    // books-65: every box the engine emits is now taught, which is the whole
    // point of the slice - Michael asked that no box be left with the dotted
    // "red squiggly" marker. So state that as the positive claim.
    for (const b of boxes) {
      expect(
        lessonFor(FORM_940_LESSONS, "form_940", b.box),
        `box ${b.box} is emitted by the engine but has no lesson - it will render with the untaught marker`,
      ).toBeDefined();
    }

    // The assertion above is only worth anything if lessonFor is capable of
    // returning undefined at all. Until books-65 that was proven by finding a
    // real untaught box; there are none left, so prove it against an id the
    // form does not have. Rule 66d: assert the thing exists before asserting
    // the other thing is absent - the loop above is the existence half.
    const ABSENT_BOX = "line-that-form-940-does-not-have";
    expect(
      FORM_940_LESSONS.some((l) => l.box === ABSENT_BOX),
      "the sentinel box id was accidentally taught, so the miss below proves nothing",
    ).toBe(false);
    expect(lessonFor(FORM_940_LESSONS, "form_940", ABSENT_BOX)).toBeUndefined();
    // And a real box id looked up under the wrong form must also miss, because
    // lessonFor keys on form as well as box.
    expect(lessonFor(FORM_940_LESSONS, "form_941", boxes[0]!.box)).toBeUndefined();
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
