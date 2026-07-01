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
 * Valid CCRS `SaleType` values (Data Model File Specifications Manual, verified).
 * A retailer emits RecreationalRetail for standard sales and RecreationalMedical
 * for qualifying medical (DOH-authorized, tax-exempt) sales. Wholesale is for
 * producer/processor transactions, not retail.
 */
export const CCRS_SALE_TYPES = [
  "RecreationalRetail",
  "RecreationalMedical",
  "Wholesale",
] as const;
export type CcrsSaleType = (typeof CCRS_SALE_TYPES)[number];

/**
 * Resolve the CCRS SaleType for a RETAIL order (B1). PURE. A medical order
 * (Greenway is DOH medical-endorsed; the sale is recorded against a qualifying
 * patient) is `RecreationalMedical`; everything else is `RecreationalRetail`.
 * Never returns an invalid enum value.
 */
export function saleTypeForOrder(isMedical: boolean): CcrsSaleType {
  return isMedical ? "RecreationalMedical" : "RecreationalRetail";
}

/**
 * Valid CCRS `StrainType` values (Data Model Manual, verified): exactly these
 * three. CCRS rejects any other token (including "NotApplicable").
 */
export const CCRS_STRAIN_TYPES = ["Indica", "Sativa", "Hybrid"] as const;
export type CcrsStrainType = (typeof CCRS_STRAIN_TYPES)[number];

/**
 * Normalize an arbitrary POS strain-type label to a valid CCRS StrainType (B2).
 * PURE. Returns the normalized value plus whether it had to be defaulted (so the
 * caller can warn — DRAFTS-ONLY, we never silently invent). Rules:
 *   - exact/lowercase Indica|Sativa|Hybrid → itself
 *   - anything containing both indica & sativa, a ratio (e.g. "60/40"), or
 *     "indica-dominant"/"sativa-dominant"/"blend"/"cbd" → Hybrid
 *   - pure "indica"/"sativa" substrings → that type
 *   - unknown/empty → Hybrid (the safe superset) + defaulted=true
 */
export function normalizeStrainType(
  raw: string | null | undefined,
): { value: CcrsStrainType; defaulted: boolean } {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return { value: "Hybrid", defaulted: true };
  if (s === "indica") return { value: "Indica", defaulted: false };
  if (s === "sativa") return { value: "Sativa", defaulted: false };
  if (s === "hybrid") return { value: "Hybrid", defaulted: false };

  const hasIndica = s.includes("indica");
  const hasSativa = s.includes("sativa");
  const looksHybrid =
    s.includes("hybrid") ||
    s.includes("blend") ||
    s.includes("cbd") ||
    /\d+\s*[\/:%-]\s*\d+/.test(s) || // ratios like 60/40, 1:1
    (hasIndica && hasSativa);
  if (looksHybrid) return { value: "Hybrid", defaulted: false };
  if (hasIndica) return { value: "Indica", defaulted: false };
  if (hasSativa) return { value: "Sativa", defaulted: false };
  // "indica-dominant"/"sativa-dominant" handled above via substring; anything
  // else (e.g. "NotApplicable", "Unknown", brand words) → Hybrid + flag.
  return { value: "Hybrid", defaulted: true };
}

/* ------------------------------------------------------------------ *
 * Product classification: InventoryCategory + InventoryType (C1)
 *
 * GROUNDED IN: CCRS Upload User Guide (2026-02), "Table 2. Valid
 * InventoryCategory and InventoryType values" (page 13-14). This reflects the
 * CCRS v2023+ changes (e.g. concentrates moved to EndProduct, "Clones"/
 * "Cannabis Mix"/"Usable Cannabis" naming) and SUPERSEDES the older Data Model
 * Manual layout. Downloaded + reconstructed 2026-02, /tmp/ccrs-live/UploadGuide.
 *
 * NOTE (grounding): the guide's Description/UnitWeightGrams notes reference the
 * spelling "Useable cannabis" and "Usable Cannabis" inconsistently. Table 2 is
 * the enum-of-record, and it lists "Usable Cannabis" (single-l 'Usable').
 * ------------------------------------------------------------------ */

export const CCRS_INVENTORY_CATEGORIES = [
  "PropagationMaterial",
  "HarvestedMaterial",
  "IntermediateProduct",
  "EndProduct",
] as const;
export type CcrsInventoryCategory = (typeof CCRS_INVENTORY_CATEGORIES)[number];

