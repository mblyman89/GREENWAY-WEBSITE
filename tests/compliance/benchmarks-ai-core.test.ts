/**
 * tests/compliance/benchmarks-ai-core.test.ts — Task I (I7).
 *
 * Covers the PURE digest shaping behind "Ask the analyst": statewide and local
 * fact blocks built ONLY from persisted rollups (null when nothing persisted,
 * never fabricated), retail/wholesale basis labels, one-month scope notices,
 * n/a for missing figures, caps, and the question sanitizer's refusal to pass
 * empty/oversized input through.
 */
import { describe, it, expect } from "vitest";
import {
  buildStatewideAnalystDigest,
  buildLocalAnalystDigest,
  sanitizeAnalystQuestion,
  type AnalystBenchmarkLike,
  type AnalystCompetitorLike,
} from "@/lib/discovery/benchmarks-ai-core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DATASET = {
  label: "CCRS monthly · 2026-05",
  period_start: "2026-05-01",
  period_end: "2026-05-31",
  retail_lines: 1000,
  attributed_retail_lines: 750,
};

function bench(overrides: Partial<AnalystBenchmarkLike> = {}): AnalystBenchmarkLike {
  return {
    scope: "overall",
    scope_key: "all",
    metric: "retail_unit_price",
    sample_size: 5000,
    p25_minor: 1500,
    median_minor: 2100,
    p75_minor: 3000,
    avg_minor: 2300,
    value_num: null,
    ...overrides,
  };
}

