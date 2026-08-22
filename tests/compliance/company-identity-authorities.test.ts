/**
 * company-identity-authorities.test.ts
 *
 * Guards the authority registry behind the company information screen.
 *
 * The registry is the reason the screen can say "here is the sentence that
 * requires this" rather than "trust me". These tests protect the properties
 * that make a citation worth anything: it resolves, it is attributed to a real
 * mirrored document, it is not silently empty, and it is reachable from the
 * shared guidance engine so a citation means the same thing here as everywhere
 * else in the books.
 *
 * Standing rules exercised: 24 (the quote is sacred), 26 (every engine ships a
 * mentor layer), 39 (guard vacuous reads), 40 (load-bearing rules get tested),
 * 48 (a check that cannot classify its input must FAIL, not skip).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  COMPANY_IDENTITY_AUTHORITIES,
  type CompanyIdentityAuthority,
} from "@/lib/accounting/company-identity-authorities";
import { GUIDANCE_AUTHORITIES } from "@/lib/accounting/books-guidance-core";
// Standing rule 25: EXTEND, do not duplicate. The verbatim gate already knows
// how a citation maps to a mirrored file, and the first draft of this test
// reimplemented that mapping from memory - inventing "IRS Publication 15 (2026)"
// when the real shape is "IRS Pub. 15 (2026)". Six citations reported as
// unclassifiable. The test failed rather than skipping, which is rule 48 working,
// and the correct repair was to import the resolver instead of guessing at it.
import { expectedCorpusFile } from "../../scripts/verify-verbatim-quotes";

/** The count is asserted so that a deletion is a test failure, not a silence. */
const EXPECTED_COUNT = 28;

