import type { CSSProperties } from "react";
import Link from "next/link";
import { SpecialsDailyDeals } from "@/components/specials/SpecialsDailyDeals";
import { posMenuPreviewItems } from "@/lib/pos/preview-menu";

type DealTone = {
  /** Glowing card border color (matches ProductCardVisual tones). */
  border: string;
  /** Strong radial-glow color. */
  glow: string;
  /** Soft radial-glow color. */
  glowSoft: string;
  /** Inner panel tint. */
  panel: string;
  /** Package mockup gradient. */
  packageGradient: string;
};

type DailyDeal = {
  day: string;
  title: string;
  titleLines?: string[];
  offer: string;
  desktopOffer: string;
  details: string[];
  href: string;
  categoryLabel: string;
  tone: DealTone;
};

// Build a product-card style background (radial color glow + charcoal panel).
function dealCardStyle(tone: DealTone): CSSProperties {
  return {
    borderColor: tone.border,
    backgroundColor: "#101010",
    backgroundImage: `radial-gradient(ellipse 54% 72% at -9% 44%, ${tone.glow} 0%, ${tone.glowSoft} 28%, rgba(20,20,20,0) 61%), radial-gradient(ellipse 48% 68% at 108% 61%, ${tone.glow} 0%, ${tone.glowSoft} 26%, rgba(20,20,20,0) 59%), linear-gradient(180deg, rgba(18,18,18,0.94), ${tone.panel} 48%, rgba(10,10,10,0.98))`,
    boxShadow: `inset 18px 0 34px -31px ${tone.glow}, inset -18px 0 34px -31px ${tone.glow}, 0 13px 28px rgba(0,0,0,0.38)`,
  };
}

const tones = {
  gold: {
    border: "#b08a2f",
    glow: "rgba(217,176,39,0.9)",
    glowSoft: "rgba(255,215,77,0.32)",
    panel: "rgba(42,34,13,0.74)",
    packageGradient: "linear-gradient(145deg,#ffd700 0%,#ffb000 50%,#ff7f00 100%)",
  },
  green: {
    border: "#5e9a45",
    glow: "rgba(126,217,87,0.9)",
    glowSoft: "rgba(160,224,127,0.32)",
    panel: "rgba(18,34,20,0.74)",
    packageGradient: "linear-gradient(145deg,#7ed957 0%,#34d399 50%,#ffd700 100%)",
  },
  blue: {
    border: "#5499b8",
    glow: "rgba(84,153,184,0.92)",
    glowSoft: "rgba(116,184,214,0.32)",
    panel: "rgba(11,26,34,0.75)",
    packageGradient: "linear-gradient(145deg,#38bdf8 0%,#7ed957 52%,#ff7f00 100%)",
  },
  platinum: {
    border: "#cfae5e",
    glow: "rgba(240,224,170,0.78)",
    glowSoft: "rgba(255,245,210,0.3)",
    panel: "rgba(36,30,18,0.76)",
    packageGradient: "linear-gradient(145deg,#f5f5f5 0%,#ffd700 50%,#ff7f00 100%)",
  },
  lime: {
    border: "#6f835f",
    glow: "rgba(126,151,95,0.92)",
    glowSoft: "rgba(160,184,127,0.32)",
    panel: "rgba(20,30,18,0.76)",
    packageGradient: "linear-gradient(145deg,#bef264 0%,#7ed957 48%,#15803d 100%)",
  },
  orange: {
    border: "#b46f34",
    glow: "rgba(217,117,39,0.9)",
    glowSoft: "rgba(255,151,53,0.32)",
    panel: "rgba(42,25,13,0.74)",
    packageGradient: "linear-gradient(145deg,#ff7f00 0%,#ffd700 52%,#ffffff 100%)",
  },
  violet: {
    border: "#9a78a9",
    glow: "rgba(160,112,190,0.9)",
    glowSoft: "rgba(209,151,234,0.3)",
    panel: "rgba(34,24,40,0.76)",
    packageGradient: "linear-gradient(145deg,#c084fc 0%,#e565c8 50%,#ffd700 100%)",
  },
} satisfies Record<string, DealTone>;

