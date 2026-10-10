import "server-only";
/**
 * R38 S4 — the export's data path: EXACTLY the page's pipeline, so the
 * spreadsheet holds what the table shows.
 *
 * The page composes the same five steps inline (its wiring is pinned by
 * tests); this module repeats them for the export route, and
 * tests/compliance/r38-inventory-table.test.ts pins that both call the same
 * functions in the same order. Nothing here is a second definition of any
 * value: every number comes from the shared cores.
 *
 * Completeness is REPORTED, not assumed: the onboarding read and the
 * website-category resolve both say whether they finished, and the export
 * route refuses (503) rather than ship a spreadsheet with silent blanks.
 */
import { listAllLotsForFiltering } from "@/lib/inventory/store";
import { loadLotOnboardingIndex } from "@/lib/inventory/lot-onboarding-server";
import { attachLotOnboarding } from "@/lib/inventory/lot-onboarding-core";
import { attachLotWebsiteCategories } from "@/lib/inventory/lot-website-category-server";
import { attachInventoryMetrics } from "@/lib/inventory/inventory-metrics-core";
import { getInventoryCommandCenter } from "@/lib/inventory/inventory-intel";
import { loadLeaflyBadgeData } from "@/lib/inventory/leafly-badge-server";
import { pacificToday } from "@/lib/reports/timezone";

export async function loadInventoryTableLots() {
  const onboardingPromise = loadLotOnboardingIndex();
  const [allLots, intel, leafly] = await Promise.all([
    listAllLotsForFiltering(),
    getInventoryCommandCenter(),
    loadLeaflyBadgeData(),
  ]);
  const onboardingIndex = await onboardingPromise;
  const onboardedLots = attachLotOnboarding(allLots, onboardingIndex.byLot);
  const categorized = await attachLotWebsiteCategories(onboardedLots, onboardingIndex.byLot);
  const lots = attachInventoryMetrics(categorized.lots, {
    today: pacificToday(),
    liveKeys: categorized.liveKeys,
    abcByLot: intel.center.abcByLot,
  });
  return {
    lots,
    leafly,
    onboardingComplete: onboardingIndex.complete,
    categoriesComplete: categorized.complete,
  };
}
