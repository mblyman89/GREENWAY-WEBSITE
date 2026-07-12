/**
 * src/lib/promotions/promo-guard.ts
 *
 * Server wrapper for the pure below-cost publish guard (promo-guard-core).
 *
 * CCRS Upload User Guide (June 2025), Sale.csv `Discount`: a discount "may not
 * discount the sale price below the cost of acquisition" (see
 * docs/PROMOTIONS_COMPLIANCE.md). This module joins the PUBLISHED menu with
 * weighted-average lot costs (same method as the COGS report), resolves each
 * promotion's affected products (targets minus exclusions), and runs the pure
 * worst-case check:
 *
 *  - guardPromotionPublish(promo): the publish-time HARD BLOCK. Any product
 *    whose worst-case discounted price lands below its tax-inclusive cost
 *    floor (ceil(preTaxCost x divisor)) refuses the publish.
 *  - auditPublishedPromotions(): the standing audit for the command center —
 *    every published promo (plus seed fallbacks when the DB is empty) is
 *    re-checked against the CURRENT menu + costs, so price/cost drift after
 *    publish still surfaces.
 *
 * NOTE: even without this guard the checkout/engine clamps guarantee no ticket
 * ever prints below the floor (defense in depth). The guard exists so staff
 * never publish a promise the register would have to silently break.
 */
import "server-only";
import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  findBelowCost,
  hasPublishBlock,
  type BelowCostFinding,
  type GuardProduct,
  type GuardRuleShape,
} from "./promo-guard-core";
import {
  loadProductCosts,
  loadPublishedRules,
  parseEngineConfig,
  seedConfigFor,
  type EngineRule,
} from "./discount-engine";
import { getPublishedPromotions } from "./promotions-store";
import type { PromotionWithRules, PromoScope } from "./types";

// ---------------------------------------------------------------------------
// Menu + costs join
// ---------------------------------------------------------------------------

