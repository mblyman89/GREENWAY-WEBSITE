/**
 * src/lib/inventory/vendor-return-core.ts  (Fix Phase 1.5 — G-42; F-15-1, F-15-2, F-15-3, F-15-19)
 *
 * The state's vendor-return method, as pure rules (no I/O).
 *
 * Owner basis:
 *  - D63 (owner: "I would like for you to deep research the proper CCRS method
 *    and procedures. It may not be up to us, I want to follow the states
 *    requirements."): (1) the processor's written acceptance first; (2)
 *    Greenway, as the origin, files the Manifest.csv and waits for the LCB's
 *    automatic success email with the manifest PDF; (3) the printed PDF travels
 *    with the product; (4) logging RESERVES the units (out of sale, not off
 *    on-hand); on-hand comes off and the CCRS Other adjustment posts only when
 *    the product departs; (5) no "48–72 hours" / "Mon/Wed/Fri" text; (6) the
 *    encoding stays Other + detail until the examiner answers U-72.
 *  - D65 (owner: "Let's treat recalls like a transfer back to the vendor for
 *    now."): a Recalled lot is listed for a vendor return, goes back with
 *    reason Recall, and stays Recalled until it departs.
 *
 * State sources (docs/ccrs-bible/02-authoritative-spec.md §7, the LCB's
 * Transportation Manifests page, L0001–L0207) and the LCB's own template
 * (docs/fixtures/ccrs-manifest-template.csv, byte-identical to
 * https://lcb.wa.gov/sites/default/files/2025-10/Manifest%201_0.csv).
 */
