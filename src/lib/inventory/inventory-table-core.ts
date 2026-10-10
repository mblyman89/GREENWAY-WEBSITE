/**
 * R38 S2–S4 — the enterprise inventory table, as data.
 *
 * Owner: "I want it to be a professional, all inclusive, data rich,
 * enterprise grade table. If that means having stacked data in the rows, or
 * needing to scroll left and right to see all the data is fine with me."
 * And: "an option that lets me pick something like 25, 50, 100, all", a
 * numbered pager at the top AND bottom, and "an intelligent [export] that
 * allows me to export any and all data I need and want".
 *
 * ONE REGISTRY, FOUR CONSUMERS. Every column is declared once below. The
 * table header, the column picker, the presets and the export all read this
 * list, so a column that is on screen is always exportable, a header that
 * looks sortable is always sortable (sortKey → INVENTORY_COLUMN_SORTS), and
 * the export's data dictionary always describes the columns it wrote.
 *
 * Enterprise patterns adopted (researched, see docs/roadmap/R38-INVENTORY-TABLE.md):
 *   - column presets ("views") plus a custom column set, with a reset;
 *   - stacked cells on screen, but ONE value per column in the export
 *     (a spreadsheet cell holding "Phat Panda · Panda" cannot be filtered);
 *   - numbers exported as numbers, money as money, never as text;
 *   - a numbered pager with ellipses + first/prev/next/last + page size;
 *   - the export says what was filtered and what each column means.
 *
 * DOCTRINE (unchanged): unknown is blank, never zero.
 *
 * PURE. No I/O, no React.
 */
import { lotTypeLabel, lotSizeLabel, lotSoldQty, lotStrainTypeLabel } from "@/lib/inventory/lot-table-core";
import { lotThcValue, lotCbdValue, lotMinorValue, lotPotencySource } from "@/lib/pos/lot-potency-core";
import { intakePotencyUnit } from "@/lib/pos/intake-potency-core";
import { lotWebsiteCategoryOf, websiteCategorySourceLabel, type FilterableLot } from "@/lib/inventory/inventory-filter-core";
import { receivedOnSourceLabel } from "@/lib/inventory/received-date-core";
import { columnSortDef } from "@/lib/inventory/inventory-sort-core";
import { paramsFrom, type RawParams } from "@/lib/inventory/inventory-url-core";

/* ── Lot shape the table reads ───────────────────────────────────────────── */

/**
 * Everything the table and export read. All extras are optional because the
 * page reads `select("*")` (every column present) while tests pass minimal
 * rows; a missing field renders/exports as blank, never as a fake value.
 */
export type TableLot = FilterableLot & {
  manifest_id?: string | null;
  ccrs_inventory_external_id?: string | null;
  identity_key?: string | null;
  net_weight_grams?: number | null;
  net_volume_ml?: number | null;
  servings_per_pack?: number | null;
  mg_per_serving?: number | null;
  ratio_label?: string | null;
  package_thc_mg?: number | null;
  package_cbd_mg?: number | null;
  count_times_total?: number | null;
  unit_cost_source?: string | null;
  expires_on_source?: string | null;
  disposition?: string | null;
  reject_reason?: string | null;
  created_at?: string | null;
  lab: (FilterableLot["lab"] & {
    id?: string;
    tested_on?: string | null;
    labtest_external_identifier?: string | null;
    total_cannabinoids_pct?: number | null;
    coa_release_date?: string | null;
    coa_expire_date?: string | null;
    coa_storage_path?: string | null;
  }) | null;
};

/** Context the export needs beyond the row (Leafly is page-level state). */
export type TableContext = {
  leaflyKeys?: ReadonlySet<string>;
};

/* ── Column registry ─────────────────────────────────────────────────────── */

export type ColumnGroup =
  | "Identity"
  | "Product"
  | "Lab & potency"
  | "Stock & velocity"
  | "Money"
  | "Menu & onboarding"
  | "Compliance"
  | "Audit";

export const COLUMN_GROUPS: readonly ColumnGroup[] = [
  "Identity",
  "Product",
  "Lab & potency",
  "Stock & velocity",
  "Money",
  "Menu & onboarding",
  "Compliance",
  "Audit",
];

export type ExportType = "text" | "number" | "integer" | "currency";

/** One flat spreadsheet column. A stacked screen column exports as several. */
export type ExportField = {
  key: string;
  header: string;
  type: ExportType;
  /** Data-dictionary line written to the export's "Columns" sheet. */
  meaning: string;
  get: (lot: TableLot, ctx: TableContext) => string | number | null;
};

export type TableColumn = {
  /** Stable id used in `cols=`. Append only — bookmarked views depend on it. */
  id: string;
  label: string;
  group: ColumnGroup;
  align: "left" | "right" | "center";
  /** Key into INVENTORY_COLUMN_SORTS, when the header sorts. */
  sortKey?: string;
  fields: ExportField[];
};

const blank = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  return s === "" ? null : s;
};
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const yesNo = (v: boolean | null | undefined): string | null => (v == null ? null : v ? "Yes" : "No");
const day = (v: string | null | undefined): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? ""));
  return m ? m[1] : null;
};

/** Plain-English provenance for unit_cost_source (0215 check constraint). */
export function costSourceLabel(v: string | null | undefined): string | null {
  switch (v) {
    case "pos_import":
      return "POS import";
    case "invoice":
      return "Invoice";
    case "owner_entered":
      return "Entered by hand";
    default:
      return null;
  }
}

/** Plain-English provenance for expires_on_source (0215 + 0253). */
export function expirySourceLabel(v: string | null | undefined): string | null {
  switch (v) {
    case "pos_import":
      return "POS import";
    case "coa":
      return "COA";
    case "owner_entered":
      return "Entered by hand";
    case "manifest":
      return "Manifest";
    case "rule":
      return "Expiration rule";
    default:
      return null;
  }
}

