/**
 * tests/compliance/form-box-lessons-w2.test.ts   (books-49)
 *
 * ═══ RULE 24/35: VERBATIM MUST BE MECHANICALLY VERIFIED, NOT CAREFULLY TYPED ═══
 *
 * The load-bearing test in this file reads the mirrored IRS instructions off
 * disk and confirms every quoted string is actually present in them, character
 * for character. A citation nobody checks is decoration, and a MISQUOTED
 * citation is worse than none: it is authority-shaped and wrong.
 *
 * This matters more on the W-2 than on any other form in the system. The 941
 * and the 940 are conversations between Greenway and the IRS. The W-2 goes to
 * a PERSON, who files their own tax return from it. An error here does not
 * produce a notice addressed to Michael - it produces a wrong refund for an
 * employee, then a W-2c, then a corrected personal return. So the standard of
 * proof for what the instructions actually say has to be mechanical.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  FORM_W2_BOX_LESSONS,
  FORM_W2_SOURCE_PATH,
  FORM_W2_SOURCE_URL,
  SS_WAGE_BASE_2026_DOLLARS,
  BOX_4_CEILING_2026_DOLLARS,
} from "@/lib/payroll/form-box-lessons-w2";
import { lessonFor } from "@/lib/payroll/form-box-core";
import { FORM_W2_WHOSE } from "@/lib/payroll/form-box-adapters";
import { teachingBoxes, assertEveryTaughtBoxHasASpecimen } from "@/lib/payroll/form-box-teaching-core";

const corpus = readFileSync(FORM_W2_SOURCE_PATH, "utf8");

describe("every W-2 quote is really in the IRS instructions", () => {
  it("finds each quoted passage verbatim in the mirrored file", () => {
    let checked = 0;
    for (const lesson of FORM_W2_BOX_LESSONS) {
      for (const q of lesson.quotes) {
        expect(
          corpus.includes(q.quote),
          `Form W-2 box ${lesson.box}: quote NOT found verbatim in ${q.sourcePath}:\n${q.quote}`,
        ).toBe(true);
        checked += 1;
      }
    }
    // Assert existence before absence (rule 66d): if this file ever loses its
    // quotes the loop above passes trivially.
    expect(checked).toBeGreaterThanOrEqual(8);
    console.log(`form-w2 lessons: ${checked} quotes verified verbatim against the corpus`);
  });

  /**
   * THE GATE THAT PROVES THE GATE WORKS.
   *
   * A verbatim check is only meaningful if a non-verbatim string would fail
   * it. Rule 15: a test must be proven capable of failing. This constructs the
   * mistake a careful human actually makes - retyping a quote and "fixing" the
   * PDF's line breaks into spaces - and confirms the corpus rejects it.
   */
  it("would reject a quote that had been tidied up", () => {
    const real = FORM_W2_BOX_LESSONS[0].quotes[0].quote;
    expect(corpus.includes(real)).toBe(true);
    const tidied = real.replace(/\n/g, " ");
    expect(tidied).not.toBe(real);
    expect(
      corpus.includes(tidied),
      "the corpus accepted a reflowed quote, so the verbatim check proves nothing",
    ).toBe(false);
  });

  it("cites the figures it quotes, and the corpus contains them", () => {
    // Both constants are quoted in the box 4 instruction. If the IRS revises
    // the wage base, this fails rather than teaching last year's number.
    expect(corpus).toContain(
      `$${BOX_4_CEILING_2026_DOLLARS.toLocaleString("en-US")} ($${SS_WAGE_BASE_2026_DOLLARS.toLocaleString("en-US")} \u00d7 6.2%)`,
    );
  });

  it("points every quote at a URL Michael can open", () => {
    for (const lesson of FORM_W2_BOX_LESSONS) {
      for (const q of lesson.quotes) {
        expect(q.sourceUrl).toBe(FORM_W2_SOURCE_URL);
        expect(q.sourceUrl.startsWith("https://")).toBe(true);
        expect(q.cite.length).toBeGreaterThan(20);
        // "So what" is the translation from law into action. A citation
        // without one is a wall of text, which is what Michael complained of.
        expect(q.soWhat.length, `box ${lesson.box} quote has no real soWhat`).toBeGreaterThan(60);
      }
    }
  });
});

