import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCardVisual } from "@/components/menu/ProductCardVisual";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { getMockMenuItemById, mockMenuItems } from "@/lib/leafly/mock-menu";
import type { GreenwayCannabinoid, GreenwayMenuItem } from "@/lib/leafly/types";
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";
import { getPosPreviewMenuItemById, posMenuPreviewItems } from "@/lib/pos/preview-menu";

type ProductTone = {
  border: string;
  glow: string;
  glowSoft: string;
  panel: string;
  pill: string;
  packageGradient: string;
};

const productTones: Record<GreenwayMenuItem["strainType"], ProductTone> = {
  sativa: {
    border: "#b46f34",
    glow: "rgba(217,117,39,0.95)",
    glowSoft: "rgba(255,151,53,0.28)",
    panel: "rgba(42,25,13,0.76)",
    pill: "#a76b3d",
    packageGradient: "linear-gradient(145deg,#f0422f 0%,#ff9d18 48%,#75c85a 100%)",
  },
  indica: {
    border: "#5499b8",
    glow: "rgba(84,153,184,0.96)",
    glowSoft: "rgba(116,184,214,0.3)",
    panel: "rgba(11,26,34,0.78)",
    pill: "#6f91a4",
    packageGradient: "linear-gradient(145deg,#6d39cf 0%,#c33f9d 50%,#6ec563 100%)",
  },
  hybrid: {
    border: "#6f835f",
    glow: "rgba(126,151,95,0.96)",
    glowSoft: "rgba(160,184,127,0.3)",
    panel: "rgba(27,22,31,0.78)",
    pill: "#728068",
    packageGradient: "linear-gradient(145deg,#58156e 0%,#a04ea5 42%,#f18b26 100%)",
  },
  cbd: {
    border: "#9a78a9",
    glow: "rgba(160,112,190,0.94)",
    glowSoft: "rgba(209,151,234,0.3)",
    panel: "rgba(34,24,40,0.78)",
    pill: "#906aa3",
    packageGradient: "linear-gradient(145deg,#6635d2 0%,#e565c8 48%,#54d4aa 100%)",
  },
  unknown: {
    border: "#f1f1f1",
    glow: "rgba(255,255,255,0.7)",
    glowSoft: "rgba(255,255,255,0.23)",
    panel: "rgba(14,14,14,0.84)",
    pill: "#f1f1f1",
    packageGradient: "linear-gradient(145deg,#333 0%,#bfbfbf 55%,#fafafa 100%)",
  },
};

const categoryAliases: Partial<Record<GreenwayMenuItem["category"], string>> = {
  "preroll-pack": "Preroll",
  preroll: "Preroll",
  "infused-preroll": "Preroll",
  "infused-preroll-pack": "Preroll",
  "disposable-cartridge": "Vape",
  cartridge: "Vape",
  "edible-solid": "Edible",
  "edible-liquid": "Drink",
  paraphernalia: "Accessory",
};

function formatCompound(compound: GreenwayCannabinoid) {
  if (!compound.value) return `${compound.type.toUpperCase()}: --`;
  return `${compound.type.toUpperCase()}: ${compound.value}${compound.unit}`;
}

function getMenuItemById(id: string) {
  return getPosPreviewMenuItemById(id) ?? getMockMenuItemById(id);
}

function isNonCannabisItem(item: GreenwayMenuItem) {
  return item.category === "paraphernalia";
}

function toneForItem(item: GreenwayMenuItem) {
  if (isNonCannabisItem(item)) return productTones.unknown;
  if (item.strainType === "unknown") return productTones.hybrid;
  return productTones[item.strainType];
}

