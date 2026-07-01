/**
 * GET /admin/inventory/intake/export?format=csv|xlsx&status=all|pending|...
 *
 * Slice 82 — export the full intake picture as a clean CSV or styled .xlsx.
 * Two sheets, EVERY field the owner asked for:
 *   1. "Manifests" — one row per inbound manifest (identifiers, vendor, dates,
 *      lifecycle status, accepted/refused lot counts, full transport /
 *      chain-of-custody, and all lifecycle timestamps).
 *   2. "Lots" — one row per lot line across all manifests (product, strain, lot
 *      code, category, quantities, unit cost, sample/medical flags, disposition,
 *      reject reason, expiry, lab COA link, created-at).
 *
 * Staff-gated (inventory.manage). Money is emitted as real currency cells (xlsx)
 * / two-decimal dollars (csv) via the shared reports workbook helper; cents in →
 * dollars out automatically.
 */
import { requirePermission } from "@/lib/auth/session";
import {
  listManifests,
  listAllManifestLotsForExport,
} from "@/lib/inventory/intake-store";
import { REJECT_REASON_LABELS, isRejectReasonCode } from "@/lib/inventory/intake-disposition-core";
import {
  exportResponse,
  parseFormat,
  type TableColumn,
  type TableRow,
  type WorkbookSpec,
} from "@/lib/reports/workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MANIFEST_COLUMNS: TableColumn[] = [
  { key: "manifest_number", header: "Manifest #", type: "text" },
  { key: "vendor_label", header: "Vendor", type: "text" },
  { key: "status", header: "Status", type: "text" },
  { key: "transfer_date", header: "Transfer date", type: "text" },
  { key: "eta_date", header: "ETA", type: "text" },
  { key: "accepted_lot_count", header: "Lots accepted", type: "integer" },
  { key: "rejected_lot_count", header: "Lots refused", type: "integer" },
  { key: "source_format", header: "Source format", type: "text" },
  { key: "source_url", header: "Source URL", type: "text" },
  { key: "transporter_name", header: "Transporter", type: "text" },
  { key: "transporter_license", header: "Transporter license", type: "text" },
  { key: "driver_name", header: "Driver", type: "text" },
  { key: "driver_license_number", header: "Driver license", type: "text" },
  { key: "vehicle_description", header: "Vehicle", type: "text" },
  { key: "vehicle_plate", header: "Plate", type: "text" },
  { key: "vehicle_vin", header: "VIN", type: "text" },
  { key: "route_notes", header: "Route notes", type: "text" },
  { key: "departed_at", header: "Departed", type: "text" },
  { key: "arrived_at", header: "Arrived", type: "text" },
  { key: "in_transit_at", header: "In-transit at", type: "text" },
  { key: "received_at", header: "Received at", type: "text" },
  { key: "accepted_at", header: "Accepted at", type: "text" },
  { key: "rejected_at", header: "Rejected at", type: "text" },
  { key: "notes", header: "Notes", type: "text" },
  { key: "created_at", header: "Created", type: "text" },
];

const LOT_COLUMNS: TableColumn[] = [
  { key: "manifest_number", header: "Manifest #", type: "text" },
  { key: "vendor_label", header: "Vendor", type: "text" },
  { key: "product_name", header: "Product", type: "text" },
  { key: "strain_name", header: "Strain", type: "text" },
  { key: "lot_code", header: "Lot code", type: "text" },
  { key: "category", header: "Category", type: "text" },
  { key: "inventory_type", header: "Inventory type", type: "text" },
  { key: "pos_product_key", header: "POS product key", type: "text" },
  { key: "received_qty", header: "Received qty", type: "number" },
  { key: "on_hand_qty", header: "On-hand qty", type: "number" },
  { key: "unit", header: "Unit", type: "text" },
  { key: "unit_weight", header: "Unit weight", type: "number" },
  { key: "unit_weight_uom", header: "Weight UOM", type: "text" },
  { key: "unit_cost", header: "Unit cost", type: "currency" },
  { key: "is_sample", header: "Sample?", type: "text" },
  { key: "is_medical", header: "Medical?", type: "text" },
  { key: "status", header: "Lot status", type: "text" },
  { key: "disposition", header: "Disposition", type: "text" },
  { key: "reject_reason_code", header: "Reject reason", type: "text" },
  { key: "reject_reason", header: "Reject details", type: "text" },
  { key: "expires_on", header: "Expires", type: "text" },
  { key: "lab_result_id", header: "Lab result id", type: "text" },
  { key: "created_at", header: "Created", type: "text" },
];

