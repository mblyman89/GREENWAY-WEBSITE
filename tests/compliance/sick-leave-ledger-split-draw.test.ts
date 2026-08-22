/**
 * tests/compliance/sick-leave-ledger-split-draw.test.ts
 *
 * books-35. THE ENGINE PLANNED A WRITE THE DATABASE WOULD NOT ACCEPT.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS SUITE EXISTS BECAUSE OF
 * ──────────────────────────────────────────────────────────────────────────
 *
 * `sick-leave-core.ts` spends EARNED sick leave before AWARDED sick leave. That
 * ordering is deliberate and it protects Michael: what survives to year end is
 * then the leave he gifted, which may lapse, rather than statutory leave he
 * would be legally required to carry over. The suite next door
 * (sick-leave-core.test.ts) already proves the arithmetic.
 *
 * The direct consequence of that ordering is that ONE approved sick day can
 * need TWO ledger rows -- part from the statutory bucket, the remainder from
 * the awarded bucket. `planDraw` returns exactly that, and returns both numbers
 * greater than zero whenever an employee's earned balance is smaller than the
 * day they are taking.
 *
 * Migration 0198 then created a unique index keyed on `(request_id)` alone,
 * partial on `entry_kind = 'usage'`. One usage row per request. The awarded
 * half of that ordinary split was therefore rejected by PostgreSQL, and the
 * approval could not be recorded AT ALL:
 *
 *     ERROR:  duplicate key value violates unique constraint
 *             "sick_leave_ledger_one_usage_per_request"
 *
 * That was reproduced against a real PostgreSQL 15 with all 199 migrations
 * applied before 0200 was written. Nothing was corrupted -- the insert rolled
 * back whole -- but Michael would have been unable to approve sick leave for
 * precisely the employees he had already been generous to, and the message he
 * would have seen says "duplicate key" rather than anything about buckets.
 *
 * Migration 0200 widens the key to `(request_id, drawn_from)`, which permits
 * the two-bucket draw while still rejecting a genuine double-click on the same
 * bucket.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE TEST IS SHAPED LIKE THIS -- STANDING RULE 23, FIX THE CLASS
 * ──────────────────────────────────────────────────────────────────────────
 *
 * The instance was "0198's index is one column too narrow". The CLASS is "the
 * engine plans a write that the schema forbids, and nothing compares the two."
 * Every pure test in this repo either exercises the engine or reads SQL as
 * text; none of them had ever asked whether the rows one produces can survive
 * the constraints the other declares. That gap is what shipped the defect.
 *
 * So this suite derives the required key FROM THE ENGINE. It calls the real
 * `planDraw`, counts how many distinct ledger rows a single request can
 * legitimately produce, and then asserts the migration's uniqueness key is wide
 * enough to hold them. If a future slice adds a third bucket, `planDraw` starts
 * emitting three rows, and this test fails until the index is widened again --
 * it is not pinned to the number two.
 *
 * The SQL is read as text here on purpose: this is the pure-module compliance
 * job, which has no database. The real database proof lives in the `migrations`
 * CI job, which applies 0200 and re-applies it. Both matter -- text alone
 * cannot prove SQL runs, and a migration run alone would not explain WHY the
 * key must have this shape.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { planDraw, type SickLeaveBalance } from "../../src/lib/payroll/sick-leave-core";

const MIGRATIONS = path.resolve(__dirname, "../../supabase/migrations");

function readMigration(file: string): string {
  return readFileSync(path.join(MIGRATIONS, file), "utf8");
}

/**
 * The definition of the one-usage-per-request index as it stands after every
 * migration that touches it.
 *
 * DELIBERATELY THE LAST DEFINITION WINS. 0198 creates the index and 0200
 * recreates it; reading only 0198 would report the broken shape and reading
 * only 0200 would miss a future migration that changed it back. Concatenating
 * in file order and taking the final `create ... index` for that name is the
 * only reading that describes the database Michael will actually have.
 */
function effectiveUsageIndexDefinition(): string {
  const combined = [
    readMigration("0198_sick_leave_and_garnishments.sql"),
    readMigration("0200_sick_leave_split_draw_fix.sql"),
  ].join("\n");

  const matches = [
    ...combined.matchAll(
      /create\s+unique\s+index(?:\s+if\s+not\s+exists)?\s+sick_leave_ledger_one_usage_per_request([\s\S]*?);/gi,
    ),
  ];

  // Rule 39: a regex that matched nothing would make every assertion below
  // vacuous, so the absence of a match is itself a failure with a reason.
  expect(
    matches.length,
    "no CREATE UNIQUE INDEX for sick_leave_ledger_one_usage_per_request was found in 0198 or 0200 - " +
      "if the index was renamed, this suite is no longer guarding anything and must be updated",
  ).toBeGreaterThan(0);

  return matches[matches.length - 1][1];
}

