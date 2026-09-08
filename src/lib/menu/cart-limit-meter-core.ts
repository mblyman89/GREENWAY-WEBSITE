/**
 * src/lib/menu/cart-limit-meter-core.ts
 *
 * Customer shop-cart limit meter (PURE core). Makes the e-commerce cart mirror
 * the FRONT-END POS register's WAC 314-55-095 sales-limit meter (SaleFlow.tsx),
 * so an online pre-order shows the shopper the SAME legal-limit picture the
 * budtender sees at the register.
 *
 * WHY A THIN PURE CORE (not a re-implementation): every statutory value, the
 * category→bucket mapping, and the per-unit gram parse ALREADY live in shared,
 * self-tested pure modules. This file only ADAPTS the customer cart's shape to
 * those modules and derives a single at-a-glance status. It invents no limit,
 * no bucket, and no gram equivalence.
 *
 * The building blocks it reuses (identical to how the POS register builds its
 * meter in src/lib/pos/sale-flow-core.ts `limitLinesFor`):
 *   - gramsFromVariantLabel + lineGramsFromUnit  (src/lib/pos/variant-grams-core.ts)
 *   - evaluateCart + categoryToBucket + LimitBucket/LimitEvaluation types
 *                                                (src/lib/compliance/sales-limits-core.ts)
 *
 * PROFILE (deliberate, documented): the storefront meter evaluates against the
 * STATUTORY RECREATIONAL maximums with NO owner overrides. The online cart is a
 * pre-order ESTIMATE ("final purchase limits are confirmed in store"), online
 * guests are recreational by default (matches src/app/api/orders/route.ts), and
 * owner overrides can only ever TIGHTEN the statute (clampLimitProfile) — so the
 * widest ceiling a shopper could ever face is exactly this statutory maximum.
 * The AUTHORITATIVE gate remains server-side (the /api/orders placement flag and
 * the POS completion hard gate); this meter is informational, mirroring the POS
 * meter's DISPLAY, never a block.
 *
 * Pure: no I/O, no React. Self-tested below (registered in
 * scripts/compliance/run-pure-selftests.ts) and mirrored in vitest.
 */
import {
  evaluateCart,
  type LimitBucket,
  type LimitCartLine,
  type LimitEvaluation,
} from "@/lib/compliance/sales-limits-core";
import { gramsFromVariantLabel, lineGramsFromUnit } from "@/lib/pos/variant-grams-core";
import { lineVolumeMl, volumeMlFromLabel } from "@/lib/compliance/liquid-volume-core";

/** The cart fields the limit engine needs (a subset of CartItem). */
export type CartLimitLineInput = {
  category: string | null;
  quantity: number;
  variantLabel: string | null;
  /**
   * SLICE L4 — millilitres ONE unit contains, plumbed from intake's measured
   * net_volume_ml. Optional: absent/null makes the meter parse the variant
   * label instead, and if that yields nothing the engine uses the
   * weight-carried basis. No density is ever assumed.
   */
  unitVolumeMl?: number | null;
  /**
   * SLICE 16 — the low-THC beverage classification
   * (WAC 314-55-095(1)(d)(i)(E)+(F)). true = packaged in individual units of
   * ≤ 4 mg active delta-9 THC, so the line counts against the 200 mg THC
   * bucket instead of the 72 oz liquid bucket.
   *
   * Optional: absent/null = not classified = counted as a NORMAL liquid. That
   * is the fail-safe direction and matches the owner's instruction that "a
   * product with no flag should be treated as a normal liquid."
   */
  lowThcLiquid?: boolean | null;
  /** SLICE 16 — mg of active delta-9 THC in ONE sellable unit (one can). */
  unitThcMg?: number | null;
  /**
   * SLICE 17 — "otherwise taken into the body" (suppositories), routing this
   * line to the ten-unit bucket. Absent/null = not classified.
   *
   * Note the fail-safe INVERTS here versus lowThcLiquid above: an unclassified
   * suppository counts as a normal liquid and is effectively unlimited, so a
   * missing flag under-restricts rather than over-restricts.
   */
  otherwiseTaken?: boolean | null;
  /** SLICE 17 — individual items per package; a box of six is 6. */
  unitsPerPackage?: number | null;
};

