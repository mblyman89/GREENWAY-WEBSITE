/**
 * src/lib/accounting/interest-mentor-gates.ts   (books-44, slice C)
 *
 * THE COVERAGE GATES FOR THE INTEREST MENTOR
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
 * The lesson data itself stays in `src/lib/accounting/interest-mentor.ts`, which is now pure and
 * browser-safe.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { MentorLesson } from "@/lib/accounting/basis-aaa-mentor";
import {
  INTEREST_LESSONS,
  taughtInterestFunctionNames,
} from "@/lib/accounting/interest-mentor";

/**
 * The exported function names in the core module, read from disk.
 *
 * Takes an optional path so a test can point it at a fixture and prove the
 * coverage gate below actually fires (rule 39).
 */
export function exportedInterestFunctionNames(sourcePath?: string): readonly string[] {
  const path = sourcePath ?? join(process.cwd(), "src/lib/accounting/interest-core.ts");
  const src = readFileSync(path, "utf8");
  const names: string[] = [];
  const re = /^export function ([A-Za-z0-9_]+)/gm;
  let m = re.exec(src);
  while (m !== null) {
    names.push(m[1]!);
    m = re.exec(src);
  }
  return names;
}

/** Every exported function has a lesson, and the gate read something real. */
export function assertEveryInterestFunctionIsTaught(sourcePath?: string): void {
  const taught = new Set(taughtInterestFunctionNames());
  const exported = exportedInterestFunctionNames(sourcePath);

  if (exported.length === 0) {
    throw new Error(
      "INTEREST MENTOR COVERAGE GATE BROKEN: read no exported functions from the core module. " +
        "A coverage gate that inspects nothing passes vacuously and protects nothing.",
    );
  }

  const untaught = exported.filter((f) => !taught.has(f));
  if (untaught.length > 0) {
    throw new Error(
      `INTEREST MENTOR COVERAGE GAP: these exported functions have no lesson: ` +
        `${untaught.join(", ")}. Standing rule 26 requires every exported function to be taught ` +
        `before it ships.`,
    );
  }
}

/** Every lesson is complete, not merely present. */
export function assertEveryInterestLessonIsSubstantive(
  lessons: readonly MentorLesson[] = INTEREST_LESSONS,
): void {
  if (lessons.length === 0) {
    throw new Error(
      "INTEREST MENTOR GATE BROKEN: given no lessons to inspect. Passing vacuously is not passing.",
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
      `INTEREST MENTOR LESSONS TOO THIN: ${thin.join(", ")}. Standing rule 26 requires a real ` +
        `explanation in every field, not a placeholder.`,
    );
  }
}
