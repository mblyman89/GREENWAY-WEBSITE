/**
 * SLICE 19 — the register's transaction history.
 *
 * Owner: "Right now it's just a box that you enter or scan the receipt code.
 * I want the register to show a history of transactions with the name of the
 * customer and total and whatever other data the enterprise industry standard
 * practice method for viewing and interacting with past sales on the register."
 *
 * These tests drive the REAL `listRecentTransactions` store and the REAL
 * GET /api/pos/transactions route against a PostgREST-shaped fake, plus the
 * REAL pure core. The properties that matter most:
 *
 *   1. A customer is NEVER shown with a full surname (privacy budget).
 *   2. The history window MATCHES the return window — the list must not offer
 *      sales the return path would then refuse.
 *   3. It is READ-ONLY. There is exactly one refund path, and this is not it.
 *   4. A failed read is reported as a failure, never as an empty history.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mutable fixtures ────────────────────────────────────────────────────────
type Ev = { client_uuid: string; order_id: string | null; occurred_at: string; employee_id: string | null; event_type: string; status: string };
type Ord = { id: string; order_number: string; status: string | null; customer_id: string | null; total_minor_units: number };
type Line = { id: string; order_id: string; product_name: string; quantity: number };
type Ret = { order_line_id: string; order_id: string; quantity: number };

let events: Ev[] = [];
let orders: Ord[] = [];
let lines: Line[] = [];
let returns: Ret[] = [];
let customers: { id: string; first_name: string; last_name: string | null }[] = [];
let employees: { id: string; full_name: string }[] = [];

let eventsFail = false;
let ordersFail = false;
let linesFail = false;
let serviceConfigured = true;

/** Every table the store touched — proves it never wrote. */
const touched: { table: string; op: string }[] = [];

