/**
 * src/lib/loyalty/loyalty-reward-core.ts  (D137–D141, owner request 2026-11-02)
 *
 * PURE rules for the loyalty REWARDS that replaced the retired $0.10-per-point
 * cash value (no I/O, no server-only imports; self-tested via
 * __runLoyaltyRewardTests, wired into the compliance harness).
 *
 * Owner, verbatim: "yes, one redemption per sale, and works exactly as you
 * described in the proposed fix. no dollar cap on the 25% off. ... the
 * $0.10-per-point should be retired".
 *
 * The program now has exactly two rewards:
 *
 *     150 points  ->  10% off the sale
 *     300 points  ->  25% off the sale
 *
 *  - Only the rewards the member's balance covers are offered.
 *  - Exactly 150 or 300 points are deducted, never the whole balance.
 *  - The percent comes off each item's REGULAR price. Per item the customer
 *    gets the BETTER of the day's deal or the reward, never both stacked
 *    (the same best-deal-wins rule as applyTierPricing).
 *  - Every price stays at or above the legal floor (never free, never below
 *    acquisition cost), same floors as every other discount.
 *  - ONE reward per sale. There is no dollar cap.
 *
 * Points are just points now: they have no cash value, so nothing here (or
 * anywhere in the app) multiplies points by money.
 *
 * Card prices are tax-inclusive and tax is proportional, so a percent off the
 * tax-inclusive price is the same percent off the pre-tax price.
 */
import { applyTierPricing, type LoyaltySaleLine, type TierPricingLine } from "@/lib/loyalty/loyalty-sale-core";

export type LoyaltyReward = {
  /** Points the reward costs (deducted exactly). */
  points: number;
  /** Percent off, in basis points (1000 = 10%). */
  percentBps: number;
};

/** The two rewards (owner, D137). Lowest first. */
export const LOYALTY_REWARDS: readonly LoyaltyReward[] = Object.freeze([
  Object.freeze({ points: 150, percentBps: 1000 }),
  Object.freeze({ points: 300, percentBps: 2500 }),
]);

/** The fewest points that buy any reward. */
export const MIN_REWARD_POINTS = LOYALTY_REWARDS[0].points;

