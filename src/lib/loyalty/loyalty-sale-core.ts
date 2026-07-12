/**
 * src/lib/loyalty/loyalty-sale-core.ts  (Task S-a)
 *
 * PURE math for applying loyalty value AT THE POINT OF SALE (no I/O, no
 * server-only imports; self-tested via __runLoyaltySaleTests, wired into the
 * compliance harness).
 *
 * Policy (docs/LOYALTY_COMPLIANCE.md — owner directive "no discount stacking,
 * better discount wins for the customer"):
 *
 *  1. TIER standing discount vs the promotion price: per line, the customer
 *     gets whichever unit price is LOWER — the promotion-discounted price the
 *     order already carries, or the tier percent taken off the REGULAR price.
 *     Never both compounded.
 *  2. REDEMPTION CODES are stored value (points were deducted at issuance).
 *     The code's value is spread across the order's lines as whole-cent
 *     per-unit reductions, largest-capacity lines first, single-unit lines
 *     last so they can absorb any penny remainder exactly.
 *  3. EVERY reduced unit price is clamped to the statutory cannabis floor
 *     (RCW 69.50.357 — never free) AND the acquisition-cost floor
 *     (WAC 314-55-155(5)(g); CCRS Upload User Guide) — the SAME floors the
 *     promotions engine enforces.
 *
 * All money in MINOR UNITS (cents). Card prices are tax-inclusive, so the
 * cost floor is ceil(cost × category divisor), mirroring cart-discount.ts.
 */
import {
  MIN_CANNABIS_UNIT_PRICE_MINOR,
  NON_CANNABIS_TAX_INCLUSIVE_DIVISOR,
  TAX_INCLUSIVE_DIVISOR,
  isNonCannabisCategory,
} from "@/lib/orders/order-pricing-core";

export type LoyaltySaleLine = {
  lineId: string;
  category: string | null | undefined;
  quantity: number;
  /** CURRENT unit price on the order (promo-discounted, tax-inclusive). */
  unitPriceMinorUnits: number;
  /** Pre-discount unit price (tax-inclusive). */
  regularPriceMinorUnits: number;
  /** Weighted-average acquisition cost per unit (PRE-tax), when known. */
  costMinorUnits: number | null;
};

/**
 * The lowest a unit of this line may legally sell for. Statutory 1¢ floor for
 * cannabis (RCW 69.50.357) plus the tax-inclusive acquisition-cost floor for
 * ALL products when the cost is known (WAC 314-55-155(5)(g)); never above the
 * regular price (a regular price at/below cost is a pricing problem the
 * below-cost audit surfaces — loyalty simply refuses to discount further).
 */
export function loyaltyUnitFloor(line: {
  category: string | null | undefined;
  regularPriceMinorUnits: number;
  costMinorUnits: number | null;
}): number {
  const nonCannabis = isNonCannabisCategory(line.category);
  const statutory =
    !nonCannabis && line.regularPriceMinorUnits > 0 ? MIN_CANNABIS_UNIT_PRICE_MINOR : 0;
  const cost = line.costMinorUnits;
  if (cost == null || !Number.isFinite(cost) || cost <= 0) return statutory;
  const divisor = nonCannabis ? NON_CANNABIS_TAX_INCLUSIVE_DIVISOR : TAX_INCLUSIVE_DIVISOR;
  const costFloor = Math.min(Math.ceil(cost * divisor), Math.max(0, line.regularPriceMinorUnits));
  return Math.max(statutory, costFloor);
}

// ---------------------------------------------------------------------------
// 1) Tier standing discount — per-line best-deal-wins vs the promo price
// ---------------------------------------------------------------------------

export type TierPricingLine = {
  lineId: string;
  /** New unit price after best-deal-wins (may equal the current price). */
  unitPriceMinorUnits: number;
  /** Per-UNIT reduction taken by the tier (0 when the promo price won). */
  loyaltyDiscountMinorUnits: number;
  /** Which price won this line. */
  winner: "tier" | "existing";
};

export type TierPricingResult = {
  lines: TierPricingLine[];
  /** Total additional tax-inclusive savings vs the order's current pricing. */
  additionalSavingsMinorUnits: number;
};

/**
 * Apply a tier standing discount with per-line best-deal-wins: each line gets
 * the LOWER of its current (promo) unit price and the tier percent off its
 * REGULAR price — never both. Every tier price is clamped to the loyalty
 * floor. Ties keep the existing price (promo label preserved).
 */
