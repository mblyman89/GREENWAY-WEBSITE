/**
 * MENTOR QUOTE GATE — shared machinery for "the lesson this map names must exist".
 *
 * books-36. WHY THIS FILE EXISTS
 *
 * Every mentor module in this codebase carries a `*_CORE_FUNCTION_COVERAGE`
 * map: a plain object saying, for each exported engine function, WHERE the
 * teaching for it lives. Entries read like
 *
 *   planDraw: "Taught by the drawn_from field lesson and the two-buckets
 *              screen lesson: earned hours are spent first ..."
 *
 * and, where they name a specific lesson, they quote its title in
 * 'single quotes'.
 *
 * The coverage gates already prove three things: every exported function has
 * an entry, no entry outlives its function, and no entry is a one-line
 * restatement of the function name. None of those notice when the LESSON an
 * entry quotes has been deleted or retitled. That was found by mutation on
 * books-36: removing the screen lesson "A negative balance is a finding, not a
 * rounding problem" from `sick-leave-mentor.ts` left the entire suite green,
 * while the coverage map went on confidently telling a reader that the
 * teaching for `generosityLineFor` lived in a lesson that no longer existed.
 *
 * That is a citation with nothing behind it, which is the precise failure mode
 * `assertEveryCitedSickAuthorityExists` was written to prevent for legal
 * authorities — reproduced one layer up, for lessons, in four separate
 * modules. Standing rule 23 says fix the CLASS, not the instance, so the check
 * is written once here and called by each module's gates file rather than
 * copied four times and fixed three times.
 *
 * WHY THIS READS SOURCE TEXT RATHER THAN THE OBJECT
 *
 * The thing being verified is prose INSIDE the strings. A quoted lesson title
 * is not reachable from the runtime value in any structured way, so the gate
 * re-reads the gates file from disk and harvests the quoted spans. That also
 * means the gate stays honest if somebody adds a new entry quoting a new
 * lesson: no registration step, nothing to remember.
 *
 * WHY MATCHING IS BY PREFIX
 *
 * Some entries quote a title in abbreviated form — 'The greater of' stands in
 * for the full lesson "The greater of — three words that only matter on the
 * day they matter". Requiring exact equality would fail on entries that are
 * entirely correct, and a gate that fails on correct input gets weakened or
 * deleted within a week. Prefix matching is the loosest rule that still
 * catches a deleted or retitled lesson, which is the defect actually being
 * defended against.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type QuotedLessonGateArgs = {
  /** Repo-relative path of the gates file whose coverage map is inspected. */
  readonly gatesSourcePath: string;
  /** The exported const to slice out, e.g. "SICK_CORE_FUNCTION_COVERAGE". */
  readonly mapName: string;
  /**
   * The real lesson titles.
   *
   * Injected rather than imported so this helper stays module-agnostic, and so
   * each caller's test can hand it a deliberately broken list and prove the
   * gate BITES (standing rule 16). ES module caching means deleting a lesson
   * from disk mid-test would not change an already-imported array, so
   * injection is the only honest way to prove a gate like this is wired.
   */
  readonly topics: readonly string[];
  /** Names the module in failure text, e.g. "SICK" or "GARNISHMENT". */
  readonly label: string;
};

/**
 * Harvest the lesson titles a coverage map quotes.
 *
 * Exported so a test can assert the harvest is non-trivial. A gate whose
 * extractor silently stops matching passes vacuously forever (standing rule
 * 39), and the only way to notice is to look at the count.
 *
 * Spans containing a newline are skipped deliberately: those are apostrophes
 * inside prose ("Michael's", "employee's"), not quoted titles. Spans shorter
 * than eight characters are skipped for the same reason.
 */
export function harvestQuotedLessonTitles(
  gatesSourcePath: string,
  mapName: string,
  label: string,
): readonly string[] {
  const text = readFileSync(join(process.cwd(), gatesSourcePath), "utf8");
  const start = text.indexOf(`export const ${mapName}`);
  if (start < 0) {
    throw new Error(
      `${label} LESSON-TITLE GATE BROKEN: could not find ${mapName} in ${gatesSourcePath}. A gate ` +
        `that reads nothing passes vacuously and protects nothing (standing rule 39).`,
    );
  }
  const end = text.indexOf("\n};", start);
  if (end <= start) {
    throw new Error(
      `${label} LESSON-TITLE GATE BROKEN: could not find the end of ${mapName}, so the slice ` +
        `examined would run to the end of the file. A slice that runs to EOF is correct only by ` +
        `accident, and stops being correct the moment somebody appends to the module.`,
    );
  }
  const block = text.slice(start, end);
  return [...block.matchAll(/'([^'\n]{8,})'/g)].map((m) => m[1]);
}

