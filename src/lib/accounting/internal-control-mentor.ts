/**
 * src/lib/accounting/internal-control-mentor.ts   (books-28)
 *
 * THE CPA/CFO WHO ANSWERS "AM I RUNNING THIS PLACE PROPERLY?"
 *
 * Michael asked for this in one sentence: "I do want you to update the cpa cfo
 * mentor to have verbatim coso." The authorities live next door in
 * `internal-control-authorities.ts`, machine-verified against COSO's own free
 * Executive Summary and the public-domain GAO Green Book. This file is the part
 * that TEACHES them, because a quote with no explanation is a wall plaque.
 *
 * WHY A ONE-PERSON SHOP NEEDS THIS AT ALL. Michael has a Master's in accounting
 * and has not opened a book in thirteen years, so he already knows the word
 * COSO. What he has never had is COSO applied to HIS problem: a cash-heavy
 * cannabis retailer where one person records the sales, counts the drawer, pays
 * the bills, runs payroll and reconciles the bank. That is not a small
 * segregation-of-duties weakness, it is the textbook worst case - and the
 * honest answer is not "hire three people", it is "name the gap, compensate
 * deliberately, and write it down". Every lesson below is pointed at that.
 *
 * WHAT THIS FILE REFUSES TO DO. It does not tell Michael he must comply with
 * COSO. No law requires it: he is a private S-corporation with no external
 * audit and no Sarbanes-Oxley obligation, and
 * INTERNAL_CONTROL_APPLICABILITY_DISCLAIMER says so on screen. Frightening an
 * owner into a framework he is not subject to would be the opposite of teaching
 * him.
 *
 * A coverage gate at the bottom reads the assessment engine FROM DISK and fails
 * if any exported function ships without a lesson - the same gate that has
 * caught real omissions in earlier slices. It is not decorative.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  COSO_COMPONENTS,
  INTERNAL_CONTROL_AUTHORITIES,
} from "@/lib/accounting/internal-control-authorities";

export type ControlLesson = {
  /** The exported function this lesson teaches. */
  fn: string;
  /** What it does, in one breath, with no jargon. */
  plainEnglish: string;
  /** Why it exists at all. */
  whyItExists: string;
  /** The mistake a competent person actually makes here. */
  theTrap: string;
  /** What a CPA would do in Michael's chair. */
  whatIWouldDo: string;
  authorityIds: readonly string[];
};