/** Disposition (0059): pending | accepted | rejected_at_dock. */
export function dispositionLabel(v: string | null | undefined): string | null {
  switch (v) {
    case "pending":
      return "Pending";
    case "accepted":
      return "Accepted";
    case "rejected_at_dock":
      return "Rejected at dock";
    default:
      return null;
  }
}

/** The potency unit the THC/CBD figures are in ("%" or "mg"). */
export function potencyUnitOf(lot: Pick<TableLot, "inventory_type">): "%" | "mg" {
  return intakePotencyUnit(null, lot.inventory_type) === "mg" ? "mg" : "%";
}

/**
 * Compliance flags as short chips, only for KNOWN answers (null = unknown is
 * not a chip — the doctrine of 0216/0217).
 */
export function complianceFlags(lot: TableLot): string[] {
  const out: string[] = [];
  if (lot.is_medical) out.push("Medical");
  if (lot.is_sample) out.push("Sample");
  if (lot.low_thc_liquid === true) out.push("Low-THC liquid");
  if (lot.otherwise_taken === true) out.push("Taken otherwise");
  if (numOrNull(lot.units_per_package) != null) out.push(`${numOrNull(lot.units_per_package)} units/pkg`);
  if (numOrNull(lot.unit_thc_mg) != null) out.push(`${numOrNull(lot.unit_thc_mg)} mg THC/unit`);
  return out;
}

/** Pack facts as short lines (net content, servings, ratio). */
export function packFactLines(lot: TableLot): string[] {
  const out: string[] = [];
  const g = numOrNull(lot.net_weight_grams);
  const ml = numOrNull(lot.net_volume_ml);
  if (g != null) out.push(`${g} g net`);
  if (ml != null) out.push(`${ml} ml net`);
  const servings = numOrNull(lot.servings_per_pack);
  const mg = numOrNull(lot.mg_per_serving);
  if (servings != null && mg != null) out.push(`${servings} × ${mg} mg`);
  else if (servings != null) out.push(`${servings} servings`);
  else if (mg != null) out.push(`${mg} mg/serving`);
  const ratio = blank(lot.ratio_label);
  if (ratio) out.push(ratio);
  return out;
}

const m = (l: TableLot) => l.inv_metrics;

/**
 * THE REGISTRY. Order = on-screen order = export order. Append-only ids.
 * The first column (product) is always shown and frozen on screen.
 */