/**
 * THE EXPORTED FUNCTIONS OF AN ENGINE MODULE, read from its source on disk.
 *
 * books-37. WHY THIS MOVED HERE, AND THE BUG IT CARRIED.
 *
 * Eleven mentor-gate modules each had their own private copy of this scrape,
 * and all eleven copies used the same pattern:
 *
 *   /^export function ([A-Za-z0-9_]+)/gm
 *
 * That pattern cannot see `export async function`. It never mattered, because
 * every engine it had ever been pointed at was pure and synchronous - checked,
 * not assumed: nine core modules, zero async exports between them. `ytd-store.ts`
 * is the first engine in this codebase that talks to the database, so it is the
 * first whose exports are ALL async. Pointing the old pattern at it returns an
 * empty list, and an empty list is the worst possible result: the rule-26
 * coverage gate would have read zero functions, found zero of them untaught,
 * and reported full coverage over a 700-line module that teaches nothing.
 * Standing rule 39 - a gate that parses nothing approves everything - and
 * standing rule 50, dead code wearing a green check.
 *
 * The instance fix was to add `(?:async )?` in one new file. The CLASS fix,
 * which is what standing rule 23 requires, is one implementation here that all
 * of them can call, so the next person who writes an async engine inherits a
 * gate that works instead of a gate that lies. The eleven existing copies are
 * left in place for now and are provably equivalent on their own inputs; this
 * is the seam new modules are built against, and migrating them is tracked
 * work rather than a silent rewrite of eleven passing gates in a slice about
 * net pay.
 *
 * WHY IT THROWS ON AN EMPTY RESULT rather than returning `[]`. Every caller
 * would have to remember to check, and the whole point is that the failure is
 * silent. Making the scrape itself refuse means a mistyped path or a renamed
 * module fails loudly at the gate instead of quietly approving everything.
 */
export function exportedFunctionNames(
  absoluteSourcePath: string,
  label: string,
): readonly string[] {
  const text = readFileSync(absoluteSourcePath, "utf8");
  const names = [
    ...text.matchAll(/^export (?:async )?function ([A-Za-z0-9_]+)/gm),
  ].map((m) => m[1]);
  if (names.length === 0) {
    throw new Error(
      `${label} FUNCTION GATE BROKEN: read no exported functions from ${absoluteSourcePath}. ` +
        `Either the path is wrong or the module exports its functions in a form this scrape does ` +
        `not recognise (an exported arrow const, for instance). Both are silent failures: a gate ` +
        `that parses nothing finds nothing untaught and reports full coverage (standing rule 39).`,
    );
  }
  return names;
}

/**
 * Every lesson title a coverage map quotes must resolve to a real lesson.
 */
export function assertQuotedLessonsResolve(args: QuotedLessonGateArgs): void {
  const quoted = harvestQuotedLessonTitles(args.gatesSourcePath, args.mapName, args.label);
  if (quoted.length === 0) {
    throw new Error(
      `${args.label} LESSON-TITLE GATE BROKEN: ${args.mapName} quotes no lesson titles at all, so ` +
        `this gate has nothing to verify and would pass forever.`,
    );
  }
  if (args.topics.length === 0) {
    throw new Error(
      `${args.label} LESSON-TITLE GATE BROKEN: there are no lessons to check against, so every ` +
        `citation would look dangling and the failure would point at the map instead of at the ` +
        `lessons.`,
    );
  }
  const dangling = quoted.filter((q) => !args.topics.some((t) => t.startsWith(q)));
  if (dangling.length > 0) {
    throw new Error(
      `${args.label} COVERAGE MAP QUOTES LESSONS THAT DO NOT EXIST: ${dangling.join(" | ")}. The ` +
        `map tells a reader where the teaching lives; if the lesson has been deleted or ` +
        `retitled, the reader is sent somewhere empty and believes the function was explained.`,
    );
  }
}
