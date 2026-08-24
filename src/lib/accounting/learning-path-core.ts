/**
 * src/lib/accounting/learning-path-core.ts   (books-44, slice C)
 *
 * THE CURRICULUM. 82 LESSONS PUT INTO THE ORDER A PERSON SHOULD MEET THEM.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS AT ALL
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Six mentor modules in this system contain 82 finished, tested lessons that no
 * screen has ever rendered. Slice C connects them. But connecting them is not
 * the same as teaching with them, and dumping 82 lessons on a page in module
 * order would be a filing cabinet, not a course.
 *
 * Michael was explicit about what he wants from this:
 *
 *   "i don't need to know how to account for any other business, so all the
 *    complexity of trying to learn everything from every industry from every
 *    size like in school. i need to know everything there is to know about
 *    accounting for greenway."
 *
 * That instruction is the design. A textbook is organised around COVERAGE of a
 * discipline; this is organised around ONE BUSINESS and the order in which its
 * work actually happens. So the lessons are grouped into units that follow
 * Greenway's real calendar - learn how money is written down, learn how the
 * agencies count days, hire someone, run a payroll, prove a quarter, close a
 * month, close the S-corporation year, and then deal with it when something was
 * late - and each unit says plainly when in the year Michael will need it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THE CURRICULUM IS DATA AND NOT MARKUP
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Everything below is a plain value, so tests can reach it. The books-42 mentor
 * learned this the expensive way: a worked example written into JSX claimed a
 * gross margin of "47.9%" when the arithmetic gave 42.71%, and the only reason
 * anybody found out is that a test recomputed it. Prose in a component is prose
 * nothing can check.
 *
 * The rules this file is built to satisfy, stated up front so they can be
 * checked against it:
 *
 *   1. EVERY LESSON APPEARS EXACTLY ONCE. A curriculum that silently drops a
 *      lesson is worse than no curriculum, because the gap is invisible - the
 *      page still looks full. Coverage is RE-DERIVED from the six modules by
 *      `curriculumCoverage()` rather than trusting any count written here.
 *   2. NO LESSON APPEARS TWICE. Duplication in a syllabus reads as emphasis and
 *      is actually a bug.
 *   3. THE KEY IS MODULE + FN, NEVER FN ALONE. `daysBetween` is taught in BOTH
 *      the penalty mentor and the interest mentor - two different functions
 *      that share a name and disagree about direction. Keying on `fn` alone
 *      silently collapses them into one and loses a lesson while every count
 *      still looks plausible. This was measured, not assumed.
 *   4. THE ORDER IS DELIBERATE AND STATED. Each unit carries the reason it sits
 *      where it does, because "why am I reading this now" is the question that
 *      decides whether teaching lands.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HOW THE LESSON NAMES IN THIS FILE WERE OBTAINED
 * ────────────────────────────────────────────────────────────────────────────
 *
 * By reading them out of the modules, not by remembering them. The first draft
 * of this curriculum was written from memory of what each mentor was ABOUT, and
 * `danglingCurriculumEntries()` caught it instantly: of 42 entries, 37 named
 * functions that do not exist - `validateW4`, `closePeriod`, `compoundDaily`,
 * `reconcileQuarter`. Every one of them sounded exactly right. None of them was
 * real. That is standing rule 1 (never guess) failing in the most comfortable
 * way it fails: plausibly.
 *
 * The gate is the only reason it was caught, which is worth stating plainly,
 * because a curriculum full of dangling entries does not crash. It renders
 * short units and says nothing.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TWO ENTRIES THAT ARE NOT ORDINARY FUNCTIONS
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `AGENCY_CLOCKS` is a constant, not a function, and `__runPeriodCloseCoreTests`
 * is a module's own self-test. Both carry a full lesson in their mentor, so both
 * are taught here rather than quietly filtered out. Filtering them would mean
 * the count 82 stopped matching the modules, and standing rule 26 says every
 * exported thing is taught - it does not say every exported FUNCTION.
 *
 * This module is PURE: no `node:fs`, no database, no `server-only`. It is safe
 * in a browser bundle, which is the entire point of standing rule 65b and the
 * reason the four disk-reading mentors were split in this slice.
 */

