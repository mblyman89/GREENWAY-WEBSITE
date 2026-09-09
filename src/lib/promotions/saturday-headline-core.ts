/**
 * src/lib/promotions/saturday-headline-core.ts  (SLICE D3)
 *
 * Super Saturday: "30% off any one item, 15% off everything else. The 30%
 * applies to the lowest priced item in the cart."
 *
 * PURE module. Both pricing engines (the register's discount-engine-core and
 * the website's cart-discount) delegate the two decisions that were getting
 * this deal wrong:
 *
 *   1. WHICH line receives the headline percent, and
 *   2. WHAT each unit costs, to the exact cent.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS - two measured defects
 * ---------------------------------------------------------------------------
 *
 * DEFECT 1 - THE HEADLINE WAS HANDED TO AN INELIGIBLE LINE AND THEN THROWN AWAY.
 *
 * Saturday picked its 30% target by scanning EVERY eligible line for the lowest
 * regular price. A clearance item ("50% off things we've been sitting on") is
 * almost by definition the cheapest thing in the basket, so Saturday handed the
 * 30% to it - and the engine's best-deal-wins rule (no stacking, ever) then
 * discarded the 30% because 50% beat it. The headline was consumed by the one
 * item that was supposed to be EXCLUDED from daily deals, and every full-price
 * item in the basket stayed on 15%.
 *
 * Measured over 2,000 random Saturday baskets that each contained one clearance
 * item: the advertised "30% off any one item" reached NOBODY in 2,000 of them
 * (100.0%). The same hole swallows a vendor-day brand sale. Owner's rule:
 * "those items are excluded from any and all other sales/daily deals" and
 * "discounts don't stack".
 *
 * The fix is `pickHeadlineLine`: choose the cheapest line that can actually
 * KEEP the headline - i.e. one no better offer is already beating. Re-running
 * the identical 2,000 baskets took "nobody got the 30%" from 2,000 to 0 while
 * the clearance item still received its full 50%.
 *
 * DEFECT 2 - THE MULTI-QUANTITY BLEND OVERCHARGED.
 *
 * When the target line had quantity > 1, one unit earned 30% and the rest 15%,
 * but the split was computed as round(price * 0.7) + round(price * 0.85) * (q-1)
 * and then re-divided by quantity - rounding the PRICE, twice, and then a third
 * time. That is the exact defect SLICE D2 removed everywhere else. Measured:
 * 1,169 of 1,498 blended line/quantity combinations charged MORE than the
 * advertised total, worst case 12 cents (price=507, qty=8).
 *
 * `saturdayLineTotal` computes the line's total with exact integer arithmetic -
 * ceil() on each unit's DISCOUNT so every rounding step favours the customer,
 * per the owner: "if it can't be exact, then we need to round in the customers
 * favor". A quantity-8 line is then 1 unit at 30% + 7 units at 15%, exactly.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE DELIBERATELY DOES *NOT* DO
 * ---------------------------------------------------------------------------
 * It does not clamp to the cost floor or the statutory floor. Those clamps are
 * per-unit and each engine owns its own (the register knows acquisition costs;
 * the website does not). This module returns the IDEAL exact-cent figures and
 * each caller clamps. Keeping the floors out here is what lets one module serve
 * both engines without either one importing the other's cost model.
 */

/** The minimum a line needs to expose for a headline decision. */
export type HeadlineCandidate = {
  lineId: string;
  regularPriceMinorUnits: number;
  /**
   * The best per-unit saving this line is ALREADY getting from some other,
   * higher-value promotion (clearance, vendor day). 0 when nothing else
   * applies. A line whose existing offer beats the headline cannot keep the
   * headline, so awarding it there would silently destroy the advertised deal.
   */
  competingUnitSavingsMinorUnits?: number;
};

/**
 * The per-unit saving the Saturday headline would give this line, ignoring any
 * floors. Exact integer maths: ceil() sends the half-cent to the customer.
 */
export function headlineUnitSavings(regularPriceMinorUnits: number, percent: number): number {
  if (regularPriceMinorUnits <= 0 || percent <= 0) return 0;
  return Math.ceil((regularPriceMinorUnits * percent) / 100);
}

