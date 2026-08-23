/**
 * src/lib/reports/payroll-reconciliation-mentor-gates.ts   (books-44, slice C)
 *
 * THE COVERAGE GATES FOR THE PAYROLL-RECONCILIATION MENTOR
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS LIVES APART FROM THE MENTOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Standing rule 65b. These gates call `readFileSync`, and as of slice C the
 * mentor's lesson data is rendered on a screen Michael can open. In books-33
 * that combination dragged `node:fs` into a browser bundle and Turbopack
 * refused every Vercel deployment -
 *
 *     the chunking context (unknown) does not support external modules
 *     (request: node:fs)
 *
 * - while GitHub Actions stayed green, because CI runs vitest and the
 * migrations and never once runs `next build`. Michael could not see several
 * slices of finished work.
 *
 * NOTHING HERE IS WEAKER THAN IT WAS INSIDE THE MENTOR. The code below was
 * moved byte-for-byte, not rewritten. The strictness simply now lives where a
 * browser cannot reach it. `tests/compliance/client-bundle-purity.test.ts`
 * walks the client component graph and fails if any `"use client"` file can
 * reach this module, and separately asserts that these gates are still CALLED
 * by the suite - because a gate that moved out of the way and stopped running
 * is standing rule 50, dead code wearing a green check, which is the exact
 * failure slice C exists to end.
 *
 * WHY THESE GATES READ FROM DISK AT ALL. A hand-typed list of function names
 * passes forever after somebody adds one and forgets the lesson. Every gate
 * below parses the real engine, and every gate REFUSES when it parses nothing,
 * because a coverage gate that inspects an empty list approves everything
 * (standing rule 39).
 *
 * The lesson data itself stays in `src/lib/reports/payroll-reconciliation-mentor.ts`, which is now pure and
 * browser-safe.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  RECONCILIATION_LESSONS,
  reconciliationTaughtFunctionNames,
} from "@/lib/reports/payroll-reconciliation-mentor";
import type { MentorLesson } from "@/lib/reports/reports-presentation-mentor";

/** The two core modules this mentor layer is responsible for covering. */
const COVERED_MODULES: readonly string[] = [
  "payroll-reconciliation-report-core.ts",
  "known-good-quarters.ts",
];
export function reconciliationExportedFunctionNames(): readonly string[] {
  const names: string[] = [];
  for (const file of COVERED_MODULES) {
    const src = readFileSync(join(process.cwd(), "src", "lib", "reports", file), "utf8");
    const re = /^export function ([A-Za-z_$][A-Za-z0-9_$]*)/gm;
    let m: RegExpExecArray | null = re.exec(src);
    while (m !== null) {
      names.push(m[1]);
      m = re.exec(src);
    }
  }
  return names;
}

/**
 * THE COVERAGE GATE (standing rule 26), across BOTH modules.
 *
 * Fails the same three ways as its siblings: a vacuous read, an untaught
 * export, and a lesson for code that no longer exists.
 */
export function assertEveryReconciliationFunctionIsTaught(): void {
  const exported = reconciliationExportedFunctionNames();
  if (exported.length === 0) {
    throw new Error(
      `payroll-reconciliation-mentor: found NO exported functions across ${COVERED_MODULES.join(" and ")}. ` +
        "The coverage gate cannot read the source, so it would pass without checking anything.",
    );
  }

  const taught = new Set(reconciliationTaughtFunctionNames());
  const untaught = exported.filter((n) => !taught.has(n));
  if (untaught.length > 0) {
    throw new Error(
      `payroll-reconciliation-mentor: these exported functions have no lesson: ${untaught.join(", ")}. ` +
        "A reconciliation function that ships without an explanation is an unfinished function (standing rule 26).",
    );
  }

  const exportedSet = new Set(exported);
  const orphans = reconciliationTaughtFunctionNames().filter((n) => !exportedSet.has(n));
  if (orphans.length > 0) {
    throw new Error(
      `payroll-reconciliation-mentor: these lessons teach functions that no longer exist: ${orphans.join(", ")}. ` +
        "A mentor layer that describes deleted code teaches something false.",
    );
  }
}

/**
 * EVERY LESSON IS COMPLETE, NOT MERELY PRESENT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FUNCTION REAPPEARED IN BOOKS-44
 * ─────────────────────────────────────────────────────────────────────────────
 * When this gate file was carved out of the mentor in slice C, `RECONCILIATION_
 * LESSONS` came across in the import list but nothing in the new file used it.
 * ESLint reported it as an unused variable, and the quick fix - the one that
 * makes the warning go away in five seconds - was to delete the import.
 *
 * That would have been standing rule 12 exactly: silently plugging a hole. The
 * unused import was not noise, it was the FOOTPRINT of a check that got lost in
 * the split. Both sibling gates (`interest-mentor-gates`, `s-corporation-year-
 * mentor-gates`) assert their lessons are substantive; this one had stopped.
 * The counterpart is restored here rather than the evidence being erased.
 *
 * The 40-character floor is the house figure used by both siblings. A one-word
 * `theTrap` renders on the learning screen as a large orange box containing
 * almost nothing, which reads as "there is no trap here" - the opposite of the
 * truth in most cases.
 */
export function assertEveryReconciliationLessonIsSubstantive(
  lessons: readonly MentorLesson[] = RECONCILIATION_LESSONS,
): void {
  if (lessons.length === 0) {
    throw new Error(
      "RECONCILIATION MENTOR GATE BROKEN: given no lessons to inspect. Passing vacuously is " +
        "not passing (standing rule 39).",
    );
  }
  const thin: string[] = [];
  for (const l of lessons) {
    const fields: Array<[string, string]> = [
      ["plainEnglish", l.plainEnglish],
      ["whyItExists", l.whyItExists],
      ["theTrap", l.theTrap],
      ["whatIWouldDo", l.whatIWouldDo],
    ];
    for (const [name, value] of fields) {
      if (value.trim().length < 40) thin.push(`${l.fn}.${name}`);
    }
  }
  if (thin.length > 0) {
    throw new Error(
      `RECONCILIATION MENTOR LESSONS TOO THIN: ${thin.join(", ")}. Standing rule 26 requires a ` +
        `real explanation in every field, not a placeholder.`,
    );
  }
}
