import { getContentForRender } from "@/lib/cms/render-content";
import { MERCH_AD_BLOCK, resolveMerchAd, type MerchAdView } from "@/lib/merch/merch-ad-core";
import { MerchRedirectAdView } from "@/components/merch/MerchRedirectAdView";

/**
 * R71 S4 - the Greenway Goods redirect ad at the bottom of the cannabis shop.
 *
 * This REPLACES the old in-menu "Greenway Merch" product cards (which were
 * sold through the cannabis cart). Owner rule: "No product details can reach
 * the main site ... A pure redirect button, that's it."
 *
 *  - Server component: no client JS, no cart, no product ids, no prices.
 *  - Reads ONE content block (merch.ad). Renders NOTHING unless the owner has
 *    enabled it in the Merch Studio AND the link is a valid https address on
 *    the separate merch domain (resolveMerchAd enforces this again here).
 *  - Every link is a plain anchor to that ONE address: new tab,
 *    rel="noopener noreferrer", referrerPolicy="no-referrer", no query string.
 *    The merch site receives no referrer and no customer data.
 *  - Pictures are plain <img> (the URL may be on the merch domain, which is
 *    not in next/image remotePatterns, and must not be proxied through this
 *    site's image optimizer).
 *  - The markup lives in MerchRedirectAdView.tsx (no server imports) so the
 *    Merch Studio preview renders the exact same thing.
 *  - The ClickTracker records the click (placement "other", slot
 *    "greenway-goods") on THIS site only, like any banner button.
 */
export async function MerchRedirectAd() {
  let view: MerchAdView | null = null;
  try {
    view = resolveMerchAd(await getContentForRender(MERCH_AD_BLOCK));
  } catch {
    view = null; // an ad must never break the shop
  }
  if (!view) return null;
  return <MerchRedirectAdView view={view} />;
}
