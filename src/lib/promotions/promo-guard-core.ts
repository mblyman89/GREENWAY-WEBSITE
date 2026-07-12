/**
 * src/lib/promotions/promo-guard-core.ts  (Task R)
 *
 * PURE below-cost guard math for the promotions command center — the
 * publish-time HARD BLOCK and the standing below-cost audit. No React, no DB.
 *
 * CCRS Upload User Guide (Sale.csv `Discount`, verbatim): "The discount must
 * be available to all who meet the discount conditions and may not discount
 * the sale price below the cost of acquisition." See
 * docs/PROMOTIONS_COMPLIANCE.md for the full verified ground truth.
 *
 * Strategy: for each product a promotion can touch, compute the promotion's
 * WORST-CASE (maximum possible) discounted price and compare it against the
 * product's cost floor (acquisition cost converted to a tax-inclusive unit
 * price, rounded UP). Conservative by design — the runtime engines clamp too,
 * but a promotion that can only stay legal thanks to the clamp would advertise
 * prices the register won't honor, so publishing it is refused outright.
 */
import {
  costFloorMinorUnits,
  DEFAULT_QTY_TIERS,
  DEFAULT_SPEND_TIERS,
  DEFAULT_WEIGHT_TIERS,
  type EngineConfig,
  type DiscountType,
  type Tier,
} from "./discount-engine-core";

export type GuardProduct = {
  key: string;
  name: string;
  brand: string;
  /** Lowercased category tokens. */
  categories: string[];
  /** Regular menu price, tax-inclusive minor units. */
  priceMinorUnits: number;
  /** Weighted-average acquisition cost, PRE-TAX minor units. Null = unknown. */
  costMinorUnits: number | null;
};

export type GuardRuleShape = {
  discountType: DiscountType;
  discountPercent: number;
  discountFixed: number;
  config: EngineConfig;
};

export type BelowCostFinding = {
  key: string;
  name: string;
  brand: string;
  priceMinorUnits: number;
  costMinorUnits: number | null;
  /** Tax-inclusive floor implied by the cost (0 when cost unknown). */
  floorMinorUnits: number;
  /** The promotion's worst-case discounted unit price. */
  worstCasePriceMinorUnits: number;
  /** Why this product is flagged. */
  reason: "below_cost" | "cost_unknown" | "regular_below_cost";
};

const MERCH_TOKENS = ["merch", "accessories", "paraphernalia"];

function isMerchCats(categories: string[]): boolean {
  return categories.some((c) => MERCH_TOKENS.includes(c.toLowerCase()));
}

function maxTier(tiers: Tier[] | undefined, fallback: Tier[]): number {
  const t = tiers?.length ? tiers : fallback;
  return t.reduce((m, x) => Math.max(m, x.percent), 0);
}

/**
 * The LARGEST percent discount a promotion's mechanics can ever produce on a
 * single unit (conservative — assumes every threshold/tier is met and, for
 * either/or, whichever option discounts more).
 */
export function worstCaseDiscountPercent(rule: GuardRuleShape): number {
  const cfg = rule.config;
  if (cfg.eitherOr) {
    const { flatPercent, bundle } = cfg.eitherOr;
    const bundlePct = bundle.n > 0 ? ((bundle.n - bundle.m) / bundle.n) * 100 : 0;
    return Math.min(99, Math.max(flatPercent, bundlePct));
  }
  switch (rule.discountType) {
    case "percent":
      return Math.min(99, Math.max(0, rule.discountPercent));
    case "fixed":
      return 0; // handled as an absolute amount in worstCasePrice below
    case "multi_item_tier":
      return Math.min(99, maxTier(cfg.qtyTiers, DEFAULT_QTY_TIERS));
    case "weight_tier":
      return Math.min(99, maxTier(cfg.weightTiers, DEFAULT_WEIGHT_TIERS));
    case "threshold_spend":
      return Math.min(99, maxTier(cfg.spendTiers, DEFAULT_SPEND_TIERS));
    case "bogo": {
      const b = cfg.bogo ?? { buyQty: 1, getQty: 1, getPercent: 100 };
      return Math.min(99, Math.max(0, b.getPercent));
    }
    case "basket": {
      if (cfg.basketTopItem) {
        return Math.min(99, Math.max(cfg.basketTopItem.topPercent, cfg.basketTopItem.restPercent));
      }
      const nm = cfg.basketNforM ?? { n: 3, m: 2 };
      return nm.n > 0 ? Math.min(99, ((nm.n - nm.m) / nm.n) * 100) : 0;
    }
    default:
      return 0;
  }
}

