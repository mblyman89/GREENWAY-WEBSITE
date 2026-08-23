/**
 * src/lib/accounting/learning-path-ui-core.ts   (books-44, slice C)
 *
 * EVERY DECISION THE LEARNING SCREEN MAKES, IN A PLACE A TEST CAN REACH.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS SEPARATELY FROM THE PAGE
 * ────────────────────────────────────────────────────────────────────────────
 * `tests/compliance` cannot render a server component. So a rule expressed in
 * JSX is a rule nothing checks, and the books-42 slice proved what that costs:
 * a worked example hand-typed into markup claimed a gross margin of 47.9% when
 * the arithmetic gave 42.71%, and the only reason anybody found out is that a
 * test recomputed it from the inputs.
 *
 * Therefore: which lesson is lesson 24 of 82, which colour a unit wears, what
 * the position line says, what the search box matched on, whether the coverage
 * banner is reassuring or alarming - all of it is decided here, returned as
 * plain data, and asserted by `tests/compliance/learning-path.test.ts`. The
 * page maps data to markup and does nothing else.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT MICHAEL ASKED FOR, AND WHAT THAT MEANT IN PRACTICE
 * ────────────────────────────────────────────────────────────────────────────
 * Recorded verbatim (standing rule 24):
 *
 *   "make the teaching, mentorship, education to be easy to read, understand
 *    and use as a tool. i want to be empowered to use these lessons and
 *    guidance to help make me the best possible accountant i can be."
 *
 *   "i don't need to know how to account for any other business... i need to
 *    know everything there is to know about accounting for greenway."
 *
 * And earlier, twice: "I learn best visually", and the verbatim panels are
 * "hard to digest as there is a wall of words and color".
 *
 * Those two pull in opposite directions - more teaching, but less wall - and
 * the resolution is the reason this file has as much structure as it does:
 *
 *   1. NOTHING IS SHOWN ALL AT ONCE. One unit at a time, one lesson at a time,
 *      each lesson collapsed until it is opened. Eighty-two lessons on one
 *      screen is the wall he already told us he cannot read.
 *   2. COLOUR CARRIES MEANING, NOT DECORATION. Each unit has ONE accent, and
 *      within a lesson the tone is fixed by what the paragraph IS - the trap is
 *      always orange, the recommendation is always green - so after two lessons
 *      the colour is telling him where to look before he has read a word.
 *   3. POSITION IS ALWAYS VISIBLE. "Lesson 24 of 82, unit 3 of 8." Knowing how
 *      much is left is the difference between studying and drowning.
 *   4. EVERY NUMBER IS DERIVED. There is no hard-coded 82 anywhere in this file
 *      or the page. If a mentor gains a lesson tomorrow, the counters move and
 *      the coverage banner names the one nobody placed.
 *
 * PURE. No `node:fs`, no database, no `server-only`. Safe in a browser bundle.
 */

import {
  CURRICULUM,
  SOURCE_LABELS,
  allLessons,
  curriculumCoverage,
  findLesson,
  findUnit,
  lessonKey,
  unitLessons,
  type CurriculumUnit,
  type CurriculumCoverage,
  type LessonSourceKey,
  type PlacedLesson,
} from "./learning-path-core";

/* ══════════════════════════════════════════════════════════════════════════ *
 * COLOUR, AND WHAT IT IS ALLOWED TO MEAN
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The eight unit accents.
 *
 * A TOKEN, NOT A CLASS STRING, and that is deliberate. Tailwind only ships the
 * classes it can see written out literally, so a class built by string
 * concatenation compiles fine, renders nothing, and leaves an unstyled page
 * that looks like a rendering bug rather than a build bug. The page holds a
 * `Record<UnitAccent, ...>` of literal class strings, which TypeScript forces
 * to cover every token in this union - so adding a ninth unit here fails the
 * BUILD rather than shipping a colourless card.
 */
