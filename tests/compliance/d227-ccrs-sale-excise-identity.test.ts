/**
 * D227 — CCRS Sale.csv: the PRINTED row must satisfy CCRS's excise check.
 *
 * Spec pins:
 *   [G L1374] "CannabisExciseTax must equal 37% of unit price (except medical)"
 *   [G L1377] "CannabisExciseTax does not equal 37% of UnitPrice"
 *   [G L1378] "Only Medical Sales can be 0"
 *   [FAQ L0153-L0160] taxes and discount are for the whole row; QTY 3 x $5.00 - $3.00 -> Other Tax (37%) $4.44
 *
 * Evidence: docs/ccrs-bible/evidence/2026-11-10-preprod (CCRS refused 2 of 1,332 rows).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ccrsPrintedExciseMinor, ccrsSaleLineMoney, preTaxUnitMinor } from "@/lib/reports/tax-base-core";
import { CCRS_COLUMNS } from "@/lib/compliance/ccrs-batch-core";

const ROOT = path.resolve(__dirname, "../..");
const EV = path.join(ROOT, "docs/ccrs-bible/evidence/2026-11-10-preprod");
const RATES = { combinedSalesRateBps: 930, exciseRateBps: 3700 };
const cents = (s: string) => Math.round(Number(s) * 100);
const REFUSED = new Set(["GWY-AZ3ALV-5a216511", "GWY-7DPS89-c54049ac"]);

function sentRows(): string[][] {
  const lines = readFileSync(path.join(EV, "sent/Sale_413541_20261110101609.csv"), "utf8").split("\r\n").filter(Boolean);
  expect(lines[3].split(",")).toEqual([...CCRS_COLUMNS.Sale]);
  return lines.slice(4).map((l) => l.split(","));
}
const C = (name: string) => CCRS_COLUMNS.Sale.indexOf(name as (typeof CCRS_COLUMNS.Sale)[number]);

describe("what CCRS checks, read from the 2026-11-10 PREprod answer", () => {
  it("the error file names exactly the two rows, with the never-before-seen text", () => {
    const err = readFileSync(path.join(EV, "errors/Sale__20261110T104153061.csv"), "utf8").split("\r\n").filter(Boolean);
    expect(err).toHaveLength(3);
    expect(err[0].split(",").at(-1)).toBe("ErrorMessage");
    for (const l of err.slice(1)) expect(l.endsWith("Cannabis Excise Tax does not equal 37% of Unit Price")).toBe(true);
    expect(new Set(err.slice(1).map((l) => l.split(",")[12]))).toEqual(REFUSED);
  });

  it("every ACCEPTED row passes round_half_up(37% x (Qty x UnitPrice - Discount)) exactly, and the two refused rows do not", () => {
    const rows = sentRows();
    expect(rows).toHaveLength(1332);
    let accepted = 0;
    for (const r of rows) {
      const want = ccrsPrintedExciseMinor(Number(r[C("Quantity")]), cents(r[C("UnitPrice")]), cents(r[C("Discount")]));
      const got = cents(r[C("CannabisExciseTax")]);
      if (REFUSED.has(r[C("SaleDetailExternalIdentifier")])) expect(got - want, r[12]).toBe(1);
      else {
        expect(got, r[12]).toBe(want);
        accepted += 1;
      }
    }
    expect(accepted).toBe(1330);
  });
});

describe("D227: ccrsSaleLineMoney prints rows CCRS accepts", () => {
  it("the two real lines ($18.00 x 3 and x 2) now print 12.31 with a 2c / 1c discount, taxes unchanged", () => {
    const m3 = ccrsSaleLineMoney({ soldUnitMinorUnits: 1800, regularUnitMinorUnits: 1800, quantity: 3, isCannabis: true, ...RATES });
    expect(m3).toMatchObject({ unitPriceMinor: 1231, discountMinor: 2, baseMinor: 3691, salesTaxMinor: 343, exciseMinor: 1366, unitLifted: true });
    const m2 = ccrsSaleLineMoney({ soldUnitMinorUnits: 1800, regularUnitMinorUnits: 1800, quantity: 2, isCannabis: true, ...RATES });
    expect(m2).toMatchObject({ unitPriceMinor: 1231, discountMinor: 1, baseMinor: 2461, salesTaxMinor: 229, exciseMinor: 911, unitLifted: true });
    // Taxes equal what the refused file reported (what the register collected).
    expect([m3.salesTaxMinor, m3.exciseMinor, m2.salesTaxMinor, m2.exciseMinor]).toEqual([343, 1366, 229, 911]);
  });

  it("rows that were already right stay byte-identical (every accepted single-unit row's money is unchanged)", () => {
    // A qty-1 row: UnitPrice x 1 == base always, so nothing lifts.
    for (let p = 1; p <= 30000; p += 1) {
      const m = ccrsSaleLineMoney({ soldUnitMinorUnits: p, regularUnitMinorUnits: p, quantity: 1, isCannabis: true, ...RATES });
      if (m.unitLifted || m.unitPriceMinor !== preTaxUnitMinor({ unitPriceMinorUnits: p, isCannabis: true, ...RATES })) {
        throw new Error(`qty 1 changed at ${p}`);
      }
    }
  });

  it("sweep: identity and printed 37% hold for every price to $300 and qty 1-12; lift is at most 1c", () => {
    let lifted = 0;
    for (let p = 1; p <= 30000; p += 3) {
      for (let q = 1; q <= 12; q += 1) {
        const m = ccrsSaleLineMoney({ soldUnitMinorUnits: p, regularUnitMinorUnits: p, quantity: q, isCannabis: true, ...RATES });
        if (q * m.unitPriceMinor - m.discountMinor !== m.baseMinor) throw new Error(`identity ${p}x${q}`);
        if (ccrsPrintedExciseMinor(q, m.unitPriceMinor, m.discountMinor) !== m.exciseMinor) throw new Error(`37% ${p}x${q}`);
        if (m.unitPriceMinor - preTaxUnitMinor({ unitPriceMinorUnits: p, isCannabis: true, ...RATES }) > 1) throw new Error(`lift ${p}x${q}`);
        if (m.discountMinor < 0) throw new Error(`neg ${p}x${q}`);
        if (m.unitLifted) lifted += 1;
      }
    }
    expect(lifted).toBeGreaterThan(0);
  });

  it("discounted lines: the identity holds and a lift never happens when the shelf price already covers the base", () => {
    for (let reg = 200; reg <= 12000; reg += 53) {
      for (const pct of [0.9, 0.8, 0.5]) {
        const sold = Math.round(reg * pct);
        for (let q = 1; q <= 6; q += 1) {
          const m = ccrsSaleLineMoney({ soldUnitMinorUnits: sold, regularUnitMinorUnits: reg, quantity: q, isCannabis: true, ...RATES });
          expect(q * m.unitPriceMinor - m.discountMinor).toBe(m.baseMinor);
          expect(ccrsPrintedExciseMinor(q, m.unitPriceMinor, m.discountMinor)).toBe(m.exciseMinor);
        }
      }
    }
  });

  it("medical / excise-exempt rows report 0 excise and keep the shelf UnitPrice [G L1378]", () => {
    const m = ccrsSaleLineMoney({ soldUnitMinorUnits: 1000, regularUnitMinorUnits: 1463, quantity: 3, isCannabis: true, salesExempt: true, exciseExempt: true, ...RATES });
    expect(m).toMatchObject({ exciseMinor: 0, salesTaxMinor: 0, unitLifted: false, unitPriceMinor: 1000 });
  });

  it("non-cannabis lines carry no excise and are never lifted", () => {
    const m = ccrsSaleLineMoney({ soldUnitMinorUnits: 1093, regularUnitMinorUnits: 1093, quantity: 3, isCannabis: false, ...RATES });
    expect(m).toMatchObject({ exciseMinor: 0, unitLifted: false });
  });

  it("FAQ example [FAQ L0155-L0160]: 3 x $5.00 - $3.00 -> $4.44", () => {
    expect(ccrsPrintedExciseMinor(3, 500, 300)).toBe(444);
  });
});

describe("D227: both Sale money writers use the one helper", () => {
  const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
  it("ccrs-sales.ts and the return snapshot (disposition.ts) call ccrsSaleLineMoney, and neither recomputes Discount by hand", () => {
    for (const f of ["src/lib/compliance/ccrs-sales.ts", "src/lib/inventory/disposition.ts"]) {
      const s = read(f);
      expect(s, f).toContain("ccrsSaleLineMoney({");
      expect(s, f).not.toMatch(/Math\.max\(0,\s*\w+\s*\*\s*qty\s*-\s*baseCents\)/);
      expect(s, f).not.toMatch(/applyBps\(baseCents/);
    }
  });
});
