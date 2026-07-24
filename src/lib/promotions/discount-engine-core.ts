/**
 * src/lib/promotions/discount-engine-core.ts
 *
 * POS-GRADE GENERIC DISCOUNT ENGINE (pure — no React, no DB, no server-only).
 *
 * Slice 39 generalised the hard-coded weekday cart engine in
 * src/lib/specials/cart-discount.ts into a single, data-driven engine that can
 * evaluate ANY promotion (its discount_type + a structured `config`) against a
 * cart and produce the AUTHORITATIVE per-line discount — exactly the way a real
 * point-of-sale register applies deals.
 *
 * Task R hardened it to the CCRS Upload User Guide's discount rules (see
 * docs/PROMOTIONS_COMPLIANCE.md — every rule below was verified, not guessed):
 *
 *  1. COST FLOOR (hard rule): "may not discount the sale price below the cost
 *     of acquisition" (CCRS guide, Sale.csv Discount field; RCW 69.50.357).
 *     Lines may carry `costMinorUnits` (pre-tax acquisition cost). Every
 *     mechanic clamps the discounted unit price to
 *     ceil(cost × tax-inclusive divisor) — cannabis 1.463, non-cannabis 1.093 —
 *     rounded UP so revenue can never round below cost. Blended/spread
 *     mechanics clamp AFTER blending. When cost is unknown, the statutory
 *     positive floor still applies (cannabis is never free; 99% percent cap).
 *  2. NO STACKING (owner hard block): each cart line receives EXACTLY ONE
 *     promotion — the highest savings; priority breaks ties. The former
 *     opt-in `stackable` flag was removed and legacy configs are ignored.
 *  3. STORE-ADVANTAGED conventions: percent spreads round DOWN to whole
 *     percents, group counts round DOWN, cost floors round UP, and the
 *     either/or mechanic picks the option with the SMALLER total savings when
 *     both qualify (deterministic and identical for every customer, so it
 *     remains "available to all who meet the discount conditions").
 *  4. Bundle deals (basket N-for-M and either/or bundles) SPREAD the savings:
 *     the cheapest (N−M) units per full group set the savings target, which is
 *     converted to an equivalent whole-number percent of the eligible basket
 *     and applied across ALL eligible lines — matching the live checkout
 *     engine's Ice Cream Sunday behaviour, so no unit is ever free.
 *
 * Design goals (grounded in the existing data + behaviour):
 *  - The seven discount_types from migration 0006 are all handled here:
 *      percent, fixed, bogo, threshold_spend, multi_item_tier, weight_tier, basket.
 *  - Tier breakpoints live in `config` (see EngineConfig) so staff can edit them
 *    without code.
 *  - EXCLUSIVITY: each cart line keeps the SINGLE best deal (best-deal-wins).
 *  - Targets minus exclusions decide which lines a promotion can touch; merch /
 *    accessories never receive cannabis deals unless explicitly targeted.
 *
 * This module is unit-tested via __runDiscountEngineTests() and is the single
 * source of truth the admin simulator consumes (checkout uses the parallel
 * weekday engine in src/lib/specials/cart-discount.ts with the same floors).
 */
import {
  clampCannabisUnitPrice,
  TAX_INCLUSIVE_DIVISOR,
  NON_CANNABIS_TAX_INCLUSIVE_DIVISOR,
} from "@/lib/orders/order-pricing-core";
import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";

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
  /**
   * Acquisition cost per unit, PRE-TAX vendor cost in minor units, when known
   * (weighted-average lot cost). Drives the CCRS cost floor. Null/undefined =
   * unknown → statutory floor only.
   */
  costMinorUnits?: number | null;
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
  /** Basket: "buy N for the price of M" (savings spread as an equivalent percent). */
  basketNforM?: { n: number; m: number };
  /**
   * Basket: ONE item at the higher percent, the rest at the lower percent
   * (Super Saturday). STORE-FAVORABLE: the headline percent always lands on
   * the LOWEST-priced eligible item, never the most expensive one.
   */
  basketTopItem?: { topPercent: number; restPercent: number };
  /**
   * Either/or (Doobie Tuesday): a flat percent OR a bundle "buy N for M",
   * whichever yields the SMALLER total savings when both qualify
   * (store-advantaged; deterministic and uniform for every customer).
   */
  eitherOr?: { flatPercent: number; bundle: { n: number; m: number } };
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
  /** Tax-inclusive cost floor for this line (0 = unknown cost). */
  costFloorMinorUnits: number;
  /**
   * True when a promotion applied AND the final unit price sits AT the cost
   * floor — the CCRS clamp (may not discount below the cost of acquisition)
   * limited the advertised deal on this line.
   */
  atCostFloor: boolean;
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
// Default tier breakpoints — mirror src/lib/specials/cart-discount.ts so
// seeded promotions behave identically when config is empty.
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
  if (oz) return parseFloat(oz[1]) * STATUTORY_GRAMS_PER_OUNCE; // GW-016: shared statutory equivalence
  const g = s.match(/([\d.]+)\s*g\b/);
  if (g) return parseFloat(g[1]);
  return 0;
}

