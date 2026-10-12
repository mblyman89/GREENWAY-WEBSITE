/**
 * R50 S9 (bible §3b): the Fetch-It-All pipeline end-to-end on workbooks in the
 * SAME shape the live exports have (rehearsal #1, 2026-10-12):
 *   - inventory export with "Received date" as an Excel DATE CELL (MM/DD/YYYY),
 *   - a list API that holds lots the export dropped,
 *   - a product export with stockless catalogue rows.
 * No harvest data is committed, so the committed normalized export is the lot
 * source and the live shape is rebuilt from it in memory.
 *
 * Must hold: every list lot reaches the transform, no lot is hidden for a
 * missing product master, time of day survives (so S1b can place lots), and
 * GO only when all of that is true. Each safeguard is shown load-bearing.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as XLSX from "xlsx";
import { transformWorkbooks } from "@/lib/pos/transform";
import {
  supplementListOnly,
  rewriteDateCells,
  filterProductsToInventory,
  checkCompleteness,
  goNoGo,
  INVENTORY_EXPORT_COLUMNS,
  PRODUCT_EXPORT_COLUMNS,
  type SheetRow,
  type ListLot,
} from "@/lib/pos/cultivera-fetch-core";

const INV = "normalized_cultivera/INVENTORIES_NORMALIZED.xlsx";
const TS = /\d{2}:\d{2}:\d{2}/;

function sheetRows(path: string): SheetRow[] {
  const wb = XLSX.read(fs.readFileSync(path));
  return XLSX.utils.sheet_to_json<SheetRow>(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: true });
}

/** "2026-07-02 09:32:07.787000" → Excel serial (wall clock, no zone), like the live export cell. */
function toSerial(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(text.trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0);
  return (ms - Date.UTC(1899, 11, 30)) / 86_400_000;
}

/** Test-side inverse used only to build the fixture's batch UTC times: Pacific wall text → UTC ISO. */
function pacificWallToUtcIso(text: string): string | null {
  const s = toSerial(text);
  if (s === null) return null;
  const wall = Math.round(s * 86_400_000) + Date.UTC(1899, 11, 30);
  const hourOf = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", hourCycle: "h23" });
  for (const h of [7, 8]) {
    const d = new Date(wall + h * 3_600_000);
    if (Number(hourOf.format(d)) === Number(text.slice(11, 13))) return d.toISOString();
  }
  return null;
}

