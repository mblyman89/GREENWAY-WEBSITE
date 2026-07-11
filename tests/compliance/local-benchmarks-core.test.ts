/**
 * tests/compliance/local-benchmarks-core.test.ts — Task H S6.
 *
 * Covers the PURE competitor/area shaping for Reports → Local Benchmarks:
 * roster joins (tradename/area resolution, honest fallbacks), self exclusion,
 * junk coercion (never a fabricated price), deterministic ordering, and the
 * labeled median-of-medians area proxy.
 */
import { describe, it, expect } from "vitest";
import {
  buildLocalBenchmarks,
  type CompetitorStatLike,
  type RosterEntryLike,
} from "@/lib/discovery/local-benchmarks-core";

function stat(overrides: Partial<CompetitorStatLike> & { license_number: string }): CompetitorStatLike {
  return {
    name: "SOME LLC",
    dba: "Some Store",
    city: "Port Orchard",
    retail_units: 100,
    retail_revenue_minor: 500_000,
    retail_line_count: 80,
    price_sample_size: 80,
    price_min_minor: 500,
    price_p25_minor: 1500,
    price_median_minor: 2500,
    price_p75_minor: 3500,
    price_max_minor: 9000,
    price_avg_minor: 2600,
    by_type: [{ inventoryType: "Usable Marijuana", units: 60, revenueMinor: 300_000 }],
    top_products: [
      {
        productName: "Blue Dream 3.5g",
        inventoryType: "Usable Marijuana",
        units: 30,
        revenueMinor: 90_000,
        medianUnitPriceMinor: 3000,
      },
    ],
    ...overrides,
  };
}

const ROSTER: RosterEntryLike[] = [
  { license_number: "111111", tradename: "Clear Choice Tacoma", area: "tacoma", city: "Tacoma", is_self: false },
  { license_number: "222222", tradename: "PO Store A", area: "port_orchard", city: "Port Orchard", is_self: false },
  { license_number: "333333", tradename: "PO Store B", area: "port_orchard", city: "Port Orchard", is_self: false },
  { license_number: "413541", tradename: "Greenway Marijuana", area: "port_orchard", city: "Port Orchard", is_self: true },
];

