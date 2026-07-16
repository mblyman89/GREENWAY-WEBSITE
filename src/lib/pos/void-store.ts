import "server-only";

/**
 * src/lib/pos/void-store.ts  (POS Slice B27)
 *
 * SERVER-ONLY void-sale processing. The pure policy lives in
 * void-sale-core.ts; this module owns the I/O:
 *
 *   1. Look up TODAY's sale by its printed receipt number (same
 *      clientUuid↔receipt matching the returns desk uses, but scoped to the
 *      current Pacific business day — older sales belong at the returns desk).
 *   2. Re-verify eligibility SERVER-SIDE (status, same-day, no prior returns,
 *      not already voided) — the register's verdict is advisory only.
 *   3. Reverse the sale through the EXISTING, audited machinery:
 *        - lifecycle: completed → ready (S-15 reasoned reversal) → cancelled
 *          (closure). The order is never deleted; its timeline records why.
 *        - inventory: restock BOTH layers the B19 decrement reduced
 *          (menu_variants.inventory_level on the published version, and
 *          inventory_lots.on_hand_qty by product key — newest non-quarantine
 *          lot, matching the returns desk's lot-resolution convention).
 *          Idempotent via a "sale_void_restocked" order_event marker.
 *        - loyalty: claw back the FULL points the sale earned (cumulative-
 *          safe against prior partial clawbacks, same math as returns).
 *        - medical: delete the order's WAC 314-55-090(2) exempt-sale ledger
 *          rows — a voided sale never happened, so the excise/LIQ-1295
 *          reports must not count its exemptions.
 *   4. Audit ("register.sale_voided") and hand back a printable void slip.
 *
 * CCRS: no correction file is needed. Sale.csv exports COMPLETED orders
 * only, and voids are same-day only — a voided (cancelled) order simply
 * never appears in the weekly filing. (Returns of already-filed sales are
 * the returns desk's job; that path emits Delete/Update corrections.)
 *
 * Money in MINOR UNITS (cents) throughout.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { setOrderStatus } from "@/lib/orders/orders-store";
import { getAccountByCustomer, adjustPoints } from "@/lib/loyalty/loyalty-store";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import { statusForLevelTotal } from "@/lib/inventory/sale-decrement-core";
// Mastering Slice 1: restock lands on the variant's own lot (variant-first key).
import { lotKeyForSaleLine } from "@/lib/pos/variant-lot-core";
import { receiptLookupSuffix, clientUuidMatchesReceipt } from "@/lib/pos/returns-core";
import { receiptNumber } from "@/lib/pos/receipt-core";
import { pacificToday, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { getPosReceiptConfig } from "@/lib/pos/receipt-config-store";
import { normalizePosReceiptConfig, receiptAddressLines } from "@/lib/pos/receipt-config-core";
import {
  evaluateVoidEligibility,
  validateVoidRequest,
  voidRefundMinor,
  buildVoidSlipHtml,
} from "@/lib/pos/void-sale-core";

const RESTOCK_MARKER = "sale_void_restocked";
const VOID_MARKER = "sale_voided";

// ---------------------------------------------------------------------------
// Lookup — today's sale by receipt number
// ---------------------------------------------------------------------------

export type VoidableSale = {
  orderId: string;
  orderNumber: string;
  receiptNumber: string;
  saleClientUuid: string;
  completedAtIso: string | null;
  totalMinor: number;
  lines: { lineId: string; productId: string | null; variantId: string | null; productName: string; quantity: number }[];
};

export type VoidLookupResult = { ok: true; sale: VoidableSale } | { ok: false; errors: string[] };

/**
 * Find TODAY's processed sale for a receipt number and evaluate every void
 * gate. Failures come back as the complete list (manager sees the whole
 * picture, same contract as the returns desk).
 */
