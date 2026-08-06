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

import { getPublishedPromotions, listNeverDiscountKeys } from "./promotions-store";
import type { PublishedPromotion } from "./types";
import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import {
  computePromotions,
  type EngineRule,
  type EngineCartLine,
} from "./discount-engine-core";

export * from "./discount-engine-core";

// Pure promotion helpers (parseEngineConfig, promotionToRule, isActiveNow,
// seedConfigFor, the serialisable PublishedRuleSnapshot, and the card-preview
// math) now live in the SHARED pure module so the client cart + product cards
// can price with the SAME published rules the register uses (Task T / PR 1 —
// Promotions Harmony, gap G-1). Re-exported here for existing importers.
export * from "./published-rules-core";
import {
  parseEngineConfig,
  promotionToRule,
  isActiveNow,
  seedConfigFor,
  snapshotFromPublished,
  seedRuleSnapshots,
  type PublishedRuleSnapshot,
} from "./published-rules-core";

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

/**
 * Every PUBLISHED promotion as a JSON-safe PublishedRuleSnapshot (rule +
 * parsed config + presentation fields) — the payload the storefront layout
 * hands to the client so the cart + product cards price with the SAME rules
 * the register uses. Includes ALL published promos (weekday recurring AND
 * scheduled windows); the client resolves which are active for the store's
 * current Pacific weekday via activeSnapshotsFor(), so a cart left open past
 * midnight re-prices to the new day just like the register would.
 * Falls back to the committed daily-deal seeds (identical legacy behaviour).
 */
export async function loadPublishedRuleSnapshots(): Promise<PublishedRuleSnapshot[]> {
  try {
    const published = await getPublishedPromotions();
    if (!published.length) {
      // No DB promotions: the storefront runs on the committed daily-deal seeds.
      // Still honour the never-discount list against those seed deals.
      const neverKeys = await listNeverDiscountKeys();
      const seeds = seedRuleSnapshots();
      if (!neverKeys.length) return seeds;
      return seeds.map((s) => ({
        ...s,
        excludeProductKeys: Array.from(new Set([...s.excludeProductKeys, ...neverKeys])),
      }));
    }
    const [configs, neverKeys] = await Promise.all([
      rawConfigsFor(published),
      listNeverDiscountKeys(),
    ]);
    return published.map((p) => {
      const raw = configs.get(p.id);
      const config = raw
        ? parseEngineConfig(raw)
        : p.id.startsWith("seed-")
          ? seedConfigFor(p.promoKey)
          : {};
      const snapshot = snapshotFromPublished(p, config);
      // PR-P4: fold the global never-discount keys into the snapshot the CLIENT
      // cart + product cards price with, so the storefront honours the list
      // WITHOUT any client-side fetch — the exclusion rides the serialized rule.
      if (neverKeys.length) {
        snapshot.excludeProductKeys = Array.from(
          new Set([...snapshot.excludeProductKeys, ...neverKeys]),
        );
      }
      return snapshot;
    });
  } catch {
    // The storefront must never lose its deals over a transient DB error.
    return seedRuleSnapshots();
  }
}

/** Raw config jsonb per promotion id (DB rows only; seeds carry seed config). */
async function rawConfigsFor(
  promos: PublishedPromotion[],
): Promise<Map<string, Record<string, unknown>>> {
  const configById = new Map<string, Record<string, unknown>>();
  const { isSupabaseServiceConfigured } = await import("@/lib/supabase/env");
  if (isSupabaseServiceConfigured && promos.some((p) => !p.id.startsWith("seed-"))) {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const admin = createSupabaseAdminClient();
    const ids = promos.filter((p) => !p.id.startsWith("seed-")).map((p) => p.id);
    if (ids.length) {
      const { data } = await admin.from("promotions").select("id, config").in("id", ids);
      for (const row of data ?? []) {
        configById.set(row.id as string, (row.config as Record<string, unknown>) ?? {});
      }
    }
  }
  return configById;
}

/** Re-attach raw config jsonb from the DB (seed fallbacks carry seed config). */
async function attachConfigs(active: PublishedPromotion[]): Promise<EngineRule[]> {
  const [configById, neverKeys] = await Promise.all([
    rawConfigsFor(active),
    listNeverDiscountKeys(),
  ]);

  return active.map((p) => {
    const rule = promotionToRule(p);
    const raw = configById.get(p.id);
    if (raw) rule.config = { ...parseEngineConfig(raw) };
    // Seed fallbacks: the set-in-stone daily deals carry their config in the
    // seed itself (e.g. Tuesday's either/or) — attach it when the DB had none.
    if (!raw && p.id.startsWith("seed-")) {
      rule.config = seedConfigFor(p.promoKey);
    }
    // PR-P4: bake the global never-discount keys into EVERY rule's exclusions
    // so every server pricing path (order pricing, POS, below-cost audit)
    // protects those products from all deals. "Exclusions win."
    if (neverKeys.length) {
      rule.excludeProductKeys = Array.from(new Set([...rule.excludeProductKeys, ...neverKeys]));
    }
    return rule;
  });
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
