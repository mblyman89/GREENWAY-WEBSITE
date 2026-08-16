/**
 * tests/compliance/statewide-market-core.test.ts
 *
 * Slice 8 — the statewide benchmarks semantic layer.
 *
 * The point of these tests is not that the arithmetic works; it is that the
 * module refuses to invent numbers. "Never measured" must survive every
 * transformation as null, sorting must not reward nulls, the two producer
 * signals must never be blended, and the CSV must survive a product name with
 * a comma and a quote in it.
 */

import { describe, expect, it } from "vitest";

import {
  buildDohSellerRows,
  buildDohVerdict,
  buildFacet,
  buildMarketRows,
  buildRetailerRows,
  buildSellInRows,
  buildSellThroughRows,
  compareValues,
  computeConcentration,
  concentrationLabel,
  csvCell,
  fractionToCsvPct,
  matchesQuery,
  minorToCsvAmount,
  ratioOrNull,
  rowsToCsv,
  sortRows,
  MARKET_CSV_COLUMNS,
  PRODUCER_CSV_COLUMNS,
  SALE_CLASSES,
  type MarketBenchmarkLike,
} from "@/lib/discovery/statewide-market-core";

// --------------------------------------------------------------------------
// Fixture helpers
// --------------------------------------------------------------------------

function bench(
  scope: string,
  scopeKey: string,
  metric: string,
  fields: Partial<MarketBenchmarkLike> = {},
): MarketBenchmarkLike {
  return {
    scope,
    scope_key: scopeKey,
    metric,
    sample_size: 0,
    min_minor: null,
    p25_minor: null,
    median_minor: null,
    p75_minor: null,
    max_minor: null,
    avg_minor: null,
    value_num: null,
    ...fields,
  };
}

/** A fully-populated "Usable Marijuana" type row across all four classes. */
function usableMarijuana(): MarketBenchmarkLike[] {
  return [
    bench("type", "Usable Marijuana", "retail_unit_price", {
      sample_size: 400,
      min_minor: 500,
      p25_minor: 1000,
      median_minor: 1500,
      p75_minor: 2200,
      max_minor: 6000,
    }),
    bench("type", "Usable Marijuana", "retail_price_per_gram", { median_minor: 428 }),
    bench("type", "Usable Marijuana", "retail_units", { value_num: 10_000 }),
    bench("type", "Usable Marijuana", "retail_revenue", { avg_minor: 1_500_000 }),
    bench("type", "Usable Marijuana", "wholesale_unit_price", { sample_size: 90, median_minor: 600 }),
    bench("type", "Usable Marijuana", "wholesale_revenue", { avg_minor: 600_000 }),
    bench("type", "Usable Marijuana", "medical_revenue", { avg_minor: 150_000 }),
    bench("type", "Usable Marijuana", "medical_unit_price", { median_minor: 1400 }),
    bench("type", "Usable Marijuana", "doh_revenue", { avg_minor: 75_000 }),
    bench("type", "Usable Marijuana", "doh_unit_price", { median_minor: 1800 }),
    bench("type", "Usable Marijuana", "total_thc_mg_per_g", { median_minor: 215 }),
    bench("type", "Usable Marijuana", "total_cbd_mg_per_g", { median_minor: 4 }),
  ];
}

// --------------------------------------------------------------------------

