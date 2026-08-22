/**
 * company-identity-mentor.test.ts
 *
 * Guards the CPA/CFO mentor layer on the company information screen.
 *
 * Michael asked for a screen with "a mentoring guiding cpa cfo help me fill it
 * out properly, explain what everything is used for, where it is used, and
 * why", with verbatim sources and plain-English readings of them. That is a
 * requirement, so it gets tested like one. The tests below prove three things:
 * every field is taught, every citation resolves, and THE COVERAGE GATES
 * THEMSELVES FAIL WHEN THEY SHOULD - because a gate nobody has ever seen fail
 * is indistinguishable from a gate that cannot fail.
 *
 * Standing rules exercised: 16 (prove the gate is WIRED), 24 (the quote is
 * sacred), 26 (every engine ships a mentor layer), 39 (guard vacuous reads),
 * 40 (load-bearing rules get tested).
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  COMPANY_FIELD_LESSONS,
  COMPANY_SCREEN_LESSONS,
  assertEveryCitedAuthorityExists,
  assertEveryFieldIsTaught,
  assertEveryFormCanBeExplained,
  assertNoLessonForUnknownField,
  explainFormNeeds,
  taughtFieldNames,
  unusedAuthorityIds,
} from "@/lib/accounting/company-identity-mentor";
// books-33 moved the two disk-reading gates into this sibling so the mentor
// stays browser-safe. Both are still called below, unchanged.
import {
  CORE_FUNCTION_COVERAGE,
  assertEveryExportedFunctionIsTaught,
  exportedCoreFunctionNames,
} from "@/lib/accounting/company-identity-mentor-gates";
import { COMPANY_FIELDS, COMPANY_FORMS, FORM_TITLES } from "@/lib/accounting/company-identity-core";
import { COMPANY_IDENTITY_AUTHORITIES } from "@/lib/accounting/company-identity-authorities";

describe("every field on the screen is taught", () => {
  it("has a lesson for each of the twenty fields", () => {
    expect(COMPANY_FIELD_LESSONS.length).toBe(COMPANY_FIELDS.length);
    expect(() => assertEveryFieldIsTaught()).not.toThrow();
  });

  it("teaches no field that does not exist", () => {
    // The other direction, and it matters: a lesson for a renamed column
    // renders help beside nothing, reading as reassurance while a live field
    // goes unexplained.
    expect(() => assertNoLessonForUnknownField()).not.toThrow();
  });

  it("has no duplicate lessons", () => {
    const names = taughtFieldNames();
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it("answers all five of Michael's questions for every field", () => {
    // whatItIs / whereItIsUsed / whyItMatters / theTrap / howToBeSure map one
    // to one onto "what everything is used for, where it is used, and why",
    // plus the two a CPA would add unprompted.
    const thin: string[] = [];
    for (const l of COMPANY_FIELD_LESSONS) {
      if (l.whatItIs.trim().length < 40) thin.push(`${l.field}: whatItIs`);
      if (l.whereItIsUsed.trim().length < 40) thin.push(`${l.field}: whereItIsUsed`);
      if (l.whyItMatters.trim().length < 60) thin.push(`${l.field}: whyItMatters`);
      if (l.theTrap.trim().length < 40) thin.push(`${l.field}: theTrap`);
      if (l.howToBeSure.trim().length < 30) thin.push(`${l.field}: howToBeSure`);
    }
    expect(thin).toEqual([]);
  });

  it("tells Michael where to look to be sure, not merely that he should be", () => {
    // "Check your records" is not an answer. Every howToBeSure has to name a
    // document, a letter, an account, or a person.
    const vague = COMPANY_FIELD_LESSONS.filter(
      (l) => !/[A-Z0-9]/.test(l.howToBeSure.replace(/^[^a-z]*/, "")) && l.howToBeSure.length < 60,
    );
    expect(vague.map((l) => l.field)).toEqual([]);
  });

  it("cites at least one authority for every field except the recorded L&I debt", () => {
    // Rule 24: the two L&I fields have no mirrored instruction yet, so they
    // carry no citation rather than an invented one. Everything else is sourced.
    const uncited = COMPANY_FIELD_LESSONS.filter((l) => l.authorityIds.length === 0).map((l) => l.field);
    expect(uncited.sort()).toEqual(["lni_account_number", "lni_risk_class"]);
  });
});

