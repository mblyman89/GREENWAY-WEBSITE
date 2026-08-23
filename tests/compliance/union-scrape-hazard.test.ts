/**
 * tests/compliance/union-scrape-hazard.test.ts   (books-39 phase F)
 *
 * A REPO-WIDE GUARD FOR A DEFECT THAT COST A REFUSAL CODE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT HAPPENED
 * ─────────────────────────────────────────────────────────────────────────────
 * Six mentor-gate modules read their engine's refusal codes with the same shape
 * of expression:
 *
 *     text.match(/export type SomeRefusalCode\s*=([\s\S]*?);/)
 *
 * The trailing `;` is intended to be the semicolon that ends the type
 * declaration. It is actually the FIRST semicolon after the declaration starts,
 * and doc-comments between union members are inside that span.
 *
 * `pay-run-core.ts` documented its last refusal code like this:
 *
 *     /** The parts do not re-add to the whole. Never seen; always checked. *␝/
 *     | "DOES_NOT_RECONCILE";
 *
 * The scrape stopped at the semicolon in "Never seen; always checked" and
 * returned six codes where seven exist. `DOES_NOT_RECONCILE` — the code that
 * fires when a paycheque's parts do not add up to its net — became invisible to
 * its own coverage gate, which then found six lessons for six codes and
 * reported complete coverage.
 *
 * Nothing about that is visible in a passing suite. The gate ran. It read a
 * file. It compared two lists. Both lists were wrong in the same direction.
 * Standing rule 39, produced not by a missing check but by ordinary English
 * punctuation inside a comment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS TEST IS REPO-WIDE AND NOT IN pay-run-mentor.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Standing rule 23: fix the CLASS. Correcting the one comment would have made
 * the suite green and left five other gates one semicolon away from the same
 * silent hole. The parser fix lives in `mentor-quote-gate.ts`
 * (`stripTypeScriptComments` / `unionMembersInSource`); this file is the alarm
 * that fires if any engine union ANYWHERE develops the hazard while a gate is
 * still reading it with the naive pattern.
 *
 * At the time of writing, the five pre-existing gates were checked and all five
 * agree under both parsers — so this is not a latent bug report, it is a
 * tripwire. Migrating those five to the shared parser is tracked work rather
 * than a silent rewrite of five passing gates inside a slice about pay runs
 * (standing rule 4).
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  stripTypeScriptComments,
  unionMembersInSource,
} from "@/lib/payroll/mentor-quote-gate";

/**
 * Every engine union that a live mentor gate scrapes with the naive pattern,
 * paired with the engine file the gate points at.
 *
 * Hand-maintained on purpose, and kept honest by the first test below, which
 * fails if a gate module scrapes a union that is not listed here.
 */
const GATE_SCRAPED_UNIONS: ReadonlyArray<{
  readonly gate: string;
  readonly union: string;
  readonly engine: string;
}> = [
  {
    gate: "src/lib/payroll/garnishment-mentor-gates.ts",
    union: "GarnishmentRefusalCode",
    engine: "src/lib/payroll/garnishment-core.ts",
  },
  {
    gate: "src/lib/payroll/net-pay-mentor-gates.ts",
    union: "NetPayRefusalCode",
    engine: "src/lib/payroll/net-pay-core.ts",
  },
  {
    gate: "src/lib/payroll/sick-leave-mentor-gates.ts",
    union: "SickLeaveRefusalCode",
    engine: "src/lib/payroll/sick-leave-core.ts",
  },
  {
    gate: "src/lib/payroll/timesheet-mentor-gates.ts",
    union: "TimesheetRefusalCode",
    engine: "src/lib/payroll/timesheet-core.ts",
  },
  {
    gate: "src/lib/payroll/ytd-mentor-gates.ts",
    union: "YtdRefusalCode",
    engine: "src/lib/payroll/ytd-core.ts",
  },
];

