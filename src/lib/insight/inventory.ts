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
  // SLICE 6A: these two gaps have NO filter on the inventory list that can
  // isolate them (`pos_product_key is null` and `on_hand_qty = 0` are not
  // exposed as query knobs). They previously linked to `?status=active`, which
  // on a store where every lot is active narrowed nothing at all -- a "Fix →"
  // that reloaded the same page and looked broken.
  //
  // Rather than ship a link that pretends to filter, they are reported WITHOUT
  // an href. MissingInsight only renders the "Fix →" affordance when `href` is
  // set, so the count still shows and no dead button is offered. Giving these
  // real filters is a follow-up, not something to fake here.
  if (stats.missingProductLink > 0) {
    gaps.push({
      key: "missingProductLink",
      label: "active not linked to a catalog product",
      count: stats.missingProductLink,
      weight: 1,
    });
  }
  if (stats.emptyActive > 0) {
    gaps.push({
      key: "emptyActive",
      label: "active but out of stock (0 on hand)",
      count: stats.emptyActive,
      weight: 1,
    });
  }

  return gaps.sort((a, b) => b.weight - a.weight || b.count - a.count);
}
