/**
 * tests/compliance/owner-report-books-60.test.ts   (books-60)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE OWNER REPORT MUST STAY TRUE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael reads these to learn the system: "It helps me learn and understand
 * the system as you do." A report that quietly stops matching the code is worse
 * than no report, because he would be learning something false and confidently.
 *
 * So every FACT in `docs/MICHAEL-books-60-the-941-you-can-click.md` that can be
 * checked against the engine is checked here. Prose, reasoning and open
 * questions are mine to get right and cannot be pinned to a value; box counts,
 * dollar figures, route existence and structural claims can be, and are.
 *
 * Standing rule 66c: existence before absence. Every assertion proves the thing
 * it reads exists first, because a gate that greps a missing file passes by
 * default and proves nothing.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { sheetCoverage, sheetGroups } from "@/lib/payroll/form-sheet-core";
import { teachingBoxes } from "@/lib/payroll/form-box-teaching-core";
import { ALL_TAUGHT_FORM_IDS } from "@/lib/payroll/form-box-adapters";
import { extractPageGuard } from "@/lib/auth/nav-gate-core";
import { FORM_941_LESSONS } from "@/lib/payroll/form-box-lessons-941";
import { FORM_940_LESSONS } from "@/lib/payroll/form-box-lessons-940";
import { FORM_W2_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-w2";
import { FORM_W3_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-w3";
import { WA_QUARTERLY_LESSONS } from "@/lib/payroll/form-box-lessons-wa";

const ROOT = process.cwd();
const REPORT = join(ROOT, "docs/MICHAEL-books-60-the-941-you-can-click.md");
const MIRROR_940 = join(ROOT, "docs/authorities/federal/filed-form-940-2025-greenway.txt");

const ALL_LESSONS = [
  ...FORM_W2_BOX_LESSONS,
  ...FORM_W3_BOX_LESSONS,
  ...FORM_941_LESSONS,
  ...FORM_940_LESSONS,
  ...WA_QUARTERLY_LESSONS,
];

function coverageOf(formId: string) {
  return sheetCoverage(sheetGroups(teachingBoxes(formId), ALL_LESSONS));
}

describe("books-60 report: it exists and is a real report", () => {
  it("exists", () => {
    expect(existsSync(REPORT), `${REPORT} is missing`).toBe(true);
  });

  it("is not a stub", () => {
    const md = readFileSync(REPORT, "utf8");
    expect(md.length).toBeGreaterThan(6_000);
    expect(md).toMatch(/## What you asked for/);
  });
});

describe("books-60 report: the box figures are the engine's own", () => {
  const md = readFileSync(REPORT, "utf8");

  it("the 941 really has 27 boxes, 24 taught and 3 untaught", () => {
    const cov = coverageOf("form_941");
    expect(cov.total).toBe(27);
    expect(cov.teachable).toBe(24);
    expect(cov.untaught).toBe(3);
    expect(md).toMatch(/27 total · 24 teach · 3 left untaught on purpose/);
  });

  it("the three untaught 941 boxes really are 12, 13 and 14", () => {
    expect(coverageOf("form_941").untaughtBoxes).toEqual(["12", "13", "14"]);
    expect(md).toMatch(/lines 12, 13 or 14/);
  });

  it("the standing to-do list really is 13 boxes", () => {
    const total = ALL_TAUGHT_FORM_IDS.reduce((n, f) => n + coverageOf(f).untaught, 0);
    expect(total).toBe(13);
    expect(md).toMatch(/13 boxes, down from 17/);
  });

  it("names the four boxes it claims to have taught, and they really are taught", () => {
    for (const box of ["5e", "6", "7", "10"]) {
      expect(
        FORM_941_LESSONS.some((l) => l.box === box),
        `the report says 941 box ${box} was taught, but there is no lesson for it`,
      ).toBe(true);
    }
  });

  it("the 940 really still has ten untaught boxes", () => {
    expect(coverageOf("form_940").untaught).toBe(10);
    expect(md).toMatch(/The 940 has ten untaught boxes/);
  });
});

describe("books-60 report: the 940 dollar figures come from the filed return", () => {
  const md = readFileSync(REPORT, "utf8");
  const mirror = existsSync(MIRROR_940) ? readFileSync(MIRROR_940, "utf8") : "";

  it("the mirrored return exists to back the claim up", () => {
    // Rule 66c. Without this the greps below could pass on an empty string.
    expect(existsSync(MIRROR_940)).toBe(true);
    expect(mirror.length).toBeGreaterThan(10_000);
  });

  /*
   * Each figure is asserted in the REPORT and in the RETURN. Matching only the
   * report would prove I can write the same number twice; matching only the
   * return would not prove the report says it.
   */
  const FIGURES: readonly [string, string][] = [
    ["line 3 total payments", "332,975.44"],
    ["line 6 exempt and excess", "262,975.44"],
    ["line 7 taxable FUTA wages", "70,000.00"],
  ];

  for (const [what, printed] of FIGURES) {
    it(`${what} (${printed}) is in the report and in the filed return`, () => {
      expect(md).toContain(printed);
      // The layout extraction prints cents in a separate column, so the return
      // carries "332975 44" rather than "332,975.44".
      const bare = printed.replace(/,/g, "").replace(".", " ");
      expect(mirror).toContain(bare);
    });
  }

  it("the $420 conclusion is arithmetic on those figures, not an assertion", () => {
    const line3 = 33_297_544;
    const line6 = 26_297_544;
    const line7 = line3 - line6;
    const futa = Math.round((line7 * 6) / 1000);
    expect(line7).toBe(7_000_000);
    expect(futa).toBe(42_000);
    expect(md).toMatch(/\*\*\$420\.00\*\* of FUTA tax/);
  });

  it("quotes the $500 threshold sentence exactly as the return prints it", () => {
    const sentence =
      "Report your FUTA tax liability by quarter only if line 12 is more than $500.";
    expect(md).toContain(sentence);
    expect(mirror.split(/\s+/).join(" ")).toContain(sentence.split(/\s+/).join(" "));
  });

  it("420 really is under 500, which is the entire argument", () => {
    expect(42_000).toBeLessThanOrEqual(50_000);
  });
});

