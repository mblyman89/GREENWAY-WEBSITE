/**
 * src/lib/inventory/store.ts
 *
 * Server-side read/write helpers for inventory lots, lab results (COA),
 * inbound manifests, and inventory adjustments. Staff-only — all access via the
 * service-role client behind RLS. Part of POS Slice 3 (compliance backbone).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import type {
  InboundManifest,
  InventoryAdjustment,
  InventoryLot,
  LabResult,
  LotWithDetail,
} from "@/lib/inventory/types";

/** Number of days within which an expiry counts as "expiring soon". */
export const EXPIRING_SOON_DAYS = 30;

type LotFilter = {
  q?: string;
  status?: string;
  limit?: number;
};

/** Today as an ISO date string (UTC) for date comparisons. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Date N days from now as an ISO date string. */
function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function listLots(opts?: LotFilter): Promise<LotWithDetail[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("inventory_lots")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 500);

  if (opts?.status && opts.status !== "all") {
    query = query.eq("status", opts.status);
  }
  if (opts?.q && opts.q.trim().length > 0) {
    const term = opts.q.trim();
    query = query.or(
      [
        `product_name.ilike.%${term}%`,
        `lot_code.ilike.%${term}%`,
        `pos_product_key.ilike.%${term}%`,
      ].join(","),
    );
  }

  const { data } = await query;
  const lots = (data as InventoryLot[] | null) ?? [];
  if (lots.length === 0) return [];

  return hydrateLots(admin, lots);
}

/** Resolve vendor names, brand names, and lab results for a set of lots. */
async function hydrateLots(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  lots: InventoryLot[],
): Promise<LotWithDetail[]> {
  const vendorIds = [...new Set(lots.map((l) => l.vendor_id).filter(Boolean))] as string[];
  const brandIds = [...new Set(lots.map((l) => l.brand_id).filter(Boolean))] as string[];
  const labIds = [...new Set(lots.map((l) => l.lab_result_id).filter(Boolean))] as string[];

  const vendorMap = new Map<string, string>();
  const brandMap = new Map<string, string>();
  const labMap = new Map<string, LabResult>();

  if (vendorIds.length > 0) {
    const { data } = await admin
      .from("vendors")
      .select("id, display_name")
      .in("id", vendorIds);
    for (const v of (data as { id: string; display_name: string }[] | null) ?? []) {
      vendorMap.set(v.id, v.display_name);
    }
  }
  if (brandIds.length > 0) {
    const { data } = await admin
      .from("brands")
      .select("id, display_name")
      .in("id", brandIds);
    for (const b of (data as { id: string; display_name: string }[] | null) ?? []) {
      brandMap.set(b.id, b.display_name);
    }
  }
  if (labIds.length > 0) {
    const { data } = await admin.from("lab_results").select("*").in("id", labIds);
    for (const r of (data as LabResult[] | null) ?? []) {
      labMap.set(r.id, r);
    }
  }

  return lots.map((l) => ({
    ...l,
    vendor_name: l.vendor_id ? vendorMap.get(l.vendor_id) ?? null : null,
    brand_name: l.brand_id ? brandMap.get(l.brand_id) ?? null : null,
    lab: l.lab_result_id ? labMap.get(l.lab_result_id) ?? null : null,
  }));
}

export type InventoryStats = {
  total: number;
  active: number;
  quarantine: number;
  recalled: number;
  destroyed: number;
  soldOut: number;
  /** Active lots with on-hand quantity at or below zero (need restock/cleanup). */
  emptyActive: number;
  /** Active lots missing a linked COA (compliance gap). */
  missingCoa: number;
  /** Active lots missing a POS product key (won't tie to the catalog). */
  missingProductLink: number;
  /** Active lots expiring within EXPIRING_SOON_DAYS. */
  expiringSoon: number;
  /** Active lots already past their expiry date. */
  expired: number;
  /** Total inventory cost at hand in MINOR UNITS (sum of on_hand * unit_cost). */
  onHandCostMinor: number;
};

