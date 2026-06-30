/**
 * src/lib/promotions/discount-engine-core.ts
 *
 * POS-GRADE GENERIC DISCOUNT ENGINE (pure — no React, no DB, no server-only).
 *
 * Slice 39 generalises the hard-coded weekday cart engine in
 * src/lib/specials/cart-discount.ts into a single, data-driven engine that can
 * evaluate ANY promotion (its discount_type + a structured `config`) against a
 * cart and produce the AUTHORITATIVE per-line discount — exactly the way a real
 * point-of-sale register applies deals.
 *
 * Design goals (grounded in the existing data + behaviour):
 *  - The seven discount_types from migration 0006 are all handled here:
 *      percent, fixed, bogo, threshold_spend, multi_item_tier, weight_tier, basket.
 *  - Tier breakpoints live in `config` (see EngineConfig) so staff can edit them
 *    without code. DEFAULTS exactly match the current hard-coded cart engine
 *    (Ounce Friday 7/14/28g → 15/20/30; Doobie Tuesday 2+→15 / 4+→25; Wax
 *    Wednesday $50/$100/$150 → 15/20/30; Super Saturday 30% top item + 15%;
 *    Ice Cream Sunday 3-for-2) so migrated promos behave identically.
 *  - EXCLUSIVITY: like a POS, by default each cart line keeps the SINGLE best
 *    deal (highest savings) among all matching promotions ("best-deal-wins").
 *    A promotion may opt into stacking via config.stackable=true.
 *  - Targets minus exclusions decide which lines a promotion can touch; merch /
 *    accessories never receive cannabis deals unless explicitly targeted.
 *
 * This module is unit-tested via __runDiscountEngineTests() and is the planned
 * single source of truth the storefront/cart, checkout, and the admin
 * simulator all consume.
 */

export type DiscountType =
  | "percent"
  | "fixed"
  | "bogo"
  | "threshold_spend"
  | "multi_item_tier"
  | "weight_tier"
  | "basket";

/** A cart line the engine evaluates. Prices in MINOR UNITS (cents). */
export type EngineCartLine = {
  lineId: string;
  /** TRUE regular (pre-discount) per-unit price, tax-inclusive, minor units. */
  regularPriceMinorUnits: number;
  quantity: number;
  /** Lowercased category tokens this line belongs to (filter categories preferred). */
  categories: string[];
  brand?: string | null;
  /** POS product key for product-scoped targeting. */
  productKey?: string | null;
  /** Variant label, e.g. "3.5g", "1oz" — used by weight tiers. */
  variantLabel?: string | null;
};

/** Normalised rule the engine consumes (derived from a PublishedPromotion). */
export type EngineRule = {
  id: string;
  title: string;
  discountType: DiscountType;
  /** Headline percent (0–100) for percent / per-item / tier headline. */
  discountPercent: number;
  /** Fixed amount off per unit, minor units (discount_type='fixed'). */
  discountFixed: number;
  priority: number;
  /** When true, this promotion may stack on top of others (default false). */
  stackable: boolean;
  storewide: boolean;
  targetCategories: string[];
  targetBrands: string[];
  targetProductKeys: string[];
  excludeCategories: string[];
  excludeBrands: string[];
  excludeProductKeys: string[];
  config: EngineConfig;
};

/** A single tier breakpoint: at >= `at` (qty / grams / spend) apply `percent`. */
export type Tier = { at: number; percent: number };

/** Structured POS config stored in promotions.config. All fields optional. */
export type EngineConfig = {
  /** Multi-item quantity tiers (multi_item_tier). */
  qtyTiers?: Tier[];
  /** Weight tiers in GRAMS (weight_tier). */
  weightTiers?: Tier[];
  /** Spend tiers in MINOR UNITS (threshold_spend). */
  spendTiers?: Tier[];
  /** BOGO: buy `buyQty`, get `getQty` at `getPercent`% off (cheapest discounted). */
  bogo?: { buyQty: number; getQty: number; getPercent: number };
  /** Basket: "buy N for the price of M" (basket: cheapest become free/discounted). */
  basketNforM?: { n: number; m: number };
  /** Basket: top item at `topPercent`, the rest at `restPercent` (Super Saturday). */
  basketTopItem?: { topPercent: number; restPercent: number };
  /** Whether the promotion stacks with others. */
  stackable?: boolean;
};