describe("buildLocalBenchmarks", () => {
  it("joins roster tradename/area and maps price bands + volume", () => {
    const { competitors } = buildLocalBenchmarks([stat({ license_number: "111111" })], ROSTER);
    expect(competitors).toHaveLength(1);
    const c = competitors[0];
    expect(c.tradename).toBe("Clear Choice Tacoma");
    expect(c.area).toBe("tacoma");
    expect(c.priceP25Minor).toBe(1500);
    expect(c.priceMedianMinor).toBe(2500);
    expect(c.priceP75Minor).toBe(3500);
    expect(c.retailUnits).toBe(100);
    expect(c.retailRevenueMinor).toBe(500_000);
    expect(c.topProducts[0].productName).toBe("Blue Dream 3.5g");
  });

  it("falls back to dba, then name, then 'License <n>' for unknown licenses", () => {
    const { competitors } = buildLocalBenchmarks(
      [
        stat({ license_number: "900001" }), // dba present
        stat({ license_number: "900002", dba: null }), // name only
        stat({ license_number: "900003", dba: null, name: null }), // neither
      ],
      ROSTER,
    );
    const byLic = new Map(competitors.map((c) => [c.licenseNumber, c]));
    expect(byLic.get("900001")?.tradename).toBe("Some Store");
    expect(byLic.get("900002")?.tradename).toBe("SOME LLC");
    expect(byLic.get("900003")?.tradename).toBe("License 900003");
    // Unknown licenses land in the "other" area bucket, never a guessed area.
    expect(byLic.get("900001")?.area).toBe("other");
  });

  it("excludes self even if a stat row sneaks in (belt and braces)", () => {
    const { competitors, areas } = buildLocalBenchmarks(
      [stat({ license_number: "413541" }), stat({ license_number: "222222" })],
      ROSTER,
    );
    expect(competitors.map((c) => c.licenseNumber)).toEqual(["222222"]);
    expect(areas.find((a) => a.area === "port_orchard")?.storeCount).toBe(1);
  });

  it("never fabricates prices: null/negative/NaN bands become null, junk counts → 0", () => {
    const { competitors } = buildLocalBenchmarks(
      [
        stat({
          license_number: "111111",
          price_median_minor: null,
          price_p25_minor: -5,
          price_p75_minor: Number.NaN,
          price_avg_minor: null,
          retail_units: Number.NaN,
          retail_revenue_minor: -100,
          price_sample_size: -3,
        }),
      ],
      ROSTER,
    );
    const c = competitors[0];
    expect(c.priceMedianMinor).toBeNull();
    expect(c.priceP25Minor).toBeNull();
    expect(c.priceP75Minor).toBeNull();
    expect(c.priceAvgMinor).toBeNull();
    expect(c.retailUnits).toBe(0);
    expect(c.retailRevenueMinor).toBe(0);
    expect(c.priceSampleSize).toBe(0);
  });

  it("orders competitors by revenue desc, then lines desc, then tradename asc", () => {
    const { competitors } = buildLocalBenchmarks(
      [
        stat({ license_number: "222222", retail_revenue_minor: 100, retail_line_count: 5 }),
        stat({ license_number: "333333", retail_revenue_minor: 100, retail_line_count: 9 }),
        stat({ license_number: "111111", retail_revenue_minor: 900 }),
      ],
      ROSTER,
    );
    expect(competitors.map((c) => c.licenseNumber)).toEqual(["111111", "333333", "222222"]);
  });

  it("area rollup is the median of store medians (labeled proxy) with summed volume", () => {
    const { areas } = buildLocalBenchmarks(
      [
        stat({ license_number: "222222", price_median_minor: 2000, price_avg_minor: 2000, retail_units: 10, retail_revenue_minor: 100, retail_line_count: 4 }),
        stat({ license_number: "333333", price_median_minor: 3000, price_avg_minor: 4000, retail_units: 20, retail_revenue_minor: 300, retail_line_count: 6 }),
        stat({ license_number: "111111", price_median_minor: 9999 }),
      ],
      ROSTER,
    );
    const po = areas.find((a) => a.area === "port_orchard");
    expect(po).toBeDefined();
    expect(po!.storeCount).toBe(2);
    // Nearest-rank median of [2000, 3000] → 2000.
    expect(po!.retailMedianMinor).toBe(2000);
    expect(po!.retailAvgMinor).toBe(3000);
    expect(po!.retailUnits).toBe(30);
    expect(po!.retailRevenueMinor).toBe(400);
    expect(po!.retailLineCount).toBe(10);
    // Stable area order: port_orchard before tacoma.
    expect(areas.map((a) => a.area)).toEqual(["port_orchard", "tacoma"]);
  });

  it("a store with no medians contributes volume but not to the area median", () => {
    const { areas } = buildLocalBenchmarks(
      [
        stat({ license_number: "222222", price_median_minor: null, price_avg_minor: null, retail_units: 50 }),
        stat({ license_number: "333333", price_median_minor: 3000 }),
      ],
      ROSTER,
    );
    const po = areas.find((a) => a.area === "port_orchard")!;
    expect(po.storeCount).toBe(2);
    expect(po.retailMedianMinor).toBe(3000);
    expect(po.retailUnits).toBe(150);
  });

  // --- S7: wholesale sourcing passthrough -----------------------------------

  it("passes wholesale sourcing through with dba→name→id display fallbacks (S7)", () => {
    const { competitors } = buildLocalBenchmarks(
      [
        stat({
          license_number: "111111",
          wholesale_line_count: 42,
          wholesale_spend_minor: 123_456,
          top_suppliers: [
            { licenseeId: "901", licenseNumber: "777777", name: "A LLC", dba: "A FARMS", lineCount: 30, spendMinor: 100_000 },
            { licenseeId: "902", licenseNumber: null, name: "B LLC", dba: null, lineCount: 10, spendMinor: 20_000 },
            { licenseeId: "903", licenseNumber: null, name: null, dba: null, lineCount: 2, spendMinor: 3_456 },
          ],
        }),
      ],
      ROSTER,
    );
    const c = competitors[0];
    expect(c.wholesaleLineCount).toBe(42);
    expect(c.wholesaleSpendMinor).toBe(123_456);
    expect(c.topSuppliers.map((s) => s.displayName)).toEqual(["A FARMS", "B LLC", "Licensee 903"]);
    expect(c.topSuppliers[0].licenseNumber).toBe("777777");
    expect(c.topSuppliers[0].spendMinor).toBe(100_000);
  });

  it("defaults to zero/empty sourcing for pre-0107 rows (S7, never guessed)", () => {
    // A row persisted before migration 0107 has none of the S7 fields.
    const { competitors } = buildLocalBenchmarks([stat({ license_number: "111111" })], ROSTER);
    const c = competitors[0];
    expect(c.wholesaleLineCount).toBe(0);
    expect(c.wholesaleSpendMinor).toBe(0);
    expect(c.topSuppliers).toEqual([]);
  });

  it("coerces junk sourcing numbers and drops suppliers without an id (S7)", () => {
    const { competitors } = buildLocalBenchmarks(
      [
        stat({
          license_number: "111111",
          wholesale_line_count: Number.NaN,
          wholesale_spend_minor: -5,
          top_suppliers: [
            { licenseeId: "", licenseNumber: null, name: "NO ID LLC", dba: null, lineCount: 1, spendMinor: 100 },
            { licenseeId: "901", licenseNumber: null, name: "OK LLC", dba: null, lineCount: Number.NaN, spendMinor: -10 },
          ],
        }),
      ],
      ROSTER,
    );
    const c = competitors[0];
    expect(c.wholesaleLineCount).toBe(0);
    expect(c.wholesaleSpendMinor).toBe(0);
    expect(c.topSuppliers).toHaveLength(1);
    expect(c.topSuppliers[0].displayName).toBe("OK LLC");
    expect(c.topSuppliers[0].lineCount).toBe(0);
    expect(c.topSuppliers[0].spendMinor).toBe(0);
  });
});
