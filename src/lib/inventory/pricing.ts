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
// R32 (T-328): the explainable price waterfall + identity-wide velocity plan.
import {
  computePriceFloorMinor,
  explainPrice,
  planVelocityKeys,
  type PriceVelocityBasis,
  type VelocityPriorLot,
} from "@/lib/inventory/price-explain-core";

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

// T-322: `default_tax_rate` and `round_to_minor_units` were removed. Neither
// fed any live pricing math: the authoritative tax comes from the statutory
// constants in order-pricing-core.ts, and T-319 made auto prices round UP to
// the next whole dollar (roundUpToNextDollarMinor), so the old cent-rounding
// step was dead. Keeping them around was a foot-gun (they looked configurable
// but changed nothing). The pricing_settings table may still have the old
// columns; we simply no longer read or write them.
export type PricingSettings = {
  min_markup_multiple: number;
};

export const DEFAULT_PRICING: PricingSettings = {
  min_markup_multiple: 2.0,
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
  // R32: ONE implementation of the floor math, shared with the explanation
  // the owner reads (price-explain-core.ts) so the number and the words can
  // never disagree. Same formula as T-319: round UP(cost × multiple × divisor),
  // with a float-noise guard so an exact whole dollar is not bumped a dollar.
  return computePriceFloorMinor(costMinor, settings.min_markup_multiple, category);
}

export type VelocitySignal = {
  /** Units sold in the lookback window. */
  unitsSold: number;
  /**
   * Days the sales window really covers (R32: the HONEST window — days since
   * the first same-size delivery, capped at the lookback — not a fixed 60).
   */
  daysAvailable: number;
  /** Units currently on hand (slow movers tend to pile up). */
  onHand: number;
  /** R32: "product" = summed over every delivery of this product; "delivery" = this POS key only. */
  basis?: PriceVelocityBasis;
  /** R32: how many deliveries (POS keys) the units were summed over. */
  deliveriesCounted?: number;
  /** R32: when the sales were read (stamped into the fine print). */
  asOf?: string;
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
  // R32 (T-328): the suggestion AND its fine print come from ONE place, the
  // price waterfall in price-explain-core.ts. The rationale now states the
  // real rule with the real numbers ("2× cost ($5.00 → $10.00) + 46.3% tax =
  // $14.63 tax-inclusive, rounded up to $15.00") and, when sales history
  // moves the price, exactly which sales, over which window, from which
  // deliveries. Bands are unchanged: ≥3/day +25%, ≥1 +12%, ≥0.25 +5%, else floor.
  const asOf = velocity?.asOf ? new Date(velocity.asOf) : null;
  const e = explainPrice({
    costMinor,
    multiple: settings.min_markup_multiple,
    category,
    velocity:
      velocity && velocity.daysAvailable > 0
        ? {
            unitsSold: velocity.unitsSold,
            windowDays: velocity.daysAvailable,
            basis: velocity.basis ?? "delivery",
            deliveriesCounted: velocity.deliveriesCounted ?? 1,
          }
        : null,
    asOf,
  });
  return { floorMinor: e.floorMinor, suggestedMinor: e.suggestedMinor, rationale: e.rationale };
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
      .select("min_markup_multiple")
      .eq("id", true)
      .maybeSingle();
    const row = data as PricingSettings | null;
    return row ?? DEFAULT_PRICING;
  } catch {
    return DEFAULT_PRICING;
  }
}

/**
 * R32 (T-328): optional identity widening for the velocity lookup.
 * identityKey = the lot's S03 product identity (vendor | category | family);
 * the size fields keep a 1g and a 3.5g of the same product apart.
 */
export type VelocityIdentity = {
  identityKey: string | null;
  unitWeight: number | null;
  unitWeightUom: string | null;
};

/** Prior deliveries of the same product identity (best-effort; [] pre-0234). */
async function loadPriorDeliveriesForIdentity(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  identityKey: string,
): Promise<VelocityPriorLot[]> {
  try {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("pos_product_key, unit_weight, unit_weight_uom, received_on, created_at")
      .eq("identity_key", identityKey)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return []; // e.g. 0234 not applied: fall back to this delivery only
    type Row = {
      pos_product_key: string | null;
      unit_weight: number | null;
      unit_weight_uom: string | null;
      received_on: string | null;
      created_at: string | null;
    };
    return ((data as Row[] | null) ?? []).map((r) => ({
      pos_product_key: r.pos_product_key,
      unit_weight: r.unit_weight,
      unit_weight_uom: r.unit_weight_uom,
      arrived_at: r.received_on ?? r.created_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Compute sales velocity for a product from order_lines over a window.
 *
 * R32 (T-328): when `identity` is given, sales are summed over EVERY delivery
 * of the same product (same identity_key AND same package size), because the
 * per-delivery pos_product_key changes on each restock when the vendor has no
 * SKU — which is why restocks of best sellers used to read "New product, no
 * sales history yet". The window is honest (days since the first same-size
 * delivery, capped at `lookbackDays`).
 *
 * Returns null only when there is no signal at all (no deliveries to look up,
 * or a single brand-new delivery with no sales). A product that HAS earlier
 * deliveries but sold nothing returns unitsSold 0, so the fine print can say
 * so truthfully instead of claiming it is new.
 */
export async function getVelocityForProduct(
  posProductKey: string | null,
  lookbackDays = 60,
  identity?: VelocityIdentity | null,
): Promise<VelocitySignal | null> {
  if (!isSupabaseServiceConfigured) return null;
  if (!posProductKey && !identity?.identityKey) return null;
  try {
    const admin = createSupabaseAdminClient();
    const now = new Date();
    const priorLots = identity?.identityKey
      ? await loadPriorDeliveriesForIdentity(admin, identity.identityKey)
      : [];
    const plan = planVelocityKeys({
      currentKey: posProductKey,
      current: { unit_weight: identity?.unitWeight ?? null, unit_weight_uom: identity?.unitWeightUom ?? null },
      priorLots: identity ? priorLots : null,
      lookbackDays,
      now,
    });
    if (!plan) return null;
    const since = new Date(now.getTime() - lookbackDays * 24 * 3600 * 1000).toISOString();
    // Mastering Slice 1: a lot sold from a mastered card carries the CARD's
    // product_id, but its variant_id encodes THIS lot's key ("-onboarded").
    // Count both shapes; dedupe by line id (a single-lot card's line matches
    // both filters).
    const [byProduct, byVariant] = await Promise.all([
      admin
        .from("order_lines")
        .select("id, quantity, created_at")
        .in("product_id", plan.keys)
        .gte("created_at", since),
      admin
        .from("order_lines")
        .select("id, quantity, created_at")
        .in(
          "variant_id",
          plan.keys.map((k) => `${k}${ONBOARDED_VARIANT_SUFFIX}`),
        )
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
    // A single brand-new delivery with no sales = genuinely no history.
    if (rows.length === 0 && plan.basis === "delivery") return null;
    const unitsSold = rows.reduce((s, r) => s + (r.quantity ?? 0), 0);
    return {
      unitsSold,
      daysAvailable: plan.windowDays,
      onHand: 0,
      basis: plan.basis,
      deliveriesCounted: plan.deliveriesCounted,
      asOf: now.toISOString(),
    };
  } catch {
    return null;
  }
}
