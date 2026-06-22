import Link from "next/link";
import { HomeProductCard } from "@/components/home/HomeProductCard";
import { mockMenuItems, menuCategories } from "@/lib/leafly/mock-menu";
import type { GreenwayCategory, GreenwayMenuItem } from "@/lib/leafly/types";
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";

function firstProductForCategory(category: GreenwayCategory) {
  return mockMenuItems.find((item) => item.category === category);
}

function uniqueBrandProducts() {
  const seen = new Set<string>();

  return mockMenuItems
    .filter((item) => {
      if (seen.has(item.brand)) return false;
      seen.add(item.brand);
      return true;
    })
    .slice(0, 6);
}

function ShoppingSection({
  id,
  title,
  accent,
  products,
  getHref,
  getLabel,
  getLinkText,
  discount,
}: {
  id: string;
  title: string;
  accent: string;
  products: GreenwayMenuItem[];
  getHref: (item: GreenwayMenuItem) => string;
  getLabel: (item: GreenwayMenuItem) => string;
  getLinkText: (item: GreenwayMenuItem) => string;
  discount: number;
}) {
  const visibleProducts = products.slice(0, 6);

  return (
    <section id={id} className="bg-black text-white">
      <div className={`bg-gradient-to-r ${accent} px-4 py-8 text-black md:mx-[calc(50%-50vw)] md:min-h-[220px] md:px-8 md:py-12 lg:min-h-[260px] lg:py-16 xl:px-[calc((100vw-80rem)/2+2rem)]`}>
        <div className="mx-auto flex h-full max-w-7xl items-center">
          <h2 className="max-w-5xl text-3xl font-black uppercase leading-[0.88] tracking-tight md:text-6xl lg:text-7xl">
            {title}
          </h2>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-10 pt-4 md:px-8 md:pb-14 md:pt-6">
        <div className="grid grid-cols-2 items-start gap-x-3 gap-y-6 sm:gap-x-4 sm:gap-y-7 md:grid-cols-3 md:gap-x-5 md:gap-y-8 lg:gap-x-6">
          {visibleProducts.map((item) => (
            <div key={`${id}-${item.id}`} className="flex flex-col gap-2.5 md:gap-3">
              <HomeProductCard item={item} discount={discount} />
              <Link
                href={getHref(item)}
                className="self-start text-[0.72rem] font-black uppercase tracking-[0.12em] text-zinc-300 underline-offset-4 transition hover:text-[var(--gold)] hover:underline md:text-xs"
                aria-label={`Shop all ${getLabel(item)} products`}
              >
                {getLinkText(item)}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function PromoGrid() {
  const categoryProducts = menuCategories
    .filter((category) => category !== "paraphernalia")
    .map(firstProductForCategory)
    .filter((item): item is GreenwayMenuItem => Boolean(item));
  const brandProducts = uniqueBrandProducts();

  return (
    <>
      <ShoppingSection
        id="shop-by-category"
        title="SHOP BY CATEGORY"
        accent="from-[var(--greenway)] via-emerald-300 to-[var(--gold)]"
        products={categoryProducts}
        discount={25}
        getHref={(item) => `/menu?category=${encodeURIComponent(item.category)}`}
        getLabel={(item) => formatWebsiteCategory(item.category)}
        getLinkText={(item) => `Shop all ${formatWebsiteCategory(item.category).toLowerCase()}`}
      />
      <ShoppingSection
        id="shop-by-brand"
        title="SHOP BY BRAND"
        accent="from-[var(--gold)] via-[#ffb000] to-[var(--orange)]"
        products={brandProducts}
        discount={20}
        getHref={(item) => `/menu?brand=${encodeURIComponent(item.brand)}`}
        getLabel={(item) => item.brand}
        getLinkText={() => "Shop all ..."}
      />
    </>
  );
}
