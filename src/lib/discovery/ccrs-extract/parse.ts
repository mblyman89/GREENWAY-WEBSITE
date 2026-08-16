/**
 * src/lib/discovery/ccrs-extract/parse.ts
 *
 * PURE, dependency-free parsing of the WSLCB CCRS **monthly public-records
 * extract** tables. This is the REAL extract format — VERIFIED byte-by-byte
 * against the April + May 2026 releases (docs/ROADMAP_BACKOFFICE_FIXES.md
 * Task H) — which differs from the self-report CSV templates that
 * `src/lib/discovery/ccrs.ts` handles:
 *
 *   - Encoding: UTF-16-LE with BOM (a few files, e.g. Harvest, omit the BOM;
 *     Areas is UTF-16 but COMMA-delimited). We sniff per file.
 *   - Delimiter: TAB for every table except Areas (comma).
 *   - No preamble: row 1 IS the header.
 *   - Normalized surrogate keys: integer LicenseeId / ProductId / InventoryId /
 *     SaleHeaderId / StrainId — NOT the 6-digit LicenseNumber (only Licensee &
 *     ManifestHeader carry LicenseNumber).
 *   - Sales split into SaleHeader (who/when/type) + SalesDetail (lines with
 *     Quantity, UnitPrice, Discount). UnitPrice is PER UNIT (verified: the
 *     per-unit reading yields a 54.9% COGS ratio vs 7.2% for the line-total
 *     reading — only per-unit is economically plausible; and wholesale lines
 *     of qty 50 @ $2.20 would otherwise be $0.044/unit).
 *
 * STANDING RULES honored:
 *   - NEVER GUESS: table kind is detected from the exact verified header
 *     signature; unknown headers → kind "unknown" and the caller reports it.
 *     Unparseable numbers → null, never fabricated.
 *   - Money in MINOR UNITS (integer cents) from the moment of parsing.
 *   - Pure module: no server-only, no DOM, no DB — fully unit-testable.
 */

// ---------------------------------------------------------------------------
// Encoding + delimiter sniffing
// ---------------------------------------------------------------------------

/**
 * Decode CCRS extract bytes to text. UTF-16-LE dominates (with or without
 * BOM); we fall back to UTF-8 only when the byte pattern clearly isn't
 * UTF-16 (no BOM AND no NUL bytes in the probe window).
 */
export function decodeCcrsBytes(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) return "";
  const hasBom = bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
  if (hasBom) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  // BOM-less probe: UTF-16-LE ASCII text has NUL high bytes at odd indexes.
  const probeLen = Math.min(bytes.byteLength, 512);
  let nulCount = 0;
  for (let i = 0; i < probeLen; i++) if (bytes[i] === 0) nulCount++;
  if (nulCount > probeLen / 8) return new TextDecoder("utf-16le").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

/** Pick tab vs comma from the first line (tab wins ties — the extract default). */
export function sniffDelimiter(firstLine: string): "\t" | "," {
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return commas > tabs ? "," : "\t";
}

/**
 * Split ONE delimited line into cells, honoring RFC-4180 double quotes.
 *
 * VERIFIED NECESSARY against the real December 2025 extract: the Licensee table
 * ships COMMA-delimited and QUOTED while every other table is tab-delimited and
 * unquoted. 50 of 150 sampled licensee rows (33%) carry quoted commas, e.g.
 *   Active,8,...,413021    ,"GAFCO, LLC",PUFFIN FARM,...,ARLINGTON,...,SNOHOMISH
 * A naive `line.split(",")` shifts every later cell left by one, so Name, DBA,
 * City and County are read from the WRONG columns (observed: name '"GAFCO',
 * dba 'LLC"', city null, county '982235399' — a ZIP code). Address2 values like
 * "D, E" corrupt rows the same way.
 *
 * Rules (RFC 4180): a field may be wrapped in double quotes; inside a quoted
 * field the delimiter is literal and `""` denotes one literal quote. A quote
 * appearing mid-field in an UNQUOTED field is kept verbatim (never repaired).
 *
 * Tab-delimited lines with no quote character take a fast path and are split
 * exactly as before, so the hot tables (SalesDetail/SaleHeader ~10M rows) are
 * unaffected.
 */
