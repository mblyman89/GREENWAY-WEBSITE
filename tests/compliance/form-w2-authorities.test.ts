/**
 * books-43 — THE W-2 / W-3 AUTHORITIES, AND THE TWO DEFECTS THIS FILE CAUGHT.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `form-940-authorities.test.ts` opens by saying the central verifier "only
 * sees what the registry hands it, and it skips what it cannot route". This
 * module found the NEXT layer of that same problem, twice, and both failures
 * produced a green line of output:
 *
 * ── DEFECT 1: A BORROWED ID THAT DID NOT EXIST ────────────────────────────
 *
 * `FORM_W2_REUSED_IDENTITY_AUTHORITY_IDS` listed
 * `"iw2w3-2026-employer-contact-person"`. There is no such authority. The real
 * id is `"iw2w3-2026-w3-contact-person"`. The list was written from memory of
 * what the authority is ABOUT rather than from reading its id.
 *
 * `formW2Authorities()` does `FILTER(a => LIST.includes(a.id))`. A filter
 * looking for something that is not there does not throw — it returns a
 * shorter array. A runtime probe returned 40 authorities where 41 were
 * intended, with no error anywhere.
 *
 *   A REUSED ID THAT DOES NOT EXIST IS INDISTINGUISHABLE FROM ONE THAT WAS
 *   NEVER LISTED.
 *
 * That is the defect class, and it is invisible to `tsc` (the list is
 * `readonly string[]`; every string is a valid string), invisible to the
 * verbatim verifier (which only walks quotes that ARE present), and invisible
 * to any test asserting merely that `formW2Authorities()` "returns something".
 * Hence `every borrowed id resolves to a real authority` below, which asserts
 * RESOLUTION rather than existence, and the count test that pins 28 + 13 = 41.
 *
 * ── DEFECT 2: `source` WAS A FILE PATH, AND `source` IS AN href ────────────
 *
 * All 28 authorities set `source` to the repo-relative path of the mirrored
 * corpus file. But `CompanyInformationForm.tsx` renders `href={a.source}`
 * under the words "Read the original", and `AuthorityPanel.tsx` prints
 * "Source: {authority.source}". Twenty-eight dead links.
 *
 * Nothing in the repo would have caught it. `verify-verbatim-quotes` routes on
 * `.cite` and NEVER READS `.source`. The only registry-wide assertion on the
 * field is that it is non-empty — and a repo-relative path is gloriously
 * non-empty. What exposed it was that the six BORROWED identity authorities
 * quote the same IRS document and link to `irs.gov`: half the citations to one
 * document would have worked and half would not.
 *
 * The fix separates two facts that had been sharing one field: PATH constants
 * locate the mirrored copy for the verifier, URL constants tell Michael where
 * to read the real thing. The guard is `every source is a resolvable URL`.
 *
 * ── THE THING THIS MODULE MUST NOT LET ANYONE "FIX" ───────────────────────
 *
 * TRAP 1. Michael owns 85% of an S corporation. Company-paid health premiums
 * are wages for income tax (box 1) but are carved out of FICA by
 * §3121(a)(2)(B) (boxes 3 and 5). So BOX 1 LEGITIMATELY EXCEEDS BOXES 3 AND 5
 * on his W-2. That looks like an error, it is not an error, and a future
 * maintainer "correcting" it would misreport his wages. Asserted below so the
 * authorities proving it can never both disappear.
 *
 * TRAP 2. Washington has no personal income tax, so BOX 17 MUST BE BLANK.
 * PFML and WA Cares are employee deductions but they are NOT state income tax;
 * they belong in box 14. Putting them in box 17 would tell the IRS Michael's
 * employees paid a state income tax that does not exist.
 *
 * RULE 39 — this file does NOT write its own matcher. It imports
 * `quoteSegments`, `matchesInOrder` and `sourceFileFor` from the real
 * verifier, so what is proven failable here is the code that guards the repo.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  FORM_W2_ELISION,
  FORM_W2_OWN_AUTHORITIES,
  FORM_W2_REUSED_IDENTITY_AUTHORITY_IDS,
  FORM_W2_REUSED_YTD_AUTHORITY_IDS,
  FORM_W2_SOURCE_PATH,
  FORM_W2_SOURCE_URL,
  FORM_W2_SOURCE_YEAR,
  IRC_6051_A_ITEMS,
  IRC_6051_A_REQUIREMENT,
  IRC_6051_SOURCE_PATH,
  IRC_6051_SOURCE_URL,
  IW2W3_2026_BOX_1_INCLUDES_SCORP_HEALTH,
  IW2W3_2026_BOX_3_SCORP_HEALTH_CARVE_OUT,
  IW2W3_2026_BOXES_15_20_STATE_LOCAL,
  IW2W3_2026_PAYEE_STATEMENT_PENALTY_6722,
  IW2W3_2026_RECONCILE_941_APPROXIMATELY_TWICE,
  W2_BOX_4_CEILING_2026_CENTS,
  W3_TO_941_FICA_DOUBLING_FACTOR,
  findFormW2Authority,
  formW2Authorities,
} from "@/lib/payroll/form-w2-authorities";
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
 * The same normalisation the central verifier applies to both sides: collapse
 * whitespace, render curly punctuation as ASCII. Applied to SOURCE and QUOTE
 * identically, so neither side is given latitude the other lacks.
 */