export const INVENTORY_TABLE_COLUMNS: readonly TableColumn[] = [
  {
    id: "product", label: "Product / lot", group: "Identity", align: "left", sortKey: "product",
    fields: [
      { key: "lot_id", header: "Lot ID", type: "text", meaning: "Internal lot id (opens /admin/inventory/<id>).", get: (l) => l.id },
      { key: "product", header: "Product", type: "text", meaning: "Product name on the lot.", get: (l) => blank(l.product_name) },
      { key: "lot_code", header: "Lot code", type: "text", meaning: "Lot / batch code.", get: (l) => blank(l.lot_code) },
    ],
  },
  {
    id: "ids", label: "IDs", group: "Identity", align: "left", sortKey: "lotcode",
    fields: [
      { key: "pos_key", header: "POS product key", type: "text", meaning: "Cultivera product key that links the lot to the menu and register.", get: (l) => blank(l.pos_product_key) },
      { key: "ccrs_id", header: "CCRS inventory ID", type: "text", meaning: "External id reported to the state (CCRS).", get: (l) => blank(l.ccrs_inventory_external_id) },
      { key: "identity_key", header: "Identity key", type: "text", meaning: "Product identity used by the knowledge base.", get: (l) => blank(l.identity_key) },
      { key: "manifest_id", header: "Manifest ID", type: "text", meaning: "Inbound manifest the lot arrived on.", get: (l) => blank(l.manifest_id) },
    ],
  },
  {
    id: "vendor", label: "Vendor · brand", group: "Identity", align: "left", sortKey: "vendor",
    fields: [
      { key: "vendor", header: "Vendor", type: "text", meaning: "Vendor (licensee) the lot was bought from.", get: (l) => blank(l.vendor_name) },
      { key: "brand", header: "Brand", type: "text", meaning: "Brand on the package.", get: (l) => blank(l.brand_name) },
    ],
  },
  {
    id: "type", label: "Type", group: "Product", align: "left", sortKey: "type",
    fields: [
      { key: "type", header: "Type", type: "text", meaning: "Product type shown in the table (category, onboarding pick, or derived).", get: (l) => { const t = lotTypeLabel(l); return t === "\u2014" ? null : blank(t); } },
      { key: "inventory_type", header: "Inventory type", type: "text", meaning: "State inventory type from the manifest / POS.", get: (l) => blank(l.inventory_type) },
      { key: "category", header: "Category", type: "text", meaning: "Raw category on the lot row.", get: (l) => blank(l.category) },
    ],
  },
  {
    id: "strain", label: "Strain", group: "Product", align: "left", sortKey: "strain",
    fields: [{ key: "strain", header: "Strain", type: "text", meaning: "Strain name.", get: (l) => blank(l.strain_name) }],
  },
  {
    id: "strainType", label: "Strain Type", group: "Product", align: "left", sortKey: "strainType",
    fields: [{ key: "strain_type", header: "Strain type", type: "text", meaning: "Indica / Sativa / Hybrid (lot first, then onboarding).", get: (l) => { const t = lotStrainTypeLabel(l); return t === "\u2014" ? null : t; } }],
  },
  {
    id: "size", label: "Size", group: "Product", align: "left", sortKey: "size",
    fields: [
      { key: "unit_size", header: "Unit size", type: "number", meaning: "Package size number.", get: (l) => numOrNull(l.unit_weight) },
      { key: "unit_size_uom", header: "Unit size UOM", type: "text", meaning: "Package size unit (g, mg, ml, ea).", get: (l) => (lotSizeLabel(l) === "\u2014" ? null : blank(l.unit_weight_uom)) },
    ],
  },
  {
    id: "pack", label: "Pack facts", group: "Product", align: "left",
    fields: [
      { key: "net_g", header: "Net weight (g)", type: "number", meaning: "Solid net weight, grams (0138).", get: (l) => numOrNull(l.net_weight_grams) },
      { key: "net_ml", header: "Net volume (ml)", type: "number", meaning: "Liquid net volume, ml (0138).", get: (l) => numOrNull(l.net_volume_ml) },
      { key: "servings", header: "Servings per pack", type: "number", meaning: "Servings in one package.", get: (l) => numOrNull(l.servings_per_pack) },
      { key: "mg_serving", header: "mg per serving", type: "number", meaning: "mg THC per serving.", get: (l) => numOrNull(l.mg_per_serving) },
      { key: "ratio", header: "Ratio", type: "text", meaning: "Cannabinoid ratio label (e.g. 1:1).", get: (l) => blank(l.ratio_label) },
    ],
  },
  {
    id: "coa", label: "COA", group: "Lab & potency", align: "center", sortKey: "coa",
    fields: [{ key: "has_coa", header: "Has COA", type: "text", meaning: "A lab result (COA) is linked to the lot.", get: (l) => (l.lab ? "Yes" : "No") }],
  },
  {
    id: "thc", label: "THC", group: "Lab & potency", align: "right", sortKey: "thc",
    fields: [
      { key: "thc", header: "THC", type: "number", meaning: "THC figure: COA first, else POS export; mg lots show verified package mg.", get: (l) => lotThcValue(l) },
      { key: "potency_unit", header: "Potency unit", type: "text", meaning: "Unit of the THC/CBD figures (% or mg).", get: (l) => (lotThcValue(l) == null && lotCbdValue(l) == null ? null : potencyUnitOf(l)) },
      { key: "potency_source", header: "Potency source", type: "text", meaning: "Where the THC figure came from (COA, POS export, verified package).", get: (l) => { const s = lotPotencySource(l); return s === "coa" ? "COA" : s === "pos" ? "POS export" : s === "package" ? "Verified package" : null; } },
    ],
  },
  {
    id: "cbd", label: "CBD", group: "Lab & potency", align: "right", sortKey: "cbd",
    fields: [{ key: "cbd", header: "CBD", type: "number", meaning: "CBD figure (same rules and unit as THC).", get: (l) => lotCbdValue(l) }],
  },
  {
    id: "cbg", label: "CBG", group: "Lab & potency", align: "right", sortKey: "cbg",
    fields: [{ key: "cbg_mg", header: "CBG (mg)", type: "number", meaning: "Verified package CBG, mg.", get: (l) => lotMinorValue(l, "cbg") }],
  },
  {
    id: "cbn", label: "CBN", group: "Lab & potency", align: "right", sortKey: "cbn",
    fields: [{ key: "cbn_mg", header: "CBN (mg)", type: "number", meaning: "Verified package CBN, mg.", get: (l) => lotMinorValue(l, "cbn") }],
  },
  {
    id: "cbc", label: "CBC", group: "Lab & potency", align: "right", sortKey: "cbc",
    fields: [{ key: "cbc_mg", header: "CBC (mg)", type: "number", meaning: "Verified package CBC, mg.", get: (l) => lotMinorValue(l, "cbc") }],
  },
  {
    id: "lab", label: "Lab", group: "Lab & potency", align: "left", sortKey: "lab",
    fields: [
      { key: "lab_name", header: "Lab", type: "text", meaning: "Testing lab on the COA.", get: (l) => blank(l.lab?.lab_name) },
      { key: "tested_on", header: "Tested on", type: "text", meaning: "Date the sample was tested.", get: (l) => day(l.lab?.tested_on) },
      { key: "lab_test_id", header: "Lab test ID", type: "text", meaning: "Lab's own test identifier.", get: (l) => blank(l.lab?.labtest_external_identifier) },
      { key: "total_cannabinoids", header: "Total cannabinoids %", type: "number", meaning: "Total cannabinoids, percent, from the COA.", get: (l) => numOrNull(l.lab?.total_cannabinoids_pct) },
      { key: "lab_result", header: "Lab result", type: "text", meaning: "PASS / FAIL on the COA.", get: (l) => (l.lab?.passed == null ? null : l.lab.passed ? "PASS" : "FAIL") },
    ],
  },
  {
    id: "coaexp", label: "COA expiry", group: "Lab & potency", align: "left", sortKey: "coaexp",
    fields: [
      { key: "coa_released", header: "COA released", type: "text", meaning: "COA release date.", get: (l) => day(l.lab?.coa_release_date) },
      { key: "coa_expires", header: "COA expires", type: "text", meaning: "COA expiry date.", get: (l) => day(l.lab?.coa_expire_date) },
      { key: "coa_days_left", header: "COA days left", type: "integer", meaning: "Days until the COA expires (negative = expired).", get: (l) => m(l)?.coaDaysToExpiry ?? null },
    ],
  },
  {
    id: "received", label: "Received", group: "Stock & velocity", align: "left", sortKey: "received",
    fields: [
      { key: "received_on", header: "Received", type: "text", meaning: "Evidenced received date (never the import date).", get: (l) => day(l.received_on) },
      { key: "received_source", header: "Received source", type: "text", meaning: "Where the received date came from.", get: (l) => (l.received_on_source ? receivedOnSourceLabel(l.received_on_source) : null) },
    ],
  },
  {
    id: "age", label: "Age", group: "Stock & velocity", align: "right", sortKey: "age",
    fields: [
      { key: "age_days", header: "Age (days)", type: "integer", meaning: "Days since received.", get: (l) => m(l)?.ageDays ?? null },
      { key: "aging_bucket", header: "Aging bucket", type: "text", meaning: "0-30 / 31-60 / 61-90 / 90+ days (Insights panel buckets).", get: (l) => m(l)?.agingBucket ?? null },
    ],
  },
  {
    id: "onhand", label: "On hand", group: "Stock & velocity", align: "right", sortKey: "onhand",
    fields: [
      { key: "on_hand", header: "On hand", type: "number", meaning: "Units on hand now.", get: (l) => numOrNull(l.on_hand_qty) },
      { key: "unit", header: "Unit", type: "text", meaning: "Unit the quantities are counted in.", get: (l) => blank(l.unit) },
    ],
  },
  {
    id: "sold", label: "Sold", group: "Stock & velocity", align: "right", sortKey: "sold",
    fields: [
      { key: "received_qty", header: "Received qty", type: "number", meaning: "Units received on the lot.", get: (l) => numOrNull(l.received_qty) },
      { key: "sold", header: "Sold", type: "number", meaning: "Received minus on hand, never negative.", get: (l) => lotSoldQty(l) },
    ],
  },
  {
    id: "sellthrough", label: "Sell-through", group: "Stock & velocity", align: "right", sortKey: "sellthrough",
    fields: [{ key: "sell_through_pct", header: "Sell-through %", type: "number", meaning: "Sold ÷ received × 100.", get: (l) => m(l)?.sellThroughPct ?? null }],
  },
  {
    id: "velocity", label: "Velocity", group: "Stock & velocity", align: "right", sortKey: "velocity",
    fields: [{ key: "velocity", header: "Velocity (units/day)", type: "number", meaning: "Units sold per day since received (7-day minimum age).", get: (l) => m(l)?.velocityPerDay ?? null }],
  },
  {
    id: "supply", label: "Days of supply", group: "Stock & velocity", align: "right", sortKey: "supply",
    fields: [{ key: "days_supply", header: "Days of supply", type: "integer", meaning: "On hand ÷ velocity: days until sold out at the current rate.", get: (l) => m(l)?.daysOfSupply ?? null }],
  },
  {
    id: "abc", label: "ABC", group: "Stock & velocity", align: "center", sortKey: "abc",
    fields: [{ key: "abc", header: "ABC class", type: "text", meaning: "A/B/C by on-hand value among active lots (80/95 breakpoints).", get: (l) => m(l)?.abc ?? null }],
  },
  {
    id: "counted", label: "Last counted", group: "Stock & velocity", align: "left", sortKey: "counted",
    fields: [
      { key: "last_counted", header: "Last counted", type: "text", meaning: "Last physical count (cycle count).", get: (l) => day(l.last_counted_at) },
      { key: "times_counted", header: "Times counted", type: "integer", meaning: "Physical counts recorded for the lot.", get: (l) => numOrNull(l.count_times_total) },
    ],
  },
  {
    id: "cost", label: "Unit cost", group: "Money", align: "right", sortKey: "cost",
    fields: [
      { key: "unit_cost", header: "Unit cost", type: "currency", meaning: "Cost per unit.", get: (l) => numOrNull(l.unit_cost_minor_units) },
      { key: "cost_source", header: "Cost source", type: "text", meaning: "Where the unit cost came from.", get: (l) => costSourceLabel(l.unit_cost_source) },
    ],
  },
  {
    id: "extcost", label: "Ext. cost", group: "Money", align: "right", sortKey: "extcost",
    fields: [{ key: "ext_cost", header: "Ext. cost", type: "currency", meaning: "On hand × unit cost (inventory value at cost).", get: (l) => m(l)?.extCostMinor ?? null }],
  },
  {
    id: "price", label: "Price", group: "Money", align: "right", sortKey: "price",
    fields: [{ key: "price", header: "Price (tax incl.)", type: "currency", meaning: "Shelf price approved at Product Onboarding, tax included.", get: (l) => numOrNull(l.onboarding_price_minor) }],
  },
  {
    id: "margin", label: "Margin", group: "Money", align: "right", sortKey: "margin",
    fields: [{ key: "margin_pct", header: "Margin %", type: "number", meaning: "Pre-tax margin on the approved price.", get: (l) => numOrNull(l.onboarding_margin_pct) }],
  },
  {
    id: "extretail", label: "Ext. retail", group: "Money", align: "right", sortKey: "extretail",
    fields: [{ key: "ext_retail", header: "Ext. retail", type: "currency", meaning: "On hand × approved shelf price (tax incl.).", get: (l) => m(l)?.extRetailMinor ?? null }],
  },
  {
    id: "shelf", label: "Website category", group: "Menu & onboarding", align: "left", sortKey: "shelf",
    fields: [
      { key: "website_category", header: "Website category", type: "text", meaning: "Category the website uses (override > live menu > onboarding > type map > name).", get: (l) => lotWebsiteCategoryOf(l) },
      { key: "website_category_source", header: "Website category source", type: "text", meaning: "Where the website category came from.", get: (l) => (l.website_category_source ? websiteCategorySourceLabel(l.website_category_source) : null) },
    ],
  },
  {
    id: "onboarded", label: "Onboarded", group: "Menu & onboarding", align: "left", sortKey: "onboarded",
    fields: [{ key: "onboarded_on", header: "Onboarded on", type: "text", meaning: "Date Product Onboarding approved the lot.", get: (l) => day(l.onboarded_on) }],
  },
  {
    id: "menu", label: "On menu", group: "Menu & onboarding", align: "center", sortKey: "menu",
    fields: [
      { key: "on_menu", header: "On live menu", type: "text", meaning: "The product has a card on the published menu.", get: (l) => (m(l) ? (m(l)!.onMenu ? "Yes" : "No") : null) },
      { key: "on_leafly", header: "On Leafly", type: "text", meaning: "Our record says Leafly accepted this product.", get: (l, ctx) => { const k = String(l.pos_product_key ?? "").trim(); return k ? (ctx.leaflyKeys?.has(k) ? "Yes" : "No") : "No"; } },
    ],
  },
  {
    id: "expires", label: "Expires", group: "Compliance", align: "left", sortKey: "expires",
    fields: [
      { key: "expires_on", header: "Expires", type: "text", meaning: "Lot expiry date.", get: (l) => day(l.expires_on) },
      { key: "days_to_expiry", header: "Days to expiry", type: "integer", meaning: "Days until the lot expires (negative = expired).", get: (l) => m(l)?.daysToExpiry ?? null },
      { key: "expiry_source", header: "Expiry source", type: "text", meaning: "Where the expiry date came from.", get: (l) => expirySourceLabel(l.expires_on_source) },
    ],
  },
  {
    id: "compliance", label: "Compliance flags", group: "Compliance", align: "left",
    fields: [
      { key: "medical", header: "Medical", type: "text", meaning: "Medical-compliant product (DOH).", get: (l) => yesNo(l.is_medical) },
      { key: "sample", header: "Sample", type: "text", meaning: "Trade / vendor sample.", get: (l) => yesNo(l.is_sample) },
      { key: "low_thc_liquid", header: "Low-THC liquid", type: "text", meaning: "Low-THC liquid sales limit applies (blank = not yet answered).", get: (l) => yesNo(l.low_thc_liquid) },
      { key: "otherwise_taken", header: "Taken otherwise", type: "text", meaning: "Taken otherwise into the body (WAC 314-55-095; blank = not yet answered).", get: (l) => yesNo(l.otherwise_taken) },
      { key: "units_per_package", header: "Units per package", type: "number", meaning: "Units inside one sellable package.", get: (l) => numOrNull(l.units_per_package) },
      { key: "unit_thc_mg", header: "Unit THC (mg)", type: "number", meaning: "mg of active THC in one sealed container.", get: (l) => numOrNull(l.unit_thc_mg) },
    ],
  },
  {
    id: "disposition", label: "Disposition", group: "Compliance", align: "left",
    fields: [
      { key: "disposition", header: "Disposition", type: "text", meaning: "Dock decision: pending / accepted / rejected at dock.", get: (l) => dispositionLabel(l.disposition) },
      { key: "reject_reason", header: "Reject reason", type: "text", meaning: "Why the lot was rejected at the dock.", get: (l) => blank(l.reject_reason) },
    ],
  },
  {
    id: "notes", label: "Notes", group: "Audit", align: "left",
    fields: [{ key: "notes", header: "Notes", type: "text", meaning: "Free-text notes on the lot.", get: (l) => blank(l.notes) }],
  },
  {
    id: "updated", label: "Updated", group: "Audit", align: "left", sortKey: "updated",
    fields: [
      { key: "updated_at", header: "Updated", type: "text", meaning: "Last change to the lot row.", get: (l) => day(l.updated_at) },
      { key: "created_at", header: "Created", type: "text", meaning: "When the lot row was created (import / intake).", get: (l) => day(l.created_at) },
    ],
  },
  {
    id: "status", label: "Status", group: "Compliance", align: "center", sortKey: "status",
    fields: [{ key: "status", header: "Status", type: "text", meaning: "Lifecycle status (active, quarantine, recalled, sold out, destroyed).", get: (l) => blank(l.status) }],
  },
];

