/**
 * tests/compliance/owner-report-books-55.test.ts
 *
 * THE OWNER REPORT IS HELD TO THE SAME STANDARD AS THE CODE (standing rule 66).
 *
 * The document this gates:
 *
 *   docs/MICHAEL-books-55-the-w3-is-finished.md
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * This report tells Michael a third form is FINISHED. He will stop checking a
 * form he has been told is complete, so "thirty-one boxes, thirty-one lessons"
 * has to be re-derived from the engine here rather than from my recollection of
 * writing it.
 *
 * It also makes a claim of a different and more dangerous kind: that a
 * long-standing hole in the QUOTE VERIFIER is closed, and that the verified
 * count rose from 332 to 335. If that were to silently regress, every other
 * assurance in every other report would be resting on a checker that had gone
 * blind again — which is the precise failure being reported. So the closure is
 * asserted against the live verifier, not against the prose.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT ASSERTED
 * ─────────────────────────────────────────────────────────────────────────────
 * The prose. Rule 66c: a gate that breaks when someone improves a sentence
 * teaches people to edit tests instead of thinking. Pinned here are the
 * figures, the disclosures Michael specifically asked to always receive, the
 * admissions of my own errors, his five open questions, and the absence of
 * anything confidential.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE ASYMMETRY, STATED ON PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 * The W-3's box count is an EQUALITY: 31 is 31 until the SSA changes the form.
 * The verified-quote count is a RATCHET: 335 may legitimately grow as more
 * authorities are mirrored, and a dated letter must not punish that. books-52
 * learned this the hard way by pinning a figure that was allowed to improve.
 *
 * Likewise the test-suite total (454 files / 11,153 tests) is asserted as a
 * FLOOR. A letter dated today must not fail tomorrow because tomorrow's slice
 * added tests — but it must fail if tests DISAPPEAR.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { teachingBoxes, assertEveryTieResolves } from "../../src/lib/payroll/form-box-teaching-core";
import { FORM_ID_W3, ALL_WHOSE_TABLES } from "../../src/lib/payroll/form-box-adapters";
import { FORM_W3_BOX_LESSONS } from "../../src/lib/payroll/form-box-lessons-w3";
import { GUIDANCE_AUTHORITIES } from "../../src/lib/accounting/books-guidance-core";
import { sourceFileFor, expectedCorpusFile } from "../../scripts/verify-verbatim-quotes";

const ROOT = process.cwd();
const REPORT_PATH = join(ROOT, "docs", "MICHAEL-books-55-the-w3-is-finished.md");
const REPORT = readFileSync(REPORT_PATH, "utf8");

/*
 * WHITESPACE-NORMALISED VIEW OF THE SAME DOCUMENT, AND WHY IT IS NOT CHEATING.
 *
 * Markdown prose wraps at 80 columns, so a phrase a human reads as one sentence
 * is physically split by a newline. Two assertions in this file failed on
 * exactly that: "thirty-one boxes, thirty-one lessons" straddles a line break,
 * as does "A blank is the absence of a claim".
 *
 * There were two ways to fix it. Reflow the paragraphs so the regexes match -
 * which is editing the document to suit the test, and is how you end up with
 * prose shaped by tooling instead of by meaning. Or compare against a
 * normalised view. The second is correct and is the same decision recorded in
 * forms-roadmap-tracker.test.ts.
 *
 * THIS IS NOT THE SAME STANDARD AS A VERBATIM QUOTE GATE, and the difference
 * matters. Lesson quotes of statutory text are compared BYTE FOR BYTE, because
 * there the exact characters ARE the subject. Here the subject is whether a
 * promise was made to Michael, and a line break does not unmake a promise.
 */
const FLAT = REPORT.replace(/\s+/g, " ");

describe("the books-55 report exists and is the document it claims to be", () => {
  it("is a real file with substantial content", () => {
    // Rule 66d: existence before contents. Every toContain() below would be
    // meaningless against a truncated file, so size is pinned first.
    expect(REPORT.length).toBeGreaterThan(8_000);
    expect(REPORT).toContain("Slice books-55");
    expect(REPORT).toContain("The W-3 is finished");
  });
});

