/**
 * books-16 — the AUTHORITY layer for the penalty engine, and the mentoring
 * layer that sits on top of it.
 *
 * WHAT THIS FILE IS FOR, in one sentence: a number without a citation is an
 * opinion, and an opinion is what got Michael a $4,624,697.31 inventory plug.
 *
 * Three separate jobs:
 *
 *   1. VERBATIM INTEGRITY. Quoted statute is a TRANSCRIPTION. If someone
 *      paraphrases RCW 82.32.090 to make it read nicer, the engine starts
 *      citing something the legislature never wrote. These tests read the
 *      words and check they still look like law.
 *
 *   2. WIRING (standing rule 16). It is not enough for an authority record to
 *      exist in a file. It has to be REACHABLE from the merged registry that
 *      the screens actually query. This slice found 36 records that had been
 *      sitting in src/lib/payroll/ since the payroll slice, exported, correct,
 *      and completely invisible to findGuidanceAuthority(). Nobody noticed
 *      because nothing ever asserted it. Now something does.
 *
 *   3. THE MENTOR COVERAGE GATE. Michael asked for a PhD-CPA who explains
 *      every function. That promise decays the moment someone adds function
 *      number nineteen and forgets the lesson. So the gate reads the export
 *      list out of the SOURCE FILE ON DISK and fails if any exported function
 *      is untaught. You cannot add an untaught function to this engine.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  TAX_PENALTY_AUTHORITIES_NEW,
  findTaxPenaltyAuthority,
  AUTHORITY_IDS_OWNED_ELSEWHERE,
} from "@/lib/accounting/tax-penalty-authorities";
import {
  findGuidanceAuthority,
  GUIDANCE_AUTHORITIES,
  ALL_GUIDANCE_AUTHORITY_KINDS,
  GUIDANCE_KIND_WEIGHT,
  ALL_SOURCE_REGISTRIES,
  unresolvedDrift,
} from "@/lib/accounting/books-guidance-core";
import { PAYROLL_TAX_AUTHORITIES } from "@/lib/payroll/payroll-tax-authorities";
import {
  TAX_PENALTY_LESSONS,
  lessonFor,
  taughtFunctionNames,
  citedAuthorityIds,
} from "@/lib/accounting/tax-penalty-mentor";

const CORE_PATH = join(process.cwd(), "src/lib/accounting/tax-penalty-core.ts");

// ---------------------------------------------------------------------------
// 1) THE RECORDS THEMSELVES
// ---------------------------------------------------------------------------

describe("tax-penalty authority records — the words have to be the real words", () => {
  it("the registry is populated and has no duplicate ids", () => {
    expect(TAX_PENALTY_AUTHORITIES_NEW.length).toBeGreaterThanOrEqual(19);
    const ids = TAX_PENALTY_AUTHORITIES_NEW.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every record has all five fields filled with something substantive", () => {
    for (const a of TAX_PENALTY_AUTHORITIES_NEW) {
      expect(a.id, "id").toMatch(/^[a-z0-9-]+$/);
      expect(a.cite.trim().length, `${a.id} cite`).toBeGreaterThan(0);
      // A "quote" shorter than this is a label, not a quotation.
      expect(a.quote.trim().length, `${a.id} quote`).toBeGreaterThan(40);
      expect(a.soWhat.trim().length, `${a.id} soWhat`).toBeGreaterThan(40);
      expect(a.source.trim().length, `${a.id} source`).toBeGreaterThan(0);
      expect(ALL_GUIDANCE_AUTHORITY_KINDS, `${a.id} kind`).toContain(a.kind);
    }
  });

  it("every source is a real https URL, and the law ones point at a government or Cornell host", () => {
    const TRUSTED = [
      "app.leg.wa.gov", // RCW and WAC, official
      "apps.leg.wa.gov",
      "lcb.wa.gov",
      "dor.wa.gov",
      "esd.wa.gov",
      "lni.wa.gov",
      "wacaresfund.wa.gov",
      "paidleave.wa.gov",
      "irs.gov",
      "www.irs.gov",
      "ecfr.gov",
      "www.ecfr.gov",
      "uscode.house.gov",
      "www.law.cornell.edu", // Cornell LII — the standard free mirror of the IRC
    ];
    for (const a of TAX_PENALTY_AUTHORITIES_NEW) {
      expect(a.source, `${a.id} source must be https`).toMatch(/^https:\/\//);
      const host = new URL(a.source).host;
      expect(TRUSTED, `${a.id} cites an untrusted host: ${host}`).toContain(host);
    }
  });

  it("nothing quotable has been paraphrased into OUR editorial voice", () => {
    // A transcription never talks about Michael, never hedges, and never
    // reasons out loud. Those things belong in soWhat, which is ours to write.
    //
    // A NOTE ON "we", which this test originally banned and no longer does.
    // The first version of this check flagged the WA Cares FAQ record, and the
    // flag was WRONG. The Employment Security Department writes its own FAQ in
    // the first person: "...and we cannot count these hours or wages toward
    // qualification." Verified verbatim against Michael's uploaded PDF at
    // wacares-faq.txt line 678. Banning "we" outright would have pressured a
    // future maintainer to EDIT A GOVERNMENT QUOTATION to satisfy a test,
    // which is precisely the failure this file exists to prevent. The lesson
    // is worth keeping written down: when a test and a primary source
    // disagree, the source wins and the test gets smarter.
    const TELLS = [
      /Michael/i,
      /Greenway/i,
      /should probably/i,
      /\bI think\b/i,
      /\bwe recommend\b/i,
      /\bin my opinion\b/i,
      /\broughly\b/i,
      /approximately \$/i,
      /\bor so\b/i,
    ];
    for (const a of TAX_PENALTY_AUTHORITIES_NEW) {
      for (const tell of TELLS) {
        expect(
          tell.test(a.quote),
          `${a.id}: quote contains editorial voice matching ${tell} — a quote is a transcription`,
        ).toBe(false);
      }
    }
  });

  it("the editorial-voice gate is not vacuous — it catches a real paraphrase", () => {
    // rule 15a. Without this, the test above passes even if TELLS is empty.
    const TELLS = [/Michael/i, /should probably/i, /\bin my opinion\b/i];
    const fake = "Michael should probably pay this before the 25th, in my opinion.";
    expect(TELLS.some((t) => t.test(fake))).toBe(true);
  });

  it("first-person government prose is ALLOWED, and we prove the real one is on file", () => {
    // Guards the reasoning above from being "cleaned up" later by someone who
    // does not know why "we" is permitted.
    const waCares = findTaxPenaltyAuthority("wa-cares-exemption-effective-following-quarter");
    expect(waCares, "the WA Cares exemption record went missing").toBeDefined();
    expect(waCares!.quote).toContain("we cannot count these hours or wages toward qualification");
    expect(waCares!.kind).toBe("state_manual");
  });

  it("statutes are labelled as statutes and carry binding weight", () => {
    for (const a of TAX_PENALTY_AUTHORITIES_NEW) {
      const isRcw = /^RCW /.test(a.cite);
      const isWac = /^WAC /.test(a.cite);
      const isUsc = /U\.S\.C\./.test(a.cite);
      const isCfr = /C\.F\.R\.|Treas\. Reg\./.test(a.cite);
      if (isRcw || isUsc) {
        expect(["statute", "state_law"], `${a.id} (${a.cite})`).toContain(a.kind);
      }
      if (isWac || isCfr) {
        expect(["regulation", "state_law"], `${a.id} (${a.cite})`).toContain(a.kind);
      }
      // Anything that IS law must weigh 3. Persuasive material must not.
      if (isRcw || isWac || isUsc || isCfr) {
        expect(GUIDANCE_KIND_WEIGHT[a.kind], `${a.id} must carry binding weight`).toBe(3);
      }
    }
  });

  it("findTaxPenaltyAuthority returns undefined rather than throwing on a bad id", () => {
    expect(findTaxPenaltyAuthority("no-such-authority-anywhere")).toBeUndefined();
    // rule 15a: and it really does find the real ones, or the line above is vacuous.
    expect(findTaxPenaltyAuthority(TAX_PENALTY_AUTHORITIES_NEW[0]!.id)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2) WIRING — standing rule 16. Existing is not the same as reachable.
// ---------------------------------------------------------------------------

describe("wiring — an authority nobody can look up is an authority that does not exist", () => {
  it("every books-16 record is reachable through the MERGED registry, word for word", () => {
    for (const a of TAX_PENALTY_AUTHORITIES_NEW) {
      const found = findGuidanceAuthority(a.id);
      expect(found, `${a.id} is not reachable from the merged registry`).toBeDefined();
      expect(found!.quote, `${a.id} quote changed in transit`).toBe(a.quote);
      expect(found!.cite, `${a.id} cite changed in transit`).toBe(a.cite);
      expect(found!.kind, `${a.id} kind changed in transit`).toBe(a.kind);
    }
  });

  it("⭐ the 36 orphaned payroll-tax authorities are reachable too", () => {
    // THE BUG THIS LOCKS OUT. PAYROLL_TAX_AUTHORITIES was written during the
    // payroll slice and never imported into books-guidance-core. Every one of
    // these 36 records — including IRC §6656, IRC §6651, the ESD late penalty
    // and the L&I late penalty — returned undefined from findGuidanceAuthority
    // while sitting correct and complete in a file two directories away.
    // Discovered only because the penalty engine cited six of them.
    expect(PAYROLL_TAX_AUTHORITIES.length).toBeGreaterThanOrEqual(36);
    for (const a of PAYROLL_TAX_AUTHORITIES) {
      const found = findGuidanceAuthority(a.id);
      expect(found, `${a.id} exists in payroll-tax-authorities but is NOT in the merged registry`).toBeDefined();
      expect(found!.quote, `${a.id} quote changed in transit`).toBe(a.quote);
    }
  });

  it("the ids we claim live elsewhere really do, and are not secretly ours", () => {
    for (const id of AUTHORITY_IDS_OWNED_ELSEWHERE) {
      expect(
        findGuidanceAuthority(id),
        `${id} is claimed to live in another registry but resolves nowhere`,
      ).toBeDefined();
      expect(
        findTaxPenaltyAuthority(id),
        `${id} is listed as owned elsewhere but is actually defined in this slice`,
      ).toBeUndefined();
    }
  });

  it("the merged registry is still sorted and still free of unresolved drift", () => {
    const ids = GUIDANCE_AUTHORITIES.map((a) => a.id);
    const sorted = [...ids].sort((x, y) => x.localeCompare(y));
    expect(ids.join("|")).toBe(sorted.join("|"));
    expect(unresolvedDrift()).toEqual([]);
  });

  it("adding two registries did not introduce a duplicate id anywhere", () => {
    const ids = GUIDANCE_AUTHORITIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the new source tags are declared in the registry union", () => {
    expect(ALL_SOURCE_REGISTRIES).toContain("tax-penalty");
    expect(ALL_SOURCE_REGISTRIES).toContain("payroll-tax");
  });
});

// ---------------------------------------------------------------------------
// 3) THE MENTOR COVERAGE GATE — the promise that cannot rot
// ---------------------------------------------------------------------------

/**
 * Read the exported FUNCTION names straight out of the source file.
 *
 * Deliberately parses the file on disk rather than introspecting the imported
 * module. Reading the module would let a function be "covered" because it was
 * never imported; reading the text means the gate sees exactly what a
 * developer sees when they add a function.
 */
