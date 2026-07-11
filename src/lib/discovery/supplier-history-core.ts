/**
 * src/lib/discovery/supplier-history-core.ts
 *
 * PURE new-vendor early detection (Task H, S13 — logged suggestion #5).
 * Compares the latest drop's statewide supplier benchmarks (migration 0109,
 * `discovery_supplier_stats`) against every PRIOR uploaded month: a supplier
 * present now but absent from all prior months with supplier data is a "first
 * appearance" — a candidate new producer/processor to call before competitors
 * lock in shelf space.
 *
 * HONESTY (NEVER GUESS):
 *  - The claim is strictly "first appearance within UPLOADED history" — never
 *    "new to the market". A supplier may have been active in months the owner
 *    hasn't uploaded, or below the top-100 cap in a prior month's rollup.
 *    That top-N caveat is structural: prior rollups only keep the biggest
 *    suppliers, so "absent from prior rollups" can mean "was smaller then".
 *    The UI copy must say both; this module exposes the counts to say it with.
 *  - Prior datasets uploaded BEFORE migration 0109 have zero supplier rows.
 *    Missing data is NOT evidence of absence — those months are excluded from
 *    the comparison and reported in `priorWithoutSupplierData` so the UI can
 *    tell the owner to re-upload those zips to backfill.
 *  - If NO prior month has supplier data, nothing is detectable: `detectable`
 *    is false and `newSuppliers` is empty rather than everything being
 *    (wrongly) called new.
 *  - Join key = LICENSE NUMBER (stable across months), fallback
 *    `id:<licensee_id>` — the same rule the S9 switching report uses.
 *  - Money in MINOR UNITS. Pure module (no I/O) — covered by
 *    tests/compliance/supplier-history-core.test.ts.
 */

// ---------------------------------------------------------------------------
// Inputs — structurally match DiscoverySupplierStatRow (only what we read).
// ---------------------------------------------------------------------------

export type SupplierHistoryStatLike = {
  licensee_id: string;
  license_number: string | null;
  name: string | null;
  dba: string | null;
  line_count: number;
  revenue_minor: number;
  distinct_buyers: number;
  tracked_buyers: number;
};

export type SupplierHistoryDatasetLike = {
  label: string;
  suppliers: SupplierHistoryStatLike[];
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type NewSupplierRow = {
  /** dba → name → "Licensee <id>" (same display fallbacks as S7/S10). */
  displayName: string;
  licenseNumber: string | null;
  licenseeId: string;
  lineCount: number;
  revenueMinor: number;
  distinctBuyers: number;
  trackedBuyers: number;
};

export type SupplierHistoryReport = {
  /** First-appearance suppliers in the latest drop, revenue desc. Capped. */
  newSuppliers: NewSupplierRow[];
  /** Pre-cap count of first-appearance suppliers. */
  newSupplierCount: number;
  /** Suppliers in the latest drop's rollup (comparison universe). */
  latestSupplierCount: number;
  /** Prior months that DO have supplier data (labels, order preserved). */
  priorWithSupplierData: string[];
  /** Prior months with NO supplier rows (pre-0109 uploads — need re-upload). */
  priorWithoutSupplierData: string[];
  /** False when no prior month has supplier data — nothing is detectable. */
  detectable: boolean;
};

/** Bound for the UI table. */
export const MAX_NEW_SUPPLIER_ROWS = 25;

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/** Stable cross-month join key: license number, fallback licensee id. */
export function supplierHistoryKey(s: SupplierHistoryStatLike): string {
  const license = (s.license_number ?? "").trim();
  return license !== "" ? license : `id:${String(s.licensee_id).trim()}`;
}

function displayName(s: SupplierHistoryStatLike): string {
  return s.dba?.trim() || s.name?.trim() || `Licensee ${s.licensee_id}`;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Detect first-appearance suppliers: present in `latest`, absent from every
 * prior dataset that actually has supplier data. Prior datasets without
 * supplier rows are excluded from the comparison (missing data ≠ absence) and
 * reported separately.
 */
export function buildSupplierHistoryReport(
  latest: SupplierHistoryStatLike[],
  prior: SupplierHistoryDatasetLike[],
  opts?: { max?: number },
): SupplierHistoryReport {
  const max = opts?.max ?? MAX_NEW_SUPPLIER_ROWS;

  const priorWithSupplierData: string[] = [];
  const priorWithoutSupplierData: string[] = [];
  const seen = new Set<string>();
  for (const ds of prior) {
    if (ds.suppliers.length > 0) {
      priorWithSupplierData.push(ds.label);
      for (const s of ds.suppliers) seen.add(supplierHistoryKey(s));
    } else {
      priorWithoutSupplierData.push(ds.label);
    }
  }

  const detectable = priorWithSupplierData.length > 0;

  let fresh: SupplierHistoryStatLike[] = [];
  if (detectable) {
    fresh = latest.filter((s) => !seen.has(supplierHistoryKey(s)));
    fresh.sort((a, b) => num(b.revenue_minor) - num(a.revenue_minor));
  }

  return {
    newSuppliers: fresh.slice(0, max).map((s) => ({
      displayName: displayName(s),
      licenseNumber: s.license_number?.trim() || null,
      licenseeId: String(s.licensee_id),
      lineCount: num(s.line_count),
      revenueMinor: Math.round(num(s.revenue_minor)),
      distinctBuyers: num(s.distinct_buyers),
      trackedBuyers: num(s.tracked_buyers),
    })),
    newSupplierCount: fresh.length,
    latestSupplierCount: latest.length,
    priorWithSupplierData,
    priorWithoutSupplierData,
    detectable,
  };
}
