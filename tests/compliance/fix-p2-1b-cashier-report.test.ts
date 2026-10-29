/**
 * tests/compliance/fix-p2-1b-cashier-report.test.ts
 *
 * Fix Phase 2.1b (G-05; finding F-01-10). Owner, message 6, verbatim:
 *   "please completely finish G-05 (2.1), the per cashier print out"
 * G-05 open part, verbatim (05-GAP-REGISTER.md, pre-2.1b): "a printable
 * per-cashier shift summary (sales, voids, no-sales, discounts, adjustments
 * by employee)".
 *
 * Proves: the pure builder (sales, tender, no-sales, adjustments, refunds by
 * the cashier who rang the sale, untraced refunds kept apart, processed-only
 * money); the range rule; the CSV (formula-safe); the page and CSV gates and
 * the 409 on an incomplete read; SOP-01 §4.35, KB and ledgers.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildCashierReport,
  checkCashierRange,
  netAfterRefunds,
  averageSale,
  cashierCsvRow,
  cashierCsv,
  untracedNote,
  CASHIER_REPORT_MAX_DAYS,
  __runCashierReportCoreTests,
  type CashierEventRow,
} from "@/lib/registers/cashier-report-core";

const read = (p: string) => readFileSync(p, "utf8");

const sale = (over: Partial<CashierEventRow> & { payload?: Record<string, unknown> } = {}): CashierEventRow => ({
  employeeId: "e1",
  registerId: "reg1",
  eventType: "sale",
  status: "processed",
  businessDay: "2026-11-02",
  orderId: "o1",
  payload: { totalMinor: 1463, subtotalMinor: 1000, taxMinor: 463, paymentMethod: "cash", lines: [{ quantity: 2 }] },
  ...over,
});

describe("Fix Phase 2.1b: the cashier report builder", () => {
  it("its own self-tests run and pass", () => {
    const r = __runCashierReportCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(20);
  });

  it("one shift per cashier per business day; processed sales only count as money", () => {
    const r = buildCashierReport({
      events: [
        sale(),
        sale({ orderId: "o2", payload: { totalMinor: 2000, subtotalMinor: 1500, taxMinor: 500, paymentMethod: "employee_tab", lines: [] } }),
        sale({ orderId: "o3", status: "exception" }),
        sale({ orderId: "o4", status: "pending" }),
        sale({ orderId: "o5", businessDay: "2026-11-03" }),
        sale({ employeeId: "e2", orderId: "o6" }),
        sale({ orderId: "o7", status: "voided_unknown" }),
      ],
      adjustments: [],
      refunds: [],
    });
    const e1 = r.cashiers.find((c) => c.employeeId === "e1");
    expect(e1?.shifts.map((s) => s.businessDay)).toEqual(["2026-11-02", "2026-11-03"]);
    const d1 = e1?.shifts[0];
    expect(d1?.saleCount).toBe(2);
    expect(d1?.grossMinor).toBe(3463);
    expect(d1?.cashGrossMinor).toBe(1463);
    expect(d1?.employeeTabMinor).toBe(2000);
    expect(d1?.unitCount).toBe(2);
    expect(d1?.exceptionCount).toBe(1);
    expect(d1?.pendingCount).toBe(1);
    expect(r.store.saleCount).toBe(4);
    expect(r.store.grossMinor).toBe(3463 + 1463 + 1463);
  });

  it("no-sales keep their reason and approver; adjustments are counted by kind", () => {
    const r = buildCashierReport({
      events: [sale({ eventType: "no_sale", orderId: null, payload: { reason: "change for customer", approvedByEmployeeId: "m1" } })],
      adjustments: [
        { employeeId: "e1", businessDay: "2026-11-02", action: "line_remove", unitsRemoved: 1, valueMinor: 500 },
        { employeeId: "e1", businessDay: "2026-11-02", action: "qty_decrease", unitsRemoved: 2, valueMinor: 300 },
        { employeeId: "e1", businessDay: "2026-11-02", action: "cart_cancel", unitsRemoved: 3, valueMinor: 900 },
        { employeeId: null, businessDay: "2026-11-02", action: "cart_cancel", unitsRemoved: 1, valueMinor: 100 },
      ],
      refunds: [],
    });
    const s = r.cashiers[0].shifts[0];
    expect(s.noSaleCount).toBe(1);
    expect(s.noSales[0]).toEqual({ reason: "change for customer", approvedByEmployeeId: "m1" });
    expect(s.adjustments).toEqual({ count: 3, qtyDecrease: 1, lineRemove: 1, cartCancel: 1, unitsRemoved: 6, valueMinor: 1700 });
    expect(r.unattributedAdjustments).toBe(1);
  });

  it("voids and returns go to the cashier who rang the sale, on the refund day; untraceable ones to nobody", () => {
    const r = buildCashierReport({
      events: [sale({ employeeId: "e2", orderId: "o9" })],
      adjustments: [],
      refunds: [
        { source: "void", orderId: "o9", businessDay: "2026-11-02", refundMinor: 1463, label: "Void" },
        { source: "return", orderId: "o-old", businessDay: "2026-11-03", refundMinor: 500, label: "Return" },
        { source: "return", orderId: null, businessDay: "2026-11-03", refundMinor: 700, label: "Online" },
      ],
      extraSaleCashiers: new Map([["o-old", "e1"]]),
    });
    const e2 = r.cashiers.find((c) => c.employeeId === "e2");
    expect(e2?.voidMinor).toBe(1463);
    expect(netAfterRefunds(e2!)).toBe(0);
    const e1 = r.cashiers.find((c) => c.employeeId === "e1");
    expect(e1?.shifts[0].businessDay).toBe("2026-11-03");
    expect(e1?.returnMinor).toBe(500);
    expect(r.untracedRefunds.map((u) => u.label)).toEqual(["Online"]);
    expect(untracedNote(r)).toMatch(/1/);
  });

  it("average sale is whole cents; zero sales is zero", () => {
    const r = buildCashierReport({ events: [sale(), sale({ orderId: "o2", payload: { totalMinor: 1000, paymentMethod: "cash" } })], adjustments: [], refunds: [] });
    expect(averageSale(r.cashiers[0])).toBe(Math.round(2463 / 2));
    expect(Number.isSafeInteger(averageSale(r.cashiers[0]))).toBe(true);
  });

  it("range: up to 31 days, From before To, real dates", () => {
    expect(CASHIER_REPORT_MAX_DAYS).toBe(31);
    expect(checkCashierRange("2026-11-01", "2026-12-01").ok).toBe(true);
    expect(checkCashierRange("2026-11-01", "2026-12-02").ok).toBe(false);
    expect(checkCashierRange("2026-11-02", "2026-11-01").ok).toBe(false);
    expect(checkCashierRange("nope", "2026-11-01").ok).toBe(false);
  });

  it("CSV: one row per shift; a name that starts like a formula is neutralised", () => {
    const r = buildCashierReport({ events: [sale()], adjustments: [], refunds: [] });
    const row = cashierCsvRow(r.cashiers[0].shifts[0], "=HYPERLINK(evil)", "Register 1");
    const csv = cashierCsv([row]);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csv).toMatch(/2026-11-02/);
  });
});

describe("Fix Phase 2.1b: page, CSV and gates", () => {
  it("the page is managers and up (inventory.manage), says when it is incomplete, and prints", () => {
    const p = read("src/app/admin/registers/cashiers/page.tsx");
    expect(p).toMatch(/requirePermission\("inventory\.manage"\)/);
    expect(p).toMatch(/This report is incomplete\. Do not file it until it loads cleanly\./);
    expect(p).toMatch(/SOP-01 §4\.35/);
  });
  it("the CSV gates the same way and refuses an incomplete read with 409", () => {
    const r = read("src/app/admin/registers/cashiers/csv/route.ts");
    expect(r).toMatch(/requirePermission\("inventory\.manage"\)/);
    expect(r).toMatch(/if \(loaded\.warnings\.length > 0\) return bad\([^\n]*409\)/);
  });
  it("the store reads in bounded ranges and uses the builder", () => {
    const s = read("src/lib/registers/cashier-report-store.ts");
    expect(s).toMatch(/import "server-only"/);
    expect(s).toMatch(/buildCashierReport\(/);
    expect(s).toMatch(/checkCashierRange\(/);
  });
});

describe("Fix Phase 2.1b: SOP, KB and ledgers (D41)", () => {
  it("SOP-01 v1.9+ has §4.35 and the revision row", () => {
    const sop = read("docs/sop/SOP-01-register-operations.md");
    expect(sop).toMatch(/\| \*\*Version\*\* \| 1\.(9|[1-9]\d)/);
    expect(sop).toMatch(/### 4\.35 Manager: the cashier shift report/);
  });
  it("the KB knows the cashier shift report", () => {
    expect(read("src/lib/admin/concierge-kb.ts")).toMatch(/Cashier shift report \(Phase 2\.1b, G-05/);
  });
  it("G-05 BUILT, F-01-10 FIXED, plan row 2.1b, concierge answers", () => {
    expect(read("docs/sop-program/05-GAP-REGISTER.md")).toMatch(/\| G-05 \|[^\n]*\*\*BUILT\*\*[^\n]*Phase 2\.1b/);
    expect(read("docs/sop-program/03-FINDINGS-LEDGER.md")).toMatch(/F-01-10[\s\S]{0,1200}FIXED \(Fix Phase 2\.1b/);
    expect(read("docs/sop-program/06-FIX-PHASE-PLAN.md")).toMatch(/\| 2\.1b \| G-05 per-cashier shift report[^\n]*\*\*BUILT\*\*/);
    expect(read("docs/sop-program/04-CONCIERGE-COVERAGE-LEDGER.md")).toMatch(/Phase 2\.1b \(G-05 per-cashier shift report\) answers/);
  });
});
