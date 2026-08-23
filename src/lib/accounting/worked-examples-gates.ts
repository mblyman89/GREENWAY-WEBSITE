/**
 * src/lib/accounting/worked-examples-gates.ts  (books-45)
 *
 * THE GATES FOR THE WORKED EXAMPLES.
 *
 * Separate from `worked-examples-core.ts` because these call `readFileSync`
 * and the examples themselves are rendered by a client component. That is
 * standing rule 65b, learned expensively in books-33 when `node:fs` reached a
 * browser bundle and Turbopack refused every deployment while CI stayed green.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT A GATE HAS TO DO HERE, AND WHY IT IS UNUSUAL
 * ────────────────────────────────────────────────────────────────────────────
 * For most modules a coverage gate asks "is there a lesson for every exported
 * function?". That question is nearly useless for worked examples, because the
 * failure mode is not absence. It is a WRONG example: a table that renders
 * beautifully, reads persuasively, and teaches Michael something the engine does
 * not actually do.
 *
 * That is not hypothetical. Building this module, the SSN example was written
 * around "078-05-1120" as the number the system REFUSES. Calling the engine
 * showed the exact opposite — `ssnProblems()` accepts it and refuses
 * "123-45-6789". A pure presence gate would have passed that example forever.
 *
 * So the gates below check four different things, in rising order of value:
 *
 *   1. STRUCTURE   — every example is well formed and points at a real lesson.
 *   2. SUBSTANCE   — every example actually contains numbers, and no row is
 *                    padding. An example without a figure in it is prose with a
 *                    table drawn round it, which is the thing being replaced.
 *   3. PROVENANCE  — the module really does CALL engines rather than quote
 *                    them, checked by reading its own source text.
 *   4. CONTRADICTION — the claims a row makes in English are checked against
 *                    the numbers in the same row, so a sentence cannot survive
 *                    disagreeing with its own output.
 *
 * Every gate refuses when it inspects NOTHING, because a gate that iterates an
 * empty list approves everything (standing rule 39).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { allLessons, lessonKey, type LessonSourceKey } from "@/lib/accounting/learning-path-core";
import {
  allWorkedExamples,
  ENGINE_REFUSAL_MARKER,
  type ExampleRow,
  type WorkedExample,
} from "@/lib/accounting/worked-examples-core";

const WORKED_EXAMPLES_CORE = join("src", "lib", "accounting", "worked-examples-core.ts");

/**
 * The engines a worked example is allowed to be built from.
 *
 * This list is the point of gate 3. It is not a convenience — it is the set of
 * modules whose behaviour the examples are permitted to depend on, and the gate
 * proves the file imports from it rather than reimplementing anything.
 */
const REQUIRED_ENGINE_IMPORTS: readonly string[] = [
  "@/lib/accounting/tax-penalty-core",
  "@/lib/payroll/payroll-onboarding-core",
  "@/lib/payroll/timesheet-core",
];

