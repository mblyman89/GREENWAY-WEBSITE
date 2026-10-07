/**
 * S-12b (CCRS Bible v2 Part 05 §G, LAW 5): control totals.
 *
 * Why this matters to the license: the totals are stored when a file is
 * emitted and re-derived from the file's own bytes at verify. If they are
 * typed instead of derived, or summed in floating point, a changed cent or a
 * dropped row can slip through unseen.
 */
import { describe, expect, it } from "vitest";
import { CCRS_COLUMNS, assembleCcrsFile } from "../../src/lib/compliance/ccrs-batch-core";
import {
  CcrsTotalsError,
  compareControlTotals,
  computeControlTotals,
  controlTotalsFromCsv,
  formatDecimal,
  parseDecimal,
  sumDecimals,
} from "../../src/lib/compliance/ccrs-control-totals-core";

const INV = CCRS_COLUMNS.Inventory;
function invRow(id: string, qoh: string, cost: string, op = "Update"): string[] {
  const r = INV.map(() => "x");
  r[INV.indexOf("ExternalIdentifier")] = id;
  r[INV.indexOf("QuantityOnHand")] = qoh;
  r[INV.indexOf("TotalCost")] = cost;
  r[INV.indexOf("Operation")] = op;
  return r;
}

describe("exact decimals", () => {
  it("0.1 + 0.2 = 0.3 exactly (a float would give 0.30000000000000004)", () => {
    expect(sumDecimals(["0.1", "0.2"], "t")).toBe("0.3");
  });
  it("canonical text: trailing zeros dropped, negatives kept, -0 never produced", () => {
    expect(formatDecimal(parseDecimal("12.500", "t"))).toBe("12.5");
    expect(formatDecimal(parseDecimal("-0.00", "t"))).toBe("0");
    expect(sumDecimals(["-1.25", "0.25"], "t")).toBe("-1");
    expect(sumDecimals(["0.05", "0.005"], "t")).toBe("0.055");
  });
  it("non-numbers throw instead of becoming 0", () => {
    for (const bad of ["", "abc", "1,000", "1e3", " . "]) expect(() => parseDecimal(bad, "t")).toThrow(CcrsTotalsError);
  });
});

describe("computeControlTotals (Part 05 §G)", () => {
  const rows = [invRow("A", "3", "30.00", "Insert"), invRow("B", "2.5", "12.34"), invRow("B", "1", "0.01", "Delete")];

  it("Inventory: records, distinct ids, Σ QoH, Σ TotalCost, op counts", () => {
    const t = computeControlTotals("Inventory", rows);
    expect(t).toMatchObject({
      numberRecords: 3,
      distinctIds: 2,
      sumQoh: "6.5",
      sumTotalCost: "42.35",
      ops: { Insert: 1, Update: 1, Delete: 1 },
      saleGross: null,
      saleExcise: null,
    });
  });

  it("totals recomputed from the ASSEMBLED bytes equal the stored ones", () => {
    const stored = computeControlTotals("Inventory", rows);
    const csv = assembleCcrsFile({ type: "Inventory", submittedBy: "Greenway", submittedDate: new Date("2026-10-05T17:00:00Z"), rows });
    expect(compareControlTotals(stored, controlTotalsFromCsv("Inventory", csv))).toEqual([]);
  });

  it("a one-cent change in one row changes sum_total_cost and nothing else", () => {
    const stored = computeControlTotals("Inventory", rows);
    const changed = rows.map((r) => [...r]);
    changed[1][INV.indexOf("TotalCost")] = "12.35";
    const diff = compareControlTotals(stored, computeControlTotals("Inventory", changed));
    expect(diff).toEqual([{ field: "sumTotalCost", stored: "42.35", recomputed: "42.36" }]);
  });

  it("a dropped row is caught (records, ids/sums/ops differ)", () => {
    const stored = computeControlTotals("Inventory", rows);
    const diff = compareControlTotals(stored, computeControlTotals("Inventory", rows.slice(0, 2)));
    expect(diff.map((d) => d.field)).toEqual(expect.arrayContaining(["numberRecords", "sumQoh", "sumTotalCost", "ops.Delete"]));
  });

  it("Strain: no quantity or cost totals; distinct ids are the names", () => {
    const t = computeControlTotals("Strain", [
      ["413541", "Blue Dream", "Hybrid", "G", "10/05/2026"],
      ["413541", "OG Kush", "Hybrid", "G", "10/05/2026"],
    ]);
    expect(t).toMatchObject({ numberRecords: 2, distinctIds: 2, sumQoh: null, sumTotalCost: null, ops: null });
  });

  it("Sale: Σ UnitPrice×Qty and Σ excise are exact", () => {
    const S = CCRS_COLUMNS.Sale;
    const sale = (id: string, qty: string, price: string, excise: string) => {
      const r = S.map(() => "");
      r[S.indexOf("SaleDetailExternalIdentifier")] = id;
      r[S.indexOf("Quantity")] = qty;
      r[S.indexOf("UnitPrice")] = price;
      r[S.indexOf("CannabisExciseTax")] = excise;
      r[S.indexOf("Operation")] = "Insert";
      return r;
    };
    const t = computeControlTotals("Sale", [sale("D1", "3", "10.10", "11.21"), sale("D2", "1", "0.01", "0.00")]);
    expect(t).toMatchObject({ sumQoh: "4", saleGross: "30.31", saleExcise: "11.21", ops: { Insert: 2, Update: 0, Delete: 0 } });
  });

  it("a mis-shaped row or a bad Operation throws", () => {
    expect(() => computeControlTotals("Inventory", [["too", "short"]])).toThrow(/has 2 cells/);
    expect(() => computeControlTotals("Inventory", [invRow("A", "1", "1", "Upsert")])).toThrow(/not Insert, Update or Delete/);
  });

  it("a comma smuggled into a cell is caught by the reader-split recompute (row width changes)", () => {
    const csv = assembleCcrsFile({ type: "Inventory", submittedBy: "G", submittedDate: new Date("2026-10-05T17:00:00Z"), rows: [rows[0]] });
    const tampered = csv.replace("30.00", "30,00");
    expect(() => controlTotalsFromCsv("Inventory", tampered)).toThrow(/has 15 cells/);
  });
});
