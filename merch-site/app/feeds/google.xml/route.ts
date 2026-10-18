import { allProducts } from "@/lib/catalog";
import { seoShipping, seoSite } from "@/lib/seo";
import { merchantFeedXml } from "@/lib/seo-core";

/**
 * R73 S4: Google Merchant Center product feed (free listings + Shopping).
 * Add it in Merchant Center as a "scheduled fetch" data source:
 * https://greenwaymerch.com/feeds/google.xml
 */
export const revalidate = 3600;

export function GET() {
  return new Response(merchantFeedXml(allProducts(), seoSite(), seoShipping()), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