function isMerch(line: EngineCartLine): boolean {
  return line.categories.some((c) => MERCH_TOKENS.includes(c.toLowerCase()));
}

// ---------------------------------------------------------------------------
// COST FLOOR (CCRS: never discount below the cost of acquisition)
// ---------------------------------------------------------------------------

/**
 * The tax-INCLUSIVE unit-price floor implied by a pre-tax acquisition cost.
 * ceil() so the pre-tax revenue backed out of the charged price can never
 * round below cost (store-advantaged direction). 0 when cost is unknown.
 */
export function costFloorMinorUnits(
  costMinorUnits: number | null | undefined,
  merch: boolean,
): number {
  if (costMinorUnits == null || !Number.isFinite(costMinorUnits) || costMinorUnits <= 0) return 0;
  const divisor = merch ? NON_CANNABIS_TAX_INCLUSIVE_DIVISOR : TAX_INCLUSIVE_DIVISOR;
  return Math.ceil(costMinorUnits * divisor);
}

/** Convenience: the effective floor for an engine line (never above regular). */
export function lineCostFloor(line: EngineCartLine): number {
  const floor = costFloorMinorUnits(line.costMinorUnits, isMerch(line));
  // If a product's REGULAR price is already at/below cost, that is a pricing
  // problem the below-cost audit surfaces — the engine never RAISES a price
  // above regular, it just refuses to discount.
  return Math.min(floor, Math.max(0, line.regularPriceMinorUnits));
}

/**
 * Clamp a discounted unit price to BOTH floors:
 *  - statutory positive floor for cannabis (RCW 69.50.357 — never free), and
 *  - the acquisition-cost floor when the line's cost is known (CCRS guide).
 */
function clampEngineUnit(line: EngineCartLine, unitPrice: number): number {
  const merch = isMerch(line);
  const category = merch ? "merch" : "flower";
  const statutory = clampCannabisUnitPrice(category, unitPrice, line.regularPriceMinorUnits);
  // Cannabis with regular <= 0 is unsellable data; leave it for the sellable gate.
  if (!merch && line.regularPriceMinorUnits <= 0) return statutory;
  return Math.max(statutory, lineCostFloor(line));
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
  // Cannabis lines cap at 99% (never free — RCW 69.50.357); merch may hit 100%.
  const cap = isMerch(line) ? 100 : 99;
  const p = Math.max(0, Math.min(cap, percent));
  const unit = clampEngineUnit(line, round(line.regularPriceMinorUnits * (1 - p / 100)));
  return { unitPrice: unit, percent: p, label: `${label} · ${p}% off` };
}

/**
 * Bundle "buy N for the price of M" — the cheapest (N−M) units per full group
 * set the savings target; the target is converted to an equivalent whole-number
 * percent of the eligible basket (Math.floor — store-advantaged) and SPREAD
 * across all eligible lines. Matches checkout's Ice Cream Sunday behaviour:
 * every unit keeps a positive, above-cost price.
 */
