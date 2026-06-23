import Link from "next/link";
import { mockMenuItems } from "@/lib/leafly/mock-menu";
import { formatMinorCurrency } from "@/lib/leafly/format";
import type { GreenwayMenuItem } from "@/lib/leafly/types";

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
    href: "/menu?category=edible-solid",
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
    href: "/menu?special=doobie-tuesday",
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
    href: "/menu?special=wax-wednesday",
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
    href: "/menu?special=top-shelf-thursday",
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
    href: "/menu?category=flower",
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
    href: "/menu?special=super-saturday",
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
    href: "/menu?special=ice-cream-sunday",
    categoryLabel: "store wide",
    accent: "from-purple-300 via-fuchsia-300 to-[var(--gold)]",
    glow: "rgba(216,180,254,0.24)",
  },
];

const clearanceItems = mockMenuItems.slice(0, 8);

const strainStyles: Record<GreenwayMenuItem["strainType"], string> = {
  indica: "border-blue-400/80 text-blue-200",
  sativa: "border-green-400/80 text-green-200",
  hybrid: "border-orange-400/80 text-orange-200",
  cbd: "border-purple-300/80 text-purple-100",
  unknown: "border-zinc-500 text-zinc-200",
};

const packageAccent: Record<GreenwayMenuItem["strainType"], string> = {
  indica: "from-blue-500 via-blue-300 to-white",
  sativa: "from-emerald-500 via-lime-300 to-white",
  hybrid: "from-[var(--orange)] via-[var(--gold)] to-white",
  cbd: "from-purple-500 via-fuchsia-300 to-white",
  unknown: "from-zinc-500 via-zinc-200 to-white",
};

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

function ProductMockup({ item }: { item: GreenwayMenuItem }) {
  const initials = item.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("");

  return (
    <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-white p-3 shadow-inner shadow-black/10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(126,217,87,0.22),transparent_32%),radial-gradient(circle_at_76%_82%,rgba(255,127,0,0.16),transparent_34%)]" aria-hidden="true" />
      <div className="relative h-[78%] w-[64%] rounded-[1.1rem] border border-black/10 bg-zinc-950 p-2 shadow-2xl shadow-black/25">
        <div className={`h-full rounded-[0.9rem] bg-gradient-to-br ${packageAccent[item.strainType]} p-2 text-black`}>
          <div className="flex h-full flex-col justify-between rounded-[0.7rem] border border-black/10 bg-white/75 p-2 text-center backdrop-blur-sm">
            <p className="text-[0.48rem] font-black uppercase tracking-[0.18em] text-black/55">Greenway</p>
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-black text-sm font-black text-white shadow-lg shadow-black/25">
              {initials || "G"}
            </div>
            <p className="line-clamp-2 text-[0.52rem] font-black uppercase leading-tight text-black">{item.category}</p>
          </div>
        </div>
      </div>
      <span className="absolute left-2 top-2 rounded-full bg-black px-2 py-1 text-[0.55rem] font-black uppercase tracking-[0.12em] text-white">
        {item.category}
      </span>
      <span className="absolute right-2 top-2 rounded-full bg-[var(--gold)] px-2 py-1 text-[0.55rem] font-black uppercase tracking-[0.12em] text-black">
        50% off
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

function displayBrand(brand: string) {
  return brand.replace(/\s*Preview\b/g, "").trim();
}

