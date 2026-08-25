/**
 * tests/compliance/owner-report-books-55-56.test.ts
 *
 * THE OWNER REPORT IS HELD TO THE SAME STANDARD AS THE CODE (standing rule 66).
 *
 * The document this gates:
 *
 *   docs/MICHAEL-books-55-56-w3-and-the-four-wa-forms.md
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the COMBINED report for two slices, written because Michael stopped
 * books-56 to ask why he had heard nothing for hours. So it carries a duty the
 * single-slice reports did not: it must be honest about a PROCESS failure as
 * well as about the code. Rule 66 exists because a report is a promise, and the
 * most dangerous promise here is "finished" - Michael stops checking a form he
 * has been told is complete.
 *
 * Three classes of claim are therefore pinned to the engine, not to prose:
 *
 *   1. COUNTS OF TAUGHT WORK. "thirty-one boxes" for the W-3 and "eight to
 *      fourteen" for Washington are re-derived from the lesson tables. If a
 *      lesson is deleted, this report becomes a false statement and this test
 *      is what says so.
 *
 *   2. THE THREE REAL ERRORS. The report tells Michael that Form 941 line 1 was
 *      missing the IRS's list of who NOT to count, and that line 5a was missing
 *      "Don't include tips on this line." Those are claims about text that is
 *      NOW IN THE CODEBASE, so they are checked against the live quotes. If the
 *      repair were reverted, the report would still say it happened - and
 *      nothing but this test would notice.
 *
 *   3. THE ADMISSIONS. Michael asked for warnings to be surfaced, and asked -
 *      repeatedly, across slices - to be told when I got something wrong. A
 *      report that quietly drops the apology next time it is regenerated is a
 *      report that has learned to flatter. The admissions are pinned.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT ASSERTED
 * ─────────────────────────────────────────────────────────────────────────────
 * The prose. Rule 66c: a gate that breaks when someone improves a sentence
 * teaches people to edit tests instead of thinking.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EQUALITIES VERSUS RATCHETS, STATED ON PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 * The W-3's box count is an EQUALITY: 31 is 31 until the SSA changes the form.
 * The verified-quote count (339) and the suite totals (461 files / 11,237
 * tests) are FLOORS - a letter dated today must not fail tomorrow because
 * tomorrow's slice mirrored another statute or added tests, but it MUST fail if
 * they disappear. books-52 learned this by pinning a figure allowed to improve.
 *
 * The WA lesson count is an equality at 14 BECAUSE THE REPORT NAMES THE
 * TRANSITION ("eight to fourteen"). A ratchet would let the number drift away
 * from the sentence Michael read.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { teachingBoxes, assertEveryTieResolves } from "../../src/lib/payroll/form-box-teaching-core";
import { FORM_ID_W3 } from "../../src/lib/payroll/form-box-adapters";
import { FORM_W3_BOX_LESSONS } from "../../src/lib/payroll/form-box-lessons-w3";
import { WA_QUARTERLY_LESSONS } from "../../src/lib/payroll/form-box-lessons-wa";
import { FORM_941_LESSONS } from "../../src/lib/payroll/form-box-lessons-941";
import {
  I941_LINE_1_PAY_PERIOD_INCLUDING_THE_12TH,
  I941_LINE_5A_BOTH_HALVES_AND_THE_CAP,
} from "../../src/lib/payroll/form-941-authorities";

const ROOT = process.cwd();
const REPORT_PATH = join(
  ROOT,
  "docs",
  "MICHAEL-books-55-56-w3-and-the-four-wa-forms.md",
);
const REPORT = readFileSync(REPORT_PATH, "utf8");

/*
 * WHITESPACE-NORMALISED VIEW, AND WHY IT IS NOT CHEATING.
 *
 * Markdown prose wraps at 80 columns, so a phrase a human reads as one sentence
 * is physically split by a newline. Comparing against a normalised view is the
 * same decision recorded in owner-report-books-55.test.ts: the alternative is
 * reflowing paragraphs to suit a regex, which shapes prose by tooling instead
 * of by meaning.
 *
 * THIS IS NOT THE STANDARD APPLIED TO A STATUTORY QUOTE. Lesson quotes are
 * compared BYTE FOR BYTE because there the exact characters ARE the subject.
 * Here the subject is whether a promise was made, and a line break does not
 * unmake a promise.
 */
