/**
 * R38 S1 — server half of lot-website-category-core: resolve EVERY lot's
 * website category in one batched pass (override + published menu + type map
 * + owner-created categories), then fold in the onboarding pick.
 *
 * Read-only. Never throws: on any failure the resolver's own fallbacks apply
 * (static type map + name heuristic), and `complete: false` lets the page say
 * so instead of showing a confident value it could not verify.
 */
import "server-only";
import {
  loadCustomCategoryMap,
  resolveWebsiteCategoriesWithLiveKeys,
} from "@/lib/inventory/website-category-resolver-server";
import { websiteCategoryLabel } from "@/lib/inventory/website-category-resolver";
import {
  attachLotWebsiteCategory,
  type LotWebsiteCategoryFields,
} from "@/lib/inventory/lot-website-category-core";
import type { LotOnboardingDraft } from "@/lib/inventory/lot-onboarding-core";

type ResolvableInventoryLot = {
  id: string;
  pos_product_key?: string | null;
  product_name?: string | null;
  inventory_type?: string | null;
  category?: string | null;
};

export async function attachLotWebsiteCategories<L extends ResolvableInventoryLot>(
  lots: readonly L[],
  draftsByLot: ReadonlyMap<string, LotOnboardingDraft>,
): Promise<{ lots: Array<L & LotWebsiteCategoryFields>; liveKeys: Set<string>; complete: boolean }> {
  let resolutions: Awaited<ReturnType<typeof resolveWebsiteCategoriesWithLiveKeys>>["resolutions"] = [];
  let liveKeys = new Set<string>();
  let custom = new Map<string, string>();
  let complete = true;
  try {
    const [res, customMap] = await Promise.all([
      resolveWebsiteCategoriesWithLiveKeys(
        lots.map((l) => ({
          posProductKey: l.pos_product_key ?? null,
          productName: l.product_name ?? null,
          inventoryType: l.inventory_type ?? null,
          category: l.category ?? null,
        })),
        { includeCustomCategories: true },
      ),
      loadCustomCategoryMap(),
    ]);
    resolutions = res.resolutions;
    liveKeys = res.liveKeys;
    custom = customMap;
  } catch (err) {
    console.error("[lot-website-category] resolve failed:", err);
    complete = false;
  }
  const labelOf = (v: string) => custom.get(v) || websiteCategoryLabel(v) || v;
  const picks = lots.map((l) => draftsByLot.get(l.id)?.chosen_website_category ?? null);
  return { lots: attachLotWebsiteCategory(lots, resolutions, picks, labelOf), liveKeys, complete };
}
