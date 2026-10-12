/**
 * src/lib/pos/cultivera-fetch-core.ts — R50 S9 ("Fetch It All", bible §3b).
 *
 * Pure rules that turn what the cutover job fetched from the Cultivera back
 * office into the exact two workbooks the existing import already takes, and
 * prove nothing was lost on the way. No I/O, no clock, no network.
 *
 * Every rule here was measured on rehearsal #1 (2026-10-12, live account):
 *   - The inventory Excel export is NOT complete: the list API had 3,858 lots,
 *     the export 3,835; the 23 missing were active, in stock, one vendor.
 *     → the list is the inventory of record; list-only lots get a row built
 *       from the list record + their (unique-by-name) product-export row
 *       (supplementListOnly). Rebuilding ALL 3,835 exported lots this way and
 *       comparing with Cultivera's own export: every carried column agrees
 *       except units that moved during trading (32 available / 2 in stock) and
 *       the 3 lots whose name is on 2 product rows (first row taken, recorded).
 *   - "Package Size" is `${size.toFixed(2)} ${UOM}` (3,826 / 3,826 agree).
 *   - "Received date" is an Excel date cell formatted MM/DD/YYYY; the import
 *     reads formatted text, so the time of day was lost (143 lots could not be
 *     placed). → rewrite to "YYYY-MM-DD HH:MM:SS.ffffff" text (excelSerialToWallClock;
 *     3,687 / 3,687 equal to an independent openpyxl rewrite).
 *     The value is Pacific wall clock (export = batch UTC − 7 h PDT / − 8 h PST
 *     on 5 lots across 2025–2026); a supplemented lot's batch UTC time is turned
 *     into the same Pacific wall clock (utcIsoToPacificWallClock).
 *   - Products: every Hide flag false + ShowNonCannabis false covers every
 *     inventory name; the export is filtered to inventory names (filterProductsToInventory)
 *     so no stockless catalogue row becomes a hidden card.
 */

export type CellValue = string | number | boolean | null | undefined;
export type SheetRow = Record<string, CellValue>;

/** The fields of one lot as the inventory LIST API returns them (verified names). */
export type ListLot = {
  Id: number;
  Barcode: string;
  Alias?: string | null;
  ProductId?: number | null;
  ProductName: string;
  VendorName?: string | null;
  Location?: string | null;
  StorageName?: string | null;
  UnitsAvailable?: number | null;
  UnitsInStock?: number | null;
  UnitsOnHold?: number | null;
  UnitCost?: number | null;
  IsMedical?: boolean | null;
  IsSample?: boolean | null;
  IsNonCannabis?: boolean | null;
  Cbd?: number | null;
  Cbda?: number | null;
  Thc?: number | null;
  Thca?: number | null;
  Total?: number | null;
  TerpeneTotal?: number | null;
  IncomingTransferId?: number | null;
};

export const INVENTORY_EXPORT_COLUMNS = [
  "Id", "Location", "Barcode", "Alias", "Product", "Category", "InventoryType", "Strain", "Brand", "Vendor",
  "Product Price", "Cost", "Units Available For Sale", "Units In Stock", "Package Size", "Storage Location",
  "Is Medical", "Is Cannabis", "Is Sample", "Lab", "[COA Y/N]", "Cbd", "Cbda", "Thc", "Thca", "Total",
  "Terpene Total", "Units On Hold", "Quantity Sold", "Quantity Purchased", "Expiration date", "Received date",
] as const;

export const PRODUCT_EXPORT_COLUMNS = [
  "Product Name", "Inventory Type", "Category", "Brand", "Type", "Strain", "UOM", "Package Size",
  "Price Model Y/N", "Price Model Name", "Price", "Vendor Price Model Y/N", "Vendor Price Model Name",
  "Vendor Price", "Cannabis Y/N", "Pre Packed/Bulk", "Tax Exempt Y/N", "Vendor Only Y/N", "Image Attached Y/N",
] as const;

/** The product-export request body that covers every inventory name (rehearsal #1). */
export const PRODUCT_EXPORT_FILTER = Object.freeze({
  Product: "", BrandIds: [], TagIds: [], CategoryIds: [], InventoryTypeIds: [], VendorIds: [],
  HideMasterProduct: false, HideNotAvailable: false, HideOutOfStock: false, HideDiscontinued: false,
  ShowNonCannabis: false,
});

/** The inventory-export request body (every filter off). */
export const INVENTORY_EXPORT_FILTER = Object.freeze({
  Barcode: "", ProductIds: [], HideUnavailable: false, HideInactive: false, HideNonCannabis: false,
  ShowOnlySamples: false, CategoryIds: [], ShowMetrcId: false, VendorIds: [], DisplayIds: [], StorageIds: [],
  BrandIds: [],
});

