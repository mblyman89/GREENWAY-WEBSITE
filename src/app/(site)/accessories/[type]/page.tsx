import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "@/components/site/IntentLink";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { SiteBackground } from "@/components/site/SiteBackground";
import { AddAccessoryButton } from "@/components/menu/AddAccessoryButton";
import { pageMetadata } from "@/lib/seo/seo";
import { loadAccessoryTypePage } from "@/lib/noncannabis/shop-store";
import { readOnlineNcEnabled } from "@/lib/noncannabis/online-store";
import { ACCESSORY_FALLBACK_IMAGE, accessoryTypeHref, formatPriceRange } from "@/lib/noncannabis/shop-cards-core";
import { ncProductKey } from "@/lib/noncannabis/pos-catalog-core";
import { ONLINE_NC_OFF_MESSAGE } from "@/lib/noncannabis/online-core";

/**
 * OI-ACC S5 - one Other Inventory type (e.g. /accessories/bong): the card
 * picture and words, then each in-stock item with name, brand and shelf price.
 * Never cost, quantity, SKU or barcode. S6: an Add button per item ONLY when
 * the owner's online toggle is ON (checkout re-checks it server-side).
 */
export const revalidate = 60;

type Props = { params: Promise<{ type: string }> };

function money(n: number) {
  return `$${(n / 100).toFixed(2)}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type } = await params;
  const page = await loadAccessoryTypePage(decodeURIComponent(type));
  const label = page ? page.type.card_label || page.type.label : "Accessories";
  return pageMetadata({
    title: `${label} | Greenway Marijuana Port Orchard`,
    description: `${label} in stock at Greenway Marijuana in Port Orchard, WA. See prices, then pick up in store.`,
    path: accessoryTypeHref(decodeURIComponent(type)),
    image: "/og/menu.png",
    noindex: !page || page.items.length === 0,
  });
}

async function ItemList({ value }: { value: string }) {
  const [page, online] = await Promise.all([loadAccessoryTypePage(value), readOnlineNcEnabled()]);
  if (!page) notFound();
  const { items } = page;
  if (items.length === 0) {
    return <p className="mt-6 text-sm text-white/60">None in stock right now. Check back soon or ask in store.</p>;
  }
  const min = Math.min(...items.map((i) => i.priceMinor));
  const max = Math.max(...items.map((i) => i.priceMinor));
  return (
    <>
      <p className="mt-4 text-sm font-semibold text-white/90">
        {items.length} in stock &middot; {formatPriceRange(min, max)}
      </p>
      {!online ? <p className="mt-1 text-xs text-white/50">{ONLINE_NC_OFF_MESSAGE}</p> : null}
      <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((i) => (
          <li key={i.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-sm font-bold text-white">{i.name}</p>
            {i.brand ? <p className="text-xs text-white/50">{i.brand}</p> : null}
            <p className="mt-2 text-sm font-semibold text-white/90">{money(i.priceMinor)}</p>
            {online ? (
              <AddAccessoryButton ncKey={ncProductKey(i.id)} name={i.name} brand={i.brand} priceMinor={i.priceMinor} maxQty={i.maxQty} />
            ) : (
              <p className="mt-1 text-[11px] uppercase tracking-wide text-white/40">In store</p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export default async function AccessoryTypePage({ params }: Props) {
  const { type } = await params;
  const value = decodeURIComponent(type);
  const page = await loadAccessoryTypePage(value);
  if (!page) notFound();
  const t = page.type;
  const label = t.card_label || t.label;
  return (
    <main id="top">
      <SiteBackground />
      <Header />
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Shop", href: "/menu" },
          { label: "Accessories", href: "/menu/accessories" },
          { label },
        ]}
        maxWidthClassName="max-w-[var(--shop-max)]"
      />
      <section className="px-3 pb-12 pt-4 sm:px-4 md:px-8">
        <div className="mx-auto max-w-[var(--shop-max)]">
          <div className="grid gap-6 md:grid-cols-[minmax(0,22rem)_1fr] md:items-start">
            <div className="aspect-[4/3] overflow-hidden rounded-[1.35rem] border border-white/10 bg-zinc-900">
              {/* eslint-disable-next-line @next/next/no-img-element -- owner-picked card picture */}
              <img src={t.card_image || ACCESSORY_FALLBACK_IMAGE} alt="" className="h-full w-full object-cover" />
            </div>
            <div>
              <h1 className="text-3xl font-black uppercase tracking-tight text-white md:text-4xl">{label}</h1>
              {t.card_text ? <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300">{t.card_text}</p> : null}
              <Link href="/menu/accessories" className="mt-4 inline-block text-xs font-black uppercase tracking-[0.14em] text-[var(--greenway)]">
                &larr; All accessories
              </Link>
            </div>
          </div>
          <Suspense fallback={<p className="mt-6 text-sm text-white/50">Loading what&apos;s in stock...</p>}>
            <ItemList value={value} />
          </Suspense>
        </div>
      </section>
      <Footer />
    </main>
  );
}
