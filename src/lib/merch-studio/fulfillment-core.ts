/**
 * R70 S1 - Merch Studio just-in-time fulfillment + unit economics (PURE).
 *
 * Model: Greenway Glass & Goods lists a design; nothing is bought until a
 * customer pays on the SEPARATE Greenway Goods website (its own domain -
 * R71 S4); then ONE item is ordered from
 * Printful, made in Printful's own facility and shipped by Printful directly
 * to the customer in Greenway-branded labels/packing. All money is CENTS.
 *
 * Stripe Standard: 2.9% + 30c per successful domestic card charge; $15 dispute
 * fee (stripe.com/pricing, read 2026-10-17). Printful charges our card on file
 * for the wholesale cost + shipping when the order is confirmed.
 */

export const STRIPE_PCT_BPS = 290; // 2.90 % in basis points
export const STRIPE_FIXED_CENTS = 30;
export const STRIPE_DISPUTE_CENTS = 1500;

/** Card fee on a charge (Stripe rounds to the nearest cent). */
export function cardFeeCents(chargeCents: number, pctBps = STRIPE_PCT_BPS, fixed = STRIPE_FIXED_CENTS): number {
  if (chargeCents <= 0) return 0;
  return Math.round((chargeCents * pctBps) / 10000) + fixed;
}

export interface UnitEconomicsInput {
  retailCents: number;
  /** Printful wholesale estimate for the unit (blank + placements). */
  printfulCents: number;
  /** What we charge the customer for shipping. */
  shippingChargedCents: number;
  /** What Printful charges us to ship it. */
  shippingCostCents: number;
  /** One-time costs (digitizing, sample) to amortize over expected units. */
  oneTimeCents?: number;
  expectedUnits?: number;
}
export interface UnitEconomics {
  chargeCents: number;
  cardFeeCents: number;
  costCents: number;
  profitCents: number;
  /** Profit / retail, basis points (rounded). */
  marginBps: number;
}
export function unitEconomics(i: UnitEconomicsInput): UnitEconomics {
  const charge = i.retailCents + i.shippingChargedCents;
  const fee = cardFeeCents(charge);
  const amort = i.oneTimeCents && i.expectedUnits && i.expectedUnits > 0 ? Math.round(i.oneTimeCents / i.expectedUnits) : 0;
  const cost = i.printfulCents + i.shippingCostCents + fee + amort;
  const profit = charge - cost;
  return { chargeCents: charge, cardFeeCents: fee, costCents: cost, profitCents: profit, marginBps: i.retailCents > 0 ? Math.round((profit / i.retailCents) * 10000) : 0 };
}

/**
 * Smallest retail price (rounded UP to a .00 or .99-style ending) whose margin
 * on retail reaches `targetBps`, assuming shipping is passed through at cost.
 */
export function suggestRetailCents(printfulCents: number, targetBps: number, ending: "00" | "99" = "00"): number {
  if (targetBps >= 10000) return 0;
  // retail*(1 - t) >= printful + fee(retail);  fee ~ 2.9% retail + 30
  const raw = (printfulCents + STRIPE_FIXED_CENTS) / (1 - targetBps / 10000 - STRIPE_PCT_BPS / 10000);
  let dollars = Math.ceil(raw / 100);
  const fit = (d: number) => (ending === "99" ? d * 100 - 1 : d * 100);
  while (unitEconomics({ retailCents: fit(dollars), printfulCents, shippingChargedCents: 0, shippingCostCents: 0 }).marginBps < targetBps) dollars += 1;
  return fit(dollars);
}

/**
 * Highest slice whose pipeline steps are live in the studio.
 * R72 S6: paid orders -> Printful DRAFT (Stripe webhook), owner confirms at
 * greenwaymerch.com/admin/orders, Printful webhook emails tracking. All 9 steps live.
 * R72 S5: greenwaymerch.com (merch-site/) is live in the repo - shop, catalogue,
 * detail, cart and Stripe checkout. R71 S4: listing package + the redirect ad. Slice 5 = the separate Greenway
 * Goods website (own domain, Stripe under the LLC); Slice 6 = Printful orders.
 */
