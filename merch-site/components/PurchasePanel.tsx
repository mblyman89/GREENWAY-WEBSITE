"use client";
/**
 * Colour / size / quantity / add-to-cart - copied from the cannabis PDP's
 * ProductDetailPurchasePanel (same buttons, price, qty stepper, green add
 * button) with apparel options instead of package sizes.
 */
import Link from "next/link";
import { useState } from "react";
import { CART_MAX_QTY, formatCents, type MerchProductCard } from "@/lib/catalog-core";
import { cart } from "./cart-store";

const OPT = "flex min-h-11 items-center justify-center rounded-none border px-2 text-center text-[0.82rem] font-black uppercase leading-tight transition";
const OPT_ON = "border-[var(--orange)] bg-[var(--orange)] text-black";
const OPT_OFF = "border-white/25 bg-[#1a1a1a] text-white hover:border-white/60";
const OPT_OUT = "cursor-not-allowed border-white/10 bg-[#111] text-zinc-600 line-through";

export function PurchasePanel({ product, onImage }: { product: MerchProductCard; onImage?: (color: string) => void }) {
  const firstIn = product.variants.find((v) => v.inStock) ?? product.variants[0];
  const [color, setColor] = useState(firstIn.color);
  const [size, setSize] = useState(firstIn.size);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const variant = product.variants.find((v) => v.color === color && v.size === size) ?? null;
  const sizeAvailable = (s: string) => product.variants.some((v) => v.color === color && v.size === s && v.inStock);
  const canAdd = !!variant && variant.inStock;
  const price = variant?.priceCents ?? product.minPriceCents;

  function pickColor(c: string) {
    setColor(c);
    setAdded(false);
    onImage?.(c);
    if (!product.variants.some((v) => v.color === c && v.size === size && v.inStock)) {
      const alt = product.variants.find((v) => v.color === c && v.inStock);
      if (alt) setSize(alt.size);
    }
  }

  return (
    <div>
      <div className="mt-5">
        <p className="text-[0.66rem] font-black uppercase tracking-[0.16em] text-zinc-400">Colour: <span className="text-white">{color}</span></p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Select colour">
          {product.colors.map((c) => (
            <button key={c} type="button" onClick={() => pickColor(c)} aria-pressed={c === color} className={`${OPT} ${c === color ? OPT_ON : OPT_OFF}`}>{c}</button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-[0.66rem] font-black uppercase tracking-[0.16em] text-zinc-400">Size: <span className="text-white">{size}</span></p>
        <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-5" aria-label="Select size">
          {product.sizes.map((s) => {
            const ok = sizeAvailable(s);
            return (
              <button key={s} type="button" disabled={!ok} onClick={() => { setSize(s); setAdded(false); }} aria-pressed={s === size} className={`${OPT} ${!ok ? OPT_OUT : s === size ? OPT_ON : OPT_OFF}`}>{s}</button>
            );
          })}
        </div>
      </div>

      <div className="mt-5 flex items-end gap-3 leading-none">
        <span className="text-[2.35rem] font-black text-white">{formatCents(price)}</span>
        {!canAdd ? <span className="pb-2 text-xs font-black uppercase tracking-[0.12em] text-[var(--orange)]">Sold out in this option</span> : null}
      </div>

      <div className="mt-4 grid grid-cols-[3.4rem_1fr_3.4rem] border border-white/18 bg-[#111] text-center">
        <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-12 text-2xl font-black text-white transition hover:bg-white hover:text-black" aria-label="Decrease quantity">-</button>
        <span className="flex h-12 items-center justify-center border-x border-white/18 text-lg font-black text-white" aria-live="polite">{qty}</span>
        <button type="button" onClick={() => setQty((q) => Math.min(CART_MAX_QTY, q + 1))} className="h-12 text-2xl font-black text-white transition hover:bg-white hover:text-black" aria-label="Increase quantity">+</button>
      </div>

      <button type="button" disabled={!canAdd} onClick={() => { if (variant) { cart.add(product.handle, variant.id, qty); setAdded(true); } }}
        className="mt-3 flex h-14 w-full items-center justify-center rounded-md bg-[var(--greenway)] px-5 text-[0.82rem] font-black uppercase tracking-[0.12em] text-black transition hover:bg-[#6bc746] disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400">
        {canAdd ? `Add to cart - ${formatCents(price * qty)}` : "Unavailable"}
      </button>
      {added ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--greenway)]/40 bg-[var(--greenway)]/10 px-4 py-3 text-sm font-bold text-white" role="status">
          Added to your cart.
          <Link href="/cart" className="rounded-full bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-black hover:bg-[var(--orange)]">View cart</Link>
        </div>
      ) : null}
      <p className="mt-4 text-[0.75rem] leading-5 text-zinc-500">Printed to order just for you. Shipping and any sales tax are shown at checkout - see our <Link href="/shipping" className="underline hover:text-[var(--greenway)]">shipping</Link> and <Link href="/returns" className="underline hover:text-[var(--greenway)]">returns</Link> policies.</p>
    </div>
  );
}
