/**
 * tests/compliance/d226-orders-source.test.ts
 *
 * D226 - the Online Orders board listed every register walk-in sale.
 *
 * Owner (verbatim): "In the back office online orders page, it shows thousands
 * of orders in history. Are all orders getting added to this table or is
 * there a bug? I'm sure we have not had that many online orders."
 * Then: "Yes please build all of the features mentioned above including the
 * filter and sort."
 *
 * Production (2026-11-10, read only): 1,376 of 1,388 orders rows since Nov 1
 * were register sales the POS sync wrote with the default origin 'greenway'.
 *
 * This file pins:
 *   1. the one rule for "register sale" (order-source-core self-tests);
 *   2. the store applies the source filter on every board reader and sends
 *      p_source to the 0358 RPC only when asked;
 *   3. the board page, the nav count / new-order chime and the cockpit count
 *      online orders only by default; the page has a "Show" filter next to Sort;
 *   4. the POS sync writes origin 'register' on every new sale (retry too);
 *   5. migrations 0358 + 0359, their rollbacks, the PG check, the run-book,
 *      the factory-reset classification.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  __runOrderSourceCoreTests,
  isRegisterSaleRow,
  orderSourceFilter,
  parseOrderSource,
} from "@/lib/orders/order-source-core";
import { __runOrdersPanelTests, parseOrdersPanelQuery, panelQueryEntries } from "@/lib/orders/order-panels-core";
import { classifyTable } from "@/lib/accounting/factory-reset-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("D226 order-source-core", () => {
  it("self-tests pass", () => {
    expect(() => __runOrderSourceCoreTests()).not.toThrow();
  });
  it("a register sale is origin register, a POS uuid, or the POS note", () => {
    expect(isRegisterSaleRow({ origin: "register" })).toBe(true);
    expect(isRegisterSaleRow({ origin: "greenway", pos_client_uuid: "abc" })).toBe(true);
    expect(isRegisterSaleRow({ origin: "greenway", staff_note: "POS sale \u2014 Register 1 \u2014 rung by X." })).toBe(true);
    expect(isRegisterSaleRow({ origin: "greenway", staff_note: null, pos_client_uuid: null })).toBe(false);
    expect(isRegisterSaleRow({ origin: "leafly" })).toBe(false);
  });
  it("the default view is online orders, and garbage falls back to it", () => {
    expect(parseOrderSource(undefined)).toBe("online");
    expect(parseOrderSource("register")).toBe("register");
    expect(parseOrderSource("all")).toBe("all");
    expect(parseOrderSource("'; select")).toBe("online");
  });
  it("online and register filters are exact complements (given the verified invariant)", () => {
    expect(orderSourceFilter("online")).toEqual({
      neq: [["origin", "register"]],
      isNull: ["pos_client_uuid"],
      orFilter: null,
    });
    expect(orderSourceFilter("register")).toEqual({
      neq: [],
      isNull: [],
      orFilter: "origin.eq.register,pos_client_uuid.not.is.null",
    });
    expect(orderSourceFilter("all")).toEqual({ neq: [], isNull: [], orFilter: null });
  });
});

describe("D226 order-panels-core: the Show filter in the URL", () => {
  it("panel self-tests pass with the D226 additions", () => {
    const r = __runOrdersPanelTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(112);
  });
  it("greenway reads ?source, the other panels do not", () => {
    expect(parseOrdersPanelQuery({ source: "register" }, "greenway").source).toBe("register");
    expect(parseOrdersPanelQuery({ source: "register" }, "leafly").source).toBe("online");
    expect(parseOrdersPanelQuery({ source: "register" }, "merch").source).toBe("online");
    expect(panelQueryEntries(parseOrdersPanelQuery({ source: "all" }, "greenway"), "greenway")).toContainEqual([
      "source",
      "all",
    ]);
  });
});

describe("D226 orders-store wiring", () => {
  const store = read("src/lib/orders/orders-store.ts");
  it("imports the one rule, never a hand-typed copy", () => {
    expect(store).toContain('from "./order-source-core"');
    expect(store).toContain("orderSourceFilter(");
    expect(store).not.toMatch(/pos_client_uuid\.not\.is\.null/);
  });
  it("applies the source on the list, the counts and the arrivals", () => {
    expect(store).toContain("q = applySource(q, filter.source)");
    // list + counts + both arrivals reads
    expect(store.match(/applySource\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
  it("sends p_source to the RPC only when a source is asked for", () => {
    expect(store).toContain("...(source ? { p_source: source } : {})");
    expect(store).toContain("snapshotSourceArg(opts.source)");
  });
});

describe("D226 callers", () => {
  it("the board page lists online orders by default and offers the filter", () => {
    const page = read("src/app/admin/orders/page.tsx");
    expect(page).toContain("source: gq.source,");
    expect(page).toContain("getOrdersBoardSnapshot({ arrivalsLimit: 0, excludeOrigins: BOARD_EXCLUDED_ORIGINS, source: gq.source })");
    expect(page).toContain("source?: string;");
  });
  it("the Show select sits beside Sort, on our panel only", () => {
    const panel = read("src/components/admin/orders/OrdersPanel.tsx");
    expect(panel).toContain("ORDER_SOURCES.map(");
    expect(panel).toContain("{names.source ? (");
    expect(panel).toContain("name={names.source}");
    expect(panel.indexOf("names.source ? (")).toBeLessThan(panel.indexOf("name={names.sort}"));
  });
  it("the nav badge / new-order chime and the cockpit count online orders only", () => {
    expect(read("src/app/api/admin/orders/count/route.ts")).toContain(
      'getOrdersBoardSnapshot({ arrivalsLimit: 20, source: "online" })',
    );
    expect(read("src/lib/admin/cockpit-data.ts")).toContain(
      'getOrdersBoardSnapshot({ arrivalsLimit: 0, source: "online" })',
    );
  });
  it("the POS sync labels every new sale as a register sale, on the retry too", () => {
    const sync = read("src/lib/pos/sync-store.ts");
    const start = sync.indexOf("const orderInsertRow = ");
    const end = sync.indexOf("...(withClientUuid", start);
    const body = sync.slice(start, end);
    expect(body).toContain('origin: "register",');
    // Not inside a withOptional / withClientUuid spread: always sent.
    expect(body.indexOf('origin: "register"')).toBeLessThan(body.indexOf("...(withOptional"));
  });
});

describe("D226 migrations", () => {
  const m357 = read("supabase/migrations/0358_orders_board_snapshot_source.sql");
  const m358 = read("supabase/migrations/0359_orders_register_origin_backfill.sql");
  const editorSafe = (sql: string) => {
    for (const c of sql.split("\n").filter((l) => l.trim().startsWith("--"))) {
      expect(c).not.toContain("'");
      expect(c).not.toContain(";");
    }
  };
  it("0358 replaces the 0233 function with one optional p_source, service role only", () => {
    expect(m357).toContain("drop function if exists public.orders_board_snapshot(integer, text[]);");
    expect(m357).toContain("p_source          text    default null");
    expect(m357).toContain("o.origin = 'register' or o.pos_client_uuid is not null");
    expect(m357).toContain(
      "revoke all on function public.orders_board_snapshot(integer, text[], text) from public, anon, authenticated;",
    );
    expect(m357).toContain("grant execute on function public.orders_board_snapshot(integer, text[], text) to service_role;");
    editorSafe(m357);
  });
  it("0359 lists then relabels register sales, deletes nothing, and fails loudly if any are left", () => {
    expect(m358).toContain("create table if not exists public.orders_origin_backfill_0359");
    expect(m358).toContain("alter table public.orders_origin_backfill_0359 enable row level security;");
    expect(m358).toContain("set origin = 'register'");
    expect(m358).toMatch(/raise exception '0359: % register sales still read greenway/);
    expect(m358.indexOf("insert into public.orders_origin_backfill_0359")).toBeLessThan(m358.indexOf("update public.orders o"));
    expect(m358).not.toMatch(/delete\s+from\s+public\.orders\b/i);
    editorSafe(m358);
  });
  it("ships both rollbacks, a registered PG check and run-book entries", () => {
    expect(existsSync(path.join(ROOT, "supabase/rollbacks/0358_orders_board_snapshot_source.rollback.sql"))).toBe(true);
    const rb = read("supabase/rollbacks/0359_orders_register_origin_backfill.rollback.sql");
    expect(rb).toContain("set origin = b.previous_origin");
    expect(rb).toContain("drop table if exists public.orders_origin_backfill_0359;");
    expect(read("scripts/recon/orders-source-0358-0359-pg-check.sql")).toContain("ORDERS SOURCE 0358 0359 CHECK PASSED");
    const runner = read("scripts/compliance/verify-migrations-execute.ts");
    expect(runner).toContain('"scripts/recon/orders-source-0358-0359-pg-check.sql"');
    const doc = read("docs/MIGRATIONS_TO_RUN.md");
    expect(doc).toContain("0358_orders_board_snapshot_source");
    expect(doc).toContain("0359_orders_register_origin_backfill");
  });
  it("the undo list is classified for the factory reset (KEEP, no foreign key into a wiped table)", () => {
    expect(classifyTable("orders_origin_backfill_0359")?.disposition).toBe("KEEP");
    expect(m358).not.toMatch(/order_id\s+uuid\s+primary key\s+references/);
  });
});