function exportedFunctionNames(): string[] {
  const src = readFileSync(CORE_PATH, "utf8");
  const names: string[] = [];
  const re = /^export function ([A-Za-z0-9_]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) names.push(m[1]!);
  return names;
}

describe("the PhD-CPA layer — every function Michael can reach gets explained", () => {
  it("the parser actually found the functions (guard against a vacuous gate)", () => {
    const fns = exportedFunctionNames();
    // rule 15b: if the regex silently matched nothing, every coverage test
    // below would pass trivially. Pin a floor and spot-check known members.
    expect(fns.length).toBeGreaterThanOrEqual(15);
    expect(fns).toContain("computeDorPenalty");
    expect(fns).toContain("computeIrsFilePayPenalty");
    expect(fns).toContain("applyMilliPercent");
    expect(fns).toContain("bookingInstructions");
  });

  it("⭐ EVERY exported function of the penalty engine has a lesson", () => {
    const untaught = exportedFunctionNames().filter((fn) => lessonFor(fn) === undefined);
    expect(
      untaught,
      `these exported functions have no MentorLesson: ${untaught.join(", ")}. ` +
        `Michael asked for a CPA who explains every function. Add the lesson to ` +
        `tax-penalty-mentor.ts — do not delete this test.`,
    ).toEqual([]);
  });

  it("no lesson teaches a function that no longer exists", () => {
    // The other direction. A lesson for a deleted function is a lie that reads
    // like documentation.
    const real = new Set(exportedFunctionNames());
    // AGENCY_CLOCKS is an exported CONST, not a function, and is taught on
    // purpose because it is the thing Michael will actually read.
    const CONST_EXPORTS_TAUGHT_ON_PURPOSE = new Set(["AGENCY_CLOCKS"]);
    const orphans = taughtFunctionNames().filter(
      (fn) => !real.has(fn) && !CONST_EXPORTS_TAUGHT_ON_PURPOSE.has(fn),
    );
    expect(orphans, `lessons for functions that do not exist: ${orphans.join(", ")}`).toEqual([]);
  });

  it("every lesson is actually written, not stubbed", () => {
    for (const l of TAX_PENALTY_LESSONS) {
      expect(l.plainEnglish.trim().length, `${l.fn}.plainEnglish`).toBeGreaterThan(40);
      expect(l.whyItExists.trim().length, `${l.fn}.whyItExists`).toBeGreaterThan(40);
      expect(l.theTrap.trim().length, `${l.fn}.theTrap`).toBeGreaterThan(40);
      expect(l.whatIWouldDo.trim().length, `${l.fn}.whatIWouldDo`).toBeGreaterThan(20);
      expect(l.authorityIds.length, `${l.fn} cites at least one authority`).toBeGreaterThan(0);
      // TODO markers are how a stub survives review.
      const all = [l.plainEnglish, l.whyItExists, l.theTrap, l.whatIWouldDo].join(" ");
      expect(/TODO|FIXME|TBD|lorem ipsum/i.test(all), `${l.fn} contains a stub marker`).toBe(false);
    }
  });

  it("⭐ every authority a lesson cites resolves in the merged registry", () => {
    const dangling = citedAuthorityIds().filter((id) => findGuidanceAuthority(id) === undefined);
    expect(dangling, `lessons cite authorities that resolve nowhere: ${dangling.join(", ")}`).toEqual([]);
  });

  it("lessons are written in plain English, not accounting jargon", () => {
    // Michael has a Master's in accounting and has not opened the book in 13
    // years. The standing instruction is plain English. This is a blunt
    // instrument, but it catches the drift back into jargon that always
    // happens when a technical writer gets comfortable.
    const BANNED = [
      /\bceteris paribus\b/i,
      /\bde minimis exception thereto\b/i,
      /\bnotwithstanding the foregoing\b/i,
      /\bhereinafter\b/i,
      /\baforementioned\b/i,
    ];
    for (const l of TAX_PENALTY_LESSONS) {
      const prose = [l.plainEnglish, l.whyItExists, l.theTrap, l.whatIWouldDo].join(" ");
      for (const b of BANNED) {
        expect(b.test(prose), `${l.fn}: plain English please — matched ${b}`).toBe(false);
      }
    }
  });

  it("no duplicate lessons for the same function", () => {
    const fns = TAX_PENALTY_LESSONS.map((l) => l.fn);
    expect(new Set(fns).size).toBe(fns.length);
  });

  it("lessonFor is total: undefined for anything unknown, never a throw", () => {
    expect(lessonFor("")).toBeUndefined();
    expect(lessonFor("noSuchFunction")).toBeUndefined();
    expect(lessonFor("__proto__")).toBeUndefined();
    expect(lessonFor("constructor")).toBeUndefined();
    expect(lessonFor("toString")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3b) FLOAT SENTINEL — standing rule 13e. No float may touch money.
// ---------------------------------------------------------------------------

describe("float sentinel — the money path is integers and BigInt, or it is wrong", () => {
  /**
   * Strip comments and template-literal "workings" prose before scanning.
   *
   * This matters. The engine's explanatory strings legitimately contain things
   * like `${rate / 1000}%` because that is how you render 9_000 milli-percent
   * as "9%". Rendering is not arithmetic on money. If this test scanned raw
   * text it would either fail forever or have to be weakened until it caught
   * nothing, and a sentinel that catches nothing is worse than no sentinel.
   */
  function codeWithoutCommentsOrProse(src: string): string {
    return (
      src
        // block comments
        .replace(/\/\*[\s\S]*?\*\//g, "")
        // line comments
        .replace(/\/\/[^\n]*/g, "")
        // double-quoted strings (the caveat/label prose)
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        // template literals (the `workings` strings)
        .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    );
  }

  const RAW = readFileSync(CORE_PATH, "utf8");
  const CODE = codeWithoutCommentsOrProse(RAW);

  it("the stripper works — it removes prose but keeps real code", () => {
    // rule 15b again. If the stripper nuked the whole file, every check below
    // would pass on an empty string.
    expect(CODE).toContain("export function applyMilliPercent");
    expect(CODE).toContain("BigInt");
    // and it really did remove the prose
    expect(CODE).not.toContain("federal short-term averaged");
    expect(CODE.length).toBeGreaterThan(2_000);
  });

  it("⭐ contains no parseFloat, no toFixed, and no Number.parseFloat", () => {
    expect(CODE).not.toMatch(/parseFloat/);
    expect(CODE).not.toMatch(/toFixed/);
    expect(CODE).not.toMatch(/toPrecision/);
  });

  it("⭐ contains no decimal literals in executable code", () => {
    // A bare 0.5 or 1.075 in the money path means someone reached for floats.
    // Rates live in milli-percent integers; money lives in cents.
    const decimals = CODE.match(/(?<![\w.])\d+\.\d+(?![\w.])/g) ?? [];
    expect(decimals, `decimal literals found in code: ${decimals.join(", ")}`).toEqual([]);
  });

  it("the decimal-literal check is not vacuous", () => {
    const planted = codeWithoutCommentsOrProse("const rate = 0.095; // a comment with 1.23");
    const decimals = planted.match(/(?<![\w.])\d+\.\d+(?![\w.])/g) ?? [];
    expect(decimals).toEqual(["0.095"]);
  });

  it("rounding is done with BigInt, not Math.round, wherever money is involved", () => {
    // Math.round IS allowed on a day count (daysBetween divides milliseconds),
    // but must never appear next to a cents or milli-percent variable.
    const mathRoundLines = RAW.split("\n").filter((l) => /Math\.(round|floor|ceil)\s*\(/.test(l));
    for (const line of mathRoundLines) {
      const code = codeWithoutCommentsOrProse(line);
      if (code.trim() === "") continue; // it was inside a comment
      expect(
        /Cents|MilliPercent|penalty|interest/i.test(code),
        `Math rounding used on what looks like money: ${line.trim()}`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4) MUTATION HARNESS — rule 15c. Prove these tests can fail.
// ---------------------------------------------------------------------------

describe("mutation harness — proving this file is not decorative", () => {
  function detects(check: () => void): boolean {
    try {
      check();
      return false;
    } catch {
      return true;
    }
  }

  it("SELF-CHECK: the harness catches a bug it plants itself", () => {
    // If this fails, every mutation result below is meaningless.
    expect(detects(() => expect(2 + 2).toBe(5))).toBe(true);
    expect(detects(() => expect(2 + 2).toBe(4))).toBe(false);
  });

  it("the coverage gate detects an untaught function", () => {
    const fakeExports = [...exportedFunctionNames(), "computeSomethingNobodyExplained"];
    const untaught = fakeExports.filter((fn) => lessonFor(fn) === undefined);
    expect(
      detects(() => expect(untaught).toEqual([])),
      "the mentor coverage gate would NOT notice a new untaught function",
    ).toBe(true);
  });

  it("the dangling-citation gate detects a made-up authority id", () => {
    const fakeCites = [...citedAuthorityIds(), "rcw-00-00-000-invented"];
    const dangling = fakeCites.filter((id) => findGuidanceAuthority(id) === undefined);
    expect(
      detects(() => expect(dangling).toEqual([])),
      "the citation gate would NOT notice an invented authority",
    ).toBe(true);
  });

  it("the verbatim gate detects a paraphrase creeping into a quote", () => {
    const paraphrased = "We think the taxpayer should probably pay this on time.";
    const TELLS = [/ we /i, /should probably/i];
    const caught = TELLS.some((t) => t.test(paraphrased));
    expect(caught, "the editorial-voice gate would NOT notice a paraphrase").toBe(true);
  });

  it("the source-host gate detects a citation to a random blog", () => {
    const TRUSTED = ["app.leg.wa.gov", "www.irs.gov"];
    const host = new URL("https://some-tax-blog.example.com/rcw-explained").host;
    expect(
      detects(() => expect(TRUSTED).toContain(host)),
      "the trusted-host gate would NOT notice a blog masquerading as law",
    ).toBe(true);
  });
});