/** At-a-glance meter state — mirrors the POS register badge (OK / NEAR / OVER). */
export type CartLimitStatus = "ok" | "near" | "over";

/**
 * The "near the line" threshold: any tracked bucket at >80% of its maximum
 * turns the meter amber, EXACTLY as the POS meter's progress bar does
 * (SaleFlow.tsx: `b.ratio > 0.8 ? warn : accent`).
 */
export const NEAR_LIMIT_RATIO = 0.8;

/**
 * Build the engine cart lines from customer cart items. Mirrors the POS
 * register's `limitLinesFor`: the variant LABEL yields the true per-unit grams
 * (a 7 g jar counts as 7 g), and when the label isn't a plain weight the engine
 * falls back to the conservative per-category default. NEVER throws.
 */
export function cartLimitLines(items: readonly CartLimitLineInput[]): LimitCartLine[] {
  return items.map((item) => {
    const perUnit = gramsFromVariantLabel(item.variantLabel);
    const grams = lineGramsFromUnit(perUnit, item.quantity);
    // SLICE L4 — the volume basis, mirroring the register's limitLinesFor()
    // so the website meter and the register can never disagree about the same
    // cart. Prefers the plumbed per-package volume (L3); falls back to parsing
    // the variant label, which is the only source the website has for a
    // product whose card predates the L3 intake plumbing.
    const perUnitMl = item.unitVolumeMl ?? volumeMlFromLabel(item.variantLabel);
    const volumeMl = lineVolumeMl(perUnitMl, item.quantity);
    return {
      category: item.category,
      quantity: item.quantity,
      ...(grams !== null ? { grams } : {}),
      ...(volumeMl !== null && volumeMl > 0 ? { volumeMl } : {}),
      // SLICE 16 — mirrors the register's limitLinesFor() exactly, so the
      // website meter and the register meter can never disagree about the same
      // cart. The engine demands `lowThcLiquid === true` AND a valid per-unit
      // mg at or under 4, so anything missing falls back to the 72 oz bucket.
      lowThcLiquid: item.lowThcLiquid ?? null,
      unitThcMg: item.unitThcMg ?? null,
      // SLICE 17 — mirrors the register's limitLinesFor() exactly, so the
      // website meter and the register can never disagree about the same cart.
      // This is what makes the ten-unit limit BLOCK ON THE WEBSITE, per the
      // owner's instruction, rather than only at the register.
      otherwiseTaken: item.otherwiseTaken ?? null,
      unitsPerPackage: item.unitsPerPackage ?? null,
    };
  });
}

/**
 * Evaluate the customer cart against the STATUTORY RECREATIONAL limits (see the
 * file header for why no overrides). Returns the full LimitEvaluation so the UI
 * can render per-bucket meters exactly like the POS.
 */
export function evaluateCartMeter(items: readonly CartLimitLineInput[]): LimitEvaluation {
  return evaluateCart(cartLimitLines(items), "recreational");
}

/**
 * Reduce a LimitEvaluation to the single OK / NEAR / OVER status the badge
 * shows. OVER when any bucket is exceeded; NEAR when any tracked bucket sits at
 * >80% of its max; otherwise OK. An empty (or all-untracked) cart is OK.
 */
export function meterStatus(evaluation: LimitEvaluation): CartLimitStatus {
  if (evaluation.blocked) return "over";
  const near = evaluation.buckets.some((b) => b.usedGrams > 0 && b.ratio > NEAR_LIMIT_RATIO);
  return near ? "near" : "ok";
}

/** The buckets that actually carry weight (the only ones worth showing). */
export function activeBuckets(evaluation: LimitEvaluation): LimitEvaluation["buckets"] {
  return evaluation.buckets.filter((b) => b.usedGrams > 0);
}

/** True when the cart has at least one bucket carrying cannabis weight. */
export function hasTrackedWeight(evaluation: LimitEvaluation): boolean {
  return evaluation.buckets.some((b) => b.usedGrams > 0);
}

