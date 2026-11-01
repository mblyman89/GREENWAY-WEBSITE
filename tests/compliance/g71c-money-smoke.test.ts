/**
 * G-71c (owner message 12): daily money-path smoke test.
 *
 * Owner (verbatim): "Let's build 1-4 first. I see real value in all of them."
 * Item 3: a daily test run of a sale, a return and the till that undoes
 * everything.
 *
 * Pins:
 *   - the pure core passes and is registered;
 *   - 0332 is deliberate (rule 15): security invoker, pinned search_path,
 *     time limits, service_role only, always rolls back, never posts a
 *     journal (no number used) and never calls assign_order_name;
 *   - the 13 steps in SQL match the core;
 *   - rollback, PG check wiring, MIGRATIONS_TO_RUN;
 *   - the store folds the smoke into the ONE daily report (no new cron).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SMOKE_STEPS, __runMoneySmokeCoreTests, MONEY_SMOKE_MIGRATION, MONEY_SMOKE_RPC } from "@/lib/platform/money-smoke-core";
import { DB_CONTRACT_FUNCTIONS } from "@/lib/platform/db-contract";

const ROOT = join(__dirname, "../..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MIG = src(`supabase/migrations/${MONEY_SMOKE_MIGRATION}`);
const BODY = MIG.slice(MIG.indexOf("as $fn$"), MIG.indexOf("$fn$;"));

describe("G-71c money-path smoke test", () => {
  it("pure core passes and is registered", () => {
    const r = __runMoneySmokeCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(30);
    expect(src("scripts/compliance/run-pure-selftests.ts")).toMatch(/assertRan\("money-smoke-core", __runMoneySmokeCoreTests\(\), 30\)/);
  });

  it("0332 is deliberate about who may run it and how (standing rule 15)", () => {
    expect(MIG).toMatch(/security invoker/);
    expect(MIG).toMatch(/set search_path = pg_catalog, public/);
    expect(MIG).toMatch(/set statement_timeout = '20s'/);
    expect(MIG).toMatch(/set lock_timeout = '5s'/);
    expect(MIG).toMatch(/revoke all on function public\.platform_money_smoke_test\(\) from public, anon, authenticated;/);
    expect(MIG).toMatch(/grant execute on function public\.platform_money_smoke_test\(\) to service_role;/);
    expect(MIG).not.toMatch(/\bbegin;|\bcommit;/i);
    expect(MIG).toMatch(/MIGRATION_OUT_OF_ORDER/);
  });

  it("always rolls back and never uses a journal number or an order name", () => {
    expect(BODY).toMatch(/raise exception using errcode = 'P0001', message = v_marker;/);
    expect(BODY).toMatch(/if sqlerrm <> v_marker then/);
    // the ledger call is a DRAFT (p_auto_post false): gl_next_journal_no never runs
    const ledger = BODY.slice(BODY.indexOf("public.gl_submit_journal("), BODY.indexOf("v_step := 'return'"));
    expect(ledger).toMatch(/null, null, false, null, null, false/);
    expect(ledger).toMatch(/'draft'/);
    expect(BODY).not.toMatch(/gl_post_journal|assign_order_name|gl_next_journal_no|nextval/);
    expect(BODY).not.toMatch(/\bcommit\b/i);
  });

  it("the SQL steps are exactly the core's steps, in order", () => {
    const steps = [...BODY.matchAll(/v_step := '([a-z_]+)';/g)].map((m) => m[1]);
    expect(steps).toEqual([...SMOKE_STEPS]);
  });

  it("is wired into the gates", () => {
    expect(existsSync(join(ROOT, "supabase/rollbacks/0332_money_path_smoke_test.rollback.sql"))).toBe(true);
    expect(src("scripts/compliance/verify-migrations-execute.ts")).toMatch(
      /money-smoke-0332-pg-check\.sql", mustPrint: "MONEY SMOKE 0332 CHECK PASSED"/,
    );
    const pg = src("scripts/recon/money-smoke-0332-pg-check.sql");
    expect(pg).toMatch(/revoke execute on function public\.record_customer_return/);
    expect(pg).toMatch(/'42501'/);
    expect(pg).toMatch(/assert_nothing_left/);
    expect(src("docs/MIGRATIONS_TO_RUN.md")).toMatch(/0332_money_path_smoke_test\.sql/);
    expect(DB_CONTRACT_FUNCTIONS).toContain(MONEY_SMOKE_RPC);
  });

  it("runs inside the one daily platform-health run (no new cron, one email)", () => {
    const store = src("src/lib/platform/platform-health-store.ts");
    // G-71d wraps the same chain with the 24-hour error digest (still one report).
    expect(store).toMatch(/const report = await addErrorDigest\(await runSmoke\(admin, await runCheck\(admin\)\)\);/);
    expect(store).toContain("mergeSmokeIntoReport");
    const crons = JSON.parse(src("vercel.json")).crons as { path: string }[];
    expect(crons.filter((c) => c.path.startsWith("/api/cron/platform-")).length).toBe(1);
  });
});
