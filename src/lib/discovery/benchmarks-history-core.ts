/**
 * src/lib/discovery/benchmarks-history-core.ts
 *
 * PURE month-over-month history shaping for the CCRS Benchmarks page
 * (Task H, S5). The owner confirmed keeping history rollups: every monthly
 * transformer drop persists its own dataset, so trends come from lining up
 * each dataset's OVERALL (scope="overall", scope_key="all") benchmark rows.
 *
 * Standing rules honored:
 *  - NEVER GUESS: a month missing a metric renders null (UI shows "—"),
 *    never an interpolated value.
 *  - Money in MINOR UNITS end to end.
 *  - Pure module: no I/O — covered by tests/compliance/benchmarks-history-core.test.ts.
 */

// Structural inputs — match DiscoveryDataset / DiscoveryBenchmark rows.
export type HistoryDatasetLike = {
  id: string;
  label: string;
  period_start: string | null;
  period_end: string | null;
  retail_lines?: number | null;
  attributed_retail_lines?: number | null;
};

export type HistoryBenchmarkLike = {
  dataset_id: string;
  scope: string;
  scope_key: string;
  metric: string;
  median_minor: number | null;
  avg_minor: number | null;
  value_num: number | null;
};

export type TransformerHistoryRow = {
  datasetId: string;
  label: string;
  periodStart: string | null;
  periodEnd: string | null;
  /** Statewide median retail unit price (minor units) for the month. */
  retailMedianMinor: number | null;
  /** Statewide median retail $/gram (minor units). */
  retailPpgMedianMinor: number | null;
  /** Statewide median wholesale unit price (minor units). */
  wholesaleMedianMinor: number | null;
  /** Total statewide retail units sold. */
  retailUnits: number | null;
  /** Total statewide retail revenue (minor units). */
  retailRevenueMinor: number | null;
  /**
   * Share (0..1) of the month's retail lines whose product joins resolved
   * inside the same delta file — the honesty metric. Null when unknown.
   */
  attributedShare: number | null;
};

function minorOrNull(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/**
 * Line up each transformer dataset's overall rollups into one history row per
 * month, newest first (period_end desc, nulls last, then label desc for a
 * stable order). Only scope="overall", scope_key="all" benchmark rows are
 * consulted; anything else is ignored.
 */
export function buildTransformerHistory(
  datasets: HistoryDatasetLike[],
  benchmarks: HistoryBenchmarkLike[],
): TransformerHistoryRow[] {
  // Index the overall rows per dataset per metric.
  const byDataset = new Map<string, Map<string, HistoryBenchmarkLike>>();
  for (const b of benchmarks) {
    if (b.scope !== "overall" || b.scope_key !== "all") continue;
    let m = byDataset.get(b.dataset_id);
    if (!m) {
      m = new Map();
      byDataset.set(b.dataset_id, m);
    }
    m.set(b.metric, b);
  }

  const rows: TransformerHistoryRow[] = datasets.map((d) => {
    const m = byDataset.get(d.id);
    const retailPrice = m?.get("retail_unit_price") ?? null;
    const retailPpg = m?.get("retail_price_per_gram") ?? null;
    const wholesalePrice = m?.get("wholesale_unit_price") ?? null;
    const retailUnits = m?.get("retail_units") ?? null;
    const retailRevenue = m?.get("retail_revenue") ?? null;

    const retailLines = d.retail_lines ?? null;
    const attributed = d.attributed_retail_lines ?? null;
    const attributedShare =
      retailLines != null && attributed != null && retailLines > 0
        ? attributed / retailLines
        : null;

    return {
      datasetId: d.id,
      label: d.label,
      periodStart: d.period_start,
      periodEnd: d.period_end,
      retailMedianMinor: minorOrNull(retailPrice?.median_minor),
      retailPpgMedianMinor: minorOrNull(retailPpg?.median_minor),
      wholesaleMedianMinor: minorOrNull(wholesalePrice?.median_minor),
      retailUnits:
        retailUnits?.value_num != null && Number.isFinite(retailUnits.value_num)
          ? retailUnits.value_num
          : null,
      // Revenue rides in avg_minor (persistAggregationResult's benchmarkRows).
      retailRevenueMinor: minorOrNull(retailRevenue?.avg_minor),
      attributedShare,
    };
  });

  rows.sort((a, b) => {
    if (a.periodEnd && b.periodEnd && a.periodEnd !== b.periodEnd) {
      return a.periodEnd < b.periodEnd ? 1 : -1;
    }
    if (a.periodEnd && !b.periodEnd) return -1;
    if (!a.periodEnd && b.periodEnd) return 1;
    return b.label.localeCompare(a.label);
  });

  return rows;
}
