/**
 * src/lib/payroll/wa-quarterly-mentor-gates.ts   (books-41)
 *
 * THE RULE-26 COVERAGE GATES FOR THE WASHINGTON QUARTERLY MENTOR.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEPARATE FILE FROM wa-quarterly-mentor.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Everything here does file I/O. The mentor's lesson data is reachable from
 * client components - that is the whole point of it. In books-33 the two lived
 * in one file, `node:fs` reached a browser bundle, and every deployment broke
 * while CI stayed green. Standing rule 65b.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE GATES USE THE SHARED HELPERS RATHER THAN THEIR OWN REGEXES
 * ─────────────────────────────────────────────────────────────────────────────
 * There are eleven private copies of `/^export function/gm` in this codebase and
 * they are tracked debt, because a private copy cannot inherit a fix. The shared
 * `unionMembersInSource` already knows that a semicolon inside a doc-comment
 * truncates a union scrape and hides a refusal code from its own gate. This file
 * adds no twelfth copy (standing rule 23 - fix the class, then USE the fixed
 * thing).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EVERY GATE REFUSES ON AN EMPTY READ
 * ─────────────────────────────────────────────────────────────────────────────
 * A coverage gate that parses nothing finds nothing untaught and reports perfect
 * coverage (standing rule 39). The usual cause is a renamed file rather than a
 * logic error, which is exactly why it is silent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GATE THIS SLICE ADDED THAT THE OTHERS DO NOT HAVE
 * ─────────────────────────────────────────────────────────────────────────────
 * `assertEveryWaBoxIsExplained` and `assertWaBoxExplainersMatchTheEngine`.
 * Michael's instruction for this slice was specific: "The forms are an important
 * step and I really want to make sure I understand everything that is happening
 * on the forms in plain english." A box on a return that the software fills in
 * and nobody explains is precisely the thing he asked not to have, so it is a
 * gate rather than an intention. The second gate goes further and checks the
 * teaching AGREES with the engine - a box explainer that says the employer pays
 * something the engine books as employee money is worse than no explainer.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  exportedFunctionNames,
  stripTypeScriptComments,
  unionMembersInSource,
} from "@/lib/payroll/mentor-quote-gate";
import {
  WA_BOX_EXPLAINERS,
  WA_FORM_GUIDES,
  WA_QUARTER_CHECKS,
  WA_QUARTER_LESSONS,
  WA_REFUSAL_LESSONS,
  WA_WORKED_EXAMPLES,
  waTaughtFunctionNames,
} from "@/lib/payroll/wa-quarterly-mentor";
import {
  findWaQuarterlyAuthority,
  waQuarterlyAuthorities,
} from "@/lib/payroll/wa-quarterly-authorities";

const ROOT = process.cwd();
const CORE = join(ROOT, "src/lib/payroll/wa-quarterly-core.ts");
const MENTOR = join(ROOT, "src/lib/payroll/wa-quarterly-mentor.ts");
const AUTHORITIES = join(ROOT, "src/lib/payroll/wa-quarterly-authorities.ts");

/**
 * The engine's exported functions, read from disk.
 *
 * Deliberately NOT a hand-typed list: a hand-typed list passes forever after
 * somebody adds a function and forgets to teach it.
 */
export function waQuarterEngineFunctionNames(): readonly string[] {
  return exportedFunctionNames(CORE, "WA QUARTERLY");
}

/**
 * Every refusal code in the engine's TypeScript UNION, parsed from source.
 *
 * WHY THE UNION AND NOT THE RUNTIME ARRAY. `wa-quarterly-core.ts` declares its
 * codes twice - once as a union (which does not exist at runtime and cannot be
 * iterated) and once as `ALL_WA_QUARTER_REFUSAL_CODES`. Two declarations of one
 * fact can disagree, and a code present in the union but absent from the array
 * would still be emitted by the engine and still reach the screen, while a gate
 * reading only the array would call it taught.
 */
