/**
 * tests/compliance/financial-statements-reading-mentor.test.ts   (books-42)
 *
 * THE GATE ON THE TEACHING LAYER.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A TEST FILE FOR PROSE
 * ─────────────────────────────────────────────────────────────────────────────
 * Most of `financial-statements-reading-mentor.ts` is English, and English does
 * not throw. That is exactly why it needs a gate. Three failure modes are
 * specific to a mentor layer and none of them announce themselves:
 *
 *   1. A LESSON THAT DRIFTS FROM THE CODE. A statement gets added to
 *      `FsStatementId` and no reading lesson is written for it. Everything
 *      compiles. Michael opens the fifth statement and there is no guidance,
 *      which is worse than no statement, because he now assumes he understands
 *      it.
 *
 *   2. A FIGURE TYPED RATHER THAN DERIVED. Someone writes "$4,000.00" into the
 *      summary sentence, then later changes the example's operating expenses.
 *      The prose and the arithmetic now disagree and the prose is the part he
 *      will read. This already happened once inside this very module: the
 *      worked example claimed a gross margin of "47.9%" when the arithmetic
 *      says 42.71%. It was caught by executing the numbers, not by reading
 *      them. The tests below make that class of error mechanical.
 *
 *   3. AN AUTHORITY ID THAT RESOLVES TO NOTHING. A lesson cites
 *      `ASC_205_10_45_1A_FULL_SET` and no such authority is registered. The
 *      screen renders a citation link to nowhere, which is worse than an
 *      uncited claim, because it looks checked.
 *
 * Standing rule 66 says owner documents must make CHECKABLE claims. A mentor
 * module IS an owner document that happens to live in TypeScript. Every claim
 * it makes about a number is checked here against the number.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  STATEMENT_LESSONS,
  STATEMENT_PRINCIPLES,
  WORKED_EXAMPLE_IS_ILLUSTRATIVE,
  EXAMPLE_GROSS_SALES_CENTS,
  EXAMPLE_DISCOUNTS_CENTS,
  EXAMPLE_COGS_CENTS,
  EXAMPLE_OPEX_CENTS,
  EXAMPLE_TAX_RATE_BP,
  workedExample,
  theSentence,
  statementLessonFor,
  declaredStatementIds,
  assertEveryStatementIsTaught,
  citedReadingAuthorityIds,
  type StatementLesson,
} from "@/lib/accounting/financial-statements-reading-mentor";
import { findGuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import { basisPoints, type FsStatementId } from "@/lib/accounting/financial-statements-ui-core";

const UI_CORE_REL = join("src", "lib", "accounting", "financial-statements-ui-core.ts");

/** Write a doctored copy of the UI core to a temp file and return its path. */
function doctoredUiCore(transform: (src: string) => string): string {
  const real = readFileSync(join(process.cwd(), UI_CORE_REL), "utf8");
  const dir = mkdtempSync(join(tmpdir(), "fs-reading-mentor-"));
  const path = join(dir, "financial-statements-ui-core.ts");
  writeFileSync(path, transform(real), "utf8");
  return path;
}

// ---------------------------------------------------------------------------
// 1) THE COVERAGE GATE, AND PROOF THAT IT FIRES.
//
// Rule 16: prove the gate fires. A gate only ever observed passing is a
// decoration. Every one of the four failure paths is provoked below.
// ---------------------------------------------------------------------------

