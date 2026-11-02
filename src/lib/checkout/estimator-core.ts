/**
 * src/lib/checkout/estimator-core.ts  (Task T / PR 2 — Cart Estimator)
 *
 * PURE math for the customer-facing "estimate my register total" panel in the
 * cart drawer + checkout (no React, no DB, no server-only imports). Every
 * figure produced here is an ESTIMATE — the register is always final — but the
 * math deliberately MIRRORS the register's own pure cores so the estimate can
 * only differ from the register when the register knows something the website
 * cannot (card validity in the MCR, acquisition costs, staff adjustments):
 *
 *  - LOYALTY EARN mirrors basePointsForSubtotal (src/lib/loyalty/engine.ts):
 *    points accrue on the PRETAX subtotal at pointsPerDollar, floored.
 *  - LOYALTY REWARDS (D137) mirror loyalty-reward-core: 150 pts = 10% off,
 *    300 pts = 25% off, one per visit; per item the better of the deal or
 *    the reward percent off the regular price, never both; cannabis never
 *    below the 1¢ statutory floor (RCW 69.50.357). Points have no cash
 *    value (the $0.10-per-point program is retired).
 *  - MEDICAL savings mirror lineBaseMinor + decideLineExemption in
 *    medical-sale-core.ts (grounded in RCW 82.08.9998 sales-tax exemption and
 *    WAC 314-55-090(1) excise exemption, chapter 246-70 WAC DOH categories):
 *    per line, pre-tax base = round(inclusive ÷ category divisor), exempted
 *    tax = applyBps(base, 3700) + applyBps(base, 930). Only DOH-registry
 *    VERIFIED products can actually claim at the register, so the estimate is
 *    an HONEST RANGE: verified lines set the floor; unverified cannabis lines
 *    (which could be DOH-compliant on the physical package but are not yet in
 *    the store's registry) set the best-case ceiling. The WAC 314-55-090(6)
 *    excise sunset (config excise_exemption_until, default 2029-06-30) is
 *    respected via the server-computed `exciseActive` flag.
 *  - TIER NUDGES read the SAME published rule snapshots that price the cart
 *    (published-rules-core.ts) and the same tier mechanics the engine applies
 *    (discount-engine-core.ts): weight tiers count grams of eligible lines,
 *    qty tiers count units, spend tiers sum REGULAR prices (engine parity),
 *    basket N-for-M counts group completion. Either/or rules never nudge —
 *    the engine picks the SMALLER savings of the two options
 *    (store-advantaged), so completing the bundle cannot increase savings.
 *
 * References recorded per owner directive (see also docs/
 * MEDICAL_CANNABIS_COMPLIANCE.md, docs/LOYALTY_COMPLIANCE.md,
 * docs/PROMOTIONS_COMPLIANCE.md):
 *  - RCW 82.08.9998 (sales-tax exemption, compliant product / high-CBD)
 *  - WAC 314-55-090 (excise exemption + 5-year records + (6) sunset)
 *  - Chapter 246-70 WAC (DOH compliant-product categories)
 *  - RCW 69.50.357 (retailer restrictions — no free cannabis)
 *  - WAC 314-55-155(5)(g) / CCRS Upload User Guide (no below-cost discounting)
 *
 * All money in MINOR UNITS (cents).
 */
import {
  CANNABIS_EXCISE_TAX_BPS,
  COMBINED_SALES_TAX_BPS,
  MIN_CANNABIS_UNIT_PRICE_MINOR,
  NON_CANNABIS_TAX_INCLUSIVE_DIVISOR,
  TAX_INCLUSIVE_DIVISOR,
  isNonCannabisCategory,
} from "@/lib/orders/order-pricing-core";
import type { DohCategory } from "@/lib/medical/medical-sale-core";
import {
  DEFAULT_QTY_TIERS,
  DEFAULT_SPEND_TIERS,
  DEFAULT_WEIGHT_TIERS,
  gramsForLabel,
  ruleMatchesLine,
  tierPercent,
  type EngineCartLine,
  type Tier,
} from "@/lib/promotions/discount-engine-core";
import {
  nextRewardFor,
  rewardOptionsFor,
  rewardPercentLabel,
  type LoyaltyReward,
} from "@/lib/loyalty/loyalty-reward-core";
import {
  snapshotToEngineRule,
  type PublishedRuleSnapshot,
} from "@/lib/promotions/published-rules-core";

