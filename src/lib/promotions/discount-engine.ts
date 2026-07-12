/**
 * src/lib/promotions/discount-engine.ts
 *
 * Server-side wrapper around the pure POS discount engine. Re-exports the core
 * and adds the DB/menu-aware glue:
 *
 *  - loadActiveRules(): map currently-PUBLISHED promotions that are active right
 *    now (weekday match OR date window) into EngineRule[] the core understands,
 *    parsing each promotion's `config` jsonb into the typed EngineConfig.
 *  - loadProductCosts(): the weighted-average acquisition cost per POS product
 *    key from inventory_lots (same method as the COGS report) — feeds the CCRS
 *    cost floor ("may not discount the sale price below the cost of
 *    acquisition", see docs/PROMOTIONS_COMPLIANCE.md).
 *  - menuLinesForBasket(): turn a set of POS product keys + quantities (a sample
 *    basket the manager builds in the simulator) into EngineCartLine[] using the
 *    published menu version (price, category, brand, variant) WITH costs.
 *
 * Pure math stays in discount-engine-core.ts (the single source of truth).
 * NO STACKING: the engine is strictly best-deal-wins (owner hard block);
 * legacy `config.stackable` values are ignored.
 */
import "server-only";

import { getPublishedPromotions } from "./promotions-store";
import type { PublishedPromotion, Weekday } from "./types";
import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import { storeWeekday } from "@/lib/reports/timezone";
import {
  computePromotions,
  type EngineRule,
  type EngineConfig,
  type EngineCartLine,
  type Tier,
} from "./discount-engine-core";

export * from "./discount-engine-core";

/** Safely coerce an unknown JSON value into a Tier[]. */
function parseTiers(value: unknown): Tier[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tiers: Tier[] = [];
  for (const t of value) {
    if (t && typeof t === "object") {
      const at = Number((t as Record<string, unknown>).at);
      const percent = Number((t as Record<string, unknown>).percent);
      if (Number.isFinite(at) && Number.isFinite(percent)) tiers.push({ at, percent });
    }
  }
  return tiers.length ? tiers : undefined;
}

/** Parse a promotion's raw config jsonb into the typed EngineConfig. */
export function parseEngineConfig(config: Record<string, unknown> | null | undefined): EngineConfig {
  const c = config ?? {};
  const out: EngineConfig = {};
  out.qtyTiers = parseTiers(c.qtyTiers);
  out.weightTiers = parseTiers(c.weightTiers);
  out.spendTiers = parseTiers(c.spendTiers);

  if (c.bogo && typeof c.bogo === "object") {
    const b = c.bogo as Record<string, unknown>;
    out.bogo = {
      buyQty: Number(b.buyQty) || 1,
      getQty: Number(b.getQty) || 1,
      getPercent: Number(b.getPercent) || 100,
    };
  }
  if (c.basketNforM && typeof c.basketNforM === "object") {
    const n = c.basketNforM as Record<string, unknown>;
    out.basketNforM = { n: Number(n.n) || 3, m: Number(n.m) || 2 };
  }
  if (c.basketTopItem && typeof c.basketTopItem === "object") {
    const t = c.basketTopItem as Record<string, unknown>;
    out.basketTopItem = { topPercent: Number(t.topPercent) || 0, restPercent: Number(t.restPercent) || 0 };
  }
  if (c.eitherOr && typeof c.eitherOr === "object") {
    const e = c.eitherOr as Record<string, unknown>;
    const bundle = (e.bundle && typeof e.bundle === "object" ? e.bundle : {}) as Record<string, unknown>;
    const flatPercent = Number(e.flatPercent) || 0;
    const n = Number(bundle.n) || 0;
    const m = Number(bundle.m);
    if (flatPercent > 0 && n >= 2 && Number.isFinite(m) && m >= 0 && m < n) {
      out.eitherOr = { flatPercent, bundle: { n, m } };
    }
  }
  // NOTE: legacy `stackable` configs are intentionally IGNORED — discount
  // stacking is hard-blocked (owner directive; see docs/PROMOTIONS_COMPLIANCE.md).
  return out;
}

/**
 * Map a PublishedPromotion into an EngineRule. PublishedPromotion does NOT carry
 * the raw `config` jsonb, so the config starts empty here; loadActiveRules
 * re-attaches the parsed config from the DB for active rows.
 */
export function promotionToRule(p: PublishedPromotion, config: EngineConfig = {}): EngineRule {
  return {
    id: p.id,
    title: p.title,
    discountType: p.discountType,
    discountPercent: p.discountPercent,
    discountFixed: p.discountFixed,
    priority: p.priority,
    storewide: p.storewide,
    targetCategories: p.targetCategories,
    targetBrands: p.targetBrands,
    targetProductKeys: p.targetProductKeys,
    excludeCategories: p.excludeCategories,
    excludeBrands: p.excludeBrands,
    excludeProductKeys: p.excludeProductKeys,
    config,
  };
}

/** Is a published promotion active at `when`? (weekday recurring OR date window) */
export function isActiveNow(p: PublishedPromotion, when: Date): boolean {
  if (p.weekday != null) {
    // S-12: weekday recurring promos follow the STORE's (Pacific) weekday.
    // Server-local getDay() drifts ~7-8h/day on UTC hosts, making the
    // advertised deal differ from the charged deal in the evening.
    return p.weekday === (storeWeekday(when) as Weekday);
  }
  const startsOk = !p.startsAt || new Date(p.startsAt).getTime() <= when.getTime();
  const endsOk = !p.endsAt || new Date(p.endsAt).getTime() >= when.getTime();
  // A promo with neither a weekday nor a window is treated as always-on.
  if (!p.startsAt && !p.endsAt) return true;
  return startsOk && endsOk;
}