export function waQuarterUnionRefusalCodes(): readonly string[] {
  const codes = unionMembersInSource(readFileSync(CORE, "utf8"), "WaQuarterRefusalCode");
  if (codes.length === 0) {
    throw new Error(
      "WA QUARTERLY UNION GATE BROKEN: read zero members of `WaQuarterRefusalCode` from " +
        `${CORE}. A gate that parses no codes finds none untaught and approves everything ` +
        "(standing rule 39).",
    );
  }
  return codes;
}

/**
 * Prove every exported engine function has a lesson, and every lesson names a
 * function that still exists.
 *
 * BOTH DIRECTIONS ON PURPOSE. A lesson beside a function that was renamed reads
 * as reassurance while covering nothing, and it is the more dangerous of the two
 * failures because the lesson count still looks right.
 */
export function assertEveryWaQuarterFunctionIsTaught(): void {
  const exported = waQuarterEngineFunctionNames();
  const taught = new Set(waTaughtFunctionNames());

  const untaught = exported.filter((fn) => !taught.has(fn));
  if (untaught.length > 0) {
    throw new Error(
      `wa-quarterly mentor: ${untaught.length} exported function(s) have no lesson: ` +
        `${untaught.join(", ")}. An exported function nobody has explained is a function whose ` +
        `behaviour lives only in its implementation.`,
    );
  }

  const exportedSet = new Set(exported);
  const orphans = [...taught].filter((fn) => !exportedSet.has(fn));
  if (orphans.length > 0) {
    throw new Error(
      `wa-quarterly mentor: lesson(s) for ${orphans.join(", ")} name functions the engine no ` +
        `longer exports. Dead teaching is standing rule 50 wearing a mentor's hat.`,
    );
  }
}

/** Prove the refusal-code union and the runtime array agree. */
export function assertWaQuarterUnionMatchesRuntimeArray(runtimeCodes: readonly string[]): void {
  const union = [...waQuarterUnionRefusalCodes()].sort();
  const runtime = [...runtimeCodes].sort();

  const missingFromArray = union.filter((c) => !runtime.includes(c));
  if (missingFromArray.length > 0) {
    throw new Error(
      `wa-quarterly: ${missingFromArray.join(", ")} exist in the WaQuarterRefusalCode union but ` +
        `not in ALL_WA_QUARTER_REFUSAL_CODES. The engine can emit them and every coverage gate ` +
        `that reads only the array will report them as taught.`,
    );
  }

  const missingFromUnion = runtime.filter((c) => !union.includes(c));
  if (missingFromUnion.length > 0) {
    throw new Error(
      `wa-quarterly: ${missingFromUnion.join(", ")} are in ALL_WA_QUARTER_REFUSAL_CODES but not ` +
        `in the union. One of the two declarations is stale.`,
    );
  }
}

/** Prove every refusal code the engine can emit has a lesson explaining it. */
export function assertEveryWaRefusalCodeIsTaught(): void {
  const codes = waQuarterUnionRefusalCodes();
  const taught = new Set(WA_REFUSAL_LESSONS.map((l) => String(l.code)));

  const untaught = codes.filter((c) => !taught.has(c));
  if (untaught.length > 0) {
    throw new Error(
      `wa-quarterly: refusal code(s) ${untaught.join(", ")} can be emitted by the engine but no ` +
        `lesson explains them. A refusal Michael cannot act on is an obstacle, not a safeguard ` +
        `(standing rule 48).`,
    );
  }

  const codeSet = new Set(codes);
  const orphans = [...taught].filter((c) => !codeSet.has(c));
  if (orphans.length > 0) {
    throw new Error(
      `wa-quarterly: lesson(s) exist for ${orphans.join(", ")}, which the engine cannot emit.`,
    );
  }
}

/**
 * ═══ MICHAEL'S GATE ═══
 *
 * Prove every box the engine fills in on a Washington return has a plain-English
 * explanation, and that no explanation describes a box that does not exist.
 *
 * `lineIds` is passed in rather than imported so this gate cannot drift from
 * what the engine ACTUALLY emitted for a real request - the test hands it the
 * output of `buildWaQuarter` on the filed Q2 2026 figures. A gate that read a
 * hard-coded list would keep passing after the engine stopped emitting a line.
 */
