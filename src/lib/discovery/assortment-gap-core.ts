/**
 * src/lib/discovery/assortment-gap-core.ts
 *
 * PURE assortment-gap analysis (Task H, S12 — logged suggestion #4). Crosses
 * the statewide top movers from the monthly CCRS drop (migration 0106
 * `discovery_market_signals`, kind = 'statewide_mover') against Greenway's own
 * PUBLISHED menu items to answer: "which of the state's best sellers do we not
 * carry?"
 *
 * HONESTY (NEVER GUESS):
 *  - Matching is CONSERVATIVE and exact-after-normalization only (lowercase,
 *    trim, collapse whitespace). No fuzzy matching — a near-miss name renders
 *    as a gap rather than being silently "matched" to the wrong product. CCRS
 *    product names come from producer/processor systems and rarely equal a
 *    retail menu name verbatim, so BRAND matching is the primary signal:
 *      - carried        exact product-name match on the menu
 *      - brand_carried  we carry the brand, but not (that exact name)
 *      - not_carried    neither the name nor the brand appears on our menu
 *  - Movers without a brand can only be name-matched; that limitation is the
 *    caller's copy to state, not something this module papers over.
 *  - Money in MINOR UNITS end to end. Pure module (no I/O) — covered by
 *    tests/compliance/assortment-gap-core.test.ts.
 */

// ---------------------------------------------------------------------------
// Inputs — structurally match DiscoveryMarketSignalRow / MasterCandidateItem.
// ---------------------------------------------------------------------------

export type GapSignalLike = {
  // Task I (I4): "type_mover" rows may be present in mixed signal lists;
  // the runtime filter below only accepts null/statewide_mover rows.
  kind?: "statewide_mover" | "competitor_mover" | "type_mover";
  product_name: string | null;
  inventory_type: string | null;
  brand: string | null;
  strain_name: string | null;
  units: number;
  revenue_minor: number;
  median_unit_price_minor: number | null;
  p25_unit_price_minor: number | null;
};

export type GapMenuItemLike = {
  name: string;
  brand: string | null;
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type AssortmentGapStatus = "carried" | "brand_carried" | "not_carried";

export type AssortmentGapRow = {
  productName: string;
  inventoryType: string | null;
  brand: string | null;
  strainName: string | null;
  units: number;
  revenueMinor: number;
  medianUnitPriceMinor: number | null;
  p25UnitPriceMinor: number | null;
  status: AssortmentGapStatus;
  /** For brand_carried: how many menu items share the brand (context). */
  brandItemCount: number;
};

export type AssortmentGapReport = {
  /** Statewide movers, revenue desc, with carry status. Capped. */
  rows: AssortmentGapRow[];
  carriedCount: number;
  brandCarriedCount: number;
  notCarriedCount: number;
  /** How many published menu items the comparison used. */
  menuItemCount: number;
  /** How many statewide movers were considered (pre-cap). */
  moverCount: number;
};

/** Bound for the UI table. */
export const MAX_GAP_ROWS = 50;

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Conservative normalization: lowercase, trim, collapse internal whitespace.
 * Deliberately NOTHING else (no punctuation stripping, no token reordering) —
 * aggressive normalization manufactures false "carried" matches.
 */
export function normalizeKey(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Cross statewide movers against the published menu. Movers are processed in
 * revenue-desc order and capped at `max` (default MAX_GAP_ROWS). Rows without
 * a product name can't be compared and are skipped (never guessed).
 */
export function buildAssortmentGapReport(
  movers: GapSignalLike[],
  menu: GapMenuItemLike[],
  opts?: { max?: number },
): AssortmentGapReport {
  const max = opts?.max ?? MAX_GAP_ROWS;

  const menuNames = new Set<string>();
  const menuBrandCounts = new Map<string, number>();
  for (const item of menu) {
    const nameKey = normalizeKey(item.name);
    if (nameKey) menuNames.add(nameKey);
    const brandKey = normalizeKey(item.brand);
    if (brandKey) menuBrandCounts.set(brandKey, (menuBrandCounts.get(brandKey) ?? 0) + 1);
  }

  // Statewide movers only (competitor movers describe one store, not demand).
  const candidates = movers.filter(
    (m) => (m.kind == null || m.kind === "statewide_mover") && normalizeKey(m.product_name) !== "",
  );
  candidates.sort((a, b) => num(b.revenue_minor) - num(a.revenue_minor));

  const rows: AssortmentGapRow[] = [];
  let carriedCount = 0;
  let brandCarriedCount = 0;
  let notCarriedCount = 0;

  for (const m of candidates) {
    const nameKey = normalizeKey(m.product_name);
    const brandKey = normalizeKey(m.brand);
    const brandItemCount = brandKey ? (menuBrandCounts.get(brandKey) ?? 0) : 0;

    let status: AssortmentGapStatus;
    if (menuNames.has(nameKey)) {
      status = "carried";
      carriedCount += 1;
    } else if (brandItemCount > 0) {
      status = "brand_carried";
      brandCarriedCount += 1;
    } else {
      status = "not_carried";
      notCarriedCount += 1;
    }

    if (rows.length < max) {
      rows.push({
        productName: m.product_name as string,
        inventoryType: m.inventory_type,
        brand: m.brand,
        strainName: m.strain_name,
        units: num(m.units),
        revenueMinor: Math.round(num(m.revenue_minor)),
        medianUnitPriceMinor:
          typeof m.median_unit_price_minor === "number" && Number.isFinite(m.median_unit_price_minor)
            ? Math.round(m.median_unit_price_minor)
            : null,
        p25UnitPriceMinor:
          typeof m.p25_unit_price_minor === "number" && Number.isFinite(m.p25_unit_price_minor)
            ? Math.round(m.p25_unit_price_minor)
            : null,
        status,
        brandItemCount,
      });
    }
  }

  return {
    rows,
    carriedCount,
    brandCarriedCount,
    notCarriedCount,
    menuItemCount: menu.length,
    moverCount: candidates.length,
  };
}
