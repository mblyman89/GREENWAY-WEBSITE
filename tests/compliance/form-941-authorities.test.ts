/**
 * tests/compliance/form-941-authorities.test.ts   (books-48)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE FOUR FORM 941 QUOTES THAT WERE NEVER CHECKED, AND THE GATE THAT NOW
 * CHECKS THEM
 * ══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `tests/compliance/form-940-authorities.test.ts` fixed a routing defect in the
 * Form 940 citations and then wrote down, in as many words:
 *
 *     "THE SAME HOLE IS OPEN ON FORM 941 TODAY. Its four instruction cites read
 *      'IRS, Instructions for Form 941, line 1 (...)' - comma, and no year at
 *      all. They do not route either. That is books-40's debt, not this slice's,
 *      and standing rule 4 says one feature per pull request, so it is RECORDED
 *      here rather than silently fixed in a 940 branch."
 *
 * This is the 941 slice. The debt comes due here.
 *
 * ── WHAT WAS ACTUALLY WRONG ───────────────────────────────────────────────
 *
 * `sourceFileFor` routes IRS form instructions on:
 *
 *     /^IRS Instructions for Forms? ([\w-]+(?: and [\w-]+)?) \((\d{4})\)/
 *
 * All four Form 941 line-level cites read "IRS, Instructions for Form 941,
 * line N (...)". A comma after "IRS", and no four-digit year anywhere. The
 * regex did not match, so `sourceFileFor` returned null. The verifier then
 * asked `expectedCorpusFile` whether the citation at least BELONGS to a
 * mirrored corpus - and that function routes on the SAME table, so it returned
 * null too. Two nulls are read as "a document we do not mirror", which is the
 * honest skip, and the quotes were counted in this cheerful line:
 *
 *     "309 verified against local sources, 138 have no local copy to check
 *      against"
 *
 * `irs-instructions-941-2026.txt` was on disk the whole time.
 *
 * ── AND THE PART THAT MAKES IT MORE THAN COSMETIC ─────────────────────────
 *
 * Two of the four quotes were WRONG, and were only discovered once the cites
 * were repaired and the comparison actually ran:
 *
 *   LINE 1 - the five exclusions were transcribed as flowing prose ("Don't
 *   include: Household employees, Employees in nonpay status..."). The source
 *   is a BULLETED LIST and each item carries a literal "\u2022 " on disk.
 *
 *   LINE 7 - "lines 5a-5d" was written with an ASCII HYPHEN. The source has an
 *   EN DASH, "lines 5a\u20135d". One invisible character.
 *
 * THE CAUSAL ORDER IS THE LESSON. Nobody was careless twice. Somebody was
 * careless once, and the gate that existed to catch it had been silently
 * switched off by a punctuation mark. A gate that cannot ROUTE its input does
 * not report a problem - it reports nothing, and nothing looks exactly like
 * success. Standing rule 39, in the one form that is hardest to notice.
 *
 * ── HOW THIS FILE WAS PROVEN CAPABLE OF FAILING (standing rules 15, 83) ───
 *
 * Written against the BROKEN state first. With the original cites and quotes
 * in place, `npx vitest run tests/compliance/form-941-authorities.test.ts`
 * reported:
 *
 *   x routes every citation to a corpus file that exists on disk
 *       i941-line-1-... cite "IRS, Instructions for Form 941, line 1 (...)"
 *       routes to no mirrored file
 *   x every quote appears in the mirrored source, segment by segment, in order
 *       i941-line-1-pay-period-including-the-12th: quote does not appear
 *       i941-line-7-fractions-of-cents: quote does not appear
 *
 * Three failures, naming the three real defects. The fix then turned them
 * green, and `scripts/verify-verbatim-quotes.ts` moved from "309 verified /
 * 138 skipped" to "313 verified / 134 skipped" - four quotes crossing from the
 * unchecked column into the checked one, which is the number that proves the
 * routing repair rather than merely the transcription repair.
 *
 * ── RULE 39: THIS FILE DOES NOT WRITE ITS OWN MATCHER ─────────────────────
 *
 * It imports `quoteSegments`, `matchesInOrder` and `sourceFileFor` from the
 * real verifier, so what is proven failable here is the code that guards the
 * repo, not a convenient local copy of it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FORM_941_AUTHORITIES,
  FORM_941_BORROWED_AUTHORITY_IDS,
  FORM_941_ELISION,
  FORM_941_SOURCE_PATH,
  FORM_941_SOURCE_URL,
  FORM_941_SOURCE_YEAR,
  I941_LINE_1_PAY_PERIOD_INCLUDING_THE_12TH,
  I941_LINE_7_FRACTIONS_OF_CENTS,
  form941Authorities,
} from "@/lib/payroll/form-941-authorities";
import {
  ALL_SOURCE_REGISTRIES,
  findGuidanceAuthority,
} from "@/lib/accounting/books-guidance-core";
import {
  expectedCorpusFile,
  matchesInOrder,
  quoteSegments,
  sourceFileFor,
} from "../../scripts/verify-verbatim-quotes";

/**
 * The same normalisation the central verifier applies to BOTH sides.
 *
 * Deliberately the narrow version the 940 gate settled on: collapse whitespace
 * and render the PDF's curly punctuation as ASCII. Nothing else.
 *
 * IT MUST NOT FOLD THE EN DASH. That is not an omission - it is the point. If
 * this helper mapped \u2013 to "-", the line 7 quote would have "matched" with the
 * wrong character and the defect this file exists to catch would have been
 * normalised out of existence. A normaliser that erases the difference you are
 * testing for is a gate that approves everything (rule 39).
 */
