/**
 * src/lib/loyalty/engine.ts
 *
 * PURE loyalty math (no I/O, no server-only imports) so it can be unit-tested
 * with tsx directly. All money in MINOR UNITS (cents); rates in basis points.
 *
 * Per owner: points accrue PRETAX at 1pt/$1 by default; NO tax counts toward
 * points. Tiers grant a standing discount. Promotions add multipliers or flat
 * bonuses (incl. daily happy-hour windows in Pacific time).
 */

export type LoyaltyConfig = {
  pointsPerDollar: number;   // 1.0 = 1pt/$1
  pointValueMinor: number;   // cents per point (e.g. 1 = $0.01)
  minRedeemPoints: number;
  signupBonusPoints: number;
  codeExpiryDays: number | null;
};

export type LoyaltyTier = {
  id: string;
  name: string;
  minPoints: number;
  discountBps: number;
};

export type LoyaltyPromotion = {
  id: string;
  kind: "signup" | "happy_hour" | "promo" | "custom";
  multiplierBps: number;     // 10000 = 1.0x
  flatBonusPoints: number;
  startsAt?: string | null;
  endsAt?: string | null;
  hourStart?: number | null; // Pacific hour 0-23
  hourEnd?: number | null;   // Pacific hour 0-23 (exclusive)
  isActive: boolean;
};

/**
 * Base points earned on a PRETAX subtotal (minor units). Floored to a whole
 * number — fractional points are not granted.
 */
export function basePointsForSubtotal(subtotalMinor: number, cfg: LoyaltyConfig): number {
  if (subtotalMinor <= 0) return 0;
  const dollars = subtotalMinor / 100;
  return Math.floor(dollars * cfg.pointsPerDollar);
}

/**
 * Is a promotion live at the given instant (Pacific hour supplied separately
 * so this stays pure and testable)?
 */
export function isPromotionLive(
  promo: LoyaltyPromotion,
  at: Date,
  pacificHour: number,
): boolean {
  if (!promo.isActive) return false;
  const t = at.getTime();
  if (promo.startsAt && t < new Date(promo.startsAt).getTime()) return false;
  if (promo.endsAt && t > new Date(promo.endsAt).getTime()) return false;
  // Happy-hour window (if both bounds set). Supports wrap-around (e.g. 22→2).
  if (promo.hourStart != null && promo.hourEnd != null) {
    const s = promo.hourStart;
    const e = promo.hourEnd;
    const inWindow = s <= e ? pacificHour >= s && pacificHour < e : pacificHour >= s || pacificHour < e;
    if (!inWindow) return false;
  }
  return true;
}

/**
 * Apply the single best (highest-yield) live promotion to base points.
 * Returns earned points and which promo (if any) applied.
 */
export function earnedPoints(
  basePoints: number,
  promos: LoyaltyPromotion[],
  at: Date,
  pacificHour: number,
): { points: number; promotionId: string | null } {
  if (basePoints <= 0) return { points: 0, promotionId: null };
  let best = basePoints;
  let bestId: string | null = null;
  for (const p of promos) {
    if (!isPromotionLive(p, at, pacificHour)) continue;
    const withMult = Math.floor((basePoints * p.multiplierBps) / 10000);
    const total = withMult + p.flatBonusPoints;
    if (total > best) {
      best = total;
      bestId = p.id;
    }
  }
  return { points: best, promotionId: bestId };
}

/** The highest tier the account qualifies for given its points. */
export function tierForPoints(points: number, tiers: LoyaltyTier[]): LoyaltyTier | null {
  let chosen: LoyaltyTier | null = null;
  for (const tier of tiers) {
    if (points >= tier.minPoints) {
      if (!chosen || tier.minPoints > chosen.minPoints) chosen = tier;
    }
  }
  return chosen;
}

/** Standing discount (bps) for an account at a points balance. */
export function tierDiscountBps(points: number, tiers: LoyaltyTier[]): number {
  return tierForPoints(points, tiers)?.discountBps ?? 0;
}

/** Cash value (minor units) of a points balance under config. */
export function pointsValueMinor(points: number, cfg: LoyaltyConfig): number {
  return Math.max(0, Math.floor(points * cfg.pointValueMinor));
}

/** Can this balance redeem? */
export function canRedeem(balance: number, requested: number, cfg: LoyaltyConfig): boolean {
  return requested > 0 && balance >= requested && balance >= cfg.minRedeemPoints;
}

