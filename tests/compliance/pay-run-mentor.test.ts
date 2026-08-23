/**
 * tests/compliance/pay-run-mentor.test.ts   (books-39 phase F)
 *
 * THE CPA MENTOR FOR THE PAY RUN, AND PROOF THAT ITS GATES BITE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS DEFENDING AGAINST
 * ─────────────────────────────────────────────────────────────────────────────
 * Not "is there a lesson for every code" — that is one assertion and it would
 * be an honest one. The failure mode this file exists for is subtler and has
 * happened repeatedly in this codebase: a coverage gate that reads NOTHING,
 * finds nothing untaught, and reports full coverage of a module that teaches
 * nothing (standing rule 39, and standing rule 50 — dead code wearing a green
 * check).
 *
 * So roughly half the tests below do not check coverage at all. They check the
 * CHECKER: point each gate at a file with no unions in it, at a deliberately
 * empty authority list, at a union name that does not exist, and prove it
 * throws. A gate that cannot be made to fail is decoration.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE DEFECT THIS SUITE ALREADY CAUGHT, RECORDED SO IT STAYS CAUGHT
 * ─────────────────────────────────────────────────────────────────────────────
 * The first draft of `pay-run-mentor.ts` cited all three W-4 authorities by
 * their TypeScript CONST NAME ("NO_W4_TREAT_AS_SINGLE") rather than by the
 * authority's real `id` ("pay-run-cfr-31-3402-f2-1-no-certificate"). `tsc`
 * returned zero, because the field was typed `string | null`. Every one of
 * those three citations resolved to nothing, while reading on screen as though
 * a lawyer had checked the sentence beneath it.
 *
 * The fix was to narrow the type so it stops compiling (standing rule 23). The
 * tests here are the second line: the compiler protects citations written in
 * TypeScript and does nothing for one arriving from a database row.
 */

import { describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ALL_PAY_RUN_REFUSAL_CODES,
  ALL_W4_PROVENANCES,
  describeW4Provenance,
  type PayRunRefusalCode,
  type W4Provenance,
} from "@/lib/payroll/pay-run-core";
import {
  ALL_PAY_RUN_AUTHORITY_IDS,
  PAY_RUN_AUTHORITIES,
  payRunAuthorityById,
} from "@/lib/payroll/pay-run-authorities";
import {
  PAY_RUN_CHECKS,
  PAY_RUN_RECOVERIES,
  PAY_RUN_REFUSAL_LESSONS,
  W4_PROVENANCE_LESSONS,
  danglingAuthorityIds,
  payRunRecovery,
  payRunRefusalLesson,
  uncitedByProvenanceLessons,
  untaughtPayRunCodes,
  w4ProvenanceLesson,
} from "@/lib/payroll/pay-run-mentor";
import {
  PAY_RUN_CORE_FUNCTION_COVERAGE,
  PAY_RUN_STORE_FAILURE_COVERAGE,
  REQUIRED_RECOVERY_STAGES,
  assertAuthorityIdUnionMatchesRegistry,
  assertEveryCitedPayRunAuthorityExists,
  assertEveryPayRunFunctionIsTaught,
  assertEveryPayRunRefusalCodeIsTaught,
  assertEveryPayRunStoreFailureIsTaught,
  assertEveryW4ProvenanceIsTaught,
  assertPayRunChecklistIsWellFormed,
  assertRecoveryLadderIsComplete,
  assertUnionScrapeWorks,
  payRunCoreExportedFunctionNames,
  payRunRefusalCodesInRuntimeArray,
  payRunRefusalCodesInSource,
  payRunStoreFailureCodesInSource,
  unionMembers,
  w4ProvenancesInSource,
} from "@/lib/payroll/pay-run-mentor-gates";
import {
  stripTypeScriptComments,
  unionMembersInSource,
} from "@/lib/payroll/mentor-quote-gate";

/** A throwaway .ts file, for pointing a gate at input it must reject. */
function tempSource(contents: string, name = "fake.ts"): string {
  const dir = mkdtempSync(join(tmpdir(), "payrun-gate-"));
  const p = join(dir, name);
  writeFileSync(p, contents, "utf8");
  return p;
}

