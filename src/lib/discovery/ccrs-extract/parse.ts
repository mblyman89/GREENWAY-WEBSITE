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

// ---------------------------------------------------------------------------
// Streaming line splitter (UTF-16 text arrives in arbitrary chunks)
// ---------------------------------------------------------------------------

/**
 * Incremental CRLF/LF line splitter. Feed decoded text chunks; it emits
 * complete lines and buffers the trailing partial. Quotes are NOT interpreted:
 * verified extract fields never contain embedded newlines (tab-delimited,
 * unquoted). flush() returns the final unterminated line, if any.
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
};

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
  return {
    inventoryId: cell(row, idx, "inventoryid"),
    testName: cell(row, idx, "testname"),
    testValue: toNum(cell(row, idx, "testvalue")),
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
      const header = line.split(delim);
      kind = detectExtractTable(header);
      idx = headerIndexMap(header);
      headerLen = header.length;
      return;
    }
    if (kind === "unknown") {
      rowCount++;
      return;
    }
    const cells = line.split(delim as string);
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
