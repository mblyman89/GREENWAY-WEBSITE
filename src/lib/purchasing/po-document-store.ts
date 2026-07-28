/**
 * src/lib/purchasing/po-document-store.ts
 *
 * SLICE 81 — server-side assembly for the branded PO document and the
 * procure-to-pay paper trail. All rendering/classification logic lives in the
 * PURE po-document-core; this file only gathers REAL facts:
 *
 *   - buildPoDocumentModel(poId): PO + lines (po-store), the vendor's license /
 *     address / contacts (vendors table), and Greenway's own business facts
 *     (src/content/business.ts + WSLCB license 413541).
 *   - buildPoTrailFacts(poId): manifests linked via migration 0102 (42703
 *     no-op-safe probe), each manifest's cost basis (SUM received_qty ×
 *     unit_cost over non-rejected lots — the SAME math as
 *     vendor-payables-store) and payments applied (vendor_manifest_payments,
 *     migration 0067), plus the W9 paid stamp (migration 0103).
 *
 * Money is CENTS end to end. Best-effort: returns null / honest gaps instead
 * of throwing when Supabase is not configured or migrations are pending.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getPurchaseOrder, type PurchaseOrderWithLines } from "@/lib/purchasing/po-store";
import { getVendorById } from "@/lib/vendors/store";
import { greenwayBusiness } from "@/content/business";
import {
  poCodename,
  type PoDocumentParams,
  type PoTrailFacts,
  type TrailManifestFact,
} from "@/lib/purchasing/po-document-core";

/** Greenway's WSLCB retail license — same constant the manifest parsers pin. */
export const GREENWAY_LICENSE = "413541";

/** Our own business block for the document header / ship-to / bill-to. */
export function greenwayStoreFacts(): PoDocumentParams["store"] {
  return {
    name: greenwayBusiness.name,
    licenseNumber: GREENWAY_LICENSE,
    addressLines: [
      greenwayBusiness.address.line1,
      `${greenwayBusiness.address.city}, ${greenwayBusiness.address.state} ${greenwayBusiness.address.postalCode}`,
    ],
    phone: greenwayBusiness.phone.formatted,
    email: greenwayBusiness.email,
    website: greenwayBusiness.website,
  };
}

export type PoDocumentModel = {
  po: PurchaseOrderWithLines;
  codename: string | null;
  params: PoDocumentParams;
};

/**
 * Assemble everything the branded document needs. Vendor facts come from the
 * live vendors table when the PO is linked to one (license number, shipping
 * address, phone) and fall back to the PO's own snapshot columns otherwise.
 */
export async function buildPoDocumentModel(poId: string): Promise<PoDocumentModel | null> {
  const po = await getPurchaseOrder(poId);
  if (!po) return null;

  let vendorLicense: string | null = null;
  let vendorAddressLines: string[] = [];
  let vendorPhone: string | null = null;
  let vendorEmail: string | null = po.vendor_email;
  if (po.vendor_id) {
    const vendor = await getVendorById(po.vendor_id);
    if (vendor) {
      vendorLicense = vendor.license_number;
      vendorPhone = vendor.phone;
      if (!vendorEmail) vendorEmail = vendor.email;
      const cityLine = [vendor.shipping_city, vendor.shipping_state, vendor.shipping_zip]
        .filter(Boolean)
        .join(", ")
        .replace(/, ([A-Z]{2}), /, ", $1 ");
      vendorAddressLines = [vendor.shipping_address1 ?? "", vendor.shipping_address2 ?? "", cityLine].filter(
        (l) => l.trim().length > 0,
      );
    }
  }

  const codename = poCodename(po.po_number);
  const params: PoDocumentParams = {
    poNumber: po.po_number ?? "PO (unnumbered)",
    codename,
    status: po.status,
    createdAt: po.created_at ?? null,
    expectedDate: po.expected_date,
    note: po.note,
    paidAt: po.paid_at ?? null,
    vendor: {
      name: po.vendor_name ?? "Vendor",
      licenseNumber: vendorLicense,
      addressLines: vendorAddressLines,
      email: vendorEmail,
      phone: vendorPhone,
    },
    store: greenwayStoreFacts(),
    lines: po.lines.map((l) => ({
      productName: l.product_name,
      brand: l.brand,
      category: l.category,
      orderQty: l.order_qty,
      unit: l.unit,
      unitCostMinor: l.unit_cost_minor_units,
    })),
  };
  return { po, codename, params };
}