export async function lookupVoidableSale(rawReceipt: string): Promise<VoidLookupResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, errors: ["Supabase service role not configured."] };
  const suffix = receiptLookupSuffix(rawReceipt);
  if (!suffix) {
    return {
      ok: false,
      errors: ["That doesn't look like a receipt number — it's the 8-character code printed under the store name."],
    };
  }
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: events } = await admin
    .from("pos_sale_events")
    .select("client_uuid, order_id, occurred_at")
    .eq("event_type", "sale")
    .eq("status", "processed")
    .not("order_id", "is", null)
    .gte("occurred_at", pacificWallTimeToUtcISO(pacificToday(), "start"))
    .order("occurred_at", { ascending: false })
    .limit(500);
  const rows = (events as { client_uuid: string; order_id: string }[] | null) ?? [];
  const wanted = suffix.toUpperCase();
  const match = rows.find((r) => clientUuidMatchesReceipt(r.client_uuid, wanted));
  if (!match) {
    return {
      ok: false,
      errors: [
        `No processed sale TODAY matches receipt ${wanted}. Voids are same-day only — for an earlier sale, use the returns desk in the back office.`,
      ],
    };
  }

  const [{ data: orderRow }, { data: lineRows }, { data: priorReturns }, { data: voidMarker }] = await Promise.all([
    admin
      .from("orders")
      .select("id, order_number, status, completed_at, total_minor_units")
      .eq("id", match.order_id)
      .maybeSingle(),
    admin
      .from("order_lines")
      .select("id, product_id, variant_id, product_name, quantity")
      .eq("order_id", match.order_id)
      .order("created_at", { ascending: true }),
    admin.from("customer_returns").select("quantity").eq("order_id", match.order_id),
    admin
      .from("order_events")
      .select("id")
      .eq("order_id", match.order_id)
      .eq("event_type", VOID_MARKER)
      .limit(1),
  ]);
  const order = orderRow as {
    id: string;
    order_number: string;
    status: string;
    completed_at: string | null;
    total_minor_units: number;
  } | null;
  if (!order) return { ok: false, errors: ["The order behind this receipt no longer exists."] };

  let priorReturnQuantity = 0;
  for (const r of (priorReturns as { quantity: number }[] | null) ?? []) {
    priorReturnQuantity += Number(r.quantity) || 0;
  }

  const verdict = evaluateVoidEligibility({
    orderStatus: order.status,
    completedAtIso: order.completed_at,
    nowIso,
    priorReturnQuantity,
    alreadyVoided: ((voidMarker as { id: string }[] | null) ?? []).length > 0,
  });
  if (!verdict.ok) return { ok: false, errors: verdict.errors };

  const lines = (
    (lineRows as
      | { id: string; product_id: string | null; variant_id: string | null; product_name: string; quantity: number }[]
      | null) ?? []
  ).map((l) => ({
    lineId: l.id,
    productId: l.product_id,
    variantId: l.variant_id,
    productName: l.product_name,
    quantity: Number(l.quantity) || 0,
  }));
  if (lines.length === 0) return { ok: false, errors: ["This sale has no line items on record."] };

  return {
    ok: true,
    sale: {
      orderId: order.id,
      orderNumber: order.order_number,
      receiptNumber: wanted,
      saleClientUuid: match.client_uuid,
      completedAtIso: order.completed_at,
      totalMinor: order.total_minor_units,
      lines,
    },
  };
}

// ---------------------------------------------------------------------------
// Inventory restock (reverse of the B19 decrement, both layers)
// ---------------------------------------------------------------------------

