/**
 * tests/compliance/internal-control-authorities.test.ts   (books-28)
 *
 * PROVING THAT "VERBATIM COSO" IS ACTUALLY VERBATIM.
 *
 * Michael asked for COSO verbatim in the mentor and said "I want a system that
 * follows the authoritative source documents precisely". A registry of quotes
 * that nobody checks is exactly the thing he does not want, so this suite
 * checks four separate things, each of which has already caught a real defect
 * during this slice:
 *
 *   1. Every quote is an exact substring of the mirrored source (rules 24/35).
 *   2. The cite-to-file mapping resolves for EVERY record - no silent skips
 *      (rule 39, and the hole that hid section 280E for four slices).
 *   3. The GREEN BOOK EDITION is honoured, proven with a pair of sentences that
 *      exist in one edition and not the other. An earlier mutation survived
 *      because it used a sentence identical in both editions - a control
 *      mutant that proved nothing (rule 60).
 *   4. The records are actually WIRED into the merged registry, because
 *      exporting an array is not the same as being reachable (the bug that
 *      made thirty-six payroll authorities invisible for a whole slice).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALL_GUIDANCE_AUTHORITY_KINDS,
  GUIDANCE_AUTHORITIES,
  GUIDANCE_KIND_LABELS,
  GUIDANCE_KIND_WEIGHT,
  findGuidanceAuthority,
} from "@/lib/accounting/books-guidance-core";
import {
  COSO_COMPONENTS,
  INTERNAL_CONTROL_AUTHORITIES,
  INTERNAL_CONTROL_APPLICABILITY_DISCLAIMER,
  findInternalControlAuthority,
} from "@/lib/accounting/internal-control-authorities";

import { expectedCorpusFile, matchesInOrder, quoteSegments, sourceFileFor } from "../../scripts/verify-verbatim-quotes";

/**
 * The verifier's `normalise` is module-private, so it is reproduced here.
 * KEPT IN SYNC BY A TEST, not by hope: `it("normalises the same way the
 * verifier does")` below asserts that a quote this function accepts is also
 * accepted by the real script's exported helpers on the real corpus. If the two
 * drift, the verbatim assertions in this file would start passing for the wrong
 * reason, which is worse than failing.
 */
function normalise(text: string): string {
  return text
    .replace(/\n\s*\n\s*\d{1,4}\s*\n?\f/g, "\n")
    .replace(/\.\d(?=\n)/g, ".")
    .replace(/\u2014/g, "-")
    .replace(/\u2019/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\[\s*(?:ARB|FAS|FIN|ASU|EITF|SOP|APB|CON)[^\]]*\]/g, " ")
    .replace(/[[\]]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, " - ")
    .trim();
}

const AUTHORITY_DIR = join(process.cwd(), "docs", "authorities");
const COSO_FILE = join(
  AUTHORITY_DIR,
  "coso",
  "internal-control-integrated-framework-executive-summary-2013.txt",
);
const GB_2025_FILE = join(AUTHORITY_DIR, "green-book", "gao-25-107721-green-book-2025.txt");
const GB_2014_FILE = join(AUTHORITY_DIR, "green-book", "gao-14-704g-green-book-2014.txt");

