/**
 * books-25 — THE HIRING PAPERWORK AUTHORITIES, AND THE VERIFIER THAT PROVES
 * THEY ARE REAL.
 *
 * Michael asked for a system that can answer a new employee's "how do I fill
 * this out?" and that refuses rather than warns when something is wrong. Both
 * promises rest entirely on these sixteen records being accurate transcriptions
 * of law rather than confident-sounding paraphrase. So:
 *
 *   1. THE RECORDS. Shape, uniqueness, substance, and — the part that matters —
 *      that each quote is an exact substring of the primary source mirrored on
 *      disk. Not "looks right". Byte-for-byte.
 *
 *   2. THE WIRING (standing rules 16 and 25). An exported registry that nothing
 *      merges is a set of citations no screen can find. That exact bug hid 36
 *      payroll authorities for a whole slice, so this asserts reachability
 *      through `findGuidanceAuthority()` rather than trusting the import.
 *
 *   3. THE VERIFIER ITSELF (standing rules 39, 48 and 50). The cite-to-file
 *      mapping in scripts/verify-verbatim-quotes.ts is the thing standing
 *      between "verbatim" and "we hope". These tests exercise the real
 *      exported functions from that script — they do NOT re-implement the
 *      mapping, because a self-check that re-implements the gate tests nothing.
 *
 * WHY §280E APPEARS IN A HIRING TEST. Because this slice found it. Proving the
 * new title-8 branch was failable meant deliberately breaking a citation, and
 * that experiment revealed the regex `§(\d+)` had been silently truncating
 * "§280E" to "280" and skipping the most consequential statute in this entire
 * product for four slices. The regression test for that lives here, with the
 * change that fixed it (standing rule 45: guard where the bug appears NEXT).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

import {
  PAYROLL_ONBOARDING_AUTHORITIES,
  findPayrollOnboardingAuthority,
  I9_LIMITATION_ON_USE,
  I9_RETENTION_PERIOD,
  I9_SECTION_2_THREE_BUSINESS_DAYS,
  W4_NO_CERTIFICATE_DEFAULT,
  W4_ALTERATION_MAKES_INVALID,
  W4_SSN_REQUIRED_NO_TRUNCATION,
  RCW_26_23_040_REPORT_BY_W4,
} from "@/lib/payroll/payroll-onboarding-authorities";
import {
  findGuidanceAuthority,
  GUIDANCE_AUTHORITIES,
  ALL_GUIDANCE_AUTHORITY_KINDS,
  ALL_SOURCE_REGISTRIES,
  unresolvedDrift,
} from "@/lib/accounting/books-guidance-core";
import {
  sourceFileFor,
  expectedCorpusFile,
  quoteSegments,
  matchesInOrder,
  KNOWN_UNMIRRORED_AUTHORITY_IDS,
} from "../../scripts/verify-verbatim-quotes";

const AUTHORITY_DIR = join(process.cwd(), "docs", "authorities");
const SOURCE_PATH = join(process.cwd(), "src/lib/payroll/payroll-onboarding-authorities.ts");

/**
 * The same normalisation the verifier script applies, imported in spirit but
 * re-stated here for ONE reason: these tests must be able to check the
 * mirrored FILES independently. Where the verifier's own logic is under test
 * (segments, ordering, file mapping) the real exported functions are used.
 */
function normalise(text: string): string {
  return text
    .replace(/\u2014/g, "-")
    .replace(/\u2019/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[[\]]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, " - ")
    .trim();
}

// ---------------------------------------------------------------------------
// 1) THE RECORDS THEMSELVES
// ---------------------------------------------------------------------------

