/**
 * tests/compliance/owner-report-books-58.test.ts   (books-58)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE OWNER REPORT MUST STAY TRUE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Michael reads these reports to learn the system - in his words, "It helps me
 * learn and understand the system as you do." A report that quietly stops
 * matching the code is worse than no report: he would be learning something
 * false, and confidently.
 *
 * So every number and every claim in `docs/MICHAEL-books-58-the-form-as-one-
 * big-sheet.md` that CAN be checked against the engine is checked here. When
 * the code changes, this fails and names the sentence that has become a lie.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ──────────────────────────────────────────────────────────────────────────
 * It does not check the prose, the reasoning or the open questions. Those are
 * mine to get right and cannot be pinned to a value. It checks the FACTS: box
 * counts, coverage figures, which boxes are untaught, and the structural claims
 * ("the explorer is unchanged", "the door exists").
 *
 * Standing rule 66c: existence before absence. Every assertion below first
 * proves the thing it is reading actually exists, because a gate that greps a
 * file it cannot find passes by default and proves nothing.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { sheetCoverage, sheetGroups } from "@/lib/payroll/form-sheet-core";
import { ALL_TAUGHT_FORM_IDS, FORM_ID_W2 } from "@/lib/payroll/form-box-adapters";
import { teachingBoxes } from "@/lib/payroll/form-box-teaching-core";
import type { BoxLesson } from "@/lib/payroll/form-box-core";
import { FORM_W2_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-w2";
import { FORM_W3_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-w3";
import { FORM_941_LESSONS } from "@/lib/payroll/form-box-lessons-941";
import { FORM_940_LESSONS } from "@/lib/payroll/form-box-lessons-940";
import { WA_QUARTERLY_LESSONS } from "@/lib/payroll/form-box-lessons-wa";

const ROOT = process.cwd();
const REPORT = join(ROOT, "docs/MICHAEL-books-58-the-form-as-one-big-sheet.md");

const ALL_LESSONS: readonly BoxLesson[] = [
  ...FORM_W2_BOX_LESSONS,
  ...FORM_W3_BOX_LESSONS,
  ...FORM_941_LESSONS,
  ...FORM_940_LESSONS,
  ...WA_QUARTERLY_LESSONS,
];

function coverageOf(formId: string) {
  return sheetCoverage(sheetGroups(teachingBoxes(formId), ALL_LESSONS));
}

describe("books-58 owner report: the report exists and is not a stub", () => {
  it("exists", () => {
    // Rule 66c. Everything below greps this file; if it is missing, every one of
    // those assertions would pass vacuously.
    expect(existsSync(REPORT), `${REPORT} is missing`).toBe(true);
  });

  it("is a real report, not a placeholder", () => {
    const md = readFileSync(REPORT, "utf8");
    expect(md.length).toBeGreaterThan(6000);
    expect(md).toMatch(/## What you asked for/);
  });
});

describe("books-58 owner report: the coverage table matches the engine", () => {
  const md = readFileSync(REPORT, "utf8");

  /*
   * The table Michael reads as his teaching to-do list. Each row is asserted
   * against what the code actually produces, so the table cannot rot.
   */
  const ROWS: readonly {
    readonly formId: string;
    readonly total: number;
    readonly taught: number;
    readonly untaught: number;
  }[] = [
    { formId: "form_w2", total: 26, taught: 26, untaught: 0 },
    { formId: "form_w3", total: 31, taught: 31, untaught: 0 },
    { formId: "form_941", total: 27, taught: 20, untaught: 7 },
    { formId: "form_940", total: 30, taught: 20, untaught: 10 },
    { formId: "esd_5208a", total: 3, taught: 3, untaught: 0 },
    { formId: "esd_5208b", total: 4, taught: 4, untaught: 0 },
    { formId: "pfml_wa_cares", total: 3, taught: 3, untaught: 0 },
    { formId: "lni_quarterly", total: 4, taught: 4, untaught: 0 },
  ];

  it("covers every taught form, so the table cannot silently omit one", () => {
    // Rule 43: if a ninth form is added, this fails rather than the table just
    // being quietly incomplete.
    expect(ROWS.map((r) => r.formId).slice().sort()).toEqual(
      [...ALL_TAUGHT_FORM_IDS].sort(),
    );
  });

  for (const row of ROWS) {
    it(`${row.formId}: ${row.total} boxes, ${row.taught} taught, ${row.untaught} not taught`, () => {
      const cov = coverageOf(row.formId);
      expect(cov.total).toBe(row.total);
      expect(cov.teachable).toBe(row.taught);
      expect(cov.untaught).toBe(row.untaught);
    });
  }

  it("the report's headline figure of 17 untaught boxes is the real total", () => {
    const total = ALL_TAUGHT_FORM_IDS.reduce((n, f) => n + coverageOf(f).untaught, 0);
    expect(total).toBe(17);
    expect(md).toMatch(/\*\*17 boxes across two federal forms\.\*\*/);
  });

  it("the 941's named untaught boxes are exactly what the report lists", () => {
    expect(coverageOf("form_941").untaughtBoxes).toEqual([
      "5e",
      "6",
      "7",
      "10",
      "12",
      "13",
      "14",
    ]);
    expect(md).toMatch(/5e, 6, 7, 10, 12, 13, 14/);
  });

  it("the report's claim that the W-2 has zero untaught boxes is true", () => {
    // This is the claim the whole reachability argument rests on. If it stops
    // being true, the report's reasoning stops making sense and this says so.
    expect(coverageOf(FORM_ID_W2).untaught).toBe(0);
  });
});