export const SHIPPED_SLICE = 6;
export interface PipelineStep { id: string; title: string; who: string; what: string; slice: 1 | 2 | 3 | 4 | 5 | 6 }
/** The full just-in-time pipeline, shown on the Fulfillment tab. */
export const JIT_PIPELINE: readonly PipelineStep[] = [
  { id: "pick", title: "Pick a premium blank", who: "Designer", what: "Choose the garment, colours and placements from the Printful-backed catalog.", slice: 1 },
  { id: "design", title: "Design on a true-to-inch canvas", who: "Designer", what: "Build the art per placement with live print checks (DPI, text size, threads, seams, zippers).", slice: 2 },
  { id: "proof", title: "Export print files + proof", who: "Studio", what: "300-DPI transparent PNG per placement, mockups on every colour, a proof sheet to approve.", slice: 3 },
  { id: "sample", title: "Order one sample", who: "Owner", what: "Printful sample order to check colour, hand-feel and placement before listing.", slice: 3 },
  { id: "list", title: "Package the listing", who: "Owner", what: "Publish & Ads builds the listing package (colours, sizes, Printful variants, retail prices, print positions) for greenwaymerch.com to import (drop it in merch-site/catalog/).", slice: 4 },
  { id: "sell", title: "Customer pays (cards)", who: "Customer", what: "Cart + Stripe checkout on greenwaymerch.com (its own domain and Vercel project) under Greenway Merchandising LLC. The cannabis site only links there.", slice: 5 },
  { id: "order", title: "Draft Printful order", who: "Merch site", what: "Paid order (Stripe webhook) creates a Printful DRAFT with the exact variant, files and print positions; greenwaymerch.com/admin/orders shows paid vs. Printful cost.", slice: 6 },
  { id: "confirm", title: "Confirm (human click)", who: "Owner/staff", what: "One click on greenwaymerch.com/admin/orders confirms; Printful charges our card on file and starts production (2-5 business days).", slice: 6 },
  { id: "ship", title: "Printful ships to the customer", who: "Printful", what: "Shipped from Printful's facility with our packing slip; the Printful webhook emails the customer their tracking link (problems alert the owner).", slice: 6 },
];

export function __runFulfillmentTests(): { passed: number; failed: number } {
  let passed = 0, failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error(`FAIL fulfillment-core: ${m}`); } };
  ok(cardFeeCents(10000) === 320, "$100 -> $3.20 fee");
  ok(cardFeeCents(3500) === 132, "$35 -> 1.015 rounds to 102 + 30");
  ok(cardFeeCents(0) === 0, "no charge no fee");
  const u = unitEconomics({ retailCents: 3500, printfulCents: 1560, shippingChargedCents: 500, shippingCostCents: 475 });
  ok(u.chargeCents === 4000 && u.cardFeeCents === 146, "charge + fee");
  ok(u.profitCents === 4000 - 1560 - 475 - 146, "profit");
  ok(u.marginBps === Math.round((u.profitCents / 3500) * 10000), "margin bps");
  const am = unitEconomics({ retailCents: 3500, printfulCents: 1560, shippingChargedCents: 0, shippingCostCents: 0, oneTimeCents: 3000, expectedUnits: 30 });
  ok(am.costCents === 1560 + 132 + 100, "amortised one-time");
  const r = suggestRetailCents(1560, 5000);
  ok(r % 100 === 0 && unitEconomics({ retailCents: r, printfulCents: 1560, shippingChargedCents: 0, shippingCostCents: 0 }).marginBps >= 5000, "suggested retail meets 50%");
  ok(unitEconomics({ retailCents: r - 100, printfulCents: 1560, shippingChargedCents: 0, shippingCostCents: 0 }).marginBps < 5000, "suggested retail is the smallest");
  ok(suggestRetailCents(1560, 5000, "99") % 100 === 99, ".99 ending");
  ok(JIT_PIPELINE.length === 9 && new Set(JIT_PIPELINE.map((s) => s.id)).size === 9, "pipeline steps");
  return { passed, failed };
}
