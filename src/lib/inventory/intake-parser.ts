/**
 * src/lib/inventory/intake-parser.ts
 *
 * POS Slice 4 — Vendor JSON intake parser.
 *
 * Vendors send incoming product + COA/QA data as JSON. Shapes vary by vendor,
 * so this parser is deliberately tolerant: it accepts a handful of common
 * field-name variants and normalizes them into a single ParsedManifest that the
 * intake flow turns into DRAFT rows for employee validation.
 *
 * IMPORTANT (standing rule): everything this produces is a DRAFT. Nothing is
 * "live" until an employee reviews and accepts the manifest. We never trust
 * machine-parsed data to publish on its own.
 *
 * Pure functions, no DB / no server-only — easy to unit test.
 */

export type ParsedLab = {
  labtest_external_identifier: string | null;
  lab_name: string | null;
  tested_on: string | null;
  thc_pct: number | null;
  cbd_pct: number | null;
  total_thc_pct: number | null;
  total_cbd_pct: number | null;
  terpenes_json: unknown | null;
  analytes_json: unknown | null;
  passed: boolean | null;
  raw: unknown;
};

export type ParsedLine = {
  product_name: string | null;
  lot_code: string | null;
  pos_product_key: string | null;
  brand_name: string | null;
  category: string | null;
  strain_name: string | null;
  received_qty: number;
  unit: string;
  unit_cost_minor_units: number | null;
  expires_on: string | null;
  lab: ParsedLab | null;
  /** Per-line warnings surfaced to the reviewer. */
  warnings: string[];
  raw: unknown;
};

export type ParsedManifest = {
  manifest_number: string | null;
  vendor_label: string | null;
  transfer_date: string | null;
  lines: ParsedLine[];
  /** Manifest-level warnings (e.g. no lines found). */
  warnings: string[];
};

export type ParseResult =
  | { ok: true; manifest: ParsedManifest }
  | { ok: false; error: string };

