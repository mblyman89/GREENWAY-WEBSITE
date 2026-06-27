import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RelatedProductCard } from "@/components/menu/RelatedProductCard";
import { BackToMenuLink } from "@/components/menu/BackToMenuLink";
import { ProductDetailPurchasePanel } from "@/components/menu/ProductDetailPurchasePanel";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { JsonLd } from "@/components/seo/JsonLd";
import { getMockMenuItemById, mockMenuItems } from "@/lib/leafly/mock-menu";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";
import { getPosPreviewMenuItemById, posMenuPreviewItems } from "@/lib/pos/preview-menu";
import { breadcrumbSchema, pageMetadata, productSchema } from "@/lib/seo/seo";
import { getMerchDefById, getMerchMenuItemById, merchMenuItems } from "@/lib/merch/merch-catalog";
import { MerchDetailPanel } from "@/components/merch/MerchDetailPanel";

type ProductTone = {
  border: string;
  glow: string;
  glowSoft: string;
  pill: string;
  packageGradient: string;
};

const productTones: Record<GreenwayMenuItem["strainType"], ProductTone> = {
  sativa: {
    border: "#b46f34",
    glow: "rgba(217,117,39,0.95)",
    glowSoft: "rgba(255,151,53,0.28)",
    pill: "#a76b3d",
    packageGradient: "linear-gradient(145deg,#f0422f 0%,#ff9d18 48%,#75c85a 100%)",
  },
  indica: {
    border: "#5499b8",
    glow: "rgba(84,153,184,0.96)",
    glowSoft: "rgba(116,184,214,0.3)",
    pill: "#6f91a4",
    packageGradient: "linear-gradient(145deg,#6d39cf 0%,#c33f9d 50%,#6ec563 100%)",
  },
  hybrid: {
    border: "#6f835f",
    glow: "rgba(126,151,95,0.96)",
    glowSoft: "rgba(160,184,127,0.3)",
    pill: "#728068",
    packageGradient: "linear-gradient(145deg,#58156e 0%,#a04ea5 42%,#f18b26 100%)",
  },
  cbd: {
    border: "#9a78a9",
    glow: "rgba(160,112,190,0.94)",
    glowSoft: "rgba(209,151,234,0.3)",
    pill: "#906aa3",
    packageGradient: "linear-gradient(145deg,#6635d2 0%,#e565c8 48%,#54d4aa 100%)",
  },
  unknown: {
    border: "#f1f1f1",
    glow: "rgba(255,255,255,0.7)",
    glowSoft: "rgba(255,255,255,0.23)",
    pill: "#f1f1f1",
    packageGradient: "linear-gradient(145deg,#333 0%,#bfbfbf 55%,#fafafa 100%)",
  },
};

const categoryAliases: Partial<Record<GreenwayMenuItem["category"], string>> = {
  "preroll-pack": "Preroll Pack",
  preroll: "Preroll",
  "infused-preroll": "Infused Preroll",
  "infused-preroll-pack": "Infused Preroll Pack",
  "disposable-cartridge": "Vape",
  cartridge: "Vape",
  "edible-solid": "Edible",
  "edible-liquid": "Drink",
  paraphernalia: "Accessory",
};

function getMenuItemById(id: string) {
  return getMerchMenuItemById(id) ?? getPosPreviewMenuItemById(id) ?? getMockMenuItemById(id);
}

function isMerchItem(item: GreenwayMenuItem) {
  return item.category === "merch";
}

function isNonCannabisItem(item: GreenwayMenuItem) {
  return item.category === "paraphernalia" || item.category === "merch";
}

function toneForItem(item: GreenwayMenuItem) {
  if (isNonCannabisItem(item)) return productTones.unknown;
  if (item.strainType === "unknown") return productTones.hybrid;
  return productTones[item.strainType];
}

function displayStrain(item: GreenwayMenuItem) {
  if (isNonCannabisItem(item)) return "Non Cannabis";
  if (item.strainType === "unknown") return categoryAliases[item.category] ?? formatWebsiteCategory(item.category);
  return item.strainType.charAt(0).toUpperCase() + item.strainType.slice(1);
}

function categoryLabel(item: GreenwayMenuItem) {
  return categoryAliases[item.category] ?? formatWebsiteCategory(item.category);
}

function brandInitials(brand: string) {
  return (
    brand
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join("") || "G"
  );
}

function imageShellStyle(tone: ProductTone): CSSProperties {
  return {
    boxShadow: `0 22px 45px rgba(0,0,0,0.32), inset 0 0 0 1px rgba(0,0,0,0.08)`,
    borderColor: tone.border,
  };
}