export type EngineLineResult = {
  lineId: string;
  unitPriceMinorUnits: number;
  regularPriceMinorUnits: number;
  quantity: number;
  unitSavingsMinorUnits: number;
  appliedRuleId?: string;
  appliedLabel?: string;
  appliedPercent: number;
};

export type EngineResult = {
  lines: EngineLineResult[];
  totalRegularMinorUnits: number;
  totalDiscountedMinorUnits: number;
  totalSavingsMinorUnits: number;
  /** Per-rule savings summary (for the simulator / receipts). */
  byRule: { ruleId: string; title: string; savingsMinorUnits: number }[];
};

const MERCH_TOKENS = ["merch", "accessories", "paraphernalia"];

function round(n: number): number {
  return Math.round(n);
}

// ---------------------------------------------------------------------------
// Default tier breakpoints — EXACTLY mirror src/lib/specials/cart-discount.ts
// so existing seeded promotions behave identically when config is empty.
// ---------------------------------------------------------------------------
export const DEFAULT_QTY_TIERS: Tier[] = [
  { at: 2, percent: 15 },
  { at: 4, percent: 25 },
];
export const DEFAULT_WEIGHT_TIERS: Tier[] = [
  { at: 7, percent: 15 }, // quarter ounce
  { at: 14, percent: 20 }, // half ounce
  { at: 28, percent: 30 }, // ounce
];
export const DEFAULT_SPEND_TIERS: Tier[] = [
  { at: 5000, percent: 15 }, // $50+
  { at: 10000, percent: 20 }, // $100+
  { at: 15000, percent: 30 }, // $150+
];

/** Pick the highest tier whose threshold is met. Returns 0 when none met. */
export function tierPercent(value: number, tiers: Tier[]): number {
  let pct = 0;
  for (const t of tiers) {
    if (value >= t.at && t.percent > pct) pct = t.percent;
  }
  return pct;
}

/** "1oz" => 28, "3.5g" => 3.5. Cannabis ounce = 28g (matches cart-discount.ts). */
export function gramsForLabel(label?: string | null): number {
  if (!label) return 0;
  const s = label.trim().toLowerCase();
  const oz = s.match(/([\d.]+)\s*(oz|ounce)/);
  if (oz) return parseFloat(oz[1]) * 28;
  const g = s.match(/([\d.]+)\s*g\b/);
  if (g) return parseFloat(g[1]);
  return 0;
}

function isMerch(line: EngineCartLine): boolean {
  return line.categories.some((c) => MERCH_TOKENS.includes(c.toLowerCase()));
}

function hasCi(list: string[], value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return list.some((x) => x.trim().toLowerCase() === v);
}

/** Does a rule's targets (minus exclusions) match this line? */
export function ruleMatchesLine(rule: EngineRule, line: EngineCartLine): boolean {
  // Exclusions win.
  if (line.categories.some((c) => hasCi(rule.excludeCategories, c))) return false;
  if (hasCi(rule.excludeBrands, line.brand)) return false;
  if (hasCi(rule.excludeProductKeys, line.productKey)) return false;

  if (rule.storewide) {
    // Storewide cannabis deals never touch merch/accessories unless explicitly targeted.
    if (isMerch(line)) return false;
    return true;
  }
  // Otherwise must match at least one target dimension.
  const catMatch = line.categories.some((c) => hasCi(rule.targetCategories, c));
  const brandMatch = hasCi(rule.targetBrands, line.brand);
  const keyMatch = hasCi(rule.targetProductKeys, line.productKey);
  return catMatch || brandMatch || keyMatch;
}

// ---------------------------------------------------------------------------
// Per-promotion computation → produces a savings amount per matched line.
// Returns a map lineId → { unitPrice, percent, savings(total for the line) }.
// ---------------------------------------------------------------------------
type LineDiscount = { unitPrice: number; percent: number; label: string };