function yesNo(v: boolean): string {
  return v ? "Yes" : "No";
}

function rejectLabel(code: string | null): string {
  if (!code) return "";
  return isRejectReasonCode(code) ? REJECT_REASON_LABELS[code] : code;
}

export async function GET(request: Request) {
  await requirePermission("inventory.manage");
  const url = new URL(request.url);
  const format = parseFormat(url.searchParams.get("format"));
  const status = url.searchParams.get("status") ?? "all";

  const [manifests, lots] = await Promise.all([
    listManifests({ status, limit: 2000 }),
    listAllManifestLotsForExport(),
  ]);

  const manifestRows: TableRow[] = manifests.map((m) => ({
    manifest_number: m.manifest_number ?? "",
    vendor_label: m.vendor_label ?? "",
    status: m.status ?? "",
    transfer_date: m.transfer_date ?? "",
    eta_date: m.eta_date ?? "",
    accepted_lot_count: m.accepted_lot_count ?? 0,
    rejected_lot_count: m.rejected_lot_count ?? 0,
    source_format: m.source_format ?? "",
    source_url: m.source_url ?? "",
    transporter_name: m.transporter_name ?? "",
    transporter_license: m.transporter_license ?? "",
    driver_name: m.driver_name ?? "",
    driver_license_number: m.driver_license_number ?? "",
    vehicle_description: m.vehicle_description ?? "",
    vehicle_plate: m.vehicle_plate ?? "",
    vehicle_vin: m.vehicle_vin ?? "",
    route_notes: m.route_notes ?? "",
    departed_at: m.departed_at ?? "",
    arrived_at: m.arrived_at ?? "",
    in_transit_at: m.in_transit_at ?? "",
    received_at: m.received_at ?? "",
    accepted_at: m.accepted_at ?? "",
    rejected_at: m.rejected_at ?? "",
    notes: m.notes ?? "",
    created_at: m.created_at ?? "",
  }));

  const lotRows: TableRow[] = lots.map((l) => ({
    manifest_number: l.manifest_number ?? "",
    vendor_label: l.vendor_label ?? "",
    product_name: l.product_name ?? "",
    strain_name: l.strain_name ?? "",
    lot_code: l.lot_code ?? "",
    category: l.category ?? "",
    inventory_type: l.inventory_type ?? "",
    pos_product_key: l.pos_product_key ?? "",
    received_qty: l.received_qty,
    on_hand_qty: l.on_hand_qty,
    unit: l.unit ?? "",
    unit_weight: l.unit_weight,
    unit_weight_uom: l.unit_weight_uom ?? "",
    unit_cost: l.unit_cost_minor_units, // minor units -> dollars by helper
    is_sample: yesNo(l.is_sample),
    is_medical: yesNo(l.is_medical),
    status: l.status ?? "",
    disposition: l.disposition ?? "",
    reject_reason_code: rejectLabel(l.reject_reason_code),
    reject_reason: l.reject_reason ?? "",
    expires_on: l.expires_on ?? "",
    lab_result_id: l.lab_result_id ?? "",
    created_at: l.created_at ?? "",
  }));

  const stamp = new Date().toISOString().slice(0, 10);
  const spec: WorkbookSpec = {
    filename: `greenway_intake_${status}_${stamp}`,
    title: "Greenway — Intake manifests & lots",
    sheets: [
      {
        name: "Manifests",
        caption: `${manifestRows.length} manifest(s) · status: ${status}`,
        columns: MANIFEST_COLUMNS,
        rows: manifestRows,
      },
      {
        name: "Lots",
        caption: `${lotRows.length} lot line(s)`,
        columns: LOT_COLUMNS,
        rows: lotRows,
      },
    ],
  };

  return exportResponse(spec, format);
}
