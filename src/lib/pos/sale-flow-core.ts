/**
 * src/lib/pos/sale-flow-core.ts  (POS Slice B6)
 *
 * PURE cart + pricing logic for the register's guided sale flow. No React,
 * no DB, no server-only — the SAME modules the server trusts do the math on
 * the device, so an offline sale prices IDENTICALLY to a website order:
 *
 *   - Discounts: the shared pure promotions engine (`computePromotions`) over
 *     the back office's PUBLISHED rules — the employee never does discount
 *     math (mirrors order-pricing.ts line for line, including the statutory
 *     cannabis price floor RCW 69.50.357 and the CCRS acquisition-cost floor).
 *   - Totals: `computeOrderTotals` — the single source of tax truth
 *     (37% excise + 9.3% sales backed out of tax-inclusive prices).
 *   - Limits: `evaluateCart` (WAC 314-55-095) with the owner's saved settings.
 *   - Tender: `computeCashChange` (cash-only launch).
 *   - Payload: `validateSalePayload` runs BEFORE enqueue so a malformed sale
 *     can never enter the offline queue.
 */

import {
  computePromotions,
  lineCostFloor,
  type EngineCartLine,
  type EngineRule,
} from "@/lib/promotions/discount-engine-core";
import {
  assertCannabisLineSellable,
  clampCannabisUnitPrice,
  computeOrderTotals,
  type OrderTotals,
} from "@/lib/orders/order-pricing-core";
import {
  evaluateCart,
  type LimitCartLine,
  type LimitEvaluation,
  type LimitProfile,
} from "@/lib/compliance/sales-limits-core";
import type { SalesHoursWindow } from "@/lib/compliance/sales-hours-core";
// Type-only (erased at compile time) — medical-pos-core imports PricedSaleLine
// from this module, so a VALUE import here would create a runtime cycle.
import type { PosMedicalConfig } from "./medical-pos-core";
import type { PosReceiptConfig } from "./receipt-config-core";
import { roundCashDue, type PosCashRoundingConfig } from "./cash-rounding-core";
// Type-only (erased at compile time) — no runtime cycle with scan-required-core.
import type { PosScanRequiredConfig } from "./scan-required-core";
import {
  computeCashChange,
  validateSalePayload,
  type PosSaleLine,
  type PosSalePayload,
} from "./sale-event-core";

// ---------------------------------------------------------------------------
// The menu bundle the device downloads (GET /api/pos/menu)
// ---------------------------------------------------------------------------

/** One sellable variant, flattened for the register. Prices tax-inclusive minor units. */
export type PosMenuProduct = {
  productId: string;
  variantId: string;
  name: string;
  brand: string | null;
  /** Primary category slug (drives tax divisor + limit bucket). */
  category: string;
  /** Lowercased category tokens for promotion matching (filter categories preferred). */
  categories: string[];
  variantLabel: string | null;
  /** Regular (pre-discount) tax-inclusive unit price. */
  regularPriceMinor: number;
  /** Weighted-average acquisition cost when known (CCRS cost floor). */
  costMinorUnits: number | null;
  inventoryStatus: "in-stock" | "low-stock" | "unavailable";
  /**
   * B32 — variant-level units remaining from the published menu, when known.
   * null = unknown (items sold at the item price without explicit variants);
   * optional so bundles cached before B32 still parse (undefined = unknown).
   * Warnings only — the B19 decrement + completion gate are the authority.
   */
  unitsLeft?: number | null;
  /**
   * B42 — product-info facts for the on-demand detail card. SENSORY/
   * descriptive only (no effects/medical claims — website posture). ALL
   * optional so bundles cached before B42 still parse; missing facts are
   * simply omitted from the card. Descriptions are trimmed server-side
   * (product-info-core.trimDescription) so the cached bundle stays small.
   */
  strainType?: string | null;
  thc?: string | null;
  cbd?: string | null;
  terpenes?: string[];
  description?: string | null;
};

/** Owner's sales-limit settings as shipped to the device. */
export type PosLimitSettings = {
  enforce: boolean;
  hardBlock: boolean;
  rec: LimitProfile;
  med: LimitProfile;
  unitGrams: Record<string, number>;
};

