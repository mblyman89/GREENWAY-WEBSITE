/**
 * tests/compliance/ccrs-monthly-rollups.test.ts
 *
 * S3 coverage for the monthly-zip transformer's server boundary:
 * sanitizeAggregationResult — the structural validator that stands between the
 * browser-posted rollup JSON and the database. NEVER GUESS: a malformed
 * payload must be rejected whole; a valid payload must round-trip losslessly.
 * (persistAggregationResult itself is DB glue, exercised in preview — the
 * validation gate is the part that must be airtight.)
 */
import { describe, it, expect } from "vitest";

import { sanitizeAggregationResult } from "@/lib/discovery/market-rollups";
import { CcrsAggregator } from "@/lib/discovery/ccrs-extract/aggregate";

function validResult(): unknown {
  // Built by the REAL aggregator so the fixture can never drift from the
  // transformer's actual output shape.
  const agg = new CcrsAggregator({
    selfLicenseNumber: "413541",
    trackedLicenseNumbers: ["415229"],
  });
  agg.addLicensee({
    licenseeId: "900",
    licenseNumber: "415229",
    name: "POT ZONE PO LLC",
    dba: "POT ZONE",
    status: "Active",
    city: "PORT ORCHARD",
    county: "KITSAP",
  });
  agg.addStrain({ strainId: "77", name: "Blue Dream" });
  agg.addProduct({
    productId: "5001",
    licenseeId: null,
    inventoryType: "Usable Marijuana",
    name: "Phat Panda | Grape Ape 3.5g",
    unitWeightGrams: 3.5,
  });
  agg.addInventory({ inventoryId: "9001", licenseeId: null, productId: "5001", strainId: "77" });
  agg.addSaleHeader({
    saleHeaderId: "327733901",
    sellerLicenseeId: "900",
    buyerLicenseeId: null,
    saleType: "retail",
    saleDate: "2026-05-10",
  });
  agg.addSaleDetail({
    saleHeaderId: "327733901",
    inventoryId: "9001",
    quantity: 3,
    unitPriceMinor: 2500,
    discountMinor: 0,
    isDeleted: false,
  });
  // Serialize/deserialize like the real client→server hop.
  return JSON.parse(JSON.stringify(agg.result()));
}

describe("sanitizeAggregationResult", () => {
  it("round-trips a real aggregator payload losslessly", () => {
    const out = sanitizeAggregationResult(validResult());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const r = out.result;
    expect(r.periodStart).toBe("2026-05-10");
    expect(r.periodEnd).toBe("2026-05-10");
    expect(r.totals.saleDetailRows).toBe(1);
    expect(r.totals.retailLines).toBe(1);
    expect(r.totals.attributedRetailLines).toBe(1);
    // Statewide: overall + type + brand + strain (retail).
    const overall = r.statewide.find((b) => b.scope === "overall" && b.saleClass === "retail");
    expect(overall?.unitPrice?.medianMinor).toBe(2500);
    expect(overall?.revenueMinor).toBe(7500);
    // Competitor preserved with price summary and top products.
    expect(r.competitors).toHaveLength(1);
    expect(r.competitors[0].licenseNumber).toBe("415229");
    expect(r.competitors[0].retail.unitPrice?.sampleSize).toBe(1);
    expect(r.competitors[0].retail.topProducts[0].productName).toBe("Phat Panda | Grape Ape 3.5g");
    // Signals preserved with both bands.
    const mover = r.signals.find((s) => s.kind === "statewide_mover");
    expect(mover?.p25UnitPriceMinor).toBe(2500);
    expect(mover?.medianUnitPriceMinor).toBe(2500);
  });

  it("rejects non-object payloads", () => {
    for (const bad of [null, undefined, 42, "x", [], true]) {
      const out = sanitizeAggregationResult(bad);
      expect(out.ok).toBe(false);
    }
  });

  it("rejects payloads missing the rollup arrays", () => {
    const out = sanitizeAggregationResult({ totals: {}, statewide: [] });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/missing/i);
  });

  it("rejects malformed statewide rows (bad scope / class / key)", () => {
    const base = validResult() as Record<string, unknown>;
    const withBadRow = {
      ...base,
      statewide: [
        { scope: "bogus", scopeKey: "x", saleClass: "retail", units: 1, revenueMinor: 1 },
      ],
    };
    expect(sanitizeAggregationResult(withBadRow).ok).toBe(false);

    const withBadClass = {
      ...base,
      statewide: [{ scope: "type", scopeKey: "x", saleClass: "sideways", units: 1, revenueMinor: 1 }],
    };
    expect(sanitizeAggregationResult(withBadClass).ok).toBe(false);

    const withNoKey = {
      ...base,
      statewide: [{ scope: "type", scopeKey: "", saleClass: "retail", units: 1, revenueMinor: 1 }],
    };
    expect(sanitizeAggregationResult(withNoKey).ok).toBe(false);
  });

  it("rejects competitor rows without license identifiers", () => {
    const base = validResult() as Record<string, unknown>;
    const bad = {
      ...base,
      competitors: [{ licenseNumber: "", licenseeId: "1", retail: {} }],
    };
    expect(sanitizeAggregationResult(bad).ok).toBe(false);
  });

  it("rejects signals with unknown kinds", () => {
    const base = validResult() as Record<string, unknown>;
    const bad = {
      ...base,
      signals: [{ kind: "made_up_mover", units: 1, revenueMinor: 1 }],
    };
    expect(sanitizeAggregationResult(bad).ok).toBe(false);
  });

  it("rejects oversized payloads (defensive caps)", () => {
    const base = validResult() as Record<string, unknown>;
    const row = { scope: "type", scopeKey: "x", saleClass: "retail", units: 1, revenueMinor: 1 };
    const huge = { ...base, statewide: Array.from({ length: 5_001 }, () => ({ ...row })) };
    const out = sanitizeAggregationResult(huge);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/too many/i);
  });

  it("coerces junk numbers/dates to safe values instead of trusting them", () => {
    const base = validResult() as Record<string, unknown>;
    const messy = {
      ...base,
      periodStart: "not-a-date",
      periodEnd: "2026-05-31",
      totals: { saleDetailRows: "9999", retailLines: Number.NaN },
      statewide: [
        {
          scope: "overall",
          scopeKey: "all",
          saleClass: "retail",
          unitPrice: { sampleSize: 0 }, // zero samples → summary must become null
          pricePerGram: "garbage",
          units: "12",
          revenueMinor: 100.7,
        },
      ],
      competitors: [],
      signals: [],
    };
    const out = sanitizeAggregationResult(messy);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.periodStart).toBeNull(); // bad date → null, not guessed
    expect(out.result.periodEnd).toBe("2026-05-31");
    expect(out.result.totals.saleDetailRows).toBe(0); // string → 0, not parsed
    expect(out.result.totals.retailLines).toBe(0); // NaN → 0
    expect(out.result.statewide[0].unitPrice).toBeNull();
    expect(out.result.statewide[0].pricePerGram).toBeNull();
    expect(out.result.statewide[0].units).toBe(0);
    expect(out.result.statewide[0].revenueMinor).toBe(101); // rounded to integer cents
  });

  it("truncates over-long strings instead of storing unbounded keys", () => {
    const base = validResult() as Record<string, unknown>;
    const long = "x".repeat(1000);
    const bad = {
      ...base,
      statewide: [
        { scope: "brand", scopeKey: long, saleClass: "retail", units: 1, revenueMinor: 1 },
      ],
    };
    const out = sanitizeAggregationResult(bad);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.statewide[0].scopeKey.length).toBeLessThanOrEqual(300);
  });
});