function ClearanceProductCard({ item }: { item: GreenwayMenuItem }) {
  const firstVariant = item.variants[0];
  const visibleVariants = item.variants.slice(0, 2);
  const originalPrice = firstVariant?.priceMinorUnits ?? item.priceMinorUnits;
  const salePrice = Math.round(originalPrice * 0.5);
  const brandName = displayBrand(item.brand);

  return (
    <Link href={`/menu/products/${item.id}`} className={`group block overflow-hidden rounded-[1.35rem] border-2 bg-[#111] shadow-xl shadow-black/25 transition duration-300 hover:-translate-y-1 hover:border-white ${strainStyles[item.strainType]}`}>
      <article className="flex h-full flex-col">
        <div className="p-2.5 pb-0">
          <ProductMockup item={item} />
        </div>

        <div className="flex flex-1 flex-col p-3.5 md:p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[0.68rem] font-black uppercase tracking-[0.16em] text-zinc-400">{brandName}</p>
            <span className="rounded-full border border-current px-2 py-1 text-[0.58rem] font-black uppercase tracking-[0.1em]">{item.strainType}</span>
          </div>

          <h3 className="mt-2 line-clamp-2 min-h-[2.6rem] text-base font-black leading-tight text-white transition group-hover:text-[var(--gold)]">{item.name}</h3>

          <div className="mt-3 grid grid-cols-2 gap-1.5 text-[0.58rem] font-black uppercase tracking-[0.1em] text-zinc-200">
            <span className="rounded-full bg-white/8 px-2.5 py-1.5">THC {item.thc ?? "unknown"}</span>
            <span className="rounded-full bg-white/8 px-2.5 py-1.5">CBD {item.cbd ?? "unknown"}</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Variant options">
            {visibleVariants.map((variant, index) => (
              <span key={variant.id} className={`rounded-full border px-2.5 py-1 text-[0.58rem] font-black uppercase tracking-[0.1em] ${index === 0 ? "border-white bg-white text-black" : "border-white/15 bg-white/5 text-zinc-300"}`}>
                {variant.label}
              </span>
            ))}
            {item.variants.length > visibleVariants.length ? (
              <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[0.58rem] font-black uppercase tracking-[0.1em] text-zinc-400">
                +{item.variants.length - visibleVariants.length}
              </span>
            ) : null}
          </div>

          <div className="mt-auto flex items-end justify-between gap-3 pt-4">
            <div>
              <p className="text-[0.58rem] font-black uppercase tracking-[0.14em] text-zinc-500">{firstVariant?.label ?? "variant"}</p>
              <p className="mt-1 text-lg font-black leading-none text-[var(--orange)]">{formatMinorCurrency(salePrice)}</p>
              <p className="mt-1 text-xs font-bold text-zinc-500 line-through">{formatMinorCurrency(originalPrice)}</p>
            </div>
            <span className="rounded-full bg-white px-3.5 py-2.5 text-[0.62rem] font-black uppercase tracking-[0.12em] text-black transition group-hover:bg-[var(--orange)]">
              View
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}

export function SpecialsPreview() {
  return (
    <section className="relative overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(255,215,0,0.13),transparent_18rem),radial-gradient(circle_at_86%_12%,rgba(255,127,0,0.14),transparent_20rem),radial-gradient(circle_at_70%_88%,rgba(126,217,87,0.12),transparent_24rem)]" />
      <div className="noise-overlay" />

      <div className="relative mx-auto max-w-7xl px-4 py-5 md:px-8 md:py-14">
        <div className="relative min-h-[14rem] overflow-hidden rounded-[1.35rem] border border-white/10 bg-[var(--charcoal)] shadow-2xl shadow-black/40 md:min-h-[20rem] md:rounded-[2rem]">
          <div className="absolute inset-0 bg-[linear-gradient(20deg,rgba(0,0,0,0.9)_0%,rgba(0,0,0,0.68)_38%,rgba(0,0,0,0.16)_100%)]" />
          <div className="absolute inset-y-0 right-0 w-[54%] bg-[radial-gradient(circle_at_62%_34%,rgba(126,217,87,0.24),transparent_7rem),radial-gradient(circle_at_72%_72%,rgba(255,215,0,0.18),transparent_8rem)]" aria-hidden="true">
            <div className="absolute bottom-7 right-5 h-24 w-36 rotate-[8deg] rounded-2xl border border-white/15 bg-black/50 shadow-2xl shadow-black/40 md:bottom-10 md:right-12 md:h-40 md:w-60 md:rounded-[1.7rem]">
              <div className="absolute inset-x-4 top-4 h-8 rounded-lg bg-[var(--gold)]/85 md:h-12" />
              <div className="absolute bottom-4 left-4 right-4 h-10 rounded-lg border border-white/15 bg-white/10 md:h-16" />
            </div>
          </div>
          <div className="relative flex min-h-[14rem] max-w-full flex-col justify-end px-5 pb-7 pt-16 text-left md:min-h-[20rem] md:max-w-[72%] md:px-10 md:pb-10 md:pt-20 lg:max-w-[64%]">
            <h1 className="whitespace-nowrap text-[1.55rem] font-black uppercase leading-none tracking-tight text-white md:text-5xl lg:text-[3.45rem]">
              Cannabis Specials
            </h1>
            <p className="mt-2 max-w-3xl text-[0.78rem] font-medium leading-5 text-zinc-400 md:mt-4 md:text-base md:leading-7 md:text-zinc-200">
              <span className="md:hidden">
                <span className="block whitespace-nowrap">Check out our latest deals and save on premium</span>
                <span className="block whitespace-nowrap">cannabis products. New specials added</span>
                <span className="block">regularly.</span>
              </span>
              <span className="hidden md:inline">
                Check out our latest deals and save on premium cannabis products.
                <br />
                New specials added regularly.
              </span>
            </p>
          </div>
        </div>

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

        <section aria-labelledby="clearance-title" className="mt-12 border-t border-white/10 pt-9 md:mt-16 md:pt-12">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--greenway)]">Limited-time deals</p>
              <h2 id="clearance-title" className="mt-2 text-3xl font-black uppercase leading-none text-white md:text-5xl">50% Off Clearance</h2>
            </div>
            <Link
              href="/menu?special=clearance-50"
              className="w-fit rounded-full bg-[var(--orange)] px-6 py-3 text-xs font-black uppercase tracking-[0.16em] text-black transition hover:bg-white"
            >
              Shop All
            </Link>
          </div>

          <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {clearanceItems.map((item) => (
              <ClearanceProductCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
