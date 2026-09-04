"use client";

import { useMemo, useState } from "react";
import { useMockCart } from "@/components/cart/CartProvider";
import { formatMinorCurrency } from "@/lib/leafly/format";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { menuCardDiscountForItem } from "@/lib/promotions/published-rules-core";
import { menuCardBadgeForItem } from "@/lib/promotions/deal-badge-core";
import { useActiveDealRules } from "@/components/promotions/PublishedRulesProvider";
import { useStoreWeekday } from "@/lib/specials/useStoreWeekday";
import { sortVariantsBySize } from "@/lib/menu/variant-sort";
import { collapseVariantsForDisplay } from "@/lib/menu/variant-collapse-core";
import { displayVariantLabel } from "@/lib/menu/weight-display-core";

type ProductDetailPurchasePanelProps = {
  item: GreenwayMenuItem;
};

export function ProductDetailPurchasePanel({ item }: ProductDetailPurchasePanelProps) {
  const { addItem } = useMockCart();
  // Resolve today's deal on the client so prices stay accurate despite SSG.
  // PROMOTIONS HARMONY (Task T / PR 1): the deal derives from the back
  // office's PUBLISHED promotion rules (the same rules the cart charges with).
  // SLICE 40 (owner directive): Friday/Saturday/Sunday show the regular price
  // (basket-dependent deals finalize in the cart); Mon–Thu keep the sale price.
  const activeRules = useActiveDealRules();
  const weekday = useStoreWeekday();
  const deal = menuCardDiscountForItem(item, activeRules, weekday);
  // Only clean per-item deals show an exact sale price here (legacy behaviour:
  // basket/tier deals finalize in the cart).
  const salePriceMinorUnits = deal?.perItemSalePrice ? deal.salePriceMinorUnits : undefined;
  // SLICE 96 (owner directive): show the deal badge on the detail page too —
  // same shared engine as every product card (honest advertisement of the
  // day's deal, independent of the SLICE 40 struck-price policy).
  const dealBadge = menuCardBadgeForItem(item, activeRules, weekday);
  // SLICE 40: lowest size first, ascending (same order as the product cards).
  // SLICE 70 (restock readiness): identical label+price lots collapse to one
  // row (first in-stock lot = oldest represents; display-only, see
  // variant-collapse-core). The register and admin still see every lot.
  const variants = useMemo(
    () =>
      item.variants.length > 0
        ? collapseVariantsForDisplay(sortVariantsBySize(item.variants))
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
                {/* SLICE 98: topicals/edibles/liquids show ounces (display only;
                    the raw label still keys the cart line + limit math). */}
                {displayVariantLabel(variant.label, item.category)} — {formatMinorCurrency(variant.priceMinorUnits)}
                {variant.medical ? (
                  <span className="ml-1.5 rounded-[0.3rem] border border-current px-1 py-0.5 text-[0.55rem] font-black uppercase tracking-[0.12em]">
                    Med
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* SLICE 96: deal badge — same look as the product-card badge. */}
      {dealBadge ? (
        <div className="mt-4 inline-flex rounded-full border border-[var(--greenway)]/55 bg-black/60 px-3 py-1.5 text-[0.66rem] font-black uppercase leading-tight tracking-[0.08em] text-[var(--greenway)] shadow-[0_0_18px_rgba(126,217,87,0.18)]">
          {dealBadge}
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
            // SLICE 16 — the low-THC beverage classification travels into the
            // cart so the meter and the checkout hard block apply the 200 mg
            // THC limit instead of the 72 oz liquid limit. Unclassified
            // products pass null and are counted as normal liquids.
            lowThcLiquid: item.lowThcLiquid ?? null,
            unitThcMg: item.unitThcMg ?? null,
            // SLICE 17 — so the website cart meter counts suppository UNITS.
            otherwiseTaken: item.otherwiseTaken ?? null,
            unitsPerPackage: item.unitsPerPackage ?? null,
          });
        }}
        className="mt-3 flex h-14 w-full items-center justify-center rounded-md bg-[#d8e6c4] px-5 text-[0.82rem] font-black uppercase tracking-[0.12em] text-black transition hover:bg-[var(--greenway)] disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
      >
        Add to Cart - {formatMinorCurrency(subtotal)}
      </button>
    </div>
  );
}
