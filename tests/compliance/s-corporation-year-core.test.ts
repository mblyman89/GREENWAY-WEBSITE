/**
 * tests/compliance/s-corporation-year-core.test.ts   (books-21)
 *
 * THE REGRESSION TEST FOR A SHIPPED, MERGED, MONEY-COSTING DEFECT.
 *
 * books-19 and books-20 both hardcoded `FIRST_S_CORP_YEAR = 2026`, which forced
 * Greenway's 2026 opening AAA to zero. Greenway has been an S corporation since
 * roughly 2015/2016, so that threw away about a decade of already-taxed
 * retained earnings and turned tax-free distributions into reported capital
 * gain under §1368(b)(2).
 *
 * Standing rule 19: the owner's real-world failures become a permanent test
 * corpus. This file is the same principle applied to MY failure. The section
 * marked "THE SHIPPED DEFECT" fails if anyone ever reintroduces it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import {
  type SElectionFacts,
  EARLIEST_PLAUSIBLE_S_ELECTION_YEAR,
  LAST_SUPPORTED_YEAR,
  SYSTEM_START_YEAR,
  S_ELECTION_AS_STATED_BY_OWNER,
  S_ELECTION_REFUSAL_CODES,
  S_ELECTION_UNKNOWN,
  aaaMustOpenAtZero,
  classifySYear,
  describeOpeningBalanceSource,
  openingBalancesMustBeCarriedForward,
  validateSElectionFacts,
} from "@/lib/accounting/s-corporation-year-core";

/** Michael's real situation, once the year is pinned down. */
const evidenced = (year: number): SElectionFacts => ({
  year,
  evidenceSource: "oldest Form 1120-S on hand, page 1",
  statedRange: null,
});

const codes = (rs: readonly { code: string }[]): string[] => rs.map((r) => r.code);

// ---------------------------------------------------------------------------