export function assertEveryWaBoxIsExplained(lineIds: readonly string[]): void {
  if (lineIds.length === 0) {
    throw new Error(
      "wa-quarterly: the box-coverage gate was handed zero line ids. A gate given nothing finds " +
        "nothing unexplained and approves everything (standing rule 39).",
    );
  }
  const explained = new Set(WA_BOX_EXPLAINERS.map((b) => b.lineId));

  const unexplained = lineIds.filter((id) => !explained.has(id));
  if (unexplained.length > 0) {
    throw new Error(
      `wa-quarterly: the engine fills in box(es) ${unexplained.join(", ")} that nothing explains ` +
        `in plain English. Michael asked specifically to understand everything happening on the ` +
        `forms; a box the software fills in silently is the opposite of that.`,
    );
  }

  const emitted = new Set(lineIds);
  const orphans = [...explained].filter((id) => !emitted.has(id));
  if (orphans.length > 0) {
    throw new Error(
      `wa-quarterly: box explainer(s) for ${orphans.join(", ")} describe boxes the engine does ` +
        `not emit. Teaching for a box that is not there sends a reader looking for it.`,
    );
  }
}

/**
 * Prove each box explainer AGREES with the engine about that box.
 *
 * Two facts are compared, and both have bitten real filings:
 *
 *  1. WHOSE MONEY. If the engine books a line as employee money and the
 *     explainer calls it an employer cost, one of them is teaching Michael to
 *     break RCW 50.24.010 or to raid the Paid Leave trust. This is the single
 *     most consequential fact on these returns and it is stated in two places,
 *     so the two places are checked against each other.
 *
 *  2. THE WORKED FIGURE. Every explainer carries a Q2 2026 example. That
 *     quarter was actually filed, so the example is checkable - and it is
 *     checked, against the engine's own output for the same input, rather than
 *     against a number somebody typed twice.
 *
 * The caller passes the engine's lines so this file never re-runs the arithmetic
 * itself; a gate that recomputed the answer would agree with itself for exactly
 * the same reason the engine might be wrong.
 */
export function assertWaBoxExplainersMatchTheEngine(
  lines: readonly {
    id: string;
    whoseMoney: string;
    measure: string;
    amountCents: number;
    quantity: number | null;
  }[],
): void {
  if (lines.length === 0) {
    throw new Error("wa-quarterly: the box-agreement gate was handed zero lines.");
  }
  for (const line of lines) {
    const box = WA_BOX_EXPLAINERS.find((b) => b.lineId === line.id);
    if (!box) continue; // absence is assertEveryWaBoxIsExplained's job, not this one's

    if (box.whoseMoney !== line.whoseMoney) {
      throw new Error(
        `wa-quarterly: box "${line.id}" is booked by the engine as ${line.whoseMoney} but the ` +
          `explainer calls it ${box.whoseMoney}. Whose money a line is decides whether it may be ` +
          `deducted from staff at all; the teaching and the software cannot disagree about it.`,
      );
    }

    const expected =
      line.measure === "hours"
        ? (line.quantity ?? 0).toLocaleString("en-US")
        : (line.amountCents / 100).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
    const plain =
      line.measure === "hours" ? String(line.quantity ?? 0) : (line.amountCents / 100).toFixed(2);

    if (!box.q2_2026Example.includes(expected) && !box.q2_2026Example.includes(plain)) {
      throw new Error(
        `wa-quarterly: the worked example for box "${line.id}" never mentions ${expected}, which ` +
          `is what the engine produces for Q2 2026. Either the example is stale or the engine ` +
          `changed; either way a reader checking the example against the screen would find they ` +
          `disagree.`,
      );
    }
  }
}

/**
 * Prove every authority transcribed for this slice is actually cited by
 * something a reader can reach - a form guide, a box explainer, a checklist
 * item or a lesson.
 *
 * A verbatim legal text nobody cites is a text nobody reads. It costs the same
 * maintenance as a live one and provides none of the assurance (standing rule
 * 50 applied to the authority layer).
 *
 * NOTE THAT THIS LIST IS EMPTY, AND THAT IS DELIBERATE. Other slices keep a
 * display-only escape hatch here. This one has none: when the gate was first
 * run it found six uncited authorities - the two late-payment rules, ESD's
 * 30 September rate consequence, the L&I late penalty, the termination rule and
 * the general PFML paragraph - and rather than declaring them display-only,
 * two checklist items were written that a reader actually needs ("Know what
 * being late actually costs before you need to know" and "If Greenway ever
 * stops paying wages, say so ON the return"). Excusing them would have been
 * quicker and would have taught Michael nothing.
 */
