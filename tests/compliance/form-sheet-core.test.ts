/**
 * tests/compliance/form-sheet-core.test.ts   (books-58)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE ONE-BIG-SHEET VIEW, PROVED AGAINST THE REAL FORMS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Michael asked for a page "with nothing on it but form", where clicking a box
 * brings the whole lesson to him rather than sending him to the learning
 * centre, and agreed that boxes with no lesson should be "visually marked as
 * not taught yet".
 *
 * The core's own embedded self-tests cover the logic against fixtures. THIS
 * file covers the thing fixtures cannot: that the logic is still true when it
 * meets the eight real forms in the product, and that the states it can
 * produce are actually reachable.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE REACHABILITY PROBLEM THAT SHAPED THIS FILE  (standing rule 40)
 * ──────────────────────────────────────────────────────────────────────────
 * Michael asked for the W-2 first. The W-2 has 26 boxes and all 26 are taught,
 * so on the form he chose, the "not taught yet" marker CAN NEVER APPEAR. A gate
 * written only against the W-2 would assert the marker exists in the source,
 * see it, and go green, while never once producing it - an unreachable guard is
 * an untested guard, and it would stay untested until the day it was needed.
 *
 * So the marker is proved on the 941 (7 untaught boxes) and the 940 (10), where
 * it is reachable today, and the W-2 is separately proved to need none. Both
 * halves are asserted, because "the W-2 has no untaught boxes" is exactly the
 * kind of fact that changes silently when somebody adds a box.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY EVERY FORM IS WALKED RATHER THAN LISTED  (standing rule 43)
 * ──────────────────────────────────────────────────────────────────────────
 * The two defects this module had before it shipped were both found by running
 * it over forms it had not been written against:
 *
 *   - W-2 box 9 is captioned "(not used)" AND has a lesson. A three-state
 *     affordance that tested unusedness first stripped the click handler from a
 *     taught box.
 *   - The W-3's `b-kind-of-payer` / `contact` fields, and every box on all four
 *     Washington forms, were filed under a heading reading "The numbered
 *     boxes" - half the product, mis-headed.
 *
 * Neither was visible from the W-2 alone. So the suite iterates
 * `ALL_TAUGHT_FORM_IDS`, and adding the ninth form to the product runs it
 * through every assertion here without anybody remembering to.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ALL_BOX_AFFORDANCES,
  affordanceOf,
  isUnusedBox,
  sheetCoverage,
  sheetGroups,
  __runFormSheetCoreTests,
} from "@/lib/payroll/form-sheet-core";
import type { BoxLesson } from "@/lib/payroll/form-box-core";
import { ALL_TAUGHT_FORM_IDS, FORM_ID_W2 } from "@/lib/payroll/form-box-adapters";
import { teachingBoxes } from "@/lib/payroll/form-box-teaching-core";
import { FORM_W2_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-w2";
import { FORM_W3_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-w3";
import { FORM_941_LESSONS } from "@/lib/payroll/form-box-lessons-941";
import { FORM_940_LESSONS } from "@/lib/payroll/form-box-lessons-940";
import { WA_QUARTERLY_LESSONS } from "@/lib/payroll/form-box-lessons-wa";

const ROOT = process.cwd();

/**
 * Every BoxLesson in the product.
 *
 * Assembled here rather than imported, because no single union exists - each
 * form page imports its own set, and inventing a global aggregate would be a
 * new export for the tests' convenience. `lessonFor` matches on formId AND box,
 * so handing the whole pile to one form is safe and is itself worth exercising:
 * if the formId half of that match were ever dropped, the 941's untaught boxes
 * would start finding the 940's lessons and this file would go red.
 */
const ALL_LESSONS: readonly BoxLesson[] = [
  ...FORM_W2_BOX_LESSONS,
  ...FORM_W3_BOX_LESSONS,
  ...FORM_941_LESSONS,
  ...FORM_940_LESSONS,
  ...WA_QUARTERLY_LESSONS,
];

describe("form-sheet-core: the embedded self-tests", () => {
  it("pass", () => {
    expect(() => __runFormSheetCoreTests()).not.toThrow();
  });
});

