/**
 * tests/compliance/net-pay-mentor.test.ts   (books-37)
 *
 * THE NET-PAY MENTOR, AND THE GATES THAT KEEP IT HONEST.
 *
 * Standing rule 15: a check nobody has watched FAIL is not a check. Every gate
 * exercised here is exercised twice - once against the real modules to show it
 * passes, and once against a deliberately broken input to show it bites. A gate
 * that only ever passes is indistinguishable from a gate that always passes.
 *
 * Standing rule 16: proving the gate is WIRED matters as much as proving it
 * works. Several tests below write a temporary broken copy of an engine module
 * to disk and point the gate at it, because that is the only way to prove the
 * gate reads the real file rather than a convenient in-memory list.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GUIDANCE_AUTHORITIES } from "@/lib/accounting/books-guidance-core";
import { NET_PAY_AUTHORITIES } from "@/lib/payroll/net-pay-authorities";
import {
  NET_PAY_FIELD_LESSONS,
  NET_PAY_REFUSAL_LESSONS,
  NET_PAY_REVIEW_CHECKS,
  NET_PAY_SCREEN_LESSONS,
  taughtNetPayFieldNames,
} from "@/lib/payroll/net-pay-mentor";
import {
  assertEveryCitedNetPayAuthorityExists,
  assertEveryNetPayAuthorityIsUsed,
  assertEveryNetPayFieldIsTaught,
  assertEveryNetPayFunctionIsTaught,
  assertEveryNetPayRefusalCodeIsTaught,
  assertEveryQuotedNetPayLessonExists,
  assertEveryYtdStoreFunctionIsTaught,
  assertNetPayReviewChecksAreWellFormed,
  netPayBreakdownFieldNames,
  netPayExportedFunctionNames,
  netPayRefusalCodes,
  NET_PAY_CORE_FUNCTION_COVERAGE,
  YTD_STORE_FUNCTION_COVERAGE,
  ytdStoreExportedFunctionNames,
} from "@/lib/payroll/net-pay-mentor-gates";
import { exportedFunctionNames } from "@/lib/payroll/mentor-quote-gate";

const NET_PAY_CORE = join(process.cwd(), "src", "lib", "payroll", "net-pay-core.ts");
const YTD_STORE = join(process.cwd(), "src", "lib", "payroll", "ytd-store.ts");

let scratch: string;
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "net-pay-mentor-"));
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Write a mutated copy of a real module and return its path. */
function mutatedCopy(originalPath: string, name: string, mutate: (s: string) => string): string {
  const p = join(scratch, name);
  writeFileSync(p, mutate(readFileSync(originalPath, "utf8")), "utf8");
  return p;
}

// ---------------------------------------------------------------------------
// 1) THE GATES PASS AGAINST THE REAL MODULES
// ---------------------------------------------------------------------------

