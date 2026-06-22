"use client";

import { useMemo, useState } from "react";
import { useMockCart } from "@/components/cart/CartProvider";
import { formatMinorCurrency } from "@/lib/leafly/format";
import type { GreenwayMenuItem } from "@/lib/leafly/types";

function inventoryLabel(inventoryLevel: number) {
  if (inventoryLevel <= 0) return "Unavailable";
  if (inventoryLevel <= 5) return "Low stock";
  return "In stock";
}

export function ProductOrderIntent({ item }: { item: GreenwayMenuItem }) {
  const { addItem } = useMockCart();
  const [selectedVariantId, setSelectedVariantId] = useState(item.variants[0]?.id ?? "");
  const selectedVariant = useMemo(
    () => item.variants.find((variant) => variant.id === selectedVariantId) ?? item.variants[0],
    [item.variants, selectedVariantId],
  );
  const maxQuantity = Math.max(1, Math.min(selectedVariant?.inventoryLevel ?? 1, 10));
  const [quantity, setQuantity] = useState(1);
  const subtotal = (selectedVariant?.priceMinorUnits ?? 0) * quantity;
  const canPreviewOrder = Boolean(selectedVariant && selectedVariant.inventoryLevel > 0);

  function adjustQuantity(nextQuantity: number) {
    setQuantity(Math.min(Math.max(nextQuantity, 1), maxQuantity));
  }

  return (
    <section className="rounded-[2rem] border border-white/10 bg-[#111] p-5 shadow-2xl md:p-7">
      <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--greenway)]">Order preview</p>
      <h2 className="mt-2 text-3xl font-black text-white">Choose size and quantity</h2>
      <p className="mt-3 text-sm leading-6 text-zinc-400">
        This panel is a customer-experience preview only. It does not create an order, reserve inventory, or call Leafly. Live online ordering should wait until Leafly Menu API certification and the approved order flow are ready.
      </p>

      <div className="mt-6 grid gap-3">
        {item.variants.map((variant) => {
          const isSelected = variant.id === selectedVariant?.id;
          return (
            <button
              key={variant.id}
              type="button"
              onClick={() => {
                setSelectedVariantId(variant.id);
                setQuantity(1);
              }}
              className={`rounded-2xl border p-4 text-left transition ${
                isSelected
                  ? "border-[var(--orange)] bg-[var(--orange)]/15"
                  : "border-white/10 bg-black/35 hover:border-white/40"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-black text-white">{variant.label}</p>
                  <p className="mt-1 break-all text-xs font-bold text-zinc-500">{variant.id}</p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-xl font-black text-[var(--orange)]">{formatMinorCurrency(variant.priceMinorUnits)}</p>
                  <p className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-[var(--greenway)]">
                    {inventoryLabel(variant.inventoryLevel)} · {variant.inventoryLevel}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[0.65rem] font-black uppercase tracking-[0.18em] text-zinc-500">Quantity</p>
            <div className="mt-2 flex items-center gap-3">
              <button type="button" onClick={() => adjustQuantity(quantity - 1)} className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-xl font-black text-white transition hover:border-[var(--greenway)] hover:text-[var(--greenway)]" aria-label="Decrease quantity">
                −
              </button>
              <span className="min-w-10 text-center text-2xl font-black text-white">{quantity}</span>
              <button type="button" onClick={() => adjustQuantity(quantity + 1)} className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-xl font-black text-white transition hover:border-[var(--greenway)] hover:text-[var(--greenway)]" aria-label="Increase quantity">
                +
              </button>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[0.65rem] font-black uppercase tracking-[0.18em] text-zinc-500">Preview subtotal</p>
            <p className="mt-2 text-3xl font-black text-[var(--orange)]">{formatMinorCurrency(subtotal)}</p>
            <p className="mt-1 text-xs text-zinc-500">Before taxes, discounts, or Leafly checkout rules</p>
          </div>
        </div>
      </div>

      <button
        type="button"
        disabled={!canPreviewOrder}
        onClick={() => {
          if (!selectedVariant) return;
          addItem({
            productId: item.id,
            productName: item.name,
            brand: item.brand,
            category: item.category,
            strainType: item.strainType,
            variantId: selectedVariant.id,
            variantLabel: selectedVariant.label,
            priceMinorUnits: selectedVariant.priceMinorUnits,
            quantity,
          });
        }}
        className="mt-6 w-full rounded-full bg-[var(--orange)] px-6 py-4 text-sm font-black uppercase tracking-[0.16em] text-black transition hover:bg-white disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
      >
        Preview add to order
      </button>

      <div className="mt-4 rounded-2xl border border-[var(--greenway)]/30 bg-[var(--greenway)]/10 p-4 text-sm leading-6 text-zinc-200">
        <p className="font-black uppercase tracking-[0.14em] text-[var(--greenway)]">Not a live checkout</p>
        <p className="mt-2">
          Selected: <span className="font-bold text-white">{selectedVariant?.label ?? "No variant"}</span> · Qty {quantity}. This is the shape of the future Greenway order experience, but final online ordering should be connected through the approved Leafly/POS workflow.
        </p>
      </div>
    </section>
  );
}
