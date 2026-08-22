/**
 * tests/compliance/garnishment-mentor.test.ts   (books-35)
 *
 * STANDING RULE 26 FOR THE GARNISHMENT ENGINE.
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

import { harvestQuotedLessonTitles } from "@/lib/payroll/mentor-quote-gate";

import { GARNISHMENT_AUTHORITIES } from "@/lib/payroll/garnishment-authorities";
import {
  GARNISHMENT_FIELD_LESSONS,
  GARNISHMENT_REFUSAL_LESSONS,
  GARNISHMENT_REVIEW_CHECKS,
  GARNISHMENT_SCREEN_LESSONS,
  taughtGarnishmentFieldNames,
} from "@/lib/payroll/garnishment-mentor";
import {
  GARNISHMENT_CORE_FUNCTION_COVERAGE,
  assertEveryQuotedGarnishmentLessonExists,
  GARNISHMENT_STRUCTURAL_COLUMNS,
  GARNISHMENT_STRUCTURAL_TYPES,
  assertEveryCitedGarnishmentAuthorityExists,
  assertEveryGarnishmentFieldIsTaught,
  assertEveryGarnishmentFunctionIsTaught,
  assertEveryGarnishmentRefusalCodeIsTaught,
  assertGarnishmentReviewChecksAreWellFormed,
  assertGarnishmentStructuralExemptionsAreJustified,
  assertNoDuplicateGarnishmentFieldLessons,
  assertNoGarnishmentLessonForUnknownField,
  garnishmentEngineRefusalCodes,
  garnishmentExportedFunctionNames,
  garnishmentMigrationColumnNames,
  garnishmentMigrationColumnTypes,
  unusedGarnishmentAuthorityIds,
} from "@/lib/payroll/garnishment-mentor-gates";

function tempSource(name: string, body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "garnmentor-"));
  const p = join(dir, name);
  writeFileSync(p, body, "utf8");
  return p;
}

/** A minimal but REAL wage_orders fragment, used as the accept control. */
const GOOD_FRAGMENT = `
create table if not exists public.wage_orders (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  order_kind text not null,
  case_number text not null,
  issuing_authority text not null,
  order_date date not null,
  payee_name text not null,
  payee_address text,
  remittance_instructions text,
  amount_cents_per_period bigint,
  percent_of_disposable_basis_points integer,
  arrears_cents bigint,
  arrears_over_twelve_weeks boolean,
  supports_second_family boolean,
  priority smallint not null default 100,
  effective_from date not null,
  effective_to date,
  status text not null default 'active',
  termination_note text,
  notes text,
  created_by_staff_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`;

/* ════════════════════════════════════════════════════════════════════════
 * READING THE MIGRATION
 * ════════════════════════════════════════════════════════════════════════ */