/**
 * category -> the exact set of valid InventoryType strings, per Table 2 of the
 * 2026-02 Upload User Guide. Case/spacing here is authoritative (this is what
 * CCRS validates against). Employees pick these in the POS mapping UI.
 */
export const CCRS_INVENTORY_TYPES: Record<CcrsInventoryCategory, readonly string[]> = {
  PropagationMaterial: ["Clones", "Plant", "Seed"],
  HarvestedMaterial: [
    "Flower Lot",
    "Flower Unlotted",
    "Other Material Lot",
    "Other Material Unlotted",
    "Wet Flower",
    "Waste",
  ],
  IntermediateProduct: [
    "Cannabis Mix",
    "CBD",
    "Food Grade Solvent Concentrate",
    "Infused Cooking Medium",
    "Waste",
  ],
  EndProduct: [
    "Cannabis Mix Infused",
    "Cannabis Mix Packaged",
    "Capsule",
    "CO2 Concentrate",
    "Concentrate for Inhalation",
    "Ethanol Concentrate",
    "Hydrocarbon Concentrate",
    "Liquid Edible",
    "Non-Solvent Based Concentrate",
    "Sample Jar",
    "Solid Edible",
    "Suppository",
    "Tincture",
    "Topical Ointment",
    "Transdermal",
    "Usable Cannabis",
    "Waste",
  ],
} as const;

export type ProductClassificationResult =
  | { ok: true; category: CcrsInventoryCategory; type: string }
  | { ok: false; category: string; type: string; error: string };

/**
 * Validate a POS category/type pair against the CCRS enum (C1). PURE.
 *
 * DRAFTS-ONLY / NEVER-INVENT policy: we DO NOT coerce or guess a value. If the
 * pair is unknown we return ok:false with a precise, employee-facing error so
 * the human can correct the mapping before the file is submitted. The caller
 * keeps whatever the POS provided (so nothing is silently rewritten) and
 * surfaces the error as an ERROR-level sync issue.
 *
 * Matching is case-insensitive and whitespace-tolerant on input, but the
 * returned canonical `type`/`category` use the exact CCRS spelling.
 */
export function validateProductClassification(
  rawCategory: string | null | undefined,
  rawType: string | null | undefined,
): ProductClassificationResult {
  const catIn = (rawCategory ?? "").trim();
  const typeIn = (rawType ?? "").trim();

  if (!catIn && !typeIn) {
    return { ok: false, category: catIn, type: typeIn, error: "InventoryCategory and InventoryType are both missing." };
  }
  if (!catIn) {
    return { ok: false, category: catIn, type: typeIn, error: "InventoryCategory is missing." };
  }
  if (!typeIn) {
    return { ok: false, category: catIn, type: typeIn, error: "InventoryType is missing." };
  }

  // Canonicalize the category (case-insensitive).
  const canonCat = CCRS_INVENTORY_CATEGORIES.find(
    (c) => c.toLowerCase() === catIn.toLowerCase(),
  );
  if (!canonCat) {
    return {
      ok: false,
      category: catIn,
      type: typeIn,
      error: `InventoryCategory "${catIn}" is not a valid CCRS category (expected one of: ${CCRS_INVENTORY_CATEGORIES.join(", ")}).`,
    };
  }

  // Canonicalize the type within the category (case- and space-insensitive).
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const validTypes = CCRS_INVENTORY_TYPES[canonCat];
  const canonType = validTypes.find((t) => norm(t) === norm(typeIn));
  if (!canonType) {
    return {
      ok: false,
      category: catIn,
      type: typeIn,
      error: `InventoryType "${typeIn}" is not valid for category "${canonCat}" (expected one of: ${validTypes.join(", ")}).`,
    };
  }

  return { ok: true, category: canonCat, type: canonType };
}

/**
 * Clamp a text value to a max length (C2). PURE. Returns the clamped value plus
 * whether it was truncated (so the caller can warn — DRAFTS-ONLY, the employee
 * should shorten the source rather than ship a silently-cut field). CCRS text
 * limits are BYTES-agnostic character counts; we count code units which matches
 * the LCB validator's behavior for the ASCII/BMP data these fields carry.
 */
export function clampText(
  value: string | null | undefined,
  maxLen: number,
): { value: string; truncated: boolean } {
  const s = (value ?? "").trim();
  if (s.length <= maxLen) return { value: s, truncated: false };
  return { value: s.slice(0, maxLen), truncated: true };
}

