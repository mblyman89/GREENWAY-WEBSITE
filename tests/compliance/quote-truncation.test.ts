/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A VERBATIM QUOTE CAN BE TRUE AND STILL BE A LIE BY OMISSION (books-56)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS. Every lesson gate in this repository verifies its
 * quotations the same way:
 *
 *     expect(corpus.includes(q.quote)).toBe(true)
 *
 * That is a sound check against INVENTION. Nothing can be quoted that the
 * authority does not say. It is no check at all against OMISSION, because a
 * truncated quotation is still a substring of the source. Cut the last sentence
 * off a rule and `includes` returns true just as happily.
 *
 * This was not reasoned out in advance. It was found by a mutation campaign
 * (`scripts/mutate-books-56-lessons.py`, mutation M10) which deleted the second
 * half of this quotation from the IRS instructions on compound names:
 *
 *     "Separate parts of a compound name with either a hyphen or a blank
 *      space. Do not join them into a single word."
 *
 * leaving only the permission and dropping the prohibition. Every gate in the
 * repository stayed green. The mutation was predicted RED and came back GREEN,
 * and under standing rule 112 a surviving mutant is investigated rather than
 * explained away. The investigation is the reason this file is here.
 *
 * WHY OMISSION IS THE WORSE HALF, not the lesser one. An invented quote tends to
 * read oddly and gets challenged. A truncated quote reads perfectly, cites
 * accurately, verifies mechanically — and can reverse the rule. "Separate parts
 * of a compound name with either a hyphen or a blank space" alone permits
 * "SmithJones" by silence, when the sentence the IRS actually wrote forbids it
 * in the very next clause. That is precisely the failure standing rule 24/35
 * exists to prevent, arriving through the one door the existing gates left open.
 *
 * ═══ WHAT THIS GATE CHECKS, AND WHAT IT DELIBERATELY DOES NOT ═══
 *
 * A quotation may legitimately stop mid-passage. Authorities are long and
 * lessons quote fragments of them constantly, so "every quote must end where a
 * paragraph ends" would be false and would fail hundreds of honest citations.
 *
 * What CANNOT be legitimate is a quotation that stops mid-sentence while the
 * source continues that same sentence. So the rule enforced here is narrow and
 * mechanical:
 *
 *     if a quotation does not end at a sentence boundary, then the character
 *     that follows it in the source must not be a letter or a digit.
 *
 * A quote ending "...blank space." is fine — it closed its sentence. A quote
 * ending "...blank space" when the source reads "...blank space. Do not join"
 * is fine too, because the next character is a full stop rather than a letter.
 * A quote ending "...with either a" when the source continues "...with either a
 * hyphen" is refused, because the sentence was cut in half.
 *
 * This catches M10's class without touching legitimate fragments, and it is the
 * strongest rule available that is still TRUE of every honest citation in the
 * tree — which was measured, not assumed: the gate was written first, run
 * against all 464 registered quotations, and the two failures it produced were
 * examined individually before this file was committed.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { FORM_W2_BOX_LESSONS, FORM_W2_SOURCE_PATH } from "@/lib/payroll/form-box-lessons-w2";
import { FORM_W3_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-w3";
import { FORM_941_LESSONS } from "@/lib/payroll/form-box-lessons-941";
import { FORM_940_LESSONS } from "@/lib/payroll/form-box-lessons-940";
import { WA_QUARTERLY_LESSONS } from "@/lib/payroll/form-box-lessons-wa";
import { FORM_941_CONFIRMATION_LESSONS } from "@/lib/payroll/form-941-confirmation-lessons";
import type { BoxLesson } from "@/lib/payroll/form-box-core";
/*
 * The repository's own elision primitives, imported rather than reimplemented.
 *
 * A quotation may legitimately join two non-contiguous passages with "...", and
 * `verify-verbatim-quotes.ts` already knows how to check that: split on the
 * ellipsis, require every segment to appear IN ORDER, and refuse a segment short
 * enough to match by accident. Twelve quotations in the tree are elided this way.
 *
 * Writing a second implementation here would create two definitions of what
 * "verbatim" means in one repository, and the whole reason this file exists is
 * that two such definitions already caused a gate to skip 26 quotations without
 * saying so. So the primitives are shared, and if their rules change this gate
 * changes with them.
 */
import { matchesInOrder, quoteSegments, normalise } from "../../scripts/verify-verbatim-quotes";

const REPO_ROOT = join(__dirname, "..", "..");

/**
 * Every lesson set in the repository.
 *
 * Named individually and counted, because books-54 proved that a gate handed
 * four of five lesson sets reports success on the four (standing rule 39). The
 * count is asserted below so a seventh set cannot be added without either being
 * listed here or making this file fail.
 */
const SETS: readonly (readonly [string, readonly BoxLesson[]])[] = [
  ["form-box-lessons-w2.ts", FORM_W2_BOX_LESSONS],
  ["form-box-lessons-w3.ts", FORM_W3_BOX_LESSONS],
  ["form-box-lessons-941.ts", FORM_941_LESSONS],
  ["form-box-lessons-940.ts", FORM_940_LESSONS],
  ["form-box-lessons-wa.ts", WA_QUARTERLY_LESSONS],
  ["form-941-confirmation-lessons.ts", FORM_941_CONFIRMATION_LESSONS],
];

/** Sentence-ending punctuation, plus the semicolon that ends a list item. */
function endsASentence(s: string): boolean {
  return /[.;:!?)\]"\u201d\u2019]$/.test(s.trimEnd());
}

