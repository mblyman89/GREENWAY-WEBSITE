/**
 * src/lib/accounting/period-close-mentor-gates.ts   (books-44, slice C)
 *
 * THE COVERAGE GATES FOR THE PERIOD-CLOSE MENTOR
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
 * The lesson data itself stays in `src/lib/accounting/period-close-mentor.ts`, which is now pure and
 * browser-safe.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PERIOD_CLOSE_LESSONS,
  taughtFunctionNames,
  type MentorLesson,
} from "@/lib/accounting/period-close-mentor";

export function exportedCoreFunctionNames(sourcePath?: string): readonly string[] {
  const path =
    sourcePath ?? join(process.cwd(), "src", "lib", "accounting", "period-close-core.ts");
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
 * In books-17 the equivalent gate caught two functions that had genuinely been
 * forgotten. It is the reason rule 26 is enforceable rather than aspirational.
 *
 * `sourcePath` exists so a TEST can point this at a file it controls and prove
 * the gate actually fires. Without it the only available self-check was one
 * that re-implemented this logic and asserted on the copy \u2014 which is how a
 * mutation replacing the condition below with `if (false)` survived the entire
 * suite. Standing rule 16: prove the gate is WIRED, not merely present.
 */
export function assertEveryExportedFunctionIsTaught(sourcePath?: string): void {
  const taught = new Set(taughtFunctionNames());
  const exported = exportedCoreFunctionNames(sourcePath);

  // A gate that reads nothing approves everything. If the regex stops matching
  // \u2014 a formatting change, a move to arrow exports \u2014 this must shout rather
  // than quietly pass forever.
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
 * EVERY LESSON IS COMPLETE, NOT MERELY PRESENT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FUNCTION REAPPEARED IN BOOKS-44
 * ─────────────────────────────────────────────────────────────────────────────
 * Same story as its sibling in `reports/payroll-reconciliation-mentor-gates.ts`,
 * found the same way. When this file was carved out of the mentor in slice C,
 * `PERIOD_CLOSE_LESSONS` came across in the import list and nothing used it.
 * An unused import is easy to delete and the warning goes away; but it was the
 * FOOTPRINT of a substantiveness check that got lost in the split, not noise.
 * Deleting it would have been standing rule 12 - silently plugging a hole.
 *
 * `interest-mentor-gates` and `s-corporation-year-mentor-gates` both assert
 * this. Restored here so all four splits carry the same guarantee.
 */
export function assertEveryPeriodCloseLessonIsSubstantive(
  lessons: readonly MentorLesson[] = PERIOD_CLOSE_LESSONS,
): void {
  if (lessons.length === 0) {
    throw new Error(
      "PERIOD CLOSE MENTOR GATE BROKEN: given no lessons to inspect. Passing vacuously is not " +
        "passing (standing rule 39).",
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
      `PERIOD CLOSE MENTOR LESSONS TOO THIN: ${thin.join(", ")}. Standing rule 26 requires a ` +
        `real explanation in every field, not a placeholder.`,
    );
  }
}
