/**
 * src/lib/inventory/po-link-store.ts
 *
 * W5 — server-side plumbing for the manifest ↔ purchase-order link
 * (suggest-and-confirm; migration 0102 adds inbound_manifests.purchase_order_id).
 *
 * NO-OP-SAFE PRE-MIGRATION (standing rule: owner applies migrations manually):
 * every read probes for the column and degrades to "feature hidden" —
 * `{ available: false }` — instead of crashing, so this code can merge and
 * deploy before 0102 is applied.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listPurchaseOrders, getPurchaseOrder } from "@/lib/purchasing/po-store";
import { logManifestEvent } from "@/lib/inventory/intake-store";
import {
  suggestPoMatches,
  LINKABLE_PO_STATUSES,
  type ManifestMatchFacts,
  type PoMatchCandidate,
  type PoMatchSuggestion,
} from "@/lib/inventory/po-match-core";

/** True when a PostgREST error looks like "column does not exist" (0102 not applied yet). */
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    /column .* does not exist|could not find .* column/i.test(error.message ?? "")
  );
}

export type ManifestPoLinkState =
  | { available: false }
  | {
      available: true;
      linkedPoId: string | null;
      /** Summary of the linked PO for display (null when unlinked or PO gone). */
      linkedPo: { id: string; po_number: string | null; status: string; vendor_name: string | null } | null;
      /** Ranked suggestions (empty when already linked). */
      suggestions: PoMatchSuggestion[];
    };

/**
 * Load the link state for a manifest review page: current link (if any) plus
 * ranked suggestions when unlinked. `{available:false}` pre-migration.
 */
export async function getManifestPoLinkState(manifest: {
  id: string;
  vendor_id: string | null;
  vendor_label: string | null;
  transfer_date: string | null;
  eta_date: string | null;
}): Promise<ManifestPoLinkState> {
  if (!isSupabaseServiceConfigured) return { available: false };
  const admin = createSupabaseAdminClient();

  // Probe the column itself — the cheapest reliable "is 0102 applied?" check.
  const { data, error } = await admin
    .from("inbound_manifests")
    .select("purchase_order_id")
    .eq("id", manifest.id)
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error)) return { available: false };
    return { available: false };
  }

  const linkedPoId = (data as { purchase_order_id: string | null } | null)?.purchase_order_id ?? null;

  if (linkedPoId) {
    const po = await getPurchaseOrder(linkedPoId);
    return {
      available: true,
      linkedPoId,
      linkedPo: po
        ? { id: po.id, po_number: po.po_number, status: po.status, vendor_name: po.vendor_name }
        : null,
      suggestions: [],
    };
  }

  // Unlinked → rank open POs as candidates (pure core does the thinking).
  let candidates: PoMatchCandidate[] = [];
  try {
    const pos = await listPurchaseOrders();
    candidates = pos
      .filter((p) => (LINKABLE_PO_STATUSES as readonly string[]).includes(p.status))
      .map((p) => ({
        id: p.id,
        po_number: p.po_number,
        vendor_id: p.vendor_id,
        vendor_name: p.vendor_name,
        status: p.status,
        expected_date: p.expected_date,
        subtotal_minor_units: p.subtotal_minor_units,
        line_count: p.line_count,
      }));
  } catch {
    candidates = [];
  }

  const facts: ManifestMatchFacts = {
    vendor_id: manifest.vendor_id,
    vendor_label: manifest.vendor_label,
    transfer_date: manifest.transfer_date,
    eta_date: manifest.eta_date,
  };

  return {
    available: true,
    linkedPoId: null,
    linkedPo: null,
    suggestions: suggestPoMatches(facts, candidates),
  };
}

/**
 * Human-confirmed link (or unlink with poId=null). Logs a timeline event so
 * the chain of custody records who connected the paper trail.
 */
export async function setManifestPoLink(
  manifestId: string,
  poId: string | null,
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();

  // Validate target PO when linking (must exist; suggest-and-confirm means a
  // human chose it, but we still refuse dangling ids).
  let poLabel = "";
  if (poId) {
    const po = await getPurchaseOrder(poId);
    if (!po) return { ok: false, error: "That purchase order no longer exists." };
    poLabel = po.po_number ?? poId;
  }

  const { error } = await admin
    .from("inbound_manifests")
    .update({ purchase_order_id: poId, updated_by: actorId })
    .eq("id", manifestId);
  if (error) {
    if (isMissingColumnError(error)) {
      return { ok: false, error: "PO linking needs migration 0102 applied first." };
    }
    return { ok: false, error: error.message };
  }

  await logManifestEvent(
    manifestId,
    "po_link",
    poId ? `Linked to purchase order ${poLabel}.` : "Unlinked from its purchase order.",
    actorId,
  );
  return { ok: true };
}
