/**
 * src/lib/payroll/form-sheet-core.ts   (books-58)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE PAGE, NOTHING ON IT BUT THE FORM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael, in as many words:
 *
 *   "Right now, even with the tab system, there is walls of text and
 *    information. I like it how it is and rather than updating or changing any
 *    of it, I want to simply ADD a way to display the form in one large page
 *    with nothing on it but form. And every box/field that has already been
 *    mapped to its learning lesson, when clicked, should show an info box with
 *    all of the lesson displayed. I don't want to be redirected to the learning
 *    center, but have the lesson brought to me on the form page."
 *
 * Two instructions there, and the second one constrains this file more than the
 * first: NOTHING EXISTING CHANGES. `FormBoxExplorer` and its tabs are not
 * touched, not refactored, not "improved while I'm in here". This module is a
 * sibling that reuses the same vocabulary.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY A CORE MODULE AND NOT JUST A COMPONENT
 * ───────────────────────────────────────────────────────────────────────────
 * Because the interesting decisions are not visual. "Which boxes belong on the
 * same row of the paper?", "is this box clickable?", "what does a reader see
 * when nothing is taught yet?" are all answerable, and therefore testable,
 * without rendering anything. A React component cannot be mutation-tested
 * cheaply; a pure function can. The component that follows is deliberately
 * thin, so that almost everything it does is decided here.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE MEASUREMENT THAT CHANGED THE DESIGN
 * ───────────────────────────────────────────────────────────────────────────
 * Michael asked for untaught boxes to be "visually marked as not taught yet",
 * and asked for the W-2 first. Measured before designing:
 *
 *     form_w2   26 boxes, 26 taught, 0 untaught
 *     form_w3   31 boxes, 31 taught, 0 untaught
 *     form_941  27 boxes, 20 taught, 7 untaught  (5e, 6, 7, 10, 12, 13, 14)
 *     form_940  30 boxes, 20 taught, 10 untaught (4, 6, 11, 13, ... 16d)
 *
 * So on the W-2 - the form he chose - the not-taught marker is UNREACHABLE. A
 * marker no box can ever be in is exactly what standing rule 40 forbids: an
 * unreachable guard is an untested guard, and the honest options are to delete
 * it or to make it reachable. Deleting it is not an option, he asked for it and
 * it is right. So this module is FORM-AGNOSTIC from the first line, and its
 * gates prove the marker against the 941, where seventeen real boxes need it.
 *
 * That is also why `sheetRows` takes boxes and lessons rather than a form id
 * and a switch: a form id would invite exactly one form's assumptions to leak
 * in, and the 941 would then be a port rather than a second caller.
 */
import type { BoxLesson, FormBox } from "./form-box-core";
import { formatBoxValue, lessonFor } from "./form-box-core";
import type { RenderableBox } from "./form-box-ui-core";
import { renderableBoxes } from "./form-box-ui-core";

/* ═════════════════════════════════════════════════════════════════════════
 * §1  WHAT A READER MAY DO WITH A BOX
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * The three states a box on the sheet can be in, named for what the READER can
 * do rather than for what the data contains.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY "UNTAUGHT" IS A FIRST-CLASS STATE AND NOT A FALSY `hasLesson`
 * ───────────────────────────────────────────────────────────────────────────
 * `RenderableBox` already carries `hasLesson`, and the first draft of this file
 * simply asked `if (r.hasLesson)`. That is enough to decide whether to attach a
 * click handler and NOT enough to decide what to SHOW, which is the whole of
 * Michael's second request. A box with no lesson that renders identically to a
 * box with one is a dead control: the reader clicks, nothing happens, and the
 * only available conclusion is that the app is broken.
 *
 * His words on being asked: "visually marked as not taught yet is great and
 * makes sense to me." So the absence of a lesson is information to be PRINTED,
 * not a branch to be skipped. Naming the state forces every renderer to handle
 * it, because a `switch` on a union fails to compile when a case is missing,
 * whereas `!hasLesson` can be silently ignored.
 */
export type BoxAffordance =
  /** A lesson exists. Clicking opens it in place. */
  | "teachable"
  /** No lesson yet. Marked as such, and deliberately not clickable. */
  | "untaught";

export const ALL_BOX_AFFORDANCES: readonly BoxAffordance[] = ["teachable", "untaught"];