// ---------------------------------------------------------------------------
// Shared context shape (served by POST /api/estimator, consumed by the panel)
// ---------------------------------------------------------------------------

export type EstimatorLoyaltyConfig = {
  /** 1.0 = 1 point per pretax dollar (loyalty_config.points_per_dollar). */
  pointsPerDollar: number;
  // D137: no point cash value any more — the $0.10-per-point program is
  // retired. The rewards (150 pts = 10% off, 300 pts = 25% off) come from
  // loyalty-reward-core, the same constants the register uses.
};

export type EstimatorMedicalConfig = {
  /** Store holds a valid LCB medical endorsement (RCW 69.50.375). */
  endorsed: boolean;
  /** WAC 314-55-090(6) excise-exemption sunset has NOT passed. */
  exciseActive: boolean;
};

export type EstimatorContext = {
  loyalty: EstimatorLoyaltyConfig;
  medical: EstimatorMedicalConfig;
  /** productId → verified DOH category (medical_product_registry snapshot). */
  registry: Record<string, DohCategory>;
};

export const DEFAULT_ESTIMATOR_LOYALTY: EstimatorLoyaltyConfig = {
  pointsPerDollar: 1,
};

// ---------------------------------------------------------------------------
// Cart line input (built from the cart's engine-discounted items)
// ---------------------------------------------------------------------------

export type EstimatorLine = {
  lineId: string;
  productId: string | null;
  productName: string;
  /** Placement category slug (tax divisor + cannabis-ness), e.g. "flower". */
  category: string;
  quantity: number;
  /** Engine-discounted per-unit price, TAX-INCLUSIVE, minor units. */
  unitPriceMinorUnits: number;
  /**
   * D137: the per-unit REGULAR price (before the day's deal), so the reward
   * estimate gives each item the better of the deal or the reward. Optional;
   * without it the deal price is used as the regular price.
   */
  regularPriceMinorUnits?: number;
};

// ---------------------------------------------------------------------------
// Loyalty — earn preview + reward estimate
// ---------------------------------------------------------------------------

/**
 * Points this order would earn — mirrors basePointsForSubtotal in
 * src/lib/loyalty/engine.ts EXACTLY (pretax dollars × rate, floored; no
 * negative). Register promotions (multipliers/happy hour) can only ADD to
 * this, so the preview is a safe lower bound. Points have no cash value
 * (D137), so only the count is returned.
 */
export function estimateEarnPoints(
  pretaxSubtotalMinor: number,
  cfg: EstimatorLoyaltyConfig,
): { points: number } {
  if (pretaxSubtotalMinor <= 0) return { points: 0 };
  const points = Math.floor((pretaxSubtotalMinor / 100) * cfg.pointsPerDollar);
  return { points: Math.max(0, points) };
}

/**
 * What ONE reward would take off this cart: per item, the better of the
 * day's deal or the reward percent off the regular price (never both), each
 * cannabis unit kept at the 1¢ statutory floor (RCW 69.50.357). The register
 * also enforces acquisition-cost floors and the never-discount list, which
 * the website does not know, so this is a best-case estimate.
 */
export function estimateRewardSavingsMinor(lines: EstimatorLine[], reward: Pick<LoyaltyReward, "percentBps">): number {
  let saved = 0;
  for (const line of lines) {
    const qty = Math.max(0, Math.round(line.quantity));
    const unit = Math.max(0, Math.round(line.unitPriceMinorUnits));
    const regular = Math.max(unit, Math.round(line.regularPriceMinorUnits ?? unit));
    if (qty <= 0 || unit <= 0) continue;
    const floor = isNonCannabisCategory(line.category) ? 0 : MIN_CANNABIS_UNIT_PRICE_MINOR;
    const rewardPrice = Math.max(floor, Math.round(regular * (1 - reward.percentBps / 10000)));
    saved += Math.max(0, unit - rewardPrice) * qty;
  }
  return saved;
}