import { INTEREST_LESSONS } from "@/lib/accounting/interest-mentor";
import { PERIOD_CLOSE_LESSONS } from "@/lib/accounting/period-close-mentor";
import { S_CORPORATION_YEAR_LESSONS } from "@/lib/accounting/s-corporation-year-mentor";
import { TAX_PENALTY_LESSONS } from "@/lib/accounting/tax-penalty-mentor";
import { PAYROLL_ONBOARDING_LESSONS } from "@/lib/payroll/payroll-onboarding-mentor";
import { RECONCILIATION_LESSONS } from "@/lib/reports/payroll-reconciliation-mentor";

/* ══════════════════════════════════════════════════════════════════════════ *
 * THE SOURCE MODULES
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The six teaching modules, keyed by a short stable slug.
 *
 * The slug is part of every lesson's identity (see rule 3 above), so it must
 * never be renamed casually - it is what keeps the two `daysBetween` lessons
 * apart.
 */
export const LESSON_SOURCES = {
  onboarding: PAYROLL_ONBOARDING_LESSONS,
  penalties: TAX_PENALTY_LESSONS,
  interest: INTEREST_LESSONS,
  "period-close": PERIOD_CLOSE_LESSONS,
  "s-corp-year": S_CORPORATION_YEAR_LESSONS,
  reconciliation: RECONCILIATION_LESSONS,
} as const;

export type LessonSourceKey = keyof typeof LESSON_SOURCES;

/**
 * Human labels for the six, for use in breadcrumbs and provenance lines.
 *
 * These are the small grey words under a lesson's number on screen, and their
 * whole job is to answer "where did this lesson come from?". A label that is
 * just the slug with a capital letter - "Penalties" for `penalties` - answers
 * nothing, because Michael can already see the slug in the URL. The gate in
 * `learning-path.test.ts` refuses any label that equals its own key, which is
 * how the first draft of this table was caught: two of the six were slugs in
 * disguise.
 *
 * Each label below is written from what the module ACTUALLY contains, checked
 * by dumping its lessons, not from what its filename suggests:
 *
 *   - `penalties` really covers five agencies (Revenue, Employment Security,
 *     L&I, the Liquor and Cannabis Board, and the IRS), so the label says five.
 *   - `interest` really covers §6621 interest AND two federal late-RETURN
 *     penalties (§6699 for a late 1120-S, §6651 for the sixty-day minimum), so
 *     the label admits it is not only interest.
 */
export const SOURCE_LABELS: Readonly<Record<LessonSourceKey, string>> = {
  onboarding: "Hiring and payroll setup",
  penalties: "Late penalties, all five agencies",
  interest: "Interest, and the federal late-return penalties",
  "period-close": "Closing a period",
  "s-corp-year": "The S-corporation year",
  reconciliation: "Payroll reconciliation",
};

/** A lesson plus the module it came from. The pair is the identity. */
export type PlacedLesson = {
  readonly source: LessonSourceKey;
  readonly fn: string;
  readonly plainEnglish: string;
  readonly whyItExists: string;
  readonly theTrap: string;
  readonly whatIWouldDo: string;
  readonly authorityIds: readonly string[];
};

/** Stable identity for a lesson: module slug plus function name. */
export function lessonKey(source: LessonSourceKey, fn: string): string {
  return `${source}:${fn}`;
}