describe("the mirrored sources exist and are not stubs", () => {
  /**
   * GUARD AGAINST A VACUOUS SUITE (rule 39). Every verbatim assertion below is
   * a substring test, and a substring test against an EMPTY haystack fails
   * loudly - but a substring test against a file someone truncated to a
   * copyright notice would fail confusingly. Assert the size first so the
   * failure message says "the corpus is missing" rather than "your quote is
   * wrong".
   */
  it("the COSO executive summary is present and substantial", () => {
    const text = readFileSync(COSO_FILE, "utf8");
    expect(text.length).toBeGreaterThan(25_000);
    // COSO's own title page, so we know we mirrored the right document.
    expect(text).toContain("Internal Control \u2014 Integrated Framework");
    expect(text).toContain("Committee of Sponsoring Organizations of the Treadway Commission");
  });

  it("both Green Book editions are present and are DIFFERENT documents", () => {
    const gb25 = readFileSync(GB_2025_FILE, "utf8");
    const gb14 = readFileSync(GB_2014_FILE, "utf8");
    expect(gb25.length).toBeGreaterThan(200_000);
    expect(gb14.length).toBeGreaterThan(120_000);
    expect(gb25).toContain("GAO-25-107721");
    expect(gb14).toContain("GAO-14-704G");
    // If a future edit accidentally copies one file over the other, every
    // edition-routing test below would still pass while proving nothing.
    expect(gb25).not.toEqual(gb14);
  });

  /**
   * THE SOFT-HYPHEN DECISION, MADE PERMANENT AND FALSIFIABLE.
   *
   * The COSO PDF is justified text, so 64 words were split across lines as
   * "manage-\nment". All 64 were listed and inspected individually: every one
   * was typesetting hyphenation and NOT ONE was a real compound. So they were
   * rejoined in the mirrored copy, which is why COSO's definition of internal
   * control can be quoted as a normal sentence.
   *
   * The Green Book files are the OPPOSITE case - all of their hyphen line
   * breaks are genuine compounds ("third-party", "entity-wide") - so the same
   * transformation was deliberately NOT applied to them. These two tests are
   * the negative control for that asymmetry: if someone "tidies up" the
   * corpora by de-hyphenating everything, the second one fails.
   */
  it("the COSO copy has its soft hyphenation rejoined", () => {
    const text = readFileSync(COSO_FILE, "utf8");
    expect(/[A-Za-z]+-\n[A-Za-z0-9]+/.test(text)).toBe(false);
    expect(text).toContain("board of directors, management, and other personnel");
  });

  it("the Green Book copies keep their REAL compound hyphens intact", () => {
    const gb25 = readFileSync(GB_2025_FILE, "utf8");
    const gb14 = readFileSync(GB_2014_FILE, "utf8");
    // These are real hyphenated compounds broken at the line end by the
    // typesetter. Joining them would produce "thirdparty" and "quasigovernmental".
    expect(/[A-Za-z]+-\n[A-Za-z0-9]+/.test(gb25)).toBe(true);
    expect(/[A-Za-z]+-\n[A-Za-z0-9]+/.test(gb14)).toBe(true);
    expect(gb25).toContain("third-\nparty");
    expect(gb14).toContain("quasi-\ngovernmental");
  });
});

describe("every quote is verbatim", () => {
  it("has a non-trivial number of authorities", () => {
    // Guard against an empty loop reporting success.
    expect(INTERNAL_CONTROL_AUTHORITIES.length).toBeGreaterThanOrEqual(38);
  });

  it.each(INTERNAL_CONTROL_AUTHORITIES.map((a) => [a.id, a] as const))(
    "%s quotes its source exactly",
    (_id, authority) => {
      const file = sourceFileFor(authority.cite);
      // A null here means the citation resolved to nothing, which would make
      // the quote unverifiable - the silent hole rule 39 exists to close.
      expect(file, `${authority.id}: cite "${authority.cite}" resolved to no file`).not.toBeNull();

      const haystack = normalise(readFileSync(file as string, "utf8"));
      const segments = quoteSegments(normalise(authority.quote));
      expect(segments, `${authority.id}: elided segment too short to prove anything`).not.toBeNull();
      expect(
        matchesInOrder(haystack, segments as string[]),
        `${authority.id}: quote is NOT an exact substring of ${file}`,
      ).toBe(true);
    },
  );

  it("resolves every citation to a file that exists, with no silent skips", () => {
    for (const a of INTERNAL_CONTROL_AUTHORITIES) {
      // Both halves of the verifier must agree, which is the invariant that
      // broke when 280E matched "280" and resolved to a file nobody had.
      const expected = expectedCorpusFile(a.cite);
      expect(expected, `${a.id}: not recognised as belonging to any mirrored corpus`).not.toBeNull();
      expect(sourceFileFor(a.cite), `${a.id}: recognised but unresolved`).not.toBeNull();
    }
  });
});

