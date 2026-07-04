/**
 * src/lib/discovery/import.ts
 *
 * Pure, dependency-free CSV/TSV parsing for the Discovery direct-import flow.
 * The owner pastes (or uploads) a delimited list of candidate vendors or
 * products; we parse it into normalized DRAFT rows the store then upserts
 * (deduped) as leads. Kept pure (no DB, no server-only) so it is trivially
 * unit-testable and reusable.
 *
 * STANDING RULES honored:
 *   - DRAFTS-ONLY: this only produces plain objects; nothing here writes.
 *   - NEVER GUESS: unrecognized columns are ignored; required fields missing
 *     ⇒ the row is reported as skipped with a reason, never fabricated.
 *   - Money in MINOR UNITS: dollar-looking cost/retail columns are converted
 *     to integer cents here so callers always deal in minor units.
 */

import type { DiscoveryPriority } from "./types";

// ---------------------------------------------------------------------------
// Delimited text parsing (RFC-4180-ish: handles quotes, escaped quotes, CRLF)
// ---------------------------------------------------------------------------

/** Detect the most likely delimiter from the header line. */
export function detectDelimiter(text: string): "," | "\t" | ";" | "|" {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts: Record<string, number> = {
    ",": (firstLine.match(/,/g) || []).length,
    "\t": (firstLine.match(/\t/g) || []).length,
    ";": (firstLine.match(/;/g) || []).length,
    "|": (firstLine.match(/\|/g) || []).length,
  };
  let best: "," | "\t" | ";" | "|" = ",";
  let bestN = -1;
  (Object.keys(counts) as Array<"," | "\t" | ";" | "|">).forEach((d) => {
    if (counts[d] > bestN) {
      bestN = counts[d];
      best = d;
    }
  });
  return best;
}

/**
 * Parse delimited text into a 2D array of string cells. Supports double-quote
 * wrapped fields with escaped quotes ("") and embedded delimiters/newlines.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n?/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // trailing field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // drop fully-empty trailing rows
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

// ---------------------------------------------------------------------------
// Header mapping
// ---------------------------------------------------------------------------

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Map many friendly header spellings to a canonical field key. */
const VENDOR_HEADER_ALIASES: Record<string, string[]> = {
  display_name: ["name", "vendorname", "vendor", "displayname", "company", "companyname", "dba", "tradename"],
  legal_name: ["legalname", "legal", "businessname", "entityname"],
  license_number: ["license", "licensenumber", "licenseno", "licenseid", "wslcblicense", "uba", "ubi"],
  city: ["city", "town"],
  website: ["website", "url", "web", "site"],
  email: ["email", "emailaddress", "contactemail"],
  priority: ["priority"],
  note: ["note", "notes", "comment", "comments"],
};

const PRODUCT_HEADER_ALIASES: Record<string, string[]> = {
  product_name: ["name", "product", "productname", "item", "itemname", "sku", "title"],
  brand: ["brand", "brandname", "producer", "make"],
  category: ["category", "type", "class", "producttype"],
  pack_size: ["packsize", "size", "pack", "weight", "unitsize", "netweight"],
  est_unit_cost: ["cost", "unitcost", "estunitcost", "wholesale", "wholesalecost", "price", "estcost"],
  est_retail: ["retail", "estretail", "msrp", "retailprice", "srp"],
  demand_signal: ["demand", "demandsignal", "signal", "reason", "why"],
  vendor: ["vendor", "vendorname", "supplier", "producer"],
  priority: ["priority"],
  note: ["note", "notes", "comment", "comments"],
};