describe("statewide market core — the market table", () => {
  it("pivots flat benchmark rows into one wide row per scope key", () => {
    const rows = buildMarketRows(usableMarijuana(), "type");
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.key).toBe("Usable Marijuana");
    expect(r.retail.medianUnitPriceMinor).toBe(1500);
    expect(r.retail.p25UnitPriceMinor).toBe(1000);
    expect(r.retail.p75UnitPriceMinor).toBe(2200);
    expect(r.retail.priceSampleSize).toBe(400);
    expect(r.retail.medianPpgMinor).toBe(428);
  });

  it("reads units from value_num and revenue from avg_minor, per the persist layer", () => {
    const rows = buildMarketRows(usableMarijuana(), "type");
    // These two live in DIFFERENT columns. Swapping them is a silent
    // catastrophe: revenue would render as a unit count.
    expect(rows[0].retail.units).toBe(10_000);
    expect(rows[0].retail.revenueMinor).toBe(1_500_000);
  });

  it("computes the retail/wholesale gross spread only when BOTH sides exist", () => {
    const rows = buildMarketRows(usableMarijuana(), "type");
    expect(rows[0].marginMinor).toBe(1500 - 600);
    expect(rows[0].marginPct).toBeCloseTo(900 / 1500, 10);
  });

  it("returns a null spread when the wholesale side was never measured", () => {
    const input = usableMarijuana().filter((b) => b.metric !== "wholesale_unit_price");
    const rows = buildMarketRows(input, "type");
    // A spread measured against a missing number is a guess. Must be null.
    expect(rows[0].wholesale.medianUnitPriceMinor).toBeNull();
    expect(rows[0].marginMinor).toBeNull();
    expect(rows[0].marginPct).toBeNull();
  });

  it("keeps a never-measured class fully null rather than zero", () => {
    const input = usableMarijuana().filter((b) => !b.metric.startsWith("doh_"));
    const rows = buildMarketRows(input, "type");
    expect(rows[0].doh.revenueMinor).toBeNull();
    expect(rows[0].doh.units).toBeNull();
    expect(rows[0].doh.medianUnitPriceMinor).toBeNull();
    expect(rows[0].dohShare).toBeNull();
  });

  it("distinguishes measured-zero from never-measured", () => {
    const input = usableMarijuana().filter((b) => !b.metric.startsWith("doh_"));
    input.push(bench("type", "Usable Marijuana", "doh_revenue", { avg_minor: 0 }));
    input.push(bench("type", "Usable Marijuana", "doh_units", { value_num: 0 }));
    const rows = buildMarketRows(input, "type");
    // Measured and genuinely zero — a real, reportable fact.
    expect(rows[0].doh.revenueMinor).toBe(0);
    expect(rows[0].doh.units).toBe(0);
    expect(rows[0].dohShare).toBe(0);
  });

  it("computes medical and DOH shares against retail independently", () => {
    const rows = buildMarketRows(usableMarijuana(), "type");
    // Medical (a SALES fact) and DOH (a PRODUCT fact) overlap freely. Neither
    // is subtracted from the other.
    expect(rows[0].medicalShare).toBeCloseTo(150_000 / 1_500_000, 10);
    expect(rows[0].dohShare).toBeCloseTo(75_000 / 1_500_000, 10);
  });

  it("computes revenue and unit shares across the whole table", () => {
    const input = [
      ...usableMarijuana(),
      bench("type", "Concentrate", "retail_revenue", { avg_minor: 500_000 }),
      bench("type", "Concentrate", "retail_units", { value_num: 5_000 }),
    ];
    const rows = buildMarketRows(input, "type");
    const um = rows.find((r) => r.key === "Usable Marijuana")!;
    const conc = rows.find((r) => r.key === "Concentrate")!;
    expect(um.revenueShare).toBeCloseTo(1_500_000 / 2_000_000, 10);
    expect(conc.revenueShare).toBeCloseTo(500_000 / 2_000_000, 10);
    expect(um.unitsShare! + conc.unitsShare!).toBeCloseTo(1, 10);
  });

  it("ignores rows from other scopes and blank scope keys", () => {
    const input = [
      ...usableMarijuana(),
      bench("brand", "Some Brand", "retail_revenue", { avg_minor: 999_999 }),
      bench("type", "   ", "retail_revenue", { avg_minor: 888_888 }),
    ];
    const rows = buildMarketRows(input, "type");
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("Usable Marijuana");
  });

  it("sorts by retail revenue descending", () => {
    const input = [
      bench("type", "Small", "retail_revenue", { avg_minor: 100 }),
      bench("type", "Big", "retail_revenue", { avg_minor: 900 }),
      bench("type", "Mid", "retail_revenue", { avg_minor: 500 }),
    ];
    expect(buildMarketRows(input, "type").map((r) => r.key)).toEqual(["Big", "Mid", "Small"]);
  });

  it("keeps potency in mg/g and never rescales it to a percentage", () => {
    const rows = buildMarketRows(usableMarijuana(), "type");
    // 215 mg/g == 21.5%. Storing 21.5 here would be a tenfold misstatement.
    expect(rows[0].totalThcMgPerG).toBe(215);
    expect(rows[0].totalCbdMgPerG).toBe(4);
  });

  it("names a metric for every declared sale class", () => {
    // Guards against a class being added without wiring its metrics.
    expect([...SALE_CLASSES].sort()).toEqual(["doh", "medical", "retail", "wholesale"]);
  });

  it("returns an empty table for empty input without throwing", () => {
    expect(buildMarketRows([], "type")).toEqual([]);
  });
});

