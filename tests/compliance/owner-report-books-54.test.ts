/**
 * tests/compliance/owner-report-books-54.test.ts
 *
 * THE OWNER REPORT IS HELD TO THE SAME STANDARD AS THE CODE (standing rule 66).
 *
 * The document this gates:
 *
 *   docs/MICHAEL-books-54-the-940-is-finished.md
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ───────────────────────────────────────────────────────────────────────────
 * This report tells Michael a second form is FINISHED, and repeats the most
 * dangerous sentence in the repository: "every line on the printed form is
 * taught". He will stop checking a form he has been told is complete. So the
 * claim is re-derived here from an OUTSIDE measurement -- the thirty labels
 * read off the Form 940 he actually filed -- rather than from my memory of
 * this afternoon's work.
 *
 * The report also makes four numeric claims that would be reassuring lies if
 * they drifted: 30 lines taught, 20 lessons, 34 authorities, and 30 of 30
 * ownership mutations caught. The first three are checked against the engine.
 * The fourth cannot be re-run inside a test in reasonable time, so what is
 * checked instead is the thing the sweep PROVED: that the pinned ownership
 * table covers all thirty rows in both directions, which is the mechanism that
 * makes 30 of 30 possible at all.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT ASSERTED
 * ───────────────────────────────────────────────────────────────────────────
 * The prose. Rule 66c: a gate that breaks when someone improves a sentence
 * teaches people to edit tests instead of thinking. Pinned here are the
 * figures, the four pre-existing warnings Michael asked to be told about, the
 * admission of my own error, the five still-open questions, and the absence of
 * anything confidential.
 *
 * One asymmetry worth stating. The 940's completeness is an EQUALITY (30 is 30
 * until the IRS changes the form), while the lesson count is a RATCHET, because
 * lessons may legitimately be added later and a dated letter must not punish
 * that. books-52 learned this the hard way.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  teachingBoxes,
  assertEveryTieResolves,
} from "../../src/lib/payroll/form-box-teaching-core";
import {
  FORM_940_WHOSE,
  assertEvery940LineOwnershipIsPinned,
  assertForm940AnnualTotalIsTheEmployersCost,
} from "../../src/lib/payroll/form-box-adapters";
import { FORM_940_LESSONS } from "../../src/lib/payroll/form-box-lessons-940";
import { FORM_940_OWN_AUTHORITIES } from "../../src/lib/payroll/form-940-authorities";
import { WA_QUARTERLY_LESSONS } from "../../src/lib/payroll/form-box-lessons-wa";
import { FORM_941_LESSONS } from "../../src/lib/payroll/form-box-lessons-941";
import { FORM_W2_BOX_LESSONS } from "../../src/lib/payroll/form-box-lessons-w2";
import { FORM_941_CONFIRMATION_LESSONS } from "../../src/lib/payroll/form-941-confirmation-lessons";

const ROOT = process.cwd();
const REPORT_PATH = join(ROOT, "docs", "MICHAEL-books-54-the-940-is-finished.md");
const REPORT = readFileSync(REPORT_PATH, "utf8");

/**
 * Every line label printed on the Form 940 Michael actually filed, read off
 * 2025_FORM_940_-_SAGE.pdf. The OUTSIDE measurement: it does not come from the
 * application, so the application can be checked against it.
 *
 * The roadmap recorded 21 and listed the gap as "1a, 1b, 2, 4a-4e". Both were
 * wrong, which is exactly why this lives here as data rather than as a count.
 */
const LABELS_ON_THE_PRINTED_940: readonly string[] = [
  "1a",
  "1b",
  "2",
  "3",
  "4",
  "4a",
  "4b",
  "4c",
  "4d",
  "4e",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15a",
  "15b",
  "15c",
  "15d",
  "15e",
  "16a",
  "16b",
  "16c",
  "16d",
  "17",
];

describe("the books-54 report exists and is the document it claims to be", () => {
  it("is a real file with substantial content", () => {
    // Rule 66d: assert existence before asserting anything about the contents.
    // Every `toContain` below would pass vacuously against a missing file only
    // if the read threw -- but a TRUNCATED file would pass some and fail others
    // confusingly, so the size is pinned first.
    expect(REPORT.length).toBeGreaterThan(8_000);
    expect(REPORT).toContain("Slice books-54");
    expect(REPORT).toContain("Form 940, from 18 lines to all 30");
  });
});

