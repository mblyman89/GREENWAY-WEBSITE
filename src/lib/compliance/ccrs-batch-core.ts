/**
 * src/lib/compliance/ccrs-batch-core.ts  (Slice 54)
 *
 * PURE, I/O-free encoding of the WA LCB CCRS file specification for a RETAILER,
 * verified against docs/ccrs-data-model.md (CCRS Upload User Guide CIB 133 + the
 * official .CSV templates). No `server-only` import so it is unit-testable with
 * tsx and importable anywhere.
 *
 * What lives here:
 *  - The exact column header row for each retailer file type.
 *  - The 3-row common file header (SubmittedBy / SubmittedDate / NumberRecords).
 *  - The file-naming convention (UploadType_LicenseNumber_YYYYMMDDHHMMSS.csv).
 *  - The Group 1 → 2 → 3 order-of-operations for a full batch.
 *  - CSV cell escaping consistent with the existing Sale.csv generator.
 *
 * The generators that read the database live in ccrs-batch.ts (server-only);
 * they call into the assemblers here so the spec stays in one factual place.
 */
import { pacificDayKey } from "@/lib/reports/timezone";

/** The seven upload types a WA RETAILER is required to report (Table 1). */
export type CcrsRetailerFileType =
  | "Strain"
  | "Area"
  | "Product"
  | "Inventory"
  | "InventoryAdjustment"
  | "InventoryTransfer"
  | "Sale";

/** Exact template column rows (line 4 of each template) — DO NOT reorder/rename. */
export const CCRS_COLUMNS: Record<CcrsRetailerFileType, readonly string[]> = {
  Strain: ["LicenseNumber", "Strain", "StrainType", "CreatedBy", "CreatedDate"],
  Area: [
    "LicenseNumber",
    "Area",
    "IsQuarantine",
    "ExternalIdentifier",
    "CreatedBy",
    "CreatedDate",
    "UpdatedBy",
    "UpdatedDate",
    "Operation",
  ],
  Product: [
    "LicenseNumber",
    "InventoryCategory",
    "InventoryType",
    "Name",
    "Description",
    "UnitWeightGrams",
    "ExternalIdentifier",
    "CreatedBy",
    "CreatedDate",
    "UpdatedBy",
    "UpdatedDate",
    "Operation",
  ],
  Inventory: [
    "LicenseNumber",
    "Strain",
    "Area",
    "Product",
    "InitialQuantity",
    "QuantityOnHand",
    "TotalCost",
    "IsMedical",
    "ExternalIdentifier",
    "CreatedBy",
    "CreatedDate",
    "UpdatedBy",
    "UpdatedDate",
    "Operation",
  ],
  InventoryAdjustment: [
    "LicenseNumber",
    "InventoryExternalIdentifier",
    "AdjustmentReason",
    "AdjustmentDetail",
    "Quantity",
    "AdjustmentDate",
    "ExternalIdentifier",
    "CreatedBy",
    "CreatedDate",
    "UpdatedBy",
    "UpdatedDate",
    "Operation",
  ],
  InventoryTransfer: [
    "FromLicenseNumber",
    "ToLicenseNumber",
    "FromInventoryExternalIdentifier",
    "ToInventoryExternalIdentifier",
    "Quantity",
    "TransferDate",
    "ExternalIdentifier",
    "CreatedBy",
    "CreatedDate",
    "UpdatedBy",
    "UpdatedDate",
    "Operation",
  ],
  Sale: [
    "LicenseNumber",
    "SoldToLicenseNumber",
    "InventoryExternalIdentifier",
    "PlantExternalIdentifier",
    "SaleType",
    "SaleDate",
    "Quantity",
    "UnitPrice",
    "Discount",
    // A1: the LIVE LCB Sales.csv template uses RetailSalesTax / CannabisExciseTax.
    // (The older Data Model Manual field list calls them SalesTax / OtherTax, but
    // the CSV is validated against the template header, so the template wins.)
    "RetailSalesTax",
    "CannabisExciseTax",
    "SaleExternalIdentifier",
    "SaleDetailExternalIdentifier",
    "CreatedBy",
    "CreatedDate",
    "UpdatedBy",
    "UpdatedDate",
    "Operation",
  ],
};