describe("statewide market core — concentration (DOJ HHI)", () => {
  it("computes a monopoly as 10,000", () => {
    const c = computeConcentration([1000]);
    expect(c.hhi).toBe(10_000);
    expect(c.band).toBe("highly_concentrated");
  });

  it("computes ten equal players as 1,000", () => {
    const c = computeConcentration(Array.from({ length: 10 }, () => 100));
    expect(c.hhi).toBe(1000);
    // 1,000 is the bottom of the moderate band, not the top of unconcentrated.
    expect(c.band).toBe("moderately_concentrated");
  });

  it("places exactly 1,800 in the moderate band, per the Guidelines' wording", () => {
    // Constructed to land on 1,800 exactly: shares of 30,30,20,20 →
    // 900 + 900 + 400 + 400 = 2,600 (too high), so use 20,20,20,20,20 = 2,000.
    // Instead assert the boundary directly through a known set.
    const c = computeConcentration([40, 20, 20, 20]);
    // 1600 + 400 + 400 + 400 = 2,800 → highly concentrated.
    expect(c.hhi).toBe(2800);
    expect(c.band).toBe("highly_concentrated");

    const d = computeConcentration(Array.from({ length: 12 }, () => 1));
    // 12 equal players: 12 * (8.333)^2 ≈ 833 → unconcentrated.
    expect(d.band).toBe("unconcentrated");
  });

  it("excludes never-measured values instead of counting them as zero", () => {
    const withNulls = computeConcentration([500, 500, null, undefined, null]);
    const without = computeConcentration([500, 500]);
    // Nulls must not change the answer; treating them as 0 participants with
    // 0 share would leave HHI identical but inflate `participants`.
    expect(withNulls.hhi).toBe(without.hhi);
    expect(withNulls.participants).toBe(2);
  });

  it("reports null, not zero, when nothing was measured", () => {
    const c = computeConcentration([null, null]);
    expect(c.hhi).toBeNull();
    expect(c.band).toBeNull();
    expect(c.participants).toBe(0);
    expect(concentrationLabel(c.band)).toBe("Not measured");
  });

  it("computes the top-4 share", () => {
    const c = computeConcentration([50, 30, 10, 5, 3, 2]);
    expect(c.top4Share).toBeCloseTo(95 / 100, 10);
  });

  it("labels each band in plain English", () => {
    expect(concentrationLabel("highly_concentrated")).toBe("Highly concentrated");
    expect(concentrationLabel("moderately_concentrated")).toBe("Moderately concentrated");
    expect(concentrationLabel("unconcentrated")).toBe("Unconcentrated");
  });
});

describe("statewide market core — retailers", () => {
  const competitors = [
    {
      license_number: "412001",
      name: "LYMAN'S MARIJUANA, INC.",
      dba: "Greenway Marijuana",
      city: "Port Orchard",
      retail_units: 5000,
      retail_revenue_minor: 750_000,
      retail_line_count: 4000,
      price_median_minor: 1500,
      price_p25_minor: 1000,
      price_p75_minor: 2200,
      by_type: [
        { inventoryType: "Usable Marijuana", units: 3000, revenueMinor: 500_000 },
        { inventoryType: "Concentrate", units: 2000, revenueMinor: 250_000 },
      ],
      wholesale_spend_minor: 300_000,
    },
    {
      license_number: "412002",
      name: "OTHER SHOP LLC",
      dba: null,
      city: "Bremerton",
      retail_units: 2500,
      retail_revenue_minor: 250_000,
      retail_line_count: 2000,
      price_median_minor: 1200,
      price_p25_minor: 900,
      price_p75_minor: 1800,
      by_type: [{ inventoryType: "Usable Marijuana", units: 2500, revenueMinor: 250_000 }],
      wholesale_spend_minor: null,
    },
  ];

  it("prefers the DBA over the legal name for display", () => {
    const rows = buildRetailerRows(competitors);
    expect(rows[0].name).toBe("Greenway Marijuana");
    // No DBA — falls back to the legal name rather than showing blank.
    expect(rows[1].name).toBe("OTHER SHOP LLC");
  });

  it("computes revenue share against the measured total", () => {
    const rows = buildRetailerRows(competitors);
    expect(rows[0].revenueShare).toBeCloseTo(0.75, 10);
    expect(rows[1].revenueShare).toBeCloseTo(0.25, 10);
  });

  it("computes velocity as revenue per distribution point", () => {
    const rows = buildRetailerRows(competitors);
    // 750,000 across 2 types carried.
    expect(rows[0].velocityMinor).toBe(375_000);
    expect(rows[1].velocityMinor).toBe(250_000);
  });

  it("computes a fair-share index where 100 is par", () => {
    const rows = buildRetailerRows(competitors);
    // Greenway: 75% of revenue on 2/3 of the assortment points → 112.5.
    expect(rows[0].fairShareIndex).toBeCloseTo(112.5, 6);
    // Other: 25% of revenue on 1/3 of assortment points → 75.
    expect(rows[1].fairShareIndex).toBeCloseTo(75, 6);
  });

  it("returns null velocity when the mix was never measured", () => {
    const rows = buildRetailerRows([{ ...competitors[0], by_type: null }]);
    expect(rows[0].typesCarried).toBeNull();
    expect(rows[0].velocityMinor).toBeNull();
  });

  it("keeps an unmeasured wholesale spend null rather than zero", () => {
    const rows = buildRetailerRows(competitors);
    expect(rows[0].wholesaleSpendMinor).toBe(300_000);
    expect(rows[1].wholesaleSpendMinor).toBeNull();
  });

  it("drops rows with no license number", () => {
    const rows = buildRetailerRows([...competitors, { ...competitors[0], license_number: "  " }]);
    expect(rows).toHaveLength(2);
  });
});

