/**
 * vendor-payables-store.ts — server store for manifest-backed vendor payables (B6).
 *
 * An I-502 vendor "invoice" in this back office is an ACCEPTED inbound manifest
 * (the WCIA transfer). The amount OWED for a manifest is the CCRS cost basis:
 *
 *   owed = SUM(received_qty * unit_cost_minor_units) over its non-rejected lots
 *
 * (unit_cost_minor_units is computed at intake from line_price/qty — see
 * src/lib/inventory/intake-parser.ts). We subtract prior payments recorded in
 * vendor_manifest_payments to get the REMAINING owed, which the ACH guardrails
 * use to BLOCK overpayment and WARN on underpayment.
 *
 * Money is CENTS (integer minor units) end to end. Server-only (Supabase I/O).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  PAYABLE_MANIFEST_STATUSES,
  type ManifestPayable,
} from "@/lib/payments/vendor-ach-core";

/** A payable with light display extras for the UI (still CENTS internally). */
export type VendorPayableRow = ManifestPayable & {
  acceptedAt: string | null;
  /** Number of non-rejected lots contributing to `owedMinorUnits`. */
  lotCount: number;
};

/** Lots we EXCLUDE from cost basis (rejected at dock / rejected). */
const EXCLUDED_LOT_STATUSES = new Set(["rejected"]);

/**
 * List accepted (payable) manifests with computed owed + already-paid totals.
 * Returns rows sorted by most-recently-accepted first. Never throws; returns []
 * when the DB isn't configured.
 */
export async function listVendorPayables(opts?: {
  vendorId?: string;
  /** Include manifests that are already fully paid (default false). */
  includePaid?: boolean;
  limit?: number;
}): Promise<VendorPayableRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();

  // 1) Accepted / partially-accepted manifests.
  const statuses = Array.from(PAYABLE_MANIFEST_STATUSES);
  let mq = admin
    .from("inbound_manifests")
    .select("id, manifest_number, vendor_id, vendor_label, status, accepted_at")
    .in("status", statuses)
    .order("accepted_at", { ascending: false, nullsFirst: false })
    .limit(opts?.limit ?? 300);
  if (opts?.vendorId) mq = mq.eq("vendor_id", opts.vendorId);
  const { data: manifests } = await mq;
  const mrows =
    (manifests as
      | {
          id: string;
          manifest_number: string | null;
          vendor_id: string | null;
          vendor_label: string | null;
          status: string;
          accepted_at: string | null;
        }[]
      | null) ?? [];
  if (mrows.length === 0) return [];

  const manifestIds = mrows.map((m) => m.id);

  // 2) Non-rejected lots for those manifests → owed = SUM(received_qty * unit_cost).
  const { data: lots } = await admin
    .from("inventory_lots")
    .select("manifest_id, received_qty, unit_cost_minor_units, status")
    .in("manifest_id", manifestIds);
  const lotRows =
    (lots as
      | {
          manifest_id: string | null;
          received_qty: number | null;
          unit_cost_minor_units: number | null;
          status: string | null;
        }[]
      | null) ?? [];

  const owedByManifest = new Map<string, number>();
  const lotCountByManifest = new Map<string, number>();
  for (const lot of lotRows) {
    if (!lot.manifest_id) continue;
    if (EXCLUDED_LOT_STATUSES.has((lot.status || "").toLowerCase())) continue;
    const qty = Number(lot.received_qty) || 0;
    const unit = Number(lot.unit_cost_minor_units) || 0;
    const line = Math.round(qty * unit);
    owedByManifest.set(lot.manifest_id, (owedByManifest.get(lot.manifest_id) ?? 0) + line);
    lotCountByManifest.set(lot.manifest_id, (lotCountByManifest.get(lot.manifest_id) ?? 0) + 1);
  }

  // 3) Prior payments already applied → paid = SUM(amount_minor_units).
  const { data: payments } = await admin
    .from("vendor_manifest_payments")
    .select("manifest_id, amount_minor_units")
    .in("manifest_id", manifestIds);
  const payRows =
    (payments as { manifest_id: string; amount_minor_units: number | null }[] | null) ?? [];
  const paidByManifest = new Map<string, number>();
  for (const p of payRows) {
    if (!p.manifest_id) continue;
    paidByManifest.set(
      p.manifest_id,
      (paidByManifest.get(p.manifest_id) ?? 0) + (Number(p.amount_minor_units) || 0),
    );
  }

  // 4) Resolve vendor display names (best-effort).
  const vendorIds = Array.from(new Set(mrows.map((m) => m.vendor_id).filter(Boolean))) as string[];
  const vendorNames = new Map<string, string>();
  if (vendorIds.length > 0) {
    const { data: v } = await admin
      .from("vendors")
      .select("id, display_name")
      .in("id", vendorIds);
    for (const row of (v as { id: string; display_name: string | null }[] | null) ?? []) {
      if (row.display_name) vendorNames.set(row.id, row.display_name);
    }
  }

  const rows: VendorPayableRow[] = mrows.map((m) => {
    const owed = owedByManifest.get(m.id) ?? 0;
    const paid = paidByManifest.get(m.id) ?? 0;
    const vendorName =
      (m.vendor_id ? vendorNames.get(m.vendor_id) : null) || m.vendor_label || "Unknown vendor";
    return {
      manifestId: m.id,
      manifestNumber: m.manifest_number || m.id,
      vendorId: m.vendor_id,
      vendorName,
      status: m.status,
      owedMinorUnits: owed,
      paidMinorUnits: paid,
      acceptedAt: m.accepted_at,
      lotCount: lotCountByManifest.get(m.id) ?? 0,
    };
  });

  const filtered = opts?.includePaid
    ? rows
    : rows.filter((r) => r.owedMinorUnits - r.paidMinorUnits > 0);

  // Only surface payables that actually have a cost basis (owed > 0), unless
  // explicitly including paid ones for history.
  return filtered.filter((r) => r.owedMinorUnits > 0 || opts?.includePaid);
}

/** Fetch a single payable by manifest id (fresh owed/paid). Null if not found. */
export async function getVendorPayable(manifestId: string): Promise<VendorPayableRow | null> {
  const all = await listVendorPayables({ includePaid: true, limit: 1000 });
  return all.find((r) => r.manifestId === manifestId) ?? null;
}

/** Input for recording a payment against a manifest (CENTS). */
export type RecordManifestPaymentInput = {
  manifestId: string;
  vendorId: string | null;
  vendorName: string;
  manifestNumber: string;
  amountMinorUnits: number;
  owedMinorUnits: number;
  isPartial: boolean;
  achBatchRef?: string | null;
  note?: string | null;
  createdBy?: string | null;
};

/**
 * Insert a vendor_manifest_payments row. Server-only. Returns the new id or null.
 * NOTE: guardrails (accepted + over/under) must be checked BEFORE calling this
 * (see checkManifestPayment in vendor-ach-core.ts). This is the persistence step.
 */
export async function recordManifestPayment(
  input: RecordManifestPaymentInput,
): Promise<{ id: string } | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("vendor_manifest_payments")
    .insert({
      manifest_id: input.manifestId,
      vendor_id: input.vendorId,
      vendor_name: input.vendorName,
      manifest_number: input.manifestNumber,
      amount_minor_units: input.amountMinorUnits,
      owed_minor_units: input.owedMinorUnits,
      is_partial: input.isPartial,
      ach_batch_ref: input.achBatchRef ?? null,
      note: input.note ?? null,
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return { id: (data as { id: string }).id };
}