export type PosMenuBundle = {
  products: PosMenuProduct[];
  /** Active PUBLISHED promotion rules (already filtered to "active now" server-side). */
  rules: EngineRule[];
  limits: PosLimitSettings;
  hours: SalesHoursWindow;
  /**
   * Medical-sale config (POS B8): endorsement status, the WAC 314-55-090(6)
   * excise sunset, and the durable DOH 246-70 registry (productId → category)
   * so applyMedicalPricing runs OFFLINE with the gate's exact inputs.
   * Optional so a bundle cached before B8 still parses; the register treats
   * a missing block as "medical path unavailable — refresh the menu".
   */
  medical?: PosMedicalConfig;
  /**
   * Receipt customization (POS B13) — the owner's header/address/footer and
   * display toggles, so OFFLINE sales print the customized receipt. Optional
   * so a bundle cached before B13 still parses; the register falls back to
   * the pure defaults in receipt-config-core.
   */
  receipt?: PosReceiptConfig;
  /**
   * Loyalty program facts the device needs OFFLINE (POS B14): the earn rate
   * for the receipt's points ESTIMATE (authoritative accrual happens
   * server-side at completion via orders.customer_id — never on-device).
   * Optional so pre-B14 cached bundles still parse.
   */
  loyalty?: {
    pointsPerDollar: number;
    /**
     * Task AM-B — cash value of one point + the minimum redeemable balance,
     * so the register can show the "Redeem points" button with an estimate.
     * OPTIONAL so pre-AM-B cached bundles still parse (button hidden). The
     * ONLINE /api/pos/loyalty route re-verifies both before issuing.
     */
    pointValueMinor?: number;
    minRedeemPoints?: number;
  };
  /**
   * Barcode index (POS B23): normalized package barcode (lot code / CCRS
   * external id, lowercased) → the stable POS product key, built server-side
   * from ACTIVE inventory lots so keyboard-wedge scanning works OFFLINE.
   * Optional so pre-B23 cached bundles still parse; without it, scanning
   * falls back to exact product-key matches only.
   */
  barcodes?: Record<string, string>;
  /**
   * Cash-rounding policy (POS B33): the owner's penny-elimination choice
   * (off / nearest / up / down), shipped with the bundle so OFFLINE sales
   * round the amount due exactly like online ones. Optional so pre-B33
   * cached bundles still parse; a missing block means "off" (exact pennies).
   */
  rounding?: PosCashRoundingConfig;
  /**
   * Scan-required register mode (POS B41): when enabled, cannabis items must
   * be SCANNED at the register (manual tile taps blocked; manager PIN lifts
   * it for one sale). Rides the bundle so OFFLINE registers keep enforcing
   * the cached policy. Optional so pre-B41 cached bundles still parse; a
   * missing block means OFF.
   */
  scanRequired?: PosScanRequiredConfig;
  /** ISO timestamp of the download (staleness display on-device). */
  fetchedAt: string;
};

// ---------------------------------------------------------------------------
// Cart operations
// ---------------------------------------------------------------------------

export type PosCartEntry = { product: PosMenuProduct; quantity: number };

export const MAX_LINE_QUANTITY = 99;

/** Add one unit of a product (merging with an existing line for the same variant). */
export function addToCart(cart: PosCartEntry[], product: PosMenuProduct): PosCartEntry[] {
  const existing = cart.find((e) => e.product.variantId === product.variantId);
  if (existing) {
    return cart.map((e) =>
      e.product.variantId === product.variantId
        ? { ...e, quantity: Math.min(MAX_LINE_QUANTITY, e.quantity + 1) }
        : e,
    );
  }
  return [...cart, { product, quantity: 1 }];
}

/** Set a line's quantity; 0 (or less) removes the line. */
export function setCartQuantity(cart: PosCartEntry[], variantId: string, quantity: number): PosCartEntry[] {
  const q = Math.min(MAX_LINE_QUANTITY, Math.floor(quantity));
  if (q <= 0) return cart.filter((e) => e.product.variantId !== variantId);
  return cart.map((e) => (e.product.variantId === variantId ? { ...e, quantity: q } : e));
}