export const WA_QUARTERLY_DISPLAY_ONLY_AUTHORITY_IDS: readonly string[] = [];

export function assertEveryWaQuarterlyAuthorityIsReachable(): void {
  const cited = new Set<string>();
  for (const g of WA_FORM_GUIDES) for (const id of g.authorityIds) cited.add(id);
  for (const b of WA_BOX_EXPLAINERS) for (const id of b.authorityIds) cited.add(id);
  for (const c of WA_QUARTER_CHECKS) for (const id of c.authorityIds) cited.add(id);
  for (const l of WA_QUARTER_LESSONS) for (const id of l.authorityIds) cited.add(id);

  const orphans = waQuarterlyAuthorities()
    .filter(
      (a) => !cited.has(a.id) && !WA_QUARTERLY_DISPLAY_ONLY_AUTHORITY_IDS.includes(a.id),
    )
    .map((a) => a.id);

  if (orphans.length > 0) {
    throw new Error(
      `wa-quarterly: ${orphans.join(", ")} are transcribed but cited by nothing a reader can ` +
        `reach. Either cite them or add them to WA_QUARTERLY_DISPLAY_ONLY_AUTHORITY_IDS with a ` +
        `reason - an uncited verbatim text is a text nobody reads.`,
    );
  }
}

/**
 * Prove every authority id the mentor CITES actually resolves.
 *
 * The mirror image of the gate above, and the one that has already caught a real
 * defect in this slice: several ids were typed from the EXPORT NAMES in
 * `payroll-tax-authorities.ts` rather than from the `id:` field values, and
 * `esd-pfml-2026-rate` does not exist - the authority's real id is
 * `esd-pfml-2026-rate-announcement`. Nothing in the type system relates those two
 * strings, so only a gate can catch it, and until it did the PFML box cited a
 * source that would have rendered as nothing at all on screen.
 */
export function assertEveryWaCitedAuthorityResolves(): void {
  const problems: string[] = [];
  const note = (id: string, where: string): void => {
    if (!findWaQuarterlyAuthority(id)) problems.push(`${id} (cited by ${where})`);
  };

  for (const g of WA_FORM_GUIDES) for (const id of g.authorityIds) note(id, `form ${g.form}`);
  for (const b of WA_BOX_EXPLAINERS) for (const id of b.authorityIds) note(id, `box ${b.lineId}`);
  for (const c of WA_QUARTER_CHECKS) for (const id of c.authorityIds) note(id, `check ${c.key}`);
  for (const l of WA_QUARTER_LESSONS) for (const id of l.authorityIds) note(id, `lesson ${l.fn}`);

  if (problems.length > 0) {
    throw new Error(
      `wa-quarterly: ${problems.length} cited authority id(s) resolve to nothing: ` +
        `${problems.join("; ")}. A citation that resolves to nothing displays as nothing, and a ` +
        `reader has no way to tell the difference between "no source" and "source missing".`,
    );
  }
}

/** Prove the mentor file is client-safe: no `node:fs`, no `readFileSync`, no `process`. */
export function assertWaQuarterlyMentorIsClientSafe(): void {
  const src = readFileSync(MENTOR, "utf8");
  if (src.length === 0) {
    throw new Error(`wa-quarterly: read an empty ${MENTOR}. A purity check on nothing passes.`);
  }
  const stripped = stripTypeScriptComments(src);
  for (const forbidden of ["node:fs", "readFileSync", "process.cwd"]) {
    if (stripped.includes(forbidden)) {
      throw new Error(
        `wa-quarterly-mentor.ts contains "${forbidden}", which puts node-only code on the client ` +
          `bundle path (standing rule 65b). Move it to wa-quarterly-mentor-gates.ts.`,
      );
    }
  }
}

