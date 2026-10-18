"use client";
/**
 * The greenwaymerch.com shop - a copy of greenwaymarijuana.com's shop layout
 * (InteractiveMenuBrowser): filter rail on the left (mobile: "Filters &
 * Categories" full-screen sheet), toolbar title + search + sort on the right,
 * 4-up glow-card grid.
 *
 *  - Shop page (/):        category cards. Category rows in the filter bar are
 *                          links straight to each catalogue page. Typing in
 *                          search shows matching products from every category.
 *  - Catalogue (/<cat>):   that category's product cards + colour/size filters.
 */
import Link from "next/link";
import { useState } from "react";
import { browse, facetCounts, priceLabel, SORT_OPTIONS, type MerchCategory, type MerchProductCard, type SortKey } from "@/lib/catalog-core";
import { glowCardStyle, glowToneByIndex, GLOW_STRIP_BOTTOM_CLASS, GLOW_STRIP_LEFT_CLASS, GLOW_STRIP_RIGHT_CLASS } from "@/lib/glow";
import type { CardCopy } from "@/lib/site-content-core";
import { FilterCheckRow, FilterLinkRow, FilterSection, SEARCH_INPUT_CLASS, SearchIcon } from "./ui";

type Props = {
  categories: (MerchCategory & { count: number })[];
  products: MerchProductCard[];
  /** null = the shop page (category cards); a slug = that catalogue page. */
  current: string | null;
  /** R73 S3: owner-edited card wording (Website -> Merchandise -> Product cards). */
  copy: CardCopy;
};

const CARD = "group relative flex min-h-[37.25rem] min-w-0 flex-col justify-between overflow-hidden border p-4 text-white transition duration-300 hover:border-white/70 hover:shadow-[0_18px_44px_rgba(0,0,0,0.55)]";
const IMAGE_BOX = "relative h-[14.15rem] overflow-hidden bg-white p-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)] md:h-[14.65rem]";
const CTA = "mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-black uppercase tracking-[0.08em] text-black transition hover:bg-[var(--orange)]";

function GlowStrips({ index }: { index: number }) {
  const t = glowToneByIndex(index);
  return (
    <>
      <span className={GLOW_STRIP_LEFT_CLASS} style={{ background: t.glowLeft }} aria-hidden="true" />
      <span className={GLOW_STRIP_RIGHT_CLASS} style={{ background: t.glowRight }} aria-hidden="true" />
      <span className={GLOW_STRIP_BOTTOM_CLASS} style={{ background: t.glowLeft }} aria-hidden="true" />
    </>
  );
}

export function CategoryCard({ cat, index, copy }: { cat: MerchCategory & { count: number }; index: number; copy: CardCopy }) {
  const href = `/${cat.slug}`;
  return (
    <article className={`${CARD} !min-h-[28rem]`} style={glowCardStyle(glowToneByIndex(index))}>
      <GlowStrips index={index} />
      <div>
        <p className="truncate pb-1 text-center text-lg font-black leading-none text-white md:text-xl">{cat.label}</p>
        <p className="truncate pb-2 text-center text-[0.7rem] font-bold uppercase tracking-[0.18em] text-white/60">
          {cat.count ? `${cat.count} design${cat.count === 1 ? "" : "s"}` : "Coming soon"}
        </p>
        <Link href={href} className="block" aria-label={`${copy.categoryCta} ${cat.label}`}>
          <div className={IMAGE_BOX}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cat.image} alt={cat.label} loading={index < 4 ? "eager" : "lazy"} className="h-full w-full object-contain p-3" />
          </div>
        </Link>
        <p className="mx-auto mt-4 line-clamp-3 min-h-[3.6rem] text-center text-sm leading-5 text-zinc-300">{cat.blurb}</p>
      </div>
      <Link href={href} className={CTA}>{copy.categoryCta} {cat.label} →</Link>
    </article>
  );
}