function ProductHeroArt({ item, tone }: { item: GreenwayMenuItem; tone: ProductTone }) {
  const nonCannabis = isNonCannabisItem(item);
  const initials = brandInitials(item.brand);
  const label = categoryLabel(item).toUpperCase();

  // Merch shows the real product photograph (large, on white).
  if (isMerchItem(item)) {
    const def = getMerchDefById(item.id);
    return (
      <div className="relative flex h-full min-h-[20rem] items-center justify-center overflow-hidden bg-white md:min-h-[34rem]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={def?.imageUrl ?? "/merch/tshirt.webp"} alt={item.name} className="h-full w-full object-contain p-6 md:p-10" />
      </div>
    );
  }

  if (nonCannabis) {
    return (
      <div className="relative flex h-full min-h-[18.5rem] items-center justify-center overflow-hidden bg-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_52%_45%,rgba(0,0,0,0.06),transparent_35%),linear-gradient(180deg,#fff,#f2f2f2)]" />
        <div className="relative h-64 w-40 rotate-[-8deg]">
          <div className="absolute left-[45%] top-0 h-28 w-4 rounded-full bg-zinc-400 shadow-lg" />
          <div className="absolute left-[40%] top-20 h-20 w-8 rounded-full bg-gradient-to-b from-zinc-300 to-zinc-700 shadow-md" />
          <div className="absolute bottom-4 left-6 h-28 w-28 rounded-full bg-gradient-to-br from-[#722118] via-[#d57d38] to-[#3c160f] shadow-2xl shadow-black/25" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-[18.5rem] items-center justify-center overflow-hidden bg-white">
      <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 24% 14%, rgba(255,255,255,0.96), transparent 21%), radial-gradient(circle at 75% 74%, ${tone.glowSoft}, transparent 44%), linear-gradient(145deg, #ffffff 0%, #f8f8f8 62%, #ececec 100%)` }} />
      <div className="relative flex h-[15.8rem] w-[10.6rem] rotate-[-2deg] flex-col items-center justify-between overflow-hidden rounded-[1.12rem] border border-black/15 bg-[#111] p-3 shadow-[0_24px_46px_rgba(0,0,0,0.28)]">
        <div className="absolute inset-0 opacity-95" style={{ background: tone.packageGradient }} />
        <div className="absolute inset-x-0 top-0 h-12 bg-white/12" />
        <div className="relative z-10 w-full text-center text-[0.54rem] font-black uppercase tracking-[0.22em] text-black/62">{label}</div>
        <div className="relative z-10 grid h-[5.35rem] w-[5.35rem] place-items-center rounded-full bg-black text-xl font-black uppercase text-white shadow-xl shadow-black/30">{initials}</div>
        <div className="relative z-10 w-full rounded-md bg-black/16 px-2 py-1.5 text-center text-[0.68rem] font-black uppercase leading-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]">
          {displayStrain(item)} Formula
        </div>
      </div>
    </div>
  );
}

function relatedItemsFor(item: GreenwayMenuItem) {
  if (isMerchItem(item)) {
    return merchMenuItems.filter((candidate) => candidate.id !== item.id).slice(0, 8);
  }
  const allItems = [...posMenuPreviewItems, ...mockMenuItems];
  const sameBrand = allItems.filter((candidate) => candidate.brand === item.brand && candidate.id !== item.id);
  const fallback = allItems.filter((candidate) => candidate.id !== item.id && candidate.category === item.category);
  const related = sameBrand.length ? sameBrand : fallback;
  return related.slice(0, 8);
}

export function generateStaticParams() {
  return [...posMenuPreviewItems, ...mockMenuItems, ...merchMenuItems].map((item) => ({ id: item.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const item = getMenuItemById(id);

  if (!item) {
    return {
      title: "Product Not Found",
      robots: { index: false, follow: true },
    };
  }

  const description =
    item.description?.trim() ||
    `${item.name} by ${item.brand} — ${formatWebsiteCategory(item.category)} available at Greenway Marijuana in Port Orchard, WA.`;

  return pageMetadata({
    title: `${item.name} — ${item.brand}`,
    description,
    path: `/menu/products/${item.id}`,
  });
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = getMenuItemById(id);

  if (!item) notFound();

  const tone = toneForItem(item);
  const relatedItems = relatedItemsFor(item);
  const brandHref = `/menu?brand=${encodeURIComponent(item.brand)}`;
  const productDescription = item.description?.trim() || "No description available for this product.";
  const showCannabinoids = !isNonCannabisItem(item);

  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <JsonLd
        data={[
          productSchema({
            id: item.id,
            name: item.name,
            description: item.description,
            brand: item.brand,
            category: formatWebsiteCategory(item.category),
            priceMinorUnits: item.priceMinorUnits,
            inStock:
              item.inventoryStatus !== "unavailable" &&
              (item.variants?.reduce((sum, variant) => sum + (variant.inventoryLevel ?? 0), 0) ?? 1) > 0,
          }),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "Shop", path: "/menu" },
            { name: item.name, path: `/menu/products/${item.id}` },
          ]),
        ]}
        id="product"
      />
      <Header />

      <section className="mx-auto w-full max-w-[430px] px-4 pb-10 pt-4 md:max-w-[88rem] md:px-8 md:pt-8">
        <BackToMenuLink className="inline-flex items-center text-[0.68rem] font-black uppercase tracking-[0.18em] text-white transition hover:text-[var(--greenway)]">
          ← Back
        </BackToMenuLink>

        <nav className="mt-4 flex flex-wrap items-center gap-2 text-[0.7rem] font-black uppercase tracking-[0.08em] text-zinc-500" aria-label="Breadcrumb">
          <Link href="/" className="text-zinc-300 hover:text-white">Home</Link>
          <span>›</span>
          <BackToMenuLink className="text-zinc-300 hover:text-white">Menu</BackToMenuLink>
          <span>›</span>
          <span className="line-clamp-1 text-zinc-400">{item.name}</span>
        </nav>

        <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:items-start md:gap-10">
          <div className="overflow-hidden border bg-white md:sticky md:top-28" style={imageShellStyle(tone)}>
            <ProductHeroArt item={item} tone={tone} />
          </div>

          <article className="md:pt-1">
            <Link href={brandHref} className="text-[0.78rem] font-black uppercase tracking-[0.18em] text-[var(--orange)] transition hover:text-white">
              {item.brand}
            </Link>
            <h1 className="mt-2 text-[2.15rem] font-black leading-[0.96] tracking-[-0.045em] text-white md:text-6xl">{item.name}</h1>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!isMerchItem(item) ? (
                <span className="inline-flex min-h-7 items-center px-2.5 py-1 text-[0.72rem] font-black uppercase leading-none text-white" style={{ backgroundColor: tone.pill, color: isNonCannabisItem(item) ? "#111" : "#fff" }}>
                  {displayStrain(item)}
                </span>
              ) : (
                <span className="inline-flex min-h-7 items-center bg-[var(--greenway)] px-2.5 py-1 text-[0.72rem] font-black uppercase leading-none text-black">
                  Greenway Merch
                </span>
              )}
              {showCannabinoids ? <span className="inline-flex min-h-7 items-center bg-white px-2.5 py-1 text-[0.72rem] font-black uppercase leading-none text-black">THC: {item.thc ?? "--"}</span> : null}
              {showCannabinoids ? <span className="inline-flex min-h-7 items-center bg-white px-2.5 py-1 text-[0.72rem] font-black uppercase leading-none text-black">CBD: {item.cbd ?? "--"}</span> : null}
            </div>

            {isMerchItem(item) ? (
              (() => {
                const def = getMerchDefById(item.id);
                return def ? <MerchDetailPanel def={def} /> : <ProductDetailPurchasePanel item={item} />;
              })()
            ) : (
              <ProductDetailPurchasePanel item={item} />
            )}

            {/* Description tab (lab results intentionally omitted). Sits in the
                right column under the purchase panel to mirror the reference. */}
            <section className="mt-7 border-t border-white/15 pt-5">
              <div className="border-b border-white/15">
                <button type="button" className="border-b-2 border-[var(--orange)] pb-3 text-[0.76rem] font-black uppercase tracking-[0.2em] text-white">Description</button>
              </div>
              <p className="mt-5 text-[0.95rem] leading-7 text-zinc-300">{productDescription}</p>
            </section>
          </article>
        </div>

        <section className="mt-11 pb-2">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[1.15rem] font-black leading-none text-white">More from</p>
              <h2 className="mt-1 text-[1.6rem] font-black leading-none text-white">{item.brand}</h2>
            </div>
            <Link href={brandHref} className="shrink-0 text-[0.72rem] font-black uppercase tracking-[0.2em] text-white hover:text-[var(--greenway)]">
              View All
            </Link>
          </div>

          {relatedItems.length > 0 ? (
            <div className="mt-5 -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {relatedItems.map((related) => (
                <RelatedProductCard
                  key={related.id}
                  item={related}
                  className="w-[17.25rem] shrink-0 snap-start"
                />
              ))}
            </div>
          ) : (
            <div className="mt-5 border border-white/10 bg-white/5 p-5 text-sm leading-6 text-zinc-300">No additional products from this brand are available in the current preview menu.</div>
          )}
        </section>
      </section>

      <Footer />
    </main>
  );
}
