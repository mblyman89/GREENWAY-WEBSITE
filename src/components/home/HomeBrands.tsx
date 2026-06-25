"use client";

import Link from "next/link";
import { useMemo } from "react";
import { SectionBanner } from "@/components/home/SectionBanner";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { useShuffleOrder } from "@/lib/home/useShuffleOrder";

const LIMIT = 16;

type BrandEntry = {
  brand: string;
  count: number;
  href: string;
};

// Brand accent palette cycles across the 16 tiles for a lively, on-brand grid.
const ACCENTS = [
  "from-[var(--greenway)] to-emerald-700",
  "from-[var(--gold)] to-[var(--orange)]",
  "from-[var(--orange)] to-rose-700",
  "from-emerald-400 to-[var(--greenway-dark)]",
  "from-amber-400 to-[var(--orange)]",
  "from-lime-400 to-emerald-700",
];

function buildBrandEntries(items: GreenwayMenuItem[]): BrandEntry[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.brand) continue;
    counts.set(item.brand, (counts.get(item.brand) ?? 0) + 1);
  }
  return [...counts.entries()].map(([brand, count]) => ({
    brand,
    count,
    href: `/menu?brands=${encodeURIComponent(brand)}`,
  }));
}

/**
 * Home "Shop by Brand" section. Rotates through brands like the menu feature
 * shuffle — a fresh set of up to 16 brands each fresh page load — rendered as
 * a 4x4 grid on desktop / 2-up on mobile, each linking to the brand-filtered
 * menu (/menu?brands=<brand>).
 */
export function HomeBrands({ items }: { items: GreenwayMenuItem[] }) {
  const allBrands = useMemo(() => buildBrandEntries(items), [items]);
  const shuffle = useShuffleOrder(
    "home-brands",
    allBrands.map((b) => b.brand),
  );

  const brands = useMemo(() => {
    const ordered = [...allBrands].sort(
      (a, b) => (shuffle[a.brand] ?? 0) - (shuffle[b.brand] ?? 0),
    );
    return ordered.slice(0, LIMIT);
  }, [allBrands, shuffle]);

  return (
    <section id="shop-by-brand" className="bg-black px-4 py-6 md:px-8 md:py-8" aria-label="Shop by brand">
      <div className="mx-auto max-w-[88rem] space-y-4 md:space-y-6">
        <SectionBanner
          imageSrc="/home/brand-banner.webp"
          imageAlt="Greenway featured cannabis brands"
          eyebrow="Featured Brands"
          title="Shop by Brand"
          subtitle="A fresh lineup of our favorite brands every visit — tap any to shop their full menu."
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4">
          {brands.map((entry, index) => (
            <Link
              key={entry.brand}
              href={entry.href}
              className="group relative isolate flex aspect-[5/3] flex-col justify-end overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal)] p-4 shadow-lg shadow-black/30 transition hover:-translate-y-0.5 hover:border-white/25"
            >
              <div
                className={`absolute inset-0 bg-gradient-to-br ${ACCENTS[index % ACCENTS.length]} opacity-80 transition group-hover:opacity-95`}
                aria-hidden="true"
              />
              <div
                className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.28),transparent_55%),linear-gradient(180deg,rgba(0,0,0,0.1)_0%,rgba(0,0,0,0.72)_100%)]"
                aria-hidden="true"
              />
              <div className="relative">
                <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-white/80 md:text-[0.62rem]">
                  {entry.count} {entry.count === 1 ? "product" : "products"}
                </p>
                <p className="mt-0.5 text-base font-black uppercase leading-tight tracking-tight text-white drop-shadow md:text-lg lg:text-xl">
                  {entry.brand}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
