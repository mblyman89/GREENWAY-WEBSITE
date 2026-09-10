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
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

type TxRow = { orderNumber: string; items: string[]; searchTerms: string[] };

let eventsFail = false;
let ordersFail = false;
let linesFail = false;
let serviceConfigured = true;

/** Every table the store touched — proves it never wrote. */
const touched: { table: string; op: string }[] = [];

/** Every `.limit(n)` the store asked `pos_sale_events` for, in order. */
const limitsAsked: number[] = [];

/** The route is device-authenticated; that is tested elsewhere. Let it pass. */
vi.mock("@/lib/pos/sync-store", () => ({
  authenticateDevice: async () => ({ ok: true, deviceId: "d1", storeId: "s1" }),
}));

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
        limit(n: number) {
          if (table === "pos_sale_events") {
            // Record the ceiling the store asked for. Browsing and searching
            // must NOT ask for the same number of rows, and the only way to
            // prove that is to watch the argument the store actually passes.
            limitsAsked.push(n);
            if (eventsFail) return Promise.resolve({ data: null, error: { message: "ledger read failed" } });
            const matching = events.filter(
              (e) => e.event_type === "sale" && e.status === "processed" && e.order_id,
            );
            // HONOUR the limit, exactly as PostgREST does. A fake that returns
            // everything regardless would make the truncation path untestable
            // and would quietly hide a wrong scan ceiling.
            return Promise.resolve({ data: matching.slice(0, n), error: null });
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

// Mirrors the store's real signature: an absent, null or blank query all mean
// "browse". Narrowing this to `string | undefined` here would let a null-safety
// regression in the store go unnoticed by this suite.
async function load(query?: string | null) {
  vi.resetModules();
  const { listRecentTransactions } = await import("@/lib/pos/transaction-history-store");
  return listRecentTransactions(query);
}

const NOW = Date.now();
const iso = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();

beforeEach(() => {
  serviceConfigured = true;
  eventsFail = false;
  ordersFail = false;
  linesFail = false;
  touched.length = 0;
  limitsAsked.length = 0;

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

// ─────────────────────────────────────────────────────────────────────────────
// BUG REPORT (owner, at the register):
//
//   "On the register, when I open transaction history, I am unable to use the
//    search bar. I tried typing in it and pressing enter, that did not do
//    anything. I also tried scanning a receipt, that also did not do anything."
//
// Recon found FOUR separate defects behind those two symptoms. Each one gets
// its own describe below so a regression names itself.
// ─────────────────────────────────────────────────────────────────────────────

describe("BUG — defects 1 & 2: Enter did nothing, typed OR scanned", () => {
  // A hardware receipt scanner is a keyboard wedge: it types the characters
  // and then sends Enter. That Enter is the ENTIRE "I am done" signal. The
  // receipt box had onChange but no onKeyDown, and there is no wrapping
  // <form>, so the keystrokes landed and then nothing happened — which reads
  // at the counter as "the scanner is broken" when the scan worked perfectly.
  const shell = readFileSync(join(process.cwd(), "src/app/pos/RegisterShell.tsx"), "utf8");
  const modal = shell.slice(shell.indexOf("function ReturnsModal("));

  it("the returns receipt input HANDLES Enter", () => {
    // Find the input bound to the receipt state, then prove a key handler
    // exists inside that element rather than merely somewhere in the file.
    const at = modal.indexOf('value={receipt}');
    expect(at).toBeGreaterThan(-1);
    const el = modal.slice(at, modal.indexOf("/>", at));
    expect(el).toContain("onKeyDown");
    expect(el).toContain('e.key !== "Enter"');
    expect(el).toContain("lookup()");
  });

  it("Enter runs the SAME lookup the Find button runs — not a second path", () => {
    // Two code paths for "find this receipt" would drift. There is one.
    const at = modal.indexOf('value={receipt}');
    const el = modal.slice(at, modal.indexOf("/>", at));
    expect(/void lookup\(\)/.test(el)).toBe(true);
  });

  it("the history search input also handles Enter", () => {
    const at = modal.indexOf('placeholder="Search name, receipt, item or staff"');
    expect(at).toBeGreaterThan(-1);
    const el = modal.slice(at, modal.indexOf("/>", at));
    expect(el).toContain("onKeyDown");
    expect(el).toContain("loadHistory(historyQuery)");
  });

  it("nothing else could have rescued the missing Enter", () => {
    // SaleFlow's document-level wedge listeners deliberately stand down over
    // INPUT/TEXTAREA/SELECT so manual typing still works. That is correct —
    // and it is precisely why the modal had to handle its own Enter.
    const flow = readFileSync(join(process.cwd(), "src/app/pos/SaleFlow.tsx"), "utf8");
    expect(flow).toMatch(/INPUT/);
    // And the modal genuinely has no <form> doing an implicit submit. Ignore
    // comment lines — the fix's own comment mentions the word, and matching
    // prose would make this assertion pass or fail on wording, not on code.
    const code = shell
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    expect(/<form[\s>]/.test(code)).toBe(false);
  });
});

describe("BUG — defect 3: search could not see past the item preview", () => {
  it("finds a product that is BEYOND the 3-item display preview", async () => {
    const { HISTORY_ITEMS_PREVIEW } = await import("@/lib/pos/transaction-history-core");
    // A seven-item basket. Items 4-7 were invisible to search, so the box
    // said "Nothing matches" for a product that was on the receipt.
    lines = [
      { id: "l1", order_id: "o1", product_name: "Blue Dream 1g", quantity: 1 },
      { id: "l1b", order_id: "o1", product_name: "Sour Diesel 1g", quantity: 1 },
      { id: "l1c", order_id: "o1", product_name: "Gelato 1g", quantity: 1 },
      { id: "l1d", order_id: "o1", product_name: "Wedding Cake 1g", quantity: 1 },
      { id: "l1e", order_id: "o1", product_name: "Northern Lights 1g", quantity: 1 },
      { id: "l1f", order_id: "o1", product_name: "Zkittlez 1g", quantity: 1 },
      { id: "l1g", order_id: "o1", product_name: "Tangie Cart 1g", quantity: 1 },
      { id: "l2", order_id: "o2", product_name: "Pre-roll", quantity: 1 },
    ];
    const res = await load("Zkittlez");
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const jane = res.transactions.find((t) => t.orderNumber === "GW-1001");
    expect(jane).toBeDefined();
    // Prove the premise: Zkittlez really is past the preview.
    expect(jane!.items).toHaveLength(HISTORY_ITEMS_PREVIEW);
    expect(jane!.items).not.toContain("Zkittlez 1g");
    // ...and it was still found.
    expect(res.transactions).toHaveLength(1);
  });

  it("carries EVERY item name in searchTerms, lowercased, for search only", async () => {
    lines = [
      { id: "l1", order_id: "o1", product_name: "Blue Dream 1g", quantity: 1 },
      { id: "l1b", order_id: "o1", product_name: "Sour Diesel 1g", quantity: 1 },
      { id: "l1c", order_id: "o1", product_name: "Gelato 1g", quantity: 1 },
      { id: "l1d", order_id: "o1", product_name: "Wedding Cake 1g", quantity: 1 },
      { id: "l2", order_id: "o2", product_name: "Pre-roll", quantity: 1 },
    ];
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const jane = res.transactions.find((t) => t.orderNumber === "GW-1001")!;
    expect(jane.searchTerms).toHaveLength(4);
    expect(jane.searchTerms).toContain("wedding cake 1g");
    // Lowercased once at shape time so the filter does not re-lower on every
    // keystroke, and never rendered — display uses `items`.
    for (const t of jane.searchTerms) expect(t).toBe(t.toLowerCase());
  });

  it("searchTerms is NOT the display list — the preview stays short", async () => {
    lines = [
      { id: "l1", order_id: "o1", product_name: "AAA", quantity: 1 },
      { id: "l1b", order_id: "o1", product_name: "BBB", quantity: 1 },
      { id: "l1c", order_id: "o1", product_name: "CCC", quantity: 1 },
      { id: "l1d", order_id: "o1", product_name: "DDD", quantity: 1 },
      { id: "l2", order_id: "o2", product_name: "Pre-roll", quantity: 1 },
    ];
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const jane = res.transactions.find((t) => t.orderNumber === "GW-1001")!;
    expect(jane.items).toHaveLength(3);
    expect(jane.moreCount).toBe(1);
    expect(jane.searchTerms.length).toBeGreaterThan(jane.items.length);
  });

  it("the register no longer re-filters client-side over what it holds", () => {
    const shell = readFileSync(join(process.cwd(), "src/app/pos/RegisterShell.tsx"), "utf8");
    // Re-running searchTransactions in the browser would re-introduce the
    // "only searches the 50 rows already fetched" bug on top of the fix.
    expect(shell.includes("searchTransactions")).toBe(false);
  });
});

describe("BUG — defect 4: search only ever covered the newest 50 rows", () => {
  /** Build `n` sales, oldest first, so row 1 is the furthest back. */
  function manySales(n: number) {
    events = [];
    orders = [];
    lines = [];
    for (let i = 1; i <= n; i++) {
      const id = `x${i}`;
      events.push({
        client_uuid: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
        order_id: id,
        // i=1 is the OLDEST (largest minutes ago).
        occurred_at: iso(n - i + 1),
        employee_id: "e1",
        event_type: "sale",
        status: "processed",
      });
      orders.push({ id, order_number: `GW-${2000 + i}`, status: "completed", customer_id: null, total_minor_units: 100 });
      lines.push({ id: `ln${i}`, order_id: id, product_name: i === 1 ? "Needle Haystack OG" : "Filler", quantity: 1 });
    }
  }

  it("finds a sale that is FAR older than the 50-row display cap", async () => {
    const { TRANSACTION_HISTORY_LIMIT } = await import("@/lib/pos/transaction-history-core");
    // 300 sales. The target is the oldest one — well past row 50, which at
    // this shop's volume is roughly half a day. This is the exact scenario
    // the owner hit: a customer from yesterday, sale still returnable.
    manySales(300);
    expect(300).toBeGreaterThan(TRANSACTION_HISTORY_LIMIT);

    const res = await load("Needle Haystack");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.transactions).toHaveLength(1);
    expect(res.transactions[0].orderNumber).toBe("GW-2001");
  });

  it("FILTERS BEFORE CAPPING — the 50 rows are the 50 newest MATCHES", async () => {
    const { TRANSACTION_HISTORY_LIMIT } = await import("@/lib/pos/transaction-history-core");
    // 200 sales that ALL match. Capping first then filtering would also
    // return 50 here, so the distinguishing fact is WHICH 50: filter-first
    // returns the newest matches, and the oldest sale must be absent.
    manySales(200);
    lines = lines.map((l) => ({ ...l, product_name: "Universal Match" }));

    const res = await load("Universal Match");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.transactions).toHaveLength(TRANSACTION_HISTORY_LIMIT);
    // Newest first: GW-2200 down to GW-2151.
    expect(res.transactions[0].orderNumber).toBe("GW-2200");
    const numbers = res.transactions.map((t) => t.orderNumber);
    expect(numbers).not.toContain("GW-2001");
  });

  it("widens the DATABASE scan when searching, and not when browsing", async () => {
    // The proof that search is server-side: the store asks the database for a
    // different number of rows. If both were equal, search would be a client
    // illusion over whatever the browse read happened to return.
    await load();
    const browsing = limitsAsked[0];
    limitsAsked.length = 0;
    await load("Blue Dream");
    const searching = limitsAsked[0];
    expect(searching).toBeGreaterThan(browsing);
  });

  it("a query below SEARCH_MIN_CHARS is NOT a search and stays cheap", async () => {
    const { SEARCH_MIN_CHARS } = await import("@/lib/pos/transaction-history-core");
    await load();
    const browsing = limitsAsked[0];
    limitsAsked.length = 0;
    // One keystroke must not blank the list out mid-type, nor trigger the
    // expensive whole-window read.
    await load("B".repeat(SEARCH_MIN_CHARS - 1));
    expect(limitsAsked[0]).toBe(browsing);
    const res = await load("B".repeat(SEARCH_MIN_CHARS - 1));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.transactions).toHaveLength(2);
  });

  it("EXACTLY SEARCH_MIN_CHARS is a search — the boundary is inclusive", async () => {
    const { SEARCH_MIN_CHARS } = await import("@/lib/pos/transaction-history-core");
    await load();
    const browsing = limitsAsked[0];
    limitsAsked.length = 0;
    await load("B".repeat(SEARCH_MIN_CHARS));
    // Off-by-one here would make the shortest real search silently browse.
    expect(limitsAsked[0]).toBeGreaterThan(browsing);
  });

  it("the query is TRIMMED before the length test, not after", async () => {
    const { SEARCH_MIN_CHARS } = await import("@/lib/pos/transaction-history-core");
    await load();
    const browsing = limitsAsked[0];
    limitsAsked.length = 0;
    // A scanner or a stray space must not turn one character into a search.
    await load(" " + "B".repeat(SEARCH_MIN_CHARS - 1) + " ");
    expect(limitsAsked[0]).toBe(browsing);
  });

  it("a padded query still matches — leading/trailing space is ignored", async () => {
    const res = await load("  Pre-roll  ");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.transactions).toHaveLength(1);
    expect(res.transactions[0].orderNumber).toBe("GW-1002");
  });

  it("whitespace-only input is browsing, not a search for spaces", async () => {
    const res = await load("   ");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.transactions).toHaveLength(2);
  });

  it("an omitted query behaves exactly like browsing (back-compatible)", async () => {
    const a = await load();
    const b = await load(undefined);
    const c = await load(null);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });

  it("a search that genuinely matches nothing returns an empty OK list", async () => {
    const res = await load("zzz-no-such-product");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.transactions).toEqual([]);
  });
});