import { pacificParts, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** The stored manifest_status values (0115 + 'cancelled' from 0309). */
export const VENDOR_RETURN_STATUSES = ["none", "requested", "submitted", "confirmed", "picked_up", "cancelled"] as const;
export type VendorReturnStatus = (typeof VENDOR_RETURN_STATUSES)[number];

/** The words on the screen (D63 (2): the state's steps). */
export const VENDOR_RETURN_STATUS_LABELS: Record<VendorReturnStatus, string> = {
  none: "No manifest yet",
  requested: "Processor agreed (RMA); units reserved",
  submitted: "Manifest uploaded",
  confirmed: "LCB success email and PDF received",
  picked_up: "Departed (on-hand reduced, CCRS Other posted)",
  cancelled: "Cancelled (units released)",
};

/** The one next step from each status. The server refuses anything else. */
export function nextVendorReturnStatus(current: string | null | undefined): VendorReturnStatus | null {
  switch (current ?? "none") {
    case "none":
    case "requested":
      return "submitted";
    case "submitted":
      return "confirmed";
    case "confirmed":
      return "picked_up";
    default:
      return null;
  }
}

/** Statuses that still hold the units back (an open return). */
export function isOpenVendorReturn(status: string | null | undefined): boolean {
  const s = status ?? "none";
  return s !== "picked_up" && s !== "cancelled";
}

/**
 * A return logged before Phase 1.5 already took the units off on-hand at
 * logging (the old createVendorReturn). Departure must not take them again
 * and cancel cannot put them back.
 */
export function isLegacyReducedReturn(r: { reserved_qty?: unknown; adjustment_id?: string | null }): boolean {
  const reserved = Number(r.reserved_qty ?? 0);
  return !(Number.isFinite(reserved) && reserved > 0) && !!r.adjustment_id;
}

/** The checklist shown under the form (replaces VENDOR_RETURN_MANIFEST_STEPS; F-15-19). */
export const VENDOR_RETURN_STATE_STEPS: readonly string[] = [
  "Get the processor's written acceptance (RMA number or an email naming the product, lot and quantity) before anything moves.",
  "Log the return here: the units are reserved (out of sale) but stay on hand and in CCRS until they leave.",
  "Fill in the transport details and download Manifest.CSV (Greenway is the origin). Upload it at cannabisreporting.lcb.wa.gov.",
  "Wait for the LCB's automatic email. A success email has the manifest PDF attached; an error email means fix the file and upload again.",
  "Print the PDF. It travels with the product (WAC 314-55-085(3)). At departure, record the pickup time and driver: on-hand comes off and the CCRS Other adjustment posts then.",
  "Keep the RMA, the LCB email and PDF, and the printed packet for five years (WAC 314-55-087).",
];

// ---------------------------------------------------------------------------
// Logging (requirements 1, 2, 6; D65)
// ---------------------------------------------------------------------------

/** Lot statuses a vendor return may be logged from (D65 adds Recalled). */
export const VENDOR_RETURNABLE_LOT_STATUSES = ["active", "quarantine", "recalled"] as const;

export type VendorReturnLogInput = {
  lotStatus: string | null | undefined;
  reason: string;
  quantity: number;
  free: number; // on hand − held
  vendorId: string | null | undefined;
  rmaNumber: string | null | undefined;
  processorLicense: string | null | undefined;
  detail: string | null | undefined;
  recallOfficer?: string | null;
  recallContactDate?: string | null; // YYYY-MM-DD
  todayPacific: string; // YYYY-MM-DD
};

export type Refusal = { code: string; message: string };

const trimmed = (v: string | null | undefined) => (v ?? "").trim();

/** WA license numbers are numeric (spec L0060, L0128: Numeric (10)). */
export function isNumericLicense(v: string | null | undefined): boolean {
  return /^\d{1,10}$/.test(trimmed(v));
}

export function evaluateVendorReturnLog(i: VendorReturnLogInput): { ok: true } | { ok: false; refusals: Refusal[] } {
  const r: Refusal[] = [];
  const status = (i.lotStatus ?? "").toLowerCase();
  if (!(VENDOR_RETURNABLE_LOT_STATUSES as readonly string[]).includes(status)) {
    r.push({ code: "lot_status", message: `A vendor return can only be logged from an Active, Quarantine or Recalled lot (this lot is ${status || "unknown"}).` });
  }
  if (status === "recalled" && i.reason !== "recall") {
    r.push({ code: "recalled_needs_recall", message: "This lot is Recalled: it goes back to the vendor with reason Recall (D65; SOP-15 §4.21)." });
  }
  if (!(Number.isFinite(i.quantity) && i.quantity > 0)) {
    r.push({ code: "qty", message: "Enter a quantity greater than zero." });
  } else if (i.quantity > i.free) {
    r.push({ code: "qty_free", message: `Quantity (${i.quantity}) exceeds what is free on this lot (${Math.max(0, i.free)}). Held units cannot be returned.` });
  }
  if (!trimmed(i.vendorId)) r.push({ code: "vendor", message: "Choose the vendor (processor) the product goes back to." });
  if (!trimmed(i.rmaNumber)) r.push({ code: "rma", message: "Enter the processor's RMA number (their written acceptance comes first, D63)." });
  if (!isNumericLicense(i.processorLicense)) r.push({ code: "license", message: "Enter the processor's license number (numbers only, up to 10 digits)." });
  if (trimmed(i.detail).length < 5) r.push({ code: "detail", message: "Write a detail sentence (who agreed, the condition, the agreement); it goes into the CCRS Other detail." });
  if (i.reason === "recall") {
    if (!trimmed(i.recallOfficer)) r.push({ code: "recall_officer", message: "Recall: record the LCB enforcement officer the admin told (WAC 314-55-225; D65)." });
    const d = trimmed(i.recallContactDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) r.push({ code: "recall_date", message: "Recall: record the date the LCB officer was told." });
    else if (d > i.todayPacific) r.push({ code: "recall_date_future", message: "Recall: the LCB contact date cannot be in the future." });
  }
  return r.length ? { ok: false, refusals: r } : { ok: true };
}

// ---------------------------------------------------------------------------
// Step advance (requirement 3, 4; F-15-3)
// ---------------------------------------------------------------------------

export type VendorReturnStepInput = {
  from: string | null | undefined;
  to: string;
  manifestNumber?: string | null;
  lcbEmailDate?: string | null; // YYYY-MM-DD (Pacific)
  submittedDay?: string | null; // YYYY-MM-DD Pacific of the upload step
  pickupIso?: string | null; // UTC ISO from pacificInputToIso
  driverName?: string | null;
  todayPacific: string;
  nowIso: string;
};

export function evaluateVendorReturnStep(i: VendorReturnStepInput): { ok: true } | { ok: false; refusals: Refusal[] } {
  const r: Refusal[] = [];
  const expected = nextVendorReturnStatus(i.from);
  if (!isOpenVendorReturn(i.from)) {
    r.push({ code: "closed", message: "This return is closed (departed or cancelled); nothing more can change." });
  } else if (i.to !== expected) {
    r.push({ code: "order", message: `Steps go in order: the next step is "${expected ? VENDOR_RETURN_STATUS_LABELS[expected] : "none"}".` });
  }
  if (i.to === "submitted" && !trimmed(i.manifestNumber)) {
    r.push({ code: "manifest", message: "Enter the manifest number you uploaded (ExternalManifestIdentifier)." });
  }
  if (i.to === "confirmed") {
    const d = trimmed(i.lcbEmailDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) r.push({ code: "lcb_date", message: "Enter the date of the LCB's success email (with the manifest PDF)." });
    else if (d > i.todayPacific) r.push({ code: "lcb_date_future", message: "The LCB email date cannot be in the future." });
    else if (i.submittedDay && d < i.submittedDay) r.push({ code: "lcb_date_before_upload", message: "The LCB email date cannot be before the manifest was uploaded." });
  }
  if (i.to === "picked_up") {
    if (!i.pickupIso) r.push({ code: "pickup", message: "Enter the pickup date and time (Pacific)." });
    else if (Date.parse(i.pickupIso) > Date.parse(i.nowIso) + 15 * 60_000) r.push({ code: "pickup_future", message: "Record departure when the product actually leaves; the pickup time is in the future." });
    if (!trimmed(i.driverName)) r.push({ code: "driver", message: "Enter the driver's name (it must match the manifest)." });
  }
  return r.length ? { ok: false, refusals: r } : { ok: true };
}

/** Owner cancel (requirement 5). */
export function evaluateVendorReturnCancel(i: {
  status: string | null | undefined;
  canCancel: boolean;
  legacyReduced: boolean;
  reason: string | null | undefined;
}): { ok: true; reason: string } | { ok: false; refusals: Refusal[] } {
  const r: Refusal[] = [];
  if (!i.canCancel) r.push({ code: "role", message: "Only the owner cancels a vendor return." });
  if (!isOpenVendorReturn(i.status)) r.push({ code: "closed", message: "This return has already departed or been cancelled." });
  if (i.legacyReduced) r.push({ code: "legacy", message: "This return was logged before Phase 1.5 and already took the units off on-hand; it cannot be cancelled here. The owner corrects it with a manual adjustment (SOP-05a)." });
  const reason = trimmed(i.reason).slice(0, 500);
  if (reason.length < 5) r.push({ code: "reason", message: "Write why the return is cancelled (at least a few words)." });
  return r.length ? { ok: false, refusals: r } : { ok: true, reason };
}

export const VENDOR_RETURN_CANCEL_AUDIT_ACTION = "vendor_return.cancel";
export const VENDOR_RETURN_DEPART_AUDIT_ACTION = "vendor_return.depart";

// ---------------------------------------------------------------------------
// CCRS Other detail (requirement 4; D63 (6) / U-72)
// ---------------------------------------------------------------------------

/** The CCRS Other adjustment detail: names processor, manifest and RMA. */
export function vendorReturnAdjustmentNote(i: {
  processorName?: string | null;
  processorLicense?: string | null;
  manifestNumber?: string | null;
  rmaNumber?: string | null;
  reason: string;
  detail?: string | null;
}): string {
  const who = [trimmed(i.processorName), trimmed(i.processorLicense) ? `license ${trimmed(i.processorLicense)}` : ""].filter(Boolean).join(" ");
  const parts = [
    `Vendor return to ${who || "processor"}`,
    trimmed(i.manifestNumber) ? `manifest ${trimmed(i.manifestNumber)}` : "",
    trimmed(i.rmaNumber) ? `RMA ${trimmed(i.rmaNumber)}` : "",
    `reason ${i.reason}`,
  ].filter(Boolean);
  const d = trimmed(i.detail);
  return `${parts.join(", ")}${d ? `: ${d}` : ""}`.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Pacific time (F-15-3)
// ---------------------------------------------------------------------------

/** A date + time typed on the screen, read as Pacific wall time → UTC ISO. */
export function pacificInputToIso(date: string | null | undefined, time: string | null | undefined): string | null {
  const d = trimmed(date);
  const t = trimmed(time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  const [y, mo, da] = d.split("-").map(Number);
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || y < 2000) return null;
  return pacificWallTimeToUtcISO(d, { h, m, s: 0, ms: 0 });
}

/** The manifest's date/time format, MM/DD/YYYY hh:mm AM/PM, Pacific (spec L0091–L0092). */
export function manifestDateTime(iso: string): string {
  const p = pacificParts(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${pad(p.month)}/${pad(p.day)}/${p.year} ${pad(h12)}:${pad(p.minute)} ${p.hour < 12 ? "AM" : "PM"}`;
}

/** MM/DD/YYYY, Pacific. */
export function manifestDate(iso: string | Date): string {
  const p = pacificParts(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(p.month)}/${pad(p.day)}/${p.year}`;
}

/** Shown on the list and packet: always Pacific, never the server's zone. */
export function formatPacific(iso: string | null | undefined): string {
  if (!iso) return "";
  return `${manifestDateTime(iso)} Pacific`;
}

// ---------------------------------------------------------------------------
// Manifest.CSV (G-42 v1.1 item 8)
// ---------------------------------------------------------------------------

/** The template's 21 header attributes, in order (docs/fixtures/ccrs-manifest-template.csv rows 1–21). */
export const MANIFEST_HEADER_ATTRIBUTES = [
  "SubmittedBy",
  "SubmittedDate",
  "NumberRecords",
  "ExternalManifestIdentifier",
  "Header Operation",
  "TransportationType",
  "OriginLicenseNumber",
  "OriginLicenseePhone",
  "OriginLicenseeEmailAddress",
  "TransportationLicenseNumber",
  "DriverName",
  "DepartureDateTime",
  "ArrivalDateTime",
  "VIN #",
  "VehiclePlateNumber",
  "VehicleModel",
  "VehicleMake",
  "VehicleColor",
  "DestinationLicenseNumber",
  "DestinationLicenseePhone",
  "DestinationLicenseeEmailAddress",
] as const;

/** The template's item header row (row 22), 13 columns. */
export const MANIFEST_ITEM_COLUMNS = [
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

/** Spec L0054–L0056. */
export const TRANSPORTATION_TYPES = ["Regular", "Pick-up", "Transporter Licensee"] as const;
export type TransportationType = (typeof TRANSPORTATION_TYPES)[number];
export const TRANSPORTATION_TYPE_LABELS: Record<TransportationType, string> = {
  Regular: "Regular (our employee drives it to the processor)",
  "Pick-up": "Pick-up (the processor collects it here)",
  "Transporter Licensee": "Transporter Licensee (a licensed transporter)",
};

export type ManifestItem = {
  inventoryExternalId: string;
  quantity: number;
  uom: string; // Each | Gram
  weightPerUnit: number | null;
  servingsPerUnit: number | null;
};

export type ManifestInput = {
  submittedBy: string;
  submittedAt: Date;
  externalManifestId: string;
  headerOperation: "Insert" | "Update";
  transportationType: string;
  originLicense: string;
  originPhone: string;
  originEmail: string;
  transporterLicense?: string | null;
  driverName: string;
  departureIso: string | null;
  arrivalIso: string | null;
  vin: string;
  plate: string;
  model: string;
  make: string;
  color: string;
  destinationLicense: string;
  destinationPhone: string;
  destinationEmail: string;
  items: ManifestItem[];
};

/** The lot's unit → the manifest UOM (spec L0167: Each or Gram), or null. */
export function manifestUom(unit: string | null | undefined): "Each" | "Gram" | null {
  const u = trimmed(unit).toLowerCase();
  if (u === "each" || u === "ea" || u === "unit" || u === "units") return "Each";
  if (u === "g" || u === "gram" || u === "grams") return "Gram";
  return null;
}

/** decimal(10,2) (spec L0159, L0171, L0178). */
export function manifestDecimal(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

const hasTwoDecimalsAtMost = (n: number) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6;

/** Spec limits (L0024, L0035, L0069, L0074, L0086, L0103, L0108, L0113, L0118, L0123, L0134, L0139). */
const LIMITS: [keyof ManifestInput, string, number][] = [
  ["submittedBy", "SubmittedBy", 35],
  ["externalManifestId", "ExternalManifestIdentifier", 100],
  ["originPhone", "OriginLicenseePhone", 14],
  ["originEmail", "OriginLicenseeEmailAddress", 250],
  ["driverName", "DriverName", 75],
  ["vin", "VIN #", 50],
  ["plate", "VehiclePlateNumber", 7],
  ["model", "VehicleModel", 25],
  ["make", "VehicleMake", 25],
  ["color", "VehicleColor", 15],
  ["destinationPhone", "DestinationLicenseePhone", 14],
  ["destinationEmail", "DestinationLicenseeEmailAddress", 250],
];

/** Every problem CCRS would reject, in plain words. Empty = ready to build. */
export function validateManifest(m: ManifestInput): string[] {
  const e: string[] = [];
  const req = (v: string | null | undefined, name: string) => {
    if (!trimmed(v)) e.push(`${name} is required.`);
  };
  req(m.submittedBy, "SubmittedBy (license settings: Submitted by)");
  req(m.externalManifestId, "ExternalManifestIdentifier");
  if (!(TRANSPORTATION_TYPES as readonly string[]).includes(m.transportationType)) e.push("TransportationType must be Regular, Pick-up or Transporter Licensee.");
  if (!isNumericLicense(m.originLicense)) e.push("OriginLicenseNumber must be Greenway's numeric license (license settings).");
  req(m.originPhone, "OriginLicenseePhone (license settings: contact phone)");
  req(m.originEmail, "OriginLicenseeEmailAddress (license settings: contact email)");
  if (m.transportationType === "Transporter Licensee") {
    if (!isNumericLicense(m.transporterLicense)) e.push("TransportationLicenseNumber is required (numbers only) for a Transporter Licensee.");
  } else if (trimmed(m.transporterLicense)) {
    e.push("TransportationLicenseNumber cannot be submitted for Regular or Pick-up (leave it blank).");
  }
  req(m.driverName, "DriverName");
  if (!m.departureIso) e.push("DepartureDateTime (estimated) is required.");
  if (!m.arrivalIso) e.push("ArrivalDateTime (estimated) is required.");
  if (m.departureIso && m.arrivalIso && Date.parse(m.arrivalIso) < Date.parse(m.departureIso)) e.push("ArrivalDateTime cannot be before DepartureDateTime.");
  req(m.vin, "VIN #");
  req(m.plate, "VehiclePlateNumber");
  req(m.model, "VehicleModel");
  req(m.make, "VehicleMake");
  req(m.color, "VehicleColor");
  if (!isNumericLicense(m.destinationLicense)) e.push("DestinationLicenseNumber must be the processor's numeric license.");
  req(m.destinationPhone, "DestinationLicenseePhone (the vendor's phone in Vendors & Brands)");
  req(m.destinationEmail, "DestinationLicenseeEmailAddress (the vendor's email in Vendors & Brands)");
  for (const [k, name, max] of LIMITS) {
    const v = trimmed(m[k] as string);
    if (v.length > max) e.push(`${name} must not exceed ${max} characters (it has ${v.length}).`);
  }
  if (m.items.length === 0) e.push("The manifest needs at least one item.");
  m.items.forEach((it, idx) => {
    const n = `Item ${idx + 1}`;
    if (!trimmed(it.inventoryExternalId)) e.push(`${n}: the lot has no CCRS InventoryExternalIdentifier (only inventory already reported to CCRS can be listed).`);
    else if (it.inventoryExternalId.length > 100) e.push(`${n}: InventoryExternalIdentifier is longer than 100 characters.`);
    if (!(it.quantity > 0) || !hasTwoDecimalsAtMost(it.quantity)) e.push(`${n}: Quantity must be greater than zero with at most 2 decimals.`);
    if (it.uom !== "Each" && it.uom !== "Gram") e.push(`${n}: UOM must be Each or Gram (the lot's unit cannot be mapped).`);
    if (it.weightPerUnit == null || !(it.weightPerUnit > 0)) e.push(`${n}: WeightPerUnit (grams per unit) is required: the lot has no unit weight, so enter it in the transport details.`);
    if (it.servingsPerUnit == null || !(it.servingsPerUnit > 0)) e.push(`${n}: ServingsPerUnit is required (spec L0177–L0181): the lot has no servings per pack, so enter it in the transport details.`);
  });
  // CCRS reads every comma as a column break and cannot carry a line break
  // (ccrs-batch-core ccrsCell): such a value is refused, never quoted.
  const scan: [string, string | null | undefined][] = [
    ["SubmittedBy", m.submittedBy], ["ExternalManifestIdentifier", m.externalManifestId], ["OriginLicenseePhone", m.originPhone],
    ["OriginLicenseeEmailAddress", m.originEmail], ["DriverName", m.driverName], ["VIN #", m.vin], ["VehiclePlateNumber", m.plate],
    ["VehicleModel", m.model], ["VehicleMake", m.make], ["VehicleColor", m.color], ["DestinationLicenseePhone", m.destinationPhone],
    ["DestinationLicenseeEmailAddress", m.destinationEmail], ...m.items.map((it, i) => [`Item ${i + 1} InventoryExternalIdentifier`, it.inventoryExternalId] as [string, string]),
  ];
  for (const [name, v] of scan) {
    if (/[,\r\n]/.test(v ?? "")) e.push(`${name} cannot contain a comma or a line break.`);
  }
  return e;
}

const WIDTH = MANIFEST_ITEM_COLUMNS.length; // 13: every template row is padded to 13 cells
const pad13 = (cells: string[]) => [...cells, ...Array(Math.max(0, WIDTH - cells.length)).fill("")].join(",");

/**
 * Build Manifest.CSV exactly in the LCB template's shape: 21 attribute rows
 * (name in A, value in B, padded to 13 cells), the 13-column item header,
 * one row per item, CRLF line endings, a final CRLF.
 */
export function buildManifestCsv(m: ManifestInput): { ok: true; csv: string } | { ok: false; errors: string[] } {
  const errors = validateManifest(m);
  if (errors.length) return { ok: false, errors };
  const values: Record<(typeof MANIFEST_HEADER_ATTRIBUTES)[number], string> = {
    SubmittedBy: m.submittedBy.trim(),
    SubmittedDate: manifestDate(m.submittedAt),
    NumberRecords: String(m.items.length),
    ExternalManifestIdentifier: m.externalManifestId.trim(),
    "Header Operation": m.headerOperation,
    TransportationType: m.transportationType,
    OriginLicenseNumber: m.originLicense.trim(),
    OriginLicenseePhone: m.originPhone.trim(),
    OriginLicenseeEmailAddress: m.originEmail.trim(),
    TransportationLicenseNumber: m.transportationType === "Transporter Licensee" ? trimmed(m.transporterLicense) : "",
    DriverName: m.driverName.trim(),
    DepartureDateTime: manifestDateTime(m.departureIso!),
    ArrivalDateTime: manifestDateTime(m.arrivalIso!),
    "VIN #": m.vin.trim(),
    VehiclePlateNumber: m.plate.trim(),
    VehicleModel: m.model.trim(),
    VehicleMake: m.make.trim(),
    VehicleColor: m.color.trim(),
    DestinationLicenseNumber: m.destinationLicense.trim(),
    DestinationLicenseePhone: m.destinationPhone.trim(),
    DestinationLicenseeEmailAddress: m.destinationEmail.trim(),
  };
  const lines = MANIFEST_HEADER_ATTRIBUTES.map((a) => pad13([a, values[a]]));
  lines.push(MANIFEST_ITEM_COLUMNS.join(","));
  const created = manifestDate(m.submittedAt);
  for (const it of m.items) {
    lines.push(
      [
        it.inventoryExternalId.trim(),
        "", // PlantExternalIdentifier: never both (spec L0150)
        manifestDecimal(it.quantity),
        it.uom,
        manifestDecimal(it.weightPerUnit!),
        manifestDecimal(it.servingsPerUnit!),
        "", // ExternalIdentifier: optional (spec L0187)
        "", // LabTestExternalIdentifier: only to retail licenses (spec L0191); this goes to a processor
        m.submittedBy.trim(),
        created,
        "",
        "",
        "Insert",
      ].join(","),
    );
  }
  return { ok: true, csv: lines.join("\r\n") + "\r\n" };
}

/** manifest_LicenseNumber_YYYYMMDDHHMMSS.csv, Pacific (spec L0012, L0066). */
export function manifestFileName(license: string, now: Date = new Date()): string {
  const p = pacificParts(now);
  const z = (n: number) => String(n).padStart(2, "0");
  return `manifest_${license.trim()}_${p.year}${z(p.month)}${z(p.day)}${z(p.hour)}${z(p.minute)}${z(p.second)}.csv`;
}

/** Assigned once per return; never reused (spec L0037). */
export function vendorReturnManifestId(returnId: string): string {
  return `GWVR-${returnId.replace(/-/g, "").toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runVendorReturnCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`vendor-return-core FAIL: ${msg}`);
    }
  };
  ok(nextVendorReturnStatus("requested") === "submitted", "requested → submitted");
  ok(nextVendorReturnStatus("none") === "submitted", "legacy none → submitted");
  ok(nextVendorReturnStatus("submitted") === "confirmed", "submitted → confirmed");
  ok(nextVendorReturnStatus("confirmed") === "picked_up", "confirmed → picked_up");
  ok(nextVendorReturnStatus("picked_up") === null && nextVendorReturnStatus("cancelled") === null, "closed is terminal");
  ok(VENDOR_RETURN_STATUS_LABELS.submitted === "Manifest uploaded", "D63 label 1");
  ok(VENDOR_RETURN_STATUS_LABELS.confirmed === "LCB success email and PDF received", "D63 label 2");
  ok(!VENDOR_RETURN_STATE_STEPS.join(" ").match(/48|Mon\/Wed\/Fri/), "no 48–72h / Mon-Wed-Fri (F-15-19)");
  ok(isLegacyReducedReturn({ reserved_qty: 0, adjustment_id: "a" }), "legacy reduced");
  ok(!isLegacyReducedReturn({ reserved_qty: 2, adjustment_id: null }), "reserved is not legacy");
  const base: VendorReturnLogInput = {
    lotStatus: "active", reason: "defective", quantity: 2, free: 5, vendorId: "v", rmaNumber: "R1",
    processorLicense: "412345", detail: "Seal broken, vendor agreed by email", todayPacific: "2026-11-02",
  };
  ok(evaluateVendorReturnLog(base).ok, "good log ok");
  const codes = (x: ReturnType<typeof evaluateVendorReturnLog>) => (x.ok ? [] : x.refusals.map((r) => r.code));
  ok(codes(evaluateVendorReturnLog({ ...base, rmaNumber: "" })).includes("rma"), "rma required");
  ok(codes(evaluateVendorReturnLog({ ...base, processorLicense: "ABC" })).includes("license"), "numeric license");
  ok(codes(evaluateVendorReturnLog({ ...base, vendorId: null })).includes("vendor"), "vendor required");
  ok(codes(evaluateVendorReturnLog({ ...base, detail: "" })).includes("detail"), "detail required");
  ok(codes(evaluateVendorReturnLog({ ...base, quantity: 6 })).includes("qty_free"), "free qty");
  ok(codes(evaluateVendorReturnLog({ ...base, lotStatus: "destroyed" })).includes("lot_status"), "destroyed lot refused");
  ok(codes(evaluateVendorReturnLog({ ...base, lotStatus: "recalled" })).includes("recalled_needs_recall"), "recalled lot needs reason recall");
  ok(codes(evaluateVendorReturnLog({ ...base, reason: "recall" })).includes("recall_officer"), "recall needs officer");
  ok(evaluateVendorReturnLog({ ...base, lotStatus: "recalled", reason: "recall", recallOfficer: "Ofc. Smith", recallContactDate: "2026-11-01" }).ok, "recall return ok");
  ok(codes(evaluateVendorReturnLog({ ...base, reason: "recall", recallOfficer: "X", recallContactDate: "2026-12-01" })).includes("recall_date_future"), "recall date future");
  const step = (o: Partial<VendorReturnStepInput>) => evaluateVendorReturnStep({ from: "requested", to: "submitted", manifestNumber: "M1", todayPacific: "2026-11-02", nowIso: "2026-11-02T20:00:00.000Z", ...o });
  ok(step({}).ok, "upload step ok");
  ok(!step({ to: "confirmed" }).ok, "cannot skip upload");
  ok(!step({ manifestNumber: "" }).ok, "manifest number required");
  ok(!step({ from: "submitted", to: "confirmed", lcbEmailDate: "" }).ok, "lcb date required");
  ok(!step({ from: "submitted", to: "confirmed", lcbEmailDate: "2026-10-30", submittedDay: "2026-10-31" }).ok, "lcb date not before upload");
  ok(step({ from: "submitted", to: "confirmed", lcbEmailDate: "2026-11-01", submittedDay: "2026-10-31" }).ok, "confirm ok");
  ok(!step({ from: "confirmed", to: "picked_up", pickupIso: "2026-11-02T19:00:00.000Z", driverName: "" }).ok, "driver required");
  ok(!step({ from: "confirmed", to: "picked_up", pickupIso: "2026-11-03T19:00:00.000Z", driverName: "Ann" }).ok, "no future pickup");
  ok(step({ from: "confirmed", to: "picked_up", pickupIso: "2026-11-02T19:00:00.000Z", driverName: "Ann" }).ok, "depart ok");
  ok(!step({ from: "picked_up", to: "picked_up" }).ok, "closed refuses");
  ok(!evaluateVendorReturnCancel({ status: "requested", canCancel: false, legacyReduced: false, reason: "vendor withdrew" }).ok, "cancel owner only");
  ok(!evaluateVendorReturnCancel({ status: "picked_up", canCancel: true, legacyReduced: false, reason: "vendor withdrew" }).ok, "cannot cancel departed");
  ok(!evaluateVendorReturnCancel({ status: "requested", canCancel: true, legacyReduced: true, reason: "vendor withdrew" }).ok, "legacy cannot cancel");
  ok(!evaluateVendorReturnCancel({ status: "requested", canCancel: true, legacyReduced: false, reason: "" }).ok, "cancel reason required");
  ok(evaluateVendorReturnCancel({ status: "confirmed", canCancel: true, legacyReduced: false, reason: "vendor withdrew" }).ok, "cancel ok");
  const note = vendorReturnAdjustmentNote({ processorName: "Acme", processorLicense: "412345", manifestNumber: "GWVR-1", rmaNumber: "R9", reason: "defective", detail: "seal broken" });
  ok(note === "Vendor return to Acme license 412345, manifest GWVR-1, RMA R9, reason defective: seal broken", "note names processor, manifest, RMA");
  ok(pacificInputToIso("2026-07-01", "09:30") === "2026-07-01T16:30:00.000Z", "PDT input");
  ok(pacificInputToIso("2026-12-01", "09:30") === "2026-12-01T17:30:00.000Z", "PST input");
  ok(pacificInputToIso("2026-12-01", "") === null && pacificInputToIso("bad", "09:30") === null, "bad input");
  ok(manifestDateTime("2026-07-01T16:30:00.000Z") === "07/01/2026 09:30 AM", "manifest AM");
  ok(manifestDateTime("2026-12-02T01:05:00.000Z") === "12/01/2026 05:05 PM", "manifest PM, Pacific day");
  ok(manifestDateTime("2026-07-01T07:00:00.000Z") === "07/01/2026 12:00 AM", "midnight 12 AM");
  ok(manifestUom("each") === "Each" && manifestUom("g") === "Gram" && manifestUom("oz") === null, "uom map");
  ok(manifestFileName("413541", new Date("2026-11-02T20:01:02.000Z")) === "manifest_413541_20261102120102.csv", "file name Pacific");
  ok(vendorReturnManifestId("ab-cd") === "GWVR-ABCD", "manifest id");
  const m: ManifestInput = {
    submittedBy: "Michael Lyman", submittedAt: new Date("2026-11-02T20:00:00.000Z"), externalManifestId: "GWVR-1", headerOperation: "Insert",
    transportationType: "Pick-up", originLicense: "413541", originPhone: "3605550100", originEmail: "a@b.com", transporterLicense: "",
    driverName: "Ann Lee", departureIso: "2026-11-03T18:00:00.000Z", arrivalIso: "2026-11-03T19:00:00.000Z", vin: "1HGCM82633A004352",
    plate: "ABC1234", model: "Transit", make: "Ford", color: "White", destinationLicense: "412345", destinationPhone: "3605550101",
    destinationEmail: "p@q.com", items: [{ inventoryExternalId: "INV1", quantity: 2, uom: "Each", weightPerUnit: 3.5, servingsPerUnit: 1 }],
  };
  const built = buildManifestCsv(m);
  ok(built.ok, "manifest builds");
  if (built.ok) {
    const rows = built.csv.split("\r\n");
    ok(rows.length === 24 && rows[23] === "", "21 + header + 1 item + final CRLF");
    ok(rows.slice(0, 21).every((r) => r.split(",").length === 13), "header rows padded to 13");
    ok(rows[6] === "OriginLicenseNumber,413541,,,,,,,,,,,", "origin row");
    ok(rows[2] === "NumberRecords,1,,,,,,,,,,,", "NumberRecords = items");
    ok(rows[9] === "TransportationLicenseNumber,,,,,,,,,,,,", "no transporter license for Pick-up");
    ok(rows[22] === "INV1,,2,Each,3.5,1,,,Michael Lyman,11/02/2026,,,Insert", "item row");
  }
  ok(!buildManifestCsv({ ...m, plate: "ABCD12345" }).ok, "plate limit 7");
  ok(!buildManifestCsv({ ...m, transporterLicense: "123" }).ok, "transporter license refused for Pick-up");
  ok(!buildManifestCsv({ ...m, transportationType: "Transporter Licensee" }).ok, "transporter license required");
  ok(!buildManifestCsv({ ...m, driverName: "Lee, Ann" }).ok, "comma refused");
  ok(!buildManifestCsv({ ...m, items: [{ ...m.items[0], servingsPerUnit: null }] }).ok, "servings required");
  ok(!buildManifestCsv({ ...m, items: [{ ...m.items[0], inventoryExternalId: "" }] }).ok, "inventory id required");
  console.log(`vendor-return-core: ${passed} assertions passed, ${failed} failed`);
  return { passed, failed };
}