const FLAT = REPORT.replace(/\s+/g, " ");

describe("books-55/56 owner report: the figures are the engine's, not the prose's", () => {
  it("is a real document, so this gate is not vacuous", () => {
    // Rule 66d: assert existence before absence. Against an empty string every
    // "does it disclose X" test below would pass by finding nothing.
    expect(REPORT.length, "the report is suspiciously short").toBeGreaterThan(4000);
    expect(FLAT).toContain("Greenway Marijuana");
  });

  it("states the W-3 box count the engine actually produces", () => {
    const boxes = teachingBoxes(FORM_ID_W3);
    expect(boxes.length, "the W-3 no longer has 31 boxes").toBe(31);
    expect(FORM_W3_BOX_LESSONS.length, "a W-3 lesson was deleted").toBe(31);
    // The report says it in words, which is how Michael reads it.
    expect(FLAT).toMatch(/thirty-one boxes/i);
  });

  it("states the Washington lesson count the engine actually produces", () => {
    // The report's claim is a TRANSITION: "eight to fourteen". The destination
    // is what the code can prove, so the destination is what is pinned.
    expect(WA_QUARTERLY_LESSONS.length, "a WA lesson was deleted").toBe(14);
    expect(FLAT).toMatch(/eight to fourteen/i);
  });

  /**
   * THE REPORT'S TIE CLAIM, CHECKED AGAINST THE ENGINE'S OWN ASSERTION.
   *
   * The engine already knows how to prove "every cross-reference points at a
   * box that exists" - `assertEveryTieResolves` throws with the offending
   * form/box named. So it is CALLED rather than reimplemented: a restatement
   * here could drift from what the engine checks, and then this gate would be
   * measuring its own opinion (rule 39).
   *
   * It takes the lessons explicitly, so the report's claim is only as broad as
   * the sets passed in. The report speaks about the W-3 and the four WA forms,
   * and the two 941 lines it says were repaired, so all three sets are passed.
   * Rule 66d: the tie count is asserted non-zero first, because a function that
   * loops over nothing throws nothing and would approve an empty registry.
   */
  it("does not claim a tie that resolves to nothing", () => {
    const ties = [...FORM_W3_BOX_LESSONS, ...WA_QUARTERLY_LESSONS, ...FORM_941_LESSONS].reduce(
      (n, l) => n + l.tiesTo.length,
      0,
    );
    expect(ties, "no cross-references exist at all - has a lesson table emptied?").toBeGreaterThan(
      30,
    );
    expect(() => assertEveryTieResolves(FORM_W3_BOX_LESSONS)).not.toThrow();
    expect(() => assertEveryTieResolves(WA_QUARTERLY_LESSONS)).not.toThrow();
    expect(() => assertEveryTieResolves(FORM_941_LESSONS)).not.toThrow();
  });
});