/** CCRS text-length limits for Product.csv fields (Upload User Guide 2026-02). */
export const CCRS_PRODUCT_NAME_MAX = 75;
export const CCRS_PRODUCT_DESCRIPTION_MAX = 250;

/* ------------------------------------------------------------------ *
 * Sync-issue severity classification (Slice 93 — guardrail integrity)
 *
 * File builders emit free-text `warnings`. Some are BATCH-BLOCKING (the LCB will
 * reject the whole upload — e.g. an invalid InventoryCategory/InventoryType or a
 * missing required identifier) and MUST surface as `error`; others are advisory.
 * `buildCcrsBatch` previously promoted EVERY warning to `warning` severity, so a
 * blocking mis-mapping looked identical to a cosmetic note. This classifier is
 * the single source of truth for that decision. PURE.
 * ------------------------------------------------------------------ */

export type CcrsIssueSeverity = "error" | "warning";

/**
 * Substrings that mark a warning as batch-blocking. Kept lowercase; matched
 * case-insensitively. Grounded in the actual builder messages + CCRS behavior:
 * a rejected file in an early upload group blocks every dependent file.
 */
const CCRS_BLOCKING_MARKERS: readonly string[] = [
  "error —", // explicit error prefix used by builders (em dash)
  "error -", // hyphen variant, defensive
  "not a valid ccrs", // invalid enum value
  "is not valid for category", // invalid category/type pair
  "no usable external identifier", // inventory row cannot be reported
  "no usable ccrs external identifier",
  "cannot be reported",
  "supabase is not configured",
];

/**
 * Classify a builder warning into a sync-issue severity. PURE.
 * A message is an `error` iff it contains any blocking marker (case-insensitive);
 * otherwise it is a `warning`. Never throws.
 */
export function classifyWarning(message: string | null | undefined): CcrsIssueSeverity {
  const s = (message ?? "").toLowerCase();
  if (!s) return "warning";
  for (const marker of CCRS_BLOCKING_MARKERS) {
    if (s.includes(marker)) return "error";
  }
  return "warning";
}

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

/* ------------------------------------------------------------------ *
 * Sale numeric-column safety (Slice 96 — defense in depth)
 *
 * The Sale builder already skips zero-qty / no-price lines, but a numeric
 * anomaly (NaN, negative, non-numeric, or a mis-formatted money value) that
 * slips through would silently corrupt the Sale.csv the LCB validates. This
 * PURE check inspects the EMITTED Sale rows (strings) and flags anomalies as
 * problems — it NEVER rewrites a value (drafts-only; the employee/data source
 * is fixed). Grounded in the Sale.csv template column order (A1).
 * ------------------------------------------------------------------ */

// Column indices within CCRS_COLUMNS.Sale that must be numeric.
const SALE_QUANTITY_IDX = 6; // Quantity
const SALE_MONEY_IDXS = [7, 8, 9, 10] as const; // UnitPrice, Discount, RetailSalesTax, CannabisExciseTax

const MONEY_2DP_RE = /^\d+(\.\d{1,2})?$/; // non-negative, up to 2 decimals

/**
 * Verify the numeric columns of the assembled Sale rows. PURE. Returns problems
 * (empty when clean). Quantity must be a positive number; money columns must be
 * non-negative with at most 2 decimals. Never throws, never mutates.
 */
export function verifySaleNumericColumns(rows: ReadonlyArray<readonly string[]>): CcrsBatchProblem[] {
  const problems: CcrsBatchProblem[] = [];
  const err = (message: string) => problems.push({ file: "Sale", severity: "error", message });

  rows.forEach((row, idx) => {
    const rowNo = idx + 1;
    const qtyRaw = (row[SALE_QUANTITY_IDX] ?? "").trim();
    const qty = Number(qtyRaw);
    if (qtyRaw === "" || !Number.isFinite(qty)) {
      err(`Sale row ${rowNo}: Quantity "${qtyRaw}" is not a number.`);
    } else if (qty <= 0) {
      err(`Sale row ${rowNo}: Quantity "${qtyRaw}" must be greater than zero.`);
    }
    for (const c of SALE_MONEY_IDXS) {
      const col = CCRS_COLUMNS.Sale[c];
      const v = (row[c] ?? "").trim();
      if (v === "") {
        err(`Sale row ${rowNo}: ${col} is empty (expected a money value like 0.00).`);
      } else if (!MONEY_2DP_RE.test(v)) {
        // catches negatives, NaN, scientific notation, >2 decimals, letters.
        err(`Sale row ${rowNo}: ${col} "${v}" is not a valid non-negative money value.`);
      }
    }
  });

  return problems;
}

