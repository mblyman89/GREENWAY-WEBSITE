/**
 * tests/compliance/r39-ach-mentor.test.ts   (R39 S1)
 *
 * Rule 26 coverage, both directions, with the gate itself tested against a
 * fixture so a broken scrape cannot pass (rule 39).
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ACH_FUNCTION_LESSONS,
  ACH_STATE_LESSONS,
  ACH_TOPIC_LESSONS,
  PRENOTE_VS_TEST_CREDIT,
  achLesson,
  untaughtStates,
} from "@/lib/payments/ach-mentor";
import {
  ACH_CORE_PATH,
  achCoreExportedFunctions,
  achMentorCoverage,
  danglingAchLessonAuthorities,
  uncitedAchAuthorities,
} from "@/lib/payments/ach-mentor-gates";
import { AUTHORIZATION_STATES } from "@/lib/payments/ach-authorization-core";

describe("ACH mentor coverage", () => {
  it("scrapes a real export list (guard the guard)", () => {
    expect(achCoreExportedFunctions().length).toBeGreaterThanOrEqual(25);
  });

  it("every exported core function is taught or explicitly exempt, and no lesson is dead", () => {
    expect(achMentorCoverage()).toEqual({ untaught: [], deadLessons: [], deadExemptions: [], doublyListed: [] });
  });

  it("the gate CAN fail: a fixture core with an extra export is reported untaught", () => {
    const dir = mkdtempSync(join(tmpdir(), "r39-"));
    const fake = join(dir, "core.ts");
    writeFileSync(fake, readFileSync(ACH_CORE_PATH, "utf8") + "\nexport function brandNewRule(): void {}\n");
    expect(achMentorCoverage(fake).untaught).toEqual(["brandNewRule"]);
  });

  it("the gate CAN fail: a fixture core missing a function reports the lesson as dead", () => {
    const dir = mkdtempSync(join(tmpdir(), "r39-"));
    const fake = join(dir, "core.ts");
    writeFileSync(fake, readFileSync(ACH_CORE_PATH, "utf8").replace("export function reversalDeadline", "function reversalDeadline"));
    expect(achMentorCoverage(fake).deadLessons).toEqual(["reversalDeadline"]);
  });

  it("an empty scrape throws rather than approving", () => {
    const dir = mkdtempSync(join(tmpdir(), "r39-"));
    const fake = join(dir, "core.ts");
    writeFileSync(fake, "const x = 1;\n");
    // The shared scraper (mentor-quote-gate) throws first with its own message;
    // either way the gate refuses rather than approving.
    expect(() => achCoreExportedFunctions(fake)).toThrow();
  });

  it("every cited authority exists, and every ACH authority is taught somewhere", () => {
    expect(danglingAchLessonAuthorities()).toEqual([]);
    expect(uncitedAchAuthorities()).toEqual([]);
  });

  it("every lifecycle state has a lesson", () => {
    expect(untaughtStates()).toEqual([]);
    expect(Object.keys(ACH_STATE_LESSONS).sort()).toEqual([...AUTHORIZATION_STATES].sort());
  });

  it("lesson keys are unique and resolvable", () => {
    const all = [PRENOTE_VS_TEST_CREDIT, ...ACH_FUNCTION_LESSONS, ...ACH_TOPIC_LESSONS];
    const keys = all.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const l of all) {
      expect(achLesson(l.key)).toBe(l);
      expect(l.authorities.length, l.key).toBeGreaterThan(0);
      expect(l.plain.length, l.key).toBeGreaterThan(80);
    }
    expect(achLesson("nope")).toBeNull();
  });
});

describe("Q3 - the plain-English prenote answer says what the sources say", () => {
  const p = PRENOTE_VS_TEST_CREDIT.plain;
  it("prenote: $0, proves existence not ownership, three banking days", () => {
    expect(p).toContain("$0.00");
    expect(p).toMatch(/does not\s+prove the person who gave it to you OWNS it/);
    expect(p).toContain("three banking days");
  });
  it("test credit: under $1, ACCTVERIFY, never taken back (credits only)", () => {
    expect(p).toContain("less than $1.00");
    expect(p).toContain("ACCTVERIFY");
    expect(p).toContain("never takes the pennies back");
  });
  it("does not claim a prenote is a check", () => {
    expect(p).not.toMatch(/prenote is a (paper )?check/i);
  });
});

describe("client-bundle purity", () => {
  it("ach-mentor.ts does not import node: modules (rule 65b)", () => {
    const src = readFileSync(join(process.cwd(), "src", "lib", "payments", "ach-mentor.ts"), "utf8");
    const imports = [...src.matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports) {
      expect(i.startsWith("node:"), i).toBe(false);
      expect(i.includes("ach-mentor-gates"), i).toBe(false);
    }
  });
});
