/**
 * src/lib/reports/tax-base-core.ts  (GW-010 fix)
 *
 * The ONE shared derivation of a sold line's PRE-TAX base from the stored
 * order-line price. PURE (no React, no DB, no server-only imports) so the
 * compliance harness can run the embedded self-tests directly.
 *
 * WHY THIS MODULE EXISTS (finding GW-010, docs/audit/FINDINGS.md):
 *   `order_lines.price_minor_units` is the tax-INCLUSIVE out-the-door card
 *   price — that is the system's documented pricing model
 *   (src/lib/orders/order-pricing-core.ts:11,37,39 and migration
 *   0007_slice7_orders.sql:138 "Authoritative engine-discounted unit price
 *   (tax-inclusive)"). The CCRS Sale.csv, Sage exports, and return-correction
 *   snapshots used to apply the tax rates directly ON TOP of that inclusive
 *   price, overstating SalesTax/OtherTax by the full 46.3% wedge on cannabis
 *   lines. Every consumer now routes through preTaxLineBaseMinor() below, the
 *   same back-out the medical engine (medical-sale-core.ts lineBaseMinor) and
 *   the order-totals engine (order-pricing-core.ts computeOrderTotals) already
 *   performed correctly.
 *
 * THE MATH (all money in MINOR units / cents; rates in basis points):
 *   inclusive = base + applyBps(base, stillDueRateBps)
 *   =>  base  = round(inclusive × 10000 / (10000 + stillDueRateBps))
 *   For a fully-taxed cannabis line stillDue = 930 + 3700 = 4630, which is
 *   EXACTLY the cart's divisor: round(n × 10000/14630) === round(n / 1.463)
 *   for every integer n (self-tested below). Non-cannabis: 930 (÷ 1.093).
 *
 * EXEMPTIONS (WAC 314-55-090(2)): the register passes an exemption through by
 *   REPRICING the line to base + still-due tax (medical-pos-core.ts), so an
 *   exempted tax was never inside the stored inclusive price. The back-out
 *   must therefore use only the STILL-DUE rate:
 *     both exempt          → rate 0     (stored price IS the base)
 *     excise-only exempt   → 930       (sales tax still inside)
 *     sales-only exempt    → 3700      (excise still inside, cannabis)
 *     no exemption         → 930 (+3700 if cannabis)
 */

/**
 * The tax rate (bps) still INSIDE a stored tax-inclusive line price, honoring
 * per-line WAC 314-55-090(2) exemptions that were passed through at pricing.
 */
export function stillDueRateBps(opts: {
  isCannabis: boolean;
  salesExempt?: boolean;
  exciseExempt?: boolean;
  /** state + local sales tax, bps (e.g. 930). */
  combinedSalesRateBps: number;
  /** cannabis excise, bps (e.g. 3700). */
  exciseRateBps: number;
}): number {
  const sales = opts.salesExempt ? 0 : Math.max(0, opts.combinedSalesRateBps);
  const excise = opts.isCannabis && !opts.exciseExempt ? Math.max(0, opts.exciseRateBps) : 0;
  return sales + excise;
}

/**
 * Back out the pre-tax base from a TAX-INCLUSIVE minor-unit amount at the
 * given still-due rate. Single rounding, matching the cart's divisor math.
 */
export function backOutInclusiveMinor(inclusiveMinor: number, rateBps: number): number {
  const gross = Math.max(0, Math.round(inclusiveMinor));
  if (rateBps <= 0) return gross;
  return Math.max(0, Math.round((gross * 10000) / (10000 + rateBps)));
}

/**
 * PRE-TAX line base from the stored tax-inclusive unit price × quantity.
 * This is what CCRS/Sage/LIQ-1295 consumers must tax and report — never the
 * raw stored price (GW-010).
 */
export function preTaxLineBaseMinor(opts: {
  /** Stored tax-INCLUSIVE per-unit price, minor units (order_lines.price_minor_units). */
  unitPriceMinorUnits: number;
  quantity: number;
  isCannabis: boolean;
  salesExempt?: boolean;
  exciseExempt?: boolean;
  combinedSalesRateBps: number;
  exciseRateBps: number;
}): number {
  const qty = Math.max(0, Math.round(opts.quantity));
  const inclusive = Math.max(0, Math.round(opts.unitPriceMinorUnits)) * qty;
  return backOutInclusiveMinor(inclusive, stillDueRateBps(opts));
}

/**
 * PRE-TAX per-unit price (qty 1) — what CCRS Sale.csv prints as UnitPrice
 * ("price of ONE unit BEFORE discount/tax", docs/CCRS_SELF_REPORTING_GUIDE.md).
 * Regular (pre-discount) prices carry the FULL rate for the line type — a
 * medical exemption changes what the patient paid (the sold price), not the
 * shelf price.
 */
export function preTaxUnitMinor(opts: {
  unitPriceMinorUnits: number;
  isCannabis: boolean;
  combinedSalesRateBps: number;
  exciseRateBps: number;
}): number {
  return preTaxLineBaseMinor({ ...opts, quantity: 1 });
}

// ---------------------------------------------------------------------------
// Self-tests (pure; run via scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`tax-base-core self-test failed: ${msg}`);
}

