"use client";
import { useState } from "react";
import type { MerchProductCard } from "@/lib/catalog-core";
import { PurchasePanel } from "./PurchasePanel";

/** Cannabis PDP layout (1.35fr picture / 1fr info) with a thumbnail strip. */
export function ProductDetail({ product, categoryLabel }: { product: MerchProductCard; categoryLabel: string }) {
  const [active, setActive] = useState(0);
  const imgs = product.images;
  return (
    <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:items-start md:gap-10">
      <div>
        <div className="relative flex min-h-[20rem] items-center justify-center overflow-hidden border border-[#4f8f5a] bg-white shadow-[0_22px_45px_rgba(0,0,0,0.32),inset_0_0_0_1px_rgba(0,0,0,0.08)] md:min-h-[40rem]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imgs[active] ?? imgs[0]} alt={product.title} className="h-full max-h-[44rem] w-full object-contain" />
        </div>
        {imgs.length > 1 ? (
          <div className="mt-3 flex gap-2 overflow-x-auto" aria-label="More photos">
            {imgs.map((src, i) => (
              <button key={src} type="button" onClick={() => setActive(i)} aria-label={`Photo ${i + 1}`} aria-pressed={i === active}
                className={`h-20 w-20 shrink-0 overflow-hidden border-2 bg-white ${i === active ? "border-[var(--orange)]" : "border-transparent hover:border-white/50"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <article className="md:pt-1">
        <span className="text-[0.78rem] font-black uppercase tracking-[0.18em] text-[var(--orange)]">Greenway</span>
        <p className="mt-1 text-[0.68rem] font-bold uppercase tracking-[0.2em] text-white/55">{categoryLabel}</p>
        <h1 className="mt-2 text-[2.15rem] font-black leading-[0.96] tracking-[-0.045em] text-white md:text-6xl">{product.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex min-h-7 items-center bg-[var(--greenway)] px-2.5 py-1 text-[0.72rem] font-black uppercase leading-none text-black">Greenway Merch</span>
          <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-white/25 bg-black/45 px-2.5 py-1 text-[0.66rem] font-black uppercase tracking-[0.1em] text-white/90">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--greenway)]" aria-hidden="true" />
            Printed to order
          </span>
        </div>
        <PurchasePanel product={product} />
        {product.description ? (
          <div className="mt-8 border-t border-white/10 pt-6">
            <h2 className="text-xs font-black uppercase tracking-[0.16em] text-[var(--greenway)]">Details</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-zinc-300">{product.description}</p>
          </div>
        ) : null}
        {product.blankLabel || product.fabric ? (
          <div className="mt-6 border-t border-white/10 pt-6">
            <h2 className="text-xs font-black uppercase tracking-[0.16em] text-[var(--greenway)]">Garment</h2>
            {product.blankLabel ? <p className="mt-3 text-sm font-bold text-white">{product.blankLabel}</p> : null}
            {product.fabric ? <p className="mt-1 text-sm leading-6 text-zinc-400">{product.fabric}</p> : null}
          </div>
        ) : null}
      </article>
    </div>
  );
}