export type LoyaltyRewardEstimate =
  | { status: "none" }
  | { status: "below_min"; shortfallPoints: number; nextPercentLabel: string }
  | {
      status: "ok";
      /** One row per reward the balance covers, lowest first. */
      options: { points: number; percentLabel: string; savingsMinor: number }[];
      /** The reward that saves the most on THIS cart (null if none save anything). */
      bestPoints: number | null;
    };

/**
 * D137: which rewards a points balance unlocks and what each would take off
 * THIS cart. One reward per visit.
 */
export function estimateLoyaltyRewards(balancePoints: number, lines: EstimatorLine[]): LoyaltyRewardEstimate {
  const balance = Math.floor(balancePoints);
  if (!Number.isFinite(balance) || balance <= 0) return { status: "none" };
  const options = rewardOptionsFor(balance);
  if (options.length === 0) {
    const next = nextRewardFor(balance);
    return next
      ? { status: "below_min", shortfallPoints: next.pointsNeeded, nextPercentLabel: rewardPercentLabel(next.reward) }
      : { status: "none" };
  }
  const rows = options.map((r) => ({
    points: r.points,
    percentLabel: rewardPercentLabel(r),
    savingsMinor: estimateRewardSavingsMinor(lines, r),
  }));
  let bestPoints: number | null = null;
  let bestSaved = 0;
  for (const row of rows) {
    if (row.savingsMinor > bestSaved) {
      bestSaved = row.savingsMinor;
      bestPoints = row.points;
    }
  }
  return { status: "ok", options: rows, bestPoints };
}

// ---------------------------------------------------------------------------
// Medical — honest best-case savings RANGE
// ---------------------------------------------------------------------------

function applyBps(amountMinor: number, bps: number): number {
  return Math.round((amountMinor * bps) / 10000);
}

/**
 * Pre-tax base for a line — mirrors lineBaseMinor in medical-sale-core.ts:
 * inclusive line total backed out with the category divisor, rounded once.
 */
export function estimatorLineBaseMinor(line: Pick<EstimatorLine, "category" | "quantity" | "unitPriceMinorUnits">): number {
  const qty = Math.max(0, Math.round(line.quantity));
  const inclusive = Math.max(0, Math.round(line.unitPriceMinorUnits)) * qty;
  const divisor = isNonCannabisCategory(line.category)
    ? NON_CANNABIS_TAX_INCLUSIVE_DIVISOR
    : TAX_INCLUSIVE_DIVISOR;
  return Math.round(inclusive / divisor);
}

export type MedicalEstimate = {
  /** Store not endorsed — no exemptions possible at all. */
  endorsed: boolean;
  /** Savings on DOH-registry VERIFIED lines (will claim with a valid card). */
  verifiedMinor: number;
  verifiedLineCount: number;
  /** Best-case additional savings if unverified cannabis lines turn out DOH-compliant. */
  bestCaseAdditionalMinor: number;
  unverifiedCannabisLineCount: number;
  /** The honest range shown to the customer. */
  minMinor: number;
  maxMinor: number;
  /** Names of cart lines registered as 246-70 High-THC (card REQUIRED to buy). */
  highThcNames: string[];
};

/**
 * Honest best-case medical-savings range for a cart, assuming the shopper
 * presents a card that is VALID + in the MCR at pickup (the register verifies
 * that — estimates never promise it).
 *
 *  - VERIFIED lines (productId in the DOH registry, any 246-70 category):
 *    both exemptions apply per the register's own decideLineExemption —
 *    sales tax (RCW 82.08.9998(1)(a)) + excise while the WAC 314-55-090(6)
 *    sunset has not passed. These form the floor of the range.
 *  - UNVERIFIED cannabis lines: could be DOH-compliant on the physical
 *    package but are not in the registry, so the register would charge full
 *    tax today. Their potential savings form the ceiling only.
 *  - Non-cannabis lines never qualify (sales tax always due on accessories).
 */
