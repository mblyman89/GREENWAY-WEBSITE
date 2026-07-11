/**
 * src/lib/discovery/ccrs.ts
 *
 * PURE, dependency-free parsing + normalization of WSLCB CCRS public-records
 * extract files (Sale, Product, Inventory, LabTest, Strain). No DB, no
 * server-only imports, so it is trivially unit-testable and reusable by the
 * server ingest layer.
 *
 * Grounded in the VERIFIED CCRS data model (docs/CCRS_VERIFIED_SCHEMA.md):
 *   - Every official template CSV begins with a 3-line preamble
 *     (SubmittedBy / SubmittedDate / NumberRecords|CheckSum) then the column
 *     header row. The aggregated public-records extract usually OMITS the
 *     preamble (header on line 1). We AUTO-DETECT which case we're in.
 *   - We key on column NAME (case-insensitive, punctuation-insensitive), never
 *     on position — extracts reorder/rename-case columns over time.
 *
 * STANDING RULES honored:
 *   - NEVER GUESS: unknown columns ignored; unparseable numbers → null (never
 *     fabricated); a file whose header matches no known signature → "unknown".
 *   - Money in MINOR UNITS: dollar columns → integer cents via dollarsToMinor.
 */

import { parseDelimited, detectDelimiter, dollarsToMinor } from "./import";
import type { CcrsFileKind, CcrsSaleType } from "./types";

// ---------------------------------------------------------------------------
// Header normalization + detection
// ---------------------------------------------------------------------------