export function ProductCard({ p, index, copy }: { p: MerchProductCard; index: number; copy: CardCopy }) {
  const href = `/${p.category}/${p.handle}`;
  const inStock = p.variants.some((v) => v.inStock);
  return (
    <article className={CARD} style={glowCardStyle(glowToneByIndex(index))}>
      <GlowStrips index={index} />
      <div>
        <p className="truncate pb-1 text-center text-lg font-black leading-none text-white md:text-xl">{copy.brand}</p>
        <p className="truncate pb-2 text-center text-[0.7rem] font-bold uppercase tracking-[0.18em] text-white/60">{p.blankLabel || "Apparel"}</p>
        <Link href={href} className="block" aria-label={`View ${p.title}`}>
          <div className={IMAGE_BOX}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.images[0]} alt={p.title} loading={index < 4 ? "eager" : "lazy"} className="h-full w-full object-cover" />
            {!inStock ? <span className="absolute left-1.5 top-1.5 rounded-full bg-black/80 px-2 py-0.5 text-[0.62rem] font-black uppercase text-white">{copy.soldOutBadge}</span> : null}
          </div>
        </Link>
        <Link href={href} className="mx-auto mt-4 line-clamp-2 block min-h-[2.45rem] text-center text-[1.08rem] font-black leading-[1.12] text-white md:text-[1.18rem]">{p.title}</Link>
        <p className="mt-3 text-center text-[0.72rem] font-bold uppercase tracking-[0.12em] text-zinc-400">
          {p.colors.length} colour{p.colors.length === 1 ? "" : "s"} · {p.sizes.length > 1 ? `${p.sizes[0]}–${p.sizes[p.sizes.length - 1]}` : p.sizes[0]}
        </p>
      </div>
      <div>
        <p className="text-center text-[1.6rem] font-black leading-none text-white">{priceLabel(p)}</p>
        <Link href={href} className={CTA}>{inStock ? copy.cta : copy.ctaSoldOut}</Link>
      </div>
    </article>
  );
}

function SortSelect({ value, onChange }: { value: SortKey; onChange: (v: SortKey) => void }) {
  return (
    <label className="relative block h-11 w-full">
      <span className="sr-only">Sort products</span>
      <select value={value} onChange={(e) => onChange(e.target.value as SortKey)} aria-label="Sort products"
        className="h-11 w-full cursor-pointer appearance-none rounded-full border border-white/10 bg-zinc-950 pl-4 pr-10 text-sm font-black uppercase tracking-[0.12em] text-transparent outline-none transition hover:border-[var(--greenway)]/45 focus:border-[var(--greenway)] focus:ring-2 focus:ring-[var(--greenway)]/20">
        {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value} className="bg-zinc-950 text-white">{o.label}</option>)}
      </select>
      <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-sm font-black uppercase tracking-[0.12em] text-white" aria-hidden="true">Sort By</span>
      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--greenway)]" aria-hidden="true">⌄</span>
    </label>
  );
}

