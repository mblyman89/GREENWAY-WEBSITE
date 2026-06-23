"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function SearchIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m21 21-4.3-4.3M10.8 18.2a7.4 7.4 0 1 1 0-14.8 7.4 7.4 0 0 1 0 14.8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function SearchModal() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  function submitSearch() {
    const normalizedQuery = query.trim();
    const nextUrl = normalizedQuery ? `/menu?search=${encodeURIComponent(normalizedQuery)}` : "/menu";
    setIsOpen(false);
    router.push(nextUrl);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-zinc-200 transition hover:border-[var(--greenway)]/45 hover:text-[var(--greenway)] sm:h-10 sm:w-10"
        aria-label="Open product search"
      >
        <SearchIcon />
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-[100] bg-[#111] px-4 py-7 text-white sm:bg-black/82 sm:backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Search Greenway products">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-3xl font-black uppercase tracking-tight text-white">Search Products</h2>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-black text-2xl font-light leading-none text-white transition hover:bg-[var(--orange)] hover:text-black"
                aria-label="Close product search"
              >
                ×
              </button>
            </div>

            <form
              className="relative mt-5 block"
              onSubmit={(event) => {
                event.preventDefault();
                submitSearch();
              }}
            >
              <label className="sr-only" htmlFor="site-product-search">Search products</label>
              <input
                id="site-product-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Products"
                className="w-full rounded-sm border border-white/10 bg-white px-4 py-4 pr-12 text-base font-semibold text-black outline-none transition placeholder:text-zinc-500 focus:border-[var(--orange)] focus:ring-2 focus:ring-[var(--orange)]/20"
              />
              <button type="submit" className="absolute right-4 top-1/2 -translate-y-1/2 text-black transition hover:text-[var(--orange)]" aria-label="Search menu products">
                <SearchIcon />
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
