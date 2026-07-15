/**
 * src/lib/pos/register-loyalty-core.ts  (Task AM-B)
 *
 * PURE helpers for redeeming loyalty points AT THE REGISTER (no I/O, no
 * server-only imports; self-tested via __runRegisterLoyaltyCoreTests, wired
 * into the compliance harness).
 *
 * How register redemption works (mirrors the back office Task S-a path):
 *
 *   1. The budtender taps "Redeem" with a member attached (or types a code
 *      the customer brought). The device is ONLINE for this step — the new
 *      /api/pos/loyalty route verifies the balance, computes the value
 *      spread across the CURRENT cart with the SAME pure spreadCodeValue +
 *      legal floors the back office uses (acquisition costs live server-side
 *      only), and issues the code. The code stays status='issued'.
 *   2. The device applies the returned per-variant reductions to its priced
 *      lines (applyLoyaltyToPricedLines below) and recomputes totals with
 *      the SAME computeOrderTotals the server gate recomputes with.
 *   3. The sale payload carries the per-line reductions + a loyaltyRedemption
 *      block; at sync the server ATOMICALLY claims the code against the
 *      materialized order (markRedemptionUsed) and writes the migration-0116
 *      loyalty columns — the existing completion gate then re-verifies both
 *      the money and the code (checkLoyaltyCodeForCompletion) untouched.
 *
 * SAFETY: the spread is only valid for the EXACT cart it was computed on.
 * pricingFingerprint() captures the priced cart; when it drifts (item added,
 * quantity changed, price override applied) the register must DROP the
 * discount and release the code — never ship a stale spread.
 *
 * All money in MINOR UNITS (cents).
 */
import { computeOrderTotals, type OrderTotals } from "@/lib/orders/order-pricing-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-variant per-unit reduction the server's spread returned. */
export type LoyaltySpreadEntry = {
  variantId: string;
  perUnitOffMinor: number;
};

/** The register's record of an applied (not-yet-synced) redemption. */
export type AppliedLoyalty = {
  /** loyalty_redemptions.id — rides the payload for the sync-time claim. */
  redemptionId: string;
  /** The human code (GW-XXXX-XXXX). */
  code: string;
  /** Full stored value of the code (points × pointValueMinor). */
  valueMinor: number;
  /** Value actually applied to this cart (≤ valueMinor; penny remainders stay unused). */
  appliedMinor: number;
  /** Where the code came from: fresh points redemption or a customer-brought code. */
  source: "points" | "code";
  /** Points deducted at issuance (0 for a customer-brought code). */
  pointsSpent: number;
  /** pricingFingerprint() of the cart the spread was computed for. */
  fingerprint: string;
  /** variantId → per-UNIT reduction (whole cents). */
  perVariant: Record<string, number>;
};

/** A priced cart line as the device sends it to /api/pos/loyalty. */
export type PosLoyaltyLineInput = {
  variantId?: string;
  productId: string;
  category: string;
  quantity: number;
  unitPriceMinor: number;
  regularPriceMinor: number;
};

/** What the register asks /api/pos/loyalty for. */
export type PosLoyaltyRequest =
  | { action: "redeem-points"; customerId: string; lines: PosLoyaltyLineInput[] }
  | { action: "apply-code"; code: string; lines: PosLoyaltyLineInput[] }
  | { action: "release"; redemptionId: string };

