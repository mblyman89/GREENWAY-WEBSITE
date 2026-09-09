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
// SLICE W1: the ONE weight-label parse, shared with the WAC limit engine.
// (STATUTORY_GRAMS_PER_OUNCE is no longer imported here -- the ounce
// equivalence now lives with the parse, in weight-label-core.)
import { parseWeightLabelGrams } from "@/lib/compliance/weight-label-core";
import {
  pickHeadlineLine,
  saturdayLineTotal,
  effectiveLinePercent,
} from "@/lib/promotions/saturday-headline-core";
import {
  apportionBundleSavings,
  bundleTargetMinorUnits,
} from "@/lib/promotions/bundle-apportionment-core";

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

/**
 * "1oz" => 28, "3.5g" => 3.5, "1/8 oz" => 3.5, "28 grams" => 28. Returns 0 when
 * the label states no unambiguous weight, which `tierPercent` reads as "no
 * tier" -- the store-safe direction.
 *
 * SLICE W1: this used to own a SECOND, unanchored copy of the parse
 * (`/([\d.]+)\s*(oz|ounce)/`), which matched the "8 oz" SUBSTRING of "1/8 oz"
 * and reported 224 g -- a full-ounce 30% tier awarded to an eighth -- while its
 * `\bg\b` gram branch reported 0 g for "28 grams". It now delegates to the one
 * shared parser in weight-label-core, which the WAC 314-55-095 limit parser
 * also uses, so the discount answer and the compliance answer can no longer
 * disagree (they differed on 14 of 37 measured label shapes). Verified a
 * NO-OP across all 666 machine-emittable labels before rewiring.
 */