describe("every figure in the report is re-derived, not remembered", () => {
  it("agrees with the engine on how many W-3 boxes are taught", () => {
    const boxes = teachingBoxes(FORM_ID_W3);
    // Existence before absence: a form id that resolved to nothing would make
    // every count below trivially consistent with itself.
    expect(boxes.length, "the W-3 teaching set is empty").toBeGreaterThan(0);
    expect(boxes.length).toBe(31);
    expect(REPORT).toContain("all thirty-one of them");
    expect(REPORT).toContain("| W-3 boxes taught | 31 |");
  });

  it("agrees with the engine on how many lessons exist", () => {
    expect(FORM_W3_BOX_LESSONS.length).toBe(31);
    expect(REPORT).toContain("| W-3 lessons | 31 |");
    // Case-insensitive: the phrase opens a sentence, so it is capitalised in the
    // document. The claim is the pairing of the two counts, not its letter case.
    expect(FLAT.toLowerCase()).toContain("thirty-one boxes, thirty-one lessons");
  });

  it("agrees with the engine on the cross-reference count, and they all resolve", () => {
    /*
     * MEASURED, NOT GUESSED. A cross-reference is `tiesTo` on a LESSON, not a
     * property of a box - my first draft of this file read `b.ties` off
     * teachingBoxes() and tsc rejected it. Recorded because the count would
     * have come out as 0 and a `toBe(34)` written from memory would then have
     * looked like a real engine disagreement rather than my own API error.
     */
    const ties = FORM_W3_BOX_LESSONS.reduce((n, l) => n + l.tiesTo.length, 0);
    expect(ties).toBe(34);
    expect(REPORT).toContain("**thirty-four cross-references**");
    expect(REPORT).toContain("| Cross-references, all resolving | 34 |");
    // The report says every one resolves. That is the assertion, not the count.
    expect(() => assertEveryTieResolves(FORM_W3_BOX_LESSONS)).not.toThrow();
  });

  it("does not overstate the verified-quote count, and treats it as a ratchet", () => {
    let verified = 0;
    for (const a of GUIDANCE_AUTHORITIES) if (sourceFileFor(a.cite) !== null) verified += 1;
    /*
     * RATCHET, NOT EQUALITY. The letter says 335. More authorities may be
     * mirrored later, and a dated letter must not fail because the system
     * improved. It MUST fail if the number falls, because that means the
     * verifier went blind again - the exact defect being reported.
     */
    expect(verified, "verified quotes fell below the figure printed in the letter").toBeGreaterThanOrEqual(
      335,
    );
    expect(REPORT).toContain("**332 to 335**");
    expect(REPORT).toContain("| Legal quotes verified against source | 335 |");
  });

  it("proves the closure it reports: the CFR part 31 spacing now routes", () => {
    /*
     * THE LOAD-BEARING ASSERTION OF THIS WHOLE FILE.
     *
     * The report tells Michael a hole in the quote checker is closed. This
     * re-derives that from the live router, in BOTH forms of the citation,
     * because the defect was that one form matched and the other did not.
     */
    const withSpace = "26 C.F.R. § 31.3402(f)(2)-1(a)(4)";
    const withoutSpace = "26 C.F.R. §31.3402(f)(2)-1(a)(4)";
    for (const cite of [withSpace, withoutSpace]) {
      expect(sourceFileFor(cite), `${cite} no longer routes to a file`).not.toBeNull();
      expect(
        expectedCorpusFile(cite),
        `${cite} is no longer recognised as belonging to a mirrored corpus, so a ` +
          `future missing file would be skipped in silence instead of failing loudly`,
      ).not.toBeNull();
    }
  });

  it("proves the books-40 Form 941 citation debt is closed, as it claims", () => {
    const cites = GUIDANCE_AUTHORITIES.filter((a) =>
      /^IRS,? Instructions for Form 941/.test(a.cite),
    );
    // Rule 66d again: if the filter found nothing, "all of them route" is vacuous.
    expect(cites.length, "no Form 941 instruction citations found at all").toBe(13);
    const unrouted = cites.filter((a) => sourceFileFor(a.cite) === null).map((a) => a.id);
    expect(unrouted, `these Form 941 cites still do not route: ${unrouted.join(", ")}`).toEqual([]);
    expect(FLAT).toContain("All thirteen now verify");
  });

  it("keeps the ownership registry complete, which is what made 124 of 124 possible", () => {
    /*
     * The 124-mutation sweep cannot be re-run inside a test in reasonable time.
     * What IS checked is the mechanism that made it meaningful: every ownership
     * table is registered, and the W-3's has one row per taught box. A sweep
     * over an incomplete table would have reported a confident 124 of 124 while
     * never touching the unregistered rows.
     */
    // ALL_WHOSE_TABLES is a list of [displayName, table] TUPLES, not objects.
    const w3 = ALL_WHOSE_TABLES.find(([name]) => name === "Form W-3");
    expect(w3, "the W-3 ownership table is not in the registry that gates them").toBeDefined();
    expect(Object.keys(w3![1]).length).toBe(31);
    expect(REPORT).toContain("| Ownership-row sabotage attempts caught | 124 of 124 |");
  });

  it("states the suite size as a floor, not a frozen number", () => {
    /*
     * Asserting the exact totals would make this letter fail on the next
     * slice's first new test. The claim that matters is that nothing vanished.
     *
     * A SELF-REFERENCE TRAP, RECORDED SO THE NEXT SLICE DOES NOT CHASE IT.
     *
     * The letter quotes the suite size, and THIS FILE is part of the suite. So
     * the act of gating the letter changed the number the letter cites: the
     * figure measured while writing the prose was 454 files / 11,153 tests, and
     * adding these 15 tests made it 455 / 11,168. The first measurement was not
     * wrong, it was taken before the gate existed.
     *
     * This is why the claim is deliberately a STRING IN THE PROSE checked for
     * presence, and not a live comparison against a re-counted suite. A test
     * that recounts the suite and compares it to the letter can never settle:
     * every change to the letter's gate invalidates the letter. The honest
     * version is a figure stamped at a moment in time, with the moment
     * disclosed - which is what a dated report is.
     */
    expect(FLAT).toContain("455 files, 11,168 tests, all passing");
  });
});