/**
 * Generate a human-friendly redemption code, e.g. "GW-7K3M-92QF".
 * Uses an unambiguous alphabet (no O/0/I/1) and an injected random source for
 * deterministic testing.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateRedemptionCode(rand: () => number = Math.random): string {
  const block = () =>
    Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)]).join("");
  return `GW-${block()}-${block()}`;
}

/** Compute a redemption-code expiry timestamp from config (or null). */
export function codeExpiry(from: Date, cfg: LoyaltyConfig): string | null {
  if (cfg.codeExpiryDays == null) return null;
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + cfg.codeExpiryDays);
  return d.toISOString();
}

export function formatPoints(points: number): string {
  return `${points.toLocaleString("en-US")} pt${points === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Inline tests (run: import into _tt.ts then `npx tsx _tt.ts`)
// ---------------------------------------------------------------------------
export function __runEngineTests(): void {
  const cfg: LoyaltyConfig = {
    pointsPerDollar: 1,
    pointValueMinor: 1,
    minRedeemPoints: 100,
    signupBonusPoints: 0,
    codeExpiryDays: 30,
  };
  let n = 0;
  const ok = (c: boolean, m: string) => {
    n++;
    if (!c) throw new Error(`Test failed: ${m}`);
  };

  // base points pretax, floored
  ok(basePointsForSubtotal(2599, cfg) === 25, "$25.99 -> 25 pts");
  ok(basePointsForSubtotal(0, cfg) === 0, "zero -> 0");
  ok(basePointsForSubtotal(-500, cfg) === 0, "negative -> 0");
  ok(basePointsForSubtotal(10000, { ...cfg, pointsPerDollar: 2 }) === 200, "2x rate");

  // tiers
  const tiers: LoyaltyTier[] = [
    { id: "b", name: "Bronze", minPoints: 150, discountBps: 1000 },
    { id: "g", name: "Gold", minPoints: 300, discountBps: 2500 },
  ];
  ok(tierForPoints(100, tiers) === null, "100 -> no tier");
  ok(tierForPoints(150, tiers)?.name === "Bronze", "150 -> Bronze");
  ok(tierForPoints(500, tiers)?.name === "Gold", "500 -> Gold");
  ok(tierDiscountBps(500, tiers) === 2500, "Gold = 25%");
  ok(tierDiscountBps(0, tiers) === 0, "no tier = 0%");

  // promotions
  const at = new Date("2024-06-15T20:00:00Z");
  const happy: LoyaltyPromotion = {
    id: "hh",
    kind: "happy_hour",
    multiplierBps: 20000, // 2x
    flatBonusPoints: 0,
    hourStart: 16,
    hourEnd: 18,
    isActive: true,
  };
  ok(isPromotionLive(happy, at, 17) === true, "happy hour at 17");
  ok(isPromotionLive(happy, at, 19) === false, "no happy hour at 19");
  ok(earnedPoints(50, [happy], at, 17).points === 100, "2x at happy hour");
  ok(earnedPoints(50, [happy], at, 19).points === 50, "base outside window");

  const wrap: LoyaltyPromotion = { ...happy, id: "w", hourStart: 22, hourEnd: 2 };
  ok(isPromotionLive(wrap, at, 23) === true, "wrap window 23");
  ok(isPromotionLive(wrap, at, 1) === true, "wrap window 1");
  ok(isPromotionLive(wrap, at, 5) === false, "wrap window 5 out");

  // redemption value + gating
  ok(pointsValueMinor(250, cfg) === 250, "250 pts = $2.50");
  ok(canRedeem(250, 100, cfg) === true, "can redeem");
  ok(canRedeem(50, 50, cfg) === false, "below min cannot redeem");
  ok(canRedeem(250, 0, cfg) === false, "zero request");

  // code generation deterministic
  let seed = 0;
  const rand = () => {
    seed += 0.0625;
    return seed % 1;
  };
  const code = generateRedemptionCode(rand);
  ok(/^GW-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), `code format: ${code}`);

  ok((codeExpiry(new Date("2024-01-01T00:00:00Z"), cfg) ?? "").startsWith("2024-01-31"), "expiry +30d");
  ok(codeExpiry(new Date(), { ...cfg, codeExpiryDays: null }) === null, "no expiry");

  console.log(`loyalty/engine.ts: ${n} tests passed`);
}
