/**
 * src/lib/pos/returns-store.ts  (POS Slice B16)
 *
 * Server flow for COUNTER RETURNS — the manager-facing, receipt-first path
 * that enforces the owner's store policy (B15 pure core) and then hands the
 * compliant machinery to Task Q's `createCustomerReturn` (CCRS Sale
 * Delete/Update snapshot, positive inventory add-back, restock/destroy,
 * destruction event). Nothing here duplicates compliance logic — policy
 * verdicts come from returns-core, WAC 079(12) attestations and the CCRS
 * correction queue stay in the disposition module.
 *
 * Receipt lookup — why a window scan instead of a uuid-suffix filter
 * ------------------------------------------------------------------
 * The printed receipt number is the last 8 hex chars of the sale's
 * client_uuid (receiptNumber(), B10). PostgREST cannot LIKE-filter a uuid
 * column without a cast, and we do not add DB functions for this. But the
 * 15-day policy window means only recent sales are ever returnable — so we
 * scan `pos_sale_events` for processed sales in the last
 * RETURN_WINDOW_DAYS + 2 days (clock-skew buffer) and match the suffix in
 * memory. The policy bounds the scan; an older receipt correctly reads as
 * "outside the 15-day window".
 *
 * Loyalty clawback
 * ----------------
 * Points earned on the order are clawed back proportionally to the refund
 * (pointsClawback — floored, clamped). Repeated partial returns can never
 * over-claw: each pass subtracts what earlier passes already clawed
 * (negative 'adjust' ledger rows tied to the order).
 *
 * Money in MINOR UNITS (cents) everywhere.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  clientUuidMatchesReceipt,
  evaluateReturnEligibility,
  pointsClawback,
  receiptLookupSuffix,
  refundForLine,
  RETURN_WINDOW_DAYS,
} from "@/lib/pos/returns-core";
import { createCustomerReturn } from "@/lib/inventory/disposition";
import type { CustomerReturnDisposition } from "@/lib/inventory/disposition-core";
import { adjustPoints, getAccountByCustomer } from "@/lib/loyalty/loyalty-store";
import { getPosReceiptConfig } from "@/lib/pos/receipt-config-store";
import { normalizePosReceiptConfig, receiptAddressLines } from "@/lib/pos/receipt-config-core";
import { buildRefundReceiptHtml, receiptNumber } from "@/lib/pos/receipt-core";

// How far back the receipt scan reaches: the policy window + 2 days of
// clock-skew/timezone buffer. Sales past this are not returnable anyway.
const LOOKUP_WINDOW_DAYS = RETURN_WINDOW_DAYS + 2;
const LOOKUP_SCAN_LIMIT = 5000;

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export type CounterReturnLine = {
  lineId: string;
  productId: string | null;
  productName: string;
  quantity: number;
  /** FINAL tax-inclusive unit price paid, minor units. */
  priceMinorUnits: number;
  alreadyReturned: number;
  remainingReturnable: number;
};

export type CounterReturnSale = {
  orderId: string;
  orderNumber: string;
  receiptNumber: string;
  saleClientUuid: string;
  purchasedAtIso: string;
  memberLabel: string;
  daysSincePurchase: number;
  daysRemaining: number;
  orderTotalMinor: number;
  lines: CounterReturnLine[];
};

export type CounterReturnLookup =
  | { ok: true; sale: CounterReturnSale }
  | { ok: false; errors: string[] };

function privacyLabel(first: string, last: string | null): string {
  const f = first.trim();
  const l = (last ?? "").trim();
  return l ? `${f} ${l[0].toUpperCase()}.` : f;
}

/**
 * Look a sale up by its printed receipt number and evaluate every store-policy
 * gate. Failures come back as the COMPLETE list so staff see the whole
 * picture (matches evaluateReturnEligibility's contract).
 */