export function __runTaxBaseCoreTests(): void {
  const RATES = { combinedSalesRateBps: 930, exciseRateBps: 3700 };

  // The finding's worked example: one cannabis line sold at $10.00 out the
  // door. Register collects base $6.84 + excise $2.53 + sales tax $0.64
  // (each independently rounded; the ±1¢ vs $10.00 is pure rounding).
  const base = preTaxLineBaseMinor({ unitPriceMinorUnits: 1000, quantity: 1, isCannabis: true, ...RATES });
  ok(base === 684, `worked example base: expected 684, got ${base}`);
  ok(Math.round((base * 3700) / 10000) === 253, "worked example excise = 253");
  ok(Math.round((base * 930) / 10000) === 64, "worked example sales tax = 64");

  // Back-out at 4630 bps is EXACTLY the cart's ÷1.463 divisor (and 930 bps is
  // ÷1.093) — same single rounding, so the compliance base can never drift
  // from the register's own subtotal math.
  for (const n of [1, 7, 99, 684, 999, 1000, 1050, 1093, 1200, 1463, 2336, 3418, 5000, 6836, 123456]) {
    ok(backOutInclusiveMinor(n, 4630) === Math.round(n / 1.463), `divisor equivalence (cannabis) at ${n}`);
    ok(backOutInclusiveMinor(n, 930) === Math.round(n / 1.093), `divisor equivalence (non-cannabis) at ${n}`);
  }

  // Still-due rates honor per-line exemptions (the register repriced the line,
  // so exempted tax is NOT inside the stored price).
  ok(stillDueRateBps({ isCannabis: true, ...RATES }) === 4630, "cannabis full rate 4630");
  ok(stillDueRateBps({ isCannabis: false, ...RATES }) === 930, "non-cannabis rate 930");
  ok(
    stillDueRateBps({ isCannabis: true, salesExempt: true, exciseExempt: true, ...RATES }) === 0,
    "both exempt → 0 still due",
  );
  ok(
    stillDueRateBps({ isCannabis: true, exciseExempt: true, ...RATES }) === 930,
    "excise-exempt cannabis → sales tax still inside",
  );
  ok(
    stillDueRateBps({ isCannabis: true, salesExempt: true, ...RATES }) === 3700,
    "sales-exempt cannabis → excise still inside",
  );
  // Fully exempt: the stored price IS the base (register charged base only).
  ok(
    preTaxLineBaseMinor({
      unitPriceMinorUnits: 1000, quantity: 1, isCannabis: true,
      salesExempt: true, exciseExempt: true, ...RATES,
    }) === 1000,
    "fully exempt line: stored price is the base",
  );
  // Excise-only exempt: $10.93 stored → $10.00 base (sales tax backed out).
  ok(
    preTaxLineBaseMinor({
      unitPriceMinorUnits: 1093, quantity: 1, isCannabis: true, exciseExempt: true, ...RATES,
    }) === 1000,
    "excise-exempt line backs out sales tax only",
  );

  // Σ(line taxes) reconciles with the order header's estimated_tax_minor_units
  // (computeOrderTotals semantics: total − round(Σ inclusive/divisor)) within
  // per-line rounding (≤1¢ per line).
  const cart: { qty: number; unit: number; cannabis: boolean }[] = [
    { qty: 2, unit: 3418, cannabis: true },
    { qty: 1, unit: 1093, cannabis: false },
    { qty: 1, unit: 999, cannabis: true },
  ];
  const totalMinor = cart.reduce((s, l) => s + l.qty * l.unit, 0);
  const headerSubtotal = Math.round(
    cart.reduce((s, l) => s + (l.qty * l.unit) / (l.cannabis ? 1.463 : 1.093), 0),
  );
  const headerEstimatedTax = totalMinor - headerSubtotal; // 8928 − 6355 = 2573
  let sigmaLineTax = 0;
  for (const l of cart) {
    const b = preTaxLineBaseMinor({
      unitPriceMinorUnits: l.unit, quantity: l.qty, isCannabis: l.cannabis, ...RATES,
    });
    sigmaLineTax += Math.round((b * 930) / 10000) + (l.cannabis ? Math.round((b * 3700) / 10000) : 0);
  }
  ok(headerEstimatedTax === 2573, `fixture header tax: expected 2573, got ${headerEstimatedTax}`);
  ok(
    Math.abs(sigmaLineTax - headerEstimatedTax) <= cart.length,
    `Σ(line taxes) ${sigmaLineTax} reconciles with header ${headerEstimatedTax} within per-line rounding`,
  );

  // Pre-tax UnitPrice for the golden fixture rows (hand-verified):
  ok(preTaxUnitMinor({ unitPriceMinorUnits: 3418, isCannabis: true, ...RATES }) === 2336, "unit 3418 → 2336");
  ok(preTaxUnitMinor({ unitPriceMinorUnits: 1200, isCannabis: true, ...RATES }) === 820, "unit 1200 → 820");

  // Guards: negative/zero inputs never produce negative money.
  ok(preTaxLineBaseMinor({ unitPriceMinorUnits: -500, quantity: 3, isCannabis: true, ...RATES }) === 0, "negative price clamps to 0");
  ok(preTaxLineBaseMinor({ unitPriceMinorUnits: 1000, quantity: 0, isCannabis: true, ...RATES }) === 0, "zero qty → 0");
}