/**
 * Prove every `quote` in the authorities file is a real transcription rather
 * than a placeholder, and that none has been silently truncated.
 */
export function assertWaQuarterlyQuotesLookTranscribed(): void {
  const src = readFileSync(AUTHORITIES, "utf8");
  if (src.length === 0) {
    throw new Error(`wa-quarterly: read an empty ${AUTHORITIES}.`);
  }
  const authorities = waQuarterlyAuthorities();
  if (authorities.length === 0) {
    throw new Error("wa-quarterly: the authority registry is empty, so this gate proves nothing.");
  }
  for (const a of authorities) {
    const q = a.quote.trim();
    if (q.length < 80) {
      throw new Error(
        `wa-quarterly: the quote for "${a.id}" is ${q.length} characters. That is too short to ` +
          `be a transcription of a statutory paragraph - check it was not replaced by a summary.`,
      );
    }
    /**
     * TRUNCATION IS DETECTED BY WHAT A CUT-OFF SENTENCE LOOKS LIKE, NOT BY
     * WHITELISTING PUNCTUATION.
     *
     * The obvious gate - "must end in a full stop or a bracket" - was written
     * first and immediately produced a false positive on a real, complete,
     * correctly transcribed quote: ESD's rate-structure page ends with a table
     * row, "[Taxable wage base] 2026 | $78,200". Nothing is missing from it. A
     * gate that fails honest transcriptions teaches people to edit the QUOTE to
     * satisfy the gate, which is the precise opposite of standing rule 24.
     *
     * So the test is inverted. Rather than listing the endings that are allowed,
     * it lists the endings that actually indicate a sentence was cut off
     * mid-flight: a trailing comma or semicolon, or a dangling conjunction or
     * preposition. Those are what truncation looks like. A digit, a full stop
     * and a closing bracket are all fine.
     */
    const truncated = /[,;:]$/.test(q) || /\b(and|or|but|of|to|for|the|a|an|with|that|which|is|are|shall|may)$/i.test(q);
    if (truncated) {
      throw new Error(
        `wa-quarterly: the quote for "${a.id}" ends with "${q.slice(-24)}", which reads as a ` +
          `sentence that was cut off. If text was omitted, mark it with an ellipsis (standing ` +
          `rule 24 - the quote is sacred).`,
      );
    }
  }
}

/**
 * Prove the checklist is complete, ordered from 1 with no gaps, and that every
 * item gives a physical action rather than an instruction to "verify".
 *
 * `doThis` exists to tell Michael what to physically do. An item that says
 * "verify the figures are correct" has told him nothing he did not already know
 * and is worse than no item, because it occupies the slot where a real
 * instruction would go (standing rule 64a - detection is not explanation).
 */
export function assertWaQuarterlyChecklistIsUsable(): void {
  if (WA_QUARTER_CHECKS.length === 0) {
    throw new Error("wa-quarterly: there is no checklist at all.");
  }
  const orders = WA_QUARTER_CHECKS.map((c) => c.order).sort((a, b) => a - b);
  for (let i = 0; i < orders.length; i++) {
    if (orders[i] !== i + 1) {
      throw new Error(
        `wa-quarterly: checklist orders are ${orders.join(", ")} - they must run 1..` +
          `${orders.length} with no gaps and no duplicates.`,
      );
    }
  }

  const vacuous = /^(verify|check|review|ensure) (the )?(data|figures|numbers|everything|it)\b/i;
  for (const c of WA_QUARTER_CHECKS) {
    if (vacuous.test(c.doThis.trim())) {
      throw new Error(
        `wa-quarterly: checklist item "${c.key}" says "${c.doThis.slice(0, 40)}...", which is ` +
          `not an instruction. Say which screen to open and what to compare.`,
      );
    }
    if (c.doneWhen.trim().length < 30) {
      throw new Error(
        `wa-quarterly: checklist item "${c.key}" has no checkable completion condition. ` +
          `"Done when" has to be something a reader can look at and answer yes or no.`,
      );
    }
    if (c.ifSkipped.trim().length < 40) {
      throw new Error(
        `wa-quarterly: checklist item "${c.key}" does not say what skipping it costs. An item ` +
          `with no stated consequence is the first one a busy person drops.`,
      );
    }
  }
}

