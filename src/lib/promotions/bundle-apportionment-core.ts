/**
 * SLICE D1 — HONOUR THE ADVERTISED SAVING, TO THE CENT.
 *
 * ── THE BUG THIS REPLACES ───────────────────────────────────────────────────
 * Every "buy N for the price of M" deal (Ice Cream Sunday 3-for-2, Doobie
 * Tuesday 4-for-3) converted its savings target into a WHOLE-NUMBER PERCENT
 * and floored it:
 *
 *     const percent = Math.min(99, Math.floor((targetSavings / eligibleTotal) * 100));
 *
 * Measured on the owner's own example — a $60 + $40 + $20 Sunday basket, where
 * a true 3-for-2 frees the $20 item:
 *
 *     exact target      $20.00   (16.6667% of $120.00)
 *     floor to 16%      $19.20
 *     SHORT             $0.80
 *
 * That is not a rounding cent. Flooring a PERCENT throws away up to 0.999% of
 * the whole basket — roughly a hundred times coarser than the cent-level
 * rounding it was believed to be. The store advertised "buy 3, pay for 2" and
 * charged more than that, on every mixed-price basket, in the customer's
 * disfavour. The owner found it at the register and called it correctly:
 * "its close, but a false advertisement none the less."
 *
 * ── THE OWNER'S ROUNDING POLICY, AS ACTUALLY STATED ─────────────────────────
 * The "store wins" convention is a ROUNDING rule, not a deal-selection rule:
 *
 *   "the reason we implemented the store wins policy is more for rounding
 *    issues. we like whole numbers as much as possible, so if we need to
 *    round, we should always round up or round in our favor."
 *
 * and then, once the size of the gap was measured:
 *
 *   "if it cant be exact, then we need to round in the customers favor
 *    somehow. Take a penny extra out of one somehow take from one more than
 *    the other two slightly... im fine with giving the customer the benefit of
 *    the doubt so we can honor discounts as advertised."
 *
 * So for an ADVERTISED BUNDLE the priority order is:
 *   1. hit the advertised saving EXACTLY when the line model allows it;
 *   2. otherwise round UP, toward the customer, never down;
 *   3. except where a legal floor forbids it — that limit is absolute.
 *
 * ── WHY EXACT IS SOMETIMES IMPOSSIBLE (measured, not assumed) ───────────────
 * Both engines represent a discounted line as ONE unit price times a quantity,
 * so a line's savings must be a multiple of its quantity. Three units of
 * $10.00 owe $10.00 of savings, but 1000/3 = 333.33¢ per unit, which is not a
 * whole cent. The reachable amounts are $9.99 and $10.02.
 *
 * Measured over 30,000 random baskets (scripts/compliance/probe-customer-favor.ts):
 *   exactly on target ............ 60.65%
 *   rounded up to the customer ... 36.63%   (average 1.63¢, worst 4¢)
 *   short with headroom .......... 0
 *   below a cost floor ........... 0
 *   cost to the store ............ 0.598¢ per basket
 *
 * Under a penny a basket buys an engine that can never under-deliver an
 * advertised price. That is the trade the owner approved.
 *
 * ── THE ALGORITHM ───────────────────────────────────────────────────────────
 * Largest-remainder (Hamilton) apportionment over whole cents, the standard
 * method for splitting an indivisible total — the same technique used for
 * apportioning seats and allocating invoice totals.
 *
 *   1. Each line's ideal share of the target is proportional to its share of
 *      the eligible basket. Floor it to a whole number of cents PER UNIT.
 *   2. Step up one cent-per-unit at a time. Prefer the line with the SMALLEST
 *      quantity, because that is the finest increment available and therefore
 *      lands closest to the target; break ties by the largest fractional
 *      remainder, which is what makes this Hamilton rather than ad hoc.
 *   3. Stop at the target, or at the first reachable amount above it.
 *   4. Never take a unit below its floor. When every line is floor-bound the
 *      result is honestly short, and `floorBound` says so, so callers can
 *      surface it rather than silently misprice.
 *
 * This module is PURE: no imports, no I/O, no clock, no config. The floors are
 * passed in, already resolved by the caller that knows the product's cost.
 */

/** One eligible line, with its floor already resolved by the caller. */
export type ApportionLine = {
  lineId: string;
  /** Regular (pre-discount) per-unit price, minor units. */
  regularPriceMinorUnits: number;
  quantity: number;
  /**
   * Lowest LEGAL per-unit price for this line: the greater of the statutory
   * never-free floor and the acquisition-cost floor. The caller resolves it,
   * because only the caller knows the product's cost and category.
   */
  floorMinorUnits: number;
};