function book(rows: SheetRow[], sheet: string, dateCols: string[] = []): Buffer {
  const header = Object.keys(rows[0]);
  const ws = XLSX.utils.json_to_sheet(rows, { header });
  for (const col of dateCols) {
    const c = header.indexOf(col);
    for (let r = 0; r < rows.length; r++) {
      const addr = XLSX.utils.encode_cell({ r: r + 1, c });
      const cell = ws[addr];
      if (cell && typeof cell.v === "number") ws[addr] = { t: "n", v: cell.v, z: "MM/DD/YYYY" };
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ---- live-shaped inputs, built from the committed export ----
const source = sheetRows(INV).slice(0, 600);
const listLots: ListLot[] = source.map((r, i) => ({
  Id: 500000 + i,
  Barcode: String(r.Barcode),
  ProductName: String(r.Product),
  VendorName: String(r.Vendor ?? ""),
  Location: String(r.Location ?? ""),
  StorageName: String(r["Storage Location"] ?? ""),
  UnitsAvailable: Number(r["Units Available For Sale"] ?? 0),
  UnitsInStock: Number(r["Units In Stock"] ?? 0),
  UnitsOnHold: 0,
  UnitCost: Number(String(r.Cost ?? "").replace(/[$,]/g, "")) || null,
  IsMedical: String(r["Is Medical"]).toLowerCase() === "true",
  IsSample: false,
  IsNonCannabis: false,
  Cbd: r.Cbd === "" ? null : Number(r.Cbd),
  Cbda: r.Cbda === "" ? null : Number(r.Cbda),
  Thc: r.Thc === "" ? null : Number(r.Thc),
  Thca: r.Thca === "" ? null : Number(r.Thca),
  Total: r.Total === "" ? null : Number(r.Total),
}));
// Cultivera's export: the first 580 lots, received date as a date serial; the last 20 "dropped".
const liveExport: SheetRow[] = source.slice(0, 580).map((r, i) => {
  const s = toSerial(String(r["Received date"] ?? ""));
  return { ...r, Id: listLots[i].Id, "Received date": s ?? r["Received date"] };
});
const dropped = source.slice(580);
const receivedUtcByBarcode: Record<string, string | null> = {};
for (const r of dropped) receivedUtcByBarcode[String(r.Barcode).trim()] = pacificWallToUtcIso(String(r["Received date"] ?? ""));
// The product export: one row per inventory name + 300 stockless catalogue rows.
const productRows: SheetRow[] = [];
const seenNames = new Set<string>();
for (const r of source) {
  const k = String(r.Product).replace(/\s+/g, " ").trim().toLowerCase();
  if (seenNames.has(k)) continue;
  seenNames.add(k);
  const size = /^([\d.]+)\s+(\w+)/.exec(String(r["Package Size"] ?? ""));
  productRows.push({
    "Product Name": r.Product, "Inventory Type": r.InventoryType, Category: r.Category, Brand: r.Brand, Type: "",
    Strain: r.Strain, UOM: size ? size[2] : "", "Package Size": size ? size[1] : "", "Price Model Y/N": "N",
    "Price Model Name": "", Price: r["Product Price"], "Vendor Price Model Y/N": "N", "Vendor Price Model Name": "",
    "Vendor Price": "", "Cannabis Y/N": "Y", "Pre Packed/Bulk": "Pre Packed", "Tax Exempt Y/N": "N",
    "Vendor Only Y/N": "N", "Image Attached Y/N": "N",
  });
}
const realProductCount = productRows.length;
for (let i = 0; i < 300; i++) productRows.push({ ...productRows[i % realProductCount], "Product Name": `Stockless Catalogue Row ${i}` });

function runPipeline(opts: { supplement: boolean; rewriteDates: boolean; filter: boolean }) {
  let invRows = liveExport.map((r) => ({ ...r }));
  if (opts.rewriteDates) invRows = rewriteDateCells(invRows).rows;
  let supplemented = 0;
  if (opts.supplement) {
    const s = supplementListOnly({ exportRows: invRows, listLots, productRows, receivedUtcByBarcode });
    invRows = s.rows;
    supplemented = s.supplemented.length;
  }
  const fp = filterProductsToInventory(productRows, invRows);
  const prodRows = opts.filter ? fp.rows : productRows.map((p) => ({ ...p, Description: "" }));
  const r = transformWorkbooks({
    productsBuffer: book(prodRows, "Sheet1"),
    inventoriesBuffer: book(invRows, "Inventories", ["Received date"]),
    productsSheet: "Sheet1",
    inventoriesSheet: "Inventories",
  });
  const completeness = checkCompleteness(listLots, invRows, supplemented, 0);
  const hidden = r.diagnostics.filter((d) => d.code === "inventory_without_product_master").length;
  const gate = goNoGo({
    loginOk: true,
    inventoryColumns: Object.keys(invRows[0]),
    productColumns: Object.keys(prodRows[0]),
    completeness,
    transformErrors: r.diagnosticCounts.errors,
    hiddenForMissingMaster: hidden,
    inventoryNamesWithoutProduct: fp.inventoryNamesWithoutProduct.length,
    elapsedMs: 1,
    budgetMs: 3_600_000,
  });
  return { r, completeness, gate, hidden, invRows, prodRows };
}

const full = runPipeline({ supplement: true, rewriteDates: true, filter: true });

describe("R50 S9: Fetch It All pipeline on live-shaped workbooks", () => {
  it("fixture is live-shaped (guards the test itself)", () => {
    expect(source.length).toBe(600);
    expect(dropped.length).toBe(20);
    expect(liveExport.filter((r) => typeof r["Received date"] === "number").length).toBeGreaterThan(500);
    const droppedWithTime = dropped.filter((r) => TS.test(String(r["Received date"] ?? ""))).length;
    expect(droppedWithTime).toBeGreaterThan(0);
    expect(Object.values(receivedUtcByBarcode).filter(Boolean).length).toBe(droppedWithTime);
    expect(INVENTORY_EXPORT_COLUMNS.every((c) => c in liveExport[0])).toBe(true);
    expect(PRODUCT_EXPORT_COLUMNS.every((c) => c in productRows[0])).toBe(true);
  });

  it("every list lot reaches the transform, nothing hidden for a missing master, 0 errors: GO", () => {
    expect(full.completeness.ok).toBe(true);
    expect(full.completeness.rows).toBe(600);
    expect(full.r.lotSources.length).toBe(600);
    expect(new Set(full.r.lotSources.map((s) => s.barcode))).toEqual(new Set(listLots.map((l) => l.Barcode.trim())));
    expect(full.r.diagnosticCounts.errors).toBe(0);
    expect(full.hidden).toBe(0);
    expect(full.gate.go).toBe(true);
  });

  it("the dropped lots come back with their product columns and their Pacific received time", () => {
    for (const d of dropped) {
      const row = full.invRows.find((r) => String(r.Barcode).trim() === String(d.Barcode).trim())!;
      expect(row.Category).toBe(d.Category);
      expect(row.Brand).toBe(d.Brand);
      expect(row.Product).toBe(d.Product);
      const t = String(d["Received date"] ?? "");
      if (TS.test(t)) expect(String(row["Received date"]).slice(0, 23)).toBe(t.slice(0, 23));
    }
  });

  it("time of day survives the date cells", () => {
    const withTime = full.r.lotSources.filter((s) => TS.test(s.receivedDateRaw ?? "")).length;
    const sourceWithTime = source.filter((r) => TS.test(String(r["Received date"] ?? ""))).length;
    expect(sourceWithTime).toBeGreaterThan(500);
    expect(withTime).toBe(sourceWithTime);
  });

  it("stockless catalogue rows never become cards", () => {
    expect(full.prodRows.length).toBe(realProductCount);
    expect(full.r.items.some((i) => /Stockless Catalogue Row/.test(JSON.stringify(i)))).toBe(false);
  });

  it("each safeguard is load-bearing: removing it is caught", () => {
    const noSupp = runPipeline({ supplement: false, rewriteDates: true, filter: true });
    expect(noSupp.completeness.ok).toBe(false);
    expect(noSupp.completeness.missingBarcodes.length).toBe(20);
    expect(noSupp.gate.go).toBe(false);

    const noDates = runPipeline({ supplement: true, rewriteDates: false, filter: true });
    const kept = noDates.r.lotSources.filter((s) => TS.test(s.receivedDateRaw ?? "")).length;
    expect(kept).toBeLessThanOrEqual(20); // only the supplemented (text) rows keep a time

    const noFilter = runPipeline({ supplement: true, rewriteDates: true, filter: false });
    expect(noFilter.r.items.filter((i) => /Stockless Catalogue Row/.test(JSON.stringify(i))).length).toBeGreaterThan(0);
  });
});