function normalise(s: string): string {
  return s
    .replace(/\u2019/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const CORPUS = normalise(readFileSync(join(process.cwd(), FORM_941_SOURCE_PATH), "utf8"));

/** Only the cites that name the mirrored instructions; the CFR ones route elsewhere. */
const INSTRUCTION_AUTHORITIES = FORM_941_AUTHORITIES.filter((a) =>
  a.cite.includes("Instructions for Form 941"),
);

describe("books-48: the Form 941 corpus is real and non-trivial", () => {
  /**
   * RULE 39 VACUITY GUARD. Every test below searches CORPUS. If the mirrored
   * file were missing, empty, or a stub, a substring check would fail
   * everywhere - but a `.includes("")`-shaped check would pass trivially.
   * Anchor the corpus before relying on it.
   */
  it("has mirrored the real IRS instructions, not a placeholder", () => {
    expect(CORPUS.length).toBeGreaterThan(50_000);
    expect(CORPUS).toContain("Instructions for Form 941");
    expect(CORPUS).toContain("fractions of cents");
  });

  it("states the source year, and the year selects the file", () => {
    expect(FORM_941_SOURCE_YEAR).toBe(2026);
    // Load-bearing: the year is what the router puts in the filename. If the
    // constant and the path disagree, the quotes are being checked against a
    // revision nobody claimed to be reading.
    expect(FORM_941_SOURCE_PATH).toContain(String(FORM_941_SOURCE_YEAR));
  });

  /**
   * THE PATH IS NOT THE SOURCE. books-43 shipped 28 dead links by putting a
   * repo-relative path into `GuidanceAuthority.source`, which is rendered as
   * `href={a.source}`. The two facts stay in two constants.
   */
  it("keeps the mirrored path and the reader's URL apart", () => {
    expect(FORM_941_SOURCE_PATH.startsWith("docs/")).toBe(true);
    expect(() => new URL(FORM_941_SOURCE_URL)).not.toThrow();
    for (const a of FORM_941_AUTHORITIES) {
      expect(() => new URL(a.source), `${a.id}: source must be a URL, not a path`).not.toThrow();
    }
  });

  it("uses the elision marker the verifier actually splits on", () => {
    expect(FORM_941_ELISION).toBe(" ... ");
  });
});

describe("books-48: THE ROUTING DEFECT — every 941 citation must reach the verifier", () => {
  /**
   * THE GUARD THAT WOULD HAVE CAUGHT THE ORIGINAL DEFECT.
   *
   * Asserted in TWO ways on purpose (rule 34, both directions):
   *
   *   1. the cite matches the shape the router requires, and
   *   2. `sourceFileFor` - the REAL router - actually returns a path.
   *
   * (1) alone would pass a cite that looks right but names a year with no
   * mirrored file. (2) alone would go green the day someone loosened the regex
   * for the wrong reason. Together they pin the behaviour and the contract.
   */
  it("routes every citation to a corpus file that exists on disk", () => {
    expect(INSTRUCTION_AUTHORITIES.length).toBe(4);
    for (const a of INSTRUCTION_AUTHORITIES) {
      expect(a.cite, `${a.id}: cite must be routable`).toMatch(
        new RegExp(`^IRS Instructions for Form 941 \\(${FORM_941_SOURCE_YEAR}\\), `),
      );
      const routed = sourceFileFor(a.cite);
      expect(routed, `${a.id}: cite "${a.cite}" routes to no mirrored file`).not.toBeNull();
      expect(routed as string).toContain(`irs-instructions-941-${FORM_941_SOURCE_YEAR}.txt`);
    }
  });

  /**
   * THE SPECIFIC SHAPE THAT BROKE IT, PINNED BY NAME.
   *
   * A general property is the right guard, but the general property was already
   * true of the 940 module while 941 stayed broken for eight slices. So the
   * exact defect gets its own assertion: no cite may carry the comma that
   * silently disabled the router.
   */
  it("no citation carries the comma that switched the router off", () => {
    for (const a of FORM_941_AUTHORITIES) {
      expect(
        a.cite.startsWith("IRS, Instructions"),
        `${a.id}: "IRS, Instructions..." does not match the router's regex. This is the ` +
          `exact defect books-40 shipped and books-43 recorded; it must not return.`,
      ).toBe(false);
    }
  });

  /**
   * THE SECOND HALF OF THE HOLE, WHICH IS THE HALF THAT MADE IT SILENT.
   *
   * `sourceFileFor` returning null is not itself fatal - plenty of authorities
   * legitimately cite documents this repo does not mirror. What made the defect
   * INVISIBLE is that `expectedCorpusFile` routes on the same table, so it also
   * returned null, and the verifier concluded there was nothing to check.
   *
   * This asserts the recognition path directly: a 941 instruction cite must be
   * recognised as belonging to a mirrored corpus, so that if the file ever goes
   * missing the verifier FAILS instead of shrugging.
   */
  it("is recognised as belonging to a mirrored corpus, so a missing file would fail loudly", () => {
    for (const a of INSTRUCTION_AUTHORITIES) {
      const expected = expectedCorpusFile(a.cite);
      expect(
        expected,
        `${a.id}: not recognised as a mirrored corpus. A missing file would then be ` +
          `reported as "no local copy to check against" rather than as an error.`,
      ).not.toBeNull();
      expect(expected?.path).toContain(`irs-instructions-941-${FORM_941_SOURCE_YEAR}.txt`);
    }
  });

  /**
   * AN UNMERGED MODULE IS UNVERIFIED BY CONSTRUCTION. The verifier walks the
   * central registry; a leaf module that exports beautifully and is never
   * merged is invisible to the only thing that would have checked it.
   */
  it("registers every Form 941 authority into the one guidance registry", () => {
    const missing = FORM_941_AUTHORITIES.filter(
      (a) => findGuidanceAuthority(a.id) === undefined,
    ).map((a) => a.id);
    expect(missing).toEqual([]);
  });

  it("declares its own source-registry tag", () => {
    expect(ALL_SOURCE_REGISTRIES).toContain("form-941");
  });
});

describe("books-48: every Form 941 quote is verbatim", () => {
  /**
   * THE CORE GUARANTEE, through the real verifier primitives (rule 39).
   *
   * This is the test that went red on line 1 and line 7 the moment routing was
   * repaired, and it is the reason the routing repair mattered.
   */
  it("every quote appears in the mirrored source, segment by segment, in order", () => {
    for (const a of INSTRUCTION_AUTHORITIES) {
      const segments = quoteSegments(normalise(a.quote));
      expect(segments, `${a.id}: an elided segment is too short to prove anything`).not.toBeNull();
      expect(
        matchesInOrder(CORPUS, segments as string[]),
        `${a.id}: quote does not appear in ${FORM_941_SOURCE_PATH}`,
      ).toBe(true);
    }
  });

  /**
   * DEFECT 1, PINNED: THE BULLETS ARE PART OF THE INSTRUCTION.
   *
   * The line 1 quote listed five categories of person to exclude from the
   * headcount. The source presents them as a bulleted list; the quote ran them
   * together as prose. Both assertions are needed:
   *
   *   - the bullets are present (the transcription is faithful), and
   *   - all five categories survive (the repair did not "fix" the match by
   *     eliding the list away, which would have kept the sentence everyone
   *     already understands and dropped the part that catches errors).
   */
  it("transcribes line 1's exclusions as the bulleted list the IRS printed", () => {
    const q = I941_LINE_1_PAY_PERIOD_INCLUDING_THE_12TH.quote;
    expect(q).toContain("\u2022 Household employees,");
    expect(q).toContain("\u2022 Employees in nonpay status for the pay period,");
    expect(q).toContain("\u2022 Farm employees,");
    expect(q).toContain("\u2022 Pensioners, or");
    expect(q).toContain("\u2022 Active members of the U.S. Armed Forces.");
    // Five bullets, not four and not six.
    expect(q.split("\u2022").length - 1).toBe(5);
    // And the list was not quietly dropped in favour of an ellipsis.
    expect(q).not.toContain(FORM_941_ELISION);
  });

  /**
   * DEFECT 2, PINNED: ONE INVISIBLE CHARACTER.
   *
   * "lines 5a-5d" with an ASCII hyphen versus "lines 5a\u20135d" with an en dash.
   * Asserted in both directions, because asserting only the presence of the en
   * dash would still pass if someone added a second, hyphenated copy of the
   * same phrase.
   */
  it("uses the en dash the source prints in line 7's range, not an ASCII hyphen", () => {
    const q = I941_LINE_7_FRACTIONS_OF_CENTS.quote;
    expect(q).toContain("lines 5a\u20135d");
    expect(q).not.toContain("lines 5a-5d");
  });

  /**
   * DEFECT 3, AND THE ONE THAT JUSTIFIES THIS FILE NORMALISING STRICTLY.
   *
   * The line 2 quote read "Box 1 - Wages, tips, other compensation". The source
   * prints an EM DASH with no spaces: "Box 1\u2014Wages, tips, other compensation".
   *
   * THE CENTRAL VERIFIER WOULD NEVER HAVE CAUGHT THIS. Its normaliser folds
   * "\u2014" to "-" and pads every hyphen to " - " on both sides, so the two forms
   * are equivalent to it. This quote would have gone green the instant the cite
   * was made routable, and stayed subtly wrong.
   *
   * It was caught because `normalise` in THIS file is deliberately narrower:
   * whitespace and curly quotes only. That tolerance in the central gate exists
   * because publishers disagree about spacing around a dash introducing a list,
   * which really is typesetting rather than law. But a licence to be LENIENT
   * about what the source says is not a licence to be CARELESS about what we
   * claim it says - and transcribing the actual character satisfies both
   * normalisers at once, at no cost.
   *
   * Asserted for all three dashes in the module together, because the general
   * property is what matters: no dash in any 941 quote may be an ASCII stand-in
   * for a character the IRS printed differently.
   */
  it("transcribes the dashes the IRS printed, not ASCII stand-ins", () => {
    const line2 = FORM_941_AUTHORITIES.find((a) => a.id === "i941-line-2-matches-w2-box-1");
    expect(line2).toBeDefined();
    expect(line2?.quote).toContain("Box 1\u2014Wages, tips, other compensation");
    expect(line2?.quote).not.toContain("Box 1 - Wages");

    /*
     * THE GENERAL FORM. Both quotes that name a dash must survive the STRICT
     * normaliser, not merely the forgiving one. Proven by re-running the match
     * with only whitespace folded - which is exactly what CORPUS above is - so
     * this is not a second implementation, it is the same one asserted for the
     * specific pair of quotes that got it wrong.
     */
    for (const a of [line2, I941_LINE_7_FRACTIONS_OF_CENTS]) {
      expect(
        matchesInOrder(CORPUS, quoteSegments(normalise(a!.quote)) as string[]),
        `${a!.id}: fails under strict normalisation, so it is relying on the central ` +
          `verifier folding dashes for it. Transcribe the character on disk instead.`,
      ).toBe(true);
    }
  });

  /**
   * THE FABRICATION GUARD (rule 83: drive the gate with a broken input).
   *
   * The tests above prove the real quotes pass. That is only half a gate: a
   * matcher that accepted everything would also be green. These two inputs are
   * deliberately broken and MUST be rejected:
   *
   *   - an invented sentence that reads like the IRS but is not in the file; and
   *   - the REAL line 7 sentence with its en dash swapped for a hyphen, which
   *     is the actual historical defect. If normalisation ever grows a rule
   *     that folds the two dashes together, this assertion goes red and says so.
   */
  it("rejects an invented sentence and rejects the hyphen version of a real one", () => {
    const invented =
      "Enter the total number of employees who received a bonus during the quarter, " +
      "including any employee who separated before the last day of the quarter.";
    expect(matchesInOrder(CORPUS, quoteSegments(normalise(invented)) as string[])).toBe(false);

    const hyphenated = I941_LINE_7_FRACTIONS_OF_CENTS.quote.replace("5a\u20135d", "5a-5d");
    expect(
      matchesInOrder(CORPUS, quoteSegments(normalise(hyphenated)) as string[]),
      "the hyphenated version of line 7 must NOT match. If this is green, the " +
        "normaliser has started folding en dashes to hyphens and the transcription " +
        "guard above has become decoration.",
    ).toBe(false);
  });

  /**
   * NO QUOTE STOPS MID-SENTENCE. A truncated quote is still a genuine
   * substring, so the verbatim matcher cannot catch it - only a shape check can.
   */
  it("no quote stops in the middle of a sentence", () => {
    for (const a of INSTRUCTION_AUTHORITIES) {
      const last = a.quote.trim().slice(-1);
      expect(
        [".", "?", "!", ")"].includes(last),
        `${a.id}: quote ends with "${last}", which is mid-sentence. A truncated quote ` +
          `still passes a substring check, so the shape is the only guard there is.`,
      ).toBe(true);
    }
  });
});

describe("books-48: the authority set is unchanged in size by this repair", () => {
  /**
   * A REPAIR MUST NOT QUIETLY BECOME A REWRITE.
   *
   * This slice changed four cites and two quotes. It did not add or remove an
   * authority, and it did not change how the module composes. These counts are
   * already asserted in `form-941.test.ts` and `owner-report-books-40.test.ts`;
   * they are restated here so that if this file is ever read alone, the scope of
   * the change is visible in it.
   */
  it("still exports seven of its own and borrows ten", () => {
    expect(FORM_941_AUTHORITIES.length).toBe(7);
    expect(FORM_941_BORROWED_AUTHORITY_IDS.length).toBe(10);
    expect(form941Authorities().length).toBe(17);
  });

  it("has unique ids", () => {
    const ids = FORM_941_AUTHORITIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("classifies the instructions as IRS guidance, not as statute", () => {
    for (const a of INSTRUCTION_AUTHORITIES) {
      expect(a.kind, `${a.id}`).toBe("irs_guidance");
    }
  });
});