function buildHeaderIndex(
  headers: string[],
  aliases: Record<string, string[]>,
): Record<string, number> {
  const idx: Record<string, number> = {};
  headers.forEach((h, i) => {
    const n = normHeader(h);
    for (const [canonical, alts] of Object.entries(aliases)) {
      if (idx[canonical] != null) continue;
      if (n === normHeader(canonical) || alts.some((a) => normHeader(a) === n)) {
        idx[canonical] = i;
      }
    }
  });
  return idx;
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function cell(row: string[], i: number | undefined): string | null {
  if (i == null) return null;
  const v = (row[i] ?? "").trim();
  return v.length === 0 ? null : v;
}

/** Parse a dollar-ish string ("$12.50", "12.5", "1,234.00") to integer cents. */
export function dollarsToMinor(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (cleaned.length === 0) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function toPriority(raw: string | null | undefined): DiscoveryPriority {
  const v = (raw ?? "").toLowerCase().trim();
  if (v === "high" || v === "h" || v === "1") return "high";
  if (v === "low" || v === "l" || v === "3") return "low";
  return "med";
}

// ---------------------------------------------------------------------------
// Parsed row shapes
// ---------------------------------------------------------------------------

export type ParsedVendorLead = {
  displayName: string;
  legalName: string | null;
  licenseNumber: string | null;
  city: string | null;
  website: string | null;
  email: string | null;
  priority: DiscoveryPriority;
  note: string | null;
};

export type ParsedProductLead = {
  productName: string;
  brand: string | null;
  category: string | null;
  packSize: string | null;
  estUnitCostMinor: number | null;
  estRetailMinor: number | null;
  demandSignal: string | null;
  vendorName: string | null;
  priority: DiscoveryPriority;
  note: string | null;
};

export type ImportResult<T> = {
  rows: T[];
  /** 1-based data-row numbers (header excluded) that were skipped, with reasons. */
  skipped: { row: number; reason: string }[];
  /** Canonical fields we found headers for (for a "we recognized these" summary). */
  recognized: string[];
  /** Header cells we could not map to a known field. */
  unrecognized: string[];
  total: number;
};

// ---------------------------------------------------------------------------
// Public parse entry points
// ---------------------------------------------------------------------------

export function parseVendorLeadsCsv(text: string): ImportResult<ParsedVendorLead> {
  const delimiter = detectDelimiter(text);
  const grid = parseDelimited(text, delimiter);
  if (grid.length === 0) {
    return { rows: [], skipped: [], recognized: [], unrecognized: [], total: 0 };
  }
  const headers = grid[0];
  const idx = buildHeaderIndex(headers, VENDOR_HEADER_ALIASES);
  const recognized = Object.keys(idx);
  const mappedCols = new Set(Object.values(idx));
  const unrecognized = headers.filter((_, i) => !mappedCols.has(i)).map((h) => h.trim()).filter(Boolean);

  const rows: ParsedVendorLead[] = [];
  const skipped: { row: number; reason: string }[] = [];

  for (let r = 1; r < grid.length; r++) {
    const line = grid[r];
    const displayName = cell(line, idx.display_name) ?? cell(line, idx.legal_name);
    if (!displayName) {
      skipped.push({ row: r, reason: "no vendor name" });
      continue;
    }
    rows.push({
      displayName,
      legalName: cell(line, idx.legal_name),
      licenseNumber: cell(line, idx.license_number),
      city: cell(line, idx.city),
      website: cell(line, idx.website),
      email: cell(line, idx.email),
      priority: toPriority(cell(line, idx.priority)),
      note: cell(line, idx.note),
    });
  }

  return { rows, skipped, recognized, unrecognized, total: grid.length - 1 };
}

export function parseProductLeadsCsv(text: string): ImportResult<ParsedProductLead> {
  const delimiter = detectDelimiter(text);
  const grid = parseDelimited(text, delimiter);
  if (grid.length === 0) {
    return { rows: [], skipped: [], recognized: [], unrecognized: [], total: 0 };
  }
  const headers = grid[0];
  const idx = buildHeaderIndex(headers, PRODUCT_HEADER_ALIASES);
  const recognized = Object.keys(idx);
  const mappedCols = new Set(Object.values(idx));
  const unrecognized = headers.filter((_, i) => !mappedCols.has(i)).map((h) => h.trim()).filter(Boolean);

  const rows: ParsedProductLead[] = [];
  const skipped: { row: number; reason: string }[] = [];

  for (let r = 1; r < grid.length; r++) {
    const line = grid[r];
    const productName = cell(line, idx.product_name);
    if (!productName) {
      skipped.push({ row: r, reason: "no product name" });
      continue;
    }
    rows.push({
      productName,
      brand: cell(line, idx.brand),
      category: cell(line, idx.category),
      packSize: cell(line, idx.pack_size),
      estUnitCostMinor: dollarsToMinor(cell(line, idx.est_unit_cost)),
      estRetailMinor: dollarsToMinor(cell(line, idx.est_retail)),
      demandSignal: cell(line, idx.demand_signal),
      vendorName: cell(line, idx.vendor),
      priority: toPriority(cell(line, idx.priority)),
      note: cell(line, idx.note),
    });
  }

  return { rows, skipped, recognized, unrecognized, total: grid.length - 1 };
}
