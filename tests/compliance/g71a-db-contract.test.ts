/**
 * tests/compliance/g71a-db-contract.test.ts  (slice G-71a, owner message 12)
 *
 * The daily database health check only works if its list of "what the code
 * uses" is complete and true. These tests make sure:
 *   - the generated contract matches the code right now (rerun
 *     `npx tsx scripts/platform/build-db-contract.ts` after adding a table/RPC);
 *   - every table and function in the contract is created by some migration
 *     (code never relies on something the database "just has");
 *   - the scanner reads .from()/.rpc()/*_TABLE/*_RPC and ignores comments,
 *     storage buckets and Array.from;
 *   - 0331 is append-only, service_role only, and wired into the gates;
 *   - the cron, page, nav and self-tests are wired.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { collectDbContract, renderDbContract, scanSourceText } from "@/lib/platform/db-contract-scan";
import { DB_CONTRACT_FUNCTIONS, DB_CONTRACT_TABLES } from "@/lib/platform/db-contract";
import { __runDbContractCoreTests } from "@/lib/platform/db-contract-core";

const ROOT = process.cwd();
const MIG_DIR = "supabase/migrations";
const MIG = "0331_platform_health.sql";
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const sqlOnly = (t: string) => t.replace(/--[^\n]*/g, "");

function createdByMigrations(): { tables: Set<string>; functions: Set<string> } {
  const tables = new Set<string>();
  const functions = new Set<string>();
  for (const f of readdirSync(join(ROOT, MIG_DIR)).filter((x) => x.endsWith(".sql"))) {
    const t = sqlOnly(src(`${MIG_DIR}/${f}`)).toLowerCase();
    for (const m of t.matchAll(/create\s+(?:or\s+replace\s+)?(?:materialized\s+)?(?:table|view)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?/g)) tables.add(m[1]);
    for (const m of t.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?\w+\s+rename\s+to\s+(\w+)/g)) tables.add(m[1]);
    for (const m of t.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/g)) functions.add(m[1]);
  }
  return { tables, functions };
}

describe("G-71a: the code's database contract", () => {
  it("the generated contract is up to date with the code", () => {
    const fresh = renderDbContract(collectDbContract(ROOT));
    expect(src("src/lib/platform/db-contract.generated.json")).toBe(fresh);
  });

  it("the contract is non-trivial and includes the R-RET function", () => {
    expect(DB_CONTRACT_TABLES.length).toBeGreaterThan(200);
    expect(DB_CONTRACT_FUNCTIONS.length).toBeGreaterThan(40);
    expect(DB_CONTRACT_FUNCTIONS).toContain("record_customer_return");
    expect(DB_CONTRACT_TABLES).toContain("platform_health_runs");
    expect(DB_CONTRACT_FUNCTIONS).toContain("platform_db_contract_check");
  });

  it("every table and function the code uses is created by a migration", () => {
    const made = createdByMigrations();
    expect(DB_CONTRACT_TABLES.filter((t) => !made.tables.has(t))).toEqual([]);
    expect(DB_CONTRACT_FUNCTIONS.filter((f) => !made.functions.has(f))).toEqual([]);
  });

  it("the scanner reads tables and RPCs and ignores look-alikes", () => {
    const got = scanSourceText(`
      // admin.from("in_a_comment")
      /* .rpc("also_comment") */
      const a = await admin.from("orders").select("*");
      await admin.rpc("record_sale", {});
      supabase.storage.from("product-images");
      Array.from(xs); Buffer.from("abc"); Object.from;
      const RUNS_TABLE = "platform_health_runs";
      const CHECK_RPC = "platform_db_contract_check";
    `);
    expect([...got.tables].sort()).toEqual(["orders", "platform_health_runs"]);
    expect([...got.functions].sort()).toEqual(["platform_db_contract_check", "record_sale"]);
  });

  it("the pure core self-test passes and is registered", () => {
    const r = __runDbContractCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(30);
    expect(src("scripts/compliance/run-pure-selftests.ts")).toMatch(/assertRan\("db-contract-core", __runDbContractCoreTests\(\), \d+\)/);
  });
});

