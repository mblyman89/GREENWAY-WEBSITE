"use server";

/**
 * /admin/registers/returns — server actions (POS Slice B16).
 *
 * Receipt-first counter returns. Two calls:
 *  1. lookupReceiptAction — find the sale by its printed receipt number and
 *     evaluate every store-policy gate (loyalty member, 15-day window,
 *     completed-only). All failures come back at once.
 *  2. processReturnAction — server-authoritative processing: policy re-check,
 *     exact refund from the stored paid price, Task Q compliant pipeline
 *     (WAC 079(12) attestations, CCRS Sale correction queue, positive
 *     add-back, restock/destroy), proportional loyalty clawback, audited,
 *     and a printable refund receipt back to the browser.
 *
 * Permission: inventory.manage (owner/admin/manager) — the same level Task Q
 * requires, because processing a return moves inventory and queues a CCRS
 * correction.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { CUSTOMER_RETURN_REASONS } from "@/lib/inventory/disposition-core";
import {
  lookupSaleByReceipt,
  processCounterReturn,
  type CounterReturnLookup,
  type ProcessCounterReturnResult,
} from "@/lib/pos/returns-store";

const BASE = "/admin/registers/returns";
const REASONS = new Set<string>(CUSTOMER_RETURN_REASONS);

export async function lookupReceiptAction(receipt: string): Promise<CounterReturnLookup> {
  await requirePermission("inventory.manage");
  return lookupSaleByReceipt((receipt ?? "").trim());
}

export type ProcessReturnInput = {
  receiptNumber: string;
  orderLineId: string;
  quantity: number;
  reason: string;
  detail: string;
  disposition: "restock" | "destroy";
  originalPackaging: boolean;
  lotIdLegible: boolean;
};

export async function processReturnAction(input: ProcessReturnInput): Promise<ProcessCounterReturnResult> {
  const session = await requirePermission("inventory.manage");

  if (!REASONS.has(input.reason)) return { ok: false, error: "Pick a valid return reason." };
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    return { ok: false, error: "Quantity must be a positive whole number." };
  }
  const disposition = input.disposition === "restock" ? "restock" : "destroy";

  const result = await processCounterReturn(
    {
      receiptNumber: input.receiptNumber,
      orderLineId: input.orderLineId,
      quantity: input.quantity,
      reason: input.reason,
      detail: input.detail.trim() || null,
      disposition,
      originalPackaging: input.originalPackaging === true,
      lotIdLegible: input.lotIdLegible === true,
    },
    session.userId,
    session.profile.full_name ?? null,
  );
  if (!result.ok) return result;

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "customer_return.counter",
    entityType: "customer_returns",
    entityId: result.returnId,
    after: {
      receipt_number: input.receiptNumber,
      order_line_id: input.orderLineId,
      quantity: input.quantity,
      reason: input.reason,
      disposition,
      refund_minor: result.refundMinor,
      points_clawed: result.pointsClawed,
      correction_operation: result.correctionOperation,
    },
  });
  revalidatePath(BASE);
  revalidatePath("/admin/inventory/disposition");
  return result;
}
