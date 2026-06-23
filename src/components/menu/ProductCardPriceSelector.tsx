"use client";

import { useMemo, useState } from "react";
import { formatMinorCurrency } from "@/lib/leafly/format";
import type { GreenwayMenuItem } from "@/lib/leafly/types";

type ProductCardPriceSelectorProps = {
  item: GreenwayMenuItem;
  salePriceMinorUnits?: number;
};

export function ProductCardPriceSelector({ item, salePriceMinorUnits }: ProductCardPriceSelectorProps) {
  const variants = useMemo(
    () =>
      item.variants.length > 0
        ? item.variants
        : [
            {
              id: `${item.id}-default`,
              label: item.priceLabel.replace(/^\$[\d.]+\s*/, "") || "each",
              priceMinorUnits: item.priceMinorUnits,
              inventoryLevel: 0,
              medical: false,
            },
          ],
    [item.id, item.priceLabel, item.priceMinorUnits, item.variants],
  );
  const [selectedVariantId, setSelectedVariantId] = useState(variants[0]?.id ?? "");
  const selectedVariant = useMemo(
    () => variants.find((variant) => variant.id === selectedVariantId) ?? variants[0],
    [selectedVariantId, variants],
  );
  const priceMinorUnits = selectedVariant?.priceMinorUnits ?? item.priceMinorUnits;
  const hasSalePrice = typeof salePriceMinorUnits === "number" && salePriceMinorUnits > 0 && salePriceMinorUnits < priceMinorUnits;
  const displayPrice = hasSalePrice ? salePriceMinorUnits : priceMinorUnits;
  const unitLabel = selectedVariant?.label ? `/${selectedVariant.label}` : "";
  const showDropdown = variants.length > 1;

  return (
    <div className="rounded-xl border border-white/18 bg-black/42 p-2.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_10px_22px_rgba(0,0,0,0.2)] backdrop-blur-sm">
      <div className="flex min-h-[2.65rem] min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 leading-none">
        {hasSalePrice ? <span className="text-sm font-black text-zinc-400 line-through md:text-[0.95rem]">{formatMinorCurrency(priceMinorUnits)}</span> : null}
        <span className="text-[1.72rem] font-black text-[var(--orange)] md:text-[1.95rem]">{formatMinorCurrency(displayPrice)}</span>
        {unitLabel ? <span className="text-sm font-black text-white/90 md:text-base">{unitLabel}</span> : null}
      </div>

      {showDropdown ? (
        <label className="mt-2 block">
          <span className="sr-only">Choose package size for {item.name}</span>
          <select
            value={selectedVariantId}
            onChange={(event) => setSelectedVariantId(event.target.value)}
            className="h-10 w-full rounded-lg border border-white/20 bg-white px-3 text-center text-[0.78rem] font-black uppercase tracking-[0.055em] text-black shadow-inner outline-none transition focus:border-[var(--orange)] focus:ring-2 focus:ring-[var(--orange)]/45"
          >
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label} · {formatMinorCurrency(variant.priceMinorUnits)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