export type ApportionResult = {
  /** Per-unit discount in whole minor units, keyed by lineId. */
  perUnitOff: Map<string, number>;
  /** Total savings actually placed across the basket, minor units. */
  placedMinorUnits: number;
  /** The advertised target we were asked to hit, minor units. */
  targetMinorUnits: number;
  /** True when a cost/statutory floor stopped us reaching the target. */
  floorBound: boolean;
  /**
   * placed − target. Zero when exact, POSITIVE when rounded toward the
   * customer. Never negative unless `floorBound` is true.
   */
  varianceMinorUnits: number;
};

/**
 * The advertised saving for "buy N for the price of M": the (N−M) cheapest
 * units in each complete group of N are the ones the customer stops paying
 * for. Expanding to units and sorting ascending is what makes the deal
 * mix-and-match, and taking the CHEAPEST units is the store-favourable reading
 * of an ambiguous promise — a 3-for-2 frees the cheapest of the three, never
 * the most expensive.
 */
export function bundleTargetMinorUnits(
  lines: ApportionLine[],
  n: number,
  m: number,
): number {
  const groupSize = Math.floor(n);
  const paidPerGroup = Math.floor(m);
  const freePerGroup = groupSize - paidPerGroup;
  if (groupSize < 2 || freePerGroup <= 0) return 0;

  const units: number[] = [];
  for (const l of lines) {
    const qty = Math.max(0, Math.floor(l.quantity));
    const price = Math.max(0, Math.floor(l.regularPriceMinorUnits));
    for (let i = 0; i < qty; i += 1) units.push(price);
  }
  const groups = Math.floor(units.length / groupSize);
  if (groups <= 0) return 0;

  units.sort((a, b) => a - b);
  let target = 0;
  for (let i = 0; i < groups * freePerGroup; i += 1) target += units[i];
  return target;
}

/**
 * Apportion `targetMinorUnits` of savings across `lines` in whole cents per
 * unit, hitting the target exactly where possible and otherwise landing on the
 * nearest reachable amount ABOVE it (the customer's favour), while never
 * taking any unit below its floor.
 */
export function apportionBundleSavings(
  lines: ApportionLine[],
  targetMinorUnits: number,
): ApportionResult {
  const perUnitOff = new Map<string, number>();
  const target = Math.max(0, Math.floor(targetMinorUnits));

  // Normalise once. A non-positive quantity or price cannot carry savings.
  const usable = lines
    .map((l) => ({
      lineId: l.lineId,
      price: Math.max(0, Math.floor(l.regularPriceMinorUnits)),
      qty: Math.max(0, Math.floor(l.quantity)),
      // Headroom is per UNIT: how many whole cents this unit may give up.
      cap: Math.max(0, Math.floor(l.regularPriceMinorUnits) - Math.max(0, Math.floor(l.floorMinorUnits))),
    }))
    .filter((l) => l.qty > 0 && l.price > 0);

  for (const l of lines) perUnitOff.set(l.lineId, 0);

  const basketTotal = usable.reduce((s, l) => s + l.price * l.qty, 0);
  if (basketTotal <= 0 || target <= 0 || usable.length === 0) {
    return {
      perUnitOff,
      placedMinorUnits: 0,
      targetMinorUnits: target,
      floorBound: false,
      varianceMinorUnits: 0 - target,
    };
  }

  // The most this basket could ever give up without breaching a floor.
  const capacity = usable.reduce((s, l) => s + l.cap * l.qty, 0);

  // Step 1 — proportional ideal, floored to whole cents PER UNIT and capped.
  const ideal = usable.map((l) => (((l.price * l.qty) / basketTotal) * target) / l.qty);
  const off = usable.map((l, i) => Math.min(Math.floor(ideal[i]), l.cap));
  let placed = usable.reduce((s, l, i) => s + off[i] * l.qty, 0);

  // Step 2 — climb toward the target one cent-per-unit at a time. The smallest
  // quantity is the finest step, so it overshoots least; largest fractional
  // remainder breaks ties (Hamilton). Bounded by total capacity, so it always
  // terminates even if a caller passes an absurd target.
  const maxSteps = capacity + usable.length + 1;
  let steps = 0;
  while (placed < target && steps < maxSteps) {
    steps += 1;
    let best = -1;
    let bestStep = Number.POSITIVE_INFINITY;
    let bestFrac = -1;
    for (let i = 0; i < usable.length; i += 1) {
      if (off[i] >= usable[i].cap) continue; // floor reached on this line
      const step = usable[i].qty;
      const frac = ideal[i] - Math.floor(ideal[i]);
      if (step < bestStep || (step === bestStep && frac > bestFrac)) {
        bestStep = step;
        bestFrac = frac;
        best = i;
      }
    }
    if (best < 0) break; // every line is floor-bound
    off[best] += 1;
    placed += usable[best].qty;
  }

  for (let i = 0; i < usable.length; i += 1) perUnitOff.set(usable[i].lineId, off[i]);

  return {
    perUnitOff,
    placedMinorUnits: placed,
    targetMinorUnits: target,
    floorBound: placed < target,
    varianceMinorUnits: placed - target,
  };
}