describe("books-25 authority records — shape and substance", () => {
  it("the registry is populated (guard against a vacuous suite)", () => {
    // rule 15b: if this array were empty, every per-record test below would
    // pass by iterating nothing. Pin the count so a deletion is a failure.
    expect(PAYROLL_ONBOARDING_AUTHORITIES.length).toBe(16);
  });

  it("every record has a unique id", () => {
    const ids = PAYROLL_ONBOARDING_AUTHORITIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every record carries a real citation, quote, so-what and https source", () => {
    for (const a of PAYROLL_ONBOARDING_AUTHORITIES) {
      expect(a.cite.trim().length, `${a.id} cite`).toBeGreaterThan(0);
      expect(a.quote.trim().length, `${a.id} quote`).toBeGreaterThanOrEqual(40);
      // The soWhat is the plain-English half. Michael reads this, not the quote.
      expect(a.soWhat.trim().length, `${a.id} soWhat`).toBeGreaterThanOrEqual(80);
      expect(a.source, `${a.id} source`).toMatch(/^https:\/\//);
      expect(ALL_GUIDANCE_AUTHORITY_KINDS, `${a.id} kind`).toContain(a.kind);
    }
  });

  it("federal regulations are kind=regulation and WA statutes are kind=state_law", () => {
    // Standing rule 42: two namespaces of uppercase strings will trade places.
    // `kind` drives how much WEIGHT a screen claims the document carries, so a
    // regulation mislabelled as guidance would understate a binding rule.
    for (const a of PAYROLL_ONBOARDING_AUTHORITIES) {
      if (a.cite.startsWith("8 C.F.R.") || a.cite.startsWith("26 C.F.R.")) {
        expect(a.kind, `${a.id}`).toBe("regulation");
      }
      if (a.cite.startsWith("RCW ")) {
        expect(a.kind, `${a.id}`).toBe("state_law");
      }
    }
  });

  it("lookup finds a known id and misses an unknown one", () => {
    expect(findPayrollOnboardingAuthority(I9_RETENTION_PERIOD.id)).toBeDefined();
    expect(findPayrollOnboardingAuthority("no-such-authority")).toBeUndefined();
  });

  it("no record duplicates an authority the payroll-tax registry already owns", () => {
    // Standing rule 2: the same citation must never exist twice with the
    // possibility of drifting. The no-W-4 default is the interesting case —
    // Pub. 15-T describes it and §31.3402(f)(2)-1(a)(4) creates it. Those are
    // DIFFERENT documents making the same point, so both may exist, but they
    // must not share an id.
    const ids = new Set(PAYROLL_ONBOARDING_AUTHORITIES.map((a) => a.id));
    expect(ids.has("pub15t-2026-no-w4-default")).toBe(false);
    expect(ids.has("pub15t-2026-exempt-scope")).toBe(false);
    // And the regulation record must genuinely be the regulation, not a
    // re-typed copy of the Publication's wording.
    expect(W4_NO_CERTIFICATE_DEFAULT.cite).toContain("31.3402(f)(2)-1");
    expect(W4_NO_CERTIFICATE_DEFAULT.kind).toBe("regulation");
  });
});

// ---------------------------------------------------------------------------
// 2) VERBATIM INTEGRITY — the quotes are transcriptions, proven by machine
// ---------------------------------------------------------------------------

describe("books-25 quotes are verbatim (standing rules 24 and 35)", () => {
  it("all three primary sources are mirrored on disk", () => {
    for (const rel of [
      ["federal", "cfr-8-274a.2.txt"],
      ["federal", "cfr-31.3402(f)(2)-1.txt"],
      ["state-wa", "rcw-26.23.040.txt"],
    ]) {
      expect(existsSync(join(AUTHORITY_DIR, ...rel)), rel.join("/")).toBe(true);
    }
  });

  it("EVERY record maps to a mirrored file — none is silently unverifiable", () => {
    // This is the test that makes the rest of this block meaningful. If a cite
    // failed to map, the verifier would skip it and report success.
    for (const a of PAYROLL_ONBOARDING_AUTHORITIES) {
      const file = sourceFileFor(a.cite, AUTHORITY_DIR);
      expect(file, `${a.id} (${a.cite}) must map to a file on disk`).not.toBeNull();
    }
  });

  it("every quote appears in its source, in order, segment by segment", () => {
    let verified = 0;
    for (const a of PAYROLL_ONBOARDING_AUTHORITIES) {
      const file = sourceFileFor(a.cite, AUTHORITY_DIR);
      expect(file).not.toBeNull();
      const haystack = normalise(readFileSync(file as string, "utf8"));
      const segments = quoteSegments(normalise(a.quote));
      expect(segments, `${a.id} has an unusably short elided segment`).not.toBeNull();
      expect(
        matchesInOrder(haystack, segments as string[]),
        `${a.id} (${a.cite}) is NOT verbatim against ${file}`,
      ).toBe(true);
      verified += 1;
    }
    expect(verified).toBe(16);
  });

  it("a paraphrase of a real quote would FAIL this check (rule 15: provably failable)", () => {
    // The whole apparatus is worthless if it cannot tell a transcription from
    // a rewrite. Take a genuine quote, change one word to a synonym, and prove
    // the check rejects it.
    const file = sourceFileFor(I9_RETENTION_PERIOD.cite, AUTHORITY_DIR);
    const haystack = normalise(readFileSync(file as string, "utf8"));

    const real = normalise(I9_RETENTION_PERIOD.quote);
    expect(matchesInOrder(haystack, [real])).toBe(true);

    const paraphrased = real.replace("whichever is later", "whichever comes later");
    expect(paraphrased).not.toBe(real);
    expect(matchesInOrder(haystack, [paraphrased])).toBe(false);
  });

  it("the load-bearing legal phrases are present exactly, not approximately", () => {
    // These specific strings are the ones the engine's behaviour is built on.
    // If any of them changes, a refusal or a deadline in this product is
    // resting on words the government did not write.
    expect(I9_SECTION_2_THREE_BUSINESS_DAYS.quote).toContain(
      "must within three business days of the hire",
    );
    expect(I9_RETENTION_PERIOD.quote).toContain(
      "three years after the date of the hire or one year after the date the individual's " +
        "employment is terminated, whichever is later",
    );
    expect(I9_LIMITATION_ON_USE.quote).toContain("may be used only for enforcement of the Act");
    expect(W4_NO_CERTIFICATE_DEFAULT.quote).toContain(
      "will be treated as single but having the withholding allowance provided in forms",
    );
    expect(W4_ALTERATION_MAKES_INVALID.quote).toContain(
      "causes such certificate to be invalid",
    );
    expect(W4_SSN_REQUIRED_NO_TRUNCATION.quote).toContain(
      "may not use a truncated social security number",
    );
    // The clause that puts the W-4 and the DSHS report in one flow.
    expect(RCW_26_23_040_REPORT_BY_W4.quote).toContain(
      "report to the extent practicable by W-4 form",
    );
  });
});

// ---------------------------------------------------------------------------
// 3) WIRING — reachable from the registry the screens actually query
// ---------------------------------------------------------------------------

describe("books-25 registry wiring (standing rules 16 and 25)", () => {
  it("the source tag is declared in the registry union", () => {
    expect(ALL_SOURCE_REGISTRIES).toContain("payroll-onboarding");
  });

  it("every record is reachable through findGuidanceAuthority()", () => {
    // THE ORPHANING TEST. Exporting the array is not wiring it. This is the
    // assertion that PAYROLL_TAX_AUTHORITIES lacked for an entire slice.
    for (const a of PAYROLL_ONBOARDING_AUTHORITIES) {
      const found = findGuidanceAuthority(a.id);
      expect(found, `${a.id} is not reachable from the merged registry`).toBeDefined();
      expect(found?.quote, `${a.id} quote drifted in the merge`).toBe(a.quote);
      expect(found?.cite, `${a.id} cite drifted in the merge`).toBe(a.cite);
      expect(found?.kind, `${a.id} kind drifted in the merge`).toBe(a.kind);
    }
  });

  it("adding this registry introduced no duplicate id and no unresolved drift", () => {
    const ids = GUIDANCE_AUTHORITIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(unresolvedDrift()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4) THE VERIFIER'S CITE-TO-FILE MAPPING
//
// Standing rule 39: a self-check that re-implements the gate tests nothing.
// These call the REAL exported functions from the verifier script.
// ---------------------------------------------------------------------------

describe("verify-verbatim-quotes cite mapping — the new corpora", () => {
  it("maps an 8 C.F.R. citation to the title-8 mirror", () => {
    const p = sourceFileFor("8 C.F.R. §274a.2(b)(1)(ii)", AUTHORITY_DIR);
    expect(p).toBe(join(AUTHORITY_DIR, "federal", "cfr-8-274a.2.txt"));
  });

  it("maps a 26 C.F.R. part 31 citation to the employment-tax mirror", () => {
    const p = sourceFileFor("26 C.F.R. §31.3402(f)(2)-1(a)(4)", AUTHORITY_DIR);
    expect(p).toBe(join(AUTHORITY_DIR, "federal", "cfr-31.3402(f)(2)-1.txt"));
  });

  it("still maps the part-1 regulations the earlier slices rely on", () => {
    // Rule 45: the new branch must not have shadowed the old one. Part 1 and
    // part 31 both begin "26 C.F.R. §" and the ordering of those two branches
    // is therefore load-bearing.
    const p = sourceFileFor("26 C.F.R. §1.471-3(b)", AUTHORITY_DIR);
    expect(p).toBe(join(AUTHORITY_DIR, "federal", "cfr-1.471-3.txt"));
  });

  it("REGRESSION: §280E maps to usc-280E.txt, not usc-280.txt", () => {
    // THE BUG THIS SLICE FOUND. `§(\d+)` captured "280" from "§280E" and looked
    // for a file that has never existed, so the verifier skipped the single
    // most consequential statute in this product and printed a green line. The
    // trailing letter is part of the section number.
    const p = sourceFileFor("26 U.S.C. §280E", AUTHORITY_DIR);
    expect(p).toBe(join(AUTHORITY_DIR, "federal", "usc-280E.txt"));
    expect(p).not.toBe(join(AUTHORITY_DIR, "federal", "usc-280.txt"));
  });

  it("REGRESSION: a lettered section resolves generally, not as a special case", () => {
    // Rule 23: fix the class, not the instance. §263A was skipped the same way.
    const got = expectedCorpusFile("26 U.S.C. §263A(a)(2) (flush language)", AUTHORITY_DIR);
    expect(got?.path).toBe(join(AUTHORITY_DIR, "federal", "usc-263A.txt"));
  });

  it("returns null for a corpus this repository does not mirror", () => {
    // The honest skip: a court case has no mirrored text, and pretending to
    // verify it would be theatre.
    expect(sourceFileFor("Harborside Health Center v. Commissioner, 151 T.C. 11 (2018)")).toBeNull();
    expect(expectedCorpusFile("WAC 314-55-087")).toBeNull();
  });

  it("maps an IRS Publication citation to the mirrored publication", () => {
    // books-25. Until this slice NO IRS publication was mirrored, which meant
    // the withholding rules this engine implements line by line were the least
    // verifiable sources in the repository. Both spellings resolve: the plain
    // number and the lettered variant.
    expect(sourceFileFor("IRS Pub. 15 (2026), section 8 (Payroll Period)", AUTHORITY_DIR)).toBe(
      join(AUTHORITY_DIR, "federal", "irs-pub-15-2026.txt"),
    );
    expect(sourceFileFor("IRS Pub. 15-T (2026), 'Rounding'", AUTHORITY_DIR)).toBe(
      join(AUTHORITY_DIR, "federal", "irs-pub-15-t-2026.txt"),
    );
  });

  it("does NOT let Pub. 15 and Pub. 15-T resolve to the same file", () => {
    // The whole reason the suffix is in the filename. "Pub. 15" and "Pub. 15-T"
    // are different documents with different rules, and a pattern that dropped
    // the "-T" would verify Pub. 15-T's worksheet quotes against Circular E and
    // report a cheerful green line for a quote that is not in the file at all.
    const plain = sourceFileFor("IRS Pub. 15 (2026), section 6", AUTHORITY_DIR);
    const lettered = sourceFileFor("IRS Pub. 15-T (2026), Worksheet 1A, line 1g", AUTHORITY_DIR);
    expect(plain).not.toBe(lettered);
  });

  it("keeps the YEAR in the publication filename", () => {
    // These are revised every year. A 2026 quote validated against a 2027 file
    // would be the most plausible-looking wrong answer this system could give,
    // because the prose barely changes while the numbers change completely.
    const got = expectedCorpusFile("IRS Pub. 15-T (2027), Worksheet 1A", AUTHORITY_DIR);
    expect(got?.path).toBe(join(AUTHORITY_DIR, "federal", "irs-pub-15-t-2027.txt"));
    // ...and that file does not exist, so the rule-48 guard must object rather
    // than silently fall back to the 2026 text.
    expect(sourceFileFor("IRS Pub. 15-T (2027), Worksheet 1A", AUTHORITY_DIR)).toBeNull();
  });

  it("expectedCorpusFile and sourceFileFor agree for every mirrored authority", () => {
    // The two functions answer the same question differently on purpose:
    // sourceFileFor returns null when the file is absent, expectedCorpusFile
    // returns the path regardless. Where a file EXISTS they must not disagree,
    // or the rule-48 guard is comparing against the wrong path.
    let compared = 0;
    for (const a of GUIDANCE_AUTHORITIES) {
      const actual = sourceFileFor(a.cite);
      if (actual === null) continue;
      const expectedPath = expectedCorpusFile(a.cite);
      expect(expectedPath, `${a.id} maps to a file but names no corpus`).not.toBeNull();
      expect(expectedPath?.path, `${a.id}`).toBe(actual);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(80);
  });
});

// ---------------------------------------------------------------------------
// 5) THE RECORDED DEBT LIST — it may only shrink
// ---------------------------------------------------------------------------

describe("KNOWN_UNMIRRORED_AUTHORITY_IDS is honest debt, not a loophole", () => {
  it("every listed id names an authority that actually exists", () => {
    for (const id of KNOWN_UNMIRRORED_AUTHORITY_IDS) {
      expect(findGuidanceAuthority(id), `stale debt entry: ${id}`).toBeDefined();
    }
  });

  it("no listed id has since been mirrored (the debt must shrink, never rot)", () => {
    // Standing rule 34, both directions. The day someone downloads RCW
    // 82.32.090, this test fails until they delete the entry — which is the
    // only way a temporary allowance does not become permanent.
    for (const id of KNOWN_UNMIRRORED_AUTHORITY_IDS) {
      const a = findGuidanceAuthority(id);
      expect(
        sourceFileFor(a!.cite),
        `${id} is now mirrored — remove it from KNOWN_UNMIRRORED_AUTHORITY_IDS`,
      ).toBeNull();
    }
  });

  it("the list has no duplicates and none of books-25's own records are on it", () => {
    expect(new Set(KNOWN_UNMIRRORED_AUTHORITY_IDS).size).toBe(
      KNOWN_UNMIRRORED_AUTHORITY_IDS.length,
    );
    // This slice mirrored its own sources. If one of these ever appears on the
    // debt list, someone has exempted a quote instead of fixing it.
    const mine = new Set(PAYROLL_ONBOARDING_AUTHORITIES.map((a) => a.id));
    for (const id of KNOWN_UNMIRRORED_AUTHORITY_IDS) {
      expect(mine.has(id), `books-25 record ${id} must never be exempted`).toBe(false);
    }
  });

  it("the payroll debt is visible, because payroll is what Michael fears most", () => {
    // Not a behavioural assertion so much as a documented fact with a tripwire:
    // most of the unverified quotes are payroll ones. If that stops being true
    // because someone mirrored them, this number changes and the comment in the
    // script must be updated with it.
    // Enumerated rather than counted by prefix. Standing rule 46: a number
    // nobody computed looks like a number somebody computed — my first draft of
    // this test asserted 15 because I counted the prefixes by eye and missed
    // that "irc-31" also catches the two FICA sections. Listing the ids makes
    // the claim checkable instead of plausible.
    const expectedPayrollDebt = [
      // FICA and FUTA — the sections behind every payroll tax line
      "irc-3101-employee-fica",
      "irc-3111-employer-fica",
      "irc-3301-futa-rate",
      "irc-3302-futa-credit",
      // books-55 PAID THIS ONE OFF, and paying it found a defect \u2014 for the
      // THIRD time. "irc-3306-futa-wage-base" used to sit here.
      //
      // Michael told us he prepared his own W-2s and W-3 and that he may have
      // filled them in wrong, and asked for the lessons to be built on
      // authoritative text rather than on his paperwork (rule 109). The FICA
      // and FUTA medical-payment exclusions live in \u00a73121(a)(2) and
      // \u00a73306(b)(2), so both sections had to be mirrored to quote the
      // CONDITION they impose \u2014 "under a plan or system established by an
      // employer which makes provision for his employees generally\u2026" \u2014 rather
      // than paraphrase it.
      //
      // Mirroring \u00a73306 retroactively audited the one quote we already had
      // from it, which had been sitting behind this skip entry unread for many
      // slices. It was defective: FOUR elisions, one of them only sixteen
      // characters ("any remuneration"), single quotes where the statute
      // prints typographic doubles, and "(b) Wages \u2014" where the source has a
      // full stop. Replaced with an elision-free machine-derived quote.
      //
      // That is books-26, books-37 and now books-55: every single time a debt
      // on this list has been paid, the quote behind it turned out to be
      // wrong. An unverified quote is not a quote that happens to be fine.
      // Washington paid leave and long-term care
      //
      // books-45 PAID OFF "rcw-50a-10-030-pfml", which used to sit here. Two
      // separate bugs kept RCW 50A.10.030 unmirrored: the verifier's router
      // captured RCW chapters with a digits-only pattern, so "50A" truncated to
      // "50" and the fetch target was a file for the UNEMPLOYMENT act rather
      // than the paid-leave act; and the section had never been fetched. Both
      // fixed, and the text now lives at state-wa/rcw-50A.10.030.txt.
      //
      // Paying it immediately proved the point of the ledger: with the source
      // finally checkable, the quote turned out to open its last segment with
      // "(6)(b)(ii)", a subsection label the statute does not actually print.
      // An unverified quote is not a quote that happens to be fine, it is a
      // quote nobody has looked at.
      "rcw-50b-04-080-wa-cares",
      // Unemployment insurance
      "rcw-50-12-220-esd-late-penalty",
      "rcw-50-12-220-6-penalty-waiver",
      "rcw-50-24-040-esd-interest",
      // Industrial insurance (L&I)
      "rcw-51-16-035-lni-classification",
      "rcw-51-16-060-lni-hours",
      // books-37 PAID THIS ONE OFF. "rcw-51-16-140-lni-deduction" used to sit
      // here. The net-pay slice needed RCW 51.16.140(1)'s "shall deduct" to
      // prove the L&I employee premium belongs in the required-by-law bucket
      // that garnishments are measured against, and a load-bearing conclusion
      // like that is not allowed to rest on an unverified quote - so the
      // section was mirrored to state-wa/rcw-51.16.140.txt and the id removed
      // from the debt list. This list is a ledger, not a constant: it shrinks
      // when debt is paid, and the shrink has to be recorded deliberately here
      // rather than discovered by a test going red.
      "rcw-51-16-150-lni-injunction",
      "rcw-51-32-073-supplemental-pension-split",
      "rcw-51-32-090-stay-at-work-split",
      "rcw-51-48-210-lni-late-penalty",
    ];
    const actual = KNOWN_UNMIRRORED_AUTHORITY_IDS.filter(
      (id) => id.startsWith("rcw-5") || id.startsWith("irc-33") || id.startsWith("irc-31"),
    );
    expect([...actual].sort()).toEqual([...expectedPayrollDebt].sort());
    // Stated plainly for the record: FOURTEEN payroll authorities are quoted
    // from a URL rather than from mirrored text. Their quotes may be perfect —
    // §280E's were — but "may be" is what rule 35 exists to replace.
    //
    // Seventeen until books-37 mirrored RCW 51.16.140; sixteen until books-45
    // mirrored RCW 50A.10.030; fifteen until books-55 mirrored IRC §3306. The
    // count is asserted separately from the list
    // on purpose: the list catches a SUBSTITUTION (one id quietly swapped for
    // another leaves the length unchanged), and the count catches a silent
    // ADDITION to the debt pile.
    //
    // NOTE THE DIRECTION OF TRAVEL. This number is only ever allowed to fall.
    // If a future slice needs to raise it, that is a new unverifiable quote
    // entering the payroll engine and it must be argued for in the pull
    // request, not absorbed by editing this line.
    expect(actual.length).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// 6) THE FILE ITSELF — provenance and licensing discipline
// ---------------------------------------------------------------------------

describe("the mirrored sources carry their provenance", () => {
  it("each new mirror states its citation, retrieval date and copyright status", () => {
    const checks: Array<[string[], string, string]> = [
      [["federal", "cfr-8-274a.2.txt"], "8 CFR §274a.2", "17 U.S.C. §105"],
      [["federal", "cfr-31.3402(f)(2)-1.txt"], "26 CFR §31.3402(f)(2)-1", "17 U.S.C. §105"],
      [["state-wa", "rcw-26.23.040.txt"], "RCW 26.23.040", "Public.Resource.Org"],
    ];
    for (const [rel, cite, notice] of checks) {
      const head = readFileSync(join(AUTHORITY_DIR, ...rel), "utf8").slice(0, 500);
      expect(head, rel.join("/")).toContain("SOURCE TEXT");
      expect(head, rel.join("/")).toContain(cite);
      expect(head, rel.join("/")).toMatch(/Retrieved \d{4}-\d{2}-\d{2} from https:\/\//);
      // These are edicts of government. Saying so in the file is what keeps
      // them distinguishable from the LICENSED FASB material in the same tree,
      // which must never be published (see docs/authorities/README.md).
      expect(head, rel.join("/")).toContain(notice);
    }
  });

  it("the authorities module reads as teaching, not as a data dump", () => {
    // Standing rule 29: plain English is a deliverable. The soWhat fields are
    // what Michael actually reads, so this asserts they are substantial prose
    // rather than a restatement of the quote.
    const src = readFileSync(SOURCE_PATH, "utf8");
    expect(src).toContain("replace my grandfather");
    for (const a of PAYROLL_ONBOARDING_AUTHORITIES) {
      expect(a.soWhat, `${a.id}`).not.toBe(a.quote);
      // A so-what that merely repeats the citation teaches nothing.
      expect(a.soWhat.split(/\s+/).length, `${a.id} soWhat word count`).toBeGreaterThan(35);
    }
  });
});

// ---------------------------------------------------------------------------
// 7) THE ROUTER ITSELF — checked against the corpus on disk, not against a twin
// ---------------------------------------------------------------------------

/**
 * books-45. WHY THIS BLOCK EXISTS.
 *
 * The citation-to-filename routing lives in two places inside
 * `verify-verbatim-quotes.ts`: the commented branches of `sourceFileFor`, and
 * the `MIRRORED_CORPORA` table used by `expectedCorpusFile`. A test already
 * asserted the two agree. It passed for many slices while BOTH were wrong.
 *
 * The RCW pattern captured `[\d.]+` — digits and dots — which cannot express
 * the letter in a Washington chapter number. "RCW 50A.10.030(7)(c)" therefore
 * captured "50", and the verifier went looking for `rcw-50.txt`. That is not
 * merely a missing file: chapter 50 is the UNEMPLOYMENT act and chapter 50A is
 * the PAID FAMILY AND MEDICAL LEAVE act. Had a `rcw-50.txt` ever been placed on
 * disk, four PFML quotes would have been cheerfully "verified" against an
 * entirely different statute.
 *
 * The agreement test could never have caught this, because a bug copied into
 * both implementations produces perfect agreement. So this block does the thing
 * that agreement cannot do: it checks the ROUTED PATH against GROUND TRUTH —
 * the filenames that actually exist in the corpus directory (rule 78).
 */
describe("the citation router is checked against the corpus, not against itself", () => {
  const WA_DIR = join(AUTHORITY_DIR, "state-wa");

  it("every mirrored WA file is reachable from some citation the router produces", () => {
    // GROUND TRUTH: what is actually on disk.
    const onDisk = readdirSync(WA_DIR).filter((f) => f.startsWith("rcw-") && f.endsWith(".txt"));
    expect(onDisk.length, "the WA corpus should not be empty").toBeGreaterThan(0);

    // What the router asks for, across every RCW citation in the whole registry.
    // Recorded debt is excluded BY ID, exactly as the verifier excludes it.
    // Those authorities are knowingly unmirrored and are tracked in the ledger
    // asserted above; this test is about ROUTING, not about the debt pile.
    const debt = new Set(KNOWN_UNMIRRORED_AUTHORITY_IDS);
    const asked = new Set<string>();
    for (const a of GUIDANCE_AUTHORITIES) {
      if (!a.cite.startsWith("RCW ")) continue;
      if (debt.has(a.id)) continue;
      const expected = expectedCorpusFile(a.cite, AUTHORITY_DIR);
      if (expected) asked.add(basename(expected.path));
    }
    // Non-vacuity: if this ever routed nothing, the assertion below would pass
    // by examining an empty set — the classic check that cannot fail.
    expect(asked.size, "no RCW citations were routed at all").toBeGreaterThan(5);

    // THE ASSERTION THAT MATTERS: no citation may route to a WA filename that
    // does not exist, UNLESS that authority is recorded debt. This is what
    // would have caught `rcw-50.txt` on the day the bug was introduced.
    const phantom = [...asked].filter((f) => !onDisk.includes(f));
    expect(
      phantom,
      `the router asks for WA files that do not exist: ${phantom.join(", ")}. ` +
        `Either the cite-to-file mapping is truncating something (the 50A bug), ` +
        `or the source was never fetched. Do NOT create an empty file to satisfy this.`,
    ).toEqual([]);
  });

  it("a lettered chapter keeps its letter — the exact bug books-45 fixed", () => {
    // Regression lock. If someone restores `[\d.]+`, these two die immediately.
    const pfml = expectedCorpusFile("RCW 50A.10.030(7)(c)", AUTHORITY_DIR);
    expect(pfml, "RCW 50A must route somewhere").not.toBeNull();
    expect(basename((pfml as { path: string }).path)).toBe("rcw-50A.10.030.txt");

    const ltc = expectedCorpusFile("RCW 50B.04.080(1)", AUTHORITY_DIR);
    expect(ltc, "RCW 50B must route somewhere").not.toBeNull();
    expect(basename((ltc as { path: string }).path)).toBe("rcw-50B.04.080.txt");

    // AND IT MUST NOT COLLAPSE ONTO THE NEIGHBOURING ACT. This is the assertion
    // that states the danger out loud: 50, 50A and 50B are three different
    // statutes, and routing any of them onto another is worse than failing.
    const ui = expectedCorpusFile("RCW 50.24.010", AUTHORITY_DIR);
    expect(basename((ui as { path: string }).path)).toBe("rcw-50.24.010.txt");
    expect(basename((pfml as { path: string }).path)).not.toBe(
      basename((ui as { path: string }).path),
    );
    expect(basename((ltc as { path: string }).path)).not.toBe(
      basename((ui as { path: string }).path),
    );
  });

  it("THE TRUNCATING PATTERN IS PROVABLY CAUGHT (rule 15: failable, for the right reason)", () => {
    // A check that cannot fail is not a check. This drives the OLD, broken
    // pattern by hand and proves the assertion above would have gone red —
    // so the regression lock is not decorative.
    const broken = /^RCW ([\d.]+)/.exec("RCW 50A.10.030(7)(c)");
    expect(broken, "the old pattern did match — it matched the WRONG thing").not.toBeNull();
    expect((broken as RegExpExecArray)[1]).toBe("50");
    expect(`rcw-${(broken as RegExpExecArray)[1]}.txt`).toBe("rcw-50.txt");

    // And that file has never existed, which is why nine quotes failed.
    expect(readdirSync(WA_DIR)).not.toContain("rcw-50.txt");
  });

  it("the two routers agree on every RCW citation — necessary, but not sufficient", () => {
    // Kept deliberately, and deliberately labelled. Agreement is still worth
    // asserting: a future edit to one copy alone should be caught. It simply
    // must never again be MISTAKEN for verification, which is why it sits
    // BELOW the ground-truth checks rather than standing in for them.
    let compared = 0;
    for (const a of GUIDANCE_AUTHORITIES) {
      if (!a.cite.startsWith("RCW ")) continue;
      const viaTable = expectedCorpusFile(a.cite, AUTHORITY_DIR);
      const viaBranch = sourceFileFor(a.cite, AUTHORITY_DIR);
      if (viaBranch === null) continue; // file absent; the block above owns that case
      expect(basename(viaBranch), `${a.id}: the two routers disagree`).toBe(
        basename((viaTable as { path: string }).path),
      );
      compared += 1;
    }
    expect(compared, "nothing was actually compared").toBeGreaterThan(5);
  });
});