export const INTERNAL_CONTROL_LESSONS: readonly ControlLesson[] = [
  {
    fn: "describeComponent",
    plainEnglish:
      "Hands back one of COSO's five components with the principles that sit under it and a plain-English " +
      "description of what it is really asking.",
    whyItExists:
      "The five components are the only structure that stops an internal-control review from becoming a " +
      "list of whatever the reviewer happened to think of. They are stored as data rather than prose " +
      "because COSO's own summary says the principles are drawn directly from the components - so the " +
      "grouping is part of the standard, not a layout choice this application made up.",
    theTrap:
      "Treating 'Control Activities' as the whole subject because it is the only component that sounds like " +
      "work. Counting the drawer is a control activity; knowing WHY you count it is risk assessment, and " +
      "noticing that nobody has counted it since August is monitoring. Do only the middle one and you have " +
      "a habit, not a control system.",
    whatIWouldDo:
      "Read all five once, then pick the component you like least. That is almost always the one with the " +
      "real weakness in it, because we avoid the questions we suspect the answers to.",
    authorityIds: [
      "coso-2013-seventeen-principles",
      "coso-2013-all-principles-apply",
      "green-book-2025-control-environment-foundation",
    ],
  },
  {
    fn: "assessPrinciple",
    plainEnglish:
      "Records an honest answer to one of the seventeen principles - present, present but not working, or " +
      "absent - and keeps the reason you gave.",
    whyItExists:
      "COSO's test has two halves that fail differently: a control can be 'present' and not 'functioning'. " +
      "A month-end checklist that exists but was last completed in August is present and not functioning, " +
      "and the framework counts that as a deficiency rather than partial credit. Collapsing the two into a " +
      "single tick would hide exactly the failure that matters.",
    theTrap:
      "Answering the question you wish had been asked. 'Do we control cash?' becomes 'do we have a till?' " +
      "The principle asks whether the control is DESIGNED, IN PLACE and RUNNING - three separate facts, and " +
      "the third is the one nobody checks.",
    whatIWouldDo:
      "Write the reason before you pick the answer. If you cannot describe in one sentence what actually " +
      "happens and who does it, the honest answer is 'not present' no matter what the policy says.",
    authorityIds: [
      "coso-2013-present-and-functioning",
      "coso-2013-principle-16-evaluations",
      "green-book-2025-principle-5-accountability",
    ],
  },
  {
    fn: "evaluateInternalControlSystem",
    plainEnglish:
      "Looks at every principle you answered and says whether the system as a whole can be called effective " +
      "- and if not, exactly which answers stopped it.",
    whyItExists:
      "Because the framework does not average. COSO says that when a major deficiency exists in any " +
      "component or relevant principle, or in how they work together, the organisation CANNOT conclude that " +
      "it has an effective system. The Green Book states the same thing as a plain if-then. So the verdict " +
      "has to be all-or-nothing with the failures named, not a score out of seventeen.",
    theTrap:
      "Reading a mostly-green result as 'good enough'. Sixteen of seventeen is not 94 per cent effective; " +
      "it is not effective, with one known hole. The distinction matters because the hole is where the loss " +
      "comes from.",
    whatIWouldDo:
      "Do this once a year, in January, before the CPA arrives, and keep last year's answers beside this " +
      "year's. The interesting thing is never the verdict - it is which answers changed.",
    authorityIds: [
      "coso-2013-major-deficiency",
      "coso-2013-effective-system-requirements",
      "green-book-2025-effective-system-two-tests",
      "green-book-2025-not-effective-when",
      "coso-2013-components-operate-together",
    ],
  },
  {
    fn: "segregationOfDutiesFinding",
    plainEnglish:
      "Says out loud that one person doing the recording, the counting, the paying and the reconciling is a " +
      "real weakness, and lists the compensating controls that answer it.",
    whyItExists:
      "This is the finding Michael cannot fix by trying harder, so pretending it is absent would make every " +
      "other answer suspect. The Green Book states the requirement directly - duties are divided among " +
      "different people to reduce the risk of error, misuse or fraud. Greenway has one accounting person. " +
      "The framework's own answer to that is not exemption, it is documented compensating controls, and " +
      "COSO principle 10 explicitly aims at 'acceptable levels' rather than zero risk.",
    theTrap:
      "Two opposite mistakes. The first is skipping the question because the answer is embarrassing. The " +
      "second is over-correcting - paying a second person to re-count everything, which costs more than the " +
      "risk and is exactly what 'acceptable levels' tells you not to do.",
    whatIWouldDo:
      "Write the gap down in one sentence, then write the three things that partly cover it: the owner " +
      "reviews what the owner did not enter, the bank feed is matched against records nobody can silently " +
      "edit, and this system keeps an audit trail that makes a quiet change loud. A documented weakness " +
      "with compensating controls is a defensible position. An undocumented one is just a weakness.",
    authorityIds: [
      "green-book-2025-segregation-of-duties",
      "coso-2013-principle-10-control-activities",
      "coso-2013-principle-3-structures",
      "green-book-2025-documentation-required",
      "coso-2013-limitations-exist",
    ],
  },
  {
    fn: "changeRiskForCutover",
    plainEnglish:
      "Treats the move off Sage onto this system as its own risk event, with the controls that have to be " +
      "re-established on the other side.",
    whyItExists:
      "COSO principle 9 is about identifying changes that could significantly impact the control system, " +
      "and replacing the accounting system on 1 January 2027 is the largest such change Greenway will have. " +
      "Controls that quietly depended on Sage's behaviour - a report someone always eyeballed, a total that " +
      "never balanced wrong - do not survive a migration by themselves.",
    theTrap:
      "Assuming that because the new system is better, the controls came with it. They did not. A cleaner " +
      "engine with nobody reviewing its output is a faster way to be wrong.",
    whatIWouldDo:
      "Run the first quarter of 2027 as a reconciliation rather than a switch: the new system's numbers " +
      "against the old system's logic, with the differences explained rather than assumed away. That is " +
      "why the known-good quarter is stored as an oracle in this application instead of a fixture.",
    authorityIds: [
      "coso-2013-principle-9-changes",
      "coso-2013-principle-13-quality-information",
      "green-book-2025-principle-8-fraud",
    ],
  },
  {
    fn: "controlAuthorityFor",
    plainEnglish:
      "Fetches the exact words of the framework behind any control question, so you can read the source " +
      "rather than take this system's word for it.",
    whyItExists:
      "Michael asked for a system that 'follows the authoritative source documents precisely'. Every quote " +
      "in that registry is checked by machine as an exact substring of COSO's own Executive Summary or the " +
      "GAO Green Book on every run - three of them FAILED that check while this slice was being written and " +
      "were corrected against the source. Being able to surface the sentence is what makes the rest " +
      "trustworthy.",
    theTrap:
      "Trusting a paraphrase because it sounds like the standard. One of the corrected quotes read 'A major " +
      "deficiency represents an internal control deficiency...' - plausible, professional, and nowhere in " +
      "the document. If a quote here cannot be found in the mirrored source, the build fails.",
    whatIWouldDo:
      "When a control decision feels arguable, read the actual sentence. COSO is much shorter and much " +
      "blunter than its reputation, and the plain words usually settle it.",
    authorityIds: [
      "coso-2013-definition-of-internal-control",
      "green-book-2025-adopts-coso",
      "green-book-2025-adapts-for-government",
    ],
  },
];