describe("form-sheet-core: every real form builds a sheet", () => {
  it("has a non-trivial set of forms to walk, or the suite below is vacuous", () => {
    expect(ALL_TAUGHT_FORM_IDS.length).toBeGreaterThanOrEqual(8);
  });

  for (const formId of ALL_TAUGHT_FORM_IDS) {
    it(`${formId} groups every box exactly once, losing none`, () => {
      const boxes = teachingBoxes(formId);
      expect(boxes.length).toBeGreaterThan(0);

      const groups = sheetGroups(boxes, ALL_LESSONS);
      const placed = groups.flatMap((g) => g.cells.map((c) => c.box.box));

      // Same multiset, same order. A sheet that silently drops a box is worse
      // than one that fails to load: the reader copies a return with a line
      // missing and has no way to know.
      expect(placed.slice().sort()).toEqual(boxes.map((b) => b.box).slice().sort());
      expect(placed.length).toBe(boxes.length);
      expect(new Set(placed).size).toBe(boxes.length);
    });

    it(`${formId} never emits an empty group or an untrue heading`, () => {
      const groups = sheetGroups(teachingBoxes(formId), ALL_LESSONS);
      for (const g of groups) {
        // An empty section reads as a part of the form that failed to load.
        expect(g.cells.length, `${formId} group "${g.key}" is empty`).toBeGreaterThan(0);

        // A heading promising numbers must contain only numeric box ids, and
        // vice versa. This is the assertion that catches the W-3's
        // `b-kind-of-payer` and every Washington box being called "numbered".
        if (g.key === "numbered") {
          for (const c of g.cells) {
            expect(
              /^[0-9]/.test(c.box.box),
              `${formId} box "${c.box.box}" is under a numbered heading but is not numbered`,
            ).toBe(true);
          }
        } else {
          for (const c of g.cells) {
            expect(
              /^[0-9]/.test(c.box.box),
              `${formId} box "${c.box.box}" is numbered but is not under the numbered heading`,
            ).toBe(false);
          }
        }
      }
    });

    it(`${formId} coverage figures reconcile with the sheet`, () => {
      const groups = sheetGroups(teachingBoxes(formId), ALL_LESSONS);
      const cov = sheetCoverage(groups);
      const cells = groups.flatMap((g) => g.cells);

      expect(cov.total).toBe(cells.length);
      // The three buckets partition the sheet. `sheetCoverage` throws if they
      // do not, so this restates the invariant where a reader can see it.
      expect(cov.teachable + cov.untaught + cov.unusedAndUntaught).toBe(cov.total);
      expect(cov.untaughtBoxes.length).toBe(cov.untaught);
    });

    it(`${formId} prints no fabricated figure for an unknown box`, () => {
      const cells = sheetGroups(teachingBoxes(formId), ALL_LESSONS).flatMap((g) => g.cells);
      for (const c of cells) {
        if (!c.notComputed) continue;
        // A "$0.00" beside an uncomputed box is a CLAIM - that no wages were
        // paid, that no tax is owed. `formatBoxValue` returns prose instead,
        // and this proves the sheet did not undo that.
        expect(
          /[0-9]/.test(c.printed),
          `${formId} box ${c.box.box} is not computed yet but printed "${c.printed}"`,
        ).toBe(false);
      }
    });

    it(`${formId} carries a lesson for every box it calls teachable`, () => {
      const cells = sheetGroups(teachingBoxes(formId), ALL_LESSONS).flatMap((g) => g.cells);
      for (const c of cells) {
        if (c.affordance === "teachable") {
          // A teachable box with no lesson is a dead control: the reader
          // clicks, an empty panel opens, and the only conclusion available is
          // that the app is broken.
          expect(c.lesson, `${formId} box ${c.box.box} is teachable but carries no lesson`)
            .toBeDefined();
          expect(c.lesson?.formId).toBe(formId);
          expect(c.lesson?.box).toBe(c.box.box);
        } else {
          expect(
            c.lesson,
            `${formId} box ${c.box.box} is marked untaught but a lesson exists for it`,
          ).toBeUndefined();
        }
      }
    });
  }
});