function competitor(overrides: Partial<AnalystCompetitorLike> = {}): AnalystCompetitorLike {
  return {
    tradename: "PO Pot Shop",
    area: "port_orchard",
    city: "Port Orchard",
    retailUnits: 4000,
    retailRevenueMinor: 9_000_000,
    priceP25Minor: 1200,
    priceMedianMinor: 2000,
    priceP75Minor: 3200,
    topProducts: [
      {
        productName: "Blue Dream 3.5g",
        inventoryType: "Usable Cannabis",
        units: 300,
        revenueMinor: 660_000,
        medianUnitPriceMinor: 2200,
      },
    ],
    wholesaleSpendMinor: 4_500_000,
    topSuppliers: [{ displayName: "Evergreen Farms", spendMinor: 1_200_000 }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// sanitizeAnalystQuestion
// ---------------------------------------------------------------------------

describe("sanitizeAnalystQuestion", () => {
  it("trims and collapses whitespace", () => {
    expect(sanitizeAnalystQuestion("  who   is\n winning  Port Orchard? ")).toBe(
      "who is winning Port Orchard?",
    );
  });

  it("refuses empty/whitespace/non-string input", () => {
    expect(sanitizeAnalystQuestion("")).toBeNull();
    expect(sanitizeAnalystQuestion("   \n\t ")).toBeNull();
    expect(sanitizeAnalystQuestion(null)).toBeNull();
    expect(sanitizeAnalystQuestion(42)).toBeNull();
  });

  it("caps oversized questions at 500 chars with an ellipsis", () => {
    const q = sanitizeAnalystQuestion("x".repeat(600));
    expect(q).not.toBeNull();
    expect(q!.length).toBe(501); // 500 + "…"
    expect(q!.endsWith("…")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildStatewideAnalystDigest
// ---------------------------------------------------------------------------

describe("buildStatewideAnalystDigest", () => {
  it("returns null when there are no benchmark rows — never a fabricated digest", () => {
    expect(buildStatewideAnalystDigest({ dataset: DATASET, benchmarks: [] })).toBeNull();
  });

  it("labels the one-month scope, the period, and the attribution share", () => {
    const digest = buildStatewideAnalystDigest({ dataset: DATASET, benchmarks: [bench()] })!;
    expect(digest).toContain("2026-05-01 → 2026-05-31");
    expect(digest).toContain("ONE monthly CCRS drop");
    expect(digest).toContain("Never extrapolate beyond this month");
    expect(digest).toContain("75.0% of retail lines");
    expect(digest).toContain("RETAIL = shelf prices shoppers paid");
    expect(digest).toContain("WHOLESALE = prices stores paid vendors");
  });

  it("renders overall bands in dollars from minor units and includes n", () => {
    const digest = buildStatewideAnalystDigest({ dataset: DATASET, benchmarks: [bench()] })!;
    expect(digest).toContain(
      "retail_unit_price: p25=$15.00, median=$21.00, p75=$30.00, n=5000",
    );
  });

  it("groups type/brand/strain scopes, biggest samples first, and drops null-median rows", () => {
    const digest = buildStatewideAnalystDigest({
      dataset: DATASET,
      benchmarks: [
        bench({ scope: "type", scope_key: "Usable Cannabis", sample_size: 900, median_minor: 1800 }),
        bench({ scope: "type", scope_key: "Solid Edible", sample_size: 2000, median_minor: 2400 }),
        bench({ scope: "type", scope_key: "No Median", sample_size: 9999, median_minor: null }),
        bench({ scope: "brand", scope_key: "Acme", sample_size: 100, median_minor: 2500 }),
      ],
    })!;
    // biggest sample first, null-median dropped entirely
    const edible = digest.indexOf("Solid Edible");
    const usable = digest.indexOf("Usable Cannabis");
    expect(edible).toBeGreaterThan(-1);
    expect(usable).toBeGreaterThan(edible);
    expect(digest).not.toContain("No Median");
    expect(digest).toContain("BY BRAND");
    expect(digest).toContain("Acme");
  });

  it("includes month-over-month history rows and n/a for missing figures", () => {
    const digest = buildStatewideAnalystDigest({
      dataset: DATASET,
      benchmarks: [bench()],
      history: [
        {
          label: "CCRS monthly · 2026-04",
          periodStart: "2026-04-01",
          periodEnd: "2026-04-30",
          retailMedianMinor: 2050,
          retailPpgMedianMinor: null,
          wholesaleMedianMinor: 900,
          retailUnits: 1_000_000,
          retailRevenueMinor: 2_500_000_00,
          attributedShare: 0.721,
        },
      ],
    })!;
    expect(digest).toContain("MONTH-OVER-MONTH HISTORY");
    expect(digest).toContain("2026-04-01→2026-04-30");
    expect(digest).toContain("retail_median=$20.50");
    expect(digest).toContain("retail_$/g_median=n/a");
    expect(digest).toContain("attribution=72.1%");
  });

  it("includes per-type movers with the honest 'vendor=unresolved' fallback", () => {
    const digest = buildStatewideAnalystDigest({
      dataset: DATASET,
      benchmarks: [bench()],
      typeMovers: [
        {
          inventoryType: "Usable Cannabis",
          rows: [
            {
              product_name: "Blue Dream 3.5g",
              brand: "Acme",
              vendor_name: "Evergreen Farms",
              units: 5000,
              revenue_minor: 11_000_000,
              median_unit_price_minor: 2200,
              p25_unit_price_minor: 1900,
            },
            {
              product_name: "Mystery Jar",
              brand: null,
              vendor_name: null,
              units: 100,
              revenue_minor: 200_000,
              median_unit_price_minor: null,
              p25_unit_price_minor: null,
            },
          ],
        },
      ],
    })!;
    expect(digest).toContain("TOP MOVERS BY TYPE");
    expect(digest).toContain('"Blue Dream 3.5g", brand=Acme, vendor=Evergreen Farms');
    expect(digest).toContain("revenue=$110000.00");
    expect(digest).toContain('"Mystery Jar", brand=n/a, vendor=unresolved');
    expect(digest).toContain("median=n/a, p25=n/a");
  });
});

// ---------------------------------------------------------------------------
// buildLocalAnalystDigest
// ---------------------------------------------------------------------------

describe("buildLocalAnalystDigest", () => {
  it("returns null when there are no competitor rollups — never fabricated", () => {
    expect(
      buildLocalAnalystDigest({ dataset: DATASET, areas: [], competitors: [] }),
    ).toBeNull();
  });

  it("states the self-exclusion, Port Orchard weighting, and one-month scope", () => {
    const digest = buildLocalAnalystDigest({
      dataset: DATASET,
      areas: [],
      competitors: [competitor()],
    })!;
    expect(digest).toContain("Greenway itself is structurally EXCLUDED");
    expect(digest).toContain("Port Orchard is the market Greenway most needs to win");
    expect(digest).toContain("ONE monthly CCRS drop");
  });

  it("renders area rollups with the labeled median-of-medians proxy", () => {
    const digest = buildLocalAnalystDigest({
      dataset: DATASET,
      areas: [
        {
          area: "port_orchard",
          storeCount: 2,
          retailUnits: 8000,
          retailRevenueMinor: 18_000_000,
          retailMedianMinor: 2100,
        },
      ],
      competitors: [competitor()],
    })!;
    expect(digest).toContain("AREA ROLLUPS");
    expect(digest).toContain(
      "port_orchard: stores=2, retail_units=8000, retail_revenue=$180000.00, median_retail=$21.00 (median of each store's median — labeled proxy)",
    );
  });

  it("renders competitor rows with bands, top products, and suppliers", () => {
    const digest = buildLocalAnalystDigest({
      dataset: DATASET,
      areas: [],
      competitors: [competitor()],
    })!;
    expect(digest).toContain("PO Pot Shop (port_orchard, Port Orchard)");
    expect(digest).toContain("retail_band p25=$12.00 median=$20.00 p75=$32.00");
    expect(digest).toContain('"Blue Dream 3.5g" [Usable Cannabis] units=300');
    expect(digest).toContain("wholesale_spend=$45000.00, top_suppliers: Evergreen Farms ($12000.00)");
  });

  it("marks missing wholesale data honestly instead of guessing", () => {
    const digest = buildLocalAnalystDigest({
      dataset: DATASET,
      areas: [],
      competitors: [
        competitor({ wholesaleSpendMinor: 0, topSuppliers: [], topProducts: [] }),
      ],
    })!;
    expect(digest).toContain("top_products: none recorded");
    expect(digest).toContain("wholesale_spend: none recorded (pre-0107 rollup or no wholesale lines this drop)");
  });

  it("includes shared suppliers and statewide supplier benchmarks with basis labels", () => {
    const digest = buildLocalAnalystDigest({
      dataset: DATASET,
      areas: [],
      competitors: [competitor()],
      sharedSuppliers: [
        {
          displayName: "Evergreen Farms",
          buyerCount: 3,
          buyerNames: ["PO Pot Shop", "Bay Buds", "Bremerton Bud"],
          totalSpendMinor: 3_300_000,
        },
      ],
      supplierStats: [
        {
          name: "Evergreen Farms LLC",
          dba: "Evergreen Farms",
          revenue_minor: 90_000_000,
          line_count: 4200,
          price_median_minor: 750,
          distinct_buyers: 140,
          tracked_buyers: 3,
        },
        {
          name: null,
          dba: null,
          revenue_minor: 95_000_000,
          line_count: 5000,
          price_median_minor: null,
          distinct_buyers: 200,
          tracked_buyers: 0,
        },
      ],
    })!;
    expect(digest).toContain("SHARED SUPPLIERS");
    expect(digest).toContain(
      "Evergreen Farms: sells to 3 tracked competitors (PO Pot Shop, Bay Buds, Bremerton Bud), observed spend $33000.00 this drop",
    );
    expect(digest).toContain("STATEWIDE SUPPLIER BENCHMARKS");
    // revenue-desc ordering: the unnamed 95M supplier first, honest fallback name
    const unnamed = digest.indexOf("(unnamed licensee)");
    const evergreen = digest.indexOf("Evergreen Farms: statewide wholesale revenue");
    expect(unnamed).toBeGreaterThan(-1);
    expect(evergreen).toBeGreaterThan(unnamed);
    expect(digest).toContain("median_wholesale_price=n/a");
    expect(digest).toContain("WHOLESALE prices, what stores PAY");
  });

  it("caps competitors at 15 and says how many are shown", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      competitor({ tradename: `Store ${i + 1}` }),
    );
    const digest = buildLocalAnalystDigest({
      dataset: DATASET,
      areas: [],
      competitors: many,
    })!;
    expect(digest).toContain("COMPETITORS (20 tracked, showing 15)");
    expect(digest).toContain("Store 15");
    expect(digest).not.toContain("Store 16");
  });
});
