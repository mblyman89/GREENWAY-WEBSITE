import Link from "next/link";
import { formatMinorCurrency } from "@/lib/leafly/format";
import {
  merchIdForKey,
  merchPriceRange,
  type MerchProductDef,
} from "@/lib/merch/merch-catalog";

type MerchProductCardProps = {
  def: MerchProductDef;
  className?: string;
};

/**
 * Storefront card for a Greenway Merch product. Shows the product photo, the
 * full price RANGE across all variants, available color swatches, and a link
 * to the merch PDP — NO THC/CBD or strain data (merch is non-cannabis).
 *
 * Extracted so it can be reused on the shop page AND the PDP "More from"
 * (related) rail, ensuring merch never renders the cannabis card layout.
 */
export function MerchProductCard({ def, className = "" }: MerchProductCardProps) {
  const range = merchPriceRange(def);
  const priceLabel =
    range.min === range.max
      ? formatMinorCurrency(range.min)
      : `${formatMinorCurrency(range.min)}–${formatMinorCurrency(range.max)}`;
  const href = `/menu/products/${merchIdForKey(def.key)}`;

  return (
    <article
      className={`group flex flex-col overflow-hidden rounded-[1.35rem] border border-white/10 bg-zinc-950 shadow-xl shadow-black/25 transition hover:-translate-y-1 hover:border-[var(--greenway)]/45 ${className}`}
    >
      <Link href={href} className="block aspect-[4/3] overflow-hidden bg-white" aria-label={`View ${def.name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={def.imageUrl} alt={def.name} className="h-full w-full object-contain transition duration-500 group-hover:scale-105" loading="lazy" />
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-[var(--greenway)]">Greenway Merch</p>
        <Link href={href} className="mt-2 text-2xl font-black text-white transition hover:text-[var(--greenway)]">
          {def.name}
        </Link>
        <p className="mt-2 text-sm leading-6 text-zinc-300">{def.blurb}</p>

        {/* Color swatches */}
        <div className="mt-3 flex items-center gap-2" aria-label="Available colors">
          {def.colors.map((color) => (
            <span
              key={color.name}
              title={color.name}
              className="h-5 w-5 rounded-full border border-white/30"
              style={{ backgroundColor: color.swatch }}
            />
          ))}
          <span className="ml-1 text-[0.66rem] font-bold uppercase tracking-[0.1em] text-zinc-500">{def.colors.length} colors</span>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          <span className="text-lg font-black text-[var(--orange)]">{priceLabel}</span>
          <Link
            href={href}
            className="rounded-full bg-[#d8e6c4] px-4 py-2 text-[0.72rem] font-black uppercase tracking-[0.1em] text-black transition hover:bg-[var(--greenway)]"
          >
            View
          </Link>
        </div>
      </div>
    </article>
  );
}
