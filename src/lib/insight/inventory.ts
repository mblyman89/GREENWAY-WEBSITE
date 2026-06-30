/**
 * src/lib/insight/inventory.ts
 *
 * Turns raw inventory stats into a ranked "needs attention" list for the
 * MissingInsight panel. Part of POS Slice 3.
 *
 * Surfaces the compliance + operational risks WA retailers usually miss:
 * recalled/quarantined lots, expired or soon-to-expire product, lots without a
 * COA (no traceability), and lots not linked to the catalog.
 */
import type { GapInsight } from "@/lib/insight/products";
import type { InventoryStats } from "@/lib/inventory/store";
import { EXPIRING_SOON_DAYS } from "@/lib/inventory/store";

export function inventoryGapInsights(stats: InventoryStats): GapInsight[] {
  const gaps: GapInsight[] = [];

  if (stats.recalled > 0) {
    gaps.push({
      key: "recalled",
      label: "currently flagged RECALLED — pull from sale",
      count: stats.recalled,
      href: "/admin/inventory?status=recalled",
      weight: 3,
    });
  }
  if (stats.expired > 0) {
    gaps.push({
      key: "expired",
      label: "past their expiry date",
      count: stats.expired,
      href: "/admin/inventory?status=active",
      weight: 3,
    });
  }
  if (stats.quarantine > 0) {
    gaps.push({
      key: "quarantine",
      label: "in quarantine awaiting review",
      count: stats.quarantine,
      href: "/admin/inventory?status=quarantine",
      weight: 3,
    });
  }
  if (stats.missingCoa > 0) {
    gaps.push({
      key: "missingCoa",
      label: "active without a linked COA / lab result",
      count: stats.missingCoa,
      href: "/admin/inventory?status=active",
      weight: 3,
    });
  }
  if (stats.expiringSoon > 0) {
    gaps.push({
      key: "expiringSoon",
      label: `expiring within ${EXPIRING_SOON_DAYS} days`,
      count: stats.expiringSoon,
      href: "/admin/inventory?status=active",
      weight: 2,
    });
  }
  if (stats.missingProductLink > 0) {
    gaps.push({
      key: "missingProductLink",
      label: "active not linked to a catalog product",
      count: stats.missingProductLink,
      href: "/admin/inventory?status=active",
      weight: 1,
    });
  }
  if (stats.emptyActive > 0) {
    gaps.push({
      key: "emptyActive",
      label: "active but out of stock (0 on hand)",
      count: stats.emptyActive,
      href: "/admin/inventory?status=active",
      weight: 1,
    });
  }

  return gaps.sort((a, b) => b.weight - a.weight || b.count - a.count);
}