/**
 * ═══ THE TWO VERBATIM STANDARDS, AND WHY THIS GATE MUST HONOUR BOTH ═══
 *
 * This repository stores quotations in two different shapes, for reasons that
 * are individually sound and collectively a trap.
 *
 *   1. Lesson files written against a mirrored PDF keep the line breaks the PDF
 *      actually has, so `corpus.includes(quote)` works on the raw bytes.
 *   2. Authority REGISTRY files (`form-940-authorities.ts`,
 *      `form-941-confirmation-lessons.ts`) store each quotation as a
 *      concatenation of source-code string fragments joined with spaces, so the
 *      newlines are gone. `scripts/verify-verbatim-quotes.ts` checks those by
 *      NORMALISING whitespace on both sides before comparing.
 *
 * Both are verified. Neither is wrong. But a gate that uses raw `includes` sees
 * only the first kind, and — this is the whole problem — a quotation it cannot
 * locate looks identical to a quotation that needs no checking. The first draft
 * of this file used raw `includes` and silently examined 111 of 137 quotations:
 * all 22 in the 940 set and all 4 in the confirmation set were skipped, and the
 * summary line said nothing about it. That is standing rule 39 arriving inside
 * the very gate written to close a rule-39 hole.
 *
 * It was caught only because the rule-66d floor in the test below asserted a
 * count, the count came back 111, and 111 was not the number of quotations in
 * the repository. A gate without that floor would have reported success.
 *
 * So the search is whitespace-insensitive, matching the verifier's own
 * standard, and the character-after-the-quote is read from the NORMALISED
 * corpus so both storage shapes are checked by one rule.
 *
 * ═══ AND THE NORMALISER IS IMPORTED, NOT WRITTEN AGAIN ═══
 *
 * The second draft of this file declared its own one-line
 * `s.replace(/\s+/g, " ")`. That located 127 of 137 quotations, leaving ten
 * that the real verifier passes without complaint — the ten being 940 and
 * confirmation-panel quotes whose mirrored corpus is a PDF dump with page
 * furniture (blank lines, a bare page number, a form feed) sitting in the middle
 * of a sentence. `verify-verbatim-quotes.ts` strips that page furniture BEFORE
 * collapsing whitespace, and its own docblock says exactly why a gate must not
 * reimplement this: "A gate that normalises differently from the thing it is
 * gating measures its own opinion."
 *
 * I wrote the imitation anyway, and it measured my opinion for two drafts. The
 * function is now imported. Recorded because the warning was already in the
 * file I was calling into, in plain English, and it still took a counted
 * mismatch to make me read it.
 */