export function applyTierPricing(
  lines: LoyaltySaleLine[],
  tierDiscountBps: number,
): TierPricingResult {
  const bps = Math.min(Math.max(0, Math.round(tierDiscountBps)), 9999); // <100% (RCW 69.50.357)
  const out: TierPricingLine[] = [];
  let savings = 0;
  for (const line of lines) {
    const current = Math.max(0, Math.round(line.unitPriceMinorUnits));
    const floor = loyaltyUnitFloor(line);
    const rawTier = Math.round(line.regularPriceMinorUnits * (1 - bps / 10000));
    const tierUnit = Math.max(floor, rawTier);
    if (bps > 0 && tierUnit < current) {
      const perUnit = current - tierUnit;
      out.push({
        lineId: line.lineId,
        unitPriceMinorUnits: tierUnit,
        loyaltyDiscountMinorUnits: perUnit,
        winner: "tier",
      });
      savings += perUnit * Math.max(0, Math.round(line.quantity));
    } else {
      out.push({
        lineId: line.lineId,
        unitPriceMinorUnits: current,
        loyaltyDiscountMinorUnits: 0,
        winner: "existing",
      });
    }
  }
  return { lines: out, additionalSavingsMinorUnits: savings };
}

// ---------------------------------------------------------------------------
// 2) Redemption-code spread — stored value across lines, floors respected
// ---------------------------------------------------------------------------

export type CodeSpreadLine = {
  lineId: string;
  unitPriceMinorUnits: number;
  /** Per-UNIT reduction taken by the code. */
  loyaltyDiscountMinorUnits: number;
};

export type CodeSpreadResult =
  | {
      ok: true;
      lines: CodeSpreadLine[];
      /** Value actually applied (≤ code value; see unusedMinorUnits). */
      appliedMinorUnits: number;
      /**
       * Penny remainder that could not be split into whole-cent per-unit
       * reductions (only possible when every line has quantity > 1). Never
       * more than the smallest line quantity minus one.
       */
      unusedMinorUnits: number;
    }
  | {
      ok: false;
      reason: "no_capacity" | "insufficient_capacity";
      /** The most this cart could absorb above the legal floors. */
      absorbableMinorUnits: number;
    };

/**
 * Spread a redemption code's tax-inclusive value across the order's lines as
 * whole-cent per-unit reductions. Each unit price is clamped to its loyalty
 * floor; the cart must be able to absorb the FULL value (minus at most a
 * penny-split remainder) or the spread is refused with the absorbable amount
 * so staff can add items or issue a smaller code — value is never silently
 * forfeited.
 *
 * Allocation: proportional-by-capacity first pass, then a greedy remainder
 * pass that visits single-unit lines LAST so they soak up any leftover cents
 * exactly.
 */
export function spreadCodeValue(
  lines: LoyaltySaleLine[],
  valueMinorUnits: number,
): CodeSpreadResult {
  const value = Math.max(0, Math.round(valueMinorUnits));
  type Work = {
    line: LoyaltySaleLine;
    qty: number;
    current: number;
    capPerUnit: number;
    reduction: number;
  };
  const work: Work[] = lines.map((line) => {
    const qty = Math.max(0, Math.round(line.quantity));
    const current = Math.max(0, Math.round(line.unitPriceMinorUnits));
    const capPerUnit = Math.max(0, current - loyaltyUnitFloor(line));
    return { line, qty, current, capPerUnit, reduction: 0 };
  });

  const totalCapacity = work.reduce((sum, w) => sum + w.capPerUnit * w.qty, 0);
  if (totalCapacity <= 0) {
    return { ok: false, reason: "no_capacity", absorbableMinorUnits: 0 };
  }
  if (totalCapacity < value) {
    return { ok: false, reason: "insufficient_capacity", absorbableMinorUnits: totalCapacity };
  }

  // Pass 1: proportional-by-capacity whole-cent per-unit reductions (floor).
  let remaining = value;
  for (const w of work) {
    if (w.capPerUnit <= 0 || w.qty <= 0) continue;
    const share = Math.floor(((w.capPerUnit * w.qty) / totalCapacity) * value);
    const perUnit = Math.min(w.capPerUnit, Math.floor(share / w.qty));
    w.reduction = perUnit;
    remaining -= perUnit * w.qty;
  }

  // Pass 2: greedy remainder — multi-unit lines first, single-unit lines last
  // so the final cents always land somewhere they fit exactly.
  const ordered = [...work].sort((a, b) => b.qty - a.qty);
  for (const w of ordered) {
    if (remaining <= 0) break;
    if (w.qty <= 0) continue;
    const room = w.capPerUnit - w.reduction;
    if (room <= 0) continue;
    const add = Math.min(room, Math.floor(remaining / w.qty));
    if (add > 0) {
      w.reduction += add;
      remaining -= add * w.qty;
    }
  }

  return {
    ok: true,
    lines: work.map((w) => ({
      lineId: w.line.lineId,
      unitPriceMinorUnits: w.current - w.reduction,
      loyaltyDiscountMinorUnits: w.reduction,
    })),
    appliedMinorUnits: value - remaining,
    unusedMinorUnits: remaining,
  };
}

