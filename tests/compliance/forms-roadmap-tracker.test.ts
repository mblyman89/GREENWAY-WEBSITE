/**
 * tests/compliance/forms-roadmap-tracker.test.ts   (books-55)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FORMS ROADMAP IS A MEASUREMENT, SO IT IS CHECKED LIKE ONE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS, AND IT IS NOT A TIDINESS EXERCISE.
 *
 * `docs/ROADMAP-forms-and-lessons.md` exists because Michael asked for it in
 * those words: *"Please make sure we track that roadmap so we don't drift."*
 * It is the document that is supposed to prevent drift.
 *
 * Measured in books-55: `grep -rln ROADMAP-forms-and-lessons tests/` returned
 * NOTHING. No test in the repository had ever read it. So the one artefact
 * whose entire job is to stop drift was itself the least protected file in the
 * project, and it drifted:
 *
 *   - it stated "Measured: 56 ties, 2 dead". The true figure when that
 *     sentence was written was 62 ties, because the count covered four lesson
 *     sets while six existed. The wrong number was then repeated to Michael in
 *     the books-54 owner report as a finding.
 *   - it stated the line counts of two modules wrongly, twice, in earlier
 *     slices.
 *
 * This is standing rule 39 at document level: a verifier that cannot see
 * something approves it, and nothing could see this file at all.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IS AND IS NOT ASSERTED
 * ─────────────────────────────────────────────────────────────────────────
 *
 * NOT asserted: the prose, the strategy, the ordering, or the opinions. Those
 * are judgement and belong to Michael.
 *
 * Asserted: every NUMBER the document states about the code, where that number
 * is something the code can be asked. A quantity in a tracker is a claim, and
 * a claim nothing checks is how "56" survived long enough to be reported as a
 * fact.
 *
 * The counts are DERIVED from the modules, never copied from the document, so
 * the only way to make this suite pass is to correct the document.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { FORM_941_LESSONS } from "@/lib/payroll/form-box-lessons-941";
import { FORM_940_LESSONS } from "@/lib/payroll/form-box-lessons-940";
import { WA_QUARTERLY_LESSONS } from "@/lib/payroll/form-box-lessons-wa";
import { FORM_W2_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-w2";
import { FORM_W3_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-w3";
import { FORM_941_CONFIRMATION_LESSONS } from "@/lib/payroll/form-941-confirmation-lessons";
import { type BoxLesson } from "@/lib/payroll/form-box-core";

const ROOT = process.cwd();
const DOC_REL = join("docs", "ROADMAP-forms-and-lessons.md");
const DOC_PATH = join(ROOT, DOC_REL);

/**
 * Every lesson set in the repository, paired with the FILE NAME the roadmap
 * table prints for it.
 *
 * Held as data so the table below is checked row by row rather than as one
 * total. A single total can be right while two rows are wrong in opposite
 * directions — which is precisely the kind of cancellation that makes a
 * reported figure feel verified when it is not.
 */
const LESSON_SETS: readonly (readonly [string, readonly BoxLesson[]])[] = [
  ["form-box-lessons-941.ts", FORM_941_LESSONS],
  ["form-box-lessons-940.ts", FORM_940_LESSONS],
  ["form-box-lessons-wa.ts", WA_QUARTERLY_LESSONS],
  ["form-box-lessons-w2.ts", FORM_W2_BOX_LESSONS],
  ["form-box-lessons-w3.ts", FORM_W3_BOX_LESSONS],
  ["form-941-confirmation-lessons.ts", FORM_941_CONFIRMATION_LESSONS],
];

const doc = existsSync(DOC_PATH) ? readFileSync(DOC_PATH, "utf8") : "";

function tieCount(set: readonly BoxLesson[]): number {
  return set.reduce((n, l) => n + l.tiesTo.length, 0);
}