export type UnitAccent =
  | "slate"
  | "sky"
  | "emerald"
  | "violet"
  | "cyan"
  | "indigo"
  | "amber"
  | "rose";

/**
 * Which accent each unit wears.
 *
 * The order is not random. It walks cool to warm across the eight units, so the
 * palette itself carries the arc of the course: the plumbing units at the start
 * are quiet greys and blues, the working units in the middle are greens and
 * violets, and the penalty unit at the end is rose. Michael should be able to
 * tell roughly where he is from the corner of his eye.
 */
export const UNIT_ACCENTS: Readonly<Record<string, UnitAccent>> = {
  money: "slate",
  dates: "sky",
  hiring: "emerald",
  "pay-run": "violet",
  checking: "cyan",
  "month-end": "indigo",
  "year-end": "amber",
  "when-late": "rose",
};

/**
 * The accent for a unit, or a refusal.
 *
 * RETURNS A REFUSAL RATHER THAN A DEFAULT (standing rule 27). Falling back to
 * "slate" for an unknown unit would give two units the same colour, which
 * silently destroys the one job colour has on this screen. Better to fail
 * loudly in a test than to teach a false grouping.
 */
export function accentFor(unitKey: string): UnitAccent {
  const a = UNIT_ACCENTS[unitKey];
  if (!a) {
    throw new Error(
      `NO ACCENT FOR CURRICULUM UNIT "${unitKey}". Every unit must have its own colour, because ` +
        `on this screen colour is how the reader knows which unit he is in. Defaulting would ` +
        `give two units the same accent and quietly destroy that.`,
    );
  }
  return a;
}

/** Tones a single paragraph of a lesson can carry. Fixed by MEANING, not taste. */
export type FieldTone = "neutral" | "gold" | "orange" | "green" | "quote";

/* ══════════════════════════════════════════════════════════════════════════ *
 * THE TRAIL: WHERE EVERY LESSON SITS IN THE WHOLE COURSE
 * ══════════════════════════════════════════════════════════════════════════ */

/** One lesson's position in the course, counted rather than declared. */
export type TrailStop = {
  readonly unitKey: string;
  readonly unitTitle: string;
  readonly source: LessonSourceKey;
  readonly fn: string;
  /** 1-based position across the whole curriculum. */
  readonly globalIndex: number;
  /** 1-based position within its own unit. */
  readonly indexInUnit: number;
};

/**
 * Every lesson, in teaching order, numbered.
 *
 * This is the spine of the screen: the "lesson 24 of 82" line, the previous and
 * next links, and the unit ranges are all read off it, so they cannot disagree
 * with each other. Three separate counters would eventually drift; one counter
 * read three ways cannot.
 */
export function curriculumTrail(
  units: readonly CurriculumUnit[] = CURRICULUM,
): readonly TrailStop[] {
  const out: TrailStop[] = [];
  let global = 0;
  for (const unit of units) {
    let inUnit = 0;
    for (const [source, fn] of unit.lessons) {
      global += 1;
      inUnit += 1;
      out.push({
        unitKey: unit.key,
        unitTitle: unit.title,
        source,
        fn,
        globalIndex: global,
        indexInUnit: inUnit,
      });
    }
  }
  return out;
}

/** Where one unit's lessons start and stop in the overall numbering. */
export type UnitRange = {
  readonly firstGlobal: number;
  readonly lastGlobal: number;
  readonly count: number;
};