/** Normalize a column header for matching: lowercase, strip all non-alphanumerics. */
export function normHeader(raw: string): string {
  return (raw ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The 3-line preamble labels that precede the real header in template files. */
const PREAMBLE_FIRST_CELL = new Set(["submittedby"]);

/**
 * Given the full 2D grid of a delimited file, find the index of the real column
 * header row. If row 0's first cell is "SubmittedBy" we skip the 3-line preamble
 * (header at row 3); otherwise the header is row 0.
 */
export function findHeaderRowIndex(rows: string[][]): number {
  const first = normHeader(rows?.[0]?.[0] ?? "");
  if (PREAMBLE_FIRST_CELL.has(first)) return 3;
  return 0;
}

/** Column-name signatures that identify each CCRS file kind (normalized). */
const FILE_SIGNATURES: Array<{ kind: CcrsFileKind; must: string[] }> = [
  { kind: "sale", must: ["licensenumber", "saletype", "unitprice", "quantity", "saledate"] },
  { kind: "product", must: ["licensenumber", "inventorycategory", "inventorytype", "name", "externalidentifier"] },
  { kind: "inventory", must: ["licensenumber", "product", "quantityonhand", "totalcost", "externalidentifier"] },
  { kind: "labtest", must: ["licensenumber", "testname", "testvalue", "inventoryexternalidentifier"] },
  { kind: "strain", must: ["strain", "straintype"] },
];

/** Identify which CCRS file a header row represents (by column names present). */
export function detectFileKind(headerCells: string[]): CcrsFileKind {
  const present = new Set(headerCells.map(normHeader));
  // Rank by how many signature columns match; require ALL "must" columns.
  for (const sig of FILE_SIGNATURES) {
    if (sig.must.every((c) => present.has(c))) return sig.kind;
  }
  return "unknown";
}

/** Build a name→index map from a header row (normalized names). */
export function headerIndex(headerCells: string[]): Map<string, number> {
  const m = new Map<string, number>();
  headerCells.forEach((h, i) => {
    const n = normHeader(h);
    if (n && !m.has(n)) m.set(n, i);
  });
  return m;
}

// ---------------------------------------------------------------------------
// Small typed value helpers (never fabricate: bad input → null)
// ---------------------------------------------------------------------------

function cell(row: string[], idx: Map<string, number>, name: string): string | null {
  const i = idx.get(normHeader(name));
  if (i == null) return null;
  const v = (row[i] ?? "").trim();
  return v.length ? v : null;
}

/** Parse a decimal number; returns null for blanks/non-numeric. */
export function toNum(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[$,]/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Dollar string → integer minor units (cents); null when blank/non-numeric. */
export function moneyToMinor(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const minor = dollarsToMinor(s);
  return minor == null ? null : minor;
}

/**
 * Parse a CCRS date (MM/DD/YYYY, or ISO) into an ISO yyyy-mm-dd string, or null.
 * Kept lenient: accepts M/D/YYYY and yyyy-mm-dd; anything else → null.
 */
export function toIsoDate(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  // ISO already?
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // MM/DD/YYYY (with optional time)
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    const mm = us[1].padStart(2, "0");
    const dd = us[2].padStart(2, "0");
    return `${us[3]}-${mm}-${dd}`;
  }
  return null;
}

/** Map raw CCRS SaleType text → our normalized enum. */
export function normalizeSaleType(raw: string | null | undefined): CcrsSaleType {
  const n = normHeader(raw ?? "");
  if (n === "recreationalretail" || n === "retail") return "retail";
  if (n === "recreationalmedical" || n === "medical") return "medical";
  if (n === "wholesale") return "wholesale";
  return "other";
}

/**
 * Extract a likely brand from a CCRS Product.Name — shared v2 heuristic
 * (Task I, I3): prefix-before-separator with a junk-token blocklist, plus the
 * verified "… by <brand>" convention. Conservative: null when unsure (never
 * guess). Re-exported from brand-core so the transformer path can't drift.
 */
import { extractBrand } from "./brand-core";
export { extractBrand };

/** Derived price per gram in minor units, or null when weight unknown/zero. */
export function pricePerGramMinor(
  unitPriceMinor: number | null,
  unitWeightGrams: number | null,
): number | null {
  if (unitPriceMinor == null || unitWeightGrams == null || unitWeightGrams <= 0) return null;
  return Math.round(unitPriceMinor / unitWeightGrams);
}

// ---------------------------------------------------------------------------
// Normalized record shapes
// ---------------------------------------------------------------------------

export type CcrsSaleRecord = {
  seller_license: string | null;
  buyer_license: string | null;
  sale_type: CcrsSaleType;
  sale_date: string | null;
  quantity_num: number | null;
  unit_price_minor: number | null;
  discount_minor: number | null;
  sales_tax_minor: number | null;
  other_tax_minor: number | null;
  inventory_ext_id: string | null;
  sale_ext_id: string | null;
};

export type CcrsProductRecord = {
  license_number: string | null;
  category: string | null;
  product_type: string | null;
  name: string | null;
  brand: string | null;
  description: string | null;
  unit_weight_grams: number | null;
  ext_id: string | null;
};

export type CcrsInventoryRecord = {
  license_number: string | null;
  strain: string | null;
  area: string | null;
  product_ext_id: string | null;
  initial_quantity: number | null;
  quantity_on_hand: number | null;
  total_cost_minor: number | null;
  is_medical: boolean | null;
  ext_id: string | null;
};

export type CcrsLabRecord = {
  inventory_ext_id: string | null;
  lab_license_number: string | null;
  test_name: string | null;
  test_value_num: number | null;
  test_date: string | null;
};

export type CcrsStrainRecord = {
  strain: string | null;
  strain_type: string | null;
};

// ---------------------------------------------------------------------------
// Row → record mappers
// ---------------------------------------------------------------------------

export function mapSaleRow(row: string[], idx: Map<string, number>): CcrsSaleRecord {
  return {
    seller_license: cell(row, idx, "LicenseNumber"),
    buyer_license: cell(row, idx, "SoldToLicenseNumber"),
    sale_type: normalizeSaleType(cell(row, idx, "SaleType")),
    sale_date: toIsoDate(cell(row, idx, "SaleDate")),
    quantity_num: toNum(cell(row, idx, "Quantity")),
    unit_price_minor: moneyToMinor(cell(row, idx, "UnitPrice")),
    discount_minor: moneyToMinor(cell(row, idx, "Discount")),
    sales_tax_minor: moneyToMinor(cell(row, idx, "SalesTax")),
    other_tax_minor: moneyToMinor(cell(row, idx, "OtherTax")),
    inventory_ext_id: cell(row, idx, "InventoryExternalIdentifier"),
    sale_ext_id: cell(row, idx, "SaleExternalIdentifier"),
  };
}

export function mapProductRow(row: string[], idx: Map<string, number>): CcrsProductRecord {
  const name = cell(row, idx, "Name");
  return {
    license_number: cell(row, idx, "LicenseNumber"),
    category: cell(row, idx, "InventoryCategory"),
    product_type: cell(row, idx, "InventoryType"),
    name,
    brand: extractBrand(name),
    description: cell(row, idx, "Description"),
    unit_weight_grams: toNum(cell(row, idx, "UnitWeightGrams")),
    ext_id: cell(row, idx, "ExternalIdentifier"),
  };
}

export function mapInventoryRow(row: string[], idx: Map<string, number>): CcrsInventoryRecord {
  const med = cell(row, idx, "IsMedical");
  return {
    license_number: cell(row, idx, "LicenseNumber"),
    strain: cell(row, idx, "Strain"),
    area: cell(row, idx, "Area"),
    product_ext_id: cell(row, idx, "Product"),
    initial_quantity: toNum(cell(row, idx, "InitialQuantity")),
    quantity_on_hand: toNum(cell(row, idx, "QuantityOnHand")),
    total_cost_minor: moneyToMinor(cell(row, idx, "TotalCost")),
    is_medical: med == null ? null : /^(true|1|yes|y)$/i.test(med),
    ext_id: cell(row, idx, "ExternalIdentifier"),
  };
}

export function mapLabRow(row: string[], idx: Map<string, number>): CcrsLabRecord {
  return {
    inventory_ext_id: cell(row, idx, "InventoryExternalIdentifier"),
    lab_license_number: cell(row, idx, "LabLicenseNumber"),
    test_name: cell(row, idx, "TestName"),
    test_value_num: toNum(cell(row, idx, "TestValue")),
    test_date: toIsoDate(cell(row, idx, "TestDate")),
  };
}

export function mapStrainRow(row: string[], idx: Map<string, number>): CcrsStrainRecord {
  return {
    strain: cell(row, idx, "Strain"),
    strain_type: cell(row, idx, "StrainType"),
  };
}

// ---------------------------------------------------------------------------
// Top-level parse
// ---------------------------------------------------------------------------

export type ParsedCcrsFile =
  | { kind: "sale"; records: CcrsSaleRecord[] }
  | { kind: "product"; records: CcrsProductRecord[] }
  | { kind: "inventory"; records: CcrsInventoryRecord[] }
  | { kind: "labtest"; records: CcrsLabRecord[] }
  | { kind: "strain"; records: CcrsStrainRecord[] }
  | { kind: "unknown"; records: [] };

/**
 * Parse a raw CCRS extract file's text into typed records. Auto-detects the
 * delimiter, the header row (preamble or not), and the file kind. Returns
 * kind:"unknown" with no records when the header matches no known signature
 * (NEVER GUESS).
 */
export function parseCcrsFile(text: string): ParsedCcrsFile {
  if (!text || !text.trim()) return { kind: "unknown", records: [] };
  const delimiter = detectDelimiter(text);
  const grid = parseDelimited(text, delimiter);
  if (grid.length === 0) return { kind: "unknown", records: [] };

  const headerRow = findHeaderRowIndex(grid);
  const header = grid[headerRow] ?? [];
  const kind = detectFileKind(header);
  if (kind === "unknown") return { kind: "unknown", records: [] };

  const idx = headerIndex(header);
  const dataRows = grid.slice(headerRow + 1).filter((r) => r.some((c) => (c ?? "").trim() !== ""));

  switch (kind) {
    case "sale":
      return { kind, records: dataRows.map((r) => mapSaleRow(r, idx)) };
    case "product":
      return { kind, records: dataRows.map((r) => mapProductRow(r, idx)) };
    case "inventory":
      return { kind, records: dataRows.map((r) => mapInventoryRow(r, idx)) };
    case "labtest":
      return { kind, records: dataRows.map((r) => mapLabRow(r, idx)) };
    case "strain":
      return { kind, records: dataRows.map((r) => mapStrainRow(r, idx)) };
    default:
      return { kind: "unknown", records: [] };
  }
}
