/**
 * src/lib/inventory/disposition.ts  (Run 6 / Slice 31)
 *
 * Server-side helpers for vendor returns (D) and destruction events (E), plus
 * sample-settings access (F). Both returns and destructions reduce on-hand by
 * posting a signed inventory_adjustments row (so the single auditable ledger
 * also feeds the CCRS InventoryAdjustment.csv), and record the business detail
 * in their own tables.
 *
 * Staff-only via the service-role client behind RLS.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  DEFAULT_SAMPLE_SETTINGS,
  type SampleSettings,
} from "@/lib/inventory/sample-guardrails";

/** WSLCB notice/quarantine hold before destruction is permitted (hours). */
export const DESTRUCTION_QUARANTINE_HOURS = 72;

export const VENDOR_RETURN_REASONS = [
  "defective",
  "recall",
  "overstock",
  "mislabeled",
  "expired",
  "other",
] as const;

export const DESTRUCTION_REASONS = [
  "expired",
  "failed_qa",
  "recall",
  "damaged",
  "contaminated",
  "other",
] as const;

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
};

type WithLot = { lot_code: string | null; product_name: string | null; unit: string | null };
export type VendorReturnWithLot = VendorReturn & WithLot;
export type DestructionEventWithLot = DestructionEvent & WithLot & { hold_elapsed: boolean };

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

  const { error: updErr } = await admin
    .from("inventory_lots")
    .update({ on_hand_qty: onHand - Math.abs(qtyMagnitude), updated_by: actorId })
    .eq("id", lotId);
  if (updErr) return { ok: false, error: updErr.message };

  return { ok: true, adjustmentId: (adj as { id: string }).id };
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
      input.detail ? `: ${input.detail}` : ""
    }`,
    actorId,
  );
  if (!posted.ok) return posted;

  const { data, error } = await admin
    .from("vendor_returns")
    .insert({
      lot_id: input.lotId,
      vendor_id: input.vendorId ?? null,
      quantity: input.quantity,
      reason: input.reason,
      detail: input.detail ?? null,
      rma_number: input.rmaNumber ?? null,
      adjustment_id: posted.adjustmentId,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not save return." };
  return { ok: true, id: (data as { id: string }).id };
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
 * Schedule a destruction: opens the 72h quarantine. Does NOT reduce on-hand yet
 * (the product is quarantined, not destroyed). Quantity is validated against
 * on-hand at completion time.
 */
export async function scheduleDestruction(
  input: { lotId: string; quantity: number; reason: string; detail?: string | null },
  actorId: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  if (!(input.quantity > 0)) return { ok: false, error: "Quantity must be greater than zero." };
  const admin = createSupabaseAdminClient();

  const now = new Date();
  const earliest = new Date(now.getTime() + DESTRUCTION_QUARANTINE_HOURS * 60 * 60 * 1000);

  // Move the lot into quarantine status for clear shop-floor signalling.
  await admin.from("inventory_lots").update({ status: "quarantine", updated_by: actorId }).eq("id", input.lotId);

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
 * Complete a destruction after the quarantine window: posts a reducing
 * 'destruction' adjustment (CCRS → Destruction), records method + witnesses,
 * and (if the lot is fully depleted) marks the lot destroyed.
 */
export async function completeDestruction(
  input: { id: string; method?: string | null; witnessedBy?: string | null },
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

  if (event.earliest_destroy_at && new Date(event.earliest_destroy_at).getTime() > Date.now()) {
    const when = new Date(event.earliest_destroy_at).toLocaleString();
    return { ok: false, error: `Quarantine hold not elapsed — earliest destroy at ${when}.` };
  }

  const posted = await postReduction(
    event.lot_id,
    event.quantity,
    "destruction",
    `Destruction (${event.reason})${event.detail ? `: ${event.detail}` : ""}${
      input.method ? ` — method: ${input.method}` : ""
    }`,
    actorId,
  );
  if (!posted.ok) return posted;

  const { error } = await admin
    .from("destruction_events")
    .update({
      status: "completed",
      method: input.method ?? null,
      witnessed_by: input.witnessedBy ?? null,
      completed_at: new Date().toISOString(),
      completed_by: actorId,
      adjustment_id: posted.adjustmentId,
    })
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };

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
  destructionsPending: number;
  destructionsCompletedLast30: number;
};

export async function dispositionSummary(): Promise<DispositionSummary> {
  const empty: DispositionSummary = {
    returnsLast30: 0,
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

  return {
    returnsLast30: ret ?? 0,
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
