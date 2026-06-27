"use client";

import { useMemo, useState } from "react";
import { useMockCart } from "@/components/cart/CartProvider";
import { formatMinorCurrency } from "@/lib/leafly/format";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { getActiveMenuDiscount } from "@/lib/specials/daily-deals";
import { useStoreWeekday } from "@/lib/specials/useStoreWeekday";

type ProductDetailPurchasePanelProps = {
  item: GreenwayMenuItem;
};

export function ProductDetailPurchasePanel({ item }: ProductDetailPurchasePanelProps) {
  const { addItem } = useMockCart();
  // Resolve today's deal on the client so prices stay accurate despite SSG.
  const weekday = useStoreWeekday();
  const salePriceMinorUnits = weekday ? getActiveMenuDiscount(item, weekday)?.salePriceMinorUnits : undefined;
  const variants = useMemo(
    () =>
      item.variants.length > 0
        ? item.variants
        : [
            {
              id: `${item.id}-default`,
              label: item.priceLabel.replace(/^\$[\d.]+\s*/, "") || "each",
              priceMinorUnits: item.priceMinorUnits,
              inventoryLevel: 1,
              medical: false,
            },
          ],
    [item.id, item.priceLabel, item.priceMinorUnits, item.variants],
  );
  const [selectedVariantId, setSelectedVariantId] = useState(variants[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const selectedVariant = useMemo(
    () => variants.find((variant) => variant.id === selectedVariantId) ?? variants[0],
    [selectedVariantId, variants],
  );
  const basePrice = selectedVariant?.priceMinorUnits ?? item.priceMinorUnits;
  const saleRatio = typeof salePriceMinorUnits === "number" && salePriceMinorUnits > 0 && salePriceMinorUnits < item.priceMinorUnits ? salePriceMinorUnits / item.priceMinorUnits : undefined;
  const variantSalePrice = saleRatio ? Math.round(basePrice * saleRatio) : undefined;
  const activeUnitPrice = variantSalePrice && variantSalePrice < basePrice ? variantSalePrice : basePrice;
  const subtotal = activeUnitPrice * quantity;
  const maxQuantity = Math.max(1, Math.min(selectedVariant?.inventoryLevel ?? 1, 10));
  const canAdd = Boolean(selectedVariant && selectedVariant.inventoryLevel > 0);

  function setSafeQuantity(next: number) {
    setQuantity(Math.min(Math.max(next, 1), maxQuantity));
  }

  return (
    <div className="mt-4">
      {variants.length > 1 ? (
        <div className="grid grid-cols-2 gap-2" aria-label="Select package size">
          {variants.map((variant) => {
            const isSelected = variant.id === selectedVariant?.id;
            return (
              <button
                key={variant.id}
                type="button"
                onClick={() => {
                  setSelectedVariantId(variant.id);
                  setQuantity(1);
                }}
                className={`flex min-h-11 items-center justify-center rounded-none border px-2 text-center text-[0.82rem] font-black uppercase leading-tight transition ${
                  isSelected
                    ? "border-[var(--orange)] bg-[var(--orange)] text-black"
                    : "border-white/25 bg-[#1a1a1a] text-white hover:border-white/60"
                }`}
              >
                {variant.label} — {formatMinorCurrency(variant.priceMinorUnits)}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="mt-5 flex items-end gap-3 leading-none">
        {variantSalePrice && variantSalePrice < basePrice ? (
          <span className="pb-1 text-[1.05rem] font-black text-zinc-500 line-through">{formatMinorCurrency(basePrice)}</span>
        ) : null}
        <span className="text-[2.35rem] font-black text-white">{formatMinorCurrency(activeUnitPrice)}</span>
      </div>

      <div className="mt-4 grid grid-cols-[3.4rem_1fr_3.4rem] border border-white/18 bg-[#111] text-center">
        <button type="button" onClick={() => setSafeQuantity(quantity - 1)} className="h-12 text-2xl font-black text-white transition hover:bg-white hover:text-black" aria-label="Decrease quantity">
          −
        </button>
        <span className="flex h-12 items-center justify-center border-x border-white/18 text-lg font-black text-white">{quantity}</span>
        <button type="button" onClick={() => setSafeQuantity(quantity + 1)} className="h-12 text-2xl font-black text-white transition hover:bg-white hover:text-black" aria-label="Increase quantity">
          +
        </button>
      </div>

      <button
        type="button"
        disabled={!canAdd}
        onClick={() => {
          if (!selectedVariant) return;
          addItem({
            productId: item.id,
            productName: item.name,
            brand: item.brand,
            category: item.category,
            filterCategories: item.filterCategories,
            strainType: item.strainType,
            variantId: selectedVariant.id,
            variantLabel: selectedVariant.label,
            // Pass the TRUE regular price; the smart cart applies the accurate
            // threshold-based daily-deal discount based on full cart contents.
            priceMinorUnits: basePrice,
            regularPriceMinorUnits: basePrice,
            inventoryLevel: selectedVariant.inventoryLevel,
            quantity,
          });
        }}
        className="mt-3 flex h-14 w-full items-center justify-center rounded-md bg-[#d8e6c4] px-5 text-[0.82rem] font-black uppercase tracking-[0.12em] text-black transition hover:bg-[var(--greenway)] disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
      >
        Add to Cart - {formatMinorCurrency(subtotal)}
      </button>
    </div>
  );
}
