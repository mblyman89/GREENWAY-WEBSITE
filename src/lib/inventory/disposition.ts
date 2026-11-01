/**
 * src/lib/inventory/disposition.ts  (Run 6 / Slice 31 → Task Q command center)
 *
 * Server-side helpers for customer returns, vendor returns, destruction
 * events, and disposition settings. Every quantity change posts a
 * signed inventory_adjustments row (the single auditable ledger that feeds
 * the CCRS InventoryAdjustment.csv); the business detail lives in the
 * customer_returns / vendor_returns / destruction_events tables.
 *
 * Compliance grounding: docs/RETURNS_DESTRUCTION_COMPLIANCE.md (Task Q).
 * Pure validation/guardrails live in ./disposition-core (self-tested).
 *
 * Staff-only via the service-role client behind RLS.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
// GW-012: atomic lot quantity writes (strict for reductions).
import { applyLotDelta } from "@/lib/inventory/atomic-quantity";
import { syncLotMenuStock } from "@/lib/inventory/lot-menu-stock";
import {
  HOLD_HOURS_DEFAULT,
  clampHoldHours,
  computeEarliestDestroyAt,
  validateCustomerReturn,
  refundCeilingMinor,
  buildCustomerReturnAdjustmentNote,
  validateDestructionCompletion,
  buildDestructionAdjustmentNote,
  type CustomerReturnDisposition,
} from "@/lib/inventory/disposition-core";
import { pacificDayKey, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { getTaxSettings, getCannabisCategorySet, isCannabisCategory, applyBps } from "@/lib/reports/tax";
import { preTaxLineBaseMinor, preTaxUnitMinor } from "@/lib/reports/tax-base-core";
import {
  deriveInventoryExternalId,
  resolveSaleInventoryExternalId,
} from "@/lib/compliance/ccrs-identifiers";
// Mastering Slice 1: sold lines resolve the variant's own lot key first.
import { lotKeyForSaleLine } from "@/lib/pos/variant-lot-core";
// Fix Phase 1.3 (G-28): what a destruction does to the lot's status.
import {
  evaluateDestructionSchedule,
  lotStatusAfterEventCloses,
  lotCloseMessage,
  completionLotRefusal,
  OPEN_DESTRUCTION_STATUSES,
  type LotCloseAction,
} from "@/lib/inventory/destruction-lot-status-core";
// Fix Phase 1.4 (G-44): held units (customer-return Destroy) are never sellable.
import {
  evaluateReductionAgainstHold,
  isMissingHeldQtyColumnError,
  heldReleaseMessage,
  toHeldNumber,
  HOLD_PENDING_MIGRATION_NOTE,
  RECORD_CUSTOMER_RETURN_RPC,
  CONSUME_LOT_HOLD_RPC,
  RELEASE_LOT_HOLD_RPC,
} from "@/lib/inventory/held-stock-core";
import { dbErrorForStaff, isMissingDbFunctionError } from "@/lib/db/rpc-fallback-core";
// Fix Phase 7.1 (G-45): who sends customer-return Sale corrections.
import { correctionRouteFromSeedRead, type CorrectionRoute } from "@/lib/inventory/disposition-messages-core";
import { SALE_SLICE_RPC } from "@/lib/compliance/ccrs-return-corrections-core";
// Fix Phase 1.6c (G-42 req 6 with G-25): a Recall return takes the LCB contact from the lot's recall event.
import { recallReturnContact } from "@/lib/inventory/recall-event-core";
import { listRecallEventsForLot } from "@/lib/inventory/recall-event-store";
import {
  evaluateScheduleQuantity,
  holdNotElapsedMessage,
} from "@/lib/inventory/destruction-record-core";
// Fix Phase 1.5 (G-42): the state's vendor-return method (D63, D65).
import {
  evaluateVendorReturnLog,
  evaluateVendorReturnStep,
  isLegacyReducedReturn,
  vendorReturnAdjustmentNote,
  TRANSPORTATION_TYPES,
} from "@/lib/inventory/vendor-return-core";

/**
 * LEGACY default pre-destruction hold (hours). The old 72-hour WSLCB notice
 * was REMOVED from current rule (WSR 22-14-111; see compliance doc §5.1) — the
 * hold is now a configurable STORE POLICY in disposition_settings (default
 * 0h, the legal minimum — D67, Fix Phase 7.1 G-50). Kept exported for
 * backwards compatibility.
 */
export const DESTRUCTION_QUARANTINE_HOURS = HOLD_HOURS_DEFAULT;

/** Does this Supabase error mean migration 0115 has not been applied yet? */
function isMissingSchemaError(message: string | undefined | null): boolean {
  return /does not exist|could not find|schema cache/i.test(message ?? "");
}

export {
  VENDOR_RETURN_REASONS,
  DESTRUCTION_REASONS,
} from "@/lib/inventory/disposition-reasons";

export type VendorReturn = {
  id: string;
  lot_id: string;
  vendor_id: string | null;
  quantity: number;
  reason: string;
  detail: string | null;
  rma_number: string | null;
  adjustment_id: string | null;
  created_by: string | null;
  created_at: string;
  // Task Q manifest workflow (migration 0115; null/undefined pre-migration).
  manifest_number?: string | null;
  manifest_status?: string | null;
  pickup_at?: string | null;
  processor_license?: string | null;
  // Fix Phase 1.5 (G-42, migration 0309; null/undefined pre-migration).
  reserved_qty?: number | null;
  recall_officer?: string | null;
  recall_contact_date?: string | null;
  requested_by?: string | null;
  requested_at?: string | null;
  transportation_type?: string | null;
  transporter_license?: string | null;
  driver_name?: string | null;
  vehicle_vin?: string | null;
  vehicle_plate?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  est_departure_at?: string | null;
  est_arrival_at?: string | null;
  weight_per_unit_g?: number | null;
  servings_per_unit?: number | null;
  submitted_by?: string | null;
  submitted_at?: string | null;
  lcb_email_date?: string | null;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
  departed_by?: string | null;
  departed_at?: string | null;
  cancelled_by?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
};

export type CustomerReturn = {
  id: string;
  order_id: string | null;
  order_line_id: string | null;
  sale_external_id: string | null;
  sale_detail_external_id: string | null;
  product_name: string | null;
  inventory_external_id: string | null;
  sale_type: string | null;
  sale_date: string | null;
  unit_price_minor: number | null;
  discount_minor: number | null;
  sales_tax_minor: number | null;
  excise_minor: number | null;
  lot_id: string | null;
  quantity: number;
  original_quantity: number | null;
  original_packaging: boolean;
  lot_id_legible: boolean;
  disposition: CustomerReturnDisposition;
  reason: string;
  detail: string | null;
  refund_minor_units: number;
  correction_operation: "Delete" | "Update";
  correction_status: "pending" | "exported";
  correction_exported_at: string | null;
  adjustment_id: string | null;
  destruction_event_id: string | null;
  created_by: string | null;
  created_at: string;
};

export type DestructionEvent = {
  id: string;
  lot_id: string;
  quantity: number;
  reason: string;
  detail: string | null;
  status: "pending_quarantine" | "ready" | "completed" | "cancelled";
  quarantine_start: string;
  earliest_destroy_at: string | null;
  method: string | null;
  witnessed_by: string | null;
  completed_at: string | null;
  adjustment_id: string | null;
  created_by: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
  // Task Q waste-record columns (migration 0115; undefined pre-migration).
  rendering_method?: string | null;
  mix_material?: string | null;
  final_destination?: string | null;
  disposal_facility?: string | null;
  lcb_coordinated?: boolean | null;
  lcb_officer?: string | null;
  lcb_contact_date?: string | null;
  // Fix Phase 1.3 (G-28) columns (migration 0307; undefined pre-migration).
  /** The lot's status before scheduling (active | quarantine); null when the event never moved the lot. */
  previous_lot_status?: string | null;
  /** false = a customer-return unit: the event never touches the lot status. */
  lot_status_touched?: boolean | null;
  cancel_reason?: string | null;
  cancelled_by?: string | null;
  cancelled_at?: string | null;
  /** Fix Phase 1.4 (G-44, migration 0308): held units this event destroys. */
  held_qty_reserved?: number | null;
  // Fix Phase 1.6a (G-43) record columns (migration 0310; undefined pre-migration).
  witness_employee_id?: string | null;
  witness_name?: string | null;
  camera_name?: string | null;
  camera_start_at?: string | null;
  camera_end_at?: string | null;
  other_method_approval_ref?: string | null;
  other_method_approval_date?: string | null;
};

type WithLot = { lot_code: string | null; product_name: string | null; unit: string | null };
export type VendorReturnWithLot = VendorReturn & WithLot;
export type DestructionEventWithLot = DestructionEvent & WithLot & { hold_elapsed: boolean };

// ---------------------------------------------------------------------------
// Disposition settings (hold policy — store policy, see header)
// ---------------------------------------------------------------------------

export type DispositionSettings = { holdHours: number };
export const DEFAULT_DISPOSITION_SETTINGS: DispositionSettings = { holdHours: HOLD_HOURS_DEFAULT };

