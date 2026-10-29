/**
 * tests/compliance/fix-p2-6b-eod-sheet.test.ts
 *
 * Fix Phase 2.6b (G-15 end-of-day deposit sheet; F-03-5, F-03-6, F-03-7,
 * F-03-8, F-00-8). Owner message 4, verbatim: "…then deposit bag screen and
 * end-of-day sheet." Owner's original request: "There should be an end of day
 * spreadsheet that one person completes before close, and the morning
 * employee recounts and verifies the amount before sealing the bag" and
 * "closing shift and closing day reports are built and can be exported and
 * printed."
 *
 * What this file proves:
 *   1. The pure sheet: deposit by till (closing − float + drops), cash sales
 *      by tender, refunds split by where they were paid, net cash, the bag
 *      by denomination, the blind night figure, the workbook spec.
 *   2. eodData RETURNS every failed read (F-03-7) instead of showing "no
 *      drawers" or zeros, against a fake database.
 *   3. The page: date picker, a bad ?day= refused (F-03-8), the deposit,
 *      cash-check and bag sections, two signature lines, export links that
 *      switch off when a read failed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── fake database for eodData ───────────────────────────────────────────────
type Res = { data: unknown; error: { message: string; code?: string } | null };
const TABLES: Record<string, Res> = {};
function builder(table: string) {
  const res = () => TABLES[table] ?? { data: [], error: null };
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "in", "gte", "lte", "limit", "range"]) b[m] = () => b;
  b.then = (ok: (r: Res) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, ko);
  return b;
}
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ from: (t: string) => builder(t) }) }));
let REFUNDS: { refunds: unknown[]; complete: boolean; problem: string | null; returnsAttributable: boolean } = {
  refunds: [],
  complete: true,
  problem: null,
  returnsAttributable: true,
};
vi.mock("@/lib/registers/drawer-figure-store", () => ({ readDayRefunds: async () => REFUNDS }));
let BAG: unknown = { ok: true, bag: null };
vi.mock("@/lib/registers/deposit-bag-store", () => ({ bagDetailForDay: async () => BAG }));
vi.mock("@/lib/staffing/store", () => ({ listEmployees: async () => [{ id: "e1", full_name: "Night Closer" }, { id: "e2", full_name: "Morning Opener" }] }));

import {
  buildEodSheet,
  summarizeCashSales,
  splitRefunds,
  denomsFromJson,
  denomGridRows,
  eodSheetWorkbook,
  NO_BAG_YET,
  BAG_SCHEMA_MISSING,
  __runEodSheetTests,
  type SheetBagInput,
} from "@/lib/registers/eod-sheet-core";
import { eodData } from "@/lib/registers/eod-store";
import { type DaySummary } from "@/lib/pos/day-report-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const PAGE = "src/app/admin/registers/eod/page.tsx";
const ROUTE = "src/app/admin/registers/eod/export/route.ts";
const STORE = "src/lib/registers/eod-store.ts";

const SALES0: DaySummary = {
  saleCount: 0, grossMinor: 0, subtotalMinor: 0, taxMinor: 0, medicalSaleCount: 0, medicalSavingsMinor: 0,
  roundedSaleCount: 0, roundingMinor: 0, noSaleCount: 0, exceptionCount: 0, pendingCount: 0,
};
const SESSIONS = [
  { id: "s1", registerName: "Sales Register 1", status: "reconciled", openingMinor: 16750, closingMinor: 96750 },
  { id: "s2", registerName: "Sales Register 2", status: "closed", openingMinor: 16750, closingMinor: 56750 },
];
const sale = (method: string, total: number, status = "processed", adj = 0) => ({
  eventType: "sale",
  status,
  payload: { paymentMethod: method, totalMinor: total, ...(adj ? { rounding: { adjustmentMinor: adj } } : {}) },
});
const BASE = {
  businessDay: "2026-11-02",
  sessions: SESSIONS,
  drops: [{ sessionId: "s1", amountMinor: 50000 }],
  saleEvents: [sale("cash", 100000, "processed", 2), sale("cash", 72000, "processed", -2)],
  refunds: [] as { source: "void" | "return"; refundMinor: number; paidFrom: "drawer" | "safe" | null }[],
  bag: null as SheetBagInput | null,
  bagMissingSchema: false,
  readProblems: [] as string[],
};
const BAG_ROW: SheetBagInput = {
  id: "b1", bagNo: "A100", businessDay: "2026-11-02", status: "undeclared", amountMinor: null,
  nightCountMinor: 170000, nightCountedBy: "e1", nightCountedAt: "2026-11-03T05:00:00Z", expectedMinor: 170000, nightNote: null,
  morningCountMinor: null, morningCountedBy: null, morningCountedAt: null, varianceReason: null,
  sealedAt: null, sealedBy: null, sealJournalId: null, bankedOn: null, bankedBy: null, bankNote: null, depositConfirmedOn: null,
  nightDenoms: denomsFromJson({ hundreds: 17 }), morningDenoms: null,
  nightCountedByName: "Night Closer", morningCountedByName: null, sealedByName: null,
};

// ── 1. pure ────────────────────────────────────────────────────────────────
describe("2.6b · the pure end-of-day sheet", () => {
  it("embedded self-tests pass", () => {
    const r = __runEodSheetTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(28);
  });

  it("deposit by till = closing − float, plus drops (SOP-03 §4.1, F-03-5)", () => {
    const s = buildEodSheet(BASE);
    expect(s.deposit.lines.map((l) => [l.registerName, l.takingsMinor, l.toBagMinor])).toEqual([
      ["Sales Register 1", 80000, 130000],
      ["Sales Register 2", 40000, 40000],
    ]);
    expect(s.deposit.expectedMinor).toBe(170000);
  });

  it("cash sales count cash tender only, with rounding; pending, refused, tab and other tender add no cash", () => {
    const c = summarizeCashSales([
      sale("cash", 1000, "processed", 3),
      sale("cash", 999, "pending"),
      sale("cash", 777, "exception"),
      sale("employee_tab", 500),
      sale("debit", 400),
    ]);
    expect(c).toEqual({ cashSaleCount: 1, cashSalesMinor: 1003, employeeTabCount: 1, employeeTabMinor: 500, otherTenderCount: 1, otherTenderMinor: 400 });
  });

  it("refunds come off the cash: drawer refunds reduce net cash, safe refunds do not (F-03-6)", () => {
    const s = buildEodSheet({
      ...BASE,
      refunds: [
        { source: "void", refundMinor: 2000, paidFrom: "drawer" },
        { source: "return", refundMinor: 1500, paidFrom: "drawer" },
        { source: "return", refundMinor: 900, paidFrom: "safe" },
      ],
    });
    expect(s.cash.cashSalesMinor).toBe(172000);
    expect(s.refunds.summary).toEqual({ voidCount: 1, voidRefundMinor: 2000, returnCount: 2, returnRefundMinor: 2400, refundTotalMinor: 4400 });
    expect(s.netCashMinor).toBe(172000 - 3500);
    expect(s.differenceMinor).toBe(170000 - 168500);
  });

  it("a refund tied to nothing makes net cash a question, never a guess (rule 135)", () => {
    const s = buildEodSheet({ ...BASE, refunds: [{ source: "void", refundMinor: 700, paidFrom: null }] });
    expect(s.netCashMinor).toBeNull();
    expect(s.differenceMinor).toBeNull();
    expect(s.netCashProblem).toContain("1 cash refund is ($7.00) not tied to a drawer or the safe");
    const split = splitRefunds([{ source: "void", refundMinor: 700, paidFrom: null }]);
    expect(split.unattributedCount).toBe(1);
    expect(split.unattributedMinor).toBe(700);
  });

  it("a failed read hides net cash", () => {
    const s = buildEodSheet({ ...BASE, readProblems: ["Sales could not all be read: x"] });
    expect(s.netCashMinor).toBeNull();
    expect(s.netCashProblem).toContain("could not be read");
  });

  it("the night figure stays hidden until the morning recount, on the sheet and in the export (SOP-03 §4.10)", () => {
    // A night count unlike any other figure on the sheet, so a leak is visible.
    const s = buildEodSheet({ ...BASE, bag: { ...BAG_ROW, nightCountMinor: 171234 } });
    expect(s.bag!.nightShown).toBe(false);
    expect(s.bag!.nightCountMinor).toBeNull();
    expect(s.bag!.nightDenoms).toBeNull();
    expect(s.bag!.againstExpectedMinor).toBeNull();
    const wb = eodSheetWorkbook(s, SALES0);
    const bagSheet = wb.sheets.find((x) => x.name === "Bag")!;
    expect(bagSheet.rows.every((r) => r.nightQty === null && r.night === null)).toBe(true);
    expect(bagSheet.totals!.night).toBeNull();
    expect(bagSheet.caption).toContain("night count hidden until the morning recount");
    expect(JSON.stringify(wb)).not.toContain("171234");
    expect(JSON.stringify(s)).not.toContain("171234");
  });

  it("after the recount both counts show by denomination, and the bag is compared with the expected deposit", () => {
    const s = buildEodSheet({
      ...BASE,
      bag: { ...BAG_ROW, morningCountMinor: 169900, morningCountedBy: "e2", morningDenoms: denomsFromJson({ hundreds: 16, fifties: 1, twenties: 2, fives: 1, ones: 4 }), morningCountedByName: "Morning Opener" },
    });
    expect(s.bag!.nightShown).toBe(true);
    expect(s.bag!.nightCountMinor).toBe(170000);
    expect(s.bag!.againstExpectedMinor).toBe(-100);
    const grid = denomGridRows(s.bag!.nightDenoms, s.bag!.morningDenoms);
    expect(grid[0]).toMatchObject({ label: "$100", nightQty: 17, nightMinor: 170000, morningQty: 16, morningMinor: 160000 });
  });

  it("no bag: 'not recorded yet', '0316 missing' and 'could not be read' are three different sentences", () => {
    expect(buildEodSheet(BASE).bagNote).toBe(NO_BAG_YET);
    expect(buildEodSheet({ ...BASE, bagMissingSchema: true }).bagNote).toBe(BAG_SCHEMA_MISSING);
    expect(buildEodSheet({ ...BASE, readProblems: ["Deposit bag could not be read: boom"] }).bagNote).toBe("The day's deposit bag could not be read.");
  });

  it("the workbook carries deposit, cash check, refunds, bag, sales and two counters' signature rows", () => {
    const s = buildEodSheet({ ...BASE, bag: { ...BAG_ROW, morningCountMinor: 170000, morningCountedByName: "Morning Opener" } });
    const wb = eodSheetWorkbook(s, SALES0);
    expect(wb.filename).toBe("end-of-day-2026-11-02");
    expect(wb.sheets.map((x) => x.name)).toEqual(["Deposit", "Cash check", "Refunds", "Bag", "Sales", "Signatures"]);
    expect(wb.sheets[0].totals!.toBag).toBe(170000);
    const sig = wb.sheets.find((x) => x.name === "Signatures")!;
    expect(sig.rows.map((r) => r.name)).toEqual(["Night Closer", "Morning Opener", ""]);
    expect(String(sig.rows[1].role)).toContain("DIFFERENT employee");
  });
});

// ── 2. eodData surfaces failed reads (F-03-7) ───────────────────────────────
describe("2.6b · eodData returns failed reads instead of empty", () => {
  beforeEach(() => {
    for (const k of Object.keys(TABLES)) delete TABLES[k];
    REFUNDS = { refunds: [], complete: true, problem: null, returnsAttributable: true };
    BAG = { ok: true, bag: null };
  });

  it("a whole day reads with no problems and builds the sheet", async () => {
    TABLES.registers = { data: [{ id: "r1", name: "Sales Register 1" }], error: null };
    TABLES.drawer_sessions = {
      data: [{ id: "s1", register_id: "r1", status: "closed", opening_count_minor: 16750, closing_count_minor: 96750, over_short_minor: null }],
      error: null,
    };
    TABLES.drawer_drops = { data: [{ session_id: "s1", amount_minor: 50000 }], error: null };
    TABLES.pos_sale_events = { data: [{ id: "1", event_type: "sale", status: "processed", payload: { paymentMethod: "cash", totalMinor: 130000 } }], error: null };
    REFUNDS = { refunds: [{ source: "void", sourceId: "o1", refundMinor: 1000, paidFrom: "drawer", drawerSessionId: "s1" }], complete: true, problem: null, returnsAttributable: true };
    const d = await eodData("2026-11-02");
    expect(d.readProblems).toEqual([]);
    expect(d.sheet.deposit.expectedMinor).toBe(130000);
    expect(d.sheet.netCashMinor).toBe(129000);
    expect(d.sheet.differenceMinor).toBe(1000);
  });

  it("a refund paid from the safe keeps its 'safe' tag through the store (not drawer cash)", async () => {
    TABLES.pos_sale_events = { data: [{ id: "1", event_type: "sale", status: "processed", payload: { paymentMethod: "cash", totalMinor: 5000 } }], error: null };
    REFUNDS = {
      refunds: [
        { source: "return", sourceId: "c1", refundMinor: 1200, paidFrom: "safe", drawerSessionId: null },
        { source: "void", sourceId: "o2", refundMinor: 300, paidFrom: null, drawerSessionId: null },
      ],
      complete: true,
      problem: null,
      returnsAttributable: true,
    };
    const d = await eodData("2026-11-02");
    expect(d.sheet.refunds.fromSafeMinor).toBe(1200);
    expect(d.sheet.refunds.fromDrawersMinor).toBe(0);
    expect(d.sheet.refunds.unattributedCount).toBe(1);
    expect(d.sheet.netCashMinor).toBeNull();
  });

  it("a failed sessions read is reported, not shown as 'no drawers'", async () => {
    TABLES.drawer_sessions = { data: null, error: { message: "timeout" } };
    const d = await eodData("2026-11-02");
    expect(d.readProblems).toContain("Drawer sessions could not be read: timeout");
  });

  it("failed registers, drops, sales, safe counts, swaps, refunds and bag reads are each reported", async () => {
    TABLES.registers = { data: null, error: { message: "r-down" } };
    TABLES.drawer_sessions = { data: [{ id: "s1", register_id: "r1", status: "open", opening_count_minor: 100, closing_count_minor: null }], error: null };
    TABLES.drawer_drops = { data: null, error: { message: "d-down" } };
    TABLES.pos_sale_events = { data: null, error: { message: "e-down" } };
    TABLES.safe_counts = { data: null, error: { message: "c-down" } };
    REFUNDS = { refunds: [], complete: false, problem: "voids: x", returnsAttributable: true };
    BAG = { ok: false, missingSchema: false, error: "b-down" };
    const d = await eodData("2026-11-02");
    const all = d.readProblems.join(" | ");
    expect(all).toContain("Registers could not be read: r-down");
    expect(all).toContain("Drops could not be read: d-down");
    expect(all).toContain("Sales could not all be read");
    expect(all).toContain("Safe counts could not be read: c-down");
    expect(all).toContain("Refunds could not all be read: voids: x");
    expect(all).toContain("Deposit bag could not be read: b-down");
    expect(d.sheet.netCashMinor).toBeNull();
  });

  it("a failed swaps read is reported too", async () => {
    TABLES.safe_swaps = { data: null, error: { message: "s-down" } };
    const d = await eodData("2026-11-02");
    expect(d.readProblems).toContain("Change swaps could not be read: s-down");
  });

  it("a MISSING safe or bag table is a note, not a read problem", async () => {
    TABLES.safe_counts = { data: null, error: { message: "relation safe_counts does not exist", code: "42P01" } };
    BAG = { ok: false, missingSchema: true, error: "x" };
    const d = await eodData("2026-11-02");
    expect(d.readProblems).toEqual([]);
    expect(d.model.safe.ready).toBe(false);
    expect(d.sheet.bagNote).toBe(BAG_SCHEMA_MISSING);
  });

  it("the bag's names and denominations come through, still blind before the recount", async () => {
    BAG = { ok: true, bag: { ...BAG_ROW, nightDenoms: { hundreds: 17 }, morningDenoms: null } };
    const d = await eodData("2026-11-02");
    expect(d.sheet.bag!.bagNo).toBe("A100");
    expect(d.sheet.bag!.nightCountedByName).toBe("Night Closer");
    expect(d.sheet.bag!.nightCountMinor).toBeNull();
  });

  it("the store pages the sale events with a completeness check (no silent 1,000-row cap)", () => {
    const src = stripComments(read(STORE));
    expect(src).toMatch(/pagedAllChecked<EventRow>/);
    expect(src).toContain('.range(from, to)');
    expect(src).toContain("if (!eventRead.verdict.complete) readProblems.push(");
  });
});

// ── 3. the page and the export ──────────────────────────────────────────────
describe("2.6b · the page and the export route", () => {
  const page = stripComments(read(PAGE));

  it("normalizeDay is gone; a bad ?day= is refused with parseBusinessDay (F-03-8)", () => {
    expect(page).not.toContain("normalizeDay");
    expect(page).toContain("const dayCheck = parseBusinessDay(sp.day, today);");
    expect(page).toMatch(/if \(!dayCheck\.ok\) \{[\s\S]{0,700}\{dayCheck\.error\}/);
  });

  it("has a date picker on the page and on the error screen", () => {
    expect(page).toContain('<input type="date" name="day"');
    expect(page.split("<DayPicker value=").length - 1).toBe(2);
  });

  it("shows the deposit by till, the cash check with refunds and the bag by denomination", () => {
    expect(page).toContain("Deposit: what goes in the bag");
    expect(page).toContain("{dep.lines.map((l) =>");
    expect(page).toContain("Cash check (refunds taken off)");
    expect(page).toContain("-{formatCents(sheet.refunds.fromDrawersMinor)}");
    expect(page).toContain("Net cash from sales");
    expect(page).toContain("{grid.map((g) =>");
    expect(page).toContain('"hidden until the morning recount"');
    expect(page).toContain("Gross sales (not the cash: see Cash check)");
  });

  it("has two signature lines: night counter and a different morning verifier (F-03-5)", () => {
    expect(page).toContain('<SignLine label="Night count, prepared by (signature)" name={bag?.nightCountedByName} />');
    expect(page).toContain('<SignLine label="Morning recount and verify, a different employee (signature)" name={bag?.morningCountedByName} />');
    expect(page).not.toContain(">Prepared by (signature)<");
  });

  it("shows read problems at the top and turns export off while any exist (F-03-7)", () => {
    expect(page).toMatch(/\{readProblems\.length > 0 \? \(\s*<div[^>]*role="alert"/);
    expect(page).toContain("This report may be incomplete. Do not file it.");
    expect(page).toMatch(/\{readProblems\.length === 0 \? \([\s\S]{0,400}format=csv[\s\S]{0,200}format=xlsx/);
    expect(page).toContain("The drawer sessions could not be read");
  });

  it("still renders the books panels (books-93, books-95 doors)", () => {
    expect(page).toContain("<UndepositedFunds />");
    expect(page.split("<RegisterCashSpecimen />").length - 1).toBe(2);
  });

  it("the export route exists, checks permission first, refuses bad days and incomplete reads", () => {
    expect(existsSync(join(ROOT, ROUTE))).toBe(true);
    const r = stripComments(read(ROUTE));
    const perm = r.indexOf('await requirePermission("inventory.manage")');
    const data = r.indexOf("await eodData(day.day)");
    expect(perm).toBeGreaterThan(-1);
    expect(perm).toBeLessThan(data);
    expect(r).toContain("if (!day.ok) return bad(day.error);");
    expect(r).toMatch(/if \(data\.readProblems\.length > 0\) \{\s*return bad\([\s\S]*?, 409\);/);
    expect(r).toContain("exportResponse(eodSheetWorkbook(data.sheet, data.model.sales), parseFormat(");
  });
});