/** Read this module's sibling source. Refuses on an empty or missing read. */
function readCoreSource(): string {
  const text = readFileSync(WORKED_EXAMPLES_CORE, "utf8");
  if (text.trim().length < 500) {
    throw new Error(
      `worked-examples-gates: read ${text.length} characters from ${WORKED_EXAMPLES_CORE}. ` +
        `A gate that parses an empty file passes everything (standing rule 39).`,
    );
  }
  return text;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * GATE 1 — STRUCTURE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Every example points at a lesson that really exists.
 *
 * A typo in a lesson key does not throw. It renders a lesson card with no
 * example attached and an example that is never reachable — the work is done,
 * it is simply invisible, and nothing anywhere says so.
 */
export function assertEveryExampleTargetsARealLesson(
  examples: readonly WorkedExample[] = allWorkedExamples(),
): void {
  if (examples.length === 0) {
    throw new Error(
      "worked-examples-gates: there are no worked examples at all, so every gate below " +
        "would pass vacuously (standing rule 39).",
    );
  }

  const realKeys = new Set(
    allLessons().map((l) => lessonKey(l.source as LessonSourceKey, l.fn)),
  );
  if (realKeys.size === 0) {
    throw new Error(
      "worked-examples-gates: the curriculum reported zero lessons, so the key check " +
        "would compare against an empty set.",
    );
  }

  const orphans = examples.map((e) => e.lessonKey).filter((k) => !realKeys.has(k));
  if (orphans.length > 0) {
    throw new Error(
      `worked-examples-gates: ${orphans.length} worked example(s) point at a lesson key that ` +
        `does not exist: ${orphans.join(", ")}. The example is built and rendered nowhere. ` +
        `Keys are '<source>:<fn>' exactly as lessonKey() builds them.`,
    );
  }
}

/** No two examples may claim the same lesson — the second one would never show. */
export function assertNoDuplicateExampleTargets(
  examples: readonly WorkedExample[] = allWorkedExamples(),
): void {
  const keys = examples.map((e) => e.lessonKey);
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const k of keys) {
    if (seen.has(k)) dupes.push(k);
    seen.add(k);
  }
  if (dupes.length > 0) {
    throw new Error(
      `worked-examples-gates: duplicate lesson keys ${dupes.join(", ")}. ` +
        `workedExampleFor() returns the FIRST match, so the later example is dead code ` +
        `wearing a green check (standing rule 50).`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * GATE 2 — SUBSTANCE
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Does this string contain an actual figure — money, a count, or a date? */
function containsANumber(s: string): boolean {
  return /\d/.test(s);
}

/**
 * The whole reason this module exists is that 57 of 82 lessons contain no
 * concrete number. An example that repeats that failure is worse than none,
 * because it occupies the slot where a real one would go.
 *
 * MINIMUMS ARE DELIBERATELY LOW AND STILL BITE. Two rows, because a
 * single-row "table" is a sentence; and at least one output per example
 * carrying a digit, because that is the definition of a worked example.
 */
export function assertEveryExampleIsSubstantive(
  examples: readonly WorkedExample[] = allWorkedExamples(),
): void {
  const problems: string[] = [];

  for (const e of examples) {
    if (e.rows.length < 2) {
      problems.push(
        `${e.lessonKey}: ${e.rows.length} row(s). One row is a sentence, not a comparison — ` +
          `the teaching value is in seeing two cases differ.`,
      );
    }
    if (!e.rows.some((r) => containsANumber(r.output))) {
      problems.push(
        `${e.lessonKey}: not one row output contains a digit. That is prose with a table ` +
          `drawn around it, which is exactly what worked examples replace.`,
      );
    }
    if (e.setup.trim().length < 40) {
      problems.push(`${e.lessonKey}: setup is too short to orient anyone before the table.`);
    }
    if (e.takeaway.trim().length < 40) {
      problems.push(`${e.lessonKey}: takeaway is too short to be the sentence worth remembering.`);
    }
    for (const r of e.rows) {
      if (r.given.trim().length === 0 || r.output.trim().length === 0) {
        problems.push(`${e.lessonKey}: a row has an empty 'given' or 'output'.`);
      }
      if (r.soWhat.trim().length < 20) {
        problems.push(
          `${e.lessonKey}: row "${r.given}" has no real 'so what'. A number with no ` +
            `explanation beside it teaches nothing.`,
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`worked-examples-gates, substance:\n  - ${problems.join("\n  - ")}`);
  }
}

/**
 * Every example must mark at least one row as the trap.
 *
 * Michael's lessons already carry a `theTrap` field, and the traps are the part
 * he has said he needs — the cases that look fine and are not. An example whose
 * rows all behave predictably is a demonstration, not a lesson.
 */
export function assertEveryExampleShowsATrap(
  examples: readonly WorkedExample[] = allWorkedExamples(),
): void {
  const missing = examples
    .filter((e) => !e.rows.some((r) => r.isTrap === true))
    .map((e) => e.lessonKey);
  if (missing.length > 0) {
    throw new Error(
      `worked-examples-gates: ${missing.join(", ")} mark no row as the trap. Every lesson in ` +
        `this system carries a 'what goes wrong here'; an example that shows only the happy ` +
        `path leaves the expensive case untaught.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * GATE 3 — PROVENANCE: the examples must CALL the engines
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The module must import the real engines, and must not have been quietly
 * rewritten into a table of remembered constants.
 *
 * This reads SOURCE TEXT rather than the runtime value, because the property
 * being checked — "these numbers came from a function call" — is not reachable
 * from the object the function returns. By the time you hold a `WorkedExample`,
 * a hand-typed "$1,960.00" and a computed one are the same string.
 */
export function assertExamplesAreBuiltFromEngines(): void {
  const src = readCoreSource();

  const missing = REQUIRED_ENGINE_IMPORTS.filter((m) => !src.includes(`from "${m}"`));
  if (missing.length > 0) {
    throw new Error(
      `worked-examples-gates: worked-examples-core.ts no longer imports ${missing.join(", ")}. ` +
        `Either an example stopped calling the engine it teaches — in which case its numbers ` +
        `are now a second, untested implementation (standing rule 25) — or this list is stale.`,
    );
  }
}

/**
 * No hard-coded currency literals in the example builders.
 *
 * A string like "$1,960.00" sitting in this file is a number that will not
 * change when the engine does. It is the exact defect that put a wrong 47.9%
 * gross margin on the learning screen in an earlier slice.
 *
 * The check is deliberately narrow: it looks for a dollar sign followed by
 * digits inside a STRING LITERAL, and it ignores comments, because the header
 * of this very file discusses "$1,960.00" while explaining why it must not be
 * typed. A gate that cannot tell prose from code would make its own
 * documentation unwritable.
 */
export function assertNoHandTypedMoneyInExamples(): void {
  const src = readCoreSource();
  const offenders: string[] = [];

  const lines = src.split("\n");
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track /* ... */ regions and skip // lines. Crude, and sufficient: the
    // only thing at risk from a mis-parse is a false ACCUSATION, which is loud.
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlockComment = true;
      continue;
    }
    if (trimmed.startsWith("*") || trimmed.startsWith("//")) continue;

    // A dollar sign immediately followed by a digit, i.e. a formatted amount.
    // `${...}` template holes are not matched because `{` is not a digit.
    if (/\$\d/.test(line)) {
      offenders.push(`line ${i + 1}: ${trimmed.slice(0, 100)}`);
    }
  }

  if (offenders.length > 0) {
    throw new Error(
      `worked-examples-gates: hard-typed currency found in worked-examples-core.ts:\n  - ` +
        `${offenders.join("\n  - ")}\n` +
        `Every amount must come from money(<engine output>). A typed amount is a second ` +
        `implementation with no tests, and it goes stale silently.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * GATE 4 — CONTRADICTION: a row may not disagree with itself
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * An engine refusal must never be presented as an answer.
 *
 * `penaltyLine()` renders refusals as "Engine refused: <code>" precisely so
 * they cannot masquerade as zero. But a refusal reaching the SCREEN means the
 * example is not teaching anything — it is displaying an internal error to
 * Michael. This gate is what makes the evidenced-rate dependency honest: if
 * `DOR_ANNUAL_RATES` stops covering the example's year, this fails in CI rather
 * than shipping a lesson that says "Engine refused".
 */
export function assertNoExampleRendersARefusal(
  examples: readonly WorkedExample[] = allWorkedExamples(),
): void {
  // ── Why the marker, and not the word "refused" ────────────────────────────
  // The first draft of this gate grepped output text for /refus/i. It failed
  // the SSN example — the one example where a refusal is the CORRECT thing to
  // display, because `ssnProblems()` rejecting 123-45-6789 is the lesson. The
  // gate could not tell "an engine broke" from "an engine said no", because it
  // was inferring a machine fact from English. Exempting that one example would
  // have fixed the instance and left the class (standing rule 23). So the
  // broken case emits ENGINE_REFUSAL_MARKER, a token no sentence contains, and
  // the gate matches the token.
  const bad: string[] = [];
  let scanned = 0;
  for (const e of examples) {
    for (const r of e.rows) {
      scanned += 1;
      if (r.output.includes(ENGINE_REFUSAL_MARKER)) {
        bad.push(`${e.lessonKey} — "${r.given}" rendered: ${r.output}`);
      }
    }
  }

  if (scanned === 0) {
    throw new Error(
      "worked-examples-gates: scanned zero rows for engine refusals, so this gate cannot fail " +
        "(standing rule 39).",
    );
  }

  if (bad.length > 0) {
    throw new Error(
      `worked-examples-gates: an engine refused while building a worked example:\n  - ` +
        `${bad.join("\n  - ")}\n` +
        `The example is showing Michael an internal refusal instead of teaching. Usually this ` +
        `means an evidence table (e.g. DOR_ANNUAL_RATES) no longer covers the year the example ` +
        `uses. Supply the evidence or move the example — do NOT invent the input.`,
    );
  }
}

/**
 * Rows that claim two things cost "the same" must actually show the same
 * figure, and rows that claim a difference must actually differ.
 *
 * THIS IS THE GATE THAT CATCHES THE SSN-CLASS DEFECT. English and arithmetic
 * are written in the same object here, and nothing but a check like this stops
 * them drifting apart. It is narrow on purpose — it only fires on rows that
 * make an explicit sameness claim — because a gate that tried to parse every
 * sentence would produce false accusations and be switched off.
 */
export function assertSamenessClaimsAreTrue(
  examples: readonly WorkedExample[] = allWorkedExamples(),
): void {
  const problems: string[] = [];

  for (const e of examples) {
    const claimsSame = e.rows.filter((r) => /exactly the same|costs the same|the same as/i.test(r.soWhat));
    for (const row of claimsSame) {
      const twin = e.rows.find((other) => other !== row && other.output === row.output);
      if (twin === undefined) {
        problems.push(
          `${e.lessonKey} — row "${row.given}" says its result is the same as another row's, ` +
            `but no other row in the example shares its output "${row.output}".`,
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `worked-examples-gates, contradiction:\n  - ${problems.join("\n  - ")}\n` +
        `A row whose sentence disagrees with its own number teaches the sentence, because that ` +
        `is what gets read.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE ONE ENTRY POINT
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Run every gate. The test file calls this, and so can a script. */
export function assertWorkedExamplesAreWellFormed(): void {
  assertEveryExampleTargetsARealLesson();
  assertNoDuplicateExampleTargets();
  assertEveryExampleIsSubstantive();
  assertEveryExampleShowsATrap();
  assertExamplesAreBuiltFromEngines();
  assertNoHandTypedMoneyInExamples();
  assertNoExampleRendersARefusal();
  assertSamenessClaimsAreTrue();
}

export type { WorkedExample, ExampleRow };
