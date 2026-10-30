/**
 * src/lib/noncannabis/returns.ts
 *
 * Fix Phase 4 (G-29 item 3): a counter return of an Other Inventory line.
 * Server-only. Not cannabis, so none of the cannabis return rules apply: no
 * lot, no CCRS add-back, no CCRS Sale correction (the line was never in
 * Sale.csv), no destruction event. Restock puts the units back on the
 * catalog's On hand; Destroy (write-off) does not.
 *
 * The customer_returns row is still written (refund money, the drawer that
 * paid it, the daily refund journal and the cashier report all read that
 * table), with sale_type "NonCannabis", excise 0, lot_id null and
 * correction_status "exported" so no CCRS correction file ever picks it up.
 * Migration 0323 record_noncannabis_return writes the row and the restock in
 * one transaction; before 0323 the return is refused with a plain message
 * (no half-written return).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isMissingDbFunctionError } from "@/lib/db/rpc-fallback-core";
import { ncIdFromKey } from "@/lib/noncannabis/pos-catalog-core";
import { pacificDayKey } from "@/lib/reports/timezone";

export async function createNonCannabisReturn(
  input: {
    orderId: string;
    orderLineId: string;
    quantity: number;
    disposition: "restock" | "destroy";
    reason: string;
    detail?: string | null;
    refundMinor: number;
  },
  actorId: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const [{ data: order }, { data: line }] = await Promise.all([
    admin.from("orders").select("id, order_number, status, placed_at, completed_at").eq("id", input.orderId).maybeSingle(),
    admin
      .from("order_lines")
      .select("id, order_id, product_id, product_name, quantity, price_minor_units, regular_price_minor_units")
      .eq("id", input.orderLineId)
      .maybeSingle(),
  ]);
  if (!order) return { ok: false, error: "Order not found." };
  const o = order as { id: string; order_number: string; status: string; placed_at: string; completed_at: string | null };
  if (o.status !== "completed") return { ok: false, error: "Only COMPLETED sales can be returned." };
  const l = line as { id: string; order_id: string; product_id: string | null; product_name: string; quantity: number; price_minor_units: number; regular_price_minor_units: number | null } | null;
  if (!l || l.order_id !== o.id) return { ok: false, error: "Order line not found on this order." };
  const ncId = ncIdFromKey(l.product_id);
  if (!ncId) return { ok: false, error: "That line is not an Other Inventory item." };

  const qty = Math.floor(Number(input.quantity) || 0);
  if (qty <= 0) return { ok: false, error: "Return quantity must be greater than zero." };
  const { data: prior } = await admin.from("customer_returns").select("quantity, refund_minor_units").eq("order_line_id", l.id);
  let returned = 0;
  let refunded = 0;
  for (const r of (prior as { quantity: number; refund_minor_units: number | null }[] | null) ?? []) {
    returned += Number(r.quantity) || 0;
    refunded += Number(r.refund_minor_units) || 0;
  }
  const remaining = (Number(l.quantity) || 0) - returned;
  if (qty > remaining) return { ok: false, error: `Only ${remaining} of this line can still be returned.` };
  const maxRefund = Math.max(0, (Number(l.price_minor_units) || 0) * qty - Math.max(0, refunded - 0));
  if (!Number.isInteger(input.refundMinor) || input.refundMinor < 0 || input.refundMinor > Math.max(maxRefund, 0)) {
    return { ok: false, error: "The refund is more than the customer paid for these units." };
  }

  const saleExternalId = o.order_number || o.id;
  const paid = Number(l.price_minor_units) || 0;
  // 9.3% is inside the tax-inclusive paid price: pre-tax = paid / 1.093.
  const preTaxUnit = Math.round((paid * 10_000) / 10_930);
  const returnRow = {
    order_id: o.id,
    order_line_id: l.id,
    sale_external_id: saleExternalId,
    sale_detail_external_id: `${saleExternalId}-${l.id.slice(0, 8)}`,
    product_name: l.product_name,
    sale_date: pacificDayKey(o.completed_at ?? o.placed_at),
    unit_price_minor: preTaxUnit,
    sales_tax_minor: (paid - preTaxUnit) * (Number(l.quantity) || 0),
    original_quantity: Number(l.quantity) || 0,
    original_packaging: true,
    lot_id_legible: true,
    reason: input.reason,
    detail: input.detail ?? null,
    refund_minor_units: input.refundMinor,
    correction_operation: returned + qty >= (Number(l.quantity) || 0) ? "Delete" : "Update",
  };
  const { data, error } = await admin.rpc("record_noncannabis_return", {
    p_product_id: ncId,
    p_qty: qty,
    p_restock: input.disposition === "restock",
    p_note: `Customer return - sale ${saleExternalId}${input.detail ? ` (${input.detail})` : ""}`,
    p_actor: actorId,
    p_return: returnRow,
  });
  if (error) {
    if (isMissingDbFunctionError(error)) {
      return { ok: false, error: "Database update 0323 is not applied yet, so Other Inventory returns can't be saved. Ask the owner to run it (Nothing was changed)." };
    }
    return { ok: false, error: `The return was not saved and nothing was changed: ${error.message}` };
  }
  const id = ((data ?? {}) as { return_id?: string }).return_id;
  if (!id) return { ok: false, error: "The return could not be saved (no id came back). Nothing was changed." };
  return { ok: true, id };
}