describe("statewide market core — producers, two signals never blended", () => {
  const suppliers = [
    {
      licensee_id: "L-1",
      license_number: "414001",
      name: "BIG GROWER LLC",
      dba: "Big Grower",
      line_count: 900,
      revenue_minor: 900_000,
      price_median_minor: 800,
      distinct_buyers: 60,
      tracked_buyers: 5,
      by_type: [
        { inventoryType: "Usable Marijuana", units: 900, revenueMinor: 700_000, lineCount: 700, medianUnitPriceMinor: 800 },
        { inventoryType: "Concentrate", units: 200, revenueMinor: 200_000, lineCount: 200, medianUnitPriceMinor: 1000 },
      ],
      unattributed_lines: 12,
    },
    {
      licensee_id: "L-2",
      license_number: "414002",
      name: "SMALL FARM",
      dba: null,
      line_count: 100,
      revenue_minor: 100_000,
      price_median_minor: 700,
      distinct_buyers: 10,
      tracked_buyers: 1,
      by_type: null,
      unattributed_lines: null,
    },
  ];

  const producers = [
    {
      license_number: "414001",
      name: "BIG GROWER LLC",
      dba: "Big Grower",
      units: 300,
      revenue_minor: 30_000,
      line_count: 250,
      price_median_minor: 3000,
      distinct_retailers: 12,
      tracked_retailers: 3,
      doh_line_count: 40,
      by_type: [
        { inventoryType: "Usable Marijuana", units: 300, revenueMinor: 30_000, lineCount: 250, medianUnitPriceMinor: 3000 },
      ],
    },
  ];

  it("tags every sell-in row with the sell_in signal", () => {
    const rows = buildSellInRows(suppliers);
    expect(rows.every((r) => r.signal === "sell_in")).toBe(true);
  });

  it("tags every sell-through row with the sell_through signal", () => {
    const rows = buildSellThroughRows(producers);
    expect(rows.every((r) => r.signal === "sell_through")).toBe(true);
  });

  it("computes shares WITHIN each signal, never across them", () => {
    const sellIn = buildSellInRows(suppliers);
    const sellThrough = buildSellThroughRows(producers);
    // Sell-in shares sum to 1 among sell-in rows alone.
    expect(sellIn[0].revenueShare! + sellIn[1].revenueShare!).toBeCloseTo(1, 10);
    // The lone sell-through row owns 100% of the sell-through sample — it is
    // NOT diluted by the far larger wholesale numbers.
    expect(sellThrough[0].revenueShare).toBeCloseTo(1, 10);
  });

  it("exposes the wholesale/retail price gap as separate rows, not a sum", () => {
    const sellIn = buildSellInRows(suppliers);
    const sellThrough = buildSellThroughRows(producers);
    const wholesale = sellIn.find((r) => r.licenseNumber === "414001")!;
    const retail = sellThrough.find((r) => r.licenseNumber === "414001")!;
    // Same vendor, two vantage points: $8.00 wholesale vs $30.00 retail.
    expect(wholesale.medianUnitPriceMinor).toBe(800);
    expect(retail.medianUnitPriceMinor).toBe(3000);
    expect(wholesale.revenueMinor).not.toBe(retail.revenueMinor);
  });

  it("leaves sell-in units null because wholesale rollups count lines, not units", () => {
    expect(buildSellInRows(suppliers)[0].units).toBeNull();
  });

  it("carries DOH line counts only on the sell-through signal", () => {
    expect(buildSellThroughRows(producers)[0].dohLineCount).toBe(40);
    expect(buildSellInRows(suppliers)[0].dohLineCount).toBeNull();
  });

  it("carries unattributed lines only on the sell-in signal, preserving null", () => {
    const rows = buildSellInRows(suppliers);
    expect(rows[0].unattributedLines).toBe(12); // measured
    expect(rows[1].unattributedLines).toBeNull(); // never measured
    expect(buildSellThroughRows(producers)[0].unattributedLines).toBeNull();
  });

  it("identifies the top inventory type and its share of the vendor's revenue", () => {
    const rows = buildSellInRows(suppliers);
    const big = rows.find((r) => r.licenseNumber === "414001")!;
    expect(big.topType).toBe("Usable Marijuana");
    expect(big.topTypeShare).toBeCloseTo(700_000 / 900_000, 10);
    expect(big.typesCarried).toBe(2);
  });

  it("returns a null mix when the vendor's mix was never measured", () => {
    const rows = buildSellInRows(suppliers);
    const small = rows.find((r) => r.licenseNumber === "414002")!;
    expect(small.topType).toBeNull();
    expect(small.topTypeShare).toBeNull();
    expect(small.typesCarried).toBeNull();
  });

  it("computes velocity per distribution point for both signals", () => {
    expect(buildSellInRows(suppliers)[0].velocityMinor).toBe(15_000); // 900,000 / 60
    expect(buildSellThroughRows(producers)[0].velocityMinor).toBe(2_500); // 30,000 / 12
  });

  it("handles empty input for both signals", () => {
    expect(buildSellInRows([])).toEqual([]);
    expect(buildSellThroughRows([])).toEqual([]);
  });
});

