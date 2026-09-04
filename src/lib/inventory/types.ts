// Row types for the POS Slice 3 inventory tables.
// Mirror supabase/migrations/0023_pos_inventory_lots.sql.

export type ManifestCoaLink = {
  product_name: string | null;
  lot_code: string | null;
  lab_result_id: string | null;
  coa_url: string;
  release_date: string | null;
  expire_date: string | null;
};

export type InboundManifest = {
  id: string;
  manifest_number: string | null;
  vendor_id: string | null;
  vendor_label: string | null;
  transfer_date: string | null;
  raw_payload: unknown | null;
  /** URL the transfer was fetched from, if imported via Transfer Data Link. */
  source_url: string | null;
  /** "wcia" | "generic" — how the payload was recognized. */
  source_format: string;
  /** Captured COA references (snapshot for the KB). */
  coa_links: ManifestCoaLink[];
  status: string; // pending | in_transit | received | accepted | partially_accepted | rejected
  notes: string | null;
  /**
   * Owner-entered Invoice/Order # correction (migration 0151). When non-null it
   * OVERRIDES the value derived from raw_payload/manifest_number in the intake
   * UI. Null means "use the derived value" (the original behavior).
   */
  invoice_number_override?: string | null;
  // Denormalized lot rollups for the partial-accept badge (migration 0059).
  accepted_lot_count?: number;
  rejected_lot_count?: number;
  // --- Lifecycle timestamps + ETA (Slice 18/74, migration 0032). All nullable. ---
  in_transit_at: string | null;
  received_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  /** Expected arrival date (YYYY-MM-DD) for an in-transit manifest. */
  eta_date: string | null;
  // --- Transport / chain-of-custody (Slice 33, migration 0044). All nullable. ---
  transporter_name: string | null;
  transporter_license: string | null;
  driver_name: string | null;
  driver_license_number: string | null;
  vehicle_description: string | null;
  vehicle_plate: string | null;
  vehicle_vin: string | null;
  departed_at: string | null;
  arrived_at: string | null;
  route_notes: string | null;
  transport_recorded_by: string | null;
  transport_recorded_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Editable transport fields for the manifest intake screen. */
export type ManifestTransportInput = {
  transporter_name: string | null;
  transporter_license: string | null;
  driver_name: string | null;
  driver_license_number: string | null;
  vehicle_description: string | null;
  vehicle_plate: string | null;
  vehicle_vin: string | null;
  departed_at: string | null;
  arrived_at: string | null;
  route_notes: string | null;
  /** Expected arrival date (YYYY-MM-DD); surfaced for in-transit tracking. */
  eta_date: string | null;
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
  /** Path in the private `coa` storage bucket once the PDF is archived. */
  coa_storage_path: string | null;
  coa_archived_at: string | null;
  coa_file_bytes: number | null;
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
  /** "indica" | "sativa" | "hybrid" | null (migration 0138 — Rule 1.4, own box). */
  strain_type: string | null;
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
  /**
   * SLICE 2 (migration 0214) — the day this lot was ACTUALLY received, as
   * evidenced by the POS export, a manifest, or the owner.
   *
   * `null` means "no received date on file" and is a real, meaningful state:
   * it is NEVER backfilled from `created_at` (the import instant), because
   * that would tell the LCB the lot was created on migration day. Undated
   * lots are surfaced as a worklist for the owner to resolve, exactly like
   * migration 0191's `last_counted_at` — evidence, not decoration.
   */
  received_on: string | null;
  /** Where `received_on` came from: pos_import | manifest | owner_entered. */
  received_on_source: string | null;
  /** Who set `received_on` (null for machine-evidenced values). */
  received_on_set_by: string | null;
  /** When `received_on` was set. */
  received_on_set_at: string | null;
  /**
   * SLICE 16/17 (migrations 0216 :100-103, 0217 :162-170) — the two special
   * sales-limit classifications, mirrored onto the lot.
   *
   * These columns have existed since 0216/0217 but were never declared on this
   * type, which is why nothing could read them back in TypeScript. SLICE 18A
   * declares them because the inventory detail page now edits them.
   *
   * READ THE ROLE CAREFULLY: on the lot row these are PROVENANCE, not the
   * enforced value. The register reads the limit flags off the MENU row
   * (live-menu.ts:94-100); nothing enforces from here. They exist so the
   * receiving dock's warning and CCRS-style reporting can tell "a human
   * answered this" from "nobody has been asked".
   *
   * `null` therefore means UNKNOWN, never "no" — the same doctrine
   * `received_on` above establishes. In particular every lot created by the
   * one-time Cultivera import carries NULL here (import-service.ts:588-616
   * writes none of them), which is NOT evidence that the product is ordinary.
   */
  low_thc_liquid: boolean | null;
  /** mg of active delta-9 THC in ONE sealed container. Null = not stated. */
  unit_thc_mg: number | null;
  /** True = taken otherwise into the body (WAC 314-55-095(1)(d)(i)(D)). */
  otherwise_taken: boolean | null;
  /** Units inside one sellable package; the 10-unit limit counts in units. */
  units_per_package: number | null;
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