describe("books-55: the forms roadmap states true numbers", () => {
  it("exists and is the document it claims to be", () => {
    expect(existsSync(DOC_PATH), `${DOC_REL} is missing`).toBe(true);
    expect(doc).toContain("The forms and lessons roadmap");
    // Rule 66d: a zero-length read would make every assertion below vacuous.
    expect(doc.length).toBeGreaterThan(5_000);
  });

  /**
   * THE PER-SET TABLE, ROW BY ROW.
   *
   * The regex is anchored on the markdown table shape the document actually
   * uses, and the row for each set is REQUIRED to be present. A missing row is
   * a failure, not a skip — otherwise deleting a row from the table would be
   * the easiest way to make this gate quiet, which inverts its purpose.
   */
  it("prints the true lesson and tie count for every lesson set", () => {
    for (const [fileName, set] of LESSON_SETS) {
      const escaped = fileName.replace(/[.]/g, "\\.");
      const row = new RegExp("\\|\\s*`" + escaped + "`\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|");
      const m = doc.match(row);
      expect(
        m,
        `${DOC_REL} has no table row for ${fileName}. Every lesson set must appear, or the ` +
          `total below is a sum over an unstated population — which is exactly how "56 ties" ` +
          `was reported to Michael as a measurement.`,
      ).not.toBeNull();
      const printedLessons = Number(m![1]);
      const printedTies = Number(m![2]);
      expect(printedLessons, `${fileName}: roadmap says ${printedLessons} lessons`).toBe(set.length);
      expect(printedTies, `${fileName}: roadmap says ${printedTies} ties`).toBe(tieCount(set));
    }
  });

  it("prints a total that is the sum of its own rows and of the real modules", () => {
    const lessons = LESSON_SETS.reduce((n, [, s]) => n + s.length, 0);
    const ties = LESSON_SETS.reduce((n, [, s]) => n + tieCount(s), 0);
    const m = doc.match(/\|\s*\*\*total\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|/);
    expect(m, `${DOC_REL} prints no total row`).not.toBeNull();
    expect(Number(m![1]), "roadmap total lessons").toBe(lessons);
    expect(Number(m![2]), "roadmap total ties").toBe(ties);
  });

  /**
   * THE CORRECTION MUST STAY ON THE RECORD.
   *
   * The wrong figure was reported to Michael. Fixing the number and deleting
   * the evidence that it was ever wrong would leave him holding a report that
   * disagrees with the repository and no way to tell which is right. Standing
   * practice in this project is that a correction is published, not
   * overwritten — so the gate requires the disclosure to survive, and requires
   * it to name BOTH the wrong figure and the true one.
   */
  it("keeps the books-54 mis-statement disclosed rather than quietly fixed", () => {
    expect(
      doc,
      "the correction paragraph naming the books-54 error has been removed. The wrong " +
        "figure was reported to Michael; the retraction has to outlive the fix.",
    ).toContain("Correction issued in books-55");
    /*
     * Whitespace is NORMALISED before matching, and that is a deliberate
     * decision rather than a convenience.
     *
     * This gate failed on its first run against a correct document, because
     * the sentence "the true figure at the time was 62" is wrapped across two
     * lines at 80 columns and a single-line pattern cannot see it. The wrong
     * fix would have been to reflow the prose to suit the regex — i.e. to let
     * a test dictate the shape of a document written for a person to read.
     *
     * Note the contrast with the VERBATIM quote gates, which compare byte for
     * byte and must never normalise: there, the exact bytes are the thing
     * being asserted, because they are the IRS's words. Here the assertion is
     * that a disclosure is present, and a line break is not a change in
     * meaning. Same repository, opposite rules, for a reason.
     */
    const flat = doc.replace(/\s+/g, " ");
    expect(
      flat,
      "the retraction no longer quotes the figure that was wrong, so a reader cannot tell " +
        "which number they were given",
    ).toContain("56 ties, 2 dead");
    expect(flat, "the correction must state the figure that was actually true").toContain(
      "the true figure at the time was 62",
    );
  });

  /**
   * NO STALE MODULE LINE COUNT.
   *
   * The document has stated a module's line count wrongly twice. Any line
   * count it prints in the form "`path/file.ts` (NNN lines)" is now checked
   * against the file. Discovered, not declared, for the same reason the
   * BOOKS_ROADMAP test-count gate is discovered: a hand-listed set of the
   * known claims leaves tomorrow's claim unguarded.
   */
  it("prints the true line count for every file it measures", () => {
    const claims = [...doc.matchAll(/`(src\/[A-Za-z0-9/_.-]+\.ts)`\s*\((\d+)\s*lines\)/g)];
    let checked = 0;
    for (const [, rel, printed] of claims) {
      const abs = join(ROOT, rel);
      expect(existsSync(abs), `${DOC_REL} names ${rel}, which does not exist`).toBe(true);
      const actual = readFileSync(abs, "utf8").split("\n").length;
      // A trailing newline makes "lines" ambiguous by one; allow only that.
      expect(
        Math.abs(actual - Number(printed)),
        `${DOC_REL} says ${rel} is ${printed} lines; it is ${actual}. This document has ` +
          `printed a wrong line count twice before.`,
      ).toBeLessThanOrEqual(1);
      checked += 1;
    }
    // Not a floor of >0: the document is allowed to stop quoting line counts,
    // and pretending otherwise would force a fake claim to keep a gate happy
    // (rule 62d). Recorded so a future reader knows the zero case is intended.
    expect(checked).toBe(claims.length);
  });
});
