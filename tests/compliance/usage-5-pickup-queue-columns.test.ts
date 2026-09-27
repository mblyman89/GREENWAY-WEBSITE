/**
 * USAGE-5 · the register pickup queue selects twelve named `orders` columns.
 *
 * `listRegisterPickupQueue()` runs every 45 s on every unlocked register
 * (RegisterShell pickup poll) and on every open of the pickup panel, reading
 * up to QUEUE_LIMIT × 4 = 200 rows. It used `listOrders`, which is
 * `select("*")` over a ~35-column table — loyalty_*, limit_reasons JSON,
 * customer_email / customer_phone / customer_birthday, pos_client_uuid — while
 * `toPickupQueueEntry` reads eleven fields and the POS-materialised filter
 * reads one more. Everything else was Supabase egress paid for nothing, and
 * customer PII shipped to a device that never displays it.
 *
 * This file mirrors the pure self-tests and pins the wiring: the store must
 * call `listOrdersColumns(PICKUP_QUEUE_ORDER_SELECT, …)` and must not fall
 * back to the wide read. Every OTHER `listOrders` caller is untouched.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  PICKUP_QUEUE_ORDER_COLUMNS,
  PICKUP_QUEUE_ORDER_SELECT,
  toPickupQueueEntry,
  type PickupQueueSourceRow,
  __runPickupCoreTests,
} from "@/lib/pos/pickup-core";

const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("USAGE-5 · pickup queue column list (pure)", () => {
  it("passes the embedded self-tests", () => {
    expect(() => __runPickupCoreTests()).not.toThrow();
  });

  it("is exactly the eleven entry fields plus staff_note, with no duplicates", () => {
    const cols = [...PICKUP_QUEUE_ORDER_COLUMNS].sort();
    expect(cols).toEqual(
      [
        "id",
        "order_number",
        "customer_first_name",
        "customer_last_name",
        "status",
        "item_count",
        "total_minor_units",
        "placed_at",
        "customer_note",
        "display_name",
        "origin",
        "staff_note",
      ].sort(),
    );
    expect(new Set(cols).size).toBe(cols.length);
    expect(PICKUP_QUEUE_ORDER_SELECT).toBe(PICKUP_QUEUE_ORDER_COLUMNS.join(", "));
  });

  it("never selects customer contact / identity columns", () => {
    const cols: readonly string[] = PICKUP_QUEUE_ORDER_COLUMNS;
    for (const pii of [
      "customer_email",
      "customer_phone",
      "customer_birthday",
      "limit_reasons",
      "pos_client_uuid",
      "loyalty_account_id",
    ]) {
      expect(cols, pii).not.toContain(pii);
    }
    expect(PICKUP_QUEUE_ORDER_SELECT).not.toContain("*");
  });

  it("an entry builds correctly from a row holding ONLY the selected columns", () => {
    const row: PickupQueueSourceRow & { staff_note: string | null } = {
      id: "o-1",
      order_number: "GW-4471",
      customer_first_name: "Ada",
      customer_last_name: "Lovelace",
      status: "ready",
      item_count: 3,
      total_minor_units: 4599,
      placed_at: "2026-09-27T00:00:00.000Z",
      customer_note: "back door",
      display_name: null,
      origin: "leafly",
      staff_note: null,
    };
    // Prove the fixture is exactly the selected set — no extra key smuggled in.
    expect(Object.keys(row).sort()).toEqual([...PICKUP_QUEUE_ORDER_COLUMNS].sort());
    const entry = toPickupQueueEntry(row, "2026-09-27T00:10:00.000Z");
    expect(entry.orderId).toBe("o-1");
    expect(entry.orderNumber).toBe("GW-4471");
    expect(entry.status).toBe("ready");
    expect(entry.itemCount).toBe(3);
    expect(entry.totalMinor).toBe(4599);
    expect(entry.placedAtIso).toBe("2026-09-27T00:00:00.000Z");
    expect(entry.hasCustomerNote).toBe(true);
    expect(entry.minutesWaiting).toBe(10);
  });
});

describe("USAGE-5 · pickup-store wiring", () => {
  const store = stripComments(read("src/lib/pos/pickup-store.ts"));
  const ordersStore = stripComments(read("src/lib/orders/orders-store.ts"));

  it("the queue read uses listOrdersColumns with the pinned select list", () => {
    const fn = store.slice(
      store.indexOf("export async function listRegisterPickupQueue("),
      store.indexOf("export async function", store.indexOf("export async function listRegisterPickupQueue(") + 10),
    );
    expect(fn).toContain("listOrdersColumns(PICKUP_QUEUE_ORDER_SELECT,");
    expect(fn).toContain('status: "active"');
    expect(fn).toContain("limit: QUEUE_LIMIT * 4");
    expect(fn).not.toMatch(/\blistOrders\(/);
    // The entry shaping and the POS filter are unchanged.
    expect(fn).toContain("isPosMaterializedOrder(o.staff_note)");
    expect(fn).toContain("toPickupQueueEntry(o, nowIso)");
  });

  it("pickup-store no longer imports the wide listOrders at all", () => {
    expect(store).not.toMatch(/import \{[^}]*\blistOrders\b[^}]*\} from "@\/lib\/orders\/orders-store"/);
    expect(store).toMatch(/import \{[^}]*\blistOrdersColumns\b[^}]*\} from "@\/lib\/orders\/orders-store"/);
  });

  it("listOrdersColumns exists, shares the query builder, and listOrders still reads the full row", () => {
    expect(ordersStore).toContain("export async function listOrdersColumns(");
    expect(ordersStore).toContain('return listOrdersSelecting("*", filter) as Promise<OrderRow[]>;');
    expect(ordersStore).toContain("return listOrdersSelecting(columns, filter);");
    expect(ordersStore).toContain('admin.from("orders").select(columns)');
    expect(ordersStore).toMatch(/Promise<Partial<OrderRow>\[\]>/);
  });

  it("every other listOrders caller is untouched (oversight keeps the full row)", () => {
    expect(stripComments(read("src/lib/registers/oversight.ts"))).toContain("listOrders(");
  });
});