export function splitDelimited(line: string, delim: "\t" | ","): string[] {
  // Fast path: nothing quoted on this line → identical to the previous behavior.
  if (line.indexOf('"') < 0) return line.split(delim);

  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'; // escaped quote
          i += 1;
        } else {
          inQuotes = false; // closing quote
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' && cur.length === 0) {
      inQuotes = true; // opening quote (only at field start)
      continue;
    }
    if (ch === delim) {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells;
}

// ---------------------------------------------------------------------------
// Streaming line splitter (UTF-16 text arrives in arbitrary chunks)
// ---------------------------------------------------------------------------

/**
 * Incremental CRLF/LF line splitter. Feed decoded text chunks; it emits
 * complete lines and buffers the trailing partial. flush() returns the final
 * unterminated line, if any.
 *
 * Quotes are deliberately NOT interpreted AT THIS LAYER: verified extract
 * fields never contain embedded newlines, so line boundaries are unambiguous.
 * Quoting IS honored one layer up, when a line is split into cells — see
 * `splitDelimited` (required by the comma-delimited, quoted Licensee table).
 */
export class LineSplitter {
  private buf = "";

  push(chunk: string, onLine: (line: string) => void): void {
    this.buf += chunk;
    for (;;) {
      const nl = this.buf.indexOf("\n");
      if (nl < 0) break;
      let line = this.buf.slice(0, nl);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.buf = this.buf.slice(nl + 1);
      onLine(line);
    }
  }

  flush(onLine: (line: string) => void): void {
    if (this.buf.length > 0) {
      let line = this.buf;
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.buf = "";
      if (line.length > 0) onLine(line);
    }
  }
}

// ---------------------------------------------------------------------------
// Table identification — VERIFIED headers from the real extract
// ---------------------------------------------------------------------------

/** Every table kind present in the monthly extract that the transformer reads. */
export type ExtractTableKind =
  | "licensee"
  | "product"
  | "inventory"
  | "sale_header"
  | "sale_detail"
  | "strain"
  | "lab_result"
  | "manifest_header"
  | "transported_item"
  | "unknown";

/** Tables the transformer deliberately skips (grower/lab-side, irrelevant to retail benchmarks). */
export const SKIPPED_TABLES = new Set([
  "areas",
  "contacts",
  "harvest",
  "integrator",
  "inventoryadjustment",
  "inventoryplanttransfer",
  "plant",
  "plantdestructions",
]);

