/**
 * src/lib/payroll/wage-order-entry-mentor-gates.ts   (books-38)
 *
 * THE RULE-26 COVERAGE GATES FOR THE WAGE ORDER ENTRY MENTOR.
 *
 * Separate from `wage-order-entry-mentor.ts` because these read files off disk
 * and the mentor's data is reachable from client components. Standing rule 65b:
 * mixing the two in books-33 put `node:fs` into a browser bundle and broke
 * every deployment while CI stayed green.
 *
 * WHY THESE GATES PARSE THE ENGINE INSTEAD OF LISTING WHAT IT CONTAINS. A
 * hand-typed list of refusal codes or draft fields passes forever after
 * somebody adds one and forgets the lesson - standing rule 50, dead code
 * wearing a green check. Every gate below derives its expectations from the
 * real engine, and every gate refuses when it derives NOTHING, because a
 * coverage gate that inspects an empty list approves everything (rule 39).
 *
 * Each gate also checks the OPPOSITE direction. A lesson for a refusal code
 * that no longer exists, or for a form field that was renamed, reads as
 * reassurance while covering nothing, and it is the more dangerous of the two
 * failures because the count still looks right.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ALL_WAGE_ORDER_REFUSAL_CODES,
  EMPTY_WAGE_ORDER_DRAFT,
} from "@/lib/payroll/wage-order-entry-core";
import { WAGE_ORDER_ENTRY_AUTHORITIES } from "@/lib/payroll/wage-order-entry-authorities";
import {
  JUDGEMENT_FIELD_LESSONS,
  WAGE_ORDER_ENTRY_REFUSAL_LESSONS,
  WAGE_ORDER_ENTRY_SCREEN_LESSONS,
  WAGE_ORDER_ENTRY_WALKTHROUGH,
} from "@/lib/payroll/wage-order-entry-mentor";

const ENTRY_CORE = join("src", "lib", "payroll", "wage-order-entry-core.ts");

/* ═══════════════════════════════════════════════════════════════════════════
 * REFUSAL CODE COVERAGE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Every refusal code the engine can emit has exactly one lesson.
 *
 * The list is the engine's own runtime array, not a copy kept here. books-37
 * hit the case where a refusal code existed only as a TYPE, so no test could
 * enumerate it and the coverage gate could not see it; `wage-order-entry-core`
 * therefore exports `ALL_WAGE_ORDER_REFUSAL_CODES` as real runtime data for
 * exactly this reason.
 */
export function assertEveryEntryRefusalCodeIsTaught(): void {
  if (ALL_WAGE_ORDER_REFUSAL_CODES.length === 0) {
    throw new Error(
      "ENTRY REFUSAL GATE BROKEN: the engine reports no refusal codes at all, so this gate would " +
        "approve a mentor that teaches nothing. Check ALL_WAGE_ORDER_REFUSAL_CODES.",
    );
  }

  const taught = WAGE_ORDER_ENTRY_REFUSAL_LESSONS.map((l) => l.code);
  const taughtSet = new Set(taught);

  const missing = ALL_WAGE_ORDER_REFUSAL_CODES.filter((c) => !taughtSet.has(c));
  if (missing.length > 0) {
    throw new Error(
      `ENTRY MENTOR COVERAGE GAP: these refusal codes have no lesson: ${missing.join(", ")}. ` +
        `A refusal that only names what is missing teaches nothing (standing rule 64a): the ` +
        `person reading it needs to know why refusing beats computing anyway, and what to do ` +
        `about it. Garnishment is the one area where the EMPLOYER is personally liable, and a ` +
        `refusal with no explanation invites somebody to work around it.`,
    );
  }

  // The other direction. A lesson for a code that no longer exists is a lesson
  // nobody will ever read, and it inflates the count that makes coverage look
  // complete.
  const known = new Set<string>(ALL_WAGE_ORDER_REFUSAL_CODES);
  const stale = taught.filter((c) => !known.has(c));
  if (stale.length > 0) {
    throw new Error(
      `ENTRY MENTOR TEACHES REFUSAL CODES THAT NO LONGER EXIST: ${stale.join(", ")}. Remove them ` +
        `or restore the codes - a stale lesson reads as coverage while covering nothing.`,
    );
  }

  const dupes = taught.filter((c, i) => taught.indexOf(c) !== i);
  if (dupes.length > 0) {
    throw new Error(
      `ENTRY MENTOR HAS DUPLICATE REFUSAL LESSONS: ${[...new Set(dupes)].join(", ")}. Two lessons ` +
        `for one code means the screen picks one arbitrarily and the other is never seen.`,
    );
  }
}

/**
 * The engine's refusal codes, read from its SOURCE rather than imported.
 *
 * This is the cross-check on the runtime array itself. If somebody adds a code
 * to the `WageOrderRefusalCode` union and forgets to add it to
 * `ALL_WAGE_ORDER_REFUSAL_CODES`, the array-based gate above would keep
 * passing while a reachable refusal had no lesson. Parsing the union closes
 * that gap.
 */