/** "10%" / "25%". */
export function rewardPercentLabel(r: Pick<LoyaltyReward, "percentBps">): string {
  const pct = r.percentBps / 100;
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

/** Register button text: "Use 300 pts – 25% off". */
export function rewardButtonLabel(r: LoyaltyReward): string {
  return `Use ${r.points.toLocaleString("en-US")} pts – ${rewardPercentLabel(r)} off`;
}

/** Short label for receipts, order notes and lists: "25% off (300 pts)". */
export function rewardShortLabel(r: LoyaltyReward): string {
  return `${rewardPercentLabel(r)} off (${r.points.toLocaleString("en-US")} pts)`;
}

/** The reward that costs exactly this many points, or null. */
export function rewardForPoints(points: number): LoyaltyReward | null {
  return LOYALTY_REWARDS.find((r) => r.points === points) ?? null;
}

/** Every reward the balance covers, lowest first (empty below 150). */
export function rewardOptionsFor(balancePoints: number): LoyaltyReward[] {
  const balance = Number.isFinite(balancePoints) ? Math.floor(balancePoints) : 0;
  return LOYALTY_REWARDS.filter((r) => balance >= r.points);
}

/** The biggest reward the balance covers, or null. */
export function bestRewardFor(balancePoints: number): LoyaltyReward | null {
  const opts = rewardOptionsFor(balancePoints);
  return opts.length ? opts[opts.length - 1] : null;
}

/**
 * The next reward the member has NOT reached yet and how many points they
 * still need ("30 more points to 10% off"). Null once every reward is
 * affordable.
 */
export function nextRewardFor(balancePoints: number): { reward: LoyaltyReward; pointsNeeded: number } | null {
  const balance = Number.isFinite(balancePoints) ? Math.max(0, Math.floor(balancePoints)) : 0;
  const next = LOYALTY_REWARDS.find((r) => balance < r.points);
  return next ? { reward: next, pointsNeeded: next.points - balance } : null;
}

/** A one-line plain description of what the balance can do right now. */
export function rewardStatusLine(balancePoints: number): string {
  const best = bestRewardFor(balancePoints);
  const next = nextRewardFor(balancePoints);
  if (!best && next) {
    return `${next.pointsNeeded.toLocaleString("en-US")} more points to ${rewardPercentLabel(next.reward)} off`;
  }
  if (best && next) {
    return `Can use ${rewardPercentLabel(best)} off now · ${next.pointsNeeded.toLocaleString("en-US")} more points to ${rewardPercentLabel(next.reward)} off`;
  }
  if (best) return `Can use ${rewardPercentLabel(best)} off now`;
  return "";
}

/**
 * Pick the reward a request asks for. `requested` is the reward's point cost
 * (150 or 300). An old register app sends nothing: it gets the BEST reward the
 * balance covers, never the whole balance.
 */
export function chooseReward(
  balancePoints: number,
  requested: unknown,
): { ok: true; reward: LoyaltyReward } | { ok: false; error: string } {
  const balance = Number.isFinite(balancePoints) ? Math.floor(balancePoints) : 0;
  if (requested === undefined || requested === null || requested === "") {
    const best = bestRewardFor(balance);
    if (!best) {
      return {
        ok: false,
        error: `Not enough points: ${balance.toLocaleString("en-US")} of the ${MIN_REWARD_POINTS} needed for ${rewardPercentLabel(LOYALTY_REWARDS[0])} off.`,
      };
    }
    return { ok: true, reward: best };
  }
  const pts = typeof requested === "number" ? requested : Number(String(requested).trim());
  const reward = Number.isInteger(pts) ? rewardForPoints(pts) : null;
  if (!reward) {
    return {
      ok: false,
      error: `Unknown reward. The rewards are ${LOYALTY_REWARDS.map((r) => rewardShortLabel(r)).join(" and ")}.`,
    };
  }
  if (balance < reward.points) {
    return {
      ok: false,
      error: `Not enough points for ${rewardShortLabel(reward)}: the balance is ${balance.toLocaleString("en-US")}.`,
    };
  }
  return { ok: true, reward };
}

export type RewardPricingResult =
  | {
      ok: true;
      lines: TierPricingLine[];
      /** Total tax-inclusive amount the reward takes off this cart. */
      appliedMinorUnits: number;
    }
  | { ok: false; reason: "no_savings"; message: string };

/**
 * Apply a reward to the cart: the percent off each item's regular price,
 * better-of with the day's deal per item, floored, no cap. Refuses (and so
 * spends no points) when the deals already match or beat the reward on every
 * item.
 */
export function applyRewardPricing(
  lines: LoyaltySaleLine[],
  reward: LoyaltyReward,
  opts: { excludeLineIds?: ReadonlySet<string> } = {},
): RewardPricingResult {
  // Items on the owner's never-discount list keep their price (D140).
  const excluded = opts.excludeLineIds ?? new Set<string>();
  const eligible = lines.filter((l) => !excluded.has(l.lineId));
  const priced = applyTierPricing(eligible, reward.percentBps);
  const byId = new Map(priced.lines.map((l) => [l.lineId, l]));
  const res = {
    additionalSavingsMinorUnits: priced.additionalSavingsMinorUnits,
    lines: lines.map(
      (l): TierPricingLine =>
        byId.get(l.lineId) ?? {
          lineId: l.lineId,
          unitPriceMinorUnits: Math.max(0, Math.round(l.unitPriceMinorUnits)),
          loyaltyDiscountMinorUnits: 0,
          winner: "existing",
        },
    ),
  };
  if (res.additionalSavingsMinorUnits <= 0) {
    return {
      ok: false,
      reason: "no_savings",
      message: `Today's deals already match or beat ${rewardPercentLabel(reward)} off on every item (or the items are at the legal price floor), so the reward would save nothing. No points were used.`,
    };
  }
  return { ok: true, lines: res.lines, appliedMinorUnits: res.additionalSavingsMinorUnits };
}

/**
 * The MOST a reward can take off these lines: per unit, the regular price
 * minus the reward price (before floors, which only lower it). The sync
 * re-checks a register's reward against this, so a tampered or stale payload
 * can never take more than the percent allows.
 */
export function maxRewardOffMinor(
  lines: { quantity: number; regularPriceMinor: number }[],
  reward: Pick<LoyaltyReward, "percentBps">,
): number {
  let max = 0;
  for (const l of lines) {
    const qty = Math.max(0, Math.round(l.quantity));
    const regular = Math.max(0, Math.round(l.regularPriceMinor));
    max += Math.max(0, regular - Math.round(regular * (1 - reward.percentBps / 10000))) * qty;
  }
  return max;
}

/**
 * Is a stored redemption row one of the rewards? Rows are rewards when their
 * point cost is exactly a reward's cost. Anything else is a code from the
 * retired $0.10-per-point program, which is no longer honored (none were
 * outstanding when it was retired); staff cancel it to refund the points.
 */
export function redemptionReward(row: { points: number }): LoyaltyReward | null {
  return rewardForPoints(Math.floor(Number(row.points)));
}

export const LEGACY_CODE_MESSAGE =
  "This is an old-style points code from the retired $0.10-per-point program, so it can't be used. Cancel it on the customer's profile (the points go back to them), then use a 10% or 25% reward.";

/** Public-facing sentences for the website and the loyalty page. */
export function rewardTermsLines(): string[] {
  return LOYALTY_REWARDS.map(
    (r) => `${r.points.toLocaleString("en-US")} points = ${rewardPercentLabel(r)} off your purchase.`,
  );
}

/** "Use 150 points for 10% off, or 300 points for 25% off. One reward per visit." */
export function rewardRedeemSentence(): string {
  const parts = LOYALTY_REWARDS.map((r) => `${r.points.toLocaleString("en-US")} points for ${rewardPercentLabel(r)} off`);
  return `Use ${parts.join(", or ")}. One reward per visit; the reward or the day's deal, whichever is better on each item.`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runLoyaltyRewardTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log("FAIL loyalty-reward-core:", msg);
    }
  };
  const line = (over: Partial<LoyaltySaleLine> = {}): LoyaltySaleLine => ({
    lineId: "l1",
    category: "flower",
    quantity: 1,
    unitPriceMinorUnits: 1000,
    regularPriceMinorUnits: 1000,
    costMinorUnits: null,
    ...over,
  });

  // The ladder itself (owner's numbers).
  ok(LOYALTY_REWARDS.length === 2, "exactly two rewards");
  ok(LOYALTY_REWARDS[0].points === 150 && LOYALTY_REWARDS[0].percentBps === 1000, "150 pts = 10%");
  ok(LOYALTY_REWARDS[1].points === 300 && LOYALTY_REWARDS[1].percentBps === 2500, "300 pts = 25%");
  ok(MIN_REWARD_POINTS === 150, "minimum 150");
  ok(Object.isFrozen(LOYALTY_REWARDS) && Object.isFrozen(LOYALTY_REWARDS[0]), "ladder frozen");

  // Labels.
  ok(rewardButtonLabel(LOYALTY_REWARDS[0]) === "Use 150 pts – 10% off", "button label 150");
  ok(rewardButtonLabel(LOYALTY_REWARDS[1]) === "Use 300 pts – 25% off", "button label 300");
  ok(rewardShortLabel(LOYALTY_REWARDS[1]) === "25% off (300 pts)", "short label");
  ok(rewardPercentLabel({ percentBps: 1250 }) === "12.5%", "fractional percent");

  // Options by balance.
  ok(rewardOptionsFor(0).length === 0, "0 pts -> none");
  ok(rewardOptionsFor(149).length === 0, "149 -> none");
  ok(rewardOptionsFor(150).length === 1 && rewardOptionsFor(150)[0].points === 150, "150 -> 10% only");
  ok(rewardOptionsFor(299).length === 1, "299 -> 10% only");
  ok(rewardOptionsFor(300).length === 2, "300 -> both");
  ok(rewardOptionsFor(2472).length === 2, "2472 -> both (owner's customer)");
  ok(rewardOptionsFor(Number.NaN).length === 0, "NaN -> none");
  ok(bestRewardFor(2472)?.points === 300, "best for 2472 is 300");
  ok(bestRewardFor(200)?.points === 150, "best for 200 is 150");
  ok(bestRewardFor(10) === null, "best for 10 is null");

  // Next-reward nudge.
  ok(nextRewardFor(120)?.pointsNeeded === 30 && nextRewardFor(120)?.reward.points === 150, "120 -> 30 to 10%");
  ok(nextRewardFor(200)?.pointsNeeded === 100 && nextRewardFor(200)?.reward.points === 300, "200 -> 100 to 25%");
  ok(nextRewardFor(300) === null, "300 -> nothing next");
  ok(rewardStatusLine(120) === "30 more points to 10% off", "status below");
  ok(rewardStatusLine(200) === "Can use 10% off now · 100 more points to 25% off", "status middle");
  ok(rewardStatusLine(900) === "Can use 25% off now", "status top");

  // Choosing.
  const c1 = chooseReward(2472, undefined);
  ok(c1.ok && c1.reward.points === 300, "old client: best reward, never whole balance");
  const c2 = chooseReward(2472, 150);
  ok(c2.ok && c2.reward.points === 150, "explicit 150");
  const c3 = chooseReward(2472, "300");
  ok(c3.ok && c3.reward.points === 300, "string 300");
  const c4 = chooseReward(200, 300);
  ok(!c4.ok && c4.error.includes("Not enough points"), "200 cannot use 300");
  const c5 = chooseReward(2472, 2472);
  ok(!c5.ok && c5.error.includes("Unknown reward"), "whole balance refused");
  const c6 = chooseReward(100, undefined);
  ok(!c6.ok && c6.error.includes("150"), "below minimum refused");
  const c7 = chooseReward(500, 150.5);
  ok(!c7.ok, "fractional refused");

  // Pricing: plain 25% off, no cap.
  const big = applyRewardPricing([line({ unitPriceMinorUnits: 50000, regularPriceMinorUnits: 50000 })], LOYALTY_REWARDS[1]);
  ok(big.ok && big.appliedMinorUnits === 12500, "25% of $500 = $125, no cap");
  const ten = applyRewardPricing([line({ quantity: 3 })], LOYALTY_REWARDS[0]);
  ok(ten.ok && ten.appliedMinorUnits === 300, "10% of 3 x $10 = $3");

  // Owner's real sale: $87.83 subtotal; 25% is about $22, not $46.50 or $64.70.
  const owner = applyRewardPricing([line({ unitPriceMinorUnits: 8783, regularPriceMinorUnits: 8783 })], LOYALTY_REWARDS[1]);
  ok(owner.ok && owner.appliedMinorUnits === 8783 - Math.round(8783 * 0.75), "owner sale 25% ~ $21.96");

  // Better of deal or reward per line, never both.
  const mixed = applyRewardPricing(
    [
      line({ lineId: "deal30", unitPriceMinorUnits: 700, regularPriceMinorUnits: 1000 }), // deal 30% beats 25%
      line({ lineId: "deal20", unitPriceMinorUnits: 800, regularPriceMinorUnits: 1000 }), // 25% beats 20% deal
      line({ lineId: "none", unitPriceMinorUnits: 1000, regularPriceMinorUnits: 1000 }),
    ],
    LOYALTY_REWARDS[1],
  );
  ok(mixed.ok, "mixed applies");
  if (mixed.ok) {
    const by = new Map(mixed.lines.map((l) => [l.lineId, l]));
    ok(by.get("deal30")?.winner === "existing" && by.get("deal30")?.unitPriceMinorUnits === 700, "30% deal kept");
    ok(by.get("deal20")?.unitPriceMinorUnits === 750 && by.get("deal20")?.loyaltyDiscountMinorUnits === 50, "25% replaces 20% deal (not stacked: 750 not 600)");
    ok(by.get("none")?.unitPriceMinorUnits === 750, "plain line 25% off");
    ok(mixed.appliedMinorUnits === 300, "applied = 50 + 250");
  }

  // Deals beat the reward everywhere -> refused, no points spent.
  const beaten = applyRewardPricing([line({ unitPriceMinorUnits: 500, regularPriceMinorUnits: 1000 })], LOYALTY_REWARDS[0]);
  ok(!beaten.ok && beaten.reason === "no_savings" && beaten.message.includes("No points were used"), "deal beats reward -> refused");

  // Legal floor: acquisition cost floor holds.
  const floored = applyRewardPricing([line({ costMinorUnits: 600 })], LOYALTY_REWARDS[1]);
  // floor = ceil(600 * 1.463) = 878 > 750, so the price stops at 878.
  ok(floored.ok && floored.lines[0].unitPriceMinorUnits === Math.ceil(600 * 1.463), "cost floor respected");
  const atFloor = applyRewardPricing([line({ costMinorUnits: 700 })], LOYALTY_REWARDS[1]);
  ok(!atFloor.ok, "line already at cost floor -> refused");

  // Merch (non-cannabis) gets the percent too.
  const merch = applyRewardPricing([line({ category: "merch", unitPriceMinorUnits: 2000, regularPriceMinorUnits: 2000 })], LOYALTY_REWARDS[0]);
  ok(merch.ok && merch.appliedMinorUnits === 200, "merch 10%");

  // Never-discount items keep their price.
  const nd = applyRewardPricing(
    [line({ lineId: "keep" }), line({ lineId: "cut" })],
    LOYALTY_REWARDS[1],
    { excludeLineIds: new Set(["keep"]) },
  );
  ok(nd.ok && nd.appliedMinorUnits === 250 && nd.lines[0].unitPriceMinorUnits === 1000 && nd.lines[0].loyaltyDiscountMinorUnits === 0, "never-discount line untouched");
  ok(nd.ok && nd.lines.length === 2, "excluded line still returned");
  const allNd = applyRewardPricing([line({ lineId: "keep" })], LOYALTY_REWARDS[1], { excludeLineIds: new Set(["keep"]) });
  ok(!allNd.ok, "only never-discount items -> refused");

  // Sync ceiling.
  ok(maxRewardOffMinor([{ quantity: 2, regularPriceMinor: 1000 }], LOYALTY_REWARDS[1]) === 500, "max off 25% of 2 x $10");
  ok(maxRewardOffMinor([{ quantity: 1, regularPriceMinor: 8783 }], LOYALTY_REWARDS[1]) === 8783 - Math.round(8783 * 0.75), "max off owner sale");
  ok(
    big.ok && big.appliedMinorUnits <= maxRewardOffMinor([{ quantity: 1, regularPriceMinor: 50000 }], LOYALTY_REWARDS[1]),
    "applied never above the ceiling",
  );

  // Redemption rows.
  ok(redemptionReward({ points: 150 })?.percentBps === 1000, "row 150 -> 10%");
  ok(redemptionReward({ points: 300 })?.percentBps === 2500, "row 300 -> 25%");
  ok(redemptionReward({ points: 647 }) === null, "row 647 -> legacy");
  ok(LEGACY_CODE_MESSAGE.includes("retired $0.10-per-point"), "legacy message names the retirement");

  // Website wording carries no dollar value per point.
  const terms = rewardTermsLines();
  ok(terms[0] === "150 points = 10% off your purchase." && terms[1] === "300 points = 25% off your purchase.", "terms lines");
  ok(!terms.join(" ").includes("$"), "terms never mention dollars");
  ok(rewardRedeemSentence().includes("One reward per visit"), "one reward per visit");

  return { passed, failed };
}