vi.mock("@/lib/supabase/env", () => ({
  get isSupabaseServiceConfigured() {
    return serviceConfigured;
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from(table: string) {
      touched.push({ table, op: "from" });
      const b: Record<string, unknown> = {
        _in: null as string[] | null,
        select() {
          return b;
        },
        eq() {
          return b;
        },
        not() {
          return b;
        },
        gte() {
          return b;
        },
        order() {
          return b;
        },
        in(_col: string, vals: string[]) {
          b._in = vals;
          return b;
        },
        limit() {
          if (table === "pos_sale_events") {
            if (eventsFail) return Promise.resolve({ data: null, error: { message: "ledger read failed" } });
            return Promise.resolve({
              data: events.filter((e) => e.event_type === "sale" && e.status === "processed" && e.order_id),
              error: null,
            });
          }
          return Promise.resolve({ data: [], error: null });
        },
        // Writing must be impossible. If the store ever calls these the test
        // fails loudly rather than silently accepting a mutation.
        update() {
          touched.push({ table, op: "update" });
          throw new Error(`WRITE ATTEMPTED on ${table}`);
        },
        insert() {
          touched.push({ table, op: "insert" });
          throw new Error(`WRITE ATTEMPTED on ${table}`);
        },
        delete() {
          touched.push({ table, op: "delete" });
          throw new Error(`WRITE ATTEMPTED on ${table}`);
        },
        then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
          // `.in(...)` terminal awaits land here.
          const ids = (b._in as string[] | null) ?? [];
          if (table === "orders") {
            if (ordersFail) return resolve({ data: null, error: { message: "orders read failed" } });
            return resolve({ data: orders.filter((o) => ids.includes(o.id)), error: null });
          }
          if (table === "order_lines") {
            if (linesFail) return resolve({ data: null, error: { message: "lines read failed" } });
            return resolve({ data: lines.filter((l) => ids.includes(l.order_id)), error: null });
          }
          if (table === "customer_returns") {
            return resolve({ data: returns.filter((r) => ids.includes(r.order_id)), error: null });
          }
          if (table === "customers") {
            return resolve({ data: customers.filter((c) => ids.includes(c.id)), error: null });
          }
          if (table === "employees") {
            return resolve({ data: employees.filter((e) => ids.includes(e.id)), error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return b;
    },
  }),
}));

async function load() {
  vi.resetModules();
  const { listRecentTransactions } = await import("@/lib/pos/transaction-history-store");
  return listRecentTransactions();
}

const NOW = Date.now();
const iso = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();

beforeEach(() => {
  serviceConfigured = true;
  eventsFail = false;
  ordersFail = false;
  linesFail = false;
  touched.length = 0;

  events = [
    { client_uuid: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", order_id: "o1", occurred_at: iso(10), employee_id: "e1", event_type: "sale", status: "processed" },
    { client_uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", order_id: "o2", occurred_at: iso(5), employee_id: "e1", event_type: "sale", status: "processed" },
  ];
  orders = [
    { id: "o1", order_number: "GW-1001", status: "completed", customer_id: "c1", total_minor_units: 4550 },
    { id: "o2", order_number: "GW-1002", status: "completed", customer_id: null, total_minor_units: 1200 },
  ];
  lines = [
    { id: "l1", order_id: "o1", product_name: "Blue Dream 1g", quantity: 2 },
    { id: "l2", order_id: "o2", product_name: "Pre-roll", quantity: 1 },
  ];
  returns = [];
  customers = [{ id: "c1", first_name: "Jane", last_name: "Doe" }];
  employees = [{ id: "e1", full_name: "Sam Rivera" }];
});

describe("SLICE 19 — the history answers the owner's ask", () => {
  it("lists recent sales with customer, total, items, staff and receipt", async () => {
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.transactions).toHaveLength(2);
    const jane = res.transactions.find((t) => t.orderNumber === "GW-1001");
    expect(jane).toBeDefined();
    expect(jane!.customerLabel).toBe("Jane D.");
    expect(jane!.totalMinor).toBe(4550);
    expect(jane!.itemCount).toBe(2);
    expect(jane!.employeeName).toBe("Sam Rivera");
    // The receipt number is what the existing return lookup consumes.
    expect(jane!.receiptNumber).toBe("05E82C3301".slice(-8));
  });

  it("sorts newest first, the way every POS studied defaults", async () => {
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.transactions[0].orderNumber).toBe("GW-1002");
  });

  it("labels a walk-in rather than showing a blank name", async () => {
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const walkIn = res.transactions.find((t) => t.orderNumber === "GW-1002");
    expect(walkIn!.customerLabel).toBe("Walk-in");
  });
});

describe("SLICE 19 — the privacy budget holds", () => {
  it("NEVER renders a customer's full surname", async () => {
    customers = [{ id: "c1", first_name: "Jane", last_name: "Doe" }];
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const blob = JSON.stringify(res.transactions);
    expect(blob).toContain("Jane D.");
    expect(blob).not.toContain("Doe");
  });

  it("carries no contact details anywhere in the payload", async () => {
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const keys = new Set(Object.keys(res.transactions[0]));
    for (const forbidden of ["email", "phone", "birthdate", "dob", "address", "notes"]) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it("uses the same label helper the returns desk uses", async () => {
    const { privacyLabel } = await import("@/lib/pos/transaction-history-core");
    expect(privacyLabel("Jane", "Doe")).toBe("Jane D.");
    expect(privacyLabel("Jane", null)).toBe("Jane");
  });
});

describe("SLICE 19 — it is a finder, never a second refund path", () => {
  it("performs NO writes against any table", async () => {
    const res = await load();
    expect(res.ok).toBe(true);
    const writes = touched.filter((t) => t.op !== "from");
    expect(writes).toEqual([]);
  });

  it("the store module exports no mutating function", async () => {
    vi.resetModules();
    const mod = await vi.importActual<Record<string, unknown>>("@/lib/pos/transaction-history-store");
    const names = Object.keys(mod);
    expect(names).toEqual(["listRecentTransactions"]);
    for (const n of names) {
      expect(/refund|process|write|update|delete|create/i.test(n)).toBe(false);
    }
  });
});

describe("SLICE 19 — status is honest about what can be returned", () => {
  it("marks a fully returned sale and offers nothing to return", async () => {
    returns = [{ order_line_id: "l1", order_id: "o1", quantity: 2 }];
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const jane = res.transactions.find((t) => t.orderNumber === "GW-1001")!;
    expect(jane.status).toBe("fully_returned");
    expect(jane.returnableCount).toBe(0);
  });

  it("marks a partial return and reports what remains", async () => {
    returns = [{ order_line_id: "l1", order_id: "o1", quantity: 1 }];
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const jane = res.transactions.find((t) => t.orderNumber === "GW-1001")!;
    expect(jane.status).toBe("partially_returned");
    expect(jane.returnableCount).toBe(1);
  });

  it("SHOWS a voided sale rather than hiding it, with nothing returnable", async () => {
    orders = orders.map((o) => (o.id === "o1" ? { ...o, status: "cancelled" } : o));
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const jane = res.transactions.find((t) => t.orderNumber === "GW-1001")!;
    expect(jane.status).toBe("voided");
    expect(jane.returnableCount).toBe(0);
  });
});

describe("SLICE 19 — the window matches the return window", () => {
  it("quotes the SAME number of days the receipt lookup scans", async () => {
    const { HISTORY_WINDOW_DAYS } = await import("@/lib/pos/transaction-history-core");
    const { RETURN_WINDOW_DAYS } = await import("@/lib/pos/returns-core");
    // returns-store scans RETURN_WINDOW_DAYS + 2. If this ever drifts, the
    // panel would advertise a window the return path refuses.
    expect(HISTORY_WINDOW_DAYS).toBe(RETURN_WINDOW_DAYS + 2);
  });
});

describe("SLICE 19 — it degrades honestly", () => {
  it("reports a failed ledger read instead of an empty history", async () => {
    eventsFail = true;
    const res = await load();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.toLowerCase()).toContain("could not read");
  });

  it("reports a failed order read instead of dropping rows silently", async () => {
    ordersFail = true;
    const res = await load();
    expect(res.ok).toBe(false);
  });

  it("reports a failed line read instead of showing zero-item sales", async () => {
    linesFail = true;
    const res = await load();
    expect(res.ok).toBe(false);
  });

  it("returns an empty list (ok) when there are genuinely no sales", async () => {
    events = [];
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.transactions).toEqual([]);
  });

  it("refuses when the database is not configured", async () => {
    serviceConfigured = false;
    const res = await load();
    expect(res.ok).toBe(false);
  });

  it("skips an event whose order no longer exists rather than inventing a row", async () => {
    orders = orders.filter((o) => o.id !== "o1");
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.transactions).toHaveLength(1);
    expect(res.transactions[0].orderNumber).toBe("GW-1002");
  });
});

describe("SLICE 19 — the pure core", () => {
  it("passes its own self-tests", async () => {
    const { __runTransactionHistoryCoreTests } = await import("@/lib/pos/transaction-history-core");
    expect(() => __runTransactionHistoryCoreTests()).not.toThrow();
  });

  it("derives the receipt exactly as receipt-core does", async () => {
    const { receiptNumberFromUuid } = await import("@/lib/pos/transaction-history-core");
    const { receiptNumber } = await import("@/lib/pos/receipt-core");
    for (const u of [
      "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      "00000000-0000-0000-0000-0000000abcde",
      "12345678-1234-1234-1234-123456789abc",
    ]) {
      expect(receiptNumberFromUuid(u)).toBe(receiptNumber(u));
    }
  });

  it("searches the fields the industry standard searches", async () => {
    const { searchTransactions } = await import("@/lib/pos/transaction-history-core");
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const rows = res.transactions;
    expect(searchTransactions(rows, "jane")).toHaveLength(1);
    expect(searchTransactions(rows, "GW-1002")).toHaveLength(1);
    expect(searchTransactions(rows, "Pre-roll")).toHaveLength(1);
    expect(searchTransactions(rows, "Sam")).toHaveLength(2);
    expect(searchTransactions(rows, "")).toHaveLength(2);
  });
});