/*
 * ══════════════════════════════════════════════════════════════════════════
 * WHY "UNUSED" IS NOT A THIRD AFFORDANCE  (a defect caught before shipping)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The first version of this file had a third affordance, `"unused"`, for boxes
 * the form itself does not use - W-2 box 9, whose printed caption really is
 * "(not used)". `affordanceOf` tested it FIRST, with a confident comment
 * explaining that an unused box also has no lesson and would otherwise look
 * like a coverage gap nobody should close.
 *
 * That comment was wrong, and running the thing over the real forms is what
 * said so. W-2 box 9 HAS a lesson. It is called "The box that must stay empty",
 * and it explains that box 9 once carried an advance Earned Income Credit
 * payment, that the programme ended, that the box was left on the form, and
 * that the entire IRS instruction for it is "do not enter an amount in box 9".
 *
 * So the three-state union would have taken a box that IS taught and rendered
 * it unclickable - hiding a finished lesson behind a state invented to describe
 * missing ones. And it would have hidden it on exactly the sort of box this
 * whole product exists for: one where the correct entry is nothing, and where a
 * preparer's instinct to be helpful produces a filing error.
 *
 * The mistake was modelling two INDEPENDENT facts as one value:
 *
 *     does the form use this box?      -> a fact about THE FORM
 *     has anyone written the lesson?   -> a fact about THIS PRODUCT
 *
 * A box can be any combination of the two, and W-2 box 9 is the combination the
 * union could not express: not used, and taught. They are therefore carried
 * separately - `affordance` decides what the reader may DO, `unusedByForm`
 * describes what the FORM says - and neither one can silently overrule the
 * other. Rule 23: fix the class, not the instance. The class here is "two
 * orthogonal facts flattened into one enum", and flattening it again would
 * reintroduce the bug under a new name.
 */

/**
 * A box the form prints but does not use.
 *
 * This is NOT a statement about our teaching coverage. It is a fact about the
 * paper: it greys the box, keeps it out of the coverage denominator, and has no
 * say whatsoever in whether the box is clickable.
 *
 * Decided from the CAPTION - the form's own printed words - rather than from a
 * hand-kept list of box numbers, for the same reason as the identifier-box gate
 * in books-56: a list of numbers must be maintained by whoever adds the next
 * form and is silently wrong until somebody notices, whereas the caption
 * travels with the box.
 *
 * Deliberately narrow: only the exact parenthesised form the specimens actually
 * print is matched, so a real caption that merely contains the words "not used"
 * is not swallowed.
 */
const UNUSED_CAPTION_RE = /^\(\s*not used\s*\)$/i;

export function isUnusedBox(box: FormBox): boolean {
  return UNUSED_CAPTION_RE.test(box.caption.trim());
}

/**
 * What may the reader do with this box?
 *
 * Exactly one question: is there a lesson to show? Deliberately NOT "unless the
 * box is unused" - see the long note above. A taught box is clickable whether or
 * not the form uses it, because the lesson on an unused box is often the most
 * valuable one on the sheet ("do not enter an amount in box 9").
 */
export function affordanceOf(rendered: RenderableBox): BoxAffordance {
  return rendered.hasLesson ? "teachable" : "untaught";
}

/* ═════════════════════════════════════════════════════════════════════════
 * §2  THE SHEET
 * ═════════════════════════════════════════════════════════════════════════ */

/** One box, ready to be drawn on the sheet. */
export type SheetCell = {
  readonly box: FormBox;
  /** What the READER may do: open a lesson, or be told none exists yet. */
  readonly affordance: BoxAffordance;
  /**
   * What the FORM says: this box is printed but not used (W-2 box 9).
   *
   * Independent of `affordance` on purpose. An unused box is greyed and kept out
   * of the coverage denominator, and is STILL clickable when it has a lesson.
   */
  readonly unusedByForm: boolean;
  /** The value as it must be printed. Never a bare 0 for an unknown figure. */
  readonly printed: string;
  /**
   * The lesson, when there is one. `undefined` - not null - to match what
   * `lessonFor` returns, so a caller comparing against the wrong sentinel is a
   * type error rather than a silent always-true.
   */
  readonly lesson: BoxLesson | undefined;
  /** True when the box is empty and that is CORRECT, with the reason to show. */
  readonly correctlyBlank: boolean;
  /** True when the figure is simply unknown. Never rendered as a number. */
  readonly notComputed: boolean;
};