export async function computeInventoryStats(): Promise<InventoryStats> {
  const empty: InventoryStats = {
    total: 0,
    active: 0,
    quarantine: 0,
    recalled: 0,
    destroyed: 0,
    soldOut: 0,
    emptyActive: 0,
    missingCoa: 0,
    missingProductLink: 0,
    expiringSoon: 0,
    expired: 0,
    onHandCostMinor: 0,
  };
  if (!isSupabaseServiceConfigured) return empty;

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("inventory_lots")
    .select(
      "status, on_hand_qty, unit_cost_minor_units, lab_result_id, pos_product_key, expires_on",
    )
    .limit(5000);

  const rows =
    (data as
      | {
          status: string;
          on_hand_qty: number;
          unit_cost_minor_units: number | null;
          lab_result_id: string | null;
          pos_product_key: string | null;
          expires_on: string | null;
        }[]
      | null) ?? [];

  const today = todayIso();
  const soon = isoDaysFromNow(EXPIRING_SOON_DAYS);
  const stats = { ...empty };
  stats.total = rows.length;

  for (const r of rows) {
    switch (r.status) {
      case "active":
        stats.active += 1;
        break;
      case "quarantine":
        stats.quarantine += 1;
        break;
      case "recalled":
        stats.recalled += 1;
        break;
      case "destroyed":
        stats.destroyed += 1;
        break;
      case "sold_out":
        stats.soldOut += 1;
        break;
    }

    if (r.on_hand_qty != null && r.unit_cost_minor_units != null) {
      stats.onHandCostMinor += Math.round(r.on_hand_qty * r.unit_cost_minor_units);
    }

    if (r.status === "active") {
      if (!r.on_hand_qty || r.on_hand_qty <= 0) stats.emptyActive += 1;
      if (!r.lab_result_id) stats.missingCoa += 1;
      if (!r.pos_product_key) stats.missingProductLink += 1;
      if (r.expires_on) {
        if (r.expires_on < today) stats.expired += 1;
        else if (r.expires_on <= soon) stats.expiringSoon += 1;
      }
    }
  }

  return stats;
}

export async function getLotById(id: string): Promise<LotWithDetail | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("inventory_lots").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const [hydrated] = await hydrateLots(admin, [data as InventoryLot]);
  return hydrated ?? null;
}

export async function listLotAdjustments(lotId: string): Promise<InventoryAdjustment[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("inventory_adjustments")
    .select("*")
    .eq("lot_id", lotId)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data as InventoryAdjustment[] | null) ?? [];
}

export async function getManifestById(id: string): Promise<InboundManifest | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("inbound_manifests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as InboundManifest | null) ?? null;
}

/**
 * Record a manual inventory adjustment and update the lot's on-hand quantity.
 * Reasons: receive | shrink | damage | sample | destruction | count | recall | other.
 */
export async function createAdjustment(
  input: { lotId: string; qtyDelta: number; reason: string; note?: string | null },
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();

  const { data: lot } = await admin
    .from("inventory_lots")
    .select("id, on_hand_qty")
    .eq("id", input.lotId)
    .maybeSingle();
  if (!lot) return { ok: false, error: "Lot not found." };

  const { error: insErr } = await admin.from("inventory_adjustments").insert({
    lot_id: input.lotId,
    qty_delta: input.qtyDelta,
    reason: input.reason,
    note: input.note ?? null,
    actor_id: actorId,
  });
  if (insErr) return { ok: false, error: insErr.message };

  const current = (lot as { on_hand_qty: number }).on_hand_qty ?? 0;
  const next = current + input.qtyDelta;
  const { error: updErr } = await admin
    .from("inventory_lots")
    .update({ on_hand_qty: next, updated_by: actorId })
    .eq("id", input.lotId);
  if (updErr) return { ok: false, error: updErr.message };

  return { ok: true };
}

/** Update lifecycle status of a lot (e.g. recall, quarantine, destroy). */
export async function updateLotStatus(
  id: string,
  status: string,
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("inventory_lots")
    .update({ status, updated_by: actorId })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