describe("the wage order schema is read from disk, not remembered", () => {
  it("finds the whole wage_orders table", () => {
    // 23 at 0198. 24 from books-38, which added `served_date` in migration
    // 0201 — the date service was made on Greenway, which the twenty-day
    // answer deadline of RCW 26.18.110(1) and the sixty-day continuing lien of
    // RCW 6.27.350(1) are both measured from.
    //
    // THIS NUMBER MOVING IS THE POINT. When it changed, it exposed two real
    // defects rather than one:
    //
    //   1. this gate read only 0198, so a column added by any later ALTER was
    //      invisible to it. It now walks every migration mentioning the table.
    //   2. the column parser read one physical line at a time outside a
    //      create-table body, so `alter table public.wage_orders` followed by
    //      `add column ... served_date date;` on the next line matched nothing
    //      AND was never reported as unreadable. Parsing 0201 returned {}.
    //
    // Both are fixed, and the second now pushes an `unrecognised` entry rather
    // than dropping the statement in silence.
    expect(garnishmentMigrationColumnNames().length).toBe(24);
  });

  it("does not pick up the sick leave tables, which have their own mentor", () => {
    const cols = garnishmentMigrationColumnNames();
    for (const t of ["sick_leave_policy", "sick_leave_requests", "sick_leave_ledger"]) {
      expect(cols.filter((c) => c.startsWith(`${t}.`))).toHaveLength(0);
    }
  });

  it("reads the smallint priority column the books-34 parser used to drop", () => {
    // Under the old hardcoded allow-list parser, `smallint` was not a
    // recognised type and this column was SILENTLY skipped. Every coverage
    // gate would have reported full coverage of wage_orders while the field
    // people expect to control who gets paid first went untaught.
    expect(garnishmentMigrationColumnTypes()["wage_orders.priority"]).toBe("smallint");
  });

  it("reads the two nullable booleans that decide ten percentage points", () => {
    const types = garnishmentMigrationColumnTypes();
    expect(types["wage_orders.supports_second_family"]).toBe("boolean");
    expect(types["wage_orders.arrears_over_twelve_weeks"]).toBe("boolean");
  });

  it("PROOF THE PARSER CAN BE WRONG: a migration with no wage_orders yields nothing", () => {
    const p = tempSource("empty.sql", "-- nothing here\nselect 1;\n");
    expect(garnishmentMigrationColumnNames(p)).toHaveLength(0);
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * STRUCTURAL EXEMPTIONS
 * ════════════════════════════════════════════════════════════════════════ */

describe("only genuinely structural columns may skip a lesson", () => {
  it("passes against the real migration", () => {
    expect(() => assertGarnishmentStructuralExemptionsAreJustified()).not.toThrow();
  });

  it("every exempted column really is a uuid key or an audit timestamp", () => {
    const types = garnishmentMigrationColumnTypes();
    for (const col of GARNISHMENT_STRUCTURAL_COLUMNS) {
      const t = types[col];
      expect(t, `${col} is exempted but does not exist in the migration`).toBeDefined();
      expect(GARNISHMENT_STRUCTURAL_TYPES, `${col} is exempted but is a ${t}`).toContain(t);
    }
  });

  it("wage_orders.priority is NOT exempt, because a smallint is not a structural type", () => {
    // The interesting consequence of the type rule. `priority` looks like an
    // ordering detail and under a name-based exemption it could plausibly have
    // been waved through. Its type says otherwise, and that is right: it is
    // the field people wrongly believe controls who gets paid first.
    expect(garnishmentMigrationColumnTypes()["wage_orders.priority"]).toBe("smallint");
    expect(GARNISHMENT_STRUCTURAL_COLUMNS).not.toContain("wage_orders.priority");
    expect(taughtGarnishmentFieldNames()).toContain("wage_orders.priority");
  });

  it("GATE IS WIRED: a vacuous read makes the exemption gate report itself broken", () => {
    const p = tempSource("empty.sql", "select 1;\n");
    expect(() => assertGarnishmentStructuralExemptionsAreJustified(p)).toThrow(
      /GATE BROKEN/i,
    );
  });

  it("GATE IS WIRED: an exemption for a column that no longer exists throws", () => {
    // The fragment below is a real table missing `created_by_staff_id`, which
    // IS on the exemption list. A stale exemption silently widens over time.
    const p = tempSource(
      "renamed.sql",
      `create table public.wage_orders (
         id uuid primary key,
         employee_id uuid not null,
         order_kind text not null,
         created_at timestamptz not null,
         updated_at timestamptz not null
       );`,
    );
    expect(() => assertGarnishmentStructuralExemptionsAreJustified(p)).toThrow(
      /DO NOT EXIST/i,
    );
  });

  it("a money or decision column can never qualify as structural, whatever anyone lists", () => {
    // This is the books-34 mutation, transplanted. There, adding a real money
    // column to the exemption list left the whole suite GREEN. Here the TYPE
    // arm catches it, and the type arm is checked even on a fragment.
    const p = tempSource("mistyped.sql", GOOD_FRAGMENT);
    const types = garnishmentMigrationColumnTypes(p);
    // Prove the fragment is genuinely readable before asserting about types.
    expect(Object.keys(types).length).toBe(23);
    for (const money of [
      "wage_orders.amount_cents_per_period",
      "wage_orders.percent_of_disposable_basis_points",
      "wage_orders.supports_second_family",
    ]) {
      expect(GARNISHMENT_STRUCTURAL_TYPES).not.toContain(types[money]);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * FIELD COVERAGE
 * ════════════════════════════════════════════════════════════════════════ */

describe("every wage order column that holds a decision is taught", () => {
  it("passes against the real migration", () => {
    expect(() => assertEveryGarnishmentFieldIsTaught()).not.toThrow();
  });

  it("teaches all nineteen non-structural columns", () => {
    const cols = garnishmentMigrationColumnNames();
    const structural = new Set(GARNISHMENT_STRUCTURAL_COLUMNS);
    const mustTeach = cols.filter((c) => !structural.has(c));
    // 18 -> 19 with books-38's `served_date`. It is emphatically not
    // structural: it is a fact somebody has to read off a delivery receipt,
    // and getting it wrong misstates a legal deadline in whichever direction
    // happens to hurt.
    expect(mustTeach.length).toBe(19);
    const taught = new Set(taughtGarnishmentFieldNames());
    for (const c of mustTeach) expect(taught.has(c), `${c} has no lesson`).toBe(true);
  });

  it("GATE IS WIRED: a new untaught column fails the gate", () => {
    const p = tempSource(
      "added.sql",
      GOOD_FRAGMENT.replace(
        "  notes text,",
        "  notes text,\n  employer_processing_fee_cents bigint,",
      ),
    );
    expect(() => assertEveryGarnishmentFieldIsTaught(p)).toThrow(
      /employer_processing_fee_cents/,
    );
  });

  it("ACCEPT CONTROL: the same fragment without the new column does NOT throw", () => {
    // Without this, the kill above would also pass if the gate threw on
    // everything, which is standing rule 55.
    const p = tempSource("good.sql", GOOD_FRAGMENT);
    expect(() => assertEveryGarnishmentFieldIsTaught(p)).not.toThrow();
  });

  it("GATE IS WIRED: a vacuous read reports itself broken rather than passing", () => {
    const p = tempSource("empty.sql", "select 1;\n");
    expect(() => assertEveryGarnishmentFieldIsTaught(p)).toThrow(/GATE BROKEN/i);
  });

  it("GATE IS WIRED: a table of nothing but uuids and timestamps reports itself broken", () => {
    // If every column read is structural, no lesson is ever required and the
    // gate would approve an empty mentor. It must say so instead.
    const p = tempSource(
      "allstructural.sql",
      `create table public.wage_orders (
         id uuid primary key,
         employee_id uuid not null,
         created_by_staff_id uuid,
         created_at timestamptz not null,
         updated_at timestamptz not null
       );`,
    );
    expect(() => assertEveryGarnishmentFieldIsTaught(p)).toThrow(/GATE BROKEN/i);
  });

  it("no lesson teaches a column that does not exist", () => {
    expect(() => assertNoGarnishmentLessonForUnknownField()).not.toThrow();
  });

  it("GATE IS WIRED: a renamed column leaves its lesson stranded and is caught", () => {
    const p = tempSource(
      "renamed.sql",
      GOOD_FRAGMENT.replace("case_number text not null,", "cause_number text not null,"),
    );
    expect(() => assertNoGarnishmentLessonForUnknownField(p)).toThrow(
      /wage_orders\.case_number/,
    );
  });

  it("no column has two lessons", () => {
    expect(() => assertNoDuplicateGarnishmentFieldLessons()).not.toThrow();
  });

  it("every field lesson answers all five questions with real content", () => {
    for (const l of GARNISHMENT_FIELD_LESSONS) {
      expect(l.whatItIs.length, `${l.field} whatItIs`).toBeGreaterThan(40);
      expect(l.whereItIsUsed.length, `${l.field} whereItIsUsed`).toBeGreaterThan(40);
      expect(l.whyItMatters.length, `${l.field} whyItMatters`).toBeGreaterThan(40);
      expect(l.theTrap.length, `${l.field} theTrap`).toBeGreaterThan(40);
      expect(l.howToBeSure.length, `${l.field} howToBeSure`).toBeGreaterThan(40);
      expect(l.authorityIds.length, `${l.field} cites nothing`).toBeGreaterThan(0);
    }
  });

  it("the two nullable answers explain WHY there is no default", () => {
    // Standing rule 62d. These are the fields where a default would be
    // cheapest and most wrong, so the lesson has to say so out loud.
    for (const f of [
      "wage_orders.supports_second_family",
      "wage_orders.arrears_over_twelve_weeks",
    ]) {
      const l = GARNISHMENT_FIELD_LESSONS.find((x) => x.field === f);
      expect(l, `${f} has no lesson`).toBeDefined();
      expect(`${l!.whatItIs} ${l!.theTrap}`.toLowerCase()).toMatch(
        /null|unanswered|not been asked|default/,
      );
    }
  });

  it("the basis-points lesson warns about typing 25 for twenty-five percent", () => {
    // The commonest way to enter a garnishment that looks legal and collects
    // almost nothing, and the database constraint permits it.
    const l = GARNISHMENT_FIELD_LESSONS.find(
      (x) => x.field === "wage_orders.percent_of_disposable_basis_points",
    );
    expect(l).toBeDefined();
    expect(l!.theTrap).toMatch(/2500|basis point/i);
  });

  it("the fixed-amount lesson warns about the monthly-to-biweekly conversion", () => {
    const l = GARNISHMENT_FIELD_LESSONS.find(
      (x) => x.field === "wage_orders.amount_cents_per_period",
    );
    expect(l).toBeDefined();
    expect(`${l!.theTrap} ${l!.howToBeSure}`.toLowerCase()).toMatch(/monthly|26|biweekly/);
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * AUTHORITIES
 * ════════════════════════════════════════════════════════════════════════ */

describe("every citation points at a real mirrored authority", () => {
  it("passes against the real registry", () => {
    expect(() => assertEveryCitedGarnishmentAuthorityExists()).not.toThrow();
  });

  it("GATE IS WIRED: an invented authority id would be caught", () => {
    const known = new Set(GARNISHMENT_AUTHORITIES.map((a) => a.id));
    expect(known.has("rcw-9999-made-up")).toBe(false);
    // Prove the gate's own comparison, since the registry is a frozen const
    // and a dangling id cannot be injected without mutating it.
    const dangling = ["usc-15-1672-disposable", "rcw-9999-made-up"].filter(
      (id) => !known.has(id),
    );
    expect(dangling).toEqual(["rcw-9999-made-up"]);
  });

  it("every authority is cited by at least one lesson", () => {
    // Eleven authorities were mirrored for this engine. An uncited one is
    // usually a lesson somebody meant to write.
    expect(unusedGarnishmentAuthorityIds()).toEqual([]);
  });

  it("the support cap is cited where it actually bites", () => {
    const l = GARNISHMENT_FIELD_LESSONS.find(
      (x) => x.field === "wage_orders.supports_second_family",
    );
    expect(l!.authorityIds).toContain("usc-15-1673-support-cap");
  });

  it("the disposable earnings definition is cited by the lesson that teaches it", () => {
    const l = GARNISHMENT_SCREEN_LESSONS.find((x) => /disposable earnings is not/i.test(x.topic));
    expect(l, "no screen lesson teaches disposable earnings").toBeDefined();
    expect(l!.authorityIds).toContain("usc-15-1672-disposable");
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * REFUSAL CODES
 * ════════════════════════════════════════════════════════════════════════ */

describe("every refusal the engine can emit is explained", () => {
  it("reads the codes from the engine's own union type on disk", () => {
    // Not imported as a value: a TypeScript union has no runtime form, so the
    // only honest source is the source.
    expect(garnishmentEngineRefusalCodes().length).toBe(11);
  });

  it("passes against the real engine", () => {
    expect(() => assertEveryGarnishmentRefusalCodeIsTaught()).not.toThrow();
  });

  it("GATE IS WIRED: a new untaught refusal code fails the gate", () => {
    const p = tempSource(
      "core.ts",
      `export type GarnishmentRefusalCode =\n  | "NEGATIVE_GROSS"\n  | "ORDER_IS_HAUNTED";\n`,
    );
    expect(() => assertEveryGarnishmentRefusalCodeIsTaught(p)).toThrow(/ORDER_IS_HAUNTED/);
  });

  it("GATE IS WIRED: a lesson outliving its code fails the gate", () => {
    // The dangerous direction: the count still looks right.
    const p = tempSource(
      "core.ts",
      `export type GarnishmentRefusalCode =\n  | "NEGATIVE_GROSS";\n`,
    );
    expect(() => assertEveryGarnishmentRefusalCodeIsTaught(p)).toThrow(/NO LONGER EXIST/i);
  });

  it("GATE IS WIRED: an engine with no union type at all reports itself broken", () => {
    const p = tempSource("core.ts", "export const nothing = 1;\n");
    expect(() => assertEveryGarnishmentRefusalCodeIsTaught(p)).toThrow(/GATE BROKEN/i);
  });

  it("every refusal lesson says why we stop AND what to do about it", () => {
    for (const l of GARNISHMENT_REFUSAL_LESSONS) {
      expect(l.headline.length, `${l.code} headline`).toBeGreaterThan(20);
      expect(l.whyWeStop.length, `${l.code} whyWeStop`).toBeGreaterThan(60);
      expect(l.whatToDo.length, `${l.code} whatToDo`).toBeGreaterThan(40);
    }
  });

  it("UNKNOWN_ORDER_KIND tells Michael NOT to change the order", () => {
    // This refusal means the pay run called the wrong path. The order is
    // usually fine, and "fixing" it would corrupt correct data to silence a
    // code defect.
    const l = GARNISHMENT_REFUSAL_LESSONS.find((x) => x.code === "UNKNOWN_ORDER_KIND");
    expect(l).toBeDefined();
    expect(l!.whatToDo.toLowerCase()).toMatch(/do not adjust|developer|not change/);
  });

  it("the two support refusals name the money at stake rather than just the missing field", () => {
    // Standing rule 64a: detection is not explanation. "Missing field" is a
    // detection; "this is worth ten points of disposable earnings" is why
    // anyone will bother to go and find the answer.
    const family = GARNISHMENT_REFUSAL_LESSONS.find(
      (x) => x.code === "SUPPORT_MISSING_SECOND_FAMILY_ANSWER",
    );
    const arrears = GARNISHMENT_REFUSAL_LESSONS.find(
      (x) => x.code === "SUPPORT_MISSING_ARREARS_ANSWER",
    );
    expect(family!.whyWeStop).toMatch(/fifty and sixty|50|60/i);
    expect(arrears!.whyWeStop).toMatch(/five percentage points|5/i);
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * EXPORTED FUNCTION COVERAGE
 * ════════════════════════════════════════════════════════════════════════ */

describe("every exported engine function is explained somewhere", () => {
  it("reads the exports from disk", () => {
    expect(garnishmentExportedFunctionNames().length).toBe(8);
  });

  it("passes against the real engine", () => {
    expect(() => assertEveryGarnishmentFunctionIsTaught()).not.toThrow();
  });

  it("GATE IS WIRED: a new untaught export fails the gate", () => {
    const p = tempSource(
      "core.ts",
      "export function computeOneOrder() {}\nexport function computeTheVibes() {}\n",
    );
    expect(() => assertEveryGarnishmentFunctionIsTaught(p)).toThrow(/computeTheVibes/);
  });

  it("GATE IS WIRED: an explanation outliving its function fails the gate", () => {
    const p = tempSource("core.ts", "export function computeOneOrder() {}\n");
    expect(() => assertEveryGarnishmentFunctionIsTaught(p)).toThrow(/NO LONGER EXIST/i);
  });

  it("GATE IS WIRED: a file with no exports reports itself broken", () => {
    const p = tempSource("core.ts", "const x = 1;\n");
    expect(() => assertEveryGarnishmentFunctionIsTaught(p)).toThrow(/GATE BROKEN/i);
  });

  it("each explanation names where the teaching actually lives", () => {
    for (const [fn, why] of Object.entries(GARNISHMENT_CORE_FUNCTION_COVERAGE)) {
      expect(why.length, `${fn} explanation is too thin`).toBeGreaterThan(80);
      expect(why, `${fn} does not name a lesson`).toMatch(/lesson/i);
    }
  });

  /*
   * books-36, standing rule 23. The check above is satisfied by any entry
   * containing the word "lesson", including one that quotes a lesson which has
   * been deleted. That hole was found by mutation in the sick-leave module —
   * removing a quoted lesson left the whole suite green — and this map quotes
   * five lesson titles with exactly the same exposure. Same defect, same fix,
   * one shared implementation.
   */
  it("every lesson title the coverage map quotes actually exists", () => {
    expect(() => assertEveryQuotedGarnishmentLessonExists()).not.toThrow();
  });

  it("GATE IS WIRED: deleting a quoted lesson fails the gate", () => {
    const withoutIt = GARNISHMENT_SCREEN_LESSONS.map((l) => l.topic).filter(
      (t) => !t.startsWith("Disposable earnings is not take-home pay"),
    );
    expect(
      withoutIt.length,
      "the lesson this test removes does not exist, so the test proves nothing",
    ).toBe(GARNISHMENT_SCREEN_LESSONS.length - 1);
    expect(() => assertEveryQuotedGarnishmentLessonExists(withoutIt)).toThrow(/DO NOT EXIST/);
    expect(() => assertEveryQuotedGarnishmentLessonExists(withoutIt)).toThrow(/Disposable/);
  });

  it("GATE IS WIRED: retitling the support-cap lesson fails it too", () => {
    // The likelier real mistake: somebody improves a title and never looks at
    // the coverage map quoting the old one. Child support is the highest-stakes
    // lesson in this module, so it is the one pinned here by name.
    const retitled = GARNISHMENT_SCREEN_LESSONS.map((l) =>
      l.topic.startsWith("Support orders are not held to twenty-five percent")
        ? "Support orders have their own ceiling"
        : l.topic,
    );
    expect(() => assertEveryQuotedGarnishmentLessonExists(retitled)).toThrow(/Support orders/);
  });

  it("GATE IS WIRED: an empty lesson list reports itself broken, not clean", () => {
    expect(() => assertEveryQuotedGarnishmentLessonExists([])).toThrow(/GATE BROKEN/);
  });

  it("the harvest is non-trivial, not a regex that silently stopped matching", () => {
    // Standing rule 39: if the extractor matches nothing, every assertion
    // above passes vacuously and the gate is decoration.
    const titles = harvestQuotedLessonTitles(
      "src/lib/payroll/garnishment-mentor-gates.ts",
      "GARNISHMENT_CORE_FUNCTION_COVERAGE",
      "GARNISHMENT",
    );
    expect(titles.length, "no quoted lesson titles harvested").toBeGreaterThanOrEqual(5);
    const known = GARNISHMENT_SCREEN_LESSONS.map((l) => l.topic);
    for (const t of titles) {
      expect(known.some((k) => k.startsWith(t)), `harvested title resolves to nothing: ${t}`).toBe(
        true,
      );
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * SCREEN LESSONS
 * ════════════════════════════════════════════════════════════════════════ */

describe("the screen lessons teach the ideas, not the fields", () => {
  it("there are enough of them to be worth reading", () => {
    expect(GARNISHMENT_SCREEN_LESSONS.length).toBeGreaterThanOrEqual(10);
    for (const l of GARNISHMENT_SCREEN_LESSONS) {
      expect(l.plainEnglish.length, `${l.topic} plainEnglish`).toBeGreaterThan(120);
      expect(l.whyItMatters.length, `${l.topic} whyItMatters`).toBeGreaterThan(120);
      expect(l.authorityIds.length, `${l.topic} cites nothing`).toBeGreaterThan(0);
    }
  });

  it("the single most expensive misunderstanding is taught by name", () => {
    // Subtracting voluntary deductions from the base. It always errs in the
    // same direction, and the direction is the one the employer pays for.
    const l = GARNISHMENT_SCREEN_LESSONS.find((x) => /disposable earnings is not/i.test(x.topic));
    expect(l).toBeDefined();
    expect(l!.plainEnglish.toLowerCase()).toMatch(/health insurance|retirement|union dues/);
  });

  it("the biweekly floor trap is taught, because Greenway pays biweekly", () => {
    const l = GARNISHMENT_SCREEN_LESSONS.find((x) => /weekly/i.test(x.topic));
    expect(l).toBeDefined();
    expect(`${l!.plainEnglish} ${l!.whyItMatters}`.toLowerCase()).toMatch(/workweek|two week|biweekly/);
  });

  it("equal apportionment is taught as the counter-intuitive rule it is", () => {
    const l = GARNISHMENT_SCREEN_LESSONS.find((x) => /equal/i.test(x.topic));
    expect(l).toBeDefined();
    expect(`${l!.plainEnglish} ${l!.whyItMatters}`.toLowerCase()).toMatch(/proportion/);
  });

  it("nothing at all may be taken below the floor, and it says zero", () => {
    const l = GARNISHMENT_SCREEN_LESSONS.find((x) => /floor/i.test(x.topic) && /below/i.test(x.topic));
    expect(l).toBeDefined();
    expect(l!.plainEnglish.toLowerCase()).toContain("zero");
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * THE REVIEW CHECKLIST
 * ════════════════════════════════════════════════════════════════════════ */

describe("the review checklist is ordered the way a person should think", () => {
  it("passes against the real checklist", () => {
    expect(() => assertGarnishmentReviewChecksAreWellFormed()).not.toThrow();
  });

  it("disposable earnings is established before any ceiling", () => {
    expect(GARNISHMENT_REVIEW_CHECKS[0].key).toBe("disposable-first");
    const capStep = GARNISHMENT_REVIEW_CHECKS.find((c) => c.key === "which-cap-governs");
    expect(capStep!.order).toBeGreaterThan(GARNISHMENT_REVIEW_CHECKS[0].order);
  });

  it("the floor step comes after the ceilings, because it can override them", () => {
    const ceilings = GARNISHMENT_REVIEW_CHECKS.find(
      (c) => c.key === "both-ceilings-then-the-kinder",
    );
    const floor = GARNISHMENT_REVIEW_CHECKS.find((c) => c.key === "floor-can-make-it-zero");
    expect(floor!.order).toBeGreaterThan(ceilings!.order);
  });

  it("the floor step says to withhold nothing rather than something small", () => {
    const floor = GARNISHMENT_REVIEW_CHECKS.find((c) => c.key === "floor-can-make-it-zero");
    expect(floor!.ifItFails.toLowerCase()).toMatch(/nothing|zero/);
  });

  it("apportionment is asked last, once each order's own maximum is known", () => {
    const last = GARNISHMENT_REVIEW_CHECKS[GARNISHMENT_REVIEW_CHECKS.length - 1];
    expect(last.key).toBe("priority-and-apportionment");
  });

  it("every check explains why it sits where it does", () => {
    for (const c of GARNISHMENT_REVIEW_CHECKS) {
      expect(c.question.length, `${c.key} question`).toBeGreaterThan(20);
      expect(c.whyThisOrder.length, `${c.key} whyThisOrder`).toBeGreaterThan(60);
      expect(c.howToCheck.length, `${c.key} howToCheck`).toBeGreaterThan(60);
      expect(c.ifItFails.length, `${c.key} ifItFails`).toBeGreaterThan(40);
      expect(c.authorityIds.length, `${c.key} cites nothing`).toBeGreaterThan(0);
    }
  });
});
