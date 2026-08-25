/**
 * tests/compliance/form-box-teaching-core.test.ts   (books-49)
 *
 * ═══ THE FORMS TEACH BEFORE THERE IS ANYTHING TO TEACH THEM WITH ═══
 *
 * Michael, verbatim: "I am unable to see or use the tab system we built to let
 * me see the various forms and be able to click them for learning about them.
 * The form pages are still just walls of text."
 *
 * The diagnosis, established by RUNNING the engines rather than reading them:
 * every teaching surface was nested inside `{result.ok ? ... : null}`, and
 * `result.ok` is false until real pay runs exist. Greenway's first payroll is
 * 1 January 2027. The feature was built, tested, green, and unreachable.
 *
 * This file gates the module written to fix that: a STATIC specimen of every
 * form, so the boxes can be taught with no payroll data at all, with every
 * figure honestly marked "not computed yet" rather than shown as $0.00.
 *
 * ─── WHY THE MOST IMPORTANT TEST HERE BUILDS A REAL RETURN ────────────────
 *
 * Because the first draft of the specimen was checked only against itself, and
 * a file checked against itself agrees with itself. It had drifted from the
 * engine within hours of being written: `lni-hours` classified `not_money`
 * where the engine says `shared`, and the two bottom-line boxes of the
 * Washington returns (`esd-total`, `lni-premium`) missing altogether. Every
 * test was green throughout.
 *
 * So `assertSpecimenMatchesTheEngine` builds a genuine quarter and compares
 * box ids, captions, classifications and units. Its figures are never read -
 * only the shape - so nothing fabricated can leak onto a screen.
 */