describe("BUG — defect 4b: 'we stopped looking' is never shown as 'nothing exists'", () => {
  function manySales(n: number) {
    events = [];
    orders = [];
    lines = [];
    for (let i = 1; i <= n; i++) {
      const id = `x${i}`;
      events.push({
        client_uuid: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
        order_id: id,
        occurred_at: iso(n - i + 1),
        employee_id: "e1",
        event_type: "sale",
        status: "processed",
      });
      orders.push({ id, order_number: `GW-${2000 + i}`, status: "completed", customer_id: null, total_minor_units: 100 });
      lines.push({ id: `ln${i}`, order_id: id, product_name: "Filler", quantity: 1 });
    }
  }

  it("reports scanTruncated=false on an ordinary day", async () => {
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.scanTruncated).toBe(false);
  });

  it("reports scanTruncated=true when the BROWSE scan hits its ceiling", async () => {
    // Exactly at the ceiling means there may be more we never looked at.
    manySales(400);
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.scanTruncated).toBe(true);
  });

  it("one short of the ceiling is NOT truncated", async () => {
    // The boundary matters: >= vs > here is the difference between crying
    // wolf on every busy day and hiding a genuinely partial scan.
    manySales(399);
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.scanTruncated).toBe(false);
  });

  it("reports scanTruncated=false when a search comfortably fits the window", async () => {
    manySales(400);
    const res = await load("Filler");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // 400 events is nowhere near the 5000-event search ceiling, so the search
    // genuinely saw the whole window and must NOT cry truncation.
    expect(res.scanTruncated).toBe(false);
  });

  it("an empty window is complete, not truncated", async () => {
    events = [];
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.scanTruncated).toBe(false);
  });

  it("the register SHOWS the truncation warning to staff", () => {
    const shell = readFileSync(join(process.cwd(), "src/app/pos/RegisterShell.tsx"), "utf8");
    expect(shell).toContain("historyTruncated");
    expect(shell).toContain("use its receipt number");
  });

  it("the empty state distinguishes 'no match' from 'no sales at all'", () => {
    const shell = readFileSync(join(process.cwd(), "src/app/pos/RegisterShell.tsx"), "utf8");
    expect(shell).toContain("Nothing matches");
    expect(shell).toContain("No register sales in the last");
  });
});