/** What /api/pos/loyalty grants on success (redeem-points / apply-code). */
export type PosLoyaltyGrant = {
  redemptionId: string;
  code: string;
  valueMinor: number;
  appliedMinor: number;
  pointsSpent: number;
  source: "points" | "code";
  perVariant: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Fingerprint — detects any cart/pricing drift after the spread was computed
// ---------------------------------------------------------------------------

export type FingerprintLine = {
  variantId?: string;
  productId: string;
  quantity: number;
  unitPriceMinor: number;
};

/**
 * Stable fingerprint of a priced cart: line identity + quantity + the
 * pre-loyalty unit price, sorted so line order never matters. Any add,
 * remove, quantity change, reprice, or manager override changes the
 * fingerprint — and a changed fingerprint means the spread is stale.
 */
export function pricingFingerprint(lines: FingerprintLine[]): string {
  return lines
    .map((l) => `${l.variantId ?? l.productId}:${l.quantity}:${l.unitPriceMinor}`)
    .sort()
    .join("|");
}

// ---------------------------------------------------------------------------
// Apply the server's spread to the device's priced lines
// ---------------------------------------------------------------------------

export type LoyaltyPricedLine = {
  variantId?: string;
  productId: string;
  category: string;
  quantity: number;
  unitPriceMinor: number;
  regularPriceMinor: number;
};

export type LoyaltyApplication<T extends LoyaltyPricedLine> = {
  /** Lines with reduced unit prices + per-unit loyaltyDiscountMinor stamped on. */
  lines: (T & { loyaltyDiscountMinor?: number })[];
  /** Totals recomputed from the reduced lines — the SAME computeOrderTotals the sync gate uses. */
  totals: OrderTotals;
  /** Σ perUnitOff × quantity actually taken (defensive clamps included). */
  appliedMinor: number;
};

/**
 * Subtract the server-computed per-variant reductions from the priced lines.
 * Defensive: a reduction can never push a unit price below 1 cent (the
 * server's spread already respects the statutory + cost floors; this clamp
 * only guards against a corrupted response) and unmatched variants are left
 * untouched.
 */
export function applyLoyaltyToPricedLines<T extends LoyaltyPricedLine>(
  lines: T[],
  perVariant: Record<string, number>,
): LoyaltyApplication<T> {
  let applied = 0;
  const out = lines.map((l) => {
    const key = l.variantId ?? l.productId;
    const rawOff = perVariant[key];
    if (!rawOff || !Number.isInteger(rawOff) || rawOff <= 0) return l;
    const off = Math.min(rawOff, Math.max(0, l.unitPriceMinor - 1));
    if (off <= 0) return l;
    applied += off * l.quantity;
    return { ...l, unitPriceMinor: l.unitPriceMinor - off, loyaltyDiscountMinor: off };
  });
  const totals = computeOrderTotals(
    out.map((l) => ({
      category: l.category,
      quantity: l.quantity,
      unitPriceMinorUnits: l.unitPriceMinor,
      regularPriceMinorUnits: l.regularPriceMinor,
    })),
  );
  return { lines: out, totals, appliedMinor: applied };
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/**
 * The most points this member could redeem right now under the program
 * config (0 when below the minimum — the button should not render).
 */
export function maxRedeemablePoints(balancePoints: number, minRedeemPoints: number): number {
  const balance = Math.max(0, Math.floor(balancePoints));
  const min = Math.max(0, Math.floor(minRedeemPoints));
  return balance >= min && balance > 0 ? balance : 0;
}

/** Normalize a typed redemption code: trim + uppercase. */
export function normalizeLoyaltyCodeInput(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Loose shape check for GW-XXXX-XXXX codes (unambiguous alphabet — no
 * O/0/I/1). UI hinting ONLY; the server lookup is authoritative.
 */
export function looksLikeLoyaltyCode(code: string): boolean {
  return /^GW-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code);
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runRegisterLoyaltyCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  const mk = (
    variantId: string,
    unit: number,
    qty = 1,
    category = "flower",
  ): LoyaltyPricedLine => ({
    variantId,
    productId: `prod-${variantId}`,
    category,
    quantity: qty,
    unitPriceMinor: unit,
    regularPriceMinor: unit,
  });

  // ── pricingFingerprint ───────────────────────────────────────────────────
  const fpA = pricingFingerprint([mk("v1", 1000), mk("v2", 2000, 2)]);
  const fpB = pricingFingerprint([mk("v2", 2000, 2), mk("v1", 1000)]);
  ok(fpA === fpB, "fingerprint is order-independent");
  ok(
    pricingFingerprint([mk("v1", 1000), mk("v2", 2000, 3)]) !== fpA,
    "quantity change alters the fingerprint",
  );
  ok(
    pricingFingerprint([mk("v1", 999), mk("v2", 2000, 2)]) !== fpA,
    "price change alters the fingerprint",
  );
  ok(
    pricingFingerprint([{ productId: "p1", quantity: 1, unitPriceMinor: 500 }]) === "p1:1:500",
    "productId is the fallback identity when variantId is absent",
  );

  // ── applyLoyaltyToPricedLines ────────────────────────────────────────────
  const applied = applyLoyaltyToPricedLines([mk("v1", 1000, 2), mk("v2", 2000)], {
    v1: 100,
    v2: 300,
  });
  ok(applied.lines[0].unitPriceMinor === 900, "v1 reduced 1000→900");
  ok(applied.lines[0].loyaltyDiscountMinor === 100, "v1 carries its per-unit reduction");
  ok(applied.lines[1].unitPriceMinor === 1700, "v2 reduced 2000→1700");
  ok(applied.appliedMinor === 100 * 2 + 300, "appliedMinor sums per-unit × quantity");
  ok(
    applied.totals.totalMinorUnits ===
      computeOrderTotals([
        { category: "flower", quantity: 2, unitPriceMinorUnits: 900, regularPriceMinorUnits: 1000 },
        { category: "flower", quantity: 1, unitPriceMinorUnits: 1700, regularPriceMinorUnits: 2000 },
      ]).totalMinorUnits,
    "totals recomputed with the shared computeOrderTotals",
  );

  const untouched = applyLoyaltyToPricedLines([mk("v1", 1000)], { v9: 100 });
  ok(
    untouched.lines[0].unitPriceMinor === 1000 && untouched.appliedMinor === 0,
    "unmatched variants are untouched",
  );
  ok(
    !("loyaltyDiscountMinor" in untouched.lines[0]) ||
      untouched.lines[0].loyaltyDiscountMinor === undefined,
    "untouched lines never carry a loyaltyDiscountMinor",
  );

  const clamped = applyLoyaltyToPricedLines([mk("v1", 100)], { v1: 500 });
  ok(
    clamped.lines[0].unitPriceMinor === 1 && clamped.lines[0].loyaltyDiscountMinor === 99,
    "reduction clamps at the 1-cent statutory floor (defense in depth)",
  );

  const zeroOff = applyLoyaltyToPricedLines([mk("v1", 1000)], { v1: 0 });
  ok(zeroOff.appliedMinor === 0, "zero/absent reductions apply nothing");

  // ── maxRedeemablePoints ──────────────────────────────────────────────────
  ok(maxRedeemablePoints(250, 100) === 250, "balance above the minimum redeems in full");
  ok(maxRedeemablePoints(99, 100) === 0, "below the minimum cannot redeem");
  ok(maxRedeemablePoints(0, 0) === 0, "zero balance never redeems");

  // ── code normalization + shape ───────────────────────────────────────────
  ok(normalizeLoyaltyCodeInput("  gw-7k3m-92qf ") === "GW-7K3M-92QF", "code input normalizes");
  ok(looksLikeLoyaltyCode("GW-7K3M-92QF"), "well-formed code passes the shape check");
  ok(!looksLikeLoyaltyCode("GW-7K3M-92QO"), "ambiguous letter O fails the shape check");
  ok(!looksLikeLoyaltyCode("FOO-1234"), "junk fails the shape check");

  if (fail > 0) throw new Error(`register-loyalty-core self-tests: ${fail} FAILED (${pass} passed)`);
  console.log(`register-loyalty-core self-tests: ALL PASS (${pass} assertions)`);
}