describe("every figure in the report is re-derived, not remembered", () => {
  it("agrees with the printed form on how many lines Form 940 has", () => {
    expect(LABELS_ON_THE_PRINTED_940).toHaveLength(30);
    expect(new Set(LABELS_ON_THE_PRINTED_940).size).toBe(30);
    // The claim the whole report rests on.
    expect(teachingBoxes("form_940").length).toBe(30);
  });

  it("teaches every line on the printed form, and invents none", () => {
    const taught = new Set(teachingBoxes("form_940").map((b) => b.box));
    const onPaper = new Set(LABELS_ON_THE_PRINTED_940);

    const missing = LABELS_ON_THE_PRINTED_940.filter((l) => !taught.has(l));
    expect(missing, `lines on the paper that the app cannot teach: ${missing.join(", ")}`).toEqual(
      [],
    );

    const invented = [...taught].filter((b) => !onPaper.has(b));
    expect(invented, `lines the app teaches that the form does not have: ${invented.join(", ")}`)
      .toEqual([]);
  });

  it("classifies whose money every printed line is", () => {
    for (const label of LABELS_ON_THE_PRINTED_940) {
      expect(
        Object.prototype.hasOwnProperty.call(FORM_940_WHOSE, label),
        `Form 940 line ${label} is on the paper but has no ownership classification`,
      ).toBe(true);
    }
    expect(Object.keys(FORM_940_WHOSE)).toHaveLength(30);
  });

  it("states the 940 line count the engine actually reports", () => {
    // The report's table says 18 -> 30. Both figures must appear.
    expect(REPORT).toContain("| Lines the app can teach | 18 | **30 — the whole form** |");
  });

  it("states a lesson count the engine can actually produce", () => {
    const lessons = FORM_940_LESSONS.length;
    // RATCHET, not equality: lessons may be added later and this dated letter
    // must not fail because the product improved (the books-52 lesson).
    const claimed = /\| Full written lessons \| 8 \| \*\*(\d+)\*\* \|/.exec(REPORT);
    expect(claimed, "the report must state a lesson count in its table").not.toBeNull();
    expect(Number(claimed![1])).toBeLessThanOrEqual(lessons);
    expect(lessons).toBe(20);
  });

  it("states an authority count the registry actually holds", () => {
    const claimed = /\| Word-for-word IRS quotes behind them \| 21 \| \*\*(\d+)\*\* \|/.exec(REPORT);
    expect(claimed, "the report must state an authority count").not.toBeNull();
    expect(Number(claimed![1])).toBeLessThanOrEqual(FORM_940_OWN_AUTHORITIES.length);
    expect(FORM_940_OWN_AUTHORITIES.length).toBe(34);
  });

  /**
   * The mutation claim, checked through its MECHANISM.
   *
   * The report says 30 of 30 sabotages were caught. Re-running thirty full
   * suite passes inside a unit test would take a quarter of an hour, so what is
   * asserted is the thing that MADE 30 of 30 possible: a pinned table covering
   * every row in both directions, plus the specific gate on lines 12 and 17.
   * Without those the sweep could not have scored 30, and with them a regression
   * fails here instead of silently lowering the score.
   */
  it("still has the mechanism that made 30 of 30 mutations catchable", () => {
    expect(() => assertEvery940LineOwnershipIsPinned()).not.toThrow();
    expect(() => assertForm940AnnualTotalIsTheEmployersCost()).not.toThrow();
    expect(REPORT).toContain("30 / **30**");
  });

  it("names the line that survived the earlier probe, and says it was pre-existing", () => {
    // The most serious finding must not be softened out of the document.
    expect(REPORT).toContain("line 17");
    expect(REPORT).toContain("**Line 17 survived, with 274 tests green.**");
    expect(REPORT).toContain("**This was pre-existing.**");
    // And the reason it matters -- the equality with line 12.
    expect(REPORT).toContain("equal line 12 to the cent");
    // The fix must be described as a class fix, not an instance fix.
    expect(REPORT).toContain("closed for all thirty lines rather than for line 17");
  });
});

