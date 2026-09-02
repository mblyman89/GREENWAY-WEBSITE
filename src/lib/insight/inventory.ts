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
import {
  LOT_GAP_DEFINITIONS,
  lotGapHref,
  type LotGapKey,
} from "@/lib/inventory/lot-gap-core";

/**
 * Read a gap's count off InventoryStats. Written as an exhaustive switch so
 * adding a gap to the pure core without wiring its counter is a COMPILE error,
 * not a silently-zero row the owner never sees.
 */
function gapCountFor(stats: InventoryStats, key: LotGapKey): number {
  switch (key) {
    case "missingProductLink":
      return stats.missingProductLink;
    case "emptyActive":
      return stats.emptyActive;
    case "missingExpiry":
      return stats.missingExpiry;
    case "unknownCost":
      return stats.unknownCost;
  }
}
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
      // SLICE 6A: `expiring=0` means "already past" -- a real narrowing.
      href: "/admin/inventory?status=active&expiring=0",
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
      // SLICE 6A: was `?status=active`. On the owner's store EVERY lot is
      // active (3,800 of 3,800), so this "Fix →" filtered 3,800 lots down to
      // 3,800 lots -- the page reloaded unchanged and the button looked dead.
      // `coa=no` is the filter the page has always supported and is the one
      // that actually isolates the lots this gap is about.
      href: "/admin/inventory?status=active&coa=no",
      weight: 3,
    });
  }
  if (stats.expiringSoon > 0) {
    gaps.push({
      key: "expiringSoon",
      label: `expiring within ${EXPIRING_SOON_DAYS} days`,
      count: stats.expiringSoon,
      href: `/admin/inventory?status=active&expiring=${EXPIRING_SOON_DAYS}`,
      weight: 2,
    });
  }
  // SLICE 7 resolves the follow-up SLICE 6A named.
  //
  // SLICE 6A left these gaps WITHOUT an href, because the inventory list had no
  // filter that could isolate them: linking to `?status=active` on a store
  // where every lot is active narrowed nothing, so the "Fix →" reloaded the
  // same page and looked broken. Rather than fake it, the counts were shown
  // with no button and the real filters were called a follow-up.
  //
  // Those filters now exist (lot-gap-core.ts + listLotsPaged), so the links are
  // real. Both the count and the link are derived from the SAME pure
  // definition, so they cannot drift apart again.
  //
  // `missingExpiry` and `unknownCost` are NEW in SLICE 7: before this slice
  // nothing counted a lot whose expiry date or unit cost was simply unknown.
  for (const def of LOT_GAP_DEFINITIONS) {
    const count = gapCountFor(stats, def.key);
    if (count > 0) {
      gaps.push({
        key: def.key,
        label: def.label,
        count,
        href: lotGapHref(def.key),
        weight: def.weight,
      });
    }
  }

  return gaps.sort((a, b) => b.weight - a.weight || b.count - a.count);
}
