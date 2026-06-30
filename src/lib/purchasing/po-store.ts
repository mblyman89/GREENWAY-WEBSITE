/**
 * src/lib/purchasing/po-store.ts
 *
 * Server-side store for the AI-baked Purchase Order builder (Slice 38).
 * Re-exports the pure po-core math and adds Supabase-backed data access:
 *
 *   - reorder settings (singleton planning parameters)
 *   - reorder suggestions: aggregate inventory_lots (on-hand, cost, vendor) and
 *     sales velocity (order_lines over the window) → computeReorder per product
 *   - purchase order CRUD, status transitions, and receiving against lines
 *
 * All grounded in the actual schema (migrations 0023 lots, 0007 order_lines,
 * 0003 vendors, 0048 purchase orders). Best-effort: returns empty/null when
 * Supabase service role is not configured.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  computeReorder,
  passesFilter,
  poSubtotalMinor,
  lineTotalMinor,
  makePoNumber,
  type PoFilter,
  type CandidateRow,
  type ReorderResult,
} from "@/lib/purchasing/po-core";

export * from "@/lib/purchasing/po-core";

export type ReorderSettings = {
  id: number;
  velocity_window_days: number;
  default_lead_time_days: number;
  target_days_of_supply: number;
  default_safety_days: number;
  created_at: string;
  updated_at: string;
};

export type PurchaseOrderStatus =
  | "draft"
  | "submitted"
  | "sent"
  | "partial"
  | "received"
  | "cancelled";

export type PurchaseOrder = {
  id: string;
  po_number: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  vendor_email: string | null;
  status: PurchaseOrderStatus;
  lead_time_days: number | null;
  target_days_supply: number | null;
  note: string | null;
  internal_note: string | null;
  expected_date: string | null;
  subtotal_minor_units: number;
  line_count: number;
  origin: "manual" | "ai_suggested";
  submitted_at: string | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PurchaseOrderLine = {
  id: string;
  purchase_order_id: string;
  pos_product_key: string | null;
  product_name: string;
  brand: string | null;
  category: string | null;
  on_hand_qty: number;
  avg_daily_sales: number;
  reorder_point: number | null;
  order_qty: number;
  unit: string;
  unit_cost_minor_units: number;
  line_total_minor_units: number;
  received_qty: number;
  note: string | null;
};

export type PurchaseOrderWithLines = PurchaseOrder & { lines: PurchaseOrderLine[] };

// ---------------------------------------------------------------------------
// Reorder settings
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS: ReorderSettings = {
  id: 1,
  velocity_window_days: 30,
  default_lead_time_days: 7,
  target_days_of_supply: 21,
  default_safety_days: 7,
  created_at: "",
  updated_at: "",
};

export async function getReorderSettings(): Promise<ReorderSettings> {
  if (!isSupabaseServiceConfigured) return DEFAULT_SETTINGS;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("reorder_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  return (data as ReorderSettings) ?? DEFAULT_SETTINGS;
}

export async function updateReorderSettings(
  patch: Partial<Pick<ReorderSettings, "velocity_window_days" | "default_lead_time_days" | "target_days_of_supply" | "default_safety_days">>,
): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin.from("reorder_settings").upsert({ id: 1, ...patch }, { onConflict: "id" });
}

// ---------------------------------------------------------------------------
// Reorder suggestions
// ---------------------------------------------------------------------------
export type ReorderSuggestion = CandidateRow & {
  onHand: number;
  unitCostMinor: number;
  unit: string;
  result: ReorderResult;
};

/**
 * Aggregate active inventory lots into one row per pos_product_key, summing
 * on-hand and taking the latest known unit cost / vendor, then estimate sales
 * velocity from order_lines over the window, and compute reorder math.
 *
 * Returns suggestions that pass the filter, sorted by urgency (most below the
 * reorder point first). `onlyNeeded` keeps only rows with a suggested qty > 0.
 */
