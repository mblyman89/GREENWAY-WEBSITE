import Link from "next/link";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { formatWebsiteCategory, websiteCategories } from "@/lib/pos/category-taxonomy";

function categoryCount(items: GreenwayMenuItem[], category: GreenwayMenuItem["category"]) {
  return items.filter((item) => item.category === category).length;
}

function variantCount(items: GreenwayMenuItem[]) {
  return items.reduce((total, item) => total + item.variants.length, 0);
}

function priceRange(items: GreenwayMenuItem[]) {
  const prices = items.map((item) => item.priceMinorUnits).filter((price) => Number.isFinite(price));
  if (!prices.length) return "Pending";
  const min = Math.min(...prices) / 100;
  const max = Math.max(...prices) / 100;
  return `$${min.toFixed(0)}–$${max.toFixed(0)}`;
}

export function MenuCollectionShell({ items }: { items: GreenwayMenuItem[] }) {
  const totalVariants = variantCount(items);
  const visibleCategories = websiteCategories.filter((category) => categoryCount(items, category) > 0);

  return (
    <section className="border-b border-white/10 bg-[linear-gradient(180deg,#050505_0%,#0b0b0b_100%)] px-4 py-5 md:px-8 md:py-6">
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[0.9fr_1.1fr] lg:items-stretch">
        <div className="rounded-[1.5rem] border border-white/10 bg-black/55 p-4 shadow-2xl shadow-black/30 md:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[var(--greenway)] px-3 py-1.5 text-[0.62rem] font-black uppercase tracking-[0.15em] text-black">
              Preview Menu
            </span>
            <span className="rounded-full border border-[var(--orange)]/35 bg-[var(--orange)]/10 px-3 py-1.5 text-[0.62rem] font-black uppercase tracking-[0.15em] text-[var(--orange)]">
              Leafly v2-ready
            </span>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <p className="text-[0.58rem] font-black uppercase tracking-[0.16em] text-zinc-500">Products</p>
              <p className="mt-1 text-2xl font-black text-white">{items.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <p className="text-[0.58rem] font-black uppercase tracking-[0.16em] text-zinc-500">Variants</p>
              <p className="mt-1 text-2xl font-black text-white">{totalVariants}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <p className="text-[0.58rem] font-black uppercase tracking-[0.16em] text-zinc-500">Range</p>
              <p className="mt-1 text-2xl font-black text-white">{priceRange(items)}</p>
            </div>
          </div>

          <p className="mt-4 rounded-2xl border border-[var(--greenway)]/20 bg-[var(--greenway-dark)]/30 p-3 text-xs font-semibold leading-5 text-zinc-400">
            Preview-only catalog generated from exact-match POS rows with website-ready variants, category filters, and minor-unit prices. No payment, reservation, delivery, or production POS publishing is enabled.
          </p>
        </div>

        <div className="film-strip relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#151515] p-4 shadow-2xl shadow-black/30 md:p-5">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_14%,rgba(255,127,0,0.24),transparent_14rem),radial-gradient(circle_at_18%_88%,rgba(126,217,87,0.18),transparent_14rem)]" aria-hidden="true" />
          <div className="relative">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--orange)]">Filters start below</p>
                <h2 className="mt-1 text-2xl font-black uppercase tracking-tight text-white md:text-3xl">Shop by category</h2>
              </div>
              <Link href="/specials" className="rounded-full border border-white/15 px-3 py-2 text-[0.62rem] font-black uppercase tracking-[0.14em] text-white transition hover:border-[var(--orange)] hover:text-[var(--orange)]">
                Specials
              </Link>
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-4 lg:overflow-visible lg:pb-0">
              {visibleCategories.map((category) => (
                <a
                  key={category}
                  href={`#${category}`}
                  className="group min-w-[8.5rem] rounded-2xl border border-white/10 bg-black/35 p-3 transition hover:-translate-y-0.5 hover:border-[var(--greenway)] hover:bg-black/55"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black text-white group-hover:text-[var(--greenway)]">{formatWebsiteCategory(category)}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[0.65rem] font-black text-black">{categoryCount(items, category)}</span>
                  </div>
                  <p className="mt-1 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-zinc-500">Jump</p>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
