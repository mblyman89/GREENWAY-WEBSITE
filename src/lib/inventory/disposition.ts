/**
 * src/lib/inventory/disposition.ts  (Run 6 / Slice 31 → Task Q command center)
 *
 * Server-side helpers for customer returns, vendor returns, destruction
 * events, and disposition/sample settings. Every quantity change posts a
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
import {
  DEFAULT_SAMPLE_SETTINGS,
  type SampleSettings,
} from "@/lib/inventory/sample-guardrails";
import {
  HOLD_HOURS_DEFAULT,
  clampHoldHours,
  computeEarliestDestroyAt,
  validateCustomerReturn,
  buildCustomerReturnAdjustmentNote,
  validateDestructionCompletion,
  buildDestructionAdjustmentNote,
  type CustomerReturnDisposition,
} from "@/lib/inventory/disposition-core";
import { pacificDayKey } from "@/lib/reports/timezone";
import { getTaxSettings, getCannabisCategorySet, isCannabisCategory, applyBps } from "@/lib/reports/tax";
import { preTaxLineBaseMinor, preTaxUnitMinor } from "@/lib/reports/tax-base-core";
import {
  deriveInventoryExternalId,
  resolveSaleInventoryExternalId,
} from "@/lib/compliance/ccrs-identifiers";
// Mastering Slice 1: sold lines resolve the variant's own lot key first.
import { lotKeyForSaleLine } from "@/lib/pos/variant-lot-core";

/**
 * LEGACY default pre-destruction hold (hours). The old 72-hour WSLCB notice
 * was REMOVED from current rule (WSR 22-14-111; see compliance doc §5.1) — the
 * hold is now a configurable STORE POLICY in disposition_settings (default
 * still 72h). Kept exported for backwards compatibility.
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
// Sample settings
// ---------------------------------------------------------------------------

export async function getSampleSettings(): Promise<SampleSettings> {
  if (!isSupabaseServiceConfigured) return DEFAULT_SAMPLE_SETTINGS;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sample_settings")
    .select("nominal_price_minor, require_nominal_price, block_public_sale")
    .eq("id", true)
    .maybeSingle();
  if (!data) return DEFAULT_SAMPLE_SETTINGS;
  return {
    nominalPriceMinor: (data as { nominal_price_minor: number }).nominal_price_minor ?? 1,
    requireNominalPrice: (data as { require_nominal_price: boolean }).require_nominal_price ?? true,
    blockPublicSale: (data as { block_public_sale: boolean }).block_public_sale ?? true,
  };
}

export async function updateSampleSettings(
  input: SampleSettings,
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("sample_settings").upsert({
    id: true,
    nominal_price_minor: Math.max(0, Math.round(input.nominalPriceMinor)),
    require_nominal_price: input.requireNominalPrice,
    block_public_sale: input.blockPublicSale,
    updated_by: actorId,
  });
  if (error) return { ok: false, error: error.message };
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
  const { data: lot } = await admin
    .from("inventory_lots")
    .select("id, on_hand_qty")
    .eq("id", lotId)
    .maybeSingle();
  if (!lot) return { ok: false, error: "Lot not found." };

  const onHand = Number((lot as { on_hand_qty: number }).on_hand_qty) || 0;
  if (qtyMagnitude > onHand) {
    return { ok: false, error: `Quantity (${qtyMagnitude}) exceeds on-hand (${onHand}).` };
  }

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

  return { ok: true, adjustmentId: (adj as { id: string }).id };
}

// ---------------------------------------------------------------------------
// Customer returns — WAC 314-55-079(12) + CCRS FAQ (sale Delete/Update +
// adjustment "as a return, with details"). See compliance doc §2.
// ---------------------------------------------------------------------------

export type ReturnableOrderLine = {
  order_id: string;
  order_number: string;
  completed_at: string | null;
  placed_at: string;
  customer_name: string;
  line_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  price_minor_units: number;
  regular_price_minor_units: number | null;
  already_returned: number;
};

/**
 * Search COMPLETED orders (the only returnable kind) by order number /
 * customer name / phone and flatten their lines, annotated with quantities
 * already returned so the UI can prevent double-returns.
 */