export function estimateMedicalSavings(
  lines: EstimatorLine[],
  registry: Record<string, DohCategory>,
  cfg: EstimatorMedicalConfig,
): MedicalEstimate {
  const highThcNames: string[] = [];
  let verifiedMinor = 0;
  let verifiedLineCount = 0;
  let bestCaseAdditionalMinor = 0;
  let unverifiedCannabisLineCount = 0;

  for (const line of lines) {
    if (isNonCannabisCategory(line.category)) continue;
    const doh = line.productId ? registry[line.productId] : undefined;
    if (doh === "high_thc") highThcNames.push(line.productName);
    if (!cfg.endorsed) continue;
    const base = estimatorLineBaseMinor(line);
    if (base <= 0) continue;
    const excise = cfg.exciseActive ? applyBps(base, CANNABIS_EXCISE_TAX_BPS) : 0;
    const sales = applyBps(base, COMBINED_SALES_TAX_BPS);
    const saving = excise + sales;
    if (saving <= 0) continue;
    if (doh) {
      verifiedMinor += saving;
      verifiedLineCount += 1;
    } else {
      bestCaseAdditionalMinor += saving;
      unverifiedCannabisLineCount += 1;
    }
  }

  return {
    endorsed: cfg.endorsed,
    verifiedMinor,
    verifiedLineCount,
    bestCaseAdditionalMinor,
    unverifiedCannabisLineCount,
    minMinor: verifiedMinor,
    maxMinor: verifiedMinor + bestCaseAdditionalMinor,
    highThcNames,
  };
}

// ---------------------------------------------------------------------------
// Tier nudges — "add X to unlock Y%" from the SAME published rules that price
// the cart (upsell mechanic; every figure register-final).
// ---------------------------------------------------------------------------

export type TierNudge = {
  ruleId: string;
  ruleTitle: string;
  kind: "weight" | "qty" | "spend" | "basket" | "bogo";
  /** Human add-on, e.g. "3.5g", "1 more item", "$23.00". */
  addLabel: string;
  /** What it unlocks, e.g. "20% off", "3 for 2". */
  unlockLabel: string;
  /** Conservative estimate of ADDITIONAL savings on the CURRENT basket. */
  estAdditionalSavingsMinor: number;
};

