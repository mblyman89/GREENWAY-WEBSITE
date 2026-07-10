/**
 * src/lib/inventory/po-receive-store.ts
 *
 * W6 — server-side auto-receive: when a finalized manifest is LINKED to a
 * purchase order (W5 / migration 0102), the lots that just activated are
 * matched to the PO's lines (pure po-receive-core) and received via the
 * existing receivePoLine(), which recomputes the PO's partial/received status.
 *
 * SAFETY RAILS (all verified against the real code, not guessed):
 *   • NO-OP-SAFE PRE-MIGRATION: reading a missing purchase_order_id column
 *     returns an error → we skip silently (house 42703 probe pattern).
 *   • IDEMPOTENT: receivePoLine ADDS quantity, so we only pass the lot ids
 *     that finalize activated IN THIS RUN (a lot leaves quarantine exactly
 *     once) — re-finalizing after fixing held lots never double-counts.
 *   • STATUS-GUARDED: only a sent/partial PO can receive (LINKABLE_PO_STATUSES);
 *     terminal or unsent POs are skipped with an honest note.
 *   • BEST-EFFORT: called inside finalize's try/catch — a failure here must
 *     never break intake finalization (audit Part 5, rule 4).
 *   • NO intake-store import (finalize calls US) — the caller logs the
 *     timeline event with the note we return.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getPurchaseOrder, receivePoLine } from "@/lib/purchasing/po-store";
import { LINKABLE_PO_STATUSES } from "@/lib/inventory/po-match-core";
import {
  buildAutoReceivePlan,
  type ReceivableLot,
  type ReceivablePoLine,
} from "@/lib/inventory/po-receive-core";

/** Same missing-column probe as po-link-store (0102 not applied yet). */
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    /column .* does not exist|could not find .* column/i.test(error.message ?? "")
  );
}

export type AutoReceiveResult =
  | { attempted: false }
  | { attempted: true; receivedLines: number; note: string };

/**
 * Auto-receive a just-finalized manifest's newly-activated lots against its
 * linked PO. `activatedLotIds` MUST be only the lots activated in this
 * finalize run (idempotency). Returns `{attempted:false}` when there is
 * nothing to do (no link column, no link, no activated lots, PO not
 * receivable) and a note for the manifest timeline otherwise.
 */
export async function autoReceiveManifestPo(
  manifestId: string,
  activatedLotIds: string[],
): Promise<AutoReceiveResult> {
  if (!isSupabaseServiceConfigured) return { attempted: false };
  if (activatedLotIds.length === 0) return { attempted: false };
  const admin = createSupabaseAdminClient();

  // 1) Is the manifest linked to a PO? (No-op pre-0102: probe errors → skip.)
  const { data: mRow, error: mErr } = await admin
    .from("inbound_manifests")
    .select("purchase_order_id")
    .eq("id", manifestId)
    .maybeSingle();
  if (mErr) {
    if (!isMissingColumnError(mErr)) {
      console.error("[po-receive-store] manifest link read failed:", mErr.message);
    }
    return { attempted: false };
  }
  const poId = (mRow as { purchase_order_id: string | null } | null)?.purchase_order_id ?? null;
  if (!poId) return { attempted: false };

  // 2) The PO must exist and be receivable (sent/partial only — never write
  //    to a draft the vendor hasn't seen or a terminal received/cancelled PO).
  const po = await getPurchaseOrder(poId);
  if (!po) return { attempted: false };
  if (!(LINKABLE_PO_STATUSES as readonly string[]).includes(po.status)) {
    return {
      attempted: true,
      receivedLines: 0,
      note: `Linked PO ${po.po_number ?? poId} is '${po.status}' — auto-receive skipped; receive manually on the PO page if needed.`,
    };
  }

  // 3) Load ONLY the lots this finalize run activated.
  const { data: lotRows, error: lErr } = await admin
    .from("inventory_lots")
    .select("id, pos_product_key, product_name, received_qty")
    .in("id", activatedLotIds);
  if (lErr) {
    console.error("[po-receive-store] activated lots read failed:", lErr.message);
    return { attempted: false };
  }
  const lots: ReceivableLot[] = ((lotRows as ReceivableLot[] | null) ?? []).map((r) => ({
    id: r.id,
    pos_product_key: r.pos_product_key ?? null,
    product_name: r.product_name ?? null,
    received_qty: Number(r.received_qty ?? 0),
  }));
  if (lots.length === 0) return { attempted: false };

  // 4) Pure plan, then execute each receipt through the existing house path
  //    (receivePoLine recomputes the PO's partial/received status itself).
  const lines: ReceivablePoLine[] = po.lines.map((l) => ({
    id: l.id,
    pos_product_key: l.pos_product_key,
    product_name: l.product_name,
    order_qty: Number(l.order_qty ?? 0),
    received_qty: Number(l.received_qty ?? 0),
    unit: l.unit,
  }));
  const plan = buildAutoReceivePlan(lots, lines);
  for (const receipt of plan.receipts) {
    await receivePoLine(receipt.lineId, receipt.qty);
  }

  return {
    attempted: true,
    receivedLines: plan.receipts.length,
    note: `PO ${po.po_number ?? poId}: ${plan.note}`,
  };
}
