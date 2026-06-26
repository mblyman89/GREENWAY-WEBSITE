"use client";

import { useMemo, useState } from "react";
import { formatMinorCurrency } from "@/lib/leafly/format";
import type { GreenwayMenuItem, GreenwayMenuVariant } from "@/lib/leafly/types";

type ProductCardPriceSelectorProps = {
  item: GreenwayMenuItem;
  salePriceMinorUnits?: number;
};

type PriceLineProps = {
  variant: GreenwayMenuVariant;
  itemPriceMinorUnits: number;
  salePriceMinorUnits?: number;
};

function priceParts(variant: GreenwayMenuVariant, itemPriceMinorUnits: number, salePriceMinorUnits?: number) {
  const priceMinorUnits = variant.priceMinorUnits;
  const saleRatio = typeof salePriceMinorUnits === "number" && salePriceMinorUnits > 0 && salePriceMinorUnits < itemPriceMinorUnits ? salePriceMinorUnits / itemPriceMinorUnits : undefined;
  const variantSalePrice = saleRatio ? Math.round(priceMinorUnits * saleRatio) : undefined;
  const hasSalePrice = typeof variantSalePrice === "number" && variantSalePrice > 0 && variantSalePrice < priceMinorUnits;
  return {
    regularPrice: priceMinorUnits,
    displayPrice: hasSalePrice ? variantSalePrice : priceMinorUnits,
    hasSalePrice,
    unitLabel: variant.label ? `/${variant.label}` : "",
  };
}

function PriceLine({ variant, itemPriceMinorUnits, salePriceMinorUnits }: PriceLineProps) {
  const { regularPrice, displayPrice, hasSalePrice, unitLabel } = priceParts(variant, itemPriceMinorUnits, salePriceMinorUnits);

  // No active sale: single centered price + unit.
  if (!hasSalePrice) {
    return (
      <span className="flex min-h-[3.35rem] w-full items-center justify-center gap-1 px-2.5 text-center leading-none md:px-3">
        <span className="text-[1.18rem] font-black text-[var(--orange)] md:text-[1.72rem]">{formatMinorCurrency(displayPrice)}</span>
        {unitLabel ? <span className="text-[0.78rem] font-black text-white/95 md:text-base">{unitLabel}</span> : null}
      </span>
    );
  }

  // Active sale:
  //  - MOBILE  -> struck "before" price stacked ABOVE the discounted price/unit
  //  - DESKTOP -> struck "before" price to the LEFT, discounted price/unit to the RIGHT
  return (
    <span className="flex min-h-[3.35rem] w-full flex-col items-center justify-center gap-0.5 px-2.5 text-center leading-none md:flex-row md:items-baseline md:gap-2 md:px-3">
      {/* "Before" (regular) price — struck through */}
      <span className="text-[0.72rem] font-black text-zinc-400 line-through md:text-[1.05rem]">
        {formatMinorCurrency(regularPrice)}
      </span>
      {/* Discounted price-per-unit */}
      <span className="flex items-baseline justify-center gap-1">
        <span className="text-[1.18rem] font-black text-[var(--orange)] md:text-[1.72rem]">{formatMinorCurrency(displayPrice)}</span>
        {unitLabel ? <span className="text-[0.78rem] font-black text-white/95 md:text-base">{unitLabel}</span> : null}
      </span>
    </span>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 7.5 10 12.5 15 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
  const [isOpen, setIsOpen] = useState(false);
  const selectedVariant = useMemo(
    () => variants.find((variant) => variant.id === selectedVariantId) ?? variants[0],
    [selectedVariantId, variants],
  );
  const showDropdown = variants.length > 1;

  if (!selectedVariant) return null;

  return (
    <div className="relative text-center">
      {showDropdown && isOpen ? (
        <div className="absolute inset-x-0 bottom-[calc(100%-1px)] z-30 overflow-hidden rounded-t-[0.95rem] border border-[#b9864f]/75 border-b-0 bg-[#0f0a07] shadow-[0_18px_34px_rgba(0,0,0,0.58)]">
          {variants.map((variant) => {
            const selected = variant.id === selectedVariant.id;
            return (
              <button
                key={variant.id}
                type="button"
                onClick={() => {
                  setSelectedVariantId(variant.id);
                  setIsOpen(false);
                }}
                className={`w-full border-b border-white/10 text-white outline-none transition last:border-b-0 hover:bg-[#21170f] focus-visible:bg-[#21170f] focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-inset ${selected ? "bg-[#1b120c]" : "bg-transparent"}`}
                aria-pressed={selected}
              >
                <PriceLine variant={variant} itemPriceMinorUnits={item.priceMinorUnits} salePriceMinorUnits={salePriceMinorUnits} />
              </button>
            );
          })}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setIsOpen((current) => (showDropdown ? !current : current))}
        className={`grid min-h-[3.35rem] w-full grid-cols-[minmax(0,1fr)_2.35rem] items-center overflow-hidden border bg-black/58 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_10px_22px_rgba(0,0,0,0.24)] backdrop-blur-sm transition hover:border-[#b9864f]/80 ${isOpen && showDropdown ? "rounded-b-[0.95rem] rounded-t-none border-[#b9864f]/75" : "rounded-[0.95rem] border-white/12"}`}
        aria-label={`Choose package size for ${item.name}`}
        aria-expanded={showDropdown ? isOpen : undefined}
        disabled={!showDropdown}
      >
        <PriceLine variant={selectedVariant} itemPriceMinorUnits={item.priceMinorUnits} salePriceMinorUnits={salePriceMinorUnits} />
        {showDropdown ? (
          <span className="grid h-full min-h-[3.35rem] place-items-center border-l border-white/10 bg-white/[0.03] text-white/90">
            <ChevronIcon open={isOpen} />
          </span>
        ) : (
          <span aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