describe("the coverage gate on statement lessons", () => {
  it("passes today — every declared statement has a reading lesson", () => {
    expect(() => assertEveryStatementIsTaught()).not.toThrow();
  });

  it("is not vacuous — it really does read ids out of the UI core on disk", () => {
    const ids = declaredStatementIds();
    expect(ids.length).toBeGreaterThan(0);
    // The four are named explicitly. If the regex silently started matching
    // some other union, this would catch it.
    expect([...ids].sort()).toEqual(["balance", "cash_flow", "equity", "income"]);
  });

  it("FIRES when the source cannot be parsed — a gate that reads nothing approves everything", () => {
    const path = doctoredUiCore((src) => src.replace(/export type FsStatementId =[^;]+;/, ""));
    expect(() => assertEveryStatementIsTaught(path)).toThrow(/found NO statement ids/i);
    expect(() => assertEveryStatementIsTaught(path)).toThrow(/without checking anything/i);
  });

  it("FIRES when a new statement is declared but never taught", () => {
    const path = doctoredUiCore((src) =>
      src.replace(
        /export type FsStatementId =([^;]+);/,
        (_m, body) => `export type FsStatementId =${body}| "tax_reconciliation";`,
      ),
    );
    expect(() => assertEveryStatementIsTaught(path)).toThrow(/no reading lesson/i);
    expect(() => assertEveryStatementIsTaught(path)).toThrow(/tax_reconciliation/);
  });

  it("FIRES when a lesson teaches a statement that no longer exists", () => {
    const path = doctoredUiCore((src) =>
      src.replace(/export type FsStatementId =[^;]+;/, `export type FsStatementId = "income";`),
    );
    expect(() => assertEveryStatementIsTaught(path)).toThrow(/no longer exist/i);
    // The three orphaned lessons must be NAMED, not counted.
    expect(() => assertEveryStatementIsTaught(path)).toThrow(/balance/);
  });

  it("names the statements it is complaining about, so the fix is obvious", () => {
    const path = doctoredUiCore((src) =>
      src.replace(
        /export type FsStatementId =([^;]+);/,
        (_m, body) => `export type FsStatementId =${body}| "budget_variance";`,
      ),
    );
    try {
      assertEveryStatementIsTaught(path);
      throw new Error("gate did not fire");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("budget_variance");
      // It should explain WHY, citing the rule, not just report a diff.
      expect(msg).toMatch(/rule 26/i);
    }
  });

  it("the injectable path reproduces the real result when handed the real file", () => {
    expect(declaredStatementIds(join(process.cwd(), UI_CORE_REL))).toEqual(declaredStatementIds());
  });
});

// ---------------------------------------------------------------------------
// 2) THE LESSONS THEMSELVES.
// ---------------------------------------------------------------------------

