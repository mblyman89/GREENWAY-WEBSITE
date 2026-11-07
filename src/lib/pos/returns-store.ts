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
 * policy window means only recent sales are ever returnable — so we scan
 * `pos_sale_events` for processed sales in the last window + 2 days
 * (clock-skew buffer) and match the suffix in memory. The policy bounds the
 * scan; an older receipt correctly reads as outside the window.
 *
 * Fix Phase 6F (owner message 9, G-67/G-68): the window, the loyalty-only
 * toggle and the returnable product types are the owner's SETTING
 * (Register Activity → Return policy, return-policy-store). The scan pages
 * in 1,000-row pages (pagedAll), because PostgREST silently stops at 1,000
 * rows and a longer window could otherwise miss a valid receipt.
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
} from "@/lib/pos/returns-core";
import { getPosReturnPolicy } from "@/lib/pos/return-policy-store";
import { lineNotReturnableReason, lookupWindowDays, returnPolicySummary, WALK_IN_SALE_LABEL, type PosReturnPolicyConfig } from "@/lib/pos/return-policy-core";
import {
  lineScanCodes,
  memberOwnsSale,
  memberSalesCutoffIso,
  memberSalesInWindow,
  noReceiptBlockedReason,
  NOT_MEMBERS_SALE_ERROR,
  scanMatchesLine,
  type MemberSaleRow,
} from "@/lib/pos/no-receipt-return-core";
import { getCategoryLabeler } from "@/lib/pos/category-registry";
import { pagedAll } from "@/lib/supabase/chunked-in";
import { createCustomerReturn } from "@/lib/inventory/disposition";
import { isNonCannabisProductId } from "@/lib/noncannabis/pos-catalog-core";
import { createNonCannabisReturn } from "@/lib/noncannabis/returns";
import { DESTROY_RETURN_HELD_NOTE } from "@/lib/inventory/held-stock-core";
import type { CustomerReturnDisposition } from "@/lib/inventory/disposition-core";
import { adjustPoints, getAccountByCustomer } from "@/lib/loyalty/loyalty-store";
import { getPosReceiptConfig } from "@/lib/pos/receipt-config-store";
import { normalizePosReceiptConfig, receiptAddressLines } from "@/lib/pos/receipt-config-core";
import { buildRefundReceiptHtml, receiptNumber } from "@/lib/pos/receipt-core";

