/**
 * src/lib/inventory/ccrs-manifest-csv-core.ts  (Slice 84)
 *
 * PURE parser for the official Washington CCRS Transportation Manifest CSV.
 * No I/O, no server-only imports — unit-testable with tsx.
 *
 * GROUNDING (verified against the LCB's own template + user guide, Oct 2025):
 *   Source: https://lcb.wa.gov/ccrs/manifests
 *   Template: docs/fixtures/ccrs-manifest-template.csv (downloaded from LCB).
 *
 *   The CCRS manifest.csv is a HYBRID file, not a plain table:
 *     • Rows 1..N  = a HEADER BLOCK: column A is the attribute NAME, column B is
 *       its VALUE. There are 21 header attributes, ending at
 *       "DestinationLicenseeEmailAddress".
 *     • Then ONE item-table header row that begins with
 *       "InventoryExternalIdentifier,PlantExternalIdentifier,Quantity,UOM,..."
 *     • Then one ITEM row per transported inventory item / plant.
 *
 *   Item fields (exact, from the LCB guide):
 *     InventoryExternalIdentifier, PlantExternalIdentifier, Quantity, UOM,
 *     WeightPerUnit, ServingsPerUnit, ExternalIdentifier, LabTestExternalIdentifier,
 *     CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation
 *   Valid UOM values: "Each" or "Gram".
 *
 * IMPORTANT, honest limitation (surfaced as warnings, never guessed):
 *   The CCRS manifest carries NO product name, strain, brand, category, price,
 *   or COA URL — those live in the separate CCRS Product/Inventory/LabTest
 *   files. So a manifest-CSV import produces SPARSE draft lines (identifiers,
 *   quantities, UOM, weight, lab-test id). Staff enrich the rest during review.
 *   This mirrors the standing rule: machine output is a draft for a human.
 */

/** A minimal, self-contained CSV row splitter that honors double-quotes and
 * escaped ("") quotes. Handles \r\n and \n. Returns rows of string cells. */
export function splitCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  // Flush the last cell/row (files may not end in a newline).
  row.push(cell);
  rows.push(row);
  return rows;
}

/** The exact item-table header column order from the LCB template. */
export const CCRS_ITEM_COLUMNS = [
  "InventoryExternalIdentifier",
  "PlantExternalIdentifier",
  "Quantity",
  "UOM",
  "WeightPerUnit",
  "ServingsPerUnit",
  "ExternalIdentifier",
  "LabTestExternalIdentifier",
  "CreatedBy",
  "CreatedDate",
  "UpdatedBy",
  "UpdatedDate",
  "Operation",
] as const;

/** Normalize a header-attribute key for matching (spec is inconsistent, e.g.
 * "Header Operation" vs "HeaderOperation", "VIN #"). Lowercase + strip all
 * non-alphanumerics. */