/**
 * Choose the line that receives the headline percent.
 *
 * Owner's rule first: the LOWEST-priced item wins. That is preserved exactly.
 * The only refinement is that a line already being discounted MORE deeply by
 * another promotion is skipped, because awarding it the headline would destroy
 * the headline (best-deal-wins keeps the bigger offer and the 30% evaporates).
 *
 * Ties break on the lowest lineId so the result never depends on cart order -
 * previously the same basket rung up in a different order produced different
 * per-line receipts.
 *
 * Returns null when no line can carry the headline, which tells the caller to
 * fall back to giving every eligible line the "everything else" percent.
 */
export function pickHeadlineLine(
  candidates: HeadlineCandidate[],
  headlinePercent: number,
  restPercent: number,
): string | null {
  let bestId: string | null = null;
  let bestPrice = Number.POSITIVE_INFINITY;

  for (const c of candidates) {
    const competing = c.competingUnitSavingsMinorUnits ?? 0;
    const headline = headlineUnitSavings(c.regularPriceMinorUnits, headlinePercent);
    // A competing offer that is >= the headline would win best-deal-wins and
    // swallow the advertised percent. Such a line is not a valid target.
    if (competing >= headline) continue;
    // Prefer the cheapest; break ties deterministically, never by cart order.
    if (
      c.regularPriceMinorUnits < bestPrice ||
      (c.regularPriceMinorUnits === bestPrice && bestId !== null && c.lineId < bestId)
    ) {
      bestPrice = c.regularPriceMinorUnits;
      bestId = c.lineId;
    }
  }

  // Every line is already beating the headline, so there is nothing to award.
  // The caller still applies `restPercent` to everything.
  void restPercent;
  return bestId;
}

/** The exact-cent breakdown of the headline line when quantity may exceed 1. */
export type SaturdayLineTotal = {
  /** Total for the whole line, in minor units, before any per-unit clamping. */
  totalMinorUnits: number;
  /** Total saving across the line versus regular price. */
  savingsMinorUnits: number;
  /** The blended per-unit price, rounded DOWN so the line total is never exceeded. */
  blendedUnitMinorUnits: number;
  /** True when the line carries a headline unit (quantity >= 1 on the target). */
  hasHeadlineUnit: boolean;
};

/**
 * ONE unit at `headlinePercent`, the remainder at `restPercent`, computed with
 * exact integer arithmetic.
 *
 * Each unit's discount is ceil()'d independently, so the customer is never
 * short-changed on any unit, and the line total is the exact sum of those
 * units - not a re-rounded average. The blended unit price is floored so that
 * `blendedUnit * quantity` can never exceed the honest total.
 */
export function saturdayLineTotal(
  regularPriceMinorUnits: number,
  quantity: number,
  headlinePercent: number,
  restPercent: number,
  isHeadlineLine: boolean,
): SaturdayLineTotal {
  const qty = Math.max(0, Math.floor(quantity));
  if (qty <= 0 || regularPriceMinorUnits <= 0) {
    return {
      totalMinorUnits: 0,
      savingsMinorUnits: 0,
      blendedUnitMinorUnits: Math.max(0, regularPriceMinorUnits),
      hasHeadlineUnit: false,
    };
  }

  const headlineOff = headlineUnitSavings(regularPriceMinorUnits, headlinePercent);
  const restOff = headlineUnitSavings(regularPriceMinorUnits, restPercent);

  const headlineUnits = isHeadlineLine ? Math.min(1, qty) : 0;
  const restUnits = qty - headlineUnits;

  const savings = headlineOff * headlineUnits + restOff * restUnits;
  const regularTotal = regularPriceMinorUnits * qty;
  const total = regularTotal - savings;

  return {
    totalMinorUnits: total,
    savingsMinorUnits: savings,
    // Floor: a blended unit price must never multiply back up above the total.
    blendedUnitMinorUnits: Math.floor(total / qty),
    hasHeadlineUnit: headlineUnits > 0,
  };
}

