import { ShopBrowser } from "@/components/ShopBrowser";
import { allCards, categoryCounts } from "@/lib/catalog";
import { MERCH_CATEGORIES } from "@/lib/catalog-core";

/** The one shop page: category cards; the filter bar jumps to each catalogue. */
export default function ShopPage() {
  const counts = categoryCounts();
  const categories = MERCH_CATEGORIES.map((c) => ({ ...c, count: counts[c.slug] ?? 0 }));
  return (
    <main>
      <ShopBrowser categories={categories} products={allCards()} current={null} />
    </main>
  );
}