export async function buildReorderSuggestions(opts: {
  filter?: PoFilter;
  onlyNeeded?: boolean;
}): Promise<ReorderSuggestion[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const settings = await getReorderSettings();

  // 1) On-hand + cost + vendor by product, from active lots.
  const { data: lots } = await admin
    .from("inventory_lots")
    .select("pos_product_key, product_name, vendor_id, brand_id, on_hand_qty, unit, unit_cost_minor_units, status")
    .eq("status", "active");

  if (!lots || lots.length === 0) return [];

  // Resolve vendor + brand names.
  const vendorIds = Array.from(new Set(lots.map((l) => l.vendor_id).filter(Boolean))) as string[];
  const brandIds = Array.from(new Set(lots.map((l) => l.brand_id).filter(Boolean))) as string[];
  const vendorNames = new Map<string, string>();
  const brandNames = new Map<string, string>();
  if (vendorIds.length) {
    const { data: vs } = await admin.from("vendors").select("id, display_name").in("id", vendorIds);
    (vs ?? []).forEach((v) => vendorNames.set(v.id as string, v.display_name as string));
  }
  if (brandIds.length) {
    const { data: bs } = await admin.from("brands").select("id, display_name").in("id", brandIds);
    (bs ?? []).forEach((b) => brandNames.set(b.id as string, b.display_name as string));
  }

  type Agg = {
    key: string | null;
    name: string;
    vendorId: string | null;
    brandName: string | null;
    onHand: number;
    unitCostMinor: number;
    unit: string;
  };
  const byKey = new Map<string, Agg>();
  for (const l of lots) {
    const key = (l.pos_product_key as string | null) ?? `name:${l.product_name}`;
    const existing = byKey.get(key);
    const onHand = Number(l.on_hand_qty ?? 0);
    if (existing) {
      existing.onHand += onHand;
      if (l.unit_cost_minor_units != null) existing.unitCostMinor = Number(l.unit_cost_minor_units);
    } else {
      byKey.set(key, {
        key: l.pos_product_key as string | null,
        name: (l.product_name as string) ?? "Unknown",
        vendorId: (l.vendor_id as string | null) ?? null,
        brandName: l.brand_id ? brandNames.get(l.brand_id as string) ?? null : null,
        onHand,
        unitCostMinor: l.unit_cost_minor_units != null ? Number(l.unit_cost_minor_units) : 0,
        unit: (l.unit as string) ?? "each",
      });
    }
  }

  // 2) Sales velocity per product over the window (order_lines.product_id maps
  //    to pos_product_key snapshot). Sum quantity within the window.
  const since = new Date(Date.now() - settings.velocity_window_days * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentOrders } = await admin
    .from("orders")
    .select("id")
    .gte("placed_at", since);
  const orderIds = (recentOrders ?? []).map((o) => o.id as string);
  const soldByKey = new Map<string, number>();
  if (orderIds.length) {
    const { data: ols } = await admin
      .from("order_lines")
      .select("product_id, quantity")
      .in("order_id", orderIds);
    for (const ol of ols ?? []) {
      const k = (ol.product_id as string | null) ?? "";
      if (!k) continue;
      soldByKey.set(k, (soldByKey.get(k) ?? 0) + Number(ol.quantity ?? 0));
    }
  }

  // 3) Compute reorder math + apply filter.
  const filter = opts.filter ?? {};
  const out: ReorderSuggestion[] = [];
  for (const agg of byKey.values()) {
    const candidate: CandidateRow = {
      posProductKey: agg.key,
      productName: agg.name,
      brand: agg.brandName,
      category: null,
      vendorId: agg.vendorId,
      vendorName: agg.vendorId ? vendorNames.get(agg.vendorId) ?? null : null,
    };
    if (!passesFilter(candidate, filter)) continue;

    const unitsSold = agg.key ? soldByKey.get(agg.key) ?? 0 : 0;
    const result = computeReorder({
      onHand: agg.onHand,
      velocity: { unitsSold, windowDays: settings.velocity_window_days },
      leadDays: settings.default_lead_time_days,
      targetDaysOfSupply: settings.target_days_of_supply,
      fallbackSafetyDays: settings.default_safety_days,
    });
    if (opts.onlyNeeded && result.suggestedQty <= 0) continue;
    out.push({
      ...candidate,
      onHand: agg.onHand,
      unitCostMinor: agg.unitCostMinor,
      unit: agg.unit,
      result,
    });
  }

  // Sort: below reorder point first, then by fewest days of supply left.
  out.sort((a, b) => {
    if (a.result.belowReorderPoint !== b.result.belowReorderPoint) {
      return a.result.belowReorderPoint ? -1 : 1;
    }
    return a.result.daysOfSupplyLeft - b.result.daysOfSupplyLeft;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Purchase order CRUD
// ---------------------------------------------------------------------------
export async function listPurchaseOrders(opts?: { status?: PurchaseOrderStatus }): Promise<PurchaseOrder[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin.from("purchase_orders").select("*").order("created_at", { ascending: false });
  if (opts?.status) q = q.eq("status", opts.status);
  const { data } = await q;
  return (data as PurchaseOrder[]) ?? [];
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderWithLines | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data: po } = await admin.from("purchase_orders").select("*").eq("id", id).maybeSingle();
  if (!po) return null;
  const { data: lines } = await admin
    .from("purchase_order_lines")
    .select("*")
    .eq("purchase_order_id", id)
    .order("created_at", { ascending: true });
  return { ...(po as PurchaseOrder), lines: (lines as PurchaseOrderLine[]) ?? [] };
}

async function nextPoNumber(): Promise<string> {
  if (!isSupabaseServiceConfigured) return makePoNumber(1);
  const admin = createSupabaseAdminClient();
  const { count } = await admin
    .from("purchase_orders")
    .select("id", { count: "exact", head: true });
  return makePoNumber((count ?? 0) + 1);
}

export type NewPoLine = {
  posProductKey: string | null;
  productName: string;
  brand?: string | null;
  category?: string | null;
  onHandQty?: number;
  avgDailySales?: number;
  reorderPoint?: number | null;
  orderQty: number;
  unit?: string;
  unitCostMinor: number;
  note?: string | null;
};

export async function createPurchaseOrder(input: {
  vendorId: string | null;
  vendorName: string | null;
  vendorEmail?: string | null;
  origin?: "manual" | "ai_suggested";
  leadTimeDays?: number | null;
  targetDaysSupply?: number | null;
  note?: string | null;
  internalNote?: string | null;
  expectedDate?: string | null;
  lines: NewPoLine[];
  createdBy?: string | null;
}): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const poNumber = await nextPoNumber();
  const subtotal = poSubtotalMinor(input.lines.map((l) => ({ order_qty: l.orderQty, unit_cost_minor_units: l.unitCostMinor })));

  const { data: po, error } = await admin
    .from("purchase_orders")
    .insert({
      po_number: poNumber,
      vendor_id: input.vendorId,
      vendor_name: input.vendorName,
      vendor_email: input.vendorEmail ?? null,
      status: "draft",
      origin: input.origin ?? "manual",
      lead_time_days: input.leadTimeDays ?? null,
      target_days_supply: input.targetDaysSupply ?? null,
      note: input.note ?? null,
      internal_note: input.internalNote ?? null,
      expected_date: input.expectedDate ?? null,
      subtotal_minor_units: subtotal,
      line_count: input.lines.length,
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error || !po) return null;
  const poId = (po as { id: string }).id;

  if (input.lines.length) {
    const rows = input.lines.map((l) => ({
      purchase_order_id: poId,
      pos_product_key: l.posProductKey,
      product_name: l.productName,
      brand: l.brand ?? null,
      category: l.category ?? null,
      on_hand_qty: l.onHandQty ?? 0,
      avg_daily_sales: l.avgDailySales ?? 0,
      reorder_point: l.reorderPoint ?? null,
      order_qty: l.orderQty,
      unit: l.unit ?? "each",
      unit_cost_minor_units: l.unitCostMinor,
      line_total_minor_units: lineTotalMinor(l.orderQty, l.unitCostMinor),
      note: l.note ?? null,
    }));
    await admin.from("purchase_order_lines").insert(rows);
  }
  return poId;
}

export async function setPurchaseOrderStatus(id: string, status: PurchaseOrderStatus): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = { status };
  const now = new Date().toISOString();
  if (status === "submitted") patch.submitted_at = now;
  if (status === "sent") patch.sent_at = now;
  if (status === "received") patch.received_at = now;
  await admin.from("purchase_orders").update(patch).eq("id", id);
}

/** Receive a quantity against a PO line; bumps PO to partial/received. */
export async function receivePoLine(lineId: string, receivedQty: number): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  const { data: line } = await admin
    .from("purchase_order_lines")
    .select("id, purchase_order_id, order_qty, received_qty")
    .eq("id", lineId)
    .maybeSingle();
  if (!line) return;
  const newReceived = Number(line.received_qty ?? 0) + receivedQty;
  await admin.from("purchase_order_lines").update({ received_qty: newReceived }).eq("id", lineId);

  // Recompute PO status from all lines.
  const poId = line.purchase_order_id as string;
  const { data: lines } = await admin
    .from("purchase_order_lines")
    .select("order_qty, received_qty")
    .eq("purchase_order_id", poId);
  const all = lines ?? [];
  const fullyReceived = all.every((l) => Number(l.received_qty ?? 0) >= Number(l.order_qty ?? 0));
  const anyReceived = all.some((l) => Number(l.received_qty ?? 0) > 0);
  await setPurchaseOrderStatus(poId, fullyReceived ? "received" : anyReceived ? "partial" : "sent");
}

export async function deletePurchaseOrder(id: string): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin.from("purchase_orders").delete().eq("id", id);
}
