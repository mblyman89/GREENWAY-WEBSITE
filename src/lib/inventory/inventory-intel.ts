/**
 * src/lib/inventory/inventory-intel.ts  (Task L)
 *
 * Server-side loaders that feed REAL lot + adjustment + cycle-count data into
 * the pure inventory-intelligence core (inventory-intel-core.ts). Staff-only
 * via the service-role client behind RLS. Never guesses: every figure comes
 * from inventory_lots, inventory_adjustments, and cycle_count_lines rows.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  buildCommandCenter,
  fefoRank,
  reviewVariances,
  type CommandCenter,
  type IntelAdjustment,
  type IntelLot,
  type ReviewLine,
  type VarianceReview,
} from "@/lib/inventory/inventory-intel-core";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type LotRow = {
  id: string;
  product_name: string | null;
  category: string | null;
  status: string;
  is_medical: boolean | null;
  on_hand_qty: number | null;
  received_qty: number | null;
  unit_cost_minor_units: number | null;
  expires_on: string | null;
  created_at: string | null;
};

/** Load all lots mapped to the pure core's IntelLot shape, including each
 * lot's most recent counted timestamp from cycle_count_lines. */
export async function loadIntelLots(): Promise<IntelLot[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("inventory_lots")
    .select(
      "id, product_name, category, status, is_medical, on_hand_qty, received_qty, unit_cost_minor_units, expires_on, created_at",
    )
    .limit(5000);
  const rows = (data as LotRow[] | null) ?? [];
  if (rows.length === 0) return [];

  // Most recent time each lot was physically counted (counted_qty recorded).
  const { data: counted } = await admin
    .from("cycle_count_lines")
    .select("lot_id, updated_at")
    .not("counted_qty", "is", null)
    .order("updated_at", { ascending: false })
    .limit(5000);
  const lastCounted = new Map<string, string>();
  for (const c of (counted as { lot_id: string; updated_at: string }[] | null) ?? []) {
    if (!lastCounted.has(c.lot_id)) lastCounted.set(c.lot_id, c.updated_at);
  }

  return rows.map((r) => ({
    id: r.id,
    productName: r.product_name,
    category: r.category,
    status: r.status,
    isMedical: Boolean(r.is_medical),
    onHandQty: Number(r.on_hand_qty ?? 0),
    receivedQty: Number(r.received_qty ?? 0),
    unitCostMinor: r.unit_cost_minor_units,
    expiresOn: r.expires_on,
    receivedAt: r.created_at,
    lastCountedAt: lastCounted.get(r.id) ?? null,
  }));
}

/** Documented reductions over the trailing N days (default 30). */
export async function loadIntelAdjustments(days = 30): Promise<IntelAdjustment[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("inventory_adjustments")
    .select("lot_id, qty_delta, reason")
    .gte("created_at", since)
    .limit(5000);
  return (
    (data as { lot_id: string; qty_delta: number; reason: string }[] | null) ?? []
  ).map((a) => ({ lotId: a.lot_id, qtyDelta: Number(a.qty_delta) || 0, reason: a.reason }));
}

export type CommandCenterData = {
  center: CommandCenter;
  /** Sell-first (FEFO) shortlist: active lots with stock, expired/soonest first. */
  sellFirst: IntelLot[];
  lots: IntelLot[];
};

/** One-call composition for the inventory command center. */
export async function getInventoryCommandCenter(sellFirstLimit = 8): Promise<CommandCenterData> {
  const [lots, adjustments] = await Promise.all([loadIntelLots(), loadIntelAdjustments(30)]);
  const center = buildCommandCenter(lots, adjustments, todayIso());
  const sellable = lots.filter((l) => l.status === "active" && l.onHandQty > 0);
  // Sell-first shortlist: only lots that actually have a deadline (an expiry
  // date) lead the list; the FEFO comparator handles the ordering.
  const sellFirst = fefoRank(sellable)
    .filter((l) => l.expiresOn != null)
    .slice(0, sellFirstLimit);
  return { center, sellFirst, lots };
}

/** Variance review (accuracy, dollar impact at cost, recount flags) for an
 * open cycle-count session — shown BEFORE the operator applies variances. */
export async function getCycleCountVarianceReview(countId: string): Promise<VarianceReview | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("cycle_count_lines")
    .select("id, system_qty, counted_qty, lot:inventory_lots(product_name, unit_cost_minor_units)")
    .eq("count_id", countId);
  const rows =
    (data as unknown as {
      id: string;
      system_qty: number;
      counted_qty: number | null;
      lot: unknown;
    }[] | null) ?? [];
  if (rows.length === 0) return null;
  const lines: ReviewLine[] = rows.map((r) => {
    const rel = r.lot;
    const lot = (Array.isArray(rel) ? rel[0] : rel) as
      | { product_name: string | null; unit_cost_minor_units: number | null }
      | null;
    return {
      lineId: r.id,
      productName: lot?.product_name ?? null,
      systemQty: Number(r.system_qty) || 0,
      countedQty: r.counted_qty == null ? null : Number(r.counted_qty),
      unitCostMinor: lot?.unit_cost_minor_units ?? null,
    };
  });
  return reviewVariances(lines);
}
