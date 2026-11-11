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
 * D232 M-8 (G-87): the owner's minimum margin for the Publish warning.
 * Michael, verbatim (SOP-11 Q-11-8): "Q8: 35% is fine." Margin is profit on
 * retail after the Printful estimate, the shipping gap and the card fee.
 */
export const MIN_MARGIN_BPS = 3500;

/** What shipping costs us beyond what the customer pays for it (never negative). */
export function shippingGapCents(chargedCents: number, costCents: number): number {
  return Math.max(0, Math.round(costCents || 0) - Math.round(chargedCents || 0));
}

/**
 * Smallest retail price (rounded UP to a .00 or .99-style ending) whose margin
 * on retail reaches `targetBps`. D232 M-8 (G-87): `ship` is one item's
 * shipping (what the customer pays, what Printful charges us). The gap is a
 * real cost on every order and the card fee is on retail + shipping, so the
 * price covers both. No `ship` = shipping passed through at cost (old rule).
 */
export function suggestRetailCents(printfulCents: number, targetBps: number, ending: "00" | "99" = "00", ship?: { chargedCents: number; costCents: number }): number {
  if (targetBps >= 10000) return 0;
  const charged = Math.max(0, Math.round(ship?.chargedCents ?? 0));
  const shipCost = Math.max(0, Math.round(ship?.costCents ?? 0));
  const gap = shippingGapCents(charged, shipCost);
  // retail*(1 - t) >= printful + gap + fee(retail);  fee ~ 2.9% retail + 30
  const raw = (printfulCents + gap + STRIPE_FIXED_CENTS) / (1 - targetBps / 10000 - STRIPE_PCT_BPS / 10000);
  let dollars = Math.max(1, Math.ceil(raw / 100));
  const fit = (d: number) => (ending === "99" ? d * 100 - 1 : d * 100);
  while (unitEconomics({ retailCents: fit(dollars), printfulCents, shippingChargedCents: charged, shippingCostCents: shipCost }).marginBps < targetBps) dollars += 1;
  return fit(dollars);
}

export interface ShippingRate { id: string; name: string; cents: number; minDays: number | null; maxDays: number | null }

/**
 * D232 M-8 (G-87): read Printful's POST /shipping/rates `result`
 * ([{ id: "STANDARD", name, rate: "13.60", currency, minDeliveryDays,
 * maxDeliveryDays }], developers.printful.com/docs "Shipping Rate API").
 * Picks STANDARD (what the shop's drafts use), else the cheapest USD rate.
 * Rate strings become integer cents; anything unreadable is skipped.
 */
export function pickStandardRate(result: unknown): ShippingRate | null {
  if (!Array.isArray(result)) return null;
  const rows: ShippingRate[] = [];
  for (const r of result) {
    if (!r || typeof r !== "object") continue;
    const o = r as { id?: unknown; name?: unknown; rate?: unknown; currency?: unknown; minDeliveryDays?: unknown; maxDeliveryDays?: unknown };
    if (o.currency !== undefined && o.currency !== "USD") continue;
    const txt = typeof o.rate === "string" ? o.rate.trim() : typeof o.rate === "number" ? String(o.rate) : "";
    if (!/^\d+(\.\d{1,2})?$/.test(txt)) continue;
    const [d, c = ""] = txt.split(".");
    const cents = Number(d) * 100 + Number((c + "00").slice(0, 2));
    const day = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    rows.push({ id: typeof o.id === "string" ? o.id : "", name: typeof o.name === "string" ? o.name : "", cents, minDays: day(o.minDeliveryDays), maxDays: day(o.maxDeliveryDays) });
  }
  return rows.find((x) => x.id === "STANDARD") ?? rows.sort((a, b) => a.cents - b.cents)[0] ?? null;
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
  { id: "list", title: "Package the listing", who: "Owner", what: "Publish & Ads builds the listing package (colours, sizes, Printful variants, retail prices, print positions) and Publish to greenwaymerch.com puts it on the shop within about a minute (owner/admin). The download is a backup.", slice: 4 },
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
  // D232 M-8 (G-87): 35% minimum, the shipping gap and Printful's rate string.
  ok(MIN_MARGIN_BPS === 3500, "owner minimum 35%");
  ok(shippingGapCents(599, 1360) === 761 && shippingGapCents(1500, 1360) === 0 && shippingGapCents(0, 0) === 0, "shipping gap, never negative");
  const g = suggestRetailCents(1560, 3500, "00", { chargedCents: 599, costCents: 1360 });
  ok(g > suggestRetailCents(1560, 3500) && unitEconomics({ retailCents: g, printfulCents: 1560, shippingChargedCents: 599, shippingCostCents: 1360 }).marginBps >= 3500, "gap-aware suggestion covers the gap");
  ok(unitEconomics({ retailCents: g - 100, printfulCents: 1560, shippingChargedCents: 599, shippingCostCents: 1360 }).marginBps < 3500, "gap-aware suggestion is the smallest");
  ok(suggestRetailCents(1560, 5000, "00", { chargedCents: 0, costCents: 0 }) === r, "gap 0 = old behaviour");
  const pr = pickStandardRate([{ id: "EXPRESS", name: "Express", rate: "25.50", currency: "USD" }, { id: "STANDARD", name: "Flat Rate (3-4 business days)", rate: "13.6", currency: "USD", minDeliveryDays: 3, maxDeliveryDays: 4 }]);
  ok(!!pr && pr.id === "STANDARD" && pr.cents === 1360 && pr.minDays === 3 && pr.maxDays === 4, "STANDARD picked, \"13.6\" = 1360 cents");
  ok(pickStandardRate([{ id: "A", rate: "9.99", currency: "USD" }, { id: "B", rate: "7.25", currency: "USD" }])!.cents === 725, "no STANDARD -> cheapest");
  ok(pickStandardRate([{ id: "STANDARD", rate: "abc" }, { id: "X", rate: "5.00", currency: "EUR" }]) === null && pickStandardRate(null) === null && pickStandardRate({}) === null, "junk and non-USD skipped");
  ok(JIT_PIPELINE.length === 9 && new Set(JIT_PIPELINE.map((s) => s.id)).size === 9, "pipeline steps");
  return { passed, failed };
}