function bundleSpreadDiscounts(
  eligible: EngineCartLine[],
  n: number,
  m: number,
  label: string,
): Map<string, LineDiscount> {
  const out = new Map<string, LineDiscount>();
  const freePerGroup = Math.max(0, Math.floor(n) - Math.floor(m));
  if (n < 2 || freePerGroup <= 0) return out;
  const units: number[] = [];
  let eligibleTotal = 0;
  for (const l of eligible) {
    eligibleTotal += l.regularPriceMinorUnits * l.quantity;
    for (let i = 0; i < l.quantity; i += 1) units.push(l.regularPriceMinorUnits);
  }
  units.sort((a, b) => a - b);
  const groups = Math.floor(units.length / Math.floor(n));
  if (groups <= 0 || eligibleTotal <= 0) return out;
  let targetSavings = 0;
  for (let i = 0; i < groups * freePerGroup; i += 1) targetSavings += units[i];
  // Equivalent basket-wide percent, floored (store-advantaged), capped at 99.
  const percent = Math.min(99, Math.floor((targetSavings / eligibleTotal) * 100));
  if (percent <= 0) return out;
  for (const l of eligible) {
    const d = flatPercentDiscount(l, percent, label);
    out.set(l.lineId, { ...d, label: `${label} · ${Math.floor(n)} for ${Math.floor(m)} (${percent}% spread)` });
  }
  return out;
}

/** Total savings across a discount map (for either/or comparison). */
function totalSavings(discounts: Map<string, LineDiscount>, lines: EngineCartLine[]): number {
  let sum = 0;
  for (const l of lines) {
    const d = discounts.get(l.lineId);
    if (!d) continue;
    sum += Math.max(0, l.regularPriceMinorUnits - d.unitPrice) * l.quantity;
  }
  return sum;
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

  // Either/or overrides the base mechanic: flat % OR bundle N-for-M, whichever
  // yields the SMALLER total savings when both qualify (store-advantaged).
  if (rule.config.eitherOr) {
    const { flatPercent, bundle } = rule.config.eitherOr;
    const optionA = new Map<string, LineDiscount>();
    if (flatPercent > 0) {
      for (const l of eligible) optionA.set(l.lineId, flatPercentDiscount(l, flatPercent, rule.title));
    }
    const optionB = bundleSpreadDiscounts(eligible, bundle.n, bundle.m, rule.title);
    const savingsA = totalSavings(optionA, eligible);
    const savingsB = totalSavings(optionB, eligible);
    if (savingsA <= 0 && savingsB <= 0) return out;
    // Pick the option with the SMALLER positive savings; a zero-savings option
    // never beats a positive one (the deal must actually apply).
    let chosen: Map<string, LineDiscount>;
    if (savingsA <= 0) chosen = optionB;
    else if (savingsB <= 0) chosen = optionA;
    else chosen = savingsA <= savingsB ? optionA : optionB;
    for (const [k, v] of chosen.entries()) out.set(k, v);
    return out;
  }

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
        const unit = clampEngineUnit(l, Math.max(0, l.regularPriceMinorUnits - off));
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
      // get `getPercent`% off. COMPLIANCE: cannabis units cap at 99% off (no
      // free cannabis — RCW 69.50.357); merch-only lines may still reach 100%.
      const cfg = rule.config.bogo ?? { buyQty: 1, getQty: 1, getPercent: 100 };
      const groupSize = Math.max(1, cfg.buyQty + cfg.getQty);
      const units: { lineId: string; price: number; merch: boolean }[] = [];
      for (const l of eligible) {
        const merch = isMerch(l);
        for (let i = 0; i < l.quantity; i += 1) units.push({ lineId: l.lineId, price: l.regularPriceMinorUnits, merch });
      }
      units.sort((a, b) => a.price - b.price);
      const groups = Math.floor(units.length / groupSize);
      const discountUnits = groups * cfg.getQty;
      const savingsByLine = new Map<string, number>();
      for (let i = 0; i < discountUnits; i += 1) {
        const u = units[i];
        const pct = Math.min(u.merch ? 100 : 99, Math.max(0, cfg.getPercent));
        savingsByLine.set(u.lineId, (savingsByLine.get(u.lineId) ?? 0) + round(u.price * (pct / 100)));
      }
      blendSavings(eligible, savingsByLine, out, `${rule.title} · BOGO`);
      break;
    }
    case "basket": {
      if (rule.config.basketTopItem) {
        // Headline percent on ONE item + rest percent on everything else
        // (Super Saturday). STORE-FAVORABLE (owner directive): the HIGHER of
        // the two percents always lands on the single LOWEST-priced eligible
        // unit — never on the most expensive item in a multi-item cart.
        const { topPercent, restPercent } = rule.config.basketTopItem;
        const headlinePercent = Math.max(topPercent, restPercent);
        const othersPercent = Math.min(topPercent, restPercent);
        let targetId: string | null = null;
        let lowest = Number.POSITIVE_INFINITY;
        for (const l of eligible) {
          if (l.regularPriceMinorUnits < lowest) {
            lowest = l.regularPriceMinorUnits;
            targetId = l.lineId;
          }
        }
        for (const l of eligible) {
          if (l.lineId === targetId) {
            if (l.quantity <= 1) {
              out.set(l.lineId, flatPercentDiscount(l, headlinePercent, rule.title));
            } else {
              const oneAtHeadline = round(l.regularPriceMinorUnits * (1 - headlinePercent / 100));
              const restAt = round(l.regularPriceMinorUnits * (1 - othersPercent / 100));
              const blendedTotal = oneAtHeadline + restAt * (l.quantity - 1);
              const blendedUnit = clampEngineUnit(l, round(blendedTotal / l.quantity));
              out.set(l.lineId, {
                unitPrice: blendedUnit,
                percent: othersPercent,
                label: `${rule.title} · ${headlinePercent}% one item + ${othersPercent}%`,
              });
            }
          } else {
            out.set(l.lineId, flatPercentDiscount(l, othersPercent, rule.title));
          }
        }
      } else {
        // "buy N for the price of M" — SPREAD as an equivalent percent across
        // the eligible basket (the cheapest units set the savings; every unit
        // keeps a positive, above-cost price). Matches checkout Sunday math.
        const cfg = rule.config.basketNforM ?? { n: 3, m: 2 };
        const spread = bundleSpreadDiscounts(eligible, cfg.n, cfg.m, rule.title);
        for (const [k, v] of spread.entries()) out.set(k, v);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/**
 * Distribute a per-line total-savings map into blended per-unit discounts.
 * COMPLIANCE: the blended unit price is clamped to the cannabis price floor AND
 * the acquisition-cost floor, so no basket/BOGO mechanic can zero out a
 * cannabis unit or take it below cost.
 */
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
    const blendedUnit = clampEngineUnit(l, round(discountedLineTotal / l.quantity));
    const pct = l.regularPriceMinorUnits > 0
      ? round(((l.regularPriceMinorUnits - blendedUnit) / l.regularPriceMinorUnits) * 100)
      : 0;
    out.set(l.lineId, { unitPrice: blendedUnit, percent: pct, label });
  }
}

