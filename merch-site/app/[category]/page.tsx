import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MerchBanner } from "@/components/MerchBanner";
import { ShopBrowser } from "@/components/ShopBrowser";
import { Breadcrumbs } from "@/components/ui";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbJsonLd } from "@/lib/seo-core";
import { siteUrl } from "@/lib/site";
import { cardsIn, categoryCounts } from "@/lib/catalog";
import { CATEGORY_SLUGS, getCategory, MERCH_CATEGORIES } from "@/lib/catalog-core";
import { getMerchContent } from "@/lib/site-content";
import { bannerFor, cardCopy, categoryOverride } from "@/lib/site-content-core";

/** Catalogue page: /tees, /hoodies, /sweatshirts, /hats ... (aliases redirect in next.config.ts). */
export const dynamicParams = false;
/** R73 S3: owner-edited banner + card copy refresh every 60 s (ISR). */
export const revalidate = 60;
export function generateStaticParams() {
  return CATEGORY_SLUGS.map((category) => ({ category }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const base = getCategory((await params).category);
  const cat = base ? categoryOverride(await getMerchContent(), base) : null;
  return cat ? { title: cat.label, description: cat.blurb, alternates: { canonical: `/${cat.slug}` }, openGraph: { url: `/${cat.slug}`, images: [cat.image] } } : {};
}

export default async function CataloguePage({ params }: { params: Promise<{ category: string }> }) {
  const cat = getCategory((await params).category);
  if (!cat) notFound();
  const content = await getMerchContent();
  const counts = categoryCounts();
  const categories = MERCH_CATEGORIES.map((c) => ({ ...categoryOverride(content, c), count: counts[c.slug] ?? 0 }));
  return (
    <main>
      <JsonLd data={breadcrumbJsonLd(siteUrl(), [{ name: "Shop", path: "/" }, { name: cat.label, path: `/${cat.slug}` }])} />
      <Breadcrumbs items={[{ label: cat.label }]} />
      <MerchBanner banner={bannerFor(content, cat.slug)} priority />
      <ShopBrowser categories={categories} products={cardsIn(cat.slug)} current={cat.slug} copy={cardCopy(content)} />
    </main>
  );
}
