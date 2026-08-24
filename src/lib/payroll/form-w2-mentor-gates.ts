/**
 * src/lib/payroll/form-w2-mentor-gates.ts   (books-46)
 *
 * THE RULE-26 COVERAGE GATES FOR THE W-2 / W-3 MENTOR.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEPARATE FILE FROM form-w2-mentor.ts
 * ───────────────────────────────────────────────────────────────────────────
 * Everything here does file I/O. The mentor's lesson data is reachable from
 * client components — that is the whole point of it. In books-33 the two lived
 * in one file, `node:fs` reached a browser bundle, and every deployment broke
 * while CI stayed green. Standing rule 65b.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THESE GATES USE THE SHARED HELPERS RATHER THAN THEIR OWN REGEXES
 * ───────────────────────────────────────────────────────────────────────────
 * `exportedFunctionNames` has been widened three times, each time because a
 * private copy recognised one SYNTAX for exporting rather than the FACT of
 * being exported — first `export async function`, then `export { name }`. A
 * private copy cannot inherit those fixes. This file adds no new copy
 * (standing rule 23: fix the class, then USE the fixed thing).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY EVERY GATE REFUSES ON AN EMPTY READ
 * ───────────────────────────────────────────────────────────────────────────
 * A coverage gate that parses nothing finds nothing untaught and reports
 * perfect coverage. That is standing rule 39, and it is the failure mode these
 * gates are most likely to suffer — the usual cause is a file being renamed,
 * not the logic going wrong.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  exportedFunctionNames,
  stripTypeScriptComments,
} from "@/lib/payroll/mentor-quote-gate";
import {
  FORM_W2_CHECKS,
  FORM_W2_LESSONS,
  FORM_W2_REFUSAL_LESSONS,
  FORM_W2_WORKED_EXAMPLES,
  w2TaughtFunctionNames,
} from "@/lib/payroll/form-w2-mentor";
import type {
  MentorLesson,
  W2Check,
  W2WorkedExample,
} from "@/lib/payroll/form-w2-mentor";

const ROOT = process.cwd();
const CORE = join(ROOT, "src/lib/payroll/form-w2-core.ts");
const MENTOR = join(ROOT, "src/lib/payroll/form-w2-mentor.ts");

/**
 * The engine's exported functions, read from disk.
 *
 * Deliberately NOT a hand-typed list: a hand-typed list passes forever after
 * somebody adds a sixteenth function and forgets to teach it.
 */
export function w2EngineFunctionNames(): readonly string[] {
  return exportedFunctionNames(CORE, "FORM W-2");
}

/**
 * Every refusal code in the engine's TypeScript UNION, parsed from source.
 *
 * WHY THE UNION AND NOT THE RUNTIME ARRAY. `form-w2-core.ts` declares its codes
 * twice — once as a union (which does not exist at runtime and cannot be
 * iterated) and once as `ALL_W2_REFUSAL_CODES`. Two declarations of one fact
 * can disagree. A code present in the union but missing from the array would
 * still be emitted by the engine and still reach the screen, while a gate
 * reading only the array would report it fully taught.
 *
 * Comments are stripped first, because a semicolon inside a doc-comment between
 * two union members truncates the scrape — the exact defect that once made a
 * pay-run refusal code invisible to its own gate.
 */
export function w2UnionRefusalCodes(): readonly string[] {
  const src = stripTypeScriptComments(readFileSync(CORE, "utf8"));
  const m = src.match(/export type W2RefusalCode\s*=([\s\S]*?);/);
  if (!m) {
    throw new Error(
      "FORM W-2 UNION GATE BROKEN: could not find `export type W2RefusalCode` in " +
        `${CORE}. A gate that parses no codes finds none untaught and approves everything.`,
    );
  }
  const codes = [...m[1].matchAll(/"([A-Z0-9_]+)"/g)].map((x) => x[1]);
  if (codes.length === 0) {
    throw new Error(
      "FORM W-2 UNION GATE BROKEN: found the union declaration but read zero members from it.",
    );
  }
  return codes;
}

