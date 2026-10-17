import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ProductCard } from "@/components/ShopBrowser";
import { ProductDetail } from "@/components/ProductDetail";
import { Breadcrumbs } from "@/components/ui";
import { allProducts, cardsIn, findProduct } from "@/lib/catalog";
import { getCategory, toCard } from "@/lib/catalog-core";

type Params = { params: Promise<{ category: string; handle: string }> };

export function generateStaticParams() {
  return allProducts().map((p) => ({ category: p.category, handle: p.handle }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  const p = findProduct(handle);
  return p ? { title: p.title, description: p.description.slice(0, 160) || undefined, alternates: { canonical: `/${p.category}/${p.handle}` }, openGraph: { images: p.images.slice(0, 1) } } : {};
}

export default async function ProductPage({ params }: Params) {
  const { category, handle } = await params;
  const product = findProduct(handle);
  if (!product) notFound();
  if (product.category !== category) permanentRedirect(`/${product.category}/${product.handle}`);
  const cat = getCategory(product.category)!;
  const more = cardsIn(cat.slug).filter((p) => p.handle !== product.handle).slice(0, 4);
  return (
    <main>
      <Breadcrumbs items={[{ label: cat.label, href: `/${cat.slug}` }, { label: product.title }]} />
      <section className="mx-auto w-full max-w-[430px] px-4 pb-10 pt-4 md:max-w-[88rem] md:px-8 md:pt-8">
        <Link href={`/${cat.slug}`} className="inline-flex items-center text-[0.68rem] font-black uppercase tracking-[0.18em] text-white transition hover:text-[var(--greenway)]">← Back to {cat.label}</Link>
        <ProductDetail product={toCard(product)} categoryLabel={cat.label} />
      </section>
      {more.length ? (
        <section className="mx-auto max-w-[var(--shop-max)] px-3 pb-10 sm:px-4 md:px-8">
          <h2 className="mb-5 text-2xl font-black text-white md:text-3xl">More {cat.label}</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {more.map((p, i) => <ProductCard key={p.handle} p={p} index={i} />)}
          </div>
        </section>
      ) : null}
    </main>
  );
}
