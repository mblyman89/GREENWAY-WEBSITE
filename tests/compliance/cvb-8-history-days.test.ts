/**
 * CVB-8 - Cultivera report history (owner request 2026-11-02, decision CVB-D15).
 * Mirrors the pure self-tests and pins the wiring: migration 0338, its PG check, the factory-reset KEEP,
 * the owner-only audited action and the never-the-books rule.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HistoryRollup,
  __runCultiveraHistoryTests,
  crossCheck,
  historyFiles,
  orderDay,
} from "@/lib/reports/cultivera-history-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("CVB-8 cultivera-history-core", () => {
  it("self-tests pass", () => {
    const r = __runCultiveraHistoryTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(24);
  });

  it("reads Cultivera's real order row shape", () => {
    const row = {
      Id: 1, OrderStatus: "Completed", Discount: 2.0, OrderNo: "04300000001", CreatedAt: "2024-08-30T15:02:44.03Z",
      Total: 18.0, TotalReturned: 0.0, IsCompleted: true, IsCanceled: false, Units: 2.0, CreatedAtStr: "08/30/2024 08:02 AM",
    };
    expect(orderDay(row)).toBe("2024-08-30");
    const r = new HistoryRollup();
    r.add([row]);
    expect(r.days()).toEqual([{ day: "2024-08-30", revenue_minor: 1800, returned_minor: 0, orders: 1, units: 2 }]);
  });

  it("only monthly orders parts are history files", () => {
    expect(historyFiles([{ name: "orders.2026-10.jsonl.gz" }, { name: "orders.json" }]).map((f) => f.name)).toEqual(["orders.2026-10.jsonl.gz"]);
  });

  it("a difference is flagged, never hidden", () => {
    const [row] = crossCheck([{ day: "2025-01-01", revenue_minor: 101, returned_minor: 0, orders: 1, units: 1 }], [
      { day: "2025-01-01", net_sales_minor: 80, taxes_minor: 20, returns_minor: 0 },
    ]);
    expect(row.check_status).toBe("mismatch");
    expect(row.diff_minor).toBe(1);
  });
});

describe("CVB-8 wiring", () => {
  it("migration 0338: RLS, service_role only, no delete, newer capture wins", () => {
    const sql = read("supabase/migrations/0338_cultivera_history_days.sql");
    expect(sql).toMatch(/create table if not exists public\.cultivera_history_days/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/revoke delete, truncate, references, trigger on table public\.cultivera_history_days from service_role/);
    expect(sql).toMatch(/where h\.captured_at <= excluded\.captured_at/);
    expect(sql).toMatch(/grant execute on function public\.cvb_upsert_history_days\(text, jsonb\) to service_role/);
    expect(sql).toMatch(/security invoker/);
  });

  it("the PG check is registered and the table is kept by the factory reset", () => {
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toContain("CULTIVERA HISTORY 0338 CHECK PASSED");
    expect(read("src/lib/accounting/factory-reset-core.ts")).toMatch(/table: "cultivera_history_days", disposition: "KEEP"/);
    expect(read("src/lib/admin/schema-tables.ts")).toContain('"cultivera_history_days"');
  });

  it("the build action is owner only, audited, and never writes the books", () => {
    const a = read("src/app/admin/cultivera-archive/actions.ts");
    const i = a.indexOf("export async function buildHistoryAction");
    const body = a.slice(i);
    expect(body.indexOf('requirePermission("cultivera.benchmark")')).toBeGreaterThan(0);
    expect(body).toContain('action: "cultivera_archive.history_built"');
    const runner = read("src/lib/reports/cultivera-archive-runner.ts");
    const fn = runner.slice(runner.indexOf("export async function ingestHistory"));
    expect(fn).toMatch(/sha256Hex\(b\) !== f\.sha256/);
    expect(fn).not.toMatch(/from\("orders"\)|ledger|journal/);
    expect(read("src/app/admin/cultivera-archive/page.tsx")).toContain("Build report history");
  });
});
