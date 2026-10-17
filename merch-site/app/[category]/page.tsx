import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShopBrowser } from "@/components/ShopBrowser";
import { Breadcrumbs } from "@/components/ui";
import { cardsIn, categoryCounts } from "@/lib/catalog";
import { CATEGORY_SLUGS, getCategory, MERCH_CATEGORIES } from "@/lib/catalog-core";

/** Catalogue page: /tees, /hoodies, /sweatshirts, /hats ... (aliases redirect in next.config.ts). */
export const dynamicParams = false;
export function generateStaticParams() {
  return CATEGORY_SLUGS.map((category) => ({ category }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const cat = getCategory((await params).category);
  return cat ? { title: cat.label, description: cat.blurb, alternates: { canonical: `/${cat.slug}` } } : {};
}

export default async function CataloguePage({ params }: { params: Promise<{ category: string }> }) {
  const cat = getCategory((await params).category);
  if (!cat) notFound();
  const counts = categoryCounts();
  const categories = MERCH_CATEGORIES.map((c) => ({ ...c, count: counts[c.slug] ?? 0 }));
  return (
    <main>
      <Breadcrumbs items={[{ label: cat.label }]} />
      <ShopBrowser categories={categories} products={cardsIn(cat.slug)} current={cat.slug} />
    </main>
  );
}