function keyNorm(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Detect the item-table header row: a row whose first cell is
 * InventoryExternalIdentifier and that also contains Quantity + UOM. */
function isItemHeaderRow(cells: string[]): boolean {
  const norm = cells.map((c) => keyNorm(c));
  return (
    norm[0] === "inventoryexternalidentifier" &&
    norm.includes("quantity") &&
    norm.includes("uom")
  );
}

export type CcrsHeader = {
  submittedBy: string | null;
  submittedDate: string | null;
  numberRecords: number | null;
  externalManifestIdentifier: string | null;
  headerOperation: string | null;
  transportationType: string | null;
  originLicenseNumber: string | null;
  originLicenseePhone: string | null;
  originLicenseeEmail: string | null;
  transportationLicenseNumber: string | null;
  driverName: string | null;
  departureDateTime: string | null;
  arrivalDateTime: string | null;
  vin: string | null;
  vehiclePlateNumber: string | null;
  vehicleModel: string | null;
  vehicleMake: string | null;
  vehicleColor: string | null;
  destinationLicenseNumber: string | null;
  destinationLicenseePhone: string | null;
  destinationLicenseeEmail: string | null;
};

export type CcrsItem = {
  inventoryExternalIdentifier: string | null;
  plantExternalIdentifier: string | null;
  quantity: number | null;
  uom: string | null; // "Each" | "Gram" (as sent)
  weightPerUnit: number | null;
  servingsPerUnit: number | null;
  externalIdentifier: string | null;
  labTestExternalIdentifier: string | null;
  operation: string | null;
  /** Per-item warnings surfaced to the reviewer. */
  warnings: string[];
};

export type CcrsManifestParse =
  | { ok: true; header: CcrsHeader; items: CcrsItem[]; warnings: string[] }
  | { ok: false; error: string };

function nz(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

function num(v: string | undefined): number | null {
  const t = (v ?? "").trim();
  if (t === "") return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Map the normalized header-attribute key → CcrsHeader field setter. */
const HEADER_KEYMAP: Record<string, keyof CcrsHeader> = {
  submittedby: "submittedBy",
  submitteddate: "submittedDate",
  numberrecords: "numberRecords",
  externalmanifestidentifier: "externalManifestIdentifier",
  headeroperation: "headerOperation",
  transportationtype: "transportationType",
  originlicensenumber: "originLicenseNumber",
  originlicenseephone: "originLicenseePhone",
  originlicenseeemailaddress: "originLicenseeEmail",
  transportationlicensenumber: "transportationLicenseNumber",
  drivername: "driverName",
  departuredatetime: "departureDateTime",
  arrivaldatetime: "arrivalDateTime",
  vin: "vin",
  vehicleplatenumber: "vehiclePlateNumber",
  vehiclemodel: "vehicleModel",
  vehiclemake: "vehicleMake",
  vehiclecolor: "vehicleColor",
  destinationlicensenumber: "destinationLicenseNumber",
  destinationlicenseephone: "destinationLicenseePhone",
  destinationlicenseeemailaddress: "destinationLicenseeEmail",
};

function emptyHeader(): CcrsHeader {
  return {
    submittedBy: null,
    submittedDate: null,
    numberRecords: null,
    externalManifestIdentifier: null,
    headerOperation: null,
    transportationType: null,
    originLicenseNumber: null,
    originLicenseePhone: null,
    originLicenseeEmail: null,
    transportationLicenseNumber: null,
    driverName: null,
    departureDateTime: null,
    arrivalDateTime: null,
    vin: null,
    vehiclePlateNumber: null,
    vehicleModel: null,
    vehicleMake: null,
    vehicleColor: null,
    destinationLicenseNumber: null,
    destinationLicenseePhone: null,
    destinationLicenseeEmail: null,
  };
}

/**
 * Parse a CCRS manifest.csv into a header + item list.
 * Robust to the header block appearing in any order and to extra trailing
 * commas (the LCB template pads every header row to 13 columns).
 */
export function parseCcrsManifestCsv(text: string): CcrsManifestParse {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { ok: false, error: "The CSV is empty." };

  const rows = splitCsvRows(trimmed).filter(
    (r) => r.some((c) => c.trim() !== ""), // drop fully blank rows
  );
  if (rows.length === 0) return { ok: false, error: "The CSV has no rows." };

  // Find the item-table header row.
  let itemHeaderIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (isItemHeaderRow(rows[i])) {
      itemHeaderIdx = i;
      break;
    }
  }
  if (itemHeaderIdx === -1) {
    return {
      ok: false,
      error:
        "This does not look like a CCRS manifest.csv — no item header row " +
        "(InventoryExternalIdentifier, PlantExternalIdentifier, Quantity, UOM, …) was found.",
    };
  }

  // Header block = rows above the item header (key in col A, value in col B).
  const header = emptyHeader();
  const warnings: string[] = [];
  for (let i = 0; i < itemHeaderIdx; i++) {
    const cells = rows[i];
    const rawKey = cells[0] ?? "";
    if (rawKey.trim() === "") continue;
    const nk = keyNorm(rawKey);
    const field = HEADER_KEYMAP[nk];
    if (!field) continue; // unknown attribute row — ignore, don't guess
    const value = nz(cells[1]);
    if (field === "numberRecords") {
      header.numberRecords = num(cells[1]);
    } else {
      // All other header fields are strings.
      (header as Record<string, string | null>)[field] = value;
    }
  }

  // Map item-header column name → index (spec order, but tolerate reordering).
  const headerCells = rows[itemHeaderIdx].map((c) => keyNorm(c));
  const colIdx = (name: string): number => headerCells.indexOf(keyNorm(name));
  const idx = {
    inv: colIdx("InventoryExternalIdentifier"),
    plant: colIdx("PlantExternalIdentifier"),
    qty: colIdx("Quantity"),
    uom: colIdx("UOM"),
    wpu: colIdx("WeightPerUnit"),
    spu: colIdx("ServingsPerUnit"),
    ext: colIdx("ExternalIdentifier"),
    lab: colIdx("LabTestExternalIdentifier"),
    op: colIdx("Operation"),
  };

  const items: CcrsItem[] = [];
  for (let i = itemHeaderIdx + 1; i < rows.length; i++) {
    const cells = rows[i];
    // Skip padding rows that are all-empty in the item columns.
    const inv = idx.inv >= 0 ? nz(cells[idx.inv]) : null;
    const plant = idx.plant >= 0 ? nz(cells[idx.plant]) : null;
    const qty = idx.qty >= 0 ? num(cells[idx.qty]) : null;
    const uom = idx.uom >= 0 ? nz(cells[idx.uom]) : null;
    if (inv === null && plant === null && qty === null && uom === null) continue;

    const w: string[] = [];
    if (inv === null && plant === null) {
      w.push("Item has neither an inventory nor a plant external identifier.");
    }
    if (qty === null) w.push("Item is missing a quantity.");
    if (uom && !["each", "gram"].includes(uom.toLowerCase())) {
      w.push(`Unrecognized UOM "${uom}" — CCRS accepts only "Each" or "Gram".`);
    }

    items.push({
      inventoryExternalIdentifier: inv,
      plantExternalIdentifier: plant,
      quantity: qty,
      uom,
      weightPerUnit: idx.wpu >= 0 ? num(cells[idx.wpu]) : null,
      servingsPerUnit: idx.spu >= 0 ? num(cells[idx.spu]) : null,
      externalIdentifier: idx.ext >= 0 ? nz(cells[idx.ext]) : null,
      labTestExternalIdentifier: idx.lab >= 0 ? nz(cells[idx.lab]) : null,
      operation: idx.op >= 0 ? nz(cells[idx.op]) : null,
      warnings: w,
    });
  }

  if (items.length === 0) {
    warnings.push("No item rows were found below the item header.");
  }
  // Reconcile the declared NumberRecords against what we actually parsed.
  if (
    header.numberRecords !== null &&
    items.length > 0 &&
    header.numberRecords !== items.length
  ) {
    warnings.push(
      `NumberRecords says ${header.numberRecords} but ${items.length} item row(s) were found.`,
    );
  }

  return { ok: true, header, items, warnings };
}

// ---------------------------------------------------------------------------
// Date helpers — CCRS uses "MM/DD/YYYY hh:mm AM/PM" for datetimes and
// "MM/DD/YYYY" for dates. We normalize to YYYY-MM-DD (date only) for storage.
// ---------------------------------------------------------------------------

/** Convert an "MM/DD/YYYY[ hh:mm AM/PM]" value into a YYYY-MM-DD date, or null. */
export function ccrsDateToIso(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  if (!t) return null;
  // Already ISO?
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (!m) return null;
  const mo = String(Number(m[1])).padStart(2, "0");
  const da = String(Number(m[2])).padStart(2, "0");
  const yr = m[3];
  const moN = Number(mo);
  const daN = Number(da);
  if (moN < 1 || moN > 12 || daN < 1 || daN > 31) return null;
  return `${yr}-${mo}-${da}`;
}

// ---------------------------------------------------------------------------
// Mapping to the shared ParsedManifest shape (so a CCRS CSV flows into the
// SAME stageManifest → pipeline → dock workflow as WCIA JSON / manual entry).
//
// This is intentionally in the pure core (no server imports) so it stays
// unit-testable. It mirrors the ParsedManifest / ParsedLine / ParsedLab shapes
// from intake-parser.ts WITHOUT importing them (avoids a server-only edge) —
// the caller passes the result straight to stageManifest.
// ---------------------------------------------------------------------------

/** Structural subset of ParsedManifest we produce from a CCRS CSV. */
export type CcrsParsedLine = {
  product_name: string | null;
  lot_code: string | null;
  pos_product_key: string | null;
  brand_name: string | null;
  category: string | null;
  strain_name: string | null;
  received_qty: number;
  unit: string;
  unit_cost_minor_units: number | null;
  unit_weight: number | null;
  unit_weight_uom: string | null;
  is_sample: boolean;
  is_medical: boolean;
  inventory_type: string | null;
  expires_on: string | null;
  lab: {
    labtest_external_identifier: string | null;
    lab_name: null;
    tested_on: null;
    thc_pct: null;
    cbd_pct: null;
    thca_pct: null;
    cbda_pct: null;
    total_thc_pct: null;
    total_cbd_pct: null;
    total_cannabinoids_pct: null;
    potency_json: null;
    terpenes_json: null;
    analytes_json: null;
    passed: null;
    coa_url: null;
    coa_release_date: null;
    coa_expire_date: null;
    raw: unknown;
  } | null;
  warnings: string[];
  raw: unknown;
};

export type CcrsParsedManifest = {
  manifest_number: string | null;
  vendor_label: string | null;
  vendor_license: string | null;
  transfer_date: string | null;
  source_format: "ccrs-csv";
  lines: CcrsParsedLine[];
  warnings: string[];
  /** Transport chain-of-custody fields lifted from the CCRS header, so the
   * caller can seed updateManifestTransport / eta. */
  transport: {
    transporter_license: string | null;
    driver_name: string | null;
    vehicle_plate: string | null;
    vehicle_vin: string | null;
    vehicle_description: string | null;
    departed_at: string | null;
    arrived_at: string | null;
    eta_date: string | null;
  };
};

/**
 * Convert a parsed CCRS manifest into the ParsedManifest-compatible shape.
 * Honest: CCRS carries no product name/strain/brand/category/price/COA, so
 * those are null and each line carries a warning telling staff to enrich it.
 */
export function ccrsToParsedManifest(parse: {
  header: CcrsHeader;
  items: CcrsItem[];
  warnings: string[];
}): CcrsParsedManifest {
  const { header, items } = parse;
  const vehicleDescription =
    [header.vehicleColor, header.vehicleMake, header.vehicleModel]
      .filter((x) => x && x.trim() !== "")
      .join(" ") || null;

  const lines: CcrsParsedLine[] = items.map((it) => {
    const identifier = it.inventoryExternalIdentifier ?? it.plantExternalIdentifier;
    const isGram = (it.uom ?? "").toLowerCase() === "gram";
    const w = [
      ...it.warnings,
      "CCRS manifest carries no product name, strain, brand, category, price, or COA — enrich this line before accepting.",
    ];
    return {
      product_name: null,
      lot_code: identifier,
      pos_product_key: it.inventoryExternalIdentifier,
      brand_name: null,
      category: null,
      strain_name: null,
      received_qty: it.quantity ?? 0,
      unit: isGram ? "g" : "each",
      unit_cost_minor_units: null,
      unit_weight: it.weightPerUnit,
      unit_weight_uom: it.weightPerUnit != null ? "g" : null,
      is_sample: false,
      is_medical: false,
      inventory_type: it.plantExternalIdentifier ? "plant" : null,
      expires_on: null,
      lab: it.labTestExternalIdentifier
        ? {
            labtest_external_identifier: it.labTestExternalIdentifier,
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
            passed: null,
            coa_url: null,
            coa_release_date: null,
            coa_expire_date: null,
            raw: { labTestExternalIdentifier: it.labTestExternalIdentifier },
          }
        : null,
      warnings: w,
      raw: it,
    };
  });

  return {
    manifest_number: header.externalManifestIdentifier,
    // CCRS manifest has only the origin LICENSE number, never a vendor name.
    vendor_label: null,
    vendor_license: header.originLicenseNumber,
    transfer_date:
      ccrsDateToIso(header.departureDateTime) ?? ccrsDateToIso(header.submittedDate),
    source_format: "ccrs-csv",
    lines,
    warnings: [
      ...parse.warnings,
      header.originLicenseNumber
        ? `Origin license ${header.originLicenseNumber}${
            header.originLicenseeEmail ? ` (${header.originLicenseeEmail})` : ""
          } — confirm/match this to a vendor during review.`
        : "No origin license number on the CCRS manifest.",
    ],
    transport: {
      transporter_license: header.transportationLicenseNumber,
      driver_name: header.driverName,
      vehicle_plate: header.vehiclePlateNumber,
      vehicle_vin: header.vin,
      vehicle_description: vehicleDescription,
      departed_at: header.departureDateTime,
      arrived_at: header.arrivalDateTime,
      eta_date: ccrsDateToIso(header.arrivalDateTime),
    },
  };
}

// ---------------------------------------------------------------------------
// Self-tests (run via tsx from a throwaway harness that imports this file).
// ---------------------------------------------------------------------------
export function __runCcrsManifestCsvTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // splitCsvRows basics
  const r = splitCsvRows('a,b,c\r\n1,2,3\n"x,y",z,');
  ok(r.length === 3, "splitCsvRows: 3 rows");
  ok(r[0].join("|") === "a|b|c", "splitCsvRows: header");
  ok(r[2][0] === "x,y", "splitCsvRows: quoted comma preserved");
  ok(r[2][2] === "", "splitCsvRows: trailing empty cell");

  // A realistic CCRS manifest (header block + item table), matching the LCB
  // template layout (key in col A, value in col B; header rows padded).
  const sample = [
    "SubmittedBy,jane@vendor.com,,,,,,,,,,,",
    "SubmittedDate,06/15/2024,,,,,,,,,,,",
    "NumberRecords,2,,,,,,,,,,,",
    "ExternalManifestIdentifier,MAN-1001,,,,,,,,,,,",
    "Header Operation,Insert,,,,,,,,,,,",
    "TransportationType,Regular,,,,,,,,,,,",
    "OriginLicenseNumber,412345,,,,,,,,,,,",
    "OriginLicenseePhone,(360) 555-1212,,,,,,,,,,,",
    "OriginLicenseeEmailAddress,jane@vendor.com,,,,,,,,,,,",
    "TransportationLicenseNumber,,,,,,,,,,,,",
    "DriverName,Sam Driver,,,,,,,,,,,",
    "DepartureDateTime,06/15/2024 09:30 AM,,,,,,,,,,,",
    "ArrivalDateTime,06/15/2024 11:00 AM,,,,,,,,,,,",
    "VIN #,1FTSW21P34EB12345,,,,,,,,,,,",
    "VehiclePlateNumber,ABC1234,,,,,,,,,,,",
    "VehicleModel,Transit,,,,,,,,,,,",
    "VehicleMake,Ford,,,,,,,,,,,",
    "VehicleColor,White,,,,,,,,,,,",
    "DestinationLicenseNumber,499999,,,,,,,,,,,",
    "DestinationLicenseePhone,(360) 555-9999,,,,,,,,,,,",
    "DestinationLicenseeEmailAddress,store@greenway.com,,,,,,,,,,,",
    "InventoryExternalIdentifier,PlantExternalIdentifier,Quantity,UOM,WeightPerUnit,ServingsPerUnit,ExternalIdentifier,LabTestExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation",
    "INV-A,,10,Each,3.50,1,ITEM-1,COA_01,jane,06/15/2024,,,Insert",
    "INV-B,,100.50,Gram,,,ITEM-2,COA_02,jane,06/15/2024,,,Insert",
  ].join("\r\n");

  const p = parseCcrsManifestCsv(sample);
  ok(p.ok === true, "parse ok");
  if (p.ok) {
    ok(p.header.externalManifestIdentifier === "MAN-1001", "header manifest id");
    ok(p.header.numberRecords === 2, "header numberRecords");
    ok(p.header.originLicenseNumber === "412345", "header origin license");
    ok(p.header.transportationType === "Regular", "header transportation type");
    ok(p.header.headerOperation === "Insert", "Header Operation (spaced key)");
    ok(p.header.driverName === "Sam Driver", "header driver");
    ok(p.header.vin === "1FTSW21P34EB12345", "VIN # (spaced/# key)");
    ok(p.header.destinationLicenseNumber === "499999", "header dest license");
    ok(p.items.length === 2, "two items");
    ok(p.items[0].inventoryExternalIdentifier === "INV-A", "item0 inv id");
    ok(p.items[0].quantity === 10, "item0 qty");
    ok(p.items[0].uom === "Each", "item0 uom Each");
    ok(p.items[0].weightPerUnit === 3.5, "item0 weight");
    ok(p.items[0].labTestExternalIdentifier === "COA_01", "item0 lab id");
    ok(p.items[1].quantity === 100.5, "item1 decimal qty");
    ok(p.items[1].uom === "Gram", "item1 uom Gram");
    ok(p.warnings.length === 0, "no reconcile warnings (2==2)");
  }

  // Bad UOM produces an item warning.
  const badUom = [
    "ExternalManifestIdentifier,M2,,,,,,,,,,,",
    "InventoryExternalIdentifier,PlantExternalIdentifier,Quantity,UOM,WeightPerUnit,ServingsPerUnit,ExternalIdentifier,LabTestExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation",
    "INV-C,,5,Kilogram,,,,,,,,,Insert",
  ].join("\n");
  const p2 = parseCcrsManifestCsv(badUom);
  ok(p2.ok === true, "badUom parse ok");
  if (p2.ok) {
    ok(p2.items.length === 1, "badUom one item");
    ok(
      p2.items[0].warnings.some((w) => w.includes("UOM")),
      "badUom item flags UOM",
    );
  }

  // NumberRecords mismatch warning.
  const mismatch = [
    "NumberRecords,5,,,,,,,,,,,",
    "InventoryExternalIdentifier,PlantExternalIdentifier,Quantity,UOM,WeightPerUnit,ServingsPerUnit,ExternalIdentifier,LabTestExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation",
    "INV-D,,1,Each,,,,,,,,,Insert",
  ].join("\n");
  const p3 = parseCcrsManifestCsv(mismatch);
  ok(p3.ok === true && p3.warnings.some((w) => w.includes("NumberRecords")), "mismatch warns");

  // Not a manifest at all.
  const notCsv = parseCcrsManifestCsv("hello,world\nfoo,bar");
  ok(notCsv.ok === false, "non-manifest rejected");

  // Empty.
  ok(parseCcrsManifestCsv("   ").ok === false, "empty rejected");

  // Date normalization.
  ok(ccrsDateToIso("06/15/2024 09:30 AM") === "2024-06-15", "datetime → iso date");
  ok(ccrsDateToIso("6/5/2024") === "2024-06-05", "single-digit m/d → padded iso");
  ok(ccrsDateToIso("2024-06-15") === "2024-06-15", "already iso");
  ok(ccrsDateToIso("") === null, "empty date → null");
  ok(ccrsDateToIso("13/40/2024") === null, "bad date → null");

  // Mapper → ParsedManifest shape.
  if (p.ok) {
    const pm = ccrsToParsedManifest(p);
    ok(pm.manifest_number === "MAN-1001", "map: manifest number");
    ok(pm.vendor_label === null, "map: vendor_label null (CCRS has no name)");
    ok(pm.vendor_license === "412345", "map: origin license carried");
    ok(pm.source_format === "ccrs-csv", "map: source_format");
    ok(pm.transfer_date === "2024-06-15", "map: transfer_date from departure");
    ok(pm.lines.length === 2, "map: 2 lines");
    ok(pm.lines[0].lot_code === "INV-A", "map: line0 lot_code from inv id");
    ok(pm.lines[0].pos_product_key === "INV-A", "map: line0 pos key");
    ok(pm.lines[0].received_qty === 10, "map: line0 qty");
    ok(pm.lines[0].unit === "each", "map: line0 unit each");
    ok(pm.lines[1].unit === "g", "map: line1 unit gram→g");
    ok(pm.lines[0].lab?.labtest_external_identifier === "COA_01", "map: line0 lab id");
    ok(
      pm.lines[0].warnings.some((x) => x.includes("enrich this line")),
      "map: line carries enrich warning",
    );
    ok(pm.transport.driver_name === "Sam Driver", "map: transport driver");
    ok(pm.transport.vehicle_plate === "ABC1234", "map: transport plate");
    ok(pm.transport.eta_date === "2024-06-15", "map: eta from arrival");
    ok(
      pm.warnings.some((x) => x.includes("412345")),
      "map: origin license surfaced as warning",
    );
  }

  // Real LCB template (blank header, no items) must degrade gracefully:
  // it IS a manifest structurally (has the item header row) but has no data.
  const templateLike = [
    "SubmittedBy,,,,,,,,,,,,",
    "ExternalManifestIdentifier,,,,,,,,,,,,",
    "DestinationLicenseeEmailAddress,,,,,,,,,,,,",
    "InventoryExternalIdentifier,PlantExternalIdentifier,Quantity,UOM,WeightPerUnit,ServingsPerUnit,ExternalIdentifier,LabTestExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation",
  ].join("\r\n");
  const pt = parseCcrsManifestCsv(templateLike);
  ok(pt.ok === true, "blank template parses");
  if (pt.ok) {
    ok(pt.items.length === 0, "blank template: no items");
    ok(pt.warnings.some((w) => w.includes("No item rows")), "blank template warns no items");
  }

  console.log(`ccrs-manifest-csv-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