export async function getDispositionSettings(): Promise<DispositionSettings> {
  if (!isSupabaseServiceConfigured) return DEFAULT_DISPOSITION_SETTINGS;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("disposition_settings")
      .select("hold_hours")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return DEFAULT_DISPOSITION_SETTINGS;
    return { holdHours: clampHoldHours((data as { hold_hours: number }).hold_hours) };
  } catch {
    return DEFAULT_DISPOSITION_SETTINGS;
  }
}

export async function updateDispositionSettings(
  input: DispositionSettings,
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("disposition_settings").upsert({
    id: true,
    hold_hours: clampHoldHours(input.holdHours),
    updated_by: actorId,
  });
  if (error) {
    if (isMissingSchemaError(error.message)) {
      return { ok: false, error: "Apply migration 0115 first (disposition_settings table missing)." };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Shared: post a reducing adjustment and bump on-hand
// ---------------------------------------------------------------------------

async function postReduction(
  lotId: string,
  qtyMagnitude: number,
  reason: string,
  note: string | null,
  actorId: string | null,
): Promise<{ ok: true; adjustmentId: string } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  // Fix Phase 1.4 (G-44): read the held units too (pre-0308: none are held).
  let lotRead = await admin.from("inventory_lots").select("id, on_hand_qty, held_qty").eq("id", lotId).maybeSingle();
  if (lotRead.error && isMissingHeldQtyColumnError(lotRead.error)) {
    lotRead = (await admin.from("inventory_lots").select("id, on_hand_qty").eq("id", lotId).maybeSingle()) as typeof lotRead;
  }
  const lot = lotRead.data as { on_hand_qty: number; held_qty?: number | null } | null;
  if (!lot) return { ok: false, error: "Lot not found." };

  const onHand = Number(lot.on_hand_qty) || 0;
  // A disposition never takes units held for a customer-return destruction.
  const holdCheck = evaluateReductionAgainstHold({ qty: qtyMagnitude, onHand, held: lot.held_qty });
  if (!holdCheck.ok) return holdCheck;

  const { data: adj, error: insErr } = await admin
    .from("inventory_adjustments")
    .insert({ lot_id: lotId, qty_delta: -Math.abs(qtyMagnitude), reason, note, actor_id: actorId })
    .select("id")
    .single();
  if (insErr || !adj) return { ok: false, error: insErr?.message ?? "Could not post adjustment." };

  // GW-012: atomic STRICT delta — the database refuses the write when it
  // would take the lot below zero (e.g. a sale consumed the stock between
  // our on-hand check above and this write). On refusal the adjustment row
  // is removed so the ledger never describes a removal that didn't happen.
  const written = await applyLotDelta(admin, {
    lotId,
    delta: -Math.abs(qtyMagnitude),
    clamp: false,
    actorId,
    autoStatus: false, // dispositions manage lot status themselves
    fallbackAbsolute: { onHandQty: onHand - Math.abs(qtyMagnitude), updatedBy: actorId },
  });
  if (!written.ok) {
    await admin.from("inventory_adjustments").delete().eq("id", (adj as { id: string }).id);
    return { ok: false, error: written.error ?? "Could not update the lot." };
  }

  // R74 S32: the menu size this lot sells as loses the same units, so Leafly
  // and the website stop offering stock that left the shelf. Never throws;
  // a problem is logged loudly (the lot write is the legal record).
  await syncLotMenuStock(admin, lotId, -Math.abs(qtyMagnitude));

  return { ok: true, adjustmentId: (adj as { id: string }).id };
}

/**
 * Fix Phase 1.4 (G-44): complete the destruction of HELD units (a customer
 * return marked Destroy). On hand and held come down together in one
 * statement (consume_lot_hold, migration 0308), so the destruction can only
 * ever take the units that were held for it. The menu never had these units,
 * so no menu stock moves. On refusal the adjustment row is removed.
 */
async function postHeldReduction(
  lotId: string,
  qtyMagnitude: number,
  reason: string,
  note: string | null,
  actorId: string | null,
): Promise<{ ok: true; adjustmentId: string } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const qty = Math.abs(qtyMagnitude);
  const { data: adj, error: insErr } = await admin
    .from("inventory_adjustments")
    .insert({ lot_id: lotId, qty_delta: -qty, reason, note, actor_id: actorId })
    .select("id")
    .single();
  if (insErr || !adj) return { ok: false, error: insErr?.message ?? "Could not post adjustment." };
  const { data, error } = await admin.rpc(CONSUME_LOT_HOLD_RPC, { p_lot_id: lotId, p_qty: qty, p_actor: actorId });
  if (error || data === null || data === undefined) {
    await admin.from("inventory_adjustments").delete().eq("id", (adj as { id: string }).id);
    return {
      ok: false,
      error: error
        ? dbErrorForStaff(error)
        : "The lot no longer holds these returned units (someone changed it). Nothing was destroyed; refresh and check the lot.",
    };
  }
  return { ok: true, adjustmentId: (adj as { id: string }).id };
}

// ---------------------------------------------------------------------------
// Shared: post an ADDING adjustment (customer-return add-back) and bump on-hand
// ---------------------------------------------------------------------------

async function postAddition(
  lotId: string,
  qtyMagnitude: number,
  reason: string,
  note: string | null,
  actorId: string | null,
  opts: { sellable: boolean },
): Promise<{ ok: true; adjustmentId: string } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const { data: lot } = await admin
    .from("inventory_lots")
    .select("id, on_hand_qty")
    .eq("id", lotId)
    .maybeSingle();
  if (!lot) return { ok: false, error: "Lot not found." };

  const onHand = Number((lot as { on_hand_qty: number }).on_hand_qty) || 0;
  const { data: adj, error: insErr } = await admin
    .from("inventory_adjustments")
    .insert({ lot_id: lotId, qty_delta: Math.abs(qtyMagnitude), reason, note, actor_id: actorId })
    .select("id")
    .single();
  if (insErr || !adj) return { ok: false, error: insErr?.message ?? "Could not post adjustment." };

  // GW-012: atomic delta — additions can never lose a concurrent writer's
  // units the way the old absolute write could.
  const written = await applyLotDelta(admin, {
    lotId,
    delta: Math.abs(qtyMagnitude),
    clamp: true,
    actorId,
    autoStatus: false, // dispositions manage lot status themselves
    fallbackAbsolute: { onHandQty: onHand + Math.abs(qtyMagnitude), updatedBy: actorId },
  });
  if (!written.ok) {
    await admin.from("inventory_adjustments").delete().eq("id", (adj as { id: string }).id);
    return { ok: false, error: written.error ?? "Could not update the lot." };
  }

  // R74 S32: a returned unit that goes back on the shelf goes back on the
  // menu. One headed for destruction does not (it is not for sale).
  if (opts.sellable) await syncLotMenuStock(admin, lotId, Math.abs(qtyMagnitude));

  return { ok: true, adjustmentId: (adj as { id: string }).id };
}

// ---------------------------------------------------------------------------
// Customer returns — WAC 314-55-079(12) + CCRS FAQ (sale Delete/Update +
// adjustment "as a return, with details"). See compliance doc §2.
// ---------------------------------------------------------------------------

// Fix Phase 7.1 (G-45, owner D66: "Q4- remove it."): the back-office return
// search (searchReturnableOrderLines, R-RET G-70) served only the removed
// Customer return wizard and is gone with it. The Returns desk and the
// register find a sale by its printed receipt (returns-store.ts
// lookupSaleByReceipt) and run the store return policy.

export async function listCustomerReturns(limit = 50): Promise<CustomerReturn[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("customer_returns")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data as CustomerReturn[]) ?? [];
  } catch {
    return [];
  }
}

/**
 * Accept a customer return end-to-end:
 *  1. validates the WAC 314-55-079(12) attestations + quantities (pure core),
 *  2. snapshots the CCRS Sale-row data (ids, taxes) needed for the correction
 *     file (Delete for full-line return, Update for partial),
 *  3. posts the POSITIVE add-back adjustment (internal 'return' → CCRS Other
 *     with a mandatory detail stating the ADD direction),
 *  4. if disposition = destroy, opens a destruction event for the returned
 *     quantity (LCB coordination/waste record enforced at completion).
 *
 * Fix Phase 1.4 (G-44; F-15-6, F-15-7): steps 3-4 and the return row are ONE
 * database transaction (record_customer_return, migration 0308). A Destroy
 * return's units are HELD on the lot (inventory_lots.held_qty): still on hand
 * and in CCRS, never sellable (sale-lot-read, POS menu, sellability report).
 * Before 0308 the old writes run and any failure undoes the add-back.
 */