/** Same comparison the transform's product join uses (whitespace collapsed, lower case). */
export function comparableName(v: CellValue): string {
  return String(v ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

/**
 * An Excel date serial (days since 1899-12-30, fraction = time of day, no zone)
 * as wall-clock text "YYYY-MM-DD HH:MM:SS.mmm000", rounded to the millisecond.
 * Non-finite or out of range → null (never guessed). Serials below 61 are refused:
 * Excel counts a 1900-02-29 that never existed, so serials 1–60 are off by a day.
 */
export function excelSerialToWallClock(serial: CellValue): string | null {
  if (typeof serial !== "number" || !Number.isFinite(serial)) return null;
  if (serial < 61 || serial > 109574) return null; // 1900-03-01 .. 2199-12-31
  const ms = Math.round(serial * 86_400_000);
  const d = new Date(Date.UTC(1899, 11, 30) + ms);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}000`
  );
}

const PACIFIC = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23",
});

/**
 * A Cultivera UTC timestamp ("2024-12-02T21:39:24.907Z", 0–7 fraction digits,
 * Z required) as Pacific wall-clock text in the export's shape. Anything else → null.
 */
export function utcIsoToPacificWallClock(iso: CellValue): string | null {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?Z$/.exec(iso.trim());
  if (!m) return null;
  const msPart = m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], msPart);
  if (!Number.isFinite(t)) return null;
  const p: Record<string, string> = {};
  for (const part of PACIFIC.formatToParts(new Date(t))) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}.${pad(msPart, 3)}000`;
}

/** "1.00 Grams" from (1, "Grams"). Blank/non-numeric size or blank unit → "" (not guessed). */
export function packageSizeLabel(size: CellValue, uom: CellValue): string {
  const u = String(uom ?? "").trim();
  const s = typeof size === "number" ? size : String(size ?? "").trim() === "" ? NaN : Number(size);
  if (!u || !Number.isFinite(s)) return "";
  return `${s.toFixed(2)} ${u}`;
}

function bool(v: CellValue): string {
  return v ? "True" : "False";
}

export type SupplementInput = {
  exportRows: SheetRow[];
  listLots: ListLot[];
  /** Product-export rows (any order). */
  productRows: SheetRow[];
  /** Batch ReceivedDate (UTC ISO) by lot barcode, for list-only lots. */
  receivedUtcByBarcode?: Record<string, string | null | undefined>;
};

export type SupplementedLot = {
  barcode: string;
  id: number;
  productName: string;
  /** How many product-export rows share the lot's name (1 = clean; 0/2+ flagged). */
  productMatches: number;
  receivedDate: string | null;
};

export type SupplementResult = {
  rows: SheetRow[];
  supplemented: SupplementedLot[];
  /** Export rows whose Id is not on the list (kept, but named). */
  exportOnly: number[];
};

/** Build the export-shaped row for a list-only lot. */
export function rowFromListLot(lot: ListLot, product: SheetRow | null, receivedUtc: string | null | undefined): SheetRow {
  const g = (k: string): CellValue => (product ? product[k] : "");
  return {
    Id: lot.Id,
    Location: lot.Location ?? "",
    Barcode: String(lot.Barcode ?? "").trim(),
    Alias: lot.Alias ?? "",
    Product: lot.ProductName,
    // The inventory export writes "" where the product export says "Without Category" (8 / 8 on rehearsal #1).
    Category: String(g("Category") ?? "").trim() === "Without Category" ? "" : g("Category") ?? "",
    InventoryType: g("Inventory Type") ?? "",
    Strain: g("Strain") ?? "",
    Brand: g("Brand") ?? "",
    Vendor: lot.VendorName ?? "",
    "Product Price": g("Price") ?? "",
    Cost: lot.UnitCost ?? "",
    "Units Available For Sale": lot.UnitsAvailable ?? 0,
    "Units In Stock": lot.UnitsInStock ?? 0,
    "Package Size": product ? packageSizeLabel(g("Package Size"), g("UOM")) : "",
    "Storage Location": lot.StorageName ?? "",
    "Is Medical": bool(lot.IsMedical),
    "Is Cannabis": bool(!lot.IsNonCannabis),
    "Is Sample": bool(lot.IsSample),
    Lab: "",
    "[COA Y/N]": "",
    Cbd: lot.Cbd ?? "",
    Cbda: lot.Cbda ?? "",
    Thc: lot.Thc ?? "",
    Thca: lot.Thca ?? "",
    Total: lot.Total ?? "",
    "Terpene Total": lot.TerpeneTotal ?? "",
    "Units On Hold": lot.UnitsOnHold ?? 0,
    "Quantity Sold": "",
    "Quantity Purchased": "",
    "Expiration date": "",
    "Received date": utcIsoToPacificWallClock(receivedUtc ?? null) ?? "",
  };
}

/**
 * The list is the inventory of record. Every export row is kept as-is; every
 * list lot whose Id is not in the export gets a row built from the list record
 * and its product-export row (first by Product Name order when 2+ share the
 * name — recorded, never silent). Output order: export rows, then supplemented
 * rows by Id. Deterministic.
 */
export function supplementListOnly(input: SupplementInput): SupplementResult {
  const exportIds = new Set<number>();
  for (const r of input.exportRows) {
    const id = Number(r.Id);
    if (Number.isFinite(id)) exportIds.add(id);
  }
  const listIds = new Set(input.listLots.map((l) => l.Id));
  const byName = new Map<string, SheetRow[]>();
  for (const p of input.productRows) {
    const k = comparableName(p["Product Name"]);
    if (!k) continue;
    const list = byName.get(k) ?? [];
    list.push(p);
    byName.set(k, list);
  }
  const rows: SheetRow[] = input.exportRows.map((r) => ({ ...r }));
  const supplemented: SupplementedLot[] = [];
  const listOnly = input.listLots.filter((l) => !exportIds.has(l.Id)).sort((a, b) => a.Id - b.Id);
  for (const lot of listOnly) {
    const matches = byName.get(comparableName(lot.ProductName)) ?? [];
    const received = input.receivedUtcByBarcode?.[String(lot.Barcode).trim()] ?? null;
    const row = rowFromListLot(lot, matches[0] ?? null, received);
    rows.push(row);
    supplemented.push({
      barcode: String(lot.Barcode).trim(),
      id: lot.Id,
      productName: lot.ProductName,
      productMatches: matches.length,
      receivedDate: (row["Received date"] as string) || null,
    });
  }
  const exportOnly = [...exportIds].filter((id) => !listIds.has(id)).sort((a, b) => a - b);
  return { rows, supplemented, exportOnly };
}

/** Rewrite date cells (Excel serials) to wall-clock text; text cells are left exactly as they are. */
export function rewriteDateCells(rows: SheetRow[], columns: readonly string[] = ["Received date", "Expiration date"]): { rows: SheetRow[]; rewritten: number } {
  let rewritten = 0;
  const out = rows.map((r) => {
    const c = { ...r };
    for (const col of columns) {
      const t = excelSerialToWallClock(c[col]);
      if (t !== null) {
        c[col] = t;
        rewritten++;
      }
    }
    return c;
  });
  return { rows: out, rewritten };
}

/** Keep only product rows whose name is an inventory product name (the transform's join). */
export function filterProductsToInventory(productRows: SheetRow[], inventoryRows: SheetRow[]): { rows: SheetRow[]; kept: number; dropped: number; inventoryNamesWithoutProduct: string[] } {
  const inv = new Map<string, string>();
  for (const r of inventoryRows) {
    const k = comparableName(r.Product);
    if (k && !inv.has(k)) inv.set(k, String(r.Product));
  }
  const seen = new Set<string>();
  const rows: SheetRow[] = [];
  for (const p of productRows) {
    const k = comparableName(p["Product Name"]);
    if (k && inv.has(k)) {
      rows.push({ ...p, Description: p.Description ?? "" });
      seen.add(k);
    }
  }
  const missing = [...inv.entries()].filter(([k]) => !seen.has(k)).map(([, v]) => v).sort();
  return { rows, kept: rows.length, dropped: productRows.length - rows.length, inventoryNamesWithoutProduct: missing };
}

export type CompletenessReport = {
  listLots: number;
  rows: number;
  supplemented: number;
  exportOnly: number;
  /** List barcodes that are not in the final rows (must be empty). */
  missingBarcodes: string[];
  duplicateIds: number[];
  ok: boolean;
};

export function checkCompleteness(listLots: ListLot[], rows: SheetRow[], supplemented: number, exportOnly: number): CompletenessReport {
  const have = new Set(rows.map((r) => String(r.Barcode ?? "").trim()));
  const missing = listLots.map((l) => String(l.Barcode).trim()).filter((b) => !have.has(b)).sort();
  const seen = new Set<number>();
  const dup = new Set<number>();
  for (const r of rows) {
    const id = Number(r.Id);
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  const duplicateIds = [...dup].sort((a, b) => a - b);
  return {
    listLots: listLots.length,
    rows: rows.length,
    supplemented,
    exportOnly,
    missingBarcodes: missing,
    duplicateIds,
    ok: missing.length === 0 && duplicateIds.length === 0 && rows.length >= listLots.length,
  };
}

export type GoNoGoInput = {
  loginOk: boolean;
  inventoryColumns: string[];
  productColumns: string[];
  completeness: CompletenessReport;
  transformErrors: number;
  hiddenForMissingMaster: number;
  inventoryNamesWithoutProduct: number;
  elapsedMs: number;
  budgetMs: number;
  /** Control totals (list vs rows). Optional so older callers keep 7 checks; the button always passes it. */
  reconcile?: ReconcileReport;
};

export type GoNoGoCheck = { id: string; pass: boolean; detail: string };

/** §3b.6 — every check is a number; one failing check = no-go. */
export function goNoGo(i: GoNoGoInput): { go: boolean; checks: GoNoGoCheck[] } {
  const missingCols = (have: string[], need: readonly string[]) => need.filter((c) => !have.includes(c));
  const invMissing = missingCols(i.inventoryColumns, INVENTORY_EXPORT_COLUMNS);
  const prodMissing = missingCols(i.productColumns, PRODUCT_EXPORT_COLUMNS);
  const c = i.completeness;
  const checks: GoNoGoCheck[] = [
    { id: "login", pass: i.loginOk, detail: i.loginOk ? "logged in" : "login failed" },
    { id: "inventory_columns", pass: invMissing.length === 0, detail: invMissing.length ? `missing: ${invMissing.join(", ")}` : "all 32 columns" },
    { id: "product_columns", pass: prodMissing.length === 0, detail: prodMissing.length ? `missing: ${prodMissing.join(", ")}` : "all 19 columns" },
    { id: "every_list_lot_imported", pass: c.ok, detail: `${c.listLots} list lots, ${c.rows} rows (${c.supplemented} added from the list), ${c.missingBarcodes.length} missing, ${c.duplicateIds.length} duplicate ids` },
    { id: "transform_errors", pass: i.transformErrors === 0, detail: `${i.transformErrors} errors` },
    { id: "no_card_hidden_for_missing_master", pass: i.hiddenForMissingMaster === 0 && i.inventoryNamesWithoutProduct === 0, detail: `${i.hiddenForMissingMaster} hidden, ${i.inventoryNamesWithoutProduct} names without a product row` },
    { id: "time_budget", pass: i.elapsedMs <= i.budgetMs, detail: `${Math.round(i.elapsedMs / 1000)} s of ${Math.round(i.budgetMs / 1000)} s` },
  ];
  if (i.reconcile) {
    const r = i.reconcile;
    checks.push({ id: "control_totals", pass: r.ok, detail: `units ${r.unitsRows} / ${r.unitsList}, cost value ${r.costValueRowsCents} / ${r.costValueListCents} cents, ${r.mismatches.length} lot mismatches` });
  }
  return { go: checks.every((x) => x.pass), checks };
}

/** Money-like cell → integer cents ("$1,234.50" | 1234.5 | "" → 123450 | 123450 | null). Never floats. */
export function toCents(v: CellValue): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function toUnits(v: CellValue): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export type ReconcileReport = {
  /** Σ UnitsInStock over list lots vs over the final rows (same barcodes). */
  unitsList: number;
  unitsRows: number;
  /** Σ UnitsInStock × UnitCost in cents (inventory value at cost). */
  costValueListCents: number;
  costValueRowsCents: number;
  /** Barcodes whose units or unit cost differ between list and final row (the export is a snapshot). */
  mismatches: { barcode: string; field: "units" | "cost"; list: number | null; row: number | null }[];
  ok: boolean;
};

/**
 * Control totals (the "balances match to the cent" gate of an enterprise cutover):
 * the list API is the inventory of record, so every lot's on-hand units and unit
 * cost in the rows we import must equal the list. A sale between the export and
 * the list call shows up here — the fix is to re-run, never to "accept".
 */
export function reconcileControlTotals(listLots: ListLot[], rows: SheetRow[]): ReconcileReport {
  const byBarcode = new Map<string, SheetRow>();
  for (const r of rows) byBarcode.set(String(r.Barcode ?? "").trim(), r);
  let unitsList = 0, unitsRows = 0, costList = 0, costRows = 0;
  const mismatches: ReconcileReport["mismatches"] = [];
  for (const l of listLots) {
    const bc = String(l.Barcode ?? "").trim();
    const r = byBarcode.get(bc);
    const lu = toUnits(l.UnitsInStock ?? 0);
    const lc = toCents(l.UnitCost ?? null);
    unitsList += lu;
    costList += Math.round(lu * (lc ?? 0));
    if (!r) continue; // missing rows are checkCompleteness's job
    const ru = toUnits(r["Units In Stock"]);
    const rc = toCents(r.Cost);
    unitsRows += ru;
    costRows += Math.round(ru * (rc ?? 0));
    if (ru !== lu) mismatches.push({ barcode: bc, field: "units", list: lu, row: ru });
    if ((rc ?? 0) !== (lc ?? 0)) mismatches.push({ barcode: bc, field: "cost", list: lc, row: rc });
  }
  mismatches.sort((a, b) => (a.barcode < b.barcode ? -1 : a.barcode > b.barcode ? 1 : a.field < b.field ? -1 : 1));
  return { unitsList, unitsRows, costValueListCents: costList, costValueRowsCents: costRows, mismatches,
    ok: mismatches.length === 0 && unitsList === unitsRows && costList === costRows };
}

/* ------------------------------------------------------------------ *
 *  Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */

export function __runCultiveraFetchCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL cultivera-fetch-core: " + msg);
    passed += 1;
  };

  // --- excelSerialToWallClock ---
  ok(excelSerialToWallClock(45658) === "2025-01-01 00:00:00.000000", "whole day");
  ok(excelSerialToWallClock(45658.5) === "2025-01-01 12:00:00.000000", "noon");
  ok(excelSerialToWallClock(45658 + (13 * 3600 + 5 * 60 + 7.25) / 86400) === "2025-01-01 13:05:07.250000", "ms kept");
  ok(excelSerialToWallClock(45658.2) === "2025-01-01 04:48:00.000000", "float error (…79999.9995 ms) rounds, never 04:47:59.999");
  ok(excelSerialToWallClock(46287.770517442) === "2026-09-22 18:29:32.707000", "a real export-style serial to the ms");
  ok(excelSerialToWallClock(45658.99999999) === "2025-01-01 23:59:59.999000", "rounds to ms, not up a day");
  ok(excelSerialToWallClock(61) === "1900-03-01 00:00:00.000000", "61 = 1900-03-01 (first serial past the fake leap day)");
  ok(excelSerialToWallClock(60) === null && excelSerialToWallClock(1) === null, "serials before the fake 1900-02-29 refused");
  ok(excelSerialToWallClock(0) === null, "0 refused");
  ok(excelSerialToWallClock(-5) === null, "negative refused");
  ok(excelSerialToWallClock(109575) === null, "after 2199 refused");
  ok(excelSerialToWallClock(109574) !== null, "2199-12-31 accepted");
  ok(excelSerialToWallClock("45658") === null, "text never converted (already text)");
  ok(excelSerialToWallClock(NaN) === null && excelSerialToWallClock(null) === null && excelSerialToWallClock(undefined) === null, "non-numbers refused");

  // --- utcIsoToPacificWallClock (rehearsal #1: export = UTC − 7 h PDT / − 8 h PST) ---
  ok(utcIsoToPacificWallClock("2026-09-23T01:27:32.707Z") === "2026-09-22 18:27:32.707000", "PDT −7 crosses midnight back");
  ok(utcIsoToPacificWallClock("2026-03-06T00:34:08.493Z") === "2026-03-05 16:34:08.493000", "PST −8");
  ok(utcIsoToPacificWallClock("2025-02-27T20:55:33.953Z") === "2025-02-27 12:55:33.953000", "PST −8 same day");
  ok(utcIsoToPacificWallClock("2024-12-02T21:39:24.907Z") === "2024-12-02 13:39:24.907000", "BOTANICAL ARTS lot 7781 batch");
  ok(utcIsoToPacificWallClock("2026-03-08T09:59:59Z") === "2026-03-08 01:59:59.000000", "just before spring-forward");
  ok(utcIsoToPacificWallClock("2026-03-08T10:00:00Z") === "2026-03-08 03:00:00.000000", "spring-forward skips 02:xx");
  ok(utcIsoToPacificWallClock("2026-11-01T08:30:00Z") === "2026-11-01 01:30:00.000000", "fall-back first 01:30 (PDT)");
  ok(utcIsoToPacificWallClock("2026-11-01T09:30:00Z") === "2026-11-01 01:30:00.000000", "fall-back second 01:30 (PST)");
  ok(utcIsoToPacificWallClock("2026-07-17T19:18:09.2Z") === "2026-07-17 12:18:09.200000", "1-digit fraction = 200 ms");
  ok(utcIsoToPacificWallClock("2026-07-17T19:18:09.2379999Z") === "2026-07-17 12:18:09.237000", "7 digits truncated to ms");
  ok(utcIsoToPacificWallClock(" 2026-07-17T19:18:09Z ") === "2026-07-17 12:18:09.000000", "trimmed, no fraction");
  ok(utcIsoToPacificWallClock("2026-07-17T19:18:09") === null, "no Z refused (zone unknown)");
  ok(utcIsoToPacificWallClock("2026-07-17T19:18:09+00:00") === null, "offset form refused");
  ok(utcIsoToPacificWallClock("2026-07-17") === null && utcIsoToPacificWallClock(null) === null && utcIsoToPacificWallClock(5) === null, "date-only / null / number refused");

  // --- packageSizeLabel (3,826 / 3,826 agree on rehearsal #1) ---
  ok(packageSizeLabel(1, "Grams") === "1.00 Grams", "1 Grams");
  ok(packageSizeLabel("3.500", "Grams") === "3.50 Grams", "text size from the product export");
  ok(packageSizeLabel(0, "Each") === "0.00 Each", "0 Each is real (25 lots)");
  ok(packageSizeLabel(2, "FluidOunce") === "2.00 FluidOunce", "FluidOunce kept verbatim");
  ok(packageSizeLabel("", "Grams") === "" && packageSizeLabel(null, "Grams") === "", "blank size → blank");
  ok(packageSizeLabel(1, "") === "" && packageSizeLabel("x", "Grams") === "", "blank unit / junk → blank");

  // --- comparableName ---
  ok(comparableName("  Buddies  Infused\tPre-roll ") === "buddies infused pre-roll", "collapse + lower");

  // --- supplementListOnly ---
  const prodRows: SheetRow[] = [
    { "Product Name": "Buddies Infused Pre-roll - Runtz - 1g - (I)", "Inventory Type": "Concentrate for Inhalation", Category: "Infused Pre-roll", Brand: "Buddies", Strain: "Runtz", UOM: "Grams", "Package Size": "1.000", Price: 12 },
    { "Product Name": "Twin", Category: "Cartridge", "Inventory Type": "X", Brand: "A", Strain: "S", UOM: "Grams", "Package Size": "1.000", Price: 30 },
    { "Product Name": "twin ", Category: "Disposable Cartridge", "Inventory Type": "X", Brand: "A", Strain: "S", UOM: "Grams", "Package Size": "1.000", Price: 35 },
    { "Product Name": "Exported Thing", Category: "Flower", UOM: "Grams", "Package Size": 3.5, Price: 20 },
  ];
  const exportRows: SheetRow[] = [{ Id: 1, Barcode: "B1", Product: "Exported Thing", Vendor: "V" }];
  const listLots: ListLot[] = [
    { Id: 9177, Barcode: " 20199269334815161 ", ProductName: "Buddies  Infused Pre-roll - Runtz - 1g - (I)", VendorName: "BOTANICAL ARTS", Location: "GREENWAY MARIJUANA", StorageName: "Sales Floor", UnitsAvailable: 2, UnitsInStock: 3, UnitsOnHold: 0, UnitCost: 4, IsMedical: true, IsSample: false, IsNonCannabis: false, Thc: 2.26, Thca: 48.16, Cbd: 0, Cbda: 0.037, Total: 52, TerpeneTotal: null },
    { Id: 1, Barcode: "B1", ProductName: "Exported Thing" },
    { Id: 50, Barcode: "B50", ProductName: "Twin" },
    { Id: 7, Barcode: "B7", ProductName: "Nobody" },
  ];
  const sup = supplementListOnly({ exportRows, listLots, productRows: prodRows, receivedUtcByBarcode: { "20199269334815161": "2024-12-02T21:39:24.907Z" } });
  ok(sup.rows.length === 4, "1 exported + 3 list-only rows");
  ok(sup.rows[0] !== exportRows[0] && sup.rows[0].Product === "Exported Thing", "export row kept, copied");
  ok(sup.supplemented.map((s) => s.id).join(",") === "7,50,9177", "list-only lots sorted by Id");
  const r9177 = sup.rows.find((r) => r.Id === 9177)!;
  ok(r9177.Barcode === "20199269334815161", "barcode trimmed");
  ok(r9177.Category === "Infused Pre-roll" && r9177.InventoryType === "Concentrate for Inhalation" && r9177.Strain === "Runtz" && r9177.Brand === "Buddies", "product columns from the product export");
  ok(r9177["Product Price"] === 12 && r9177["Package Size"] === "1.00 Grams", "price + package size label");
  ok(r9177.Vendor === "BOTANICAL ARTS" && r9177["Storage Location"] === "Sales Floor" && r9177.Location === "GREENWAY MARIJUANA", "lot columns from the list");
  ok(r9177["Units Available For Sale"] === 2 && r9177["Units In Stock"] === 3 && r9177.Cost === 4, "units + cost from the list");
  ok(r9177.Thca === 48.16 && r9177.Total === 52 && r9177["Terpene Total"] === "", "cannabinoids verbatim, null → blank");
  ok(r9177["Is Medical"] === "True" && r9177["Is Cannabis"] === "True" && r9177["Is Sample"] === "False", "booleans in the export's text form");
  ok(r9177["Received date"] === "2024-12-02 13:39:24.907000", "received = batch UTC → Pacific wall clock");
  ok(r9177.Lab === "" && r9177["[COA Y/N]"] === "" && r9177["Quantity Sold"] === "", "unknown export-only columns left blank, never invented");
  ok(INVENTORY_EXPORT_COLUMNS.every((c) => c in r9177) && Object.keys(r9177).length === 32, "exactly the 32 export columns");
  const rw0 = rowFromListLot({ Id: 3, Barcode: "x", ProductName: "p" }, { Category: "Without Category" }, null);
  ok(rw0.Category === "", "\"Without Category\" written blank, like the inventory export");
  ok(rowFromListLot({ Id: 3, Barcode: "x", ProductName: "p" }, { Category: "Flower" }, null).Category === "Flower", "real category kept");
  const s50 = sup.supplemented.find((s) => s.id === 50)!;
  ok(s50.productMatches === 2 && sup.rows.find((r) => r.Id === 50)!.Category === "Cartridge", "2 product rows: first taken, count recorded");
  const s7 = sup.supplemented.find((s) => s.id === 7)!;
  const r7 = sup.rows.find((r) => r.Id === 7)!;
  ok(s7.productMatches === 0 && r7.Category === "" && r7["Package Size"] === "" && r7.Product === "Nobody", "no product row: still a row, product columns blank");
  ok(s7.receivedDate === null && r7["Received date"] === "", "no batch time: blank, never guessed");
  ok(sup.exportOnly.length === 0, "no export-only ids");
  const sup2 = supplementListOnly({ exportRows: [...exportRows, { Id: 99, Barcode: "B99" }], listLots: listLots.slice(1, 2), productRows: [] });
  ok(sup2.exportOnly.join(",") === "99" && sup2.rows.length === 2, "export-only row kept and named");
  const det = JSON.stringify(supplementListOnly({ exportRows, listLots: [...listLots].reverse(), productRows: prodRows }).rows);
  ok(det === JSON.stringify(supplementListOnly({ exportRows, listLots, productRows: prodRows }).rows), "deterministic regardless of list order");

  // --- rewriteDateCells ---
  const rw = rewriteDateCells([{ "Received date": 45658.5, "Expiration date": "" }, { "Received date": "2026-07-02 09:32:07.787000" }]);
  ok(rw.rewritten === 1 && rw.rows[0]["Received date"] === "2025-01-01 12:00:00.000000", "serial rewritten");
  ok(rw.rows[1]["Received date"] === "2026-07-02 09:32:07.787000" && rw.rows[0]["Expiration date"] === "", "text and blanks untouched");

  // --- filterProductsToInventory ---
  const fp = filterProductsToInventory(prodRows, [{ Product: "Exported  thing" }, { Product: "Missing One" }]);
  ok(fp.kept === 1 && fp.dropped === 3 && fp.rows[0]["Product Name"] === "Exported Thing", "keeps only inventory names");
  ok(fp.rows[0].Description === "", "adds the empty Description the transform requires");
  ok(fp.inventoryNamesWithoutProduct.join("|") === "Missing One", "names without a product row are listed");

  // --- checkCompleteness ---
  const cc = checkCompleteness(listLots, sup.rows, sup.supplemented.length, 0);
  ok(cc.ok && cc.missingBarcodes.length === 0 && cc.listLots === 4 && cc.rows === 4, "complete");
  const cc2 = checkCompleteness(listLots, exportRows, 0, 0);
  ok(!cc2.ok && cc2.missingBarcodes.join(",") === "20199269334815161,B50,B7", "export alone is incomplete, missing named");
  const cc3 = checkCompleteness(listLots.slice(1, 2), [...exportRows, { ...exportRows[0] }], 0, 0);
  ok(!cc3.ok && cc3.duplicateIds.join(",") === "1", "duplicate ids fail");
  const cc4 = checkCompleteness(listLots.slice(0, 2), [...exportRows, { Id: 2, Barcode: "OTHER" }], 0, 0);
  ok(!cc4.ok && cc4.rows === 2 && cc4.missingBarcodes.join(",") === "20199269334815161", "enough rows but a list barcode missing → fail");

  // --- goNoGo ---
  const base: GoNoGoInput = {
    loginOk: true, inventoryColumns: [...INVENTORY_EXPORT_COLUMNS], productColumns: [...PRODUCT_EXPORT_COLUMNS], completeness: cc,
    transformErrors: 0, hiddenForMissingMaster: 0, inventoryNamesWithoutProduct: 0, elapsedMs: 600_000, budgetMs: 3_600_000,
  };
  ok(goNoGo(base).go && goNoGo(base).checks.length === 7, "all pass → go");
  ok(!goNoGo({ ...base, loginOk: false }).go, "login fail → no-go");
  ok(!goNoGo({ ...base, inventoryColumns: base.inventoryColumns.filter((c) => c !== "Received date") }).go, "missing inventory column → no-go");
  ok(goNoGo({ ...base, productColumns: [] }).checks.find((c) => c.id === "product_columns")!.detail.startsWith("missing: Product Name"), "missing product columns named");
  ok(!goNoGo({ ...base, completeness: cc2 }).go, "incomplete → no-go");
  ok(!goNoGo({ ...base, transformErrors: 1 }).go, "transform error → no-go");
  ok(!goNoGo({ ...base, hiddenForMissingMaster: 1 }).go && !goNoGo({ ...base, inventoryNamesWithoutProduct: 1 }).go, "a hidden card → no-go");
  ok(!goNoGo({ ...base, elapsedMs: 3_600_001 }).go && goNoGo({ ...base, elapsedMs: 3_600_000 }).go, "budget boundary inclusive");
  {
    const rOk: ReconcileReport = { unitsList: 1, unitsRows: 1, costValueListCents: 5, costValueRowsCents: 5, mismatches: [], ok: true };
    ok(goNoGo({ ...base, reconcile: rOk }).go && goNoGo({ ...base, reconcile: rOk }).checks.length === 8, "control totals pass → 8 checks, go");
    ok(!goNoGo({ ...base, reconcile: { ...rOk, ok: false } }).go, "control totals fail → no-go");
  }

  // --- request bodies are the measured ones ---
  ok(PRODUCT_EXPORT_FILTER.ShowNonCannabis === false && PRODUCT_EXPORT_FILTER.HideMasterProduct === false && PRODUCT_EXPORT_FILTER.HideOutOfStock === false && PRODUCT_EXPORT_FILTER.HideDiscontinued === false && PRODUCT_EXPORT_FILTER.HideNotAvailable === false, "product export body = full-coverage variant");
  ok(INVENTORY_EXPORT_FILTER.HideUnavailable === false && INVENTORY_EXPORT_FILTER.HideInactive === false && INVENTORY_EXPORT_FILTER.ShowOnlySamples === false && INVENTORY_EXPORT_FILTER.HideNonCannabis === false, "inventory export body = every filter off");
  ok(INVENTORY_EXPORT_COLUMNS.length === 32 && PRODUCT_EXPORT_COLUMNS.length === 19, "column counts");

  // ---- toCents / reconcileControlTotals ----
  ok(toCents("$1,234.50") === 123450 && toCents(1234.5) === 123450 && toCents("") === null && toCents(null) === null, "toCents parses money text and numbers");
  ok(toCents(0.1 + 0.2) === 30 && toCents("4") === 400 && toCents("abc") === null, "toCents rounds float noise, refuses junk");
  {
    const L: ListLot[] = [
      { Id: 1, Barcode: "A", ProductName: "x", UnitsInStock: 3, UnitCost: 4.25 },
      { Id: 2, Barcode: " B ", ProductName: "y", UnitsInStock: 10, UnitCost: 1 },
    ];
    const good = reconcileControlTotals(L, [{ Barcode: "A", "Units In Stock": 3, Cost: "$4.25" }, { Barcode: "B", "Units In Stock": "10", Cost: 1 }]);
    ok(good.ok && good.unitsList === 13 && good.unitsRows === 13 && good.costValueListCents === 2275 && good.costValueRowsCents === 2275, "reconcile: equal → ok with cent totals");
    const sold = reconcileControlTotals(L, [{ Barcode: "A", "Units In Stock": 2, Cost: 4.25 }, { Barcode: "B", "Units In Stock": 10, Cost: 1 }]);
    ok(!sold.ok && sold.mismatches.length === 1 && sold.mismatches[0].field === "units" && sold.mismatches[0].list === 3 && sold.mismatches[0].row === 2, "reconcile: a sale between calls is caught");
    const cost = reconcileControlTotals(L, [{ Barcode: "A", "Units In Stock": 3, Cost: 4.26 }, { Barcode: "B", "Units In Stock": 10, Cost: 1 }]);
    ok(!cost.ok && cost.mismatches[0].field === "cost" && cost.mismatches[0].list === 425 && cost.mismatches[0].row === 426, "reconcile: one cent of cost is caught");
    const miss = reconcileControlTotals(L, [{ Barcode: "A", "Units In Stock": 3, Cost: 4.25 }]);
    ok(!miss.ok && miss.mismatches.length === 0 && miss.unitsRows === 3, "reconcile: a missing row breaks the totals");
  }

  return { passed, failed: 0 };
}
