/**
 * tests/compliance/ytd-mentor.test.ts   (books-34)
 *
 * Two jobs, and the second is the one that is usually skipped.
 *
 *  1. Prove the mentor COVERS the engine - every column migration 0199
 *     introduces, every refusal code the engine declares, every exported
 *     function, every citation, and the SSA's three rejection conditions.
 *
 *  2. Prove the coverage GATES THEMSELVES WORK. Standing rule 16: a gate that
 *     cannot fail is decoration with a green check on it. Every gate below is
 *     therefore also run against a deliberately broken input written to a temp
 *     file, and is REQUIRED to throw - and each broken input is paired with an
 *     ACCEPT CONTROL (standing rule 55) proving the same gate still passes on
 *     valid input, so a gate that simply throws at everything cannot masquerade
 *     as a working one.
 *
 * The lesson TEXT is not asserted word for word. Pinning prose makes the test
 * fail on every improvement and teaches people to update the assertion without
 * reading it. What IS pinned is the structure, the coverage, and the specific
 * figures that come from an authority - $184,500, $199,750, $200,000, $7,000 -
 * because those are facts, not wording.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findGuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import { YTD_AUTHORITIES } from "@/lib/payroll/ytd-authorities";
import {
  YTD_FIELD_LESSONS,
  YTD_SCREEN_LESSONS,
  YTD_REFUSAL_LESSONS,
  YTD_YEAR_END_CHECKS,
  taughtFieldNames,
} from "@/lib/payroll/ytd-mentor";
import {
  CORE_FUNCTION_COVERAGE,
  assertEveryCitedAuthorityExists,
  assertEveryExportedFunctionIsTaught,
  assertEveryFieldIsTaught,
  assertEveryRefusalCodeIsTaught,
  assertNoDuplicateFieldLessons,
  assertNoLessonForUnknownField,
  assertSsaRejectionConditionsAreChecked,
  assertStructuralExemptionsAreJustified,
  assertYearEndChecksAreWellFormed,
  STRUCTURAL_COLUMNS,
  STRUCTURAL_TYPES,
  engineRefusalCodes,
  exportedCoreFunctionNames,
  migrationColumnNames,
  migrationColumnTypes,
  unusedAuthorityIds,
} from "@/lib/payroll/ytd-mentor-gates";

/** A throwaway file, so the broken-input tests never touch the real sources. */
function tempSource(name: string, body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ytd-mentor-gate-"));
  const p = join(dir, name);
  writeFileSync(p, body, "utf8");
  return p;
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * THE MIGRATION PARSER - everything else depends on it reading correctly
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the mentor reads migration 0199 from disk", () => {
  it("finds both shapes of column: the ones added and the ones created", () => {
    const cols = migrationColumnNames();

    // Guard against a vacuous read before asserting anything about content
    // (standing rule 39). A parser that returns nothing would make every
    // coverage assertion below pass by having nothing to check.
    expect(cols.length, "parsed no columns at all from migration 0199").toBeGreaterThan(30);

    // Added to the existing table by `alter table ... add column`.
    expect(cols).toContain("payroll_run_lines.oasdi_wages_cents");
    expect(cols).toContain("payroll_run_lines.lni_hundredth_hours");
    // Created inside the new table's body.
    expect(cols).toContain("payroll_ytd_accumulators.tax_year");
    expect(cols).toContain("payroll_ytd_accumulators.medicare_wages_cents");
    expect(cols).toContain("payroll_ytd_accumulators.last_recomputed_at");
  });

  it("counts exactly the 20 columns added to payroll_run_lines", () => {
    const added = migrationColumnNames().filter((c) => c.startsWith("payroll_run_lines."));
    expect(added).toHaveLength(20);
  });

  it("counts exactly the 18 columns of payroll_ytd_accumulators", () => {
    const created = migrationColumnNames().filter((c) =>
      c.startsWith("payroll_ytd_accumulators."),
    );
    expect(created).toHaveLength(18);
  });

  it(
    "does not mistake a multi-line CHECK constraint for a column definition - " +
      "its continuation lines read exactly like `name type` to a naive regex",
    () => {
      const cols = migrationColumnNames();
      // `payroll_ytd_sane_magnitude` spans several lines that each begin
      // `oasdi_wages_cents between 0 and 10000000000 and`. A line-shape parser
      // would emit those as columns, producing duplicates.
      const seen = new Set<string>();
      const dupes = cols.filter((c) => {
        if (seen.has(c)) return true;
        seen.add(c);
        return false;
      });
      expect(dupes, `parser emitted duplicate columns: ${dupes.join(", ")}`).toHaveLength(0);
      // And nothing that is plainly a constraint name leaked through.
      expect(cols.filter((c) => c.includes("payroll_ytd_"))).toEqual(
        cols.filter((c) => c.startsWith("payroll_ytd_accumulators.")),
      );
    },
  );

  it("PROOF THE PARSER CAN BE WRONG: a migration with no columns yields nothing", () => {
    const p = tempSource("empty.sql", "-- a migration that adds nothing at all\nselect 1;\n");
    expect(migrationColumnNames(p)).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ *
 * FIELD COVERAGE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("every stored figure is taught", () => {
  it("passes against the real migration", () => {
    expect(() => assertEveryFieldIsTaught()).not.toThrow();
  });

  it("teaches no column that does not exist", () => {
    expect(() => assertNoLessonForUnknownField()).not.toThrow();
  });

  it("teaches no column twice", () => {
    expect(() => assertNoDuplicateFieldLessons()).not.toThrow();
  });

  it("teaches the period figure and the year figure SEPARATELY", () => {
    const taught = taughtFieldNames();
    // The same concept on two tables. Confusing the two is how an employee
    // gets Social Security withheld past the wage base, so both are taught.
    expect(taught).toContain("payroll_run_lines.oasdi_wages_cents");
    expect(taught).toContain("payroll_ytd_accumulators.oasdi_wages_cents");
    expect(taught).toContain("payroll_run_lines.medicare_wages_cents");
    expect(taught).toContain("payroll_ytd_accumulators.medicare_wages_cents");
  });

  it("GATE IS WIRED: a column with no lesson makes the gate throw", () => {
    const p = tempSource(
      "extra.sql",
      "alter table public.payroll_run_lines add column if not exists a_brand_new_untaught_column bigint;\n",
    );
    expect(() => assertEveryFieldIsTaught(p)).toThrow(/MENTOR COVERAGE GAP/);
  });

  it("ACCEPT CONTROL: the same gate passes when the column IS taught", () => {
    // Same shape of input, same code path, one taught column. If the gate threw
    // here too it would be refusing everything rather than discriminating
    // (standing rule 55).
    const p = tempSource(
      "taught.sql",
      "alter table public.payroll_run_lines add column if not exists oasdi_wages_cents bigint;\n",
    );
    expect(() => assertEveryFieldIsTaught(p)).not.toThrow();
  });

  it("GATE IS WIRED: reading nothing is a broken gate, not a pass", () => {
    const p = tempSource("nothing.sql", "-- nothing here\n");
    expect(() => assertEveryFieldIsTaught(p)).toThrow(/GATE BROKEN/);
    expect(() => assertNoLessonForUnknownField(p)).toThrow(/GATE BROKEN/);
  });

  it("GATE IS WIRED: a renamed column leaves its lesson stray, and that throws", () => {
    // Only one column exists; every other lesson now teaches a column that is
    // not there. That is the rename case.
    const p = tempSource(
      "renamed.sql",
      "alter table public.payroll_run_lines add column if not exists oasdi_wages_cents bigint;\n",
    );
    expect(() => assertNoLessonForUnknownField(p)).toThrow(/TEACHES COLUMNS THAT DO NOT EXIST/);
  });

  it("ACCEPT CONTROL: no lesson is stray against the real migration", () => {
    const known = new Set(migrationColumnNames());
    const stray = taughtFieldNames().filter((f) => !known.has(f));
    expect(stray, `stray lessons: ${stray.join(", ")}`).toHaveLength(0);
  });

  it("GATE IS WIRED: a gate that classified everything as structural would throw", () => {
    // Only structural columns present. The gate must notice that it would
    // require no lessons at all, rather than passing.
    const p = tempSource(
      "structural-only.sql",
      [
        "create table if not exists public.payroll_ytd_accumulators (",
        "  id uuid primary key default gen_random_uuid(),",
        "  employee_id uuid not null,",
        "  created_at timestamptz not null default now(),",
        "  updated_at timestamptz not null default now()",
        ");",
      ].join("\n"),
    );
    expect(() => assertEveryFieldIsTaught(p)).toThrow(/classified as structural/);
  });

  /* ─────────────────────────────────────────────────────────────────────────
   * THE HOLE A MUTATION CAMPAIGN FOUND, AND THE GATE THAT NOW CLOSES IT
   *
   * scripts/prove-ytd-mentor-gates.sh added one line to the structural
   * exemption list - `payroll_ytd_accumulators.oasdi_wages_cents`, box 3 of the
   * W-2 - and every test above stayed GREEN. The coverage gate ran, read the
   * migration, reported full coverage, and the most important figure in the
   * table no longer needed a lesson. The tests below are the fix, and each one
   * is the mutation that survived.
   * ───────────────────────────────────────────────────────────────────────── */

  it("the structural exemption list is justified against the migration's own column types", () => {
    expect(() => assertStructuralExemptionsAreJustified()).not.toThrow();
  });

  it("GATE IS WIRED: exempting a money column from needing a lesson throws", () => {
    // The exact surviving mutation, expressed as a test. A bigint holds a
    // quantity that reaches a filing; no listing can excuse it.
    const types = migrationColumnTypes();
    expect(types["payroll_ytd_accumulators.oasdi_wages_cents"]).toBe("bigint");
    expect(
      STRUCTURAL_TYPES.includes(types["payroll_ytd_accumulators.oasdi_wages_cents"]),
      "a bigint must never qualify as a structural column",
    ).toBe(false);
  });

  it("every exempted column really is a uuid key or an audit timestamp", () => {
    const types = migrationColumnTypes();
    for (const col of STRUCTURAL_COLUMNS) {
      const t = types[col];
      expect(t, `${col} is exempted but does not exist in the migration`).toBeDefined();
      expect(
        STRUCTURAL_TYPES,
        `${col} is exempted from needing a lesson but is a ${t}`,
      ).toContain(t);
    }
  });

  it("does NOT exempt last_run_id or last_recomputed_at, though their types would allow it", () => {
    // Eligible for exemption by type, deliberately not exempted, because both
    // carry meaning Michael has to understand. This pins the judgement so that
    // anyone who later exempts them has to change a test on purpose.
    const taught = new Set(taughtFieldNames());
    expect(taught).toContain("payroll_ytd_accumulators.last_run_id");
    expect(taught).toContain("payroll_ytd_accumulators.last_recomputed_at");
    expect(STRUCTURAL_COLUMNS).not.toContain("payroll_ytd_accumulators.last_run_id");
    expect(STRUCTURAL_COLUMNS).not.toContain("payroll_ytd_accumulators.last_recomputed_at");
  });

  it("GATE IS WIRED: a vacuous read makes the exemption gate report itself broken", () => {
    const p = tempSource("nothing.sql", "-- nothing\n");
    expect(() => assertStructuralExemptionsAreJustified(p)).toThrow(/GATE BROKEN/);
  });

  it("GATE IS WIRED: an exemption for a column that no longer exists throws", () => {
    // Only one column in this migration, so all four exemptions are stale.
    const p = tempSource(
      "renamed.sql",
      "alter table public.payroll_run_lines add column if not exists oasdi_wages_cents bigint;\n",
    );
    expect(() => assertStructuralExemptionsAreJustified(p)).toThrow(
      /EXEMPTIONS FOR COLUMNS THAT DO NOT EXIST/,
    );
  });

  it("the migration parser records each column's TYPE, not just its name", () => {
    const types = migrationColumnTypes();
    expect(Object.keys(types).length).toBe(migrationColumnNames().length);
    expect(types["payroll_ytd_accumulators.id"]).toBe("uuid");
    expect(types["payroll_ytd_accumulators.employee_id"]).toBe("uuid");
    expect(types["payroll_ytd_accumulators.tax_year"]).toBe("integer");
    expect(types["payroll_ytd_accumulators.created_at"]).toBe("timestamptz");
    expect(types["payroll_run_lines.lni_hundredth_hours"]).toBe("bigint");
  });

  it("every field lesson answers all five questions with real content", () => {
    expect(YTD_FIELD_LESSONS.length).toBeGreaterThan(30);
    for (const l of YTD_FIELD_LESSONS) {
      for (const [key, value] of [
        ["whatItIs", l.whatItIs],
        ["whereItIsUsed", l.whereItIsUsed],
        ["whyItMatters", l.whyItMatters],
        ["theTrap", l.theTrap],
        ["howToBeSure", l.howToBeSure],
      ] as const) {
        expect(value.trim(), `${l.field}.${key} is empty`).not.toBe("");
        // A one-word answer is a placeholder wearing the shape of a lesson.
        expect(
          value.trim().length,
          `${l.field}.${key} is too short to be an explanation: "${value}"`,
        ).toBeGreaterThan(40);
      }
      expect(l.field, `${l.field} is not qualified as table.column`).toMatch(
        /^[a-z_]+\.[a-z_]+$/,
      );
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ *
 * REFUSAL CODES
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("every refusal the engine can emit is explained", () => {
  it("reads the engine's own union type from disk", () => {
    const codes = engineRefusalCodes();
    expect(codes.length, "parsed no refusal codes from ytd-core.ts").toBeGreaterThan(0);
    expect([...codes].sort()).toEqual([
      "YTD_EMPLOYEE_MISMATCH",
      "YTD_MEDICARE_BELOW_OASDI",
      "YTD_NEGATIVE_INPUT",
      "YTD_NON_INTEGER_INPUT",
      "YTD_RUN_ALREADY_APPLIED",
      "YTD_WOULD_GO_NEGATIVE",
      "YTD_YEAR_MISMATCH",
    ]);
  });

  it("passes against the real engine", () => {
    expect(() => assertEveryRefusalCodeIsTaught()).not.toThrow();
  });

  it("GATE IS WIRED: an eighth refusal code with no lesson throws", () => {
    const p = tempSource(
      "core.ts",
      'export type YtdRefusalCode =\n  | "YTD_RUN_ALREADY_APPLIED"\n  | "YTD_SOMETHING_BRAND_NEW";\n',
    );
    expect(() => assertEveryRefusalCodeIsTaught(p)).toThrow(/REFUSAL CODES WITH NO EXPLANATION/);
  });

  it("GATE IS WIRED: a lesson that outlives its code throws too", () => {
    // The more dangerous direction: the count looks right while a live code is
    // untaught. Here only one code exists, so the other six lessons are stale.
    const p = tempSource(
      "core.ts",
      'export type YtdRefusalCode =\n  | "YTD_RUN_ALREADY_APPLIED";\n',
    );
    expect(() => assertEveryRefusalCodeIsTaught(p)).toThrow(
      /EXPLAINS REFUSAL CODES THAT NO LONGER EXIST/,
    );
  });

  it("GATE IS WIRED: parsing no codes is a broken gate, not a pass", () => {
    const p = tempSource("core.ts", "export const nothing = 1;\n");
    expect(() => assertEveryRefusalCodeIsTaught(p)).toThrow(/GATE BROKEN/);
  });

  it("ACCEPT CONTROL: a temp file listing exactly the real seven passes", () => {
    const p = tempSource(
      "core.ts",
      "export type YtdRefusalCode =\n" +
        engineRefusalCodes()
          .map((c) => `  | "${c}"`)
          .join("\n") +
        ";\n",
    );
    expect(() => assertEveryRefusalCodeIsTaught(p)).not.toThrow();
  });

  it("each refusal lesson says why we stop AND what to do about it", () => {
    for (const l of YTD_REFUSAL_LESSONS) {
      expect(l.headline.trim().length, `${l.code} headline too short`).toBeGreaterThan(20);
      expect(l.whyWeStop.trim().length, `${l.code} whyWeStop too short`).toBeGreaterThan(60);
      expect(l.whatToDo.trim().length, `${l.code} whatToDo too short`).toBeGreaterThan(40);
    }
  });

  it("the double-post lesson tells Michael the likely cause is a retry, not a fault", () => {
    const l = YTD_REFUSAL_LESSONS.find((x) => x.code === "YTD_RUN_ALREADY_APPLIED");
    expect(l).toBeDefined();
    // The specific value of this refusal is that it is usually BENIGN, and a
    // lesson that alarmed Michael every time a button was double-clicked would
    // teach him to ignore the banner.
    expect(l!.whatToDo.toLowerCase()).toMatch(/twice|retried/);
  });

  it("the negative-unwind lesson sends Michael to REBUILD, not to edit the total", () => {
    const l = YTD_REFUSAL_LESSONS.find((x) => x.code === "YTD_WOULD_GO_NEGATIVE");
    expect(l).toBeDefined();
    expect(l!.whatToDo.toLowerCase()).toContain("rebuild");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ *
 * EXPORTED FUNCTION COVERAGE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("every exported engine function is explained", () => {
  it("passes against the real engine", () => {
    const exported = exportedCoreFunctionNames();
    expect(exported.length, "parsed no exported functions").toBeGreaterThan(5);
    expect(() => assertEveryExportedFunctionIsTaught()).not.toThrow();
  });

  it("covers all ten, by name", () => {
    expect([...exportedCoreFunctionNames()].sort()).toEqual(
      Object.keys(CORE_FUNCTION_COVERAGE).sort(),
    );
  });

  it("GATE IS WIRED: an eleventh function with no explanation throws", () => {
    const p = tempSource(
      "core.ts",
      Object.keys(CORE_FUNCTION_COVERAGE)
        .map((f) => `export function ${f}() {}`)
        .join("\n") + "\nexport function anEntirelyNewFunction() {}\n",
    );
    expect(() => assertEveryExportedFunctionIsTaught(p)).toThrow(/MENTOR COVERAGE GAP/);
  });

  it("ACCEPT CONTROL: the same temp file without the new function passes", () => {
    const p = tempSource(
      "core.ts",
      Object.keys(CORE_FUNCTION_COVERAGE)
        .map((f) => `export function ${f}() {}`)
        .join("\n") + "\n",
    );
    expect(() => assertEveryExportedFunctionIsTaught(p)).not.toThrow();
  });

  it("GATE IS WIRED: an explanation that outlives its function throws", () => {
    const p = tempSource("core.ts", "export function emptyAccumulator() {}\n");
    expect(() => assertEveryExportedFunctionIsTaught(p)).toThrow(
      /EXPLAINS FUNCTIONS THAT NO LONGER EXIST/,
    );
  });

  it("GATE IS WIRED: reading no functions is a broken gate", () => {
    const p = tempSource("core.ts", "const x = 1;\n");
    expect(() => assertEveryExportedFunctionIsTaught(p)).toThrow(/GATE BROKEN/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ *
 * CITATIONS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("every citation resolves", () => {
  it("no lesson cites an authority that does not exist", () => {
    expect(() => assertEveryCitedAuthorityExists()).not.toThrow();
  });

  it("every cited authority also resolves through the guidance registry", () => {
    // The mentor's own registry is one thing; being findable by the screen that
    // renders a citation is another, and that goes through the shared registry.
    const cited = new Set<string>();
    for (const l of YTD_FIELD_LESSONS) for (const id of l.authorityIds) cited.add(id);
    for (const l of YTD_SCREEN_LESSONS) for (const id of l.authorityIds) cited.add(id);
    for (const c of YTD_YEAR_END_CHECKS) for (const id of c.authorityIds) cited.add(id);

    expect(cited.size, "no lesson cites any authority at all").toBeGreaterThan(4);
    for (const id of cited) {
      expect(findGuidanceAuthority(id), `${id} is cited but not in the guidance registry`).toBeTruthy();
    }
  });

  it("every mirrored YTD authority is actually used by a lesson", () => {
    // Reported rather than thrown by the gate itself, but pinned here: an
    // authority nobody cites is usually a lesson somebody meant to write.
    expect(unusedAuthorityIds()).toEqual([]);
    expect(YTD_AUTHORITIES.length).toBe(7);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ *
 * THE FACTS, NOT THE WORDING
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the lessons state the figures the authorities actually give", () => {
  const allText = [
    ...YTD_FIELD_LESSONS.flatMap((l) => [
      l.whatItIs,
      l.whereItIsUsed,
      l.whyItMatters,
      l.theTrap,
      l.howToBeSure,
    ]),
    ...YTD_SCREEN_LESSONS.flatMap((l) => [l.plainEnglish, l.whyItMatters]),
    ...YTD_REFUSAL_LESSONS.flatMap((l) => [l.headline, l.whyWeStop, l.whatToDo]),
    ...YTD_YEAR_END_CHECKS.flatMap((c) => [c.label, c.theCheck, c.ifItFails]),
  ].join("\n");

  it("names the 2026 Social Security wage base", () => {
    expect(allText).toContain("$184,500");
  });

  it("names the IRS worked example on both sides", () => {
    expect(allText).toContain("$199,750");
    expect(allText).toContain("184500.00");
    expect(allText).toContain("199750.00");
  });

  it("names the Additional Medicare threshold", () => {
    expect(allText).toContain("$200,000");
  });

  it("names the FUTA wage base", () => {
    expect(allText).toContain("$7,000");
  });

  it("teaches that Medicare has NO ceiling, in so many words", () => {
    expect(allText.toLowerCase()).toMatch(/medicare (has )?no ceiling|no ceiling at all/);
  });

  it("teaches that Additional Medicare has no employer match", () => {
    expect(allText.toLowerCase()).toMatch(/no employer match|does not match this|not matched at all/);
  });

  it("teaches that wages belong to the year they are PAID", () => {
    expect(allText).toMatch(/year they are PAID/);
  });

  it("names Greenway's own account numbers where the lesson needs them", () => {
    // Standing rule 26 with Michael in mind: "check the rate notice" is advice,
    // "check the rate notice for account 000-073905-00-0" is an instruction.
    expect(allText).toContain("000-073905-00-0");
    expect(allText).toContain("521,756-00");
    expect(allText).toContain("6403");
  });

  it("PROOF THIS TEST CAN FAIL: a figure that is not taught is absent", () => {
    // A control on the assertions above. If `allText` were somehow the whole
    // repo, every `toContain` would pass vacuously.
    expect(allText).not.toContain("$999,999");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ *
 * THE YEAR-END CHECKLIST
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the year-end checklist is a usable order", () => {
  it("is well formed", () => {
    expect(() => assertYearEndChecksAreWellFormed()).not.toThrow();
  });

  it("covers all three SSA rejection conditions, each blocking", () => {
    expect(() => assertSsaRejectionConditionsAreChecked()).not.toThrow();
  });

  it("puts reconciliation first, and makes everything else depend on it", () => {
    expect(YTD_YEAR_END_CHECKS[0].key).toBe("reconcile-to-lines");
    for (const c of YTD_YEAR_END_CHECKS.slice(1)) {
      expect(c.requires, `${c.key} does not require reconciliation`).toContain(
        "reconcile-to-lines",
      );
    }
  });

  it("declares every prerequisite before the check that needs it", () => {
    const seen = new Set<string>();
    for (const c of YTD_YEAR_END_CHECKS) {
      for (const r of c.requires) {
        expect(seen.has(r), `${c.key} requires ${r}, which is declared later`).toBe(true);
      }
      seen.add(c.key);
    }
  });

  it("has at least one check that blocks a W-2 from being produced", () => {
    expect(YTD_YEAR_END_CHECKS.some((c) => c.blocksFiling)).toBe(true);
  });

  it("does NOT block on the Additional Medicare check", () => {
    // A judgement worth pinning: at Greenway's wage levels this is expected to
    // be zero for everyone, so it is a thing to confirm rather than a thing
    // that should stop a filing. If that judgement ever changes, this test is
    // where somebody will have to change it deliberately.
    const c = YTD_YEAR_END_CHECKS.find((x) => x.key === "additional-medicare-unmatched");
    expect(c).toBeDefined();
    expect(c!.blocksFiling).toBe(false);
  });

  it("every check says what is compared and what to do when it fails", () => {
    for (const c of YTD_YEAR_END_CHECKS) {
      expect(c.theCheck.trim().length, `${c.key} theCheck too short`).toBeGreaterThan(50);
      expect(c.ifItFails.trim().length, `${c.key} ifItFails too short`).toBeGreaterThan(50);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ *
 * SCREEN LESSONS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the screen lessons carry the ideas that belong to no single field", () => {
  it("there are several, and each has substance", () => {
    expect(YTD_SCREEN_LESSONS.length).toBeGreaterThanOrEqual(6);
    for (const l of YTD_SCREEN_LESSONS) {
      expect(l.topic.trim()).not.toBe("");
      expect(l.plainEnglish.trim().length, `${l.topic} plainEnglish too short`).toBeGreaterThan(
        120,
      );
      expect(l.whyItMatters.trim().length, `${l.topic} whyItMatters too short`).toBeGreaterThan(
        120,
      );
    }
  });

  it("one of them is the reason this whole slice exists", () => {
    const topics = YTD_SCREEN_LESSONS.map((l) => l.topic.toLowerCase()).join(" | ");
    expect(topics).toContain("ceiling you cannot see");
  });

  it("one of them explains why the old single taxes column could never file a form", () => {
    const topics = YTD_SCREEN_LESSONS.map((l) => l.topic.toLowerCase()).join(" | ");
    expect(topics).toMatch(/single .?taxes.? column/);
  });

  it("no screen lesson topic is duplicated", () => {
    const topics = YTD_SCREEN_LESSONS.map((l) => l.topic);
    expect(new Set(topics).size).toBe(topics.length);
  });
});
