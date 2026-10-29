/**
 * src/lib/compliance/excise-return-core.ts  (Run 6 / Slice 32)
 *
 * PURE computation for the WSLCB Cannabis Retailer Sales & Excise Tax return
 * (FORM LIQ-1295). No I/O — directly unit-testable with tsx.
 *
 * Authoritative box mapping (from the official LIQ-1295 R 7.24 workbook):
 *   Box 1 (S20): Total cannabis product sales BEFORE sales & excise tax,
 *                after returns & discounts. (pretax subtotal)
 *   Box 2 (S21): Less — total MEDICAL sales that qualify for the excise
 *                exemption. Entered as a NEGATIVE number. (valid 6/6/2024–6/30/2029)
 *   Box 3 (S22): Total TAXABLE cannabis sales = Box1 + Box2  (formula in sheet)
 *   Box 4 (S23): Excise rate = 0.37  (constant in sheet)
 *   Box 5 (S24): Calculated excise = round(Box3 * 0.37, 2)  (formula in sheet)
 *   Box 6 (S25): Additional excise collected OVER the calculated amount that
 *                cannot be refunded to the buyer.
 *   Box 7 (S26): Subtotal cannabis excise = Box5 + Box6  (formula)
 *   Box 8 (S28): LCB-assessed 2% late penalty / balance due. (entered by owner)
 *   Box 9 (S29): Approved credits (negative). (entered by owner)
 *   Box 10 (S30): Amount to pay = Box7 + Box8 + Box9  (formula)
 *
 * Due date: the 20th of the month following the reporting month (next business
 * day if the 20th is a weekend/holiday — we compute the plain 20th and note the
 * weekend roll forward without a holiday calendar).
 *
 * All monetary INPUTS to this module are in MINOR UNITS (cents); the LIQ-1295
 * expects DOLLARS, so the box values are returned in dollars (number, 2dp).
 */
import { pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { backOutInclusiveMinor, preTaxLineBaseMinor } from "@/lib/reports/tax-base-core";

export type ExciseReturnInput = {
  /** Reporting month 1-12. */
  month: number;
  /** Reporting year, e.g. 2025. */
  year: number;
  /** Total pretax cannabis product sales for the month, MINOR units. */
  cannabisSalesMinor: number;
  /** Total exempt medical sales for the month, MINOR units (positive magnitude). */
  exemptMedicalSalesMinor: number;
  /** Additional excise collected over calculated (Box 6), MINOR units. */
  additionalExciseCollectedMinor?: number;
  /** LCB-assessed penalty / balance due (Box 8), MINOR units. */
  assessedPenaltyMinor?: number;
  /** Approved credits (Box 9), MINOR units (positive magnitude → entered negative). */
  approvedCreditsMinor?: number;
};

export type ExciseReturnBoxes = {
  month: number;
  year: number;
  /** Box 1 — dollars. */
  box1_cannabisSales: number;
  /** Box 2 — dollars, NEGATIVE. */
  box2_lessMedical: number;
  /** Box 3 — dollars (computed here to mirror the sheet for preview). */
  box3_taxable: number;
  /** Box 4 — rate. */
  box4_rate: number;
  /** Box 5 — dollars. */
  box5_calculatedExcise: number;
  /** Box 6 — dollars. */
  box6_additionalExcise: number;
  /** Box 7 — dollars. */
  box7_subtotalExcise: number;
  /** Box 8 — dollars. */
  box8_assessedPenalty: number;
  /** Box 9 — dollars, NEGATIVE. */
  box9_approvedCredits: number;
  /** Box 10 — dollars (amount to pay). */
  box10_amountToPay: number;
  /** True when the month had zero cannabis sales (No-sales report). */
  noSales: boolean;
};

export const EXCISE_RATE = 0.37;

// ---------------------------------------------------------------------------
// Box 1 line aggregation (GW-014)
// ---------------------------------------------------------------------------

/**
 * One sold order line as Box 1 sees it. `isCannabis` and the exemption flags
 * are resolved by the caller (category rules + medical_exempt_sales join —
 * the same resolution wa-tax.ts uses), keeping this module PURE.
 */
export type Box1Line = {
  /** Stored tax-INCLUSIVE per-unit price, minor units. */
  unitPriceMinorUnits: number;
  quantity: number;
  isCannabis: boolean;
  /** WAC 314-55-090(2) exemptions passed through at pricing (affect the back-out rate). */
  salesExempt?: boolean;
  exciseExempt?: boolean;
};

export type Box1Aggregate = {
  /** Σ pre-tax base of CANNABIS lines only, minor units — the true Box 1. */
  cannabisSalesMinor: number;
  /** Σ pre-tax base of non-cannabis (merch/accessory) lines, minor units — excluded from Box 1. */
  nonCannabisSalesMinor: number;
  cannabisLineCount: number;
  nonCannabisLineCount: number;
};

/**
 * Aggregate LIQ-1295 Box 1 from ORDER LINES (GW-014). Box 1 is "Total sales
 * of cannabis products" — merch/accessory lines must NOT contribute, or the
 * 37% excise in Box 5 is computed on non-cannabis revenue (overpayment).
 * Each line's pre-tax base is derived through the shared GW-010 back-out
 * (tax-base-core.preTaxLineBaseMinor), the SAME per-line base the wa-tax
 * report and CCRS Sale.csv use — so the three filings reconcile to the cent.
 */
export function aggregateBox1Lines(
  lines: readonly Box1Line[],
  rates: { combinedSalesRateBps: number; exciseRateBps: number },
): Box1Aggregate {
  let cannabis = 0;
  let nonCannabis = 0;
  let cannabisLines = 0;
  let nonCannabisLines = 0;
  for (const l of lines) {
    const qty = Math.max(0, Math.round(l.quantity ?? 0));
    const unit = Math.max(0, Math.round(l.unitPriceMinorUnits ?? 0));
    if (qty <= 0 || unit <= 0) continue;
    const base = preTaxLineBaseMinor({
      unitPriceMinorUnits: unit,
      quantity: qty,
      isCannabis: l.isCannabis,
      salesExempt: l.salesExempt === true,
      exciseExempt: l.exciseExempt === true,
      combinedSalesRateBps: rates.combinedSalesRateBps,
      exciseRateBps: rates.exciseRateBps,
    });
    if (l.isCannabis) {
      cannabis += base;
      cannabisLines += 1;
    } else {
      nonCannabis += base;
      nonCannabisLines += 1;
    }
  }
  return {
    cannabisSalesMinor: cannabis,
    nonCannabisSalesMinor: nonCannabis,
    cannabisLineCount: cannabisLines,
    nonCannabisLineCount: nonCannabisLines,
  };
}

// ---------------------------------------------------------------------------
// Box 1 net of returns (Fix Phase 2.8 · G-48 · F-15-15)
// ---------------------------------------------------------------------------

/**
 * One customer return as Box 1 sees it (customer_returns, migration 0115).
 * Box 1 is "Total cannabis product sales BEFORE sales & excise tax, after
 * returns & discounts" (header above). Until Fix Phase 2.8 it was built from
 * completed orders only, so a returned cannabis sale stayed in Box 1 and
 * Michael paid 37% excise on money he had handed back (F-15-15).
 *
 * Counted BY RETURN DATE (created_at in the month), as G-48 requires: the sale
 * may sit in an earlier, already-filed month, and that month is not reopened.
 */
export type Box1ReturnRow = {
  /** customer_returns.refund_minor_units - tax-INCLUSIVE cash handed back. */
  refundMinor: number;
  /**
   * customer_returns.excise_minor - excise on the original line. Greater than
   * zero means the line was cannabis and the excise was charged, so the
   * refund carries excise and comes off Box 1.
   */
  exciseMinor: number | null;
  /** customer_returns.sale_type - RecreationalRetail | RecreationalMedical. */
  saleType: string | null;
};

export type Box1ReturnsAggregate = {
  /** Σ pre-tax part of the cannabis refunds in the month, minor units. */
  returnsMinor: number;
  /** Returns that came off Box 1. */
  returnCount: number;
  /** Medical returns with no excise charged: not taken off (they sit in Box 2). */
  medicalExemptSkipped: number;
  /** Non-cannabis returns (no excise, not medical): never in Box 1. */
  nonCannabisSkipped: number;
};

/**
 * Pre-tax part of each cannabis refund, backed out with the SAME divisor as
 * Box 1 itself (tax-base-core, rate = sales + excise), so a full return of a
 * line takes off what that line put in.
 */
export function aggregateBox1Returns(
  rows: readonly Box1ReturnRow[],
  rates: { combinedSalesRateBps: number; exciseRateBps: number },
): Box1ReturnsAggregate {
  let returnsMinor = 0;
  let returnCount = 0;
  let medicalExemptSkipped = 0;
  let nonCannabisSkipped = 0;
  for (const r of rows) {
    const refund = Math.max(0, Math.round(r.refundMinor ?? 0));
    const excise = Math.max(0, Math.round(r.exciseMinor ?? 0));
    if (excise <= 0) {
      if (r.saleType === "RecreationalMedical") medicalExemptSkipped += 1;
      else nonCannabisSkipped += 1;
      continue;
    }
    if (refund <= 0) continue;
    returnsMinor += backOutInclusiveMinor(refund, rates.combinedSalesRateBps + rates.exciseRateBps);
    returnCount += 1;
  }
  return { returnsMinor, returnCount, medicalExemptSkipped, nonCannabisSkipped };
}

/** Box 1 = sales less returns, never below zero (a negative Box 1 is not fileable). */
export function netBox1(grossMinor: number, returnsMinor: number): { netMinor: number; clamped: boolean } {
  const net = Math.round(grossMinor) - Math.round(returnsMinor);
  return net < 0 ? { netMinor: 0, clamped: true } : { netMinor: net, clamped: false };
}

/** Minor units → dollars rounded to 2dp. */
export function toDollars(minor: number): number {
  return Math.round((minor || 0)) / 100;
}

/** Round a dollar amount to 2dp (banker-free, standard half-up). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Compute the LIQ-1295 box values. Box 2 and Box 9 are returned NEGATIVE (as the
 * form requires). The excise formula mirrors the sheet: round(taxable * 0.37, 2).
 */
export function computeExciseReturn(input: ExciseReturnInput): ExciseReturnBoxes {
  const box1 = toDollars(input.cannabisSalesMinor);
  const box2 = -Math.abs(toDollars(input.exemptMedicalSalesMinor));
  const box3 = round2(box1 + box2);
  const box5 = round2(box3 * EXCISE_RATE);
  const box6 = toDollars(input.additionalExciseCollectedMinor ?? 0);
  const box7 = round2(box5 + box6);
  const box8 = toDollars(input.assessedPenaltyMinor ?? 0);
  const box9 = -Math.abs(toDollars(input.approvedCreditsMinor ?? 0));
  const box10 = round2(box7 + box8 + box9);

  return {
    month: input.month,
    year: input.year,
    box1_cannabisSales: box1,
    box2_lessMedical: box2,
    box3_taxable: box3,
    box4_rate: EXCISE_RATE,
    box5_calculatedExcise: box5,
    box6_additionalExcise: box6,
    box7_subtotalExcise: box7,
    box8_assessedPenalty: box8,
    box9_approvedCredits: box9,
    box10_amountToPay: box10,
    noSales: box1 === 0 && box2 === 0,
  };
}

/**
 * The plain tax due date: the 20th of the month AFTER the reporting month. If
 * that lands on a Sat/Sun, roll forward to Monday (holiday calendar not modeled).
 * Returns an ISO date (YYYY-MM-DD).
 */
export function exciseDueDate(month: number, year: number): string {
  // Month after the reporting month (handle December → January rollover).
  let dueMonth = month + 1;
  let dueYear = year;
  if (dueMonth > 12) {
    dueMonth = 1;
    dueYear += 1;
  }
  const d = new Date(Date.UTC(dueYear, dueMonth - 1, 20));
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  if (dow === 6) d.setUTCDate(22); // Sat → Mon
  else if (dow === 0) d.setUTCDate(21); // Sun → Mon
  return d.toISOString().slice(0, 10);
}

/**
 * Reporting-period bounds [from, to) for a month, anchored to the PACIFIC
 * calendar (GW-013). The store operates in Port Orchard, WA, and every other
 * filing artifact (wa-tax report, CCRS Sale.csv) buckets by Pacific time
 * (docs/PERIOD_BASIS.md) — so the LIQ-1295 must too, or a sale completed
 * between 4/5 PM and midnight Pacific on the last day of a month lands in the
 * NEXT month's return while the other reports put it in the CURRENT month.
 *
 * fromISO = the UTC instant of Pacific midnight on the 1st of the month;
 * toISO   = the UTC instant of Pacific midnight on the 1st of the NEXT month.
 * DST is handled by pacificWallTimeToUtcISO (Intl-based, not fixed offsets).
 */
export function monthRange(month: number, year: number): { fromISO: string; toISO: string } {
  const mm = String(month).padStart(2, "0");
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nmm = String(nextMonth).padStart(2, "0");
  return {
    fromISO: pacificWallTimeToUtcISO(`${year}-${mm}-01`, "start"),
    toISO: pacificWallTimeToUtcISO(`${nextYear}-${nmm}-01`, "start"),
  };
}

// ---------------------------------------------------------------------------
// Self-tests (tsx-runnable; PURE).
// ---------------------------------------------------------------------------

export function __runExciseReturnTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    pass += 1;
  };
  const eq = (a: unknown, b: unknown, msg: string) =>
    ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

  // basic: $10,000 sales, no medical
  const r1 = computeExciseReturn({ month: 5, year: 2025, cannabisSalesMinor: 1_000_000, exemptMedicalSalesMinor: 0 });
  eq(r1.box1_cannabisSales, 10000, "box1 $10000");
  eq(r1.box2_lessMedical, -0, "box2 0");
  eq(r1.box3_taxable, 10000, "box3 taxable");
  eq(r1.box4_rate, 0.37, "rate");
  eq(r1.box5_calculatedExcise, 3700, "box5 = 37% of 10000");
  eq(r1.box7_subtotalExcise, 3700, "box7 = box5");
  eq(r1.box10_amountToPay, 3700, "box10 = box7");
  ok(!r1.noSales, "has sales");

  // with medical exemption: $10,000 total incl $2,000 medical
  const r2 = computeExciseReturn({
    month: 6,
    year: 2025,
    cannabisSalesMinor: 1_000_000,
    exemptMedicalSalesMinor: 200_000,
  });
  eq(r2.box2_lessMedical, -2000, "box2 negative 2000");
  eq(r2.box3_taxable, 8000, "taxable 8000");
  eq(r2.box5_calculatedExcise, 2960, "excise = 37% of 8000");

  // additional excise + penalty + credits
  const r3 = computeExciseReturn({
    month: 1,
    year: 2025,
    cannabisSalesMinor: 1_000_000,
    exemptMedicalSalesMinor: 0,
    additionalExciseCollectedMinor: 5_000, // $50
    assessedPenaltyMinor: 7_400, // $74 (2% of 3700)
    approvedCreditsMinor: 10_000, // $100 credit
  });
  eq(r3.box6_additionalExcise, 50, "box6 $50");
  eq(r3.box7_subtotalExcise, 3750, "box7 3700+50");
  eq(r3.box8_assessedPenalty, 74, "box8 $74");
  eq(r3.box9_approvedCredits, -100, "box9 -100");
  eq(r3.box10_amountToPay, 3724, "box10 3750+74-100");

  // no sales
  const r4 = computeExciseReturn({ month: 2, year: 2025, cannabisSalesMinor: 0, exemptMedicalSalesMinor: 0 });
  ok(r4.noSales, "no sales true");
  eq(r4.box10_amountToPay, 0, "nothing to pay");

  // rounding: 37% of 8,123.45 = 3005.6765 → 3005.68
  const r5 = computeExciseReturn({ month: 3, year: 2025, cannabisSalesMinor: 812_345, exemptMedicalSalesMinor: 0 });
  eq(r5.box3_taxable, 8123.45, "taxable 8123.45");
  eq(r5.box5_calculatedExcise, 3005.68, "rounded excise");

  // due date: May 2025 → June 20 2025 (Fri)
  eq(exciseDueDate(5, 2025), "2025-06-20", "May due Jun 20");
  // due date weekend roll: which months land on weekend? Dec 2025 → Jan 20 2026 (Tue)
  eq(exciseDueDate(12, 2025), "2026-01-20", "Dec rolls to next year Jan 20");
  // A month whose 20th is Saturday: find one. Jan 2024 due Feb 20 2024 (Tue) — pick Aug 2024 → Sep 20 2024 (Fri).
  // Mar 2024 → Apr 20 2024 is a Saturday → roll to Apr 22 (Mon).
  eq(exciseDueDate(3, 2024), "2024-04-22", "Apr 20 2024 Sat → Apr 22 Mon");
  // Jun 2024 → Jul 20 2024 is a Saturday → Jul 22.
  eq(exciseDueDate(6, 2024), "2024-07-22", "Jul 20 2024 Sat → Jul 22");

  // month range — PACIFIC calendar bounds (GW-013), expressed as UTC instants.
  // Winter (PST = UTC−8): Pacific midnight is 08:00Z.
  const mr = monthRange(2, 2025);
  eq(mr.fromISO, "2025-02-01T08:00:00.000Z", "feb from = Pacific midnight (PST)");
  eq(mr.toISO, "2025-03-01T08:00:00.000Z", "feb to = Mar 1 Pacific midnight (PST)");
  const mrDec = monthRange(12, 2025);
  eq(mrDec.fromISO, "2025-12-01T08:00:00.000Z", "dec from (PST)");
  eq(mrDec.toISO, "2026-01-01T08:00:00.000Z", "dec to next year Jan 1 (PST)");
  // DST spring-forward: March 2025 starts in PST (08:00Z) but ends in PDT (07:00Z).
  const mrMar = monthRange(3, 2025);
  eq(mrMar.fromISO, "2025-03-01T08:00:00.000Z", "mar from (PST)");
  eq(mrMar.toISO, "2025-04-01T07:00:00.000Z", "mar to (PDT after spring-forward)");
  // DST fall-back: November 2025 starts in PDT (07:00Z) and ends in PST (08:00Z).
  const mrNov = monthRange(11, 2025);
  eq(mrNov.fromISO, "2025-11-01T07:00:00.000Z", "nov from (PDT)");
  eq(mrNov.toISO, "2025-12-01T08:00:00.000Z", "nov to (PST after fall-back)");
  // The GW-013 scenario itself: a sale completed 2025-05-31 at 9:00 PM Pacific
  // (= 2025-06-01T04:00:00Z, ALREADY June in UTC) must fall INSIDE May's
  // [from, to) window — the old Date.UTC bounds pushed it into June.
  const mrMay = monthRange(5, 2025);
  const eveningSale = "2025-06-01T04:00:00.000Z"; // 9 PM May 31 Pacific
  ok(eveningSale >= mrMay.fromISO && eveningSale < mrMay.toISO, "9 PM month-end sale stays in May (GW-013)");
  const mrJun = monthRange(6, 2025);
  ok(!(eveningSale >= mrJun.fromISO && eveningSale < mrJun.toISO), "…and is NOT in June");

  // -------------------------------------------------------------------------
  // aggregateBox1Lines (GW-014): only CANNABIS lines feed Box 1, each backed
  // out to its pre-tax base through the shared GW-010 divisor.
  // -------------------------------------------------------------------------
  const RATES = { combinedSalesRateBps: 930, exciseRateBps: 3700 };

  // GW-010's worked example: $10.00 cannabis line → pre-tax base $6.84.
  const a1 = aggregateBox1Lines(
    [{ unitPriceMinorUnits: 1000, quantity: 1, isCannabis: true }],
    RATES,
  );
  eq(a1.cannabisSalesMinor, 684, "cannabis $10 line → base 684");
  eq(a1.nonCannabisSalesMinor, 0, "no non-cannabis");
  eq(a1.cannabisLineCount, 1, "one cannabis line");

  // The GW-014 scenario: cannabis flower + a $15 t-shirt + a $5 lighter.
  // Box 1 must contain ONLY the flower's base; merch is reported separately.
  const a2 = aggregateBox1Lines(
    [
      { unitPriceMinorUnits: 3500, quantity: 2, isCannabis: true }, // $70 flower
      { unitPriceMinorUnits: 1500, quantity: 1, isCannabis: false }, // t-shirt
      { unitPriceMinorUnits: 500, quantity: 1, isCannabis: false }, // lighter
    ],
    RATES,
  );
  // flower: round(7000 × 10000/14630) = 4785; shirt: round(1500/1.093) = 1372; lighter: round(500/1.093) = 457
  eq(a2.cannabisSalesMinor, 4785, "Box 1 = flower base only (4785)");
  eq(a2.nonCannabisSalesMinor, 1372 + 457, "merch tracked separately (1829)");
  eq(a2.cannabisLineCount, 1, "one cannabis line");
  eq(a2.nonCannabisLineCount, 2, "two merch lines");

  // Exemptions change the back-out rate: an excise-exempt cannabis line only
  // has the 9.3% sales tax inside its stored price.
  const a3 = aggregateBox1Lines(
    [{ unitPriceMinorUnits: 1093, quantity: 1, isCannabis: true, exciseExempt: true }],
    RATES,
  );
  eq(a3.cannabisSalesMinor, 1000, "excise-exempt back-out uses 9.3% only");
  // Fully exempt: the stored price IS the base.
  const a4 = aggregateBox1Lines(
    [{ unitPriceMinorUnits: 800, quantity: 1, isCannabis: true, salesExempt: true, exciseExempt: true }],
    RATES,
  );
  eq(a4.cannabisSalesMinor, 800, "fully exempt line: stored price is the base");

  // Garbage in, zero out: zero/negative qty or price never contributes.
  const a5 = aggregateBox1Lines(
    [
      { unitPriceMinorUnits: 1000, quantity: 0, isCannabis: true },
      { unitPriceMinorUnits: -500, quantity: 2, isCannabis: true },
      { unitPriceMinorUnits: 0, quantity: 3, isCannabis: false },
    ],
    RATES,
  );
  eq(a5.cannabisSalesMinor, 0, "zero-qty and negative-price lines ignored");
  eq(a5.cannabisLineCount + a5.nonCannabisLineCount, 0, "nothing counted");

  // Reconciliation identity (what an auditor cross-checks): Box 1 must equal
  // the wa-tax report's cannabisBaseMinor for the same lines. Both call
  // preTaxLineBaseMinor line-by-line with identical inputs, so equality is
  // structural — assert it anyway on a mixed basket.
  const basket: Box1Line[] = [
    { unitPriceMinorUnits: 4500, quantity: 1, isCannabis: true },
    { unitPriceMinorUnits: 1200, quantity: 3, isCannabis: true },
    { unitPriceMinorUnits: 2500, quantity: 1, isCannabis: false },
  ];
  const agg = aggregateBox1Lines(basket, RATES);
  let mirror = 0;
  for (const l of basket) {
    if (!l.isCannabis) continue;
    mirror += preTaxLineBaseMinor({
      unitPriceMinorUnits: l.unitPriceMinorUnits,
      quantity: l.quantity,
      isCannabis: true,
      combinedSalesRateBps: RATES.combinedSalesRateBps,
      exciseRateBps: RATES.exciseRateBps,
    });
  }
  eq(agg.cannabisSalesMinor, mirror, "Box 1 ≡ Σ per-line wa-tax bases (reconciliation identity)");

  // Fix Phase 2.8 (G-48): returns come off Box 1 by return date.
  const rr = aggregateBox1Returns(
    [
      { refundMinor: 1000, exciseMinor: 253, saleType: "RecreationalRetail" }, // $10 cannabis -> 684
      { refundMinor: 1093, exciseMinor: 0, saleType: "RecreationalRetail" }, // accessory: skipped
      { refundMinor: 1093, exciseMinor: 0, saleType: "RecreationalMedical" }, // exempt medical: skipped
      { refundMinor: 0, exciseMinor: 253, saleType: "RecreationalRetail" }, // nothing handed back
    ],
    RATES,
  );
  eq(rr.returnsMinor, 684, "cannabis $10 refund takes 684 off Box 1 (same base a $10 sale adds)");
  eq(rr.returnCount, 1, "one return counted");
  eq(rr.nonCannabisSkipped, 1, "accessory return skipped");
  eq(rr.medicalExemptSkipped, 1, "exempt medical return skipped");
  eq(netBox1(10000, 684), { netMinor: 9316, clamped: false }, "net Box 1");
  eq(netBox1(500, 684), { netMinor: 0, clamped: true }, "never below zero");

  console.log(`excise-return-core: ${pass} assertions passed`);
}
