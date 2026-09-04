// Database row types for the Slice 2 POS import / menu-version tables.
// These mirror supabase/migrations/0002_slice2_pos_import.sql.

export type PosImportStatus =
  | "uploaded"
  | "processing"
  | "staged"
  | "published"
  | "failed";

export type MenuVersionStatus = "staged" | "published" | "archived";

export type DiagnosticSeverity = "error" | "warning" | "info";

export type PosImport = {
  id: string;
  uploaded_by: string | null;
  products_storage_key: string | null;
  inventories_storage_key: string | null;
  products_filename: string | null;
  inventories_filename: string | null;
  products_file_hash: string | null;
  inventories_file_hash: string | null;
  products_size_bytes: number | null;
  inventories_size_bytes: number | null;
  status: PosImportStatus;
  is_test?: boolean;
  summary_json: unknown | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PosImportDiagnostic = {
  id: string;
  import_id: string;
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  context_json: unknown | null;
  created_at: string;
};

// SLICE 57: one human decision per (import, staged row) in the golden-record
// exception queue (migration 0139). action 'fix' carries the corrected facts.
export type PosFactReview = {
  id: string;
  import_id: string;
  source_item_id: string;
  action: "approve" | "fix" | "reject";
  note: string | null;
  corrected_facts_json: unknown | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MenuVersion = {
  id: string;
  import_id: string | null;
  status: MenuVersionStatus;
  is_test?: boolean;
  item_count: number;
  variant_count: number;
  vendor_count: number;
  hidden_count: number;
  error_count: number;
  warning_count: number;
  summary_json: unknown | null;
  notes: string | null;
  created_by: string | null;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MenuItemRow = {
  id: string;
  menu_version_id: string;
  source_item_id: string;
  name: string;
  product_name: string | null;
  brand_name: string;
  vendor_name: string | null;
  category: string;
  filter_categories: string[];
  pos_inventory_type: string | null;
  pos_inventory_category: string | null;
  strain_type: string;
  strain_name: string | null;
  thc: string | null;
  cbd: string | null;
  total_thc_json: unknown | null;
  total_cbd_json: unknown | null;
  compounds_json: unknown;
  // SLICE 56: structured facts (migration 0138) — verified-only, null = "not verified".
  servings_per_pack: number | null;
  mg_per_serving: number | null;
  package_thc_mg: number | null;
  /**
   * SLICE 16 (migration 0216) — the low-THC beverage classification.
   *
   * true  = packaged in individual units of ≤ 4 mg active delta-9 THC, so this
   *         product is carved out of the 72 oz liquid limit and counts against
   *         the separate 200 mg THC limit (WAC 314-55-095(1)(d)(i)(E)+(F)).
   * false = reviewed and does NOT qualify.
   * null  = not yet classified. Treated as a NORMAL liquid (fail-safe).
   *
   * DISTINCT from mg_per_serving above: a single bottle labelled "4 servings ×
   * 4 mg" is ONE 16 mg unit and does not qualify, so this can never be derived
   * from the serving facts.
   */
  low_thc_liquid: boolean | null;
  /** SLICE 16 — mg of active delta-9 THC in ONE sellable unit (one can). */
  unit_thc_mg: number | null;
  /**
   * SLICE 17 — "product otherwise taken into the body", WAC 314-55-010(40):
   * "intended for uses other than inhalation, oral ingestion, or external
   * application to the skin". In practice a suppository.
   *
   * true  = counts against the TEN UNIT limit, WAC 314-55-095(1)(d)(i)(D).
   * false = reviewed and does NOT qualify.
   * null  = not yet reviewed.
   *
   * READ THE FAIL-SAFE CAREFULLY — IT IS THE REVERSE OF low_thc_liquid ABOVE.
   * An unflagged suppository is categorised `topical`, which buckets as a
   * 2016 g liquid, i.e. effectively unlimited. So null here is PERMISSIVE, not
   * conservative. It cannot be derived from category, because one `topical`
   * shelf holds both skin balms (72 oz) and suppositories (10 units).
   */
  otherwise_taken: boolean | null;
  /**
   * SLICE 17 — individual consumable items in one package, per RCW 69.50.101
   * ("an individual consumable item within a package of one or more
   * consumable items"). A box of six suppositories is 6.
   *
   * DISTINCT from servings_per_pack: servings divide ONE container by dose,
   * units are physically separate items.
   */
  units_per_package: number | null;
  package_cbd_mg: number | null;
  ratio_label: string | null;
  net_weight_grams: number | null;
  net_volume_ml: number | null;
  fact_provenance: unknown;
  description: string;
  price_label: string;
  price_minor_units: number;
  inventory_status: string;
  hidden: boolean;
  hidden_reason: string | null;
  sort_order: number;
  created_at: string;
};

export type MenuVariantRow = {
  id: string;
  menu_item_id: string;
  source_variant_id: string;
  label: string;
  price_minor_units: number;
  inventory_level: number;
  medical: boolean;
  sort_order: number;
  created_at: string;
};