export function gramsForLabel(label?: string | null): number {
  return parseWeightLabelGrams(label) ?? 0;
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
  // SLICE D2: merch/accessories are only ever swept in by an EXPLICIT merch
  // category target -- the same "unless explicitly targeted" rule the
  // storewide branch above already applies. WHY: a branded t-shirt matched
  // Top Shelf Thursday through the BRAND dimension, so the product card struck
  // 25% off while the cart (which skips merch in its thursday branch) charged
  // full price -- advertised != charged. Category matching is untouched, so a
  // rule that targets ["merch"] (e.g. the merch BOGO) still matches.
  if (isMerch(line) && !catMatch) return false;
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
  // SLICE D2: derive the DISCOUNT with exact integer maths, then subtract.
  //
  // Math.round() on the PRICE (the original) rounded the DISCOUNT down and
  // handed the half-cent to the store - measured at 47.1% of all price/percent
  // combinations under-delivering by up to 0.5c. Owner: "if it can't be exact,
  // then we need to round in the customers favor somehow."
  //
  // Flooring the price is not enough either: 170 * (1 - 30/100) is
  // 118.99999999999999 in IEEE 754, so the floor drops an extra cent. Here
  // price * percent is an exact integer product and the single division is the
  // only rounding step, sent the customer's way by Math.ceil. Exact AND
  // customer-favoured, never more than one cent above the advertised rate.
  const off = Math.ceil((line.regularPriceMinorUnits * p) / 100);
  const unit = clampEngineUnit(line, line.regularPriceMinorUnits - off);
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

  // SLICE D1: the savings target is apportioned in WHOLE CENTS, not converted
  // into a floored whole-number percent. Flooring a percent threw away up to
  // 0.999% of the basket -- on the owner's $60/$40/$20 Sunday cart that was
  // $19.20 paid against a $20.00 advertised 3-for-2, an 80c shortfall in the
  // customer's disfavour. See bundle-apportionment-core.ts for the measurements.
  const apportionLines = eligible.map((l) => ({
    lineId: l.lineId,
    regularPriceMinorUnits: l.regularPriceMinorUnits,
    quantity: l.quantity,
    // The floor is resolved HERE, by the code that knows the product's cost
    // and category, and it is absolute: no apportionment may breach it.
    floorMinorUnits: clampEngineUnit(l, 0),
  }));

  const target = bundleTargetMinorUnits(apportionLines, n, m);
  if (target <= 0) return out;

  const result = apportionBundleSavings(apportionLines, target);
  if (result.placedMinorUnits <= 0) return out;

  for (const l of eligible) {
    const off = result.perUnitOff.get(l.lineId) ?? 0;
    if (off <= 0) continue;
    const unit = clampEngineUnit(l, l.regularPriceMinorUnits - off);
    const pct =
      l.regularPriceMinorUnits > 0
        ? round(((l.regularPriceMinorUnits - unit) / l.regularPriceMinorUnits) * 100)
        : 0;
    out.set(l.lineId, {
      unitPrice: unit,
      percent: pct,
      label: `${label} · ${Math.floor(n)} for ${Math.floor(m)}`,
    });
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
  /**
   * SLICE D3: the best per-unit saving each line is ALREADY receiving from a
   * higher-value promotion (clearance markdown, vendor day). Only the basket
   * headline branch consults it, to avoid awarding "30% off one item" to a
   * line whose existing offer would beat it -- best-deal-wins would then
   * discard the headline and the advertised deal would reach nobody.
   * Optional and defaulted, so every existing caller is unaffected.
   */
  competingUnitSavings?: ReadonlyMap<string, number>,
): Map<string, LineDiscount> {
  const out = new Map<string, LineDiscount>();
  const eligible = lines.filter((l) => ruleMatchesLine(rule, l));
  if (eligible.length === 0) return out;

  // SLICE D1 -- READ THIS BEFORE REINSTATING ANY "WHICHEVER SAVES LESS" LOGIC.
  //
  // This block used to intercept every eitherOr rule and keep whichever of the
  // two advertised options saved the customer LESS. It was believed to be the
  // owner's "store wins" policy. It was not. That policy is about ROUNDING
  // ("if we need to round, we should always round up or round in our favor"),
  // and it had been promoted into a deal-SELECTION rule.
  //
  // The measured consequence on Doobie Tuesday ("20% off OR 4 for 3"):
  //   qty  1-3  ->  20%   correct
  //   qty  4    ->  20%   the 4-for-3 is worth 25%, so it was DISCARDED
  //   qty  6    ->  16%   the bundle now saves LESS, so it WON
  //   qty  7    ->  14%   worse still
  //   qty  8    ->  20%   back again
  // A customer's discount FELL by adding a sixth preroll, and the store
  // advertised 20% while charging 16%. The owner's ruling: "if a discount
  // specifically states 4 or more prerolls is 25% off, then its 25% off,
  // whether the store wants to win or not."
  //
  // An either/or deal now resolves to the option that HONOURS the advertising,
  // i.e. the better of the two for the customer. Where a deal wants tiers, it
  // declares qtyTiers and the multi_item_tier branch below runs them.
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
    // Honour the advertising: the option that actually delivers what the deal
    // promises. A zero-savings option never beats a positive one.
    let chosen: Map<string, LineDiscount>;
    if (savingsA <= 0) chosen = optionB;
    else if (savingsB <= 0) chosen = optionA;
    else chosen = savingsA >= savingsB ? optionA : optionB;
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

        // SLICE D3: pick the target through the shared pure core. It keeps the
        // owner's rule (the LOWEST-priced item wins the headline) but skips a
        // line whose existing offer already beats the headline -- a clearance
        // or vendor-day item. Measured before this fix: across 2,000 Saturday
        // baskets each holding one clearance item, the advertised "30% off any
        // one item" reached NOBODY in 100% of them, because Saturday handed the
        // 30% to the cheapest line (the clearance item) and best-deal-wins then
        // discarded it in favour of the 50%. Ties now break on lineId, so the
        // same basket no longer prices differently by cart order.
        const targetId = pickHeadlineLine(
          eligible.map((l) => ({
            lineId: l.lineId,
            regularPriceMinorUnits: l.regularPriceMinorUnits,
            competingUnitSavingsMinorUnits: competingUnitSavings?.get(l.lineId) ?? 0,
          })),
          headlinePercent,
          othersPercent,
        );

        for (const l of eligible) {
          const isTarget = l.lineId === targetId;
          if (isTarget && l.quantity <= 1) {
            out.set(l.lineId, flatPercentDiscount(l, headlinePercent, rule.title));
            continue;
          }
          if (!isTarget) {
            out.set(l.lineId, flatPercentDiscount(l, othersPercent, rule.title));
            continue;
          }
          // Target line, quantity > 1: ONE unit at the headline, the rest at
          // the others rate, with exact integer maths (SLICE D2's lesson --
          // rounding the PRICE overcharged 1,169 of 1,498 blended lines, worst
          // case 12 cents on price=507 qty=8).
          const t = saturdayLineTotal(
            l.regularPriceMinorUnits,
            l.quantity,
            headlinePercent,
            othersPercent,
            true,
          );
          const blendedUnit = clampEngineUnit(l, t.blendedUnitMinorUnits);
          out.set(l.lineId, {
            unitPrice: blendedUnit,
            // The line really carries one headline unit, so reporting the
            // others-rate understated what the customer received.
            percent: effectiveLinePercent(
              l.regularPriceMinorUnits,
              l.quantity,
              (l.regularPriceMinorUnits - blendedUnit) * l.quantity,
            ),
            label: `${rule.title} · ${headlinePercent}% one item + ${othersPercent}%`,
          });
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
/**
 * PR-P4: the global "never discount" list. Given the owner's protected product
 * keys, return a copy of the rules with those keys merged into EVERY rule's
 * excludeProductKeys. Because ruleMatchesLine treats exclusions as an absolute
 * veto ("exclusions win"), a listed product then keeps its regular price under
 * every promotion — storewide sales, daily deals, brand sales, all of it. Pure
 * and order-preserving; a no-op when the list is empty so nothing changes for
 * stores that never use the feature.
 */
export function applyNeverDiscount(rules: EngineRule[], neverDiscountKeys: string[]): EngineRule[] {
  if (!neverDiscountKeys.length) return rules;
  // Normalise + de-dup the protected keys once (matching is case-insensitive in
  // ruleMatchesLine via hasCi, but we keep the raw values here for clarity).
  const extra = Array.from(new Set(neverDiscountKeys.map((k) => k.trim()).filter(Boolean)));
  if (!extra.length) return rules;
  return rules.map((rule) => {
    const merged = new Set(rule.excludeProductKeys);
    for (const k of extra) merged.add(k);
    return { ...rule, excludeProductKeys: Array.from(merged) };
  });
}

export function computePromotions(
  lines: EngineCartLine[],
  rules: EngineRule[],
  /**
   * PR-P4: product keys that must NEVER be discounted by ANY rule. Merged into
   * every rule's exclusions before evaluation. Defaults to none so all existing
   * callers and tests are unaffected.
   */
  neverDiscountKeys: string[] = [],
): EngineResult {
  rules = applyNeverDiscount(rules, neverDiscountKeys);
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

  // SLICE D3: a basket headline rule ("30% off one item") must know what the
  // other promotions are already giving each line, or it hands its headline to
  // a clearance item and best-deal-wins throws the headline away. Pre-compute
  // the best per-unit saving every OTHER rule offers, then feed that in. Only
  // basket rules read it, so no other deal's behaviour changes.
  const isBasketHeadline = (r: EngineRule) =>
    r.discountType === "basket" && Boolean(r.config.basketTopItem);
  const competing = new Map<string, number>();
  if (ordered.some(isBasketHeadline)) {
    for (const rule of ordered) {
      if (isBasketHeadline(rule)) continue;
      for (const [lineId, d] of applyOnePromotion(rule, lines).entries()) {
        const line = lines.find((l) => l.lineId === lineId);
        if (!line) continue;
        const saving = line.regularPriceMinorUnits - d.unitPrice;
        if (saving > (competing.get(lineId) ?? 0)) competing.set(lineId, saving);
      }
    }
  }

  for (const rule of ordered) {
    const discounts = applyOnePromotion(rule, lines, competing);
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

  // EITHER/OR (SLICE D1): 20% flat OR 4-for-3 — the option BETTER FOR THE
  // CUSTOMER wins. These assertions previously required the WORSE option and
  // so encoded the defect as the contract: four $10 prerolls returned $8.00
  // when the advertised "4 for the price of 3" is worth $10.00.
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
    // 4 equal $10 prerolls: flat 20% saves $8; 4-for-3 saves $10 → the BUNDLE,
    // because that is what the sign in the window promises.
    const four = computePromotions(
      [{ lineId: "a", regularPriceMinorUnits: 1000, quantity: 4, categories: ["preroll"] }],
      [rule],
    );
    expect("eitherOr picks the better option for the customer", four.totalSavingsMinorUnits === 1000);
    expect("eitherOr never delivers less than the flat rate", four.totalSavingsMinorUnits >= 800);
    // 3 × $20 + 1 × $2: flat saves $12.40; the bundle's free unit is the $2 one,
    // so the bundle is worth only $2 → the FLAT rate wins. The old assertion
    // demanded strictly less than $12.40, i.e. it required the $2 outcome.
    const mixed = computePromotions(
      [
        { lineId: "a", regularPriceMinorUnits: 2000, quantity: 3, categories: ["preroll"] },
        { lineId: "b", regularPriceMinorUnits: 200, quantity: 1, categories: ["preroll"] },
      ],
      [rule],
    );
    expect("eitherOr keeps the flat rate when the bundle is worth less", mixed.totalSavingsMinorUnits === 1240);
    expect("eitherOr never picks the weaker offer", mixed.totalSavingsMinorUnits >= 200);
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
    // SLICE D1: a true 3-for-2 on three $10 items is $10.00 of savings. The old
    // assertion PINNED $9.90 (a floored 33% spread) and would have failed this
    // fix. One line of quantity 3 can only move in 3-cent steps, so $10.00 is
    // not reachable; the engine rounds to the nearest reachable value ABOVE the
    // target ($10.02) so the customer is never short-changed, per the owner:
    // "if it can't be exact, then we need to round in the customers favor".
    expect("basket 3for2 never under-delivers", r.totalSavingsMinorUnits >= 1000);
    expect("basket 3for2 overshoot is minimal", r.totalSavingsMinorUnits - 1000 < 3);
    expect("basket 3for2 savings", r.totalSavingsMinorUnits === 1002);
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
    // SLICE D1: it is now EXACTLY $15.00, not merely "≤ and > 0". The owner:
    // "Sunday needs to be exact." Previously the floored percent delivered
    // less than the advertised cheapest-item value.
    expect("owner Sunday example: exactly $15", r.totalSavingsMinorUnits === 1500);
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
    // SLICE D1: the advertised value is the cheapest unit ($9.00) and the
    // customer now receives all of it. The old assertion locked in
    // floor(13.04%) = 13%, which quietly delivered less than the advert.
    expect("3for2 spread hits every line", r.lines.every((l) => l.unitSavingsMinorUnits > 0));
    expect("3for2 delivers the advertised cheapest unit", r.totalSavingsMinorUnits === 900);
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
    // Floor = ceil(500 × 1.463) = 732 → the spread price is clamped up to it.
    // The cost floor OUTRANKS the advertised target: we may legally deliver
    // less than the advert rather than sell below acquisition cost
    // (RCW 69.50.357). Savings are therefore 804, not the 1000 target.
    expect("3for2 cost floor clamps", r.lines[0].unitPriceMinorUnits === 732);
    expect("3for2 cost floor outranks the target", r.totalSavingsMinorUnits === 804);
    expect("3for2 cost floor never breached", r.lines[0].unitPriceMinorUnits >= 732);
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

  // PR-P4: GLOBAL NEVER-DISCOUNT LIST.
  {
    // A storewide 20% flower deal; one protected key must keep regular price.
    const rule = baseRule({ discountType: "percent", discountPercent: 20, targetCategories: ["flower"] });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, categories: ["flower"], productKey: "PROTECTED" },
      { lineId: "b", regularPriceMinorUnits: 1000, quantity: 1, categories: ["flower"], productKey: "NORMAL" },
    ];
    const r = computePromotions(lines, [rule], ["PROTECTED"]);
    expect("never-discount keeps regular", r.lines.find((l) => l.lineId === "a")!.unitPriceMinorUnits === 1000);
    expect("never-discount others still discounted", r.lines.find((l) => l.lineId === "b")!.unitPriceMinorUnits === 800);
  }

  // never-discount beats even a storewide deal AND every other rule (defense).
  {
    const storewide = baseRule({ id: "sw", discountType: "percent", discountPercent: 30, storewide: true });
    const brandDeal = baseRule({ id: "bd", discountType: "percent", discountPercent: 25, targetBrands: ["Artizen"] });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 2000, quantity: 1, categories: ["flower"], brand: "Artizen", productKey: "KEEP" },
    ];
    const r = computePromotions(lines, [storewide, brandDeal], ["KEEP"]);
    expect("never-discount beats every rule", r.lines[0].unitPriceMinorUnits === 2000);
    expect("never-discount no applied rule", !r.lines[0].appliedRuleId);
  }

  // applyNeverDiscount: pure merge is a no-op when the list is empty.
  {
    const rule = baseRule({ excludeProductKeys: ["X"] });
    const same = applyNeverDiscount([rule], []);
    expect("never-discount empty no-op", same[0] === rule);
    const merged = applyNeverDiscount([rule], ["Y", "Y", " "]);
    expect("never-discount merges + dedups", JSON.stringify(merged[0].excludeProductKeys) === JSON.stringify(["X", "Y"]));
    // Original rule is not mutated (pure copy).
    expect("never-discount does not mutate input", JSON.stringify(rule.excludeProductKeys) === JSON.stringify(["X"]));
  }

  // case-insensitive: the exclusion match ignores key casing (via hasCi).
  {
    const rule = baseRule({ discountType: "percent", discountPercent: 20, targetCategories: ["flower"] });
    const lines: EngineCartLine[] = [
      { lineId: "a", regularPriceMinorUnits: 1000, quantity: 1, categories: ["flower"], productKey: "abc-123" },
    ];
    const r = computePromotions(lines, [rule], ["ABC-123"]);
    expect("never-discount case-insensitive", r.lines[0].unitPriceMinorUnits === 1000);
  }

  console.log(`discount-engine: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} discount-engine tests failed`);
}
