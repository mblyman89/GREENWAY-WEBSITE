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