/** Published-menu products joined with weighted-average acquisition costs. */
export async function loadGuardProducts(): Promise<GuardProduct[]> {
  if (!isSupabaseServiceConfigured) return [];
  const version = await getPublishedVersion();
  if (!version) return [];
  const [items, costs] = await Promise.all([getVersionItems(version.id), loadProductCosts()]);
  return items.map((i) => ({
    key: i.source_item_id,
    name: i.name,
    brand: i.brand_name ?? "",
    categories: (i.filter_categories?.length ? i.filter_categories : [i.category]).map((c) =>
      String(c).toLowerCase(),
    ),
    priceMinorUnits: i.price_minor_units,
    costMinorUnits: costs.get(i.source_item_id) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Target resolution (same semantics as promotions-store.ruleMatches /
// engine ruleMatchesLine: exclusions win; storewide skips merch).
// ---------------------------------------------------------------------------

type ScopedRule = { scope: PromoScope; value: string | null };

const MERCH_TOKENS = ["merch", "accessories", "paraphernalia"];

function matchesScoped(p: GuardProduct, rules: ScopedRule[]): boolean {
  return rules.some((r) => {
    if (r.scope === "all") return true;
    if (r.scope === "category")
      return r.value ? p.categories.includes(r.value.trim().toLowerCase()) : false;
    if (r.scope === "brand")
      return r.value ? p.brand.trim().toLowerCase() === r.value.trim().toLowerCase() : false;
    if (r.scope === "product") return r.value ? p.key === r.value : false;
    return false;
  });
}

function affectedByScopes(
  products: GuardProduct[],
  targets: ScopedRule[],
  exclusions: ScopedRule[],
): GuardProduct[] {
  const storewide = targets.some((t) => t.scope === "all");
  return products.filter((p) => {
    if (matchesScoped(p, exclusions)) return false;
    if (storewide && p.categories.some((c) => MERCH_TOKENS.includes(c))) {
      // Storewide cannabis deals never touch merch unless explicitly targeted.
      return matchesScoped(
        p,
        targets.filter((t) => t.scope !== "all"),
      );
    }
    return matchesScoped(p, targets);
  });
}

function affectedByEngineRule(products: GuardProduct[], rule: EngineRule): GuardProduct[] {
  const targets: ScopedRule[] = [
    ...(rule.storewide ? [{ scope: "all" as const, value: null }] : []),
    ...rule.targetCategories.map((v) => ({ scope: "category" as const, value: v })),
    ...rule.targetBrands.map((v) => ({ scope: "brand" as const, value: v })),
    ...rule.targetProductKeys.map((v) => ({ scope: "product" as const, value: v })),
  ];
  const exclusions: ScopedRule[] = [
    ...rule.excludeCategories.map((v) => ({ scope: "category" as const, value: v })),
    ...rule.excludeBrands.map((v) => ({ scope: "brand" as const, value: v })),
    ...rule.excludeProductKeys.map((v) => ({ scope: "product" as const, value: v })),
  ];
  return affectedByScopes(products, targets, exclusions);
}

// ---------------------------------------------------------------------------
// Publish-time guard (HARD BLOCK)
// ---------------------------------------------------------------------------

export type PublishGuardResult = {
  /** True → publishing must be refused (at least one true below-cost hit). */
  blocked: boolean;
  /** Every finding (below_cost blocks; cost_unknown / regular_below_cost warn). */
  findings: BelowCostFinding[];
  /** How many published-menu products the promotion applies to. */
  affectedCount: number;
};

/**
 * Worst-case-check a promotion against the published menu BEFORE publishing.
 * `blocked=true` when any affected product's worst-case discounted price would
 * fall below its cost floor — the caller MUST refuse the status change.
 */
export async function guardPromotionPublish(
  promo: PromotionWithRules,
): Promise<PublishGuardResult> {
  const products = await loadGuardProducts();
  if (products.length === 0) return { blocked: false, findings: [], affectedCount: 0 };

  const targets = promo.targets.map((t) => ({ scope: t.scope, value: t.value }));
  const exclusions = promo.exclusions.map((e) => ({ scope: e.scope, value: e.value }));
  const affected = affectedByScopes(products, targets, exclusions);

  const rawConfig =
    promo.config && Object.keys(promo.config).length > 0
      ? parseEngineConfig(promo.config)
      : seedConfigFor(promo.promo_key);
  const shape: GuardRuleShape = {
    discountType: promo.discount_type,
    discountPercent: Number(promo.discount_percent),
    discountFixed: promo.discount_fixed,
    config: rawConfig,
  };

  const findings = findBelowCost(shape, affected);
  return { blocked: hasPublishBlock(findings), findings, affectedCount: affected.length };
}

// ---------------------------------------------------------------------------
// Standing audit (command-center panel)
// ---------------------------------------------------------------------------

export type PromotionAuditEntry = {
  promotionId: string;
  title: string;
  weekday: number | null;
  affectedCount: number;
  /** True below-cost hits (would be clamped at the register — fix pricing!). */
  belowCost: BelowCostFinding[];
  /** Products whose acquisition cost is unknown (no costed lot yet). */
  costUnknown: BelowCostFinding[];
  /** Products whose REGULAR price already sits at/below the cost floor. */
  regularBelowCost: BelowCostFinding[];
};

export type PromotionsAudit = {
  entries: PromotionAuditEntry[];
  totals: { belowCost: number; costUnknown: number; regularBelowCost: number };
  productCount: number;
  costedProductCount: number;
};

/**
 * Re-run the worst-case below-cost check for EVERY published promotion (seeds
 * included when they're the live fallback) against the CURRENT menu + costs.
 * Published promos can drift below cost after publish (price drops, costlier
 * restock) — this panel catches that before the register clamp has to.
 */
export async function auditPublishedPromotions(): Promise<PromotionsAudit> {
  const [products, rules, published] = await Promise.all([
    loadGuardProducts(),
    loadPublishedRules(),
    getPublishedPromotions(),
  ]);
  const weekdayById = new Map(published.map((p) => [p.id, p.weekday]));
  const costedProductCount = products.filter(
    (p) => p.costMinorUnits != null && p.costMinorUnits > 0,
  ).length;
  const entries: PromotionAuditEntry[] = [];
  const totals = { belowCost: 0, costUnknown: 0, regularBelowCost: 0 };

  for (const rule of rules) {
    const affected = affectedByEngineRule(products, rule);
    const shape: GuardRuleShape = {
      discountType: rule.discountType,
      discountPercent: rule.discountPercent,
      discountFixed: rule.discountFixed,
      config: rule.config,
    };
    const findings = findBelowCost(shape, affected);
    const belowCost = findings.filter((f) => f.reason === "below_cost");
    const costUnknown = findings.filter((f) => f.reason === "cost_unknown");
    const regularBelowCost = findings.filter((f) => f.reason === "regular_below_cost");
    totals.belowCost += belowCost.length;
    totals.costUnknown += costUnknown.length;
    totals.regularBelowCost += regularBelowCost.length;
    entries.push({
      promotionId: rule.id,
      title: rule.title,
      weekday: weekdayById.get(rule.id) ?? null,
      affectedCount: affected.length,
      belowCost,
      costUnknown,
      regularBelowCost,
    });
  }

  return { entries, totals, productCount: products.length, costedProductCount };
}
