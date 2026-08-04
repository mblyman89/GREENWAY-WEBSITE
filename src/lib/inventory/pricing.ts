/**
 * src/lib/inventory/pricing.ts
 *
 * POS Slice 10 — pricing with guard rails.
 *
 *   • Hard floor: price can NEVER be below `min_markup_multiple` × cost (default 2x).
 *   • Suggested price: starts at the floor, then nudges up for fast movers and
 *     eases (toward the floor, never below) for slow/aged stock — using sales
 *     velocity.
 *
 * TAX-INCLUSIVE PRICING (T-319, owner Michael's rule):
 *   Our menu and register show TAX-INCLUSIVE, out-the-door prices (see
 *   order-pricing-core.ts). So the owner's "2× markup" must be taken on the
 *   PRE-TAX cost and THEN have the tax folded on top — otherwise the 2× erodes
 *   once tax is baked into the shelf price. The auto price is therefore:
 *
 *       base         = cost × min_markup_multiple          (e.g. 2× cost)
 *       taxInclusive = base × divisor(category)            (1.463 cannabis / 1.093 merch)
 *       autoPrice    = round UP to the next WHOLE DOLLAR    (clean menu numbers)
 *
 *   Worked example (Michael's): $5.00 cost → 2× = $10.00 base → ×1.463 = $14.63
 *   tax-inclusive → rounds UP to $15.00 out the door. The divisor is the SAME
 *   statutory rate the cart/menu use (single source of truth), so the shelf
 *   price the customer pays matches what onboarding set.
 *
 * All money is in MINOR UNITS (cents). Pure functions: no DB access in the math
 * so they are trivially testable; the store layer feeds in cost + velocity.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
// Mastering Slice 1: intake variant ids encode their lot key + this suffix.
import { ONBOARDED_VARIANT_SUFFIX } from "@/lib/pos/variant-lot-core";
// T-319: the statutory tax model is the SINGLE SOURCE OF TRUTH for tax. We
// fold the SAME divisor the menu/cart use so onboarding prices are truly
// tax-inclusive and never drift from the shelf price.
import {
  TAX_INCLUSIVE_DIVISOR,
  NON_CANNABIS_TAX_INCLUSIVE_DIVISOR,
  isNonCannabisCategory,
} from "@/lib/orders/order-pricing-core";

/** One whole dollar in minor units. Menu prices round UP to this for clean numbers. */
export const WHOLE_DOLLAR_MINOR = 100;

/**
 * The tax-inclusive divisor for a product category. Cannabis goods carry the
 * 37% WSLCB excise + 9.3% local sales tax (1.463); merch/accessories carry only
 * the 9.3% local sales tax (1.093). Mirrors the cart/menu exactly.
 */
export function taxInclusiveDivisorFor(category: string | null | undefined): number {
  return isNonCannabisCategory(category)
    ? NON_CANNABIS_TAX_INCLUSIVE_DIVISOR
    : TAX_INCLUSIVE_DIVISOR;
}

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
 * Round a minor-units amount UP to the next WHOLE DOLLAR (T-319). $14.63 → $15.00,
 * $10.00 → $10.00 (already whole). Owner prefers clean whole-dollar shelf prices.
 */
export function roundUpToNextDollarMinor(amountMinor: number): number {
  return roundUpTo(amountMinor, WHOLE_DOLLAR_MINOR);
}

/**
 * The hard price floor = the TAX-INCLUSIVE 2× auto price (T-319):
 *   base         = cost × min_markup_multiple
 *   taxInclusive = base × divisor(category)   (cannabis 1.463 / merch 1.093)
 *   floor        = round UP to the next whole dollar
 *
 * Because our shelf/menu prices are tax-inclusive, this keeps the owner's full
 * 2× markup intact AFTER tax (a $5 cost floors at $15 out the door, not ~$10).
 * Returns null when cost is unknown (can't enforce a floor without cost).
 */
