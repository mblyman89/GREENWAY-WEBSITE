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

import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";
import { cardTypeLabel } from "@/lib/menu/card-type-core";
import { strainTypeLabel } from "@/lib/menu/strain-taxonomy";
import {
  cardCannabinoids,
  cardRatioSlot,
  cardServingLine,
  deriveNetWeightLine,
  showProfilePillWithSlot,
} from "@/lib/menu/card-cannabinoids";
import { cardDisplay } from "@/lib/menu/card-brand-core";
// SLICE 95: vendor-pure "More from" selection + honest heading scope.
import { selectRelatedItems, type RelatedScope } from "@/lib/menu/related-products-core";
import { getLiveMenuItemByIdCached, loadLiveMenuItemsCached } from "@/lib/pos/live-menu";
import { withResolvedImages } from "@/lib/enrichment/image-resolver";
import { withMenuProfile } from "@/lib/menu/strain-terpenes-server";
import { withCategoryOverride } from "@/lib/menu/menu-category-override-server";
import { withDohCompliance } from "@/lib/menu/menu-doh-server";
// SLICE 18C: the badge cores. dohPillForItem was previously only consumed by
// ProductCardVisual, which is why the detail page silently dropped the pill.
import { dohPillForItem } from "@/lib/menu/menu-doh-badge-core";
import { classificationPillsForItem } from "@/lib/menu/menu-classification-badge-core";
import { resolveDisplayKnowledge } from "@/lib/menu/product-knowledge-display";
import { breadcrumbSchema, pageMetadata, productSchema } from "@/lib/seo/seo";
import { getEnrichmentForPublicItem } from "@/lib/enrichment/store";
import { productSeoMetadata } from "@/lib/enrichment/seo-draft-core";
import { getMerchDefById, getMerchMenuItemById, merchMenuItems, merchProductDefs, merchIdForKey } from "@/lib/merch/merch-catalog";
import { MerchDetailPanel } from "@/components/merch/MerchDetailPanel";
import { MerchProductCard } from "@/components/merch/MerchProductCard";

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
  // Indica-Hybrid: hybrid green with an indica-blue lean.
  "indica-hybrid": {
    border: "#5f88a0",
    glow: "rgba(95,136,160,0.96)",
    glowSoft: "rgba(138,178,178,0.3)",
    pill: "#5f8890",
    packageGradient: "linear-gradient(145deg,#5499b8 0%,#6ec583 55%,#7ed957 100%)",
  },
  // Sativa-Hybrid: hybrid green with a sativa-orange lean.
  "sativa-hybrid": {
    border: "#8a8a4f",
    glow: "rgba(170,150,70,0.96)",
    glowSoft: "rgba(190,180,110,0.3)",
    pill: "#8a8050",
    packageGradient: "linear-gradient(145deg,#ff9d18 0%,#c7c94f 52%,#7ed957 100%)",
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

async function getMenuItemById(id: string) {
  return getMerchMenuItemById(id) ?? (await getLiveMenuItemByIdCached(id));
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

/**
 * SLICE 43 (owner directive): the strain-type chip only appears for a VALIDATED
 * strain type. Unknown strain / non-cannabis → null → the chip is hidden (the
 * page tone still falls back to hybrid for unknown-strain cannabis).
 */
function displayStrain(item: GreenwayMenuItem): string | null {
  if (isNonCannabisItem(item)) return null;
  if (item.strainType === "unknown") return null;
  return strainTypeLabel(item.strainType);
}

/**
 * R29: same slot rule as the menu card (ProductCardVisual strainSlot) - a
 * ratio product shows its written ratio / cannabinoids in the strain chip, so
 * the card and the page a shopper clicks through to always agree.
 */
function strainSlot(item: GreenwayMenuItem): { text: string; title?: string; ratio: boolean } | null {
  if (isNonCannabisItem(item)) return null;
  const slot = cardRatioSlot(item);
  if (slot.kind !== "strain") return { text: slot.text, title: slot.title, ratio: true };
  const strain = displayStrain(item);
  return strain ? { text: strain, ratio: false } : null;
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

  // Real / approved-substitute photo (DF-3) takes priority over the stylized
  // mockup for cannabis + non-cannabis items. Merch keeps its own photo path.
  if (!isMerchItem(item) && item.imageUrl) {
    return (
      <div className="relative flex h-full min-h-[20rem] items-center justify-center overflow-hidden bg-white md:min-h-[44rem]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
        {item.imageIsFallback ? (
          <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/55 px-2 py-1 text-[0.62rem] font-semibold uppercase tracking-wide text-white/90 backdrop-blur-sm">
            Representative image
          </span>
        ) : null}
      </div>
    );
  }

  // Merch shows the real product photograph (large, on white).
  if (isMerchItem(item)) {
    const def = getMerchDefById(item.id);
    return (
      <div className="relative flex h-full min-h-[22rem] items-center justify-center overflow-hidden bg-white md:min-h-[44rem]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={def?.imageUrl ?? "/merch/tshirt.webp"} alt={item.name} className="h-full w-full object-contain p-6 md:p-12" />
      </div>
    );
  }

  if (nonCannabis) {
    return (
      <div className="relative flex h-full min-h-[20rem] items-center justify-center overflow-hidden bg-white md:min-h-[44rem]">
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
    <div className="relative flex h-full min-h-[20rem] items-center justify-center overflow-hidden bg-white md:min-h-[44rem]">
      <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 24% 14%, rgba(255,255,255,0.96), transparent 21%), radial-gradient(circle at 75% 74%, ${tone.glowSoft}, transparent 44%), linear-gradient(145deg, #ffffff 0%, #f8f8f8 62%, #ececec 100%)` }} />
      <div className="relative flex h-[15.8rem] w-[10.6rem] rotate-[-2deg] flex-col items-center justify-between overflow-hidden rounded-[1.12rem] border border-black/15 bg-[#111] p-3 shadow-[0_24px_46px_rgba(0,0,0,0.28)] md:h-[24rem] md:w-[16rem]">
        <div className="absolute inset-0 opacity-95" style={{ background: tone.packageGradient }} />
        <div className="absolute inset-x-0 top-0 h-12 bg-white/12" />
        <div className="relative z-10 w-full text-center text-[0.54rem] font-black uppercase tracking-[0.22em] text-black/62">{label}</div>
        <div className="relative z-10 grid h-[5.35rem] w-[5.35rem] place-items-center rounded-full bg-black text-xl font-black uppercase text-white shadow-xl shadow-black/30">{initials}</div>
        {/* SLICE 43: validated strain only — the category already prints in the
            top ribbon, so an unknown strain hides this ribbon entirely. */}
        {(() => {
          const slot = strainSlot(item);
          return slot ? (
            <div
              title={slot.title}
              className="relative z-10 w-full rounded-md bg-black/16 px-2 py-1.5 text-center text-[0.68rem] font-black uppercase leading-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]"
            >
              {slot.ratio ? slot.text : `${slot.text} Formula`}
            </div>
          ) : null;
        })()}
      </div>
    </div>
  );
}

function ChipGroup({ label, chips, accent }: { label: string; chips: string[]; accent: string }) {
  if (!chips.length) return null;
  return (
    <div>
      <p className="text-[0.62rem] font-black uppercase tracking-[0.22em] text-zinc-500">{label}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <span
            key={`${label}-${chip}`}
            className="inline-flex items-center rounded-full border px-2.5 py-1 text-[0.72rem] font-semibold capitalize text-zinc-200"
            style={{ borderColor: accent, backgroundColor: "rgba(255,255,255,0.04)" }}
          >
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}

async function relatedItemsFor(
  item: GreenwayMenuItem,
): Promise<{ items: GreenwayMenuItem[]; scope: RelatedScope }> {
  if (isMerchItem(item)) {
    return {
      items: merchMenuItems.filter((candidate) => candidate.id !== item.id).slice(0, 8),
      scope: "brand",
    };
  }
  // SLICE 40: overlay the KB strain profile (same as home + shop) so related
  // cards show the strain type instead of the raw POS value.
  //
  // SLICE 95 (owner bug, verified live): the old selector matched RAW brand
  // equality, so blank-brand items from DIFFERENT vendors grouped together
  // and leaked into each other's rails (a CERES topical under "More from
  // 2727"). selectRelatedItems groups by the SAME brand-else-vendor identity
  // the heading shows, never mixes vendors, ranks by purchasability →
  // same-category → price proximity (the add-to-cart enticement order), and
  // reports an honest scope for the heading when it must fall back.
  // R33: the owner's per-product category/type re-file applies here too.
  const allItems = await withCategoryOverride(await withMenuProfile(await loadLiveMenuItemsCached()));
  const selection = selectRelatedItems(item, allItems, 8);
  return { items: selection.items, scope: selection.scope };
}

// The menu is dynamic (published DB version), so product pages are NOT
// pre-generated from a frozen snapshot at build time: generateStaticParams
// returns an EMPTY list, every product renders the first time it is visited,
// and an unknown id still 404s through getMenuItemById → notFound()
// (dynamicParams stays at its default, true).
//
// USAGE-5f — WHY THE EMPTY generateStaticParams IS REQUIRED.
// `revalidate = 60` alone did nothing here. After the USAGE-5 merge the build
// output still listed this route as "ƒ (Dynamic) server-rendered on demand" and
// production still answered `x-vercel-cache: MISS` for every product URL,
// while /specials, /loyalty and /medical (no dynamic segment) went to HIT.
// Next.js docs, generateStaticParams → "All paths at runtime": "To statically
// render all paths the first time they're visited, return an empty array …
// You must always return an array from generateStaticParams, even if it's
// empty. Otherwise, the route will be dynamically rendered."
//
// USAGE-5 — WHY THIS IS NO LONGER `force-dynamic`.
// Measured on production (greenwaywebsite1.vercel.app, 2026-09-27): all 811
// product URLs in the sitemap answered `x-vercel-cache: MISS` with
// `cache-control: private, no-cache, no-store`, 0.5–0.8 s each, ~270–315 KB of
// HTML — and each render did the image resolution, KB knowledge, DOH registry
// and related-items work again for a page that is identical to every other
// visitor's (and every crawler's) copy of it.
//
// `revalidate = 60` renders a product once per minute at most, on demand, and
// the TTL is only the floor: `revalidatePublicMenuSurfaces()` (publish, reset,
// intake auto-publish) now also calls `revalidatePath("/menu/products/[id]",
// "page")`, so a publish is visible on the very next visit to any product
// page. The money is never cached: the price on this page is re-verified by
// repriceOrderLines at order placement (menu-cache-policy-core.ts, "Product
// detail" surface), which is the same argument that made the shop cacheable.
export const revalidate = 60;

/**
 * Empty on purpose: nothing is rendered at build time (a build must never pull
 * the menu, and 811+ product renders per deploy would be its own bleed), but
 * returning an array is what switches this dynamic segment from "server-render
 * every request" to "render once, serve from the cache for `revalidate`
 * seconds". See the USAGE-5f note above.
 */
export function generateStaticParams(): Array<{ id: string }> {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const item = await getMenuItemById(id);

  if (!item) {
    return {
      title: "Product Not Found",
      robots: { index: false, follow: true },
    };
  }

  const description =
    item.description?.trim() ||
    `${item.name} by ${item.brand} — ${formatWebsiteCategory(item.category)} available at Greenway Marijuana in Port Orchard, WA.`;

  // R23 (fix 4): the SEO title / meta description staff accept on the
  // enrichment page finally reach the page head. Only a PUBLISHED card's
  // values are served (productSeoMetadata), from the same row the card is
  // served (own key, else the product's published survivor - S20); merch has
  // no enrichment row, and a failed read keeps the defaults.
  const enrichment = isMerchItem(item) ? null : await getEnrichmentForPublicItem({ posKey: item.id, identityKey: item.identityKey });
  const seo = productSeoMetadata({ enrichment, defaultTitle: `${item.name} — ${item.brand}`, defaultDescription: description });

  return pageMetadata({
    title: seo.title,
    description: seo.description,
    path: `/menu/products/${item.id}`,
  });
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const baseItem = await getMenuItemById(id);

  if (!baseItem) notFound();

  // DF-3: resolve a real/approved-substitute image (non-throwing). Merch keeps
  // its own photo path, so we only resolve for cannabis + non-cannabis items.
  // Also overlay the KB strain profile (terpenes + leaning-hybrid strainType)
  // so the detail page matches the menu card. No-op when no KB/curated match.
  // SLICE D (SHOP-4): thread the DOH-compliant flag onto the detail item too,
  // from the same durable registry, so the product page agrees with the menu
  // card. Merch is non-cannabis → skip. Degrades to "no DOH" pre-migration.
  const [item] = isMerchItem(baseItem)
    ? [baseItem]
    : await withCategoryOverride(await withDohCompliance(await withMenuProfile(await withResolvedImages([baseItem]))));
  // R33: withCategoryOverride - the owner's website Category/Type re-file
  // (lot page) used to reach ONLY the shop grid; the product page kept the
  // onboarding category + type label. Same overlay, same degrade-to-identity.

  // 7b.1: KB-first curated knowledge, compliance-filtered for public display.
  // Merch/accessories are non-cannabis → the helper returns an empty result.
  const knowledge = isMerchItem(item) ? null : await resolveDisplayKnowledge(item);

  const tone = toneForItem(item);
  // SLICE 18C: the compliance pills for the detail page's chip row. Both
  // helpers return null / an empty array when the item has earned nothing, so
  // an ordinary product's page is unchanged. Merch is non-cannabis and never
  // passes through withDohCompliance, so it naturally yields no pills.
  const dohDetailPill = dohPillForItem(item);
  const classificationDetailPills = classificationPillsForItem(item);
  const { items: relatedItems, scope: relatedScope } = await relatedItemsFor(item);
  // SLICE 47 (owner Q4): label = brand, else vendor, else nothing; the shown
  // label is clipped from the FRONT of the displayed name (display only —
  // item.name is untouched for search/cart/admin/CCRS). Only a BRAND label
  // links to the brand filter; a vendor fallback renders as plain text because
  // the menu has no vendor filter param.
  const { label: pdpLabel, source: pdpLabelSource, name: pdpName } = cardDisplay(item);
  const brandHref = `/menu?brand=${encodeURIComponent(item.brand)}`;
  // Prefer curated KB copy when present, then the item's own description, then a
  // generic line. All KB copy is already compliance-filtered by the resolver.
  const productDescription =
    knowledge?.description?.trim() ||
    item.description?.trim() ||
    knowledge?.shortDescription?.trim() ||
    "No description available for this product.";
  const showCannabinoids = !isNonCannabisItem(item);
  // Honest cannabinoid display: package-TOTAL mg for edibles/drinks/tinctures,
  // accurate per-compound values, and a profile badge (THC / 1:1 / THC:CBD:CBN /
  // CBD). Keeps the detail page consistent with the product card.
  const detailCannabinoids = showCannabinoids ? cardCannabinoids(item) : null;
  const detailNetWeightLine = showCannabinoids ? deriveNetWeightLine(item) : null;
  // R29: ratio slot + per-serving breakdown, identical to the menu card.
  const detailStrainSlot = strainSlot(item);
  const detailRatioSlot = showCannabinoids ? cardRatioSlot(item) : ({ kind: "strain" } as const);
  const detailServingLine = showCannabinoids ? cardServingLine(item) : null;

  // Compliance-safe experiential + sensory descriptors from the KB (may be empty).
  const kbAroma = knowledge?.aromaNotes ?? [];
  const kbFlavor = knowledge?.flavorNotes ?? [];
  const kbEffects = knowledge?.effects ?? [];
  // Terpenes: prefer the menu-build terpenes already on the item; fall back to KB.
  const kbTerpenes = (item.terpenes?.length ? item.terpenes : knowledge?.terpenes) ?? [];
  const hasSensory = kbAroma.length > 0 || kbFlavor.length > 0 || kbEffects.length > 0 || kbTerpenes.length > 0;

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

        <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:items-stretch md:gap-10">
          {/* Image column stretches to the full height of the info column (md:items-stretch
              + h-full) so the picture is flush with the bottom of the description and stays
              completely fixed in place — it does NOT scroll/float with the user. */}
          <div className="overflow-hidden border bg-white md:h-full" style={imageShellStyle(tone)}>
            <ProductHeroArt item={item} tone={tone} />
          </div>

          <article className="md:pt-1">
            {pdpLabelSource === "brand" ? (
              <Link href={brandHref} className="text-[0.78rem] font-black uppercase tracking-[0.18em] text-[var(--orange)] transition hover:text-white">
                {pdpLabel}
              </Link>
            ) : pdpLabel ? (
              <span className="text-[0.78rem] font-black uppercase tracking-[0.18em] text-[var(--orange)]">{pdpLabel}</span>
            ) : null}
            {/* SLICE 49 (owner card layout): product TYPE line under the
                brand/vendor, mirroring the menu card. */}
            <p className="mt-1 text-[0.68rem] font-bold uppercase tracking-[0.2em] text-white/55">{cardTypeLabel(item)}</p>
            <h1 className="mt-2 text-[2.15rem] font-black leading-[0.96] tracking-[-0.045em] text-white md:text-6xl">{pdpName}</h1>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {/* SLICE 43: validated-data-only chips. The strain chip appears only
                  when a strain type is assigned; cannabinoid boxes come from the
                  unified `boxes` model (TOTAL THC folding THCA, total CBD, plus
                  minors CBG/CBN/CBC/CBDV). No "--" placeholders, ever. */}
              {isMerchItem(item) ? (
                <span className="inline-flex min-h-7 items-center bg-[var(--greenway)] px-2.5 py-1 text-[0.72rem] font-black uppercase leading-none text-black">
                  Greenway Merch
                </span>
              ) : detailStrainSlot ? (
                <span
                  title={detailStrainSlot.title}
                  data-slot={detailStrainSlot.ratio ? "ratio" : "strain"}
                  className="inline-flex min-h-7 items-center px-2.5 py-1 text-[0.72rem] font-black uppercase leading-none text-white"
                  style={{ backgroundColor: tone.pill }}
                >
                  {detailStrainSlot.text}
                </span>
              ) : null}
              {/* SLICE 18C: the DOH pill on the DETAIL page.
                  This closes a genuine pre-existing gap. The page has always
                  run withDohCompliance() on every non-cannabis-excluded item
                  (see the comment above at the item resolution), whose stated
                  intent was "so the product page agrees with the menu card" --
                  but no PDP surface ever rendered the result, so the registry
                  read was paid for and thrown away. A DOH product showed the
                  blue pill on its card and silently lost it on click.
                  Rendered here, in the same chip row, with the same markup the
                  card uses, so the two surfaces finally agree. */}
              {dohDetailPill ? (
                <span
                  className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border ${dohDetailPill.tone.border} bg-black/45 px-2.5 py-1 text-[0.66rem] font-black uppercase tracking-[0.1em] ${dohDetailPill.tone.text}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${dohDetailPill.tone.dot}`} aria-hidden="true" />
                  {dohDetailPill.label}
                </span>
              ) : null}
              {/* SLICE 18C: the sales-limit classification pills, so the detail
                  page carries the same badges as the card it was clicked from.
                  Empty for an ordinary product -> nothing renders. */}
              {classificationDetailPills.map((pill) => (
                <span
                  key={pill.kind}
                  title={pill.title}
                  className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border ${pill.tone.border} bg-black/45 px-2.5 py-1 text-[0.66rem] font-black uppercase tracking-[0.1em] ${pill.tone.text}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${pill.tone.dot}`} aria-hidden="true" />
                  {pill.label}
                </span>
              ))}
              {/* SLICE 66 (owner C3): pill only when informative — a lone
                  "THC" tag is suppressed by showProfilePill. */}
              {showCannabinoids && detailCannabinoids?.profile && showProfilePillWithSlot(detailCannabinoids.profile, detailRatioSlot) ? (
                <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-white/25 bg-black/45 px-2.5 py-1 text-[0.66rem] font-black uppercase tracking-[0.1em] text-white/90">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--greenway)]" aria-hidden="true" />
                  {detailCannabinoids.profile.kind === "thc"
                    ? "THC"
                    : detailCannabinoids.profile.kind === "cbd"
                      ? "CBD"
                      : detailCannabinoids.profile.kind === "ratio"
                        ? `${detailCannabinoids.profile.label} THC:CBD`
                        : detailCannabinoids.profile.label}
                </span>
              ) : null}
              {showCannabinoids && detailCannabinoids
                ? detailCannabinoids.boxes.map((box) => (
                    <span key={box.label} className="inline-flex min-h-7 items-center bg-white px-2.5 py-1 text-[0.72rem] font-black uppercase leading-none text-black">
                      {box.label}: {box.display}
                    </span>
                  ))
                : null}
              {showCannabinoids && detailServingLine ? (
                <span data-slot="servings" className="inline-flex min-h-7 items-center bg-black/40 px-2.5 py-1 text-[0.66rem] font-bold uppercase tracking-[0.06em] text-white/80">
                  {detailServingLine}
                </span>
              ) : null}
              {showCannabinoids && detailNetWeightLine ? (
                <span className="inline-flex min-h-7 items-center bg-black/40 px-2.5 py-1 text-[0.66rem] font-bold uppercase tracking-[0.06em] text-white/80">
                  {detailNetWeightLine}
                </span>
              ) : null}
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

              {/* 7b.1: KB sensory + experiential profile (compliance-filtered).
                  Experiential descriptors are legal EXPERIENCE words (relaxing,
                  uplifting, etc.) — never medical claims (the resolver drops those). */}
              {hasSensory ? (
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {kbEffects.length > 0 ? (
                    <ChipGroup label="Experience" chips={kbEffects} accent="var(--orange)" />
                  ) : null}
                  {kbTerpenes.length > 0 ? (
                    <ChipGroup label="Terpenes" chips={kbTerpenes} accent="var(--greenway)" />
                  ) : null}
                  {kbAroma.length > 0 ? (
                    <ChipGroup label="Aroma" chips={kbAroma} accent="#7fb0d4" />
                  ) : null}
                  {kbFlavor.length > 0 ? (
                    <ChipGroup label="Flavor" chips={kbFlavor} accent="#c98fd0" />
                  ) : null}
                </div>
              ) : null}

              {kbEffects.length > 0 ? (
                <p className="mt-4 text-[0.68rem] leading-5 text-zinc-500">
                  Experiential character only — general descriptors of the experience adults
                  commonly report, not a health, medical, or therapeutic claim.
                </p>
              ) : null}
            </section>
          </article>
        </div>

        <section className="mt-11 pb-2">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[1.15rem] font-black leading-none text-white">
                {relatedScope === "category" ? "More" : "More from"}
              </p>
              {/* SLICE 47: heading follows the same brand-else-vendor label.
                  SLICE 95: when the rail had to fall back to the CATEGORY
                  (no brand/vendor siblings), the heading says the category —
                  it never advertises a brand/vendor the cards don't match. */}
              <h2 className="mt-1 text-[1.6rem] font-black leading-none text-white">
                {relatedScope === "category" || !pdpLabel ? formatWebsiteCategory(item.category) : pdpLabel}
              </h2>
            </div>
            {pdpLabelSource === "brand" && relatedScope === "brand" ? (
              <Link href={brandHref} className="shrink-0 text-[0.72rem] font-black uppercase tracking-[0.2em] text-white hover:text-[var(--greenway)]">
                View All
              </Link>
            ) : null}
          </div>

          {relatedItems.length > 0 ? (
            <div className="mt-5 -mx-4 flex snap-x items-stretch gap-4 overflow-x-auto px-4 pb-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {relatedItems.map((related) => {
                // Merch related items render the dedicated MERCH card (price
                // range, colors, no THC/CBD) — never the cannabis card.
                if (isMerchItem(related)) {
                  const def =
                    getMerchDefById(related.id) ??
                    merchProductDefs.find((candidate) => merchIdForKey(candidate.key) === related.id);
                  return def ? (
                    <MerchProductCard
                      key={related.id}
                      def={def}
                      className="w-[17.25rem] shrink-0 snap-start"
                    />
                  ) : null;
                }
                return (
                  <RelatedProductCard
                    key={related.id}
                    item={related}
                    className="w-[17.25rem] shrink-0 snap-start"
                  />
                );
              })}
            </div>
          ) : (
            <div className="mt-5 border border-white/10 bg-white/5 p-5 text-sm leading-6 text-zinc-300">No additional related products are available on the current menu.</div>
          )}
        </section>
      </section>

      <Footer />
    </main>
  );
}