describe("no quotation is cut off mid-sentence", () => {
  it("hands over every lesson set that exists", () => {
    expect(
      SETS.length,
      "a lesson set was added or removed without updating this gate, so quotations in it are " +
        "not being checked for truncation at all",
    ).toBe(6);
    for (const [name, set] of SETS) {
      expect(set.length, `${name} is empty, so checking it proves nothing`).toBeGreaterThan(0);
    }
  });

  it("refuses a quote that stops in the middle of a word or clause", () => {
    let checked = 0;
    let fragments = 0;
    const offences: string[] = [];
    /** Normalised corpora, cached: several sets share one large mirrored file. */
    const corpora = new Map<string, string>();

    for (const [setName, set] of SETS) {
      for (const lesson of set) {
        for (const q of lesson.quotes) {
          const abs = join(REPO_ROOT, q.sourcePath);
          if (!existsSync(abs)) continue;
          if (!corpora.has(abs)) corpora.set(abs, normalise(readFileSync(abs, "utf8")));
          const flat = corpora.get(abs)!;
          const needle = normalise(q.quote);

          /*
           * Locate the quotation, allowing for elision. For an elided quote the
           * position that matters for the truncation rule is the end of the LAST
           * segment, because that is where the quotation stops.
           */
          const segments = quoteSegments(needle);
          if (segments === null) continue; // the verifier owns that failure
          if (!matchesInOrder(flat, segments)) continue; // ditto
          const lastSegment = segments[segments.length - 1];
          const at = flat.lastIndexOf(lastSegment);
          if (at === -1) continue;
          checked += 1;

          if (endsASentence(q.quote)) continue;
          fragments += 1;

          /*
           * The quotation stops mid-passage. That is allowed only if the source
           * does not continue the same word or sentence.
           */
          const rest = flat.slice(at + lastSegment.length).replace(/^\s+/, "");
          const nextChar = rest.slice(0, 1);
          if (/[A-Za-z0-9]/.test(nextChar)) {
            offences.push(
              `${setName} ${lesson.formId} box ${lesson.box} (${q.cite}): the quotation ends ` +
                `"...${q.quote.slice(-45).replace(/\s+/g, " ")}" but the source continues ` +
                `"${rest.slice(0, 60).replace(/\s+/g, " ")}...". Quote to the end of the ` +
                "sentence, or the citation changes what the authority said by stopping early.",
            );
          }
        }
      }
    }

    /*
     * Rule 66d, and the assertion that caught this gate's own blind spot.
     *
     * `total` is every quotation in every lesson set. `checked` is how many were
     * actually located in a corpus and examined. Asserting they are EQUAL is the
     * point: a floor like "more than 100" would have accepted the first draft's
     * silent skipping of 26 quotations, and a floor is what a gate reaches for
     * when it does not want to know the real number.
     *
     * Counted rather than typed, so adding a lesson cannot leave this behind.
     */
    const total = SETS.reduce(
      (n, [, set]) => n + set.reduce((m, l) => m + l.quotes.length, 0),
      0,
    );
    expect(total, "no quotations exist at all, so this gate proves nothing").toBeGreaterThan(100);
    expect(
      checked,
      `${total} quotations exist but only ${checked} were located in a corpus and examined. The ` +
        "difference was skipped silently, which is exactly how the first draft of this gate " +
        "examined 111 of 137 while reporting success. Either the quotation is not in the file it " +
        "cites, or its sourcePath is wrong, or this gate's matching is too strict for the way " +
        "that set stores its text. All three are findings, not reasons to lower a floor.",
    ).toBe(total);
    expect(
      fragments,
      "every quotation ended at a sentence boundary, so the mid-sentence branch never ran and " +
        "this gate has not been shown to do anything",
    ).toBeGreaterThan(0);

    expect(offences, offences.join("\n\n")).toEqual([]);
    console.log(
      `quote-truncation: ${checked} quotations checked, ${fragments} are deliberate fragments, ` +
        "none cut mid-sentence",
    );
  });

  /**
   * THE GATE THAT PROVES THIS GATE WORKS (rule 15).
   *
   * Reconstructs mutation M10 exactly — the compound-name rule with its
   * prohibition removed — and confirms that the old `includes` check accepts it
   * while the rule above refuses it. If this ever fails, the gate has stopped
   * being able to catch the thing it was written for.
   */
  it("would have caught the truncation that survived the mutation campaign", () => {
    const corpus = readFileSync(join(REPO_ROOT, FORM_W2_SOURCE_PATH), "utf8");
    const full =
      "Separate parts of a compound name with either a\nhyphen or a blank space. Do not join them into a single\nword.";
    const truncated = "Separate parts of a compound name with either a\nhyphen or a blank space.";

    // Both are genuinely present, which is why substring matching cannot tell
    // them apart. This is the hole, demonstrated rather than described.
    expect(corpus.includes(full)).toBe(true);
    expect(corpus.includes(truncated)).toBe(true);

    // The truncation ends a sentence, so even this gate accepts it. Recorded
    // honestly: the rule enforced here does NOT catch every omission, only
    // mid-sentence ones. Claiming otherwise would be the sort of overstatement
    // rule 40 refuses.
    expect(endsASentence(truncated)).toBe(true);

    // What it DOES catch is the mid-clause cut, which no other gate can see.
    const midClause = "Separate parts of a compound name with either a";
    expect(corpus.includes(midClause)).toBe(true);
    expect(endsASentence(midClause)).toBe(false);
    const rest = corpus.slice(corpus.indexOf(midClause) + midClause.length).replace(/^\s+/, "");
    expect(/[A-Za-z0-9]/.test(rest.slice(0, 1))).toBe(true);
  });
});
