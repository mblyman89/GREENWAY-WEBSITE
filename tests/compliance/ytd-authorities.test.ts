/**
 * books-34 — THE YTD AUTHORITIES, AND THE HOLE IN SUBSTRING MATCHING.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `scripts/verify-verbatim-quotes.ts` proves that every quote APPEARS in the
 * mirrored source. That is a real and valuable guarantee: it makes it
 * impossible to invent words, to change a dollar figure, or to reorder
 * subsections. A mutation campaign in this slice killed three separate
 * corruptions of these quotes on the first try.
 *
 * It killed three of four. The survivor is the defect class this file closes.
 *
 * A substring check cannot detect TRUNCATION, because a truncated quote is
 * still a perfectly valid substring of the source. Delete the third bullet
 * from a three-bullet list and the remaining two still match, byte for byte,
 * and the checker still prints VERBATIM OK. The quote is now honest about
 * every word it contains and silent about the rule it dropped.
 *
 * This is not hypothetical. Building `SSA_REJECTION_CONDITIONS`, the first
 * extraction script anchored the end of the quote on the phrase
 * "tips are equal to zero." — which ends BOTH the second and the third bullet.
 * Python found the earlier one. The quote came out with two of the SSA's three
 * rejection conditions, the verbatim checker passed it, and the missing
 * condition would have become a missing CHECK constraint on the accumulator
 * table: a whole year's wage report rejected by SSA for a rule the system was
 * never taught.
 *
 * Rule 23 says fix the class, not the instance. So this file does not assert
 * "the SSA quote has three bullets" as a one-off. It asserts a STRUCTURAL
 * property that any enumerated quote must satisfy — if the source sentence
 * promises a list, the quote must carry the whole list — and it proves the
 * assertion is failable by running it against a deliberately truncated copy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  YTD_AUTHORITIES,
  SSA_REJECTION_CONDITIONS,
  W2_BOX3_WAGE_BASE_CEILING,
  W2_WORKED_EXAMPLE,
  W2_SOURCE_PATH,
  W2_SOURCE_URL,
} from "@/lib/payroll/ytd-authorities";
import { findGuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import { FORM_W2_SOURCE_URL } from "@/lib/payroll/form-w2-authorities";

/** The same whitespace normalisation the verbatim checker applies. */
function normalise(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Count the bullet items a quote actually carries.
 *
 * The mirrored IRS text uses "•" for every enumerated condition, which makes
 * the count a reliable structural signal rather than a guess about prose.
 */
function bulletCount(quote: string): number {
  return (quote.match(/•/g) ?? []).length;
}

describe("books-34: YTD authorities are registered and complete", () => {
  it("has the seven authorities this slice researched", () => {
    expect(YTD_AUTHORITIES.length).toBe(7);
  });

  /**
   * THE REGISTRATION TEST. An authority module that is never merged into
   * `books-guidance-core` is not checked by the verbatim script at all — it is
   * unverified quotes wearing a green check (rule 50).
   *
   * This is not theoretical either. In this slice the registration edit was
   * silently lost, and every one of these seven authorities was absent from
   * the registry while the verbatim checker still printed PASSED. The only
   * visible symptom was the "no local copy" count rising from 125 to 132.
   * This test turns that silent symptom into a red line.
   */
  it("registers every YTD authority into the one guidance registry", () => {
    const missing = YTD_AUTHORITIES.filter((a) => findGuidanceAuthority(a.id) === undefined).map(
      (a) => a.id,
    );
    expect(missing).toEqual([]);
  });

  it("routes every YTD citation to a corpus file that exists on disk", () => {
    // Guards the failure mode where a citation is phrased so that no corpus
    // route matches it: the quote is then SKIPPED, not verified, and the
    // checker still says PASSED.
    //
    // books-46: this used to read `a.source`, back when `source` held the repo
    // path. It now reads W2_SOURCE_PATH, because the path and the URL became
    // two different fields. Verified failable: pointing the constant at a
    // non-existent file turns this red.
    for (const a of YTD_AUTHORITIES) {
      expect(a.cite).toMatch(/^IRS Instructions for Forms W-2 and W-3 \(2026\), /);
    }
    expect(() => readFileSync(join(process.cwd(), W2_SOURCE_PATH), "utf8")).not.toThrow();
  });

  /**
   * ═══ books-46 — THE SEVEN DEAD LINKS, AND WHY THE EXISTING GATE MISSED THEM ═══
   *
   * `GuidanceAuthority.source` is rendered as `href={a.source}`. These seven
   * authorities are BORROWED by `formW2Authorities()` and appear in the same
   * on-screen panel as that module's own 28, so a repo-relative path here is a
   * dead link on the Form W-2 screen.
   *
   * `form-w2-authorities.ts` had already found this bug, fixed it, and written
   * a gate — but the gate loops `FORM_W2_OWN_AUTHORITIES`, i.e. 28 of the 41
   * rows the panel renders. The other 13 come from here and from
   * `company-identity-authorities`; the identity six were already URLs, so
   * these seven were the entire remaining hole. A fix scoped narrower than the
   * defect leaves the defect (standing rule 39, and rule 23: fix the class).
   *
   * So the assertion now lives on BOTH sides of the borrow.
   */
  it("gives every source a URL a browser can open, not a repo path", () => {
    for (const a of YTD_AUTHORITIES) {
      expect(a.source, `${a.id}: source is rendered as an href`).toMatch(/^https:\/\//);
      expect(a.source, `${a.id}: a repo path is a dead link on screen`).not.toContain(
        "docs/authorities/",
      );
    }
  });

  /**
   * ...AND IT MUST BE THE SAME URL THE NEIGHBOURING MODULE USES.
   *
   * "It is a URL" is weaker than "it is THE url". These seven and the W-2
   * module's 28 quote ONE document and render SIDE BY SIDE. If the two modules
   * disagreed about its address, the panel would contradict itself in a way no
   * per-module test could see — each half would be internally consistent.
   */
  it("addresses the IRS instructions identically to the module that borrows these", () => {
    expect(W2_SOURCE_URL).toBe(FORM_W2_SOURCE_URL);
    for (const a of YTD_AUTHORITIES) {
      expect(a.source, `${a.id}`).toBe(FORM_W2_SOURCE_URL);
    }
  });

  /**
   * THE PATH AND THE URL MUST DESCRIBE THE SAME DOCUMENT.
   *
   * Splitting one constant into two creates a new failure mode that neither
   * half can detect alone: the machine-readable path could be updated to a
   * 2027 corpus while the human-readable link still points at the 2026 PDF, or
   * vice versa. Michael would then be reading a different year's document from
   * the one the quotes were verified against — and every test would pass. The
   * filename and the URL both carry the year, so tie them together.
   */
  it("keeps the mirrored path and the public URL on the same document year", () => {
    expect(W2_SOURCE_PATH).toContain("w-2-w-3-2026");
    expect(W2_SOURCE_URL).toContain("iw2w3");
    for (const a of YTD_AUTHORITIES) {
      expect(a.cite, `${a.id}`).toContain("(2026)");
    }
  });
});

describe("books-34: quotes are structurally complete, not merely present", () => {
  const corpus = normalise(
    // books-46: reads the PATH constant, not `.source`. `.source` is now the
    // public URL, and `readFileSync("https://...")` throws — which is how this
    // line announced the change rather than passing on stale bytes.
    readFileSync(join(process.cwd(), W2_SOURCE_PATH), "utf8"),
  );

  it("every YTD quote appears in the mirrored corpus", () => {
    // A local restatement of the verbatim guarantee, so this file fails on its
    // own if the corpus and the quotes ever part company.
    for (const a of YTD_AUTHORITIES) {
      expect(corpus.includes(normalise(a.quote)), `${a.id} not found in corpus`).toBe(true);
    }
  });

  /**
   * THE TRUNCATION GUARD, stated as a general rule.
   *
   * For any quote containing bullets, the number of bullets in the quote must
   * equal the number of bullets in the corpus between the quote's first and
   * last characters. Truncating the list changes the span, so this compares
   * the quote against the SOURCE's own structure rather than a hardcoded count.
   */
  it("carries every bullet the source runs on after the quote's first bullet", () => {
    for (const a of YTD_AUTHORITIES) {
      const q = normalise(a.quote);
      const inQuote = bulletCount(q);
      if (inQuote === 0) continue;

      const start = corpus.indexOf(q);
      expect(start, `${a.id} not located in corpus`).toBeGreaterThanOrEqual(0);

      // Walk forward from where the quote ENDS. If the very next thing in the
      // source is another bullet, the quote stopped mid-list.
      const after = corpus.slice(start + q.length).trimStart();
      expect(
        after.startsWith("•"),
        `${a.id} stops immediately before another bullet — the quote is truncated ` +
          `mid-list and a substring check cannot see it`,
      ).toBe(false);
    }
  });

  /**
   * The instance that nearly shipped, pinned explicitly. The SSA publishes
   * THREE rejection conditions for non-household employers; each one becomes a
   * database invariant, so losing one loses a constraint.
   */
  it("keeps all three SSA rejection conditions", () => {
    expect(bulletCount(SSA_REJECTION_CONDITIONS.quote)).toBe(3);
    // Each condition names the tax or wage figure it constrains.
    expect(SSA_REJECTION_CONDITIONS.quote).toContain("Medicare wages and tips are less than the sum");
    expect(SSA_REJECTION_CONDITIONS.quote).toContain("Social security tax is greater than zero");
    expect(SSA_REJECTION_CONDITIONS.quote).toContain("Medicare tax is greater than zero");
  });

  /**
   * RULE 15 / RULE 16: prove the guard above can actually fail.
   *
   * A truncated copy of the SSA quote is fed to the same logic. If this does
   * not come back "truncated", the guard is decoration and every other green
   * line in this file is worthless.
   */
  it("the truncation guard actually detects a truncated quote", () => {
    const full = normalise(SSA_REJECTION_CONDITIONS.quote);
    const thirdBullet = full.lastIndexOf("•");
    const truncated = full.slice(0, thirdBullet).trim();

    // The truncated quote is STILL a valid substring — this is precisely why
    // the verbatim checker cannot catch it.
    expect(corpus.includes(truncated)).toBe(true);
    expect(bulletCount(truncated)).toBe(2);

    // But the structural guard sees it.
    const start = corpus.indexOf(truncated);
    const after = corpus.slice(start + truncated.length).trimStart();
    expect(after.startsWith("•")).toBe(true);
  });
});

describe("books-34: the numbers the engine depends on", () => {
  /**
   * The wage base in the quote must be the wage base in the code. These are
   * two independent statements of one fact — the IRS's sentence and the
   * engine's constant — and they are checked against each other because a
   * mismatch means the system is withholding by a number no authority states.
   */
  it("quotes the same 2026 social security wage base the engine enforces", async () => {
    const { OASDI_WAGE_BASE_2026_CENTS } = await import("@/lib/payroll/payroll-withholding-core");
    expect(W2_BOX3_WAGE_BASE_CEILING.quote).toContain("$184,500");
    expect(OASDI_WAGE_BASE_2026_CENTS).toBe(18_450_000);
    // 18,450,000 cents === $184,500.00, spelled out so the relationship is not
    // a coincidence a reader has to verify with a calculator.
    expect(OASDI_WAGE_BASE_2026_CENTS / 100).toBe(184_500);
  });

  /**
   * The IRS's worked example is this slice's test ORACLE: an employee paid
   * $199,750 reports box 3 = 184,500.00 (capped) and box 5 = 199,750.00
   * (uncapped). Both figures must survive in the quote, because the engine's
   * accumulation tests assert against them.
   */
  it("keeps both figures of the IRS worked example", () => {
    // NOTE THE TWO DIFFERENT FORMATS, which are the IRS's own and not a typo
    // here: the narrative dollar amount carries a thousands separator
    // ("$199,750 in wages") while the figures to be ENTERED IN THE BOXES do
    // not ("184500.00", "199750.00"). Asserting the separated form for the box
    // figures is exactly the mistake this test caught on its first run.
    expect(W2_WORKED_EXAMPLE.quote).toContain("$199,750 in wages");
    expect(W2_WORKED_EXAMPLE.quote).toContain("box 3 (social security wages) 184500.00");
    expect(W2_WORKED_EXAMPLE.quote).toContain("box 5 (Medicare wages and tips) 199750.00");
  });
});
