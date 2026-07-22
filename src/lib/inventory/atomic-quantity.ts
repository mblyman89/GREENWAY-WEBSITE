// =============================================================================
// Atomic inventory quantity writes (GW-012 fix). SERVER-ONLY.
//
// Every quantity change used to be read-modify-write: SELECT the current
// value, compute the new one in JavaScript, UPDATE it back blind. Two
// concurrent writers (two registers selling the same product, a sale racing
// a cycle count) could both read 10, write 9 and 8, and silently lose a
// unit. These helpers route the arithmetic through the database itself —
// migration 0129's `apply_lot_delta` / `apply_variant_delta` compute
// `qty = qty + delta` under the row's own lock, so concurrent deltas ALWAYS
// combine instead of overwriting each other.
//
// GRACEFUL DEGRADATION: migrations are applied manually by the owner, so a
// deploy can briefly run against a database without 0129. When the RPC is
// missing (PGRST202 / 42883) these helpers fall back to the caller-supplied
// absolute write — byte-for-byte the pre-fix behaviour. Anything else is a
// real error and is reported, never swallowed.
// =============================================================================

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isMissingDbFunctionError } from "@/lib/db/rpc-fallback-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type AtomicWriteResult = {
  ok: boolean;
  /** True when the 0129 RPC was missing and the legacy absolute write ran. */
  usedFallback: boolean;
  /** The new quantity per the RPC (null on fallback/miss/strict refusal). */
  newQty: number | null;
  error?: string;
};

/**
 * Atomically add `delta` (negative = consume) to a lot's on_hand_qty.
 *
 * - `clamp: true`  → floor at 0 (sales/restocks — the plan already reported
 *   any oversell in plain English).
 * - `clamp: false` → STRICT: the database refuses the write when it would go
 *   below zero (dispositions/destruction must never remove more than
 *   exists); the refusal comes back as ok=false with a readable error.
 * - `autoStatus`   → let the database flip active↔sold_out at the zero
 *   boundary (the sale/void vocabulary). Dispositions pass false and manage
 *   status themselves.
 *
 * `fallbackAbsolute` is the pre-0129 absolute value to write when the RPC
 * does not exist yet (legacy read-modify-write behaviour, kept so the code
 * works before the owner runs the migration).
 */
export async function applyLotDelta(
  admin: Admin,
  params: {
    lotId: string;
    delta: number;
    clamp: boolean;
    actorId?: string | null;
    autoStatus?: boolean;
    fallbackAbsolute: { onHandQty: number; status?: string; updatedBy?: string | null };
  },
): Promise<AtomicWriteResult> {
  const { data, error } = await admin.rpc("apply_lot_delta", {
    p_lot_id: params.lotId,
    p_delta: params.delta,
    p_clamp: params.clamp,
    p_actor: params.actorId ?? null,
    p_auto_status: params.autoStatus ?? true,
  });

  if (!error) {
    // null = lot missing, or a STRICT call refused (insufficient stock).
    if (data === null || data === undefined) {
      return {
        ok: false,
        usedFallback: false,
        newQty: null,
        error: params.clamp
          ? "Lot not found."
          : "The lot has less on hand than this change removes (someone else may have just used it). Refresh and retry.",
      };
    }
    return { ok: true, usedFallback: false, newQty: Number(data) };
  }

  if (!isMissingDbFunctionError(error)) {
    return { ok: false, usedFallback: false, newQty: null, error: error.message };
  }

  // Migration 0129 not applied yet — legacy absolute write (pre-fix shape).
  const patch: Record<string, unknown> = { on_hand_qty: params.fallbackAbsolute.onHandQty };
  if (params.fallbackAbsolute.status !== undefined) patch.status = params.fallbackAbsolute.status;
  if (params.fallbackAbsolute.updatedBy !== undefined) patch.updated_by = params.fallbackAbsolute.updatedBy;
  const { error: legacyError } = await admin
    .from("inventory_lots")
    .update(patch)
    .eq("id", params.lotId);
  if (legacyError) {
    return { ok: false, usedFallback: true, newQty: null, error: legacyError.message };
  }
  return { ok: true, usedFallback: true, newQty: null };
}

/**
 * Atomically add `delta` to a published menu variant's inventory_level
 * (floored at 0 by the database). Same graceful pre-0129 fallback.
 */
export async function applyVariantDelta(
  admin: Admin,
  params: {
    variantRowId: string;
    delta: number;
    fallbackAbsoluteLevel: number;
  },
): Promise<AtomicWriteResult> {
  const { data, error } = await admin.rpc("apply_variant_delta", {
    p_variant_id: params.variantRowId,
    p_delta: params.delta,
  });

  if (!error) {
    if (data === null || data === undefined) {
      return { ok: false, usedFallback: false, newQty: null, error: "Menu variant not found." };
    }
    return { ok: true, usedFallback: false, newQty: Number(data) };
  }

  if (!isMissingDbFunctionError(error)) {
    return { ok: false, usedFallback: false, newQty: null, error: error.message };
  }

  const { error: legacyError } = await admin
    .from("menu_variants")
    .update({ inventory_level: params.fallbackAbsoluteLevel })
    .eq("id", params.variantRowId);
  if (legacyError) {
    return { ok: false, usedFallback: true, newQty: null, error: legacyError.message };
  }
  return { ok: true, usedFallback: true, newQty: null };
}
