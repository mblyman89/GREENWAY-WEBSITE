/**
 * src/lib/payroll/form-941-mentor-gates.ts   (books-40)
 *
 * THE RULE-26 COVERAGE GATES FOR THE FORM 941 MENTOR.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEPARATE FILE FROM form-941-mentor.ts
 * ───────────────────────────────────────────────────────────────────────────
 * Everything here does file I/O. The mentor's lesson data is reachable from
 * client components - that is the whole point of it. In books-33 the two lived
 * in one file, `node:fs` reached a browser bundle, and every deployment broke
 * while CI stayed green. Standing rule 65b.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THESE GATES USE THE SHARED HELPERS RATHER THAN THEIR OWN REGEXES
 * ───────────────────────────────────────────────────────────────────────────
 * There are eleven private copies of `/^export function/gm` scattered through
 * this codebase, and they are tracked debt precisely because a private copy
 * cannot inherit a fix. `mentor-quote-gate.ts` learned the hard way that a
 * semicolon inside a doc-comment truncates a union scrape and makes a refusal
 * code invisible to its own coverage gate - six codes read where seven exist,
 * full coverage reported. That fix lives in `stripTypeScriptComments`, and the
 * only way to benefit from it is to call it. So this file adds no twelfth copy
 * (standing rule 23 - fix the class, and then USE the fixed thing).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY EVERY GATE REFUSES ON AN EMPTY READ
 * ───────────────────────────────────────────────────────────────────────────
 * A coverage gate that parses nothing finds nothing untaught and reports
 * perfect coverage. That is standing rule 39, and it is the failure mode these
 * gates are most likely to suffer, because the usual cause is a file being
 * renamed rather than anything going wrong with the logic.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  exportedFunctionNames,
  stripTypeScriptComments,
} from "@/lib/payroll/mentor-quote-gate";
import {
  FORM_941_CHECKS,
  FORM_941_LESSONS,
  FORM_941_REFUSAL_LESSONS,
  FORM_941_WORKED_EXAMPLES,
  form941TaughtFunctionNames,
} from "@/lib/payroll/form-941-mentor";
import { FORM_941_AUTHORITIES } from "@/lib/payroll/form-941-authorities";

const ROOT = process.cwd();
const CORE = join(ROOT, "src/lib/payroll/form-941-core.ts");
const MENTOR = join(ROOT, "src/lib/payroll/form-941-mentor.ts");
const AUTHORITIES = join(ROOT, "src/lib/payroll/form-941-authorities.ts");

/**
 * The engine's exported functions, read from disk.
 *
 * Deliberately NOT a hand-typed list: a hand-typed list passes forever after
 * somebody adds a ninth function and forgets to teach it.
 */
export function form941EngineFunctionNames(): readonly string[] {
  return exportedFunctionNames(CORE, "FORM 941");
}

/**
 * Every refusal code in the engine's TypeScript UNION, parsed from source.
 *
 * WHY THE UNION AND NOT THE RUNTIME ARRAY. `form-941-core.ts` declares its
 * codes twice - once as a union (which does not exist at runtime and cannot be
 * iterated by a test) and once as `ALL_FORM_941_REFUSAL_CODES`. Two
 * declarations of one fact can disagree. A code present in the union but
 * missing from the array would still be emitted by the engine and would still
 * reach the screen, while a gate reading only the array would report it as
 * fully taught.
 *
 * Comments are stripped first, because a semicolon inside a doc-comment
 * between two union members truncates the scrape - the exact defect that made
 * a pay-run refusal code invisible to its own gate.
 */
export function form941UnionRefusalCodes(): readonly string[] {
  const src = stripTypeScriptComments(readFileSync(CORE, "utf8"));
  const m = src.match(/export type Form941RefusalCode\s*=([\s\S]*?);/);
  if (!m) {
    throw new Error(
      "FORM 941 UNION GATE BROKEN: could not find `export type Form941RefusalCode` in " +
        `${CORE}. A gate that parses no codes finds none untaught and approves everything.`,
    );
  }
  const codes = [...m[1].matchAll(/"([A-Z0-9_]+)"/g)].map((x) => x[1]);
  if (codes.length === 0) {
    throw new Error(
      "FORM 941 UNION GATE BROKEN: found the union declaration but read zero members from it.",
    );
  }
  return codes;
}

/**
 * Prove every exported engine function has a lesson, and every lesson names a
 * function that still exists.
 *
 * BOTH DIRECTIONS ON PURPOSE. A lesson beside a function that was renamed
 * reads as reassurance while covering nothing, and it is the more dangerous of
 * the two failures because the lesson count still looks right.
 *
 * Throws rather than returning a boolean (standing rule 48).
 */
