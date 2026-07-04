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
