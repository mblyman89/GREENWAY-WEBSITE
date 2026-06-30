/**
 * src/lib/inventory/pricing.ts
 *
 * POS Slice 10 — pricing with guard rails.
 *
 *   • Hard floor: price can NEVER be below `min_markup_multiple` × cost (default 2x).
 *   • Suggested price: starts at the floor, then nudges up for fast movers and
 *     eases (toward the floor, never below) for slow/aged stock — using sales
 *     velocity. Tax is applied on top at sale time, not baked into the floor.
 *
 * All money is in MINOR UNITS (cents). Pure functions: no DB access here so they
 * are trivially testable; the store layer feeds in cost + velocity.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

export type PricingSettings = {
  min_markup_multiple: number;
  default_tax_rate: number;
  round_to_minor_units: number;
};

export const DEFAULT_PRICING: PricingSettings = {
  min_markup_multiple: 2.0,
  default_tax_rate: 0,
  round_to_minor_units: 5,
};

/** Round a minor-units amount UP to the nearest `step` (so we never dip below floor). */
export function roundUpTo(amountMinor: number, step: number): number {
  if (step <= 1) return Math.ceil(amountMinor);
  return Math.ceil(amountMinor / step) * step;
}

/** Round to nearest `step` (for suggested-price aesthetics; clamped to >= floor by caller). */
export function roundNearest(amountMinor: number, step: number): number {
  if (step <= 1) return Math.round(amountMinor);
  return Math.round(amountMinor / step) * step;
}

/**
 * The hard price floor = cost × min markup, rounded UP to the rounding step.
 * Returns null when cost is unknown (can't enforce a floor without cost).
 */
export function priceFloorMinor(
  costMinor: number | null | undefined,
  settings: PricingSettings = DEFAULT_PRICING,
): number | null {
  if (costMinor == null || costMinor <= 0) return null;
  const raw = costMinor * settings.min_markup_multiple;
  return roundUpTo(raw, settings.round_to_minor_units);
}

export type VelocitySignal = {
  /** Units sold in the lookback window. */
  unitsSold: number;
  /** Days the product has been available (age). */
  daysAvailable: number;
  /** Units currently on hand (slow movers tend to pile up). */
  onHand: number;
};

export type PriceSuggestion = {
  floorMinor: number | null;
  suggestedMinor: number | null;
  rationale: string;
};

/**
 * Suggest a price from cost + velocity.
 *
 * Strategy (transparent, never below floor):
 *   - Baseline = floor (2× cost).
 *   - Fast mover (high units/day): add up to +25% to capture margin on demand.
 *   - Slow/aged (low units/day, lots on hand, old): keep at/just above floor to
 *     move it — but we never go below the 2× floor (that's a hard rule).
 */
export function suggestPrice(
  costMinor: number | null | undefined,
  velocity: VelocitySignal | null,
  settings: PricingSettings = DEFAULT_PRICING,
): PriceSuggestion {
  const floor = priceFloorMinor(costMinor, settings);
  if (floor == null) {
    return {
      floorMinor: null,
      suggestedMinor: null,
      rationale: "No vendor cost on this product yet — add the cost to enable pricing.",
    };
  }

  if (!velocity || velocity.daysAvailable <= 0) {
    return {
      floorMinor: floor,
      suggestedMinor: floor,
      rationale: "New product, no sales history yet — starting at the 2× floor.",
    };
  }

  const perDay = velocity.unitsSold / Math.max(velocity.daysAvailable, 1);

  // Velocity bands (units/day). Tunable; deliberately conservative.
  let multiplier = 1.0;
  let why: string;
  if (perDay >= 3) {
    multiplier = 1.25;
    why = `High demand (~${perDay.toFixed(1)} sold/day) — raising price 25% over floor to capture margin.`;
  } else if (perDay >= 1) {
    multiplier = 1.12;
    why = `Steady seller (~${perDay.toFixed(1)} sold/day) — +12% over floor.`;
  } else if (perDay >= 0.25) {
    multiplier = 1.05;
    why = `Modest movement (~${perDay.toFixed(2)} sold/day) — +5% over floor.`;
  } else {
    multiplier = 1.0;
    const aged = velocity.daysAvailable > 60;
    why = aged
      ? `Slow mover (~${perDay.toFixed(2)} sold/day, ${velocity.daysAvailable}d old) — hold at the 2× floor to move it.`
      : `Low movement so far — hold at the 2× floor.`;
  }

  let suggested = roundNearest(floor * multiplier, settings.round_to_minor_units);
  if (suggested < floor) suggested = floor; // never below floor

  return { floorMinor: floor, suggestedMinor: suggested, rationale: why };
}

/** Validate an employee-entered price against the hard floor. */
export function validatePrice(
  priceMinor: number,
  costMinor: number | null | undefined,
  settings: PricingSettings = DEFAULT_PRICING,
): { ok: true } | { ok: false; floorMinor: number; error: string } {
  const floor = priceFloorMinor(costMinor, settings);
  if (floor == null) return { ok: true }; // no cost = can't enforce; allow.
  if (priceMinor < floor) {
    return {
      ok: false,
      floorMinor: floor,
      error: `Price must be at least the ${settings.min_markup_multiple}× cost floor of $${(
        floor / 100
      ).toFixed(2)}.`,
    };
  }
  return { ok: true };
}

// ── DB helpers ───────────────────────────────────────────────────────────

export async function getPricingSettings(): Promise<PricingSettings> {
  if (!isSupabaseServiceConfigured) return DEFAULT_PRICING;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("pricing_settings")
      .select("min_markup_multiple, default_tax_rate, round_to_minor_units")
      .eq("id", true)
      .maybeSingle();
    const row = data as PricingSettings | null;
    return row ?? DEFAULT_PRICING;
  } catch {
    return DEFAULT_PRICING;
  }
}

/**
 * Compute sales velocity for a POS product key from order_lines over a window.
 * Returns null if we have no signal at all.
 */
export async function getVelocityForProduct(
  posProductKey: string | null,
  lookbackDays = 60,
): Promise<VelocitySignal | null> {
  if (!isSupabaseServiceConfigured || !posProductKey) return null;
  try {
    const admin = createSupabaseAdminClient();
    const since = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000).toISOString();
    const { data } = await admin
      .from("order_lines")
      .select("quantity, created_at")
      .eq("product_id", posProductKey)
      .gte("created_at", since);
    const rows = (data as { quantity: number; created_at: string }[] | null) ?? [];
    if (rows.length === 0) return null;
    const unitsSold = rows.reduce((s, r) => s + (r.quantity ?? 0), 0);
    return { unitsSold, daysAvailable: lookbackDays, onHand: 0 };
  } catch {
    return null;
  }
}