/**
 * One row of the paper form.
 *
 * The W-2's lettered boxes (a-f) are the employer/employee identification
 * block; the numbered boxes are the money grid. Grouping is by the box's own
 * character rather than by a per-form layout table, for the reason given at the
 * top of this file: a layout table is a second place to forget a form.
 */
export type SheetGroup = {
  readonly key: string;
  /** A heading a reader can navigate by. Not the form's words - ours. */
  readonly heading: string;
  readonly cells: readonly SheetCell[];
};

/*
 * ══════════════════════════════════════════════════════════════════════════
 * HOW THE SHEET IS SPLIT, AND THE SECOND DEFECT THAT SET THE RULE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The first draft split on /^[a-z]$/ - "a single letter is identification,
 * everything else is a numbered box" - and headed the second group "The
 * numbered boxes". Run over the real forms, that produced two lies.
 *
 *   1. The W-3 does not have a plain box "b". It has three:
 *          b-kind-of-payer   b-kind-of-employer   b-third-party-sick-pay
 *      plus a "contact" block at the foot of the form. None is a single letter,
 *      so all four were filed under "The numbered boxes" - four fields with no
 *      number, under a heading promising numbers.
 *
 *   2. The four Washington forms have NO numbered boxes whatsoever. Their ids
 *      are lni-hours, esd-ui, pfml-employee, wage-detail-total and so on. Every
 *      box on every one of them would have sat under "The numbered boxes".
 *
 * Half the forms in the product, mis-headed, on a page whose entire purpose is
 * to be trustworthy enough to copy onto a government portal.
 *
 * The rule that replaces it: split on the only property that is decidable for
 * every form without a per-form table - DOES THE BOX ID BEGIN WITH A DIGIT -
 * and give each group a heading that is literally true wherever it appears. A
 * group with no members is not emitted, so a form with no numbered boxes simply
 * has one section, and a form with no lettered boxes likewise.
 *
 * The headings are deliberately descriptive rather than interpretive. "Who this
 * form is about" was the old heading for the lettered group; it is right for the
 * W-2 and wrong for the W-3's contact block and for lni-hours. A heading that
 * has to be correct for forms not yet written cannot claim to know what the
 * fields MEAN - only where they sit. Rule 43: derive it, do not hand-list it,
 * because a hand-kept heading table is a second place to forget the next form.
 */
const NUMBERED_BOX = /^[0-9]/;

/**
 * Group the boxes of ONE form into the rows a reader sees.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS REFUSES A MIXED-FORM ARRAY
 * ───────────────────────────────────────────────────────────────────────────
 * Every box carries its own `formId`. Handing this function boxes from two
 * forms would produce a sheet that looks like a single form and is not - the
 * most dangerous possible output for a page whose purpose is to be reproduced
 * onto a government portal. It cannot be prevented by types (both are
 * `FormBox`), so it is refused at runtime, loudly. Standing rule 48: a function
 * that cannot classify its input says so rather than guessing.
 */
export function sheetGroups(
  boxes: readonly FormBox[],
  lessons: readonly BoxLesson[],
): readonly SheetGroup[] {
  if (boxes.length === 0) {
    throw new Error(
      "sheetGroups: no boxes. A form page with no boxes would render as an " +
        "empty sheet, which reads as 'this form has nothing on it' rather than " +
        "as 'this form failed to load'.",
    );
  }
  const ids = new Set(boxes.map((b) => b.formId));
  if (ids.size > 1) {
    throw new Error(
      `sheetGroups: boxes from more than one form (${[...ids].sort().join(", ")}). ` +
        `A sheet must show exactly one form, or the reader copies figures from a ` +
        `page that does not correspond to any paper document.`,
    );
  }

  const rendered = renderableBoxes(boxes, lessons);
  const cells: readonly SheetCell[] = rendered.map((r) => ({
    box: r.box,
    affordance: affordanceOf(r),
    unusedByForm: isUnusedBox(r.box),
    printed: formatBoxValue(r.box),
    lesson: lessonFor(lessons, r.box.formId, r.box.box),
    correctlyBlank: r.correctlyBlank,
    notComputed: r.box.notComputedYet !== null,
  }));

  const numbered = cells.filter((c) => NUMBERED_BOX.test(c.box.box));
  const named = cells.filter((c) => !NUMBERED_BOX.test(c.box.box));

  /*
   * Named fields print FIRST, because that is where they sit on every specimen
   * we hold: the W-2's a-f run across the top, the W-3's a-h and its kind-of-
   * payer checkboxes likewise, and the Washington forms are named throughout.
   * An empty group is never emitted - a heading with nothing under it reads as
   * a section that failed to load.
   */
  const groups: SheetGroup[] = [];
  if (named.length > 0) {
    groups.push({
      key: "named",
      heading: "Boxes the form labels by name or letter",
      cells: named,
    });
  }
  if (numbered.length > 0) {
    groups.push({
      key: "numbered",
      heading: "Boxes the form labels by number",
      cells: numbered,
    });
  }

  // Every box must appear exactly once. Asserted rather than trusted, because a
  // regex that stopped matching would silently DROP boxes from the sheet, and a
  // form missing a box is worse than a form that fails to load.
  const placed = groups.reduce((n, g) => n + g.cells.length, 0);
  if (placed !== cells.length) {
    throw new Error(
      `sheetGroups: ${cells.length} boxes in, ${placed} placed. Some box matched ` +
        `neither the identification nor the figures group, so the sheet would be ` +
        `missing a line the paper form prints.`,
    );
  }
  return groups;
}

