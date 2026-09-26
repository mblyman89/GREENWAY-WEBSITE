/**
 * src/lib/pos/menu-columns-core.ts
 *
 * USAGE-2 — EXPLICIT COLUMN LISTS FOR THE MENU TABLES. PURE.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * Supabase bills egress on the UNCOMPRESSED PostgREST response body. The
 * published menu is ~4,500 `menu_items` rows plus their variants, and every
 * full read of it (`getVersionItems`) used `select("*")`. That carried two
 * columns nobody downstream reads:
 *
 *   - `doh_compliant`   (migration 0040) — zero readers anywhere in `src/`,
 *     and not even a field of `MenuItemRow`; it rode along only because of
 *     the wildcard. Listing the type's fields drops it by construction.
 *   - `fact_provenance` (migration 0138) — a jsonb blob written by the import
 *     pipeline and read ONLY by reprocess-store through its own explicit
 *     column list. No consumer of `getVersionItems` touches it. It IS a field
 *     of `MenuItemRow`, so it is dropped explicitly below.
 *
 * and `getPublishedVersion()` carried `menu_versions.summary_json`, the import
 * diagnostics blob, which none of its 38 callers dereference (they read `.id`
 * — verified by grep; the admin pages that DO read `summary_json` get their
 * rows from `getVersion` / `listVersions` / `listIntakeStagedVersions`, which
 * are untouched).
 *
 * HOW THE LIST STAYS HONEST
 * ─────────────────────────
 * Each list is derived from an object typed `Record<keyof Row, true>` with the
 * dropped columns removed via `Omit`. Add a field to `MenuItemRow` in
 * db-types.ts without adding it here and `tsc` fails — the list cannot drift
 * behind the type. The self-test below additionally proves the rendered
 * string is well-formed and that the dropped columns are really absent.
 *
 * `getVersionItems` still returns `MenuItemRow`; the two dropped fields are
 * typed as present but arrive `undefined`. Every reader already treats them as
 * optional (`?? null`), and the self-test pins the exact dropped set so a
 * future reader of either column has a single place to restore it.
 */
import type { MenuItemRow, MenuVariantRow, MenuVersion } from "@/lib/pos/db-types";

/** Columns on `menu_items` deliberately NOT fetched by the full-menu loaders. */
export const MENU_ITEM_DROPPED_COLUMNS = ["fact_provenance"] as const;
export type MenuItemDroppedColumn = (typeof MENU_ITEM_DROPPED_COLUMNS)[number];

/**
 * Every `MenuItemRow` field EXCEPT the dropped ones. `satisfies` makes this a
 * compile-time contract with db-types.ts: a missing or misspelled key is a
 * type error.
 */
const MENU_ITEM_COLUMN_MAP = {
  id: true,
  menu_version_id: true,
  source_item_id: true,
  name: true,
  product_name: true,
  brand_name: true,
  vendor_name: true,
  category: true,
  filter_categories: true,
  pos_inventory_type: true,
  pos_inventory_category: true,
  strain_type: true,
  strain_name: true,
  thc: true,
  cbd: true,
  total_thc_json: true,
  total_cbd_json: true,
  compounds_json: true,
  servings_per_pack: true,
  mg_per_serving: true,
  package_thc_mg: true,
  low_thc_liquid: true,
  unit_thc_mg: true,
  otherwise_taken: true,
  units_per_package: true,
  package_cbd_mg: true,
  ratio_label: true,
  net_weight_grams: true,
  net_volume_ml: true,
  description: true,
  price_label: true,
  price_minor_units: true,
  inventory_status: true,
  hidden: true,
  hidden_reason: true,
  sort_order: true,
  created_at: true,
} satisfies Record<Exclude<keyof MenuItemRow, MenuItemDroppedColumn>, true>;

/** Every `MenuVariantRow` field. The table has no wide columns; this list exists so the type contract holds. */
const MENU_VARIANT_COLUMN_MAP = {
  id: true,
  menu_item_id: true,
  source_variant_id: true,
  label: true,
  price_minor_units: true,
  inventory_level: true,
  medical: true,
  sort_order: true,
  created_at: true,
} satisfies Record<keyof MenuVariantRow, true>;

/** Columns on `menu_versions` NOT fetched by `getPublishedVersion()`. */
export const MENU_VERSION_DROPPED_COLUMNS = ["summary_json"] as const;
export type MenuVersionDroppedColumn = (typeof MENU_VERSION_DROPPED_COLUMNS)[number];

const MENU_VERSION_COLUMN_MAP = {
  id: true,
  import_id: true,
  status: true,
  is_test: true,
  item_count: true,
  variant_count: true,
  vendor_count: true,
  hidden_count: true,
  error_count: true,
  warning_count: true,
  notes: true,
  created_by: true,
  published_at: true,
  published_by: true,
  created_at: true,
  updated_at: true,
} satisfies Record<Exclude<keyof MenuVersion, MenuVersionDroppedColumn>, true>;

function render(map: Record<string, true>): string {
  return Object.keys(map).join(", ");
}