// How far back the receipt scan reaches: the owner's policy window + 2 days
// of clock-skew/timezone buffer (lookupWindowDays). Sales past this are not
// returnable anyway.

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
  /** D205: order_lines.variant_id + CCRS id (server-side scan match only). */
  variantId?: string | null;
  ccrsExternalId?: string | null;
  /** order_lines.category snapshot (null on old sales). */
  category: string | null;
  /**
   * Fix Phase 6F (G-68): why this line's product type may not be returned
   * under the owner's policy, or null when it may. Shown on the screen; the
   * server refuses the return regardless of what the screen sends.
   */
  notReturnableReason: string | null;
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
  /** Fix Phase 6F: the policy this lookup was judged by (shown on screen). */
  policy: PosReturnPolicyConfig;
  /** Plain-English summary of that policy (category labels resolved). */
  policySummary: string;
  /** D205: true when found by member lookup (no receipt in hand). */
  noReceipt?: boolean;
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
export async function lookupSaleByReceipt(rawReceipt: string, asOfIso?: string, exactSaleClientUuid?: string): Promise<CounterReturnLookup> {
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
  const policy = await getPosReturnPolicy();

  // D170 O3: an offline return is judged as of when it happened.
  const asOfMs = asOfIso ? Date.parse(asOfIso) : Date.now();
  const cutoff = new Date(asOfMs - lookupWindowDays(policy) * 86_400_000).toISOString();
  type EventRow = { client_uuid: string; order_id: string; occurred_at: string };
  const rows = await pagedAll<EventRow>(async (from, to) => {
    const { data } = await admin
      .from("pos_sale_events")
      .select("client_uuid, order_id, occurred_at")
      .eq("event_type", "sale")
      .eq("status", "processed")
      .not("order_id", "is", null)
      .gte("occurred_at", cutoff)
      .order("occurred_at", { ascending: false })
      .order("client_uuid", { ascending: true })
      .range(from, to);
    return (data as EventRow[] | null) ?? [];
  });
  const wanted = suffix.toUpperCase();
  // D170 O12: an offline return knows the exact sale, so it never matches a
  // receipt twin from another iPad.
  const match = exactSaleClientUuid
    ? rows.find((r) => r.client_uuid === exactSaleClientUuid)
    : rows.find((r) => clientUuidMatchesReceipt(r.client_uuid, wanted));
  if (!match) {
    return {
      ok: false,
      errors: [
        `No processed register sale in the last ${policy.windowDays} days matches receipt ${wanted}. ` +
          "Check the number on the paper — and remember the store policy: returns are only accepted within " +
          `${policy.windowDays} days of purchase.`,
      ],
    };
  }

  return finishLookup(admin, policy, match, wanted, asOfIso, null);
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Shared tail of every lookup: read the order, run the SAME policy verdict,
 * build the lines. D205: `memberCustomerId` set = a no-receipt lookup, so the
 * sale must be on that member's loyalty account.
 */
async function finishLookup(
  admin: AdminClient,
  policy: PosReturnPolicyConfig,
  match: { client_uuid: string; order_id: string },
  wanted: string,
  asOfIso: string | undefined,
  memberCustomerId: string | null,
): Promise<CounterReturnLookup> {
  const { data: orderRow, error: orderErr } = await admin
    .from("orders")
    .select("id, order_number, status, customer_id, placed_at, completed_at, total_minor_units")
    .eq("id", match.order_id)
    .maybeSingle();
  if (orderErr) return { ok: false, errors: [`Could not read the sale: ${orderErr.message}`] };
  const order = orderRow as {
    id: string;
    order_number: string;
    status: string;
    customer_id: string | null;
    placed_at: string;
    completed_at: string | null;
    total_minor_units: number;
  } | null;
  if (!order) return { ok: false, errors: ["The receipt was found, but the sale it belongs to is no longer in the system. Ask a manager to look into it."] };

  const purchasedAtIso = order.completed_at ?? order.placed_at;
  const verdict = evaluateReturnEligibility({
    orderStatus: order.status,
    orderCustomerId: order.customer_id,
    purchasedAtIso,
    nowIso: asOfIso ?? new Date().toISOString(),
    policy,
  });
  if (!verdict.ok) return { ok: false, errors: verdict.errors };
  if (memberCustomerId !== null && !memberOwnsSale(order.customer_id, memberCustomerId)) {
    return { ok: false, errors: [NOT_MEMBERS_SALE_ERROR] };
  }

  // Member label (privacy-lean, same shape the register shows). Since Fix
  // Phase 6F anyone may return (when the loyalty toggle is off), so a sale
  // with no member reads as a walk-in sale (D205: plain wording, it is a
  // description, not a refusal).
  let memberLabel = order.customer_id ? "Loyalty member" : WALK_IN_SALE_LABEL;
  if (order.customer_id) {
    const { data: cust } = await admin
      .from("customers")
      .select("first_name, last_name")
      .eq("id", order.customer_id)
      .maybeSingle();
    const c = cust as { first_name: string; last_name: string | null } | null;
    if (c) memberLabel = privacyLabel(c.first_name, c.last_name);
  }

  // Lines + prior returns (double-return guard, same source as Task Q).
  const [{ data: lines, error: linesErr }, { data: prior, error: priorErr }] = await Promise.all([
    admin
      .from("order_lines")
      .select("id, product_id, variant_id, ccrs_inventory_external_id, product_name, quantity, price_minor_units, category")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true }),
    admin.from("customer_returns").select("order_line_id, quantity").eq("order_id", order.id),
  ]);
  if (linesErr || priorErr) {
    return { ok: false, errors: [`Could not read the sale's items: ${(linesErr ?? priorErr)?.message ?? "unknown error"}`] };
  }
  const returnedByLine = new Map<string, number>();
  for (const r of (prior as { order_line_id: string | null; quantity: number }[] | null) ?? []) {
    if (!r.order_line_id) continue;
    returnedByLine.set(r.order_line_id, (returnedByLine.get(r.order_line_id) ?? 0) + Number(r.quantity || 0));
  }
  // Fix Phase 6F (G-68): the owner's DB category labels name a blocked type.
  const labelFor = policy.excludedCategories.length > 0 ? await getCategoryLabeler() : (v: string) => v;
  const saleLines: CounterReturnLine[] = (
    (lines as {
      id: string;
      product_id: string | null;
      variant_id?: string | null;
      ccrs_inventory_external_id?: string | null;
      product_name: string;
      quantity: number;
      price_minor_units: number;
      category?: string | null;
    }[] | null) ?? []
  ).map((l) => {
    const already = returnedByLine.get(l.id) ?? 0;
    const category = l.category ?? null;
    return {
      category,
      notReturnableReason: lineNotReturnableReason(policy, category, category ? labelFor(category) : null),
      lineId: l.id,
      productId: l.product_id,
      variantId: l.variant_id ?? null,
      ccrsExternalId: l.ccrs_inventory_external_id ?? null,
      productName: l.product_name,
      quantity: Number(l.quantity) || 0,
      priceMinorUnits: l.price_minor_units,
      alreadyReturned: already,
      remainingReturnable: Math.max(0, (Number(l.quantity) || 0) - already),
    };
  });
  if (saleLines.length === 0) return { ok: false, errors: ["This sale has no items saved on it, so there is nothing to return."] };

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
      policy,
      policySummary: returnPolicySummary(policy, labelFor),
      ...(memberCustomerId !== null ? { noReceipt: true } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// D205: no-receipt returns for loyalty members
// ---------------------------------------------------------------------------

export type MemberSalesResult = { ok: true; sales: MemberSaleRow[]; windowDays: number } | { ok: false; error: string };

/**
 * The member's register sales still inside the return window (newest first),
 * for the cashier to pick the one being returned. Only sales rung ON the
 * member's loyalty account are listed. Blocked when the owner's policy has
 * no-receipt returns switched off.
 */
export async function listMemberSalesForReturn(customerId: string, asOfIso?: string): Promise<MemberSalesResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase service role not configured." };
  const id = customerId.trim();
  if (!id) return { ok: false, error: "Pick the loyalty member first." };
  const policy = await getPosReturnPolicy();
  const blocked = noReceiptBlockedReason(policy);
  if (blocked) return { ok: false, error: blocked };
  const admin = createSupabaseAdminClient();
  const nowIso = asOfIso ?? new Date().toISOString();
  const cutoff = memberSalesCutoffIso(policy, nowIso);

  type OrderRow = { id: string; order_number: string; completed_at: string | null; placed_at: string; total_minor_units: number };
  const { data: orderRows, error } = await admin
    .from("orders")
    .select("id, order_number, completed_at, placed_at, total_minor_units")
    .eq("customer_id", id)
    .eq("status", "completed")
    .gte("placed_at", cutoff)
    .order("placed_at", { ascending: false })
    .limit(200);
  if (error) return { ok: false, error: `Could not read the member's purchases: ${error.message}` };
  const orders = (orderRows as OrderRow[] | null) ?? [];
  if (orders.length === 0) return { ok: true, sales: [], windowDays: policy.windowDays };
  const orderIds = orders.map((o) => o.id);

  const [{ data: events, error: evErr }, { data: lineRows, error: lnErr }] = await Promise.all([
    admin
      .from("pos_sale_events")
      .select("client_uuid, order_id")
      .eq("event_type", "sale")
      .eq("status", "processed")
      .in("order_id", orderIds),
    admin.from("order_lines").select("order_id, product_name, quantity").in("order_id", orderIds),
  ]);
  if (evErr || lnErr) return { ok: false, error: `Could not read the member's purchases: ${(evErr ?? lnErr)?.message ?? "unknown error"}` };
  const uuidByOrder = new Map<string, string>();
  for (const e of (events as { client_uuid: string; order_id: string }[] | null) ?? []) {
    if (!uuidByOrder.has(e.order_id)) uuidByOrder.set(e.order_id, e.client_uuid);
  }
  const itemsByOrder = new Map<string, { names: string[]; count: number }>();
  for (const l of (lineRows as { order_id: string; product_name: string; quantity: number }[] | null) ?? []) {
    const cur = itemsByOrder.get(l.order_id) ?? { names: [], count: 0 };
    cur.names.push(l.product_name);
    cur.count += Number(l.quantity) || 0;
    itemsByOrder.set(l.order_id, cur);
  }
  const rows = orders
    .filter((o) => uuidByOrder.has(o.id))
    .map((o) => ({
      orderId: o.id,
      orderNumber: o.order_number,
      saleClientUuid: uuidByOrder.get(o.id) as string,
      purchasedAtIso: o.completed_at ?? o.placed_at,
      totalMinor: o.total_minor_units,
      items: (itemsByOrder.get(o.id)?.names ?? []).slice(0, 6),
      itemCount: itemsByOrder.get(o.id)?.count ?? 0,
    }));
  return { ok: true, sales: memberSalesInWindow(rows, policy, nowIso), windowDays: policy.windowDays };
}