describe("BUG — the API carries the query END TO END, not just in source", () => {
  /** Call the REAL route handler with a real URL. */
  async function callRoute(url: string) {
    vi.resetModules();
    const { GET } = await import("@/app/api/pos/transactions/route");
    const { NextRequest } = await import("next/server");
    const res = await GET(new NextRequest(url, { headers: { "x-pos-device-id": "d1", "x-pos-device-key": "k1" } }));
    return (await res.json()) as { transactions?: TxRow[]; scanTruncated?: boolean; error?: string };
  }

  it("?q= actually filters the RESPONSE the register receives", async () => {
    const json = await callRoute("http://localhost/api/pos/transactions?q=Pre-roll");
    expect(json.error).toBeUndefined();
    expect(json.transactions).toHaveLength(1);
    expect(json.transactions![0].orderNumber).toBe("GW-1002");
  });

  it("no ?q= returns the whole recent list", async () => {
    const json = await callRoute("http://localhost/api/pos/transactions");
    expect(json.transactions).toHaveLength(2);
  });

  it("a URL-encoded query survives decoding intact", async () => {
    lines = [
      { id: "l1", order_id: "o1", product_name: "Tom & Jerry #4 OG", quantity: 1 },
      { id: "l2", order_id: "o2", product_name: "Pre-roll", quantity: 1 },
    ];
    // "&" and "#" are exactly the characters that silently truncate a URL if
    // the client concatenates instead of encoding.
    const json = await callRoute(
      `http://localhost/api/pos/transactions?q=${encodeURIComponent("Tom & Jerry #4")}`,
    );
    expect(json.transactions).toHaveLength(1);
    expect(json.transactions![0].orderNumber).toBe("GW-1001");
  });

  it("the response carries scanTruncated to the register", async () => {
    const json = await callRoute("http://localhost/api/pos/transactions");
    expect(json.scanTruncated).toBe(false);
  });

  it("a TRUNCATED scan reaches the register as true, not silently dropped", async () => {
    // Fill the browse ceiling exactly. If the route hardcodes false — or
    // omits the field — the panel shows "nothing found" for a sale it simply
    // never looked at. This is the assertion that makes the field load-bearing.
    events = [];
    orders = [];
    lines = [];
    for (let i = 1; i <= 400; i++) {
      const id = `t${i}`;
      events.push({
        client_uuid: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
        order_id: id,
        occurred_at: iso(401 - i),
        employee_id: "e1",
        event_type: "sale",
        status: "processed",
      });
      orders.push({ id, order_number: `GW-${3000 + i}`, status: "completed", customer_id: null, total_minor_units: 100 });
      lines.push({ id: `tl${i}`, order_id: id, product_name: "Filler", quantity: 1 });
    }
    const json = await callRoute("http://localhost/api/pos/transactions");
    expect(json.scanTruncated).toBe(true);
  });

  it("a failed read is a 503 with an error, never an empty list", async () => {
    eventsFail = true;
    const json = await callRoute("http://localhost/api/pos/transactions?q=anything");
    expect(json.transactions).toBeUndefined();
    expect(typeof json.error).toBe("string");
  });
});

