/**
 * tests/compliance/local-market-core.test.ts
 *
 * Slice 9 — the LOCAL benchmarks semantic layer.
 *
 * Two things matter most here. First, a store must be priced against its OWN
 * area: a Tacoma store undercutting Port Orchard is not competition. Second,
 * the vendor rollup is built from per-store TOP-supplier lists, so its buyer
 * counts are a floor and must never be presented as a census.
 */

import { describe, expect, it } from "vitest";

import {
  buildLocalAreaRows,
  buildLocalHeadline,
  buildLocalStoreRows,
  buildLocalVendorRows,
  LOCAL_AREA_CSV_COLUMNS,
  LOCAL_STORE_CSV_COLUMNS,
  LOCAL_VENDOR_CSV_COLUMNS,
  type LocalAreaLike,
  type LocalCompetitorLike,
} from "@/lib/discovery/local-market-core";
import { rowsToCsv } from "@/lib/discovery/statewide-market-core";

function competitor(over: Partial<LocalCompetitorLike> = {}): LocalCompetitorLike {
  return {
    licenseNumber: "412100",
    tradename: "Rival Shop",
    area: "port_orchard",
    city: "Port Orchard",
    retailUnits: 1000,
    retailRevenueMinor: 200_000,
    retailLineCount: 800,
    priceSampleSize: 800,
    priceP25Minor: 1000,
    priceMedianMinor: 1500,
    priceP75Minor: 2200,
    priceAvgMinor: 1600,
    byType: [
      { inventoryType: "Usable Marijuana", units: 700, revenueMinor: 150_000 },
      { inventoryType: "Concentrate", units: 300, revenueMinor: 50_000 },
    ],
    topProducts: [
      { productName: "Blue Dream 3.5g", inventoryType: "Usable Marijuana", units: 300, revenueMinor: 90_000, medianUnitPriceMinor: 3000 },
      { productName: "Live Resin 1g", inventoryType: "Concentrate", units: 100, revenueMinor: 40_000, medianUnitPriceMinor: 4000 },
    ],
    wholesaleLineCount: 120,
    wholesaleSpendMinor: 80_000,
    topSuppliers: [
      { licenseeId: "L-1", licenseNumber: "414001", displayName: "Big Grower", lineCount: 80, spendMinor: 60_000 },
      { licenseeId: "L-2", licenseNumber: "414002", displayName: "Small Farm", lineCount: 40, spendMinor: 20_000 },
    ],
    ...over,
  };
}