/**
 * The over-limit verdict for the customer checkout SOFT-BLOCK. Washington's
 * WAC 314-55-095 / RCW 69.50.360 single-transaction maximums are ALSO the
 * customer's RCW 69.50.4013 possession maximums (the LCB states you may "buy
 * AND possess" the same amounts) — so an over-limit basket can never become a
 * legal order OR a legal amount to carry out the door. There is no compliant
 * "split at pickup." The customer checkout button is therefore locked when
 * `over` is true; the reasons name the exact bucket(s) so the shopper knows
 * what to remove.
 *
 * This is the storefront's advisory block (defense in depth): the server order
 * gate and the POS completion gate remain the ultimate authority, so a shopper
 * cannot bypass it by editing the page. Empty/all-untracked carts are never
 * over. NEVER throws.
 */
export function cartLimitBlock(items: readonly CartLimitLineInput[]): {
  over: boolean;
  reasons: string[];
} {
  const evaluation = evaluateCartMeter(items);
  return { over: evaluation.blocked, reasons: evaluation.reasons };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runCartLimitMeterCoreTests(): void {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      failures.push(name);
    }
  };

  // cartLimitLines: the variant label drives the TRUE per-unit grams (mirrors
  // the POS limitLinesFor). A 7 g flower jar counts as 7 g, not the 3.5 g
  // category default.
  const jarLines = cartLimitLines([{ category: "flower", quantity: 2, variantLabel: "7g" }]);
  ok(jarLines.length === 1, "one line built");
  ok(jarLines[0].grams === 14, "2 x 7g jar = 14g whole-line grams from label");
  ok(jarLines[0].category === "flower", "category passed through");

  // Non-weight label (each / mg / ml / pack) → no explicit grams → engine uses
  // the conservative category default.
  const eachLines = cartLimitLines([{ category: "concentrate", quantity: 3, variantLabel: "each" }]);
  ok(eachLines[0].grams === undefined, "non-weight label → no explicit grams (falls back to default)");
  const mgLines = cartLimitLines([{ category: "edible-solid", quantity: 1, variantLabel: "100mg" }]);
  ok(mgLines[0].grams === undefined, "mg dose label → no explicit grams");
  const ozLines = cartLimitLines([{ category: "flower", quantity: 1, variantLabel: "1oz" }]);
  ok(ozLines[0].grams === 28, "1oz label → 28g (statute equivalence)");

  // Null / blank labels are tolerated (fall back to defaults), never throw.
  ok(
    cartLimitLines([{ category: "flower", quantity: 1, variantLabel: null }])[0].grams === undefined,
    "null label → no explicit grams",
  );
  ok(
    cartLimitLines([{ category: "flower", quantity: 1, variantLabel: "" }])[0].grams === undefined,
    "blank label → no explicit grams",
  );

  // evaluateCartMeter: recreational statutory maxima, mirroring the register.
  // 8 x 3.5g flower (via label) = 28g usable = exactly at the 28g limit → OK.
  const atFlower = evaluateCartMeter([{ category: "flower", quantity: 8, variantLabel: "3.5g" }]);
  ok(atFlower.blocked === false, "28g flower exactly at rec limit → not blocked");
  ok(atFlower.customerType === "recreational", "customerType is recreational");
  const usable = atFlower.buckets.find((b) => b.bucket === "usable")!;
  ok(usable.usedGrams === 28, "usable used 28g");

  // 9 x 3.5g flower = 31.5g > 28g → OVER.
  const overFlower = evaluateCartMeter([{ category: "flower", quantity: 9, variantLabel: "3.5g" }]);
  ok(overFlower.blocked === true, "31.5g flower over rec limit → blocked");

  // MIX-INFUSED RULE mirrors the register: 8 x 1g infused prerolls = 8g trips
  // the 7g CONCENTRATE wall, adds NOTHING to the flower bucket.
  const infused = evaluateCartMeter([{ category: "infused-preroll", quantity: 8, variantLabel: "1g" }]);
  ok(infused.blocked === true, "8x1g infused prerolls over 7g concentrate → blocked");
  const conc = infused.buckets.find((b) => b.bucket === "concentrate")!;
  ok(conc.exceeded === true, "infused prerolls trip the concentrate bucket");
  const flowerBucket = infused.buckets.find((b) => b.bucket === "usable")!;
  ok(flowerBucket.usedGrams === 0, "infused prerolls add nothing to the flower bucket");

  // Non-cannabis lines are untracked (accessories/merch).
  const merch = evaluateCartMeter([{ category: "merch", quantity: 4, variantLabel: "each" }]);
  ok(merch.blocked === false, "merch never blocks");
  ok(merch.untrackedLines === 1, "merch line counted as untracked");
  ok(hasTrackedWeight(merch) === false, "merch cart carries no tracked weight");

  // meterStatus: OK / NEAR / OVER.
  ok(meterStatus(evaluateCartMeter([])) === "ok", "empty cart → ok");
  ok(meterStatus(merch) === "ok", "merch-only cart → ok");
  ok(meterStatus(atFlower) === "over" ? false : true, "at-limit flower is not OVER");
  // 6 x 1g concentrate = 6g / 7g = 0.857 > 0.8 → NEAR (not over).
  const nearConc = evaluateCartMeter([{ category: "concentrate", quantity: 6, variantLabel: "1g" }]);
  ok(meterStatus(nearConc) === "near", "6g of 7g concentrate → near (>80%)");
  ok(nearConc.blocked === false, "6g concentrate not blocked");
  // 4 x 1g concentrate = 4g / 7g = 0.571 < 0.8 → OK.
  const okConc = evaluateCartMeter([{ category: "concentrate", quantity: 4, variantLabel: "1g" }]);
  ok(meterStatus(okConc) === "ok", "4g of 7g concentrate → ok (<80%)");
  ok(meterStatus(overFlower) === "over", "31.5g flower → over");

  // activeBuckets: only buckets carrying weight are surfaced.
  const mixed = evaluateCartMeter([
    { category: "flower", quantity: 2, variantLabel: "3.5g" },
    { category: "concentrate", quantity: 1, variantLabel: "1g" },
    { category: "merch", quantity: 1, variantLabel: "each" },
  ]);
  const active = activeBuckets(mixed);
  ok(active.length === 2, "two active buckets (usable + concentrate)");
  ok(
    active.every((b) => b.usedGrams > 0),
    "every active bucket carries weight",
  );
  ok(
    active.some((b) => b.bucket === ("usable" as LimitBucket)) &&
      active.some((b) => b.bucket === ("concentrate" as LimitBucket)),
    "active buckets are usable + concentrate",
  );
  ok(hasTrackedWeight(mixed) === true, "mixed cart carries tracked weight");

  // cartLimitBlock: the customer checkout soft-block verdict.
  ok(cartLimitBlock([]).over === false, "empty cart is not over");
  ok(
    cartLimitBlock([{ category: "merch", quantity: 9, variantLabel: "each" }]).over === false,
    "merch-only cart is not over",
  );
  ok(
    cartLimitBlock([{ category: "flower", quantity: 8, variantLabel: "3.5g" }]).over === false,
    "exactly at the 28g flower limit is not over",
  );
  const blockOver = cartLimitBlock([{ category: "flower", quantity: 9, variantLabel: "3.5g" }]);
  ok(blockOver.over === true, "31.5g flower cart is over");
  ok(blockOver.reasons.length === 1, "over cart names one bucket reason");
  ok(
    blockOver.reasons[0].toLowerCase().includes("useable") ||
      blockOver.reasons[0].toLowerCase().includes("oz"),
    "reason describes the exceeded bucket",
  );
  // Infused prerolls tripping the 7g concentrate wall also block checkout.
  ok(
    cartLimitBlock([{ category: "infused-preroll", quantity: 8, variantLabel: "1g" }]).over === true,
    "8x1g infused prerolls (8g > 7g concentrate) blocks checkout",
  );

  if (failed > 0) {
    throw new Error(`cart-limit-meter-core self-tests FAILED (${failed}): ${failures.join("; ")}`);
  }
  console.log(`cart-limit-meter-core self-tests: ${passed} passed`);
}