export const TABLE_COLUMN_IDS: readonly string[] = INVENTORY_TABLE_COLUMNS.map((c) => c.id);

export function tableColumn(id: string): TableColumn | undefined {
  return INVENTORY_TABLE_COLUMNS.find((c) => c.id === id);
}

/* ── Presets ("views") ───────────────────────────────────────────────────── */

export type ColumnPreset = { key: string; label: string; ids: readonly string[] | "all" };

/** The first column is always shown; presets list the rest. */
export const ALWAYS_VISIBLE = "product";

export const COLUMN_PRESETS: readonly ColumnPreset[] = [
  { key: "all", label: "Everything", ids: "all" },
  {
    key: "classic",
    label: "Classic",
    // The 22 columns the table had before R38, exactly.
    ids: ["product", "vendor", "type", "strain", "strainType", "size", "coa", "thc", "cbd", "cbg", "cbn", "cbc", "received", "onhand", "sold", "cost", "price", "margin", "shelf", "onboarded", "expires", "status"],
  },
  { key: "stock", label: "Stock & velocity", ids: ["product", "vendor", "type", "size", "received", "age", "onhand", "sold", "sellthrough", "velocity", "supply", "abc", "counted", "expires", "status"] },
  { key: "money", label: "Cost & margin", ids: ["product", "vendor", "type", "onhand", "cost", "extcost", "price", "margin", "extretail", "sellthrough", "abc", "status"] },
  { key: "lab", label: "Lab & potency", ids: ["product", "vendor", "type", "strain", "strainType", "coa", "thc", "cbd", "cbg", "cbn", "cbc", "lab", "coaexp", "pack", "status"] },
  { key: "compliance", label: "Compliance & audit", ids: ["product", "ids", "vendor", "type", "received", "onhand", "expires", "compliance", "disposition", "counted", "notes", "updated", "status"] },
];