/** The span of course positions a unit occupies. Refuses on an empty unit. */
export function unitRange(unitKey: string): UnitRange {
  const stops = curriculumTrail().filter((s) => s.unitKey === unitKey);
  if (stops.length === 0) {
    throw new Error(
      `UNIT "${unitKey}" HAS NO LESSONS, so it has no position in the course. An empty unit ` +
        `renders a heading over a blank space, which reads as "there is nothing to know here".`,
    );
  }
  return {
    firstGlobal: stops[0].globalIndex,
    lastGlobal: stops[stops.length - 1].globalIndex,
    count: stops.length,
  };
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * ONE LESSON, READY TO RENDER
 * ══════════════════════════════════════════════════════════════════════════ */

/** One labelled paragraph inside a lesson card. */
export type LessonField = {
  readonly label: string;
  readonly body: string;
  readonly tone: FieldTone;
};

/** One lesson, fully prepared for the page. */
export type LessonCard = {
  /** `source:fn`. Unique across the course - see rule 3 in learning-path-core. */
  readonly id: string;
  /** URL fragment, safe for an `id` attribute and a `#` link. */
  readonly anchor: string;
  readonly fn: string;
  readonly source: LessonSourceKey;
  readonly sourceLabel: string;
  readonly unitKey: string;
  readonly accent: UnitAccent;
  readonly globalIndex: number;
  readonly indexInUnit: number;
  /** "Lesson 4 of 22 in this unit · 24 of 82 overall" */
  readonly positionLine: string;
  /** The one-line summary shown while the card is collapsed. */
  readonly summary: string;
  /** The four teaching paragraphs, in the order they should be read. */
  readonly fields: readonly LessonField[];
  /** Citation ids, for the authority panel. May legitimately be empty. */
  readonly authorityIds: readonly string[];
  /** Shown when a lesson cites nothing, instead of an empty space. */
  readonly noAuthorityNote: string | null;
};

/**
 * The four labels, and why each is worded the way it is.
 *
 * These are questions, not nouns. "The trap" is a filing-cabinet label; "What
 * goes wrong here" is a sentence a person can answer, and a reader who can
 * answer the heading is a reader who is actually studying rather than skimming.
 */
export const FIELD_LABELS = {
  plainEnglish: "What it does",
  whyItExists: "Why this exists at all",
  theTrap: "What goes wrong here",
  whatIWouldDo: "What I would do",
} as const;

/**
 * Shown on a lesson with no citations, rather than leaving a silent gap.
 *
 * Sixteen of the lessons cite nothing, and every one of them is about how this
 * system does its own housekeeping - how a number is stored, how a screen is
 * assembled, how a wrong entry is reported back. That is an engineering
 * decision, not a legal one, and there is no statute to point at. Saying so is
 * better than an empty space, which reads as a citation somebody forgot.
 */
export const NO_AUTHORITY_NOTE =
  "This lesson cites no outside authority, and that is correct rather than missing. It is about " +
  "how this system does its own housekeeping - how a figure is stored, how a screen is put " +
  "together, how a bad entry is reported back to you - so there is no statute to point at. " +
  "Inventing a citation to fill the space would be far worse than leaving it honestly empty.";

/** A stable, URL-safe anchor for one lesson. */
export function lessonAnchor(source: LessonSourceKey, fn: string): string {
  return `lesson-${source}-${fn}`.replace(/[^a-zA-Z0-9-]/g, "-");
}

/** The position sentence for a lesson. Derived from the trail, never typed. */
export function positionLine(stop: TrailStop, unitCount: number, totalCount: number): string {
  return (
    `Lesson ${stop.indexInUnit} of ${unitCount} in this unit · ` +
    `${stop.globalIndex} of ${totalCount} in the whole course`
  );
}

/**
 * The first sentence of a lesson, for the collapsed card.
 *
 * Splits on a full stop followed by whitespace so decimals and section numbers
 * survive. Falls back to the whole text when there is no sentence break, which
 * is correct: showing a slightly long summary beats showing nothing.
 *
 * WRITTEN AS `[\s\S]` RATHER THAN THE `s` FLAG ON PURPOSE. This project's
 * TypeScript target predates `dotAll`, so `/./s` is a compile error - and the
 * lesson text really does contain newlines, so a plain `.` would stop at the
 * first one and silently truncate a summary mid-thought.
 */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const m = /^([\s\S]*?[.!?])(\s|$)/.exec(trimmed);
  return (m ? m[1] : trimmed).trim();
}