describe("A1: the two constants are different facts and must not be conflated", () => {
  it("SYSTEM_START_YEAR is the books cutover, 2026", () => {
    // Standing rule 10's line in the sand. If this moves, the database check
    // constraint `gl_periods check (fiscal_year between 2026 and 2100)` and the
    // period-close engine disagree with the basis engine.
    expect(SYSTEM_START_YEAR).toBe(2026);
  });

  it("there is no exported constant claiming to know the election year", async () => {
    // THE STRUCTURAL POINT OF THE WHOLE SLICE. A constant cannot be evidence.
    // If someone "helpfully" adds `export const S_ELECTION_YEAR = 2016` this
    // fails, because that is a guess wearing a constant's clothing.
    const mod = await import("@/lib/accounting/s-corporation-year-core");
    // EARLIEST_PLAUSIBLE_S_ELECTION_YEAR is deliberately excluded: it is a
    // typo bound (1958, when Subchapter S was enacted), not a claim about THIS
    // taxpayer's election. The first draft of this test caught it and was
    // right to make me justify the exclusion out loud rather than widen the
    // regex silently. Rule 22 \u2014 the test was the suspect, and the suspect was
    // acquitted on the evidence.
    const names = Object.keys(mod).filter(
      (k) =>
        /S_?ELECTION.*YEAR|YEAR.*S_?ELECTION/i.test(k) &&
        k !== "EARLIEST_PLAUSIBLE_S_ELECTION_YEAR" &&
        typeof mod[k as never] === "number",
    );
    expect(names).toEqual([]);
  });

  it("the old conflated name is gone from ALL THREE modules", async () => {
    // BOOKS-21 MUTATION HARNESS FOUND THE HOLE IN THIS TEST.
    //
    // As first written this checked only the two engines the defect shipped in.
    // The harness then reintroduced `export const FIRST_S_CORP_YEAR = 2026` into
    // s-corporation-year-core.ts \u2014 the module written to PREVENT that exact
    // defect \u2014 and the mutant SURVIVED. The regression test was guarding the
    // two places the bug had already been fixed and not the one place it would
    // next appear.
    //
    // That is standing rule 22 on a test I wrote in this same slice, and rule 23:
    // the class is "no module anywhere re-exports this name", not "these two
    // modules do not".
    const basis = await import("@/lib/accounting/basis-aaa-core");
    const cogs = await import("@/lib/accounting/cogs-position-core");
    const syear = await import("@/lib/accounting/s-corporation-year-core");
    expect("FIRST_S_CORP_YEAR" in basis).toBe(false);
    expect("FIRST_S_CORP_YEAR" in cogs).toBe(false);
    expect("FIRST_S_CORP_YEAR" in syear).toBe(false);
  });

  it("no accounting module anywhere declares FIRST_S_CORP_YEAR", () => {
    // The same requirement enforced against the SOURCE TREE rather than against
    // a list of imports, so a new module cannot reintroduce the name simply by
    // not being on the list above.
    const dir = join(__dirname, "..", "..", "src", "lib", "accounting");
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts")) continue;
      const body = readFileSync(join(dir, f), "utf8");
      // Match a DECLARATION, not the explanatory prose in the header comments
      // that documents why the name was removed.
      if (/^\s*export const FIRST_S_CORP_YEAR\b/m.test(body)) offenders.push(f);
    }
    expect(offenders, `FIRST_S_CORP_YEAR declared in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("that source scan is not vacuous", () => {
    // Rule 39: prove it reads real files and would see the name if present.
    const dir = join(__dirname, "..", "..", "src", "lib", "accounting");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(10);
    expect(/^\s*export const FIRST_S_CORP_YEAR\b/m.test("export const FIRST_S_CORP_YEAR = 2026;")).toBe(true);
    // And a mention inside a comment must NOT trip it, or the fix documentation
    // in basis-aaa-core.ts would fail this test.
    expect(/^\s*export const FIRST_S_CORP_YEAR\b/m.test("// FIRST_S_CORP_YEAR was removed")).toBe(false);
  });

  it("the plausibility floor predates Subchapter S but not by much", () => {
    // 1958 is when Subchapter S was enacted. The bound exists to catch typos,
    // not to make a legal ruling.
    expect(EARLIEST_PLAUSIBLE_S_ELECTION_YEAR).toBe(1958);
    expect(EARLIEST_PLAUSIBLE_S_ELECTION_YEAR).toBeLessThan(SYSTEM_START_YEAR);
  });
});

describe("A2: THE SHIPPED DEFECT — 2026 is not automatically the first S year", () => {
  it("2026 is a CONTINUING year for a taxpayer who elected in 2016", () => {
    // This single assertion is the bug. Before books-21 the engine behaved as
    // though this were "first_s_year" no matter what the taxpayer's history was.
    expect(classifySYear(2026, evidenced(2016))).toBe("continuing_s_year");
  });

  it("and so its AAA must NOT be forced to zero", () => {
    expect(aaaMustOpenAtZero(2026, evidenced(2016))).toBe(false);
  });

  it("and it DOES have to carry its opening balances forward", () => {
    // The second half of the defect: 2026 used to be exempt from this too, so
    // it was the one year that could be plugged in silence.
    expect(openingBalancesMustBeCarriedForward(2026, evidenced(2016))).toBe(true);
  });

  it("2026 IS the first S year only if the election really started in 2026", () => {
    // Proving the fix did not simply invert the bug. A genuine 2026 election
    // still gets first-year treatment.
    expect(classifySYear(2026, evidenced(2026))).toBe("first_s_year");
    expect(aaaMustOpenAtZero(2026, evidenced(2026))).toBe(true);
    expect(openingBalancesMustBeCarriedForward(2026, evidenced(2026))).toBe(false);
  });

  it("either end of Michael's stated range makes 2026 a continuing year", () => {
    // Why the ambiguity is safe to refuse on rather than urgent to resolve:
    // 2015 and 2016 disagree about how much AAA there is, but they AGREE that
    // 2026 is not a first year. The correction does not depend on the answer.
    for (const y of [2015, 2016]) {
      expect(classifySYear(2026, evidenced(y))).toBe("continuing_s_year");
      expect(aaaMustOpenAtZero(2026, evidenced(y))).toBe(false);
    }
  });
});

describe("A3: unknown is a THIRD answer, never a silent false", () => {
  it("an unknown election year classifies as unknown, not as continuing", () => {
    expect(classifySYear(2026, S_ELECTION_UNKNOWN)).toBe("unknown");
  });

  it("an unknown election year never asserts the AAA opens at zero", () => {
    // The dangerous direction. A boolean-returning helper that answered `true`
    // here would zero a decade of earnings on the strength of a missing fact.
    expect(aaaMustOpenAtZero(2026, S_ELECTION_UNKNOWN)).toBe(false);
  });

  it("nor does it demand a carry-forward it cannot justify", () => {
    // The other direction: piling a derived complaint on top of the real one
    // buries the real one.
    expect(openingBalancesMustBeCarriedForward(2026, S_ELECTION_UNKNOWN)).toBe(false);
  });

  it("a non-integer fiscal year is unknown rather than throwing", () => {
    expect(classifySYear(2026.5, evidenced(2016))).toBe("unknown");
    expect(classifySYear(Number.NaN, evidenced(2016))).toBe("unknown");
  });

  it("a year BEFORE the election is unknown, not continuing", () => {
    // 2015 was not an S year at all if the election began in 2016. Calling it
    // "continuing" would invite the basis machinery to run on a Schedule C year.
    expect(classifySYear(2015, evidenced(2016))).toBe("unknown");
  });
});

describe("A4: the owner's own words are recorded and they REFUSE", () => {
  it("what Michael said is stored verbatim", () => {
    // Rule 24 applies to the taxpayer's statements too. "late 2015 - early
    // 2016" is what he said; neither end of it is what he said.
    expect(S_ELECTION_AS_STATED_BY_OWNER.statedRange).toBe("late 2015 - early 2016");
  });

  it("and it is NOT resolved into a year", () => {
    expect(S_ELECTION_AS_STATED_BY_OWNER.year).toBeNull();
  });

  it("so the system refuses with the AMBIGUOUS code, not the UNKNOWN one", () => {
    // The distinction matters to the person reading the message. "You told me
    // two years" is actionable. "I don't know" makes him hunt for a document
    // he has already said he cannot find.
    const rs = validateSElectionFacts(S_ELECTION_AS_STATED_BY_OWNER, 2026);
    expect(codes(rs)).toContain("S_ELECTION_YEAR_AMBIGUOUS");
    expect(codes(rs)).not.toContain("S_ELECTION_YEAR_UNKNOWN");
  });

  it("and the refusal quotes the range back to him", () => {
    const rs = validateSElectionFacts(S_ELECTION_AS_STATED_BY_OWNER, 2026);
    const r = rs.find((x) => x.code === "S_ELECTION_YEAR_AMBIGUOUS");
    expect(r?.message).toContain("late 2015 - early 2016");
  });

  it("the remedy does NOT send him looking for the Form 2553", () => {
    // He said: "I can't find the form 2553 nor can I find the cp261... Please
    // don't make me go find it." A remedy he cannot perform is not a remedy,
    // so it names two documents he actually has.
    const rs = validateSElectionFacts(S_ELECTION_AS_STATED_BY_OWNER, 2026);
    const r = rs.find((x) => x.code === "S_ELECTION_YEAR_AMBIGUOUS");
    expect(r?.whatToDo).toContain("1120-S");
    expect(r?.whatToDo).toContain("transcript");
  });

  it("a bare unknown gets the UNKNOWN code instead", () => {
    const rs = validateSElectionFacts(S_ELECTION_UNKNOWN, 2026);
    expect(codes(rs)).toContain("S_ELECTION_YEAR_UNKNOWN");
    expect(codes(rs)).not.toContain("S_ELECTION_YEAR_AMBIGUOUS");
  });
});

describe("A5: evidence, plausibility and coherence", () => {
  it("a year with no source document is refused — rule 11", () => {
    const rs = validateSElectionFacts({ year: 2016, evidenceSource: null, statedRange: null });
    expect(codes(rs)).toContain("S_ELECTION_YEAR_NOT_EVIDENCED");
  });

  it("whitespace is not a source document", () => {
    // The cheapest way to defeat a null check is a space bar.
    const rs = validateSElectionFacts({ year: 2016, evidenceSource: "   ", statedRange: null });
    expect(codes(rs)).toContain("S_ELECTION_YEAR_NOT_EVIDENCED");
  });

  it("a properly evidenced year raises nothing at all", () => {
    expect(validateSElectionFacts(evidenced(2016), 2026)).toEqual([]);
  });

  it("implausible years are refused at both ends", () => {
    for (const y of [1015, 1957, LAST_SUPPORTED_YEAR + 1, 2016.5]) {
      const rs = validateSElectionFacts({ year: y, evidenceSource: "x", statedRange: null });
      expect(codes(rs), `year ${y}`).toContain("S_ELECTION_YEAR_IMPLAUSIBLE");
    }
  });

  it("1958 itself is allowed — the boundary is inclusive", () => {
    // Rule 15: a boundary test that cannot fail proves nothing, so check the
    // first legal value as well as the last illegal one.
    const rs = validateSElectionFacts({
      year: EARLIEST_PLAUSIBLE_S_ELECTION_YEAR,
      evidenceSource: "x",
      statedRange: null,
    });
    expect(codes(rs)).not.toContain("S_ELECTION_YEAR_IMPLAUSIBLE");
  });

  it("an election starting after the year being computed is refused", () => {
    const rs = validateSElectionFacts(evidenced(2030), 2026);
    expect(codes(rs)).toContain("S_ELECTION_YEAR_AFTER_FISCAL_YEAR");
  });

  it("the election year EQUAL to the fiscal year is fine — that is a first year", () => {
    const rs = validateSElectionFacts(evidenced(2026), 2026);
    expect(codes(rs)).not.toContain("S_ELECTION_YEAR_AFTER_FISCAL_YEAR");
  });

  it("that check is skipped when no fiscal year is supplied", () => {
    // Two of these checks are about the facts alone and are useful before a
    // year has been chosen.
    const rs = validateSElectionFacts(evidenced(2030));
    expect(codes(rs)).not.toContain("S_ELECTION_YEAR_AFTER_FISCAL_YEAR");
  });

  it("reports ALL problems at once, not just the first", () => {
    // Sending Michael away three times for three facts is three interruptions.
    const rs = validateSElectionFacts({ year: 1015, evidenceSource: null, statedRange: null });
    expect(codes(rs)).toContain("S_ELECTION_YEAR_IMPLAUSIBLE");
    expect(codes(rs)).toContain("S_ELECTION_YEAR_NOT_EVIDENCED");
  });
});

describe("A6: every declared refusal code is reachable, and every emitted one declared", () => {
  const inputs: Array<[SElectionFacts, number | undefined]> = [
    [S_ELECTION_UNKNOWN, 2026],
    [S_ELECTION_AS_STATED_BY_OWNER, 2026],
    [{ year: 2016, evidenceSource: null, statedRange: null }, 2026],
    [{ year: 1015, evidenceSource: "x", statedRange: null }, 2026],
    [evidenced(2030), 2026],
  ];

  it("reachable — rule 43: a code no path emits is decoration", () => {
    const seen = new Set<string>();
    for (const [f, y] of inputs) for (const c of codes(validateSElectionFacts(f, y))) seen.add(c);
    for (const c of S_ELECTION_REFUSAL_CODES) {
      expect(seen, `refusal code ${c} is unreachable`).toContain(c);
    }
  });

  it("declared — rule 34: the gate runs in both directions", () => {
    const declared = new Set<string>(S_ELECTION_REFUSAL_CODES);
    for (const [f, y] of inputs) {
      for (const c of codes(validateSElectionFacts(f, y))) {
        expect(declared, `emitted undeclared code ${c}`).toContain(c);
      }
    }
  });

  it("every refusal names an authority and a remedy", () => {
    // A refusal without a remedy is a dead end (rule 27).
    for (const [f, y] of inputs) {
      for (const r of validateSElectionFacts(f, y)) {
        expect(r.authorityIds.length, r.code).toBeGreaterThan(0);
        expect(r.whatToDo.length, r.code).toBeGreaterThan(40);
        expect(r.message.length, r.code).toBeGreaterThan(40);
      }
    }
  });
});

describe("A7: the plain-English explanation — rule 29", () => {
  it("explains a first year by citing the regulation, not a convention", () => {
    const s = describeOpeningBalanceSource(2026, evidenced(2026));
    expect(s).toContain("opens at exactly zero");
    expect(s).toContain("1.1368-2(a)(1)");
  });

  it("explains a continuing year by naming the document to go and get", () => {
    const s = describeOpeningBalanceSource(2026, evidenced(2016));
    expect(s).toContain("2016");
    expect(s).toContain("Schedule M-2");
    expect(s).toContain("2025");
    // And it must NOT tell him anything opens at zero, which is the wrong
    // sentence that used to be shown for this exact year.
    expect(s).not.toContain("opens at exactly zero");
  });

  it("says plainly that nothing will be computed while the year is unknown", () => {
    const s = describeOpeningBalanceSource(2026, S_ELECTION_UNKNOWN);
    expect(s).toContain("not recorded");
    expect(s).toContain("Nothing will be computed");
  });

  it("never mentions a form Michael has already said he cannot find", () => {
    for (const f of [evidenced(2016), evidenced(2026), S_ELECTION_UNKNOWN]) {
      expect(describeOpeningBalanceSource(2026, f)).not.toContain("2553");
    }
  });
});