/**
 * How much of this form is taught, as numbers a gate can hold.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT "UNTAUGHT" COUNTS, AND WHY UNUSED BOXES ARE EXCLUDED
 * ────────────────────────────────────────────────────────────────────────────
 * `untaught` is the list of boxes a reader would click and get nothing from, so
 * it is the product's real to-do list. Boxes the form does not use are excluded
 * from it, because "write a lesson for W-2 box 9" is not work anybody should
 * ever do - the box is retired and the IRS instruction is one sentence long. If
 * they were counted, this form could never reach full coverage, and a number
 * that can never be reached is a number nobody reads.
 *
 * But an unused box that IS taught still counts as taught. W-2 box 9 has a
 * lesson today, and reporting it as neither taught nor a gap would make
 * `teachable + untaught` silently fail to equal the boxes on the sheet. The
 * invariant below is asserted, not assumed.
 */
export type SheetCoverage = {
  /** Every box on the sheet, including unused ones. */
  readonly total: number;
  /** Boxes with a lesson - including unused boxes that have one. */
  readonly teachable: number;
  /** Boxes a reader would click and learn nothing from. Excludes unused. */
  readonly untaught: number;
  /** Boxes the form prints but does not use. */
  readonly unused: number;
  /**
   * Unused boxes still awaiting a lesson. Not a to-do list - kept separate so
   * the sheet's totals reconcile and nothing vanishes from the count.
   */
  readonly unusedAndUntaught: number;
  /** Box ids a reader would click and learn nothing from, in sheet order. */
  readonly untaughtBoxes: readonly string[];
};

export function sheetCoverage(groups: readonly SheetGroup[]): SheetCoverage {
  const cells = groups.flatMap((g) => [...g.cells]);
  const untaughtBoxes = cells
    .filter((c) => c.affordance === "untaught" && !c.unusedByForm)
    .map((c) => c.box.box);
  const teachable = cells.filter((c) => c.affordance === "teachable").length;
  const unusedAndUntaught = cells.filter(
    (c) => c.affordance === "untaught" && c.unusedByForm,
  ).length;

  /*
   * Every box lands in exactly one of the three buckets. Asserted because the
   * alternative is a coverage figure that quietly loses boxes: if a fourth
   * combination were ever introduced, the sheet would still render while the
   * numbers under it stopped describing it, and a wrong number that looks
   * finished is worse than a missing one.
   */
  const accounted = teachable + untaughtBoxes.length + unusedAndUntaught;
  if (accounted !== cells.length) {
    throw new Error(
      `sheetCoverage: ${cells.length} boxes on the sheet but ${accounted} accounted for ` +
        `(taught ${teachable} + untaught ${untaughtBoxes.length} + unused-and-untaught ` +
        `${unusedAndUntaught}). The coverage figures no longer describe the sheet.`,
    );
  }

  return {
    total: cells.length,
    teachable,
    untaught: untaughtBoxes.length,
    unused: cells.filter((c) => c.unusedByForm).length,
    unusedAndUntaught,
    untaughtBoxes,
  };
}

/* ═════════════════════════════════════════════════════════════════════════
 * §3  EMBEDDED SELF-TESTS
 *
 * The codebase's convention: a core module proves itself, so a failure is
 * attributed to this file rather than to whichever screen noticed.
 * ═════════════════════════════════════════════════════════════════════════ */

