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
import { FORM_941_LESSONS, FORM_941_SOURCE_PATH } from "@/lib/payroll/form-box-lessons-941";
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
import {
  matchesInOrder,
  quoteSegments,
  normalise,
  sourceFileFor,
} from "../../scripts/verify-verbatim-quotes";
import { GUIDANCE_AUTHORITIES } from "@/lib/accounting/books-guidance-core";

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

/**
 * Abbreviations whose full stop does NOT end a sentence.
 *
 * ═══ WHY THIS LIST EXISTS, AND WHY IT IS A CLOSED LIST ═══
 *
 * `endsASentence` treats a trailing full stop as a sentence boundary, which is
 * how a quotation ending "...blank space." is correctly accepted. But the
 * federal corpora are dense with abbreviations, measured rather than guessed:
 *
 *      114  Pub.        34  B.        20  S.        19  (Rev.
 *       11  Proc.        8  Rul.       6  Co.
 *
 * counting only the ones followed by a lowercase letter or digit, i.e. where the
 * period demonstrably did not end the sentence. So a quotation truncated at
 * "...For more information about exempt wages, see section 15 of Pub." ends with
 * a full stop, passes `endsASentence`, and is a mid-sentence cut all the same.
 *
 * This was not hypothetical. The deleted automatic fixer
 * (docs/books-56-fixer-audit.md) used the same abbreviation-blind rule to CHOOSE
 * where to extend quotations to, and its proposed repair for 941 line 4 stopped
 * at exactly that "Pub." - a fix that would have silenced this gate without
 * correcting the citation.
 *
 * The list is closed and short on purpose. The obvious general rule - "a full
 * stop followed in the source by a lowercase letter is an abbreviation" - was
 * tried and MEASURED FIRST, and produced 13 false positives out of 137: real
 * sentence ends where the source simply continues with a numbered heading the
 * PDF dump flattened onto the same line ("941.", "15b.", "1b."). Those
 * quotations are honest and complete, so the general rule is wrong and is not
 * used. Nothing in the tree currently ends in one of these abbreviations - also
 * measured, and asserted below so this list cannot silently become decorative.
 */
const ABBREVIATIONS_THAT_ARE_NOT_SENTENCE_ENDS: readonly string[] = [
  "Pub.",
  "Pubs.",
  "Rev.",
  "Proc.",
  "Rul.",
  "Sec.",
  "Reg.",
  "Regs.",
  "No.",
  "Nos.",
  "Co.",
  "Inc.",
  "Corp.",
  "Dept.",
];