function displayStrain(item: GreenwayMenuItem) {
  if (isNonCannabisItem(item)) return "Non Cannabis";
  // For cannabis items where strain type is still unknown (edibles, topicals),
  // show the category label since strain type doesn't meaningfully apply
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

function productFrameStyle(tone: ProductTone): CSSProperties {
  return {
    borderColor: tone.border,
    backgroundImage: `radial-gradient(ellipse 46% 58% at -10% 48%, ${tone.glowSoft} 0%, transparent 62%), radial-gradient(ellipse 42% 52% at 110% 54%, ${tone.glowSoft} 0%, transparent 62%), linear-gradient(180deg, rgba(13,13,13,0.98), ${tone.panel} 56%, rgba(6,6,6,1))`,
    boxShadow: `inset 16px 0 32px -30px ${tone.glow}, inset -16px 0 32px -30px ${tone.glow}, 0 16px 48px rgba(0,0,0,0.42)`,
  };
}

function salePriceFor(item: GreenwayMenuItem) {
  if (isNonCannabisItem(item)) return undefined;
  return Math.round(item.priceMinorUnits * 0.7);
}

function ProductHeroArt({ item, tone }: { item: GreenwayMenuItem; tone: ProductTone }) {
  const nonCannabis = isNonCannabisItem(item);
  const initials = brandInitials(item.brand);
  const label = categoryLabel(item).toUpperCase();

  if (nonCannabis) {
    return (
      <div className="relative flex h-full min-h-[20rem] items-center justify-center overflow-hidden bg-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_52%_45%,rgba(0,0,0,0.06),transparent_35%),linear-gradient(180deg,#fff,#f2f2f2)]" />
        <div className="relative h-72 w-44 rotate-[-8deg]">
          <div className="absolute left-[45%] top-0 h-32 w-4 rounded-full bg-zinc-400 shadow-lg" />
          <div className="absolute left-[40%] top-24 h-20 w-8 rounded-full bg-gradient-to-b from-zinc-300 to-zinc-700 shadow-md" />
          <div className="absolute bottom-4 left-7 h-32 w-32 rounded-full bg-gradient-to-br from-[#722118] via-[#d57d38] to-[#3c160f] shadow-2xl shadow-black/25" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-[20rem] items-center justify-center overflow-hidden bg-white">
      <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 24% 14%, rgba(255,255,255,0.96), transparent 21%), radial-gradient(circle at 75% 74%, ${tone.glowSoft}, transparent 44%), linear-gradient(145deg, #ffffff 0%, #f8f8f8 62%, #ececec 100%)` }} />
      <div className="relative flex h-[18rem] w-[12.25rem] flex-col items-center justify-between overflow-hidden rounded-[1.3rem] border border-black/15 bg-[#111] p-3.5 shadow-[0_24px_46px_rgba(0,0,0,0.28)]">
        <div className="absolute inset-0 opacity-95" style={{ background: tone.packageGradient }} />
        <div className="absolute inset-x-0 top-0 h-14 bg-white/12" />
        <div className="relative z-10 w-full text-center text-[0.62rem] font-black uppercase tracking-[0.24em] text-black/62">{label}</div>
        <div className="relative z-10 grid h-24 w-24 place-items-center rounded-full bg-black text-2xl font-black uppercase text-white shadow-xl shadow-black/30">{initials}</div>
        <div className="relative z-10 w-full rounded-md bg-black/16 px-2 py-2 text-center text-[0.75rem] font-black uppercase leading-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]">
          {displayStrain(item)} Formula
        </div>
      </div>
    </div>
  );
}

function relatedItemsFor(item: GreenwayMenuItem) {
  const allItems = [...posMenuPreviewItems, ...mockMenuItems];
  const sameBrand = allItems.filter((candidate) => candidate.brand === item.brand && candidate.id !== item.id);
  const fallback = allItems.filter((candidate) => candidate.id !== item.id && candidate.category === item.category);
  const related = sameBrand.length ? sameBrand : fallback;
  return related.slice(0, 8);
}

export function generateStaticParams() {
  return [...posMenuPreviewItems, ...mockMenuItems].map((item) => ({ id: item.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const item = getMenuItemById(id);

  if (!item) {
    return {
      title: "Product Not Found | Greenway Marijuana",
    };
  }

  return {
    title: `${item.name} | Greenway Marijuana Menu`,
    description: item.description,
  };
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = getMenuItemById(id);

  if (!item) notFound();

  const tone = toneForItem(item);
  const firstVariant = item.variants[0];
  const unitLabel = firstVariant?.label ? `/${firstVariant.label}` : "";
  const originalPrice = item.priceMinorUnits;
  const salePrice = salePriceFor(item);
  const activePrice = salePrice ?? originalPrice;
  const relatedItems = relatedItemsFor(item);
  const brandHref = `/menu?brand=${encodeURIComponent(item.brand)}`;
  const productDescription = item.description?.trim() || "No description available for this product.";
  const showCannabinoids = !isNonCannabisItem(item);

  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <div className="hidden md:block">
        <Header />
      </div>

      <section className="mx-auto w-full max-w-[430px] px-4 pb-10 pt-5 md:max-w-4xl md:px-8 lg:max-w-6xl">
        <Link href="/menu" className="inline-flex items-center text-[0.68rem] font-black uppercase tracking-[0.18em] text-white transition hover:text-[var(--greenway)]">
          ← Back
        </Link>

        <nav className="mt-5 flex flex-wrap items-center gap-2 text-[0.72rem] font-black text-zinc-500" aria-label="Breadcrumb">
          <Link href="/" className="text-zinc-300 hover:text-white">Home</Link>
          <span>〉</span>
          <Link href="/menu" className="text-zinc-300 hover:text-white">Menu</Link>
          <span>〉</span>
          <span className="line-clamp-1 text-zinc-400">{item.name}</span>
        </nav>

        <div className="mt-6 grid gap-6 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
          <div className="overflow-hidden border bg-white" style={{ borderColor: tone.border }}>
            <ProductHeroArt item={item} tone={tone} />
          </div>

          <article className="relative overflow-hidden border p-4" style={productFrameStyle(tone)}>
            <span className="pointer-events-none absolute -left-px top-9 h-44 w-px opacity-90 blur-[1px]" style={{ background: tone.glow }} aria-hidden="true" />
            <span className="pointer-events-none absolute -right-px top-20 h-48 w-px opacity-90 blur-[1px]" style={{ background: tone.glow }} aria-hidden="true" />

            <p className="text-center text-[1.28rem] font-black uppercase leading-none tracking-[0.16em] text-white">{item.brand}</p>
            <h1 className="mt-5 text-[2.36rem] font-black leading-[0.96] text-white md:text-6xl">{item.name}</h1>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex min-h-8 items-center rounded-[2px] px-3 py-1.5 text-sm font-black uppercase leading-none text-white" style={{ backgroundColor: tone.pill, color: isNonCannabisItem(item) ? "#111" : "#fff" }}>
                {displayStrain(item)}
              </span>
              <span className="inline-flex min-h-8 items-center rounded-[2px] bg-white px-3 py-1.5 text-sm font-black leading-none text-black">{firstVariant?.label ?? categoryLabel(item)}</span>
              {showCannabinoids ? <span className="inline-flex min-h-8 items-center rounded-[2px] bg-white px-3 py-1.5 text-sm font-black uppercase leading-none text-black">THC: {item.thc ?? "--"}</span> : null}
            </div>

            <div className="mt-8 flex items-end gap-3 leading-none">
              {salePrice ? <span className="pb-1.5 text-[1.35rem] font-black text-zinc-400 line-through">{formatMinorCurrency(originalPrice)}</span> : null}
              <span className="text-[2.55rem] font-black text-[var(--orange)]">{formatMinorCurrency(activePrice)}</span>
              {unitLabel ? <span className="pb-2 text-base font-black text-white/90">{unitLabel}</span> : null}
            </div>

            <div className="mt-5 grid grid-cols-[1fr_1.4fr_1fr] items-center border border-white/15 bg-black/28 text-center">
              <button type="button" className="h-12 text-2xl font-black text-white/90" aria-label="Decrease quantity">−</button>
              <span className="border-x border-white/15 py-3 text-lg font-black">1</span>
              <button type="button" className="h-12 text-2xl font-black text-white/90" aria-label="Increase quantity">+</button>
            </div>

            <button type="button" className="mt-4 flex h-14 w-full items-center justify-center bg-white px-5 text-sm font-black uppercase tracking-[0.08em] text-black transition hover:bg-[var(--orange)]">
              Add to Cart - {formatMinorCurrency(activePrice)}
            </button>
          </article>
        </div>

        <section className="mt-8 border-t border-white/15 pt-5">
          <div className="grid grid-cols-2 border-b border-white/15 text-left">
            <button type="button" className="border-b-2 border-white pb-3 text-[0.76rem] font-black uppercase tracking-[0.2em] text-white">Description</button>
            <button type="button" className="pb-3 text-[0.76rem] font-black uppercase tracking-[0.2em] text-zinc-500">Lab Results</button>
          </div>
          <p className="mt-5 text-[0.95rem] leading-7 text-zinc-300">{productDescription}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {showCannabinoids && item.compounds.length > 0 ? (
              item.compounds.slice(0, 4).map((compound) => (
                <span key={`${compound.type}-${compound.value}-${compound.unit}`} className="rounded-[2px] bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.08em] text-black">
                  {formatCompound(compound)}
                </span>
              ))
            ) : (
              <span className="rounded-[2px] bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.08em] text-black">No lab values shown</span>
            )}
          </div>
        </section>

        <section className="mt-11 pb-2">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[1.38rem] font-black leading-none text-white">More from</p>
              <h2 className="mt-1 text-[1.72rem] font-black leading-none text-white">{item.brand}</h2>
            </div>
            <Link href={brandHref} className="shrink-0 text-[0.72rem] font-black uppercase tracking-[0.2em] text-white hover:text-[var(--greenway)]">
              View All →
            </Link>
          </div>

          {relatedItems.length > 0 ? (
            <div className="mt-5 -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {relatedItems.map((related) => (
                <ProductCardVisual key={related.id} item={related} salePriceMinorUnits={salePriceFor(related)} className="w-[17.25rem] shrink-0 snap-start" />
              ))}
            </div>
          ) : (
            <div className="mt-5 border border-white/10 bg-white/5 p-5 text-sm leading-6 text-zinc-300">No additional products from this brand are available in the current preview menu.</div>
          )}
        </section>
      </section>

      <div className="hidden md:block">
        <Footer />
      </div>
    </main>
  );
}