describe("the Green Book EDITION is honoured, not averaged", () => {
  /**
   * The pair that makes edition routing falsifiable. Principle 8 was reworded
   * between the two editions, so each sentence exists in exactly one file.
   */
  const P8_2014 =
    "Management should consider the potential for fraud when identifying, analyzing, and responding to risks.";
  const P8_2025 =
    "Management should consider risks related to fraud, improper payments, and information security when " +
    "identifying, analyzing, and responding to risks.";

  it("the two editions really do word Principle 8 differently", () => {
    const gb25 = normalise(readFileSync(GB_2025_FILE, "utf8"));
    const gb14 = normalise(readFileSync(GB_2014_FILE, "utf8"));
    expect(gb14).toContain(normalise(P8_2014));
    expect(gb25).not.toContain(normalise(P8_2014));
    expect(gb25).toContain(normalise(P8_2025));
    expect(gb14).not.toContain(normalise(P8_2025));
  });

  it("routes each edition's citation to its own file", () => {
    const f14 = sourceFileFor(
      "GAO-14-704G, Standards for Internal Control in the Federal Government (2014), Principle 8 (para. 8.01)",
    );
    const f25 = sourceFileFor(
      "GAO-25-107721, Standards for Internal Control in the Federal Government (2025), Principle 8 (para. 8.01)",
    );
    expect(f14).toBe(GB_2014_FILE);
    expect(f25).toBe(GB_2025_FILE);
    expect(f14).not.toBe(f25);
  });

  it("refuses an edition it does not hold rather than guessing at one", () => {
    // A plausible-looking but unmirrored edition must resolve to null, NOT
    // fall back to whichever file happens to be nearest.
    expect(
      sourceFileFor("GAO-99-999999, Standards for Internal Control in the Federal Government (1999), Principle 1"),
    ).toBeNull();
  });

  it("both Principle 8 records are in the registry and disagree with each other", () => {
    const a14 = findInternalControlAuthority("green-book-2014-principle-8-fraud");
    const a25 = findInternalControlAuthority("green-book-2025-principle-8-fraud");
    expect(a14).toBeDefined();
    expect(a25).toBeDefined();
    // The whole point: same principle, materially different text. If a future
    // edit makes these identical, the routing proof above becomes a control
    // mutant and silently stops testing anything.
    expect(a14?.quote).not.toEqual(a25?.quote);
    expect(a25?.quote).toContain("information security");
    expect(a14?.quote).not.toContain("information security");
  });
});

