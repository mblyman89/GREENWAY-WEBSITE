/**
 * tests/compliance/d198d-ipad-returns-scan.test.ts   (D198d - iPad returns)
 *
 * Owner (2026-11-07, verbatim): "after that, please work on making the returns
 * process on the ipad register better. i can not scan a receipt qr code to find
 * the transaction, nor can i enter the receipt overlay to look for the receipt
 * by hand. please fix this for me so its easier to make a return."
 *
 * Root causes pinned here:
 *   1. Nothing on the home screen listened for a receipt scan, and the Return
 *      window never subscribed to the Socket SDK (Application Mode hands the
 *      payload to the SDK, nothing is typed) - so a scan went nowhere.
 *   2. The "receipt overlay" is the owner's name for the fun receipt name
 *      (Slice 23). The box was maxLength={8} + forced uppercase hex, so the
 *      name printed on the paper could never be typed.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runReturnScanCoreTests,
  matchReceiptName,
  parseReturnLookupInput,
  receiptCodeFromScan,
} from "@/lib/pos/return-scan-core";
import { receiptNumber } from "@/lib/pos/receipt-core";
import { searchTransactions, shapeTransaction } from "@/lib/pos/transaction-history-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SHELL = read("src/app/(site)/pos/RegisterShell.tsx");
const CORE = read("src/lib/pos/return-scan-core.ts");

// ── A minimal PostgREST-shaped fake for the REAL history store ──────────────
let ordersHaveName = true;
const selects: string[] = [];
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/pos/return-policy-store", () => ({
  getPosReturnPolicy: async () => ({ windowDays: 7, loyaltyOnly: false, excludedCategories: [] }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from(table: string) {
      let sel = "";
      let ids: string[] = [];
      const b: Record<string, unknown> = {
        select(s: string) {
          sel = s;
          if (table === "orders") selects.push(s);
          return b;
        },
        eq: () => b,
        not: () => b,
        gte: () => b,
        order: () => b,
        in(_c: string, v: string[]) {
          ids = v;
          return b;
        },
        limit() {
          return Promise.resolve({
            data: [
              { client_uuid: "11111111-2222-4333-8444-5555aaaa0001", order_id: "o1", occurred_at: new Date().toISOString(), employee_id: null },
            ],
            error: null,
          });
        },
        then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
          if (table === "orders") {
            if (sel.includes("display_name") && !ordersHaveName) {
              return resolve({ data: null, error: { message: "column orders.display_name does not exist" } });
            }
            const row: Record<string, unknown> = { id: "o1", order_number: "GW-1", status: "completed", customer_id: null, total_minor_units: 2500 };
            if (sel.includes("display_name")) row.display_name = "Purple Rain";
            return resolve({ data: ids.includes("o1") ? [row] : [], error: null });
          }
          if (table === "order_lines") return resolve({ data: [{ id: "l1", order_id: "o1", product_name: "Pre-roll", quantity: 1 }], error: null });
          return resolve({ data: [], error: null });
        },
      };
      return b;
    },
  }),
}));

async function history(q?: string) {
  vi.resetModules();
  const { listRecentTransactions } = await import("@/lib/pos/transaction-history-store");
  return listRecentTransactions(q);
}

beforeEach(() => {
  ordersHaveName = true;
  selects.length = 0;
});

describe("D198d pure core: what the cashier scanned or typed", () => {
  it("self-tests pass", () => {
    const r = __runReturnScanCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(34);
  });

  it("the receipt QR payload is EXACTLY what receiptNumber() prints, and it round-trips", () => {
    const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const printed = receiptNumber(uuid);
    expect(receiptCodeFromScan(printed)).toBe(printed);
    expect(receiptCodeFromScan(uuid)).toBe(printed);
    const p = parseReturnLookupInput(printed.toLowerCase());
    expect(p.kind === "receipt" && p.code).toBe(printed);
  });

  it("the fun receipt name (the 'receipt overlay') is a name search, never mangled into hex", () => {
    const p = parseReturnLookupInput("Purple Rain");
    expect(p).toEqual({ kind: "name", query: "Purple Rain" });
  });

  it("an ID or a product barcode is never treated as a receipt scan", () => {
    expect(receiptCodeFromScan("@\n\u001e\rANSI 636045090002DL00410278ZW03190008DLDAQWDL")).toBeNull();
    expect(receiptCodeFromScan("012345678905")).toBeNull();
  });

  it("a recycled name is never auto-picked", () => {
    const rows = [
      { receiptNumber: "AAAA0001", displayName: "Blue Moon", returnableCount: 1, status: "returnable" },
      { receiptNumber: "AAAA0002", displayName: "Blue Moon", returnableCount: 1, status: "returnable" },
    ];
    expect(matchReceiptName(rows, "blue moon").kind).toBe("many");
  });

  it("the core has NO imports (bundle-safe for the iPad)", () => {
    expect(CORE).not.toMatch(/^import /m);
  });
});

describe("D198d history rows carry the receipt name", () => {
  it("shapeTransaction keeps the name; search finds it", () => {
    const row = shapeTransaction({
      saleClientUuid: "11111111-2222-4333-8444-5555aaaa0001",
      orderId: "o1",
      orderNumber: "GW-1",
      occurredAtIso: new Date().toISOString(),
      orderStatus: "completed",
      totalMinor: 100,
      customerFirst: null,
      customerLast: null,
      employeeName: null,
      lines: [{ productName: "Pre-roll", quantity: 1, returnedQuantity: 0 }],
      displayName: "  Purple Rain ",
    });
    expect(row.displayName).toBe("Purple Rain");
    expect(searchTransactions([row], "purple").length).toBe(1);
  });

  it("the REAL store reads orders.display_name and returns it on the row", async () => {
    const r = await history("purple");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(selects[0]).toContain("display_name");
    expect(r.transactions[0]?.displayName).toBe("Purple Rain");
  });

  it("if display_name were missing, the store retries without it instead of failing the panel", async () => {
    ordersHaveName = false;
    const r = await history();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(selects.length).toBe(2);
    expect(selects[1]).not.toContain("display_name");
    expect(r.transactions[0]?.displayName ?? null).toBeNull();
  });
});

describe("D198d the register wiring (RegisterShell)", () => {
  it("the home screen hears a receipt scan from BOTH scanner paths and opens Return pre-filled", () => {
    expect(SHELL).toContain("receiptCodeFromScan(payload)");
    expect(SHELL).toMatch(/const homeSocket = useSocketScanner\(/);
    expect(SHELL).toMatch(/homeWedgeRef/);
    expect(SHELL).toContain("onReceiptScan={(code) => {");
    expect(SHELL).toContain("setReturnsPrefill(code);");
    expect(SHELL).toContain("initialReceipt={returnsPrefill}");
  });

  it("a home-screen scan stands down while any other window is open", () => {
    expect(SHELL).toMatch(/receiptScanEnabled=\{\s*!returnsOpen && !noSaleOpen && !dayReportOpen && !voidOpen && !pickupOpen && !tillMode/);
  });

  it("the Return window subscribes to the Socket SDK and the keyboard wedge", () => {
    expect(SHELL).toMatch(/const returnsSocket = useSocketScanner\(/);
    expect(SHELL).toMatch(/returnsWedgeRef/);
    expect(SHELL).toContain("takeReceiptScan(initialReceipt)");
  });

  it("the box is no longer an 8-character hex-only field", () => {
    const i = SHELL.indexOf('id="pos-return-receipt"');
    expect(i).toBeGreaterThan(0);
    const box = SHELL.slice(i, i + 1400);
    expect(box).toContain("maxLength={RETURN_INPUT_MAX_CHARS}");
    expect(box).not.toContain("maxLength={8}");
    expect(box).not.toContain("toUpperCase()");
    expect(SHELL).toContain("Or type the receipt name or number");
  });

  it("a name only FINDS the sale - it then runs the same receipt lookup (one refund path)", () => {
    const i = SHELL.indexOf("const findByName = async");
    const fn = SHELL.slice(i, i + 3000);
    expect(fn).toContain("historyRequestPath(query)");
    expect(fn).toContain("matchReceiptName(rows, query)");
    expect(fn).toContain("await lookup(verdict.row.receiptNumber)");
    expect(fn).not.toContain('method: "POST"');
  });

  it("Return an item is one tap from home, not only under MORE", () => {
    expect(SHELL).toContain("📦 Return an item — find a receipt");
  });

  it("history rows show the receipt name next to the number", () => {
    expect(SHELL).toContain("{t.displayName ? `${t.displayName} · ` : \"\"}");
  });
});

describe("D198d SOP + concierge + verbatim", () => {
  it("SOP-01 4.23 explains scan-from-home and typing the receipt name (v1.24)", () => {
    const sop = read("docs/sop/SOP-01-register-operations.md");
    // D211 moved the current version to 1.25; 1.24 stays named in the version history line.
    expect(sop).toMatch(/\| \*\*Version\*\* \| 1\.2[4-9]|1\.24 \(draft for owner review; owner message 2026-11-07 \(iPad returns, D198d\)/);
    expect(sop).toContain("Fastest: scan the QR code on the customer's receipt from the home screen.");
    expect(sop).toContain("Or type the receipt name or number");
    expect(sop).toContain("| 1.24 draft | 2026-11-07 |");
  });

  it("the concierge knows", () => {
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("iPad returns: scan the receipt or type its name (D198d");
  });

  it("the owner's words are recorded verbatim", () => {
    expect(read("docs/sop-program/00-OWNER-REQUEST-VERBATIM.md")).toContain(
      "i can not scan a receipt qr code to find the transaction, nor can i enter the receipt overlay to look for the receipt by hand",
    );
  });

  it("the self-test is registered in the pure harness", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("return-scan-core", __runReturnScanCoreTests(), 34)');
  });
});