// ---------------------------------------------------------------------------
// Self-tests. Run by tests/compliance/bundle-apportionment.test.ts.
// ---------------------------------------------------------------------------

function ok(condition: boolean, message: string): void {
  if (!condition) throw new Error(`bundle-apportionment: ${message}`);
}

const mk = (
  lineId: string,
  dollars: number,
  quantity: number,
  floorDollars = 0.01,
): ApportionLine => ({
  lineId,
  regularPriceMinorUnits: Math.round(dollars * 100),
  quantity,
  floorMinorUnits: Math.round(floorDollars * 100),
});

export function __runBundleApportionmentTests(): { passed: number } {
  let passed = 0;
  const pass = () => {
    passed += 1;
  };

  // ── The owner's own Sunday example ────────────────────────────────────────
  {
    const lines = [mk("a", 60, 1), mk("b", 40, 1), mk("c", 20, 1)];
    const target = bundleTargetMinorUnits(lines, 3, 2);
    ok(target === 2000, `owner Sunday target should be $20.00, got ${target}`);
    const r = apportionBundleSavings(lines, target);
    ok(r.placedMinorUnits === 2000, `owner Sunday must save exactly $20.00, got ${r.placedMinorUnits}`);
    ok(r.varianceMinorUnits === 0, "owner Sunday must be exact");
    ok(!r.floorBound, "owner Sunday is not floor-bound");
    // The old engine produced 1920. Pin the regression explicitly.
    ok(r.placedMinorUnits !== 1920, "the floored-percent shortfall must not return");
    pass();
  }

  // ── Never short when there is headroom ────────────────────────────────────
  {
    const lines = [mk("a", 10, 3)];
    const target = bundleTargetMinorUnits(lines, 3, 2);
    ok(target === 1000, "3 x $10 3-for-2 target is $10.00");
    const r = apportionBundleSavings(lines, target);
    // 1000/3 is not a whole cent: reachable amounts are 999 and 1002.
    ok(r.placedMinorUnits >= target, "must never land short of the advertised saving");
    ok(r.placedMinorUnits === 1002, `expected the nearest reachable amount above, got ${r.placedMinorUnits}`);
    ok(r.varianceMinorUnits === 2, "variance is the 2c given to the customer");
    pass();
  }

  // ── Tuesday 4-for-3 is exactly 25% on identical units ─────────────────────
  {
    const lines = [mk("a", 10, 4)];
    const target = bundleTargetMinorUnits(lines, 4, 3);
    ok(target === 1000, "4 x $10 4-for-3 frees one $10 unit");
    const r = apportionBundleSavings(lines, target);
    ok(r.placedMinorUnits === 1000, "4-for-3 on identical units is exact");
    ok(r.perUnitOff.get("a") === 250, "each unit is 25% off");
    pass();
  }

  // ── The cost floor is absolute ────────────────────────────────────────────
  {
    const lines = [mk("a", 20, 3, 19.5)];
    const target = bundleTargetMinorUnits(lines, 3, 2);
    const r = apportionBundleSavings(lines, target);
    ok(r.floorBound, "a binding cost floor must be reported");
    ok(r.perUnitOff.get("a") === 50, "each unit gives up only its 50c of headroom");
    ok(r.placedMinorUnits === 150, "floor-bound saving is what is legally reachable");
    ok(r.varianceMinorUnits < 0, "a floor-bound basket is honestly short");
    pass();
  }

  // ── No unit is ever taken below its floor, across many shapes ─────────────
  {
    for (let q = 1; q <= 9; q += 1) {
      for (const price of [199, 1000, 3333, 7714]) {
        for (const floor of [1, Math.floor(price * 0.9)]) {
          const lines = [
            { lineId: "x", regularPriceMinorUnits: price, quantity: q, floorMinorUnits: floor },
          ];
          const t = bundleTargetMinorUnits(lines, 3, 2);
          const r = apportionBundleSavings(lines, t);
          const off = r.perUnitOff.get("x") ?? 0;
          ok(price - off >= floor, `floor breached at q=${q} price=${price} floor=${floor}`);
          ok(off >= 0, "a discount is never negative");
        }
      }
    }
    pass();
  }

  // ── Never overshoot by more than the coarsest available step ──────────────
  {
    // The step size is the line quantity; overshoot cannot exceed the smallest
    // quantity among lines that still had headroom, minus one.
    const lines = [mk("a", 77.14, 5)];
    const t = bundleTargetMinorUnits(lines, 3, 2);
    const r = apportionBundleSavings(lines, t);
    ok(r.varianceMinorUnits >= 0, "must not be short");
    ok(r.varianceMinorUnits < 5, `overshoot must be under the 5-unit step, got ${r.varianceMinorUnits}`);
    pass();
  }

  // ── Degenerate inputs are handled, not crashed on ─────────────────────────
  {
    ok(bundleTargetMinorUnits([], 3, 2) === 0, "empty basket has no target");
    ok(bundleTargetMinorUnits([mk("a", 10, 2)], 3, 2) === 0, "2 units cannot form a group of 3");
    ok(bundleTargetMinorUnits([mk("a", 10, 3)], 1, 1) === 0, "n<2 is not a bundle");
    ok(bundleTargetMinorUnits([mk("a", 10, 3)], 3, 3) === 0, "nothing is free when m===n");
    const empty = apportionBundleSavings([], 500);
    ok(empty.placedMinorUnits === 0, "no lines means nothing placed");
    const zeroTarget = apportionBundleSavings([mk("a", 10, 3)], 0);
    ok(zeroTarget.placedMinorUnits === 0, "a zero target places nothing");
    ok(!zeroTarget.floorBound, "a zero target is not floor-bound");
    const negative = apportionBundleSavings([mk("a", 10, 3)], -100);
    ok(negative.placedMinorUnits === 0, "a negative target places nothing");
    pass();
  }

  // ── Monotonicity, stated as the invariant that actually protects people ───
  {
    // NOTE: an earlier draft asserted that `placed` itself never decreases.
    // That assertion FAILED, and it was the assertion that was wrong, not the
    // algorithm: at 3 units the target is unreachable and we round UP to
    // $10.02, while at 4 units the same $10.00 target is reachable exactly.
    // `placed` therefore dips 2c — because the customer was OVER-paid at the
    // previous quantity, not under-paid at this one.
    //
    // The invariants that matter, and that would have caught the real defect
    // (a 6-preroll cart dropping from 20% to 16%):
    //   1. the ADVERTISED target never decreases as the basket grows, and
    //   2. the customer is never served SHORT of the advertised target.
    let previousTarget = -1;
    for (let q = 3; q <= 120; q += 1) {
      const lines = [mk("a", 10, q)];
      const t = bundleTargetMinorUnits(lines, 3, 2);
      const r = apportionBundleSavings(lines, t);
      ok(t >= previousTarget, `advertised target fell from ${previousTarget} to ${t} at quantity ${q}`);
      ok(
        r.placedMinorUnits >= t,
        `served short at quantity ${q}: placed ${r.placedMinorUnits} < target ${t}`,
      );
      previousTarget = t;
    }
    pass();
  }

  // ── The overshoot is the MINIMUM reachable, never lazy ────────────────────
  {
    // A single line of quantity q can only give savings in multiples of q, so
    // some targets are simply unreachable. When that happens we must land on
    // the SMALLEST reachable amount at or above the target — proven here by
    // brute force against every multiple of q.
    for (let q = 2; q <= 40; q += 1) {
      for (const price of [1000, 777, 1299, 4999]) {
        const lines = [
          { lineId: "x", regularPriceMinorUnits: price, quantity: q, floorMinorUnits: 1 },
        ];
        const t = bundleTargetMinorUnits(lines, 3, 2);
        if (t <= 0) continue;
        const r = apportionBundleSavings(lines, t);
        const smallestReachable = Math.ceil(t / q) * q;
        const capped = Math.min(smallestReachable, (price - 1) * q);
        ok(
          r.placedMinorUnits === capped,
          `q=${q} price=${price}: expected the minimum reachable ${capped}, got ${r.placedMinorUnits}`,
        );
      }
    }
    pass();
  }

  // ── Multi-line baskets reach the target exactly far more often ────────────
  {
    // Where a single quantity-3 line cannot hit $10.00, three separate lines
    // can, because each carries its own whole-cent unit price.
    const lines = [mk("a", 10, 1), mk("b", 10, 1), mk("c", 10, 1)];
    const t = bundleTargetMinorUnits(lines, 3, 2);
    const r = apportionBundleSavings(lines, t);
    ok(r.placedMinorUnits === 1000, `three separate $10 lines must be exact, got ${r.placedMinorUnits}`);
    ok(r.varianceMinorUnits === 0, "three separate lines hit the target exactly");
    pass();
  }

  return { passed };
}
