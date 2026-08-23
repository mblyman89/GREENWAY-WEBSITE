/**
 * tests/compliance/pay-run-authorities.test.ts   (books-39 phase B)
 *
 * STANDING RULE 24 MADE MECHANICAL, FOR THE PAY RUN REGISTRY.
 *
 * Every quote in `pay-run-authorities.ts` is checked as an exact substring of
 * the mirrored source file it names. Whitespace is normalised on both sides
 * (the registry hard-wraps its strings for readability; the corpus does not),
 * and NOTHING ELSE is forgiven. A single changed word fails.
 *
 * WHY THIS FILE EXISTS WHEN scripts/verify-verbatim-quotes.ts ALREADY DOES THIS
 *
 * It does not do it for this registry. That script walks GUIDANCE_AUTHORITIES
 * out of books-guidance-core and resolves citations to filenames with a table
 * of regexes. Neither covers `PAY_RUN_AUTHORITIES`. More importantly it is a
 * script nobody runs (books-38 established this: not in package.json, not in
 * the workflow, not in the vitest include). Rule 16 — a gate nobody runs is
 * not a gate. This is in tests/compliance/, which CI executes.
 *
 * The check here is also STRICTER in one respect that matters: it resolves the
 * corpus file from the `sourceFile` field the registry itself declares, rather
 * than from a regex over the citation string. A registry entry cannot escape
 * the check by having a citation format the regex does not recognise, which is
 * exactly how §280E hid for four slices.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PAY_RUN_AUTHORITIES,
  payRunAuthorityById,
  type PayRunAuthority,
} from "@/lib/payroll/pay-run-authorities";

const ROOT = join(__dirname, "..", "..");
const CORPUS = join(ROOT, "docs", "authorities");

/**
 * Collapse runs of whitespace so a hard-wrapped TypeScript string can be
 * compared with a single-line corpus paragraph.
 *
 * This is the ONLY normalisation applied. Punctuation, capitalisation,
 * section symbols and the curly apostrophes the corpus actually contains are
 * all left alone, because those are the characters a careless "tidy-up" would
 * change.
 */
