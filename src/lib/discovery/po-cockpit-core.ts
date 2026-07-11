/**
 * src/lib/discovery/po-cockpit-core.ts
 *
 * PURE purchase-manager cockpit shaping for the Leads page (Task I, I5).
 * Owner's request (verbatim intent): "what would a professional expert level
 * purchase manager need to make their job as easy as possible … more displays
 * and tables and insights related to our local competitors as well as port
 * orchard specifically. port orchard is who we really need to start beating …
 * easier time putting together purchase orders with this new gold mine of
 * information."
 *
 * Turns the persisted monthly-transformer rollups (migrations 0106/0107/0110:
 * `discovery_competitor_stats` + `discovery_market_signals`) plus the verified
 * WSLCB roster (`discovery_competitors`) and Greenway's own PUBLISHED menu into
 * three battle-plan views, scoped to ONE area (default: port_orchard):
 *
 *  1. HEAD-TO-HEAD BOARD — one row per tracked competitor in the area: their
 *     real revenue/units, price bands, category mix, wholesale sourcing spend,
 *     and how much of their top-mover list we already cover on our menu.
 *  2. BUY LIST ("they sell it, we don't") — the area's competitor top movers
 *     we do NOT carry (or only carry the brand of), deduped across stores,
 *     with the I4 manifest-resolved vendor and the price to beat — each row is
 *     Start-PO-ready.
 *  3. UNDERCUT BOARD — movers we DO carry (exact name match) where both our
 *     menu price and their observed p25 are known: a grounded price check,
 *     positive delta = we are priced above the "beat" price.
 *
 * HONESTY (standing rules — NEVER GUESS):
 *  - The aggregator structurally EXCLUDES Greenway (is_self) from competitor
 *    rollups, so no Greenway-vs-them CCRS numbers exist. "Head to head" is
 *    therefore their CCRS reality vs OUR published menu — never an invented
 *    Greenway sales figure.
 *  - Menu matching reuses the CONSERVATIVE exact-after-normalization key from
 *    assortment-gap-core (lowercase/trim/collapse whitespace). No fuzzy
 *    matching — a near-miss renders as a gap, never a wrong match.
 *  - Vendor/brand/strain on a deduped buy row are carried only when every
 *    contributing store row AGREES; a conflict renders null, never a guess.
 *  - The undercut target on a multi-store row is the MINIMUM observed p25 —
 *    "sell at/below this and you undercut ~75% of observed sales at EVERY one
 *    of these stores" — a factual bound, not a pooled estimate.
 *  - Our price on an undercut row is the MINIMUM exact-match menu price, so
 *    "we're above the beat price" is only claimed when even our cheapest
 *    matching item is above it.
 *  - CCRS inventory-type → lead-category suggestions are limited to the
 *    unambiguous WSLCB types; ambiguous types (e.g. "Concentrate For
 *    Inhalation" = carts OR dabs) suggest nothing — the manager picks.
 *  - Junk numbers coerce to 0/null exactly like market-leads-core — never a
 *    fabricated figure. Money in MINOR UNITS end to end.
 *  - Pure module: no I/O — covered by tests/compliance/po-cockpit-core.test.ts.
 */
import type { DiscoveryCompetitorArea } from "@/lib/discovery/types";
import { normalizeKey } from "@/lib/discovery/assortment-gap-core";

// ---------------------------------------------------------------------------
// Inputs — structurally match DiscoveryCompetitorStatRow / DiscoveryCompetitor
// / DiscoveryMarketSignalRow / MasterCandidateItem.
// ---------------------------------------------------------------------------