/** Every lesson in the system, flattened, each tagged with its origin. */
export function allLessons(): readonly PlacedLesson[] {
  const out: PlacedLesson[] = [];
  for (const key of Object.keys(LESSON_SOURCES) as LessonSourceKey[]) {
    for (const l of LESSON_SOURCES[key]) {
      out.push({
        source: key,
        fn: l.fn,
        plainEnglish: l.plainEnglish,
        whyItExists: l.whyItExists,
        theTrap: l.theTrap,
        whatIWouldDo: l.whatIWouldDo,
        authorityIds: l.authorityIds,
      });
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * THE CURRICULUM
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * A unit of study: a set of lessons that answer one question, in the order
 * Greenway's year actually raises that question.
 */
export type CurriculumUnit = {
  /** Stable slug, used in URLs and in tests. */
  readonly key: string;
  /** What Michael sees as the heading. */
  readonly title: string;
  /** The question this unit answers, in his words not the tax code's. */
  readonly theQuestion: string;
  /** When in the real Greenway year this matters. Grounds it in his calendar. */
  readonly whenYouNeedIt: string;
  /** Why this unit sits HERE and not earlier or later. */
  readonly whyHere: string;
  /** The one thing to remember if everything else is forgotten. */
  readonly theOneThing: string;
  /** The lessons, in teaching order. Each entry is [source, fn]. */
  readonly lessons: readonly (readonly [LessonSourceKey, string])[];
};

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE ORDER, AND THE ARGUMENT FOR IT
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Eight units, following the sequence in which Greenway's obligations actually
 * arrive rather than the sequence a textbook would use:
 *
 *   1. MONEY      - how an amount is written down. Everything inherits this.
 *   2. DATES      - how the agencies count days. Every deadline inherits this.
 *   3. HIRING     - the day somebody is hired, before any money moves.
 *   4. PAY RUN    - every other Friday, the recurring core of the year.
 *   5. CHECKING   - proving a quarter is right BEFORE it is filed.
 *   6. MONTH END  - sealing a month so it stops moving.
 *   7. YEAR END   - the S-corporation year, where the shop's numbers become
 *                   Michael's numbers.
 *   8. WHEN LATE  - penalties and interest, deliberately last.
 *
 * Units 1 and 2 are the plumbing, and they are first because a units mistake
 * cannot be found later by looking at the report it corrupted. Units 3 through
 * 7 are the year, in order. Unit 8 is last for a reason worth stating:
 * penalties are what happens when units 1-7 were not done. Leading with them
 * teaches fear instead of practice. Ending with them means Michael meets each
 * penalty already knowing which piece of work prevents it.
 */
export const CURRICULUM: readonly CurriculumUnit[] = [
  {
    key: "money",
    title: "How money is written down",
    theQuestion: "Why does the system refuse numbers that look perfectly reasonable?",
    whenYouNeedIt:
      "Once, before anything else. These rules sit underneath every figure in the system, so " +
      "every later unit quietly assumes you have met them.",
    whyHere:
      "Because a units mistake cannot be found later by looking at the report it corrupted. It " +
      "shows up as a total that is off by a few cents, and a few cents is exactly the size of " +
      "error everybody waves through. The $4,624,697.31 inventory plug that started this whole " +
      "project is what that looks like at the far end. Meet the plumbing first and the refusals " +
      "in every later unit stop feeling arbitrary and start feeling like the system doing its job.",
    theOneThing:
      "Money is a whole number of cents, rates are thousandths of a cent, percentages are " +
      "thousandths of a percent, and hours are hundredths. Nothing in this system is a decimal, " +
      "because decimals drift and integers do not.",
    lessons: [
      ["onboarding", "assertIntegerCents"],
      ["onboarding", "assertIntegerMilliCents"],
      ["penalties", "applyMilliPercent"],
      ["onboarding", "formatMilliCentsAsRate"],
      ["onboarding", "formatMilliPct"],
      ["onboarding", "formatHours"],
      ["onboarding", "refusalSentence"],
    ],
  },
  {
    key: "dates",
    title: "How the agencies count days",
    theQuestion: "Everyone says 'the 20th' or 'three business days'. What do they actually mean?",
    whenYouNeedIt:
      "Once, before the hiring unit, and then again in your head every time a deadline is " +
      "quoted at you. Five agencies count lateness five different ways.",
    whyHere:
      "Because the second unit of anything should be the one that stops you being wrong about " +
      "deadlines, and because the hiring unit that follows immediately hands you a three-" +
      "business-day clock. It is also the honest place to show something uncomfortable: this " +
      "system contains two different functions called daysBetween, one in the penalty mentor " +
      "and one in the interest mentor, and they do not agree about what a negative answer means. " +
      "That is not sloppiness left lying around, it is why the curriculum identifies every " +
      "lesson by module AND name rather than by name alone.",
    theOneThing:
      "Never assume which end of a range is included. Read the function, or read the statute, " +
      "but do not reason from the English phrase - 'three days late' and 'into the third month' " +
      "are counted by different agencies in incompatible ways.",
    lessons: [
      ["penalties", "isValidIsoDate"],
      ["interest", "isIsoDate"],
      ["penalties", "daysBetween"],
      ["interest", "daysBetween"],
      ["penalties", "addDays"],
      ["onboarding", "addYearsYmd"],
      ["penalties", "dayOfWeek"],
      ["penalties", "rollWeekendForward"],
      ["penalties", "endOfMonth"],
      ["period-close", "lastDayOfMonth"],
      ["penalties", "addMonths"],
      ["penalties", "monthsOrPartThereof"],
      ["interest", "daysInYearOf"],
      ["interest", "quarterOf"],
    ],
  },
  {
    key: "hiring",
    title: "Hiring someone — the paperwork before the first cheque",
    theQuestion: "Somebody starts on Monday. What has to be true before I can pay them?",
    whenYouNeedIt:
      "Every time you hire. Most of it is due on or before day one, and the I-9 has a hard " +
      "federal clock measured in business days, not weeks.",
    whyHere:
      "Because this is the first thing that actually happens at Greenway, and it is the cheapest " +
      "place in the whole system to get things right. An I-9 that was never completed is a " +
      "penalty you cannot fix retroactively - you cannot go back and examine a document in the " +
      "past. A W-4 handled properly on day one prevents a year of wrong withholding and the " +
      "reconciliation work that follows from it.",
    theOneThing:
      "Identity paperwork and money are kept apart on purpose. The I-9 proves someone may work " +
      "here; it never touches what they are paid. The system throws if those two ever meet.",
    lessons: [
      ["onboarding", "normalizeSsn"],
      ["onboarding", "ssnProblems"],
      ["onboarding", "isPossibleSsn"],
      ["onboarding", "maskSsn"],
      ["onboarding", "formatSsnUnmasked"],
      ["onboarding", "canRevealSsn"],
      ["onboarding", "renderSsnForRole"],
      ["onboarding", "ssnVerificationCaveat"],
      ["onboarding", "i9DocumentSetIsSufficient"],
      ["onboarding", "validateI9"],
      ["onboarding", "i9Section2DueYmd"],
      ["onboarding", "i9RetainUntilYmd"],
      ["onboarding", "assertI9NotUsedForPay"],
      ["onboarding", "i9RequiredFieldPaths"],
      ["onboarding", "noW4DefaultComparison"],
      ["onboarding", "w4RequiredFieldPaths"],
      ["onboarding", "validatePay"],
      ["onboarding", "payRequiredFieldPaths"],
      ["onboarding", "findOnboardingStep"],
      ["onboarding", "evaluateOnboarding"],
      ["onboarding", "buildChecklistView"],
      ["onboarding", "onboardingDeadlines"],
    ],
  },
  {
    key: "pay-run",
    title: "Running a payroll — every other Friday",
    theQuestion: "How does a timesheet become the number on the cheque?",
    whenYouNeedIt:
      "Twenty-six times a year, starting 1 January 2027. This is the single most repeated piece " +
      "of work in the business.",
    whyHere:
      "Because it is the engine room, and it comes after hiring for the obvious reason that you " +
      "cannot pay someone who is not set up. Everything before this unit is preparation and " +
      "everything after it is checking, sealing or fixing. If you only ever fully understand one " +
      "unit, make it this one.",
    theOneThing:
      "Rounding happens once, at the end, and the leftover cents have to go somewhere you chose " +
      "on purpose. Twenty-six periods that each round independently will not add up to the " +
      "annual salary, and the difference will surface at W-2 time when it is expensive.",
    lessons: [
      ["onboarding", "hourlyGrossCents"],
      ["onboarding", "salaryGrossForPeriodCents"],
      ["onboarding", "payPeriodsRemainingInYear"],
      ["onboarding", "buildWorkedPaycheck"],
    ],
  },
  {
    key: "checking",
    title: "Checking your own work — before anyone else does",
    theQuestion: "How do I know the quarter is right before I file it?",
    whenYouNeedIt:
      "Four times a year, in the days before each quarterly return goes out. Also any time a " +
      "figure looks wrong and you need to find out where it went wrong.",
    whyHere:
      "Because reconciliation is the skill that separates someone who runs payroll from someone " +
      "who can defend it. It sits after the pay run because you cannot reconcile arithmetic you " +
      "do not yet understand, and before the closing units because a month should never be " +
      "sealed on figures nobody has proven.",
    theOneThing:
      "Know the size of the difference you are allowed to shrug at before you look at the " +
      "difference. Deciding afterwards that a variance is 'just rounding' is how a real error " +
      "gets talked into being acceptable.",
    lessons: [
      ["reconciliation", "applyBasis"],
      ["reconciliation", "maxRoundingDriftCents"],
      ["reconciliation", "buildReconciliationReport"],
      ["reconciliation", "filedFigure"],
      ["reconciliation", "assertKnownGoodQuarterCrossFoots"],
    ],
  },
  {
    key: "month-end",
    title: "Closing the month — making a period stop moving",
    theQuestion: "What does it actually mean to say a month is finished?",
    whenYouNeedIt:
      "Twelve times a year, in the first week or so of the following month, for each of the " +
      "sets of books.",
    whyHere:
      "Because closing is what turns work into a record. It comes after checking because a " +
      "month you have not proven is a month you are not entitled to seal, and before the " +
      "S-corporation year because a year is only as trustworthy as the twelve months inside it.",
    theOneThing:
      "A difference is a difference until it is explained. The system will not let you call it " +
      "an adjustment, and reopening a month that has already been filed on is refused outright " +
      "rather than merely warned about.",
    lessons: [
      ["period-close", "validatePeriodIdentity"],
      ["period-close", "periodLabel"],
      ["period-close", "findCloseCheck"],
      ["period-close", "refuseIfNotFinished"],
      ["period-close", "evaluatePeriodClose"],
      ["period-close", "describeDifference"],
      ["period-close", "evaluatePeriodReopen"],
      ["period-close", "__runPeriodCloseCoreTests"],
    ],
  },
  {
    key: "year-end",
    title: "The S-corporation year — where the shop's numbers become yours",
    theQuestion: "Why does an S corporation need to know which year it started being one?",
    whenYouNeedIt:
      "Once a year, in the first quarter, when the 1120-S and the K-1s are prepared and the " +
      "figures flow onto your own 1040.",
    whyHere:
      "Because this is the unit that connects the shop's books to your personal return, and it " +
      "is the connection most owners never see. It comes after month end because the year is " +
      "built out of closed months, and before the penalty unit because the deadlines it creates " +
      "are the ones the penalty unit prices.",
    theOneThing:
      "The accumulated adjustments account opens at zero exactly once, in the first year of the " +
      "election, and is carried forward every year after. Getting that wrong is not a rounding " +
      "problem - it changes whether a distribution is taxable.",
    lessons: [
      ["s-corp-year", "validateSElectionFacts"],
      ["s-corp-year", "classifySYear"],
      ["s-corp-year", "aaaMustOpenAtZero"],
      ["s-corp-year", "openingBalancesMustBeCarriedForward"],
      ["s-corp-year", "describeOpeningBalanceSource"],
    ],
  },
  {
    key: "when-late",
    title: "When something is late — penalties and interest",
    theQuestion: "It slipped. What does it cost, and what do I do now?",
    whenYouNeedIt:
      "Hopefully never on purpose. Read it once now so you recognise the shape of a problem " +
      "early, while it is still cheap, and read the relevant part again the day a notice arrives.",
    whyHere:
      "Last, deliberately. Penalties are what happens when the first seven units did not. " +
      "Leading with them teaches fear; ending with them means you meet each one already knowing " +
      "which piece of work prevents it.",
    theOneThing:
      "Penalties are capped and interest is not. The penalty letter is the frightening one, but " +
      "on an old balance the interest is almost always the expensive one - which is why paying " +
      "something immediately beats waiting until you can pay everything.",
    lessons: [
      ["penalties", "AGENCY_CLOCKS"],
      ["penalties", "dorPenaltyStep"],
      ["penalties", "computeDorPenalty"],
      ["penalties", "computeEsdPenalty"],
      ["penalties", "computeLniPenalty"],
      ["penalties", "lcbDueDateForSalesMonth"],
      ["penalties", "computeLcbPenalty"],
      ["penalties", "irsDepositRateMilliPercent"],
      ["penalties", "computeIrsDepositPenalty"],
      ["penalties", "computeIrsFilePayPenalty"],
      ["interest", "rateKindFor"],
      ["interest", "compoundDailyInterestCents"],
      ["interest", "computeInterest"],
      ["interest", "computeSection6699Penalty"],
      // books-50: placed IMMEDIATELY after the penalty it sizes, because the
      // lesson only lands next to it. On its own, "a helper that formats a
      // dollar figure" reads as plumbing; read straight after the §6699 lesson
      // it is the answer to "so what is that number for Greenway, and why is it
      // not typed into the sentence?".
      ["interest", "formatSection6699MaximumUsd"],
      ["interest", "section6651MinimumFor"],
      ["interest", "validateSection6651Rows"],
      ["penalties", "bookingInstructions"],
    ],
  },
];

/* ══════════════════════════════════════════════════════════════════════════ *
 * LOOKUP AND COVERAGE
 * ══════════════════════════════════════════════════════════════════════════ */

/** Find one lesson by its module and function name. */
export function findLesson(source: LessonSourceKey, fn: string): PlacedLesson | undefined {
  return allLessons().find((l) => l.source === source && l.fn === fn);
}

/** Find one unit by its slug. */
export function findUnit(key: string): CurriculumUnit | undefined {
  return CURRICULUM.find((u) => u.key === key);
}

/** The lessons of one unit, resolved, in the order the unit lists them. */
export function unitLessons(unit: CurriculumUnit): readonly PlacedLesson[] {
  const out: PlacedLesson[] = [];
  for (const [source, fn] of unit.lessons) {
    const found = findLesson(source, fn);
    if (found) out.push(found);
  }
  return out;
}

/**
 * Lessons that exist in a mentor module but appear in NO curriculum unit.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A FUNCTION AND NOT A COMMENT
 * ────────────────────────────────────────────────────────────────────────────
 * The whole finding behind slice C is that 82 lessons existed and nothing
 * showed them. Building a curriculum that covers 60 of them and quietly omits
 * 22 would reproduce the same defect one level up - and it would be HARDER to
 * spot, because the page would look full and busy.
 *
 * So coverage is computed, not claimed. The screen renders this list where
 * Michael can see it, rather than hiding it only in a test, because a gap he
 * can see is a gap that gets closed.
 */
export function unplacedLessons(): readonly PlacedLesson[] {
  const placed = new Set<string>();
  for (const unit of CURRICULUM) {
    for (const [source, fn] of unit.lessons) placed.add(lessonKey(source, fn));
  }
  return allLessons().filter((l) => !placed.has(lessonKey(l.source, l.fn)));
}

/**
 * Curriculum entries that name a lesson which does not exist.
 *
 * The opposite direction, and the more dangerous one. If a mentor renames a
 * function, the curriculum entry pointing at the old name silently renders
 * nothing - a unit quietly gets shorter and nothing says so. Rule 66a: assert
 * existence before absence, and check BOTH directions.
 *
 * This is not hypothetical. It caught 37 invented names in the first draft of
 * the CURRICULUM above.
 */
export function danglingCurriculumEntries(
  units: readonly CurriculumUnit[] = CURRICULUM,
): readonly string[] {
  const out: string[] = [];
  for (const unit of units) {
    for (const [source, fn] of unit.lessons) {
      if (!findLesson(source, fn)) out.push(`${unit.key} -> ${lessonKey(source, fn)}`);
    }
  }
  return out;
}

/** Total lessons actually reachable through the curriculum. */
export function placedLessonCount(): number {
  const placed = new Set<string>();
  for (const unit of CURRICULUM) {
    for (const [source, fn] of unit.lessons) {
      if (findLesson(source, fn)) placed.add(lessonKey(source, fn));
    }
  }
  return placed.size;
}

/** What the coverage banner on the screen reports. All three figures derived. */
export type CurriculumCoverage = {
  /** How many lessons the six modules actually contain, counted now. */
  readonly totalLessons: number;
  /** How many of those a unit reaches. */
  readonly placedLessons: number;
  /** The ones nothing reaches, named. Empty is the only acceptable answer. */
  readonly unplaced: readonly string[];
  /** Curriculum entries pointing at nothing. Empty is the only acceptable answer. */
  readonly dangling: readonly string[];
  /** Units, for the "8 units, 82 lessons" line. */
  readonly unitCount: number;
};

/**
 * The numbers the screen prints, every one of them recomputed on the spot.
 *
 * Nothing here reads a hard-coded 82. If somebody adds a lesson to a mentor
 * tomorrow, this returns 83 and names the one nobody placed - which is the
 * behaviour that would have caught the original defect years earlier.
 */
export function curriculumCoverage(): CurriculumCoverage {
  const unplaced = unplacedLessons().map((l) => lessonKey(l.source, l.fn));
  return {
    totalLessons: allLessons().length,
    placedLessons: placedLessonCount(),
    unplaced,
    dangling: danglingCurriculumEntries(),
    unitCount: CURRICULUM.length,
  };
}

/**
 * The build-time integrity check for the curriculum.
 *
 * Throws rather than returning a boolean, because a curriculum with a dangling
 * entry must not ship at all. Refuses on an empty input for the usual reason:
 * a coverage check that inspects nothing approves everything (rule 39).
 *
 * Deliberately does NOT throw on unplaced lessons. An unplaced lesson is a gap
 * in teaching, not a broken page, and the screen is the right place to show it:
 * if this threw, the coverage banner could never display anything but "all
 * placed", which is dead UI wearing a green check (rule 50). The test suite
 * asserts unplaced is empty; the screen shows it if it ever is not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS TAKES AN ARGUMENT
 * ─────────────────────────────────────────────────────────────────────────────
 * The `units` parameter defaults to the real CURRICULUM, so every caller in the
 * application is unchanged. It exists so the SUITE can hand this function a
 * deliberately broken curriculum and watch each branch actually throw.
 *
 * That is not a theoretical nicety. The mutation campaign in
 * `scripts/prove-learning-path-gate.sh` turned the whole body of this function
 * into `return;` and the suite stayed GREEN - because the only thing any test
 * could do with a no-argument version was assert it does NOT throw on a
 * curriculum that is already correct, which a function that does nothing at all
 * satisfies perfectly. That is standing rule 39 in its purest form: a check that
 * cannot fail is not a check, and it was wearing a green tick (rule 50).
 */
export function assertCurriculumIsWellFormed(
  units: readonly CurriculumUnit[] = CURRICULUM,
): void {
  if (units.length === 0) {
    throw new Error(
      "CURRICULUM GATE BROKEN: no units to inspect. A curriculum check that inspects nothing " +
        "passes vacuously and protects nothing.",
    );
  }

  const dangling = danglingCurriculumEntries(units);
  if (dangling.length > 0) {
    throw new Error(
      `CURRICULUM POINTS AT LESSONS THAT DO NOT EXIST: ${dangling.join(", ")}. A unit that ` +
        `names a renamed function renders one lesson shorter and says nothing about it.`,
    );
  }

  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const unit of units) {
    for (const [source, fn] of unit.lessons) {
      const k = lessonKey(source, fn);
      if (seen.has(k)) dupes.push(k);
      seen.add(k);
    }
  }
  if (dupes.length > 0) {
    throw new Error(
      `CURRICULUM TEACHES THE SAME LESSON TWICE: ${dupes.join(", ")}. Duplication in a syllabus ` +
        `reads as emphasis and is actually a bug.`,
    );
  }

  const keys = units.map((u) => u.key);
  if (new Set(keys).size !== keys.length) {
    throw new Error(`CURRICULUM HAS DUPLICATE UNIT KEYS: ${keys.join(", ")}.`);
  }

  for (const unit of units) {
    if (unit.lessons.length === 0) {
      throw new Error(
        `CURRICULUM UNIT "${unit.key}" TEACHES NOTHING. An empty unit renders a heading and a ` +
          `blank space, which reads as "there is nothing to know here".`,
      );
    }
  }
}