/* ------------------------------------------------------------------ *
 * End-to-end batch verification (Slice 94 — verifiable trust)
 *
 * Given the fully-assembled CCRS files (as produced by assembleCcrsFile), verify
 * — offline, no DB, no network — that each is byte-correct BEFORE the employee
 * uploads to the LCB. This is the composed-output check that complements the
 * per-builder unit tests. PURE; never throws (returns a structured report).
 * ------------------------------------------------------------------ */

export type CcrsBatchProblem = {
  file: CcrsRetailerFileType | string;
  severity: CcrsIssueSeverity;
  message: string;
};

export type CcrsBatchVerification = {
  ok: boolean;
  problems: CcrsBatchProblem[];
  checkedFiles: number;
};

/**
 * Split one CSV line into cells, honoring double-quote wrapping (RFC-4180-ish).
 * ccrsCell only wraps a cell in quotes when it contains a comma/newline/quote and
 * strips inner quotes, so a simple state machine is sufficient and lossless here.
 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        // doubled quote -> literal quote; else end of quoted region
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

const MMDDYYYY_RE = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/;

/**
 * Which column indices in each file carry a CCRS date (MM/DD/YYYY). Grounded in
 * the template column names — any column whose header ends in "Date".
 */
function dateColumnIndexes(type: CcrsRetailerFileType): number[] {
  return CCRS_COLUMNS[type]
    .map((name, i) => (/date$/i.test(name) ? i : -1))
    .filter((i) => i >= 0);
}

/**
 * Verify one assembled CCRS file string. PURE. Returns problems (may be empty).
 */
export function verifyCcrsFile(
  type: CcrsRetailerFileType,
  csv: string,
): CcrsBatchProblem[] {
  const problems: CcrsBatchProblem[] = [];
  const err = (message: string) => problems.push({ file: type, severity: "error", message });
  const warn = (message: string) => problems.push({ file: type, severity: "warning", message });

  if (typeof csv !== "string" || csv.length === 0) {
    err("File is empty (no header rows).");
    return problems;
  }
  // Line endings MUST be CRLF. Reject a bare-LF file (a common corruption).
  if (/(^|[^\r])\n/.test(csv)) {
    err("File does not use CRLF (\\r\\n) line endings.");
  }
  const lines = csv.replace(/\r\n$/, "").split("\r\n");
  if (lines.length < 4) {
    err(`File has ${lines.length} line(s); expected at least 4 (3-row header + column row).`);
    return problems;
  }

  // Row 1-3: the 3-row header.
  const r1 = splitCsvLine(lines[0]);
  const r2 = splitCsvLine(lines[1]);
  const r3 = splitCsvLine(lines[2]);
  if (r1[0] !== "SubmittedBy") err(`Row 1 must start with "SubmittedBy" (got "${r1[0]}").`);
  if (r2[0] !== "SubmittedDate") err(`Row 2 must start with "SubmittedDate" (got "${r2[0]}").`);
  else if (!MMDDYYYY_RE.test((r2[1] ?? "").trim())) err(`SubmittedDate "${r2[1]}" is not MM/DD/YYYY.`);
  if (r3[0] !== "NumberRecords") err(`Row 3 must start with "NumberRecords" (got "${r3[0]}").`);

  // Row 4: exact template column header.
  const expected = CCRS_COLUMNS[type];
  const header = splitCsvLine(lines[3]);
  if (header.length !== expected.length || header.some((h, i) => h !== expected[i])) {
    err(`Column header row does not match the ${type} template. Expected: ${expected.join(",")}`);
  }

  // Data rows.
  const dataRows = lines.slice(4);
  const declared = Number((r3[1] ?? "").trim());
  if (!Number.isInteger(declared) || declared < 0) {
    err(`NumberRecords "${r3[1]}" is not a valid count.`);
  } else if (declared !== dataRows.length) {
    err(`NumberRecords (${declared}) does not equal the ${dataRows.length} data row(s).`);
  }

  const dateCols = dateColumnIndexes(type);
  const catIdx = expected.indexOf("InventoryCategory");
  const typeIdx = expected.indexOf("InventoryType");

  dataRows.forEach((line, idx) => {
    const rowNo = idx + 1;
    const cells = splitCsvLine(line);
    if (cells.length !== expected.length) {
      err(`Data row ${rowNo} has ${cells.length} column(s); expected ${expected.length}.`);
    }
    for (const c of dateCols) {
      const v = (cells[c] ?? "").trim();
      if (v && !MMDDYYYY_RE.test(v)) {
        err(`Data row ${rowNo}: ${expected[c]} "${v}" is not MM/DD/YYYY.`);
      }
    }
    // Product classification cross-check (drafts-only: flag, never fix).
    if (type === "Product" && catIdx >= 0 && typeIdx >= 0) {
      const cls = validateProductClassification(cells[catIdx], cells[typeIdx]);
      if (!cls.ok) err(`Data row ${rowNo}: ${cls.error}`);
    }
  });

  if (dataRows.length === 0) {
    warn("File contains no data rows (empty submission for this type).");
  }

  return problems;
}

