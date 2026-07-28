/**
 * tests/compliance/po-list-insights-core.test.ts
 *
 * SLICE 82 — vitest mirror for the Purchasing command-center brains. Pins the
 * behaviors the /admin/purchasing page depends on: KPI math, spend trends,
 * vendor concentration, received-but-unpaid exceptions, URL-driven list state,
 * codename search, junk-safe paging, and the per-row trace dots.
 */
import { describe, expect, it } from "vitest";

import {
  __runPoListInsightsCoreTests,
  buildPoListHref,
  computePoKpis,
  describeSpendDelta,
  filterPoRows,
  paginatePoRows,
  parsePoListState,
  poTraceDots,
  receivedUnpaidExceptions,
  topVendorsByOpenValue,
  type PoListRow,
  type PoListState,
} from "@/lib/purchasing/po-list-insights-core";
import { poCodename } from "@/lib/purchasing/po-document-core";

function row(overrides: Partial<PoListRow>): PoListRow {
  return {
    id: "id-1",
    po_number: "PO-202403-0007",
    vendor_name: "Fairwinds",
    status: "draft",
    subtotal_minor_units: 10_000,
    line_count: 2,
    origin: "manual",
    created_at: "2024-03-05T10:00:00Z",
    sent_at: null,
    received_at: null,
    expected_date: null,
    paid_at: null,
    ...overrides,
  };
}

const ROWS: PoListRow[] = [
  row({ id: "a", status: "sent", subtotal_minor_units: 50_000, created_at: "2024-03-02T00:00:00Z", sent_at: "2024-03-02T00:00:00Z" }),
  row({ id: "b", status: "partial", subtotal_minor_units: 30_000, created_at: "2024-03-10T00:00:00Z" }),
  row({
    id: "c",
    status: "received",
    subtotal_minor_units: 20_000,
    created_at: "2024-02-15T00:00:00Z",
    sent_at: "2024-02-15T00:00:00Z",
    received_at: "2024-02-20T00:00:00Z",
    expected_date: "2024-02-18",
  }),
  row({ id: "e", status: "cancelled", subtotal_minor_units: 99_000, created_at: "2024-03-04T00:00:00Z" }),
  row({ id: "f", status: "draft", subtotal_minor_units: 5_000, vendor_name: null, created_at: "2024-03-20T00:00:00Z" }),
];

const BASE: PoListState = { status: "", vendor: "", q: "", page: 1 };

describe("po-list-insights-core", () => {
  it("embedded self-tests pass (44 assertions)", () => {
    expect(() => __runPoListInsightsCoreTests()).not.toThrow();
  });

  it("computes headline KPIs from real rows only", () => {
    const k = computePoKpis(ROWS, "2024-03-25T12:00:00Z");
    expect(k.openCount).toBe(3);
    expect(k.openValueMinor).toBe(85_000);
    expect(k.awaitingCount).toBe(2);
    // Cancelled POs never count as spend.
    expect(k.spendThisMonthMinor).toBe(85_000);
    expect(k.spendLastMonthMinor).toBe(20_000);
  });

  it("describes the month-over-month spend delta in plain English", () => {
    const k = computePoKpis(ROWS, "2024-03-25T12:00:00Z");
    expect(describeSpendDelta(k)).toBe("up 325% vs last month");
    expect(describeSpendDelta({ spendDeltaPct: null, spendLastMonthMinor: 0 })).toBe(
      "no orders last month to compare",
    );
  });

  it("ranks vendors by open committed value with an honest no-vendor bucket", () => {
    const top = topVendorsByOpenValue(ROWS);
    expect(top[0]).toMatchObject({ vendorName: "Fairwinds", openValueMinor: 80_000, openCount: 2 });
    expect(top[1]).toMatchObject({ vendorName: "(no vendor set)", openValueMinor: 5_000 });
  });

  it("surfaces received-but-unpaid POs as three-way-match exceptions", () => {
    const ex = receivedUnpaidExceptions(ROWS);
    expect(ex.map((p) => p.id)).toEqual(["c"]);
    expect(receivedUnpaidExceptions([row({ status: "received", paid_at: "2024-03-01T00:00:00Z" })])).toEqual([]);
  });

  it("parses URL state junk-safely", () => {
    expect(parsePoListState({ status: "SENT", vendor: " x ", q: " y ", page: "2" })).toEqual({
      status: "sent",
      vendor: "x",
      q: "y",
      page: 2,
    });
    expect(parsePoListState({ status: "bogus", page: "-1" })).toEqual({ status: "", vendor: "", q: "", page: 1 });
  });

  it("search matches PO number, vendor, and the derived codename", () => {
    expect(filterPoRows(ROWS, { ...BASE, q: "202403-0007" })).toHaveLength(ROWS.length);
    const word = (poCodename("PO-202403-0007") ?? "").split(" ")[1].toLowerCase();
    expect(word.length).toBeGreaterThan(0);
    expect(filterPoRows(ROWS, { ...BASE, q: word })).toHaveLength(ROWS.length);
    expect(filterPoRows(ROWS, { ...BASE, q: "zzz-no-such" })).toHaveLength(0);
  });

  it("paginates with clamped pages — never a blank out-of-range page", () => {
    const many = Array.from({ length: 60 }, (_, i) => row({ id: `p${i}` }));
    expect(paginatePoRows(many, 99).safePage).toBe(3);
    expect(paginatePoRows(many, 2).pageRows).toHaveLength(25);
    expect(paginatePoRows([], 5).totalPages).toBe(1);
  });

  it("builds clean bookmarkable hrefs (defaults omitted)", () => {
    expect(buildPoListHref(BASE)).toBe("/admin/purchasing");
    expect(buildPoListHref({ status: "sent", vendor: "fair", q: "og", page: 1 }, 2)).toBe(
      "/admin/purchasing?status=sent&vendor=fair&q=og&page=2",
    );
  });

  it("trace dots tell the honest procure-to-pay story per row", () => {
    const recUnpaid = poTraceDots(row({ status: "received" }));
    expect(recUnpaid.map((d) => d.state)).toEqual(["done", "done", "missing"]);
    expect(recUnpaid[2].detail).toContain("Vendor payments");
    const paid = poTraceDots(row({ status: "received", paid_at: "2024-03-01T00:00:00Z" }));
    expect(paid.map((d) => d.state)).toEqual(["done", "done", "done"]);
    const cancelled = poTraceDots(row({ status: "cancelled" }));
    expect(cancelled[2].detail).toBe("cancelled — nothing to pay");
  });
});