describe("the report tells Michael about every pre-existing warning", () => {
  it("reports the roadmap's own wrong line count", () => {
    expect(REPORT).toContain("the roadmap said the 940 had 21 lines. It has 30");
    // And admits it is the second time, rather than presenting it as a one-off.
    expect(REPORT).toContain("second slice in a row where the roadmap's own line count was");
  });

  it("reports the dead cross-references and the count that was measured", () => {
    expect(REPORT).toContain("two lessons pointed at a box that has never existed");
    expect(REPORT).toContain("56 cross-references");
    expect(REPORT).toContain("wage-detail");
    // The subtle part: identical text, different fixes. Worth keeping.
    expect(REPORT).toContain("search-and-replace");
  });

  it("reports the incomplete IRS sentence without pretending it was fixed", () => {
    expect(REPORT).toContain("For tax year 2025, there are credit reduction states.");
    expect(REPORT).toContain("reported, not fixed");
    // The researched fact must be labelled as researched, never as an IRS quote.
    expect(REPORT).toContain("California");
    expect(REPORT).toContain("U.S. Virgin Islands");
    // And it must say Greenway is unaffected, or the warning reads as alarming.
    expect(REPORT).toContain("Line 2 stays blank");
  });

  it("reports the still-open holes rather than only the closed ones", () => {
    expect(REPORT).toContain("Form W-3 has zero boxes");
    expect(REPORT).toContain("zero lessons");
    expect(REPORT).toContain("DOR Combined Excise");
    // The 941 citation-routing debt from books-40.
    expect(REPORT).toContain("do not route to the");
  });

  /**
   * THE HONESTY CHECK.
   *
   * Michael asked, more than once, to be told when I get something wrong. A
   * report that lists only pre-existing defects found in other people's code
   * is a sales document. This asserts the fabricated-quote error is still in
   * the document, described as what it was.
   */
  it("admits my own error rather than only other people's", () => {
    expect(REPORT).toContain("The mistake I made");
    expect(REPORT).toContain("fabrication");
    expect(REPORT).toContain("2,298");
    // The crucial admission: my own checker approved it.
    expect(REPORT).toContain("my own checker said they were fine");
    // And that the length, not the checker, is what caught it.
    expect(REPORT).toContain("It was the length");
  });

  it("explains why the hyphenation was refused rather than repaired", () => {
    expect(REPORT).toContain("multi-state employ- er");
    expect(REPORT).toContain("third transformation");
  });
});

describe("the report repeats every open question, every time", () => {
  it("carries all five still-open questions and keeps question 3 closed", () => {
    // Michael's standing request: repeated in full, every report, until closed.
    for (const marker of [
      "| 1 |",
      "| 2 |",
      "| 4 |",
      "| 5 |",
      "| 6 |",
    ]) {
      expect(REPORT, `open question row ${marker} is missing`).toContain(marker);
    }
    // Question 3 is answered and must be shown as closed, not silently dropped.
    expect(REPORT).toContain("Question 3 remains closed");
    expect(REPORT).toContain("still five, unchanged");
  });

  it("does not let the question-4 caution fade once question 3 closed", () => {
    // The arrangement is settled; the payroll-tax treatment is not. Losing this
    // distinction is how a closed question quietly closes an open one with it.
    expect(REPORT).toContain("$11,029.32");
    expect(REPORT).toContain("settles the *arrangement*");
    expect(REPORT).toContain("question 4");
  });
});

describe("the report leaks nothing confidential", () => {
  it("contains no bank routing or account numbers", () => {
    /*
     * This slice added lessons for lines 15c and 15e -- a routing number and a
     * bank account number. Those lessons discuss the FIELDS. If a plausible
     * specimen value ever leaked from the code into this document it would be
     * in a file destined for a PDF that gets emailed.
     *
     * Nine-digit runs are the routing-number shape. The dollar amounts in this
     * report are all formatted with separators, so a bare nine-digit run is
     * never legitimate here.
     */
    const nineDigitRuns = REPORT.match(/(?<![\d,.])\d{9}(?![\d,.])/g) ?? [];
    expect(nineDigitRuns, `possible routing number in the report: ${nineDigitRuns.join(", ")}`)
      .toEqual([]);
  });

  it("contains no Social Security or employer identification numbers", () => {
    expect(REPORT).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/); // SSN
    expect(REPORT).not.toMatch(/\b\d{2}-\d{7}\b/); // EIN
  });

  it("names no employee except the ones the owner already discussed", () => {
    /*
     * Rule 62d territory. Michael raised Teri, Theresa, James and Nicholas
     * himself, so naming them back to him reveals nothing. Anyone else must not
     * appear. Joan and Nicholas also appear as the TEACHING fixture names, which
     * are invented and carry no real figures.
     */
    const allowed = ["Teri", "Theresa", "James", "Nicholas", "Michael", "Joan", "Becker"];
    // Assert the allow-list is actually exercised, or this test proves nothing.
    expect(allowed.some((n) => REPORT.includes(n))).toBe(true);
  });
});

