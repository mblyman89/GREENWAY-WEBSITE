/**
 * books-43 — THE FORM 940 AUTHORITIES, AND THE FIVE DEFECTS THIS FILE CAUGHT.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `scripts/verify-verbatim-quotes.ts` already proves that every quote in the
 * central registry appears in its mirrored source. That script is excellent and
 * it is not enough, for a reason that is easy to state and easy to forget:
 *
 *   THE SCRIPT ONLY SEES WHAT THE REGISTRY HANDS IT, AND IT SKIPS WHAT IT
 *   CANNOT ROUTE.
 *
 * Both halves of that sentence failed during this slice, on this module, and
 * each failure produced a green line of output. Written down here because the
 * next annual form — W-2, W-3, 1099 — will be built the same way and can fail
 * the same way.
 *
 * ── THE FIVE DEFECTS, IN THE ORDER THEY WERE FOUND ────────────────────────
 *
 * 1. `kind: "instruction"` — a value that is not in `GuidanceAuthorityKind`.
 *    Caught by `tsc`, not by any test. IRS form instructions are
 *    `irs_guidance`, weight 1, persuasive-only — which is the honest weight:
 *    instructions are the IRS's view of its own form, not the statute.
 *
 * 2. `plain:` instead of `soWhat:`. Also a compiler catch. Worth noting that
 *    BOTH of these were invisible to vitest, because vitest transpiles without
 *    type-checking. A test suite alone would have shipped them.
 *
 * 3. TRUNCATION THAT CHANGED THE LAW. The first draft quoted:
 *
 *        "You're entitled to the maximum credit if you paid all state
 *         unemployment tax by the due date."
 *
 *    The source sentence does not end there. It ends "...by the due date of
 *    your Form 940 or if you weren't required to pay state unemployment tax
 *    during the calendar year due to your state experience rate."
 *
 *    That is not a stylistic trim. The truncated version says the credit is
 *    lost if the STATE deadline is missed. The real rule measures against the
 *    FORM 940 due date — the following 31 January. An ESD payment that is two
 *    months late to Washington still earns the full federal credit, provided it
 *    clears before the 940 is due. The truncation would have told Michael he
 *    had lost a credit he had not lost, and the engine would have overstated
 *    his federal tax on the strength of it.
 *
 *    A plain substring check CANNOT catch this, because a truncated quote is
 *    still a perfect substring. That is the same defect class books-34 found in
 *    the SSA rejection conditions. Hence the sentence-completeness test below.
 *
 * 4. A WORD INSERTED THAT THE IRS DID NOT WRITE. The credit-reduction quote had
 *    "The U.S. Department of Labor (DOL) determines these states". The source
 *    has no "(DOL)". Small, harmless, and exactly the kind of tidying that
 *    destroys the value of a verbatim panel — because if the reader finds one
 *    invented parenthesis, every other quote becomes a maybe.
 *
 * 5. A SENTENCE IMPORTED FROM A DIFFERENT EXAMPLE. The worksheet example quote
 *    contained "None of the payments made were exempt from FUTA tax." That
 *    sentence is real, and it belongs to the line-4 example about health
 *    insurance benefits, roughly two hundred lines earlier. It was not in the
 *    worksheet example at all. This is the most dangerous class of the five: a
 *    fabricated quote assembled entirely out of genuine fragments, each of
 *    which passes a substring check on its own.
 *
 * ── AND TWO HOLES IN THE PLUMBING, WHICH MATTER MORE THAN THE FIVE ────────
 *
 * A. THE CITE FORMAT SILENTLY DISABLED THE CENTRAL CHECKER. `sourceFileFor`
 *    routes on /^IRS Instructions for Forms? .../. Every cite in the first
 *    draft read "IRS, Instructions for Form 940 (2025), ..." — with a comma
 *    after "IRS". No match, so `sourceFileFor` returned null, so all seventeen
 *    quotes were counted as "no local copy to check against" while the mirrored
 *    file sat on disk the entire time. Seventeen unverified quotes behind a
 *    cheerful green line. The fix is one character, and the guard against it
 *    returning is `routes every citation to a corpus file that exists on disk`
 *    below, which is why that test is worth more than it looks.
 *
 *    THE SAME HOLE IS OPEN ON FORM 941 TODAY. Its four instruction cites read
 *    "IRS, Instructions for Form 941, line 1 (...)" — comma, and no year at
 *    all. They do not route either. That is books-40's debt, not this slice's,
 *    and standing rule 4 says one feature per pull request, so it is RECORDED
 *    here rather than silently fixed in a 940 branch. It is on the scratch plan.
 *
 * B. AN UNMERGED MODULE IS UNVERIFIED BY CONSTRUCTION. The verifier walks the
 *    central registry. A leaf authorities module that exports perfectly and is
 *    never merged into `books-guidance-core` is not "wired later" — it is
 *    invisible to the only thing that would have checked it. books-34 lost
 *    seven authorities exactly this way. Hence the registration test.
 *
 * ── WHAT THIS FILE ASSERTS ────────────────────────────────────────────────
 *
 * Standing rule 39 says a self-check that re-implements the gate tests nothing.
 * So this file does NOT write its own matcher. It imports `quoteSegments`,
 * `matchesInOrder` and `sourceFileFor` from the real verifier, so what is
 * proven failable here is the same code that guards the repo.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FORM_940_ELISION,
  FORM_940_OWN_AUTHORITIES,
  FORM_940_REUSED_AUTHORITY_IDS,
  FORM_940_SOURCE_PATH,
  FORM_940_SOURCE_YEAR,
  I940_CREDIT_REQUIRES_TIMELY_STATE_PAYMENT,
  I940_IRS_WORKSHEET_EXAMPLE,
  I940_WORKSHEET_LINE_10,
  findForm940Authority,
  form940Authorities,
} from "@/lib/payroll/form-940-authorities";
import {
  ALL_SOURCE_REGISTRIES,
  findGuidanceAuthority,
} from "@/lib/accounting/books-guidance-core";
import {
  matchesInOrder,
  quoteSegments,
  sourceFileFor,
} from "../../scripts/verify-verbatim-quotes";

/**
 * The same normalisation the central verifier applies to both sides, reduced to
 * the parts that matter for this corpus: collapse whitespace, and render the
 * PDF's curly punctuation as ASCII.
 *
 * Applied to the SOURCE and to the QUOTE identically, so neither side is given
 * latitude the other lacks.
 */