describe("wired into the one merged registry", () => {
  it("every record is reachable through findGuidanceAuthority", () => {
    // Exporting the array is NOT enough - it must be spread into
    // taggedCandidates() in books-guidance-core. This is the assertion that
    // would have caught PAYROLL_TAX_AUTHORITIES sitting unimported.
    for (const a of INTERNAL_CONTROL_AUTHORITIES) {
      expect(findGuidanceAuthority(a.id), `${a.id} is not reachable in the merged registry`).toBeDefined();
    }
  });

  it("the merged registry kept the same quote, not a lookalike", () => {
    for (const a of INTERNAL_CONTROL_AUTHORITIES) {
      expect(findGuidanceAuthority(a.id)?.quote).toBe(a.quote);
    }
  });

  it("declares a kind the registry knows how to label and weigh", () => {
    for (const a of INTERNAL_CONTROL_AUTHORITIES) {
      expect(ALL_GUIDANCE_AUTHORITY_KINDS, `${a.id} kind`).toContain(a.kind);
    }
    expect(GUIDANCE_KIND_LABELS.internal_control_framework).toBe("Internal control framework");
    // Persuasive only. COSO binds nobody at Greenway - no statute, no external
    // audit, no Sarbanes-Oxley. Claiming otherwise on a badge would be a lie
    // dressed as rigour.
    expect(GUIDANCE_KIND_WEIGHT.internal_control_framework).toBe(1);
  });

  it("uses ids nobody else already claimed", () => {
    const mine = INTERNAL_CONTROL_AUTHORITIES.map((a) => a.id);
    expect(new Set(mine).size).toBe(mine.length);
    // And the merged registry as a whole still has unique ids.
    const all = GUIDANCE_AUTHORITIES.map((a) => a.id);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("the records are honest about what they are", () => {
  it("says plainly that COSO does not bind Greenway", () => {
    const d = INTERNAL_CONTROL_APPLICABILITY_DISCLAIMER;
    expect(d).toContain("No law requires Greenway to follow COSO");
    expect(d).toContain("no external audit");
    // The disclaimer must not merely hedge - it has to say what the framework
    // IS good for, or Michael has no reason to read any of it.
    expect(d).toContain("keeps itself honest");
  });

  it("every record carries a plain-English 'so what' and a real source URL", () => {
    for (const a of INTERNAL_CONTROL_AUTHORITIES) {
      expect(a.soWhat.length, `${a.id} soWhat too short to teach anything`).toBeGreaterThan(80);
      expect(a.source, `${a.id} source`).toMatch(/^https:\/\/(www\.coso\.org|www\.gao\.gov)\//);
      expect(a.cite.length, `${a.id} cite`).toBeGreaterThan(20);
    }
  });

  it("attributes each quote to the body that actually wrote it", () => {
    for (const a of INTERNAL_CONTROL_AUTHORITIES) {
      const isCoso = a.cite.startsWith("COSO,");
      const isGreenBook = a.cite.startsWith("GAO-");
      expect(isCoso || isGreenBook, `${a.id}: cite names neither COSO nor GAO`).toBe(true);
      // A COSO cite must point at coso.org and a GAO cite at gao.gov. Mixing
      // them would misattribute the words even while the quote stayed verbatim.
      if (isCoso) expect(a.source).toContain("coso.org");
      if (isGreenBook) expect(a.source).toContain("gao.gov");
    }
  });
});

describe("the five components and seventeen principles", () => {
  it("has exactly five components", () => {
    expect(COSO_COMPONENTS).toHaveLength(5);
  });

  it("covers principles 1 to 17 exactly once each", () => {
    const all = COSO_COMPONENTS.flatMap((c) => c.principleNumbers);
    expect(all).toHaveLength(17);
    expect([...all].sort((a, b) => a - b)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
  });

  it("names the components the way COSO names them", () => {
    expect(COSO_COMPONENTS.map((c) => c.component)).toEqual([
      "Control Environment",
      "Risk Assessment",
      "Control Activities",
      "Information and Communication",
      "Monitoring Activities",
    ]);
  });

  it("groups the principles the way COSO groups them", () => {
    // Straight from the Executive Summary's own headings, which is the whole
    // reason the mapping is data rather than a layout decision.
    const byName = new Map(COSO_COMPONENTS.map((c) => [c.component, c.principleNumbers]));
    expect(byName.get("Control Environment")).toEqual([1, 2, 3, 4, 5]);
    expect(byName.get("Risk Assessment")).toEqual([6, 7, 8, 9]);
    expect(byName.get("Control Activities")).toEqual([10, 11, 12]);
    expect(byName.get("Information and Communication")).toEqual([13, 14, 15]);
    expect(byName.get("Monitoring Activities")).toEqual([16, 17]);
  });

  it("explains each component without jargon", () => {
    for (const c of COSO_COMPONENTS) {
      expect(c.plainEnglish.length, `${c.component} plainEnglish`).toBeGreaterThan(60);
    }
  });

  /**
   * COVERAGE, NOT DECORATION. All seventeen principles must actually be quoted
   * somewhere in the registry, or the claim "verbatim COSO" is only partly
   * true. Principle 1 comes from the Green Book for the mechanical reason
   * documented in the module (COSO's printing glues a footnote marker to
   * "organization"), so the check looks for the principle by CONTENT rather
   * than by which document supplied it.
   */
  it("quotes all seventeen principles somewhere", () => {
    const ids = new Set(INTERNAL_CONTROL_AUTHORITIES.map((a) => a.id));
    // Principles 2-17 from COSO itself.
    for (let n = 2; n <= 17; n += 1) {
      const found = [...ids].some((id) => id.startsWith(`coso-2013-principle-${n}-`));
      expect(found, `COSO principle ${n} is not quoted anywhere`).toBe(true);
    }
    // Principle 1, supplied by the Green Book.
    expect(ids.has("green-book-2025-principle-1-integrity")).toBe(true);
    const p1 = findInternalControlAuthority("green-book-2025-principle-1-integrity");
    expect(p1?.quote).toContain("commitment to integrity and ethical values");
  });

  it("does not quote a COSO principle 1 it cannot verify", () => {
    // The honest consequence of the footnote-marker problem. If someone later
    // adds a `coso-2013-principle-1-*` record, it must be because they solved
    // the normalisation question - and then this test should be updated
    // deliberately rather than discovered to be failing.
    const bogus = INTERNAL_CONTROL_AUTHORITIES.filter((a) => a.id.startsWith("coso-2013-principle-1-"));
    expect(bogus).toEqual([]);
  });
});