export function priceFloorMinor(
  costMinor: number | null | undefined,
  settings: PricingSettings = DEFAULT_PRICING,
  category?: string | null,
): number | null {
  if (costMinor == null || costMinor <= 0) return null;
  const base = costMinor * settings.min_markup_multiple; // pre-tax 2× markup
  const taxInclusive = base * taxInclusiveDivisorFor(category); // fold tax on top
  return roundUpToNextDollarMinor(taxInclusive); // clean whole-dollar shelf price
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
 *   - Baseline = floor (the tax-inclusive 2× auto price, T-319).
 *   - Fast mover (high units/day): add up to +25% to capture margin on demand.
 *   - Slow/aged (low units/day, lots on hand, old): keep at/just above floor to
 *     move it — but we never go below the floor (that's a hard rule).
 *
 * `category` selects the tax divisor (cannabis vs merch); the suggested price is
 * also rounded UP to a clean whole dollar so the menu shows tidy numbers.
 */
export function suggestPrice(
  costMinor: number | null | undefined,
  velocity: VelocitySignal | null,
  settings: PricingSettings = DEFAULT_PRICING,
  category?: string | null,
): PriceSuggestion {
  const floor = priceFloorMinor(costMinor, settings, category);
  if (floor == null) {
    return {
      floorMinor: null,
      suggestedMinor: null,
      rationale: "No vendor cost on this product yet — add the cost to enable pricing.",
    };
  }

  const mult = settings.min_markup_multiple;
  if (!velocity || velocity.daysAvailable <= 0) {
    return {
      floorMinor: floor,
      suggestedMinor: floor,
      rationale: `New product, no sales history yet — starting at the ${mult}× (tax-inclusive, rounded up to the next dollar) floor.`,
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
      ? `Slow mover (~${perDay.toFixed(2)} sold/day, ${velocity.daysAvailable}d old) — hold at the ${mult}× floor to move it.`
      : `Low movement so far — hold at the ${mult}× floor.`;
  }

  // Nudge above the floor, then round UP to the next whole dollar for a clean
  // shelf number, and never below the floor.
  let suggested = roundUpToNextDollarMinor(floor * multiplier);
  if (suggested < floor) suggested = floor; // never below floor

  return { floorMinor: floor, suggestedMinor: suggested, rationale: why };
}

/** Validate an employee-entered price against the hard floor. */
export function validatePrice(
  priceMinor: number,
  costMinor: number | null | undefined,
  settings: PricingSettings = DEFAULT_PRICING,
  category?: string | null,
): { ok: true } | { ok: false; floorMinor: number; error: string } {
  const floor = priceFloorMinor(costMinor, settings, category);
  if (floor == null) return { ok: true }; // no cost = can't enforce; allow.
  if (priceMinor < floor) {
    return {
      ok: false,
      floorMinor: floor,
      error: `Price must be at least the ${settings.min_markup_multiple}× cost + tax floor of $${(
        floor / 100
      ).toFixed(2)} (tax-inclusive, rounded up to the next dollar).`,
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
    // Mastering Slice 1: a lot sold from a mastered card carries the CARD's
    // product_id, but its variant_id encodes THIS lot's key ("-onboarded").
    // Count both shapes; dedupe by line id (a single-lot card's line matches
    // both filters).
    const [byProduct, byVariant] = await Promise.all([
      admin
        .from("order_lines")
        .select("id, quantity, created_at")
        .eq("product_id", posProductKey)
        .gte("created_at", since),
      admin
        .from("order_lines")
        .select("id, quantity, created_at")
        .eq("variant_id", `${posProductKey}${ONBOARDED_VARIANT_SUFFIX}`)
        .gte("created_at", since),
    ]);
    type Row = { id: string; quantity: number; created_at: string };
    const seen = new Set<string>();
    const rows: Row[] = [];
    for (const r of [
      ...((byProduct.data as Row[] | null) ?? []),
      ...((byVariant.data as Row[] | null) ?? []),
    ]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      rows.push(r);
    }
    if (rows.length === 0) return null;
    const unitsSold = rows.reduce((s, r) => s + (r.quantity ?? 0), 0);
    return { unitsSold, daysAvailable: lookbackDays, onHand: 0 };
  } catch {
    return null;
  }
}
