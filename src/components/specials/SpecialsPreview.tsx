import Link from "next/link";
import { SpecialsDailyDeals } from "@/components/specials/SpecialsDailyDeals";
import { posMenuPreviewItems } from "@/lib/pos/preview-menu";

type DailyDeal = {
  day: string;
  title: string;
  titleLines?: string[];
  offer: string;
  desktopOffer: string;
  details: string[];
  href: string;
  categoryLabel: string;
  accent: string;
  glow: string;
};

const dailyDeals: DailyDeal[] = [
  {
    day: "Monday",
    title: "Munchie Monday",
    offer: "25% off",
    desktopOffer: "25%",
    details: ["All edibles, RSO, drinks, and tinctures are 25% off."],
    href: "/menu?categories=edible-solid,edible-liquid,rso,tincture",
    categoryLabel: "edibles",
    accent: "from-[var(--gold)] via-[#ffb000] to-[var(--orange)]",
    glow: "rgba(255,215,0,0.28)",
  },
  {
    day: "Tuesday",
    title: "Doobie Tuesday",
    offer: "20-25% off",
    desktopOffer: "20 - 25%",
    details: ["All prerolls and blunts, including infused and multi-packs, are 20% off for 1–3 items.", "Buy 4 or more eligible items for 25% off in store."],
    href: "/menu?categories=preroll,blunt,preroll-pack,infused-preroll,infused-blunt,infused-preroll-pack",
    categoryLabel: "pre-rolls",
    accent: "from-[var(--greenway)] via-emerald-300 to-[var(--gold)]",
    glow: "rgba(126,217,87,0.26)",
  },
  {
    day: "Wednesday",
    title: "Wax Wednesday",
    offer: "20–30% off",
    desktopOffer: "20 - 30%",
    details: ["All concentrates and vapes are 20% off.", "Get 30% off when you buy $150 or more before tax."],
    href: "/menu?categories=cartridge,disposable-cartridge,concentrate,rso",
    categoryLabel: "wax + vapes",
    accent: "from-sky-300 via-[var(--greenway)] to-[var(--orange)]",
    glow: "rgba(56,189,248,0.22)",
  },
  {
    day: "Thursday",
    title: "Top Shelf Thursday",
    titleLines: ["Top Shelf", "Thursday"],
    offer: "25% off",
    desktopOffer: "25%",
    details: ["Select top shelf products and brands are 25% off."],
    href: "/menu?categories=flower,infused-flower,concentrate,cartridge,disposable-cartridge",
    categoryLabel: "top shelf",
    accent: "from-zinc-100 via-[var(--gold)] to-[var(--orange)]",
    glow: "rgba(255,255,255,0.2)",
  },
  {
    day: "Friday",
    title: "Ounce Friday",
    offer: "15–30% off",
    desktopOffer: "15 - 30%",
    details: ["Full ounces are 30% off, half ounces are 20% off, and quarter ounces are 15% off.", "Mix and match any flower from any brand."],
    href: "/menu?categories=flower,popcorn-bud,infused-flower,trim",
    categoryLabel: "flower",
    accent: "from-lime-200 via-[var(--greenway)] to-emerald-700",
    glow: "rgba(34,197,94,0.24)",
  },
  {
    day: "Saturday",
    title: "Super Saturday",
    offer: "15-30% off",
    desktopOffer: "15 - 30%",
    details: ["30% off any one item and 15% off everything else store wide.", "30% off applies to the lowest price item."],
    href: "/menu",
    categoryLabel: "store wide",
    accent: "from-[var(--orange)] via-[var(--gold)] to-white",
    glow: "rgba(255,127,0,0.26)",
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
    accent: "from-purple-300 via-fuchsia-300 to-[var(--gold)]",
    glow: "rgba(216,180,254,0.24)",
  },
];