// ---------------------------------------------------------------------------
// 3) Completion consistency check (defense in depth for the gate)
// ---------------------------------------------------------------------------

export type LoyaltyCompletionCheck = { ok: true } | { ok: false; reason: string };

/**
 * An order carrying a loyalty CODE may only complete when the redemption row
 * is consumed by THIS order. Catches reopened/cancelled-order drift and rows
 * released or re-used elsewhere.
 */
export function checkLoyaltyCodeForCompletion(
  order: { id: string; loyaltyKind: string | null; loyaltyRedemptionId: string | null },
  redemption: { id: string; status: string; redeemedOrderId: string | null } | null,
): LoyaltyCompletionCheck {
  if (order.loyaltyKind !== "code") return { ok: true };
  if (!order.loyaltyRedemptionId || !redemption) {
    return {
      ok: false,
      reason:
        "This order shows a loyalty code but the redemption record is missing. Remove the loyalty discount and re-apply the code before completing.",
    };
  }
  if (redemption.status !== "redeemed" || redemption.redeemedOrderId !== order.id) {
    return {
      ok: false,
      reason:
        "This order's loyalty code is no longer reserved for it (it was released or used on another order). Remove the loyalty discount and re-apply a valid code before completing.",
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runLoyaltySaleTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
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

  // Floors
  ok(loyaltyUnitFloor(line()) === 1, "cannabis statutory floor 1c");
  ok(loyaltyUnitFloor(line({ category: "merch" })) === 0, "merch floor 0");
  ok(
    loyaltyUnitFloor(line({ costMinorUnits: 400 })) === Math.ceil(400 * 1.463),
    "cannabis cost floor ceil(cost x 1.463)",
  );
  ok(
    loyaltyUnitFloor(line({ category: "merch", costMinorUnits: 400 })) === Math.ceil(400 * 1.093),
    "merch cost floor ceil(cost x 1.093)",
  );
  ok(
    loyaltyUnitFloor(line({ costMinorUnits: 900, regularPriceMinorUnits: 1000 })) === 1000,
    "cost floor capped at regular",
  );

  // Tier: best-deal-wins per line, never stacked on the promo price.
  {
    const r = applyTierPricing(
      [
        // Promo already gives 30% (700); tier 10% (900) — promo wins, no change.
        line({ lineId: "a", unitPriceMinorUnits: 700 }),
        // No promo (1000); tier 10% (900) — tier wins, reduction 100/unit.
        line({ lineId: "b", quantity: 2 }),
      ],
      1000,
    );
    const a = r.lines.find((l) => l.lineId === "a")!;
    const b = r.lines.find((l) => l.lineId === "b")!;
    ok(a.winner === "existing" && a.unitPriceMinorUnits === 700, "promo beats tier: unchanged");
    ok(a.loyaltyDiscountMinorUnits === 0, "no stacking on promo-won line");
    ok(b.winner === "tier" && b.unitPriceMinorUnits === 900, "tier beats regular");
    ok(b.loyaltyDiscountMinorUnits === 100, "tier reduction from CURRENT price");
    ok(r.additionalSavingsMinorUnits === 200, "savings = 100 x qty 2");
  }
  {
    // Tier price clamped to the cost floor.
    const r = applyTierPricing([line({ costMinorUnits: 650 })], 5000); // 50% -> 500 raw
    const floor = Math.ceil(650 * 1.463); // 951
    ok(r.lines[0].unitPriceMinorUnits === floor, "tier clamped to cost floor");
    ok(r.lines[0].loyaltyDiscountMinorUnits === 1000 - floor, "clamped reduction recorded");
  }
  {
    // Tie keeps existing price.
    const r = applyTierPricing([line({ unitPriceMinorUnits: 900 })], 1000);
    ok(r.lines[0].winner === "existing" && r.additionalSavingsMinorUnits === 0, "tie -> existing");
  }
  {
    // 0 bps tier changes nothing.
    const r = applyTierPricing([line()], 0);
    ok(r.additionalSavingsMinorUnits === 0, "0 bps no-op");
  }

  // Code spread
  {
    // Exact spread across two single-unit lines.
    const r = spreadCodeValue([line({ lineId: "a" }), line({ lineId: "b" })], 500);
    ok(r.ok, "spread ok");
    if (r.ok) {
      const total = r.lines.reduce((s, l) => s + l.loyaltyDiscountMinorUnits, 0);
      ok(total === 500 && r.appliedMinorUnits === 500 && r.unusedMinorUnits === 0, "full value applied");
      ok(
        r.lines.every((l) => l.unitPriceMinorUnits >= 1),
        "floors respected",
      );
    }
  }
  {
    // Insufficient capacity refused with the absorbable amount.
    const r = spreadCodeValue([line({ costMinorUnits: 650 })], 500); // cap = 1000-951 = 49
    ok(!r.ok, "insufficient refused");
    if (!r.ok) {
      ok(r.reason === "insufficient_capacity" && r.absorbableMinorUnits === 1000 - Math.ceil(650 * 1.463), "absorbable reported");
    }
  }
  {
    // No capacity at all (already at the floor).
    const r = spreadCodeValue([line({ unitPriceMinorUnits: 1, costMinorUnits: null })], 100);
    ok(!r.ok && !r.ok && r.reason === "no_capacity", "no capacity refused");
  }
  {
    // Multi-unit remainder lands on the single-unit line exactly.
    const r = spreadCodeValue(
      [line({ lineId: "m", quantity: 3 }), line({ lineId: "s", quantity: 1 })],
      101,
    );
    ok(r.ok, "penny split ok");
    if (r.ok) {
      const applied = r.lines.reduce((s, l) => {
        const qty = l.lineId === "m" ? 3 : 1;
        return s + l.loyaltyDiscountMinorUnits * qty;
      }, 0);
      ok(applied === 101 && r.unusedMinorUnits === 0, "single-unit line absorbs remainder");
    }
  }
  {
    // All multi-unit lines: tiny remainder reported, never exceeded.
    const r = spreadCodeValue([line({ quantity: 2 })], 101);
    ok(r.ok, "multi-unit only ok");
    if (r.ok) {
      ok(r.appliedMinorUnits === 100 && r.unusedMinorUnits === 1, "remainder 1c reported");
      ok(r.lines[0].loyaltyDiscountMinorUnits === 50, "50c per unit x2");
    }
  }
  {
    // Full-cart wipe attempt: cannabis floor holds (never free — RCW 69.50.357).
    const r = spreadCodeValue([line()], 999);
    ok(r.ok, "999 of 1000 absorbable");
    if (r.ok) ok(r.lines[0].unitPriceMinorUnits === 1, "unit stops at 1c");
    const r2 = spreadCodeValue([line()], 1000);
    ok(!r2.ok && (!r2.ok && r2.absorbableMinorUnits === 999), "1000 refused: max 999");
  }

  // Completion check
  {
    const base = { id: "o1", loyaltyKind: "code", loyaltyRedemptionId: "r1" };
    ok(
      checkLoyaltyCodeForCompletion(base, { id: "r1", status: "redeemed", redeemedOrderId: "o1" }).ok,
      "consistent code completes",
    );
    ok(
      !checkLoyaltyCodeForCompletion(base, { id: "r1", status: "issued", redeemedOrderId: null }).ok,
      "released code blocks",
    );
    ok(
      !checkLoyaltyCodeForCompletion(base, { id: "r1", status: "redeemed", redeemedOrderId: "o2" }).ok,
      "code on another order blocks",
    );
    ok(!checkLoyaltyCodeForCompletion(base, null).ok, "missing row blocks");
    ok(
      checkLoyaltyCodeForCompletion(
        { id: "o1", loyaltyKind: null, loyaltyRedemptionId: null },
        null,
      ).ok,
      "no loyalty passes",
    );
    ok(
      checkLoyaltyCodeForCompletion(
        { id: "o1", loyaltyKind: "tier", loyaltyRedemptionId: null },
        null,
      ).ok,
      "tier kind needs no redemption row",
    );
  }

  console.log(`loyalty-sale-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`${fail} loyalty-sale-core tests failed`);
}
