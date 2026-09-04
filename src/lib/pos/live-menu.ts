/**
 * src/lib/pos/live-menu.ts
 *
 * DYNAMIC MENU SOURCE OF TRUTH.
 *
 * The customer-facing site must reflect the back office. Per migration 0002 the
 * design is: exactly one `menu_versions` row is `published` at a time, and "the
 * public site reads the single published menu_version snapshot."
 *
 * Historically the site instead imported a committed static JSON snapshot
 * (src/data/pos-menu-preview.json) via src/lib/pos/preview-menu.ts, which meant
 * clearing the back office had NO effect on the website (frozen snapshot). This
 * module fixes that: it loads the PUBLISHED DB menu and converts the DB rows
 * (MenuItemRow + variants) into the GreenwayMenuItem shape the site renders.
 *
 * Fallback policy (SLICE 48, owner Q3 — no stale product data, ever):
 *   - If Supabase isn't configured (e.g. certain build contexts) → return []
 *     (an EMPTY menu). The committed JSON snapshot and its preview-menu loader
 *     are RETIRED; a build without a database renders an empty menu rather
 *     than year-old products.
 *   - If Supabase IS configured but there is NO published version, or the
 *     published version has zero items → return [] as well. This is the
 *     correct behavior the owner expects: an empty back office = no product
 *     cards on the site.
 */
import "server-only";
import type {
  GreenwayMenuItem,
  GreenwayMenuVariant,
  GreenwayCannabinoid,
  GreenwayCategory,
  GreenwayStrainType,
} from "@/lib/leafly/types";
import type { MenuItemRow, MenuVariantRow } from "@/lib/pos/db-types";
import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { withCardIdentity } from "@/lib/menu/card-identity";

type MenuItemWithVariants = MenuItemRow & { variants: MenuVariantRow[] };

// ── Converters ─────────────────────────────────────────────────────────────────
function toCannabinoid(json: unknown): GreenwayCannabinoid | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const type = o.type;
  const unit = o.unit;
  if (typeof type !== "string" || typeof unit !== "string") return null;
  return {
    type: type as GreenwayCannabinoid["type"],
    value: typeof o.value === "string" ? o.value : o.value == null ? null : String(o.value),
    unit: unit as GreenwayCannabinoid["unit"],
  };
}

function toCompounds(json: unknown): GreenwayCannabinoid[] {
  if (!Array.isArray(json)) return [];
  return json.map(toCannabinoid).filter((c): c is GreenwayCannabinoid => c != null);
}

function toVariant(v: MenuVariantRow): GreenwayMenuVariant {
  return {
    id: v.source_variant_id,
    label: v.label,
    priceMinorUnits: v.price_minor_units,
    inventoryLevel: v.inventory_level,
    medical: v.medical,
  };
}

function normalizeInventoryStatus(s: string): GreenwayMenuItem["inventoryStatus"] {
  if (s === "in-stock" || s === "low-stock" || s === "unavailable") return s;
  return "unavailable";
}

export function menuRowToGreenwayItem(row: MenuItemWithVariants): GreenwayMenuItem {
  return {
    id: row.source_item_id,
    name: row.name,
    productName: row.product_name ?? undefined,
    brand: row.brand_name,
    vendor: row.vendor_name ?? undefined,
    category: row.category as GreenwayCategory,
    filterCategories: (row.filter_categories as GreenwayCategory[]) ?? [],
    posInventoryType: row.pos_inventory_type ?? undefined,
    posInventoryCategory: row.pos_inventory_category ?? undefined,
    strainType: row.strain_type as GreenwayStrainType,
    strainName: row.strain_name ?? undefined,
    thc: row.thc,
    cbd: row.cbd,
    // SLICE 16 — the low-THC beverage classification rides to the website and
    // the register. menu-version.ts selects "*", so no query change is needed.
    // `?? null` keeps a pre-0216 database (column absent → undefined) reading
    // as "not classified", which the engine treats as a normal liquid.
    lowThcLiquid: row.low_thc_liquid ?? null,
    unitThcMg: row.unit_thc_mg ?? null,
    // SLICE 17 — the otherwise-taken classification rides to the website and
    // the register on the same select("*"), so no query change is needed.
    // `?? null` keeps a pre-0217 database reading as "not classified".
    otherwiseTaken: row.otherwise_taken ?? null,
    unitsPerPackage: row.units_per_package ?? null,
    totalThc: toCannabinoid(row.total_thc_json),
    totalCbd: toCannabinoid(row.total_cbd_json),
    compounds: toCompounds(row.compounds_json),
    description: row.description ?? "",
    priceLabel: row.price_label ?? "",
    priceMinorUnits: row.price_minor_units,
    inventoryStatus: normalizeInventoryStatus(row.inventory_status),
    hidden: row.hidden,
    hiddenReason: row.hidden_reason ?? undefined,
    variants: (row.variants ?? []).map(toVariant),
  };
}

// ── Public loaders ───────────────────────────────────────────────────────────
/**
 * Load the full published menu (INCLUDING hidden items) from the DB, converted
 * to GreenwayMenuItem. Falls back to the committed JSON ONLY when Supabase is
 * not configured. When configured but no published version exists → [].
 */
export async function loadLiveMenuAll(): Promise<GreenwayMenuItem[]> {
  if (!isSupabaseServiceConfigured) {
    // SLICE 48: no stale fallback. An unconfigured build renders an empty
    // menu — the committed snapshot is retired (owner Q3).
    return [];
  }
  const version = await getPublishedVersion();
  if (!version) return [];
  const rows = await getVersionItems(version.id);
  // SLICE 66 (owner D1/D2/D3): overlay DISPLAY identity — a brand linked in
  // Product Enrichment (published) replaces the row's brand for the card
  // label, and vendors show their short/dba name with any trailing license
  // number stripped ("CERES", never "CERES - 435011"). Display-only: the
  // stored menu rows keep the full brand/vendor text (search, admin, carts,
  // receipts, CCRS). Degrades to the raw rows on any read failure.
  return withCardIdentity(rows.map(menuRowToGreenwayItem));
}

/** Visible items only (hidden excluded) — the standard site menu. */
export async function loadLiveMenuItems(): Promise<GreenwayMenuItem[]> {
  const all = await loadLiveMenuAll();
  return all.filter((item) => !item.hidden);
}

/** Look up a single visible item by its stable source_item_id. */
export async function getLiveMenuItemById(id: string): Promise<GreenwayMenuItem | undefined> {
  // SLICE 48: unconfigured builds have an empty menu (loadLiveMenuAll returns
  // []), so the lookup naturally resolves to undefined — no stale snapshot.
  const items = await loadLiveMenuItems();
  return items.find((item) => item.id === id);
}