/**
 * How many distinct ledger rows the ENGINE can produce for one request.
 *
 * Derived by execution, not by counting buckets by hand. A balance holding both
 * earned and awarded minutes, asked for more than the earned portion, is the
 * ordinary case that produces a split.
 */
function bucketsTheEngineCanEmitForOneRequest(): string[] {
  const balance: SickLeaveBalance = {
    statutoryMinutes: 300,
    awardedMinutes: 600,
    totalMinutes: 900,
  };
  const plan = planDraw(balance, 480);

  expect(
    plan.ok,
    "planDraw refused a 480-minute request against a 900-minute balance; " +
      "this suite cannot measure the split if the engine will not plan one",
  ).toBe(true);
  if (!plan.ok) return [];

  const buckets: string[] = [];
  if (plan.value.fromStatutoryMinutes > 0) buckets.push("statutory");
  if (plan.value.fromAwardedMinutes > 0) buckets.push("awarded");
  return buckets;
}

describe("the engine's draw plan and the ledger's unique index must agree", () => {
  it("the engine really does split one request across two buckets", () => {
    // Rule 39 again. If this ever stopped being true, every assertion about
    // the index below would be guarding a case that cannot arise, and would
    // pass while proving nothing.
    const buckets = bucketsTheEngineCanEmitForOneRequest();
    expect(buckets).toEqual(["statutory", "awarded"]);
  });

  it("the split spends EARNED leave first, which is why two rows are needed", () => {
    const plan = planDraw(
      { statutoryMinutes: 300, awardedMinutes: 600, totalMinutes: 900 },
      480,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    // The earned bucket is emptied before the gifted one is touched.
    expect(plan.value.fromStatutoryMinutes).toBe(300);
    expect(plan.value.fromAwardedMinutes).toBe(180);
    expect(
      plan.value.fromStatutoryMinutes + plan.value.fromAwardedMinutes,
    ).toBe(480);
  });

  it("the unique index is keyed on drawn_from as well as request_id", () => {
    const def = effectiveUsageIndexDefinition();

    expect(
      def,
      "sick_leave_ledger_one_usage_per_request must include request_id in its key",
    ).toMatch(/request_id/);

    // THIS is the assertion that would have caught the shipped defect. A key of
    // (request_id) alone cannot hold the two rows the engine plans above.
    expect(
      def,
      "sick_leave_ledger_one_usage_per_request is keyed on request_id ALONE, but the engine " +
        "plans TWO usage rows for a single request when a draw spans the earned and awarded " +
        "buckets. The second row is rejected as a duplicate key and the approval cannot be " +
        "recorded. Widen the key to (request_id, drawn_from).",
    ).toMatch(/drawn_from/);
  });

  it("the key is wide enough for every row the engine can emit for one request", () => {
    // Not pinned to two. If a third bucket is ever introduced, planDraw starts
    // emitting three rows and this fails until the index accounts for them.
    const buckets = bucketsTheEngineCanEmitForOneRequest();
    const def = effectiveUsageIndexDefinition();

    // The column that DISTINGUISHES the rows of one request must be in the key
    // whenever the engine can emit more than one such row.
    if (buckets.length > 1) {
      expect(
        def,
        `the engine can emit ${buckets.length} usage rows (${buckets.join(", ")}) for a single ` +
          "request, so the uniqueness key must include the column that tells them apart",
      ).toMatch(/drawn_from/);
    }
  });

  it("the index is still PARTIAL on usage, so accruals and awards are unconstrained", () => {
    // Widening the key must not have quietly widened the SCOPE. Accrual, award,
    // carry_in and correction rows have no request behind them at all, and a
    // non-partial unique index would collapse them.
    const def = effectiveUsageIndexDefinition();
    expect(def).toMatch(/where\s+entry_kind\s*=\s*'usage'/i);
  });

  it("the double-click defence is still described and still intended", () => {
    // Rule 50: the repair must not have turned the guard into decoration. 0200
    // has to say, in the file, that repeating a bucket is still refused -
    // otherwise a later reader could reasonably widen the key again to
    // (request_id, drawn_from, minutes) and destroy the protection entirely.
    const fix = readMigration("0200_sick_leave_split_draw_fix.sql");
    expect(fix).toMatch(/double-click/i);
    expect(fix).toMatch(/ONE USAGE ROW PER REQUEST PER BUCKET/);
  });

  it("0200 verifies the resulting index shape in the database, not just on paper", () => {
    // Rule 16: prove the gate is WIRED. An index with the right NAME and the
    // wrong KEY passes every by-name check in this repo, so 0200 carries a
    // post-flight block that reads pg_index and refuses if the key is not the
    // two columns intended.
    const fix = readMigration("0200_sick_leave_split_draw_fix.sql");
    expect(fix).toMatch(/pg_index/);
    expect(fix).toMatch(/SICK_LEAVE_INDEX_NOT_REPAIRED/);
  });
});