/** Build one lesson card. Throws if the lesson is not in the curriculum. */
export function buildLessonCard(source: LessonSourceKey, fn: string): LessonCard {
  const lesson = findLesson(source, fn);
  if (!lesson) {
    throw new Error(
      `NO SUCH LESSON: ${lessonKey(source, fn)}. The curriculum names it but no mentor module ` +
        `exports it.`,
    );
  }
  const trail = curriculumTrail();
  const stop = trail.find((s) => s.source === source && s.fn === fn);
  if (!stop) {
    throw new Error(
      `LESSON ${lessonKey(source, fn)} EXISTS BUT IS NOT PLACED IN ANY UNIT, so it has no ` +
        `position in the course and cannot be rendered as part of it.`,
    );
  }
  const range = unitRange(stop.unitKey);

  return {
    id: lessonKey(source, fn),
    anchor: lessonAnchor(source, fn),
    fn: lesson.fn,
    source,
    sourceLabel: SOURCE_LABELS[source],
    unitKey: stop.unitKey,
    accent: accentFor(stop.unitKey),
    globalIndex: stop.globalIndex,
    indexInUnit: stop.indexInUnit,
    positionLine: positionLine(stop, range.count, trail.length),
    summary: firstSentence(lesson.plainEnglish),
    fields: [
      { label: FIELD_LABELS.plainEnglish, body: lesson.plainEnglish, tone: "neutral" },
      { label: FIELD_LABELS.whyItExists, body: lesson.whyItExists, tone: "gold" },
      { label: FIELD_LABELS.theTrap, body: lesson.theTrap, tone: "orange" },
      { label: FIELD_LABELS.whatIWouldDo, body: lesson.whatIWouldDo, tone: "green" },
    ],
    authorityIds: lesson.authorityIds,
    noAuthorityNote: lesson.authorityIds.length === 0 ? NO_AUTHORITY_NOTE : null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * ONE UNIT, READY TO RENDER
 * ══════════════════════════════════════════════════════════════════════════ */

/** A unit as it appears in the row of tabs across the top. */
export type UnitTab = {
  readonly key: string;
  readonly title: string;
  /** Short form for the tab itself. The full title is long by design. */
  readonly shortTitle: string;
  readonly accent: UnitAccent;
  /** 1-based. "Unit 3 of 8." */
  readonly stepNumber: number;
  readonly lessonCount: number;
  readonly isCurrent: boolean;
  readonly href: string;
};

/** A unit, opened. */
export type UnitView = {
  readonly key: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly theQuestion: string;
  readonly whenYouNeedIt: string;
  readonly whyHere: string;
  readonly theOneThing: string;
  readonly accent: UnitAccent;
  readonly stepNumber: number;
  readonly stepCount: number;
  /** "Unit 3 of 8 · 22 lessons · numbers 22 to 43 of the 82" */
  readonly positionLine: string;
  readonly lessons: readonly LessonCard[];
  /** Where to go next, or null at the end of the course. */
  readonly nextUnit: { readonly key: string; readonly title: string; readonly href: string } | null;
  readonly prevUnit: { readonly key: string; readonly title: string; readonly href: string } | null;
};

/**
 * The short title: everything before the em dash.
 *
 * The full titles are long on purpose - "Hiring someone — the paperwork before
 * the first cheque" tells you what the unit is FOR. But eight of those across
 * a tab strip is unreadable, so the tab takes the part before the dash and the
 * card keeps the whole thing. One source of truth, two lengths, no second title
 * field that somebody has to remember to keep in step.
 */
export function shortTitleOf(title: string): string {
  const cut = title.split("—")[0];
  return cut.trim() || title.trim();
}

/** The link to a unit. Kept here so the page never builds a URL by hand. */
export function unitHref(unitKey: string): string {
  return `/admin/books/learn?unit=${encodeURIComponent(unitKey)}`;
}

/** The tab strip. Always all eight, so the whole course stays visible. */
export function unitTabs(currentKey: string): readonly UnitTab[] {
  return CURRICULUM.map((u, i) => ({
    key: u.key,
    title: u.title,
    shortTitle: shortTitleOf(u.title),
    accent: accentFor(u.key),
    stepNumber: i + 1,
    lessonCount: u.lessons.length,
    isCurrent: u.key === currentKey,
    href: unitHref(u.key),
  }));
}

/** Build the opened unit. */
export function buildUnitView(unit: CurriculumUnit): UnitView {
  const index = CURRICULUM.findIndex((u) => u.key === unit.key);
  if (index < 0) {
    throw new Error(`UNIT "${unit.key}" IS NOT PART OF THE CURRICULUM.`);
  }
  const range = unitRange(unit.key);
  const next = CURRICULUM[index + 1];
  const prev = CURRICULUM[index - 1];

  return {
    key: unit.key,
    title: unit.title,
    shortTitle: shortTitleOf(unit.title),
    theQuestion: unit.theQuestion,
    whenYouNeedIt: unit.whenYouNeedIt,
    whyHere: unit.whyHere,
    theOneThing: unit.theOneThing,
    accent: accentFor(unit.key),
    stepNumber: index + 1,
    stepCount: CURRICULUM.length,
    positionLine:
      `Unit ${index + 1} of ${CURRICULUM.length} · ${range.count} ` +
      `${range.count === 1 ? "lesson" : "lessons"} · numbers ${range.firstGlobal} to ` +
      `${range.lastGlobal} of the ${curriculumTrail().length}`,
    lessons: unit.lessons.map(([source, fn]) => buildLessonCard(source, fn)),
    nextUnit: next
      ? { key: next.key, title: shortTitleOf(next.title), href: unitHref(next.key) }
      : null,
    prevUnit: prev
      ? { key: prev.key, title: shortTitleOf(prev.title), href: unitHref(prev.key) }
      : null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * SEARCH
 * ══════════════════════════════════════════════════════════════════════════ */

/** One search hit, with the reason it matched shown rather than implied. */
export type LessonHit = {
  readonly id: string;
  readonly fn: string;
  readonly unitKey: string;
  readonly unitTitle: string;
  readonly accent: UnitAccent;
  readonly globalIndex: number;
  readonly summary: string;
  /** Which parts of the lesson matched. Shown, so a hit is never mysterious. */
  readonly matchedIn: readonly string[];
  readonly href: string;
};

/** The shortest query that is allowed to search. Below this, everything hits. */
export const MIN_QUERY_LENGTH = 2;

/**
 * Search the whole course.
 *
 * REFUSES A ONE-CHARACTER QUERY rather than returning 82 results. A search that
 * matches everything looks like a search that worked, and it teaches the reader
 * that the box is useless. The screen says why it refused instead.
 *
 * Searches the function name and all four teaching paragraphs, and reports
 * WHICH of them matched, because "why did this come up?" is otherwise the first
 * question and there is no way to answer it from a list of names.
 */
export function searchLessons(rawQuery: string): readonly LessonHit[] {
  const q = rawQuery.trim().toLowerCase();
  if (q.length < MIN_QUERY_LENGTH) return [];

  const trail = curriculumTrail();
  const hits: LessonHit[] = [];

  for (const stop of trail) {
    const lesson = findLesson(stop.source, stop.fn);
    if (!lesson) continue;

    const matchedIn: string[] = [];
    if (lesson.fn.toLowerCase().includes(q)) matchedIn.push("the name");
    if (lesson.plainEnglish.toLowerCase().includes(q)) matchedIn.push(FIELD_LABELS.plainEnglish);
    if (lesson.whyItExists.toLowerCase().includes(q)) matchedIn.push(FIELD_LABELS.whyItExists);
    if (lesson.theTrap.toLowerCase().includes(q)) matchedIn.push(FIELD_LABELS.theTrap);
    if (lesson.whatIWouldDo.toLowerCase().includes(q)) matchedIn.push(FIELD_LABELS.whatIWouldDo);
    if (matchedIn.length === 0) continue;

    hits.push({
      id: lessonKey(stop.source, stop.fn),
      fn: lesson.fn,
      unitKey: stop.unitKey,
      unitTitle: shortTitleOf(stop.unitTitle),
      accent: accentFor(stop.unitKey),
      globalIndex: stop.globalIndex,
      summary: firstSentence(lesson.plainEnglish),
      matchedIn,
      href: `${unitHref(stop.unitKey)}#${lessonAnchor(stop.source, stop.fn)}`,
    });
  }

  return hits;
}

/** What the screen says about a search, including when it refused to run one. */
export function searchNotice(rawQuery: string, hitCount: number): string | null {
  const q = rawQuery.trim();
  if (q.length === 0) return null;
  if (q.length < MIN_QUERY_LENGTH) {
    return (
      `A single character would match nearly every lesson, which looks like a search that ` +
      `worked and is not one. Type at least ${MIN_QUERY_LENGTH} characters.`
    );
  }
  if (hitCount === 0) {
    return (
      `Nothing in the course mentions "${q}". That may mean this system does not cover it yet - ` +
      `which is worth telling me about, because a gap you can name is a gap I can close.`
    );
  }
  return `${hitCount} ${hitCount === 1 ? "lesson mentions" : "lessons mention"} "${q}".`;
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * THE COVERAGE BANNER
 * ══════════════════════════════════════════════════════════════════════════ */

/** The honest state of the curriculum, as a thing the page can render. */
export type CoverageBanner = {
  readonly tone: "green" | "orange";
  readonly headline: string;
  readonly body: string;
  /** Named gaps. Empty when everything is placed. */
  readonly gaps: readonly string[];
};

/**
 * The banner at the top of the screen.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY A FINISHED-LOOKING SCREEN STILL SHOWS ITS OWN COVERAGE
 * ────────────────────────────────────────────────────────────────────────────
 * Because the entire finding behind this slice was 82 finished lessons that no
 * screen rendered, and the reason nobody noticed for months is that nothing was
 * ever asked to count. A screen that quietly taught 60 of 82 would look busy,
 * full and complete. This banner is the thing that makes "complete" a claim
 * with a number behind it, and it recomputes that number every time the page
 * loads rather than trusting anything written down.
 */
export function coverageBanner(coverage: CurriculumCoverage = curriculumCoverage()): CoverageBanner {
  const gaps = [...coverage.dangling, ...coverage.unplaced];

  if (coverage.dangling.length > 0) {
    return {
      tone: "orange",
      headline: `${coverage.dangling.length} lesson${coverage.dangling.length === 1 ? "" : "s"} in the plan no longer exist`,
      body:
        `The course names ${coverage.dangling.length} lesson${coverage.dangling.length === 1 ? " that has" : "s that have"} ` +
        `been renamed or removed in the code. Those units are rendering short, and this line is ` +
        `here so that shows up as a problem instead of as a quiet gap.`,
      gaps,
    };
  }

  if (coverage.unplaced.length > 0) {
    return {
      tone: "orange",
      headline: `${coverage.unplaced.length} of ${coverage.totalLessons} lessons are not in the course yet`,
      body:
        `Every lesson this system contains should appear somewhere in the ${coverage.unitCount} ` +
        `units. These are written and tested but nothing shows them, which is exactly the ` +
        `problem this screen was built to end. They are named here rather than hidden.`,
      gaps,
    };
  }

  return {
    tone: "green",
    headline: `All ${coverage.totalLessons} lessons are in the course`,
    body:
      `Counted just now, not written down: the six teaching modules contain ` +
      `${coverage.totalLessons} lessons, and all ${coverage.placedLessons} of them appear in ` +
      `exactly one of the ${coverage.unitCount} units. Nothing is stranded and nothing is ` +
      `taught twice.`,
    gaps,
  };
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * SCOPE: WHAT THIS COURSE IS AND IS NOT
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The scope note, shown once at the top.
 *
 * States the boundary in the two directions that matter. Michael asked to be
 * taught accounting for GREENWAY and nothing else, so the note says so plainly
 * rather than letting him wonder what has been left out; and the whole system's
 * standing boundary is that it prepares figures and is not a filing agent, so
 * that is said here too rather than only on the forms screens.
 */
export const LEARNING_SCOPE_NOTE =
  "This is not a general accounting course and it is not trying to be. Every lesson in it is " +
  "about a decision this business actually has to make - a Washington cannabis retailer taxed " +
  "as an S corporation, with staff on a biweekly payroll and §280E sitting on top of " +
  "everything. Nothing here covers industries you will never operate in or company sizes you " +
  "will never be. It also prepares and explains figures; it does not transmit anything to any " +
  "agency, and it is not a filing agent.";

/** How to use the screen, said once, in three short lines rather than a wall. */
export const HOW_TO_USE_THIS: readonly { readonly step: string; readonly body: string }[] = [
  {
    step: "Take the units in order, the first time",
    body:
      "They follow the order the work actually happens in the year, not the order a textbook " +
      "would use. Each unit says why it sits where it does, and later units quietly assume the " +
      "earlier ones.",
  },
  {
    step: "Read the coloured blocks, and trust the colours",
    body:
      "Inside every lesson the colour is fixed by meaning: gold is why the thing exists at all, " +
      "orange is what goes wrong here, green is what I would actually do. After two lessons you " +
      "will be finding the orange block first, which is the right instinct.",
  },
  {
    step: "Come back to one lesson when it bites",
    body:
      "Search finds any lesson by name or by any word in it. The day a notice arrives or a " +
      "figure will not tie, the relevant lesson is two keystrokes away - that is the point of it " +
      "being a tool rather than a book.",
  },
];

/* ══════════════════════════════════════════════════════════════════════════ *
 * THE WHOLE SCREEN
 * ══════════════════════════════════════════════════════════════════════════ */

export type LearningScreen = {
  readonly tabs: readonly UnitTab[];
  readonly unit: UnitView;
  readonly coverage: CoverageBanner;
  readonly totalLessons: number;
  readonly unitCount: number;
  /** The heading line under the title, all figures derived. */
  readonly subtitle: string;
  readonly query: string;
  readonly hits: readonly LessonHit[];
  readonly searchNotice: string | null;
  /** Set when the requested unit did not exist, so the page can say so. */
  readonly unknownUnitRequested: string | null;
};

/**
 * Build everything the page renders, from a unit slug and a query string.
 *
 * AN UNKNOWN UNIT FALLS BACK TO THE FIRST ONE AND SAYS SO. This is the one
 * place a default is right rather than a refusal: the slug comes from a URL,
 * a stale bookmark is not an error in the books, and a blank page teaches
 * nothing. But it is announced - `unknownUnitRequested` carries the bad slug so
 * the screen can explain itself instead of silently showing the wrong unit.
 */
export function buildLearningScreen(input: {
  readonly unitKey?: string | null;
  readonly query?: string | null;
}): LearningScreen {
  if (CURRICULUM.length === 0) {
    throw new Error(
      "LEARNING SCREEN GATE BROKEN: the curriculum is empty, so this screen would render a " +
        "title over nothing while looking like it worked.",
    );
  }

  const requested = input.unitKey?.trim() || "";
  const found = requested ? findUnit(requested) : undefined;
  const unit = found ?? CURRICULUM[0];
  const unknownUnitRequested = requested && !found ? requested : null;

  const query = input.query?.trim() || "";
  const hits = searchLessons(query);
  const coverage = curriculumCoverage();

  return {
    tabs: unitTabs(unit.key),
    unit: buildUnitView(unit),
    coverage: coverageBanner(coverage),
    totalLessons: coverage.totalLessons,
    unitCount: coverage.unitCount,
    subtitle:
      `${coverage.totalLessons} lessons in ${coverage.unitCount} units, in the order Greenway's ` +
      `year actually raises them.`,
    query,
    hits,
    searchNotice: searchNotice(query, hits.length),
    unknownUnitRequested,
  };
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * SELF-CHECK
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Prove the presentation layer is coherent before anything renders it.
 *
 * Refuses on empty input for the usual reason (rule 39): a check that inspects
 * nothing approves everything.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS TAKES ARGUMENTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Both parameters default to the real values, so every caller in the
 * application is unchanged. They exist so the SUITE can feed this function a
 * deliberately broken curriculum and palette and watch each branch throw.
 *
 * The mutation campaign replaced this entire body with `return;` and the suite
 * stayed GREEN - the only thing any test could do with a no-argument version
 * was assert it does not throw on inputs that are already correct, which a
 * function that does nothing satisfies perfectly. Same defect as its sibling in
 * `learning-path-core.ts`, found the same way, fixed the same way. Rule 39.
 */
export function assertLearningUiIsWellFormed(
  units: readonly CurriculumUnit[] = CURRICULUM,
  accents: Readonly<Record<string, UnitAccent>> = UNIT_ACCENTS,
): void {
  if (units.length === 0) {
    throw new Error("LEARNING UI GATE BROKEN: no units to inspect, so this check proves nothing.");
  }

  // Every unit has an accent, and no two units share one.
  const seen = new Map<UnitAccent, string>();
  for (const unit of units) {
    const a = accents[unit.key];
    if (!a) {
      throw new Error(
        `NO ACCENT FOR CURRICULUM UNIT "${unit.key}". Every unit must have its own colour, ` +
          `because on this screen colour is how the reader knows which unit he is in.`,
      );
    }
    const already = seen.get(a);
    if (already) {
      throw new Error(
        `UNITS "${already}" AND "${unit.key}" SHARE THE ACCENT "${a}". On this screen colour is ` +
          `how the reader knows which unit he is in; two units in one colour teaches a grouping ` +
          `that does not exist.`,
      );
    }
    seen.set(a, unit.key);
  }

  // No accent is defined for a unit that no longer exists - a stale entry is
  // how a palette silently stops matching the course.
  const unitKeys = new Set(units.map((u) => u.key));
  for (const key of Object.keys(accents)) {
    if (!unitKeys.has(key)) {
      throw new Error(
        `UNIT_ACCENTS DEFINES A COLOUR FOR "${key}", WHICH IS NOT A CURRICULUM UNIT. A stale ` +
          `palette entry is how the colours stop describing the course.`,
      );
    }
  }

  // The trail numbers every lesson exactly once, consecutively from 1.
  const trail = curriculumTrail(units);
  if (units === CURRICULUM && trail.length !== allLessons().length) {
    throw new Error(
      `THE TRAIL HAS ${trail.length} STOPS BUT THERE ARE ${allLessons().length} LESSONS. The ` +
        `position line on every card would be quoting a total that is not the real total.`,
    );
  }
  trail.forEach((stop, i) => {
    if (stop.globalIndex !== i + 1) {
      throw new Error(
        `TRAIL NUMBERING IS BROKEN AT ${stop.unitKey}:${stop.fn} - it claims position ` +
          `${stop.globalIndex} but sits at ${i + 1}.`,
      );
    }
  });

  // Every unit resolves all of its lessons. `unitLessons` drops the ones it
  // cannot find, so a shorter list here is a dangling entry rendering silently.
  for (const unit of units) {
    if (unitLessons(unit).length !== unit.lessons.length) {
      throw new Error(
        `UNIT "${unit.key}" LISTS ${unit.lessons.length} LESSONS BUT ONLY ` +
          `${unitLessons(unit).length} RESOLVE. The unit renders short and says nothing about it.`,
      );
    }
  }
}

/** Re-exported so the page imports its data from one place. */
export type { PlacedLesson, CurriculumUnit, CurriculumCoverage, LessonSourceKey };