function ProductArtwork({ label, title, accent, glow }: { label: string; title: string; accent: string; glow: string }) {
  const initials = title
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("");

  return (
    <div className="relative flex aspect-[1.12] items-center justify-center overflow-hidden rounded-[1.05rem] bg-white p-3 shadow-inner shadow-black/10 md:rounded-[1.35rem]">
      <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 24% 18%, ${glow}, transparent 36%), radial-gradient(circle at 78% 78%, rgba(255,127,0,0.18), transparent 34%)` }} />
      <div className="relative h-[82%] w-[62%] rounded-[1.05rem] border border-black/10 bg-zinc-950 p-2 shadow-2xl shadow-black/25">
        <div className={`h-full rounded-[0.85rem] bg-gradient-to-br ${accent} p-2 text-black`}>
          <div className="flex h-full flex-col justify-between rounded-[0.7rem] border border-black/10 bg-white/78 p-2 text-center backdrop-blur-sm">
            <p className="text-[0.46rem] font-black uppercase tracking-[0.18em] text-black/55 md:text-[0.52rem]">Greenway</p>
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-black text-sm font-black text-white shadow-lg shadow-black/25 md:h-14 md:w-14 md:text-base">
              {initials || "G"}
            </div>
            <p className="line-clamp-2 text-[0.52rem] font-black uppercase leading-tight text-black md:text-[0.58rem]">{label}</p>
          </div>
        </div>
      </div>
      <span className="absolute left-2 top-2 rounded-full bg-black px-2 py-1 text-[0.52rem] font-black uppercase tracking-[0.12em] text-white md:text-[0.58rem]">
        {label}
      </span>
    </div>
  );
}

function DailyDealCard({ deal }: { deal: DailyDeal }) {
  return (
    <div className="flex h-full flex-col gap-2.5 md:gap-3">
      <article className="group flex h-full flex-col overflow-hidden rounded-[1.2rem] border border-white/10 bg-zinc-950 shadow-xl shadow-black/30 transition hover:-translate-y-1 hover:border-white/25 md:rounded-[1.65rem]">
        <div className={`h-2.5 bg-gradient-to-r ${deal.accent}`} />
        <div className="flex flex-1 flex-col p-4 md:p-5">
          <div className="flex items-start justify-between gap-3 md:relative md:block">
            <div className="md:min-h-[5.35rem] md:pr-[5.4rem] lg:pr-[6.1rem]">
              <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-[var(--gold)] md:text-[0.68rem]">{deal.day}</p>
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
            <span className="shrink-0 rounded-full bg-white px-2.5 py-1.5 text-[0.56rem] font-black uppercase tracking-[0.1em] text-black md:absolute md:right-0 md:top-0 md:max-w-[5.8rem] md:rounded-none md:bg-transparent md:p-0 md:text-right md:text-[1.35rem] md:leading-[0.9] md:tracking-[-0.04em] md:text-[var(--gold)] lg:max-w-[6.7rem] lg:text-[1.52rem]">
              <span className="md:hidden">{deal.offer}</span>
              <span className="hidden md:block">{deal.desktopOffer}</span>
            </span>
          </div>

          <div className="mt-4 md:mt-3">
            <ProductArtwork label={deal.categoryLabel} title={deal.title} accent={deal.accent} glow={deal.glow} />
          </div>

          <div className="mt-4 flex flex-1 flex-col gap-2.5 text-sm font-semibold leading-6 text-zinc-300">
            {deal.details.map((detail) => (
              <p key={detail}>{detail}</p>
            ))}
          </div>
        </div>
      </article>
      <Link
        href={deal.href}
        className="self-start text-[0.72rem] font-black uppercase tracking-[0.14em] text-zinc-300 underline-offset-4 transition hover:text-[var(--gold)] hover:underline md:text-xs"
        aria-label={`Shop Now for ${deal.title}`}
      >
        Shop Now
      </Link>
    </div>
  );
}

export function SpecialsPreview() {
  return (
    <section className="relative overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(255,215,0,0.13),transparent_18rem),radial-gradient(circle_at_86%_12%,rgba(255,127,0,0.14),transparent_20rem),radial-gradient(circle_at_70%_88%,rgba(126,217,87,0.12),transparent_24rem)]" />
      <div className="noise-overlay" />

      <div className="relative mx-auto max-w-[88rem] px-4 py-5 md:px-8 md:py-8">
        {/* Top hero — short + wide, matching the home / shop page proportions. */}
        <div className="relative isolate flex min-h-[8.5rem] items-center overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal)] shadow-2xl shadow-black/40 md:min-h-[10.5rem]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_88%_28%,rgba(255,127,0,0.4),transparent_42%),radial-gradient(circle_at_70%_85%,rgba(126,217,87,0.26),transparent_45%),linear-gradient(100deg,rgba(0,0,0,0.96)_0%,rgba(0,0,0,0.7)_48%,rgba(0,0,0,0.18)_100%)]" aria-hidden="true" />
          <div className="relative max-w-[80%] px-5 py-6 md:max-w-[62%] md:px-10">
            <p className="inline-flex rounded-full border border-white/20 bg-black/40 px-3 py-1 text-[0.6rem] font-black uppercase tracking-[0.2em] text-[var(--greenway)] backdrop-blur md:text-xs">
              Deals every day
            </p>
            <h1 className="mt-2 text-3xl font-black uppercase leading-none tracking-tight text-white md:mt-3 md:text-5xl">
              Cannabis Specials
            </h1>
            <p className="mt-2 max-w-2xl text-xs font-semibold leading-5 text-zinc-300 md:mt-3 md:text-base">
              Check out our latest deals and save on premium cannabis products. New specials added regularly.
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
            {dailyDeals.map((deal) => (
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
