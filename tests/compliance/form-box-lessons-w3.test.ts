/**
 * tests/compliance/form-box-lessons-w3.test.ts   (books-55)
 *
 * ═══ WHY THIS FILE EXISTS, IN MICHAEL'S OWN WORDS ═══
 *
 *   "it was me that produced all the w-2s and w-3 for my business, not my
 *    grandfather. It's very likely I did it wrong. Please deep research the
 *    proper way for me to fill them out so the teaching lessons are accurate
 *    and the forms are built based on legal authoritative text rather than
 *    trusting my bad accounting. ... I want true accuracy, not taking my bad
 *    form filling and calling it source material."
 *
 * That sentence is a specification, and this file is where it is enforced.
 * Every lesson in `form-box-lessons-w3.ts` had to be checkable against two
 * different things, and the distinction is the whole point (rule 109):
 *
 *   THE LAW  — the mirrored IRS instructions. Quoted, and verified here
 *              CHARACTER FOR CHARACTER against the file on disk.
 *   WHAT WAS FILED — Greenway's 2025 W-3. An observation, never a source of
 *              law, and named `AS_FILED_*` so it cannot be mistaken for one.
 *
 * ═══ THE TEST THAT MATTERS MOST ═══
 *
 * The arithmetic tests below DO NOT read the lesson text and confirm it agrees
 * with itself. They recompute the statutory result from the rate and the wage
 * base and compare it to what was filed. That is the only ordering that can
 * discover a problem, and it did discover one: box 6 as filed is two cents
 * BELOW 1.45% of the box 5 wage base. The two cents are legitimate — they are
 * the "fractions of cents" adjustment on line 7 of the Q1 941 — but they are
 * only visibly legitimate because the law was applied first and the form
 * measured against it second.
 *
 * Had this file been written the other way round — reading his W-3 and
 * asserting the lessons describe it — it would have been a test that certifies
 * the input, which is precisely what Michael asked me not to build.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  FORM_W3_BOX_LESSONS,
  FORM_W3_SOURCE_PATH,
  FORM_W3_SOURCE_URL,
  AS_FILED_2025_W3_FORM_COUNT,
  AS_FILED_2025_W3_BOX_1_CENTS,
  AS_FILED_2025_W3_BOX_2_CENTS,
  AS_FILED_2025_W3_BOX_3_CENTS,
  AS_FILED_2025_W3_BOX_4_CENTS,
  AS_FILED_2025_W3_BOX_5_CENTS,
  AS_FILED_2025_W3_BOX_6_CENTS,
  AS_FILED_2025_W3_EIN,
  OASDI_EMPLOYEE_BPS,
  MEDICARE_EMPLOYEE_BPS,
} from "@/lib/payroll/form-box-lessons-w3";
import { lessonFor } from "@/lib/payroll/form-box-core";
import { FORM_W3_WHOSE } from "@/lib/payroll/form-box-adapters";
import {
  teachingBoxes,
  assertEveryTaughtBoxHasASpecimen,
  assertEveryTieResolves,
} from "@/lib/payroll/form-box-teaching-core";

const corpus = readFileSync(FORM_W3_SOURCE_PATH, "utf8");

describe("every W-3 quote is really in the IRS instructions", () => {
  it("finds each quoted passage verbatim in the mirrored file", () => {
    let checked = 0;
    for (const lesson of FORM_W3_BOX_LESSONS) {
      for (const q of lesson.quotes) {
        expect(
          corpus.includes(q.quote),
          `Form W-3 box ${lesson.box}: quote NOT found verbatim in ${q.sourcePath}:\n${q.quote}`,
        ).toBe(true);
        checked += 1;
      }
    }
    /*
     * Rule 66d: assert existence before absence. MEASURED at books-55: 35
     * quotes across 31 lessons. A floor, so that gutting the module cannot
     * make this loop pass by having nothing to iterate.
     */
    expect(checked, "the W-3 lessons have lost their quotes").toBeGreaterThanOrEqual(35);
    console.log(`form-w3 lessons: ${checked} quotes verified verbatim against the corpus`);
  });

  /**
   * THE GATE THAT PROVES THE GATE WORKS (rule 15).
   *
   * A verbatim check means nothing unless a nearly-right string fails it. The
   * realistic mistake is not a typo — it is a human retyping a quote and
   * silently "fixing" the PDF's mid-sentence line breaks into spaces. So that
   * exact mistake is manufactured here and the corpus must reject it.
   *
   * This is not hypothetical for this module. The W-3 authority records in
   * `form-w2-authorities.ts` are checked by a verifier that NORMALISES
   * whitespace, while this gate does not. The same IRS sentence therefore needs
   * a DIFFERENT literal in the two places, and copying one into the other
   * fails. Two of the extraction attempts for this module failed for exactly
   * this reason: the corpus wraps "the Forms\nW-2." and "entire page of\nthe
   * Form W-3." mid-phrase.
   */
  it("would reject a quote that had been tidied up", () => {
    const wrapped = FORM_W3_BOX_LESSONS.flatMap((l) => l.quotes).filter((q) =>
      q.quote.includes("\n"),
    );
    /*
     * Rule 66d again, and it is load-bearing here rather than ceremonial: if no
     * quote contained a newline there would be nothing to reflow, this test
     * would pass vacuously, and it would be certifying a property it never
     * examined. MEASURED: 34 of the 35 quotes wrap.
     */
    expect(
      wrapped.length,
      "no quote contains a line break, so the reflow attack below cannot be constructed and " +
        "this test would prove nothing about the verbatim gate",
    ).toBeGreaterThanOrEqual(30);

    for (const q of wrapped) {
      const tidied = q.quote.replace(/\n/g, " ");
      expect(tidied).not.toBe(q.quote);
      expect(
        corpus.includes(tidied),
        `the corpus accepted a reflowed version of the box quote "${q.cite}", so the verbatim ` +
          `check proves nothing for it`,
      ).toBe(false);
    }
    console.log(`form-w3 lessons: ${wrapped.length} quotes proven to fail if reflowed`);
  });

  it("points every quote at the mirrored file and a URL Michael can open", () => {
    for (const lesson of FORM_W3_BOX_LESSONS) {
      for (const q of lesson.quotes) {
        expect(q.sourcePath).toBe(FORM_W3_SOURCE_PATH);
        expect(q.sourceUrl).toBe(FORM_W3_SOURCE_URL);
        expect(q.sourceUrl.startsWith("https://")).toBe(true);
        expect(q.cite.length, `box ${lesson.box} has a stub citation`).toBeGreaterThan(20);
        // "So what" is the translation from law into action. A citation with no
        // translation is the wall of text Michael complained about.
        expect(
          q.soWhat.length,
          `box ${lesson.box} quote has no real soWhat`,
        ).toBeGreaterThan(60);
      }
    }
  });

  /**
   * A quote must be a QUOTE, not a fragment that happens to appear.
   *
   * Short fragments are the loophole in every verbatim gate: "the total" is
   * verbatim in almost any tax document and proves nothing about what the
   * instruction says. So something must stop a quote being trimmed down until
   * it says whatever the author wanted it to say.
   *
   * ─── THE FIRST VERSION OF THIS TEST WAS WRONG, AND IT FAILED HONESTLY ───
   *
   * I first wrote it as a 40-character minimum, copying the authority
   * verifier's MIN_SEGMENT_CHARS. It failed on box 9 — whose ENTIRE IRS
   * instruction is 39 characters:
   *
   *     Box 9. Do not enter an amount in box 9.
   *
   * Checked against the corpus, that is genuinely the whole thing: the line
   * above it is "Boxes 1 through 8..." and the line below is "Box 10—...".
   * There is nothing to add. The tempting fixes were both bad — lower the floor
   * to 39 (a magic number meaning "one specific quote"), or pad the quote with
   * a neighbouring sentence about a different box (fabricating context, and
   * teaching box 9 out of box 10's instruction).
   *
   * The real problem was that character count was never the property I cared
   * about. What actually distinguishes a quote from a fragment is whether it
   * was CUT MID-THOUGHT. So the invariant is now structural: every quote must
   * begin exactly where a line begins in the source, and end on a sentence
   * terminator. A fragment lifted out of the middle of a sentence fails, no
   * matter how long it is — which is a strictly stronger test than the one it
   * replaces, and it has no magic numbers in it.
   *
   * MEASURED across all 35 quotes: 35 begin at a line start, 35 end on a
   * sentence terminator.
   */
  it("quotes whole instructions rather than fragments cut mid-thought", () => {
    let checked = 0;
    for (const lesson of FORM_W3_BOX_LESSONS) {
      for (const q of lesson.quotes) {
        const at = corpus.indexOf(q.quote);
        expect(at, `box ${lesson.box}: quote not in corpus`).toBeGreaterThanOrEqual(0);

        // A quote must start where the instruction starts, not mid-sentence.
        const startsLine = at === 0 || corpus[at - 1] === "\n";
        expect(
          startsLine,
          `box ${lesson.box}: the quote begins mid-line, so it was cut out of the middle of ` +
            `something. Preceding characters: ${JSON.stringify(corpus.slice(Math.max(0, at - 40), at))}`,
        ).toBe(true);

        // And it must end where a thought ends. This is what a fragment cannot
        // do: "Enter the total" stops without a full stop.
        expect(
          /[.!?]$/.test(q.quote.trim()),
          `box ${lesson.box}: the quote does not end on a sentence terminator, so it is a ` +
            `fragment: ...${JSON.stringify(q.quote.trim().slice(-60))}`,
        ).toBe(true);

        // A quote that is ONLY the bold caption is a heading, not an
        // instruction — the caption tells Michael nothing he cannot read off
        // the form itself.
        expect(
          q.quote.trim().length,
          `box ${lesson.box} quote is only a caption`,
        ).toBeGreaterThan(q.quote.trim().split(/[.!?]/)[0]!.length);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(35);
    console.log(
      `form-w3 lessons: ${checked} quotes each begin at a line boundary and end on a sentence`,
    );
  });

  /**
   * ═══ THE DUPLICATE-CAPTION TRAP, PINNED (books-55) ═══
   *
   * "Box 10—Dependent care benefits" appears TWICE in this corpus: once in the
   * W-2 chapter as a long passage about section 129 plans, and once in the W-3
   * chapter as a one-line "enter the total". A whole-file search for the
   * caption returned 38,838 characters of the WRONG chapter — perfectly
   * verbatim and completely wrong.
   *
   * `corpus.includes()` cannot tell those apart, so the verbatim gate above is
   * blind to this class of error by construction (rule 39). This test closes
   * it: any quote whose opening caption occurs more than once in the corpus
   * must be short enough to be the W-3's one-liner rather than the W-2's essay.
   * It is the only defence against a quote that passes every other check here
   * while teaching the wrong form's rules.
   */
  it("never lifts a passage from the W-2 chapter through a caption that appears twice", () => {
    let ambiguous = 0;
    for (const lesson of FORM_W3_BOX_LESSONS) {
      for (const q of lesson.quotes) {
        const caption = q.quote.trim().split("\n")[0]!.trim();
        if (caption.length < 12) continue;
        const occurrences = corpus.split(caption).length - 1;
        expect(
          occurrences,
          `caption "${caption}" is not in the corpus at all, which should be impossible`,
        ).toBeGreaterThanOrEqual(1);
        if (occurrences === 1) continue;
        ambiguous += 1;
        /*
         * The W-3 instruction for a shared caption is always the terse one. The
         * W-2 version of the same caption runs to thousands of characters. 900
         * is the ceiling the extraction tool enforced when it pulled these
         * passages; anything longer is the wrong chapter.
         */
        expect(
          q.quote.length,
          `box ${lesson.box}: the caption "${caption}" appears ${occurrences} times in the ` +
            `corpus and this quote is ${q.quote.length} characters — long enough that it is ` +
            `probably the W-2 chapter's version of the same heading. That passage would be ` +
            `verbatim and still wrong.`,
        ).toBeLessThanOrEqual(900);
      }
    }
    console.log(
      `form-w3 lessons: ${ambiguous} quotes carry a caption that appears more than once, ` +
        `each confirmed short enough to be the W-3's own instruction`,
    );
  });
});