// ── helpers ──────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Case-insensitive lookup of the first present key from a list of candidates. */
function pick(obj: Obj, keys: string[]): unknown {
  const lowerMap = new Map<string, unknown>();
  for (const k of Object.keys(obj)) lowerMap.set(k.toLowerCase(), obj[k]);
  for (const k of keys) {
    const v = lowerMap.get(k.toLowerCase());
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function asNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.\-]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Parse a money value into MINOR UNITS (cents). Accepts "12.50", 12.5, "$12". */
function asMinorUnits(v: unknown): number | null {
  const n = asNumber(v);
  if (n == null) return null;
  return Math.round(n * 100);
}

/** Best-effort date normalization to YYYY-MM-DD. */
function asDate(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  // Already ISO-ish
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  const s = asString(v)?.toLowerCase();
  if (s == null) return null;
  if (["pass", "passed", "true", "yes", "y", "1"].includes(s)) return true;
  if (["fail", "failed", "false", "no", "n", "0"].includes(s)) return false;
  return null;
}

// ── lab / COA ──────────────────────────────────────────────────────────────

function parseLab(raw: unknown): ParsedLab | null {
  if (!isObj(raw)) return null;
  const lab: ParsedLab = {
    labtest_external_identifier: asString(
      pick(raw, [
        "labtestexternalidentifier",
        "labtest_external_identifier",
        "lab_test_external_id",
        "external_lab_id",
        "labid",
        "lab_id",
        "coa_id",
        "test_id",
      ]),
    ),
    lab_name: asString(pick(raw, ["lab_name", "laboratory", "lab", "testing_lab"])),
    tested_on: asDate(pick(raw, ["tested_on", "test_date", "tested", "date_tested", "completed_on"])),
    thc_pct: asNumber(pick(raw, ["thc", "thc_pct", "thca", "delta9_thc"])),
    cbd_pct: asNumber(pick(raw, ["cbd", "cbd_pct", "cbda"])),
    total_thc_pct: asNumber(pick(raw, ["total_thc", "total_thc_pct", "totalthc"])),
    total_cbd_pct: asNumber(pick(raw, ["total_cbd", "total_cbd_pct", "totalcbd"])),
    terpenes_json: pick(raw, ["terpenes", "terpene_profile", "terpenes_json"]) ?? null,
    analytes_json: pick(raw, ["analytes", "results", "cannabinoids", "analytes_json"]) ?? null,
    passed: asBool(pick(raw, ["passed", "result", "status", "qa_status", "pass_fail"])),
    raw,
  };
  // If nothing meaningful parsed, treat as no lab.
  const hasAny =
    lab.labtest_external_identifier ||
    lab.lab_name ||
    lab.tested_on ||
    lab.thc_pct != null ||
    lab.cbd_pct != null ||
    lab.total_thc_pct != null ||
    lab.passed != null;
  return hasAny ? lab : null;
}

// ── line items ───────────────────────────────────────────────────────────────

function parseLine(raw: unknown): ParsedLine {
  const warnings: string[] = [];
  if (!isObj(raw)) {
    return {
      product_name: null,
      lot_code: null,
      pos_product_key: null,
      brand_name: null,
      category: null,
      strain_name: null,
      received_qty: 0,
      unit: "each",
      unit_cost_minor_units: null,
      expires_on: null,
      lab: null,
      warnings: ["Line was not an object and could not be parsed."],
      raw,
    };
  }

  const product_name = asString(
    pick(raw, ["product_name", "name", "product", "item_name", "description", "title"]),
  );
  const lot_code = asString(
    pick(raw, ["lot_code", "lot", "lot_number", "batch", "batch_number", "lotnumber"]),
  );
  const pos_product_key = asString(
    pick(raw, ["pos_product_key", "source_item_id", "sku", "product_id", "external_id", "item_id"]),
  );
  const brand_name = asString(pick(raw, ["brand", "brand_name", "producer", "manufacturer"]));
  const category = asString(pick(raw, ["category", "product_type", "type", "class"]));
  const strain_name = asString(pick(raw, ["strain", "strain_name", "cultivar"]));
  const received_qty = asNumber(pick(raw, ["quantity", "qty", "received_qty", "units", "count"])) ?? 0;
  const unit = asString(pick(raw, ["unit", "uom", "unit_of_measure"])) ?? "each";
  const unit_cost_minor_units = asMinorUnits(
    pick(raw, ["unit_cost", "cost", "wholesale_cost", "price", "unit_price"]),
  );
  const expires_on = asDate(pick(raw, ["expires_on", "expiration", "expiration_date", "expiry", "best_by"]));

  // COA can be nested under several keys, or inline on the line.
  const labRaw =
    pick(raw, ["lab", "coa", "lab_result", "qa", "qa_results", "test_results", "lab_results"]) ?? raw;
  const lab = parseLab(labRaw);

  if (!product_name) warnings.push("Missing product name.");
  if (received_qty <= 0) warnings.push("Quantity is zero or missing.");
  if (!lab) warnings.push("No COA / lab result found — required before sale.");
  else if (!lab.labtest_external_identifier)
    warnings.push("COA has no LabtestexternalIdentifier (required for WA CCRS manifest reporting).");
  if (!pos_product_key) warnings.push("No POS product key — won't auto-link to the catalog.");

  return {
    product_name,
    lot_code,
    pos_product_key,
    brand_name,
    category,
    strain_name,
    received_qty,
    unit,
    unit_cost_minor_units,
    expires_on,
    lab,
    warnings,
    raw,
  };
}

// ── top-level manifest ─────────────────────────────────────────────────────

/** Find the array of line items wherever a vendor put it. */
function findLines(root: Obj): unknown[] {
  const candidates = [
    "lines",
    "items",
    "products",
    "line_items",
    "lineitems",
    "inventory",
    "transfers",
    "manifest_items",
  ];
  for (const k of candidates) {
    const v = pick(root, [k]);
    if (Array.isArray(v)) return v;
  }
  // Some vendors nest under manifest/transfer.
  const nested = pick(root, ["manifest", "transfer", "shipment", "data"]);
  if (isObj(nested)) return findLines(nested);
  return [];
}

export function parseVendorJson(jsonText: string): ParseResult {
  let root: unknown;
  try {
    root = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "Invalid JSON — could not parse the file/text." };
  }

  // Allow a top-level array of line items (no manifest wrapper).
  if (Array.isArray(root)) {
    const lines = root.map(parseLine);
    return {
      ok: true,
      manifest: {
        manifest_number: null,
        vendor_label: null,
        transfer_date: null,
        lines,
        warnings: lines.length === 0 ? ["No line items found in the JSON."] : [],
      },
    };
  }

  if (!isObj(root)) {
    return { ok: false, error: "JSON root must be an object or an array of items." };
  }

  const manifest_number = asString(
    pick(root, ["manifest_number", "manifest", "manifest_id", "transfer_id", "id", "number"]),
  );
  const vendor_label = asString(
    pick(root, ["vendor", "vendor_name", "supplier", "from", "shipper", "originator"]),
  );
  const transfer_date = asDate(
    pick(root, ["transfer_date", "date", "shipped_on", "created_at", "manifest_date"]),
  );

  const rawLines = findLines(root);
  const lines = rawLines.map(parseLine);

  const warnings: string[] = [];
  if (lines.length === 0) warnings.push("No line items found in the JSON.");

  return {
    ok: true,
    manifest: { manifest_number, vendor_label, transfer_date, lines, warnings },
  };
}

/** Summary counts for the review screen. */
export function summarizeManifest(m: ParsedManifest): {
  lineCount: number;
  withCoa: number;
  withExtId: number;
  withPosKey: number;
  totalUnits: number;
  warningCount: number;
} {
  let withCoa = 0;
  let withExtId = 0;
  let withPosKey = 0;
  let totalUnits = 0;
  let warningCount = m.warnings.length;
  for (const l of m.lines) {
    if (l.lab) withCoa += 1;
    if (l.lab?.labtest_external_identifier) withExtId += 1;
    if (l.pos_product_key) withPosKey += 1;
    totalUnits += l.received_qty;
    warningCount += l.warnings.length;
  }
  return {
    lineCount: m.lines.length,
    withCoa,
    withExtId,
    withPosKey,
    totalUnits,
    warningCount,
  };
}
