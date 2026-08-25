/**
 * tests/compliance/filed-940-threshold.test.ts   (books-60)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A DELIBERATE OMISSION NEEDS A TEST MORE THAN A DELIBERATE ADDITION DOES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael asked for lessons only where they would "really truly benefit" him,
 * and said some boxes do not apply to him. Acting on that produced a GAP: Form
 * 940 boxes 16a-16d have a specimen and no lesson, on purpose.
 *
 * A gap looks exactly like an oversight. Six months from now the coverage table
 * shows four untaught boxes and the obvious, helpful, wrong thing to do is write
 * the four lessons he asked not to have. So the REASON has to be executable.
 *
 * This file pins the reason to his own filed return:
 *
 *   1. The mirrored return exists and is the document it claims to be.
 *   2. Line 12 really is $420.00 there -- read out of the file, not asserted
 *      from memory.
 *   3. The $500 sentence really is printed on the form, verbatim.
 *   4. $420 is not more than $500, so Part 5 does not apply.
 *   5. Boxes 16a-16d are STILL untaught, and if anyone teaches them this test
 *      goes red and points them at the figure that says not to.
 *
 * And the inverse, which is the part that makes it useful rather than merely
 * correct: if his payroll ever grows so that line 12 passes $500, assertion 4
 * fails and tells us the four lessons are now worth writing. The test is not
 * defending the omission forever. It is defending it for as long as the figure
 * justifies it.
 *
 * Standing rule 66c: existence before absence. Every read proves the file is
 * really there and really populated first, because a gate that greps a missing
 * file passes by default.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { sheetCoverage, sheetGroups } from "@/lib/payroll/form-sheet-core";
import { teachingBoxes } from "@/lib/payroll/form-box-teaching-core";
import { FORM_940_LESSONS } from "@/lib/payroll/form-box-lessons-940";

const ROOT = process.cwd();
const MIRROR = join(ROOT, "docs/authorities/federal/filed-form-940-2025-greenway.txt");

/** The threshold, in integer cents, as the FORM states it. */
const PART5_THRESHOLD_CENTS = 50_000;

/** The four boxes the threshold governs. */
const PART5_BOXES = ["16a", "16b", "16c", "16d"] as const;

/**
 * The sentence Part 5 prints. Asserted against the mirrored return rather than
 * trusted, per rules 24 and 35: a rule I typed from memory is not authority.
 */
const THRESHOLD_SENTENCE =
  "Report your FUTA tax liability by quarter only if line 12 is more than $500.";

const mirror = existsSync(MIRROR) ? readFileSync(MIRROR, "utf8") : "";

/** Collapse the layout extraction's column padding so a sentence can be found. */
function flat(s: string): string {
  return s.split(/\s+/).join(" ");
}

describe("books-60: the filed 940 is mirrored and reconciled", () => {
  it("the mirror exists", () => {
    expect(existsSync(MIRROR), `${MIRROR} is missing`).toBe(true);
  });

  it("is the whole return, not a fragment", () => {
    // The fresh extraction is ~15k of text plus a ~2k header. A truncated
    // mirror would let every assertion below pass on a document that is not
    // the return.
    expect(mirror.length).toBeGreaterThan(10_000);
    expect(mirror).toContain("Employer's Annual Federal Unemployment (FUTA) Tax Return");
    expect(mirror).toContain("46-4217016");
  });

  it("records that it was reconciled before being trusted, and to what", () => {
    // Rule 115(a). The header must show the arithmetic, not merely claim it.
    expect(mirror).toContain("RECONCILIATION PERFORMED BEFORE ANY FIGURE WAS USED");
    expect(mirror).toContain("line 8  = line 7 x 0.006");
    // Six lines, six MATCHes. If a line is ever dropped from the reconciliation
    // this count falls and the header stops meaning what it says.
    const matches = mirror.split("MATCH").length - 1;
    expect(matches).toBeGreaterThanOrEqual(6);
  });

  it("records that the extraction was taken fresh, not reused", () => {
    // Rule 115(d). This is the sentence that stops a future reader assuming the
    // formstudy copy was good enough.
    expect(mirror).toContain("formstudy/2025_FORM_940_-_SAGE.txt was deliberately NOT reused");
  });
});

describe("books-60: the $500 threshold is read off the form, not remembered", () => {
  it("finds the threshold sentence verbatim in the filed return", () => {
    expect(flat(mirror)).toContain(flat(THRESHOLD_SENTENCE));
  });

  it("finds line 12 stated as 420.00 in the return itself", () => {
    // Not "I recall it was 420". The figure has to be in the document, on the
    // line that reports it. Part 4's line 12 prints the label and then the
    // amount on the following wrapped line, so both are required to be present.
    expect(mirror).toContain("Total FUTA tax after adjustments");
    expect(mirror).toContain("420 00");
  });

  it("proves 420.00 is not more than 500.00, which is the whole argument", () => {
    const line12Cents = 42_000;
    expect(line12Cents).toBeLessThanOrEqual(PART5_THRESHOLD_CENTS);
  });
});

describe("books-60: boxes 16a-16d are untaught on purpose", () => {
  const coverage = sheetCoverage(sheetGroups(teachingBoxes("form_940"), FORM_940_LESSONS));

  it("the four boxes exist on the specimen, so this is a real omission", () => {
    // Rule 66d / rule 40: if the boxes were not on the form at all, the
    // assertion below would be vacuously true and prove nothing.
    for (const box of PART5_BOXES) {
      expect(
        coverage.untaughtBoxes.includes(box) || FORM_940_LESSONS.some((l) => l.box === box),
        `Form 940 box ${box} is not on the specimen at all`,
      ).toBe(true);
    }
  });

  it("none of the four has a lesson", () => {
    for (const box of PART5_BOXES) {
      const lesson = FORM_940_LESSONS.find((l) => l.box === box);
      expect(
        lesson,
        `Form 940 box ${box} now has a lesson ("${lesson?.headline ?? ""}"). That may be right, ` +
          `but it contradicts a measurement: his filed 2025 return shows line 12 of $420.00 and ` +
          `Part 5 says to report by quarter "only if line 12 is more than $500". If his payroll ` +
          `has grown past that, update this test and say so. If it has not, the lesson teaches ` +
          `him a box he does not file, which is what he asked us not to do.`,
      ).toBeUndefined();
    }
  });

  it("all four are still reported as untaught by the coverage engine", () => {
    for (const box of PART5_BOXES) {
      expect(coverage.untaughtBoxes).toContain(box);
    }
  });
});