describe("the company identity authority registry is real", () => {
  it("holds the authorities the screen was built against", () => {
    expect(COMPANY_IDENTITY_AUTHORITIES.length).toBe(EXPECTED_COUNT);
  });

  it("is not empty, because an empty registry passes every citation check vacuously", () => {
    // Rule 39. Every other test in this file would pass against an empty array,
    // so this is the one that has to be stated outright.
    expect(COMPANY_IDENTITY_AUTHORITIES.length).toBeGreaterThan(0);
  });

  it("has no duplicate ids", () => {
    const ids = COMPANY_IDENTITY_AUTHORITIES.map((a) => a.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  it("gives every authority a kind the guidance engine can classify", () => {
    // Rule 48: an unclassifiable kind must be visible here rather than render
    // as a blank badge on the screen.
    const allowed = new Set(["irs_guidance", "statute"]);
    const bad = COMPANY_IDENTITY_AUTHORITIES.filter((a) => !allowed.has(a.kind));
    expect(bad.map((a) => `${a.id}:${a.kind}`)).toEqual([]);
  });

  it("gives every authority a non-trivial quote, cite, plain-English reading and source", () => {
    const problems: string[] = [];
    for (const a of COMPANY_IDENTITY_AUTHORITIES) {
      if (a.quote.trim().length < 20) problems.push(`${a.id}: quote too short to be a quotation`);
      if (a.cite.trim().length < 10) problems.push(`${a.id}: cite too short to locate anything`);
      // soWhat is the plain-English interpretation Michael asked for by name.
      if (a.soWhat.trim().length < 40) problems.push(`${a.id}: soWhat too short to explain anything`);
      if (!/^https?:\/\//.test(a.source)) problems.push(`${a.id}: source is not a URL`);
    }
    expect(problems).toEqual([]);
  });

  it("never lets the plain-English reading be a copy of the quote", () => {
    // A soWhat that restates the quote teaches nothing. Michael asked for the
    // interpretation as well as the citation, and these are two jobs.
    const lazy = COMPANY_IDENTITY_AUTHORITIES.filter(
      (a) => a.soWhat.trim().toLowerCase() === a.quote.trim().toLowerCase(),
    );
    expect(lazy.map((a) => a.id)).toEqual([]);
  });
});

describe("citations point at documents we actually hold", () => {
  /**
   * The verbatim gate (scripts/verify-verbatim-quotes.ts) proves the quoted
   * TEXT matches the mirror. This proves the ATTRIBUTION: that every cite names
   * a document the mirror-resolver recognises and that the file is really on
   * disk. The two together are what let somebody other than me check the work.
   */
  it("classifies every cite and finds every mirrored file on disk", () => {
    const resolved: string[] = [];
    const problems: string[] = [];

    for (const a of COMPANY_IDENTITY_AUTHORITIES) {
      const expected = expectedCorpusFile(a.cite);
      if (!expected) {
        // Rule 48: a cite this resolver cannot classify is a FAILURE, not a
        // skip. Skipping is precisely how an uncheckable citation ships.
        problems.push(`${a.id}: no corpus recognises cite "${a.cite}"`);
        continue;
      }
      try {
        const text = readFileSync(expected.path, "utf8");
        if (text.length < 1000) problems.push(`${a.id}: mirror at ${expected.path} is suspiciously small`);
        else resolved.push(a.id);
      } catch {
        problems.push(`${a.id}: cite resolves to ${expected.path} and no such file exists`);
      }
    }

    expect(problems).toEqual([]);
    // Rule 39: prove the loop did work rather than finding nothing to do.
    expect(resolved.length).toBe(EXPECTED_COUNT);
  });

  it("draws on all three document families the screen was built from", () => {
    // Pub. 15 says what an EIN IS, the form instructions say which BOX it goes
    // in, and the RCW says what Washington requires. A screen citing only one
    // of the three would have been built from one point of view.
    const corpora = new Set(
      COMPANY_IDENTITY_AUTHORITIES.map((a) => expectedCorpusFile(a.cite)?.corpus).filter(Boolean),
    );
    expect(corpora.has("IRS Publication")).toBe(true);
    expect(corpora.has("IRS Form Instructions")).toBe(true);
    expect(corpora.has("RCW")).toBe(true);
  });
});

describe("the registry is wired into the shared guidance engine", () => {
  /**
   * Rule 16: prove the gate is WIRED. A registry that compiles but is never
   * merged into GUIDANCE_AUTHORITIES would mean the mentor panel elsewhere in
   * the books cannot resolve these ids, and the failure would be invisible.
   */
  it("exposes every company identity authority through GUIDANCE_AUTHORITIES", () => {
    const merged = new Set(GUIDANCE_AUTHORITIES.map((a) => a.id));
    const absent = COMPANY_IDENTITY_AUTHORITIES.filter((a) => !merged.has(a.id)).map((a) => a.id);
    expect(absent).toEqual([]);
  });

  it("carries the quote through the merge unchanged", () => {
    // The adapter in books-guidance-core.ts copies fields one by one. If it
    // ever dropped or rewrote the quote, the screen would cite a sentence the
    // verbatim gate never checked.
    const byId = new Map(GUIDANCE_AUTHORITIES.map((a) => [a.id, a]));
    const drifted: string[] = [];
    for (const a of COMPANY_IDENTITY_AUTHORITIES) {
      const m = byId.get(a.id);
      if (!m) continue;
      if (m.quote !== a.quote) drifted.push(a.id);
      if (m.cite !== a.cite) drifted.push(`${a.id} (cite)`);
    }
    expect(drifted).toEqual([]);
  });
});

describe("the Form 941 Part 5 signer rules are complete", () => {
  /**
   * These five records exist because company_profile.entity_type accepts nine
   * values. My first draft covered only five of them and returned null for the
   * rest, which would have been standing rule 48 quoted as an excuse for
   * unfinished work. The gate in company-identity-core.ts now proves the two
   * lists agree; this asserts the raw material it needs is present.
   */
  const SIGNER_IDS = [
    "i941-2026-signer-sole-proprietor",
    "i941-2026-signer-corporation",
    "i941-2026-signer-partnership",
    "i941-2026-signer-single-member-llc",
    "i941-2026-signer-trust-or-estate",
  ];

  it("holds a signer authority for each of the five entity groups the IRS lists", () => {
    const ids = new Set(COMPANY_IDENTITY_AUTHORITIES.map((a) => a.id));
    const missing = SIGNER_IDS.filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
  });

  it("cites all five to the same Part 5 section of the same instructions", () => {
    const byId = new Map<string, CompanyIdentityAuthority>(COMPANY_IDENTITY_AUTHORITIES.map((a) => [a.id, a]));
    for (const id of SIGNER_IDS) {
      const a = byId.get(id);
      expect(a, `${id} should exist`).toBeDefined();
      expect(a?.cite).toContain("IRS Instructions for Form 941 (2026)");
      expect(a?.cite).toContain("Part 5");
    }
  });

  it("keeps the partnership knowledge-of-affairs requirement in the quote", () => {
    // The partnership rule carries a second requirement the corporate rule does
    // not: knowledge of the affairs of the business. Losing it would flatten a
    // real legal distinction into a generic sentence about authorisation.
    const a = COMPANY_IDENTITY_AUTHORITIES.find((x) => x.id === "i941-2026-signer-partnership");
    expect(a?.quote).toContain("having knowledge of its affairs");
  });
});