export type CockpitStatLike = {
  license_number: string;
  name: string | null;
  dba: string | null;
  city: string | null;
  retail_units: number;
  retail_revenue_minor: number;
  retail_line_count: number;
  price_sample_size: number;
  price_p25_minor: number | null;
  price_median_minor: number | null;
  price_p75_minor: number | null;
  by_type: Array<{ inventoryType: string; units: number; revenueMinor: number }>;
  // Optional so rows persisted BEFORE migration 0107 keep working (they render
  // as "no sourcing data", never a guess).
  wholesale_line_count?: number;
  wholesale_spend_minor?: number;
  top_suppliers?: Array<{ licenseeId: string }>;
};

export type CockpitRosterEntryLike = {
  license_number: string;
  tradename: string;
  city: string | null;
  area: DiscoveryCompetitorArea;
  is_self: boolean;
};

export type CockpitSignalLike = {
  kind: "statewide_mover" | "competitor_mover" | "type_mover";
  license_number: string | null;
  inventory_type: string | null;
  product_name: string | null;
  brand: string | null;
  strain_name: string | null;
  units: number;
  revenue_minor: number;
  median_unit_price_minor: number | null;
  p25_unit_price_minor: number | null;
  // I4 (migration 0110). Optional so pre-0110 rows keep working (vendor
  // renders as "—", never a guess).
  vendor_name?: string | null;
  vendor_license?: string | null;
};

export type CockpitMenuItemLike = {
  name: string;
  brand: string | null;
  /** Published menu price in MINOR units (MasterCandidateItem.priceMinor). */
  priceMinor?: number;
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type CockpitMenuStatus = "carried" | "brand_carried" | "not_carried";

export type HeadToHeadRow = {
  licenseNumber: string;
  /** Roster tradename (verified WSLCB roster — never invented). */
  displayName: string;
  city: string | null;
  retailUnits: number;
  retailRevenueMinor: number;
  retailLineCount: number;
  priceSampleSize: number;
  priceP25Minor: number | null;
  priceMedianMinor: number | null;
  priceP75Minor: number | null;
  /** Top 3 inventory types by revenue with share of the store's typed revenue. */
  topTypes: Array<{ inventoryType: string; revenueMinor: number; share: number }>;
  /** Null when the stat row predates migration 0107 (no sourcing data). */
  wholesaleSpendMinor: number | null;
  supplierCount: number | null;
  /** Our menu's coverage of THIS store's top movers (competitor_mover signals). */
  moversTotal: number;
  moversCarried: number;
  moversBrandCarried: number;
  moversNotCarried: number;
};

export type BuyListRow = {
  productName: string;
  inventoryType: string | null;
  /** Carried only when every contributing store row agrees — else null. */
  brand: string | null;
  strainName: string | null;
  vendorName: string | null;
  vendorLicense: string | null;
  /** Store display names, contribution-revenue desc. */
  stores: string[];
  storeCount: number;
  totalUnits: number;
  totalRevenueMinor: number;
  /** MIN p25 across stores — at/below this undercuts ~75% at EVERY store. */
  priceToBeatMinor: number | null;
  /** Median unit price at the highest-revenue store (labeled proxy). */
  topStoreMedianMinor: number | null;
  menuStatus: CockpitMenuStatus;
  /** Conservative CCRS-type → lead-category suggestion; null when ambiguous. */
  suggestedCategory: string | null;
};

export type UndercutRow = {
  productName: string;
  brand: string | null;
  inventoryType: string | null;
  stores: string[];
  storeCount: number;
  totalUnits: number;
  totalRevenueMinor: number;
  /** MIN observed p25 across the stores selling it. */
  theirP25Minor: number;
  /** MIN exact-name-match published menu price. */
  ourPriceMinor: number;
  /** ourPriceMinor - theirP25Minor; positive = we're above the beat price. */
  deltaMinor: number;
};

export type PoCockpit = {
  area: DiscoveryCompetitorArea;
  competitorCount: number;
  board: HeadToHeadRow[];
  buyList: BuyListRow[];
  undercuts: UndercutRow[];
  menuItemCount: number;
};

// ---------------------------------------------------------------------------
// Caps — bound the UI tables (full data lives in Reports → Local Benchmarks).
// ---------------------------------------------------------------------------

export const MAX_BUY_ROWS = 25;
export const MAX_UNDERCUT_ROWS = 15;

// ---------------------------------------------------------------------------
// Coercion helpers (same discipline as market-leads-core: junk → 0/null).
// ---------------------------------------------------------------------------

function toFiniteNonNegative(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return v;
}

function minorOrNull(n: unknown): number | null {
  if (n == null) return null;
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v);
}