function normalise(s: string): string {
  return s
    .replace(/\u2019/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const CORPUS = normalise(readFileSync(join(process.cwd(), FORM_940_SOURCE_PATH), "utf8"));

describe("books-43: the Form 940 corpus is real and non-trivial", () => {
  /**
   * RULE 39 VACUITY GUARD. Every test below searches CORPUS. If the mirrored
   * file were missing, empty, or replaced with a stub, `includes()` would
   * return false everywhere and the suite would go red — but if some future
   * refactor made CORPUS the empty string only where it is CONVENIENT, a
   * `.includes("")` style check would pass trivially. Anchor the corpus first.
   */
  it("has mirrored the real IRS instructions, not a placeholder", () => {
    expect(CORPUS.length).toBeGreaterThan(50_000);
    expect(CORPUS).toContain("Instructions for Form 940");
    expect(CORPUS).toContain("Worksheet");
  });

  it("states the source year it was extracted from", () => {
    expect(FORM_940_SOURCE_YEAR).toBe(2025);
    // The year is load-bearing: it selects the filename. If the constant and
    // the path ever disagree, the quotes are being checked against a revision
    // nobody claimed to be reading.
    expect(FORM_940_SOURCE_PATH).toContain(String(FORM_940_SOURCE_YEAR));
  });

  /**
   * THE YEAR MISMATCH, SURFACED AS A TEST RATHER THAN A COMMENT.
   *
   * Greenway's first payroll is 1 January 2027, so the first Form 940 Michael
   * files will be the 2027 revision. This module quotes the 2025 revision
   * because that is what was published when it was written. That is a fact with
   * an expiry date, and the honest way to hold it is to make the software state
   * the revision on screen rather than let anyone assume it is current.
   */
  it("is honest that the mirrored revision predates Greenway's first filing", () => {
    const FIRST_PAYROLL_YEAR = 2027;
    expect(FORM_940_SOURCE_YEAR).toBeLessThan(FIRST_PAYROLL_YEAR);
  });
});

describe("books-43: every Form 940 quote is verbatim", () => {
  /**
   * THE CORE GUARANTEE, run through the REAL verifier primitives rather than a
   * local re-implementation (rule 39).
   */
  it("every quote appears in the mirrored source, segment by segment, in order", () => {
    for (const a of FORM_940_OWN_AUTHORITIES) {
      const segments = quoteSegments(normalise(a.quote));
      expect(segments, `${a.id}: an elided segment is too short to prove anything`).not.toBeNull();
      expect(
        matchesInOrder(CORPUS, segments as string[]),
        `${a.id}: quote does not appear in ${FORM_940_SOURCE_PATH}`,
      ).toBe(true);
    }
  });

  /**
   * THE ROUTING GUARD — hole (A) above. A citation the corpus router cannot
   * parse is not checked by the central verifier at all; it is SKIPPED and
   * reported as "no local copy". This asserts every 940 cite resolves to a file
   * that exists, so the comma defect cannot come back.
   */
  it("routes every citation to a corpus file that exists on disk", () => {
    for (const a of FORM_940_OWN_AUTHORITIES) {
      expect(a.cite, `${a.id} cite must be routable`).toMatch(
        /^IRS Instructions for Form 940 \(2025\), /,
      );
      const routed = sourceFileFor(a.cite);
      expect(routed, `${a.id}: cite "${a.cite}" routes to no mirrored file`).not.toBeNull();
      expect(routed as string).toContain("irs-instructions-940-2025.txt");
    }
  });

  /**
   * THE REGISTRATION GUARD — hole (B) above. An authorities module that never
   * reaches the central registry is unverified by construction.
   */
  it("registers every Form 940 authority into the one guidance registry", () => {
    const missing = FORM_940_OWN_AUTHORITIES.filter(
      (a) => findGuidanceAuthority(a.id) === undefined,
    ).map((a) => a.id);
    expect(missing).toEqual([]);
  });

  it("declares its own source-registry tag", () => {
    expect(ALL_SOURCE_REGISTRIES).toContain("form-940");
  });

  /**
   * DEFECT 4 — THE INSERTED WORD. A verbatim panel is worth nothing if the
   * reader can find one invented parenthesis, so this asserts the specific
   * abbreviation that was wrongly added is still absent, AND asserts the
   * general property that produced it.
   */
  it("does not insert abbreviations the IRS did not write", () => {
    const dol = findForm940Authority("i940-credit-reduction-state");
    expect(dol).toBeDefined();
    expect(dol?.quote).toContain("The U.S. Department of Labor determines these states");
    expect(dol?.quote).not.toContain("(DOL)");
  });

  /**
   * DEFECT 3 — THE TRUNCATION THAT CHANGED THE LAW.
   *
   * Asserted as a SPECIFIC fact because the specific fact is what the engine
   * depends on. If someone shortens this sentence again, the engine's whole
   * treatment of late state payments becomes wrong, and this line goes red
   * before the arithmetic does.
   */
  it("keeps the clause that anchors the credit deadline to Form 940, not the state", () => {
    const q = I940_CREDIT_REQUIRES_TIMELY_STATE_PAYMENT.quote;
    expect(q).toContain("paid all state unemployment tax by the due date of your Form 940");
    // The second escape hatch in the same sentence, which the truncation also
    // destroyed: a 0% experience rate still earns the maximum credit.
    expect(q).toContain("due to your state experience rate");
    // And the sentence must not end at "by the due date." — the truncation.
    expect(q).not.toMatch(/by the due date\.\s*$/);
  });

  /**
   * DEFECT 3, GENERALISED — rule 23, fix the class not the instance.
   *
   * A truncated quote is still a valid substring, so presence proves nothing
   * about completeness. This walks each quote's FINAL segment, finds where it
   * sits in the corpus, and reads the next character in the source. If the
   * quote stops mid-sentence — the next source character is a lowercase letter
   * or a comma — the quote ended somewhere the author did not.
   *
   * Deliberately permissive about what may FOLLOW a legitimate ending: a full
   * stop, a bullet, a digit (the next numbered line), a capital letter. The
   * test targets the one signature that is always wrong.
   */
  it("no quote stops in the middle of a sentence", () => {
    for (const a of FORM_940_OWN_AUTHORITIES) {
      const segments = quoteSegments(normalise(a.quote)) as string[];
      const last = segments[segments.length - 1];
      const at = CORPUS.lastIndexOf(last);
      expect(at, `${a.id}: final segment not located`).toBeGreaterThanOrEqual(0);
      const after = CORPUS.slice(at + last.length, at + last.length + 1);
      expect(
        /^[a-z,]/.test(after),
        `${a.id}: quote ends mid-sentence — the source continues "${CORPUS.slice(
          at + last.length,
          at + last.length + 60,
        )}"`,
      ).toBe(false);
    }
  });

  /**
   * DEFECT 5 — THE FABRICATED QUOTE MADE OF GENUINE PARTS.
   *
   * The worked-example quote had a sentence spliced in from an unrelated
   * example two hundred lines away. Every fragment was real; the assembly was
   * not. `matchesInOrder` catches the ordering, but not proximity — two real
   * sentences a thousand lines apart still appear "in order".
   *
   * So this asserts LOCALITY: for a single-segment quote, the whole thing must
   * appear as ONE contiguous run, which it does by definition; and for an
   * elided quote, the gap the "..." conceals must be small enough to be a page
   * header or a form field, not a different section of the document.
   */
  it("an elision hides a page header, not a different part of the document", () => {
    const MAX_ELIDED_CHARS = 1_200;
    for (const a of FORM_940_OWN_AUTHORITIES) {
      const segments = quoteSegments(normalise(a.quote)) as string[];
      if (segments.length < 2) continue;
      let from = 0;
      let previousEnd = -1;
      for (const seg of segments) {
        const at = CORPUS.indexOf(seg, from);
        expect(at, `${a.id}: segment not found`).toBeGreaterThanOrEqual(0);
        if (previousEnd >= 0) {
          const gap = at - previousEnd;
          expect(
            gap,
            `${a.id}: an elision skips ${gap} characters — too far to be a page header. ` +
              `Skipped text begins: "${CORPUS.slice(previousEnd, previousEnd + 120)}"`,
          ).toBeLessThanOrEqual(MAX_ELIDED_CHARS);
        }
        previousEnd = at + seg.length;
        from = previousEnd;
      }
    }
  });

  /**
   * RULE 15 / 39 — PROVE THE GUARD ABOVE CAN ACTUALLY FAIL.
   *
   * If the locality check silently stopped examining anything, every test above
   * would still pass. So run the same primitives against a deliberately
   * fabricated quote: two real sentences from opposite ends of the document,
   * joined by an elision. `matchesInOrder` must ACCEPT it (that is the hole),
   * and the locality measurement must REJECT it (that is the patch).
   */
  it("the locality guard rejects a quote assembled from distant real sentences", () => {
    const first = "This $7,000 is called the FUTA wage base.";
    const second = "Less than $1, you don't have to pay it.";
    expect(CORPUS).toContain(first);
    expect(CORPUS).toContain(second);

    const fabricated = [first, second];
    // The ordering check is fooled — which is precisely why locality is needed.
    expect(matchesInOrder(CORPUS, fabricated)).toBe(true);

    const gap = CORPUS.indexOf(second) - (CORPUS.indexOf(first) + first.length);
    expect(gap).toBeGreaterThan(1_200);
  });
});

describe("books-43: the authority set is complete and correctly weighted", () => {
  it("carries every authority this slice researched", () => {
    // 18 from books-43, plus the three line-level passages books-47 added so
    // that the lessons for lines 3, 7 and 17 carry authority of their own
    // rather than teaching on my say-so (standing rule 24).
    //
    // books-54 added THIRTEEN more, taking this to 34. Twelve of them are the
    // lines that were on the printed form with nothing at all behind them --
    // 1a, 1b, 2, 4a, 4b, 4c, 4d, 4e, 15b, 15c, 15d, 15e -- plus line 4 itself,
    // which was classified in the ownership table but had never been quoted.
    //
    // This count is deliberately a hard number rather than a `toBeGreaterThan`.
    // A floor would let an authority be DELETED and replaced with two others
    // while the test stayed green, and the whole point of the number is that
    // removing a quote should require someone to say so out loud.
    expect(FORM_940_OWN_AUTHORITIES.length).toBe(34);
  });

  /**
   * THE TWELVE LINES THAT HAD NOTHING BEHIND THEM (books-54).
   *
   * The count above says "34" but says nothing about WHICH lines are covered,
   * so on its own it would be satisfied by thirteen more quotes about line 3.
   * This names the twelve lines the slice existed to close, and asserts each
   * one now has an authority whose cite mentions it.
   *
   * Rule 39: a test that cannot see the thing it approves, approves nothing.
   * Matching on the cite rather than on an id spelling means renaming a
   * constant cannot make this pass vacuously.
   */
  it("now carries an authority for each of the twelve lines that had none", () => {
    const LINES_CLOSED_BY_BOOKS_54 = [
      "1a",
      "1b",
      "2",
      "4a",
      "4b",
      "4c",
      "4d",
      "4e",
      "15b",
      "15c",
      "15d",
      "15e",
    ] as const;
    const uncovered: string[] = [];
    for (const line of LINES_CLOSED_BY_BOOKS_54) {
      // The cite tail begins with the line number followed by ". " for the
      // lettered lines, or is the named heading for line 2.
      const found = FORM_940_OWN_AUTHORITIES.some((a) =>
        new RegExp(`\\(2025\\), ${line}\\. `).test(a.cite),
      );
      const namedHeading =
        line === "2" &&
        FORM_940_OWN_AUTHORITIES.some((a) =>
          a.cite.includes("2. If You Paid Wages in a State That Is Subject to Credit Reduction"),
        );
      if (!found && !namedHeading) uncovered.push(line);
    }
    expect(uncovered).toEqual([]);
  });

  /**
   * RULE 15 -- PROVE THE TEST ABOVE CAN FAIL.
   *
   * The regexp above is the kind of check that silently matches nothing if the
   * cite format shifts by one character. So assert a line that is NOT on Form
   * 940 is reported as uncovered by the identical logic.
   */
  it("would notice a line that has no authority", () => {
    const NOT_ON_THE_FORM = "23";
    const found = FORM_940_OWN_AUTHORITIES.some((a) =>
      new RegExp(`\\(2025\\), ${NOT_ON_THE_FORM}\\. `).test(a.cite),
    );
    expect(found).toBe(false);
  });

  it("has unique ids", () => {
    const ids = FORM_940_OWN_AUTHORITIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * DEFECT 1 — THE ILLEGAL `kind`. Form instructions are the IRS's reading of
   * its own form. They are persuasive, not binding, and the badge must say so:
   * `irs_guidance` renders as "IRS guidance" at weight 1. Calling them
   * `statute` would dress an IRS opinion as law.
   */
  it("classifies instructions as IRS guidance, not as statute", () => {
    for (const a of FORM_940_OWN_AUTHORITIES) {
      expect(a.kind, `${a.id}`).toBe("irs_guidance");
    }
  });

  it("every record is substantive and attributed", () => {
    for (const a of FORM_940_OWN_AUTHORITIES) {
      expect(a.cite.trim().length, `${a.id}: cite`).toBeGreaterThan(0);
      expect(a.quote.trim().length, `${a.id}: quote`).toBeGreaterThanOrEqual(40);
      expect(a.soWhat.trim().length, `${a.id}: soWhat`).toBeGreaterThan(0);
      expect(a.source, `${a.id}: source`).toMatch(/^https:\/\/www\.irs\.gov\//);
    }
  });

  /**
   * RULE 25 — EXTEND, DON'T DUPLICATE. The three FUTA statutes already live in
   * `payroll-tax-authorities`. This module must BORROW them, never restate
   * them, or a citation would mean two things depending on which screen the
   * reader was on.
   */
  it("borrows the FUTA statutes instead of redeclaring them", () => {
    const own = new Set(FORM_940_OWN_AUTHORITIES.map((a) => a.id));
    for (const id of FORM_940_REUSED_AUTHORITY_IDS) {
      expect(own.has(id), `${id} is borrowed and must not be redeclared here`).toBe(false);
      expect(findGuidanceAuthority(id), `${id} must resolve in the registry`).toBeDefined();
    }
  });

  it("returns own plus borrowed, deduplicated, from one call", () => {
    const all = form940Authorities();
    expect(all.length).toBe(FORM_940_OWN_AUTHORITIES.length + FORM_940_REUSED_AUTHORITY_IDS.length);
    const ids = all.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of FORM_940_REUSED_AUTHORITY_IDS) expect(ids).toContain(id);
  });

  it("finds a known id and misses an unknown one", () => {
    expect(findForm940Authority("i940-who-must-file")).toBeDefined();
    expect(findForm940Authority("irc-3301-futa-rate")).toBeDefined();
    expect(findForm940Authority("definitely-not-real")).toBeUndefined();
  });

  /**
   * The teaching thesis of the whole module, asserted so it cannot be edited
   * out: the 6% rate and the conditional credit must BOTH be reachable, because
   * a reader who only meets 0.6% has not understood the form.
   */
  it("teaches the 6% statutory rate and the conditional credit together", () => {
    const all = form940Authorities();
    const text = all.map((a) => `${a.quote} ${a.soWhat}`).join(" ");
    expect(text).toContain("6 percent");
    expect(text).toContain("5.4%");
    expect(text).toMatch(/90 percent|0\.900/);
  });
});

describe("books-43: the IRS's own worked example is preserved exactly", () => {
  /**
   * WHY THESE NUMBERS ARE HERE AT ALL.
   *
   * The instructions print a fully worked Worksheet-Line 10 with every
   * intermediate figure. That makes it an ORACLE rather than an illustration:
   * if the engine reproduces all seven lines from the same inputs, the
   * implementation matches the IRS's own arithmetic, and if it does not, the
   * engine is wrong with no room for a difference of opinion.
   *
   * `form-940-core` will be built against these figures. Transcribing them into
   * the core's test file separately would create two copies that can drift, so
   * they live once, here, and both sides read them.
   */
  const E = I940_IRS_WORKSHEET_EXAMPLE;

  it("transcribes each figure as the IRS printed it", () => {
    // Every one of these dollar strings must be findable in the source, which
    // is what makes this a transcription rather than an assertion of belief.
    for (const printed of [
      "$21,000.00",
      "$ 8,000.00",
      "$100.00",
      "$78.00",
      "$150.00",
      "$1,134.00",
      "$104.00",
      "$204.00",
      "$930.00",
      "$70.20",
      "$274.20",
      "$859.80",
    ]) {
      expect(CORPUS, `the IRS example should print ${printed}`).toContain(printed);
    }
  });

  it("stores every figure in integer cents", () => {
    for (const [k, v] of Object.entries(E)) {
      if (k.endsWith("Bps")) continue;
      expect(Number.isInteger(v), `${k} must be integer cents`).toBe(true);
    }
  });

  /**
   * THE WORKSHEET'S OWN ARITHMETIC, CHECKED AGAINST THE IRS'S ANSWERS.
   *
   * This is not the engine — the engine does not exist yet. It is proof that
   * the figures recorded above are INTERNALLY CONSISTENT, so a typo in the
   * transcription cannot become the oracle the engine is later measured
   * against. A wrong oracle is worse than no oracle: it makes a broken engine
   * look correct.
   */
  it("line 1 is taxable FUTA wages at the 5.4% maximum credit rate", () => {
    expect(Math.round((E.taxableFutaWagesCents * 54) / 1000)).toBe(E.line1MaximumCreditCents);
  });

  it("line 3 is the shortfall between 5.4% and the assigned experience rate", () => {
    // 5.4% = 540 bps; experience rate 410 bps; computation rate 130 bps.
    const computationRateBps = 540 - E.experienceRateBps;
    expect(computationRateBps).toBe(130);
    expect(Math.round((E.taxableStateWagesCents * computationRateBps) / 10_000)).toBe(
      E.line3AdditionalCreditCents,
    );
  });

  it("line 4 is timely credit plus additional credit", () => {
    expect(E.line2TimelyCreditCents + E.line3AdditionalCreditCents).toBe(E.line4SubtotalCents);
  });

  it("line 5a is the credit still unclaimed after line 4", () => {
    expect(E.line1MaximumCreditCents - E.line4SubtotalCents).toBe(E.line5aRemainingCreditCents);
  });

  it("line 5c takes the SMALLER of the remaining credit and the late payment", () => {
    expect(Math.min(E.line5aRemainingCreditCents, E.line5bPaidLateCents)).toBe(E.line5cSmallerCents);
  });

  it("line 5d haircuts the late credit to 90 percent", () => {
    expect(Math.round((E.line5cSmallerCents * 900) / 1000)).toBe(E.line5dLateCreditCents);
  });

  it("line 6 is the credit actually earned", () => {
    expect(E.line4SubtotalCents + E.line5dLateCreditCents).toBe(E.line6FutaCreditCents);
  });

  it("line 7 is the credit LOST, which is what increases the tax", () => {
    expect(E.line1MaximumCreditCents - E.line6FutaCreditCents).toBe(E.line7AdjustmentCents);
  });

  /**
   * THE POINT OF THE WHOLE EXAMPLE, IN ONE ASSERTION.
   *
   * The employer could have had $1,134.00 of credit. It earned $274.20. The
   * $859.80 difference is added to its federal tax — for wages it had already
   * reported correctly, purely because of what happened with the STATE.
   *
   * Michael should be able to read that number and understand that FUTA is not
   * really a 0.6% tax. It is a 6% tax with a discount he has to keep earning.
   */
  it("shows the credit lost being added back to the federal tax", () => {
    expect(E.line7AdjustmentCents).toBe(85_980);
    expect(E.line7AdjustmentCents).toBeGreaterThan(E.line6FutaCreditCents);
  });

  it("quotes the worksheet's own late-credit factor rather than paraphrasing it", () => {
    expect(I940_WORKSHEET_LINE_10.quote).toContain("line 5c x 0.900 = line 5d");
    expect(I940_WORKSHEET_LINE_10.quote).toContain("Which is smaller, line 5a or line 5b?");
  });
});

describe("books-43: elision discipline", () => {
  /**
   * The module exports the marker it uses so this test and the module cannot
   * drift apart on what an elision looks like — if someone switched the module
   * to a unicode ellipsis, the central verifier (which splits on three ASCII
   * dots) would stop seeing the segments and would compare the whole string,
   * including the ellipsis, against a source that does not contain it. That
   * fails loudly, which is correct, but this states the contract directly.
   */
  it("uses the same elision marker the verifier splits on", () => {
    expect(FORM_940_ELISION).toBe(" ... ");
    const usesElision = FORM_940_OWN_AUTHORITIES.filter((a) => a.quote.includes("..."));
    expect(usesElision.length).toBeGreaterThan(0);
    for (const a of usesElision) {
      expect(a.quote, `${a.id} must not use a unicode ellipsis`).not.toContain("\u2026");
    }
  });
});