/** PostgREST `select` string for a full-menu `menu_items` read. */
export const MENU_ITEM_COLUMNS: string = render(MENU_ITEM_COLUMN_MAP);
/** PostgREST `select` string for a `menu_variants` read. */
export const MENU_VARIANT_COLUMNS: string = render(MENU_VARIANT_COLUMN_MAP);
/** PostgREST `select` string for `getPublishedVersion()` (no `summary_json`). */
export const MENU_VERSION_LIGHT_COLUMNS: string = render(MENU_VERSION_COLUMN_MAP);

/** The array forms, for callers that want to reason about membership. */
export const MENU_ITEM_COLUMN_LIST: readonly string[] = Object.keys(MENU_ITEM_COLUMN_MAP);
export const MENU_VARIANT_COLUMN_LIST: readonly string[] = Object.keys(MENU_VARIANT_COLUMN_MAP);
export const MENU_VERSION_LIGHT_COLUMN_LIST: readonly string[] = Object.keys(MENU_VERSION_COLUMN_MAP);

/** Is `column` fetched by the full-menu item read? */
export function isMenuItemColumnFetched(column: string): boolean {
  return MENU_ITEM_COLUMN_LIST.includes(column);
}

// ── Self-test ────────────────────────────────────────────────────────────────
function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[menu-columns-core] self-test failed: ${msg}`);
}

const IDENT = /^[a-z][a-z0-9_]*$/;

export function __runMenuColumnsCoreTests(): void {
  // Well-formed select strings: comma+space separated lowercase identifiers,
  // no wildcard, no duplicates.
  for (const [name, list, str] of [
    ["item", MENU_ITEM_COLUMN_LIST, MENU_ITEM_COLUMNS],
    ["variant", MENU_VARIANT_COLUMN_LIST, MENU_VARIANT_COLUMNS],
    ["version", MENU_VERSION_LIGHT_COLUMN_LIST, MENU_VERSION_LIGHT_COLUMNS],
  ] as const) {
    check(list.length > 0, `${name} list is non-empty`);
    check(!str.includes("*"), `${name} select has no wildcard`);
    check(str === list.join(", "), `${name} string matches list`);
    check(new Set(list).size === list.length, `${name} list has no duplicates`);
    for (const c of list) check(IDENT.test(c), `${name} column "${c}" is a plain identifier`);
  }

  // The dropped columns are really dropped.
  for (const c of MENU_ITEM_DROPPED_COLUMNS) {
    check(!MENU_ITEM_COLUMN_LIST.includes(c), `menu_items.${c} is not fetched`);
    check(!isMenuItemColumnFetched(c), `isMenuItemColumnFetched(${c}) is false`);
  }
  for (const c of MENU_VERSION_DROPPED_COLUMNS) {
    check(!MENU_VERSION_LIGHT_COLUMN_LIST.includes(c), `menu_versions.${c} is not fetched`);
  }

  // The columns the money/limits/website paths depend on are ALL present.
  // (menuRowToGreenwayItem, order-pricing, sale-decrement, purchase limits.)
  for (const c of [
    "id",
    "menu_version_id",
    "source_item_id",
    "name",
    "product_name",
    "brand_name",
    "vendor_name",
    "category",
    "filter_categories",
    "pos_inventory_type",
    "pos_inventory_category",
    "strain_type",
    "strain_name",
    "thc",
    "cbd",
    "total_thc_json",
    "total_cbd_json",
    "compounds_json",
    "low_thc_liquid",
    "unit_thc_mg",
    "otherwise_taken",
    "units_per_package",
    "net_weight_grams",
    "net_volume_ml",
    "servings_per_pack",
    "mg_per_serving",
    "package_thc_mg",
    "package_cbd_mg",
    "ratio_label",
    "description",
    "price_label",
    "price_minor_units",
    "inventory_status",
    "hidden",
    "hidden_reason",
    "sort_order",
  ]) {
    check(isMenuItemColumnFetched(c), `menu_items.${c} is fetched`);
  }
  for (const c of ["id", "menu_item_id", "source_variant_id", "label", "price_minor_units", "inventory_level", "medical", "sort_order"]) {
    check(MENU_VARIANT_COLUMN_LIST.includes(c), `menu_variants.${c} is fetched`);
  }
  for (const c of ["id", "status", "item_count", "variant_count", "vendor_count", "published_at", "created_at", "import_id"]) {
    check(MENU_VERSION_LIGHT_COLUMN_LIST.includes(c), `menu_versions.${c} is fetched`);
  }

  // Exact sizes, so an accidental addition or removal is visible in review.
  check(MENU_ITEM_COLUMN_LIST.length === 37, `menu_items fetches 37 columns (got ${MENU_ITEM_COLUMN_LIST.length})`);
  check(MENU_VARIANT_COLUMN_LIST.length === 9, `menu_variants fetches 9 columns (got ${MENU_VARIANT_COLUMN_LIST.length})`);
  check(MENU_VERSION_LIGHT_COLUMN_LIST.length === 16, `menu_versions light fetches 16 columns (got ${MENU_VERSION_LIGHT_COLUMN_LIST.length})`);
  check(isMenuItemColumnFetched("nonexistent_column") === false, "unknown column is not fetched");
}