const dailyDeals: DailyDeal[] = [
  {
    day: "Monday",
    title: "Munchie Monday",
    offer: "25% off",
    desktopOffer: "25%",
    details: ["All edibles, RSO, drinks, and tinctures are 25% off."],
    href: "/menu?categories=edible-solid,edible-liquid,rso,tincture",
    categoryLabel: "edibles",
    tone: tones.gold,
  },
  {
    day: "Tuesday",
    title: "Doobie Tuesday",
    offer: "20-25% off",
    desktopOffer: "20 - 25%",
    details: ["All prerolls and blunts, including infused and multi-packs, are 20% off for 1–3 items.", "Buy 4 or more eligible items for 25% off in store."],
    href: "/menu?categories=preroll,blunt,preroll-pack,infused-preroll,infused-blunt,infused-preroll-pack",
    categoryLabel: "pre-rolls",
    tone: tones.green,
  },
  {
    day: "Wednesday",
    title: "Wax Wednesday",
    offer: "20–30% off",
    desktopOffer: "20 - 30%",
    details: ["All concentrates and vapes are 20% off.", "Get 30% off when you buy $150 or more before tax."],
    href: "/menu?categories=cartridge,disposable-cartridge,concentrate,rso",
    categoryLabel: "wax + vapes",
    tone: tones.blue,
  },
  {
    day: "Thursday",
    title: "Top Shelf Thursday",
    titleLines: ["Top Shelf", "Thursday"],
    offer: "25% off",
    desktopOffer: "25%",
    details: ["Select top shelf brands are 25% off."],
    href: "/menu?brands=Lifted,Phat%20Panda,Buddies,Clarity%20Farms,Constellation",
    categoryLabel: "top shelf",
    tone: tones.platinum,
  },
  {
    day: "Friday",
    title: "Ounce Friday",
    offer: "15–30% off",
    desktopOffer: "15 - 30%",
    details: ["Full ounces are 30% off, half ounces are 20% off, and quarter ounces are 15% off.", "Mix and match any flower from any brand."],
    href: "/menu?categories=flower,popcorn-bud,infused-flower,trim",
    categoryLabel: "flower",
    tone: tones.lime,
  },
  {
    day: "Saturday",
    title: "Super Saturday",
    offer: "15-30% off",
    desktopOffer: "15 - 30%",
    details: ["30% off any one item and 15% off everything else store wide.", "30% off applies to the lowest price item."],
    href: "/menu",
    categoryLabel: "store wide",
    tone: tones.orange,
  },
  {
    day: "Sunday",
    title: "Ice Cream Sunday",
    titleLines: ["Ice Cream", "Sunday"],
    offer: "33% off",
    desktopOffer: "33%",
    details: ["Buy 3 for the price of 2 store wide for 33% off.", "Items must be of similar type and price."],
    href: "/menu",
    categoryLabel: "store wide",
    tone: tones.violet,
  },
];