/**
 * D205: open one of the member's sales for a no-receipt return. Same verdict
 * as a receipt lookup (completed, window, loyalty toggle, product types),
 * plus: the policy allows it and the sale is on THIS member's account.
 */
export async function lookupSaleForMember(customerId: string, orderId: string, asOfIso?: string): Promise<CounterReturnLookup> {
  if (!isSupabaseServiceConfigured) return { ok: false, errors: ["Supabase service role not configured."] };
  const policy = await getPosReturnPolicy();
  const blocked = noReceiptBlockedReason(policy);
  if (blocked) return { ok: false, errors: [blocked] };
  const cid = customerId.trim();
  const oid = orderId.trim();
  if (!cid || !oid) return { ok: false, errors: ["Pick the loyalty member and the sale being returned."] };
  const admin = createSupabaseAdminClient();
  const { data: ev, error } = await admin
    .from("pos_sale_events")
    .select("client_uuid, order_id")
    .eq("event_type", "sale")
    .eq("status", "processed")
    .eq("order_id", oid)
    .order("occurred_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, errors: [`Could not read the sale: ${error.message}`] };
  const match = ev as { client_uuid: string; order_id: string } | null;
  if (!match) return { ok: false, errors: ["That sale was not rung at a register, so it cannot be returned here. Ask a manager."] };
  return finishLookup(admin, policy, match, receiptNumber(match.client_uuid), asOfIso, cid);
}

/**
 * D205: does the scanned package match the line? Codes are the line's own
 * product/lot key and CCRS id, plus every lot behind it (lot barcode, CCRS
 * and vendor inventory ids).
 */
export async function verifyReturnScan(
  line: Pick<CounterReturnLine, "productId" | "variantId" | "ccrsExternalId" | "productName">,
  rawScan: unknown,
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const base = lineScanCodes({ productId: line.productId, variantId: line.variantId ?? null, ccrsExternalId: line.ccrsExternalId ?? null });
  const keys = [...new Set([line.productId, ...(line.variantId?.endsWith("-onboarded") ? [line.variantId.slice(0, -"-onboarded".length)] : [])].filter((k): k is string => !!k && k.trim().length > 0))];
  let lots: { lotCode: string | null; ccrsExternalId: string | null }[] = [];
  if (keys.length > 0) {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("lot_code, ccrs_inventory_external_id, vendor_inventory_external_id")
      .in("pos_product_key", keys)
      .limit(500);
    if (error) return { ok: false, error: `Could not read the product's barcodes: ${error.message}` };
    lots = ((data as { lot_code: string | null; ccrs_inventory_external_id: string | null; vendor_inventory_external_id: string | null }[] | null) ?? []).flatMap((l) => [
      { lotCode: l.lot_code, ccrsExternalId: l.ccrs_inventory_external_id },
      { lotCode: l.vendor_inventory_external_id, ccrsExternalId: null },
    ]);
  }
  const all = lineScanCodes({ productId: null, lots });
  for (const c of base) all.add(c);
  return scanMatchesLine(rawScan, all, line.productName);
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
  /** D170 O3: an offline return is judged as of when it happened. */
  asOfIso?: string;
  /** D170 O12: the exact sale (offline path) \u2014 never a receipt twin. */
  saleClientUuid?: string;
  /** D205: no receipt \u2014 the member, the sale and the product scan. */
  noReceipt?: { customerId: string; orderId: string; scan: string };
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
      /**
       * Fix Phase 1.4 (G-44): where a Destroy unit stands. Null for Restock.
       * Held (0308 applied): "Held for destruction: ... never sellable ...".
       * Pre-0308: the app could not hold it, keep it in the sealed destroy bin.
       */
      stockNote: string | null;
      /** D205: the package code scanned on a no-receipt return (audit). */
      scannedCode?: string | null;
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
  const lookup = input.noReceipt
    ? await lookupSaleForMember(input.noReceipt.customerId, input.noReceipt.orderId, input.asOfIso)
    : await lookupSaleByReceipt(input.receiptNumber, input.asOfIso, input.saleClientUuid);
  if (!lookup.ok) return { ok: false, error: lookup.errors.join(" ") };
  const sale = lookup.sale;

  const line = sale.lines.find((l) => l.lineId === input.orderLineId);
  if (!line) return { ok: false, error: "That item isn't on this receipt. Look the receipt up again and pick the item from the list." };
  // Fix Phase 6F (G-68): the owner's returnable product types, server-side.
  if (line.notReturnableReason) return { ok: false, error: line.notReturnableReason };
  // D205: no receipt = the package in hand must be scanned and match the line,
  // and the original packaging is mandatory.
  let scannedCode: string | null = null;
  if (input.noReceipt) {
    if (!input.originalPackaging || !input.lotIdLegible) {
      return { ok: false, error: "Without a receipt the product must be in its original packaging with the lot ID legible." };
    }
    const scan = await verifyReturnScan(line, input.noReceipt.scan);
    if (!scan.ok) return { ok: false, error: scan.error };
    scannedCode = scan.code;
  }

  // ── Exact refund from the stored paid price (no manual entry) ───────────
  const refund = refundForLine({
    unitPriceMinor: line.priceMinorUnits,
    quantity: input.quantity,
    remainingReturnable: line.remainingReturnable,
  });
  if (!refund.ok) return refund;

  // ── Task Q pipeline: attestations, add-back, correction queue, destroy ──
  // Phase 4 (G-29 item 3): an Other Inventory (non-cannabis) line never goes
  // through the cannabis lot / CCRS correction pipeline. It restocks the
  // catalog row (or writes it off) in one database transaction (0323).
  const isNc = isNonCannabisProductId(line.productId);
  const created: { ok: true; id: string; notice?: string | null } | { ok: false; error: string } = isNc
    ? await createNonCannabisReturn(
        {
          orderId: sale.orderId,
          orderLineId: line.lineId,
          quantity: input.quantity,
          disposition: input.disposition,
          reason: input.reason,
          detail: input.detail ?? null,
          refundMinor: refund.refundMinor,
        },
        actorId,
      )
    : await createCustomerReturn(
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
    refundedAtIso: input.asOfIso ?? new Date().toISOString(),
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
    scannedCode,
    // Phase 4: an Other Inventory unit is written off, never held on a lot.
    ...(isNc
      ? { stockNote: input.disposition === "destroy" ? "Written off (not put back on the shelf)." : null }
      : { stockNote: input.disposition === "destroy" ? (created.notice ?? DESTROY_RETURN_HELD_NOTE) : null }),
  };
}

/** Re-exported for the UI (result panel shows the original receipt number). */
export { receiptNumber };