/**
 * A minimal RFC 4180 field splitter. Used so the export tests verify what a
 * spreadsheet would ACTUALLY parse, rather than what a naive `.split(",")`
 * would produce — a naive split is exactly the bug these tests exist to catch.
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

const AREAS: LocalAreaLike[] = [
  {
    area: "port_orchard",
    storeCount: 2,
    retailLineCount: 1600,
    retailUnits: 2000,
    retailRevenueMinor: 400_000,
    retailMedianMinor: 1500,
    retailAvgMinor: 1600,
  },
  {
    area: "tacoma",
    storeCount: 1,
    retailLineCount: 500,
    retailUnits: 600,
    retailRevenueMinor: 100_000,
    retailMedianMinor: 1200,
    retailAvgMinor: 1250,
  },
];

describe("local market core — store rows", () => {
  it("prices each store against its OWN area median, not a global one", () => {
    const rows = buildLocalStoreRows(
      [
        competitor({ licenseNumber: "A", tradename: "PO Store", area: "port_orchard", priceMedianMinor: 1400 }),
        competitor({ licenseNumber: "B", tradename: "Tac Store", area: "tacoma", priceMedianMinor: 1400 }),
      ],
      AREAS,
    );
    const po = rows.find((r) => r.licenseNumber === "A")!;
    const tac = rows.find((r) => r.licenseNumber === "B")!;
    // Identical shelf price, opposite competitive meaning: $14 is cheap in
    // Port Orchard (area median $15) and expensive in Tacoma (median $12).
    expect(po.vsAreaMinor).toBe(-100);
    expect(tac.vsAreaMinor).toBe(200);
  });

  it("returns a null area comparison when the area median was never measured", () => {
    const rows = buildLocalStoreRows([competitor({ area: "silverdale" })], AREAS);
    expect(rows[0].vsAreaMinor).toBeNull();
    expect(rows[0].vsAreaPct).toBeNull();
  });

  it("computes velocity and fair share exactly as the statewide page does", () => {
    const rows = buildLocalStoreRows(
      [
        competitor({ licenseNumber: "A", tradename: "Wide", retailRevenueMinor: 300_000 }),
        competitor({
          licenseNumber: "B",
          tradename: "Narrow",
          retailRevenueMinor: 100_000,
          byType: [{ inventoryType: "Usable Marijuana", units: 400, revenueMinor: 100_000 }],
        }),
      ],
      AREAS,
    );
    const wide = rows.find((r) => r.licenseNumber === "A")!;
    const narrow = rows.find((r) => r.licenseNumber === "B")!;
    expect(wide.velocityMinor).toBe(150_000); // 300,000 / 2 categories
    expect(narrow.velocityMinor).toBe(100_000); // 100,000 / 1 category
    // Wide: 75% revenue on 2/3 of assortment → 112.5. Narrow: 25% on 1/3 → 75.
    expect(wide.fairShareIndex).toBeCloseTo(112.5, 6);
    expect(narrow.fairShareIndex).toBeCloseTo(75, 6);
  });

  it("computes the buy-vs-sell gap only when wholesale spend was observed", () => {
    const rows = buildLocalStoreRows(
      [
        competitor({ licenseNumber: "A", retailRevenueMinor: 200_000, wholesaleSpendMinor: 80_000 }),
        competitor({ licenseNumber: "B", retailRevenueMinor: 200_000, wholesaleSpendMinor: 0 }),
      ],
      AREAS,
    );
    expect(rows.find((r) => r.licenseNumber === "A")!.buySellGapMinor).toBe(120_000);
    // Zero observed spend means the wholesale side wasn't seen this month, so
    // a "gap" equal to full revenue would be a lie dressed as a metric.
    expect(rows.find((r) => r.licenseNumber === "B")!.buySellGapMinor).toBeNull();
  });

  it("sorts the drill-down mixes by revenue so the biggest thing is first", () => {
    const rows = buildLocalStoreRows([competitor()], AREAS);
    expect(rows[0].detail.types.map((t) => t.inventoryType)).toEqual(["Usable Marijuana", "Concentrate"]);
    expect(rows[0].detail.products.map((p) => p.productName)).toEqual(["Blue Dream 3.5g", "Live Resin 1g"]);
    expect(rows[0].suppliers.map((s) => s.name)).toEqual(["Big Grower", "Small Farm"]);
  });

  it("does not invent per-type line counts or medians the rollup never carried", () => {
    const rows = buildLocalStoreRows([competitor()], AREAS);
    expect(rows[0].detail.types[0].lineCount).toBe(0);
    expect(rows[0].detail.types[0].medianUnitPriceMinor).toBeNull();
  });

  it("keeps a store with no measured price rather than dropping it from the market", () => {
    const rows = buildLocalStoreRows([competitor({ priceMedianMinor: null, priceP25Minor: null })], AREAS);
    // It still has real revenue; hiding it would understate the market.
    expect(rows).toHaveLength(1);
    expect(rows[0].medianMinor).toBeNull();
    expect(rows[0].revenueMinor).toBe(200_000);
  });

  it("drops rows with no license number", () => {
    expect(buildLocalStoreRows([competitor({ licenseNumber: "  " })], AREAS)).toHaveLength(0);
  });

  it("handles empty input", () => {
    expect(buildLocalStoreRows([], [])).toEqual([]);
  });
});

describe("local market core — areas", () => {
  it("computes revenue share and revenue per store", () => {
    const rows = buildLocalAreaRows(AREAS);
    const po = rows.find((r) => r.area === "port_orchard")!;
    expect(po.revenueShare).toBeCloseTo(400_000 / 500_000, 10);
    expect(po.revenuePerStoreMinor).toBe(200_000);
  });

  it("keeps a never-measured median null", () => {
    const rows = buildLocalAreaRows([{ ...AREAS[0], retailMedianMinor: null }]);
    expect(rows[0].medianMinor).toBeNull();
  });

  it("sorts areas by revenue", () => {
    expect(buildLocalAreaRows(AREAS).map((r) => r.area)).toEqual(["port_orchard", "tacoma"]);
  });
});

describe("local market core — vendors", () => {
  const stores = buildLocalStoreRows(
    [
      competitor({
        licenseNumber: "A",
        tradename: "Store A",
        topSuppliers: [
          { licenseeId: "L-1", licenseNumber: "414001", displayName: "Big Grower", lineCount: 80, spendMinor: 60_000 },
        ],
      }),
      competitor({
        licenseNumber: "B",
        tradename: "Store B",
        topSuppliers: [
          { licenseeId: "L-1", licenseNumber: "414001", displayName: "Big Grower", lineCount: 40, spendMinor: 30_000 },
          { licenseeId: "L-3", licenseNumber: "414003", displayName: "Solo Vendor", lineCount: 10, spendMinor: 5_000 },
        ],
      }),
    ],
    AREAS,
  );

  it("rolls one vendor across every store that buys from it", () => {
    const vendors = buildLocalVendorRows(stores);
    const big = vendors.find((v) => v.licenseNumber === "414001")!;
    expect(big.buyerCount).toBe(2);
    expect(big.spendMinor).toBe(90_000);
    expect(big.lineCount).toBe(120);
    expect(big.buyerNames).toEqual(["Store A", "Store B"]); // spend desc
  });

  it("flags vendors serving two or more tracked competitors", () => {
    const vendors = buildLocalVendorRows(stores);
    expect(vendors.find((v) => v.licenseNumber === "414001")!.multiCompetitor).toBe(true);
    expect(vendors.find((v) => v.licenseNumber === "414003")!.multiCompetitor).toBe(false);
  });

  it("ranks multi-competitor vendors first — they are the priority calls", () => {
    expect(buildLocalVendorRows(stores)[0].licenseNumber).toBe("414001");
  });

  it("computes spend per buyer, showing how deep each account runs", () => {
    const vendors = buildLocalVendorRows(stores);
    expect(vendors.find((v) => v.licenseNumber === "414001")!.spendPerBuyerMinor).toBe(45_000);
  });

  it("computes spend share against observed local wholesale spend", () => {
    const vendors = buildLocalVendorRows(stores);
    const big = vendors.find((v) => v.licenseNumber === "414001")!;
    expect(big.spendShare).toBeCloseTo(90_000 / 95_000, 10);
  });

  it("counts a store only once even if it appears twice for a vendor", () => {
    const dup = buildLocalStoreRows(
      [
        competitor({
          licenseNumber: "A",
          tradename: "Store A",
          topSuppliers: [
            { licenseeId: "L-1", licenseNumber: "414001", displayName: "Big Grower", lineCount: 1, spendMinor: 10 },
            { licenseeId: "L-1", licenseNumber: "414001", displayName: "Big Grower", lineCount: 1, spendMinor: 20 },
          ],
        }),
      ],
      AREAS,
    );
    const v = buildLocalVendorRows(dup)[0];
    // One store is one buyer, however many lines it took.
    expect(v.buyerCount).toBe(1);
    expect(v.spendMinor).toBe(30);
  });

  it("returns no vendors when no supplier data was captured", () => {
    const none = buildLocalStoreRows([competitor({ topSuppliers: [] })], AREAS);
    expect(buildLocalVendorRows(none)).toEqual([]);
  });
});

describe("local market core — headline", () => {
  const stores = buildLocalStoreRows(
    [
      competitor({ licenseNumber: "A", tradename: "Cheap Co", priceMedianMinor: 1100 }),
      competitor({ licenseNumber: "B", tradename: "Pricey Co", priceMedianMinor: 1900 }),
    ],
    AREAS,
  );
  const areas = buildLocalAreaRows(AREAS);
  const vendors = buildLocalVendorRows(stores);

  it("reports the owner's home-area median, not a statewide one", () => {
    const h = buildLocalHeadline({ stores, areas, vendors, homeArea: "port_orchard" });
    expect(h.homeAreaMedianMinor).toBe(1500);
    expect(h.homeAreaStoreCount).toBe(2);
  });

  it("names the cheapest and priciest stores", () => {
    const h = buildLocalHeadline({ stores, areas, vendors, homeArea: "port_orchard" });
    expect(h.cheapestStore?.tradename).toBe("Cheap Co");
    expect(h.priciestStore?.tradename).toBe("Pricey Co");
  });

  it("excludes stores with no measured median from cheapest/priciest", () => {
    const mixed = buildLocalStoreRows(
      [
        competitor({ licenseNumber: "A", tradename: "Measured", priceMedianMinor: 1500 }),
        competitor({ licenseNumber: "B", tradename: "Unmeasured", priceMedianMinor: null }),
      ],
      AREAS,
    );
    const h = buildLocalHeadline({ stores: mixed, areas, vendors: [], homeArea: "port_orchard" });
    // An unpriced store must never be crowned "cheapest in town".
    expect(h.cheapestStore?.tradename).toBe("Measured");
    expect(h.priciestStore?.tradename).toBe("Measured");
  });

  it("returns nulls for an empty market instead of inventing one", () => {
    const h = buildLocalHeadline({ stores: [], areas: [], vendors: [], homeArea: "port_orchard" });
    expect(h.storeCount).toBe(0);
    expect(h.homeAreaMedianMinor).toBeNull();
    expect(h.totalRevenueMinor).toBeNull();
    expect(h.cheapestStore).toBeNull();
    expect(h.concentration.hhi).toBeNull();
  });

  it("measures how concentrated local retail revenue is", () => {
    const h = buildLocalHeadline({ stores, areas, vendors, homeArea: "port_orchard" });
    // Two equal stores → 50/50 → 2,500 + 2,500 = 5,000.
    expect(h.concentration.hhi).toBe(5000);
    expect(h.concentration.band).toBe("highly_concentrated");
  });

  it("counts the priority vendor call list", () => {
    const h = buildLocalHeadline({ stores, areas, vendors, homeArea: "port_orchard" });
    expect(h.multiCompetitorVendorCount).toBe(vendors.filter((v) => v.multiCompetitor).length);
  });
});

describe("local market core — extract", () => {
  const stores = buildLocalStoreRows([competitor()], AREAS);

  it("exports store rows with aligned header and body widths", () => {
    const csv = rowsToCsv(stores, LOCAL_STORE_CSV_COLUMNS);
    const [header, body] = csv.split("\r\n");
    expect(header.split(",")).toHaveLength(LOCAL_STORE_CSV_COLUMNS.length);
    expect(body.split(",")).toHaveLength(LOCAL_STORE_CSV_COLUMNS.length);
  });

  it("exports the area comparison that drives the pricing decision", () => {
    const headers = LOCAL_STORE_CSV_COLUMNS.map((c) => c.header);
    expect(headers).toContain("vs_area_median");
    expect(headers).toContain("vs_area_median_pct");
  });

  it("renders never-measured values as blank cells, never as 0", () => {
    const unpriced = buildLocalStoreRows([competitor({ priceMedianMinor: null, wholesaleSpendMinor: 0 })], AREAS);
    const csv = rowsToCsv(unpriced, LOCAL_STORE_CSV_COLUMNS);
    const cells = csv.split("\r\n")[1].split(",");
    const headers = LOCAL_STORE_CSV_COLUMNS.map((c) => c.header);
    expect(cells[headers.indexOf("median_price")]).toBe("");
    expect(cells[headers.indexOf("buy_sell_gap")]).toBe("");
  });

  it("quotes a vendor buyer list so its separators cannot split the row", () => {
    const multi = buildLocalVendorRows(
      buildLocalStoreRows(
        [
          competitor({ licenseNumber: "A", tradename: "Store, A" }),
          competitor({ licenseNumber: "B", tradename: "Store B" }),
        ],
        AREAS,
      ),
    );
    const csv = rowsToCsv(multi, LOCAL_VENDOR_CSV_COLUMNS);
    // "Store, A" carries a comma. Joined into the buyers cell it MUST be
    // wrapped in quotes, otherwise the cell splits and every column after it
    // shifts left — the classic silent CSV corruption.
    expect(csv).toContain('"Store B; Store, A"');

    // Prove the shift did not happen: the data row still has exactly as many
    // fields as the header once the quoted cell is parsed properly.
    const [header, firstRow] = csv.split("\r\n");
    expect(parseCsvLine(firstRow)).toHaveLength(parseCsvLine(header).length);
    expect(parseCsvLine(firstRow)[3]).toBe("Store B; Store, A");
  });

  it("orders buyers deterministically when their spend ties", () => {
    // Both stores spend an identical 60,000 at Big Grower. Without an explicit
    // name tie-break the order would follow Map insertion, i.e. the order rows
    // happened to arrive in — so the same month could export two different
    // files. Feeding the same stores in OPPOSITE order must yield one answer.
    const forward = buildLocalVendorRows(
      buildLocalStoreRows(
        [
          competitor({ licenseNumber: "A", tradename: "Store, A" }),
          competitor({ licenseNumber: "B", tradename: "Store B" }),
        ],
        AREAS,
      ),
    );
    const reversed = buildLocalVendorRows(
      buildLocalStoreRows(
        [
          competitor({ licenseNumber: "B", tradename: "Store B" }),
          competitor({ licenseNumber: "A", tradename: "Store, A" }),
        ],
        AREAS,
      ),
    );
    expect(forward[0]!.buyerNames).toEqual(reversed[0]!.buyerNames);
    expect(rowsToCsv(forward, LOCAL_VENDOR_CSV_COLUMNS)).toBe(
      rowsToCsv(reversed, LOCAL_VENDOR_CSV_COLUMNS),
    );
  });

  it("exports areas", () => {
    const csv = rowsToCsv(buildLocalAreaRows(AREAS), LOCAL_AREA_CSV_COLUMNS);
    expect(csv.split("\r\n")).toHaveLength(3); // header + 2 areas
  });
});

// ---------------------------------------------------------------------------
// No-drift guard
// ---------------------------------------------------------------------------

/**
 * Slice 9 replaced ten stacked sections with four lenses. The redesign is only
 * legitimate if it LOST NOTHING. This pins every fact the old flat page put on
 * screen; if a future refactor drops one, this test fails rather than the
 * omission being discovered during a vendor negotiation.
 */