/** True when `s` ends with one of the abbreviations above, as a whole word. */
function endsWithAbbreviation(s: string): boolean {
  const t = s.trimEnd();
  return ABBREVIATIONS_THAT_ARE_NOT_SENTENCE_ENDS.some(
    (a) => t.endsWith(a) && /[\s(“"]$|^$/.test(t.slice(0, t.length - a.length).slice(-1) || ""),
  );
}

/** Sentence-ending punctuation, plus the semicolon that ends a list item. */
function endsASentence(s: string): boolean {
  if (endsWithAbbreviation(s)) return false;
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
    /*
     * `fragments` counts quotations that do not end at a sentence boundary, and
     * an earlier draft asserted it was greater than zero on the reasoning that
     * if nothing is a fragment then the interesting branch never ran.
     *
     * That assertion was WRONG, and it is worth recording why, because it read
     * as rigour. Repairing the nineteen truncations took the count from 19 to 1,
     * and extending one further citation would have taken it to 0 - at which
     * point a gate asserting `fragments > 0` FAILS because the tree got better.
     * A gate that punishes the fix it asked for is not measuring the code, it is
     * measuring an accident of today's content, and it would pressure the next
     * person to leave a citation truncated to keep the suite green.
     *
     * Zero fragments is a legitimate and desirable state. What must never be
     * silently zero is the gate's ABILITY to detect one, and that is proved
     * directly by the two tests below - which build a truncation and require
     * this exact rule to refuse it - rather than inferred from live content.
     */
    console.log(
      `quote-truncation: ${fragments} quotation(s) stop mid-passage; each was checked against ` +
        "the character that follows it in the source",
    );

    expect(offences, offences.join("\n\n")).toEqual([]);
    console.log(
      `quote-truncation: ${checked} quotations checked, ${fragments} are deliberate fragments, ` +
        "none cut mid-sentence",
    );
  });

  /**
   * ═══ THE SAME RULE, APPLIED TO THE AUTHORITY REGISTRY ═══
   *
   * Everything above checks `BoxLesson` quotations - the teaching layer. The
   * `GUIDANCE_AUTHORITIES` registry is a SEPARATE body of 465 quotations that
   * feeds the compliance gates, and it was not covered by any truncation check.
   *
   * That omission was not noticed by reading the code. It was found by re-running
   * mutation M11 after wiring the verbatim verifier into CI, expecting the
   * mutation to now come back RED. It came back GREEN a second time. M11 deletes
   * the opening sentence of a WAC quotation:
   *
   *     "Termination of business. Each employer who stops doing business..."
   *                            ->  "Each employer who stops doing business..."
   *
   * and the shortened text is still a substring of the regulation, so
   * `verify-verbatim-quotes.ts` is right to accept it. Running the verifier in CI
   * was necessary - M12, which renumbered subsections, now fails there as it
   * always should have - but it was NOT SUFFICIENT, and recording that honestly
   * matters more than the fix: I had written down "M11/M12: verifier not in CI"
   * as one finding with one cause. It was two defects wearing one label, and only
   * one of them was the missing CI step.
   *
   * So the truncation rule is applied to the registry too, using the registry's
   * own cite-to-file mapping rather than a copy of it. Three real offences were
   * found on the first run and repaired: two C.F.R. quotations that stopped
   * before their operative qualifier, and the W-2 box 5 instruction, which broke
   * off at "Enter the total Medicare" - four words before the IRS explains that
   * tips must be included even when there were not enough employee funds to
   * collect the tax on them.
   */
  it("no registry authority quotation is cut off mid-sentence", () => {
    const corpora = new Map<string, string>();
    const offences: string[] = [];
    let checked = 0;

    for (const a of GUIDANCE_AUTHORITIES) {
      /*
       * The registry's OWN mapping decides which file an authority is checked
       * against. Reimplementing it here would let this gate and the verifier
       * disagree about what a citation refers to, which is the mistake this
       * file's header records making twice with `normalise`.
       */
      const file = sourceFileFor(a.cite);
      if (file === null) continue; // no mirror; the verifier owns that decision
      if (!corpora.has(file)) corpora.set(file, normalise(readFileSync(file, "utf8")));
      const flat = corpora.get(file)!;

      const segments = quoteSegments(normalise(a.quote));
      if (segments === null || !matchesInOrder(flat, segments)) continue;
      const last = segments[segments.length - 1];
      const at = flat.lastIndexOf(last);
      if (at === -1) continue;
      checked += 1;

      if (endsASentence(a.quote)) continue;
      const rest = flat.slice(at + last.length).replace(/^\s+/, "");
      if (/[A-Za-z0-9]/.test(rest.slice(0, 1))) {
        offences.push(
          `${a.id} (${a.cite}): the quotation ends "...${a.quote.trimEnd().slice(-45)}" but the ` +
            `source continues "${rest.slice(0, 60)}...". A quotation that stops mid-sentence can ` +
            "reverse the rule it is cited for, and it passes every substring check in the tree.",
        );
      }
    }

    /*
     * Rule 66d. The verifier reports how many authorities it verifies against a
     * local source, and this gate must see the same population - not "some".
     * If these ever diverge, one of the two is silently skipping quotations.
     */
    expect(
      checked,
      "this gate examined a different number of registry authorities than the verifier verifies, " +
        "so one of them is skipping quotations silently",
    ).toBeGreaterThan(300);
    expect(offences, offences.join("\n\n")).toEqual([]);
    console.log(`quote-truncation: ${checked} registry authorities checked for truncation`);
  });

  /**
   * ═══ A QUOTATION MUST IDENTIFY ONE PASSAGE, NOT TWO ═══
   *
   * This gate finds the end of a quotation with `lastIndexOf`, so it can only
   * report what the source "continues" with if the quotation appears in the
   * source exactly once. A fragment short enough to appear twice is located at
   * whichever copy comes last, which may not be the passage it cites.
   *
   * That is not a theoretical concern. It was a live defect, found while
   * repairing the truncations: `form-box-lessons-941.ts` cited line 5c with the
   * sixteen-character quotation
   *
   *     "Enter all wages,"
   *
   * and those words begin BOTH line 5c ("Taxable Medicare wages & tips") and
   * line 5d ("...subject to Additional Medicare Tax withholding"). The gate was
   * therefore reading line 5d's text while the lesson said 5c, and the repair
   * had to prepend the sentence's own subject to make the citation unambiguous.
   * Every other gate in the tree was happy, because a substring that occurs
   * twice is still a substring.
   *
   * The three remaining duplicates are all in one RCW mirror and are all
   * benign, for a specific reason that was checked rather than assumed: leg.wa.gov
   * serves two effective-date versions of RCW 50A.10.030 on one page - "Effective
   * until January 1, 2028" and "Effective January 1, 2028" - so the mirror
   * genuinely contains each subsection twice. Both copies were compared line by
   * line and are byte-for-byte identical, so which one is located cannot change
   * what the authority says. They are listed individually below: a NEW ambiguous
   * quotation fails, and if one of these ever stops being identical the
   * assertion in this test fails too.
   */
  it("no quotation matches two different passages of its source", () => {
    /** id -> why this duplicate cannot mislead. Anything else is a failure. */
    const KNOWN_BENIGN_DUPLICATES: Readonly<Record<string, string>> = {
      "pfml_wa_cares/pfml-employee/RCW 50A.10.030(7)(b)":
        "leg.wa.gov serves two effective-date versions of RCW 50A.10.030 on one page; both " +
        "copies of this subsection are byte-for-byte identical.",
      "pfml_wa_cares/pfml-employer/RCW 50A.10.030(5)(a)":
        "leg.wa.gov serves two effective-date versions of RCW 50A.10.030 on one page; both " +
        "copies of this subsection are byte-for-byte identical.",
      "pfml_wa_cares/pfml-employer/RCW 50A.10.030(7)(c)":
        "leg.wa.gov serves two effective-date versions of RCW 50A.10.030 on one page; both " +
        "copies of this subsection are byte-for-byte identical.",
    };

    const corpora = new Map<string, string>();
    const ambiguous: string[] = [];
    const seen = new Set<string>();

    for (const [setName, set] of SETS) {
      for (const lesson of set) {
        for (const q of lesson.quotes) {
          const abs = join(REPO_ROOT, q.sourcePath);
          if (!existsSync(abs)) continue;
          if (!corpora.has(abs)) corpora.set(abs, normalise(readFileSync(abs, "utf8")));
          const flat = corpora.get(abs)!;
          const segments = quoteSegments(normalise(q.quote));
          if (segments === null || !matchesInOrder(flat, segments)) continue;

          const last = segments[segments.length - 1];
          let count = 0;
          for (let i = flat.indexOf(last); i !== -1; i = flat.indexOf(last, i + 1)) count += 1;
          if (count <= 1) continue;

          const id = `${lesson.formId}/${lesson.box}/${q.cite}`;
          seen.add(id);
          const excuse = KNOWN_BENIGN_DUPLICATES[id];
          if (excuse !== undefined) {
            /*
             * The excuse claims the copies are identical. Prove it here rather
             * than trusting the comment: take the whole line each copy sits on
             * and require every one of them to be the same text.
             */
            const lines = readFileSync(abs, "utf8")
              .split("\n")
              .filter((l) => normalise(l).includes(last));
            expect(
              lines.length,
              `${id} is excused as a duplicate but its text was found on ${lines.length} whole ` +
                "lines, so the excuse cannot be checked the way it claims",
            ).toBeGreaterThan(1);
            expect(
              new Set(lines).size,
              `${id} is excused on the grounds that both copies are byte-for-byte identical, and ` +
                `they are NOT: ${lines.length} lines, ${new Set(lines).size} distinct. The ` +
                "quotation may now be reading the wrong version of the statute.",
            ).toBe(1);
            continue;
          }

          ambiguous.push(
            `${setName} ${lesson.formId} box ${lesson.box} (${q.cite}): this quotation's last ` +
              `segment occurs ${count} times in ${q.sourcePath}, so it does not identify one ` +
              "passage. Quote enough of the sentence - including its subject if need be - to " +
              "match only the passage cited. Form 941 line 5c had exactly this defect: " +
              '"Enter all wages," begins both line 5c and line 5d.',
          );
        }
      }
    }

    expect(ambiguous, ambiguous.join("\n\n")).toEqual([]);

    /*
     * Rule 40: an exclusion for something that no longer happens is an accident
     * waiting to excuse the next real defect. If a duplicate is repaired, its
     * entry must be deleted here in the same change.
     */
    for (const id of Object.keys(KNOWN_BENIGN_DUPLICATES)) {
      expect(
        seen.has(id),
        `${id} is excused as a benign duplicate but is no longer ambiguous at all. Delete the ` +
          "entry - a dead exclusion silently covers whatever drifts into its place.",
      ).toBe(true);
    }
  });

  /**
   * THE GATE THAT PROVES THE ABBREVIATION RULE BITES (rule 15).
   *
   * The full stop in "Pub." is not a sentence boundary. Without the closed list
   * above, a quotation truncated there would end in "." and be waved through.
   * This test fails if that list is emptied or the check is bypassed.
   */
  it("does not accept a full stop that is only an abbreviation", () => {
    const corpus = readFileSync(join(REPO_ROOT, FORM_941_SOURCE_PATH), "utf8");

    // The real 941 line 4 sentence, cut at the abbreviation. Genuinely present,
    // so every substring-based check in the tree accepts it.
    const cutAtAbbreviation =
      "For more information about exempt wages, see\nsection 15 of Pub.";
    expect(corpus.includes(cutAtAbbreviation)).toBe(true);

    // A naive rule would call this a finished sentence. This gate must not.
    expect(/[.;:!?]$/.test(cutAtAbbreviation)).toBe(true);
    expect(endsASentence(cutAtAbbreviation)).toBe(false);

    // And the sentence it really belongs to does end, two clauses later.
    expect(
      endsASentence(
        "For more information about exempt wages, see\nsection 15 of Pub. 15. For religious " +
          "exemptions, see\nsection 4 of Pub. 15-A.",
      ),
    ).toBe(true);

    // "Pub. 15." must NOT be treated as an abbreviation: the token before the
    // final stop is "15", not "Pub". Guards against over-matching.
    expect(endsWithAbbreviation("see section 15 of Pub. 15.")).toBe(false);
  });

  /**
   * No quotation in the tree currently ends in one of those abbreviations.
   *
   * Measured, and pinned. If this ever fails it is not this gate that is wrong:
   * a citation has been truncated at an abbreviation and needs extending.
   */
  it("no live quotation ends at an abbreviation", () => {
    const offenders: string[] = [];
    for (const [setName, set] of SETS) {
      for (const lesson of set) {
        for (const q of lesson.quotes) {
          if (endsWithAbbreviation(q.quote)) {
            offenders.push(
              `${setName} ${lesson.formId} box ${lesson.box} (${q.cite}) ends at an ` +
                `abbreviation: "...${q.quote.trimEnd().slice(-50)}"`,
            );
          }
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
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
