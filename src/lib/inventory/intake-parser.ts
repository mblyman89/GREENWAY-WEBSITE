/**
 * src/lib/inventory/intake-parser.ts
 *
 * Vendor JSON intake parser.
 *
 * PRIMARY target: the WCIA Transfer Schema (v2.x) that Cultivera emails Greenway
 * for every order — a single JSON that already embeds every line item AND its COA
 * URL + potency. See back-office/source-materials/WCIA_TRANSFER_SCHEMA_REFERENCE.md.
 *
 * SECONDARY: a tolerant generic parser for other vendor JSON shapes (wrapped
 * manifest or top-level array of items).
 *
 * IMPORTANT (standing rule): everything this produces is a DRAFT. Nothing is
 * "live" until an employee reviews and accepts the manifest.
 *
 * Pure functions, no DB / no server-only — easy to unit test.
 */

export type ParsedLab = {
  labtest_external_identifier: string | null;
  lab_name: string | null;
  tested_on: string | null;
  thc_pct: number | null;
  cbd_pct: number | null;
  thca_pct: number | null;
  cbda_pct: number | null;
  total_thc_pct: number | null;
  total_cbd_pct: number | null;
  total_cannabinoids_pct: number | null;
  /** Normalized potency map by type → percent. */
  potency_json: Record<string, number> | null;
  terpenes_json: unknown | null;
  analytes_json: unknown | null;
  passed: boolean | null;
  /** Direct COA PDF URL (cleaned of any doubled origin). */
  coa_url: string | null;
  coa_release_date: string | null;
  coa_expire_date: string | null;
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
  /** Per-unit product weight + uom (display), e.g. 3.75 g. */
  unit_weight: number | null;
  unit_weight_uom: string | null;
  is_sample: boolean;
  is_medical: boolean;
  inventory_type: string | null;
  expires_on: string | null;
  lab: ParsedLab | null;
  /** Per-line warnings surfaced to the reviewer. */
  warnings: string[];
  raw: unknown;
};

export type ParsedManifest = {
  manifest_number: string | null;
  vendor_label: string | null;
  vendor_license: string | null;
  transfer_date: string | null;
  /** "wcia" when we recognized the WCIA Transfer Schema, else "generic". */
  source_format: "wcia" | "generic";
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
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = asString(v)?.toLowerCase();
  if (s == null) return null;
  if (["pass", "passed", "true", "yes", "y", "1"].includes(s)) return true;
  if (["fail", "failed", "false", "no", "n", "0"].includes(s)) return false;
  return null;
}

/**
 * Cultivera sometimes double-prefixes URLs:
 * "https://files.cultivera.com/https://files.cultivera.com/…". Collapse it.
 */
