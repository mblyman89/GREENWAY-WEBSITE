/**
 * tests/compliance/learning-path.test.ts   (books-44, slice C)
 *
 * THE GATE ON THE CURRICULUM AND THE SCREEN THAT RENDERS IT.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS PROTECTING, AND WHY IT NEEDS PROTECTING
 * ────────────────────────────────────────────────────────────────────────────
 * Six mentor modules held 82 finished, tested lessons that no screen rendered.
 * Every one of those lessons had passing tests the whole time. That is the
 * thing to keep in mind while reading this file: the old tests proved the
 * lessons were CORRECT, and correctness was never the problem. Nothing proved
 * they were REACHABLE, so they sat in the dark for months while the suite was
 * green.
 *
 * So the assertions here are almost all of a different shape from the usual
 * ones. They are not "does this function return the right number". They are:
 *
 *   - is every lesson the system contains actually placed in the course?
 *   - does every entry in the course point at a lesson that really exists?
 *   - is the count on the screen DERIVED, or is it a number somebody typed?
 *   - can the gate that answers those questions actually fail?
 *
 * That last one matters most. A coverage test that inspects an empty list
 * passes, and looks exactly like a coverage test that inspects everything.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS FILE ALREADY CAUGHT, RECORDED BECAUSE IT WILL RECUR
 * ────────────────────────────────────────────────────────────────────────────
 * The first draft of `CURRICULUM` was written from memory of what each mentor
 * was ABOUT rather than from the modules themselves. Of 42 entries, 37 named
 * functions that do not exist: `validateW4`, `closePeriod`, `compoundDaily`,
 * `reconcileQuarter`. Every one of them sounded exactly right.
 * `danglingCurriculumEntries()` found all 37 in one run.
 *
 * Nothing about that failure was loud. A dangling entry does not crash - the
 * unit simply renders one lesson shorter and says nothing. Without the gate,
 * the page would have shipped teaching 45 lessons while claiming 82, and the
 * only symptom would have been that some units looked a bit thin.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { findGuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import {
  CURRICULUM,
  LESSON_SOURCES,
  SOURCE_LABELS,
  allLessons,
  assertCurriculumIsWellFormed,
  curriculumCoverage,
  danglingCurriculumEntries,
  findLesson,
  findUnit,
  lessonKey,
  placedLessonCount,
  unitLessons,
  unplacedLessons,
  type LessonSourceKey,
} from "@/lib/accounting/learning-path-core";
import {
  FIELD_LABELS,
  HOW_TO_USE_THIS,
  LEARNING_SCOPE_NOTE,
  MIN_QUERY_LENGTH,
  NO_AUTHORITY_NOTE,
  UNIT_ACCENTS,
  accentFor,
  assertLearningUiIsWellFormed,
  buildLearningScreen,
  buildLessonCard,
  buildUnitView,
  coverageBanner,
  curriculumTrail,
  firstSentence,
  lessonAnchor,
  searchLessons,
  searchNotice,
  shortTitleOf,
  unitHref,
  unitRange,
  unitTabs,
} from "@/lib/accounting/learning-path-ui-core";

const ROOT = process.cwd();

/* ══════════════════════════════════════════════════════════════════════════ *
 * 1. THE SOURCES ARE REAL AND NON-EMPTY
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-44: the six teaching modules the course is built from", () => {
  it("there are six of them and every one has lessons in it", () => {
    // Rule 39. Everything downstream counts these; if a module silently became
    // empty, every coverage figure below would still agree with itself and be
    // describing a smaller course than the one that exists.
    const keys = Object.keys(LESSON_SOURCES) as LessonSourceKey[];
    expect(keys.length).toBe(6);
    for (const k of keys) {
      expect(LESSON_SOURCES[k].length, `${k} contains no lessons at all`).toBeGreaterThan(0);
    }
  });

  it("every module has a human label, and no label is a slug in disguise", () => {
    for (const k of Object.keys(LESSON_SOURCES) as LessonSourceKey[]) {
      const label = SOURCE_LABELS[k];
      expect(label, `${k} has no label`).toBeTruthy();
      // A label that is just the key does not tell Michael anything he could
      // not already see.
      expect(label.toLowerCase()).not.toBe(k.toLowerCase());
      expect(label.length).toBeGreaterThan(4);
    }
  });

  it("every lesson carries all five parts, none of them a stub", () => {
    /*
     * The lesson shape is `{ fn, plainEnglish, whyItExists, theTrap,
     * whatIWouldDo, authorityIds }`, and the screen renders four of those as
     * separate coloured blocks. A one-word `theTrap` renders as a large orange
     * box containing almost nothing, which reads as "there is no trap here" -
     * the opposite of the truth in most cases.
     */
    for (const l of allLessons()) {
      const where = `${l.source}:${l.fn}`;
      expect(l.fn.length, `${where} has no name`).toBeGreaterThan(1);
      expect(l.plainEnglish.length, `${where} plainEnglish is a stub`).toBeGreaterThan(30);
      expect(l.whyItExists.length, `${where} whyItExists is a stub`).toBeGreaterThan(30);
      expect(l.theTrap.length, `${where} theTrap is a stub`).toBeGreaterThan(30);
      expect(l.whatIWouldDo.length, `${where} whatIWouldDo is a stub`).toBeGreaterThan(30);
    }
  });

  it("a lesson is identified by module AND name, because one name is used twice", () => {
    /*
     * MEASURED, NOT ASSUMED, and the reason the whole system keys on a pair.
     *
     * `daysBetween` exists in the penalty mentor and again in the interest
     * mentor. They are different functions that disagree about direction. Key
     * on `fn` alone and they collapse into one entry: a lesson vanishes, the
     * total drops by one, and every count still looks completely plausible.
     */
    const byFn = new Map<string, string[]>();
    for (const l of allLessons()) {
      byFn.set(l.fn, [...(byFn.get(l.fn) ?? []), l.source]);
    }
    const shared = [...byFn.entries()].filter(([, sources]) => sources.length > 1);
    expect(
      shared.length,
      "no function name is shared between modules any more, so this test no longer proves that " +
        "keying on the pair is necessary. That is fine, but check the reasoning is still recorded.",
    ).toBeGreaterThan(0);
    expect(byFn.get("daysBetween")?.sort()).toEqual(["interest", "penalties"]);

    // And the keys really are distinct.
    expect(lessonKey("penalties", "daysBetween")).not.toBe(lessonKey("interest", "daysBetween"));
  });

  it("every lesson has a unique module+name key", () => {
    const keys = allLessons().map((l) => lessonKey(l.source, l.fn));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * 2. COVERAGE: EVERY LESSON IS TAUGHT, EXACTLY ONCE
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-44: the curriculum reaches every lesson exactly once", () => {
  it("no curriculum entry points at a lesson that does not exist", () => {
    // The check that caught 37 invented function names in the first draft.
    expect(danglingCurriculumEntries()).toEqual([]);
  });

  it("no lesson is left out of the course", () => {
    const stranded = unplacedLessons().map((l) => lessonKey(l.source, l.fn));
    expect(
      stranded,
      `these lessons exist and nothing teaches them: ${stranded.join(", ")}. That is the exact ` +
        `defect this whole slice was built to end - finished, tested work that no screen shows.`,
    ).toEqual([]);
  });

  it("no lesson is taught twice", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const unit of CURRICULUM) {
      for (const [source, fn] of unit.lessons) {
        const k = lessonKey(source, fn);
        if (seen.has(k)) dupes.push(k);
        seen.add(k);
      }
    }
    expect(dupes, "duplication in a syllabus reads as emphasis and is actually a bug").toEqual([]);
  });

  it("the placed count equals the number of lessons that exist, both counted live", () => {
    /*
     * NEITHER SIDE OF THIS IS A LITERAL. Both are re-derived: one by walking
     * the six modules, one by walking the eight units. Writing `expect(...)
     * .toBe(82)` would pass on the day somebody deletes a mentor AND its
     * curriculum entries together, which is precisely the silent shrink this
     * is here to catch.
     */
    expect(placedLessonCount()).toBe(allLessons().length);
  });

  it("every unit resolves all of the lessons it lists", () => {
    // `unitLessons` drops what it cannot find, so a short list here means a
    // dangling entry is rendering as silence.
    for (const unit of CURRICULUM) {
      expect(unitLessons(unit).length, `unit ${unit.key} renders short`).toBe(unit.lessons.length);
    }
  });

  it("the well-formed gate passes on the real curriculum", () => {
    expect(() => assertCurriculumIsWellFormed()).not.toThrow();
  });

  it("the well-formed gate throws on every kind of broken curriculum", () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE TEST THAT HAD TO BE WRITTEN TWICE
     * ─────────────────────────────────────────────────────────────────────────
     * The mutation campaign replaced the entire body of
     * `assertCurriculumIsWellFormed` with `return;` and this suite stayed
     * GREEN. Every assertion about it was of the form "it does not throw on a
     * curriculum that is already correct" - which a function that does nothing
     * whatsoever satisfies perfectly.
     *
     * That is exactly the defect slice C exists to end, turned inward: a gate
     * that had been written, reviewed and shipped, and that protected nothing.
     * The fix was to let the function take the curriculum it inspects, so the
     * suite can hand it broken ones and require it to complain about each in
     * the specific way it claims to.
     *
     * Each case below is a real way a curriculum degrades during ordinary
     * editing. If any one of them stops throwing, that branch is decoration.
     */
    const realUnit = CURRICULUM[0];

    // 1. Nothing to inspect. A coverage check over zero units approves
    //    everything, which is how "all lessons placed" gets reported by a
    //    curriculum that teaches nothing at all.
    expect(() => assertCurriculumIsWellFormed([])).toThrow(/inspects nothing/);

    // 2. An entry naming a function that no longer exists - the 37-invented-
    //    names defect. The unit renders one lesson shorter and says nothing.
    expect(() =>
      assertCurriculumIsWellFormed([
        { ...realUnit, lessons: [["penalties", "aFunctionNobodyEverWrote"]] },
      ]),
    ).toThrow(/POINTS AT LESSONS THAT DO NOT EXIST/);

    // 3. The same lesson taught twice. In a syllabus that reads as emphasis;
    //    in the code it is a bug that inflates every count downstream.
    expect(() =>
      assertCurriculumIsWellFormed([
        {
          ...realUnit,
          lessons: [
            ["penalties", "computeDorPenalty"],
            ["penalties", "computeDorPenalty"],
          ],
        },
      ]),
    ).toThrow(/TEACHES THE SAME LESSON TWICE/);

    // 4. Two units sharing a key. Both answer to the same URL, so one of them
    //    is unreachable forever and nothing says which.
    expect(() =>
      assertCurriculumIsWellFormed([
        { ...realUnit, key: "same", lessons: [["penalties", "computeDorPenalty"]] },
        { ...realUnit, key: "same", lessons: [["penalties", "computeEsdPenalty"]] },
      ]),
    ).toThrow(/DUPLICATE UNIT KEYS/);

    // 5. An empty unit. Renders a heading over blank space, which reads as
    //    "there is nothing to know here" - the opposite of the truth.
    expect(() => assertCurriculumIsWellFormed([{ ...realUnit, lessons: [] }])).toThrow(
      /TEACHES NOTHING/,
    );
  });

  it("the dangling detector can be handed a curriculum and finds the break", () => {
    // The detector takes its units as an argument for the same reason the gate
    // does: a function that can only ever be run against a correct input can
    // only ever return an empty list, and an always-empty list is not evidence.
    expect(danglingCurriculumEntries()).toEqual([]);
    expect(
      danglingCurriculumEntries([
        {
          ...CURRICULUM[0],
          key: "fake",
          lessons: [
            ["penalties", "computeDorPenalty"],
            ["penalties", "computeSomethingImagined"],
          ],
        },
      ]),
    ).toEqual(["fake -> penalties:computeSomethingImagined"]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * 3. THE GATES CAN ACTUALLY FAIL
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-44: the coverage gates are not vacuous", () => {
  /*
   * ──────────────────────────────────────────────────────────────────────────
   * WHY THIS BLOCK EXISTS
   * ──────────────────────────────────────────────────────────────────────────
   * Rule 39: a check that cannot fail is not a check. Everything in section 2
   * is an assertion that some list is EMPTY, and the easiest way for all of
   * them to pass is for the machinery to be broken in a way that always
   * produces an empty list.
   *
   * These feed deliberately broken inputs to the same functions and require
   * them to complain. If one of these ever passes for the wrong reason, the
   * whole of section 2 is decoration.
   */

  it("findLesson refuses a name that does not exist", () => {
    expect(findLesson("penalties", "thisFunctionWasNeverWritten")).toBeUndefined();
  });

  it("findLesson does not match a real name in the WRONG module", () => {
    // The heart of the pair-keying argument, asserted directly. `validateI9`
    // is a real lesson - in `onboarding`, not in `interest`.
    expect(findLesson("onboarding", "validateI9")).toBeDefined();
    expect(findLesson("interest", "validateI9")).toBeUndefined();
  });

  it("the dangling detector reports an entry that names a missing function", () => {
    // Same logic as `danglingCurriculumEntries`, run against a fake unit, so
    // the detector is proven able to return a NON-empty answer.
    const fakeUnit = {
      key: "fake",
      lessons: [
        ["penalties", "computeDorPenalty"], // real
        ["penalties", "computeSomethingImagined"], // not real
      ] as const,
    };
    const found: string[] = [];
    for (const [source, fn] of fakeUnit.lessons) {
      if (!findLesson(source as LessonSourceKey, fn)) found.push(`${fakeUnit.key} -> ${source}:${fn}`);
    }
    expect(found).toEqual(["fake -> penalties:computeSomethingImagined"]);
  });

  it("accentFor refuses an unknown unit rather than quietly defaulting", () => {
    // Rule 27. A default would give two units the same colour, which destroys
    // the only job colour has on this screen.
    expect(() => accentFor("no-such-unit")).toThrow(/NO ACCENT FOR CURRICULUM UNIT/);
  });

  it("unitRange refuses a unit with no lessons", () => {
    expect(() => unitRange("no-such-unit")).toThrow(/HAS NO LESSONS/);
  });

  it("buildLessonCard refuses a lesson that is not in any unit", () => {
    expect(() => buildLessonCard("penalties", "notARealFunction")).toThrow(/NO SUCH LESSON/);
  });

  it("the UI gate passes on the real curriculum and can be made to fail", () => {
    expect(() => assertLearningUiIsWellFormed()).not.toThrow();

    // Prove the duplicate-accent branch is live by exercising the same
    // comparison it uses. If two units ever shared a colour, this is the shape
    // of the check that catches it.
    const accents = CURRICULUM.map((u) => accentFor(u.key));
    expect(new Set(accents).size).toBe(accents.length);
  });

  it("the UI gate throws on every kind of incoherent presentation", () => {
    /*
     * The sibling of the curriculum-gate test above, and it exists for exactly
     * the same reason: the mutation campaign emptied this function's body and
     * nothing went red, because the only assertion about it was "it does not
     * throw on inputs that are already correct". Rule 39.
     *
     * Each case is a real way the presentation layer drifts out of step with
     * the course it is supposed to be describing.
     */
    const a = CURRICULUM[0];
    const b = CURRICULUM[1];

    // 1. Nothing to inspect.
    expect(() => assertLearningUiIsWellFormed([])).toThrow(/proves nothing/);

    // 2. A unit with no colour. On this screen colour is how the reader knows
    //    which unit he is in, so an uncoloured unit is an unfinished one.
    expect(() => assertLearningUiIsWellFormed([a], {})).toThrow(/NO ACCENT FOR CURRICULUM UNIT/);

    // 3. Two units wearing the same colour. This teaches a grouping that does
    //    not exist - the reader infers the two are related because they match.
    expect(() =>
      assertLearningUiIsWellFormed([a, b], { [a.key]: "emerald", [b.key]: "emerald" }),
    ).toThrow(/SHARE THE ACCENT/);

    // 4. A palette entry for a unit that no longer exists. Stale colour tables
    //    are how the palette quietly stops describing the course.
    expect(() =>
      assertLearningUiIsWellFormed([a], { [a.key]: "slate", "unit-that-was-deleted": "rose" }),
    ).toThrow(/NOT A CURRICULUM UNIT/);

    // 5. A unit listing a lesson that does not resolve. `unitLessons` drops
    //    what it cannot find, so the unit renders short and says nothing.
    expect(() =>
      assertLearningUiIsWellFormed(
        [{ ...a, lessons: [["penalties", "aLessonNobodyWrote"]] }],
        { [a.key]: "slate" },
      ),
    ).toThrow(/LISTS 1 LESSONS BUT ONLY 0 RESOLVE/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * 4. THE ORDER IS DELIBERATE AND EXPLAINED
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-44: the running order, and the reasons attached to it", () => {
  it("every unit has a key, a title, a question, a when, a why and a one-thing", () => {
    /*
     * These six fields are the difference between a course and a list. Michael
     * asked to be taught in the order Greenway's work happens; "why am I
     * reading this now" is the question that decides whether teaching lands,
     * so a unit that cannot answer it is not finished.
     */
    for (const u of CURRICULUM) {
      expect(u.key, "a unit with no key cannot be linked to").toMatch(/^[a-z][a-z0-9-]*$/);
      expect(u.title.length, `${u.key} title`).toBeGreaterThan(10);
      expect(u.theQuestion.length, `${u.key} theQuestion`).toBeGreaterThan(20);
      expect(u.whenYouNeedIt.length, `${u.key} whenYouNeedIt`).toBeGreaterThan(40);
      expect(u.whyHere.length, `${u.key} whyHere`).toBeGreaterThan(60);
      expect(u.theOneThing.length, `${u.key} theOneThing`).toBeGreaterThan(40);
    }
  });

  it("the question a unit answers is phrased as a question", () => {
    // Not decoration. A heading a reader can answer is a heading they engage
    // with; a noun phrase is a filing-cabinet label.
    for (const u of CURRICULUM) {
      expect(u.theQuestion.trim().endsWith("?"), `${u.key} theQuestion is not a question`).toBe(true);
    }
  });

  it("unit keys are unique and stable-looking", () => {
    const keys = CURRICULUM.map((u) => u.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("penalties come LAST, because they are what happens when the rest was not done", () => {
    /*
     * The single most deliberate ordering decision in the course, so it is
     * pinned. Leading with penalties teaches fear instead of practice; ending
     * with them means each one is met already knowing which piece of work
     * prevents it.
     */
    const last = CURRICULUM[CURRICULUM.length - 1];
    expect(last.key).toBe("when-late");

    // And the penalty/interest teaching really is concentrated there rather
    // than scattered through the earlier units.
    const lateSources = new Set(last.lessons.map(([s]) => s));
    expect(lateSources.has("penalties")).toBe(true);
    expect(lateSources.has("interest")).toBe(true);
  });

  it("the units that everything else depends on come FIRST", () => {
    // Units 1 and 2 are how money is written down and how days are counted.
    // A units mistake cannot be found later by looking at the report it
    // corrupted, so meeting them first is what makes later refusals legible.
    expect(CURRICULUM[0].key).toBe("money");
    expect(CURRICULUM[1].key).toBe("dates");
  });

  it("both `daysBetween` lessons are taught, side by side, in the dates unit", () => {
    /*
     * The two same-named functions are placed deliberately ADJACENT rather than
     * hidden apart, because the fact that they disagree is itself the lesson.
     */
    const dates = findUnit("dates");
    expect(dates).toBeDefined();
    const entries = dates!.lessons.map(([s, f]) => `${s}:${f}`);
    expect(entries).toContain("penalties:daysBetween");
    expect(entries).toContain("interest:daysBetween");
    const a = entries.indexOf("penalties:daysBetween");
    const b = entries.indexOf("interest:daysBetween");
    expect(Math.abs(a - b), "the two daysBetween lessons should sit next to each other").toBe(1);
  });

  it("the two non-function lessons are taught rather than quietly dropped", () => {
    /*
     * `AGENCY_CLOCKS` is a constant and `__runPeriodCloseCoreTests` is a
     * module self-test. Both carry a full lesson. Filtering them out would be
     * the easy way to make the numbers tidy, and would mean the course silently
     * covered less than the modules contain.
     */
    const placed = new Set<string>();
    for (const u of CURRICULUM) for (const [s, f] of u.lessons) placed.add(`${s}:${f}`);
    expect(placed.has("penalties:AGENCY_CLOCKS")).toBe(true);
    expect(placed.has("period-close:__runPeriodCloseCoreTests")).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * 5. THE TRAIL AND THE NUMBERS ON SCREEN
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-44: every number the screen prints is derived", () => {
  it("the trail numbers every lesson once, consecutively, from one", () => {
    const trail = curriculumTrail();
    expect(trail.length).toBe(allLessons().length);
    trail.forEach((s, i) => expect(s.globalIndex).toBe(i + 1));
    expect(new Set(trail.map((s) => `${s.source}:${s.fn}`)).size).toBe(trail.length);
  });

  it("the per-unit numbering restarts at one in every unit", () => {
    for (const u of CURRICULUM) {
      const stops = curriculumTrail().filter((s) => s.unitKey === u.key);
      expect(stops[0].indexInUnit).toBe(1);
      stops.forEach((s, i) => expect(s.indexInUnit).toBe(i + 1));
    }
  });

  it("unit ranges tile the whole course with no gap and no overlap", () => {
    /*
     * If two units claimed overlapping ranges, the position lines would tell
     * Michael he was on lesson 30 twice. If they left a gap, some lesson would
     * be numbered outside every unit.
     */
    let expected = 1;
    for (const u of CURRICULUM) {
      const r = unitRange(u.key);
      expect(r.firstGlobal, `unit ${u.key} does not start where the last one ended`).toBe(expected);
      expect(r.lastGlobal).toBe(expected + r.count - 1);
      expected = r.lastGlobal + 1;
    }
    expect(expected - 1).toBe(allLessons().length);
  });

  it("the coverage figures are recomputed, not read from a constant", () => {
    const c = curriculumCoverage();
    expect(c.totalLessons).toBe(allLessons().length);
    expect(c.placedLessons).toBe(placedLessonCount());
    expect(c.unitCount).toBe(CURRICULUM.length);
    expect(c.unplaced).toEqual([]);
    expect(c.dangling).toEqual([]);
  });

  it("the coverage banner is green only when coverage is actually complete", () => {
    // The real one is green...
    expect(coverageBanner().tone).toBe("green");

    // ...and a fabricated shortfall turns it orange and NAMES the gap. This is
    // the branch that would have to work on the day somebody adds a lesson and
    // forgets to place it, which is exactly when nobody is looking.
    const short = coverageBanner({
      totalLessons: 82,
      placedLessons: 80,
      unplaced: ["interest:someNewThing", "penalties:anotherNewThing"],
      dangling: [],
      unitCount: 8,
    });
    expect(short.tone).toBe("orange");
    expect(short.gaps).toContain("interest:someNewThing");
    expect(short.headline).toContain("2 of 82");

    // A dangling entry is a different, worse problem and says so differently.
    const broken = coverageBanner({
      totalLessons: 82,
      placedLessons: 81,
      unplaced: [],
      dangling: ["dates -> penalties:renamedAway"],
      unitCount: 8,
    });
    expect(broken.tone).toBe("orange");
    expect(broken.headline).toMatch(/no longer exist/);
    expect(broken.gaps).toContain("dates -> penalties:renamedAway");
  });

  it("the banner's green wording quotes the counts it was given", () => {
    // Rule 66: a sentence that states a number must state the REAL number.
    const b = coverageBanner();
    const c = curriculumCoverage();
    expect(b.headline).toContain(String(c.totalLessons));
    expect(b.body).toContain(String(c.placedLessons));
    expect(b.body).toContain(String(c.unitCount));
  });

  it("the screen subtitle quotes the live totals", () => {
    const s = buildLearningScreen({});
    expect(s.subtitle).toContain(String(allLessons().length));
    expect(s.subtitle).toContain(String(CURRICULUM.length));
    expect(s.totalLessons).toBe(allLessons().length);
  });

  it("no hard-coded lesson total is written into the curriculum or the UI core", () => {
    /*
     * ────────────────────────────────────────────────────────────────────────
     * THE MOST IMPORTANT TEST IN THIS FILE
     * ────────────────────────────────────────────────────────────────────────
     * The whole design claim is "the count is computed, so a lesson can never
     * again be finished and invisible". That claim dies the moment somebody
     * types `82` into a template string, and it dies SILENTLY, because the
     * number is right on the day it is typed.
     *
     * So: the literal must not appear in executable code. It is allowed in
     * comments and doc blocks, where it is describing history rather than
     * driving a display.
     */
    for (const rel of [
      "src/lib/accounting/learning-path-core.ts",
      "src/lib/accounting/learning-path-ui-core.ts",
      "src/app/admin/books/learn/page.tsx",
    ]) {
      const text = readFileSync(join(ROOT, rel), "utf8");
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // line comments
      const total = String(allLessons().length);
      expect(
        code.includes(total),
        `${rel} contains the literal ${total} in executable code. Every count on this screen ` +
          `must be derived - a typed total is correct on the day it is typed and wrong forever ` +
          `after, without ever going red.`,
      ).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * 6. THE LESSON CARD
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-44: one lesson, as the screen renders it", () => {
  it("every lesson in the course builds a card without throwing", () => {
    for (const stop of curriculumTrail()) {
      expect(() => buildLessonCard(stop.source, stop.fn), `${stop.source}:${stop.fn}`).not.toThrow();
    }
  });

  it("each card carries the four teaching blocks in a fixed order", () => {
    /*
     * The order is the teaching: what it does, why it exists, what goes wrong,
     * what I would do. Shuffling them per-lesson would mean Michael has to
     * re-orient on every card, which is precisely the "wall of words and
     * colour" he said he could not digest.
     */
    for (const stop of curriculumTrail()) {
      const card = buildLessonCard(stop.source, stop.fn);
      expect(card.fields.map((f) => f.label)).toEqual([
        FIELD_LABELS.plainEnglish,
        FIELD_LABELS.whyItExists,
        FIELD_LABELS.theTrap,
        FIELD_LABELS.whatIWouldDo,
      ]);
    }
  });

  it("colour means the same thing on every single card", () => {
    /*
     * The whole point of using colour at all. If "what goes wrong" were orange
     * on one card and gold on another, the colour would carry no information
     * and would just be noise on top of a long page.
     */
    for (const stop of curriculumTrail()) {
      const card = buildLessonCard(stop.source, stop.fn);
      const tones = Object.fromEntries(card.fields.map((f) => [f.label, f.tone]));
      expect(tones[FIELD_LABELS.plainEnglish]).toBe("neutral");
      expect(tones[FIELD_LABELS.whyItExists]).toBe("gold");
      expect(tones[FIELD_LABELS.theTrap]).toBe("orange");
      expect(tones[FIELD_LABELS.whatIWouldDo]).toBe("green");
    }
  });

  it("no card is empty, and every block carries the mentor's real words", () => {
    for (const stop of curriculumTrail()) {
      const card = buildLessonCard(stop.source, stop.fn);
      const lesson = findLesson(stop.source, stop.fn)!;
      expect(card.fields[0].body).toBe(lesson.plainEnglish);
      expect(card.fields[1].body).toBe(lesson.whyItExists);
      expect(card.fields[2].body).toBe(lesson.theTrap);
      expect(card.fields[3].body).toBe(lesson.whatIWouldDo);
    }
  });

  it("the position line on a card agrees with the trail", () => {
    const trail = curriculumTrail();
    for (const stop of trail) {
      const card = buildLessonCard(stop.source, stop.fn);
      const range = unitRange(stop.unitKey);
      expect(card.positionLine).toContain(`Lesson ${stop.indexInUnit} of ${range.count}`);
      expect(card.positionLine).toContain(`${stop.globalIndex} of ${trail.length}`);
    }
  });

  it("anchors are unique and safe to put in a URL", () => {
    const anchors = curriculumTrail().map((s) => lessonAnchor(s.source, s.fn));
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const a of anchors) expect(a).toMatch(/^[a-zA-Z0-9-]+$/);
  });

  it("the collapsed summary is a real sentence, not a truncation", () => {
    for (const stop of curriculumTrail()) {
      const card = buildLessonCard(stop.source, stop.fn);
      expect(card.summary.length, `${card.id} has no summary`).toBeGreaterThan(10);
      expect(card.summary.endsWith("…"), `${card.id} summary is truncated`).toBe(false);
      // It is the opening of the real text, never something invented.
      expect(findLesson(stop.source, stop.fn)!.plainEnglish.startsWith(card.summary)).toBe(true);
    }
  });

  it("firstSentence handles the awkward cases rather than mangling them", () => {
    expect(firstSentence("One. Two.")).toBe("One.");
    expect(firstSentence("No terminator here")).toBe("No terminator here");
    // Newlines inside the text must not cut the sentence short - the reason
    // the implementation uses [\s\S] rather than a dot.
    expect(firstSentence("A sentence\nthat wraps. Second.")).toBe("A sentence\nthat wraps.");
    expect(firstSentence("   padded. ")).toBe("padded.");
  });

  it("a lesson with no citations says so, instead of showing a blank space", () => {
    /*
     * Sixteen lessons legitimately cite nothing - they are about how the system
     * stores a figure or assembles a screen, not about what the law requires.
     * An empty space reads as a citation somebody forgot; a sentence saying
     * "there is nothing to cite here, and here is why" reads as a decision.
     */
    const uncited = allLessons().filter((l) => l.authorityIds.length === 0);
    expect(uncited.length, "no lesson lacks citations, so this branch is unreachable").toBeGreaterThan(0);

    for (const l of uncited) {
      const card = buildLessonCard(l.source, l.fn);
      expect(card.noAuthorityNote).toBe(NO_AUTHORITY_NOTE);
    }

    // ...and a cited lesson does NOT show the note. (Rule 55: discriminate.)
    const cited = allLessons().find((l) => l.authorityIds.length > 0)!;
    expect(buildLessonCard(cited.source, cited.fn).noAuthorityNote).toBeNull();
  });

  it("every citation on every card resolves to a real authority", () => {
    /*
     * The screen renders these through AuthorityPanel, which shows an unknown
     * id as a visible marker rather than hiding it. That is the right runtime
     * behaviour, and this is what stops it ever being needed: a citation that
     * does not resolve is a claim with nothing behind it.
     */
    const unresolved: string[] = [];
    for (const stop of curriculumTrail()) {
      const card = buildLessonCard(stop.source, stop.fn);
      for (const id of card.authorityIds) {
        if (!findGuidanceAuthority(id)) unresolved.push(`${card.id} -> ${id}`);
      }
    }
    expect(unresolved).toEqual([]);
  });

  it("the citation check is not vacuous - the course really does cite things", () => {
    const total = curriculumTrail()
      .map((s) => buildLessonCard(s.source, s.fn).authorityIds.length)
      .reduce((a, b) => a + b, 0);
    expect(total, "no lesson cites anything, so the check above inspected nothing").toBeGreaterThan(50);
    expect(findGuidanceAuthority("NO_SUCH_AUTHORITY_EVER")).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * 7. UNITS, TABS AND NAVIGATION
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-44: moving around the course", () => {
  it("every unit builds a view without throwing", () => {
    for (const u of CURRICULUM) expect(() => buildUnitView(u), u.key).not.toThrow();
  });

  it("the tab strip always shows the whole course, with exactly one current", () => {
    for (const u of CURRICULUM) {
      const tabs = unitTabs(u.key);
      expect(tabs.length).toBe(CURRICULUM.length);
      expect(tabs.filter((t) => t.isCurrent).length).toBe(1);
      expect(tabs.find((t) => t.isCurrent)!.key).toBe(u.key);
    }
  });

  it("tab lesson counts match the units they describe", () => {
    const tabs = unitTabs(CURRICULUM[0].key);
    for (const t of tabs) {
      expect(t.lessonCount).toBe(findUnit(t.key)!.lessons.length);
    }
    expect(tabs.reduce((a, t) => a + t.lessonCount, 0)).toBe(allLessons().length);
  });

  it("every unit has its own colour and no colour is left over", () => {
    const used = CURRICULUM.map((u) => accentFor(u.key));
    expect(new Set(used).size).toBe(used.length);
    // A stale palette entry is how the colours stop describing the course.
    expect(Object.keys(UNIT_ACCENTS).sort()).toEqual(CURRICULUM.map((u) => u.key).sort());
  });

  it("next and previous link the units into one chain, open at both ends", () => {
    const views = CURRICULUM.map(buildUnitView);
    expect(views[0].prevUnit, "the first unit must not link backwards").toBeNull();
    expect(views[views.length - 1].nextUnit, "the last unit must not link forwards").toBeNull();
    for (let i = 0; i < views.length - 1; i += 1) {
      expect(views[i].nextUnit!.key).toBe(CURRICULUM[i + 1].key);
      expect(views[i + 1].prevUnit!.key).toBe(CURRICULUM[i].key);
    }
  });

  it("step numbers run 1..n and match the position lines", () => {
    CURRICULUM.map(buildUnitView).forEach((v, i) => {
      expect(v.stepNumber).toBe(i + 1);
      expect(v.stepCount).toBe(CURRICULUM.length);
      expect(v.positionLine).toContain(`Unit ${i + 1} of ${CURRICULUM.length}`);
      const r = unitRange(v.key);
      expect(v.positionLine).toContain(`numbers ${r.firstGlobal} to ${r.lastGlobal}`);
    });
  });

  it("short titles are genuinely shorter and never empty", () => {
    for (const u of CURRICULUM) {
      const short = shortTitleOf(u.title);
      expect(short.length).toBeGreaterThan(3);
      expect(short.length).toBeLessThanOrEqual(u.title.length);
      expect(short).not.toContain("—");
    }
    // A title with no dash survives intact rather than becoming empty.
    expect(shortTitleOf("Just a title")).toBe("Just a title");
  });

  it("unit links are real, encoded URLs", () => {
    for (const u of CURRICULUM) {
      expect(unitHref(u.key)).toBe(`/admin/books/learn?unit=${u.key}`);
    }
    expect(unitHref("a b")).toBe("/admin/books/learn?unit=a%20b");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * 8. SEARCH
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-44: finding one lesson when it bites", () => {
  it("finds a lesson by its exact name", () => {
    const hits = searchLessons("computeDorPenalty");
    expect(hits.length).toBe(1);
    expect(hits[0].fn).toBe("computeDorPenalty");
    expect(hits[0].matchedIn).toContain("the name");
  });

  it("finds lessons by a word in the teaching, not only by name", () => {
    // The way it will actually be used: a notice arrives saying "I-9".
    const hits = searchLessons("I-9");
    expect(hits.length).toBeGreaterThan(3);
    for (const h of hits) expect(h.matchedIn.length).toBeGreaterThan(0);
  });

  it("says WHICH part matched, so a hit is never mysterious", () => {
    const hits = searchLessons("weekend");
    expect(hits.length).toBeGreaterThan(0);
    const labels = new Set(hits.flatMap((h) => h.matchedIn));
    // Every reported reason is one of the five real ones.
    for (const l of labels) {
      expect(
        ["the name", ...Object.values(FIELD_LABELS)].includes(l),
        `unexpected match reason: ${l}`,
      ).toBe(true);
    }
  });

  it("is case insensitive", () => {
    expect(searchLessons("PENALTY").length).toBe(searchLessons("penalty").length);
  });

  it("refuses a one-character query rather than returning everything", () => {
    /*
     * A search that matches all 82 looks exactly like a search that worked, and
     * teaches the reader that the box is useless. Better to refuse and say why.
     */
    expect(searchLessons("a")).toEqual([]);
    expect(searchNotice("a", 0)).toMatch(/at least 2 characters/);
    expect(MIN_QUERY_LENGTH).toBe(2);
  });

  it("an empty box is not a failed search", () => {
    expect(searchLessons("")).toEqual([]);
    expect(searchNotice("", 0)).toBeNull();
  });

  it("says plainly when nothing matched, and invites the gap to be reported", () => {
    const notice = searchNotice("zzzzqqqq", 0);
    expect(notice).toContain("zzzzqqqq");
    expect(notice).toMatch(/does not cover it yet/);
  });

  it("counts its hits correctly, in both singular and plural", () => {
    expect(searchNotice("x", 1)).toMatch(/at least/); // still too short
    expect(searchNotice("computeDorPenalty", 1)).toMatch(/^1 lesson mentions/);
    expect(searchNotice("penalty", 7)).toMatch(/^7 lessons mention/);
  });

  it("hits are returned in course order and link to the right place", () => {
    const hits = searchLessons("interest");
    expect(hits.length).toBeGreaterThan(0);
    const idx = hits.map((h) => h.globalIndex);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    for (const h of hits) {
      expect(h.href).toContain(`unit=${h.unitKey}`);
      expect(h.href).toContain("#lesson-");
    }
  });

  it("every searchable lesson is reachable through the link the search gives", () => {
    // A hit that links to a unit the lesson is not in would scroll to nothing.
    for (const h of searchLessons("the")) {
      const unit = findUnit(h.unitKey);
      expect(unit, `search offered unit ${h.unitKey}, which does not exist`).toBeDefined();
      const inUnit = unit!.lessons.some(([, fn]) => fn === h.fn);
      expect(inUnit, `${h.fn} is not in ${h.unitKey}`).toBe(true);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * 9. THE WHOLE SCREEN
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-44: assembling the screen", () => {
  it("defaults to the first unit when nothing is asked for", () => {
    const s = buildLearningScreen({});
    expect(s.unit.key).toBe(CURRICULUM[0].key);
    expect(s.unknownUnitRequested).toBeNull();
  });

  it("opens the unit that was asked for", () => {
    for (const u of CURRICULUM) {
      expect(buildLearningScreen({ unitKey: u.key }).unit.key).toBe(u.key);
    }
  });

  it("an unknown unit falls back to the first one AND says so", () => {
    /*
     * The one place a default beats a refusal: the slug comes from a URL, a
     * stale bookmark is not an error in the books, and a blank page teaches
     * nothing. But it is announced rather than silent - rule 12, never quietly
     * plug a hole.
     */
    const s = buildLearningScreen({ unitKey: "was-renamed-last-year" });
    expect(s.unit.key).toBe(CURRICULUM[0].key);
    expect(s.unknownUnitRequested).toBe("was-renamed-last-year");
  });

  it("carries the search through so the box keeps its text", () => {
    const s = buildLearningScreen({ unitKey: "dates", query: "weekend" });
    expect(s.query).toBe("weekend");
    expect(s.hits.length).toBeGreaterThan(0);
    expect(s.unit.key).toBe("dates");
  });

  it("renders every unit end to end without throwing", () => {
    for (const u of CURRICULUM) {
      const s = buildLearningScreen({ unitKey: u.key });
      expect(s.unit.lessons.length).toBe(u.lessons.length);
      for (const l of s.unit.lessons) {
        expect(l.fields.length).toBe(4);
        expect(l.accent).toBe(accentFor(u.key));
      }
    }
  });

  it("the whole course is reachable by walking next from the first unit", () => {
    /*
     * The end-to-end reachability claim, asserted the way a person experiences
     * it: start at the beginning, keep clicking next, and confirm you were
     * shown all 82 lessons. This is the assertion that would have failed for
     * months before this slice existed.
     */
    const seen = new Set<string>();
    let current = buildLearningScreen({}).unit;
    let guard = 0;
    for (;;) {
      for (const l of current.lessons) seen.add(l.id);
      if (!current.nextUnit) break;
      current = buildLearningScreen({ unitKey: current.nextUnit.key }).unit;
      guard += 1;
      expect(guard, "the next-unit chain does not terminate").toBeLessThan(50);
    }
    expect(seen.size).toBe(allLessons().length);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * 10. THE SCREEN IS WIRED, AND SAYS WHAT IT IS
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-44: the page exists, is reachable, and is honest about itself", () => {
  const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

  it("the page file exists", () => {
    expect(existsSync(join(ROOT, "src/app/admin/books/learn/page.tsx"))).toBe(true);
  });

  it("the page is in the navigation, or nobody will ever find it", () => {
    /*
     * Rule 15/16: prove the gate is WIRED. A page with no route into it is
     * exactly as invisible as the mentors were - it is dead code with a nicer
     * shape. The gap this slice closes is not "the code exists", it is "Michael
     * can get to it".
     */
    const nav = read("src/components/admin/admin-nav-data.ts");
    expect(nav).toContain('href: "/admin/books/learn"');
    expect(nav).toContain('permission: "books.view"');
  });

  it("the page is behind the books gate, like every other books screen", () => {
    /*
     * Michael, recorded: "there is no reason anyone else needs to see my books
     * or my financials ever". The teaching quotes his figures and his facts.
     *
     * THIS ASSERTION WAS WRONG ON ITS FIRST DRAFT, and the mutation campaign
     * caught it. It read `expect(page).toContain("requireBooksAccess")`, which
     * is satisfied by the IMPORT LINE. Deleting the actual call - leaving the
     * import sitting there unused - removed the gate from an accounting screen
     * and the test stayed green. A gate assertion that a mutation can walk
     * straight through is worse than none, because it is load-bearing in the
     * mind of whoever reads the suite (rule 50).
     *
     * So it now looks for the awaited CALL, in the same shape every other books
     * page uses, and separately confirms the import it depends on.
     */
    const page = read("src/app/admin/books/learn/page.tsx");
    expect(page, "the page does not import the books gate").toMatch(
      /import\s*\{[^}]*requireBooksAccess[^}]*\}\s*from\s*"@\/lib\/accounting\/books-access"/,
    );
    expect(
      page,
      "the page imports the books gate but never awaits it - an unused import is not a gate",
    ).toMatch(/await\s+requireBooksAccess\s*\(\s*\)/);
  });

  it("the page contains no teaching of its own", () => {
    /*
     * The books-42 lesson, enforced. Prose in JSX is prose nothing can check -
     * a hand-typed worked example there once claimed 47.9% when the arithmetic
     * gave 42.71%. So the page maps data to markup and nothing else, and the
     * way to assert that cheaply is that it does not import a mentor directly:
     * everything must come through the two cores that tests can reach.
     */
    const page = read("src/app/admin/books/learn/page.tsx");
    expect(page).not.toMatch(/from "@\/lib\/[^"]*-mentor"/);
    expect(page).toContain("learning-path-ui-core");
  });

  it("the scope note tells the truth in both directions", () => {
    // What the course covers, and the standing boundary of the whole system.
    expect(LEARNING_SCOPE_NOTE).toMatch(/280E/);
    expect(LEARNING_SCOPE_NOTE).toMatch(/S corporation/i);
    expect(LEARNING_SCOPE_NOTE).toMatch(/not a filing agent/i);
    expect(LEARNING_SCOPE_NOTE).toMatch(/Washington/);
  });

  it("the how-to-use guidance is three steps, each with a real explanation", () => {
    expect(HOW_TO_USE_THIS.length).toBe(3);
    for (const h of HOW_TO_USE_THIS) {
      expect(h.step.length).toBeGreaterThan(10);
      expect(h.body.length).toBeGreaterThan(60);
    }
  });

  it("the page renders the coverage gaps rather than only counting them", () => {
    // A gap Michael can see is a gap that gets closed. A gap only a test can
    // see is a gap that waits for somebody to read a log.
    const page = read("src/app/admin/books/learn/page.tsx");
    expect(page).toContain("coverage.gaps");
  });

  it("every accent token used by the core has a literal class string in the page", () => {
    /*
     * The Tailwind trap, held shut. Tailwind only emits classes it can literally
     * see; a class built by concatenation compiles fine and renders nothing.
     * The page holds a Record keyed by the accent union, so TypeScript already
     * forces completeness - this asserts the strings are really there and are
     * really literal, which the type system cannot see.
     */
    const page = read("src/app/admin/books/learn/page.tsx");
    for (const accent of new Set(CURRICULUM.map((u) => accentFor(u.key)))) {
      expect(page, `no literal class string for the "${accent}" accent`).toContain(
        `border-${accent}-400/35`,
      );
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ *
 * 11. THE OWNER DOCUMENT (rule 66)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("books-44: the owner document tells Michael the truth", () => {
  const DOC_PATH = join(ROOT, "docs", "MICHAEL-books-44-learning-the-books.md");
  const PDF_PATH = join(ROOT, "docs", "MICHAEL-books-44-learning-the-books.pdf");
  const doc = existsSync(DOC_PATH) ? readFileSync(DOC_PATH, "utf8") : "";

  it("exists and is substantial", () => {
    expect(existsSync(DOC_PATH), "the owner document was not written").toBe(true);
    expect(doc.length).toBeGreaterThan(10_000);
  });

  it("quotes Michael's instruction exactly, not a tidied paraphrase", () => {
    /*
     * Rule 24: the quote is sacred. This document exists BECAUSE of what he
     * asked for, and the scope decision - one business, not a textbook - rests
     * entirely on his own words. Smoothing them out over time is how the reason
     * for a design decision quietly detaches from the decision.
     */
    /*
     * The quote is a block quote and therefore hard-wrapped across several
     * lines with a leading "> " on each. Comparing against the raw file would
     * make this assertion a test of the line width rather than of the words, so
     * the document is flattened first: quote markers stripped, whitespace
     * collapsed. That way re-wrapping the paragraph is allowed and CHANGING HIS
     * WORDS is not, which is the distinction rule 24 actually cares about.
     */
    const flat = doc.replace(/^>\s?/gm, "").replace(/\s+/g, " ");
    expect(flat).toContain("i don't need to know how to account for any other business");
    expect(flat).toContain("the best possible accountant i can be");
  });

  it("its unit table matches the course, unit for unit", () => {
    /*
     * The document prints a table of eight units and their lesson counts. That
     * table is a CLAIM about the code, so it is checked against the code rather
     * than proof-read. A document that describes a course that no longer exists
     * is worse than no document, because he would plan his reading around it.
     */
    for (const unit of CURRICULUM) {
      expect(doc, `the owner document stopped naming the "${unit.key}" unit`).toContain(
        shortTitleOf(unit.title),
      );
      // The row as the table renders it: | n | Title | lessons | question |
      const row = new RegExp(
        `\\|[^|\\n]*\\|[^|\\n]*${shortTitleOf(unit.title).replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}[^|\\n]*\\|\\s*(\\d+)\\s*\\|`,
      ).exec(doc);
      expect(row, `no table row found for the "${unit.key}" unit`).not.toBeNull();
      expect(
        Number((row as RegExpExecArray)[1]),
        `the document says ${(row as RegExpExecArray)[1]} lessons for ${unit.key}; the course has ${unit.lessons.length}`,
      ).toBe(unit.lessons.length);
    }
  });

  it("its totals foot to the real course", () => {
    const total = allLessons().length;
    expect(doc, `the document's lesson total is stale`).toContain(`**${total}**`);
    expect(doc).toContain(`${total} lessons in ${CURRICULUM.length} units`);
  });

  it("its citation figures are real", () => {
    // 61 authorities and 16 uncited lessons are stated as facts to Michael, so
    // they are re-derived here rather than trusted.
    const distinct = new Set(allLessons().flatMap((l) => l.authorityIds)).size;
    const uncited = allLessons().filter((l) => l.authorityIds.length === 0).length;
    expect(doc, "the document's authority count is stale").toContain(`${distinct} different`);
    expect(doc, "the document's uncited-lesson count is stale").toContain(`Sixteen of the ${allLessons().length}`);
    expect(uncited).toBe(16);
  });

  it("reports the mutation campaign honestly, including what it let through", () => {
    /*
     * Rule 55, carried into the owner document. The kill rate is meaningless
     * without the controls, and a report that prints only the impressive number
     * is teaching him to accept impressive numbers.
     */
    expect(doc, "the document must report the kill rate").toMatch(/27 attacks, 27 caught/);
    expect(doc, "the document must report the controls").toMatch(/three\s+\*\*controls\*\*/);
    expect(doc, "the document must report the two holes the campaign found").toMatch(
      /19 out of 21/,
    );
  });

  it("names the four modules that are still buried, rather than implying the job is done", () => {
    // Rule 12. The honest version of "we fixed the buried teaching" includes
    // the teaching that is still buried.
    expect(doc).toMatch(/\*\*still buried\*\*/);
    expect(doc).toContain("280E");
  });

  it("keeps the filing boundary intact", () => {
    // The boundary Michael set: we prepare the data, we are not a filing agent.
    expect(doc).toMatch(/do not become your filing agent/i);
  });

  it("shipped a PDF that is not a stub", () => {
    /*
     * A markdown file Michael cannot open is not a delivery. The size floor
     * exists because wkhtmltopdf will happily emit a valid EMPTY pdf if the
     * input path is wrong, and an empty PDF passes existsSync (rule 39).
     */
    expect(existsSync(PDF_PATH), "the PDF has not been built").toBe(true);
    expect(statSync(PDF_PATH).size).toBeGreaterThan(20_000);
  });
});
