/**
 * tests/compliance/wa-tax.test.ts  (S-14 / GAP M-11)
 *
 * Excise + sales-tax math (RCW 69.50.535 — 37% cannabis excise; WAC
 * 314-55-090(2) — medical exemption). Exercises the PURE functions in
 * src/lib/reports/tax.ts that every tax/COGS report funnels through.
 * All money in MINOR UNITS.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_TAX_SETTINGS,
  applyBps,
  backOutTaxInclusive,
  combinedSalesRateBps,
  computeCartTax,
  computeLineTax,
  detectTaxInclusive,
  effectiveTaxRateBps,
  normalizeTaxableBase,
  type TaxSettings,
} from "@/lib/reports/tax";

const REC: TaxSettings = { ...DEFAULT_TAX_SETTINGS }; // no medical endorsement
const MED: TaxSettings = { ...DEFAULT_TAX_SETTINGS, medicalEndorsement: true };

describe("statutory defaults", () => {
  it("excise defaults to exactly 37% (RCW 69.50.535)", () => {
    expect(DEFAULT_TAX_SETTINGS.exciseRateBps).toBe(3700);
  });
  it("combined sales rate = state 6.5% + local 2.8% = 9.3%", () => {
    expect(combinedSalesRateBps(DEFAULT_TAX_SETTINGS)).toBe(930);
  });
});

describe("computeLineTax — recreational cannabis", () => {
  it("$100.00 base ⇒ $9.30 sales tax + $37.00 excise", () => {
    const t = computeLineTax({ taxableBaseMinor: 10000, isCannabis: true }, REC);
    expect(t.salesTaxMinor).toBe(930);
    expect(t.exciseTaxMinor).toBe(3700);
    expect(t.totalTaxMinor).toBe(4630);
  });
  it("rounds to the nearest cent ($34.18 base ⇒ excise $12.65)", () => {
    const t = computeLineTax({ taxableBaseMinor: 3418, isCannabis: true }, REC);
    expect(t.exciseTaxMinor).toBe(Math.round((3418 * 3700) / 10000)); // 1265
    expect(t.exciseTaxMinor).toBe(1265);
    expect(t.salesTaxMinor).toBe(318);
  });
});

describe("computeLineTax — non-cannabis", () => {
  it("sales tax only, never excise", () => {
    const t = computeLineTax({ taxableBaseMinor: 10000, isCannabis: false }, REC);
    expect(t.salesTaxMinor).toBe(930);
    expect(t.exciseTaxMinor).toBe(0);
  });
});

describe("computeLineTax — medical exemption (WAC 314-55-090(2))", () => {
  it("medical + endorsement ⇒ ZERO sales tax and ZERO excise", () => {
    const t = computeLineTax(
      { taxableBaseMinor: 10000, isCannabis: true, medical: true },
      MED,
    );
    expect(t).toEqual({ salesTaxMinor: 0, exciseTaxMinor: 0, totalTaxMinor: 0 });
  });
  it("medical WITHOUT the endorsement is still fully taxed (no silent exemption)", () => {
    const t = computeLineTax(
      { taxableBaseMinor: 10000, isCannabis: true, medical: true },
      REC,
    );
    expect(t.exciseTaxMinor).toBe(3700);
    expect(t.salesTaxMinor).toBe(930);
  });
});

describe("computeCartTax — mixed cart", () => {
  it("sums per-line taxes; medical-exempt lines contribute zero", () => {
    const totals = computeCartTax(
      [
        { taxableBaseMinor: 10000, isCannabis: true }, // rec cannabis
        { taxableBaseMinor: 5000, isCannabis: false }, // merch
        { taxableBaseMinor: 10000, isCannabis: true, medical: true }, // exempt
      ],
      MED,
    );
    expect(totals.taxableBaseMinor).toBe(25000);
    expect(totals.salesTaxMinor).toBe(930 + 465 + 0);
    expect(totals.exciseTaxMinor).toBe(3700);
    expect(totals.grandTotalMinor).toBe(25000 + 930 + 465 + 3700);
  });
});

describe("effective rate & tax-inclusive back-out", () => {
  it("effective rate: cannabis 46.3%, non-cannabis 9.3%, exempt-medical 0%", () => {
    expect(effectiveTaxRateBps(REC, { isCannabis: true })).toBe(4630);
    expect(effectiveTaxRateBps(REC, { isCannabis: false })).toBe(930);
    expect(effectiveTaxRateBps(MED, { isCannabis: true, medical: true })).toBe(0);
  });
  it("backs the pre-tax base out of a tax-inclusive gross (gross $50.00 cannabis)", () => {
    const base = backOutTaxInclusive(5000, 4630);
    expect(base).toBe(Math.round((5000 * 10000) / 14630)); // 3418
    expect(base).toBe(3418);
    // Round trip within a cent: base + taxes ≈ gross.
    const t = computeLineTax({ taxableBaseMinor: base, isCannabis: true }, REC);
    expect(Math.abs(base + t.totalTaxMinor - 5000)).toBeLessThanOrEqual(1);
  });
  it("zero effective rate returns the gross unchanged", () => {
    expect(backOutTaxInclusive(5000, 0)).toBe(5000);
  });
});

describe("normalizeTaxableBase — the single choke point", () => {
  it("pre_tax mode returns the stored base unchanged", () => {
    expect(normalizeTaxableBase(3418, REC, { isCannabis: true })).toBe(3418);
  });
  it("tax_inclusive mode backs the tax out", () => {
    const s: TaxSettings = { ...REC, taxBaseMode: "tax_inclusive" };
    expect(normalizeTaxableBase(5000, s, { isCannabis: true })).toBe(3418);
  });
  it("auto mode honors the resolvedInclusive hint and defaults to pre-tax", () => {
    const s: TaxSettings = { ...REC, taxBaseMode: "auto" };
    expect(normalizeTaxableBase(5000, s, { isCannabis: true, resolvedInclusive: true })).toBe(3418);
    expect(normalizeTaxableBase(5000, s, { isCannabis: true })).toBe(5000);
  });
});

describe("detectTaxInclusive heuristic", () => {
  it("total == subtotal with tax charged ⇒ inclusive", () => {
    expect(
      detectTaxInclusive({ subtotalMinor: 5000, estimatedTaxMinor: 1582, totalMinor: 5000 }),
    ).toBe(true);
  });
  it("total == subtotal + tax ⇒ pre-tax", () => {
    expect(
      detectTaxInclusive({ subtotalMinor: 3418, estimatedTaxMinor: 1582, totalMinor: 5000 }),
    ).toBe(false);
  });
  it("ambiguous (zero tax) ⇒ null", () => {
    expect(
      detectTaxInclusive({ subtotalMinor: 5000, estimatedTaxMinor: 0, totalMinor: 5000 }),
    ).toBe(null);
  });
});

describe("applyBps rounding", () => {
  it("rounds half-up at the cent boundary", () => {
    expect(applyBps(1, 3700) /* 0.37 cents */).toBe(0);
    expect(applyBps(2, 3700) /* 0.74 cents */).toBe(1);
    expect(applyBps(3, 3700) /* 1.11 cents */).toBe(1);
  });
});
