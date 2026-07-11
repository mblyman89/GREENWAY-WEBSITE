/**
 * src/lib/discovery/types.ts
 *
 * TypeScript types mirroring the discovery_* tables (migration 0078). Money is
 * always in MINOR UNITS (cents). Kept free of server-only imports so both the
 * server store and client islands can share them.
 */
import type { MatchState } from "./reconcile";

export type DiscoverySourceKind =
  | "wslcb_license_list"
  | "market_data"
  | "vendor_site"
  | "trade_show"
  | "manual"
  | "other";

export type DiscoveryVendorStatus =
  | "new"
  | "reviewing"
  | "contacted"
  | "qualified"
  | "onboarded"
  | "dismissed";

export type DiscoveryProductStatus =
  | "new"
  | "reviewing"
  | "shortlisted"
  | "ordered"
  | "dismissed";

export type DiscoveryPriority = "high" | "med" | "low";

export type DiscoverySettings = {
  id: number;
  enabled: boolean;
  default_market: string;
  created_at: string;
  updated_at: string;
};

export type DiscoverySource = {
  id: string;
  kind: DiscoverySourceKind;
  name: string;
  url: string | null;
  commercial_use_ok: boolean;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type DiscoveryVendorLead = {
  id: string;
  source_id: string | null;
  legal_name: string | null;
  display_name: string;
  license_number: string | null;
  city: string | null;
  website: string | null;
  email: string | null;
  status: DiscoveryVendorStatus;
  priority: DiscoveryPriority;
  matched_vendor_id: string | null;
  match_state: MatchState;
  note: string | null;
  dedupe_key: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DiscoveryProductLead = {
  id: string;
  source_id: string | null;
  vendor_lead_id: string | null;
  product_name: string;
  brand: string | null;
  category: string | null;
  pack_size: string | null;
  est_unit_cost_minor_units: number | null;
  est_retail_minor_units: number | null;
  demand_signal: string | null;
  status: DiscoveryProductStatus;
  priority: DiscoveryPriority;
  note: string | null;
  promoted_po_id: string | null;
  dedupe_key: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// CCRS benchmark command center (migration 0079)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Local competitor & area benchmarking (0080)
// ---------------------------------------------------------------------------
export type DiscoveryCompetitorArea =
  | "port_orchard"
  | "bremerton"
  | "silverdale"
  | "tacoma"
  | "key_peninsula"
  | "kitsap_other"
  | "other";

export type DiscoveryCompetitor = {
  license_number: string;
  tradename: string;
  city: string | null;
  county: string | null;
  area: DiscoveryCompetitorArea;
  is_self: boolean;
  is_active: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
};

/** One competitor's price/cost profile computed from an uploaded CCRS dataset. */
export type CompetitorProfile = {
  license_number: string;
  tradename: string;
  city: string | null;
  area: DiscoveryCompetitorArea;
  is_self: boolean;
  // retail (what they SELL for)
  retailSales: number;
  retailMedianMinor: number | null;
  retailAvgMinor: number | null;
  retailPerGramMedianMinor: number | null;
  // wholesale (what they PAY vendors) — rows where they are the buyer
  wholesaleBuys: number;
  wholesaleMedianMinor: number | null;
  wholesaleSpendMinor: number; // total $ they spent buying
  // sourcing
  topVendors: Array<{ license_number: string; name: string | null; spendMinor: number; units: number }>;
  topCategories: Array<{ category: string; units: number; revenueMinor: number }>;
};

/** Area-level roll-up across all competitors in that area (excludes self by default). */
export type AreaBenchmark = {
  area: DiscoveryCompetitorArea;
  storeCount: number;
  retailSales: number;
  retailMedianMinor: number | null;
  retailAvgMinor: number | null;
  retailPerGramMedianMinor: number | null;
  wholesaleMedianMinor: number | null;
};

export type DiscoveryDatasetStatus = "uploading" | "ready" | "error";

/** Mirrors CCRS Sale.SaleType, normalized. */
export type CcrsSaleType = "retail" | "medical" | "wholesale" | "other";

export type DiscoveryLicenseeRole =
  | "producer"
  | "processor"
  | "producer_processor"
  | "retailer"
  | "lab"
  | "unknown";

export type DiscoveryDataset = {
  id: string;
  label: string;
  period_start: string | null;
  period_end: string | null;
  status: DiscoveryDatasetStatus;
  source_note: string | null;
  sales_rows: number;
  product_rows: number;
  inventory_rows: number;
  lab_rows: number;
  strain_rows: number;
  error: string | null;
  benchmarks_computed_at: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  // Task H (migration 0106) — monthly-zip transformer bookkeeping. Nullable so
  // datasets created before 0106 (or before the transformer) read cleanly.
  retail_lines?: number | null;
  wholesale_lines?: number | null;
  attributed_retail_lines?: number | null;
  ingest_kind?: string | null; // 'csv' | 'monthly_zip'
};

/** Row of discovery_competitor_stats (migration 0106). Money in minor units. */
export type DiscoveryCompetitorStatRow = {
  id: number;
  dataset_id: string;
  license_number: string;
  licensee_id: string | null;
  name: string | null;
  dba: string | null;
  city: string | null;
  retail_units: number;
  retail_revenue_minor: number;
  retail_line_count: number;
  price_sample_size: number;
  price_min_minor: number | null;
  price_p25_minor: number | null;
  price_median_minor: number | null;
  price_p75_minor: number | null;
  price_max_minor: number | null;
  price_avg_minor: number | null;
  by_type: Array<{ inventoryType: string; units: number; revenueMinor: number }>;
  top_products: Array<{
    productName: string;
    inventoryType: string | null;
    units: number;
    revenueMinor: number;
    medianUnitPriceMinor: number | null;
  }>;
  created_at: string;
};

/** Row of discovery_market_signals (migration 0106). Money in minor units. */
export type DiscoveryMarketSignalRow = {
  id: number;
  dataset_id: string;
  kind: "statewide_mover" | "competitor_mover";
  license_number: string | null;
  inventory_type: string | null;
  product_name: string | null;
  brand: string | null;
  strain_name: string | null;
  units: number;
  revenue_minor: number;
  median_unit_price_minor: number | null;
  p25_unit_price_minor: number | null;
  created_at: string;
};

/** Which CCRS collection file a given upload is. */
export type CcrsFileKind =
  | "sale"
  | "product"
  | "inventory"
  | "labtest"
  | "strain"
  | "unknown";

export type DiscoveryLicensee = {
  id: number;
  dataset_id: string;
  license_number: string;
  name: string | null;
  role: DiscoveryLicenseeRole;
  wholesale_out_units: number;
  wholesale_out_minor: number;
  created_at: string;
};

/** Scope + metric taxonomy for computed benchmarks. */
export type BenchmarkScope =
  | "category"
  | "type"
  | "category_type"
  | "brand"
  | "strain"
  | "overall";

export type BenchmarkMetric =
  | "wholesale_unit_price"
  | "retail_unit_price"
  | "price_per_gram"
  | "units"
  | "revenue"
  | "thc_pct"
  | "cbd_pct"
  // Task H monthly-extract transformer metrics (class-scoped so retail and
  // wholesale rollups never collide on the same scope/scope_key):
  | "retail_price_per_gram"
  | "wholesale_price_per_gram"
  | "retail_units"
  | "wholesale_units"
  | "retail_revenue"
  | "wholesale_revenue";

export type DiscoveryBenchmark = {
  id: number;
  dataset_id: string;
  scope: BenchmarkScope;
  scope_key: string;
  metric: BenchmarkMetric;
  sample_size: number;
  min_minor: number | null;
  p25_minor: number | null;
  median_minor: number | null;
  p75_minor: number | null;
  max_minor: number | null;
  avg_minor: number | null;
  value_num: number | null;
  period_start: string | null;
  period_end: string | null;
  computed_at: string;
};

/** Aggregated counts for the Discovery hub KPIs. */
export type DiscoverySnapshot = {
  configured: boolean;
  enabled: boolean;
  vendorLeads: {
    total: number;
    open: number; // not dismissed / onboarded
    unmatched: number; // new prospects we don't already buy from
    qualified: number;
  };
  productLeads: {
    total: number;
    open: number;
    shortlisted: number;
    ordered: number;
  };
};
