/**
 * src/lib/purchasing/po-builder-core.ts
 *
 * PURE logic for the Purchase Order COMMAND CENTER (`/admin/purchasing/new`,
 * Task J). No `server-only`, no DB, no React — safe to import from both the
 * server page and the client builder island, and from vitest.
 *
 * Everything here operates on the REAL reorder suggestions produced by
 * `buildReorderSuggestions` (po-store) — rows structurally match the
 * builder's `SuggestionRow`. Nothing is estimated or invented:
 *
 *  - URGENCY classification is plain arithmetic over on-hand, velocity and
 *    the store's own lead-time setting (research: a buyer's first question is
 *    "what runs out before the next truck arrives?" — stockouts on top movers
 *    at the front of a purchase cycle are the #1 revenue leak per the
 *    dispensary demand-planning literature in docs/RESEARCH_CANNABIS_PURCHASING.md).
 *  - KPI rollups are simple sums/counts for the command strip (procurement
 *    dashboard practice: a FEW actionable metrics, not vanity counts).
 *  - Search / sort / selection presets are deterministic helpers so the
 *    client table stays thin and the behavior stays testable.
 *
 * Money is in MINOR UNITS (cents) throughout.
 */

// ---------------------------------------------------------------------------
// Inputs — structurally match the builder's SuggestionRow.
// ---------------------------------------------------------------------------

export type BuilderRowLike = {
  posProductKey: string | null;
  productName: string;
  brand: string | null;
  category: string | null;
  vendorId: string | null;
  vendorName: string | null;
  onHand: number;
  unit: string;
  unitCostMinor: number;
  avgDaily: number;
  reorderPoint: number;
  suggestedQty: number;
  belowReorderPoint: boolean;
  daysOfSupplyLeft: number;
};

// ---------------------------------------------------------------------------
// Urgency — the command center's primary lens.
// ---------------------------------------------------------------------------

/**
 * stockout  = nothing on the shelf while the product IS selling (on-hand ≤ 0,
 *             velocity > 0). Losing sales right now.
 * critical  = below the reorder point AND the remaining days of supply won't
 *             outlast the store's own lead time — it runs out before a typical
 *             delivery arrives unless ordered today.
 * low       = below the reorder point, but there's more runway than one lead
 *             time. Order soon.
 * healthy   = everything else, INCLUDING dormant rows with zero recent sales
 *             (no demand evidence ⇒ no purchase urgency — reordering a
 *             non-mover is how dead stock happens).
 */
export type UrgencyLevel = "stockout" | "critical" | "low" | "healthy";

export const URGENCY_RANK: Record<UrgencyLevel, number> = {
  stockout: 0,
  critical: 1,
  low: 2,
  healthy: 3,
};

export const URGENCY_LABEL: Record<UrgencyLevel, string> = {
  stockout: "Stockout",
  critical: "Critical",
  low: "Below reorder",
  healthy: "OK",
};

/** Classify one row. `leadTimeDays` is the store's real reorder setting. */
export function classifyUrgency(row: BuilderRowLike, leadTimeDays: number): UrgencyLevel {
  const lead = Number.isFinite(leadTimeDays) && leadTimeDays > 0 ? leadTimeDays : 0;
  const selling = row.avgDaily > 0;
  if (!selling) return "healthy"; // no demand evidence — never flag urgency
  if (row.onHand <= 0) return "stockout";
  if (row.belowReorderPoint && Number.isFinite(row.daysOfSupplyLeft) && row.daysOfSupplyLeft <= lead) {
    return "critical";
  }
  if (row.belowReorderPoint) return "low";
  return "healthy";
}

// ---------------------------------------------------------------------------
// Stable row keys — the client table sorts/filters, so per-row edit state must
// NEVER be keyed by array index.
// ---------------------------------------------------------------------------

/**
 * Stable identity for a suggestion row. `buildReorderSuggestions` already
 * dedupes lots on exactly this key (pos_product_key, else `name:<product>`),
 * so it is unique within one suggestion set.
 */