// ---------------------------------------------------------------------------
// Cart-level resolution across MANY promotions.
// NO STACKING (owner hard block): each line keeps exactly ONE promotion — the
// highest savings; priority breaks ties. Legacy `stackable` configs are ignored.
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
      costFloorMinorUnits: lineCostFloor(l),
      atCostFloor: false,
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

      // Best-deal-wins (strictly exclusive — no stacking, ever).
      if (newSavingsPerUnit > current.unitSavingsMinorUnits) {
        const floor = current.costFloorMinorUnits;
        best.set(lineId, {
          ...current,
          unitPriceMinorUnits: d.unitPrice,
          unitSavingsMinorUnits: newSavingsPerUnit,
          appliedRuleId: rule.id,
          appliedLabel: d.label,
          appliedPercent: d.percent,
          atCostFloor: floor > 0 && d.unitPrice <= floor,
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

  // costFloorMinorUnits: ceil(cost × divisor), cannabis 1.463 / merch 1.093.
  expect("cost floor cannabis", costFloorMinorUnits(1000, false) === 1463);
  expect("cost floor cannabis ceil", costFloorMinorUnits(999, false) === Math.ceil(999 * 1.463));
  expect("cost floor merch", costFloorMinorUnits(1000, true) === 1093);
  expect("cost floor unknown", costFloorMinorUnits(null, false) === 0);
  expect("cost floor zero", costFloorMinorUnits(0, false) === 0);

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

  // COST FLOOR: 50% off a $20.00 flower unit that cost $8.00 pre-tax clamps to
  // ceil(800 × 1.463) = 1171 — the sale never dips below acquisition cost.
  {
    const rule = baseRule({ discountType: "percent", discountPercent: 50, targetCategories: ["flower"] });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 2000, quantity: 1, categories: ["flower"], costMinorUnits: 800 },
    ];
    const r = computePromotions(lines, [rule]);
    expect("cost floor clamps percent", r.lines[0].unitPriceMinorUnits === 1171);
  }
  // COST FLOOR on fixed discounts too.
  {
    const rule = baseRule({ discountType: "fixed", discountFixed: 1500, targetCategories: ["flower"] });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 2000, quantity: 1, categories: ["flower"], costMinorUnits: 800 },
    ];
    const r = computePromotions(lines, [rule]);
    expect("cost floor clamps fixed", r.lines[0].unitPriceMinorUnits === 1171);
  }
  // COST FLOOR never RAISES a price above regular (regular below cost = audit's job).
  {
    const rule = baseRule({ discountType: "percent", discountPercent: 10, targetCategories: ["flower"] });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, categories: ["flower"], costMinorUnits: 2000 },
    ];
    const r = computePromotions(lines, [rule]);
    expect("floor capped at regular", r.lines[0].unitPriceMinorUnits === 1000);
  }

  // fixed
  {
    const rule = baseRule({ discountType: "fixed", discountFixed: 300, targetCategories: ["vape"] });
    const lines: EngineCartLine[] = [{ lineId: "a", regularPriceMinorUnits: 1000, quantity: 2, categories: ["vape"] }];
    const r = computePromotions(lines, [rule]);
    expect("fixed unit", r.lines[0].unitPriceMinorUnits === 700);
    expect("fixed total", r.totalSavingsMinorUnits === 600);
  }

  // multi_item_tier (default tiers): 4 prerolls → 25%
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

  // EITHER/OR (Doobie Tuesday): 20% flat OR 4-for-3, the SMALLER savings wins.
  {
    const rule = baseRule({
      discountType: "multi_item_tier",
      targetCategories: ["preroll"],
      config: { eitherOr: { flatPercent: 20, bundle: { n: 4, m: 3 } } },
    });
    // qty 1: only the flat 20% qualifies.
    const one = computePromotions(
      [{ lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, categories: ["preroll"] }],
      [rule],
    );
    expect("eitherOr qty1 flat 20%", one.lines[0].unitPriceMinorUnits === 800);
    // 4 equal $10 prerolls: flat 20% saves $8; 4-for-3 saves $10 → flat (store wins).
    const four = computePromotions(
      [{ lineId: "a", regularPriceMinorUnits: 1000, quantity: 4, categories: ["preroll"] }],
      [rule],
    );
    expect("eitherOr equal prices picks flat", four.totalSavingsMinorUnits === 800);
    // 3 × $20 + 1 × $2: flat saves $12.40; bundle saves $2 (cheapest) → bundle.
    const mixed = computePromotions(
      [
        { lineId: "a", regularPriceMinorUnits: 2000, quantity: 3, categories: ["preroll"] },
        { lineId: "b", regularPriceMinorUnits: 200, quantity: 1, categories: ["preroll"] },
      ],
      [rule],
    );
    // Bundle: target $2 of $62 → floor(3.22%) = 3% spread: a→1940 (×3), b→194.
    expect("eitherOr cheap-unit picks bundle", mixed.totalSavingsMinorUnits < 1240);
    expect(
      "eitherOr bundle spreads across all lines",
      mixed.lines.every((l) => l.unitSavingsMinorUnits > 0),
    );
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

  // bogo on CANNABIS: "get 100% off" caps at 99% — the cheapest unit is
  // discounted to a POSITIVE price, never free (RCW 69.50.357).
  {
    const rule = baseRule({ discountType: "bogo", targetCategories: ["flower"], config: { bogo: { buyQty: 1, getQty: 1, getPercent: 100 } } });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, categories: ["flower"] },
      { lineId: "b", regularPriceMinorUnits: 2000, quantity: 1, categories: ["flower"] },
    ];
    const r = computePromotions(lines, [rule]);
    const a = r.lines.find((l) => l.lineId === "a")!;
    // Cheapest (a, $10) gets 99% off => 10 minor units, never 0.
    expect("bogo cannabis never free", a.unitPriceMinorUnits > 0);
    expect("bogo cannabis 99% cap", a.unitPriceMinorUnits === 10);
    expect("bogo other full", r.lines.find((l) => l.lineId === "b")!.unitPriceMinorUnits === 2000);
    expect("bogo savings", r.totalSavingsMinorUnits === 990);
  }
  // bogo cost floor: the discounted unit can never dip below acquisition cost.
  {
    const rule = baseRule({ discountType: "bogo", targetCategories: ["flower"], config: { bogo: { buyQty: 1, getQty: 1, getPercent: 100 } } });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 2, categories: ["flower"], costMinorUnits: 300 },
    ];
    const r = computePromotions(lines, [rule]);
    // Floor = ceil(300 × 1.463) = 439 per unit; blended line total ≥ 878.
    expect("bogo cost floor holds", r.lines[0].unitPriceMinorUnits >= 439);
  }

  // bogo on MERCH: true freebies remain possible for non-cannabis goods.
  {
    const rule = baseRule({ discountType: "bogo", targetCategories: ["merch"], config: { bogo: { buyQty: 1, getQty: 1, getPercent: 100 } } });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, categories: ["merch"] },
      { lineId: "b", regularPriceMinorUnits: 2000, quantity: 1, categories: ["merch"] },
    ];
    const r = computePromotions(lines, [rule]);
    expect("bogo merch may be free", r.lines.find((l) => l.lineId === "a")!.unitPriceMinorUnits === 0);
  }

  // basket top-item (Super Saturday) — STORE-FAVORABLE: the 30% headline
  // lands on the LOWEST-priced eligible unit; everything else gets 15%.
  {
    const rule = baseRule({ discountType: "basket", storewide: true, config: { basketTopItem: { topPercent: 30, restPercent: 15 } } });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, categories: ["flower"] },
      { lineId: "b", regularPriceMinorUnits: 5000, quantity: 1, categories: ["flower"] },
    ];
    const r = computePromotions(lines, [rule]);
    expect("basket headline 30% on cheapest", r.lines.find((l) => l.lineId === "a")!.unitPriceMinorUnits === 700);
    expect("basket 15% on pricier item", r.lines.find((l) => l.lineId === "b")!.unitPriceMinorUnits === 4250);
  }
  // basket top-item — swapped percents still put the HIGHER percent on the
  // cheapest unit (config order can never aim the headline at the top item).
  {
    const rule = baseRule({ discountType: "basket", storewide: true, config: { basketTopItem: { topPercent: 15, restPercent: 30 } } });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, categories: ["flower"] },
      { lineId: "b", regularPriceMinorUnits: 5000, quantity: 1, categories: ["flower"] },
    ];
    const r = computePromotions(lines, [rule]);
    expect("swapped percents: 30% still on cheapest", r.lines.find((l) => l.lineId === "a")!.unitPriceMinorUnits === 700);
    expect("swapped percents: 15% still on pricier", r.lines.find((l) => l.lineId === "b")!.unitPriceMinorUnits === 4250);
  }

  // basket top-item — BELOW-COST FLOOR double-check: the headline percent on
  // the cheapest unit still clamps at ceil(cost × tax-inclusive divisor).
  {
    const rule = baseRule({ discountType: "basket", storewide: true, config: { basketTopItem: { topPercent: 30, restPercent: 15 } } });
    const lines: EngineCartLine[] = [
      // Cheapest line: 30% off 1000 would be 700, but floor is ceil(600×1.463)=878.
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, categories: ["flower"], costMinorUnits: 600 },
      { lineId: "b", regularPriceMinorUnits: 5000, quantity: 1, categories: ["flower"], costMinorUnits: 600 },
    ];
    const r = computePromotions(lines, [rule]);
    expect("basket headline clamps at cost floor", r.lines.find((l) => l.lineId === "a")!.unitPriceMinorUnits === 878);
    expect("basket rest line unaffected by clamp", r.lines.find((l) => l.lineId === "b")!.unitPriceMinorUnits === 4250);
  }

  // basket N-for-M (Ice Cream Sunday): the cheapest units' value becomes an
  // equivalent whole-number percent SPREAD across all eligible lines
  // (Math.floor — store-advantaged); no unit is ever $0. Matches checkout.
  {
    const rule = baseRule({ discountType: "basket", storewide: true, config: { basketNforM: { n: 3, m: 2 } } });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 3, categories: ["edible-solid"] },
    ];
    const r = computePromotions(lines, [rule]);
    // Target savings 1000 of 3000 → 33% spread → unit 670 → savings 990.
    expect("basket 3for2 spread percent", r.lines[0].appliedPercent === 33);
    expect("basket 3for2 savings", r.totalSavingsMinorUnits === 990);
    expect("basket 3for2 unit never $0", r.lines[0].unitPriceMinorUnits > 0);
  }
  // OWNER'S EXAMPLE (store-favorable pin): Sunday 3-for-2 on a $150 + $20 +
  // $15 cart — the deal's value is the LOWEST-priced item ($15), never more.
  // Total savings must never exceed 1500 cents and the highest-priced item
  // never receives a bigger PERCENT than anything else.
  {
    const rule = baseRule({ discountType: "basket", storewide: true, config: { basketNforM: { n: 3, m: 2 } } });
    const lines: EngineCartLine[] = [
      { lineId: "half", regularPriceMinorUnits: 15000, quantity: 1, categories: ["flower"] },
      { lineId: "j1", regularPriceMinorUnits: 2000, quantity: 1, categories: ["preroll"] },
      { lineId: "j2", regularPriceMinorUnits: 1500, quantity: 1, categories: ["preroll"] },
    ];
    const r = computePromotions(lines, [rule]);
    expect("owner Sunday example: savings ≤ $15", r.totalSavingsMinorUnits <= 1500);
    expect("owner Sunday example: some savings applied", r.totalSavingsMinorUnits > 0);
    const pcts = r.lines.map((l) => l.appliedPercent);
    expect("owner Sunday example: equal percent every line", pcts.every((p) => p === pcts[0]));
  }
  // N-for-M spreads across ALL eligible lines, not just the cheapest one's line.
  {
    const rule = baseRule({ discountType: "basket", storewide: true, config: { basketNforM: { n: 3, m: 2 } } });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 3000, quantity: 2, categories: ["flower"] },
      { lineId: "b", regularPriceMinorUnits: 900, quantity: 1, categories: ["preroll"] },
    ];
    const r = computePromotions(lines, [rule]);
    // Target 900 of 6900 → floor(13.04) = 13% on every line.
    expect("3for2 spread hits every line", r.lines.every((l) => l.unitSavingsMinorUnits > 0));
    expect("3for2 store-advantaged floor pct", r.lines[0].appliedPercent === 13);
  }
  // basket N-for-M floor: a cheap cannabis basket can never blend to $0.
  {
    const rule = baseRule({ discountType: "basket", storewide: true, config: { basketNforM: { n: 3, m: 0 } } });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 100, quantity: 3, categories: ["flower"] },
    ];
    const r = computePromotions(lines, [rule]);
    expect("basket floor holds", r.lines[0].unitPriceMinorUnits > 0);
  }
  // basket N-for-M cost floor.
  {
    const rule = baseRule({ discountType: "basket", storewide: true, config: { basketNforM: { n: 3, m: 2 } } });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 3, categories: ["flower"], costMinorUnits: 500 },
    ];
    const r = computePromotions(lines, [rule]);
    // Floor = ceil(500 × 1.463) = 732 > 670 spread price → clamped to 732.
    expect("3for2 cost floor clamps", r.lines[0].unitPriceMinorUnits === 732);
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

  // NO STACKING (hard block): two matching promos never combine — the line
  // gets exactly one deal even when both target it.
  {
    const r10 = baseRule({ id: "r10", title: "10%", discountType: "percent", discountPercent: 10, targetCategories: ["flower"], priority: 10 });
    const r20 = baseRule({ id: "r20", title: "20%", discountType: "percent", discountPercent: 20, targetCategories: ["flower"], priority: 5 });
    const lines: EngineCartLine[] = [{ lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, categories: ["flower"] }];
    const r = computePromotions(lines, [r10, r20]);
    // NOT 720 (stacked) — the single best deal (20%) applies.
    expect("no stacking", r.lines[0].unitPriceMinorUnits === 800);
    expect("no stacking single rule", r.lines[0].appliedRuleId === "r20");
  }

  console.log(`discount-engine: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} discount-engine tests failed`);
}