function formatGrams(g: number): string {
  const rounded = Math.round(g * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}g`;
}

function formatDollars(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

/** Next tier strictly above `value` whose percent beats the current percent. */
function nextTierAbove(value: number, tiers: Tier[], currentPercent: number): Tier | null {
  let next: Tier | null = null;
  for (const t of tiers) {
    if (t.at > value && t.percent > currentPercent && (!next || t.at < next.at)) next = t;
  }
  return next;
}

/**
 * Nudges for the active day's rules. Only rules the cart ALREADY has eligible
 * items for produce a nudge (no advertising into an empty basket). Sorted by
 * estimated additional savings, best first.
 *
 * SLICE D1: either/or rules used to be skipped entirely here, because the
 * engine took the SMALLER savings of the two options and so completing a
 * bundle could never help. The engine now honours whichever option is BETTER
 * for the customer, which makes "add one more and save more" a real, truthful
 * unlock -- so the skip is gone and these rules nudge like any other.
 */
export function tierNudges(
  lines: EngineCartLine[],
  activeRules: PublishedRuleSnapshot[],
): TierNudge[] {
  const out: TierNudge[] = [];
  for (const snapshot of activeRules) {
    const rule = snapshotToEngineRule(snapshot);
    // SLICE D1: no eitherOr skip. The engine now takes the BETTER option, so
    // completing a bundle is a genuine unlock worth telling the customer about.
    // Rules that carry no tiers still produce no nudge further down.
    const eligible = lines.filter((l) => ruleMatchesLine(rule, l));
    if (eligible.length === 0) continue;
    const eligibleRegular = eligible.reduce(
      (s, l) => s + Math.max(0, l.regularPriceMinorUnits) * Math.max(0, l.quantity),
      0,
    );
    if (eligibleRegular <= 0) continue;

    const pushTierNudge = (
      kind: "weight" | "qty" | "spend",
      value: number,
      tiers: Tier[],
      addLabel: (delta: number) => string,
    ) => {
      const current = tierPercent(value, tiers);
      const next = nextTierAbove(value, tiers, current);
      if (!next) return;
      const est =
        Math.round((eligibleRegular * next.percent) / 100) -
        Math.round((eligibleRegular * current) / 100);
      out.push({
        ruleId: rule.id,
        ruleTitle: rule.title,
        kind,
        addLabel: addLabel(next.at - value),
        unlockLabel: `${next.percent}% off`,
        estAdditionalSavingsMinor: Math.max(0, est),
      });
    };

    switch (rule.discountType) {
      case "weight_tier": {
        const tiers = rule.config.weightTiers?.length ? rule.config.weightTiers : DEFAULT_WEIGHT_TIERS;
        const grams = eligible.reduce((s, l) => s + gramsForLabel(l.variantLabel) * l.quantity, 0);
        // Without parseable weights the engine cannot tier either — skip.
        if (grams <= 0) break;
        pushTierNudge("weight", grams, tiers, (d) => formatGrams(d));
        break;
      }
      case "multi_item_tier": {
        const tiers = rule.config.qtyTiers?.length ? rule.config.qtyTiers : DEFAULT_QTY_TIERS;
        const qty = eligible.reduce((s, l) => s + l.quantity, 0);
        pushTierNudge("qty", qty, tiers, (d) => `${d} more item${d === 1 ? "" : "s"}`);
        break;
      }
      case "threshold_spend": {
        const tiers = rule.config.spendTiers?.length ? rule.config.spendTiers : DEFAULT_SPEND_TIERS;
        // Engine parity: spend tiers qualify on REGULAR (pre-discount) prices.
        pushTierNudge("spend", eligibleRegular, tiers, (d) => formatDollars(d));
        break;
      }
      case "basket": {
        const cfg = rule.config.basketNforM;
        if (!cfg || cfg.n < 2 || cfg.m >= cfg.n) break;
        const units = eligible.reduce((s, l) => s + l.quantity, 0);
        if (units <= 0) break;
        const remainder = units % cfg.n;
        if (remainder === 0) break; // groups complete
        const need = cfg.n - remainder;
        // The freed unit is among the cheapest — a conservative estimate.
        let minUnit = Infinity;
        for (const l of eligible) minUnit = Math.min(minUnit, l.regularPriceMinorUnits);
        out.push({
          ruleId: rule.id,
          ruleTitle: rule.title,
          kind: "basket",
          addLabel: `${need} more item${need === 1 ? "" : "s"}`,
          unlockLabel: `${cfg.n} for ${cfg.m}`,
          estAdditionalSavingsMinor: Number.isFinite(minUnit) ? Math.max(0, minUnit) : 0,
        });
        break;
      }
      case "bogo": {
        const cfg = rule.config.bogo;
        if (!cfg || cfg.buyQty < 1 || cfg.getQty < 1) break;
        const groupSize = cfg.buyQty + cfg.getQty;
        const units = eligible.reduce((s, l) => s + l.quantity, 0);
        if (units <= 0) break;
        const remainder = units % groupSize;
        if (remainder === 0) break;
        const need = groupSize - remainder;
        let minUnit = Infinity;
        for (const l of eligible) minUnit = Math.min(minUnit, l.regularPriceMinorUnits);
        const pct = Math.min(99, Math.max(0, cfg.getPercent));
        out.push({
          ruleId: rule.id,
          ruleTitle: rule.title,
          kind: "bogo",
          addLabel: `${need} more item${need === 1 ? "" : "s"}`,
          unlockLabel:
            pct >= 99 ? `buy ${cfg.buyQty} get ${cfg.getQty}` : `${pct}% off ${cfg.getQty}`,
          estAdditionalSavingsMinor: Number.isFinite(minUnit)
            ? Math.max(0, Math.round((minUnit * pct) / 100))
            : 0,
        });
        break;
      }
      default:
        break; // percent / fixed — nothing to unlock
    }
  }
  out.sort((a, b) => b.estAdditionalSavingsMinor - a.estAdditionalSavingsMinor);
  return out;
}