/** Prose that mentions the union names but declares none of them. */
const DECOY_SOURCE = `
/**
 * This comment talks at length about PayRunRefusalCode and about W4Provenance
 * and about PayRunStoreFailureCode, and it even mentions "NO_HOURS" and
 * "furnished" and "READ_FAILED" in quotes, the way a doc-comment would.
 */
export const somethingElse = { code: "NO_HOURS" };
`;

describe("the gates run clean against the real engine", () => {
  it("every refusal code the engine can emit has a lesson", () => {
    expect(() => assertEveryPayRunRefusalCodeIsTaught()).not.toThrow();
  });

  it("every W-4 provenance has a lesson", () => {
    expect(() => assertEveryW4ProvenanceIsTaught()).not.toThrow();
  });

  it("every store failure code has an explanation", () => {
    expect(() => assertEveryPayRunStoreFailureIsTaught()).not.toThrow();
  });

  it("every exported engine function has an explanation", () => {
    expect(() => assertEveryPayRunFunctionIsTaught()).not.toThrow();
  });

  it("the authority id union and the registry agree in both directions", () => {
    expect(() => assertAuthorityIdUnionMatchesRegistry()).not.toThrow();
  });

  it("every cited authority resolves", () => {
    expect(() => assertEveryCitedPayRunAuthorityExists()).not.toThrow();
  });

  it("the checklist is well formed and in order", () => {
    expect(() => assertPayRunChecklistIsWellFormed()).not.toThrow();
  });

  it("the recovery ladder has every rung, in timeline order", () => {
    expect(() => assertRecoveryLadderIsComplete()).not.toThrow();
  });

  it("the union scrape is still matching what it used to", () => {
    expect(() => assertUnionScrapeWorks()).not.toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * PROVING THE GATES BITE — standing rules 15 and 16
 *
 * Each test below hands a gate input it MUST reject. If any of these stops
 * throwing, the corresponding green test above has become decoration.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the gates are failable", () => {
  it("the refusal gate refuses a source with no union in it", () => {
    const p = tempSource(DECOY_SOURCE);
    expect(() => assertEveryPayRunRefusalCodeIsTaught(p)).toThrow(/parses nothing/i);
  });

  it("the provenance gate refuses a source with no union in it", () => {
    const p = tempSource(DECOY_SOURCE);
    expect(() => assertEveryW4ProvenanceIsTaught(p)).toThrow(/parses nothing/i);
  });

  it("the store-failure gate refuses a source with no union in it", () => {
    const p = tempSource(DECOY_SOURCE);
    expect(() => assertEveryPayRunStoreFailureIsTaught(p)).toThrow(/parses nothing/i);
  });

  it("a decoy source really does mention the names — so the refusal above is not trivial", () => {
    // Guards the guard. If DECOY_SOURCE stopped containing these words, the
    // three tests above would still pass and would be proving nothing about
    // anchoring — only that an unrelated file has no unions.
    expect(DECOY_SOURCE).toContain("PayRunRefusalCode");
    expect(DECOY_SOURCE).toContain("W4Provenance");
    expect(DECOY_SOURCE).toContain("PayRunStoreFailureCode");
    expect(DECOY_SOURCE).toContain('"NO_HOURS"');
  });

  it("the refusal gate catches a code in the union that the lessons do not teach", () => {
    const p = tempSource(`
export type PayRunRefusalCode =
  | "NO_HOURS"
  | "NO_GROSS"
  | "NO_PAY_FREQUENCY"
  | "RATE_NOT_ON_FILE"
  | "NO_MINIMUM_WAGE"
  | "ENGINE_REFUSED"
  | "DOES_NOT_RECONCILE"
  | "A_BRAND_NEW_REASON_TO_STOP";
export const ALL_PAY_RUN_REFUSAL_CODES = [
  "NO_HOURS",
  "NO_GROSS",
  "NO_PAY_FREQUENCY",
  "RATE_NOT_ON_FILE",
  "NO_MINIMUM_WAGE",
  "ENGINE_REFUSED",
  "DOES_NOT_RECONCILE",
  "A_BRAND_NEW_REASON_TO_STOP",
];
`);
    expect(() => assertEveryPayRunRefusalCodeIsTaught(p)).toThrow(
      /A_BRAND_NEW_REASON_TO_STOP/,
    );
  });

  it("the refusal gate catches a lesson for a code that has been deleted", () => {
    // The stale direction, which is the more dangerous one: the count still
    // looks right while a live code goes untaught.
    const p = tempSource(`
export type PayRunRefusalCode = "NO_HOURS";
export const ALL_PAY_RUN_REFUSAL_CODES = [
  "NO_HOURS",
];
`);
    expect(() => assertEveryPayRunRefusalCodeIsTaught(p)).toThrow(/NO LONGER EXIST/);
  });

  it("the refusal gate catches a code in the TYPE that is missing from the runtime array", () => {
    // This is the defect no runtime-only check can see. The engine's switch
    // statements are exhaustive over the union; every test iterates the array.
    // A code in one and not the other is emitted and never examined.
    const p = tempSource(`
export type PayRunRefusalCode =
  | "NO_HOURS"
  | "NO_GROSS"
  | "NO_PAY_FREQUENCY"
  | "RATE_NOT_ON_FILE"
  | "NO_MINIMUM_WAGE"
  | "ENGINE_REFUSED"
  | "DOES_NOT_RECONCILE";
export const ALL_PAY_RUN_REFUSAL_CODES = [
  "NO_HOURS",
  "NO_GROSS",
  "NO_PAY_FREQUENCY",
  "RATE_NOT_ON_FILE",
  "NO_MINIMUM_WAGE",
  "ENGINE_REFUSED",
];
`);
    expect(() => assertEveryPayRunRefusalCodeIsTaught(p)).toThrow(
      /NOT IN ALL_PAY_RUN_REFUSAL_CODES[\s\S]*DOES_NOT_RECONCILE/,
    );
  });

  it("the refusal gate catches an array entry the TYPE does not allow", () => {
    const p = tempSource(`
export type PayRunRefusalCode = "NO_HOURS";
export const ALL_PAY_RUN_REFUSAL_CODES = [
  "NO_HOURS",
  "GHOST_CODE",
];
`);
    expect(() => assertEveryPayRunRefusalCodeIsTaught(p)).toThrow(/GHOST_CODE/);
  });

  it("the refusal gate refuses when the runtime array is missing entirely", () => {
    const p = tempSource(`
export type PayRunRefusalCode = "NO_HOURS" | "NO_GROSS";
`);
    expect(() => assertEveryPayRunRefusalCodeIsTaught(p)).toThrow(
      /read no entries from ALL_PAY_RUN_REFUSAL_CODES/,
    );
  });

  it("the authority gate refuses an empty known-id list rather than blaming the lessons", () => {
    expect(() => assertEveryCitedPayRunAuthorityExists([])).toThrow(
      /no authorities to check against/i,
    );
  });

  it("the authority gate reports a citation that does not resolve", () => {
    // Hand it a registry that is real but deliberately short. Every lesson's
    // citation must now dangle, and the message must name them.
    expect(() =>
      assertEveryCitedPayRunAuthorityExists(["pay-run-rcw-26-18-110-remit-clock"]),
    ).toThrow(/CITE AUTHORITIES THAT DO NOT EXIST/);
  });

  it("the function gate throws rather than reporting coverage of nothing", () => {
    const p = tempSource(`export const notAFunction = 1;`);
    expect(() => assertEveryPayRunFunctionIsTaught(p)).toThrow(/read no exported functions/i);
  });

  it("the function gate catches an exported function with no explanation", () => {
    const p = tempSource(`
export function chooseW4() {}
export function describeW4Provenance() {}
export function yearOfDayKey() {}
export function computePayRunLine() {}
export function computePayRun() {}
export function anUntaughtNewFunction() {}
`);
    expect(() => assertEveryPayRunFunctionIsTaught(p)).toThrow(/anUntaughtNewFunction/);
  });

  it("the function gate catches an explanation for a function that is gone", () => {
    const p = tempSource(`export function chooseW4() {}`);
    expect(() => assertEveryPayRunFunctionIsTaught(p)).toThrow(/NO LONGER EXIST/);
  });

  it("the union scrape returns nothing for a union that does not exist", () => {
    const members = unionMembers(
      join(process.cwd(), "src", "lib", "payroll", "pay-run-core.ts"),
      "NoSuchUnionName",
    );
    expect(members).toEqual([]);
  });

  it("the union scrape is anchored, and does not harvest quoted words from prose", () => {
    const p = tempSource(DECOY_SOURCE);
    expect(unionMembers(p, "PayRunRefusalCode")).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE GATES CANNOT SEE: the lessons themselves have to be worth reading
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the refusal lessons are usable by a person, not just present", () => {
  it("there is exactly one lesson per code, and no duplicates", () => {
    expect(PAY_RUN_REFUSAL_LESSONS).toHaveLength(ALL_PAY_RUN_REFUSAL_CODES.length);
    const codes = PAY_RUN_REFUSAL_LESSONS.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("untaughtPayRunCodes reports nothing untaught", () => {
    expect(untaughtPayRunCodes()).toEqual({ refusalCodes: [], provenances: [] });
  });

  it("untaughtPayRunCodes is comparing against a non-empty list", () => {
    // Without this, the assertion above passes if both sides are empty — the
    // vacuous green that standing rule 39 exists for.
    expect(ALL_PAY_RUN_REFUSAL_CODES.length).toBeGreaterThanOrEqual(7);
    expect(ALL_W4_PROVENANCES.length).toBeGreaterThanOrEqual(3);
  });

  it("every lesson answers all four questions with real prose", () => {
    for (const l of PAY_RUN_REFUSAL_LESSONS) {
      expect(l.headline.length, `${l.code} headline`).toBeGreaterThan(20);
      expect(l.whyWeStop.length, `${l.code} whyWeStop`).toBeGreaterThan(80);
      expect(l.whatToDo.length, `${l.code} whatToDo`).toBeGreaterThan(80);
      expect(l.costOfGuessing.length, `${l.code} costOfGuessing`).toBeGreaterThan(60);
    }
  });

  it("no lesson tells Michael to 'check the configuration' or another dead end", () => {
    // A refusal exists to produce the next click. Generic advice is how a user
    // concludes the software has nothing to offer and overrides it.
    const deadEnds = [
      /check your configuration/i,
      /contact (your )?(system )?administrator/i,
      /an error occurred/i,
      /please try again/i,
      /verify the data\b/i,
    ];
    for (const l of PAY_RUN_REFUSAL_LESSONS) {
      for (const d of deadEnds) {
        expect(d.test(l.whatToDo), `${l.code}.whatToDo matches ${d}`).toBe(false);
      }
    }
  });

  it("every whatToDo names a place to go, not just a thing to want", () => {
    // Checked by looking for at least one concrete noun a person can click or
    // walk to. This is deliberately a low bar; it catches the empty ones.
    const places =
      /Timesheets|Staffing|Payroll|Rates|Garnishment|W-4|pay run|Settings|notice|Pay\b/i;
    for (const l of PAY_RUN_REFUSAL_LESSONS) {
      expect(places.test(l.whatToDo), `${l.code}.whatToDo names nowhere to go`).toBe(true);
    }
  });

  it("payRunRefusalLesson resolves every code and returns null for a stranger", () => {
    for (const c of ALL_PAY_RUN_REFUSAL_CODES) {
      expect(payRunRefusalLesson(c), `no lesson for ${c}`).toBeTruthy();
    }
    expect(payRunRefusalLesson("NOT_A_CODE" as PayRunRefusalCode)).toBeNull();
  });
});

describe("the W-4 provenance lessons", () => {
  it("there is one per provenance and each cites a real authority", () => {
    expect(W4_PROVENANCE_LESSONS).toHaveLength(ALL_W4_PROVENANCES.length);
    for (const l of W4_PROVENANCE_LESSONS) {
      expect(l.authorityId, `${l.provenance} cites nothing`).not.toBeNull();
      expect(payRunAuthorityById(l.authorityId as string), `${l.provenance}`).toBeTruthy();
    }
  });

  it("danglingAuthorityIds is empty — and this is the test that caught it not being", () => {
    // On first write this returned all three, because the lessons cited const
    // NAMES rather than ids. Recorded here so the assertion is understood as
    // load-bearing rather than ceremonial.
    expect(danglingAuthorityIds()).toEqual([]);
  });

  it("w4ProvenanceLesson resolves every provenance and returns null for a stranger", () => {
    for (const p of ALL_W4_PROVENANCES) {
      expect(w4ProvenanceLesson(p), `no lesson for ${p}`).toBeTruthy();
    }
    expect(w4ProvenanceLesson("invented" as W4Provenance)).toBeNull();
  });

  it("the two statutory-default lessons do NOT tell Michael to withhold the cheque", () => {
    // This is the single most valuable thing in the provenance layer. A missing
    // W-4 does not stop payroll — the regulation supplies the answer, and the
    // cheque is lawful. Advice to hold the cheque would be advice to break
    // RCW 49.48.010, which is the opposite of help.
    const defaults = W4_PROVENANCE_LESSONS.filter((l) =>
      l.provenance.startsWith("statutory_default"),
    );
    expect(defaults).toHaveLength(2);
    for (const l of defaults) {
      expect(/do not pay|don't pay|withhold the cheque|hold the check/i.test(l.whatToDo)).toBe(
        false,
      );
      expect(/pay|correct|lawful|legally/i.test(`${l.whatItMeans} ${l.whatToDo}`)).toBe(true);
    }
  });

  it("the unsigned case is described as more urgent than the absent case", () => {
    // Because it looks finished. The employee filled the form in and believes
    // their elections are in force; they are not, and nobody is going to chase
    // a form that is already on file.
    const unsigned = w4ProvenanceLesson("statutory_default_unsigned");
    expect(unsigned).toBeTruthy();
    expect(/urgent|looks finished|believes/i.test(unsigned!.whatToDo)).toBe(true);
  });

  it("the mentor headline and the engine's own sentence do not contradict each other", () => {
    // Two wordings of one fact is how a stub and a screen come to disagree.
    // Both must exist and neither may be a stub.
    for (const p of ALL_W4_PROVENANCES) {
      const engine = describeW4Provenance(p);
      expect(engine.length, `engine sentence for ${p}`).toBeGreaterThan(20);
      expect(w4ProvenanceLesson(p)!.headline.length).toBeGreaterThan(20);
    }
  });
});

describe("the pre-flight checklist Michael asked for", () => {
  it("is ordered 1..n with no gaps", () => {
    const orders = PAY_RUN_CHECKS.map((c) => c.order);
    expect(orders).toEqual(PAY_RUN_CHECKS.map((_, i) => i + 1));
  });

  it("puts rates first, because a missing rate is wrong for everybody at once", () => {
    expect(PAY_RUN_CHECKS[0]?.key).toBe("rates-on-file");
  });

  it("puts hours before anything computed from hours", () => {
    const idx = (k: string) => PAY_RUN_CHECKS.findIndex((c) => c.key === k);
    expect(idx("punches-clean")).toBeLessThan(idx("orders-current"));
    expect(idx("punches-clean")).toBeLessThan(idx("read-three-cheques"));
  });

  it("ends by asking a human to actually read some cheques", () => {
    // Every check before this one can pass while the run is wrong in a way only
    // a person who knows these employees would notice.
    expect(PAY_RUN_CHECKS[PAY_RUN_CHECKS.length - 1]?.key).toBe("read-three-cheques");
  });

  it("every check is a question, and explains its position and its cost", () => {
    for (const c of PAY_RUN_CHECKS) {
      expect(c.question.trimEnd().endsWith("?"), `${c.key} is not a question`).toBe(true);
      expect(c.whyThisOrder.length, `${c.key} whyThisOrder`).toBeGreaterThan(80);
      expect(c.howToCheck.length, `${c.key} howToCheck`).toBeGreaterThan(60);
      expect(c.ifItFails.length, `${c.key} ifItFails`).toBeGreaterThan(60);
    }
  });

  it("no check says merely 'verify the data'", () => {
    for (const c of PAY_RUN_CHECKS) {
      expect(/^verify the data\.?$/i.test(c.howToCheck.trim())).toBe(false);
    }
  });
});

describe("how to fix it after you have got it wrong", () => {
  it("covers every stage of the timeline, in order", () => {
    expect(PAY_RUN_RECOVERIES.map((r) => r.key)).toEqual(REQUIRED_RECOVERY_STAGES);
  });

  it("the ladder distinguishes before the money moved from after", () => {
    // The whole reason there are five rungs rather than one paragraph.
    const before = payRunRecovery("before-approval");
    expect(before).toBeTruthy();
    expect(/nothing has been saved/i.test(before!.headline)).toBe(true);
  });

  it("names 941-X once the quarter is filed", () => {
    const r = payRunRecovery("after-quarter-filed");
    expect(r).toBeTruthy();
    expect(`${r!.headline} ${r!.whatToDo}`).toMatch(/941-X/);
  });

  it("names W-2c once the W-2 has been issued", () => {
    const r = payRunRecovery("after-w2-issued");
    expect(r).toBeTruthy();
    expect(`${r!.headline} ${r!.whatToDo}`).toMatch(/W-2c/);
  });

  it("every rung carries the trap people fall into at that stage", () => {
    for (const r of PAY_RUN_RECOVERIES) {
      expect(r.when.length, `${r.key} when`).toBeGreaterThan(20);
      expect(r.whatToDo.length, `${r.key} whatToDo`).toBeGreaterThan(80);
      expect(r.theTrap.length, `${r.key} theTrap`).toBeGreaterThan(60);
    }
  });

  it("payRunRecovery returns null for a stage that does not exist", () => {
    expect(payRunRecovery("after-the-heat-death-of-the-universe" as never)).toBeNull();
  });
});

describe("the authority id union keeps the citations compile-checked", () => {
  it("the union and the registry hold exactly the same ids", () => {
    expect([...ALL_PAY_RUN_AUTHORITY_IDS].sort()).toEqual(
      PAY_RUN_AUTHORITIES.map((a) => a.id as string).sort(),
    );
  });

  it("every id in the union resolves through the lookup", () => {
    for (const id of ALL_PAY_RUN_AUTHORITY_IDS) {
      expect(payRunAuthorityById(id), `union id ${id} resolves to nothing`).toBeTruthy();
    }
  });

  it("the ids are real ids, not TypeScript const names — the exact defect that shipped", () => {
    // Const names are SCREAMING_SNAKE. Authority ids are kebab-case and begin
    // with the module prefix. Asserting the shape catches the mistake class,
    // not just the three instances that were found.
    for (const id of ALL_PAY_RUN_AUTHORITY_IDS) {
      expect(id, `${id} looks like a const name, not an id`).toMatch(/^pay-run-[a-z0-9-]+$/);
      expect(/[A-Z_]/.test(id), `${id} contains an uppercase or underscore`).toBe(false);
    }
  });

  it("two authorities are deliberately not cited by a provenance lesson", () => {
    // The remittance clock and the January minimum-wage adjustment are not
    // about which W-4 governs. Asserting the exact set means the day somebody
    // mirrors a sixth authority and wires it nowhere, this test says so.
    expect([...uncitedByProvenanceLessons()].sort()).toEqual([
      "pay-run-rcw-26-18-110-remit-clock",
      "pay-run-rcw-49-46-020-annual-adjustment",
    ]);
  });
});

describe("the store's failures reach the same screen and are explained too", () => {
  it("every store failure code is covered", () => {
    const codes = payRunStoreFailureCodesInSource();
    expect(codes.length).toBeGreaterThanOrEqual(4);
    for (const c of codes) {
      expect(PAY_RUN_STORE_FAILURE_COVERAGE[c], `no explanation for ${c}`).toBeTruthy();
    }
  });

  it("no store code silently collides with an engine refusal code", () => {
    // They are different unions on different layers. If a name appeared in
    // both, a screen keyed on the string would show the wrong lesson.
    const store = new Set(payRunStoreFailureCodesInSource());
    const engine = payRunRefusalCodesInSource();
    const collisions = engine.filter((c) => store.has(c));
    expect(collisions, `codes shared between layers: ${collisions.join(", ")}`).toEqual([]);
  });

  it("each explanation is prose, not a restatement of the code name", () => {
    for (const [code, text] of Object.entries(PAY_RUN_STORE_FAILURE_COVERAGE)) {
      expect(text.length, `${code}`).toBeGreaterThan(100);
      expect(text.toLowerCase().replace(/[^a-z]/g, "")).not.toBe(
        code.toLowerCase().replace(/[^a-z]/g, ""),
      );
    }
  });
});

describe("the engine coverage map", () => {
  it("names every exported function of pay-run-core", () => {
    const fns = payRunCoreExportedFunctionNames();
    expect(fns.length).toBeGreaterThanOrEqual(5);
    expect([...fns].sort()).toEqual(Object.keys(PAY_RUN_CORE_FUNCTION_COVERAGE).sort());
  });

  it("no entry is a one-line restatement of the function name", () => {
    for (const [fn, text] of Object.entries(PAY_RUN_CORE_FUNCTION_COVERAGE)) {
      expect(text.length, `${fn} entry is a stub`).toBeGreaterThan(120);
    }
  });
});

describe("standing rule 65b — this mentor stays out of node:fs", () => {
  it("the lesson data module imports no node builtins", async () => {
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync(
      join(process.cwd(), "src", "lib", "payroll", "pay-run-mentor.ts"),
      "utf8",
    );
    // CODE ONLY, NOT COMMENTS — and the distinction is not pedantry. The first
    // version of this test read the raw text and failed, because the file's own
    // header comment EXPLAINS the books-33 incident and therefore contains the
    // words "node:fs" and "readFileSync". A test that forbids a module from
    // describing the rule it obeys is a test that gets satisfied by deleting
    // the explanation, which makes the codebase worse and the suite greener.
    const src = stripTypeScriptComments(raw);

    // books-33: a mentor file mixed lesson data with readFileSync, the data was
    // imported by a client component, node:fs went into a browser bundle, and
    // every deployment broke while CI stayed green.
    expect(src).not.toMatch(/from "node:/);
    expect(src).not.toMatch(/require\("node:/);
    expect(src).not.toMatch(/\breadFileSync\b/);

    // And prove the stripping did not simply eat the file, which would make
    // every assertion above pass for the wrong reason (standing rule 39).
    expect(src).toMatch(/export const PAY_RUN_REFUSAL_LESSONS/);
    expect(src).toMatch(/export const PAY_RUN_CHECKS/);
    expect(raw).toMatch(/readFileSync/); // the comment really does mention it
  });

  it("the gates module is the one that does the I/O", () => {
    // The complement. If this stopped being true the test above would pass for
    // the wrong reason — because nothing reads from disk at all any more, and
    // every gate would then be checking a hand-typed list.
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "payroll", "pay-run-mentor-gates.ts"),
      "utf8",
    );
    expect(src).toMatch(/from "node:fs"/);
  });
});

describe("the runtime array scrape", () => {
  it("reads the same seven codes the engine exports at runtime", () => {
    expect([...payRunRefusalCodesInRuntimeArray()].sort()).toEqual(
      [...ALL_PAY_RUN_REFUSAL_CODES].sort(),
    );
  });

  it("reads the same three provenances the engine exports at runtime", () => {
    expect([...w4ProvenancesInSource()].sort()).toEqual([...ALL_W4_PROVENANCES].sort());
  });

  it("returns nothing when the array is absent, rather than guessing", () => {
    const p = tempSource(`export type PayRunRefusalCode = "NO_HOURS";`);
    expect(payRunRefusalCodesInRuntimeArray(p)).toEqual([]);
  });
});
