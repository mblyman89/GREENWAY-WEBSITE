// Row types for the POS Slice 3 inventory tables.
// Mirror supabase/migrations/0023_pos_inventory_lots.sql.

export type InboundManifest = {
  id: string;
  manifest_number: string | null;
  vendor_id: string | null;
  vendor_label: string | null;
  transfer_date: string | null;
  raw_payload: unknown | null;
  status: string; // pending | accepted | rejected
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LabResult = {
  id: string;
  labtest_external_identifier: string | null;
  lab_name: string | null;
  tested_on: string | null;
  thc_pct: number | null;
  cbd_pct: number | null;
  thca_pct: number | null;
  cbda_pct: number | null;
  total_thc_pct: number | null;
  total_cbd_pct: number | null;
  total_cannabinoids_pct: number | null;
  potency_json: unknown | null;
  terpenes_json: unknown | null;
  analytes_json: unknown | null;
  passed: boolean | null;
  source: string;
  coa_url: string | null;
  coa_release_date: string | null;
  coa_expire_date: string | null;
  raw_payload: unknown | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type InventoryLot = {
  id: string;
  lot_code: string | null;
  vendor_id: string | null;
  brand_id: string | null;
  manifest_id: string | null;
  lab_result_id: string | null;
  pos_product_key: string | null;
  product_name: string | null;
  strain_name: string | null;
  category: string | null;
  inventory_type: string | null;
  unit_weight: number | null;
  unit_weight_uom: string | null;
  is_sample: boolean;
  is_medical: boolean;
  received_qty: number;
  on_hand_qty: number;
  unit: string;
  unit_cost_minor_units: number | null;
  expires_on: string | null;
  status: string; // active | quarantine | recalled | sold_out | destroyed
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type InventoryAdjustment = {
  id: string;
  lot_id: string;
  qty_delta: number;
  reason: string;
  note: string | null;
  actor_id: string | null;
  created_at: string;
};

/** A lot joined with its resolved vendor/brand/lab names for display. */
export type LotWithDetail = InventoryLot & {
  vendor_name: string | null;
  brand_name: string | null;
  lab: LabResult | null;
};