describe("form-sheet-core: the 'not taught yet' marker is reachable", () => {
  /*
   * The whole point of this block. Michael approved marking untaught boxes, and
   * the form he asked for first cannot produce one. These assertions prove the
   * state exists in the real product, so the marker is not decoration.
   */
  it("the 941 really does have untaught boxes today", () => {
    const cov = sheetCoverage(sheetGroups(teachingBoxes("form_941"), ALL_LESSONS));
    expect(cov.untaught).toBeGreaterThan(0);
    expect(cov.untaughtBoxes).toEqual(["5e", "6", "7", "10", "12", "13", "14"]);
  });

  it("the 940 really does have untaught boxes today", () => {
    const cov = sheetCoverage(sheetGroups(teachingBoxes("form_940"), ALL_LESSONS));
    expect(cov.untaught).toBeGreaterThan(0);
  });

  it("at least one box in the product is untaught, or the marker is dead code", () => {
    const untaught = ALL_TAUGHT_FORM_IDS.flatMap((f) =>
      sheetCoverage(sheetGroups(teachingBoxes(f), ALL_LESSONS)).untaughtBoxes.map(
        (b) => `${f}:${b}`,
      ),
    );
    expect(untaught.length).toBeGreaterThan(0);
  });

  it("at least one box in the product is teachable, or the click target is dead code", () => {
    const teachable = ALL_TAUGHT_FORM_IDS.flatMap((f) =>
      sheetGroups(teachingBoxes(f), ALL_LESSONS)
        .flatMap((g) => g.cells)
        .filter((c) => c.affordance === "teachable"),
    );
    expect(teachable.length).toBeGreaterThan(100);
  });

  it("every affordance in the vocabulary is produced by a real form", () => {
    const produced = new Set(
      ALL_TAUGHT_FORM_IDS.flatMap((f) =>
        sheetGroups(teachingBoxes(f), ALL_LESSONS)
          .flatMap((g) => g.cells)
          .map((c) => c.affordance),
      ),
    );
    // Rule 43: walked, not hand-listed. A state nobody can reach is a state
    // nobody has tested, and it must be deleted or made reachable.
    for (const a of ALL_BOX_AFFORDANCES) {
      expect(produced.has(a), `affordance "${a}" is unreachable across every real form`).toBe(
        true,
      );
    }
  });
});

describe("form-sheet-core: W-2 box 9 - unused AND taught", () => {
  /*
   * This is the defect the core shipped a draft of and the probe caught. It is
   * pinned against the REAL W-2 rather than a fixture, because the fixture only
   * proves the rule; this proves the product still obeys it.
   */
  const w2 = sheetGroups(teachingBoxes(FORM_ID_W2), FORM_W2_BOX_LESSONS).flatMap(
    (g) => g.cells,
  );
  const nine = w2.find((c) => c.box.box === "9");

  it("W-2 box 9 exists and the IRS caption still says it is not used", () => {
    expect(nine).toBeDefined();
    expect(nine?.box.caption).toBe("(not used)");
    expect(isUnusedBox(nine!.box)).toBe(true);
  });

  it("W-2 box 9 is STILL clickable, because it has a lesson", () => {
    // The lesson is "The box that must stay empty" - that the box is retired,
    // and the entire IRS instruction is "do not enter an amount in box 9".
    // Marking it unclickable would hide the most useful sentence on the form.
    expect(nine?.affordance).toBe("teachable");
    expect(nine?.lesson).toBeDefined();
    expect(nine?.unusedByForm).toBe(true);
  });

  it("W-2 box 9 is not counted as a coverage gap", () => {
    const cov = sheetCoverage(sheetGroups(teachingBoxes(FORM_ID_W2), FORM_W2_BOX_LESSONS));
    expect(cov.untaughtBoxes).not.toContain("9");
    expect(cov.unused).toBe(1);
  });

  it("the W-2 has no untaught boxes, so the marker is correctly absent there", () => {
    const cov = sheetCoverage(sheetGroups(teachingBoxes(FORM_ID_W2), FORM_W2_BOX_LESSONS));
    // Stated as a fact that must be maintained: if a box is added to the W-2
    // without a lesson, this goes red and somebody decides deliberately.
    expect(cov.untaught).toBe(0);
    expect(cov.total).toBe(26);
    expect(cov.teachable).toBe(26);
  });
});