function box(over: Partial<FormBox>): FormBox {
  return {
    formId: "form_test",
    box: "1",
    caption: "A caption",
    measure: "money",
    amountCents: 0,
    quantity: null,
    whose: "tax_base",
    derivation: "",
    blankOnPurpose: null,
    emphasise: false,
    notComputedYet: null,
    ...over,
  };
}

/**
 * A minimal but COMPLETE `BoxLesson`.
 *
 * Deliberately NOT written as `{...} as BoxLesson`. The first draft was, and the
 * cast is the bug: a cast tells the compiler to stop checking, so the day
 * somebody adds a twelfth required field to `BoxLesson` this fixture keeps
 * compiling while being structurally wrong, and the self-tests below would then
 * be exercising a shape the real product no longer has. Without the cast the
 * addition breaks HERE, loudly, at build time - which is the entire reason the
 * type exists. Rule 39: a checker that cannot see a field cannot approve it.
 */
function lesson(over: Partial<BoxLesson>): BoxLesson {
  return {
    formId: "form_test",
    box: "1",
    headline: "H",
    plainEnglish: "P",
    whereItComesFrom: "W",
    howToReadIt: "R",
    commonMistake: null,
    whatToDo: "D",
    examples: [],
    quotes: [],
    tiesTo: [],
    ...over,
  };
}