/**
 * Load the EngineRules that are active right now. We must re-read the raw
 * promotions rows for their `config` jsonb (PublishedPromotion drops it), so we
 * fetch published promotions and re-attach config via the admin client.
 */
export async function loadActiveRules(when = new Date()): Promise<EngineRule[]> {
  const published = await getPublishedPromotions();
  const active = published.filter((p) => isActiveNow(p, when));
  return attachConfigs(active);
}

/**
 * Every PUBLISHED promotion as an EngineRule (regardless of weekday/window) —
 * powers the standing below-cost audit in the promotions command center.
 */
export async function loadPublishedRules(): Promise<EngineRule[]> {
  const published = await getPublishedPromotions();
  return attachConfigs(published);
}

/** Re-attach raw config jsonb from the DB (seed fallbacks carry seed config). */
async function attachConfigs(active: PublishedPromotion[]): Promise<EngineRule[]> {
  const { isSupabaseServiceConfigured } = await import("@/lib/supabase/env");
  const configById = new Map<string, Record<string, unknown>>();
  if (isSupabaseServiceConfigured && active.some((p) => !p.id.startsWith("seed-"))) {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const admin = createSupabaseAdminClient();
    const ids = active.filter((p) => !p.id.startsWith("seed-")).map((p) => p.id);
    if (ids.length) {
      const { data } = await admin.from("promotions").select("id, config").in("id", ids);
      for (const row of data ?? []) {
        configById.set(row.id as string, (row.config as Record<string, unknown>) ?? {});
      }
    }
  }

  return active.map((p) => {
    const rule = promotionToRule(p);
    const raw = configById.get(p.id);
    if (raw) rule.config = { ...parseEngineConfig(raw) };
    // Seed fallbacks: the set-in-stone daily deals carry their config in the
    // seed itself (e.g. Tuesday's either/or) — attach it when the DB had none.
    if (!raw && p.id.startsWith("seed-")) {
      rule.config = seedConfigFor(p.promoKey);
    }
    return rule;
  });
}

/** Engine config for the committed daily-deal seeds (DB-empty fallback). */
export function seedConfigFor(promoKey: string | null): EngineConfig {
  switch (promoKey) {
    case "daily.tuesday":
      // Doobie Tuesday: 20% off OR 4-for-3 mix & match, store-advantaged.
      return { eitherOr: { flatPercent: 20, bundle: { n: 4, m: 3 } } };
    case "daily.saturday":
      return { basketTopItem: { topPercent: 30, restPercent: 15 } };
    case "daily.sunday":
      return { basketNforM: { n: 3, m: 2 } };
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Acquisition costs (the CCRS cost floor's data source)
// ---------------------------------------------------------------------------

/**
 * Weighted-average acquisition cost (minor units, pre-tax) per POS product key
 * from inventory_lots — the same method the COGS report uses. Keys without any
 * costed lot are absent from the map (floor falls back to the statutory floor
 * and the below-cost audit lists them as "cost unknown").
 */
export async function loadProductCosts(): Promise<Map<string, number>> {
  const costs = new Map<string, number>();
  const { isSupabaseServiceConfigured } = await import("@/lib/supabase/env");
  if (!isSupabaseServiceConfigured) return costs;
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("inventory_lots")
    .select("pos_product_key, received_qty, unit_cost_minor_units")
    .not("pos_product_key", "is", null)
    .not("unit_cost_minor_units", "is", null)
    .limit(10000);
  const num = new Map<string, number>();
  const den = new Map<string, number>();
  for (const row of (data ?? []) as { pos_product_key: string | null; received_qty: number | null; unit_cost_minor_units: number | null }[]) {
    const key = row.pos_product_key;
    if (!key || row.unit_cost_minor_units == null) continue;
    const qty = Math.max(1, Math.round(row.received_qty ?? 1));
    num.set(key, (num.get(key) ?? 0) + row.unit_cost_minor_units * qty);
    den.set(key, (den.get(key) ?? 0) + qty);
  }
  for (const [key, total] of num.entries()) {
    const d = den.get(key) ?? 0;
    if (d > 0) costs.set(key, Math.round(total / d));
  }
  return costs;
}

export type SimBasketItem = { productKey: string; quantity: number };

/** Resolve a sample basket of product keys into EngineCartLines from the published menu (with costs). */
export async function menuLinesForBasket(items: SimBasketItem[]): Promise<EngineCartLine[]> {
  const version = await getPublishedVersion();
  if (!version) return [];
  const [menu, costs] = await Promise.all([getVersionItems(version.id), loadProductCosts()]);
  const byKey = new Map(menu.map((i) => [i.source_item_id, i]));
  const lines: EngineCartLine[] = [];
  for (const it of items) {
    const m = byKey.get(it.productKey);
    if (!m) continue;
    lines.push({
      lineId: it.productKey,
      regularPriceMinorUnits: m.price_minor_units,
      quantity: Math.max(1, it.quantity),
      categories: (m.filter_categories?.length ? m.filter_categories : [m.category]).map((c) => String(c).toLowerCase()),
      brand: m.brand_name ?? null,
      productKey: m.source_item_id,
      variantLabel: null,
      costMinorUnits: costs.get(it.productKey) ?? null,
    });
  }
  return lines;
}

/** Convenience: simulate active promotions against a sample basket. */
export async function simulateBasket(items: SimBasketItem[], when = new Date()) {
  const [lines, rules] = await Promise.all([menuLinesForBasket(items), loadActiveRules(when)]);
  return { result: computePromotions(lines, rules), rules, lines };
}