describe("local market core — no drift from the flat page", () => {
  const stores = buildLocalStoreRows([competitor()], AREAS);
  const areas = buildLocalAreaRows(AREAS);
  const vendors = buildLocalVendorRows(stores);
  const s = stores[0]!;
  const a = areas.find((r) => r.area === "port_orchard")!;
  const v = vendors[0]!;

  it("still exposes every per-store metric the old page displayed", () => {
    // Old columns: Store, Area, Units, Revenue, Low (p25), Median price,
    // High (p75), Retail lines, n (price sample), Wholesale revenue.
    expect(s.tradename).toBe("Rival Shop");
    expect(s.area).toBe("port_orchard");
    expect(s.units).toBe(1000);
    expect(s.revenueMinor).toBe(200_000);
    expect(s.p25Minor).toBe(1000);
    expect(s.medianMinor).toBe(1500);
    expect(s.p75Minor).toBe(2200);
    expect(s.lineCount).toBe(800);
    expect(s.priceSampleSize).toBe(800);
    expect(s.wholesaleSpendMinor).toBe(80_000);
  });

  it("still exposes the per-store product mix and supplier list", () => {
    // Old sections: "What competitors sell most" and "Who competitors buy from".
    expect(s.detail.products.map((p) => p.productName)).toContain("Blue Dream 3.5g");
    expect(s.detail.products[0]!.medianUnitPriceMinor).toBe(3000);
    expect(s.detail.types.map((t) => t.inventoryType)).toContain("Usable Marijuana");
    expect(s.suppliers.map((x) => x.name)).toContain("Big Grower");
    expect(s.suppliers[0]!.spendMinor).toBe(60_000);
  });

  it("still exposes every area metric the old page displayed", () => {
    // Old columns: Area, Stores, Units, Revenue, Median retail, Avg retail.
    expect(a.storeCount).toBe(2);
    expect(a.units).toBe(2000);
    expect(a.revenueMinor).toBe(400_000);
    expect(a.lineCount).toBe(1600);
    expect(a.medianMinor).toBe(1500);
    expect(a.avgMinor).toBe(1600);
  });

  it("still exposes the shared-supplier lead fields", () => {
    // Old columns: Supplier, Stores supplied, Who they supply, Observed spend, Lines.
    expect(v.name).toBe("Big Grower");
    expect(v.buyerCount).toBe(1);
    expect(v.buyerNames).toEqual(["Rival Shop"]);
    expect(v.spendMinor).toBe(60_000);
    expect(v.lineCount).toBe(80);
  });

  it("exports carry the full store column set", () => {
    const headers = LOCAL_STORE_CSV_COLUMNS.map((c) => c.header);
    for (const required of [
      "store",
      "area",
      "retail_units",
      "retail_revenue",
      "p25_price",
      "median_price",
      "p75_price",
      "wholesale_spend",
    ]) {
      expect(headers).toContain(required);
    }
  });
});