/**
 * Order-of-operations validation dependency groups. A full batch must be
 * uploaded in this order so each file's referenced rows already exist.
 *   Group 1: Strain, Area, Product (prerequisites)
 *   Group 2: Inventory (depends on Strain+Area+Product)
 *   Group 3: InventoryAdjustment, InventoryTransfer, Sale (depend on Inventory)
 */
export const CCRS_UPLOAD_GROUPS: readonly CcrsRetailerFileType[][] = [
  ["Strain", "Area", "Product"],
  ["Inventory"],
  ["InventoryAdjustment", "InventoryTransfer", "Sale"],
];

/** Flattened upload order (Group 1 → 2 → 3). */
export const CCRS_UPLOAD_ORDER: readonly CcrsRetailerFileType[] = CCRS_UPLOAD_GROUPS.flat();

/** The upload group number (1-based) for a file type. */
export function uploadGroupOf(type: CcrsRetailerFileType): number {
  for (let i = 0; i < CCRS_UPLOAD_GROUPS.length; i += 1) {
    if (CCRS_UPLOAD_GROUPS[i].includes(type)) return i + 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Formatting helpers (kept consistent with ccrs-sales.ts)
// ---------------------------------------------------------------------------

/** CCRS dislikes embedded quotes; strip them and quote if a comma/newline. */
export function ccrsCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  const clean = s.replace(/"/g, "");
  return /[,\n]/.test(clean) ? `"${clean}"` : clean;
}

/**
 * MM/DD/YYYY for the **Pacific** calendar day (B3). Greenway operates in
 * America/Los_Angeles, so a sale/adjustment recorded after ~4–5 PM Pacific is
 * the NEXT day in UTC; formatting from UTC would report the wrong calendar day
 * and could slip a Saturday-evening sale into the next Sun–Sat CCRS week. We
 * derive the Pacific day (via the reporting timezone helper) and reformat.
 */
export function ccrsDate(iso: string | Date): string {
  const key = pacificDayKey(iso); // YYYY-MM-DD in America/Los_Angeles
  const [yyyy, mm, dd] = key.split("-");
  return `${mm}/${dd}/${yyyy}`;
}

/** YYYYMMDDHHMMSS timestamp for the file name (UTC). */
export function ccrsFileStamp(now: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`
  );
}

/**
 * Build the CCRS file name.
 *   Licensees:   UploadType_LicenseNumber_YYYYMMDDHHMMSS.csv
 * When the license number is blank we substitute LICENSE so the shape is clear.
 */
export function ccrsFileName(
  type: CcrsRetailerFileType,
  licenseNumber: string,
  now: Date = new Date(),
): string {
  const lic = (licenseNumber ?? "").trim() || "LICENSE";
  return `${type}_${lic}_${ccrsFileStamp(now)}.csv`;
}

/**
 * Assemble a full CCRS file from data rows.
 * Row 1: SubmittedBy,<value>
 * Row 2: SubmittedDate,<MM/DD/YYYY>
 * Row 3: NumberRecords,<count>   (MUST equal data-row count exactly)
 * Row 4: the column header row
 * Rows 5+: data rows
 */
export function assembleCcrsFile(opts: {
  type: CcrsRetailerFileType;
  submittedBy: string;
  submittedDate?: Date;
  rows: string[][];
}): string {
  const { type, submittedBy, rows } = opts;
  const columns = CCRS_COLUMNS[type];
  const lines: string[] = [];
  lines.push(["SubmittedBy", ccrsCell(submittedBy)].join(","));
  lines.push(["SubmittedDate", ccrsDate(opts.submittedDate ?? new Date())].join(","));
  lines.push(["NumberRecords", String(rows.length)].join(","));
  lines.push(columns.map(ccrsCell).join(","));
  for (const r of rows) {
    // Guard: pad/truncate to the exact column count so a mis-shaped row can't
    // silently corrupt the file.
    const padded = columns.map((_, i) => ccrsCell(r[i] ?? ""));
    lines.push(padded.join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Self-tests (run via tsx). Pure — no I/O.
// ---------------------------------------------------------------------------
export function __runCcrsBatchCoreTests(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
  };

  // Column integrity: every retailer file type has a non-empty column set.
  for (const t of CCRS_UPLOAD_ORDER) {
    assert(CCRS_COLUMNS[t].length > 0, `columns for ${t}`);
  }

  // Sale.csv columns must match the LIVE LCB template exactly (A1).
  assert(CCRS_COLUMNS.Sale.length === 18, "Sale has 18 columns");
  assert(CCRS_COLUMNS.Sale[0] === "LicenseNumber", "Sale col 0");
  assert(CCRS_COLUMNS.Sale[9] === "RetailSalesTax", "Sale col 9 = RetailSalesTax");
  assert(CCRS_COLUMNS.Sale[10] === "CannabisExciseTax", "Sale col 10 = CannabisExciseTax");
  assert(CCRS_COLUMNS.Sale[17] === "Operation", "Sale col 17");

  // Ordering: Strain/Area/Product are group 1; Inventory group 2; Sale group 3.
  assert(uploadGroupOf("Strain") === 1, "Strain group 1");
  assert(uploadGroupOf("Inventory") === 2, "Inventory group 2");
  assert(uploadGroupOf("Sale") === 3, "Sale group 3");
  assert(CCRS_UPLOAD_ORDER.length === 7, "7 retailer files");

  // File name shape.
  const name = ccrsFileName("Inventory", "123456", new Date(Date.UTC(2025, 0, 2, 3, 4, 5)));
  assert(name === "Inventory_123456_20250102030405.csv", "file name shape: " + name);
  const blank = ccrsFileName("Sale", "");
  assert(blank.startsWith("Sale_LICENSE_"), "blank license file name: " + blank);

  // Header assembly + NumberRecords correctness.
  const file = assembleCcrsFile({
    type: "Strain",
    submittedBy: "Jane Doe",
    // B3: SubmittedDate is the Pacific calendar day. Use noon UTC (= ~4–5 AM
    // Pacific) so the intended day (06/15) is unambiguous across DST.
    submittedDate: new Date(Date.UTC(2025, 5, 15, 12, 0, 0)),
    rows: [
      ["123456", "Blue Dream", "Hybrid", "Jane Doe", "06/15/2025"],
      ["123456", "OG Kush", "Indica", "Jane Doe", "06/15/2025"],
    ],
  });
  const fileLines = file.trim().split("\r\n");
  assert(fileLines[0] === "SubmittedBy,Jane Doe", "row1: " + fileLines[0]);
  assert(fileLines[1] === "SubmittedDate,06/15/2025", "row2: " + fileLines[1]);
  assert(fileLines[2] === "NumberRecords,2", "row3: " + fileLines[2]);
  assert(fileLines[3] === CCRS_COLUMNS.Strain.join(","), "row4 header");
  assert(fileLines.length === 6, "2 data rows + 4 header rows = 6 lines");

  // Cell escaping: comma triggers quoting; quotes are stripped.
  assert(ccrsCell("a,b") === '"a,b"', "comma quoting");
  assert(ccrsCell('he said "hi"') === "he said hi", "quote stripping");

  // Row padding: a short row is padded to the column count.
  const padded = assembleCcrsFile({
    type: "Strain",
    submittedBy: "x",
    rows: [["123456", "OnlyTwo"]],
  });
  const dataRow = padded.trim().split("\r\n")[4].split(",");
  assert(dataRow.length === CCRS_COLUMNS.Strain.length, "padded to column count");

  console.log("ccrs-batch-core: all tests passed");
}
