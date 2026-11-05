/**
 * tests/compliance/perf-p1-menu-retention.test.ts  (PERF round P1/P2)
 *
 * Owner (2026-11-05): "I need my back office to be lightning fast ... I want optimization and
 * efficiency to be paramount now that we are in live production."
 *
 * Pins: 0344 (facts table + triggers + invoker RPC + bounded prune, stated permissions), the
 * pg-check registered, the rollback present, the reclaim script, the reset classification, the
 * prune after both publish paths, and latest-menu-facts never walking every row on a timeout.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { __runMenuRetentionTests, factsFallback, readPruneResult } from "../../src/lib/menu/menu-retention-core";
import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const MIG = read("supabase/migrations/0344_menu_copy_retention.sql");
const code = (s: string) => s.split("\n").map((l) => (l.trimStart().startsWith("--") || l.trimStart().startsWith("//") || l.trimStart().startsWith("*") ? "" : l)).join("\n");

describe("PERF P1 0344 migration", () => {
  it("creates the facts table with RLS and select-only for service_role", () => {
    expect(MIG).toContain("create table if not exists public.product_latest_facts");
    expect(MIG).toContain("alter table public.product_latest_facts enable row level security;");
    expect(MIG).toContain("revoke all on table public.product_latest_facts from public, anon, authenticated;");
    expect(MIG).toContain("revoke insert, update, delete, truncate, references, trigger on table public.product_latest_facts from service_role;");
    expect(MIG).toContain("grant select on table public.product_latest_facts to service_role;");
  });
  it("keeps the facts current on insert, update, delete and truncate (statement level)", () => {
    for (const t of ["menu_items_latest_facts_ins", "menu_items_latest_facts_upd", "menu_items_latest_facts_del", "menu_items_latest_facts_trunc"]) {
      expect(MIG).toContain(`drop trigger if exists ${t} on public.menu_items;`);
      expect(MIG).toContain(`create trigger ${t}`);
    }
    expect(MIG.match(/for each statement execute function/g)?.length).toBe(4);
    expect(MIG).toContain("order by n.source_item_id, n.created_at desc, n.id asc");
  });
  it("trigger bodies are definer with a pinned search_path and nobody can call them", () => {
    for (const f of ["product_latest_facts_sync", "product_latest_facts_on_delete", "product_latest_facts_on_truncate"]) {
      expect(MIG).toContain(`revoke all on function public.${f}() from public, anon, authenticated, service_role;`);
    }
    expect(MIG.match(/set search_path = public, pg_temp/g)?.length).toBe(5);
  });
  it("latest_menu_facts keeps its signature, reads the small table, is invoker, service_role only", () => {
    const body = MIG.slice(MIG.indexOf("create or replace function public.latest_menu_facts"));
    expect(body).toContain("security invoker");
    expect(body.slice(0, body.indexOf("$$;"))).toContain("from public.product_latest_facts f");
    expect(MIG).toContain("revoke all on function public.latest_menu_facts(text[]) from public, anon, authenticated;");
    expect(MIG).toContain("grant execute on function public.latest_menu_facts(text[]) to service_role;");
  });
  it("prune is bounded, keeps >= 3, keeps import / test / fresh versions, invoker, service_role only", () => {
    const body = MIG.slice(MIG.indexOf("create or replace function public.prune_menu_version_items"));
    expect(body).toContain("security invoker");
    expect(body).toContain("least(greatest(coalesce(p_max_versions, 4), 1), 500)");
    expect(body).toContain("PRUNE_KEEP_TOO_SMALL");
    expect(body).toContain("mv.import_id is null");
    expect(body).toContain("mv.is_test is not true");
    expect(body).toContain("interval '10 minutes'");
    expect(body).toContain("for update of mv skip locked");
    expect(body).toContain("set_config('greenway.menu_prune', 'on', true)");
    expect(MIG).toContain("revoke all on function public.prune_menu_version_items(integer, integer) from public, anon, authenticated;");
    expect(MIG).toContain("grant execute on function public.prune_menu_version_items(integer, integer) to service_role;");
  });
  it("has a registered pg-check, a rollback and the owner reclaim script", () => {
    expect(POST_APPLY_CHECKS).toContainEqual({ file: "scripts/recon/menu-copy-retention-0344-pg-check.sql", mustPrint: "MENU COPY RETENTION 0344 CHECK PASSED" });
    const pg = read("scripts/recon/menu-copy-retention-0344-pg-check.sql");
    expect(pg.trimEnd().endsWith("rollback;")).toBe(true);
    expect(pg).toContain("\\echo 'MENU COPY RETENTION 0344 CHECK PASSED'");
    expect(existsSync(join(ROOT, "supabase/rollbacks/0344_menu_copy_retention.rollback.sql"))).toBe(true);
    const ops = read("scripts/ops/menu-copy-reclaim.sql");
    expect(ops).toContain("select public.prune_menu_version_items(5, 25);");
    expect(ops).toContain("vacuum (full, analyze) public.menu_items;");
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("0344_menu_copy_retention.sql");
  });
  it("the reset classifies product_latest_facts (KEEP, emptied by its own truncate trigger)", () => {
    expect(read("src/lib/accounting/factory-reset-core.ts")).toContain('table: "product_latest_facts", disposition: "KEEP"');
    expect(MIG).toContain("truncate table public.product_latest_facts;");
  });
});

describe("PERF P1 app code", () => {
  it("both publish paths clear old copies after the response", () => {
    for (const f of ["src/lib/pos/intake-menu-staging.ts", "src/lib/pos/import-service.ts"]) {
      expect(code(read(f))).toContain('runAfterResponse("old menu copies", () => pruneOldMenuCopies());');
    }
  });
  it("latest-menu-facts walks every row only when the function is missing", () => {
    const src = code(read("src/lib/menu/latest-menu-facts.ts"));
    expect(src).toContain('if (factsFallback(dbError) !== "walk")');
    expect(src).toMatch(/const \{ data, error \} = await admin\s*\.from\("menu_items"\)/);
    expect(src).toContain("Menu facts (fallback read) failed");
    expect(factsFallback({ code: "57014", message: "canceling statement due to statement timeout" })).toBe("report");
    expect(factsFallback({ code: "PGRST202", message: "Could not find the function" })).toBe("walk");
  });
  it("the prune answer is read, never guessed", () => {
    expect(readPruneResult(null, null).kind).toBe("error");
    expect(readPruneResult(null, { code: "42883", message: "function does not exist" }).kind).toBe("not_applied");
  });
  it("pure self-tests pass", () => {
    const r = __runMenuRetentionTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(22);
  });
});