/**
 * Prove every worked example actually works something - that it has steps, and
 * that at least one step contains a number.
 *
 * Michael asked for examples. An "example" with no arithmetic in it is an
 * anecdote, and the whole value of the Q2 2026 examples is that every figure in
 * them can be checked against a return that was actually filed.
 */
export function assertWaQuarterlyExamplesAreWorked(): void {
  if (WA_WORKED_EXAMPLES.length === 0) {
    throw new Error("wa-quarterly: there are no worked examples at all.");
  }
  for (const ex of WA_WORKED_EXAMPLES) {
    if (ex.steps.length < 2) {
      throw new Error(
        `wa-quarterly: worked example "${ex.key}" has ${ex.steps.length} step(s). An example ` +
          `with one step is a statement.`,
      );
    }
    if (!ex.steps.some((s) => /\d/.test(s))) {
      throw new Error(
        `wa-quarterly: worked example "${ex.key}" contains no numbers in any step. That is an ` +
          `anecdote, not a worked example.`,
      );
    }
    if (!/\d/.test(ex.answer)) {
      throw new Error(
        `wa-quarterly: worked example "${ex.key}" reaches an answer with no number in it.`,
      );
    }
  }
}

/**
 * Prove the box explainers never advise the one thing that is actually unlawful.
 *
 * A targeted gate for a targeted risk. Two lines on these returns are employer
 * money that a reasonable person might assume is shared - the unemployment tax
 * and the employer half of Paid Leave - and RCW 50.24.010 says a deduction for
 * the former "shall be unlawful". The explainer for a line the employer alone
 * pays therefore has to SAY that it cannot be deducted, in terms, rather than
 * leaving a reader to infer it from the phrase "employer cost".
 */
export function assertWaEmployerCostBoxesForbidDeduction(): void {
  const employerBoxes = WA_BOX_EXPLAINERS.filter((b) => b.whoseMoney === "employer_cost");
  if (employerBoxes.length === 0) {
    throw new Error(
      "wa-quarterly: no box is marked employer_cost, which cannot be right - the unemployment " +
        "tax is entirely the employer's. This gate is reading the wrong field.",
    );
  }
  for (const b of employerBoxes) {
    const text = `${b.whyOwnershipMatters} ${b.whatGoesHere}`.toLowerCase();

    /**
     * TWO CONDITIONS, BOTH REQUIRED.
     *
     * The first version of this gate matched a fixed list of phrases such as
     * "may not be deducted", and it produced a false negative on prose that
     * forbade the deduction perfectly clearly - "neither part of it may be
     * deducted from anybody's pay ... an employer attempting to do so is guilty
     * of a misdemeanour". English has many ways to say no, and a gate that only
     * recognises a handful of them pushes the writing toward a template.
     *
     * So the requirement is stated as a shape rather than a phrase: the text
     * must MENTION deduction, and it must carry a word that forbids. Requiring
     * both is what keeps this from going vacuous - a passage mentioning neither,
     * or one that mentions deduction approvingly, still fails.
     */
    // "Deducted" is the statutory word, but prose legitimately says the same
    // thing as "recovered from staff", "withheld" or "passed on" - and the PFML
    // employer share is in fact most naturally described as never being
    // RECOVERED, because it is not a withholding in the first place.
    const mentionsDeduction = /\b(deduct|withh?eld|withhold|recover|passed on|pass it on)/.test(text);
    const forbidding =
      /\b(unlawful|never|neither|prohibit|prohibition|misdemeanou?r|may not|cannot|not be)\b/.test(
        text,
      );
    const forbids = mentionsDeduction && forbidding;

    if (!forbids) {
      throw new Error(
        `wa-quarterly: box "${b.lineId}" is the employer's own money but its explanation never ` +
          `states that it may not be deducted from staff. RCW 50.24.010 makes that deduction ` +
          `unlawful, so the prohibition has to be said rather than implied.`,
      );
    }
  }
}