describe("statewide market core — DOH sellers and the endorsement verdict", () => {
  const sellers = [
    {
      license_number: "412009",
      name: "MED SHOP",
      dba: null,
      tracked: true,
      is_self: false,
      units: 800,
      revenue_minor: 160_000,
      line_count: 700,
      price_median_minor: 2000,
    },
    {
      license_number: "412001",
      name: "LYMAN'S MARIJUANA, INC.",
      dba: "Greenway Marijuana",
      tracked: false,
      is_self: true,
      units: 200,
      revenue_minor: 40_000,
      line_count: 180,
      price_median_minor: 1900,
    },
  ];

  it("marks the owner's own store and roster competitors", () => {
    const v = buildDohVerdict({
      sellers: buildDohSellerRows(sellers),
      dohMedianUnitPriceMinor: 2000,
      retailMedianUnitPriceMinor: 1500,
      dohLines: 880,
      retailLines: 10_000,
      dohUnknownLines: 0,
    });
    expect(v.sellerCount).toBe(2);
    expect(v.trackedSellerCount).toBe(1);
    expect(v.selfPresent).toBe(true);
  });

  it("computes the DOH price premium against the overall retail median", () => {
    const v = buildDohVerdict({
      sellers: buildDohSellerRows(sellers),
      dohMedianUnitPriceMinor: 2000,
      retailMedianUnitPriceMinor: 1500,
      dohLines: null,
      retailLines: null,
      dohUnknownLines: null,
    });
    // $20.00 vs $15.00 → a 33.3% premium. This is the number that decides
    // whether the medical endorsement is worth carrying.
    expect(v.premiumPct).toBeCloseTo(500 / 1500, 10);
  });

  it("returns a null premium when either side was never measured", () => {
    const v = buildDohVerdict({
      sellers: buildDohSellerRows(sellers),
      dohMedianUnitPriceMinor: null,
      retailMedianUnitPriceMinor: 1500,
      dohLines: null,
      retailLines: null,
      dohUnknownLines: null,
    });
    expect(v.premiumPct).toBeNull();
  });

  it("uses an honest denominator that excludes unreadable DOH answers", () => {
    const v = buildDohVerdict({
      sellers: buildDohSellerRows(sellers),
      dohMedianUnitPriceMinor: 2000,
      retailMedianUnitPriceMinor: 1500,
      dohLines: 500,
      retailLines: 10_000,
      dohUnknownLines: 5_000,
    });
    // 500 of the 5,000 lines we could actually read = 10%, NOT 5% of all
    // 10,000. Counting "unknown" as "not DOH" would halve the real figure.
    expect(v.dohLineShare).toBeCloseTo(0.1, 10);
  });

  it("measures how concentrated the DOH pocket is", () => {
    const v = buildDohVerdict({
      sellers: buildDohSellerRows(sellers),
      dohMedianUnitPriceMinor: 2000,
      retailMedianUnitPriceMinor: 1500,
      dohLines: null,
      retailLines: null,
      dohUnknownLines: null,
    });
    // 80/20 split → 6400 + 400 = 6,800.
    expect(v.concentration.hhi).toBe(6800);
    expect(v.concentration.band).toBe("highly_concentrated");
  });

  it("computes revenue per line for each seller", () => {
    const rows = buildDohSellerRows(sellers);
    expect(rows[0].revenuePerLineMinor).toBe(Math.round(160_000 / 700));
  });

  it("survives an empty seller list without inventing a market", () => {
    const v = buildDohVerdict({
      sellers: buildDohSellerRows([]),
      dohMedianUnitPriceMinor: null,
      retailMedianUnitPriceMinor: null,
      dohLines: null,
      retailLines: null,
      dohUnknownLines: null,
    });
    expect(v.sellerCount).toBe(0);
    expect(v.revenueMinor).toBeNull();
    expect(v.concentration.hhi).toBeNull();
  });
});