/**
 * Prove every exported engine function has a lesson, and every lesson names a
 * function that still exists.
 *
 * BOTH DIRECTIONS ON PURPOSE. A lesson beside a function that was renamed reads
 * as reassurance while covering nothing, and it is the more dangerous of the
 * two failures because the lesson count still looks right.
 */
export function assertEveryW2FunctionIsTaught(
  /**
   * Substitute inputs, used ONLY by the tests that prove this gate can fail.
   *
   * WHY THIS PARAMETER EXISTS. The first version of this module's tests proved
   * "the gate would notice an untaught function" by re-implementing the
   * set-difference inline in the test body. That proves the TEST's copy of the
   * logic works; it says nothing about the gate. A mutation campaign confirmed
   * it: deleting the orphan check from this function left the suite green.
   * Injecting the data instead means the failure tests drive THIS code.
   */
  inject?: { readonly exported?: readonly string[]; readonly taught?: readonly string[] },
): void {
  const exported = inject?.exported ?? w2EngineFunctionNames();
  if (exported.length === 0) {
    throw new Error(
      "FORM W-2 COVERAGE GATE BROKEN: read zero exported functions from the engine.",
    );
  }
  const taught = new Set(inject?.taught ?? w2TaughtFunctionNames());

  const untaught = exported.filter((fn) => !taught.has(fn));
  if (untaught.length > 0) {
    throw new Error(
      `form-w2 mentor: ${untaught.length} exported function(s) have no lesson: ` +
        `${untaught.join(", ")}. An exported function nobody has explained is a function whose ` +
        `behaviour lives only in its implementation.`,
    );
  }

  const exportedSet = new Set(exported);
  const orphans = [...taught].filter((fn) => !exportedSet.has(fn));
  if (orphans.length > 0) {
    throw new Error(
      `form-w2 mentor: lesson(s) for ${orphans.join(", ")} name functions the engine no longer ` +
        `exports. Dead teaching is standing rule 50 wearing a mentor's hat.`,
    );
  }
}

/** Prove the refusal union and the runtime array agree. */
export function assertW2UnionMatchesRuntimeArray(
  runtimeCodes: readonly string[],
): void {
  const union = [...w2UnionRefusalCodes()].sort();
  const runtime = [...runtimeCodes].sort();
  if (union.length !== runtime.length || union.some((c, i) => c !== runtime[i])) {
    throw new Error(
      `form-w2: the refusal UNION and ALL_W2_REFUSAL_CODES disagree.\n` +
        `  union  : ${union.join(", ")}\n` +
        `  runtime: ${runtime.join(", ")}\n` +
        `A code in one and not the other is a code that can be emitted and never explained.`,
    );
  }
}

/** Prove every refusal code the engine can emit has a lesson attached. */
export function assertEveryW2RefusalIsTaught(
  /** Substitute inputs; see the note on `assertEveryW2FunctionIsTaught`. */
  inject?: { readonly union?: readonly string[]; readonly taughtCodes?: readonly string[] },
): void {
  const union = inject?.union ?? w2UnionRefusalCodes();
  const taught = new Set(
    inject?.taughtCodes ?? FORM_W2_REFUSAL_LESSONS.map((l) => l.code as string),
  );
  const missing = union.filter((c) => !taught.has(c));
  if (missing.length > 0) {
    throw new Error(
      `form-w2 mentor: ${missing.length} refusal code(s) have no lesson: ${missing.join(", ")}. ` +
        `A refusal Michael cannot act on is a dead end.`,
    );
  }
  const unionSet = new Set(union);
  const stale = [...taught].filter((c) => !unionSet.has(c));
  if (stale.length > 0) {
    throw new Error(
      `form-w2 mentor: lesson(s) for ${stale.join(", ")} describe refusals the engine cannot emit.`,
    );
  }
}

/**
 * The mentor must stay client-safe.
 *
 * This is the gate that would have caught books-33 before deployment rather
 * than after: any filesystem or path import in the lesson module means the
 * module cannot be bundled for the browser.
 */
