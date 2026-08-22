/**
 * tests/compliance/timesheet-mentor.test.ts   (books-32)
 *
 * Two jobs.
 *
 *  1. Prove the mentor COVERS the engine - every field, every refusal code,
 *     every exported function, every citation.
 *
 *  2. Prove the coverage GATES THEMSELVES WORK. Standing rule 16: a gate that
 *     cannot fail is decoration with a green check on it. So each gate is also
 *     run against a deliberately broken input written to a temp file, and is
 *     required to throw. That is the half people skip.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findGuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import { TIMESHEET_AUTHORITIES } from "@/lib/payroll/timesheet-authorities";
import {
  TIMESHEET_FIELD_LESSONS,
  TIMESHEET_SCREEN_LESSONS,
  TIMESHEET_REFUSAL_LESSONS,
  TIMESHEET_SETUP_STEPS,
  CORE_FUNCTION_COVERAGE,
  assertEveryFieldIsTaught,
  assertNoLessonForUnknownField,
  assertEveryCitedAuthorityExists,
  assertEveryRefusalCodeIsTaught,
  assertEveryExportedFunctionIsTaught,
  assertSetupStepsAreWellFormed,
  engineRefusalCodes,
  exportedCoreFunctionNames,
  migrationFieldNames,
  unusedAuthorityIds,
  evaluateTimesheetSetup,
  describeWorkweek,
  taughtFieldNames,
  type TimesheetSetupFacts,
} from "@/lib/payroll/timesheet-mentor";

// A temp file whose contents we control, for proving a gate can fail.
function tempSource(contents: string, name = "probe.ts"): string {
  const dir = mkdtempSync(join(tmpdir(), "mentor-gate-"));
  const p = join(dir, name);
  writeFileSync(p, contents, "utf8");
  return p;
}

// ===========================================================================
// 1) COVERAGE - the mentor explains everything the engine can do
// ===========================================================================

describe("the mentor covers the engine (standing rule 26)", () => {
  it("teaches every column migration 0197 adds", () => {
    expect(() => assertEveryFieldIsTaught()).not.toThrow();
  });

  it("teaches no column that does not exist", () => {
    expect(() => assertNoLessonForUnknownField()).not.toThrow();
  });

  it("explains every refusal code the engine can emit", () => {
    expect(() => assertEveryRefusalCodeIsTaught()).not.toThrow();
  });

  it("explains every exported function of the engine", () => {
    expect(() => assertEveryExportedFunctionIsTaught()).not.toThrow();
  });

  it("cites only authorities that exist", () => {
    expect(() => assertEveryCitedAuthorityExists()).not.toThrow();
  });

  it("has well-formed setup steps", () => {
    expect(() => assertSetupStepsAreWellFormed()).not.toThrow();
  });

  it("actually read something from disk - not a vacuous pass (rule 39)", () => {
    // If any of these came back empty the gates above would have approved
    // everything in silence, so the counts are asserted explicitly.
    expect(migrationFieldNames().length).toBeGreaterThanOrEqual(5);
    expect(engineRefusalCodes()).toHaveLength(10);
    expect(exportedCoreFunctionNames().length).toBeGreaterThanOrEqual(9);
    expect(TIMESHEET_FIELD_LESSONS.length).toBeGreaterThanOrEqual(9);
    expect(TIMESHEET_SCREEN_LESSONS.length).toBeGreaterThanOrEqual(7);
    expect(TIMESHEET_REFUSAL_LESSONS).toHaveLength(10);
  });

  it("reads the real column names out of the migration, not a hand list", () => {
    const names = migrationFieldNames();
    expect(names).toContain("company_profile.workweek_starts_on");
    expect(names).toContain("company_profile.workweek_starts_at_hour");
    expect(names).toContain("company_profile.workweek_effective_date");
    expect(names).toContain("employees.flsa_status");
    expect(names).toContain("employees.flsa_exempt_reason");
  });

  it("every authority in the timesheet registry is used by some lesson", () => {
    // Reported rather than assumed: if this ever grows, the research was done
    // and then not connected to anything Michael reads.
    expect(unusedAuthorityIds()).toEqual([]);
  });

  it("every cited authority resolves in the MERGED registry, not just the leaf module", () => {
    // Rule 56: an export with no caller. The screen renders from the merged
    // registry, so resolving here is what proves the citation is reachable.
    const ids = new Set<string>();
    for (const l of TIMESHEET_FIELD_LESSONS) for (const i of l.authorityIds) ids.add(i);
    for (const l of TIMESHEET_SCREEN_LESSONS) for (const i of l.authorityIds) ids.add(i);
    for (const s of TIMESHEET_SETUP_STEPS) for (const i of s.authorityIds) ids.add(i);
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) {
      const found = findGuidanceAuthority(id);
      expect(found, `authority ${id} did not resolve in the merged registry`).toBeTruthy();
      expect(found?.quote.length ?? 0).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// 2) THE GATES CAN FAIL - proving they are wired (standing rule 16)
// ===========================================================================

describe("the coverage gates are real gates, not decoration", () => {
  it("the refusal gate FAILS when the engine gains an unexplained code", () => {
    const p = tempSource(
      `export type TimesheetRefusalCode =\n  | "NO_WORKWEEK_ANCHOR"\n  | "BRAND_NEW_CODE";\n`,
    );
    expect(() => assertEveryRefusalCodeIsTaught(p)).toThrow(
      /REFUSAL CODES WITH NO EXPLANATION[\s\S]*BRAND_NEW_CODE/,
    );
  });

  it("the refusal gate FAILS when it can parse nothing (rule 39)", () => {
    const p = tempSource(`export const nothing = 1;\n`);
    expect(() => assertEveryRefusalCodeIsTaught(p)).toThrow(/GATE BROKEN/);
  });

  it("the refusal gate FAILS on a stale lesson for a removed code", () => {
    // Only one of the ten codes still exists; the other nine lessons are stale.
    const p = tempSource(`export type TimesheetRefusalCode =\n  | "OPEN_PUNCH";\n`);
    expect(() => assertEveryRefusalCodeIsTaught(p)).toThrow(
      /REFUSAL CODES THAT NO LONGER EXIST/,
    );
  });

  it("the function gate FAILS when the engine gains an untaught function", () => {
    const p = tempSource(
      `export function weekdayOfDayKey() {}\nexport function brandNewThing() {}\n`,
    );
    expect(() => assertEveryExportedFunctionIsTaught(p)).toThrow(
      /MENTOR COVERAGE GAP[\s\S]*brandNewThing/,
    );
  });

  it("the function gate FAILS when it reads an empty file (rule 39)", () => {
    const p = tempSource(`// no exports here\n`);
    expect(() => assertEveryExportedFunctionIsTaught(p)).toThrow(/GATE BROKEN/);
  });

  it("the function gate FAILS on a coverage entry for a deleted function", () => {
    const p = tempSource(`export function weekdayOfDayKey() {}\n`);
    expect(() => assertEveryExportedFunctionIsTaught(p)).toThrow(
      /FUNCTIONS THAT NO LONGER EXIST/,
    );
  });

  it("the field gate FAILS when the migration gains an untaught column", () => {
    const p = tempSource(
      [
        "alter table public.company_profile",
        "  add column if not exists workweek_starts_on smallint;",
        "alter table public.employees",
        "  add column if not exists something_new text;",
      ].join("\n"),
      "m.sql",
    );
    expect(() => assertEveryFieldIsTaught(p)).toThrow(
      /MENTOR COVERAGE GAP[\s\S]*employees\.something_new/,
    );
  });

  it("the field gate FAILS when the migration parses to nothing (rule 39)", () => {
    const p = tempSource("-- a migration that adds no columns\n", "m.sql");
    expect(() => assertEveryFieldIsTaught(p)).toThrow(/GATE BROKEN/);
  });

  it("the stray-lesson gate FAILS when a taught column disappears", () => {
    const p = tempSource(
      [
        "alter table public.company_profile",
        "  add column if not exists workweek_starts_on smallint;",
      ].join("\n"),
      "m.sql",
    );
    expect(() => assertNoLessonForUnknownField(p)).toThrow(
      /TEACHES FIELDS THAT DO NOT EXIST/,
    );
  });
});

// ===========================================================================
// 3) LESSON QUALITY - Michael reads these, so they have to be worth reading
// ===========================================================================

describe("the lessons are written for a human", () => {
  it("every field lesson answers all five questions with real prose", () => {
    for (const l of TIMESHEET_FIELD_LESSONS) {
      expect(l.field, "field name").toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(l.whatItIs.length, `${l.field}.whatItIs`).toBeGreaterThan(40);
      expect(l.whereItIsUsed.length, `${l.field}.whereItIsUsed`).toBeGreaterThan(40);
      expect(l.whyItMatters.length, `${l.field}.whyItMatters`).toBeGreaterThan(40);
      expect(l.theTrap.length, `${l.field}.theTrap`).toBeGreaterThan(40);
      expect(l.howToBeSure.length, `${l.field}.howToBeSure`).toBeGreaterThan(40);
      expect(l.authorityIds.length, `${l.field} cites nothing`).toBeGreaterThan(0);
    }
  });

  it("every screen lesson has a topic, plain English and a consequence", () => {
    for (const l of TIMESHEET_SCREEN_LESSONS) {
      expect(l.topic.length).toBeGreaterThan(10);
      expect(l.plainEnglish.length).toBeGreaterThan(80);
      expect(l.whyItMatters.length).toBeGreaterThan(80);
      expect(l.authorityIds.length).toBeGreaterThan(0);
    }
  });

  it("every refusal lesson says what to DO, never just what went wrong", () => {
    for (const l of TIMESHEET_REFUSAL_LESSONS) {
      expect(l.headline.length, `${l.code} headline`).toBeGreaterThan(20);
      expect(l.whyWeStop.length, `${l.code} whyWeStop`).toBeGreaterThan(60);
      expect(l.whatToDo.length, `${l.code} whatToDo`).toBeGreaterThan(40);
      expect(l.whatToDo, `${l.code} says contact support`).not.toMatch(/contact support/i);
    }
  });

  it("no field lesson is duplicated", () => {
    const names = taughtFieldNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it("the 778.104 averaging rule is taught explicitly - it is the point of the slice", () => {
    const all = TIMESHEET_SCREEN_LESSONS.map((l) => `${l.plainEnglish} ${l.whyItMatters}`).join(" ");
    expect(all).toMatch(/each workweek stands alone/i);
    expect(all).toMatch(/30 hours/);
    expect(all).toMatch(/50/);
    // And it names the trap in the arithmetic, not just the principle.
    expect(all).toMatch(/80/);
  });

  it("the mentor covers exactly the engine's function list", () => {
    expect(Object.keys(CORE_FUNCTION_COVERAGE).sort()).toEqual(
      [...exportedCoreFunctionNames()].sort(),
    );
  });
});

// ===========================================================================
// 4) PROGRESS - "what's done and what's left"
// ===========================================================================

const NOTHING_DONE: TimesheetSetupFacts = {
  workweekStartsOn: null,
  activeEmployeeCount: 0,
  unclassifiedEmployeeCount: 0,
  exemptWithoutReasonCount: 0,
  payPeriodCount: 0,
  expectedPayPeriodCount: 26,
  selectedPeriodApproved: null,
  punchProblemCount: null,
};

const ALL_DONE: TimesheetSetupFacts = {
  workweekStartsOn: 0,
  activeEmployeeCount: 12,
  unclassifiedEmployeeCount: 0,
  exemptWithoutReasonCount: 0,
  payPeriodCount: 26,
  expectedPayPeriodCount: 26,
  selectedPeriodApproved: true,
  punchProblemCount: 0,
};

describe("the progress panel knows what is done and what is left", () => {
  it("a brand new install reports nothing done and refuses to compute", () => {
    const p = evaluateTimesheetSetup(NOTHING_DONE);
    expect(p.completeCount).toBe(0);
    expect(p.totalCount).toBe(5);
    expect(p.canCompute).toBe(false);
    expect(p.nextAction).toMatch(/workweek start day/i);
    expect(p.summary).toMatch(/0 of 5/);
  });

  it("a fully configured install reports everything done and permits computing", () => {
    const p = evaluateTimesheetSetup(ALL_DONE);
    expect(p.completeCount).toBe(5);
    expect(p.canCompute).toBe(true);
    expect(p.nextAction).toBeNull();
    expect(p.summary).toMatch(/Everything on this screen is set up/);
    for (const s of p.steps) {
      expect(s.outstanding, `${s.key} still lists work`).toEqual([]);
      expect(s.nextAction).toBeNull();
    }
  });

  it("CONTROL: the panel is not simply always-done or always-empty (rule 60)", () => {
    // The same function must produce genuinely different shapes, otherwise a
    // hardcoded return would satisfy both tests above.
    const a = evaluateTimesheetSetup(NOTHING_DONE);
    const b = evaluateTimesheetSetup(ALL_DONE);
    expect(a.completeCount).not.toBe(b.completeCount);
    expect(a.canCompute).not.toBe(b.canCompute);
    expect(a.summary).not.toBe(b.summary);
  });

  it("a step whose prerequisite is missing is BLOCKED, not merely incomplete", () => {
    const p = evaluateTimesheetSetup({ ...ALL_DONE, workweekStartsOn: null });
    const cal = p.steps.find((s) => s.key === "pay_calendar");
    expect(cal?.blockedByPrerequisite).toBe(true);
    expect(cal?.complete).toBe(false);
    expect(cal?.nextAction).toMatch(/Finish "Choose the day your workweek starts" first/);
  });

  it("UNKNOWN is not the same as CLEAN (standing rule 62d)", () => {
    const unchecked = evaluateTimesheetSetup({ ...ALL_DONE, punchProblemCount: null });
    const clean = evaluateTimesheetSetup({ ...ALL_DONE, punchProblemCount: 0 });
    const uStep = unchecked.steps.find((s) => s.key === "punches_clean");
    const cStep = clean.steps.find((s) => s.key === "punches_clean");
    expect(uStep?.complete).toBe(false);
    expect(cStep?.complete).toBe(true);
    expect(uStep?.outstanding[0]).toMatch(/not been checked yet/);
  });

  it("counts the specific problems rather than saying 'something is wrong'", () => {
    const p = evaluateTimesheetSetup({
      ...ALL_DONE,
      unclassifiedEmployeeCount: 3,
      exemptWithoutReasonCount: 2,
      punchProblemCount: 7,
    });
    const cls = p.steps.find((s) => s.key === "employee_classification");
    expect(cls?.outstanding.join(" ")).toMatch(/3 active employee/);
    expect(cls?.outstanding.join(" ")).toMatch(/2 employee\(s\) are marked exempt/);
    const punch = p.steps.find((s) => s.key === "punches_clean");
    expect(punch?.outstanding.join(" ")).toMatch(/7 punch problem/);
  });

  it("notices a pay calendar with the wrong number of periods", () => {
    const short = evaluateTimesheetSetup({ ...ALL_DONE, payPeriodCount: 25 });
    const cal = short.steps.find((s) => s.key === "pay_calendar");
    expect(cal?.complete).toBe(false);
    expect(cal?.outstanding[0]).toMatch(/25 period\(s\) but this cadence needs 26/);
  });

  it("an unapproved period does not block computing, but is still reported", () => {
    // Deliberate: the compute is a PROPOSAL. Approval gates the payment, and
    // the distinction is the whole of standing rule 63c.
    const p = evaluateTimesheetSetup({ ...ALL_DONE, selectedPeriodApproved: false });
    expect(p.canCompute).toBe(true);
    expect(p.completeCount).toBe(4);
    const step = p.steps.find((s) => s.key === "period_approved");
    expect(step?.complete).toBe(false);
    expect(step?.outstanding[0]).toMatch(/has not been approved/);
  });

  it("no active employees is itself an outstanding item, not a silent pass", () => {
    const p = evaluateTimesheetSetup({ ...ALL_DONE, activeEmployeeCount: 0 });
    const cls = p.steps.find((s) => s.key === "employee_classification");
    expect(cls?.complete).toBe(false);
    expect(cls?.outstanding[0]).toMatch(/no active employees/i);
  });
});

// ===========================================================================
// 5) THE WORKWEEK SENTENCE
// ===========================================================================

describe("describeWorkweek speaks English, not database", () => {
  it("names the day and the hour", () => {
    expect(describeWorkweek(0, 0)).toMatch(/Sunday at midnight/);
    expect(describeWorkweek(1, 0)).toMatch(/Monday at midnight/);
    expect(describeWorkweek(6, 0)).toMatch(/Saturday at midnight/);
    expect(describeWorkweek(3, 6)).toMatch(/Wednesday at 6:00 in the morning/);
    expect(describeWorkweek(3, 12)).toMatch(/Wednesday at noon/);
    expect(describeWorkweek(3, 18)).toMatch(/Wednesday at 6:00 in the evening/);
  });

  it("states the 168-hour period and the 40-hour threshold", () => {
    const s = describeWorkweek(0, 0);
    expect(s).toMatch(/168 hours/);
    expect(s).toMatch(/40\.00 hours/);
    expect(s).toMatch(/never on the pay period total/);
  });

  it("says plainly that nothing is assumed when no anchor is set", () => {
    const s = describeWorkweek(null);
    expect(s).toMatch(/No workweek has been chosen/);
    expect(s).toMatch(/refuse rather than assume Sunday/);
  });

  it("CONTROL: different anchors produce different sentences", () => {
    expect(describeWorkweek(0)).not.toBe(describeWorkweek(1));
    expect(describeWorkweek(null)).not.toBe(describeWorkweek(0));
  });
});

// ===========================================================================
// 6) THE AUTHORITIES THEMSELVES
// ===========================================================================

describe("the authorities behind the lessons", () => {
  it("there are seven, and every one has a quote and a so-what", () => {
    expect(TIMESHEET_AUTHORITIES).toHaveLength(7);
    for (const a of TIMESHEET_AUTHORITIES) {
      expect(a.quote.length, `${a.id} quote`).toBeGreaterThan(30);
      expect(a.soWhat.length, `${a.id} soWhat`).toBeGreaterThan(30);
      expect(a.cite.length).toBeGreaterThan(5);
      expect(["regulation", "state_law"]).toContain(a.kind);
    }
  });

  it("the RCW authorities are state_law so the badge reads 'Washington rule'", () => {
    // A real defect caught in this slice: they were written as "statute",
    // which renders a different badge from every other RCW in the system.
    for (const a of TIMESHEET_AUTHORITIES.filter((x) => x.cite.startsWith("RCW"))) {
      expect(a.kind, `${a.id} should be state_law`).toBe("state_law");
    }
  });
});