import { describe, it, expect } from "vitest";
import {
  TEACHING_FORMS,
  teachingBoxes,
  NOT_COMPUTED_REASON,
  assertSpecimenMatchesTheEngine,
  assertEveryWaFormIsTeachable,
  assertEveryFederalBoxIsClassified,
  assertNoSpecimenClaimsAFigure,
  assertEveryTieResolves,
  assertEveryTaughtBoxHasASpecimen,
  __runFormBoxTeachingCoreTests,
} from "@/lib/payroll/form-box-teaching-core";
import { formatBoxValue, boxIsEmpty, boxTone } from "@/lib/payroll/form-box-core";
import type { BoxLesson } from "@/lib/payroll/form-box-core";
import { FORM_940_LESSONS } from "@/lib/payroll/form-box-lessons-940";
import { FORM_941_LESSONS } from "@/lib/payroll/form-box-lessons-941";
import { FORM_W2_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-w2";
import { WA_QUARTERLY_LESSONS } from "@/lib/payroll/form-box-lessons-wa";

describe("the teaching specimen agrees with the engine", () => {
  it("runs every pure self-test in the module", () => {
    expect(() => __runFormBoxTeachingCoreTests()).not.toThrow();
  });

  it("matches a really-built Washington quarter box for box", () => {
    expect(() => assertSpecimenMatchesTheEngine()).not.toThrow();
  });

  it("can teach every Washington form the screen offers a tab for", () => {
    expect(() => assertEveryWaFormIsTeachable()).not.toThrow();
  });

  it("resolves every federal box through the adapters' single table", () => {
    expect(() => assertEveryFederalBoxIsClassified()).not.toThrow();
  });
});

/**
 * ═══ EVERY CROSS-REFERENCE GOES SOMEWHERE REAL (books-54) ═══
 *
 * A lesson's `tiesTo` says "this box relates to that box on that other form".
 * Until this slice, nothing checked that the other box existed, and rendered
 * prose does not execute — so a tie could point anywhere for years and every
 * test in the repository would stay green.
 *
 * MEASURED BEFORE THE GATE WAS WRITTEN: 56 ties across the four lesson sets,
 * of which two were dead. Both lived in `form-box-lessons-wa.ts` and both
 * pointed at `esd_5208b` box "wage-detail" — a box that has never existed. The
 * 5208B has `wage-detail-wages`, `wage-detail-hours` and `wage-detail-total`.
 * They arrived with books-47 slice D and survived every commit since.
 *
 * The two ties carried IDENTICAL target text but needed DIFFERENT fixes: one
 * is about wages reconciling and one about hours, so a search-and-replace
 * would have repointed both at whichever column was typed first and the gate
 * would have gone green on a half-wrong answer.
 *
 * All four sets are checked here rather than one, because this is where the
 * specimen tables live and the fourth set is the one that was broken.
 */
describe("every cross-reference between forms goes somewhere real", () => {
  /**
   * RULE 15 FIRST: the gate must be shown capable of failing before any
   * passing assertion below it means anything.
   *
   * Three separate ways a tie can be wrong, and a fourth case — a lesson set
   * with no ties at all — which must ALSO be refused, because a checker that
   * examined nothing is a checker that approves everything (rule 66d).
   */
  it("refuses a tie to a form that does not exist, a box that does not exist, and an empty set", () => {
    const base: BoxLesson = {
      formId: "form_940",
      box: "3",
      headline: "h",
      plainEnglish: "p",
      whereItComesFrom: "w",
      howToReadIt: "r",
      commonMistake: null,
      whatToDo: "d",
      examples: [],
      quotes: [],
      tiesTo: [],
    };

    // 1. a form id nothing teaches
    expect(() =>
      assertEveryTieResolves([
        { ...base, tiesTo: [{ formId: "form_1120s", box: "1", why: "y" }] },
      ]),
    ).toThrow(/has no teaching specimen/);

    // 2. a real form, a box it does not have
    expect(() =>
      assertEveryTieResolves([
        { ...base, tiesTo: [{ formId: "esd_5208b", box: "wage-detail", why: "y" }] },
      ]),
    ).toThrow(/does not\s+have/);

    // 3. the exact historical defect, named, so the fix cannot silently revert
    expect(() =>
      assertEveryTieResolves([
        { ...base, tiesTo: [{ formId: "esd_5208b", box: "wage-detail", why: "y" }] },
      ]),
    ).toThrow(/wage-detail-wages/);

    // 4. nothing to check is not a pass
    expect(() => assertEveryTieResolves([base])).toThrow(/proves nothing/);
    expect(() => assertEveryTieResolves([])).toThrow(/proves nothing/);

    // And a tie that IS right must be accepted, or the gate refuses everything
    // and its passing above would be meaningless.
    expect(() =>
      assertEveryTieResolves([
        { ...base, tiesTo: [{ formId: "esd_5208b", box: "wage-detail-wages", why: "y" }] },
      ]),
    ).not.toThrow();
  });

  it("resolves every tie in all four lesson sets", () => {
    /*
     * Held as data with the set NAME attached, so a failure says which file to
     * open. Iterating anonymous arrays would report "expected not to throw"
     * and leave the reader to find which of four modules was at fault.
     */
    const SETS: readonly { readonly name: string; readonly lessons: readonly BoxLesson[] }[] = [
      { name: "form-box-lessons-940.ts", lessons: FORM_940_LESSONS },
      { name: "form-box-lessons-941.ts", lessons: FORM_941_LESSONS },
      { name: "form-box-lessons-w2.ts", lessons: FORM_W2_BOX_LESSONS },
      { name: "form-box-lessons-wa.ts", lessons: WA_QUARTERLY_LESSONS },
    ];

    let ties = 0;
    for (const s of SETS) {
      expect(() => assertEveryTieResolves(s.lessons), `dead tie in ${s.name}`).not.toThrow();
      ties += s.lessons.reduce((n, l) => n + l.tiesTo.length, 0);
    }

    /*
     * A floor on the total, so this cannot pass by the lesson modules being
     * emptied. 56 is the measured count at books-54; it may only grow.
     */
    expect(ties, "far fewer ties than expected; a lesson module lost its content").toBeGreaterThanOrEqual(56);
  });

  /**
   * The companion check, applied to all four sets rather than the one.
   *
   * `assertEveryTaughtBoxHasASpecimen` has existed since books-49 but was
   * called for the W-2 lessons ONLY. It passes for all four — measured, not
   * assumed — so the other three were correct by luck rather than by gate.
   */
  it("gives every taught box a specimen, in all four lesson sets", () => {
    for (const lessons of [
      FORM_940_LESSONS,
      FORM_941_LESSONS,
      FORM_W2_BOX_LESSONS,
      WA_QUARTERLY_LESSONS,
    ]) {
      expect(() => assertEveryTaughtBoxHasASpecimen(lessons)).not.toThrow();
    }

    // Rule 15: and it must still refuse a box that has no specimen.
    expect(() =>
      assertEveryTaughtBoxHasASpecimen([
        {
          formId: "form_940",
          box: "99",
          headline: "h",
          plainEnglish: "p",
          whereItComesFrom: "w",
          howToReadIt: "r",
          commonMistake: null,
          whatToDo: "d",
          examples: [],
          quotes: [],
          tiesTo: [],
        },
      ]),
    ).toThrow(/not in the teaching specimen/);
  });
});

describe("no specimen box ever claims a figure", () => {
  it("marks every box not-computed and carries no amount or quantity", () => {
    expect(() => assertNoSpecimenClaimsAFigure()).not.toThrow();
  });

  /**
   * THE ONE RULE THIS WHOLE MODULE EXISTS TO ENFORCE.
   *
   * A zero is a CLAIM. "$0.00" in a wage box says Greenway paid somebody
   * nothing; "0 hours" on an L&I return is a reportable-hours figure the state
   * acts on. Neither is true - the truth is that nobody has counted yet. So
   * the rendered value must contain no digits at all.
   */
  it("renders no digit anywhere in an uncomputed figure", () => {
    let checked = 0;
    for (const formId of Object.keys(TEACHING_FORMS)) {
      for (const b of teachingBoxes(formId)) {
        const shown = formatBoxValue(b);
        expect(shown, `${formId} box ${b.box} printed a number: "${shown}"`).not.toMatch(/[0-9]/);
        checked += 1;
      }
    }
    // Rule 39 / 66d: prove the loop had something to inspect.
    expect(checked).toBeGreaterThanOrEqual(45);
    console.log(`form-box-teaching-core: ${checked} specimen boxes render no fabricated figure`);
  });

  /**
   * AN UNKNOWN FIGURE IS NOT AN EMPTY ONE, AND NOT A DELIBERATE BLANK.
   *
   * `boxIsEmpty` returning true for a not-computed box would make
   * `correctlyBlank` reachable, which greys the box out and tells Michael the
   * form WANTS it left blank. That is a statement about the law. This is a
   * statement about our data. Rule 87 - the two must not be blurred.
   */
  it("treats an uncomputed box as unknown rather than as empty or blank", () => {
    for (const formId of Object.keys(TEACHING_FORMS)) {
      for (const b of teachingBoxes(formId)) {
        expect(boxIsEmpty(b), `${formId} box ${b.box} reads as empty`).toBe(false);
        expect(b.blankOnPurpose, `${formId} box ${b.box} claims a legal blank`).toBeNull();
        // Neutral makes no claim about whose money it is, which is the only
        // claim we are entitled to make about a figure nobody has computed.
        expect(boxTone(b)).toBe("neutral");
      }
    }
  });

  it("explains itself in Michael's terms, not in a code", () => {
    expect(NOT_COMPUTED_REASON).toContain("not a");
    expect(NOT_COMPUTED_REASON.toLowerCase()).toContain("zero");
    expect(NOT_COMPUTED_REASON.length).toBeGreaterThan(120);
    for (const formId of Object.keys(TEACHING_FORMS)) {
      for (const b of teachingBoxes(formId)) {
        expect(b.notComputedYet).toBe(NOT_COMPUTED_REASON);
      }
    }
  });
});

describe("every form Michael can open has a tab", () => {
  /**
   * Michael, verbatim: "There should be a visual form for every single form in
   * its own tab." Pinned as a list so a form cannot be dropped silently.
   */
  it("covers all seven forms, including the 5208B that has no boxes", () => {
    expect(Object.keys(TEACHING_FORMS).sort()).toEqual([
      "esd_5208a",
      "esd_5208b",
      "form_940",
      "form_941",
      "form_w2",
      "lni_quarterly",
      "pfml_wa_cares",
    ]);
  });

  it("teaches the 5208B by its columns, because it is made of people", () => {
    const boxes = teachingBoxes("esd_5208b");
    expect(boxes.length).toBeGreaterThanOrEqual(3);
    const text = boxes.map((b) => `${b.caption} ${b.derivation}`).join(" ").toLowerCase();
    // The two facts that make this form dangerous to omit: hours are required
    // even though no tax is charged here, and it must agree with the 5208A.
    expect(text).toContain("hours");
    expect(text).toContain("5208a");
  });

  it("gives every form at least one box, so no tab is an empty screen", () => {
    for (const formId of Object.keys(TEACHING_FORMS)) {
      expect(teachingBoxes(formId).length, `${formId} teaches nothing`).toBeGreaterThan(0);
    }
  });
});

describe("the module refuses rather than guessing", () => {
  /**
   * Rule 48: throw rather than return a value that reads as success. An empty
   * array here renders as a form with no boxes, which looks exactly like a
   * working screen that happens to have nothing on it - the precise failure
   * mode this slice exists to remove.
   */
  it("throws on an unknown form id instead of returning nothing", () => {
    expect(() => teachingBoxes("form_does_not_exist")).toThrow(/no teaching specimen/);
  });

  it("names the offending form in the message, so the fix is obvious", () => {
    try {
      teachingBoxes("esd_9999");
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("esd_9999");
      expect(msg).toContain("TEACHING_FORMS");
    }
  });

  it("never formats hours or counts as dollars", () => {
    // The unit is derived from the classification, not from a hand-written
    // special case naming a box id - the first draft did the latter and the
    // condition it wrote could never fire.
    const hours = teachingBoxes("lni_quarterly").find((b) => b.box === "lni-hours");
    expect(hours).toBeDefined();
    expect(hours!.measure).toBe("hours");
    const count = teachingBoxes("form_941").find((b) => b.box === "1");
    expect(count).toBeDefined();
    expect(count!.measure).toBe("count");
    // And neither renders a currency symbol.
    expect(formatBoxValue(hours!)).not.toContain("$");
    expect(formatBoxValue(count!)).not.toContain("$");
  });
});
