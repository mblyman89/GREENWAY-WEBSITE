import { getContentForRender } from "@/lib/cms/render-content";
import { MERCH_AD_BLOCK, resolveMerchAd, type MerchAdView } from "@/lib/merch/merch-ad-core";

/**
 * R71 S4 / R72 S5 - read the Greenway Goods redirect ad ONCE per shop render.
 *
 * ShopPage calls this a single time and uses the result twice:
 *  1. the redirect ad at the bottom of the shop (MerchRedirectAdView), and
 *  2. the category advert cards handed to the shop's filter bar ("Greenway
 *     Merch" -> cards linking to greenwaymerch.com/tees, /hoodies, ...).
 *
 * Owner rule: "No product details can reach the main site ... A pure redirect
 * button, that's it." resolveMerchAd returns null unless the owner enabled the
 * ad in Merch Studio AND every link is https on the separate merch domain; the
 * view carries only words, pictures and category links - no prices, ids or cart.
 * Any failure returns null: an ad must never break the shop.
 */
export async function loadMerchAdView(): Promise<MerchAdView | null> {
  try {
    return resolveMerchAd(await getContentForRender(MERCH_AD_BLOCK));
  } catch {
    return null;
  }
}
