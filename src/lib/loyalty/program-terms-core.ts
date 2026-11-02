/**
 * src/lib/loyalty/program-terms-core.ts
 *
 * PURE formatting of the live loyalty program terms for the PUBLIC /loyalty
 * page (Task T / PR 3). The numbers come straight from the same
 * `loyalty_config` row the register uses (via loyalty-store.getConfig), so the
 * public page can never advertise terms that differ from what the POS pays.
 *
 * D137 (owner 2026-11-02): points have NO cash value any more (the
 * $0.10-per-point program is retired). The value / redeem lines describe the
 * two rewards (150 pts = 10% off, 300 pts = 25% off) from loyalty-reward-core,
 * and the tier ladder is member badge names only (no perk).
 *
 * No I/O and no server-only imports so it can be unit-tested in isolation and
 * shared with client components if ever needed.
 */
import type { LoyaltyConfig, LoyaltyTier } from "@/lib/loyalty/engine";
import { rewardRedeemSentence, rewardTermsLines } from "@/lib/loyalty/loyalty-reward-core";

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export type LoyaltyTermsSummary = {
  /** e.g. "Earn 1 point for every $1 you spend (pre-tax)." */
  earnLine: string;
  /** "150 points = 10% off your purchase. 300 points = 25% off your purchase." */
  valueLine: string;
  /** "Use 150 points for 10% off, or 300 points for 25% off. One reward per visit; ..." */
  redeemLine: string;
  /** e.g. "New members start with 200 bonus points." — null when no bonus. */
  signupBonusLine: string | null;
  /** e.g. "Reward codes stay valid for 30 days." — null when no expiry. */
  expiryLine: string | null;
};

/**
 * Human sentences for the live program terms. All figures derive from the
 * config row — nothing is hardcoded, so admin edits show up on the public
 * page after the next render.
 */
export function loyaltyTermsSummary(cfg: LoyaltyConfig): LoyaltyTermsSummary {
  const earnLine =
    cfg.pointsPerDollar === 1
      ? "Earn 1 point for every $1 you spend (pre-tax)."
      : `Earn ${cfg.pointsPerDollar} points for every $1 you spend (pre-tax).`;

  // D137: rewards, not cash. Points have no dollar value.
  const valueLine = rewardTermsLines().join(" ");
  const redeemLine = rewardRedeemSentence();

  const signupBonusLine =
    cfg.signupBonusPoints > 0
      ? `New members start with ${cfg.signupBonusPoints.toLocaleString("en-US")} bonus points.`
      : null;

  const expiryLine =
    cfg.codeExpiryDays != null && cfg.codeExpiryDays > 0
      ? `Reward codes stay valid for ${plural(cfg.codeExpiryDays, "day")}.`
      : null;

  return { earnLine, valueLine, redeemLine, signupBonusLine, expiryLine };
}

export type TierDisplayRow = {
  name: string;
  /** e.g. "5,000+ pts" */
  thresholdLabel: string;
  /**
   * D139: always "" — member tiers are badge NAMES only (the tier discount
   * is retired). Kept so older callers that render it show nothing.
   */
  perkLabel: string;
};

/** Display rows for the member badge ladder (already sorted by min_points). */
export function tierDisplayRows(tiers: LoyaltyTier[]): TierDisplayRow[] {
  return tiers.map((t) => ({
    name: t.name,
    thresholdLabel: `${t.minPoints.toLocaleString("en-US")}+ lifetime pts`,
    perkLabel: "",
  }));
}