export async function findReturnableOrderLines(search: string, limit = 8): Promise<ReturnableOrderLine[]> {
  if (!isSupabaseServiceConfigured) return [];
  const q = search.trim();
  if (!q) return [];
  const admin = createSupabaseAdminClient();

  const like = `%${q}%`;
  const { data: orders } = await admin
    .from("orders")
    .select("id, order_number, status, placed_at, completed_at, customer_first_name, customer_last_name")
    .eq("status", "completed")
    .or(
      [
        `order_number.ilike.${like}`,
        `customer_first_name.ilike.${like}`,
        `customer_last_name.ilike.${like}`,
        `customer_phone.ilike.${like}`,
      ].join(","),
    )
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  const orderRows =
    (orders as
      | {
          id: string;
          order_number: string;
          placed_at: string;
          completed_at: string | null;
          customer_first_name: string;
          customer_last_name: string | null;
        }[]
      | null) ?? [];
  if (orderRows.length === 0) return [];

  const orderIds = orderRows.map((o) => o.id);
  const [{ data: lines }, returnedByLine] = await Promise.all([
    admin
      .from("order_lines")
      .select("id, order_id, product_id, product_name, quantity, price_minor_units, regular_price_minor_units")
      .in("order_id", orderIds)
      .order("created_at", { ascending: true }),
    (async () => {
      const map = new Map<string, number>();
      try {
        const { data } = await admin
          .from("customer_returns")
          .select("order_line_id, quantity")
          .in("order_id", orderIds);
        for (const r of (data as { order_line_id: string | null; quantity: number }[] | null) ?? []) {
          if (!r.order_line_id) continue;
          map.set(r.order_line_id, (map.get(r.order_line_id) ?? 0) + Number(r.quantity || 0));
        }
      } catch {
        // customer_returns table missing (pre-0115) — no prior returns to count.
      }
      return map;
    })(),
  ]);

  const byOrder = new Map(orderRows.map((o) => [o.id, o]));
  const out: ReturnableOrderLine[] = [];
  for (const l of (lines as
    | {
        id: string;
        order_id: string;
        product_id: string | null;
        product_name: string;
        quantity: number;
        price_minor_units: number;
        regular_price_minor_units: number | null;
      }[]
    | null) ?? []) {
    const o = byOrder.get(l.order_id);
    if (!o) continue;
    out.push({
      order_id: l.order_id,
      order_number: o.order_number,
      completed_at: o.completed_at,
      placed_at: o.placed_at,
      customer_name: [o.customer_first_name, o.customer_last_name].filter(Boolean).join(" "),
      line_id: l.id,
      product_id: l.product_id,
      product_name: l.product_name,
      quantity: Number(l.quantity) || 0,
      price_minor_units: l.price_minor_units,
      regular_price_minor_units: l.regular_price_minor_units,
      already_returned: returnedByLine.get(l.id) ?? 0,
    });
  }
  return out;
}

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
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
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
  if (!order) return { ok: false, error: "Order not found." };
  if ((order as { status: string }).status !== "completed") {
    return { ok: false, error: "Only COMPLETED sales can be returned." };
  }
  if (!line || (line as { order_id: string }).order_id !== input.orderId) {
    return { ok: false, error: "Order line not found on this order." };
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

  // Quantity already returned on this line (double-return guard).
  let alreadyReturned = 0;
  try {
    const { data: prior } = await admin
      .from("customer_returns")
      .select("quantity")
      .eq("order_line_id", l.id);
    for (const r of (prior as { quantity: number }[] | null) ?? []) {
      alreadyReturned += Number(r.quantity) || 0;
    }
  } catch {
    // pre-0115: table missing — creation below will fail with a clear message.
  }
  const remainingReturnable = (Number(l.quantity) || 0) - alreadyReturned;

  // ── Pure validation (WAC 314-55-079(12) + quantities + money) ─────────────
  const verdict = validateCustomerReturn({
    quantity: input.quantity,
    originalQuantity: remainingReturnable,
    originalPackaging: input.originalPackaging,
    lotIdLegible: input.lotIdLegible,
    disposition: input.disposition,
    reason: input.reason,
    refundMinor: input.refundMinor,
  });
  if (!verdict.ok) return verdict;
  // Correction operation is decided against the FULL original line: only a
  // return of the whole original quantity deletes the sale row.
  const totalAfter = alreadyReturned + input.quantity;
  const correctionOperation: "Delete" | "Update" =
    totalAfter >= (Number(l.quantity) || 0) ? "Delete" : "Update";

  // ── Resolve the inventory lot (explicit pick wins; else by product key) ───
  let lotId = (input.lotId ?? "").trim() || null;
  let lotRow: { id: string; lot_code: string | null; pos_product_key: string | null } | null = null;
  if (lotId) {
    const { data } = await admin
      .from("inventory_lots")
      .select("id, lot_code, pos_product_key")
      .eq("id", lotId)
      .maybeSingle();
    lotRow = (data as typeof lotRow) ?? null;
    if (!lotRow) return { ok: false, error: "Selected lot not found." };
  } else if (lineLotKey) {
    const { data } = await admin
      .from("inventory_lots")
      .select("id, lot_code, pos_product_key, status, created_at")
      .eq("pos_product_key", lineLotKey)
      .order("created_at", { ascending: false })
      .limit(5);
    const candidates =
      (data as { id: string; lot_code: string | null; pos_product_key: string | null; status: string }[] | null) ?? [];
    lotRow = candidates.find((c) => c.status !== "quarantine") ?? candidates[0] ?? null;
    lotId = lotRow?.id ?? null;
  }
  if (!lotRow || !lotId) {
    return {
      ok: false,
      error:
        "No inventory lot matches this product — pick the lot manually so the add-back lands on the correct CCRS inventory identifier.",
    };
  }

  // ── Snapshot the CCRS Sale-row data for the correction file ───────────────
  const inventoryExternalId = resolveSaleInventoryExternalId({
    lineExplicit: l.ccrs_inventory_external_id,
    lotCanonical: deriveInventoryExternalId({
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
  const posted = await postAddition(lotId, input.quantity, "return", note, actorId);
  if (!posted.ok) return posted;

  // ── If destroying, open the destruction event for the returned quantity ───
  let destructionEventId: string | null = null;
  if (input.disposition === "destroy") {
    const scheduled = await scheduleDestruction(
      {
        lotId,
        quantity: input.quantity,
        reason: "other",
        detail: `Customer return (${input.reason.replace(/_/g, " ")}) — sale ${saleExternalId}`,
        // Only the returned unit is segregated — the rest of the lot stays sellable.
        quarantineLot: false,
      },
      actorId,
    );
    if (scheduled.ok) destructionEventId = scheduled.id;
  }

  // ── Record the return ──────────────────────────────────────────────────────
  const { data: created, error: insErr } = await admin
    .from("customer_returns")
    .insert({
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
      lot_id: lotId,
      quantity: input.quantity,
      original_quantity: qty,
      original_packaging: input.originalPackaging,
      lot_id_legible: input.lotIdLegible,
      disposition: input.disposition,
      reason: input.reason,
      detail: input.detail ?? null,
      refund_minor_units: input.refundMinor,
      correction_operation: correctionOperation,
      correction_status: "pending",
      adjustment_id: posted.adjustmentId,
      destruction_event_id: destructionEventId,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (insErr || !created) {
    if (isMissingSchemaError(insErr?.message)) {
      return {
        ok: false,
        error:
          "Apply migration 0115 first (customer_returns table missing). The inventory add-back was posted — reverse it manually if you abort.",
      };
    }
    return { ok: false, error: insErr?.message ?? "Could not save the return." };
  }
  return { ok: true, id: (created as { id: string }).id };
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

/**
 * Create a vendor return: posts a reducing 'other' adjustment (CCRS maps 'other'
 * → Other) and records the return. on-hand is reduced immediately.
 */
export async function createVendorReturn(
  input: {
    lotId: string;
    vendorId?: string | null;
    quantity: number;
    reason: string;
    detail?: string | null;
    rmaNumber?: string | null;
    manifestNumber?: string | null;
    processorLicense?: string | null;
  },
  actorId: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  if (!(input.quantity > 0)) return { ok: false, error: "Quantity must be greater than zero." };
  const admin = createSupabaseAdminClient();

  const posted = await postReduction(
    input.lotId,
    input.quantity,
    "other",
    `Vendor return (${input.reason})${input.rmaNumber ? ` RMA ${input.rmaNumber}` : ""}${
      input.manifestNumber ? ` manifest ${input.manifestNumber}` : ""
    }${input.detail ? `: ${input.detail}` : ""}`,
    actorId,
  );
  if (!posted.ok) return posted;

  const baseRow = {
    lot_id: input.lotId,
    vendor_id: input.vendorId ?? null,
    quantity: input.quantity,
    reason: input.reason,
    detail: input.detail ?? null,
    rma_number: input.rmaNumber ?? null,
    adjustment_id: posted.adjustmentId,
    created_by: actorId,
  };
  // Manifest columns exist after migration 0115 — degrade gracefully before.
  const { data, error } = await admin
    .from("vendor_returns")
    .insert({
      ...baseRow,
      manifest_number: input.manifestNumber?.trim() || null,
      manifest_status: input.rmaNumber?.trim() ? "requested" : "none",
      processor_license: input.processorLicense?.trim() || null,
    })
    .select("id")
    .single();
  if (error) {
    if (isMissingSchemaError(error.message)) {
      const { data: legacy, error: legacyErr } = await admin
        .from("vendor_returns")
        .insert(baseRow)
        .select("id")
        .single();
      if (legacyErr || !legacy) {
        return { ok: false, error: legacyErr?.message ?? "Could not save return." };
      }
      return { ok: true, id: (legacy as { id: string }).id };
    }
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: "Could not save return." };
  return { ok: true, id: (data as { id: string }).id };
}

/** Advance the CCRS-manifest workflow on a vendor return (WAC 314-55-085). */
export async function updateVendorReturnManifest(
  input: {
    id: string;
    manifestStatus: string;
    manifestNumber?: string | null;
    pickupAt?: string | null;
  },
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  void actorId;
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = { manifest_status: input.manifestStatus };
  if (input.manifestNumber !== undefined) patch.manifest_number = input.manifestNumber?.trim() || null;
  if (input.pickupAt !== undefined) patch.pickup_at = input.pickupAt || null;
  const { error } = await admin.from("vendor_returns").update(patch).eq("id", input.id);
  if (error) {
    if (isMissingSchemaError(error.message)) {
      return { ok: false, error: "Apply migration 0115 first (manifest columns missing)." };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
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

export async function getDestructionEvent(id: string): Promise<DestructionEvent | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("destruction_events").select("*").eq("id", id).maybeSingle();
  return (data as DestructionEvent | null) ?? null;
}

/**
 * Schedule a destruction: opens the store-policy hold (configurable in
 * disposition_settings; the old 72h WSLCB notice was removed from current
 * rule — see compliance doc §5.1). Does NOT reduce on-hand yet (the product
 * is quarantined internally, not destroyed). Quantity is validated against
 * on-hand at completion time.
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
     * segregated on the shop floor instead.
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

  const settings = await getDispositionSettings();
  const now = new Date();
  const earliest = new Date(computeEarliestDestroyAt(now.toISOString(), settings.holdHours));

  // Move the lot into quarantine status for clear shop-floor signalling.
  if (input.quarantineLot !== false) {
    await admin
      .from("inventory_lots")
      .update({ status: "quarantine", updated_by: actorId })
      .eq("id", input.lotId);
  }

  const { data, error } = await admin
    .from("destruction_events")
    .insert({
      lot_id: input.lotId,
      quantity: input.quantity,
      reason: input.reason,
      detail: input.detail ?? null,
      status: "pending_quarantine",
      quarantine_start: now.toISOString(),
      earliest_destroy_at: earliest.toISOString(),
      created_by: actorId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not schedule destruction." };
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

  const note = buildDestructionAdjustmentNote({
    reason: event.reason,
    detail: event.detail,
    renderingMethod: input.renderingMethod ?? "",
    mixMaterial: input.mixMaterial ?? null,
    finalDestination: input.finalDestination ?? null,
    disposalFacility: input.disposalFacility ?? null,
  });

  const posted = await postReduction(event.lot_id, event.quantity, "destruction", note, actorId);
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
  const { error } = await admin
    .from("destruction_events")
    .update({
      ...basePatch,
      rendering_method: input.renderingMethod ?? null,
      mix_material: input.mixMaterial ?? null,
      final_destination: input.finalDestination ?? null,
      disposal_facility: input.disposalFacility ?? null,
      lcb_coordinated: input.lcbCoordinated === true,
      lcb_officer: input.lcbOfficer ?? null,
      lcb_contact_date: input.lcbContactDate ?? null,
    })
    .eq("id", input.id);
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
  }

  return { ok: true };
}

export async function cancelDestruction(
  id: string,
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const event = await getDestructionEvent(id);
  if (!event) return { ok: false, error: "Destruction event not found." };
  if (event.status === "completed") return { ok: false, error: "Completed events cannot be cancelled." };

  await admin.from("destruction_events").update({ status: "cancelled" }).eq("id", id);
  // Release quarantine back to active (best effort).
  await admin.from("inventory_lots").update({ status: "active", updated_by: actorId }).eq("id", event.lot_id);
  return { ok: true };
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
