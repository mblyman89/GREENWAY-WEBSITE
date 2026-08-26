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
  assertGeneratedSpecimenCoversItsLessons,
  assertEveryLessonSetWasHandedOver,
  MIN_LESSON_SETS,
  MAX_SCREEN_ONLY_LESSON_SETS,
  type NamedLessonSet,
  __runFormBoxTeachingCoreTests,
} from "@/lib/payroll/form-box-teaching-core";
import { formatBoxValue, boxIsEmpty, boxTone } from "@/lib/payroll/form-box-core";
import type { BoxLesson } from "@/lib/payroll/form-box-core";
import { FORM_940_LESSONS } from "@/lib/payroll/form-box-lessons-940";
import { FORM_941_LESSONS } from "@/lib/payroll/form-box-lessons-941";
import { FORM_W2_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-w2";
import { FORM_W3_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-w3";
import { WA_QUARTERLY_LESSONS } from "@/lib/payroll/form-box-lessons-wa";
import { FORM_941_CONFIRMATION_LESSONS } from "@/lib/payroll/form-941-confirmation-lessons";
import {
  SCHEDULE_B_LESSONS,
  scheduleBTeachingBoxes,
} from "@/lib/payroll/form-941-schedule-b-boxes";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * ═══ THE LIST OF LESSON SETS IS READ OUT OF THE REPOSITORY (books-55) ═══
 *
 * MEASURED, not assumed: at books-54 this file listed FOUR lesson sets and the
 * repository contained FIVE. The fifth was `FORM_941_CONFIRMATION_LESSONS`, and
 * it held THREE dead cross-references into `form_w3` — a form that threw when
 * asked for its boxes. The dead-tie gate added in books-54 was correct and
 * found nothing, because it was handed four fifths of the material.
 *
 * A hand-maintained list of files cannot be trusted to stay complete: whoever
 * adds the sixth module has no reason to know this test exists. So the list is
 * derived from the source tree, and the hand-written table below is checked
 * AGAINST it. The hand-written table still exists because it carries the one
 * thing the source cannot state — whether a set teaches boxes that exist on
 * paper — but it can no longer be short without failing.
 *
 * Rule 39: a verifier that cannot see something approves it. This makes the
 * verifier see the whole tree.
 */
const PAYROLL_SRC = join(process.cwd(), "src", "lib", "payroll");

/** Every `export const X: readonly BoxLesson[]` in the payroll library. */
function lessonSetDeclarationsInSource(): readonly { readonly file: string; readonly symbol: string }[] {
  const found: { file: string; symbol: string }[] = [];
  for (const file of readdirSync(PAYROLL_SRC)) {
    if (!file.endsWith(".ts")) continue;
    const text = readFileSync(join(PAYROLL_SRC, file), "utf8");
    const re = /export const (\w+)\s*:\s*readonly BoxLesson\[\]\s*=/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) found.push({ file, symbol: m[1] });
  }
  return found;
}

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

  /**
   * The five sets, with the one fact the source tree cannot tell us.
   *
   * `kind` is why this table still exists. `FORM_941_CONFIRMATION_LESSONS`
   * teaches the four questions the 941 CONFIRMATION SCREEN raises — its boxes
   * are "why", "doubling", "5d" and "source" — so it has no printed specimen
   * and cannot have one. Inventing captions for a screen would put four
   * fabricated "form's own words" into a system whose entire claim is that
   * every caption is quoted from paper (rule 62d). The exemption is declared
   * here and then VERIFIED in both directions inside
   * `assertEveryLessonSetWasHandedOver`, so it cannot go stale.
   */
  /*
   * A 31-day-February-free quarter with a leap-year February in it, so the
   * generated specimen exercises both a 30-day and a 29-day month rather than
   * only 31s. Q1 2028: January 31, February 29, March 31.
   */
  const SPECIMEN_QUARTER = { year: 2028, quarter: 1 as const };

  const SETS: readonly NamedLessonSet[] = [
    { name: "form-box-lessons-940.ts", lessons: FORM_940_LESSONS, kind: "printed-form" },
    { name: "form-box-lessons-941.ts", lessons: FORM_941_LESSONS, kind: "printed-form" },
    { name: "form-box-lessons-w2.ts", lessons: FORM_W2_BOX_LESSONS, kind: "printed-form" },
    { name: "form-box-lessons-w3.ts", lessons: FORM_W3_BOX_LESSONS, kind: "printed-form" },
    { name: "form-box-lessons-wa.ts", lessons: WA_QUARTERLY_LESSONS, kind: "printed-form" },
    {
      name: "form-941-confirmation-lessons.ts",
      lessons: FORM_941_CONFIRMATION_LESSONS,
      kind: "screen-only",
    },
    /*
     * The seventh set, added books-62. PRINTED paper, so it takes no
     * screen-only exemption, but its specimen is generated: 93 day cells, four
     * totals and three header boxes. See `generatedSpecimenBoxes`.
     */
    {
      name: "form-941-schedule-b-boxes.ts",
      lessons: SCHEDULE_B_LESSONS,
      kind: "printed-form",
      generatedSpecimenBoxes: scheduleBTeachingBoxes(SPECIMEN_QUARTER).map((b) => b.box),
    },
  ];

  /**
   * THE TEST THAT WOULD HAVE CAUGHT THE BOOKS-54 MISS.
   *
   * It does not read the lessons at all. It reads the SOURCE TREE, counts the
   * `readonly BoxLesson[]` declarations, and asserts the table above accounts
   * for every one of them. A sixth lesson module fails this immediately, by
   * name, without anybody having had to remember this file exists.
   */
  it("hands over every lesson set that exists in the source tree", () => {
    const declared = lessonSetDeclarationsInSource();

    // Rule 66d: assert existence before absence. A regex that matched nothing
    // would make this test certify completeness having found no sets at all.
    expect(
      declared.length,
      "found no lesson-set declarations in src/lib/payroll — the pattern this test greps for " +
        "has changed, so it is now proving nothing",
    ).toBeGreaterThanOrEqual(MIN_LESSON_SETS);

    /*
     * ═══ THE FILE-LEVEL DEDUPE HOLE, FOUND IN books-56 ═══
     *
     * This comparison was written on FILE NAMES, deduped with a Set. That is
     * one assumption away from being wrong: it assumes one lesson set per file.
     * Nothing enforces that. The moment somebody declares a second
     * `readonly BoxLesson[]` inside an existing module — the cheapest possible
     * way to add lessons, and the obvious thing to do for, say, a second WA
     * form — the two declarations collapse into one file name, this gate stays
     * green, and the new set is never handed to the tie checker. That is the
     * books-54 defect wearing a different hat.
     *
     * The table below hands over SYMBOLS, one row per set, so the honest
     * comparison is symbol-to-symbol. File names are still reported because
     * they are what a human needs in order to open the right file.
     *
     * MEASURED at books-56, before this was rewritten: six declarations in six
     * files, so the old comparison happened to be right — by luck, not by
     * design. Rule 39: it could not see the case it would have approved.
     */
    const perFile = new Map<string, number>();
    for (const d of declared) perFile.set(d.file, (perFile.get(d.file) ?? 0) + 1);
    const crowded = [...perFile.entries()].filter(([, n]) => n > 1);
    expect(
      crowded.map(([f, n]) => `${f} declares ${n}`),
      "a source file declares more than one BoxLesson set. That is allowed, but this gate " +
        "compares FILE NAMES, so the extra set would be invisible here and would never reach " +
        "the tie checker. Either split it into its own module, or rewrite this comparison " +
        "over symbols before adding it to the table below.",
    ).toEqual([]);

    const filesInSource = [...new Set(declared.map((d) => d.file))].sort();
    const filesHandedOver = [...new Set(SETS.map((s) => s.name))].sort();

    // With one set per file proven above, counting rows must equal counting
    // files. If it does not, the table has a duplicate row (rule 66b).
    expect(
      SETS.length,
      `the table hands over ${SETS.length} rows but only ${filesHandedOver.length} distinct ` +
        `file names, so a row is duplicated and is padding the count`,
    ).toBe(filesHandedOver.length);

    expect(
      filesHandedOver,
      `the source tree declares BoxLesson sets in ${filesInSource.length} files but this test ` +
        `hands over ${filesHandedOver.length}. Missing: ` +
        `${filesInSource.filter((f) => !filesHandedOver.includes(f)).join(", ") || "(none)"}. ` +
        `Extra: ${filesHandedOver.filter((f) => !filesInSource.includes(f)).join(", ") || "(none)"}. ` +
        `This is the exact defect that let three dead ties survive books-54.`,
    ).toEqual(filesInSource);

    console.log(
      `form-box-teaching-core: ${declared.length} lesson sets in source ` +
        `(${declared.map((d) => `${d.symbol}@${d.file}`).join(", ")}), all handed over`,
    );
  });

  /** Forms whose specimen is generated, so a tie into one can be resolved. */
  const GENERATED_FORMS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
    SETS.filter((s) => s.generatedSpecimenBoxes !== undefined).flatMap((s) =>
      [...new Set(s.lessons.map((l) => l.formId))].map((id) => [id, s.generatedSpecimenBoxes!]),
    ),
  );

  it("resolves every tie in every lesson set", () => {
    let ties = 0;
    for (const s of SETS) {
      expect(
        () => assertEveryTieResolves(s.lessons, GENERATED_FORMS),
        `dead tie in ${s.name}`,
      ).not.toThrow();
      const own = s.lessons.reduce((n, l) => n + l.tiesTo.length, 0);
      /*
       * Rule 66d per set, not just in total. A total floor is satisfied by one
       * fat module while another is emptied to zero, and a set with no ties at
       * all is a set this test approved without following a single reference.
       */
      expect(own, `lesson set ${s.name} has no cross-references at all`).toBeGreaterThan(0);
      ties += own;
    }

    /*
     * A floor on the total, so this cannot pass by the lesson modules being
     * emptied.
     *
     * MEASURED at books-56: 96 = the 62 counted at books-55 across five sets,
     * plus 34 in the new W-3 set. The books-54 figure of 56 was measured across
     * four of the five sets that existed and was reported to Michael as a
     * total, which it was not; that error is recorded in his books-55/56 owner
     * report rather than quietly corrected.
     */
    expect(
      ties,
      "far fewer ties than expected; a lesson module lost its content",
    ).toBeGreaterThanOrEqual(96);
    console.log(`form-box-teaching-core: ${ties} cross-references, all resolving`);
  });

  /**
   * The combined gate, plus proof that it refuses every way of being fooled.
   *
   * Rule 15: a gate nobody has watched fail is a decoration.
   */
  it("refuses a short list, a duplicate, a gutted set and a stale exemption", () => {
    /*
     * Every number below is DERIVED from SETS, not typed.
     *
     * books-55 wrote this block with the literals `5` and `slice(0, 4)`. When
     * books-56 added the W-3 set, six of the seven cases silently stopped
     * testing what their comments claimed: `slice(0, 4)` was no longer "one
     * short", it was two short, and case 6 reached for `SETS[4]` expecting the
     * screen-only set and got the W-3 set instead — so the "stale exemption"
     * case would have been exercising a completely different code path while
     * still going green. A test whose meaning depends on the ORDER of a table
     * somebody else edits is a test that quietly changes subject.
     */
    const N = SETS.length;
    const screenOnlyIndex = SETS.findIndex((s) => s.kind === "screen-only");
    // Rule 66d: the cases below are built out of this index. If it is -1 the
    // whole block would test nothing while appearing to test everything.
    expect(
      screenOnlyIndex,
      "no screen-only set found, so the stale-exemption cases below would be built from " +
        "SETS[-1] === undefined and would throw for the wrong reason",
    ).toBeGreaterThanOrEqual(0);
    const oneShort = SETS.filter((_, i) => i !== screenOnlyIndex);
    expect(oneShort.length).toBe(N - 1);

    expect(() => assertEveryLessonSetWasHandedOver(SETS, N)).not.toThrow();

    // 1. the books-54 defect itself: one set fewer handed over than exist
    expect(() => assertEveryLessonSetWasHandedOver(oneShort, N)).toThrow(
      new RegExp(`handed ${N - 1}`),
    );

    // 2. and it cannot be silenced by lowering the expected count to match
    expect(() => assertEveryLessonSetWasHandedOver(oneShort, N - 1)).toThrow(
      /at least \d+ lesson sets/,
    );

    // 3. nothing to check is not a pass
    expect(() => assertEveryLessonSetWasHandedOver([], 0)).toThrow(/at least \d+ lesson sets/);

    // 3b. and the backstop cannot be walked down one at a time
    expect(() =>
      assertEveryLessonSetWasHandedOver(SETS.slice(0, MIN_LESSON_SETS - 1), MIN_LESSON_SETS - 1),
    ).toThrow(/at least \d+ lesson sets/);

    // 4. a duplicate must not pad the count in place of a missing set
    expect(() => assertEveryLessonSetWasHandedOver([...oneShort, SETS[0]], N)).toThrow(/twice/);

    // 5. an emptied module must not read as a clean pass
    expect(() =>
      assertEveryLessonSetWasHandedOver(
        [...oneShort, { name: "gutted.ts", lessons: [], kind: "printed-form" }],
        N,
      ),
    ).toThrow(/is empty/);

    // 6. a screen-only exemption over a form that DOES have a specimen is
    //    stale, and a stale exemption is a licence for a real gap. Built from
    //    the located screen-only row, so it cannot drift onto another set.
    expect(() =>
      assertEveryLessonSetWasHandedOver(
        [...oneShort, { ...SETS[screenOnlyIndex], lessons: FORM_940_LESSONS }],
        N,
      ),
    ).toThrow(/exemption is stale/);

    // 7. declaring everything screen-only must not switch the specimen check
    //    off. With the cap now expressed over exemptions this is refused twice
    //    over, which is the point.
    expect(() =>
      assertEveryLessonSetWasHandedOver(
        SETS.map((s) => ({ ...s, kind: "screen-only" as const })),
        N,
      ),
    ).toThrow(/exemption is stale|printed specimen|claim to be screen-only/);

    /*
     * 8. NEW at books-56 — and the first draft of this case was WRONG, which
     *    is worth recording because it is the subtlest kind of bad test.
     *
     *    The first draft flipped SETS[0] (the 940 lessons) to screen-only and
     *    accepted a throw matching /claim to be screen-only|exemption is
     *    stale/. It went green — but via the SECOND alternative, because
     *    `form_940` is registered in TEACHING_FORMS so the stale-exemption
     *    check fires first and the cap is never reached. The mutation that
     *    proves it: raising MAX_SCREEN_ONLY_LESSON_SETS from 1 to 2 left all
     *    nineteen tests green. The cap was decoration (rule 15).
     *
     *    To reach the cap the extra set must be LEGITIMATELY screen-only —
     *    a formId with no printed specimen — so the stale check stays silent
     *    and only the cap can object. `filed_941` is such an id: it is the
     *    confirmation screen and is deliberately not in TEACHING_FORMS.
     */
    const secondScreenPanel: NamedLessonSet = {
      name: "hypothetical-second-screen-panel.ts",
      lessons: FORM_941_CONFIRMATION_LESSONS,
      kind: "screen-only",
    };
    // Guard the premise: if `filed_941` ever gains a specimen this case stops
    // testing the cap and silently reverts to testing the stale check.
    for (const l of secondScreenPanel.lessons) {
      expect(
        TEACHING_FORMS[l.formId],
        `form "${l.formId}" now has a printed specimen, so this case no longer reaches the ` +
          `screen-only cap and must be rebuilt on a form that genuinely has no paper`,
      ).toBeUndefined();
    }
    const withTwoPanels: readonly NamedLessonSet[] = [
      ...SETS.filter((s) => s.kind === "printed-form").slice(1),
      SETS[screenOnlyIndex],
      secondScreenPanel,
    ];
    expect(withTwoPanels.length).toBe(N);
    expect(withTwoPanels.filter((s) => s.kind === "screen-only").length).toBe(2);
    expect(() => assertEveryLessonSetWasHandedOver(withTwoPanels, N)).toThrow(
      /claim to be screen-only/,
    );
  });

  /**
   * ═══ THE CAP MUST BE EXACTLY AS LOOSE AS REALITY (books-56) ═══
   *
   * Both constants are hand-written numbers, and a hand-written number with
   * SLACK in it is a permission slip nobody remembers granting. If
   * MAX_SCREEN_ONLY_LESSON_SETS is 2 while only one set is genuinely a screen
   * panel, then one printed form may be mislabelled and skipped, and — proved
   * by mutation — every test above stays green.
   *
   * So the constants are pinned to the measured table. This is the only test
   * that reads them as data rather than using them as a threshold, and it is
   * what makes raising either of them a deliberate act with a visible failure
   * rather than a quiet loosening.
   */
  it("keeps both hand-written lesson-set constants pinned to the measured truth", () => {
    expect(
      MAX_SCREEN_ONLY_LESSON_SETS,
      "the screen-only cap has slack in it: it permits more exempt sets than actually exist, " +
        "so a printed form could be mislabelled screen-only and skip the specimen check with " +
        "every gate still green. Lower it to the real count, or add the screen panel that " +
        "justifies it in the same commit.",
    ).toBe(SETS.filter((s) => s.kind === "screen-only").length);

    expect(
      MIN_LESSON_SETS,
      "the lesson-set backstop no longer matches the number of sets that exist. Raised too " +
        "high it fails every honest call; left too low it stops being a backstop at all.",
    ).toBe(SETS.length);
  });

  /**
   * The companion check, applied to every set that teaches a printed form.
   *
   * `assertEveryTaughtBoxHasASpecimen` has existed since books-49 but was
   * called for the W-2 lessons ONLY. It passes for all five printed sets —
   * measured, not assumed — so the other four were correct by luck rather
   * than by gate. The one screen-only set is checked differently; see the
   * `kind` field above.
   */
  it("gives every taught box a specimen, in every printed-form lesson set", () => {
    let checkedSets = 0;
    for (const s of SETS) {
      if (s.kind !== "printed-form") continue;
      // A generated specimen is checked against the boxes it renders; the
      // table-based check would look for it in TEACHING_FORMS and not find it.
      if (s.generatedSpecimenBoxes !== undefined) {
        expect(
          () =>
            assertGeneratedSpecimenCoversItsLessons(s.name, s.lessons, s.generatedSpecimenBoxes!),
          s.name,
        ).not.toThrow();
      } else {
        expect(() => assertEveryTaughtBoxHasASpecimen(s.lessons), s.name).not.toThrow();
      }
      checkedSets += 1;
    }
    /*
     * Rule 66d: prove the loop had something to inspect. Derived rather than
     * typed — the literal `4` here was already one short the moment the W-3 set
     * landed, and a floor below the truth accepts a set being skipped.
     */
    expect(checkedSets, "no printed-form lesson set was checked").toBe(
      SETS.filter((s) => s.kind === "printed-form").length,
    );
    expect(checkedSets).toBeGreaterThanOrEqual(MIN_LESSON_SETS - MAX_SCREEN_ONLY_LESSON_SETS);

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
  /*
   * UPDATED DELIBERATELY IN books-55, from seven forms to eight.
   *
   * `form_w3` is the addition. It was already named in ALL_TAUGHT_FORM_IDS and
   * already returned a title, but it was NOT in this registry, so asking it for
   * its boxes threw. That is why this pin read seven: the list was accurate
   * about what was registered and silent about the gap.
   *
   * This assertion FAILED when the W-3 was registered, which is the pin working
   * as designed — a roster change must be stated, not absorbed. Rule 89.
   */
  it("covers all eight forms, including the 5208B that has no boxes", () => {
    expect(Object.keys(TEACHING_FORMS).sort()).toEqual([
      "esd_5208a",
      "esd_5208b",
      "form_940",
      "form_941",
      "form_w2",
      "form_w3",
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