export function refusalCodesDeclaredInEngineSource(sourcePath?: string): readonly string[] {
  const p = sourcePath ?? join(process.cwd(), ENTRY_CORE);
  const src = readFileSync(p, "utf8");

  const start = src.indexOf("export type WageOrderRefusalCode");
  if (start === -1) {
    throw new Error(
      `ENTRY REFUSAL PARSE FAILED: could not find the WageOrderRefusalCode union in ${p}. This ` +
        `gate must refuse rather than report zero codes, because zero would make every coverage ` +
        `assertion vacuously true (standing rule 39).`,
    );
  }
  const end = src.indexOf(";", start);
  const body = src.slice(start, end === -1 ? undefined : end);

  const codes = [...body.matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]);
  if (codes.length === 0) {
    throw new Error(
      `ENTRY REFUSAL PARSE FAILED: the WageOrderRefusalCode union in ${p} yielded no codes.`,
    );
  }
  return codes;
}

/**
 * The runtime array and the type union must agree, in both directions.
 *
 * A code in the union but not the array is unreachable by every test and every
 * gate. A code in the array but not the union is a code the engine can never
 * emit, and its lesson is dead text.
 */
export function assertRefusalCodeUnionMatchesRuntimeList(sourcePath?: string): void {
  const declared = refusalCodesDeclaredInEngineSource(sourcePath);
  const runtime = ALL_WAGE_ORDER_REFUSAL_CODES;

  const declaredSet = new Set(declared);
  const runtimeSet = new Set<string>(runtime);

  const missingFromRuntime = declared.filter((c) => !runtimeSet.has(c));
  const missingFromUnion = runtime.filter((c) => !declaredSet.has(c));

  if (missingFromRuntime.length > 0 || missingFromUnion.length > 0) {
    throw new Error(
      `ENTRY REFUSAL CODES ARE OUT OF STEP. In the type union but missing from ` +
        `ALL_WAGE_ORDER_REFUSAL_CODES: ${missingFromRuntime.join(", ") || "none"}. In the runtime ` +
        `list but not in the union: ${missingFromUnion.join(", ") || "none"}. The first kind is ` +
        `invisible to every coverage gate; the second is a lesson for something that can never ` +
        `happen.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * FORM FIELD COVERAGE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Fields Michael does not fill in from the judgement.
 *
 * `employeeId` is a picker rather than something read off the paper, and
 * `notes` is free text with no right answer. Both are excluded deliberately
 * and the list is exported so a test reads THIS one rather than a copy that
 * would pass forever after somebody widened the real one.
 */
export const ENTRY_FIELDS_WITHOUT_LESSONS: readonly string[] = ["employeeId", "notes"];

/**
 * Every field on the draft has a lesson, except the two above.
 *
 * The field list comes from `EMPTY_WAGE_ORDER_DRAFT` — a real runtime object —
 * so adding a field to the form automatically demands a lesson.
 */
export function assertEveryJudgementFieldIsTaught(): void {
  const fields = Object.keys(EMPTY_WAGE_ORDER_DRAFT);
  if (fields.length < 10) {
    throw new Error(
      `ENTRY FIELD GATE BROKEN: EMPTY_WAGE_ORDER_DRAFT reports only ${fields.length} fields, ` +
        `which is too few to be real. A short read here would approve a mentor that teaches ` +
        `almost nothing (standing rule 39).`,
    );
  }

  const exempt = new Set(ENTRY_FIELDS_WITHOUT_LESSONS);
  const taught = new Set(JUDGEMENT_FIELD_LESSONS.map((l) => l.draftField));

  const missing = fields.filter((f) => !exempt.has(f) && !taught.has(f));
  if (missing.length > 0) {
    throw new Error(
      `ENTRY MENTOR COVERAGE GAP: these form fields have no lesson: ${missing.join(", ")}. ` +
        `Michael asked how to set an order up "with the details from the judgement", so every ` +
        `box he has to fill needs to say where on the paper the answer is and how it gets ` +
        `mistyped.`,
    );
  }

  const stale = [...taught].filter((f) => !fields.includes(f));
  if (stale.length > 0) {
    throw new Error(
      `ENTRY MENTOR TEACHES FIELDS THAT DO NOT EXIST ON THE FORM: ${stale.join(", ")}. A lesson ` +
        `beside a renamed or deleted field reads as reassurance while covering nothing.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * CITATIONS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Every citation points at a real, mirrored authority.
 *
 * A citation with nothing behind it is worse than no citation at all, because
 * the reader believes it was checked.
 */
export function assertEveryCitedEntryAuthorityExists(): void {
  const known = new Set(WAGE_ORDER_ENTRY_AUTHORITIES.map((a) => a.id));
  if (known.size === 0) {
    throw new Error(
      "ENTRY AUTHORITY GATE BROKEN: the authority registry is empty, so every citation would " +
        "look dangling and the failure would point at the lessons instead of at the registry.",
    );
  }

  const dangling: string[] = [];
  for (const l of JUDGEMENT_FIELD_LESSONS) {
    for (const id of l.authorityIds) if (!known.has(id)) dangling.push(`${l.draftField} -> ${id}`);
  }
  for (const l of WAGE_ORDER_ENTRY_SCREEN_LESSONS) {
    for (const id of l.authorityIds) if (!known.has(id)) dangling.push(`${l.topic} -> ${id}`);
  }
  for (const s of WAGE_ORDER_ENTRY_WALKTHROUGH) {
    for (const id of s.authorityIds) if (!known.has(id)) dangling.push(`step ${s.step} -> ${id}`);
  }

  if (dangling.length > 0) {
    throw new Error(
      `ENTRY MENTOR CITES AUTHORITIES THAT DO NOT EXIST: ${dangling.join(", ")}. A citation with ` +
        `nothing behind it is worse than none, because the reader believes it was checked.`,
    );
  }
}

/**
 * Authorities that no lesson cites. REPORTED, NOT THROWN.
 *
 * An uncited authority is not a defect - some exist to back the engine rather
 * than a lesson - but it is usually a lesson somebody meant to write, so it is
 * worth being able to see.
 */
export function uncitedEntryAuthorityIds(): readonly string[] {
  const cited = new Set<string>();
  for (const l of JUDGEMENT_FIELD_LESSONS) for (const id of l.authorityIds) cited.add(id);
  for (const l of WAGE_ORDER_ENTRY_SCREEN_LESSONS) for (const id of l.authorityIds) cited.add(id);
  for (const s of WAGE_ORDER_ENTRY_WALKTHROUGH) for (const id of s.authorityIds) cited.add(id);
  return WAGE_ORDER_ENTRY_AUTHORITIES.map((a) => a.id).filter((id) => !cited.has(id));
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SUBSTANCE
 *
 * The gates above prove a lesson EXISTS. These prove it says something. A
 * one-word lesson satisfies a coverage count perfectly and teaches nobody
 * anything - which is the same silent-pass shape the whole suite exists to
 * prevent.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Shortest a lesson field may be before it stops being an explanation. */
export const MIN_LESSON_CHARS = 40;

export function assertEntryLessonsHaveSubstance(): void {
  const thin: string[] = [];

  const check = (label: string, text: string, min = MIN_LESSON_CHARS): void => {
    if (text.trim().length < min) thin.push(`${label} (${text.trim().length} chars)`);
  };

  for (const l of JUDGEMENT_FIELD_LESSONS) {
    check(`${l.draftField}.whereOnThePaper`, l.whereOnThePaper);
    check(`${l.draftField}.theTrap`, l.theTrap);
    check(`${l.draftField}.example`, l.example, 20);
    if (l.label.trim().length < 3) thin.push(`${l.draftField}.label is empty`);
  }
  for (const l of WAGE_ORDER_ENTRY_REFUSAL_LESSONS) {
    check(`${l.code}.headline`, l.headline, 20);
    check(`${l.code}.whyWeStop`, l.whyWeStop);
    check(`${l.code}.whatToDo`, l.whatToDo);
  }
  for (const l of WAGE_ORDER_ENTRY_SCREEN_LESSONS) {
    check(`${l.topic}.plainEnglish`, l.plainEnglish);
    check(`${l.topic}.whyItMatters`, l.whyItMatters);
  }
  for (const s of WAGE_ORDER_ENTRY_WALKTHROUGH) {
    check(`step ${s.step}.doThis`, s.doThis);
    check(`step ${s.step}.whyThisOrder`, s.whyThisOrder);
  }

  if (thin.length > 0) {
    throw new Error(
      `ENTRY MENTOR HAS LESSONS WITH NO SUBSTANCE: ${thin.join("; ")}. A lesson short enough to ` +
        `be a placeholder satisfies the coverage count and teaches nothing, which is worse than ` +
        `an obvious gap because it looks finished.`,
    );
  }
}

/**
 * The walkthrough is a sequence, so it has to actually be one.
 *
 * Steps numbered 1, 2, 2, 4 render in a confident order that skips a step, and
 * the reader has no way to tell.
 */
export function assertWalkthroughIsAnOrderedSequence(): void {
  const steps = WAGE_ORDER_ENTRY_WALKTHROUGH.map((s) => s.step);
  if (steps.length === 0) {
    throw new Error("ENTRY WALKTHROUGH GATE BROKEN: there are no steps to check.");
  }
  const expected = Array.from({ length: steps.length }, (_, i) => i + 1);
  if (JSON.stringify(steps) !== JSON.stringify(expected)) {
    throw new Error(
      `ENTRY WALKTHROUGH IS NOT A SEQUENCE: got ${steps.join(", ")}, expected ` +
        `${expected.join(", ")}. Michael follows these in order with a court order in his hand; ` +
        `a duplicated or missing number silently skips a step.`,
    );
  }
}