function flat(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

describe("the pay run authority registry is populated and well-formed", () => {
  it("has entries", () => {
    // Guard the guard (rule 39). Every per-entry check below is a loop over
    // this array. An empty array would make all of them pass while verifying
    // nothing whatsoever.
    expect(PAY_RUN_AUTHORITIES.length).toBeGreaterThanOrEqual(5);
  });

  it("every id is unique", () => {
    const ids = PAY_RUN_AUTHORITIES.map((a) => a.id);
    expect(new Set(ids).size, `duplicate id among ${ids.join(", ")}`).toBe(ids.length);
  });

  it("no field is blank", () => {
    for (const a of PAY_RUN_AUTHORITIES) {
      expect(a.id.length, "id").toBeGreaterThan(0);
      expect(a.citation.length, `${a.id} citation`).toBeGreaterThan(0);
      expect(a.sourceFile.length, `${a.id} sourceFile`).toBeGreaterThan(0);
      // A short quote is a paraphrase wearing a quote's clothes.
      expect(flat(a.quote).length, `${a.id} quote is suspiciously short`).toBeGreaterThan(80);
      // The explanation is the thing Michael actually reads. A stub here is a
      // registry entry that cites the law at him without telling him anything.
      expect(
        flat(a.whatItMeansHere).length,
        `${a.id} whatItMeansHere is a stub`,
      ).toBeGreaterThan(200);
    }
  });

  it("whatItMeansHere is not just the quote again", () => {
    // The explanation must add something. Copying the statute into the
    // explanation field produces a registry that looks complete and teaches
    // nothing, which is the failure mode this whole mentor pattern exists to
    // avoid.
    for (const a of PAY_RUN_AUTHORITIES) {
      expect(
        flat(a.whatItMeansHere),
        `${a.id}: the explanation repeats the quote`,
      ).not.toContain(flat(a.quote).slice(0, 60));
    }
  });

  it("payRunAuthorityById finds every entry, and returns null for a miss", () => {
    for (const a of PAY_RUN_AUTHORITIES) {
      expect(payRunAuthorityById(a.id), `lookup failed for ${a.id}`).toBe(a);
    }
    // Rule 43 in miniature: the lookup must be able to MISS, or callers that
    // pass a typo get a silent wrong authority instead of a null.
    expect(payRunAuthorityById("no-such-authority-id")).toBeNull();
  });
});

describe("every quote is verbatim in the mirrored corpus (rule 24)", () => {
  /*
   * The heart of the file. For each authority: open the file it names, and
   * assert the quote appears in it character for character.
   */
  for (const a of PAY_RUN_AUTHORITIES) {
    it(`${a.id} — "${flat(a.quote).slice(0, 48)}..." is in ${a.sourceFile}`, () => {
      const path = join(CORPUS, a.sourceFile);

      // Rule 48: a check that cannot run must FAIL, not skip. If the corpus
      // file is missing or renamed, this must be loud. Skipping here is
      // exactly how an unverifiable quote survives in a registry.
      expect(
        existsSync(path),
        `${a.id} names ${a.sourceFile}, which does not exist under docs/authorities/. ` +
          `Either the corpus file was renamed, or this quote has no mirrored source and ` +
          `must not be presented as verbatim.`,
      ).toBe(true);

      const corpus = flat(readFileSync(path, "utf8"));
      const quote = flat(a.quote);

      expect(
        corpus.includes(quote),
        `VERBATIM DRIFT in ${a.id}.\n` +
          `The registry quote is not an exact substring of ${a.sourceFile}.\n` +
          `Quote begins: ${quote.slice(0, 160)}\n` +
          `Fix the REGISTRY to match the corpus, never the corpus to match the registry.`,
      ).toBe(true);
    });
  }

  it("the corpus check is not vacuous — a paraphrase is rejected", () => {
    /*
     * Rule 39, and the most important test in this file.
     *
     * Every assertion above is `corpus.includes(quote)`. If `flat()` were
     * broken, or the corpus file were somehow empty-but-present, or the
     * comparison were accidentally inverted, all of them could pass while
     * checking nothing. This proves the mechanism can say NO.
     *
     * The mutation is the realistic one: swap one word for a synonym that
     * reads identically. "must disregard" -> "shall disregard" is precisely
     * the kind of edit that feels like tidying and is actually a misquote.
     */
    const real = PAY_RUN_AUTHORITIES.find(
      (a) => a.id === "pay-run-cfr-31-3402-f2-1-invalid-certificate",
    );
    expect(real, "the invalid-certificate authority was renamed or removed").toBeTruthy();

    const corpus = flat(readFileSync(join(CORPUS, real!.sourceFile), "utf8"));

    // The genuine article is present...
    expect(corpus.includes(flat(real!.quote))).toBe(true);

    // ...and a one-word paraphrase of it is not.
    const paraphrased = flat(real!.quote).replace("must disregard", "shall disregard");
    expect(
      paraphrased === flat(real!.quote),
      "the paraphrase did not actually change anything — this control is not testing what it claims",
    ).toBe(false);
    expect(
      corpus.includes(paraphrased),
      "a paraphrased quote was found in the corpus, so this check cannot detect drift",
    ).toBe(false);
  });
});

describe("the registry covers the questions a pay run actually asks", () => {
  /*
   * Rule 43: an authority nobody can reach is decoration. These name the
   * SPECIFIC legal questions the pay-run code branches on, so that deleting an
   * authority breaks a test that explains what was lost, rather than one that
   * says "expected 5, got 4".
   */
  const need = (id: string, why: string) => {
    it(`covers: ${why}`, () => {
      expect(payRunAuthorityById(id), `missing authority ${id} — ${why}`).toBeTruthy();
    });
  };

  need(
    "pay-run-cfr-31-3402-f2-1-no-certificate",
    "what to do when an employee has no W-4 on file (the run must not stop, and must not guess)",
  );
  need(
    "pay-run-cfr-31-3402-f2-1-invalid-certificate",
    "what to do when the W-4 on file is defective, including falling back to a PRIOR good form",
  );
  need(
    "pay-run-cfr-31-3402-f2-1-furnish-on-hire",
    "whose duty the W-4 is, so the screen can say so without apologising",
  );
  need(
    "pay-run-rcw-26-18-110-remit-clock",
    "the five-working-day remittance clock that starts when a run withholds support",
  );
  need(
    "pay-run-rcw-49-46-020-annual-adjustment",
    "why an out-of-date minimum wage blocks the whole run, not just low-paid cheques",
  );

  it("the no-W-4 authority actually contains the words the fallback relies on", () => {
    // The code's entire justification for using a single-filer default is the
    // phrase "will be treated as single". If a future edit trims the quote to
    // something shorter, the code's citation stops supporting the code.
    const a = payRunAuthorityById("pay-run-cfr-31-3402-f2-1-no-certificate")!;
    expect(flat(a.quote)).toContain("will be treated as single");
    expect(flat(a.quote)).toContain("no valid withholding allowance certificate in effect");
  });

  it("the invalid-W-4 authority keeps the prior-certificate rule", () => {
    // This is the half everybody drops, and dropping it changes the answer:
    // fall back to single vs. keep using the old form are different cheques.
    const a = payRunAuthorityById("pay-run-cfr-31-3402-f2-1-invalid-certificate")!;
    expect(flat(a.quote)).toContain("must disregard it for purposes of computing withholding");
    expect(flat(a.quote)).toContain(
      "the employer must continue to withhold in accordance with the prior certificate",
    );
  });
});

describe("the registry does not claim a source it does not have", () => {
  it("every sourceFile exists on disk", () => {
    // Deliberately separate from the verbatim loop. That loop would also catch
    // a missing file, but it would report it as a quote failure. This reports
    // it as what it is: a citation to a document we do not actually mirror.
    const missing: string[] = [];
    for (const a of PAY_RUN_AUTHORITIES) {
      if (!existsSync(join(CORPUS, a.sourceFile))) missing.push(`${a.id} -> ${a.sourceFile}`);
    }
    expect(missing, `authorities citing files we do not mirror: ${missing.join("; ")}`).toEqual([]);
  });

  it("does NOT cite RCW 49.48.010 or WAC 296-126-040, which are not mirrored", () => {
    /*
     * Rule 1, made into a test.
     *
     * Both statutes are squarely on point for a pay run — wages due on the
     * regular payday, and the itemised pay statement. I wanted to quote both
     * and could not, because neither is in docs/authorities/. Quoting them
     * from memory would put an uncheckable sentence in quotation marks.
     *
     * This test locks that decision in. If someone adds one of these citations
     * later, this fails and tells them to mirror the source FIRST. If the
     * source gets mirrored, this test is the right place to notice and the
     * correct fix is to add the authority and delete this test.
     */
    const cited = PAY_RUN_AUTHORITIES.map((a) => `${a.citation} ${a.sourceFile}`).join(" | ");
    const unmirrored = ["49.48.010", "296-126-040"];
    for (const u of unmirrored) {
      expect(
        cited.includes(u),
        `${u} is cited but is not mirrored under docs/authorities/. Mirror the source text ` +
          `first, then quote it. Do not quote a statute the build cannot verify.`,
      ).toBe(false);
    }

    // ...and prove this control can fire, rather than passing because the
    // needle is nonsense (rule 39).
    expect(cited.includes("26.18.110")).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * TYPE-LEVEL: the shape cannot rot silently
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the authority shape stays honest", () => {
  it("every entry has exactly the declared fields, no extras", () => {
    // An extra field is usually somebody smuggling in a second, unverified
    // quote under a different name.
    const allowed = new Set<keyof PayRunAuthority>([
      "id",
      "citation",
      "sourceFile",
      "quote",
      "whatItMeansHere",
      // books-39 phase F. `kind` and `source` were added so these five
      // authorities could be merged into the shared GUIDANCE_AUTHORITIES
      // registry, which is what makes a citation resolve to the same words on
      // every screen. They were added AFTER this guard was written, and this
      // guard went red — correctly. Widening the set is only safe because the
      // guard's real purpose is stated in its own comment: keep unverified
      // QUOTED TEXT from arriving under a new field name. So the two new
      // fields are constrained below to shapes that cannot hold a quote.
      "kind",
      "source",
    ]);
    for (const a of PAY_RUN_AUTHORITIES) {
      for (const k of Object.keys(a)) {
        expect(
          allowed.has(k as keyof PayRunAuthority),
          `${a.id} has an unexpected field "${k}". If it holds quoted text, it is not being ` +
            `verified against the corpus.`,
        ).toBe(true);
      }
    }
  });

  it("the two metadata fields cannot become a hiding place for a quote", () => {
    // The point of the widening above. `kind` is a closed two-value tag and
    // `source` is a bare URL; neither can carry a sentence of statute that
    // nothing checks. If someone later parks prose in `source`, this fires.
    for (const a of PAY_RUN_AUTHORITIES) {
      expect(["regulation", "state_law"], `${a.id} has kind "${a.kind}"`).toContain(a.kind);
      expect(a.source, `${a.id} source must be a URL`).toMatch(/^https:\/\/\S+$/);
      // A URL has no spaces, so this is belt-and-braces against a "url plus
      // helpful explanation" value, which is how these fields usually rot.
      expect(a.source.includes(" "), `${a.id} source contains a space`).toBe(false);
      expect(a.source.length, `${a.id} source is suspiciously long`).toBeLessThan(200);
    }
  });

  it("every authority carries a source that points at the ACTUAL publisher", () => {
    // A citation whose "source" is a blog is not a source. Federal regulation
    // must point at eCFR; Washington statute must point at the Legislature.
    for (const a of PAY_RUN_AUTHORITIES) {
      if (a.kind === "regulation") {
        expect(a.source, `${a.id} is a federal regulation`).toContain("ecfr.gov");
      } else {
        expect(a.source, `${a.id} is Washington statute`).toContain("leg.wa.gov");
      }
    }
    // Rule 39: prove both branches were actually exercised, so this cannot
    // pass by finding zero of either kind.
    expect(PAY_RUN_AUTHORITIES.some((a) => a.kind === "regulation")).toBe(true);
    expect(PAY_RUN_AUTHORITIES.some((a) => a.kind === "state_law")).toBe(true);
  });
});