/**
 * Verify a whole assembled batch. PURE. `ok` is true iff there are no `error`
 * problems (advisory warnings do not block). Never throws.
 */
export function verifyCcrsBatch(
  files: ReadonlyArray<{ type: CcrsRetailerFileType; csv: string }>,
): CcrsBatchVerification {
  const problems: CcrsBatchProblem[] = [];
  for (const f of files) {
    problems.push(...verifyCcrsFile(f.type, f.csv));
  }
  return {
    ok: problems.every((p) => p.severity !== "error"),
    problems,
    checkedFiles: files.length,
  };
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

  // StrainType normalization (B2).
  assert(normalizeStrainType("Indica").value === "Indica", "Indica passthrough");
  assert(normalizeStrainType("sativa").value === "Sativa", "sativa lower");
  assert(normalizeStrainType("Hybrid").value === "Hybrid", "Hybrid passthrough");
  assert(normalizeStrainType("Indica-dominant").value === "Indica", "indica-dominant → Indica");
  assert(normalizeStrainType("60/40 Sativa").value === "Hybrid", "ratio → Hybrid");
  assert(normalizeStrainType("Indica/Sativa").value === "Hybrid", "both → Hybrid");
  assert(normalizeStrainType("1:1 CBD").value === "Hybrid", "cbd/ratio → Hybrid");
  assert(normalizeStrainType("NotApplicable").defaulted === true, "unknown flagged");
  assert(normalizeStrainType("NotApplicable").value === "Hybrid", "unknown → Hybrid");
  assert(normalizeStrainType("").defaulted === true, "empty flagged");
  for (const st of CCRS_STRAIN_TYPES) {
    assert(normalizeStrainType(st).value === st, `${st} is valid`);
  }

  // SaleType enum (B1): medical → RecreationalMedical; rec → RecreationalRetail.
  assert(saleTypeForOrder(true) === "RecreationalMedical", "medical sale type");
  assert(saleTypeForOrder(false) === "RecreationalRetail", "rec sale type");
  assert(CCRS_SALE_TYPES.includes(saleTypeForOrder(true)), "sale type is a valid enum");

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

  // Product classification (C1): valid pairs canonicalize; invalid pairs error.
  assert(CCRS_INVENTORY_CATEGORIES.length === 4, "4 inventory categories");
  const okv = validateProductClassification("EndProduct", "Usable Cannabis");
  assert(okv.ok === true, "valid EndProduct/Usable Cannabis");
  if (okv.ok) {
    assert(okv.category === "EndProduct", "canon category");
    assert(okv.type === "Usable Cannabis", "canon type");
  }
  // case- and whitespace-insensitive input, canonical output.
  const okc = validateProductClassification("endproduct", "usable   cannabis");
  assert(okc.ok === true && okc.type === "Usable Cannabis", "case/space tolerant");
  // valid pair in another category.
  assert(validateProductClassification("PropagationMaterial", "Clones").ok === true, "PropagationMaterial/Clones");
  assert(validateProductClassification("IntermediateProduct", "Cannabis Mix").ok === true, "IntermediateProduct/Cannabis Mix");
  // "Waste" is valid in multiple categories.
  assert(validateProductClassification("HarvestedMaterial", "Waste").ok === true, "HarvestedMaterial/Waste");
  assert(validateProductClassification("EndProduct", "Waste").ok === true, "EndProduct/Waste");
  // unknown category → error, value preserved, NEVER invented.
  const badCat = validateProductClassification("Widget", "Seed");
  assert(badCat.ok === false, "unknown category rejected");
  if (!badCat.ok) assert(badCat.category === "Widget", "bad category preserved verbatim");
  // valid category but type belongs to a different category → error.
  const badType = validateProductClassification("PropagationMaterial", "Usable Cannabis");
  assert(badType.ok === false, "type/category mismatch rejected");
  // missing fields → precise errors.
  assert(validateProductClassification("", "").ok === false, "both missing rejected");
  assert(validateProductClassification("EndProduct", "").ok === false, "missing type rejected");
  assert(validateProductClassification("", "Seed").ok === false, "missing category rejected");
  // legacy Data Model Manual names are NOT valid in the current enum (grounding).
  assert(validateProductClassification("HarvestedMaterial", "Marijuana Mix").ok === false, "legacy 'Marijuana Mix' rejected");

  // clampText (C2): under-limit unchanged; over-limit truncated + flagged.
  assert(clampText("hello", 75).truncated === false, "short text not truncated");
  assert(clampText("hello", 75).value === "hello", "short text unchanged");
  const long = "x".repeat(100);
  const clamped = clampText(long, CCRS_PRODUCT_NAME_MAX);
  assert(clamped.truncated === true, "long name truncated");
  assert(clamped.value.length === 75, "name clamped to 75");
  assert(clampText(null, 75).value === "" && clampText(null, 75).truncated === false, "null → empty, not truncated");
  assert(CCRS_PRODUCT_NAME_MAX === 75 && CCRS_PRODUCT_DESCRIPTION_MAX === 250, "product text limits");

  // classifyWarning (Slice 93): blocking messages → error; advisory → warning.
  assert(
    classifyWarning('ERROR — Product "X": InventoryType "Vape" is not a valid CCRS InventoryType.') === "error",
    "ERROR-prefixed → error",
  );
  assert(
    classifyWarning('InventoryType "Vape Cartridge" is not valid for category "EndProduct".') === "error",
    "invalid-for-category → error",
  );
  assert(
    classifyWarning("Inventory lots have no usable external identifier and cannot be reported.") === "error",
    "no usable id → error",
  );
  assert(classifyWarning("Supabase is not configured.") === "error", "supabase config → error");
  assert(
    classifyWarning('Product "Sunset": Name exceeds 75 chars and was truncated — shorten it in the source.') === "warning",
    "truncation note → warning",
  );
  assert(classifyWarning("No products found in the published menu.") === "warning", "empty note → warning");
  assert(classifyWarning("") === "warning", "empty string → warning");
  assert(classifyWarning(null) === "warning", "null → warning");

  // splitCsvLine (Slice 94): plain, quoted-with-comma, doubled-quote.
  assert(JSON.stringify(splitCsvLine("a,b,c")) === JSON.stringify(["a", "b", "c"]), "plain split");
  assert(JSON.stringify(splitCsvLine('a,"b,c",d')) === JSON.stringify(["a", "b,c", "d"]), "quoted comma split");
  assert(JSON.stringify(splitCsvLine('"x""y"')) === JSON.stringify(['x"y']), "doubled quote");
  assert(JSON.stringify(splitCsvLine("a,,c")) === JSON.stringify(["a", "", "c"]), "empty middle cell");

  // verifyCcrsBatch (Slice 94): a well-formed batch passes.
  const goodStrain = assembleCcrsFile({
    type: "Strain",
    submittedBy: "Jane Doe",
    submittedDate: new Date(Date.UTC(2025, 5, 15, 12, 0, 0)),
    rows: [["123456", "Blue Dream", "Hybrid", "Jane Doe", "06/15/2025"]],
  });
  const goodProduct = assembleCcrsFile({
    type: "Product",
    submittedBy: "Jane Doe",
    submittedDate: new Date(Date.UTC(2025, 5, 15, 12, 0, 0)),
    rows: [
      ["123456", "EndProduct", "Usable Cannabis", "3.5g Blue Dream", "desc", "3.50", "P-1", "Jane", "06/15/2025", "", "", "Insert"],
    ],
  });
  const goodBatch = verifyCcrsBatch([
    { type: "Strain", csv: goodStrain },
    { type: "Product", csv: goodProduct },
  ]);
  assert(goodBatch.ok === true, "good batch verifies: " + JSON.stringify(goodBatch.problems));
  assert(goodBatch.checkedFiles === 2, "checked 2 files");

  // A batch with a bad NumberRecords is rejected.
  const tamperedNumber = goodStrain.replace("NumberRecords,1", "NumberRecords,5");
  const bad1 = verifyCcrsBatch([{ type: "Strain", csv: tamperedNumber }]);
  assert(bad1.ok === false, "NumberRecords mismatch rejected");
  assert(bad1.problems.some((p) => p.severity === "error" && /NumberRecords/.test(p.message)), "reports NumberRecords error");

  // A Product batch with an invalid category/type is rejected.
  const badProduct = assembleCcrsFile({
    type: "Product",
    submittedBy: "Jane Doe",
    submittedDate: new Date(Date.UTC(2025, 5, 15, 12, 0, 0)),
    rows: [
      ["123456", "EndProduct", "Vape Cartridge", "Vape", "", "0", "P-2", "Jane", "06/15/2025", "", "", "Insert"],
    ],
  });
  const bad2 = verifyCcrsBatch([{ type: "Product", csv: badProduct }]);
  assert(bad2.ok === false, "invalid product classification rejected");

  // A bare-LF file (wrong line endings) is rejected.
  const lfFile = goodStrain.replace(/\r\n/g, "\n");
  const bad3 = verifyCcrsBatch([{ type: "Strain", csv: lfFile }]);
  assert(bad3.ok === false, "LF-only file rejected");
  assert(bad3.problems.some((p) => /CRLF/.test(p.message)), "reports CRLF error");

  // A bad date in a data row is rejected.
  const badDate = goodStrain.replace("06/15/2025", "2025-06-15");
  const bad4 = verifyCcrsBatch([{ type: "Strain", csv: badDate }]);
  assert(bad4.ok === false, "bad date rejected");

  // verifySaleNumericColumns (Slice 96). A well-formed Sale row passes.
  // Columns: [Lic, SoldTo, InvId, PlantId, SaleType, SaleDate, Qty, UnitPrice,
  //           Discount, RetailSalesTax, CannabisExciseTax, ...]
  const okSaleRow = [
    "123456", "", "INV-1", "", "RecreationalRetail", "06/15/2025",
    "2", "10.00", "1.50", "2.34", "4.44", "ORD-1", "ORD-1-abcd1234", "Jane", "06/15/2025", "", "", "Insert",
  ];
  assert(verifySaleNumericColumns([okSaleRow]).length === 0, "good sale row passes");

  // Negative quantity → error.
  const negQty = [...okSaleRow]; negQty[6] = "-1";
  assert(verifySaleNumericColumns([negQty]).some((p) => /Quantity/.test(p.message)), "negative qty flagged");
  // Zero quantity → error.
  const zeroQty = [...okSaleRow]; zeroQty[6] = "0";
  assert(verifySaleNumericColumns([zeroQty]).some((p) => /greater than zero/.test(p.message)), "zero qty flagged");
  // Non-numeric quantity → error.
  const nanQty = [...okSaleRow]; nanQty[6] = "abc";
  assert(verifySaleNumericColumns([nanQty]).some((p) => /not a number/.test(p.message)), "nan qty flagged");
  // Negative money → error.
  const negMoney = [...okSaleRow]; negMoney[7] = "-10.00";
  assert(verifySaleNumericColumns([negMoney]).some((p) => /UnitPrice/.test(p.message)), "negative money flagged");
  // Too many decimals → error.
  const badDp = [...okSaleRow]; badDp[9] = "2.345";
  assert(verifySaleNumericColumns([badDp]).some((p) => /RetailSalesTax/.test(p.message)), "3-decimal money flagged");
  // Empty money → error.
  const emptyMoney = [...okSaleRow]; emptyMoney[10] = "";
  assert(verifySaleNumericColumns([emptyMoney]).some((p) => /CannabisExciseTax/.test(p.message)), "empty money flagged");
  // Integer money (no decimals) is acceptable.
  const intMoney = [...okSaleRow]; intMoney[7] = "10";
  assert(verifySaleNumericColumns([intMoney]).length === 0, "integer money ok");

  console.log("ccrs-batch-core: all tests passed");
}