describe("books-60 report: the structural claims are true", () => {
  const md = readFileSync(REPORT, "utf8");
  const SHEET = join(ROOT, "src/app/admin/books/form-941/sheet/page.tsx");
  const PARENT = join(ROOT, "src/app/admin/books/form-941/page.tsx");

  it("the 941 sheet page the report describes actually exists", () => {
    expect(existsSync(SHEET), "the report describes a page that was never built").toBe(true);
  });

  it("the door the report tells him to look for is really in the header", () => {
    const parent = readFileSync(PARENT, "utf8");
    expect(parent).toMatch(/\/admin\/books\/form-941\/sheet/);
    expect(parent).toMatch(/View just the form/);
    expect(md).toMatch(/View just the form/);
  });

  it("the sheet really is access-guarded, checked by call shape not by grep", () => {
    // The report tells him this was the escape. If it were still escaping, the
    // report would be describing a fix that did not happen.
    expect(extractPageGuard(readFileSync(SHEET, "utf8"))).toEqual({ kind: "books-access" });
  });

  it("the claim that the tabbed 941 keeps its own surfaces is true", () => {
    const parent = readFileSync(PARENT, "utf8");
    expect(parent).toMatch(/FormBoxExplorer/);
    // "untouched apart from the one button": the parent must not have taken on
    // the sheet renderer.
    expect(parent).not.toMatch(/FormSheet/);
  });

  it("the claim that two of six forms have sheets is true", () => {
    const withSheet = ["form-w2", "form-941"].filter((f) =>
      existsSync(join(ROOT, "src/app/admin/books", f, "sheet", "page.tsx")),
    );
    expect(withSheet).toHaveLength(2);
    expect(md).toMatch(/2 of 6 forms \(W-2, 941\)/);
  });
});

describe("books-60 report: it discloses rather than polishes", () => {
  const md = readFileSync(REPORT, "utf8");

  it("reports the access-guard escape instead of only the successes", () => {
    // The whole value of these reports to him is that the failures are in them.
    expect(md).toMatch(/no access check/i);
    expect(md).toMatch(/testing an import/);
  });

  it("reports that three of four quotes were wrong before they were fixed", () => {
    expect(md).toMatch(/Four quotes, three wrong/);
  });

  it("states the mutation results as numbers, not as 'testing happened'", () => {
    expect(md).toMatch(/Six of seven caught on the first run/);
  });

  it("carries the four open questions forward, as he asked", () => {
    expect(md).toMatch(/## Open questions/);
    expect(md).toMatch(/true accuracy, not taking my bad form filling/);
    expect(md).toMatch(/ATM revenue/);
  });

  it("surfaces the pre-existing warnings, as he asked", () => {
    // Standing request: pre-existing warnings appear in EVERY summary report,
    // so that "no new warnings" never reads as "no warnings".
    expect(md).toMatch(/## Warnings I owe you/);
    expect(md).toMatch(/w2ChecksInOrder/);
    expect(md).toMatch(/51000 ATM Surcharge Income/);
  });

  it("admits the measurement it has NOT done rather than implying it is fine", () => {
    expect(md).toMatch(/I have not measured whether the ATM, the intercompany rent or the bank feeds/);
  });
});
