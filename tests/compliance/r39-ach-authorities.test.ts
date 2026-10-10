/**
 * tests/compliance/r39-ach-authorities.test.ts   (R39 S1)
 *
 * Rule 24 made mechanical for the ACH registry, plus the rule 21 wiring proof:
 * the leaf registry is reachable through GUIDANCE_AUTHORITIES under its own
 * "ach" tag, and every citation is ROUTED by the standalone verifier to the
 * very file the record declares (so the script cannot quietly skip it).
 *
 * Each check is paired with a mutation that proves it can say NO (rule 39).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ACH_AUTHORITIES,
  ACH_PUBLICATION_FILES,
  ALL_ACH_AUTHORITY_IDS,
  achAuthorityById,
  achPublicationFileFor,
} from "@/lib/payments/ach-authorities";
import {
  ALL_GUIDANCE_AUTHORITY_KINDS,
  ALL_SOURCE_REGISTRIES,
  GUIDANCE_AUTHORITIES,
  GUIDANCE_KIND_LABELS,
  GUIDANCE_KIND_WEIGHT,
  findGuidanceAuthority,
} from "@/lib/accounting/books-guidance-core";
import { expectedCorpusFile, sourceFileFor } from "../../scripts/verify-verbatim-quotes";

const ROOT = join(__dirname, "..", "..");
const CORPUS = join(ROOT, "docs", "authorities");

function flat(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

describe("the ACH authority registry is populated and well-formed", () => {
  it("has entries (guard the guard: every loop below would pass on an empty array)", () => {
    expect(ACH_AUTHORITIES.length).toBeGreaterThanOrEqual(30);
  });

  it("ids are unique, prefixed ach-, and the runtime id list equals the registry", () => {
    const ids = ACH_AUTHORITIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith("ach-"), id).toBe(true);
    expect([...ALL_ACH_AUTHORITY_IDS].sort()).toEqual([...ids].sort());
  });

  it("no field is blank; quotes are not fragments; explanations are not stubs", () => {
    for (const a of ACH_AUTHORITIES) {
      expect(a.citation.length, `${a.id} citation`).toBeGreaterThan(0);
      expect(a.source.startsWith("https://"), `${a.id} source`).toBe(true);
      expect(flat(a.quote).length, `${a.id} quote too short`).toBeGreaterThan(60);
      expect(flat(a.whatItMeansHere).length, `${a.id} whatItMeansHere stub`).toBeGreaterThan(200);
      expect(flat(a.whatItMeansHere)).not.toContain(flat(a.quote).slice(0, 60));
    }
  });

  it("achAuthorityById finds every entry and can miss", () => {
    for (const a of ACH_AUTHORITIES) expect(achAuthorityById(a.id)).toBe(a);
    expect(achAuthorityById("ach-no-such-id")).toBeNull();
  });

  it("weights are honest: Nacha/bank material is persuasive, statutes and WAC/RCW bind", () => {
    for (const a of ACH_AUTHORITIES) {
      expect(ALL_GUIDANCE_AUTHORITY_KINDS).toContain(a.kind);
      if (a.sourceFile.startsWith("ach/") && a.sourceFile !== "ach/wa-sao-vendor-master-file.txt") {
        expect(a.kind, a.id).toBe("industry_guidance");
      }
      if (/^(RCW|WAC) /.test(a.citation)) expect(a.kind, a.id).toBe("state_law");
      if (/^15 U\.S\.C\./.test(a.citation)) expect(a.kind, a.id).toBe("statute");
    }
    expect(GUIDANCE_KIND_LABELS.industry_guidance).toBe("Industry / bank guidance");
    expect(GUIDANCE_KIND_WEIGHT.industry_guidance).toBe(1);
    // A bank brochure must never be labelled as a government agency's.
    expect(GUIDANCE_KIND_LABELS.industry_guidance).not.toMatch(/agency/i);
  });
});

describe("every ACH quote is verbatim in the mirrored corpus (rule 24)", () => {
  for (const a of ACH_AUTHORITIES) {
    it(`${a.id} is in ${a.sourceFile}`, () => {
      const path = join(CORPUS, a.sourceFile);
      expect(existsSync(path), `${a.sourceFile} missing - must fail, never skip (rule 48)`).toBe(true);
      const corpus = flat(readFileSync(path, "utf8"));
      expect(corpus.includes(flat(a.quote)), `VERBATIM DRIFT in ${a.id}`).toBe(true);
    });
  }

  it("the check is not vacuous: a one-word paraphrase is rejected", () => {
    const real = ACH_AUTHORITIES.find((a) => a.id === "ach-micro-entry-under-one-dollar");
    expect(real).toBeDefined();
    const corpus = flat(readFileSync(join(CORPUS, real!.sourceFile), "utf8"));
    expect(corpus.includes(flat(real!.quote))).toBe(true);
    const mutated = flat(real!.quote).replace("less than $1", "no more than $1");
    expect(mutated).not.toBe(flat(real!.quote));
    expect(corpus.includes(mutated)).toBe(false);
  });

  it("the check is not vacuous: a quote checked against the WRONG file fails", () => {
    const a = ACH_AUTHORITIES.find((x) => x.id === "ach-rcw-1-80-060-signature")!;
    const other = flat(readFileSync(join(CORPUS, "ach", "nacha-micro-entries-phase-1.txt"), "utf8"));
    expect(other.includes(flat(a.quote))).toBe(false);
  });
});

describe("rule 21: the ACH registry is WIRED, not just present", () => {
  it('"ach" is a declared source registry', () => {
    expect(ALL_SOURCE_REGISTRIES).toContain("ach");
  });

  it("every ACH authority is reachable through the merged GUIDANCE_AUTHORITIES", () => {
    for (const a of ACH_AUTHORITIES) {
      const g = findGuidanceAuthority(a.id);
      expect(g, `${a.id} not merged`).toBeDefined();
      expect(g!.quote).toBe(a.quote);
      expect(g!.cite).toBe(a.citation);
      expect(g!.kind).toBe(a.kind);
    }
    const ids = GUIDANCE_AUTHORITIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the standalone verifier ROUTES every ACH citation to the declared file", () => {
  it("sourceFileFor and expectedCorpusFile agree with sourceFile for every record", () => {
    for (const a of ACH_AUTHORITIES) {
      const want = join(CORPUS, a.sourceFile);
      expect(sourceFileFor(a.citation, CORPUS), `${a.id} (${a.citation})`).toBe(want);
      expect(expectedCorpusFile(a.citation, CORPUS)?.path, `${a.id} expectedCorpusFile`).toBe(want);
    }
  });

  it("every publication-table row points at a file that exists and is actually used", () => {
    const used = new Set(ACH_AUTHORITIES.map((a) => a.sourceFile));
    for (const [prefix, file] of Object.entries(ACH_PUBLICATION_FILES)) {
      expect(existsSync(join(CORPUS, file)), `${prefix} -> ${file}`).toBe(true);
      expect(used.has(file), `${file} routed but never cited`).toBe(true);
      expect(achPublicationFileFor(`${prefix}, p. 3`)).toBe(file);
    }
  });

  it("a reworded publication citation is NOT routed (it would be reported, not silently matched)", () => {
    expect(achPublicationFileFor("NACHA, Micro-Entries rule summary")).toBeNull();
    expect(sourceFileFor("Nacha Micro-Entries summary", CORPUS)).toBeNull();
    expect(expectedCorpusFile("Nacha Micro-Entries summary", CORPUS)).toBeNull();
  });

  it("the WAC 314-55-087 route is narrow: a neighbouring section is not routed to it", () => {
    expect(sourceFileFor("WAC 314-55-087(1)", CORPUS)).toBe(join(CORPUS, "state-wa", "wac-314-55-087.txt"));
    expect(sourceFileFor("WAC 314-55-0870", CORPUS)).toBeNull();
    expect(expectedCorpusFile("WAC 314-55-083", CORPUS)).toBeNull();
  });
});