function cleanStr(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

// ---------------------------------------------------------------------------
// CCRS inventory type → product-lead category (CONSERVATIVE)
// ---------------------------------------------------------------------------

/**
 * Map a raw WSLCB/CCRS inventory type to the Leads page's category vocabulary
 * (flower/preroll/vape/concentrate/edible/topical/accessory) ONLY when the
 * mapping is unambiguous. Real May-2026 extract types verified:
 *   Usable Cannabis, Flower Lot           → flower
 *   Cannabis Mix Packaged                 → preroll  (non-infused prerolls)
 *   Cannabis Mix Infused                  → preroll  (infused prerolls)
 *   Hydrocarbon/Ethanol/CO2/Non-Solvent…  → concentrate
 *   Solid Edible, Liquid Edible           → edible
 *   Topical Ointment                      → topical
 * Deliberately UNMAPPED (ambiguous — the manager picks on the builder):
 *   Concentrate For Inhalation (vape carts OR dabs), Cannabis Mix (loose
 *   shake/trim vs preroll input), Tincture, Capsule, Transdermal, Suppository.
 */
export function suggestLeadCategory(inventoryType: string | null | undefined): string | null {
  const t = normalizeKey(inventoryType ?? null);
  if (!t) return null;
  if (t === "usable cannabis" || t === "usable marijuana" || t === "flower lot") return "flower";
  if (t === "cannabis mix packaged" || t === "cannabis mix infused") return "preroll";
  if (
    t === "hydrocarbon concentrate" ||
    t === "ethanol concentrate" ||
    t === "co2 concentrate" ||
    t === "non-solvent based concentrate"
  ) {
    return "concentrate";
  }
  if (t === "solid edible" || t === "liquid edible") return "edible";
  if (t === "topical ointment") return "topical";
  return null;
}

// ---------------------------------------------------------------------------
// Menu index (assortment-gap-core matching discipline)
// ---------------------------------------------------------------------------

type MenuIndex = {
  /** normalized product name → min positive priceMinor (null when unpriced). */
  namePrices: Map<string, number | null>;
  brandKeys: Set<string>;
  itemCount: number;
};

function indexMenu(menu: CockpitMenuItemLike[]): MenuIndex {
  const namePrices = new Map<string, number | null>();
  const brandKeys = new Set<string>();
  let itemCount = 0;
  for (const item of menu) {
    const nameKey = normalizeKey(item.name);
    if (!nameKey) continue;
    itemCount += 1;
    const price = minorOrNull(item.priceMinor);
    const usable = price != null && price > 0 ? price : null;
    const prev = namePrices.get(nameKey);
    if (prev === undefined) {
      namePrices.set(nameKey, usable);
    } else if (usable != null && (prev == null || usable < prev)) {
      namePrices.set(nameKey, usable);
    }
    const brandKey = normalizeKey(item.brand);
    if (brandKey) brandKeys.add(brandKey);
  }
  return { namePrices, brandKeys, itemCount };
}

function menuStatusFor(
  index: MenuIndex,
  productName: string,
  brand: string | null,
): CockpitMenuStatus {
  const nameKey = normalizeKey(productName);
  if (nameKey && index.namePrices.has(nameKey)) return "carried";
  const brandKey = normalizeKey(brand);
  if (brandKey && index.brandKeys.has(brandKey)) return "brand_carried";
  return "not_carried";
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildPoCockpit(
  stats: CockpitStatLike[],
  roster: CockpitRosterEntryLike[],
  signals: CockpitSignalLike[],
  menu: CockpitMenuItemLike[],
  opts?: { area?: DiscoveryCompetitorArea; maxBuyRows?: number; maxUndercutRows?: number },
): PoCockpit {
  const area: DiscoveryCompetitorArea = opts?.area ?? "port_orchard";
  const maxBuy = opts?.maxBuyRows ?? MAX_BUY_ROWS;
  const maxUndercut = opts?.maxUndercutRows ?? MAX_UNDERCUT_ROWS;

  // Area roster — tracked competitors only, NEVER Greenway itself.
  const areaRoster = roster.filter((r) => r.area === area && !r.is_self);
  const nameByLicense = new Map(areaRoster.map((r) => [r.license_number, r.tradename]));
  const cityByLicense = new Map(areaRoster.map((r) => [r.license_number, r.city]));

  const index = indexMenu(menu);

  // Area competitor-mover signals, grouped per store license.
  const signalsByLicense = new Map<string, CockpitSignalLike[]>();
  for (const s of signals) {
    if (s.kind !== "competitor_mover") continue;
    const lic = cleanStr(s.license_number);
    if (!lic || !nameByLicense.has(lic)) continue;
    if (!normalizeKey(s.product_name)) continue;
    const list = signalsByLicense.get(lic);
    if (list) list.push(s);
    else signalsByLicense.set(lic, [s]);
  }

  // -------------------------------------------------------------------------
  // 1. Head-to-head board
  // -------------------------------------------------------------------------
  const board: HeadToHeadRow[] = [];
  for (const stat of stats) {
    const lic = cleanStr(stat.license_number);
    if (!lic || !nameByLicense.has(lic)) continue;

    // Category mix: top 3 types by revenue, share of the store's typed revenue.
    const types = (Array.isArray(stat.by_type) ? stat.by_type : [])
      .map((t) => ({
        inventoryType: cleanStr(t.inventoryType) ?? "(unknown)",
        revenueMinor: toFiniteNonNegative(t.revenueMinor),
      }))
      .sort((a, b) => b.revenueMinor - a.revenueMinor || a.inventoryType.localeCompare(b.inventoryType));
    const typedTotal = types.reduce((sum, t) => sum + t.revenueMinor, 0);
    const topTypes = types.slice(0, 3).map((t) => ({
      inventoryType: t.inventoryType,
      revenueMinor: t.revenueMinor,
      share: typedTotal > 0 ? t.revenueMinor / typedTotal : 0,
    }));

    // Our menu's coverage of THIS store's top movers.
    let carried = 0;
    let brandCarried = 0;
    let notCarried = 0;
    const storeSignals = signalsByLicense.get(lic) ?? [];
    for (const s of storeSignals) {
      const status = menuStatusFor(index, s.product_name ?? "", s.brand ?? null);
      if (status === "carried") carried += 1;
      else if (status === "brand_carried") brandCarried += 1;
      else notCarried += 1;
    }

    // Sourcing is optional (pre-0107 rows) — null renders "—", never a guess.
    const hasSourcing =
      typeof stat.wholesale_spend_minor === "number" || Array.isArray(stat.top_suppliers);

    board.push({
      licenseNumber: lic,
      displayName: nameByLicense.get(lic) ?? lic,
      city: cityByLicense.get(lic) ?? cleanStr(stat.city),
      retailUnits: toFiniteNonNegative(stat.retail_units),
      retailRevenueMinor: toFiniteNonNegative(stat.retail_revenue_minor),
      retailLineCount: toFiniteNonNegative(stat.retail_line_count),
      priceSampleSize: toFiniteNonNegative(stat.price_sample_size),
      priceP25Minor: minorOrNull(stat.price_p25_minor),
      priceMedianMinor: minorOrNull(stat.price_median_minor),
      priceP75Minor: minorOrNull(stat.price_p75_minor),
      topTypes,
      wholesaleSpendMinor: hasSourcing ? toFiniteNonNegative(stat.wholesale_spend_minor) : null,
      supplierCount: hasSourcing ? (stat.top_suppliers ?? []).length : null,
      moversTotal: storeSignals.length,
      moversCarried: carried,
      moversBrandCarried: brandCarried,
      moversNotCarried: notCarried,
    });
  }
  board.sort(
    (a, b) =>
      b.retailRevenueMinor - a.retailRevenueMinor ||
      b.retailUnits - a.retailUnits ||
      a.displayName.localeCompare(b.displayName),
  );

  // -------------------------------------------------------------------------
  // 2 + 3. Dedupe area movers across stores (key: brand|name normalized).
  // -------------------------------------------------------------------------
  type Acc = {
    productName: string;
    inventoryType: string | null;
    typeConflict: boolean;
    brand: string | null;
    brandConflict: boolean;
    strainName: string | null;
    strainConflict: boolean;
    vendorName: string | null;
    vendorLicense: string | null;
    vendorConflict: boolean;
    totalUnits: number;
    totalRevenueMinor: number;
    minP25: number | null;
    topStoreRevenue: number;
    topStoreMedian: number | null;
    /** store display name → contributed revenue (for ordering). */
    storeRevenue: Map<string, number>;
  };
  const accs = new Map<string, Acc>();
  for (const [lic, list] of signalsByLicense) {
    const storeName = nameByLicense.get(lic) ?? lic;
    for (const s of list) {
      const productName = cleanStr(s.product_name);
      if (!productName) continue;
      const brand = cleanStr(s.brand);
      const key = `${normalizeKey(brand)}|${normalizeKey(productName)}`;
      const revenue = toFiniteNonNegative(s.revenue_minor);
      const unitsN = toFiniteNonNegative(s.units);
      const p25 = minorOrNull(s.p25_unit_price_minor);
      const median = minorOrNull(s.median_unit_price_minor);
      const invType = cleanStr(s.inventory_type);
      const strain = cleanStr(s.strain_name);
      const vName = cleanStr(s.vendor_name);
      const vLic = cleanStr(s.vendor_license);

      let acc = accs.get(key);
      if (!acc) {
        acc = {
          productName,
          inventoryType: invType,
          typeConflict: false,
          brand,
          brandConflict: false,
          strainName: strain,
          strainConflict: false,
          vendorName: vName,
          vendorLicense: vLic,
          vendorConflict: false,
          totalUnits: 0,
          totalRevenueMinor: 0,
          minP25: null,
          topStoreRevenue: -1,
          topStoreMedian: null,
          storeRevenue: new Map(),
        };
        accs.set(key, acc);
      } else {
        // Field consistency: agree → keep; disagree → conflict → null. A field
        // that is null on one row but set on another is NOT a conflict (thin
        // rows shouldn't erase knowledge); only two DIFFERENT values are.
        if (invType && acc.inventoryType && normalizeKey(invType) !== normalizeKey(acc.inventoryType)) {
          acc.typeConflict = true;
        } else if (invType && !acc.inventoryType) acc.inventoryType = invType;
        if (strain && acc.strainName && normalizeKey(strain) !== normalizeKey(acc.strainName)) {
          acc.strainConflict = true;
        } else if (strain && !acc.strainName) acc.strainName = strain;
        // Vendor: identity is the LICENSE; two different licenses conflict.
        if (vLic && acc.vendorLicense && vLic !== acc.vendorLicense) {
          acc.vendorConflict = true;
        } else if (vLic && !acc.vendorLicense) {
          acc.vendorLicense = vLic;
          acc.vendorName = vName;
        }
      }
      acc.totalUnits += unitsN;
      acc.totalRevenueMinor += revenue;
      if (p25 != null && (acc.minP25 == null || p25 < acc.minP25)) acc.minP25 = p25;
      if (revenue > acc.topStoreRevenue) {
        acc.topStoreRevenue = revenue;
        acc.topStoreMedian = median;
      }
      acc.storeRevenue.set(storeName, (acc.storeRevenue.get(storeName) ?? 0) + revenue);
    }
  }

  const buyList: BuyListRow[] = [];
  const undercuts: UndercutRow[] = [];
  for (const acc of accs.values()) {
    const stores = [...acc.storeRevenue.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name);
    const brand = acc.brandConflict ? null : acc.brand;
    const status = menuStatusFor(index, acc.productName, brand);
    const inventoryType = acc.typeConflict ? null : acc.inventoryType;

    if (status === "carried") {
      // Undercut board: needs BOTH our exact-match price and their p25.
      const ourPrice = index.namePrices.get(normalizeKey(acc.productName)) ?? null;
      if (ourPrice != null && acc.minP25 != null) {
        undercuts.push({
          productName: acc.productName,
          brand,
          inventoryType,
          stores,
          storeCount: stores.length,
          totalUnits: acc.totalUnits,
          totalRevenueMinor: acc.totalRevenueMinor,
          theirP25Minor: acc.minP25,
          ourPriceMinor: ourPrice,
          deltaMinor: ourPrice - acc.minP25,
        });
      }
      continue;
    }

    buyList.push({
      productName: acc.productName,
      inventoryType,
      brand,
      strainName: acc.strainConflict ? null : acc.strainName,
      vendorName: acc.vendorConflict ? null : acc.vendorName,
      vendorLicense: acc.vendorConflict ? null : acc.vendorLicense,
      stores,
      storeCount: stores.length,
      totalUnits: acc.totalUnits,
      totalRevenueMinor: acc.totalRevenueMinor,
      priceToBeatMinor: acc.minP25,
      topStoreMedianMinor: acc.topStoreMedian,
      menuStatus: status,
      suggestedCategory: suggestLeadCategory(inventoryType),
    });
  }

  buyList.sort(
    (a, b) =>
      b.totalRevenueMinor - a.totalRevenueMinor ||
      b.totalUnits - a.totalUnits ||
      a.productName.localeCompare(b.productName),
  );
  // Priced-above-beat first (largest gap = most urgent), then the safely-below.
  undercuts.sort(
    (a, b) =>
      b.deltaMinor - a.deltaMinor ||
      b.totalRevenueMinor - a.totalRevenueMinor ||
      a.productName.localeCompare(b.productName),
  );

  return {
    area,
    competitorCount: areaRoster.length,
    board,
    buyList: buyList.slice(0, Math.max(0, maxBuy)),
    undercuts: undercuts.slice(0, Math.max(0, maxUndercut)),
    menuItemCount: index.itemCount,
  };
}

// ---------------------------------------------------------------------------
// Grounded demand-signal copy for a promoted buy-list row (used by the Start
// PO action — every figure comes from this drop, nothing estimated).
// ---------------------------------------------------------------------------

export function buildBuyRowDemandSignal(row: {
  stores: string[];
  totalUnits: number;
  totalRevenueMinor: number;
  priceToBeatMinor: number | null;
  areaLabel: string;
}): string {
  const dollars = (minor: number) => `$${(minor / 100).toFixed(2)}`;
  const parts = [
    `${row.areaLabel} CCRS: ${row.stores.length} store${row.stores.length === 1 ? "" : "s"} (${row.stores.slice(0, 3).join(", ")})`,
    `${Math.round(row.totalUnits).toLocaleString("en-US")} units`,
    `${dollars(row.totalRevenueMinor)} revenue this drop`,
  ];
  if (row.priceToBeatMinor != null) parts.push(`price to beat ${dollars(row.priceToBeatMinor)}`);
  return parts.join(" · ");
}