describe("the net-pay mentor covers the engines it claims to cover", () => {
  it("every exported function of net-pay-core is taught", () => {
    expect(() => assertEveryNetPayFunctionIsTaught()).not.toThrow();
  });

  it("every exported function of ytd-store is taught", () => {
    expect(() => assertEveryYtdStoreFunctionIsTaught()).not.toThrow();
  });

  it("every refusal code the engine can emit is taught", () => {
    expect(() => assertEveryNetPayRefusalCodeIsTaught()).not.toThrow();
  });

  it("every figure on the breakdown is taught or explicitly exempt", () => {
    expect(() => assertEveryNetPayFieldIsTaught()).not.toThrow();
  });

  it("every authority a lesson cites resolves to a real authority", () => {
    expect(() => assertEveryCitedNetPayAuthorityExists()).not.toThrow();
  });

  it("every net-pay authority is cited by at least one lesson", () => {
    expect(() => assertEveryNetPayAuthorityIsUsed()).not.toThrow();
  });

  it("every lesson title the coverage map quotes exists", () => {
    expect(() => assertEveryQuotedNetPayLessonExists()).not.toThrow();
  });

  it("the review checklist is well formed", () => {
    expect(() => assertNetPayReviewChecksAreWellFormed()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2) THE ASYNC SCRAPE - the defect this slice found in shared machinery
// ---------------------------------------------------------------------------

describe("the exported-function scrape can see async engines", () => {
  /**
   * THE BUG, PINNED. Eleven mentor-gate modules used /^export function .../gm,
   * which matches none of ytd-store.ts's exports because they are all async.
   * The gate would have read an empty list and reported full coverage of a
   * module that teaches nothing (standing rule 39).
   */
  it("ytd-store exports only async functions, which the old pattern could not see", () => {
    const source = readFileSync(YTD_STORE, "utf8");
    const oldPattern = [...source.matchAll(/^export function ([A-Za-z0-9_]+)/gm)];
    expect(oldPattern, "ytd-store has no plain `export function`").toHaveLength(0);

    const found = ytdStoreExportedFunctionNames();
    expect(found.length, "the fixed scrape must find the async exports").toBeGreaterThan(0);
    expect([...found].sort()).toEqual(
      [
        "applyRunToYtd",
        "loadYtdBoard",
        "loadYtdForEmployee",
        "reconcileEmployeeYtd",
        "unapplyRunFromYtd",
      ].sort(),
    );
  });

  it("the scrape still finds ordinary synchronous exports", () => {
    expect([...netPayExportedFunctionNames()].sort()).toEqual(
      ["computeNetPay", "netPayReconciles", "requiredByLawFor"].sort(),
    );
  });

  it("THROWS rather than returning an empty list when it parses nothing", () => {
    // A module with no exported functions at all. Returning [] here would let
    // every caller report full coverage of nothing.
    const empty = join(scratch, "empty.ts");
    writeFileSync(empty, "export const NOT_A_FUNCTION = 1;\n", "utf8");
    expect(() => exportedFunctionNames(empty, "PROBE")).toThrow(/FUNCTION GATE BROKEN/);
  });
});

// ---------------------------------------------------------------------------
// 3) MUTATION - every gate must BITE (standing rules 15 and 16)
// ---------------------------------------------------------------------------

describe("the coverage gates fail when coverage is actually missing", () => {
  it("bites when net-pay-core grows an untaught function", () => {
    const p = mutatedCopy(NET_PAY_CORE, "extra-fn.ts", (s) =>
      `${s}\nexport function anUntaughtNewFunction(): number {\n  return 1;\n}\n`,
    );
    expect(() => assertEveryNetPayFunctionIsTaught(p)).toThrow(
      /FUNCTIONS WITH NO EXPLANATION[\s\S]*anUntaughtNewFunction/,
    );
  });

  it("bites when ytd-store grows an untaught ASYNC function", () => {
    // The mutation that matters most: an async export is exactly what the old
    // shared pattern was blind to.
    const p = mutatedCopy(YTD_STORE, "extra-async.ts", (s) =>
      `${s}\nexport async function anUntaughtAsyncFunction(): Promise<number> {\n  return 1;\n}\n`,
    );
    expect(() => assertEveryYtdStoreFunctionIsTaught(p)).toThrow(
      /FUNCTIONS WITH NO EXPLANATION[\s\S]*anUntaughtAsyncFunction/,
    );
  });

  it("bites when a taught function stops being exported, leaving a stale lesson", () => {
    // UN-EXPORTING rather than renaming, deliberately. A rename trips BOTH
    // branches - a new untaught name AND a stale lesson - and the untaught
    // branch throws first, so the test would pass without ever exercising the
    // stale-lesson path it claims to cover. Removing the `export` keyword
    // isolates the phantom direction, which is the more dangerous of the two:
    // the coverage count still looks right while a lesson describes something
    // no caller can reach.
    const p = mutatedCopy(NET_PAY_CORE, "unexported-fn.ts", (s) =>
      s.replace("export function netPayReconciles", "function netPayReconciles"),
    );
    expect(() => assertEveryNetPayFunctionIsTaught(p)).toThrow(
      /EXPLAINS FUNCTIONS THAT NO LONGER EXIST[\s\S]*netPayReconciles/,
    );
  });

  it("bites when the engine grows an untaught refusal code", () => {
    const p = mutatedCopy(NET_PAY_CORE, "extra-code.ts", (s) =>
      s.replace(
        '  | "NET_PAY_WOULD_GO_NEGATIVE";',
        '  | "NET_PAY_WOULD_GO_NEGATIVE"\n  | "NET_PAY_BRAND_NEW_CODE";',
      ),
    );
    expect(() => assertEveryNetPayRefusalCodeIsTaught(p)).toThrow(
      /REFUSAL CODES WITH NO EXPLANATION[\s\S]*NET_PAY_BRAND_NEW_CODE/,
    );
  });

  it("bites when a taught refusal code is removed from the engine", () => {
    const p = mutatedCopy(NET_PAY_CORE, "fewer-codes.ts", (s) =>
      s.replace('  | "NET_PAY_DEDUCTION_NOT_WHOLE_CENTS"\n', ""),
    );
    expect(() => assertEveryNetPayRefusalCodeIsTaught(p)).toThrow(
      /REFUSAL CODES THAT NO LONGER EXIST[\s\S]*NET_PAY_DEDUCTION_NOT_WHOLE_CENTS/,
    );
  });

  it("bites when the breakdown grows an untaught figure", () => {
    const p = mutatedCopy(NET_PAY_CORE, "extra-field.ts", (s) =>
      s.replace(
        "  /** Non-fatal things Michael should know. */\n  readonly notes: readonly string[];",
        "  /** Non-fatal things Michael should know. */\n  readonly notes: readonly string[];\n" +
          "  readonly aMysteriousNewTotalCents: number;",
      ),
    );
    expect(() => assertEveryNetPayFieldIsTaught(p)).toThrow(
      /FIGURES WITH NO EXPLANATION[\s\S]*aMysteriousNewTotalCents/,
    );
  });

  it("bites when the L&I figure is quietly removed from the required-by-law bucket", () => {
    // THE DEFECT THIS SLICE EXISTS TO FIX, as a mutation. If waLniCents ever
    // disappears again, disposable earnings silently rise and every garnishment
    // takes too much. The stale-lesson direction is what catches it.
    const p = mutatedCopy(NET_PAY_CORE, "no-lni.ts", (s) =>
      s.replace("  readonly waLniCents: number;\n", ""),
    );
    expect(() => assertEveryNetPayFieldIsTaught(p)).toThrow(
      /FIGURES THAT NO LONGER EXIST[\s\S]*waLniCents/,
    );
  });

  it("bites when a lesson cites an authority that does not exist", () => {
    expect(() => assertEveryCitedNetPayAuthorityExists(["only-this-one-id"])).toThrow(
      /CITE AUTHORITIES THAT DO NOT EXIST/,
    );
  });

  it("bites when the coverage map quotes a lesson title that does not exist", () => {
    expect(() => assertEveryQuotedNetPayLessonExists(["a topic that is not quoted anywhere"])).toThrow(
      /QUOTES LESSONS THAT DO NOT EXIST/,
    );
  });

  it("refuses to run against an empty authority list rather than passing vacuously", () => {
    // Standing rule 39. With nothing to check against, every citation looks
    // dangling; the gate must say IT is broken, not blame the lessons.
    expect(() => assertEveryCitedNetPayAuthorityExists([])).toThrow(/GATE BROKEN/);
  });
});

// ---------------------------------------------------------------------------
// 4) THE LESSONS THEMSELVES - substance, not presence
// ---------------------------------------------------------------------------

describe("the lessons say something", () => {
  it("no field lesson is a restatement of the field name", () => {
    for (const l of NET_PAY_FIELD_LESSONS) {
      expect(l.whatItIs.length, `${l.field} whatItIs`).toBeGreaterThan(80);
      expect(l.whyItMatters.length, `${l.field} whyItMatters`).toBeGreaterThan(80);
      expect(l.theTrap.length, `${l.field} theTrap`).toBeGreaterThan(80);
      expect(l.howToBeSure.length, `${l.field} howToBeSure`).toBeGreaterThan(40);
      expect(l.authorityIds.length, `${l.field} cites nothing`).toBeGreaterThan(0);
    }
  });

  it("no two field lessons teach the same field", () => {
    const names = taughtNetPayFieldNames();
    expect(new Set(names).size, "duplicate field lessons").toBe(names.length);
  });

  it("every refusal lesson tells Michael what to actually do", () => {
    for (const l of NET_PAY_REFUSAL_LESSONS) {
      expect(l.headline.length, `${l.code} headline`).toBeGreaterThan(30);
      expect(l.whyWeStop.length, `${l.code} whyWeStop`).toBeGreaterThan(100);
      expect(l.whatToDo.length, `${l.code} whatToDo`).toBeGreaterThan(60);
      // The point of a refusal lesson is the ACTION. A "whatToDo" that merely
      // restates the problem leaves the reader exactly where they started.
      expect(l.whatToDo, `${l.code} whatToDo repeats the headline`).not.toBe(l.headline);
    }
  });

  it("every screen lesson carries an authority", () => {
    for (const l of NET_PAY_SCREEN_LESSONS) {
      expect(l.plainEnglish.length, `${l.topic} plainEnglish`).toBeGreaterThan(150);
      expect(l.whyItMatters.length, `${l.topic} whyItMatters`).toBeGreaterThan(150);
      expect(l.authorityIds.length, `${l.topic} cites nothing`).toBeGreaterThan(0);
    }
  });

  it("the review checklist asks questions rather than stating conclusions", () => {
    expect(NET_PAY_REVIEW_CHECKS.length).toBeGreaterThanOrEqual(5);
    for (const c of NET_PAY_REVIEW_CHECKS) {
      expect(c.question.trimEnd().endsWith("?"), c.question).toBe(true);
      expect(c.why.length, c.question).toBeGreaterThan(60);
      expect(c.howToCheck.length, c.question).toBeGreaterThan(40);
    }
  });
});

// ---------------------------------------------------------------------------
// 5) THE SUBJECT OF THE SLICE - the order, and the L&I deduction
// ---------------------------------------------------------------------------

describe("the teaching actually covers what this slice fixed", () => {
  it("the L&I employee premium is taught as required by law", () => {
    const lesson = NET_PAY_FIELD_LESSONS.find((l) => l.field === "requiredByLaw.waLniCents");
    expect(lesson, "no lesson for the deduction this slice exists to add").toBeDefined();
    expect(lesson?.authorityIds).toContain("net-pay-rcw-51-16-140-required");
  });

  it("all six required-by-law components have their own lesson", () => {
    // Not one lesson for "requiredByLaw". Six, because the six behave
    // differently: one stops mid-year, one never stops, one has no employer
    // match, and one is charged per hour rather than per dollar.
    const taught = new Set(taughtNetPayFieldNames());
    for (const f of [
      "requiredByLaw.federalIncomeTaxCents",
      "requiredByLaw.socialSecurityCents",
      "requiredByLaw.medicareCents",
      "requiredByLaw.additionalMedicareCents",
      "requiredByLaw.waPfmlCents",
      "requiredByLaw.waCaresCents",
      "requiredByLaw.waLniCents",
    ]) {
      expect(taught.has(f), `${f} has no lesson of its own`).toBe(true);
    }
  });

  it("disposable earnings is taught as distinct from take-home pay", () => {
    const lesson = NET_PAY_FIELD_LESSONS.find((l) => l.field === "disposableEarningsCents");
    expect(lesson).toBeDefined();
    expect(lesson?.theTrap.toLowerCase()).toContain("take-home");
  });

  it("the RCW 49.52 criminal exposure is taught, not just cited", () => {
    const cited = new Set(
      NET_PAY_SCREEN_LESSONS.flatMap((l) => l.authorityIds),
    );
    expect(cited.has("net-pay-rcw-49-52-050-rebate")).toBe(true);
    expect(cited.has("net-pay-rcw-49-52-060-authorized")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6) THE REGISTRY - the wiring that makes the quotes verifiable
// ---------------------------------------------------------------------------

describe("the net-pay authorities reach the shared registry", () => {
  /**
   * Standing rule 50. An authority module that is never merged into
   * GUIDANCE_AUTHORITIES is not read by scripts/verify-verbatim-quotes.ts,
   * which means its quotes are unchecked while the build stays green. This is
   * the test that proves the wiring exists.
   */
  it("every net-pay authority appears in the merged guidance registry", () => {
    const merged = new Set(GUIDANCE_AUTHORITIES.map((a) => a.id));
    for (const a of NET_PAY_AUTHORITIES) {
      expect(merged.has(a.id), `${a.id} is not in GUIDANCE_AUTHORITIES, so its quote is never verified`).toBe(true);
    }
  });

  it("the two DOL fact sheets are labelled as agency guidance, not IRS guidance", () => {
    // The first draft tagged them `irs_guidance` because the WEIGHT was right.
    // GUIDANCE_KIND_LABELS renders that as the words "IRS guidance", which
    // would have told Michael a DOL document came from the IRS.
    const fs30 = NET_PAY_AUTHORITIES.filter((a) => a.cite.includes("Wage and Hour Division"));
    expect(fs30.length, "expected the DOL fact sheet authorities").toBe(2);
    for (const a of fs30) {
      expect(a.kind, `${a.id} must not claim to be IRS guidance`).toBe("agency_guidance");
    }
  });

  it("each authority names a mirrored source file that exists", () => {
    for (const a of NET_PAY_AUTHORITIES) {
      expect(() => readFileSync(join(process.cwd(), a.source), "utf8")).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// 7) THE COVERAGE MAPS - entries must be explanations, not labels
// ---------------------------------------------------------------------------

describe("the coverage maps explain rather than restate", () => {
  it("no entry is a one-line restatement of the function name", () => {
    for (const [fn, text] of [
      ...Object.entries(NET_PAY_CORE_FUNCTION_COVERAGE),
      ...Object.entries(YTD_STORE_FUNCTION_COVERAGE),
    ]) {
      expect(text.length, `${fn} coverage entry is too short to be an explanation`).toBeGreaterThan(
        120,
      );
      expect(text.toLowerCase(), `${fn} entry merely names itself`).not.toBe(fn.toLowerCase());
    }
  });

  it("the maps cover exactly the functions the engines export, no more", () => {
    expect([...Object.keys(NET_PAY_CORE_FUNCTION_COVERAGE)].sort()).toEqual(
      [...netPayExportedFunctionNames()].sort(),
    );
    expect([...Object.keys(YTD_STORE_FUNCTION_COVERAGE)].sort()).toEqual(
      [...ytdStoreExportedFunctionNames()].sort(),
    );
  });

  it("the field scrape reads the real engine, not a memorised list", () => {
    // Standing rule 16 - prove the gate is WIRED. Rename a field on disk and
    // the scrape must report the new name.
    const p = mutatedCopy(NET_PAY_CORE, "renamed-field.ts", (s) =>
      s.replace("readonly netPayCents: number;", "readonly netPayCentsRenamed: number;"),
    );
    const fields = netPayBreakdownFieldNames(p);
    expect(fields).toContain("netPayCentsRenamed");
    expect(fields).not.toContain("netPayCents");
  });

  it("the refusal-code scrape reads the real engine", () => {
    expect(netPayRefusalCodes()).toContain("NET_PAY_WOULD_GO_NEGATIVE");
  });
});