export const DEFAULT_PRESET = "all";
export const VIEW_PARAM = "view";
export const COLS_PARAM = "cols";

export type ColumnView = {
  /** Preset key in effect, or "custom". */
  preset: string;
  /** Visible column ids, in registry order. */
  ids: string[];
};

function oneOf(raw: RawParams, key: string): string | undefined {
  const v = raw[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Every value of a (possibly repeated, possibly comma-joined) param. */
export function multiParam(raw: RawParams, key: string): string[] {
  const v = raw[key];
  const list = v == null ? [] : Array.isArray(v) ? v : [v];
  return list.flatMap((s) => String(s).split(",")).map((s) => s.trim()).filter(Boolean);
}

/**
 * Which columns to show. `cols=` (custom) wins over `view=` (preset); unknown
 * ids are dropped; garbage means the default. The product column is always
 * present and the order is ALWAYS registry order (a URL cannot scramble it).
 */
export function parseColumnView(raw: RawParams): ColumnView {
  const custom = new Set(multiParam(raw, COLS_PARAM).filter((id) => TABLE_COLUMN_IDS.includes(id)));
  if (custom.size > 0) {
    custom.add(ALWAYS_VISIBLE);
    return { preset: "custom", ids: TABLE_COLUMN_IDS.filter((id) => custom.has(id)) };
  }
  const key = oneOf(raw, VIEW_PARAM);
  const preset = COLUMN_PRESETS.find((p) => p.key === key) ?? COLUMN_PRESETS.find((p) => p.key === DEFAULT_PRESET)!;
  if (preset.ids === "all") return { preset: preset.key, ids: [...TABLE_COLUMN_IDS] };
  const want = new Set([ALWAYS_VISIBLE, ...preset.ids]);
  return { preset: preset.key, ids: TABLE_COLUMN_IDS.filter((id) => want.has(id)) };
}

/* ── Page size + numbered pager ──────────────────────────────────────────── */

export const PAGE_SIZE_PARAM = "per";
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 250] as const;
export const DEFAULT_TABLE_PAGE_SIZE = 100;
export type PageSizeChoice = (typeof PAGE_SIZE_OPTIONS)[number] | "all";

/** `per=25|50|100|250|all`; anything else is the default (100). */
export function parsePageSize(raw: RawParams): PageSizeChoice {
  const v = String(oneOf(raw, PAGE_SIZE_PARAM) ?? "").trim().toLowerCase();
  if (v === "all") return "all";
  const n = Number(v);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? (n as PageSizeChoice) : DEFAULT_TABLE_PAGE_SIZE;
}

/** Rows per page actually used. "all" = every matching row on one page. */
export function effectivePageSize(choice: PageSizeChoice, total: number): number {
  if (choice === "all") return Math.max(1, Number.isFinite(total) ? Math.floor(total) : 1);
  return choice;
}

export type PagerItem = { kind: "page"; page: number; current: boolean } | { kind: "gap"; key: string };

/**
 * Numbered pager items: always the first and last page, a window of
 * `siblings` around the current page, and an ellipsis for each gap. A gap
 * of exactly one page shows that page instead (an ellipsis hiding one number
 * is worse than the number). Clamps garbage input.
 */
export function pagerItems(current: number, totalPages: number, siblings = 2): PagerItem[] {
  const total = Math.max(1, Math.floor(Number.isFinite(totalPages) ? totalPages : 1));
  const cur = Math.min(Math.max(1, Math.floor(Number.isFinite(current) ? current : 1)), total);
  const want = new Set<number>([1, total]);
  for (let p = cur - siblings; p <= cur + siblings; p++) if (p >= 1 && p <= total) want.add(p);
  const pages = [...want].sort((a, b) => a - b);
  const out: PagerItem[] = [];
  let prev = 0;
  for (const p of pages) {
    if (p - prev === 2) out.push({ kind: "page", page: p - 1, current: p - 1 === cur });
    else if (p - prev > 2) out.push({ kind: "gap", key: `gap-${prev}-${p}` });
    out.push({ kind: "page", page: p, current: p === cur });
    prev = p;
  }
  return out;
}

/* ── URL helpers (display params ride along, page resets) ────────────────── */

/** Params that change how the table LOOKS, not which lots match. */
export const DISPLAY_PARAMS = [PAGE_SIZE_PARAM, VIEW_PARAM, COLS_PARAM, "density"] as const;

/** Href with `set` applied and `drop` removed; any change resets `page`. */
export function tableHref(raw: RawParams, set: Record<string, string | null>, base = "/admin/inventory"): string {
  const params = paramsFrom(raw);
  params.delete("page");
  for (const [k, v] of Object.entries(set)) {
    params.delete(k);
    if (v != null && v !== "") params.set(k, v);
  }
  params.sort();
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Href for a page number, keeping every other param (page 1 = no param). */
export function pageNumberHref(raw: RawParams, page: number, base = "/admin/inventory"): string {
  const params = paramsFrom(raw);
  params.delete("page");
  if (page > 1) params.set("page", String(Math.floor(page)));
  params.sort();
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Href switching to a preset (clears any custom column set). */
export function presetHref(raw: RawParams, preset: string): string {
  return tableHref(raw, { [VIEW_PARAM]: preset === DEFAULT_PRESET ? null : preset, [COLS_PARAM]: null });
}

/**
 * Hidden form fields that carry every current param EXCEPT those the form
 * itself sets (and `page`, which any form submit resets). Repeated keys stay
 * repeated so a comma-bearing vendor name survives.
 */
export function carryFields(raw: RawParams, owned: readonly string[]): Array<[string, string]> {
  const skip = new Set(["page", ...owned]);
  const out: Array<[string, string]> = [];
  for (const [k, v] of paramsFrom(raw)) if (!skip.has(k) && v !== "") out.push([k, v]);
  return out;
}

/* ── Export ──────────────────────────────────────────────────────────────── */

export type ExportScope = "view" | "page" | "all";
export type ExportColumns = "visible" | "all";

export function parseExportScope(v: string | null | undefined): ExportScope {
  return v === "page" || v === "all" ? v : "view";
}
export function parseExportColumns(v: string | null | undefined): ExportColumns {
  return v === "all" ? "all" : "visible";
}

/** Flat export fields for a set of column ids (registry order). */
export function exportFieldsFor(ids: readonly string[]): ExportField[] {
  const want = new Set(ids);
  return INVENTORY_TABLE_COLUMNS.filter((c) => want.has(c.id)).flatMap((c) => c.fields);
}

/**
 * Build the flat rows. Numbers stay numbers (money stays minor units for the
 * workbook's currency formatter); unknown stays null (a blank cell).
 */
export function exportRows(
  lots: readonly TableLot[],
  fields: readonly ExportField[],
  ctx: TableContext,
): Array<Record<string, string | number | null>> {
  return lots.map((l) => {
    const row: Record<string, string | number | null> = {};
    for (const f of fields) {
      const v = f.get(l, ctx);
      row[f.key] = v == null || (typeof v === "number" && !Number.isFinite(v)) ? null : v;
    }
    return row;
  });
}

/** Totals row: money columns are summed; the first text column says "Total". */
export function exportTotals(
  rows: ReadonlyArray<Record<string, string | number | null>>,
  fields: readonly ExportField[],
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  let labelled = false;
  for (const f of fields) {
    if (f.type === "currency") {
      out[f.key] = rows.reduce((s, r) => s + (typeof r[f.key] === "number" ? (r[f.key] as number) : 0), 0);
    } else if (!labelled && f.type === "text") {
      out[f.key] = `Total (${rows.length} lot${rows.length === 1 ? "" : "s"})`;
      labelled = true;
    } else {
      out[f.key] = null;
    }
  }
  // Unit cost and price are per-unit; summing them is meaningless.
  for (const k of ["unit_cost", "price"]) if (k in out) out[k] = null;
  return out;
}

/**
 * Spreadsheet formula-injection guard (OWASP "CSV Injection"). A text cell
 * starting with = + - @ TAB or CR is prefixed with an apostrophe so Excel /
 * Sheets show it as text instead of running it. Real numbers ("-5.00") are
 * left alone — they are data, not formulas.
 */
export function neutralizeFormula(s: string): string {
  if (!/^[=+\-@\t\r]/.test(s)) return s;
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return s;
  return `'${s}`;
}

export function exportFilename(scope: ExportScope, today: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : "export";
  return `greenway-inventory-${scope === "all" ? "all-lots" : scope === "page" ? "page" : "view"}-${d}`;
}

/** Sort keys every sortable registry column points at (must all exist). */
export function registrySortKeys(): string[] {
  return INVENTORY_TABLE_COLUMNS.map((c) => c.sortKey).filter((k): k is string => Boolean(k));
}

/* ── Self-tests (pure) ───────────────────────────────────────────────────── */

export function __runInventoryTableCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL inventory-table-core: " + msg);
    }
  };

  // Registry integrity.
  ok(new Set(TABLE_COLUMN_IDS).size === TABLE_COLUMN_IDS.length, "column ids unique");
  const fieldKeys = INVENTORY_TABLE_COLUMNS.flatMap((c) => c.fields.map((f) => f.key));
  ok(new Set(fieldKeys).size === fieldKeys.length, "export field keys unique");
  ok(registrySortKeys().every((k) => columnSortDef(k) !== undefined), "every sortKey is a real sort");
  ok(INVENTORY_TABLE_COLUMNS[0].id === ALWAYS_VISIBLE, "product column first");
  ok(INVENTORY_TABLE_COLUMNS.every((c) => COLUMN_GROUPS.includes(c.group)), "every group is listed");
  ok(INVENTORY_TABLE_COLUMNS.every((c) => c.fields.length > 0 && c.fields.every((f) => f.meaning.length > 5)), "every column exports with a meaning");
  ok(TABLE_COLUMN_IDS.length >= 38, `rich table (${TABLE_COLUMN_IDS.length} columns)`);
  for (const p of COLUMN_PRESETS) {
    if (p.ids !== "all") ok(p.ids.every((id) => TABLE_COLUMN_IDS.includes(id)), `preset ${p.key} names real columns`);
  }
  const classic = COLUMN_PRESETS.find((p) => p.key === "classic")!;
  ok(Array.isArray(classic.ids) && classic.ids.length === 22, "classic = the 22 pre-R38 columns");

  // Column view parsing.
  ok(parseColumnView({}).ids.length === TABLE_COLUMN_IDS.length && parseColumnView({}).preset === "all", "default = everything");
  const money = parseColumnView({ view: "money" });
  ok(money.preset === "money" && money.ids[0] === "product" && money.ids.includes("extcost") && !money.ids.includes("thc"), "money preset");
  const custom = parseColumnView({ cols: ["status,thc", "nope"], view: "money" });
  ok(custom.preset === "custom" && custom.ids.join() === "product,thc,status", `custom wins, product forced, registry order (got ${custom.ids.join()})`);
  ok(parseColumnView({ cols: "garbage" }).preset === "all", "all-garbage cols → default");
  ok(parseColumnView({ view: "junk" }).preset === "all", "junk view → default");

  // Page size.
  ok(parsePageSize({}) === 100 && parsePageSize({ per: "25" }) === 25 && parsePageSize({ per: "ALL" }) === "all", "per parse");
  ok(parsePageSize({ per: "37" }) === 100 && parsePageSize({ per: "-1" }) === 100 && parsePageSize({ per: ["50", "25"] }) === 50, "per garbage → 100, first wins");
  ok(effectivePageSize("all", 1234) === 1234 && effectivePageSize("all", 0) === 1 && effectivePageSize(50, 9) === 50, "effective size");

  // Pager items.
  const s = (xs: PagerItem[]) => xs.map((x) => (x.kind === "gap" ? "…" : x.current ? `[${x.page}]` : String(x.page))).join(" ");
  ok(s(pagerItems(1, 1)) === "[1]", "single page");
  ok(s(pagerItems(1, 5)) === "[1] 2 3 4 5", `short (got ${s(pagerItems(1, 5))})`);
  ok(s(pagerItems(10, 20)) === "1 … 8 9 [10] 11 12 … 20", `middle (got ${s(pagerItems(10, 20))})`);
  ok(s(pagerItems(4, 20)) === "1 2 3 [4] 5 6 … 20", `one-gap shows the page (got ${s(pagerItems(4, 20))})`);
  ok(s(pagerItems(20, 20)) === "1 … 18 19 [20]", `end (got ${s(pagerItems(20, 20))})`);
  ok(s(pagerItems(99, 3)) === "1 2 [3]" && s(pagerItems(NaN, 0)) === "[1]", "clamped");

  // Hrefs.
  ok(pageNumberHref({ status: "active", page: "3", per: "25" }, 4) === "/admin/inventory?page=4&per=25&status=active", "page href keeps per");
  ok(pageNumberHref({ status: "active", page: "3" }, 1) === "/admin/inventory?status=active", "page 1 = no param");
  ok(tableHref({ status: "active", page: "3" }, { per: "all" }) === "/admin/inventory?per=all&status=active", "page size resets page");
  ok(presetHref({ cols: "thc", page: "2", per: "50" }, "money") === "/admin/inventory?per=50&view=money", "preset clears cols + page");
  ok(presetHref({ view: "money" }, "all") === "/admin/inventory", "default preset = no param");
  const carry = carryFields({ fVendor: ["A, LLC", "B"], page: "2", cols: "x", per: "25" }, ["cols"]);
  ok(JSON.stringify(carry) === JSON.stringify([["fVendor", "A, LLC"], ["fVendor", "B"], ["per", "25"]]), `carry (got ${JSON.stringify(carry)})`);

  // Export rows.
  const lot = {
    id: "L1", lot_code: "LC", pos_product_key: "K1", product_name: "=HYPERLINK(\"x\")", strain_type: null, status: "active",
    is_sample: false, is_medical: true, low_thc_liquid: null, otherwise_taken: false, unit: "ea", unit_cost_minor_units: 500,
    unit_thc_mg: null, units_per_package: 10, expires_on: "2026-05-01", received_on: "2026-03-01", received_on_source: "manifest",
    notes: null, vendor_id: "v", brand_id: null, vendor_name: "Phat Panda", brand_name: null, lab: null, created_at: "2026-03-01T00:00:00Z",
    category: null, inventory_type: "Usable Marijuana", unit_weight: 3.5, unit_weight_uom: "g", received_qty: 10, on_hand_qty: 4,
    strain_name: null, unit_cost_source: "invoice", disposition: "rejected_at_dock", reject_reason: "Damaged",
    inv_metrics: { ageDays: 30, agingBucket: "0-30", extCostMinor: 2000, extRetailMinor: null, sellThroughPct: 60, velocityPerDay: 0.2, daysOfSupply: 20, daysToExpiry: 31, coaDaysToExpiry: null, abc: "B", onMenu: true },
  } as unknown as TableLot;
  const fields = exportFieldsFor(TABLE_COLUMN_IDS);
  const [row] = exportRows([lot], fields, { leaflyKeys: new Set(["K1"]) });
  ok(row.vendor === "Phat Panda" && row.brand === null, "vendor/brand split, unknown = null");
  ok(row.unit_cost === 500 && row.ext_cost === 2000 && row.ext_retail === null, "money as minor units; unknown retail blank");
  ok(row.sold === 6 && row.sell_through_pct === 60 && row.days_supply === 20 && row.abc === "B", "metrics exported");
  ok(row.medical === "Yes" && row.low_thc_liquid === null && row.otherwise_taken === "No" && row.units_per_package === 10, "flags: unknown stays blank");
  ok(row.on_menu === "Yes" && row.on_leafly === "Yes" && row.cost_source === "Invoice", "menu/leafly/cost source");
  ok(row.disposition === "Rejected at dock" && row.reject_reason === "Damaged" && row.has_coa === "No", "disposition");
  ok(row.received_source === "From the inbound manifest" && row.unit_size === 3.5 && row.unit_size_uom === "g", "received source + size");
  const vis = exportFieldsFor(["status", "product"]);
  ok(vis.map((f) => f.key).join() === "lot_id,product,lot_code,status", "visible export follows registry order");
  const totals = exportTotals(exportRows([lot, { ...lot, id: "L2" } as TableLot], fields, {}), fields);
  ok(totals.ext_cost === 4000 && totals.unit_cost === null && totals.lot_id === "Total (2 lots)", `totals (got ${totals.ext_cost}, ${totals.lot_id})`);

  // Formula guard.
  ok(neutralizeFormula("=SUM(A1)") === "'=SUM(A1)" && neutralizeFormula("@cmd") === "'@cmd" && neutralizeFormula("+1+1") === "'+1+1", "formulas neutralised");
  ok(neutralizeFormula("-5.00") === "-5.00" && neutralizeFormula("+3") === "+3" && neutralizeFormula("Blue Dream") === "Blue Dream", "numbers + text untouched");
  ok(neutralizeFormula("\tx") === "'\tx" && neutralizeFormula("-x") === "'-x", "tab / dash-text guarded");

  // Labels.
  ok(costSourceLabel("pos_import") === "POS import" && costSourceLabel("junk") === null, "cost source label");
  ok(expirySourceLabel("rule") === "Expiration rule" && expirySourceLabel(null) === null, "expiry source label");
  ok(complianceFlags(lot).join("|") === "Medical|10 units/pkg", `flags (got ${complianceFlags(lot).join("|")})`);
  ok(packFactLines({ ...lot, net_weight_grams: 3.5, servings_per_pack: 10, mg_per_serving: 10, ratio_label: "1:1" } as TableLot).join("|") === "3.5 g net|10 × 10 mg|1:1", "pack facts");
  ok(exportFilename("all", "2026-03-31") === "greenway-inventory-all-lots-2026-03-31" && exportFilename("view", "bad") === "greenway-inventory-view-export", "filename");
  ok(parseExportScope("page") === "page" && parseExportScope("x") === "view" && parseExportColumns("all") === "all" && parseExportColumns(null) === "visible", "export params");
  ok(multiParam({ a: ["x, y", "z"] }, "a").join() === "x,y,z", "multiParam");

  return { passed, failed };
}