/** Case-insensitive token search over name / brand / category / variant label. */
export function searchProducts(products: PosMenuProduct[], query: string): PosMenuProduct[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return products;
  return products.filter((p) => {
    const hay = `${p.name} ${p.brand ?? ""} ${p.category} ${p.variantLabel ?? ""}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

// ---------------------------------------------------------------------------
// Pricing — identical to the website's server-side reprice (order-pricing.ts)
// ---------------------------------------------------------------------------

export type PricedSaleLine = PosSaleLine & {
  brand: string | null;
  variantLabel: string | null;
  appliedLabel?: string;
};

export type PriceCartResult = {
  lines: PricedSaleLine[];
  totals: OrderTotals;
  /** Lines that cannot be sold at the computed price (RCW 69.50.357 floor). */
  problems: string[];
};

/**
 * Price the cart with the shared promotions engine + statutory floors.
 * Mirrors repriceOrderLines: best promo per line, then
 * unit = max(statutoryClamp, min(costFloor, regular)) with regular > 0.
 */
export function priceCart(cart: PosCartEntry[], rules: EngineRule[]): PriceCartResult {
  const engineLines: EngineCartLine[] = cart.map((e) => ({
    lineId: e.product.variantId,
    regularPriceMinorUnits: e.product.regularPriceMinor,
    quantity: e.quantity,
    categories: e.product.categories.length
      ? e.product.categories.map((c) => c.toLowerCase())
      : [e.product.category.toLowerCase()],
    brand: e.product.brand,
    productKey: e.product.productId,
    variantLabel: e.product.variantLabel,
    costMinorUnits: e.product.costMinorUnits,
  }));
  const byLine = new Map(engineLines.map((l) => [l.lineId, l]));
  const discount = computePromotions(engineLines, rules);
  const discountByLine = new Map(discount.lines.map((l) => [l.lineId, l]));

  const lines: PricedSaleLine[] = [];
  const problems: string[] = [];
  for (const entry of cart) {
    const d = discountByLine.get(entry.product.variantId);
    const regular = entry.product.regularPriceMinor;
    const rawUnit = d ? d.unitPriceMinorUnits : regular;
    const statutory = clampCannabisUnitPrice(entry.product.category, rawUnit, regular);
    const input = byLine.get(entry.product.variantId);
    const costFloor = input ? lineCostFloor(input) : 0;
    const unit = regular > 0 ? Math.max(statutory, Math.min(costFloor, regular)) : statutory;
    const sellable = assertCannabisLineSellable({
      category: entry.product.category,
      unitPriceMinorUnits: unit,
    });
    if (!sellable.ok) {
      problems.push(
        `${entry.product.name}${entry.product.variantLabel ? ` (${entry.product.variantLabel})` : ""}: ${sellable.reason}`,
      );
      continue;
    }
    lines.push({
      productId: entry.product.productId,
      productName: entry.product.variantLabel
        ? `${entry.product.name} (${entry.product.variantLabel})`
        : entry.product.name,
      category: entry.product.category,
      quantity: entry.quantity,
      unitPriceMinor: unit,
      regularPriceMinor: regular,
      // POS B20: exact variant identity travels with the line so the synced
      // order can decrement inventory precisely and CCRS resolves per-line.
      variantId: entry.product.variantId,
      brand: entry.product.brand,
      variantLabel: entry.product.variantLabel,
      appliedLabel: d?.appliedLabel,
    });
  }

  const totals = computeOrderTotals(
    lines.map((l) => ({
      category: l.category,
      quantity: l.quantity,
      unitPriceMinorUnits: l.unitPriceMinor,
      regularPriceMinorUnits: l.regularPriceMinor,
    })),
  );
  return { lines, totals, problems };
}

// ---------------------------------------------------------------------------
// Sales-limit meter (WAC 314-55-095) with the owner's settings semantics
// ---------------------------------------------------------------------------

export type LimitJudgement = {
  evaluation: LimitEvaluation;
  /** True = the sale MUST NOT proceed (enforcement on + hard block on). */
  blocked: boolean;
  /** True = exceeded but the owner runs soft warnings (still surfaced loudly). */
  softWarning: boolean;
};

export function judgeLimits(
  lines: LimitCartLine[],
  customerType: "recreational" | "medical",
  settings: PosLimitSettings,
): LimitJudgement {
  const profile = customerType === "medical" ? settings.med : settings.rec;
  const evaluation = evaluateCart(lines, customerType, {
    ...profile,
    unitGrams: settings.unitGrams,
  });
  if (!settings.enforce) return { evaluation, blocked: false, softWarning: false };
  return {
    evaluation,
    blocked: evaluation.blocked && settings.hardBlock,
    softWarning: evaluation.blocked && !settings.hardBlock,
  };
}

/** Limit lines for a priced cart (category snapshot drives the bucket). */
export function limitLinesFor(lines: PricedSaleLine[]): LimitCartLine[] {
  return lines.map((l) => ({ category: l.category, quantity: l.quantity }));
}

// ---------------------------------------------------------------------------
// Sale payload assembly — validated BEFORE it may enter the offline queue
// ---------------------------------------------------------------------------

export type BuildSaleArgs = {
  lines: PricedSaleLine[];
  totals: OrderTotals;
  tenderedMinor: number;
  drawerSessionId: string;
  idVerification: { method: "scan" | "manual"; manualEventUuid?: string };
  /**
   * Present on MEDICAL sales (B9): the captured recognition card, the client
   * UUID of its already-enqueued medical_card_capture event, and the savings
   * passed through by applyMedicalPricing. validateSalePayload enforces the
   * structure (including the MCR attestation) before the queue accepts it.
   */
  medical?: PosSalePayload["medical"];
  /**
   * Present when a loyalty member was attached at the register (B14): the
   * customers.id + display label the server's member lookup returned. The
   * sync writes orders.customer_id so the EXISTING completion accrual earns
   * the points; the device only estimates for the receipt.
   */
  loyalty?: PosSalePayload["loyalty"];
  /**
   * Present when a loyalty REDEMPTION CODE was applied at the register
   * (Task AM-B): the /api/pos/loyalty route issued (or looked up) the code
   * and computed the per-line spread server-side; the reduced prices already
   * live in `lines` (each reduced line carries loyaltyDiscountMinor).
   * validateSalePayload enforces block/line coherence before the queue
   * accepts the sale; the sync claims the code atomically.
   */
  loyaltyRedemption?: PosSalePayload["loyaltyRedemption"];
  /**
   * Cash-rounding policy from the bundle (POS B33). When set and the mode
   * rounds this total, the customer owes the ROUNDED due amount: change is
   * computed against it and the payload carries the auditable `rounding`
   * block. totalMinor/subtotalMinor/taxMinor stay PRE-ROUNDED per WA DOR
   * interim guidance (tax on the original price).
   */
  rounding?: PosCashRoundingConfig;
};

export type BuildSaleResult =
  | {
      ok: true;
      payload: PosSalePayload;
      changeMinor: number;
      /** Cash amount actually due at the drawer (= total when no rounding). */
      dueMinor: number;
      /** dueMinor − totalMinor (0 when no rounding applied). */
      roundingAdjustmentMinor: number;
    }
  | { ok: false; errors: string[] };

export function buildSalePayload(args: BuildSaleArgs): BuildSaleResult {
  const totalMinor = args.totals.totalMinorUnits;
  // POS B33 — the owner's rounding policy decides the cash amount DUE.
  const mode = args.rounding?.mode ?? "off";
  const rounded = roundCashDue(totalMinor, mode);
  if (!rounded) return { ok: false, errors: ["Order total must be a non-negative integer (cents)."] };
  const dueMinor = rounded.dueMinor;
  const tender = computeCashChange({
    totalMinor: dueMinor,
    tenderedMinor: args.tenderedMinor,
  });
  if (!tender.ok) return { ok: false, errors: [tender.error] };

  const payload: PosSalePayload = {
    lines: args.lines.map((l) => ({
      productId: l.productId,
      productName: l.productName,
      category: l.category,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      regularPriceMinor: l.regularPriceMinor,
      // POS B20: optional exact-variant identity (omitted when absent so
      // pre-B20 payload shapes stay byte-identical).
      ...(l.variantId ? { variantId: l.variantId } : {}),
      // POS B24: optional manager price-override block (applyPriceOverrides
      // stamped it onto the line; forwarded verbatim so the sync can audit).
      ...(l.override ? { override: l.override } : {}),
      // Task AM-B: optional per-UNIT loyalty reduction (forwarded verbatim;
      // validateSalePayload proves the sum matches the redemption block).
      ...(l.loyaltyDiscountMinor ? { loyaltyDiscountMinor: l.loyaltyDiscountMinor } : {}),
    })),
    totalMinor: args.totals.totalMinorUnits,
    subtotalMinor: args.totals.subtotalMinorUnits,
    taxMinor: args.totals.estimatedTaxMinorUnits,
    paymentMethod: "cash",
    tenderedMinor: args.tenderedMinor,
    changeMinor: tender.changeMinor,
    drawerSessionId: args.drawerSessionId,
    idVerification: args.idVerification,
    ...(args.medical ? { medical: args.medical } : {}),
    ...(args.loyalty ? { loyalty: args.loyalty } : {}),
    ...(args.loyaltyRedemption ? { loyaltyRedemption: args.loyaltyRedemption } : {}),
    // POS B33 — carry the rounding block only when a real adjustment
    // happened (mode !== off AND the total missed the nickel), so pre-B33
    // payload shapes stay byte-identical.
    ...(mode !== "off" && rounded.adjustmentMinor !== 0
      ? { rounding: { mode, adjustmentMinor: rounded.adjustmentMinor, dueMinor } }
      : {}),
  };
  const check = validateSalePayload(payload);
  if (!check.ok) return { ok: false, errors: check.errors };
  return {
    ok: true,
    payload,
    changeMinor: tender.changeMinor,
    dueMinor,
    roundingAdjustmentMinor: mode !== "off" ? rounded.adjustmentMinor : 0,
  };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runSaleFlowCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  const flower: PosMenuProduct = {
    productId: "prod-flower",
    variantId: "var-flower-35",
    name: "Blue Dream",
    brand: "Greenway Farms",
    category: "flower",
    categories: ["flower"],
    variantLabel: "3.5g",
    regularPriceMinor: 3500,
    costMinorUnits: null,
    inventoryStatus: "in-stock",
  };
  const conc: PosMenuProduct = {
    productId: "prod-conc",
    variantId: "var-conc-1",
    name: "Live Resin",
    brand: null,
    category: "concentrate",
    categories: ["concentrate"],
    variantLabel: "1g",
    regularPriceMinor: 2500,
    costMinorUnits: 800,
    inventoryStatus: "in-stock",
  };

  // Cart ops
  let cart = addToCart([], flower);
  cart = addToCart(cart, flower);
  ok(cart.length === 1 && cart[0].quantity === 2, "addToCart merges same variant");
  cart = addToCart(cart, conc);
  ok(cart.length === 2, "addToCart appends new variant");
  cart = setCartQuantity(cart, "var-flower-35", 3);
  ok(cart[0].quantity === 3, "setCartQuantity updates");
  ok(setCartQuantity(cart, "var-conc-1", 0).length === 1, "quantity 0 removes the line");
  ok(setCartQuantity(cart, "var-flower-35", 500)[0].quantity === MAX_LINE_QUANTITY, "quantity capped");

  // Search
  ok(searchProducts([flower, conc], "blue 3.5").length === 1, "search matches name+label tokens");
  ok(searchProducts([flower, conc], "").length === 2, "empty query returns all");
  ok(searchProducts([flower, conc], "resin").length === 1, "search matches other product");

  // Pricing without rules = regular prices, correct tax back-out
  const pricedPlain = priceCart([{ product: flower, quantity: 2 }], []);
  ok(pricedPlain.lines.length === 1 && pricedPlain.problems.length === 0, "plain cart prices cleanly");
  ok(pricedPlain.totals.totalMinorUnits === 7000, "total = Σ line totals");
  ok(
    pricedPlain.totals.subtotalMinorUnits === Math.round(7000 / 1.463),
    "cannabis subtotal backed out with 1.463 divisor",
  );

  // Pricing with a 20% percent rule
  const rule: EngineRule = {
    id: "r1",
    title: "20% off flower",
    discountType: "percent",
    discountPercent: 20,
    discountFixed: 0,
    priority: 1,
    storewide: false,
    targetCategories: ["flower"],
    targetBrands: [],
    targetProductKeys: [],
    excludeCategories: [],
    excludeBrands: [],
    excludeProductKeys: [],
    config: {},
  };
  const discounted = priceCart([{ product: flower, quantity: 1 }], [rule]);
  ok(discounted.lines[0].unitPriceMinor === 2800, "20% promo applied (3500 → 2800)");
  // Engine label format: "<title> · <p>% off" (flatPercentDiscount).
  ok((discounted.lines[0].appliedLabel ?? "").startsWith("20% off flower"), "applied label carried");

  // Cost floor: a 90% discount on conc (cost 800) clamps at cost
  const deep: EngineRule = { ...rule, id: "r2", title: "90% off", discountPercent: 90, targetCategories: ["concentrate"] };
  const clamped = priceCart([{ product: conc, quantity: 1 }], [deep]);
  ok(clamped.lines[0].unitPriceMinor >= 800, "CCRS cost floor holds (never below acquisition cost)");

  // A zero-regular cannabis line is refused, not sold free
  const freebie: PosMenuProduct = { ...flower, variantId: "var-free", regularPriceMinor: 0 };
  const refused = priceCart([{ product: freebie, quantity: 1 }], []);
  ok(refused.problems.length === 1 && refused.lines.length === 0, "zero-price cannabis refused (RCW 69.50.357)");

  // Limits
  const settings: PosLimitSettings = {
    enforce: true,
    hardBlock: true,
    rec: { usable: 28, solid_edible: 453.6, concentrate: 7, liquid_edible: 2016 },
    med: { usable: 84, solid_edible: 1360.8, concentrate: 21, liquid_edible: 6048 },
    unitGrams: {},
  };
  const overConc = judgeLimits([{ category: "concentrate", quantity: 8 }], "recreational", settings);
  ok(overConc.blocked, "8g concentrate blocks a rec sale (7g limit)");
  const softSettings = { ...settings, hardBlock: false };
  const soft = judgeLimits([{ category: "concentrate", quantity: 8 }], "recreational", softSettings);
  ok(!soft.blocked && soft.softWarning, "soft mode warns without blocking");
  const offSettings = { ...settings, enforce: false };
  const off = judgeLimits([{ category: "concentrate", quantity: 8 }], "recreational", offSettings);
  ok(!off.blocked && !off.softWarning, "enforcement off = no block, no warning");
  const medOk = judgeLimits([{ category: "concentrate", quantity: 8 }], "medical", settings);
  ok(!medOk.blocked, "8g concentrate fine for medical (21g limit)");

  // Sale payload assembly
  const drawerId = "55555555-5555-4555-8555-555555555555";
  const priced = priceCart([{ product: flower, quantity: 1 }], []);
  const built = buildSalePayload({
    lines: priced.lines,
    totals: priced.totals,
    tenderedMinor: 4000,
    drawerSessionId: drawerId,
    idVerification: { method: "scan" },
  });
  ok(built.ok, "valid cash sale builds");
  if (built.ok) {
    ok(built.changeMinor === 4000 - 3500, "change computed exactly");
    ok(built.payload.paymentMethod === "cash", "cash-only payment method");
    // POS B20: the cart's exact variant identity travels through pricing into
    // the payload line.
    ok(built.payload.lines[0].variantId === "var-flower-35", "B20: variantId carried price→payload");
    // POS B33: no rounding config = no rounding block, due = total.
    ok(built.payload.rounding === undefined, "B33: no policy → no rounding block");
    ok(built.dueMinor === 3500 && built.roundingAdjustmentMinor === 0, "B33: due = total when off");
  }

  // POS B33 — rounding policy shapes the payload and the change math.
  const oddTotals = { ...priced.totals, totalMinorUnits: 3502 };
  const roundedBuild = buildSalePayload({
    lines: priced.lines,
    totals: oddTotals,
    tenderedMinor: 4000,
    drawerSessionId: drawerId,
    idVerification: { method: "scan" },
    rounding: { mode: "nearest" },
  });
  ok(roundedBuild.ok, "B33: rounded sale builds");
  if (roundedBuild.ok) {
    ok(roundedBuild.dueMinor === 3500 && roundedBuild.roundingAdjustmentMinor === -2, "B33: $35.02 → $35.00 due (−2¢)");
    ok(roundedBuild.changeMinor === 500, "B33: change runs off the ROUNDED due");
    ok(roundedBuild.payload.totalMinor === 3502, "B33: payload total stays PRE-rounded (tax on original price)");
    ok(
      roundedBuild.payload.rounding?.mode === "nearest" &&
        roundedBuild.payload.rounding.adjustmentMinor === -2 &&
        roundedBuild.payload.rounding.dueMinor === 3500,
      "B33: coherent rounding block in payload",
    );
  }
  // Policy on but total already on the nickel — block omitted (byte-identical
  // to a pre-B33 payload).
  const nickelBuild = buildSalePayload({
    lines: priced.lines,
    totals: priced.totals,
    tenderedMinor: 4000,
    drawerSessionId: drawerId,
    idVerification: { method: "scan" },
    rounding: { mode: "nearest" },
  });
  ok(
    nickelBuild.ok && nickelBuild.payload.rounding === undefined && nickelBuild.roundingAdjustmentMinor === 0,
    "B33: nickel-exact total under a live policy carries no block",
  );
  // A tender that covers the rounded due but not the raw total still builds
  // (down-rounding means the customer legitimately owes less).
  const downBuild = buildSalePayload({
    lines: priced.lines,
    totals: { ...priced.totals, totalMinorUnits: 3504 },
    tenderedMinor: 3500,
    drawerSessionId: drawerId,
    idVerification: { method: "scan" },
    rounding: { mode: "down" },
  });
  ok(
    downBuild.ok && downBuild.dueMinor === 3500 && downBuild.changeMinor === 0,
    "B33: down-rounded due accepts exact rounded tender",
  );
  const short = buildSalePayload({
    lines: priced.lines,
    totals: priced.totals,
    tenderedMinor: 1000,
    drawerSessionId: drawerId,
    idVerification: { method: "scan" },
  });
  ok(!short.ok, "short tender refused before enqueue");
  const manualNoUuid = buildSalePayload({
    lines: priced.lines,
    totals: priced.totals,
    tenderedMinor: 4000,
    drawerSessionId: drawerId,
    idVerification: { method: "manual" },
  });
  ok(!manualNoUuid.ok, "manual ID without audit-event UUID refused");

  // Loyalty attach (B14) — travels intact through the payload builder.
  const withMember = buildSalePayload({
    lines: priced.lines,
    totals: priced.totals,
    tenderedMinor: 4000,
    drawerSessionId: drawerId,
    idVerification: { method: "scan" },
    loyalty: { customerId: "66666666-6666-4666-8666-666666666666", memberLabel: "Jane D." },
  });
  ok(withMember.ok && withMember.payload.loyalty?.memberLabel === "Jane D.", "loyalty block carried in payload");
  const badMember = buildSalePayload({
    lines: priced.lines,
    totals: priced.totals,
    tenderedMinor: 4000,
    drawerSessionId: drawerId,
    idVerification: { method: "scan" },
    loyalty: { customerId: "not-a-uuid", memberLabel: "Jane D." },
  });
  ok(!badMember.ok, "loyalty with bad customer id refused before enqueue");

  // Medical block pass-through (B9): buildSalePayload carries it verbatim and
  // validateSalePayload enforces its structure before the queue accepts it.
  const medBlock = {
    card: {
      upid: "WA-UPID-0001",
      effectiveOn: "2026-01-01",
      expiresOn: "2027-01-01",
      holderType: "patient" as const,
      mcrVerified: true,
    },
    cardEventUuid: "66666666-6666-4666-8666-666666666666",
    medicalSavingsMinor: 0,
  };
  const medBuilt = buildSalePayload({
    lines: priced.lines,
    totals: priced.totals,
    tenderedMinor: 4000,
    drawerSessionId: drawerId,
    idVerification: { method: "scan" },
    medical: medBlock,
  });
  ok(medBuilt.ok, "medical sale builds with the full block");
  if (medBuilt.ok) ok(medBuilt.payload.medical?.card.upid === "WA-UPID-0001", "medical block carried verbatim");
  const medNoMcr = buildSalePayload({
    lines: priced.lines,
    totals: priced.totals,
    tenderedMinor: 4000,
    drawerSessionId: drawerId,
    idVerification: { method: "scan" },
    medical: { ...medBlock, card: { ...medBlock.card, mcrVerified: false } },
  });
  ok(!medNoMcr.ok, "medical sale without MCR attestation refused before enqueue");

  console.log(`pos/sale-flow-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`sale-flow-core self-tests failed: ${fail}`);
}