// Product-style package mockup: white image panel with a glossy "package"
// matching the look of the live ProductCardVisual image area.
function ProductArtwork({ label, title, tone }: { label: string; title: string; tone: DealTone }) {
  const initials = title
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("");

  return (
    <div className="relative flex aspect-[1.12] items-center justify-center overflow-hidden rounded-[1.05rem] bg-gradient-to-b from-white to-zinc-100 p-3 shadow-inner shadow-black/10 md:rounded-[1.35rem]">
      <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 24% 18%, ${tone.glowSoft}, transparent 40%), radial-gradient(circle at 78% 80%, ${tone.glowSoft}, transparent 38%)` }} />
      <div className="relative h-[82%] w-[62%] rounded-[1.05rem] border border-black/10 bg-zinc-950 p-2 shadow-2xl shadow-black/25">
        <div className="h-full rounded-[0.85rem] p-2 text-black" style={{ backgroundImage: tone.packageGradient }}>
          <div className="flex h-full flex-col justify-between rounded-[0.7rem] border border-black/10 bg-white/80 p-2 text-center backdrop-blur-sm">
            <p className="text-[0.46rem] font-black uppercase tracking-[0.18em] text-black/55 md:text-[0.52rem]">Greenway</p>
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-black text-sm font-black text-white shadow-lg shadow-black/25 md:h-14 md:w-14 md:text-base">
              {initials || "G"}
            </div>
            <p className="line-clamp-2 text-[0.52rem] font-black uppercase leading-tight text-black md:text-[0.58rem]">{label}</p>
          </div>
        </div>
      </div>
      <span
        className="absolute left-2 top-2 rounded-full border bg-black/70 px-2.5 py-1 text-[0.52rem] font-black uppercase tracking-[0.12em] md:text-[0.58rem]"
        style={{ borderColor: tone.border, color: tone.border }}
      >
        {label}
      </span>
    </div>
  );
}

function DailyDealCard({ deal }: { deal: DailyDeal }) {
  const { tone } = deal;
  return (
    <div className="flex h-full flex-col gap-2.5 md:gap-3">
      <article
        className="group flex h-full flex-col overflow-hidden rounded-[1.2rem] border transition hover:-translate-y-1 md:rounded-[1.65rem]"
        style={dealCardStyle(tone)}
      >
        <div className="flex flex-1 flex-col p-4 md:p-5">
          <div className="flex items-start justify-between gap-3 md:relative md:block">
            <div className="md:min-h-[5.35rem] md:pr-[5.4rem] lg:pr-[6.1rem]">
              <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] md:text-[0.68rem]" style={{ color: tone.border }}>{deal.day}</p>
              <h2 className="mt-2 text-2xl font-black uppercase leading-[0.95] tracking-tight text-white md:text-[1.62rem] lg:text-[1.72rem]">
                <span className="md:hidden">{deal.title}</span>
                <span className="hidden md:block">
                  {(deal.titleLines ?? deal.title.split(" ")).map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </span>
              </h2>
            </div>
            <span className="shrink-0 rounded-full border border-[var(--orange)]/60 bg-black/55 px-2.5 py-1.5 text-[0.56rem] font-black uppercase tracking-[0.1em] text-[var(--orange)] md:absolute md:right-0 md:top-0 md:max-w-[5.8rem] md:rounded-none md:border-0 md:bg-transparent md:p-0 md:text-right md:text-[1.35rem] md:leading-[0.9] md:tracking-[-0.04em] lg:max-w-[6.7rem] lg:text-[1.52rem]">
              <span className="md:hidden">{deal.offer}</span>
              <span className="hidden md:block">{deal.desktopOffer}</span>
            </span>
          </div>

          <div className="mt-4 md:mt-3">
            <ProductArtwork label={deal.categoryLabel} title={deal.title} tone={tone} />
          </div>

          <div className="mt-4 flex flex-1 flex-col gap-2.5 text-sm font-semibold leading-6 text-zinc-200">
            {deal.details.map((detail) => (
              <p key={detail}>{detail}</p>
            ))}
          </div>

          <Link
            href={deal.href}
            className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-[var(--orange)] px-4 py-2.5 text-[0.7rem] font-black uppercase tracking-[0.14em] text-black transition hover:bg-white md:text-xs"
            aria-label={`Shop Now for ${deal.title}`}
          >
            Shop Now
          </Link>
        </div>
      </article>
    </div>
  );
}

type SpecialsHeroContent = {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  editable?: boolean;
};

export function SpecialsContent({
  thursdayBrands,
  content,
}: {
  thursdayBrands?: string[];
  content?: SpecialsHeroContent;
} = {}) {
  // When DB-published Thursday brands are supplied, override the static Thursday
  // card's menu link so the storefront reflects the back-office promotion.
  const deals: DailyDeal[] =
    thursdayBrands && thursdayBrands.length > 0
      ? dailyDeals.map((deal) =>
          deal.day === "Thursday"
            ? {
                ...deal,
                href: `/menu?brands=${thursdayBrands
                  .map((b) => encodeURIComponent(b))
                  .join(",")}`,
              }
            : deal,
        )
      : dailyDeals;

  return (
    <section className="relative overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(255,215,0,0.13),transparent_18rem),radial-gradient(circle_at_86%_12%,rgba(255,127,0,0.14),transparent_20rem),radial-gradient(circle_at_70%_88%,rgba(126,217,87,0.12),transparent_24rem)]" />
      <div className="noise-overlay" />

      <div className="relative mx-auto max-w-[88rem] px-4 py-5 md:px-8 md:py-8">
        {/* Top hero — short + wide, matching the home / shop page proportions. */}
        <div className="relative isolate flex min-h-[8.5rem] items-center overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal)] shadow-2xl shadow-black/40 md:min-h-[10.5rem]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_88%_28%,rgba(255,127,0,0.4),transparent_42%),radial-gradient(circle_at_70%_85%,rgba(126,217,87,0.26),transparent_45%),linear-gradient(100deg,rgba(0,0,0,0.96)_0%,rgba(0,0,0,0.7)_48%,rgba(0,0,0,0.18)_100%)]" aria-hidden="true" />
          <div className="relative max-w-[80%] px-5 py-6 md:max-w-[62%] md:px-10">
            <p
              className="inline-flex rounded-full border border-white/20 bg-black/40 px-3 py-1 text-[0.6rem] font-black uppercase tracking-[0.2em] text-[var(--greenway)] backdrop-blur md:text-xs"
              {...(content?.editable
                ? { "data-gw-block": "specials.hero.eyebrow", "data-gw-editable": "true" }
                : {})}
            >
              {content?.eyebrow || "Deals every day"}
            </p>
            <h1
              className="mt-2 text-3xl font-black uppercase leading-none tracking-tight text-white md:mt-3 md:text-5xl"
              {...(content?.editable
                ? { "data-gw-block": "specials.hero.title", "data-gw-editable": "true" }
                : {})}
            >
              {content?.title || "Cannabis Specials"}
            </h1>
            <p
              className="mt-2 max-w-2xl text-xs font-semibold leading-5 text-zinc-300 md:mt-3 md:text-base"
              {...(content?.editable
                ? { "data-gw-block": "specials.hero.subtitle", "data-gw-editable": "true" }
                : {})}
            >
              {content?.subtitle ||
                "Check out our latest deals and save on premium cannabis products. New specials added regularly."}
            </p>
          </div>
        </div>

        {/* Canonical 7-day rules reference (kept as the deal explainer). */}
        <section aria-labelledby="daily-deals-title" className="mt-8 md:mt-12">
          <div className="mb-5 flex flex-col gap-2 md:mb-7 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--greenway)]">Daily discounts</p>
              <h2 id="daily-deals-title" className="mt-2 text-3xl font-black uppercase leading-none text-white md:text-5xl">Weekly Cannabis Deals</h2>
            </div>
          </div>

          <div className="grid items-stretch gap-x-3 gap-y-6 sm:grid-cols-2 md:gap-x-5 md:gap-y-8 xl:grid-cols-4">
            {deals.map((deal) => (
              <DailyDealCard key={deal.title} deal={deal} />
            ))}
          </div>
        </section>

        {/* Today's actual on-deal products — standard site-wide card, 16 cards,
            with a wide day banner above the grid. */}
        <SpecialsDailyDeals items={posMenuPreviewItems} />
      </div>
    </section>
  );
}