/** The promotion's worst-case discounted unit price for a product. */
export function worstCasePriceMinorUnits(rule: GuardRuleShape, priceMinorUnits: number): number {
  if (rule.discountType === "fixed" && !rule.config.eitherOr) {
    return Math.max(0, priceMinorUnits - Math.max(0, rule.discountFixed));
  }
  const pct = worstCaseDiscountPercent(rule);
  return Math.round(priceMinorUnits * (1 - pct / 100));
}

/**
 * Scan the products a promotion affects and return every below-cost finding.
 *  - "below_cost": the worst-case discounted price dips under the cost floor
 *    → publishing MUST be blocked.
 *  - "regular_below_cost": the REGULAR price is already at/below the floor —
 *    a pricing problem worth fixing regardless of the promotion.
 *  - "cost_unknown": no acquisition cost on file — the floor cannot be
 *    verified for this product (warning, not a block).
 */
export function findBelowCost(
  rule: GuardRuleShape,
  products: GuardProduct[],
): BelowCostFinding[] {
  const findings: BelowCostFinding[] = [];
  for (const p of products) {
    const merch = isMerchCats(p.categories);
    const floor = costFloorMinorUnits(p.costMinorUnits, merch);
    const worst = worstCasePriceMinorUnits(rule, p.priceMinorUnits);
    if (p.costMinorUnits == null || p.costMinorUnits <= 0) {
      findings.push({
        key: p.key,
        name: p.name,
        brand: p.brand,
        priceMinorUnits: p.priceMinorUnits,
        costMinorUnits: p.costMinorUnits ?? null,
        floorMinorUnits: 0,
        worstCasePriceMinorUnits: worst,
        reason: "cost_unknown",
      });
      continue;
    }
    if (p.priceMinorUnits <= floor) {
      findings.push({
        key: p.key,
        name: p.name,
        brand: p.brand,
        priceMinorUnits: p.priceMinorUnits,
        costMinorUnits: p.costMinorUnits,
        floorMinorUnits: floor,
        worstCasePriceMinorUnits: worst,
        reason: "regular_below_cost",
      });
      continue;
    }
    if (worst < floor) {
      findings.push({
        key: p.key,
        name: p.name,
        brand: p.brand,
        priceMinorUnits: p.priceMinorUnits,
        costMinorUnits: p.costMinorUnits,
        floorMinorUnits: floor,
        worstCasePriceMinorUnits: worst,
        reason: "below_cost",
      });
    }
  }
  return findings;
}

/** True when publishing must be HARD-BLOCKED (any true below-cost finding). */
export function hasPublishBlock(findings: BelowCostFinding[]): boolean {
  return findings.some((f) => f.reason === "below_cost");
}

