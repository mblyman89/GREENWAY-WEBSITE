"use client";

import { useMockCart } from "@/components/cart/CartProvider";
import { formatMinorCurrency } from "@/lib/leafly/format";

export function HeaderCartButton() {
  const { itemCount, subtotalMinorUnits, openCart } = useMockCart();
  const accessibleLabel = `Open cart with ${itemCount} item${itemCount === 1 ? "" : "s"}`;

  return (
    <button
      type="button"
      onClick={openCart}
      className="group relative inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-2 text-white transition hover:border-[var(--orange)] hover:bg-[var(--orange)] hover:text-black sm:min-h-10 sm:px-3 sm:py-2"
      aria-label={accessibleLabel}
    >
      <span className="sr-only">Cart</span>
      <svg className="h-4 w-4 sm:hidden" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6.2 6.5h15.1l-1.7 8.1a2 2 0 0 1-2 1.6H8.8a2 2 0 0 1-2-1.7L5.4 3.8H2.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9.4 20.2h.01M17.2 20.2h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="hidden text-[0.68rem] font-black uppercase tracking-[0.12em] sm:inline">Cart</span>
      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--orange)] px-1.5 text-[0.62rem] font-black leading-none text-black ring-2 ring-black transition group-hover:bg-black group-hover:text-white sm:static sm:h-6 sm:min-w-6 sm:px-2 sm:text-[0.68rem] sm:ring-0">
        {itemCount}
      </span>
      {itemCount > 0 ? <span className="hidden text-[0.68rem] font-black uppercase tracking-[0.12em] text-zinc-300 transition group-hover:text-black lg:inline">{formatMinorCurrency(subtotalMinorUnits)}</span> : null}
    </button>
  );
}
