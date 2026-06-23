import type { CSSProperties } from "react";
import Link from "next/link";
import { formatMinorCurrency } from "@/lib/leafly/format";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";

type CardTone = {
  border: string;
  glow: string;
  glowSoft: string;
  panel: string;
  pill: string;
  packageGradient: string;
};

const cardTones: Record<GreenwayMenuItem["strainType"], CardTone> = {
  sativa: {
    border: "#b46f34",
    glow: "rgba(217,117,39,0.92)",
    glowSoft: "rgba(255,151,53,0.34)",
    panel: "rgba(42,25,13,0.72)",
    pill: "#a76b3d",
    packageGradient: "linear-gradient(145deg,#f0422f 0%,#ff9d18 48%,#75c85a 100%)",
  },
  indica: {
    border: "#5499b8",
    glow: "rgba(84,153,184,0.95)",
    glowSoft: "rgba(116,184,214,0.34)",
    panel: "rgba(11,26,34,0.75)",
    pill: "#6f91a4",
    packageGradient: "linear-gradient(145deg,#6d39cf 0%,#c33f9d 50%,#6ec563 100%)",
  },
  hybrid: {
    border: "#6f835f",
    glow: "rgba(126,151,95,0.95)",
    glowSoft: "rgba(160,184,127,0.34)",
    panel: "rgba(27,22,31,0.76)",
    pill: "#728068",
    packageGradient: "linear-gradient(145deg,#58156e 0%,#a04ea5 42%,#f18b26 100%)",
  },
  cbd: {
    border: "#9a78a9",
    glow: "rgba(160,112,190,0.92)",
    glowSoft: "rgba(209,151,234,0.32)",
    panel: "rgba(34,24,40,0.76)",
    pill: "#906aa3",
    packageGradient: "linear-gradient(145deg,#6635d2 0%,#e565c8 48%,#54d4aa 100%)",
  },
  unknown: {
    border: "#f1f1f1",
    glow: "rgba(255,255,255,0.72)",
    glowSoft: "rgba(255,255,255,0.24)",
    panel: "rgba(14,14,14,0.82)",
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

function cardStyle(tone: CardTone): CSSProperties {
  return {
    borderColor: tone.border,
    backgroundColor: "#101010",
    backgroundImage: `radial-gradient(ellipse 54% 72% at -9% 44%, ${tone.glow} 0%, ${tone.glowSoft} 28%, rgba(20,20,20,0) 61%), radial-gradient(ellipse 48% 68% at 108% 61%, ${tone.glow} 0%, ${tone.glowSoft} 26%, rgba(20,20,20,0) 59%), linear-gradient(180deg, rgba(18,18,18,0.94), ${tone.panel} 48%, rgba(10,10,10,0.98))`,
    boxShadow: `inset 18px 0 34px -31px ${tone.glow}, inset -18px 0 34px -31px ${tone.glow}, 0 13px 28px rgba(0,0,0,0.38)`,
  };
}

function isNonCannabisItem(item: GreenwayMenuItem) {
  return item.category === "paraphernalia";
}

function isCannabisItem(item: GreenwayMenuItem) {
  return !isNonCannabisItem(item);
}

function displayStrain(item: GreenwayMenuItem) {
  if (isNonCannabisItem(item)) return "Non Cannabis";
  // For items where strain type is still unknown (edibles, topicals, paraphernalia),
  // show the category label since strain type doesn't apply to those products
  if (item.strainType === "unknown") return formatWebsiteCategory(item.category);
  return item.strainType.charAt(0).toUpperCase() + item.strainType.slice(1);
}

function cardToneForItem(item: GreenwayMenuItem) {
  if (isNonCannabisItem(item)) return cardTones.unknown;
  if (item.strainType === "unknown") return cardTones.hybrid;
  return cardTones[item.strainType];
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

function ProductImageMockup({ item, tone }: { item: GreenwayMenuItem; tone: CardTone }) {
  const initials = brandInitials(item.brand);
  const nonCannabis = isNonCannabisItem(item);
  const label = categoryLabel(item).toUpperCase();

  if (nonCannabis) {
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_52%_45%,rgba(0,0,0,0.055),transparent_34%),linear-gradient(180deg,rgba(255,255,255,1),rgba(245,245,245,1))]" aria-hidden="true" />
        <div className="relative h-[83%] w-[54%] rotate-[-8deg]">
          <div className="absolute left-[45%] top-[3%] h-[42%] w-[10%] rounded-full bg-zinc-400 shadow-[0_2px_8px_rgba(0,0,0,0.2)]" />
          <div className="absolute left-[41%] top-[34%] h-[25%] w-[18%] rounded-full bg-gradient-to-b from-zinc-300 to-zinc-600 shadow-md" />
          <div className="absolute bottom-[8%] left-[30%] h-[43%] w-[40%] rounded-full bg-gradient-to-br from-[#722118] via-[#d57d38] to-[#3c160f] shadow-2xl shadow-black/25" />
          <div className="absolute bottom-[11%] left-[35%] h-[36%] w-[30%] rounded-full bg-[radial-gradient(circle_at_30%_28%,rgba(255,219,120,0.72),transparent_18%),radial-gradient(circle_at_70%_70%,rgba(62,12,8,0.75),transparent_35%)]" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-white">
      <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 28% 18%, rgba(255,255,255,0.95), transparent 20%), radial-gradient(circle at 72% 72%, ${tone.glowSoft}, transparent 42%), linear-gradient(145deg, #ffffff 0%, #f8f8f8 62%, rgba(235,235,235,1) 100%)` }} aria-hidden="true" />
      <div className="relative flex h-[86%] w-[67%] flex-col items-center justify-between overflow-hidden rounded-[0.95rem] border border-black/15 bg-[#111] p-2.5 shadow-[0_19px_35px_rgba(0,0,0,0.28)]">
        <div className="absolute inset-0 opacity-95" style={{ background: tone.packageGradient }} aria-hidden="true" />
        <div className="absolute inset-x-0 top-0 h-10 bg-white/12" aria-hidden="true" />
        <div className="relative z-10 w-full text-center text-[0.48rem] font-black uppercase tracking-[0.21em] text-black/62">{label}</div>
        <div className="relative z-10 grid h-16 w-16 place-items-center rounded-full bg-black text-base font-black uppercase text-white shadow-xl shadow-black/30 md:h-[4.55rem] md:w-[4.55rem]">
          {initials}
        </div>
        <div className="relative z-10 w-full rounded-md bg-black/16 px-1.5 py-1 text-center text-[0.58rem] font-black uppercase leading-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]">
          {displayStrain(item)} Formula
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
  const tone = cardToneForItem(item);

  return (
    <article
      className={`group relative flex h-full min-h-[29.25rem] min-w-0 flex-col justify-between overflow-hidden border p-4 text-white transition duration-300 hover:border-white/70 hover:shadow-[0_18px_44px_rgba(0,0,0,0.55)] ${className}`}
      style={cardStyle(tone)}
    >
      <span className="pointer-events-none absolute -left-px top-10 h-[42%] w-px opacity-90 blur-[1px]" style={{ background: tone.glow }} aria-hidden="true" />
      <span className="pointer-events-none absolute -right-px top-[31%] h-[46%] w-px opacity-90 blur-[1px]" style={{ background: tone.glow }} aria-hidden="true" />
      <span className="pointer-events-none absolute inset-x-7 -bottom-px h-px opacity-70 blur-[1px]" style={{ background: tone.glow }} aria-hidden="true" />

      <div>
        <p className="truncate pb-3 text-center text-lg font-black leading-none text-white md:text-xl">{item.brand}</p>

        <Link href={`/menu/products/${item.id}`} className="block" aria-label={`View ${item.name}`}>
          <div className="h-[14.15rem] bg-white p-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)] md:h-[14.65rem]">
            <ProductImageMockup item={item} tone={tone} />
          </div>
        </Link>

        <Link
          href={`/menu/products/${item.id}`}
          className="mt-4 line-clamp-2 block min-h-[2.45rem] text-[1.08rem] font-black leading-[1.12] text-white transition group-hover:text-white md:text-[1.18rem]"
        >
          {item.name}
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className="inline-flex min-h-8 items-center rounded-[2px] px-3 py-1.5 text-sm font-black leading-none text-white"
            style={{ backgroundColor: tone.pill, color: isNonCannabisItem(item) ? "#111" : "#fff" }}
          >
            {displayStrain(item)}
          </span>
          {showCannabinoids ? (
            <>
              <span className="inline-flex min-h-8 items-center rounded-[2px] bg-white px-2.5 py-1.5 text-[0.72rem] font-black uppercase leading-none text-black">THC: {item.thc ?? "--"}</span>
              <span className="inline-flex min-h-8 items-center rounded-[2px] bg-white px-2.5 py-1.5 text-[0.72rem] font-black uppercase leading-none text-black">CBD: {item.cbd ?? "--"}</span>
            </>
          ) : null}
        </div>
      </div>

      <div className="pt-4">
        <div className="flex min-h-[2.85rem] min-w-0 flex-wrap items-end gap-x-2 gap-y-1 leading-none">
          {hasSalePrice ? <span className="pb-1 text-sm font-black text-zinc-400 line-through md:text-[0.95rem]">{formatMinorCurrency(priceMinorUnits)}</span> : null}
          <span className="text-[1.72rem] font-black text-[var(--orange)] md:text-[1.95rem]">{formatMinorCurrency(displayPrice)}</span>
          {unitLabel ? <span className="pb-1.5 text-sm font-black text-white/90 md:text-base">{unitLabel}</span> : null}
        </div>

        <Link
          href={`/menu/products/${item.id}`}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 bg-white px-4 text-sm font-black uppercase tracking-[0.08em] text-black transition hover:bg-[var(--orange)]"
          aria-label={`${ctaLabel} ${item.name}`}
        >
          <span className="text-base" aria-hidden="true">🛒</span>
          {ctaLabel}
        </Link>
      </div>
    </article>
  );
}