// ---------------------------------------------------------------------------
// Self-tests (pure).
// ---------------------------------------------------------------------------
export function __runPromoGuardTests(): void {
  let passed = 0;
  let failed = 0;
  const expect = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log(`FAIL: ${name}`);
    }
  };

  const rule = (over: Partial<GuardRuleShape>): GuardRuleShape => ({
    discountType: "percent",
    discountPercent: 0,
    discountFixed: 0,
    config: {},
    ...over,
  });

  // Worst-case percent per mechanic.
  expect("wc percent", worstCaseDiscountPercent(rule({ discountPercent: 25 })) === 25);
  expect("wc qty tiers default", worstCaseDiscountPercent(rule({ discountType: "multi_item_tier" })) === 25);
  expect("wc weight tiers default", worstCaseDiscountPercent(rule({ discountType: "weight_tier" })) === 30);
  expect("wc spend tiers default", worstCaseDiscountPercent(rule({ discountType: "threshold_spend" })) === 30);
  expect(
    "wc bogo capped 99",
    worstCaseDiscountPercent(rule({ discountType: "bogo", config: { bogo: { buyQty: 1, getQty: 1, getPercent: 100 } } })) === 99,
  );
  expect(
    "wc basket top-item",
    worstCaseDiscountPercent(rule({ discountType: "basket", config: { basketTopItem: { topPercent: 30, restPercent: 15 } } })) === 30,
  );
  {
    const pct = worstCaseDiscountPercent(rule({ discountType: "basket", config: { basketNforM: { n: 3, m: 2 } } }));
    expect("wc 3for2 ≈ 33.3", pct > 33 && pct < 34);
  }
  {
    const pct = worstCaseDiscountPercent(
      rule({ discountType: "multi_item_tier", config: { eitherOr: { flatPercent: 20, bundle: { n: 4, m: 3 } } } }),
    );
    expect("wc eitherOr max(20, 25)", pct === 25);
  }

  // Fixed worst-case price.
  expect("wc fixed price", worstCasePriceMinorUnits(rule({ discountType: "fixed", discountFixed: 300 }), 1000) === 700);

  // findBelowCost: $20 item costing $12 pre-tax → floor 1756; 25% off → 1500 < floor ⇒ BLOCK.
  {
    const products: GuardProduct[] = [
      { key: "a", name: "A", brand: "B", categories: ["flower"], priceMinorUnits: 2000, costMinorUnits: 1200 },
    ];
    const f = findBelowCost(rule({ discountPercent: 25 }), products);
    expect("below cost flagged", f.length === 1 && f[0].reason === "below_cost");
    expect("publish blocked", hasPublishBlock(f));
  }
  // Safe margin: $20 item costing $5 → floor 732; 25% off → 1500 ≥ 732 ⇒ clear.
  {
    const products: GuardProduct[] = [
      { key: "a", name: "A", brand: "B", categories: ["flower"], priceMinorUnits: 2000, costMinorUnits: 500 },
    ];
    const f = findBelowCost(rule({ discountPercent: 25 }), products);
    expect("safe margin clear", f.length === 0);
  }
  // Cost unknown → warning, no block.
  {
    const products: GuardProduct[] = [
      { key: "a", name: "A", brand: "B", categories: ["flower"], priceMinorUnits: 2000, costMinorUnits: null },
    ];
    const f = findBelowCost(rule({ discountPercent: 25 }), products);
    expect("cost unknown warns", f.length === 1 && f[0].reason === "cost_unknown");
    expect("cost unknown no block", !hasPublishBlock(f));
  }
  // Regular already below cost → pricing problem, not a promo block.
  {
    const products: GuardProduct[] = [
      { key: "a", name: "A", brand: "B", categories: ["flower"], priceMinorUnits: 1000, costMinorUnits: 900 },
    ];
    const f = findBelowCost(rule({ discountPercent: 10 }), products);
    expect("regular below cost flagged", f.length === 1 && f[0].reason === "regular_below_cost");
    expect("regular below cost no publish block", !hasPublishBlock(f));
  }
  // Merch uses the 1.093 divisor.
  {
    const products: GuardProduct[] = [
      { key: "a", name: "A", brand: "B", categories: ["merch"], priceMinorUnits: 1200, costMinorUnits: 1000 },
    ];
    // Floor = ceil(1000 × 1.093) = 1093; 10% off 1200 = 1080 < 1093 ⇒ block.
    const f = findBelowCost(rule({ discountPercent: 10 }), products);
    expect("merch divisor floor", f.length === 1 && f[0].reason === "below_cost" && f[0].floorMinorUnits === 1093);
  }

  console.log(`promo-guard: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} promo-guard tests failed`);
}
