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

/** Reporting-period UTC bounds [from, to) for a month. */
export function monthRange(month: number, year: number): { fromISO: string; toISO: string } {
  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const to = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1, 0, 0, 0));
  return { fromISO: from.toISOString(), toISO: to.toISOString() };
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

  // month range
  const mr = monthRange(2, 2025);
  eq(mr.fromISO.slice(0, 10), "2025-02-01", "feb from");
  eq(mr.toISO.slice(0, 10), "2025-03-01", "feb to");
  const mrDec = monthRange(12, 2025);
  eq(mrDec.toISO.slice(0, 10), "2026-01-01", "dec to next year");

  console.log(`excise-return-core: ${pass} assertions passed`);
}