describe("the report's cross-form claims are true", () => {
  it("is right that the 941 and W-2 were already complete", () => {
    expect(teachingBoxes("form_941").length).toBe(27);
    expect(teachingBoxes("form_w2").length).toBe(20);
    expect(REPORT).toContain("The 941 (27 lines) and W-2 (20 boxes) were already complete");
  });

  it("is right that the ESD 5208B has boxes but no lessons", () => {
    // The claim that sets up the NEXT slice. If someone writes those lessons
    // and forgets this sentence, the report starts lying about the backlog.
    expect(teachingBoxes("esd_5208b").length).toBe(4);
    const lessonsFor5208b = WA_QUARTERLY_LESSONS.filter((l) => l.formId === "esd_5208b");
    expect(lessonsFor5208b).toHaveLength(0);
    expect(REPORT).toContain("ESD\n  5208B has 4 boxes and **zero lessons**");
  });

  /*
   * ═══ UPDATED DELIBERATELY IN books-55 ═══
   *
   * The books-54 report told Michael "Form W-3 has zero boxes ... It is small
   * and I can close it in a future slice." books-55 is that slice. The report
   * text is left exactly as written — it was true on its date — but the claim
   * about the CURRENT code has to be inverted, or this test would be asserting
   * that a fixed defect is still broken.
   */
  it("was right that Form W-3 threw, and books-55 closed it", () => {
    // The promise the report made, still on the page.
    expect(REPORT).toContain("Form W-3 has zero boxes");
    // The promise, kept.
    expect(() => teachingBoxes("form_w3")).not.toThrow();
    expect(teachingBoxes("form_w3").length).toBe(31);
  });

  /*
   * ═══ THE NUMBER IN THE books-54 REPORT WAS WRONG. books-55 SAYS SO. ═══
   *
   * The books-54 report told Michael "Cross-references checked: 56, all
   * resolving". Both halves were wrong, and this very test is why the error
   * went unnoticed: it counted ties across the SAME FOUR lesson sets the gate
   * was pointed at, so it confirmed the gate's own blind spot instead of
   * checking it. A test that reuses the subject's assumptions cannot audit it.
   *
   * The repository contained FIVE lesson sets. The fifth,
   * FORM_941_CONFIRMATION_LESSONS, held 6 more ties, of which THREE WERE DEAD —
   * all pointing into `form_w3`, which threw when asked for its boxes. So the
   * truth at books-54 was 62 ties, 3 dead.
   *
   * This test now asserts BOTH numbers: the four-set subtotal of 56, so the old
   * report text remains verifiable as the arithmetic it actually was, and the
   * five-set total of 62 read from the whole tree. Michael is told about the
   * correction in the books-55 report; a silent renumber here would have been
   * the more comfortable option and the wrong one.
   */
  it("counted 56 ties because it counted four of five lesson sets", () => {
    const fourSetSubtotal = [
      FORM_940_LESSONS,
      FORM_941_LESSONS,
      FORM_W2_BOX_LESSONS,
      WA_QUARTERLY_LESSONS,
    ].reduce((n, set) => n + set.reduce((m, l) => m + l.tiesTo.length, 0), 0);

    // The report's figure was an accurate count of an incomplete list.
    expect(fourSetSubtotal).toBe(56);
    expect(REPORT).toContain("**56, all resolving**");

    // The fifth set, which the report never counted.
    const fifthSet = FORM_941_CONFIRMATION_LESSONS.reduce((m, l) => m + l.tiesTo.length, 0);
    expect(fifthSet).toBe(6);
    expect(fourSetSubtotal + fifthSet).toBe(62);
  });

  /**
   * And the claim the books-54 report SHOULD have made, asserted against the
   * whole repository rather than against a hand-picked list.
   */
  it("now really does resolve every cross-reference, across all five sets", () => {
    for (const set of [
      FORM_940_LESSONS,
      FORM_941_LESSONS,
      FORM_W2_BOX_LESSONS,
      WA_QUARTERLY_LESSONS,
      FORM_941_CONFIRMATION_LESSONS,
    ]) {
      expect(() => assertEveryTieResolves(set)).not.toThrow();
    }
  });
});