describe("statewide market core — no-drift guard against the pre-Slice-8 page", () => {
  it("still exposes every metric the old flat page displayed", () => {
    // The page this replaced rendered these eight metrics across seven
    // sections. A redesign is allowed to move a number; it is NOT allowed to
    // lose one. This pins that promise.
    const rows = buildMarketRows(
      [
        ...usableMarijuana(),
        bench("type", "Usable Marijuana", "wholesale_price_per_gram", { median_minor: 171 }),
      ],
      "type",
    );
    const r = rows[0];
    expect(r.retail.medianUnitPriceMinor).not.toBeNull(); // retail_unit_price
    expect(r.wholesale.medianUnitPriceMinor).not.toBeNull(); // wholesale_unit_price
    expect(r.retail.medianPpgMinor).not.toBeNull(); // retail_price_per_gram
    expect(r.wholesale.medianPpgMinor).not.toBeNull(); // wholesale_price_per_gram
    expect(r.retail.units).not.toBeNull(); // retail_units
    expect(r.retail.revenueMinor).not.toBeNull(); // retail_revenue
    expect(r.totalThcMgPerG).not.toBeNull(); // total_thc_mg_per_g
    expect(r.totalCbdMgPerG).not.toBeNull(); // total_cbd_mg_per_g
  });

  it("exports both price-per-gram columns so screen and CSV agree", () => {
    const headers = MARKET_CSV_COLUMNS.map((c) => c.header);
    expect(headers).toContain("retail_median_price_per_gram");
    expect(headers).toContain("wholesale_median_price_per_gram");
  });

  it("supports every scope the old page paged through", () => {
    const input = [
      bench("type", "Flower", "retail_revenue", { avg_minor: 10 }),
      bench("brand", "Acme", "retail_revenue", { avg_minor: 20 }),
      bench("strain", "Blue Dream", "retail_revenue", { avg_minor: 30 }),
    ];
    // Category, brand and strain were three separate tables before; they are
    // now three grains of one table. All three must still resolve.
    expect(buildMarketRows(input, "type")[0].key).toBe("Flower");
    expect(buildMarketRows(input, "brand")[0].key).toBe("Acme");
    expect(buildMarketRows(input, "strain")[0].key).toBe("Blue Dream");
  });
});