/** Look up the lesson for one exported function. Undefined, never a throw. */
export function findControlLesson(fn: string): ControlLesson | undefined {
  return INTERNAL_CONTROL_LESSONS.find((l) => l.fn === fn);
}

/** Every function name this mentor teaches. */
export function taughtFunctionNames(): readonly string[] {
  return INTERNAL_CONTROL_LESSONS.map((l) => l.fn);
}

/**
 * Read the exported function names out of the assessment engine ON DISK.
 *
 * Deliberately reads the file rather than importing it: the point is to catch a
 * function that was added to the engine and never taught, and an import would
 * only ever show what this module already knows about.
 */
export function exportedCoreFunctionNames(sourcePath?: string): readonly string[] {
  const path =
    sourcePath ?? join(process.cwd(), "src", "lib", "accounting", "internal-control-core.ts");
  const src = readFileSync(path, "utf8");
  const names: string[] = [];
  const re = /^export function ([A-Za-z0-9_]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) names.push(m[1]);
  return names;
}

/**
 * Fail loudly if any exported function shipped without a lesson.
 *
 * `sourcePath` exists so a TEST can point this at a file it controls and prove
 * the gate actually fires - standing rule 16: prove the gate is WIRED, not
 * merely present.
 */
export function assertEveryExportedFunctionIsTaught(sourcePath?: string): void {
  const taught = new Set(taughtFunctionNames());
  const exported = exportedCoreFunctionNames(sourcePath);

  // A gate that reads nothing approves everything.
  if (exported.length === 0) {
    throw new Error(
      "MENTOR COVERAGE GATE BROKEN: read no exported functions from the core module. " +
        "A coverage gate that inspects nothing passes vacuously and protects nothing.",
    );
  }

  const untaught = exported.filter((f) => !taught.has(f));
  if (untaught.length > 0) {
    throw new Error(
      `MENTOR COVERAGE GAP: these exported functions have no lesson: ${untaught.join(", ")}. ` +
        `Standing rule 26 requires every exported function to be taught before it ships.`,
    );
  }
}

/**
 * Every authority id cited by a lesson must exist in the registry.
 *
 * Guards the failure mode where a lesson cites `coso-2013-principle-18` - a
 * plausible id for a principle that does not exist - and the screen silently
 * renders a citation with no text behind it.
 */
export function assertEveryCitedAuthorityExists(): void {
  const known = new Set(INTERNAL_CONTROL_AUTHORITIES.map((a) => a.id));
  const dangling: string[] = [];
  for (const lesson of INTERNAL_CONTROL_LESSONS) {
    for (const id of lesson.authorityIds) {
      if (!known.has(id)) dangling.push(`${lesson.fn} -> ${id}`);
    }
  }
  if (dangling.length > 0) {
    throw new Error(
      `MENTOR CITES AUTHORITIES THAT DO NOT EXIST: ${dangling.join(", ")}. A citation with nothing ` +
        `behind it is worse than none, because the reader believes it was checked.`,
    );
  }
}

/**
 * The five components, each paired with the lessons that touch it.
 *
 * Exists so the review screen can walk COSO's own structure instead of a flat
 * list of six functions.
 */
export function lessonsByComponent(): readonly {
  readonly component: string;
  readonly principleNumbers: readonly number[];
  readonly lessons: readonly string[];
}[] {
  return COSO_COMPONENTS.map((c) => ({
    component: c.component,
    principleNumbers: c.principleNumbers,
    lessons: INTERNAL_CONTROL_LESSONS.filter((l) =>
      l.authorityIds.some((id) => principleNumbersFor(id).some((n) => c.principleNumbers.includes(n))),
    ).map((l) => l.fn),
  }));
}

/**
 * Which COSO principle numbers an authority id refers to, if any.
 *
 * Reads the number out of the id (`coso-2013-principle-10-...` -> 10) rather
 * than keeping a second mapping that could disagree with the first. Ids that
 * are not principle statements - the definition, the limitations - correctly
 * return nothing.
 */
export function principleNumbersFor(authorityId: string): readonly number[] {
  const m = /principle-(\d{1,2})(?:-|$)/.exec(authorityId);
  if (!m) return [];
  const n = Number(m[1]);
  return n >= 1 && n <= 17 ? [n] : [];
}
