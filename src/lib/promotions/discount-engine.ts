/**
 * src/lib/promotions/discount-engine.ts
 *
 * Server-side wrapper around the pure POS discount engine. Re-exports the core
 * and adds the DB/menu-aware glue:
 *
 *  - loadActiveRules(): map currently-PUBLISHED promotions that are active right
 *    now (weekday match OR date window) into EngineRule[] the core understands,
 *    parsing each promotion's `config` jsonb into the typed EngineConfig.
 *  - menuLinesForKeys(): turn a set of POS product keys + quantities (a sample
 *    basket the manager builds in the simulator) into EngineCartLine[] using the
 *    published menu version (price, category, brand, variant).
 *
 * Pure math stays in discount-engine-core.ts (the single source of truth).
 */
import "server-only";

import { getPublishedPromotions } from "./promotions-store";
import type { PublishedPromotion, Weekday } from "./types";
import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
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
  out.stackable = Boolean(c.stackable);
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
    stackable: config.stackable ?? false,
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
    return p.weekday === (when.getDay() as Weekday);
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

  // Re-attach raw config from the DB for active rows (seed fallbacks have none).
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
    rule.stackable = rule.config.stackable ?? false;
    return rule;
  });
}

export type SimBasketItem = { productKey: string; quantity: number };

/** Resolve a sample basket of product keys into EngineCartLines from the published menu. */
export async function menuLinesForBasket(items: SimBasketItem[]): Promise<EngineCartLine[]> {
  const version = await getPublishedVersion();
  if (!version) return [];
  const menu = await getVersionItems(version.id);
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
    });
  }
  return lines;
}

/** Convenience: simulate active promotions against a sample basket. */
export async function simulateBasket(items: SimBasketItem[], when = new Date()) {
  const [lines, rules] = await Promise.all([menuLinesForBasket(items), loadActiveRules(when)]);
  return { result: computePromotions(lines, rules), rules, lines };
}