describe("the W-2 lessons cover the form and are reachable", () => {
  it("teaches every box the adapter can classify", () => {
    const taught = new Set(FORM_W2_BOX_LESSONS.map((l) => l.box));
    for (const box of Object.keys(FORM_W2_WHOSE)) {
      expect(taught.has(box), `W-2 box ${box} is rendered but has no lesson`).toBe(true);
    }
    expect(taught.size).toBe(Object.keys(FORM_W2_WHOSE).length);
  });

  it("is reachable through lessonFor, which is how the explorer looks them up", () => {
    for (const lesson of FORM_W2_BOX_LESSONS) {
      const found = lessonFor(FORM_W2_BOX_LESSONS, "form_w2", lesson.box);
      expect(found, `box ${lesson.box} cannot be found by the explorer's own lookup`).toBeDefined();
      expect(found?.headline).toBe(lesson.headline);
    }
  });

  /**
   * THE BUG THIS SLICE FIXED, PINNED SO IT CANNOT RETURN.
   *
   * A lesson for a box that has no teaching specimen is a lesson Michael
   * cannot reach before payroll exists - which was the whole complaint. This
   * asserts every W-2 lesson has somewhere to live on an empty screen.
   */
  it("has a specimen box for every lesson, so it teaches before payroll exists", () => {
    assertEveryTaughtBoxHasASpecimen(FORM_W2_BOX_LESSONS);
    const specimen = teachingBoxes("form_w2");
    expect(specimen.length).toBe(FORM_W2_BOX_LESSONS.length);
    for (const b of specimen) {
      // Never a fabricated figure. A zero would claim Greenway paid nothing.
      expect(b.notComputedYet).not.toBeNull();
      expect(b.amountCents).toBe(0);
    }
  });

  it("writes real teaching rather than placeholders", () => {
    for (const l of FORM_W2_BOX_LESSONS) {
      expect(l.plainEnglish.length, `box ${l.box} plainEnglish is thin`).toBeGreaterThan(120);
      expect(l.whereItComesFrom.length).toBeGreaterThan(40);
      expect(l.howToReadIt.length).toBeGreaterThan(60);
      expect(l.whatToDo.length).toBeGreaterThan(60);
      // Rule: every box on this form HAS a characteristic error. If a future
      // author sets one to null they must justify it here, deliberately.
      expect(l.commonMistake, `box ${l.box} claims to have no common mistake`).not.toBeNull();
      expect(l.examples.length, `box ${l.box} has no worked example`).toBeGreaterThanOrEqual(1);
      for (const ex of l.examples) {
        expect(ex.steps.length).toBeGreaterThanOrEqual(3);
        expect(ex.moral.length).toBeGreaterThan(40);
      }
    }
  });

  /**
   * THE CROSS-FORM LINKS ARE THE POINT OF THE WHOLE SYSTEM.
   *
   * Box 3 of the W-2 is not merely similar to line 5a of the 941 - it is the
   * same money counted twice, and if they disagree one of them is wrong. The
   * wage and tax boxes must each say which box on which other form has to
   * agree with them; boxes 16 and 17 correctly tie to nothing, because
   * Washington has no state income tax for them to reconcile against.
   */
  it("links the federal wage and tax boxes to their 941 counterparts", () => {
    const mustTie = ["1", "2", "3", "4", "5", "6"];
    for (const box of mustTie) {
      const l = FORM_W2_BOX_LESSONS.find((x) => x.box === box);
      expect(l, `box ${box} is missing`).toBeDefined();
      expect(l!.tiesTo.length, `W-2 box ${box} ties to nothing on any other form`).toBeGreaterThanOrEqual(1);
      for (const t of l!.tiesTo) {
        expect(t.formId).toBe("form_941");
        expect(t.why.length).toBeGreaterThan(60);
      }
    }
  });

  it("asserts the Washington blanks as blanks, not as missing figures", () => {
    for (const box of ["16", "17"]) {
      const l = FORM_W2_BOX_LESSONS.find((x) => x.box === box);
      expect(l).toBeDefined();
      // Rule 87: an absence asserted AS an absence. These two boxes tie to
      // nothing on purpose, and the lesson must say Washington is the reason.
      expect(l!.tiesTo).toEqual([]);
      const text = `${l!.plainEnglish} ${l!.howToReadIt}`.toLowerCase();
      expect(text).toContain("washington");
      expect(text).toContain("blank");
    }
  });
});
