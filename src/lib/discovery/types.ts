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
  | "cbd_pct";

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
