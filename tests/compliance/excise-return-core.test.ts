/**
 * tests/compliance/excise-return-core.test.ts  (GW-013 + GW-014 fix)
 *
 * Vitest mirror for the LIQ-1295 pure core. The embedded self-tests
 * (__runExciseReturnTests) remain the authoritative suite — this file runs
 * them under vitest and adds explicit assertions for the two findings:
 *
 *   GW-013 — monthRange must produce PACIFIC month bounds (a 9 PM sale on the
 *            last day of the month stays in that month), DST-correct.
 *   GW-014 — aggregateBox1Lines must include ONLY cannabis lines in Box 1,
 *            each backed out to its pre-tax base via the shared GW-010 math.
 */
import { describe, expect, it } from "vitest";
import {
  __runExciseReturnTests,
  aggregateBox1Lines,
  computeExciseReturn,
  monthRange,
} from "@/lib/compliance/excise-return-core";
import { preTaxLineBaseMinor } from "@/lib/reports/tax-base-core";

const RATES = { combinedSalesRateBps: 930, exciseRateBps: 3700 };

describe("excise-return-core embedded self-tests", () => {
  it("all embedded assertions pass", () => {
    expect(() => __runExciseReturnTests()).not.toThrow();
  });
});

describe("GW-013 — Pacific month bounds", () => {
  it("winter months bound at 08:00Z (PST)", () => {
    expect(monthRange(1, 2025)).toEqual({
      fromISO: "2025-01-01T08:00:00.000Z",
      toISO: "2025-02-01T08:00:00.000Z",
    });
  });

  it("summer months bound at 07:00Z (PDT)", () => {
    expect(monthRange(7, 2025)).toEqual({
      fromISO: "2025-07-01T07:00:00.000Z",
      toISO: "2025-08-01T07:00:00.000Z",
    });
  });

  it("DST transition months mix offsets correctly", () => {
    // March: starts PST, ends PDT (spring forward).
    expect(monthRange(3, 2025)).toEqual({
      fromISO: "2025-03-01T08:00:00.000Z",
      toISO: "2025-04-01T07:00:00.000Z",
    });
    // November: starts PDT, ends PST (fall back).
    expect(monthRange(11, 2025)).toEqual({
      fromISO: "2025-11-01T07:00:00.000Z",
      toISO: "2025-12-01T08:00:00.000Z",
    });
  });

  it("December rolls to January of the next year", () => {
    const r = monthRange(12, 2025);
    expect(r.toISO).toBe("2026-01-01T08:00:00.000Z");
  });

  it("the finding's scenario: a 9 PM Pacific month-end sale stays in ITS month", () => {
    // 2025-05-31 21:00 Pacific = 2025-06-01T04:00Z — already "June" in UTC.
    const sale = "2025-06-01T04:00:00.000Z";
    const may = monthRange(5, 2025);
    const jun = monthRange(6, 2025);
    expect(sale >= may.fromISO && sale < may.toISO).toBe(true);
    expect(sale >= jun.fromISO && sale < jun.toISO).toBe(false);
  });

  it("consecutive months tile perfectly (no gap, no overlap)", () => {
    for (let m = 1; m <= 11; m++) {
      expect(monthRange(m, 2025).toISO).toBe(monthRange(m + 1, 2025).fromISO);
    }
    expect(monthRange(12, 2025).toISO).toBe(monthRange(1, 2026).fromISO);
  });
});

describe("GW-014 — Box 1 is cannabis lines only, pre-tax", () => {
  it("merch and accessories never reach Box 1", () => {
    const agg = aggregateBox1Lines(
      [
        { unitPriceMinorUnits: 3500, quantity: 2, isCannabis: true }, // $70 flower
        { unitPriceMinorUnits: 1500, quantity: 1, isCannabis: false }, // t-shirt
        { unitPriceMinorUnits: 500, quantity: 1, isCannabis: false }, // lighter
      ],
      RATES,
    );
    // round(7000 × 10000/14630) = 4785
    expect(agg.cannabisSalesMinor).toBe(4785);
    expect(agg.nonCannabisSalesMinor).toBe(1372 + 457);
    expect(agg.cannabisLineCount).toBe(1);
    expect(agg.nonCannabisLineCount).toBe(2);
  });

  it("the excise cascade on the corrected Box 1 (worked example)", () => {
    // A month with ONLY the mixed basket above: Box 1 = $47.85, excise = 37%.
    const boxes = computeExciseReturn({
      month: 5,
      year: 2025,
      cannabisSalesMinor: 4785,
      exemptMedicalSalesMinor: 0,
    });
    expect(boxes.box1_cannabisSales).toBe(47.85);
    expect(boxes.box5_calculatedExcise).toBe(17.7); // round(47.85 × 0.37, 2)
    // The OLD header-subtotal bug would have put ~$66.14 (47.85+18.29) in
    // Box 1 and charged excise on the merch too.
  });

  it("medical exemptions change the back-out rate per line", () => {
    const exciseExemptOnly = aggregateBox1Lines(
      [{ unitPriceMinorUnits: 1093, quantity: 1, isCannabis: true, exciseExempt: true }],
      RATES,
    );
    expect(exciseExemptOnly.cannabisSalesMinor).toBe(1000); // ÷1.093 only
    const fullyExempt = aggregateBox1Lines(
      [{ unitPriceMinorUnits: 800, quantity: 1, isCannabis: true, salesExempt: true, exciseExempt: true }],
      RATES,
    );
    expect(fullyExempt.cannabisSalesMinor).toBe(800); // stored price IS the base
  });

  it("zero/negative quantities and prices are ignored", () => {
    const agg = aggregateBox1Lines(
      [
        { unitPriceMinorUnits: 1000, quantity: 0, isCannabis: true },
        { unitPriceMinorUnits: -500, quantity: 2, isCannabis: true },
        { unitPriceMinorUnits: 0, quantity: 3, isCannabis: false },
      ],
      RATES,
    );
    expect(agg.cannabisSalesMinor).toBe(0);
    expect(agg.cannabisLineCount + agg.nonCannabisLineCount).toBe(0);
  });

  it("reconciliation identity: Box 1 ≡ Σ per-line wa-tax cannabis bases", () => {
    const basket = [
      { unitPriceMinorUnits: 4500, quantity: 1, isCannabis: true },
      { unitPriceMinorUnits: 1200, quantity: 3, isCannabis: true },
      { unitPriceMinorUnits: 999, quantity: 7, isCannabis: true },
      { unitPriceMinorUnits: 2500, quantity: 1, isCannabis: false },
    ];
    const agg = aggregateBox1Lines(basket, RATES);
    const mirror = basket
      .filter((l) => l.isCannabis)
      .reduce(
        (sum, l) =>
          sum +
          preTaxLineBaseMinor({
            unitPriceMinorUnits: l.unitPriceMinorUnits,
            quantity: l.quantity,
            isCannabis: true,
            combinedSalesRateBps: RATES.combinedSalesRateBps,
            exciseRateBps: RATES.exciseRateBps,
          }),
        0,
      );
    expect(agg.cannabisSalesMinor).toBe(mirror);
  });
});
