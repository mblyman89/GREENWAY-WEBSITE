import Link from "next/link";
import { formatMinorCurrency } from "@/lib/leafly/format";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";

const cardFrames: Record<GreenwayMenuItem["strainType"], string> = {
  sativa: "border-[#9a7448] bg-[#3a281b]",
  indica: "border-[#5f879f] bg-[#172f3a]",
  hybrid: "border-[#587f62] bg-[#231637]",
  cbd: "border-[#9b78a8] bg-[#2f1f36]",
  unknown: "border-[#3a3a3a] bg-[#070707]",
};

const imageGlows: Record<GreenwayMenuItem["strainType"], string> = {
  sativa: "from-[#ffe0b0]/70 via-white to-[#ff6b00]/20",
  indica: "from-[#dff5ff]/75 via-white to-[#5ba7ce]/20",
  hybrid: "from-[#f0dcff]/75 via-white to-[#7f4ccb]/20",
  cbd: "from-[#ffe5ff]/75 via-white to-[#a95ad1]/20",
  unknown: "from-white via-white to-zinc-200",
};

const packageAccent: Record<GreenwayMenuItem["strainType"], string> = {
  indica: "from-[#7741d9] via-[#c63b9f] to-[#6ac15f]",
  sativa: "from-[#f33737] via-[#ffb000] to-[#7ed957]",
  hybrid: "from-[#57146f] via-[#ff8c21] to-[#251044]",
  cbd: "from-[#6b32d6] via-[#eb62c3] to-[#55d6a8]",
  unknown: "from-[#565656] via-[#cfcfcf] to-[#f7f7f7]",
};

const strainPills: Record<GreenwayMenuItem["strainType"], string> = {
  sativa: "bg-[#b47a44] text-white",
  indica: "bg-[#718fa1] text-white",
  hybrid: "bg-[#6c7864] text-white",
  cbd: "bg-[#906aa3] text-white",
  unknown: "bg-zinc-700 text-white",
};

function isCannabisItem(item: GreenwayMenuItem) {
  return item.category !== "paraphernalia" && item.strainType !== "unknown";
}

function displayStrain(item: GreenwayMenuItem) {
  if (item.category === "paraphernalia") return "Non Cannabis";
  if (item.strainType === "unknown") return formatWebsiteCategory(item.category);
  return item.strainType.charAt(0).toUpperCase() + item.strainType.slice(1);
}

