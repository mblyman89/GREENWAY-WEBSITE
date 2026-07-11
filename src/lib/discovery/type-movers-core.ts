/**
 * src/lib/discovery/type-movers-core.ts
 *
 * Task I (I4): PURE grouping logic for the per-inventory-type product
 * leaderboards ("top 10 products from every single type, each in its own
 * section, with the vendor/brand those products come from" — owner request,
 * recorded verbatim in ROADMAP_BACKOFFICE_FIXES.md Task I).
 *
 * Input rows are persisted `discovery_market_signals` records with
 * kind='type_mover' (aggregate.ts emits ≤ TOP_TYPE_MOVERS_PER_TYPE per
 * inventory type; migration 0110 adds vendor_name/vendor_license).
 *
 * PURE: no imports beyond types, no I/O — exercised directly by the
 * compliance suite. NEVER GUESS: rows pass through untouched; grouping and
 * ordering only.
 */
import type { DiscoveryMarketSignalRow } from "@/lib/discovery/types";

export type TypeMoverGroup = {
  inventoryType: string;
  /** Sum of revenue_minor across the group's rows (section ordering key). */
  revenueMinor: number;
  /** Rows ranked by revenue desc, then product name for determinism. */
  rows: DiscoveryMarketSignalRow[];
};

/**
 * Group type_mover signals into per-inventory-type sections, biggest type
 * first. Non-type_mover kinds are ignored (the caller may pass the full
 * signal list). A null inventory_type folds into "(unattributed)" — honest,
 * never guessed.
 */
export function groupTypeMovers(signals: DiscoveryMarketSignalRow[]): TypeMoverGroup[] {
  const byType = new Map<string, DiscoveryMarketSignalRow[]>();
  for (const s of signals) {
    if (s.kind !== "type_mover") continue;
    const t = s.inventory_type ?? "(unattributed)";
    const list = byType.get(t);
    if (list) list.push(s);
    else byType.set(t, [s]);
  }
  const groups: TypeMoverGroup[] = [];
  for (const [inventoryType, rows] of byType.entries()) {
    rows.sort(
      (a, b) =>
        b.revenue_minor - a.revenue_minor ||
        (a.product_name ?? "").localeCompare(b.product_name ?? ""),
    );
    groups.push({
      inventoryType,
      revenueMinor: rows.reduce((acc, s) => acc + s.revenue_minor, 0),
      rows,
    });
  }
  groups.sort(
    (a, b) => b.revenueMinor - a.revenueMinor || a.inventoryType.localeCompare(b.inventoryType),
  );
  return groups;
}