describe("form-sheet-core: refusals", () => {
  it("refuses an empty form rather than drawing a blank sheet", () => {
    expect(() => sheetGroups([], ALL_LESSONS)).toThrow(/no boxes/i);
  });

  it("refuses boxes from two different forms", () => {
    const mixed = [...teachingBoxes(FORM_ID_W2).slice(0, 2), ...teachingBoxes("form_941").slice(0, 2)];
    expect(() => sheetGroups(mixed, ALL_LESSONS)).toThrow(/more than one form/i);
  });

  it("does not treat a caption merely mentioning the words as an unused box", () => {
    const real = teachingBoxes("form_941").find((b) => /not used/i.test(b.caption));
    // If a 941 caption ever contains the phrase, it must not be swallowed by
    // the narrow regex. Asserted whether or not one exists today.
    if (real !== undefined) expect(isUnusedBox(real)).toBe(false);
    expect(
      isUnusedBox({ ...teachingBoxes(FORM_ID_W2)[0], caption: "Wages not used for the credit" }),
    ).toBe(false);
  });

  it("affordanceOf depends on the lesson and nothing else", () => {
    const box = teachingBoxes(FORM_ID_W2)[0];
    expect(affordanceOf({ box, tone: "neutral", printed: "", empty: true, correctlyBlank: false, hasLesson: true })).toBe("teachable");
    expect(affordanceOf({ box, tone: "neutral", printed: "", empty: true, correctlyBlank: false, hasLesson: false })).toBe("untaught");
  });
});

describe("form-sheet-core: the page keeps its promises", () => {
  const SHEET = join(ROOT, "src/components/admin/books/FormSheet.tsx");
  const PAGE = join(ROOT, "src/app/admin/books/form-w2/sheet/page.tsx");
  const sheetSrc = readFileSync(SHEET, "utf8");
  const pageSrc = readFileSync(PAGE, "utf8");

  /*
   * These read source text, which is normally a bad idea. The precedent and the
   * reasoning are in form-box-explorer-wiring.test.ts: these failures are
   * ABSENCES in a component that cannot be rendered in this suite without
   * Supabase, cookies and a live session. An absence cannot be detected by
   * importing the module.
   */
  it("brings the lesson to the page instead of redirecting to the learning centre", () => {
    // His words: "I don't want to be redirected to the learning center, but
    // have the lesson brought to me on the form page." So the sheet may not
    // navigate: no router, no <Link>, no href.
    expect(sheetSrc).not.toMatch(/useRouter|router\.push|next\/link|<Link/);
    expect(sheetSrc).not.toMatch(/href=/);
  });

  it("renders the whole lesson through the shared renderer, not a summary", () => {
    // Rule 25: BoxLessonBody is the one renderer for a BoxLesson. A second one
    // starts by showing most of the members and silently stops showing the next
    // member anybody adds.
    expect(sheetSrc).toMatch(/import \{ BoxLessonBody \}/);
    expect(sheetSrc).toMatch(/<BoxLessonBody lesson=\{cell\.lesson\}/);
  });

  it("marks untaught boxes in words a person can read", () => {
    expect(sheetSrc).toMatch(/not taught yet/);
  });

  it("distinguishes 'not used' from 'not taught yet'", () => {
    // Two different statements: one about the FORM, one about THIS PRODUCT.
    // Collapsing them was the first draft's bug.
    expect(sheetSrc).toMatch(/not used/);
    expect(sheetSrc).toMatch(/unusedByForm/);
  });

  it("makes taught boxes real buttons, reachable by keyboard", () => {
    expect(sheetSrc).toMatch(/<button/);
    expect(sheetSrc).toMatch(/aria-expanded/);
  });

  it("the new route is additive and guards access like every other books page", () => {
    expect(pageSrc).toMatch(/requireBooksAccess/);
    expect(pageSrc).toMatch(/FormSheet/);
  });

  it("the new route falls back to the specimen for no-payroll, but NOT for a read failure", () => {
    // books-49: hiding a teaching surface behind `result.ok` made it invisible
    // for a year. But a read FAILURE must not show invented figures as though
    // they were his.
    expect(pageSrc).toMatch(/teachingBoxes\(FORM_ID_W2\)/);
    expect(pageSrc).toMatch(/readFailed/);
  });

  it("does not modify the existing tabbed explorer or the existing W-2 page", () => {
    // "Rather than updating or changing any of it." Proved by the absence of
    // any import of this new component from the old surfaces.
    const oldPage = readFileSync(join(ROOT, "src/app/admin/books/form-w2/page.tsx"), "utf8");
    const explorer = readFileSync(
      join(ROOT, "src/components/admin/books/FormBoxExplorer.tsx"),
      "utf8",
    );
    expect(oldPage).not.toMatch(/FormSheet/);
    expect(explorer).not.toMatch(/FormSheet|form-sheet-core/);
  });
});