export function cleanUrl(v: unknown): string | null {
  let s = asString(v);
  if (!s) return null;
  const doubled = s.match(/^(https?:\/\/[^/]+\/)(https?:\/\/.+)$/i);
  if (doubled) s = doubled[2];
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// WCIA Transfer Schema parser
// ─────────────────────────────────────────────────────────────────────────────

function isWciaTransfer(root: Obj): boolean {
  const name = asString(pick(root, ["document_name"]))?.toLowerCase() ?? "";
  if (name.includes("wcia") && name.includes("transfer")) return true;
  // Fallback structural detection: items array + license fields.
  if (Array.isArray(pick(root, ["inventory_transfer_items"]))) return true;
  return false;
}

/** Parse a WCIA lab_result_data block into our ParsedLab. */
function parseWciaLab(item: Obj): ParsedLab | null {
  const data = pick(item, ["lab_result_data"]);
  const passedTop = asBool(pick(item, ["lab_result_passed"]));
  if (!isObj(data)) {
    // Still capture pass/fail + the link if present.
    if (passedTop == null) return null;
    return {
      labtest_external_identifier: null,
      lab_name: null,
      tested_on: null,
      thc_pct: null,
      cbd_pct: null,
      thca_pct: null,
      cbda_pct: null,
      total_thc_pct: null,
      total_cbd_pct: null,
      total_cannabinoids_pct: null,
      potency_json: null,
      terpenes_json: null,
      analytes_json: null,
      passed: passedTop,
      coa_url: cleanUrl(pick(item, ["lab_result_link"])),
      coa_release_date: null,
      coa_expire_date: null,
      raw: item,
    };
  }

  // Potency array → normalized map.
  const potency: Record<string, number> = {};
  const potArr = pick(data, ["potency"]);
  if (Array.isArray(potArr)) {
    for (const p of potArr) {
      if (!isObj(p)) continue;
      const type = asString(pick(p, ["type"]))?.toLowerCase();
      const value = asNumber(pick(p, ["value"]));
      if (type && value != null) potency[type] = value;
    }
  }

  // lab_result_list[0] carries release/expire + the authoritative COA.
  let coaRelease: string | null = null;
  let coaExpire: string | null = null;
  let coaFromList: string | null = null;
  const list = pick(data, ["lab_result_list"]);
  if (Array.isArray(list) && isObj(list[0])) {
    const first = list[0] as Obj;
    coaRelease = asDate(pick(first, ["coa_release_date"]));
    coaExpire = asDate(pick(first, ["coa_expire_date"]));
    coaFromList = cleanUrl(pick(first, ["coa"]));
  }

  const thca = potency["thca"] ?? null;
  const total = potency["total-cannabinoids"] ?? potency["total_cannabinoids"] ?? null;

  return {
    labtest_external_identifier: asString(pick(data, ["lab_result_id"])),
    lab_name: asString(pick(data, ["lab_name"])),
    tested_on: coaRelease,
    thc_pct: potency["thc"] ?? null,
    cbd_pct: potency["cbd"] ?? null,
    thca_pct: thca,
    cbda_pct: potency["cbda"] ?? null,
    // For WA, the "total THC" headline is typically the larger of THC and THCA.
    total_thc_pct: total ?? (Math.max(potency["thc"] ?? 0, thca ?? 0) || null),
    total_cbd_pct: potency["cbd"] ?? null,
    total_cannabinoids_pct: total,
    potency_json: Object.keys(potency).length > 0 ? potency : null,
    terpenes_json: pick(data, ["terpenes", "terpene_profile"]) ?? null,
    analytes_json: potArr ?? null,
    passed: asBool(pick(data, ["lab_result_status"])) ?? passedTop,
    coa_url: cleanUrl(pick(data, ["coa"])) ?? coaFromList,
    coa_release_date: coaRelease,
    coa_expire_date: coaExpire,
    raw: data,
  };
}

function parseWciaLine(item: unknown): ParsedLine {
  const warnings: string[] = [];
  if (!isObj(item)) {
    return blankLine(item, ["Line was not an object."]);
  }

  const product_name = asString(pick(item, ["product_name"]));
  const lot_code = asString(pick(item, ["inventory_id"]));
  const sku = asString(pick(item, ["product_sku"]));
  const qty = asNumber(pick(item, ["qty"])) ?? 0;
  const linePrice = asNumber(pick(item, ["line_price"]));
  const unit = asString(pick(item, ["uom"])) ?? "ea";
  const strain = asString(pick(item, ["strain_name"]));
  const category = asString(pick(item, ["inventory_category"]));
  const inventory_type = asString(pick(item, ["inventory_type"]));
  const is_sample = asBool(pick(item, ["is_sample"])) === true;
  const is_medical = asBool(pick(item, ["is_medical"])) === true;
  const unit_weight = asNumber(pick(item, ["unit_weight"]));
  const unit_weight_uom = asString(pick(item, ["unit_weight_uom"]));

  // Per-unit cost = line_price / qty, in minor units.
  let unit_cost_minor_units: number | null = null;
  if (linePrice != null && qty > 0) {
    unit_cost_minor_units = Math.round((linePrice / qty) * 100);
  } else if (linePrice != null) {
    unit_cost_minor_units = Math.round(linePrice * 100);
  }

  const lab = parseWciaLab(item);
  const expires_on = lab?.coa_expire_date ?? null;

  if (!product_name) warnings.push("Missing product name.");
  if (qty <= 0 && !is_sample) warnings.push("Quantity is zero or missing.");
  if (!lab) warnings.push("No COA / lab result found — required before sale.");
  else if (!lab.labtest_external_identifier)
    warnings.push("COA has no lab result id (CCRS LabtestexternalIdentifier).");
  if (linePrice === 0 || (linePrice != null && linePrice === 0)) {
    if (!is_sample) warnings.push("$0 line — likely a vendor sample; confirm before selling.");
  }

  return {
    product_name,
    lot_code,
    pos_product_key: sku ?? lot_code, // fall back to inventory_id for catalog linking
    brand_name: null, // WCIA carries vendor at the document level, not per line
    category,
    strain_name: strain,
    received_qty: qty,
    unit,
    unit_cost_minor_units,
    unit_weight,
    unit_weight_uom,
    is_sample: is_sample || linePrice === 0,
    is_medical,
    inventory_type,
    expires_on,
    lab,
    warnings,
    raw: item,
  };
}

function parseWcia(root: Obj): ParsedManifest {
  const manifest_number = asString(pick(root, ["transfer_id", "external_id"]));
  const vendor_label = asString(pick(root, ["from_license_name"]));
  const vendor_license = asString(pick(root, ["from_license_number"]));
  const transfer_date = asDate(
    pick(root, ["transferred_at", "est_arrival_at", "created_at"]),
  );

  const rawItems = pick(root, ["inventory_transfer_items"]);
  const lines = Array.isArray(rawItems) ? rawItems.map(parseWciaLine) : [];

  const warnings: string[] = [];
  if (lines.length === 0) warnings.push("No inventory_transfer_items found.");

  return {
    manifest_number,
    vendor_label,
    vendor_license,
    transfer_date,
    source_format: "wcia",
    lines,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic fallback parser
// ─────────────────────────────────────────────────────────────────────────────

function blankLine(raw: unknown, warnings: string[]): ParsedLine {
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
    unit_weight: null,
    unit_weight_uom: null,
    is_sample: false,
    is_medical: false,
    inventory_type: null,
    expires_on: null,
    lab: null,
    warnings,
    raw,
  };
}

function parseGenericLab(raw: unknown): ParsedLab | null {
  if (!isObj(raw)) return null;
  const potArr = pick(raw, ["potency", "analytes", "cannabinoids"]);
  const lab: ParsedLab = {
    labtest_external_identifier: asString(
      pick(raw, [
        "labtestexternalidentifier",
        "labtest_external_identifier",
        "lab_test_external_id",
        "external_lab_id",
        "lab_result_id",
        "labid",
        "lab_id",
        "coa_id",
        "test_id",
      ]),
    ),
    lab_name: asString(pick(raw, ["lab_name", "laboratory", "lab", "testing_lab"])),
    tested_on: asDate(pick(raw, ["tested_on", "test_date", "tested", "date_tested", "completed_on"])),
    thc_pct: asNumber(pick(raw, ["thc", "thc_pct", "delta9_thc"])),
    cbd_pct: asNumber(pick(raw, ["cbd", "cbd_pct"])),
    thca_pct: asNumber(pick(raw, ["thca", "thca_pct"])),
    cbda_pct: asNumber(pick(raw, ["cbda", "cbda_pct"])),
    total_thc_pct: asNumber(pick(raw, ["total_thc", "total_thc_pct", "totalthc"])),
    total_cbd_pct: asNumber(pick(raw, ["total_cbd", "total_cbd_pct", "totalcbd"])),
    total_cannabinoids_pct: asNumber(pick(raw, ["total_cannabinoids", "total-cannabinoids"])),
    potency_json: null,
    terpenes_json: pick(raw, ["terpenes", "terpene_profile", "terpenes_json"]) ?? null,
    analytes_json: potArr ?? null,
    passed: asBool(pick(raw, ["passed", "result", "status", "qa_status", "pass_fail"])),
    coa_url: cleanUrl(pick(raw, ["coa", "coa_url", "coa_link", "certificate"])),
    coa_release_date: asDate(pick(raw, ["coa_release_date", "release_date"])),
    coa_expire_date: asDate(pick(raw, ["coa_expire_date", "expire_date", "expiry"])),
    raw,
  };
  const hasAny =
    lab.labtest_external_identifier ||
    lab.lab_name ||
    lab.tested_on ||
    lab.thc_pct != null ||
    lab.cbd_pct != null ||
    lab.total_thc_pct != null ||
    lab.coa_url ||
    lab.passed != null;
  return hasAny ? lab : null;
}

function parseGenericLine(raw: unknown): ParsedLine {
  const warnings: string[] = [];
  if (!isObj(raw)) return blankLine(raw, ["Line was not an object and could not be parsed."]);

  const product_name = asString(
    pick(raw, ["product_name", "name", "product", "item_name", "description", "title"]),
  );
  const lot_code = asString(
    pick(raw, ["lot_code", "lot", "lot_number", "batch", "batch_number", "lotnumber", "inventory_id"]),
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

  // Prefer a nested lab OBJECT; if none, treat the line itself as the lab source
  // (vendors often put coa_id / total_thc / coa directly on the line).
  const nestedLab = pick(raw, [
    "lab",
    "lab_result",
    "qa",
    "qa_results",
    "test_results",
    "lab_results",
    "lab_result_data",
  ]);
  const lab = parseGenericLab(isObj(nestedLab) ? nestedLab : raw);

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
    unit_weight: null,
    unit_weight_uom: null,
    is_sample: false,
    is_medical: false,
    inventory_type: null,
    expires_on,
    lab,
    warnings,
    raw,
  };
}

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
  const nested = pick(root, ["manifest", "transfer", "shipment", "data"]);
  if (isObj(nested)) return findLines(nested);
  return [];
}

function parseGeneric(root: Obj): ParsedManifest {
  const manifest_number = asString(
    pick(root, ["manifest_number", "manifest", "manifest_id", "transfer_id", "id", "number"]),
  );
  const vendor_label = asString(
    pick(root, ["vendor", "vendor_name", "supplier", "from", "shipper", "originator", "from_license_name"]),
  );
  const vendor_license = asString(pick(root, ["from_license_number", "vendor_license"]));
  const transfer_date = asDate(
    pick(root, ["transfer_date", "date", "shipped_on", "created_at", "manifest_date"]),
  );

  const rawLines = findLines(root);
  const lines = rawLines.map(parseGenericLine);

  const warnings: string[] = [];
  if (lines.length === 0) warnings.push("No line items found in the JSON.");

  return {
    manifest_number,
    vendor_label,
    vendor_license,
    transfer_date,
    source_format: "generic",
    lines,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

export function parseVendorJson(jsonText: string): ParseResult {
  let root: unknown;
  try {
    root = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "Invalid JSON — could not parse the file/text." };
  }

  // Top-level array of line items (generic, no wrapper).
  if (Array.isArray(root)) {
    const lines = root.map(parseGenericLine);
    return {
      ok: true,
      manifest: {
        manifest_number: null,
        vendor_label: null,
        vendor_license: null,
        transfer_date: null,
        source_format: "generic",
        lines,
        warnings: lines.length === 0 ? ["No line items found in the JSON."] : [],
      },
    };
  }

  if (!isObj(root)) {
    return { ok: false, error: "JSON root must be an object or an array of items." };
  }

  const manifest = isWciaTransfer(root) ? parseWcia(root) : parseGeneric(root);
  return { ok: true, manifest };
}

/** Summary counts for the review screen. */
export function summarizeManifest(m: ParsedManifest): {
  lineCount: number;
  withCoa: number;
  withExtId: number;
  withPosKey: number;
  withCoaPdf: number;
  sampleCount: number;
  totalUnits: number;
  warningCount: number;
} {
  let withCoa = 0;
  let withExtId = 0;
  let withPosKey = 0;
  let withCoaPdf = 0;
  let sampleCount = 0;
  let totalUnits = 0;
  let warningCount = m.warnings.length;
  for (const l of m.lines) {
    if (l.lab) withCoa += 1;
    if (l.lab?.labtest_external_identifier) withExtId += 1;
    if (l.lab?.coa_url) withCoaPdf += 1;
    if (l.pos_product_key) withPosKey += 1;
    if (l.is_sample) sampleCount += 1;
    totalUnits += l.received_qty;
    warningCount += l.warnings.length;
  }
  return {
    lineCount: m.lines.length,
    withCoa,
    withExtId,
    withPosKey,
    withCoaPdf,
    sampleCount,
    totalUnits,
    warningCount,
  };
}