/** The naive pattern, reproduced exactly as the five gates spell it. */
function naiveUnionMembers(text: string, unionName: string): readonly string[] {
  const block = text.match(new RegExp(`export type ${unionName}\\s*=([\\s\\S]*?);`));
  if (!block) return [];
  return [...block[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

describe("the union-scrape hazard is not live anywhere", () => {
  it("every listed engine and gate file actually exists", () => {
    // Without this, a renamed file turns every check below into a no-op that
    // reads an empty string and compares it favourably with itself.
    for (const { gate, engine } of GATE_SCRAPED_UNIONS) {
      expect(existsSync(join(process.cwd(), gate)), `missing gate ${gate}`).toBe(true);
      expect(existsSync(join(process.cwd(), engine)), `missing engine ${engine}`).toBe(true);
    }
  });

  it("each gate really does scrape the union this file claims it does", () => {
    // Keeps the hand-maintained table above honest. If a gate is renamed or
    // repointed, the table goes stale and every assertion below silently
    // guards the wrong thing.
    for (const { gate, union } of GATE_SCRAPED_UNIONS) {
      const src = readFileSync(join(process.cwd(), gate), "utf8");
      expect(src, `${gate} no longer scrapes ${union}`).toContain(`export type ${union}`);
    }
  });

  it.each(GATE_SCRAPED_UNIONS)(
    "$union reads identically with and without comments",
    ({ union, engine }) => {
      const text = readFileSync(join(process.cwd(), engine), "utf8");
      const naive = naiveUnionMembers(text, union);
      const clean = unionMembersInSource(text, union).filter((m) => /^[A-Z_]+$/.test(m));

      // Non-vacuity first: if BOTH are empty the comparison below is
      // meaningless and would pass forever (standing rule 39).
      expect(clean.length, `${union} scraped nothing at all`).toBeGreaterThan(0);

      expect(
        naive,
        `${engine} :: ${union} — the naive scrape used by its mentor gate disagrees with a ` +
          `comment-stripped read. Almost certainly a doc-comment between two union members now ` +
          `contains a semicolon, which truncates the match and silently HIDES every member ` +
          `after it from the coverage gate. Either reword the comment or move that gate onto ` +
          `unionMembersInSource() from mentor-quote-gate.ts.`,
      ).toEqual(clean);
    },
  );
});

describe("stripTypeScriptComments is correct enough to be trusted", () => {
  it("removes a line comment but keeps the code around it", () => {
    expect(stripTypeScriptComments('const a = 1; // drop me\nconst b = 2;')).toBe(
      "const a = 1; \nconst b = 2;",
    );
  });

  it("removes a block comment and preserves its newlines, so line numbers survive", () => {
    const out = stripTypeScriptComments("a\n/* one\ntwo\nthree */\nb");
    expect(out.split("\n")).toHaveLength(5);
    expect(out).toContain("a");
    expect(out).toContain("b");
    expect(out).not.toContain("two");
  });

  it("does NOT treat // inside a string as a comment", () => {
    // The bug a naive strip would introduce: eating the rest of a line that
    // legitimately contains a URL, and with it any union member after it.
    const out = stripTypeScriptComments('const u = "https://example.com"; const v = 1;');
    expect(out).toContain("https://example.com");
    expect(out).toContain("const v = 1;");
  });

  it("does NOT treat a semicolon inside a string as syntax", () => {
    const out = stripTypeScriptComments('const s = "a; b"; const t = 2;');
    expect(out).toContain('"a; b"');
    expect(out).toContain("const t = 2;");
  });

  it("handles escaped quotes without losing the rest of the file", () => {
    const out = stripTypeScriptComments('const s = "he said \\"hi\\""; const t = 3;');
    expect(out).toContain("const t = 3;");
  });

  it("handles template literals", () => {
    const out = stripTypeScriptComments("const s = `a; // b`; const t = 4;");
    expect(out).toContain("const t = 4;");
    expect(out).toContain("a; // b");
  });

  it("leaves a file with no comments completely unchanged", () => {
    const src = 'export type X = "A" | "B";\n';
    expect(stripTypeScriptComments(src)).toBe(src);
  });
});

describe("unionMembersInSource survives the exact shapes that broke the naive scrape", () => {
  it("reads past a semicolon written inside a doc-comment", () => {
    const src = `
export type Thing =
  /** first one. */
  | "ALPHA"
  /** The parts do not re-add to the whole. Never seen; always checked. */
  | "OMEGA";
`;
    expect(naiveUnionMembers(src, "Thing")).toEqual(["ALPHA"]); // the bug, pinned
    expect(unionMembersInSource(src, "Thing")).toEqual(["ALPHA", "OMEGA"]);
  });

  it("does not harvest a union member quoted inside its own explanation", () => {
    const src = `
export type Prov =
  | "furnished"
  /**
   * A row exists but is unsigned, so it has not been "furnished" and is
   * disregarded.
   */
  | "unsigned";
`;
    // The naive scrape sees "furnished" twice — once as a member, once as prose.
    expect(naiveUnionMembers(src, "Prov").length).not.toBe(2);
    expect(unionMembersInSource(src, "Prov")).toEqual(["furnished", "unsigned"]);
  });

  it("returns nothing for a union that does not exist, rather than guessing", () => {
    expect(unionMembersInSource('export type Other = "A";', "Missing")).toEqual([]);
  });

  it("does not deduplicate, so a genuinely duplicated member stays visible", () => {
    // Deduplicating here would hide a real engine defect and make the count
    // agree with a runtime array that is also wrong.
    expect(unionMembersInSource('export type D = "A" | "B" | "A";', "D")).toEqual([
      "A",
      "B",
      "A",
    ]);
  });

  it("reads a union written on a single line", () => {
    expect(unionMembersInSource('export type S = "A" | "B";', "S")).toEqual(["A", "B"]);
  });
});