describe("the W-3 lessons cover the form and are reachable", () => {
  it("teaches every box the adapter can classify, and no box it cannot", () => {
    const taught = FORM_W3_BOX_LESSONS.map((l) => l.box);
    const rendered = Object.keys(FORM_W3_WHOSE);
    for (const box of rendered) {
      expect(taught.includes(box), `W-3 box ${box} is rendered but has no lesson`).toBe(true);
    }
    /*
     * Rule 66b: check both directions. A lesson for a box the form does not
     * have is not harmless — it is a lesson Michael can never reach from the
     * screen, so it would rot unread and unverified.
     */
    for (const box of taught) {
      expect(rendered.includes(box), `W-3 lesson for box ${box}, which nothing renders`).toBe(
        true,
      );
    }
    expect(new Set(taught).size, "a box is taught twice").toBe(taught.length);
    expect(taught.length).toBe(rendered.length);
    console.log(`form-w3 lessons: ${taught.length} boxes taught, matching the rendered form`);
  });

  it("is reachable through lessonFor, which is how the explorer looks them up", () => {
    for (const lesson of FORM_W3_BOX_LESSONS) {
      const found = lessonFor(FORM_W3_BOX_LESSONS, "form_w3", lesson.box);
      expect(
        found,
        `box ${lesson.box} cannot be found by the explorer's own lookup`,
      ).toBeDefined();
      expect(found?.headline).toBe(lesson.headline);
    }
    // And the lookup must not answer for a form these lessons are not about.
    expect(lessonFor(FORM_W3_BOX_LESSONS, "form_w2", "1")).toBeUndefined();
  });

  it("has a specimen box for every lesson, so it teaches before payroll exists", () => {
    assertEveryTaughtBoxHasASpecimen(FORM_W3_BOX_LESSONS);
    const specimen = teachingBoxes("form_w3");
    expect(specimen.length).toBe(FORM_W3_BOX_LESSONS.length);
    for (const b of specimen) {
      // Never a fabricated figure. A zero here would claim Greenway paid nothing.
      expect(b.notComputedYet).not.toBeNull();
      expect(b.amountCents).toBe(0);
    }
  });

  it("resolves every cross-reference to a form and box that exist", () => {
    expect(() => assertEveryTieResolves(FORM_W3_BOX_LESSONS)).not.toThrow();
    const ties = FORM_W3_BOX_LESSONS.reduce((n, l) => n + l.tiesTo.length, 0);
    expect(ties, "the W-3 lessons cross-reference nothing").toBeGreaterThanOrEqual(34);
    for (const l of FORM_W3_BOX_LESSONS) {
      for (const t of l.tiesTo) {
        expect(t.why.length, `box ${l.box} ties to ${t.formId}:${t.box} without saying why`)
          .toBeGreaterThan(40);
      }
    }
    console.log(`form-w3 lessons: ${ties} cross-references, all resolving`);
  });

  it("writes real teaching rather than placeholders", () => {
    for (const l of FORM_W3_BOX_LESSONS) {
      expect(l.formId).toBe("form_w3");
      expect(l.headline.length, `box ${l.box} headline is thin`).toBeGreaterThan(20);
      expect(l.plainEnglish.length, `box ${l.box} plainEnglish is thin`).toBeGreaterThan(120);
      expect(l.whereItComesFrom.length, `box ${l.box} whereItComesFrom is thin`).toBeGreaterThan(
        40,
      );
      expect(l.howToReadIt.length, `box ${l.box} howToReadIt is thin`).toBeGreaterThan(60);
      expect(l.whatToDo.length, `box ${l.box} whatToDo is thin`).toBeGreaterThan(60);
      // Every box on this form HAS a characteristic error. Setting one to null
      // must be a deliberate, argued act, not a shortcut.
      expect(l.commonMistake, `box ${l.box} claims to have no common mistake`).not.toBeNull();
      expect(l.examples.length, `box ${l.box} has no worked example`).toBeGreaterThanOrEqual(1);
      for (const ex of l.examples) {
        expect(ex.steps.length, `box ${l.box} example has too few steps`).toBeGreaterThanOrEqual(
          3,
        );
        expect(ex.moral.length, `box ${l.box} example has no moral`).toBeGreaterThan(40);
        expect(ex.answer.length, `box ${l.box} example has no answer`).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * ═══ THE LAW APPLIED FIRST, THE FILED FORM MEASURED AGAINST IT ═══
 *
 * This block is the direct answer to "I want true accuracy, not taking my bad
 * form filling and calling it source material."
 *
 * Note the ORDER of every assertion below: the expected figure is computed
 * from a statutory rate, and the AS_FILED figure is then compared to it. The
 * filed number is never the expected value. If Michael's W-3 is wrong, these
 * tests fail — which is the entire point of writing them this way round.
 */
describe("Greenway's 2025 W-3 as filed, measured against the statute", () => {
  it("uses the statutory employee-side rates, in basis points", () => {
    // IRC 3101(a) / 3101(b): 6.2% OASDI and 1.45% Medicare, employee side.
    expect(OASDI_EMPLOYEE_BPS).toBe(620);
    expect(MEDICARE_EMPLOYEE_BPS).toBe(145);
  });

  it("agrees exactly with 6.2% of the box 3 wage base in box 4", () => {
    /*
     * Integer arithmetic in cents throughout (house rule: money is integer
     * cents). Rounded HALF UP at the cent, which is what
     * `Decimal.ROUND_HALF_UP` produced when this was first checked by hand
     * against the PDF: 332,975.44 x 6.2% = 20,644.48 exactly.
     */
    const expected = Math.round((AS_FILED_2025_W3_BOX_3_CENTS * OASDI_EMPLOYEE_BPS) / 10_000);
    expect(
      AS_FILED_2025_W3_BOX_4_CENTS,
      "box 4 as filed no longer equals 6.2% of the box 3 wage base",
    ).toBe(expected);
  });

  it("is two cents under 1.45% in box 6, and that is the 941 line 7 adjustment", () => {
    /*
     * ═══ THE FINDING THIS WHOLE FILE EXISTS TO MAKE VISIBLE ═══
     *
     * 332,975.44 x 1.45% = 4,828.14. Box 6 as filed says 4,828.12. The filed
     * form is TWO CENTS LIGHT against the statutory rate.
     *
     * That is not an error. It is the accumulated "fractions of cents"
     * difference between per-paycheque rounding and an annual recomputation,
     * and it was reported in the right place: line 7 of Greenway's Q1 2025 Form
     * 941 reads exactly -0.02. So the money is accounted for and the filing is
     * defensible.
     *
     * But notice what it took to know that. Reading the W-3 alone, 4,828.12 is
     * just a number. The discrepancy is only visible because the rate was
     * applied to the wage base FIRST and the form compared to the result
     * SECOND. This is the difference between a system that verifies the owner's
     * paperwork and one that ratifies it.
     *
     * The two cents are asserted here as an EXACT expected difference rather
     * than a tolerance. A tolerance would silently absorb a real error of one
     * or two cents somewhere else; an exact pin means any change at all has to
     * be explained.
     */
    const statutory = Math.round(
      (AS_FILED_2025_W3_BOX_5_CENTS * MEDICARE_EMPLOYEE_BPS) / 10_000,
    );
    expect(statutory).toBe(482_814);

    const difference = statutory - AS_FILED_2025_W3_BOX_6_CENTS;
    expect(
      difference,
      "the box 6 difference is no longer exactly two cents. Either a figure was edited, or a " +
        "real discrepancy has appeared. Do not widen this into a tolerance — reconcile it " +
        "against line 7 of the quarterly 941s, which is where fractions of cents are reported.",
    ).toBe(2);

    // And the lesson for box 6 must actually TELL him this, not bury it.
    const lesson = FORM_W3_BOX_LESSONS.find((l) => l.box === "6");
    expect(lesson).toBeDefined();
    const prose = [
      lesson!.plainEnglish,
      lesson!.howToReadIt,
      lesson!.commonMistake ?? "",
      lesson!.whatToDo,
      ...lesson!.examples.flatMap((e) => [...e.steps, e.moral, e.answer]),
    ]
      .join(" ")
      .toLowerCase();
    expect(
      prose.includes("fraction"),
      "box 6 is two cents off the statutory rate and its lesson never mentions fractions of " +
        "cents, so Michael would have no way to know why",
    ).toBe(true);
    expect(
      lesson!.tiesTo.some((t) => t.formId === "form_941" && t.box === "7"),
      "box 6 carries a two-cent difference that is resolved on 941 line 7, so it must tie there",
    ).toBe(true);
  });

  it("keeps boxes 1, 3 and 5 equal, and says why that is not a coincidence", () => {
    /*
     * All three are equal on this filing. That is a FACT ABOUT THE FILING, not
     * a rule — box 1 and box 3 diverge the moment there is a pre-tax deduction
     * or a shareholder health premium excluded under 3121(a)(2), and box 5
     * diverges from box 3 the moment anybody crosses the OASDI wage base.
     *
     * So this asserts the fact, and then requires the lesson to explain the
     * conditions under which it would STOP being true. A lesson that merely
     * described three equal numbers would teach Michael a coincidence as a law
     * — and that is exactly the failure mode he wrote in to warn me about.
     */
    expect(AS_FILED_2025_W3_BOX_1_CENTS).toBe(AS_FILED_2025_W3_BOX_3_CENTS);
    expect(AS_FILED_2025_W3_BOX_3_CENTS).toBe(AS_FILED_2025_W3_BOX_5_CENTS);

    for (const box of ["1", "3", "5"]) {
      const l = FORM_W3_BOX_LESSONS.find((x) => x.box === box);
      expect(l, `box ${box} is missing`).toBeDefined();
      const prose = `${l!.plainEnglish} ${l!.howToReadIt} ${l!.commonMistake ?? ""} ${
        l!.whatToDo
      }`.toLowerCase();
      expect(
        /differ|diverge|not the same|same only|equal only|apart|unequal|wage base|pre-tax|pretax/.test(
          prose,
        ),
        `box ${box} teaches its figure without ever saying that boxes 1, 3 and 5 can differ. ` +
          `On Greenway's filing they happen to be equal; a lesson that presents that as normal ` +
          `is teaching a coincidence as a rule.`,
      ).toBe(true);
    }
  });

  it("carries a formatted EIN, because the format is part of the instruction", () => {
    expect(AS_FILED_2025_W3_EIN).toMatch(/^\d{2}-\d{7}$/);
  });

  it("counts ten W-2s in box c, and never treats the count as money", () => {
    expect(AS_FILED_2025_W3_FORM_COUNT).toBe(10);
    expect(Number.isInteger(AS_FILED_2025_W3_FORM_COUNT)).toBe(true);
    /*
     * Box c is a COUNT. Every other filled box on this form is cents. A count
     * rendered through the money formatter reads as "$0.10", which is the kind
     * of error that survives review because it looks like a formatting nit
     * rather than a wrong answer on a tax form.
     */
    const l = FORM_W3_BOX_LESSONS.find((x) => x.box === "c");
    expect(l).toBeDefined();
    const prose = `${l!.plainEnglish} ${l!.howToReadIt} ${l!.whatToDo}`.toLowerCase();
    expect(
      /count|number of/.test(prose),
      "the box c lesson never says it is a count rather than an amount",
    ).toBe(true);
    expect(prose.includes("$"), "the box c lesson formats a count as money").toBe(false);
  });

  /**
   * RULE 109 ENFORCED MECHANICALLY, NOT BY GOOD INTENTIONS.
   *
   * The naming convention is the safeguard: `AS_FILED_` marks a figure as an
   * observation about a document Michael prepared, so no future reader can
   * mistake it for a target or a rule. A convention nobody checks is a
   * convention that decays, so it is checked — by reading this module's own
   * source and confirming no export smuggles one of his figures in under a
   * neutral-sounding name.
   */
  it("names every figure taken from Michael's filing AS_FILED, so none can pass as law", () => {
    const src = readFileSync("src/lib/payroll/form-box-lessons-w3.ts", "utf8");
    const exportedConsts = [...src.matchAll(/^export const (\w+)/gm)].map((m) => m[1]!);
    expect(exportedConsts.length, "found no exported constants to audit").toBeGreaterThanOrEqual(
      10,
    );

    const filedFigures = [
      AS_FILED_2025_W3_BOX_1_CENTS,
      AS_FILED_2025_W3_BOX_2_CENTS,
      AS_FILED_2025_W3_BOX_3_CENTS,
      AS_FILED_2025_W3_BOX_4_CENTS,
      AS_FILED_2025_W3_BOX_5_CENTS,
      AS_FILED_2025_W3_BOX_6_CENTS,
    ];
    // Every figure lifted off his W-3 is under an AS_FILED_ name.
    for (const name of exportedConsts) {
      if (name.startsWith("AS_FILED_")) continue;
      // The remaining exports must be law (rates), plumbing (paths) or lessons.
      expect(
        /_BPS$|^FORM_W3_SOURCE_(PATH|URL)$|^FORM_W3_BOX_LESSONS$/.test(name),
        `export "${name}" is neither an AS_FILED observation, a statutory rate, the corpus ` +
          `location, nor the lessons themselves. If it is a figure off Michael's filing it ` +
          `must be renamed AS_FILED_* (rule 109); if it is law it must cite the law.`,
      ).toBe(true);
    }
    // And the rates must NOT be his — they are statute, and must not have been
    // back-solved from his numbers.
    expect(filedFigures).not.toContain(OASDI_EMPLOYEE_BPS);
    expect(filedFigures).not.toContain(MEDICARE_EMPLOYEE_BPS);
  });
});
