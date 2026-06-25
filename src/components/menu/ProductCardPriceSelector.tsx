"use client";

import { useMemo, useState } from "react";
import { formatMinorCurrency } from "@/lib/leafly/format";
import type { GreenwayMenuItem, GreenwayMenuVariant } from "@/lib/leafly/types";

type ProductCardPriceSelectorProps = {
  item: GreenwayMenuItem;
  salePriceMinorUnits?: number;
};

type PriceOptionProps = {
  variant: GreenwayMenuVariant;
  itemPriceMinorUnits: number;
  salePriceMinorUnits?: number;
  selected?: boolean;
  compact?: boolean;
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

function PriceOption({ variant, itemPriceMinorUnits, salePriceMinorUnits, selected = false, compact = false }: PriceOptionProps) {
  const { regularPrice, displayPrice, hasSalePrice, unitLabel } = priceParts(variant, itemPriceMinorUnits, salePriceMinorUnits);
  return (
    <div
      className={`flex min-h-[3.05rem] w-full items-center justify-center gap-2 rounded-[0.72rem] px-3 text-center leading-none transition ${
        selected
          ? "border border-[#b9864f] bg-[#21170f] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
          : "border border-white/10 bg-black/35 hover:border-[#b9864f]/80 hover:bg-[#21170f]/70"
      } ${compact ? "min-h-[2.9rem]" : ""}`}
    >
      {hasSalePrice ? (
        <span className="text-[0.9rem] font-black text-zinc-400 line-through md:text-[0.95rem]">{formatMinorCurrency(regularPrice)}</span>
      ) : null}
      <span className="text-[1.5rem] font-black text-[var(--orange)] md:text-[1.72rem]">{formatMinorCurrency(displayPrice)}</span>
      {unitLabel ? <span className="text-sm font-black text-white/95 md:text-base">{unitLabel}</span> : null}
    </div>
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
    <div className="relative rounded-[0.95rem] bg-black/30 text-center">
      <button
        type="button"
        onClick={() => setIsOpen((current) => (showDropdown ? !current : current))}
        className="grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-[0.95rem] border border-white/12 bg-black/58 p-1.5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_10px_22px_rgba(0,0,0,0.24)] backdrop-blur-sm transition hover:border-[#b9864f]/80"
        aria-label={`Choose package size for ${item.name}`}
        aria-expanded={showDropdown ? isOpen : undefined}
      >
        <PriceOption variant={selectedVariant} itemPriceMinorUnits={item.priceMinorUnits} salePriceMinorUnits={salePriceMinorUnits} selected compact />
        {showDropdown ? (
          <span className="grid h-10 w-8 place-items-center rounded-lg text-white/90">
            <ChevronIcon open={isOpen} />
          </span>
        ) : null}
      </button>

      {showDropdown && isOpen ? (
        <div className="absolute inset-x-0 bottom-[calc(100%+0.35rem)] z-30 rounded-[0.95rem] border border-[#b9864f]/70 bg-[#0f0a07] p-1.5 shadow-[0_18px_34px_rgba(0,0,0,0.58)]">
          <div className="grid gap-1.5">
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
                  className="w-full text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  <PriceOption variant={variant} itemPriceMinorUnits={item.priceMinorUnits} salePriceMinorUnits={salePriceMinorUnits} selected={selected} />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
