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
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
import { extractPageGuard } from "@/lib/auth/nav-gate-core";
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

describe("form-sheet-core: the 'not taught yet' marker, after books-65", () => {
  /*
   * ---------------------------------------------------------------------
   * THIS BLOCK WAS INVERTED IN books-65, AND HERE IS WHY  (rules 23, 40, 50)
   * ---------------------------------------------------------------------
   * It used to read "the 941 really does have untaught boxes today" and pin
   * that list to ["12","13","14"]. That was the right gate for books-58
   * through books-64, when the marker was reachable in the shipped product and
   * the risk worth guarding was the set changing without anybody saying why.
   *
   * Michael then looked at the forms and said:
   *
   *   "the boxes that dont have lessons, the boxes look like there is a red
   *    squiggly line in it, but id rather they just open a box that says in
   *    plain english what it is and why it doesn't need a lesson"
   *
   *   "on the 941 schedule b, every single box opens with an explanation.
   *    this is the level of thoroughness i want."
   *
   * Before writing anything, the 23 marked boxes were measured and each was
   * asked whether real authority existed for it. It did, 23 for 23, located by
   * line number in the mirrored IRS corpora. So not one of them was a box that
   * "doesn't need a lesson" - they were boxes nobody had written yet. Writing
   * them removes the marker's CAUSE rather than dressing up its symptom, which
   * is what Michael actually asked for.
   *
   * That makes the old assertions unsatisfiable. The previous author left an
   * instruction for this moment - "this test should move to whichever form
   * still has an untaught box -- not be deleted" - but there is no such form
   * left. So the block is inverted rather than moved or deleted:
   *
   *   1. the product now has ZERO untaught boxes, and that is PINNED, so a new
   *      box added without a lesson fails here instead of shipping a squiggle;
   *   2. the marker is still proved REACHABLE - through the real pipeline, on
   *      real product boxes, with the lesson set withheld - so rule 40 is
   *      satisfied and `affordanceOf`'s untaught branch is not dead code.
   *
   * Point 2 matters because point 1 alone would let somebody delete the
   * untaught branch entirely and stay green.
   */

  it("no form in the product has an untaught box any more", () => {
    const untaught = ALL_TAUGHT_FORM_IDS.flatMap((f) =>
      sheetCoverage(sheetGroups(teachingBoxes(f), ALL_LESSONS)).untaughtBoxes.map(
        (b) => `${f}:${b}`,
      ),
    );
    // Listed in the message, not just counted, so the failure names the box.
    expect(
      untaught,
      "a box is rendering with the 'not taught yet' marker. books-65 closed " +
        "every one of them at Michael's request; if a new box arrived, it needs " +
        "a lesson backed by real authority, not a re-opened exception here.",
    ).toEqual([]);
  });

  it("the 941 and the 940 specifically are fully taught", () => {
    // Named separately from the sweep above because these two are the forms
    // books-65 was about, and a helpful refactor of ALL_TAUGHT_FORM_IDS could
    // drop them from the sweep without anybody noticing.
    for (const formId of ["form_941", "form_940"]) {
      const cov = sheetCoverage(sheetGroups(teachingBoxes(formId), ALL_LESSONS));
      expect(cov.untaughtBoxes, `${formId} has untaught boxes again`).toEqual([]);
      expect(cov.teachable, `${formId} teaches nothing at all`).toBeGreaterThan(0);
      expect(cov.teachable + cov.unusedAndUntaught).toBe(cov.total);
    }
  });

  it("the untaught marker is still REACHABLE, on real boxes, with no lesson set", () => {
    /*
     * Rule 40. Full coverage must not be allowed to turn the untaught branch
     * into dead code that no test can distinguish from a deletion.
     *
     * These are the REAL 941 boxes going through the REAL sheetGroups. The only
     * thing withheld is the lessons, which is exactly the state the product is
     * in the moment somebody adds a box and forgets to teach it.
     */
    const groups = sheetGroups(teachingBoxes("form_941"), []);
    const cells = groups.flatMap((g) => g.cells);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.affordance, `box ${c.box.box} with no lesson was not marked untaught`).toBe(
        "untaught",
      );
      expect(c.lesson).toBeUndefined();
    }
    const cov = sheetCoverage(groups);
    expect(cov.teachable).toBe(0);
    expect(cov.untaught + cov.unusedAndUntaught).toBe(cov.total);
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
    /*
     * books-65: "teachable" now comes from the product as shipped, and
     * "untaught" from the same real boxes with the lesson set withheld. Both
     * halves walk ALL_TAUGHT_FORM_IDS rather than naming forms, per rule 43,
     * so a ninth form is covered without anybody remembering to add it.
     */
    const produced = new Set(
      ALL_TAUGHT_FORM_IDS.flatMap((f) => [
        ...sheetGroups(teachingBoxes(f), ALL_LESSONS)
          .flatMap((g) => g.cells)
          .map((c) => c.affordance),
        ...sheetGroups(teachingBoxes(f), [])
          .flatMap((g) => g.cells)
          .map((c) => c.affordance),
      ]),
    );
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
    // Was `toMatch(/requireBooksAccess/)`, which an import satisfies. See the
    // per-route block below for the mutation that proved it. Rule 23: the fix
    // belongs on every instance of the class, including this one.
    expect(extractPageGuard(pageSrc)).toEqual({ kind: "books-access" });
    expect(pageSrc).toMatch(/FormSheet/);
  });

  it("the new route falls back to the specimen for no-payroll, but NOT for a read failure", () => {
    // books-49: hiding a teaching surface behind `result.ok` made it invisible
    // for a year. But a read FAILURE must not show invented figures as though
    // they were his.
    expect(pageSrc).toMatch(/teachingBoxes\(FORM_ID_W2\)/);
    expect(pageSrc).toMatch(/readFailed/);
  });

  it("is reachable: the W-2 screen carries a link to the sheet", () => {
    /*
     * ═══ THE GATE THAT EXISTS BECAUSE ANOTHER GATE CAUGHT ME ═══
     *
     * This route first shipped with a link back to the W-2 screen and NOTHING
     * linking forward to it. `nav-gate-core` failed within the hour with
     * exactly the right words: "owner-only pages that are not in the menu...
     * Each one is a decision nobody made."
     *
     * It is on that gate's `known` list now, which exempts it from the MENU.
     * That exemption is only honest while a door exists somewhere, and the
     * `known` list cannot tell the difference between "reachable another way"
     * and "unreachable but excused". So the door is asserted here.
     *
     * Without this, the excuse would outlive the link: somebody tidies the W-2
     * header, the link goes, both gates stay green, and the page Michael asked
     * for becomes invisible - which is precisely what he reported in books-49,
     * "I am unable to see or use the tab system".
     */
    const oldPage = readFileSync(join(ROOT, "src/app/admin/books/form-w2/page.tsx"), "utf8");
    expect(oldPage).toMatch(/\/admin\/books\/form-w2\/sheet/);
    expect(oldPage).toMatch(/View just the form/);
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EVERY SHEET ROUTE, NOT JUST THE ONE THAT EXISTED WHEN THIS WAS WRITTEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The block above pins the W-2 sheet by name. That was right for books-58, when
 * there was one. books-60 added the 941's sheet and immediately exposed the
 * shape of the problem: a per-form gate protects the form it names and nothing
 * else, so the second sheet could have shipped with no door, no access guard and
 * no specimen fallback and every test would still have been green.
 *
 * Standing rule 23: fix the class, not the instance. So this block DISCOVERS
 * sheet routes by walking the filesystem and holds each one to the same
 * promises. A third sheet gets these guarantees by existing.
 *
 * Standing rule 43: walk the vocabulary. The discovery is asserted to have found
 * something, and to have found the routes we know about -- because a glob that
 * silently matches nothing is a gate that parses nothing (rule 39), and it would
 * pass forever.
 */
describe("form-sheet-core: every sheet route keeps the same promises", () => {
  const BOOKS = join(ROOT, "src/app/admin/books");

  /** Discovered, not listed: `<form dir>` for every `<form dir>/sheet/page.tsx`. */
  const sheetForms: string[] = readdirSync(BOOKS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => existsSync(join(BOOKS, e.name, "sheet", "page.tsx")))
    .map((e) => e.name)
    .sort();

  it("finds the sheet routes, so nothing below can pass over an empty list", () => {
    // Rule 66d / 39. If this ever returns [] the whole block becomes vacuous.
    expect(sheetForms.length).toBeGreaterThanOrEqual(2);
    // Named explicitly as well, so DELETING a sheet is a decision somebody
    // makes rather than a quiet reduction in what is being checked.
    expect(sheetForms).toContain("form-w2");
    expect(sheetForms).toContain("form-941");
  });

  for (const form of sheetForms) {
    describe(form, () => {
      const sheetPageOnly = readFileSync(join(BOOKS, form, "sheet", "page.tsx"), "utf8");
      const parentPath = join(BOOKS, form, "page.tsx");

      /*
       * ═══ THE PAGE PLUS THE COMPONENTS IT COMPOSES (books-65) ═══
       *
       * These assertions grep source text, and until books-65 they grepped ONE
       * file. That was sound while every sheet route wrote its own banners
       * inline, and it broke the moment one did the thing this codebase asks
       * for everywhere else: extract the markup into a component so a render
       * harness and the page can share it (rule 25, rule 130c).
       *
       * The WA sheet moved its header into `WaSheetHeader`. Every promise below
       * was still kept — the words are on the reader's screen — but the gate
       * went red, because the sentence had moved one file away. A gate that
       * fires on refactoring trains people to inline their markup to please it,
       * which is exactly backwards, and it is the same failure this file's own
       * comment above records about line-wrapping.
       *
       * So the corpus is now the page AND the local components it imports. Not
       * the whole tree: only `@/components/...` specifiers this file actually
       * names, resolved once. That keeps the check honest — a promise has to be
       * kept in code this route really renders — while letting the route be
       * built out of parts.
       */
      const localComponentSources: string[] = Array.from(
        sheetPageOnly.matchAll(/from "@\/(components\/[^"]+)"/g),
      )
        .map((m) => join(ROOT, "src", `${m[1]}.tsx`))
        .filter((p) => existsSync(p))
        .map((p) => readFileSync(p, "utf8"));

      /*
       * Rule 66d: prove the resolver found something before relying on it.
       * A regex that silently matched nothing would make every assertion below
       * fall back to the single-file behaviour without saying so.
       */
      it("resolves the components this route composes", () => {
        expect(
          localComponentSources.length,
          `${form}/sheet/page.tsx imports no local component this gate could resolve. Every ` +
            `sheet route renders through at least FormSheet or FormFacsimile, so zero means ` +
            `the import pattern stopped matching and the checks below silently narrowed.`,
        ).toBeGreaterThanOrEqual(1);
      });

      const sheetPage = [sheetPageOnly, ...localComponentSources].join("\n");

      it("has a parent screen to be a view OF", () => {
        // A sheet with no parent is not an alternative view of anything, and
        // the nav-gate exemption ("reached from the parent's header") would be
        // an excuse with nothing behind it.
        expect(existsSync(parentPath), `${form} has a sheet but no page.tsx`).toBe(true);
      });

      it("guards access like every other books page", () => {
        /*
         * ═══ THIS ASSERTION USED TO BE `toMatch(/requireBooksAccess/)` ═══
         *
         * A mutation run in books-60 deleted the `await requireBooksAccess();`
         * CALL from the body of this very page and the suite stayed green,
         * because the import statement at the top of the file still matched the
         * pattern. The test was passing on the strength of an import while the
         * page it was protecting had no guard at all.
         *
         * That is the same class as the escape recorded in books-59, where a
         * refusal test passed because a different guard's message happened to
         * contain the word it was grepping for: a test that matches TEXT rather
         * than BEHAVIOUR eventually matches the wrong text.
         *
         * `extractPageGuard` already exists for precisely this, strips comments
         * first, and requires a call shape -- `requireBooksAccess(` -- not a
         * mention. Rule 23: fix the class. So this uses it, and so does the
         * W-2's own assertion above.
         */
        expect(extractPageGuard(sheetPage)).toEqual({ kind: "books-access" });
      });

      it("renders through the shared FormSheet rather than its own markup", () => {
        expect(sheetPage).toMatch(/FormSheet/);
        expect(sheetPage).toMatch(/@\/components\/admin\/books\/FormSheet/);
      });

      it("falls back to the teaching specimen so it is not blank for a year", () => {
        // books-49, in his words: "I am unable to see or use the tab system."
        // The cause was a teaching surface gated on data that will not exist
        // until 2027.
        expect(sheetPage).toMatch(/teachingBoxes\(/);
      });

      it("does NOT fall back to the specimen when the read failed", () => {
        // The distinction that matters: "no payroll yet" is honest, "the
        // database broke" must never be dressed up as a specimen, because the
        // specimen's figures are not his.
        expect(sheetPage).toMatch(/readFailed/);
      });

      it("says which of the two a reader is looking at", () => {
        // A reader who cannot tell a blank specimen from his own computed
        // return is one step from typing invented figures into a government
        // portal.
        //
        // ═══ WHITESPACE-NORMALISED IN books-61, AND WHY ═══
        //
        // This read the raw file, so the phrase had to survive on ONE SOURCE
        // LINE. It went red in books-61 when the 941 route's prose was
        // re-wrapped by an unrelated edit - the sentence "every figure reads
        // 'not computed yet'" was still there, still rendered, and still true,
        // but now split across two lines by the formatter.
        //
        // A gate that fires on line-wrapping is a gate that trains people to
        // reflow their code to please it, which is exactly backwards. JSX text
        // collapses whitespace when rendered, so the test now asks the question
        // the READER experiences rather than the question the file happens to
        // be formatted as.
        const rendered = sheetPage.replace(/\s+/g, " ");
        expect(rendered).toMatch(/not computed yet/);
      });

      it("is reachable: the parent screen carries a door to it", () => {
        // THE GATE THAT EXISTS BECAUSE ANOTHER GATE CAUGHT ME. See the W-2
        // block above -- this is the same assertion, made for every form
        // instead of for one.
        const parent = readFileSync(parentPath, "utf8");
        expect(
          parent,
          `${form}/page.tsx has no link to ${form}/sheet. The sheet is exempt from the ` +
            `menu in nav-gate-core's known list, and that exemption is only honest while ` +
            `a door exists somewhere.`,
        ).toMatch(new RegExp(`/admin/books/${form}/sheet`));
        expect(parent).toMatch(/View just the form/);
      });

      it("carries a link back, so the sheet is not a dead end", () => {
        expect(sheetPage).toMatch(new RegExp(`/admin/books/${form}\\b`));
      });

      it("leaves the parent screen's explorer alone", () => {
        // "Rather than updating or changing any of it." Proved by absence: the
        // parent must not import the sheet renderer.
        const parent = readFileSync(parentPath, "utf8");
        expect(parent).not.toMatch(/FormSheet/);
      });
    });
  }
});

/**
 * ============================================================================
 * A SHEET RENDERS BOTH AFFORDANCES  (books-60, rewritten in books-65)
 * ============================================================================
 * books-58 shipped the untaught marker and admitted in the owner report that
 * it could not be proved on the only form that had a sheet, because the W-2
 * has zero untaught boxes. books-60 closed that on the 941, which then had
 * seven.
 *
 * books-65 closed the 941 too - all 23 remaining untaught boxes across the 941
 * and the 940 were written, because Michael asked that every box open with an
 * explanation the way Schedule B already does. So the old form of this block,
 * which required the 941 to still have an untaught box, can no longer pass.
 *
 * What survives, and is worth keeping separate from the sweep above, is the
 * lesson SET this block uses. Everything above pools every lesson in the
 * product into ALL_LESSONS and leans on lessonFor matching formId as well as
 * box. Here the 941's sheet is built from FORM_941_LESSONS alone - the exact
 * import the real page makes. That distinguishes "the 941 is covered" from
 * "the 941 is covered by lessons that happen to live in some other form's
 * module", which the pooled version cannot tell apart.
 */
describe("books-60/65: the 941 sheet, built from the module the page imports", () => {
  it("teaches every box on the 941 using only the 941's own lesson module", () => {
    const groups = sheetGroups(teachingBoxes("form_941"), FORM_941_LESSONS);
    const cells = groups.flatMap((g) => g.cells);
    const teachable = cells.filter((c) => c.affordance === "teachable");
    const untaught = cells.filter((c) => c.affordance === "untaught");

    expect(teachable.length).toBeGreaterThan(0);
    expect(
      untaught.map((c) => c.box.box),
      "a 941 box is untaught when the sheet is built from FORM_941_LESSONS alone. " +
        "If it is taught in the pooled ALL_LESSONS run above but not here, its lesson " +
        "was written into the wrong module and the real page will not show it.",
    ).toEqual([]);

    // The two sets are disjoint and exhaustive: every cell is one or the
    // other. A third state would render as neither and be invisible.
    expect(teachable.length + untaught.length).toBe(cells.length);
  });

  it("agrees with the pooled run, proving no lesson is filed under the wrong form", () => {
    // Same sheet, two lesson sets. If these ever disagree, a 941 lesson is
    // carrying the wrong formId, or another form's module is answering for it.
    const own = sheetCoverage(sheetGroups(teachingBoxes("form_941"), FORM_941_LESSONS));
    const pooled = sheetCoverage(sheetGroups(teachingBoxes("form_941"), ALL_LESSONS));
    expect(own.total).toBe(pooled.total);
    expect(own.teachable).toBe(pooled.teachable);
    expect(own.untaughtBoxes).toEqual(pooled.untaughtBoxes);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * books-67 — THE CLASS GATE: NO FORM SURFACE MAY VANISH ON AN EMPTY QUARTER
 *
 * This defect has now occurred TWICE, on two different routes, two years apart:
 *
 *   books-49  the W-2 teaching surface was hidden behind `result.ok` and was
 *             invisible for a year before anyone noticed.
 *   books-67  the EAMS confirmation route, shipped in books-66, refused to draw
 *             anything at all when a quarter had no payroll — and the same
 *             `result.ok` wrapper hid BOTH upload download links on the
 *             Washington screen, which is how Michael came to hover the one
 *             button on the page that is deliberately disabled.
 *
 * Standing rule 23 says fix the class. The instance fixes are in those slices;
 * this is the gate that makes a third occurrence fail out loud.
 *
 * WHAT THIS DOES NOT ASSERT, deliberately. It does not forbid `result.ok` — the
 * flag is legitimate and load-bearing for figures. It asserts the two specific
 * things whose absence caused real harm: that a route which can draw a blank
 * form actually distinguishes an empty quarter from a fault, and that the
 * download links are not conditional on figures existing.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-67: an empty quarter draws the form, and the downloads never hide", () => {
  const CONFIRMATION = join(ROOT, "src/app/admin/books/wa-quarterly/confirmation/page.tsx");
  const WA_SCREEN = join(ROOT, "src/app/admin/books/wa-quarterly/page.tsx");

  it("the confirmation route separates an EMPTY quarter from a REFUSAL", () => {
    // Assert existence before absence (rule 66c) — a deleted file must not pass.
    expect(existsSync(CONFIRMATION)).toBe(true);
    const src = readFileSync(CONFIRMATION, "utf8");

    /*
     * NO_SUBJECTS is "there is nothing here" — a fact about the quarter, safe to
     * draw blank. Every other refusal is "something here is wrong and I will not
     * guess", which must still refuse, or a negative-wage row would hide behind
     * a page that merely looks empty.
     */
    expect(src).toMatch(/NO_SUBJECTS/);
    expect(src).toMatch(/onlyRefusalIsEmptiness/);

    // The two states that MUST still refuse are still refusing.
    expect(src).toMatch(/ratesMissing|resolved\.ok/);
    expect(src).toMatch(/loaded\.ok/);

    // And the builder is handed null rather than a fabricated zeroed return.
    expect(src).toMatch(/loaded\.result\.ok \? loaded\.result\.value : null/);
  });

  it("the Washington screen's download links are NOT behind `result.ok`", () => {
    expect(existsSync(WA_SCREEN)).toBe(true);
    const src = readFileSync(WA_SCREEN, "utf8");

    const eamsAt = src.indexOf("Download the EAMS wage file");
    const pfmlAt = src.indexOf("Download the Paid Leave");
    expect(eamsAt, "the EAMS download link must exist").toBeGreaterThan(-1);
    expect(pfmlAt, "the Paid Leave download link must exist").toBeGreaterThan(-1);

    /*
     * The heart of it. Walk back from each link to the nearest enclosing
     * conditional and require that it is not the figures gate. `result.ok ? (`
     * immediately before a Card is exactly the shape that hid these for a slice.
     */
    const cardOpensAt = src.lastIndexOf("<Card>", eamsAt);
    expect(cardOpensAt).toBeGreaterThan(-1);
    const preamble = src.slice(Math.max(0, cardOpensAt - 400), cardOpensAt);
    expect(
      /\{result\.ok \? \(\s*$/.test(preamble),
      "the download card is wrapped in `result.ok` again — on an empty quarter " +
        "both links vanish and the only button left on the page is the disabled one",
    ).toBe(false);
  });

  it("the download links say plainly that they are the download", () => {
    /*
     * Michael's words: "the button is not very clear it is the button to use to
     * export the files ... have text that tells me this is where you download
     * the report." A link he cannot identify is a link that does not work.
     */
    const src = readFileSync(WA_SCREEN, "utf8");
    expect(src).toMatch(/This is the file you upload to EAMS/);
    expect(src).toMatch(/This is the file you upload to the Paid Leave portal/);
    // Real download affordance, not bare underlined text.
    expect(src).toMatch(/download\s*$/m);
  });
});