describe("the screen-level lessons explain the design and not just the boxes", () => {
  /**
   * A note on how this section is written. My first draft read a `body` field
   * that ScreenLesson does not have, so every assertion here ran against a
   * string of spaces. Six tests failed rather than passing vacuously, which is
   * the guard doing its job - but the lesson is that a test must read the real
   * shape and not the shape the author remembers. `allProse` is derived from
   * the type's actual fields so that renaming one breaks compilation.
   */
  const allProse = COMPANY_SCREEN_LESSONS.map(
    (l) => `${l.topic} ${l.plainEnglish} ${l.whyItMatters}`,
  ).join(" ");

  it("teaches the seven cross-cutting topics", () => {
    expect(COMPANY_SCREEN_LESSONS.length).toBe(7);
    for (const l of COMPANY_SCREEN_LESSONS) {
      expect(l.topic.trim().length).toBeGreaterThan(10);
      expect(l.plainEnglish.trim().length).toBeGreaterThan(100);
      expect(l.whyItMatters.trim().length).toBeGreaterThan(80);
    }
  });

  it("reads something rather than nothing", () => {
    // Rule 39, stated outright, because the whole section below depends on it.
    expect(allProse.trim().length).toBeGreaterThan(3000);
  });

  it("explains why the EIN is shown in full while SSNs are masked", () => {
    // A genuine asymmetry that looks like a bug until it is explained: the
    // instructions permit truncating an SSN and forbid truncating the EIN.
    expect(allProse).toMatch(/truncat/i);
  });

  it("connects the state fields to the money at stake", () => {
    // The FUTA credit turns 6.0% into 0.6%. That is why the state account
    // fields are not administrative trivia.
    expect(allProse).toMatch(/0\.6/);
    expect(allProse).toMatch(/6\.0/);
  });

  it("connects the quarterly report to the time clock the POS already has", () => {
    // Standing rule 63b: search for the feeder before building one. RCW
    // 50.12.070 wants HOURS WORKED and the POS already records punches, so the
    // mentor says so rather than leaving Michael to discover the connection.
    const lower = allProse.toLowerCase();
    expect(lower).toMatch(/hours/);
    expect(lower).toMatch(/time (clock|card)|punch/);
  });

  it("connects the deposit rules to the ACH setup that already exists", () => {
    const lower = allProse.toLowerCase();
    expect(lower).toMatch(/ach|electronic funds|eftps/);
  });

  it("says why it matters in every lesson, not merely what is true", () => {
    // The difference between a mentor and a manual.
    const silent = COMPANY_SCREEN_LESSONS.filter((l) => l.whyItMatters.trim().length < 80);
    expect(silent.map((l) => l.topic)).toEqual([]);
  });
});

describe("every citation the mentor makes resolves", () => {
  it("cites no authority that does not exist", () => {
    expect(() => assertEveryCitedAuthorityExists()).not.toThrow();
  });

  it("leaves no authority in the registry unused", () => {
    // Not a correctness bug, but it means research was done and then not
    // connected. Twenty-eight documents were mirrored and quoted; all of them
    // should be doing work somewhere on this screen.
    expect(unusedAuthorityIds()).toEqual([]);
  });

  it("draws its citations from the merged registry rather than a private copy", () => {
    const known = new Set(COMPANY_IDENTITY_AUTHORITIES.map((a) => a.id));
    const cited = new Set<string>();
    for (const l of COMPANY_FIELD_LESSONS) for (const id of l.authorityIds) cited.add(id);
    for (const l of COMPANY_SCREEN_LESSONS) for (const id of l.authorityIds) cited.add(id);
    expect([...cited].filter((id) => !known.has(id))).toEqual([]);
    // Rule 39: prove the loop found citations to check.
    expect(cited.size).toBeGreaterThan(15);
  });
});

describe("form narration is derived, never hand-written", () => {
  it("narrates every form", () => {
    expect(() => assertEveryFormCanBeExplained()).not.toThrow();
  });

  it("matches the consumer declarations exactly for every form", () => {
    // Standing rule 62. A hand-written paragraph per form would read better and
    // would eventually be a lie; this cannot drift from the readiness engine
    // because it is computed from the same declarations.
    for (const form of COMPANY_FORMS) {
      const e = explainFormNeeds(form);
      const expectedRequired = COMPANY_FIELDS.filter((f) =>
        f.consumers.some((c) => c.form === form && c.necessity === "required"),
      ).map((f) => f.label);
      expect(e.required).toEqual(expectedRequired);
      expect(e.title).toBe(FORM_TITLES[form]);
      expect(e.narration.length).toBeGreaterThan(40);
    }
  });

  it("names the form and counts the fields in the narration", () => {
    const e = explainFormNeeds("form-941");
    expect(e.narration).toContain(FORM_TITLES["form-941"]);
    expect(e.narration).toContain(String(e.required.length));
    // The trade name is the conditional one on a 941, and it must be mentioned
    // rather than silently dropped.
    expect(e.conditional.length).toBeGreaterThan(0);
  });

  it("uses the singular when a form needs exactly one field", () => {
    // Small thing. The ACH file needs only the EIN, and "1 fields" is the kind
    // of detail that makes a report look machine-generated and untrusted.
    const e = explainFormNeeds("nacha-payroll");
    expect(e.required.length).toBe(1);
    expect(e.narration).toContain("1 field:");
    expect(e.narration).not.toContain("1 fields");
  });
});

