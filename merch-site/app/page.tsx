import { MerchBanner } from "@/components/MerchBanner";
import { ShopBrowser } from "@/components/ShopBrowser";
import { allCards, categoryCounts } from "@/lib/catalog";
import { MERCH_CATEGORIES } from "@/lib/catalog-core";
import { getMerchContent } from "@/lib/site-content";
import { bannerFor, cardCopy, categoryOverride } from "@/lib/site-content-core";

/** R73 S3: owner-edited banner + card copy refresh every 60 s (ISR). */
export const revalidate = 60;

/** The one shop page: category cards; the filter bar jumps to each catalogue. */
export default async function ShopPage() {
  const content = await getMerchContent();
  const counts = categoryCounts();
  const categories = MERCH_CATEGORIES.map((c) => ({ ...categoryOverride(content, c), count: counts[c.slug] ?? 0 }));
  return (
    <main>
      <MerchBanner banner={bannerFor(content, "home")} priority />
      <ShopBrowser categories={categories} products={allCards()} current={null} copy={cardCopy(content)} />
    </main>
  );
}