export function assertW2MentorIsClientSafe(
  /**
   * Substitute source text, used ONLY to prove this gate rejects a real
   * violation. Without it the only way to test the failure path is to actually
   * add `node:fs` to the mentor file, which no test should do.
   */
  injectSource?: string,
): void {
  const src = injectSource ?? readFileSync(MENTOR, "utf8");
  if (src.trim().length === 0) {
    throw new Error("FORM W-2 CLIENT-SAFETY GATE BROKEN: read an empty mentor file.");
  }
  const banned = ["node:fs", "node:path", "fs/promises", "server-only"];
  for (const b of banned) {
    if (src.includes(`"${b}"`)) {
      throw new Error(
        `form-w2 mentor imports "${b}". The lesson data is rendered by client components; ` +
          `a filesystem import here breaks the bundle at deploy time while CI stays green ` +
          `(standing rule 65b). Put the gate in form-w2-mentor-gates.ts instead.`,
      );
    }
  }
}

/**
 * The checklist has to be usable, which is a stronger claim than "present".
 *
 * Each item needs a distinct order, a question, a physical action, and a
 * stated cost. "Verify the data" is not an action — it is the instruction to
 * do the thing you were already trying to do.
 */
export function assertW2ChecklistIsUsable(
  /** Substitute checklist; see the note on `assertEveryW2FunctionIsTaught`. */
  injectChecks?: readonly W2Check[],
): void {
  const checks = injectChecks ?? FORM_W2_CHECKS;
  if (checks.length === 0) {
    throw new Error("form-w2 mentor: the pre-filing checklist is empty.");
  }
  const orders = new Set<number>();
  for (const c of checks) {
    if (orders.has(c.order)) {
      throw new Error(`form-w2 mentor: two checklist items share order ${c.order}.`);
    }
    orders.add(c.order);
    if (!c.question.trim().endsWith("?")) {
      throw new Error(`form-w2 mentor: checklist item "${c.key}" is not phrased as a question.`);
    }
    // ORDER MATTERS HERE, and it was wrong on the first attempt.
    //
    // The non-action check used to run AFTER the length check. Every string it
    // can match ("verify the data", "check the data") is shorter than the
    // 40-character floor, so the length check always fired first and this
    // branch could never be reached — standing rule 43, a refusal that no
    // input can trigger. The test that proved it exists below. Content is
    // judged before length.
    if (/^\s*(?:verify|check|review|confirm) the (?:data|numbers|figures)\.?\s*$/i.test(c.howToCheck)) {
      throw new Error(
        `form-w2 mentor: checklist item "${c.key}" says "${c.howToCheck.trim()}", which is not an ` +
          `action. It restates the task instead of naming the thing to physically do.`,
      );
    }
    for (const [field, value] of [
      ["whyThisOrder", c.whyThisOrder],
      ["howToCheck", c.howToCheck],
      ["ifItFails", c.ifItFails],
    ] as const) {
      if (value.trim().length < 40) {
        throw new Error(
          `form-w2 mentor: checklist item "${c.key}" has a ${field} too short to be useful.`,
        );
      }
    }
  }
}

/**
 * Worked examples must actually be worked (standing rules 82-84a).
 *
 * The failure this guards against is an "example" that states a conclusion and
 * skips the arithmetic. Requiring several steps AND digits inside them means a
 * summary cannot masquerade as a derivation.
 */
export function assertW2ExamplesAreWorked(
  /** Substitute examples; see the note on `assertEveryW2FunctionIsTaught`. */
  injectExamples?: readonly W2WorkedExample[],
): void {
  const examples = injectExamples ?? FORM_W2_WORKED_EXAMPLES;
  if (examples.length === 0) {
    throw new Error("form-w2 mentor: there are no worked examples.");
  }
  for (const ex of examples) {
    if (ex.steps.length < 3) {
      throw new Error(
        `form-w2 mentor: example "${ex.key}" has ${ex.steps.length} step(s). An example with no ` +
          `middle is a conclusion.`,
      );
    }
    const withNumbers = ex.steps.filter((s) => /\d/.test(s)).length;
    if (withNumbers < 2) {
      throw new Error(
        `form-w2 mentor: example "${ex.key}" has almost no arithmetic in its steps.`,
      );
    }
    if (ex.theLesson.trim().length < 60) {
      throw new Error(
        `form-w2 mentor: example "${ex.key}" does not say what it is teaching.`,
      );
    }
  }
}