describe("G-71a: 0331 is deliberate about its grants", () => {
  const t = sqlOnly(src(`${MIG_DIR}/${MIG}`));

  it("exists with a rollback and a PG scenario check wired into the execution gate", () => {
    expect(existsSync(join(ROOT, "supabase/rollbacks/0331_platform_health.rollback.sql"))).toBe(true);
    expect(src("scripts/compliance/verify-migrations-execute.ts")).toMatch(
      /platform-health-0331-pg-check\.sql", mustPrint: "PLATFORM HEALTH 0331 CHECK PASSED"/,
    );
    expect(src("docs/MIGRATIONS_TO_RUN.md")).toMatch(/0331_platform_health\.sql/);
  });

  it("no transaction wrapper (so the PG check can run it inside its own)", () => {
    expect(t).not.toMatch(/^\s*begin\s*;/im);
    expect(t).not.toMatch(/^\s*commit\s*;/im);
  });

  it("the runs log is append-only and service_role only, explicitly", () => {
    expect(t).toMatch(/revoke all on table public\.platform_health_runs from public, anon, authenticated;/);
    expect(t).toMatch(/revoke update, delete, truncate[^;]* on table public\.platform_health_runs from service_role;/);
    expect(t).toMatch(/grant select, insert on table public\.platform_health_runs to service_role;/);
    expect(t).toMatch(/alter table public\.platform_health_runs enable row level security/);
  });

  it("the check function is read-only, invoker, pinned search_path, service_role only", () => {
    expect(t).toMatch(/function public\.platform_db_contract_check\(p_tables text\[\], p_functions text\[\]\)/);
    expect(t).toMatch(/stable/);
    expect(t).toMatch(/security invoker/);
    expect(t).toMatch(/set search_path = pg_catalog, public/);
    expect(t).toMatch(/revoke execute on function public\.platform_db_contract_check\(text\[\], text\[\]\) from public, anon, authenticated;/);
    expect(t).toMatch(/grant execute on function public\.platform_db_contract_check\(text\[\], text\[\]\) to service_role;/);
    for (const m of t.matchAll(/grant\s[^;]*?\sto\s+([^;]+);/gi)) expect(m[1]).not.toMatch(/\banon\b|\bauthenticated\b|\bpublic\b/i);
    expect(t).toMatch(/notify pgrst, 'reload schema'/);
  });
});

describe("G-71a: wiring", () => {
  it("the daily cron is scheduled once a day and authenticates fail-closed", () => {
    const v = JSON.parse(src("vercel.json")) as { crons: { path: string; schedule: string }[] };
    const c = v.crons.filter((x) => x.path === "/api/cron/platform-health");
    expect(c).toHaveLength(1);
    expect(c[0].schedule).toBe("25 14 * * *");
    const r = src("src/app/api/cron/platform-health/route.ts");
    expect(r).toMatch(/shouldRefuseWhenSecretMissing/);
    expect(r).toMatch(/runPlatformHealthCheck\(\{ source: "cron" \}\)/);
  });

  it("the store claims one email per Pacific day and records every run", () => {
    const s = src("src/lib/platform/platform-health-store.ts");
    expect(s).toMatch(/import "server-only"/);
    expect(s).toMatch(/pacificToday\(\)/);
    expect(s).toMatch(/dailyAlertKey\(day\)/);
    expect(s).toMatch(/error\.code === "23505" \? "taken"/);
    expect(s).toMatch(/from\(RUNS_TABLE\)\.insert/);
    expect(s).toMatch(/DB_CONTRACT_TABLES/);
  });

  it("the admin page is permissioned, audited, and in the nav", () => {
    expect(src("src/app/admin/settings/platform-health/page.tsx")).toMatch(/requirePermission\("settings\.manage"\)/);
    const a = src("src/app/admin/settings/platform-health/actions.ts");
    expect(a).toMatch(/requirePermission\("settings\.manage"\)/);
    expect(a).toMatch(/recordAudit\(/);
    expect(a).toMatch(/source: "manual"/);
    expect(src("src/components/admin/admin-nav-data.ts")).toMatch(/href: "\/admin\/settings\/platform-health", permission: "settings\.manage"/);
  });
});