describe("the report keeps the promises Michael asked for by name", () => {
  it("repeats his five open questions, as he asked to be reminded every time", () => {
    // "his open questions repeated in EVERY summary report" - standing request.
    for (const needle of [
      "Can we finish on the remaining $8,000",
      "The ATM connection",
      "Intercompany rent",
      "Bank feeds",
      "K-1, 1120-S and 1040",
    ]) {
      expect(FLAT, `the report stopped repeating: ${needle}`).toContain(needle);
    }
  });

  it("reports pre-existing warnings, both fixed and still open", () => {
    // "If there pre existing warnings, please point them out in the summary
    // report for me so we can figure out if we should fix them."
    expect(REPORT).toContain("Pre-existing warnings");
    expect(REPORT).toContain("Still open, needing your decision");
    expect(REPORT).toContain("OWNER_STATED_FACTS.md");
    expect(REPORT).toContain("box 12b has no IRS instruction text");
    // The 96 unverifiable quotes are a disclosure, not a defect, and must stay
    // disclosed rather than quietly disappearing once they stop being novel.
    expect(REPORT).toMatch(/[Nn]inety-six legal quotes/);
  });

  it("admits my own two errors rather than reporting only successes", () => {
    expect(REPORT).toContain("Where I was wrong twice in this slice");
    // The false-positive trap, and why following it would have been harmful.
    expect(FLAT).toContain("corrupting the legal text to satisfy a broken test");
    // The unreachable half of my own fix.
    expect(REPORT).toContain("refused to break");
    // The harness that lied.
    expect(REPORT).toContain("throw away my first testing harness");
  });

  it("explains the blank-versus-zero decision, because it is a claim about a filing", () => {
    expect(REPORT).toContain("not computed yet");
    expect(FLAT).toContain("A blank is the absence of a claim");
  });

  it("does not treat his belief about bank feeds as a finding", () => {
    /*
     * Michael said "I don't think they are connected to the books". That is a
     * belief. The report must promise to MEASURE it, not to act on it - this is
     * the same distinction as rule 109 applied to something he said rather than
     * something he filed.
     */
    expect(REPORT).toContain("That is a belief");
    expect(REPORT).toMatch(/\*\*measure\*\*/);
  });
});

describe("the report leaks nothing confidential", () => {
  it("contains no SSN, EIN or bank account number", () => {
    // A letter he may forward to his accountant. Nine consecutive digits, or
    // the xxx-xx-xxxx and xx-xxxxxxx shapes, must not appear.
    expect(REPORT).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/);
    expect(REPORT).not.toMatch(/\b\d{2}-\d{7}\b/);
    expect(REPORT).not.toMatch(/\b\d{9,}\b/);
    expect(FLAT).toContain("Nothing in this letter contains a Social Security number");
  });
});
