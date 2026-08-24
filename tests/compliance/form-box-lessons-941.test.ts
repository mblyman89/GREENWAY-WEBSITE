/**
 * tests/compliance/form-box-lessons-941.test.ts
 *
 * ═══ RULE 35: VERBATIM MUST BE MECHANICALLY VERIFIED, NOT CAREFULLY TYPED ═══
 *
 * The load-bearing test in this file is the one that reads the mirrored IRS
 * instructions off disk and confirms every quoted string is actually present in
 * them, character for character. A citation nobody checks is decoration, and a
 * MISQUOTED citation is worse than none: it is authority-shaped and wrong.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  FORM_941_LESSONS,
  FORM_941_SOURCE_PATH,
  FORM_941_SOURCE_URL,
  SS_WAGE_BASE_2026_DOLLARS,
} from "@/lib/payroll/form-box-lessons-941";
import { lessonFor } from "@/lib/payroll/form-box-core";

const corpus = readFileSync(FORM_941_SOURCE_PATH, "utf8");

describe("every quote is really in the IRS instructions", () => {
  it("finds each quoted passage verbatim in the mirrored file", () => {
    let checked = 0;
    for (const lesson of FORM_941_LESSONS) {
      for (const q of lesson.quotes) {
        expect(
          corpus.includes(q.quote),
          `Form 941 box ${lesson.box}: quote NOT found verbatim in ${q.sourcePath}:\n${q.quote}`,
        ).toBe(true);
        checked += 1;
      }
    }
    // Assert existence before absence (rule 66d): if this file ever loses its
    // quotes the loop above passes trivially.
    expect(checked).toBeGreaterThanOrEqual(6);
    console.log(`form-941 lessons: ${checked} quotes verified verbatim against the corpus`);
  });

  it("reads a corpus big enough to be the real document", () => {
    expect(corpus.length).toBeGreaterThan(80_000);
  });

  it("confirms the wage base named in the lessons appears in the instructions", () => {
    // The teaching text states $184,500. If the IRS figure ever changes, this
    // fails and the lessons must be re-read rather than silently left stale.
    expect(corpus).toContain(`$${SS_WAGE_BASE_2026_DOLLARS.toLocaleString("en-US")}`);
  });

  it("gives every quote a citation, a repo path and an openable URL", () => {
    for (const lesson of FORM_941_LESSONS) {
      for (const q of lesson.quotes) {
        expect(q.cite.length).toBeGreaterThan(20);
        expect(q.sourcePath).toBe(FORM_941_SOURCE_PATH);
        expect(q.sourceUrl.startsWith("https://")).toBe(true);
        // soWhat is the translation from law into action. A quote without it is
        // the wall of words Michael complained about.
        expect(q.soWhat.length).toBeGreaterThan(30);
      }
    }
  });

  it("points every source at a URL a browser can open, not a repo path", () => {
    // The exact defect found in slice A: 7 authorities carried a docs/ path in a
    // field the UI renders as an href.
    expect(FORM_941_SOURCE_URL.startsWith("https://")).toBe(true);
    expect(FORM_941_SOURCE_URL).not.toContain("docs/");
  });
});

describe("the lessons teach, not just cite", () => {
  it("gives every lesson all of its required teaching fields", () => {
    expect(FORM_941_LESSONS.length).toBeGreaterThanOrEqual(5);
    for (const l of FORM_941_LESSONS) {
      expect(l.formId).toBe("form_941");
      expect(l.box.length).toBeGreaterThan(0);
      expect(l.headline.length).toBeGreaterThan(20);
      // Thorough was the instruction. These minimums are what "thorough" means
      // mechanically — prose this short cannot have explained anything.
      expect(l.plainEnglish.length).toBeGreaterThan(120);
      expect(l.whereItComesFrom.length).toBeGreaterThan(80);
      expect(l.howToReadIt.length).toBeGreaterThan(80);
      expect(l.whatToDo.length).toBeGreaterThan(50);
    }
  });

  it("tells Michael what to DO in the imperative, never 'consider'", () => {
    for (const l of FORM_941_LESSONS) {
      expect(l.whatToDo.toLowerCase()).not.toContain("you may wish");
      expect(l.whatToDo.toLowerCase()).not.toContain("consider whether");
    }
  });

  it("names the characteristic mistake on every line that has one", () => {
    // Not every box has a known failure mode, but most do, and a lesson without
    // one is usually a box nobody has thought hard enough about.
    const withMistake = FORM_941_LESSONS.filter((l) => l.commonMistake !== null);
    expect(withMistake.length).toBe(FORM_941_LESSONS.length);
    for (const l of withMistake) {
      expect(l.commonMistake!.length).toBeGreaterThan(60);
    }
  });
});

describe("the worked examples actually work", () => {
  it("shows real arithmetic, step by step, ending in an answer", () => {
    const examples = FORM_941_LESSONS.flatMap((l) => l.examples);
    expect(examples.length).toBeGreaterThanOrEqual(4);
    for (const ex of examples) {
      expect(ex.steps.length).toBeGreaterThanOrEqual(3);
      expect(ex.answer.length).toBeGreaterThan(0);
      expect(ex.moral.length).toBeGreaterThan(30);
    }
  });

  it("computes the 12.4% employer-plus-employee example correctly", () => {
    const l = lessonFor(FORM_941_LESSONS, "form_941", "5a")!;
    const ex = l.examples.find((e) => e.title.includes("employer tax"))!;
    // Re-derive the number the example claims, rather than trusting the string.
    // 99,000.00 x 0.124 = 12,276.00
    const wagesCents = 99_000_00;
    const taxCents = Math.round((wagesCents * 124) / 1000);
    expect(taxCents).toBe(12_276_00);
    expect(ex.answer).toBe("$12,276.00");
  });

  it("computes the line 2 versus line 5a example correctly", () => {
    const l = lessonFor(FORM_941_LESSONS, "form_941", "2")!;
    const ex = l.examples[0];
    // 84,000 + 15,000 + 1,800 = 100,800
    expect(84_000_00 + 15_000_00 + 1_800_00).toBe(100_800_00);
    expect(ex.answer).toBe("$100,800.00");
  });

  it("keeps the wage-base example consistent with the stated base", () => {
    const l = lessonFor(FORM_941_LESSONS, "form_941", "5c")!;
    const ex = l.examples[0];
    // 200,000 - 184,500 = 15,500, which the example's answer states.
    expect(200_000 - SS_WAGE_BASE_2026_DOLLARS).toBe(15_500);
    expect(ex.answer).toContain("15,500");
  });
});

describe("the cross-form ties are the reason a stack of forms is a system", () => {
  it("ties line 2 to W-2 box 1", () => {
    const l = lessonFor(FORM_941_LESSONS, "form_941", "2")!;
    const tie = l.tiesTo.find((t) => t.formId === "form_w2" && t.box === "1");
    expect(tie).toBeDefined();
    expect(tie!.why.length).toBeGreaterThan(40);
  });

  it("ties 5a to W-2 box 3 and 5c to W-2 box 5", () => {
    expect(
      lessonFor(FORM_941_LESSONS, "form_941", "5a")!.tiesTo.some(
        (t) => t.formId === "form_w2" && t.box === "3",
      ),
    ).toBe(true);
    expect(
      lessonFor(FORM_941_LESSONS, "form_941", "5c")!.tiesTo.some(
        (t) => t.formId === "form_w2" && t.box === "5",
      ),
    ).toBe(true);
  });

  it("gives every tie a reason, never a bare pointer", () => {
    for (const l of FORM_941_LESSONS) {
      for (const t of l.tiesTo) {
        expect(t.why.length).toBeGreaterThan(40);
      }
    }
  });
});

describe("the two Greenway-specific traps survive in the teaching", () => {
  it("explains that line 2 exceeding line 5a is CORRECT for a shareholder premium", () => {
    const l = lessonFor(FORM_941_LESSONS, "form_941", "2")!;
    const all = `${l.plainEnglish} ${l.commonMistake} ${l.examples.map((e) => e.moral).join(" ")}`;
    expect(all).toContain("2%-or-more shareholder");
    expect(all.toLowerCase()).toContain("not a mistake");
  });

  it("warns that hitting the Social Security base does NOT stop Medicare", () => {
    const l = lessonFor(FORM_941_LESSONS, "form_941", "5a")!;
    expect(l.commonMistake).toContain("MEDICARE");
    const quoted = l.quotes.map((q) => q.quote).join("\n");
    expect(quoted).toContain("continue to withhold income and Medicare taxes");
  });

  it("states that Medicare has no ceiling", () => {
    const l = lessonFor(FORM_941_LESSONS, "form_941", "5c")!;
    expect(l.plainEnglish).toContain("NO");
    expect(l.howToReadIt.toLowerCase()).toContain("greater than or equal");
  });
});