async function restockInventoryForVoid(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orderId: string,
  lines: VoidableSale["lines"],
): Promise<string> {
  // Idempotency latch (mirrors decrementInventoryForOrder's marker).
  const { data: marker } = await admin
    .from("order_events")
    .select("id")
    .eq("order_id", orderId)
    .eq("event_type", RESTOCK_MARKER)
    .limit(1);
  if (marker && marker.length > 0) return "already restocked";

  const notes: string[] = [];
  const productKeys = [...new Set(lines.map((l) => l.productId).filter((k): k is string => !!k))];

  // ── Layer 1: published menu variants ──────────────────────────────────────
  const version = await getPublishedVersion();
  if (version && productKeys.length > 0) {
    const { data: itemRows } = await admin
      .from("menu_items")
      .select("id, source_item_id")
      .eq("menu_version_id", version.id)
      .in("source_item_id", productKeys);
    const items = (itemRows as { id: string; source_item_id: string }[] | null) ?? [];
    for (const line of lines) {
      if (!line.productId) continue;
      const item = items.find((i) => i.source_item_id === line.productId);
      if (!item) continue;
      const { data: variantRows } = await admin
        .from("menu_variants")
        .select("id, source_variant_id, inventory_level")
        .eq("menu_item_id", item.id);
      const variants = (variantRows as { id: string; source_variant_id: string; inventory_level: number }[] | null) ?? [];
      if (variants.length === 0) continue;
      // Exact variant (B20 stamp) when known; else the first variant — the
      // same preference order the decrement plan used.
      const target = variants.find((v) => v.source_variant_id === line.variantId) ?? variants[0];
      const newLevel = (Number(target.inventory_level) || 0) + line.quantity;
      await admin.from("menu_variants").update({ inventory_level: newLevel }).eq("id", target.id);
      const total = variants.reduce(
        (s, v) => s + (v.id === target.id ? newLevel : Number(v.inventory_level) || 0),
        0,
      );
      await admin.from("menu_items").update({ inventory_status: statusForLevelTotal(total) }).eq("id", item.id);
      notes.push(`menu ${line.productName} +${line.quantity}`);
    }
  }

  // ── Layer 2: inventory lots (newest non-quarantine lot per product key —
  //    the returns desk's lot-resolution convention) ─────────────────────────
  for (const line of lines) {
    // Variant-first lot key: a void of one size on a mastered card restocks
    // THAT size's lot (single-lot cards resolve identically to product_id).
    const restockKey = lotKeyForSaleLine(line);
    if (!restockKey) continue;
    const { data: lotRows } = await admin
      .from("inventory_lots")
      .select("id, on_hand_qty, status")
      .eq("pos_product_key", restockKey)
      .neq("status", "quarantine")
      .order("created_at", { ascending: false })
      .limit(1);
    const lot = ((lotRows as { id: string; on_hand_qty: number; status: string }[] | null) ?? [])[0];
    if (!lot) {
      notes.push(`lot MISSING for ${line.productName} — restock it manually`);
      continue;
    }
    const newOnHand = (Number(lot.on_hand_qty) || 0) + line.quantity;
    await admin
      .from("inventory_lots")
      .update(lot.status === "sold_out" ? { on_hand_qty: newOnHand, status: "active" } : { on_hand_qty: newOnHand })
      .eq("id", lot.id);
    notes.push(`lot ${line.productName} +${line.quantity}`);
  }

  const summary = `Void restock: ${notes.join("; ") || "nothing to restock"}`;
  await admin.from("order_events").insert({
    order_id: orderId,
    event_type: RESTOCK_MARKER,
    note: summary.slice(0, 2000),
    actor_label: "system",
  });
  return summary;
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

export type ProcessVoidInput = {
  receiptNumber: string;
  reason: string;
  /** Resolved manager/lead (PIN verified by the route). */
  approver: { id: string; fullName: string };
  /** Register employee performing the void (display only on the slip). */
  processedByName: string;
  deviceId: string;
};

export type ProcessVoidResult =
  | { ok: true; refundMinor: number; pointsClawed: number; slipHtml: string; orderNumber: string }
  | { ok: false; error: string };

/**
 * Void a same-day sale end-to-end. Sequential with visible failure points —
 * if a later step fails the earlier steps' effects are reported, never
 * silently rolled back (matches the returns-store discipline).
 */
export async function processVoidSale(input: ProcessVoidInput): Promise<ProcessVoidResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase service role not configured." };

  const request = validateVoidRequest({ reason: input.reason, approvedByEmployeeId: input.approver.id });
  if (!request.ok) return request;

  // ── Server-authoritative lookup + eligibility ─────────────────────────────
  const lookup = await lookupVoidableSale(input.receiptNumber);
  if (!lookup.ok) return { ok: false, error: lookup.errors.join(" ") };
  const sale = lookup.sale;

  const refund = voidRefundMinor(sale.totalMinor);
  if (!refund.ok) return refund;

  const admin = createSupabaseAdminClient();

  // ── Lifecycle: completed → ready (reasoned reversal) → cancelled ─────────
  const reopened = await setOrderStatus(sale.orderId, "ready", {
    actorLabel: `POS void · ${input.approver.fullName}`,
    reversalReason: `VOID: ${request.reason}`,
    note: `Sale void started at the register (receipt ${sale.receiptNumber}).`,
  });
  if (!reopened.ok) {
    return { ok: false, error: `Could not reopen the sale${reopened.refusal ? `: ${reopened.refusal}` : "."}` };
  }
  const cancelled = await setOrderStatus(sale.orderId, "cancelled", {
    actorLabel: `POS void · ${input.approver.fullName}`,
    note: `Sale VOIDED — ${request.reason}. Cash returned: $${(refund.refundMinor / 100).toFixed(2)}.`,
  });
  if (!cancelled.ok) {
    return {
      ok: false,
      error: `The sale was reopened but could not be cancelled${cancelled.refusal ? `: ${cancelled.refusal}` : "."} Finish the void from the back office (Orders → this order → cancel).`,
    };
  }

  // ── Inventory restock (idempotent, best-effort with visible notes) ───────
  let restockNote: string;
  try {
    restockNote = await restockInventoryForVoid(admin, sale.orderId, sale.lines);
  } catch (err) {
    restockNote = `Restock FAILED: ${err instanceof Error ? err.message : String(err)} — run a cycle count.`;
    await admin
      .from("order_events")
      .insert({ order_id: sale.orderId, event_type: "note", note: restockNote.slice(0, 2000), actor_label: "system" })
      .then(() => {}, () => {});
  }

  // ── Loyalty: claw back the FULL earn (cumulative-safe) ───────────────────
  let pointsClawed = 0;
  const { data: orderRow } = await admin
    .from("orders")
    .select("customer_id")
    .eq("id", sale.orderId)
    .maybeSingle();
  const customerId = (orderRow as { customer_id: string | null } | null)?.customer_id ?? null;
  if (customerId) {
    const account = await getAccountByCustomer(customerId);
    if (account) {
      const { data: ledger } = await admin
        .from("loyalty_ledger")
        .select("kind, points")
        .eq("order_id", sale.orderId);
      let earned = 0;
      let alreadyClawed = 0;
      for (const r of (ledger as { kind: string; points: number }[] | null) ?? []) {
        if (r.kind === "earn" && r.points > 0) earned += r.points;
        if (r.kind === "adjust" && r.points < 0) alreadyClawed += -r.points;
      }
      const clawNow = Math.max(0, earned - alreadyClawed);
      if (clawNow > 0) {
        const res = await adjustPoints({
          accountId: account.id,
          points: -clawNow,
          note: `Sale void — receipt ${sale.receiptNumber}`,
          orderId: sale.orderId,
          actorId: null,
        });
        if (res.ok) pointsClawed = clawNow;
      }
    }
  }

  // ── Medical exempt-sale ledger: a voided sale never happened ─────────────
  await admin
    .from("medical_exempt_sales")
    .delete()
    .eq("order_id", sale.orderId)
    .then(() => {}, () => {});

  // ── Void marker (the double-void latch) + audit ───────────────────────────
  await admin.from("order_events").insert({
    order_id: sale.orderId,
    event_type: VOID_MARKER,
    note:
      `Sale VOIDED at the register. Reason: ${request.reason}. Approved by ${input.approver.fullName}; ` +
      `processed by ${input.processedByName}. Cash returned $${(refund.refundMinor / 100).toFixed(2)}; ` +
      `${pointsClawed} points clawed back. ${restockNote}`.slice(0, 2000),
    actor_label: `POS void · ${input.approver.fullName}`,
  });
  await recordAudit({
    actorId: null,
    actorEmail: `pos-device:${input.deviceId}`,
    action: "register.sale_voided",
    entityType: "order",
    entityId: sale.orderId,
    after: {
      receiptNumber: sale.receiptNumber,
      orderNumber: sale.orderNumber,
      reason: request.reason,
      approvedByEmployeeId: input.approver.id,
      refundMinor: refund.refundMinor,
      pointsClawed,
      restock: restockNote,
    },
  });

  // ── Printable void slip (owner's receipt header/address apply) ───────────
  const config = normalizePosReceiptConfig(await getPosReceiptConfig());
  const slipHtml = buildVoidSlipHtml({
    receiptNumber: receiptNumber(sale.saleClientUuid),
    orderNumber: sale.orderNumber,
    voidedAtIso: new Date().toISOString(),
    reason: request.reason,
    approvedByName: input.approver.fullName,
    processedByName: input.processedByName,
    refundMinor: refund.refundMinor,
    lines: sale.lines.map((l) => ({ productName: l.productName, quantity: l.quantity })),
    headerText: config.headerText,
    addressLines: receiptAddressLines(config),
  });

  return { ok: true, refundMinor: refund.refundMinor, pointsClawed, slipHtml, orderNumber: sale.orderNumber };
}