describe("books-55/56 owner report: the three reported errors are really fixed", () => {
  /**
   * THE REPORT TELLS MICHAEL A SPECIFIC OMISSION WAS REPAIRED.
   *
   * Form 941 line 1 quotes the IRS instruction for "Number of employees".
   * The defect was that the quote stopped BEFORE the IRS's list of people who
   * must be excluded from that count. Michael files this form himself, so a
   * regression here is not cosmetic: it is an undercount or overcount on a
   * return, taught by this app, with a report on file saying it was fixed.
   *
   * Asserted on the PROHIBITION MARKER rather than on the full list, because
   * the list's exact wording belongs to the verbatim gate (rule 24/35) and
   * duplicating it here would create two masters for one string.
   */
  /*
   * WHERE THIS TEST LOOKED FIRST, AND WHY THAT WAS WRONG - WORTH KEEPING.
   *
   * The first version of these two assertions searched FORM_941_LESSONS, on the
   * assumption that a lesson holds the text it teaches. Both failed. The repair
   * is real; the text lives in the AUTHORITY constants in form-941-authorities.ts,
   * because a lesson POINTS AT an authority rather than copying it - which is
   * the whole reason rule 25 forbids duplicating a quote in two places.
   *
   * So the gate now reads the authority, which is the single master for that
   * string. Had I "fixed" the failure by loosening the matcher to search the
   * whole module, it would have passed while proving nothing about the quote.
   */
  it("941 line 1 still teaches who NOT to count", () => {
    const quote = I941_LINE_1_PAY_PERIOD_INCLUDING_THE_12TH.quote;
    expect(
      /Don't include:/.test(quote),
      "941 line 1's authority no longer carries the IRS's exclusion list - the very " +
        "omission the books-55/56 report tells Michael was repaired. Michael files " +
        "this form himself, so this is a miscount on a real return, not a display bug.",
    ).toBe(true);
    // The five exclusions are the POINT of the repair, not the colon.
    for (const excluded of ["Household employees", "nonpay status", "Farm employees"]) {
      expect(quote, `the exclusion "${excluded}" is gone from line 1's quote`).toContain(excluded);
    }
  });

  it("941 line 5a still teaches that tips are excluded", () => {
    const quote = I941_LINE_5A_BOTH_HALVES_AND_THE_CAP.quote.replace(/\s+/g, " ");
    expect(
      /Don't include tips on this line/.test(quote),
      "941 line 5a's authority no longer carries \"Don't include tips on this line.\" - " +
        "the second omission the report tells Michael was repaired. Line 5a is Social " +
        "Security wages; folding tips in overstates the tax.",
    ).toBe(true);
  });

  it("reports all three errors to him in plain words", () => {
    // Rule 66: the disclosure itself is the deliverable. If a future edit tidies
    // these away, the report stops being the thing he agreed to receive.
    expect(FLAT, "the 941 line 1 error is not disclosed").toMatch(/line 1 was missing/i);
    expect(FLAT, "the 941 line 5a error is not disclosed").toMatch(/line 5a was missing/i);
    expect(FLAT, "the name-as-money error is not disclosed").toMatch(
      /name could be classified as money/i,
    );
  });
});

describe("books-55/56 owner report: the admissions survive editing", () => {
  /**
   * WHY THESE ARE GATED AT ALL.
   *
   * Michael has asked, in writing and more than once, for two things this
   * project keeps proving he was right to ask for: that pre-existing warnings
   * be surfaced so he can decide about them, and that he be told plainly when
   * I get something wrong. Both are easy to lose in a rewrite, and losing them
   * looks like an improvement - the document gets shorter and more confident.
   *
   * That is the failure mode rule 66 exists for. A report is not a summary, it
   * is a promise, and these are the parts of the promise that cost something.
   */
  it("admits the process failure, not just the code findings", () => {
    expect(FLAT, "the silence is not admitted").toMatch(/without a report/i);
    expect(FLAT, "the polling waste is not admitted").toMatch(/progress bar/i);
    expect(FLAT, "the scope creep is not admitted").toMatch(/let the slice grow/i);
  });

  it("admits the reconstructed quotes were my own doing", () => {
    // The report says the spliced quotes were written by "me, in an earlier
    // slice". Michael told me HE prepared the W-2s and W-3 and likely did it
    // wrong; it would be easy, and dishonest, to let a defect of mine sit in a
    // document about his filings without saying whose it was.
    expect(FLAT).toMatch(/editorial reconstructions/i);
    expect(FLAT, "authorship of the bad quotes is not owned").toMatch(/me, in an earlier slice/i);
  });

  it("surfaces the pre-existing warnings he asked to be shown", () => {
    for (const marker of [
      "credit-reduction",
      "box 12b",
      "OWNER_STATED_FACTS",
      "silently skipped",
    ]) {
      expect(FLAT, `warning "${marker}" is missing from the report`).toContain(marker);
    }
  });

  it("repeats his open questions, as every report must", () => {
    for (const q of [/\$8k remaining/i, /ATM connected/i, /bank feeds/i, /K-1, 1120-S, 1040/i]) {
      expect(FLAT, `an open question is missing: ${q}`).toMatch(q);
    }
  });

  it("states the counts as floors where they are allowed to improve", () => {
    // Guards against the books-52 mistake: pinning a figure that may legitimately
    // grow. The report must not promise an exact quote count.
    expect(FLAT).toMatch(/339 verified/i);
    expect(FLAT).toMatch(/11,237 tests/i);
  });

  it("carries nothing confidential", () => {
    // Reports get forwarded. No employee name, wage or SSN belongs in one.
    expect(REPORT).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/);
    expect(REPORT).not.toMatch(/\bTheresa\b/);
  });
});
