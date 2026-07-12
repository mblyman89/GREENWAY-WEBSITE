/**
 * src/lib/loyalty/program-terms-core.ts
 *
 * PURE formatting of the live loyalty program terms for the PUBLIC /loyalty
 * page (Task T / PR 3). The numbers come straight from the same
 * `loyalty_config` row the register uses (via loyalty-store.getConfig), so the
 * public page can never advertise terms that differ from what the POS pays.
 *
 * No I/O and no server-only imports so it can be unit-tested in isolation and
 * shared with client components if ever needed.
 */
import type { LoyaltyConfig, LoyaltyTier } from "@/lib/loyalty/engine";

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export type LoyaltyTermsSummary = {
  /** e.g. "Earn 1 point for every $1 you spend (pre-tax)." */
  earnLine: string;
  /** e.g. "100 points = $1.00 off at the register." */
  valueLine: string;
  /** e.g. "Redeem once you reach 100 points ($1.00)." */
  redeemLine: string;
  /** e.g. "New members start with 200 bonus points." — null when no bonus. */
  signupBonusLine: string | null;
  /** e.g. "Redemption codes stay valid for 30 days." — null when no expiry. */
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

  // Express value at the "per 100 points" scale so odd point values still read
  // naturally (e.g. pointValueMinor 5 → "100 points = $5.00 off").
  const valuePer100 = cfg.pointValueMinor * 100;
  const valueLine = `100 points = ${money(valuePer100)} off at the register.`;

  const redeemLine = `Redeem once you reach ${cfg.minRedeemPoints.toLocaleString("en-US")} points (${money(
    cfg.minRedeemPoints * cfg.pointValueMinor,
  )}).`;

  const signupBonusLine =
    cfg.signupBonusPoints > 0
      ? `New members start with ${cfg.signupBonusPoints.toLocaleString("en-US")} bonus points.`
      : null;

  const expiryLine =
    cfg.codeExpiryDays != null && cfg.codeExpiryDays > 0
      ? `Redemption codes stay valid for ${plural(cfg.codeExpiryDays, "day")}.`
      : null;

  return { earnLine, valueLine, redeemLine, signupBonusLine, expiryLine };
}

export type TierDisplayRow = {
  name: string;
  /** e.g. "5,000+ pts" */
  thresholdLabel: string;
  /** e.g. "5% off" — empty string when the tier carries no discount. */
  perkLabel: string;
};

/** Display rows for the active tier ladder (already sorted by min_points). */
export function tierDisplayRows(tiers: LoyaltyTier[]): TierDisplayRow[] {
  return tiers.map((t) => ({
    name: t.name,
    thresholdLabel: `${t.minPoints.toLocaleString("en-US")}+ pts`,
    perkLabel: t.discountBps > 0 ? `${(t.discountBps / 100).toLocaleString("en-US")}% off` : "",
  }));
}