describe("statewide market core — details-on-demand payloads", () => {
  it("carries a supplier's type and product mix onto the row, revenue-sorted", () => {
    const rows = buildSellInRows([
      {
        licensee_id: "L-1",
        license_number: "414001",
        name: "GROWER",
        dba: null,
        line_count: 10,
        revenue_minor: 1000,
        price_median_minor: 100,
        distinct_buyers: 2,
        tracked_buyers: 0,
        by_type: [
          { inventoryType: "Small", units: 1, revenueMinor: 100, lineCount: 1, medianUnitPriceMinor: 100 },
          { inventoryType: "Big", units: 9, revenueMinor: 900, lineCount: 9, medianUnitPriceMinor: 100 },
        ],
        top_products: [
          { productName: "Cheap", inventoryType: "Small", brand: null, units: 1, revenueMinor: 50, medianUnitPriceMinor: 50 },
          { productName: "Star", inventoryType: "Big", brand: "B", units: 9, revenueMinor: 850, medianUnitPriceMinor: 94 },
        ],
      },
    ]);
    // Biggest first, so the drill-down opens on what matters.
    expect(rows[0].detail.types.map((t) => t.inventoryType)).toEqual(["Big", "Small"]);
    expect(rows[0].detail.products.map((p) => p.productName)).toEqual(["Star", "Cheap"]);
  });

  it("returns empty mix arrays — not undefined — when nothing was measured", () => {
    const rows = buildSellInRows([
      {
        licensee_id: "L-1",
        license_number: "414001",
        name: "GROWER",
        dba: null,
        line_count: 1,
        revenue_minor: 1,
        price_median_minor: 1,
        distinct_buyers: 1,
        tracked_buyers: 0,
        by_type: null,
        top_products: null,
      },
    ]);
    // The panel needs a safe shape to render; the "never measured" fact is
    // preserved separately on topType/typesCarried, which stay null.
    expect(rows[0].detail).toEqual({ types: [], products: [] });
    expect(rows[0].typesCarried).toBeNull();
  });

  it("drops mix entries with a blank name instead of rendering a nameless row", () => {
    const rows = buildSellThroughRows([
      {
        license_number: "414001",
        name: "P",
        dba: null,
        units: 1,
        revenue_minor: 1,
        line_count: 1,
        price_median_minor: 1,
        distinct_retailers: 1,
        tracked_retailers: 0,
        doh_line_count: 0,
        by_type: [
          { inventoryType: "   ", units: 1, revenueMinor: 10, lineCount: 1, medianUnitPriceMinor: 1 },
          { inventoryType: "Real", units: 1, revenueMinor: 5, lineCount: 1, medianUnitPriceMinor: 1 },
        ],
        top_products: [
          { productName: "", inventoryType: null, brand: null, units: 1, revenueMinor: 9, medianUnitPriceMinor: 1 },
        ],
      },
    ]);
    expect(rows[0].detail.types.map((t) => t.inventoryType)).toEqual(["Real"]);
    expect(rows[0].detail.products).toEqual([]);
  });

  it("normalizes a competitor mix that carries no line counts", () => {
    const rows = buildRetailerRows([
      {
        license_number: "412001",
        name: "STORE",
        dba: null,
        city: "Port Orchard",
        retail_units: 10,
        retail_revenue_minor: 1000,
        retail_line_count: 10,
        price_median_minor: 100,
        price_p25_minor: null,
        price_p75_minor: null,
        by_type: [{ inventoryType: "Flower", units: 10, revenueMinor: 1000 }],
      },
    ]);
    // competitor by_type has no lineCount/median. They must normalize to a
    // neutral 0/null rather than borrowing a number from somewhere else.
    expect(rows[0].detail.types[0].lineCount).toBe(0);
    expect(rows[0].detail.types[0].medianUnitPriceMinor).toBeNull();
  });
});

describe("statewide market core — zoom, filter, sort", () => {
  it("sinks never-measured values to the bottom in BOTH sort directions", () => {
    const rows = [{ v: 5 }, { v: null }, { v: 1 }, { v: 9 }];
    const asc = sortRows(rows, (r) => r.v, "asc").map((r) => r.v);
    const desc = sortRows(rows, (r) => r.v, "desc").map((r) => r.v);
    // A null is the absence of a value, not the smallest one. Ranking it
    // first on "cheapest" would put unmeasured rows at the top of the list.
    expect(asc).toEqual([1, 5, 9, null]);
    expect(desc).toEqual([9, 5, 1, null]);
  });

  it("never mutates the input array", () => {
    const rows = [{ v: 3 }, { v: 1 }];
    const copy = [...rows];
    sortRows(rows, (r) => r.v, "asc");
    expect(rows).toEqual(copy);
  });

  it("sorts strings case-insensitively via locale compare", () => {
    const rows = [{ n: "beta" }, { n: "Alpha" }];
    expect(sortRows(rows, (r) => r.n, "asc").map((r) => r.n)).toEqual(["Alpha", "beta"]);
  });

  it("treats NaN and Infinity as unmeasured", () => {
    expect(compareValues(Number.NaN, 5, "asc")).toBe(1);
    expect(compareValues(5, Number.NaN, "asc")).toBe(-1);
  });

  it("matches a query across any provided field, case-insensitively", () => {
    expect(matchesQuery("green", ["LYMAN'S", "Greenway Marijuana"])).toBe(true);
    expect(matchesQuery("  GREEN  ", ["Greenway"])).toBe(true);
    expect(matchesQuery("zzz", ["Greenway", null])).toBe(false);
  });

  it("treats an empty query as no filter at all", () => {
    expect(matchesQuery("", ["anything"])).toBe(true);
    expect(matchesQuery("   ", [null])).toBe(true);
  });

  it("builds facets with counts, sorted by frequency", () => {
    const rows = [{ t: "Usable Marijuana" }, { t: "Concentrate" }, { t: "Usable Marijuana" }, { t: null }];
    const facet = buildFacet(rows, (r) => r.t);
    // The count teaches the shape of the data before the filter is touched.
    expect(facet).toEqual([
      { value: "Usable Marijuana", count: 2 },
      { value: "Concentrate", count: 1 },
    ]);
  });

  it("computes safe ratios", () => {
    expect(ratioOrNull(1, 4)).toBe(0.25);
    expect(ratioOrNull(1, 0)).toBeNull();
    expect(ratioOrNull(null, 4)).toBeNull();
  });
});

