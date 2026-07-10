/**
 * src/lib/purchasing/po-paid-stamp-store.ts
 *
 * W9 — server side of the "Mark PO paid" stamp (audit gap G3).
 *
 * Called BEST-EFFORT after Accounts Payable records a payment (manual entry
 * or NACHA draft generation). If the paid manifest is linked to a purchase
 * order (W5 / migration 0102) and that payment settles EVERY manifest linked
 * to the PO, we stamp `paid_at` + `payment_reference` on the PO (migration
 * 0103) so Purchasing can answer "which received POs are still unpaid?".
 *
 * GUARANTEES:
 *   - NO-OP-SAFE PRE-MIGRATION: missing purchase_order_id (pre-0102) or
 *     missing paid_at/payment_reference (pre-0103) → silent skip (house
 *     42703 probe pattern);
 *   - FIRST SETTLE WINS: an existing paid_at is never overwritten (the
 *     update carries `.is("paid_at", null)`);
 *   - NEVER GUESS: settlement math lives in the PURE core — a PO with no
 *     linked manifests or no cost basis is never stamped;
 *   - BEST-EFFORT: never throws; a failure here never blocks the payment
 *     that was already recorded.
 *
 * Money is CENTS (minor units) end to end.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  evaluatePoSettlement,
  type ManifestSettlementFacts,
} from "@/lib/purchasing/po-paid-stamp-core";

/** Same missing-column probe as the W5/W8 stores (migrations not applied yet). */
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    /column .* does not exist|could not find .* column/i.test(error.message ?? "")
  );
}

/** Lots excluded from cost basis — mirrors vendor-payables-store. */
const EXCLUDED_LOT_STATUSES = new Set(["rejected"]);

export type PoPaidStampResult =
  | { attempted: false }
  | { attempted: true; stamped: boolean; poNumber: string | null; note: string };

/**
 * After a payment lands on `manifestId`, stamp its linked PO as paid if every
 * manifest linked to that PO is now fully settled. `referenceLabel` is the
 * human-readable payment reference (from paymentReferenceLabel in the core).
 */
export async function stampPoPaidIfSettled(
  manifestId: string,
  referenceLabel: string,
): Promise<PoPaidStampResult> {
  try {
    if (!isSupabaseServiceConfigured) return { attempted: false };
    const admin = createSupabaseAdminClient();

    // 1) Is this manifest linked to a PO? (pre-0102 → silent skip)
    const { data: mRow, error: mErr } = await admin
      .from("inbound_manifests")
      .select("id, purchase_order_id")
      .eq("id", manifestId)
      .maybeSingle();
    if (mErr) {
      if (!isMissingColumnError(mErr)) {
        console.error("[po-paid-stamp] manifest link read failed:", mErr.message);
      }
      return { attempted: false };
    }
    const poId = (mRow as { purchase_order_id?: string | null } | null)?.purchase_order_id ?? null;
    if (!poId) return { attempted: false };

    // 2) Read the PO's paid stamp. (pre-0103 → silent skip; already paid →
    //    first settle wins, nothing to do.)
    const { data: poRow, error: poErr } = await admin
      .from("purchase_orders")
      .select("id, po_number, paid_at")
      .eq("id", poId)
      .maybeSingle();
    if (poErr) {
      if (!isMissingColumnError(poErr)) {
        console.error("[po-paid-stamp] po read failed:", poErr.message);
      }
      return { attempted: false };
    }
    if (!poRow) return { attempted: false };
    const po = poRow as { id: string; po_number: string | null; paid_at: string | null };
    if (po.paid_at) {
      return {
        attempted: true,
        stamped: false,
        poNumber: po.po_number,
        note: `${po.po_number ?? "PO"} was already stamped paid — first settle wins.`,
      };
    }

    // 3) EVERY manifest linked to this PO must be settled, not just this one.
    const { data: linked, error: lErr } = await admin
      .from("inbound_manifests")
      .select("id")
      .eq("purchase_order_id", poId);
    if (lErr) return { attempted: false };
    const linkedIds = ((linked as { id: string }[] | null) ?? []).map((r) => r.id);
    if (linkedIds.length === 0) return { attempted: false };

    // Cost basis per manifest: SUM(received_qty × unit_cost) over non-rejected
    // lots — the SAME math as vendor-payables-store.
    const { data: lots } = await admin
      .from("inventory_lots")
      .select("manifest_id, received_qty, unit_cost_minor_units, status")
      .in("manifest_id", linkedIds);
    const owedByManifest = new Map<string, number>();
    for (const lot of (lots as
      | { manifest_id: string | null; received_qty: number | null; unit_cost_minor_units: number | null; status: string | null }[]
      | null) ?? []) {
      if (!lot.manifest_id) continue;
      if (EXCLUDED_LOT_STATUSES.has((lot.status || "").toLowerCase())) continue;
      const line = Math.round((Number(lot.received_qty) || 0) * (Number(lot.unit_cost_minor_units) || 0));
      owedByManifest.set(lot.manifest_id, (owedByManifest.get(lot.manifest_id) ?? 0) + line);
    }

    const { data: payments } = await admin
      .from("vendor_manifest_payments")
      .select("manifest_id, amount_minor_units")
      .in("manifest_id", linkedIds);
    const paidByManifest = new Map<string, number>();
    for (const p of (payments as { manifest_id: string | null; amount_minor_units: number | null }[] | null) ?? []) {
      if (!p.manifest_id) continue;
      paidByManifest.set(
        p.manifest_id,
        (paidByManifest.get(p.manifest_id) ?? 0) + (Number(p.amount_minor_units) || 0),
      );
    }

    const facts: ManifestSettlementFacts[] = linkedIds.map((id) => ({
      manifestId: id,
      owedMinorUnits: owedByManifest.get(id) ?? 0,
      paidMinorUnits: paidByManifest.get(id) ?? 0,
    }));

    // 4) PURE verdict — refuses empty/zero-basis; surfaces outstanding.
    const verdict = evaluatePoSettlement(facts);
    if (!verdict.settled) {
      return { attempted: true, stamped: false, poNumber: po.po_number, note: verdict.reason };
    }

    // 5) Stamp — guarded by `.is("paid_at", null)` so a concurrent settle
    //    can't overwrite (first settle wins at the DB level too).
    const { error: uErr } = await admin
      .from("purchase_orders")
      .update({
        paid_at: new Date().toISOString(),
        payment_reference: referenceLabel,
        updated_at: new Date().toISOString(),
      })
      .eq("id", poId)
      .is("paid_at", null);
    if (uErr) {
      if (!isMissingColumnError(uErr)) {
        console.error("[po-paid-stamp] stamp write failed:", uErr.message);
      }
      return { attempted: false };
    }

    return {
      attempted: true,
      stamped: true,
      poNumber: po.po_number,
      note: `${po.po_number ?? "PO"} stamped paid (${referenceLabel}). ${verdict.reason}`,
    };
  } catch (err) {
    console.error("[po-paid-stamp] unexpected failure:", err);
    return { attempted: false };
  }
}
