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
};

export type BuildSaleResult =
  | { ok: true; payload: PosSalePayload; changeMinor: number }
  | { ok: false; errors: string[] };

export function buildSalePayload(args: BuildSaleArgs): BuildSaleResult {
  const tender = computeCashChange({
    totalMinor: args.totals.totalMinorUnits,
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
  };
  const check = validateSalePayload(payload);
  if (!check.ok) return { ok: false, errors: check.errors };
  return { ok: true, payload, changeMinor: tender.changeMinor };
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
  }
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