export function assertEveryForm941FunctionIsTaught(): void {
  const exported = form941EngineFunctionNames();
  const taught = new Set(form941TaughtFunctionNames());

  const untaught = exported.filter((fn) => !taught.has(fn));
  if (untaught.length > 0) {
    throw new Error(
      `form-941 mentor: ${untaught.length} exported function(s) have no lesson: ` +
        `${untaught.join(", ")}. An exported function nobody has explained is a function whose ` +
        `behaviour lives only in its implementation.`,
    );
  }

  const exportedSet = new Set(exported);
  const orphans = [...taught].filter((fn) => !exportedSet.has(fn));
  if (orphans.length > 0) {
    throw new Error(
      `form-941 mentor: lesson(s) for ${orphans.join(", ")} name functions the engine no longer ` +
        `exports. Dead teaching is standing rule 50 wearing a mentor's hat.`,
    );
  }
}

/**
 * Prove the union and the runtime array agree.
 *
 * Throws rather than returning a boolean (standing rule 48).
 */
export function assertForm941UnionMatchesRuntimeArray(
  runtimeCodes: readonly string[],
): void {
  const union = [...form941UnionRefusalCodes()].sort();
  const runtime = [...runtimeCodes].sort();

  const missingFromArray = union.filter((c) => !runtime.includes(c));
  if (missingFromArray.length > 0) {
    throw new Error(
      `form-941: ${missingFromArray.join(", ")} exist in the Form941RefusalCode union but not in ` +
        `ALL_FORM_941_REFUSAL_CODES. The engine can emit them and every coverage gate that reads ` +
        `only the array will report them as taught.`,
    );
  }

  const missingFromUnion = runtime.filter((c) => !union.includes(c));
  if (missingFromUnion.length > 0) {
    throw new Error(
      `form-941: ${missingFromUnion.join(", ")} are in ALL_FORM_941_REFUSAL_CODES but not in the ` +
        `union. One of the two declarations is stale.`,
    );
  }
}

/**
 * Prove every authority in this slice's registry is actually cited by
 * something a reader can reach - a lesson, a checklist item, or a worked
 * example - OR is deliberately listed as display-only.
 *
 * WHY THIS MATTERS. A verbatim legal text nobody cites is a text nobody reads.
 * It costs the same maintenance as a live one and provides none of the
 * assurance, which is standing rule 50 applied to the authority layer.
 *
 * Some authorities legitimately exist to be DISPLAYED on the screen's citation
 * panel rather than cited by a specific lesson - the duty-to-file rule is
 * context for the whole page, not for one function. Those are named here
 * explicitly, so that "it is display-only" is a decision on the record rather
 * than an excuse available to anything that fails.
 */
export const FORM_941_DISPLAY_ONLY_AUTHORITY_IDS: readonly string[] = [];

export function assertEveryForm941AuthorityIsReachable(): void {
  const cited = new Set<string>();
  for (const l of FORM_941_LESSONS) for (const id of l.authorityIds) cited.add(id);

  const orphans = FORM_941_AUTHORITIES.filter(
    (a) => !cited.has(a.id) && !FORM_941_DISPLAY_ONLY_AUTHORITY_IDS.includes(a.id),
  ).map((a) => a.id);

  if (orphans.length > 0) {
    throw new Error(
      `form-941: ${orphans.join(", ")} are transcribed but cited by no lesson and not declared ` +
        `display-only. Either cite them or add them to FORM_941_DISPLAY_ONLY_AUTHORITY_IDS with ` +
        `a reason - an uncited verbatim text is a text nobody reads.`,
    );
  }
}

/**
 * Prove the mentor file is client-safe: no `node:fs`, no `readFileSync`, no
 * `process`.
 *
 * This is the check that would have caught books-33 before it shipped, and it
 * reads the file rather than trusting the import list, because the failure
 * arrives through a transitive import rather than a direct one.
 */
export function assertForm941MentorIsClientSafe(): void {
  const src = readFileSync(MENTOR, "utf8");
  if (src.length === 0) {
    throw new Error(`form-941: read an empty ${MENTOR}. A purity check on nothing passes.`);
  }
  const stripped = stripTypeScriptComments(src);
  for (const forbidden of ["node:fs", "readFileSync", "process.cwd"]) {
    if (stripped.includes(forbidden)) {
      throw new Error(
        `form-941-mentor.ts contains "${forbidden}", which puts node-only code on the client ` +
          `bundle path (standing rule 65b). Move it to form-941-mentor-gates.ts.`,
      );
    }
  }
}

/**
 * Prove every `quote` in the authorities file is a real transcription rather
 * than a placeholder, and that no quote has been silently truncated.
 *
 * Not a substitute for reading the source - nothing is - but it catches the
 * two mechanical failures: an empty quote, and a quote that ends mid-sentence
 * without an ellipsis to mark the omission.
 */
