import "server-only";

/**
 * src/lib/leafly/preview-lookup.ts  (Slice L-5)
 *
 * Builds the pure `VariantLookup` that `preview-core.ts` needs, from the same
 * published menu feed the Leafly menu push itself uses.
 *
 * ── WHY IT READS THE SYNDICATION FEED AND NOT THE PRODUCTS TABLE ───────────
 * Leafly's `integratorVariantId` is whatever WE told Leafly a variant's id was
 * when we pushed the menu. `payload-core.ts` sets it from the syndication
 * variant id (`String(v.id)`), or, for an item with no variants, from the
 * synthesized `${item.id}-default`. So the ONLY way to resolve an id Leafly
 * sends back is to rebuild it the same way from the same source. Querying
 * products directly would work right up until the first item without variants,
 * whose `-default` suffix exists nowhere in the database.
 *
 * Both id shapes are therefore reconstructed here, deliberately mirroring
 * `variantsFor()`. If that function's id scheme ever changes, this must change
 * with it — which is why the correspondence is stated explicitly rather than
 * left for someone to infer.
 *
 * ── ORDERABILITY IS NOT RE-DECIDED HERE ────────────────────────────────────
 * Whether an item may be sold through a marketplace is already decided by
 * `decideOrderability()` (slice L-3), including the WAC 246-70 High-THC block.
 * Rule 11: it is called, not re-implemented. A second copy of that rule is
 * exactly how a DOH-restricted product would end up sellable on one path and
 * blocked on another.
 */

import { loadSyndicationFeed } from "@/lib/syndication/feed-source";
import { getLeaflySyncSettings } from "@/lib/syndication/engine-store";
import { decideOrderability } from "./orderability-core";
import type { VariantFacts, VariantLookup } from "./preview-core";

/**
 * Build a lookup over the currently published menu.
 *
 * Returns a lookup that answers `null` for everything if the menu cannot be
 * loaded. That is the safe direction: `preview-core` removes lines it cannot
 * resolve, so a failed load produces an empty cart rather than a cart priced
 * from stale or invented data. An empty preview is a visible problem; a
 * confidently wrong price is not.
 */
export async function buildLeaflyVariantLookup(): Promise<{
  lookup: VariantLookup;
  variantCount: number;
  loaded: boolean;
}> {
  const byId = new Map<string, VariantFacts>();

  // The owner's ordering toggle. `sendPickupAvailability` is the SAME field the
  // menu push threads into `decideOrderability()` (push.ts:412), so the preview
  // and the published menu cannot disagree about whether the shop is taking
  // orders at all.
  let pickupEnabled = false;
  try {
    const settings = await getLeaflySyncSettings();
    pickupEnabled = settings.sendPickupAvailability === true;
  } catch {
    // Default OFF. The toggle ships off (slice L-3), and an unreadable setting
    // must never be read as consent to sell.
    pickupEnabled = false;
  }

  try {
    const { items } = await loadSyndicationFeed();

    for (const item of items) {
      const decision = decideOrderability({
        inStock: item.inStock,
        dohCategory: item.dohCategory ?? null,
        pickupEnabled,
      });

      if (item.variants.length > 0) {
        for (const v of item.variants) {
          byId.set(String(v.id), {
            // `inStock: false` means zero, regardless of what the count says —
            // the same rule `variantInventoryLevel()` applies on the way out.
            inventoryLevel: v.inStock ? Math.max(0, Math.round(v.inventoryLevel)) : 0,
            priceMinorUnits: Math.round(v.priceMinorUnits),
            category: item.category,
            orderable: decision.availableForPickup,
          });
        }
      } else {
        // Mirrors the synthesized default variant in `variantsFor()`.
        byId.set(`${item.id}-default`, {
          inventoryLevel: item.inStock ? 1 : 0,
          priceMinorUnits: Math.round(item.priceMinorUnits),
          category: item.category,
          orderable: decision.availableForPickup,
        });
      }
    }

    return {
      lookup: (id: string) => byId.get(id) ?? null,
      variantCount: byId.size,
      loaded: true,
    };
  } catch {
    return { lookup: () => null, variantCount: 0, loaded: false };
  }
}
