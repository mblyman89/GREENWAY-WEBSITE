/**
 * tests/compliance/sick-leave-mentor.test.ts   (books-35)
 *
 * STANDING RULE 26 FOR THE SICK LEAVE ENGINE.
 *
 * books-33 shipped the engine with no mentor at all. These tests are what stop
 * that happening again: every column, every refusal code and every exported
 * function is read FROM DISK and required to have an explanation.
 *
 * Standing rule 16 says it is not enough for a gate to exist — it must be
 * proven WIRED. So nearly every gate below is exercised twice: once against
 * the real repo, and once against a deliberately broken temporary file that it
 * must refuse. A gate that never fails is indistinguishable from one that is
 * not called at all (standing rule 50), and a gate that fails on everything is
 * no better (standing rule 55), which is why the accept controls are here too.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SICK_LEAVE_AUTHORITIES } from "@/lib/payroll/sick-leave-authorities";
import {
  SICK_LEAVE_FIELD_LESSONS,
  SICK_LEAVE_REFUSAL_LESSONS,
  SICK_LEAVE_REVIEW_CHECKS,
  SICK_LEAVE_SCREEN_LESSONS,
  taughtSickLeaveFieldNames,
} from "@/lib/payroll/sick-leave-mentor";
import {
  SICK_CORE_FUNCTION_COVERAGE,
  SICK_STRUCTURAL_COLUMNS,
  SICK_STRUCTURAL_TYPES,
  assertEveryCitedSickAuthorityExists,
  assertEverySickFieldIsTaught,
  assertEverySickFunctionIsTaught,
  assertEverySickRefusalCodeIsTaught,
  assertNoDuplicateSickFieldLessons,
  assertNoSickLessonForUnknownField,
  assertSickReviewChecksAreWellFormed,
  assertSickStructuralExemptionsAreJustified,
  sickEngineRefusalCodes,
  sickExportedFunctionNames,
  sickMigrationColumnNames,
  sickMigrationColumnTypes,
  unusedSickAuthorityIds,
} from "@/lib/payroll/sick-leave-mentor-gates";

function tempSource(name: string, body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sickmentor-"));
  const p = join(dir, name);
  writeFileSync(p, body, "utf8");
  return p;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * READING THE MIGRATION
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the sick leave schema is read from disk, not remembered", () => {
  it("finds all three sick leave tables", () => {
    const cols = sickMigrationColumnNames();
    for (const t of ["sick_leave_policy", "sick_leave_requests", "sick_leave_ledger"]) {
      expect(
        cols.filter((c) => c.startsWith(`${t}.`)).length,
        `no columns found for ${t}`,
      ).toBeGreaterThan(4);
    }
  });

  it("does not pick up the garnishment table, which has its own mentor", () => {
    expect(sickMigrationColumnNames().filter((c) => c.startsWith("wage_orders."))).toHaveLength(0);
  });

  it("reads the smallint policy columns the books-34 parser used to drop", () => {
    // These three drive three separate refusal codes. Under the old parser
    // they were invisible to every coverage gate, so the mentor could have
    // shipped without explaining any of them and the suite would have agreed.
    const types = sickMigrationColumnTypes();
    expect(types["sick_leave_policy.usable_after_days"]).toBe("smallint");
    expect(types["sick_leave_policy.usage_increment_minutes"]).toBe("smallint");
    expect(types["sick_leave_policy.verification_after_days"]).toBe("smallint");
  });

  it("PROOF THE PARSER CAN BE WRONG: a migration with no sick tables yields nothing", () => {
    const p = tempSource("empty.sql", "-- nothing here\nselect 1;\n");
    expect(sickMigrationColumnNames(p)).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * STRUCTURAL EXEMPTIONS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("only genuinely structural columns may skip a lesson", () => {
  it("passes against the real migration", () => {
    expect(() => assertSickStructuralExemptionsAreJustified()).not.toThrow();
  });

  it("every exempted column really is a uuid key or an audit timestamp", () => {
    const types = sickMigrationColumnTypes();
    for (const col of SICK_STRUCTURAL_COLUMNS) {
      const t = types[col];
      expect(t, `${col} is exempted but does not exist in the migration`).toBeDefined();
      expect(SICK_STRUCTURAL_TYPES, `${col} is exempted but is a ${t}`).toContain(t);
    }
  });

  it("sick_leave_policy.id is NOT exempt, because a smallint is not a structural type", () => {
    // The interesting consequence of the type rule. This column is obviously a
    // surrogate key by name, and under a name-based exemption it would have
    // been waved through. Its type says otherwise, and it is right to: the
    // check constraint pinning it to 1 is the only thing making the policy a
    // singleton, which is worth understanding.
    expect(sickMigrationColumnTypes()["sick_leave_policy.id"]).toBe("smallint");
    expect(SICK_STRUCTURAL_COLUMNS).not.toContain("sick_leave_policy.id");
    expect(taughtSickLeaveFieldNames()).toContain("sick_leave_policy.id");
  });

  it("GATE IS WIRED: a vacuous read makes the exemption gate report itself broken", () => {
    const p = tempSource("nothing.sql", "-- nothing\n");
    expect(() => assertSickStructuralExemptionsAreJustified(p)).toThrow(/GATE BROKEN/);
  });

  it("GATE IS WIRED: an exemption for a column that no longer exists throws", () => {
    const p = tempSource(
      "renamed.sql",
      "create table if not exists public.sick_leave_ledger (\n  minutes integer not null\n);\n",
    );
    expect(() => assertSickStructuralExemptionsAreJustified(p)).toThrow(
      /EXEMPTIONS FOR COLUMNS THAT DO NOT EXIST/,
    );
  });

  it("a quantity column can never qualify as structural, whatever anyone lists", () => {
    const types = sickMigrationColumnTypes();
    for (const c of [
      "sick_leave_ledger.minutes",
      "sick_leave_ledger.paid_amount_cents",
      "sick_leave_policy.accrual_hundredth_minutes_per_hour",
    ]) {
      expect(SICK_STRUCTURAL_TYPES, `${c} must not be exemptible`).not.toContain(types[c]);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * FIELD COVERAGE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("every stored sick leave figure is taught", () => {
  it("passes against the real migration", () => {
    expect(() => assertEverySickFieldIsTaught()).not.toThrow();
  });

  it("GATE IS WIRED: a new untaught column fails the gate", () => {
    const p = tempSource(
      "newcol.sql",
      "create table if not exists public.sick_leave_ledger (\n" +
        "  id uuid primary key,\n" +
        "  employee_id uuid not null,\n" +
        "  forfeited_minutes integer not null,\n" +
        "  created_at timestamptz not null default now(),\n" +
        "  updated_at timestamptz not null default now()\n" +
        ");\n",
    );
    expect(() => assertEverySickFieldIsTaught(p)).toThrow(/COVERAGE GAP/);
    expect(() => assertEverySickFieldIsTaught(p)).toThrow(/forfeited_minutes/);
  });

  it("ACCEPT CONTROL: the same fragment with the column taught does NOT throw", () => {
    // Standing rule 55 - refusal must discriminate. Without this, the test
    // above would pass against a gate that rejected every fragment.
    const p = tempSource(
      "known.sql",
      "create table if not exists public.sick_leave_ledger (\n" +
        "  id uuid primary key,\n" +
        "  employee_id uuid not null,\n" +
        "  minutes integer not null,\n" +
        "  created_at timestamptz not null default now(),\n" +
        "  updated_at timestamptz not null default now()\n" +
        ");\n",
    );
    expect(() => assertEverySickFieldIsTaught(p)).not.toThrow();
  });

  it("GATE IS WIRED: a vacuous read reports itself broken rather than passing", () => {
    const p = tempSource("blank.sql", "-- nothing at all\n");
    expect(() => assertEverySickFieldIsTaught(p)).toThrow(/GATE BROKEN/);
  });

  it("GATE IS WIRED: exempting everything reports itself broken", () => {
    // If the structural list ever swallowed the schema, coverage would be
    // trivially complete. The gate refuses that outcome by name.
    const p = tempSource(
      "allstructural.sql",
      "create table if not exists public.sick_leave_requests (\n" +
        "  id uuid primary key,\n" +
        "  employee_id uuid not null,\n" +
        "  created_at timestamptz not null default now(),\n" +
        "  updated_at timestamptz not null default now()\n" +
        ");\n",
    );
    expect(() => assertEverySickFieldIsTaught(p)).toThrow(/GATE BROKEN/);
  });

  it("no lesson teaches a column that does not exist", () => {
    expect(() => assertNoSickLessonForUnknownField()).not.toThrow();
  });

  it("GATE IS WIRED: a renamed column leaves its lesson stranded and is caught", () => {
    const p = tempSource(
      "rename.sql",
      "create table if not exists public.sick_leave_policy (\n  id smallint primary key\n);\n",
    );
    expect(() => assertNoSickLessonForUnknownField(p)).toThrow(/COLUMNS THAT DO NOT EXIST/);
  });

  it("no column has two lessons", () => {
    expect(() => assertNoDuplicateSickFieldLessons()).not.toThrow();
  });

  it("every field lesson answers all five questions with real content", () => {
    expect(SICK_LEAVE_FIELD_LESSONS.length).toBeGreaterThan(25);
    for (const l of SICK_LEAVE_FIELD_LESSONS) {
      for (const [k, v] of Object.entries({
        whatItIs: l.whatItIs,
        whereItIsUsed: l.whereItIsUsed,
        whyItMatters: l.whyItMatters,
        theTrap: l.theTrap,
        howToBeSure: l.howToBeSure,
      })) {
        expect(v.length, `${l.field}.${k} is too thin to be a lesson`).toBeGreaterThan(40);
      }
    }
  });

  it("the unit columns say what their unit is, because that is where the money hides", () => {
    // Three columns in this schema use units nobody would guess. If the lesson
    // does not name the unit, the lesson has not done its job.
    const byField = new Map(SICK_LEAVE_FIELD_LESSONS.map((l) => [l.field, l]));
    expect(byField.get("sick_leave_policy.accrual_hundredth_minutes_per_hour")?.whatItIs).toMatch(
      /HUNDREDTHS OF A MINUTE/,
    );
    expect(byField.get("sick_leave_ledger.paid_rate_milli_cents_per_hour")?.whatItIs).toMatch(
      /THOUSANDTHS OF A CENT/,
    );
    expect(byField.get("sick_leave_requests.minutes_requested")?.whatItIs).toMatch(/minutes/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * AUTHORITIES
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("every citation points at a real authority", () => {
  it("passes against the real registry", () => {
    expect(() => assertEveryCitedSickAuthorityExists()).not.toThrow();
  });

  it("GATE IS WIRED: an invented authority id would be caught", () => {
    // Proven by construction rather than by mutating the module: the gate
    // compares against the registry's ids, so an id absent from the registry
    // is by definition dangling. This pins the set it checks against.
    const known = new Set(SICK_LEAVE_AUTHORITIES.map((a) => a.id));
    expect(known.has("wac-296-128-670-rate")).toBe(true);
    expect(known.has("wac-296-128-999-invented")).toBe(false);
  });

  it("every authority is cited by at least one lesson", () => {
    // Reported rather than merely tolerated: an uncited mirrored authority is
    // usually a lesson somebody meant to write.
    expect(unusedSickAuthorityIds()).toEqual([]);
  });

  it("the rate rule is cited where it actually bites", () => {
    const rate = SICK_LEAVE_FIELD_LESSONS.find(
      (l) => l.field === "sick_leave_ledger.paid_rate_milli_cents_per_hour",
    );
    expect(rate?.authorityIds).toContain("wac-296-128-670-rate");
    expect(rate?.theTrap).toMatch(/GREATER of/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * REFUSAL CODES
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("every refusal the engine can emit is explained", () => {
  it("reads the codes from the engine's own union type on disk", () => {
    const codes = sickEngineRefusalCodes();
    expect(codes.length).toBe(18);
    expect(codes).toContain("NOT_YET_USABLE");
    expect(codes).toContain("VERIFICATION_THRESHOLD_UNLAWFUL");
  });

  it("passes against the real engine", () => {
    expect(() => assertEverySickRefusalCodeIsTaught()).not.toThrow();
  });

  it("GATE IS WIRED: a new untaught refusal code fails the gate", () => {
    const p = tempSource(
      "newcode.ts",
      'export type SickLeaveRefusalCode =\n  | "NOT_YET_USABLE"\n  | "SOMETHING_BRAND_NEW";\n',
    );
    expect(() => assertEverySickRefusalCodeIsTaught(p)).toThrow(/NO EXPLANATION/);
    expect(() => assertEverySickRefusalCodeIsTaught(p)).toThrow(/SOMETHING_BRAND_NEW/);
  });

  it("GATE IS WIRED: a lesson outliving its code fails the gate", () => {
    // The more dangerous direction: the count still looks right.
    const p = tempSource(
      "shrunk.ts",
      'export type SickLeaveRefusalCode =\n  | "NOT_YET_USABLE";\n',
    );
    expect(() => assertEverySickRefusalCodeIsTaught(p)).toThrow(/NO LONGER EXIST/);
  });

  it("GATE IS WIRED: an engine with no union type at all reports itself broken", () => {
    const p = tempSource("nocodes.ts", "export const nothing = 1;\n");
    expect(() => assertEverySickRefusalCodeIsTaught(p)).toThrow(/GATE BROKEN/);
  });

  it("every refusal lesson says why we stop AND what to do about it", () => {
    for (const l of SICK_LEAVE_REFUSAL_LESSONS) {
      expect(l.headline.length, `${l.code} headline`).toBeGreaterThan(20);
      expect(l.whyWeStop.length, `${l.code} whyWeStop`).toBeGreaterThan(60);
      expect(l.whatToDo.length, `${l.code} whatToDo`).toBeGreaterThan(40);
    }
  });

  it("the off-by-one refusal explains the off-by-one", () => {
    // VERIFICATION_THRESHOLD_UNLAWFUL exists because "exceeding three days"
    // reads as "three or more" to almost everybody. A lesson that did not say
    // so would leave the reader thinking the software was being fussy.
    const l = SICK_LEAVE_REFUSAL_LESSONS.find(
      (x) => x.code === "VERIFICATION_THRESHOLD_UNLAWFUL",
    );
    expect(l?.whyWeStop).toMatch(/exceeding three days/i);
    expect(l?.whatToDo).toMatch(/4 days/);
  });

  it("NOT_YET_USABLE does not tell the employee they earned nothing", () => {
    const l = SICK_LEAVE_REFUSAL_LESSONS.find((x) => x.code === "NOT_YET_USABLE");
    expect(l?.headline).toMatch(/earned/);
    expect(l?.whyWeStop).toMatch(/banked/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * FUNCTION COVERAGE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("every exported engine function is explained somewhere", () => {
  it("reads the exports from disk", () => {
    const fns = sickExportedFunctionNames();
    expect(fns.length).toBe(13);
    expect(fns).toContain("reviewRequest");
    expect(fns).toContain("splitWeekWithSickLeave");
  });

  it("passes against the real engine", () => {
    expect(() => assertEverySickFunctionIsTaught()).not.toThrow();
  });

  it("GATE IS WIRED: a new untaught export fails the gate", () => {
    const p = tempSource(
      "newfn.ts",
      "export function reviewRequest() {}\nexport function forecastLiability() {}\n",
    );
    expect(() => assertEverySickFunctionIsTaught(p)).toThrow(/COVERAGE GAP/);
    expect(() => assertEverySickFunctionIsTaught(p)).toThrow(/forecastLiability/);
  });

  it("GATE IS WIRED: an explanation outliving its function fails the gate", () => {
    const p = tempSource("shrunk.ts", "export function reviewRequest() {}\n");
    expect(() => assertEverySickFunctionIsTaught(p)).toThrow(/NO LONGER EXIST/);
  });

  it("GATE IS WIRED: a file with no exports reports itself broken", () => {
    const p = tempSource("nofns.ts", "const x = 1;\n");
    expect(() => assertEverySickFunctionIsTaught(p)).toThrow(/GATE BROKEN/);
  });

  it("each explanation names where the teaching actually lives", () => {
    // An explanation that just restates the function name is not coverage.
    for (const [fn, why] of Object.entries(SICK_CORE_FUNCTION_COVERAGE)) {
      expect(why.length, `${fn} explanation is too thin`).toBeGreaterThan(80);
      expect(why, `${fn} explanation does not point at a lesson`).toMatch(/lesson/i);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * SCREEN LESSONS AND THE REVIEW CHECKLIST
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the screen lessons teach the ideas, not the fields", () => {
  it("there are enough of them to be worth reading", () => {
    expect(SICK_LEAVE_SCREEN_LESSONS.length).toBeGreaterThanOrEqual(10);
    for (const l of SICK_LEAVE_SCREEN_LESSONS) {
      expect(l.plainEnglish.length, `${l.topic} plainEnglish`).toBeGreaterThan(120);
      expect(l.whyItMatters.length, `${l.topic} whyItMatters`).toBeGreaterThan(120);
      expect(l.authorityIds.length, `${l.topic} cites nothing`).toBeGreaterThan(0);
    }
  });

  it("Michael's own overtime question is answered by name", () => {
    // He worked this out himself and asked for it to be confirmed. The lesson
    // that answers it must actually contain the answer.
    const l = SICK_LEAVE_SCREEN_LESSONS.find((x) => /overtime/i.test(x.topic));
    expect(l, "no screen lesson answers the overtime question").toBeDefined();
    expect(l?.plainEnglish).toMatch(/forty-four/i);
    expect(l?.plainEnglish).toMatch(/ZERO overtime/);
    expect(l?.authorityIds).toContain("cfr-778-218-idle-hours");
  });

  it("the approval-first decision is written down as Michael's decision", () => {
    const l = SICK_LEAVE_SCREEN_LESSONS.find((x) => /approval comes first/i.test(x.topic));
    expect(l, "the option-1 decision is not explained anywhere").toBeDefined();
    expect(l?.plainEnglish).toMatch(/before it reaches the timesheet/i);
  });
});

describe("the approval checklist is a usable order", () => {
  it("passes against the real checklist", () => {
    expect(() => assertSickReviewChecksAreWellFormed()).not.toThrow();
  });

  it("eligibility is asked before pricing", () => {
    const order = new Map(SICK_LEAVE_REVIEW_CHECKS.map((c) => [c.key, c.order]));
    expect(order.get("usable-yet")!).toBeLessThan(order.get("rate-is-the-greater-of")!);
    expect(order.get("balance-covers-it")!).toBeLessThan(order.get("rate-is-the-greater-of")!);
  });

  it("the notice step explicitly refuses to deny", () => {
    // The single most valuable sentence in the checklist: late notice is not
    // forfeiture, and writing it down as a denial reason documents an
    // unlawful denial in Greenway's own records.
    const notice = SICK_LEAVE_REVIEW_CHECKS.find((c) => c.key === "notice-is-a-conversation");
    expect(notice?.ifItFails).toMatch(/do NOT deny/i);
  });

  it("every check explains why it sits where it does", () => {
    for (const c of SICK_LEAVE_REVIEW_CHECKS) {
      expect(c.question.length, `${c.key} question`).toBeGreaterThan(20);
      expect(c.whyThisOrder.length, `${c.key} whyThisOrder`).toBeGreaterThan(60);
      expect(c.howToCheck.length, `${c.key} howToCheck`).toBeGreaterThan(40);
      expect(c.ifItFails.length, `${c.key} ifItFails`).toBeGreaterThan(40);
    }
  });
});
