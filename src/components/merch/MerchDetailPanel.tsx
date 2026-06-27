"use client";

import { useMemo, useState } from "react";
import { useMockCart } from "@/components/cart/CartProvider";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { merchPriceRange, type MerchProductDef } from "@/lib/merch/merch-catalog";

type MerchDetailPanelProps = {
  def: MerchProductDef;
};

export function MerchDetailPanel({ def }: MerchDetailPanelProps) {
  const { addItem } = useMockCart();
  const isGendered = def.gendered;
  const isOneSize = !def.gendered && def.mensSizes.length === 1 && def.mensSizes[0] === "One Size";

  const [fit, setFit] = useState<"mens" | "womens">("mens");
  const sizes = isGendered ? (fit === "mens" ? def.mensSizes : def.womensSizes) : def.mensSizes;
  const [selectedSize, setSelectedSize] = useState(sizes[0]);
  const [selectedColor, setSelectedColor] = useState(def.colors[0]?.name ?? "");
  const [quantity, setQuantity] = useState(1);

  const range = useMemo(() => merchPriceRange(def), [def]);
  const unitPrice = def.basePriceMinorUnits + (def.sizeUpcharge?.[selectedSize] ?? 0);
  const subtotal = unitPrice * quantity;

  function changeFit(nextFit: "mens" | "womens") {
    setFit(nextFit);
    const nextSizes = nextFit === "mens" ? def.mensSizes : def.womensSizes;
    setSelectedSize(nextSizes[0]);
  }

  function setSafeQuantity(next: number) {
    setQuantity(Math.min(Math.max(next, 1), 10));
  }

  const fitLabel = isGendered ? (fit === "mens" ? "Men's " : "Women's ") : "";
  const sizePart = isOneSize ? "One Size" : `${fitLabel}${selectedSize}`;
  const variantLabel = `${selectedColor} · ${sizePart}`;

  return (
    <div className="mt-4">
      {/* Price range eyebrow */}
      <p className="text-[0.78rem] font-black uppercase tracking-[0.14em] text-zinc-400">
        Price range {formatMinorCurrency(range.min)}–{formatMinorCurrency(range.max)}
      </p>

      {/* Gender / fit toggle */}
      {isGendered ? (
        <div className="mt-4">
          <p className="mb-2 text-[0.72rem] font-black uppercase tracking-[0.14em] text-zinc-500">Fit</p>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Select fit">
            {(["mens", "womens"] as const).map((value) => {
              const active = fit === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => changeFit(value)}
                  aria-pressed={active}
                  className={`min-h-11 rounded-md border px-3 text-[0.8rem] font-black uppercase tracking-[0.06em] transition ${
                    active ? "border-[var(--orange)] bg-[var(--orange)] text-black" : "border-white/25 bg-[#1a1a1a] text-white hover:border-white/60"
                  }`}
                >
                  {value === "mens" ? "Men's" : "Women's"}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Color selector */}
      <div className="mt-4">
        <p className="mb-2 text-[0.72rem] font-black uppercase tracking-[0.14em] text-zinc-500">
          Color <span className="text-white/80">· {selectedColor}</span>
        </p>
        <div className="flex flex-wrap gap-2.5" role="group" aria-label="Select color">
          {def.colors.map((color) => {
            const active = color.name === selectedColor;
            return (
              <button
                key={color.name}
                type="button"
                onClick={() => setSelectedColor(color.name)}
                aria-pressed={active}
                title={color.name}
                className={`h-9 w-9 rounded-full border-2 transition ${active ? "border-[var(--orange)] ring-2 ring-[var(--orange)]/30" : "border-white/30 hover:border-white/70"}`}
                style={{ backgroundColor: color.swatch }}
              >
                <span className="sr-only">{color.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Size selector */}
      {!isOneSize ? (
        <div className="mt-4">
          <p className="mb-2 text-[0.72rem] font-black uppercase tracking-[0.14em] text-zinc-500">Size</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Select size">
            {sizes.map((size) => {
              const active = size === selectedSize;
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => setSelectedSize(size)}
                  aria-pressed={active}
                  className={`min-w-12 rounded-md border px-3 py-2.5 text-sm font-black uppercase transition ${
                    active ? "border-[var(--greenway)] bg-[var(--greenway)] text-black" : "border-white/25 bg-[#1a1a1a] text-white hover:border-white/60"
                  }`}
                >
                  {size}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs font-black uppercase tracking-[0.12em] text-zinc-400">One size fits most</p>
      )}

      {/* Price */}
      <div className="mt-5 flex items-end gap-3 leading-none">
        <span className="text-[2.35rem] font-black text-white">{formatMinorCurrency(unitPrice)}</span>
      </div>

      {/* Quantity */}
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
        onClick={() =>
          addItem({
            productId: `merch-${def.key}`,
            productName: def.name,
            brand: "Greenway",
            category: "merch",
            filterCategories: ["merch"],
            strainType: "unknown",
            variantId: `merch-${def.key}-${variantLabel}`.replace(/\s+/g, "-").toLowerCase(),
            variantLabel,
            priceMinorUnits: unitPrice,
            regularPriceMinorUnits: unitPrice,
            inventoryLevel: 25,
            quantity,
          })
        }
        className="mt-3 flex h-14 w-full items-center justify-center rounded-md bg-[#d8e6c4] px-5 text-[0.82rem] font-black uppercase tracking-[0.12em] text-black transition hover:bg-[var(--greenway)]"
      >
        Add to Cart - {formatMinorCurrency(subtotal)}
      </button>
    </div>
  );
}
