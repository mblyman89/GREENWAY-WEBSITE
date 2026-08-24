/**
 * src/lib/accounting/shareholder-roster-mentor-gates.ts   (books-50)
 *
 * THE COVERAGE GATES FOR THE SHAREHOLDER-ROSTER MENTOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS LIVES APART FROM THE MENTOR
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Standing rule 65b. These gates call `readFileSync`. A mentor module that
 * imports `node:fs` and is ALSO rendered on a screen made Turbopack refuse
 * every Vercel deployment in books-33 -
 *
 *     the chunking context (unknown) does not support external modules
 *     (request: node:fs)
 *
 * - while GitHub Actions stayed green, because CI runs vitest and the migrations
 * and never once runs `next build`. The strictness is unchanged; it simply
 * lives where a browser cannot reach it. `tests/compliance/client-bundle-
 * purity.test.ts` walks the client component graph and fails if any
 * `"use client"` file can reach this module.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THESE GATES READ THE ENGINE OFF DISK
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A hand-typed list of function names passes forever after somebody adds an
 * export and forgets the lesson. Parsing the real engine means the gate learns
 * about a new function whether or not anyone remembered to tell it.
 *
 * And every gate below REFUSES when it parses nothing, because a coverage gate
 * that inspects an empty list approves everything (standing rule 39). That
 * failure is not hypothetical: in books-18 a mutation that disabled a coverage
 * check survived the whole suite, because the self-check re-implemented the gate
 * instead of calling it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { MentorLesson } from "@/lib/accounting/basis-aaa-mentor";
import {
  SHAREHOLDER_ROSTER_LESSONS,
  taughtShareholderRosterFunctionNames,
} from "@/lib/accounting/shareholder-roster-mentor";

/**
 * The exported function names in the core module, read from disk.
 *
 * Takes an optional path so a test can point it at a fixture and prove the
 * coverage gate below actually fires (standing rule 16).
 */
export function exportedShareholderRosterFunctionNames(
  sourcePath?: string,
): readonly string[] {
  const path =
    sourcePath ?? join(process.cwd(), "src", "lib", "accounting", "shareholder-roster-core.ts");
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

/**
 * Every exported function has a lesson, and the gate read something real.
 *
 * Note that `__runShareholderRosterCoreTests` is NOT exempted. It is an
 * exported function, it is called by a CI gate, and standing rule 26 says every
 * exported function is taught - an exemption list is where coverage gaps go to
 * hide.
 */
export function assertEveryShareholderRosterFunctionIsTaught(sourcePath?: string): void {
  const taught = new Set(taughtShareholderRosterFunctionNames());
  const exported = exportedShareholderRosterFunctionNames(sourcePath);

  if (exported.length === 0) {
    throw new Error(
      "ROSTER MENTOR COVERAGE GATE BROKEN: read no exported functions from the core module. " +
        "A coverage gate that inspects nothing passes vacuously and protects nothing.",
    );
  }

  const untaught = exported.filter((f) => !taught.has(f));
  if (untaught.length > 0) {
    throw new Error(
      `ROSTER MENTOR COVERAGE GAP: these exported functions have no lesson: ` +
        `${untaught.join(", ")}. Standing rule 26 requires every exported function to be taught ` +
        `before it ships.`,
    );
  }
}

/**
 * Every lesson taught corresponds to a function that actually exists.
 *
 * The mirror image of the gate above, and it is not symmetry for its own sake.
 * A lesson for a function that was renamed or deleted teaches Michael about
 * machinery that is no longer there, and the coverage gate above can never
 * notice, because it only ever asks whether the taught set COVERS the exported
 * set. Standing rule 66d: assert presence alongside absence.
 */
export function assertNoLessonTeachesAPhantomFunction(sourcePath?: string): void {
  const exported = new Set(exportedShareholderRosterFunctionNames(sourcePath));

  if (exported.size === 0) {
    throw new Error(
      "ROSTER MENTOR PHANTOM GATE BROKEN: read no exported functions from the core module. " +
        "With nothing to compare against, every lesson would look like a phantom.",
    );
  }

  const taught = taughtShareholderRosterFunctionNames();
  if (taught.length === 0) {
    throw new Error(
      "ROSTER MENTOR PHANTOM GATE BROKEN: the mentor teaches nothing, so this gate would pass " +
        "vacuously. Passing vacuously is not passing.",
    );
  }

  const phantoms = taught.filter((f) => !exported.has(f));
  if (phantoms.length > 0) {
    throw new Error(
      `ROSTER MENTOR PHANTOM LESSONS: these lessons teach functions the core module does not ` +
        `export: ${phantoms.join(", ")}. Either the function was renamed and the lesson was not, ` +
        `or the lesson describes machinery that no longer exists.`,
    );
  }
}

/** Every lesson is complete, not merely present. */
export function assertEveryShareholderRosterLessonIsSubstantive(
  lessons: readonly MentorLesson[] = SHAREHOLDER_ROSTER_LESSONS,
): void {
  if (lessons.length === 0) {
    throw new Error(
      "ROSTER MENTOR GATE BROKEN: given no lessons to inspect. Passing vacuously is not passing.",
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
      `ROSTER MENTOR LESSONS TOO THIN: ${thin.join(", ")}. Standing rule 26 requires a real ` +
        `explanation in every field, not a placeholder.`,
    );
  }
}

/**
 * Every `authorityIds` entry resolves in the MERGED registry.
 *
 * THIS IS THE BOOKS-27 GATE and it is the reason this file exists at all beyond
 * counting lessons. In books-27 a complete authorities module with twenty-one
 * passing tests was never merged into the shared registry, so every screen
 * citing it rendered an unresolved id - and nothing failed, because the tests
 * checked the leaf array rather than the registry the UI actually reads.
 *
 * The resolver is injected rather than imported so this gate cannot be defeated
 * by the same mistake it is guarding against: the test passes the real
 * `GUIDANCE_AUTHORITIES` lookup, and can also pass a deliberately empty one to
 * prove the gate fires (standing rule 16).
 */
export function assertEveryCitedAuthorityResolves(
  resolve: (id: string) => unknown,
  lessons: readonly MentorLesson[] = SHAREHOLDER_ROSTER_LESSONS,
): void {
  if (lessons.length === 0) {
    throw new Error(
      "ROSTER MENTOR CITATION GATE BROKEN: given no lessons to inspect. Passing vacuously is not " +
        "passing.",
    );
  }

  const cited = lessons.flatMap((l) => l.authorityIds);
  if (cited.length === 0) {
    throw new Error(
      "ROSTER MENTOR CITATION GATE BROKEN: no lesson cites any authority, so this gate would " +
        "check nothing. A mentor layer with no citations is prose, not guidance.",
    );
  }

  const unresolved: string[] = [];
  for (const l of lessons) {
    for (const id of l.authorityIds) {
      if (resolve(id) === undefined) unresolved.push(`${l.fn} -> ${id}`);
    }
  }
  if (unresolved.length > 0) {
    throw new Error(
      `ROSTER MENTOR UNRESOLVED CITATIONS: ${unresolved.join(", ")}. Every cited id must exist in ` +
        `the MERGED guidance registry, not merely in a leaf authorities module - an authorities ` +
        `array that nothing merges renders as a broken citation on every screen (books-27).`,
    );
  }
}