function flatPercentDiscount(line: EngineCartLine, percent: number, label: string): LineDiscount {
  const p = Math.max(0, Math.min(100, percent));
  const unit = round(line.regularPriceMinorUnits * (1 - p / 100));
  return { unitPrice: unit, percent: p, label: `${label} · ${p}% off` };
}

/**
 * Compute one promotion's discounts across the cart. Returns line-level results
 * keyed by lineId (only matched lines that actually receive a discount).
 */
export function applyOnePromotion(
  rule: EngineRule,
  lines: EngineCartLine[],
): Map<string, LineDiscount> {
  const out = new Map<string, LineDiscount>();
  const eligible = lines.filter((l) => ruleMatchesLine(rule, l));
  if (eligible.length === 0) return out;

  switch (rule.discountType) {
    case "percent": {
      if (rule.discountPercent <= 0) break;
      for (const l of eligible) {
        out.set(l.lineId, flatPercentDiscount(l, rule.discountPercent, rule.title));
      }
      break;
    }
    case "fixed": {
      const off = Math.max(0, rule.discountFixed);
      if (off <= 0) break;
      for (const l of eligible) {
        const unit = Math.max(0, l.regularPriceMinorUnits - off);
        const pct = l.regularPriceMinorUnits > 0 ? round(((l.regularPriceMinorUnits - unit) / l.regularPriceMinorUnits) * 100) : 0;
        out.set(l.lineId, { unitPrice: unit, percent: pct, label: `${rule.title} · $${(off / 100).toFixed(2)} off` });
      }
      break;
    }
    case "multi_item_tier": {
      const tiers = rule.config.qtyTiers?.length ? rule.config.qtyTiers : DEFAULT_QTY_TIERS;
      const totalQty = eligible.reduce((s, l) => s + l.quantity, 0);
      const pct = tierPercent(totalQty, tiers);
      if (pct <= 0) break;
      for (const l of eligible) out.set(l.lineId, flatPercentDiscount(l, pct, rule.title));
      break;
    }
    case "weight_tier": {
      const tiers = rule.config.weightTiers?.length ? rule.config.weightTiers : DEFAULT_WEIGHT_TIERS;
      const grams = eligible.reduce((s, l) => s + gramsForLabel(l.variantLabel) * l.quantity, 0);
      const pct = tierPercent(grams, tiers);
      if (pct <= 0) break;
      for (const l of eligible) out.set(l.lineId, flatPercentDiscount(l, pct, rule.title));
      break;
    }
    case "threshold_spend": {
      const tiers = rule.config.spendTiers?.length ? rule.config.spendTiers : DEFAULT_SPEND_TIERS;
      const spend = eligible.reduce((s, l) => s + l.regularPriceMinorUnits * l.quantity, 0);
      const pct = tierPercent(spend, tiers);
      if (pct <= 0) break;
      for (const l of eligible) out.set(l.lineId, flatPercentDiscount(l, pct, rule.title));
      break;
    }
    case "bogo": {
      // Expand units ascending; the cheapest `getQty` per `buyQty+getQty` group
      // get `getPercent`% off. Default: buy 1 get 1 free.
      const cfg = rule.config.bogo ?? { buyQty: 1, getQty: 1, getPercent: 100 };
      const groupSize = Math.max(1, cfg.buyQty + cfg.getQty);
      const units: { lineId: string; price: number }[] = [];
      for (const l of eligible) {
        for (let i = 0; i < l.quantity; i += 1) units.push({ lineId: l.lineId, price: l.regularPriceMinorUnits });
      }
      units.sort((a, b) => a.price - b.price);
      const groups = Math.floor(units.length / groupSize);
      const discountUnits = groups * cfg.getQty;
      const savingsByLine = new Map<string, number>();
      for (let i = 0; i < discountUnits; i += 1) {
        const u = units[i];
        savingsByLine.set(u.lineId, (savingsByLine.get(u.lineId) ?? 0) + round(u.price * (cfg.getPercent / 100)));
      }
      blendSavings(eligible, savingsByLine, out, `${rule.title} · BOGO`);
      break;
    }
    case "basket": {
      if (rule.config.basketTopItem) {
        // Top item at topPercent, the rest at restPercent (Super Saturday).
        const { topPercent, restPercent } = rule.config.basketTopItem;
        let topId: string | null = null;
        let top = -1;
        for (const l of eligible) {
          if (l.regularPriceMinorUnits > top) {
            top = l.regularPriceMinorUnits;
            topId = l.lineId;
          }
        }
        for (const l of eligible) {
          if (l.lineId === topId) {
            if (l.quantity <= 1) {
              out.set(l.lineId, flatPercentDiscount(l, topPercent, rule.title));
            } else {
              const oneAtTop = round(l.regularPriceMinorUnits * (1 - topPercent / 100));
              const restAt = round(l.regularPriceMinorUnits * (1 - restPercent / 100));
              const blendedTotal = oneAtTop + restAt * (l.quantity - 1);
              const blendedUnit = round(blendedTotal / l.quantity);
              out.set(l.lineId, {
                unitPrice: blendedUnit,
                percent: restPercent,
                label: `${rule.title} · ${topPercent}% top + ${restPercent}%`,
              });
            }
          } else {
            out.set(l.lineId, flatPercentDiscount(l, restPercent, rule.title));
          }
        }
      } else {
        // "buy N for the price of M" — cheapest (N-M) per group become free.
        const cfg = rule.config.basketNforM ?? { n: 3, m: 2 };
        const freePerGroup = Math.max(0, cfg.n - cfg.m);
        const units: { lineId: string; price: number }[] = [];
        for (const l of eligible) {
          for (let i = 0; i < l.quantity; i += 1) units.push({ lineId: l.lineId, price: l.regularPriceMinorUnits });
        }
        units.sort((a, b) => a.price - b.price);
        const groups = Math.floor(units.length / cfg.n);
        const freeCount = groups * freePerGroup;
        const savingsByLine = new Map<string, number>();
        for (let i = 0; i < freeCount; i += 1) {
          const u = units[i];
          savingsByLine.set(u.lineId, (savingsByLine.get(u.lineId) ?? 0) + u.price);
        }
        blendSavings(eligible, savingsByLine, out, `${rule.title} · ${cfg.n} for ${cfg.m}`);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/** Distribute a per-line total-savings map into blended per-unit discounts. */
function blendSavings(
  eligible: EngineCartLine[],
  savingsByLine: Map<string, number>,
  out: Map<string, LineDiscount>,
  label: string,
): void {
  for (const l of eligible) {
    const sav = savingsByLine.get(l.lineId) ?? 0;
    if (sav <= 0) continue;
    const regularLineTotal = l.regularPriceMinorUnits * l.quantity;
    const discountedLineTotal = Math.max(0, regularLineTotal - sav);
    const blendedUnit = round(discountedLineTotal / l.quantity);
    const pct = l.regularPriceMinorUnits > 0
      ? round(((l.regularPriceMinorUnits - blendedUnit) / l.regularPriceMinorUnits) * 100)
      : 0;
    out.set(l.lineId, { unitPrice: blendedUnit, percent: pct, label });
  }
}

// ---------------------------------------------------------------------------
// Cart-level resolution across MANY promotions (POS exclusivity / stacking).
// ---------------------------------------------------------------------------
export function computePromotions(
  lines: EngineCartLine[],
  rules: EngineRule[],
): EngineResult {
  // Start every line at regular price.
  const best = new Map<string, EngineLineResult>();
  for (const l of lines) {
    best.set(l.lineId, {
      lineId: l.lineId,
      unitPriceMinorUnits: l.regularPriceMinorUnits,
      regularPriceMinorUnits: l.regularPriceMinorUnits,
      quantity: l.quantity,
      unitSavingsMinorUnits: 0,
      appliedPercent: 0,
    });
  }

  const byRule = new Map<string, { title: string; savings: number }>();

  // Evaluate rules by priority (higher first) so ties favour the higher-priority promo.
  const ordered = [...rules].sort((a, b) => b.priority - a.priority);
  for (const rule of ordered) {
    const discounts = applyOnePromotion(rule, lines);
    for (const [lineId, d] of discounts.entries()) {
      const line = lines.find((l) => l.lineId === lineId);
      if (!line) continue;
      const current = best.get(lineId)!;
      const newSavingsPerUnit = line.regularPriceMinorUnits - d.unitPrice;

      if (rule.stackable && current.unitSavingsMinorUnits > 0) {
        // Stack: apply this percentage on top of the already-discounted price.
        const stackedUnit = round(current.unitPriceMinorUnits * (1 - d.percent / 100));
        const totalSavingsUnit = line.regularPriceMinorUnits - stackedUnit;
        best.set(lineId, {
          ...current,
          unitPriceMinorUnits: stackedUnit,
          unitSavingsMinorUnits: totalSavingsUnit,
          appliedRuleId: rule.id,
          appliedLabel: `${current.appliedLabel ?? ""} + ${d.label}`.trim(),
          appliedPercent: d.percent,
        });
      } else if (newSavingsPerUnit > current.unitSavingsMinorUnits) {
        // Best-deal-wins (exclusive).
        best.set(lineId, {
          ...current,
          unitPriceMinorUnits: d.unitPrice,
          unitSavingsMinorUnits: newSavingsPerUnit,
          appliedRuleId: rule.id,
          appliedLabel: d.label,
          appliedPercent: d.percent,
        });
      }
    }
  }

  // Tally per-rule savings from the FINAL applied results (avoids double counting).
  for (const r of best.values()) {
    if (r.appliedRuleId && r.unitSavingsMinorUnits > 0) {
      const rule = rules.find((x) => x.id === r.appliedRuleId);
      const title = rule?.title ?? "Promotion";
      const entry = byRule.get(r.appliedRuleId) ?? { title, savings: 0 };
      entry.savings += r.unitSavingsMinorUnits * r.quantity;
      byRule.set(r.appliedRuleId, entry);
    }
  }

  const resultLines = lines.map((l) => best.get(l.lineId)!);
  const totalRegularMinorUnits = resultLines.reduce((s, r) => s + r.regularPriceMinorUnits * r.quantity, 0);
  const totalDiscountedMinorUnits = resultLines.reduce((s, r) => s + r.unitPriceMinorUnits * r.quantity, 0);
  const totalSavingsMinorUnits = Math.max(0, totalRegularMinorUnits - totalDiscountedMinorUnits);

  return {
    lines: resultLines,
    totalRegularMinorUnits,
    totalDiscountedMinorUnits,
    totalSavingsMinorUnits,
    byRule: Array.from(byRule.entries()).map(([ruleId, v]) => ({
      ruleId,
      title: v.title,
      savingsMinorUnits: v.savings,
    })),
  };
}

export function formatMoneyMinor(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Tests (pure). Verified against src/lib/specials/cart-discount.ts behaviour.
// ---------------------------------------------------------------------------
export function __runDiscountEngineTests(): void {
  let passed = 0;
  let failed = 0;
  function expect(name: string, cond: boolean) {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      console.log(`FAIL: ${name}`);
    }
  }

  const baseRule = (over: Partial<EngineRule>): EngineRule => ({
    id: "r1",
    title: "Deal",
    discountType: "percent",
    discountPercent: 0,
    discountFixed: 0,
    priority: 10,
    stackable: false,
    storewide: false,
    targetCategories: [],
    targetBrands: [],
    targetProductKeys: [],
    excludeCategories: [],
    excludeBrands: [],
    excludeProductKeys: [],
    config: {},
    ...over,
  });

  // gramsForLabel
  expect("grams oz", gramsForLabel("1oz") === 28);
  expect("grams 3.5g", gramsForLabel("3.5g") === 3.5);
  expect("grams empty", gramsForLabel(null) === 0);

  // tierPercent
  expect("tier none", tierPercent(1, DEFAULT_QTY_TIERS) === 0);
  expect("tier 2", tierPercent(2, DEFAULT_QTY_TIERS) === 15);
  expect("tier 4", tierPercent(4, DEFAULT_QTY_TIERS) === 25);
  expect("tier weight 7", tierPercent(7, DEFAULT_WEIGHT_TIERS) === 15);
  expect("tier weight 28", tierPercent(28, DEFAULT_WEIGHT_TIERS) === 30);
  expect("tier spend 150", tierPercent(15000, DEFAULT_SPEND_TIERS) === 30);

  // percent (Munchie Monday: 25% off edibles)
  {
    const rule = baseRule({ discountType: "percent", discountPercent: 25, targetCategories: ["edible-solid"] });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, categories: ["edible-solid"] },
      { lineId: "b", regularPriceMinorUnits: 2000, quantity: 1, categories: ["flower"] },
    ];
    const r = computePromotions(lines, [rule]);
    const a = r.lines.find((l) => l.lineId === "a")!;
    const b = r.lines.find((l) => l.lineId === "b")!;
    expect("percent applies edible", a.unitPriceMinorUnits === 750);
    expect("percent skips flower", b.unitPriceMinorUnits === 2000);
    expect("percent total savings", r.totalSavingsMinorUnits === 250);
  }

  // fixed
  {
    const rule = baseRule({ discountType: "fixed", discountFixed: 300, targetCategories: ["vape"] });
    const lines: EngineCartLine[] = [{ lineId: "a", regularPriceMinorUnits: 1000, quantity: 2, categories: ["vape"] }];
    const r = computePromotions(lines, [rule]);
    expect("fixed unit", r.lines[0].unitPriceMinorUnits === 700);
    expect("fixed total", r.totalSavingsMinorUnits === 600);
  }

  // multi_item_tier (Doobie Tuesday): 4 prerolls → 25%
  {
    const rule = baseRule({ discountType: "multi_item_tier", targetCategories: ["preroll"] });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 500, quantity: 2, categories: ["preroll"] },
      { lineId: "b", regularPriceMinorUnits: 500, quantity: 2, categories: ["preroll"] },
    ];
    const r = computePromotions(lines, [rule]);
    expect("qtytier 4 => 25%", r.lines[0].unitPriceMinorUnits === 375);
  }
  {
    const rule = baseRule({ discountType: "multi_item_tier", targetCategories: ["preroll"] });
    const lines: EngineCartLine[] = [{ lineId: "a", regularPriceMinorUnits: 500, quantity: 1, categories: ["preroll"] }];
    const r = computePromotions(lines, [rule]);
    expect("qtytier 1 => none", r.lines[0].unitPriceMinorUnits === 500);
  }

  // weight_tier (Ounce Friday): 8 × 3.5g = 28g → 30%
  {
    const rule = baseRule({ discountType: "weight_tier", targetCategories: ["flower"] });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 8, categories: ["flower"], variantLabel: "3.5g" },
    ];
    const r = computePromotions(lines, [rule]);
    expect("weight 28g => 30%", r.lines[0].unitPriceMinorUnits === 700);
  }
  {
    const rule = baseRule({ discountType: "weight_tier", targetCategories: ["flower"] });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 2, categories: ["flower"], variantLabel: "3.5g" },
    ];
    const r = computePromotions(lines, [rule]);
    expect("weight 7g => 15%", r.lines[0].unitPriceMinorUnits === 850);
  }

  // threshold_spend (Wax Wednesday): $150 spend → 30%
  {
    const rule = baseRule({ discountType: "threshold_spend", targetCategories: ["concentrate"] });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 5000, quantity: 3, categories: ["concentrate"] },
    ];
    const r = computePromotions(lines, [rule]);
    expect("spend 15000 => 30%", r.lines[0].unitPriceMinorUnits === 3500);
  }

  // bogo: 2 units, BOGO free → 1 free (cheapest)
  {
    const rule = baseRule({ discountType: "bogo", targetCategories: ["flower"], config: { bogo: { buyQty: 1, getQty: 1, getPercent: 100 } } });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, categories: ["flower"] },
      { lineId: "b", regularPriceMinorUnits: 2000, quantity: 1, categories: ["flower"] },
    ];
    const r = computePromotions(lines, [rule]);
    // Cheapest (a, $10) is free.
    expect("bogo cheapest free", r.lines.find((l) => l.lineId === "a")!.unitPriceMinorUnits === 0);
    expect("bogo other full", r.lines.find((l) => l.lineId === "b")!.unitPriceMinorUnits === 2000);
    expect("bogo savings", r.totalSavingsMinorUnits === 1000);
  }

  // basket top-item (Super Saturday): top 30%, rest 15%
  {
    const rule = baseRule({ discountType: "basket", storewide: true, config: { basketTopItem: { topPercent: 30, restPercent: 15 } } });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, categories: ["flower"] },
      { lineId: "b", regularPriceMinorUnits: 5000, quantity: 1, categories: ["flower"] },
    ];
    const r = computePromotions(lines, [rule]);
    expect("basket top 30%", r.lines.find((l) => l.lineId === "b")!.unitPriceMinorUnits === 3500);
    expect("basket rest 15%", r.lines.find((l) => l.lineId === "a")!.unitPriceMinorUnits === 850);
  }

  // basket N-for-M (Ice Cream Sunday): 3 units → cheapest free
  {
    const rule = baseRule({ discountType: "basket", storewide: true, config: { basketNforM: { n: 3, m: 2 } } });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 3, categories: ["edible-solid"] },
    ];
    const r = computePromotions(lines, [rule]);
    // 3 units, 1 free → line total 2000 over 3 units → blended 667 (×3 = 2001),
    // so reported savings is 999 after per-unit rounding (POS rounds per unit).
    expect("basket 3for2 savings", r.totalSavingsMinorUnits === 999);
  }

  // storewide skips merch
  {
    const rule = baseRule({ discountType: "percent", discountPercent: 20, storewide: true });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, categories: ["merch"] },
      { lineId: "b", regularPriceMinorUnits: 1000, quantity: 1, categories: ["flower"] },
    ];
    const r = computePromotions(lines, [rule]);
    expect("storewide skips merch", r.lines.find((l) => l.lineId === "a")!.unitPriceMinorUnits === 1000);
    expect("storewide hits cannabis", r.lines.find((l) => l.lineId === "b")!.unitPriceMinorUnits === 800);
  }

  // exclusion wins
  {
    const rule = baseRule({ discountType: "percent", discountPercent: 20, targetCategories: ["flower"], excludeBrands: ["Premium"] });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, categories: ["flower"], brand: "Premium" },
    ];
    const r = computePromotions(lines, [rule]);
    expect("exclusion wins", r.lines[0].unitPriceMinorUnits === 1000);
  }

  // best-deal-wins between two exclusive promos
  {
    const r10 = baseRule({ id: "r10", title: "10%", discountType: "percent", discountPercent: 10, targetCategories: ["flower"], priority: 5 });
    const r30 = baseRule({ id: "r30", title: "30%", discountType: "percent", discountPercent: 30, targetCategories: ["flower"], priority: 5 });
    const lines: EngineCartLine[] = [{ lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, categories: ["flower"] }];
    const r = computePromotions(lines, [r10, r30]);
    expect("best deal wins 30", r.lines[0].unitPriceMinorUnits === 700);
    expect("best deal rule id", r.lines[0].appliedRuleId === "r30");
  }

  // stacking when opted in
  {
    const r10 = baseRule({ id: "r10", title: "10%", discountType: "percent", discountPercent: 10, targetCategories: ["flower"], priority: 10, stackable: true });
    const r20 = baseRule({ id: "r20", title: "20%", discountType: "percent", discountPercent: 20, targetCategories: ["flower"], priority: 5, stackable: true });
    const lines: EngineCartLine[] = [{ lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, categories: ["flower"] }];
    const r = computePromotions(lines, [r10, r20]);
    // 1000 -> 900 (10%) -> 720 (20% of 900).
    expect("stack two", r.lines[0].unitPriceMinorUnits === 720);
  }

  console.log(`discount-engine: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} discount-engine tests failed`);
}
