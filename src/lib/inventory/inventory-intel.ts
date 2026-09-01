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
import { pagedAll } from "@/lib/supabase/chunked-in";
import { pacificToday } from "@/lib/reports/timezone";
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

/**
 * Today on the STORE's calendar (Rule 8). Was `new Date().toISOString()`,
 * i.e. UTC — which is already tomorrow in Port Orchard from ~4–5pm onward, so
 * the command center's expiry/aging buckets shifted by a day every evening.
 */
function todayIso(): string {
  return pacificToday();
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
  /** SLICE 2 (migration 0214) — true receipt day; NULL means unknown. */
  received_on: string | null;
};

/** Load all lots mapped to the pure core's IntelLot shape, including each
 * lot's most recent counted timestamp from cycle_count_lines. */
export async function loadIntelLots(): Promise<IntelLot[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();

  // SLICE 2: was `.limit(5000)`, which does NOT raise the PostgREST per-response
  // cap (db.max_rows, default 1000) — it only lowers it. With 4,179 lots the
  // command center was silently reasoning about the first 1,000 rows and
  // calling it the whole store: dead-stock, shrink and FEFO signals were all
  // computed on a quarter of the inventory. pagedAll() + a stable `.order("id")`
  // walks every page (chunked-in.ts:82).
  const rows = await pagedAll<LotRow>(async (from, to) => {
    const { data } = await admin
      .from("inventory_lots")
      .select(
        "id, product_name, category, status, is_medical, on_hand_qty, received_qty, unit_cost_minor_units, expires_on, created_at, received_on",
      )
      .order("id", { ascending: true })
      .range(from, to);
    return (data as LotRow[] | null) ?? [];
  });
  if (rows.length === 0) return [];

  // Most recent time each lot was physically counted (counted_qty recorded).
  //
  // SLICE 2: also paged. Note the ordering here is LOAD-BEARING, not just for
  // pagination: the "first row wins" reduction below depends on seeing the
  // newest updated_at first, so we keep `updated_at desc` and add `lot_id` as
  // a tiebreaker to make the sort total (equal timestamps would otherwise be
  // ordered arbitrarily, which can duplicate or skip rows across page
  // boundaries).
  const counted = await pagedAll<{ lot_id: string; updated_at: string }>(async (from, to) => {
    const { data } = await admin
      .from("cycle_count_lines")
      .select("lot_id, updated_at")
      .not("counted_qty", "is", null)
      .order("updated_at", { ascending: false })
      .order("lot_id", { ascending: true })
      .range(from, to);
    return (data as { lot_id: string; updated_at: string }[] | null) ?? [];
  });
  const lastCounted = new Map<string, string>();
  for (const c of counted) {
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
    // SLICE 2: aging is measured from the TRUE receipt day when we have one.
    // Previously this was always created_at, which for the undated Cultivera
    // lots is the import instant — making genuinely old stock look brand new
    // to the dead-stock and aging signals. `received_on` is only ever set from
    // evidence (POS export, manifest, or the owner's own entry), so when it is
    // present it is strictly better than the row-birth timestamp. When it is
    // absent we keep the previous behaviour rather than guess.
    receivedAt: r.received_on ? `${r.received_on}T12:00:00.000Z` : r.created_at,
    lastCountedAt: lastCounted.get(r.id) ?? null,
  }));
}

/** Documented reductions over the trailing N days (default 30). */
export async function loadIntelAdjustments(days = 30): Promise<IntelAdjustment[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  // SLICE 2: paged. A busy 30-day window easily exceeds 1,000 adjustments, and
  // truncation here understates shrink — the single number this loader exists
  // to surface.
  type AdjRow = { lot_id: string; qty_delta: number; reason: string };
  const rows = await pagedAll<AdjRow>(async (from, to) => {
    const { data } = await admin
      .from("inventory_adjustments")
      .select("lot_id, qty_delta, reason, id")
      .gte("created_at", since)
      .order("id", { ascending: true })
      .range(from, to);
    return (data as AdjRow[] | null) ?? [];
  });
  return rows.map((a) => ({
    lotId: a.lot_id,
    qtyDelta: Number(a.qty_delta) || 0,
    reason: a.reason,
  }));
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