describe("BUG — the API carries the query, and the panel sends it", () => {
  it("GET /api/pos/transactions reads ?q= and passes it to the store", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/pos/transactions/route.ts"), "utf8");
    expect(route).toContain('searchParams.get("q")');
    expect(route).toContain("listRecentTransactions(query)");
  });

  it("the route returns scanTruncated so the UI can be honest", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/pos/transactions/route.ts"), "utf8");
    expect(route).toContain("scanTruncated");
  });

  it("the register builds a URL that CARRIES the query", async () => {
    const { historyRequestPath } = await import("@/lib/pos/transaction-history-core");
    // Behaviour, not source text: the query must survive into the URL.
    expect(historyRequestPath("Blue Dream")).toBe("/api/pos/transactions?q=Blue%20Dream");
    expect(historyRequestPath("Blue Dream")).toContain("q=");
  });

  it("the URL is ENCODED, so & and # cannot truncate the search", async () => {
    const { historyRequestPath } = await import("@/lib/pos/transaction-history-core");
    const path = historyRequestPath("Tom & Jerry #4");
    // Raw & or # would end the parameter early and the server would search
    // for something the customer never typed.
    expect(path).not.toContain("& ");
    expect(path).not.toContain("#");
    expect(path).toContain(encodeURIComponent("Tom & Jerry #4"));
    // And it round-trips back to exactly what was typed.
    const q = new URL(path, "http://x").searchParams.get("q");
    expect(q).toBe("Tom & Jerry #4");
  });

  it("an empty or whitespace box asks for the plain list, not '?q='", async () => {
    const { historyRequestPath } = await import("@/lib/pos/transaction-history-core");
    expect(historyRequestPath("")).toBe("/api/pos/transactions");
    expect(historyRequestPath("   ")).toBe("/api/pos/transactions");
  });

  it("the register uses that pure builder rather than its own string", () => {
    const shell = readFileSync(join(process.cwd(), "src/app/pos/RegisterShell.tsx"), "utf8");
    expect(shell).toContain("historyRequestPath(query)");
  });

  it("the response reader keeps scanTruncated=true and never invents one", async () => {
    const { readHistoryResponse } = await import("@/lib/pos/transaction-history-core");
    expect(readHistoryResponse({ transactions: [], scanTruncated: true }).scanTruncated).toBe(true);
    expect(readHistoryResponse({ transactions: [], scanTruncated: false }).scanTruncated).toBe(false);
    // Absent means "the server did not say", which is not a warning.
    expect(readHistoryResponse({ transactions: [] }).scanTruncated).toBe(false);
    // Only a real boolean true counts — a truthy string must not warn.
    expect(readHistoryResponse({ transactions: [], scanTruncated: "yes" }).scanTruncated).toBe(false);
    expect(readHistoryResponse(null).scanTruncated).toBe(false);
    expect(readHistoryResponse(null).transactions).toEqual([]);
  });

  it("the register uses that pure reader rather than reading json itself", () => {
    const shell = readFileSync(join(process.cwd(), "src/app/pos/RegisterShell.tsx"), "utf8");
    expect(shell).toContain("readHistoryResponse(json)");
    expect(shell).toContain("setHistoryTruncated(parsed.scanTruncated)");
  });

  it("typing is DEBOUNCED so a name is one query, not nine", () => {
    const shell = readFileSync(join(process.cwd(), "src/app/pos/RegisterShell.tsx"), "utf8");
    expect(shell).toContain("HISTORY_SEARCH_DEBOUNCE_MS");
    expect(shell).toContain("setTimeout");
    expect(shell).toContain("clearTimeout");
  });

  it("a slow earlier response cannot overwrite a newer one", () => {
    const shell = readFileSync(join(process.cwd(), "src/app/pos/RegisterShell.tsx"), "utf8");
    // Out-of-order autocomplete: typing "kush" then the late "ku" response
    // landing last would show the wrong results with the right text in the box.
    expect(shell).toContain("historySeqRef");
    expect(shell).toContain("a newer search already won");
  });

  it("the debounce is a human-perceptible-but-short interval", async () => {
    const { HISTORY_SEARCH_DEBOUNCE_MS } = await import("@/lib/pos/transaction-history-core");
    expect(HISTORY_SEARCH_DEBOUNCE_MS).toBeGreaterThan(0);
    // Above ~400ms staff start pressing keys again thinking it is broken.
    expect(HISTORY_SEARCH_DEBOUNCE_MS).toBeLessThanOrEqual(400);
  });
});

describe("BUG — the fix did not weaken any existing property", () => {
  it("searching still performs NO writes", async () => {
    await load("Blue Dream");
    expect(touched.filter((t) => t.op !== "from")).toEqual([]);
  });

  it("privacy holds on a search result too", async () => {
    const res = await load("Jane");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const blob = JSON.stringify(res.transactions);
    expect(blob).toContain("Jane D.");
    expect(blob).not.toContain("Doe");
  });

  it("searchTerms never leaks a surname into the payload", async () => {
    customers = [{ id: "c1", first_name: "Jane", last_name: "Doe" }];
    const res = await load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const t of res.transactions) {
      for (const term of t.searchTerms) expect(term).not.toContain("doe");
    }
  });

  it("a failed read during a SEARCH is still reported as a failure", async () => {
    eventsFail = true;
    const res = await load("Blue Dream");
    expect(res.ok).toBe(false);
  });

  it("the store still exports exactly one function", async () => {
    vi.resetModules();
    const mod = await vi.importActual<Record<string, unknown>>("@/lib/pos/transaction-history-store");
    expect(Object.keys(mod)).toEqual(["listRecentTransactions"]);
  });
});