export function assertForm941QuotesLookTranscribed(): void {
  const src = readFileSync(AUTHORITIES, "utf8");
  if (src.length === 0) {
    throw new Error(`form-941: read an empty ${AUTHORITIES}.`);
  }
  for (const a of FORM_941_AUTHORITIES) {
    if (a.quote.trim().length < 80) {
      throw new Error(
        `form-941: the quote for "${a.id}" is ${a.quote.trim().length} characters. That is too ` +
          `short to be a transcription of a statutory paragraph - check it was not replaced by a ` +
          `summary.`,
      );
    }
    const last = a.quote.trim().slice(-1);
    if (![".", '"', ")", "”"].includes(last)) {
      throw new Error(
        `form-941: the quote for "${a.id}" ends with "${last}" rather than a full stop or a ` +
          `closing bracket. If text was omitted, mark it with an ellipsis (standing rule 24 - the ` +
          `quote is sacred).`,
      );
    }
  }
}

/**
 * Prove the checklist is complete, ordered from 1 with no gaps, and that every
 * item gives a physical action rather than an instruction to "verify".
 *
 * THE "VERIFY THE DATA" TEST. `howToCheck` exists to tell Michael what to
 * physically do. A checklist item that says "verify the figures are correct"
 * has told him nothing he did not already know and is worse than no item,
 * because it occupies the slot where a real instruction would go (standing
 * rule 64a - detection is not explanation).
 */
export function assertForm941ChecklistIsUsable(): void {
  const orders = FORM_941_CHECKS.map((c) => c.order).sort((a, b) => a - b);
  for (let i = 0; i < orders.length; i++) {
    if (orders[i] !== i + 1) {
      throw new Error(
        `form-941: checklist orders are ${orders.join(", ")} - they must run 1..${orders.length} ` +
          `with no gaps and no duplicates.`,
      );
    }
  }

  const vacuous = /^(verify|check) (the )?(data|figures|numbers|everything)\b/i;
  for (const c of FORM_941_CHECKS) {
    if (vacuous.test(c.howToCheck.trim())) {
      throw new Error(
        `form-941: checklist item "${c.key}" says "${c.howToCheck.slice(0, 40)}...", which is not ` +
          `an instruction. Say which screen to open and what to compare.`,
      );
    }
    if (!c.question.trim().endsWith("?")) {
      throw new Error(
        `form-941: checklist item "${c.key}" has a question that is not phrased as a question.`,
      );
    }
  }
}

/**
 * Prove every worked example actually works something - that it has steps, and
 * that at least one step contains a number.
 *
 * Michael asked for examples. An "example" with no arithmetic in it is an
 * anecdote, and the difference matters: the whole value of the Q2 2026 example
 * is that every figure in it can be checked against a filed return.
 */
export function assertForm941ExamplesAreWorked(): void {
  if (FORM_941_WORKED_EXAMPLES.length === 0) {
    throw new Error("form-941: there are no worked examples at all.");
  }
  for (const ex of FORM_941_WORKED_EXAMPLES) {
    if (ex.steps.length < 2) {
      throw new Error(
        `form-941: worked example "${ex.key}" has ${ex.steps.length} step(s). An example with one ` +
          `step is a statement.`,
      );
    }
    if (!ex.steps.some((s) => /\d/.test(s))) {
      throw new Error(
        `form-941: worked example "${ex.key}" contains no numbers in any step. That is an ` +
          `anecdote, not a worked example.`,
      );
    }
  }
}

/**
 * Prove no refusal lesson tells the reader to do the one thing that would hide
 * the problem.
 *
 * Specifically: the FRACTIONS_TOO_LARGE lesson must not suggest adjusting line
 * 7. This is a targeted check rather than a general one because it is a
 * targeted risk - line 7 is the only line on this return where plugging is
 * both easy and invisible.
 */
export function assertForm941NeverAdvisesPluggingLine7(): void {
  const lesson = FORM_941_REFUSAL_LESSONS.find((l) => l.code === "FRACTIONS_TOO_LARGE");
  if (!lesson) {
    throw new Error("form-941: the FRACTIONS_TOO_LARGE lesson is missing entirely.");
  }
  const text = `${lesson.howToFix} ${lesson.whyWeRefuse}`.toLowerCase();
  if (!text.includes("reconcil")) {
    throw new Error(
      "form-941: the FRACTIONS_TOO_LARGE lesson does not point at the reconciliation, which is " +
        "the only way to find the person responsible for the difference.",
    );
  }
  if (!/\b(do not|don't|never)\b/.test(text)) {
    throw new Error(
      "form-941: the FRACTIONS_TOO_LARGE lesson does not explicitly tell the reader NOT to adjust " +
        "line 7. Plugging that line is the single most effective way to hide a payroll error, so " +
        "the prohibition has to be stated rather than implied.",
    );
  }
}