export function ShopBrowser({ categories, products, current, copy }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("featured");
  const [colors, setColors] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  const isHome = current === null;
  const searching = query.trim().length > 0;
  const showProducts = !isHome || searching;
  const results = browse(products, { query, colors, sizes, sort });
  const currentCat = categories.find((c) => c.slug === current) ?? null;
  const title = isHome ? (searching ? "Search results" : "Shop Greenway Merch") : currentCat?.label ?? "Shop";
  const activeCount = colors.length + sizes.length + (searching ? 1 : 0);
  const toggle = (set: (f: (x: string[]) => string[]) => void) => (v: string) => set((x) => (x.includes(v) ? x.filter((y) => y !== v) : [...x, v]));
  const reset = () => { setQuery(""); setColors([]); setSizes([]); };
  const colorFacet = facetCounts(products, "color");
  const sizeFacet = facetCounts(products, "size");
  const resultCount = showProducts ? results.length : categories.length;

  const controls = (
    <div className="grid min-w-0 gap-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white">Filters</h2>
        <button type="button" onClick={reset} className="rounded-full bg-[var(--greenway)] px-3 py-2 text-[0.65rem] font-black uppercase tracking-[0.12em] text-black transition hover:bg-[var(--gold)]">Reset</button>
      </div>
      <FilterSection title="Categories" helper="Jump straight to a catalogue">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          <FilterLinkRow href="/" checked={isHome} label="All categories" onNavigate={() => setSheetOpen(false)} />
          {categories.map((c) => <FilterLinkRow key={c.slug} href={`/${c.slug}`} checked={c.slug === current} label={c.label} count={c.count} onNavigate={() => setSheetOpen(false)} />)}
        </div>
      </FilterSection>
      {showProducts && colorFacet.length ? (
        <FilterSection title="Colour">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
            {colorFacet.map((o) => <FilterCheckRow key={o.value} name="color" value={o.value} label={o.value} count={o.count} checked={colors.includes(o.value)} onToggle={toggle(setColors)} />)}
          </div>
        </FilterSection>
      ) : null}
      {showProducts && sizeFacet.length ? (
        <FilterSection title="Size">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
            {sizeFacet.map((o) => <FilterCheckRow key={o.value} name="size" value={o.value} label={o.value} count={o.count} checked={sizes.includes(o.value)} onToggle={toggle(setSizes)} />)}
          </div>
        </FilterSection>
      ) : null}
    </div>
  );

  const search = (
    <div className="relative min-w-0 flex-1">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500"><SearchIcon /></span>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={isHome ? "Search all merch..." : `Search ${currentCat?.label.toLowerCase() ?? "merch"}...`} aria-label="Search products" className={SEARCH_INPUT_CLASS} />
    </div>
  );

  return (
    <section className="mx-auto grid max-w-[var(--shop-max)] gap-5 overflow-x-clip px-3 py-5 sm:px-4 md:px-8 md:py-8 lg:grid-cols-[280px_1fr] lg:gap-8">
      {/* MOBILE: search + sort, then the Filters & Categories sheet button. */}
      <div className="flex flex-row items-center gap-2.5 lg:hidden">
        {search}
        {showProducts ? <div className="w-[8.5rem] shrink-0"><SortSelect value={sort} onChange={setSort} /></div> : null}
      </div>
      <div className="lg:hidden">
        <button type="button" onClick={() => setSheetOpen(true)} aria-expanded={sheetOpen} aria-controls="mobile-merch-filters"
          className="flex min-h-14 w-full items-center justify-between gap-4 rounded-[1.35rem] border border-[var(--greenway)]/30 bg-[var(--greenway)]/12 px-4 py-3 text-left shadow-xl shadow-black/20 transition hover:border-[var(--greenway)]/60">
          <span>
            <span className="block text-sm font-black uppercase tracking-[0.14em] text-white">Filters &amp; Categories</span>
            <span className="mt-1 block text-[0.72rem] font-bold uppercase tracking-[0.1em] text-zinc-400">{activeCount ? `${activeCount} active` : currentCat ? currentCat.label : "All categories"}</span>
          </span>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--orange)] text-xl font-black text-black" aria-hidden="true">+</span>
        </button>
        {sheetOpen ? (
          <div id="mobile-merch-filters" className="fixed inset-0 z-[90] bg-black text-white" role="dialog" aria-modal="true" aria-label="Filters and categories">
            <div className="flex h-full flex-col">
              <header className="sticky top-0 z-10 border-b border-white/10 bg-zinc-950/95 px-4 py-4 backdrop-blur">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-[var(--greenway)]">Shop merch</p>
                    <h2 className="mt-1 text-2xl font-black uppercase tracking-tight text-white">Filters</h2>
                  </div>
                  <button type="button" onClick={() => setSheetOpen(false)} className="grid h-11 w-11 place-items-center rounded-full bg-white text-2xl font-black leading-none text-black" aria-label="Close filters">×</button>
                </div>
              </header>
              <div className="flex-1 overflow-y-auto px-4 py-5">{controls}</div>
              <footer className="sticky bottom-0 border-t border-white/10 bg-zinc-950/95 p-4 backdrop-blur">
                <button type="button" onClick={() => setSheetOpen(false)} className="w-full rounded-full bg-[var(--orange)] px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-black shadow-xl shadow-[rgba(255,127,0,0.2)]">Show {resultCount} Results</button>
              </footer>
            </div>
          </div>
        ) : null}
      </div>

      <aside className="hidden min-w-0 max-w-full rounded-3xl border border-white/10 bg-zinc-950 p-5 lg:col-start-1 lg:row-start-1 lg:row-span-2 lg:block lg:self-start">{controls}</aside>

      <div className="lg:col-start-2 lg:row-start-1 lg:space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <h1 className="min-w-0 truncate text-2xl font-black text-white md:text-3xl">{title}</h1>
          <div className="hidden flex-row items-center gap-2.5 sm:shrink-0 sm:gap-3 lg:flex">
            <div className="relative w-full sm:w-[18rem] lg:w-[22rem]">{search}</div>
            {showProducts ? <div className="w-[8.5rem] shrink-0 sm:w-[11rem]"><SortSelect value={sort} onChange={setSort} /></div> : null}
          </div>
        </div>

        <div className="mt-5 lg:mt-0">
          {!showProducts ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {categories.map((c, i) => <CategoryCard key={c.slug} cat={c} index={i} copy={copy} />)}
            </div>
          ) : results.length ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {results.map((p, i) => <ProductCard key={p.handle} p={p} index={i} copy={copy} />)}
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-white/20 bg-zinc-950 p-10 text-center">
              <p className="text-2xl font-black text-white">{products.length ? "No products match those filters." : "New designs are on the way."}</p>
              <p className="mt-3 text-sm text-zinc-400">{products.length ? "Try clearing a filter." : "Check back soon - or browse another category."}</p>
              {products.length ? (
                <button type="button" onClick={reset} className="mt-6 rounded-full bg-[var(--orange)] px-6 py-3 text-xs font-black uppercase tracking-[0.16em] text-black">Reset filters</button>
              ) : (
                <Link href="/" className="mt-6 inline-flex rounded-full bg-[var(--orange)] px-6 py-3 text-xs font-black uppercase tracking-[0.16em] text-black">All categories</Link>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