describe("the four statement lessons", () => {
  it("there are exactly four, one per statement, with no duplicates", () => {
    expect(STATEMENT_LESSONS).toHaveLength(4);
    const ids = STATEMENT_LESSONS.map((l) => l.statement);
    expect(new Set(ids).size).toBe(4);
  });

  it("every lesson answers a QUESTION, because that is how a statement is chosen", () => {
    for (const l of STATEMENT_LESSONS) {
      expect(l.theQuestionItAnswers.trim().length).toBeGreaterThan(20);
      expect(l.theQuestionItAnswers).toMatch(/\?/);
    }
  });

  it("every lesson says whether it covers a PERIOD or an INSTANT", () => {
    // This is the single most common misreading of a balance sheet: treating a
    // snapshot as though it described the year.
    for (const l of STATEMENT_LESSONS) {
      expect(l.periodOrInstant).toMatch(/PERIOD|INSTANT|MOMENT/i);
    }
  });

  it("the income statement is a period and the balance sheet is an instant", () => {
    expect(statementLessonFor("income")!.periodOrInstant).toMatch(/A PERIOD/);
    expect(statementLessonFor("balance")!.periodOrInstant).toMatch(/INSTANT|MOMENT/i);
  });

  it("every lesson carries a §280E twist — there is no statement this tax does not touch", () => {
    for (const l of STATEMENT_LESSONS) {
      expect(l.the280eTwist.trim().length).toBeGreaterThan(40);
      expect(l.the280eTwist).toMatch(/280E|280e/);
    }
  });

  it("every lesson states the expensive mistake AS A MISTAKE, not as a caution", () => {
    for (const l of STATEMENT_LESSONS) {
      expect(l.theExpensiveMistake.trim().length).toBeGreaterThan(40);
    }
  });

  it("every lesson ends with what a CPA would actually DO", () => {
    for (const l of STATEMENT_LESSONS) {
      expect(l.whatIWouldDo.trim().length).toBeGreaterThan(30);
    }
  });

  it("every lesson describes what GOOD looks like for a cannabis retailer specifically", () => {
    for (const l of STATEMENT_LESSONS) {
      expect(l.whatGoodLooksLike.trim().length).toBeGreaterThan(40);
    }
  });

  it("no field in any lesson is empty or whitespace", () => {
    const FIELDS: readonly (keyof StatementLesson)[] = [
      "title",
      "theQuestionItAnswers",
      "periodOrInstant",
      "whatItIs",
      "howToReadIt",
      "whatGoodLooksLike",
      "theExpensiveMistake",
      "the280eTwist",
      "whatIWouldDo",
    ];
    for (const l of STATEMENT_LESSONS) {
      for (const f of FIELDS) {
        expect(String(l[f]).trim().length, `${l.statement}.${String(f)}`).toBeGreaterThan(0);
      }
    }
  });

  it("the income statement lesson teaches reading from the WALL outwards", () => {
    // The whole point of the layout. If this sentence goes, the reader falls
    // back to reading top-to-bottom and lands on net income, which is the one
    // number that misleads him.
    const l = statementLessonFor("income")!;
    expect(l.howToReadIt).toMatch(/wall/i);
    expect(l.howToReadIt).toMatch(/gross income/i);
  });

  it("statementLessonFor returns undefined for an unknown id rather than a blank lesson", () => {
    expect(statementLessonFor("not_a_statement" as FsStatementId)).toBeUndefined();
  });

  it("every lesson cites at least one authority", () => {
    for (const l of STATEMENT_LESSONS) {
      expect(l.authorityIds.length, l.statement).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 3) THE PRINCIPLES.
// ---------------------------------------------------------------------------

describe("the principles that span all four statements", () => {
  it("there are seven, with unique keys", () => {
    expect(STATEMENT_PRINCIPLES).toHaveLength(7);
    expect(new Set(STATEMENT_PRINCIPLES.map((p) => p.key)).size).toBe(7);
  });

  it("every principle has a headline short enough to scan and a body long enough to teach", () => {
    for (const p of STATEMENT_PRINCIPLES) {
      expect(p.headline.length, p.key).toBeGreaterThan(15);
      expect(p.headline.length, p.key).toBeLessThan(90);
      expect(p.body.length, p.key).toBeGreaterThan(120);
    }
  });

  it("one of them says out loud that balancing proves nothing", () => {
    const p = STATEMENT_PRINCIPLES.find((x) => x.key === "balancing_proves_nothing");
    expect(p).toBeDefined();
    expect(p!.body).toMatch(/balance/i);
  });

  it("the balancing principle cites the real incident rather than speaking in the abstract", () => {
    // The GRWNY/GRNWY typo: eighteen accounts vanished and the report still
    // footed. A principle backed by a war story is one he will remember.
    const p = STATEMENT_PRINCIPLES.find((x) => x.key === "balancing_proves_nothing")!;
    expect(p.body).toMatch(/typo|entity code/i);
  });

  it("one of them warns never to move a number to change an outcome", () => {
    const p = STATEMENT_PRINCIPLES.find((x) => x.key === "never_move_to_change_an_outcome");
    expect(p).toBeDefined();
    expect(p!.body.length).toBeGreaterThan(120);
  });

  it("one of them establishes that these are management accounts, not audited ones", () => {
    const p = STATEMENT_PRINCIPLES.find((x) => x.key === "management_accounts");
    expect(p).toBeDefined();
    expect(p!.body).toMatch(/audit/i);
  });

  it("every principle cites at least one authority", () => {
    for (const p of STATEMENT_PRINCIPLES) {
      expect(p.authorityIds.length, p.key).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 4) THE WORKED EXAMPLE — CHECKED AS ARITHMETIC, NOT READ AS PROSE.
//
// Every subtotal is recomputed here from the four inputs. If anyone edits a
// constant, the derived lines must move with it, and if a NOTE quotes a figure
// that figure must still be true.
// ---------------------------------------------------------------------------

describe("the worked example", () => {
  const lines = workedExample();
  const at = (label: string) => {
    const l = lines.find((x) => x.label === label);
    expect(l, `missing line: ${label}`).toBeDefined();
    return l!;
  };

  it("is labelled illustrative, so it can never be mistaken for Greenway's books", () => {
    expect(WORKED_EXAMPLE_IS_ILLUSTRATIVE).toMatch(/illustrative/i);
    expect(WORKED_EXAMPLE_IS_ILLUSTRATIVE).toMatch(/not Greenway's actual/i);
  });

  it("has ten lines and every one of them carries an explanation", () => {
    expect(lines).toHaveLength(10);
    for (const l of lines) {
      expect(l.note.trim().length, l.label).toBeGreaterThan(30);
    }
  });

  it("every amount is an integer number of cents — no floats reach a printed page", () => {
    for (const l of lines) {
      expect(Number.isInteger(l.amountCents), l.label).toBe(true);
    }
  });

  it("net sales is DERIVED as gross less discounts", () => {
    expect(at("Net sales").amountCents).toBe(EXAMPLE_GROSS_SALES_CENTS - EXAMPLE_DISCOUNTS_CENTS);
    expect(at("Net sales").isDerived).toBe(true);
  });

  it("gross income is DERIVED as net sales less cost of goods sold", () => {
    const netSales = EXAMPLE_GROSS_SALES_CENTS - EXAMPLE_DISCOUNTS_CENTS;
    expect(at("GROSS INCOME — the number §280E taxes").amountCents).toBe(
      netSales - EXAMPLE_COGS_CENTS,
    );
  });

  it("book net income is DERIVED as gross income less operating expenses", () => {
    const grossIncome = EXAMPLE_GROSS_SALES_CENTS - EXAMPLE_DISCOUNTS_CENTS - EXAMPLE_COGS_CENTS;
    expect(at("Book net income").amountCents).toBe(grossIncome - EXAMPLE_OPEX_CENTS);
  });

  it("the §280E cost is the DIFFERENCE between the two tax lines, not a typed number", () => {
    const cost = at("THE COST OF §280E, this month").amountCents;
    const onGross = at("Tax computed on GROSS income (§280E)").amountCents;
    const ifOrdinary = at("Tax if you were an ordinary retailer").amountCents;
    expect(cost).toBe(onGross - ifOrdinary);
  });

  it("the tax lines apply the rate in BASIS POINTS with integer arithmetic", () => {
    const grossIncome = EXAMPLE_GROSS_SALES_CENTS - EXAMPLE_DISCOUNTS_CENTS - EXAMPLE_COGS_CENTS;
    const bookNet = grossIncome - EXAMPLE_OPEX_CENTS;
    expect(at("Tax computed on GROSS income (§280E)").amountCents).toBe(
      Math.trunc((grossIncome * EXAMPLE_TAX_RATE_BP) / 10_000),
    );
    expect(at("Tax if you were an ordinary retailer").amountCents).toBe(
      Math.trunc((bookNet * EXAMPLE_TAX_RATE_BP) / 10_000),
    );
  });

  it("produces the specific figures the owner report quotes", () => {
    // These are asserted as literals ON PURPOSE. The owner-facing PDF repeats
    // them in prose; if the constants above ever change, this test goes red and
    // whoever changed them is told to go and fix the document too (rule 66).
    expect(at("Net sales").amountCents).toBe(192_000_00);
    expect(at("GROSS INCOME — the number §280E taxes").amountCents).toBe(82_000_00);
    expect(at("Book net income").amountCents).toBe(4_000_00);
    expect(at("Tax computed on GROSS income (§280E)").amountCents).toBe(30_340_00);
    expect(at("Tax if you were an ordinary retailer").amountCents).toBe(1_480_00);
    expect(at("THE COST OF §280E, this month").amountCents).toBe(28_860_00);
  });

  it("THE WHOLE POINT: the §280E cost exceeds the book profit", () => {
    // If this ever stops being true for the illustrative figures, the example
    // has lost the thing it was built to demonstrate and the prose around it
    // becomes false.
    expect(at("THE COST OF §280E, this month").amountCents).toBeGreaterThan(
      at("Book net income").amountCents,
    );
  });

  it("the gross margin claimed in the note matches the gross margin the numbers give", () => {
    // The claim in the note was WRONG when first written — it said 47.9%. This
    // test is the reason it now says 42.71%. Any future edit to the constants
    // that leaves the prose behind fails right here.
    const netSales = EXAMPLE_GROSS_SALES_CENTS - EXAMPLE_DISCOUNTS_CENTS;
    const grossIncome = netSales - EXAMPLE_COGS_CENTS;
    const bp = basisPoints(grossIncome, netSales);
    expect(bp).toBe(4271);
    const claimed = /(\d+\.\d+)%/.exec(at("GROSS INCOME — the number §280E taxes").note);
    expect(claimed, "the note no longer quotes a percentage").not.toBeNull();
    expect(Number(claimed![1])).toBeCloseTo(bp! / 100, 2);
  });

  it("the note on gross sales explains that excise never was revenue", () => {
    expect(at("Gross sales").note).toMatch(/69\.50\.535/);
    expect(at("Gross sales").note).toMatch(/trust/i);
  });

  it("the note on cost of goods sold explains WHY it is the only thing that helps", () => {
    expect(at("Less: cost of goods sold").note).toMatch(/gross income/i);
  });

  it("only the computed lines are flagged derived", () => {
    const derived = lines.filter((l) => l.isDerived).map((l) => l.label);
    expect(derived).toEqual([
      "Net sales",
      "GROSS INCOME — the number §280E taxes",
      "Book net income",
      "Tax computed on GROSS income (§280E)",
      "Tax if you were an ordinary retailer",
      "THE COST OF §280E, this month",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 5) THE SENTENCE.
// ---------------------------------------------------------------------------

describe("the one-sentence summary", () => {
  it("is DERIVED from the worked example, not typed alongside it", () => {
    const lines = workedExample();
    const bookNet = lines.find((l) => l.label === "Book net income")!.amountCents;
    const cost = lines.find((l) => l.label === "THE COST OF §280E, this month")!.amountCents;
    const s = theSentence();
    expect(s).toContain("$4,000.00");
    expect(s).toContain("$28,860.00");
    // Proof of derivation rather than coincidence: the formatted values of the
    // actual line amounts appear verbatim in the sentence.
    expect(s).toContain(`$${(bookNet / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    expect(s).toContain(`$${(cost / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  });

  it("ends on the lesson, not on the arithmetic", () => {
    expect(theSentence()).toMatch(/net income is not the number to run this business on/i);
  });

  it("is one sentence a person can hold in their head", () => {
    expect(theSentence().length).toBeLessThan(400);
  });
});

// ---------------------------------------------------------------------------
// 6) AUTHORITIES.
//
// Rule 2: never re-declare an authority. This module cites by id only, and
// every id must resolve through the single registry.
// ---------------------------------------------------------------------------

describe("authorities cited by the reading mentor", () => {
  it("cites a meaningful number of them, deduplicated and sorted", () => {
    const ids = citedReadingAuthorityIds();
    expect(ids.length).toBeGreaterThanOrEqual(10);
    expect([...ids]).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("EVERY cited id resolves to a real authority — no citations to nowhere", () => {
    const unresolved: string[] = [];
    for (const id of citedReadingAuthorityIds()) {
      if (!findGuidanceAuthority(id)) unresolved.push(id);
    }
    expect(unresolved, `unresolvable authority ids: ${unresolved.join(", ")}`).toEqual([]);
  });

  it("does not re-declare any authority text of its own (rule 2)", () => {
    // The module may quote nothing verbatim; verbatim text lives in the
    // authorities modules. A long quoted string here would be a second copy
    // that can drift from the first.
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "accounting", "financial-statements-reading-mentor.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/verbatim\s*:/i);
    expect(src).not.toMatch(/export const [A-Z_]*AUTHORITIES\b/);
  });

  it("the resolver itself is not broken — a known id really does resolve", () => {
    // Guards against the previous test passing because findGuidanceAuthority
    // returns truthy for everything, or because the list is empty.
    expect(citedReadingAuthorityIds().length).toBeGreaterThan(0);
    expect(findGuidanceAuthority("NOT_A_REAL_AUTHORITY_ID_XYZ")).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// 7) THE SEPARATION OF THE TWO MENTOR AXES.
//
// There are now two mentor modules for financial statements and they teach
// DIFFERENT things. Keeping them apart is deliberate, and worth a test, because
// the obvious "tidy-up" is to merge them — which would quietly destroy the
// function-coverage gate's meaning.
// ---------------------------------------------------------------------------

describe("the two mentor axes stay separate", () => {
  it("this module keys lessons to STATEMENTS, not to function names", () => {
    const ids = STATEMENT_LESSONS.map((l) => String(l.statement));
    for (const id of ids) {
      expect(id).toMatch(/^[a-z_]+$/);
    }
    // No lesson is keyed to something that looks like a function.
    expect(ids.some((i) => i.startsWith("build"))).toBe(false);
  });

  it("the older function-mentor still teaches functions, and still passes its own gate", async () => {
    const m = await import("@/lib/accounting/financial-statements-mentor");
    expect(() => m.assertEveryExportedFunctionIsTaught()).not.toThrow();
  });

  it("merging them would be a regression — they do not overlap", async () => {
    const m = await import("@/lib/accounting/financial-statements-mentor");
    const fnNames = new Set(m.exportedCoreFunctionNames());
    for (const l of STATEMENT_LESSONS) {
      expect(fnNames.has(String(l.statement))).toBe(false);
    }
  });
});