function ProductImageMockup({ item }: { item: GreenwayMenuItem }) {
  const initials = item.brand
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("") || "G";
  const categoryLabel = formatWebsiteCategory(item.category);
  const accessory = item.category === "paraphernalia";

  if (accessory) {
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-sm bg-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_52%_48%,rgba(0,0,0,0.05),transparent_36%)]" aria-hidden="true" />
        <div className="relative h-[82%] w-[20%] rotate-[-7deg]">
          <div className="mx-auto h-[48%] w-[18%] rounded-full bg-zinc-400 shadow-sm" />
          <div className="mx-auto h-[30%] w-[10%] bg-zinc-300" />
          <div className="mx-auto h-[34%] w-full rounded-full bg-gradient-to-br from-[#8e3127] via-[#d48646] to-[#55231c] shadow-xl shadow-black/20" />
        </div>
      </div>
    );
  }

  return (
    <div className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-sm bg-gradient-to-br ${imageGlows[item.strainType]}`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_20%,rgba(255,255,255,0.9),transparent_25%),radial-gradient(circle_at_78%_76%,rgba(0,0,0,0.08),transparent_34%)]" aria-hidden="true" />
      <div className="relative flex h-[78%] w-[60%] flex-col overflow-hidden rounded-[1.05rem] border border-black/15 bg-zinc-950 p-2 shadow-2xl shadow-black/25">
        <div className={`flex flex-1 flex-col justify-between rounded-[0.82rem] bg-gradient-to-br ${packageAccent[item.strainType]} p-2 text-center text-black`}>
          <p className="text-[0.48rem] font-black uppercase tracking-[0.2em] text-black/65">{categoryLabel}</p>
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-black text-sm font-black uppercase text-white shadow-lg shadow-black/25 md:h-14 md:w-14">
            {initials}
          </div>
          <p className="line-clamp-2 text-[0.6rem] font-black uppercase leading-tight text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.55)]">{displayStrain(item)}</p>
        </div>
      </div>
    </div>
  );
}

type ProductCardVisualProps = {
  item: GreenwayMenuItem;
  salePriceMinorUnits?: number;
  ctaLabel?: string;
  className?: string;
};

export function ProductCardVisual({ item, salePriceMinorUnits, ctaLabel = "ADD TO CART", className = "" }: ProductCardVisualProps) {
  const firstVariant = item.variants[0];
  const priceMinorUnits = firstVariant?.priceMinorUnits ?? item.priceMinorUnits;
  const hasSalePrice = typeof salePriceMinorUnits === "number" && salePriceMinorUnits > 0 && salePriceMinorUnits < priceMinorUnits;
  const displayPrice = hasSalePrice ? salePriceMinorUnits : priceMinorUnits;
  const unitLabel = firstVariant?.label ? `/${firstVariant.label}` : "";
  const showCannabinoids = isCannabisItem(item);

  return (
    <article className={`group flex h-full min-h-[25rem] flex-col overflow-hidden rounded-[1.1rem] border-[3px] p-2.5 shadow-xl shadow-black/30 transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_45px_rgba(0,0,0,0.45)] ${cardFrames[item.strainType]} ${className}`}>
      <p className="truncate px-1 pb-2 pt-0.5 text-center text-lg font-black leading-tight text-white md:text-xl">{item.brand}</p>

      <Link href={`/menu/products/${item.id}`} className="block" aria-label={`View ${item.name}`}>
        <div className="aspect-square rounded-sm bg-white p-0.5 shadow-inner shadow-black/20">
          <ProductImageMockup item={item} />
        </div>
      </Link>

      <div className="flex flex-1 flex-col px-1.5 pb-1 pt-3">
        <Link href={`/menu/products/${item.id}`} className="line-clamp-2 min-h-[2.65rem] text-base font-black leading-tight text-white transition group-hover:text-[var(--gold)] md:text-lg">
          {item.name}
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`rounded px-3 py-1.5 text-sm font-black leading-none ${strainPills[item.strainType]}`}>{displayStrain(item)}</span>
          {showCannabinoids ? (
            <>
              <span className="rounded-sm bg-white px-2.5 py-1.5 text-[0.72rem] font-black uppercase leading-none text-zinc-900">THC: {item.thc ?? "--"}</span>
              <span className="rounded-sm bg-white px-2.5 py-1.5 text-[0.72rem] font-black uppercase leading-none text-zinc-900">CBD: {item.cbd ?? "--"}</span>
            </>
          ) : null}
        </div>

        <div className={`mt-auto pt-4 ${showCannabinoids ? "" : "flex-1"}`}>
          <div className="rounded-sm border border-white/10 bg-black/15 px-2.5 py-2">
            {hasSalePrice ? <p className="text-sm font-bold leading-none text-zinc-400 line-through">{formatMinorCurrency(priceMinorUnits)}</p> : null}
            <p className="mt-1 text-2xl font-black leading-none text-[var(--orange)]">
              {formatMinorCurrency(displayPrice)} <span className="align-baseline text-sm font-bold text-white/85">{unitLabel}</span>
            </p>
          </div>

          <Link
            href={`/menu/products/${item.id}`}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-sm bg-white px-4 text-sm font-black uppercase tracking-[0.08em] text-black transition hover:bg-[var(--orange)]"
            aria-label={`${ctaLabel} ${item.name}`}
          >
            <span aria-hidden="true">🛒</span>
            {ctaLabel}
          </Link>
        </div>
      </div>
    </article>
  );
}
