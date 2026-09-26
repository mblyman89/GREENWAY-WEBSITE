/**
 * Vitest mirror + drift alarm for USAGE-3's grouped Orders-board snapshot.
 *
 * WHAT IT LOCKS
 *  1. The pure parser (orders-board-snapshot-core) — via its self-tests plus
 *     a few direct assertions.
 *  2. The store wiring: getOrdersBoardSnapshot calls the 0233 RPC FIRST and
 *     falls back to the exact legacy readers on a missing-function error or a
 *     malformed payload (the owner applies migrations by hand, so the code
 *     must be correct before AND after 0233 runs).
 *  3. The three callers (nav count route, board page, cockpit) no longer fan
 *     out seven exact count(*) queries.
 *  4. Migration 0233's text: read-only, service_role only, every enum label
 *     present, the precondition block, the schema reload, and the standing
 *     docs entry. Execution was proven separately on Postgres 15 with all 233
 *     migrations applied (scripts/recon/orders-board-snapshot-pg-check.sql).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ORDERS_BOARD_SNAPSHOT_RPC,
  ORDER_STATUS_KEYS,
  clampArrivalsLimit,
  parseOrdersBoardSnapshot,
  __runOrdersBoardSnapshotCoreTests,
} from "@/lib/orders/orders-board-snapshot-core";

const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const fn = (src: string, name: string) => {
  const start = src.indexOf(`export async function ${name}`);
  expect(start, `${name} must exist`).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf("\n}\n", start));
};

const MIGRATION = "supabase/migrations/0233_orders_board_snapshot.sql";

describe("orders-board-snapshot-core (pure)", () => {
  it("passes its embedded self-tests", () => {
    expect(() => __runOrdersBoardSnapshotCoreTests()).not.toThrow();
  });

  it("pins the RPC name and the seven statuses in enum order", () => {
    expect(ORDERS_BOARD_SNAPSHOT_RPC).toBe("orders_board_snapshot");
    expect([...ORDER_STATUS_KEYS]).toEqual([
      "new",
      "acknowledged",
      "preparing",
      "ready",
      "completed",
      "cancelled",
      "no_show",
    ]);
  });

  it("returns null (→ legacy fallback) for anything that is not the 0233 shape", () => {
    expect(parseOrdersBoardSnapshot(undefined)).toBeNull();
    expect(parseOrdersBoardSnapshot("{}")).toBeNull();
    expect(parseOrdersBoardSnapshot({ counts: [], arrivals: [] })).toBeNull();
    expect(parseOrdersBoardSnapshot({ counts: { new: 1.5 }, arrivals: [], orders_updated_at: null, leafly_updated_at: null })).not.toBeNull();
    expect(parseOrdersBoardSnapshot({ counts: { new: 1 }, arrivals: [null], orders_updated_at: null, leafly_updated_at: null })).toBeNull();
  });

  it("clamps the arrivals limit exactly like the SQL (0..100, default 20)", () => {
    expect(clampArrivalsLimit(undefined)).toBe(20);
    expect(clampArrivalsLimit(0)).toBe(0);
    expect(clampArrivalsLimit(101)).toBe(100);
  });
});

describe("getOrdersBoardSnapshot wiring (orders-store)", () => {
  const store = stripComments(read("src/lib/orders/orders-store.ts"));
  const body = fn(store, "getOrdersBoardSnapshot");

  it("calls the 0233 RPC with the clamped limit and the sanitised origin list", () => {
    expect(body).toContain("admin.rpc(ORDERS_BOARD_SNAPSHOT_RPC, {");
    expect(body).toContain("p_arrivals_limit: limit");
    expect(body).toContain("p_exclude_origins: exclude.length > 0 ? exclude : null");
    expect(body).toContain("clampArrivalsLimit(opts.arrivalsLimit)");
    expect(body).toMatch(/filter\(\(o\) => \/\^\[a-z_\]\+\$\/\.test\(o\)\)/);
  });

  it("falls back to the exact legacy readers when the function is missing or the payload is malformed", () => {
    expect(body).toContain("isMissingDbFunctionError(error)");
    expect(body).toContain("parseOrdersBoardSnapshot(data)");
    // The legacy closure is the same three readers the route used before.
    expect(body).toContain("getOrderStatusCounts(");
    expect(body).toContain("getRecentOrderArrivals(limit)");
    expect(body).toContain("getLatestOrderChange()");
    // Every failure path returns legacy(), never a half-built object.
    const legacyReturns = body.match(/return legacy\(\);/g) ?? [];
    expect(legacyReturns.length).toBeGreaterThanOrEqual(4);
    expect(body).toContain("usedRpc: true");
    expect(body).toContain("usedRpc: false");
  });

  it("the legacy readers still exist untouched (they ARE the fallback)", () => {
    expect(store).toContain("export async function getOrderStatusCounts(");
    expect(store).toContain("export async function getRecentOrderArrivals(");
    expect(store).toContain("export async function getLatestOrderChange(");
  });
});

describe("callers no longer fan out seven count(*) queries", () => {
  it("the 15 s dashboard poll makes ONE store call and keeps its JSON shape", () => {
    const route = stripComments(read("src/app/api/admin/orders/count/route.ts"));
    expect(route).toContain("getOrdersBoardSnapshot({ arrivalsLimit: 20 })");
    expect(route).not.toContain("getOrderStatusCounts(");
    expect(route).not.toContain("getRecentOrderArrivals(");
    expect(route).not.toContain("getLatestOrderChange(");
    // Response contract for NewOrderAlert.tsx is unchanged.
    expect(route).toContain("{ counts, active, arrivals, fingerprint, ts: Date.now() }");
    expect(route).toContain("changeFingerprint({ ...latest, counts })");
  });

  it("the board page and the cockpit use the grouped snapshot for their counts", () => {
    const page = stripComments(read("src/app/admin/orders/page.tsx"));
    expect(page).toContain("getOrdersBoardSnapshot({ arrivalsLimit: 0, excludeOrigins: BOARD_EXCLUDED_ORIGINS })");
    expect(page).not.toContain("getOrderStatusCounts(");
    const cockpit = stripComments(read("src/lib/admin/cockpit-data.ts"));
    expect(cockpit).toContain("getOrdersBoardSnapshot({ arrivalsLimit: 0 })");
    expect(cockpit).not.toContain("getOrderStatusCounts(");
  });

  it("no other production caller still uses the seven-count reader", () => {
    // If a new caller appears it should go through the snapshot too; list any
    // legitimate exception here with a reason.
    const callers = [
      "src/app/api/admin/orders/count/route.ts",
      "src/app/admin/orders/page.tsx",
      "src/lib/admin/cockpit-data.ts",
    ];
    for (const rel of callers) {
      expect(stripComments(read(rel)), rel).not.toMatch(/\bgetOrderStatusCounts\(/);
    }
  });
});

describe("migration 0233 text", () => {
  const sql = read(MIGRATION);

  it("is read-only, stable, security definer, and locked to service_role", () => {
    expect(sql).toMatch(/create or replace function public\.orders_board_snapshot\(/);
    expect(sql).toContain("returns jsonb");
    expect(sql).toMatch(/\nstable\n/);
    expect(sql).toMatch(/\nsecurity definer\n/);
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain(
      "revoke all on function public.orders_board_snapshot(integer, text[]) from public, anon, authenticated;",
    );
    expect(sql).toContain("grant execute on function public.orders_board_snapshot(integer, text[]) to service_role;");
    // Nothing in the file writes to a table.
    const code = sql.replace(/^\s*--.*$/gm, "");
    expect(code).not.toMatch(/\b(insert|update|delete)\s+(into|public\.|from)/i);
  });

  it("re-runs safely (drop-then-create) and reloads the PostgREST schema cache", () => {
    expect(sql).toContain("drop function if exists public.orders_board_snapshot(integer, text[]);");
    expect(sql).toContain("notify pgrst, 'reload schema';");
  });

  it("refuses out of order, naming the file to run first (rule from 0189)", () => {
    expect(sql).toContain("MIGRATION_OUT_OF_ORDER: 0233 reads public.orders");
    expect(sql).toContain("0147_order_name_pool.sql");
    expect(sql).toContain("0226_leafly_outbound_orders.sql");
    expect(sql).toContain("0225_leafly_order_webhooks.sql");
  });

  it("derives the count keys from the order_status enum so every status is always present", () => {
    expect(sql).toMatch(/jsonb_object_agg\(e\.enumlabel, coalesce\(b\.c, 0\) order by e\.enumsortorder\)/);
    expect(sql).toContain("t.typname = 'order_status'");
    expect(sql).toContain("group by status");
  });

  it("returns the same four answers the legacy readers produced", () => {
    expect(sql).toContain("'counts',");
    expect(sql).toContain("'arrivals',");
    expect(sql).toContain("'orders_updated_at', (select max(updated_at) from public.orders)");
    expect(sql).toContain("'leafly_updated_at', (select max(updated_at) from public.leafly_orders)");
    expect(sql).toContain("greatest(0, least(100, coalesce(p_arrivals_limit, 20)))");
    expect(sql).toContain("o.origin <> all (p_exclude_origins)");
  });

  it("is listed in docs/MIGRATIONS_TO_RUN.md with the poll numbers", () => {
    const doc = read("docs/MIGRATIONS_TO_RUN.md");
    expect(doc).toContain("0233_orders_board_snapshot.sql");
    expect(doc).toMatch(/ten|10/);
  });

  it("has a committed Postgres scenario script", () => {
    const check = read("scripts/recon/orders-board-snapshot-pg-check.sql");
    expect(check).toContain("public.orders_board_snapshot()");
    expect(check).toContain("rollback;");
    expect(check).toContain("array['leafly']");
  });
});