export function builderRowKey(row: Pick<BuilderRowLike, "posProductKey" | "productName">): string {
  return row.posProductKey ?? `name:${row.productName.trim().toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// KPI strip — a few REAL, actionable numbers (procurement-dashboard practice).
// ---------------------------------------------------------------------------

export type BuilderKpis = {
  totalRows: number;
  stockoutCount: number;
  criticalCount: number;
  lowCount: number;
  /** stockout + critical + low — everything that needs a buying decision. */
  needsActionCount: number;
  /** Σ suggestedQty over rows where suggestedQty > 0. */
  suggestedUnits: number;
  /** Σ suggestedQty × unitCostMinor over rows where suggestedQty > 0 (cents). */
  suggestedSpendMinor: number;
  /** Distinct vendor names on the rows in view (unknown vendors excluded). */
  vendorCount: number;
  /** Distinct categories on the rows in view (uncategorized excluded). */
  categoryCount: number;
};

export function buildBuilderKpis(rows: BuilderRowLike[], leadTimeDays: number): BuilderKpis {
  let stockoutCount = 0;
  let criticalCount = 0;
  let lowCount = 0;
  let suggestedUnits = 0;
  let suggestedSpendMinor = 0;
  const vendors = new Set<string>();
  const categories = new Set<string>();

  for (const r of rows) {
    const u = classifyUrgency(r, leadTimeDays);
    if (u === "stockout") stockoutCount++;
    else if (u === "critical") criticalCount++;
    else if (u === "low") lowCount++;
    if (r.suggestedQty > 0) {
      suggestedUnits += Math.round(r.suggestedQty);
      suggestedSpendMinor += Math.round(r.suggestedQty) * Math.round(r.unitCostMinor);
    }
    const v = r.vendorName?.trim();
    if (v) vendors.add(v.toLowerCase());
    const c = r.category?.trim();
    if (c) categories.add(c.toLowerCase());
  }

  return {
    totalRows: rows.length,
    stockoutCount,
    criticalCount,
    lowCount,
    needsActionCount: stockoutCount + criticalCount + lowCount,
    suggestedUnits,
    suggestedSpendMinor,
    vendorCount: vendors.size,
    categoryCount: categories.size,
  };
}

// ---------------------------------------------------------------------------
// Vendor / category rollups — "who do I owe a call today?" drill-down.
// ---------------------------------------------------------------------------

export type BuilderGroupRow = {
  /** Vendor display name or category label; "(unknown)" when the row has none. */
  label: string;
  lineCount: number;
  /** Rows classified stockout/critical/low. */
  needsActionCount: number;
  suggestedSpendMinor: number;
};

function groupBy(
  rows: BuilderRowLike[],
  leadTimeDays: number,
  labelOf: (r: BuilderRowLike) => string | null,
): BuilderGroupRow[] {
  const map = new Map<string, BuilderGroupRow>();
  for (const r of rows) {
    const label = labelOf(r)?.trim() || "(unknown)";
    const key = label.toLowerCase();
    const cur = map.get(key) ?? { label, lineCount: 0, needsActionCount: 0, suggestedSpendMinor: 0 };
    cur.lineCount++;
    if (classifyUrgency(r, leadTimeDays) !== "healthy") cur.needsActionCount++;
    if (r.suggestedQty > 0) {
      cur.suggestedSpendMinor += Math.round(r.suggestedQty) * Math.round(r.unitCostMinor);
    }
    map.set(key, cur);
  }
  return [...map.values()].sort(
    (a, b) =>
      b.needsActionCount - a.needsActionCount ||
      b.suggestedSpendMinor - a.suggestedSpendMinor ||
      a.label.localeCompare(b.label),
  );
}

export function groupRowsByVendor(rows: BuilderRowLike[], leadTimeDays: number): BuilderGroupRow[] {
  return groupBy(rows, leadTimeDays, (r) => r.vendorName);
}

export function groupRowsByCategory(rows: BuilderRowLike[], leadTimeDays: number): BuilderGroupRow[] {
  return groupBy(rows, leadTimeDays, (r) => r.category);
}

// ---------------------------------------------------------------------------
// Client-table helpers — search, sort, selection presets.
// ---------------------------------------------------------------------------

/** Case-insensitive substring search across name, brand, vendor, category. */
export function filterRowsByQuery<T extends BuilderRowLike>(rows: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    [r.productName, r.brand, r.vendorName, r.category].some(
      (f) => typeof f === "string" && f.toLowerCase().includes(q),
    ),
  );
}

export type BuilderSortKey =
  | "urgency"
  | "product"
  | "vendor"
  | "category"
  | "onHand"
  | "daysLeft"
  | "value";

export const BUILDER_SORT_OPTIONS: { key: BuilderSortKey; label: string }[] = [
  { key: "urgency", label: "Urgency (default)" },
  { key: "daysLeft", label: "Days of supply left" },
  { key: "value", label: "Suggested order value" },
  { key: "product", label: "Product name" },
  { key: "vendor", label: "Vendor" },
  { key: "category", label: "Category" },
  { key: "onHand", label: "On hand" },
];

/**
 * Stable sort of the rows. `urgency` ranks stockout → critical → low →
 * healthy with fewest days of supply first inside each band (the server's
 * default order, reproduced so client re-sorts round-trip cleanly).
 */
export function sortRows<T extends BuilderRowLike>(
  rows: T[],
  key: BuilderSortKey,
  leadTimeDays: number,
): T[] {
  const daysLeft = (r: BuilderRowLike) =>
    Number.isFinite(r.daysOfSupplyLeft) ? r.daysOfSupplyLeft : Number.MAX_SAFE_INTEGER;
  const value = (r: BuilderRowLike) => Math.round(r.suggestedQty) * Math.round(r.unitCostMinor);
  const byText = (a: string | null, b: string | null) =>
    (a ?? "\uffff").localeCompare(b ?? "\uffff", undefined, { sensitivity: "base" });

  const copy = [...rows];
  switch (key) {
    case "urgency":
      copy.sort(
        (a, b) =>
          URGENCY_RANK[classifyUrgency(a, leadTimeDays)] -
            URGENCY_RANK[classifyUrgency(b, leadTimeDays)] || daysLeft(a) - daysLeft(b),
      );
      break;
    case "daysLeft":
      copy.sort((a, b) => daysLeft(a) - daysLeft(b));
      break;
    case "value":
      copy.sort((a, b) => value(b) - value(a));
      break;
    case "product":
      copy.sort((a, b) => byText(a.productName, b.productName));
      break;
    case "vendor":
      copy.sort((a, b) => byText(a.vendorName, b.vendorName));
      break;
    case "category":
      copy.sort((a, b) => byText(a.category, b.category));
      break;
    case "onHand":
      copy.sort((a, b) => a.onHand - b.onHand);
      break;
  }
  return copy;
}

export type SelectionPreset = "needs_action" | "stockouts" | "critical" | "all" | "none";

/**
 * Row keys a selection preset should tick. Rows with suggestedQty ≤ 0 are
 * skipped for the urgency presets (nothing to order), matching the existing
 * pre-tick behavior.
 */
export function presetRowKeys(
  rows: BuilderRowLike[],
  preset: SelectionPreset,
  leadTimeDays: number,
): string[] {
  if (preset === "none") return [];
  if (preset === "all") return rows.map((r) => builderRowKey(r));
  const wanted: UrgencyLevel[] =
    preset === "stockouts"
      ? ["stockout"]
      : preset === "critical"
        ? ["stockout", "critical"]
        : ["stockout", "critical", "low"]; // needs_action
  return rows
    .filter((r) => r.suggestedQty > 0 && wanted.includes(classifyUrgency(r, leadTimeDays)))
    .map((r) => builderRowKey(r));
}

// ---------------------------------------------------------------------------
// Vendor sanity check — a PO goes to ONE vendor; warn when selected lines
// belong to other vendors' inventory records.
// ---------------------------------------------------------------------------

export function countVendorMismatches(
  lines: { vendorName: string | null }[],
  selectedVendorName: string | null,
): number {
  const sel = selectedVendorName?.trim().toLowerCase();
  if (!sel) return 0;
  return lines.filter((l) => {
    const v = l.vendorName?.trim().toLowerCase();
    return Boolean(v) && v !== sel;
  }).length;
}

// ---------------------------------------------------------------------------
// Empty-state guidance — never a barren message. States WHY it's empty and
// what to do next (grounded in how buildReorderSuggestions actually works:
// it evaluates ACTIVE inventory_lots and recent order_lines).
// ---------------------------------------------------------------------------

export type EmptyStateGuidance = {
  title: string;
  description: string;
  hints: string[];
};

export function buildEmptyStateGuidance(opts: {
  hasActiveFilters: boolean;
  hasPrefill: boolean;
}): EmptyStateGuidance {
  if (opts.hasActiveFilters) {
    return {
      title: "No products match these filters",
      description:
        "The filters above narrowed the reorder suggestions down to nothing. Reset them to see every product with active inventory, or loosen one filter at a time.",
      hints: [
        "Vendor and brand filters must match the names on your inventory records exactly (case doesn't matter).",
        "Excludes always win — a product excluded by one filter can't be re-included by another.",
      ],
    };
  }
  return {
    title: opts.hasPrefill
      ? "No inventory suggestions yet — your lead line is ready below"
      : "No active inventory to evaluate yet",
    description: opts.hasPrefill
      ? "Reorder suggestions come from active inventory lots and recent sales. There are none yet, but the product lead you promoted is pre-added below — confirm its quantity, cost, and vendor, then save."
      : "Reorder suggestions are computed from your ACTIVE inventory lots (on-hand, cost, vendor) and recent sales velocity. Once inventory is received into lots, every product appears here with a suggested order quantity.",
    hints: [
      "Receive inventory on the Inventory page (or import lots) — suggestions appear automatically from active lots.",
      "Sales velocity uses your recent POS orders; products with no sales still show, with no urgency flag.",
      "You can also start from Discovery → Leads: the Port Orchard battle plan's \u201cStart PO\u201d prefills this builder.",
    ],
  };
}