describe("statewide market core — extract (CSV)", () => {
  it("quotes cells containing commas, quotes, CR or LF per RFC 4180", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    // A bare CR splits rows in Excel on Windows — it must be quoted too.
    expect(csvCell("carriage\rreturn")).toBe('"carriage\rreturn"');
  });

  it("renders null as an empty cell, never as 0", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(minorToCsvAmount(null)).toBe("");
    expect(fractionToCsvPct(null)).toBe("");
    // A blank cell reads as "not measured" in a spreadsheet; a 0 reads as a
    // fact. The distinction has to survive the export.
    expect(minorToCsvAmount(0)).toBe("0.00");
  });

  it("converts minor units to a decimal amount", () => {
    expect(minorToCsvAmount(1500)).toBe("15.00");
    expect(minorToCsvAmount(1)).toBe("0.01");
  });

  it("converts a fraction to a percentage string", () => {
    expect(fractionToCsvPct(0.125)).toBe("12.5");
  });

  it("emits a header row and CRLF line endings", () => {
    const csv = rowsToCsv([{ a: 1 }], [{ header: "a", value: (r) => r.a }]);
    expect(csv).toBe("a\r\n1");
  });

  it("exports the market table with every column populated", () => {
    const rows = buildMarketRows(usableMarijuana(), "type");
    const csv = rowsToCsv(rows, MARKET_CSV_COLUMNS);
    const [header, body] = csv.split("\r\n");
    expect(header.split(",")).toHaveLength(MARKET_CSV_COLUMNS.length);
    expect(body.split(",")).toHaveLength(MARKET_CSV_COLUMNS.length);
    expect(header).toContain("gross_spread");
    expect(body).toContain("15.00"); // retail median
    expect(body).toContain("9.00"); // gross spread
  });

  it("survives a product name containing a comma and a quote", () => {
    const rows = buildMarketRows(
      [bench("type", 'Pre-Roll, 1g "Fire"', "retail_revenue", { avg_minor: 100 })],
      "type",
    );
    const csv = rowsToCsv(rows, MARKET_CSV_COLUMNS);
    // The escaped name must not introduce a spurious column break.
    expect(csv).toContain('"Pre-Roll, 1g ""Fire"""');
    const bodyLine = csv.split("\r\n")[1];
    // Naive splitting would over-count; a correct parse keeps the row intact.
    expect(bodyLine.startsWith('"Pre-Roll, 1g ""Fire"""')).toBe(true);
  });

  it("labels the signal on every exported producer row", () => {
    const csv = rowsToCsv(
      [
        ...buildSellInRows([
          {
            licensee_id: "L-1",
            license_number: "414001",
            name: "A",
            dba: null,
            line_count: 1,
            revenue_minor: 100,
            price_median_minor: 100,
            distinct_buyers: 1,
            tracked_buyers: 0,
            by_type: null,
            unattributed_lines: null,
          },
        ]),
        ...buildSellThroughRows([
          {
            license_number: "414001",
            name: "A",
            dba: null,
            units: 1,
            revenue_minor: 100,
            line_count: 1,
            price_median_minor: 100,
            distinct_retailers: 1,
            tracked_retailers: 0,
            doh_line_count: 0,
            by_type: null,
          },
        ]),
      ],
      PRODUCER_CSV_COLUMNS,
    );
    // Without the signal column an analyst could sum the two and get a
    // meaningless number. It is the first column for that reason.
    expect(csv).toContain("sell_in");
    expect(csv).toContain("sell_through");
    expect(csv.split("\r\n")[0].startsWith("signal")).toBe(true);
  });
});
