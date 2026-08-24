/**
 * books-46 — THE W-2 MENTOR, AND THE GATES THAT KEEP IT HONEST.
 *
 * A teaching module rots in a way an engine does not. When an engine falls out
 * of step with reality, something throws. When a LESSON falls out of step, it
 * keeps rendering — confidently, in plain English, next to a function that no
 * longer behaves that way. Wrong teaching is worse than absent teaching,
 * because absent teaching prompts a question.
 *
 * So the gates here check three things behaviour alone cannot:
 *
 *   1. COVERAGE IN BOTH DIRECTIONS. Every exported engine function has a
 *      lesson, AND every lesson names a function that still exists. The second
 *      half matters more: a lesson beside a renamed function reads as
 *      reassurance while covering nothing, and the lesson COUNT still looks
 *      right.
 *
 *   2. THE UNION AGAINST THE ARRAY. The refusal codes are declared twice — as a
 *      type union that cannot be iterated at runtime, and as an array that can.
 *      Two declarations of one fact can disagree, and a gate reading only the
 *      array would report a union-only code as fully taught.
 *
 *   3. CLIENT SAFETY. In books-33 the lesson data and its file-reading gates
 *      lived in one module, `node:fs` reached a browser bundle, and every
 *      deployment broke while CI stayed green. That is why there are two files
 *      and why one of these tests reads the other's imports.
 *
 * Each gate is also shown CAPABLE OF FAILING (rule 83a). A coverage gate that
 * parses nothing finds nothing untaught and approves everything.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import {
  FORM_W2_CHECKS,
  FORM_W2_LESSONS,
  FORM_W2_REFUSAL_LESSONS,
  FORM_W2_WORKED_EXAMPLES,
  w2ChecksInOrder,
  w2CitedAuthorityIds,
  w2LessonFor,
  w2RefusalLessonFor,
  w2TaughtFunctionNames,
} from "@/lib/payroll/form-w2-mentor";
import {
  assertEveryW2CitationResolves,
  assertEveryW2FunctionIsTaught,
  assertEveryW2RefusalIsTaught,
  assertW2ChecklistIsUsable,
  assertW2ExamplesAreWorked,
  assertW2LessonsAreSubstantive,
  assertW2MentorIsClientSafe,
  assertW2NeverAdvisesForcingBoxesToMatch,
  assertW2UnionMatchesRuntimeArray,
  w2EngineFunctionNames,
  w2UnionRefusalCodes,
} from "@/lib/payroll/form-w2-mentor-gates";
import { ALL_W2_REFUSAL_CODES } from "@/lib/payroll/form-w2-core";
import { formW2Authorities } from "@/lib/payroll/form-w2-authorities";
import { stripTypeScriptComments } from "@/lib/payroll/mentor-quote-gate";

/* ══════════════════════════════════════════════════════════════════ *
 * §1  COVERAGE
 * ══════════════════════════════════════════════════════════════════ */