describe("books-58 owner report: the box-9 story it tells is accurate", () => {
  const md = readFileSync(REPORT, "utf8");

  it("W-2 box 9 really is captioned '(not used)' and really is taught", () => {
    const cells = sheetGroups(teachingBoxes(FORM_ID_W2), FORM_W2_BOX_LESSONS).flatMap(
      (g) => g.cells,
    );
    const nine = cells.find((c) => c.box.box === "9");
    expect(nine, "W-2 box 9 is missing from the specimen").toBeDefined();
    expect(nine?.box.caption).toBe("(not used)");
    expect(nine?.unusedByForm).toBe(true);
    expect(nine?.affordance).toBe("teachable");
  });

  it("the lesson the report quotes by name exists", () => {
    // The report calls it "The box that must stay empty". If that headline is
    // reworded, the report is quoting something that no longer exists.
    const nine = FORM_W2_BOX_LESSONS.find((l) => l.box === "9");
    expect(nine, "no W-2 box 9 lesson").toBeDefined();
    expect(nine?.headline).toBe("The box that must stay empty");
    expect(md).toMatch(/The box that must stay empty/);
  });
});

describe("books-58 owner report: the structural claims are true", () => {
  const md = readFileSync(REPORT, "utf8");

  it("the claim that the explorer is unchanged is true", () => {
    const explorer = join(ROOT, "src/components/admin/books/FormBoxExplorer.tsx");
    expect(existsSync(explorer)).toBe(true);
    const src = readFileSync(explorer, "utf8");
    expect(src).not.toMatch(/FormSheet|form-sheet-core/);
  });

  it("the claim that the door exists is true", () => {
    const page = join(ROOT, "src/app/admin/books/form-w2/page.tsx");
    expect(existsSync(page)).toBe(true);
    const src = readFileSync(page, "utf8");
    expect(src).toMatch(/\/admin\/books\/form-w2\/sheet/);
    expect(src).toMatch(/View just the form/);
    expect(md).toMatch(/View just the form/);
  });

  it("the claim that the new page shares one lesson renderer is true", () => {
    const sheet = join(ROOT, "src/components/admin/books/FormSheet.tsx");
    expect(existsSync(sheet)).toBe(true);
    const src = readFileSync(sheet, "utf8");
    // Shares BoxLessonBody rather than re-rendering the members itself.
    expect(src).toMatch(/BoxLessonBody/);
    expect(src).not.toMatch(/lesson\.plainEnglish|lesson\.whatToDo|lesson\.commonMistake/);
  });

  it("the claim that the sheet never navigates is true", () => {
    const src = readFileSync(join(ROOT, "src/components/admin/books/FormSheet.tsx"), "utf8");
    expect(src).not.toMatch(/useRouter|next\/link|href=/);
  });

  it("the pre-existing lint warning the report flags is really pre-existing", () => {
    // The report says `w2ChecksInOrder` is declared and unused, and that it is
    // NOT this slice's doing. The symbol must at least still be there, or the
    // report is flagging a warning that no longer exists.
    const src = readFileSync(join(ROOT, "src/app/admin/books/form-w2/page.tsx"), "utf8");
    expect(src).toMatch(/w2ChecksInOrder/);
    expect(md).toMatch(/w2ChecksInOrder/);
  });

  it("the report carries the open questions forward, as he asked", () => {
    // Standing request: his open questions are repeated in EVERY report.
    expect(md).toMatch(/## Open questions/);
    expect(md).toMatch(/true accuracy, not taking my bad form filling/);
    expect(md).toMatch(/ATM revenue/);
  });

  it("the report states the mutation results, not just that testing happened", () => {
    expect(md).toMatch(/Six out of six caught/);
  });
});