export async function lookupSaleByReceipt(rawReceipt: string): Promise<CounterReturnLookup> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, errors: ["Supabase service role not configured."] };
  }
  const suffix = receiptLookupSuffix(rawReceipt);
  if (!suffix) {
    return {
      ok: false,
      errors: ["That doesn't look like a receipt number — it's the 8-character code printed under the store name (letters A–F and digits)."],
    };
  }
  const admin = createSupabaseAdminClient();

  const cutoff = new Date(Date.now() - LOOKUP_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: events } = await admin
    .from("pos_sale_events")
    .select("client_uuid, order_id, occurred_at")
    .eq("event_type", "sale")
    .eq("status", "processed")
    .not("order_id", "is", null)
    .gte("occurred_at", cutoff)
    .order("occurred_at", { ascending: false })
    .limit(LOOKUP_SCAN_LIMIT);
  const rows = (events as { client_uuid: string; order_id: string; occurred_at: string }[] | null) ?? [];
  const wanted = suffix.toUpperCase();
  const match = rows.find((r) => clientUuidMatchesReceipt(r.client_uuid, wanted));
  if (!match) {
    return {
      ok: false,
      errors: [
        `No processed register sale in the last ${RETURN_WINDOW_DAYS} days matches receipt ${wanted}. ` +
          "Check the number on the paper — and remember the store policy: returns are only accepted within " +
          `${RETURN_WINDOW_DAYS} days of purchase.`,
      ],
    };
  }

  const { data: orderRow } = await admin
    .from("orders")
    .select("id, order_number, status, customer_id, placed_at, completed_at, total_minor_units")
    .eq("id", match.order_id)
    .maybeSingle();
  const order = orderRow as {
    id: string;
    order_number: string;
    status: string;
    customer_id: string | null;
    placed_at: string;
    completed_at: string | null;
    total_minor_units: number;
  } | null;
  if (!order) return { ok: false, errors: ["The order behind this receipt no longer exists."] };

  const purchasedAtIso = order.completed_at ?? order.placed_at;
  const verdict = evaluateReturnEligibility({
    orderStatus: order.status,
    orderCustomerId: order.customer_id,
    purchasedAtIso,
    nowIso: new Date().toISOString(),
  });
  if (!verdict.ok) return { ok: false, errors: verdict.errors };

  // Member label (privacy-lean, same shape the register shows).
  let memberLabel = "Loyalty member";
  const { data: cust } = await admin
    .from("customers")
    .select("first_name, last_name")
    .eq("id", order.customer_id as string)
    .maybeSingle();
  const c = cust as { first_name: string; last_name: string | null } | null;
  if (c) memberLabel = privacyLabel(c.first_name, c.last_name);

  // Lines + prior returns (double-return guard, same source as Task Q).
  const [{ data: lines }, { data: prior }] = await Promise.all([
    admin
      .from("order_lines")
      .select("id, product_id, product_name, quantity, price_minor_units")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true }),
    admin.from("customer_returns").select("order_line_id, quantity").eq("order_id", order.id),
  ]);
  const returnedByLine = new Map<string, number>();
  for (const r of (prior as { order_line_id: string | null; quantity: number }[] | null) ?? []) {
    if (!r.order_line_id) continue;
    returnedByLine.set(r.order_line_id, (returnedByLine.get(r.order_line_id) ?? 0) + Number(r.quantity || 0));
  }
  const saleLines: CounterReturnLine[] = (
    (lines as { id: string; product_id: string | null; product_name: string; quantity: number; price_minor_units: number }[] | null) ?? []
  ).map((l) => {
    const already = returnedByLine.get(l.id) ?? 0;
    return {
      lineId: l.id,
      productId: l.product_id,
      productName: l.product_name,
      quantity: Number(l.quantity) || 0,
      priceMinorUnits: l.price_minor_units,
      alreadyReturned: already,
      remainingReturnable: Math.max(0, (Number(l.quantity) || 0) - already),
    };
  });
  if (saleLines.length === 0) return { ok: false, errors: ["This sale has no line items on record."] };

  return {
    ok: true,
    sale: {
      orderId: order.id,
      orderNumber: order.order_number,
      receiptNumber: wanted,
      saleClientUuid: match.client_uuid,
      purchasedAtIso,
      memberLabel,
      daysSincePurchase: verdict.daysSincePurchase,
      daysRemaining: verdict.daysRemaining,
      orderTotalMinor: order.total_minor_units,
      lines: saleLines,
    },
  };
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

