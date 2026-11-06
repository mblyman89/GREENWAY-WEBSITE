/**
 * tests/compliance/db-health-b-vitals.test.ts   (D193 · DB HEALTH round slice B)
 *
 * Owner (2026-11-06): "Please look for ways you can add to the ai partnership
 * so that it can help me self heal these issues now. I want a healthy db
 * always."
 *
 * Pins: 0345 (two functions, no table, SECURITY DEFINER + pinned search_path,
 * service_role only, app roles only, floors), the pure core (self-tests), the
 * 10-minute cron (auth, cadence, Level gate), the Partner tool ("touches
 * nothing", auto at Level 2, explain-only at Level 1), alert claims, and that
 * the vitals readings never displace the daily contract check.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { __runDbVitalsTests, APP_ROLES, HEAL_ACTIVE_MINUTES, HEAL_IDLE_TX_MINUTES } from "@/lib/platform/db-vitals-core";
import { gateFor, PARTNER_TOOLS } from "@/lib/ai/partner-core";
import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MIG = read("supabase/migrations/0345_db_vitals.sql");

describe("D193 0345 migration", () => {
  it("creates two functions and no table", () => {
    expect(MIG).toMatch(/create or replace function public\.platform_db_vitals\(\)/);
    expect(MIG).toMatch(/create or replace function public\.platform_db_heal_stuck\(/);
    expect(MIG).not.toMatch(/create table/i);
    expect(MIG).not.toMatch(/\b(insert into|update public\.|delete from)\b/i);
  });

  it("is SECURITY DEFINER with a pinned search_path, service_role only", () => {
    expect(MIG.match(/security definer/g)?.length).toBe(2);
    expect(MIG.match(/set search_path = pg_catalog, public/g)?.length).toBe(2);
    expect(MIG).toMatch(/revoke all on function public\.platform_db_vitals\(\) from public, anon, authenticated;/);
    expect(MIG).toMatch(/revoke all on function public\.platform_db_heal_stuck\(int\[\], int, int\) from public, anon, authenticated;/);
    expect(MIG).toMatch(/grant execute on function public\.platform_db_vitals\(\) to service_role;/);
    expect(MIG).toMatch(/grant execute on function public\.platform_db_heal_stuck\(int\[\], int, int\) to service_role;/);
  });

  it("heals app roles only, never itself, with floors of 2 and 5 minutes", () => {
    const heal = MIG.slice(MIG.indexOf("create or replace function public.platform_db_heal_stuck"));
    expect(heal).toMatch(/v_app_roles constant text\[\] := array\['authenticator', 'anon', 'authenticated', 'service_role'\]/);
    expect(heal).toMatch(/a\.usename = any \(v_app_roles\)/);
    expect(heal).toMatch(/a\.pid <> pg_backend_pid\(\)/);
    expect(heal).toMatch(/a\.backend_type = 'client backend'/);
    expect(heal).toMatch(/greatest\(coalesce\(p_idle_tx_minutes, 5\), 2\)/);
    expect(heal).toMatch(/greatest\(coalesce\(p_active_minutes, 10\), 5\)/);
    // idle-in-transaction is ended; a long active query is only cancelled
    expect(heal).toMatch(/pg_terminate_backend\(r\.pid\)/);
    expect(heal).toMatch(/pg_cancel_backend\(r\.pid\)/);
    expect(heal).not.toMatch(/'postgres'/);
    expect([...APP_ROLES].sort()).toEqual(["anon", "authenticated", "authenticator", "service_role"]);
    expect(HEAL_IDLE_TX_MINUTES).toBeGreaterThanOrEqual(2);
    expect(HEAL_ACTIVE_MINUTES).toBeGreaterThanOrEqual(5);
  });

  it("has a pg-check, a rollback, a MIGRATIONS_TO_RUN entry", () => {
    expect(POST_APPLY_CHECKS).toContainEqual({ file: "scripts/recon/db-vitals-0345-pg-check.sql", mustPrint: "DB VITALS 0345 CHECK PASSED" });
    expect(read("scripts/recon/db-vitals-0345-pg-check.sql")).toContain("\\echo 'DB VITALS 0345 CHECK PASSED'");
    expect(existsSync(join(ROOT, "supabase/rollbacks/0345_db_vitals.rollback.sql"))).toBe(true);
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("0345_db_vitals.sql");
  });
});

describe("D193 pure core", () => {
  it("self-tests pass and are registered", () => {
    const r = __runDbVitalsTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(38);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(/assertRan\("db-vitals-core", __runDbVitalsTests\(\), 38\)/);
  });
});

describe("D193 the 10-minute check", () => {
  it("runs every 10 minutes at :09 with the fail-closed cron auth", () => {
    const v = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    expect(v.crons.find((c) => c.path === "/api/cron/db-vitals")?.schedule).toBe("9-59/10 * * * *");
    const r = read("src/app/api/cron/db-vitals/route.ts");
    expect(r).toMatch(/shouldRefuseWhenSecretMissing\(secret\)/);
    expect(r).toMatch(/header === `Bearer \$\{secret\}`/);
  });

  it("only heals by itself when the Partner level lets a touches-nothing fix run (Level 2)", () => {
    const r = read("src/app/api/cron/db-vitals/route.ts");
    expect(r).toMatch(/autoHeal: gateFor\("clear_stuck_sessions", level\) === "auto"/);
    const s = read("src/lib/platform/db-vitals-store.ts");
    expect(s).toMatch(/if \(plan && opts\.autoHeal\)/);
  });

  it("claims each email first: one per restart, at most one an hour of trouble, never for warnings", () => {
    const s = read("src/lib/platform/db-vitals-store.ts");
    expect(s).toMatch(/db-vitals:restart:\$\{r\.vitals\.startedAt\}/);
    expect(s).toMatch(/db-vitals:fail:\$\{nowIso\.slice\(0, 13\)\}/);
    expect(s).toMatch(/if \(r\.status !== "fail"\) return null;/);
    expect(s).toMatch(/compliance_reminder_log/);
    expect(s).toMatch(/error\.code === "23505" \? "taken"/);
  });

  it("every database call reads its error (rule 135)", () => {
    const s = read("src/lib/platform/db-vitals-store.ts");
    const calls = (s.match(/await admin\b[\s\S]*?;/g) ?? []).length;
    expect(calls).toBeGreaterThanOrEqual(3);
    expect((s.match(/if \(error\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(s).toMatch(/if \(v\.error\)/);
    expect(s).toMatch(/if \(h\.error\)/);
  });

  it("vitals readings never displace the daily contract check (page list, Night Watch)", () => {
    expect(read("src/lib/platform/platform-health-store.ts")).toMatch(/\.eq\("kind", KIND\)/);
    expect(read("src/lib/registers/night-watch-store.ts")).toMatch(/platform_health_runs"\)\.select\("status, created_at"\)\.eq\("kind", "db_contract"\)/);
  });
});

describe("D193 Greenway Partner self-heal", () => {
  it("adds one tool that touches nothing: auto at Level 2, explain-only at Level 1", () => {
    expect(PARTNER_TOOLS.clear_stuck_sessions.touches).toBe("nothing");
    expect(gateFor("clear_stuck_sessions", 2)).toBe("auto");
    expect(gateFor("clear_stuck_sessions", 1)).toBe("explain_only");
  });

  it("the store applies it through healStuckSessions with the pids from the re-derived proposal", () => {
    const s = read("src/lib/ai/partner-store.ts");
    expect(s).toMatch(/case "clear_stuck_sessions": \{\s*const r = await healStuckSessions\(\{\s*pids: p\.payload\.pids,/);
    expect(s).toMatch(/readVitalsNow\(\)\.catch\(\(\) => null\)/);
    expect(s).toMatch(/database: db \? db\.report : null/);
  });

  it("the page shows the database line and links to vital signs", () => {
    const p = read("src/app/admin/partner/page.tsx");
    expect(p).toMatch(/data-testid="partner-database"/);
    const h = read("src/app/admin/settings/platform-health/page.tsx");
    expect(h).toMatch(/Database vital signs/);
    expect(h).toMatch(/<ClearStuckButton count=\{plan\.pids\.length\} \/>/);
    const a = read("src/app/admin/settings/platform-health/actions.ts");
    expect(a.slice(a.indexOf("export async function clearStuckConnectionsAction"))).toMatch(/requirePermission\("settings\.manage"\)/);
  });

  it("no free-form SQL anywhere in the heal path", () => {
    for (const f of ["src/lib/platform/db-vitals-store.ts", "src/lib/ai/partner-store.ts", "src/app/admin/settings/platform-health/actions.ts"]) {
      expect(read(f)).not.toMatch(/\.sql\(|execute_sql|raw sql/i);
    }
  });
});