function normalise(s: string): string {
  return s
    .replace(/\u2019/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * TWO CORPORA, NOT ONE — which is what makes this module different from 940.
 *
 * Twenty-six quotes come from the IRS instructions; two come from the statute
 * that makes the W-2 exist at all. A single-corpus test would have to either
 * skip the statute quotes or check them against the wrong file, and "check
 * against the wrong file" fails loudly while "skip" does not. So each
 * authority is routed by its own cite, exactly as the verifier routes it.
 */
const INSTRUCTIONS = normalise(readFileSync(join(process.cwd(), FORM_W2_SOURCE_PATH), "utf8"));
const STATUTE = normalise(readFileSync(join(process.cwd(), IRC_6051_SOURCE_PATH), "utf8"));

/**
 * ═══ books-55 REWROTE THIS, AND THE OLD VERSION IS WORTH KEEPING IN VIEW. ═══
 *
 * It used to be one line:
 *
 *   return cite.startsWith("26 U.S.C.") ? STATUTE : INSTRUCTIONS;
 *
 * Two corpora, hardcoded, because when books-43 wrote it there were exactly two
 * and both were §6051. books-55 added quotes from §3121 and §3306 — and this
 * function cheerfully checked them against §6051, where of course they are not
 * found. Five tests in this file failed at once with messages like "segment not
 * found" and "expected ... to contain 'usc-6051.txt'".
 *
 * THE FAILURES WERE THE GOOD OUTCOME. Note which way this broke: it did not
 * skip the new quotes, it checked them against the WRONG BOOK and said so
 * loudly. The comment above these constants had made that choice deliberately —
 * "'check against the wrong file' fails loudly while 'skip' does not" — and
 * two slices later that decision is what stopped three unverified statutory
 * quotes from shipping behind a green tick. Had the original taken the softer
 * option, this file would still be reporting 28 verified authorities.
 *
 * The replacement stops hardcoding the corpus list. It asks the REAL router
 * where a cite goes, reads that file, and caches it. So the next slice to quote
 * a fourth statute needs no edit here — and if the router cannot place a cite,
 * that is a hard failure rather than a default (rule 62d: never invent a
 * default; the old `: INSTRUCTIONS` fallback was exactly that).
 */
const CORPUS_CACHE = new Map<string, string>();

function corpusFor(cite: string): string {
  const routed = sourceFileFor(cite);
  if (routed === null) {
    throw new Error(
      `form-w2-authorities.test: cite "${cite}" routes to no mirrored corpus file, so there is ` +
        `nothing to verify the quote against. This function used to fall back to the W-2 ` +
        `instructions for any cite it did not recognise, which meant an unroutable statute cite ` +
        `was silently checked against the wrong book. Add a router entry in ` +
        `scripts/verify-verbatim-quotes.ts, or mirror the source.`,
    );
  }
  const cached = CORPUS_CACHE.get(routed);
  if (cached !== undefined) return cached;
  const text = normalise(readFileSync(routed, "utf8"));
  CORPUS_CACHE.set(routed, text);
  return text;
}

describe("books-43: both W-2 corpora are real and non-trivial", () => {
  /**
   * RULE 39 VACUITY GUARD. Every test below searches a corpus. If a mirrored
   * file were missing, empty or stubbed, `includes()` would be false
   * everywhere and the suite would go red — but anchoring the corpora first
   * means a future refactor cannot make them empty only where convenient.
   */
  it("has mirrored the real IRS instructions, not a placeholder", () => {
    expect(INSTRUCTIONS.length).toBeGreaterThan(150_000);
    expect(INSTRUCTIONS).toContain("Forms W-2 and W-3");
    expect(INSTRUCTIONS).toContain("Box 1—Wages, tips, other compensation");
  });

  it("has mirrored the real statute, not a placeholder", () => {
    expect(STATUTE.length).toBeGreaterThan(20_000);
    expect(STATUTE).toContain("26 U.S.C.");
    expect(STATUTE).toContain("6051");
  });

  /**
   * THE TWO CORPORA MUST ACTUALLY BE DIFFERENT DOCUMENTS. If a path typo made
   * both constants point at the same file, `corpusFor` would still "work" for
   * the 26 instruction quotes and the two statute quotes would be checked
   * against the wrong document — where they would simply not be found. This
   * makes the distinctness explicit rather than incidental.
   */
  it("the statute and the instructions are two different documents", () => {
    expect(FORM_W2_SOURCE_PATH).not.toBe(IRC_6051_SOURCE_PATH);
    expect(STATUTE).not.toBe(INSTRUCTIONS);
  });

  it("states the source year it was extracted from", () => {
    expect(FORM_W2_SOURCE_YEAR).toBe(2026);
    // The year is load-bearing: it selects the filename. If the constant and
    // the path disagree, the quotes are checked against a revision nobody
    // claimed to be reading.
    expect(FORM_W2_SOURCE_PATH).toContain(String(FORM_W2_SOURCE_YEAR));
  });

  /**
   * THE YEAR MISMATCH, SURFACED AS A TEST RATHER THAN A COMMENT.
   *
   * Greenway's first payroll is 1 January 2027, so the first W-2s Michael
   * issues will be the 2027 revision. Every DOLLAR THRESHOLD quoted in this
   * module — the wage base, the $11,439 box 4 ceiling, the penalty bands — is
   * inflation-indexed and WILL change. The RULES do not.
   */
  it("is honest that the mirrored revision predates Greenway's first filing", () => {
    const FIRST_PAYROLL_YEAR = 2027;
    expect(FORM_W2_SOURCE_YEAR).toBeLessThan(FIRST_PAYROLL_YEAR);
  });
});

describe("books-43: every W-2 quote is verbatim", () => {
  /**
   * THE CORE GUARANTEE, run through the REAL verifier primitives rather than a
   * local re-implementation (rule 39), against whichever of the two corpora
   * the citation names.
   */
  it("every quote appears in its own mirrored source, segment by segment, in order", () => {
    for (const a of FORM_W2_OWN_AUTHORITIES) {
      const segments = quoteSegments(normalise(a.quote));
      expect(segments, `${a.id}: an elided segment is too short to prove anything`).not.toBeNull();
      expect(
        matchesInOrder(corpusFor(a.cite), segments as string[]),
        `${a.id}: quote does not appear in its cited source`,
      ).toBe(true);
    }
  });

  /**
   * THE ROUTING GUARD. A citation the corpus router cannot parse is not
   * checked by the central verifier at all; it is SKIPPED and reported as "no
   * local copy". That hole swallowed seventeen Form 940 quotes because of a
   * single comma after "IRS". Both cite shapes used here must route to a file
   * that EXISTS ON DISK.
   */
  it("routes every citation to a corpus file that exists on disk", () => {
    for (const a of FORM_W2_OWN_AUTHORITIES) {
      const routed = sourceFileFor(a.cite);
      expect(routed, `${a.id}: cite "${a.cite}" routes to no mirrored file`).not.toBeNull();
      expect(existsSync(routed as string), `${a.id}: routed file missing`).toBe(true);
    }
  });

  /**
   * ...AND ROUTES TO THE RIGHT ONE. `existsSync` only proves a file was found,
   * not that it is the correct file. Statute cites must reach the statute;
   * instruction cites must reach the instructions.
   */
  it("routes statute cites and instruction cites to different files", () => {
    /*
     * books-55 GENERALISED THIS. It used to assert that every "26 U.S.C." cite
     * routes to `usc-6051.txt`, which was true when §6051 was the only statute
     * quoted here and became false the moment §3121 and §3306 were added. The
     * assertion was really two claims wearing one coat: "statutes go to the
     * statute corpus" (durable) and "the statute is §6051" (an inventory fact
     * that changes every time the module learns something).
     *
     * Now it derives the expected filename FROM THE CITE - §3121 must land in
     * usc-3121.txt, not merely in some file under federal/ - so it still fails
     * if the router truncates a section number, which is the books-20 §280E bug
     * this test exists to prevent.
     */
    for (const a of FORM_W2_OWN_AUTHORITIES) {
      const routed = sourceFileFor(a.cite) as string;
      const usc = /^26 U\.S\.C\. §(\d+[A-Z]?)/.exec(a.cite);
      if (usc) {
        expect(routed, `${a.id} must reach the statute it cites, not another statute`).toContain(
          `usc-${usc[1]}.txt`,
        );
        continue;
      }
      if (a.cite.startsWith("IRS, ")) {
        /*
         * An IRS WEB PAGE rather than a numbered publication. books-55 mirrored
         * one - the S corporation medical insurance page - instead of exempting
         * it from verification, because the alternative was to leave the single
         * quote Michael is most likely to act on as the only unchecked one.
         */
        expect(routed, `${a.id} routes to a mirrored page`).toMatch(/^.+\.txt$/);
        expect(routed, `${a.id}`).not.toContain("irs-instructions-w-2-w-3-2026.txt");
        continue;
      }
      expect(a.cite, `${a.id} cite must be routable`).toMatch(
        /^IRS Instructions for Forms W-2 and W-3 \(2026\), /,
      );
      expect(routed, `${a.id}`).toContain("irs-instructions-w-2-w-3-2026.txt");
    }
  });

  /**
   * THE REGISTRATION GUARD. An authorities module that never reaches the
   * central registry is unverified BY CONSTRUCTION — the verifier walks the
   * registry, so an unmerged module is not "wired later", it is invisible to
   * the only thing that would have checked it. books-34 lost seven authorities
   * exactly this way (rule 50: dead code wearing a green check).
   */
  it("registers every W-2 authority into the one guidance registry", () => {
    const missing = FORM_W2_OWN_AUTHORITIES.filter(
      (a) => findGuidanceAuthority(a.id) === undefined,
    ).map((a) => a.id);
    expect(missing).toEqual([]);
  });

  it("declares its own source-registry tag", () => {
    expect(ALL_SOURCE_REGISTRIES).toContain("form-w2");
  });

  /**
   * DEFECT 3 FROM THE 940 SLICE, GENERALISED — rule 23, fix the class not the
   * instance. A TRUNCATED QUOTE IS STILL A PERFECT SUBSTRING, so presence
   * proves nothing about completeness. This locates each quote's final segment
   * and reads the next character in the source: if it is a lowercase letter or
   * a comma, the quote stopped somewhere the author did not.
   */
  it("no quote stops in the middle of a sentence", () => {
    for (const a of FORM_W2_OWN_AUTHORITIES) {
      const corpus = corpusFor(a.cite);
      const segments = quoteSegments(normalise(a.quote)) as string[];
      const last = segments[segments.length - 1];
      const at = corpus.lastIndexOf(last);
      expect(at, `${a.id}: final segment not located`).toBeGreaterThanOrEqual(0);
      const after = corpus.slice(at + last.length, at + last.length + 1);
      expect(
        /^[a-z,]/.test(after),
        `${a.id}: quote ends mid-sentence — the source continues "${corpus.slice(
          at + last.length,
          at + last.length + 60,
        )}"`,
      ).toBe(false);
    }
  });

  /**
   * DEFECT 5 FROM THE 940 SLICE — THE FABRICATED QUOTE MADE OF GENUINE PARTS.
   *
   * `matchesInOrder` checks ordering, not proximity: two real sentences a
   * thousand lines apart still appear "in order". So an elision must hide a
   * page header or a form field, not a different section of the document.
   */
  it("an elision hides a page header, not a different part of the document", () => {
    const MAX_ELIDED_CHARS = 1_200;
    for (const a of FORM_W2_OWN_AUTHORITIES) {
      const corpus = corpusFor(a.cite);
      const segments = quoteSegments(normalise(a.quote)) as string[];
      if (segments.length < 2) continue;
      let from = 0;
      let previousEnd = -1;
      for (const seg of segments) {
        const at = corpus.indexOf(seg, from);
        expect(at, `${a.id}: segment not found`).toBeGreaterThanOrEqual(0);
        if (previousEnd >= 0) {
          const gap = at - previousEnd;
          expect(
            gap,
            `${a.id}: an elision skips ${gap} characters — too far to be a page header. ` +
              `Skipped text begins: "${corpus.slice(previousEnd, previousEnd + 120)}"`,
          ).toBeLessThanOrEqual(MAX_ELIDED_CHARS);
        }
        previousEnd = at + seg.length;
        from = previousEnd;
      }
    }
  });

  /**
   * RULE 15 / 39 — PROVE THE LOCALITY GUARD ABOVE CAN ACTUALLY FAIL.
   *
   * If it silently stopped examining anything, every test above still passes.
   * So run the same primitives against a deliberately fabricated quote: two
   * real sentences from far apart, joined by an elision. `matchesInOrder` must
   * ACCEPT it (that is the hole) and the gap measurement must REJECT it.
   */
  it("the locality guard rejects a quote assembled from distant real sentences", () => {
    // BOTH SENTENCES MUST BE UNIQUE IN THE CORPUS. The first draft of this
    // test paired "Who must file Form W-2." with "Common Errors on Forms W-2"
    // — and the latter appears TWICE, once in the table of contents at
    // character 566, long BEFORE the first sentence. `matchesInOrder`
    // correctly returned false and the test failed for a reason that had
    // nothing to do with the property under test. A demonstration of a hole
    // has to actually go through the hole.
    const first = "Who must file Form W-2.";
    const second = "Failure to furnish correct payee statements.";
    expect(INSTRUCTIONS.split(first).length - 1, "first sentence must be unique").toBe(1);
    expect(INSTRUCTIONS.split(second).length - 1, "second sentence must be unique").toBe(1);
    expect(INSTRUCTIONS.indexOf(second)).toBeGreaterThan(INSTRUCTIONS.indexOf(first));

    // The ordering check is fooled — which is precisely why locality is needed.
    expect(matchesInOrder(INSTRUCTIONS, [first, second])).toBe(true);

    const gap = INSTRUCTIONS.indexOf(second) - (INSTRUCTIONS.indexOf(first) + first.length);
    expect(gap).toBeGreaterThan(1_200);
  });

  /**
   * THE PRESERVED PAGE-BREAK FOOTER (rule 24 — the quote is sacred).
   *
   * Two quotes run across a printed page boundary, so the IRS's own footer
   * appears mid-sentence in the text layer. It is left VERBATIM rather than
   * tidied away, because the moment a reader finds one silently "cleaned"
   * quote, every other quote becomes a maybe.
   */
  it("preserves the page-break footer instead of tidying it out", () => {
    expect(INSTRUCTIONS).toContain("General Instructions for Forms W-2 and W-3 (2026) 17");
  });
});

describe("books-43: the authority set is complete and correctly weighted", () => {
  it("carries every authority this slice researched", () => {
    /*
     * books-43 pinned 28. books-55 added three - §3121(a)(2), §3306(b)(2) and
     * the IRS S-corporation medical insurance page - and the pin failed, which
     * is the pin working.
     *
     * A RATCHET RATHER THAN AN EXACT COUNT, deliberately. An exact figure has to
     * be edited by every slice that learns something, and a number that is
     * routinely edited stops being read: the edit becomes reflex. The property
     * actually worth defending is that authorities are never LOST, and a floor
     * defends exactly that while staying silent about growth. The named checks
     * below are what pin the specific records.
     */
    expect(FORM_W2_OWN_AUTHORITIES.length).toBeGreaterThanOrEqual(31);
  });

  /**
   * books-55. THE THREE RECORDS THAT MAKE THE HEALTH-PREMIUM RULE CHECKABLE.
   *
   * Pinned by id rather than by count, because losing any one of them
   * reintroduces a specific defect this slice repaired:
   *
   *   - drop §3121(a)(2) and the box 3 instruction's "only if not excludable
   *     under section 3121(a)(2)(B)" points at nothing again - the condition
   *     that decides the answer becomes the one part no script can check;
   *   - drop §3306(b)(2) and the 940 side of the same question loses its law,
   *     leaving Form 940 line 4a resting on a web page;
   *   - drop the IRS page and the plain-English statement Michael would actually
   *     read is gone from the panel.
   */
  it("carries the statutes and guidance behind the S-corp health premium", () => {
    for (const id of [
      "irc-3121-a-2-medical-exclusion",
      "irc-3306-b-2-medical-exclusion",
      "irs-scorp-medical-not-fica-or-futa",
    ]) {
      expect(
        FORM_W2_OWN_AUTHORITIES.some((a) => a.id === id),
        `${id} has gone; the premium rule loses the source that makes it checkable`,
      ).toBe(true);
    }
  });

  /**
   * books-55. THE CONDITION MUST SURVIVE IN THE QUOTED TEXT ITSELF.
   *
   * §3121(a)(2) does not exclude medical payments. It excludes medical payments
   * made "under a plan or system established by an employer which makes
   * provision for his employees generally... or for a class or classes of his
   * employees". A quote trimmed to the medical subparagraph alone would read as
   * an unconditional exclusion and would be worse than no quote, because it
   * would carry a verbatim tick while teaching the opposite of the statute.
   *
   * This is the defect Michael caught in prose form, moved into a gate.
   */
  it("quotes the plan-or-system condition, not just the medical carve-out", () => {
    for (const id of ["irc-3121-a-2-medical-exclusion", "irc-3306-b-2-medical-exclusion"]) {
      const a = FORM_W2_OWN_AUTHORITIES.find((x) => x.id === id);
      expect(a, id).toBeDefined();
      expect(a!.quote, `${id} must carry the condition`).toContain("under a plan or system");
      expect(a!.quote, `${id} must carry the class-of-employees limb`).toContain(
        "class or classes of his employees",
      );
      expect(a!.quote, `${id} must carry the medical subparagraph`).toContain(
        "medical or hospitalization expenses",
      );
      // And the soWhat must not turn a condition into a conclusion.
      expect(a!.soWhat.toLowerCase(), `${id} soWhat must keep the question open`).toMatch(
        /if |only if|question|depends/,
      );
    }
  });

  it("has unique ids", () => {
    const ids = FORM_W2_OWN_AUTHORITIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * WEIGHT IS NOT DECORATION. Form instructions are the IRS's reading of its
   * own form: persuasive, weight 1, `irs_guidance`. A STATUTE is the law
   * Congress wrote. §6051 is why the W-2 exists at all, and dressing it as
   * "IRS guidance" — or dressing instructions as statute — would misstate to
   * Michael how much each one binds him.
   */
  it("classifies the statute as statute and the instructions as IRS guidance", () => {
    expect(IRC_6051_A_REQUIREMENT.kind).toBe("statute");
    expect(IRC_6051_A_ITEMS.kind).toBe("statute");
    /*
     * books-55 MADE THE THIRD CASE EXPLICIT INSTEAD OF LETTING IT FALL THROUGH.
     *
     * The old ternary was "starts with 26 U.S.C. ? statute : irs_guidance", so
     * when this slice added a cite beginning "IRS, S corporation compensation
     * and medical insurance issues", it landed in the else branch and was
     * required to be `irs_guidance` - which it is. THE TEST PASSED FOR THE WRONG
     * REASON. It passed because the default happened to be right, not because
     * anything had classified the new shape.
     *
     * That is the same defect as a missing case in a switch that returns a
     * plausible value: it is invisible exactly until the day the default is
     * wrong. So each of the three cite shapes is now named, and an unrecognised
     * shape FAILS rather than inheriting a guess (rule 62d).
     */
    for (const a of FORM_W2_OWN_AUTHORITIES) {
      if (a.cite.startsWith("26 U.S.C.")) {
        expect(a.kind, `${a.id}: a statute cite must be weighted as statute`).toBe("statute");
      } else if (a.cite.startsWith("IRS Instructions for Forms W-2 and W-3")) {
        expect(a.kind, `${a.id}: form instructions are the agency's view, not law`).toBe(
          "irs_guidance",
        );
      } else if (a.cite.startsWith("IRS, ")) {
        expect(a.kind, `${a.id}: a published IRS page is guidance, not law`).toBe("irs_guidance");
      } else {
        throw new Error(
          `form-w2-authorities.test: ${a.id} has cite shape "${a.cite}", which this test does ` +
            `not recognise, so its WEIGHT is unchecked. Weight is what the screen renders as ` +
            `"statute" or "IRS guidance" beside the quote - getting it wrong misstates to Michael ` +
            `how much the source binds him. Add the shape here deliberately rather than letting ` +
            `it inherit a default.`,
        );
      }
    }
  });

  it("every record is substantive and attributed", () => {
    for (const a of FORM_W2_OWN_AUTHORITIES) {
      expect(a.cite.trim().length, `${a.id}: cite`).toBeGreaterThan(0);
      expect(a.quote.trim().length, `${a.id}: quote`).toBeGreaterThanOrEqual(40);
      expect(a.soWhat.trim().length, `${a.id}: soWhat`).toBeGreaterThan(0);
    }
  });

  /**
   * ═══ DEFECT 2 — `source` IS RENDERED AS AN href. ═══
   *
   * `CompanyInformationForm.tsx` does `href={a.source}` under "Read the
   * original". A repo-relative path there is a dead link, and it is non-empty,
   * so the only registry-wide assertion on the field passes happily. This is
   * the guard: a source must be somewhere a browser can actually GO.
   */
  it("every source is a resolvable URL, not a repo-relative path", () => {
    for (const a of FORM_W2_OWN_AUTHORITIES) {
      expect(a.source, `${a.id}: source must be a URL a reader can open`).toMatch(/^https:\/\//);
      expect(a.source, `${a.id}: source must not be a repo path`).not.toContain(
        "docs/authorities/",
      );
    }
  });

  /**
   * ...AND THE URL MUST POINT AT THE DOCUMENT ACTUALLY QUOTED. "It is a URL"
   * is a weaker claim than "it is THE url". A statute quote linking to the IRS
   * instructions would be a working link to the wrong text, which is worse
   * than a broken one because nobody would notice.
   */
  it("links each quote to the document it was actually taken from", () => {
    /*
     * books-55 DERIVED THE EXPECTED URL FROM THE CITE instead of hardcoding one
     * statute. The previous form said "26 U.S.C. cites link to the §6051 URL",
     * so once §3121 was added the test demanded that a §3121 quote link to
     * §6051 - it would have enforced precisely the defect its own docblock warns
     * about: "a working link to the wrong text, which is worse than a broken one
     * because nobody would notice."
     *
     * Cornell mirrors one page per section, so the section number in the cite
     * IS the last path segment of the URL. Deriving it means a fourth statute
     * needs no edit here and a mismatched link still fails.
     */
    for (const a of FORM_W2_OWN_AUTHORITIES) {
      const usc = /^26 U\.S\.C\. §(\d+[A-Z]?)/.exec(a.cite);
      if (usc) {
        expect(a.source, `${a.id}: a §${usc[1]} quote must link to §${usc[1]}`).toBe(
          `https://www.law.cornell.edu/uscode/text/26/${usc[1]}`,
        );
      } else if (a.cite.startsWith("IRS, ")) {
        // A published IRS page links to the page. Asserted as a prefix because
        // irs.gov path segments are not derivable from a page title.
        expect(a.source, `${a.id}: an IRS page quote must link to irs.gov`).toMatch(
          /^https:\/\/www\.irs\.gov\//,
        );
        expect(a.source, `${a.id}`).not.toBe(FORM_W2_SOURCE_URL);
      } else {
        expect(a.source, `${a.id}`).toBe(FORM_W2_SOURCE_URL);
      }
    }
    expect(FORM_W2_SOURCE_URL).toBe("https://www.irs.gov/pub/irs-pdf/iw2w3.pdf");
    expect(IRC_6051_SOURCE_URL).toBe("https://www.law.cornell.edu/uscode/text/26/6051");
  });

  /**
   * CONSISTENCY WITH THE NEIGHBOURS. The six borrowed identity authorities
   * quote THIS SAME IRS DOCUMENT and render in the SAME PANEL as these 28. If
   * the two modules linked to different URLs for one document, the panel would
   * be quietly self-contradicting. This is what exposed defect 2.
   */
  it("uses the same URL for the IRS instructions as the module it borrows from", () => {
    const borrowed = findGuidanceAuthority("iw2w3-2026-box-b-ein");
    expect(borrowed, "the borrowed identity authority must resolve").toBeDefined();
    expect(borrowed?.source).toBe(FORM_W2_SOURCE_URL);
  });

  /**
   * ═══ DEFECT 1 — THE BORROWED ID THAT DID NOT EXIST. ═══
   *
   * `formW2Authorities()` FILTERS the home registries by these id lists. A
   * filter looking for an id that is not there returns a SHORTER ARRAY, not an
   * error. So this asserts RESOLUTION — every listed id must find a real
   * authority — which is the only assertion that can tell "borrowed" apart
   * from "silently absent".
   */
  it("every borrowed id resolves to a real authority", () => {
    const all = [...FORM_W2_REUSED_YTD_AUTHORITY_IDS, ...FORM_W2_REUSED_IDENTITY_AUTHORITY_IDS];
    const unresolved = all.filter((id) => findFormW2Authority(id) === undefined);
    expect(
      unresolved,
      "these ids are listed as borrowed but match no authority — the exact defect " +
        '"iw2w3-2026-employer-contact-person" caused, which cost one authority silently',
    ).toEqual([]);
  });

  /** The specific id that was wrong, and the specific id that is right. */
  it("borrows the contact-person authority under its real id", () => {
    expect(FORM_W2_REUSED_IDENTITY_AUTHORITY_IDS).toContain("iw2w3-2026-w3-contact-person");
    expect(FORM_W2_REUSED_IDENTITY_AUTHORITY_IDS).not.toContain(
      "iw2w3-2026-employer-contact-person",
    );
    expect(findFormW2Authority("iw2w3-2026-w3-contact-person")).toBeDefined();
  });

  /**
   * RULE 25 — EXTEND, DON'T DUPLICATE. Thirteen authorities already had homes
   * in `ytd-authorities` and `company-identity-authorities`. This module must
   * BORROW them, never restate them, or one citation would mean two things
   * depending which screen the reader was on.
   */
  it("borrows rather than redeclaring, and every borrowed id is in the registry", () => {
    const own = new Set(FORM_W2_OWN_AUTHORITIES.map((a) => a.id));
    for (const id of [
      ...FORM_W2_REUSED_YTD_AUTHORITY_IDS,
      ...FORM_W2_REUSED_IDENTITY_AUTHORITY_IDS,
    ]) {
      expect(own.has(id), `${id} is borrowed and must not be redeclared here`).toBe(false);
      expect(findGuidanceAuthority(id), `${id} must resolve in the registry`).toBeDefined();
    }
  });

  /**
   * THE COUNT THAT WOULD HAVE CAUGHT DEFECT 1 ON ITS OWN: own + 7 + 6.
   * The probe that found the bug returned one fewer than the sum.
   *
   * books-55 REPLACED THE LITERAL WITH THE ARITHMETIC. It used to read
   * `toBe(41)` beside `toBe(28)` for the own-count, so adding three authorities
   * failed here with "expected 44 to be 41" - a message that tells you a number
   * moved and nothing about whether anything is wrong.
   *
   * The property this test was actually built to defend is a CROSS-FOOT: the
   * one call must return every own authority plus every borrowed one, with
   * nothing lost to deduplication. Computing the expected total from its three
   * parts defends that at any size, and it still fails for the original bug -
   * a borrowed id silently dropped makes the sum disagree by one, exactly as it
   * did when the probe returned 40.
   */
  it("returns own plus borrowed, deduplicated, from one call", () => {
    const all = formW2Authorities();
    expect(FORM_W2_REUSED_YTD_AUTHORITY_IDS.length).toBe(7);
    expect(FORM_W2_REUSED_IDENTITY_AUTHORITY_IDS.length).toBe(6);
    const expectedTotal =
      FORM_W2_OWN_AUTHORITIES.length +
      FORM_W2_REUSED_YTD_AUTHORITY_IDS.length +
      FORM_W2_REUSED_IDENTITY_AUTHORITY_IDS.length;
    expect(all.length, `own ${FORM_W2_OWN_AUTHORITIES.length} + 7 borrowed YTD + 6 borrowed identity`).toBe(
      expectedTotal,
    );
    const ids = all.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      ...FORM_W2_REUSED_YTD_AUTHORITY_IDS,
      ...FORM_W2_REUSED_IDENTITY_AUTHORITY_IDS,
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("finds a known id and misses an unknown one", () => {
    expect(findFormW2Authority("irc-6051-a-w2-requirement")).toBeDefined();
    expect(findFormW2Authority("iw2w3-2026-box-1-scorp-health-premiums")).toBeDefined();
    expect(findFormW2Authority("w2-box3-wage-base-ceiling")).toBeDefined();
    expect(findFormW2Authority("definitely-not-real")).toBeUndefined();
  });
});

describe("books-43: TRAP 1 — the S-corp health premium splits box 1 from boxes 3 and 5", () => {
  /**
   * THE SINGLE MOST IMPORTANT FACT IN THIS MODULE FOR MICHAEL PERSONALLY.
   *
   * He owns 85% of an S corporation. If Greenway pays his health insurance:
   *   • BOX 1 — included. It is compensation. (Instructions, box 1, item 5.)
   *   • BOXES 3 AND 5 — excluded, by the §3121(a)(2)(B) carve-out.
   *
   * Therefore BOX 1 > BOX 3 AND BOX 1 > BOX 5 on his W-2, legitimately. Every
   * instinct says that is a bug. It is not. Both halves must stay reachable,
   * because a reader who meets only one half will "fix" the other.
   */
  it("keeps BOTH halves of the trap reachable, not just one", () => {
    const inBox1 = findFormW2Authority("iw2w3-2026-box-1-scorp-health-premiums");
    const outOfBox3 = findFormW2Authority("iw2w3-2026-box-3-scorp-health-carve-out");
    expect(inBox1, "the box 1 inclusion must be reachable").toBeDefined();
    expect(outOfBox3, "the box 3 carve-out must be reachable").toBeDefined();
  });

  it("quotes the IRS putting shareholder health premiums IN box 1", () => {
    const q = IW2W3_2026_BOX_1_INCLUDES_SCORP_HEALTH.quote;
    expect(q).toContain("2%-or-more shareholder");
    expect(q.toLowerCase()).toContain("health insurance");
  });

  /**
   * THE CARVE-OUT IS A BULLET IN A LIST, AND THE LIST'S HEADING IS THE CITE.
   *
   * The first draft asserted the quote contained "social security wages". It
   * does not — that phrase is the BOX 3 HEADING, which lives in the `cite`.
   * The quoted text is the bulleted list of items excluded from that box, and
   * the operative words are the statutory cross-reference. Asserting on the
   * heading would have been asserting on the label rather than on the law, so
   * this checks the cite for the box and the quote for the carve-out.
   */
  it("quotes the carve-out taking them OUT of social security wages", () => {
    expect(IW2W3_2026_BOX_3_SCORP_HEALTH_CARVE_OUT.cite.toLowerCase()).toContain(
      "social security wages",
    );
    const q = IW2W3_2026_BOX_3_SCORP_HEALTH_CARVE_OUT.quote;
    // The exact statutory hook that removes the premium from FICA wages.
    expect(q).toContain("section 3121(a)(2)(B)");
    expect(q).toContain("2%-or-more shareholder-employees");
    // "only if not excludable" is the conditional that makes it a carve-out
    // rather than a flat exclusion. Losing it inverts the rule.
    expect(q).toContain("but only if not excludable");
  });

  /**
   * The explanation must SAY the counter-intuitive part out loud. If the
   * soWhat text ever loses it, the authorities are still correct and the
   * teaching has failed — and the teaching is the point.
   */
  it("warns in plain English that box 1 exceeding boxes 3 and 5 is correct here", () => {
    const text = [
      IW2W3_2026_BOX_1_INCLUDES_SCORP_HEALTH.soWhat,
      IW2W3_2026_BOX_3_SCORP_HEALTH_CARVE_OUT.soWhat,
    ]
      .join(" ")
      .toLowerCase();
    expect(text).toContain("box 1");
    expect(text).toMatch(/box 3|box 5/);
  });
});

describe("books-43: TRAP 2 — Washington has no income tax, so box 17 stays blank", () => {
  /**
   * Boxes 15–20 are the state block. Washington levies NO personal income tax,
   * so there is nothing to report in box 17 and it MUST be blank.
   *
   * The trap is that Michael's employees DO have money withheld by the state —
   * Paid Family & Medical Leave and WA Cares. Those are not income tax. They
   * belong in BOX 14 ("Other"). Reporting them in box 17 would tell the IRS
   * his employees paid a state income tax that does not exist, and would
   * invite them to claim a deduction they are not entitled to.
   */
  it("carries the state-and-local authority the box 17 rule rests on", () => {
    const a = findFormW2Authority("iw2w3-2026-boxes-15-20-state-local-income-tax");
    expect(a).toBeDefined();
    expect(IW2W3_2026_BOXES_15_20_STATE_LOCAL.quote.toLowerCase()).toContain(
      "state and local income tax",
    );
  });

  it("explains in plain English that Washington leaves box 17 empty", () => {
    const text = IW2W3_2026_BOXES_15_20_STATE_LOCAL.soWhat.toLowerCase();
    expect(text).toContain("box 17");
    expect(text).toContain("washington");
  });
});

describe("books-43: the arithmetic oracles", () => {
  /**
   * THE BOX 4 CEILING IS AN ORACLE, NOT AN OPINION.
   *
   * Social security is withheld at 6.2% until wages reach the wage base, so
   * the MAXIMUM that can ever appear in box 4 for one employee at one employer
   * is a derived figure, not a lookup:
   *
   *     $184,500.00 × 6.2% = $11,439.00
   *     18,450,000 cents × 6,200 milli-pct / 100,000 = 1,143,900 cents, r0
   *
   * The remainder is EXACTLY ZERO, so there is no rounding judgement to make
   * and any engine producing a different number is simply wrong. Derived here
   * rather than retyped, so a typo in the constant cannot become the oracle
   * the engine is later measured against — a wrong oracle is worse than none,
   * because it makes a broken engine look correct.
   */
  it("derives the box 4 ceiling from the wage base and the rate, exactly", () => {
    const WAGE_BASE_CENTS = 18_450_000;
    const OASDI_RATE_MILLI_PCT = 6_200;
    const product = WAGE_BASE_CENTS * OASDI_RATE_MILLI_PCT;
    expect(product % 100_000, "the ceiling must be exact in whole cents").toBe(0);
    expect(product / 100_000).toBe(W2_BOX_4_CEILING_2026_CENTS);
    expect(W2_BOX_4_CEILING_2026_CENTS).toBe(1_143_900);
  });

  it("quotes the IRS stating the same ceiling the arithmetic produces", () => {
    // $11,439.00 — the printed figure must be in the source, which is what
    // makes the constant a transcription rather than a belief.
    expect(INSTRUCTIONS).toContain("11,439");
  });

  /**
   * THE "APPROXIMATELY TWICE" SUBTLETY — and why the constant is named FACTOR.
   *
   * The 941 carries BOTH halves of FICA; the W-3 carries only the employee's.
   * So 941 ≈ 2 × W-3. The IRS says "approximately", and the word is load
   * bearing: ADDITIONAL MEDICARE TAX HAS NO EMPLOYER MATCH. The first year an
   * employee crosses $200,000, an engine asserting EXACTLY 2× would raise an
   * error on a perfectly correct filing.
   *
   * That is the classic shape of a check that cries wolf until somebody
   * disables it — and a disabled check is worse than no check, because the
   * green tick remains. Hence `..._DOUBLING_FACTOR`, not `..._EXPECTED_RATIO`:
   * the name says it is an input to a tolerance, not the tolerance itself.
   */
  it("names the 941 ratio a FACTOR because the instruction says approximately", () => {
    expect(W3_TO_941_FICA_DOUBLING_FACTOR).toBe(2);
    expect(IW2W3_2026_RECONCILE_941_APPROXIMATELY_TWICE.quote.toLowerCase()).toContain(
      "approximately",
    );
  });

  /**
   * The un-matched Additional Medicare Tax, demonstrated with numbers so the
   * B5 reconciliation engine cannot be built on a naive 2×.
   *
   * Employee at $250,000: Medicare 1.45% both sides on all of it, PLUS 0.9%
   * Additional Medicare on the $50,000 over the threshold — employee only.
   */
  it("shows why an exact 2x test would false-alarm on a correct filing", () => {
    const MEDICARE_WAGES_CENTS = 25_000_000;
    const THRESHOLD_CENTS = 20_000_000;
    const MEDICARE_RATE_MILLI_PCT = 1_450;
    const ADDITIONAL_RATE_MILLI_PCT = 900;

    const employeeMedicare = (MEDICARE_WAGES_CENTS * MEDICARE_RATE_MILLI_PCT) / 100_000;
    const employerMedicare = employeeMedicare; // matched
    const additional =
      ((MEDICARE_WAGES_CENTS - THRESHOLD_CENTS) * ADDITIONAL_RATE_MILLI_PCT) / 100_000;

    // W-3 box 6 carries the employee's Medicare INCLUDING Additional Medicare.
    const w3Box6 = employeeMedicare + additional;
    // The 941 carries both halves — but the employer never matches Additional.
    const form941 = employeeMedicare + employerMedicare + additional;

    expect(additional).toBe(45_000); // $450.00, employee only
    expect(form941).toBeLessThan(w3Box6 * W3_TO_941_FICA_DOUBLING_FACTOR);

    // The tolerance is not a guess — it is exactly the un-matched amount.
    expect(w3Box6 * W3_TO_941_FICA_DOUBLING_FACTOR - form941).toBe(additional);
  });

  /**
   * THE §6722 DOUBLING — the most under-appreciated fact about W-2 deadlines.
   *
   * §6721 punishes not filing with the government. §6722 punishes not giving
   * the form to the employee. Same amounts, same staircase, charged ON TOP. So
   * a late W-2 is not $340 a head, it is $680 a head.
   */
  it("keeps the word that makes the penalty double", () => {
    const q = IW2W3_2026_PAYEE_STATEMENT_PENALTY_6722.quote;
    expect(q).toContain("additional penalty");
    expect(q).toContain("section 6722");
  });
});

describe("books-43: elision discipline", () => {
  /**
   * The module exports the marker it uses so this test and the module cannot
   * drift on what an elision looks like. If someone switched to a unicode
   * ellipsis, the verifier (which splits on three ASCII dots) would stop
   * seeing segments and would compare the whole string — ellipsis included —
   * against a source that does not contain it.
   */
  it("uses the same elision marker the verifier splits on", () => {
    expect(FORM_W2_ELISION).toBe(" ... ");
    const usesElision = FORM_W2_OWN_AUTHORITIES.filter((a) => a.quote.includes("..."));
    /*
     * books-43 had two elided quotes; books-55 added two more, both eliding the
     * same thing for the same reason. §3121(a)(2) and §3306(b)(2) each have a
     * preamble stating the plan-or-system condition, then subparagraphs (A)
     * sickness, (B) medical, (C) death. The premium rule is the preamble plus
     * (B); (A) and (C) are about workers' compensation and group-term life and
     * would only pad the quote. So the elision joins the preamble to (B).
     *
     * A FLOOR RATHER THAN AN EXACT COUNT. What matters is that elisions use the
     * marker the verifier splits on and never a unicode ellipsis - which the
     * loop below checks for every one of them, however many there are. Pinning
     * the exact number just guarantees an edit per slice.
     */
    expect(usesElision.length).toBeGreaterThanOrEqual(4);
    for (const a of usesElision) {
      expect(a.quote, `${a.id} must not use a unicode ellipsis`).not.toContain("\u2026");
    }
  });

  /**
   * MIN_SEGMENT_CHARS = 40 in the verifier: a segment shorter than that proves
   * nothing, because a short string appears everywhere. `quoteSegments`
   * returns null when a segment is too short, so this asserts non-null for
   * every elided quote — the same primitive the verifier uses.
   */
  it("every elided segment is long enough to prove something", () => {
    for (const a of FORM_W2_OWN_AUTHORITIES.filter((x) => x.quote.includes("..."))) {
      const segments = quoteSegments(normalise(a.quote));
      expect(segments, `${a.id}: a segment is under the 40-character floor`).not.toBeNull();
      for (const seg of segments as string[]) {
        expect(seg.length, `${a.id}: segment "${seg}"`).toBeGreaterThanOrEqual(40);
      }
    }
  });
});