describe("the rule 26 coverage gate reads the real engine and fails when it should", () => {
  /**
   * STANDING RULE 16: PROVE THE GATE IS WIRED. Each test here makes the gate
   * fail on purpose. A coverage gate that has never been seen to fail is
   * indistinguishable from a comment.
   */
  const CORE_REL = join("src", "lib", "accounting", "company-identity-core.ts");

  it("reads the exported functions out of the file on disk", () => {
    const names = exportedCoreFunctionNames();
    expect(names).toContain("formatEin");
    expect(names).toContain("requireField");
    expect(names).toContain("assertEverySignerRuleExists");
    expect(names.length).toBe(Object.keys(CORE_FUNCTION_COVERAGE).length);
  });

  it("explains every exported function", () => {
    expect(() => assertEveryExportedFunctionIsTaught()).not.toThrow();
  });

  it("FAILS when it reads a file with no exported functions", () => {
    // Rule 39: the specific disaster is a refactor that moves the engine, the
    // regex matching nothing, and the gate reporting success against an empty
    // list forever.
    const dir = mkdtempSync(join(tmpdir(), "mentor-gate-"));
    const empty = join(dir, "empty.ts");
    writeFileSync(empty, "// no exports here at all\nconst x = 1;\n", "utf8");
    expect(() => assertEveryExportedFunctionIsTaught(empty)).toThrow(/read no exported functions/i);
    expect(() => assertEveryExportedFunctionIsTaught(empty)).toThrow(/vacuous/i);
  });

  it("FAILS when a function ships with no explanation", () => {
    const dir = mkdtempSync(join(tmpdir(), "mentor-gate-"));
    const extra = join(dir, "extra.ts");
    const body =
      Object.keys(CORE_FUNCTION_COVERAGE)
        .map((n) => `export function ${n}() {}`)
        .join("\n") + "\nexport function buildForm941Signature() {}\n";
    writeFileSync(extra, body, "utf8");
    expect(() => assertEveryExportedFunctionIsTaught(extra)).toThrow(/no explanation/i);
    expect(() => assertEveryExportedFunctionIsTaught(extra)).toThrow(/buildForm941Signature/);
  });

  it("FAILS on a stale coverage entry for a function that no longer exists", () => {
    // A phantom entry is worse than a gap: the count looks right while a live
    // function goes untaught.
    const dir = mkdtempSync(join(tmpdir(), "mentor-gate-"));
    const fewer = join(dir, "fewer.ts");
    const kept = Object.keys(CORE_FUNCTION_COVERAGE).slice(0, -1);
    const dropped = Object.keys(CORE_FUNCTION_COVERAGE).slice(-1)[0];
    writeFileSync(fewer, kept.map((n) => `export function ${n}() {}`).join("\n"), "utf8");
    expect(() => assertEveryExportedFunctionIsTaught(fewer)).toThrow(/NO LONGER EXIST/i);
    expect(() => assertEveryExportedFunctionIsTaught(fewer)).toThrow(new RegExp(dropped));
  });

  it("points at the engine that actually ships", () => {
    // Guards the gate pointing somewhere harmless. If this path is wrong the
    // three tests above pass while protecting nothing.
    expect(() => exportedCoreFunctionNames(join(process.cwd(), CORE_REL))).not.toThrow();
    expect(exportedCoreFunctionNames(join(process.cwd(), CORE_REL))).toEqual(exportedCoreFunctionNames());
  });

  it("gives every covered function a real explanation and not a placeholder", () => {
    const lazy = Object.entries(CORE_FUNCTION_COVERAGE).filter(([, v]) => v.trim().length < 40);
    expect(lazy.map(([k]) => k)).toEqual([]);
  });
});