export function __runFormSheetCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, what: string): void => {
    if (!cond) throw new Error(`form-sheet-core self-test FAILED: ${what}`);
    passed += 1;
  };

  // --- affordances -------------------------------------------------------
  {
    const b = box({ box: "1" });
    const groups = sheetGroups([b], [lesson({ box: "1" })]);
    ok(groups[0].cells[0].affordance === "teachable", "a box with a lesson is teachable");
    const bare = sheetGroups([b], []);
    ok(bare[0].cells[0].affordance === "untaught", "a box with no lesson is untaught");
  }

  /*
   * ── THE REGRESSION THAT MATTERS MOST IN THIS FILE ────────────────────────
   * W-2 box 9's caption really is "(not used)" AND it really has a lesson
   * ("The box that must stay empty"). The first draft of this module tested
   * unusedness first and returned a third affordance, which stripped the click
   * handler from a taught box. These two assertions are the ones that would
   * have caught it, so they are stated as plainly as possible.
   */
  {
    const nine = box({ box: "9", caption: "(not used)" });
    const groups = sheetGroups([nine], [lesson({ box: "9" })]);
    const cell = groups[0].cells[0];
    ok(
      cell.affordance === "teachable",
      "an UNUSED box that HAS a lesson is still teachable (W-2 box 9)",
    );
    ok(cell.unusedByForm, "an unused box is still marked unused by the form");
    ok(cell.lesson !== undefined, "the unused box's lesson is carried to the renderer");
    const cov = sheetCoverage(groups);
    ok(cov.teachable === 1, "a taught unused box counts as taught");
    ok(cov.untaught === 0, "a taught unused box is not a coverage gap");
    ok(cov.unused === 1, "a taught unused box is still counted as unused");
  }

  // An UNTAUGHT unused box is excluded from the to-do list but not from totals.
  {
    const nine = box({ box: "9", caption: "(not used)" });
    const cov = sheetCoverage(sheetGroups([nine], []));
    ok(cov.untaught === 0, "an untaught unused box is not a coverage gap");
    ok(cov.untaughtBoxes.length === 0, "an untaught unused box is not on the to-do list");
    ok(cov.unusedAndUntaught === 1, "an untaught unused box is still accounted for");
    ok(cov.total === 1, "an untaught unused box still appears on the sheet");
  }

  // A caption merely CONTAINING the word must not be swallowed by the regex.
  {
    const real = box({ box: "3", caption: "Wages not used for the credit" });
    ok(!isUnusedBox(real), "a real caption mentioning 'not used' is not an unused box");
  }

  // --- grouping ----------------------------------------------------------
  {
    const groups = sheetGroups([box({ box: "a", caption: "SSN" }), box({ box: "1" })], []);
    ok(groups.length === 2, "named and numbered boxes form two groups");
    ok(groups[0].key === "named", "named boxes come first, as on the paper");
    ok(groups[1].cells[0].box.box === "1", "a numeric id lands in the numbered group");
  }

  /*
   * The W-3's real ids. These are the ones the first draft mis-filed under a
   * heading that promised numbers, so they are pinned by name.
   */
  {
    const w3ish = ["a", "b-kind-of-payer", "b-third-party-sick-pay", "contact", "1", "12a"];
    const groups = sheetGroups(
      w3ish.map((n) => box({ box: n })),
      [],
    );
    const named = groups.find((g) => g.key === "named");
    const numbered = groups.find((g) => g.key === "numbered");
    ok(named !== undefined && named.cells.length === 4, "W-3 named fields group together");
    ok(
      numbered !== undefined && numbered.cells.length === 2,
      "only the numeric W-3 ids are called numbered",
    );
    ok(
      named !== undefined && named.cells.some((c) => c.box.box === "b-kind-of-payer"),
      "'b-kind-of-payer' is a named box, not a numbered one",
    );
  }

  /*
   * A form with NO numbered boxes at all - every Washington form we hold. It
   * must not emit an empty "numbered" section, and must not claim its fields
   * are numbered.
   */
  {
    const wa = ["lni-hours", "lni-employee", "lni-employer", "lni-premium"];
    const groups = sheetGroups(
      wa.map((n) => box({ box: n })),
      [],
    );
    ok(groups.length === 1, "a form with no numbered boxes emits exactly one group");
    ok(groups[0].key === "named", "a form of named fields is all named");
    ok(
      !groups.some((g) => g.heading.toLowerCase().includes("number")),
      "no heading claims numbers on a form that has none",
    );
  }

  // The mirror case: a form of purely numbered boxes emits no named section.
  {
    const groups = sheetGroups(
      ["1", "5a", "16d"].map((n) => box({ box: n })),
      [],
    );
    ok(groups.length === 1, "a form with no named boxes emits exactly one group");
    ok(groups[0].key === "numbered", "a form of numbered boxes is all numbered");
  }

  // Every box placed exactly once, over a mixed and awkward set.
  {
    const many = ["a", "f", "1", "5a", "12", "16d", "20", "contact", "wa-cares"].map((n) =>
      box({ box: n }),
    );
    const cov = sheetCoverage(sheetGroups(many, []));
    ok(cov.total === many.length, "every box is placed exactly once");
  }

  // --- refusals ----------------------------------------------------------
  {
    let threw = false;
    try {
      sheetGroups([], []);
    } catch {
      threw = true;
    }
    ok(threw, "an empty form is refused rather than drawn blank");
  }
  {
    let threw = false;
    try {
      sheetGroups([box({ formId: "form_w2" }), box({ formId: "form_941", box: "2" })], []);
    } catch {
      threw = true;
    }
    ok(threw, "boxes from two forms are refused");
  }

  // --- the value column never invents a number ---------------------------
  {
    const unknown = box({ box: "5a", notComputedYet: "no payroll yet" });
    const cell = sheetGroups([unknown], [])[0].cells[0];
    ok(!/\d/.test(cell.printed), "an unknown figure prints no digits");
    ok(cell.notComputed, "an unknown figure is flagged as not computed");
  }

  // A lesson is only matched when BOTH formId and box agree. A cross-form match
  // would attach the wrong lesson to the right-looking box.
  {
    const groups = sheetGroups(
      [box({ formId: "form_w2", box: "1" })],
      [lesson({ formId: "form_941", box: "1" })],
    );
    ok(
      groups[0].cells[0].affordance === "untaught",
      "a lesson for another form does not make this box teachable",
    );
  }

  /*
   * Every affordance a real box can be in must be listed in the vocabulary
   * (rule 43 - walk it, do not hand-list it). Checked by producing both states
   * from actual boxes and confirming the vocabulary contains what came out,
   * rather than by asserting a count: a count passes while being wrong the
   * moment a state is added, and would have to be edited to lie.
   */
  {
    const produced = new Set(
      sheetGroups([box({ box: "1" }), box({ box: "2" })], [lesson({ box: "1" })])
        .flatMap((g) => [...g.cells])
        .map((c) => c.affordance),
    );
    ok(produced.size === 2, "both affordances are reachable from real boxes");
    for (const a of produced) {
      ok(ALL_BOX_AFFORDANCES.includes(a), `affordance "${a}" is listed in the vocabulary`);
    }
    for (const a of ALL_BOX_AFFORDANCES) {
      ok(produced.has(a), `vocabulary entry "${a}" is reachable and not dead`);
    }
  }

  console.log(`form-sheet-core: ${passed} self-tests passed`);
}