describe("§1 rule 26: every exported function is taught", () => {
  it("reads a non-empty list of exported functions from the engine", () => {
    // Rule 39 first: if the scrape returns nothing, every coverage claim below
    // it is vacuously true. Assert the gate can see before asking what it sees.
    const fns = w2EngineFunctionNames();
    expect(fns.length).toBeGreaterThan(10);
    expect(fns).toContain("buildW2");
    expect(fns).toContain("buildW3");
    expect(fns).toContain("reconcileW3To941s");
  });

  it("teaches every one of them, with no lessons left pointing at nothing", () => {
    expect(() => assertEveryW2FunctionIsTaught()).not.toThrow();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // These three tests drive the REAL gate with substitute data.
  //
  // They used to re-implement the set-difference in the test body and assert
  // on the test's own answer. A mutation campaign proved that worthless:
  // deleting the orphan check from the gate entirely left the suite green,
  // because nothing in the suite ever executed that branch. Standing rule 83a
  // wants the gate provably failable, not a lookalike of the gate.
  // ─────────────────────────────────────────────────────────────────────────

  it("would notice an untaught function", () => {
    expect(() =>
      assertEveryW2FunctionIsTaught({
        exported: [...w2EngineFunctionNames(), "buildW2c"],
        taught: w2TaughtFunctionNames(),
      }),
    ).toThrow(/no lesson: buildW2c/);
  });

  it("would notice a lesson for a function that no longer exists", () => {
    expect(() =>
      assertEveryW2FunctionIsTaught({
        exported: w2EngineFunctionNames(),
        taught: [...w2TaughtFunctionNames(), "buildW2Deleted"],
      }),
    ).toThrow(/buildW2Deleted[\s\S]*no longer/);
  });

  it("refuses to run at all if it reads zero exported functions", () => {
    // Rule 39: the gate's own worst failure is silence. It must shout.
    expect(() =>
      assertEveryW2FunctionIsTaught({ exported: [], taught: w2TaughtFunctionNames() }),
    ).toThrow(/COVERAGE GATE BROKEN/);
  });

  it("would notice a lesson whose teaching has been hollowed out", () => {
    const real = FORM_W2_LESSONS[0];
    expect(() =>
      assertW2LessonsAreSubstantive([{ ...real, theTrap: "n/a" }]),
    ).toThrow(/theTrap too short/);
    expect(() => assertW2LessonsAreSubstantive([])).toThrow(/no lessons/);
  });

  it("gives every lesson a plain-English line, a reason, a trap and an action", () => {
    expect(() => assertW2LessonsAreSubstantive()).not.toThrow();
  });

  it("looks a lesson up by function name", () => {
    expect(w2LessonFor("buildW2")?.fn).toBe("buildW2");
    expect(w2LessonFor("noSuchFunction")).toBeUndefined();
  });

  it("teaches the boring plumbing too, so nothing hides in the gaps", () => {
    // `boxOf` and `formatCentsForW2` are trivial. They are taught anyway,
    // because "it was too small to explain" is how an untaught surface starts.
    expect(w2LessonFor("boxOf")).toBeDefined();
    expect(w2LessonFor("formatCentsForW2")).toBeDefined();
  });
});

/* ══════════════════════════════════════════════════════════════════ *
 * §2  THE UNION AGAINST THE ARRAY
 * ══════════════════════════════════════════════════════════════════ */

describe("§2 two declarations of one fact must agree", () => {
  it("parses the refusal union out of the engine source", () => {
    const union = w2UnionRefusalCodes();
    expect(union.length).toBe(12);
    expect(union).toContain("W2_BOX_17_MUST_BE_BLANK_IN_WA");
  });

  it("finds the union and the runtime array identical", () => {
    expect(() => assertW2UnionMatchesRuntimeArray(ALL_W2_REFUSAL_CODES)).not.toThrow();
  });

  it("would catch a code present in the union but missing from the array", () => {
    // The dangerous direction: the engine could emit it, and a gate reading
    // only the array would call it fully taught.
    const short = ALL_W2_REFUSAL_CODES.slice(1);
    expect(() => assertW2UnionMatchesRuntimeArray(short)).toThrow(/disagree/);
  });

  it("would catch an array entry that is not in the union", () => {
    expect(() =>
      assertW2UnionMatchesRuntimeArray([...ALL_W2_REFUSAL_CODES, "W2_INVENTED"]),
    ).toThrow(/disagree/);
  });

  it("would catch an extra code that sorts AFTER every real one", () => {
    // This is the case only the LENGTH guard can catch, and it took a mutation
    // campaign to notice it was untested.
    //
    // The comparison walks the UNION and indexes into the runtime array. An
    // extra entry past the end of the union is never visited, so the
    // element-wise check returns "identical". `W2_INVENTED` above happens to
    // sort into the MIDDLE of the real codes, which shifts everything after it
    // and trips the element-wise check — so it silently tested the wrong half.
    // A code sorting last is invisible to everything but the count.
    const extra = [...ALL_W2_REFUSAL_CODES, "ZZZ_SORTS_LAST"].sort();
    expect(extra[extra.length - 1]).toBe("ZZZ_SORTS_LAST");
    expect(() => assertW2UnionMatchesRuntimeArray(extra)).toThrow(/disagree/);
  });

  it("would catch a code that was RENAMED rather than added or removed", () => {
    // Caught by the ELEMENT-WISE half, and by nothing else.
    //
    // A mutation campaign showed the two tests above both still passed when
    // the element-wise comparison was deleted — every case they exercise
    // changes the array's LENGTH, so the cheap check caught them first. A
    // rename keeps the count identical, which is exactly how a typo in a
    // refusal code slips through: same number of codes, one of them wrong.
    // Widened to `string[]` deliberately: `ALL_W2_REFUSAL_CODES` is typed as
    // the union, so the compiler rightly refuses to let a fake code into it.
    // The gate's parameter is `readonly string[]` because its whole job is to
    // catch the case where the two lists have drifted apart at runtime.
    const renamed: string[] = [...ALL_W2_REFUSAL_CODES];
    renamed[0] = "W2_TYPOED_CODE";
    expect(renamed).toHaveLength(ALL_W2_REFUSAL_CODES.length);
    expect(() => assertW2UnionMatchesRuntimeArray(renamed)).toThrow(/disagree/);
  });

  it("teaches every refusal code the engine can emit", () => {
    expect(() => assertEveryW2RefusalIsTaught()).not.toThrow();
    expect(FORM_W2_REFUSAL_LESSONS).toHaveLength(12);
  });

  it("would notice a refusal code that lost its lesson", () => {
    const union = w2UnionRefusalCodes();
    expect(() =>
      assertEveryW2RefusalIsTaught({ union, taughtCodes: union.slice(1) }),
    ).toThrow(/no lesson/);
  });

  it("would notice a lesson for a refusal the engine can no longer emit", () => {
    const union = w2UnionRefusalCodes();
    expect(() =>
      assertEveryW2RefusalIsTaught({
        union,
        taughtCodes: [...union, "W2_RETIRED_CODE"],
      }),
    ).toThrow(/W2_RETIRED_CODE/);
  });

  it("gives each refusal lesson a headline, a cause, a fix and a reason to refuse", () => {
    for (const l of FORM_W2_REFUSAL_LESSONS) {
      expect(l.headline.trim().length).toBeGreaterThan(20);
      expect(l.whatHappened.trim().length).toBeGreaterThan(30);
      expect(l.howToFix.trim().length).toBeGreaterThan(30);
      expect(l.whyWeRefuse.trim().length).toBeGreaterThan(40);
      // Michael reads these; the code itself never appears in the prose.
      expect(l.headline).not.toContain("W2_");
    }
  });

  it("never fobs the reader off with 'check the data'", () => {
    // A remedy that restates the problem is not a remedy.
    for (const l of FORM_W2_REFUSAL_LESSONS) {
      expect(l.howToFix.toLowerCase()).not.toMatch(/^check the data\.?$/);
      expect(l.howToFix.toLowerCase()).not.toMatch(/^verify the data\.?$/);
    }
  });

  it("looks a refusal lesson up by code", () => {
    expect(w2RefusalLessonFor("W2_MEDICARE_BELOW_OASDI")?.code).toBe(
      "W2_MEDICARE_BELOW_OASDI",
    );
  });
});

/* ══════════════════════════════════════════════════════════════════ *
 * §3  CLIENT SAFETY  (the books-33 regression)
 * ══════════════════════════════════════════════════════════════════ */

describe("§3 the lesson data stays bundleable for the browser", () => {
  it("imports nothing from the filesystem", () => {
    expect(() => assertW2MentorIsClientSafe()).not.toThrow();
  });

  it("would catch the books-33 regression itself", () => {
    // Drive the real gate with source text that commits the original sin,
    // rather than adding the import to the real file to watch it fire.
    expect(() =>
      assertW2MentorIsClientSafe('import { readFileSync } from "node:fs";\nexport const X = 1;'),
    ).toThrow(/node:fs/);
    expect(() =>
      assertW2MentorIsClientSafe('import "server-only";\nexport const X = 1;'),
    ).toThrow(/server-only/);
  });

  it("refuses to approve an empty read", () => {
    expect(() => assertW2MentorIsClientSafe("   ")).toThrow(
      /CLIENT-SAFETY GATE BROKEN/,
    );
  });

  it("really is reading the mentor file, not an empty string", () => {
    // Rule 39 again: this gate's failure mode is reading nothing and passing.
    const src = readFileSync(
      join(process.cwd(), "src/lib/payroll/form-w2-mentor.ts"),
      "utf8",
    );
    expect(src.length).toBeGreaterThan(5_000);
    expect(src).toContain("FORM_W2_LESSONS");
  });

  it("keeps the file-reading gates in the OTHER module, where they belong", () => {
    const gates = readFileSync(
      join(process.cwd(), "src/lib/payroll/form-w2-mentor-gates.ts"),
      "utf8",
    );
    expect(gates).toContain("node:fs");
    const mentor = readFileSync(
      join(process.cwd(), "src/lib/payroll/form-w2-mentor.ts"),
      "utf8",
    );
    // Check the CODE, not the prose. The mentor file's header comment names
    // `node:fs` precisely to explain why it must never import it, and a naive
    // substring search cannot tell an explanation apart from a violation.
    // Strip comments first, then look for a real import specifier.
    const code = stripTypeScriptComments(mentor);
    expect(code).not.toContain('"node:fs"');
    expect(code).not.toContain("'node:fs'");
    expect(code).not.toContain('"server-only"');
    // And prove the stripper did not simply hand back an empty string, which
    // would make the three assertions above pass without reading anything
    // (rule 39: a gate that parses nothing approves everything).
    expect(code).toContain("FORM_W2_LESSONS");
    // The warning itself must survive in the real file, so the next person
    // learns WHY the split exists rather than "simplifying" it away.
    expect(mentor).toContain("node:fs");
  });

  it("adds no twelfth private copy of the export scrape", () => {
    // Rule 23: the shared helper has been widened three times; a private copy
    // cannot inherit those fixes.
    const gates = readFileSync(
      join(process.cwd(), "src/lib/payroll/form-w2-mentor-gates.ts"),
      "utf8",
    );
    expect(gates).toContain("exportedFunctionNames");
    expect(gates).not.toContain("/^export (?:async )?function");
  });
});

/* ══════════════════════════════════════════════════════════════════ *
 * §4  THE CHECKLIST
 * ══════════════════════════════════════════════════════════════════ */

describe("§4 the pre-filing checklist is usable, not decorative", () => {
  it("passes its own gate", () => {
    expect(() => assertW2ChecklistIsUsable()).not.toThrow();
  });

  it("is ordered by when a mistake is still cheap, not by box number", () => {
    // The reconciliation comes FIRST even though it cannot be completed until
    // the fourth quarter closes, because it is the only item whose cost depends
    // on the date you do it.
    const ordered = w2ChecksInOrder();
    expect(ordered[0].key).toBe("reconcile-in-october");
    expect(ordered[ordered.length - 1].key).toBe("read-your-own-w2");
  });

  it("gives every item a distinct place in the order", () => {
    const orders = FORM_W2_CHECKS.map((c) => c.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("phrases every item as a question", () => {
    for (const c of FORM_W2_CHECKS) expect(c.question.trim()).toMatch(/\?$/);
  });

  it("covers both traps and the void exclusion", () => {
    const keys = FORM_W2_CHECKS.map((c) => c.key);
    expect(keys).toContain("shareholder-premium-recorded");
    expect(keys).toContain("box-17-is-blank");
    expect(keys).toContain("voids-excluded");
  });

  it("would reject an item whose 'how to check' is not an action", () => {
    // RULE 43, LEARNED THE HARD WAY. This branch was originally unreachable:
    // it sat AFTER a 40-character minimum, and every phrase it can match is
    // shorter than that, so the length error always fired first and the
    // "not an action" refusal could never be produced by any input. This test
    // is what exposed it. Content is now judged before length.
    const real = FORM_W2_CHECKS[0];
    for (const dud of [
      "Verify the data.",
      "Check the data",
      "Review the numbers.",
      "Confirm the figures.",
    ]) {
      expect(() =>
        assertW2ChecklistIsUsable([{ ...real, howToCheck: dud }]),
      ).toThrow(/not an action/);
    }
  });

  it("still rejects a too-short instruction that is not one of those phrases", () => {
    // Both branches must remain reachable; fixing the order must not have
    // simply swapped which one is dead.
    const real = FORM_W2_CHECKS[0];
    expect(() =>
      assertW2ChecklistIsUsable([{ ...real, howToCheck: "Look at it." }]),
    ).toThrow(/howToCheck too short/);
  });

  it("would reject two items claiming the same place in the order", () => {
    const [a, b] = [FORM_W2_CHECKS[0], FORM_W2_CHECKS[1]];
    expect(() =>
      assertW2ChecklistIsUsable([a, { ...b, order: a.order }]),
    ).toThrow(/share order/);
  });

  it("would reject an item that is not phrased as a question", () => {
    const real = FORM_W2_CHECKS[0];
    expect(() =>
      assertW2ChecklistIsUsable([{ ...real, question: "Reconcile the totals." }]),
    ).toThrow(/not phrased as a question/);
  });

  it("would reject an empty checklist rather than approving it", () => {
    expect(() => assertW2ChecklistIsUsable([])).toThrow(/checklist is empty/);
  });
});

/* ══════════════════════════════════════════════════════════════════ *
 * §5  WORKED EXAMPLES  (rules 82-84a)
 * ══════════════════════════════════════════════════════════════════ */

describe("§5 the examples are worked, not summarised", () => {
  it("passes its own gate", () => {
    expect(() => assertW2ExamplesAreWorked()).not.toThrow();
  });

  it("shows the arithmetic step by step, with numbers in the steps", () => {
    for (const ex of FORM_W2_WORKED_EXAMPLES) {
      expect(ex.steps.length).toBeGreaterThanOrEqual(3);
      expect(ex.steps.filter((s) => /\d/.test(s)).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("re-derives the published $11,439 ceiling in full", () => {
    const ex = FORM_W2_WORKED_EXAMPLES.find((e) => e.key === "box-4-ceiling");
    expect(ex).toBeDefined();
    const all = ex!.steps.join(" ");
    expect(all).toContain("184,500");
    expect(all).toContain("6,200");
    expect(all).toContain("1,143,900");
    expect(all).toContain("$11,439.00");
    // And it says the remainder is zero, which is the part that makes it exact.
    expect(all.toUpperCase()).toContain("ZERO");
  });

  it("teaches both directions of the box 1 difference", () => {
    const keys = FORM_W2_WORKED_EXAMPLES.map((e) => e.key);
    expect(keys).toContain("michael-premium"); // box 1 above box 5
    expect(keys).toContain("deferral-mirror"); // box 1 below box 5
  });

  it("works the 'approximately twice' exception with real figures", () => {
    const ex = FORM_W2_WORKED_EXAMPLES.find((e) => e.key === "approximately-twice");
    const all = ex!.steps.join(" ");
    expect(all).toContain("$450.00"); // the unmatched surtax
    expect(all).toContain("$7,700.00"); // the right answer
    expect(all).toContain("$8,150.00"); // the wrong one, shown for contrast
  });

  it("would reject a conclusion dressed up as an example", () => {
    const real = FORM_W2_WORKED_EXAMPLES[0];
    // No middle: a two-step "example" is an assertion with a preamble.
    expect(() =>
      assertW2ExamplesAreWorked([{ ...real, steps: ["Start.", "Therefore $11,439."] }]),
    ).toThrow(/step\(s\)/);
    // Steps with no arithmetic in them.
    expect(() =>
      assertW2ExamplesAreWorked([
        { ...real, steps: ["Take the wage base.", "Apply the rate.", "Read the answer."] },
      ]),
    ).toThrow(/almost no arithmetic/);
    // No statement of what it teaches.
    expect(() =>
      assertW2ExamplesAreWorked([{ ...real, theLesson: "Useful." }]),
    ).toThrow(/does not say what it is teaching/);
    expect(() => assertW2ExamplesAreWorked([])).toThrow(/no worked examples/);
  });

  it("names what each example teaches", () => {
    for (const ex of FORM_W2_WORKED_EXAMPLES) {
      expect(ex.theLesson.trim().length).toBeGreaterThan(60);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════ *
 * §6  CITATIONS
 * ══════════════════════════════════════════════════════════════════ */

describe("§6 every citation resolves to a real authority", () => {
  const knownIds = formW2Authorities().map((a) => a.id);

  it("resolves them all", () => {
    expect(knownIds.length).toBeGreaterThan(20);
    expect(() => assertEveryW2CitationResolves(knownIds)).not.toThrow();
  });

  it("refuses to run against an empty id list rather than approving silently", () => {
    // The gate's own rule-39 failure mode: given nothing to check against,
    // "no citation failed" would be true and meaningless.
    expect(() => assertEveryW2CitationResolves([])).toThrow(/zero known authority ids/);
  });

  it("would catch a citation naming an authority that does not exist", () => {
    const cited = w2CitedAuthorityIds();
    expect(cited.length).toBeGreaterThan(5);
    // Drive the REAL gate with a lesson citing an invented rule.
    const real = FORM_W2_LESSONS[0];
    expect(() =>
      assertEveryW2CitationResolves(knownIds, [
        { ...real, authorityIds: ["iw2w3-2026-invented-rule"] },
      ]),
    ).toThrow(/iw2w3-2026-invented-rule/);
  });

  it("cites the authority for each of the three traps", () => {
    const cited = w2CitedAuthorityIds();
    expect(cited).toContain("iw2w3-2026-box-1-scorp-health-premiums");
    expect(cited).toContain("iw2w3-2026-w3-box-12a-filtered-subset");
    expect(cited).toContain("iw2w3-2026-reconcile-941-approximately-twice");
  });
});

/* ══════════════════════════════════════════════════════════════════ *
 * §7  THE ADVICE ITSELF
 * ══════════════════════════════════════════════════════════════════ */

describe("§7 the mentor never advises the error it exists to prevent", () => {
  it("never tells the reader to force the wage boxes to agree", () => {
    expect(() => assertW2NeverAdvisesForcingBoxesToMatch()).not.toThrow();
  });

  it("would catch that advice if it ever crept in", () => {
    // Each banned phrasing, driven through the real gate. If someone deletes
    // a pattern from the gate, one of these goes red.
    for (const bad of [
      "If they differ, adjust box 1 so it matches and move on.",
      "Make box 1 equal box 5 before you file.",
      "Force the boxes to agree, then print.",
      "Change box 3 to match box 1.",
    ]) {
      expect(() => assertW2NeverAdvisesForcingBoxesToMatch([bad])).toThrow(
        /force the wage boxes to agree/,
      );
    }
  });

  it("refuses to scan an empty body of prose and call it clean", () => {
    expect(() => assertW2NeverAdvisesForcingBoxesToMatch([])).toThrow(
      /ADVICE GATE BROKEN/,
    );
  });

  it("actively warns against it instead", () => {
    const michael = FORM_W2_WORKED_EXAMPLES.find((e) => e.key === "michael-premium");
    expect(michael!.theLesson).toContain("overpays FICA");
    expect(michael!.theLesson).toContain("understates his income");
  });

  it("explains the 1040 consequence, which is the part that costs real money", () => {
    // The premium must be on the W-2 first for the self-employed health
    // insurance deduction to be available at all.
    const text = [
      ...FORM_W2_WORKED_EXAMPLES.map((e) => e.theLesson),
      ...FORM_W2_CHECKS.map((c) => c.ifItFails),
    ].join(" ");
    expect(text).toContain("self-employed health insurance");
  });

  it("teaches that a check which cannot fail is not a check", () => {
    const lesson = FORM_W2_LESSONS.find((l) => l.fn === "assertAdditionalMedicareBoundary");
    expect(lesson!.theTrap).toContain("could not fail");
    expect(lesson!.whatIWouldDo).toContain("cannot fail is not a check");
  });
});