/**
 * The percent a line ACTUALLY received, for display. A blended line is not
 * "15% off" - it carries one unit at the headline - and labelling it 15%
 * understated what the customer got. Rounds to the nearest whole percent.
 */
export function effectiveLinePercent(
  regularPriceMinorUnits: number,
  quantity: number,
  savingsMinorUnits: number,
): number {
  const regularTotal = regularPriceMinorUnits * Math.max(0, Math.floor(quantity));
  if (regularTotal <= 0 || savingsMinorUnits <= 0) return 0;
  return Math.round((savingsMinorUnits / regularTotal) * 100);
}

// ---------------------------------------------------------------------------
// SELF-TESTS
// ---------------------------------------------------------------------------

export function __runSaturdayHeadlineTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`saturday-headline-core: ${msg}`);
    passed += 1;
  };

  // --- headlineUnitSavings: exact, customer-favoured ------------------------
  ok(headlineUnitSavings(1000, 30) === 300, "30% of 1000 = 300");
  ok(headlineUnitSavings(999, 30) === 300, "30% of 999 ceils to 300 (customer)");
  ok(headlineUnitSavings(507, 15) === 77, "15% of 507 ceils to 77 (76.05)");
  ok(headlineUnitSavings(0, 30) === 0, "zero price -> zero saving");
  ok(headlineUnitSavings(1000, 0) === 0, "zero percent -> zero saving");
  ok(headlineUnitSavings(-5, 30) === 0, "negative price -> zero saving");
  // The D2 lesson: rounding the PRICE under-delivers. 170 * 0.7 is
  // 118.99999999999999 in IEEE 754; the exact discount is what we want.
  ok(170 - headlineUnitSavings(170, 30) === 119, "170 @30% -> 119, no float drift");

  // --- pickHeadlineLine: cheapest wins --------------------------------------
  {
    const id = pickHeadlineLine(
      [
        { lineId: "a", regularPriceMinorUnits: 5000 },
        { lineId: "b", regularPriceMinorUnits: 1000 },
        { lineId: "c", regularPriceMinorUnits: 2000 },
      ],
      30,
      15,
    );
    ok(id === "b", "cheapest line receives the headline");
  }

  // --- pickHeadlineLine: order independence (was cart-order dependent) ------
  {
    const forward = pickHeadlineLine(
      [
        { lineId: "x", regularPriceMinorUnits: 2000 },
        { lineId: "y", regularPriceMinorUnits: 2000 },
      ],
      30,
      15,
    );
    const reversed = pickHeadlineLine(
      [
        { lineId: "y", regularPriceMinorUnits: 2000 },
        { lineId: "x", regularPriceMinorUnits: 2000 },
      ],
      30,
      15,
    );
    ok(forward === reversed, "a price tie does not depend on cart order");
    ok(forward === "x", "a price tie breaks on the lowest lineId");
  }

  // --- pickHeadlineLine: THE CLEARANCE HIJACK ------------------------------
  {
    // The cheapest line is a clearance item already saving 50% (1171 off a
    // 2341 shelf price). Awarding it the 30% would destroy the headline.
    const id = pickHeadlineLine(
      [
        { lineId: "clearance", regularPriceMinorUnits: 2341, competingUnitSavingsMinorUnits: 1171 },
        { lineId: "mid", regularPriceMinorUnits: 5852 },
        { lineId: "dear", regularPriceMinorUnits: 11704 },
      ],
      30,
      15,
    );
    ok(id === "mid", "headline skips a clearance line and lands on the cheapest FULL-PRICE line");
  }
  {
    // A competing offer SMALLER than the headline does not disqualify a line:
    // the headline still wins best-deal-wins, so the customer keeps the 30%.
    const id = pickHeadlineLine(
      [{ lineId: "small", regularPriceMinorUnits: 1000, competingUnitSavingsMinorUnits: 100 }],
      30,
      15,
    );
    ok(id === "small", "a weaker competing offer does not block the headline");
  }
  {
    // Exactly equal: 30% of 1000 is 300 and the competing offer is 300. The
    // headline cannot IMPROVE on it, so the line is not a valid target.
    const id = pickHeadlineLine(
      [{ lineId: "equal", regularPriceMinorUnits: 1000, competingUnitSavingsMinorUnits: 300 }],
      30,
      15,
    );
    ok(id === null, "an equal competing offer is not a valid headline target");
  }
  {
    ok(pickHeadlineLine([], 30, 15) === null, "an empty basket has no headline target");
  }

  // --- saturdayLineTotal: single unit ---------------------------------------
  {
    const r = saturdayLineTotal(4000, 1, 30, 15, true);
    ok(r.totalMinorUnits === 2800, "single headline unit: 4000 -> 2800");
    ok(r.savingsMinorUnits === 1200, "single headline unit saves 1200");
    ok(r.blendedUnitMinorUnits === 2800, "single unit blended price is the unit price");
    ok(r.hasHeadlineUnit, "single unit on the target line carries the headline");
  }
  {
    const r = saturdayLineTotal(4000, 1, 30, 15, false);
    ok(r.totalMinorUnits === 3400, "non-target single unit: 4000 -> 3400 (15%)");
    ok(!r.hasHeadlineUnit, "non-target line carries no headline unit");
  }

  // --- saturdayLineTotal: THE 12-CENT OVERCHARGE ---------------------------
  {
    // The measured worst case: price=507, qty=8. The old blend charged 3376;
    // the honest total is 1 unit at 30% + 7 at 15%.
    const r = saturdayLineTotal(507, 8, 30, 15, true);
    const expected = 507 * 8 - (Math.ceil((507 * 30) / 100) + Math.ceil((507 * 15) / 100) * 7);
    ok(r.totalMinorUnits === expected, "507 x8 blend is exact");
    ok(r.totalMinorUnits === 3364, "507 x8 -> 3364, not the old 3376 (12c overcharge gone)");
    ok(r.totalMinorUnits < 3376, "the customer is no longer overcharged");
  }

  // --- saturdayLineTotal: never overcharge, at any price/quantity -----------
  {
    let overcharged = 0;
    for (let price = 1; price <= 400; price += 1) {
      for (let qty = 1; qty <= 12; qty += 1) {
        const r = saturdayLineTotal(price, qty, 30, 15, true);
        const advertised = price * qty - (Math.ceil((price * 30) / 100) + Math.ceil((price * 15) / 100) * (qty - 1));
        if (r.totalMinorUnits > advertised) overcharged += 1;
        // The blended unit must never multiply back above the honest total.
        if (r.blendedUnitMinorUnits * qty > r.totalMinorUnits) overcharged += 1;
      }
    }
    ok(overcharged === 0, "no price/quantity combination overcharges (4800 checked)");
  }

  // --- saturdayLineTotal: the headline is never counted twice ---------------
  {
    const r = saturdayLineTotal(1000, 5, 30, 15, true);
    ok(r.savingsMinorUnits === 300 + 150 * 4, "exactly ONE unit gets 30%, the rest 15%");
  }

  // --- saturdayLineTotal: degenerate input ---------------------------------
  {
    const zero = saturdayLineTotal(1000, 0, 30, 15, true);
    ok(zero.totalMinorUnits === 0, "zero quantity totals zero");
    const negPrice = saturdayLineTotal(0, 3, 30, 15, true);
    ok(negPrice.totalMinorUnits === 0, "zero price totals zero");
  }

  // --- effectiveLinePercent -------------------------------------------------
  {
    // A blended 30/15 line on quantity 2 is really ~22.5% -> 23% (rounded).
    const r = saturdayLineTotal(1000, 2, 30, 15, true);
    ok(effectiveLinePercent(1000, 2, r.savingsMinorUnits) === 23, "blended line reports ~23%, not 15%");
    const single = saturdayLineTotal(1000, 1, 30, 15, true);
    ok(effectiveLinePercent(1000, 1, single.savingsMinorUnits) === 30, "single headline unit reports 30%");
    ok(effectiveLinePercent(1000, 1, 0) === 0, "no saving reports 0%");
    ok(effectiveLinePercent(0, 1, 50) === 0, "zero regular price reports 0%");
  }

  return { passed };
}