export function normalizeHeaderCell(raw: string): string {
  return (raw ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Verified header signatures (normalized) — ALL listed columns must be present.
 * Sources: real April + May 2026 extract headers, captured in
 * ccrs_report_April.json / ccrs_report_May.json during Task H analysis.
 */
const SIGNATURES: Array<{ kind: ExtractTableKind; must: string[] }> = [
  {
    kind: "licensee",
    must: ["licenseeid", "licensenumber", "name", "dba", "licensestatus", "city"],
  },
  {
    kind: "sale_header",
    must: ["saleheaderid", "licenseeid", "soldtolicenseeid", "saletype", "saledate"],
  },
  {
    kind: "sale_detail",
    must: ["saledetailid", "saleheaderid", "inventoryid", "quantity", "unitprice"],
  },
  {
    kind: "product",
    must: ["productid", "licenseeid", "inventorytype", "name", "unitweightgrams"],
  },
  {
    kind: "inventory",
    must: ["licenseeid", "inventoryid", "strainid", "productid", "quantityonhand"],
  },
  {
    kind: "strain",
    must: ["strainid", "licenseeid", "name"],
  },
  {
    kind: "lab_result",
    must: ["labresultid", "lablicenseeid", "licenseeid", "testname", "testvalue", "inventoryid"],
  },
  // Task I (I4): manifests carry the SHIPPING VENDOR for retailer inventory.
  // Signatures verified against the real May-2026 ManifestHeader_0 /
  // TransportedItems_0 headers (never guessed).
  {
    kind: "manifest_header",
    must: ["externalmanifestidentifier", "originlicensenumber", "originlicensename", "isdeleted"],
  },
  {
    kind: "transported_item",
    must: ["transporteditemsid", "externalmanifestidentifier", "inventoryexternalidentifier", "description"],
  },
];

export function detectExtractTable(headerCells: string[]): ExtractTableKind {
  const present = new Set(headerCells.map(normalizeHeaderCell));
  for (const sig of SIGNATURES) {
    if (sig.must.every((c) => present.has(c))) return sig.kind;
  }
  return "unknown";
}

/** Derive the table name from a nested zip entry name, e.g. "…/SaleHeader_3.zip" → "saleheader". */
export function tableNameFromZipEntry(entryName: string): string {
  const base = entryName.split("/").pop() ?? entryName;
  return base
    .replace(/\.zip$/i, "")
    .replace(/\.csv$/i, "")
    .replace(/_\d+$/, "")
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Typed cell helpers (never fabricate — bad input → null)
// ---------------------------------------------------------------------------

export function headerIndexMap(headerCells: string[]): Map<string, number> {
  const m = new Map<string, number>();
  headerCells.forEach((h, i) => {
    const n = normalizeHeaderCell(h);
    if (n && !m.has(n)) m.set(n, i);
  });
  return m;
}

function cell(row: string[], idx: Map<string, number>, name: string): string | null {
  const i = idx.get(name);
  if (i == null || i >= row.length) return null;
  const v = row[i].trim();
  return v.length ? v : null;
}

export function toNum(raw: string | null): number | null {
  if (raw == null) return null;
  const s = raw.replace(/[$,]/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Dollar string → integer minor units (cents). The extract writes decimals
 * like "4.20", ".00", "12". Uses string math (never float×100) so values like
 * 19.99 can't drift. Bad input → null.
 */
export function moneyToMinor(raw: string | null): number | null {
  if (raw == null) return null;
  const s = raw.replace(/[$,]/g, "").trim();
  if (s === "") return null;
  const m = s.match(/^(-)?(\d*)(?:\.(\d{0,}))?$/);
  if (!m) return null;
  const sign = m[1] ? -1 : 1;
  const whole = m[2] ? Number(m[2]) : 0;
  const fracRaw = (m[3] ?? "").padEnd(2, "0");
  // Round half-up on the 3rd decimal digit when present.
  let centsPart = Number(fracRaw.slice(0, 2) || "0");
  if (fracRaw.length > 2 && Number(fracRaw[2]) >= 5) centsPart += 1;
  if (!Number.isFinite(whole) || !Number.isFinite(centsPart)) return null;
  return sign * (whole * 100 + centsPart);
}

/** "2026-05-31 00:00:00" | "2026-05-31" | "5/31/2026" → "2026-05-31"; else null. */
export function toIsoDate(raw: string | null): string | null {
  if (raw == null) return null;
  const s = raw.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}

export function toBool(raw: string | null): boolean | null {
  if (raw == null) return null;
  if (/^(true|1|yes|y)$/i.test(raw)) return true;
  if (/^(false|0|no|n)$/i.test(raw)) return false;
  return null;
}

// ---------------------------------------------------------------------------
// Row record shapes + mappers (only the columns the transformer needs)
// ---------------------------------------------------------------------------

export type LicenseeRow = {
  licenseeId: string;
  licenseNumber: string | null; // 6-digit, trailing-space-padded in the raw data
  name: string | null;
  dba: string | null;
  status: string | null;
  city: string | null;
  county: string | null;
};

export type SaleHeaderRow = {
  saleHeaderId: string;
  sellerLicenseeId: string | null;
  buyerLicenseeId: string | null;
  saleType: "retail" | "medical" | "wholesale" | "other";
  saleDate: string | null; // ISO yyyy-mm-dd
};

export type SaleDetailRow = {
  saleHeaderId: string | null;
  inventoryId: string | null;
  quantity: number | null;
  unitPriceMinor: number | null; // PER-UNIT cents (verified)
  discountMinor: number | null; // per-LINE cents
  isDeleted: boolean | null;
};

export type ProductRow = {
  productId: string;
  licenseeId: string | null;
  inventoryType: string | null;
  name: string | null;
  unitWeightGrams: number | null;
};

export type InventoryRow = {
  inventoryId: string;
  licenseeId: string | null;
  productId: string | null;
  strainId: string | null;
  /**
   * Task I (I4): the lot's ExternalIdentifier — joins
   * TransportedItems.InventoryExternalIdentifier so a retail lot can carry its
   * SHIPPING VENDOR (manifest origin). Verified on the real May-2026 delivery.
   */
  externalIdentifier: string | null;
  /**
   * Inventory.IsMedical — the lot is a DOH-COMPLIANT product under
   * chapter 246-70 WAC. Verified present as column [9] of the real December
   * 2025 Inventory table, carrying the literal strings "True" / "False".
   *
   * THIS IS A PRODUCT FACT, NOT A SALES FACT. Do not confuse it with
   * SaleHeader.SaleType = 'RecreationalMedical', which says the SALE was made
   * to a registered patient. A DOH-compliant product sold to a recreational
   * customer is not a medical sale, and an ordinary product sold to a patient
   * is one. The two signals are kept strictly separate.
   *
   * null = the cell was blank or unreadable ("never measured"), which is NOT
   * the same as False.
   */
  isMedical: boolean | null;
};

/** Task I (I4): manifest header — who SHIPPED product (the vendor side). */
export type ManifestHeaderRow = {
  externalManifestIdentifier: string;
  originLicenseNumber: string | null;
  originLicenseName: string | null;
  isDeleted: boolean | null;
};

/** Task I (I4): one shipped item on a manifest. */
export type TransportedItemRow = {
  externalManifestIdentifier: string | null;
  inventoryExternalIdentifier: string | null;
  description: string | null;
  isDeleted: boolean | null;
};

export type StrainRow = {
  strainId: string;
  name: string | null;
};

export type LabResultRow = {
  inventoryId: string | null;
  testName: string | null;
  testValue: number | null;
  /**
   * True when the lab reported a NON-DETECT ("<0.061"), i.e. the analyte was
   * below the method's reporting limit. testValue is null in that case: the
   * true amount is unknown, only bounded. Treating it as 0 would be a guess.
   */
  censored: boolean;
};

/**
 * The two potency rollups we benchmark. Only the TOTAL figures are used:
 * "Total THC" already folds THCA in via the decarboxylation formula, so also
 * counting "delta-9-THCA" (a separate row in this EAV table) would double
 * count the same cannabinoid.
 */
export type PotencyAnalyte = "total_thc" | "total_cbd";

/**
 * Classify a LabResult TestName as a potency rollup we can benchmark.
 *
 * LabResult is a LONG/EAV table: one ROW PER TEST, carrying TestName +
 * TestValue. Verified against Michael's real December 2025 extract, the
 * potency TestNames present are:
 *
 *   Potency - Total THC (mg/g)      <- used (total_thc)
 *   Potency - Total CBD (mg/g)      <- used (total_cbd)
 *   Potency - CBD (mg/g)            <- NOT used (component of Total CBD)
 *   Potency - CBDA (mg/g)           <- NOT used (component of Total CBD)
 *   Potency - delta-9-THCA (mg/g)   <- NOT used (component of Total THC)
 *
 * Non-potency families in the same table (all deliberately excluded) are
 * "Pesticide - ", "Residual Solvent - ", "Heavy Metal - ", "Mycotoxin - " and
 * "Microbiological - ".
 *
 * UNITS ARE VERIFIED, NEVER ASSUMED. The unit is part of the TestName and this
 * function REQUIRES a literal "(mg/g)". A potency row in any other unit
 * returns null rather than being silently rescaled — if WSLCB ever emits a
 * percent-based name, it is skipped and reported, not misread by a factor
 * of ten (1.2 mg/g is 0.12%, not 1.2%).
 */
export function classifyPotencyTest(testName: string | null): PotencyAnalyte | null {
  if (!testName) return null;
  const n = testName.toLowerCase();
  if (!n.startsWith("potency")) return null;
  // Unit gate: only the verified mg/g form is understood.
  if (!n.includes("(mg/g)")) return null;
  if (n.includes("total thc")) return "total_thc";
  if (n.includes("total cbd")) return "total_cbd";
  return null;
}

/** Outcome of reading a LabResult TestValue cell. */
export type ParsedTestValue =
  | { kind: "value"; value: number }
  | { kind: "censored" }
  | { kind: "none" };

/**
 * Parse a LabResult TestValue.
 *
 * Real values in the December extract are plain decimals ("1.2", "0.71", "2.2",
 * "2") AND censored non-detects ("<0.061", "<0.5"). A naive Number("<0.061")
 * is NaN, so censored rows must be recognized explicitly or they silently
 * vanish (or worse, get coerced to 0 and drag every average down).
 *
 * A censored row is reported as censored WITHOUT a value: all we honestly know
 * is "below the reporting limit", not the amount. Callers count these
 * separately and exclude them from averages rather than inventing a number.
 */
export function parseTestValue(raw: string | null): ParsedTestValue {
  if (raw == null) return { kind: "none" };
  const s = raw.trim();
  if (s === "") return { kind: "none" };
  if (s.startsWith("<")) {
    // Only treat it as a non-detect when what follows is actually a number;
    // anything else is unreadable, not censored. The emptiness check is
    // required: Number("") is 0, which is finite, so a bare "<" would
    // otherwise masquerade as a valid reporting limit.
    const rest = s.slice(1).trim();
    if (rest === "") return { kind: "none" };
    const n = Number(rest);
    return Number.isFinite(n) ? { kind: "censored" } : { kind: "none" };
  }
  const n = Number(s);
  return Number.isFinite(n) ? { kind: "value", value: n } : { kind: "none" };
}

export function normalizeSaleType(raw: string | null): SaleHeaderRow["saleType"] {
  const n = normalizeHeaderCell(raw ?? "");
  if (n === "recreationalretail" || n === "retail") return "retail";
  if (n === "recreationalmedical" || n === "medical") return "medical";
  if (n === "wholesale") return "wholesale";
  return "other";
}

export function mapLicensee(row: string[], idx: Map<string, number>): LicenseeRow | null {
  const licenseeId = cell(row, idx, "licenseeid");
  if (!licenseeId) return null;
  return {
    licenseeId,
    licenseNumber: cell(row, idx, "licensenumber"),
    name: cell(row, idx, "name"),
    dba: cell(row, idx, "dba"),
    status: cell(row, idx, "licensestatus"),
    city: cell(row, idx, "city"),
    county: cell(row, idx, "county"),
  };
}

export function mapSaleHeader(row: string[], idx: Map<string, number>): SaleHeaderRow | null {
  const saleHeaderId = cell(row, idx, "saleheaderid");
  if (!saleHeaderId) return null;
  return {
    saleHeaderId,
    sellerLicenseeId: cell(row, idx, "licenseeid"),
    buyerLicenseeId: cell(row, idx, "soldtolicenseeid"),
    saleType: normalizeSaleType(cell(row, idx, "saletype")),
    saleDate: toIsoDate(cell(row, idx, "saledate")),
  };
}

export function mapSaleDetail(row: string[], idx: Map<string, number>): SaleDetailRow {
  return {
    saleHeaderId: cell(row, idx, "saleheaderid"),
    inventoryId: cell(row, idx, "inventoryid"),
    quantity: toNum(cell(row, idx, "quantity")),
    unitPriceMinor: moneyToMinor(cell(row, idx, "unitprice")),
    discountMinor: moneyToMinor(cell(row, idx, "discount")),
    isDeleted: toBool(cell(row, idx, "isdeleted")),
  };
}

export function mapProduct(row: string[], idx: Map<string, number>): ProductRow | null {
  const productId = cell(row, idx, "productid");
  if (!productId) return null;
  return {
    productId,
    licenseeId: cell(row, idx, "licenseeid"),
    inventoryType: cell(row, idx, "inventorytype"),
    name: cell(row, idx, "name"),
    unitWeightGrams: toNum(cell(row, idx, "unitweightgrams")),
  };
}

export function mapInventory(row: string[], idx: Map<string, number>): InventoryRow | null {
  const inventoryId = cell(row, idx, "inventoryid");
  if (!inventoryId) return null;
  return {
    inventoryId,
    licenseeId: cell(row, idx, "licenseeid"),
    productId: cell(row, idx, "productid"),
    strainId: cell(row, idx, "strainid"),
    externalIdentifier: cell(row, idx, "externalidentifier"),
    // Column [9] of the real Inventory table. toBool already accepts the
    // literal "True"/"False" the extract uses, and returns null for anything
    // else so an unreadable cell is never silently read as "not medical".
    isMedical: toBool(cell(row, idx, "ismedical")),
  };
}

export function mapManifestHeader(row: string[], idx: Map<string, number>): ManifestHeaderRow | null {
  const externalManifestIdentifier = cell(row, idx, "externalmanifestidentifier");
  if (!externalManifestIdentifier) return null;
  return {
    externalManifestIdentifier,
    originLicenseNumber: cell(row, idx, "originlicensenumber"),
    originLicenseName: cell(row, idx, "originlicensename"),
    isDeleted: toBool(cell(row, idx, "isdeleted")),
  };
}

export function mapTransportedItem(row: string[], idx: Map<string, number>): TransportedItemRow {
  return {
    externalManifestIdentifier: cell(row, idx, "externalmanifestidentifier"),
    inventoryExternalIdentifier: cell(row, idx, "inventoryexternalidentifier"),
    description: cell(row, idx, "description"),
    isDeleted: toBool(cell(row, idx, "isdeleted")),
  };
}

export function mapStrain(row: string[], idx: Map<string, number>): StrainRow | null {
  const strainId = cell(row, idx, "strainid");
  if (!strainId) return null;
  return { strainId, name: cell(row, idx, "name") };
}

export function mapLabResult(row: string[], idx: Map<string, number>): LabResultRow {
  // TestValue is parsed through parseTestValue (NOT toNum) so a censored
  // non-detect like "<0.061" is recognized as such instead of becoming NaN →
  // null and being indistinguishable from a blank cell.
  const parsed = parseTestValue(cell(row, idx, "testvalue"));
  return {
    inventoryId: cell(row, idx, "inventoryid"),
    testName: cell(row, idx, "testname"),
    testValue: parsed.kind === "value" ? parsed.value : null,
    censored: parsed.kind === "censored",
  };
}

// ---------------------------------------------------------------------------
// Streaming table reader: decoded-text chunks → header detection → typed rows
// ---------------------------------------------------------------------------

export type TableStreamResult = {
  kind: ExtractTableKind;
  /** Data rows seen (excluding header), regardless of kind. */
  rowCount: number;
};

/**
 * Consume a decoded-text chunk stream for ONE table file. Detects delimiter +
 * kind from the header line, then invokes onRow(kind, cells, idx) per data row.
 * The caller maps cells with the mapper for the detected kind. Returns the
 * detected kind + row count. Rows with a column count wildly off the header
 * are skipped (defensive; verified extracts are clean).
 */
export async function streamTable(
  chunks: AsyncIterable<string>,
  onRow: (kind: ExtractTableKind, cells: string[], idx: Map<string, number>) => void,
): Promise<TableStreamResult> {
  const splitter = new LineSplitter();
  let delim: "\t" | "," | null = null;
  let kind: ExtractTableKind = "unknown";
  let idx: Map<string, number> | null = null;
  let headerLen = 0;
  let rowCount = 0;

  const handleLine = (line: string): void => {
    if (line.length === 0) return;
    if (idx == null) {
      delim = sniffDelimiter(line);
      const header = splitDelimited(line, delim);
      kind = detectExtractTable(header);
      idx = headerIndexMap(header);
      headerLen = header.length;
      return;
    }
    if (kind === "unknown") {
      rowCount++;
      return;
    }
    const cells = splitDelimited(line, delim as "\t" | ",");
    // Defensive: tolerate ±2 columns (trailing tabs happen); skip anything worse.
    if (cells.length + 2 < headerLen) return;
    rowCount++;
    onRow(kind, cells, idx);
  };

  for await (const chunk of chunks) {
    splitter.push(chunk, handleLine);
  }
  splitter.flush(handleLine);
  return { kind, rowCount };
}

/**
 * Adapt a ReadableStream<Uint8Array> of raw CCRS file bytes into decoded text
 * chunks. Buffers only up to the first 2 bytes for BOM detection; decoding is
 * incremental via TextDecoder streaming mode.
 */
export async function* decodeStream(byteStream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = byteStream.getReader();
  let decoder: TextDecoder | null = null;
  let pending: Uint8Array | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let bytes = value;
    if (decoder == null) {
      if (pending) {
        const merged = new Uint8Array(pending.byteLength + bytes.byteLength);
        merged.set(pending, 0);
        merged.set(bytes, pending.byteLength);
        bytes = merged;
        pending = null;
      }
      if (bytes.byteLength < 2) {
        pending = bytes;
        continue;
      }
      const hasBom = bytes[0] === 0xff && bytes[1] === 0xfe;
      if (hasBom) {
        decoder = new TextDecoder("utf-16le");
        bytes = bytes.subarray(2);
      } else {
        const probeLen = Math.min(bytes.byteLength, 512);
        let nulCount = 0;
        for (let i = 0; i < probeLen; i++) if (bytes[i] === 0) nulCount++;
        decoder = new TextDecoder(nulCount > probeLen / 8 ? "utf-16le" : "utf-8");
      }
    }
    const text = decoder.decode(bytes, { stream: true });
    if (text) yield text;
  }
  if (pending && pending.byteLength > 0) {
    // Sub-2-byte file: decode whatever we have as utf-8.
    yield new TextDecoder("utf-8").decode(pending);
  } else if (decoder) {
    const tail = decoder.decode();
    if (tail) yield tail;
  }
}