/**
 * Every lesson must teach, not merely describe.
 *
 * The trap field is the one that carries the value — it is where the thing that
 * costs money lives. An empty one means the lesson is a paraphrase of the
 * function name.
 */
export function assertW2LessonsAreSubstantive(
  /** Substitute lessons; see the note on `assertEveryW2FunctionIsTaught`. */
  injectLessons?: readonly MentorLesson[],
): void {
  const lessons = injectLessons ?? FORM_W2_LESSONS;
  if (lessons.length === 0) {
    throw new Error("form-w2 mentor: there are no lessons.");
  }
  for (const l of lessons) {
    for (const [field, value] of [
      ["plainEnglish", l.plainEnglish],
      ["whyItExists", l.whyItExists],
      ["theTrap", l.theTrap],
      ["whatIWouldDo", l.whatIWouldDo],
    ] as const) {
      if (value.trim().length < 40) {
        throw new Error(
          `form-w2 mentor: lesson for ${l.fn} has a ${field} too short to teach anything.`,
        );
      }
    }
  }
}

/**
 * Every authority a lesson cites must resolve to a real record.
 *
 * A citation to an id that does not exist renders as a dead link under the
 * words "read the original", which is worse than no citation: it looks like the
 * claim was sourced.
 */
export function assertEveryW2CitationResolves(
  knownIds: readonly string[],
  /** Substitute lessons; see the note on `assertEveryW2FunctionIsTaught`. */
  injectLessons?: readonly MentorLesson[],
): void {
  if (knownIds.length === 0) {
    throw new Error(
      "FORM W-2 CITATION GATE BROKEN: handed zero known authority ids, so every citation would " +
        "fail or none would be checked.",
    );
  }
  const known = new Set(knownIds);
  const bad: string[] = [];
  for (const l of injectLessons ?? FORM_W2_LESSONS) {
    for (const id of l.authorityIds) if (!known.has(id)) bad.push(`${l.fn} -> ${id}`);
  }
  if (bad.length > 0) {
    throw new Error(
      `form-w2 mentor: ${bad.length} citation(s) name no existing authority: ${bad.join(", ")}.`,
    );
  }
}

/**
 * The mentor must never tell Michael to make the boxes agree.
 *
 * This is the module's whole subject. Box 1 legitimately differs from boxes 3
 * and 5 in two different directions, and the single most common S-corporation
 * W-2 error is somebody "fixing" that. A sentence of advice that drifted toward
 * "make them match" would undo the engine.
 */
export function assertW2NeverAdvisesForcingBoxesToMatch(
  /**
   * Substitute prose, used ONLY to prove this gate rejects the advice it
   * exists to reject. The alternative — writing the forbidden sentence into
   * the real mentor to watch the gate fire — would leave it there if the test
   * were ever deleted.
   */
  injectText?: readonly string[],
): void {
  const haystack = injectText ?? [
    ...FORM_W2_LESSONS.flatMap((l) => [l.plainEnglish, l.whyItExists, l.theTrap, l.whatIWouldDo]),
    ...FORM_W2_CHECKS.flatMap((c) => [c.question, c.whyThisOrder, c.howToCheck, c.ifItFails]),
    ...FORM_W2_REFUSAL_LESSONS.flatMap((l) => [l.whatHappened, l.howToFix, l.whyWeRefuse]),
  ];
  if (haystack.length === 0) {
    throw new Error(
      "FORM W-2 ADVICE GATE BROKEN: handed no prose to scan, so no bad advice could be found.",
    );
  }
  const banned = [
    /adjust box 1 (?:so|until) it matches/i,
    /make box 1 (?:equal|match) box [35]/i,
    /force the boxes to (?:match|agree)/i,
    /change box [35] to match box 1/i,
  ];
  for (const text of haystack) {
    for (const re of banned) {
      if (re.test(text)) {
        throw new Error(
          `form-w2 mentor: advice tells the reader to force the wage boxes to agree ("${text.slice(0, 80)}..."). ` +
            `That is the error this entire module exists to prevent.`,
        );
      }
    }
  }
}
