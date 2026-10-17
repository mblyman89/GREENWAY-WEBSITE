"use client";
import Link from "next/link";
import { cartCount, useCart } from "./cart-store";

/**
 * Same sticky black header bar as greenwaymarijuana.com (class string copied),
 * with a text wordmark instead of the cannabis logo - the merch site carries
 * no cannabis branding. Cart count is live from localStorage.
 */
export function Header() {
  const n = cartCount(useCart());
  return (
    <header className="sticky top-0 z-50 w-full max-w-[100vw] overflow-x-clip border-b border-white/10 bg-black/88 backdrop-blur-md">
      <div className="mx-auto flex max-w-[var(--shop-max)] items-center justify-between gap-3 px-3 py-3 sm:px-4 md:px-8">
        <Link href="/" className="group flex min-w-0 flex-col leading-none" aria-label="Greenway Merch - shop home">
          <span className="truncate text-xl font-black uppercase tracking-[-0.02em] text-white transition group-hover:text-[var(--greenway)] md:text-2xl">
            Greenway <span className="text-[var(--greenway)]">Merch</span>
          </span>
          <span className="mt-1 truncate text-[0.6rem] font-black uppercase tracking-[0.22em] text-zinc-500">Greenway Glass &amp; Goods</span>
        </Link>
        <nav className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link href="/" className="hidden rounded-full border border-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-zinc-300 transition hover:border-[var(--greenway)]/45 hover:text-white sm:inline-flex">Shop</Link>
          <Link href="/cart" className="relative inline-flex h-11 items-center gap-2 rounded-full bg-[var(--greenway)] px-4 text-xs font-black uppercase tracking-[0.14em] text-black transition hover:bg-[var(--gold)]" aria-label={`Cart, ${n} item${n === 1 ? "" : "s"}`}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6.2 6.5h15.1l-1.7 8.1a2 2 0 0 1-2 1.6H8.8a2 2 0 0 1-2-1.7L5.4 3.8H2.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9.4 20.2h.01M17.2 20.2h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Cart
            <span className="grid h-6 min-w-6 place-items-center rounded-full bg-black px-1.5 text-[0.7rem] text-white" suppressHydrationWarning>{n}</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