export type ProcessCounterReturnInput = {
  receiptNumber: string;
  orderLineId: string;
  quantity: number;
  reason: string;
  detail?: string | null;
  disposition: CustomerReturnDisposition;
  originalPackaging: boolean;
  lotIdLegible: boolean;
};

export type ProcessCounterReturnResult =
  | {
      ok: true;
      returnId: string;
      refundMinor: number;
      pointsClawed: number;
      correctionOperation: "Delete" | "Update";
      /** Ready-to-print refund receipt (same 576px pure builder family). */
      receiptHtml: string;
    }
  | { ok: false; error: string };

/**
 * Process a counter return end-to-end: re-verify policy server-side (the UI
 * verdict is advisory only), compute the exact refund from the stored paid
 * price, run Task Q's compliant pipeline, claw back proportional loyalty
 * points (never over-clawing across repeated partials), and hand back a
 * printable refund receipt.
 */
export async function processCounterReturn(
  input: ProcessCounterReturnInput,
  actorId: string | null,
  processedByName?: string | null,
): Promise<ProcessCounterReturnResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase service role not configured." };

  // ── Server-authoritative policy re-check ─────────────────────────────────
  const lookup = await lookupSaleByReceipt(input.receiptNumber);
  if (!lookup.ok) return { ok: false, error: lookup.errors.join(" ") };
  const sale = lookup.sale;

  const line = sale.lines.find((l) => l.lineId === input.orderLineId);
  if (!line) return { ok: false, error: "That line item isn't on this receipt." };

  // ── Exact refund from the stored paid price (no manual entry) ───────────
  const refund = refundForLine({
    unitPriceMinor: line.priceMinorUnits,
    quantity: input.quantity,
    remainingReturnable: line.remainingReturnable,
  });
  if (!refund.ok) return refund;

  // ── Task Q pipeline: attestations, add-back, correction queue, destroy ──
  const created = await createCustomerReturn(
    {
      orderId: sale.orderId,
      orderLineId: line.lineId,
      quantity: input.quantity,
      disposition: input.disposition,
      reason: input.reason,
      detail: input.detail ?? null,
      refundMinor: refund.refundMinor,
      originalPackaging: input.originalPackaging,
      lotIdLegible: input.lotIdLegible,
    },
    actorId,
  );
  if (!created.ok) return created;

  const correctionOperation: "Delete" | "Update" =
    line.alreadyReturned + input.quantity >= line.quantity ? "Delete" : "Update";

  // ── Loyalty clawback (proportional; cumulative-safe) ─────────────────────
  const admin = createSupabaseAdminClient();
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
      const proportional = pointsClawback({
        earnedPoints: earned,
        refundMinor: refund.refundMinor,
        orderTotalMinor: sale.orderTotalMinor,
      });
      const clawNow = Math.min(proportional, Math.max(0, earned - alreadyClawed));
      if (clawNow > 0) {
        const res = await adjustPoints({
          accountId: account.id,
          points: -clawNow,
          note: `Return clawback — receipt ${sale.receiptNumber}, return ${created.id}`,
          orderId: sale.orderId,
          actorId,
        });
        if (res.ok) pointsClawed = clawNow;
      }
    }
  }

  // ── Printable refund receipt (owner's B13 design applies) ───────────────
  const config = normalizePosReceiptConfig(await getPosReceiptConfig());
  const receiptHtml = buildRefundReceiptHtml({
    originalSaleClientUuid: sale.saleClientUuid,
    refundedAtIso: new Date().toISOString(),
    headerText: config.headerText,
    footerText: config.footerText,
    addressLines: receiptAddressLines(config),
    memberLabel: sale.memberLabel,
    lines: [{ productName: line.productName, quantity: input.quantity, refundMinor: refund.refundMinor }],
    refundTotalMinor: refund.refundMinor,
    disposition: input.disposition,
    reason: input.reason,
    processedBy: processedByName ?? null,
    pointsClawed,
  });

  return {
    ok: true,
    returnId: created.id,
    refundMinor: refund.refundMinor,
    pointsClawed,
    correctionOperation,
    receiptHtml,
  };
}

/** Re-exported for the UI (result panel shows the original receipt number). */
export { receiptNumber };
