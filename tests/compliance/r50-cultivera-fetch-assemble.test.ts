/**
 * R50 S9 — assembleFromRun: a crawler Phase A run → the two workbooks runImport takes.
 * Synthetic workbooks in the exact live shapes (32 / 19 columns, date cell, list-only lot,
 * stockless catalogue row). The real transform is run inside assembleFromRun, so this
 * also proves the bytes handed to runImport transform cleanly.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { assembleFromRun, readFirstSheet, receivedUtcByLotId } from "@/lib/pos/cultivera-fetch-assemble";
import { INVENTORY_EXPORT_COLUMNS, PRODUCT_EXPORT_COLUMNS, type ListLot, type SheetRow } from "@/lib/pos/cultivera-fetch-core";
import { transformWorkbooks } from "@/lib/pos/transform";

function book(rows: SheetRow[], cols: readonly string[], sheet: string, dateCol?: string): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...cols] });
  if (dateCol) {
    const c = cols.indexOf(dateCol);
    rows.forEach((r, i) => {
      const a = XLSX.utils.encode_cell({ r: i + 1, c });
      if (typeof r[dateCol] === "number") ws[a] = { t: "n", v: r[dateCol], z: "MM/DD/YYYY" };
    });
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const NAMES = ["Alpha Farms - Blue Dream - 3.5g", "Beta Co - Gelato Pre-roll - 1g", "Gamma - Lemon Gummies - 100mg"];
const CATS = ["Flower", "Pre-Roll", "Edible (Solid)"];

function invRow(i: number, over: Partial<SheetRow> = {}): SheetRow {
  const r: SheetRow = {};
  for (const c of INVENTORY_EXPORT_COLUMNS) r[c] = "";
  return {
    ...r, Id: 1000 + i, Location: "GREENWAY MARIJUANA", Barcode: `9000000000000000${i}`, Product: NAMES[i],
    Category: CATS[i], InventoryType: "Usable Marijuana", Strain: "", Brand: NAMES[i].split(" - ")[0], Vendor: "ACME LLC",
    "Product Price": 20 + i, Cost: 5 + i, "Units Available For Sale": 4, "Units In Stock": 4, "Package Size": "3.50 Gram",
    "Storage Location": "Sales Floor", "Is Medical": "False", "Is Cannabis": "True", "Is Sample": "False",
    "Units On Hold": 0, "Received date": 46300.4375 + i, ...over,
  };
}
function prodRow(name: string, i: number): SheetRow {
  return {
    "Product Name": name, "Inventory Type": "Usable Marijuana", Category: CATS[i % 3], Brand: name.split(" - ")[0], Type: "",
    Strain: "", UOM: "Gram", "Package Size": 3.5, "Price Model Y/N": "N", "Price Model Name": "", Price: 20 + i,
    "Vendor Price Model Y/N": "N", "Vendor Price Model Name": "", "Vendor Price": "", "Cannabis Y/N": "Y",
    "Pre Packed/Bulk": "Pre Packed", "Tax Exempt Y/N": "N", "Vendor Only Y/N": "N", "Image Attached Y/N": "N",
  };
}

// Export has lots 0 and 1; the LIST also has lot 2 (the export dropped it).
const exportRows = [invRow(0), invRow(1)];
const listLots: (ListLot & { BatchId: number })[] = [0, 1, 2].map((i) => ({
  Id: 1000 + i, Barcode: `9000000000000000${i}`, ProductName: NAMES[i], VendorName: "ACME LLC", Location: "GREENWAY MARIJUANA",
  StorageName: "Sales Floor", UnitsAvailable: 4, UnitsInStock: 4, UnitsOnHold: 0, UnitCost: 5 + i, IsMedical: false,
  IsSample: false, IsNonCannabis: false, BatchId: 77 + i, IncomingTransferId: 5,
}));
const products = [...NAMES.map(prodRow), prodRow("Delta - Stockless Catalogue Item - 1g", 3)];
const inv = book(exportRows, INVENTORY_EXPORT_COLUMNS, "Inventories", "Received date");
const prod = book(products, PRODUCT_EXPORT_COLUMNS, "Products");
const batches = [{ Id: 79, ReceivedDate: "2026-10-05T17:30:00Z" }];

const run = () => assembleFromRun({ inventoryExport: inv, productExport: prod, listLots, batches, harvestSeconds: 600 });

describe("R50 S9: assembleFromRun", () => {
  it("GO with all 8 checks on a clean run", () => {
    const r = run().report;
    expect(r.checks.map((c) => c.id)).toEqual([
      "login", "inventory_columns", "product_columns", "every_list_lot_imported", "transform_errors",
      "no_card_hidden_for_missing_master", "time_budget", "control_totals",
    ]);
    expect(r.checks.filter((c) => !c.pass)).toEqual([]);
    expect(r.go).toBe(true);
  });

  it("restores the dropped lot with its batch time in Pacific wall clock", () => {
    const r = run();
    expect(r.report.counts.supplemented).toBe(1);
    const rows = readFirstSheet(r.inventoriesBuffer).rows;
    expect(rows.length).toBe(3);
    const lot2 = rows.find((x) => String(x.Barcode) === "90000000000000002")!;
    expect(lot2["Received date"]).toBe("2026-10-05 10:30:00.000000"); // 17:30Z = 10:30 PDT
    expect(lot2.Category).toBe("Edible (Solid)");
  });

  it("date cells keep time of day (serial .4375 = 10:30)", () => {
    const rows = readFirstSheet(run().inventoriesBuffer).rows;
    expect(String(rows[0]["Received date"])).toMatch(/^\d{4}-\d{2}-\d{2} 10:30:00\.000000$/);
    expect(run().report.counts.dateCellsRewritten).toBe(2);
  });

  it("drops stockless catalogue rows; product sheet has Description", () => {
    const r = run();
    expect(r.report.counts.productRowsIn).toBe(4);
    expect(r.report.counts.productRowsKept).toBe(3);
    const p = readFirstSheet(r.productsBuffer);
    expect(p.columns).toContain("Description");
    expect(p.rows.some((x) => /Stockless/.test(String(x["Product Name"])))).toBe(false);
  });

  it("the handed-over bytes transform cleanly on their own (what runImport will see)", () => {
    const r = run();
    const t = transformWorkbooks({ productsBuffer: r.productsBuffer, inventoriesBuffer: r.inventoriesBuffer, productsSheet: "Sheet1", inventoriesSheet: "Inventories" });
    expect(t.diagnosticCounts.errors).toBe(0);
    expect(t.lotSources.length).toBe(3);
    expect(t.diagnostics.filter((d) => d.code === "inventory_without_product_master")).toEqual([]);
    expect(r.report.counts.items).toBe(t.summary.output.menuItems);
  });

  it("NO-GO when a sale lands between the export and the list call (control totals)", () => {
    const sold = listLots.map((l, i) => (i === 0 ? { ...l, UnitsInStock: 3 } : l));
    const r = assembleFromRun({ inventoryExport: inv, productExport: prod, listLots: sold, batches, harvestSeconds: 600 }).report;
    expect(r.go).toBe(false);
    expect(r.checks.find((c) => c.id === "control_totals")!.pass).toBe(false);
    expect(r.reconcile.mismatches).toEqual([{ id: 1000, barcode: "90000000000000000", field: "units", list: 3, row: 4 }]);
  });

  it("NO-GO when an inventory name has no product row (would be a hidden card)", () => {
    const p2 = book(products.slice(1), PRODUCT_EXPORT_COLUMNS, "Products");
    const r = assembleFromRun({ inventoryExport: inv, productExport: p2, listLots, batches, harvestSeconds: 600 }).report;
    expect(r.go).toBe(false);
    expect(r.inventoryNamesWithoutProduct).toEqual([NAMES[0]]);
  });

  it("NO-GO over the time budget; flags ambiguous product matches", () => {
    expect(assembleFromRun({ inventoryExport: inv, productExport: prod, listLots, batches, harvestSeconds: 1801 }).report.go).toBe(false);
    const dup = book([...products, prodRow(NAMES[2], 2)], PRODUCT_EXPORT_COLUMNS, "Products");
    const r = assembleFromRun({ inventoryExport: inv, productExport: dup, listLots, batches, harvestSeconds: 1 }).report;
    expect(r.ambiguousProductMatches.map((s) => s.barcode)).toEqual(["90000000000000002"]);
  });

  it("receivedUtcByLotId joins lot.BatchId → batch.Id only", () => {
    expect(receivedUtcByLotId(listLots, [{ Id: 77, ReceivedDate: "x" }, { Id: 999, ReceivedDate: "y" }])).toEqual({ 1000: "x" });
  });
  it("twin lots (one barcode, two batches) each get their own received date", () => {
    const twins = [
      { ...listLots[0], Id: 1, BatchId: 10 },
      { ...listLots[0], Id: 2, BatchId: 11 },
    ];
    expect(receivedUtcByLotId(twins, [{ Id: 10, ReceivedDate: "a" }, { Id: 11, ReceivedDate: "b" }])).toEqual({ 1: "a", 2: "b" });
  });
});