// ---------------------------------------------------------------------------
// Paper trail facts
// ---------------------------------------------------------------------------

/** True when a PostgREST error means "column does not exist" (0102 pending). */
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    /column .* does not exist|could not find .* column/i.test(error.message ?? "")
  );
}

/** Lots excluded from cost basis — mirrors vendor-payables-store. */
const EXCLUDED_LOT_STATUSES = new Set(["rejected"]);

export type PoTrailData = {
  facts: PoTrailFacts;
  /** For cross-links: manifest id → intake review page. */
  manifests: (TrailManifestFact & { acceptedAt: string | null })[];
};

/**
 * Gather the REAL chain facts for one PO: linked manifests (0102), owed/paid
 * per manifest, and the paid stamp. Pre-0102 the link is honestly reported as
 * unavailable; nothing throws.
 */
export async function buildPoTrailFacts(po: PurchaseOrderWithLines): Promise<PoTrailData> {
  const empty: PoTrailData = {
    facts: {
      poNumber: po.po_number,
      status: po.status,
      linkAvailable: false,
      manifests: [],
      paidAt: po.paid_at ?? null,
      paymentReference: po.payment_reference ?? null,
    },
    manifests: [],
  };
  if (!isSupabaseServiceConfigured) return empty;
  const admin = createSupabaseAdminClient();

  // 1) Manifests linked to this PO (probe doubles as the 0102 check).
  const { data: mData, error: mErr } = await admin
    .from("inbound_manifests")
    .select("id, manifest_number, status, accepted_at")
    .eq("purchase_order_id", po.id);
  if (mErr) {
    if (!isMissingColumnError(mErr)) {
      console.error("[po-document-store] manifest link read failed:", mErr.message);
    }
    return empty;
  }
  const mRows =
    (mData as { id: string; manifest_number: string | null; status: string; accepted_at: string | null }[] | null) ??
    [];
  const manifestIds = mRows.map((m) => m.id);

  // 2) Cost basis per manifest — SUM(received_qty × unit_cost) over
  //    non-rejected lots (same math as vendor-payables-store / po-paid-stamp).
  const owedByManifest = new Map<string, number>();
  const paidByManifest = new Map<string, number>();
  if (manifestIds.length > 0) {
    const { data: lots } = await admin
      .from("inventory_lots")
      .select("manifest_id, received_qty, unit_cost_minor_units, status")
      .in("manifest_id", manifestIds);
    for (const lot of (lots as
      | { manifest_id: string | null; received_qty: number | null; unit_cost_minor_units: number | null; status: string | null }[]
      | null) ?? []) {
      if (!lot.manifest_id) continue;
      if (EXCLUDED_LOT_STATUSES.has((lot.status || "").toLowerCase())) continue;
      const line = Math.round((Number(lot.received_qty) || 0) * (Number(lot.unit_cost_minor_units) || 0));
      owedByManifest.set(lot.manifest_id, (owedByManifest.get(lot.manifest_id) ?? 0) + line);
    }

    // 3) Payments applied (migration 0067).
    const { data: payments } = await admin
      .from("vendor_manifest_payments")
      .select("manifest_id, amount_minor_units")
      .in("manifest_id", manifestIds);
    for (const p of (payments as { manifest_id: string; amount_minor_units: number | null }[] | null) ?? []) {
      if (!p.manifest_id) continue;
      paidByManifest.set(p.manifest_id, (paidByManifest.get(p.manifest_id) ?? 0) + (Number(p.amount_minor_units) || 0));
    }
  }

  const manifests = mRows.map((m) => ({
    id: m.id,
    number: m.manifest_number,
    status: m.status,
    owedMinor: owedByManifest.get(m.id) ?? 0,
    paidMinor: paidByManifest.get(m.id) ?? 0,
    acceptedAt: m.accepted_at,
  }));

  return {
    facts: {
      poNumber: po.po_number,
      status: po.status,
      linkAvailable: true,
      manifests,
      paidAt: po.paid_at ?? null,
      paymentReference: po.payment_reference ?? null,
    },
    manifests,
  };
}