export async function createCustomerReturn(
  input: {
    orderId: string;
    orderLineId: string;
    lotId?: string | null;
    quantity: number;
    disposition: CustomerReturnDisposition;
    reason: string;
    detail?: string | null;
    refundMinor: number;
    originalPackaging: boolean;
    lotIdLegible: boolean;
  },
  actorId: string | null,
): Promise<{ ok: true; id: string; held: boolean; notice?: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();

  // ── Load the original order + line ─────────────────────────────────────────
  const [{ data: order }, { data: line }] = await Promise.all([
    admin
      .from("orders")
      .select("id, order_number, status, placed_at, completed_at")
      .eq("id", input.orderId)
      .maybeSingle(),
    admin
      .from("order_lines")
      .select(
        "id, order_id, product_id, variant_id, product_name, quantity, price_minor_units, regular_price_minor_units, ccrs_inventory_external_id",
      )
      .eq("id", input.orderLineId)
      .maybeSingle(),
  ]);
  if (!order) return { ok: false, error: "That sale couldn't be found. Search for the sale again and pick it from the list." };
  if ((order as { status: string }).status !== "completed") {
    return { ok: false, error: "This sale can't be returned because it was never finished. Only completed sales can be returned." };
  }
  if (!line || (line as { order_id: string }).order_id !== input.orderId) {
    return { ok: false, error: "That item isn't on this sale. Search for the sale again and pick the item from the list." };
  }
  const o = order as { id: string; order_number: string; placed_at: string; completed_at: string | null };
  const l = line as {
    id: string;
    product_id: string | null;
    variant_id: string | null;
    product_name: string;
    quantity: number;
    price_minor_units: number;
    regular_price_minor_units: number | null;
    ccrs_inventory_external_id: string | null;
  };
  // Mastering Slice 1: the variant's own encoded lot key wins over the card's
  // product_id (single-lot cards resolve the identical key either way).
  const lineLotKey = lotKeyForSaleLine({ productId: l.product_id, variantId: l.variant_id });

  // Quantity already returned on this line (double-return guard) AND dollars
  // already refunded on this line (F-1 refund-ceiling guard).
  let alreadyReturned = 0;
  let alreadyRefundedMinor = 0;
  try {
    const { data: prior } = await admin
      .from("customer_returns")
      .select("quantity, refund_minor_units")
      .eq("order_line_id", l.id);
    for (const r of (prior as { quantity: number; refund_minor_units: number | null }[] | null) ?? []) {
      alreadyReturned += Number(r.quantity) || 0;
      alreadyRefundedMinor += Number(r.refund_minor_units) || 0;
    }
  } catch {
    // pre-0115: table missing — creation below will fail with a clear message.
  }
  const remainingReturnable = (Number(l.quantity) || 0) - alreadyReturned;

  // F-1 refund ceiling. price_minor_units is the tax-INCLUSIVE out-the-door
  // unit price (what actually left the customer's wallet per unit).
  // R-RET-2 (owner message 13): the ceiling is the SMALLER of what the
  // customer paid for the units coming back now and what is still unrefunded
  // on the whole line. The old "this return minus every earlier refund" form
  // capped the second unit of a 2-unit line at $0.00.
  const maxRefundMinor = refundCeilingMinor({
    unitPriceMinor: Number(l.price_minor_units) || 0,
    lineQuantity: Number(l.quantity) || 0,
    returnQuantity: input.quantity,
    alreadyRefundedMinor,
  });

  // ── Pure validation (WAC 314-55-079(12) + quantities + money) ─────────────
  const verdict = validateCustomerReturn({
    quantity: input.quantity,
    originalQuantity: remainingReturnable,
    originalPackaging: input.originalPackaging,
    lotIdLegible: input.lotIdLegible,
    disposition: input.disposition,
    reason: input.reason,
    refundMinor: input.refundMinor,
    maxRefundMinor,
  });
  if (!verdict.ok) return verdict;
  // Correction operation is decided against the FULL original line: only a
  // return of the whole original quantity deletes the sale row.
  const totalAfter = alreadyReturned + input.quantity;
  const correctionOperation: "Delete" | "Update" =
    totalAfter >= (Number(l.quantity) || 0) ? "Delete" : "Update";

  // ── Resolve the inventory lot (explicit pick wins; else by product key) ───
  let lotId = (input.lotId ?? "").trim() || null;
  let lotRow: {
    id: string;
    lot_code: string | null;
    pos_product_key: string | null;
    ccrs_inventory_external_id?: string | null;
  } | null = null;
  if (lotId) {
    const { data } = await admin
      .from("inventory_lots")
      .select("id, lot_code, pos_product_key, ccrs_inventory_external_id")
      .eq("id", lotId)
      .maybeSingle();
    lotRow = (data as typeof lotRow) ?? null;
    if (!lotRow) return { ok: false, error: "The lot you picked couldn't be found. It may have been removed; pick the lot again." };
  } else if (lineLotKey) {
    const { data } = await admin
      .from("inventory_lots")
      .select("id, lot_code, pos_product_key, ccrs_inventory_external_id, status, created_at")
      .eq("pos_product_key", lineLotKey)
      .order("created_at", { ascending: false })
      .limit(5);
    const candidates =
      (data as
        | {
            id: string;
            lot_code: string | null;
            pos_product_key: string | null;
            ccrs_inventory_external_id: string | null;
            status: string;
          }[]
        | null) ?? [];
    lotRow = candidates.find((c) => c.status !== "quarantine") ?? candidates[0] ?? null;
    lotId = lotRow?.id ?? null;
  }
  if (!lotRow || !lotId) {
    return {
      ok: false,
      error:
        "The system couldn't tell which inventory lot this product came from. Pick the lot by hand (the lot number is printed on the package) so the returned item goes back to the right lot.",
    };
  }

  // ── Snapshot the CCRS Sale-row data for the correction file ───────────────
  const inventoryExternalId = resolveSaleInventoryExternalId({
    lineExplicit: l.ccrs_inventory_external_id,
    // S-10: the correction must reference the id the lot was FILED under.
    lotCanonical: deriveInventoryExternalId({
      ccrs_inventory_external_id: lotRow.ccrs_inventory_external_id ?? null,
      lot_code: lotRow.lot_code,
      pos_product_key: lotRow.pos_product_key,
      id: lotRow.id,
    }),
    posProductKey: lineLotKey,
  }).value;

  const qty = Number(l.quantity) || 0;
  const soldUnit = l.price_minor_units ?? 0; // tax-INCLUSIVE out-the-door unit
  const regularUnit = l.regular_price_minor_units ?? soldUnit; // tax-INCLUSIVE

  // Medical + tax status mirror the Sale.csv builder (see ccrs-sales.ts).
  let isMedical = false;
  let salesExempt = false;
  let exciseExempt = false;
  try {
    const { data: exemptRows } = await admin
      .from("medical_exempt_sales")
      .select("product_sku, sales_tax_exempt, excise_tax_exempt")
      .eq("order_id", o.id);
    for (const r of (exemptRows as
      | { product_sku: string | null; sales_tax_exempt: boolean | null; excise_tax_exempt: boolean | null }[]
      | null) ?? []) {
      isMedical = true;
      if (r.product_sku && r.product_sku === l.product_id) {
        salesExempt = salesExempt || r.sales_tax_exempt === true;
        exciseExempt = exciseExempt || r.excise_tax_exempt === true;
      }
    }
  } catch {
    // medical tables absent — treat as non-medical.
  }

  const [taxSettings, cannabisSet] = await Promise.all([getTaxSettings(), getCannabisCategorySet()]);
  let category = "";
  if (l.product_id) {
    const { data: mi } = await admin
      .from("menu_items")
      .select("category")
      .eq("source_item_id", l.product_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    category = ((mi as { category: string | null } | null)?.category ?? "").trim();
  }
  const isCannabis = isCannabisCategory(category, cannabisSet);
  // GW-010: mirror the (fixed) Sale.csv builder — stored prices are
  // tax-INCLUSIVE, so the correction snapshot backs out the pre-tax figures
  // the original Sale row reported (UnitPrice pre-tax, taxes on the pre-tax
  // base, exemption-aware still-due rate).
  const combinedBps = taxSettings.stateSalesRateBps + taxSettings.localSalesRateBps;
  const preTaxRegularUnit = preTaxUnitMinor({
    unitPriceMinorUnits: regularUnit,
    isCannabis,
    combinedSalesRateBps: combinedBps,
    exciseRateBps: taxSettings.exciseRateBps,
  });
  const baseCents = preTaxLineBaseMinor({
    unitPriceMinorUnits: soldUnit,
    quantity: qty,
    isCannabis,
    salesExempt,
    exciseExempt,
    combinedSalesRateBps: combinedBps,
    exciseRateBps: taxSettings.exciseRateBps,
  });
  const discountCents = Math.max(0, preTaxRegularUnit * qty - baseCents);
  const salesTaxCents = salesExempt ? 0 : applyBps(baseCents, combinedBps);
  const exciseCents = isCannabis && !exciseExempt ? applyBps(baseCents, taxSettings.exciseRateBps) : 0;

  const saleExternalId = o.order_number || o.id;
  const saleDetailExternalId = `${saleExternalId}-${l.id.slice(0, 8)}`;
  const saleDate = pacificDayKey(o.completed_at ?? o.placed_at); // YYYY-MM-DD

  // ── Post the POSITIVE add-back adjustment (internal 'return' → CCRS Other) ─
  const note = buildCustomerReturnAdjustmentNote({
    quantity: input.quantity,
    unit: null,
    reason: input.reason,
    disposition: input.disposition,
    saleExternalId,
    detail: input.detail,
  });
  const returnRow = {
    order_id: o.id,
    order_line_id: l.id,
    sale_external_id: saleExternalId,
    sale_detail_external_id: saleDetailExternalId,
    product_name: l.product_name,
    inventory_external_id: inventoryExternalId || null,
    sale_type: isMedical ? "RecreationalMedical" : "RecreationalRetail",
    sale_date: saleDate,
    unit_price_minor: preTaxRegularUnit,
    discount_minor: discountCents,
    sales_tax_minor: salesTaxCents,
    excise_minor: exciseCents,
    original_quantity: qty,
    original_packaging: input.originalPackaging,
    lot_id_legible: input.lotIdLegible,
    disposition: input.disposition,
    reason: input.reason,
    detail: input.detail ?? null,
    refund_minor_units: input.refundMinor,
    correction_operation: correctionOperation,
    correction_status: "pending",
  };
  const isDestroy = input.disposition === "destroy";
  const destructionDetail = `Customer return (${input.reason.replace(/_/g, " ")}) — sale ${saleExternalId}`;

  // ── Fix Phase 1.4 (G-44; F-15-6, F-15-7): ONE transaction ─────────────────
  // record_customer_return (migration 0308) writes the CCRS Other add-back,
  // raises on hand, HOLDS the units for a Destroy return (never sellable),
  // opens the destruction event and saves the return row, or none of them.
  const settings = isDestroy ? await getDispositionSettings() : null;
  const destruction = isDestroy
    ? {
        quantity: input.quantity,
        reason: "other",
        detail: destructionDetail,
        earliest_destroy_at: computeEarliestDestroyAt(new Date().toISOString(), settings!.holdHours),
      }
    : null;
  const { data: rpcData, error: rpcErr } = await admin.rpc(RECORD_CUSTOMER_RETURN_RPC, {
    p_lot_id: lotId,
    p_qty: input.quantity,
    p_note: note,
    p_actor: actorId,
    p_hold: isDestroy,
    p_destruction: destruction,
    p_return: returnRow,
  });
  if (!rpcErr) {
    const r = (rpcData ?? {}) as { return_id?: string | null };
    if (!r.return_id) return { ok: false, error: "The return didn't save (the database didn't confirm it). Nothing was changed, so it's safe to try again." };
    // A Restock unit goes back on the menu; a held Destroy unit never does.
    if (!isDestroy) await syncLotMenuStock(admin, lotId, Math.abs(input.quantity));
    return { ok: true, id: r.return_id, held: isDestroy };
  }
  if (!isMissingDbFunctionError(rpcErr)) {
    // The transaction rolled back: no add-back, no event, no return row.
    return { ok: false, error: `The return was not saved and nothing was changed: ${dbErrorForStaff(rpcErr)}` };
  }

  // ── Before migration 0308: the old writes, made all-or-nothing by undoing ─
  // (F-15-7). The unit cannot be held by the app yet, so the caller is told
  // to keep it in the sealed destroy bin (SOP-15 §4.7).
  const posted = await postAddition(lotId, input.quantity, "return", note, actorId, { sellable: !isDestroy });
  if (!posted.ok) return posted;

  let destructionEventId: string | null = null;
  if (isDestroy) {
    const scheduled = await scheduleDestruction(
      {
        lotId,
        quantity: input.quantity,
        reason: "other",
        detail: destructionDetail,
        // Only the returned unit is segregated; the rest of the lot stays sellable.
        quarantineLot: false,
      },
      actorId,
    );
    if (!scheduled.ok) {
      await undoAddition(admin, lotId, input.quantity, posted.adjustmentId, actorId, false);
      return { ok: false, error: `The destruction event could not be opened, so the return was not saved and the add-back was undone: ${scheduled.error}` };
    }
    destructionEventId = scheduled.id;
  }

  const { data: created, error: insErr } = await admin
    .from("customer_returns")
    .insert({
      ...returnRow,
      lot_id: lotId,
      quantity: input.quantity,
      adjustment_id: posted.adjustmentId,
      destruction_event_id: destructionEventId,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (insErr || !created) {
    if (destructionEventId) await admin.from("destruction_events").delete().eq("id", destructionEventId);
    await undoAddition(admin, lotId, input.quantity, posted.adjustmentId, actorId, !isDestroy);
    if (isMissingSchemaError(insErr?.message)) {
      return { ok: false, error: "Apply migration 0115 first (customer_returns table missing). Nothing was changed (the add-back was undone)." };
    }
    return { ok: false, error: `The return was not saved and the add-back was undone: ${insErr?.message ?? "unknown error"}` };
  }
  return {
    ok: true,
    id: (created as { id: string }).id,
    held: false,
    notice: isDestroy ? HOLD_PENDING_MIGRATION_NOTE : undefined,
  };
}

/**
 * Pre-0308 compensation (F-15-7): take back an add-back whose return could
 * not be saved. Strict delta; the adjustment row is removed so the ledger
 * never describes an add-back that did not stand. Menu stock is reversed
 * only when the add-back had moved it (a Restock return).
 */
async function undoAddition(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  lotId: string,
  qty: number,
  adjustmentId: string,
  actorId: string | null,
  menuMoved: boolean,
): Promise<void> {
  const { data: lotRow } = await admin.from("inventory_lots").select("on_hand_qty").eq("id", lotId).maybeSingle();
  const onHand = Number((lotRow as { on_hand_qty: number } | null)?.on_hand_qty) || 0;
  const undone = await applyLotDelta(admin, {
    lotId,
    delta: -Math.abs(qty),
    clamp: false,
    actorId,
    autoStatus: false,
    fallbackAbsolute: { onHandQty: Math.max(0, onHand - Math.abs(qty)), updatedBy: actorId },
  });
  if (undone.ok) {
    await admin.from("inventory_adjustments").delete().eq("id", adjustmentId);
    if (menuMoved) await syncLotMenuStock(admin, lotId, -Math.abs(qty));
  } else {
    console.error(`[disposition] could not undo customer-return add-back on lot ${lotId}: ${undone.error}`);
  }
}

/** Mark returns' CCRS Sale corrections as exported (after CSV download). */
export async function markCorrectionsExported(ids: string[]): Promise<void> {
  if (!isSupabaseServiceConfigured || ids.length === 0) return;
  try {
    const admin = createSupabaseAdminClient();
    await admin
      .from("customer_returns")
      .update({ correction_status: "exported", correction_exported_at: new Date().toISOString() })
      .in("id", ids);
  } catch {
    // non-fatal
  }
}

/**
 * Fix Phase 7.1 (G-45, F-15-10): who sends the customer-return Sale
 * corrections right now: the weekly CCRS batch (production ledger loaded and
 * 0283 installed) or the manual download (otherwise; the batch then withholds
 * them). Two small reads; every error is classified, an unclassified one is
 * "unknown" and the download refuses (correctionRouteFromSeedRead).
 */
export async function readCorrectionRoute(): Promise<CorrectionRoute> {
  if (!isSupabaseServiceConfigured) return "unknown";
  try {
    const admin = createSupabaseAdminClient();
    const { count, error } = await admin
      .from("ccrs_files")
      .select("id", { count: "exact", head: true })
      .eq("env", "prod")
      .eq("purpose", "seed")
      .eq("state", "closed");
    if (error) {
      return correctionRouteFromSeedRead({ closedSeedRows: null, errorCode: error.code ?? null, errorMessage: error.message ?? null });
    }
    if ((count ?? 0) <= 0) return correctionRouteFromSeedRead({ closedSeedRows: count ?? null });
    const slice = await admin.rpc(SALE_SLICE_RPC, { p_env: "prod", p_detail_ids: [] });
    if (slice.error && !isMissingDbFunctionError(slice.error)) return "unknown";
    return correctionRouteFromSeedRead({ closedSeedRows: count ?? null, saleSliceMissing: !!slice.error });
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Vendor returns
// ---------------------------------------------------------------------------

export async function listVendorReturns(limit = 100): Promise<VendorReturnWithLot[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("vendor_returns")
    .select("*, lot:inventory_lots(lot_code, product_name, unit)")
    .order("created_at", { ascending: false })
    .limit(limit);
  return normaliseLot(data) as VendorReturnWithLot[];
}

/** The RPCs of migration 0309 (G-42). */
export const RESERVE_VENDOR_RETURN_RPC = "reserve_vendor_return";
export const DEPART_VENDOR_RETURN_RPC = "depart_vendor_return";
export const RELEASE_VENDOR_RETURN_RPC = "release_vendor_return";

/** Shown when migration 0309 is not applied: the app never falls back to reduce-at-logging. */
export const VENDOR_RETURN_PENDING_MIGRATION =
  "Apply migration 0309 first: until then a vendor return cannot be logged in the app (it would take the units off on-hand before they leave). Follow SOP-15 §4.11 on paper.";

/**
 * Fix Phase 1.7b (G-42 req 7): everything the printable vendor-return packet
 * (form 8.2 in the app) shows: the return, its lot, its vendor, the store's
 * license settings and the names of who did each step (staff_profiles: full
 * name, else email). Nothing is filled in that the app does not hold.
 */
export async function getVendorReturnPacket(id: string): Promise<{
  ret: VendorReturn;
  lot: { lot_code: string | null; product_name: string | null; unit: string | null } | null;
  vendor: { display_name: string | null; legal_name: string | null; phone: string | null; email: string | null } | null;
  origin: { license_number: string | null; trade_name: string | null; location_address: string | null; city: string | null; contact_phone: string | null; contact_email: string | null } | null;
  names: Record<"created_by" | "requested_by" | "submitted_by" | "confirmed_by" | "departed_by" | "cancelled_by", string | null>;
} | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("vendor_returns").select("*").eq("id", id).maybeSingle();
  const ret = (data as VendorReturn | null) ?? null;
  if (!ret) return null;
  const [{ data: lot }, { data: vendor }, { data: origin }] = await Promise.all([
    admin.from("inventory_lots").select("lot_code, product_name, unit").eq("id", ret.lot_id).maybeSingle(),
    ret.vendor_id
      ? admin.from("vendors").select("display_name, legal_name, phone, email").eq("id", ret.vendor_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("license_settings").select("license_number, trade_name, location_address, city, contact_phone, contact_email").eq("id", true).maybeSingle(),
  ]);
  const who = {
    created_by: ret.created_by,
    requested_by: ret.requested_by ?? null,
    submitted_by: ret.submitted_by ?? null,
    confirmed_by: ret.confirmed_by ?? null,
    departed_by: ret.departed_by ?? null,
    cancelled_by: ret.cancelled_by ?? null,
  };
  const ids = [...new Set(Object.values(who).filter((v): v is string => !!v))];
  const map = new Map<string, string>();
  if (ids.length > 0) {
    const { data: people } = await admin.from("staff_profiles").select("id, full_name, email").in("id", ids);
    for (const p of (people as { id: string; full_name: string | null; email: string | null }[] | null) ?? []) {
      map.set(p.id, p.full_name || p.email || p.id);
    }
  }
  const nameOf = (v: string | null) => (v ? (map.get(v) ?? null) : null);
  return {
    ret,
    lot: (lot as { lot_code: string | null; product_name: string | null; unit: string | null } | null) ?? null,
    vendor: (vendor as { display_name: string | null; legal_name: string | null; phone: string | null; email: string | null } | null) ?? null,
    origin: (origin as { license_number: string | null; trade_name: string | null; location_address: string | null; city: string | null; contact_phone: string | null; contact_email: string | null } | null) ?? null,
    names: {
      created_by: nameOf(who.created_by),
      requested_by: nameOf(who.requested_by),
      submitted_by: nameOf(who.submitted_by),
      confirmed_by: nameOf(who.confirmed_by),
      departed_by: nameOf(who.departed_by),
      cancelled_by: nameOf(who.cancelled_by),
    },
  };
}

export async function getVendorReturn(id: string): Promise<VendorReturn | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("vendor_returns").select("*").eq("id", id).maybeSingle();
  return (data as VendorReturn | null) ?? null;
}

/**
 * Fix Phase 1.5 (G-42 req 1, 2, 6; F-15-1, F-15-2; D63 (4), D65): log a vendor
 * return. The units are RESERVED (inventory_lots.held_qty): out of sale but
 * still on hand and in CCRS. Nothing posts to CCRS now; the reduction and the
 * CCRS Other adjustment post at departure (departVendorReturn). RMA, vendor,
 * numeric processor license and detail are required; a Recalled lot may be
 * returned (reason Recall, with the LCB officer and contact date) and keeps
 * its status until it departs. One transaction (reserve_vendor_return).
 */
export async function createVendorReturn(
  input: {
    lotId: string;
    vendorId: string | null;
    quantity: number;
    reason: string;
    detail: string | null;
    rmaNumber: string | null;
    processorLicense: string | null;
    recallOfficer?: string | null;
    recallContactDate?: string | null;
  },
  actorId: string | null,
): Promise<
  | { ok: true; id: string; recallOfficer: string | null; recallContactDate: string | null }
  | { ok: false; error: string }
> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const lotRead = await admin.from("inventory_lots").select("id, status, on_hand_qty, held_qty, vendor_id").eq("id", input.lotId).maybeSingle();
  if (lotRead.error && isMissingHeldQtyColumnError(lotRead.error)) return { ok: false, error: VENDOR_RETURN_PENDING_MIGRATION };
  const lot = lotRead.data as { status: string; on_hand_qty: number; held_qty: number | null; vendor_id: string | null } | null;
  if (!lot) return { ok: false, error: "Lot not found." };
  // Req 2: the vendor is pre-filled from the lot (the one it was received
  // from) and its license from Vendors & Brands, unless the form names others.
  const vendorId = input.vendorId?.trim() || lot.vendor_id || null;
  let processorLicense = input.processorLicense?.trim() || null;
  if (!processorLicense && vendorId) {
    const { data: vrow } = await admin.from("vendors").select("license_number").eq("id", vendorId).maybeSingle();
    processorLicense = (vrow as { license_number: string | null } | null)?.license_number?.trim() || null;
  }
  const free = Math.max(0, toHeldNumber(lot.on_hand_qty) - toHeldNumber(lot.held_qty));
  // Fix Phase 1.6c (G-42 req 6): "Reason Recall is refused unless the lot's
  // recall event (G-25) records the coordinator's LCB contact." The officer
  // and the contact date come from that event (form fields are ignored), so
  // the return and the recall log can never disagree.
  let recallOfficer: string | null = null;
  let recallContactDate: string | null = null;
  if (input.reason === "recall") {
    const contact = recallReturnContact(await listRecallEventsForLot(input.lotId), (iso) => pacificDayKey(iso));
    if (!contact.ok) return { ok: false, error: contact.message };
    recallOfficer = contact.officer;
    recallContactDate = contact.contactDate;
  }
  const decision = evaluateVendorReturnLog({
    lotStatus: lot.status,
    reason: input.reason,
    quantity: input.quantity,
    free,
    vendorId,
    rmaNumber: input.rmaNumber,
    processorLicense,
    detail: input.detail,
    recallOfficer,
    recallContactDate,
    todayPacific: pacificDayKey(new Date()),
  });
  if (!decision.ok) return { ok: false, error: decision.refusals.map((r) => r.message).join(" ") };

  const { data, error } = await admin.rpc(RESERVE_VENDOR_RETURN_RPC, {
    p_lot_id: input.lotId,
    p_qty: input.quantity,
    p_actor: actorId,
    p_return: {
      vendor_id: vendorId,
      reason: input.reason,
      detail: input.detail?.trim() || null,
      rma_number: input.rmaNumber?.trim() || null,
      processor_license: processorLicense,
      recall_officer: recallOfficer,
      recall_contact_date: recallContactDate,
    },
  });
  if (error) {
    if (isMissingDbFunctionError(error) || isMissingSchemaError(error.message)) return { ok: false, error: VENDOR_RETURN_PENDING_MIGRATION };
    return { ok: false, error: dbErrorForStaff(error) };
  }
  if (!data) return { ok: false, error: "Could not save return." };
  // The reserved units leave the menu now (they are no longer sellable).
  await syncLotMenuStock(admin, input.lotId, -Math.abs(input.quantity));
  return { ok: true, id: String(data), recallOfficer, recallContactDate };
}

/**
 * Fix Phase 1.5 (G-42 req 3; v1.1 items 8, 9): the transport details for
 * Manifest.CSV (Greenway is the origin). Editable until the manifest is
 * uploaded; after that a change means a corrected upload (SOP-15 §4.10 step 5).
 */
export async function updateVendorReturnTransport(
  input: {
    id: string;
    transportationType: string;
    transporterLicense: string | null;
    driverName: string | null;
    vin: string | null;
    plate: string | null;
    make: string | null;
    model: string | null;
    color: string | null;
    estDepartureAt: string | null;
    estArrivalAt: string | null;
    weightPerUnitG: number | null;
    servingsPerUnit: number | null;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase service role not configured." };
  if (!(TRANSPORTATION_TYPES as readonly string[]).includes(input.transportationType)) {
    return { ok: false, error: "Choose the transportation type: Regular, Pick-up or Transporter Licensee." };
  }
  const admin = createSupabaseAdminClient();
  const current = await getVendorReturn(input.id);
  if (!current) return { ok: false, error: "Vendor return not found." };
  const status = current.manifest_status ?? "none";
  if (status !== "requested" && status !== "submitted" && status !== "confirmed") {
    return { ok: false, error: "Transport details can only be changed on an open return." };
  }
  const t = (v: string | null) => v?.trim() || null;
  const { error } = await admin
    .from("vendor_returns")
    .update({
      transportation_type: input.transportationType,
      transporter_license: input.transportationType === "Transporter Licensee" ? t(input.transporterLicense) : null,
      driver_name: t(input.driverName),
      vehicle_vin: t(input.vin),
      vehicle_plate: t(input.plate),
      vehicle_make: t(input.make),
      vehicle_model: t(input.model),
      vehicle_color: t(input.color),
      est_departure_at: input.estDepartureAt,
      est_arrival_at: input.estArrivalAt,
      weight_per_unit_g: input.weightPerUnitG,
      servings_per_unit: input.servingsPerUnit,
    })
    .eq("id", input.id)
    .in("manifest_status", ["requested", "submitted", "confirmed"]);
  if (error) {
    if (isMissingSchemaError(error.message)) return { ok: false, error: VENDOR_RETURN_PENDING_MIGRATION };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Fix Phase 1.5 (G-42 req 3, 4; F-15-3): advance ONE step, checked on the
 * server, stamped with who and when. "Manifest uploaded" needs the manifest
 * number; "LCB success email and PDF received" needs the email date;
 * departure (pickup time in Pacific, driver) posts the CCRS Other adjustment
 * and takes on-hand and the reservation down together (depart_vendor_return).
 * Each status write is compare-and-set on the status it replaces.
 */
export async function updateVendorReturnManifest(
  input: {
    id: string;
    manifestStatus: string;
    manifestNumber?: string | null;
    lcbEmailDate?: string | null;
    pickupIso?: string | null;
    driverName?: string | null;
  },
  actorId: string | null,
): Promise<{ ok: true; adjustmentId?: string; lotId: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const current = await getVendorReturn(input.id);
  if (!current) return { ok: false, error: "Vendor return not found." };
  const from = current.manifest_status ?? "none";
  const decision = evaluateVendorReturnStep({
    from,
    to: input.manifestStatus,
    manifestNumber: input.manifestNumber ?? current.manifest_number ?? null,
    lcbEmailDate: input.lcbEmailDate ?? null,
    submittedDay: current.submitted_at ? pacificDayKey(current.submitted_at) : null,
    pickupIso: input.pickupIso ?? null,
    driverName: input.driverName ?? current.driver_name ?? null,
    todayPacific: pacificDayKey(new Date()),
    nowIso: new Date().toISOString(),
  });
  if (!decision.ok) return { ok: false, error: decision.refusals.map((r) => r.message).join(" ") };

  const now = new Date().toISOString();
  if (input.manifestStatus === "picked_up") {
    if (isLegacyReducedReturn(current)) {
      // Logged before Phase 1.5: on-hand already came off at logging. Only the step is recorded.
      const { error } = await admin
        .from("vendor_returns")
        .update({ manifest_status: "picked_up", pickup_at: input.pickupIso, driver_name: input.driverName?.trim() || null, departed_by: actorId, departed_at: now })
        .eq("id", input.id)
        .eq("manifest_status", from);
      if (error) return { ok: false, error: isMissingSchemaError(error.message) ? VENDOR_RETURN_PENDING_MIGRATION : error.message };
      return { ok: true, lotId: current.lot_id };
    }
    let processorName: string | null = null;
    if (current.vendor_id) {
      const { data: v } = await admin.from("vendors").select("display_name, legal_name").eq("id", current.vendor_id).maybeSingle();
      const vr = v as { display_name: string | null; legal_name: string | null } | null;
      processorName = vr?.legal_name?.trim() || vr?.display_name?.trim() || null;
    }
    const note = vendorReturnAdjustmentNote({
      processorName,
      processorLicense: current.processor_license,
      manifestNumber: current.manifest_number,
      rmaNumber: current.rma_number,
      reason: current.reason,
      detail: current.detail,
    });
    const { data, error } = await admin.rpc(DEPART_VENDOR_RETURN_RPC, {
      p_return_id: input.id,
      p_note: note,
      p_pickup_at: input.pickupIso,
      p_driver: input.driverName?.trim() || "",
      p_actor: actorId,
    });
    if (error) {
      if (isMissingDbFunctionError(error)) return { ok: false, error: VENDOR_RETURN_PENDING_MIGRATION };
      return { ok: false, error: dbErrorForStaff(error) };
    }
    return { ok: true, adjustmentId: data ? String(data) : undefined, lotId: current.lot_id };
  }

  const patch: Record<string, unknown> = { manifest_status: input.manifestStatus };
  if (input.manifestStatus === "submitted") {
    patch.manifest_number = (input.manifestNumber ?? current.manifest_number ?? "").trim();
    patch.submitted_by = actorId;
    patch.submitted_at = now;
  } else if (input.manifestStatus === "confirmed") {
    patch.lcb_email_date = input.lcbEmailDate;
    patch.confirmed_by = actorId;
    patch.confirmed_at = now;
  }
  const { data: moved, error } = await admin
    .from("vendor_returns")
    .update(patch)
    .eq("id", input.id)
    .eq("manifest_status", from)
    .select("id");
  if (error) {
    if (isMissingSchemaError(error.message)) return { ok: false, error: VENDOR_RETURN_PENDING_MIGRATION };
    return { ok: false, error: error.message };
  }
  if (!moved || (moved as unknown[]).length === 0) {
    return { ok: false, error: "Someone changed this return a moment ago. Refresh and check its step." };
  }
  return { ok: true, lotId: current.lot_id };
}

/**
 * Fix Phase 1.5 (G-42 req 5): the owner's cancel releases the reserved units
 * (on hand unchanged; they become sellable again) with a reason. The action
 * checks the permission (inventory.vendor_return.cancel) and the reason.
 */
export async function cancelVendorReturn(
  id: string,
  actorId: string | null,
  reason: string,
): Promise<{ ok: true; released: number; lotId: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase service role not configured." };
  const admin = createSupabaseAdminClient();
  const current = await getVendorReturn(id);
  if (!current) return { ok: false, error: "Vendor return not found." };
  const { data, error } = await admin.rpc(RELEASE_VENDOR_RETURN_RPC, { p_return_id: id, p_reason: reason, p_actor: actorId });
  if (error) {
    if (isMissingDbFunctionError(error)) return { ok: false, error: VENDOR_RETURN_PENDING_MIGRATION };
    return { ok: false, error: dbErrorForStaff(error) };
  }
  const released = toHeldNumber(data);
  if (released > 0) await syncLotMenuStock(admin, current.lot_id, released);
  return { ok: true, released, lotId: current.lot_id };
}

// ---------------------------------------------------------------------------
// Destruction events
// ---------------------------------------------------------------------------

export async function listDestructionEvents(limit = 100): Promise<DestructionEventWithLot[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("destruction_events")
    .select("*, lot:inventory_lots(lot_code, product_name, unit)")
    .order("created_at", { ascending: false })
    .limit(limit);
  const now = Date.now();
  return (normaliseLot(data) as (DestructionEvent & WithLot)[]).map((d) => ({
    ...d,
    hold_elapsed: !d.earliest_destroy_at || new Date(d.earliest_destroy_at).getTime() <= now,
  }));
}

/**
 * Fix Phase 1.6a (G-43 req 6): the completed destructions of one Pacific
 * month, for the printable Destruction log (form 8.3 in the app, kept five
 * years, WAC 314-55-097). month = "YYYY-MM".
 */
export async function listCompletedDestructionsForMonth(
  month: string,
): Promise<(DestructionEventWithLot & { completed_by_name: string | null })[]> {
  if (!isSupabaseServiceConfigured) return [];
  const [y, m] = month.split("-").map(Number);
  const startYmd = `${y}-${String(m).padStart(2, "0")}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("destruction_events")
    .select("*, lot:inventory_lots(lot_code, product_name, unit)")
    .eq("status", "completed")
    .gte("completed_at", pacificWallTimeToUtcISO(startYmd, "start"))
    .lt("completed_at", pacificWallTimeToUtcISO(next, "start"))
    .order("completed_at", { ascending: true });
  const rows = normaliseLot(data) as (DestructionEvent & WithLot)[];
  const ids = [...new Set(rows.map((r) => r.completed_by).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: people } = await admin.from("staff_profiles").select("id, full_name, email").in("id", ids);
    for (const p of (people as { id: string; full_name: string | null; email: string | null }[] | null) ?? []) {
      names.set(p.id, p.full_name || p.email || p.id);
    }
  }
  return rows.map((r) => ({
    ...r,
    hold_elapsed: true,
    completed_by_name: r.completed_by ? (names.get(r.completed_by) ?? null) : null,
  }));
}

/**
 * Fix Phase 1.7a (G-43 req 6 per event + req 7): one destruction event with
 * its lot and the names of who scheduled, completed and cancelled it, for
 * the per-event printable record (destruction-record page).
 */
export async function getDestructionRecordForPrint(id: string): Promise<
  | (DestructionEventWithLot & { created_by_name: string | null; completed_by_name: string | null; cancelled_by_name: string | null })
  | null
> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("destruction_events")
    .select("*, lot:inventory_lots(lot_code, product_name, unit)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const r = normaliseLot([data])[0] as unknown as DestructionEvent & WithLot;
  const ids = [r.created_by, r.completed_by, r.cancelled_by].filter((v): v is string => !!v);
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: people } = await admin.from("staff_profiles").select("id, full_name, email").in("id", [...new Set(ids)]);
    for (const p of (people as { id: string; full_name: string | null; email: string | null }[] | null) ?? []) {
      names.set(p.id, p.full_name || p.email || p.id);
    }
  }
  const nameOf = (v: string | null | undefined) => (v ? (names.get(v) ?? null) : null);
  return {
    ...r,
    hold_elapsed: !r.earliest_destroy_at || new Date(r.earliest_destroy_at).getTime() <= Date.now(),
    created_by_name: nameOf(r.created_by),
    completed_by_name: nameOf(r.completed_by),
    cancelled_by_name: nameOf(r.cancelled_by),
  };
}

export async function getDestructionEvent(id: string): Promise<DestructionEvent | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("destruction_events").select("*").eq("id", id).maybeSingle();
  return (data as DestructionEvent | null) ?? null;
}

/** The other OPEN destruction events on a lot (oldest first), for the G-28 status rules. */
async function openEventsForLot(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  lotId: string,
  excludeId: string | null,
): Promise<DestructionEvent[]> {
  const { data } = await admin
    .from("destruction_events")
    .select("*")
    .eq("lot_id", lotId)
    .in("status", [...OPEN_DESTRUCTION_STATUSES])
    .order("created_at", { ascending: true });
  return ((data as DestructionEvent[] | null) ?? []).filter((e) => e.id !== excludeId);
}

/** Did this event move the lot? New events say so; a legacy (pre-0307) event is assumed to have. */
function eventTouchedLot(e: DestructionEvent): boolean {
  return e.lot_status_touched !== false;
}

/**
 * Fix Phase 1.3 (G-28): when an event closes without emptying the lot (an
 * owner cancel, or a partial completion), put the lot back to the status it
 * had before scheduling. The ONLY write is Quarantine -> Active, compare-and-
 * set on Quarantine, and only for a lot that was Active (go-live checked) when
 * it was scheduled (lotStatusAfterEventCloses). A Recalled lot, a lot someone
 * changed since, or a customer-return event is never touched.
 */
async function restoreLotAfterEventCloses(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  event: DestructionEvent,
  actorId: string | null,
): Promise<{ action: LotCloseAction; lotBefore: string | null; lotAfter: string | null; message: string }> {
  const { data: lotRow } = await admin.from("inventory_lots").select("status").eq("id", event.lot_id).maybeSingle();
  const lotBefore = (lotRow as { status: string } | null)?.status ?? null;
  const others = (await openEventsForLot(admin, event.lot_id, event.id)).filter(eventTouchedLot);
  const action = lotStatusAfterEventCloses({
    previousLotStatus: event.previous_lot_status ?? null,
    touchedLot: eventTouchedLot(event),
    lotStatus: lotBefore,
    otherOpenEvents: others.length,
  });
  let lotAfter = lotBefore;
  let final: LotCloseAction = action;
  if (action.action === "restore_active") {
    const { data: moved } = await admin
      .from("inventory_lots")
      .update({ status: "active", updated_by: actorId })
      .eq("id", event.lot_id)
      .eq("status", "quarantine")
      .select("id");
    if (Array.isArray(moved) && moved.length > 0) lotAfter = "active";
    else final = { action: "leave", why: "changed_since" };
  }
  return { action: final, lotBefore, lotAfter, message: lotCloseMessage(final) };
}

/**
 * Schedule a destruction: opens the store-policy hold (configurable in
 * disposition_settings; the old 72h WSLCB notice was removed from current
 * rule — see compliance doc §5.1). Does NOT reduce on-hand yet (the
 * product is quarantined internally, not destroyed). Quantity is validated
 * against on-hand at completion time.
 *
 * Fix Phase 1.3 (G-28; D65): only Active and Quarantine lots may be scheduled
 * and never with reason Recall (Recalled product goes back to the vendor).
 * The event stores the lot's status before scheduling; only an Active lot is
 * moved to Quarantine (compare-and-set on Active), a Quarantine lot stays.
 */
export async function scheduleDestruction(
  input: {
    lotId: string;
    quantity: number;
    reason: string;
    detail?: string | null;
    /**
     * Move the whole LOT to internal quarantine status (default true). A
     * customer-return destruction of a single returned unit passes false so
     * the rest of the lot stays sellable — the returned unit is physically
     * segregated on the shop floor instead. Such an event never touches the
     * lot status, now or on cancel (F-15-9).
     */
    quarantineLot?: boolean;
  },
  actorId: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  if (!(input.quantity > 0)) return { ok: false, error: "Quantity must be greater than zero." };
  const admin = createSupabaseAdminClient();
  const touchesLot = input.quarantineLot !== false;

  let lotStatus: string | null = null;
  let openEventPrevious: string | null = null;
  let qtyCheck: ReturnType<typeof evaluateScheduleQuantity> = { ok: true };
  if (touchesLot) {
    let lotRead = await admin
      .from("inventory_lots")
      .select("status, on_hand_qty, held_qty")
      .eq("id", input.lotId)
      .maybeSingle();
    if (lotRead.error && isMissingHeldQtyColumnError(lotRead.error)) {
      // Before migration 0308 nothing is held: on hand is the free figure.
      lotRead = await admin.from("inventory_lots").select("status, on_hand_qty").eq("id", input.lotId).maybeSingle();
    }
    const lotRow = lotRead.data as { status: string; on_hand_qty: number; held_qty?: number } | null;
    lotStatus = lotRow?.status ?? null;
    const open = await openEventsForLot(admin, input.lotId, null);
    const earlier = open.find((e) => eventTouchedLot(e) && e.previous_lot_status != null);
    openEventPrevious = earlier?.previous_lot_status ?? null;
    // Fix Phase 1.6a (G-43 req 4, F-15-12): refuse more than the lot has free
    // (on hand less held units less what open destructions already claim).
    qtyCheck = evaluateScheduleQuantity({
      quantity: input.quantity,
      onHand: lotRow?.on_hand_qty ?? 0,
      held: lotRow?.held_qty ?? 0,
      openEvents: open,
    });
  }
  const decision = evaluateDestructionSchedule({ reason: input.reason, touchesLot, lotStatus, openEventPrevious });
  if (!decision.ok) return { ok: false, error: decision.message };
  if (!qtyCheck.ok) return { ok: false, error: qtyCheck.message };

  const settings = await getDispositionSettings();
  const now = new Date();
  const earliest = new Date(computeEarliestDestroyAt(now.toISOString(), settings.holdHours));

  // Move an ACTIVE lot into quarantine for clear shop-floor signalling.
  // Compare-and-set: if the lot changed since we read it, nothing is written.
  if (decision.setQuarantine) {
    const { data: moved } = await admin
      .from("inventory_lots")
      .update({ status: "quarantine", updated_by: actorId })
      .eq("id", input.lotId)
      .eq("status", "active")
      .select("id");
    if (!Array.isArray(moved) || moved.length === 0) {
      return { ok: false, error: "The lot's status changed while you were scheduling. Nothing was scheduled; reload and try again." };
    }
  }

  const baseRow = {
    lot_id: input.lotId,
    quantity: input.quantity,
    reason: input.reason,
    detail: input.detail ?? null,
    status: "pending_quarantine",
    quarantine_start: now.toISOString(),
    earliest_destroy_at: earliest.toISOString(),
    created_by: actorId,
  };
  let { data, error } = await admin
    .from("destruction_events")
    .insert({ ...baseRow, previous_lot_status: decision.previousLotStatus, lot_status_touched: touchesLot })
    .select("id")
    .single();
  if (error && isMissingSchemaError(error.message)) {
    // Migration 0307 not applied yet: schedule without the remembered status.
    // A later Cancel then leaves the lot as it is (safe) instead of guessing.
    ({ data, error } = await admin.from("destruction_events").insert(baseRow).select("id").single());
  }
  if (error || !data) {
    if (decision.setQuarantine) {
      // Undo our own Quarantine move (compare-and-set on Quarantine).
      await admin
        .from("inventory_lots")
        .update({ status: "active", updated_by: actorId })
        .eq("id", input.lotId)
        .eq("status", "quarantine");
    }
    return { ok: false, error: error?.message ?? "Could not schedule destruction." };
  }
  return { ok: true, id: (data as { id: string }).id };
}

/**
 * Complete a destruction after the hold window. Enforces the Task Q guardrails
 * (recall LCB-coordination prohibition per WAC 314-55-225; rendering-unusable
 * method + ≥50% mix and final-destination records per current WAC 314-55-097),
 * posts a reducing 'destruction' adjustment (CCRS → Destruction), records the
 * full waste record, and (if the lot is fully depleted) marks the lot
 * destroyed.
 */
export async function completeDestruction(
  input: {
    id: string;
    /** Legacy free-text method (kept for compatibility with old callers). */
    method?: string | null;
    witnessedBy?: string | null;
    renderingMethod?: string | null;
    mixMaterial?: string | null;
    fiftyPercentAttested?: boolean;
    finalDestination?: string | null;
    disposalFacility?: string | null;
    lcbCoordinated?: boolean;
    lcbOfficer?: string | null;
    lcbContactDate?: string | null;
    /**
     * Fix Phase 1.6a (G-43; D64): the hardened record, already checked by
     * evaluateDestructionRecord in completeDestructionAction. Kept in the
     * migration 0310 columns; before 0310 the witness line carries them.
     */
    record?: {
      witnessEmployeeId: string;
      witnessName: string;
      cameraName: string;
      cameraStartAt: string;
      cameraEndAt: string;
      otherApprovalRef: string | null;
      otherApprovalDate: string | null;
    };
  },
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();

  const event = await getDestructionEvent(input.id);
  if (!event) return { ok: false, error: "Destruction event not found." };
  if (event.status === "completed") return { ok: false, error: "Already completed." };
  if (event.status === "cancelled") return { ok: false, error: "This event was cancelled." };

  const verdict = validateDestructionCompletion({
    reason: event.reason,
    renderingMethod: input.renderingMethod ?? "",
    mixMaterial: input.mixMaterial ?? null,
    fiftyPercentAttested: input.fiftyPercentAttested === true,
    witnessedBy: input.witnessedBy ?? null,
    finalDestination: input.finalDestination ?? null,
    disposalFacility: input.disposalFacility ?? null,
    lcbCoordinated: input.lcbCoordinated === true,
    lcbOfficer: input.lcbOfficer ?? null,
    earliestDestroyAt: event.earliest_destroy_at,
    nowMs: Date.now(),
  });
  if (!verdict.ok) return verdict;

  // Fix Phase 1.3 (G-28; D65): never destroy a lot that is Recalled now,
  // whatever the event's reason (it goes back to the vendor).
  const { data: lotNow } = await admin.from("inventory_lots").select("status").eq("id", event.lot_id).maybeSingle();
  const recallRefusal = completionLotRefusal((lotNow as { status: string } | null)?.status ?? null);
  if (recallRefusal) return { ok: false, error: recallRefusal };

  const note = buildDestructionAdjustmentNote({
    reason: event.reason,
    detail: event.detail,
    renderingMethod: input.renderingMethod ?? "",
    mixMaterial: input.mixMaterial ?? null,
    finalDestination: input.finalDestination ?? null,
    disposalFacility: input.disposalFacility ?? null,
  });

  // Fix Phase 1.4 (G-44): a customer-return Destroy event destroys exactly the
  // units held for it (on hand and held come down together).
  const heldReserved = toHeldNumber(event.held_qty_reserved);
  const posted =
    heldReserved > 0
      ? await postHeldReduction(event.lot_id, event.quantity, "destruction", note, actorId)
      : await postReduction(event.lot_id, event.quantity, "destruction", note, actorId);
  if (!posted.ok) return posted;

  const basePatch = {
    status: "completed",
    method: input.method?.trim() || note,
    witnessed_by: input.witnessedBy ?? null,
    completed_at: new Date().toISOString(),
    completed_by: actorId,
    adjustment_id: posted.adjustmentId,
  };
  // Waste-record columns exist after migration 0115; degrade gracefully before.
  const wastePatch = {
    ...basePatch,
    rendering_method: input.renderingMethod ?? null,
    mix_material: input.mixMaterial ?? null,
    final_destination: input.finalDestination ?? null,
    disposal_facility: input.disposalFacility ?? null,
    lcb_coordinated: input.lcbCoordinated === true,
    lcb_officer: input.lcbOfficer ?? null,
    lcb_contact_date: input.lcbContactDate ?? null,
  };
  // Fix Phase 1.6a (G-43): the record columns (migration 0310). Before 0310
  // the witness line (witnessed_by) still names the witness and the camera.
  const recordPatch = input.record
    ? {
        witness_employee_id: input.record.witnessEmployeeId,
        witness_name: input.record.witnessName,
        camera_name: input.record.cameraName,
        camera_start_at: input.record.cameraStartAt,
        camera_end_at: input.record.cameraEndAt,
        other_method_approval_ref: input.record.otherApprovalRef,
        other_method_approval_date: input.record.otherApprovalDate,
      }
    : {};
  let { error } = await admin
    .from("destruction_events")
    .update({ ...wastePatch, ...recordPatch })
    .eq("id", input.id);
  if (error && input.record && isMissingSchemaError(error.message)) {
    ({ error } = await admin.from("destruction_events").update(wastePatch).eq("id", input.id));
  }
  if (error) {
    if (isMissingSchemaError(error.message)) {
      const { error: legacyErr } = await admin
        .from("destruction_events")
        .update(basePatch)
        .eq("id", input.id);
      if (legacyErr) return { ok: false, error: legacyErr.message };
    } else {
      return { ok: false, error: error.message };
    }
  }

  // If the lot is now empty, mark it destroyed.
  const { data: lot } = await admin
    .from("inventory_lots")
    .select("on_hand_qty")
    .eq("id", event.lot_id)
    .maybeSingle();
  if (lot && Number((lot as { on_hand_qty: number }).on_hand_qty) <= 0) {
    await admin.from("inventory_lots").update({ status: "destroyed", updated_by: actorId }).eq("id", event.lot_id);
  } else if (lot) {
    // Fix Phase 1.3 (G-28 req 7, F-15-11): a PARTIAL destruction puts the rest
    // of the lot back to the status it had before scheduling (Active only if
    // it was Active and nothing else holds it; otherwise it is left alone).
    await restoreLotAfterEventCloses(admin, event, actorId);
  }

  return { ok: true };
}

/**
 * Fix Phase 1.3 (G-28 req 3 + 6; F-05a-19, F-15-9): cancel a scheduled
 * destruction. The caller (cancelDestructionAction) has already run
 * evaluateDestructionCancel: the owner only, with a written reason. The event
 * is closed compare-and-set on an open status, the reason and who/when are
 * kept on it (migration 0307; pre-migration they live in the audit row), and
 * the lot goes back to the status it had before scheduling — never
 * blindly Active (restoreLotAfterEventCloses).
 */
export async function cancelDestruction(
  id: string,
  actorId: string | null,
  reason: string,
): Promise<
  | {
      ok: true;
      lotId: string;
      lotBefore: string | null;
      lotAfter: string | null;
      previousLotStatus: string | null;
      lotMessage: string;
      lotAction: LotCloseAction;
      heldReleased: number;
      heldMessage: string | null;
    }
  | { ok: false; error: string }
> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const event = await getDestructionEvent(id);
  if (!event) return { ok: false, error: "Destruction event not found." };
  if (event.status === "completed") return { ok: false, error: "Completed events cannot be cancelled." };
  if (event.status === "cancelled") return { ok: false, error: "This event was already cancelled." };

  const nowIso = new Date().toISOString();
  let { data: closed, error } = await admin
    .from("destruction_events")
    .update({ status: "cancelled", cancel_reason: reason, cancelled_by: actorId, cancelled_at: nowIso })
    .eq("id", id)
    .in("status", [...OPEN_DESTRUCTION_STATUSES])
    .select("id");
  if (error && isMissingSchemaError(error.message)) {
    ({ data: closed, error } = await admin
      .from("destruction_events")
      .update({ status: "cancelled" })
      .eq("id", id)
      .in("status", [...OPEN_DESTRUCTION_STATUSES])
      .select("id"));
  }
  if (error) return { ok: false, error: error.message };
  if (!Array.isArray(closed) || closed.length === 0) {
    return { ok: false, error: "This event was completed or cancelled by someone else just now. Nothing was changed." };
  }

  const restored = await restoreLotAfterEventCloses(admin, event, actorId);
  // Fix Phase 1.4 (G-44): a cancelled customer-return destruction releases the
  // units it held (on hand unchanged); the page tells the owner what to do.
  const heldReserved = toHeldNumber(event.held_qty_reserved);
  let heldReleased = 0;
  if (heldReserved > 0) {
    const { error: relErr } = await admin.rpc(RELEASE_LOT_HOLD_RPC, { p_lot_id: event.lot_id, p_qty: heldReserved, p_actor: actorId });
    if (!relErr) {
      heldReleased = heldReserved;
      // The released units are sellable again, so they go back on the menu.
      await syncLotMenuStock(admin, event.lot_id, heldReserved);
    }
    else console.error(`[disposition] could not release ${heldReserved} held unit(s) on lot ${event.lot_id}: ${relErr.message}`);
  }
  return {
    ok: true,
    heldReleased,
    heldMessage: heldReleased > 0 ? heldReleaseMessage(heldReleased) : null,
    lotId: event.lot_id,
    lotBefore: restored.lotBefore,
    lotAfter: restored.lotAfter,
    previousLotStatus: event.previous_lot_status ?? null,
    lotMessage: restored.message,
    lotAction: restored.action,
  };
}

export type DispositionSummary = {
  returnsLast30: number;
  customerReturnsLast30: number;
  correctionsPending: number;
  destructionsPending: number;
  destructionsCompletedLast30: number;
};

export async function dispositionSummary(): Promise<DispositionSummary> {
  const empty: DispositionSummary = {
    returnsLast30: 0,
    customerReturnsLast30: 0,
    correctionsPending: 0,
    destructionsPending: 0,
    destructionsCompletedLast30: 0,
  };
  if (!isSupabaseServiceConfigured) return empty;
  const admin = createSupabaseAdminClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { count: ret } = await admin
    .from("vendor_returns")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  const { count: pend } = await admin
    .from("destruction_events")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending_quarantine", "ready"]);
  const { count: comp } = await admin
    .from("destruction_events")
    .select("id", { count: "exact", head: true })
    .eq("status", "completed")
    .gte("completed_at", since);

  // customer_returns is a Task Q table (0115) — degrade gracefully before it.
  let custRet = 0;
  let corrPending = 0;
  try {
    const { count: cr, error: e1 } = await admin
      .from("customer_returns")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since);
    if (!e1) custRet = cr ?? 0;
    const { count: cp, error: e2 } = await admin
      .from("customer_returns")
      .select("id", { count: "exact", head: true })
      .eq("correction_status", "pending");
    if (!e2) corrPending = cp ?? 0;
  } catch {
    // pre-0115
  }

  return {
    returnsLast30: ret ?? 0,
    customerReturnsLast30: custRet,
    correctionsPending: corrPending,
    destructionsPending: pend ?? 0,
    destructionsCompletedLast30: comp ?? 0,
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function normaliseLot(data: unknown): (Record<string, unknown> & WithLot)[] {
  const rows = (data as (Record<string, unknown> & { lot: unknown })[] | null) ?? [];
  return rows.map((r) => {
    const lotRel = r.lot;
    const lot = (Array.isArray(lotRel) ? lotRel[0] : lotRel) as WithLot | null;
    return {
      ...r,
      lot_code: lot?.lot_code ?? null,
      product_name: lot?.product_name ?? null,
      unit: lot?.unit ?? null,
    };
  });
}
