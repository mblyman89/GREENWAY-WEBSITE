/**
 * tests/compliance/benchmarks-history-core.test.ts — Task H S5.
 *
 * Covers the PURE month-over-month history shaping for the CCRS Benchmarks
 * page: overall-row selection, metric mapping (revenue rides in avg_minor),
 * honest nulls for missing months (never interpolated), attribution share,
 * and newest-first ordering.
 */
import { describe, it, expect } from "vitest";
import {
  buildTransformerHistory,
  type HistoryDatasetLike,
  type HistoryBenchmarkLike,
} from "@/lib/discovery/benchmarks-history-core";

function ds(overrides: Partial<HistoryDatasetLike> & { id: string }): HistoryDatasetLike {
  return {
    label: `CCRS monthly · ${overrides.id}`,
    period_start: "2026-05-01",
    period_end: "2026-05-31",
    retail_lines: 1000,
    attributed_retail_lines: 288,
    ...overrides,
  };
}

function bench(
  datasetId: string,
  metric: string,
  overrides: Partial<HistoryBenchmarkLike> = {},
): HistoryBenchmarkLike {
  return {
    dataset_id: datasetId,
    scope: "overall",
    scope_key: "all",
    metric,
    median_minor: null,
    avg_minor: null,
    value_num: null,
    ...overrides,
  };
}

describe("buildTransformerHistory", () => {
  it("maps overall rollups to one history row per dataset", () => {
    const rows = buildTransformerHistory(
      [ds({ id: "a" })],
      [
        bench("a", "retail_unit_price", { median_minor: 2500 }),
        bench("a", "retail_price_per_gram", { median_minor: 900 }),
        bench("a", "wholesale_unit_price", { median_minor: 1200 }),
        bench("a", "retail_units", { value_num: 123456 }),
        bench("a", "retail_revenue", { avg_minor: 987_654_321 }),
      ],
    );
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.retailMedianMinor).toBe(2500);
    expect(r.retailPpgMedianMinor).toBe(900);
    expect(r.wholesaleMedianMinor).toBe(1200);
    expect(r.retailUnits).toBe(123456);
    // Revenue rides in avg_minor per persistAggregationResult's benchmarkRows.
    expect(r.retailRevenueMinor).toBe(987_654_321);
    // 288/1000 attribution share, from the dataset's honest line totals.
    expect(r.attributedShare).toBeCloseTo(0.288, 6);
  });

  it("ignores non-overall rows and other datasets' rows", () => {
    const rows = buildTransformerHistory(
      [ds({ id: "a" })],
      [
        bench("a", "retail_unit_price", { scope: "type", scope_key: "Usable Marijuana", median_minor: 9999 }),
        bench("a", "retail_unit_price", { scope: "overall", scope_key: "other", median_minor: 8888 }),
        bench("zzz", "retail_unit_price", { median_minor: 7777 }),
      ],
    );
    expect(rows[0].retailMedianMinor).toBeNull();
  });

  it("renders honest nulls for missing metrics and unknown attribution", () => {
    const rows = buildTransformerHistory(
      [ds({ id: "a", retail_lines: null, attributed_retail_lines: null })],
      [],
    );
    const r = rows[0];
    expect(r.retailMedianMinor).toBeNull();
    expect(r.retailPpgMedianMinor).toBeNull();
    expect(r.wholesaleMedianMinor).toBeNull();
    expect(r.retailUnits).toBeNull();
    expect(r.retailRevenueMinor).toBeNull();
    expect(r.attributedShare).toBeNull();
  });

  it("guards against division by zero retail lines", () => {
    const rows = buildTransformerHistory(
      [ds({ id: "a", retail_lines: 0, attributed_retail_lines: 0 })],
      [],
    );
    expect(rows[0].attributedShare).toBeNull();
  });

  it("orders newest period first, null periods last, then label desc", () => {
    const rows = buildTransformerHistory(
      [
        ds({ id: "apr", label: "CCRS monthly · 2026-04", period_end: "2026-04-30" }),
        ds({ id: "may", label: "CCRS monthly · 2026-05", period_end: "2026-05-31" }),
        ds({ id: "unk", label: "CCRS monthly · unknown", period_start: null, period_end: null }),
      ],
      [],
    );
    expect(rows.map((r) => r.datasetId)).toEqual(["may", "apr", "unk"]);
  });

  it("rounds fractional minor units and rejects negatives (never a guessed price)", () => {
    const rows = buildTransformerHistory(
      [ds({ id: "a" })],
      [
        bench("a", "retail_unit_price", { median_minor: 2500.6 }),
        bench("a", "wholesale_unit_price", { median_minor: -5 }),
      ],
    );
    expect(rows[0].retailMedianMinor).toBe(2501);
    expect(rows[0].wholesaleMedianMinor).toBeNull();
  });
});
